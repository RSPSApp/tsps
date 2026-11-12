/**
 * The Sire's death, as captured: only its apocalypse form dies (Fight: until then a hit leaves
 * it at 1). On the killing blow it plays sire_death (npc-combat-defs), its minions die with it and
 * its tentacles fall asleep; 2 ticks later it is gone with "Your Abyssal Sire kill count is: N."
 * (varp 1526, through Combat Achievements) and its loot (NpcDrops); its chamber is back, the
 * sleeping Sire, lungs and tentacles with it, a tick after that. A task kill is worth 478 Slayer
 * experience (Wiki), not its hitpoints.
 */
const Common = require("./Common.AbyssalSire");
const CombatAchievements = require("./CombatAchievements.AbyssalSire");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");

function sireBeforeDeath(event) {
  const npc = event.npc;
  if (!Common.isSire(npc) || event.preventDeath) return;
  const fight = npc.__sireFight;
  if (fight && !fight.stopped && fight.dying()) return;
  event.preventDeath = true;
  npc.setHitpoints(Math.max(1, npc.getHitpoints()));
}

function sireDeath({ npc, killer }) {
  if (!Common.isSire(npc)) return;
  const lair = npc.__sireLair;
  const fight = npc.__sireFight;
  const player = fight?.player ?? (killer?.isPlayer?.() ? killer : null);
  if (player?.isRegistered()) {
    const own = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
    const total = CombatAchievements.killed(player, own, (kills) => sendBossKillCount(player, Common.message("killCount", { kills })));
    player.setAttribute(Common.KILLS_ATTRIBUTE, Math.max(own, total ?? 0));
    if (total == null) player.getPacketSender().sendConfig(Common.data.kill.killCountVarp, own);
    if (fight) CombatAchievements.judge(fight);
  }
  lair?.reset(Common.data.kill.respawnTicks);
}

/** "slayer:task-kill": the Sire's Slayer experience is its own, not its hitpoints. */
function slayerXp(kill) {
  if (Common.isSire(kill?.npc)) kill.xp = Common.data.kill.slayerXp;
}

function sendKillCount({ player }) {
  const kills = Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0;
  if (kills > 0) player.getPacketSender().sendConfig(Common.data.kill.killCountVarp, kills);
}

module.exports = function attachKills(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.onNpcBeforeDeath(sireBeforeDeath);
  api.onNpcDeath(sireDeath);
  api.onCustomEvent("slayer:task-kill", slayerXp);
  api.onPlayerLogin(sendKillCount);
};
