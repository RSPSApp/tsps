const {
  FLAG_OP1,
  TYPE_GRAPHIC,
  TYPE_MODEL,
  TYPE_RECTANGLE,
  TYPE_TEXT,
  createWidgetGroup,
} = require("./widgetGroup");

const GROUP_ID = 30005;
const ITEM_FONT = 495; // p12_full
const FANCY_FONT = 497; // q8_full
const COMPONENT = {
  ROOT: 0,
  QUESTION: 1,
  ITEM: 2,
  NAME: 3,
  YES_ICON: 4,
  YES: 5,
  NO_ICON: 6,
  NO: 7,
  WARNING: 8,
  INFO_BACKGROUND: 9,
  INFO: 10,
  YES_HITBOX: 11,
  NO_HITBOX: 12,
};
const uid = (component) => (GROUP_ID << 16) | component;
const DESTROY_ITEM_YES = uid(COMPONENT.YES_HITBOX);
const DESTROY_ITEM_NO = uid(COMPONENT.NO_HITBOX);

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 18,
    rawHeight: 18,
    widthMode: 1,
    heightMode: 1,
    width: 479,
    height: 96,
    xPositionMode: 1,
    yPositionMode: 1,
  });
  add(COMPONENT.QUESTION, root, {
    type: TYPE_TEXT,
    rawY: 6,
    rawWidth: 479,
    rawHeight: 18,
    width: 479,
    height: 18,
    text: "Are you sure you want to destroy this item?",
    fontId: FANCY_FONT,
    textColor: 0x990000,
    textShadowed: false,
    xTextAlignment: 1,
    yTextAlignment: 1,
  });
  add(COMPONENT.ITEM, root, {
    type: TYPE_GRAPHIC,
    rawX: 42,
    rawY: 28,
    rawWidth: 36,
    rawHeight: 32,
    width: 36,
    height: 32,
    itemQuantityMode: 2,
  });
  add(COMPONENT.NAME, root, {
    type: TYPE_TEXT,
    rawX: 82,
    rawY: 30,
    rawWidth: 155,
    rawHeight: 18,
    width: 155,
    height: 18,
    text: "",
    fontId: ITEM_FONT,
    textColor: 0,
    textShadowed: false,
    yTextAlignment: 1,
  });
  for (const [component, x, modelId, rotationX, rotationY, modelZoom] of [
    [COMPONENT.YES_ICON, 250, 8685, 300, 0, 1463],
    [COMPONENT.NO_ICON, 355, 8684, 400, 2021, 2000],
  ]) {
    add(component, root, {
      type: TYPE_MODEL,
      rawX: x,
      rawY: 24,
      rawWidth: 40,
      rawHeight: 40,
      width: 40,
      height: 40,
      modelId,
      rotationX,
      rotationY,
      rotationZ: 0,
      modelZoom,
    });
  }
  for (const [component, x, text, color] of [
    [COMPONENT.YES, 292, "Yes", 0x006600],
    [COMPONENT.NO, 397, "No", 0x990000],
  ]) {
    add(component, root, {
      type: TYPE_TEXT,
      rawX: x,
      rawY: 30,
      rawWidth: 50,
      rawHeight: 28,
      width: 50,
      height: 28,
      text,
      fontId: ITEM_FONT,
      textColor: color,
      textShadowed: false,
      xTextAlignment: 0,
      yTextAlignment: 1,
    });
  }
  add(COMPONENT.WARNING, root, {
    type: TYPE_TEXT,
    rawY: 58,
    rawWidth: 479,
    rawHeight: 24,
    width: 479,
    height: 24,
    text: "This item will be destroyed permanently.",
    fontId: FANCY_FONT,
    textColor: 0x0000cc,
    textShadowed: false,
    xTextAlignment: 1,
    yTextAlignment: 1,
  });
  add(COMPONENT.INFO_BACKGROUND, root, {
    type: TYPE_RECTANGLE,
    rawY: 84,
    rawWidth: 479,
    rawHeight: 12,
    width: 479,
    height: 12,
    filled: true,
    color: 0xe4d5ad,
  });
  add(COMPONENT.INFO, root, {
    type: TYPE_TEXT,
    rawX: 10,
    rawY: 84,
    rawWidth: 260,
    rawHeight: 12,
    width: 260,
    height: 12,
    text: "Destroying an object.",
    fontId: ITEM_FONT,
    textColor: 0,
    textShadowed: false,
    yTextAlignment: 1,
  });
  for (const [component, x, action] of [
    [COMPONENT.YES_HITBOX, 250, "Yes"],
    [COMPONENT.NO_HITBOX, 355, "No"],
  ]) {
    add(component, root, {
      rawX: x,
      rawY: 24,
      rawWidth: 100,
      rawHeight: 40,
      width: 100,
      height: 40,
      actions: [action],
      flags: FLAG_OP1,
    });
  }
  return { groupId: GROUP_ID, widgets };
}

const INTERFACE_DEFINITION = buildInterface();
const pendingDestroys = new WeakMap();

function close(player) {
  pendingDestroys.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
}

function open(player, item, slot) {
  pendingDestroys.set(player, { itemId: item.getId(), amount: item.getAmount(), slot });
  player.setDestroyItem(item.getId());
  player
    .getPacketSender()
    .sendChatboxInterface(GROUP_ID)
    .sendItemOnInterface(uid(COMPONENT.ITEM), item.getId(), 0, item.getAmount())
    .sendString(item.getDefinition().getName(), uid(COMPONENT.NAME));
}

function pendingDestroy(player) {
  const pending = pendingDestroys.get(player);
  if (!pending || player.getDestroyItem() !== pending.itemId) return undefined;
  if (!player.getPacketSender().isChatboxInterface(GROUP_ID)) return undefined;
  return pending;
}

module.exports = {
  name: "DestroyItem",
  register(api) {
    api.registerCustomInterface(INTERFACE_DEFINITION);

    api.onItemDropPolicy((event) => {
      if (event.item.isDropable()) return;
      open(event.player, event.item, event.slot);
      event.handled = true;
    });

    api.onInterfaceActionButton(DESTROY_ITEM_YES, ({ player }) => {
      const pending = pendingDestroy(player);
      if (!pending) return false;

      const item = player.getInventory().getItems()[pending.slot];
      if (item?.getId() === pending.itemId) {
        player.getInventory().deleteAtSlot(pending.slot, pending.amount);
      }
      close(player);
    });

    api.onInterfaceActionButton(DESTROY_ITEM_NO, ({ player }) => {
      if (!pendingDestroy(player)) return false;
      close(player);
    });
  },
};
