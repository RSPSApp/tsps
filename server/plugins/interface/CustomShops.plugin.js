const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { ShopDefinition } = require("../../src/main/typescript/elvarg/game/definition/ShopDefinition");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { ShopManager } = require("../../src/main/typescript/elvarg/game/model/container/shop/ShopManager");
const { FLAG_OP1, TYPE_GRAPHIC, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("./widgetGroup");

const GROUP_ID = 30009;
const OVERLAY_HOST_UID = (161 << 16) | 34;
const LEFT_ROW_COUNT = 32;
const LEFT_ROW_HEIGHT = 28;
const BUY_NOTED_ATTRIBUTE = "custom-shops:buy-noted";
const COMPONENT = {
  ROOT: 0,
  LEFT_PANEL: 1,
  SHOP_CONTAINER: 2,
  LEFT_TITLE: 3,
  LEFT_VIEW: 4,
  LEFT_SCROLLBAR: 5,
  NOTED_TOGGLE: 6,
  LEFT_BACKGROUND_START: 20,
  LEFT_ICON_START: 60,
  LEFT_LABEL_START: 100,
};
const uid = (component) => (GROUP_ID << 16) | component;
const LEFT_ROW_UIDS = Array.from({ length: LEFT_ROW_COUNT }, (_, row) => uid(COMPONENT.LEFT_LABEL_START + row));
const LIST_CONTENT_HEIGHT = LEFT_ROW_COUNT * LEFT_ROW_HEIGHT;
const selectedShopIds = new WeakMap();

let CombatFactory;
let ItemDefinition;

function customShops() {
  const file = path.join(GameConstants.DEFINITIONS_DIRECTORY, "custom-shops.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const definition = ShopDefinition.forId(Number(entry?.id));
      return definition ? { definition, iconItemId: Number.isInteger(entry?.icon) ? entry.icon : -1 } : null;
    })
    .filter(Boolean);
}

function selectedShop(player, shops) {
  const selected = shops.find(({ definition }) => definition.getId() === selectedShopIds.get(player));
  if (selected) return selected;
  const first = shops[0];
  if (first) selectedShopIds.set(player, first.definition.getId());
  return first;
}

function canUseShops(player) {
  if (Wilderness.isIn(player)) {
    player.sendMessage("You cannot open shops in the Wilderness.");
    return false;
  }
  if (CombatFactory.inCombat(player)) {
    player.sendMessage("You cannot open shops while in combat.");
    return false;
  }
  if (player.busy() && player.getInterfaceId() !== ShopManager.MAIN_INTERFACE_ID) {
    player.sendMessage("You cannot open shops while busy.");
    return false;
  }
  return true;
}

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 680, rawHeight: 320,
    width: 680, height: 320, xPositionMode: 1, yPositionMode: 1,
    fitToViewport: true,
  });
  add(COMPONENT.LEFT_PANEL, root, {
    type: TYPE_RECTANGLE, rawY: 20, rawWidth: 164, rawHeight: 300, width: 164, height: 300,
    filled: true, color: 0x211b16, mouseOverColor: 0x211b16, opacity: 16,
  });
  add(COMPONENT.SHOP_CONTAINER, root, {
    rawX: 168, rawWidth: 488, rawHeight: 320, width: 488, height: 320,
  });
  add(COMPONENT.LEFT_TITLE, root, {
    type: TYPE_TEXT, rawX: 4, rawY: 26, rawWidth: 140, rawHeight: 18, width: 140, height: 18,
    text: "<col=ffd27f>Custom shops</col>", fontId: 496, textColor: 0xffd27f, textShadowed: true, xTextAlignment: 1, yTextAlignment: 1,
  });
  const list = add(COMPONENT.LEFT_VIEW, root, {
    rawX: 4, rawY: 48, rawWidth: 140, rawHeight: 240, width: 140, height: 240, scrollWidth: 140, scrollHeight: LIST_CONTENT_HEIGHT,
  });
  add(COMPONENT.LEFT_SCROLLBAR, root, { rawX: 146, rawY: 48, rawWidth: 16, rawHeight: 240, width: 16, height: 240, noClickThrough: true });

  add(COMPONENT.NOTED_TOGGLE, root, {
    type: TYPE_TEXT, rawX: 4, rawY: 292, rawWidth: 156, rawHeight: 24, width: 156, height: 24,
    text: "Buy noted: Off", fontId: 494, textColor: 0xe8ded0, textShadowed: true, xTextAlignment: 1, yTextAlignment: 1,
    actions: ["Toggle"], flags: FLAG_OP1,
  });

  for (let row = 0; row < LEFT_ROW_COUNT; row++) {
    const y = row * LEFT_ROW_HEIGHT;
    add(COMPONENT.LEFT_BACKGROUND_START + row, list, {
      type: TYPE_RECTANGLE, rawY: y, rawWidth: 140, rawHeight: 26, width: 140, height: 26,
      filled: true, color: 0x211b16, mouseOverColor: 0x3a3125, opacity: 32,
    });
    add(COMPONENT.LEFT_ICON_START + row, list, {
      type: TYPE_GRAPHIC, rawX: 4, rawY: y + 2, rawWidth: 24, rawHeight: 22, width: 24, height: 22,
      itemQuantityMode: 0,
    });
    add(COMPONENT.LEFT_LABEL_START + row, list, {
      type: TYPE_TEXT, rawX: 32, rawY: y, rawWidth: 104, rawHeight: 26, width: 104, height: 26,
      text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true, yTextAlignment: 1, actions: ["Select"], flags: FLAG_OP1,
    });
  }

  return {
    groupId: GROUP_ID,
    widgets,
    scroll: [{ viewComponent: COMPONENT.LEFT_VIEW, scrollbarComponent: COMPONENT.LEFT_SCROLLBAR, contentHeight: LIST_CONTENT_HEIGHT }],
  };
}

