import assert from "node:assert/strict";

import { PlayerEcs } from "../game/ecs/PlayerEcs";
import { Gender, PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { SPEAKER_HEAD_ICONS } from "../game/plugins/voice/speakerIcon";
import { RenderPhase } from "../ui/devoverlay/Overlay";
import { OverheadPrayerLayer } from "../render/webgpu/overlays/OverheadPrayerLayer";

Object.assign(globalThis, { self: globalThis });
// The browser build's PicoGL shim exposes the constants as a named export.
const pico = require("picogl");
pico.PicoGL = pico;
const { OverheadPrayerOverlay } = require("../ui/devoverlay/OverheadPrayerOverlay");

const players = new PlayerEcs();
const index = players.allocatePlayer(1);

assert.equal(players.getHeadIconPk(index), -1);
players.setHeadIconPk(index, -1);
assert.equal(players.getHeadIconPk(index), -1, "the no-skull value must remain -1");

players.setHeadIconPk(index, 0);
assert.equal(players.getHeadIconPk(index), 0, "white skulls use sprite index 0");

const appearance = new PlayerAppearance(
    Gender.MALE,
    [0, 0, 0, 0, 0],
    new Array(7).fill(-1),
    new Array(14).fill(-1),
    { prayer: 2, skull: 1 },
);
players.setAppearance(index, appearance);
assert.equal(players.getHeadIconPk(index), 1, "appearance skull state must be authoritative");

players.setHeadIconPk(index, -1);
assert.equal(appearance.headIcons.skull, -1);
assert.equal(players.getHeadIconPk(index), -1, "clearing a skull must update appearance state");

const entry = { worldX: 0, worldZ: 0, plane: 0, groupKey: 1, heightOffsetTiles: 0.9,
    headIconPk: 0, headIconPrayer: 2, customHeadIcons: SPEAKER_HEAD_ICONS };
const stacks = new Map<number, number>();
const args: any = { state: { playerLevel: 0, overheadPrayers: [entry], actor2dStacks: stacks },
    helpers: { getMinTileHeightInRadius: () => 0, worldToScreen: () => [0, 0] } };
let uploads = 0;
let releases = 0;
const nativeSprite: any = { tex: {}, w: 24, h: 24, width: 24, height: 24 };
const glY: number[] = [];
const gl = new OverheadPrayerOverlay({} as any, {} as any);
Object.assign(gl, {
    app: { width: 100, height: 100, enable() {}, disable() {},
        createTexture2D(pixels: Uint8Array, width: number, height: number) {
            uploads++;
            assert.equal(width, 24);
            assert.equal(height, 24);
            assert.equal(pixels[3], 0, "speaker background remains transparent");
            return { delete() { releases++; } };
        } },
    getSprite: (_kind: string, index: number) => index >= 0 ? nativeSprite : undefined,
    positions: { data(vertices: Float32Array) { glY.push(vertices[1]); } },
    uvs: { data() {} },
    drawCall: { uniform() { return this; }, texture() { return this; }, draw() {} },
});
gl.update(args);
gl.draw(RenderPhase.PostPresent);
assert.deepEqual(glY, [-30, -55, -80], "WebGL stacks the speaker above the skull and prayer");
assert.equal(stacks.get(1), 80);
stacks.clear();
gl.draw(RenderPhase.PostPresent);
assert.equal(uploads, 1, "WebGL reuses the custom sprite texture between frames");
gl.dispose();
assert.equal(releases, 1, "WebGL releases the custom texture on disposal");

uploads = releases = 0;
stacks.clear();
const gpuY: number[] = [];
const gpu = new OverheadPrayerLayer({ overheadPrayerOutput: [entry], buildUpdateArgs: () => args } as any,
    { createPixelTexture() { uploads++; return nativeSprite; },
        queueTexture(_: unknown, _x: number, y: number) { gpuY.push(y); },
        releaseTexture() { releases++; } } as any);
Object.assign(gpu, { getSprite: (_kind: string, index: number) => index >= 0 ? nativeSprite : undefined });
gpu.draw();
assert.deepEqual(gpuY, [-30, -55, -80], "WebGPU uses the same headicon stack");
stacks.clear();
gpu.draw();
assert.equal(uploads, 1, "WebGPU reuses the custom sprite texture between frames");
entry.headIconPk = entry.headIconPrayer = -1;
stacks.clear();
const beforeSolo = gpuY.length;
gpu.draw();
assert.deepEqual(gpuY.slice(beforeSolo), [-30], "the speaker can render without any native headicon");
entry.plane = 1;
const drawn = gpuY.length;
gpu.draw();
assert.equal(gpuY.length, drawn, "headicons on another floor stay hidden");
gpu.dispose();
assert.equal(releases, 1, "WebGPU releases the custom texture on disposal");

console.log("player head icon test passed");
