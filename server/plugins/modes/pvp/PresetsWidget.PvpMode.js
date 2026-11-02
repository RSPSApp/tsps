const {
  FLAG_OP1,
  TYPE_TEXT,
  TYPE_GRAPHIC,
  createWidgetGroup,
} = require("../../interface/widgetGroup");

const GROUP_ID = 30003;
const PRESET_TABS = ["1 Defence", "Void", "Zerker", "Tank", "Max"];
const TAB_BUTTON_START = 300;
const TAB_LABEL_START = 310;
const TAB_WIDTH = 80;
const TAB_GAP = 4;

// The root fills the modal slot it is mounted in (parent - 18 on both axes), so its size
// follows the game window. Fixed mode is the smallest that ever gets, so the layout is
// built to fit that and the button row is anchored to the bottom rather than a fixed y.
const MIN_MODAL = { width: 512 - 18, height: 334 - 18 };
const CONTENT_X = 8;
const CONTENT_RIGHT = MIN_MODAL.width - CONTENT_X;
// The frame's title bar covers the top of the group, so column headings start below it.
const HEADER_Y = 40;
const HEADER_HEIGHT = 14;
const CONTENT_Y = HEADER_Y + HEADER_HEIGHT;
const BUTTON_HEIGHT = 22;
const BUTTON_INSET_Y = 8;
const CONTENT_BOTTOM = MIN_MODAL.height - BUTTON_HEIGHT - BUTTON_INSET_Y * 2;

// Equipment slots get the cache's slot background and empty-slot silhouette; inventory
// slots are just the item, the way the real inventory draws them.
const SLOT_BACKGROUND_SPRITE = 170;
const SLOT_SHADOW = 0x333333;
const EQUIPMENT_PITCH = 36;
const INVENTORY_PITCH = 32;
// enum 904: equipment slot -> the silhouette shown while that slot is empty.
const EQUIPMENT_PLACEHOLDER_SPRITES = {
  0: 156,
  1: 157,
  2: 158,
  3: 159,
  4: 161,
  5: 162,
  7: 163,
  9: 164,
  10: 165,
  12: 160,
  13: 166,
};

// Combat levels are drawn as the skills tab draws them (script 393): a two-sprite box with
// the skill's own icon. enum 255 maps a skill to that icon.
// The box carries a diagonal divider, so the level is drawn twice - current above it and
// maximum below - at the offsets the skills tab uses, scaled to this box.
const STAT_BOX = { width: 64, height: 30, pitch: 32 };
const STAT_BOX_SPRITE_LEFT = 187;
const STAT_BOX_SPRITE_RIGHT = 188;
const STAT_ICON_SIZE = 20;
const STAT_ICON_INSET = { x: 4, y: 5 };
const STAT_LEVEL_SIZE = { width: 15, height: 12 };
const STAT_CURRENT_INSET = { x: 30, y: 2 };
const STAT_MAX_INSET = { x: 45, y: 15 };
const STAT_LEVEL_COLOUR = 0xffff00;
const STAT_SKILL_ICONS = [197, 199, 198, 203, 200, 201, 202];

const LIST_X = CONTENT_X;
const LIST_WIDTH = 128;
const LIST_SCROLLBAR_WIDTH = 16;
const ROW_PITCH = 18;

// Equipment sits above the spellbook; the combat levels are their own column beside it.
const EQUIPMENT_X = 160;
const EQUIPMENT_WIDTH = 108;
const EQUIPMENT_HEADER_Y = CONTENT_Y + 4;
const EQUIPMENT_Y = EQUIPMENT_HEADER_Y + HEADER_HEIGHT + 2;
const EQUIPMENT_COLUMNS = 3;
const EQUIPMENT_ROWS = 5;
const SPELLBOOK_Y = EQUIPMENT_Y + EQUIPMENT_ROWS * EQUIPMENT_PITCH + 8;

const STAT_X = 276;

const INVENTORY_COLUMNS = 4;
const INVENTORY_ROWS = 7;
const INVENTORY_WIDTH = INVENTORY_PITCH * INVENTORY_COLUMNS;
const INVENTORY_X = CONTENT_RIGHT - INVENTORY_WIDTH;

