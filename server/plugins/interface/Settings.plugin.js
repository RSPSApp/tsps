const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const ALL_SETTINGS_SIDE_BUTTON = (116 << 16) | 32;
const ALL_SETTINGS_INTERFACE_ID = 134;
const ALL_SETTINGS_CLOSE_BUTTON = (134 << 16) | 4;

const KEYBINDINGS_INTERFACE_ID = 121;
const KEYBINDINGS_CLOSE_BUTTON = (121 << 16) | 11;
const KEYBINDINGS_RESTORE_DEFAULTS = (121 << 16) | 104;
const KEYBINDINGS_ESC_TOGGLE = (121 << 16) | 103;
const KEYBINDINGS_POPUP_CONTAINER = (121 << 16) | 112;

const ESC_CLOSES_VARBIT = 4681;
const ACTIVE_KEYBIND_SLOT_VARBIT = 4690;

const TAB_VARBIT_MAP = [
  { slot: 1, varbit: 4675, defaultKey: 1, buttonChild: 9 },   // Combat -> F1
  { slot: 2, varbit: 4676, defaultKey: 2, buttonChild: 16 },  // Stats -> F2
  { slot: 3, varbit: 4677, defaultKey: 3, buttonChild: 23 },  // Quests -> F3
  { slot: 4, varbit: 4678, defaultKey: 4, buttonChild: 30 },  // Inventory -> F4
  { slot: 5, varbit: 4679, defaultKey: 5, buttonChild: 37 },  // Equipment -> F5
  { slot: 6, varbit: 4680, defaultKey: 6, buttonChild: 44 },  // Prayer -> F6
  { slot: 7, varbit: 4682, defaultKey: 7, buttonChild: 51 },  // Magic -> F7
  { slot: 8, varbit: 4684, defaultKey: 0, buttonChild: 58 },  // Clan Chat -> None
  { slot: 9, varbit: 6517, defaultKey: 0, buttonChild: 65 },  // Account -> None
  { slot: 10, varbit: 4689, defaultKey: 8, buttonChild: 72 }, // Friends -> F8
  { slot: 11, varbit: 4686, defaultKey: 9, buttonChild: 79 }, // Ignore -> F9
  { slot: 12, varbit: 4687, defaultKey: 10, buttonChild: 86 },// Logout -> F10
  { slot: 13, varbit: 4683, defaultKey: 11, buttonChild: 93 },// Settings -> F11
  { slot: 14, varbit: 4688, defaultKey: 12, buttonChild: 100 },// Emotes -> F12
];

const BUTTON_TO_SLOT = new Map(
  TAB_VARBIT_MAP.map((t) => [(121 << 16) | t.buttonChild, t.slot])
);
const SLOT_TO_VARBIT = new Map(
  TAB_VARBIT_MAP.map((t) => [t.slot, t.varbit])
);

function applyDefaultKeybindings(player) {
  const sender = player.getPacketSender();
  for (const entry of TAB_VARBIT_MAP) {
    player.setAttribute(`keybind_${entry.varbit}`, entry.defaultKey);
    sender.sendVarbit(entry.varbit, entry.defaultKey);
  }
  player.setAttribute(`keybind_${ESC_CLOSES_VARBIT}`, 1);
  sender.sendVarbit(ESC_CLOSES_VARBIT, 1);
}

function syncPlayerKeybindings(player) {
  const sender = player.getPacketSender();
  for (const entry of TAB_VARBIT_MAP) {
    const key = player.getAttribute(`keybind_${entry.varbit}`) ?? entry.defaultKey;
    sender.sendVarbit(entry.varbit, key);
  }
  const esc = player.getAttribute(`keybind_${ESC_CLOSES_VARBIT}`) ?? 1;
  sender.sendVarbit(ESC_CLOSES_VARBIT, esc);
}

function openAllSettings(player) {
  if (player.busy?.()) {
    player.getPacketSender().sendInterfaceRemoval();
  }
  player.setInterfaceId(ALL_SETTINGS_INTERFACE_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_TARGET_UID, ALL_SETTINGS_INTERFACE_ID, 0);
  return true;
}

function openKeybindings(player) {
  if (player.busy?.()) {
    player.getPacketSender().sendInterfaceRemoval();
  }
  syncPlayerKeybindings(player);
  player.setInterfaceId(KEYBINDINGS_INTERFACE_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_TARGET_UID, KEYBINDINGS_INTERFACE_ID, 0);
  return true;
}

module.exports = {
  name: "Settings",
  applyDefaultKeybindings,
  syncPlayerKeybindings,
  openAllSettings,
  openKeybindings,
  register(api) {
    // Open All Settings from side panel settings tab
    api.onInterfaceActionButton(ALL_SETTINGS_SIDE_BUTTON, ({ player }) => {
      return openAllSettings(player);
    });

    // Close All Settings modal
    api.onInterfaceActionButton(ALL_SETTINGS_CLOSE_BUTTON, ({ player }) => {
      player.getPacketSender().sendInterfaceRemoval();
      return true;
    });

    // Close Keybindings modal
    api.onInterfaceActionButton(KEYBINDINGS_CLOSE_BUTTON, ({ player }) => {
      player.getPacketSender().sendInterfaceRemoval();
      return true;
    });

    // Track active keybinding slot when clicking dropdown button
    api.onInterfaceActionButton([...BUTTON_TO_SLOT.keys()], ({ player, buttonId }) => {
      const slot = BUTTON_TO_SLOT.get(buttonId);
      if (typeof slot === "number") {
        player.setAttribute("activeKeybindSlot", slot);
        player.getPacketSender().sendVarbit(ACTIVE_KEYBIND_SLOT_VARBIT, slot);
      }
      return false; // let client CS2 script 985 run to open the popup menu
    });

    // Select key option from popup
    api.onInterfaceActionButton(KEYBINDINGS_POPUP_CONTAINER, ({ player, slot }) => {
      const activeSlot = player.getAttribute("activeKeybindSlot") || 1;
      const varbit = SLOT_TO_VARBIT.get(activeSlot);
      if (varbit !== undefined && Number.isInteger(slot) && slot >= 0 && slot <= 13) {
        player.setAttribute(`keybind_${varbit}`, slot);
        player.getPacketSender().sendVarbit(varbit, slot);
        return true;
      }
      return false;
    });

    // Toggle Esc closes current interface
    api.onInterfaceActionButton(KEYBINDINGS_ESC_TOGGLE, ({ player }) => {
      const current = player.getAttribute(`keybind_${ESC_CLOSES_VARBIT}`) ?? 1;
      const next = current === 1 ? 0 : 1;
      player.setAttribute(`keybind_${ESC_CLOSES_VARBIT}`, next);
      player.getPacketSender().sendVarbit(ESC_CLOSES_VARBIT, next);
      return true;
    });

    // Restore default keybindings
    api.onInterfaceActionButton(KEYBINDINGS_RESTORE_DEFAULTS, ({ player }) => {
      applyDefaultKeybindings(player);
      player.getPacketSender().sendMessage("Keybindings restored to default.");
      return true;
    });

    // Sync keybindings on player login
    api.onPlayerLogin(({ player }) => {
      syncPlayerKeybindings(player);
    });

    // Convenience commands for keybindings and all settings
    api.onCommand(({ player, base }) => {
      const cmd = base.toLowerCase();
      if (cmd === "keybinds" || cmd === "hotkeys" || cmd === "keys") {
        openKeybindings(player);
        return true;
      }
      if (cmd === "settings" || cmd === "allsettings") {
        openAllSettings(player);
        return true;
      }
      return false;
    });

    api.log("registered");
  },
};
