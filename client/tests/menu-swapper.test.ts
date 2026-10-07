import { strict as assert } from "node:assert";

import { MenuTargetType } from "../rs/MenuEntry";
import { chooseDefaultMenuEntry, type SimpleMenuEntry } from "../ui/menu/MenuEngine";
import { MenuSwapperPlugin } from "../game/plugins/menuswapper/MenuSwapperPlugin";
import {
    SWAP_LEFT_CLICK,
    SWAP_SHIFT_CLICK,
    applyMenuSwaps,
    plainTargetName,
    type SaveSwap,
} from "../game/plugins/menuswapper/menuSwaps";
import type { MenuSwapperPluginConfig } from "../game/plugins/menuswapper/types";

const BANKER = 3010;
const GOBLIN = 655;

const npc = (option: string, id: number, server: number, name: string): SimpleMenuEntry => ({
    option,
    target: `<col=ffff00>${name}`,
    targetType: MenuTargetType.NPC,
    targetId: id,
    npcServerId: server,
});

/** A world menu: a banker's options, then a goblin's, then Walk here (display order). */
const worldMenu = (): SimpleMenuEntry[] => [
    npc("Talk-to", BANKER, 1, "Banker"),
    npc("Bank", BANKER, 1, "Banker"),
    npc("Collect", BANKER, 1, "Banker"),
    npc("Attack", GOBLIN, 2, "Goblin  (level-2)"),
    npc("Talk-to", GOBLIN, 2, "Goblin  (level-2)"),
    { option: "Walk here", targetType: MenuTargetType.NONE },
    npc("Examine", BANKER, 1, "Banker"),
];

const config = (overrides: Partial<MenuSwapperPluginConfig> = {}): MenuSwapperPluginConfig => ({
    enabled: true,
    presets: { bank: false, trade: false, pickpocket: false, shiftDrop: false },
    swaps: {},
    shiftSwaps: {},
    ...overrides,
});

const noSave: SaveSwap = () => {};
const world = (isShiftHeld = false) => ({
    surface: "world" as const,
    menu: true as const,
    isShiftHeld,
});
const options = (entries: SimpleMenuEntry[]) => entries.map((e) => e.option);
const leftClick = (entries: SimpleMenuEntry[]) => chooseDefaultMenuEntry(entries)?.option;

// Nothing configured: the menu is unchanged.
const untouched = worldMenu();
assert.deepEqual(applyMenuSwaps(untouched, world(), config(), noSave), untouched);

// A saved swap moves the option to its target's first slot: it becomes the left-click.
const banked = applyMenuSwaps(
    worldMenu(),
    world(),
    config({ swaps: { [`npc:${BANKER}`]: { option: "Bank", name: "Banker" } } }),
    noSave,
);
assert.deepEqual(options(banked), [
    "Bank",
    "Talk-to",
    "Collect",
    "Attack",
    "Talk-to",
    "Walk here",
    "Examine",
]);
assert.equal(leftClick(banked), "Bank");

// The swap stays within its target: the goblin's options keep their slots.
const goblin = applyMenuSwaps(
    worldMenu(),
    world(),
    config({ swaps: { [`npc:${GOBLIN}`]: { option: "Talk-to", name: "Goblin" } } }),
    noSave,
);
assert.deepEqual(options(goblin).slice(0, 5), ["Talk-to", "Bank", "Collect", "Talk-to", "Attack"]);
assert.equal(goblin[3].targetId, GOBLIN);
assert.equal(leftClick(goblin), "Talk-to", "the banker is still on top");

// The input menu and its entries are never modified (menus are cached).
const input = worldMenu();
const snapshot = JSON.stringify(input);
applyMenuSwaps(
    input,
    world(true),
    config({ presets: { bank: true, trade: false, pickpocket: false, shiftDrop: false } }),
    noSave,
);
assert.equal(JSON.stringify(input), snapshot);

// A preset applies when no swap is saved; a saved swap beats it; a missing option is a no-op.
const bankPreset = config({
    presets: { bank: true, trade: false, pickpocket: false, shiftDrop: false },
});
assert.equal(leftClick(applyMenuSwaps(worldMenu(), world(), bankPreset, noSave)), "Bank");
const collect = {
    ...bankPreset,
    swaps: { [`npc:${BANKER}`]: { option: "Collect", name: "Banker" } },
};
assert.equal(leftClick(applyMenuSwaps(worldMenu(), world(), collect, noSave)), "Collect");
const missing = config({ swaps: { [`npc:${BANKER}`]: { option: "Pickpocket", name: "Banker" } } });
assert.deepEqual(
    options(applyMenuSwaps(worldMenu(), world(), missing, noSave)),
    options(worldMenu()),
);

