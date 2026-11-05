import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { BankTagsPlugin } from "../game/plugins/banktags/BankTagsPlugin";
import { ClueScrollConfig, IdentificationMode } from "../game/plugins/cluescrolls/ClueScrollConfig";
import { ClueScrollPlugin } from "../game/plugins/cluescrolls/ClueScrollPlugin";

// RuneLite 1.13.6's Clue Scroll plugin: descriptor, config group and keys, and its place in the
// core plugin list (after Bank Tags, whose TagManager it registers the "clue" tags with).

// --- Descriptor --------------------------------------------------------------------------------------
const descriptor = ClueScrollPlugin.descriptor;
assert.equal(descriptor.name, "Clue Scroll");
assert.equal(descriptor.description, "Show answers to clue scroll riddles, anagrams, ciphers, and cryptic clues");
assert.deepEqual(descriptor.tags, ["arrow", "hints", "world", "map", "coordinates", "emotes"]);
assert.equal(descriptor.enabledByDefault, false, "the repository's plugin default since #2521 (RuneLite's is on)");
assert.equal(descriptor.configKey, "cluescrollplugin");
assert.equal(ClueScrollPlugin.config, ClueScrollConfig, "the hub's settings panel finds the group");

// --- Config: RuneLite's group, keys and defaults ----------------------------------------------------
assert.equal(ClueScrollConfig.group, "cluescroll");
const items = ClueScrollConfig.items;
assert.equal(items.displayHintArrows.keyName, "displayHintArrows");
assert.equal(items.displayHintArrows.name, "Display hint arrows");
assert.equal(items.displayHintArrows.default, true);
assert.equal(items.identify.keyName, "identify");
assert.equal(items.identify.name, "Identify");
assert.equal(items.identify.default, "ON_READ");
assert.deepEqual(Object.keys(IdentificationMode), ["ON_READ", "IF_INACTIVE", "ON_PICKUP"], "RuneLite's IdentificationMode, in order");
assert.equal(items.identify.enum, IdentificationMode);
assert.equal(Object.keys(items).length, 2, "two settings, as RuneLite");

// --- Registration ------------------------------------------------------------------------------------
// The core plugin list cannot be imported under Node (it pulls in every plugin, and some touch
// browser globals or syntax tsx cannot transform), so the order is checked in the list's source:
// Clue Scroll must come after Bank Tags, whose TagManager it registers its tags with.
const registry = fs.readFileSync(path.join(__dirname, "../runelite/client/plugins/index.ts"), "utf8");
const list = registry.slice(registry.indexOf("CORE_PLUGINS"), registry.indexOf("];", registry.indexOf("CORE_PLUGINS")));
const bankTagsAt = list.indexOf("    BankTagsPlugin,");
const clueAt = list.indexOf("    ClueScrollPlugin,");
assert.ok(bankTagsAt >= 0 && clueAt >= 0, "both are core plugins");
assert.ok(clueAt > bankTagsAt, "Clue Scroll is listed after Bank Tags");
void BankTagsPlugin;

console.log("clue-scroll-plugin: ok");
