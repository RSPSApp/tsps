import { desktopClientManifestUrl } from "./game/plugins/desktop/DesktopPlugin";

// Embedded by native installers, independently of whichever game bundle is active.
Object.defineProperty(window, "__RSPS_DESKTOP_BOOTSTRAP__", {
    value: Object.freeze({ manifestUrl: desktopClientManifestUrl }),
});
