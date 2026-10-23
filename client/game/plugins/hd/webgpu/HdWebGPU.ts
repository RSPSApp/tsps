/**
 * 117 HD's WebGPU scene extension (render/webgpu/sceneExtension.ts): the HD uniform buffer,
 * material lookup, texture array and shadow map appended to group(1), the per-frame uniform and
 * light update, and the shadow pass. Port of ../HdPlugin.ts and ../HdMaterials.ts.
 *
 * HD images upload with their mip chains before their lookup entries become ready. A small
 * separate array preserves the existing 512px detail assets; layer zero stays white.
 */
import { mat4, vec3 } from "gl-matrix";
import { Frustum } from "../../../Frustum";

import {
    GPU_BUFFER_USAGE,
    GPU_SHADER_STAGE,
    GPU_TEXTURE_USAGE,
} from "../../../../render/webgpu/bindings";
import { resolveWebGPURenderDistance } from "../../../../render/webgpu/frameConfig";
import { resolveFogRange } from "../../../../render/RenderDistancePolicy";
import { HD_AUTO_FOG_DEPTH_FACTOR } from "../../../../render/render/constants";
import {
    SCENE_EXTENSION_FIRST_BINDING,
    type WebGPUSceneExtension,
    type WebGPUSceneExtensionContext,
    type WebGPUSceneFrameTargets,
} from "../../../../render/webgpu/sceneExtension";
import type { WebGPURenderer } from "../../../../render/webgpu/WebGPURenderer";
import { environmentAt } from "../../../../render/render/environment";
import { collectHdLights } from "../HdLights";
import { HD_GROUND_MATERIALS, HD_MATERIALS, HD_DETAIL_TEXTURES, type HdMaterial } from "../HdMaterialData";
import { HD_LOOKUP_WIDTH, HD_TEXTURE_FILES, HD_TEXTURE_SIZE, HD_DETAIL_TEXTURE_SIZE } from "../HdMaterials";
import { HdClutterLayer } from "./hd-clutter";
import { HD_SCENE_SHADERS } from "./hdSceneShaders";
import type { HdOptions } from "../HdConfig";
import { HdMist } from "../HdMist";
import { HdPostProcess } from "./hdPostProcess";

/** group(1) bindings, matching HD_BINDINGS_WGSL. */
const HD_BINDINGS = {
    uniforms: SCENE_EXTENSION_FIRST_BINDING,
    materials: SCENE_EXTENSION_FIRST_BINDING + 1,
    textures: SCENE_EXTENSION_FIRST_BINDING + 2,
    shadowMap: SCENE_EXTENSION_FIRST_BINDING + 3,
    detailTextures: SCENE_EXTENSION_FIRST_BINDING + 4,
    sampler: SCENE_EXTENSION_FIRST_BINDING + 5,
} as const;

/** Matches HdUniforms in hd-lighting.wgsl.ts, including mist and quality flags. */
const HD_UNIFORM_FLOATS = 200;
const HD_UNIFORM_BYTES = HD_UNIFORM_FLOATS * 4;
const LIGHT_LIMIT = 16;
const LIGHT_INTERVAL_MS = 1000 / 30;
const SHADOW_INTERVAL_MS = 1000 / 15;
const SHADOW_MAP_SIZE = 2048;
const SHADER_STAGES = GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT;

// Field offsets in the uniform buffer, matching HdUniforms in hd-lighting.wgsl.ts.
const resolveHdFogRange = (renderDistance: number) => resolveFogRange({ renderDistance, autoFogDepth: true,
    autoFogDepthFactor: HD_AUTO_FOG_DEPTH_FACTOR, manualFogDepth: 0, hd: true });

const OFF_INVERSE_VIEW = 0;
const OFF_SHADOW_MATRIX = 16;
const OFF_LIGHT_DIRECTION = 32;
const OFF_AMBIENT = 36;
const OFF_DIRECTIONAL = 40;
const OFF_FOG_COLOR = 44;
const OFF_FOG = 48;
const OFF_GROUND_FOG = 52;
const OFF_GRADING = 56;
const OFF_SPECULAR = 60;
const OFF_SHADOW_STRENGTH = 61;
const OFF_LIGHT_COUNT = 62; // i32 bit pattern
const OFF_ENABLED = 63;
const OFF_LIGHT_POSITIONS = 64;
const OFF_LIGHT_COLORS = 128;
const OFF_MIST = 192;
const OFF_QUALITY = 196;

