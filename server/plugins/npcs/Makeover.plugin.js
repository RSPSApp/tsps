"use strict";

/**
 * The makeover interface (516, `makeover`) that clothes, hair and shoe providers open, as captured
 * (docs/makeover.md): the server sets varbit makeover_interface_type to the category, varp
 * makeover_colour / makeover_hair to the player's current colour and style, opens the main modal
 * with click events sized to the category's style and colour lists, and plays the changing-booth
 * map anim on the player's tile every tick while it is open.
 *
 * A style or colour click previews on the player's own appearance; Apply (makeover:select) and
 * Confirm (makeover:select_and_close) keep it, closing any other way restores what was worn.
 * The burger menu switches category from any provider; hair and facial hair refuse a worn hat.
 *
 * Categories, in the order of the client's makeover_init (script 6776) switch on the varbit:
 * each names the enum of style dbrows (player_kit_id_type_a / _type_b by body type), the colour
 * enum whose size sizes the colour grid, and the appearance slots they change.
 */

/** Players with the interface open: { type, saved look, style kits, booth task, switching }. */
const sessions = new WeakMap();

const TYPE_HAIR = 0;
const TYPE_FACIAL_HAIR = 1;
const TYPE_BODY = 2;
const TYPE_TOP = 3;
const TYPE_ARMS = 4;
const TYPE_LEGS = 5;
const TYPE_SHOES = 6;
const TYPE_WRISTWEAR = 7;

/** makeover_init: enum18 (styles, int -> dbrow) and enum16 (colour rgbs) per category. */
const ENUM_HAIR_STYLES = 496;
const ENUM_FACIAL_HAIR_STYLES = 2630;
const ENUM_TORSO_STYLES = 5495;
const ENUM_SLEEVE_STYLES = 5496;
const ENUM_LEGGING_STYLES = 5497;
const ENUM_SHOE_STYLES = 5498;
const ENUM_HAND_STYLES = 5499;
const ENUM_HAIR_COLOURS = 890;
const ENUM_TORSO_COLOURS = 789;
const ENUM_LEG_COLOURS = 791;
const ENUM_SHOE_COLOURS = 5290;

/** makeover_draw_item makes 5 components per style, makeover_draw_colours 2 per colour. */
const COMPONENTS_PER_STYLE = 5;
const COMPONENTS_PER_COLOUR = 2;
/** makeover_create_dropdown: the category entries' clickable text components, Hair (10) to Wristwear (24). */
const BURGER_FIRST_SLOT = 10;
const BURGER_LAST_SLOT = 24;
const BURGER_SLOT_STRIDE = 2;
/** The captured if_setevents range of the select / select_and_close buttons. */
const BUTTON_LAST_SLOT = 10;
/** if_setevents OP1. */
const FLAGS_OP1 = 1 << 1;

const HAT_REFUSAL = "You should take off your hat if you want to get a haircut!";

/** Captured messages on Confirm; the clothes categories had none in any capture. */
const APPLIED_MESSAGES = {
  [TYPE_HAIR]: "You get a fresh, new haircut!",
  [TYPE_FACIAL_HAIR]: "You get a nice, clean trim!",
  [TYPE_SHOES]: "You get a nice, new pair of shoes!",
};

const THESSALIA_TITLE = "A makeover is free!";
const THESSALIA_OPTIONS = [
  ["Change your top.", TYPE_TOP],
  ["Change your bottoms.", TYPE_LEGS],
  ["Change your wristwear.", TYPE_WRISTWEAR],
];
const CANCEL_OPTION = "Cancel.";

let core = null;
let api = null;
let cached = null;

/** Cache ids by gameval name, looked up once. */
function ids() {
  if (cached) return cached;
  const { CacheDefinitions } = core;
  const need = (kind, name, id) => {
    if (id === null || id === undefined) throw new Error(`Makeover: the cache has no ${kind} ${name}`);
    return id;
  };
  const component = (name) => need("component", `makeover:${name}`, CacheDefinitions.getComponentId(`makeover:${name}`));
  cached = {
    group: need("interface", "makeover", CacheDefinitions.getInterfaceId("makeover")),
    itemArea: component("item_area"),
    colours: component("colours"),
    select: component("select"),
    selectAndClose: component("select_and_close"),
    burgerMenuFrame: component("burger_menu_frame"),
    typeVarbit: need("varbit", "makeover_interface_type", CacheDefinitions.getVarbitId("makeover_interface_type")),
    colourVarp: need("varp", "makeover_colour", CacheDefinitions.getVarpId("makeover_colour")),
    styleVarp: need("varp", "makeover_hair", CacheDefinitions.getVarpId("makeover_hair")),
    boothSpotanim: need("spotanim", "makeover_changing_booth_idle", CacheDefinitions.getSpotanimId("makeover_changing_booth_idle")),
  };
  return cached;
}

