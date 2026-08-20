/*
 * GET/PUT /api/clients — same "read/write the whole list as one blob"
 * contract as routes/categories.js, but a flat array instead of a
 * { team: [...] } object since Client has no team/client scoping of its
 * own to group by.
 */
const express = require("express");
const db = require("../db");
const { asyncRoute } = require("../util");

const router = express.Router();

router.get("/clients", asyncRoute(async (req, res) => {
  res.json(await db.getClients());
}));

router.put("/clients", asyncRoute(async (req, res) => {
  const clients = req.body;
  const valid = Array.isArray(clients) && clients.every((c) => typeof c === "string");
  if (!valid) return res.status(400).json({ error: "Body must be an array of client names" });
  res.json(await db.replaceClients(clients));
}));

module.exports = router;
