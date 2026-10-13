import type { OsrsClient } from "../../game/OsrsClient";
import {
    DEFAULT_WATER_MATERIAL,
    ICE_WATER_MATERIAL,
    MATERIAL_TEXTURE_ROWS,
    MAX_TEXTURES,
    SWAMP_WATER_MATERIAL,
    TEXTURE_SIZE,
    VANILLA_WATER_SURFACE_COLORS,
    WATER_TEXTURE_ASSETS,
    WATER_TEXTURE_SIZE,
    materialByte,
    waterRgb,
    type WaterMaterialParams,
} from "../render/constants";
import { KNOWN_WATER_TEXTURE_IDS } from "../water/WaterTextureIds";
import {
    GPU_BUFFER_USAGE,
    GPU_SHADER_STAGE,
    GPU_TEXTURE_USAGE,
    MAP_TEXTURE_BINDINGS,
    SCENE_DEPTH_FORMAT,
    SCENE_UNIFORM_FLOATS,
    WORLD_TEXTURE_BINDINGS,
} from "./bindings";
import { createScenePipeline, withSampleCount } from "./multisample";
import type { WebGPUSceneExtension } from "./sceneExtension";
import {
    DEPTH_FRAGMENT_ENTRY,
    MAIN_DEPTH_VERTEX_ENTRY,
    MAIN_FRAGMENT_ENTRY,
    MAIN_VERTEX_ENTRY,
    createMainShaderModule,
} from "./shaders";

const SCENE_UNIFORM_BYTES =
    Math.ceil((SCENE_UNIFORM_FLOATS * 4) / 16) * 16;
const MAP_UNIFORM_MIN_BINDING_SIZE = 96;
const SHADER_STAGES = GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT;

type WaterRgb = [number, number, number];

function collectWaterOverlayColors(osrsClient: OsrsClient): Map<number, WaterRgb> {
    const colors = new Map<number, WaterRgb>();
    const loaderFactory = osrsClient.loaderFactory;
    if (!loaderFactory?.getOverlayTypeLoader) return colors;

    let overlayTypeLoader: ReturnType<typeof loaderFactory.getOverlayTypeLoader>;
    try {
        overlayTypeLoader = loaderFactory.getOverlayTypeLoader();
    } catch {
        return colors;
    }

    const overlayCount = overlayTypeLoader.getCount();
    for (let overlayId = 0; overlayId < overlayCount; overlayId++) {
        let overlay;
        try {
            overlay = overlayTypeLoader.load(overlayId);
        } catch {
            continue;
        }

        const textureId = overlay?.textureId ?? -1;
        if (
            !KNOWN_WATER_TEXTURE_IDS.has(textureId) ||
            colors.has(textureId) ||
            (overlay.primaryRgb & 0xffffff) === 0
        ) {
            continue;
        }
        colors.set(textureId, waterRgb(overlay.primaryRgb));
    }
    return colors;
}

function getWaterMaterialParams(
    textureId: number,
    overlayColors: Map<number, WaterRgb>,
): WaterMaterialParams {
    if (textureId === 25) return SWAMP_WATER_MATERIAL;
    if (textureId === 91) return ICE_WATER_MATERIAL;

    const surfaceColor =
        VANILLA_WATER_SURFACE_COLORS.get(textureId) ?? overlayColors.get(textureId);
    if (surfaceColor) {
        return { ...DEFAULT_WATER_MATERIAL, surfaceColor };
    }
    return DEFAULT_WATER_MATERIAL;
}

