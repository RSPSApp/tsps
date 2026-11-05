import { GameState } from "@runelite/api/GameState";
import type { Client } from "@runelite/api/Client";
import type { GameStateChanged, GameTick } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetOverlay } from "../ClientPluginManager";
import { TickCounterConfig } from "./TickCounterConfig";
import { TickCounterOverlay } from "./TickCounterOverlay";

const DEFAULT_TICKS_PER_CYCLE = 4;
const MAX_TICKS_PER_CYCLE = 99;

/** A small, configurable counter that advances once per game tick and loops back to 1. */
export class TickCounterPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Tick Counter",
        description: "Display a counter that loops after the selected number of game ticks.",
        tags: ["tick", "counter", "overlay"],
        enabledByDefault: false,
        configKey: "tickcounterplugin",
    };

    static config = TickCounterConfig;

    private readonly config = inject(ConfigManager).getConfig(TickCounterConfig);
    private readonly client: Client;
    private tick = 0;
    readonly widgetOverlay: WidgetOverlay;

    constructor(client?: Client) {
        super();
        this.client = client ?? new ClientImpl(inject<OsrsClient>(CLIENT_TOKEN));
        this.widgetOverlay = new TickCounterOverlay(this);
    }

    protected async startUp(): Promise<void> {
        this.tick = 0;
    }

    protected async shutDown(): Promise<void> {
        this.tick = 0;
    }

    onGameTick(_event?: GameTick): void {
        if (!this.isStarted() || !this.isLoggedIn()) return;
        const limit = this.getTicksPerCycle();
        this.tick = this.tick >= limit ? 1 : this.tick + 1;
    }

    onGameStateChanged(event: GameStateChanged): void {
        if (event.getGameState() !== GameState.LOGGED_IN) this.tick = 0;
    }

    isLoggedIn(): boolean {
        return this.client.getGameState() === GameState.LOGGED_IN;
    }

    getVisibleTick(): number | undefined {
        if (!this.isStarted() || !this.isLoggedIn() || this.tick <= 0) return undefined;
        return Math.min(this.tick, this.getTicksPerCycle());
    }

    getTicksPerCycle(): number {
        const configured = Number(this.config.ticksPerCycle());
        if (!Number.isFinite(configured)) return DEFAULT_TICKS_PER_CYCLE;
        return Math.max(1, Math.min(MAX_TICKS_PER_CYCLE, Math.trunc(configured)));
    }
}
