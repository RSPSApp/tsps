/**
 * Amoxliatl's death, as captured: on the killing blow she plays her death (11532,
 * npc-combat-defs) and every icy pool goes with a puff. 2 ticks later (`deathTicks`) she is gone:
 * "Your Amoxliatl kill count is: N." (varp 4403, through Combat Achievements), the fight's
 * length against the personal best, and the loot on her middle tile (NpcDrops). The HUD fades 4
 * ticks after that. She rises again on her platform 29 ticks later (Wiki: respawn) for as long as
 * the player stays.
 */
const Common = require("./Common.Amoxliatl");
const CombatAchievements = require("./CombatAchievements.Amoxliatl");
const Scoreboard = require("./Scoreboard.Amoxliatl");

const HUD_FADE_AFTER_REMOVAL_TICKS = 4;
const BOSS_NAME = "Amoxliatl";

function bossBeforeDeath(event) {
  const fight = event.npc?.__amoxliatlFight;
  if (!fight || event.preventDeath || fight.over) return;
  fight.died();
}

function bossDeath(event) {
  const fight = event.npc?.__amoxliatlFight;
  if (!fight || fight.stopped) return;
  const { session, player } = fight;
  if (session.quest) {
    fight.hideHud();
    session.end();
    Common.api.emitCustomEvent('amoxliatl:quest-defeated', { player });
    return;
  }
  const ticks = fight.duration();
  const best = Number(player.getAttribute(Common.BEST_TICKS_ATTRIBUTE)) || 0;
  if (!best || ticks < best) player.setAttribute(Common.BEST_TICKS_ATTRIBUTE, ticks);
  if (!best || ticks < best) Common.api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
  const duration = !best || ticks < best
    ? `Fight duration: <col=ff0000>${Common.formatTicks(ticks)}</col> (new personal best)`
    : `Fight duration: <col=ff0000>${Common.formatTicks(ticks)}</col>. Personal best: ${Common.formatTicks(best)}`;
  const own = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
  // As captured, both lines come before any Combat Achievement the kill finishes.
  const total = CombatAchievements.killed(player, own, (kills) => {
    player.sendMessage(`Your Amoxliatl kill count is: <col=ff0000>${kills}</col>.`);
    player.sendMessage(duration);
  });
  player.setAttribute(Common.KILLS_ATTRIBUTE, Math.max(own, total ?? 0));
  if (total == null) player.getPacketSender().sendConfig(Common.data.kill.killCountVarp, own);
  session.kills++;
  Scoreboard.won(ticks);
  CombatAchievements.judge(fight, ticks);

  Common.later(HUD_FADE_AFTER_REMOVAL_TICKS, () => {
    fight.hideHud();
    fight.stop();
  });
  session.boss = null;
  Common.later(Common.data.spawn.respawnTicks, () => session.spawnBoss());
}

/** The loot lands on her middle tile, as captured, not her south-west corner. */
function lootOnMiddle(where) {
  const fight = where.npc?.__amoxliatlFight;
  if (!fight) return;
  const { Projectile } = Common.core;
  where.location = Projectile.centreOf(where.npc);
}

function sendKillCount({ player }) {
  const kills = Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0;
  if (kills > 0) player.getPacketSender().sendConfig(Common.data.kill.killCountVarp, kills);
}

module.exports = function attachKills(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_TICKS_ATTRIBUTE, 0);
  api.onNpcBeforeDeath(bossBeforeDeath);
  api.onNpcDeath(bossDeath);
  api.onCustomEvent("npc-drops:location", lootOnMiddle);
  api.onPlayerLogin(sendKillCount);
};
