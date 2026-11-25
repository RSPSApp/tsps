import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";

import { loadFromPayload } from "../common/gamemode/GamemodeContentStore";
import { CustomAnimationRegistry, withCustomTypes } from "../custom/animations/CustomAnimationRegistry";
import { CustomSeqTypeLoader } from "../custom/animations/CustomSeqTypeLoader";
import { animationHash, SampledAnimationRegistry, type SampledAnimationRow } from "../custom/animations/SampledAnimationRegistry";
import { CustomModelRegistry } from "../custom/items/CustomModelRegistry";
import { RenderDataWorkerPool } from "../game/worker/RenderDataWorkerPool";
import { handleInboundUi } from "../network/serverConnection/handlers/inboundUi";
import type { CacheInfo } from "../rs/cache/CacheInfo";
import { NpcModelLoader } from "../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../rs/config/npctype/NpcType";
import { SeqType } from "../rs/config/seqtype/SeqType";
import { Model } from "../rs/model/Model";
import { ModelData } from "../rs/model/ModelData";

const info: CacheInfo = {
    name: "test", game: "oldschool", environment: "live", revision: 242, timestamp: "", size: 0,
};
const animationId = 51000;
const modelId = 1100000;

function rows(id = animationId, vertexCount = 3): SampledAnimationRow[] {
    const bytes = Buffer.alloc(vertexCount * 2 * 6);
    for (let i = 0; i < bytes.length / 2; i++) bytes.writeInt16LE(i * 3, i * 2);
    const compressed = deflateSync(bytes);
    const data = compressed.toString("base64");
    const split = Math.floor(data.length / 8) * 4;
    return [data.slice(0, split), data.slice(split)].map((data, part) => ({
        id, modelId, vertexCount, frameLengths: [2, 3], loop: false, part, total: 2,
        hash: animationHash(compressed), data,
    }));
}

const sampleDataset = (rows: SampledAnimationRow[]) => ({ key: "customSampledAnimations", rows });

function seqLoader(count = 15000) {
    const base = {
        load(id: number) {
            const type = new SeqType(id, info);
            if (id === 808) {
                type.frameIds = [100];
                type.frameLengths = [2];
                type.masks = [1];
            }
            return type;
        },
        getCount: () => count,
        clearCache() {},
    };
    return new CustomSeqTypeLoader(
        withCustomTypes(base, SeqType, info, id => CustomAnimationRegistry.seq(id)),
        info,
        id => id < base.getCount() || CustomAnimationRegistry.seq(id) !== undefined,
    );
}

function npcModels(modelIds = [modelId]) {
    const type = new NpcType(1, info);
    type.modelIds = modelIds;
    const loadedFrames: number[] = [];
    const loader = new NpcModelLoader(
        {} as any,
        { getModel: () => Object.assign(new ModelData(), {
            verticesCount: 6,
            usedVertexCount: 6,
            faceCount: 2,
            verticesX: Int32Array.of(0, 16, 0, 0, 16, 0),
            verticesY: Int32Array.of(0, 0, 0, 0, 0, -16),
            verticesZ: Int32Array.of(0, 0, 16, 0, 0, 16),
            indices1: Int32Array.of(0, 3),
            indices2: Int32Array.of(1, 4),
            indices3: Int32Array.of(2, 5),
            faceColors: Uint16Array.of(38821, 38821),
        }) },
        {} as any,
        seqLoader(),
        { load: (id: number) => { loadedFrames.push(id); } } as any,
        undefined,
        {} as any,
    );
    return { type, loader, loadedFrames };
}

test("sampled chunks install atomically, interpolate through model space and reset on a new connection", () => {
    SampledAnimationRegistry.clear();
    const input = rows();
    loadFromPayload({ gamemodeId: "test", datasets: [sampleDataset([input[1]])] });
    assert.equal(SampledAnimationRegistry.get(animationId), undefined);
    loadFromPayload({ gamemodeId: "test", datasets: [sampleDataset([input[0]])] });
    assert.ok(SampledAnimationRegistry.get(animationId));

    const loader = seqLoader();
    assert.deepEqual(loader.load(animationId).frameLengths, [2, 3]);
    assert.equal(loader.load(animationId).maxLoops, 1);
    assert.equal(loader.load(animationId).isSkeletalSeq(), false);
    assert.equal(loader.getCount(), animationId + 1);

    const model = new Model();
    model.verticesCount = 3;
    model.verticesX = new Int32Array(3);
    model.verticesY = new Int32Array(3);
    model.verticesZ = new Int32Array(3);
    assert.equal(SampledAnimationRegistry.apply(model, modelId, animationId, 0, 1, 0.5), true);
    assert.equal(model.verticesX[0], 13.5);
    assert.equal(model.verticesZ[2], 37.5);
    assert.equal(SampledAnimationRegistry.apply(model, modelId + 1, animationId, 0), false);

    const retimed = rows().map(row => ({ ...row, frameLengths: [3, 4], loop: true }));
    retimed.forEach(row => SampledAnimationRegistry.accept(row));
    assert.deepEqual(loader.load(animationId).frameLengths, [3, 4], "timing changes install even with the same geometry");
    assert.equal(loader.load(animationId).looping, true);

    loadFromPayload({ gamemodeId: "connection-reset", datasets: [sampleDataset([])] });
    assert.equal(SampledAnimationRegistry.get(animationId), undefined);
    assert.equal(loader.getCount(), 15000);
    SampledAnimationRegistry.accept(input[1]);
    assert.equal(SampledAnimationRegistry.get(animationId), undefined, "a stale last chunk cannot revive a reset bundle");
    SampledAnimationRegistry.clear();
});

