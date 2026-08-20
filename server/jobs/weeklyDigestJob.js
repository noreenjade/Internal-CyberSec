/*
 * Scheduled weekly SLA compliance digest — the piece that turns the
 * "Weekly SLA compliance digest" toggle (System & SLA Notifications panel,
 * state.notificationPrefs.weeklyDigest) into a real email, on a schedule.
 * Reuses buildDigestPreview() from routes/notifications.js as the single
 * source of truth for content, so whatever GET /api/notifications/digest-
 * preview showed beforehand is exactly what leadership actually receives.
 *
 * No new dependency: a plain setInterval checks "is it time yet" every 15
 * minutes rather than pulling in a cron library, per the earlier scheduler
 * decision for this app. The dedup marker (db.getWeeklyDigestLastSentAt())
 * is persisted in system_settings, not held in memory, so a server restart
 * landing inside the same Monday-morning window can't cause a duplicate
 * send. This does mean a multi-instance deployment would need a
 * distributed lock or an external scheduler (e.g. Cloud Scheduler hitting a
 * dedicated endpoint) instead of relying on in-process setInterval, since
 * two instances could both land in the window a few seconds apart.
 *
 * Does not touch ticket creation, comments, mention detection, status-
 * change gating, or the other three notification toggles — this file only
 * reads (never writes) ticket/roster data via buildDigestPreview(), reads
 * db.getNotificationPrefs().weeklyDigest, and calls the existing
 * notifyAsync() mailer helper exactly like every other notification in
 * this app already does.
 */
const db = require("../db");
const { notifyAsync } = require("../mailer");
const { buildDigestPreview } = require("../routes/notifications");

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // how often to check "is it time yet"
const MIN_GAP_MS = 6 * 24 * 3600 * 1000; // guards against re-sending inside the same week if this window is hit more than once
const TARGET_DAY = 1; // Date#getDay(): 0=Sun .. 1=Mon .. 6=Sat
const TARGET_HOUR = 8; // 8:00-8:59, server-local time — matches the panel copy's "Monday summary"

function isScheduledWindow(now) {
  const d = new Date(now);
  return d.getDay() === TARGET_DAY && d.getHours() === TARGET_HOUR;
}

// Exported (not just wired into the interval) so it can also be called
// directly — e.g. from a test script — without waiting for the interval
// to tick or for Monday 8am to actually arrive.
async function sendWeeklyDigestIfDue() {
  const now = Date.now();
  if (!isScheduledWindow(now)) return { sent: false, reason: "outside the Monday 8am window" };

  const lastSentAt = await db.getWeeklyDigestLastSentAt();
  if (lastSentAt != null && now - lastSentAt < MIN_GAP_MS) {
    return { sent: false, reason: "already sent this week" };
  }

  const prefs = await db.getNotificationPrefs();
  if (!prefs.weeklyDigest) {
    return { sent: false, reason: "weeklyDigest toggle is off" };
  }

  const digest = await buildDigestPreview();
  if (digest.recipients.length === 0) {
    console.warn("[weekly-digest] Due to send, but no LEADERSHIP roster member has an email — skipping.");
  } else {
    digest.recipients.forEach((email) => notifyAsync(email, digest.subject, digest.textBody));
    console.log("[weekly-digest] Sent to " + digest.recipients.join(", ") + " — " + digest.subject);
  }
  // Marked as handled either way, so a still-empty roster doesn't log that
  // same warning every 15 minutes for the rest of the hour.
  await db.setWeeklyDigestLastSentAt(now);
  return { sent: digest.recipients.length > 0, recipients: digest.recipients, subject: digest.subject };
}

function startWeeklyDigestScheduler() {
  // Never let a rejected promise here surface as an unhandled rejection —
  // this scheduler runs unattended for the app's whole lifetime, so a
  // single failed check (a transient DB blip, say) must log and move on,
  // not crash the process or go silently missing from the logs.
  sendWeeklyDigestIfDue().catch((err) => console.error("[weekly-digest] Check failed:", err)); // covers a restart that happens to land inside the window
  setInterval(() => {
    sendWeeklyDigestIfDue().catch((err) => console.error("[weekly-digest] Check failed:", err));
  }, CHECK_INTERVAL_MS);
}

module.exports = { startWeeklyDigestScheduler, sendWeeklyDigestIfDue };
