/**
 * Captain Barnaby's ferry (https://oldschool.runescape.wiki/w/Captain_Barnaby).
 *
 * The destination right-click options (the 29 August 2019 update) sail between East
 * Ardougne, Brimhaven and Rimmington for 30 coins, halved to 15 while any Karamja gloves
 * are worn. The dialogue route charges the same fare through the transcript's "You board
 * the ship and sail to X." steps, and a worn Ring of Charos(a) makes the dialogue route
 * free ("not through the pay-fare option", per the Wiki).
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

/** The transcript's narrated crossing, per destination. */
const SAIL_MESSAGES = Object.freeze({
  "East Ardougne": "You board the ship and sail to Ardougne.",
  Brimhaven: "You board the ship and sail to Brimhaven.",
  Rimmington: "You board the ship and sail to Rimmington.",
});

/** The transcript message steps that narrate a crossing, by their npc-dialogues.json ids. */
const SAIL_STEPS = new Map([
  ["pMlwta", "Rimmington"], ["YLphRs", "Brimhaven"], // East Ardougne dock, paid
  ["7KFrc7", "East Ardougne"], ["cVGSaG", "Brimhaven"], // Rimmington dock, paid
  ["Ab4r2R", "Rimmington"], ["V4k_k6", "East Ardougne"], // Brimhaven dock, paid
  ["uzKhEQ", "Rimmington"], ["GcZwOU", "Brimhaven"], // East Ardougne, Ring of Charos(a)
  ["t19V4d", "East Ardougne"], ["cmk7DM", "Brimhaven"], // Rimmington, Ring of Charos(a)
  ["5gJXnE", "Rimmington"], ["fep9oV", "East Ardougne"], // Brimhaven, Ring of Charos(a)
]);

/** The charmed crossings, which charge nothing. */
const CHARM_STEPS = new Set(["uzKhEQ", "GcZwOU", "t19V4d", "cmk7DM", "5gJXnE", "fep9oV"]);

const NO_COINS_CONDITION = "If the player does not have 30 coins:";
const CHAROS_CONDITION = "If wearing the Ring of Charos(a):";

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

function coins(player) {
  return player.getInventory().getAmount(ItemIdentifiers.COINS);
}

function wearingCharos(player) {
  const ring = player.getEquipment?.()?.get?.(Equipment.RING_SLOT)?.getId?.();
  return Number(ring ?? -1) === ItemIdentifiers.RING_OF_CHAROS_A_;
}

function portNamed(name) {
  return PORTS.find((port) => port.name === name) ?? null;
}

/** Takes the fare (0 for a charmed crossing) and crosses; the caller sends any message. */
function sail(player, port, fare) {
  if (coins(player) < fare) {
    player.sendMessage("You don't have enough coins for that fare.");
    return false;
  }
  if (!core.TeleportHandler.checkReqs(player, port.destination)) {
    return false;
  }
  if (fare > 0) {
    player.getInventory().deleteNumber(ItemIdentifiers.COINS, fare);
    player.getInventory().refreshItems();
  }
  core.TeleportHandler.teleport(player, port.destination, core.TeleportType.NORMAL, false);
  return true;
}

/** A destination option click from the captain's own tile: pays and crosses. */
function travelFrom(event, portName) {
  const { player } = event;
  const from = currentPort(event.npc);
  const port = portNamed(portName);
  if (!port || from?.name === port.name) {
    player.sendMessage("The captain isn't sailing there from here.");
    return;
  }
  if (sail(player, port, fareFor(player))) {
    player.sendMessage(SAIL_MESSAGES[port.name]);
  }
}

function sailToBrimhaven(event) {
  travelFrom(event, "Brimhaven");
}

function sailToRimmington(event) {
  travelFrom(event, "Rimmington");
}

function sailToArdougne(event) {
  travelFrom(event, "East Ardougne");
}

/** The transcript's per-dock variants; without one the Ardougne page always plays. */
const DOCK_VARIANTS = Object.freeze({
  "East Ardougne": "standard-dialogue-if-the-player-is-on-the-dock-in-east-ardougne",
  Rimmington: "standard-dialogue-if-the-player-is-on-the-dock-in-rimmington",
  Brimhaven: "standard-dialogue-if-the-player-is-on-the-dock-in-brimhaven",
});

function barnabyVariant({ player, definition }) {
  if (definition?.getName?.() !== "Captain Barnaby") return null;
  const port = currentPort(player);
  return port ? DOCK_VARIANTS[port.name] : null;
}

/** Answers the transcript's fare and Ring of Charos(a) conditions. */
function barnabyCondition({ player, text }) {
  if (text === NO_COINS_CONDITION) return coins(player) < fareFor(player);
  if (text === CHAROS_CONDITION) return wearingCharos(player);
  return null;
}

/** The transcript's "You board the ship and sail to X." step charges and crosses. */
function barnabySails(event) {
  if (event.kind !== "message") return;
  const portName = SAIL_STEPS.get(event.stepId);
  if (!portName) return;
  const { player } = event;
  const fare = CHARM_STEPS.has(event.stepId) ? 0 : fareFor(player);
  if (coins(player) < fare) {
    // The transcript's "Come back when you've got 30 coins for me." branch already played.
    event.handled = true;
    return;
  }
  sail(player, portNamed(portName), fare);
}

module.exports = {
  name: "BarnabyFerry",
  members: true,
  _test: { currentPort, fareFor, sail, travelFrom, barnabyVariant, barnabyCondition, barnabySails, SAIL_STEPS, PORTS },
  register(api) {
    core = api.core;
    api.onNpcInteraction("Captain Barnaby", {
      Brimhaven: sailToBrimhaven,
      Rimmington: sailToRimmington,
      Ardougne: sailToArdougne,
    });
    api.onNpcDialogueVariant(barnabyVariant);
    api.onNpcDialogueCondition(barnabyCondition);
    api.onCustomEvent("npc-dialogue:action", barnabySails);
  },
};
