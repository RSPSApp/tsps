/**
 * Regression test: the in-game "Screen Brightness" slider must drive the
 * renderer's u_brightness (scene AND 2D UI).
 *
 * Bugs covered:
 * 1. setDeviceOption pre-stored the value into deviceOptions before calling
 *    applyBrightnessDeviceOption, whose change-check then saw no change and
 *    returned before syncing renderer.brightness. So a deviceoption_set(6, v)
 *    (the slider's cache script) updated the stored value the handle reads,
 *    but the scene never re-lit. The login sendConfig echo called
 *    applyBrightnessDeviceOption directly on a fresh deviceOptions map, which
 *    is why the value only ever changed once at login.
 * 2. The cc_triggeroplocal "Adjust Brightness" bridge (opcode 837) re-derived
 *    a second value from _absX rebasing + a UI-scale factor and wrote it after
 *    the cache script. Its systematic bias pinned the value to one direction
 *    (left-drag worked, right-drag was a no-op). The bridge now only persists
 *    the script-written value to the server instead of inventing a competing
 *    one.
 * 3. Brightness is mapped onto 5 discrete levels, not a continuous band:
 *    the stored device option 6 is in the 0..100 script space (it must reach
 *    100 for the cache's handle math (do6/5)/20 to place the handle on the
 *    last dot); the persisted VARP_BRIGHTNESS stays 0..50. The snap points
 *    in script space are [0, 26, 50, 76, 100] and the renderer gets the
 *    matching entry of [0.4, 0.5, 0.6, 0.7, 0.8] (BRIGHTNESS_LEVELS in
 *    common/vars.ts), so the slider can only ever sit on those 5 points.
 * 4. Pointer-driven writes (0..100 script space, from the cache scripts) use
 *    hysteresis (BRIGHTNESS_SNAP_HALF_WIDTH = 6.25 in 0..50 space = 12.5 in
 *    0..100): the stored value only changes when the pointer-derived value is
 *    farther from the current dot than that, so the handle can never rest
 *    between two dots.
 * 5. Input-space conflation ("stuck at the 3rd dot"): the old code halved
 *    every input, but deviceoption 6 is fed from three spaces — the cache
 *    write 3966 writes 0..100 (halving is correct) while our own
 *    setVarp(2856, v) echo and the login sendConfig echo arrive already in
 *    0..50 snap space (halving corrupted them: max → echo 50 → halved 25 →
 *    stored 50 → handle 10/20 = 50% = 3rd dot). applyBrightnessDeviceOption
 *    now takes a snapSpace flag; echoes pass snapSpace=true, and the exact
 *    `current === nextScript` guard makes any echo of the already-stored
 *    value a no-op.
 *
 * This drives a real Cs2Vm (real DEVICEOPTION_SET / CC_TRIGGEROPLOCAL opcode
 * handlers) whose context delegates to the real OsrsClient prototype methods
 * bound to a minimal fake client, so the exact production code paths run.
 */
import assert from "node:assert/strict";

// ── Browser-global + asset shims so the OsrsClient module graph loads under node/tsx ──
const g = globalThis as any;
g.self = g;
g.window = g;
const sheet = {
    cssRules: [],
    rules: [],
    insertRule: (r: any) => {
        this.cssRules.push(r);
        return 0;
    },
    deleteRule() {},
    addRule() {},
    removeRule() {},
};
const mkEl = () => ({
    style: {},
    children: [],
    nodeType: 1,
    tagName: "DIV",
    setAttribute() {},
    removeAttribute() {},
    appendChild(c: any) {
        this.children.push(c);
        return c;
    },
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
});
const head = mkEl();
head.styleSheets = [sheet];
g.document = g.document ?? {
    elementFromPoint: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: mkEl,
    createElementNS: mkEl,
    body: mkEl(),
    head,
    documentElement: mkEl(),
    createTextNode: () => ({}),
};
if (!g.WebSocket)
    g.WebSocket = class {
        static OPEN = 1;
        constructor() {}
        close() {}
        send() {}
    };
const ext = require("module")._extensions;
for (const e of [
    ".glsl", ".css", ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".svg", ".mp3", ".ogg", ".wav", ".json", ".bin", ".dat",
])
    ext[e] = (m: any) => {
        m.exports = "";
    };
for (const name of ["leva", "@stitches/react", "usehooks-ts", "react", "react-dom"]) {
    try {
        const p = require.resolve(name);
        require.cache[p] = {
            id: p,
            filename: p,
            loaded: true,
            paths: [],
            exports: new Proxy(
                {},
                {
                    get: (_t, k: string) =>
                        k === "__esModule" ? false : k === "default" ? {} : () => ({}),
                },
            ),
        };
    } catch {}
}

