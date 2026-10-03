import {
    DrawCall,
    App as PicoApp,
    PicoGL,
    Program,
    Texture,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { subscribeDisconnect, subscribeSystemUpdate } from "../../network/ServerConnection";
import { state } from "../../network/serverConnection/state";
import { Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";

export interface SystemUpdateOverlayOptions {
    /**
     * Screen-rect of the chatbox in main-canvas pixels (top-left origin). The
     * countdown text anchors just above its top-left corner; when undefined the
     * overlay falls back to a fixed bottom-left position.
     */
    getChatboxRect?: () => { x: number; y: number; width: number; height: number } | undefined;
}

/**
 * System update countdown overlay.
 * Renders a yellow "System update in: MM:SS" line above the chatbox while the
 * server has scheduled a shutdown (SYSTEM_UPDATE packet, opcode 220).
 *
 * The server pushes the remaining centiseconds once per tick. Each push implies
 * an absolute deadline; this overlay re-anchors a free-running local countdown
 * to it, so the digits advance at a steady 1/s between pushes and never snap
 * back up when the next push lands mid-second.
 */
export class SystemUpdateOverlay implements Overlay {
    private app!: PicoApp;
    private gl!: WebGL2RenderingContext;
    private program!: Program;
    private drawCall?: DrawCall;
    private vertexArray?: VertexArray;
    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;
    private texture?: Texture;

    // 2D canvas for the countdown text (transparent background)
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    private screenWidth: number = 765;
    private screenHeight: number = 503;

    // Deadline (performance.now-based) the countdown runs toward; 0 = hidden.
    // Each server push re-anchors it: deadline = pushTime + remainingCentis * 10.
    private deadlineMs: number = 0;
    private unsubscribeUpdate?: () => void;
    private unsubscribeDisconnect?: () => void;

    private readonly getChatboxRect?: () => {
        x: number;
        y: number;
        width: number;
        height: number;
    } | undefined;

    // Cached text for change detection
    private lastText: string = "";
    private textureNeedsUpdate: boolean = false;
    private textWidth: number = 0;
    private readonly textHeight: number = 20;

    constructor(options: SystemUpdateOverlayOptions = {}) {
        this.getChatboxRect = options.getChatboxRect;
        this.canvas = document.createElement("canvas");
        this.canvas.width = 200;
        this.canvas.height = this.textHeight;
        const ctx = this.canvas.getContext("2d", { alpha: true });
        if (!ctx) {
            throw new Error("[SystemUpdateOverlay] Failed to get 2D context");
        }
        this.ctx = ctx;

        // A push may have arrived before the overlay existed (fast reconnect).
        // `receivedAtMs` is on the Date.now() clock, so rebase via elapsed time
        // instead of using it as a performance.now() timestamp; skip entries too
        // stale to matter (the next push re-anchors within a server tick).
        const last = state.lastSystemUpdate;
        if (last && last.remainingCentis > 0) {
            const ageMs = Date.now() - last.receivedAtMs;
            if (ageMs >= 0 && ageMs < 5000) {
                this.deadlineMs =
                    performance.now() + last.remainingCentis * 10 - ageMs;
            }
        }

        this.unsubscribeUpdate = subscribeSystemUpdate(({ remainingCentis }) => {
            this.deadlineMs = performance.now() + remainingCentis * 10;
        });
        this.unsubscribeDisconnect = subscribeDisconnect(() => {
            this.deadlineMs = 0;
        });
    }

    /** Seconds left, counting down locally from the deadline the last push set. */
    private displayRemainingSeconds(nowMs: number): number {
        const remainingMs = this.deadlineMs - nowMs;
        if (remainingMs <= 0) return 0;
        return remainingMs / 1000;
    }

    private formatCountdown(totalSeconds: number): string {
        const clamped = Math.max(0, Math.floor(totalSeconds));
        const minutes = Math.floor(clamped / 60);
        const seconds = clamped % 60;
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        this.gl = args.app.gl as WebGL2RenderingContext;

        const vertSrc = `#version 300 es
            uniform vec4 uRect; // x, y, width, height in pixels
            uniform vec2 uScreen; // screen width, height
            in vec2 aPosition;
            in vec2 aUV;
            out vec2 vUV;
            void main() {
                vec2 pos = aPosition * uRect.zw + uRect.xy;
                vec2 ndc = (pos / uScreen) * 2.0 - 1.0;
                ndc.y = -ndc.y; // Flip Y for top-left origin
                gl_Position = vec4(ndc, 0.0, 1.0);
                vUV = aUV;
            }
        `;

        const fragSrc = `#version 300 es
            precision highp float;
            in vec2 vUV;
            out vec4 fragColor;
            uniform sampler2D uTexture;
            void main() {
                fragColor = texture(uTexture, vUV);
            }
        `;

        this.program = this.app.createProgram(vertSrc, fragSrc);

        const positions = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
        const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, positions);
        this.uvs = this.app.createVertexBuffer(PicoGL.FLOAT, 2, uvs);

        this.vertexArray = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.positions)
            .vertexAttributeBuffer(1, this.uvs);
    }

    update(args: OverlayUpdateArgs): void {
        this.screenWidth = args.resolution.width;
        this.screenHeight = args.resolution.height;

        const text =
            this.displayRemainingSeconds(args.time) > 0
                ? `System update in: ${this.formatCountdown(this.displayRemainingSeconds(args.time))}`
                : "";
        if (text !== this.lastText) {
            this.lastText = text;
            if (text) {
                this.renderTextToCanvas(text);
                this.textureNeedsUpdate = true;
                this.updateTextureImmediate();
            } else {
                this.textureNeedsUpdate = false;
            }
        }
    }

    private updateTextureImmediate(): void {
        if (!this.textureNeedsUpdate || !this.app) return;
        this.updateTexture();
    }

    private renderTextToCanvas(text: string): void {
        const padding = 2;

        this.ctx.font = "12px Arial, sans-serif";
        const measured = this.ctx.measureText(text).width;
        this.textWidth = Math.ceil(measured + padding * 2 + 2);

        // Resize the canvas to the exact text size (resets the context state)
        this.canvas.width = this.textWidth;
        this.canvas.height = this.textHeight;
        const ctx = this.canvas.getContext("2d", { alpha: true });
        if (!ctx) {
            console.error("[SystemUpdateOverlay] Failed to re-acquire 2D context after resize");
            return;
        }
        this.ctx = ctx;

        ctx.clearRect(0, 0, this.textWidth, this.textHeight);
        ctx.font = "12px Arial, sans-serif";
        ctx.textBaseline = "top";
        // Light shadow keeps the yellow text readable over any world background.
        ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = "#ffff00";
        ctx.fillText(text, padding, padding);
    }

    private updateTexture(): void {
        if (!this.textureNeedsUpdate) return;
        this.textureNeedsUpdate = false;

        if (this.texture) {
            this.texture.delete();
        }

        this.texture = this.app.createTexture2D(this.canvas as unknown as HTMLImageElement, {
            flipY: false,
            magFilter: PicoGL.NEAREST,
            minFilter: PicoGL.NEAREST,
        });

        this.drawCall = this.app
            .createDrawCall(this.program, this.vertexArray!)
            .texture("uTexture", this.texture);
    }

    private resolveAnchor(): { x: number; y: number } {
        const rect = this.getChatboxRect?.();
        if (rect && rect.width > 0 && rect.height > 0) {
            const x = Math.max(2, Math.round(rect.x + 2));
            let y = Math.round(rect.y - this.textHeight - 4);
            if (y < 2) y = Math.round(rect.y + 2);
            return { x, y };
        }
        // Fallback: classic chatbox top-left position, bottom-left of the screen.
        return { x: 4, y: Math.max(4, this.screenHeight - 175) };
    }

    draw(phase: RenderPhase): void {
        if (phase !== RenderPhase.PostPresent) {
            return;
        }
        if (!this.lastText) {
            return;
        }

        this.app.defaultDrawFramebuffer();
        this.gl.viewport(0, 0, this.screenWidth, this.screenHeight);

        this.updateTexture();
        if (this.drawCall && this.texture) {
            const anchor = this.resolveAnchor();
            this.drawCall
                .uniform("uRect", [anchor.x, anchor.y, this.textWidth, this.textHeight])
                .uniform("uScreen", [this.screenWidth, this.screenHeight]);

            this.app.enable(PicoGL.BLEND);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
            this.app.disable(PicoGL.DEPTH_TEST);
            this.app.disable(PicoGL.CULL_FACE);

            this.drawCall.draw();

            this.app.enable(PicoGL.DEPTH_TEST);
            this.app.disable(PicoGL.BLEND);
        }
    }

    dispose(): void {
        this.unsubscribeUpdate?.();
        this.unsubscribeDisconnect?.();
        this.unsubscribeUpdate = undefined;
        this.unsubscribeDisconnect = undefined;

        try {
            this.texture?.delete();
            this.vertexArray?.delete();
            this.positions?.delete();
            this.uvs?.delete();
            this.program?.delete();
        } catch {}
    }
}
