const { FLAG_OP1, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("../widgetGroup");

// Reconnects must not reuse the old header's alignment or visibility defaults.
const GROUP_ID = 30015;
const COMPONENT = { ROOT: 0, USERNAME: 1, TELEPORTS: 2, PRESETS: 3, COMMANDS: 4, XP: 5, VIEW: 6, SCROLLBAR: 7 };
const uid = (component) => (GROUP_ID << 16) | component;
const BUTTON_WIDTH = 56;
const BUTTON_GAP = 4;
const BUTTONS = [
  { component: COMPONENT.TELEPORTS, label: "Teleports", command: "teleports", event: "teleports:open" },
  { component: COMPONENT.PRESETS, label: "Presets", command: "presets", event: "presets:open" },
  { component: COMPONENT.COMMANDS, label: "Commands", command: "commands", event: "commands:open" },
  { component: COMPONENT.XP, command: "lockxp" },
];

function buttonPositions(commands) {
  const navigation = BUTTONS.filter(button => button.event && commands.has(button.command));
  return navigation.map((button, index) => ({
    component: button.component,
    x: (index - (navigation.length - 1) / 2) * (BUTTON_WIDTH + BUTTON_GAP),
    y: 28,
  }));
}
const SECTIONS = [
  // Explicit component IDs keep existing rows and headings stable when adding a field.
  [20, "PK Information", [
    [21, "playerKills", "Player Kills"],
    [22, "botKills", "Bot Kills"],
    [23, "pvpDeaths", "Deaths against players"],
    [42, "botDeaths", "Deaths against bots"],
    [24, "otherDeaths", "Other Deaths"],
    [25, "kdr", "PvP kill death ratio"],
    [26, "elo", "Elo Rating"],
    [27, "playerKillstreak", "Player Killstreak"],
    [41, "botKillstreak", "Bot Killstreak"],
  ]],
  [28, "Slayer Information", [
    [29, "task", "Current task", 32],
    [30, "remaining", "Kills left"],
    [31, "slayerPoints", "Slayer points"],
  ]],
  [32, "Points", [[33, "bloodMoney", "Blood Money"]]],
  [34, "Currencies", [
    [35, "bankValue", "Bank total value", 32],
    [36, "bankCoins", "GP in bank", 32],
    [37, "platinumTokens", "Platinum tokens", 32],
    [38, "tokkul", "Tokkul", 32],
    [39, "stardust", "Stardust", 32],
    [40, "marksOfGrace", "Marks of grace", 32],
  ]],
];
const ROWS = [];

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(COMPONENT.ROOT, -1, { widthMode: 1, heightMode: 1, width: 190, height: 261 });
  const textStyle = { type: TYPE_TEXT, fontId: 494, textColor: 0xffd27f, textShadowed: true, yTextAlignment: 1 };
  add(COMPONENT.USERNAME, root, {
    ...textStyle, rawX: 4, rawY: 2, rawWidth: 8, widthMode: 1, rawHeight: 22, height: 22,
    fontId: 496, xTextAlignment: 1,
  });
  for (const [index, { component, label }] of BUTTONS.filter(button => button.event).entries()) {
    const bounds = {
      rawX: (index - 1) * (BUTTON_WIDTH + BUTTON_GAP), xPositionMode: 1, rawY: 28,
      rawWidth: BUTTON_WIDTH, rawHeight: 22, width: BUTTON_WIDTH, height: 22,
      hidden: true, isHidden: true,
    };
    add(component, root, {
      ...bounds, type: TYPE_RECTANGLE,
      filled: true, color: 0x483e33, mouseOverColor: 0x332b23, actions: ["Open"], flags: FLAG_OP1,
    });
    add(component + 6, root, {
      ...bounds, type: TYPE_RECTANGLE,
      filled: false, color: 0x8d7957,
    });
    add(component + 10, root, {
      ...textStyle, ...bounds, text: label,
      xTextAlignment: 1, actions: ["Open"], flags: FLAG_OP1,
    });
  }
  add(COMPONENT.XP, root, {
    type: TYPE_RECTANGLE, rawX: 4, rawY: 54, rawWidth: 8, widthMode: 1, rawHeight: 22, height: 22,
    filled: true, color: 0x483e33, mouseOverColor: 0x332b23, actions: ["Toggle"], flags: FLAG_OP1,
    hidden: true, isHidden: true,
  });
  add(COMPONENT.XP + 6, root, {
    type: TYPE_RECTANGLE, rawX: 4, rawY: 54, rawWidth: 8, widthMode: 1, rawHeight: 22, height: 22,
    filled: false, color: 0x8d7957,
    hidden: true, isHidden: true,
  });
  add(COMPONENT.XP + 10, root, {
    ...textStyle, rawX: 4, rawY: 54, rawWidth: 8, widthMode: 1, rawHeight: 22, height: 22,
    text: "Combat XP: <col=00ff00>On</col>", xTextAlignment: 1, actions: ["Toggle"], flags: FLAG_OP1,
    hidden: true, isHidden: true,
  });
  const view = add(COMPONENT.VIEW, root, {
    rawX: 6, rawY: 84, rawWidth: 26, rawHeight: 88, widthMode: 1, heightMode: 1,
    width: 164, height: 173,
  });
  add(COMPONENT.SCROLLBAR, root, {
    rawX: 2, rawY: 84, xPositionMode: 2, rawWidth: 16, width: 16,
    rawHeight: 88, heightMode: 1, height: 173, noClickThrough: true,
  });
  let y = 0;
  for (const [heading, title, fields] of SECTIONS) {
    add(heading, view, {
      ...textStyle, rawY: y, widthMode: 1, rawHeight: 21, height: 21, fontId: 496, text: title,
    });
    y += 23;
    for (const [component, key, label, height = 18] of fields) {
      ROWS.push({ key, label, component, multiline: height > 18 });
      add(component, view, { ...textStyle, rawY: y, widthMode: 1, rawHeight: height, height });
      y += height;
    }
    y += 8;
  }
  return { groupId: GROUP_ID, widgets, scroll: [{ viewComponent: COMPONENT.VIEW, scrollbarComponent: COMPONENT.SCROLLBAR, contentHeight: y }] };
}

const DEFINITION = buildInterface();
module.exports = { GROUP_ID, COMPONENT, ROWS, BUTTONS, DEFINITION, uid, buttonPositions };
