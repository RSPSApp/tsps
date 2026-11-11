import assert from "node:assert/strict";
import { KEYBINDING_TABS, keybindingTabFor } from "../game/keybindingTabs";

const tabFor = (varbit: number) => keybindingTabFor(5, (id) => (id === varbit ? 5 : 0));

// Each side-panel stone (0..13) has exactly one keybind.
assert.deepEqual(KEYBINDING_TABS.map((binding) => binding.tab).sort((a, b) => a - b), [...Array(14).keys()]);
assert.equal(new Set(KEYBINDING_TABS.map((binding) => binding.varbit)).size, KEYBINDING_TABS.length);

assert.equal(tabFor(4687), 12, "the Emotes key opens Emotes");
assert.equal(tabFor(6517), 8, "the Account key opens Account");
assert.equal(tabFor(4684), 9, "the Friends key opens Friends");
assert.equal(tabFor(4689), 10, "the Logout key opens Logout");
assert.equal(tabFor(4686), 11, "the Settings key opens Settings");
assert.equal(keybindingTabFor(5, () => 0), undefined, "an unbound key opens nothing");

console.log("keybinding-tabs: ok");
