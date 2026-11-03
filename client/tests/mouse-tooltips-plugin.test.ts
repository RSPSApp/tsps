import { strict as assert } from "node:assert";
import { CHATBOX, MAGIC_SPELLBOOK } from "@runelite/api/gameval/InterfaceID";
import { TOOLTIP_BUILT, TOOLTIP_TIME } from "@runelite/api/gameval/VarClientID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { TooltipManager } from "@runelite/client/ui/overlay/tooltip/TooltipManager";
import { TooltipOverlay } from "@runelite/client/ui/overlay/tooltip/TooltipOverlay";
import { MouseHighlightConfig } from "../game/plugins/mousehighlight/MouseHighlightConfig";
import { MouseHighlightPlugin } from "../game/plugins/mousehighlight/MouseHighlightPlugin";
import type { MinMenuSnapshot } from "../rs/cs2/minimenu";

// --- Config: RuneLite's group, keys and defaults -------------------------------------------------
assert.equal(MouseHighlightConfig.group, "mousehighlight");
assert.deepEqual(Object.keys(MouseHighlightConfig.items), ["uiTooltip", "chatboxTooltip", "disableSpellbooktooltip"]);
assert.equal(MouseHighlightPlugin.descriptor.name, "Mouse Tooltips");
assert.equal(MouseHighlightPlugin.descriptor.enabledByDefault, undefined, "on by default, as RuneLite");

// --- TooltipManager: addFront sources first, newest on top; failing or empty sources are skipped ---
const manager = new TooltipManager();
const back = () => ({ text: "back" });
const front1 = () => ({ text: "front 1" });
const front2 = () => ({ text: "front 2" });
manager.add(back);
manager.addFront(front1);
manager.addFront(front2);
manager.add(() => undefined);
const errors = console.error;
console.error = () => {};
manager.add(() => { throw new Error("broken source"); });
assert.deepEqual(manager.getTooltips().map((t) => t.text), ["front 2", "front 1", "back"]);
console.error = errors;
manager.remove(front2);
assert.deepEqual(manager.getTooltips().map((t) => t.text).slice(0, 2), ["front 1", "back"]);

// --- The plugin -----------------------------------------------------------------------------------
let entry: MinMenuSnapshot = { option: "", target: "", numOps: 0, type: 0, hasComponentHover: false };
const varcs = new Map<number, number>();
let cycle = 100;
const tooltips = new TooltipManager();
const plugin = new MouseHighlightPlugin({
    hoveredEntry: () => entry,
    getVarcIntValue: (id) => varcs.get(id) ?? 0,
    getGameCycle: () => cycle,
}, tooltips);
const config = inject(ConfigManager);
const world = (option: string, target = "") => (entry = { option, target, numOps: 1, type: 2, hasComponentHover: false });
const widget = (option: string, target: string, group: number) =>
    (entry = { option, target, numOps: 1, type: 7, hasComponentHover: true, widgetUid: (group << 16) | 3 });
const shown = () => tooltips.getTooltips().map((t) => t.text);

assert.deepEqual(shown(), [], "nothing before startUp");
void plugin.start();

world("Attack", "<col=ffff00>Goblin<col=ff00>  (level-2)");
assert.deepEqual(shown(), ["Attack <col=ffff00>Goblin<col=ff00>  (level-2)"], "option and target, colours kept");
world("Take");
assert.deepEqual(shown(), ["Take"], "no target: the option alone");
for (const trivial of ["Walk here", "Cancel", "Continue", "Set heading", ""]) {
    world(trivial);
    assert.deepEqual(shown(), [], `"${trivial}" has no tooltip`);
}
world("Move", "Sliding piece");
assert.deepEqual(shown(), [], "sliding puzzle pieces have none");
world("Move", "Rock");
assert.deepEqual(shown(), ["Move Rock"]);

// Interface tooltips and their switches.
widget("Cast", "<col=00ff00>Wind Strike", MAGIC_SPELLBOOK);
assert.deepEqual(shown(), ["Cast <col=00ff00>Wind Strike"]);
config.setConfigValue(MouseHighlightConfig, "disableSpellbooktooltip", true);
assert.deepEqual(shown(), [], "spellbook tooltips can be turned off");
widget("Public", "", CHATBOX);
assert.deepEqual(shown(), ["Public"]);
config.setConfigValue(MouseHighlightConfig, "chatboxTooltip", false);
assert.deepEqual(shown(), [], "chatbox tooltips can be turned off");
widget("Wear", "Bronze axe", 149);
config.setConfigValue(MouseHighlightConfig, "uiTooltip", false);
assert.deepEqual(shown(), [], "all interface tooltips can be turned off");
world("Attack", "Goblin");
assert.deepEqual(shown(), ["Attack Goblin"], "the switches leave the world alone");

// The game's own tooltip: pending (TOOLTIP_TIME ahead of the clock) or built (TOOLTIP_BUILT) wins.
varcs.set(TOOLTIP_TIME, 150);
assert.deepEqual(shown(), []);
cycle = 151;
assert.deepEqual(shown(), ["Attack Goblin"]);
varcs.set(TOOLTIP_BUILT, 1);
assert.deepEqual(shown(), []);
varcs.set(TOOLTIP_BUILT, 0);

void plugin.stop();
assert.deepEqual(shown(), [], "shutDown removes the source");

// --- TooltipOverlay: drawn only while there is a tooltip and a mouse position --------------------
let mouse: { x: number; y: number } | undefined = { x: 10, y: 20 };
const overlay = new TooltipOverlay(manager, () => mouse);
assert.notEqual(overlay.signature(), "");
assert.equal(overlay.drawBeforeMenu, true, "above the widgets and their tooltips, under the menu");
mouse = undefined;
assert.equal(overlay.signature(), "", "no mouse (menu open, off the canvas): nothing");

console.log("Mouse Tooltips plugin tests passed");
