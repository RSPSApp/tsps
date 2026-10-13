import { isWebGL2Supported, isWebGPUSupported } from "../common/utils/DeviceUtil";
import { WebGLOsrsRenderer } from "../render/WebGLOsrsRenderer";
import { WebGPURenderer } from "../render/webgpu/WebGPURenderer";
import { GameRenderer } from "./GameRenderer";
import { OsrsClient } from "./OsrsClient";

export type OsrsRendererType = "webgl" | "webgpu";
export const WEBGL: OsrsRendererType = "webgl";
export const WEBGPU: OsrsRendererType = "webgpu";

// Prefer WebGPU when an adapter is available; otherwise use WebGL.
export const PREFER_WEBGPU_DEFAULT = true;

export function getRendererName(type: OsrsRendererType): string {
    switch (type) {
        case WEBGL:
            return "WebGL";
        case WEBGPU:
            return "WebGPU";
        default:
            throw new Error("Unknown renderer type");
    }
}

export function createRenderer(type: OsrsRendererType, osrsClient: OsrsClient): GameRenderer {
    switch (type) {
        case WEBGL:
            return new WebGLOsrsRenderer(osrsClient);
        case WEBGPU:
            return new WebGPURenderer(osrsClient);
        default:
            throw new Error("Unknown renderer type");
    }
}

export function getAvailableRenderers(): OsrsRendererType[] {
    const renderers: OsrsRendererType[] = [];

    if (WebGLOsrsRenderer.isSupported()) {
        renderers.push(WEBGL);
    }
    if (WebGPURenderer.isSupported()) {
        renderers.push(WEBGPU);
    }

    return renderers;
}

export function getRequestedRendererType(): OsrsRendererType | undefined {
    if (typeof window === "undefined") return undefined;
    try {
        const requested = new URLSearchParams(window.location.search).get("renderer");
        if (requested === WEBGL || requested === WEBGPU) return requested;
    } catch {}
    return undefined;
}

/**
 * Backend for this session. WebGPU must produce an adapter before it is picked; any failure
 * (no `navigator.gpu`, no adapter, request rejected) falls back to WebGL.
 */
export async function pickRendererType(): Promise<OsrsRendererType | undefined> {
    const requested = getRequestedRendererType();
    const webglReady = WebGLOsrsRenderer.isSupported();
    // Only ask for a WebGPU adapter when the result can matter: WebGPU was requested,
    // WebGPU is the preferred default, or there is no WebGL to fall back to.
    const shouldProbe = requested === WEBGPU || PREFER_WEBGPU_DEFAULT || !webglReady;
    let webgpuReady = false;
    if (shouldProbe && isWebGPUSupported && WebGPURenderer.isSupported()) {
        try {
            webgpuReady = (await WebGPURenderer.probeAdapter()) !== undefined;
        } catch {
            webgpuReady = false;
        }
    }

    if (requested === WEBGPU && !webgpuReady) {
        console.warn("[renderer] WebGPU requested but unavailable; falling back to WebGL");
    }
    if (requested === WEBGL && webglReady) return WEBGL;
    if (requested === WEBGPU && webgpuReady) return WEBGPU;
    if (PREFER_WEBGPU_DEFAULT && webgpuReady) return WEBGPU;
    if (webglReady) return WEBGL;
    if (webgpuReady) return WEBGPU;
    return undefined;
}
