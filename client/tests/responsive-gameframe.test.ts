import assert from "node:assert/strict";

const browser = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", maxTouchPoints: 1 };
let narrow = true;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser });
(globalThis as any).window = { location: { search: "" }, matchMedia: () => ({ matches: narrow }) };

void (async () => {
    const { isMobileMode, prefersMobileGameframe } = await import("../common/utils/DeviceUtil");
    assert.equal(isMobileMode, true, "the page starts in phone emulation");
    assert.equal(prefersMobileGameframe(), true);
    narrow = false;
    assert.equal(prefersMobileGameframe(), true, "a real mobile browser keeps its mobile layout on a larger screen");
    browser.userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/142.0.0.0";
    assert.equal(prefersMobileGameframe(), false, "leaving phone emulation restores the desktop layout without reloading");
    assert.equal(isMobileMode, true, "layout changes do not recreate the startup renderer profile");
    narrow = true;
    assert.equal(prefersMobileGameframe(), false, "a narrow desktop window keeps the desktop layout");
    narrow = false;
    assert.equal(prefersMobileGameframe(), false, "growing the window keeps the desktop layout");
    browser.maxTouchPoints = 5;
    assert.equal(prefersMobileGameframe(), true, "iPad desktop user agents remain mobile");
    browser.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0.0.0";
    assert.equal(prefersMobileGameframe(), false, "a touchscreen desktop remains desktop");
    const { isMobileClient, reportedClientType, CLIENT_TYPE_ENHANCED, CLIENT_TYPE_MOBILE } = await import("../rs/cs2/ClientType");
    assert.equal(isMobileClient(undefined), true, "startup platform is used before a gameframe loads");
    for (const root of [601, 161, 164, 165, 548, 601, 161]) {
        assert.equal(reportedClientType(root), root === 601 ? CLIENT_TYPE_MOBILE : CLIENT_TYPE_ENHANCED,
            "cache scripts must follow the active gameframe, even when the page started in phone emulation");
    }
    console.log("responsive gameframe preference test passed");
})();
