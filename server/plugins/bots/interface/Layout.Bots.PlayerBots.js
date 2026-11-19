"use strict";

const { FLAG_OP1, TYPE_GRAPHIC, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("../../interface/widgetGroup");

const { MAX_PLAN_ROWS } = require("../runtime/DeploymentPlans.PlayerBots");

// Clients cache layout definitions by group ID. Use fresh IDs for changed layouts.
const GROUP_ID = 30107;
const SETUP_GROUP_ID = 30110;
const PLAN_GROUP_ID = 30111;
const MAIN_MODAL_UID = (161 << 16) | 16;
const BROWSER_COMPONENT = {
  ROOT: 0, FRAME: 1, SEARCH_BOX: 3, SEARCH_INPUT: 4, STATUS: 5, DATA: 6,
  LIST_VIEW: 7, LIST_SCROLLBAR: 8, PANEL: 9, PANEL_TITLE: 10, PANEL_SUBTITLE: 11,
  PANEL_DESCRIPTION: 12, CONFIGURE_BUTTON: 13, CONFIGURE_LABEL: 14, LAYOUT: 17, DEPLOY_BUTTON: 18, DEPLOY_LABEL: 19, TAB_START: 20, TAB_LABEL_START: 30,
  ROW_BACKGROUND_START: 40, ROW_ICON_START: 60, ROW_LABEL_START: 80,
};
const SETUP_COMPONENT = {
  ROOT: 0, FRAME: 1, PANEL: 2, TITLE: 3, SUBTITLE: 4, DESCRIPTION: 5, COUNT_LABEL: 6,
  COUNT_MINUS: 7, COUNT_MINUS_LABEL: 8, COUNT_VALUE: 9, COUNT_PLUS: 10, COUNT_PLUS_LABEL: 11,
  OVERRIDES_LABEL: 12, SETUP_NOTE: 17, OPTION_1_BUTTON: 20, OPTION_1_LABEL: 21,
  OPTION_2_BUTTON: 22, OPTION_2_LABEL: 23, OPTION_3_BUTTON: 24, OPTION_3_LABEL: 25,
  FEEDBACK: 26, SPAWN_BUTTON: 27, SPAWN_LABEL: 28, BACK_BUTTON: 29, BACK_LABEL: 30,
  SAVE_BUTTON: 31, SAVE_LABEL: 32, OPTION_4_BUTTON: 33, OPTION_4_LABEL: 34,
  OPTION_5_BUTTON: 35, OPTION_5_LABEL: 36,
};
const PLAN_COMPONENT = {
  ROOT: 0, FRAME: 1, PANEL: 2, TITLE: 3, SUMMARY: 4, VIEW: 5, SCROLLBAR: 6, CONTENT_HEIGHT: 7,
  FEEDBACK: 8, DEPLOY_BUTTON: 9, DEPLOY_LABEL: 10, BACK_BUTTON: 11, BACK_LABEL: 12, SAVE_BUTTON: 13, SAVE_LABEL: 14,
};
const PLAN_ROW_HEIGHT = 28;
const planRows = Array.from({ length: MAX_PLAN_ROWS }, (_, index) => {
  const start = 20 + index * 9;
  return { root: start, name: start + 1, routine: [start + 2, start + 3], count: start + 4, minus: [start + 5, start + 6], plus: [start + 7, start + 8] };
});
const PLAN_BUTTONS = {
  deploy: [PLAN_COMPONENT.DEPLOY_BUTTON, PLAN_COMPONENT.DEPLOY_LABEL],
  save: [PLAN_COMPONENT.SAVE_BUTTON, PLAN_COMPONENT.SAVE_LABEL],
  back: [PLAN_COMPONENT.BACK_BUTTON, PLAN_COMPONENT.BACK_LABEL],
};
const TAB_LABELS = ["Saved", "Routines", "Deployment plans"];
const ROUTINES_TAB = TAB_LABELS.indexOf("Routines");
const TAB_WIDTH = 132;
const TAB_STEP = 142;
const ROW_SLOTS = 10;
const ROW_HEIGHT = 26;
const ROW_ACTIONS = ["Select"];
const BROWSER_BUTTONS = {
  configure: [BROWSER_COMPONENT.CONFIGURE_BUTTON, BROWSER_COMPONENT.CONFIGURE_LABEL],
  deploy: [BROWSER_COMPONENT.DEPLOY_BUTTON, BROWSER_COMPONENT.DEPLOY_LABEL],
};
const SETUP_BUTTONS = {
  save: [SETUP_COMPONENT.SAVE_BUTTON, SETUP_COMPONENT.SAVE_LABEL],
  setCount: [SETUP_COMPONENT.COUNT_VALUE],
  countMinus: [SETUP_COMPONENT.COUNT_MINUS, SETUP_COMPONENT.COUNT_MINUS_LABEL],
  countPlus: [SETUP_COMPONENT.COUNT_PLUS, SETUP_COMPONENT.COUNT_PLUS_LABEL],
  setupOptions: [
    [SETUP_COMPONENT.OPTION_1_BUTTON, SETUP_COMPONENT.OPTION_1_LABEL],
    [SETUP_COMPONENT.OPTION_2_BUTTON, SETUP_COMPONENT.OPTION_2_LABEL],
    [SETUP_COMPONENT.OPTION_3_BUTTON, SETUP_COMPONENT.OPTION_3_LABEL],
    [SETUP_COMPONENT.OPTION_4_BUTTON, SETUP_COMPONENT.OPTION_4_LABEL],
    [SETUP_COMPONENT.OPTION_5_BUTTON, SETUP_COMPONENT.OPTION_5_LABEL],
  ],
  spawn: [SETUP_COMPONENT.SPAWN_BUTTON, SETUP_COMPONENT.SPAWN_LABEL],
  back: [SETUP_COMPONENT.BACK_BUTTON, SETUP_COMPONENT.BACK_LABEL],
};
const uid = component => (GROUP_ID << 16) | component;
const setupUid = component => (SETUP_GROUP_ID << 16) | component;
const planUid = component => (PLAN_GROUP_ID << 16) | component;
const TAB_UIDS = TAB_LABELS.map((_, index) => uid(BROWSER_COMPONENT.TAB_START + index));
// The client maps the label, background and icon to the same concrete row ID.
const rowUids = [BROWSER_COMPONENT.ROW_LABEL_START, BROWSER_COMPONENT.ROW_BACKGROUND_START, BROWSER_COMPONENT.ROW_ICON_START]
  .flatMap(start => Array.from({ length: ROW_SLOTS }, (_, slot) => uid(start + slot)));

function text(x, y, width, height, overrides = {}) {
  return { type: TYPE_TEXT, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
    text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true, ...overrides };
}
function box(x, y, width, height, overrides = {}) {
  return { type: TYPE_RECTANGLE, rawX: x, rawY: y, rawWidth: width, rawHeight: height, width, height,
    filled: true, color: 0x211b16, opacity: 32, mouseOverColor: 0x3a3125, ...overrides };
}
function button(add, root, component, labelComponent, x, y, width, height, label, overrides = {}) {
  add(component, root, box(x, y, width, height, { color: 0x3b2f20, mouseOverColor: 0x54432c, actions: [label], flags: FLAG_OP1, ...overrides }));
  add(labelComponent, root, text(x, y, width, height, { text: label, textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1, actions: [label], flags: FLAG_OP1, hidden: overrides.hidden, isHidden: overrides.isHidden }));
}

function buildBrowserInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(BROWSER_COMPONENT.ROOT, -1, {
    rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: 494, height: 316, xPositionMode: 1, yPositionMode: 1,
  });
  add(BROWSER_COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 494, height: 316 });
  for (let index = 0; index < TAB_LABELS.length; index++) {
    const x = 18 + index * TAB_STEP;
    add(BROWSER_COMPONENT.TAB_START + index, root, box(x, 32, TAB_WIDTH, 20, {
      color: 0x2b241b, mouseOverColor: 0x3a3125, actions: ["Open"], flags: FLAG_OP1,
    }));
    add(BROWSER_COMPONENT.TAB_LABEL_START + index, root, text(x, 32, TAB_WIDTH, 20, {
      textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1,
    }));
  }
  add(BROWSER_COMPONENT.SEARCH_BOX, root, box(18, 56, 274, 20, { color: 0x2b241b, actions: ["Search"], flags: FLAG_OP1 }));
  add(BROWSER_COMPONENT.SEARCH_INPUT, root, text(24, 56, 262, 20, { yTextAlignment: 1, actions: ["Search"], flags: FLAG_OP1 }));
  add(BROWSER_COMPONENT.STATUS, root, text(18, 78, 274, 16, { textColor: 0xffd27f, yTextAlignment: 1 }));
  add(BROWSER_COMPONENT.DATA, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
  add(BROWSER_COMPONENT.LAYOUT, root, { type: TYPE_TEXT, hidden: true, isHidden: true });

  const list = add(BROWSER_COMPONENT.LIST_VIEW, root, {
    rawX: 18, rawY: 96, rawWidth: 258, rawHeight: 204,
    width: 258, height: 204, scrollWidth: 258, scrollHeight: ROW_SLOTS * ROW_HEIGHT,
  });
  add(BROWSER_COMPONENT.LIST_SCROLLBAR, root, {
    rawX: 276, rawY: 96, rawWidth: 16, rawHeight: 204, width: 16, height: 204, noClickThrough: true,
  });
  for (let slot = 0; slot < ROW_SLOTS; slot++) {
    const y = slot * ROW_HEIGHT;
    add(BROWSER_COMPONENT.ROW_BACKGROUND_START + slot, list, box(0, y, 256, ROW_HEIGHT - 1, { mouseOverColor: 0x3a3125, actions: ROW_ACTIONS, flags: FLAG_OP1 }));
    add(BROWSER_COMPONENT.ROW_ICON_START + slot, list, {
      type: TYPE_GRAPHIC, rawX: 3, rawY: y + 1, rawWidth: 24, rawHeight: 22,
      width: 24, height: 22, itemQuantityMode: 0,
    });
    add(BROWSER_COMPONENT.ROW_LABEL_START + slot, list, text(32, y, 222, ROW_HEIGHT - 1, {
      yTextAlignment: 1, actions: ROW_ACTIONS, flags: FLAG_OP1,
    }));
  }

  add(BROWSER_COMPONENT.PANEL, root, box(298, 56, 178, 244));
  add(BROWSER_COMPONENT.PANEL_TITLE, root, text(304, 62, 166, 20, { fontId: 496, textColor: 0xff981f }));
  add(BROWSER_COMPONENT.PANEL_SUBTITLE, root, text(304, 84, 166, 16, { textColor: 0xb8ab94 }));
  add(BROWSER_COMPONENT.PANEL_DESCRIPTION, root, text(304, 104, 166, 132, { textColor: 0xd0c6b4 }));
  const buttonWidth = 80;
  button(add, root, BROWSER_COMPONENT.CONFIGURE_BUTTON, BROWSER_COMPONENT.CONFIGURE_LABEL, 304, 270, buttonWidth, 24, "Configure");
  button(add, root, BROWSER_COMPONENT.DEPLOY_BUTTON, BROWSER_COMPONENT.DEPLOY_LABEL, 390, 270, buttonWidth, 24, "Deploy");

  return {
    groupId: GROUP_ID,
    widgets,
    search: {
      inputComponent: BROWSER_COMPONENT.SEARCH_INPUT, backgroundComponent: BROWSER_COMPONENT.SEARCH_BOX,
      dataComponent: BROWSER_COMPONENT.DATA, maxLength: 60, placeholder: "<col=8f7f66>Search routines and plans...</col>",
      caret: "|", textTemplate: "%s", focusColor: 0x3a3125, blurColor: 0x2b241b,
    },
    list: {
      viewComponent: BROWSER_COMPONENT.LIST_VIEW, scrollbarComponent: BROWSER_COMPONENT.LIST_SCROLLBAR,
      slotCount: ROW_SLOTS, columns: 1, rowHeight: ROW_HEIGHT,
      backgroundStart: BROWSER_COMPONENT.ROW_BACKGROUND_START, iconStart: BROWSER_COMPONENT.ROW_ICON_START,
      labelStart: BROWSER_COMPONENT.ROW_LABEL_START, itemLabel: "%name<col=9b9384>  %detail</col>",
      // Only the server reveals the launch buttons after accepting a selection.
      headerLabel: "<col=ff981f>%name</col>", textOnly: true, clickable: true,
    },
    status: { component: BROWSER_COMPONENT.STATUS, matches: "Results: %total", empty: "No routines or plans match." },
    tabs: {
      components: TAB_UIDS.map(id => id & 0xffff),
      labelComponents: TAB_LABELS.map((_, index) => BROWSER_COMPONENT.TAB_LABEL_START + index),
      labels: TAB_LABELS, activeTemplate: "<col=ffffff>%s</col>", inactiveTemplate: "<col=ffd27f>%s</col>",
      layoutComponent: BROWSER_COMPONENT.LAYOUT, clearQuery: true,
    },
  };
}

