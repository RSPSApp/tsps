// Settings: "All Settings" browser (134), the keybindings panel (121) and the
// "Game client layout" dropdown, on the side panel (116:40) and in All Settings.
// Component ids, varbits and the settings catalog order below are verified
// against cache rev 237 and cross-checked with RuneLite (InterfaceID.Settings,
// VarbitID).
const {
  encodeGameframeFlags,
  MOBILE_CLIENT_ATTRIBUTE,
  MOBILE_GAMEFRAME_ROOT,
  XPDROPS_ENABLED_ATTRIBUTE,
  resolveGameframeRoot,
  DISPLAY_SETTINGS_DROPDOWN_BUTTONS_UID,
  ATTACK_PRIORITY_PLAYER_BUTTONS_UID,
  ATTACK_PRIORITY_NPC_BUTTONS_UID,
  NATIVE_CLIENT_ATTRIBUTE,
} = require("../../src/main/typescript/elvarg/net/protocol/ClientProtocol");
const { getWorldDefinition } = require("../../src/main/typescript/elvarg/game/definition/WorldDefinition");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const SettingVarpTransmit = require("./SettingVarpTransmit");

const ROOT_INTERFACE = 161;
const MAIN_MODAL_UID = (ROOT_INTERFACE << 16) | 16;
/** The XP drops orb, on the desktop orbs and the mobile toplevel's (gameval names). */
const XPDROPS_ORB_COMPONENTS = ["orbs:xp_drops", "orbs_osm:xp_drops"];
const XPDROPS_OVERLAY_UID = (ROOT_INTERFACE << 16) | 9; // toplevel_osrs_stretch:xp_drops
const XPDROPS_INTERFACE_ID = 122;
const XPDROPS_SETUP_INTERFACE_ID = 137;
const XPDROPS_ENABLED_VARBIT = 4702;
// XP drops setup: each dropdown's option rows are created in a list component paired with its
// header (scripts 1010, 1030, 1031), and the cache's script 1036 sets that dropdown's varbit to
// the row's sub - 1 on op1. The lists and their varbits, in script 1010's order:
const XPDROPS_SETUP_DROPDOWNS = new Map([
  [51, 4692], // position
  [52, 4693], // size
  [53, 4694], // duration
  [54, 4697], // counter
  [55, 4698], // progress bar
  [56, 4695], // colour
  [57, 4696], // group
  [58, 4722], // speed
  [59, 8120], // fake drops
].map(([component, varbit]) => [(XPDROPS_SETUP_INTERFACE_ID << 16) | component, varbit]));
const XPDROPS_SETUP_MAX_ROW = 31;
// The varps behind them, saved as whole values: the browser transmits them, the official client
// only reports the row it chose.
const XPDROPS_SETUP_ATTRIBUTE = "settings:xpdrops-setup";

// The side panel's volume sliders: the cache's scripts (9232, 9238, 9244, 9250) set the varp in
// the client, then trigger the slider's op (if_triggeroplocal) with the new volume when it is
// released or reaches or leaves 0. That is how the server learns it, and it sends it back at login.
// The client only sends a component's trigger once the server has set its transmit-trigger
// event (bit 23), as live does for these four on the settings tab (RSProx captures); without
// it the sliders change the volume until relog. The browser forwards triggers regardless.
const SETTINGS_SIDE_GROUP = 116;
const SKULL_PREVENTION_SETTING = 206;
const SKULL_PREVENTION_TOGGLE = (116 << 16) | 5; // settings_side:skull_prevention
const TRANSMIT_TRIGGER = 1 << 23;
const WELCOME_PLAY_BUTTON = (378 << 16) | 72;
const VOLUME_SLIDER_VARPS = new Map([
  [(116 << 16) | 95, 3796], // master
  [(116 << 16) | 109, 168], // music
  [(116 << 16) | 123, 169], // sound effects
  [(116 << 16) | 137, 872], // area sounds
]);

// The mute button beside each slider. Live toggles it on the server (RSProx captures): muting
// saves the level in a varbit of options_save_sounds (3109) or, for master, options_save_sounds2
// (3797) and sets the volume to 0; unmuting puts the saved level back.
const VOLUME_MUTE_BUTTONS = new Map([
  [(116 << 16) | 96, { volumeVarp: 3796, savedVarp: 3797, shift: 0, bits: 8 }], // master
  [(116 << 16) | 110, { volumeVarp: 168, savedVarp: 3109, shift: 0, bits: 8 }], // music
  [(116 << 16) | 124, { volumeVarp: 169, savedVarp: 3109, shift: 8, bits: 7 }], // sound effects
  [(116 << 16) | 138, { volumeVarp: 872, savedVarp: 3109, shift: 15, bits: 7 }], // area sounds
]);
const UNMUTED_DEFAULT_VOLUME = 100;

// Settings > Display: "Game client layout" dropdown. The row label is built by
// cache script 7992 from entry enum 3509 and its option rows are dynamic
// children of 116:40, so clicks only reach us when that range has op1 flags
// (encodeGameframeFlags sends them).
const DISPLAY_LAYOUT_DROPDOWN = DISPLAY_SETTINGS_DROPDOWN_BUTTONS_UID;
// Enum 3509 order: Fixed, Resizable Classic, Resizable Modern, Resizable 317, Fixed 317. The cache
// has the first three; our client adds the two 317 layouts, to both dropdowns.
const GAMEFRAME_LAYOUT_ENUM = 3509;
const GAMEFRAME_LAYOUT_ROOTS = [548, 164, 161, 161, 548];
const GAMEFRAME_317_OPTION = 3;
const GAMEFRAME_317_FIXED_OPTION = 4;
const GAMEFRAME_317_VARP = 7995; // mirrors client/common/ui/gameframeLayout.ts
const CLIENT_LAYOUT_317_ATTRIBUTE = "client-layout317";
const DEFAULT_GAMEFRAME_ROOT = 161;
const ORBS_PANE_UID = (ROOT_INTERFACE << 16) | 33;
// All Settings > Interfaces: "Game client layout" (12), a dropdown on enum 3509 like the side
// panel's, and "Show data orbs" (8), a toggle on varbit 4084 orbs_disabled.
const GAME_CLIENT_LAYOUT_SETTING = 12;
const SHOW_DATA_ORBS_SETTING = 8;
// world.json "gameframe" -> the dropdown option (enum 3509 index) it forces on login.
const WORLD_GAMEFRAME_OPTIONS = {
  "modern-fixed": 0,
  "modern-resizable": 2,
  "317-resizable": GAMEFRAME_317_OPTION,
  "317-fixed": GAMEFRAME_317_FIXED_OPTION,
};
// Settings > Controls: the "Player 'Attack' options" and "NPC 'Attack' options" dropdowns.
// They are All Settings rows 55 and 56 (varps 1107 and 1306), so both places set the same var.
// Like the layout dropdown, an option's row is at slot option + 1 (live sends op1 on 1..5 / 1..4).
const PLAYER_ATTACK_OPTIONS_SETTING = 55;
const NPC_ATTACK_OPTIONS_SETTING = 56;
// Cache script 3962 reads this to pick the selected dropdown row; 4607 is only
// a display mirror of the layout (no rendering effect in this revision).
const GAMEFRAME_STONE_VARBIT = 4607;
// The enhanced client's mouseover text setting (All Settings row 147; cache script 4582 toggles
// it), from rev 241 mouseover_text_disabled (it was 12377, mouseover_text_enabled). Our client
// reports itself as enhanced (clienttype 10) and draws the top-left text while this is 0; HUD
// overlays laid out by script 4731 (Wintertodt, the Gauntlet, ToA...) then drop 23px below the
// text, as on live, and move back up when the player hides it.
const MOUSEOVER_TEXT_DISABLED_VARBIT = 10035;
// Opaque player attribute; NetworkBuilder/WelcomeScreen read it to boot the
// saved gameframe.
const CLIENT_LAYOUT_ATTRIBUTE = "client-layout-root";

