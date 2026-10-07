// Settings: "All Settings" browser (134), the keybindings panel (121) and the
// side panel's "Game client layout" dropdown (116:40).
// Component ids, varbits and the settings catalog order below are verified
// against cache rev 237 and cross-checked with RuneLite (InterfaceID.Settings,
// VarbitID).
const {
  encodeGameframeFlags,
  MOBILE_CLIENT_ATTRIBUTE,
  MOBILE_GAMEFRAME_ROOT,
  resolveGameframeRoot,
  DISPLAY_SETTINGS_DROPDOWN_BUTTONS_UID,
} = require("../../src/main/typescript/elvarg/net/protocol/ClientProtocol");
const { getWorldDefinition } = require("../../src/main/typescript/elvarg/game/definition/WorldDefinition");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");

const ROOT_INTERFACE = 161;
const MAIN_MODAL_UID = (ROOT_INTERFACE << 16) | 16;

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
// Rows and dropdown options that may reach us (0..512). Search
// results number rows across every category, so they run far past one category's length.
const ALL_SETTINGS_LAST_SLOT = 511;

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
const SEARCH_VIEW = -1;

// The keybind settings (ids 16..29, All Settings > Controls) and the varbit each drives
// (the varbits are TAB_VARBIT_MAP's).
const KEYBIND_VARBIT_BY_SETTING = new Map([
  [16, 4675], [17, 4680], [18, 4686], [19, 4676], [20, 4682], [21, 4687], [22, 4677],
  [23, 4684], [24, 4683], [25, 4678], [26, 6517], [27, 4688], [28, 4679], [29, 4689],
]);

let settingsCatalog = null;

/** { byCategory: Map<category id, setting ids in row order>, all: every setting id in turn }. */
function catalog() {
  if (settingsCatalog) return settingsCatalog;
  const byCategory = new Map();
  const all = [];
  const categories = [...CacheDefinitions.getEnumValues(SEARCH_CATEGORIES_ENUM)].sort(([a], [b]) => a - b);
  for (const [, structId] of categories) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const rows = [...CacheDefinitions.getEnumValues(Number(category.get(PARAM_CATEGORY_SETTINGS)))]
      .sort(([a], [b]) => a - b)
      .map(([, settingStruct]) => CacheDefinitions.getStructParams(Number(settingStruct)).get(PARAM_SETTING_ID));
    byCategory.set(Number(category.get(PARAM_CATEGORY_ID)), rows);
    all.push(...rows);
  }
  settingsCatalog = { byCategory, all };
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

function showCategory(player, category) {
  player.setAttribute("settings-view", category);
  player.setAttribute("settings-keybind-varbit", -1);
  player.getPacketSender().sendVarbit(SETTINGS_CATEGORY_VARBIT, category);
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

function openAllSettings(player) {
  player.setInterfaceId(ALL_SETTINGS_INTERFACE_ID);
  const sender = player.getPacketSender();
  sender.sendSubInterface(MAIN_MODAL_UID, ALL_SETTINGS_INTERFACE_ID, 0);
  // The settings/controls are dynamic children created client-side; without
  // these transmit flags their ops never reach us. Op1 over the used slot range.
  sender.sendInterfaceFlagsRange(ALL_SETTINGS_CATEGORIES_CLICKZONE, 0, 15, TRANSMIT_OP1);
  sender.sendInterfaceFlagsRange(ALL_SETTINGS_SETTINGS_CLICKZONE, 0, ALL_SETTINGS_LAST_SLOT, TRANSMIT_OP1);
  sender.sendInterfaceFlagsRange(ALL_SETTINGS_DROPDOWN_BUTTONS, 0, ALL_SETTINGS_LAST_SLOT, TRANSMIT_OP1);
  // It opens on the first category.
  showCategory(player, 0);
  return true;
}

function startSettingsSearch({ player }) {
  player.setAttribute("settings-view", SEARCH_VIEW);
  player.setAttribute("settings-keybind-varbit", -1);
  player.getPacketSender()
    .sendVarbit(FLOATER_IS_SEARCHING_VARBIT, 1)
    .sendVarbit(FLOATER_SEARCH_LISTEN_FOR_KEYBOARD_VARBIT, 1)
    .sendClientScript(CHATDEFAULT_STOPINPUT_SCRIPT);
  return false;
}

/** All Settings closed, by any route: its search lets go of the keyboard and chat takes it back. */
function endSettingsSearch({ player, interfaceId }) {
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

module.exports = {
  name: "Settings",
  applyDefaultKeybindings,
  syncPlayerKeybindings,
  openAllSettings,
  openKeybindings,
  keybindVarbitForRow,
  register(api) {
    for (const tab of TAB_VARBIT_MAP) {
      api.persistAttribute(keybindAttribute(tab.varbit));
    }
    api.persistAttribute(keybindAttribute(ESC_CLOSES_VARBIT));

    // "All Settings" button in the settings side panel, and its close button.
    api.onInterfaceActionButton(ALL_SETTINGS_SIDE_BUTTON, ({ player }) => openAllSettings(player));
    api.onInterfaceActionButton(ALL_SETTINGS_CLOSE_BUTTON, ({ player }) => {
      player.getPacketSender().sendInterfaceRemoval();
      return true;
    });

    // Changing category, or searching, changes what a row's slot means and clears the
    // tracked keybind, otherwise a later dropdown elsewhere edits it.
    api.onInterfaceActionButton(ALL_SETTINGS_CATEGORIES_CLICKZONE, ({ player, slot }) => {
      if (Number.isInteger(slot)) showCategory(player, slot);
      return false;
    });
    api.onInterfaceActionButton(ALL_SETTINGS_SEARCH_BAR, startSettingsSearch);
    api.onCustomEvent("interface:closed", endSettingsSearch);

    // A keybind row remembers which varbit its dropdown will edit. The server is
    // authoritative, so we only track.
    api.onInterfaceActionButton(ALL_SETTINGS_SETTINGS_CLICKZONE, ({ player, slot }) => {
      player.setAttribute("settings-keybind-varbit", Number.isInteger(slot) ? keybindVarbitForRow(player, slot) : -1);
      // Other plugins own their settings: "settings:setting-clicked" { player, settingId, handled }.
      const settingId = Number.isInteger(slot) ? settingForRow(player, slot) : -1;
      if (settingId < 0) return false;
      const request = { player, settingId, handled: false };
      api.emitCustomEvent("settings:setting-clicked", request);
      return request.handled;
    });

    // All Settings dropdown option selected: apply it to the tracked keybind.
    // Option buttons sit three components apart in the dropdown panel.
    api.onInterfaceActionButton(ALL_SETTINGS_DROPDOWN_BUTTONS, ({ player, slot }) => {
      const varbit = player.getAttribute("settings-keybind-varbit");
      if (!Number.isInteger(varbit) || varbit < 0) return false;
      const option = Math.floor(slot / 3);
      if (!Number.isInteger(option) || option < KEY_NONE || option > MAX_KEY_VALUE) {
        return false;
      }
      return applyKeybind(player, varbit, option);
    });

    // Settings > Display: "Game client layout" dropdown. Its rows are the
    // dropdown panel's dynamic children, one per option (the row at child 0 is
    // the highlight rectangle), so the option index is slot - 1.
    api.onInterfaceActionButton(DISPLAY_LAYOUT_DROPDOWN, applyGameframeLayout);

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

    api.persistAttribute(CLIENT_LAYOUT_ATTRIBUTE);
    api.persistAttribute(CLIENT_LAYOUT_317_ATTRIBUTE);

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
