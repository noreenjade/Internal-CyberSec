/*
 * REST endpoints for tickets + comments.
 *
 * Ticket creation/patch logic mirrors makeTicket() / updateTicket() /
 * submitCreateTicket() / changeStatus() in cyberops-task-tracker.html as
 * closely as a stateless HTTP API reasonably can:
 *   - id numbering ("SOC-1001", "TI-2001", ...) matches submitCreateTicket()
 *   - priorityConfig is snapshotted from sla_config AT CREATION time and
 *     never re-derived later, same "frozen copy" rule as the frontend
 *   - a status change appends a history entry with the same action/note
 *     shape changeStatus() writes, and sets/clears dateTimeResolved the
 *     same way
 *   - closing a still-paused ticket, or reopening one that was terminal,
 *     extends slaDate by the paused/dwell duration exactly like changeStatus()
 *     does, so a ticket closed (or paused) through this endpoint never ends
 *     up with corrupted SLA math if it's later reopened
 *
 * Every handler is async and every db.* call is awaited — db.js moved from
 * synchronous better-sqlite3 to async pg (Postgres/Cloud SQL) calls, and
 * asyncRoute() (see ../util.js) forwards a rejected promise to Express's
 * error middleware the same way a synchronous throw always has.
 */
const express = require("express");
const db = require("../db");
const { STATUSES, TERMINAL_STATUSES, PRIORITIES, TEAMS, CLIENTS, DEFAULT_CLIENT } = require("../constants");
const { uid, extractMentions, asyncRoute } = require("../util");
const { notifyAsync } = require("../mailer");

const router = express.Router();

function isUnassigned(assignee) {
  return !assignee || assignee === "unassigned";
}

// Single point of truth for assignment emails, used by all three places a
// ticket's assignee can change (POST create, PATCH, and the bulk PUT diff)
// so the "new assignment" vs. "reassignment" split and each one's own
// notification-preference gate only ever have to be gotten right once.
//   - unassigned -> someone: "new assignment" — gated by prefs.newAssignment,
//     emails only the new assignee.
//   - someone -> a DIFFERENT someone: "reassignment" — gated by
//     prefs.reassignment, emails BOTH the previous and new assignee.
//   - someone -> unassigned, or no real change: no email either toggle's
//     copy describes, so intentionally a no-op.
async function notifyAssignmentChange(ticket, oldAssignee) {
  const newAssignee = ticket.assignee;
  if (oldAssignee === newAssignee) return;
  const prefs = await db.getNotificationPrefs();

  if (isUnassigned(oldAssignee) && !isUnassigned(newAssignee)) {
    if (!prefs.newAssignment) return;
    const user = await db.getUserById(newAssignee);
    if (user) notifyAsync(user.email, "New ticket assigned: " + ticket.id, "You've been assigned " + ticket.id + " — " + ticket.title + ".\n\nDetails:\n" + ticket.details);
    return;
  }

  if (!isUnassigned(oldAssignee) && !isUnassigned(newAssignee)) {
    if (!prefs.reassignment) return;
    const prevUser = await db.getUserById(oldAssignee);
    const newUser = await db.getUserById(newAssignee);
    if (prevUser) {
      notifyAsync(
        prevUser.email,
        "Ticket " + ticket.id + " reassigned",
        ticket.id + " — " + ticket.title + " has been reassigned to " + (newUser ? newUser.name : "another analyst") + "."
      );
    }
    if (newUser) {
      notifyAsync(
        newUser.email,
        "Ticket reassigned to you: " + ticket.id,
        "You've been assigned " + ticket.id + " — " + ticket.title + (prevUser ? " (reassigned from " + prevUser.name + ")" : "") + ".\n\nDetails:\n" + ticket.details
      );
    }
  }
}

// requestedBy is a free-text name (see the POST handler below), not a user
// id — it's whoever asked for the work, which may not even be a roster
// member (e.g. "IT Infrastructure", "CISO Office"). Matching it by name
// against the roster (case-insensitive, same idea as @mention matching in
// util.js) is the only way to resolve it to a real inbox; anyone who
// doesn't match a real user (a department name, a typo, an external
// requester) is silently skipped rather than erroring — there's simply no
// email to send to. Always fires, unlike the assignee's own "status
// changed" email above — the requester finding out their ticket is done
// isn't gated by the Status Change Notifications setting, which only ever
// governed the assignee-facing copy.
async function notifyRequesterOnResolve(ticket) {
  const name = (ticket.requestedBy || "").trim().toLowerCase();
  if (!name) return;
  const users = await db.getAllUsers();
  const match = users.find((u) => u.name.toLowerCase() === name);
  if (!match) return;
  const notes = ticket.rejectionReason ? "\n\nResolution notes:\n" + ticket.rejectionReason : "";
  notifyAsync(
    match.email,
    "Your ticket " + ticket.id + " has been resolved",
    ticket.id + " — " + ticket.title + " has been marked Resolved." + notes
  );
}

