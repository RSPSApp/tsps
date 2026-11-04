import assert from "node:assert/strict";
import { vec4 } from "gl-matrix";

import { Camera } from "../game/Camera";
import { sampleActorHeightForWorldTile, sampleBridgeHeightForWorldTile, sampleCameraHeightForWorldTile } from "../game/scene/BridgeHeightSampler";
import { handleInboundWorld } from "../network/serverConnection/handlers/inboundWorld";

const previousClient = (globalThis as any).__osrsClient;
const camera = new Camera(0, 0, 0, 200, 0);
let shakesCleared = 0;
// The current plane has ground height -8 tiles; camera packet heights are
// offsets above the sampled ground, rather than absolute world elevations.
const map = {
    mapX: 50, mapY: 52, heightMapSize: 66, borderSize: 0,
    heightMapData: new Int16Array(4 * 66 * 66).fill(128),
};
const client = {
    camera, followPlayerCamera: true, controlledPlayerServerId: 7,
    playerEcs: { getIndexForServerId: () => 2, getLevel: (index: number) => { assert.equal(index, 2); return 1; } },
    renderer: { mapManager: { getMapForWorldTile: () => map }, clearCameraShake: () => { shakesCleared++; } },
};
(globalThis as any).__osrsClient = client;
const apply = (payload: object) => assert.equal(handleInboundWorld({ type: "camera", payload }), true);

try {
    for (const instant of [true, false]) {
        for (const [dx, dz, height] of [[4, 0, 128], [-4, 0, 128], [0, 4, 128], [0, -4, 128], [3, 4, 640]]) {
            camera.setScenePitchOverride(300); // Existing terrain pressure must not mask the scene.
            camera.setViewPitchOverride(-100); // Nor may an existing first-person view angle.
            apply({ mode: "move", x: 3227, y: 3369, height: 384, instant: true });
            assert.equal(client.followPlayerCamera, false);
            assert.deepEqual([...camera.pos], [3227.5, -11, 3369.5]);
            apply({ mode: "look", x: 3227 + dx, y: 3369 + dz, height, instant });
            camera.applySmoothing(10_000);
            camera.update(800, 600);
            const target = vec4.fromValues(3227.5 + dx, -8 - height / 128, 3369.5 + dz, 1);
            const inView = vec4.transformMat4(vec4.create(), target, camera.viewMatrix);
            assert.ok(inView[2] < 0, `target must be in front of the camera (${dx},${dz},${height})`);
            assert.ok(Math.abs(inView[0]) < 0.03 && Math.abs(inView[1]) < 0.03,
                `look target must be centred, including shallow/downward/upward angles: ${[...inView]}`);
        }
    }
    apply({ mode: "reset" });
    assert.equal(client.followPlayerCamera, true);
    assert.equal(camera.getScenePitchOverride(), undefined);
    assert.equal(camera.getViewPitchOverride(), undefined);
    assert.equal(shakesCleared, 1);

    apply({ mode: "move", x: 3227, y: 3369, height: 300, rate: 232, rate2: 232, heightRelative: false });
    assert.deepEqual([...camera.pos], [3227.5, -8 - 300 / 128, 3369.5]);
    apply({ mode: "move", x: 3227, y: 3369, height: -25, rate: 232, rate2: 232, heightRelative: true });
    assert.equal(camera.getPosY(), -8 - 275 / 128, "relative heights accumulate per camera command type");
    apply({ mode: "look", x: 3232, y: 3369, height: 100, rate: 232, rate2: 232, heightRelative: false });
    assert.equal(camera.getScenePitchAngle(), 128, "locked scene pitch retains OSRS's lower limit");
    apply({ mode: "unlock", unlock: true });
    apply({ mode: "look", x: 3232, y: 3369, height: 0, rate: 232, rate2: 232, heightRelative: true });
    assert.ok(camera.getScenePitchAngle() < 128, "cam_unlock permits the captured shallow angles");
    assert.equal(camera.resolveScriptedHeight("move", 0, true), 275, "look packets do not alter move height history");
    apply({ mode: "move", x: 3237, y: 3369, height: 275, rate: 10, rate2: 15, heightRelative: false });
    const beforeReset = [...camera.pos];
    apply({ mode: "reset" });
    camera.applySmoothing(1000);
    assert.deepEqual([...camera.pos], beforeReset, "reset cancels an unfinished pan");
    assert.equal(camera.resolveScriptedHeight("move", 0, true), 0, "reset clears relative height history");
} finally {
    (globalThis as any).__osrsClient = previousClient;
}
console.log("scripted camera look geometry: ok");

