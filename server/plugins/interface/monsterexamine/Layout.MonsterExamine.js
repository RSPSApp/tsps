const { TYPE_MODEL, TYPE_TEXT, TYPE_RECTANGLE, TYPE_GRAPHIC, FLAG_OP1, FLAG_OP2, FLAG_OP3, createWidgetGroup } = require('../widgetGroup');
const GROUP_ID = 30021;
const MAIN_MODAL_UID = (161 << 16) | 16;
// Static widgets paint in component order, not declaration order. Keep every
// background below the icons and text it belongs to, including pooled list rows.
const C = { ROOT: 0, FRAME: 1, PREVIEW: 2, PREVIEW_BACKGROUND: 3, MODEL: 4, SUMMARY: 5, PREVIEW_BORDER: 6,
  BACK: 7, BACK_TEXT: 8, LEFT: 10, FACTS: 11, LEFT_BAR: 12, HEIGHT: 13,
  FIND: 14, FIND_TEXT: 15, CLEAR: 16, CLEAR_TEXT: 17,
  SEARCH: 20, INPUT: 21, STATUS: 22, HEADER: 23, ITEM_HEADER: 24, QUANTITY_HEADER: 25, RATE_HEADER: 26,
  LIST: 30, BAR: 31, NOTE: 32, DATA: 40,
  GROUP_BACKGROUND: 50, GROUP_BORDER: 90,
  BACKGROUND: 140, BORDER: 180, GUIDE: 220, ICON: 260, TOGGLE: 300, TOGGLE_GLYPH: 340,
  LABEL: 400, QUANTITY: 500, RATE: 600, SOURCE: 700, DIVIDER: 740 };
