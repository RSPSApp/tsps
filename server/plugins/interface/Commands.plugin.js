const { FLAG_OP1, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("./widgetGroup");

const GROUP_ID = 30004;
const MAIN_MODAL_UID = (161 << 16) | 16;
const COMPONENT = { ROOT: 0, FRAME: 1, LIST_VIEW: 2, LIST_SCROLLBAR: 3, SEARCH_BOX: 4, SEARCH_INPUT: 5,
  STATUS: 6, DATA: 7, ROW_START: 10, ROW_BACKGROUND_START: 30 };
// Rows are a recycled pool, so it has to cover the tallest list the modal can give (portrait
// mode stretches it well past the classic 316px): 96 rows is 1536px.
const ROW_COUNT = 96;
const ROW_HEIGHT = 16;
// The modal's design size, and how the list's parts follow it. A mode-1 width or height is the
// parent's minus the raw value, so the list grows and shrinks with the modal instead of keeping
// the classic size.
const MODAL_WIDTH = 494;
const MODAL_HEIGHT = 316;
const LIST_WIDTH = 442;
const LIST_HEIGHT = 222;
const WIDTH_TRIM = MODAL_WIDTH - LIST_WIDTH; // left margin, scrollbar, gaps
const HEIGHT_TRIM = MODAL_HEIGHT - LIST_HEIGHT; // above and below the list
const SCROLLBAR_WIDTH = 16;
const SCROLLBAR_RIGHT = 14;
// Mode 1 on an axis: the size is the parent's minus the raw value.
const FILL_WIDTH = { widthMode: 1, rawWidth: WIDTH_TRIM };
const FILL_HEIGHT = { heightMode: 1, rawHeight: HEIGHT_TRIM };
const uid = (component) => (GROUP_ID << 16) | component;
let pluginApi;

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: MODAL_WIDTH, height: MODAL_HEIGHT, xPositionMode: 1, yPositionMode: 1,
  });
  add(COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: MODAL_WIDTH, height: MODAL_HEIGHT });
  add(COMPONENT.SEARCH_BOX, root, {
    type: TYPE_RECTANGLE, rawX: 18, rawY: 32, ...FILL_WIDTH, rawHeight: 24,
    width: LIST_WIDTH, height: 24, filled: true, color: 0x2b241b, mouseOverColor: 0x3a3125,
    actions: ["Search"], flags: FLAG_OP1,
  });
  add(COMPONENT.SEARCH_INPUT, root, {
    type: TYPE_TEXT, rawX: 24, rawY: 32, widthMode: 1, rawWidth: WIDTH_TRIM + 12, rawHeight: 24,
    width: LIST_WIDTH - 12, height: 24, fontId: 494, textColor: 0xe8ded0, textShadowed: true, yTextAlignment: 1,
    actions: ["Search"], flags: FLAG_OP1,
  });
  add(COMPONENT.STATUS, root, {
    type: TYPE_TEXT, rawX: 18, rawY: 58, ...FILL_WIDTH, rawHeight: 16,
    width: LIST_WIDTH, height: 16, fontId: 494, textColor: 0xffd27f,
  });
  add(COMPONENT.DATA, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
  const list = add(COMPONENT.LIST_VIEW, root, {
    rawX: 18, rawY: 78, ...FILL_WIDTH, ...FILL_HEIGHT,
    width: LIST_WIDTH, height: LIST_HEIGHT, scrollWidth: LIST_WIDTH, scrollHeight: LIST_HEIGHT,
  });
  add(COMPONENT.LIST_SCROLLBAR, root, {
    rawX: SCROLLBAR_RIGHT, rawY: 78, xPositionMode: 2, rawWidth: SCROLLBAR_WIDTH, ...FILL_HEIGHT,
    width: SCROLLBAR_WIDTH, height: LIST_HEIGHT, noClickThrough: true,
  });
  for (let row = 0; row < ROW_COUNT; row++) {
    add(COMPONENT.ROW_BACKGROUND_START + row, list, {
      rawY: row * ROW_HEIGHT, rawWidth: LIST_WIDTH, rawHeight: ROW_HEIGHT, width: LIST_WIDTH, height: ROW_HEIGHT,
    });
    add(COMPONENT.ROW_START + row, list, {
      type: TYPE_TEXT, rawY: row * ROW_HEIGHT, rawWidth: LIST_WIDTH, rawHeight: ROW_HEIGHT,
      width: LIST_WIDTH, height: ROW_HEIGHT, text: "", fontId: 494, textColor: 0xe8ded0,
      textShadowed: true, yTextAlignment: 1,
    });
  }
  return {
    groupId: GROUP_ID, widgets,
    search: {
      inputComponent: COMPONENT.SEARCH_INPUT, backgroundComponent: COMPONENT.SEARCH_BOX,
      dataComponent: COMPONENT.DATA, maxLength: 60, placeholder: "Search commands...",
      caret: "|", textTemplate: "Search: %s", focusColor: 0x3a3125, blurColor: 0x2b241b,
    },
    list: {
      viewComponent: COMPONENT.LIST_VIEW, scrollbarComponent: COMPONENT.LIST_SCROLLBAR,
      slotCount: ROW_COUNT, columns: 1, rowHeight: ROW_HEIGHT, iconStart: COMPONENT.ROW_START,
      backgroundStart: COMPONENT.ROW_BACKGROUND_START, itemLabel: "%name", textOnly: true,
    },
    status: { component: COMPONENT.STATUS, matches: "Commands: %total", empty: "No matching commands." },
  };
}

function openCommands({ player, parts = [] }) {
  const sender = player.getPacketSender();
  const rows = pluginApi.getRegisteredCommands(player).map(({ command, description }, index) => ({
    id: index + 1, name: `::${command}${description ? ` - ${description}` : ""}`,
  }));
  player.setInterfaceId(GROUP_ID);
  sender.sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: 227, args: [uid(COMPONENT.FRAME), "Commands"] }],
  });
  sender.sendString(JSON.stringify(rows), uid(COMPONENT.DATA));
  sender.sendString(parts.slice(1).join(" ").slice(0, 60), uid(COMPONENT.SEARCH_INPUT));
  return true;
}

module.exports = {
  name: "Commands",
  description: "A searchable in-game list of the commands available to the player, opened with ::commands.",
  register(api) {
    pluginApi = api;
    api.registerCustomInterface(buildInterface());
    api.registerCommand("commands", openCommands, undefined, "Search available commands (Ctrl+/, optional search text)");
    api.onCustomEvent("commands:open", openCommands);
  },
  _test: { GROUP_ID, COMPONENT, uid },
};