const moving = new Camera(0, 0, 0, 256, 2040);
moving.setScriptedPosition(10, 0, 0, 10, 15);
moving.applySmoothing(19);
assert.equal(moving.getPosX(), 0, "camera movement advances at client cycles, not render-frame count");
moving.applySmoothing(1);
assert.equal(moving.getPosX(), 29 / 128, "first cycle = floor(1280 * 15/1000) + 10 fine units");
moving.applySmoothing(20);
assert.equal(moving.getPosX(), 57 / 128, "the proportional component shrinks with the remaining distance");

const whole = new Camera(0, 0, 0, 256, 0), split = new Camera(0, 0, 0, 256, 0);
for (const subject of [whole, split]) subject.setScriptedPosition(10, -5, -3, 6, 0);
whole.applySmoothing(120);
for (const elapsed of [7, 13, 16, 14, 30, 40]) split.applySmoothing(elapsed);
assert.deepEqual([...whole.pos], [...split.pos], "camera trajectories are independent of frame rate");
assert.equal(whole.getPosX(), 36 / 128, "rate2=0 still moves at the recorded constant rate");
whole.setScriptedPosition(10, 0, 0, 0, 0);
const stationary = [...whole.pos];
whole.applySmoothing(1000);
assert.deepEqual([...whole.pos], stationary, "zero/zero holds the current shot");

const turning = new Camera(0, 0, 0, 256, 2040);
const angle = 10 * Math.PI * 2 / 2048;
turning.setScriptedLook(Math.sin(angle) * 100, 0, Math.cos(angle) * 100, 1, 0);
turning.applySmoothing(20);
assert.equal(turning.getYaw(), 2041, "turning takes the short route across the yaw seam");
turning.setScriptedLook(0, 10, 0, 2, 0);
const oldPitch = turning.getScenePitchAngle();
turning.applySmoothing(20);
assert.equal(turning.getScenePitchAngle(), oldPitch + 2, "pitch eases with its own captured rates");

const tracking = new Camera(0, 0, 0, 256, 0);
tracking.setScriptedLook(10, 0, 10, 232, 232);
const firstYaw = tracking.getYaw();
tracking.setScriptedPosition(10, 0, 0, 10, 0);
tracking.applySmoothing(200);
assert.ok(tracking.getYaw() < firstYaw, "a stationary look target is recomputed while the camera moves");
tracking.applySmoothing(10000);
assert.equal(tracking.getPosX(), 10, "movement clamps at the target without overshoot");
assert.equal(tracking.getYaw(), 0, "the final look angle follows the moved camera position");
const privateShot = new Camera(5376, -10, -8000, 256, 0), publicShot = new Camera(0, -10, 0, 256, 0);
for (const [subject, dx, dz] of [[privateShot, 5376, -8000], [publicShot, 0, 0]] as const) {
    subject.setScriptedPosition(dx + 10, -5, dz + 10, 2, 2);
    subject.setScriptedLook(dx + 15, -1, dz + 10, 2, 2);
    subject.applySmoothing(160);
}
privateShot.translateScriptedCamera(-5376, 8000);
for (const subject of [privateShot, publicShot]) subject.applySmoothing(400);
assert.deepEqual([...privateShot.pos], [...publicShot.pos], "private-scene return preserves the in-flight pan");
assert.equal(privateShot.getYaw(), publicShot.getYaw(), "the look target is rebased with the camera");
assert.equal(privateShot.getScenePitchAngle(), publicShot.getScenePitchAngle());
console.log("scripted camera captured rates: ok");


for (const [initialYaw, targetX, targetZ, expectedYaw] of [[1024, 0, 10, 1023], [513, -10, 0, 514]]) {
    const opposite = new Camera(0, 0, 0, 256, initialYaw);
    opposite.setScriptedLook(targetX, 0, targetZ, 1, 0);
    opposite.applySmoothing(20);
    assert.equal(opposite.getYaw(), expectedYaw, 'exact half-turns preserve OSRS signed yaw difference');
}

