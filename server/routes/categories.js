/*
 * GET/PUT /api/categories — mirrors loadCategoriesIfSaved()/
 * persistCategories() in cyberops-task-tracker.html_v2.html: the whole
 * { SOC: [...], TI: [...] } category list is read/written as one blob,
 * matching the old localStorage write.
 */
const express = require("express");
const db = require("../db");
const { CATEGORY_TEAMS } = require("../constants");
const { asyncRoute } = require("../util");

const router = express.Router();

router.get("/categories", asyncRoute(async (req, res) => {
  res.json(await db.getCategories());
}));

router.put("/categories", asyncRoute(async (req, res) => {
  const categories = req.body;
  // CATEGORY_TEAMS (currently just SOC/TI), not the full TEAMS list — NSOC
  // uses the separate Agency picklist (see routes/agencies.js) and was
  // never meant to need a categories.NSOC key. Validating against the full
  // TEAMS list here would reject every existing SOC/TI-only PUT the moment
  // NSOC became a valid team.
  const valid = categories && CATEGORY_TEAMS.every((team) => Array.isArray(categories[team]));
  if (!valid) return res.status(400).json({ error: "Body must be { SOC: [...], TI: [...] }" });
  res.json(await db.replaceCategories(categories));
}));

module.exports = router;
