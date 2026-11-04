import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { SoundEffectSystem } from "../game/audio/SoundEffectSystem";
import { PlayerEcs } from "../game/ecs/PlayerEcs";
import { PlayerMovementSync } from "../game/movement/PlayerMovementSync";
import { PlayerSyncManager } from "../game/sync/PlayerSyncManager";

// Exercise the actual network subscription without booting the renderer/browser-only imports.
const source = fs.readFileSync("game/OsrsClient.ts", "utf8");
const start = source.indexOf("const unsubSound = subscribeSound(");
const end = source.indexOf("this.unsubscribeSound = unsubSound;", start) + "this.unsubscribeSound = unsubSound;".length;
assert.ok(start >= 0 && end > start);
let receive: (payload: any) => void;
let receiptListener: [number, number, number] | undefined;
let receiptTile: { tileX: number; tileY: number } | undefined;
let cameraTarget: { x: number; y: number; level: number } | undefined;
const system: any = new SoundEffectSystem({ available: () => true } as any);
const ctx = { state: "running", currentTime: 0 };
system.ensureContext = () => ctx;
system.decode = () => ({ onsetSec: 0, channelData: new Float32Array([1]), sampleRate: 22050 });
const plays: any[] = [];
system.startOneShot = (...args: any[]) => plays.push({ gain: args[2], delay: args[3], loops: args[4], area: args[5] });
new Function("subscribeSound", ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText).call({ soundEffectSystem: system, updateSoundListener() {
    if (receiptListener) system.updateListenerPosition(...receiptListener);
}, getControlledPlayerMovementTile() { return receiptTile; }, getCameraTargetPosition() { return cameraTarget; } }, (cb: typeof receive) => { receive = cb; return () => {}; });

system.updateListenerPosition(64, 64, 0);
receive!({ soundId: 513, x: 0, y: 0, level: 0, loops: 1, delay: 0, radius: 0 });
assert.deepEqual(plays, [], "native positioned radius zero is silent; it must not become a private synth");
receive!({ soundId: 513, loops: 1, delay: 0, radius: 0 });
assert.deepEqual(plays, [{ gain: 1, delay: 0, loops: 0, area: false }], "unpositioned synths retain the effects bus");
plays.length = 0;
system.updateListenerPosition(448, 64, 0);
receive!({ soundId: 513, x: 0, y: 0, loops: 3, delay: 0, radius: 5 });
assert.deepEqual(plays, [{ gain: 0.6, delay: 0, loops: 2, area: true }], "positioned sounds retain native loops, distance fade and area bus");

