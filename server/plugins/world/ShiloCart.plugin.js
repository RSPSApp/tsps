/**
 * Vigroy and Hajedy's Shilo Village cart system.
 *
 * The carts (2230 south of Brimhaven's dock, 2265 west of Shilo's bank) have Board and Pay-fare.
 * Board plays the driver's transcript (npc-dialogues.json "Hajedy"/"Vigroy"), whose "[amount]"
 * is the Wiki's 10-200 coin fare: about 5% of the coins carried, so `max(10, min(200, 5%))`.
 * Pay-fare skips the talk for the Wiki's flat 200 coins. Both are free after the elite Karamja
 * Diary. The landings are the ones the cart path-finds to: 2834,2951 from Brimhaven and
 * 2776,3214 from Shilo.
 *
 * OSRS Wiki: Shilo Village cart system, Travel cart, Hajedy.
 */
// NpcIdentifiers.HAJEDY (5356) and .VIGROY (5357).
const DRIVERS = new Map([
  [5356, { name: "Hajedy", destination: "Shilo Village", to: [2834, 2951, 0],
    before: "standard-dialogue-before-shilo-village",
    normal: "standard-dialogue-after-shilo-village-if-the-player-hasn-t-completed-the-elite-karamja-diary",
    elite: "standard-dialogue-after-shilo-village-if-the-player-has-completed-the-elite-karamja-diary" }],
  [5357, { name: "Vigroy", destination: "Brimhaven", to: [2776, 3214, 0],
    before: "talking-to-vigroy-before-completing-shilo-village",
    normal: "standard-dialogue-if-the-player-hasn-t-completed-the-elite-karamja-diary",
    elite: "standard-dialogue-if-the-player-has-completed-the-elite-karamja-diary" }],
]);
/** Cart loc -> the driver who runs it. */
// Travel cart locs 2230 (Brimhaven) and 2265 (Shilo), yarn dump:loc.
const CARTS = new Map([[2230, 5356], [2265, 5357]]);
const BASE_FARE = 200;
const MIN_FARE = 10;
const MAX_FARE = 200;
const FARE_PERCENT = 0.05;

let core;
let api;
/** Each conversation's quoted fare, so the line, the guards and the payment agree. */
const fares = new WeakMap();

const inventoryOf = (player) => player.getInventory();
const coinsOf = (player) => inventoryOf(player).getAmount(core.ItemIdentifiers.COINS);

function eliteFree(player) {
  const request = { player, diary: "karamja", tier: "elite", complete: null };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function questDone(player, key) {
  const request = { player, key, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** The Wiki's variable fare: about 5% of the coins carried, clamped to 10..200. */
function fareFor(player) {
  if (eliteFree(player)) return 0;
  return Math.min(MAX_FARE, Math.max(MIN_FARE, Math.floor(coinsOf(player) * FARE_PERCENT)));
}

function quotedFare(player, driver) {
  if (!fares.has(player)) fares.set(player, { driver, amount: fareFor(player) });
  return fares.get(player);
}

function driverOfNpc(definition) {
  const name = definition?.getName?.();
  for (const [id, driver] of DRIVERS) if (driver.name === name) return { id, ...driver };
  return null;
}

function driverOfCart(objectId) {
  const id = CARTS.get(objectId);
  return id == null ? null : { id, ...DRIVERS.get(id) };
}

function selectVariant({ player, definition }) {
  const driver = driverOfNpc(definition);
  if (!driver) return null;
  if (!questDone(player, "shilo_village")) {
    fares.delete(player);
    return driver.before;
  }
  const amount = fareFor(player);
  fares.set(player, { driver, amount });
  return amount === 0 ? driver.elite : driver.normal;
}

function answerCondition({ player, definition, text }) {
  const driver = driverOfNpc(definition);
  if (!driver) return null;
  if (text === "If the player has enough coins:") return coinsOf(player) >= quotedFare(player, driver).amount;
  if (text === "If the player doesn't have enough coins:") return coinsOf(player) < quotedFare(player, driver).amount;
  return null;
}

/** The transcript's "[amount]" fare, in the driver's line. */
function fillLine(event) {
  const { player, definition } = event;
  const driver = driverOfNpc(definition);
  if (!driver || typeof event.text !== "string" || !event.text.includes("[amount]")) return;
  event.text = event.text.replace("[amount]", String(quotedFare(player, driver).amount));
}

/**
 * The cart ride itself: free after the elite diary, else the quoted fare (the dialogue) or the
 * flat 200 (Pay-fare). A refused fare never moves the player.
 */
function ride(player, driver, amount, announce = false) {
  if (!questDone(player, "shilo_village")) {
    player.sendMessage("You must complete Shilo Village before using the cart service.");
    return false;
  }
  if (amount > 0) {
    const inventory = inventoryOf(player);
    if (inventory.getAmount(core.ItemIdentifiers.COINS) < amount) return false;
    inventory.deleteNumber(core.ItemIdentifiers.COINS, amount);
    inventory.refreshItems?.();
  }
  if (announce) player.sendMessage("You feel tired from the journey, but at least you didn't have to walk all that distance.");
  player.moveTo(new core.Location(...driver.to));
  api.emitCustomEvent("shilo-cart:arrived", { player, from: driver.name, to: driver.destination });
  return true;
}

function payFare(player, driver) {
  return ride(player, driver, eliteFree(player) ? 0 : BASE_FARE, true);
}

/** Hajedy's transcript teleports from an action step; Vigroy's only from its single ride line. */
function dialogueAction(event) {
  const { player, definition, text, kind } = event;
  const driver = driverOfNpc(definition);
  if (!driver) return;
  if (driver.name === "Vigroy" && kind === "message" && text.includes("You hop into the cart") && text.includes("You feel tired")) {
    ride(player, driver, quotedFare(player, driver).amount);
  } else if (text === `The player is transported to ${driver.destination}`) {
    ride(player, driver, quotedFare(player, driver).amount);
  }
}

function boardCart(event) {
  const driver = driverOfCart(event.objectId);
  if (!driver) return false;
  api.emitCustomEvent("npc-dialogue:start", { player: event.player, npcId: driver.id, handled: false });
  return true;
}

function payFareCart(event) {
  const driver = driverOfCart(event.objectId);
  if (!driver) return false;
  payFare(event.player, driver);
  return true;
}

function payFareNpc(event) {
  const driver = driverOfNpc(event.definition);
  if (!driver) return false;
  payFare(event.player, driver);
  return true;
}

module.exports = {
  name: "ShiloCart",
  members: true,
  _test: { DRIVERS, CARTS, fareFor, selectVariant, answerCondition, fillLine, ride, payFare, boardCart, payFareCart, payFareNpc, dialogueAction },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onNpcDialogueVariant(selectVariant);
    api.onNpcDialogueCondition(answerCondition);
    api.onCustomEvent("npc-dialogue:line", fillLine);
    api.onCustomEvent("npc-dialogue:action", dialogueAction);
    api.onObjectInteraction("Travel cart", { Board: boardCart, "Pay-fare": payFareCart });
    for (const name of ["Hajedy", "Vigroy"]) api.onNpcInteraction(name, { "Pay-fare": payFareNpc });
  },
};
