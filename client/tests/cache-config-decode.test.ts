import assert from "node:assert/strict";
import { test } from "node:test";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { Dat2CacheLoaderFactory } from "../rs/cache/loader/Dat2CacheLoaderFactory";
import { ConfigType } from "../rs/cache/ConfigType";
import { IndexType } from "../rs/cache/IndexType";
import { ByteBuffer } from "../rs/io/ByteBuffer";
import { EnumType } from "../rs/config/enumtype/EnumType";
import { HealthBarDefinition } from "../rs/config/healthbar/HealthBarDefinition";
import { HitSplatType } from "../rs/config/hitsplat/HitSplatType";
import { IdkType } from "../rs/config/idktype/IdkType";
import { LocType } from "../rs/config/loctype/LocType";
import { MapElementType } from "../rs/config/meltype/MapElementType";
import { NpcType } from "../rs/config/npctype/NpcType";
import { ObjType } from "../rs/config/objtype/ObjType";
import { ParamType } from "../rs/config/paramtype/ParamType";
import { SeqType } from "../rs/config/seqtype/SeqType";
import { SpotAnimType } from "../rs/config/spotanimtype/SpotAnimType";
import { StructType } from "../rs/config/structtype/StructType";
import { OverlayFloorType } from "../rs/config/floortype/OverlayFloorType";
import { UnderlayFloorType } from "../rs/config/floortype/UnderlayFloorType";
import { VarBitType } from "../rs/config/vartype/bit/VarBitType";
import { VarcIntType } from "../rs/config/vartype/VarcIntType";
import { WorldEntityType } from "../rs/config/worldentitytype/WorldEntityType";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

/**
 * Every config entry in the cache decodes with no unknown opcode and uses exactly its bytes.
 * A revision that adds an opcode with a payload otherwise misreads the rest of the entry quietly
 * (the normal decode treats a dat2 overflow as the end of the entry).
 */
const ARCHIVES: Array<[string, number, new (id: number, info: any) => any]> = [
    ["underlay", ConfigType.DAT2.underlays, UnderlayFloorType],
    ["idk", ConfigType.DAT2.identkits, IdkType],
    ["overlay", ConfigType.DAT2.overlays, OverlayFloorType],
    ["loc", ConfigType.DAT2.locs, LocType],
    ["enum", ConfigType.DAT2.enums, EnumType],
    ["npc", ConfigType.DAT2.npcs, NpcType],
    ["obj", ConfigType.DAT2.objs, ObjType],
    ["param", ConfigType.DAT2.params, ParamType],
    ["seq", ConfigType.DAT2.seqs, SeqType],
    ["spotanim", ConfigType.DAT2.spotAnims, SpotAnimType],
    ["varbit", ConfigType.DAT2.varbits, VarBitType],
    ["varc", ConfigType.DAT2.varClient, VarcIntType],
    ["hitsplat", ConfigType.OSRS.hitSplat, HitSplatType],
    ["healthbar", ConfigType.OSRS.healthBar, HealthBarDefinition],
    ["struct", ConfigType.OSRS.struct, StructType],
    ["mapelement", ConfigType.OSRS.mapFunctions, MapElementType],
    ["worldentity", ConfigType.OSRS.worldEntity, WorldEntityType],
];

test("enum lookups reuse their lazy loader and still retry an unavailable archive", () => {
    let reads = 0, ready = false;
    const unavailable = new Error("enum archive not ready");
    const configIndex = {
        archiveExists: () => true,
        getArchive: () => {
            reads++;
            if (!ready) throw unavailable;
            return { fileCount: 1, getFile: () => ({ getDataAsBuffer: () => new ByteBuffer(new Int8Array([0])) }) };
        },
    };
    const info: any = { game: "oldschool", revision: 241 };
    const cache: any = { getIndex: () => configIndex };
    const factory = new Dat2CacheLoaderFactory(info, "dat2", cache);
    const loader = factory.getEnumTypeLoader()!;
    assert.equal(reads, 0, "constructing the loader does not read streaming archive bytes");
    assert.equal(factory.getEnumTypeLoader(), loader, "chat lookups share the same loader");
    assert.throws(() => loader.load(0), error => error === unavailable);
    ready = true;
    const definition = loader.load(0);
    for (let i = 0; i < 30; i++) assert.equal(factory.getEnumTypeLoader()!.load(0), definition);
    assert.equal(reads, 2, "one unavailable read and one successful archive read");
    loader.clearCache();
    assert.notEqual(loader.load(0), definition, "decoded definitions can still be cleared");
    assert.equal(reads, 2, "clearing definitions retains the decoded archive");
    const otherFactory = new Dat2CacheLoaderFactory(info, "dat2", cache);
    assert.notEqual(otherFactory.getEnumTypeLoader()!.load(0), definition, "another cache factory owns its loader");
    assert.equal(reads, 3);
});

test("loader getters reuse one instance per cache factory", () => {
    const info = loadCacheList(loadCacheInfos()).latest;
    const cache = CacheSystem.fromFiles(info, loadCache(info).files);
    const factory = new Dat2CacheLoaderFactory(info, "dat2", cache);
    const getters = [
        "getUnderlayTypeLoader",
        "getOverlayTypeLoader",
        "getVarBitTypeLoader",
        "getVarcIntTypeLoader",
        "getLocTypeLoader",
        "getNpcTypeLoader",
        "getObjTypeLoader",
        "getSeqTypeLoader",
        "getSpotAnimTypeLoader",
        "getParamTypeLoader",
        "getIdkTypeLoader",
        "getEnumTypeLoader",
        "getStructTypeLoader",
        "getTextureLoader",
        "getModelLoader",
        "getSeqBaseLoader",
        "getSeqFrameLoader",
        "getSkeletalSeqLoader",
        "getWorldEntityTypeLoader",
        "getMapFileLoader",
    ] as const;
    for (const getter of getters) {
        const first = (factory as any)[getter]();
        if (first === undefined) continue;
        assert.equal((factory as any)[getter](), first, `${getter} reuses its loader`);
    }
});

test("every config entry decodes exactly", () => {
    const info = loadCacheList(loadCacheInfos()).latest;
    const cache = CacheSystem.fromFiles(info, loadCache(info).files);
    const configs: any = cache.getIndex(IndexType.DAT2.configs);
    const problems: string[] = [];
    for (const [name, archiveId, Ctor] of ARCHIVES) {
        if (!configs.archiveExists(archiveId)) continue;
        const counts = new Map<string, number>();
        for (const file of configs.getArchive(archiveId).files) {
            const buffer = new ByteBuffer(file.data);
            const type = new Ctor(file.id, info);
            let error = "";
            try {
                while (buffer.offset < buffer.length) {
                    const opcode = buffer.readUnsignedByte();
                    if (opcode === 0) break;
                    type.decodeOpcode(opcode, buffer);
                }
                if (buffer.offset !== buffer.length) error = "bytes left after the terminator";
            } catch (e: any) {
                error = String(e?.message ?? e).replace(/ id: \d+/, "").slice(0, 80);
            }
            if (error) counts.set(error, (counts.get(error) ?? 0) + 1);
        }
        for (const [error, count] of counts) problems.push(`${name}: ${count}x ${error}`);
    }
    assert.deepEqual(problems, [], `${info.name}\n${problems.join("\n")}`);
});
