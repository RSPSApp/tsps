/**
 * Captain Barnaby's ferry (https://oldschool.runescape.wiki/w/Captain_Barnaby).
 *
 * Each captain's destination options (revision 241 replaced Pay-fare with
 * "Ardougne", "Brimhaven" and "Rimmington") and his Talk-to dialogue sail
 * between the three docks for 30 coins, halved to 15 while any Karamja gloves
 * are worn. The Wiki's free ring of charos(a) route is not offered here.
 */
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
// shortcut: shared ferry fade timings; replace with Barnaby's exact sequence when a capture is available.
const FERRY_ROUTES = require("./data/ferries.json").routes;

const BASE_FARE = 30;
const GLOVES_FARE = 15;

// `variant` is the dock's Talk-to transcript in npc-dialogues.json.
const PORTS = [
  { name: "Ardougne", route: "barnaby-ardougne", variant: "standard-dialogue-if-the-player-is-on-the-dock-in-east-ardougne" },
  { name: "Brimhaven", route: "barnaby-brimhaven", variant: "standard-dialogue-if-the-player-is-on-the-dock-in-brimhaven" },
  { name: "Rimmington", route: "barnaby-rimmington", variant: "standard-dialogue-if-the-player-is-on-the-dock-in-rimmington" },
];

// The transcript's "You board the ship and sail to <port>." message steps.
const BOARD_MESSAGE = /^You board the ship and sail to (.+)\.$/;
const NO_FARE_CONDITION = "If the player does not have 30 coins:";

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

let api = null;

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
  if (!api.core.TeleportHandler.checkReqs(player, new api.core.Location(...FERRY_ROUTES[port.route].to))) {
    return;
  }
  const voyage = { player, route: port.route, handled: false };
  api.emitCustomEvent("ferries:travel", voyage);
  if (!voyage.handled) return;
  inventory.deleteNumber(ItemIdentifiers.COINS, fare);
  inventory.refreshItems();
  player.sendMessage(`You pay ${fare} coins and board the ship.`);
}

function portNamed(name) {
  return PORTS.find((port) => port.name === name) ?? null;
}

function isBarnaby(event) {
  return event.definition?.getName?.() === "Captain Barnaby";
}

/** The clicked option is the destination's name. */
function sailToOption(event) {
  const port = portNamed(event.definition?.getActions?.()?.[event.clickType - 1]);
  if (port) sail(event.player, port, fareFor(event.player));
}

/** Each dock's captain offers the other two ports, so the one he lacks is where he stands. */
function selectDockVariant(event) {
  const actions = isBarnaby(event) ? event.definition.getActions?.() ?? [] : [];
  if (!actions.some(portNamed)) return null;
  return PORTS.find((port) => !actions.includes(port.name))?.variant ?? null;
}

function answerFareCondition(event) {
  if (!isBarnaby(event) || event.text !== NO_FARE_CONDITION) return null;
  return event.player.getInventory().getAmount(ItemIdentifiers.COINS) < fareFor(event.player);
}

function boardFromDialogue(event) {
  const port = isBarnaby(event) ? portNamed(BOARD_MESSAGE.exec(String(event.text ?? ""))?.[1]) : null;
  if (!port) return;
  event.handled = true;
  sail(event.player, port, fareFor(event.player));
}

module.exports = {
  name: "BarnabyFerry",
  members: true,
  _test: { fareFor, sail, sailToOption, selectDockVariant, answerFareCondition, boardFromDialogue, PORTS },
  register(pluginApi) {
    api = pluginApi;
    api.onNpcInteraction("Captain Barnaby", { Ardougne: sailToOption, Brimhaven: sailToOption, Rimmington: sailToOption });
    api.onNpcDialogueVariant(selectDockVariant);
    api.onNpcDialogueCondition(answerFareCondition);
    api.onCustomEvent("npc-dialogue:action", boardFromDialogue);
  },
};