const ALL_SETTINGS_INTERFACE_ID = 134;
const ALL_SETTINGS_SIDE_BUTTON = (116 << 16) | 32;
const ALL_SETTINGS_CLOSE_BUTTON = (ALL_SETTINGS_INTERFACE_ID << 16) | 4;
const ALL_SETTINGS_CATEGORIES_CLICKZONE = (ALL_SETTINGS_INTERFACE_ID << 16) | 24;
const ALL_SETTINGS_SETTINGS_CLICKZONE = (ALL_SETTINGS_INTERFACE_ID << 16) | 20;
const ALL_SETTINGS_DROPDOWN_BUTTONS = (ALL_SETTINGS_INTERFACE_ID << 16) | 29;
// The search bar's click zone, beside the "Search:" label.
const ALL_SETTINGS_SEARCH_BAR = (ALL_SETTINGS_INTERFACE_ID << 16) | 11;
// Capture (All Settings search, then the world map): clicking the search bar sets both and runs
// chatdefault_stopinput; closing All Settings clears both and runs chatdefault_restoreinput.
// While they are set, script 1701 gives the keyboard only to the settings search, so a close
// that left them set kept every other search (the world map's) from receiving keys.
const FLOATER_IS_SEARCHING_VARBIT = 16073;
const FLOATER_SEARCH_LISTEN_FOR_KEYBOARD_VARBIT = 16074;
const CHATDEFAULT_STOPINPUT_SCRIPT = 4020;
const CHATDEFAULT_RESTOREINPUT_SCRIPT = 2158;
// The category shown: scripts 3837/3840 draw the category list and its settings from it.
const SETTINGS_CATEGORY_VARBIT = 9656;
// The setting last clicked (settings_selected_setting). Capture: a row click sets it to that
// setting's id; choosing a dropdown option, closing the dropdown or changing category clears it.
const SETTINGS_SELECTED_SETTING_VARBIT = 9657;
const ALL_SETTINGS_DROPDOWN_CLOSE = (ALL_SETTINGS_INTERFACE_ID << 16) | 26;
const SELECTED_SETTING_ATTRIBUTE = "settings:selected";
// The values the player chose for the rows in data/settings.json, and the category shown
// ({ "varbit:<id>": value, "varp:<id>": value }), restored on login as live does.
const SETTINGS_VALUES_ATTRIBUTE = "settings:values";
// The varps the browser client transmits whole when a row changes its varbit in the client: the
// cache's toggle script (3965) flips Anti Drag (115), precise timing (82) and Esc closes (57)
// there before the click is sent, and the buff bar's relic op (script 3231) flips Display Relics
// (127) with no click at all. The Minimenu rows (4503) flip there too, and the spacing slider
// changes its varbit with no click at all. The rows saved from them are the settings.json rows on
// these varps; other bits (the collection-log notifications on 2856) belong to their own plugins.
const TRANSMITTED_SETTING_VARPS = new Set([1224, 1734, 2856, 4503]);
// Cache 241 settings structs3107..3755/4286/2735 and reader script6716.
/** questlist_hide_in_progress and questlist_hide_completed: toggles before rev 242, dropdowns since. */
const QUEST_LIST_SHOW_VARBITS = [13775, 13777];
const QUEST_LIST_SHOW_MIGRATED_ATTRIBUTE = "settings:quest-list-show-242";
/**
 * Row 278 used to flip varbit 13113, which is row 192's (gravestone payment confirmation); 278 is
 * 14194. A 13113 saved before is 278's, so it is dropped once and 192 starts at its default.
 */
const GRAVESTONE_CONFIRM_KEY = "varbit:13113";
const GRAVESTONE_CONFIRM_MIGRATED_ATTRIBUTE = "settings:gravestone-confirm-192";
const QUEST_SETTINGS = { 214:13772, 215:13778, 216:13779, 217:13776, 218:13775, 219:13777, 220:13773, 221:13774, 222:13780, 223:13781, 239:13889, 240:13890 };
const SETTINGS = { ...require("./data/settings.json").settings, ...Object.fromEntries(Object.entries(QUEST_SETTINGS).map(([id, varbit]) => [id, { varbit }])) };
const QUEST_LIST_SETTINGS_BUTTON = (399 << 16) | 11;
// Colour rows: the varp holding the colour + 1 (0 for the default) and the default colour.
// The varps are cache script 4181's, the defaults each row's struct (param 1230).
// Chat colours by chatbox mode (opaque, transparent, split private chat), quest list (224-227)
// and music player track colours (485-488).
const OPAQUE_CHAT_COLOURS = {
  87: [2992, 0x0000ff], 89: [2993, 0x7f0000], 92: [2994, 0x2020ef], 94: [2995, 0x000000],
  97: [2996, 0x7f0000], 99: [2997, 0x7f0000], 101: [2998, 0x7f007f], 103: [2999, 0x7e3200],
  105: [3060, 0x007a00], 193: [3191, 0x7f0000], 196: [3192, 0x000000], 198: [3193, 0x000000],
  434: [4697, 0x006600],
};
const TRANSPARENT_CHAT_COLOURS = {
  88: [3000, 0x9090ff], 90: [3001, 0xbf2020], 93: [3002, 0x4040ff], 95: [3003, 0xffffff],
  98: [3004, 0xef5050], 100: [3005, 0x7f0000], 102: [3006, 0xdf20ff], 104: [3007, 0xff20df],
  106: [3061, 0x00d300], 194: [3194, 0x7f0000], 197: [3195, 0xffffff], 199: [3196, 0xffffff],
  435: [4698, 0xffff00],
};
const SPLIT_CHAT_COLOURS = { 91: [3008, 0x00ffff], 96: [3009, 0xffff00] };
const COLOUR_SETTINGS = {
  ...OPAQUE_CHAT_COLOURS, ...TRANSPARENT_CHAT_COLOURS, ...SPLIT_CHAT_COLOURS,
  224: [3410, 0xff0000], 225: [3409, 0xffff00], 226: [3411, 901389], 227: [3412, 10461087],
  485: [5235, 0xff0000], 486: [5236, 901389], 487: [5401, 3991270], 488: [5237, 10461087],
};
const varpsOf = (rows) => Object.values(rows).map(([varp]) => varp);
// "Reset ... colours" rows and the colour varps each one clears.
const COLOUR_RESETS = {
  107: varpsOf(OPAQUE_CHAT_COLOURS), 108: varpsOf(TRANSPARENT_CHAT_COLOURS), 109: varpsOf(SPLIT_CHAT_COLOURS),
  228: [3409, 3410, 3411, 3412], 489: [5235, 5236, 5401, 5237],
};
// The picker (colour_pallet) opens as an overlay in All Settings' popup layer, which script 4185
// sizes it against. Its palette swatches and custom-colour buttons need op1 to be clickable;
// a swatch or Ok sends the colour as a count reply, Cancel or close sends CANCEL_COLOUR.
const SETTINGS_COLOUR_MODAL_UID = (ALL_SETTINGS_INTERFACE_ID << 16) | 9;
const SETTINGS_COLOUR_INTERFACE = 288;
const SETTINGS_COLOUR_SCRIPT = 4185;
const SETTINGS_COLOUR_PALETTE = (SETTINGS_COLOUR_INTERFACE << 16) | 11;
const SETTINGS_COLOUR_PALETTE_LAST = 152;
const SETTINGS_COLOUR_CUSTOM = (SETTINGS_COLOUR_INTERFACE << 16) | 8;
const SETTINGS_COLOUR_CUSTOM_LAST = 4;
// settings_colour_modal_opened: 1 while the picker is open.
const SETTINGS_COLOUR_MODAL_OPENED_VARBIT = 12284;
const OVERLAY = 1;
const CANCEL_COLOUR = 2147483647;
const pendingColours = new WeakMap();
// Rows and dropdown options that may reach us (0..512). Search
// results number rows across every category, so they run far past one category's length.
const ALL_SETTINGS_LAST_SLOT = 511;
// The settings list's rows, as live enables them (RSProx captures); a search lists more than 512.
const ALL_SETTINGS_LAST_ROW = 538;
// The All Settings window's volume sliders (scripts 9260, 9266, 9272, 9278) trigger the list's
// row with the setting and the new volume; live gives the list the transmit-trigger event for it.
const ALL_SETTINGS_VOLUME_VARPS = new Map([
  [319, 3796], // master
  [30, 168], // music
  [31, 169], // sound effects
  [32, 872], // area sounds
]);
// "Reset volume sliders to default" (a button row): every slider back to a new account's 100.
const RESET_VOLUME_SETTING = 468;
const DEFAULT_VOLUME = 100;
// Interfaces > Minimenu options: "Minimenu spacing value" (a number row) and "Reset minimenu
// spacing" (a button row) set the spacing the slider row (393, varbit 11523) keeps, then run
// script 7460, which clamps it to 0-100 and applies it in the client as the slider does.
// Ours: the prompt's wording (no capture of it).
const MINIMENU_SPACING_SETTING = 393;
const MINIMENU_SPACING_VALUE_SETTING = 394;
const RESET_MINIMENU_SPACING_SETTING = 395;
const MINIMENU_SPACING_SCRIPT = 7460;
const MAX_MINIMENU_SPACING = 100;
const MINIMENU_SPACING_PROMPT = "Enter the minimenu spacing (0-100):";
const FLOATER_CHATBOX_VARBIT = 16075;
const CHATBOX_BUSY_VARBIT = 12393;

