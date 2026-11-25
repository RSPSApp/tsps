const { FLAG_OP1, FLAG_OP2, TYPE_RECTANGLE, TYPE_TEXT, TYPE_GRAPHIC, TYPE_MODEL, createWidgetGroup } = require("../../interface/widgetGroup");

const ContainerView = require("./Containers.AdminPanel");
const BotView = require("./BotView.AdminPanel");

const GROUP_ID = 30022, MAIN_MODAL_UID = (161 << 16) | 16;
const COMPONENT = {
  ROOT: 0, FRAME: 1, TARGET: 2, TARGET_BUTTON: 3, SELF_BUTTON: 4,
  SEARCH_BOX: 5, SEARCH_INPUT: 6, STATUS: 7, LIST_VIEW: 8, LIST_SCROLLBAR: 9,
  PANEL: 10, PANEL_TITLE: 11, PANEL_INFO: 12, PANEL_INFO2: 13, PANEL_DESCRIPTION: 14,
  PANEL_ICON: 15, LAYOUT: 16, UTILITY: 17, UTILITY_LABEL: 18,
  TAB_START: 20, TAB_LABEL_START: 30, BUTTON_START: 40, BUTTON_LABEL_START: 44,
  DATA_START: 50, EXTRA_DATA_START: 400, SEARCH_REQUEST: 60, SEARCH_RESPONSE: 61, SEARCH_SESSION: 62,
  DETAIL_VIEW: 63, DETAIL_SCROLLBAR: 64, PANEL_BORDER: 65, PANEL_EMPTY: 66,
  SKILL_VIEW: 70, SKILL_SCROLLBAR: 71, SKILL_GRID: 72, SKILL_TOTAL: 73, SKILL_PRESETS: 74,
  PRESET_START: 80, PRESET_LABEL_START: 84,
  SKILL_LEFT_START: 100, SKILL_RIGHT_START: 130, SKILL_ICON_START: 160,
  SKILL_CURRENT_START: 190, SKILL_BASE_START: 220, SKILL_BUTTON_START: 250, SKILL_NAME_START: 280,
  SECTION_START: 500, SECTION_LABEL_START: 510, ADD_ITEMS: 520, ADD_ITEMS_LABEL: 521, EDITOR_HINT: 522, CONTAINER_ADD: 523, CONTAINER_ADD_LABEL: 524,
  SPAWN_START: 530, SPAWN_LABEL_START: 532, MAP_TELEPORT: 534, MAP_TELEPORT_LABEL: 535,
  QUEST_ACTION_START: 536, QUEST_ACTION_LABEL_START: 538,
  LIST_BACKGROUND: 900, ROW_BACKGROUND_START: 1000, ROW_LABEL_START: 1100, ROW_ICON_START: 1200,
  ROW_BORDER_START: 1300, ROW_DIVIDER_START: 1400, ROW_GUIDE_START: 1500, ROW_TOGGLE_START: 1600, ROW_GLYPH_START: 1700,
};
const TAB_LABELS = ["Players", "Teleports", "Items", "Player editor", "Cheats", "Spawn", "Bots"];
const SPAWN_LABELS = ["NPCs", "Items"];
const SECTION_LABELS = ["Skills", "Quests", "Staff", "Inventory", "Equipment", "Bank", "Character"];
const ROW_SLOTS = 64;
const DATA_COMPONENTS = [COMPONENT.DATA_START, COMPONENT.EXTRA_DATA_START].flatMap(start => Array.from({ length: 8 }, (_, i) => start + i));
const BUTTONS = Array.from({ length: 4 }, (_, i) => ({ button: COMPONENT.BUTTON_START + i, label: COMPONENT.BUTTON_LABEL_START + i }));
const PRESETS = [["max", "Max all"], ["combat", "Max combat"], ["reset", "Reset all"], ["restore", "Restore"]];
const QUEST_ACTIONS = [["complete-all", "Unlock all quests"], ["reset-all", "Reset all quests"]];
const SKILL_ORDER = [0, 3, 14, 2, 16, 13, 1, 15, 10, 4, 17, 7, 5, 12, 11, 6, 9, 8, 20, 18, 19, 22, 21, 23];
const TAB_VISIBILITY = [];
const uid = component => (GROUP_ID << 16) | component;
const text = (x, y, width, height, extra = {}) => ({ type: TYPE_TEXT, rawX: x, rawY: y, rawWidth: width, rawHeight: height,
  width, height, text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true, lineHeight: 14, ...extra });
