/**
 * The idle travel screen (`::idle travel`, or Travel on the Idle screen): a server-defined
 * interface (group 30021) on the shared custom-interface runtime's list, like ::teleports. Tabs
 * per activity, a searchable list of the sites (each with its resource's item as the icon and the
 * level it needs, with the player's own when it falls short), and a details panel filled client-side when a row is clicked: where it is, the
 * level (green when the player has it), what to bring, and a Travel button. Right-click Travel on
 * a row goes straight there.
 */
const Common = require("./Common.IdleMode");
const Travel = require("./Travel.IdleMode");

const { FLAG_OP1, FLAG_OP2, TYPE_GRAPHIC, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("../../interface/widgetGroup");

const GROUP_ID = 30021;
const MAIN_MODAL_UID = (161 << 16) | 16;
const FRAME_TITLE_SCRIPT = 227;
const TITLE = "Idle Travel";
const COMPONENT = {
  ROOT: 0, FRAME: 1, SEARCH_BOX: 2, SEARCH_INPUT: 3, STATUS: 4, DATA: 5, LIST_VIEW: 6, LIST_SCROLLBAR: 7,
  PANEL: 8, PANEL_ICON: 9, PANEL_TITLE: 10, PANEL_SUBTITLE: 11, PANEL_LEVEL: 12, PANEL_TOOL: 13,
  PANEL_DESCRIPTION: 14, TRAVEL_BUTTON: 15, TRAVEL_LABEL: 16, LAYOUT: 17,
  TAB_START: 20, TAB_LABEL_START: 30, ROW_BACKGROUND_START: 40, ROW_ICON_START: 60, ROW_LABEL_START: 80,
};
/** Each tab: the sites it lists (`has`), and the header they go under on the All tab. */
const TABS = [
  { label: "All", has: null },
  { label: "Woodcut", header: "Woodcutting", has: (site) => site.skill === "WOODCUTTING" },
  { label: "Mining", header: "Mining", has: (site) => site.skill === "MINING" },
  { label: "Fishing", header: "Fishing", has: (site) => site.skill === "FISHING" },
  { label: "Combat", header: "Combat", has: (site) => site.skill === Travel.COMBAT },
  { label: "Making", header: "Making", has: (site) => Travel.isProduction(site) },
];
const TAB_WIDTH = 60;
const TAB_STEP = 64;
const ROW_SLOTS = 10;
const ROW_HEIGHT = 26;
const LIST = { x: 18, y: 96, width: 258, height: 204 };
const PANEL = { x: 298, y: 56, width: 178, height: 244 };
const OP = { SELECT: 1, TRAVEL: 2 };
const SEARCH_MAX_LENGTH = 40;
const COLOUR = { OK: "00ff00", SHORT: "ff5f5f", VALUE: "ffffff" };

const uid = (component) => (GROUP_ID << 16) | component;
const col = (colour, text) => `<col=${colour}>${text}</col>`;

const text = (x, y, width, height, overrides = {}) => ({
  type: TYPE_TEXT, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
  text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true, ...overrides,
});
const box = (x, y, width, height, overrides = {}) => ({
  type: TYPE_RECTANGLE, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
  filled: true, color: 0x211b16, opacity: 32, ...overrides,
});

function addTabs(add, root) {
  TABS.forEach((_, index) => {
    const x = 18 + index * TAB_STEP;
    add(COMPONENT.TAB_START + index, root, box(x, 32, TAB_WIDTH, 20, {
      color: 0x2b241b, mouseOverColor: 0x3a3125, actions: ["Open"], flags: FLAG_OP1,
    }));
    add(COMPONENT.TAB_LABEL_START + index, root, text(x, 32, TAB_WIDTH, 20, { textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1 }));
  });
}

function addList(add, root) {
  add(COMPONENT.SEARCH_BOX, root, box(18, 56, 274, 20, { color: 0x2b241b, mouseOverColor: 0x3a3125, actions: ["Search"], flags: FLAG_OP1 }));
  add(COMPONENT.SEARCH_INPUT, root, text(24, 56, 262, 20, { yTextAlignment: 1, actions: ["Search"], flags: FLAG_OP1 }));
  add(COMPONENT.STATUS, root, text(18, 78, 274, 16, { textColor: 0xffd27f, yTextAlignment: 1 }));
  add(COMPONENT.DATA, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
  add(COMPONENT.LAYOUT, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
  const list = add(COMPONENT.LIST_VIEW, root, {
    rawX: LIST.x, rawY: LIST.y, rawWidth: LIST.width, rawHeight: LIST.height,
    width: LIST.width, height: LIST.height, scrollWidth: LIST.width, scrollHeight: LIST.height,
  });
  add(COMPONENT.LIST_SCROLLBAR, root, {
    rawX: LIST.x + LIST.width, rawY: LIST.y, rawWidth: 16, rawHeight: LIST.height, width: 16, height: LIST.height, noClickThrough: true,
  });
  for (let slot = 0; slot < ROW_SLOTS; slot++) {
    add(COMPONENT.ROW_BACKGROUND_START + slot, list, box(0, 0, LIST.width - 2, ROW_HEIGHT - 2, { mouseOverColor: 0x3a3125 }));
    add(COMPONENT.ROW_ICON_START + slot, list, {
      type: TYPE_GRAPHIC, rawX: 3, rawY: 0, rawWidth: 24, rawHeight: 22, width: 24, height: 22, itemQuantityMode: 0,
    });
    add(COMPONENT.ROW_LABEL_START + slot, list, text(32, 0, LIST.width - 38, ROW_HEIGHT - 2, {
      yTextAlignment: 1, actions: ["Select", "Travel"], flags: FLAG_OP1 | FLAG_OP2,
    }));
  }
}

function addPanel(add, root) {
  const { x, y, width, height } = PANEL;
  add(COMPONENT.PANEL, root, box(x, y, width, height));
  add(COMPONENT.PANEL_ICON, root, { type: TYPE_GRAPHIC, rawX: x + 6, rawY: y + 6, rawWidth: 36, rawHeight: 32, width: 36, height: 32, itemQuantityMode: 0 });
  add(COMPONENT.PANEL_TITLE, root, text(x + 46, y + 4, width - 52, 20, { fontId: 496, textColor: 0xff981f, yTextAlignment: 1 }));
  add(COMPONENT.PANEL_SUBTITLE, root, text(x + 46, y + 22, width - 52, 16, { textColor: 0xb8ab94, yTextAlignment: 1 }));
  add(COMPONENT.PANEL_LEVEL, root, text(x + 6, y + 44, width - 12, 16));
  add(COMPONENT.PANEL_TOOL, root, text(x + 6, y + 60, width - 12, 30));
  add(COMPONENT.PANEL_DESCRIPTION, root, text(x + 6, y + 94, width - 12, height - 134, { textColor: 0xb8ab94 }));
  const buttonY = y + height - 30;
  add(COMPONENT.TRAVEL_BUTTON, root, box(x + 6, buttonY, width - 12, 24, {
    color: 0x3b2f20, mouseOverColor: 0x54432c, opacity: 0, actions: ["Travel"], flags: FLAG_OP1,
  }));
  add(COMPONENT.TRAVEL_LABEL, root, text(x + 6, buttonY, width - 12, 24, { text: "Travel", textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1 }));
}

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: 494, height: 316, xPositionMode: 1, yPositionMode: 1,
  });
  add(COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 494, height: 316 });
  addTabs(add, root);
  addList(add, root);
  addPanel(add, root);
  return {
    groupId: GROUP_ID, widgets,
    search: {
      inputComponent: COMPONENT.SEARCH_INPUT, backgroundComponent: COMPONENT.SEARCH_BOX,
      dataComponent: COMPONENT.DATA, maxLength: SEARCH_MAX_LENGTH, placeholder: "<col=8f7f66>Search activities...</col>",
      caret: "|", textTemplate: "%s", focusColor: 0x3a3125, blurColor: 0x2b241b,
    },
    list: {
      viewComponent: COMPONENT.LIST_VIEW, scrollbarComponent: COMPONENT.LIST_SCROLLBAR,
      slotCount: ROW_SLOTS, columns: 1, rowHeight: ROW_HEIGHT,
      backgroundStart: COMPONENT.ROW_BACKGROUND_START, iconStart: COMPONENT.ROW_ICON_START, iconBaseY: 1,
      // `detail` is plain text (the runtime strips markup), so its colour is the template's.
      labelStart: COMPONENT.ROW_LABEL_START, itemLabel: "%name<col=b8ab94>%detail</col>",
      headerLabel: "<col=ff981f>%name</col>", clickable: true,
      select: {
        op: OP.SELECT,
        texts: {
          title: COMPONENT.PANEL_TITLE, subtitle: COMPONENT.PANEL_SUBTITLE, level: COMPONENT.PANEL_LEVEL,
          tool: COMPONENT.PANEL_TOOL, description: COMPONENT.PANEL_DESCRIPTION,
        },
        iconComponent: COMPONENT.PANEL_ICON,
        showComponents: [COMPONENT.TRAVEL_BUTTON, COMPONENT.TRAVEL_LABEL],
      },
    },
    status: { component: COMPONENT.STATUS, matches: "Activities: %total", empty: "No activities." },
    tabs: {
      components: TABS.map((_, index) => COMPONENT.TAB_START + index),
      labelComponents: TABS.map((_, index) => COMPONENT.TAB_LABEL_START + index),
      labels: TABS.map((tab) => tab.label),
      activeTemplate: "<col=ffffff>%s</col>", inactiveTemplate: "<col=ffd27f>%s</col>",
      layoutComponent: COMPONENT.LAYOUT, clearQuery: true,
    },
  };
}