const KEYBINDINGS_INTERFACE_ID = 121;
const KEYBINDINGS_RESTORE_DEFAULTS = (KEYBINDINGS_INTERFACE_ID << 16) | 104;
const KEYBINDINGS_ESC_TOGGLE = (KEYBINDINGS_INTERFACE_ID << 16) | 103;
// CS2 985/982 builds the key popup as dynamic children of 121:111 (the list
// panel), one child per option (0 = None, 1..12 = F1..F12, 13 = Esc).
const KEYBINDINGS_POPUP_CONTAINER = (KEYBINDINGS_INTERFACE_ID << 16) | 111;

// "Esc closes current interface" toggle (All Settings row 57, on varp 1224) and the dropdown's
// active-row tracker. It is saved as a keybind (keybind_4681), not in the settings values.
const ESC_CLOSES_VARBIT = 4681;
const ESC_CLOSES_SETTING = 57;
const ESC_CLOSES_VARP = 1224;
const ACTIVE_KEYBIND_SLOT_VARBIT = 4690;

// WidgetFlags.FLAG_TRANSMIT_OP1 - lets the client send a click to us.
const TRANSMIT_OP1 = 1 << 1;

// Key values are OSRS key codes: 0 = unbound, 1 = F1 ... 12 = F12, 13 = Esc.
const KEY_NONE = 0;
const MAX_KEY_VALUE = 13;

// One row per keybind in interface 121, in cache order (the client's CS2 984
// binds each varbit to button child buttonChild). defaultKey mirrors the OSRS
// defaults and seeds a fresh account.
const TAB_VARBIT_MAP = [
  { slot: 1, varbit: 4675, defaultKey: 1, buttonChild: 9 }, // Combat
  { slot: 2, varbit: 4676, defaultKey: 2, buttonChild: 16 }, // Stats
  { slot: 3, varbit: 4677, defaultKey: 3, buttonChild: 23 }, // Journal/Quests
  { slot: 4, varbit: 4678, defaultKey: 4, buttonChild: 30 }, // Inventory
  { slot: 5, varbit: 4679, defaultKey: 5, buttonChild: 37 }, // Worn equipment
  { slot: 6, varbit: 4680, defaultKey: 6, buttonChild: 44 }, // Prayer
  { slot: 7, varbit: 4682, defaultKey: 7, buttonChild: 51 }, // Magic
  { slot: 8, varbit: 4684, defaultKey: 9, buttonChild: 58 }, // Friends
  { slot: 9, varbit: 6517, defaultKey: 0, buttonChild: 65 }, // Account
  { slot: 10, varbit: 4689, defaultKey: 10, buttonChild: 72 }, // Logout
  { slot: 11, varbit: 4686, defaultKey: 11, buttonChild: 79 }, // Options (settings)
  { slot: 12, varbit: 4687, defaultKey: 0, buttonChild: 86 }, // Options (secondary)
  { slot: 13, varbit: 4683, defaultKey: 8, buttonChild: 93 }, // Clan chat
  { slot: 14, varbit: 4688, defaultKey: 12, buttonChild: 100 }, // Music/Emotes
];

// The settings catalog, from the cache: enum 422 lists
// the searchable categories (structs) in order; each category's param 745 is an enum of its
// setting structs in row order, and a setting struct's param 1077 is its setting id. In a
// category, a row's slot is its index in that category; in search results it is its index in
// every searchable category's settings in turn.
const SEARCH_CATEGORIES_ENUM = 422;
const PARAM_CATEGORY_ID = 743;
const PARAM_CATEGORY_SETTINGS = 745;
const PARAM_SETTING_ID = 1077;
// A setting struct's type (0 = toggle, 2 = dropdown) and its dropdown's option enum.
const PARAM_SETTING_TYPE = 1078;
const PARAM_SETTING_OPTIONS = 1091;
const SETTING_TYPE_TOGGLE = 0;
const SETTING_TYPE_DROPDOWN = 2;
const SEARCH_VIEW = -1;

// Row locks. A setting struct with param 1115 set can be locked, and param 1116 is the text a
// locked row shows. The cache's settings scripts grey the row out while script 2520 says it is
// locked (from vars the server sends); the server decides with ROW_UNLOCKS. A click on a
// locked row, or a dropdown option chosen for one, says the row's text and changes nothing.
const PARAM_SETTING_LOCKABLE = 1115;
const PARAM_SETTING_LOCKED_TEXT = 1116;
const DIARY_TIERS = ["easy", "medium", "hard", "elite"];

/** Asks another plugin through a custom event; true when it answered `field` with true. */
function answered(event, request, field) {
  pluginApi?.emitCustomEvent(event, request);
  return request[field] === true;
}

/** setting id -> whether the player has unlocked the row. Rows not listed are never locked here. */
const ROW_UNLOCKS = new Map([
  // Deep Wilderness lever default option: any tier of the Wilderness Diary.
  [296, (player) => DIARY_TIERS.some((tier) => answered("diary:is-complete", { player, diary: "wilderness", tier, complete: false }, "complete"))],
  // Disable Phantom Muspah messages: Secrets of the North. Ours: script 2520 has no case for this
  // row, so the client never greys it out; the row's own locked text names the quest.
  [302, (player) => answered("quest:is-complete", { player, key: "secrets_of_the_north", complete: false }, "complete")],
  // Make-X barbarian potions: Barbarian Training's Herblore section (varbit 3761 brut_herb_potion = 3).
  [373, (player) => answered("herblore:unlocked", { player, unlock: "barbarian_herblore", allowed: null }, "allowed")],
]);

/**
 * Whether a row is locked for the player. When it is, the row's locked text is sent and the
 * caller must leave the setting as it is. Every path that changes a setting from its row (a
 * click, a dropdown option, a value the client transmits) goes through this first.
 */
function refuseLockedSetting(player, settingId) {
  const lockedText = catalog().settings.get(settingId)?.lockedText;
  const unlocked = ROW_UNLOCKS.get(settingId);
  if (lockedText === undefined || !unlocked || unlocked(player)) return false;
  player.sendMessage(lockedText);
  // The client may already have flipped the var itself; send the value the row keeps.
  const row = SETTINGS[settingId];
  if (row && !row.options) sendSettingVar(player, varKey(row), getSettingVar(player, row));
  return true;
}

// The keybind settings (ids 16..29, All Settings > Controls) and the varbit each drives
// (the varbits are TAB_VARBIT_MAP's).
const KEYBIND_VARBIT_BY_SETTING = new Map([
  [16, 4675], [17, 4680], [18, 4686], [19, 4676], [20, 4682], [21, 4687], [22, 4677],
  [23, 4684], [24, 4683], [25, 4678], [26, 6517], [27, 4688], [28, 4679], [29, 4689],
]);

let settingsCatalog = null;
let pluginApi = null;

/**
 * { byCategory: Map<category id, setting ids in row order>, all: every setting id in turn,
 *   settings: Map<setting id, { category, type, optionCount }> }.
 */
function catalog() {
  if (settingsCatalog) return settingsCatalog;
  const byCategory = new Map();
  const all = [];
  const settings = new Map();
  const categories = [...CacheDefinitions.getEnumValues(SEARCH_CATEGORIES_ENUM)].sort(([a], [b]) => a - b);
  for (const [, structId] of categories) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const categoryId = Number(category.get(PARAM_CATEGORY_ID));
    const rows = [];
    for (const [, settingStruct] of [...CacheDefinitions.getEnumValues(Number(category.get(PARAM_CATEGORY_SETTINGS)))].sort(([a], [b]) => a - b)) {
      const params = CacheDefinitions.getStructParams(Number(settingStruct));
      const settingId = params.get(PARAM_SETTING_ID);
      const options = params.get(PARAM_SETTING_OPTIONS);
      rows.push(settingId);
      settings.set(Number(settingId), {
        category: categoryId,
        type: Number(params.get(PARAM_SETTING_TYPE) ?? SETTING_TYPE_TOGGLE),
        optionCount: options === undefined ? 0
          : Number(options) === GAMEFRAME_LAYOUT_ENUM ? GAMEFRAME_LAYOUT_ROOTS.length
          : CacheDefinitions.getEnumValues(Number(options)).size,
        lockedText: Number(params.get(PARAM_SETTING_LOCKABLE)) === 1 ? params.get(PARAM_SETTING_LOCKED_TEXT) : undefined,
      });
    }
    byCategory.set(categoryId, rows);
    all.push(...rows);
  }
  settingsCatalog = { byCategory, all, settings };
  return settingsCatalog;
}

