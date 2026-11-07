"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** The manager stores colours seen after the base NPC's cache recolours. */
function withCustomNpcRecolors(core, document, combatFile) {
  const entries = combatFile?.npcs ?? {};
  const rows = document.rows.map((row) => {
    if (row?.kind !== "npc" || !Number.isInteger(row.id) || row.id < 50000 ||
        row.fields?.recolorFrom !== undefined || row.fields?.recolorTo !== undefined) return row;
    const configured = entries[String(row.id)];
    if (!configured || configured.recolorFrom === undefined && configured.recolorTo === undefined) return row;
    const from = configured.recolorFrom;
    const to = configured.recolorTo;
    const valid = Array.isArray(from) && Array.isArray(to) && from.length === to.length &&
      from.every((value) => Number.isInteger(value) && value >= 0 && value <= 65535) &&
      to.every((value) => Number.isInteger(value) && value >= 0 && value <= 65535) &&
      new Set(from).size === from.length;
    if (!valid) {
      console.warn(`[cache-editor] skipping invalid custom NPC ${row.id} recolours`);
      return row;
    }
    if (from.length === 0) return row;
    const base = core.CacheDefinitions.getNpc(row.baseId);
    const sources = [...(base.recolorFrom ?? [])];
    const destinations = [...(base.recolorTo ?? [])];
    if (sources.length !== destinations.length) {
      console.warn(`[cache-editor] skipping custom NPC ${row.id} recolours: base arrays differ`);
      return row;
    }
    for (let pair = 0; pair < from.length; pair++) {
      let replaced = false;
      for (let index = 0; index < destinations.length; index++) {
        if (base.recolorTo[index] !== from[pair]) continue;
        destinations[index] = to[pair];
        replaced = true;
      }
      if (!replaced) {
        sources.push(from[pair]);
        destinations.push(to[pair]);
      }
    }
    return { ...row, fields: { ...row.fields, recolorFrom: sources, recolorTo: destinations } };
  });
  return { ...document, rows };
}

function readCustomNpcCombat(root) {
  const file = path.join(root, "data", "definitions", "npc-combat-defs.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

module.exports = { withCustomNpcRecolors, readCustomNpcCombat };
