/**
 * The Mad Angel's death, as captured: 7 ticks into its death animation (npc-combat-defs
 * `deathTicks`) the kill count goes up ("Your Mad Angel kill count is: N.", varp 5712), the
 * fight's length is told against the personal best, the loot drops (NpcDrops, its Wiki table),
 * and the angel lies there; the HUD goes a little later. The corpse stays for its respawn time
 * (Wiki: 26 ticks), then the angel is back on its spot, dormant, to be woken again.
 */
const Common = require("./Common.MadAngel");

function onAngelDeath(event) {
  const session = event.npc?.__madAngel;
  if (!session || !session.fight) return;
  const { npc } = event;
  const fight = session.fight;
  const player = session.player;
  const { npcs, death, hud, killCountVarp } = Common.data;
  fight.stop();
  npc.setNpcTransformationId(npcs.dead);
  event.remains = { ticks: death.respawnTicks };

  const kills = (Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(Common.KILLS_ATTRIBUTE, kills);
  player.getPacketSender().sendConfig(killCountVarp, kills);
  player.sendMessage(`Your Mad Angel kill count is: <col=ff0000>${kills}</col>.`);
  const ticks = fight.tick - fight.startTick;
  const best = Number(player.getAttribute(Common.BEST_TICKS_ATTRIBUTE)) || 0;
  if (!best || ticks < best) {
    player.setAttribute(Common.BEST_TICKS_ATTRIBUTE, ticks);
    player.sendMessage(`Fight duration: <col=ff0000>${Common.formatTicks(ticks)}</col> (new personal best)`);
  } else {
    player.sendMessage(`Fight duration: <col=ff0000>${Common.formatTicks(ticks)}</col>. Personal best: ${Common.formatTicks(best)}`);
  }

  Common.later(hud.fadeOutAfterDeathTicks, () => player.isRegistered() && fight.hideHud());
  // The corpse goes with the respawn; a fresh angel waits on the spot for the next fight.
  Common.later(death.respawnTicks + 1, () => {
    if (session.ended) return;
    session.fight = null;
    session.boss = null;
    session.spawnAngel();
  });
}

function sendKillCount({ player }) {
  const kills = Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0;
  if (kills > 0) player.getPacketSender().sendConfig(Common.data.killCountVarp, kills);
}

module.exports = function attachKills(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE);
  api.persistAttribute(Common.BEST_TICKS_ATTRIBUTE);
  api.onNpcDeath(onAngelDeath);
  api.onPlayerLogin(sendKillCount);
};
