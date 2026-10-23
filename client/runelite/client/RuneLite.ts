import { subscribePluginMessages } from "../../network/serverConnection/domain/pluginMessages";
import { PluginMessage } from "@runelite/api/events/PluginMessage";
import { ChatMessage, GameStateChanged } from "@runelite/api/events";
import { ClientTick } from "@runelite/api/events/ClientTick";
import { CommandExecuted } from "@runelite/api/events/CommandExecuted";
import { FocusChanged } from "@runelite/api/events/FocusChanged";
import { GameTick } from "@runelite/api/events/GameTick";
import { PostClientTick } from "@runelite/api/events/PostClientTick";
import { BeforeRender } from "@runelite/api/events/BeforeRender";
import type { OsrsClient } from "../../game/OsrsClient";
import { subscribeTick } from "../../network/serverConnection/timing";
import { subscribeChatMessages } from "../../network/serverConnection/subscriptions/ui";
import { ConfigManager } from "./config/ConfigManager";
import { EventBus } from "./eventbus/EventBus";
import { PluginManager } from "./plugins/PluginManager";
import { ClientToolbar } from "./ui/ClientToolbar";
import { OverlayRenderer } from "./ui/overlay/OverlayRenderer";
import { CLIENT_TOKEN } from "./plugins/PluginInjector";
import { CORE_PLUGINS, LEGACY_CONFIG_MIGRATIONS } from "./plugins";
import { toRuneLiteGameState } from "../impl/GameStateMapping";
import { runLegacyConfigMigrations } from "../impl/LegacyConfigMigration";

/**
 * Boots the RuneLite-shaped plugin runtime around an OsrsClient: singletons,
 * injector bindings, engine event emitters, legacy config migration and the
 * core plugin list. OsrsClient calls `RuneLite.start(this, loadPlugins)` once.
 */
export class RuneLite {
    static instance?: RuneLite;

    readonly eventBus = new EventBus();
    readonly configManager: ConfigManager;
    readonly pluginManager: PluginManager;
    /** The sidebar's buttons, added by plugins (`inject(ClientToolbar)`). */
    readonly clientToolbar: ClientToolbar;
    /** Lays out movable overlays and lets the player Alt-drag them. */
    readonly overlayRenderer: OverlayRenderer;

    private constructor(
        private readonly client: OsrsClient,
        private readonly loadPlugins: boolean,
    ) {
        this.configManager = new ConfigManager(this.eventBus);
        this.pluginManager = new PluginManager(this.eventBus, this.configManager);
        this.clientToolbar = this.pluginManager.getInjector().get(ClientToolbar);
        this.overlayRenderer = new OverlayRenderer(client, this.configManager);
    }

    static start(client: OsrsClient, loadPlugins = true): RuneLite {
        if (RuneLite.instance) return RuneLite.instance;
        const instance = new RuneLite(client, loadPlugins);
        RuneLite.instance = instance;
        instance.load();
        return instance;
    }

    /** Posts a CommandExecuted event; returns true when a subscriber consumed it. */
    postCommandExecuted(command: string): void {
        this.eventBus.post(new CommandExecuted(command));
    }

    postClientTick(): void {
        this.eventBus.post(new ClientTick());
    }

    postPostClientTick(): void {
        this.eventBus.post(new PostClientTick());
    }

    postBeforeRender(): void {
        this.eventBus.post(new BeforeRender());
    }

    private load(): void {
        const injector = this.pluginManager.getInjector();
        injector.provide(CLIENT_TOKEN, this.client);

        this.client.stateMachine.subscribe((transition) => {
            this.eventBus.post(new GameStateChanged(toRuneLiteGameState(transition.to)));
        });

        subscribePluginMessages(({ channel, data }) => this.eventBus.post(new PluginMessage(channel, data)));
        subscribeChatMessages((msg) => this.eventBus.post(
            new ChatMessage(msg.chatType ?? 0, msg.from ?? "", msg.text, msg.prefix ?? null),
        ));

        // state.tickListeners fire after the tick's packets are applied.
        subscribeTick(() => this.eventBus.post(new GameTick()));

        if (typeof window !== "undefined") {
            window.addEventListener("focus", () => this.eventBus.post(new FocusChanged(true)));
            window.addEventListener("blur", () => this.eventBus.post(new FocusChanged(false)));
        }

        // Edit mode: no plugins, so nothing for the overlay renderer to lay out either.
        if (!this.loadPlugins) return;
        runLegacyConfigMigrations(LEGACY_CONFIG_MIGRATIONS, this.configManager);
        this.pluginManager.loadCorePlugins(CORE_PLUGINS);

        // Engine hooks (shader, camera, gameframe) follow each loaded plugin.
        for (const plugin of this.pluginManager.getPlugins()) {
            this.client.clientPlugins.add(plugin);
        }
        // Last, so its outlines and snap corners draw over every overlay.
        this.client.clientPlugins.add(this.overlayRenderer);
        this.overlayRenderer.start();
    }
}