/** Port of HdMaterials: the 2-row RGBA32F lookup plus the HD texture array. */
class HdMaterialsGpu {
    readonly lookup: GPUTexture;
    readonly textures: GPUTexture;
    readonly detailTextures: GPUTexture;
    private readonly device: GPUDevice;
    private readonly lookupData = new Float32Array(HD_LOOKUP_WIDTH * 2 * 4);
    private readonly loaded = new Set<string>();
    private started = false;
    private dirty = true;
    private mapping = "";
    private filtered = false;
    private disposed = false;

    constructor(device: GPUDevice) {
        this.device = device;
        this.lookup = device.createTexture({
            label: "webgpu hd material lookup",
            size: [HD_LOOKUP_WIDTH, 2],
            format: "rgba32float",
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        this.textures = device.createTexture({
            label: "webgpu hd textures",
            size: [HD_TEXTURE_SIZE, HD_TEXTURE_SIZE, HD_TEXTURE_FILES.length + 1],
            format: "rgba8unorm",
            mipLevelCount: Math.log2(HD_TEXTURE_SIZE) + 1,
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        this.detailTextures = device.createTexture({
            label: "webgpu hd detail textures",
            size: [HD_DETAIL_TEXTURE_SIZE, HD_DETAIL_TEXTURE_SIZE, HD_DETAIL_TEXTURES.length + 1],
            format: "rgba8unorm",
            mipLevelCount: Math.log2(HD_DETAIL_TEXTURE_SIZE) + 1,
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        for (const texture of [this.textures, this.detailTextures]) {
            for (let mipLevel = 0; mipLevel < texture.mipLevelCount; mipLevel++) {
                const size = texture.width >> mipLevel;
                const white = new Uint8Array(size * size * 4).fill(255);
                device.queue.writeTexture({ texture, mipLevel }, white,
                    { bytesPerRow: size * 4, rowsPerImage: size }, [size, size, 1]);
            }
        }
    }

    update(layers: Map<number, number>, filtered: boolean): void {
        if (!this.started) {
            this.started = true;
            HD_TEXTURE_FILES.forEach((file, index) => {
                const image = new Image();
                image.onload = () => {
                    if (this.disposed) return;
                    const canvas = document.createElement("canvas");
                    canvas.width = canvas.height = HD_TEXTURE_SIZE;
                    const context = canvas.getContext("2d");
                    if (!context) return;
                    try {
                        const upload = (texture: GPUTexture, layer: number) => {
                            for (let mipLevel = 0; mipLevel < texture.mipLevelCount; mipLevel++) {
                                const size = texture.width >> mipLevel;
                                // Each level is resampled from the source, once at load time.
                                canvas.width = canvas.height = size;
                                context.imageSmoothingQuality = "high";
                                context.drawImage(image, 0, 0, size, size);
                                const pixels = context.getImageData(0, 0, size, size).data;
                                this.device.queue.writeTexture({ texture, mipLevel, origin: [0, 0, layer] }, pixels,
                                    { bytesPerRow: size * 4, rowsPerImage: size }, [size, size, 1]);
                            }
                        };
                        upload(this.textures, index + 1);
                        const detail = HD_DETAIL_TEXTURES.indexOf(file);
                        if (detail >= 0) upload(this.detailTextures, detail + 1);
                        this.loaded.add(file);
                        this.dirty = true;
                    } catch (error) {
                        console.warn("117 HD: texture unavailable", error);
                    }
                };
                image.onerror = () => { console.warn("117 HD: texture unavailable", file); };
                image.src = file;
            });
        }
        const mapping = HD_MATERIALS.map(m => layers.get(m.id) ?? 0).join(",");
        if (!this.dirty && this.mapping === mapping && this.filtered === filtered) return;
        this.lookupData.fill(0);
        for (let layer = 0; layer < HD_LOOKUP_WIDTH; layer++) {
            this.lookupData[(HD_LOOKUP_WIDTH + layer) * 4 + 3] = 1;
        }
        const readyLayer = (file: string | null) => {
            if (!file || !this.loaded.has(file)) return 0;
            const detail = HD_DETAIL_TEXTURES.indexOf(file);
            return filtered && detail >= 0 ? -(detail + 1) : HD_TEXTURE_FILES.indexOf(file) + 1;
        };
        const write = (material: HdMaterial, layer: number) => {
            this.lookupData.set(material.params, layer * 4);
            // metadata.y is a bitfield, matching HdMaterials.ts: bit 0 unlit, bit 1 worldUv.
            this.lookupData.set(
                [
                    readyLayer(material.file),
                    (material.unlit ? 1 : 0) | (material.worldUv ? 2 : 0),
                    readyLayer(material.normal),
                    material.brightness,
                ],
                (HD_LOOKUP_WIDTH + layer) * 4,
            );
        };
        for (const material of HD_MATERIALS) {
            const layer = layers.get(material.id);
            // Layer zero is shared by untextured faces and capacity fallbacks.
            if (layer === undefined || layer <= 0 || layer >= 1024) continue;
            write(material, layer);
        }
        for (const material of HD_GROUND_MATERIALS) write(material, 1024 + material.id);
        this.device.queue.writeTexture(
            { texture: this.lookup },
            this.lookupData,
            { bytesPerRow: HD_LOOKUP_WIDTH * 4 * 4, rowsPerImage: 2 },
            { width: HD_LOOKUP_WIDTH, height: 2, depthOrArrayLayers: 1 },
        );
        this.mapping = mapping;
        this.filtered = filtered;
        this.dirty = false;
    }

    dispose(): void {
        this.disposed = true;
        this.lookup.destroy();
        this.textures.destroy();
        this.detailTextures.destroy();
    }
}

class HdWebGPUExtension implements WebGPUSceneExtension {
    readonly shaders = HD_SCENE_SHADERS;
    readonly depthFormat: GPUTextureFormat = "depth32float";
    /** The world pass renders linear HDR here; afterScene tonemaps it to the canvas. */
    readonly sceneColorFormat: GPUTextureFormat = "rgba16float";

    readonly layoutEntries: GPUBindGroupLayoutEntry[];
    readonly bindGroupEntries: GPUBindGroupEntry[];

    private readonly device: GPUDevice;
    private readonly textureIdIndexMap: Map<number, number>;
    private readonly materials: HdMaterialsGpu;
    private readonly uniformBuffer: GPUBuffer;
    private readonly uniforms = new Float32Array(HD_UNIFORM_FLOATS);
    private readonly mist = new HdMist();
    private readonly uniformInts = new DataView(this.uniforms.buffer);
    private readonly lightPositions = new Float32Array(LIGHT_LIMIT * 4);
    private readonly lightColors = new Float32Array(LIGHT_LIMIT * 4);
    private readonly inverseView = mat4.create();
    private readonly shadowMatrix = mat4.create();
    /** 2048x2048 depth32float shadow map, the depth attachment of the shadow pass. */
    private readonly shadowTexture: GPUTexture;
    private readonly shadowView: GPUTextureView;
    private readonly worldShadowTexture: GPUTexture;
    private readonly worldShadowView: GPUTextureView;
    private readonly shadowFrustum = new Frustum();
    private lastShadow?: { time: number; x: number; z: number; plane: number;
        environment: unknown; distance: number; roof: number };
    /** Binding 9 is a 1x1 placeholder while drawing the shadow map into its own texture. */
    readonly depthBindGroupEntries: GPUBindGroupEntry[];
    private readonly shadowPlaceholder: GPUTexture;
    private lightCount = 0;
    private lastLights?: { time: number; x: number; z: number; plane: number };
    private post?: HdPostProcess;
    private clutter?: HdClutterLayer;
    private destroyed = false;

    constructor(
        private readonly isEnabled: () => boolean,
        private readonly options: () => HdOptions,
        { device, textureIdIndexMap }: WebGPUSceneExtensionContext,
    ) {
        this.device = device;
        this.textureIdIndexMap = textureIdIndexMap;
        this.materials = new HdMaterialsGpu(device);

        this.uniformBuffer = device.createBuffer({
            label: "webgpu hd uniforms",
            size: HD_UNIFORM_BYTES,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });
        this.shadowTexture = device.createTexture({
            label: "webgpu hd shadow map",
            size: [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE],
            format: "depth32float",
            usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        this.shadowView = this.shadowTexture.createView();
        this.worldShadowTexture = device.createTexture({
            label: "webgpu hd cached world shadow", size: [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE],
            format: "depth32float", usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_SRC,
        });
        this.worldShadowView = this.worldShadowTexture.createView();
        this.shadowPlaceholder = device.createTexture({
            label: "webgpu hd shadow placeholder",
            size: [1, 1],
            format: "depth32float",
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });

        const sampler = device.createSampler({
            label: "webgpu hd anisotropic sampler",
            addressModeU: "repeat", addressModeV: "repeat",
            minFilter: "linear", magFilter: "linear", mipmapFilter: "linear", maxAnisotropy: 8,
        });
        this.layoutEntries = [
            {
                binding: HD_BINDINGS.uniforms,
                visibility: SHADER_STAGES,
                buffer: { type: "uniform", minBindingSize: HD_UNIFORM_BYTES },
            },
            {
                binding: HD_BINDINGS.materials,
                visibility: SHADER_STAGES,
                texture: { sampleType: "unfilterable-float", viewDimension: "2d" },
            },
            {
                binding: HD_BINDINGS.textures,
                visibility: SHADER_STAGES,
                texture: { sampleType: "float", viewDimension: "2d-array" },
            },
            {
                binding: HD_BINDINGS.shadowMap,
                visibility: SHADER_STAGES,
                texture: { sampleType: "depth", viewDimension: "2d" },
            },
            { binding: HD_BINDINGS.detailTextures, visibility: SHADER_STAGES,
                texture: { sampleType: "float", viewDimension: "2d-array" } },
            { binding: HD_BINDINGS.sampler, visibility: SHADER_STAGES, sampler: { type: "filtering" } },
        ];
        this.bindGroupEntries = [
            {
                binding: HD_BINDINGS.uniforms,
                resource: { buffer: this.uniformBuffer, offset: 0, size: HD_UNIFORM_BYTES },
            },
            { binding: HD_BINDINGS.materials, resource: this.materials.lookup.createView() },
            {
                binding: HD_BINDINGS.textures,
                resource: this.materials.textures.createView({ dimension: "2d-array" }),
            },
            { binding: HD_BINDINGS.shadowMap, resource: this.shadowView },
            { binding: HD_BINDINGS.detailTextures, resource: this.materials.detailTextures.createView({ dimension: "2d-array" }) },
            { binding: HD_BINDINGS.sampler, resource: sampler },
        ];
        this.depthBindGroupEntries = [
            ...this.bindGroupEntries.filter(entry => entry.binding !== HD_BINDINGS.shadowMap),
            { binding: HD_BINDINGS.shadowMap, resource: this.shadowPlaceholder.createView() },
        ];
    }

    isActive(): boolean {
        return this.isEnabled();
    }

    /**
     * Cache world depth at 15 Hz, then replace actor depth every frame, as WebGL does.
     */
    beforeScene(renderer: WebGPURenderer, encoder: GPUCommandEncoder): void {
        if (this.destroyed) return;
        if (this.update(renderer)) {
            const worldPass = encoder.beginRenderPass({
                colorAttachments: [],
                depthStencilAttachment: { view: this.worldShadowView,
                    depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
            });
            renderer.drawWorldDepth(worldPass, this.shadowFrustum);
            worldPass.end();
        }
        encoder.copyTextureToTexture({ texture: this.worldShadowTexture },
            { texture: this.shadowTexture }, [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]);
        const pass = encoder.beginRenderPass({
            colorAttachments: [],
            depthStencilAttachment: {
                view: this.shadowView,
                depthLoadOp: "load",
                depthStoreOp: "store",
            },
        });
        renderer.drawActorDepth(pass);
        pass.end();
    }

    /**
     * HdPlugin's grade, finally done on the assembled frame: SSAO, bloom and the ACES tonemap
     * (hd-tonemap) replace the display-referred per-surface grade that clipped highlights.
     */
    afterScene(renderer: WebGPURenderer, encoder: GPUCommandEncoder, frame: WebGPUSceneFrameTargets): void {
        if (this.destroyed) return;
        const post = (this.post ??= new HdPostProcess(this.device, renderer.format));
        // Ground clutter draws into the HDR scene before it is tonemapped. Only in game: the
        // world pass has nothing to stand the blades on at the login screen.
        this.clutter ??= new HdClutterLayer(this.device);
        const options = this.options();
        if (options.grass && renderer.osrsClient.isLoggedIn()) {
            try {
                const u = this.uniforms;
                this.clutter.setLight(
                    u.subarray(OFF_AMBIENT, OFF_AMBIENT + 3),
                    u.subarray(OFF_DIRECTIONAL, OFF_DIRECTIONAL + 3),
                    u.subarray(OFF_LIGHT_DIRECTION, OFF_LIGHT_DIRECTION + 3),
                    u.subarray(OFF_FOG_COLOR, OFF_FOG_COLOR + 3),
                    u.subarray(OFF_FOG, OFF_FOG + 3),
                    u.subarray(OFF_MIST, OFF_MIST + 4),
                );
                if (this.clutter.update(renderer)) this.clutter.draw(encoder, frame);
            } catch (error) {
                console.warn("117 HD: ground clutter unavailable", error);
            }
        }
        // The GPU plugin's anti-aliasing replaces HD's own: FXAA here, MSAA in the world pass.
        const gpu = renderer.osrsClient.clientPlugins.gpuSettings();
        post.encode(renderer, encoder, frame, gpu ? { ...options, antiAliasing: gpu.fxaa } : options);
    }

    /** Port of HdPlugin.beforeSceneRender's uniform + shadow matrix block. */
    private update(renderer: WebGPURenderer): boolean {
        if (this.destroyed) return false;
        const options = this.options();
        this.materials.update(this.textureIdIndexMap, options.textureFiltering);
        this.uniforms[OFF_QUALITY] = options.textureFiltering ? 1 : 0;

        const x = renderer.playerPosUni[0];
        const z = renderer.playerPosUni[1];
        const environment = environmentAt(renderer, x, z);
        mat4.invert(this.inverseView, renderer.osrsClient.camera.viewMatrix);

        const pitch = environment.lightPitch * Math.PI / 180;
        const yaw = environment.lightYaw * Math.PI / 180;
        const direction = vec3.fromValues(
            Math.cos(pitch) * Math.sin(yaw),
            Math.sin(pitch),
            Math.cos(pitch) * Math.cos(yaw),
        );

        const fogEnd = Math.max(1, resolveWebGPURenderDistance(renderer));
        const plane = renderer.getPlayerRawPlane();
        const now = performance.now();
        const roof = renderer.getRoofPlaneLimit();
        const previous = this.lastShadow;
        const refreshShadow = !previous || now - previous.time >= SHADOW_INTERVAL_MS ||
            Math.abs(x - previous.x) >= 2 || Math.abs(z - previous.z) >= 2 ||
            plane !== previous.plane || environment !== previous.environment ||
            fogEnd !== previous.distance || roof !== previous.roof;

        this.uniforms.set(this.mist.uniform(x, z, (mx, mz) => renderer.sampleHeightAtExactPlane(mx, mz, plane),
            now, options.surfaceFog), OFF_MIST);
        if (refreshShadow) {
            const target = vec3.fromValues(x, renderer.sampleHeightAtExactPlane(x, z, plane), z);
            const eye = vec3.scaleAndAdd(vec3.create(), target, direction, 100);
            const view = mat4.lookAt(mat4.create(), eye, target, Math.abs(direction[1]) > 0.99 ? [0, 0, 1] : [0, -1, 0]);
            const extent = Math.min(48, fogEnd);
            mat4.multiply(this.shadowMatrix, mat4.ortho(mat4.create(), -extent, extent, -extent, extent, 1, 220), view);
            for (const component of [12, 13]) {
                this.shadowMatrix[component] =
                    Math.round(this.shadowMatrix[component] * SHADOW_MAP_SIZE / 2) * 2 / SHADOW_MAP_SIZE;
            }
            this.shadowFrustum.setPlanes(this.shadowMatrix);
            this.lastShadow = { time: now, x, z, plane, environment, distance: fogEnd, roof };
        }

        this.uniforms.set(this.inverseView, OFF_INVERSE_VIEW);
        this.uniforms.set(this.shadowMatrix, OFF_SHADOW_MATRIX);
        this.uniforms[OFF_LIGHT_DIRECTION] = direction[0];
        this.uniforms[OFF_LIGHT_DIRECTION + 1] = direction[1];
        this.uniforms[OFF_LIGHT_DIRECTION + 2] = direction[2];
        this.uniforms[OFF_AMBIENT] = environment.ambientColor[0] * environment.ambient * 0.74;
        this.uniforms[OFF_AMBIENT + 1] = environment.ambientColor[1] * environment.ambient * 0.74;
        this.uniforms[OFF_AMBIENT + 2] = environment.ambientColor[2] * environment.ambient * 0.74;
        this.uniforms[OFF_DIRECTIONAL] = environment.directionalColor[0] * environment.lightStrength * 0.9;
        this.uniforms[OFF_DIRECTIONAL + 1] = environment.directionalColor[1] * environment.lightStrength * 0.9;
        this.uniforms[OFF_DIRECTIONAL + 2] = environment.directionalColor[2] * environment.lightStrength * 0.9;
        // The extended pipeline is linear HDR, so the display-referred fog colour is linearised
        // here; hdSceneShaders' fog blend re-encodes nothing.
        this.uniforms[OFF_FOG_COLOR] = Math.pow(Math.max(environment.fogColor[0], 0), 2.2);
        this.uniforms[OFF_FOG_COLOR + 1] = Math.pow(Math.max(environment.fogColor[1], 0), 2.2);
        this.uniforms[OFF_FOG_COLOR + 2] = Math.pow(Math.max(environment.fogColor[2], 0), 2.2);
        this.uniforms[OFF_FOG_COLOR + 3] = 1;
        // Same haze as the WebGL path (HdPlugin): one range for both backends.
        const fog = resolveHdFogRange(fogEnd);
        this.uniforms[OFF_FOG] = fog.fogDepth;
        this.uniforms[OFF_FOG + 1] = fog.fogEnd;
        this.uniforms[OFF_FOG + 2] = Math.max(0.6, Math.min(1.2, 1.2 - environment.fogDepth * environment.fogScale * 0.08));
        this.uniforms[OFF_GROUND_FOG] = environment.groundFogStart / 128;
        this.uniforms[OFF_GROUND_FOG + 1] = environment.groundFogEnd / 128;
        this.uniforms[OFF_GROUND_FOG + 2] = environment.groundFogOpacity;
        // Saturation/contrast/exposure moved to the tonemap pass (hd-tonemap); only the rim
        // term is still applied per-surface in hdShade.
        this.uniforms[OFF_GRADING] = 1;
        this.uniforms[OFF_GRADING + 1] = 1;
        this.uniforms[OFF_GRADING + 2] = 1;
        this.uniforms[OFF_GRADING + 3] = 0;
        this.uniforms[OFF_SPECULAR] = 1;
        this.uniforms[OFF_SHADOW_STRENGTH] = 0.5;
        this.uniforms[OFF_ENABLED] = 1;

        const lastLights = this.lastLights;
        if (!lastLights || now - lastLights.time >= LIGHT_INTERVAL_MS ||
            Math.abs(x - lastLights.x) >= 1 || Math.abs(z - lastLights.z) >= 1 || plane !== lastLights.plane) {
            this.lightCount = collectHdLights(renderer, this.lightPositions, this.lightColors, Date.now());
            this.lastLights = { time: now, x, z, plane };
        }
        this.uniformInts.setInt32(OFF_LIGHT_COUNT * 4, this.lightCount, true);
        this.uniforms.set(this.lightPositions, OFF_LIGHT_POSITIONS);
        this.uniforms.set(this.lightColors, OFF_LIGHT_COLORS);

        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
        return refreshShadow;
    }

    dispose(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.post?.dispose();
        this.post = undefined;
        this.clutter?.dispose();
        this.clutter = undefined;
        this.uniformBuffer.destroy();
        this.shadowTexture.destroy();
        this.worldShadowTexture.destroy();
        this.shadowPlaceholder.destroy();
        this.materials.dispose();
    }
}

export function createHdWebGPUExtension(
    isEnabled: () => boolean,
    options: () => HdOptions,
    context: WebGPUSceneExtensionContext,
): WebGPUSceneExtension {
    return new HdWebGPUExtension(isEnabled, options, context);
}
