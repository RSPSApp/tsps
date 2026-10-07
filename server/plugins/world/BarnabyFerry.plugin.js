/**
 * Captain Barnaby's ferry (https://oldschool.runescape.wiki/w/Captain_Barnaby).
 *
 * The pay-fare option sails between East Ardougne, Brimhaven and Rimmington for
 * 30 coins, halved to 15 while any Karamja gloves are worn. The Wiki's free
 * ring of charos(a) route is dialogue-only and is not offered here.
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");

const BASE_FARE = 30;
const GLOVES_FARE = 15;
const PORT_TOLERANCE = 8;

const PORTS = [
  { name: "East Ardougne", destination: new Location(2680, 3274, 0) },
  { name: "Brimhaven", destination: new Location(2768, 3227, 0) },
  { name: "Rimmington", destination: new Location(2916, 3225, 0) },
];

const KARAMJA_GLOVES = new Set([
  ItemIdentifiers.KARAMJA_GLOVES,
  ItemIdentifiers.KARAMJA_GLOVES_1,
  ItemIdentifiers.KARAMJA_GLOVES_2,
  ItemIdentifiers.KARAMJA_GLOVES_3,
  ItemIdentifiers.KARAMJA_GLOVES_4,
  ItemIdentifiers.KARAMJA_GLOVES_1_2,
  ItemIdentifiers.KARAMJA_GLOVES_2_2,
  ItemIdentifiers.KARAMJA_GLOVES_3_2,
].filter(Number.isInteger));

let core = null;
let pluginApi = null;

function currentPort(object) {
  const location = object?.getLocation?.();
  if (!location?.getX) {
    return null;
  }
  for (const port of PORTS) {
    if (
      Math.abs(location.getX() - port.destination.getX()) <= PORT_TOLERANCE &&
      Math.abs(location.getY() - port.destination.getY()) <= PORT_TOLERANCE
    ) {
      return port;
    }
  }
  return null;
}

function fareFor(player) {
  const gloves = player.getEquipment?.()?.get?.(Equipment.HANDS_SLOT)?.getId?.();
  return KARAMJA_GLOVES.has(Number(gloves ?? -1)) ? GLOVES_FARE : BASE_FARE;
}

function sail(player, port, fare) {
  const inventory = player.getInventory();
  if (inventory.getAmount(ItemIdentifiers.COINS) < fare) {
    player.sendMessage("You don't have enough coins for that fare.");
    return;
  }
  if (!core.TeleportHandler.checkReqs(player, port.destination)) {
    return;
  }
  inventory.deleteNumber(ItemIdentifiers.COINS, fare);
  inventory.refreshItems();
  player.sendMessage(`You pay ${fare} coins and board the ship.`);
  core.TeleportHandler.teleport(player, port.destination, core.TeleportType.NORMAL, false);
}

function payFare(event) {
  const { player, object } = event;
  const from = currentPort(object);
  const destinations = PORTS.filter((port) => port.name !== from?.name);
  const fare = fareFor(player);
  if (destinations.length === 0) {
    player.sendMessage("The captain isn't sailing anywhere from here.");
    return;
  }
  pluginApi.sendMultiChatboxPrompt(
    player,
    "Where would you like to sail to?",
    ...destinations.flatMap((port) => [`${port.name} (${fare} coins)`, () => sail(player, port, fare)])
  );
}

module.exports = {
  name: "BarnabyFerry",
  members: true,
  _test: { currentPort, fareFor, sail, payFare, PORTS },
  register(api) {
    core = api.core;
    pluginApi = api;
    api.onNpcInteraction("Captain Barnaby", { "Pay-fare": payFare });
    api.onNpcInteraction("Captain Barnaby", { "Pay-Fare": payFare });
  },
};
