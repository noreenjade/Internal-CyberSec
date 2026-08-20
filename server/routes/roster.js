/*
 * GET/PUT /api/roster — mirrors loadRosterIfSaved()/persistRoster() in
 * cyberops-task-tracker.html_v2.html exactly: the whole { SOC, TI,
 * LEADERSHIP } roster is read/written as one blob, same as the old
 * localStorage write. No diffing — a PUT always fully replaces the
 * users table.
 */
const express = require("express");
const db = require("../db");
const { ROSTER_GROUPS } = require("../constants");
const { asyncRoute } = require("../util");

const router = express.Router();

router.get("/roster", asyncRoute(async (req, res) => {
  res.json(await db.getRoster());
}));

router.put("/roster", asyncRoute(async (req, res) => {
  const roster = req.body;
  // ROSTER_GROUPS = every team in TEAMS plus LEADERSHIP — was hardcoded to
  // exactly SOC/TI/LEADERSHIP, which would've silently rejected (or, before
  // this file even validated it, silently dropped) an NSOC roster the
  // moment NSOC became a real team.
  const valid = roster && ROSTER_GROUPS.every((group) => Array.isArray(roster[group]));
  if (!valid) return res.status(400).json({ error: "Body must be { " + ROSTER_GROUPS.join(": [...], ") + ": [...] }" });
  res.json(await db.replaceRoster(roster));
}));

module.exports = router;
