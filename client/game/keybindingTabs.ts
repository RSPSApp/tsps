// All Settings keybindings map a varbit to the side-panel tab it opens. Values
// are OSRS key codes: 0 = unbound, 1 = F1 ... 12 = F12. Names are RuneLite
// VarbitID STONE_*_KEY; tabs are the side-panel stones (toplevel component 76 + tab):
// 7 clan chat, 8 account, 9 friends, 10 logout, 11 settings, 12 emotes, 13 music.
// The server (Settings.plugin.js) owns the current values and defaults.
export const KEYBINDING_TABS: ReadonlyArray<{ varbit: number; tab: number }> = [
    { varbit: 4675, tab: 0 }, // Combat
    { varbit: 4676, tab: 1 }, // Stats
    { varbit: 4677, tab: 2 }, // Journal/Quests
    { varbit: 4678, tab: 3 }, // Inventory
    { varbit: 4679, tab: 4 }, // Worn equipment
    { varbit: 4680, tab: 5 }, // Prayer
    { varbit: 4682, tab: 6 }, // Magic
    { varbit: 4683, tab: 7 }, // Clan chat
    { varbit: 6517, tab: 8 }, // Account
    { varbit: 4684, tab: 9 }, // Friends
    { varbit: 4689, tab: 10 }, // Logout
    { varbit: 4686, tab: 11 }, // Settings (STONE_OPTIONS1_KEY)
    { varbit: 4687, tab: 12 }, // Emotes (STONE_OPTIONS2_KEY)
    { varbit: 4688, tab: 13 }, // Music
];

/** The tab bound to F`pressed` (1..12), or undefined when no keybind uses it. */
export function keybindingTabFor(pressed: number, getVarbit: (varbit: number) => number): number | undefined {
    for (const binding of KEYBINDING_TABS) {
        if (getVarbit(binding.varbit) === pressed) return binding.tab;
    }
    return undefined;
}
