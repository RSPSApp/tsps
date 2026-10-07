import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";

export const InteractHighlightConfig = ConfigGroup("interacthighlight", {
    showHover: ConfigItem({ name: "Show hover highlight", position: 1, default: true }),
    showInteract: ConfigItem({ name: "Show interaction highlight", position: 2, default: true }),
    hoverColor: ConfigItem({ name: "Hover color", color: true, position: 3, default: 0x00ffff }),
    interactColor: ConfigItem({
        name: "Interact color",
        color: true,
        position: 4,
        default: 0xff0000,
    }),
});

export interface InteractHighlightPluginConfig {
    enabled: boolean;
    showHover: boolean;
    showInteract: boolean;
    hoverColor: number;
    interactColor: number;
}

export interface InteractHighlightPluginState {
    config: InteractHighlightPluginConfig;
    version: number;
}

export function readInteractHighlightConfig(
    configManager: ConfigManager,
    enabled: boolean,
): InteractHighlightPluginConfig {
    const config = configManager.getConfig(InteractHighlightConfig);
    return {
        enabled,
        showHover: config.showHover(),
        showInteract: config.showInteract(),
        hoverColor: config.hoverColor(),
        interactColor: config.interactColor(),
    };
}
