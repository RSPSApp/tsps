"use strict";

const { FLAG_OP1, TYPE_GRAPHIC, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("../../interface/widgetGroup");

const GROUP_ID = 30016;
const MAIN_MODAL_UID = (161 << 16) | 16;
const COMPONENT = {
  ROOT: 0, FRAME: 1, SEARCH_BOX: 2, SEARCH_INPUT: 3, STATUS: 4, DATA: 5,
  LIST_VIEW: 6, LIST_SCROLLBAR: 7, PANEL: 8, PANEL_TITLE: 9, PANEL_SUBTITLE: 10,
  PANEL_DESCRIPTION: 11, COUNT_LABEL: 12, COUNT_MINUS: 13, COUNT_MINUS_LABEL: 14,
  COUNT_VALUE: 15, COUNT_PLUS: 16, COUNT_PLUS_LABEL: 17, LOCATION_BUTTON: 18,
  LOCATION_LABEL: 19, SETUP_NOTE: 20, SPAWN_BUTTON: 21, SPAWN_LABEL: 22,
  CLOSE_BUTTON: 23, CLOSE_LABEL: 24, LOCATION_INFO: 25, FEEDBACK: 26,
  COPY_LEVELS_BUTTON: 27, COPY_LEVELS_LABEL: 28, ROW_BACKGROUND_START: 30, ROW_ICON_START: 50, ROW_LABEL_START: 70,
  SETUP_OPTION_1: 80, SETUP_OPTION_1_LABEL: 81, SETUP_OPTION_2: 82, SETUP_OPTION_2_LABEL: 83,
  SETUP_OPTION_3: 84, SETUP_OPTION_3_LABEL: 85,
};
const ROW_COUNT = 10;
const ROW_HEIGHT = 24;
const ROW_ACTIONS = ["Select"];
const BUTTON_COMPONENTS = {
  countMinus: [COMPONENT.COUNT_MINUS, COMPONENT.COUNT_MINUS_LABEL],
  countPlus: [COMPONENT.COUNT_PLUS, COMPONENT.COUNT_PLUS_LABEL],
  location: [COMPONENT.LOCATION_BUTTON, COMPONENT.LOCATION_LABEL],
  copyLevels: [COMPONENT.COPY_LEVELS_BUTTON, COMPONENT.COPY_LEVELS_LABEL],
  spawn: [COMPONENT.SPAWN_BUTTON, COMPONENT.SPAWN_LABEL],
  close: [COMPONENT.CLOSE_BUTTON, COMPONENT.CLOSE_LABEL],
  setupOptions: [
    [COMPONENT.SETUP_OPTION_1, COMPONENT.SETUP_OPTION_1_LABEL],
    [COMPONENT.SETUP_OPTION_2, COMPONENT.SETUP_OPTION_2_LABEL],
    [COMPONENT.SETUP_OPTION_3, COMPONENT.SETUP_OPTION_3_LABEL],
  ],
};
const uid = (component) => (GROUP_ID << 16) | component;
const rowUids = Array.from({ length: ROW_COUNT }, (_, slot) => uid(COMPONENT.ROW_LABEL_START + slot));

function text(x, y, width, height, overrides = {}) {
  return { type: TYPE_TEXT, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
    text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true, ...overrides };
}
function box(x, y, width, height, overrides = {}) {
  return { type: TYPE_RECTANGLE, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
    filled: true, color: 0x2b241b, mouseOverColor: 0x3a3125, ...overrides };
}
function button(add, root, component, labelComponent, x, y, width, label) {
  add(component, root, box(x, y, width, 27, { actions: [label], flags: FLAG_OP1 }));
  add(labelComponent, root, text(x, y, width, 27, { text: label, textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1, actions: [label], flags: FLAG_OP1 }));
}

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(COMPONENT.ROOT, -1, { rawWidth: 680, rawHeight: 456, width: 680, height: 456,
    xPositionMode: 1, yPositionMode: 1, fitToViewport: true });
  add(COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 680, height: 456 });
  add(COMPONENT.SEARCH_BOX, root, box(18, 32, 264, 22));
  add(COMPONENT.SEARCH_INPUT, root, text(24, 32, 252, 22, { actions: ["Search"], flags: FLAG_OP1, yTextAlignment: 1 }));
  add(COMPONENT.STATUS, root, text(18, 57, 644, 18, { textColor: 0xffd27f }));
  add(COMPONENT.DATA, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
  const list = add(COMPONENT.LIST_VIEW, root, { rawX: 18, rawY: 80, rawWidth: 264, rawHeight: 254,
    width: 264, height: 254, scrollWidth: 264, scrollHeight: ROW_COUNT * ROW_HEIGHT });
  add(COMPONENT.LIST_SCROLLBAR, root, { rawX: 266, rawY: 80, rawWidth: 16, rawHeight: 254, width: 16, height: 254, noClickThrough: true });
  for (let slot = 0; slot < ROW_COUNT; slot++) {
    const y = slot * ROW_HEIGHT;
    add(COMPONENT.ROW_BACKGROUND_START + slot, list, box(0, y, 248, ROW_HEIGHT - 1, { mouseOverColor: 0x3a3125 }));
    add(COMPONENT.ROW_ICON_START + slot, list, { type: TYPE_GRAPHIC, rawX: 2, rawY: y + 1, rawWidth: 20, rawHeight: 20,
      width: 20, height: 20, itemQuantityMode: 0 });
    add(COMPONENT.ROW_LABEL_START + slot, list, text(6, y, 240, ROW_HEIGHT - 1, {
      actions: ROW_ACTIONS, flags: FLAG_OP1, yTextAlignment: 1,
    }));
  }

  add(COMPONENT.PANEL, root, box(298, 80, 364, 368, { color: 0x211b16, mouseOverColor: 0x211b16 }));
  add(COMPONENT.PANEL_TITLE, root, text(310, 90, 340, 22, { fontId: 496, textColor: 0xff981f }));
  add(COMPONENT.PANEL_SUBTITLE, root, text(310, 113, 340, 18, { textColor: 0xb8ab94 }));
  add(COMPONENT.PANEL_DESCRIPTION, root, text(310, 137, 340, 48, { textColor: 0xd0c6b4 }));
  add(COMPONENT.COUNT_LABEL, root, text(310, 192, 118, 26, { text: "Bots to spawn:", yTextAlignment: 1 }));
  button(add, root, COMPONENT.COUNT_MINUS, COMPONENT.COUNT_MINUS_LABEL, 432, 191, 34, "−");
  add(COMPONENT.COUNT_VALUE, root, text(470, 192, 40, 26, { text: "1", textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1 }));
  button(add, root, COMPONENT.COUNT_PLUS, COMPONENT.COUNT_PLUS_LABEL, 514, 191, 34, "+");
  button(add, root, COMPONENT.LOCATION_BUTTON, COMPONENT.LOCATION_LABEL, 310, 228, 338, "Spawn at saved location");
  add(COMPONENT.LOCATION_INFO, root, text(310, 258, 338, 16, { textColor: 0xb8ab94, yTextAlignment: 1 }));
  button(add, root, COMPONENT.COPY_LEVELS_BUTTON, COMPONENT.COPY_LEVELS_LABEL, 310, 277, 155, "Copy my levels: Off");
  add(COMPONENT.SETUP_NOTE, root, text(474, 277, 174, 27, { textColor: 0xb8ab94, yTextAlignment: 1 }));
  for (const [index, [buttonComponent, labelComponent]] of BUTTON_COMPONENTS.setupOptions.entries()) {
    button(add, root, buttonComponent, labelComponent, 310, 309 + index * 31, 338, "Activity setup");
  }
  add(COMPONENT.FEEDBACK, root, text(310, 403, 338, 13, { textColor: 0xffd27f, yTextAlignment: 1 }));
  button(add, root, COMPONENT.SPAWN_BUTTON, COMPONENT.SPAWN_LABEL, 402, 420, 156, "Spawn bots");
  button(add, root, COMPONENT.CLOSE_BUTTON, COMPONENT.CLOSE_LABEL, 566, 420, 82, "Close");

  return {
    groupId: GROUP_ID,
    widgets,
    search: { inputComponent: COMPONENT.SEARCH_INPUT, backgroundComponent: COMPONENT.SEARCH_BOX,
      dataComponent: COMPONENT.DATA, maxLength: 60, placeholder: "Search routines and activities...", caret: "|",
      textTemplate: "Search: %s", focusColor: 0x3a3125, blurColor: 0x2b241b },
    list: { viewComponent: COMPONENT.LIST_VIEW, scrollbarComponent: COMPONENT.LIST_SCROLLBAR,
      slotCount: ROW_COUNT, columns: 1, rowHeight: ROW_HEIGHT, iconStart: COMPONENT.ROW_ICON_START,
      backgroundStart: COMPONENT.ROW_BACKGROUND_START, labelStart: COMPONENT.ROW_LABEL_START,
      textOnly: true, clickable: true, itemLabel: "%name<col=9b9384>  %detail</col>",
      select: { op: 1, texts: { title: COMPONENT.PANEL_TITLE, subtitle: COMPONENT.PANEL_SUBTITLE, description: COMPONENT.PANEL_DESCRIPTION } } },
    status: { component: COMPONENT.STATUS, matches: "Bot launchers: %total", empty: "No saved routines or activity launchers." },
  };
}

module.exports = { GROUP_ID, MAIN_MODAL_UID, COMPONENT, ROW_COUNT, ROW_ACTIONS, BUTTON_COMPONENTS, rowUids, uid, buildInterface };
