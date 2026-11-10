import assert from "node:assert/strict";
import { test } from "node:test";

import type { Archive } from "../rs/cache/Archive";
import type { CacheInfo } from "../rs/cache/CacheInfo";
import { ConfigType } from "../rs/cache/ConfigType";
import { GroupMissingError } from "../rs/cache/js5/GroupMissingError";
import { ByteBuffer } from "../rs/io/ByteBuffer";
import { ArchiveTypeLoader, BaseTypeLoader } from "../rs/config/TypeLoader";
import { Type } from "../rs/config/Type";

const cacheInfo: CacheInfo = {
    name: "test",
    game: "oldschool",
    environment: "live",
    revision: 242,
    timestamp: "",
    size: 0,
};

// Opcode 1 decodes; opcode 2 throws the way a decoder calling a missing ByteBuffer method did
// (#4007: `buffer.readSignedMedium is not a function`); opcode 3 throws a JS5 group miss.
class FakeType extends Type {
    decoded = false;

    decodeOpcode(opcode: number): void {
        if (opcode === 1) this.decoded = true;
        else if (opcode === 2) throw new TypeError("buffer.readSignedMedium is not a function");
        else if (opcode === 3) throw new GroupMissingError(2, 6, 0, 0);
    }
}

function loaderFor(archiveId: number, files: Record<number, number[]>): ArchiveTypeLoader<FakeType> {
    const archive = {
        id: archiveId,
        fileCount: Object.keys(files).length,
        getFile: (id: number) =>
            files[id] ? { getDataAsBuffer: () => new ByteBuffer(new Int8Array(files[id])) } : undefined,
    } as unknown as Archive;
    return new ArchiveTypeLoader(FakeType, cacheInfo, archive);
}

function silenced<T>(fn: () => T): T {
    const error = console.error;
    console.error = () => {};
    try {
        return fn();
    } finally {
        console.error = error;
    }
}

test("a type that throws while decoding is counted under its config archive's name and still cached", () => {
    BaseTypeLoader.decodeFailures.clear();
    const loader = loaderFor(ConfigType.DAT2.locs, { 0: [1, 0], 1: [2, 0], 2: [1, 2, 0] });

    assert.equal(loader.load(0).decoded, true);
    assert.equal(BaseTypeLoader.decodeFailures.size, 0);

    const broken = silenced(() => loader.load(1));
    const halfDecoded = silenced(() => loader.load(2));
    // Same player-facing behaviour as before: the half-decoded type is kept, not rethrown.
    assert.equal(broken.decoded, false);
    assert.equal(halfDecoded.decoded, true);
    assert.equal(loader.load(1), broken);

    assert.deepEqual([...BaseTypeLoader.decodeFailures], [["locs", 2]]);
    assert.equal(BaseTypeLoader.decodeFailureSummary(), "type decode failures: locs=2");
    assert.equal(
        (globalThis as { __typeDecodeFailures?: Map<string, number> }).__typeDecodeFailures,
        BaseTypeLoader.decodeFailures,
    );
});

test("an archive id with no config name is labelled by its number", () => {
    BaseTypeLoader.decodeFailures.clear();
    silenced(() => loaderFor(250, { 0: [2, 0] }).load(0));
    assert.deepEqual([...BaseTypeLoader.decodeFailures], [["config-250", 1]]);
});

test("a JS5 group miss is rethrown and not counted", () => {
    BaseTypeLoader.decodeFailures.clear();
    const loader = loaderFor(ConfigType.DAT2.npcs, { 0: [3, 0] });
    assert.throws(() => loader.load(0), GroupMissingError);
    assert.equal(BaseTypeLoader.decodeFailures.size, 0);
});
