/**
 * The kill (Wiki: Shellbane_gryphon): the kill count (varp total_gryphon_boss_kills, saved), its
 * message, a second roll on the main table (the Wiki's two rolls; NpcDrops rolls one), and the
 * cave's respawn. Slayer experience is the gryphon's 400 hitpoints, as Tasks.Slayer.js gives.
 * Off task the gryphon drops nothing unless its elite clue step is in the inventory as it dies
 * (Wiki: Shellbane_gryphon, Clue scroll (elite) - Their bane awaits). Each kill and its time go
 * on Elder Nama's board (Scoreboard.ShellbaneGryphon.js).
 */
const Common = require("./Common.ShellbaneGryphon");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");
const Scoreboard = require("./Scoreboard.ShellbaneGryphon");

function bossDied({ npc, killer }) {
  if (npc?.getId?.() !== Common.ids.npcs.boss) return;
  const cave = npc.__sgCave;
  const ticks = cave?.fight?.tickCount ?? 0;
  cave?.bossDied();
  const player = killer?.isPlayer?.() ? killer.getAsPlayer() : null;
  // Decided here, before NpcDrops rolls, the Slayer task counts this kill and Treasure Trails
  // swaps the clue for its next one (plugins load in path order: bosses/ before npcs/,
  // skills/ and treasuretrails/).
  npc.__sgNoLoot = !player || !(Common.onTask(player) || Common.holdsClueStep(player));
  if (!player?.isRegistered?.()) return;
  const kills = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(Common.KILLS_ATTRIBUTE, kills);
  player.getPacketSender().sendConfig(Common.ids.varps.kills, kills);
  Common.later(1, () => sendBossKillCount(player, Common.message("killCount", { kills })));
  Scoreboard.won(player, ticks);
}

/** "npc-drops:claim": an off-task kill without the clue step drops nothing. */
function claimDrops(claim) {
  if (claim.npcId !== Common.ids.npcs.boss || claim.npc?.__sgNoLoot !== true) return;
  claim.handled = true;
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
  api.onCustomEvent("npc-drops:claim", claimDrops);
  api.onPlayerLogin(onLogin);
}

module.exports = { attach, bossDied, secondRoll, claimDrops };