/** The setting a clicked row is, or -1: a row is read in the category shown, or search. */
function settingForRow(player, slot) {
  const view = player.getAttribute("settings-view");
  const rows = view === SEARCH_VIEW ? catalog().all : catalog().byCategory.get(Number.isInteger(view) ? view : 0);
  const settingId = Number(rows?.[slot]);
  return Number.isInteger(settingId) ? settingId : -1;
}

/** The keybind varbit a clicked row edits, or -1. */
function keybindVarbitForRow(player, slot) {
  return KEYBIND_VARBIT_BY_SETTING.get(settingForRow(player, slot)) ?? -1;
}

function selectSetting(player, settingId) {
  player.setAttribute(SELECTED_SETTING_ATTRIBUTE, settingId);
  player.getPacketSender().sendVarbit(SETTINGS_SELECTED_SETTING_VARBIT, settingId);
}

/**
 * A category clicked. Capture: it ends a search (the same varbits and script as closing All
 * Settings), then shows the category and clears the selected setting.
 */
function showCategory(player, category) {
  const searching = player.getAttribute("settings-view") === SEARCH_VIEW;
  const sender = player.getPacketSender();
  if (searching) {
    sender.sendVarbit(FLOATER_IS_SEARCHING_VARBIT, 0).sendVarbit(FLOATER_SEARCH_LISTEN_FOR_KEYBOARD_VARBIT, 0);
  }
  player.setAttribute("settings-view", category);
  setSettingVar(player, `varbit:${SETTINGS_CATEGORY_VARBIT}`, category);
  selectSetting(player, 0);
  if (searching) sender.sendClientScript(CHATDEFAULT_RESTOREINPUT_SCRIPT);
}

const varKey = (row) => (row.varp !== undefined ? `varp:${row.varp}` : `varbit:${row.varbit}`);

/**
 * Rev 242 made "Hide quests in progress" (218) and "Hide completed quests" (219) the three-way
 * "Show ..." dropdowns: 0 always first/last, 1 use the sorting setting, 2 hide. A saved rev 241 toggle
 * (1 = hide) would now read as "use the sorting setting", so those two values are cleared once, as
 * live 242 logins show them (0) for an account that hid completed quests on 241.
 */
function migrateQuestListShowSettings(player) {
  if (player.getAttribute(QUEST_LIST_SHOW_MIGRATED_ATTRIBUTE) === true) return;
  player.setAttribute(QUEST_LIST_SHOW_MIGRATED_ATTRIBUTE, true);
  const saved = savedSettings(player);
  const keys = QUEST_LIST_SHOW_VARBITS.map((id) => `varbit:${id}`).filter((key) => Object.hasOwn(saved, key));
  if (!keys.length) return;
  const next = { ...saved };
  for (const key of keys) delete next[key];
  player.setAttribute(SETTINGS_VALUES_ATTRIBUTE, next);
}

function migrateGravestoneConfirmSetting(player) {
  if (player.getAttribute(GRAVESTONE_CONFIRM_MIGRATED_ATTRIBUTE) === true) return;
  player.setAttribute(GRAVESTONE_CONFIRM_MIGRATED_ATTRIBUTE, true);
  const saved = savedSettings(player);
  if (!Object.hasOwn(saved, GRAVESTONE_CONFIRM_KEY)) return;
  const next = { ...saved };
  delete next[GRAVESTONE_CONFIRM_KEY];
  player.setAttribute(SETTINGS_VALUES_ATTRIBUTE, next);
}

function savedSettings(player) {
  const saved = player.getAttribute(SETTINGS_VALUES_ATTRIBUTE);
  return saved && typeof saved === "object" ? saved : {};
}

/** Sends a setting's var ("varp:<id>" or "varbit:<id>") without remembering it. */
function sendSettingVar(player, key, value) {
  const [kind, id] = key.split(":");
  const sender = player.getPacketSender();
  if (kind === "varp") sender.sendConfig(Number(id), value);
  else sender.sendVarbit(Number(id), value);
}

/** Sends a setting's var and remembers it for the next login. */
function setSettingVar(player, key, value) {
  const [, id] = key.split(":");
  sendSettingVar(player, key, value);
  player.setAttribute(SETTINGS_VALUES_ATTRIBUTE, { ...savedSettings(player), [key]: value });
}

function getSettingVar(player, row) {
  const sender = player.getPacketSender();
  return row.varp !== undefined ? sender.getVarp(row.varp) : sender.getVarbit(row.varbit);
}

/** A toggle row clicked: flip its var (and run its script). False for anything else. */
function toggleSetting(player, settingId) {
  const row = SETTINGS[settingId];
  if (!row || catalog().settings.get(settingId)?.type !== SETTING_TYPE_TOGGLE) return false;
  if (consumeTransmittedSettingVarp(player, row)) return true;
  setSettingVar(player, varKey(row), getSettingVar(player, row) ? 0 : 1);
  if (row.script !== undefined) player.getPacketSender().sendClientScript(row.script);
  return true;
}

/** Another plugin sets one of its rows' variables: sent and saved as when its row is clicked. */
function setSettingValue({ player, settingId, value }) {
  const row = SETTINGS[settingId];
  if (!row || row.options || !Number.isInteger(value)) return false;
  setSettingVar(player, varKey(row), value);
  if (row.script !== undefined) player.getPacketSender().sendClientScript(row.script);
  return true;
}

/** A dropdown option chosen: set the option's vars, or the one var to the option's index. */
function chooseSettingOption(player, settingId, option) {
  const row = SETTINGS[settingId];
  const setting = catalog().settings.get(settingId);
  if (setting?.type !== SETTING_TYPE_DROPDOWN || !Number.isInteger(option) || option < 0 || option >= setting.optionCount) return false;
  if (refuseLockedSetting(player, settingId)) return true;
  const request = { player, settingId, option, handled: false };
  pluginApi?.emitCustomEvent("settings:option-chosen", request);
  if (request.handled) return true;
  if (!row) return false;
  if (!row.options) {
    setSettingVar(player, varKey(row), option);
    if (row.script !== undefined) player.getPacketSender().sendClientScript(row.script);
    return true;
  }
  const entry = row.options[option];
  if (!entry) return false;
  for (const [id, value] of Object.entries(entry.varbits ?? {})) setSettingVar(player, `varbit:${id}`, value);
  for (const [id, value] of Object.entries(entry.varps ?? {})) setSettingVar(player, `varp:${id}`, value);
  return true;
}

/**
 * Login: the client starts from zero, so send every setting the player changed, and the rows
 * whose live default is not zero (`default` in settings.json) until the player chooses.
 */
function restoreSettings({ player }) {
  migrateQuestListShowSettings(player);
  migrateGravestoneConfirmSetting(player);
  const saved = savedSettings(player);
  for (const [key, value] of Object.entries(saved)) {
    if (Number.isInteger(value)) setSettingVar(player, key, value);
  }
  for (const row of Object.values(SETTINGS)) {
    if (row.default !== undefined && saved[varKey(row)] === undefined) sendSettingVar(player, varKey(row), row.default);
  }
}

/** Login: the client may start with the text hidden, so send the player's choice (shown by default). */
function sendMouseoverText({ player }) {
  const key = `varbit:${MOUSEOVER_TEXT_DISABLED_VARBIT}`;
  sendSettingVar(player, key, savedSettings(player)[key] ?? 0);
}

/**
 * A row clicked. Capture: it becomes the selected setting and, in search results, its category
 * is shown behind them; a toggle then flips. Other plugins own their settings first:
 * "settings:setting-clicked" { player, settingId, handled }.
 */
