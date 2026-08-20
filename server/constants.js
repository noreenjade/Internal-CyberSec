/*
 * Shared seed data + validation lists, mirrored 1:1 from the DATA section of
 * cyberops-task-tracker.html (STATUSES, DEFAULT_SLA_CONFIG, CATEGORIES,
 * USERS/LEADERSHIP). Kept here as the single source of truth for db.js
 * (seeding) and routes/tickets.js (validation) so the two never drift.
 */

// Same 5-status model as the frontend. "Paused" is not a status there
// either — it's the isPaused/pausedAt flag layered on top of any of these.
const STATUSES = ["New", "In Progress", "Canceled", "Resolved", "Rejected"];
const TERMINAL_STATUSES = ["Canceled", "Resolved", "Rejected"];
const PRIORITIES = ["Critical", "High", "Medium", "Low"];
// The two internal teams — who actually does the work. NSOC/QC are NOT
// teams (see CLIENTS below) — an earlier pass briefly added "NSOC" as a
// 3rd team before that was corrected; TEAMS stays exactly the original two.
const TEAMS = ["SOC", "TI"];
// CATEGORY_TEAMS mirrors TEAMS 1:1 today (Category applies the same way to
// every internal team) — kept as its own named constant, rather than
// inlining TEAMS directly in routes/categories.js and db.js's category
// functions, so those call sites read as "the teams that use Category"
// rather than "all teams," in case the two ever need to diverge again.
const CATEGORY_TEAMS = ["SOC", "TI"];
// Which CLIENT a ticket is for — independent of which internal team (SOC or
// TI) is doing the work. "NSOC" is the one client with its own Agency
// picklist (see AGENCY_TEAMS below, which is scoped by client, not team,
// despite the shared "TEAMS"-style constant name/shape for consistency with
// how CATEGORY_TEAMS scopes the Category picklist).
const CLIENTS = ["Internal / N/A", "QC", "NSOC"];
const DEFAULT_CLIENT = "Internal / N/A";
// Which client(s) have an Agency picklist (Manage Agencies admin panel) —
// only NSOC does. Not team-scoped at all; this key is a client name.
const AGENCY_TEAMS = ["NSOC"];
// Roster groups — every internal team plus LEADERSHIP, which sits above
// both teams.
const ROSTER_GROUPS = TEAMS.concat(["LEADERSHIP"]);

// Gates the generic "ticket status changed" email in routes/tickets.js.
// "always" is the old unconditional-email behavior; "assignment_only" skips
// that email for plain status transitions (New -> In Progress, etc.) and
// leaves assignment-triggered emails (new ticket assigned / reassigned)
// alone, since those are a separate code path this setting doesn't touch.
const STATUS_CHANGE_NOTIFY_MODES = ["always", "assignment_only"];
const DEFAULT_STATUS_CHANGE_NOTIFY_MODE = "assignment_only";

// The four toggles on the System & SLA Notifications panel. slaBreach and
// weeklyDigest are persisted here (so the UI is real, not a preview) but
// nothing reads them yet — both need a scheduled backend job that doesn't
// exist yet (see notifyAssignmentChange() in routes/tickets.js for the two
// that ARE wired up: newAssignment / reassignment, both event-triggered off
// existing ticket-create/patch/replace code paths).
const NOTIFICATION_PREF_KEYS = ["slaBreach", "newAssignment", "reassignment", "weeklyDigest"];
const DEFAULT_NOTIFICATION_PREFS = { slaBreach: true, newAssignment: true, reassignment: true, weeklyDigest: false };

// Matches DEFAULT_SLA_CONFIG in the HTML exactly (same hours/color/label for
// both teams out of the box — an admin can diverge them later via whatever
// admin endpoint eventually wraps the sla_config table).
const DEFAULT_SLA_CONFIG = {
  SOC: {
    Critical: { hours: 2, color: "#8B5CF6", label: "Violet" },
    High: { hours: 4, color: "#F97316", label: "Orange" },
    Medium: { hours: 8, color: "#EF4444", label: "Red" },
    Low: { hours: 24, color: "#EAB308", label: "Yellow" }
  },
  TI: {
    Critical: { hours: 2, color: "#8B5CF6", label: "Violet" },
    High: { hours: 4, color: "#F97316", label: "Orange" },
    Medium: { hours: 8, color: "#EF4444", label: "Red" },
    Low: { hours: 24, color: "#EAB308", label: "Yellow" }
  }
};

