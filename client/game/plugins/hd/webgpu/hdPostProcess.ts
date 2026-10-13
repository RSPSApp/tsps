/**
 * 117 HD's WebGPU HDR post chain, run from HdWebGPU.afterScene once the world pass has rendered
 * the scene into the rgba16float target:
 *
 *   world (linear HDR, unclamped) -> SSAO (half-res, blurred) -> bloom mip chain -> depth of
 *   field (when the follow camera is zoomed in) -> tonemap (AO, bloom, ACES, grade, gamma
 *   encode) -> optional FXAA -> canvas
 *
 * The screen/HUD pass runs after this and composites on top of the tonemapped canvas.
 */
import { mat4 } from "gl-matrix";

import { FxaaPass } from "../../../../render/webgpu/fxaa";
import type { WebGPUSceneFrameTargets } from "../../../../render/webgpu/sceneExtension";
import type { WebGPURenderer } from "../../../../render/webgpu/WebGPURenderer";
import type { HdOptions } from "../HdConfig";
import { HdBloomPass } from "./hd-bloom";
import { HdDepthOfFieldPass } from "./hd-dof";
import { HdSsaoPass } from "./hd-ssao";
import { HdTonemapPass } from "./hd-tonemap";

/** Focus distance (tiles) until the follow camera has measured itself. */
const DOF_FALLBACK_FOCUS_TILES = 12;
/** Follow-zoom multiplier at or above which DOF is fully off (the default camera distance). */
const DOF_ZOOM_OFF = 1.0;
/** Strength gain per unit of zoom-in: px of blur radius per tile of defocus. */
const DOF_STRENGTH_PER_ZOOM = 3.0;
/** Cap: past this the 12px gather radius already dominates. */
const DOF_MAX_STRENGTH = 0.9;

export class HdPostProcess {
    private readonly ssao: HdSsaoPass;
    private readonly bloom: HdBloomPass;
    private readonly dof: HdDepthOfFieldPass;
    private readonly tonemap: HdTonemapPass;
    private fxaa?: FxaaPass;
    private readonly inverseProjection = mat4.create() as Float32Array;
    private disposed = false;

    constructor(private readonly device: GPUDevice, private readonly canvasFormat: GPUTextureFormat) {
        this.ssao = new HdSsaoPass(device);
        this.bloom = new HdBloomPass(device);
        this.dof = new HdDepthOfFieldPass(device);
        this.tonemap = new HdTonemapPass(device, canvasFormat);
    }

    /** Records the whole chain on the frame's encoder and leaves the result on the canvas. */
    encode(renderer: WebGPURenderer, encoder: GPUCommandEncoder, frame: WebGPUSceneFrameTargets,
        options: HdOptions): void {
        if (this.disposed) return;
        const width = frame.colorTexture.width;
        const height = frame.colorTexture.height;
        this.ssao.ensure(width, height, options.depthAwareAo);
        this.bloom.ensure(width, height);
        this.dof.ensure(width, height);

        // Depth is non-reverse [0,1] NDC z; the GL-style inverse projection turns it into view space.
        mat4.invert(this.inverseProjection, renderer.osrsClient.camera.projectionMatrix);
        // A pass that is off records nothing; the tonemap falls back to no AO / no bloom.
        const aoView = options.ambientOcclusion
            ? this.ssao.encode(encoder, frame.depthView, this.inverseProjection) : undefined;
        const bloomView = options.bloom ? this.bloom.encode(encoder, frame.colorView) : undefined;
        // Strength ramps in only once the wheel zoomed the follow camera closer than its default
        // distance multiplier: 0 at DOF_ZOOM_OFF, capped at DOF_MAX_STRENGTH by zoom ~0.7.
        const strength = options.depthOfField && renderer.osrsClient.followPlayerCamera
            ? Math.max(
                  0,
                  Math.min(
                      DOF_MAX_STRENGTH,
                      (DOF_ZOOM_OFF - renderer.followCamZoom) * DOF_STRENGTH_PER_ZOOM,
                  ),
              )
            : 0;
        const focusDistance =
            renderer.followCamDistance > 0.5 ? renderer.followCamDistance : DOF_FALLBACK_FOCUS_TILES;
        const sceneView = this.dof.encode(
            encoder,
            frame.colorView,
            frame.depthView,
            this.inverseProjection,
            focusDistance,
            strength,
        );
        const fxaa = options.antiAliasing ? (this.fxaa ??= new FxaaPass(this.device, this.canvasFormat)) : undefined;
        this.tonemap.encode(encoder, fxaa?.ensure(width, height) ?? frame.canvasView,
            sceneView, bloomView, aoView, width, height, options.hdr);
        fxaa?.encode(encoder, frame.canvasView);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.ssao.dispose();
        this.bloom.dispose();
        this.dof.dispose();
        this.tonemap.dispose();
        this.fxaa?.dispose();
    }
}
