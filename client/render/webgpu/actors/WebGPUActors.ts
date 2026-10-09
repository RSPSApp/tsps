import type { IProjectileManager } from "../../../game/interfaces/IProjectileManager";
import type { OsrsClient } from "../../../game/OsrsClient";
import { getClientCycle } from "../../../network/ServerConnection";
import type { PlayerSpotAnimationEvent } from "../../../game/sync/PlayerSyncTypes";
import type { NpcSpotAnimationEvent, WorldSpotAnimationEvent } from "../../../game/GameRenderer";
import { BridgePlaneStrategy } from "../../../game/scene/PlaneResolver";
import { sampleBridgeHeightForWorldTile } from "../../../game/scene/BridgeHeightSampler";
import { getMapSquareId } from "../../../rs/map/MapFileIndex";
import type { SdMapData } from "../../loader/SdMapData";
import { MAX_TEXTURES, RENDER_CONSTANTS } from "../../render/constants";
import { GPU_SHADER_STAGE, SCENE_DEPTH_FORMAT } from "../bindings";
import type { WebGPUMapSquare } from "../WebGPUMapSquare";
import type { WebGPURenderer } from "../WebGPURenderer";
import type { WorldResources } from "../WorldResources";
import {
    ACTOR_DEPTH_FRAGMENT_ENTRY,
    ACTOR_FRAGMENT_ENTRY,
    actorVertexEntry,
    createActorShaderModule,
    type ActorKind,
} from "../shaders/actor.wgsl";
import { ActorGfxRuntime } from "./actorGfx";
import {
    ActorDataTexture,
    ActorGeometryCache,
    MapActorUniforms,
    POSE_ROWS,
    POSE_WIDTH,
    actorUniformStride,
    type GpuGeometry,
} from "./actorGpu";
import { POSE_FLOATS_PER_LABEL } from "../../player/LabelPose";
import {
    ActorDataWriter,
    ActorTileSelection,
    getRenderPlayersForMap,
    packNpcActorData,
    packPlayerActorData,
    packProjectileActorData,
    packWorldGfxActorData,
    resolveUnbatchedNpcGeometry,
    updateNpcClientAnimations,
} from "./actorPacking";
import { PlayerPoseGeometry } from "./actorPlayers";
import { DynamicNpcAnimLoader } from "../../npc/DynamicNpcAnimLoader";
import type { GfxInstance } from "../../gfx/GfxManager";

/**
 * SceneUniforms is 66 f32 = 264 bytes, padded to 272 by the uniform buffer binding in
 * WorldResources; the actor pipeline layout's group(0) must match it exactly to stay
 * group-equivalent with the bind group the renderer already owns.
 */
const SCENE_UNIFORM_BYTES = Math.ceil((66 * 4) / 16) * 16;

/** Actor model clearance, same constant the WebGL renderer uses (npc offset is its negation). */
const ACTOR_GROUND_CLEARANCE_MODEL_UNITS = -10;
const NPC_MODEL_Y_OFFSET = -ACTOR_GROUND_CLEARANCE_MODEL_UNITS;
const PLAYER_MODEL_Y_OFFSET = ACTOR_GROUND_CLEARANCE_MODEL_UNITS;

/** Actor geometry LRU: several hundred animated frames fit this budget. */
const ACTOR_GEOMETRY_CACHE_ENTRIES = 2048;

interface ActorDrawItem {
    /** The base pipeline; extended/depth twins are looked up from it. */
    pipeline: GPURenderPipeline;
    geometry: GpuGeometry;
    entry: number;
}

interface MapActorState {
    id: number;
    uniforms: MapActorUniforms;
    opaque: ActorDrawItem[];
    alpha: ActorDrawItem[];
    /** Absolute actor-data indices for actor-attached GFX lookups. */
    npcByEcsId: Map<number, number>;
    playerByPid: Map<number, number>;
}

/**
 * WebGPU actor rendering (stage 3): NPCs, players via the CPU pose path, spot animations and
 * projectiles. Wire-up points match the WebGL renderer's renderOpaqueActorPass /
 * renderTransparentNpcPass / renderTransparentPlayerPass.
 *
 * Deviations from the WebGL path:
 * - The WebGPU map stream loads squares with `loadNpcs: false`, so there is no baked per-map
 *   NPC geometry; every NPC goes through DynamicNpcAnimLoader current-frame geometry.
 * - Instances and first-person arm rendering are not ported (instanceActive is false under
 *   WebGPU), and actor frame sounds are not dispatched. World entity decks are: their actors are
 *   packed from the ECS worldViewId (packDeckActors) and placed by the map's deck transform.
 */
export class WebGPUActors {
    private readonly writer = new ActorDataWriter();
    private readonly mapStates = new Map<number, MapActorState>();
    private readonly frameMaps: MapActorState[] = [];
    private readonly tileSelection = new ActorTileSelection();

    private world?: WorldResources;
    private textureIdIndexMap = new Map<number, number>();
    private actorData?: ActorDataTexture;
    private geometry?: ActorGeometryCache;
    private gfx?: ActorGfxRuntime;
    private playerPose?: PlayerPoseGeometry;
    private dynamicNpcLoader?: DynamicNpcAnimLoader;
    private lastUpdateTimeSec = -1;
    /** Client-cycle accounting, mirroring the WebGL frame's pendingClientTicks. */
    private hasClientTickBaseline = false;
    private lastClientTick = 0;
    private pendingClientTicks = 0;

