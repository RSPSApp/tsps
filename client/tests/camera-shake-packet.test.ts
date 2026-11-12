import assert from "node:assert/strict";

import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import {
    encodeCameraReset,
    encodeCameraShake,
    encodeCameraTarget,
    encodeCameraMoveTo,
    encodeCameraLookAt,
    encodeCameraUnlock,
    encodeCameraTranslate,
    encodeCameraRotateBy,
    encodeCameraMoveArc,
    encodeCameraRotateToCoordinate,
    encodeCameraSkybox,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// A coordinate rotation freezes command-time angles; it is not CAM_LOOKAT_CYCLES.
assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraRotateToCoordinate(3356, 2208, 1023, 150, "ease_out_sine"))), {
    type: "camera", payload: { mode: "rotate_coordinate", x: 3356, y: 2208, height: 1023, cycles: 150, easing: "ease_out_sine" },
});
assert.throws(() => encodeCameraRotateToCoordinate(3356, 2208, 1023, 0, "linear"), RangeError);
assert.throws(() => encodeCameraRotateToCoordinate(3356, 2208, 32768, 150, "linear"), RangeError);

// The server's camera shake and reset reach the client's CAMERA_CONTROL decoder intact.
const shake = decodeServerPacket(new Uint8Array(encodeCameraShake(1, 7, 0, 0))) as any;
assert.deepEqual(shake, {
    type: "camera",
    payload: { mode: "shake", slot: 1, randomAmplitude: 7, sineAmplitude: 0, sineFrequency: 0 },
});

// cam_skybox: a model id, and -1 to clear it (Crab Quest's dance sends 61359, then -1).
assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraSkybox(61359))), { type: "camera", payload: { mode: "skybox", model: 61359 } });
assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraSkybox(-1))), { type: "camera", payload: { mode: "skybox", model: -1 } });
assert.throws(() => encodeCameraSkybox(-2), RangeError);

const reset = decodeServerPacket(new Uint8Array(encodeCameraReset())) as any;
assert.deepEqual(reset, { type: "camera", payload: { mode: "reset" } });

// cam_target: a spectator's camera on a room's middle or on the fighter they follow.
assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraTarget({ x: 4127, y: 5673, level: 1 }))), {
    type: "camera", payload: { mode: "target", x: 4127, y: 5673, level: 1 },
});
assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraTarget({ player: 1766 }))), {
    type: "camera", payload: { mode: "target", player: 1766 },
});
// A Barracuda Trial intro's roaming camera NPC, and a boat, by index.
assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraTarget({ npc: 9012 }))), {
    type: "camera", payload: { mode: "target", npc: 9012 },
});
assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraTarget({ worldEntity: 3004 }))), {
    type: "camera", payload: { mode: "target", worldEntity: 3004 },
});
// A cutscene's camera tour: a tile glided to over client cycles.
assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraTarget({ x: 2994, y: 2891, level: 0, cycles: 150 }))), {
    type: "camera", payload: { mode: "target", x: 2994, y: 2891, level: 0, cycles: 150 },
});

for (const [encode, mode] of [[encodeCameraMoveTo, "move"], [encodeCameraLookAt, "look"]] as const) {
    for (const instant of [true, false]) {
        assert.deepEqual(decodeServerPacket(new Uint8Array(encode(2850, 10230, 1200, instant))), {
            type: "camera", payload: { mode, x: 2850, y: 10230, height: 1200, instant },
        });
    }
    for (const options of [{ rate: 10, rate2: 15, heightRelative: false }, { rate: 6, rate2: 0, heightRelative: true }, { rate: 232, rate2: 232, heightRelative: false }]) {
        assert.deepEqual(decodeServerPacket(new Uint8Array(encode(2850, 10230, -200, options))), {
            type: "camera", payload: { mode, x: 2850, y: 10230, height: -200, ...options },
        });
    }
    for (const easing of ["linear", "ease_in_out_sine", "ease_out_cubic", "ease_out_sine", "ease_in_sine"] as const) {
        const options = { cycles: 210, easing, heightRelative: false, ignoreTerrain: true, trackTarget: false };
        assert.deepEqual(decodeServerPacket(new Uint8Array(encode(3128, 3476, 400, options))), {
            type: "camera", payload: { mode, x: 3128, y: 3476, height: 400, ...options },
        });
    }
    assert.throws(() => encode(3128, 3476, 400, { cycles: 0, easing: "linear" }), RangeError);
    assert.throws(() => encode(3128, 3476, 400, { cycles: 10, easing: "unknown" } as any), RangeError);
    assert.throws(() => encode(2850, 10230, 100, { rate: -1, rate2: 10 }), RangeError);
    assert.throws(() => encode(2850, 10230, 100, { rate: 10, rate2: 256 }), RangeError);
    assert.throws(() => encode(2850, 10230, NaN, { rate: 10, rate2: 10 }), RangeError);
}

for (const unlock of [true, false]) {
    assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraUnlock(unlock))), { type: "camera", payload: { mode: "unlock", unlock } });
}
assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraTranslate(-5376, 8000))), {
    type: "camera", payload: { mode: "translate", dx: -5376, dy: 8000 },
});

// Ethically Acquired Antiquities' interrogation turns between speakers with cam_rotateby.
for (const yaw of [1024, -1024]) {
    assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraRotateBy(0, yaw, 5, "linear"))), {
        type: "camera", payload: { mode: "rotate", pitch: 0, yaw, cycles: 5, easing: "linear" },
    });
}
assert.throws(() => encodeCameraRotateBy(0, 1024, 0, "linear"), RangeError);
assert.throws(() => encodeCameraRotateBy(0, 1024, 5, "unknown" as any), RangeError);
// The Heart of Darkness's nagua pan swings with cam_moveto_arc.
assert.deepEqual(decodeServerPacket(new Uint8Array(encodeCameraMoveArc(1680, 9636, 1685, 9640, 1000, 270, "ease_in_out_sine", true))), {
    type: "camera", payload: { mode: "arc", centreX: 1680, centreY: 9636, x: 1685, y: 9640, height: 1000, cycles: 270, easing: "ease_in_out_sine", ignoreTerrain: true },
});
assert.throws(() => encodeCameraMoveArc(1680, 9636, 1685, 9640, 1000, 0, "linear"), RangeError);

console.log("camera shake packet: ok");
