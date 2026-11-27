import { ConfigManager } from "@runelite/client/config/ConfigManager";
import {
    checkMobile,
    hasCoarsePointer,
    isHandheldDevice,
    isIos,
} from "../../common/utils/DeviceUtil";
import { PerformanceConfig, PerformanceMode } from "./PerformanceConfig";

export type PerformanceTier = "low" | "medium" | "high";
export type PerformancePreset = "auto-mobile" | "low" | "medium" | "high";

export interface PerformanceFacts {
    /** Phones, tablets and iOS: handheld memory budgets apply. */
    handheld: boolean;
    ios: boolean;
    phone: boolean;
    coarsePointer: boolean;
    cores: number;
    /** False when the browser hides hardwareConcurrency; then only the probe decides. */
    coresKnown: boolean;
    /** navigator.deviceMemory, when the browser exposes it (often rounded or absent). */
    deviceMemoryGb?: number;
    /** Stable-enough key for caching the Auto probe result. */
    signature: string;
}

export interface PerformancePolicy {
    mode: PerformanceMode;
    preset: PerformancePreset;
    tier: PerformanceTier;
    auto: boolean;
    facts: PerformanceFacts;
    /** Effective WebGL scene scale (1 = native); the UI is unaffected. */
    sceneResolution: number;
    /** Cap applied to the selected/hardware draw distance. */
    drawDistanceCap: number;
    /** Cap applied to the full-detail radius. */
    lodThresholdCap: number;
    /** Effective cap; null means leave the GPU plugin/client cap alone, 0 means uncapped. */
    fpsLimit: number | null;
    /** Default offscreen scene MSAA samples when the GPU plugin has no explicit choice. */
    sceneMsaaSamples: number;
    workerCount: number;
    mapSquareCacheLimit: number;
    sceneChunkMaxSquares: number;
    sceneChunkMaxBytes: number;
    cacheFullDat2: boolean;
    cacheRestore: boolean;
    cachePrefetch: boolean;
    /** Build only squares within render distance + margin. */
    nearbyOnlyMaps: boolean;
    /** Apply one map square per frame instead of a 4 ms budget. */
    oneMapSquarePerFrame: boolean;
    /** 0 = redraw as often as the frame rate. */
    hudMaxHz: number;
    /** 0 = measure the overlay size every frame. */
    hudSizeCacheMs: number;
    unanimatedPlayerCount: number;
    maxPlayersPerMap: number;
    reducedOverlayWork: boolean;
    colorBanding: number;
    autoFogDepthFactor: number;
    /** An explicit user draw-distance choice bypasses the preset/profile cap. */
    explicitDrawDistance: number | null;
    /** An explicit user FPS choice (0 = uncapped), or null when the preset supplies it. */
    explicitFpsLimit: number | null;
}

const AUTO_KEY = "osrs.performance.autoTier";
const LOW_END_PLUGIN_KEY = "lowenddeviceplugin";

const handheldCaps = {
    workerCount: 1,
    mapSquareCacheLimit: 64,
    sceneChunkMaxSquares: 1,
    sceneChunkMaxBytes: 24 << 20,
};

