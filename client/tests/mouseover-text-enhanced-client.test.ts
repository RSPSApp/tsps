import assert from "node:assert/strict";

// A touchscreen Windows laptop: touch hardware reports mobile, the Windows UA renders the desktop
// layout. Stubbed before the client modules load so their device constants see it.
Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        maxTouchPoints: 10,
    },
});

async function main(): Promise<void> {
    const { isMobileMode, isTouchDevice, tooltipsEnabledByDefault } = await import(
        "../common/utils/DeviceUtil"
    );
    const { CLIENT_TYPE_ANDROID, CLIENT_TYPE_ENHANCED, isMobileClient, reportedClientType } =
        await import("../rs/cs2/ClientType");
    const { WidgetsOverlay } = await import("../ui/devoverlay/WidgetsOverlay");

    assert.equal(isTouchDevice, true, "the touchscreen is detected as a touch device");
    assert.equal(isMobileMode, false, "a touchscreen laptop keeps the desktop layout");
    assert.equal(
        tooltipsEnabledByDefault,
        true,
        "a touchscreen laptop keeps hover tooltips, or the world mouseover text has no menu",
    );

    /**
     * As the enhanced client (clienttype 10) the game draws the top-left mouseover text itself
     * (cache script 4726, with varbit 10035, mouseover_text_disabled, at 0), so the client's own text stays hidden: drawing
     * both showed it twice. A touchscreen desktop is still the enhanced client (#358), or the
     * mobile scripts hide the text on it.
     */
    assert.equal(isMobileClient(161), false, "a touchscreen desktop is not a mobile client");
    assert.equal(isMobileClient(601), true, "the mobile layout is a mobile client");
    assert.equal(
        reportedClientType(161),
        CLIENT_TYPE_ENHANCED,
        "the desktop layout is the enhanced client",
    );
    assert.equal(reportedClientType(601), CLIENT_TYPE_ANDROID, "the mobile layout is android");

    const client: any = {
        showMouseOverText: true,
        menuOpen: false,
        widgetManager: { rootInterface: 161 },
        varManager: { getVarbit: () => 0 },
        menuActiveSimpleEntries: [{ option: "Walk here", target: "" }],
    };
    const overlay: any = Object.create(WidgetsOverlay.prototype);
    Object.assign(overlay, {
        ctx: { getGameContext: () => ({ osrsClient: client }) },
        glRenderer: { width: 800, height: 600 },
        app: { width: 800 },
        overlayScaleX: 1,
        overlayScaleY: 1,
        getOverlayTextScale: () => ({ x: 1, y: 1 }),
    });
    assert.deepEqual(
        overlay.getMouseOverTextVisualState(false),
        { signature: "hidden" },
        "the game's text is the only one",
    );

    // Other client types still get the client's own text.
    client.widgetManager.rootInterface = 601;
    assert.equal(overlay.getMouseOverTextVisualState(false).text, "Walk here");

    console.log("mouseover text (enhanced client): ok");
}

void main();
