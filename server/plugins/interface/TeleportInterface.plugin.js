const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { TeleportHandler } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportHandler");
const { TeleportType } = require("../../src/main/typescript/elvarg/game/model/teleportation/TeleportType");
const { FLAG_OP1, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("./widgetGroup");

const GROUP_ID = 30007;
const MAIN_MODAL_UID = (161 << 16) | 16;
const TAB = { TELEPORTS: "teleports", WILDERNESS: "wilderness", BOSSES: "bosses" };
const TAB_ORDER = [TAB.TELEPORTS, TAB.WILDERNESS, TAB.BOSSES];
const TAB_LABELS = { [TAB.TELEPORTS]: "Teleports", [TAB.WILDERNESS]: "Wilderness", [TAB.BOSSES]: "Bosses" };
const COMPONENT = { ROOT: 0, FRAME: 1, TAB_START: 10, TAB_LABEL_START: 20, LIST_VIEW: 30, LIST_SCROLLBAR: 31, ROW_BACKGROUND_START: 100, ROW_LABEL_START: 200 };
const uid = (component) => (GROUP_ID << 16) | component;
const ROW_COUNT = 32;
const ROW_HEIGHT = 24;
const ROW_COLUMNS = 2;
const ROW_WIDTH = 216;
const LIST_CONTENT_HEIGHT = Math.ceil(ROW_COUNT / ROW_COLUMNS) * ROW_HEIGHT;
const TAB_UIDS = TAB_ORDER.map((_, index) => uid(COMPONENT.TAB_START + index));
const ROW_UIDS = Array.from({ length: ROW_COUNT }, (_, row) => uid(COMPONENT.ROW_LABEL_START + row));
const ATTR_TAB = "teleports:tab";

const location = (x, y, z = 0) => new Location(x, y, z);
const teleport = (name, destination, type) => ({ name, destination, type });

// Spellbook destinations implemented by this server. The interface is a free server
// teleport list; clicking the spell itself still enforces its rune and level requirements.
const DESTINATIONS = {
  [TAB.TELEPORTS]: [
    teleport("Standard: Lumbridge", location(3222, 3218), TeleportType.NORMAL),
    teleport("Standard: Varrock", location(3213, 3424), TeleportType.NORMAL),
    teleport("Standard: Falador", location(2964, 3378), TeleportType.NORMAL),
    teleport("Standard: House", location(2953, 3224), TeleportType.NORMAL),
    teleport("Standard: Camelot", location(2757, 3478), TeleportType.NORMAL),
    teleport("Standard: Kourend Castle", location(1643, 3672), TeleportType.NORMAL),
    teleport("Standard: Ardougne", location(2661, 3301), TeleportType.NORMAL),
    teleport("Standard: Civitas Illa Fortis", location(1680, 3130), TeleportType.NORMAL),
    teleport("Standard: Watchtower", location(2549, 3112, 2), TeleportType.NORMAL),
    teleport("Standard: Trollheim", location(2891, 3678), TeleportType.NORMAL),
    teleport("Standard: Ape Atoll", location(2796, 2798), TeleportType.NORMAL),
    teleport("Ancient: Edgeville", location(3087, 3496), TeleportType.ANCIENT),
    teleport("Ancient: Paddewwa", location(3097, 9880), TeleportType.ANCIENT),
    teleport("Ancient: Senntisten", location(3320, 3338), TeleportType.ANCIENT),
    teleport("Ancient: Kharyrll", location(3492, 3471), TeleportType.ANCIENT),
    teleport("Ancient: Lassar", location(3002, 3470), TeleportType.ANCIENT),
    teleport("Arceuus: Home", location(1712, 3882), TeleportType.ARCEUUS),
    teleport("Arceuus: Library", location(1632, 3838), TeleportType.ARCEUUS),
    teleport("Arceuus: Draynor Manor", location(3108, 3352), TeleportType.ARCEUUS),
    teleport("Arceuus: Battlefront", location(1348, 3739), TeleportType.ARCEUUS),
    teleport("Arceuus: Mind Altar", location(2980, 3510), TeleportType.ARCEUUS),
    teleport("Arceuus: Respawn", GameConstants.DEFAULT_LOCATION, TeleportType.ARCEUUS),
    teleport("Arceuus: Salve Graveyard", location(3432, 3461), TeleportType.ARCEUUS),
    teleport("Arceuus: Fenkenstrain's Castle", location(3548, 3528), TeleportType.ARCEUUS),
    teleport("Arceuus: West Ardougne", location(2500, 3291), TeleportType.ARCEUUS),
    teleport("Arceuus: Harmony Island", location(3797, 2866), TeleportType.ARCEUUS),
    teleport("Arceuus: Barrows", location(3565, 3315), TeleportType.ARCEUUS),
    teleport("Arceuus: Ape Atoll", location(2770, 9100), TeleportType.ARCEUUS),
    teleport("Ring of wealth: Grand Exchange", location(3163, 3488), TeleportType.NORMAL),
    teleport("Ring of wealth: Miscellania", location(2539, 3864), TeleportType.NORMAL),
    teleport("Ring of wealth: Falador Park", location(2994, 3377), TeleportType.NORMAL),
    teleport("Ring of wealth: Dondakan", location(2824, 10168), TeleportType.NORMAL),
  ],
  [TAB.WILDERNESS]: [
    teleport("Ancient: Dareeyak", location(2966, 3696), TeleportType.ANCIENT),
    teleport("Ancient: Carrallanger", location(3156, 3666), TeleportType.ANCIENT),
    teleport("Ancient: Annakarl", location(3288, 3886), TeleportType.ANCIENT),
    teleport("Ancient: Ghorrock", location(2977, 3873), TeleportType.ANCIENT),
    teleport("Arceuus: Cemetery", location(2978, 3763), TeleportType.ARCEUUS),
  ],
  [TAB.BOSSES]: [
    teleport("Callisto", location(3290, 3847), TeleportType.NORMAL),
    teleport("Chaos Elemental", location(3261, 3927), TeleportType.NORMAL),
    teleport("Chaos Fanatic", location(2979, 3846), TeleportType.NORMAL),
    teleport("Crazy Archaeologist", location(2977, 3702), TeleportType.NORMAL),
    teleport("King Black Dragon", location(3010, 3849), TeleportType.NORMAL),
    teleport("Scorpia", location(3233, 10341), TeleportType.NORMAL),
    teleport("Venenatis", location(3332, 3734), TeleportType.NORMAL),
    teleport("Vet'ion", location(3219, 3788), TeleportType.NORMAL),
    teleport("Count Draynor", location(3077, 9772), TeleportType.NORMAL),
    teleport("Elvarg", location(2852, 9637), TeleportType.NORMAL),
    teleport("Kalphite Queen", location(3508, 9494), TeleportType.NORMAL),
  ],
};

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: 494, height: 316, xPositionMode: 1, yPositionMode: 1,
  });
  add(COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 494, height: 316 });
  for (let index = 0; index < TAB_ORDER.length; index++) {
    const x = 18 + index * 152;
    add(COMPONENT.TAB_START + index, root, {
      type: TYPE_RECTANGLE, rawX: x, rawY: 32, rawWidth: 146, rawHeight: 24, width: 146, height: 24,
      filled: true, color: 0x2b241b, mouseOverColor: 0x3a3125, opacity: 32, actions: ["Open"], flags: FLAG_OP1,
    });
    add(COMPONENT.TAB_LABEL_START + index, root, {
      type: TYPE_TEXT, rawX: x, rawY: 32, rawWidth: 146, rawHeight: 24, width: 146, height: 24,
      text: "", fontId: 496, textColor: 0xffd27f, textShadowed: true, xTextAlignment: 1, yTextAlignment: 1,
    });
  }
  const list = add(COMPONENT.LIST_VIEW, root, {
    rawX: 18, rawY: 72, rawWidth: 448, rawHeight: 224, width: 448, height: 224, scrollWidth: 448, scrollHeight: LIST_CONTENT_HEIGHT,
  });
  add(COMPONENT.LIST_SCROLLBAR, root, { rawX: 466, rawY: 72, rawWidth: 16, rawHeight: 224, width: 16, height: 224, noClickThrough: true });
  for (let row = 0; row < ROW_COUNT; row++) {
    const x = (row % ROW_COLUMNS) * ROW_WIDTH;
    const y = Math.floor(row / ROW_COLUMNS) * ROW_HEIGHT;
    add(COMPONENT.ROW_BACKGROUND_START + row, list, {
      type: TYPE_RECTANGLE, rawX: x, rawY: y, rawWidth: ROW_WIDTH - 4, rawHeight: ROW_HEIGHT - 3, width: ROW_WIDTH - 4, height: ROW_HEIGHT - 3,
      filled: true, color: 0x211b16, mouseOverColor: 0x3a3125, opacity: 32,
    });
    add(COMPONENT.ROW_LABEL_START + row, list, {
      type: TYPE_TEXT, rawX: x + 6, rawY: y, rawWidth: ROW_WIDTH - 16, rawHeight: ROW_HEIGHT - 3, width: ROW_WIDTH - 16, height: ROW_HEIGHT - 3,
      text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true, yTextAlignment: 1, actions: ["Teleport"], flags: FLAG_OP1,
    });
  }
  return { groupId: GROUP_ID, widgets, scroll: [{ viewComponent: COMPONENT.LIST_VIEW, scrollbarComponent: COMPONENT.LIST_SCROLLBAR, contentHeight: LIST_CONTENT_HEIGHT }] };
}