function buildSetupInterface() {
  const { widgets, add } = createWidgetGroup(SETUP_GROUP_ID);
  const root = add(SETUP_COMPONENT.ROOT, -1, {
    rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: 494, height: 316, xPositionMode: 1, yPositionMode: 1,
  });
  add(SETUP_COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 494, height: 316 });
  add(SETUP_COMPONENT.PANEL, root, box(18, 22, 458, 284));
  add(SETUP_COMPONENT.TITLE, root, text(30, 28, 434, 20, { fontId: 496, textColor: 0xff981f }));
  add(SETUP_COMPONENT.SUBTITLE, root, text(30, 49, 434, 16, { textColor: 0xb8ab94 }));
  add(SETUP_COMPONENT.DESCRIPTION, root, text(30, 67, 434, 29, { textColor: 0xd0c6b4 }));
  add(SETUP_COMPONENT.COUNT_LABEL, root, text(30, 100, 200, 22, { text: "Bots to spawn:", yTextAlignment: 1 }));
  button(add, root, SETUP_COMPONENT.COUNT_MINUS, SETUP_COMPONENT.COUNT_MINUS_LABEL, 238, 99, 28, 22, "-");
  add(SETUP_COMPONENT.COUNT_VALUE, root, text(270, 100, 42, 22, { textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1, flags: FLAG_OP1, actions: ["Enter count"] }));
  button(add, root, SETUP_COMPONENT.COUNT_PLUS, SETUP_COMPONENT.COUNT_PLUS_LABEL, 316, 99, 28, 22, "+");
  add(SETUP_COMPONENT.OVERRIDES_LABEL, root, text(30, 122, 205, 17, { textColor: 0xffd27f, yTextAlignment: 1 }));
  add(SETUP_COMPONENT.SETUP_NOTE, root, text(250, 122, 214, 17, { textColor: 0xb8ab94, xTextAlignment: 2, yTextAlignment: 1 }));
  for (const [index, [buttonComponent, labelComponent]] of SETUP_BUTTONS.setupOptions.entries()) {
    button(add, root, buttonComponent, labelComponent, 30, 142 + index * 22, 434, 20, "Change override", { hidden: true, isHidden: true });
  }
  add(SETUP_COMPONENT.FEEDBACK, root, text(30, 260, 434, 13, { textColor: 0xffd27f, yTextAlignment: 1 }));
  button(add, root, ...SETUP_BUTTONS.save, 126, 278, 106, 24, "Save as...");
  button(add, root, SETUP_COMPONENT.SPAWN_BUTTON, SETUP_COMPONENT.SPAWN_LABEL, 238, 278, 110, 24, "Spawn bots");
  button(add, root, SETUP_COMPONENT.BACK_BUTTON, SETUP_COMPONENT.BACK_LABEL, 354, 278, 60, 24, "Back");
  return { groupId: SETUP_GROUP_ID, widgets };
}

