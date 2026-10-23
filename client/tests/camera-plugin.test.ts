import assert from "node:assert/strict";

import { ConfigChanged } from "@runelite/api/events";
import {
    CAMERA_ZOOM_BIG,
    CAMERA_ZOOM_BIG_MAX,
    CAMERA_ZOOM_BIG_MIN,
    CAMERA_ZOOM_SMALL,
    CAMERA_ZOOM_SMALL_MAX,
    CAMERA_ZOOM_SMALL_MIN,
} from "@runelite/api/gameval/VarClientID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ClientScriptLoader } from "../game/cs2/ClientScriptLoader";
import { CameraConfig, ControlFunction, EaseFrom } from "../game/plugins/camera/CameraConfig";
import { CameraPlugin } from "../game/plugins/camera/CameraPlugin";
import { CameraEasing } from "../game/plugins/camera/CameraEasing";
import type { CameraRotation } from "../game/plugins/ClientPluginManager";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { Cs2Vm } from "../rs/cs2/Cs2Vm";
import { Opcodes } from "../rs/cs2/Opcodes";
import { Script } from "../rs/cs2/Script";
import {
    SCROLL_WHEEL_ZOOM_EVENT,
    SCROLL_WHEEL_ZOOM_INCREMENT_EVENT,
    SCROLL_WHEEL_ZOOM_SCRIPT,
    addZoomCallbacks,
} from "../rs/cs2/zoomCallbacks";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

type Op = [number, number, string | null];

function script(id: number, ops: Op[], intArgCount = 0, localIntCount = 0): Script {
    const s = new Script();
    s.id = id;
    s.intArgCount = intArgCount;
    s.localIntCount = localIntCount;
    s.instructions = Int32Array.from(ops.map(([op]) => op));
    s.intOperands = Int32Array.from(ops.map(([, operand]) => operand));
    s.stringOperands = ops.map(([, , text]) => text);
    s.longOperands = new BigInt64Array(ops.length);
    return s;
}

// --- The cache's scroll-wheel script gets RuneLite's callbacks ---------------------------------

const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const cache = CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files);
const raw = new ClientScriptLoader({ getCacheSystem: () => cache });
const patched = raw.load(SCROLL_WHEEL_ZOOM_SCRIPT)!;
assert.equal(patched.stringOperands[2], SCROLL_WHEEL_ZOOM_EVENT);
assert.equal(patched.instructions[3], Opcodes.RUNELITE_CALLBACK);
assert.equal(patched.instructions[4], Opcodes.IF_ICMPNE);
assert.equal(patched.instructions[5], Opcodes.RETURN);
assert.equal(patched.stringOperands[9], SCROLL_WHEEL_ZOOM_INCREMENT_EVENT);
assert.deepEqual(
    [patched.instructions[8], patched.intOperands[8], patched.instructions[11]],
    [Opcodes.ICONST, 25, Opcodes.MULTIPLY],
    "the step sits under the callback, then the multiply",
);
assert.ok(!addZoomCallbacks(patched), "a patched script isn't patched twice");

// The patch in the VM: blocking returns before the zoom, and the step a listener puts on the
// stack is the one the script multiplies by.
const ZOOM = 902;
const zoom = script(ZOOM, [
    [Opcodes.ICONST, 0, null], [Opcodes.ILOAD, 0, null], [Opcodes.ICONST, 25, null],
    [Opcodes.MULTIPLY, 0, null], [Opcodes.SUB, 0, null],
    [Opcodes.SCONST, 0, "zoomed"], [Opcodes.RUNELITE_CALLBACK, 0, null],
    [Opcodes.RETURN, 0, null],
], 1, 1);
assert.ok(addZoomCallbacks(zoom));
const vm = new Cs2Vm({ widgetManager: { beginBatch() {}, endBatch() {} } } as any);
let block = false;
let step: number | undefined;
const zoomed: number[] = [];
vm.scriptCallbackListeners.add((_script, name) => {
    if (name === SCROLL_WHEEL_ZOOM_EVENT && block) vm.intStack[vm.intStackSize - 1] = 1;
    if (name === SCROLL_WHEEL_ZOOM_INCREMENT_EVENT && step !== undefined) vm.intStack[vm.intStackSize - 1] = step;
    if (name === "zoomed") zoomed.push(vm.intStack[--vm.intStackSize]);
});
vm.run(zoom, [2]);
step = 40;
vm.run(zoom, [2]);
block = true;
vm.run(zoom, [2]);
assert.deepEqual(zoomed, [-50, -80], "25 a notch, then the listener's 40, then blocked");

