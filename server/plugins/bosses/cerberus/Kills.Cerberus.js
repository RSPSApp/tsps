/**
 * Cerberus' death: her souls and lava go with her, the kill is counted ("Your Cerberus kill
 * count is: N.", varp total_cerberus_kills, through Combat Achievements) and a task kill is worth
 * 690 Slayer experience (Wiki). Her loot is the "cerberus" table (NpcDrops), the Hellpuppy roll
 * the pets table's, and she respawns as she sat, from her world spawn.
 */
const Common = require("./Common.Cerberus");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");

/** Counts the kill; `announce(kills)` tells the player the count before any task finishes. */
function countKill(player, ownKills, announce) {
  let announced = false;
  const request = {
    player,
    monster: Common.data.kill.monster,
    count: ownKills,
    announce: (kills) => {
      announced = true;
      announce(kills);
    },
  };
  Common.api.emitCustomEvent("combat-achievements:kill", request);
  if (!announced) announce(ownKills);
  return Number.isInteger(request.total) ? request.total : null;
}

function cerberusDeath({ npc, killer }) {
  if (!Common.isCerberus(npc)) return;
  const fight = npc.__cerberusFight;
  fight?.stop();
  if (fight?.arena?.fight === fight) fight.arena.fight = null;
  const player = killer?.isPlayer?.() ? killer : null;
  if (!player?.isRegistered?.()) return;
  const own = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
  const total = countKill(player, own, (kills) => sendBossKillCount(player, Common.message("killCount", { kills })));
  player.setAttribute(Common.KILLS_ATTRIBUTE, Math.max(own, total ?? 0));
  if (total == null) player.getPacketSender().sendConfig(Common.data.kill.killCountVarp, own);
}

/** "slayer:task-kill": Cerberus' Slayer experience is her own, not her hitpoints. */
function slayerXp(kill) {
  if (Common.isCerberus(kill?.npc)) kill.xp = Common.data.kill.slayerXp;
}

function sendKillCount({ player }) {
  const kills = Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0;
  if (kills > 0) player.getPacketSender().sendConfig(Common.data.kill.killCountVarp, kills);
}

function attach(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.onNpcDeath(cerberusDeath);
  api.onCustomEvent("slayer:task-kill", slayerXp);
  api.onPlayerLogin(sendKillCount);
}

module.exports = { attach, cerberusDeath, slayerXp, countKill };
