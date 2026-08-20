/*
 * Scheduled SLA breach alert — the piece that turns the "SLA breach alerts"
 * toggle (System & SLA Notifications panel, state.notificationPrefs.
 * slaBreach) into a real email, the moment a ticket's SLA clock actually
 * runs out. Mirrors weeklyDigestJob.js's shape (plain setInterval, no cron
 * dependency) but checks much more often, since "the moment it crosses its
 * deadline" is the whole point of this one.
 *
 * Overdue/frozen math mirrors isOverdue()/slaFrozen()/slaNotStarted() in
 * tracker.html exactly: a ticket is only ever a breach candidate while it's
 * non-terminal, not paused, not unassigned-frozen, and has actually started
 * its clock (sla_date !== 0).
 *
 * Dedup uses a dedicated column (tickets.sla_breach_notified_at) rather
 * than an in-memory Set, so a server restart never causes a duplicate
 * alert for a ticket that was already emailed. It's set once notified, and
 * cleared the moment the ticket stops being overdue for any reason
 * (resolved/rejected/canceled, paused, unassigned, or credited back past
 * "now") — so a ticket that breaches again later (e.g. reopened, breaches
 * a second time) can trigger a fresh alert instead of staying silently
 * suppressed forever.
 *
 * Only ever writes sla_breach_notified_at via db.patchTicket() — never
 * touches any other ticket field, and is completely separate from the
 * existing notification code paths in routes/tickets.js.
 */
const db = require("../db");
const { notifyAsync } = require("../mailer");
const { TERMINAL_STATUSES } = require("../constants");

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // how often to scan for newly-breached tickets

function slaFrozen(t) {
  return t.isPaused || t.unassignedSince != null;
}
function slaNotStarted(t) {
  return t.slaDate === 0;
}
function remainingMs(t, now) {
  if (t.isPaused && t.pausedAt) return t.slaDate - t.pausedAt;
  if (t.unassignedSince != null) return t.slaDate - t.unassignedSince;
  return t.slaDate - now;
}
function isOverdue(t, now) {
  if (TERMINAL_STATUSES.indexOf(t.status) !== -1 || slaFrozen(t) || slaNotStarted(t)) return false;
  return remainingMs(t, now) < 0;
}
function formatOverdueBy(ms) {
  const totalMin = Math.floor(Math.abs(ms) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? h + "h " + m + "m" : m + "m";
}

// Exported (not just wired into the interval) so it can also be called
// directly — e.g. from a test script — without waiting for the interval.
async function checkSlaBreaches() {
  const prefs = await db.getNotificationPrefs();
  if (!prefs.slaBreach) return { checked: 0, notified: 0, reason: "slaBreach toggle is off" };

  const now = Date.now();
  const tickets = await db.getAllTickets();
  let notified = 0;

  for (const t of tickets) {
    const overdue = isOverdue(t, now);

    if (overdue && t.slaBreachNotifiedAt == null) {
      const user = t.assignee ? await db.getUserById(t.assignee) : null;
      if (user && user.email) {
        const subject = "SLA Breach Alert — " + t.id + " is overdue";
        const body = [
          "Ticket " + t.id + " (" + t.team + " / " + t.priority + ") has crossed its SLA deadline.",
          "",
          "Title: " + t.title,
          "Status: " + t.status,
          "Overdue by: " + formatOverdueBy(now - t.slaDate),
          "",
          "Assigned to you — please take a look."
        ].join("\n");
        notifyAsync(user.email, subject, body);
      }
      await db.patchTicket(t.id, { slaBreachNotifiedAt: now });
      notified++;
    } else if (!overdue && t.slaBreachNotifiedAt != null) {
      // Stopped being overdue (resolved, paused, unassigned, or credited
      // back past now) — clear the flag so a future breach can alert again.
      await db.patchTicket(t.id, { slaBreachNotifiedAt: null });
    }
  }

  return { checked: tickets.length, notified };
}

function startSlaBreachScheduler() {
  // Never let a rejected promise here surface as an unhandled rejection —
  // this scheduler runs unattended for the app's whole lifetime.
  checkSlaBreaches().catch((err) => console.error("[sla-breach] Check failed:", err));
  setInterval(() => {
    checkSlaBreaches().catch((err) => console.error("[sla-breach] Check failed:", err));
  }, CHECK_INTERVAL_MS);
}

module.exports = { startSlaBreachScheduler, checkSlaBreaches };
