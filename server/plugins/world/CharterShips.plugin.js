/**
 * Charter ships (https://oldschool.runescape.wiki/w/Charter_ship).
 *
 * Trader crewmembers (and Trader Stan at Port Sarim) sell passage between the
 * ports in data/definitions/charter-ships.json. Fares are halved by a worn
 * ring of charos(a) or by Cabin Fever; with both they are a quarter. Destination
 * quest gates only block quests that are registered here, so the ones this
 * server does not have (Cabin Fever, Song of the Elves, Great Kourend) are
 * offered rather than silently locked.
 */
const fs = require("fs");
const path = require("path");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const QuestRuntime = require("../quests/QuestRuntime");

const CABIN_FEVER = "Cabin Fever";
const CHAROS_IDS = new Set([
  ItemIdentifiers.RING_OF_CHAROS,
  ItemIdentifiers.RING_OF_CHAROS_A_,
]);
const PORT_TOLERANCE = 12;

let core = null;
let pluginApi = null;
let portsByName = new Map();
let fares = null;

function loadData() {
  const file = path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "charter-ships.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const ports = (data.ports ?? []).map((entry) => ({
    name: entry.name,
    destination: new Location(entry.x, entry.y, entry.z ?? 0),
    requires: entry.requires ?? null,
  }));
  return { ports, fares: data.fares ?? {} };
}

function questComplete(player, name) {
  if (!name || name === "Great Kourend") {
    return true;
  }
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.name === name);
  return quest ? quest.isComplete(player) : true;
}

/** Benefits (the Cabin Fever discount) only count an implemented, completed quest. */
function questCompletedOnly(player, name) {
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.name === name);
  return quest ? quest.isComplete(player) : false;
}

function currentPort(object) {
  const location = object?.getLocation?.();
  if (!location?.getX) {
    return null;
  }
  for (const port of portsByName.values()) {
    if (
      Math.abs(location.getX() - port.destination.getX()) <= PORT_TOLERANCE &&
      Math.abs(location.getY() - port.destination.getY()) <= PORT_TOLERANCE
    ) {
      return port;
    }
  }
  return null;
}

function wearingCharosRing(player) {
  const ringId = Number(player.getEquipment?.()?.get?.(Equipment.RING_SLOT)?.getId?.() ?? -1);
  return CHAROS_IDS.has(ringId);
}

/** Base fare between two ports; returns null when no route exists. */
function fareBetween(from, to) {
  if (!from || !to || from === to) {
    return null;
  }
  const direct = fares[`${from}|${to}`];
  if (Number.isFinite(direct)) {
    return direct;
  }
  const reverse = fares[`${to}|${from}`];
  return Number.isFinite(reverse) ? reverse : null;
}

/** Wiki: ring of charos(a) or Cabin Fever halves, both quarters. */
function fareFor(player, from, to) {
  const base = fareBetween(from, to);
  if (base == null) {
    return null;
  }
  let multiplier = 1;
  if (wearingCharosRing(player)) {
    multiplier /= 2;
  }
  if (questCompletedOnly(player, CABIN_FEVER)) {
    multiplier /= 2;
  }
  return Math.max(0, Math.floor(base * multiplier));
}

function sail(player, port, fare) {
  if (!questComplete(player, port.requires)) {
    player.sendMessage(`You need to have completed ${port.requires} to sail there.`);
    return;
  }
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

function openMenu(event) {
  const { player, object } = event;
  const from = currentPort(object);
  const destinations = [...portsByName.values()].filter((port) => port.name !== from?.name);
  const options = [];
  for (const port of destinations) {
    const fare = fareFor(player, from?.name, port.name);
    options.push(`${port.name}${fare == null ? "" : ` (${fare} coins)`}`, () => {
      if (fare == null) {
        player.sendMessage("There is no route to that port.");
        return;
      }
      sail(player, port, fare);
    });
  }
  pluginApi.sendMultiChatboxPrompt(player, "Where would you like to sail to?", ...options);
}
module.exports = {
  name: "CharterShips",
  members: true,
  _test: { loadData: () => loadData(), fareBetween, fareFor, wearingCharosRing, currentPort, sail, openMenu },
  register(api) {
    core = api.core;
    pluginApi = api;
    const data = loadData();
    portsByName = new Map(data.ports.map((port) => [port.name, port]));
    fares = data.fares;
    api.onNpcInteraction("Trader Crewmember", { "Talk-to": openMenu });
    api.onNpcInteraction("Trader crewmember", { "Talk-to": openMenu });
    api.onNpcInteraction("Trader Stan", { "Talk-to": openMenu });
    api.log("registered", { ports: portsByName.size, routes: Object.keys(fares).length });
  },
};