const isOpen = (player) => player.getInterfaceId?.() === GROUP_ID;
/** Row ids start at 1: the runtime sends the clicked row's id back as the slot. */
const rowId = (index) => index + 1;

function skillLabel(site) {
  return site.skill === Travel.COMBAT ? "Combat" : Common.skillName(site.skill);
}

function levelLine(player, site) {
  if (Travel.isProduction(site)) return `${skillLabel(site)}: ${col(COLOUR.OK, "any level")}`;
  const level = Travel.levelFor(player, site);
  if (site.skill === Travel.COMBAT) return `Advised combat level: ${col(level >= site.level ? COLOUR.OK : COLOUR.SHORT, site.level)}`;
  return `${skillLabel(site)} level: ${col(level >= site.level ? COLOUR.OK : COLOUR.SHORT, site.level)}`;
}

function description(site) {
  if (Travel.isProduction(site)) return `A teleport takes you there. ${site.tip ?? ""}`;
  const doing = site.skill === Travel.COMBAT
    ? `fights the nearest ${site.target.toLowerCase()}`
    : `uses ${site.option} on the nearest ${site.target.toLowerCase()}`;
  return `A teleport takes you there, and your character ${doing} by itself, banking what it gets.`;
}

/** Every site's row, with the details panel the client fills when it is clicked. */
function rows(player) {
  return Travel.sites().map((site, index) => {
    const level = Travel.levelFor(player, site);
    const short = site.skill !== Travel.COMBAT && !Travel.isProduction(site) && level < site.level;
    return {
      id: rowId(index),
      name: site.name,
      icon: site.icon,
      detail: Travel.isProduction(site) ? ` - ${site.place}` : short ? ` - Lvl ${site.level} (you: ${level})` : ` - Lvl ${site.level}`,
      terms: `${site.place} ${skillLabel(site)} ${site.target ?? ""}`,
      panel: {
        title: site.name,
        subtitle: site.place,
        level: levelLine(player, site),
        tool: `Bring: ${col(COLOUR.VALUE, site.tool)}`,
        description: description(site),
      },
    };
  });
}

