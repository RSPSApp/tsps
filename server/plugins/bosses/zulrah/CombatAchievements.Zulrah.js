"use strict";

/**
 * Zulrah's Combat Achievements (plugins/combatachievements/): its kill count and best time are
 * the shrine's own, the speed tasks are timed by the fight when the player is not on a slayer
 * task for it, Perfect Zulrah counts the damage the task names (snakelings, venom clouds, its
 * green form's attacks and its crimson form's tail) and three snakelings killed on one tick is a
 * task of its own.
 */

const Shared = require("./ZulrahShared");

const SPEED = [["Zulrah Speed-Trialist", 80], ["Zulrah Speed-Chaser", 60], ["Zulrah Speed-Runner", 54]];
const SNAKELINGS_AT_ONCE = 3;
const SNAKELINGS = new Set([Shared.NPC.SNAKELING_MELEE, Shared.NPC.SNAKELING_MAGIC]);
/** The forms whose attacks Perfect Zulrah forbids: green (ranged) and crimson (melee). */
const AVOIDABLE_FORMS = new Set([Shared.NPC.GREEN, Shared.NPC.RED]);

/** player -> { tick, count } snakelings they killed on the latest tick. */
const snakelingKills = new WeakMap();

const tick = () => Shared.core().World.getProcessCycle();
const emit = (name, payload) => Shared.api()?.emitCustomEvent?.(name, payload);

/** Damage the player took that Perfect Zulrah does not allow. */
function avoidableDamage(fight, amount) {
  if (fight && amount > 0) fight.avoidableDamage = (fight.avoidableDamage ?? 0) + amount;
}

function hitResolved({ attacker, target, hit }) {
  if (!target?.isPlayer?.() || !attacker?.isNpc?.()) return;
  const id = attacker.getId();
  if (!SNAKELINGS.has(id) && !AVOIDABLE_FORMS.has(id)) return;
  avoidableDamage(target.getArea?.()?.fight, hit.getTotalDamage());
}

function npcDeath({ npc, killer }) {
  if (!killer || !SNAKELINGS.has(npc.getId())) return;
  const now = tick();
  const latest = snakelingKills.get(killer);
  const count = latest?.tick === now ? latest.count + 1 : 1;
  snakelingKills.set(killer, { tick: now, count });
  if (count >= SNAKELINGS_AT_ONCE) emit("combat-achievements:complete", { player: killer, task: "Snake. Snake!? Snaaaaaake!" });
}

/** Zulrah dead: `kills` its count now, `ticks` the fight's length. */
function killed(player, fight, kills, ticks) {
  const complete = (task) => emit("combat-achievements:complete", { player, task });
  emit("combat-achievements:kill", { player, monster: "Zulrah", count: kills });
  if (!fight.avoidableDamage) complete("Perfect Zulrah");
  const slayer = { player, npc: fight.zulrah, onTask: false };
  emit("slayer:on-task", slayer);
  if (!slayer.onTask) for (const [task, limit] of SPEED) if (ticks * 0.6 < limit) complete(task);
}

function answerKillCount({ player, counts }) {
  const kills = Number(player.getAttribute(Shared.ATTR.KILLS)) || 0;
  if (kills > 0) counts.Zulrah = kills;
}

function answerPersonalBest(request) {
  const best = Number(request.player.getAttribute(Shared.ATTR.BEST_TIME)) || 0;
  if (request.monster === "Zulrah" && best > 0) request.best = best;
}

module.exports = function registerZulrahCombatAchievements(pluginApi) {
  pluginApi.onCombatHitResolved(hitResolved);
  pluginApi.onNpcDeath(npcDeath);
  pluginApi.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  pluginApi.onCustomEvent("combat-achievements:personal-best", answerPersonalBest);
};
Object.assign(module.exports, { killed, avoidableDamage });
