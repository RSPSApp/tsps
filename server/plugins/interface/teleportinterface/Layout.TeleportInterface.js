/**
 * The ::teleports widget group: tabs across the top, a searchable list of destinations on
 * the left and the selected destination's details on the right. The list is the shared
 * custom-interface runtime's virtual list, so it scrolls, filters, switches tabs and fills
 * the details panel client-side, and sends each row's id back with its ops.
 */
const { FLAG_OP1, FLAG_OP2, FLAG_OP3, TYPE_GRAPHIC, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("../widgetGroup");

const GROUP_ID = 30007;
const MAIN_MODAL_UID = (161 << 16) | 16;
const COMPONENT = {
  ROOT: 0, FRAME: 1, SEARCH_BOX: 2, SEARCH_INPUT: 3, STATUS: 4, DATA: 5, LIST_VIEW: 6, LIST_SCROLLBAR: 7,
  PANEL: 8, PANEL_ICON: 9, PANEL_TITLE: 10, PANEL_SUBTITLE: 11, PANEL_WILDERNESS: 12, PANEL_KILLS: 13,
  PANEL_DESCRIPTION: 14, TELEPORT_BUTTON: 15, TELEPORT_LABEL: 16, FAVOURITE_BUTTON: 17, FAVOURITE_LABEL: 18, LAYOUT: 19,
  TAB_START: 20, TAB_LABEL_START: 30, ROW_BACKGROUND_START: 40, ROW_ICON_START: 60, ROW_LABEL_START: 80,
  DATA_PART_START: 100,
};
// The catalog goes out in parts, one per hidden text component (a text packet holds 64 KB).
const DATA_PARTS = 3;
const DATA_PART_COMPONENTS = [COMPONENT.DATA, ...Array.from({ length: DATA_PARTS - 1 }, (_, index) => COMPONENT.DATA_PART_START + index)];
const TAB_COUNT = 7;
const TAB_WIDTH = 60;
const TAB_STEP = 64;
const ROW_SLOTS = 10;
const ROW_HEIGHT = 26;
const LIST = { x: 18, y: 96, width: 258, height: 204 };
const PANEL = { x: 298, y: 56, width: 178, height: 244 };
const ROW_ACTIONS = ["Select", "Teleport", "Favourite"];
const uid = (component) => (GROUP_ID << 16) | component;

const text = (x, y, width, height, overrides = {}) => ({
  type: TYPE_TEXT, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
  text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true, ...overrides,
});
const box = (x, y, width, height, overrides = {}) => ({
  type: TYPE_RECTANGLE, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
  filled: true, color: 0x211b16, opacity: 32, ...overrides,
});

function addTabs(add, root) {
  for (let index = 0; index < TAB_COUNT; index++) {
    const x = 18 + index * TAB_STEP;
    add(COMPONENT.TAB_START + index, root, box(x, 32, TAB_WIDTH, 20, {
      color: 0x2b241b, mouseOverColor: 0x3a3125, actions: ["Open"], flags: FLAG_OP1,
    }));
    add(COMPONENT.TAB_LABEL_START + index, root, text(x, 32, TAB_WIDTH, 20, { textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1 }));
  }
}

function addList(add, root) {
  add(COMPONENT.SEARCH_BOX, root, box(18, 56, 274, 20, { color: 0x2b241b, mouseOverColor: 0x3a3125, actions: ["Search"], flags: FLAG_OP1 }));
  add(COMPONENT.SEARCH_INPUT, root, text(24, 56, 262, 20, { yTextAlignment: 1, actions: ["Search"], flags: FLAG_OP1 }));
  add(COMPONENT.STATUS, root, text(18, 78, 274, 16, { textColor: 0xffd27f, yTextAlignment: 1 }));
  for (const component of DATA_PART_COMPONENTS) add(component, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
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
      yTextAlignment: 1, actions: ROW_ACTIONS, flags: FLAG_OP1 | FLAG_OP2 | FLAG_OP3,
    }));
  }
}