test("only models named by a completed sampled animation keep coincident vertices", () => {
    CustomModelRegistry.register({ id: modelId, data: Buffer.alloc(18).toString("base64") });
    try {
        const { type, loader } = npcModels();
        assert.equal(loader.getModel(type, -1, -1)?.verticesCount, 4, "static custom geometry still welds");
        const [first, second] = rows(animationId, 6);
        SampledAnimationRegistry.accept(first);
        assert.equal(loader.getModel(type, -1, -1)?.verticesCount, 4);
        SampledAnimationRegistry.accept(second);
        const animated = loader.getModel(type, animationId, 1);
        assert.equal(animated?.verticesCount, 6, "the cached base model is rebuilt in sampled vertex order");
        assert.equal(animated?.verticesX[0], 54);
        SampledAnimationRegistry.clear();
        assert.equal(loader.getModel(type, -1, -1)?.verticesCount, 4, "reset restores welding");
    } finally {
        CustomModelRegistry.clear();
        SampledAnimationRegistry.clear();
    }
});

test("native actions take precedence over sampled movement, and multi-part NPCs never load sampled placeholders", () => {
    rows(animationId, 6).forEach(row => SampledAnimationRegistry.accept(row));
    try {
        const single = npcModels();
        single.loader.getModel(single.type, 808, 0, animationId, 0);
        assert.deepEqual(single.loadedFrames, [100], "the native action uses its own frame");
        const multi = npcModels([modelId, modelId + 1]);
        multi.loader.getModel(multi.type, animationId, 0);
        assert.deepEqual(multi.loadedFrames, [], "cache frame zero is not a sampled pose");
    } finally {
        SampledAnimationRegistry.clear();
    }
});

test("a sampled id cannot replace a cache, archived or editor sequence in the client loader", () => {
    rows().forEach(row => SampledAnimationRegistry.accept(row));
    try {
        assert.equal(seqLoader(animationId + 1).load(animationId).frameLengths, undefined);
        const data = Buffer.from([1, 0, 1, 0, 7, 0, 113, 0, 0, 0]).toString("base64");
        CustomAnimationRegistry.register({
            kind: "seq", id: animationId, name: "editor-seq", data, group: 30000, frames: {},
        });
        assert.deepEqual(seqLoader().load(animationId).frameLengths, [7]);
    } finally {
        CustomAnimationRegistry.clear();
        SampledAnimationRegistry.clear();
    }
});

test("a broken sample row leaves later clips and datasets usable", () => {
    CustomModelRegistry.register({ id: modelId, data: Buffer.alloc(18).toString("base64") });
    const bad = rows(animationId + 1).map(row => ({ ...row, hash: "0" }));
    try {
        loadFromPayload({ gamemodeId: "test", datasets: [
            sampleDataset([...bad, ...rows()]), { key: "customModels", rows: [] },
        ] });
        assert.equal(SampledAnimationRegistry.get(animationId + 1), undefined);
        assert.ok(SampledAnimationRegistry.get(animationId));
        assert.equal(CustomModelRegistry.get(modelId), undefined);
    } finally {
        CustomModelRegistry.clear();
        SampledAnimationRegistry.clear();
    }
});

test("only completed samples or removal reach render workers and invalidate the renderer", async () => {
    const calls: string[] = [];
    const workerDatasets: Array<{ key: string; rows: unknown[] }> = [];
    const worker = {
        initCache() {},
        async setCustomContent({ datasets }: { datasets: typeof workerDatasets }) { workerDatasets.push(...datasets); },
        async cancelWorldMapTiles() {},
    };
    const pool = new RenderDataWorkerPool({} as any, [{ init: Promise.resolve(worker) }] as any, 1);
    const client = {
        workerPool: pool,
        seqTypeLoader: { clearCache: () => calls.push("sequence") },
        renderer: {
            invalidateAnimationCaches: () => calls.push("animation"),
            invalidateDefinitionCaches: () => calls.push("definition"),
        },
        refreshGamemodeWorldLocs: () => calls.push("world"),
    };
    const globals = globalThis as typeof globalThis & { __osrsClient?: typeof client };
    globals.__osrsClient = client;
    const send = (rows: SampledAnimationRow[]) => handleInboundUi({
        type: "gamemode_data", payload: { gamemodeId: "test", datasets: [sampleDataset(rows)] },
    });
    const [first, second] = rows();
    try {
        pool.initCache({} as any, []);
        await pool.setSampledAnimationContent();
        assert.equal(workerDatasets.filter(dataset => dataset.key === "customAnimations").length, 1);
        workerDatasets.length = 0;

        assert.equal(send([]), true);
        send([first]);
        await pool.setSampledAnimationContent();
        assert.deepEqual(calls, []);
        assert.deepEqual(workerDatasets, []);
        send([second]);
        await pool.setSampledAnimationContent();
        assert.deepEqual(calls, ["sequence", "animation"]);
        assert.deepEqual(workerDatasets, [sampleDataset([first, second])]);
        send([first, second]);
        await pool.setSampledAnimationContent();
        assert.deepEqual(calls, ["sequence", "animation"]);
        assert.equal(workerDatasets.length, 1);
        send([]);
        await pool.setSampledAnimationContent();
        assert.deepEqual(calls, ["sequence", "animation", "sequence", "animation"]);
        assert.deepEqual(workerDatasets[1], sampleDataset([]));
    } finally {
        delete globals.__osrsClient;
        SampledAnimationRegistry.clear();
    }
});
