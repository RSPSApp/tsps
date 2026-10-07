import { PicoGL } from "picogl";

import { profiler } from "../../render/PerformanceProfiler";
import type { SceneViewportRect } from "../../render/render/viewportRect";
import { Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";

// PERF: Per-overlay timing for debugging
const overlayTimings: Map<string, number> = new Map();
let lastLogTime = 0;
const LOG_INTERVAL_MS = 1000;

export class OverlayManager {
    private overlays: Overlay[] = [];
    private unclipped = new Set<Overlay>();
    private app?: OverlayInitArgs["app"];
    private readonly clip = [0, 0, 0, 0];

    add(overlay: Overlay, clipToViewport = true): this {
        this.overlays.push(overlay);
        if (!clipToViewport) this.unclipped.add(overlay);
        return this;
    }

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        for (const ov of this.overlays) ov.init(args);
    }

    update(args: OverlayUpdateArgs): void {
        if (!profiler.enabled) {
            for (const ov of this.overlays) ov.update(args);
            return;
        }

        const start = performance.now();
        for (const ov of this.overlays) ov.update(args);
        profiler.recordGauge("overlayUpdateMs", performance.now() - start);
    }

    draw(phase: RenderPhase, viewport?: SceneViewportRect): void {
        if (!profiler.enabled) {
            for (const ov of this.overlays) this.drawOverlay(ov, phase, viewport);
            return;
        }

        // Profile each overlay
        for (const ov of this.overlays) {
            const name = ov.constructor.name;
            const start = performance.now();
            this.drawOverlay(ov, phase, viewport);
            const elapsed = performance.now() - start;
            overlayTimings.set(name, (overlayTimings.get(name) ?? 0) + elapsed);
        }

        // Log breakdown every second
        const now = performance.now();
        if (now - lastLogTime > LOG_INTERVAL_MS) {
            lastLogTime = now;
            if (profiler.verbose && overlayTimings.size > 0) {
                const sorted = [...overlayTimings.entries()]
                    .filter(([_, ms]) => ms > 0.1)
                    .sort((a, b) => b[1] - a[1]);
                const total = sorted.reduce((sum, [_, ms]) => sum + ms, 0);
                const breakdown = sorted
                    .map(
                        ([name, ms]) =>
                            `${name}: ${ms.toFixed(1)}ms (${((ms / total) * 100).toFixed(0)}%)`,
                    )
                    .join(" | ");
                console.log(`[PERF] Overlay breakdown (${total.toFixed(1)}ms total): ${breakdown}`);
            }
            overlayTimings.clear();
        }
    }

    private drawOverlay(overlay: Overlay, phase: RenderPhase, viewport?: SceneViewportRect): void {
        const app = this.app;
        if (!app || !viewport || this.unclipped.has(overlay)) {
            overlay.draw(phase);
            return;
        }
        const clip = this.clip;
        clip[0] = viewport.x;
        clip[1] = app.height - viewport.y - viewport.height;
        clip[2] = viewport.width;
        clip[3] = viewport.height;
        app.enable(PicoGL.SCISSOR_TEST);
        app.scissor(clip[0], clip[1], clip[2], clip[3]);
        try {
            // Overlays get the clip rather than reading it back: getParameter(SCISSOR_BOX)
            // stalls on the GPU each call.
            overlay.draw(phase, clip);
        } finally {
            app.disable(PicoGL.SCISSOR_TEST);
        }
    }

    dispose(): void {
        for (const ov of this.overlays) ov.dispose();
        this.overlays = [];
        this.unclipped.clear();
    }
}
