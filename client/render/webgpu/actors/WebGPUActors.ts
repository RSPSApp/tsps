import type { Frustum } from "../../../game/Frustum";
import { actorBoundsVisible, type ActorBounds } from "../../ActorVisibility";
import { ACTOR_VERTEX_STRIDE } from "../../buffer/ActorNormals";
import type { IProjectileManager } from "../../../game/interfaces/IProjectileManager";
import type { OsrsClient } from "../../../game/OsrsClient";
import type { ActorMutation } from "../../../game/ecs/ActorMutation";
import { getClientCycle } from "../../../network/ServerConnection";
import type { PlayerSpotAnimationEvent } from "../../../game/sync/PlayerSyncTypes";
import type { NpcSpotAnimationEvent, WorldSpotAnimationEvent } from "../../../game/GameRenderer";
import { BridgePlaneStrategy } from "../../../game/scene/PlaneResolver";
import { sampleActorHeightForWorldTile } from "../../../game/scene/BridgeHeightSampler";
import { getMapSquareId } from "../../../rs/map/MapFileIndex";
import type { SdMapData } from "../../loader/SdMapData";
import { MAX_TEXTURES, RENDER_CONSTANTS } from "../../render/constants";
import { GPU_SHADER_STAGE, SCENE_DEPTH_FORMAT } from "../bindings";
import { resolveWebGPURenderDistance } from "../frameConfig";
import { createScenePipeline, withSampleCount } from "../multisample";
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
    type GpuGeometry,
    type ActorPose,
} from "./actorGpu";
import { POSE_FLOATS_PER_LABEL } from "../../player/LabelPose";
import {
    ActorDataWriter,
    ActorTileSelection,
    getRenderPlayersForMap,
    getNpcGeometryRequest,
    packNpcActorData,
    packPlayerActorData,
    packProjectileActorData,
    packWorldGfxActorData,
    updateNpcClientAnimations,
    updateDeckNpcClientAnimations,
} from "./actorPacking";
import { PlayerPoseGeometry, type PosedActorGeometry } from "./actorPlayers";
import { NpcPoseGeometry } from "./actorNpcs";
import { DynamicNpcAnimLoader } from "../../npc/DynamicNpcAnimLoader";
import { AsyncNpcPoseCache } from "../../npc/AsyncNpcPoseCache";
import { TILE_GFX_LIFT_UNITS, type GfxInstance, type GfxManager } from "../../gfx/GfxManager";
import type { GfxCache } from "../../gfx/GfxCache";

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
 *   WebGPU). World entity decks are: their actors are packed from the ECS worldViewId
 *   (packDeckActors) and placed by the map's deck transform. Player frame sounds play from
 *   PlayerAnimController, for every renderer.
 */