function clickSetting({ player, slot, argsData, scriptTrigger }) {
  if (scriptTrigger === true) return releaseAllSettingsVolume(player, argsData);
  const settingId = Number.isInteger(slot) ? settingForRow(player, slot) : -1;
  if (settingId < 0) return false;
  selectSetting(player, settingId);
  if (refuseLockedSetting(player, settingId)) return true;
  if (COLOUR_SETTINGS[settingId] !== undefined) return openColour(player, settingId);
  if (COLOUR_RESETS[settingId] !== undefined) {
    for (const id of COLOUR_RESETS[settingId]) setSettingVar(player, `varp:${id}`, 0);
    return true;
  }
  if (player.getAttribute("settings-view") === SEARCH_VIEW) {
    setSettingVar(player, `varbit:${SETTINGS_CATEGORY_VARBIT}`, catalog().settings.get(settingId).category);
  }
  const request = { player, settingId, handled: false };
  pluginApi.emitCustomEvent("settings:setting-clicked", request);
  return request.handled || toggleSetting(player, settingId);
}

/**
 * A dropdown option chosen, for the selected setting. Option buttons sit three components
 * apart in the dropdown panel. Capture: the vars change, then the selection clears.
 */
function clickDropdownOption({ player, slot }) {
  const settingId = player.getAttribute(SELECTED_SETTING_ATTRIBUTE);
  const option = Math.floor(slot / 3);
  if (!Number.isInteger(settingId) || !Number.isInteger(option)) return false;
  const keybindVarbit = KEYBIND_VARBIT_BY_SETTING.get(settingId);
  const applied = keybindVarbit !== undefined
    ? option >= KEY_NONE && option <= MAX_KEY_VALUE && applyKeybind(player, keybindVarbit, option)
    : chooseSettingOption(player, settingId, option);
  if (applied) selectSetting(player, 0);
  return applied;
}

function closeDropdown({ player }) {
  selectSetting(player, 0);
  return true;
}

function clickCategory({ player, slot }) {
  if (Number.isInteger(slot)) showCategory(player, slot);
  return false;
}

const BUTTON_TO_SLOT = new Map(
  TAB_VARBIT_MAP.map((tab) => [(KEYBINDINGS_INTERFACE_ID << 16) | tab.buttonChild, tab.slot])
);
const SLOT_TO_VARBIT = new Map(TAB_VARBIT_MAP.map((tab) => [tab.slot, tab.varbit]));
const VARBIT_SET = new Set(TAB_VARBIT_MAP.map((tab) => tab.varbit));
const DEFAULT_KEY_BY_VARBIT = new Map(TAB_VARBIT_MAP.map((tab) => [tab.varbit, tab.defaultKey]));

const keybindAttribute = (varbit) => `keybind_${varbit}`;

const getKeybind = (player, varbit) => {
  const stored = player.getAttribute(keybindAttribute(varbit));
  if (typeof stored === "number") return stored;
  return DEFAULT_KEY_BY_VARBIT.get(varbit) ?? KEY_NONE;
};

function setKeybind(player, varbit, value) {
  player.setAttribute(keybindAttribute(varbit), value);
  player.getPacketSender().sendVarbit(varbit, value);
}

// A key may only drive one tab, so binding it elsewhere clears the old row.
function applyKeybind(player, varbit, value) {
  if (!VARBIT_SET.has(varbit)) return false;
  if (!Number.isInteger(value) || value < KEY_NONE || value > MAX_KEY_VALUE) return false;
  if (value > KEY_NONE) {
    for (const other of VARBIT_SET) {
      if (other !== varbit && getKeybind(player, other) === value) {
        setKeybind(player, other, KEY_NONE);
      }
    }
  }
  setKeybind(player, varbit, value);
  return true;
}

function applyDefaultKeybindings(player) {
  for (const tab of TAB_VARBIT_MAP) {
    setKeybind(player, tab.varbit, tab.defaultKey);
  }
  setKeybind(player, ESC_CLOSES_VARBIT, 1);
}

function syncPlayerKeybindings(player) {
  for (const tab of TAB_VARBIT_MAP) {
    setKeybind(player, tab.varbit, getKeybind(player, tab.varbit));
  }
  setKeybind(player, ESC_CLOSES_VARBIT, getEscCloses(player));
}

function getEscCloses(player) {
  const esc = player.getAttribute(keybindAttribute(ESC_CLOSES_VARBIT));
  return typeof esc === "number" ? esc : 1;
}

/**
 * "Esc closes the current interface" clicked, in All Settings (row 57) or the keybindings panel.
 * The browser flips it itself and transmits varp 1224 first, which saved it already.
 */
function toggleEscCloses(player) {
  if (refuseLockedSetting(player, ESC_CLOSES_SETTING)) return true;
  if (SettingVarpTransmit.take(player, ESC_CLOSES_VARP, settingVarpTick()) !== undefined) return true;
  setKeybind(player, ESC_CLOSES_VARBIT, getEscCloses(player) === 1 ? 0 : 1);
  return true;
}

function clickEscCloses(request) {
  if (request.handled || request.settingId !== ESC_CLOSES_SETTING) return;
  request.handled = toggleEscCloses(request.player);
}

function getGameframeRoot(player) {
  return resolveGameframeRoot(player, DEFAULT_GAMEFRAME_ROOT);
}

function isMobileClient(player) {
  return player.getAttribute(MOBILE_CLIENT_ATTRIBUTE) === true;
}

// Cache script 3962 picks the dropdown row from this and getwindowmode; the
// value has no rendering effect (3995 only uses it to toggle a side-panel
// hotkey), so it can always mirror the booted layout.
function syncGameframeVarbit(player) {
  const root = getGameframeRoot(player);
  player.getPacketSender()
    .sendConfig(GAMEFRAME_317_VARP, !isMobileClient(player) && (root === 161 || root === 548) && player.getAttribute(CLIENT_LAYOUT_317_ATTRIBUTE) === true ? 1 : 0)
    .sendVarbit(GAMEFRAME_STONE_VARBIT, root === 164 ? 0 : 1);
}

// Switches the client's gameframe to `root` (548 fixed / 164 classic / 161
// modern). The client moves every server-mounted sub-interface onto the new
// layout's components; flags have to be re-sent because set_root clears them.
// Mobile clients stay on the stock mobile toplevel (601) and never persist the
// lock, so their desktop layout preference survives.
function selectGameframeOption(player, option) {
  if (isMobileClient(player)) return MOBILE_GAMEFRAME_ROOT;
  const root = GAMEFRAME_LAYOUT_ROOTS[option];
  if (root === undefined) return undefined;
  player.setAttribute(CLIENT_LAYOUT_ATTRIBUTE, root);
  player.setAttribute(CLIENT_LAYOUT_317_ATTRIBUTE, option === GAMEFRAME_317_OPTION || option === GAMEFRAME_317_FIXED_OPTION);
  return root;
}

function applyGameframeLayout({ player, slot }) {
  if (!Number.isInteger(slot)) return false;
  const root = selectGameframeOption(player, slot - 1);
  if (root === undefined) return false;
  sendGameframeLayout(player, root);
  return true;
}

function sendGameframeLayout(player, root) {
  const sender = player.getPacketSender();
  syncGameframeVarbit(player);
  sender.sendRootInterface(root);
  for (const packet of encodeGameframeFlags(root)) {
    player.getSession().sendClientPacket(packet);
  }
  // The client moves the open mounts onto the new root, but live also reopens the orbs on
  // its orbs pane, which re-runs their onLoad scripts that place the Activity Adviser and
  // store orbs for this layout.
  if (!pluginApi.core.dataOrbsHidden(player)) sender.sendSubInterface(ORBS_PANE_UID, pluginApi.core.orbsGroupFor(root), 1);
}

/** "Game client layout" chosen in All Settings: the same switch as the side panel's dropdown. */
function chooseGameClientLayout(request) {
  if (request.handled || request.settingId !== GAME_CLIENT_LAYOUT_SETTING) return;
  const root = selectGameframeOption(request.player, request.option);
  if (root === undefined) return;
  request.handled = true;
  sendGameframeLayout(request.player, root);
}

/** Live closes the orbs while orbs_disabled is 1 and opens them when it goes back to 0. */
function showDataOrbs(player) {
  const sender = player.getPacketSender();
  if (pluginApi.core.dataOrbsHidden(player)) sender.closeSubInterface(ORBS_PANE_UID);
  else sender.sendSubInterface(ORBS_PANE_UID, pluginApi.core.orbsGroupFor(getGameframeRoot(player)), 1);
}

function clickShowDataOrbs(request) {
  if (request.handled || request.settingId !== SHOW_DATA_ORBS_SETTING) return;
  request.handled = toggleSetting(request.player, SHOW_DATA_ORBS_SETTING);
  if (request.handled) showDataOrbs(request.player);
}

/**
 * Something that hid the orbs for a while (the Leagues tutorial) is done with them: the
 * player's own choice comes back, and the orbs open or stay closed to match.
 */