// The shims above must be in place before the OsrsClient module graph loads
// (it touches browser globals at import time). Load synchronously via require.
const { OsrsClient } = require("../game/OsrsClient");
const { Cs2Vm } = require("../rs/cs2/Cs2Vm");
const { Script } = require("../rs/cs2/Script");
const { Opcodes } = require("../rs/cs2/Opcodes");

// 5 discrete levels: VARP_BRIGHTNESS snap points [0, 13, 25, 38, 50] (0..50
// space) map to renderer multipliers [0.4, 0.5, 0.6, 0.7, 0.8], and the
// stored device option 6 holds the 0..100 script-space equivalents
// [0, 26, 50, 76, 100] (see BRIGHTNESS_LEVELS / BRIGHTNESS_SNAP_VALUES /
// BRIGHTNESS_SCRIPT_SPACE_MAX in common/vars.ts).
const SNAP_VALUES = [0, 13, 25, 38, 50]; // 0..50 snap space
const SCRIPT_VALUES = [0, 26, 50, 76, 100]; // 0..100 script space
const LEVELS = [0.4, 0.5, 0.6, 0.7, 0.8];
const snap = (v: number): number => {
    let best = SNAP_VALUES[0];
    for (const s of SNAP_VALUES) if (Math.abs(v - s) < Math.abs(v - best)) best = s;
    return best;
};
// script value → renderer level. Device option 6 is stored in 0..100 script
// space, so convert it back to 0..50 snap space, snap, and index the level.
const BRIGHTNESS = (script: number): number => {
    const level = SNAP_VALUES.indexOf(snap(Math.trunc((script * 50) / 100)));
    return LEVELS[level < 0 ? 0 : level];
};

// ── Fixture: a slider track + a handle under the pointer ──
// (Kept for the 837-bridge routing tests; the bridge no longer derives a value
// from the pointer, it only persists the script-written value.)
const track: any = { uid: 116 << 16, _absX: 0, width: 50 };
const handle: any = { uid: (116 << 16) | 1, _absX: 20, width: 10 };
const manager: any = {
    beginBatch() {},
    endBatch() {},
    flushBatch() {},
    getWidgetByUid: (uid: number) =>
        uid === track.uid ? track : uid === handle.uid ? handle : undefined,
    getGroup: () => ({}),
};

function makeFakeClient(vm: Cs2Vm) {
    const self: any = {
        deviceOptions: new Map<number, number>(),
        renderer: { brightness: 0.8 },
        widgetManager: manager,
        widgetInteraction: { getUiRenderScale: () => [1, 1] },
        cs2Vm: vm,
        // Stub mirroring VarManager: records the local setVarp(VARP_BRIGHTNESS, v)
        // that applyBrightnessDeviceOption fires to drive the onVarTransmit(2856)
        // slider re-render chain (scripts 381/3939). In production the same
        // setVarp also fires onVarpChange, which routes the value back through
        // applyBrightnessDeviceOption(value, false, true) — that echo is a
        // no-op (current === nextScript), which test 7 asserts directly.
        varpValues: new Map<number, number>(),
        varManager: {
            setVarp: (id: number, value: number) => {
                self.varpValues.set(id, value);
                return true;
            },
            getVarp: (id: number) => self.varpValues.get(id),
        },
    };
    // Bind the real production methods so applySettingsSliderAdjust's internal
    // `this.applyBrightnessDeviceOption(...)` resolves against the fake client.
    self.applyBrightnessDeviceOption = OsrsClient.prototype.applyBrightnessDeviceOption.bind(self);
    self.applySettingsSliderAdjust = OsrsClient.prototype.applySettingsSliderAdjust.bind(self);
    return self;
}

// The setDeviceOption callback, mirroring the (fixed) wiring in OsrsClient:
// option 6 must NOT be pre-stored, it must flow through applyBrightnessDeviceOption.
function makeSetDeviceOption(self: any) {
    return (optionId: number, value: number) => {
        if (optionId === 6) {
            OsrsClient.prototype.applyBrightnessDeviceOption.call(self, value);
            return;
        }
        self.deviceOptions.set(optionId, value);
    };
}
// The onIfTriggerOpLocal callback, mirroring the (fixed) wiring in OsrsClient.
function makeOnIfTriggerOpLocal(self: any) {
    return (widgetUid: number, _childIndex: number, _itemId: number, _opcodeParam: number, args: any[]) => {
        OsrsClient.prototype.applySettingsSliderAdjust.call(self, widgetUid, args?.[0]);
    };
}

