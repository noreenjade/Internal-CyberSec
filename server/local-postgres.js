/*
 * Local PostgreSQL for development — a real, embedded Postgres (compiled
 * to WASM via @electric-sql/pglite, not a mock or a sync-only in-memory
 * stand-in), exposed over the actual Postgres wire protocol via
 * @electric-sql/pglite-socket so server/db.js's ordinary `pg` client can
 * connect to it exactly as it would to Cloud SQL — same driver, same SQL,
 * same behavior, just a different connection target.
 *
 * Data persists to ./pgdata (gitignored — see .gitignore) across restarts,
 * unlike an in-memory instance. Delete that folder to reset to a fresh,
 * empty database.
 *
 * Run this in its own terminal/process BEFORE starting the app
 * (`npm run dev:db`, then in a second terminal `npm start`) — db.js
 * defaults to exactly this instance's host/port when DATABASE_URL isn't
 * set, so no other configuration is needed for local development.
 *
 * NOT for production — server/auth.js's own comments explain the real
 * Cloud SQL connection setup (DATABASE_URL or PGHOST/PGPORT/etc.) that
 * replaces this once deployed.
 */
const path = require("path");
const { PGlite } = require("@electric-sql/pglite");
const { PGLiteSocketServer } = require("@electric-sql/pglite-socket");

const PORT = Number(process.env.LOCAL_PG_PORT) || 55432;
const DATA_DIR = path.join(__dirname, "pgdata");

(async () => {
  const db = new PGlite(DATA_DIR);
  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();
  console.log("[local-postgres] Real PostgreSQL (via pglite) listening on 127.0.0.1:" + PORT + ", data persisted to " + DATA_DIR);
  console.log("[local-postgres] Leave this running, then start the app in another terminal (npm start).");
})().catch((err) => {
  console.error("[local-postgres] Failed to start:", err);
  process.exit(1);
});
