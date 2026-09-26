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
const COMPONENT = {
  ROOT: 0,
  LEFT_PANEL: 1,
  SHOP_CONTAINER: 2,
  LEFT_TITLE: 3,
  LEFT_VIEW: 4,
  LEFT_SCROLLBAR: 5,
  LEFT_BACKGROUND_START: 20,
  LEFT_ICON_START: 60,
  LEFT_LABEL_START: 100,
};
const uid = (component) => (GROUP_ID << 16) | component;
const LEFT_ROW_UIDS = Array.from({ length: LEFT_ROW_COUNT }, (_, row) => uid(COMPONENT.LEFT_LABEL_START + row));
const LIST_CONTENT_HEIGHT = LEFT_ROW_COUNT * LEFT_ROW_HEIGHT;
const selectedShopIds = new WeakMap();
const ICON_ITEM_IDS = {
  "Fire rune": 554,
  "Manta ray": 391,
  "Super strength(4)": 2440,
  "Rune arrow": 892,
  "Armadyl godsword": 11802,
  "Rune platebody": 1127,
  "Staff of fire": 1387,
  "Mystic robe top": 4091,
  "Magic shortbow": 861,
  "Black d'hide body": 2503,
  "Dragon claws": 13652,
  "Dharok's helm": 4716,
  "Amulet of glory": 1704,
  "Berserker ring": 6737,
  "Fire cape": 6570,
  "Dragonfire shield": 11283,
  "Barrows gloves": 7462,
  "Dragon boots": 11840,
  "Rune pickaxe": 1275,
  "Blue partyhat": 1042,
};

let CombatFactory;

function iconItemId(icon) {
  if (Number.isInteger(icon)) return icon;
  return typeof icon === "string" ? ICON_ITEM_IDS[icon] ?? -1 : -1;
}

function customShops() {
  const file = path.join(GameConstants.DEFINITIONS_DIRECTORY, "custom-shops.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const definition = ShopDefinition.forId(Number(entry?.id));
      const icon = entry?.icon ?? "";
      return definition ? { definition, iconItemId: iconItemId(icon) } : null;
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
    rawX: 4, rawY: 48, rawWidth: 140, rawHeight: 268, width: 140, height: 268, scrollWidth: 140, scrollHeight: LIST_CONTENT_HEIGHT,
  });
  add(COMPONENT.LEFT_SCROLLBAR, root, { rawX: 146, rawY: 48, rawWidth: 16, rawHeight: 268, width: 16, height: 268, noClickThrough: true });

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

module.exports = {
  name: "CustomShops",
  register(api) {
    CombatFactory = api.getCombatFactory();
    api.registerCustomInterface(INTERFACE_DEFINITION);
    api.registerCommand("shops", ({ player }) => {
      if (canUseShops(player)) open(player);
      return true;
    });
    api.onInterfaceActionButton(LEFT_ROW_UIDS, ({ player, buttonId }) => selectShop(player, LEFT_ROW_UIDS.indexOf(buttonId)));
  },
};
