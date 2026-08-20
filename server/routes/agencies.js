/*
 * GET/PUT /api/agencies — mirrors routes/categories.js exactly, one level
 * down: the whole { NSOC: [...] } agency list is read/written as one blob.
 * Kept as its own endpoint/table (not folded into categories) so Manage
 * Categories (SOC/TI) and Manage Agencies (NSOC) can never cross-
 * contaminate each other's picklist.
 */
const express = require("express");
const db = require("../db");
const { AGENCY_TEAMS } = require("../constants");
const { asyncRoute } = require("../util");

const router = express.Router();

router.get("/agencies", asyncRoute(async (req, res) => {
  res.json(await db.getAgencies());
}));

router.put("/agencies", asyncRoute(async (req, res) => {
  const agencies = req.body;
  const valid = agencies && AGENCY_TEAMS.every((team) => Array.isArray(agencies[team]));
  if (!valid) return res.status(400).json({ error: "Body must be { NSOC: [...] }" });
  res.json(await db.replaceAgencies(agencies));
}));

module.exports = router;