function buildPlanInterface() {
  const { widgets, add } = createWidgetGroup(PLAN_GROUP_ID);
  const c = PLAN_COMPONENT;
  const root = add(c.ROOT, -1, {
    rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: 494, height: 316, xPositionMode: 1, yPositionMode: 1,
  });
  add(c.FRAME, root, { widthMode: 1, heightMode: 1, width: 494, height: 316 });
  add(c.PANEL, root, box(18, 22, 458, 284));
  add(c.TITLE, root, text(30, 28, 434, 20, { fontId: 496, textColor: 0xff981f }));
  add(c.SUMMARY, root, text(30, 51, 434, 20));
  const view = add(c.VIEW, root, { rawX: 30, rawY: 76, rawWidth: 414, rawHeight: 176, width: 414, height: 176, scrollWidth: 414, scrollHeight: 176 });
  add(c.SCROLLBAR, root, { rawX: 448, rawY: 76, rawWidth: 16, rawHeight: 176, width: 16, height: 176, noClickThrough: true });
  add(c.CONTENT_HEIGHT, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
  planRows.forEach((row, index) => {
    const parent = add(row.root, view, { rawY: index * PLAN_ROW_HEIGHT, rawWidth: 414, rawHeight: PLAN_ROW_HEIGHT, width: 414, height: PLAN_ROW_HEIGHT, hidden: true, isHidden: true });
    add(row.name, parent, text(5, 2, 304, 24, { yTextAlignment: 1 }));
    button(add, parent, ...row.routine, 0, 2, 307, 24, "Change routine");
    button(add, parent, ...row.minus, 312, 2, 26, 24, "-");
    add(row.count, parent, text(339, 2, 42, 24, { xTextAlignment: 1, yTextAlignment: 1, textColor: 0xffd27f, flags: FLAG_OP1, actions: ["Enter count"] }));
    button(add, parent, ...row.plus, 382, 2, 26, 24, "+");
  });
  add(c.FEEDBACK, root, text(30, 260, 434, 13, { textColor: 0xffd27f }));
  button(add, root, ...PLAN_BUTTONS.save, 126, 278, 106, 24, "Save as...");
  button(add, root, ...PLAN_BUTTONS.deploy, 238, 278, 110, 24, "Deploy plan");
  button(add, root, ...PLAN_BUTTONS.back, 354, 278, 60, 24, "Back");
  return {
    groupId: PLAN_GROUP_ID,
    widgets,
    scroll: [{ viewComponent: c.VIEW, scrollbarComponent: c.SCROLLBAR, contentHeightComponent: c.CONTENT_HEIGHT }],
  };
}

module.exports = {
  GROUP_ID, SETUP_GROUP_ID, PLAN_GROUP_ID, MAIN_MODAL_UID, BROWSER_COMPONENT, SETUP_COMPONENT, PLAN_COMPONENT,
  BROWSER_BUTTONS, SETUP_BUTTONS, PLAN_BUTTONS, PLAN_ROW_HEIGHT, planRows, TAB_LABELS, TAB_UIDS, ROUTINES_TAB, ROW_SLOTS, ROW_HEIGHT, ROW_ACTIONS, rowUids, uid, setupUid, planUid,
  buildBrowserInterface, buildSetupInterface, buildPlanInterface,
};