const BUTTON_GAP = 8;
const BUTTON_COUNT = 3;
const BUTTON_WIDTH = Math.floor(
  (CONTENT_RIGHT - CONTENT_X - (BUTTON_COUNT - 1) * BUTTON_GAP) / BUTTON_COUNT
);

// Capacity for a category's predefined presets followed by the player's own slots.
const PRESET_ROW_START = 200;
// The combat level beside each row, right-aligned at the list's edge. Numbered below the
// rows so the row's own (transparent) text does not hand it clicks; it paints through.
const PRESET_LEVEL_START = 60;
const PRESET_LEVEL_WIDTH = 30;
const PRESET_LEVEL_RIGHT_GAP = 5;
const PRESET_DATA = require("../data/pvp-presets-players.json");
const GLOBAL_ROW_COUNT = PRESET_DATA.length;
const CUSTOM_ROW_COUNT = 10;
const PRESET_ROW_COUNT = Math.max(...PRESET_TABS.map((tab) =>
  PRESET_DATA.filter((preset) => (preset.tab ?? PRESET_TABS[0]) === tab).length
)) + CUSTOM_ROW_COUNT;

// The client sorts a parent's children by fileId and paints them in that order, so a
// slot's background must number below its icon or it covers it.
const INVENTORY_SLOT_START = 100;
const INVENTORY_SLOT_COUNT = 28;

// Equipment is laid out the way the equipment tab does it, keyed by the cache's wearPos so
// a slot's component is always EQUIPMENT_SLOT_START + wearPos.
const EQUIPMENT_BACKGROUND_START = 140;
const EQUIPMENT_PLACEHOLDER_START = 160;
const EQUIPMENT_SLOT_START = 180;
const EQUIPMENT_LAYOUT = [
  { slot: 0, column: 1, row: 0 }, // head
  { slot: 1, column: 0, row: 1 }, // cape
  { slot: 2, column: 1, row: 1 }, // amulet
  { slot: 13, column: 2, row: 1 }, // ammo
  { slot: 3, column: 0, row: 2 }, // weapon
  { slot: 4, column: 1, row: 2 }, // body
  { slot: 5, column: 2, row: 2 }, // shield
  { slot: 7, column: 1, row: 3 }, // legs
  { slot: 9, column: 0, row: 4 }, // hands
  { slot: 10, column: 1, row: 4 }, // feet
  { slot: 12, column: 2, row: 4 }, // ring
];
const EQUIPMENT_SLOTS = EQUIPMENT_LAYOUT.map((entry) => entry.slot);

function addEquipmentWidgets(add, parent, x, y, options = {}) {
  const backgroundStart = options.backgroundStart ?? EQUIPMENT_BACKGROUND_START;
  const placeholderStart = options.placeholderStart ?? EQUIPMENT_PLACEHOLDER_START;
  const itemStart = options.itemStart ?? EQUIPMENT_SLOT_START;
  const columnPitch = options.columnPitch ?? EQUIPMENT_PITCH;
  const rowPitch = options.rowPitch ?? EQUIPMENT_PITCH;
  for (const { slot, column, row } of EQUIPMENT_LAYOUT) {
    const slotX = x + column * columnPitch;
    const slotY = y + row * rowPitch;
    add(backgroundStart + slot, parent, {
      type: TYPE_GRAPHIC, rawX: slotX, rawY: slotY, rawWidth: 36, rawHeight: 36,
      width: 36, height: 36, spriteId: SLOT_BACKGROUND_SPRITE,
    });
    add(placeholderStart + slot, parent, {
      type: TYPE_GRAPHIC, rawX: slotX, rawY: slotY + 2, rawWidth: 32, rawHeight: 32,
      width: 32, height: 32, spriteId: EQUIPMENT_PLACEHOLDER_SPRITES[slot],
    });
    add(itemStart + slot, parent, {
      type: TYPE_GRAPHIC, rawX: slotX, rawY: slotY + 2, rawWidth: 36, rawHeight: 32,
      width: 36, height: 32, itemQuantityMode: 2, borderType: 1,
      graphicShadow: SLOT_SHADOW, shadowColor: SLOT_SHADOW, text: "",
    });
  }
}