function readNumber(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

export function getPerformanceFacts(): PerformanceFacts {
    const rawCores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
    const coresKnown = Number.isFinite(rawCores) && (rawCores as number) > 0;
    const cores = coresKnown ? Math.max(1, (rawCores as number) | 0) : 4;
    const memory = typeof navigator !== "undefined"
        ? readNumber((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
        : undefined;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    return {
        handheld: isHandheldDevice,
        ios: isIos,
        phone: checkMobile(),
        coarsePointer: hasCoarsePointer,
        cores,
        coresKnown,
        deviceMemoryGb: memory,
        signature: `v3:${isHandheldDevice ? "handheld" : "desktop"}:${isIos ? "ios" : "web"}:${coresKnown ? cores : "?"}:${memory ?? "?"}:${ua}`,
    };
}

/**
 * Auto for a handheld is today's mobile preset. On desktop, weak core counts are capped and
 * the remaining ambiguity is settled by the GPU probe (probeMs), never by the GPU name alone.
 */
export function resolveAutoTier(
    facts: PerformanceFacts,
    probeMs?: number,
): PerformanceTier {
    if (facts.handheld) return "low";
    if (facts.coresKnown && facts.cores <= 2) return "low";
    const lowMemory = facts.deviceMemoryGb !== undefined && facts.deviceMemoryGb <= 4;
    if (facts.coresKnown && facts.cores <= 4 && (facts.deviceMemoryGb === undefined || lowMemory)) {
        if (probeMs === undefined) return "medium";
        return probeMs > 8 ? "low" : "medium";
    }
    if (probeMs === undefined) {
        return (facts.coresKnown && facts.cores <= 4) || lowMemory ? "medium" : "high";
    }
    if (probeMs > 8) return "low";
    if (probeMs > 3) return "medium";
    return "high";
}

/** Default request for the offscreen scene: no GPU choice, debug off/on, preset samples. */
export function requestedMsaaSamples(
    gpuSamples: number | undefined,
    msaaEnabled: boolean,
    performanceSamples: number,
): number {
    if (gpuSamples !== undefined) return gpuSamples;
    if (!msaaEnabled) return 0;
    return performanceSamples > 0 ? performanceSamples : 4;
}

/** WebGPU has one MSAA level today: 4. Medium's preset default is no MSAA. */
export function webgpuSampleCount(
    gpuSamples: number | undefined,
    performanceSamples: number,
): number {
    if (gpuSamples !== undefined) return gpuSamples > 0 ? 4 : 1;
    return performanceSamples > 0 ? 4 : 1;
}

/** Drops the warm-up/first measured batch and returns the median of the rest. */
export function summarizeProbeSamples(samples: readonly number[]): number {
    if (samples.length === 0) return 0;
    const measured = samples.length > 1 ? samples.slice(1) : samples;
    const sorted = [...measured].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * A fixed 512x512 fill/draw workload. The result is milliseconds per batch on the actual GL
 * stack; a browser that hides the GPU name still answers this. Returns undefined when no
 * WebGL2 context can be created (tests, edit mode, a blocked context).
 */
export function runPerformanceProbe(): number | undefined {
    if (typeof document === "undefined") return undefined;
    try {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 512;
        const gl = canvas.getContext("webgl2", {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
        });
        if (!gl) return undefined;
        const compile = (type: number, source: string) => {
            const shader = gl.createShader(type);
            if (!shader) throw new Error("shader");
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("compile");
            return shader;
        };
        const program = gl.createProgram();
        if (!program) return undefined;
        gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es
            layout(location=0) in vec2 p;
            void main(){ gl_Position = vec4(p, 0.0, 1.0); }`));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
            precision mediump float;
            out vec4 c;
            void main(){
                vec2 p = gl_FragCoord.xy / 512.0;
                vec3 v = vec3(p, 0.5);
                for (int i = 0; i < 48; i++) { v = fract(v * 1.234 + vec3(0.1, 0.2, 0.3)); }
                c = vec4(v, 1.0);
            }`));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.viewport(0, 0, 512, 512);
        const fence = () => {
            gl.finish();
            // finish() can return before the compositor's GPU work drains on some Chromium
            // builds; a one-pixel readback is a real fence.
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        };
        const drawBatch = (count: number) => {
            for (let i = 0; i < count; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        // First-draw startup (shader/pipeline warm-up, driver caches) is not representative.
        drawBatch(2);
        fence();
        const samples: number[] = [];
        for (let round = 0; round < 4; round++) {
            const start = performance.now();
            drawBatch(4);
            fence();
            samples.push((performance.now() - start) / 4);
        }
        const msPerBatch = summarizeProbeSamples(samples);
        console.info("[performance] Auto GPU probe", { samples, msPerBatch, tier: resolveAutoTier(getPerformanceFacts(), msPerBatch) });
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        return msPerBatch;
    } catch {
        return undefined;
    }
}

interface AutoProbeCache {
    signature: string;
    tier: PerformanceTier;
    probeMs?: number;
}

function readAutoCache(): AutoProbeCache | undefined {
    try {
        const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(AUTO_KEY);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as AutoProbeCache;
        return typeof parsed?.signature === "string" && ["low", "medium", "high"].includes(parsed.tier)
            ? parsed
            : undefined;
    } catch {
        return undefined;
    }
}

function writeAutoCache(cache: AutoProbeCache): void {
    try {
        if (typeof localStorage !== "undefined") localStorage.setItem(AUTO_KEY, JSON.stringify(cache));
    } catch {}
}

function clearAutoCache(): void {
    try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(AUTO_KEY);
    } catch {}
}

export function clearAutoProbeCache(): void {
    clearAutoCache();
}

function resolveAutoTierCached(facts: PerformanceFacts): { tier: PerformanceTier; probeMs?: number } {
    const cached = readAutoCache();
    if (cached?.signature === facts.signature) return { tier: cached.tier, probeMs: cached.probeMs };
    const probeMs = runPerformanceProbe();
    const tier = resolveAutoTier(facts, probeMs);
    writeAutoCache({ signature: facts.signature, tier, probeMs });
    return { tier, probeMs };
}

function presetValues(preset: PerformancePreset, facts: PerformanceFacts) {
    const cores = facts.cores;
    const twoCoreSafe = Math.max(1, Math.min(2, cores - 1));
    const desktopHighWorkers = Math.max(2, Math.min(4, cores - 1));
    switch (preset) {
        case "auto-mobile":
            return {
                // Main's mobile default: Low-end Device was enabled by default on phones/tablets
                // and iPhones, so Auto must keep 0.5 / 12 tiles / LOD 6, not the opt-out profile.
                sceneResolution: 0.5,
                drawDistanceCap: 12,
                lodThresholdCap: 6,
                fpsLimit: 30,
                sceneMsaaSamples: 0,
                workerCount: 1,
                mapSquareCacheLimit: 64,
                sceneChunkMaxSquares: 1,
                sceneChunkMaxBytes: 24 << 20,
                cacheFullDat2: false,
                cacheRestore: false,
                cachePrefetch: false,
                nearbyOnlyMaps: true,
                oneMapSquarePerFrame: true,
                hudMaxHz: 25,
                hudSizeCacheMs: 500,
                unanimatedPlayerCount: 25,
                maxPlayersPerMap: 32,
                reducedOverlayWork: true,
                colorBanding: 255,
                autoFogDepthFactor: 0.7,
            };
        case "low":
            return {
                sceneResolution: 0.5,
                drawDistanceCap: 12,
                lodThresholdCap: 6,
                fpsLimit: 30,
                sceneMsaaSamples: 0,
                workerCount: 1,
                mapSquareCacheLimit: 64,
                sceneChunkMaxSquares: 1,
                sceneChunkMaxBytes: 24 << 20,
                cacheFullDat2: false,
                cacheRestore: false,
                cachePrefetch: false,
                nearbyOnlyMaps: true,
                oneMapSquarePerFrame: true,
                hudMaxHz: 25,
                hudSizeCacheMs: 500,
                unanimatedPlayerCount: 25,
                maxPlayersPerMap: 32,
                reducedOverlayWork: true,
                colorBanding: 55,
                autoFogDepthFactor: 0.7,
            };
        case "medium":
            return {
                sceneResolution: 1,
                drawDistanceCap: 20,
                lodThresholdCap: 20,
                fpsLimit: 60,
                sceneMsaaSamples: 0,
                workerCount: twoCoreSafe,
                mapSquareCacheLimit: 128,
                sceneChunkMaxSquares: 2,
                sceneChunkMaxBytes: 64 << 20,
                cacheFullDat2: false,
                cacheRestore: true,
                cachePrefetch: true,
                nearbyOnlyMaps: false,
                oneMapSquarePerFrame: false,
                hudMaxHz: 0,
                hudSizeCacheMs: 0,
                unanimatedPlayerCount: 100,
                maxPlayersPerMap: 64,
                reducedOverlayWork: false,
                colorBanding: 255,
                autoFogDepthFactor: 0.85,
            };
        case "high":
        default:
            return {
                sceneResolution: 1,
                drawDistanceCap: 160,
                lodThresholdCap: 160,
                fpsLimit: 240,
                sceneMsaaSamples: 4,
                workerCount: desktopHighWorkers,
                mapSquareCacheLimit: 256,
                sceneChunkMaxSquares: 4,
                sceneChunkMaxBytes: 128 << 20,
                cacheFullDat2: true,
                cacheRestore: true,
                cachePrefetch: true,
                nearbyOnlyMaps: false,
                oneMapSquarePerFrame: false,
                hudMaxHz: 0,
                hudSizeCacheMs: 0,
                unanimatedPlayerCount: 200,
                maxPlayersPerMap: Number.POSITIVE_INFINITY,
                reducedOverlayWork: false,
                colorBanding: 255,
                autoFogDepthFactor: 0.85,
            };
    }
}

function buildPolicy(
    mode: PerformanceMode,
    facts: PerformanceFacts,
    overrides: { sceneResolution: number; drawDistance: number; fpsLimit: number },
    resolvedAutoTier?: PerformanceTier,
): PerformancePolicy {
    const auto = mode === PerformanceMode.AUTO;
    const tier: PerformanceTier = auto
        ? facts.handheld ? "low" : (resolvedAutoTier ?? resolveAutoTier(facts))
        : (mode as PerformanceTier);
    const preset: PerformancePreset = auto && facts.handheld ? "auto-mobile" : tier;
    const base = presetValues(preset, facts);

    const explicitDrawDistance = overrides.drawDistance > 0 ? overrides.drawDistance : null;
    const explicitSceneResolution =
        overrides.sceneResolution >= 50 && overrides.sceneResolution <= 100
            ? overrides.sceneResolution / 100
            : null;
    const explicitFps = overrides.fpsLimit >= 0 ? overrides.fpsLimit : null;

    const handheld = facts.handheld;
    const workerCount = handheld
        ? Math.min(base.workerCount, handheldCaps.workerCount)
        : base.workerCount;
    const mapSquareCacheLimit = handheld
        ? Math.min(base.mapSquareCacheLimit, handheldCaps.mapSquareCacheLimit)
        : base.mapSquareCacheLimit;
    const sceneChunkMaxSquares = handheld
        ? Math.min(base.sceneChunkMaxSquares, handheldCaps.sceneChunkMaxSquares)
        : base.sceneChunkMaxSquares;
    const sceneChunkMaxBytes = handheld
        ? Math.min(base.sceneChunkMaxBytes, handheldCaps.sceneChunkMaxBytes)
        : base.sceneChunkMaxBytes;

    return {
        mode,
        preset,
        tier,
        auto,
        facts,
        sceneResolution: explicitSceneResolution ?? base.sceneResolution,
        drawDistanceCap: explicitDrawDistance ?? base.drawDistanceCap,
        lodThresholdCap: base.lodThresholdCap,
        fpsLimit: explicitFps ?? base.fpsLimit,
        sceneMsaaSamples: base.sceneMsaaSamples,
        workerCount,
        mapSquareCacheLimit,
        sceneChunkMaxSquares,
        sceneChunkMaxBytes,
        cacheFullDat2: handheld ? false : base.cacheFullDat2,
        cacheRestore: handheld ? false : base.cacheRestore,
        cachePrefetch: handheld ? false : base.cachePrefetch,
        nearbyOnlyMaps: handheld ? true : base.nearbyOnlyMaps,
        oneMapSquarePerFrame: base.oneMapSquarePerFrame,
        hudMaxHz: base.hudMaxHz,
        hudSizeCacheMs: base.hudSizeCacheMs,
        unanimatedPlayerCount: base.unanimatedPlayerCount,
        maxPlayersPerMap: base.maxPlayersPerMap,
        reducedOverlayWork: base.reducedOverlayWork,
        colorBanding: base.colorBanding,
        autoFogDepthFactor: base.autoFogDepthFactor,
        explicitDrawDistance,
        explicitFpsLimit: explicitFps,
    };
}

let currentPolicy: PerformancePolicy | undefined;
let currentConfigManager: ConfigManager | undefined;
const listeners = new Set<(policy: PerformancePolicy) => void>();

function readConfig(configManager: ConfigManager) {
    const config = configManager.getConfig(PerformanceConfig);
    return {
        mode: config.mode() as PerformanceMode,
        sceneResolution: config.sceneResolution(),
        drawDistance: config.drawDistance(),
        fpsLimit: config.fpsLimit(),
    };
}

function migrateLowEndPlugin(configManager: ConfigManager, facts: PerformanceFacts): PerformanceMode {
    const savedMode = configManager.getConfiguration(PerformanceConfig.group, "mode");
    if (savedMode !== undefined) return configManager.getConfig(PerformanceConfig).mode() as PerformanceMode;
    // Only an explicitly stored plugin choice migrates. A mobile default must stay Auto.
    const legacy = configManager.getConfiguration("runelite", LOW_END_PLUGIN_KEY);
    if (legacy === "true") {
        configManager.setConfigValue(PerformanceConfig, "mode", PerformanceMode.LOW);
        return PerformanceMode.LOW;
    }
    if (legacy === "false" && facts.handheld) {
        // A handheld user who explicitly turned the old low-end preset off keeps that opt-out:
        // the high preset still enforces every handheld worker/cache/canvas cap.
        configManager.setConfigValue(PerformanceConfig, "mode", PerformanceMode.HIGH);
        return PerformanceMode.HIGH;
    }
    return PerformanceMode.AUTO;
}

export function computePerformancePolicy(
    configManager: ConfigManager,
    options: { probe?: boolean; facts?: PerformanceFacts } = {},
): PerformancePolicy {
    const facts = options.facts ?? getPerformanceFacts();
    const overrides = readConfig(configManager);
    const mode = migrateLowEndPlugin(configManager, facts);
    let resolvedAutoTier: PerformanceTier | undefined;
    if (mode === PerformanceMode.AUTO && !facts.handheld) {
        if (options.probe === false) {
            resolvedAutoTier = resolveAutoTier(facts);
        } else {
            const auto = resolveAutoTierCached(facts);
            resolvedAutoTier = auto.tier;
        }
    }
    return buildPolicy(mode, facts, overrides, resolvedAutoTier);
}

export function initPerformancePolicy(configManager: ConfigManager): PerformancePolicy {
    if (currentPolicy && currentConfigManager === configManager) return currentPolicy;
    currentConfigManager = configManager;
    currentPolicy = computePerformancePolicy(configManager);
    for (const listener of listeners) listener(currentPolicy);
    return currentPolicy;
}

export function refreshPerformancePolicy(): PerformancePolicy {
    currentConfigManager ??= new ConfigManager();
    currentPolicy = computePerformancePolicy(currentConfigManager);
    for (const listener of listeners) listener(currentPolicy);
    return currentPolicy;
}

export function getPerformancePolicy(): PerformancePolicy {
    if (!currentPolicy) {
        // The worker count is chosen in the React tree before OsrsClient constructs RuneLite,
        // so the first read must already use the saved mode and the same Auto probe result.
        currentConfigManager ??= new ConfigManager();
        currentPolicy = computePerformancePolicy(currentConfigManager);
    }
    return currentPolicy;
}

export function getPerformanceMode(): PerformanceMode {
    return getPerformancePolicy().mode;
}

/** The subset a render worker needs; workers cannot read the saved config themselves. */
export interface WorkerPerformancePolicy {
    mapSquareCacheLimit: number;
    sceneChunkMaxSquares: number;
    sceneChunkMaxBytes: number;
}

export function getWorkerPerformancePolicy(): WorkerPerformancePolicy {
    const policy = getPerformancePolicy();
    return {
        mapSquareCacheLimit: policy.mapSquareCacheLimit,
        sceneChunkMaxSquares: policy.sceneChunkMaxSquares,
        sceneChunkMaxBytes: policy.sceneChunkMaxBytes,
    };
}

export function setPerformanceMode(mode: PerformanceMode): void {
    if (!currentConfigManager) return;
    const previous = readConfig(currentConfigManager).mode;
    if (previous === mode) return;
    // Switching back to Auto is the "re-detect" action: drop the cached probe result.
    if (mode === PerformanceMode.AUTO) clearAutoCache();
    currentConfigManager.setConfigValue(PerformanceConfig, "mode", mode);
    refreshPerformancePolicy();
}

export function subscribePerformancePolicy(listener: (policy: PerformancePolicy) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Test seam: drop module state so a fresh process-like scenario can initialize again. */
export function resetPerformancePolicyForTests(): void {
    currentPolicy = undefined;
    currentConfigManager = undefined;
    clearAutoCache();
    listeners.clear();
}

export function _setAutoCacheForTests(signature: string, tier: PerformanceTier, probeMs?: number): void {
    writeAutoCache({ signature, tier, probeMs });
}