const INTERFACE_DEFINITION = buildInterface();

function selectedTab(player) {
  const tab = player?.getAttribute?.(ATTR_TAB);
  return TAB_ORDER.includes(tab) ? tab : TAB.TELEPORTS;
}

function render(player, tab = selectedTab(player)) {
  player.setAttribute(ATTR_TAB, tab);
  const sender = player.getPacketSender();
  for (let index = 0; index < TAB_ORDER.length; index++) {
    const current = TAB_ORDER[index];
    sender.sendString(current === tab ? `<col=ffffff>${TAB_LABELS[current]}</col>` : `<col=ffd27f>${TAB_LABELS[current]}</col>`, uid(COMPONENT.TAB_LABEL_START + index));
  }
  const destinations = DESTINATIONS[tab];
  for (let row = 0; row < ROW_COUNT; row++) {
    const entry = destinations[row];
    sender.sendString(entry?.name ?? "", uid(COMPONENT.ROW_LABEL_START + row))
      .sendInterfaceDisplayState(uid(COMPONENT.ROW_BACKGROUND_START + row), !entry)
      .sendInterfaceDisplayState(uid(COMPONENT.ROW_LABEL_START + row), !entry);
  }
}

function open(player, tab = TAB.TELEPORTS) {
  player.setInterfaceId(GROUP_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: 227, args: [uid(COMPONENT.FRAME), "Server Teleports"] }],
  });
  render(player, tab);
}

function selectDestination(player, row) {
  if (player.getInterfaceId?.() !== GROUP_ID) return false;
  const entry = DESTINATIONS[selectedTab(player)][row];
  if (!entry) return true;
  player.getPacketSender().sendInterfaceRemoval();
  if (!TeleportHandler.checkReqs(player, entry.destination)) return true;
  TeleportHandler.teleport(player, entry.destination, entry.type, false);
  return true;
}

module.exports = {
  name: "TeleportInterface",
  register(api) {
    api.registerCustomInterface(INTERFACE_DEFINITION);
    api.registerCommand("teleports", ({ player }) => (open(player), true));
    api.onInterfaceActionButton(TAB_UIDS, ({ player, buttonId }) => {
      const index = TAB_UIDS.indexOf(buttonId);
      if (index >= 0) render(player, TAB_ORDER[index]);
      return true;
    });
    api.onInterfaceActionButton(ROW_UIDS, ({ player, buttonId }) => selectDestination(player, ROW_UIDS.indexOf(buttonId)));
  },
  _test: { GROUP_ID, COMPONENT, DESTINATIONS, LIST_CONTENT_HEIGHT, ROW_COUNT, TAB, TAB_UIDS, ROW_UIDS, open, render, selectDestination, uid },
};
