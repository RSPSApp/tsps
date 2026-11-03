import assert from "node:assert/strict";

import { applyWildernessHudLayout } from "../game/widgets/WildernessHud";
import { Cs2Vm } from "../rs/cs2/Cs2Vm";
import { Opcodes } from "../rs/cs2/Opcodes";
import { Script } from "../rs/cs2/Script";
import { layoutWidgets, setWidgetLayoutAdjuster } from "../widgets/layout/WidgetLayout";
import { setPortraitModeEnabled } from "../game/plugins/portraitmode/PortraitLayout";

const range: any = { uid: (90 << 16) | 49, hidden: true, rawY: 18, color: 0xff981f };
const level: any = { uid: (90 << 16) | 50, hidden: false, rawY: 16, color: 0xffff00, text: "Level: 12" };
const widgets = new Map([[range.uid, range], [level.uid, level]]);
const invalidated: number[] = [];
const widgetManager: any = {
    beginBatch() {},
    endBatch() {},
    getWidgetByUid: (uid: number) => widgets.get(uid),
    invalidateWidget: (widget: any) => invalidated.push(widget.uid),
};
let mapFlags = 0;
const varManager: any = { getVarp: () => mapFlags, getVarbit: (id: number) => id === 5963 ? 1 : 0 };

assert.equal(applyWildernessHudLayout(widgetManager, varManager, 387), false);
assert.equal(applyWildernessHudLayout(widgetManager, varManager, 386), true);
assert.deepEqual(
    { hidden: range.hidden, rawY: range.rawY, color: range.color, textColor: range.textColor },
    { hidden: false, rawY: 3, color: 0xffff00, textColor: 0xffff00 },
);
assert.deepEqual(
    { hidden: level.hidden, rawY: level.rawY, color: level.color, textColor: level.textColor },
    { hidden: false, rawY: 16, color: 0xffff00, textColor: 0xffff00 },
);
assert.deepEqual(invalidated, [range.uid, level.uid]);

// Custom PvP zones on normal worlds have no level-based combat range.
for (const unlevelled of [{ hidden: true }, { text: "" }] as any[]) {
    Object.assign(level, unlevelled);
    range.hidden = false;
    invalidated.length = 0;
    assert.equal(applyWildernessHudLayout(widgetManager, varManager, 388), false);
    assert.equal(range.hidden, true, "no level means no combat range row");
    assert.equal(level.hidden, unlevelled.hidden === true, "the level row stays the server's");
    assert.deepEqual(invalidated, [range.uid]);
    Object.assign(level, { hidden: false, text: "Level: 12" });
}

mapFlags = 1 << 2;
level.hidden = true;
assert.equal(applyWildernessHudLayout(widgetManager, varManager, 388), true);
assert.equal(range.hidden, false, "PvP worlds show the range outside the Wilderness");
assert.equal(level.hidden, true, "outside the Wilderness the level row stays hidden");
level.hidden = false;
assert.equal(applyWildernessHudLayout(widgetManager, varManager, 388), true);
mapFlags = 0;

function script(id: number, instructions: number[], operands: number[]): Script {
    const value = new Script();
    value.id = id;
    value.instructions = Int32Array.from(instructions);
    value.intOperands = Int32Array.from(operands);
    value.stringOperands = new Array(instructions.length).fill(null);
    value.longOperands = new BigInt64Array(instructions.length);
    return value;
}

const layout = script(386, [Opcodes.RETURN], [0]);
const root = script(865, [Opcodes.INVOKE, Opcodes.RETURN], [386, 0]);
const scripts = new Map([[386, layout], [865, root]]);
const completed: number[] = [];
const vm = new Cs2Vm({
    widgetManager,
    varManager,
    loadScript: (id: number) => scripts.get(id) ?? null,
    onScriptFinished: (id: number) => completed.push(id),
} as any);

vm.execute(root);
assert.deepEqual(completed, [386, 865], "nested layout completion must be observable");