const STAT_ROW_COUNT = STAT_SKILL_ICONS.length;
const STAT_BOX_LEFT_START = 240;
const STAT_BOX_RIGHT_START = 250;
const STAT_ICON_START = 260;
const STAT_ROW_START = 270;
const STAT_MAX_ROW_START = 280;

const COMPONENT = {
  ROOT: 0,
  FRAME: 1,
  LIST_HEADER: 10,
  EQUIPMENT_HEADER: 13,
  INVENTORY_HEADER: 14,
  LIST_VIEW: 15,
  LIST_SCROLLBAR: 16,
  SELECTED_NAME: 30,
  SPELLBOOK: 31,
  LIST_CONTENT_HEIGHT: 32,
  TAB_BAR: 33,
  LOAD_BUTTON: 40,
  SAVE_BUTTON: 41,
  DEATH_BUTTON: 43,
};

const uid = (component) => (GROUP_ID << 16) | component;

const LIST_HEIGHT = CONTENT_BOTTOM - CONTENT_Y;
const LIST_CONTENT_HEIGHT = PRESET_ROW_COUNT * ROW_PITCH + 4;

const FONT_SMALL = 494;
const FONT_BOLD = 496;
const COLOUR_HEADER = 0xffd27f;
const COLOUR_TEXT = 0xe8ded0;
const COLOUR_MUTED = 0xc5b79b;
const BUTTON_COLOUR = 0x2b241b;
const BUTTON_HOVER_COLOUR = 0x3a3125;
// RGB555-aligned shades so definitions and native colour updates display identically.
const TAB_COLOUR = 0x282018;
const TAB_ACTIVE_COLOUR = 0x201810;

