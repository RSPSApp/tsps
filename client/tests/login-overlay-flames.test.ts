import assert from "node:assert/strict";
import { test } from "node:test";
import { LoginRenderer } from "../game/login/LoginRenderer";
import { LoginState } from "../game/login/LoginState";
import { GameState } from "../game/login/GameState";
import type { LoginOverlay } from "../ui/devoverlay/LoginOverlay";
import { RenderPhase } from "../ui/devoverlay/Overlay";

// Keep the actual renderer/layout/cache and overlay frame path. Supply a flame frame and
// replace browser/GPU boundaries so the separate fire draw submissions are observable.
class CanvasSurface {
    width = 0;
    height = 0;
    private ctx = Object.fromEntries([
        "fillRect", "save", "restore", "translate", "scale", "drawImage", "setTransform",
        "beginPath", "rect", "clip", "clearRect",
    ].map(name => [name, () => {}]));
    constructor(width = 0, height = 0) { this.width = width; this.height = height; }
    getContext() { return this.ctx; }
}

test("WebGL stops an uploaded flame texture on world changes and resumes when enabled", async () => {
    const previous = { document: globalThis.document, canvas: globalThis.OffscreenCanvas, self: globalThis.self };
    Object.assign(globalThis, {
        self: globalThis,
        document: { createElement: () => new CanvasSurface() },
        OffscreenCanvas: CanvasSurface,
    });
    try {
        // PicoGL publishes a flat UMD main for Node and named ESM exports for bundlers.
        const pico = require("picogl");
        pico.PicoGL = pico;
        const { LoginOverlay } = await import("../ui/devoverlay/LoginOverlay");
        const renderer = new LoginRenderer();
        const state = new LoginState();
        let animationUpdates = 0;
        renderer.loginScreenRunesAnimation = {
            updateAndGetCanvas() { animationUpdates++; return new CanvasSurface(128, 264); },
        } as unknown as NonNullable<LoginRenderer["loginScreenRunesAnimation"]>;
        const owner = {
            loginRenderer: renderer, loginState: state,
            renderer: { getUiRenderMetrics: () => ({ layoutW: 765, layoutH: 503, renderScaleX: 1, renderScaleY: 1 }) },
        };
        let programCount = 0;
        let fireDraws = 0;
        let uiDraws = 0;
        const app = {
            gl: { blendFunc() {} }, enable() {}, disable() {},
            createProgram: () => ++programCount,
            createVertexBuffer: () => ({ data() {} }),
            createVertexArray() { return { vertexAttributeBuffer() { return this; } }; },
            createTexture2D: () => ({ data() {} }),
            createDrawCall(program: number) {
                return {
                    texture() { return this; }, uniform() { return this; },
                    draw() { if (program === 2) fireDraws++; else uiDraws++; },
                };
            },
        };
        const overlay = new LoginOverlay(owner as unknown as ConstructorParameters<typeof LoginOverlay>[0]);
        overlay.init({ app } as unknown as Parameters<LoginOverlay["init"]>[0]);
        overlay.setGameState(GameState.LOGIN_SCREEN);
        const update = () => overlay.update({ resolution: { width: 765, height: 503 } } as Parameters<LoginOverlay["update"]>[0]);
        const draw = () => overlay.draw(RenderPhase.PostPresent);

        update(); draw();
        assert.equal(animationUpdates, 1, "the default world animates the flames");
        assert.equal(fireDraws, 2, "the default world draws both braziers");

        renderer.showLoginFlames = false;
        fireDraws = 0;
        draw();
        assert.equal(fireDraws, 0, "a previously uploaded texture must stop drawing immediately");
        update(); draw(); update(); draw();
        assert.equal(animationUpdates, 1, "disabled worlds do not advance or upload the flame frame");
        assert.equal(fireDraws, 0, "disabled worlds keep the cached flame texture hidden");
        assert.ok(uiDraws > 0, "the rest of the login surface keeps drawing");

        renderer.showLoginFlames = true;
        update(); draw();
        assert.equal(animationUpdates, 2, "switching back resumes animation");
        assert.equal(fireDraws, 2, "switching back draws both flames again");

        renderer.showClientLogo = false;
        fireDraws = 0;
        update(); draw();
        assert.equal(fireDraws, 2, "the independent logo flag does not hide flames");
        overlay.dispose();
    } finally {
        if (previous.self === undefined) delete (globalThis as any).self;
        else globalThis.self = previous.self;
        if (previous.document === undefined) delete (globalThis as any).document;
        else globalThis.document = previous.document;
        if (previous.canvas === undefined) delete (globalThis as any).OffscreenCanvas;
        else globalThis.OffscreenCanvas = previous.canvas;
    }
});