// GET /api/tickets?team=SOC|TI
router.get("/tickets", asyncRoute(async (req, res) => {
  const team = req.query.team;
  if (team && TEAMS.indexOf(team) === -1) {
    return res.status(400).json({ error: "team must be one of: " + TEAMS.join(", ") });
  }
  res.json(await db.getAllTickets({ team }));
}));

// PUT /api/tickets — full replace. Added for cyberops-task-tracker.html_v2.
// html's persistTickets(), which (matching its old localStorage write)
// dumps the entire current ticket array on every render rather than
// sending per-field deltas. db.replaceAllTickets() diffs against the
// pre-replace snapshot so we know which tickets are new (→ assignment
// email via notifyAssignmentChange), had their assignee change (→
// assignment/reassignment email, same helper), or changed status (→
// "status changed" email).
router.put("/tickets", asyncRoute(async (req, res) => {
  const tickets = req.body;
  if (!Array.isArray(tickets)) return res.status(400).json({ error: "Request body must be an array of tickets" });

  const { tickets: saved, events } = await db.replaceAllTickets(tickets);

  for (const t of events.created) await notifyAssignmentChange(t, "");
  for (const { ticket, oldAssignee } of events.assigneeChanged) await notifyAssignmentChange(ticket, oldAssignee);
  // Not gated by the Status Change Notifications setting below — that
  // toggle only ever controlled the assignee-facing "status changed" email,
  // and the requester finding out their own ticket is done is a distinct
  // notification the toggle was never meant to suppress.
  for (const { ticket } of events.statusChanged) {
    if (ticket.status === "Resolved") await notifyRequesterOnResolve(ticket);
  }
  // Gated by the "Status Change Notifications" setting (System & SLA
  // Notifications panel): "assignment_only" (the default) skips this email
  // entirely for plain status transitions, since those aren't assignment
  // events. Assignment-triggered emails (new ticket assigned / reassigned,
  // both elsewhere in this file and in the PATCH handler below) are a
  // separate code path and are never affected by this setting.
  if ((await db.getStatusChangeNotifyMode()) === "always") {
    for (const { ticket, oldStatus } of events.statusChanged) {
      if (!isUnassigned(ticket.assignee)) {
        const user = await db.getUserById(ticket.assignee);
        if (user) {
          notifyAsync(
            user.email,
            "Ticket " + ticket.id + " status changed",
            ticket.id + " — " + ticket.title + " changed from " + oldStatus + " to " + ticket.status + "."
          );
        }
      }
    }
  }

  res.json(saved);
}));

// GET /api/tickets/:id — not explicitly requested, but PATCH/comments need
// a ticket to exist, and returning a single ticket is the natural read-back
// after creating/patching one, so it's included alongside the requested set.
router.get("/tickets/:id", asyncRoute(async (req, res) => {
  const ticket = await db.getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  res.json(ticket);
}));

