// Settings: "All Settings" browser (134), the keybindings panel (121) and the
// side panel's "Game client layout" dropdown (116:40).
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
// Enum 3509 order: Fixed, Resizable Classic, Resizable Modern, Resizable 317, Fixed 317.
const GAMEFRAME_LAYOUT_ROOTS = [548, 164, 161, 161, 548];
const GAMEFRAME_317_OPTION = 3;
const GAMEFRAME_317_FIXED_OPTION = 4;
const GAMEFRAME_317_VARP = 7995; // mirrors client/common/ui/gameframeLayout.ts
const CLIENT_LAYOUT_317_ATTRIBUTE = "client-layout317";
const DEFAULT_GAMEFRAME_ROOT = 161;
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
// The enhanced client's mouseover text setting (cache script 4582 toggles it), from rev 241
// mouseover_text_disabled (it was 12377, mouseover_text_enabled). Our client reports itself as
// enhanced (clienttype 10) and draws the top-left text, so this must be 0 (shown): then HUD
// overlays laid out by script 4731 (Wintertodt, the Gauntlet, ToA...) drop 23px below the
// text instead of sitting under it, as on live.
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
// Cache 241 settings structs3107..3755/4286/2735 and reader script6716.
const QUEST_SETTINGS = { 214:13772, 215:13778, 216:13779, 217:13776, 218:13775, 219:13777, 220:13773, 221:13774, 222:13780, 223:13781, 239:13889, 240:13890 };
const SETTINGS = { ...require("./data/settings.json").settings, ...Object.fromEntries(Object.entries(QUEST_SETTINGS).map(([id, varbit]) => [id, { varbit }])) };
const QUEST_LIST_SETTINGS_BUTTON = (399 << 16) | 11;
const QUEST_COLOUR_VARPS = new Set([3409,3410,3411,3412]);
const QUEST_COLOUR_SETTINGS = {224:3410,225:3409,226:3411,227:3412};
const SETTINGS_COLOUR_MODAL_UID = (ALL_SETTINGS_INTERFACE_ID << 16) | 2;
const SETTINGS_COLOUR_INTERFACE = 288;
const SETTINGS_COLOUR_SCRIPT = 4185;
const CANCEL_COLOUR = 2147483647;
const pendingQuestColours = new WeakMap();
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

const KEYBINDINGS_INTERFACE_ID = 121;
const KEYBINDINGS_RESTORE_DEFAULTS = (KEYBINDINGS_INTERFACE_ID << 16) | 104;
const KEYBINDINGS_ESC_TOGGLE = (KEYBINDINGS_INTERFACE_ID << 16) | 103;
// CS2 985/982 builds the key popup as dynamic children of 121:111 (the list
// panel), one child per option (0 = None, 1..12 = F1..F12, 13 = Esc).
const KEYBINDINGS_POPUP_CONTAINER = (KEYBINDINGS_INTERFACE_ID << 16) | 111;

// "Esc closes current interface" toggle and the dropdown's active-row tracker.
const ESC_CLOSES_VARBIT = 4681;
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
        optionCount: options === undefined ? 0 : CacheDefinitions.getEnumValues(Number(options)).size,
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
  if (Object.values(QUEST_SETTINGS).some(varbit => key === `varbit:${varbit}`) || QUEST_COLOUR_VARPS.has(Number(id))) pluginApi?.emitCustomEvent("quest:list-refresh", { player });
}

function getSettingVar(player, row) {
  const sender = player.getPacketSender();
  return row.varp !== undefined ? sender.getVarp(row.varp) : sender.getVarbit(row.varbit);
}

/** A toggle row clicked: flip its var (and run its script). False for anything else. */
function toggleSetting(player, settingId) {
  const row = SETTINGS[settingId];
  if (!row || catalog().settings.get(settingId)?.type !== SETTING_TYPE_TOGGLE) return false;
  setSettingVar(player, varKey(row), getSettingVar(player, row) ? 0 : 1);
  if (row.script !== undefined) player.getPacketSender().sendClientScript(row.script);
  return true;
}

