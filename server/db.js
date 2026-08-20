/*
 * PostgreSQL (node-postgres / "pg") schema + query helpers.
 *
 * Migrated from better-sqlite3/SQLite — the deployment target is Cloud SQL
 * for PostgreSQL, so every query here now goes through pg's connection
 * pool and every exported function is async (returns a Promise). Every
 * caller (routes/*.js, server/auth.js, jobs/weeklyDigestJob.js) awaits
 * these instead of calling them synchronously — that's the one behavior
 * change ripples through the whole backend, everything else (table
 * shapes, the camelCase API mapping, the SLA/pause/terminal-freeze logic
 * itself) is unchanged from the SQLite version.
 *
 * Table shapes mirror the ticket data model in cyberops-task-tracker.html
 * (see makeTicket / updateTicket / findTicket, and the comments/history/
 * roster/sla_config/categories structures used throughout that file) —
 * column-by-column mapping is noted next to each field below.
 *
 * Notable SQLite -> Postgres differences applied throughout this file:
 *   - Placeholders: SQLite's `?` (positional) and `@name` (named, a
 *     better-sqlite3-specific feature) both become Postgres's `$1, $2, ...`
 *     positional placeholders.
 *   - Epoch-millisecond columns (created_at, sla_date, paused_at, etc.) are
 *     BIGINT, not INTEGER — Postgres's INTEGER is a real 32-bit type (max
 *     ~2.1 billion) and a millisecond epoch timestamp (~1.7 trillion today)
 *     overflows it immediately. SQLite's INTEGER never had this problem
 *     (it's dynamically sized up to 8 bytes), so this is an easy thing to
 *     miss porting the schema over.
 *   - `INTEGER PRIMARY KEY AUTOINCREMENT` -> `SERIAL PRIMARY KEY`.
 *   - `PRAGMA table_info(x)` (SQLite-only introspection) -> a query against
 *     `information_schema.columns`.
 *   - `db.transaction(fn)` (better-sqlite3's synchronous transaction
 *     wrapper) -> an explicit BEGIN/COMMIT/ROLLBACK on a single checked-out
 *     client (see withTransaction() below) — Postgres transactions are
 *     inherently connection-scoped and async.
 *   - `INSERT ... ON CONFLICT(key) DO UPDATE SET value = @value` ->
 *     `... DO UPDATE SET value = EXCLUDED.value` (Postgres's upsert syntax
 *     references the proposed row via the EXCLUDED pseudo-table instead of
 *     re-binding the same parameter a second time).
 *   - is_paused / is_admin / edited stay plain INTEGER (0/1), not native
 *     BOOLEAN — every INSERT already passes a literal 1/0 from the JS side
 *     (e.g. `t.isPaused ? 1 : 0`) and every read does `!!row.is_paused`,
 *     both of which work identically either way; keeping INTEGER here
 *     minimizes the size of this migration's diff.
 */
const { Pool } = require("pg");
const {
  TEAMS,
  CATEGORY_TEAMS,
  CLIENTS,
  DEFAULT_CLIENT,
  AGENCY_TEAMS,
  ROSTER_GROUPS,
  DEFAULT_SLA_CONFIG,
  FALLBACK_PRIORITY_CONFIG,
  DEFAULT_CATEGORIES,
  DEFAULT_AGENCIES,
  SEED_USERS,
  DEFAULT_STATUS_CHANGE_NOTIFY_MODE,
  NOTIFICATION_PREF_KEYS,
  DEFAULT_NOTIFICATION_PREFS
} = require("./constants");

// Ticket-numbering base per team. The old nextTicketId() hardcoded
// `team === "SOC" ? 1000 : 2000`, which happened to work only because there
// were exactly two possible team values — this keyed map is the same
// behavior for SOC/TI, generalized so a genuinely new team wouldn't silently
// share another team's numbering sequence.
const TICKET_NUMBER_BASE = { SOC: 1000, TI: 2000 };

// Connection: DATABASE_URL (a full postgres:// connection string) wins if
// set — the usual shape for Cloud SQL reached through the Cloud SQL Auth
// Proxy or a direct host:port. Otherwise falls back to the standard
// PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE vars pg already knows how to
// read on its own, defaulting those specifically to this app's local dev
// Postgres (see server/local-postgres.js, `npm run dev:db`) so `npm start`
// works out of the box with nothing else configured. PGSSLMODE=require
// turns on SSL — leave it unset for the common Cloud SQL Auth Proxy setup
// (the proxy handles encryption itself, so the app's own connection to it
// is a plain local socket/TCP hop and doesn't need TLS on top).
const connectionConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false
    }
  : {
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT) || 55432,
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "postgres",
      database: process.env.PGDATABASE || "postgres",
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
      // local-postgres.js (pglite-socket) can only reliably handle ONE
      // connection at a time — several real concurrent connections from
      // pg's normal pool (default max: 10) cause it to reset connections
      // under load. This only applies to that local dev backend; it's
      // skipped entirely once DATABASE_URL points at a real Postgres/Cloud
      // SQL instance above, which handles normal pooling just fine.
      max: process.env.PGPOOL_MAX ? Number(process.env.PGPOOL_MAX) : 1
    };
