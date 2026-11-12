/**
 * Skotizo's death, as captured: on the killing blow he plays qip_ds_delrith_banished (npc-combat-defs),
 * "Your Skotizo kill count is: N." (varp 1527, through Combat Achievements), the altars go back to
 * sleep and the HUD closes; 15 ticks later (`deathTicks`) the loot lands on his tile (NpcDrops)
 * and he is gone. Any spawns or dark ankou left fade a few ticks after him (Wiki).
 */
const Common = require("./Common.Skotizo");
const CombatAchievements = require("./CombatAchievements.Skotizo");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");

function bossBeforeDeath(event) {
  const session = event.npc?.__skotizoLair;
  const fight = session?.fight;
  if (!fight || event.npc !== fight.boss || fight.stopped || event.preventDeath) return;
  const player = session.player;
  const own = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
  const total = CombatAchievements.killed(player, own, (kills) => {
    sendBossKillCount(player, `Your Skotizo kill count is: <col=ff0000>${kills}</col>.`);
  });
  player.setAttribute(Common.KILLS_ATTRIBUTE, Math.max(own, total ?? 0));
  if (total == null) player.getPacketSender().sendConfig(Common.DATA.killCountVarp, own);
  CombatAchievements.judge(fight);
  fight.bossDied();
}

module.exports = function attachKills(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.onNpcBeforeDeath(bossBeforeDeath);
};