/** A dropdown option chosen: set the option's vars, or the one var to the option's index. */
function chooseSettingOption(player, settingId, option) {
  const row = SETTINGS[settingId];
  const setting = catalog().settings.get(settingId);
  if (!row || setting?.type !== SETTING_TYPE_DROPDOWN || option < 0 || option >= setting.optionCount) return false;
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
  const saved = savedSettings(player);
  for (const [key, value] of Object.entries(saved)) {
    if (Number.isInteger(value)) setSettingVar(player, key, value);
  }
  for (const row of Object.values(SETTINGS)) {
    if (row.default !== undefined && saved[varKey(row)] === undefined) sendSettingVar(player, varKey(row), row.default);
  }
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
  if (QUEST_COLOUR_SETTINGS[settingId] !== undefined) return openQuestColour(player, settingId);
  if (settingId === 228) {
    for (const id of QUEST_COLOUR_VARPS) setSettingVar(player, `varp:${id}`, 0);
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
  const esc = player.getAttribute(keybindAttribute(ESC_CLOSES_VARBIT));
  setKeybind(player, ESC_CLOSES_VARBIT, typeof esc === "number" ? esc : 1);
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
  const sender = player.getPacketSender();
  syncGameframeVarbit(player);
  sender.sendRootInterface(root);
  for (const packet of encodeGameframeFlags(root)) {
    player.getSession().sendClientPacket(packet);
  }
  return true;
}

function choosePlayerAttackOption({ player, slot }) {
  return Number.isInteger(slot) && chooseSettingOption(player, PLAYER_ATTACK_OPTIONS_SETTING, slot - 1);
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

function openQuestColour(player, settingId) {
  const sender = player.getPacketSender();
  const varp = QUEST_COLOUR_SETTINGS[settingId];
  const defaults = {224:0xff0000,225:0xffff00,226:901389,227:10461087};
  const stored = sender.getVarp(varp);
  sender.sendSubInterface(SETTINGS_COLOUR_MODAL_UID, SETTINGS_COLOUR_INTERFACE, 0);
  sender.sendClientScript(SETTINGS_COLOUR_SCRIPT, SETTINGS_COLOUR_MODAL_UID, stored > 0 ? stored - 1 : defaults[settingId]);
  const action = { acceptsZero: true, acceptsNegative: true, execute(value) {
    if (pendingQuestColours.get(player) !== action) return;
    if (player.getEnteredAmountAction && player.getEnteredAmountAction() !== action) return;
    pendingQuestColours.delete(player);
    sender.closeSubInterface(SETTINGS_COLOUR_MODAL_UID);
    if (value === CANCEL_COLOUR) return;
    if (!Number.isInteger(value) || value < -1 || value > 0xffffff) return;
    setSettingVar(player, `varp:${varp}`, value + 1);
    selectSetting(player, 0);
  } };
  pendingQuestColours.set(player, action);
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
    const action = pendingQuestColours.get(player);
    pendingQuestColours.delete(player);
    if (action && player.getEnteredAmountAction?.() === action) player.setEnteredAmountAction(null);
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
  applyDefaultKeybindings,
  syncPlayerKeybindings,
  openAllSettings,
  openKeybindings,
  keybindVarbitForRow,
  register(api) {
    api.persistAttribute(XPDROPS_ENABLED_ATTRIBUTE);
    api.onPlayerLogin(syncXpDrops);
    api.persistAttribute(XPDROPS_SETUP_ATTRIBUTE);
    api.onPlayerLogin(restoreXpDropsSetup);
    api.onCustomEvent("player:varp-transmit", transmitXpDropsSetup);
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
    api.onPlayerLogin(restoreSettings);
    // Changing category, or searching, changes what a row's slot means.
    api.onInterfaceActionButton(ALL_SETTINGS_CATEGORIES_CLICKZONE, clickCategory);
    api.onInterfaceActionButton(ALL_SETTINGS_SEARCH_BAR, startSettingsSearch);
    api.onInterfaceActionButton(QUEST_LIST_SETTINGS_BUTTON, openQuestSettings);
    api.onCustomEvent("interface:closed", endSettingsSearch);
    api.onInterfaceActionButton(ALL_SETTINGS_SETTINGS_CLICKZONE, clickSetting);
    api.onInterfaceActionButton(ALL_SETTINGS_DROPDOWN_BUTTONS, clickDropdownOption);
    api.onInterfaceActionButton(ALL_SETTINGS_DROPDOWN_CLOSE, closeDropdown);

    // Settings > Display: "Game client layout" dropdown. Its rows are the
    // dropdown panel's dynamic children, one per option (the row at child 0 is
    // the highlight rectangle), so the option index is slot - 1.
    api.onInterfaceActionButton(DISPLAY_LAYOUT_DROPDOWN, applyGameframeLayout);
    api.onInterfaceActionButton(ATTACK_PRIORITY_PLAYER_BUTTONS_UID, choosePlayerAttackOption);
    api.onInterfaceActionButton(ATTACK_PRIORITY_NPC_BUTTONS_UID, chooseNpcAttackOption);

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

    api.onInterfaceActionButton(KEYBINDINGS_ESC_TOGGLE, ({ player }) => {
      const current = getKeybind(player, ESC_CLOSES_VARBIT);
      setKeybind(player, ESC_CLOSES_VARBIT, current === 1 ? 0 : 1);
      return true;
    });

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
      player.getPacketSender().sendVarbit(MOUSEOVER_TEXT_DISABLED_VARBIT, 0);
    });

    api.registerCommand("keybinds", ({ player }) => openKeybindings(player), undefined, "Open keybindings");
    api.registerCommand("settings", ({ player }) => openAllSettings(player), undefined, "Open settings");

    api.log("registered");
  },
};
