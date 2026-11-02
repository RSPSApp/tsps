import {
    DrawCall,
    App as PicoApp,
    PicoGL,
    Program,
    Texture,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { GameState } from "../../game/login";
import { GameStateMachine, StateTransition } from "../../game/state";
import { Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";

/**
 * Explicit fade state for the overlay.
 * Replaces implicit state tracking with clear states.
 */
enum FadeState {
    /** Overlay is not visible */
    HIDDEN = "hidden",
    /** Overlay is fully visible (alpha=1) */
    VISIBLE = "visible",
    /** Transitioning from visible to hidden */
    FADING_OUT = "fading_out",
}

/**
 * Loading message overlay.
 * Renders "Loading - please wait." text box in the top-left corner
 * during LOADING_GAME, RECONNECTING, and CONNECTION_LOST states.
 *
 * Position: top-left corner with padding=4, offset=6
 *
 * Uses explicit FadeState enum instead of implicit state tracking for clarity.
 * Subscribes to GameStateMachine for synchronous state updates.
 */
export class LoadingMessageOverlay implements Overlay {
    private app!: PicoApp;
    private gl!: WebGL2RenderingContext;
    private program!: Program;
    private drawCall?: DrawCall;
    private vertexArray?: VertexArray;
    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;
    private texture?: Texture;

    // Fullscreen black overlay
    private blackProgram!: Program;
    private blackDrawCall?: DrawCall;
    private blackVertexArray?: VertexArray;
    private blackPositions?: VertexBuffer;

    // Explicit fade state machine
    private fadeState: FadeState = FadeState.HIDDEN;
    private fadeProgress: number = 0; // 0-1 for fade-out progress
    private fadeStartTime: number = 0;
    private readonly fadeDuration: number = 500; // ms

    // 2D canvas for text rendering
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    // Current game state (synced from state machine)
    private gameState: GameState = GameState.LOADING;

    // State machine subscription
    private stateMachine?: GameStateMachine;
    private unsubscribe?: () => void;

    // Loading progress (0-100)
    private loadingPercent: number = 0;

    // In-game scene loads: the box alone, once a load has lasted long enough not to flicker
    private sceneLoadingSource?: () => boolean;
    private sceneLoadingSince: number = -1;
    private sceneLoading: boolean = false;
    private readonly sceneLoadingDelay: number = 150; // ms

    // Screen dimensions
    private screenWidth: number = 765;
    private screenHeight: number = 503;

    // Cached message for change detection
    private lastMessage: string = "";
    private textureNeedsUpdate: boolean = false;

    // Box dimensions (updated when message changes)
    private boxWidth: number = 0;
    private boxHeight: number = 0;

    constructor(stateMachine?: GameStateMachine) {
        this.canvas = document.createElement("canvas");
        this.canvas.width = 300;
        this.canvas.height = 80;
        const ctx = this.canvas.getContext("2d", { alpha: false });
        if (!ctx) {
            throw new Error("[LoadingMessageOverlay] Failed to get 2D context");
        }
        this.ctx = ctx;

        // Subscribe to state machine for synchronous updates
        if (stateMachine) {
            this.stateMachine = stateMachine;
            this.gameState = stateMachine.getState();
            this.updateFadeStateFromGameState(this.gameState, this.gameState);
            this.unsubscribe = stateMachine.subscribe((transition) => {
                this.onStateTransition(transition);
            });
        }
    }

    /**
     * Handle state machine transitions.
     * Called synchronously when state changes.
     */
    private onStateTransition(transition: StateTransition): void {
        const oldState = this.gameState;
        this.gameState = transition.to;
        this.updateFadeStateFromGameState(oldState, transition.to);
    }

    /**
     * Update the explicit fade state based on game state transition.
     */
    private updateFadeStateFromGameState(from: GameState, to: GameState): void {
        // Entering a loading state - show immediately
        if (this.shouldShowMessage(to)) {
            this.fadeState = FadeState.VISIBLE;
            this.fadeProgress = 0;
        }
        // Transitioning from LOADING_GAME to LOGGED_IN - start fade out
        else if (from === GameState.LOADING_GAME && to === GameState.LOGGED_IN) {
            this.fadeState = FadeState.FADING_OUT;
            this.fadeProgress = 0;
            this.fadeStartTime = performance.now();
        }
        // Any other non-loading state - hide immediately
        else if (!this.shouldShowMessage(to)) {
            this.fadeState = FadeState.HIDDEN;
            this.fadeProgress = 1;
        }
    }

    /**
     * Check if message should be shown for a given state.
     */
    private shouldShowMessage(state: GameState): boolean {
        return (
            state === GameState.LOADING_GAME ||
            state === GameState.RECONNECTING ||
            state === GameState.CONNECTION_LOST ||
            state === GameState.PLEASE_WAIT
        );
    }

    /**
     * Set the current game state (for backwards compatibility).
     * Prefer using state machine subscription instead.
     */
    setGameState(state: GameState): void {
        if (this.stateMachine) {
            // State machine handles updates via subscription
            return;
        }
        const oldState = this.gameState;
        this.gameState = state;
        if (oldState !== state) {
            this.updateFadeStateFromGameState(oldState, state);
        }
    }

    /**
     * Set loading progress (0-100).
     */
    setLoadingPercent(percent: number): void {
        this.loadingPercent = Math.max(0, Math.min(100, percent));
    }

    /**
     * In game, whether the scene around the player is still being built (after a teleport or any
     * map rebuild). OSRS draws "Loading - please wait." over its last frame while it loads a map;
     * this client builds the scene in workers, so without the box a teleport showed the bare sky
     * colour for a second or more (the Guardians of the Rift altar return, issue #1858).
     */
    setSceneLoadingSource(source: () => boolean): void {
        this.sceneLoadingSource = source;
    }

    init(args: OverlayInitArgs): void {
        this.app = args.app;
        this.gl = args.app.gl as WebGL2RenderingContext;

        // Shader for rendering a textured quad at a specific screen position
        const vertSrc = `#version 300 es
            uniform vec4 uRect; // x, y, width, height in pixels
            uniform vec2 uScreen; // screen width, height
            in vec2 aPosition;
            in vec2 aUV;
            out vec2 vUV;
            void main() {
                // Convert pixel coordinates to NDC
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

        // Unit quad (0,0 to 1,1)
        const positions = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

        const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, positions);
        this.uvs = this.app.createVertexBuffer(PicoGL.FLOAT, 2, uvs);

        this.vertexArray = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.positions)
            .vertexAttributeBuffer(1, this.uvs);

        // Create fullscreen black overlay shader
        const blackVertSrc = `#version 300 es
            in vec2 aPosition;
            void main() {
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        const blackFragSrc = `#version 300 es
            precision highp float;
            uniform float uAlpha;
            out vec4 fragColor;
            void main() {
                fragColor = vec4(0.0, 0.0, 0.0, uAlpha);
            }
        `;

        this.blackProgram = this.app.createProgram(blackVertSrc, blackFragSrc);

        // Fullscreen quad (-1 to 1)
        const blackPositions = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

        this.blackPositions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, blackPositions);
        this.blackVertexArray = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.blackPositions);

        this.blackDrawCall = this.app.createDrawCall(this.blackProgram, this.blackVertexArray);
    }

    update(args: OverlayUpdateArgs): void {
        this.screenWidth = args.resolution.width;
        this.screenHeight = args.resolution.height;

        // Update fade-out progress using explicit state machine
        if (this.fadeState === FadeState.FADING_OUT) {
            const elapsed = args.time - this.fadeStartTime;
            this.fadeProgress = Math.min(1, elapsed / this.fadeDuration);
            if (this.fadeProgress >= 1) {
                this.fadeState = FadeState.HIDDEN;
            }
        }

        const loadingScene = this.gameState === GameState.LOGGED_IN && this.sceneLoadingSource?.() === true;
        if (!loadingScene) this.sceneLoadingSince = -1;
        else if (this.sceneLoadingSince < 0) this.sceneLoadingSince = args.time;
        this.sceneLoading = loadingScene && args.time - this.sceneLoadingSince >= this.sceneLoadingDelay;

        const message = this.getMessage();
        if (message !== this.lastMessage) {
            this.lastMessage = message;
            if (message) {
                this.renderMessageToCanvas(message);
                // Update texture immediately after canvas render to avoid race condition
                // where old texture is shown for a frame
                this.textureNeedsUpdate = true;
                this.updateTextureImmediate();
            } else {
                this.textureNeedsUpdate = false;
            }
        }
    }

    /**
     * Update texture immediately after canvas change.
     * This prevents the race condition where the old texture is shown for a frame.
     */
    private updateTextureImmediate(): void {
        if (!this.textureNeedsUpdate || !this.app) return;
        this.updateTexture();
    }

    private getMessage(): string {
        if (this.sceneLoading) return "Loading - please wait.";
        switch (this.gameState) {
            case GameState.LOADING_GAME:
                if (this.loadingPercent > 0 && this.loadingPercent < 100) {
                    return `Loading - please wait.\n(${this.loadingPercent}%)`;
                }
                return "Loading - please wait.";

            case GameState.RECONNECTING:
            case GameState.CONNECTION_LOST:
                return "Connection lost\nPlease wait - attempting to reestablish";

            case GameState.PLEASE_WAIT:
                return "Please wait...";

            default:
                return "";
        }
    }

    private renderMessageToCanvas(message: string): void {
        // padding = 4, lineHeight = 13
        const padding = 4;
        const lineHeight = 13;
        const maxWidth = 250;

        // Setup font
        this.ctx.font = "12px Arial, sans-serif";

        // Split message into lines and measure
        const lines = message.split("\n");
        let textWidth = 0;
        for (const line of lines) {
            const w = this.ctx.measureText(line).width;
            if (w > textWidth) textWidth = w;
        }
        textWidth = Math.min(textWidth, maxWidth);

        const textHeight = lines.length * lineHeight;

        // Box dimensions
        this.boxWidth = Math.ceil(textWidth + padding * 2 + 4);
        this.boxHeight = Math.ceil(textHeight + padding * 2 + 2);

        // Resize canvas to exact box dimensions (this resets the context!)
        this.canvas.width = this.boxWidth;
        this.canvas.height = this.boxHeight;
        // Re-acquire context after resize (canvas resize clears the context state)
        const ctx = this.canvas.getContext("2d", { alpha: false });
        if (!ctx) {
            console.error("[LoadingMessageOverlay] Failed to re-acquire 2D context after resize");
            return;
        }
        this.ctx = ctx;

        // Fill entire canvas with black (opaque background)
        this.ctx.fillStyle = "#000000";
        this.ctx.fillRect(0, 0, this.boxWidth, this.boxHeight);

        // White border
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(0.5, 0.5, this.boxWidth - 1, this.boxHeight - 1);

        // White text
        this.ctx.fillStyle = "#ffffff";
        this.ctx.font = "12px Arial, sans-serif";
        this.ctx.textBaseline = "top";

        let textY = padding + 1;
        for (const line of lines) {
            this.ctx.fillText(line, padding + 2, textY);
            textY += lineHeight;
        }
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

        // Recreate draw call with new texture
        this.drawCall = this.app
            .createDrawCall(this.program, this.vertexArray!)
            .texture("uTexture", this.texture);
    }

    draw(phase: RenderPhase): void {
        // Only draw during PostPresent phase
        if (phase !== RenderPhase.PostPresent) {
            return;
        }

        // Skip drawing if completely hidden; an in-game scene load draws the box alone
        const sceneLoadOnly = this.fadeState === FadeState.HIDDEN;
        if (sceneLoadOnly && !this.sceneLoading) {
            return;
        }

        // Ensure we're drawing to the default framebuffer
        this.app.defaultDrawFramebuffer();

        // Set viewport to full screen
        this.gl.viewport(0, 0, this.screenWidth, this.screenHeight);

        // Calculate alpha based on fade state
        const alpha = this.fadeState === FadeState.FADING_OUT ? 1.0 - this.fadeProgress : 1.0;

        // Draw black overlay during visible or fading states
        if (this.blackDrawCall && !sceneLoadOnly) {
            // Enable blending for fade effect
            this.app.enable(PicoGL.BLEND);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

            this.app.disable(PicoGL.DEPTH_TEST);
            this.app.disable(PicoGL.CULL_FACE);

            this.blackDrawCall.uniform("uAlpha", alpha);
            this.blackDrawCall.draw();
        }

        // Draw loading message text if there's a message
        if (this.lastMessage) {
            // Update texture from canvas if needed
            this.updateTexture();

            if (this.drawCall && this.texture) {
                // OSRS reference: x = 10, y = 10 (padding + 6)
                const boxX = 10;
                const boxY = 10;

                // Set uniforms
                this.drawCall
                    .uniform("uRect", [boxX, boxY, this.boxWidth, this.boxHeight])
                    .uniform("uScreen", [this.screenWidth, this.screenHeight]);

                // Disable depth test and culling for UI overlay
                this.app.disable(PicoGL.DEPTH_TEST);
                this.app.disable(PicoGL.CULL_FACE);
                this.app.disable(PicoGL.BLEND);

                // Draw
                this.drawCall.draw();
            }
        }

        // Restore state
        this.app.enable(PicoGL.DEPTH_TEST);
        this.app.disable(PicoGL.BLEND);
    }

    /** Present into an external 2D context (DOM-hosted backends). Same fade + box as `draw`. */
    drawTo2D(ctx: CanvasRenderingContext2D): void {
        if (this.fadeState === FadeState.HIDDEN) {
            if (this.sceneLoading && this.lastMessage) ctx.drawImage(this.canvas, 10, 10);
            return;
        }
        const alpha = this.fadeState === FadeState.FADING_OUT ? 1.0 - this.fadeProgress : 1.0;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        if (this.lastMessage) {
            ctx.drawImage(this.canvas, 10, 10);
        }
        ctx.restore();
    }

    isVisible(): boolean {
        return this.fadeState !== FadeState.HIDDEN || this.sceneLoading;
    }

    dispose(): void {
        // Unsubscribe from state machine
        this.unsubscribe?.();

        try {
            this.texture?.delete();
            this.vertexArray?.delete();
            this.positions?.delete();
            this.uvs?.delete();
            this.program?.delete();
            this.blackVertexArray?.delete();
            this.blackPositions?.delete();
            this.blackProgram?.delete();
        } catch {}
    }
}