const INTERFACE_DEFINITION = buildInterface();

function render(player, shops = customShops()) {
  const shop = selectedShop(player, shops);
  const sender = player.getPacketSender();
  renderNotedToggle(player);

  for (let row = 0; row < LEFT_ROW_COUNT; row++) {
    const entry = shops[row];
    const hidden = !entry;
    sender
      .sendString(entry ? (entry.definition.getId() === shop?.definition.getId() ? `<col=ffffff>${entry.definition.getName()}</col>` : entry.definition.getName()) : "", uid(COMPONENT.LEFT_LABEL_START + row))
      .sendInterfaceDisplayState(uid(COMPONENT.LEFT_BACKGROUND_START + row), hidden)
      .sendInterfaceDisplayState(uid(COMPONENT.LEFT_ICON_START + row), hidden)
      .sendInterfaceDisplayState(uid(COMPONENT.LEFT_LABEL_START + row), hidden);
    if (entry) {
      sender.sendItemOnInterface(uid(COMPONENT.LEFT_ICON_START + row), entry.iconItemId, 0, 1);
    }
  }

}

function open(player, shop = selectedShop(player, customShops())) {
  if (!shop) {
    player.sendMessage("No custom shops are available.");
    return;
  }
  selectedShopIds.set(player, shop.definition.getId());
  player.getPacketSender().sendSubInterface(OVERLAY_HOST_UID, GROUP_ID, 0);
  if (ShopManager.open(player, shop.definition.getId(), true, uid(COMPONENT.SHOP_CONTAINER))) {
    render(player, customShops());
  }
}

function selectShop(player, row) {
  if (player.getInterfaceId() !== ShopManager.MAIN_INTERFACE_ID || !canUseShops(player)) return true;
  const shop = customShops()[row];
  if (shop) open(player, shop);
  return true;
}

function renderNotedToggle(player) {
  const noted = player.getAttribute(BUY_NOTED_ATTRIBUTE) === true;
  player.getPacketSender().sendString(`Buy noted: <col=${noted ? "00ff00" : "ff9040"}>${noted ? "On" : "Off"}</col>`, uid(COMPONENT.NOTED_TOGGLE));
}

function toggleNoted({ player }) {
  if (player.getInterfaceId() !== ShopManager.MAIN_INTERFACE_ID || !selectedShopIds.has(player) || !canUseShops(player)) return;
  player.setAttribute(BUY_NOTED_ATTRIBUTE, player.getAttribute(BUY_NOTED_ATTRIBUTE) !== true);
  renderNotedToggle(player);
}

function deliverNoted(request) {
  if (request.player.getAttribute(BUY_NOTED_ATTRIBUTE) !== true ||
      selectedShopIds.get(request.player) !== request.shopId || request.deliverId !== request.itemId) return;
  const definition = ItemDefinition.forId(request.deliverId);
  if (definition.isStackable()) return;
  const noteId = definition.getNoteId();
  if (!Number.isInteger(noteId) || noteId <= 0) return;
  const note = ItemDefinition.forId(noteId);
  if (note.isNoted() && note.unNote() === request.deliverId) request.deliverId = noteId;
}

function openShops({ player }) {
  if (canUseShops(player)) open(player);
  return true;
}

function selectShopButton({ player, buttonId }) {
  return selectShop(player, LEFT_ROW_UIDS.indexOf(buttonId));
}

function initialize(api) {
  CombatFactory = api.getCombatFactory();
  ItemDefinition = api.core.ItemDefinition;
}

module.exports = {
  name: "CustomShops",
  register(api) {
    api.onServerStartup(initialize.bind(null, api));
    api.persistAttribute(BUY_NOTED_ATTRIBUTE, false);
    api.registerCustomInterface(INTERFACE_DEFINITION);
    api.registerCommand("shops", openShops, undefined, "Browse custom shops");
    api.onInterfaceActionButton(LEFT_ROW_UIDS, selectShopButton);
    api.onInterfaceActionButton(uid(COMPONENT.NOTED_TOGGLE), toggleNoted);
    api.onCustomEvent("shop:delivery", deliverNoted);
  },
};
