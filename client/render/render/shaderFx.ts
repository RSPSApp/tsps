import { PicoGL, type Texture } from "picogl";
import { FxSlot, SHADER_FX_UNIFORM_FLOATS } from "../../game/plugins/shaderfx/ShaderFxState";
import { FRAME_SHADERFX_PROGRAM } from "../shaders/Shaders";
import type { WebGLOsrsRendererHost } from "./hostInterface";

/** The Shader Effects plugin's vec4 uniforms (u_fx0 to u_fx12 in frame-shaderfx.frag.glsl). */
const UNIFORM_VEC4S = SHADER_FX_UNIFORM_FLOATS / 4;
const UNIFORM_NAMES: readonly string[] = Array.from({ length: UNIFORM_VEC4S }, (_, i) => `u_fx${i}`);

/** Allocates the uniform block the shader's frame is built in. */
export function createShaderFxUniforms(): Float32Array {
    return new Float32Array(SHADER_FX_UNIFORM_FLOATS);
}

/**
 * Compiles the effects program the first time the plugin is on, apart from the other frame
 * programs so a link failure only costs the effects. Frames skip the effects until it is ready.
 */
function loadShaderFxProgram(host: WebGLOsrsRendererHost): void {
    if (host.shaderFxProgramState) return;
    host.shaderFxProgramState = "loading";
    host.app
        .createPrograms(FRAME_SHADERFX_PROGRAM)
        .then(([program]) => {
            host.frameShaderFxProgram = program;
            host.frameShaderFxDrawCall = host.app.createDrawCall(program, host.quadArray);
            host.shaderFxProgramState = "ready";
        })
        .catch((e) => {
            console.warn("[WebGLOsrsRenderer] Shader Effects unavailable; continuing without them", e);
            host.shaderFxProgramState = "failed";
        });
}

/**
 * Asks the plugin for this frame's effects and loads them into the draw call's uniforms. False,
 * with nothing recorded, when the plugin is off, idle, or its program is not ready. With the
 * plugin off, the intermediate target is freed.
 */
export function prepareShaderFx(host: WebGLOsrsRendererHost): boolean {
    const runtime = host.osrsClient.clientPlugins.shaderFx();
    if (!runtime) {
        if (host.shaderFxFramebuffer) deleteShaderFxTarget(host);
        return false;
    }
    const call = host.frameShaderFxDrawCall;
    if (!call) {
        loadShaderFxProgram(host);
        return false;
    }
    const data = host.shaderFxUniforms;
    if (!runtime.fill(data)) return false;
    const width = host.app.width;
    const height = host.app.height;
    data[FxSlot.SCREEN] = width;
    data[FxSlot.SCREEN + 1] = height;
    data[FxSlot.SCREEN + 2] = 1 / width;
    data[FxSlot.SCREEN + 3] = 1 / height;
    data[FxSlot.TIME + 1] = width / height;
    // The same views every frame: the block is rewritten in place.
    const views = (host.shaderFxViews ??= UNIFORM_NAMES.map((_, i) => data.subarray(i * 4, i * 4 + 4)));
    for (let i = 0; i < UNIFORM_VEC4S; i++) call.uniform(UNIFORM_NAMES[i], views[i]);
    return true;
}

/** Draws the effects from `source` into whatever draw framebuffer is bound. */
export function drawShaderFx(host: WebGLOsrsRendererHost, source: Texture): void {
    const call = host.frameShaderFxDrawCall!;
    call.texture("u_frame", source);
    call.draw();
}

/**
 * Draws the effects from `source` into an intermediate target the size of the canvas, for FXAA
 * to read next, and returns that target's texture. The default framebuffer is bound again after.
 */
export function drawShaderFxToTarget(host: WebGLOsrsRendererHost, source: Texture): Texture {
    const width = host.app.width;
    const height = host.app.height;
    if (!host.shaderFxFramebuffer || host.shaderFxWidth !== width || host.shaderFxHeight !== height) {
        deleteShaderFxTarget(host);
        host.shaderFxColorTarget = host.app.createTexture2D(width, height, {
            minFilter: PicoGL.LINEAR,
            magFilter: PicoGL.LINEAR,
        });
        host.shaderFxFramebuffer = host.app.createFramebuffer().colorTarget(0, host.shaderFxColorTarget);
        host.shaderFxWidth = width;
        host.shaderFxHeight = height;
    }
    host.app.drawFramebuffer(host.shaderFxFramebuffer!);
    drawShaderFx(host, source);
    host.app.defaultDrawFramebuffer();
    return host.shaderFxColorTarget!;
}

export function deleteShaderFxTarget(host: WebGLOsrsRendererHost): void {
    host.shaderFxFramebuffer?.delete();
    host.shaderFxFramebuffer = undefined;
    host.shaderFxColorTarget?.delete();
    host.shaderFxColorTarget = undefined;
    host.shaderFxWidth = 0;
    host.shaderFxHeight = 0;
}
