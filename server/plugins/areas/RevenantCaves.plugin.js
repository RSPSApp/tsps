/**
 * The Revenant Caves' ways in and out (https://oldschool.runescape.wiki/w/Revenant_Caves), as in
 * OSRS captures (docs/revenant-caves.md):
 *
 * - Three one-way entrances: the level 17 and level 40 caverns and the level 26 crevice (which
 *   warns first, interface 720). Each asks for the 100,000 coin entry fee unless it is paid; it
 *   stays paid until the player dies in the caves or to another player in the Wilderness.
 * - Two exits: the southern and northern stairs, which come out beside trapdoors, away from
 *   the entrances.
 * - The Revenant cave teleport scroll: "Teleport" to an entrance (its sub-options, or the one
 *   chosen with "Config" on a left-click).
 * - Singles-plus indicator (varbit 5961) while inside.
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Boundary } = require("../../src/main/typescript/elvarg/game/model/Boundary");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");

const COINS = 995;
const COINS_ICON = 1004;
const SCROLL = 21802;
const FEE = 100_000;

const BUSY_VARBIT = 12393;
const SINGLES_PLUS_VARBIT = 5961;
const SCROLL_LOCATION_VARBIT = 20096;
const CREVICE_WARNING_VARBIT = 6506;

const CREVICE_WARNING = 720;
const WARNING_JUMP = 17;
const WARNING_STAY = 18;
const WARNING_DONT_ASK = 20;
const MODAL_OPEN_SCRIPT = 2524;

const SCROLL_ANIMATION = 3864;
const SCROLL_GRAPHIC = 1039;
const SCROLL_SOUND = 200;
const SCROLL_LEVEL_LIMIT = 20;

const FEE_PAID_ATTRIBUTE = "revenant-caves:fee-paid";
const FEE_AUTO_ATTRIBUTE = "revenant-caves:fee-auto";
const SCROLL_LOCATION_ATTRIBUTE = "revenant-caves:scroll-location";
const CREVICE_WARNED_ATTRIBUTE = "revenant-caves:crevice-warned";

const ENTER_MESSAGE = "You enter the cave and scramble over the rubble.";
const EXIT_MESSAGE = "You climb the stairs and exit the cave.";

/** The caves (Forinthry Dungeon). */
const CAVES = new Boundary(3136, 3271, 10036, 10249, 0);

/** Entrances by the object's tile. */
const ENTRANCES = new Map([
  ["3073,3654", { to: [3197, 10056], message: ENTER_MESSAGE }],
  ["3124,3831", { to: [3241, 10233], message: ENTER_MESSAGE }],
  ["3067,3740", { to: [3187, 10127], message: "You jump down into the cavern.", crevice: true }],
]);

/** Exit stairs by the object's tile: they come out beside the trapdoors. */
const EXITS = new Map([
  ["3218,10058", [3102, 3655]],
  ["3244,10215", [3124, 3806]],
]);

/** The scroll's destinations, by sub-option and by varbit 20096. */
const SCROLL_DESTINATIONS = [
  { name: "northern", to: [3128, 3832], question: "Teleport to deep Wilderness?" },
  { name: "middle", to: [3074, 3739], question: "Teleport to deep Wilderness?" },
  { name: "southern", to: [3080, 3655], question: "Teleport to the Wilderness?" },
];

let api = null;
let core = null;
let scrollTeleportType = null;

const tileKey = (location) => `${location.x},${location.y}`;
const at = ([x, y]) => new Location(x, y, 0);

function inCaves(location) {
  return !!location && CAVES.inside(location);
}

function later(player, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(ticks, player, false);
    }

    execute() {
      this.stop();
      if (player.isRegistered?.() !== false) action();
    }
  })());
}

function itemBox(player, itemId, text, then) {
  const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = core;
  const chain = new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text));
  if (then) chain.add(new ActionDialogue(1, { execute: () => then() }));
  player.getDialogueManager().startDialogues(chain);
}

// ------------------------------------------------------------------ the entry fee

function feePaid(player) {
  return player.getAttribute(FEE_PAID_ATTRIBUTE) === true;
}

/**
 * Takes the fee from the inventory, the bank or both. Only the bank's message is from OSRS; the
 * other two are ours (docs/revenant-caves.md).
 */
function payFee(player) {
  const inventory = player.getInventory();
  const bank = player.getBank(core.Bank.getTabForItem(player, COINS));
  const carried = Math.min(inventory.getAmount(COINS), FEE);
  const banked = bank.getAmount(COINS);
  if (carried + banked < FEE) {
    player.sendMessage("You don't have enough coins to pay the entry fee.");
    return false;
  }
  if (carried > 0) inventory.delete(COINS, carried);
  if (carried < FEE) bank.delete(COINS, FEE - carried);
  player.setAttribute(FEE_PAID_ATTRIBUTE, true);
  if (carried === FEE) player.sendMessage("The entry fee was taken from your inventory.");
  else if (carried === 0) player.sendMessage("The entry fee was taken from your bank.");
  else player.sendMessage("The entry fee was taken from your inventory and bank.");
  return true;
}

