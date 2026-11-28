"use strict";

/**
 * The way into the Killerwatt plane and back (docs/killerwatt-plane.md). After Ernest the Chicken,
 * on members worlds, Professor Oddenstein's portal machine on Draynor Manor's top floor opens a
 * portal to the plane (https://oldschool.runescape.wiki/w/Portal_machine), and the plane's Portal
 * Home leads back to his room (https://oldschool.runescape.wiki/w/Killerwatt_plane).
 *
 * - The portal is the multiloc `draynor_killerwatt_portal_hidden` (11355) between the two machines.
 *   Varbit `slayer_killerwatt_portal_check` shows it as the Interdimensional rift
 *   (`draynor_killerwatt_portal`, 11354, Enter) at 1 and hides it at 0. It follows the quest: sent at
 *   login and on every Ernest the Chicken stage change.
 * - Enter with insulated boots worn goes through. Without them Professor Oddenstein warns first
 *   (Transcript:Professor Oddenstein); the two answers that go on anyway go through.
 * - Portal Home's Enter goes back to the room.
 *
 * Members only: on a free-to-play world the plugin is not loaded, so the portal stays hidden.
 * No packet capture shows either crossing: the landing tiles are the Shortest Path transports'
 * (plugins/agent/data/transports.json), and the move plays no animation or sound, as a video of the way in shows.
 */

const ERNEST_THE_CHICKEN = "ernest_the_chicken";
const PORTAL_VARBIT = 1766; // slayer_killerwatt_portal_check
const RIFT_NAME = "Interdimensional rift";
const PORTAL_HOME_NAME = "Portal Home";
const INSULATED_BOOTS_NAME = "Insulated boots";
/** Transcript:Professor Oddenstein. The historical variant before it is the removed epilepsy warning. */
const WARNING_VARIANT = "attempting-to-enter-the-interdimensional-rift-without-wearing-insulated-boots";
/** The action both of the warning's going-through answers end on. */
const GO_THROUGH_ACTION = "The player enters the portal machine into the Killerwatt plane.";
const PLANE_LANDING = Object.freeze([2677, 5214, 2]);
const ROOM_LANDING = Object.freeze([3110, 3363, 2]);

let api = null;

function questComplete(player) {
  const request = { player, key: ERNEST_THE_CHICKEN, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function syncPortal(player) {
  player.getPacketSender().sendVarbit(PORTAL_VARBIT, questComplete(player) ? 1 : 0);
}

function portalOpen(player) {
  return player.getPacketSender().getVarbit(PORTAL_VARBIT) === 1;
}

function wearsInsulatedBoots(player) {
  const boots = player.getEquipment().get(api.core.Equipment.FEET_SLOT);
  return boots?.getDefinition?.()?.getName?.() === INSULATED_BOOTS_NAME;
}

function moveTo(player, [x, y, z]) {
  player.moveTo(new api.core.Location(x, y, z));
}

function enterRift({ player }) {
  if (wearsInsulatedBoots(player)) {
    moveTo(player, PLANE_LANDING);
    return;
  }
  api.emitCustomEvent("npc-dialogue:start", {
    player, npcId: api.core.NpcIdentifiers.PROFESSOR_ODDENSTEIN, variant: WARNING_VARIANT, exact: true, handled: false,
  });
}

function goThroughAfterWarning(event) {
  if (event.npcId !== api.core.NpcIdentifiers.PROFESSOR_ODDENSTEIN || event.text !== GO_THROUGH_ACTION) return;
  event.handled = true;
  event.end = true;
  // The quest can be reset while the warning is open.
  if (portalOpen(event.player)) moveTo(event.player, PLANE_LANDING);
}

function enterPortalHome({ player }) {
  moveTo(player, ROOM_LANDING);
}

function handleLogin({ player }) {
  syncPortal(player);
}

function handleStageChanged({ player, key }) {
  if (key === ERNEST_THE_CHICKEN && player) syncPortal(player);
}

module.exports = {
  name: "KillerwattPlane",
  description: "Opens Professor Oddenstein's portal to the Killerwatt plane after Ernest the Chicken, with his warning for players without insulated boots, and the plane's Portal Home back.",
  members: true,
  _test: {
    syncPortal, enterRift, goThroughAfterWarning, enterPortalHome,
    PORTAL_VARBIT, WARNING_VARIANT, GO_THROUGH_ACTION, PLANE_LANDING, ROOM_LANDING,
  },
  register(pluginApi) {
    api = pluginApi;
    pluginApi.onObjectInteraction(RIFT_NAME, { Enter: enterRift });
    pluginApi.onObjectInteraction(PORTAL_HOME_NAME, { Enter: enterPortalHome });
    pluginApi.onCustomEvent("npc-dialogue:action", goThroughAfterWarning);
    pluginApi.onCustomEvent("quest:stage-changed", handleStageChanged);
    pluginApi.onPlayerLogin(handleLogin);
  },
};