function makeVm(self: any, loadScript: (id: number) => Script | null) {
    return new Cs2Vm(
        {
            widgetManager: manager,
            loadScript,
            setDeviceOption: makeSetDeviceOption(self),
            onIfTriggerOpLocal: makeOnIfTriggerOpLocal(self),
        } as any,
    );
}

// A script that pushes (optionId, value) and executes deviceoption_set.
function deviceOptionSetScript(optionId: number, value: number) {
    const s = new Script();
    s.id = 1;
    s.instructions = Int32Array.from([
        Opcodes.ICONST,
        Opcodes.ICONST,
        Opcodes.DEVICEOPTION_SET,
        Opcodes.RETURN,
    ]);
    s.intOperands = Int32Array.from([optionId, value, 0, 0]);
    return s;
}

// A script that pushes (widgetUid, childIndex, opcodeParam, a, b, label) and
// executes cc_triggeroplocal (fixed shape: int,int,int,string,int,int on the stacks).
function triggerOpLocalScript(widgetUid: number, label: string) {
    const s = new Script();
    s.id = 2;
    s.instructions = Int32Array.from([
        Opcodes.ICONST, // widgetUid
        Opcodes.ICONST, // childIndex
        Opcodes.ICONST, // opcodeParam
        Opcodes.ICONST, // a
        Opcodes.ICONST, // b
        Opcodes.SCONST, // label (string stack)
        Opcodes.CC_TRIGGEROPLOCAL,
        Opcodes.RETURN,
    ]);
    s.intOperands = Int32Array.from([widgetUid, -1, 6, 0, 0, 0, 0, 0]);
    s.stringOperands = [null, null, null, null, null, label, null, null];
    return s;
}

// ── Test 1 (primary fix): a changed deviceoption_set(6, v) must sync the renderer ──
{
    const self = makeFakeClient(null as any);
    self.deviceOptions.set(6, 50); // stored dot in 0..100 script space
    self.renderer.brightness = BRIGHTNESS(50);
    const vm = makeVm(self, (id) => (id === 1 ? deviceOptionSetScript(6, 80) : null));
    self.cs2Vm = vm;
    // Pointer value 80 (script space) is 30 away from the stored dot 50
    // (beyond the 12.5 hysteresis half-width in script space), so the change
    // is accepted. 80 scales to 40 in snap space, which snaps to 38.
    vm.run(deviceOptionSetScript(6, 80), [], []);
    // 80/100 → 40 → snap 38 → script-space storage 76.
    assert.equal(self.deviceOptions.get(6), 76, "value must snap to the nearest of the 5 points (script space)");
    // snap(40)=38 maps to level 0.7
    assert.ok(
        Math.abs(self.renderer.brightness - 0.7) < 1e-9,
        "deviceoption_set(6,80) must sync renderer.brightness",
    );
    // The accepted change must fire the local varp-2856 re-render trigger with
    // the 0..50 snap-space value (what the server persists too).
    assert.equal(self.varpValues.get(2856), 38, "accepted change must setVarp(2856) to re-render the slider");
}
console.log("brightness test 1 passed: deviceoption_set(6, v) syncs renderer.brightness");

// ── Test 2: the old pre-store bug is gone ──
{
    const self = makeFakeClient(null as any);
    self.deviceOptions.set(6, 76); // a valid snap point (script space)
    self.renderer.brightness = BRIGHTNESS(76);
    const vm = makeVm(self, (id) => (id === 1 ? deviceOptionSetScript(6, 76) : null));
    self.cs2Vm = vm;
    // Same value as current: genuinely no change, renderer untouched, returns false.
    const changed = OsrsClient.prototype.applyBrightnessDeviceOption.call(self, 76);
    assert.equal(changed, false);
    assert.equal(self.renderer.brightness, BRIGHTNESS(76), "no-op value must not touch the renderer");
    // Now a real change through the full VM path (increasing the value - the
    // direction that used to be pinned by the competing 837-bridge write).
    vm.run(deviceOptionSetScript(6, 100), [], []);
    assert.equal(self.deviceOptions.get(6), 100);
    assert.ok(
        Math.abs(self.renderer.brightness - 0.8) < 1e-9,
        "increased value must move the renderer (no one-directional pinning)",
    );
}
console.log("brightness test 2 passed: no-op is a true no-op; increased value moves the renderer");

