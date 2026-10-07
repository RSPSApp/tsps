const { FLAG_OP1, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("./widgetGroup");

const GROUP_ID = 30004;
const MAIN_MODAL_UID = (161 << 16) | 16;
const COMPONENT = { ROOT: 0, FRAME: 1, LIST_VIEW: 2, LIST_SCROLLBAR: 3, SEARCH_BOX: 4, SEARCH_INPUT: 5,
  STATUS: 6, DATA: 7, ROW_START: 10, ROW_BACKGROUND_START: 30 };
const ROW_COUNT = 16;
const ROW_HEIGHT = 16;
const uid = (component) => (GROUP_ID << 16) | component;
let pluginApi;

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: 494, height: 316, xPositionMode: 1, yPositionMode: 1,
  });
  add(COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 494, height: 316 });
  add(COMPONENT.SEARCH_BOX, root, {
    type: TYPE_RECTANGLE, rawX: 18, rawY: 32, rawWidth: 442, rawHeight: 24,
    width: 442, height: 24, filled: true, color: 0x2b241b, mouseOverColor: 0x3a3125,
    actions: ["Search"], flags: FLAG_OP1,
  });
  add(COMPONENT.SEARCH_INPUT, root, {
    type: TYPE_TEXT, rawX: 24, rawY: 32, rawWidth: 430, rawHeight: 24,
    width: 430, height: 24, fontId: 494, textColor: 0xe8ded0, textShadowed: true, yTextAlignment: 1,
    actions: ["Search"], flags: FLAG_OP1,
  });
  add(COMPONENT.STATUS, root, {
    type: TYPE_TEXT, rawX: 18, rawY: 58, rawWidth: 442, rawHeight: 16,
    width: 442, height: 16, fontId: 494, textColor: 0xffd27f,
  });
  add(COMPONENT.DATA, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
  const list = add(COMPONENT.LIST_VIEW, root, {
    rawX: 18, rawY: 78, rawWidth: 442, rawHeight: 222,
    width: 442, height: 222, scrollWidth: 442, scrollHeight: 222,
  });
  add(COMPONENT.LIST_SCROLLBAR, root, {
    rawX: 464, rawY: 78, rawWidth: 16, rawHeight: 222,
    width: 16, height: 222, noClickThrough: true,
  });
  for (let row = 0; row < ROW_COUNT; row++) {
    add(COMPONENT.ROW_BACKGROUND_START + row, list, {
      rawY: row * ROW_HEIGHT, rawWidth: 442, rawHeight: ROW_HEIGHT, width: 442, height: ROW_HEIGHT,
    });
    add(COMPONENT.ROW_START + row, list, {
      type: TYPE_TEXT, rawY: row * ROW_HEIGHT, rawWidth: 442, rawHeight: ROW_HEIGHT,
      width: 442, height: ROW_HEIGHT, text: "", fontId: 494, textColor: 0xe8ded0,
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

function openCommands({ player, parts }) {
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
  register(api) {
    pluginApi = api;
    api.registerCustomInterface(buildInterface());
    api.registerCommand("commands", openCommands, undefined, "Search available commands (optional search text)");
  },
  _test: { GROUP_ID, COMPONENT, uid },
};
