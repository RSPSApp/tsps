import { GameState } from "@runelite/api/GameState";
import type { ConfigOf } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { toRuneLiteGameState } from "../../../runelite/impl/GameStateMapping";
import { ClientState } from "../../ClientState";
import type { OsrsClient } from "../../OsrsClient";
import { TileMarkersConfig } from "./TileMarkersConfig";
import { TileIndicatorsOverlay } from "./TileIndicatorsOverlay";

export type Tile = { x: number; y: number; plane: number };

/**
 * RuneLite 1.13.3 Tile Indicators: the destination tile, the tile under the mouse and the
 * player's true tile, each drawn with its own border colour, fill and width. (The files keep
 * the plugin's earlier Tile Markers name; its settings move to RuneLite's on first start.)
 */
export class TileMarkersPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Tile Indicators",
        description: "Highlight the tile you are currently moving to",
        tags: ["highlight", "overlay"],
        enabledByDefault: false,
        configKey: "tileindicatorsplugin",
    };

    static config = TileMarkersConfig;

    private readonly configManager: ConfigManager;
    readonly config: ConfigOf<typeof TileMarkersConfig>;
    private readonly osrsClient: OsrsClient;
    readonly widgetOverlay: TileIndicatorsOverlay;

    constructor(osrsClient?: OsrsClient, configManager?: ConfigManager) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.configManager = configManager ?? inject(ConfigManager);
        this.config = this.configManager.getConfig(TileMarkersConfig);
        this.widgetOverlay = new TileIndicatorsOverlay(this);
    }

    getClient(): OsrsClient {
        return this.osrsClient;
    }

    isLoggedIn(): boolean {
        return toRuneLiteGameState((this.osrsClient as any)?.gameState) === GameState.LOGGED_IN;
    }

    /** varbit CUTSCENE_STATUS. */
    inCutscene(): boolean {
        return ((this.osrsClient as any).varManager?.getVarbit?.(542) ?? 0) === 1;
    }

    private playerIndex(): number | undefined {
        const client: any = this.osrsClient;
        return client.playerEcs?.getIndexForServerId?.(client.controlledPlayerServerId);
    }

    playerPlane(): number {
        const index = this.playerIndex();
        return index === undefined ? ClientState.plane | 0 : (this.osrsClient as any).playerEcs.getLevel(index) | 0;
    }

    /** client.getLocalDestinationLocation, on the player's plane. */
    destinationTile(): Tile | undefined {
        let x = ClientState.destinationWorldX | 0;
        let y = ClientState.destinationWorldY | 0;
        if (x === 0 && y === 0) {
            const lx = ClientState.destinationX | 0;
            const ly = ClientState.destinationY | 0;
            if (lx === 0 && ly === 0) return undefined;
            x = ClientState.localToWorldX(lx) | 0;
            y = ClientState.localToWorldY(ly) | 0;
        }
        return { x, y, plane: this.playerPlane() };
    }

    /** wv.getSelectedSceneTile: the tile under the mouse, as Walk here picks it. */
    hoveredTile(): Tile | undefined {
        const tile = (this.osrsClient as any).selectedSceneTile as { tileX: number; tileY: number; plane?: number } | undefined;
        return tile ? { x: tile.tileX | 0, y: tile.tileY | 0, plane: this.playerPlane() } : undefined;
    }

    /** player.getWorldLocation: the tile the server has the player on, moving or not. */
    trueTile(): Tile | undefined {
        const client: any = this.osrsClient;
        const state = client.playerMovementSync?.getState?.(client.controlledPlayerServerId);
        if (state) return { x: state.tileX | 0, y: state.tileY | 0, plane: this.playerPlane() };
        const index = this.playerIndex();
        if (index === undefined) return undefined;
        return { x: client.playerEcs.getX(index) >> 7, y: client.playerEcs.getY(index) >> 7, plane: this.playerPlane() };
    }
}
