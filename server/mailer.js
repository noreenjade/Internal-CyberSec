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

async function sendNotificationEmail(to, subject, text) {
  if (!smtpConfigured || !to) return false;
  if (isPlaceholderEmail(to)) {
    console.warn("[mailer] Skipping send to placeholder address " + to + " — not a real inbox.");
    return false;
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text
    });
    return true;
  } catch (err) {
    console.error("[mailer] Failed to send notification email:", err);
    return false;
  }
}

// Fire-and-forget wrapper for call sites that must never let a mail failure
// affect the HTTP response already being sent for the primary action.
function notifyAsync(to, subject, text) {
  sendNotificationEmail(to, subject, text).catch((err) => console.error("[mailer] notifyAsync error:", err));
}

module.exports = { sendNotificationEmail, notifyAsync, smtpConfigured };