function buildPresetsWidgetGroup() {
  const { widgets, add } = createWidgetGroup(GROUP_ID);

  const root = add(COMPONENT.ROOT, -1, {
    rawWidth: 18,
    rawHeight: 18,
    widthMode: 1,
    heightMode: 1,
    width: MIN_MODAL.width,
    height: MIN_MODAL.height,
    xPositionMode: 1,
    yPositionMode: 1,
  });
  add(COMPONENT.FRAME, root, {
    widthMode: 1,
    heightMode: 1,
    width: MIN_MODAL.width,
    height: MIN_MODAL.height,
  });
  const tabBar = add(COMPONENT.TAB_BAR, root, {
    rawX: -12, rawY: 6, xPositionMode: 1,
    rawWidth: PRESET_TABS.length * (TAB_WIDTH + TAB_GAP) - TAB_GAP,
    rawHeight: BUTTON_HEIGHT,
  });
  PRESET_TABS.forEach((name, index) => {
    add(TAB_BUTTON_START + index, tabBar, {
      type: 3, rawX: index * (TAB_WIDTH + TAB_GAP), rawWidth: TAB_WIDTH, rawHeight: BUTTON_HEIGHT,
      filled: true, color: index === 0 ? TAB_ACTIVE_COLOUR : TAB_COLOUR,
      textColor: index === 0 ? TAB_ACTIVE_COLOUR : TAB_COLOUR,
      mouseOverColor: TAB_ACTIVE_COLOUR, actions: ["Select"], flags: FLAG_OP1,
    });
    add(TAB_LABEL_START + index, tabBar, {
      type: TYPE_TEXT, rawX: index * (TAB_WIDTH + TAB_GAP), rawWidth: TAB_WIDTH, rawHeight: BUTTON_HEIGHT,
      fontId: FONT_BOLD, text: name, textColor: index === 0 ? 0xffffff : COLOUR_HEADER,
      textShadowed: true, xTextAlignment: 1, yTextAlignment: 1,
    });
  });
  add(COMPONENT.LIST_CONTENT_HEIGHT, root, { type: TYPE_TEXT, isHidden: true, hidden: true, text: String(LIST_CONTENT_HEIGHT) });

  const header = (component, parent, x, y, width, text) =>
    add(component, parent, {
      type: TYPE_TEXT,
      rawX: x,
      rawY: y,
      rawWidth: width,
      rawHeight: HEADER_HEIGHT,
      width,
      height: HEADER_HEIGHT,
      text,
      fontId: FONT_BOLD,
      textColor: COLOUR_HEADER,
      textShadowed: true,
      yTextAlignment: 1,
    });

  const label = (component, parent, x, y, width, overrides = {}) =>
    add(component, parent, {
      type: TYPE_TEXT,
      rawX: x,
      rawY: y,
      rawWidth: width,
      rawHeight: 15,
      width,
      height: 15,
      text: "",
      fontId: FONT_SMALL,
      textColor: COLOUR_TEXT,
      textShadowed: true,
      yTextAlignment: 1,
      ...overrides,
    });

  const graphic = (component, x, y, width, height, spriteId, overrides = {}) =>
    add(component, root, {
      type: TYPE_GRAPHIC,
      rawX: x,
      rawY: y,
      rawWidth: width,
      rawHeight: height,
      width,
      height,
      spriteId,
      ...overrides,
    });

  /**
   * A slot is background, then the empty-slot silhouette, then the item icon. They are
   * numbered in that order because the client paints a parent's children by fileId.
   */
  const slot = (iconComponent, x, y, pitch, background) => {
    const cell = pitch - 2;
    if (background) {
      graphic(background.component, x, y, cell, cell, SLOT_BACKGROUND_SPRITE);
      const inset = Math.floor((cell - (cell - 8)) / 2);
      graphic(
        background.placeholderComponent,
        x + inset,
        y + inset,
        cell - 8,
        cell - 8,
        background.placeholderSpriteId
      );
    }
    graphic(iconComponent, x + 1, y + 2, cell - 2, cell - 6, -1, {
      itemQuantityMode: 2,
      borderType: 1,
      graphicShadow: SLOT_SHADOW,
      shadowColor: SLOT_SHADOW,
      text: "",
    });
  };

  const button = (component, x, insetY, width) => {
    add(component, root, {
      type: 3,
      rawX: x,
      rawY: insetY,
      yPositionMode: 2,
      rawWidth: width,
      rawHeight: BUTTON_HEIGHT,
      width,
      height: BUTTON_HEIGHT,
      filled: true,
      color: BUTTON_COLOUR,
      mouseOverColor: BUTTON_HOVER_COLOUR,
      textColor: BUTTON_COLOUR,
      opacity: 32,
      actions: ["Select"],
      flags: FLAG_OP1,
    });
    // Server-set label, so a button can say what it currently does.
    label(component + 50, root, x, insetY + 4, width, {
      xTextAlignment: 1,
      textColor: COLOUR_HEADER,
      yPositionMode: 2,
    });
  };

  // One scrolling column of presets. The rows are children of the view, so the client
  // scrolls them natively; adding presets only makes the column longer.
  header(COMPONENT.LIST_HEADER, root, LIST_X, HEADER_Y, LIST_WIDTH, "Presets");
  const listView = add(COMPONENT.LIST_VIEW, root, {
    rawX: LIST_X,
    rawY: CONTENT_Y,
    rawWidth: LIST_WIDTH,
    rawHeight: LIST_HEIGHT,
    width: LIST_WIDTH,
    height: LIST_HEIGHT,
    scrollWidth: LIST_WIDTH,
    scrollHeight: LIST_CONTENT_HEIGHT,
  });
  add(COMPONENT.LIST_SCROLLBAR, root, {
    rawX: LIST_X + LIST_WIDTH,
    rawY: CONTENT_Y,
    rawWidth: LIST_SCROLLBAR_WIDTH,
    rawHeight: LIST_HEIGHT,
    width: LIST_SCROLLBAR_WIDTH,
    height: LIST_HEIGHT,
    noClickThrough: true,
  });
  for (let row = 0; row < PRESET_ROW_COUNT; row++) {
    label(PRESET_ROW_START + row, listView, 0, row * ROW_PITCH, LIST_WIDTH, {
      textColor: COLOUR_MUTED,
      actions: ["Select"],
      flags: FLAG_OP1,
    });
    label(PRESET_LEVEL_START + row, listView, LIST_WIDTH - PRESET_LEVEL_WIDTH - PRESET_LEVEL_RIGHT_GAP, row * ROW_PITCH, PRESET_LEVEL_WIDTH, {
      xTextAlignment: 2,
      textColor: COLOUR_MUTED,
    });
  }

  // The selected preset: its name across the middle, then its equipment and spellbook.
  header(
    COMPONENT.SELECTED_NAME,
    root,
    EQUIPMENT_X,
    HEADER_Y,
    STAT_X + STAT_BOX.width - EQUIPMENT_X,
    ""
  );
  header(
    COMPONENT.EQUIPMENT_HEADER,
    root,
    EQUIPMENT_X,
    EQUIPMENT_HEADER_Y,
    EQUIPMENT_WIDTH,
    "Equipment"
  );
  const equipmentX =
    EQUIPMENT_X + Math.floor((EQUIPMENT_WIDTH - EQUIPMENT_COLUMNS * EQUIPMENT_PITCH) / 2);
  addEquipmentWidgets(add, root, equipmentX, EQUIPMENT_Y);
  label(COMPONENT.SPELLBOOK, root, EQUIPMENT_X, SPELLBOOK_Y, EQUIPMENT_WIDTH, {
    textColor: COLOUR_MUTED,
    xTextAlignment: 1,
  });

  // Combat levels, one boxed row per skill, drawn the way the skills tab draws them.
  for (let index = 0; index < STAT_ROW_COUNT; index++) {
    const y = CONTENT_Y + index * STAT_BOX.pitch;
    const halfWidth = Math.ceil(STAT_BOX.width / 2) + 2;
    graphic(STAT_BOX_LEFT_START + index, STAT_X, y, halfWidth, STAT_BOX.height, STAT_BOX_SPRITE_LEFT);
    graphic(
      STAT_BOX_RIGHT_START + index,
      STAT_X + STAT_BOX.width - halfWidth,
      y,
      halfWidth,
      STAT_BOX.height,
      STAT_BOX_SPRITE_RIGHT
    );
    graphic(
      STAT_ICON_START + index,
      STAT_X + STAT_ICON_INSET.x,
      y + STAT_ICON_INSET.y,
      STAT_ICON_SIZE,
      STAT_ICON_SIZE,
      STAT_SKILL_ICONS[index]
    );
    for (const [component, inset] of [
      [STAT_ROW_START + index, STAT_CURRENT_INSET],
      [STAT_MAX_ROW_START + index, STAT_MAX_INSET],
    ]) {
      label(component, root, STAT_X + inset.x, y + inset.y, STAT_LEVEL_SIZE.width, {
        rawHeight: STAT_LEVEL_SIZE.height,
        height: STAT_LEVEL_SIZE.height,
        textColor: STAT_LEVEL_COLOUR,
        xTextAlignment: 1,
      });
    }
  }

  // The selected preset's inventory - plain item slots, no slot art.
  header(COMPONENT.INVENTORY_HEADER, root, INVENTORY_X, HEADER_Y, INVENTORY_WIDTH, "Inventory");
  for (let index = 0; index < INVENTORY_SLOT_COUNT; index++) {
    slot(
      INVENTORY_SLOT_START + index,
      INVENTORY_X + (index % INVENTORY_COLUMNS) * INVENTORY_PITCH,
      CONTENT_Y + Math.floor(index / INVENTORY_COLUMNS) * INVENTORY_PITCH,
      INVENTORY_PITCH,
      null
    );
  }

  // One row of buttons, anchored to the bottom of whatever height the modal has.
  const buttonX = (index) => CONTENT_X + index * (BUTTON_WIDTH + BUTTON_GAP);
  button(COMPONENT.LOAD_BUTTON, buttonX(0), BUTTON_INSET_Y, BUTTON_WIDTH);
  button(COMPONENT.SAVE_BUTTON, buttonX(1), BUTTON_INSET_Y, BUTTON_WIDTH);
  button(COMPONENT.DEATH_BUTTON, buttonX(2), BUTTON_INSET_Y, BUTTON_WIDTH);

  return { groupId: GROUP_ID, widgets };
}

