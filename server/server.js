/*
 * Express entrypoint. Loads environment variables first (so mailer.js reads
 * fully-populated SMTP_* vars the moment it's required), then wires up the
 * SQLite-backed ticket API.
 */
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const ticketsRouter = require("./routes/tickets");
const rosterRouter = require("./routes/roster");
const slaConfigRouter = require("./routes/sla-config");
const categoriesRouter = require("./routes/categories");
const agenciesRouter = require("./routes/agencies");
const clientsRouter = require("./routes/clients");
const settingsRouter = require("./routes/settings");
const notificationsRouter = require("./routes/notifications");
const { router: authRouter, requireAuth } = require("./auth");
const { startWeeklyDigestScheduler } = require("./jobs/weeklyDigestJob");
const { startSlaBreachScheduler } = require("./jobs/slaBreachJob");

const app = express();
// credentials: true is required for the browser to actually send/receive
// the httpOnly session cookie auth.js issues — without it, a signed-in
// session would silently never be recognized on later requests.
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// Screenshot attachments are stored as base64 data URIs inline on the
// ticket (see tracker.html's file-selected/paste handlers), so the default
// 100kb express.json() limit is nowhere near enough — a single pasted
// screenshot can be a few MB once base64-inflated, and persistTickets()
// PUTs the whole tickets array in one request.
app.use(express.json({ limit: "20mb" }));

// Serve the frontend HTML/JS files (one folder up, in files_configuration)
// so the whole app — API + UI — is reachable through a single port/tunnel.
app.use(express.static(__dirname + "/.."));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// tracker.html, not index.html, is the app's real entry point — express.
// static() above has no route for bare "/", which otherwise 404s
// ("Cannot GET /") for anyone who visits the base URL without the exact
// filename (including right after signing in, or just typing the domain).
app.get("/", (req, res) => {
  res.redirect("/tracker.html");
});

// Not under requireAuth — /auth/google and /auth/google/callback are how
// you GET a session in the first place, and /auth/me is how the frontend
// checks whether Sign-In is even configured before it can know to ask.
app.use(authRouter);

app.use("/api", requireAuth, ticketsRouter);
app.use("/api", requireAuth, rosterRouter);
app.use("/api", requireAuth, slaConfigRouter);
app.use("/api", requireAuth, categoriesRouter);
app.use("/api", requireAuth, agenciesRouter);
app.use("/api", requireAuth, clientsRouter);
app.use("/api", requireAuth, settingsRouter);
app.use("/api", requireAuth, notificationsRouter);

// Keeps a thrown/rejected handler error from taking the whole process down
// silently — same "never let a single action crash the app" philosophy as
// the render() try/catch in cyberops-task-tracker.html.
app.use((err, req, res, next) => {
  console.error("[server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("CyberOps ticketing API listening on http://localhost:" + PORT);
});

startWeeklyDigestScheduler();
startSlaBreachScheduler();