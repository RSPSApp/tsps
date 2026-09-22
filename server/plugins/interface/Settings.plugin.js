// Settings: "All Settings" browser (134) and the keybindings panel (121).
// Component ids, varbits and the settings catalog order below are verified
// against cache rev 237 and cross-checked with RuneLite (InterfaceID.Settings,
// VarbitID) and OpenRune-Server (AllSettingsScript/SettingConfigs).
const ROOT_INTERFACE = 161;
const MAIN_MODAL_UID = (ROOT_INTERFACE << 16) | 16;

const ALL_SETTINGS_INTERFACE_ID = 134;
const ALL_SETTINGS_SIDE_BUTTON = (116 << 16) | 32;
const ALL_SETTINGS_CLOSE_BUTTON = (ALL_SETTINGS_INTERFACE_ID << 16) | 4;
const ALL_SETTINGS_CATEGORIES_CLICKZONE = (ALL_SETTINGS_INTERFACE_ID << 16) | 24;
const ALL_SETTINGS_SETTINGS_CLICKZONE = (ALL_SETTINGS_INTERFACE_ID << 16) | 20;
const ALL_SETTINGS_DROPDOWN_BUTTONS = (ALL_SETTINGS_INTERFACE_ID << 16) | 29;

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

// All Settings > Controls category (914) keybind rows, in category order: row
// slot 27 + i maps to ALL_SETTINGS_KEYBIND_VARBITS[i]. settingId 16..29 -> varbit.
const ALL_SETTINGS_KEYBIND_SLOT_BASE = 27;
const ALL_SETTINGS_KEYBIND_VARBITS = [
  4675, 4680, 4686, 4676, 4682, 4687, 4677, 4684, 4683, 4678, 6517, 4688, 4679, 4689,
];

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

function openAllSettings(player) {
  player.setInterfaceId(ALL_SETTINGS_INTERFACE_ID);
  const sender = player.getPacketSender();
  sender.sendSubInterface(MAIN_MODAL_UID, ALL_SETTINGS_INTERFACE_ID, 0);
  // The settings/controls are dynamic children created client-side; without
  // these transmit flags their ops never reach us (OpenRune AllSettingsScript
  // does the same via ifSetEvents). Op1 over the used slot range.
  sender.sendInterfaceFlagsRange(ALL_SETTINGS_CATEGORIES_CLICKZONE, 0, 15, TRANSMIT_OP1);
  sender.sendInterfaceFlagsRange(ALL_SETTINGS_SETTINGS_CLICKZONE, 0, 63, TRANSMIT_OP1);
  sender.sendInterfaceFlagsRange(ALL_SETTINGS_DROPDOWN_BUTTONS, 0, 63, TRANSMIT_OP1);
  player.setAttribute("settingsKeybindVarbit", -1);
  return true;
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

    // Changing category (or clicking any non-keybind row) must clear the tracked
    // keybind, otherwise a later dropdown in another category edits it.
    api.onInterfaceActionButton(ALL_SETTINGS_CATEGORIES_CLICKZONE, ({ player }) => {
      player.setAttribute("settingsKeybindVarbit", -1);
      return false;
    });

    // All Settings > Controls: a keybind row remembers which varbit its dropdown
    // will edit. The server is authoritative (as in OpenRune), so we only track.
    api.onInterfaceActionButton(ALL_SETTINGS_SETTINGS_CLICKZONE, ({ player, slot }) => {
      const varbit = ALL_SETTINGS_KEYBIND_VARBITS[slot - ALL_SETTINGS_KEYBIND_SLOT_BASE];
      player.setAttribute("settingsKeybindVarbit", Number.isInteger(varbit) ? varbit : -1);
      return false;
    });

    // All Settings dropdown option selected: apply it to the tracked keybind.
    // Option buttons sit three components apart in the dropdown panel.
    api.onInterfaceActionButton(ALL_SETTINGS_DROPDOWN_BUTTONS, ({ player, slot }) => {
      const varbit = player.getAttribute("settingsKeybindVarbit");
      if (!Number.isInteger(varbit) || varbit < 0) return false;
      const option = Math.floor(slot / 3);
      if (!Number.isInteger(option) || option < KEY_NONE || option > MAX_KEY_VALUE) {
        return false;
      }
      return applyKeybind(player, varbit, option);
    });

    // Keybindings panel (121): remember which dropdown was clicked, then let the
    // cache's CS2 script (985) open the key popup.
    api.onInterfaceActionButton([...BUTTON_TO_SLOT.keys()], ({ player, buttonId }) => {
      const slot = BUTTON_TO_SLOT.get(buttonId);
      if (typeof slot === "number") {
        player.setAttribute("activeKeybindSlot", slot);
        player.getPacketSender().sendVarbit(ACTIVE_KEYBIND_SLOT_VARBIT, slot);
      }
      return false;
    });

    // Store the key chosen from the popup against the tracked tab.
    api.onInterfaceActionButton(KEYBINDINGS_POPUP_CONTAINER, ({ player, slot }) => {
      const varbit = SLOT_TO_VARBIT.get(player.getAttribute("activeKeybindSlot") || 1);
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

    api.onPlayerLogin(({ player }) => syncPlayerKeybindings(player));

    api.registerCommand("keybinds", ({ player }) => openKeybindings(player));
    api.registerCommand("settings", ({ player }) => openAllSettings(player));

    api.log("registered");
  },
};
