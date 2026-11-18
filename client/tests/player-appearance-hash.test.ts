import assert from "node:assert/strict";

import { PlayerAppearance } from "../rs/config/player/PlayerAppearance";

// The appearance cache key is built for every player every frame. It hashes with two 32-bit
// lanes (no BigInt), and must still tell apart every field that changes the composed model.
const make = () => {
    const app = new PlayerAppearance(0, [1, 2, 3, 4, 5], [10, 11, 12, 13, 14, 15, 16]);
    app.equip[3] = 1277;
    return app;
};

const a = make();
const b = make();
assert.equal(a.getCacheKey(), b.getCacheKey(), "equal appearances share a key");
assert.equal(a.getCacheKey(), a.getCacheKey(), "the key is stable");
assert.equal(a.getHash(), b.getHash(), "and so is the 64-bit hash");
assert.equal(typeof a.getHash(), "bigint", "getHash keeps its type for its callers");
const [lo, hi] = a.getHashLanes();
assert.equal(a.getHash(), (BigInt(hi) << 32n) | BigInt(lo), "getHash is the two lanes, hi:lo");
assert.ok(a.getCacheKey().startsWith(`${hi.toString(36)}.${lo.toString(36)}|`), "the key starts with the lanes");

const variants: [string, (app: PlayerAppearance) => void][] = [
    ["gender", (app) => (app.gender = 1)],
    ["a kit", (app) => (app.kits[2] = 99)],
    ["a colour", (app) => (app.colors[4] = 6)],
    ["held equipment", (app) => (app.equip[3] = 1278)],
    ["an NPC transformation", (app) => (app.npcTransformationId = 5)],
    ["first-person arms", (app) => (app.firstPersonArmsOnly = true)],
    ["a recolour override", (app) => (app.colorTextureOverrides[4] = { colors: [1, 2], textures: null })],
    ["a retexture override", (app) => (app.colorTextureOverrides[4] = { colors: null, textures: [7] })],
    ["a composition item", (app) => app.compositionItems.set(1, 4151)],
];
const keys = new Set([a.getCacheKey()]);
for (const [what, change] of variants) {
    const app = make();
    change(app);
    const key = app.getCacheKey();
    assert.notEqual(key, a.getCacheKey(), `${what} changes the key`);
    keys.add(key);
}
assert.equal(keys.size, variants.length + 1, "every variant has its own key");

// Moving a value between fields changes the hash (the fold is positional, as before).
const swapped = make();
swapped.kits[0] = 11;
swapped.kits[1] = 10;
assert.notEqual(swapped.getCacheKey(), a.getCacheKey(), "order matters");

// No accidental collisions across a spread of real-looking appearances.
const seen = new Map<string, string>();
for (let kit = 0; kit < 40; kit++) {
    for (let colour = 0; colour < 25; colour++) {
        for (let item = -1; item < 20; item++) {
            const app = new PlayerAppearance(kit & 1, [colour, colour >> 1, 3, 4, colour % 7], [kit, 20 + kit, 30, 40, 50, 60, 70]);
            app.equip[3] = item < 0 ? -1 : 4000 + item;
            const hash = app.getHash().toString();
            const identity = `${kit}/${colour}/${item}`;
            const prior = seen.get(hash);
            assert.equal(prior, undefined, `hash collision between ${prior} and ${identity}`);
            seen.set(hash, identity);
        }
    }
}

console.log("player appearance hash test passed");