function restoreDataOrbs({ player }) {
  const row = SETTINGS[SHOW_DATA_ORBS_SETTING];
  const key = varKey(row);
  sendSettingVar(player, key, savedSettings(player)[key] ?? row.default ?? 0);
  showDataOrbs(player);
}

function receiveGameframeLayout(event) {
  if (event.channel !== "gameframe:layout") return;
  event.handled = true;
  const { player, data } = event;
  if (typeof data?.mobile !== "boolean" || player.getAttribute(NATIVE_CLIENT_ATTRIBUTE) === true) return;
  if (isMobileClient(player) === data.mobile) return;
  player.setAttribute(MOBILE_CLIENT_ATTRIBUTE, data.mobile ? true : null);
  const root = getGameframeRoot(player);
  sendGameframeLayout(player, root);
}

function choosePlayerAttackOption({ player, slot }) {
  return Number.isInteger(slot) && chooseSettingOption(player, PLAYER_ATTACK_OPTIONS_SETTING, slot - 1);
}

function toggleSkullPrevention({ player }) {
  return toggleSetting(player, SKULL_PREVENTION_SETTING);
}

function chooseNpcAttackOption({ player, slot }) {
  return Number.isInteger(slot) && chooseSettingOption(player, NPC_ATTACK_OPTIONS_SETTING, slot - 1);
}

function openAllSettings(player) {
  player.setInterfaceId(ALL_SETTINGS_INTERFACE_ID);
  const sender = player.getPacketSender();
  sender.sendSubInterface(MAIN_MODAL_UID, ALL_SETTINGS_INTERFACE_ID, 0);
  // The settings/controls are dynamic children created client-side; without
  // these transmit flags their ops never reach us. Op1 over the used slot range.
  sender.sendInterfaceFlagsRange(ALL_SETTINGS_CATEGORIES_CLICKZONE, 0, 15, TRANSMIT_OP1);
  sender.sendInterfaceFlagsRange(ALL_SETTINGS_SETTINGS_CLICKZONE, 0, ALL_SETTINGS_LAST_ROW, TRANSMIT_OP1 | TRANSMIT_TRIGGER);
  sender.sendInterfaceFlagsRange(ALL_SETTINGS_DROPDOWN_BUTTONS, 0, ALL_SETTINGS_LAST_SLOT, TRANSMIT_OP1);
  // It opens on the category shown last; live sends nothing for it.
  player.setAttribute("settings-view", sender.getVarbit(SETTINGS_CATEGORY_VARBIT));
  return true;
}

function openQuestSettings({ player }) {
  showCategory(player, 6); // Interfaces, cache enum422 category3621.
  return openAllSettings(player);
}

function openColour(player, settingId) {
  const sender = player.getPacketSender();
  const [varp, defaultColour] = COLOUR_SETTINGS[settingId];
  const stored = sender.getVarp(varp);
  sender.sendVarbit(SETTINGS_COLOUR_MODAL_OPENED_VARBIT, 1);
  sender.sendSubInterface(SETTINGS_COLOUR_MODAL_UID, SETTINGS_COLOUR_INTERFACE, OVERLAY);
  sender.sendInterfaceFlagsRange(SETTINGS_COLOUR_PALETTE, 0, SETTINGS_COLOUR_PALETTE_LAST, TRANSMIT_OP1);
  sender.sendInterfaceFlagsRange(SETTINGS_COLOUR_CUSTOM, 0, SETTINGS_COLOUR_CUSTOM_LAST, TRANSMIT_OP1);
  sender.sendClientScript(SETTINGS_COLOUR_SCRIPT, SETTINGS_COLOUR_MODAL_UID, stored > 0 ? stored - 1 : defaultColour);
  const action = { acceptsZero: true, acceptsNegative: true, execute(value) {
    if (pendingColours.get(player) !== action) return;
    if (player.getEnteredAmountAction && player.getEnteredAmountAction() !== action) return;
    pendingColours.delete(player);
    sender.sendVarbit(SETTINGS_COLOUR_MODAL_OPENED_VARBIT, 0);
    sender.closeSubInterface(SETTINGS_COLOUR_MODAL_UID);
    if (value === CANCEL_COLOUR) return;
    if (!Number.isInteger(value) || value < -1 || value > 0xffffff) return;
    setSettingVar(player, `varp:${varp}`, value + 1);
    selectSetting(player, 0);
  } };
  pendingColours.set(player, action);
  player.setEnteredAmountAction(action);
  return true;
}

function startSettingsSearch({ player }) {
  player.setAttribute("settings-view", SEARCH_VIEW);
  player.getPacketSender()
    .sendVarbit(FLOATER_IS_SEARCHING_VARBIT, 1)
    .sendVarbit(FLOATER_SEARCH_LISTEN_FOR_KEYBOARD_VARBIT, 1)
    .sendClientScript(CHATDEFAULT_STOPINPUT_SCRIPT);
  return false;
}

/** All Settings closed, by any route: its search lets go of the keyboard and chat takes it back. */
function endSettingsSearch({ player, interfaceId }) {
  if (interfaceId === ALL_SETTINGS_INTERFACE_ID || interfaceId === SETTINGS_COLOUR_INTERFACE) {
    const action = pendingColours.get(player);
    pendingColours.delete(player);
    if (action && player.getEnteredAmountAction?.() === action) player.setEnteredAmountAction(null);
    if (action) player.getPacketSender().sendVarbit(SETTINGS_COLOUR_MODAL_OPENED_VARBIT, 0);
  }
  if (interfaceId !== ALL_SETTINGS_INTERFACE_ID) return;
  player.getPacketSender()
    .sendVarbit(FLOATER_IS_SEARCHING_VARBIT, 0)
    .sendVarbit(FLOATER_SEARCH_LISTEN_FOR_KEYBOARD_VARBIT, 0)
    .sendClientScript(CHATDEFAULT_RESTOREINPUT_SCRIPT);
}

function openKeybindings(player) {
  syncPlayerKeybindings(player);
  player.setInterfaceId(KEYBINDINGS_INTERFACE_ID);
  const sender = player.getPacketSender();
  sender.sendSubInterface(MAIN_MODAL_UID, KEYBINDINGS_INTERFACE_ID, 0);
  // CS2 982 builds the key popup as dynamic children of 121:111 with no transmit
  // flags; grant op1 so the chosen key reaches us.
  sender.sendInterfaceFlagsRange(KEYBINDINGS_POPUP_CONTAINER, KEY_NONE, MAX_KEY_VALUE, TRANSMIT_OP1);
  return true;
}

function syncXpDrops({ player }) {
  player.getPacketSender().sendVarbit(XPDROPS_ENABLED_VARBIT, player.getAttribute(XPDROPS_ENABLED_ATTRIBUTE) === true ? 1 : 0);
}

/** Script-trigger arguments: ints, each a zigzag varint. */
function readIntArgs(argsData) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const byte of argsData ?? []) {
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) {
      values.push((value >>> 1) ^ -(value & 1));
      value = 0;
      shift = 0;
    }
  }
  return values;
}

/** An All Settings volume slider released: its setting and the new volume. */
function releaseAllSettingsVolume(player, argsData) {
  const [settingId, volume] = readIntArgs(argsData);
  const varpId = ALL_SETTINGS_VOLUME_VARPS.get(settingId);
  if (varpId === undefined || volume === undefined) return false;
  player.applyAudioSettingFromClient?.(varpId, volume);
  return true;
}

/** The volume reset row clicked: each slider's varp set and sent as if the player had dragged it. */
function resetVolumeSliders(request) {
  if (request.handled || request.settingId !== RESET_VOLUME_SETTING) return;
  request.handled = true;
  const sender = request.player.getPacketSender();
  for (const varpId of ALL_SETTINGS_VOLUME_VARPS.values()) {
    request.player.applyAudioSettingFromClient?.(varpId, DEFAULT_VOLUME);
    sender.sendConfig(varpId, DEFAULT_VOLUME);
  }
}

/** The minimenu spacing set, saved with its slider row and applied in the client. */
function setMinimenuSpacing(player, value) {
  const spacing = Math.max(0, Math.min(MAX_MINIMENU_SPACING, Math.trunc(Number(value) || 0)));
  setSettingVar(player, varKey(SETTINGS[MINIMENU_SPACING_SETTING]), spacing);
  player.getPacketSender().sendClientScript(MINIMENU_SPACING_SCRIPT, spacing);
}