function buildMaterialTextureData(
    osrsClient: OsrsClient,
    textureIds: number[],
    waterAvailable: boolean,
): { data: Int8Array; width: number } {
    const textureLayerCount = textureIds.length + 1;
    const waterOverlayColors = waterAvailable
        ? collectWaterOverlayColors(osrsClient)
        : new Map<number, WaterRgb>();
    const data = new Int8Array(textureLayerCount * MATERIAL_TEXTURE_ROWS * 4);
    data[3] = 1;

    const textureLoader = osrsClient.textureLoader;
    if (!textureLoader) return { data, width: textureLayerCount };

    for (let i = 0; i < textureIds.length; i++) {
        const id = textureIds[i];
        try {
            const material = textureLoader.getMaterial(id);
            const baseLayer = i + 1;
            const row0 = baseLayer * 4;
            const row1 = (textureLayerCount + baseLayer) * 4;
            const row2 = (textureLayerCount * 2 + baseLayer) * 4;
            const row3 = (textureLayerCount * 3 + baseLayer) * 4;
            const row4 = (textureLayerCount * 4 + baseLayer) * 4;
            const row5 = (textureLayerCount * 5 + baseLayer) * 4;
            const isWater = waterAvailable && KNOWN_WATER_TEXTURE_IDS.has(id);

            data[row0] = material.animU;
            data[row0 + 1] = material.animV;
            data[row0 + 2] = materialByte(material.alphaCutOff * 255);
            data[row0 + 3] = 1;

            data[row1] = material.animSpeed;
            data[row1 + 1] = isWater ? 1 : 0;

            if (isWater) {
                const water = getWaterMaterialParams(id, waterOverlayColors);
                data[row1 + 2] = (water.hasFoam ? 1 : 0) | (water.useNormalMap2 ? 2 : 0);

                data[row2] = materialByte(water.surfaceColor[0] * 255);
                data[row2 + 1] = materialByte(water.surfaceColor[1] * 255);
                data[row2 + 2] = materialByte(water.surfaceColor[2] * 255);
                data[row2 + 3] = materialByte(water.baseOpacity * 255);

                data[row3] = materialByte(water.depthColor[0] * 255);
                data[row3 + 1] = materialByte(water.depthColor[1] * 255);
                data[row3 + 2] = materialByte(water.depthColor[2] * 255);
                data[row3 + 3] = materialByte(water.fresnelAmount * 255);

                data[row4] = materialByte((water.normalStrength / 0.5) * 255);
                data[row4 + 1] = materialByte(water.specularStrength * 255);
                data[row4 + 2] = materialByte((water.specularGloss / 500) * 255);
                data[row4 + 3] = materialByte((water.duration / 4) * 255);

                data[row5] = materialByte(water.foamColor[0] * 255);
                data[row5 + 1] = materialByte(water.foamColor[1] * 255);
                data[row5 + 2] = materialByte(water.foamColor[2] * 255);
            }
        } catch (e) {
            console.error("Failed loading texture", id, e);
        }
    }

    return { data, width: textureLayerCount };
}

async function loadWaterLayer(src: string): Promise<ImageBitmap> {
    const image = new Image();
    image.src = src;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = WATER_TEXTURE_SIZE;
    canvas.height = WATER_TEXTURE_SIZE;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Could not create canvas context for water texture upload");
    }
    context.drawImage(image, 0, 0, WATER_TEXTURE_SIZE, WATER_TEXTURE_SIZE);
    return createImageBitmap(canvas);
}

