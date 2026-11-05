import assert from "node:assert/strict";
import { test } from "node:test";

// PicoGL expects a browser global when PlayerRenderer loads.
(globalThis as any).self ??= globalThis;
const { PlayerRenderer } = require("../render/player/PlayerRenderer");

const pose = (value: number, labels = 1) => new Float32Array(labels * 12).fill(value);
const groups = (...rows: [string, Float32Array][]) =>
    new Map(rows.map(([key, matrices]) => [key, { matrices, appearance: {}, instances: [{ pid: 1 }] }]));

function harness() {
    const writes: { y: number; width: number; height: number; data: Float32Array }[] = [];
    const images = new Map<object, Map<number, Float32Array>>();
    let bound: object;
    const texture = () => ({ currentUnit: 0, bind() { bound = this; } });
    const renderer = {
        osrsClient: { playerEcs: { setAnimatedHeight: (_pid: number, _height: number) => {} } },
        playerPoseTexture: texture() as any,
        app: { gl: {
            TEXTURE_2D: 3553, RGBA: 6408, FLOAT: 5126,
            texSubImage2D(_target: number, _level: number, _x: number, y: number,
                width: number, height: number, _format: number, _type: number, data: Float32Array) {
                writes.push({ y, width, height, data: data.slice() });
                let image = images.get(bound);
                if (!image) images.set(bound, image = new Map());
                for (let i = 0; i < height; i++) {
                    let row = image.get(y + i);
                    if (!row) image.set(y + i, row = new Float32Array(255 * 12));
                    row.set(data.subarray(i * width * 4, (i + 1) * width * 4));
                }
            },
        } },
    };
    const player: any = new PlayerRenderer(renderer);
    player.ensureBaseForAppearance = () => ({ baseModel: {} });
    player.poseFor = (_key: string, _base: any, group: any) => group.matrices;
    player.rigFor = () => ({ height: () => 196 });
    player.restMeshFor = () => ({});
    const read = (row: number, length: number) => images.get(renderer.playerPoseTexture)?.get(row)?.slice(0, length);
    return { renderer, player, writes, texture, read };
}

test("WebGL cached player poses stay uploaded across opaque/alpha and empty passes", () => {
    const { player, writes } = harness();
    const rows = groups(["idle", pose(1, 30)], ["walk", pose(2, 20)]);
    for (let frame = 0; frame < 120; frame++) {
        player.preparePoses(rows); // opaque
        player.preparePoses(groups(["walk", rows.get("walk")!.matrices])); // alpha subset
    }
    assert.equal(writes.length, 1, "opaque/alpha subsets must share the same uploaded rows");
    assert.equal(writes[0].data.byteLength, 30 * 12 * 2 * 4);
    player.preparePoses(new Map());
    const output = player.preparePoses(rows);
    assert.equal(writes.length, 1, "an empty pass leaves texture contents intact");
    assert.equal(output.get("walk").row, 1);
});

test("WebGL streamed pose replacements and animation keys refresh their actual row", () => {
    const { player, writes } = harness();
    const idle = pose(1), loading = pose(2);
    const rows = groups(["idle", idle], ["walk", loading]);
    player.preparePoses(rows);
    const streamed = pose(3);
    rows.get("walk")!.matrices = streamed;
    player.preparePoses(rows);
    assert.equal(writes.length, 2, "the same key can receive its streamed frame later");
    assert.deepEqual(writes[1], { y: 1, width: 3, height: 1, data: streamed });
    player.preparePoses(groups(["idle", idle], ["run", streamed]));
    assert.equal(writes.length, 3, "a new animation key must update its row");
    assert.equal(writes[2].y, 2, "another pass's cached pose retains its row");
    const reordered = player.preparePoses(groups(["run", streamed], ["idle", idle]));
    assert.equal(writes.length, 3, "reordering groups does not move cached poses");
    assert.equal(reordered.get("run").row, 2);
    assert.equal(reordered.get("idle").row, 0);
});

test("WebGL different maps and alpha subsets reuse their pose rows", () => {
    const { player, writes } = harness();
    const a = pose(1), b = pose(2), c = pose(3);
    for (let frame = 0; frame < 120; frame++) {
        player.preparePoses(groups(["a", a], ["b", b]));
        player.preparePoses(groups(["c", c]));
        assert.equal(player.preparePoses(groups(["b", b])).get("b").row, 1);
        assert.equal(player.preparePoses(groups(["c", c])).get("c").row, 2);
    }
    assert.equal(writes.length, 2, "480 preparations need only the two initial map uploads");
});

test("WebGL full pose textures protect every current group before evicting old rows", () => {
    const { player, writes } = harness();
    const initial = groups(...Array.from({ length: 256 }, (_, i): [string, Float32Array] => [String(i), pose(i)]));
    player.preparePoses(initial);
    const next = groups(["new", pose(999)], ...Array.from(initial).slice(0, 255)
        .map(([key, group]): [string, Float32Array] => [key, group.matrices]));
    const out = player.preparePoses(next);
    assert.equal(out.size, 256, "no selected pose is evicted by another group in this pass");
    assert.equal(new Set(Array.from(out.values(), (entry: any) => entry.row)).size, 256);
    assert.equal(out.get("new").row, 255, "only the unreferenced old row can be reused");
    assert.equal(out.get("0").row, 0);
    assert.deepEqual(writes[1], { y: 255, width: 3, height: 1, data: pose(999) });
    player.preparePoses(groups(["1", initial.get("1")!.matrices])); // make row 1 most recent
    assert.equal(writes.length, 2);
    assert.equal(player.preparePoses(groups(["next", pose(1000)])).get("next").row, 255,
        "the least recently used unreferenced pose is replaced");
    assert.equal(player.poseTextureRows.size, 256, "row bookkeeping remains bounded");
    assert.equal(player.preparePoses(groups(["1", initial.get("1")!.matrices])).get("1").row, 1);
    assert.equal(writes.length, 3, "recent rows remain valid after eviction elsewhere");
});

