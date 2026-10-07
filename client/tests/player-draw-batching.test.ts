import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type { DrawRange } from "../render/DrawRange";
import { VertexBuffer } from "../render/buffer/VertexBuffer";

async function main(): Promise<void> {
    const playerShader = fs.readFileSync(
        path.resolve(__dirname, "../render/shaders/player.vert.glsl"),
        "utf8",
    );
    const priorityBias = playerShader.indexOf(
        "applyPriorityDepthBias(depthLayerPos, vertex.priority)",
    );
    const transparentGuard = playerShader.lastIndexOf("#ifdef DISCARD_ALPHA", priorityBias);
    assert.ok(priorityBias > 0);
    assert.ok(
        transparentGuard === -1 || playerShader.indexOf("#endif", transparentGuard) < priorityBias,
    );
    assert.ok(playerShader.includes("gl_Position = u_projectionMatrix * viewPos"));
    assert.ok(
        playerShader.includes(
            "gl_Position.z = depthLayerClipPos.z * gl_Position.w / depthLayerClipPos.w",
        ),
    );

    const vertexBuffer = new VertexBuffer(1);
    vertexBuffer.addVertex(0, 0, 0, 0, 0xff, 0, 0, -1, false, 7, true);
    const packedVertex = new DataView(vertexBuffer.byteArray().buffer);
    assert.equal((packedVertex.getUint32(8, true) >> 6) & 0x7, 7);

    (globalThis as any).self = globalThis;
    const { drawPlayerSlots, PlayerRenderer, shouldUseUnanimatedIdlePlayer } = await import(
        "../render/player/PlayerRenderer"
    );

    assert.equal(shouldUseUnanimatedIdlePlayer(200, true, false, false, 808, 808), false);
    assert.equal(shouldUseUnanimatedIdlePlayer(201, true, false, false, 808, 808), true);
    assert.equal(shouldUseUnanimatedIdlePlayer(300, true, true, false, 808, 808), false);
    assert.equal(shouldUseUnanimatedIdlePlayer(300, true, false, true, 808, 808), false);

    const { WebGLMapSquare } = await import("../render/WebGLMapSquare");
    let tileX = 0;
    let tileY = 0;
    let overlayView: any;
    const sceneRenderer = {
        stats: { frameCount: 0 },
        osrsClient: {
            renderSelf: true,
            controlledPlayerServerId: 10,
            playerEcs: {
                getAllActiveIndices: () => [0, 1, 2],
                getIndexForServerId: () => 0,
                getX: () => tileX * 128 + 64,
                getY: () => tileY * 128 + 64,
                getWorldViewId: (pid: number) => pid === 2 ? 5 : -1,
            },
            worldViewManager: { getWorldViewByOverlayMapId: () => overlayView },
        },
        shouldRenderPlayerIndex: () => true,
    };
    const scenePlayers = new PlayerRenderer(sceneRenderer as any) as any;
    scenePlayers.isFirstPersonArmsPlayer = () => false;
    const sceneMap = Object.assign(Object.create(WebGLMapSquare.prototype), {
        id: 1, mapX: 100, mapY: 100,
        renderPosX: 6408 / 64, renderPosY: 6424 / 64,
        heightMapSize: 104, borderSize: 0,
    });
    const selectedAt = (x: number, y: number, map = sceneMap) => {
        tileX = x;
        tileY = y;
        sceneRenderer.stats.frameCount++;
        return scenePlayers.getRenderPlayersForMap(map);
    };
    for (let x = 0; x < 104; x++) {
        for (let y = 0; y < 104; y++) {
            assert.deepEqual(selectedAt(6408 + x, 6424 + y), [0, 1],
                `owner and guest must render throughout the instance: ${x},${y}`);
        }
    }
    for (const [x, y] of [[6407, 6424], [6512, 6424], [6408, 6423], [6408, 6528]]) {
        assert.deepEqual(selectedAt(x, y), [], "exclude tiles outside the instance scene");
    }
    sceneRenderer.osrsClient.renderSelf = false;
    assert.deepEqual(selectedAt(6500, 6500), [1], "respect hidden local-player rendering");
    sceneRenderer.osrsClient.renderSelf = true;
    overlayView = { id: 5, containsTile: (x: number, y: number) => x === 1 && y === 2 };
    assert.deepEqual(selectedAt(1, 2), [2], "overlay players retain their own coordinate bounds");
    assert.deepEqual(selectedAt(6500, 6500), []);
    overlayView = undefined;
    const normalMap = Object.assign(Object.create(WebGLMapSquare.prototype), {
        id: 2, mapX: 100, mapY: 100, renderPosX: 100, renderPosY: 100,
        heightMapSize: 76, borderSize: 6,
    });
    assert.deepEqual(selectedAt(6400, 6400, normalMap), [0, 1]);
    assert.deepEqual(selectedAt(6463, 6463, normalMap), [0, 1]);
    assert.deepEqual(selectedAt(6464, 6463, normalMap), [], "normal maps exclude neighbouring squares");
    assert.deepEqual(selectedAt(6399, 6400, normalMap), [], "normal maps exclude terrain borders");

    const drawn: Array<{ slot: number; range: DrawRange }> = [];
    let slot = -1;
    let range: DrawRange = [0, 0, 0];
    let uploadedSlots: number[] = [];
    const slotBuffer = {
        data(value: Int32Array) {
            uploadedSlots = Array.from(value);
        },
    };
    const drawCall = {
        uniform(name: string, value: number) {
            if (name === "u_drawIdOverride") slot = value;
            return this;
        },
        drawRanges(value: DrawRange) {
            range = value;
            return this;
        },
        draw() {
            drawn.push({ slot, range });
        },
    };

    drawPlayerSlots(
        drawCall as any,
        slotBuffer as any,
        new Int32Array(256),
        [2, 3, 5, 8, 9, 10],
        42,
    );

    assert.deepEqual(uploadedSlots, [2, 3, 5, 8, 9, 10]);
    assert.deepEqual(drawn, [{ slot: -1, range: [0, 42, 6] }]);

    uploadedSlots = [];
    drawn.length = 0;
    drawPlayerSlots(drawCall as any, slotBuffer as any, new Int32Array(256), [7], 13);
    assert.deepEqual(uploadedSlots, []);
    assert.deepEqual(drawn, [{ slot: 7, range: [0, 13, 1] }]);

    let bufferCreates = 0;
    let bufferUpdates = 0;
    let bufferDeletes = 0;
    let vertexArrayDeletes = 0;
    const createBuffer = (data: ArrayBufferView) => {
        bufferCreates++;
        return {
            byteLength: data.byteLength,
            data() {
                bufferUpdates++;
                return this;
            },
            delete() {
                bufferDeletes++;
            },
        };
    };
    const vao = {
        vertexAttributeBuffer() {
            return this;
        },
        instanceAttributeBuffer() {
            return this;
        },
        indexBuffer() {
            return this;
        },
        delete() {
            vertexArrayDeletes++;
        },
    };
    const fluentDraw = {
        uniformBlock() {
            return this;
        },
        uniform() {
            return this;
        },
        texture() {
            return this;
        },
    };
    const renderer = {
        app: {
            createInterleavedBuffer: (_stride: number, data: ArrayBufferView) =>
                createBuffer(data),
            createIndexBuffer: (_type: number, data: ArrayBufferView) => createBuffer(data),
            createVertexArray: () => vao,
            createDrawCall: () => fluentDraw,
        },
        playerProgram: {},
        playerProgramOpaque: {},
        playerSlotBuffer: {},
        sceneUniformBuffer: {},
        textureArray: {},
        textureMaterials: {},
    };
    const playerRenderer = new PlayerRenderer(renderer as any) as any;
    const previousAppearance = { id: "previous" };
    const nextAppearance = { id: "next" };
    let nextAppearanceReady = true;
    playerRenderer.ensureBaseForAppearance = (appearance: object) =>
        appearance === nextAppearance && !nextAppearanceReady ? undefined : {};
    assert.equal(playerRenderer.resolveRenderableAppearance(1, previousAppearance), previousAppearance);
    nextAppearanceReady = false;
    assert.equal(
        playerRenderer.resolveRenderableAppearance(1, nextAppearance),
        previousAppearance,
        "keep the completed model visible while new equipment models load",
    );
    nextAppearanceReady = true;
    assert.equal(playerRenderer.resolveRenderableAppearance(1, nextAppearance), nextAppearance);
    playerRenderer.geomCache.set("frame:0", {
        verts: new Uint8Array(24),
        inds: new Int32Array(6),
        vertsA: new Uint8Array(12),
        indsA: new Int32Array(3),
    });
    const firstGeometry = playerRenderer.getPlayerGpuGeometry("frame:0");
    const reusedGeometry = playerRenderer.getPlayerGpuGeometry("frame:0");
    assert.equal(reusedGeometry, firstGeometry);
    assert.equal(bufferCreates, 4);
    assert.equal(bufferUpdates, 0);

    // Each frame keeps its own GPU geometry: uploaded once, never rewritten as frames change.
    playerRenderer.geomCache.set("frame:1", {
        verts: new Uint8Array(12),
        inds: new Int32Array(3),
        vertsA: new Uint8Array(12),
        indsA: new Int32Array(3),
    });
    const nextFrameGeometry = playerRenderer.getPlayerGpuGeometry("frame:1");
    assert.notEqual(nextFrameGeometry, firstGeometry);
    assert.equal(bufferCreates, 8);
    assert.equal(bufferUpdates, 0);
    assert.equal(playerRenderer.getPlayerGpuGeometry("frame:0"), firstGeometry);
    assert.equal(bufferCreates, 8, "returning to a cached frame uploads nothing");

    // Over the byte budget, the least recently used frame goes first (frame:1 here).
    const Renderer = PlayerRenderer as any;
    const budget = Renderer.GPU_GEOMETRY_BUDGET_BYTES;
    Renderer.GPU_GEOMETRY_BUDGET_BYTES = firstGeometry.bytes + nextFrameGeometry.bytes;
    playerRenderer.geomCache.set("frame:2", {
        verts: new Uint8Array(12),
        inds: new Int32Array(3),
        vertsA: new Uint8Array(12),
        indsA: new Int32Array(3),
    });
    playerRenderer.getPlayerGpuGeometry("frame:2");
    Renderer.GPU_GEOMETRY_BUDGET_BYTES = budget;
    assert.deepEqual([...playerRenderer.playerGpuGeometryCache.keys()], ["frame:0", "frame:2"]);
    assert.equal(bufferDeletes, 4);

    playerRenderer.cleanupAppearanceCache();
    assert.equal(bufferDeletes, 12);
    assert.equal(vertexArrayDeletes, 6);
    assert.equal(playerRenderer.playerGpuGeometryBytes, 0);
    console.log("Player draw batching regression test passed");
}

void main();
