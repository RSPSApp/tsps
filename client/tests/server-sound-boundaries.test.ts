import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { SoundEffectSystem } from "../game/audio/SoundEffectSystem";

// Exercise the actual network subscription without booting the renderer/browser-only imports.
const source = fs.readFileSync("game/OsrsClient.ts", "utf8");
const start = source.indexOf("const unsubSound = subscribeSound(");
const end = source.indexOf("this.unsubscribeSound = unsubSound;", start) + "this.unsubscribeSound = unsubSound;".length;
assert.ok(start >= 0 && end > start);
let receive: (payload: any) => void;
const system: any = new SoundEffectSystem({ available: () => true } as any);
const ctx = { state: "running", currentTime: 0 };
system.ensureContext = () => ctx;
system.decode = () => ({ onsetSec: 0, channelData: new Float32Array([1]), sampleRate: 22050 });
const plays: any[] = [];
system.startOneShot = (...args: any[]) => plays.push({ gain: args[2], delay: args[3], loops: args[4], area: args[5] });
new Function("subscribeSound", ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText).call({ soundEffectSystem: system }, (cb: typeof receive) => { receive = cb; return () => {}; });

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
    receive!({ soundId: 513, x: 0, y: 0, loops: 1, delay: 10, radius: 5 });
    system.updateListenerPosition(10000, 64, 0);
    timers.splice(0).forEach(fn => fn());
    assert.deepEqual(plays, [], "the listener's current position still determines audibility at playback");
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

