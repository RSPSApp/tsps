import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";

// OSRS cache default from struct highlight_destination_tile_colour_3650 param_1230.
const DEFAULT_DESTINATION_TILE_COLOR = 0xa9a753;

export const TileMarkersConfig = ConfigGroup("tilemarkers", {
    showDestinationTile: ConfigItem({
        name: "Highlight destination tile",
        position: 1,
        default: true,
    }),
    showCurrentTile: ConfigItem({ name: "Highlight true tile", position: 2, default: true }),
    destinationTileColor: ConfigItem({
        name: "Destination tile color",
        color: true,
        position: 3,
        default: DEFAULT_DESTINATION_TILE_COLOR,
    }),
    currentTileColor: ConfigItem({
        name: "True tile color",
        color: true,
        position: 4,
        default: 0x808080,
    }),
});

export interface TileMarkersPluginConfig {
    enabled: boolean;
    showDestinationTile: boolean;
    showCurrentTile: boolean;
    destinationTileColor: number;
    currentTileColor: number;
}

export interface TileMarkersPluginState {
    config: TileMarkersPluginConfig;
    version: number;
}

export function readTileMarkersConfig(
    configManager: ConfigManager,
    enabled: boolean,
): TileMarkersPluginConfig {
    const config = configManager.getConfig(TileMarkersConfig);
    return {
        enabled,
        showDestinationTile: config.showDestinationTile(),
        showCurrentTile: config.showCurrentTile(),
        destinationTileColor: config.destinationTileColor(),
        currentTileColor: config.currentTileColor(),
    };
}