const receiptOnly = new Camera(0, 0, 0, 256, 0);
receiptOnly.setScriptedLook(1, 0, 0, 0, 100);
assert.equal(receiptOnly.getYaw(), 511, 'rate2>=100 snaps the look angle on receipt');
receiptOnly.setScriptedPosition(10, 0, 0, 1000, 0);
receiptOnly.applySmoothing(20);
assert.equal(receiptOnly.getYaw(), 409, 'subsequent cycles apply rates even when rate2>=100');
receiptOnly.setScriptedPosition(10, 0, 0, 0, 100);
receiptOnly.snapToPosition(0, 0, 0);
receiptOnly.applySmoothing(20);
assert.equal(receiptOnly.getPosX(), 1, 'position threshold also snaps only on receipt');

const slopeData = new Int16Array(4 * 66 * 66);
slopeData[66 + 1] = 16; // h11=128 fine units, the other three vertices are zero.
const slopeMap = { mapX: 50, mapY: 52, heightMapSize: 66, borderSize: 0, heightMapData: slopeData };
const slopeManager = { getMapForWorldTile: () => slopeMap } as any;
assert.equal(sampleCameraHeightForWorldTile(slopeManager, 3200.5, 3328.5, 0), -32 / 128,
    'camera uses integer bilinear height at a non-flat tile centre');
assert.equal(sampleBridgeHeightForWorldTile(slopeManager, 3200.5, 3328.5, 0).height, -64 / 128,
    'terrain sampling stays unchanged');

assert.equal(sampleActorHeightForWorldTile(slopeManager, 3200.5, 3328.5, 0).height, -32 / 128,
    'actor and scripted camera origins use native bilinear grounding');

let terrainReady = false, terrainPlane = 0;
const delayedCamera = new Camera(10, -2, 20, 256, 0);
const delayedClient = {
    camera: delayedCamera, followPlayerCamera: true, controlledPlayerServerId: 7,
    playerEcs: { getIndexForServerId: () => 2, getLevel: () => terrainPlane },
    renderer: { mapManager: { getMapForWorldTile: () => terrainReady ? map : undefined } },
};
(globalThis as any).__osrsClient = delayedClient;
try {
    apply({ mode: 'look', x: 3232, y: 3369, height: 100, rate: 232, rate2: 232, heightRelative: false });
    apply({ mode: 'move', x: 3227, y: 3369, height: 300, rate: 232, rate2: 232, heightRelative: false });
    delayedCamera.applySmoothing(1000);
    assert.deepEqual([...delayedCamera.pos], [3227.5, -2, 3369.5],
        'a cold instant scene centres map streaming on its target without inventing ground-zero height');
    terrainPlane = 1; terrainReady = true;
    delayedCamera.applySmoothing(0);
    assert.deepEqual([...delayedCamera.pos], [3227.5, -8 - 300 / 128, 3369.5],
        'loaded terrain applies the deferred receipt snap, including look-before-move order');
    assert.equal(delayedCamera.getYaw(), 511);
    map.heightMapData.fill(160);
    delayedCamera.applySmoothing(20);
    assert.equal(delayedCamera.getPosY(), -10 - 300 / 128, 'active shots resample terrain after loading/rebuild');
} finally {
    map.heightMapData.fill(128);
    (globalThis as any).__osrsClient = previousClient;
}

const sampledTiles: number[][] = [];
const relocate = new Camera(5386.5, -3, -7989.5, 256, 0);
const afterRelocation = (x: number, z: number) => {
    sampledTiles.push([x, z]);
    return x >= 5000 ? undefined : -12;
};
relocate.setScriptedPosition(5386.5, 0, -7989.5, 232, 232, afterRelocation);
relocate.setScriptedLook(5396.5, 0, -7989.5, 232, 232, afterRelocation);
relocate.translateScriptedCamera(-5376, 8000);
relocate.applySmoothing(0);
assert.deepEqual([...relocate.pos], [10.5, -12, 10.5]);
assert.deepEqual(sampledTiles.slice(-2), [[10.5, 10.5], [20.5, 10.5]],
    'terrain refresh follows translated public targets, rather than closed-over private coordinates');
console.log('scripted camera terrain refresh and OSRS rate boundaries: ok');

