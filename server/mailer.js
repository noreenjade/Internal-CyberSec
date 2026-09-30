/*
 * Nodemailer setup for ticket email notifications. All SMTP credentials
 * come from environment variables (see .env.example) — never hardcoded.
 *
 * If SMTP isn't configured (no SMTP_HOST/SMTP_USER/SMTP_PASS), notifications
 * are silently disabled rather than crashing the server — email is a side
 * effect of a ticket action, and a missing/broken mail config must never
 * block ticket creation, assignment, or commenting.
 */
const nodemailer = require("nodemailer");

const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;
if (smtpConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
} else {
  console.warn("[mailer] SMTP_HOST / SMTP_USER / SMTP_PASS not set in the environment — email notifications are disabled. Ticket actions will still work normally.");
}

// SEED_USERS in constants.js was built with placeholder @company.com
// addresses for everyone except the real account (u1) — company.com is a
// real, registered domain (not a reserved example domain), so sending to
// these actually round-trips through Gmail as a genuine soft-bounce
// instead of failing silently. Skip them outright rather than let every
// ticket action to a seed user spam the real SMTP_FROM inbox with bounces.
const PLACEHOLDER_EMAIL_DOMAINS = ["company.com"];
function isPlaceholderEmail(to) {
  var domain = (to || "").split("@")[1];
  return !!domain && PLACEHOLDER_EMAIL_DOMAINS.indexOf(domain.toLowerCase()) !== -1;
}

// Where the "Open Ticketing System" button in every HTML email links to.
// Derived from GOOGLE_REDIRECT_URI (already the one place the deployed
// app's own public URL is configured) rather than adding a second env var
// that could drift out of sync with it.
const APP_BASE_URL = (process.env.GOOGLE_REDIRECT_URI || "").replace(/\/auth\/google\/callback\/?$/, "") || "http://localhost:" + (process.env.PORT || 4000);

// Minimal HTML-entity escaping for values interpolated into email markup
// (ticket titles/details, names) — these can contain arbitrary text typed
// by an analyst, so this is the email equivalent of escapeHtml() in
// tracker.html, not decorative.
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

// Plain text -> minimal HTML paragraphs, so a multi-line ticket description
// typed into a plain textarea doesn't collapse onto one line once dropped
// into HTML (which ignores newlines by default).
function textToHtmlParagraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((para) => "<p style=\"margin:0 0 10px;white-space:pre-line;\">" + escapeHtml(para) + "</p>")
    .join("");
}

function ctaButtonHtml(url, label) {
  return '<a href="' + url + '" style="display:inline-block;background:#A8434A;color:#ffffff;text-decoration:none;' +
    'font-size:14px;font-weight:600;padding:11px 24px;border-radius:6px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">' +
    escapeHtml(label) + "</a>";
}

// The ticket-details "card" shown inside most notification emails — ID,
// title, and priority/team badges, colored from the ticket's own frozen
// priorityConfig (or a neutral default when there's no ticket-specific
// color, e.g. the weekly digest doesn't use this at all).
function ticketCardHtml(ticket) {
  if (!ticket) return "";
  var cfg = ticket.priorityConfig || {};
  var color = cfg.color || "#8B5CF6";
  return '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-left:4px solid ' + color + ';border-radius:8px;padding:16px 18px;margin:4px 0 22px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">' +
    '<div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:.03em;margin-bottom:4px;">' + escapeHtml(ticket.id) + "</div>" +
    '<div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:10px;line-height:1.4;">' + escapeHtml(ticket.title) + "</div>" +
    (ticket.priority ? '<span style="display:inline-block;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">' + escapeHtml(ticket.priority.toUpperCase()) + "</span>" : "") +
    (ticket.team ? ' <span style="display:inline-block;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;background:#eef2f7;color:#374151;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">' + escapeHtml(ticket.team) + "</span>" : "") +
    (ticket.details ? '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb;">' +
      '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;">Details</div>' +
      '<div style="font-size:13px;color:#374151;line-height:1.6;white-space:pre-line;">' + escapeHtml(ticket.details) + "</div>" +
      "</div>" : "") +
    "</div>";
}

// The email's "View Ticket" / "Open Ticketing System" button should land
// directly on the ticket in question, not just the board root — tracker.html
// reads this ?ticket= param once on load (see applyDeepLinkTicketIfAny())
// and opens that ticket's detail modal automatically. Links straight at
// /tracker.html (not just "/"), since server.js's "/" -> "/tracker.html"
// redirect doesn't forward the query string — going through it would lose
// ?ticket= entirely. Falls back to the plain app URL for notifications that
// aren't about one specific ticket (the weekly digest builds its own CTA).
function ticketUrl(ticket) {
  return ticket ? APP_BASE_URL + "/tracker.html?ticket=" + encodeURIComponent(ticket.id) : APP_BASE_URL;
}