/** A category's style enum, colour enum and the appearance slots it changes. */
function category(type) {
  const A = core.Appearance;
  switch (type) {
    case TYPE_HAIR: return { styles: ENUM_HAIR_STYLES, colours: ENUM_HAIR_COLOURS, slot: A.HEAD, colourSlot: A.HAIR_COLOUR };
    case TYPE_FACIAL_HAIR: return { styles: ENUM_FACIAL_HAIR_STYLES, colours: ENUM_HAIR_COLOURS, slot: A.BEARD, colourSlot: A.HAIR_COLOUR };
    case TYPE_TOP: return { styles: ENUM_TORSO_STYLES, colours: ENUM_TORSO_COLOURS, slot: A.CHEST, colourSlot: A.TORSO_COLOUR };
    case TYPE_ARMS: return { styles: ENUM_SLEEVE_STYLES, colours: ENUM_TORSO_COLOURS, slot: A.ARMS, colourSlot: A.TORSO_COLOUR };
    case TYPE_LEGS: return { styles: ENUM_LEGGING_STYLES, colours: ENUM_LEG_COLOURS, slot: A.LEGS, colourSlot: A.LEG_COLOUR };
    case TYPE_SHOES: return { styles: ENUM_SHOE_STYLES, colours: ENUM_SHOE_COLOURS, slot: A.FEET, colourSlot: A.FEET_COLOUR };
    case TYPE_WRISTWEAR: return { styles: ENUM_HAND_STYLES, colours: null, slot: A.HANDS, colourSlot: -1 };
    default: return null;
  }
}

/** The identity kits of a category's styles in list order, for the player's body type (-1 unreadable). */
function styleKits(player, type) {
  const { CacheDefinitions } = core;
  const rows = CacheDefinitions.getEnumValues(category(type).styles);
  const column = isBodyTypeB(player) ? "player_kit_id_type_b" : "player_kit_id_type_a";
  const kits = [];
  for (let index = 0; index < rows.size; index++) {
    const row = CacheDefinitions.getDbRow(Number(rows.get(index)));
    const columnId = row ? CacheDefinitions.getDbColumn(row.tableId, column) : null;
    kits.push(columnId === null ? -1 : row.int(columnId, -1));
  }
  return kits;
}

function isBodyTypeB(player) {
  return !player.getAppearance().isMale();
}

function colourCount(type) {
  const { colours } = category(type);
  return colours === null ? 0 : core.CacheDefinitions.getEnumValues(colours).size;
}

function hasHat(player) {
  return !!headItem(player);
}

function headItem(player) {
  const item = player.getEquipment().getItems()[core.Equipment.HEAD_SLOT];
  return item && item.getId() > 0 ? item : null;
}

function refuseHat(player) {
  const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, headItem(player).getId(), HAT_REFUSAL),
    new EndDialogue(1),
  ));
}

/**
 * Opens (or switches) the makeover interface on a category. Exported for other providers: the
 * hairdresser opens TYPE_HAIR / TYPE_FACIAL_HAIR, Yrsa TYPE_SHOES.
 */
function openMakeover(player, type) {
  if (!category(type)) return false;
  if ((type === TYPE_HAIR || type === TYPE_FACIAL_HAIR) && hasHat(player)) {
    closeMakeover(player);
    refuseHat(player);
    return true;
  }
  const { group, itemArea, colours, select, selectAndClose, burgerMenuFrame, typeVarbit, colourVarp, styleVarp } = ids();
  const sender = player.getPacketSender();
  const look = player.getAppearance().getLook();
  const previous = sessions.get(player);
  const saved = previous ? previous.saved : [...look];
  if (previous) {
    // Switching category starts from what is worn, as reopening the modal does.
    restoreLook(player, saved);
    previous.switching = true;
    sender.sendInterfaceRemoval();
    previous.switching = false;
  }
  const { slot, colourSlot } = category(type);
  const kits = styleKits(player, type);
  const current = Math.max(0, kits.indexOf(look[slot]));
  if (colourSlot >= 0) sender.sendConfig(colourVarp, look[colourSlot]);
  sender.sendVarbit(typeVarbit, type);
  // The client highlights the style whose first component equals this, until a click.
  sender.sendConfig(styleVarp, current * COMPONENTS_PER_STYLE);
  sender.sendInterface(group);
  sender.sendInterfaceFlagsRange(itemArea, 0, kits.length * COMPONENTS_PER_STYLE, FLAGS_OP1);
  const count = colourCount(type);
  if (count > 0) sender.sendInterfaceFlagsRange(colours, 0, count * COMPONENTS_PER_COLOUR, FLAGS_OP1);
  sender.sendInterfaceFlagsRange(select, 0, BUTTON_LAST_SLOT, FLAGS_OP1);
  sender.sendInterfaceFlagsRange(selectAndClose, 0, BUTTON_LAST_SLOT, FLAGS_OP1);
  sender.sendInterfaceFlagsRange(burgerMenuFrame, BURGER_FIRST_SLOT, BURGER_LAST_SLOT, FLAGS_OP1);
  const state = { type, saved, kits, task: previous?.task ?? startBooth(player), switching: false };
  sessions.set(player, state);
  return true;
}