const timers: Array<() => void> = [];
const realTimeout = globalThis.setTimeout;
(globalThis as any).setTimeout = (fn: () => void) => { timers.push(fn); return 1; };
try {
    plays.length = 0;
    system.decode = () => ({ onsetSec: 0.02, channelData: new Float32Array([1]), sampleRate: 22050 });
    system.updateListenerPosition(64, 64, 0);
    const scratch = { x: 64, y: 64, z: 0 };
    system.playSoundEffect(513, { position: scratch, radius: 640 });
    scratch.x = 448;
    system.playSoundEffect(513, { position: scratch, radius: 640 });
    scratch.x = 10000;
    assert.equal(timers.length, 2);
    timers.splice(0).forEach(fn => fn());
    assert.deepEqual(plays.map(p => [p.gain, p.area]), [[1, true], [0.6, true]],
        "each queued sequence keeps its emitted position when the caller reuses its scratch object");
    plays.length = 0;
    system.decode = () => ({ onsetSec: 0, channelData: new Float32Array([1]), sampleRate: 22050 });
    system.updateListenerPosition(10 * 128 + 64, 64, 0);
    receiptListener = [64, 64, 0];
    receive!({ soundId: 513, x: 0, y: 0, loops: 1, delay: 10, radius: 5 });
    assert.equal(timers.length, 1, "receipt refresh sees an actor that moved into range between client ticks");
    timers.splice(0).forEach(fn => fn());
    plays.length = 0;
    receiptListener = [10 * 128 + 64, 64, 0];
    receive!({ soundId: 513, x: 0, y: 0, loops: 1, delay: 10, radius: 5 });
    assert.equal(timers.length, 0, "receipt refresh rejects an actor that moved out of range between client ticks");
    receiptListener = undefined;
    for (const [x, y] of [[10, 0], [7, 0], [0, 7], [-7, 0], [6, 7]]) {
        system.updateListenerPosition(x * 128 + 64, y * 128 + 64, 0);
        receive!({ soundId: 513, x: 0, y: 0, loops: 1, delay: 10, radius: 5 });
        assert.equal(timers.length, 0, "outside native radius+1 at receipt never queues a delayed sound");
    }
    for (const [x, y] of [[6, 0], [0, 6], [6, 6], [-6, -6]]) {
        system.updateListenerPosition(x * 128 + 64, y * 128 + 64, 0);
        receive!({ soundId: 513, x: 0, y: 0, loops: 1, delay: 10, radius: 5 });
        assert.equal(timers.length, 1, "native inclusive radius+1 bounds admit axial and diagonal edges");
        system.updateListenerPosition(64, 64, 0);
        timers.splice(0).forEach(fn => fn());
        assert.equal(plays[plays.length - 1].gain, 1, "an admitted sound uses the listener's playback position");
    }
    plays.length = 0;
    receive!({ soundId: 513, x: 0, y: 0, loops: 1, delay: 10, radius: 5 });
    system.updateListenerPosition(10000, 64, 0);
    timers.splice(0).forEach(fn => fn());
    assert.deepEqual(plays, [], "the listener's current position still determines audibility at playback");

    // Receiving a movement step updates native pathX/Y[0] before its drawing position moves.
    const ecs = new PlayerEcs();
    const index = ecs.allocatePlayer(7);
    const movement = new PlayerMovementSync(ecs);
    const sync = new PlayerSyncManager({ ecs, movementSync: movement });
    for (const [from, to, admitted] of [[7, 6, true], [6, 7, false]] as const) {
        ecs.teleport(index, from, 0, 0);
        movement.registerEntity({ serverId: 7, ecsIndex: index, tile: { x: from, y: 0 },
            level: 0, subX: from * 128 + 64, subY: 64 });
        movement.receiveUpdate({ serverId: 7, ecsIndex: index, subX: to * 128 + 64, subY: 64,
            level: 0, directions: [to < from ? 3 : 4], traversals: [1], moved: true });
        receiptTile = sync.getServerTile(7);
        assert.equal(receiptTile?.tileX, to, "authoritative tile changes when the step arrives");
        assert.equal(ecs.getX(index), from * 128 + 64, "drawing still waits for interpolation");
        receiptListener = [ecs.getX(index), ecs.getY(index), 0];
        receive!({ soundId: 513, x: 0, y: 0, loops: 1, delay: 60, radius: 5 });
        assert.equal(timers.length, admitted ? 1 : 0, "receipt uses the latest path tile in both directions");
        if (admitted) {
            system.updateListenerPosition(4 * 128 + 64, 64, 0);
            timers.splice(0).forEach(fn => fn());
            assert.equal(plays[plays.length - 1].gain, 0.4, "admitted delayed sound uses the drawing position at playback");
        }
    }
    receiptTile = { tileX: 100, tileY: 100 };
    cameraTarget = { x: 64, y: 64, level: 0 };
    receiptListener = [cameraTarget.x, cameraTarget.y, cameraTarget.level * 128];
    receive!({ soundId: 513, x: 0, y: 0, loops: 1, delay: 10, radius: 5 });
    assert.equal(timers.length, 1, "a resolved spectator camera target retains receipt admission near its emitter");
    timers.splice(0).forEach(fn => fn());
    assert.equal(plays[plays.length - 1].gain, 1, "the followed target remains the playback listener");
    cameraTarget = undefined;
    receive!({ soundId: 513, x: 0, y: 0, loops: 1, delay: 10, radius: 5 });
    assert.equal(timers.length, 0, "an unresolved camera target falls back to the controlled player's latest tile");
    receiptTile = undefined;
    receiptListener = undefined;
} finally {
    globalThis.setTimeout = realTimeout;
}

void (async () => {
    let release: (raw: object) => void = () => {};
    const loaded = new Promise<object>(resolve => { release = resolve; });
    const cold: any = new SoundEffectSystem({ available: () => true, loadWithRetry: () => loaded } as any);
    cold.ensureContext = () => ctx;
    cold.decode = (_id: number, raw?: object) => raw
        ? { onsetSec: 0, channelData: new Float32Array([1]), sampleRate: 22050 } : undefined;
    const retried: any[] = [];
    cold.startOneShot = (...args: any[]) => retried.push([args[2], args[5]]);
    cold.updateListenerPosition(64, 64, 0);
    const scratch = { x: 64, y: 64, z: 0 };
    cold.playSoundEffect(513, { position: scratch, radius: 640 });
    scratch.x = 10000;
    release({});
    await loaded;
    await Promise.resolve();
    assert.deepEqual(retried, [[1, true]], "a cache retry retains the emitted source, rather than the caller's reused coordinates");
    console.log("Server sound boundary tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