if (process.env.DATABASE_URL && process.env.PGPOOL_MAX) connectionConfig.max = Number(process.env.PGPOOL_MAX);
const pool = new Pool(connectionConfig);
pool.on("error", (err) => {
  // A background/idle client dying (network blip, Cloud SQL failover)
  // must never crash the whole process — same "never let a side effect
  // take the app down" rule as mailer.js/auth.js elsewhere in this server.
  console.error("[db] Unexpected error on idle Postgres client:", err);
});

// Runs fn(client) inside a single BEGIN/COMMIT/ROLLBACK on one checked-out
// connection — the async equivalent of better-sqlite3's synchronous
// db.transaction(fn). fn must use the given `client` (not the pool) for
// every query it runs, or those queries would happen on a different
// connection outside the transaction entirely.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id                  TEXT PRIMARY KEY,     -- t.id, e.g. "SOC-1001"
      team                TEXT NOT NULL,        -- t.team: "SOC" | "TI" — the internal team doing the work
      title               TEXT NOT NULL,        -- t.title
      details             TEXT NOT NULL,        -- t.details ("Hunt Notes" label is TI-only UI text, same field)
      priority            TEXT NOT NULL,        -- t.priority: "Critical" | "High" | "Medium" | "Low"
      category            TEXT NOT NULL,        -- t.category
      status              TEXT NOT NULL DEFAULT 'New', -- t.status, one of STATUSES
      requested_by        TEXT NOT NULL,        -- t.requestedBy
      assignee            TEXT NOT NULL DEFAULT '', -- t.assignee (user id; '' or 'unassigned' both mean no one, same as the frontend)
      created_at          BIGINT NOT NULL,      -- t.createdAt (ms epoch)
      priority_hours      REAL NOT NULL,        -- t.priorityConfig.hours (frozen at creation, never re-derived)
      priority_color      TEXT NOT NULL,        -- t.priorityConfig.color
      priority_label      TEXT NOT NULL,        -- t.priorityConfig.label
      sla_date            BIGINT NOT NULL,      -- t.slaDate (ms epoch)
      is_paused           INTEGER NOT NULL DEFAULT 0, -- t.isPaused (0/1)
      paused_at           BIGINT,               -- t.pausedAt (ms epoch, nullable)
      total_paused_ms     BIGINT NOT NULL DEFAULT 0, -- t.totalPausedMs
      date_time_resolved  BIGINT,               -- t.dateTimeResolved (ms epoch, nullable)
      attachments         TEXT NOT NULL DEFAULT '[]', -- JSON array of {id,name,size,addedAt} — metadata only, no file storage
      client              TEXT NOT NULL DEFAULT 'Internal / N/A', -- t.client — which CLIENT the ticket is for (independent of team): "Internal / N/A" | "QC" | "NSOC"
      agency              TEXT NOT NULL DEFAULT '', -- t.agency — only meaningful when client = "NSOC" (which NSOC agency/sub-client); '' otherwise, same "just an empty string" convention as unset assignee
      rejection_reason    TEXT NOT NULL DEFAULT '', -- t.rejectionReason — only meaningful when status = "Rejected"; required at the point of rejection (frontend prompts for it), '' otherwise
      terminal_since      BIGINT,               -- t.terminalSince (ms epoch, nullable) — set when the ticket enters a terminal status (Resolved/Rejected/Canceled), cleared+consumed (credited back into sla_date) when it's reopened, so time spent closed never counts against the SLA
      unassigned_since    BIGINT,               -- t.unassignedSince (ms epoch, nullable) — set when an already-started ticket loses its assignee, cleared+consumed (credited back into sla_date) when it's reassigned, so time spent unassigned never counts against the SLA either
      sla_breach_notified_at BIGINT             -- server-only bookkeeping for jobs/slaBreachJob.js (ms epoch, nullable): set once the assignee has been emailed for the ticket's current breach, cleared once the ticket stops being overdue (resolved, frozen, or SLA credited back past now), so a later breach can alert again. Never read or written by the frontend — it just round-trips this field untouched, same as terminal_since/unassigned_since.
    );

    CREATE TABLE IF NOT EXISTS comments (
      id          TEXT PRIMARY KEY,             -- comment.id
      ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id   TEXT NOT NULL,                -- comment.authorId
      text        TEXT NOT NULL,                -- comment.text
      time        BIGINT NOT NULL,              -- comment.time (ms epoch)
      edited      INTEGER NOT NULL DEFAULT 0,   -- comment.edited (0/1)
      edited_at   BIGINT                        -- comment.editedAt (ms epoch, nullable)
    );
    CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_id);

    CREATE TABLE IF NOT EXISTS history (
      id          TEXT PRIMARY KEY,             -- history entry.id
      ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      action      TEXT NOT NULL,                -- "Created" | "Paused" | "Resumed" | "Resolved" | "Status Changed"
      time        BIGINT NOT NULL,              -- entry.time (ms epoch)
      note        TEXT,                         -- entry.note (nullable)
      duration_ms BIGINT                        -- entry.durationMs (nullable, only set on "Resumed")
    );
    CREATE INDEX IF NOT EXISTS idx_history_ticket ON history(ticket_id);

    CREATE TABLE IF NOT EXISTS users (
      id        TEXT PRIMARY KEY,               -- u.id, e.g. "u1"
      name      TEXT NOT NULL,
      role      TEXT NOT NULL,                  -- title/level label (e.g. "L1", "Sr. SE", "Practice Head")
      is_admin  INTEGER NOT NULL DEFAULT 0,      -- SUPERADMIN-style console access — separate from role, same as the frontend
      can_delete_tickets INTEGER NOT NULL DEFAULT 0, -- standalone ticket-delete permission — grantable without making someone a full Superadmin; a Superadmin can always delete regardless of this flag (see hasDeleteAccess() in tracker.html)
      email     TEXT NOT NULL,
      team      TEXT NOT NULL                   -- groupKey: "SOC" | "TI" | "LEADERSHIP"
    );

    -- Mirrors the production shape already hinted at in the HTML's own
    -- slaConfigPanelHtml footnote ("writes to sla_configs via ... sla_hours ...
    -- WHERE priority = $2 AND team_id = $3, with updated_by set ...").
    CREATE TABLE IF NOT EXISTS sla_config (
      id          SERIAL PRIMARY KEY,
      team        TEXT NOT NULL,
      priority    TEXT NOT NULL,
      hours       REAL NOT NULL,
      color       TEXT NOT NULL,
      label       TEXT NOT NULL,
      updated_by  TEXT,
      UNIQUE(team, priority)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id    SERIAL PRIMARY KEY,
      team  TEXT NOT NULL,
      name  TEXT NOT NULL,
      UNIQUE(team, name)
    );

    -- Same shape as categories, scoped by CLIENT instead of by (internal)
    -- team — "which NSOC agency/sub-client is this ticket for," only
    -- meaningful when a ticket's client = "NSOC" (see AGENCY_TEAMS, which
    -- despite the shared "TEAMS"-style name is a list of client names, not
    -- team names). Kept as its own table (not folded into categories) so the
    -- two admin panels — Manage Categories vs Manage Agencies — and their
    -- picklists can never cross-contaminate.
    CREATE TABLE IF NOT EXISTS agencies (
      id      SERIAL PRIMARY KEY,
      client  TEXT NOT NULL,
      name    TEXT NOT NULL,
      UNIQUE(client, name)
    );

    -- The Client picklist itself (previously a hardcoded CLIENTS constant,
    -- never admin-editable) — a plain flat list, unlike categories/agencies
    -- which are scoped per team/client, since there's nothing to scope
    -- Client by. Renaming/deleting here is the same "just a picklist
    -- label" contract as categories/agencies: existing tickets keep
    -- whatever client string they already had, never rewritten.
    CREATE TABLE IF NOT EXISTS clients (
      id    SERIAL PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE
    );

    -- System-wide (not per-user) app settings, key/value so future settings
    -- from the System & SLA Notifications panel can be added without another
    -- migration. Only "statusChangeNotifyMode" exists today.
    CREATE TABLE IF NOT EXISTS system_settings (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );
  `);

  // Migration: "mentions" was added to comments after some databases already
  // had the table created, so it has to be bolted on with ALTER TABLE rather
  // than folded into the CREATE TABLE IF NOT EXISTS above (which is a no-op
  // once the table already exists).
  const commentColumns = (await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'comments'"
  )).rows.map((r) => r.column_name);
  if (!commentColumns.includes("mentions")) {
    await pool.query("ALTER TABLE comments ADD COLUMN mentions TEXT NOT NULL DEFAULT ''");
  }

  // Migration: "client", "agency", "rejection_reason", "terminal_since", and
  // "unassigned_since" were each added to tickets after some databases
  // already had the table created — same bolt-on-with-ALTER-TABLE reason as
  // "mentions" above.
  const ticketColumns = (await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'tickets'"
  )).rows.map((r) => r.column_name);
  if (!ticketColumns.includes("client")) {
    await pool.query("ALTER TABLE tickets ADD COLUMN client TEXT NOT NULL DEFAULT '" + DEFAULT_CLIENT + "'");
  }
  if (!ticketColumns.includes("agency")) {
    await pool.query("ALTER TABLE tickets ADD COLUMN agency TEXT NOT NULL DEFAULT ''");
  }
  if (!ticketColumns.includes("rejection_reason")) {
    await pool.query("ALTER TABLE tickets ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!ticketColumns.includes("terminal_since")) {
    await pool.query("ALTER TABLE tickets ADD COLUMN terminal_since BIGINT");
  }
  if (!ticketColumns.includes("unassigned_since")) {
    await pool.query("ALTER TABLE tickets ADD COLUMN unassigned_since BIGINT");
  }
  if (!ticketColumns.includes("sla_breach_notified_at")) {
    await pool.query("ALTER TABLE tickets ADD COLUMN sla_breach_notified_at BIGINT");
  }

  // Migration: "can_delete_tickets" was added to users after some databases
  // already had the table created — same bolt-on reason as above.
  const userColumns = (await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
  )).rows.map((r) => r.column_name);
  if (!userColumns.includes("can_delete_tickets")) {
    await pool.query("ALTER TABLE users ADD COLUMN can_delete_tickets INTEGER NOT NULL DEFAULT 0");
  }

  // One-time data fix for the "SLA only counts once assigned" change: tickets
  // created before this shipped used sla_date = created_at + priority_hours
  // regardless of assignee, so an unassigned ticket could already show as
  // Overdue the moment it was filed. Reset those back to the "not started"
  // sentinel (0) — but ONLY tickets created before SLA_GATE_CUTOVER (the
  // moment this fix shipped) that are currently still unassigned. The cutover
  // timestamp, not "is currently unassigned" alone, is what makes this safe to
  // leave running on every startup: a ticket created AFTER the cutover was
  // already subject to the new create/assign logic from day one, so even if
  // it's unassigned again later after having legitimately started its clock
  // (assign -> unassign, which keeps running per policy), it's never swept up
  // here — only the old backlog this migration exists for is ever touched.
  const SLA_GATE_CUTOVER = 1786731960969; // Date.now() at the moment this fix shipped
  await pool.query(
    "UPDATE tickets SET sla_date = 0 WHERE (assignee IS NULL OR assignee = '') AND created_at < $1",
    [SLA_GATE_CUTOVER]
  );
}

// ---------------------------------------------------------------------------
// Seed reference/config tables on first run only — never overwrites data an
// admin may have already edited via whatever eventually manages these
// tables. Ticket/comment/history data is intentionally NOT seeded here;
// those start empty and are only ever created through the API.
//
// Backfilled PER TEAM/GROUP, not gated on "is the whole table empty" — an
// all-or-nothing gate meant that adding a brand-new team (NSOC) to a DB
// that already had SOC/TI data seeded long ago would silently skip seeding
// anything for it at all (userCount/slaCount were already > 0), leaving
// NSOC with an empty roster and an empty SLA config forever. Checking each
// team/group's own row count means an already-seeded team is left alone
// (its count is already > 0) while a newly-added team still gets seeded.
// ---------------------------------------------------------------------------
async function seedIfEmpty() {
  for (const group of ROSTER_GROUPS) {
    const count = Number((await pool.query("SELECT COUNT(*) AS c FROM users WHERE team = $1", [group])).rows[0].c);
    if (count === 0) {
      const groupSeedUsers = SEED_USERS.filter((u) => u.team === group);
      await withTransaction(async (client) => {
        for (const u of groupSeedUsers) {
          await client.query(
            "INSERT INTO users (id, name, role, is_admin, email, team) VALUES ($1, $2, $3, $4, $5, $6)",
            [u.id, u.name, u.role, u.isAdmin ? 1 : 0, u.email, u.team]
          );
        }
      });
    }
  }

  for (const team of TEAMS) {
    const count = Number((await pool.query("SELECT COUNT(*) AS c FROM sla_config WHERE team = $1", [team])).rows[0].c);
    if (count === 0) {
      await withTransaction(async (client) => {
        for (const priority of Object.keys(DEFAULT_SLA_CONFIG[team])) {
          const cfg = DEFAULT_SLA_CONFIG[team][priority];
          await client.query(
            "INSERT INTO sla_config (team, priority, hours, color, label, updated_by) VALUES ($1, $2, $3, $4, $5, NULL)",
            [team, priority, cfg.hours, cfg.color, cfg.label]
          );
        }
      });
    }
  }

  for (const team of CATEGORY_TEAMS) {
    const count = Number((await pool.query("SELECT COUNT(*) AS c FROM categories WHERE team = $1", [team])).rows[0].c);
    if (count === 0) {
      await withTransaction(async (client) => {
        for (const name of DEFAULT_CATEGORIES[team]) {
          await client.query("INSERT INTO categories (team, name) VALUES ($1, $2)", [team, name]);
        }
      });
    }
  }

  for (const clientName of AGENCY_TEAMS) {
    const count = Number((await pool.query("SELECT COUNT(*) AS c FROM agencies WHERE client = $1", [clientName])).rows[0].c);
    if (count === 0) {
      await withTransaction(async (client) => {
        for (const name of DEFAULT_AGENCIES[clientName]) {
          await client.query("INSERT INTO agencies (client, name) VALUES ($1, $2)", [clientName, name]);
        }
      });
    }
  }

  const clientsCount = Number((await pool.query("SELECT COUNT(*) AS c FROM clients")).rows[0].c);
  if (clientsCount === 0) {
    await withTransaction(async (client) => {
      for (const name of CLIENTS) {
        await client.query("INSERT INTO clients (name) VALUES ($1)", [name]);
      }
    });
  }

  const hasNotifyMode = (await pool.query("SELECT 1 FROM system_settings WHERE key = $1", ["statusChangeNotifyMode"])).rowCount > 0;
  if (!hasNotifyMode) {
    await pool.query("INSERT INTO system_settings (key, value) VALUES ($1, $2)", ["statusChangeNotifyMode", DEFAULT_STATUS_CHANGE_NOTIFY_MODE]);
  }

  for (const key of NOTIFICATION_PREF_KEYS) {
    const exists = (await pool.query("SELECT 1 FROM system_settings WHERE key = $1", [key])).rowCount > 0;
    if (!exists) {
      await pool.query("INSERT INTO system_settings (key, value) VALUES ($1, $2)", [key, DEFAULT_NOTIFICATION_PREFS[key] ? "true" : "false"]);
    }
  }
}

// Resolved once at require-time and awaited by every exported function
// below (see the `await ready;` at the top of each) — callers never need
// to know initialization happens asynchronously; the first real query
// just waits for schema+seed to finish if it hasn't already.
const ready = (async () => {
  await initSchema();
  await seedIfEmpty();
})();

// ---------------------------------------------------------------------------
// Row <-> API shape mapping. The API deliberately returns the exact same
// camelCase field names/nesting the frontend's ticket objects already use
// (priorityConfig as a nested object, history/comments as arrays), so it's
// a drop-in match if/when the HTML is later wired up to this backend.
// ---------------------------------------------------------------------------
function ticketRowToApiShape(row, history, comments) {
  return {
    id: row.id,
    team: row.team,
    title: row.title,
    details: row.details,
    priority: row.priority,
    category: row.category,
    client: row.client,
    agency: row.agency,
    status: row.status,
    requestedBy: row.requested_by,
    assignee: row.assignee,
    createdAt: Number(row.created_at),
    priorityConfig: { hours: row.priority_hours, color: row.priority_color, label: row.priority_label },
    slaDate: Number(row.sla_date),
    isPaused: !!row.is_paused,
    pausedAt: row.paused_at != null ? Number(row.paused_at) : null,
    totalPausedMs: Number(row.total_paused_ms),
    dateTimeResolved: row.date_time_resolved != null ? Number(row.date_time_resolved) : null,
    rejectionReason: row.rejection_reason || "",
    terminalSince: row.terminal_since != null ? Number(row.terminal_since) : null,
    unassignedSince: row.unassigned_since != null ? Number(row.unassigned_since) : null,
    slaBreachNotifiedAt: row.sla_breach_notified_at != null ? Number(row.sla_breach_notified_at) : null,
    attachments: JSON.parse(row.attachments || "[]"),
    history: history || [],
    comments: comments || []
  };
}

function commentRowToApiShape(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorId: row.author_id,
    text: row.text,
    time: Number(row.time),
    edited: !!row.edited,
    editedAt: row.edited_at != null ? Number(row.edited_at) : null,
    mentions: row.mentions ? row.mentions.split(",").filter(Boolean) : []
  };
}

function historyRowToApiShape(row) {
  return { id: row.id, action: row.action, time: Number(row.time), note: row.note, durationMs: row.duration_ms != null ? Number(row.duration_ms) : null };
}

async function getHistoryForTicket(ticketId) {
  await ready;
  const rows = (await pool.query("SELECT * FROM history WHERE ticket_id = $1 ORDER BY time ASC", [ticketId])).rows;
  return rows.map(historyRowToApiShape);
}

async function getCommentsForTicket(ticketId) {
  await ready;
  const rows = (await pool.query("SELECT * FROM comments WHERE ticket_id = $1 ORDER BY time ASC", [ticketId])).rows;
  return rows.map(commentRowToApiShape);
}

// Fetches every ticket's history/comments in two queries total (WHERE
// ticket_id = ANY($1)), not one query per ticket — the same N tickets that
// used to mean 2N+1 synchronous SQLite calls would otherwise mean 2N
// separate network round-trips to Postgres, which adds up fast once this
// is a real hosted Cloud SQL instance instead of a local file.
async function getAllTickets({ team } = {}) {
  await ready;
  const ticketRows = team
    ? (await pool.query("SELECT * FROM tickets WHERE team = $1 ORDER BY created_at DESC", [team])).rows
    : (await pool.query("SELECT * FROM tickets ORDER BY created_at DESC")).rows;
  if (ticketRows.length === 0) return [];

  const ids = ticketRows.map((r) => r.id);
  const [historyRows, commentRows] = await Promise.all([
    pool.query("SELECT * FROM history WHERE ticket_id = ANY($1) ORDER BY time ASC", [ids]),
    pool.query("SELECT * FROM comments WHERE ticket_id = ANY($1) ORDER BY time ASC", [ids])
  ]);

  const historyByTicket = {};
  historyRows.rows.forEach((r) => {
    (historyByTicket[r.ticket_id] = historyByTicket[r.ticket_id] || []).push(historyRowToApiShape(r));
  });
  const commentsByTicket = {};
  commentRows.rows.forEach((r) => {
    (commentsByTicket[r.ticket_id] = commentsByTicket[r.ticket_id] || []).push(commentRowToApiShape(r));
  });

  return ticketRows.map((row) => ticketRowToApiShape(row, historyByTicket[row.id], commentsByTicket[row.id]));
}

async function getTicketById(id) {
  await ready;
  const row = (await pool.query("SELECT * FROM tickets WHERE id = $1", [id])).rows[0];
  if (!row) return null;
  const [history, comments] = await Promise.all([getHistoryForTicket(id), getCommentsForTicket(id)]);
  return ticketRowToApiShape(row, history, comments);
}

// Same numbering scheme as submitCreateTicket() in the HTML: highest
// existing "<TEAM>-<n>" for that team, plus one, starting at TICKET_NUMBER_
// BASE[team]+1 when the team has no tickets yet.
async function nextTicketId(team) {
  await ready;
  const rows = (await pool.query("SELECT id FROM tickets WHERE team = $1", [team])).rows;
  const nums = rows
    .map((r) => parseInt(String(r.id).split("-")[1], 10))
    .filter((n) => !Number.isNaN(n));
  const base = nums.length ? Math.max(...nums) : (TICKET_NUMBER_BASE[team] || 1000);
  return team + "-" + (base + 1);
}

async function getSlaConfigFor(team, priority) {
  await ready;
  const row = (await pool.query("SELECT hours, color, label FROM sla_config WHERE team = $1 AND priority = $2", [team, priority])).rows[0];
  return row || FALLBACK_PRIORITY_CONFIG;
}

async function getCategoriesFor(team) {
  await ready;
  return (await pool.query("SELECT name FROM categories WHERE team = $1 ORDER BY id ASC", [team])).rows.map((r) => r.name);
}

// Scoped by CLIENT ("NSOC"), not by the ticket's internal team — a SOC or a
// TI ticket can equally have client = "NSOC" and its own agency.
async function getAgenciesFor(client) {
  await ready;
  return (await pool.query("SELECT name FROM agencies WHERE client = $1 ORDER BY id ASC", [client])).rows.map((r) => r.name);
}

async function getUserById(id) {
  await ready;
  return (await pool.query("SELECT * FROM users WHERE id = $1", [id])).rows[0] || null;
}

// Case-insensitive — Google's verified email in the ID token and whatever
// case the roster's email column happens to be saved in should never fail
// to match just because of casing. Used by the Google Sign-In callback to
// map an authenticated account to its roster identity (see server/auth.js).
async function getUserByEmail(email) {
  await ready;
  if (!email) return null;
  return (await pool.query("SELECT * FROM users WHERE lower(email) = lower($1)", [email])).rows[0] || null;
}

// Flat {id, name} list for @mention matching against comment text — every
// team at once, since a mention isn't scoped to the ticket's own team.
async function getAllUsers() {
  await ready;
  return (await pool.query("SELECT id, name, email FROM users")).rows;
}

async function insertTicket(ticket) {
  await ready;
  const t = Object.assign({ client: DEFAULT_CLIENT, agency: "" }, ticket);
  await pool.query(
    `INSERT INTO tickets (
      id, team, title, details, priority, category, client, agency, status, requested_by, assignee,
      created_at, priority_hours, priority_color, priority_label, sla_date,
      is_paused, paused_at, total_paused_ms, date_time_resolved, attachments, rejection_reason, terminal_since, unassigned_since, sla_breach_notified_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16,
      0, NULL, 0, NULL, '[]', '', NULL, NULL, NULL
    )`,
    [
      t.id, t.team, t.title, t.details, t.priority, t.category, t.client, t.agency, t.status, t.requestedBy, t.assignee,
      t.createdAt, t.priorityHours, t.priorityColor, t.priorityLabel, t.slaDate
    ]
  );
}

async function insertHistory(entry) {
  await ready;
  await pool.query(
    "INSERT INTO history (id, ticket_id, action, time, note, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)",
    [entry.id, entry.ticketId, entry.action, entry.time, entry.note || null, entry.durationMs != null ? entry.durationMs : null]
  );
}

async function insertComment(entry) {
  await ready;
  await pool.query(
    "INSERT INTO comments (id, ticket_id, author_id, text, time, edited, edited_at, mentions) VALUES ($1, $2, $3, $4, $5, 0, NULL, $6)",
    [entry.id, entry.ticketId, entry.authorId, entry.text, entry.time, (entry.mentions || []).join(",")]
  );
  // Returned pre-shaped (camelCase, BIGINT columns coerced to real numbers)
  // rather than the raw row — pg returns BIGINT columns (time, edited_at)
  // as strings by default to avoid precision loss past Number.MAX_SAFE_
  // INTEGER, which the caller (routes/tickets.js's POST /comments handler)
  // would otherwise silently hand to the frontend as "1786815006829"
  // instead of 1786815006829.
  const row = (await pool.query("SELECT * FROM comments WHERE id = $1", [entry.id])).rows[0];
  return commentRowToApiShape(row);
}

// Partial update — same "shallow merge whatever keys are present" contract
// as updateTicket(id, patch) in the HTML. Only known, whitelisted columns
// are ever written; anything else in the patch body is silently ignored
// rather than causing a SQL error.
const PATCHABLE_FIELDS = {
  title: "title",
  details: "details",
  priority: "priority",
  category: "category",
  client: "client",
  agency: "agency",
  status: "status",
  requestedBy: "requested_by",
  assignee: "assignee",
  isPaused: "is_paused",
  pausedAt: "paused_at",
  totalPausedMs: "total_paused_ms",
  dateTimeResolved: "date_time_resolved",
  slaDate: "sla_date",
  rejectionReason: "rejection_reason",
  terminalSince: "terminal_since",
  unassignedSince: "unassigned_since",
  slaBreachNotifiedAt: "sla_breach_notified_at"
};

async function patchTicket(id, patch) {
  await ready;
  const sets = [];
  const values = [];
  Object.keys(patch).forEach((key) => {
    const column = PATCHABLE_FIELDS[key];
    if (!column) return; // unknown/unpatchable field — ignored, not an error
    let value = patch[key];
    if (key === "isPaused") value = value ? 1 : 0;
    values.push(value);
    sets.push(column + " = $" + values.length);
  });
  if (sets.length === 0) return getTicketById(id);
  values.push(id);
  await pool.query("UPDATE tickets SET " + sets.join(", ") + " WHERE id = $" + values.length, values);
  return getTicketById(id);
}

async function updateTicketAttachments(id, attachments) {
  await ready;
  await pool.query("UPDATE tickets SET attachments = $1 WHERE id = $2", [JSON.stringify(attachments), id]);
}

// Deleting a ticket cascades to its comments and history rows via the
// ON DELETE CASCADE foreign keys, so a single DELETE here is enough to
// avoid orphaned rows.
async function deleteTicket(id) {
  await ready;
  const result = await pool.query("DELETE FROM tickets WHERE id = $1", [id]);
  return result.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Bulk "replace everything" operations — mirrors persistTickets() in
// cyberops-task-tracker.html, which dumps the FULL current in-memory
// tickets array on every render, no client-side diffing. Each of these is
// a wholesale delete + reinsert in one transaction, so the table always
// matches whatever the browser's in-memory state currently is.
// ---------------------------------------------------------------------------

// Replaces the entire tickets (+ history + comments) tables with the given
// array in one transaction. Diffs against the pre-replace snapshot first so
// the route layer can fire "new ticket assigned" / "status changed" emails
// — that diff has to happen here, before the old rows are gone.
async function replaceAllTickets(tickets) {
  await ready;
  const previous = {};
  (await pool.query("SELECT id, status, assignee FROM tickets")).rows.forEach((r) => {
    previous[r.id] = { status: r.status, assignee: r.assignee };
  });

  await withTransaction(async (client) => {
    await client.query("DELETE FROM tickets"); // cascades to history/comments (ON DELETE CASCADE)
    for (const t of tickets) {
      const cfg = t.priorityConfig || FALLBACK_PRIORITY_CONFIG;
      await client.query(
        `INSERT INTO tickets (
          id, team, title, details, priority, category, client, agency, status, requested_by, assignee,
          created_at, priority_hours, priority_color, priority_label, sla_date,
          is_paused, paused_at, total_paused_ms, date_time_resolved, attachments, rejection_reason, terminal_since, unassigned_since, sla_breach_notified_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25
        )`,
        [
          t.id, t.team, t.title, t.details, t.priority, t.category, t.client || DEFAULT_CLIENT, t.agency || "", t.status, t.requestedBy, t.assignee || "",
          t.createdAt, cfg.hours, cfg.color, cfg.label, t.slaDate,
          t.isPaused ? 1 : 0, t.pausedAt != null ? t.pausedAt : null, t.totalPausedMs || 0, t.dateTimeResolved != null ? t.dateTimeResolved : null,
          JSON.stringify(t.attachments || []), t.rejectionReason || "", t.terminalSince != null ? t.terminalSince : null, t.unassignedSince != null ? t.unassignedSince : null,
          t.slaBreachNotifiedAt != null ? t.slaBreachNotifiedAt : null
        ]
      );
      for (const h of (t.history || [])) {
        await client.query(
          "INSERT INTO history (id, ticket_id, action, time, note, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)",
          [h.id, t.id, h.action, h.time, h.note || null, h.durationMs != null ? h.durationMs : null]
        );
      }
      for (const c of (t.comments || [])) {
        await client.query(
          "INSERT INTO comments (id, ticket_id, author_id, text, time, edited, edited_at, mentions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [c.id, t.id, c.authorId, c.text, c.time, c.edited ? 1 : 0, c.editedAt != null ? c.editedAt : null, (c.mentions || []).join(",")]
        );
      }
    }
  });

  // status and assignee are independent axes of change — a single replace
  // can flip both at once (e.g. reassign AND resolve in the same save), so
  // these are two separate `if`s, not an else-if chain, or the second event
  // would silently get dropped whenever both changed together.
  const events = { created: [], statusChanged: [], assigneeChanged: [] };
  tickets.forEach((t) => {
    const prev = previous[t.id];
    if (!prev) { events.created.push(t); return; }
    if (prev.status !== t.status) events.statusChanged.push({ ticket: t, oldStatus: prev.status });
    if (prev.assignee !== t.assignee) events.assigneeChanged.push({ ticket: t, oldAssignee: prev.assignee });
  });

  return { tickets: await getAllTickets(), events };
}

// ROSTER_GROUPS (every team in TEAMS, plus "LEADERSHIP") drives both the
// shape this returns and what replaceRoster() below accepts.
async function getRoster() {
  await ready;
  const rows = (await pool.query("SELECT id, name, role, is_admin, can_delete_tickets, email, team FROM users")).rows;
  const roster = {};
  ROSTER_GROUPS.forEach((group) => { roster[group] = []; });
  rows.forEach((r) => {
    const group = roster[r.team] || roster[ROSTER_GROUPS[0]];
    group.push({ id: r.id, name: r.name, role: r.role, isAdmin: !!r.is_admin, canDeleteTickets: !!r.can_delete_tickets, email: r.email });
  });
  return roster;
}

async function replaceRoster(roster) {
  await ready;
  await withTransaction(async (client) => {
    await client.query("DELETE FROM users");
    for (const group of ROSTER_GROUPS) {
      for (const u of (roster[group] || [])) {
        await client.query(
          "INSERT INTO users (id, name, role, is_admin, can_delete_tickets, email, team) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [u.id, u.name, u.role, u.isAdmin ? 1 : 0, u.canDeleteTickets ? 1 : 0, u.email, group]
        );
      }
    }
  });
  return getRoster();
}

async function getSlaConfig() {
  await ready;
  const rows = (await pool.query("SELECT team, priority, hours, color, label FROM sla_config")).rows;
  const cfg = {};
  TEAMS.forEach((team) => { cfg[team] = {}; });
  rows.forEach((r) => { if (cfg[r.team]) cfg[r.team][r.priority] = { hours: r.hours, color: r.color, label: r.label }; });
  return cfg;
}

async function replaceSlaConfig(config, updatedBy) {
  await ready;
  await withTransaction(async (client) => {
    await client.query("DELETE FROM sla_config");
    for (const team of TEAMS) {
      for (const priority of Object.keys(config[team] || {})) {
        const c = config[team][priority];
        await client.query(
          "INSERT INTO sla_config (team, priority, hours, color, label, updated_by) VALUES ($1, $2, $3, $4, $5, $6)",
          [team, priority, c.hours, c.color, c.label, updatedBy || null]
        );
      }
    }
  });
  return getSlaConfig();
}

async function getCategories() {
  await ready;
  const rows = (await pool.query("SELECT team, name FROM categories ORDER BY id ASC")).rows;
  const cats = {};
  CATEGORY_TEAMS.forEach((team) => { cats[team] = []; });
  rows.forEach((r) => { (cats[r.team] || cats[CATEGORY_TEAMS[0]]).push(r.name); });
  return cats;
}

// Gates the generic status-change email in routes/tickets.js — see
// STATUS_CHANGE_NOTIFY_MODES in constants.js for what the two values mean.
async function getStatusChangeNotifyMode() {
  await ready;
  const row = (await pool.query("SELECT value FROM system_settings WHERE key = $1", ["statusChangeNotifyMode"])).rows[0];
  return row ? row.value : DEFAULT_STATUS_CHANGE_NOTIFY_MODE;
}

async function setStatusChangeNotifyMode(mode) {
  await ready;
  await pool.query(
    "INSERT INTO system_settings (key, value) VALUES ('statusChangeNotifyMode', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [mode]
  );
  return getStatusChangeNotifyMode();
}

// The four System & SLA Notifications toggles. Falls back to
// DEFAULT_NOTIFICATION_PREFS per-key (not just on a totally empty table) so
// a key added to NOTIFICATION_PREF_KEYS after this DB was first created
// still reads a sane default instead of undefined until the next seed runs.
async function getNotificationPrefs() {
  await ready;
  const rows = (await pool.query(
    `SELECT key, value FROM system_settings WHERE key = ANY($1)`,
    [NOTIFICATION_PREF_KEYS]
  )).rows;
  const byKey = {};
  rows.forEach((r) => { byKey[r.key] = r.value; });
  const prefs = {};
  NOTIFICATION_PREF_KEYS.forEach((key) => {
    prefs[key] = byKey[key] != null ? byKey[key] === "true" : DEFAULT_NOTIFICATION_PREFS[key];
  });
  return prefs;
}

async function setNotificationPref(key, value) {
  await ready;
  await pool.query(
    "INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value ? "true" : "false"]
  );
  return getNotificationPrefs();
}

// Persisted (not in-memory) dedup marker for the weekly digest job
// (server/jobs/weeklyDigestJob.js) — surviving a server restart matters
// here, since a restart landing inside the same Monday-morning window must
// not cause a second send. Returns null if the digest has never gone out.
async function getWeeklyDigestLastSentAt() {
  await ready;
  const row = (await pool.query("SELECT value FROM system_settings WHERE key = $1", ["weeklyDigestLastSentAt"])).rows[0];
  return row ? Number(row.value) : null;
}

async function setWeeklyDigestLastSentAt(timestamp) {
  await ready;
  await pool.query(
    "INSERT INTO system_settings (key, value) VALUES ('weeklyDigestLastSentAt', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [String(timestamp)]
  );
}

async function replaceCategories(categories) {
  await ready;
  await withTransaction(async (client) => {
    await client.query("DELETE FROM categories");
    for (const team of CATEGORY_TEAMS) {
      for (const name of (categories[team] || [])) {
        await client.query("INSERT INTO categories (team, name) VALUES ($1, $2)", [team, name]);
      }
    }
  });
  return getCategories();
}

async function getAgencies() {
  await ready;
  const rows = (await pool.query("SELECT client, name FROM agencies ORDER BY id ASC")).rows;
  const agencies = {};
  AGENCY_TEAMS.forEach((client) => { agencies[client] = []; });
  rows.forEach((r) => { (agencies[r.client] || agencies[AGENCY_TEAMS[0]]).push(r.name); });
  return agencies;
}

async function replaceAgencies(agencies) {
  await ready;
  await withTransaction(async (client) => {
    await client.query("DELETE FROM agencies");
    for (const clientName of AGENCY_TEAMS) {
      for (const name of (agencies[clientName] || [])) {
        await client.query("INSERT INTO agencies (client, name) VALUES ($1, $2)", [clientName, name]);
      }
    }
  });
  return getAgencies();
}

// Flat list, unlike getCategories()/getAgencies() — Client has no
// team/client scoping of its own to group by.
async function getClients() {
  await ready;
  const rows = (await pool.query("SELECT name FROM clients ORDER BY id ASC")).rows;
  return rows.map((r) => r.name);
}

async function replaceClients(clients) {
  await ready;
  await withTransaction(async (client) => {
    await client.query("DELETE FROM clients");
    for (const name of clients) {
      await client.query("INSERT INTO clients (name) VALUES ($1)", [name]);
    }
  });
  return getClients();
}

module.exports = {
  pool,
  ready,
  getAllTickets,
  getTicketById,
  nextTicketId,
  getSlaConfigFor,
  getCategoriesFor,
  getAgenciesFor,
  getUserById,
  getUserByEmail,
  getAllUsers,
  insertTicket,
  insertHistory,
  insertComment,
  patchTicket,
  updateTicketAttachments,
  deleteTicket,
  replaceAllTickets,
  getRoster,
  replaceRoster,
  getSlaConfig,
  replaceSlaConfig,
  getCategories,
  replaceCategories,
  getAgencies,
  replaceAgencies,
  getClients,
  replaceClients,
  getStatusChangeNotifyMode,
  setStatusChangeNotifyMode,
  getNotificationPrefs,
  setNotificationPref,
  getWeeklyDigestLastSentAt,
  setWeeklyDigestLastSentAt
};
