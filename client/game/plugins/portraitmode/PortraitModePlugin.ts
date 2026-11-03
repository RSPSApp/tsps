import type { ConfigChanged } from "@runelite/api/events";
import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import {
    PORTRAIT_MODE_CONFIG_KEY,
    setPortraitModeEnabled,
    setPortraitLeftHanded,
} from "./PortraitLayout";

export const PortraitModeConfig = ConfigGroup("portraitmode", {
    leftHanded: ConfigItem({
        name: "Left-handed layout",
        description:
            "Put the inventory on the left and the minimap and tab buttons on the right in portrait mode.",
        default: false,
    }),
});

/**
 * Lets a phone play upright. Phones are otherwise turned sideways (useSafariLandscapeLock): with
 * this on, an upright phone keeps the game upright and the mobile gameframe is rearranged for
 * it (PortraitLayout.ts), chat across the top and the minimap, tab stones and side panel along
 * the bottom. Turning the phone sideways gives the normal landscape layout.
 */
export class PortraitModePlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Portrait Mode",
        description:
            "Play upright on a phone: chat on top, minimap, tabs and inventory along the bottom.",
        tags: ["mobile", "phone", "portrait", "orientation", "layout", "rotate"],
        enabledByDefault: false,
        configKey: PORTRAIT_MODE_CONFIG_KEY,
    };

    static config = PortraitModeConfig;
    private readonly config = inject(ConfigManager).getConfig(PortraitModeConfig);

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === PortraitModeConfig.group)
            setPortraitLeftHanded(this.config.leftHanded());
    }

    protected override async startUp(): Promise<void> {
        setPortraitLeftHanded(this.config.leftHanded());
        setPortraitModeEnabled(true);
    }

    protected override async shutDown(): Promise<void> {
        setPortraitModeEnabled(false);
    }
}
