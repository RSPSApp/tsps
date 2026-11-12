// A boat's cargo hold: opening it, withdrawing and depositing by the selected quantity, the
// deposit buttons, and the tools compartment. Packets, ids and messages follow live captures of
// the raft's hold (docs/sailing-osrs-reference.md); what it accepts, the OSRS Wiki's Cargo hold.
const { restricted, plainAmount, takePlain, PRESET_TEXT } = require("../../items/PoweredStaff");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { ItemDefinition } = require("../../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { VARBIT, content, setVarbit, playSound, boatName } = require("./SailingContent.Sailing");
const cargo = require("./Cargo.Sailing");
const portTasks = require("./porttasks/Common.PortTasks");
let pluginApi;

const HOLD = 943;
const SIDE = 944;
const MAIN_MODAL = (161 << 16) | 16;
const SIDE_MODAL = (161 << 16) | 74;
const uid = (group, child) => (group << 16) | child;
const HOLD_FRAME = uid(HOLD, 1);
const TOGGLE_STACKS = 3;
const HOLD_CAPACITY = uid(HOLD, 5);
const HOLD_ITEMS = 10;
const DEPOSIT_CARGO = 13;
const DEPOSIT_SALVAGE = 14;
const DEPOSIT_INVENTORY = 15;
const HOLD_TOOLS = 18;
const SIDE_ITEMS = 1;
const SIDE_DISMISS = 8;
/** The 1 / 5 / 10 / X / All buttons (943:20-24) and the `depositbox_mode` each sets. */
const QUANTITY_BUTTON_MODES = new Map([[20, 0], [21, 1], [22, 4], [23, 3], [24, 2]]);
const QUANTITY_MODE_AMOUNTS = new Map([[0, 1], [1, 5], [4, 10], [2, Number.MAX_SAFE_INTEGER]]);
const MODE_X = 3;

const VARP_CARGO_INVENTORY = 5204;
const VARP_SIDE_WHITELIST = 5205;
const VARBIT_QUANTITY_MODE = 4430;
const VARBIT_WARNING_DISMISSED = 19123;
/** cargo_hold_draw_stacked: the hold's grid draws each item's stack in one slot. */
const VARBIT_DRAW_STACKED = 19592;
const QUANTITY_ATTRIBUTE = "sailing:cargo-quantity-mode";
const WARNING_ATTRIBUTE = "sailing:cargo-warning-dismissed";
const STACKED_ATTRIBUTE = "sailing:cargo-draw-stacked";

const SOUND_OPEN = 10907;
const SOUND_DEPOSIT_ALL = 10905;
const SOUND_TOOL = 2582;
const SOUND_NOTHING = 2277;
/** A crate taken out of the hold: human_pickuptable with synths 10903 and 10908 (rsprox, rev 235). */
const SOUNDS_TAKE_CRATE = [10903, 10908];
const SEQ_PICKUP_TABLE = "human_pickuptable";
const SCRIPT_MODAL_BACKGROUND = 917;
const SCRIPT_STEELBORDER = 227;
/** Ops 1-6 and 10 (examine). */
const ITEM_OPS = 0x47e;
const IF_EVENT_OP1 = 1 << 1;
const HOLD_GRID_SLOTS = 239;

const CANNOT_STORE = "The cargo hold cannot store that item.";
/** Every tier of cargo hold: each is "<wood> cargo hold" in the cache. */
const HOLD_NAMES = ["Basic", "Oak", "Teak", "Mahogany", "Camphor", "Ironwood", "Rosewood"].map((wood) => `${wood} cargo hold`);

/** The boat whose hold the player has open (or is standing on), with its owner's state. */
function heldBoat(player) {
  return Sailing.instanceAboard(player) ? Sailing.activeBoat(player) : undefined;
}

function isOpen(player) {
  return player.getInterfaceId?.() === HOLD && heldBoat(player) !== undefined;
}

function quantityMode(player) {
  const mode = player.getAttribute?.(QUANTITY_ATTRIBUTE);
  return QUANTITY_MODE_AMOUNTS.has(mode) || mode === MODE_X ? mode : 0;
}

/** Inventory slots the side panel lets you deposit (varp 5205), one bit per slot. */
function whitelist(player) {
  let mask = 0;
  player.getInventory().getItems().forEach((item, slot) => {
    if (item && item.getId() >= 0 && item.getAmount() > 0 && cargo.isStorable(item.getId())) mask |= 1 << slot;
  });
  return mask;
}

/** Sends the hold's contents, what can be deposited and the sidepanel's repair kits. */
function refresh(player, boat) {
  const sender = player.getPacketSender();
  sender.sendInventory(cargo.sentInventoryIdOf(boat), cargo.capacityOf(boat), boat.cargo);
  sender.sendConfig(VARP_SIDE_WHITELIST, whitelist(player));
  setVarbit(player, VARBIT.SIDEPANEL_REPAIRKITS, cargo.repairKitUses(boat));
}

function openHold({ player }) {
  const boat = heldBoat(player);
  if (!boat) return;
  const sender = player.getPacketSender();
  cargo.sendToolUnlocks(player);
  sender.sendConfig(VARP_CARGO_INVENTORY, cargo.inventoryIdOf(boat));
  refresh(player, boat);
  playSound(player, SOUND_OPEN);
  sender.sendInterfaceScript(SCRIPT_MODAL_BACKGROUND, [-1, -1]);
  player.setInterfaceId(HOLD);
  sender.sendSubInterface(MAIN_MODAL, HOLD, 0);
  sender.sendSubInterface(SIDE_MODAL, SIDE, 3);
  sender.sendInterfaceFlagsRange(uid(HOLD, HOLD_ITEMS), 0, HOLD_GRID_SLOTS, ITEM_OPS);
  sender.sendInterfaceFlagsRange(uid(SIDE, SIDE_ITEMS), 0, 27, ITEM_OPS);
  sender.sendInterfaceFlagsRange(uid(HOLD, HOLD_TOOLS), 0, 4, IF_EVENT_OP1);
  sender.sendString(String(cargo.capacityOf(boat)), HOLD_CAPACITY);
  sender.sendInterfaceScript(SCRIPT_STEELBORDER, [HOLD_FRAME, `Cargo Hold: ${boatName(boat)}`]);
  setVarbit(player, VARBIT_QUANTITY_MODE, quantityMode(player));
  setVarbit(player, VARBIT_WARNING_DISMISSED, player.getAttribute?.(WARNING_ATTRIBUTE) ? 1 : 0);
  setVarbit(player, VARBIT_DRAW_STACKED, player.getAttribute?.(STACKED_ATTRIBUTE) ? 1 : 0);
}

/** The stack toggle flips how the hold's grid is drawn; the hold itself is unchanged. */
function toggleStacks(player) {
  const stacked = !player.getAttribute?.(STACKED_ATTRIBUTE);
  player.setAttribute?.(STACKED_ATTRIBUTE, stacked);
  setVarbit(player, VARBIT_DRAW_STACKED, stacked ? 1 : 0);
}

/**
 * The amount an item op asks for. Op 1 is the selected quantity; ops 2-6 are 1, 5, 10, X and
 * All (cache scripts 8873 and 8896). Undefined for X, which prompts.
 */
function opAmount(player, op) {
  if (op === 1) {
    const mode = quantityMode(player);
    return mode === MODE_X ? undefined : QUANTITY_MODE_AMOUNTS.get(mode);
  }
  return { 2: 1, 3: 5, 4: 10, 6: Number.MAX_SAFE_INTEGER }[op];
}

function isAmountPrompt(player, op) {
  return op === 5 || (op === 1 && quantityMode(player) === MODE_X);
}

function withdraw(player, slot, itemId, amount) {
  const boat = heldBoat(player);
  const entry = boat?.cargo[slot];
  if (!entry || entry.id !== itemId || amount <= 0) return;
  if (portTasks.isCrate(itemId)) {
    withdrawCrate(player, boat, slot, itemId);
    return;
  }
  const inventory = player.getInventory();
  const room = cargo.isStackable(itemId)
    ? (inventory.contains(itemId) || inventory.getFreeSlots() > 0 ? Number.MAX_SAFE_INTEGER : 0)
    : inventory.getFreeSlots();
  const wanted = Math.min(amount, room, cargo.countIn(boat, itemId));
  if (wanted <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  const taken = cargo.take(boat, slot, itemId, wanted);
  inventory.add(new Item(itemId, taken), true);
  refresh(player, boat);
}

/**
 * A courier crate comes out into the player's hands, one at a time, and the hold closes (rsprox:
 * clicking it closes both interfaces and sets sailing_carrying_cargo).
 */
function withdrawCrate(player, boat, slot, itemId) {
  if (portTasks.heldCrate(player) !== undefined || !portTasks.handsFree(player)) {
    player.sendMessage("You cannot pick up any cargo as your hands are full.");
    return;
  }
  if (cargo.take(boat, slot, itemId, 1) !== 1) return;
  const taskSlot = portTasks.slots(player).findIndex((held) => held && portTasks.taskById(held.id)?.crate === itemId);
  player.getPacketSender().sendInterfaceRemoval();
  pickUpFromTable(player);
  for (const sound of SOUNDS_TAKE_CRATE) playSound(player, sound);
  portTasks.carry(player, itemId, taskSlot);
}

function pickUpFromTable(player) {
  player.performAnimation(new Animation(CacheDefinitions.getSeqId(SEQ_PICKUP_TABLE)));
}

/**
 * Deposit-held (the hold while the player carries a crate): the crate goes into the hold with
 * human_pickuptable, then a tick later synth 10905 and the line (rsprox 3449, 3450).
 */
function depositHeld({ player }) {
  const boat = heldBoat(player);
  const crate = portTasks.heldCrate(player);
  if (!boat || crate === undefined) return;
  if (cargo.store(boat, crate, 1) !== 1) {
    player.sendMessage("Your cargo hold is too full to hold any more cargo.");
    return;
  }
  pickUpFromTable(player);
  portTasks.putDown(player);
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      this.stop();
      playSound(player, SOUND_DEPOSIT_ALL);
      player.sendMessage("You deposit some cargo into the cargo hold.");
    }
  })());
}

