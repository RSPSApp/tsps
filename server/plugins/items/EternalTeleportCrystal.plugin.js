"use strict";

/**
 * Eternal teleport crystal: https://oldschool.runescape.wiki/w/Eternal_teleport_crystal
 *
 * Teleports to Lletya or Prifddinas with infinite charges, and Toggle swaps which of the two is the
 * left-click. The toggle is the player's elven teleport crystal setting
 * (`mourning_teleport_destination_toggle`): at 0 the first option goes to Lletya and the second to
 * Prifddinas, as the cache labels them; at 1 the first goes to Prifddinas and the second to Lletya.
 * The teleport is the standard one (714, spotanim 111, three ticks), with no message and no charge.
 *
 * Ours: the toggle back to Lletya sends no message, as live's line for it is not known.
 */
const ITEM_NAME = "Eternal teleport crystal";
const TOGGLE_VARBIT_NAME = "mourning_teleport_destination_toggle";
const TOGGLE_ATTRIBUTE = "elven-teleport-crystal:prifddinas-default";
const TELEPORTED_EVENT = "elven-teleport-crystal:teleported";
const PRIFDDINAS_DEFAULT_MESSAGE = "Your enchanted teleport crystals will now default to Prifddinas.";
const WILDERNESS_LEVEL_LIMIT = 20;

const LLETYA = { x: 2328, y: 3170, z: 0 };
/** Any tile of the square within two tiles of this one. */
const PRIFDDINAS = { x: 3264, y: 6066, z: 0 };
const PRIFDDINAS_RADIUS = 2;

let api = null;
let core = null;

function prifddinasDefault(player) {
  return player.getAttribute(TOGGLE_ATTRIBUTE) === true;
}

function sendToggle(player) {
  const id = core.CacheDefinitions.getVarbitId(TOGGLE_VARBIT_NAME);
  const sender = player.getPacketSender();
  const value = prifddinasDefault(player) ? 1 : 0;
  if (id != null && id >= 0 && sender.getVarbit(id) !== value) sender.sendVarbit(id, value);
}

/** The first option (click 1) is the default destination, the second the other one. */
function destinationFor(player, clickType) {
  return (clickType === 1) === prifddinasDefault(player) ? "prifddinas" : "lletya";
}

function tileFor(destination) {
  if (destination === "lletya") return new core.Location(LLETYA.x, LLETYA.y, LLETYA.z);
  const offset = () => core.Misc.randomInclusive(-PRIFDDINAS_RADIUS, PRIFDDINAS_RADIUS);
  return new core.Location(PRIFDDINAS.x + offset(), PRIFDDINAS.y + offset(), PRIFDDINAS.z);
}

function teleport(event) {
  const { player, itemId, clickType } = event;
  const destination = destinationFor(player, clickType);
  const tile = tileFor(destination);
  const { TeleportHandler, TeleportType } = core;
  if (!TeleportHandler.checkReqs(player, tile, WILDERNESS_LEVEL_LIMIT)) return true;
  TeleportHandler.confirm(player, tile, () => TeleportHandler.teleport(player, tile, TeleportType.NORMAL, false,
    () => api.emitCustomEvent(TELEPORTED_EVENT, { player, itemId, destination })), WILDERNESS_LEVEL_LIMIT, { item: itemId });
  return true;
}

function toggle({ player }) {
  const toPrifddinas = !prifddinasDefault(player);
  player.setAttribute(TOGGLE_ATTRIBUTE, toPrifddinas);
  sendToggle(player);
  if (toPrifddinas) player.sendMessage(PRIFDDINAS_DEFAULT_MESSAGE);
  return true;
}

function login({ player }) {
  if (player) sendToggle(player);
}

module.exports = {
  name: "EternalTeleportCrystal",
  description: "Eternal teleport crystal: unlimited Lletya and Prifddinas teleports, with Toggle swapping the left-click destination.",
  members: true,
  _test: { TOGGLE_ATTRIBUTE, TELEPORTED_EVENT, PRIFDDINAS_DEFAULT_MESSAGE, LLETYA, PRIFDDINAS, PRIFDDINAS_RADIUS, destinationFor },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(TOGGLE_ATTRIBUTE, false);
    api.onItemAction(ITEM_NAME, { Lletya: teleport, Prifddinas: teleport, Toggle: toggle });
    api.onPlayerLogin(login);
  },
};
