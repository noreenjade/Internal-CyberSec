/*
 * READ-ONLY preview of what the (not-yet-built) weekly SLA compliance
 * digest email would contain, based on tickets currently in the DB. This
 * exists purely so the content can be eyeballed before the real scheduled
 * job is built — it never sends anything, never writes anything, and is
 * completely separate from the existing notification code paths (mention
 * detection, status-change gating, assignment emails, etc. in
 * routes/tickets.js — none of that is touched by this file).
 *
 * Breach/on-time math mirrors renderAnalytics() in tracker.html (isOverdue,
 * the breachedResolved/overdueOpen/pausedCount split) so the numbers here
 * match what the Dashboard / Analytics tab already shows for "now."
 *
 * GET /api/notifications/digest-preview
 */
const express = require("express");
const db = require("../db");
const { TERMINAL_STATUSES } = require("../constants");
const { asyncRoute } = require("../util");

const router = express.Router();

function isPausedOpen(t) {
  return TERMINAL_STATUSES.indexOf(t.status) === -1 && t.isPaused;
}

// Paused tickets have a frozen SLA clock (same rule as isOverdue() in
// tracker.html) — never counted as overdue while paused.
function isOverdueOpen(t, now) {
  if (TERMINAL_STATUSES.indexOf(t.status) !== -1 || t.isPaused) return false;
  return now > t.slaDate;
}

function isBreachedResolved(t) {
  return t.dateTimeResolved != null && t.dateTimeResolved > t.slaDate;
}

function formatOverdueBy(ms) {
  const totalMin = Math.floor(Math.abs(ms) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? h + "h " + m + "m" : m + "m";
}

async function assigneeNameFor(t) {
  if (!t.assignee || t.assignee === "unassigned") return "Unassigned";
  const user = await db.getUserById(t.assignee);
  return user ? user.name : "Unknown";
}

async function buildDigestPreview() {
  const now = Date.now();
  const tickets = await db.getAllTickets();
  const total = tickets.length;

  const overdueOpen = tickets.filter((t) => isOverdueOpen(t, now));
  const breachedResolved = tickets.filter((t) => isBreachedResolved(t));
  const pausedCount = tickets.filter((t) => isPausedOpen(t)).length;
  const breachedCount = overdueOpen.length + breachedResolved.length;
  const onTimeCount = Math.max(0, total - breachedCount - pausedCount);
  const complianceRatePct = total > 0 ? Math.round((onTimeCount / total) * 100) : 100;

  const breachedTickets = (await Promise.all(overdueOpen.map(async (t) => ({
    id: t.id,
    team: t.team,
    title: t.title,
    priority: t.priority,
    status: t.status,
    assignee: await assigneeNameFor(t),
    detail: "Still open — overdue by " + formatOverdueBy(now - t.slaDate)
  })))).concat(await Promise.all(breachedResolved.map(async (t) => ({
    id: t.id,
    team: t.team,
    title: t.title,
    priority: t.priority,
    status: t.status,
    assignee: await assigneeNameFor(t),
    detail: "Resolved late — breached SLA by " + formatOverdueBy(t.dateTimeResolved - t.slaDate)
  }))));

  const roster = await db.getRoster();
  const recipients = (roster.LEADERSHIP || []).map((u) => u.email);

  const subject = "Weekly SLA Compliance Digest — " + complianceRatePct + "% on-time (" + breachedCount + " breached of " + total + ")";

  const lines = [
    "Weekly SLA Compliance Digest",
    "Generated: " + new Date(now).toLocaleString(),
    "",
    "Total tickets: " + total,
    "On-time: " + onTimeCount,
    "Breached: " + breachedCount + " (" + overdueOpen.length + " still open, " + breachedResolved.length + " resolved late)",
    "Paused (excluded from the SLA clock): " + pausedCount,
    "Compliance rate: " + complianceRatePct + "%",
    ""
  ];
  if (breachedTickets.length === 0) {
    lines.push("No breached tickets right now.");
  } else {
    lines.push("Breached tickets:");
    breachedTickets.forEach((b) => {
      lines.push("  - " + b.id + " [" + b.team + " / " + b.priority + "] " + b.title + " — assignee: " + b.assignee + " — " + b.detail);
    });
  }

  return {
    generatedAt: now,
    subject,
    recipients,
    summary: {
      totalTickets: total,
      onTimeCount,
      breachedCount,
      breachedOpenCount: overdueOpen.length,
      breachedResolvedCount: breachedResolved.length,
      pausedCount,
      complianceRatePct
    },
    breachedTickets,
    textBody: lines.join("\n")
  };
}

router.get("/notifications/digest-preview", asyncRoute(async (req, res) => {
  const digest = await buildDigestPreview();
  // Satisfies the "or a console.log" option too — every hit logs the same
  // plain-text body the JSON response carries in textBody.
  console.log("[digest-preview] " + digest.subject);
  console.log(digest.textBody);
  res.json(digest);
}));

// buildDigestPreview is exported alongside the router so the real weekly
// digest job (server/jobs/weeklyDigestJob.js) can reuse the exact same
// content-building logic instead of duplicating it — whatever the preview
// endpoint shows is guaranteed to match what the scheduled job actually
// sends. This is purely an additional export; the route above is unchanged.
module.exports = router;
module.exports.buildDigestPreview = buildDigestPreview;
