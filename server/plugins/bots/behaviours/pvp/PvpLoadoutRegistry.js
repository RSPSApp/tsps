"use strict";

const { GameConstants } = require("../../../../src/main/typescript/elvarg/game/GameConstants");
const fs = require("fs");
const path = require("path");

function freezeArray(values) {
  return Object.freeze([...values]);
}

function freezeLoadout(loadout) {
  return Object.freeze({
    ...loadout,
    tags: freezeArray(loadout.tags),
    weaponFamilies: freezeArray(loadout.weaponFamilies),
    armorFamilies: freezeArray(loadout.armorFamilies),
    archetypes: freezeArray(loadout.archetypes),
    inventoryBias: Object.freeze({ ...loadout.inventoryBias }),
    hotspots: freezeArray(loadout.hotspots),
  });
}

function loadPvpLoadouts() {
  const file = path.join(GameConstants.DEFINITIONS_DIRECTORY, "pvp-bot-loadouts.json");
  const definitions = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!definitions || typeof definitions !== "object" || Array.isArray(definitions) ||
      !Array.isArray(definitions.presetGroups) || !Array.isArray(definitions.archetypes) ||
      !definitions.pools || typeof definitions.pools !== "object" ||
      !definitions.combat || typeof definitions.combat !== "object" ||
      !Array.isArray(definitions.combat.arrows) || !Array.isArray(definitions.combat.bolts) ||
      !Array.isArray(definitions.combat.specWeapons) ||
      !definitions.combat.specAmmo || typeof definitions.combat.specAmmo !== "object" ||
      !definitions.combat.specialCases || typeof definitions.combat.specialCases !== "object" ||
      !Array.isArray(definitions.loadouts) || definitions.loadouts.length === 0) {
    throw new Error("[pvp bot loadouts] missing required definitions");
  }
  const loadouts = {};
  for (const definition of definitions.loadouts) {
    if (!definition?.id || loadouts[definition.id]) {
      throw new Error("[pvp bot loadouts] loadout ids must be unique");
    }
    if (!Array.isArray(definition.archetypes) || definition.archetypes.length === 0) {
      throw new Error("[pvp bot loadouts] " + definition.id + " has no archetypes");
    }
    loadouts[definition.id] = freezeLoadout(definition);
  }
  return { definitions, loadouts: Object.freeze(loadouts) };
}

const {
  definitions: PVP_LOADOUT_DEFINITIONS,
  loadouts: PVP_LOADOUTS,
} = loadPvpLoadouts();
const PVP_LOADOUT_IDS = Object.freeze(Object.keys(PVP_LOADOUTS));

function getPvpLoadout(loadoutId) {
  return PVP_LOADOUTS[loadoutId] ?? PVP_LOADOUTS.edge_main_melee;
}

function listPvpLoadouts() {
  return PVP_LOADOUT_IDS.map((loadoutId) => PVP_LOADOUTS[loadoutId]);
}

module.exports = {
  PVP_LOADOUT_DEFINITIONS,
  PVP_LOADOUT_IDS,
  PVP_LOADOUTS,
  getPvpLoadout,
  listPvpLoadouts,
};
