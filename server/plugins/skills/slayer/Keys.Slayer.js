"use strict";

/**
 * Slayer keys: a kill that counts for a Konar task may drop a brimstone key, one for a
 * Krystilia task a Larran's key. Neither is on any monster's own table; the chance follows the
 * monster's combat level (Wiki: Brimstone key, Larran's key):
 *
 * - Brimstone key: 1 in 100 + floor((100 - L)^2 / 5) below level 100, 1 in 120 - floor(L / 5)
 *   from 100, capped at 1 in 50 from level 350.
 * - Larran's key: 1 in floor(3/10 x (80 - L)^2) + 100 up to level 80, 1 in floor(-5/27 x L) + 115
 *   up to 350, 1 in 50 above.
 * - Monsters with a Slayer level requirement: the chance is 20% higher. Larran's key: another
 *   15% inside the Wilderness Slayer Cave.
 * - A superior Slayer monster on such a task always drops the key.
 *
 * The key lands with the kill's loot, on "slayer:task-kill" (Tasks.Slayer.js), which is only
 * sent for kills that count: Konar's in her area, Krystilia's in the Wilderness.
 */
const Superiors = require("./Superiors.Slayer");
const Tasks = require("./Tasks.Slayer");

const KONAR = 8;
const KRYSTILIA = 7;
const SLAYER_REQUIREMENT_BOOST = 1.2;
const SLAYER_CAVE_BOOST = 1.15;
/** The cave's four map squares (its monsters' spawns lie inside them). */
const WILDERNESS_SLAYER_CAVE = { minX: 3328, minY: 10048, maxX: 3455, maxY: 10175 };

const KEYS = {
  [KONAR]: { obj: "konar_key", denominator: brimstoneDenominator },
  [KRYSTILIA]: { obj: "slayer_wilderness_key", denominator: larranDenominator, caveBoost: true },
};

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function brimstoneDenominator(level) {
  if (level >= 350) return 50;
  if (level >= 100) return 120 - Math.floor(level / 5);
  return 100 + Math.floor((100 - level) ** 2 / 5);
}

function larranDenominator(level) {
  if (level > 350) return 50;
  if (level > 80) return Math.floor((-5 / 27) * level) + 115;
  return Math.floor((3 / 10) * (80 - level) ** 2) + 100;
}

function definition(npc) {
  return npc.getCurrentDefinition?.() ?? npc.getDefinition?.();
}

function inSlayerCave(location) {
  const { minX, minY, maxX, maxY } = WILDERNESS_SLAYER_CAVE;
  const x = location.getX();
  const y = location.getY();
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/** The chance (0-1) that this kill drops the key. */
function chance(key, npc) {
  // Wiki (Superior slayer monster): a guaranteed brimstone key on a Konar task, but a guaranteed Larran's key only
  // "on-task in the Wilderness Slayer Cave"; elsewhere a Krystilia superior rolls like any other kill.
  if (Superiors.isSuperior(npc) && (!key.caveBoost || inSlayerCave(npc.getLocation()))) return 1;
  const type = definition(npc);
  const level = Math.max(1, type?.getCombatLevel?.() ?? 1);
  let result = 1 / key.denominator(level);
  if ((type?.getSlayerLevel?.() ?? 0) > 1) result *= SLAYER_REQUIREMENT_BOOST;
  if (key.caveBoost && inSlayerCave(npc.getLocation())) result *= SLAYER_CAVE_BOOST;
  return result;
}

/** "slayer:task-kill" { player, npc }: sent before the kill is taken off the task (a kill only counted as on task, `offTask`, is no task's). */
function taskKill({ player, npc, offTask }, random = Math.random) {
  if (offTask) return;
  const key = KEYS[Tasks.current(player)?.masterId];
  if (!key || random() >= chance(key, npc)) return;
  const itemId = core.CacheDefinitions.getObjId(key.obj);
  if (itemId == null) return;
  api.emitCustomEvent("npc-drops:place", { player, drops: [{ itemId, amount: 1 }], location: npc.getLocation() });
}

function attach(pluginApi) {
  pluginApi.onCustomEvent("slayer:task-kill", taskKill);
}

module.exports = { init, attach, taskKill, chance, brimstoneDenominator, larranDenominator };
