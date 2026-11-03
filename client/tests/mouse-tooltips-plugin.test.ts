import { strict as assert } from "node:assert";
import { CHATBOX, MAGIC_SPELLBOOK } from "@runelite/api/gameval/InterfaceID";
import { TOOLTIP_BUILT, TOOLTIP_TIME } from "@runelite/api/gameval/VarClientID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { CLIENT_TOKEN, PluginInjector, inject } from "@runelite/client/plugins/PluginInjector";
import { TooltipManager } from "@runelite/client/ui/overlay/tooltip/TooltipManager";
import { TooltipOverlay, TooltipPlugin } from "@runelite/client/ui/overlay/tooltip/TooltipOverlay";
import { MouseHighlightConfig } from "../game/plugins/mousehighlight/MouseHighlightConfig";
import { MouseHighlightPlugin } from "../game/plugins/mousehighlight/MouseHighlightPlugin";
import type { MinMenuSnapshot } from "../rs/cs2/minimenu";
import { MenuTargetType } from "../rs/MenuEntry";
import { Opcodes } from "../rs/cs2/Opcodes";
import { createCacheVm } from "../scripts/cache/cs2-sweep";

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
    nativeTooltipVisible: () => false,
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

// The current cache's near-pointer tooltip does not set the legacy TOOLTIP_BUILT varc.
const { vm, scripts } = createCacheVm();
const widgets = vm.context.widgetManager, nativeVars = vm.context.varManager;
const nativeConfig = new ConfigManager(undefined);
const nativeTooltips = new TooltipManager();
const nativeClient: any = {
    widgetManager: widgets, varManager: nativeVars, menuOpen: false,
    inputManager: { mouseX: 100, mouseY: 100 }, renderer: { canvas: { width: 800, height: 600 } },
    menuActiveSimpleEntries: [],
};
widgets.osrsClient = nativeClient;
nativeVars.setVarcInt(1217, 1);
nativeVars.setVarcInt(1218, 1);
const nativePlugin = new PluginInjector(nativeConfig)
    .provide(ConfigManager, nativeConfig).provide(CLIENT_TOKEN, nativeClient)
    .runWith(() => new MouseHighlightPlugin(undefined, nativeTooltips));
void nativePlugin.start();
const nativeOverlay = new TooltipPlugin(nativeTooltips, nativeClient);
void nativeOverlay.start();
const clearNative = (uid: number) => {
    vm.intStackSize = 1;
    vm.intStack[0] = uid;
    vm.handlers.get(Opcodes.CC_DELETEALL)(vm.createHandlerContext(), 0, "");
};
for (const [root, child] of [[161, 37], [548, 5], [601, 132]]) {
    widgets.rootInterface = root;
    widgets.loadGroup(root);
    const uid = (root << 16) | child, nativeRoot = widgets.getWidgetByUid(uid);
    Object.assign(nativeRoot, { width: 800, height: 600, rawWidth: 800, rawHeight: 600 });
    // Script 4726 owns this listener; 4728 below is its actual tooltip builder.
    nativeRoot.onTimer = [4725];
    widgets.updateTimerWidget(nativeRoot);
    for (const [option, target, targetType, menuType] of [
        ["Mine", "<col=ffff00>Tin rocks", MenuTargetType.LOC, 3],
        ["Pickpocket", "<col=ffff00>Guard<col=ff0000> (level-21)", MenuTargetType.NPC, 2],
    ] as const) {
        nativeClient.menuActiveSimpleEntries = [{ option, target, targetType }];
        const text = `${option} ${target}`;
        clearNative(uid);
        nativeClient.widgetManager = undefined;
        assert.deepEqual(nativePlugin.tooltip(), { text }, "startup without widgets retains the plugin fallback");
        nativeClient.widgetManager = widgets;
        assert.deepEqual(nativePlugin.tooltip(), { text }, `root ${root}: no native widget means plugin fallback`);
        nativeVars.setVarbit(12344, 0);
        vm.execute(scripts.load(4728), [0, uid, menuType, 3, root], [text], 100_000);
        const nativeTexts = () => (nativeRoot.children ?? []).filter((w: any) => w?.type === 4).map((w: any) => w.text);
        const nativeShown = nativeTexts().includes(text);
        assert.equal(nativeShown, root !== 601, `root ${root}: the cache's mobile path does not build world hover tooltips`);
        assert.notEqual(nativeVars.getVarcInt(TOOLTIP_BUILT), 1, "the old tooltip flag cannot detect this cache path");
        if (nativeShown) {
            assert.ok(nativeTexts().includes("+2 options"));
            assert.equal(nativePlugin.tooltip(), undefined, `root ${root}: the native tooltip owns the visible action text`);
            widgets.rootInterface = 601;
            widgets.loadGroup(601);
            assert.deepEqual(nativePlugin.tooltip(), { text }, "native text from an inactive root cannot suppress the plugin");
            widgets.rootInterface = root;
            nativeRoot.hidden = true;
            assert.deepEqual(nativePlugin.tooltip(), { text }, "hidden native content cannot suppress the plugin");
            nativeRoot.hidden = false;
            const nativeText = nativeRoot.children.find((w: any) => w?.text === text);
            nativeText.hidden = true;
            assert.deepEqual(nativePlugin.tooltip(), { text }, "a hidden native action line cannot suppress the plugin");
            nativeText.hidden = false;
            const childUid = nativeText.uid;
            nativeText.uid = nativeRoot.uid;
            nativeText.hidden = true;
            assert.deepEqual(nativePlugin.tooltip(), { text }, "a hidden dynamic child sharing its parent UID is still hidden");
            nativeText.hidden = false;
            assert.equal(nativePlugin.tooltip(), undefined, "visible shared-UID native text still owns the tooltip");
            nativeText.uid = childUid;
            nativeClient.menuActiveSimpleEntries = [{ option: "Examine", target, targetType }];
            assert.deepEqual(nativePlugin.tooltip(), { text: `Examine ${target}` }, "stale native text cannot suppress a different action");
            nativeClient.menuActiveSimpleEntries = [{ option, target, targetType }];
        } else {
            assert.deepEqual(nativePlugin.tooltip(), { text }, "the mobile cache's absent tooltip preserves existing fallback");
        }
        clearNative(uid);
        nativeVars.setVarbit(12344, 1);
        vm.execute(scripts.load(4728), [0, uid, menuType, 3, root], [text], 100_000);
        assert.ok(!nativeTexts().includes(text), "disabled native tooltips produce no action text");
        assert.deepEqual(nativePlugin.tooltip(), { text }, "native disabled retains the plugin fallback");
        // Top-left mouseover text is separate and must not suppress the near-pointer plugin tooltip.
        vm.execute(scripts.load(4727), [0, uid, menuType, 1], [text], 100_000);
        assert.ok(nativeTexts().includes(text));
        assert.deepEqual(nativePlugin.tooltip(), { text }, "top-left text alone leaves the pointer tooltip available");
        assert.notEqual(nativeOverlay.widgetOverlay.signature(), "");
        nativeClient.menuOpen = true;
        assert.equal(nativeOverlay.widgetOverlay.signature(), "", "the opened context menu still suppresses hover tooltips");
        nativeClient.menuOpen = false;
    }
}
void nativePlugin.stop();
void nativeOverlay.stop();

console.log("Mouse Tooltips plugin tests passed");