// Same idea as ticketUrl(), but for a "View Comment" link (a new-comment or
// @mention notification) — adds &comment=<id> so tracker.html's deep-link
// handler also scrolls to and briefly highlights that specific comment once
// the ticket opens, not just the ticket in general.
function commentUrl(ticket, commentId) {
  return ticketUrl(ticket) + "&comment=" + encodeURIComponent(commentId);
}

// The one shared shell every notification email renders inside — brand bar,
// white card, footer disclaimer. bodyHtml is whatever the specific
// notification (assignment, comment, SLA breach, digest...) builds for its
// own middle section.
function emailShell(bodyHtml) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;">' +
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f4f5f7;padding:32px 16px;">' +
    '<div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">' +
    '<div style="background:#171317;padding:18px 28px;">' +
    '<span style="color:#ffffff;font-size:15px;font-weight:700;">Internal CyberSec Practice</span>' +
    '<span style="color:#9ca3af;font-size:12px;margin-left:8px;">SOC &amp; Threat Hunt</span>' +
    "</div>" +
    '<div style="padding:28px;">' + bodyHtml + "</div>" +
    '<div style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">' +
    '<p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5;">This is an automated notification from the Internal CyberSec Practice ticketing system. Please don’t reply to this address directly unless a reply-to name is shown above.</p>' +
    "</div></div></div></body></html>";
}

// Composes the shell + a heading + a message + (optionally) a ticket card +
// a CTA button — the shape every ticket-related notification (assignment,
// reassignment, comment, mention, status change, resolve, SLA breach)
// shares. The weekly digest is different enough (a report, not a single-
// ticket event) that it builds its own bodyHtml and calls emailShell()
// directly instead of this.
function buildTicketEmailHtml({ heading, message, ticket, ctaLabel, ctaUrl }) {
  var body = '<h2 style="margin:0 0 14px;font-size:18px;color:#111827;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">' + escapeHtml(heading) + "</h2>" +
    '<div style="font-size:14px;color:#374151;line-height:1.6;margin-bottom:20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">' + textToHtmlParagraphs(message) + "</div>" +
    ticketCardHtml(ticket) +
    ctaButtonHtml(ctaUrl || ticketUrl(ticket), ctaLabel || "Open Ticketing System");
  return emailShell(body);
}

// options.fromName / options.replyTo let a notification show who actually
// triggered it (the ticket's requester, a comment author) instead of always
// reading as sent by whoever's SMTP_USER credentials are configured — the
// underlying "from" ADDRESS still has to stay the authenticated SMTP account
// (Gmail, and most real providers, reject or silently rewrite a From address
// that isn't verified as an alias on that same account), but the DISPLAY
// NAME on that address is just a string and can be anything. replyTo routes
// an actual reply to the person who did the thing, not to whoever's account
// is doing the sending.
// options.html carries the formatted version built by buildTicketEmailHtml()
// (or a call site's own emailShell()-based markup) — sent alongside the
// plain-text body so a client that can't/won't render HTML still gets a
// readable fallback instead of a blank message.
async function sendNotificationEmail(to, subject, text, options) {
  options = options || {};
  if (!smtpConfigured || !to) return false;
  if (isPlaceholderEmail(to)) {
    console.warn("[mailer] Skipping send to placeholder address " + to + " — not a real inbox.");
    return false;
  }
  try {
    const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
    const from = options.fromName
      ? '"' + String(options.fromName).replace(/"/g, "") + '" <' + fromAddress + ">"
      : fromAddress;
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html: options.html || undefined,
      replyTo: options.replyTo || undefined
    });
    return true;
  } catch (err) {
    console.error("[mailer] Failed to send notification email:", err);
    return false;
  }
}

// Fire-and-forget wrapper for call sites that must never let a mail failure
// affect the HTTP response already being sent for the primary action.
function notifyAsync(to, subject, text, options) {
  sendNotificationEmail(to, subject, text, options).catch((err) => console.error("[mailer] notifyAsync error:", err));
}

module.exports = { sendNotificationEmail, notifyAsync, smtpConfigured, buildTicketEmailHtml, emailShell, ticketCardHtml, ctaButtonHtml, ticketUrl, commentUrl, escapeHtml, APP_BASE_URL };
