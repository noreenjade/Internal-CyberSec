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
const { emailShell, ctaButtonHtml, escapeHtml, APP_BASE_URL } = require("../mailer");

const router = express.Router();

function isPausedOpen(t) {
  return TERMINAL_STATUSES.indexOf(t.status) === -1 && t.isPaused;
}

// Paused, unassigned-frozen, or Backlog tickets have a frozen SLA clock
// (same rule as isOverdue()/slaFrozen() in tracker.html) — never counted as
// overdue while frozen.
function isOverdueOpen(t, now) {
  if (TERMINAL_STATUSES.indexOf(t.status) !== -1 || t.isPaused || t.unassignedSince != null || t.backlogSince != null) return false;
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

  const htmlBody = buildDigestHtml({ generatedAt: now, total, onTimeCount, breachedCount, overdueOpenCount: overdueOpen.length, breachedResolvedCount: breachedResolved.length, pausedCount, complianceRatePct, breachedTickets });

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
    textBody: lines.join("\n"),
    htmlBody
  };
}

// Report-shaped HTML for the weekly digest — different from the single-
// ticket-event template in mailer.js (buildTicketEmailHtml), but shares the
// same emailShell() wrapper so it still looks like it belongs to the same
// app. A KPI strip up top, then a table of breached tickets (or a plain
// "all clear" line when there are none).
function buildDigestHtml({ generatedAt, total, onTimeCount, breachedCount, overdueOpenCount, breachedResolvedCount, pausedCount, complianceRatePct, breachedTickets }) {
  const kpi = (label, value, color) =>
    '<td style="padding:14px 10px;text-align:center;border:1px solid #e5e7eb;border-radius:8px;">' +
    '<div style="font-size:22px;font-weight:800;color:' + (color || "#111827") + ';">' + escapeHtml(value) + "</div>" +
    '<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;margin-top:2px;">' + escapeHtml(label) + "</div></td>";

  const kpiRow = '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin-bottom:22px;">' +
    "<tr>" +
    kpi("Total", total) +
    kpi("On-time", onTimeCount, "#16a34a") +
    kpi("Breached", breachedCount, breachedCount > 0 ? "#dc2626" : "#111827") +
    kpi("Compliance", complianceRatePct + "%", complianceRatePct >= 90 ? "#16a34a" : complianceRatePct >= 70 ? "#d97706" : "#dc2626") +
    "</tr></table>";

  const sub = '<p style="margin:0 0 18px;font-size:12px;color:#6b7280;">' +
    overdueOpenCount + " still open &middot; " + breachedResolvedCount + " resolved late &middot; " + pausedCount + " paused (excluded from the SLA clock)</p>";

  let breachedHtml;
  if (!breachedTickets.length) {
    breachedHtml = '<p style="font-size:14px;color:#374151;">No breached tickets right now. ✅</p>';
  } else {
    const rows = breachedTickets.map((b) =>
      '<tr>' +
      '<td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:700;color:#6b7280;white-space:nowrap;">' + escapeHtml(b.id) + "</td>" +
      '<td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;">' + escapeHtml(b.title) + "</td>" +
      '<td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;white-space:nowrap;">' + escapeHtml(b.assignee) + "</td>" +
      '<td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#dc2626;">' + escapeHtml(b.detail) + "</td>" +
      "</tr>"
    ).join("");
    breachedHtml = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">' +
      "<thead><tr>" +
      '<th style="text-align:left;padding:6px 10px;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb;">ID</th>' +
      '<th style="text-align:left;padding:6px 10px;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Title</th>' +
      '<th style="text-align:left;padding:6px 10px;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Assignee</th>' +
      '<th style="text-align:left;padding:6px 10px;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Status</th>' +
      "</tr></thead><tbody>" + rows + "</tbody></table>";
  }

  const body = '<h2 style="margin:0 0 4px;font-size:18px;color:#111827;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">Weekly SLA Compliance Digest</h2>' +
    '<p style="margin:0 0 20px;font-size:12px;color:#9ca3af;">Generated ' + escapeHtml(new Date(generatedAt).toLocaleString()) + "</p>" +
    kpiRow + sub + breachedHtml +
    ctaButtonHtml(APP_BASE_URL, "Open Ticketing System");

  return emailShell(body);
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
