/*
 * GET/PUT /api/sla-config — mirrors loadSlaConfig()/persistSlaConfig() in
 * cyberops-task-tracker.html_v2.html: the whole { SOC: {...}, TI: {...} }
 * config is read/written as one blob, matching the old localStorage write.
 */
const express = require("express");
const db = require("../db");
const { TEAMS } = require("../constants");
const { asyncRoute } = require("../util");

const router = express.Router();

router.get("/sla-config", asyncRoute(async (req, res) => {
  res.json(await db.getSlaConfig());
}));

router.put("/sla-config", asyncRoute(async (req, res) => {
  const config = req.body;
  const valid = config && TEAMS.every((team) => config[team] && typeof config[team] === "object");
  if (!valid) return res.status(400).json({ error: "Body must be { SOC: {...}, TI: {...} }" });
  res.json(await db.replaceSlaConfig(config, req.body.updatedBy));
}));

module.exports = router;