// Native pvp_icons creates and updates the K/D text from the server's varbits.
{
    const { createCacheVm } = require("../scripts/cache/cs2-sweep");
    const native = createCacheVm();
    const manager = native.vm.context.widgetManager;
    const vars = native.vm.context.varManager;
    const group = manager.loadGroup(90);
    assert.equal(native.vm.invokeEventHandler(group.root, "onLoad"), true);
    const kd = manager.getDynamicChildrenByParent((90 << 16) | 26)[0];
    assert.ok(kd?.eventHandlers?.onVarTransmit, "the cache installs the native K/D listener");
    for (const varp of [1105, 1320, 718]) {
        assert.ok(kd.varTransmitTriggers.includes(varp), `native K/D updates when varp ${varp} changes`);
    }
    function update(toggle: number, inside: number, kills: number, deaths: number) {
        vars.setVarbit(4143, toggle);
        vars.setVarbit(5963, inside);
        vars.setVarbit(8376, kills);
        vars.setVarbit(8375, deaths);
        assert.equal(native.vm.invokeEventHandler(kd, "onVarTransmit"), true);
        return kd.text;
    }
    assert.equal(update(1, 1, 9, 2), "Kills: 9<br>Deaths: 2<br>K/D Ratio: 4.5");
    assert.equal(update(0, 1, 9, 2), "", "turning the board toggle off clears the text");
    assert.equal(update(1, 0, 9, 2), "", "the native overlay clears outside Wilderness");
    assert.equal(update(1, 1, 9, 0), "Kills: 9<br>Deaths: 0<br>K/D Ratio: 0.0");

    // Real cache geometry: mobile PvP icons used to sit underneath the portrait inventory.
    const originalRawX = manager.getWidgetByUid((90 << 16) | 43).rawX;
    manager.setRootInterface(161);
    manager.resize(884, 488);
    manager.setRootInterface(601);
    manager.openSubInterface((601 << 16) | 6, 90, 1);
    assert.equal(manager.getWidgetByUid((90 << 16) | 44).width, 64,
        "mobile geometry applies on first mount without another canvas resize");
    setPortraitModeEnabled(true);
    try {
        for (const [width, height, top] of [[884, 488, 173], [523, 1131, 173], [884, 488, 173]]) {
            manager.resize(width, height);
            const level = manager.getWidgetByUid((90 << 16) | 50);
            level.hidden = false;
            level.text = "Level: 50";
            applyWildernessHudLayout(manager, vars, 386);
            layoutWidgets(group.root, width, height, (uid) => manager.getStaticChildrenByParentUid(uid));
            const inner = manager.getWidgetByUid((90 << 16) | 2);
            const block = manager.getWidgetByUid((90 << 16) | 43);
            const icons = manager.getWidgetByUid((90 << 16) | 44);
            const skull = manager.getWidgetByUid((90 << 16) | 46);
            assert.deepEqual([inner.x + block.x + icons.x, inner.y + block.y + icons.y], [8, top]);
            assert.deepEqual([icons.width, icons.height], [64, 54]);
            assert.deepEqual([skull.width, skull.height], [20, 20]);
            assert.equal(block.rawX, originalRawX, "cache and server geometry is retained for desktop");
            assert.equal(level.hidden, false, "the server still owns Wilderness visibility");

            // Native resize scripts move an absolute widget and put its raw position back.
            const positionOps = [Opcodes.ICONST, Opcodes.ICONST, Opcodes.ICONST, Opcodes.ICONST, Opcodes.ICONST, Opcodes.IF_SETPOSITION];
            native.vm.execute(script(99999, [...positionOps, ...positionOps, Opcodes.RETURN], [
                block.rawX + 1, block.rawY, 0, 0, block.uid, 0,
                block.rawX, block.rawY, 0, 0, block.uid, 0, 0,
            ]));
            manager.ensureLayout(block);
            assert.deepEqual([inner.x + block.x, inner.y + block.y], [8, top],
                "a script with no net raw movement must still restore mobile positioning");
        }
        manager.rootInterface = 161;
        manager.resize(1089, 763);
        layoutWidgets(group.root, 1089, 763, (uid) => manager.getStaticChildrenByParentUid(uid));
        assert.equal(manager.getWidgetByUid((90 << 16) | 44).width, 78, "desktop restores native sizing");
        assert.equal(manager.getWidgetByUid((90 << 16) | 46).width, 25);
    } finally {
        setPortraitModeEnabled(false);
        setWidgetLayoutAdjuster(null);
    }
}

console.log("wilderness HUD layout tests passed");
