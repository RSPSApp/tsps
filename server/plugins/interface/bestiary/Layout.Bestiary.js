const { TYPE_MODEL, TYPE_TEXT, TYPE_RECTANGLE, FLAG_OP1, FLAG_OP2, createWidgetGroup } = require('../widgetGroup');
const GROUP_ID = 30023;
const MAIN_MODAL_UID = (161 << 16) | 16;
const SLOTS = 40;
const GROUP_SLOTS = 24;
const C = { ROOT: 0, FRAME: 1, SEARCH: 2, SEARCH_TEXT: 3, CLEAR: 4, CLEAR_TEXT: 5, STATUS: 6,
  LIST: 7, BAR: 8, DATA: 20, GROUP_BACKGROUND: 44, GROUP_BORDER: 68, CARD: 100, BORDER: 200, MODEL: 300, NAME: 400, STATS: 500, VARIANT: 600,
  EXAMINE: 700, EXAMINE_TEXT: 800, FIND: 900, FIND_TEXT: 1000, VARIANTS: 1100, VARIANTS_TEXT: 1200 };
const DATA_COMPONENTS = Array.from({ length: 24 }, (_, index) => C.DATA + index);
const uid = component => (GROUP_ID << 16) | component;
const CARD_COMPONENTS = [C.CARD, C.MODEL, C.NAME, C.STATS, C.EXAMINE, C.EXAMINE_TEXT, C.FIND, C.FIND_TEXT, C.VARIANTS, C.VARIANTS_TEXT];
const CARD_UIDS = CARD_COMPONENTS.flatMap(start => Array.from({ length: SLOTS }, (_, i) => uid(start + i)));

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(C.ROOT, -1, { rawWidth: 18, rawHeight: 18, widthMode: 1, heightMode: 1,
    width: 494, height: 316, maxWidth: 1000, maxHeight: 1200, xPositionMode: 1, yPositionMode: 1, noClickThrough: true, suppressHoverText: true });
  add(C.FRAME, root, { widthMode: 1, heightMode: 1 });
  const text = { type: TYPE_TEXT, fontId: 494, textColor: 0xe8ded0, textShadowed: true, lineHeight: 14 };
  const active = { flags: FLAG_OP1 | FLAG_OP2, actions: ['Examine', 'Find'], examineAsOperation: true };
  add(C.SEARCH, root, { type: TYPE_RECTANGLE, rawX: 16, rawY: 34, rawWidth: 160, rawHeight: 24,
    widthMode: 1, filled: true, color: 0x211c16, flags: FLAG_OP1, actions: ['Search'] });
  add(C.SEARCH_TEXT, root, { ...text, rawX: 22, rawY: 34, rawWidth: 172, rawHeight: 24,
    widthMode: 1, yTextAlignment: 1, flags: FLAG_OP1, actions: ['Search'] });
  for (const [component, label] of [[C.CLEAR, false], [C.CLEAR_TEXT, true]]) add(component, root, {
    ...(label ? { ...text, textColor: 0xffd27f } : { type: TYPE_RECTANGLE, filled: true, color: 0x211c16, mouseOverColor: 0x493d2b }),
    rawX: 16, rawY: 34, rawWidth: 128, rawHeight: 24, xPositionMode: 2, text: 'Clear pins',
    xTextAlignment: 1, yTextAlignment: 1, flags: FLAG_OP1, actions: ['Clear pins'] });
  add(C.STATUS, root, { ...text, rawX: 16, rawY: 62, rawWidth: 32, rawHeight: 16, widthMode: 1, textColor: 0xffd27f });
  const view = add(C.LIST, root, { rawX: 16, rawY: 82, rawWidth: 52, rawHeight: 96,
    widthMode: 1, heightMode: 1, width: 442, height: 220, scrollWidth: 442, scrollHeight: 220 });
  add(C.BAR, root, { rawX: 16, rawY: 82, rawWidth: 16, rawHeight: 96, xPositionMode: 2, heightMode: 1,
    width: 16, height: 220, noClickThrough: true });
  DATA_COMPONENTS.forEach(component => add(component, root, { type: TYPE_TEXT, hidden: true, isHidden: true }));
  // Component order keeps shared frames behind every card and its controls.
  for (let i = 0; i < GROUP_SLOTS; i++) {
    add(C.GROUP_BACKGROUND + i, view, { type: TYPE_RECTANGLE, filled: true, color: 0x3a3022, hidden: true, isHidden: true });
    add(C.GROUP_BORDER + i, view, { type: TYPE_RECTANGLE, filled: false, color: 0xa88a52, hidden: true, isHidden: true });
  }
  for (let i = 0; i < SLOTS; i++) {
    add(C.CARD + i, view, { type: TYPE_RECTANGLE, rawWidth: 164, rawHeight: 160,
      filled: true, color: 0x28221b, mouseOverColor: 0x493d2b, ...active });
    add(C.BORDER + i, view, { type: TYPE_RECTANGLE, rawWidth: 164, rawHeight: 160, filled: false, color: 0x806845 });
    add(C.MODEL + i, view, { type: TYPE_MODEL, rawX: 5, rawY: 23, rawWidth: 154, rawHeight: 80,
      modelId: -1, npcFullBody: true, recycleModel: true, rotationX: 160, rotationY: 256, ...active });
    add(C.NAME + i, view, { ...text, rawX: 6, rawY: 3, rawWidth: 152, rawHeight: 18,
      fontId: 496, textColor: 0xffd27f, xTextAlignment: 1, overflowScroll: true, ...active });
    add(C.STATS + i, view, { ...text, rawX: 4, rawY: 107, rawWidth: 156, rawHeight: 22, fontId: 496, xTextAlignment: 1, yTextAlignment: 1, ...active });
    for (const [start, caption, right, label] of [[C.EXAMINE, 'Examine', false, false], [C.FIND, 'Find', true, false],
      [C.EXAMINE_TEXT, 'Examine', false, true], [C.FIND_TEXT, 'Find', true, true]]) {
      add(start + i, view, { ...(label ? { ...text, textColor: 0xffd27f } : { type: TYPE_RECTANGLE, filled: true, color: 0x3b3022, mouseOverColor: 0x54432c }),
        rawX: 5, rawY: 133, rawWidth: 72, rawHeight: 22, text: caption, xTextAlignment: 1, yTextAlignment: 1,
        flags: right ? FLAG_OP2 : FLAG_OP1, actions: right ? [null, 'Find'] : ['Examine'], examineAsOperation: !right });
    }
    for (const [start, label] of [[C.VARIANTS, false], [C.VARIANTS_TEXT, true]]) add(start + i, view, {
      ...(label ? { ...text, textColor: 0xffd27f } : { type: TYPE_RECTANGLE, filled: true, color: 0x3b3022, mouseOverColor: 0x54432c }),
      rawX: 5, rawY: 133, rawWidth: 72, rawHeight: 22, text: 'See variants', xTextAlignment: 1, yTextAlignment: 1,
      flags: FLAG_OP1, actions: ['See variants'] });
  }
  const part = (start, x, y, width, height, extra = {}) => ({ start, x, y, width, height, ...extra });
  return { groupId: GROUP_ID, widgets, preserveState: true,
    search: { inputComponent: C.SEARCH_TEXT, backgroundComponent: C.SEARCH, dataComponent: DATA_COMPONENTS[0],
      extraDataComponents: DATA_COMPONENTS.slice(1), maxLength: 50, exactNumericTerms: true, placeholder: 'Search by name or NPC ID', caret: '|', focusOnOpen: false },
    list: { viewComponent: C.LIST, scrollbarComponent: C.BAR, slotCount: SLOTS, columns: 3, rowHeight: 160,
      backgroundStart: C.CARD, iconStart: C.MODEL, labelStart: C.NAME, itemLabel: '%name <col=00ff00>(Level-%detail)</col>', clickable: true, textOnly: true, nameTarget: true,
      rowParts: [C.BORDER], collapsible: true, searchExpandsGroups: false, groupLabel: '%name <col=00ff00>(Level-%detail)</col>', leafActions: ['Examine', 'Find'],
      groupActions: ['See variants', 'Find variants'],
      rowActions: [...[C.EXAMINE, C.EXAMINE_TEXT].map(start => ({ start, leafOnly: true })), { start: C.FIND },
        { start: C.FIND_TEXT, label: 'Find', groupLabel: 'Find variants' },
        ...[C.VARIANTS, C.VARIANTS_TEXT].map(start => ({ start, groupOnly: true }))],
      textColumns: [{ start: C.STATS, field: 'stats' }], overscan: 166,
      cards: { minWidth: 158, maxColumns: 5, gap: 6, height: 160, groups: true,
        groupBackdrops: { backgroundStart: C.GROUP_BACKGROUND, borderStart: C.GROUP_BORDER, slotCount: GROUP_SLOTS, padding: 6,
          backgroundColors: [0x3a3022], borderColors: [0xa88a52] }, parts: [
        part(C.BORDER, 0, 0, 0, 160, { stretch: true }), part(C.MODEL, 5, 23, 10, 80, { stretch: true }),
        part(C.NAME, 6, 3, 12, 18, { stretch: true }), part(C.STATS, 4, 107, 8, 22, { stretch: true }),
        part(C.EXAMINE, 5, 133, 72, 22),
        part(C.EXAMINE_TEXT, 5, 133, 72, 22), part(C.FIND, -5, 133, 72, 22, { align: 'right' }),
        part(C.FIND_TEXT, -5, 133, 72, 22, { align: 'right' }),
        part(C.VARIANTS, 5, 133, 72, 22), part(C.VARIANTS_TEXT, 5, 133, 72, 22) ] } },
    status: { component: C.STATUS, matches: '%total creatures', empty: 'No matching creatures. Try another name or NPC ID.' } };
}
module.exports = { GROUP_ID, MAIN_MODAL_UID, C, SLOTS, GROUP_SLOTS, DATA_COMPONENTS, CARD_COMPONENTS, CARD_UIDS, uid, DEFINITION: buildInterface() };
