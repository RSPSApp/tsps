/**
 * The kill (Wiki: Shellbane_gryphon): the kill count (varp total_gryphon_boss_kills, saved), its
 * message, a second roll on the main table (the Wiki's two rolls; NpcDrops rolls one), and the
 * cave's respawn. Slayer experience is the gryphon's 400 hitpoints, as Tasks.Slayer.js gives.
 */
const Common = require("./Common.ShellbaneGryphon");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");

function bossDied({ npc, killer }) {
  if (npc?.getId?.() !== Common.ids.npcs.boss) return;
  const cave = npc.__sgCave;
  cave?.bossDied();
  const player = killer?.isPlayer?.() ? killer.getAsPlayer() : null;
  if (!player?.isRegistered?.()) return;
  const kills = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(Common.KILLS_ATTRIBUTE, kills);
  player.getPacketSender().sendConfig(Common.ids.varps.kills, kills);
  Common.later(1, () => sendBossKillCount(player, Common.message("killCount", { kills })));
}

/** "npc-drops:roll": the second main-table roll. */
function secondRoll(event) {
  if (event.npcId !== Common.ids.npcs.boss || event.__sgExtra) return;
  event.__sgExtra = true;
  Common.api.emitCustomEvent("npc-drops:extra-rolls", { player: event.player, npc: event.npc, npcId: event.npcId, rolls: 1, drops: event.drops });
}

function onLogin({ player }) {
  player.getPacketSender().sendConfig(Common.ids.varps.kills, Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0);
}

function attach(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.onNpcDeath(bossDied);
  api.onCustomEvent("npc-drops:roll", secondRoll);
  api.onPlayerLogin(onLogin);
}

module.exports = { attach, bossDied, secondRoll };