    private actorUniformLayout?: GPUBindGroupLayout;
    private actorDataLayout?: GPUBindGroupLayout;
    /** Base pipelines per kind: [opaque, alpha]. Draw items record the base pipeline. */
    private readonly pipelines = new Map<ActorKind, [GPURenderPipeline, GPURenderPipeline]>();
    /** Base pipeline -> its scene-extension twin and depth twin (see ../sceneExtension.ts). */
    private readonly variants = new Map<
        GPURenderPipeline,
        { extended: GPURenderPipeline; depth?: GPURenderPipeline }
    >();
    private playerPipelines = new Set<GPURenderPipeline>();
    /** This frame's GPU player poses: pose key -> pose texture row, packed into poseUpload. */
    private readonly poseRows = new Map<string, number>();
    private readonly poseUpload = new Float32Array(POSE_ROWS * POSE_WIDTH * 4);
    private poseTexels = 0;

    constructor(protected readonly renderer: WebGPURenderer) {}

    async init(): Promise<void> {
        const renderer = this.renderer;
        const world = (renderer as unknown as { world?: WorldResources }).world;
        if (!world) {
            console.warn("[webgpu] actors init before world resources exist");
            return;
        }
        this.world = world;
        const device = renderer.device;
        const client = renderer.osrsClient;

        this.textureIdIndexMap = this.buildTextureIdIndexMap(client);
        this.actorUniformLayout = device.createBindGroupLayout({
            label: "webgpu actor uniforms layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
                    buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 128 },
                },
                {
                    binding: 1,
                    visibility: GPU_SHADER_STAGE.VERTEX,
                    texture: { sampleType: "sint", viewDimension: "2d-array" },
                },
            ],
        });
        this.actorDataLayout = device.createBindGroupLayout({
            label: "webgpu actor data layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
                    texture: { sampleType: "uint", viewDimension: "2d" },
                },
                {
                    binding: 1,
                    visibility: GPU_SHADER_STAGE.VERTEX,
                    texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
                },
            ],
        });
        this.actorData = new ActorDataTexture(device, this.actorDataLayout, "webgpu actor data");
        this.geometry = new ActorGeometryCache(device, ACTOR_GEOMETRY_CACHE_ENTRIES);

        // GPUBindGroup has no getLayout(); build group-equivalent layouts for the renderer's
        // existing scene and world-texture bind groups instead.
        const sceneCompatLayout = device.createBindGroupLayout({
            label: "webgpu actor scene compat layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
                    buffer: { type: "uniform", minBindingSize: SCENE_UNIFORM_BYTES },
                },
            ],
        });
        const worldTexturesCompatLayout = device.createBindGroupLayout({
            label: "webgpu actor world textures compat layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
                    texture: { sampleType: "float", viewDimension: "2d-array" },
                },
                {
                    binding: 1,
                    visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
                    texture: { sampleType: "uint", viewDimension: "2d" },
                },
                {
                    binding: 2,
                    visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
                    texture: { sampleType: "float", viewDimension: "2d-array" },
                },
                {
                    binding: 3,
                    visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
                    texture: { sampleType: "sint", viewDimension: "2d-array" },
                },
                {
                    binding: 4,
                    visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
                    texture: { sampleType: "float", viewDimension: "2d-array" },
                },
                {
                    binding: 5,
                    visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
                    sampler: { type: "filtering" },
                },
            ],
        });
        const pipelineLayout = device.createPipelineLayout({
            label: "webgpu actor pipeline layout",
            bindGroupLayouts: [
                sceneCompatLayout,
                worldTexturesCompatLayout,
                this.actorUniformLayout,
                this.actorDataLayout,
            ],
        });

        // A scene extension (117 HD) gets a twin of every base pipeline with its WGSL and the
        // extended group(1) (WorldResources.extensionTexturesLayout), plus a depth twin that
        // replays the frame's draws into the extension's depth pass.
        const extension = world.extension;
        const extendedPipelineLayout = world.extensionTexturesLayout
            ? device.createPipelineLayout({
                  label: "webgpu actor extended pipeline layout",
                  bindGroupLayouts: [
                      sceneCompatLayout,
                      world.extensionTexturesLayout,
                      this.actorUniformLayout,
                      this.actorDataLayout,
                  ],
              })
            : undefined;
        type Mode = "base" | "extended" | "depth";
        const blend: GPUBlendState = {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
        };
        // DynamicNpcAnimLoader poses NPCs (and the CPU player path) into ACTOR_VERTEX_STRIDE
        // (16-byte) SceneBuffers whose 4th word is the HD normal + base HSL; GfxCache emits
        // 12-byte vertices. Players also take a per-vertex GPU pose label at @location(1).
        const KINDS: { kind: ActorKind; stride: number; cullMode: GPUCullMode }[] = [
            { kind: "npc", stride: 16, cullMode: "back" },
            { kind: "gfx", stride: 12, cullMode: "none" },
            { kind: "player", stride: 16, cullMode: "back" },
        ];
        const createPipelines = (alpha: boolean, mode: Mode): Map<ActorKind, GPURenderPipeline> => {
            const depth = mode === "depth";
            const module = createActorShaderModule(device, {
                alpha,
                ext: mode === "base" ? undefined : extension!.shaders,
                depth,
            });
            const out = new Map<ActorKind, GPURenderPipeline>();
            for (const { kind, stride, cullMode } of KINDS) {
                const buffers: GPUVertexBufferLayout[] = [
                    {
                        arrayStride: stride,
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: stride === 16 ? "uint32x4" : "uint32x3" },
                        ],
                    },
                ];
                if (kind === "player") {
                    buffers.push({
                        arrayStride: 4,
                        attributes: [{ shaderLocation: 1, offset: 0, format: "uint32" }],
                    });
                }
                out.set(kind, device.createRenderPipeline({
                    label: `webgpu actor ${kind}${alpha ? " alpha" : ""}${mode === "base" ? "" : ` ${mode}`}`,
                    layout: mode === "base" ? pipelineLayout : extendedPipelineLayout!,
                    vertex: { module, entryPoint: actorVertexEntry(kind, depth), buffers },
                    fragment: depth
                        ? { module, entryPoint: ACTOR_DEPTH_FRAGMENT_ENTRY, targets: [] }
                        : {
                              module,
                              entryPoint: ACTOR_FRAGMENT_ENTRY,
                              targets: [
                                  {
                                      format:
                                          mode === "extended"
                                              ? extension!.sceneColorFormat ?? renderer.format
                                              : renderer.format,
                                      blend: alpha ? blend : undefined,
                                  },
                              ],
                          },
                    primitive: { topology: "triangle-list", cullMode, frontFace: "ccw" },
                    depthStencil: {
                        format: depth ? extension!.depthFormat ?? SCENE_DEPTH_FORMAT : SCENE_DEPTH_FORMAT,
                        depthWriteEnabled: true,
                        depthCompare: "less-equal",
                    },
                    multisample: { count: 1 },
                }));
            }
            return out;
        };

        for (const alpha of [false, true]) {
            const base = createPipelines(alpha, "base");
            const extended = extendedPipelineLayout ? createPipelines(alpha, "extended") : undefined;
            const depth = extendedPipelineLayout && world.depthPipelines ? createPipelines(alpha, "depth") : undefined;
            for (const [kind, pipeline] of base) {
                const pair = this.pipelines.get(kind) ?? ([] as unknown as [GPURenderPipeline, GPURenderPipeline]);
                pair[alpha ? 1 : 0] = pipeline;
                this.pipelines.set(kind, pair);
                if (extended) this.variants.set(pipeline, { extended: extended.get(kind)!, depth: depth?.get(kind) });
                if (kind === "player") {
                    this.playerPipelines.add(pipeline);
                    if (extended) this.playerPipelines.add(extended.get(kind)!);
                    if (depth) this.playerPipelines.add(depth.get(kind)!);
                }
            }
        }

        const loader = new DynamicNpcAnimLoader(
            client.npcTypeLoader,
            client.modelLoader,
            client.textureLoader,
            client.seqTypeLoader,
            client.seqFrameLoader,
            client.loaderFactory?.getSkeletalSeqLoader?.(),
            client.varManager,
        );
        loader.setTextureIdIndexMap(this.textureIdIndexMap);
        this.dynamicNpcLoader = loader;

        this.gfx = new ActorGfxRuntime(
            renderer,
            world,
            this.textureIdIndexMap,
            (map) => getRenderPlayersForMap(client, map, this.tileSelection),
            (map, ecsId) => this.tileSelection.shouldRenderNpc(client, map, ecsId),
        );

        this.playerPose = new PlayerPoseGeometry(
            client,
            this.textureIdIndexMap,
            world.loadedTextureIds,
            (textures) => world.uploadMapTextures(textures),
        );
    }

    /**
     * Rebuilds the atlas texture id map exactly as WorldResources.create does. The map is
     * private there and this module may only read its public API.
     */
    private buildTextureIdIndexMap(client: OsrsClient): Map<number, number> {
        const map = new Map<number, number>();
        try {
            const textureLoader = client.textureLoader;
            if (!textureLoader) return map;
            const textureIds = textureLoader
                .getTextureIds()
                .filter((id) => textureLoader.isSd(id))
                .slice(0, MAX_TEXTURES - 1);
            for (let i = 0; i < textureIds.length; i++) {
                map.set(textureIds[i], i + 1);
            }
        } catch {}
        return map;
    }

    update(timeSec: number): void {
        const world = this.world;
        if (!world) return;
        const deltaSec =
            this.lastUpdateTimeSec >= 0 ? Math.min(1, Math.max(0, timeSec - this.lastUpdateTimeSec)) : 0;
        this.lastUpdateTimeSec = timeSec;

        // Same order as the WebGL frame: projectiles advance before actor data is packed;
        // GfxManager.update() runs once per frame, and NPC animation tracks step on client
        // ticks before their geometry is resolved below.
        this.gfx?.projectiles.update(deltaSec * 1000);
        this.gfx?.manager.update();
        this.geometry?.beginFrame();
        this.stepNpcClientAnimations();
        // One winner per occupied tile for this frame, built before any actor is packed.
        this.tileSelection.ensureForFrame(
            this.renderer.osrsClient,
            this.renderer.stats.frameCount | 0,
            this.renderer.mapManager.visibleMaps,
        );

        const writer = this.writer;
        writer.reset();
        this.poseRows.clear();
        this.poseTexels = 0;
        this.frameMaps.length = 0;
        for (const state of this.mapStates.values()) {
            state.opaque.length = 0;
            state.alpha.length = 0;
        }

        this.gfx?.manager.resetWorldBindings();

        const client = this.renderer.osrsClient;
        const cullTile = this.getCullTile();
        const renderDistanceTiles = this.resolveRenderDistanceTiles();

        const visible = this.renderer.mapManager.visibleMaps;
        for (let i = 0; i < visible.length; i++) {
            const map = visible[i];
            const state = this.mapStates.get(getMapSquareId(map.mapX, map.mapY));
            if (!state) continue;
            const deck = this.renderer.worldEntityForMap(map);
            state.uniforms.reset();
            state.uniforms.setWorldEntityTransform(deck?.transform);
            state.npcByEcsId.clear();
            state.playerByPid.clear();
            // A world entity deck lives in its own coordinates (far from its drawn position),
            // so the world-tile cull never applies to it.
            if (!deck && !this.isMapWithinRenderDistance(map, cullTile, renderDistanceTiles)) {
                continue;
            }
            this.packMapNpcs(state, map);
            this.packMapPlayers(state, map);
            if (deck) {
                // Before attached GFX: its lookups read this state's actor maps.
                this.packDeckActors(state, map, deck.entityIndex, deck.overlay.deckHeight ?? 0);
            }
            this.packMapProjectiles(state, map);
            this.packMapWorldGfx(state, map);
            this.packMapAttachedGfx(state, map);
            state.uniforms.flush();
            this.frameMaps.push(state);
        }

        // Zero the padding texels so stale actors from previous frames never leak in.
        const rows = Math.max(1, Math.ceil((writer.count * 2) / 16));
        const paddedU16 = rows * 16 * 4;
        if (writer.data.length < paddedU16) {
            const next = new Uint16Array(paddedU16);
            next.set(writer.data);
            writer.data = next;
        }
        writer.data.fill(0, writer.count * 8, paddedU16);
        this.actorData?.update(this.renderer.device, writer.data, writer.count);
        this.actorData?.updatePoses(this.renderer.device, this.poseUpload, this.poseTexels, this.poseRows.size);
    }

    drawOpaque(pass: GPURenderPassEncoder): void {
        this.draw(pass, false, false);
    }

    drawAlpha(pass: GPURenderPassEncoder): void {
        this.draw(pass, true, false);
    }

    /**
     * Replays this frame's actor draws through the scene extension's depth pipelines, opaque
     * then alpha (the WebGL drawActors order). The renderer has bound the depth-pass group(1).
     */
    drawDepth(pass: GPURenderPassEncoder): void {
        this.draw(pass, false, true);
        this.draw(pass, true, true);
    }

    private draw(pass: GPURenderPassEncoder, alpha: boolean, depth: boolean): void {
        const world = this.world;
        if (!world || !this.actorData) return;
        pass.setBindGroup(0, world.sceneBindGroup);
        const extended = depth || world.extensionActive;
        if (!depth) {
            pass.setBindGroup(1, extended ? world.extensionTextureBindGroup! : world.worldTextureBindGroup);
        }
        pass.setBindGroup(3, this.actorData.bindGroup);
        const maps = this.frameMaps;
        for (let m = 0; m < maps.length; m++) {
            const state = alpha ? maps[maps.length - 1 - m] : maps[m];
            for (const item of alpha ? state.alpha : state.opaque) {
                const variants = extended ? this.variants.get(item.pipeline) : undefined;
                const pipeline = depth ? variants?.depth : variants?.extended ?? item.pipeline;
                if (pipeline) this.dispatch(pass, state, item, pipeline);
            }
        }
    }

    private dispatch(
        pass: GPURenderPassEncoder,
        state: MapActorState,
        item: ActorDrawItem,
        pipeline: GPURenderPipeline,
    ): void {
        const bindGroup = state.uniforms.bindGroupFor(item.entry);
        if (!bindGroup) return;
        pass.setPipeline(pipeline);
        pass.setBindGroup(2, bindGroup, [state.uniforms.offsetFor(item.entry)]);
        pass.setVertexBuffer(0, item.geometry.vertices);
        if (this.playerPipelines.has(pipeline)) {
            // CPU-posed meshes (pose row -1) never read their label, so their own vertex
            // buffer stands in for the label buffer: it is always long enough.
            pass.setVertexBuffer(1, item.geometry.labels ?? item.geometry.vertices);
        }
        pass.setIndexBuffer(item.geometry.indices, "uint32");
        pass.drawIndexed(item.geometry.indexCount);
    }

    onMapAdded(map: WebGPUMapSquare, mapData: SdMapData): void {
        const device = this.renderer.device;
        if (!device || !this.actorUniformLayout) return;
        const id = getMapSquareId(map.mapX, map.mapY);
        this.mapStates.get(id)?.uniforms.destroy();
        this.mapStates.set(id, {
            id,
            uniforms: new MapActorUniforms(
                device,
                this.actorUniformLayout,
                actorUniformStride(device),
                mapData,
            ),
            opaque: [],
            alpha: [],
            npcByEcsId: new Map(),
            playerByPid: new Map(),
        });
    }

    onMapRemoved(mapX: number, mapY: number): void {
        const id = getMapSquareId(mapX, mapY);
        const state = this.mapStates.get(id);
        if (!state) return;
        state.uniforms.destroy();
        this.mapStates.delete(id);
    }

    registerSpotAnimation(event: PlayerSpotAnimationEvent): void {
        try {
            const manager = this.gfx?.manager;
            if (!manager) return;
            const serverId = event.serverId | 0;
            const spotId = event.spotId | 0;
            const slot = typeof event.slot === "number" ? (event.slot | 0) & 0xff : 0;
            if (spotId < 0) {
                manager.clearAttachedSlotPlayer(serverId, slot);
                return;
            }
            const offsetTiles = ((event.height ?? 0) | 0) / 128;
            manager.spawnAttachedToPlayer(
                spotId,
                serverId,
                offsetTiles !== 0 ? "offset" : "ground",
                offsetTiles !== 0 ? offsetTiles : undefined,
                false,
                event.startCycle | 0,
                slot,
            );
        } catch (error) {
            console.warn("[webgpu] registerSpotAnimation failed", error);
        }
    }

    /** Port of overlays4.ts registerNpcSpotAnimation (spells, specials on an NPC target). */
    registerNpcSpotAnimation(event: NpcSpotAnimationEvent): void {
        try {
            const manager = this.gfx?.manager;
            if (!manager) return;
            const serverId = event.npcServerId | 0;
            const spotId = event.spotId | 0;
            const slot = typeof event.slot === "number" ? (event.slot | 0) & 0xff : 0;
            if (spotId < 0) {
                manager.clearAttachedSlotNpc(serverId, slot);
                return;
            }
            const offsetTiles = ((event.height ?? 0) | 0) / 128;
            manager.spawnAttachedToNpc(
                spotId,
                serverId,
                offsetTiles !== 0 ? "offset" : "ground",
                offsetTiles !== 0 ? offsetTiles : undefined,
                false,
                event.startCycle | 0,
                slot,
            );
        } catch (error) {
            console.warn("[webgpu] registerNpcSpotAnimation failed", error);
        }
    }

    /** Port of overlays4.ts registerWorldSpotAnimation (graphics anchored to a tile). */
    registerWorldSpotAnimation(event: WorldSpotAnimationEvent): void {
        try {
            const heightUnits = Number(event.height ?? 0) | 0;
            this.gfx?.manager.spawnAtTile(
                event.spotId | 0,
                { x: event.tile.x | 0, y: event.tile.y | 0, level: event.tile.level ?? 0 },
                {
                    heightTiles: heightUnits !== 0 ? heightUnits / 128 : undefined,
                    startCycle: event.startCycle | 0,
                },
            );
        } catch (error) {
            console.warn("[webgpu] registerWorldSpotAnimation failed", error);
        }
    }

    getProjectileManager(): IProjectileManager | undefined {
        return this.gfx?.projectiles;
    }

    dispose(): void {
        for (const state of this.mapStates.values()) {
            state.uniforms.destroy();
        }
        this.mapStates.clear();
        this.frameMaps.length = 0;
        this.gfx?.projectiles.clear();
        this.gfx = undefined;
        this.playerPose?.clear();
        this.playerPose = undefined;
        this.geometry?.destroy();
        this.geometry = undefined;
        this.actorData?.destroy();
        this.actorData = undefined;
        this.dynamicNpcLoader?.clear();
        this.dynamicNpcLoader = undefined;
    }

    // ── Packing ────────────────────────────────────────────────────────────────────────────────

    /**
     * Port of the WebGL tickPass NPC client update: accumulate authoritative client cycles into
     * pending ticks and advance every visible map's NPC facing and animation tracks by them.
     */
    private stepNpcClientAnimations(): void {
        const client = this.renderer.osrsClient;
        if (!client.isLoggedIn()) return;
        const clientTick = getClientCycle() | 0;
        if (!this.hasClientTickBaseline) {
            this.lastClientTick = clientTick;
            this.hasClientTickBaseline = true;
            this.pendingClientTicks = 0;
        } else {
            const deltaTicks = clientTick - this.lastClientTick;
            if (deltaTicks < 0) {
                this.lastClientTick = clientTick;
                this.pendingClientTicks = 0;
            } else if (deltaTicks > 0) {
                this.pendingClientTicks = Math.min(
                    RENDER_CONSTANTS.MAX_CLIENT_TICK_DEBT,
                    this.pendingClientTicks + deltaTicks,
                );
                this.lastClientTick = clientTick;
            }
        }
        if (this.pendingClientTicks <= 0) return;
        const ticks = Math.min(
            RENDER_CONSTANTS.MAX_CLIENT_TICKS_PER_FRAME,
            this.pendingClientTicks,
        );
        this.pendingClientTicks -= ticks;
        const visible = this.renderer.mapManager.visibleMaps;
        for (let i = 0; i < visible.length; i++) {
            updateNpcClientAnimations(client, visible[i], ticks);
        }
    }

    private packMapNpcs(state: MapActorState, map: WebGPUMapSquare): void {
        const client = this.renderer.osrsClient;
        const ids = client.npcEcs.queryByMap(map.mapX, map.mapY);
        for (let i = 0; i < ids.length; i++) {
            const ecsId = ids[i] | 0;
            if (!this.tileSelection.shouldRenderNpc(client, map, ecsId)) continue;
            this.packNpc(state, map, ecsId, NPC_MODEL_Y_OFFSET);
        }
    }

    /** Packs one NPC's data, geometry and draw entries onto `map`'s state. */
    private packNpc(
        state: MapActorState,
        map: WebGPUMapSquare,
        ecsId: number,
        modelYOffset: number,
    ): void {
        const client = this.renderer.osrsClient;
        const loader = this.dynamicNpcLoader;
        if (!loader) return;
        const dataIndex = packNpcActorData(client, this.writer, map, ecsId);
        if (dataIndex < 0) return;
        state.npcByEcsId.set(ecsId, dataIndex);

        const geometry = resolveUnbatchedNpcGeometry(client, loader, ecsId);
        if (!geometry) return;
        const timeLoaded = map.timeLoaded;
        const opaque = this.geometry?.getOrCreate(
            `${geometry.key}|o`,
            geometry.opaqueVertices,
            geometry.opaqueIndices,
        );
        if (opaque && this.pipelines.get("npc")?.[0]) {
            state.opaque.push({
                pipeline: this.pipelines.get("npc")![0],
                geometry: opaque,
                entry: this.actorEntry(
                    state,
                    map,
                    timeLoaded,
                    modelYOffset,
                    dataIndex,
                    0,
                    0,
                    0,
                ),
            });
        }
        const alpha = this.geometry?.getOrCreate(
            `${geometry.key}|a`,
            geometry.alphaVertices,
            geometry.alphaIndices,
        );
        if (alpha && this.pipelines.get("npc")?.[1]) {
            state.alpha.push({
                pipeline: this.pipelines.get("npc")![1],
                geometry: alpha,
                entry: this.actorEntry(
                    state,
                    map,
                    timeLoaded,
                    modelYOffset,
                    dataIndex,
                    0,
                    0,
                    0,
                ),
            });
        }
    }

    private packMapPlayers(state: MapActorState, map: WebGPUMapSquare): void {
        const client = this.renderer.osrsClient;
        const pids = getRenderPlayersForMap(client, map, this.tileSelection);
        this.packPlayers(state, map, pids, PLAYER_MODEL_Y_OFFSET);
    }

    /** Packs each player's data, pose and draw entries onto `map`'s state. */
    private packPlayers(
        state: MapActorState,
        map: WebGPUMapSquare,
        pids: readonly number[],
        modelYOffset: number,
    ): void {
        const client = this.renderer.osrsClient;
        let indexInMap = 0;
        for (const pid of pids) {
            const dataIndex = packPlayerActorData(client, this.writer, map, pid, indexInMap++);
            if (dataIndex < 0) continue;
            state.playerByPid.set(pid, dataIndex);

            let posed = this.playerPose?.resolve(pid);
            let poseRow = posed?.matrices ? this.poseRowFor(posed.poseKey!, posed.matrices) : -1;
            if (posed?.matrices && poseRow < 0) {
                posed = this.playerPose?.resolve(pid, false);
                poseRow = -1;
            }
            if (!posed) continue;
            const timeLoaded = map.timeLoaded;
            const passes: [GpuGeometry | undefined, ActorDrawItem[], GPURenderPipeline][] = [
                [
                    this.geometry?.getOrCreate(`p:${posed.key}|o`, posed.opaqueVertices, posed.opaqueIndices, posed.opaqueLabels),
                    state.opaque,
                    this.pipelines.get("player")![0],
                ],
                [
                    this.geometry?.getOrCreate(`p:${posed.key}|a`, posed.alphaVertices, posed.alphaIndices, posed.alphaLabels),
                    state.alpha,
                    this.pipelines.get("player")![1],
                ],
            ];
            for (const [geometry, items, pipeline] of passes) {
                if (!geometry) continue;
                items.push({
                    pipeline,
                    geometry,
                    entry: this.actorEntry(state, map, timeLoaded, modelYOffset, dataIndex, 0, 0, 0, poseRow),
                });
            }
        }
    }

    /**
     * Actors aboard a world entity: their ECS tiles are deck coordinates and their worldViewId
     * names the entity, so the world-tile selection and cull do not apply. The map's uniform
     * world-entity transform places them with the deck (WebGL draws these in a second per-map
     * pass with the same transform).
     */
    private packDeckActors(
        state: MapActorState,
        map: WebGPUMapSquare,
        entityIndex: number,
        deckHeight: number,
    ): void {
        const client = this.renderer.osrsClient;
        // The ECS worldViewId is authoritative; WorldViewManager's player/NPC sets are only
        // populated while a sync packet is being applied, so enumerate the streams instead.
        const pids: number[] = [];
        const pe = client.playerEcs;
        for (const pid of pe.getAllActiveIndices()) {
            if ((pe.getWorldViewId(pid) | 0) === entityIndex) pids.push(pid | 0);
        }
        this.packPlayers(state, map, pids, PLAYER_MODEL_Y_OFFSET + deckHeight);

        const npcEcs = client.npcEcs;
        npcEcs.forEachActive((ecsId) => {
            if ((npcEcs.getWorldViewId(ecsId) | 0) !== entityIndex) return;
            this.packNpc(state, map, ecsId | 0, NPC_MODEL_Y_OFFSET - deckHeight);
        });
    }

    /** The frame's pose texture row for a GPU pose, shared by players in the same pose; -1 when full. */
    private poseRowFor(poseKey: string, matrices: Float32Array): number {
        const existing = this.poseRows.get(poseKey);
        if (existing !== undefined) return existing;
        const row = this.poseRows.size;
        if (row >= POSE_ROWS) return -1;
        this.poseUpload.set(matrices, row * POSE_WIDTH * 4);
        this.poseTexels = Math.max(this.poseTexels, (matrices.length / POSE_FLOATS_PER_LABEL) * 3);
        this.poseRows.set(poseKey, row);
        return row;
    }

    private packMapProjectiles(state: MapActorState, map: WebGPUMapSquare): void {
        const client = this.renderer.osrsClient;
        const runtime = this.gfx;
        if (!runtime) return;
        const list = runtime.projectiles.getProjectilesForMap(map.mapX, map.mapY);
        for (let i = 0; i < list.length; i++) {
            const projectile = list[i];
            const dataIndex = packProjectileActorData(client, this.writer, map, projectile as any);
            if (dataIndex < 0) continue;

            const spotId = projectile.projectileId | 0;
            const frameCount = Math.max(1, runtime.cache.getFrameCount(spotId) | 0);
            const raw = projectile.animationFrame | 0;
            const frameIdx = ((raw % frameCount) + frameCount) % frameCount;
            let frameCycle = 0;
            try {
                frameCycle = runtime.cache.smoothingCycle(
                    spotId,
                    frameIdx,
                    (projectile as any).getFrameCycle?.() ?? 0,
                );
            } catch {}

            const pos = projectile.getPosition();
            const mapWorldX = map.getRenderBaseTileX() * 128;
            const mapWorldY = map.getRenderBaseTileY() * 128;
            const relativeXf = pos.x - mapWorldX;
            const relativeYf = pos.y - mapWorldY;
            const subX = relativeXf - Math.floor(relativeXf);
            const subY = relativeYf - Math.floor(relativeYf);

            let modelYOffset = pos.z;
            try {
                const sample = sampleBridgeHeightForWorldTile(
                    this.renderer.mapManager as any,
                    pos.x / 128,
                    pos.y / 128,
                    projectile.plane | 0,
                    BridgePlaneStrategy.RENDER,
                );
                if (sample.valid && Number.isFinite(sample.height)) {
                    modelYOffset = sample.height * 128 - pos.z;
                }
            } catch {}

            this.pushSpotGeometry(
                state,
                map,
                -1,
                spotId,
                frameIdx,
                frameCycle,
                modelYOffset,
                dataIndex,
                subX,
                subY,
            );
        }
    }

    private packMapWorldGfx(state: MapActorState, map: WebGPUMapSquare): void {
        const runtime = this.gfx;
        if (!runtime) return;
        // A boat deck's overlay map draws the graphics on its own tiles (draw.ts addWorldGfxRenderData).
        const overlayView = this.renderer.osrsClient?.worldViewManager?.getWorldViewByOverlayMapId?.(map.id);
        const instances = overlayView
            ? runtime.manager.listWorldInstancesInView(overlayView)
            : runtime.manager.listWorldInstancesForMap(map.mapX, map.mapY);
        for (const inst of instances) {
            const world = inst.world;
            if (!world) continue;
            const dataIndex = packWorldGfxActorData(this.writer, map, world);
            if (dataIndex < 0) continue;
            this.pushInstanceGeometry(state, map, inst, dataIndex);
        }
    }

    private packMapAttachedGfx(state: MapActorState, map: WebGPUMapSquare): void {
        const runtime = this.gfx;
        if (!runtime) return;
        if (state.npcByEcsId.size > 0) {
            const npcMapView: any = Object.create(map);
            npcMapView.npcEntityIds = Array.from(state.npcByEcsId.keys());
            const entries = runtime.manager.getAttachedNpcsForMap(npcMapView);
            for (const entry of entries) {
                const dataIndex = state.npcByEcsId.get(entry.ecsId);
                if (dataIndex === undefined) continue;
                this.pushInstanceGeometry(state, map, entry.inst, dataIndex);
            }
        }
        const playerEntries = runtime.manager.getAttachedPlayersForMap(
            map as unknown as Parameters<typeof runtime.manager.getAttachedPlayersForMap>[0],
        );
        for (const entry of playerEntries) {
            const dataIndex = state.playerByPid.get(entry.pid);
            if (dataIndex === undefined) continue;
            this.pushInstanceGeometry(state, map, entry.inst, dataIndex);
        }
    }

    private pushInstanceGeometry(
        state: MapActorState,
        map: WebGPUMapSquare,
        inst: GfxInstance,
        dataIndex: number,
    ): void {
        const runtime = this.gfx;
        if (!runtime || inst.startTimeMs == null) return;
        const nowMs = (performance?.now?.() as number) || Date.now();
        const ageMs = Math.max(0, nowMs - (inst.startTimeMs | 0));
        const frameIdx = runtime.frameIndexByAge(inst.spotId, Math.floor(ageMs));
        const frameCycle = runtime.frameCycleFor(inst.spotId, frameIdx, ageMs);
        const tiles =
            inst.anchor === "offset"
                ? inst.yOffsetTiles ?? inst.world?.heightOffsetTiles ?? 0
                : 0;
        const modelYOffset = Math.round(tiles * 128);
        this.pushSpotGeometry(
            state,
            map,
            -1,
            inst.spotId,
            frameIdx,
            frameCycle,
            modelYOffset,
            dataIndex,
            0,
            0,
        );
    }

    private pushSpotGeometry(
        state: MapActorState,
        map: WebGPUMapSquare,
        timeLoaded: number,
        spotId: number,
        frameIdx: number,
        frameCycle: number,
        modelYOffset: number,
        dataIndex: number,
        subX: number,
        subY: number,
    ): void {
        const cache = this.gfx?.cache;
        if (!cache) return;
        const opaqueGeometry = cache.ensureFrameGeometry(spotId, frameIdx, false, frameCycle);
        if (opaqueGeometry && this.pipelines.get("gfx")?.[0]) {
            const gpu = this.geometry?.getOrCreate(
                `s:${spotId}|${frameIdx}|${frameCycle}|o`,
                opaqueGeometry.vertices,
                opaqueGeometry.indices,
            );
            if (gpu) {
                state.opaque.push({
                    pipeline: this.pipelines.get("gfx")![0],
                    geometry: gpu,
                    entry: this.actorEntry(
                        state,
                        map,
                        timeLoaded,
                        modelYOffset,
                        dataIndex,
                        0,
                        subX,
                        subY,
                    ),
                });
            }
        }
        const alphaGeometry = cache.ensureFrameGeometry(spotId, frameIdx, true, frameCycle);
        if (alphaGeometry && this.pipelines.get("gfx")?.[1]) {
            const gpu = this.geometry?.getOrCreate(
                `s:${spotId}|${frameIdx}|${frameCycle}|a`,
                alphaGeometry.vertices,
                alphaGeometry.indices,
            );
            if (gpu) {
                state.alpha.push({
                    pipeline: this.pipelines.get("gfx")![1],
                    geometry: gpu,
                    entry: this.actorEntry(
                        state,
                        map,
                        timeLoaded,
                        modelYOffset,
                        dataIndex,
                        0,
                        subX,
                        subY,
                    ),
                });
            }
        }
    }

    private actorEntry(
        state: MapActorState,
        map: WebGPUMapSquare,
        timeLoaded: number,
        modelYOffset: number,
        dataIndex: number,
        drawId: number,
        subX: number,
        subY: number,
        poseRow: number = -1,
    ): number {
        // u_mapPos is where the map is drawn: an instance scene's base, not its square's corner
        // (WebGL passes renderPosX/Y too); the two match for normal squares.
        return state.uniforms.addEntry(
            state.uniforms.renderPosX,
            state.uniforms.renderPosY,
            timeLoaded,
            modelYOffset,
            dataIndex,
            drawId,
            subX,
            subY,
            poseRow,
        );
    }

    // ── Culling ────────────────────────────────────────────────────────────────────────────────

    private getCullTile(): { x: number; y: number } {
        const camera = this.renderer.osrsClient.camera;
        return {
            x: Math.floor(camera.getPosX()),
            y: Math.floor(camera.getPosZ()),
        };
    }

    private resolveRenderDistanceTiles(): number {
        const client = this.renderer.osrsClient;
        const base = Math.max(0, Math.min(90, client.renderDistance | 0));
        return Math.max(25, base);
    }

    /** Port of draw2.ts getMapZoneDistanceFromPoint / isMapWithinRenderDistance. */
    private isMapWithinRenderDistance(
        map: WebGPUMapSquare,
        tile: { x: number; y: number },
        renderDistanceTiles: number,
    ): boolean {
        const renderDistanceZones = Math.max(0, Math.ceil(renderDistanceTiles / 8));
        const zoneX = tile.x >> 3;
        const zoneY = tile.y >> 3;
        const mapMinZoneX = map.getRenderBaseTileX() >> 3;
        const mapMinZoneY = map.getRenderBaseTileY() >> 3;
        const mapMaxZoneX = mapMinZoneX + 7;
        const mapMaxZoneY = mapMinZoneY + 7;
        const dx = zoneX < mapMinZoneX ? mapMinZoneX - zoneX : zoneX > mapMaxZoneX ? zoneX - mapMaxZoneX : 0;
        const dy = zoneY < mapMinZoneY ? mapMinZoneY - zoneY : zoneY > mapMaxZoneY ? zoneY - mapMaxZoneY : 0;
        return Math.max(dx, dy) <= renderDistanceZones;
    }
}
