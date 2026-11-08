import { PicoGL, type Texture } from "picogl";
import { FxSlot, SHADER_FX_UNIFORM_FLOATS } from "../../game/plugins/shaderfx/ShaderFxState";
import type { WebGLOsrsRendererHost } from "./hostInterface";

/** The Shader Effects plugin's vec4 uniforms (u_fx0 to u_fx9 in frame-shaderfx.frag.glsl). */
const UNIFORM_VEC4S = SHADER_FX_UNIFORM_FLOATS / 4;

/** Allocates the uniform block the shader's frame is built in. */
export function createShaderFxUniforms(): Float32Array {
    return new Float32Array(SHADER_FX_UNIFORM_FLOATS);
}

/**
 * Asks the plugin for this frame's effects and loads them into the draw call's uniforms. False,
 * with nothing recorded, when the plugin is off, idle, or its program failed to link.
 */
export function prepareShaderFx(host: WebGLOsrsRendererHost): boolean {
    const call = host.frameShaderFxDrawCall;
    const runtime = host.osrsClient.clientPlugins.shaderFx();
    if (!call || !runtime) return false;
    const data = host.shaderFxUniforms;
    if (!runtime.fill(data)) return false;
    const width = host.app.width;
    const height = host.app.height;
    data[FxSlot.SCREEN] = width;
    data[FxSlot.SCREEN + 1] = height;
    data[FxSlot.SCREEN + 2] = 1 / width;
    data[FxSlot.SCREEN + 3] = 1 / height;
    data[FxSlot.TIME + 1] = width / height;
    for (let i = 0; i < UNIFORM_VEC4S; i++) call.uniform(`u_fx${i}`, data.subarray(i * 4, i * 4 + 4));
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