function enterCaves(player, entrance) {
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
  player.sendMessage(entrance.message);
  player.moveTo(at(entrance.to));
}

/** Paid: a message, and in a tick later. Not: the fee prompt, and in at once on paying. */
function feeThenEnter(player, entrance) {
  if (feePaid(player)) {
    player.sendMessage("You've already paid the Revenant Entry Fee.");
    later(player, 1, () => enterCaves(player, entrance));
    return;
  }
  if (player.getAttribute(FEE_AUTO_ATTRIBUTE) === true) {
    if (payFee(player)) enterCaves(player, entrance);
    return;
  }
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  itemBox(player, COINS_ICON,
    "You need to pay a 100,000 coins fee to enter the<br>Revenant Cave.<br>This can be taken from your inventory, bank or both.",
    () => api.sendMultiChatboxPrompt(player, "Pay 100,000 coins Entry Fee?",
      "Yes.", () => payAndEnter(player, entrance, false),
      "Yes, don't ask again.", () => payAndEnter(player, entrance, true),
      "No.", () => player.getPacketSender().sendVarbit(BUSY_VARBIT, 0)));
}

function payAndEnter(player, entrance, dontAskAgain) {
  if (!payFee(player)) {
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
    return;
  }
  if (dontAskAgain) player.setAttribute(FEE_AUTO_ATTRIBUTE, true);
  enterCaves(player, entrance);
}

// ------------------------------------------------------------------ entrances and exits

function enter(event) {
  const entrance = ENTRANCES.get(tileKey(event.location));
  if (!entrance) return false;
  const { player } = event;
  if (entrance.crevice && player.getAttribute(CREVICE_WARNED_ATTRIBUTE) !== true) {
    player.getPacketSender()
      .sendClientScript(MODAL_OPEN_SCRIPT, -1, -1)
      .sendInterface(CREVICE_WARNING)
      .sendVarbit(BUSY_VARBIT, 1);
    return true;
  }
  feeThenEnter(player, entrance);
  return true;
}

function exit(event) {
  const to = EXITS.get(tileKey(event.location));
  if (!to) return false;
  const { player } = event;
  later(player, 1, () => {
    player.sendMessage(EXIT_MESSAGE);
    player.moveTo(at(to));
  });
  return true;
}

function setCreviceWarned(player, warned) {
  player.setAttribute(CREVICE_WARNED_ATTRIBUTE, warned);
  player.getPacketSender().sendVarbit(CREVICE_WARNING_VARBIT, warned ? 1 : 0);
}

function creviceWarning(event) {
  const { player, groupId, childId } = event;
  if (groupId !== CREVICE_WARNING) return;
  event.handled = true;
  if (childId === WARNING_DONT_ASK) {
    setCreviceWarned(player, player.getAttribute(CREVICE_WARNED_ATTRIBUTE) !== true);
  } else if (childId === WARNING_JUMP) {
    setCreviceWarned(player, true);
    player.getPacketSender().sendInterfaceRemoval();
    feeThenEnter(player, ENTRANCES.get("3067,3740"));
  } else if (childId === WARNING_STAY) {
    player.getPacketSender().sendInterfaceRemoval();
  }
}

