import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { PORTRAIT_MODE_CONFIG_KEY, setPortraitModeEnabled } from "./PortraitLayout";

/**
 * Lets a phone play upright. Phones are otherwise turned sideways (useSafariLandscapeLock): with
 * this on, an upright phone keeps the game upright and the mobile gameframe is rearranged for
 * it (PortraitLayout.ts), chat across the top and the minimap, tab stones and side panel along
 * the bottom. Turning the phone sideways gives the normal landscape layout. The on-screen
 * joystick is hidden in portrait; tap to walk.
 */
export class PortraitModePlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Portrait Mode",
        description: "Play upright on a phone: chat on top, minimap, tabs and inventory along the bottom.",
        tags: ["mobile", "phone", "portrait", "orientation", "layout", "rotate"],
        enabledByDefault: false,
        configKey: PORTRAIT_MODE_CONFIG_KEY,
    };

    protected override async startUp(): Promise<void> {
        setPortraitModeEnabled(true);
    }

    protected override async shutDown(): Promise<void> {
        setPortraitModeEnabled(false);
    }
}