function deposit(player, slot, itemId, amount) {
  const boat = heldBoat(player);
  const item = player.getInventory().getItems()[slot];
  if (!boat || !item || item.getId() !== itemId || amount <= 0) return;
  if (!cargo.isStorable(itemId)) {
    player.sendMessage(CANNOT_STORE);
    return;
  }
  // The hold keeps only ids and amounts, so a preset copy (PvP presets) would come back plain.
  if (restricted(item)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  if (cargo.toolFor(itemId)) {
    storeTool(player, cargo.toolFor(itemId), itemId);
  } else {
    storeItem(player, boat, itemId, amount);
  }
  refresh(player, boat);
}

/** Moves up to `amount` of an item from the inventory into the hold. */
function storeItem(player, boat, itemId, amount) {
  const inventory = player.getInventory();
  const wanted = Math.min(amount, plainAmount(inventory, itemId));
  const stored = cargo.store(boat, itemId, wanted);
  if (stored > 0) takePlain(inventory, itemId, stored);
  if (stored < wanted) player.sendMessage("Your cargo hold is full.");
  return stored;
}

/** How a tool is named in the compartment's lines: "a spyglass", "your current duck", "some diving gear". */
function toolText(tool) {
  return { 0: "your captain's log", 1: "a spyglass", 2: "your current duck", 3: "a crowbar", 4: "some diving gear" }[tool.slot]
    ?? `a ${ItemDefinition.forId(tool.give[0])?.getName?.()?.toLowerCase?.() ?? "tool"}`;
}

/** Parts of a stored multi-part tool (diving gear's helmet and apparatus) that are not in the compartment. */
function missingParts(player) {
  return player.getSailing().missingToolParts ?? [];
}

/** The items a tool's compartment slot holds now: every part, unless some were stored alone. */
function storedParts(player, tool) {
  if (!player.getSailing().tools.includes(tool.slot)) return [];
  const missing = missingParts(player);
  return tool.give.filter((id) => !missing.includes(id));
}

function setMissing(player, ids, isMissing) {
  const sailing = player.getSailing();
  const missing = new Set(missingParts(player));
  for (const id of ids) isMissing ? missing.add(id) : missing.delete(id);
  if (missing.size > 0) sailing.missingToolParts = [...missing];
  else delete sailing.missingToolParts;
}

/**
 * Puts the clicked item in the tools compartment. Each part of diving gear goes in on its own. The
 * compartment holds one of each and remembers only which are in it, so a second copy is refused
 * rather than deleted (ours: that line).
 */
function storeTool(player, tool, itemId) {
  const inventory = player.getInventory();
  const tools = player.getSailing().tools;
  if (tool.give.length > 1) {
    if (!tool.give.includes(itemId) || !inventory.contains(itemId)) return false;
    if (storedParts(player, tool).includes(itemId)) {
      player.sendMessage(`You already have ${toolText(tool)} in your tools compartment.`);
      return false;
    }
    if (!tools.includes(tool.slot)) {
      tools.push(tool.slot);
      setMissing(player, tool.give, true);
    }
    inventory.delete(itemId, 1);
    setMissing(player, [itemId], false);
    return true;
  }
  if (tools.includes(tool.slot)) {
    player.sendMessage(`You already have ${toolText(tool)} in your tools compartment.`);
    return false;
  }
  const held = tool.accept.find((id) => inventory.contains(id));
  if (held === undefined) return false;
  inventory.delete(held, 1);
  tools.push(tool.slot);
  return true;
}

function refuse(player, message) {
  playSound(player, SOUND_NOTHING);
  player.sendMessage(message);
}

function takeTool(player, slot) {
  const tool = cargo.toolAt(slot);
  const tools = player.getSailing().tools;
  if (!tool || !tools.includes(tool.slot)) return;
  const request = { player, slot: tool.slot, allowed: true };
  pluginApi.emitCustomEvent("sailing:can-take-tool", request);
  if (request.allowed === false) return;
  const inventory = player.getInventory();
  const parts = storedParts(player, tool);
  if (tool.refuseIfHeld && tool.accept.some((id) => inventory.contains(id))) {
    return refuse(player, `You already have ${toolText(tool)} in your inventory.`);
  }
  if (inventory.getFreeSlots() < parts.length) {
    // Ours: the two-slot wording, for both parts of diving gear.
    const slots = parts.length === 1 ? "one free slot" : "two free slots";
    return refuse(player, `You need ${slots} to take ${toolText(tool)} from the tools compartment.`);
  }
  tools.splice(tools.indexOf(tool.slot), 1);
  setMissing(player, tool.give, false);
  for (const id of parts) inventory.add(new Item(id, 1), true);
  // rsprox: "You collect your current duck from the tools compartment."
  player.sendMessage(`You collect ${toolText(tool)} from the tools compartment.`);
  playSound(player, SOUND_TOOL);
  const boat = heldBoat(player);
  if (boat) refresh(player, boat);
}

/** The deposit buttons: everything storable, or only one category. */
function depositAll(player, category) {
  const boat = heldBoat(player);
  if (!boat) return;
  const inventory = player.getInventory();
  const ids = [...new Set(inventory.getItems().filter((item) => item && item.getId() >= 0).map((item) => item.getId()))]
    .filter((id) => category ? cargo.categoryOf(id) === category : cargo.isStorable(id));
  if (ids.length === 0) {
    playSound(player, SOUND_NOTHING);
    player.sendMessage(category ? `You have no ${category} to deposit.` : "You have nothing suitable to deposit.");
    return;
  }
  for (const id of ids) {
    const tool = cargo.toolFor(id);
    if (tool) {
      if (inventory.contains(id)) storeTool(player, tool, id);
    } else {
      // Preset copies stay in the pack (the hold would hand them back plain); the plain ones go in.
      const plain = plainAmount(inventory, id);
      if (plain > 0 && storeItem(player, boat, id, plain) === 0) break;
    }
  }
  playSound(player, SOUND_DEPOSIT_ALL);
  refresh(player, boat);
}

function promptAmount(player, callback) {
  player.setEnteredAmountAction({ execute: callback });
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
}

function examine(player, itemId) {
  const definition = ItemDefinition.forId(itemId);
  player.sendMessage(definition?.getExamine?.() || definition?.getName?.() || "Nothing interesting happens.");
}

function itemOp(player, op, slot, itemId, move) {
  if (op === 10) return examine(player, itemId);
  // A courier crate's only op is Withdraw, one into the player's hands whatever the quantity mode.
  if (move === withdraw && portTasks.isCrate(itemId)) return withdraw(player, slot, itemId, 1);
  if (isAmountPrompt(player, op)) return promptAmount(player, (amount) => move(player, slot, itemId, amount));
  const amount = opAmount(player, op);
  if (amount !== undefined) move(player, slot, itemId, amount);
}

function setQuantityMode(player, mode) {
  player.setAttribute?.(QUANTITY_ATTRIBUTE, mode);
  setVarbit(player, VARBIT_QUANTITY_MODE, mode);
}

function holdButton(player, childId, slot) {
  if (childId === TOGGLE_STACKS) return toggleStacks(player);
  if (QUANTITY_BUTTON_MODES.has(childId)) return setQuantityMode(player, QUANTITY_BUTTON_MODES.get(childId));
  if (childId === DEPOSIT_INVENTORY) return depositAll(player, null);
  if (childId === DEPOSIT_SALVAGE) return depositAll(player, "salvage");
  if (childId === DEPOSIT_CARGO) return depositAll(player, "cargo");
  if (childId === HOLD_TOOLS) return takeTool(player, slot);
}

function clickHold(event) {
  const { player, groupId, childId, slot, itemId, action } = event;
  if ((groupId !== HOLD && groupId !== SIDE) || !isOpen(player)) return;
  event.handled = true;
  // The client's click names the slot, not always the item: the item is what's in that slot.
  if (groupId === HOLD && childId === HOLD_ITEMS) {
    return itemOp(player, action, slot, itemId ?? heldBoat(player)?.cargo[slot]?.id, withdraw);
  }
  if (groupId === SIDE && childId === SIDE_ITEMS) {
    return itemOp(player, action, slot, itemId ?? player.getInventory().getItems()[slot]?.getId(), deposit);
  }
  if (groupId === SIDE && childId === SIDE_DISMISS) {
    player.setAttribute?.(WARNING_ATTRIBUTE, true);
    return setVarbit(player, VARBIT_WARNING_DISMISSED, 1);
  }
  if (groupId === HOLD) holdButton(player, childId, slot);
}

/** The hold's loc op "Deposit-all": everything storable, without opening it. */
function depositAllFromLoc({ player }) {
  depositAll(player, null);
}

/** Something else put cargo in the hold (a crewmate's salvage): an open hold shows it. */
function cargoChanged({ player }) {
  const boat = heldBoat(player);
  if (boat && isOpen(player)) refresh(player, boat);
}

const HOLD_ACTIONS = { Open: openHold, "Deposit-all": depositAllFromLoc, "Deposit-held": depositHeld };

module.exports = {
  opAmount,
  register(api) {
    pluginApi = api;
    content();
    api.persistAttribute(QUANTITY_ATTRIBUTE);
    api.persistAttribute(WARNING_ATTRIBUTE);
    api.persistAttribute(STACKED_ATTRIBUTE);
    for (const name of HOLD_NAMES) api.onObjectInteraction(name, HOLD_ACTIONS);
    api.onInterfaceActionClick(clickHold);
    api.onCustomEvent("sailing:cargo-changed", cargoChanged);
  },
};
