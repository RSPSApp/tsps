"use strict";

/**
 * The Fight Caves' Combat Achievements (plugins/combatachievements/). A run is watched from its
 * first wave: the player's hits (melee only?), their prayer (any point lost?), Tz-Kih attacks,
 * Yt-MejKot heals, Yt-HurKot healing Jad and a Jad hit taken without the right protection prayer.
 * Winning counts for TzTok-Jad and decides the tasks. A run resumed after a logout is not
 * watched from its start, so only its completion counts.
 */

const runs = new WeakMap();
let api;

const PROTECTION = { MELEE: "PROTECT_FROM_MELEE", RANGED: "PROTECT_FROM_MISSILES", MAGIC: "PROTECT_FROM_MAGIC" };
const SPEED = [["Fight Caves Speed-Chaser", 30 * 60], ["Fight Caves Speed-Runner", 26 * 60 + 30]];

const tick = () => api.core.World.getProcessCycle();
const npcName = (npc) => String(npc?.getCurrentDefinition?.()?.getName?.() ?? "");
const prayerOf = (player) => player.getSkillManager().getCurrentLevel(api.core.Skill.PRAYER);

function start(player) {
  runs.set(player, {
    startTick: tick(), prayer: prayerOf(player), prayerLost: false, nonMelee: false,
    kihAttacked: false, mejKotHealed: false, jadHealed: false, jadHitUnprayed: false,
  });
}

/** Each tick of the run: has a prayer point gone? */
function tickRun(player) {
  const run = runs.get(player);
  if (!run) return;
  const prayer = prayerOf(player);
  if (prayer < run.prayer) run.prayerLost = true;
  run.prayer = prayer;
}

function dealt({ player, hit }) {
  const run = runs.get(player);
  if (run && String(hit?.getCombatType?.()) !== "MELEE") run.nonMelee = true;
}

function hitResolved({ attacker, target, hit }) {
  const run = target?.isPlayer?.() ? runs.get(target) : null;
  if (!run || !attacker?.isNpc?.()) return;
  const name = npcName(attacker);
  if (name === "Tz-Kih") run.kihAttacked = true;
  if (name === "TzTok-Jad" && hit.getTotalDamage() > 0 && target.getHitpoints() > 0) {
    const prayer = api.core.PrayerHandler[PROTECTION[String(hit.getCombatType())]];
    if (!api.core.PrayerHandler.isActivated(target, prayer)) run.jadHitUnprayed = true;
  }
}

/** A Yt-MejKot healed itself or another while fighting this player. */
function mejKotHealed(player) {
  const run = runs.get(player);
  if (run) run.mejKotHealed = true;
}

/** A Yt-HurKot healed this player's Jad. */
function jadHealed(player) {
  const run = runs.get(player);
  if (run) run.jadHealed = true;
}

function finish(player, wonJad) {
  const run = runs.get(player);
  runs.delete(player);
  if (!wonJad) return;
  const complete = (task) => api.emitCustomEvent("combat-achievements:complete", { player, task });
  api.emitCustomEvent("combat-achievements:kill", { player, monster: "TzTok-Jad" });
  if (!run) return;
  const seconds = (tick() - run.startTick) * 0.6;
  for (const [task, limit] of SPEED) if (seconds < limit) complete(task);
  if (!run.nonMelee) complete("Facing Jad Head-on");
  if (!run.prayerLost) complete("No Time for a Drink");
  if (!run.kihAttacked) complete("You Didn't Say Anything About a Bat");
  if (!run.mejKotHealed) complete("Denying the Healers");
  if (!run.jadHealed) complete("Denying the Healers II");
  if (run.jadHitUnprayed) complete("A Near Miss!");
}

module.exports = function registerFightCavesCombatAchievements(pluginApi) {
  api = pluginApi;
  pluginApi.onPlayerDealtDamage(dealt);
  pluginApi.onCombatHitResolved(hitResolved);
};
Object.assign(module.exports, { start, tick: tickRun, mejKotHealed, jadHealed, finish });