// ── Test 3 (secondary fix): the 837 bridge persists the script value and never
//    overrides it with its own pointer-derived number ──
{
    const self = makeFakeClient(null as any);
    // The cache script already wrote 76 (script space for snap 38; the old
    // bridge would have recomputed it as a different, biased number).
    self.deviceOptions.set(6, 76);
    self.renderer.brightness = BRIGHTNESS(76);
    const vm = makeVm(self, (id) => (id === 2 ? triggerOpLocalScript(track.uid, "Adjust Brightness") : null));
    self.cs2Vm = vm;
    vm.eventContext.mouseX = 15;
    vm.activeWidget = handle;
    vm.run(triggerOpLocalScript(track.uid, "Adjust Brightness"), [], []);
    // The bridge must keep the script-written value (76), not replace it.
    assert.equal(self.deviceOptions.get(6), 76, "bridge must not overwrite the script-written value");
    assert.ok(
        Math.abs(self.renderer.brightness - BRIGHTNESS(76)) < 1e-9,
        "renderer stays at the script value through the 837 bridge",
    );
}
console.log("brightness test 3 passed: 837 bridge persists the script value instead of fighting it");

// ── Test 4: non-brightness label is ignored by the 837 bridge ──
{
    const self = makeFakeClient(null as any);
    self.deviceOptions.set(6, 76);
    self.renderer.brightness = BRIGHTNESS(76);
    const vm = makeVm(self, (id) => (id === 2 ? triggerOpLocalScript(track.uid, "Adjust Volume") : null));
    self.cs2Vm = vm;
    vm.eventContext.mouseX = 15;
    vm.activeWidget = handle;
    vm.run(triggerOpLocalScript(track.uid, "Adjust Volume"), [], []);
    assert.equal(self.deviceOptions.get(6), 76, "non-brightness label must not change brightness");
    assert.ok(Math.abs(self.renderer.brightness - BRIGHTNESS(76)) < 1e-9);
}
console.log("brightness test 4 passed: non-brightness slider labels are ignored");

// ── Test 5: 5 discrete brightness levels, never in between ──
{
    const self = makeFakeClient(null as any);
    const vm = makeVm(self, () => null);
    self.cs2Vm = vm;
    self.deviceOptions.set(6, 50);
    // Darkest end of the slider: script 0 → 0.4 (never fully black).
    OsrsClient.prototype.applyBrightnessDeviceOption.call(self, 0);
    assert.ok(Math.abs(self.renderer.brightness - 0.4) < 1e-9, "script 0 must be 0.4 (darkest, not black)");
    // Brightest end: script 100 → 0.8. (With the old 77-normalized space the
    // handle could never reach this dot.)
    OsrsClient.prototype.applyBrightnessDeviceOption.call(self, 100);
    assert.ok(Math.abs(self.renderer.brightness - 0.8) < 1e-9, "script 100 must be 0.8 (brightest)");
    // The old default (persisted 40 → script 80) sits between snap points: it
    // must land on the nearest one (38 → 0.7), never in between.
    OsrsClient.prototype.applyBrightnessDeviceOption.call(self, 80);
    assert.ok(Math.abs(self.renderer.brightness - 0.7) < 1e-9, "script 80 (old default) must snap to 38 → 0.7");
    // Sweep the whole track in 0..50 snap space (the space the persisted
    // varp and the server operate in): every value must land exactly on a
    // level and a script-space snap point, never between two.
    for (const v of [1, 6, 12, 14, 19, 25, 31, 37, 44, 49]) {
        OsrsClient.prototype.applyBrightnessDeviceOption.call(self, v, false, true);
        assert.ok(
            LEVELS.some((l) => Math.abs(self.renderer.brightness - l) < 1e-9),
            `snap-space ${v} must land on one of the 5 levels, got ${self.renderer.brightness}`,
        );
        assert.ok(
            SCRIPT_VALUES.includes(self.deviceOptions.get(6) as number),
            `snap-space ${v} must store a script-space snap point, got ${self.deviceOptions.get(6)}`,
        );
    }
    // Sweep the whole track in 0..100 script space (what cache script 3966
    // writes): same guarantee, through the input-scaling path.
    for (const v of [2, 13, 25, 38, 50, 62, 75, 88, 96, 99]) {
        // Bypass hysteresis: the sweep revisits values near the current dot,
        // so reset the stored dot between steps.
        self.deviceOptions.delete(6);
        OsrsClient.prototype.applyBrightnessDeviceOption.call(self, v);
        assert.ok(
            LEVELS.some((l) => Math.abs(self.renderer.brightness - l) < 1e-9),
            `script ${v} must land on one of the 5 levels, got ${self.renderer.brightness}`,
        );
        assert.ok(
            SCRIPT_VALUES.includes(self.deviceOptions.get(6) as number),
            `script ${v} must store a script-space snap point, got ${self.deviceOptions.get(6)}`,
        );
    }
}
console.log("brightness test 5 passed: 5 discrete levels (0.4..0.8), never in between");

