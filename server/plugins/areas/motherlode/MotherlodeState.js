/**
 * Motherlode Mine: each player's sack, the pay-dirt they have in the washing machine and what
 * they've bought from Prospector Percy, plus the ore pay-dirt washes into.
 */
const { ItemIds } = require("../../../src/main/typescript/elvarg/util/IdEnums");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");

/** The mine's map square (one region); its upper level is a bridge on the same plane. */
const MINE = { minX: 3712, maxX: 3775, minY: 5632, maxY: 5695, z: 0 };

const PAY_DIRT = ItemIds.PAY_DIRT;
const GOLDEN_NUGGET = ItemIds.GOLDEN_NUGGET;
const PAY_DIRT_LEVEL = 30;
const UPPER_LEVEL_LEVEL = 57;
/** Wiki: the sack holds 108 pay-dirt, or 189 once Percy's bigger sack is bought. */
const SACK_CAPACITY = 108;
const BIGGER_SACK_CAPACITY = 189;

/** The HUD's sack count, read by script 1635 (motherlode_sack_transmit, 8 bits). */
const VARBIT_SACK = 5558;
/** The bigger sack: the HUD's limit is 189 instead of 108. */
const VARBIT_BIGGER_SACK = 5556;
/** Whether the player is on the upper level: the ladders (19044/19045) switch on it. */
const VARBIT_UPPER_LEVEL = 2086;
const SACK_TRANSMIT_MAX = 255;

/**
 * What each pay-dirt washes into, rolled top-down until one succeeds (coal when none do). The
 * levels and bonus XP are the Wiki's; the success rates are OpenRune's (ISC), which give the
 * Wiki's 1/32 nugget rate at every level.
 */
const ORES = [
  { key: "nugget", item: GOLDEN_NUGGET, level: PAY_DIRT_LEVEL, xp: 0, low: 7, high: 7 },
  { key: "runite", item: ItemIds.RUNITE_ORE, level: 85, xp: 75, low: -20, high: 5 },
  { key: "adamantite", item: ItemIds.ADAMANTITE_ORE, level: 70, xp: 45, low: -90, high: 50 },
  { key: "mithril", item: ItemIds.MITHRIL_ORE, level: 55, xp: 30, low: -19, high: 90 },
  { key: "gold", item: ItemIds.GOLD_ORE, level: 40, xp: 15, low: -40, high: 126 },
  { key: "coal", item: ItemIds.COAL, level: PAY_DIRT_LEVEL, xp: 15 },
];
const ORE_BY_KEY = new Map(ORES.map((ore) => [ore.key, ore]));

const STATE_ATTRIBUTE = "motherlode";

/**
 * The upper level's tiles, one entry per row (OpenRune's, from the map square's raised tiles):
 * the bridge is drawn a plane up, so the tiles it covers are the only way to tell the floors apart.
 */
const UPPER_ROWS = new Map([
  [5654, [[3763, 3765]]], [5655, [[3760, 3766]]], [5656, [[3760, 3766]]], [5657, [[3760, 3766]]],
  [5658, [[3761, 3765]]], [5659, [[3761, 3764]]], [5660, [[3761, 3763]]], [5661, [[3761, 3764]]],
  [5662, [[3761, 3764]]], [5663, [[3761, 3765]]], [5664, [[3761, 3765]]], [5665, [[3762, 3765]]],
  [5666, [[3763, 3765]]], [5667, [[3762, 3764]]], [5668, [[3761, 3764]]], [5669, [[3761, 3764]]],
  [5670, [[3761, 3764]]], [5671, [[3760, 3763]]], [5672, [[3759, 3763]]], [5673, [[3757, 3764]]],
  [5674, [[3755, 3765]]], [5675, [[3754, 3766]]], [5676, [[3752, 3766]]], [5677, [[3752, 3766]]],
  [5678, [[3751, 3766]]], [5679, [[3750, 3765]]], [5680, [[3747, 3764]]],
  [5681, [[3735, 3739], [3745, 3764]]], [5682, [[3734, 3764]]], [5683, [[3733, 3764]]],
  [5684, [[3733, 3763]]], [5685, [[3733, 3748], [3750, 3761]]],
  [5686, [[3733, 3736], [3740, 3747], [3757, 3758]]], [5687, [[3743, 3744]]],
]);

