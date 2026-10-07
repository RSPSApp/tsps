"use strict";

/**
 * What the modifiers that change the player or the enemies' blows do: Blasphemy, Doom,
 * Frailty, Myopia, Relentless and Mantimayhem's venom. Arena hazards are in Hazards.*.
 *
 * Wiki ("Fortis Colosseum", Modifiers):
 * - Blasphemy: prayer is drained by 20/40/60% of the damage taken from enemies.
 * - Doom: a stack per hit taken, shown in its own hitsplat with the stack count (the Doom
 *   Scorpion's page); 15/10/5 stacks kill. Stacks clear when a wave is completed.
 * - Frailty: base Hitpoints are lowered by 10/20/40%, and no healing above them.
 * - Myopia: the player's attack range is 2/4/6 tiles shorter; manually cast spells are not.
 * - Relentless: enemies bypass 33/66% of the player's Defence level and hit 1/3 higher; at III
 *   they always hit and hit 6 higher.
 * - Mantimayhem II: an orb not prayed against envenoms; venom is cured when a wave ends.
 * RuneLite (HitsplatID.DOOM): the Doom hitsplat is 73.
 */

const Shared = require("./ColosseumShared");

const BLASPHEMY_DRAIN = [0, 0.2, 0.4, 0.6];
const DOOM_LIMIT = [Infinity, 15, 10, 5];
const DOOM_HITSPLAT = { mine: 73, others: 73 };
const FRAILTY_LOSS = [0, 0.1, 0.2, 0.4];
const MYOPIA_LOSS = [0, 2, 4, 6];
const RELENTLESS_BYPASS = [0, 0.33, 0.66, 1];
const RELENTLESS_MAX_HIT = [0, 1, 3, 6];
/** Mantimayhem II's venom starts as a fresh envenoming does. */
const VENOM_SEVERITY = 6;

function runOf(player) {
  return require("./ColosseumRun").runOf(player);
}

function tier(run, id) {
  return run?.modifiers.tierOf(id) ?? 0;
}

/** How much higher enemies hit under Relentless. */
function maxHitBonus(run) {
  return RELENTLESS_MAX_HIT[tier(run, "relentless")];
}

/**
 * Every hit the player takes in a run: the wave's damage total (varp 4134), Blasphemy's
 * prayer drain, and a stack of Doom. `fromEnemy` marks the wave as not damage-free (Glory).
 */
function damageTaken(run, amount, fromEnemy = false) {
  if (!run || amount <= 0 || run.stage === "ended") return;
  if (fromEnemy) run.hitByEnemy = true;
  const player = run.player;
  run.waveDamage += amount;
  player.getPacketSender().sendConfig(Shared.VARP.WAVE_DAMAGE_TAKEN, run.waveDamage);
  const drain = Math.floor(amount * BLASPHEMY_DRAIN[tier(run, "blasphemy")]);
  if (drain > 0) player.getSkillManager().decreaseCurrentLevel(Shared.core().Skill.PRAYER, drain, 0);
  const doom = tier(run, "doom");
  if (doom === 0) return;
  run.doomStacks++;
  player.showHitsplat?.(run.doomStacks, DOOM_HITSPLAT);
  if (run.doomStacks >= DOOM_LIMIT[doom]) doomed(player);
}

function doomed(player) {
  const { HitDamage, HitMask } = Shared.core();
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(player.getHitpoints(), HitMask.RED)]);
}

/** A run enemy's blow landing on the player. */
function enemyHitLanded(event) {
  const run = event.attacker?.__colosseumRun;
  if (!run || event.target !== run.player) return;
  damageTaken(run, event.hit.getTotalDamage(), true);
}

/**
 * Relentless on an enemy's accuracy roll. Bypassing part of the Defence level shrinks the
 * player's defence roll; forcing a hit with the right chance on top of the ordinary roll
 * gives the hit chance against that smaller roll.
 */