function addPanel(add, root) {
  const { x, y, width, height } = PANEL;
  add(COMPONENT.PANEL, root, box(x, y, width, height));
  add(COMPONENT.PANEL_ICON, root, { type: TYPE_GRAPHIC, rawX: x + 6, rawY: y + 6, rawWidth: 36, rawHeight: 32, width: 36, height: 32, itemQuantityMode: 0 });
  add(COMPONENT.PANEL_TITLE, root, text(x + 46, y + 4, width - 52, 20, { fontId: 496, textColor: 0xff981f, yTextAlignment: 1 }));
  add(COMPONENT.PANEL_SUBTITLE, root, text(x + 46, y + 22, width - 52, 16, { textColor: 0xb8ab94, yTextAlignment: 1 }));
  add(COMPONENT.PANEL_WILDERNESS, root, text(x + 6, y + 44, width - 12, 16));
  add(COMPONENT.PANEL_KILLS, root, text(x + 6, y + 60, width - 12, 16));
  add(COMPONENT.PANEL_DESCRIPTION, root, text(x + 6, y + 80, width - 12, height - 120));
  const buttonWidth = (width - 18) / 2;
  const buttonY = y + height - 30;
  add(COMPONENT.TELEPORT_BUTTON, root, box(x + 6, buttonY, buttonWidth, 24, {
    color: 0x3b2f20, mouseOverColor: 0x54432c, actions: ["Teleport"], flags: FLAG_OP1,
  }));
  add(COMPONENT.TELEPORT_LABEL, root, text(x + 6, buttonY, buttonWidth, 24, { text: "Teleport", textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1 }));
  add(COMPONENT.FAVOURITE_BUTTON, root, box(x + 12 + buttonWidth, buttonY, buttonWidth, 24, {
    color: 0x3b2f20, mouseOverColor: 0x54432c, actions: ["Favourite"], flags: FLAG_OP1,
  }));
  add(COMPONENT.FAVOURITE_LABEL, root, text(x + 12 + buttonWidth, buttonY, buttonWidth, 24, { text: "Favourite", textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1 }));
}

/** `tabLabels` in tab order; the client draws them and switches between the tabs itself. */
function buildInterface(tabLabels) {
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
      dataComponent: COMPONENT.DATA, extraDataComponents: DATA_PART_COMPONENTS.slice(1), maxLength: 40, placeholder: "<col=8f7f66>Search destinations...</col>",
      caret: "|", textTemplate: "%s", focusColor: 0x3a3125, blurColor: 0x2b241b,
    },
    list: {
      viewComponent: COMPONENT.LIST_VIEW, scrollbarComponent: COMPONENT.LIST_SCROLLBAR,
      slotCount: ROW_SLOTS, columns: 1, rowHeight: ROW_HEIGHT,
      backgroundStart: COMPONENT.ROW_BACKGROUND_START, iconStart: COMPONENT.ROW_ICON_START, iconBaseY: 1,
      labelStart: COMPONENT.ROW_LABEL_START, itemLabel: "%name<col=ff5f5f>%detail</col>",
      headerLabel: "<col=ff981f>%name</col>", clickable: true,
      // The details panel is filled client-side from each row's `panel` text.
      select: {
        op: 1,
        texts: {
          title: COMPONENT.PANEL_TITLE, subtitle: COMPONENT.PANEL_SUBTITLE, info: COMPONENT.PANEL_WILDERNESS,
          info2: COMPONENT.PANEL_KILLS, description: COMPONENT.PANEL_DESCRIPTION, favourite: COMPONENT.FAVOURITE_LABEL,
        },
        iconComponent: COMPONENT.PANEL_ICON,
        showComponents: [COMPONENT.TELEPORT_BUTTON, COMPONENT.TELEPORT_LABEL, COMPONENT.FAVOURITE_BUTTON, COMPONENT.FAVOURITE_LABEL],
      },
    },
    status: { component: COMPONENT.STATUS, matches: "Destinations: %total", empty: "No destinations." },
    tabs: {
      components: tabLabels.map((_, index) => COMPONENT.TAB_START + index),
      labelComponents: tabLabels.map((_, index) => COMPONENT.TAB_LABEL_START + index),
      labels: tabLabels,
      activeTemplate: "<col=ffffff>%s</col>", inactiveTemplate: "<col=ffd27f>%s</col>",
      layoutComponent: COMPONENT.LAYOUT, clearQuery: true,
    },
  };
}

module.exports = { GROUP_ID, MAIN_MODAL_UID, COMPONENT, DATA_PART_COMPONENTS, TAB_COUNT, ROW_SLOTS, uid, buildInterface };
