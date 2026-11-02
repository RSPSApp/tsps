/**
 * Builds widget groups for interfaces that do not exist in the game cache.
 *
 * The client's widget nodes carry a lot of fields; every component needs all of them, so
 * this fills in the defaults and lets a caller describe only what differs. The finished
 * group is handed to api.registerCustomInterface and served from /api/interfaces/<groupId>.
 */

// actions[i] is op i+1 client-side (inferWidgetOpId), and each op needs its transmit bit
// set in flags or the client will not send the click.
const FLAG_OP1 = 1 << 1;
const FLAG_OP2 = 1 << 2;
const FLAG_OP3 = 1 << 3;

/** Every if_setevents bit by the name rsprox prints: the ten ops, then the target kinds. */
const EVENT_FLAGS = Object.freeze({
  OP1: FLAG_OP1, OP2: FLAG_OP2, OP3: FLAG_OP3, OP4: 1 << 4, OP5: 1 << 5, OP6: 1 << 6, OP7: 1 << 7, OP8: 1 << 8, OP9: 1 << 9, OP10: 1 << 10,
  TGTOBJ: 1 << 11, TGTNPC: 1 << 12, TGTLOC: 1 << 13, TGTPLAYER: 1 << 14, TGTINV: 1 << 15, TGTCOM: 1 << 16,
});

/** The flags value for a capture's event list (`["OP1", "TGTNPC"]`). */
function eventFlags(names) {
  return names.reduce((bits, name) => bits | (EVENT_FLAGS[name] ?? 0), 0);
}

const TYPE_LAYER = 0;
const TYPE_RECTANGLE = 3;
const TYPE_TEXT = 4;
const TYPE_GRAPHIC = 5;
const TYPE_MODEL = 6;

function createWidgetGroup(groupId) {
  const widgets = [];
  const uid = (component) => (groupId << 16) | component;

  const add = (component, parent, overrides = {}) => {
    const id = uid(component);
    widgets.push({
      uid: id,
      id,
      childIndex: -1,
      parentUid: parent,
      groupId,
      fileId: component,
      isIf3: true,
      type: TYPE_LAYER,
      contentType: 0,
      rawX: 0,
      rawY: 0,
      rawWidth: 0,
      rawHeight: 0,
      widthMode: 0,
      heightMode: 0,
      xPositionMode: 0,
      yPositionMode: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      scrollX: 0,
      scrollY: 0,
      scrollWidth: 0,
      scrollHeight: 0,
      isHidden: false,
      hidden: false,
      cachedHidden: false,
      rootIndex: -1,
      cycle: -1,
      modelFrame: 0,
      modelFrameCycle: 0,
      aspectWidth: 1,
      aspectHeight: 1,
      itemId: -1,
      itemQuantity: 0,
      ...overrides,
    });
    return id;
  };

  return { groupId, widgets, uid, add };
}

/** if_triggeroplocal (a script trigger's) arguments as the client packs them: ints as zigzag varints. */
function triggerInts(argsData) {
  const ints = [];
  let value = 0;
  let shift = 0;
  for (const byte of argsData ?? []) {
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) !== 0) continue;
    ints.push((value >>> 1) ^ -(value & 1));
    value = 0;
    shift = 0;
  }
  return ints;
}

/**
 * A script trigger's arguments as plain unsigned varints (7 bits a byte, low first): how the real
 * client writes an int array argument ("*"), its length and then each element, as the pact tree's
 * Apply Changes sends it (RuneLite through the gateway: [1, 126] is one node, component 126;
 * recordings 237/238: [2, 88, 94], [1, -44, 1] = 212).
 */
function triggerVarints(argsData) {
  const ints = [];
  let value = 0;
  let shift = 0;
  for (const byte of argsData ?? []) {
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) !== 0) continue;
    ints.push(value >>> 0);
    value = 0;
    shift = 0;
  }
  return ints;
}

module.exports = {
  triggerInts,
  triggerVarints,
  FLAG_OP1,
  FLAG_OP2,
  FLAG_OP3,
  EVENT_FLAGS,
  eventFlags,
  TYPE_LAYER,
  TYPE_RECTANGLE,
  TYPE_TEXT,
  TYPE_GRAPHIC,
  TYPE_MODEL,
  createWidgetGroup,
};