// Disabled: nothing happens.
assert.deepEqual(
    applyMenuSwaps(worldMenu(), world(true), { ...collect, enabled: false }, noSave),
    worldMenu(),
);

// With Shift held, each target gets a "Swap left click" submenu (never the left-click itself).
const saved: Array<Parameters<SaveSwap>> = [];
const withSubmenus = applyMenuSwaps(worldMenu(), world(true), config(), (...args) =>
    saved.push(args),
);
assert.deepEqual(options(withSubmenus), [
    "Talk-to",
    "Bank",
    "Collect",
    SWAP_LEFT_CLICK,
    "Attack",
    "Talk-to",
    SWAP_LEFT_CLICK,
    "Walk here",
    "Examine",
]);
const bankerSwap = withSubmenus[3];
assert.equal(bankerSwap.deprioritized, true);
assert.equal(bankerSwap.target, "Banker");
assert.deepEqual(options(bankerSwap.subEntries ?? []), ["Talk-to", "Bank", "Collect", "Reset"]);
assert.equal(leftClick(withSubmenus), "Talk-to");
bankerSwap.subEntries![1].onClick?.();
bankerSwap.subEntries![3].onClick?.();
assert.deepEqual(saved, [
    ["left", `npc:${BANKER}`, "Bank", "Banker"],
    ["left", `npc:${BANKER}`, null, "Banker"],
]);
assert.equal(withSubmenus[6].target, "Goblin", "the level is left out of the saved name");
assert.equal(plainTargetName("<col=ffff00>Goblin<col=ff00>  (level-2)"), "Goblin");

// Only the opened menu gets submenus; the left-click/hover pass just reorders.
const inventory = (menu: boolean, isShiftHeld: boolean) => ({
    surface: "inventory" as const,
    menu,
    isShiftHeld,
    target: { type: MenuTargetType.ITEM, id: 4151, name: "Abyssal whip" },
});
const whip = (): SimpleMenuEntry[] => [
    { option: "Wield", target: "Abyssal whip" },
    { option: "Use", target: "Abyssal whip" },
    { option: "Drop", target: "Abyssal whip" },
    { option: "Examine", target: "Abyssal whip" },
    { option: "Cancel" },
];
assert.deepEqual(
    options(applyMenuSwaps(whip(), inventory(false, true), config(), noSave)),
    options(whip()),
);
const itemMenu = applyMenuSwaps(whip(), inventory(true, true), config(), noSave);
assert.deepEqual(options(itemMenu), [
    "Wield",
    "Use",
    "Drop",
    SWAP_LEFT_CLICK,
    SWAP_SHIFT_CLICK,
    "Examine",
    "Cancel",
]);

// A shift-click swap (or the shift-drop preset) pins the option, but only while Shift is held.
const shiftUse = config({ shiftSwaps: { "item:4151": { option: "Use", name: "Abyssal whip" } } });
const shifted = applyMenuSwaps(whip(), inventory(false, true), shiftUse, noSave);
assert.equal(shifted[0].option, "Use");
assert.equal(shifted[0].swapPinned, true);
assert.equal(leftClick(shifted), "Use");
assert.equal(leftClick(applyMenuSwaps(whip(), inventory(false, false), shiftUse, noSave)), "Wield");
const shiftDrop = config({
    presets: { bank: false, trade: false, pickpocket: false, shiftDrop: true },
});
assert.equal(leftClick(applyMenuSwaps(whip(), inventory(false, true), shiftDrop, noSave)), "Drop");

// The plugin saves, clears and persists swaps.
let persisted: MenuSwapperPluginConfig | undefined;
const plugin = new MenuSwapperPlugin({
    load: () => ({ presets: { trade: true } as any }),
    save: (c) => (persisted = c),
});
assert.equal(plugin.getState().config.presets.trade, true, "saved presets load over the defaults");
assert.equal(plugin.getState().config.presets.bank, false);
plugin.setSwap("left", `npc:${BANKER}`, "Bank", "Banker");
assert.deepEqual(persisted?.swaps, { [`npc:${BANKER}`]: { option: "Bank", name: "Banker" } });
plugin.setSwap("left", `npc:${BANKER}`, null, "Banker");
assert.deepEqual(persisted?.swaps, {});
plugin.setSwap("shift", "item:4151", "Use", "Abyssal whip");
plugin.resetSwaps();
assert.deepEqual([persisted?.swaps, persisted?.shiftSwaps], [{}, {}]);

console.log("menu swapper tests passed");