// ── Test 6 (hysteresis): the handle can never rest between two dots ──
{
    const self = makeFakeClient(null as any);
    self.deviceOptions.set(6, 50); // stored dot in script space
    self.renderer.brightness = BRIGHTNESS(50);
    const apply = (v: number) => OsrsClient.prototype.applyBrightnessDeviceOption.call(self, v);

    // Pointer values within the 12.5 script-space half-width of dot 50
    // (i.e. 38..62) must NOT move the stored value: the handle (driven from
    // the stored value via the varp-2856 re-render chain) stays on the dot
    // instead of following the pointer between dots.
    for (const v of [39, 44, 49, 50, 55, 61]) {
        apply(v);
        assert.equal(
            self.deviceOptions.get(6),
            50,
            `pointer value ${v} within half-width of dot 50 must not move the handle`,
        );
    }
    assert.equal(self.varpValues.has(2856), false, "hysteresis-hold must not fire the re-render trigger");

    // Crossing to the next dot: 76 is 26 away (> 12.5) so the value moves to
    // the nearest snap point (76 → 0.7) and the re-render trigger fires.
    apply(76);
    assert.equal(self.deviceOptions.get(6), 76, "pointer beyond the half-width must move to the next dot");
    assert.ok(Math.abs(self.renderer.brightness - 0.7) < 1e-9);
    assert.equal(self.varpValues.get(2856), 38, "accepted dot change must fire the varp-2856 re-render trigger");

    // First write on a fresh client (no stored value) is always accepted.
    const fresh = makeFakeClient(null as any);
    const changed = OsrsClient.prototype.applyBrightnessDeviceOption.call(fresh, 8);
    assert.equal(changed, true, "first brightness write must be accepted even within half-width");
    assert.equal(fresh.deviceOptions.get(6), 0, "first write snaps to the nearest dot (8 → 0)");
}
console.log("brightness test 6 passed: hysteresis keeps the handle on a dot; first write bypasses it");

// ── Test 7 (the "stuck at the 3rd dot" regression): 0..50 echoes must be
//    taken at face value, never halved, and must loop back as no-ops ──
{
    const self = makeFakeClient(null as any);
    // Login echo of a persisted maximum: the server re-sends 2856=50
    // (0..50 snap space). The old code halved it to 25 → stored script 50 →
    // handle (50/5)/20 = 50% = 3rd dot. With snapSpace=true the full level
    // is restored: stored 100 → handle (100/5)/20 = 100% = last dot.
    OsrsClient.prototype.applyBrightnessDeviceOption.call(self, 50, false, true);
    assert.equal(self.deviceOptions.get(6), 100, "login echo 50 must store script 100 (not 50)");
    assert.ok(Math.abs(self.renderer.brightness - 0.8) < 1e-9, "login echo 50 must render level 5 (0.8)");
    assert.equal(self.varpValues.get(2856), 50, "echo must re-fire varp 2856 with the 0..50 value");

    // The echo of that setVarp comes back through the same handler with
    // snapSpace=true: it must be an exact no-op (current === nextScript),
    // which is what prevents the old corruption loop.
    const before = self.deviceOptions.get(6);
    const changed = OsrsClient.prototype.applyBrightnessDeviceOption.call(self, 50, false, true);
    assert.equal(changed, false, "echo of the stored value must be a no-op");
    assert.equal(self.deviceOptions.get(6), before);
    assert.equal(self.renderer.brightness, 0.8);

    // And a login echo of the default (40) restores level 4, not level 3.
    const fresh = makeFakeClient(null as any);
    OsrsClient.prototype.applyBrightnessDeviceOption.call(fresh, 40, false, true);
    assert.equal(fresh.deviceOptions.get(6), 76, "login echo 40 must store script 76");
    assert.ok(Math.abs(fresh.renderer.brightness - 0.7) < 1e-9, "login echo 40 must render level 4 (0.7)");
}
console.log("brightness test 7 passed: 0..50 echoes restore the true level; echoes of stored values are no-ops");

console.log("All brightness slider regression tests passed");