function buildPresetsInterfaceDefinition() {
  return {
    ...buildPresetsWidgetGroup(),
    scroll: [
      {
        viewComponent: COMPONENT.LIST_VIEW,
        scrollbarComponent: COMPONENT.LIST_SCROLLBAR,
        contentHeight: LIST_CONTENT_HEIGHT,
        contentHeightComponent: COMPONENT.LIST_CONTENT_HEIGHT,
        resetOnComponents: PRESET_TABS.map((_, index) => TAB_BUTTON_START + index),
      },
    ],
  };
}

module.exports = {
  GROUP_ID,
  PRESET_TABS,
  TAB_BUTTON_START,
  TAB_LABEL_START,
  TAB_COLOUR,
  TAB_ACTIVE_COLOUR,
  ROW_PITCH,
  COMPONENT,
  CONTENT_X,
  CONTENT_RIGHT,
  CONTENT_BOTTOM,
  MIN_MODAL,
  // Components that are meant to sit on top of each other: a slot's icon and placeholder
  // over its own background, a stat box's icon and level over its two halves, and a
  // button's label over its own button.
  LAYERED_COMPONENT_PAIRS: [
    ...PRESET_TABS.map((_, index) => [TAB_BUTTON_START + index, TAB_LABEL_START + index]),
    ...EQUIPMENT_SLOTS.flatMap((slot) => [
      [EQUIPMENT_SLOT_START + slot, EQUIPMENT_BACKGROUND_START + slot],
      [EQUIPMENT_PLACEHOLDER_START + slot, EQUIPMENT_BACKGROUND_START + slot],
      [EQUIPMENT_PLACEHOLDER_START + slot, EQUIPMENT_SLOT_START + slot],
    ]),
    ...Array.from({ length: STAT_ROW_COUNT }, (_, index) => index).flatMap((index) => [
      [STAT_BOX_LEFT_START + index, STAT_BOX_RIGHT_START + index],
      [STAT_ICON_START + index, STAT_BOX_LEFT_START + index],
      [STAT_ICON_START + index, STAT_BOX_RIGHT_START + index],
      [STAT_ROW_START + index, STAT_BOX_LEFT_START + index],
      [STAT_ROW_START + index, STAT_BOX_RIGHT_START + index],
      [STAT_ROW_START + index, STAT_ICON_START + index],
      [STAT_MAX_ROW_START + index, STAT_BOX_LEFT_START + index],
      [STAT_MAX_ROW_START + index, STAT_BOX_RIGHT_START + index],
      [STAT_MAX_ROW_START + index, STAT_ICON_START + index],
    ]),
    ...[
      COMPONENT.LOAD_BUTTON,
      COMPONENT.SAVE_BUTTON,
      COMPONENT.DEATH_BUTTON,
    ].map((component) => [component, component + 50]),
  ],
  PRESET_ROW_START,
  PRESET_LEVEL_START,
  PRESET_ROW_COUNT,
  GLOBAL_ROW_COUNT,
  CUSTOM_ROW_COUNT,
  INVENTORY_SLOT_START,
  INVENTORY_SLOT_COUNT,
  EQUIPMENT_BACKGROUND_START,
  EQUIPMENT_SLOT_START,
  EQUIPMENT_PLACEHOLDER_START,
  EQUIPMENT_SLOTS,
  addEquipmentWidgets,
  STAT_ROW_START,
  STAT_MAX_ROW_START,
  STAT_ROW_COUNT,
  LIST_CONTENT_HEIGHT,
  uid,
  buildPresetsWidgetGroup,
  buildPresetsInterfaceDefinition,
};