/** "Reset minimenu spacing" clicked: no spacing, as a new account starts. */
function resetMinimenuSpacing(request) {
  if (request.handled || request.settingId !== RESET_MINIMENU_SPACING_SETTING) return;
  request.handled = true;
  setMinimenuSpacing(request.player, 0);
}

/** "Minimenu spacing value" clicked: the spacing is asked for as a number. */
function askMinimenuSpacing(request) {
  if (request.handled || request.settingId !== MINIMENU_SPACING_VALUE_SETTING) return;
  request.handled = true;
  const { player } = request;
  const sender = player.getPacketSender();
  sender.sendVarbit(FLOATER_CHATBOX_VARBIT, 1);
  sender.sendVarbit(CHATBOX_BUSY_VARBIT, 1);
  const closed = () => {
    sender.sendVarbit(FLOATER_CHATBOX_VARBIT, 0);
    sender.sendVarbit(CHATBOX_BUSY_VARBIT, 0);
  };
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute: (amount) => {
      setMinimenuSpacing(player, amount);
      closed();
    },
    cancel: closed,
  });
  sender.sendEnterAmountPrompt(MINIMENU_SPACING_PROMPT);
}

function enableVolumeSliders(player) {
  for (const slider of VOLUME_SLIDER_VARPS.keys()) player.getPacketSender?.()?.sendInterfaceFlagsRange?.(slider, -1, -1, TRANSMIT_TRIGGER);
}

/** The gameframe (and the settings tab in it) is mounted at login and again on Play. */
function enableVolumeSlidersLater({ player }) {
  queueMicrotask(() => enableVolumeSliders(player));
  return false;
}

function enableVolumeSlidersOnTab({ player, group }) {
  if (group === SETTINGS_SIDE_GROUP) queueMicrotask(() => enableVolumeSliders(player));
}

function releaseVolumeSlider({ player, buttonId, argsData, scriptTrigger }) {
  if (scriptTrigger !== true) return false;
  const [volume] = readIntArgs(argsData);
  if (volume === undefined) return false;
  player.applyAudioSettingFromClient?.(VOLUME_SLIDER_VARPS.get(buttonId), volume);
  return true;
}

function toggleMute({ player, buttonId }) {
  const mute = VOLUME_MUTE_BUTTONS.get(buttonId);
  const settings = player.getAudioSettings?.();
  if (!mute || !settings) return false;
  const mask = ((1 << mute.bits) - 1) << mute.shift;
  const packed = settings[mute.savedVarp] ?? 0;
  const volume = settings[mute.volumeVarp] ?? 0;
  if (volume > 0) {
    player.setAudioSetting(mute.savedVarp, (packed & ~mask) | (volume << mute.shift));
    player.getPacketSender().sendConfig(mute.savedVarp, player.getAudioSettings()[mute.savedVarp]);
    player.applyAudioSettingFromClient(mute.volumeVarp, 0);
  } else {
    player.applyAudioSettingFromClient(mute.volumeVarp, ((packed & mask) >>> mute.shift) || UNMUTED_DEFAULT_VOLUME);
  }
  player.getPacketSender().sendConfig(mute.volumeVarp, player.getAudioSettings()[mute.volumeVarp]);
  return true;
}

/** The varps holding the XP drops setup; looked up once, as every transmitted varp asks. */
let xpDropsVarps = null;

function xpDropsSetupVarps() {
  xpDropsVarps ??= new Set([...XPDROPS_SETUP_DROPDOWNS.values()].map((varbit) => CacheDefinitions.getVarbit(varbit).baseVar));
  return xpDropsVarps;
}

function saveXpDropsSetup(player, varpId, value) {
  player.setAttribute(XPDROPS_SETUP_ATTRIBUTE, { ...(player.getAttribute(XPDROPS_SETUP_ATTRIBUTE) ?? {}), [varpId]: value | 0 });
}

function restoreXpDropsSetup({ player }) {
  const saved = player.getAttribute(XPDROPS_SETUP_ATTRIBUTE);
  if (!saved || typeof saved !== "object") return;
  const varps = xpDropsSetupVarps();
  for (const [varpId, value] of Object.entries(saved)) {
    if (varps.has(Number(varpId)) && Number.isInteger(value)) player.getPacketSender().sendConfig(Number(varpId), value);
  }
}

/** The browser applies the setup itself and transmits the varp; keep it for the next login. */
function transmitXpDropsSetup(transmission) {
  const { player, varpId, value } = transmission;
  if (!xpDropsSetupVarps().has(varpId)) return;
  saveXpDropsSetup(player, varpId, value);
  // Keep the server's copy in step, so a later row click changes only its own bits.
  player.getPacketSender().sendConfig(varpId, value);
  transmission.handled = true;
}

/** A row chosen in one of the setup's dropdowns. */
function chooseXpDropsSetupRow({ player, buttonId, slot }) {
  const varbit = XPDROPS_SETUP_DROPDOWNS.get(buttonId);
  if (varbit === undefined || !Number.isInteger(slot) || slot < 1 || slot > XPDROPS_SETUP_MAX_ROW) return false;
  const sender = player.getPacketSender();
  sender.sendVarbit(varbit, slot - 1);
  const varpId = CacheDefinitions.getVarbit(varbit).baseVar;
  saveXpDropsSetup(player, varpId, sender.getVarp(varpId));
  return true;
}

function settingVarpTick() {
  return pluginApi?.core?.World?.getProcessCycle?.() ?? 0;
}

/** setting id -> its row, var key and bits, for the settings.json rows on each transmitted varp. */
let transmittedRows = null;

function transmittedSettingRows(varpId) {
  if (!transmittedRows) {
    transmittedRows = new Map([...TRANSMITTED_SETTING_VARPS].map((varp) => [varp, []]));
    for (const [settingId, row] of Object.entries(SETTINGS)) {
      if (row.varp !== undefined || row.varbit === undefined || row.options) continue;
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(row.varbit);
      transmittedRows.get(baseVar)?.push({ settingId: Number(settingId), row, key: varKey(row), startBit, mask: 2 ** (endBit - startBit + 1) - 1 });
    }
  }
  return transmittedRows.get(varpId) ?? [];
}

/**
 * The browser changed a row's varbit itself and sent the whole varp: keep each of our rows' bits
 * that changed, as a click on the row would. A locked row keeps its value.
 */
function saveTransmittedSettings(transmission) {
  const { player, varpId, value } = transmission;
  if (!player || !TRANSMITTED_SETTING_VARPS.has(varpId)) return;
  const saved = savedSettings(player);
  let changed = false;
  for (const { settingId, row, key, startBit, mask } of transmittedSettingRows(varpId)) {
    const next = (value >>> startBit) & mask;
    if (next === (saved[key] ?? row.default ?? 0)) continue;
    // Only a toggle's click follows its transmission (a slider or dropdown change has none to stand for).
    if (catalog().settings.get(settingId)?.type === SETTING_TYPE_TOGGLE) changed = true;
    if (!refuseLockedSetting(player, settingId)) setSettingVar(player, key, next);
  }
  if (varpId === ESC_CLOSES_VARP) {
    const { startBit } = CacheDefinitions.getVarbit(ESC_CLOSES_VARBIT);
    const esc = (value >>> startBit) & 1;
    if (esc !== getEscCloses(player)) {
      changed = true;
      if (!refuseLockedSetting(player, ESC_CLOSES_SETTING)) setKeybind(player, ESC_CLOSES_VARBIT, esc);
    }
  }
  // Only a change of one of these rows stands for the row click that follows it.
  if (changed) SettingVarpTransmit.remember(player, varpId, value, settingVarpTick());
  transmission.handled = true;
}

/** One listener for both the XP drops varps and the setting varps the client transmits. */
function handleSettingsVarpTransmit(transmission) {
  saveTransmittedSettings(transmission);
  transmitXpDropsSetup(transmission);
}

/**
 * One row click sends both the local varp change and the row click. When the varp already carried
 * the new value, it was saved then; don't toggle it a second time.
 */
function consumeTransmittedSettingVarp(player, row) {
  if (row.varp !== undefined || row.varbit === undefined) return false;
  const { baseVar } = CacheDefinitions.getVarbit(row.varbit);
  if (!TRANSMITTED_SETTING_VARPS.has(baseVar)) return false;
  return SettingVarpTransmit.take(player, baseVar, settingVarpTick()) !== undefined;
}