/** Closing the warning, by any route, clears busy (a jump sets it again for the fee prompt). */
function warningClosed({ player, interfaceId }) {
  if (interfaceId === CREVICE_WARNING) player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

// ------------------------------------------------------------------ the teleport scroll

function scrollTeleport() {
  if (scrollTeleportType) return scrollTeleportType;
  const { TeleportType, Animation, Priority, Sound } = core;
  scrollTeleportType = new TeleportType(3, new Animation(SCROLL_ANIMATION, Priority.HIGH), null,
    Animation.DEFAULT_RESET_ANIMATION, null, null, null, { sound: new Sound(SCROLL_SOUND, 1, 0, 0), busy: true });
  return scrollTeleportType;
}

function readScroll(player, slot, destination) {
  const sender = player.getPacketSender();
  const level = Wilderness.isIn(player) ? Wilderness.levelAt(player.getLocation().getX(), player.getLocation().getY()) : 0;
  if (level > SCROLL_LEVEL_LIMIT) {
    player.sendMessage("A mysterious force blocks your teleport spell!");
    player.sendMessage(`You can't use this teleport after level ${SCROLL_LEVEL_LIMIT} wilderness.`);
    sender.sendVarbit(BUSY_VARBIT, 0);
    return;
  }
  const to = at(destination.to);
  if (!core.TeleportHandler.checkReqs(player, to, SCROLL_LEVEL_LIMIT)) {
    sender.sendVarbit(BUSY_VARBIT, 0);
    return;
  }
  const inventory = player.getInventory();
  if (inventory.getItems()[slot]?.getId?.() !== SCROLL) return;
  inventory.deleteAtSlot(slot, 1);
  sender.sendGlobalGraphic(new core.Graphic(SCROLL_GRAPHIC), player.getLocation().clone());
  core.TeleportHandler.teleport(player, to, scrollTeleport(), false);
}

/** "Teleport": a sub-option picks the entrance; a left-click uses the configured one. */
function teleportOption(event) {
  const { player, slot } = event;
  const index = Number.isInteger(event.subOpId)
    ? event.subOpId - 1
    : Number(player.getAttribute(SCROLL_LOCATION_ATTRIBUTE) ?? 0);
  const destination = SCROLL_DESTINATIONS[index] ?? SCROLL_DESTINATIONS[0];
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  api.sendMultiChatboxPrompt(player, destination.question,
    "Yes, teleport me now.", () => readScroll(player, slot, destination),
    "No, I want to stay here.", () => player.getPacketSender().sendVarbit(BUSY_VARBIT, 0));
}

function configOption({ player }) {
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  const choose = (index) => () => {
    player.setAttribute(SCROLL_LOCATION_ATTRIBUTE, index);
    player.getPacketSender().sendVarbit(SCROLL_LOCATION_VARBIT, index);
    itemBox(player, SCROLL,
      `Revenant cave teleports will now teleport you to the<br>${SCROLL_DESTINATIONS[index].name} entrance.`,
      () => player.getPacketSender().sendVarbit(BUSY_VARBIT, 0));
  };
  api.sendMultiChatboxPrompt(player, "Select a teleport location",
    "Northern entrance.", choose(0),
    "Middle entrance.", choose(1),
    "Southern entrance.", choose(2));
}

// ------------------------------------------------------------------ deaths

/**
 * Dying in the caves, or to another player anywhere in the Wilderness, loses the fee; another
 * player who killed them gets it as loot (Wiki). Runs before the respawn, so the player is still
 * where they died.
 */
function onDeath({ player, killer }) {
  if (!feePaid(player)) return;
  const location = player.getLocation();
  const byPlayer = !!killer?.isPlayer?.();
  const inside = inCaves(location);
  if (!inside && !(byPlayer && Wilderness.isIn(player))) return;
  player.setAttribute(FEE_PAID_ATTRIBUTE, false);
  if (!byPlayer) return;
  if (inside) player.sendMessage("You died to another player in the Revenant Cave, you've lost your entry fee.");
  core.ItemOnGroundManager.registerLocation(killer.getAsPlayer?.() ?? killer, new core.Item(COINS, FEE), location.clone());
}

function sendStateOnLogin({ player }) {
  player.getPacketSender()
    .sendVarbit(SCROLL_LOCATION_VARBIT, Number(player.getAttribute(SCROLL_LOCATION_ATTRIBUTE) ?? 0))
    .sendVarbit(CREVICE_WARNING_VARBIT, player.getAttribute(CREVICE_WARNED_ATTRIBUTE) === true ? 1 : 0);
}

function createCavesArea() {
  class RevenantCaves extends core.Area {
    postEnter(mobile) {
      if (mobile.isPlayer()) mobile.getAsPlayer().getPacketSender().sendVarbit(SINGLES_PLUS_VARBIT, 1);
    }

    postLeave(mobile) {
      if (mobile.isPlayer()) mobile.getAsPlayer().getPacketSender().sendVarbit(SINGLES_PLUS_VARBIT, 0);
    }
  }
  return new RevenantCaves([CAVES]);
}

module.exports = {
  name: "RevenantCaves",
  members: true,
  _test: {
    enter, exit, creviceWarning, teleportOption, configOption, readScroll, onDeath, payFee, inCaves,
    ENTRANCES, EXITS, SCROLL_DESTINATIONS, FEE_PAID_ATTRIBUTE, FEE_AUTO_ATTRIBUTE,
    SCROLL_LOCATION_ATTRIBUTE, CREVICE_WARNED_ATTRIBUTE, attach: (pluginApi) => { api = pluginApi; core = pluginApi.core; },
  },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    [FEE_PAID_ATTRIBUTE, FEE_AUTO_ATTRIBUTE, SCROLL_LOCATION_ATTRIBUTE, CREVICE_WARNED_ATTRIBUTE]
      .forEach((key) => pluginApi.persistAttribute(key));
    pluginApi.onObjectInteraction("Cavern", { Enter: enter });
    pluginApi.onObjectInteraction("Crevice", { "Jump-Down": enter });
    pluginApi.onObjectInteraction("Stairs", { "Climb-up": exit });
    pluginApi.onItemAction("Revenant cave teleport", { Teleport: teleportOption, Config: configOption });
    pluginApi.onInterfaceActionClick(creviceWarning);
    pluginApi.onCustomEvent("interface:closed", warningClosed);
    pluginApi.onPlayerDeath(onDeath);
    pluginApi.onPlayerLogin(sendStateOnLogin);
    pluginApi.registerArea(createCavesArea());
  },
};
