import assert from "node:assert/strict";
import fs from "node:fs";

(globalThis as any).self = globalThis;

// Renderer modules import shader sources and sprite assets as modules.
require.extensions[".glsl"] = (module: any, file: string) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module: any, file: string) => { module.exports = file; };

type Target = { width: number; height: number; samples: number; deletes: number; delete(): void };
type Framebuffer = { color: Target; deletes: number; delete(): void };

function target(width: number, height: number, samples = 0): Target {
    return { width, height, samples, deletes: 0, delete() { this.deletes++; } };
}

async function main(): Promise<void> {
    const PicoGL = require("picogl");
    PicoGL.PicoGL = PicoGL;
    const { initFramebuffer, initTextureFramebuffer, resolveSceneFramebuffer } =
        await import("../render/render/init/framebuffers");
    const { onResize } = await import("../render/render/settings");
    const { cleanUp } = await import("../render/render/session");

    function fixture(samples = 4, scale = 0.6, maxSamples = 4, width = 804, height = 390) {
        const copies: { source: Target; destination: Target; filter: number }[] = [];
        let read: Framebuffer;
        let draw: Framebuffer;
        const host: any = {
            getSceneRenderSize: () => ({
                width: Math.round(host.app.width * scale),
                height: Math.round(host.app.height * scale),
            }),
            getRequestedMsaaSamples: () => samples,
            gl: { getParameter: () => maxSamples, readBuffer: () => {} },
            app: {
                width,
                height,
                createRenderbuffer: (w: number, h: number, _format: number, s: number) => target(w, h, s),
                createTexture2D: (w: number, h: number) => target(w, h),
                createFramebuffer() {
                    return {
                        deletes: 0,
                        colorTarget(_index: number, color: Target) { this.color = color; return this; },
                        depthTarget() { return this; },
                        delete() { this.deletes++; },
                    } as Framebuffer;
                },
                readFramebuffer(framebuffer: Framebuffer) { read = framebuffer; },
                drawFramebuffer(framebuffer: Framebuffer) { draw = framebuffer; },
                blitFramebuffer(mask: number, rect: any) {
                    assert.equal(mask, PicoGL.COLOR_BUFFER_BIT);
                    const srcSize = [rect.srcEndX - rect.srcStartX, rect.srcEndY - rect.srcStartY];
                    const dstSize = [rect.dstEndX - rect.dstStartX, rect.dstEndY - rect.dstStartY];
                    assert.deepEqual(srcSize, [read.color.width, read.color.height]);
                    assert.deepEqual(dstSize, [draw.color.width, draw.color.height]);
                    if (read.color.samples > 0) {
                        assert.deepEqual(srcSize, dstSize, "WebGL rejects a scaled multisample resolve");
                        assert.equal(rect.filter, PicoGL.NEAREST, "MSAA resolves use NEAREST");
                    }
                    assert.equal(draw.color.samples, 0);
                    copies.push({ source: read.color, destination: draw.color, filter: rect.filter });
                },
            },
        };
        initFramebuffer(host);
        initTextureFramebuffer(host);
        return {
            host, copies,
            setSamples: (value: number) => { samples = value; },
            setScale: (value: number) => { scale = value; },
        };
    }

    const mobile = fixture();
    resolveSceneFramebuffer(mobile.host);
    assert.equal(mobile.host.colorTarget.samples, 4, "mobile keeps requested MSAA");
    assert.deepEqual(mobile.copies.map(({ source, destination, filter }) => [
        source.width, source.height, source.samples, destination.width, destination.height, filter,
    ]), [
        [482, 234, 4, 482, 234, PicoGL.NEAREST],
        [482, 234, 0, 804, 390, PicoGL.LINEAR],
    ], "resolve at scene size, then upscale the single-sampled scene for full-size UI composition");

    for (const [samples, scale, maxSamples, expectedFilter] of [
        [4, 1, 4, PicoGL.NEAREST],
        [0, 0.6, 4, PicoGL.LINEAR],
        [4, 0.6, 0, PicoGL.LINEAR],
        [0, 1, 4, PicoGL.NEAREST],
    ]) {
        const { host, copies } = fixture(samples, scale, maxSamples);
        resolveSceneFramebuffer(host);
        assert.equal(host.sceneResolveFramebuffer, undefined, "no intermediate without scaled actual MSAA");
        assert.equal(copies.length, 1);
        assert.equal(copies[0].filter, expectedFilter);
    }

    // Desktop at native scene scale: the 1652x982 canvas from the report must render and present
    // at 1652x982, with no rescaling blit.
    const desktop = fixture(4, 1, 4, 1652, 982);
    assert.deepEqual([desktop.host.sceneRenderWidth, desktop.host.sceneRenderHeight], [1652, 982]);
    assert.equal(desktop.host.sceneResolveFramebuffer, undefined,
        "native-size MSAA resolves straight into the composited texture");
    resolveSceneFramebuffer(desktop.host);
    assert.deepEqual(desktop.copies.map(({ source, destination, filter }) => [
        source.width, source.height, source.samples, destination.width, destination.height, filter,
    ]), [
        [1652, 982, 4, 1652, 982, PicoGL.NEAREST],
    ], "a native-size scene has one 1:1 blit and no upscale");

    // Changing the scene resolution reallocates the scene target and the matching MSAA resolve.
    desktop.setScale(0.6);
    initFramebuffer(desktop.host);
    assert.deepEqual([desktop.host.sceneRenderWidth, desktop.host.sceneRenderHeight], [991, 589]);
    assert.deepEqual(
        [desktop.host.sceneResolveColorTarget.width, desktop.host.sceneResolveColorTarget.height],
        [991, 589],
        "the resolve destination matches the scene source",
    );
    desktop.copies.length = 0;
    resolveSceneFramebuffer(desktop.host);
    assert.deepEqual(desktop.copies.map(({ source, destination, filter }) => [
        source.width, source.height, source.samples, destination.width, destination.height, filter,
    ]), [
        [991, 589, 4, 991, 589, PicoGL.NEAREST],
        [991, 589, 0, 1652, 982, PicoGL.LINEAR],
    ], "the old 0.6 path resolves at scene size before stretching to the canvas");

    // A sidebar toggle or window resize reallocates the scene targets, the MSAA resolve and the
    // full-size composition texture together.
    desktop.host.app.resize = () => {};
    desktop.host.canvas = { removeEventListener() {} };
    desktop.host.computeUiRenderMetrics = (width: number, height: number) => ({
        layoutW: width, layoutH: height, renderScaleX: 1,
    });
    desktop.host.initTextureFramebuffer = (width: number, height: number) =>
        initTextureFramebuffer(desktop.host, width, height);
    onResize(desktop.host, 1352, 982);
    initFramebuffer(desktop.host);
    assert.deepEqual([desktop.host.sceneRenderWidth, desktop.host.sceneRenderHeight], [811, 589]);
    assert.deepEqual(
        [desktop.host.sceneResolveColorTarget.width, desktop.host.sceneResolveColorTarget.height],
        [811, 589],
    );
    assert.deepEqual(
        [desktop.host.textureColorTarget.width, desktop.host.textureColorTarget.height],
        [1352, 982],
        "the composition texture follows the canvas",
    );

    // Back to native scale on the resized canvas: the intermediate is released and presentation is 1:1.
    desktop.setScale(1);
    initFramebuffer(desktop.host);
    assert.equal(desktop.host.sceneResolveFramebuffer, undefined);
    assert.deepEqual([desktop.host.sceneRenderWidth, desktop.host.sceneRenderHeight], [1352, 982]);
    desktop.copies.length = 0;
    resolveSceneFramebuffer(desktop.host);
    assert.deepEqual(desktop.copies.map(({ source, destination, filter }) => [
        source.width, source.height, source.samples, destination.width, destination.height, filter,
    ]), [
        [1352, 982, 4, 1352, 982, PicoGL.NEAREST],
    ]);

    const host = mobile.host;
    const originalSceneTargets = [host.framebuffer, host.colorTarget, host.depthTarget];
    const originalResolveTargets = [host.sceneResolveFramebuffer, host.sceneResolveColorTarget];
    const originalUiTargets = [host.textureFramebuffer, host.textureColorTarget, host.textureDepthTarget];
    host.app.resize = () => {};
    host.canvas = { removeEventListener() {} };
    host.computeUiRenderMetrics = (width: number, height: number) => ({
        layoutW: width, layoutH: height, renderScaleX: 1,
    });
    host.initTextureFramebuffer = (width: number, height: number) => initTextureFramebuffer(host, width, height);
    onResize(host, 390, 804);
    assert.equal(host.needsFramebufferUpdate, true, "rotation schedules scene-target recreation");
    initFramebuffer(host);
    assert.deepEqual([host.sceneResolveColorTarget.width, host.sceneResolveColorTarget.height], [234, 482]);
    assert.deepEqual([host.textureColorTarget.width, host.textureColorTarget.height], [390, 804]);
    for (const previous of [...originalSceneTargets, ...originalResolveTargets, ...originalUiTargets]) {
        assert.equal(previous.deletes, 1, "rotation releases every superseded target once");
    }
    mobile.copies.length = 0;
    resolveSceneFramebuffer(host);
    assert.equal(mobile.copies.length, 2, "rotated MSAA still resolves before upscaling");

    const rotatedResolveTargets = [host.sceneResolveFramebuffer, host.sceneResolveColorTarget];
    mobile.setSamples(0);
    initFramebuffer(host);
    for (const previous of rotatedResolveTargets) assert.equal(previous.deletes, 1);
    assert.equal(host.sceneResolveFramebuffer, undefined, "disabling MSAA releases the intermediate");
    assert.equal(host.sceneResolveColorTarget, undefined);
    mobile.copies.length = 0;
    resolveSceneFramebuffer(host);
    assert.equal(mobile.copies.length, 1, "disabled MSAA scales directly");

    mobile.setSamples(16);
    initFramebuffer(host);
    assert.equal(host.colorTarget.samples, 4, "requested samples respect device support");
    assert.ok(host.sceneResolveFramebuffer, "reenabling supported MSAA recreates the intermediate");
    const finalTargets = [
        "framebuffer", "colorTarget", "depthTarget", "sceneResolveFramebuffer", "sceneResolveColorTarget",
        "textureFramebuffer", "textureColorTarget", "textureDepthTarget",
    ];
    const disposed = finalTargets.map((key) => host[key]);
    Object.assign(host, {
        osrsClient: {
            inputManager: { cleanUp() {} },
            workerPool: { resetLoader() {} },
            clientPlugins: { disposeRenderer() {} },
        },
        destroyMobileLoginInput() {}, playerHealthBars: new Map(), npcHealthBars: new Map(),
        playerRenderer: { cleanupAppearanceCache() {} },
        clearPlayerGeometryRuntimeState() {}, clearInteractHighlightActiveTarget() {},
        clearInteractHighlightHoverTarget() {}, interactHighlightDrawTargets: [],
        actorDataTextures: [], actorDataTextureBuffer: [], clearMaps() {}, clearMinimapSources() {}, disposeDynamicNpcAnimState() {},
    });
    await cleanUp(host);
    for (const resource of disposed) assert.equal(resource.deletes, 1, "cleanup releases each live target once");
    for (const key of finalTargets) assert.equal(host[key], undefined, `cleanup clears ${key}`);
    await cleanUp(host);
    for (const resource of disposed) assert.equal(resource.deletes, 1, "cleanup remains safe when repeated");

    console.log("mobile MSAA resolve tests passed");
}

void main();