// makeTicket()'s own fallback in the HTML when a priority/team lookup
// misses — kept identical here so a ticket created before its sla_config
// row exists still gets a sane SLA instead of failing.
const FALLBACK_PRIORITY_CONFIG = { hours: 8, color: "#EF4444", label: "Red" };

// Matches the CATEGORIES seed literal in the HTML (the coded default, not
// whatever a given browser's localStorage may have drifted to since — the
// server has no visibility into that anyway).
const DEFAULT_CATEGORIES = {
  SOC: ["Rule Development", "Whitelisting", "Playbook/Automation", "Documentation", "Rule Finetuning", "Feed Configuration", "Dashboard Development", "Shift Handover / Administrative"],
  TI: ["Incident Response", "Internal Security", "Threat Hunt", "Queries", "User Security Reporting", "IoC Enrichment & Feeds", "Threat Briefing / Advisory"]
};

// When a ticket's Client is "NSOC", it additionally picks an Agency (which
// NSOC sub-client/agency it's for) — independent of Category, and
// independent of which internal team (SOC/TI) is doing the work. This seed
// list is intentionally small; real NSOC agency lists are expected to grow
// to 100+ via Manage Agencies, which is exactly why the ticket-facing
// picker is a searchable combobox rather than a plain <select> dropdown.
const DEFAULT_AGENCIES = {
  NSOC: [
    "Department of Finance", "Department of Education", "Department of Health",
    "City Water Authority", "Metro Transit Authority", "State Revenue Office",
    "Regional Housing Board", "Public Records Office", "County Sheriff's Office",
    "Municipal Utilities Commission", "State Employment Agency", "Bureau of Licensing"
  ]
};

// Matches USERS.SOC / USERS.TI / LEADERSHIP in the HTML, flattened into one
// list with a `team` discriminator ("SOC" | "TI" | "LEADERSHIP") — same
// shape findUserLocation()/groupArrayFor() work with client-side.
const SEED_USERS = [
  { id: "u1", name: "Noreen Jade Lozano", role: "SE", isAdmin: true, email: "noreen.lozano@maroonstudios.com", team: "SOC" },
  { id: "u2", name: "Alvin Jarek Gonzales", role: "L2", isAdmin: false, email: "agonzales@company.com", team: "SOC" },
  { id: "u3", name: "Andre Val Consorte", role: "Sr. SE", isAdmin: true, email: "aconsorte@company.com", team: "SOC" },
  { id: "u4", name: "Rhea Lorenzana", role: "L1", isAdmin: false, email: "rlorenzana@company.com", team: "SOC" },
  { id: "u5", name: "Gabriel Jethro Anunciacion", role: "L1", isAdmin: false, email: "ganunciacion@company.com", team: "SOC" },
  { id: "u6", name: "Miguel Luayon", role: "L1", isAdmin: false, email: "mluayon@company.com", team: "TI" },
  { id: "u7", name: "Rod Valdez", role: "SE", isAdmin: true, email: "rvaldez@company.com", team: "TI" },
  { id: "u8", name: "Jeshrine Zoe Nogar", role: "SE", isAdmin: false, email: "jnogar@company.com", team: "TI" },
  { id: "u9", name: "Alessander Vill Mondero", role: "L1", isAdmin: false, email: "amondero@company.com", team: "TI" },
  { id: "u10", name: "Jason Obrero", role: "Practice Head", isAdmin: true, email: "jobrero@company.com", team: "LEADERSHIP" }
];

module.exports = {
  STATUSES,
  TERMINAL_STATUSES,
  PRIORITIES,
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
  STATUS_CHANGE_NOTIFY_MODES,
  DEFAULT_STATUS_CHANGE_NOTIFY_MODE,
  NOTIFICATION_PREF_KEYS,
  DEFAULT_NOTIFICATION_PREFS
};