function relentless(event) {
  const run = event.attacker?.__colosseumRun;
  if (!run || event.target !== run.player) return;
  const level = tier(run, "relentless");
  if (level === 0) return;
  if (level >= 3) {
    event.forceAccurate = true;
    return;
  }
  const { AccuracyFormulasDpsCalc, Skill } = Shared.core();
  const rolls = AccuracyFormulasDpsCalc.specialRolls(event.attacker, event.target, event.combatType);
  if (!rolls) return;
  const defence = event.target.getSkillManager().getCurrentLevel(Skill.DEFENCE);
  const kept = defence - Math.floor(defence * RELENTLESS_BYPASS[level]);
  const lowered = Math.floor((rolls.defence * (kept + 8)) / (defence + 8));
  const before = AccuracyFormulasDpsCalc.hitChance(rolls.attack, rolls.defence);
  const after = AccuracyFormulasDpsCalc.hitChance(rolls.attack, lowered);
  if (before >= 1) return;
  if (Math.random() < (after - before) / (1 - before)) event.forceAccurate = true;
}

function myopia(event) {
  if (!event.attacker?.isPlayer?.() || event.manualCast) return;
  const run = runOf(event.attacker);
  const loss = MYOPIA_LOSS[tier(run, "myopia")];
  if (loss > 0) event.distance = Math.max(1, event.distance - loss);
}

/** Frailty lowers the Hitpoints level for the rest of the run. */
function applyFrailty(run) {
  const { Skill } = Shared.core();
  const skills = run.player.getSkillManager();
  const loss = FRAILTY_LOSS[tier(run, "frailty")];
  skills.setMaxLevelCap(Skill.HITPOINTS, null);
  if (loss === 0) return;
  const base = skills.getMaxLevel(Skill.HITPOINTS);
  skills.setMaxLevelCap(Skill.HITPOINTS, base - Math.floor(base * loss));
}

/** No overhealing under Frailty: anything above the lowered level is lost. */
function tick(run) {
  if (tier(run, "frailty") === 0) return;
  const { Skill } = Shared.core();
  const skills = run.player.getSkillManager();
  const max = skills.getMaxLevel(Skill.HITPOINTS);
  if (skills.getCurrentLevel(Skill.HITPOINTS) > max) skills.setCurrentLevel(Skill.HITPOINTS, max, true);
}

/** Mantimayhem II: an orb the player is not praying against envenoms them. */
function envenom(run, player) {
  if (tier(run, "mantimayhem") < 2) return;
  Shared.core().CombatFactory.poisonEntity(player, VENOM_SEVERITY, 2);
}

function cureVenom(player) {
  if (!player.isVenomed?.()) return;
  player.setPoisonDamage(0);
  player.setVenomed(false);
  player.getPacketSender().sendPoisonType(0);
}

/** A wave completed: Doom's stacks and Mantimayhem's venom go. */
function waveCompleted(run) {
  run.doomStacks = 0;
  cureVenom(run.player);
}

function picked(run) {
  applyFrailty(run);
}

/** The run is over: the Hitpoints level comes back. */
function ended(run) {
  run.player.getSkillManager().setMaxLevelCap(Shared.core().Skill.HITPOINTS, null);
  cureVenom(run.player);
}

module.exports = function registerColosseumModifiers(api) {
  Shared.bind(api);
  api.onCombatHitResolved(enemyHitLanded);
  api.onCombatHitRoll(relentless);
  api.onCombatAttackDistance(myopia);
};

module.exports.damageTaken = damageTaken;
module.exports.maxHitBonus = maxHitBonus;
module.exports.envenom = envenom;
module.exports.tick = tick;
module.exports.picked = picked;
module.exports.waveCompleted = waveCompleted;
module.exports.ended = ended;
module.exports.relentless = relentless;
module.exports.myopia = myopia;
module.exports.enemyHitLanded = enemyHitLanded;