const DATA_COMPONENTS = [C.DATA, 41, 42, 43];
const SLOTS = 40;
const ROW_HEIGHT = 64;
const COLOR = { gold: 0xffd27f, text: 0xe8ded0, muted: 0xb9ab96, panel: 0x30291f, inset: 0x211c16 };
const FONT = { small: 494, normal: 495, bold: 496 }; // p11_full, p12_full, b12_full
function uid(component) { return (GROUP_ID << 16) | component; }
function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const text = { type: TYPE_TEXT, fontId: FONT.small, textColor: COLOR.text, textShadowed: true, lineHeight: 14 };
  // The cache modal mount supplies the available size in Fixed and Resizable.
  const root = add(C.ROOT, -1, { rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: 494, height: 316, maxWidth: 920, maxHeight: 900, xPositionMode: 1, yPositionMode: 1, noClickThrough: true });
  add(C.FRAME, root, { widthMode: 1, heightMode: 1 });
  for (const [component, label, caption, x, width, right] of [
    [C.BACK, C.BACK_TEXT, 'Back to Bestiary', 10, 128, false],
    [C.FIND, C.FIND_TEXT, 'Find', 116, 52, true], [C.CLEAR, C.CLEAR_TEXT, 'Clear pins', 32, 80, true]]) {
    add(component, root, { type: TYPE_RECTANGLE, rawX: x, rawY: 7, rawWidth: width, rawHeight: 20,
      xPositionMode: right ? 2 : 0, filled: true, color: COLOR.inset, mouseOverColor: 0x493d2b,
      flags: FLAG_OP1, actions: [caption] });
    add(label, root, { ...text, rawX: x, rawY: 7, rawWidth: width, rawHeight: 20,
      xPositionMode: right ? 2 : 0, text: caption, textColor: COLOR.gold, xTextAlignment: 1,
      yTextAlignment: 1, flags: FLAG_OP1, actions: [caption] });
  }
  const preview = add(C.PREVIEW, root, { rawX: 14, rawY: 38, rawWidth: 218, rawHeight: 154 });
  add(C.PREVIEW_BACKGROUND, preview, { type: TYPE_RECTANGLE, widthMode: 1, heightMode: 1,
    filled: true, color: COLOR.inset });
  add(C.MODEL, preview, { type: TYPE_MODEL, rawX: 2, rawY: 2, rawWidth: 214, rawHeight: 150,
    modelId: -1, npcFullBody: true, rotationX: 160, rotationY: 256 });
  add(C.PREVIEW_BORDER, preview, { type: TYPE_RECTANGLE, widthMode: 1, heightMode: 1, filled: false, color: 0x685438 });
  add(C.SUMMARY, root, { ...text, rawX: 14, rawY: 195, rawWidth: 218, rawHeight: 20,
    fontId: FONT.normal, xTextAlignment: 1, yTextAlignment: 1 });
  const left = add(C.LEFT, root, { rawX: 14, rawY: 218, rawWidth: 202, rawHeight: 236,
    heightMode: 1, scrollHeight: 700 });
  add(C.FACTS, left, { ...text, rawWidth: 198, rawHeight: 3000 });
  add(C.LEFT_BAR, root, { rawX: 218, rawY: 218, rawWidth: 14, rawHeight: 236, heightMode: 1 });
  add(C.SEARCH, root, { type: TYPE_RECTANGLE, rawX: 242, rawY: 38, rawWidth: 256, rawHeight: 28,
    widthMode: 1, filled: true, color: COLOR.inset, actions: ['Search'], flags: FLAG_OP1 });
  add(C.INPUT, root, { ...text, rawX: 250, rawY: 38, rawWidth: 272, rawHeight: 28,
    widthMode: 1, yTextAlignment: 1, actions: ['Search'], flags: FLAG_OP1 });
  add(C.STATUS, root, { ...text, rawX: 242, rawY: 69, rawWidth: 256, rawHeight: 16,
    widthMode: 1, textColor: COLOR.gold });
  const list = add(C.LIST, root, { rawX: 242, rawY: 87, rawWidth: 272, rawHeight: 99,
    widthMode: 1, heightMode: 1 });
  add(C.BAR, root, { rawX: 14, rawY: 87, rawWidth: 14, rawHeight: 99, xPositionMode: 2, heightMode: 1 });
  for (let i = 0; i < SLOTS; i++) {
    add(C.GROUP_BACKGROUND + i, list, { type: TYPE_RECTANGLE, filled: true, color: COLOR.inset, hidden: true, isHidden: true });
    add(C.GROUP_BORDER + i, list, { type: TYPE_RECTANGLE, filled: false, color: 0x806845, hidden: true, isHidden: true });
    add(C.BACKGROUND + i, list, { type: TYPE_RECTANGLE, rawY: i * ROW_HEIGHT,
      rawHeight: ROW_HEIGHT, widthMode: 1, filled: true, color: i % 2 ? 0x30291f : 0x28221b,
      mouseOverColor: 0x493d2b, flags: FLAG_OP1 | FLAG_OP2 | FLAG_OP3, actions: ['Details'] });
    add(C.BORDER + i, list, { type: TYPE_RECTANGLE, widthMode: 1, filled: false, color: 0x806845, hidden: true, isHidden: true });
    add(C.GUIDE + i, list, { type: TYPE_RECTANGLE, filled: true, color: 0x806845, hidden: true, isHidden: true });
    add(C.ICON + i, list, { type: TYPE_GRAPHIC, rawX: 3, rawY: i * ROW_HEIGHT + 8,
      rawWidth: 32, rawHeight: 32, itemId: -1, itemQuantityMode: 0, flags: FLAG_OP1 | FLAG_OP2 | FLAG_OP3, actions: ['Details'] });
    add(C.TOGGLE + i, list, { type: TYPE_RECTANGLE, rawWidth: 22, rawHeight: 22,
      filled: false, color: 0xc19b60, mouseOverColor: COLOR.gold, flags: FLAG_OP1 | FLAG_OP2 | FLAG_OP3, actions: ['Expand'], hidden: true, isHidden: true });
    add(C.TOGGLE_GLYPH + i, list, { ...text, rawWidth: 22, rawHeight: 22, fontId: FONT.bold,
      textColor: COLOR.gold, xTextAlignment: 1, yTextAlignment: 1, flags: FLAG_OP1 | FLAG_OP2 | FLAG_OP3, actions: ['Expand'], hidden: true, isHidden: true });
    add(C.LABEL + i, list, { ...text, rawX: 40, rawY: i * ROW_HEIGHT + 3,
      rawWidth: 158, rawHeight: 28, widthMode: 1, overflowScroll: true, fontId: FONT.normal, flags: FLAG_OP1 | FLAG_OP2 | FLAG_OP3, actions: ['Details'] });
    add(C.QUANTITY + i, list, { ...text, rawX: 72, rawY: i * ROW_HEIGHT + 3, rawWidth: 44,
      rawHeight: 28, xPositionMode: 2, xTextAlignment: 1, overflowScroll: true, flags: FLAG_OP1 | FLAG_OP2 | FLAG_OP3, actions: ['Details'] });
    add(C.RATE + i, list, { ...text, rawX: 2, rawY: i * ROW_HEIGHT + 3, rawWidth: 68,
      rawHeight: 28, xPositionMode: 2, xTextAlignment: 1, overflowScroll: true, flags: FLAG_OP1 | FLAG_OP2 | FLAG_OP3, actions: ['Details'] });
    add(C.SOURCE + i, list, { ...text, rawX: 40, rawY: i * ROW_HEIGHT + 33,
      rawWidth: 44, rawHeight: 16, widthMode: 1, overflowScroll: true, textColor: COLOR.muted, lineHeight: 12, flags: FLAG_OP1 | FLAG_OP2 | FLAG_OP3, actions: ['Details'] });
    add(C.DIVIDER + i, list, { type: TYPE_RECTANGLE, rawHeight: 1, widthMode: 1, filled: true, color: 0x57462f });
  }
  for (const component of [C.HEIGHT, C.NOTE, ...DATA_COMPONENTS]) add(component, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
  return { groupId: GROUP_ID, widgets,
    search: { inputComponent: C.INPUT, backgroundComponent: C.SEARCH, dataComponent: C.DATA,
      extraDataComponents: DATA_COMPONENTS.slice(1), maxLength: 50,
      placeholder: '<col=b9ab96>Search items or drop groups...</col>', textTemplate: '%s', caret: '|',
      focusColor: 0x443927, blurColor: COLOR.inset },
    list: { viewComponent: C.LIST, scrollbarComponent: C.BAR, slotCount: SLOTS, columns: 1,
      rowHeight: ROW_HEIGHT, iconStart: C.ICON, labelStart: C.LABEL, backgroundStart: C.BACKGROUND,
      cards: { minWidth: 112, maxColumns: 5, gap: 8, height: 132, groups: true,
        groupBackdrops: { backgroundStart: C.GROUP_BACKGROUND, borderStart: C.GROUP_BORDER, slotCount: SLOTS, padding: 4,
          backgroundColors: [COLOR.inset, 0x2b241b], borderColors: [0x806845, 0x9b7f54] },
        parts: [{ start: C.LABEL, x: 8, y: 6, width: 16, height: 18, stretch: true, fontId: FONT.bold, textColor: COLOR.gold },
          { start: C.ICON, x: 0, y: 26, width: 48, height: 48, align: 'center' },
          { start: C.DIVIDER, x: 8, y: 78, width: 16, height: 1, stretch: true },
          { start: C.QUANTITY, x: 8, y: 82, width: 16, height: 14, stretch: true,
            singleLine: true, textAlignment: 0 },
          { start: C.RATE, x: 8, y: 98, width: 16, height: 14, stretch: true, textAlignment: 0 },
          { start: C.SOURCE, x: 8, y: 114, width: 16, height: 14, stretch: true }],
        groupParts: [{ start: C.LABEL, x: 8, y: 6, width: 38, height: 18, stretch: true, fontId: FONT.bold },
          { start: C.TOGGLE, x: -6, y: 6, width: 18, height: 18, align: 'right' },
          { start: C.TOGGLE_GLYPH, x: -6, y: 6, width: 18, height: 18, align: 'right' }] },
      iconBaseY: 8, labelBaseY: 3, itemLabel: '%name', headerLabel: '<col=ffd27f>%name</col>',
      collapsible: true, groupHeight: ROW_HEIGHT, groupColor: 0x3a3125,
      groupLabel: '<col=ffd27f>%name</col>',
      rowChrome: { borderStart: C.BORDER, dividerStart: C.DIVIDER, guideStart: C.GUIDE,
        toggleStart: C.TOGGLE, toggleGlyphStart: C.TOGGLE_GLYPH, indent: 6, maxIndent: 18 },
      headerStyle: { height: 50, backgroundColor: COLOR.inset, fontId: FONT.bold, textColor: COLOR.gold,
        labelY: 6, labelHeight: 20 },
      select: { local: true }, tooltipField: 'info', actions: { examine: true, info: { label: 'Drop info', field: 'rules' } },
      textColumns: [{ start: C.QUANTITY, field: 'quantity', baseY: 3 },
        { start: C.RATE, field: 'rate', baseY: 3 }, { start: C.SOURCE, field: 'source', baseY: 33, indent: true,
          header: { baseY: 27, x: 8, width: 16, height: 18 } }] },
    status: { component: C.STATUS, matches: '%total drop entries / thumbnails', empty: 'No matching known drops.', tooltipComponent: C.NOTE },
    scroll: [{ viewComponent: C.LEFT, scrollbarComponent: C.LEFT_BAR, contentHeightComponent: C.HEIGHT, contentHeight: 700 }] };
}
module.exports = { GROUP_ID, MAIN_MODAL_UID, C, DATA_COMPONENTS, ROW_HEIGHT, SLOTS, uid, DEFINITION: buildInterface() };
