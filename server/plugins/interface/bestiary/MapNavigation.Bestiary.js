const { createWidgetGroup, TYPE_RECTANGLE, TYPE_TEXT, FLAG_OP1 } = require('../widgetGroup');

const GROUP_ID = 30024;
const WORLD_MAP_GROUP_ID = 595;
// Confirmed against worldmap's cache root with dump:widget 595. It has no mounted child interface.
const HOST_UID = WORLD_MAP_GROUP_ID << 16;
const C = { ROOT: 0, BACKGROUND: 1, TITLE: 2, STATUS: 3, POSITION: 4,
  PREVIOUS: 10, PREVIOUS_TEXT: 11, NEXT: 12, NEXT_TEXT: 13, CLEAR: 14, CLEAR_TEXT: 15 };
const uid = component => (GROUP_ID << 16) | component;
const BUTTONS = [C.PREVIOUS, C.PREVIOUS_TEXT, C.NEXT, C.NEXT_TEXT, C.CLEAR, C.CLEAR_TEXT];

function buildInterface() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);
  const root = add(C.ROOT, -1, { rawY: 54, rawWidth: 28, widthMode: 1, maxWidth: 382, rawHeight: 90,
    xPositionMode: 1, noClickThrough: true, suppressHoverText: true });
  add(C.BACKGROUND, root, { type: TYPE_RECTANGLE, widthMode: 1, heightMode: 1, filled: true, color: 0x28221b });
  const text = { type: TYPE_TEXT, fontId: 494, textColor: 0xe8ded0, textShadowed: true,
    xTextAlignment: 1, yTextAlignment: 1, rawHeight: 18 };
  add(C.TITLE, root, { ...text, rawX: 8, rawY: 4, rawWidth: 16, widthMode: 1, fontId: 496, textColor: 0xffd27f });
  add(C.STATUS, root, { ...text, rawX: 8, rawY: 24, rawWidth: 16, widthMode: 1 });
  add(C.POSITION, root, { ...text, rawX: 8, rawY: 42, rawWidth: 16, widthMode: 1, textColor: 0xb9ab96 });
  for (const [button, label, caption, mode, x, width] of [
    [C.PREVIOUS, C.PREVIOUS_TEXT, 'Previous', 0, 8, 94],
    [C.NEXT, C.NEXT_TEXT, 'Next', 2, 8, 94],
    [C.CLEAR, C.CLEAR_TEXT, 'Clear pins', 1, 0, 92],
  ]) {
    const geometry = { rawX: x, rawY: 64, rawWidth: width, rawHeight: 22, xPositionMode: mode,
      flags: FLAG_OP1, actions: [caption.replace(/[<>]/g, '').trim()] };
    add(button, root, { ...geometry, type: TYPE_RECTANGLE, filled: true, color: 0x3b3022, mouseOverColor: 0x54432c });
    add(label, root, { ...text, ...geometry, text: caption,
      textColor: 0xffd27f, mouseOverColor: 0xffffff });
  }
  return { groupId: GROUP_ID, widgets, overlay: true };
}
module.exports = { GROUP_ID, WORLD_MAP_GROUP_ID, HOST_UID, C, BUTTONS, uid, DEFINITION: buildInterface() };
