"use strict";

/**
 * The Inferno's Combat Achievements (plugins/combatachievements/). A run is watched from wave 1:
 * Jal-ImKot digging, a pillar brought down before the Jad waves, the player's hitpoints, a
 * twisted bow worn, the player's spells and ranged or magic attacks before Zuk's wave, TzKal-Zuk
 * attacking them, JalTok-Jad damage, the Jads of wave 68 and the one Zuk summons. Winning counts
 * for TzKal-Zuk (the run's own completion count) and decides the tasks. A run resumed after a
 * logout is not watched from its start, so only its completion counts.
 */

const { JAD_WAVE, TRIPLE_JAD_WAVE, ZUK_WAVE } = require("./InfernoWaves");

const WASNT_EVEN_CLOSE_HITPOINTS = 50;
const SPEED_RUNNER_SECONDS = 65 * 60;
const PLAYING_WITH_JADS_SECONDS = 30;

const runs = new WeakMap();
let api;

const tick = () => api.core.World.getProcessCycle();
const npcName = (npc) => String(npc?.getCurrentDefinition?.()?.getName?.() ?? "");
const runInside = (player) => (player?.isPlayer?.() ? runs.get(player) : null);

function start(player) {
  runs.set(player, {
    startTick: tick(), wave: 1, dug: false, pillarFell: false, lowHitpoints: false, twistedBow: false,
    magic: false, rangedOrMagicEarly: false, zukAttacked: false, jadDamage: false,
    firstJadDeathTick: -1, playingWithJads: false, zukJadKilled: false,
  });
}

function tickRun(player, wave) {
  const run = runs.get(player);
  if (!run) return;
  if (run.wave === TRIPLE_JAD_WAVE && wave > TRIPLE_JAD_WAVE && run.firstJadDeathTick !== -1) {
    run.playingWithJads = (tick() - run.firstJadDeathTick) * 0.6 <= PLAYING_WITH_JADS_SECONDS;
  }
  run.wave = wave;
  if (player.getHitpoints() < WASNT_EVEN_CLOSE_HITPOINTS) run.lowHitpoints = true;
  const weapon = player.getEquipment?.()?.getItems?.()?.[api.core.Equipment.WEAPON_SLOT]?.getId?.();
  if (weapon === api.core.ItemIdentifiers.TWISTED_BOW) run.twistedBow = true;
}

function dug(player) {
  const run = runs.get(player);
  if (run) run.dug = true;
}

/** A pillar brought down by damage; the Jad waves' own collapse is not one. */
function pillarFell(player, wave) {
  const run = runs.get(player);
  if (run && wave < JAD_WAVE) run.pillarFell = true;
}

function dealt({ player, hit }) {
  const run = runs.get(player);
  if (!run) return;
  const type = String(hit?.getCombatType?.());
  if (type === "MAGIC") run.magic = true;
  if (type !== "MELEE" && run.wave < ZUK_WAVE) run.rangedOrMagicEarly = true;
}

function hitResolved({ attacker, target, hit }) {
  const run = runInside(target);
  if (!run || !attacker?.isNpc?.()) return;
  const name = npcName(attacker);
  if (name === "TzKal-Zuk") run.zukAttacked = true;
  if (name === "JalTok-Jad" && hit.getTotalDamage() > 0) run.jadDamage = true;
}

function npcDeath({ npc, killer }) {
  const run = runInside(killer);
  if (!run) return;
  const name = npcName(npc);
  const complete = (task) => api.emitCustomEvent("combat-achievements:complete", { player: killer, task });
  if (name === "Jal-Zek") complete("Half-Way There");
  if (name !== "JalTok-Jad") return;
  if (run.wave === TRIPLE_JAD_WAVE && run.firstJadDeathTick === -1) run.firstJadDeathTick = tick();
  if (run.wave === ZUK_WAVE) run.zukJadKilled = true;
}

function finish(player, won, completions) {
  const run = runs.get(player);
  runs.delete(player);
  if (!won) return;
  const complete = (task) => api.emitCustomEvent("combat-achievements:complete", { player, task });
  api.emitCustomEvent("combat-achievements:kill", { player, monster: "TzKal-Zuk", count: completions });
  if (!run) return;
  if ((tick() - run.startTick) * 0.6 < SPEED_RUNNER_SECONDS) complete("Inferno Speed-Runner");
  if (!run.dug) complete("The Floor Is Lava");
  if (!run.pillarFell) complete("Nibblers, Begone!");
  if (!run.lowHitpoints) complete("Wasn't Even Close");
  if (!run.twistedBow) complete("Budget Setup");
  if (!run.magic) complete("Nibbler Chaser");
  if (!run.rangedOrMagicEarly) complete("Facing Jad Head-on II");
  if (!run.zukJadKilled) complete("Jad? What Are You Doing Here?");
  if (!run.zukAttacked && !run.jadDamage) complete("No Luck Required");
  if (run.playingWithJads) complete("Playing with Jads");
}

/** At login: the completion count, so earlier runs finish their kill-count tasks. */
function answerKillCount({ player, counts }) {
  // Required here: the run requires this unit.
  const completions = require("./InfernoRun").completions(player);
  if (completions > 0) counts["TzKal-Zuk"] = completions;
}

module.exports = function registerInfernoCombatAchievements(pluginApi) {
  api = pluginApi;
  pluginApi.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  pluginApi.onPlayerDealtDamage(dealt);
  pluginApi.onCombatHitResolved(hitResolved);
  pluginApi.onNpcDeath(npcDeath);
};
Object.assign(module.exports, { start, tick: tickRun, dug, pillarFell, finish });
