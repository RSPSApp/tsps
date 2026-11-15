/**
 * The Guardians' deaths (Wiki): Dawn finished with a hammer starts the last phase (Fight); Dusk
 * finished is the kill - "Your Grotesque Guardians kill count is: N." (Combat Achievements counts
 * it, as it times the fight for its speed tasks), the fight's duration from the bell with the
 * personal best (rsprox), and 1,350 Slayer experience on task; the roof's
 * statues go back on their plinths, ready for the bell. Dawn gives nothing of her own. Dusk's
 * kill rolls the drop table in data/grotesque-guardians.json (Wiki, Drops), including Noon, in place of
 * NpcDrops' death roll for her (npc-drops:generated).
 */
const Common = require("./Common.GrotesqueGuardians");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");
const BOSS_NAME = "Grotesque Guardians";

function countedKills(player) {
  const request = { player, monster: Common.data.kill.monster };
  Common.api.emitCustomEvent("combat-achievements:count", request);
  return Number.isInteger(request.total) ? request.total : null;
}

/**
 * Dusk's loot (Wiki, Drops): the table in data/grotesque-guardians.json through NpcDrops' roller,
 * so weights, quantities and the Noon tertiary stay data. The pet goes through Pets' award.
 * `contextual`: what NpcDrops' own death roll for her carried (an echo orb), placed and told to the
 * loot tracker with the table's loot as one kill, as gargboss_dusk_death (rsprox_transcripts/237/01144.txt).
 */
function rollDrops(player, npc, contextual = []) {
  const drops = [];
  Common.api.emitCustomEvent("npc-drops:roll-table", { player, npc, table: Common.data.drops, drops });
  // NpcDrops' own death roll for Dusk (empty: she has no dumped table, but it carries the contextual drops) already
  // counts the kill in the collection log; this roll only logs the loot.
  Common.api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: npc.getId?.(), drops, countKill: false });
  Common.api.emitCustomEvent("npc-drops:place", {
    player, drops: [...contextual, ...drops], location: npc.getLocation(), npcId: Common.ids.npcs.duskDeath,
  });
}

/**
 * "npc-drops:generated": NpcDrops' death roll for Dusk is taken over and rolled with her table, so the kill is placed
 * and reported once (live sends one loot tracker key per kill). Its drops stay in place: the collection log reads them.
 */
function duskGenerated(event) {
  if (!Common.isDusk(event?.npc)) return;
  const player = event.player?.isPlayer?.() ? event.player : null;
  if (!player?.isRegistered?.()) return;
  event.handled = true;
  rollDrops(player, event.npc, Array.isArray(event.drops) ? event.drops : []);
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
  const killLine = Common.message("killCount", { kills: Math.max(own, countedKills(player) ?? 0) });
  const lines = [];
  if (startedAt >= 0) {
    const ticks = Common.core.World.getProcessCycle() - startedAt;
    const previous = Number(player.getAttribute(Common.BEST_ATTRIBUTE)) || 0;
    const best = previous > 0 ? Math.min(previous, ticks) : ticks;
    player.setAttribute(Common.BEST_ATTRIBUTE, best);
    if (!previous || ticks < previous) Common.api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
    lines.push(Common.message("duration", { time: Common.formatTicks(ticks), best: Common.formatTicks(best) }));
  }
  Common.later(1, () => {
    sendBossKillCount(player, killLine);
    lines.forEach((line) => player.sendMessage(line));
  });
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
  api.onCustomEvent("npc-drops:generated", duskGenerated);
  api.onCustomEvent("slayer:task-kill", slayerXp);
  api.onCustomEvent("slayer:target-eligible", dawnKillEligible);
}

module.exports = { attach, guardianDeath, slayerXp, dawnKillEligible, countedKills, rollDrops, duskGenerated };
