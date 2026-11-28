import assert from "node:assert/strict";

Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/156.0.0.0 Mobile Safari/537.36",
    maxTouchPoints: 5,
} });
(globalThis as any).self = globalThis;
for (const ext of [".png", ".jpg", ".webp", ".glsl"]) {
    require.extensions[ext] = (module, file) => { module.exports = file; };
}

async function main(): Promise<void> {
    const { GameRenderer } = await import("../game/GameRenderer");
    const { AntiAliasingMode, GpuConfig } = await import("../game/plugins/gpu/GpuConfig");
    const { ConfigManager } = await import("../runelite/client/config/ConfigManager");
    const { PerformanceConfig, PerformanceMode } = await import("../game/performance/PerformanceConfig");
    const {
        getPerformancePolicy, initPerformancePolicy, refreshPerformancePolicy,
    } = await import("../game/performance/PerformancePolicy");
    const { getCanvasResolutionScale } = await import("../render/render/quality");

    const config = new ConfigManager();
    initPerformancePolicy(config);
    assert.equal(getPerformancePolicy().preset, "auto-mobile");
    assert.equal(getPerformancePolicy().fpsLimit, 30, "Auto keeps the mobile 30 FPS preset");
    assert.equal(getPerformancePolicy().sceneMsaaSamples, 0, "Auto mobile has no scene MSAA");

    let gpu: { fpsLimit: number } | undefined = undefined;
    const host: any = {
        fpsLimit: 120,
        osrsClient: { targetFps: 20, clientPlugins: { gpuSettings: () => gpu } },
    };
    const limit = () => (GameRenderer.prototype as any).getEffectiveFpsLimit.call(host);
    assert.equal(limit(), 20, "the mobile battery cap still lowers the preset cap");
    host.osrsClient.targetFps = 0;
    assert.equal(limit(), 30, "without a battery cap the preset's 30 FPS applies");
    gpu = { fpsLimit: 10 };
    assert.equal(limit(), 10, "an explicit GPU cap still applies");
    gpu = undefined;

    config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.HIGH);
    refreshPerformancePolicy();
    assert.equal(getPerformancePolicy().fpsLimit, 240);
    assert.equal(getPerformancePolicy().sceneMsaaSamples, 4);
    assert.equal(getPerformancePolicy().workerCount, 1, "High on a phone still caps workers at 1");
    assert.equal(getPerformancePolicy().mapSquareCacheLimit, 64);
    host.osrsClient.targetFps = 20;
    assert.equal(limit(), 20, "a phone battery cap also caps High");

    config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.LOW);
    refreshPerformancePolicy();
    assert.equal(getPerformancePolicy().fpsLimit, 30);
    assert.equal(getPerformancePolicy().sceneMsaaSamples, 0);
    assert.equal(GpuConfig.items.antiAliasingMode.default, AntiAliasingMode.MSAA_4,
        "the GPU config's desktop default is unchanged");
    assert.equal(getPerformancePolicy().sceneMsaaSamples, 0,
        "Low uses the preset default until the GPU plugin's AA is changed");

    // Handheld canvas memory caps stay on High.
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
        innerWidth: 1200, innerHeight: 800, devicePixelRatio: 3, location: { search: "" },
        addEventListener() {},
    } });
    const canvasHost: any = { osrsClient: { gameState: 30, isOnLoginScreen: () => false } };
    assert.equal(getCanvasResolutionScale(canvasHost, 400, 300), 2,
        "a small phone keeps its 2x DPR cap");
    const large = getCanvasResolutionScale(canvasHost, 2000, 1500);
    assert.ok(large < 2 && large >= 1, `a huge phone canvas is pixel-capped (${large})`);

    const { getMobileGameplayUiScale } = await import("../render/render/quality");
    const { setPortraitModeEnabled } = await import("../game/plugins/portraitmode/PortraitLayout");
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 1320, innerHeight: 1340 } });
    setPortraitModeEnabled(true);
    try {
        const scale = getMobileGameplayUiScale({} as never, 1320, 1304, 1320, 1304);
        assert.ok(1304 * scale >= 800, "portrait minimum height applies even when the toolbar makes the canvas landscape");
        assert.ok(1320 * scale >= 523, "portrait inventory and chat still fit horizontally");
        (globalThis as any).window.innerHeight = 864;
        for (const width of [1300, 1200, 1100, 1000, 900, 865]) {
            (globalThis as any).window.innerWidth = width;
            const canvasWidth = width - 36;
            const fit = getMobileGameplayUiScale({} as never, canvasWidth, 864, canvasWidth, 864);
            assert.ok(Math.round(canvasWidth * fit) >= 816, "landscape keeps room for the native safezone, the side panel and edge padding at " + width);
        }
        Object.assign((globalThis as any).window, { innerWidth: 667, innerHeight: 375 });
        const phoneScale = getMobileGameplayUiScale({} as never, 631, 375, 631, 375);
        assert.ok(375 * phoneScale >= 503,
            "a landscape phone keeps the native 503px gameframe height instead of squeezing the HUD");

        const { setMobileInterfaceScalingPercent } = await import("../ui/UiScale");
        const tabletWidth = 1180, tabletHeight = 820;
        const atDefault = getMobileGameplayUiScale(
            {} as never, tabletWidth, tabletHeight, tabletWidth, tabletHeight);
        setMobileInterfaceScalingPercent(175);
        const atSmall = getMobileGameplayUiScale(
            {} as never, tabletWidth, tabletHeight, tabletWidth, tabletHeight);
        assert.ok(atSmall > atDefault,
            "175% spreads the interface over more layout pixels than the 400% default");
        assert.equal(Math.round(tabletWidth * atSmall) > Math.round(tabletWidth * atDefault), true,
            "lowering the mobile scale makes the interface smaller, not larger");
        assert.ok(tabletHeight * atDefault >= 503, "the default tablet layout keeps the 503px height");
        setMobileInterfaceScalingPercent(400);
    } finally {
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else delete (globalThis as any).window;
        setPortraitModeEnabled(false);
    }
    console.log("Mobile GPU budget regression tests passed");
}

void main();
