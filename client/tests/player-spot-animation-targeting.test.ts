import assert from "node:assert/strict";

async function main(): Promise<void> {
    const { GfxManager } = await import("../render/gfx/GfxManager");
    const { GfxCache } = await import("../render/gfx/GfxCache");
    const { ModelData } = await import("../rs/model/ModelData");
    const renderPlayers = [6, 2];
    const manager = new GfxManager({
        osrsClient: {
            playerEcs: { getServerIdForIndex: (pid: number) => ({ 6: 41, 2: 84 })[pid] },
        },
        playerRenderer: { getRenderPlayersForMap: () => renderPlayers },
    } as any);

    manager.spawnAttachedToPlayer(726, 84);
    assert.deepEqual(
        manager.getAttachedPlayersForMap({} as any).map(({ pid, slot }) => ({ pid, slot })),
        [{ pid: 2, slot: 1 }],
    );

    const model = Object.assign(new ModelData(), {
        verticesCount: 4,
        usedVertexCount: 4,
        faceCount: 2,
        verticesX: Int32Array.of(0, 16, 0, 0),
        verticesY: Int32Array.of(0, 0, 0, -2),
        verticesZ: Int32Array.of(0, 0, 16, 16),
        indices1: Int32Array.of(0, 0),
        indices2: Int32Array.of(1, 1),
        indices3: Int32Array.of(2, 3),
        faceColors: Uint16Array.of(38821, 39492),
        faceRenderPriorities: Int8Array.of(0, 5),
    });
    const cache = new GfxCache({ osrsClient: {
        spotAnimTypeLoader: { load: () => ({ modelId: 19078 }) },
        modelLoader: { getModel: () => model },
    } } as any);
    const fishing = cache.ensureBase(819)!;
    assert.deepEqual(fishing.faceRenderLayers, Uint8Array.of(1, 5), "only the water face is biased");
    assert.deepEqual(fishing.verticesY, model.verticesY, "depth bias preserves the model's positions");
    assert.equal(cache.ensureBase(830)!.faceRenderLayers, undefined, "other graphics retain their depth layers");
    console.log("Player spot-animation targeting regression test passed");
}

void main();
