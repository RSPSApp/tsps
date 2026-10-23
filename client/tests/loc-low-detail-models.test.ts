import assert from "node:assert/strict";
import { test } from "node:test";

import { CacheInfo } from "../rs/cache/CacheInfo";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import { LocType } from "../rs/config/loctype/LocType";
import { ByteBuffer } from "../rs/io/ByteBuffer";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

/**
 * A loc can list its models twice: the first block is normal detail and a second block holds the
 * low-detail models, which normal detail skips. Opcodes 6 and 7 are 1 and 5 with int model ids,
 * and they kept the second block, so 202 locs drew their low-detail models. The roof of Picaria's
 * Fishing Shop (#495) became flat black squares with its two ridge pieces floating on top.
 */
const OSRS: CacheInfo = {
    name: "test",
    game: "oldschool",
    environment: "live",
    revision: 241,
    timestamp: "",
    size: 0,
};

const int = (value: number): number[] => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
];

function decode(bytes: number[], lowDetail = false): LocType {
    const loc = new LocType(0, OSRS);
    loc.lowDetail = lowDetail;
    const buffer = new ByteBuffer(Int8Array.from(bytes));
    loc.decode(buffer);
    assert.equal(buffer.offset, bytes.length, "the decode reads exactly the entry's bytes");
    return loc;
}

test("opcode 6 keeps the normal-detail block", () => {
    const flat = LocModelType.ROOF_FLAT;
    const bytes = [6, 1, ...int(70001), flat, 6, 1, ...int(70002), flat, 0];
    assert.deepEqual(decode(bytes).models, [[70001]]);
    assert.deepEqual(decode(bytes).types, [flat]);
    assert.deepEqual(decode(bytes, true).models, [[70002]], "low detail takes the second block");
});

test("opcode 7 keeps the normal-detail block", () => {
    const bytes = [7, 2, ...int(70001), ...int(70003), 7, 1, ...int(70002), 0];
    assert.deepEqual(decode(bytes).models, [[70001, 70003]]);
    assert.deepEqual(decode(bytes, true).models, [[70002]], "low detail takes the second block");
});

test("Picaria's Fishing Shop roof (#495) is thatch, not the black low-detail squares", () => {
    const info = loadCacheList(loadCacheInfos()).latest;
    const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, loadCache(info).files));
    const roof = factory.getLocTypeLoader().load(23760);
    const models = factory.getModelLoader();
    assert.ok(roof.types && roof.types.length === 10, "one model per roof shape, 12 to 21");
    roof.types.forEach((shape, i) => {
        const model = models.getModel(roof.models[i][0]);
        assert.ok(model, `roof shape ${shape} has a model`);
        const colours = new Set(model.faceColors);
        assert.ok(!(colours.size === 1 && colours.has(0)), `roof shape ${shape} is all black`);
    });
});
