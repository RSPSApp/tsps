"use strict";

/**
 * The boss health HUD (the BossHud plugin's boss-hud:* events) in the Chambers of Xeric.
 *
 * rsprox captures (recordings 820, 843, 3282, 3285, 3389): the bar shows for Tekton, the
 * Muttadiles, the Vanguards, Vasa Nistirio and the Great Olm's head and claws, for whichever of
 * them the player last hit; it follows the NPC's hitpoints and goes when it dies or the player
 * leaves its room.
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");

/** NPC ids (and forms) that get the bar. */
const BOSSES = new Set([
  7540, 7541, 7542, 7543, 7544, 7545, // Tekton
  7561, 7562, 7563, // the Muttadiles
  7527, 7528, 7529, // the Vanguards
  7565, 7566, 7567, // Vasa Nistirio
  7553, 7554, 7555, // the Great Olm's right claw, head and left claw
]);
const HUD_ATTRIBUTE = "cox:boss-hud";

function formOf(npc) {
  const form = npc.getNpcTransformationId?.() ?? -1;
  return form > 0 ? form : npc.getId();
}

function isBoss(npc) {
  return BOSSES.has(npc.getId()) || BOSSES.has(formOf(npc));
}

function values(player, npc) {
  return { player, npcId: formOf(npc), current: Math.max(0, npc.getHitpoints()), maximum: npc.getMaxHitpoints() };
}

/** A hit on one of them shows its bar (or switches it to this one). */
function showOnHit(event) {
  const { player, target } = event;
  if (!target?.__coxRoom || !isBoss(target) || target.__coxRoom.raid !== Raid.raidOf(player)) return;
  const shown = player.getAttribute(HUD_ATTRIBUTE);
  player.setAttribute(HUD_ATTRIBUTE, target);
  Shared.api().emitCustomEvent(shown === target ? "boss-hud:update" : "boss-hud:show", values(player, target));
}

/** Each tick: follow the hitpoints; gone when the NPC is, or the player left its room. */
function followHuds(raid) {
  for (const player of raid.players) {
    const npc = player.getAttribute(HUD_ATTRIBUTE);
    if (!npc) continue;
    const alive = npc.isRegistered?.() && npc.getHitpoints() > 0;
    if (!alive || raid.roomAt(player.getLocation()) !== npc.__coxRoom) {
      player.setAttribute(HUD_ATTRIBUTE, null);
      Shared.api().emitCustomEvent("boss-hud:hide", { player });
      continue;
    }
    Shared.api().emitCustomEvent("boss-hud:update", values(player, npc));
  }
}

/** Leaving the raid takes the bar away. */
function hideOnLeave(raid, player) {
  if (!player.getAttribute(HUD_ATTRIBUTE)) return;
  player.setAttribute(HUD_ATTRIBUTE, null);
  Shared.api().emitCustomEvent("boss-hud:hide", { player, fade: false, afterTicks: 0 });
}

module.exports = function registerCoxHud(api) {
  Shared.bind(api);
  api.onPlayerDealtDamage(showOnHit);
  Raid.onTick(followHuds);
  Raid.onLeave(hideOnLeave);
};

Object.assign(module.exports, { BOSSES, isBoss });
