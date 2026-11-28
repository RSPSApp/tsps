/**
 * A Moon subdued (docs/moons-of-peril.md), as captured, for the player who did it:
 * - at once: pmoon_boss_hp 0, the Moon's dead varbit, hide_npc 1 (the Moon turns to its empty
 *   form for them), and a stand-in on its tile that faces them and plays the Moon's death;
 * - 5 ticks on: the HUD goes and the portal overlay opens (script 5984 [52841, 1355188], sound 7928);
 * - 6 ticks on: hide_npc 0 and the stand-in goes;
 * - 7 ticks on: the boss varbits reset and the player lands by a camp's cooking stove: which one
 *   depends on the Moons already down (Wiki; data moons.<moon>.landing).
 * Then "moons-of-peril:killed" { player, moon } tells the quest and anyone else.
 */
const Common = require("./Common.MoonsOfPeril");

// Ticks after login before missed kills are re-sent, so the quest's transcript opens on a
// loaded client.
const LOGIN_RESEND_TICKS = 2;

function landing(player, moon) {
  const { landing: rule } = Common.data.moons[moon];
  const after = Object.entries(rule.ifDead ?? {}).find(([other]) => Common.isDead(player, other));
  const camp = after ? after[1] : rule.default;
  return Common.location(Common.data.camps[camp]);
}

/** The face angle (0 south, 512 west, 1024 north, 1536 east) from a large NPC's centre to a mobile. */
function angleTo(npc, target) {
  const half = (npc.getSize() - 1) / 2;
  const dx = target.getLocation().getX() - (npc.getLocation().getX() + half);
  const dy = target.getLocation().getY() - (npc.getLocation().getY() + half);
  return Math.round(Math.atan2(-dx, -dy) * (1024 / Math.PI)) & 2047;
}

function kill(fight) {
  if (fight.killed) return;
  const { player, arena, moon } = fight;
  const { kill: timing } = Common.data;
  fight.killed = true;
  fight.stopSpecial();
  const camp = landing(player, moon);
  Common.setDead(player, moon, true);
  Common.varbit(player, "hp", 0);
  fight.sendHideNpc();

  const [x, y, z] = arena.spec.tile;
  const standIn = Common.api.spawnNpc({ id: Common.data.trackingNpc, x, y, z, wanderRadius: 0, owner: player, ownerOnly: true });
  if (standIn) {
    standIn.__skipDefaultRespawn = true;
    standIn.getMovementQueue().setBlockMovement(true);
    standIn.setMobileInteraction(player);
    // Snapped round to the player at once, so the death plays towards them (capture).
    standIn.setFaceAngle(angleTo(standIn, player));
    standIn.performGraphic(Common.graphic(arena.spec.deathSpot));
  }

  Common.later(timing.hudTicks, () => {
    if (!player.isRegistered()) return;
    Common.closeHud(player);
    Common.portal(player, Common.data.portal.leave);
  });
  Common.later(timing.standInTicks, () => {
    if (standIn?.isRegistered?.()) Common.api.removeNpc(standIn);
    if (player.isRegistered()) Common.varbit(player, "hideNpc", 0);
  });
  Common.later(timing.landTicks, () => {
    // A logout here is caught up at login (resendKills).
    if (!player.isRegistered()) return;
    // A death in the meantime has ended the fight and moved the player already.
    if (!fight.ended) {
      fight.end();
      player.getMovementQueue().reset();
      player.moveTo(camp);
    }
    Common.closePortal(player);
    Common.api.emitCustomEvent("moons-of-peril:killed", { player, moon });
  });
}

/**
 * Re-sends the kill of every subdued Moon after login, for a kill whose landing a logout cut
 * short. The quest counts each Moon once, so the ones it already has change nothing.
 */
function resendKills({ player }) {
  if (Common.deadMask(player) === 0) return;
  Common.later(LOGIN_RESEND_TICKS, () => {
    if (!player.isRegistered()) return;
    for (const moon of Common.MOONS) {
      if (Common.isDead(player, moon)) Common.api.emitCustomEvent("moons-of-peril:killed", { player, moon });
    }
  });
}

module.exports = { kill, landing, resendKills, angleTo };