test("WebGL partial pose uploads skip intervening rows and keep changing widths correct", () => {
    const { player, writes, read } = harness();
    const a = pose(1), b = pose(2), c = pose(3), d = pose(4);
    player.preparePoses(groups(["a", a], ["b", b], ["c", c], ["d", d]));
    const wideB = pose(5, 2), wideD = pose(6, 2);
    player.preparePoses(groups(["a", a], ["b", wideB], ["c", c], ["d", wideD]));
    assert.deepEqual(writes[1], { y: 1, width: 6, height: 1, data: wideB });
    assert.deepEqual(writes[2], { y: 3, width: 6, height: 1, data: wideD });
    assert.deepEqual(read(2, c.length), c, "the unchanged row between dirty rows is preserved");
    const narrowD = pose(7);
    player.preparePoses(groups(["a", a], ["b", b], ["c", c], ["d", narrowD]));
    assert.deepEqual(writes[3], { y: 1, width: 3, height: 1, data: b });
    assert.deepEqual(writes[4], { y: 3, width: 3, height: 1, data: narrowD });
});

test("WebGL dirty spans preserve another pass's wider pose rows", () => {
    const { player, writes, read } = harness();
    const a = pose(1), hidden = pose(2, 20), c = pose(3);
    player.preparePoses(groups(["a", a], ["hidden", hidden], ["c", c]));
    const changedA = pose(4), changedC = pose(5);
    const output = player.preparePoses(groups(["c", changedC], ["a", changedA]));
    assert.deepEqual(writes[1], { y: 0, width: 3, height: 1, data: changedA });
    assert.deepEqual(writes[2], { y: 2, width: 3, height: 1, data: changedC });
    assert.deepEqual(read(output.get("a").row, changedA.length), changedA);
    assert.deepEqual(read(output.get("c").row, changedC.length), changedC);
    assert.deepEqual(read(1, hidden.length), hidden);
    player.preparePoses(groups(["hidden", hidden]));
    assert.equal(writes.length, 3, "the retained row stays valid without another upload");
});

test("WebGL dirty rows at both ends never reupload the whole retained texture", () => {
    const { player, writes } = harness();
    const initial = groups(...Array.from({ length: 256 }, (_, i): [string, Float32Array] => [String(i), pose(i)]));
    player.preparePoses(initial);
    player.preparePoses(groups(["255", pose(999)], ["0", pose(1000)]));
    assert.equal(writes.length, 3);
    assert.deepEqual(writes[1], { y: 0, width: 3, height: 1, data: pose(1000) });
    assert.deepEqual(writes[2], { y: 255, width: 3, height: 1, data: pose(999) });
    assert.equal(writes.slice(1).reduce((bytes, write) => bytes + write.data.byteLength, 0), 96,
        "two changed poses must not upload all 12,288 retained bytes");
});

test("WebGL pose rows preserve submitted matrices and draw order through overflow and eviction", () => {
    const { player, renderer, texture, read } = harness();
    const matrices = Array.from({ length: 401 }, (_, i) => pose(i, 1 + i % 12));
    for (let pass = 0; pass < 96; pass++) {
        if (pass === 31 || pass === 63) renderer.playerPoseTexture = texture();
        if (pass === 48) player.cleanupAppearanceCache();
        const entries = Array.from({ length: 1 + (pass * 37) % 290 }, (_, i): [string, Float32Array] => {
            const index = (pass * 17 + i * 3) % matrices.length;
            if (i === 0 && pass % 7 === 0) matrices[index] = pose(1000 + pass, 1 + pass % 12);
            return [String(index), matrices[index]];
        });
        if (pass % 2) entries.reverse();
        const output = player.preparePoses(groups(...entries));
        assert.deepEqual(Array.from(output.keys()), entries.slice(0, 256).map(([key]) => key),
            "the same first 256 groups use GPU poses; overflow keeps the existing CPU fallback");
        const selected = new Map(entries);
        for (const [key, entry] of output) {
            const expected = selected.get(key)!;
            assert.deepEqual(read(entry.row, expected.length), expected,
                `pass ${pass} key ${key}: the shader's row must contain exactly this pose`);
        }
        assert.equal(new Set(Array.from(output.values(), (entry: any) => entry.row)).size, output.size);
        assert.ok(player.poseTextureRows.size <= 256);
    }
});

test("WebGL replacement pose textures invalidate every previously uploaded row", () => {
    const { player, renderer, writes, texture } = harness();
    const a = pose(1), b = pose(2);
    const rows = groups(["a", a], ["b", b]);
    player.preparePoses(rows);
    renderer.playerPoseTexture = undefined;
    assert.equal(player.preparePoses(rows).size, 0, "missing texture uses CPU fallback");
    renderer.playerPoseTexture = texture();
    player.preparePoses(groups(["a", a]));
    player.preparePoses(rows);
    assert.equal(writes.length, 3);
    assert.deepEqual(writes[2], { y: 1, width: 3, height: 1, data: b },
        "a tail row from the deleted texture must be uploaded to its replacement");
    player.cleanupAppearanceCache();
    player.preparePoses(rows);
    assert.equal(writes.length, 4, "session cleanup releases pose upload history");
    assert.equal(writes[3].height, 2);
});
