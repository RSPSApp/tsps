/**
 * Ring of life and Defence cape (https://oldschool.runescape.wiki/w/Ring_of_life).
 *
 * When a combat hit leaves the wearer at 10% or less of their maximum Hitpoints
 * (but not dead), the ring teleports them to their respawn point and crumbles;
 * a worn Defence cape (or max cape) does the same without being destroyed, unless its
 * effect is toggled off, and goes to the Ardougne marketplace when its respawn is set there
 * (the Skillcapes plugin's "skillcape:ring-of-life"). The teleport works up to level 30
 * Wilderness, but Tele Block stops it and the effect never cures poison.
 *
 * The ring's own "Toggle-respawn" (Wiki): after the medium Ardougne Diary its teleport can be switched to East
 * Ardougne, the marketplace tile the Defence cape's option uses. The prompt and refusal lines are TSPS wording.
 */
const Equipment = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment").Equipment;
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");

let core = null;
let pluginApi = null;
let ringIds = new Set();

const ARDOUGNE_ATTRIBUTE = "ring-of-life:ardougne-respawn";
const ARDOUGNE_MARKET = [2662, 3305, 0];

function ardougneDiaryDone(player) {
  const request = { player, diary: "ardougne", tier: "medium", complete: false };
  pluginApi.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function toggleRespawn(event) {
  const { player } = event;
  if (!ringIds.has(event.itemId)) return false;
  event.handled = true;
  if (!ardougneDiaryDone(player)) {
    player.sendMessage("You need to complete the medium Ardougne Diary to change where your ring takes you.");
    return true;
  }
  pluginApi.sendMultiChatboxPrompt(player, "Choose a respawn destination.",
    "Ardougne", () => player.setAttribute(ARDOUGNE_ATTRIBUTE, true),
    "Default", () => player.setAttribute(ARDOUGNE_ATTRIBUTE, false));
  return true;
}

function onIncomingDamage(entity, hitDamage) {
  if (!entity?.isPlayer?.() || !(hitDamage?.getDamage?.() > 0)) {
    return;
  }
  const player = entity.getAsPlayer();
  const hitpoints = player.getSkillManager();
  const current = hitpoints.getCurrentLevel(Skill.HITPOINTS);
  const max = hitpoints.getMaxLevel(Skill.HITPOINTS);
  const remaining = current - hitDamage.getDamage();
  if (remaining <= 0 || remaining > Math.floor(max / 10)) {
    return;
  }

  saveFromDeath(player);
}

/**
 * The ring's (or a Defence cape's) escape once the hit has been judged dangerous: true when it
 * teleported the wearer. Wintertodt asks for it through "ring-of-life:activate" when warmth
 * drops below 10% (Wiki), as combat does at 10% Hitpoints.
 */
function saveFromDeath(player) {
  const equipment = player.getEquipment();
  const ringItem = equipment.get(Equipment.RING_SLOT);
  const ringId = ringItem?.getId?.();
  const hasRing = ringIds.has(ringId);
  const cape = { player, active: false, destination: null };
  if (!hasRing) pluginApi?.emitCustomEvent("skillcape:ring-of-life", cape);
  const hasCape = cape.active === true;
  if (!hasRing && !hasCape) {
    return false;
  }

  if (!player.getCombat()?.getTeleblockTimer?.()?.finished?.()) {
    return false;
  }
  const tile = hasRing
    ? (player.getAttribute(ARDOUGNE_ATTRIBUTE) === true ? ARDOUGNE_MARKET : null)
    : cape.destination;
  const destination = tile ? new core.Location(tile[0], tile[1], tile[2] ?? 0) : core.GameConstants.DEFAULT_LOCATION;
  if (!core.TeleportHandler.checkReqs(player, destination, 30)) {
    return false;
  }

  if (hasRing) {
    equipment.deleteNumber(ringId, 1);
    equipment.refreshItems();
    player.sendMessage("Your Ring of Life saves you and is destroyed in the process.");
  } else {
    player.sendMessage("Your Defence cape saves you.");
  }
  core.TeleportHandler.teleport(player, destination, core.TeleportType.NORMAL, false);
  return true;
}

function onLowWarmth(request) {
  if (request?.player && saveFromDeath(request.player)) request.activated = true;
}

module.exports = {
  name: "RingOfLife",
  members: true,
  _test: { onIncomingDamage, onLowWarmth, toggleRespawn, ARDOUGNE_ATTRIBUTE, ARDOUGNE_MARKET },
  register(api) {
    core = api.core;
    pluginApi = api;
    ringIds = new Set([core.ItemIdentifiers.RING_OF_LIFE]);
    api.persistAttribute(ARDOUGNE_ATTRIBUTE, false);
    api.registerIncomingDamageModifier(onIncomingDamage);
    api.onCustomEvent("ring-of-life:activate", onLowWarmth);
    api.onItemAction("Ring of life", { "Toggle-respawn": toggleRespawn });
  },
};