/** The official client transmits a row click only once the server enables it, as live does. */
function enableXpDropsSetupRows(player) {
  if (player.getAttribute(NATIVE_CLIENT_ATTRIBUTE) !== true) return;
  for (const list of XPDROPS_SETUP_DROPDOWNS.keys()) {
    player.getPacketSender().sendInterfaceFlagsRange(list, 1, XPDROPS_SETUP_MAX_ROW, TRANSMIT_OP1);
  }
}

function clickXpDrops({ player, opId, action }) {
  const op = opId ?? action;
  const sender = player.getPacketSender();
  if (op === 2) {
    sender.sendSubInterface(MAIN_MODAL_UID, XPDROPS_SETUP_INTERFACE_ID, 0);
    enableXpDropsSetupRows(player);
  } else if (op === 1) {
    const enabled = player.getAttribute(XPDROPS_ENABLED_ATTRIBUTE) !== true;
    player.setAttribute(XPDROPS_ENABLED_ATTRIBUTE, enabled);
    syncXpDrops({ player });
    // The cache layout reserves counter space only while xpdrops_enabled is set.
    if (enabled) sender.sendSubInterface(XPDROPS_OVERLAY_UID, XPDROPS_INTERFACE_ID, 1);
    else sender.closeSubInterface(XPDROPS_OVERLAY_UID);
  } else {
    return false;
  }
  return true;
}

/** Packed ids of the XP drops orbs; a component this cache lacks is left out. */
function xpDropsOrbIds(api) {
  return XPDROPS_ORB_COMPONENTS.map((name) => api.core.CacheDefinitions.getComponentId(name)).filter(Number.isInteger);
}

module.exports = {
  name: "Settings",
  description: "All Settings browser, keybindings panel and game client layout dropdown, saving the chosen settings and XP drop options per player.",
  applyDefaultKeybindings,
  syncPlayerKeybindings,
  openAllSettings,
  openKeybindings,
  keybindVarbitForRow,
  refuseLockedSetting,
  register(api) {
    api.persistAttribute(XPDROPS_ENABLED_ATTRIBUTE);
    api.onPlayerLogin(syncXpDrops);
    api.persistAttribute(XPDROPS_SETUP_ATTRIBUTE);
    api.onPlayerLogin(restoreXpDropsSetup);
    api.onCustomEvent("player:varp-transmit", handleSettingsVarpTransmit);
    api.onInterfaceActionButton([...XPDROPS_SETUP_DROPDOWNS.keys()], chooseXpDropsSetupRow);
    api.onInterfaceActionButton([...VOLUME_SLIDER_VARPS.keys()], releaseVolumeSlider);
    api.onInterfaceActionButton([...VOLUME_MUTE_BUTTONS.keys()], toggleMute);
    api.onPlayerLogin(enableVolumeSlidersLater);
    api.onInterfaceActionButton(WELCOME_PLAY_BUTTON, enableVolumeSlidersLater);
    api.onCustomEvent("gameframe:tab-mounted", enableVolumeSlidersOnTab);
    api.onInterfaceActionButton(xpDropsOrbIds(api), clickXpDrops);
    for (const tab of TAB_VARBIT_MAP) {
      api.persistAttribute(keybindAttribute(tab.varbit), tab.defaultKey);
    }
    api.persistAttribute(keybindAttribute(ESC_CLOSES_VARBIT), 1);

    // "All Settings" button in the settings side panel, and its close button.
    api.onInterfaceActionButton(ALL_SETTINGS_SIDE_BUTTON, ({ player }) => openAllSettings(player));
    api.onInterfaceActionButton(ALL_SETTINGS_CLOSE_BUTTON, ({ player }) => {
      player.getPacketSender().sendInterfaceRemoval();
      return true;
    });

    pluginApi = api;
    api.persistAttribute(SETTINGS_VALUES_ATTRIBUTE);
    api.persistAttribute(QUEST_LIST_SHOW_MIGRATED_ATTRIBUTE, false);
    api.persistAttribute(GRAVESTONE_CONFIRM_MIGRATED_ATTRIBUTE, false);
    api.onPlayerLogin(restoreSettings);
    api.onPlayerLogin(sendMouseoverText);
    // Changing category, or searching, changes what a row's slot means.
    api.onInterfaceActionButton(ALL_SETTINGS_CATEGORIES_CLICKZONE, clickCategory);
    api.onInterfaceActionButton(ALL_SETTINGS_SEARCH_BAR, startSettingsSearch);
    api.onInterfaceActionButton(QUEST_LIST_SETTINGS_BUTTON, openQuestSettings);
    api.onCustomEvent("interface:closed", endSettingsSearch);
    api.onCustomEvent("settings:set", setSettingValue);
    api.onCustomEvent("settings:setting-clicked", resetVolumeSliders);
    api.onCustomEvent("settings:setting-clicked", resetMinimenuSpacing);
    api.onCustomEvent("settings:setting-clicked", askMinimenuSpacing);
    api.onCustomEvent("settings:setting-clicked", clickEscCloses);
    api.onCustomEvent("settings:setting-clicked", clickShowDataOrbs);
    api.onCustomEvent("settings:option-chosen", chooseGameClientLayout);
    api.onCustomEvent("settings:restore-data-orbs", restoreDataOrbs);
    api.onInterfaceActionButton(ALL_SETTINGS_SETTINGS_CLICKZONE, clickSetting);
    api.onInterfaceActionButton(ALL_SETTINGS_DROPDOWN_BUTTONS, clickDropdownOption);
    api.onInterfaceActionButton(ALL_SETTINGS_DROPDOWN_CLOSE, closeDropdown);

    // Settings > Display: "Game client layout" dropdown. Its rows are the
    // dropdown panel's dynamic children, one per option (the row at child 0 is
    // the highlight rectangle), so the option index is slot - 1.
    api.onInterfaceActionButton(DISPLAY_LAYOUT_DROPDOWN, applyGameframeLayout);
    api.onCustomEvent("network:plugin-message", receiveGameframeLayout);
    api.onInterfaceActionButton(ATTACK_PRIORITY_PLAYER_BUTTONS_UID, choosePlayerAttackOption);
    api.onInterfaceActionButton(ATTACK_PRIORITY_NPC_BUTTONS_UID, chooseNpcAttackOption);
    api.onInterfaceActionButton(SKULL_PREVENTION_TOGGLE, toggleSkullPrevention);

    // Keybindings panel (121): remember which dropdown was clicked, then let the
    // cache's CS2 script (985) open the key popup.
    api.onInterfaceActionButton([...BUTTON_TO_SLOT.keys()], ({ player, buttonId }) => {
      const slot = BUTTON_TO_SLOT.get(buttonId);
      if (typeof slot === "number") {
        player.setAttribute("active-keybind-slot", slot);
        player.getPacketSender().sendVarbit(ACTIVE_KEYBIND_SLOT_VARBIT, slot);
      }
      return false;
    });

    // Store the key chosen from the popup against the tracked tab.
    api.onInterfaceActionButton(KEYBINDINGS_POPUP_CONTAINER, ({ player, slot }) => {
      const varbit = SLOT_TO_VARBIT.get(player.getAttribute("active-keybind-slot") || 1);
      if (varbit === undefined) return false;
      return applyKeybind(player, varbit, slot);
    });

    api.onInterfaceActionButton(KEYBINDINGS_ESC_TOGGLE, ({ player }) => toggleEscCloses(player));

    api.onInterfaceActionButton(KEYBINDINGS_RESTORE_DEFAULTS, ({ player }) => {
      applyDefaultKeybindings(player);
      player.getPacketSender().sendMessage("Keybindings restored to default.");
      return true;
    });

    api.persistAttribute(CLIENT_LAYOUT_ATTRIBUTE, DEFAULT_GAMEFRAME_ROOT);
    api.persistAttribute(CLIENT_LAYOUT_317_ATTRIBUTE, false);

    // A world.json "gameframe" overrides the player's saved layout. Login hooks run before
    // NetworkBuilder sends the gameframe bootstrap (and WelcomeScreen re-sends it), both of
    // which boot the root from this attribute, so the client opens straight into the forced
    // layout with no switch after login.
    const worldGameframeOption = WORLD_GAMEFRAME_OPTIONS[getWorldDefinition().gameframe];
    api.onPlayerLogin(({ player }) => {
      syncPlayerKeybindings(player);
      if (worldGameframeOption !== undefined) selectGameframeOption(player, worldGameframeOption);
      syncGameframeVarbit(player);
    });

    api.registerCommand("keybinds", ({ player }) => openKeybindings(player), undefined, "Open keybindings");
    api.registerCommand("settings", ({ player }) => openAllSettings(player), undefined, "Open settings");

    api.log("registered");
  },
};