// --- Easing -------------------------------------------------------------------------------------

/** Turns at `speed` units/ms for 500ms, lets go; returns the first frame's turn and the coast. */
function turn(frameMs: number, speed: number, easeIn: number, easeOut: number) {
    const easing = new CameraEasing();
    const first = easing.update(speed * frameMs, 0, frameMs, easeIn, easeOut).yaw;
    let last = first;
    for (let t = frameMs; t < 500; t += frameMs) last = easing.update(speed * frameMs, 0, frameMs, easeIn, easeOut).yaw;
    let coast = 0;
    for (let t = 0; t < 3000; t += frameMs) coast += easing.update(0, 0, frameMs, easeIn, easeOut).yaw;
    assert.ok(!easing.isTurning(), "the camera comes to a stop");
    return { first, last, coast };
}
const at60 = turn(1000 / 60, 0.5, 60, 120);
assert.ok(at60.first < 0.5 * (1000 / 60) * 0.5, `eases in (${at60.first})`);
assert.ok(Math.abs(at60.last - 0.5 * (1000 / 60)) < 0.01, `reaches full speed (${at60.last})`);
assert.ok(at60.coast > 40 && at60.coast < 80, `eases out over about speed * easeOut (${at60.coast})`);
const at240 = turn(1000 / 240, 0.5, 60, 120);
assert.ok(Math.abs(at60.coast - at240.coast) / at240.coast < 0.1, `the same at 60 and 240 fps (${at60.coast}, ${at240.coast})`);
const instant = turn(1000 / 60, 0.5, 0, 0);
assert.deepEqual([instant.first, instant.coast], [0.5 * (1000 / 60), 0], "0 ms is no easing");

// --- The plugin against a fake client -----------------------------------------------------------

const varcs = new Map<number, number>();
const ran: [number, number[]][] = [];
const keys = new Set<string>();
const camera = {
    yaw: 0,
    pitch: 256,
    forcedAngleChanges: 0,
};
const client: any = {
    cameraShakeDisabled: false,
    isLoggedIn: () => true,
    varManager: {
        getVarcInt: (id: number) => varcs.get(id) ?? -1,
        setVarcInt: (id: number, value: number) => void varcs.set(id, value),
    },
    inputManager: {
        addKeyHandler: () => () => {},
        isKeyDown: (key: string) => keys.has(key),
        isCameraDragging: () => false,
    },
    runClientScriptWithInts: (id: number, args: number[]) => void ran.push([id, args]),
};
const config = inject(ConfigManager);
const set = (key: string, value: unknown) => {
    config.setConfigValue(CameraConfig, key, value);
    plugin.onConfigChanged(new ConfigChanged(CameraConfig.group, key, undefined, String(value)));
};
const plugin = new CameraPlugin(client);