const box = (x, y, width, height, extra = {}) => ({ type: TYPE_RECTANGLE, rawX: x, rawY: y, rawWidth: width, rawHeight: height,
  width, height, filled: true, color: 0x211c16, ...extra });
const clickable = { flags: FLAG_OP1, actions: ["Select"], mouseOverColor: 0x54432c };
const hidden = { hidden: true, isHidden: true };

function buildInterface(skillIcons = new Map(), equipmentIcons = new Map()) {
  const { widgets, add } = createWidgetGroup(GROUP_ID), C = COMPONENT;
  const root = add(C.ROOT, -1, { rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1, maxWidth: 920, maxHeight: 900,
    width: 494, height: 316, xPositionMode: 1, yPositionMode: 1, noClickThrough: true, suppressHoverText: true });
  add(C.FRAME, root, { widthMode: 1, heightMode: 1, width: 494, height: 316 });
  add(C.TARGET, root, text(18, 33, 224, 20, { fontId: 496, textColor: 0xffd27f, yTextAlignment: 1, widthMode: 1, rawWidth: 224 }));
  add(C.TARGET_BUTTON, root, text(86, 33, 108, 20, { text: "Find player", ...clickable, xPositionMode: 2, xTextAlignment: 1, yTextAlignment: 1 }));
  add(C.SELF_BUTTON, root, text(18, 33, 64, 20, { text: "Use self", ...clickable, xPositionMode: 2, xTextAlignment: 1, yTextAlignment: 1 }));
  const button = (id, labelId, parent, x, y, width, height, name, extra = {}) => {
    add(id, parent, box(x, y, width, height, { ...clickable, color: 0x30291f, ...extra }));
    add(labelId, parent, text(x, y, width, height, { text: name, ...clickable, textColor: 0xffd27f, mouseOverColor: 0xffffff,
      xTextAlignment: 1, yTextAlignment: 1, ...extra }));
  };
  TAB_LABELS.forEach((label, i) => {
    const widths = [54, 70, 0, 100, 58, 54, 48], x = 18 + widths.slice(0, i).reduce((a, b) => a + (b ? b + 4 : 0), 0);
    button(C.TAB_START + i, C.TAB_LABEL_START + i, root, x, 58, widths[i], 26, label, i === 2 ? hidden : {});
  });
  SECTION_LABELS.forEach((label, i) => {
    const widths = [44, 46, 40, 62, 70, 40, 72], x = 18 + widths.slice(0, i).reduce((a, b) => a + b + 3, 0);
    button(C.SECTION_START + i, C.SECTION_LABEL_START + i, root, x, 88, widths[i], 22, label, hidden);
  });
  SPAWN_LABELS.forEach((label, i) => button(C.SPAWN_START+i,C.SPAWN_LABEL_START+i,root,18+i*68,88,64,22,label,hidden));
  add(C.EDITOR_HINT, root, text(18, 88, 332, 22, { textColor: 0xb9ab96 }));
  button(C.MAP_TELEPORT, C.MAP_TELEPORT_LABEL, root, 18, 88, 458, 22, "Teleport to map location", { ...hidden, widthMode: 1, rawWidth: 36 });
  button(C.CONTAINER_ADD, C.CONTAINER_ADD_LABEL, root, 18, 88, 100, 22, "Add item", { ...hidden, xPositionMode: 2 });
  button(C.ADD_ITEMS, C.ADD_ITEMS_LABEL, root, 18, 145, 100, 18, "Add items", { ...hidden, xPositionMode: 2 });
  add(C.SEARCH_BOX, root, box(18, 116, 458, 26, { ...clickable, color: 0x2b241b, widthMode: 1, rawWidth: 36 }));
  add(C.SEARCH_INPUT, root, text(26, 116, 446, 26, { ...clickable, mouseOverColor: 0xe8ded0, yTextAlignment: 1, widthMode: 1, rawWidth: 52 }));
  add(C.STATUS, root, text(18, 146, 458, 16, { textColor: 0xb8ab94, widthMode: 1, rawWidth: 36 }));
  QUEST_ACTIONS.forEach(([, label], i) => button(C.QUEST_ACTION_START + i, C.QUEST_ACTION_LABEL_START + i,
    root, 18 + (QUEST_ACTIONS.length - 1 - i) * 116, 145, 112, 18, label, { ...hidden, xPositionMode: 2, actions: [label] }));
  [...DATA_COMPONENTS, C.LAYOUT, C.SEARCH_REQUEST, C.SEARCH_RESPONSE, C.SEARCH_SESSION]
    .forEach(component => add(component, root, { type: TYPE_TEXT, ...hidden }));
  const list = add(C.LIST_VIEW, root, { rawX: 18, rawY: 166, rawWidth: 294, rawHeight: 180,
    widthMode: 1, heightMode: 1, width: 200, height: 136, scrollWidth: 200, scrollHeight: 136 });
  add(C.LIST_SCROLLBAR, root, { rawX: 258, rawY: 166, rawWidth: 14, rawHeight: 180, heightMode: 1,
    xPositionMode: 2, width: 14, height: 136, noClickThrough: true });
  add(C.LIST_BACKGROUND, list, box(0, 0, 0, 0, { widthMode: 1, heightMode: 1 }));
  for (let i = 0; i < ROW_SLOTS; i++) {
    add(C.ROW_BACKGROUND_START + i, list, box(0, 0, 438, 44, { ...clickable, mouseOverColor: 0x493d2b, widthMode: 1, rawWidth: 2 }));
    add(C.ROW_LABEL_START + i, list, text(50, 0, 382, 44, { ...clickable, mouseOverColor: 0xffd27f, yTextAlignment: 1, overflowScroll: true,
      fontId: 495, widthMode: 1, rawWidth: 58 }));
    add(C.ROW_ICON_START + i, list, { type: TYPE_GRAPHIC, rawX: 6, rawY: 5, rawWidth: 36, rawHeight: 36,
      width: 36, height: 36, ...clickable, itemQuantityMode: 0, npcFullBody: true, recycleModel: true, rotationX: 160, rotationY: 256 });
    add(C.ROW_BORDER_START + i, list, box(0, 0, 0, 0, { filled: false, color: 0x806845, ...hidden }));
    add(C.ROW_DIVIDER_START + i, list, box(0, 0, 0, 1, { color: 0x51432f, ...hidden }));
    add(C.ROW_GUIDE_START + i, list, box(0, 0, 1, 0, { color: 0x806845, ...hidden }));
    add(C.ROW_TOGGLE_START + i, list, box(0, 0, 22, 22, { ...clickable, filled: false, color: 0xc19b60, ...hidden }));
    add(C.ROW_GLYPH_START + i, list, text(0, 0, 22, 22, { ...clickable, fontId: 496,
      textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1, ...hidden }));
  }
  add(C.PANEL, root, box(18, 166, 224, 180, { xPositionMode: 2, heightMode: 1, height: 136 }));
  add(C.PANEL_BORDER, root, box(18, 166, 224, 180, { xPositionMode: 2, heightMode: 1, filled: false, color: 0x806845 }));
  const detailView = add(C.DETAIL_VIEW, root, { rawX: 44, rawY: 174, rawWidth: 190, rawHeight: 258,
    xPositionMode: 2, heightMode: 1, width: 190, height: 58, scrollHeight: 330 });
  add(C.DETAIL_SCROLLBAR, root, { rawX: 24, rawY: 174, rawWidth: 12, rawHeight: 258,
    xPositionMode: 2, heightMode: 1, width: 12, height: 58 });
  add(C.PANEL_EMPTY, detailView, text(8, 16, 174, 80, { text: "Select an entry to see its preview and actions.",
    textColor: 0xb9ab96, xTextAlignment: 1 }));
  add(C.PANEL_TITLE, detailView, text(0, 0, 190, 40, { fontId: 496, textColor: 0xffd27f, xTextAlignment: 1, yTextAlignment: 1 }));
  add(C.PANEL_INFO, detailView, text(0, 44, 190, 36, { xTextAlignment: 1 }));
  add(C.PANEL_INFO2, detailView, text(0, 84, 190, 28, { textColor: 0xb9ab96, xTextAlignment: 1 }));
  add(C.PANEL_DESCRIPTION, detailView, text(88, 118, 102, 174));
  add(C.PANEL_ICON, detailView, { type: TYPE_MODEL, rawX: 0, rawY: 118, rawWidth: 80, rawHeight: 114,
    width: 80, height: 114, itemQuantityMode: 0, npcFullBody: true, recycleModel: true, fitModel: true,
    rotationX: 160, rotationY: 256, ...hidden });
  BUTTONS.forEach(({ button: id, label }, i) => button(id, label, root, i % 2 ? 26 : 130,
    i < 2 ? 46 : 18, 100, 24, "", { xPositionMode: 2, yPositionMode: 2, flags: FLAG_OP1 | FLAG_OP2, ...hidden }));
  button(C.UTILITY, C.UTILITY_LABEL, root, 18, 16, 458, 24, "Refresh", { yPositionMode: 2, widthMode: 1, rawWidth: 36, ...hidden });
  const skillView = add(C.SKILL_VIEW, root, { rawX: 18, rawY: 116, rawWidth: 54, rawHeight: 130,
    widthMode: 1, heightMode: 1, width: 440, height: 170, scrollHeight: 406, ...hidden });
  add(C.SKILL_SCROLLBAR, root, { rawX: 18, rawY: 116, rawWidth: 16, rawHeight: 130, heightMode: 1,
    xPositionMode: 2, width: 16, height: 76, noClickThrough: true, ...hidden });
  const grid = add(C.SKILL_GRID, skillView, { rawWidth: 426, rawHeight: 406, width: 426, height: 406, xPositionMode: 1 });
  SKILL_ORDER.forEach((skill, slot) => {
    const x = slot % 3 * 142, y = Math.floor(slot / 3) * 44;
    add(C.SKILL_LEFT_START + skill, grid, box(x, y, 138, 40, { color: 0x3b352b }));
    add(C.SKILL_ICON_START + skill, grid, { type: TYPE_GRAPHIC, rawX: x + 5, rawY: y + 9, rawWidth: 20, rawHeight: 20,
      width: 20, height: 20, spriteId: skillIcons.get(skill) ?? -1 });
    add(C.SKILL_NAME_START + skill, grid, text(x + 30, y + 3, 104, 17, { textColor: 0xffd27f }));
    add(C.SKILL_CURRENT_START + skill, grid, text(x + 30, y + 20, 44, 17, { textColor: 0xffff00 }));
    add(C.SKILL_BASE_START + skill, grid, text(x + 76, y + 20, 58, 17, { textColor: 0xffff00 }));
    add(C.SKILL_BUTTON_START + skill, grid, box(x, y, 138, 40, { ...clickable, filled: false, opacity: 255, actions: ["Set level"] }));
  });
  add(C.SKILL_TOTAL, grid, text(0, 354, 426, 20, { xTextAlignment: 1, textColor: 0xffff00 }));
  const presets = add(C.SKILL_PRESETS, grid, { rawY: 380, rawWidth: 426, rawHeight: 24, width: 426, height: 24 });
  PRESETS.forEach(([, name], i) => button(C.PRESET_START + i, C.PRESET_LABEL_START + i, presets, i * 107, 0, 104, 24, name));
  ContainerView.build(add, root, text, box, equipmentIcons);
  BotView.build(add, root, text, box, button);
  return { groupId: GROUP_ID, widgets, lifecycle: { persistOnWorldInteraction: true, blocksGameplay: false },
    search: { inputComponent: C.SEARCH_INPUT, backgroundComponent: C.SEARCH_BOX, dataComponent: DATA_COMPONENTS[0],
      extraDataComponents: DATA_COMPONENTS.slice(1), maxLength: 60, placeholder: "<col=8f7f66>Search names...</col>",
      focusColor: 0x443927, blurColor: 0x211c16, caret: "|", textTemplate: "%s", focusOnOpen: false, focusOnTabs: [2,5], socket: { requestComponent: C.SEARCH_REQUEST,
        responseComponent: C.SEARCH_RESPONSE, sessionComponent: C.SEARCH_SESSION, tabs: [2, 5], minimumLength: 2,
        allowNumeric: true, pageSize: 40, retainedPages: 3, idle: "Search a name (2+ letters)." }, debounceMs: 180 },
    list: { viewComponent: C.LIST_VIEW, scrollbarComponent: C.LIST_SCROLLBAR, slotCount: ROW_SLOTS, columns: 1,
      rowHeight: 46, stripeColors: [0x28221b, 0x30291f], labelXWithoutIcon: 10, textOnly: true, backgroundStart: C.ROW_BACKGROUND_START, iconStart: C.ROW_ICON_START,
      labelStart: C.ROW_LABEL_START, iconBaseY: 5, itemLabel: "%name<col=b8ab94>%detail</col>", clickable: true,
      headerStyle: { height: 22, backgroundColor: 0x3b3022, textColor: 0xffd27f, labelX: 6, labelWidth: 12 },
      collapsible: true, groupLabel: "%name", groupHeight: 36, groupColor: 0x3b3022,
      rowChrome: { borderStart: C.ROW_BORDER_START, dividerStart: C.ROW_DIVIDER_START, guideStart: C.ROW_GUIDE_START,
        toggleStart: C.ROW_TOGGLE_START, toggleGlyphStart: C.ROW_GLYPH_START, indent: 16, maxIndent: 64 },
      select: { op: 1, clearOnQuery: true, backgroundColor: 0x54432c, emptyComponent: C.PANEL_EMPTY, iconComponent: C.PANEL_ICON, autoHideIcon: true,
        clearComponents: [C.PANEL_ICON, ...BUTTONS.flatMap(({ button, label }) => [button, label])],
        actionComponents: BUTTONS.map(({ button, label }, i) => ({ field: ["primary", "secondary", "third", "fourth"][i], components: [button, label] })),
        texts: { title: C.PANEL_TITLE, info: C.PANEL_INFO, info2: C.PANEL_INFO2, description: C.PANEL_DESCRIPTION,
          primary: BUTTONS[0].label, secondary: BUTTONS[1].label, third: BUTTONS[2].label, fourth: BUTTONS[3].label } } },
    scroll: [{ viewComponent: BotView.C.VIEW, scrollbarComponent: BotView.C.SCROLLBAR, contentHeightComponent: BotView.C.HEIGHT, contentHeight: 400,
        resetOnComponents: [...BotView.categoryComponents, BotView.C.BACK, BotView.C.BACK_LABEL] },
      { viewComponent: ContainerView.C.VIEW, scrollbarComponent: ContainerView.C.SCROLLBAR, contentHeightComponent: ContainerView.C.HEIGHT, contentHeight: 261 },
      { viewComponent: ContainerView.C.BANK_VIEW, scrollbarComponent: ContainerView.C.BANK_SCROLLBAR, contentHeightComponent: ContainerView.C.BANK_HEIGHT, contentHeight: 36 },
      { viewComponent: C.DETAIL_VIEW, scrollbarComponent: C.DETAIL_SCROLLBAR, contentHeight: 330,
      resetOnComponents: [C.TAB_START, C.TAB_LABEL_START].flatMap(start => TAB_LABELS.map((_, i) => start + i)) },
      { viewComponent: C.SKILL_VIEW, scrollbarComponent: C.SKILL_SCROLLBAR, contentHeight: 406 }],
    tabs: { components: TAB_LABELS.map((_, i) => C.TAB_START + i), labelComponents: TAB_LABELS.map((_, i) => C.TAB_LABEL_START + i),
      labels: TAB_LABELS, activeTemplate: "<col=ffffff>%s</col>", inactiveTemplate: "<col=ffd27f>%s</col>",
      activeLabelIndices: { 2: 3 }, activeColor: 0x59472e, inactiveColor: 0x30291f, layoutComponent: C.LAYOUT, clearQuery: true, visibility: TAB_VISIBILITY,
      serverDriven: true, pendingComponents: [...BotView.components,C.TARGET_BUTTON,C.SELF_BUTTON,C.SEARCH_BOX,C.SEARCH_INPUT,C.STATUS,C.LIST_VIEW,C.LIST_SCROLLBAR,
        C.PANEL,C.PANEL_BORDER,C.DETAIL_VIEW,C.DETAIL_SCROLLBAR,C.SKILL_VIEW,C.SKILL_SCROLLBAR,
        ContainerView.C.VIEW,ContainerView.C.SCROLLBAR,ContainerView.C.BANK_VIEW,ContainerView.C.BANK_SCROLLBAR,
        ContainerView.C.BANK_TABS,ContainerView.C.BANK_INFO,C.UTILITY,C.UTILITY_LABEL,C.EDITOR_HINT,
        C.ADD_ITEMS,C.ADD_ITEMS_LABEL,C.CONTAINER_ADD,C.CONTAINER_ADD_LABEL,C.MAP_TELEPORT,C.MAP_TELEPORT_LABEL,
        ...BUTTONS.flatMap(({button,label})=>[button,label]),
        ...SECTION_LABELS.flatMap((_,i)=>[C.SECTION_START+i,C.SECTION_LABEL_START+i]),
        ...SPAWN_LABELS.flatMap((_,i)=>[C.SPAWN_START+i,C.SPAWN_LABEL_START+i])],
      geometry: [
        { component: C.SEARCH_BOX, base: {rawWidth:36}, overrides: {6:{rawWidth:294}} },
        { component: C.SEARCH_INPUT, base: {rawWidth:52}, overrides: {6:{rawWidth:310}} },
        { component: C.STATUS, base: {rawWidth:36}, overrides: {6:{rawWidth:294}} },
        { component: C.PANEL, base: {rawY:166,rawHeight:180}, overrides: {6:{rawY:116,rawHeight:130}} },
        { component: C.PANEL_BORDER, base: {rawY:166,rawHeight:180}, overrides: {6:{rawY:116,rawHeight:130}} },
        { component: C.DETAIL_VIEW, base: {rawY:174,rawHeight:258}, overrides: {6:{rawY:124,rawHeight:176}} },
        { component: C.DETAIL_SCROLLBAR, base: {rawY:174,rawHeight:258}, overrides: {6:{rawY:124,rawHeight:176}} },
        ...[BUTTONS[0].button,BUTTONS[0].label].map(component=>({component,base:{rawY:46},overrides:{6:{rawY:18}}})),
        { component: C.PANEL_TITLE, base: {rawY:0,rawHeight:40}, overrides: {6:{rawY:0,rawHeight:52}} },
        { component: C.PANEL_INFO, base: {rawY:44,rawHeight:36}, overrides: {6:{rawY:56,rawHeight:24}} },
        { component: C.PANEL_INFO2, base: {rawY:84,rawHeight:28}, overrides: {6:{rawY:82,rawHeight:0}} },
        { component: C.PANEL_DESCRIPTION, base: {rawX:88,rawY:118,rawWidth:102,rawHeight:174}, overrides: {6:{rawX:0,rawY:88,rawWidth:190,rawHeight:212}} },
        { component: C.EDITOR_HINT, base: {rawX:18,rawWidth:332}, overrides: {5:{rawX:164,rawWidth:290}} },
        { component: C.LIST_VIEW, base: { rawWidth: 294, rawHeight: 180 }, overrides: { 1: { rawWidth: 54, rawHeight: 218 } } },
        { component: C.LIST_SCROLLBAR, base: { rawX: 258, rawHeight: 180 }, overrides: { 1: { rawX: 18, rawHeight: 218 } } },
      ] },
    status: { component: C.STATUS, matches: "%total listed", loading: "Searching...", error: "Search unavailable. Try again.", empty: "No matches. Try another name." } };
}
module.exports = { GROUP_ID, MAIN_MODAL_UID, COMPONENT, TAB_LABELS, SECTION_LABELS, SPAWN_LABELS, DATA_COMPONENTS, BUTTONS, ROW_SLOTS, PRESETS, QUEST_ACTIONS, SKILL_ORDER, TAB_VISIBILITY, uid, buildInterface };