/** makeover_changing_booth_idle on the player's tile each tick while the interface is open. */
function startBooth(player) {
  const { Task, TaskManager, Graphic } = core;
  const { boothSpotanim } = ids();
  const task = new (class MakeoverBoothTask extends Task {
    constructor() { super(1, player); }
    execute() {
      if (!sessions.has(player) || !player.isRegistered?.()) {
        this.stop();
        return;
      }
      player.getPacketSender().sendGlobalGraphic(new Graphic(boothSpotanim), player.getLocation());
    }
  })();
  TaskManager.submit(task);
  return task;
}

function restoreLook(player, saved) {
  const appearance = player.getAppearance();
  appearance.setLookArray([...saved]);
}

function closeMakeover(player) {
  if (sessions.has(player)) player.getPacketSender().sendInterfaceRemoval();
}

/** makeover:item_area: preview the clicked style (5 components per style). */
function previewStyle({ player, slot }) {
  const state = sessions.get(player);
  const index = Math.floor(Number(slot) / COMPONENTS_PER_STYLE);
  if (!state || !Number.isInteger(index) || index < 0 || index >= state.kits.length || state.kits[index] < 0) return false;
  player.getAppearance().setLook(category(state.type).slot, state.kits[index]);
  player.getPacketSender().sendConfig(ids().styleVarp, index);
  return true;
}

/** makeover:colours: preview the clicked colour (2 components per colour). */
function previewColour({ player, slot }) {
  const state = sessions.get(player);
  if (!state) return false;
  const { colourSlot } = category(state.type);
  const index = Math.floor(Number(slot) / COMPONENTS_PER_COLOUR);
  if (colourSlot < 0 || !Number.isInteger(index) || index < 0 || index >= colourCount(state.type)) return false;
  player.getAppearance().setLook(colourSlot, index);
  player.getPacketSender().sendConfig(ids().colourVarp, index);
  return true;
}

function keep(player, state) {
  state.saved = [...player.getAppearance().getLook()];
  const message = APPLIED_MESSAGES[state.type];
  if (message) player.sendMessage(message);
}

/** makeover:select ("Apply"): keep the preview, stay open. */
function apply({ player }) {
  const state = sessions.get(player);
  if (!state) return false;
  keep(player, state);
  return true;
}

/** makeover:select_and_close ("Confirm"): keep the preview and close. */
function confirm({ player }) {
  const state = sessions.get(player);
  if (!state) return false;
  keep(player, state);
  closeMakeover(player);
  return true;
}

/** makeover:burger_menu_frame: switch category (Hair 10 ... Wristwear 24, every other slot). */
function switchCategory({ player, slot }) {
  const state = sessions.get(player);
  const offset = Number(slot) - BURGER_FIRST_SLOT;
  if (!state || !Number.isInteger(offset) || offset < 0 || offset % BURGER_SLOT_STRIDE !== 0) return false;
  const type = offset / BURGER_SLOT_STRIDE;
  if (type === TYPE_BODY) {
    // Live opens makeover_mage (205) here; the server's body type designer is the Makeover Mage's.
    closeMakeover(player);
    api.emitCustomEvent("makeover-mage:open", { player });
    return true;
  }
  return openMakeover(player, type);
}

/** Closed by any route but a category switch: put back what was worn unless it was kept. */
function closed({ player, interfaceId }) {
  const state = sessions.get(player);
  if (!state || state.switching || !cached || interfaceId !== cached.group) return;
  sessions.delete(player);
  state.task?.stop();
  const look = player.getAppearance().getLook();
  if (state.saved.some((value, index) => value !== look[index])) restoreLook(player, state.saved);
}

/** Thessalia's Makeover option: the captured chat menu of her three categories. */
function thessaliaMakeover({ player }) {
  const pairs = [];
  for (const [text, type] of THESSALIA_OPTIONS) pairs.push(text, () => openMakeover(player, type));
  pairs.push(CANCEL_OPTION, () => {});
  api.sendMultiChatboxPrompt(player, THESSALIA_TITLE, ...pairs);
  return true;
}

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "Makeover",
  openMakeover,
  TYPES: Object.freeze({
    HAIR: TYPE_HAIR, FACIAL_HAIR: TYPE_FACIAL_HAIR, TOP: TYPE_TOP, ARMS: TYPE_ARMS,
    LEGS: TYPE_LEGS, SHOES: TYPE_SHOES, WRISTWEAR: TYPE_WRISTWEAR,
  }),
  register(pluginApi) {
    init(pluginApi);
    pluginApi.onNpcInteraction("Thessalia", { Makeover: thessaliaMakeover });
    pluginApi.onInterfaceActionButton(ids().itemArea, previewStyle);
    pluginApi.onInterfaceActionButton(ids().colours, previewColour);
    pluginApi.onInterfaceActionButton(ids().select, apply);
    pluginApi.onInterfaceActionButton(ids().selectAndClose, confirm);
    pluginApi.onInterfaceActionButton(ids().burgerMenuFrame, switchCategory);
    pluginApi.onCustomEvent("interface:closed", closed);
  },
};
