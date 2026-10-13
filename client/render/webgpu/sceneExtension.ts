/**
 * Plugin extension point for the WebGPU scene: the WebGPU counterpart of the WebGL
 * transformSceneProgram / sceneProgramsReady / beforeSceneRender / configureSceneDrawCall hooks.
 *
 * A plugin returns one from `ClientPlugin.createWebGPUSceneExtension`. The core then compiles a
 * second set of world and actor pipelines with the extension's WGSL in the slots below and its
 * resources appended to group(1), and draws with that set on frames where `isActive()` is true.
 * Chrome caps maxBindGroups at 4, so extensions extend group(1) instead of adding a group; their
 * bindings start at SCENE_EXTENSION_FIRST_BINDING.
 *
 * With a `depth` shader the core also builds depth-only pipelines. They place geometry exactly
 * like the scene entries and call the extension's `sceneDepthPosition(viewPos)` for the clip
 * position; `beforeScene` records its own passes through `drawWorldDepth` and `drawActorDepth`.
 */
import type { WebGPURenderer } from "./WebGPURenderer";

export const SCENE_EXTENSION_FIRST_BINDING = 6;
/** First free @location in the world VertexOutput / actor ActorVertexOutput structs. */
export const WORLD_EXTENSION_FIRST_LOCATION = 8;
export const ACTOR_EXTENSION_FIRST_LOCATION = 5;

/**
 * WGSL for one shader family. Vertex slot scope: world `vertex`, `modelInfo`, `localPos`,
 * `viewPos`, `out`; actor `vertex`, `localPos`, `viewPos`, `out`, `actorRotation`,
 * `actorHslOverride`, `extraWord` (the 4th u32 of 16-byte actor vertices, else 0) and
 * `poseLinear` (the GPU pose's rotation, identity when posed on the CPU). Fragment slot scope:
 * `input`, `front_facing`, `textureColor`, `alpha`, `material`, `paletteColor`, `surface`, `fog`,
 * `fogColor` (and, in the world shader, `isFloorWater`).
 */
export interface WgslSceneSlots {
    /** Module-scope WGSL: bindings, structs, helpers. */
    declarations: string;
    /** Extra output struct fields, from the family's *_EXTENSION_FIRST_LOCATION. */
    varyings: string;
    /** Statements at the end of the vertex entry. */
    vertex: string;
    /** Statements that fill `textureColor` (initially white), including the cache fallback. */
    textureSample: string;
    /** WGSL bool: whether the cache's animated texture frames apply. */
    animateTexture: string;
    /** Statements after `paletteColor` is computed. */
    palette: string;
    /** Statements before fog is applied; may change `surface`, `fog` and `fogColor`. */
    shade: string;
}

export interface WebGPUSceneShaders {
    world: WgslSceneSlots & {
        /** WGSL bool: whether floor water takes the water shading. */
        floorWater: string;
    };
    actor: WgslSceneSlots;
    /**
     * Depth-pipeline WGSL, added to both families. Must define
     * `fn sceneDepthPosition(viewPos: vec4<f32>) -> vec4<f32>` (a WebGPU clip position) and
     * `@fragment fn fs_depth(input: DepthVertexOutput)`, which discards cutouts (`alpha` is the
     * alpha-pass variant).
     */
    depth?: (alpha: boolean) => string;
}

/**
 * Offscreen targets of an active extension frame. With `sceneColorFormat` set, the world pass
 * renders into `colorTexture` (e.g. rgba16float HDR, unclamped by the extended shaders) with
 * `depthTexture` attached; `afterScene` must then composite the frame into `canvasView`.
 */
export interface WebGPUSceneFrameTargets {
    colorTexture: GPUTexture;
    colorView: GPUTextureView;
    /** depth32float, sampleable by post passes (SSAO). */
    depthTexture: GPUTexture;
    depthView: GPUTextureView;
    /** The frame's swapchain view; write the composited image here exactly once. */
    canvasView: GPUTextureView;
}

export interface WebGPUSceneExtension {
    shaders: WebGPUSceneShaders;
    layoutEntries: GPUBindGroupLayoutEntry[];
    bindGroupEntries: GPUBindGroupEntry[];
    /** group(1) entries while drawing depth: a pass cannot sample its own depth attachment. */
    depthBindGroupEntries?: GPUBindGroupEntry[];
    depthFormat?: GPUTextureFormat;
    /**
     * When set, the world pass renders into a texture of this format and `afterScene` runs
     * afterwards to composite it to the canvas (e.g. "rgba16float" + HDR tonemapping). The
     * extension's extended pipelines are compiled against it.
     */
    sceneColorFormat?: GPUTextureFormat;
    /** Checked once per frame; the base pipelines draw while false. */
    isActive(): boolean;
    /** Runs on active, logged-in frames before the scene pass, in the frame's encoder. */
    beforeScene?(renderer: WebGPURenderer, encoder: GPUCommandEncoder): void;
    /**
     * Runs on active frames after the world pass ended and before the screen/HUD pass, in the
     * frame's encoder. With `sceneColorFormat` set, `frame` carries the HDR scene and depth.
     */
    afterScene?(renderer: WebGPURenderer, encoder: GPUCommandEncoder, frame: WebGPUSceneFrameTargets): void;
    dispose(): void;
}

export interface WebGPUSceneExtensionContext {
    device: GPUDevice;
    /** Cache texture id -> world atlas layer. */
    textureIdIndexMap: Map<number, number>;
}