/** Each tab's rows, under a header per activity on the All tab. */
function layouts() {
  const all = Travel.sites();
  const idsOf = (has) => all.flatMap((site, index) => (has(site) ? [rowId(index)] : []));
  return TABS.map((tab) => {
    if (tab.has) return idsOf(tab.has);
    return TABS.slice(1).flatMap((section) => {
      const ids = idsOf(section.has);
      return ids.length ? [{ header: section.header }, ...ids] : [];
    });
  });
}

/** The tab for the player's current activity, or All. */
function activeTab(player) {
  if (player.getAttribute(Common.PRODUCTION_TARGET_ATTRIBUTE)) return TABS.findIndex((tab) => tab.label === "Making");
  const fight = player.getAttribute(Common.COMBAT_TARGET_ATTRIBUTE);
  const gather = player.getAttribute(Common.GATHER_TARGET_ATTRIBUTE);
  const skill = fight ? Travel.COMBAT : gather?.skill;
  const index = TABS.findIndex((tab) => tab.has && skill && tab.has({ skill, kind: "object" }));
  return index >= 0 ? index : 0;
}

function showEmptyPanel(player) {
  const sender = player.getPacketSender();
  sender.sendInterfaceDisplayState(uid(COMPONENT.TRAVEL_BUTTON), true);
  sender.sendInterfaceDisplayState(uid(COMPONENT.TRAVEL_LABEL), true);
  sender.clearItemOnInterface?.(uid(COMPONENT.PANEL_ICON));
  sender.sendString(TITLE, uid(COMPONENT.PANEL_TITLE))
    .sendString("", uid(COMPONENT.PANEL_SUBTITLE))
    .sendString("", uid(COMPONENT.PANEL_LEVEL))
    .sendString("", uid(COMPONENT.PANEL_TOOL))
    .sendString("Pick an activity to see where it is and what it needs. Right-click one to travel straight there.",
      uid(COMPONENT.PANEL_DESCRIPTION));
}