async function main(): Promise<void> {
    await plugin.start();
    set("easing", false); // on by default; the options before the easing checks are tested alone

    // camera_set_zoom_limits(128, 896, 128, 896) ran: the defaults are kept, then widened.
    for (const id of [CAMERA_ZOOM_SMALL_MIN, CAMERA_ZOOM_BIG_MIN]) varcs.set(id, 128);
    for (const id of [CAMERA_ZOOM_SMALL_MAX, CAMERA_ZOOM_BIG_MAX]) varcs.set(id, 896);
    varcs.set(CAMERA_ZOOM_SMALL, 600);
    varcs.set(CAMERA_ZOOM_BIG, 700);
    plugin.onScriptFinished(605);
    assert.equal(varcs.get(CAMERA_ZOOM_BIG_MAX), 896, "unchanged with the options off");
    set("innerLimit", true);
    set("outerLimit", 100);
    assert.deepEqual(
        [CAMERA_ZOOM_SMALL_MIN, CAMERA_ZOOM_SMALL_MAX, CAMERA_ZOOM_BIG_MIN, CAMERA_ZOOM_BIG_MAX].map(id => varcs.get(id)),
        [28, 1400, 28, 1400],
    );
    assert.deepEqual(ran.at(-1), [42, [600, 700]], "re-zooms so narrowed limits clamp the zoom");

    // The wheel's callbacks.
    const stack = (top: number) => ({ intStack: [7, top], intStackSize: 2 }) as any;
    let wheel = stack(0);
    plugin.onScriptCallback({ eventName: SCROLL_WHEEL_ZOOM_EVENT, vm: wheel });
    assert.equal(wheel.intStack[1], 0, "zooms with Control function None");
    set("controlFunction", ControlFunction.CONTROL_TO_ZOOM);
    plugin.onScriptCallback({ eventName: SCROLL_WHEEL_ZOOM_EVENT, vm: wheel });
    assert.equal(wheel.intStack[1], 1, "Hold to zoom blocks the wheel without Control");
    wheel = stack(0);
    keys.add("ControlLeft");
    plugin.onScriptCallback({ eventName: SCROLL_WHEEL_ZOOM_EVENT, vm: wheel });
    assert.equal(wheel.intStack[1], 0, "and zooms with it");
    keys.clear();
    set("zoomIncrement", 50);
    wheel = stack(25);
    plugin.onScriptCallback({ eventName: SCROLL_WHEEL_ZOOM_INCREMENT_EVENT, vm: wheel });
    assert.equal(wheel.intStack[1], 50);

    // Control released resets the zoom.
    set("controlFunction", ControlFunction.CONTROL_TO_RESET);
    set("ctrlZoomValue", 2000);
    plugin.onKeyUp({ code: "ControlRight" } as KeyboardEvent);
    assert.deepEqual(ran.at(-1), [42, [1400, 1400]], "clamped to the inner limit");

    // Speed and inverted mouse axes.
    const rotation = (fields: Partial<CameraRotation>): CameraRotation => ({
        camera: camera as any, deltaTime: 16, keyYaw: 0, keyPitch: 0, dragYaw: 0, dragPitch: 0, ...fields,
    });
    set("cameraSpeed", 2);
    set("invertYaw", true);
    let r = rotation({ keyYaw: 10, keyPitch: 5, dragYaw: 3, dragPitch: 4 });
    plugin.transformCameraRotation(r);
    assert.deepEqual([r.keyYaw, r.keyPitch, r.dragYaw, r.dragPitch], [20, 10, -6, 8], "keys aren't inverted");
    set("cameraSpeed", 0.5);
    r = rotation({ keyYaw: 10 });
    plugin.transformCameraRotation(r);
    assert.equal(r.keyYaw, 5, "a fractional speed survives the config store");
    set("cameraSpeed", 1);
    set("invertYaw", false);

    // Easing: eases into a turn and out of it, and drops it when something else turns the camera.
    set("easing", true);
    set("easeFrom", EaseFrom.KEYS);
    const frame = (fields: Partial<CameraRotation>) => {
        const next = rotation(fields);
        plugin.transformCameraRotation(next);
        camera.yaw += next.keyYaw + next.dragYaw;
        camera.pitch += next.keyPitch + next.dragPitch;
        return next;
    };
    const start = frame({ keyYaw: 8 });
    assert.ok(start.keyYaw + start.dragYaw < 8, "starts slower than the key turns");
    for (let i = 0; i < 30; i++) frame({ keyYaw: 8 });
    // HD's follow camera rewrites the yaw as it smooths: not a forced turn, the speed holds.
    camera.yaw -= 40;
    assert.ok(frame({ keyYaw: 8 }).dragYaw > 7.9, "a smoothed yaw doesn't drop the turn");
    const after = frame({});
    assert.ok(after.dragYaw > 3, `keeps turning after letting go (${after.dragYaw})`);
    camera.yaw += 500; // cam_forceangle
    camera.forcedAngleChanges++;
    assert.equal(frame({}).dragYaw, 0, "a forced angle drops the turn");
    assert.equal(frame({ dragYaw: 8 }).dragYaw, 8, "Ease: arrow keys leaves the mouse as it is");

    // Off again: shake back on and the cache's limits restored.
    set("disableCameraShake", true);
    assert.equal(client.cameraShakeDisabled, true);
    await plugin.stop();
    assert.equal(client.cameraShakeDisabled, false);
    assert.deepEqual(
        [CAMERA_ZOOM_SMALL_MIN, CAMERA_ZOOM_SMALL_MAX, CAMERA_ZOOM_BIG_MIN, CAMERA_ZOOM_BIG_MAX].map(id => varcs.get(id)),
        [128, 896, 128, 896],
    );

    console.log("camera plugin: ok");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