export class WorldResources {
    static async create(
        device: GPUDevice,
        osrsClient: OsrsClient,
        canvasFormat: GPUTextureFormat,
    ): Promise<WorldResources> {
        const sceneData = new Float32Array(SCENE_UNIFORM_FLOATS);
        const sceneUniformBuffer = device.createBuffer({
            label: "webgpu scene uniforms",
            size: SCENE_UNIFORM_BYTES,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });
        const sceneLayout = device.createBindGroupLayout({
            label: "webgpu scene uniforms layout",
            entries: [
                {
                    binding: 0,
                    visibility: SHADER_STAGES,
                    buffer: { type: "uniform", minBindingSize: SCENE_UNIFORM_BYTES },
                },
            ],
        });
        const sceneBindGroup = device.createBindGroup({
            layout: sceneLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: sceneUniformBuffer, offset: 0, size: SCENE_UNIFORM_BYTES },
                },
            ],
        });

        const mapUniformsLayout = device.createBindGroupLayout({
            label: "webgpu map uniforms layout",
            entries: [
                {
                    binding: 0,
                    visibility: SHADER_STAGES,
                    buffer: {
                        type: "uniform",
                        hasDynamicOffset: true,
                        minBindingSize: MAP_UNIFORM_MIN_BINDING_SIZE,
                    },
                },
            ],
        });

        const mapTexturesLayout = device.createBindGroupLayout({
            label: "webgpu map textures layout",
            entries: [
                {
                    binding: MAP_TEXTURE_BINDINGS.modelInfo,
                    visibility: SHADER_STAGES,
                    texture: { sampleType: "uint", viewDimension: "2d" },
                },
                {
                    binding: MAP_TEXTURE_BINDINGS.heightMap,
                    visibility: SHADER_STAGES,
                    texture: { sampleType: "sint", viewDimension: "2d-array" },
                },
                {
                    binding: MAP_TEXTURE_BINDINGS.waterMask,
                    visibility: SHADER_STAGES,
                    texture: { sampleType: "float", viewDimension: "2d-array" },
                },
                {
                    binding: MAP_TEXTURE_BINDINGS.groundMaterial,
                    visibility: SHADER_STAGES,
                    texture: { sampleType: "uint", viewDimension: "2d-array" },
                },
            ],
        });

        const worldTexturesEntries: GPUBindGroupLayoutEntry[] = [
            {
                binding: WORLD_TEXTURE_BINDINGS.textures,
                visibility: SHADER_STAGES,
                texture: { sampleType: "float", viewDimension: "2d-array" },
            },
            {
                binding: WORLD_TEXTURE_BINDINGS.materials,
                visibility: SHADER_STAGES,
                texture: { sampleType: "uint", viewDimension: "2d" },
            },
            {
                binding: WORLD_TEXTURE_BINDINGS.waterTextures,
                visibility: SHADER_STAGES,
                texture: { sampleType: "float", viewDimension: "2d-array" },
            },
            {
                binding: WORLD_TEXTURE_BINDINGS.heightMap,
                visibility: SHADER_STAGES,
                texture: { sampleType: "sint", viewDimension: "2d-array" },
            },
            {
                binding: WORLD_TEXTURE_BINDINGS.waterMask,
                visibility: SHADER_STAGES,
                texture: { sampleType: "float", viewDimension: "2d-array" },
            },
            {
                binding: WORLD_TEXTURE_BINDINGS.sampler,
                visibility: SHADER_STAGES,
                sampler: { type: "filtering" },
            },
        ];
        const worldTexturesLayout = device.createBindGroupLayout({
            label: "webgpu world textures layout",
            entries: worldTexturesEntries,
        });

        const ownedTextures: GPUTexture[] = [];

        const textureLoader = osrsClient.textureLoader;
        let textureIds: number[] = [];
        if (textureLoader) {
            textureIds = textureLoader
                .getTextureIds()
                .filter((id) => textureLoader.isSd(id))
                .slice(0, MAX_TEXTURES - 1);
        }

        const pixelCount = TEXTURE_SIZE * TEXTURE_SIZE;
        const requestedLayers = textureIds.length + 1;
        const maxLayers = device.limits.maxTextureArrayLayers || requestedLayers;
        const layerCount = Math.max(1, Math.min(requestedLayers, maxLayers));
        if (layerCount < requestedLayers) {
            console.warn(
                `[webgpu] world texture atlas capped at ${layerCount} layers (device limit)`,
            );
        }

        const pixels = new Int32Array(layerCount * pixelCount);
        pixels.fill(0xffffffff);

        // Mirror initTextureArray: layer 0 is white, textureIds[i] is layer i+1. Textures
        // past the preload are streamed per map via uploadMapTextures.
        const textureIdIndexMap = new Map<number, number>();
        const loadedTextureIds = new Set<number>();
        for (let i = 0; i < Math.min(textureIds.length, layerCount - 1); i++) {
            textureIdIndexMap.set(textureIds[i], i + 1);
        }

        const cacheInfo = osrsClient.loadedCache?.info;
        let maxPreloadTextures = textureIds.length;
        if (cacheInfo && cacheInfo.game === "runescape" && cacheInfo.revision >= 508) {
            maxPreloadTextures = 64;
        }
        if (textureLoader) {
            const preloadCount = Math.min(textureIds.length, maxPreloadTextures, layerCount - 1);
            for (let i = 0; i < preloadCount; i++) {
                const textureId = textureIds[i];
                try {
                    const texturePixels = textureLoader.getPixelsArgb(
                        textureId,
                        TEXTURE_SIZE,
                        true,
                        1.0,
                    );
                    pixels.set(texturePixels, (i + 1) * pixelCount);
                } catch (e) {
                    console.error("Failed loading texture", textureId, e);
                }
                loadedTextureIds.add(textureId);
            }
        }

        const textureArray = device.createTexture({
            label: "webgpu world texture atlas",
            size: [TEXTURE_SIZE, TEXTURE_SIZE, layerCount],
            format: "rgba8unorm",
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        ownedTextures.push(textureArray);

        const pixelBytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
        const layerBytes = pixelCount * 4;
        for (let layer = 0; layer < layerCount; layer++) {
            device.queue.writeTexture(
                { texture: textureArray, origin: { x: 0, y: 0, z: layer } },
                pixelBytes.subarray(layer * layerBytes, (layer + 1) * layerBytes),
                { bytesPerRow: TEXTURE_SIZE * 4, rowsPerImage: TEXTURE_SIZE },
                { width: TEXTURE_SIZE, height: TEXTURE_SIZE, depthOrArrayLayers: 1 },
            );
        }

        let waterAvailable = true;
        let waterTexture: GPUTexture;
        try {
            const bitmaps = await Promise.all(WATER_TEXTURE_ASSETS.map(loadWaterLayer));
            waterTexture = device.createTexture({
                label: "webgpu water atlas",
                size: [WATER_TEXTURE_SIZE, WATER_TEXTURE_SIZE, bitmaps.length],
                format: "rgba8unorm",
                usage:
                    GPU_TEXTURE_USAGE.TEXTURE_BINDING |
                    GPU_TEXTURE_USAGE.COPY_DST |
                    GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
            });
            bitmaps.forEach((bitmap, layer) => {
                device.queue.copyExternalImageToTexture(
                    { source: bitmap },
                    { texture: waterTexture, origin: { x: 0, y: 0, z: layer } },
                    { width: WATER_TEXTURE_SIZE, height: WATER_TEXTURE_SIZE, depthOrArrayLayers: 1 },
                );
                bitmap.close();
            });
        } catch (error) {
            console.log(
                "[webgpu] Failed to load water textures; water renders with the vanilla texture path",
                error,
            );
            waterAvailable = false;
            waterTexture = device.createTexture({
                label: "webgpu water atlas fallback",
                size: [1, 1, 1],
                format: "rgba8unorm",
                usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
            });
        }
        ownedTextures.push(waterTexture);

        const { data: materialData, width: materialWidth } = buildMaterialTextureData(
            osrsClient,
            textureIds,
            waterAvailable,
        );
        const materialTexture = device.createTexture({
            label: "webgpu material lookup",
            size: [materialWidth, MATERIAL_TEXTURE_ROWS],
            format: "rgba8uint",
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        ownedTextures.push(materialTexture);
        device.queue.writeTexture(
            { texture: materialTexture },
            materialData,
            { bytesPerRow: materialWidth * 4, rowsPerImage: MATERIAL_TEXTURE_ROWS },
            { width: materialWidth, height: MATERIAL_TEXTURE_ROWS, depthOrArrayLayers: 1 },
        );

        const heightMapPlaceholder = device.createTexture({
            label: "webgpu global height map placeholder",
            size: [1, 1, 1],
            format: "r16sint",
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        ownedTextures.push(heightMapPlaceholder);

        const waterMaskPlaceholder = device.createTexture({
            label: "webgpu global water mask placeholder",
            size: [1, 1, 1],
            format: "rgba8unorm",
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        ownedTextures.push(waterMaskPlaceholder);

        const sampler = device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            addressModeW: "repeat",
            magFilter: "linear",
            minFilter: "linear",
        });

        const worldTextureEntries: GPUBindGroupEntry[] = [
            {
                binding: WORLD_TEXTURE_BINDINGS.textures,
                resource: textureArray.createView({ dimension: "2d-array" }),
            },
            { binding: WORLD_TEXTURE_BINDINGS.materials, resource: materialTexture.createView() },
            {
                binding: WORLD_TEXTURE_BINDINGS.waterTextures,
                resource: waterTexture.createView({ dimension: "2d-array" }),
            },
            {
                binding: WORLD_TEXTURE_BINDINGS.heightMap,
                resource: heightMapPlaceholder.createView({ dimension: "2d-array" }),
            },
            {
                binding: WORLD_TEXTURE_BINDINGS.waterMask,
                resource: waterMaskPlaceholder.createView({ dimension: "2d-array" }),
            },
            { binding: WORLD_TEXTURE_BINDINGS.sampler, resource: sampler },
        ];
        const worldTextureBindGroup = device.createBindGroup({
            label: "webgpu world textures",
            layout: worldTexturesLayout,
            entries: worldTextureEntries,
        });

        // A plugin's scene extension appends its resources to group(1); its pipelines get the
        // extended layout and the map draw code binds the extended group while it is active.
        const extension = osrsClient.clientPlugins.createWebGPUSceneExtension({
            device,
            textureIdIndexMap,
        });
        const extensionTexturesLayout = extension
            ? device.createBindGroupLayout({
                  label: "webgpu world textures extended layout",
                  entries: [...worldTexturesEntries, ...extension.layoutEntries],
              })
            : undefined;
        const extendedGroup = (label: string, entries: GPUBindGroupEntry[]) =>
            device.createBindGroup({
                label,
                layout: extensionTexturesLayout!,
                entries: [...worldTextureEntries, ...entries],
            });
        const extensionTextureBindGroup = extension
            ? extendedGroup("webgpu world textures extended", extension.bindGroupEntries)
            : undefined;
        const depthTextureBindGroup = extension?.shaders.depth
            ? extendedGroup(
                  "webgpu world textures depth pass",
                  extension.depthBindGroupEntries ?? extension.bindGroupEntries,
              )
            : undefined;

        const pipelineLayout = device.createPipelineLayout({
            label: "webgpu main world pipeline layout",
            bindGroupLayouts: [
                sceneLayout,
                worldTexturesLayout,
                mapUniformsLayout,
                mapTexturesLayout,
            ],
        });

        const extendedPipelineLayout = extensionTexturesLayout
            ? device.createPipelineLayout({
                  label: "webgpu main world extended pipeline layout",
                  bindGroupLayouts: [
                      sceneLayout,
                      extensionTexturesLayout,
                      mapUniformsLayout,
                      mapTexturesLayout,
                  ],
              })
            : undefined;

        const createMainPipeline = (
            alpha: boolean,
            mode: "base" | "extended" | "depth",
        ): GPURenderPipeline => {
            const depth = mode === "depth";
            const module = createMainShaderModule(device, {
                alpha,
                ext: mode === "base" ? undefined : extension!.shaders,
                depth,
            });
            return createScenePipeline(device, {
                label: `webgpu main${alpha ? " alpha" : ""} pipeline${mode === "base" ? "" : ` ${mode}`}`,
                layout: mode === "base" ? pipelineLayout : extendedPipelineLayout!,
                vertex: {
                    module,
                    entryPoint: depth ? MAIN_DEPTH_VERTEX_ENTRY : MAIN_VERTEX_ENTRY,
                    buffers: [
                        {
                            arrayStride: 12,
                            attributes: [{ shaderLocation: 0, offset: 0, format: "uint32x3" }],
                        },
                    ],
                },
                fragment: depth
                    ? { module, entryPoint: DEPTH_FRAGMENT_ENTRY, targets: [] }
                    : {
                          module,
                          entryPoint: MAIN_FRAGMENT_ENTRY,
                          targets: [
                              {
                                  // Extended pipelines write the extension's offscreen HDR
                                  // target when it declares one.
                                  format:
                                      mode === "extended"
                                          ? extension!.sceneColorFormat ?? canvasFormat
                                          : canvasFormat,
                                  blend: alpha
                                      ? {
                                            color: {
                                                srcFactor: "src-alpha",
                                                dstFactor: "one-minus-src-alpha",
                                                operation: "add",
                                            },
                                            alpha: {
                                                srcFactor: "src-alpha",
                                                dstFactor: "one-minus-src-alpha",
                                                operation: "add",
                                            },
                                        }
                                      : undefined,
                              },
                          ],
                      },
                primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
                depthStencil: {
                    format: depth ? extension!.depthFormat ?? SCENE_DEPTH_FORMAT : SCENE_DEPTH_FORMAT,
                    depthWriteEnabled: true,
                    depthCompare: "less-equal",
                },
            });
        };

        return new WorldResources({
            device,
            sceneData,
            sceneUniformBuffer,
            basePipelines: [createMainPipeline(false, "base"), createMainPipeline(true, "base")],
            extendedPipelines: extension
                ? [createMainPipeline(false, "extended"), createMainPipeline(true, "extended")]
                : undefined,
            depthPipelines: depthTextureBindGroup
                ? [createMainPipeline(false, "depth"), createMainPipeline(true, "depth")]
                : undefined,
            extension,
            sceneBindGroup,
            worldTextureBindGroup,
            extensionTextureBindGroup,
            extensionTexturesLayout,
            depthTextureBindGroup,
            mapUniformsLayout,
            mapTexturesLayout,
            sceneUniformsLayout: sceneLayout,
            ownedTextures,
            textureArray,
            textureLayerCount: layerCount,
            textureIdIndexMap,
            loadedTextureIds,
        });
    }

    /** 66 floats matching the SceneUniforms layout in bindings.ts. */
    readonly sceneData: Float32Array;

    /** Selected per frame by `selectExtension`; map draws always read these fields. */
    opaquePipeline: GPURenderPipeline;
    alphaPipeline: GPURenderPipeline;
    /** group(1) for map draws: base or extended, chosen by `selectExtension`. */
    mapWorldTextureBindGroup: GPUBindGroup;
    /** A plugin's scene extension, see ./sceneExtension.ts. */
    readonly extension?: WebGPUSceneExtension;
    /** True while the extension's pipelines are selected; actor draws read this. */
    extensionActive = false;
    /** The world pass's MSAA sample count this frame (1 or 4), set by `selectExtension`. */
    sampleCount = 1;
    /** The extension's group(1) layout and bind group; extended actor pipelines use these. */
    readonly extensionTexturesLayout?: GPUBindGroupLayout;
    readonly extensionTextureBindGroup?: GPUBindGroup;
    /** Depth pipelines (opaque, alpha) and their group(1), when the extension has a depth shader. */
    readonly depthPipelines?: [GPURenderPipeline, GPURenderPipeline];
    readonly depthTextureBindGroup?: GPUBindGroup;
    readonly sceneBindGroup: GPUBindGroup;
    /** Base group(1) bind group, also used by the base actor pipelines. */
    readonly worldTextureBindGroup: GPUBindGroup;
    /** The exact group(0) layout `sceneBindGroup` was created with; reuse it in any pipeline
     *  layout that binds the scene bind group (WebGPU requires layout identity). */
    readonly sceneUniformsLayout: GPUBindGroupLayout;
    /** Layouts for the per-map group(2) uniform and group(3) textures. */
    readonly mapUniformsLayout: GPUBindGroupLayout;
    readonly mapTexturesLayout: GPUBindGroupLayout;
    /** Texture ids already present in the atlas (preloaded or streamed). */
    readonly loadedTextureIds: Set<number>;

    private readonly device: GPUDevice;
    private readonly sceneUniformBuffer: GPUBuffer;
    private readonly basePipelines: [GPURenderPipeline, GPURenderPipeline];
    private readonly extendedPipelines?: [GPURenderPipeline, GPURenderPipeline];
    private readonly ownedTextures: GPUTexture[];
    private readonly textureArray: GPUTexture;
    private readonly textureLayerCount: number;
    private readonly textureIdIndexMap: Map<number, number>;
    private destroyed = false;

    private constructor(parts: {
        device: GPUDevice;
        sceneData: Float32Array;
        sceneUniformBuffer: GPUBuffer;
        basePipelines: [GPURenderPipeline, GPURenderPipeline];
        extendedPipelines?: [GPURenderPipeline, GPURenderPipeline];
        depthPipelines?: [GPURenderPipeline, GPURenderPipeline];
        extension?: WebGPUSceneExtension;
        sceneBindGroup: GPUBindGroup;
        worldTextureBindGroup: GPUBindGroup;
        extensionTextureBindGroup?: GPUBindGroup;
        extensionTexturesLayout?: GPUBindGroupLayout;
        depthTextureBindGroup?: GPUBindGroup;
        mapUniformsLayout: GPUBindGroupLayout;
        mapTexturesLayout: GPUBindGroupLayout;
        sceneUniformsLayout: GPUBindGroupLayout;
        ownedTextures: GPUTexture[];
        textureArray: GPUTexture;
        textureLayerCount: number;
        textureIdIndexMap: Map<number, number>;
        loadedTextureIds: Set<number>;
    }) {
        this.device = parts.device;
        this.sceneData = parts.sceneData;
        this.sceneUniformBuffer = parts.sceneUniformBuffer;
        this.basePipelines = parts.basePipelines;
        this.extendedPipelines = parts.extendedPipelines;
        this.depthPipelines = parts.depthPipelines;
        [this.opaquePipeline, this.alphaPipeline] = parts.basePipelines;
        this.extension = parts.extension;
        this.sceneBindGroup = parts.sceneBindGroup;
        this.worldTextureBindGroup = parts.worldTextureBindGroup;
        this.mapWorldTextureBindGroup = parts.worldTextureBindGroup;
        this.extensionTextureBindGroup = parts.extensionTextureBindGroup;
        this.extensionTexturesLayout = parts.extensionTexturesLayout;
        this.depthTextureBindGroup = parts.depthTextureBindGroup;
        this.mapUniformsLayout = parts.mapUniformsLayout;
        this.mapTexturesLayout = parts.mapTexturesLayout;
        this.sceneUniformsLayout = parts.sceneUniformsLayout;
        this.ownedTextures = parts.ownedTextures;
        this.textureArray = parts.textureArray;
        this.textureLayerCount = parts.textureLayerCount;
        this.textureIdIndexMap = parts.textureIdIndexMap;
        this.loadedTextureIds = parts.loadedTextureIds;
    }

    /**
     * Port of updateTextureArray: upload per-map texture pixels the worker sent along with
     * SdMapData into their atlas layer, skipping ids already present.
     */
    uploadMapTextures(textures: Map<number, Int32Array>): void {
        if (this.destroyed || !textures || textures.size === 0) return;
        for (const [id, pixels] of textures) {
            if (this.loadedTextureIds.has(id)) continue;
            const layer = this.textureIdIndexMap.get(id) ?? 0;
            if (layer <= 0 || layer >= this.textureLayerCount) continue;
            this.device.queue.writeTexture(
                { texture: this.textureArray, origin: { x: 0, y: 0, z: layer } },
                new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
                { bytesPerRow: TEXTURE_SIZE * 4, rowsPerImage: TEXTURE_SIZE },
                { width: TEXTURE_SIZE, height: TEXTURE_SIZE, depthOrArrayLayers: 1 },
            );
            this.loadedTextureIds.add(id);
        }
    }

    flushSceneUniforms(): void {
        if (this.destroyed) return;
        this.device.queue.writeBuffer(this.sceneUniformBuffer, 0, this.sceneData);
    }

    /**
     * Picks the extended or base pipeline pair before a frame's map draws, multisampled when
     * the world pass is (see ./multisample.ts).
     */
    selectExtension(active: boolean, sampleCount: number = 1): void {
        const extended = active ? this.extendedPipelines : undefined;
        this.extensionActive = !!extended;
        this.sampleCount = sampleCount;
        const [opaque, alpha] = extended ?? this.basePipelines;
        this.opaquePipeline = withSampleCount(opaque, sampleCount);
        this.alphaPipeline = withSampleCount(alpha, sampleCount);
        this.mapWorldTextureBindGroup = extended
            ? this.extensionTextureBindGroup!
            : this.worldTextureBindGroup;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.sceneUniformBuffer.destroy();
        this.extension?.dispose();
        for (const texture of this.ownedTextures) {
            texture.destroy();
        }
        this.ownedTextures.length = 0;
    }
}
