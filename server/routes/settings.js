/*
 * GET/PUT /api/settings — system-wide app settings (not per-user): the
 * Status Change Notifications mode plus the four System & SLA Notifications
 * toggles (slaBreach, newAssignment, reassignment, weeklyDigest). Unlike
 * sla-config.js's whole-blob PUT, this one accepts a PARTIAL patch — the
 * frontend flips one setting at a time (one <select> or one checkbox per
 * action), so requiring the full object on every write would make every
 * caller re-send fields it never touched.
 */
const express = require("express");
const db = require("../db");
const { STATUS_CHANGE_NOTIFY_MODES, NOTIFICATION_PREF_KEYS } = require("../constants");
const { asyncRoute } = require("../util");

const router = express.Router();

async function allSettings() {
  return Object.assign({ statusChangeNotifyMode: await db.getStatusChangeNotifyMode() }, await db.getNotificationPrefs());
}

router.get("/settings", asyncRoute(async (req, res) => {
  res.json(await allSettings());
}));

router.put("/settings", asyncRoute(async (req, res) => {
  const body = req.body || {};
  const recognizedKeys = Object.keys(body).filter(
    (key) => key === "statusChangeNotifyMode" || NOTIFICATION_PREF_KEYS.indexOf(key) !== -1
  );
  if (recognizedKeys.length === 0) {
    return res.status(400).json({
      error: "Body must include at least one of: statusChangeNotifyMode, " + NOTIFICATION_PREF_KEYS.join(", ")
    });
  }

  if (body.statusChangeNotifyMode != null && STATUS_CHANGE_NOTIFY_MODES.indexOf(body.statusChangeNotifyMode) === -1) {
    return res.status(400).json({ error: "statusChangeNotifyMode must be one of: " + STATUS_CHANGE_NOTIFY_MODES.join(", ") });
  }
  for (const key of NOTIFICATION_PREF_KEYS) {
    if (body[key] != null && typeof body[key] !== "boolean") {
      return res.status(400).json({ error: key + " must be a boolean" });
    }
  }

  if (body.statusChangeNotifyMode != null) await db.setStatusChangeNotifyMode(body.statusChangeNotifyMode);
  for (const key of NOTIFICATION_PREF_KEYS) {
    if (body[key] != null) await db.setNotificationPref(key, body[key]);
  }

  res.json(await allSettings());
}));

module.exports = router;