function isUpperLevel(x, y, z = 0) {
  return z === 0 && (UPPER_ROWS.get(y) ?? []).some(([from, to]) => x >= from && x <= to);
}

/** The chance (0-1) of a roll between `low` at level 1 and `high` at 99, as OSRS's skilling rolls. */
function successChance(low, high, level) {
  const clamped = Math.min(99, Math.max(1, level));
  const chance = (1 + Math.floor((low * (99 - clamped)) / 98 + (high * (clamped - 1)) / 98 + 0.5)) / 256;
  return Math.min(1, Math.max(0, chance));
}

function rollOre(level, random = Math.random) {
  for (const ore of ORES) {
    if (ore.low === undefined) return ore;
    if (level >= ore.level && random() < successChance(ore.low, ore.high, level)) return ore;
  }
  return ORES[ORES.length - 1];
}

/** The player's saved state, created on first use. */
function stateOf(player) {
  let state = player.getAttribute(STATE_ATTRIBUTE);
  if (!state || typeof state !== "object") {
    state = {};
    player.setAttribute(STATE_ATTRIBUTE, state);
  }
  state.sack ??= {};
  state.machine ??= [];
  /** The ores of the pay-dirt the player mined and still carries, oldest first. */
  state.held ??= [];
  return state;
}

function save(player, state) {
  player.setAttribute(STATE_ATTRIBUTE, state);
}

function sackTotal(state) {
  return ORES.reduce((total, ore) => total + (state.sack[ore.key] ?? 0), 0);
}

function capacity(state) {
  return state.biggerSack ? BIGGER_SACK_CAPACITY : SACK_CAPACITY;
}

/** Pay-dirt the sack still has room for, counting what is being washed. */
function space(state) {
  return capacity(state) - sackTotal(state) - state.machine.length;
}

/**
 * The ores of `count` deposited pay-dirt: those rolled as it was mined, then a roll now for any
 * pay-dirt that came from elsewhere. Once none is carried, nothing is left held.
 */
function takeHeld(player, state, count) {
  const ores = state.held.splice(0, count);
  while (ores.length < count) ores.push(rollOre(miningLevel(player)).key);
  if (player.getInventory().getAmount(PAY_DIRT) === 0) state.held = [];
  return ores;
}

function miningLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.MINING);
}

function baseMiningLevel(player) {
  return player.getSkillManager().getMaxLevel(Skill.MINING);
}

function syncVarbits(player) {
  const state = stateOf(player);
  const location = player.getLocation();
  player.getPacketSender()
    .sendVarbit(VARBIT_SACK, Math.min(SACK_TRANSMIT_MAX, sackTotal(state)));
  player.getPacketSender().sendVarbit(VARBIT_BIGGER_SACK, state.biggerSack ? 1 : 0);
  player.getPacketSender()
    .sendVarbit(VARBIT_UPPER_LEVEL, isUpperLevel(location.getX(), location.getY(), location.getZ()) ? 1 : 0);
}

module.exports = {
  MINE, PAY_DIRT, GOLDEN_NUGGET, PAY_DIRT_LEVEL, UPPER_LEVEL_LEVEL, SACK_CAPACITY, BIGGER_SACK_CAPACITY,
  VARBIT_SACK, VARBIT_BIGGER_SACK, VARBIT_UPPER_LEVEL, ORES, ORE_BY_KEY, STATE_ATTRIBUTE,
  isUpperLevel, successChance, rollOre, takeHeld, stateOf, save, sackTotal, capacity, space,
  miningLevel, baseMiningLevel, syncVarbits,
};