// POST /api/tickets
router.post("/tickets", asyncRoute(async (req, res) => {
  const body = req.body || {};
  const team = body.team;
  const title = (body.title || "").trim();
  const details = (body.details || "").trim();
  const priority = body.priority;
  const requestedBy = (body.requestedBy || "").trim() || "Unspecified";
  const assignee = body.assignee || "";

  if (TEAMS.indexOf(team) === -1) return res.status(400).json({ error: "team must be one of: " + TEAMS.join(", ") });
  if (!title) return res.status(400).json({ error: "title is required" });
  if (!details) return res.status(400).json({ error: "details is required" });
  if (PRIORITIES.indexOf(priority) === -1) return res.status(400).json({ error: "priority must be one of: " + PRIORITIES.join(", ") });

  var categories = await db.getCategoriesFor(team);
  var category = body.category;
  if (!category || categories.indexOf(category) === -1) {
    category = categories[0] || body.category || "Uncategorized";
  }

  // Client is independent of team — either internal team (SOC/TI) can work
  // a ticket for either client (or no client at all). Optional/lenient like
  // Category: an invalid or missing value never blocks ticket creation, it
  // just falls back to the default.
  var client = CLIENTS.indexOf(body.client) !== -1 ? body.client : DEFAULT_CLIENT;

  // Agency only exists when client = "NSOC", and unlike Category, "" isn't
  // an invalid/missing value to paper over — it's the real, valid "General /
  // No specific agency" choice (Agency is optional, Category isn't), so an
  // empty/invalid agency resets to "" rather than defaulting to the first
  // real agency in the list.
  var agency = "";
  if (client === "NSOC") {
    var agencies = await db.getAgenciesFor(client);
    agency = (body.agency && agencies.indexOf(body.agency) !== -1) ? body.agency : "";
  }

  const createdAt = Date.now();
  const priorityConfig = await db.getSlaConfigFor(team, priority); // frozen snapshot, per makeTicket()'s own rule
  // The SLA clock only starts once a ticket actually has an assignee — a
  // ticket filed and left unassigned used to start counting down (and could
  // even show Overdue) immediately at creation, which was misleading since
  // nobody had started working it yet. 0 is the "not started" sentinel (see
  // SLA_NOT_STARTED in tracker.html) — a real slaDate is always a huge
  // epoch-ms value, so 0 can never collide with a genuine deadline. If this
  // ticket IS assigned right at creation, the clock starts immediately, same
  // as it always has.
  const slaDate = isUnassigned(assignee) ? 0 : createdAt + priorityConfig.hours * 3600 * 1000;
  const id = await db.nextTicketId(team);

  await db.insertTicket({
    id,
    team,
    title,
    details,
    priority,
    category,
    client,
    agency,
    status: "New",
    requestedBy,
    assignee,
    createdAt,
    priorityHours: priorityConfig.hours,
    priorityColor: priorityConfig.color,
    priorityLabel: priorityConfig.label,
    slaDate
  });

  await db.insertHistory({ id: uid(), ticketId: id, action: "Created", time: createdAt, note: "Ticket opened as New" });

  const ticket = await db.getTicketById(id);

  await notifyAssignmentChange(ticket, "");

  res.status(201).json(ticket);
}));

// PATCH /api/tickets/:id
router.patch("/tickets/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const existing = await db.getTicketById(id);
  if (!existing) return res.status(404).json({ error: "Ticket not found" });

  const patch = req.body || {};
  if (patch.status != null && STATUSES.indexOf(patch.status) === -1) {
    return res.status(400).json({ error: "status must be one of: " + STATUSES.join(", ") });
  }

  const statusChanging = patch.status != null && patch.status !== existing.status;
  const assigneeChanging = patch.assignee != null && patch.assignee !== existing.assignee;
  const finalPatch = Object.assign({}, patch);

  // Starts the SLA clock the moment a ticket gets its first assignee — only
  // fires while slaDate is still the "not started" sentinel (0), so a ticket
  // that's later unassigned and reassigned again keeps its original clock
  // running rather than restarting it (see the POST handler above for the
  // full rationale).
  if (assigneeChanging && isUnassigned(existing.assignee) && !isUnassigned(patch.assignee) && existing.slaDate === 0) {
    finalPatch.slaDate = Date.now() + existing.priorityConfig.hours * 3600 * 1000;
  }

  // Same fix as updateTicket() in the HTML: once the clock has actually
  // started (not the sentinel above), losing the assignee again freezes it
  // — same idea as Pause, but automatic, and tracked in its own
  // unassigned_since column so it's never confused with (or cleared by) an
  // analyst's deliberate pause. Reassigning later credits the frozen
  // duration back into sla_date, same as Resume does.
  if (assigneeChanging && !isUnassigned(existing.assignee) && isUnassigned(patch.assignee) && existing.slaDate !== 0) {
    finalPatch.unassignedSince = Date.now();
  }
  if (assigneeChanging && isUnassigned(existing.assignee) && !isUnassigned(patch.assignee) && existing.slaDate !== 0 && existing.unassignedSince != null) {
    finalPatch.slaDate = existing.slaDate + (Date.now() - existing.unassignedSince);
    finalPatch.unassignedSince = null;
  }

  // Same history-logging + dateTimeResolved rule as changeStatus() in the
  // HTML: resolving stamps dateTimeResolved, leaving Resolved for something
  // else clears it back to null.
  if (statusChanging) {
    const changedAt = Date.now();
    const resolved = patch.status === "Resolved";
    const wasTerminal = TERMINAL_STATUSES.indexOf(existing.status) !== -1;
    const isTerminal = TERMINAL_STATUSES.indexOf(patch.status) !== -1;

    // Same fix as changeStatus() in the HTML: closing a still-paused ticket
    // must finalize the pause (as Resume would) instead of leaving
    // is_paused/paused_at stale, which would otherwise corrupt the SLA math
    // if the ticket is ever reopened.
    if (isTerminal && existing.isPaused && existing.pausedAt != null) {
      const pausedDuration = changedAt - existing.pausedAt;
      await db.insertHistory({
        id: uid(),
        ticketId: id,
        action: "Resumed",
        time: changedAt,
        note: "Auto-resumed — SLA extended by " + Math.max(1, Math.round(pausedDuration / 60000)) + " min (ticket closed while paused)",
        durationMs: pausedDuration
      });
      finalPatch.isPaused = false;
      finalPatch.pausedAt = null;
      finalPatch.slaDate = existing.slaDate + pausedDuration;
      finalPatch.totalPausedMs = existing.totalPausedMs + pausedDuration;
    }

    // Same fix as changeStatus() in the HTML: time spent sitting in a
    // terminal status (Resolved/Rejected/Canceled) shouldn't count against
    // the SLA if the ticket is reopened — credit the dwell time back into
    // sla_date. Skipped if the clock never started, and skipped for tickets
    // that were already terminal before this fix shipped (terminal_since is
    // null for those — no retroactive credit).
    if (wasTerminal && !isTerminal && existing.terminalSince != null && existing.slaDate !== 0) {
      const dwellMs = changedAt - existing.terminalSince;
      await db.insertHistory({
        id: uid(),
        ticketId: id,
        action: "Reopened",
        time: changedAt,
        note: "Reopened from " + existing.status + " — SLA extended by " + Math.max(1, Math.round(dwellMs / 60000)) + " min (time spent closed doesn't count against the SLA)",
        durationMs: dwellMs
      });
      finalPatch.slaDate = existing.slaDate + dwellMs;
    }

    finalPatch.dateTimeResolved = resolved ? changedAt : null;
    finalPatch.terminalSince = isTerminal ? changedAt : null;
    await db.insertHistory({
      id: uid(),
      ticketId: id,
      action: resolved ? "Resolved" : "Status Changed",
      time: changedAt,
      note: resolved ? "Marked Resolved (was " + existing.status + ")" : (existing.status + " → " + patch.status)
    });
  }

  const updated = await db.patchTicket(id, finalPatch);

  if (assigneeChanging) await notifyAssignmentChange(updated, existing.assignee);
  if (statusChanging && updated.status === "Resolved") await notifyRequesterOnResolve(updated);

  res.json(updated);
}));

