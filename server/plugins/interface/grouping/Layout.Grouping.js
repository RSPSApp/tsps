"use strict";

/**
 * The ::group widget group: Group, Invites and Find tabs over a searchable list on the left, and
 * the selected row's details with up to two actions on the right. The list is the shared
 * custom-interface runtime's (widgets/custom/CustomInterfaceRuntime.ts): it filters, switches tabs
 * and fills the details panel client-side, and sends each row's id back with the click.
 */

const { FLAG_OP1, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("../widgetGroup");

const GROUP_ID = 30020;
const MAIN_MODAL_UID = (161 << 16) | 16;
const COMPONENT = {
  ROOT: 0, FRAME: 1, SEARCH_BOX: 2, SEARCH_INPUT: 3, STATUS: 4, DATA: 5, LIST_VIEW: 6, LIST_SCROLLBAR: 7,
  PANEL: 8, PANEL_TITLE: 9, PANEL_SUBTITLE: 10, PANEL_INFO: 11, PANEL_INFO2: 12, PANEL_DESCRIPTION: 13,
  PRIMARY_BUTTON: 14, PRIMARY_LABEL: 15, SECONDARY_BUTTON: 16, SECONDARY_LABEL: 17, LAYOUT: 18,
  TAB_START: 20, TAB_LABEL_START: 30, ROW_BACKGROUND_START: 40, ROW_LABEL_START: 60,
};
const TAB_LABELS = ["Group", "Invites", "Find"];
const TAB_WIDTH = 84;
const TAB_STEP = 88;
const ROW_SLOTS = 10;
const ROW_HEIGHT = 20;
const LIST = { x: 18, y: 96, width: 258, height: 204 };
const PANEL = { x: 298, y: 32, width: 178, height: 268 };
const BUTTONS = [
  { button: COMPONENT.PRIMARY_BUTTON, label: COMPONENT.PRIMARY_LABEL },
  { button: COMPONENT.SECONDARY_BUTTON, label: COMPONENT.SECONDARY_LABEL },
];
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
  TAB_LABELS.forEach((_, index) => {
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
    add(COMPONENT.ROW_LABEL_START + slot, list, text(6, 0, LIST.width - 12, ROW_HEIGHT - 2, {
      yTextAlignment: 1, actions: ["Select"], flags: FLAG_OP1,
    }));
  }
}

function addPanel(add, root) {
  const { x, y, width, height } = PANEL;
  add(COMPONENT.PANEL, root, box(x, y, width, height));
  add(COMPONENT.PANEL_TITLE, root, text(x + 6, y + 4, width - 12, 20, { fontId: 496, textColor: 0xff981f, yTextAlignment: 1 }));
  add(COMPONENT.PANEL_SUBTITLE, root, text(x + 6, y + 24, width - 12, 16, { textColor: 0xb8ab94, yTextAlignment: 1 }));
  add(COMPONENT.PANEL_INFO, root, text(x + 6, y + 44, width - 12, 16));
  add(COMPONENT.PANEL_INFO2, root, text(x + 6, y + 60, width - 12, 16));
  add(COMPONENT.PANEL_DESCRIPTION, root, text(x + 6, y + 82, width - 12, height - 122));
  const buttonWidth = (width - 18) / 2;
  const buttonY = y + height - 30;
  BUTTONS.forEach(({ button, label }, index) => {
    const buttonX = x + 6 + index * (buttonWidth + 6);
    add(button, root, box(buttonX, buttonY, buttonWidth, 24, {
      color: 0x3b2f20, mouseOverColor: 0x54432c, actions: ["Select"], flags: FLAG_OP1, hidden: true, isHidden: true,
    }));
    add(label, root, text(buttonX, buttonY, buttonWidth, 24, {
      textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1, actions: ["Select"], flags: FLAG_OP1, hidden: true, isHidden: true,
    }));
  });
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
      dataComponent: COMPONENT.DATA, maxLength: 12, placeholder: "<col=8f7f66>Search names...</col>",
      caret: "|", textTemplate: "%s", focusColor: 0x3a3125, blurColor: 0x2b241b,
    },
    list: {
      viewComponent: COMPONENT.LIST_VIEW, scrollbarComponent: COMPONENT.LIST_SCROLLBAR,
      slotCount: ROW_SLOTS, columns: 1, rowHeight: ROW_HEIGHT, textOnly: true,
      backgroundStart: COMPONENT.ROW_BACKGROUND_START, iconStart: COMPONENT.ROW_LABEL_START,
      itemLabel: "%name<col=9f9f9f>%detail</col>", headerLabel: "<col=ff981f>%name</col>", clickable: true,
      select: {
        op: 1,
        texts: {
          title: COMPONENT.PANEL_TITLE, subtitle: COMPONENT.PANEL_SUBTITLE, info: COMPONENT.PANEL_INFO,
          info2: COMPONENT.PANEL_INFO2, description: COMPONENT.PANEL_DESCRIPTION,
          primary: COMPONENT.PRIMARY_LABEL, secondary: COMPONENT.SECONDARY_LABEL,
        },
        // Shown at once; the server hides a button the selected row has no action for.
        showComponents: BUTTONS.flatMap(({ button, label }) => [button, label]),
      },
    },
    status: { component: COMPONENT.STATUS, matches: "%total listed", empty: "Nothing to show here." },
    tabs: {
      components: TAB_LABELS.map((_, index) => COMPONENT.TAB_START + index),
      labelComponents: TAB_LABELS.map((_, index) => COMPONENT.TAB_LABEL_START + index),
      labels: TAB_LABELS,
      activeTemplate: "<col=ffffff>%s</col>", inactiveTemplate: "<col=ffd27f>%s</col>",
      layoutComponent: COMPONENT.LAYOUT, clearQuery: true,
    },
  };
}

module.exports = { GROUP_ID, MAIN_MODAL_UID, COMPONENT, TAB_LABELS, ROW_SLOTS, BUTTONS, uid, buildInterface };