// Cycle camera packets use eased endpoint interpolation, independent of frame rate.
const easedWhole = new Camera(0, -2, 0, 256, 2040), easedSplit = new Camera(0, -2, 0, 256, 2040);
for (const subject of [easedWhole, easedSplit]) {
    subject.setScriptedPositionCycles(10, 20, 10, "ease_in_out_sine", true, () => -6, 768);
    subject.setScriptedLookCycles(10, 20, 10, "ease_out_cubic", false, () => -6);
}
easedWhole.applySmoothing(100);
for (const elapsed of [7, 13, 16, 14, 30, 20]) easedSplit.applySmoothing(elapsed);
assert.deepEqual([...easedWhole.pos], [5, -4, 10], "sine halfway reaches the midpoint");
assert.deepEqual([...easedWhole.pos], [...easedSplit.pos]);
assert.equal(easedWhole.getYaw(), easedSplit.getYaw());
easedWhole.applySmoothing(100);
assert.deepEqual([...easedWhole.pos], [10, -6, 20]);
assert.equal(easedWhole.getYaw(), 151, "rotate-to freezes the command-time target angle even as the camera moves");
easedWhole.clearScriptedCamera();
const frozen = [...easedWhole.pos];
easedWhole.applySmoothing(1000);
assert.deepEqual([...easedWhole.pos], frozen, "reset cancels cycle interpolation");
const terrainPan = new Camera(0, -3, 0, 256, 0);
terrainPan.setScriptedPositionCycles(10, 0, 10, "linear", false, x => x * 2 - 5, 640);
terrainPan.applySmoothing(100);
assert.deepEqual([...terrainPan.pos], [5, 6, 0], "terrain-aware movement interpolates the height offset while sampling intermediate terrain");
terrainPan.applySmoothing(100);
assert.deepEqual([...terrainPan.pos], [10, 15, 0]);
const speakerTurn = new Camera(0, -2, 0, 256, 0);
speakerTurn.setScriptedPosition(3257.5, 0, 3449.5, 232, 100, () => -2);
speakerTurn.setScriptedLook(3256.5, 0, 3449.5, 232, 100, () => -2);
speakerTurn.applySmoothing(20);
const facingHaig = speakerTurn.getYaw();
speakerTurn.rotateScriptedBy(0, 1024, 5, "linear");
speakerTurn.applySmoothing(40);
assert.ok(speakerTurn.getYaw() !== facingHaig && speakerTurn.getYaw() !== (facingHaig + 1024) % 2048, "cam_rotateby turns over its cycles");
speakerTurn.applySmoothing(60);
// Within the look's own integer-angle truncation (1537 west, 511 east).
assert.ok(Math.abs(speakerTurn.getYaw() - (facingHaig + 1024) % 2048) <= 2, "cam_rotateby turns half a circle to the other speaker");
speakerTurn.rotateScriptedBy(0, -1024, 5, "ease_out_sine");
speakerTurn.applySmoothing(100);
assert.equal(speakerTurn.getYaw(), facingHaig, "and back");
// cam_moveto_arc (The Heart of Darkness's nagua pan): the camera swings about the centre, not across it.
const arc = new Camera(0, 0, 0, 256, 0);
arc.snapToPosition(10, -4, 0);
arc.setScriptedPositionArc(0, 0, -10, 0, 10, "linear", () => 0, 512);
arc.applySmoothing(100); // half way
assert.ok(Math.abs(Math.hypot(arc.pos[0], arc.pos[2]) - 10) < 0.05, "half way round the arc keeps its radius");
assert.ok(Math.abs(arc.pos[2]) > 9, "and is off the straight line between the ends");
arc.applySmoothing(100);
assert.ok(Math.abs(arc.pos[0] + 10) < 0.01 && Math.abs(arc.pos[2]) < 0.01, "and lands on its target");
const terrainArc = new Camera(10, 100, 0, 256, 0);
terrainArc.setScriptedPositionArc(0, 0, -10, 0, 10, "linear", x => x * x, 0, false);
terrainArc.applySmoothing(100);
assert.ok(Math.abs(terrainArc.pos[1]) < 0.01, "terrain-aware arcs follow the ground along the curve");
console.log("cycle camera easing and rotation: ok");
