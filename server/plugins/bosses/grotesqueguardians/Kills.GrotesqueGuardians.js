/**
 * The Guardians' deaths (Wiki): Dawn finished with a hammer starts the last phase (Fight); Dusk
 * finished is the kill - "Your Grotesque Guardians kill count is: N." (Combat Achievements counts
 * it, as it times the fight for its speed tasks), the fight's duration from the bell with the
 * personal best (rsprox), and 1,350 Slayer experience on task; the roof's
 * statues go back on their plinths, ready for the bell. Dawn gives nothing of her own. Dusk's
 * kill rolls the drop table in data/grotesque-guardians.json (Wiki, Drops), including Noon.
 */
const Common = require("./Common.GrotesqueGuardians");

function countedKills(player) {
  const request = { player, monster: Common.data.kill.monster };
  Common.api.emitCustomEvent("combat-achievements:count", request);
  return Number.isInteger(request.total) ? request.total : null;
}

/**
 * Dusk's loot (Wiki, Drops): the table in data/grotesque-guardians.json through NpcDrops' roller,
 * so weights, quantities and the Noon tertiary stay data. The pet goes through Pets' award.
 */
function rollDrops(player, npc) {
  const drops = [];
  Common.api.emitCustomEvent("npc-drops:roll-table", { player, npc, table: Common.data.drops, drops });
  Common.api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: npc.getId?.(), drops });
  Common.api.emitCustomEvent("npc-drops:place", { player, drops, location: npc.getLocation() });
}

function guardianDeath({ npc, killer }) {
  const fight = npc?.__ggFight;
  if (Common.isDawn(npc)) {
    fight?.dawnDied();
    return;
  }
  if (!Common.isDusk(npc)) return;
  const roof = npc.__ggRoof;
  const startedAt = roof && fight && roof.fight === fight ? roof.startedAt : -1;
  fight?.stop();
  // Unless the bell has started another fight since.
  if (roof) Common.later(2, () => { if (roof.fight === fight) roof.clearGuardians(); });
  const player = killer?.isPlayer?.() ? killer : null;
  if (!player?.isRegistered?.()) return;
  const own = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(Common.KILLS_ATTRIBUTE, own);
  rollDrops(player, npc);
  const lines = [Common.message("killCount", { kills: Math.max(own, countedKills(player) ?? 0) })];
  if (startedAt >= 0) {
    const ticks = Common.core.World.getProcessCycle() - startedAt;
    const previous = Number(player.getAttribute(Common.BEST_ATTRIBUTE)) || 0;
    const best = previous > 0 ? Math.min(previous, ticks) : ticks;
    player.setAttribute(Common.BEST_ATTRIBUTE, best);
    lines.push(Common.message("duration", { time: Common.formatTicks(ticks), best: Common.formatTicks(best) }));
  }
  Common.later(1, () => lines.forEach((line) => player.sendMessage(line)));
}

/** "slayer:task-kill": Dusk's Slayer experience is the pair's (Wiki). */
function slayerXp(kill) {
  if (Common.isDusk(kill?.npc)) kill.xp = Common.data.kill.slayerXp;
}

/**
 * "slayer:target-eligible": the pair is one kill on the task (Wiki), so Dawn's death doesn't count.
 * Only her death: alive she is on task for the Slayer helmet and the like.
 */
function dawnKillEligible(query) {
  const npc = query?.npc;
  if (Common.isDawn(npc) && (npc.getHitpoints?.() <= 0 || npc.isDyingFunction?.())) query.eligible = false;
}

function attach(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_ATTRIBUTE, 0);
  api.onNpcDeath(guardianDeath);
  api.onCustomEvent("slayer:task-kill", slayerXp);
  api.onCustomEvent("slayer:target-eligible", dawnKillEligible);
}

module.exports = { attach, guardianDeath, slayerXp, dawnKillEligible, countedKills, rollDrops };
