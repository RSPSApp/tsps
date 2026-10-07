import PicoGL, { DrawCall } from "picogl";

import type { WebGLOsrsRenderer } from "../WebGLOsrsRenderer";
import { GfxCache } from "./GfxCache";

export type SpotAnimGpuRecord = {
    vao: any;
    vb: any;
    ib: any;
    drawCall: DrawCall;
    indexCount: number;
};

type SpotAnimGpuEntry = {
    vao: any;
    vb: any;
    ib: any;
    indexCount: number;
    drawCalls: Map<string, DrawCall>;
};

const SPOT_ANIM_GPU_CACHE_VERSION = 2;

export class SpotAnimGpuCache {
    private entries: Map<string, SpotAnimGpuEntry> = new Map();

    constructor(
        private renderer: WebGLOsrsRenderer,
        private cache: GfxCache,
        private limit: number = 192,
    ) {}

    getOrCreate(
        spotId: number,
        frameIdx: number,
        transparent: boolean,
        programKey: string,
        program: any,
        frameCycle: number = 0,
    ): SpotAnimGpuRecord | undefined {
        if (!program) return undefined;

        const cycleKey = frameCycle > 0 ? `~${frameCycle | 0}` : "";
        const frame = `${frameIdx | 0}${cycleKey}`;
        const pass = transparent ? 1 : 0;
        const key = `${spotId | 0}|${frame}|${pass}|${SPOT_ANIM_GPU_CACHE_VERSION}`;
        let entry = this.entries.get(key);
        if (entry) {
            this.entries.delete(key);
            this.entries.set(key, entry);
        } else {
            const geom = this.cache.ensureFrameGeometry(
                spotId | 0,
                frameIdx | 0,
                transparent,
                frameCycle | 0,
            );
            if (!geom || (geom.indices.length | 0) <= 0) return undefined;

            const app = (this.renderer as any).app;
            const vb = app.createInterleavedBuffer(12, geom.vertices);
            const ib = app.createIndexBuffer(PicoGL.UNSIGNED_INT as number, geom.indices);
            const vao = app
                .createVertexArray()
                .vertexAttributeBuffer(0, vb, {
                    type: PicoGL.UNSIGNED_INT,
                    size: 3,
                    stride: 12,
                    integer: true as any,
                })
                .indexBuffer(ib);

            entry = {
                vao,
                vb,
                ib,
                indexCount: geom.indices.length | 0,
                drawCalls: new Map(),
            };
            this.entries.set(key, entry);
            this.evictIfNeeded();
        }

        let drawCall = entry.drawCalls.get(programKey);
        if (!drawCall) {
            drawCall = (this.renderer as any).app.createDrawCall(program, entry.vao);
            if (!drawCall) return undefined;
            entry.drawCalls.set(programKey, drawCall);
        }

        return {
            vao: entry.vao,
            vb: entry.vb,
            ib: entry.ib,
            drawCall,
            indexCount: entry.indexCount,
        };
    }

    clear(): void {
        for (const entry of this.entries.values()) {
            try {
                entry.vao?.delete?.();
                entry.vb?.delete?.();
                entry.ib?.delete?.();
                for (const drawCall of entry.drawCalls.values()) {
                    (drawCall as any)?.delete?.();
                }
            } catch {}
        }
        this.entries.clear();
    }

    private evictIfNeeded(): void {
        if (this.entries.size <= this.limit) return;
        const lruKey = this.entries.keys().next().value;
        if (lruKey === undefined) return;

        const lru = this.entries.get(lruKey);
        if (lru) {
            try {
                lru.vao?.delete?.();
                lru.vb?.delete?.();
                lru.ib?.delete?.();
                for (const drawCall of lru.drawCalls.values()) {
                    (drawCall as any)?.delete?.();
                }
            } catch {}
        }
        this.entries.delete(lruKey);
    }
}
