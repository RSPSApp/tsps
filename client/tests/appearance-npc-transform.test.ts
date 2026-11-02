import assert from "assert";
import { decodeAppearanceBinary } from "../game/sync/AppearanceDecoder";

const bytes = new Uint8Array([
    0, 255, 255, 255, 255, 0, 172,
    0, 0, 0, 0, 0,
    3, 40, 3, 55, 3, 51, 3, 52, 3, 53, 3, 54, 3, 56,
    84, 111, 98, 121, 0,
    3, 0, 32, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 255, 255, 255, 255,
]);
const appearance = decodeAppearanceBinary(bytes);
assert.strictEqual(appearance?.npcTransformationId, 172);
assert.strictEqual(appearance?.name, "Toby");

const ringAppearance = decodeAppearanceBinary(new Uint8Array([
    0, 255, 255,
    ...new Array(24).fill(0),
    ...new Array(5).fill(0),
    ...new Array(14).fill(0),
    82, 105, 110, 103, 0,
    3, 0, 32, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    255, 255, 255, 255,
    0, 0, 46, 204,
]));
assert.strictEqual(ringAppearance?.equipment[9], 11980);


for (const pronouns of [0, 1, 2]) {
    const payload = bytes.slice();
    // Native tail follows three empty actions, before this fixture's ammo extension.
    payload[40] = pronouns;
    const decoded = decodeAppearanceBinary(payload);
    assert.strictEqual(decoded?.gender, 0);
    assert.strictEqual(decoded?.pronouns, pronouns);
}

console.log("npc-transform and pronoun appearance decode passed");
