"use strict";

const fs = require("node:fs");
const path = require("node:path");
const FILE = path.resolve(__dirname, "../../../data/saves/bot-routine-setups.json");
const { isRoutineReference } = require("./RoutineCatalog.PlayerBots");

function savedSetupName(input) {
  const name = input.trim();
  if (!name || name.length > 48 || /[<>\u0000-\u001f]/.test(name)) throw new Error("Enter a plain-text name of 1–48 characters.");
  return name;
}

function nextSetupId(name, entries) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const base = (/^[a-z]/.test(slug) ? slug : `saved-${slug || 'setup'}`).slice(0, 35);
  const prefix = base.startsWith("plugin-") ? `saved-${base}` : base;
  const ids = new Set(entries.map(entry => entry.id));
  let id = prefix;
  for (let suffix = 2; ids.has(id); suffix++) id = `${prefix}-${suffix}`;
  return id;
}

function normalize(entry) {
  if (!entry || typeof entry.name !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(entry.id) || !isRoutineReference(entry.activityId) ||
      !Number.isSafeInteger(entry.count) || entry.count < 1 || !entry.overrides || typeof entry.overrides !== "object" || Array.isArray(entry.overrides)) {
    throw new Error("Invalid saved routine setup.");
  }
  return { ...entry, name: savedSetupName(entry.name) };
}

function readRoutineSetups(file = FILE) {
  try {
    const entries = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(entries)) throw new Error("Invalid saved routine setup store.");
    return entries.map(normalize);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function saveRoutineSetup(input, file = FILE) {
  const entries = readRoutineSetups(file);
  const name = savedSetupName(input.name);
  const entry = normalize({ ...input, name, id: nextSetupId(name, entries) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify([...entries, entry], null, 2)}\n`);
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return entry;
}

module.exports = { savedSetupName, nextSetupId, readRoutineSetups, saveRoutineSetup };
