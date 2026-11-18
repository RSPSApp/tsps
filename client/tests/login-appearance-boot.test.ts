import assert from "node:assert/strict";
import { test } from "node:test";
import { LoginRenderer } from "../game/login/LoginRenderer";
import { state } from "../network/serverConnection/state";

test("boot appearance applies settings and falls back on errors, timeout and stale responses", async () => {
    const originalFetch = globalThis.fetch;
    const originalBitmap = globalThis.createImageBitmap;
    const originalUrl = state.lastUrl;
    const originalConfig = state.webRtcConfig;
    // Exercise appearance loading without constructing a canvas.
    const renderer = Object.create(LoginRenderer.prototype) as LoginRenderer;
    try {
        state.lastUrl = "ws://localhost:43702";
        state.webRtcConfig = undefined;
        let closed = 0;
        const image = { close: () => closed++ } as ImageBitmap;
        globalThis.createImageBitmap = async () => image;
        globalThis.fetch = async () => Response.json({ jpg: "YQ==", showFlames: false, showLogo: false });
        await renderer.refreshClientBackground();
        assert.equal(renderer.customTitleBackgroundImage, image);
        assert.equal(renderer.showLoginFlames, false);
        assert.equal(renderer.showClientLogo, false);

        globalThis.fetch = async () => { throw new Error("offline"); };
        await renderer.refreshClientBackground();
        assert.equal(closed, 1);
        assert.equal(renderer.customTitleBackgroundImage, undefined);
        assert.equal(renderer.showLoginFlames, true);
        assert.equal(renderer.showClientLogo, true);

        globalThis.fetch = async () => Response.json({ jpg: "invalid!", showFlames: false });
        await renderer.refreshClientBackground();
        assert.equal(renderer.showLoginFlames, true, "invalid image retains defaults");

        let finish!: (response: Response) => void;
        globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
        const started = performance.now();
        await renderer.refreshClientBackground();
        assert.ok(performance.now() - started < 4500, "unresponsive request cannot block boot");
        assert.equal(renderer.showLoginFlames, true);
        finish(Response.json({ showFlames: false }));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(renderer.showLoginFlames, true, "late response cannot overwrite defaults");

        let decoded!: (image: ImageBitmap) => void;
        globalThis.fetch = async () => Response.json({ jpg: "YQ==", showFlames: false });
        globalThis.createImageBitmap = () => new Promise(resolve => { decoded = resolve; });
        await renderer.refreshClientBackground();
        assert.equal(renderer.customTitleBackgroundImage, undefined, "slow decoding also times out");
        decoded(image);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(closed, 2, "late decoded bitmap is released");
        assert.equal(renderer.showLoginFlames, true);

        globalThis.fetch = async () => Response.json({ showFlames: false, showLogo: false });
        await renderer.refreshClientBackground();
        assert.equal(renderer.showLoginFlames, false, "settings also work without custom art");
        assert.equal(renderer.showClientLogo, false);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.createImageBitmap = originalBitmap;
        state.lastUrl = originalUrl;
        state.webRtcConfig = originalConfig;
    }
});
