import { createElement, type ReactNode } from "react";
import { ChatMessage, ConfigChanged, GameStateChanged, PluginMessage } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { encodeChunkedPluginMessage, ChunkedPluginMessageAssembler } from "../../../common/network/ChunkedPluginMessages";
import { send } from "../../../network/serverConnection/connection/send";
import { getLatestSkills, getLatestRunEnergy, subscribeBank } from "../../../network/ServerConnection";
import type { OsrsClient } from "../../OsrsClient";
import { ClientState } from "../../ClientState";
import type { OrderedClientEvent, ReadonlyClientSnapshot } from "./QuestHelperProtocol";
import { QuestHelperConfig } from "./QuestHelperConfig";
import { QuestHelperSession } from "./QuestHelperSession";
import { QuestHelperEvents } from "./QuestHelperEvents";
import { collectHelperNpc, collectQuestHelperSnapshot } from "./QuestHelperSnapshot";
import { OwnedTileHighlights, resolveTargetTiles } from "./QuestHelperHighlights";
import { createQuestHelperNavigationButton, QuestHelperOverlay } from "./QuestHelperPanel";
import { collectQuestHelperDefinitions } from "./QuestHelperDefinitions";
import { collectQuestHelperGeometry } from "./QuestHelperGeometry";
export class QuestHelperPlugin extends Plugin {
    static descriptor: PluginDescriptor = { name: "Quest Helper", description: "Read-only guided quest steps, requirements and highlights from the local Quest Helper engine.", tags: ["quests", "guide", "offline"], enabledByDefault: false, configKey: "questhelperplugin" };
    static config = QuestHelperConfig;
    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private readonly configManager = inject(ConfigManager);
    private readonly toolbar = inject(ClientToolbar);
    private readonly session = new QuestHelperSession(data => this.signal(data));
    private readonly assembly = new ChunkedPluginMessageAssembler();
    private readonly events = new QuestHelperEvents();
    private readonly highlights = new OwnedTileHighlights(this.client.tileHighlightManager, 60001);
    private nav?: NavigationButton;
    private cleanup: (() => void)[] = [];
    private tick = 0;
    private lastSent = 0;
    private pendingSince = 0;
    private snapshot?: ReadonlyClientSnapshot;
    private account = "";
    private knownBank = false;
    private faulted = false;
    private readonly requiredVarbits = new Set<number>();
    private readonly itemDefinitionIds = new Set<number>();
    private readonly objectDefinitionIds = new Set<number>();
    private readonly npcDefinitionIds = new Set<number>();
    private geometryRequested = false;
    subscribe = this.session.subscribe;
    getState = this.session.getState;
    getSnapshot(): ReadonlyClientSnapshot | undefined { return this.snapshot; }
    getConfig(): {
        highlightTiles: boolean;
        highlightWidgets: boolean;
        showOverlays: boolean;
        highlightColor: number;
    } {
        const config = this.configManager.getConfig(QuestHelperConfig);
        return { highlightTiles: config.highlightTiles(), highlightWidgets: config.highlightWidgets(), showOverlays: config.showOverlays(), highlightColor: config.highlightColor() };
    }
    protected async startUp(): Promise<void> {
        const config = this.configManager.getConfig(QuestHelperConfig);
        this.session.select(config.selectedQuest(), config.helperVariant() || undefined);
        this.nav = createQuestHelperNavigationButton(this);
        this.toolbar.addNavigation(this.nav);
        this.cleanup.push(this.session.subscribe(() => this.refreshHighlights()));
        this.faulted = false;
    }
    protected async shutDown(): Promise<void> {
        this.session.close();
        this.clearRuntime();
        for (const cleanup of this.cleanup)
            cleanup();
        this.cleanup = [];
        if (this.nav)
            this.toolbar.removeNavigation(this.nav);
        this.nav = undefined;
    }
    selectQuest(key: string, variant?: string): void {
        this.configManager.setConfiguration(QuestHelperConfig.group, "selectedQuest", key);
        this.configManager.setConfiguration(QuestHelperConfig.group, "helperVariant", variant ?? "");
        this.events.clear();
        this.assembly.clear();
        this.requiredVarbits.clear();
        this.faulted = false;
        this.lastSent = 0;
        this.itemDefinitionIds.clear();
        this.objectDefinitionIds.clear();
        this.npcDefinitionIds.clear();
        this.geometryRequested = false;
        this.session.select(key, variant);
        this.refreshHighlights();
    }
    retry(): void { this.faulted = false; this.events.clear(); this.assembly.clear(); this.lastSent = 0; this.session.restart("Reconnecting to Quest Helper…"); }
    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== QuestHelperConfig.group)
            return;
        const config = this.configManager.getConfig(QuestHelperConfig);
        this.session.select(config.selectedQuest(), config.helperVariant() || undefined);
        this.refreshHighlights();
    }
    onGameStateChanged(event: GameStateChanged): void {
        if ([GameState.LOGIN_SCREEN, GameState.LOGGING_IN, GameState.CONNECTION_LOST, GameState.HOPPING].includes(event.getGameState())) {
            this.session.update(null);
            this.clearRuntime();
        }
    }
    onChatMessage(event: ChatMessage): void { this.record({ type: "chatMessage", tick: this.tick, typeId: event.getType(), name: event.getName(), message: event.getMessage(), sender: event.getSender() }); }
    onPluginMessage(event: PluginMessage): void {
        if (event.channel !== "quest-helper" || !this.isStarted())
            return;
        if (!this.session.isCurrentMessage(event.data))
            return;
        try {
            const data = this.assembly.accept(event.data);
            if (!data)
                return;
            if (data.type === "catalog")
                this.session.acceptCatalog(data);
            else if (data.type === "result" && this.session.accept(data)) {
                this.pendingSince = 0;
                for (const request of this.getState().result?.requests ?? []) {
                    const kind = request.kind.split(".")[0];
                    if (kind === "varbit" || kind === "varbitDefinition")
                        this.requiredVarbits.add(request.id);
                    else if (kind === "itemDefinitions")
                        this.itemDefinitionIds.add(request.id);
                    else if (kind === "objectDefinitions")
                        this.objectDefinitionIds.add(request.id);
                    else if (kind === "npcDefinitions")
                        this.npcDefinitionIds.add(request.id);
                    else if (kind === "geometry")
                        this.geometryRequested = true;
                }
            }
            else if (data.type === "error")
                this.session.acceptError(data);
        }
        catch (error) {
            this.session.fail(error instanceof Error ? error.message : "Invalid Quest Helper response.");
        }
    }
    onGameTick(): void {
        if (!this.isStarted() || !this.isEnabled() || this.client.stateMachine.getState() !== 30)
            return;
        this.tick++;
        const account = this.client.localPlayerName;
        if (!account)
            return;
        if (account !== this.account) {
            this.detachSources();
            this.events.clear();
            this.requiredVarbits.clear();
            this.itemDefinitionIds.clear();
            this.objectDefinitionIds.clear();
            this.npcDefinitionIds.clear();
            this.geometryRequested = false;
            this.knownBank = false;
            this.account = account;
            this.faulted = false;
            this.lastSent = 0;
            this.snapshot = undefined;
            this.session.update(account);
        }
        if (!this.cleanupSources.length)
            this.attachSources();
        const now = Date.now();
        if (this.session.hasPendingEvaluation()) {
            if (now - this.pendingSince > 15000) {
                this.session.restart("Quest Helper timed out. Retrying…");
                this.events.clear();
            }
            else
                return;
        }
        if (this.faulted || now - this.lastSent < 1000)
            return;
        try {
            const selected = this.getState().catalog?.quests.find(quest => quest.questKey === this.getState().selected && quest.helperVariant === this.getState().variant);
            for (const id of selected?.requiredVarbits ?? [])
                this.requiredVarbits.add(id);
            const skills = getLatestSkills();
            if (!skills)
                throw new Error("Waiting for server skill state.");
            const snapshot = collectQuestHelperSnapshot(this.client, this.tick, ClientState, skills.skills, this.requiredVarbits);
            for (const item of [...snapshot.inventory, ...snapshot.equipment])
                this.itemDefinitionIds.add(item.id);
            const definitions = collectQuestHelperDefinitions(this.client, { items: this.itemDefinitionIds, objects: this.objectDefinitionIds, npcs: this.npcDefinitionIds });
            const weight=getLatestRunEnergy()?.weight;
            const mouse=this.client.inputManager?{x:this.client.inputManager.mouseX,y:this.client.inputManager.mouseY}:undefined;
            this.snapshot = { ...snapshot, ...definitions, mouse, weight, combatLevel:skills.combatLevel, bank: this.knownBank ? snapshot.bank : undefined, containers: { 93: snapshot.inventory, 94: snapshot.equipment, ...(this.knownBank ? { 95: snapshot.bank ?? [] } : {}) }, localPlayer: { ...snapshot.localPlayer, weight, combatLevel: skills.combatLevel }, geometry: this.geometryRequested ? collectQuestHelperGeometry(this.client, ClientState, true) : { x: 0, y: 0, mouse, width: this.client.renderer.canvas.width, height: this.client.renderer.canvas.height } };
            const events = this.events.drain();
            events.push({ type: "gameTick", tick: this.tick });
            this.lastSent = now;
            this.pendingSince = now;
            this.session.update(account, this.snapshot, events);
            this.refreshHighlights();
        }
        catch (error) {
            this.session.fail(error instanceof Error ? error.message : "Quest Helper snapshot is unavailable.");
            this.highlights.clear();
        }
    }
    renderHud(): ReactNode { return createElement(QuestHelperOverlay, { plugin: this }); }
    private signal(data: unknown): void {
        for (const frame of encodeChunkedPluginMessage(data as Record<string, unknown>))
            send({ type: "plugin_message", payload: { channel: "quest-helper", data: frame } });
    }
    private record(event: OrderedClientEvent): void {
        if (!this.account || this.faulted)
            return;
        try {
            this.events.push(event);
        }
        catch (error) {
            this.faulted = true;
            this.session.fail((error as Error).message);
            this.highlights.clear();
        }
    }
    private cleanupSources: (() => void)[] = [];
    private listen<T>(listeners: Set<T>, listener: T): void { listeners.add(listener); this.cleanupSources.push(() => listeners.delete(listener)); }
    private attachSources(): void {
        this.listen(this.client.varManager.varpChangeListeners, (id: number, oldValue: number, value: number) => this.record({ type: "varbitChanged", tick: this.tick, varpId: id, oldValue, value }));
        this.cleanupSources.push(this.client.inventory.subscribe(() => this.record({ type: "itemContainerChanged", tick: this.tick, containerId: 93 })));
        this.cleanupSources.push(this.client.equipment.subscribe(() => this.record({ type: "itemContainerChanged", tick: this.tick, containerId: 94 })));
        this.cleanupSources.push(subscribeBank(() => { this.knownBank = true; this.record({ type: "itemContainerChanged", tick: this.tick, containerId: 95 }); }));
        this.listen(this.client.npcEcs.mutationListeners, event => {
            const names = { spawn: "npcSpawned", despawn: "npcDespawned", composition: "npcChanged", animation: "animationChanged", interacting: "interactingChanged", overhead: "overheadTextChanged", appearance: "npcChanged" };
            try {
                const npc=collectHelperNpc(this.client, event.index);
                this.record({ type: names[event.kind], tick: this.tick, index:npc.index, ecsIndex:event.index, npc, oldId: event.kind === "appearance" ? npc.id : event.oldId, text: event.text });
            }
            catch {
                this.record({ type: names[event.kind], tick: this.tick, ecsIndex: event.index });
            }
        });
        this.listen(this.client.groundItems.mutationListeners, event => this.record({ type: event.kind === "spawn" ? "itemSpawned" : event.kind === "despawn" ? "itemDespawned" : "itemQuantityChanged", tick: this.tick, oldQuantity: event.oldQuantity, item: { id: event.stack.itemId, quantity: event.stack.quantity, x: event.stack.tile.x, y: event.stack.tile.y, plane: event.stack.tile.level } }));
        this.listen(this.client.widgetManager.groupLoadedListeners, (groupId: number) => this.record({ type: "widgetLoaded", tick: this.tick, groupId }));
        this.listen(this.client.widgetManager.interfaceClosedListeners, (groupId: number) => this.record({ type: "widgetClosed", tick: this.tick, groupId }));
    }
    private detachSources(): void { for (const cleanup of this.cleanupSources)
        cleanup(); this.cleanupSources = []; }
    private clearRuntime(): void { this.detachSources(); this.events.clear(); this.assembly.clear(); this.highlights.clear(); this.snapshot = undefined; this.account = ""; this.knownBank = false; this.pendingSince = 0; this.lastSent = 0; this.requiredVarbits.clear(); this.itemDefinitionIds.clear(); this.objectDefinitionIds.clear(); this.npcDefinitionIds.clear(); }
    private refreshHighlights(): void {
        const state = this.getState();
        const config = this.getConfig();
        if (!this.isStarted() || !this.isEnabled() || !config.highlightTiles || state.result?.status !== "active" || !this.snapshot) {
            this.highlights.clear();
            return;
        }
        this.highlights.replace(resolveTargetTiles(state.result.activeStep?.targets ?? [], this.snapshot, this.snapshot.plane), config.highlightColor);
    }
}