/** player -> the site picked in the list, for the Travel button. */
const selected = new Map();

function open(player) {
  player.setInterfaceId(GROUP_ID);
  const sender = player.getPacketSender();
  sender.sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: FRAME_TITLE_SCRIPT, args: [uid(COMPONENT.FRAME), TITLE] }],
  });
  selected.delete(player);
  sender.sendString(JSON.stringify(rows(player)), uid(COMPONENT.DATA));
  sender.sendString(JSON.stringify({ active: activeTab(player), tabs: layouts() }), uid(COMPONENT.LAYOUT));
  sender.sendString("", uid(COMPONENT.SEARCH_INPUT));
  showEmptyPanel(player);
}

function siteOf(slot) {
  return Travel.sites()[slot - 1] ?? null;
}

/** A list row: its slot carries the row id the client showed there. */
function clickRow({ player, slot, opId }) {
  if (!isOpen(player)) return false;
  const site = siteOf(slot);
  if (!site) return true;
  if (opId === OP.TRAVEL) Travel.travel(player, site);
  else selected.set(player, site);
  return true;
}

function clickTravel({ player }) {
  if (!isOpen(player)) return false;
  const site = selected.get(player);
  if (site) Travel.travel(player, site);
  return true;
}

/** The client switches tabs itself; nothing to keep. */
function clickTab({ player }) {
  return isOpen(player);
}

function forget({ player }) {
  selected.delete(player);
}

const ROW_UIDS = Array.from({ length: ROW_SLOTS }, (_, slot) => uid(COMPONENT.ROW_LABEL_START + slot));
const TAB_UIDS = TABS.map((_, index) => uid(COMPONENT.TAB_START + index));

module.exports = function attach(api) {
  api.registerCustomInterface(buildInterface());
  Common.registerScreen(GROUP_ID);
  api.onInterfaceActionButton(ROW_UIDS, clickRow);
  api.onInterfaceActionButton([uid(COMPONENT.TRAVEL_BUTTON), uid(COMPONENT.TRAVEL_LABEL)], clickTravel);
  api.onInterfaceActionButton(TAB_UIDS, clickTab);
  api.onPlayerLogout(forget);
};

module.exports.GROUP_ID = GROUP_ID;
module.exports.COMPONENT = COMPONENT;
module.exports.OP = OP;
module.exports.ROW_UIDS = ROW_UIDS;
module.exports.uid = uid;
module.exports.open = open;
module.exports.rows = rows;
module.exports.layouts = layouts;