export class WebGPUActors {
    readonly stats = { npcCandidates: 0, npcBoundsTests: 0, npcsCulled: 0,
        playerCandidates: 0, playerBoundsTests: 0, playersCulled: 0 };
    private shadow: Frustum | null | undefined = null;
    private readonly npcBounds = new Map<string, ActorBounds>();
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
    private npcPose?: NpcPoseGeometry;
    private asyncNpcPoses?: AsyncNpcPoseCache;
    private readonly npcPoseMutation = (event: ActorMutation) => {
        if (event.kind === "despawn") this.asyncNpcPoses?.forgetActor(event.index);
    };
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
    private posePipelines = new Set<GPURenderPipeline>();
    /** This frame's GPU actor poses: pose key -> pose texture row, packed into poseUpload. */
    private readonly poseRows = new Map<string, ActorPose>();
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
                    visibility: GPU_SHADER_STAGE.VERTEX,
                    buffer: { type: "read-only-storage", minBindingSize: 128 },
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
        // SceneBuffers: normal/base HSL in word 4 and position fractions in word 5.
        // Players also take a per-vertex GPU pose label at @location(1).
        const KINDS: { kind: ActorKind; stride: number; cullMode: GPUCullMode }[] = [
            { kind: "npc", stride: ACTOR_VERTEX_STRIDE, cullMode: "back" },
            { kind: "gfx", stride: ACTOR_VERTEX_STRIDE, cullMode: "none" },
            { kind: "projectile", stride: ACTOR_VERTEX_STRIDE, cullMode: "none" },
            { kind: "player", stride: ACTOR_VERTEX_STRIDE, cullMode: "back" },
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
                            { shaderLocation: 0, offset: 0, format: stride === ACTOR_VERTEX_STRIDE ? "uint32x4" : "uint32x3" },
                            ...(stride === ACTOR_VERTEX_STRIDE ? [{ shaderLocation: 3, offset: 16, format: "uint32" as GPUVertexFormat }] : []),
                        ],
                    },
                ];
                if (kind === "player" || kind === "npc") {
                    buffers.push({
                        arrayStride: 4,
                        attributes: [{ shaderLocation: 1, offset: 0, format: "uint32" }],
                    });
                }
                out.set(kind, createScenePipeline(device, {
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
                if (kind === "player" || kind === "npc") {
                    this.posePipelines.add(pipeline);
                    if (extended) this.posePipelines.add(extended.get(kind)!);
                    if (depth) this.posePipelines.add(depth.get(kind)!);
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
        this.npcPose = new NpcPoseGeometry(client, loader, this.textureIdIndexMap);
        this.asyncNpcPoses = new AsyncNpcPoseCache(loader, client.workerPool, key => this.hasResidentNpcPose(key));
        client.npcEcs.mutationListeners.add(this.npcPoseMutation);

        this.gfx = new ActorGfxRuntime(
            renderer,
            world,
            this.textureIdIndexMap,
            (map) => getRenderPlayersForMap(client, map, this.tileSelection),
            (map, ecsId) => (this.tileSelection.shouldRenderNpc(client, map, ecsId) && this.renderer.interactionHost.shouldRenderNpcFromMap(map, ecsId)),
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

    update(timeSec: number, shadow?: Frustum | null): void {
        const world = this.world;
        if (!world) return;
        this.shadow = shadow;
        for (const key of Object.keys(this.stats) as (keyof typeof this.stats)[]) this.stats[key] = 0;
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
        this.actorData?.updatePoses(this.renderer.device, this.poseUpload, this.poseTexels, this.poseRows);
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
        let boundPipeline: GPURenderPipeline | undefined;
        let boundGeometry: GpuGeometry | undefined;
        let boundLabels: GPUBuffer | undefined;
        const maps = this.frameMaps;
        for (let m = 0; m < maps.length; m++) {
            const state = alpha ? maps[maps.length - 1 - m] : maps[m];
            const items = alpha ? state.alpha : state.opaque;
            if (items.length === 0) continue;
            const bindGroup = state.uniforms.bindGroupFor();
            if (!bindGroup) continue;
            pass.setBindGroup(2, bindGroup);
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const variants = extended ? this.variants.get(item.pipeline) : undefined;
                const pipeline = depth ? variants?.depth : variants?.extended ?? item.pipeline;
                if (!pipeline) continue;
                let instances = 1;
                // Keep draw order: only adjacent opaque actors with consecutive records merge.
                if (!alpha) {
                    while (i + 1 < items.length) {
                        const next = items[i + 1];
                        if (next.pipeline !== item.pipeline || next.geometry !== item.geometry ||
                            next.entry !== item.entry + instances) break;
                        instances++;
                        i++;
                    }
                }
                const selected = withSampleCount(pipeline, depth ? 1 : world.sampleCount);
                if (selected !== boundPipeline) {
                    pass.setPipeline(selected);
                    boundPipeline = selected;
                }
                if (item.geometry !== boundGeometry) {
                    pass.setVertexBuffer(0, item.geometry.vertices);
                    pass.setIndexBuffer(item.geometry.indices, "uint32");
                    boundGeometry = item.geometry;
                }
                if (this.posePipelines.has(pipeline)) {
                    const labels = item.geometry.labels ?? item.geometry.vertices;
                    if (labels !== boundLabels) {
                        pass.setVertexBuffer(1, labels);
                        boundLabels = labels;
                    }
                }
                pass.drawIndexed(item.geometry.indexCount, instances, 0, 0, item.entry);
            }
        }
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

    getActorGraphic(kind: "player" | "npc", serverId: number): number {
        return this.gfx?.manager.getActorGraphic(kind, serverId) ?? -1;
    }
    getActorGfxManager():GfxManager|undefined { return this.gfx?.manager; }
    getActorGfxCache():GfxCache|undefined { return this.gfx?.cache; }

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
    registerWorldSpotAnimation(event: WorldSpotAnimationEvent): number | undefined {
        try {
            const heightUnits = Number(event.height ?? 0) | 0;
            return this.gfx?.manager.spawnAtTile(
                event.spotId | 0,
                { x: event.tile.x | 0, y: event.tile.y | 0, level: event.tile.level ?? 0 },
                {
                    heightTiles: heightUnits !== 0 ? heightUnits / 128 : undefined,
                    startCycle: event.startCycle | 0,
                    loop: event.loop,
                },
            );
        } catch (error) {
            console.warn("[webgpu] registerWorldSpotAnimation failed", error);
        }
        return undefined;
    }

    killWorldSpotAnimation(id: number): void {
        this.gfx?.manager.kill(id);
    }

    getProjectileManager(): IProjectileManager | undefined {
        return this.gfx?.projectiles;
    }

    invalidateNpcDefinitions(): void {
        this.asyncNpcPoses?.invalidate();
        this.npcBounds.clear();
        this.npcPose?.clear();
        this.dynamicNpcLoader?.clear();
        // This cache remains usable after releasing its buffers. Player entries
        // are rebuilt too, so no draw can keep a retired shared buffer reference.
        this.geometry?.destroy();
    }

    dispose(): void {
        this.renderer.osrsClient.npcEcs.mutationListeners.delete(this.npcPoseMutation);
        this.asyncNpcPoses?.dispose();
        this.asyncNpcPoses = undefined;
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
        this.npcBounds.clear();
        this.npcPose?.clear();
        this.npcPose = undefined;
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
        updateDeckNpcClientAnimations(client, ticks);
    }

    private packMapNpcs(state: MapActorState, map: WebGPUMapSquare): void {
        const client = this.renderer.osrsClient;
        const ids = client.npcEcs.queryByMap(map.mapX, map.mapY);
        for (let i = 0; i < ids.length; i++) {
            const ecsId = ids[i] | 0;
            if (!this.tileSelection.shouldRenderNpc(client, map, ecsId) ||
                !this.renderer.interactionHost.shouldRenderNpcFromMap(map, ecsId)) continue;
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
        this.stats.npcCandidates++;
        const dataIndex = packNpcActorData(client, this.writer, map, ecsId);
        if (dataIndex < 0) return;
        state.npcByEcsId.set(ecsId, dataIndex);

        let request: Parameters<DynamicNpcAnimLoader["getFrameGeometry"]> | undefined;
        let opaque: GpuGeometry | null | undefined;
        let alpha: GpuGeometry | null | undefined;
        let poseRow = -1;
        try {
            request = getNpcGeometryRequest(client, ecsId);
            const posed = this.npcPose?.resolve(request, !!this.world?.extensionActive);
            if (posed?.matrices) poseRow = this.poseRowFor(posed.poseKey!, posed.matrices);
            if (posed && poseRow >= 0) {
                opaque = this.geometry?.getOrCreate(posed.key + "|o", posed.opaqueVertices, posed.opaqueIndices, posed.opaqueLabels) ?? null;
                alpha = this.geometry?.getOrCreate(posed.key + "|a", posed.alphaVertices, posed.alphaIndices, posed.alphaLabels) ?? null;
            } else {
                const key = this.asyncNpcPoses?.getKey(request, ecsId);
                if (key) {
                    const bounds = this.npcBounds.get(key);
                    if (bounds) {
                        this.stats.npcBoundsTests++;
                        if (!this.actorVisible(bounds, map, dataIndex, -modelYOffset,
                            (client.npcEcs.getWorldViewId(ecsId) | 0) >= 0)) {
                            this.stats.npcsCulled++;
                            return;
                        }
                    }
                    opaque = this.geometry?.get(`${key}|o`);
                    alpha = this.geometry?.get(`${key}|a`);
                }
            }
        } catch {
            request ??= [client.npcEcs.getNpcTypeId(ecsId) | 0, -1, 0];
        }
        // The smaller CPU pose cache may evict a mesh whose two GPU passes are still resident.
        if (opaque === undefined || alpha === undefined || (!opaque && !alpha)) {
            poseRow = -1;
            if (!request) return;
            const geometry = this.asyncNpcPoses?.get(request, ecsId);
            if (geometry) {
                if (geometry.bounds) {
                    this.npcBounds.delete(geometry.key);
                    this.npcBounds.set(geometry.key, geometry.bounds);
                    if (this.npcBounds.size > ACTOR_GEOMETRY_CACHE_ENTRIES) this.npcBounds.delete(this.npcBounds.keys().next().value!);
                }
                opaque = this.geometry?.getOrCreate(`${geometry.key}|o`, geometry.opaqueVertices, geometry.opaqueIndices);
                alpha = this.geometry?.getOrCreate(`${geometry.key}|a`, geometry.alphaVertices, geometry.alphaIndices);
            } else {
                const key = this.asyncNpcPoses?.getFallbackKey(request, ecsId);
                if (!key || !this.hasResidentNpcPose(key)) return;
                opaque = this.geometry?.get(`${key}|o`);
                alpha = this.geometry?.get(`${key}|a`);
            }
        }
        const timeLoaded = map.timeLoaded;
        let entry: number | undefined;
        if (opaque && this.pipelines.get("npc")?.[0]) {
            state.opaque.push({
                pipeline: this.pipelines.get("npc")![0],
                geometry: opaque,
                entry: entry ??= this.actorEntry(
                    state,
                    map,
                    timeLoaded,
                    modelYOffset,
                    dataIndex,
                    0,
                    0,
                    0,
                    poseRow,
                ),
            });
        }
        if (alpha && this.pipelines.get("npc")?.[1]) {
            state.alpha.push({
                pipeline: this.pipelines.get("npc")![1],
                geometry: alpha,
                entry: entry ??= this.actorEntry(
                    state,
                    map,
                    timeLoaded,
                    modelYOffset,
                    dataIndex,
                    0,
                    0,
                    0,
                    poseRow,
                ),
            });
        }
    }

    private hasResidentNpcPose(key: string): boolean {
        const opaque = this.geometry?.get(`${key}|o`);
        const alpha = this.geometry?.get(`${key}|a`);
        return opaque !== undefined && alpha !== undefined && !!(opaque || alpha);
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
            if (!this.renderer.interactionHost.shouldRenderPlayerIndex(pid)) continue;
            this.stats.playerCandidates++;
            const dataIndex = packPlayerActorData(client, this.writer, map, pid, indexInMap++);
            if (dataIndex < 0) continue;
            state.playerByPid.set(pid, dataIndex);

            const visible = (geometry: PosedActorGeometry) => {
                if (!geometry.bounds) return true;
                this.stats.playerBoundsTests++;
                const keep = this.actorVisible(geometry.bounds, map, dataIndex, modelYOffset,
                    (client.playerEcs.getWorldViewId(pid) | 0) >= 0);
                if (!keep) this.stats.playersCulled++;
                return keep;
            };
            let posed = this.playerPose?.resolve(pid, true, visible);
            let poseRow = posed?.matrices ? this.poseRowFor(posed.poseKey!, posed.matrices) : -1;
            if (posed?.matrices && poseRow < 0) {
                posed = this.playerPose?.resolve(pid, false, visible);
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
            let entry: number | undefined;
            for (const [geometry, items, pipeline] of passes) {
                if (!geometry) continue;
                items.push({
                    pipeline,
                    geometry,
                    entry: entry ??= this.actorEntry(state, map, timeLoaded, modelYOffset, dataIndex, 0, 0, 0, poseRow),
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

    /** The frame's pose texture row for a GPU pose, shared by actors in the same pose; -1 when full. */
    private poseRowFor(poseKey: string, matrices: Float32Array): number {
        const existing = this.poseRows.get(poseKey);
        if (existing !== undefined) return existing.row;
        const row = this.poseRows.size;
        if (row >= POSE_ROWS) return -1;
        if (!this.actorData?.hasPose(poseKey, row, matrices)) {
            this.poseUpload.set(matrices, row * POSE_WIDTH * 4);
        }
        this.poseTexels = Math.max(this.poseTexels, (matrices.length / POSE_FLOATS_PER_LABEL) * 3);
        this.poseRows.set(poseKey, { row, matrices });
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
                const sample = sampleActorHeightForWorldTile(
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
                "projectile",
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
            : runtime.manager.listWorldInstancesForDrawnMap(map);
        for (const inst of instances) {
            const world = inst.world;
            if (!world) continue;
            const dataIndex = packWorldGfxActorData(this.writer, map, world);
            if (dataIndex < 0) continue;
            // Drawn over the floor's flat decorations, as the WebGL renderer does (GfxRenderer).
            this.pushInstanceGeometry(state, map, inst, dataIndex, TILE_GFX_LIFT_UNITS);
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
        liftUnits = 0,
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
        const modelYOffset = Math.round(tiles * 128) + liftUnits;
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
        kind: "gfx" | "projectile" = "gfx",
    ): void {
        const cache = this.gfx?.cache;
        if (!cache) return;
        let entry: number | undefined;
        const opaqueGeometry = cache.ensureFrameGeometry(spotId, frameIdx, false, frameCycle);
        if (opaqueGeometry && this.pipelines.get(kind)?.[0]) {
            const gpu = this.geometry?.getOrCreate(
                `s:${spotId}|${frameIdx}|${frameCycle}|o`,
                opaqueGeometry.vertices,
                opaqueGeometry.indices,
            );
            if (gpu) {
                state.opaque.push({
                    pipeline: this.pipelines.get(kind)![0],
                    geometry: gpu,
                    entry: entry ??= this.actorEntry(
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
        if (alphaGeometry && this.pipelines.get(kind)?.[1]) {
            const gpu = this.geometry?.getOrCreate(
                `s:${spotId}|${frameIdx}|${frameCycle}|a`,
                alphaGeometry.vertices,
                alphaGeometry.indices,
            );
            if (gpu) {
                state.alpha.push({
                    pipeline: this.pipelines.get(kind)![1],
                    geometry: gpu,
                    entry: entry ??= this.actorEntry(
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

    private actorVisible(bounds: ActorBounds, map: WebGPUMapSquare, dataIndex: number,
        modelYOffset: number, worldEntity: boolean): boolean {
        // Deck transforms are applied in view space; their local tiles are not world positions.
        if (worldEntity || !map.heightMapData || !this.renderer.osrsClient.camera) return true;
        const offset = dataIndex * 8;
        const localX = (this.writer.data[offset] << 16) >> 16;
        const localZ = (this.writer.data[offset + 1] << 16) >> 16;
        const plane = this.writer.data[offset + 2] & 3;
        const size = map.heightMapSize;
        const tx = (localX >> 7) + map.borderSize, tz = (localZ >> 7) + map.borderSize;
        if (tx < 0 || tz < 0 || tx + 1 >= size || tz + 1 >= size) return true;
        const start = plane * size * size + tz * size + tx;
        const data = map.heightMapData;
        const heights = [data[start], data[start + 1], data[start + size], data[start + size + 1]];
        if (!heights.every(Number.isFinite)) return true;
        const groundMin = (-Math.max(...heights) * 8 + modelYOffset) / 128;
        const groundMax = (-Math.min(...heights) * 8 + modelYOffset) / 128;
        return actorBoundsVisible(bounds, map.getRenderBaseWorldX() + localX / 128,
            map.getRenderBaseWorldY() + localZ / 128, groundMin, groundMax,
            this.renderer.osrsClient.camera.frustum, this.shadow);
    }

    private getCullTile(): { x: number; y: number } {
        return {
            x: this.renderer.playerPosUni[0],
            y: this.renderer.playerPosUni[1],
        };
    }

    private resolveRenderDistanceTiles(): number {
        return resolveWebGPURenderDistance(this.renderer);
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
