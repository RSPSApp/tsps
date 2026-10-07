import { mat4, vec3 } from "gl-matrix";
import PicoGL, { type DrawCall, type Framebuffer, type Program, type Texture } from "picogl";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import type { WebGLOsrsRenderer } from "../../../render/WebGLOsrsRenderer";
import type { ProgramSource } from "../../../render/shaders/ShaderUtil";
import { environmentAt } from "../../../render/render/environment";
import { createHdProgram } from "./HdShader";
import { collectHdLights } from "./HdLights";
import lighting from "./hd-lighting.glsl";
import { HdMaterials } from "./HdMaterials";

// PicoGL exposes these methods at runtime but omits them from its declarations.
type SceneProgram = Program & { bind(): void; uniform(name: string, value: unknown): void };
const SHADOW_MAP_SIZE = 2048;
const LIGHT_LIMIT = 16;
const SHADOW_INTERVAL_MS = 1000 / 15;
const LIGHT_INTERVAL_MS = 1000 / 30;

export class HdPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "117 HD",
        description: "HD lighting, environments and shadows.",
        tags: ["render"],
        enabledByDefault: false,
        configKey: "hdplugin",
    };

    private readonly renderers = new Map<WebGLOsrsRenderer, {
        programs: SceneProgram[];
        placeholder: Texture;
        materials: HdMaterials;
        shadow?: Texture;
        framebuffer?: Framebuffer;
        worldShadow?: Texture;
        worldFramebuffer?: Framebuffer;
        shadowPass: boolean;
        lightPositions: Float32Array;
        lightColors: Float32Array;
        lightCount: number;
        lastLights?: { time: number; x: number; z: number; plane: number };
        lastShadow?: { time: number; x: number; z: number; plane: number; environment: unknown; distance: number; roof: number | undefined };
    }>();
    private readonly shadowMatrix = mat4.create();
    private readonly inverseView = mat4.create();

    transformSceneProgram(source: ProgramSource): ProgramSource {
        return createHdProgram(source, lighting);
    }

    sceneProgramsReady(renderer: WebGLOsrsRenderer, programs: Program[]): void {
        this.disposeRenderer(renderer);
        // A complete sampler is required even when its shader branch is disabled.
        const placeholder = renderer.app.createTexture2D(new Uint8Array([255, 255, 255, 255]), 1, 1, {
            minFilter: PicoGL.NEAREST, magFilter: PicoGL.NEAREST,
        });
        this.renderers.set(renderer, {
            programs: programs as SceneProgram[], placeholder, materials: new HdMaterials(renderer.app), shadowPass: false,
            lightPositions: new Float32Array(LIGHT_LIMIT * 4), lightColors: new Float32Array(LIGHT_LIMIT * 4), lightCount: 0,
        });
    }

    configureSceneDrawCall(renderer: WebGLOsrsRenderer, drawCall: DrawCall): void {
        const state = this.renderers.get(renderer);
        if (!state || !state.programs.includes(drawCall.currentProgram as SceneProgram)) return;
        drawCall.texture("u_hdShadowMap", state.shadowPass ? state.placeholder : state.shadow ?? state.placeholder);
        drawCall.texture("u_hdMaterials", state.materials.lookup);
        drawCall.texture("u_hdTextures", state.materials.textures);
    }

    beforeSceneRender(renderer: WebGLOsrsRenderer, drawActors: () => void): void {
        const state = this.renderers.get(renderer);
        if (!state) return;
        const uniforms = new Map<string, unknown>();
        const set = (name: string, value: unknown) => uniforms.set(name, value);
        const flush = () => {
            for (const program of state.programs) {
                program.bind();
                for (const [name, value] of uniforms) program.uniform(name, value);
            }
            uniforms.clear();
        };
        set("u_hdEnabled", this.isEnabled());
        set("u_hdShadowPass", false);
        if (!this.isEnabled()) {
            state.lastShadow = undefined;
            state.lastLights = undefined;
            flush();
            return;
        }
        state.materials.update(renderer.textureIdIndexMap);
        mat4.invert(this.inverseView, renderer.osrsClient.camera.viewMatrix);
        set("u_hdInverseView", this.inverseView);

        const [x, z] = renderer.playerPosUni;
        const environment = environmentAt(renderer, x, z);
        const pitch = environment.lightPitch * Math.PI / 180;
        const yaw = environment.lightYaw * Math.PI / 180;
        const direction = vec3.fromValues(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
        set("u_hdLightDirection", direction);
        set("u_hdAmbient", environment.ambientColor.map(c => c * environment.ambient * 0.74));
        set("u_hdDirectional", environment.directionalColor.map(c => c * environment.lightStrength * 0.9));
        set("u_hdFogColor", environment.fogColor);
        const fogEnd = Math.max(1, renderer.getFrameRenderDistanceTiles());
        set("u_hdFog", [environment.fogDepth, environment.fogScale, fogEnd]);
        set("u_hdGroundFog", [environment.groundFogStart / 128, environment.groundFogEnd / 128, environment.groundFogOpacity]);
        set("u_hdGrading", [1.12, 1, 0.6, 0]);
        set("u_hdSpecular", 1);
        const now = performance.now();
        const plane = renderer.getPlayerRawPlane();
        const lastLights = state.lastLights;
        if (!lastLights || now - lastLights.time >= LIGHT_INTERVAL_MS ||
            Math.abs(x - lastLights.x) >= 1 || Math.abs(z - lastLights.z) >= 1 || plane !== lastLights.plane) {
            state.lightCount = collectHdLights(renderer, state.lightPositions, state.lightColors, Date.now());
            state.lastLights = { time: now, x, z, plane };
        }
        set("u_hdLightCount", state.lightCount);
        set("u_hdLightPositions[0]", state.lightPositions);
        set("u_hdLightColors[0]", state.lightColors);
        const previous = state.lastShadow;
        // Cache the expensive world pass, but never cache moving actor shadows.
        // Keep the previous projection with its world depth between updates.
        const reuseWorldShadow = previous && now - previous.time < SHADOW_INTERVAL_MS &&
            Math.abs(x - previous.x) < 2 && Math.abs(z - previous.z) < 2 &&
            plane === previous.plane && environment === previous.environment &&
            fogEnd === previous.distance && renderer.roofPlaneLimit === previous.roof;

        if (!state.shadow) {
            state.shadow = renderer.app.createTexture2D(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, {
                internalFormat: PicoGL.DEPTH_COMPONENT24, type: PicoGL.UNSIGNED_INT,
                minFilter: PicoGL.NEAREST, magFilter: PicoGL.NEAREST,
                wrapS: PicoGL.CLAMP_TO_EDGE, wrapT: PicoGL.CLAMP_TO_EDGE,
            });
            state.framebuffer = renderer.app.createFramebuffer().depthTarget(state.shadow);
            state.worldShadow = renderer.app.createTexture2D(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, {
                internalFormat: PicoGL.DEPTH_COMPONENT24, type: PicoGL.UNSIGNED_INT,
                minFilter: PicoGL.NEAREST, magFilter: PicoGL.NEAREST,
                wrapS: PicoGL.CLAMP_TO_EDGE, wrapT: PicoGL.CLAMP_TO_EDGE,
            });
            state.worldFramebuffer = renderer.app.createFramebuffer().depthTarget(state.worldShadow);
        }
        if (!reuseWorldShadow) {
            const target = vec3.fromValues(x, renderer.sampleHeightAtExactPlane(x, z, plane), z);
            const eye = vec3.scaleAndAdd(vec3.create(), target, direction, 100);
            const view = mat4.lookAt(mat4.create(), eye, target, Math.abs(direction[1]) > 0.99 ? [0, 0, 1] : [0, -1, 0]);
            const extent = Math.min(48, fogEnd);
            mat4.multiply(this.shadowMatrix, mat4.ortho(mat4.create(), -extent, extent, -extent, extent, 1, 220), view);
            // Snap the light projection to texels to keep stationary surfaces stable.
            for (const component of [12, 13]) {
                this.shadowMatrix[component] = Math.round(this.shadowMatrix[component] * SHADOW_MAP_SIZE / 2) * 2 / SHADOW_MAP_SIZE;
            }
            set("u_hdShadowMatrix", this.shadowMatrix);
            set("u_hdShadowStrength", 0.5);
        }

        const viewport = renderer.gl.getParameter(PicoGL.VIEWPORT) as Int32Array;
        const scissor = renderer.gl.isEnabled(PicoGL.SCISSOR_TEST);
        const blend = renderer.gl.isEnabled(PicoGL.BLEND);
        const framebuffer = renderer.shouldUseDirectTextureScenePass() ? renderer.textureFramebuffer! : renderer.framebuffer!;
        state.shadowPass = true;
        set("u_hdShadowPass", true);
        try {
            flush();
            renderer.app.viewport(0, 0, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE).disable(PicoGL.SCISSOR_TEST).disable(PicoGL.BLEND).depthMask(true);
            if (!reuseWorldShadow) {
                renderer.app.drawFramebuffer(state.worldFramebuffer!);
                renderer.gl.drawBuffers([PicoGL.NONE]);
                renderer.gl.clear(PicoGL.DEPTH_BUFFER_BIT);
                renderer.renderOpaquePass();
                renderer.renderTransparentPass();
                state.lastShadow = { time: now, x, z, plane, environment, distance: fogEnd, roof: renderer.roofPlaneLimit };
            }
            // Reset actor depth every frame so an old pose cannot shadow the
            // current pose. A native depth blit keeps world geometry cached.
            renderer.app.readFramebuffer(state.worldFramebuffer!).drawFramebuffer(state.framebuffer!);
            renderer.gl.drawBuffers([PicoGL.NONE]);
            renderer.app.blitFramebuffer(PicoGL.DEPTH_BUFFER_BIT, { filter: PicoGL.NEAREST });
            renderer.app.defaultReadFramebuffer();
            drawActors();
        } finally {
            state.shadowPass = false;
            set("u_hdShadowPass", false);
            flush();
            renderer.app.defaultReadFramebuffer();
            renderer.app.drawFramebuffer(framebuffer);
            renderer.app.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
            if (scissor) renderer.app.enable(PicoGL.SCISSOR_TEST);
            if (blend) renderer.app.enable(PicoGL.BLEND);
        }
    }

    disposeRenderer(renderer: WebGLOsrsRenderer): void {
        const state = this.renderers.get(renderer);
        state?.framebuffer?.delete();
        state?.shadow?.delete();
        state?.worldFramebuffer?.delete();
        state?.worldShadow?.delete();
        state?.placeholder.delete();
        state?.materials.dispose();
        this.renderers.delete(renderer);
    }
}
