"use strict";

/**
 * Magical wheat: Push-through rolls the player's Strength for a fast (6 ticks), medium
 * (8 ticks) or slow (10 ticks) push and moves them two tiles past the wheat. Chances are the
 * Wiki's (Mod Ash): first roll fast 0% at 1 -> 39% at 99, then medium 4% at 1 -> 100% at 99,
 * otherwise slow, linearly interpolated. Strength XP is off by default since 1 March 2023
 * and Elnock's re-enable toggle is not implemented, so no XP is awarded (0/2/4 off).
 *
 * The push is driven by the Puro-Puro Area's per-tick process: it waits the tier's ticks,
 * cancels if the player moved, and then moves them. The two-tile step assumes the wheat is
 * one tile thick; a dense hedge simply takes another push.
 */
const TIERS = [
  { ticks: 6, message: "You use your strength to push through the wheat in the most efficient fashion." },
  { ticks: 8, message: "You use your strength to push through the wheat." },
  { ticks: 10, message: "You push through the wheat. It's hard work, though." },
];
const FAST = TIERS[0];
const MEDIUM = TIERS[1];
const SLOW = TIERS[2];

let core;
/** player -> { from, to, ticks } */
const pushes = new Map();

function init(api) {
  core = api.core;
}

const clampLevel = (level) => Math.max(1, Math.min(99, level));
const fastChance = (level) => 0.39 * (clampLevel(level) - 1) / 98;
const mediumChance = (level) => 0.04 + 0.96 * (clampLevel(level) - 1) / 98;

function rollTier(level, random = Math.random) {
  if (random() < fastChance(level)) return FAST;
  if (random() < mediumChance(level)) return MEDIUM;
  return SLOW;
}

/** Two tiles from the player through the wheat, along the dominant axis to the object. */
function destination(from, object) {
  const at = object.getLocation();
  const dx = at.getX() - from.getX();
  const dy = at.getY() - from.getY();
  if (dx === 0 && dy === 0) return null;
  const stepX = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) * 2 : 0;
  const stepY = stepX === 0 ? Math.sign(dy) * 2 : 0;
  return new core.Location(from.getX() + stepX, from.getY() + stepY, from.getZ());
}

function pushThrough({ player, object, random = Math.random }) {
  if (pushes.has(player)) return true;
  const from = player.getLocation().clone();
  const to = destination(from, object);
  if (!to) return true;
  const tier = rollTier(player.getSkillManager().getCurrentLevel(core.Skill.STRENGTH), random);
  player.sendMessage(tier.message);
  pushes.set(player, { from, to, ticks: tier.ticks });
  return true;
}

/** One Area tick for a player in Puro-Puro. */
function process(player) {
  const push = pushes.get(player);
  if (!push) return;
  if (!player.getLocation().equals(push.from)) {
    pushes.delete(player);
    return;
  }
  push.ticks--;
  if (push.ticks > 0) return;
  pushes.delete(player);
  player.moveTo(push.to);
}

function cancel(player) {
  pushes.delete(player);
}

function registerWheat(api) {
  init(api);
  api.onObjectInteraction("Magical wheat", { "Push-through": pushThrough });
}

module.exports = registerWheat;
Object.assign(module.exports, {
  init, TIERS, fastChance, mediumChance, rollTier, pushThrough, process, cancel, pushes,
  _test: { fastChance, mediumChance, rollTier, pushThrough, process, cancel, pushes },
});
