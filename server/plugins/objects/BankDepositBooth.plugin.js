const { Bank } = require("../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");

let pluginApi;

// RuneLite/OpenRune: interface.bank_depositbox and its cache-native components.
const IFACE = 192;
const MAIN_MODAL = (161 << 16) | 16;
const uid = (child) => (IFACE << 16) | child;
const CONTAINER = uid(24);
const BTN_DEPOSIT_WORN = uid(30);
const BTN_DEPOSIT_INV = uid(31);
const BTN_QUANTITY_X = uid(38);
const BTN_QUANTITIES = new Map([
  [uid(35), 1],
  [uid(36), 5],
  [uid(37), 10],
  [uid(39), Number.MAX_SAFE_INTEGER],
]);
const BUTTONS = [BTN_DEPOSIT_WORN, BTN_DEPOSIT_INV, BTN_QUANTITY_X, ...BTN_QUANTITIES.keys()];
const QUANTITY_MODE_VARBIT = 4430;
const QUANTITY_INPUT_VARP = 1794;
const QUANTITY_ATTRIBUTE = "bank-deposit-box:quantity";
const DEPOSIT_ANIMATION = new Animation(834); // seq.human_leverdown
const CONTAINER_FLAGS = 0x2047e; // Op1-6, Op10, Depth1

function refresh(player) {
  const sender = player?.getPacketSender?.();
  if (!sender) return;
  sender.clearItemOnInterface(CONTAINER);
  sender.sendItemContainer(player.getInventory(), CONTAINER);
}

function getQuantity(player) {
  const amount = player?.getAttribute?.(QUANTITY_ATTRIBUTE);
  return Number.isInteger(amount) && amount > 0 ? amount : 1;
}

function setQuantity(player, amount) {
  const mode = amount === 1 ? 0
    : amount === 5 ? 1
      : amount === 10 ? 4
        : amount === Number.MAX_SAFE_INTEGER ? 2 : 3;
  player.setAttribute?.(QUANTITY_ATTRIBUTE, amount);
  const sender = player.getPacketSender();
  if (mode === 3) sender.sendConfig(QUANTITY_INPUT_VARP, Math.min(amount, 0x7fffffff));
  sender.sendVarbit(QUANTITY_MODE_VARBIT, mode);
}

function open(player) {
  const sender = player?.getPacketSender?.();
  if (!sender) return;
  player.setInterfaceId(IFACE);
  sender.sendSubInterface(MAIN_MODAL, IFACE, 0);
  sender.sendInterfaceFlagsRange(CONTAINER, 0, 27, CONTAINER_FLAGS);
  setQuantity(player, getQuantity(player));
  refresh(player);
  Sounds.sendSound(player, Sound.CONTAINER_OPEN);
}

function deposit(player, slot, itemId, amount) {
  const inv = player?.getInventory?.();
  const slotItem = inv?.forSlot?.(slot);
  if (!inv || !slotItem || slotItem.getId() !== itemId) return false;

  const before = inv.getAmount(itemId);
  const finalAmount = Math.max(0, Math.min(amount, before));
  if (finalAmount <= 0) return false;

  Bank.deposit(player, itemId, slot, finalAmount, true);
  if (inv.getAmount(itemId) >= before) return false;
  player.performAnimation?.(DEPOSIT_ANIMATION);
  refresh(player);
  return true;
}

function promptAmount(player, callback) {
  player.setEnteredAmountAction({ execute: callback });
  player.getPacketSender().sendEnterAmountPrompt("How many would you like to deposit?");
}

function handleDepositContainerAction(player, interfaceId, itemId, slot, clickType) {
  if (interfaceId !== CONTAINER || player.getInterfaceId?.() !== IFACE) return false;
  if (pluginApi.emitCanBank(player) === false) return true;

  // cache script bank_depositbox_drawslot: op1 is selected quantity,
  // op2-6 are 1/5/10/X/All, and op10 is Examine.
  const amount = {
    1: getQuantity(player),
    2: 1,
    3: 5,
    4: 10,
    6: Number.MAX_SAFE_INTEGER,
  }[clickType];
  if (amount !== undefined) {
    deposit(player, slot, itemId, amount);
  } else if (clickType === 5) {
    promptAmount(player, (entered) => deposit(player, slot, itemId, entered));
  } else if (clickType === 10) {
    const definition = player.getInventory().forSlot(slot)?.getDefinition?.();
    player.sendMessage(
      definition?.getExamine?.() || definition?.getName?.() || "Nothing interesting happens."
    );
  } else {
    return false;
  }
  return true;
}

function handleDepositButton(player, button) {
  if (!player || player.getInterfaceId?.() !== IFACE) return false;
  if (pluginApi.emitCanBank(player) === false) return true;

  const quantity = BTN_QUANTITIES.get(button);
  if (quantity) {
    setQuantity(player, quantity);
    return true;
  }
  if (button === BTN_QUANTITY_X) {
    promptAmount(player, (entered) => {
      if (entered > 0) setQuantity(player, entered);
    });
    return true;
  }
  if (button === BTN_DEPOSIT_WORN || button === BTN_DEPOSIT_INV) {
    const from = button === BTN_DEPOSIT_WORN ? player.getEquipment() : player.getInventory();
    const itemCount = from.getValidItems().length;
    Bank.depositItems(player, from, true);
    if (from.getValidItems().length < itemCount) player.performAnimation?.(DEPOSIT_ANIMATION);
    refresh(player);
    return true;
  }
  return false;
}

function isDepositBooth(event) {
  const name = event.object?.getDefinition?.()?.getName?.();
  return typeof name === "string" && name.trim().toLowerCase() === "bank deposit box";
}

function promptItemOnBooth(event) {
  const { player, itemId, itemSlot } = event;
  const count = player.getInventory().getAmount(itemId);
  if (count <= 0) return;
  if (count === 1) {
    deposit(player, itemSlot, itemId, 1);
    return;
  }

  const choose = (amount) => () => deposit(player, itemSlot, itemId, amount);
  const x = () => promptAmount(player, (amount) => deposit(player, itemSlot, itemId, amount));
  const options = count > 10
    ? ["1", choose(1), "5", choose(5), "10", choose(10), "X", x, "All", choose(Number.MAX_SAFE_INTEGER)]
    : count > 5
      ? ["1", choose(1), "5", choose(5), "X", x, "All", choose(Number.MAX_SAFE_INTEGER)]
      : ["1", choose(1), "X", x, "All", choose(Number.MAX_SAFE_INTEGER)];
  pluginApi.sendMultiChatboxPrompt(player, "How many would you like to deposit?", ...options);
}

function openDepositBox({ player }) {
  if (pluginApi.emitCanBank(player) !== false) open(player);
}

module.exports = {
  name: "BankDepositBooth",
  register(api) {
    pluginApi = api;
    api.onObjectInteraction("Bank deposit box", { Deposit: openDepositBox });
    api.onObjectInteraction("Bank Deposit Box", { Deposit: openDepositBox });

    api.onInterfaceActionClick((event) => {
      if (handleDepositContainerAction(event.player, event.buttonId, event.itemId, event.slot, event.action)) {
        event.handled = true;
      }
    });

    api.onInterfaceActionButton(BUTTONS, (event) =>
      handleDepositButton(event.player, event.buttonId)
    );

    api.onItemOnObject((event) => {
      if (!isDepositBooth(event)) return;
      event.handled = true;
      if (pluginApi.emitCanBank(event.player) === false) return;
      promptItemOnBooth(event);
    });
  },
};
