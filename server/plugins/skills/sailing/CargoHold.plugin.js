// A boat's cargo hold: opening it, withdrawing and depositing by the selected quantity, the
// deposit buttons, and the tools compartment. Packets, ids and messages follow live captures of
// the raft's hold (docs/sailing-osrs-reference.md); what it accepts, the OSRS Wiki's Cargo hold.
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { ItemDefinition } = require("../../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { VARBIT, content, setVarbit, playSound, boatName } = require("./sailingContent");
const cargo = require("./cargo");

const HOLD = 943;
const SIDE = 944;
const MAIN_MODAL = (161 << 16) | 16;
const SIDE_MODAL = (161 << 16) | 74;
const uid = (group, child) => (group << 16) | child;
const HOLD_FRAME = uid(HOLD, 1);
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
const QUANTITY_ATTRIBUTE = "sailing:cargo-quantity-mode";
const WARNING_ATTRIBUTE = "sailing:cargo-warning-dismissed";

const SOUND_OPEN = 10907;
const SOUND_DEPOSIT_ALL = 10905;
const SOUND_TOOL = 2582;
const SOUND_NOTHING = 2277;
const SCRIPT_MODAL_BACKGROUND = 917;
const SCRIPT_STEELBORDER = 227;
/** Ops 1-6 and 10 (examine). */
const ITEM_OPS = 0x47e;
const IF_EVENT_OP1 = 1 << 1;
const HOLD_GRID_SLOTS = 239;

const CANNOT_STORE = "The cargo hold cannot store that item.";

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

function deposit(player, slot, itemId, amount) {
  const boat = heldBoat(player);
  const item = player.getInventory().getItems()[slot];
  if (!boat || !item || item.getId() !== itemId || amount <= 0) return;
  if (!cargo.isStorable(itemId)) {
    player.sendMessage(CANNOT_STORE);
    return;
  }
  if (cargo.toolFor(itemId)) {
    storeTool(player, cargo.toolFor(itemId));
  } else {
    storeItem(player, boat, itemId, amount);
  }
  refresh(player, boat);
}

/** Moves up to `amount` of an item from the inventory into the hold. */
function storeItem(player, boat, itemId, amount) {
  const inventory = player.getInventory();
  const wanted = Math.min(amount, inventory.getAmount(itemId));
  const stored = cargo.store(boat, itemId, wanted);
  if (stored > 0) inventory.delete(itemId, stored);
  if (stored < wanted) player.sendMessage("Your cargo hold is full.");
  return stored;
}

/** Puts a tool in the tools compartment; diving gear needs both parts. */
function storeTool(player, tool) {
  const inventory = player.getInventory();
  const held = tool.accept.filter((id) => inventory.contains(id));
  if (tool.give.length > 1 && !tool.give.every((id) => inventory.contains(id))) {
    player.sendMessage(CANNOT_STORE);
    return false;
  }
  for (const id of tool.give.length > 1 ? tool.give : held.slice(0, 1)) inventory.delete(id, 1);
  const tools = player.getSailing().tools;
  if (!tools.includes(tool.slot)) tools.push(tool.slot);
  return true;
}

function takeTool(player, slot) {
  const tool = cargo.toolAt(slot);
  const tools = player.getSailing().tools;
  if (!tool || !tools.includes(tool.slot)) return;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < tool.give.length) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  tools.splice(tools.indexOf(tool.slot), 1);
  for (const id of tool.give) inventory.add(new Item(id, 1), true);
  const what = { 0: "your captain's log", 1: "a spyglass", 4: "some diving gear" }[tool.slot]
    ?? `a ${ItemDefinition.forId(tool.give[0])?.getName?.()?.toLowerCase?.() ?? "tool"}`;
  player.sendMessage(`You collect ${what} from the tools compartment.`);
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
    if (category) player.sendMessage(`You have no ${category} to deposit.`);
    playSound(player, SOUND_NOTHING);
    return;
  }
  for (const id of ids) {
    const tool = cargo.toolFor(id);
    if (tool) {
      if (inventory.contains(id)) storeTool(player, tool);
    } else if (storeItem(player, boat, id, inventory.getAmount(id)) === 0) {
      break;
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
  if (isAmountPrompt(player, op)) return promptAmount(player, (amount) => move(player, slot, itemId, amount));
  const amount = opAmount(player, op);
  if (amount !== undefined) move(player, slot, itemId, amount);
}

function setQuantityMode(player, mode) {
  player.setAttribute?.(QUANTITY_ATTRIBUTE, mode);
  setVarbit(player, VARBIT_QUANTITY_MODE, mode);
}

function holdButton(player, childId, slot) {
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
  if (groupId === HOLD && childId === HOLD_ITEMS) return itemOp(player, action, slot, itemId, withdraw);
  if (groupId === SIDE && childId === SIDE_ITEMS) return itemOp(player, action, slot, itemId, deposit);
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

module.exports = {
  name: "SailingCargoHold",
  members: true,
  opAmount,
  register(api) {
    content();
    api.persistAttribute(QUANTITY_ATTRIBUTE);
    api.persistAttribute(WARNING_ATTRIBUTE);
    api.onObjectInteraction("Basic cargo hold", { Open: openHold, "Deposit-all": depositAllFromLoc });
    api.onInterfaceActionClick(clickHold);
  },
};
