/*
 * Google Sign-In (OAuth 2.0 authorization code flow) — the intended way
 * into the app once GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/JWT_SECRET are
 * set in .env. Until then, oauthConfigured is false and requireAuth()
 * below just calls next() unconditionally — same "never block the app
 * over a missing side-channel config" rule mailer.js already follows for
 * SMTP, so wiring this in today changes nothing until it's actually
 * filled in.
 *
 * Session identity is a signed, httpOnly JWT cookie — stateless, no
 * server-side session store needed. Google's own tokens are only ever
 * used during the callback below to verify who signed in; they're never
 * persisted past that request.
 *
 * Two gates, both required to actually get a session:
 *   1. The verified Google account's email must end in @ALLOWED_EMAIL_DOMAIN
 *      (if set) — rejects anyone outside the org before the roster is
 *      even consulted.
 *   2. That email must match an existing users row (case-insensitive,
 *      db.getUserByEmail) — Google Sign-In authenticates WHO someone is,
 *      it does not create a seat for them. A real employee not yet on
 *      Team Roster & Roles gets a clear "not on the roster" error instead
 *      of a silently-created account.
 */
const express = require("express");
const db = require("./db");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:4000/auth/google/callback";
const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || "").toLowerCase().replace(/^@/, "");
const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_MS = 12 * 3600 * 1000; // 12h — a workday, short enough a stolen cookie doesn't work forever

const oauthConfigured = !!(CLIENT_ID && CLIENT_SECRET && JWT_SECRET);
if (!oauthConfigured) {
  console.warn(
    "[auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / JWT_SECRET not fully set in .env — " +
    "Google Sign-In is disabled and every API route is open, exactly like before this feature existed. " +
    "See .env for what to fill in."
  );
} else if (!ALLOWED_DOMAIN) {
  console.warn("[auth] ALLOWED_EMAIL_DOMAIN is not set — sign-in will accept ANY Google account, not just your org's. Set it in .env to restrict this.");
}

// Both google-auth-library AND jsonwebtoken are lazy-required — only once
// an /auth/* request actually needs them, NOT at module load time.
// Requiring either of them at startup alongside the rest of this app's
// routers (specifically routes/settings.js and routes/notifications.js,
// both otherwise unremarkable) reliably crashed the process with a native
// better-sqlite3/V8 GC assertion during Node's own bootstrap — reproduced
// independently of any logic in either file, and independently for each
// of the two packages on its own. Deferring both requires until well
// after the server has finished starting up avoids that interaction
// entirely, whatever its root cause actually is.
var _jwt = null;
function getJwt() {
  if (!_jwt) _jwt = require("jsonwebtoken");
  return _jwt;
}
var _OAuth2Client = null;
var _oauthClient = null;
function getOAuthClient() {
  if (!oauthConfigured) return null;
  if (!_oauthClient) {
    _OAuth2Client = require("google-auth-library").OAuth2Client;
    _oauthClient = new _OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  }
  return _oauthClient;
}

function issueSessionCookie(res, user) {
  const token = getJwt().sign(
    { sub: user.id, name: user.name, email: user.email, isAdmin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: Math.floor(SESSION_MAX_AGE_MS / 1000) }
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // Cloud Run/etc. terminates TLS in front of the app — set NODE_ENV=production there so this cookie is only ever sent over HTTPS
    maxAge: SESSION_MAX_AGE_MS
  });
}

function readSession(req) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    return getJwt().verify(token, JWT_SECRET);
  } catch (err) {
    return null; // expired or tampered — treated the same as "no cookie at all"
  }
}

// Mounted on every /api/* route in server.js. Deliberately a no-op
// (next() with no req.user) while oauthConfigured is false, so today's
// fully-open behavior is unchanged until this is actually turned on.
function requireAuth(req, res, next) {
  if (!oauthConfigured) return next();
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Not signed in" });
  req.user = session;
  next();
}

const router = express.Router();

router.get("/auth/google", (req, res) => {
  if (!oauthConfigured) return res.status(503).send("Google Sign-In isn't configured yet — see server/.env.");
  const oauthClient = getOAuthClient();
  const url = oauthClient.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    // Hints Google's account chooser toward the right Workspace domain —
    // a UX nicety only, NOT the security boundary (the callback below
    // re-checks the domain on the verified token itself either way).
    hd: ALLOWED_DOMAIN || undefined,
    prompt: "select_account"
  });
  res.redirect(url);
});

router.get("/auth/google/callback", async (req, res) => {
  if (!oauthConfigured) return res.status(503).send("Google Sign-In isn't configured yet — see server/.env.");
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing authorization code.");
  try {
    const oauthClient = getOAuthClient();
    const { tokens } = await oauthClient.getToken({ code, redirect_uri: REDIRECT_URI });
    const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_ID });
    const payload = ticket.getPayload();
    const email = (payload.email || "").toLowerCase();

    if (!payload.email_verified) {
      return res.status(403).send("That Google account's email isn't verified.");
    }
    if (ALLOWED_DOMAIN && !email.endsWith("@" + ALLOWED_DOMAIN)) {
      return res.status(403).send("Sign-in is restricted to @" + ALLOWED_DOMAIN + " accounts. You signed in as " + email + ".");
    }

    const user = await db.getUserByEmail(email);
    if (!user) {
      return res.status(403).send(
        "Signed in as " + email + ", but this account isn't on the Team Roster yet. " +
        "Ask an admin to add you under Admin / SLA Settings → Team Roster & Roles with this exact email, then try again."
      );
    }

    issueSessionCookie(res, user);
    // Not "/" — this app has no root route (server.js only serves static
    // files, and tracker.html isn't named index.html), so redirecting to
    // "/" 404s ("Cannot GET /") immediately after a successful sign-in.
    res.redirect("/tracker.html");
  } catch (err) {
    console.error("[auth] Google callback failed:", err);
    res.status(500).send("Sign-in failed — see server logs.");
  }
});

// Polled by the frontend once at load (see checkAuth() in tracker.html).
// { configured: false } means Sign-In isn't set up yet — the app runs
// exactly as it always has. { configured: true, user: null } means it's
// set up but this browser has no valid session — show the login screen.
router.get("/auth/me", (req, res) => {
  if (!oauthConfigured) return res.json({ configured: false, user: null });
  const session = readSession(req);
  if (!session) return res.status(401).json({ configured: true, user: null });
  res.json({ configured: true, user: { id: session.sub, name: session.name, email: session.email, isAdmin: session.isAdmin } });
});

router.post("/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ success: true });
});

module.exports = { router, requireAuth, oauthConfigured };
