/**
 * The Alchemical Hydra's death (rsprox captures, 152 kills): the enraged form plays its death
 * sequence, 3 ticks later becomes the dead form playing the final one, and is taken away 7 ticks
 * after that; its pools, currents and fires go with it. As it goes the fight duration (from its
 * first attack, with the personal best) and "Your Alchemical Hydra kill count is: N." show. The
 * kill is counted (Combat Achievements counts it from the death, and times the fight for its speed
 * tasks) and a task kill is worth 1,320 Slayer experience (Wiki, monsters-complete). Its loot is
 * the "alchemical_hydra" table (NpcDrops), the Ikkle hydra roll the pets table's; the chamber's
 * door opens again.
 */
const Common = require("./Common.AlchemicalHydra");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");

/** Combat Achievements' count for the Hydra, or null when it doesn't answer. */
function countedKills(player) {
  const request = { player, monster: Common.data.kill.monster };
  Common.api.emitCustomEvent("combat-achievements:count", request);
  return Number.isInteger(request.total) ? request.total : null;
}

/** "Fight duration: ..." from its first attack to its removal, against the player's best. */
function fightDuration(player, ticks) {
  const best = Number(player.getAttribute(Common.BEST_TICKS_ATTRIBUTE)) || 0;
  const precise = Common.preciseTiming(player);
  const time = Common.formatTicks(ticks, precise);
  if (best <= 0 || ticks < best) {
    player.setAttribute(Common.BEST_TICKS_ATTRIBUTE, ticks);
    return Common.message(precise ? "durationBestPrecise" : "durationBest", { time });
  }
  return Common.message(precise ? "durationPrecise" : "duration", { time, best: Common.formatTicks(best, precise) });
}

function hydraDeath(event) {
  const { npc, killer } = event;
  if (!Common.isHydra(npc)) return;
  const firstAttack = npc.__hydraFight?.firstAttackTick ?? null;
  npc.__hydraFight?.stop();
  npc.__hydraLair?.recordKill?.(npc);
  npc.__hydraLair?.respawnLater?.();
  // Its last form stays on for the rest of its 10 death ticks (rsprox). The engine's death task
  // starts the tick after the killing hit and runs its form's death ticks, so the rest is left.
  const { deathStartTicks, deathTicks } = Common.data.kill;
  // Read while it was still the enraged form: it is the dead form by now (beforeDeath).
  const engineTicks = 1 + Math.max(1, Number(npc.__hydraDeathTicks) || deathTicks);
  const remains = Math.max(1, deathStartTicks + deathTicks - engineTicks);
  event.remains = { ticks: remains };
  const player = killer?.isPlayer?.() ? killer : null;
  if (!player?.isRegistered?.()) return;
  const own = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(Common.KILLS_ATTRIBUTE, own);
  const removedAt = Common.worldTick() + remains;
  Common.later(remains, () => {
    if (!player.isRegistered?.()) return;
    if (firstAttack !== null) player.sendMessage(fightDuration(player, Math.max(1, removedAt - firstAttack)));
    const kills = Math.max(own, countedKills(player) ?? 0);
    sendBossKillCount(player, Common.message("killCount", { kills }));
  });
}

/** "slayer:task-kill": the Hydra's Slayer experience is its own, not its hitpoints. */
function slayerXp(kill) {
  if (Common.isHydra(kill?.npc)) kill.xp = Common.data.kill.slayerXp;
}

/**
 * Before it is enraged no hit kills it (it changes form instead). Enraged, it dies: its form's
 * death sequence plays now, and 3 ticks later it becomes the dead form playing the final one.
 */
function beforeDeath(event) {
  if (!Common.isHydra(event.npc) || event.preventDeath) return;
  const npc = event.npc;
  const fight = npc.__hydraFight;
  // Direct damage (such as recoil) can bypass the normal attack modifier.
  if (fight && !fight.enraged) {
    event.preventDeath = true;
    npc.setHitpoints(1);
    return;
  }
  const { Animation } = Common.core;
  // The engine's death task waits out this form's death ticks; the remains add the rest (hydraDeath).
  npc.__hydraDeathTicks = Number(npc.getCurrentDefinition?.()?.getDeathTicks?.()) || null;
  npc.performAnimation(new Animation(Common.ids.seqs.deathStart));
  const players = fight?.lair?.players?.() ?? [];
  Common.areaSound(players, "death", npc.getLocation());
  fight?.clear?.();
  Common.later(Common.data.kill.deathStartTicks, () => {
    if (npc.isRegistered?.() === false) return;
    npc.setNpcTransformationId(Common.ids.npcs.dead);
    npc.performAnimation(new Animation(Common.ids.seqs.death));
  });
}

function attach(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_TICKS_ATTRIBUTE, 0);
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcDeath(hydraDeath);
  api.onCustomEvent("slayer:task-kill", slayerXp);
}

module.exports = { attach, hydraDeath, slayerXp, countedKills, fightDuration, beforeDeath };