// DELETE /api/tickets/:id — cascades to that ticket's comments/history rows
// (ON DELETE CASCADE — see db.deleteTicket()).
router.delete("/tickets/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const existing = await db.getTicketById(id);
  if (!existing) return res.status(404).json({ error: "Ticket not found" });

  await db.deleteTicket(id);
  res.json({ success: true, id });
}));

// POST /api/tickets/:id/comments
router.post("/tickets/:id/comments", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const ticket = await db.getTicketById(id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const authorId = req.body && req.body.authorId;
  const text = req.body && (req.body.text || "").trim();
  if (!authorId) return res.status(400).json({ error: "authorId is required" });
  if (!text) return res.status(400).json({ error: "text is required" });

  // Match @mentions against the full roster (not just this team) by name,
  // longest name first so e.g. "@Jade Lozano" can't shadow "@Noreen Jade
  // Lozano" — see extractMentions() in util.js.
  const roster = await db.getAllUsers();
  const mentionedIds = extractMentions(text, roster);

  const comment = await db.insertComment({ id: uid(), ticketId: id, authorId, text, time: Date.now(), mentions: mentionedIds });

  const author = await db.getUserById(authorId);
  const authorName = author ? author.name : "Someone";

  // Notify the ticket's assignee of the new comment, unless they're the one
  // who just posted it, or they're also @mentioned in this same comment —
  // in that case the more specific "you were mentioned" email below covers
  // them, and sending both would just double-notify the same person for
  // the same comment.
  if (!isUnassigned(ticket.assignee) && ticket.assignee !== authorId && mentionedIds.indexOf(ticket.assignee) === -1) {
    const assignee = await db.getUserById(ticket.assignee);
    if (assignee) {
      notifyAsync(assignee.email, "New comment on " + id, "A new comment was posted on " + id + " — " + ticket.title + ":\n\n" + text);
    }
  }

  // Notify each @mentioned user, skipping self-mentions. The console.log
  // fires unconditionally (even with SMTP unconfigured, where notifyAsync()
  // is a silent no-op) so mention detection is verifiable before SMTP is
  // set up.
  for (const userId of mentionedIds.filter((mid) => mid !== authorId)) {
    const mentionedUser = await db.getUserById(userId);
    if (!mentionedUser) continue;
    console.log("[mailer] Would notify " + mentionedUser.name + " of mention on ticket " + id);
    notifyAsync(
      mentionedUser.email,
      "You were mentioned on " + id,
      authorName + " mentioned you in a comment on " + id + " — " + ticket.title + ":\n\n" + text
    );
  }

  // Already API-shaped (camelCase, numeric time/editedAt) — see
  // db.insertComment().
  res.status(201).json(comment);
}));

module.exports = router;
