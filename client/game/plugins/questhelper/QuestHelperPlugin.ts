import { createElement, type ReactNode } from "react";
import { ChatMessage, ConfigChanged, GameStateChanged, PluginChanged, PluginMessage } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { encodeChunkedPluginMessage, ChunkedPluginMessageAssembler } from "../../../common/network/ChunkedPluginMessages";
import { send } from "../../../network/serverConnection/connection/send";
import { getLatestSkills, getLatestRunEnergy, subscribeBank } from "../../../network/ServerConnection";
import type { OsrsClient } from "../../OsrsClient";
import { ClientState } from "../../ClientState";
import type { HelperPluginMessage, OrderedClientEvent, ReadonlyClientSnapshot } from "./QuestHelperProtocol";
import { ENGINE_CONFIG_KEYS, LEGACY_CONFIG_KEYS, QuestHelperConfig } from "./QuestHelperConfig";
import type { LocOutline, NpcOutline, ScriptCallbackEvent, WidgetOverlay } from "../ClientPluginManager";
import type { Cs2Vm } from "../../../rs/cs2/Cs2Vm";
import type { WidgetActionEvent } from "../../widgets/widgetActionPayload";
import { osrsBankTagsClient } from "../banktags/bankClient";
import { QuestHelperBankTab } from "./QuestHelperBankTab";
import { QuestHelperGrandExchange, SEARCHBOX_LOADED } from "./QuestHelperGrandExchange";
import { MESLAYERINPUT } from "@runelite/api/gameval/VarClientID";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import type { MenuTransformContext } from "../../../ui/menu/menuTransforms";
import { applyChoiceRules, QuestHelperItemOverlay, QuestHelperPanelOverlay, QuestHelperSceneOverlay, questLocOutlines, questNpcOutlines, type OverlaySettings, type OverlaySource } from "./QuestHelperOverlays";
import { questListMenuEntries, QUEST_LIST_GROUP } from "./QuestHelperMenus";
import { setQuestWorldMapPoint } from "./QuestHelperWorldMap";
import { ASSISTANCE_LEVELS, FILTER_SKILLS, type AssistanceLevel } from "./QuestHelperOrdering";
import { QuestHelperSession } from "./QuestHelperSession";
import { QuestHelperEvents } from "./QuestHelperEvents";
import { collectHelperNpc, collectQuestHelperSnapshot } from "./QuestHelperSnapshot";
import { OwnedTileHighlights, resolveTargetTiles } from "./QuestHelperHighlights";
import { createQuestHelperNavigationButton, QuestHelperOverlay } from "./QuestHelperPanel";
import { collectQuestHelperDefinitions } from "./QuestHelperDefinitions";
import { collectQuestHelperGeometry, collectQuestHelperTerrain } from "./QuestHelperGeometry";
import { SnapshotReuse } from "./QuestHelperReuse";
import {OwnedQuestHintArrow,questDirection} from "./QuestHelperNavigation";
/** QuestHelperConfig.QUEST_BACKGROUND_GROUP: per-profile state the sidebar keeps. */
const BACKGROUND_GROUP = "questhelpervars";
export type QuestHelperSettings = OverlaySettings & {
    autoStartQuests: boolean; autoOpenSidebar: boolean; stewBoosts: boolean; showFullRequirements: boolean; hideQuestRewards: boolean;
    outlineFeathering: number; showMiniMapArrow: boolean; haveMinimapArrowFlash: boolean; showWorldLines: boolean; showWidgetHints: boolean;
    solvePuzzles: boolean; showWorldMapPoint: boolean; useShortestPath: boolean; passColour: number; failColour: number; partialSuccessColour: number; boostColour: number;
    orderListBy: string; filterListBy: string; difficulty: string; showCompletedQuests: boolean;
};
export class QuestHelperPlugin extends Plugin {
    static descriptor: PluginDescriptor = { name: "Quest Helper", description: "Read-only guided quest steps, requirements and highlights from the local Quest Helper engine.", tags: ["quests", "guide", "offline"], enabledByDefault: false, configKey: "questhelperplugin" };
    static config = QuestHelperConfig;
    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private readonly configManager = inject(ConfigManager);
    private readonly eventBus = inject(EventBus);
    private readonly toolbar = inject(ClientToolbar);
    /** Whether the engine last asked Shortest Path for a route (so stopping can clear it). */
    private routeShown = false;
    /** The route last shown, replayed when Shortest Path starts after the step posted it. */
    private lastRoute?: HelperPluginMessage;
    /** QuestBankTab: the "quest-helper" bank tab. */
    private readonly bankTab = new QuestHelperBankTab(osrsBankTagsClient(this.client), {
        selectedQuestName: () => this.bankTabQuestName(),
        bankTab: () => this.getState().result?.bankTab,
        sendChatMessage: message => this.client.addGameMessage?.(message),
    });
    private lastBankTab = "";
    /** QuestGrandExchangeInterface: "View missing items" by the Grand Exchange's item search. */
    private readonly grandExchange = new QuestHelperGrandExchange(osrsBankTagsClient(this.client), {
        selectedQuestName: () => this.bankTabQuestName(),
        solvePuzzles: () => this.getConfig().solvePuzzles,
        stepItems: () => this.getState().result?.activeStep?.geItems,
        missingItems: () => this.getState().result?.bankTab?.missingItems,
        playerLocation: () => {
            const tile = this.client.getControlledPlayerMovementTile?.();
            return tile ? { x: tile.tileX, y: tile.tileY, plane: ClientState.plane } : undefined;
        },
    });
    private readonly onItemSearch = () => (this.isStarted() && this.isEnabled() ? this.guardBankTab(() => this.grandExchangeSearched()) ?? false : false);
    private scriptVm?: Cs2Vm;
    private readonly onScriptPre = (id: number) => { if (this.isStarted() && this.isEnabled()) this.guardBankTab(() => this.bankTab.onScriptPreFired(id)); };
    private readonly session = new QuestHelperSession(data => this.signal(data));
    private readonly assembly = new ChunkedPluginMessageAssembler();
    /** Large, rarely changing snapshot sections the server already holds (sent by digest). */
    private readonly reuse = new SnapshotReuse();
    private readonly events = new QuestHelperEvents();
    private readonly highlights = new OwnedTileHighlights(this.client.tileHighlightManager, 60001);
    private readonly navigation = new OwnedQuestHintArrow();
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
    private readonly overlaySource: OverlaySource = {
        active: () => this.isStarted() && this.isEnabled() && this.getState().result?.status === "active" && !!this.snapshot,
        step: () => this.getState().result?.activeStep,
        snapshot: () => this.snapshot,
        settings: () => this.getConfig(),
        client: () => this.client,
        overlayPanel: () => this.getState().result?.overlayPanel,
    };
    private readonly overlays: WidgetOverlay[] = [new QuestHelperSceneOverlay(this.overlaySource), new QuestHelperItemOverlay(this.overlaySource), new QuestHelperPanelOverlay(this.overlaySource)];
    subscribe = this.session.subscribe;
    getState = this.session.getState;
    getSnapshot(): ReadonlyClientSnapshot | undefined { return this.snapshot; }
    getDirection() {
        if(!this.getConfig().showMiniMapArrow || this.getState().result?.status!=="active" || !this.snapshot)return null;
        const tile=this.client.getControlledPlayerMovementTile();
        if(!tile)return null;
        const targets=this.getState().result?.activeStep?.targets??[];
        const npcs=this.snapshot.npcs.map(npc=>{
            if(!targets.some(t=>t.kind==='npc'&&(t.id===(npc.transformedId??npc.id)||t.ids?.includes(npc.transformedId??npc.id))))return npc;
            try{return collectHelperNpc(this.client,npc.ecsIndex);}catch{return npc;}
        });
        return questDirection(this.getState().result?.activeStep,{...this.snapshot,npcs,localPlayer:{...this.snapshot.localPlayer,x:tile.tileX,y:tile.tileY,plane:ClientState.plane}});
    }
    onPostClientTick():void {
        this.listenForScripts();
        this.refreshNavigation();
        const config=this.getConfig();
        const step=this.overlaySource.active()?this.getState().result?.activeStep:undefined;
        const mouse=this.client.inputManager?{x:this.client.inputManager.mouseX,y:this.client.inputManager.mouseY}:undefined;
        if(config.showTextHighlight&&step?.choiceRules?.length)applyChoiceRules(this.client.widgetManager,step.choiceRules,config.textHighlightColor,mouse);
        setQuestWorldMapPoint(this.client,config.showWorldMapPoint&&step?this.getDirection()?.target:undefined,config.targetOverlayColor);
    }
    widgetOverlays(): WidgetOverlay[] { return this.isStarted() && this.isEnabled() ? this.overlays : []; }
    npcOutlines(): NpcOutline[] { return questNpcOutlines(this.overlaySource); }
    locOutlines(): LocOutline[] { return questLocOutlines(this.overlaySource); }
    /** QuestMenuHandler: Start/Stop Quest Helper on a quest of the quest list. */
    transformMenuEntries(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
        if (!this.isStarted() || !this.isEnabled() || context.surface !== "widget" || !context.menu || (context.widgetId >>> 16) !== QUEST_LIST_GROUP) return entries;
        const state = this.getState();
        return questListMenuEntries(entries, state.catalog?.quests ?? [], state.selected, state.variant, (key, variant) => this.selectQuest(key, variant));
    }
    /** Marks a sidebar section complete or incomplete (QuestStepPanel's lock box). */
    lockSection(section: number, locked: boolean): void { this.session.lockSection(section, locked); }
    private refreshNavigation():void {
        this.navigation.update(this.isStarted()&&this.isEnabled()&&Date.now()-this.lastSent<15000?this.getDirection():null);
    }
    getConfig(): QuestHelperSettings {
        const c = this.configManager.getConfig(QuestHelperConfig);
        return {
            autoStartQuests: c.autoStartQuests(), autoOpenSidebar: c.autoOpenSidebar(), showOverlay: c.showOverlay(), stewBoosts: c.stewBoosts(),
            showFullRequirements: c.showFullRequirements(), hideQuestRewards: c.hideQuestRewards(), showTextHighlight: c.showTextHighlight(),
            showSymbolOverlay: c.showSymbolOverlay(), highlightStyleNpcs: String(c.highlightStyleNpcs()), highlightStyleObjects: String(c.highlightStyleObjects()),
            highlightStyleGroundItems: String(c.highlightStyleGroundItems()), highlightStyleInventoryItems: String(c.highlightStyleInventoryItems()),
            outlineThickness: Number(c.outlineThickness()), outlineFeathering: Number(c.outlineFeathering()), showMiniMapArrow: c.showMiniMapArrow(),
            haveMinimapArrowFlash: c.haveMinimapArrowFlash(), showWorldLines: c.showWorldLines(), showWidgetHints: c.showWidgetHints(), solvePuzzles: c.solvePuzzles(),
            showWorldMapPoint: c.showWorldMapPoint(), useShortestPath: c.useShortestPath(), textHighlightColor: c.textHighlightColor() >>> 0, targetOverlayColor: c.targetOverlayColor() >>> 0,
            passColour: c.passColour() >>> 0, failColour: c.failColour() >>> 0, partialSuccessColour: c.partialSuccessColour() >>> 0, boostColour: c.boostColour() >>> 0,
            orderListBy: String(c.orderListBy()), filterListBy: String(c.filterListBy()), difficulty: String(c.difficulty()), showCompletedQuests: c.showCompletedQuests(),
        };
    }
    /** Writes one setting through the config manager (the sidebar's dropdowns and presets). */
    setConfig(key: keyof QuestHelperSettings, value: string | number | boolean): void {
        if (QuestHelperConfig.items[key]) this.configManager.setConfigValue(QuestHelperConfig, key, value);
    }
    /** AssistanceLevel.setTo*Assistance: writes a preset and remembers which one was chosen. */
    applyAssistance(level: AssistanceLevel): void {
        for (const [key, value] of Object.entries(ASSISTANCE_LEVELS[level])) this.setConfig(key as keyof QuestHelperSettings, value);
        this.configManager.setConfiguration(QuestHelperConfig.group, "assistanceLevel", level);
        this.configManager.setConfiguration(BACKGROUND_GROUP, "selected-assist-level", "true");
    }
    assistanceLevel(): string | undefined { return this.configManager.getConfiguration(QuestHelperConfig.group, "assistanceLevel"); }
    /** Upstream asks for an assistance level the first time a quest is opened. */
    assistanceChosen(): boolean { return this.configManager.getConfiguration(BACKGROUND_GROUP, "selected-assist-level") === "true"; }
    /** SkillIconButton: skills whose quests the list hides ("skillfilter<Skill>"). */
    filteredSkills(): Set<string> {
        return new Set(FILTER_SKILLS.filter(skill => this.configManager.getConfiguration(BACKGROUND_GROUP, `skillfilter${skill}`) === "true"));
    }
    setSkillFiltered(skill: string, filtered: boolean): void {
        this.configManager.setConfiguration(BACKGROUND_GROUP, `skillfilter${skill}`, filtered ? "true" : "false");
        this.session.touch();
    }
    /** QuestHelperConfig values the engine reads, by their upstream key names. */
    private engineConfig(): Record<string, boolean | number> {
        const settings = this.getConfig() as unknown as Record<string, boolean | number>;
        const out: Record<string, boolean | number> = {};
        for (const key of ENGINE_CONFIG_KEYS) out[QuestHelperConfig.items[key]?.keyName ?? key] = settings[key];
        return out;
    }
    /** One-shot copy of the earlier port's keys onto their upstream replacements. */
    private migrateLegacyConfig(): void {
        const group = QuestHelperConfig.group;
        for (const [legacy, current] of Object.entries(LEGACY_CONFIG_KEYS)) {
            const value = this.configManager.getConfiguration(group, legacy);
            if (value === undefined) continue;
            const item = QuestHelperConfig.items[current];
            const key = item?.keyName ?? current;
            if (this.configManager.getConfiguration(group, key) === undefined)
                this.configManager.setConfiguration(group, key, item?.color && /^#[0-9a-f]{6}$/i.test(value) ? `#ff${value.slice(1)}` : value);
            this.configManager.unsetConfiguration(group, legacy);
        }
        if (this.configManager.getConfiguration(group, "highlightTiles") === "false") {
            for (const key of ["highlightStyleNpcs", "highlightStyleObjects", "highlightStyleGroundItems"])
                if (this.configManager.getConfiguration(group, key) === undefined) this.configManager.setConfiguration(group, key, "NONE");
        }
        this.configManager.unsetConfiguration(group, "highlightTiles");
    }
    protected async startUp(): Promise<void> {
        this.migrateLegacyConfig();
        this.session.engineConfig = () => this.engineConfig();
        // The quest bank tab (and its missing items) is evaluated while the bank is open, or by the
        // Grand Exchange for its item search.
        this.session.wantsBankTab = () => !this.bankTab.isHidden() || !this.grandExchange.notAtGE();
        const config = this.configManager.getConfig(QuestHelperConfig);
        this.session.select(config.selectedQuest(), config.helperVariant() || undefined);
        this.nav = createQuestHelperNavigationButton(this);
        this.toolbar.addNavigation(this.nav);
        this.cleanup.push(this.session.subscribe(() => {this.refreshHighlights();this.refreshNavigation();}));
        this.faulted = false;
    }
    protected async shutDown(): Promise<void> {
        this.clearRoute();
        this.bankTab.destroy();
        this.grandExchange.destroy();
        this.scriptVm?.scriptPreListeners.delete(this.onScriptPre);
        this.scriptVm?.itemSearchListeners.delete(this.onItemSearch);
        this.scriptVm = undefined;
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
        // The old quest's steps shut down: DetailedQuestStep.removeShortestPath.
        this.clearRoute();
        this.session.select(key, variant);
        this.refreshHighlights();
        // QuestBankTab.shutDown, then startUp for the new quest.
        this.lastBankTab = "";
        this.bankTab.destroy();
        this.bankTab.init();
        this.grandExchange.destroy();
    }
    /** QuestHelperPlugin.getSelectedQuest().getQuest().getName(), or null with no quest selected. */
    private bankTabQuestName(): string | null {
        const state = this.getState();
        if (!state.selected) return null;
        return state.result?.overview?.name ?? state.catalog?.quests.find(q => q.questKey === state.selected)?.name ?? state.selected;
    }
    /** QuestBankTab.onGrandExchangeSearched: "quest-helper" searches list the quest's items. */
    private grandExchangeSearched(): boolean {
        const vm = this.scriptVm;
        if (!vm) return false;
        const input = String(this.client.varManager.getVarcString?.(MESLAYERINPUT) ?? "");
        const results = this.grandExchange.searchResults(input, id => this.client.objTypeLoader?.load?.(id)?.isTradable === true);
        if (!results) return false;
        vm.itemSearchIndex = 0;
        vm.itemSearchCount = results.length;
        vm.itemSearchResults = results;
        return true;
    }
    /** ScriptPreFired on the client's current VM (it builds its VM after plugins start). */
    private listenForScripts(): void {
        const vm = (this.client as any).cs2Vm as Cs2Vm | undefined;
        if (!vm || vm === this.scriptVm) return;
        this.scriptVm?.scriptPreListeners.delete(this.onScriptPre);
        this.scriptVm?.itemSearchListeners.delete(this.onItemSearch);
        vm.scriptPreListeners.add(this.onScriptPre);
        vm.itemSearchListeners.add(this.onItemSearch);
        this.scriptVm = vm;
    }
    onScriptFinished(scriptId: number): void {
        if (!this.isStarted() || !this.isEnabled()) return;
        this.guardBankTab(() => this.bankTab.onScriptPostFired(scriptId));
        if (scriptId === SEARCHBOX_LOADED) this.guardBankTab(() => this.grandExchange.init());
    }
    onScriptCallback(event: ScriptCallbackEvent): void {
        if (this.isStarted() && this.isEnabled()) this.guardBankTab(() => this.bankTab.onScriptCallback(event.eventName));
    }
    handleWidgetAction(event: WidgetActionEvent): boolean {
        if (!this.isStarted() || !this.isEnabled()) return false;
        return this.guardBankTab(() => this.bankTab.onMenuOptionClicked(event)) ?? false;
    }
    /** QuestHelperPlugin.refreshBank: the tab is laid out again when the quest's items change. */
    private refreshBankTab(): void {
        const tab = this.getState().result?.bankTab;
        if (!tab) return;
        const json = JSON.stringify(tab);
        if (json === this.lastBankTab) return;
        this.lastBankTab = json;
        this.guardBankTab(() => this.bankTab.refreshTab());
    }
    /** The bank tab never breaks the bank's own scripts. */
    private guardBankTab<T>(fn: () => T): T | undefined {
        try {
            return fn();
        } catch (error) {
            console.warn("[questhelper] bank tab failed", error);
            return undefined;
        }
    }
    /**
     * DetailedQuestStep's PluginMessage("shortestpath", "path" | "clear"): the engine runs upstream's
     * steps and returns what they posted, which goes to the Shortest Path plugin here.
     */
    private forwardPluginMessages(): void {
        for (const message of this.getState().result?.pluginMessages ?? []) {
            this.eventBus.post(new PluginMessage(message.namespace, message.name, message.data));
            this.routeShown = message.name === "path";
            this.lastRoute = message.name === "path" ? message : undefined;
        }
    }
    /** Shortest Path starts (or restarts) after a route was posted: the plugin message was delivered to nobody, so replay it. */
    onPluginChanged(event: PluginChanged): void {
        if (!event.isEnabled() || !this.routeShown || !this.lastRoute) return;
        if (event.getPlugin()?.getName?.() !== "Shortest Path") return;
        this.eventBus.post(new PluginMessage(this.lastRoute.namespace, this.lastRoute.name, this.lastRoute.data));
    }
    /** A route this helper asked for, cleared when its quest is closed (the engine isn't asked again). */
    private clearRoute(): void {
        if (!this.routeShown) return;
        this.routeShown = false;
        this.lastRoute = undefined;
        this.eventBus.post(new PluginMessage("shortestpath", "clear"));
    }
    retry(): void { this.faulted = false; this.events.clear(); this.assembly.clear(); this.lastSent = 0; this.session.restart("Reconnecting to Quest Helper…"); }
    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== QuestHelperConfig.group)
            return;
        const config = this.configManager.getConfig(QuestHelperConfig);
        this.session.select(config.selectedQuest(), config.helperVariant() || undefined);
        this.refreshHighlights();
        this.session.touch();
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
            if (data.type === "catalog") {
                const previous = this.getState().selected;
                if (this.session.acceptCatalog(data) && !previous && this.getState().selected === "learning_the_ropes" && this.nav)
                    this.toolbar.openPanel(this.nav);
                this.autoStart();
            }
            else if (data.type === "result") {
                const wasComplete=this.getState().result?.status==='complete';
                if(!this.session.accept(data))return;
                this.reuse.accept(this.session.currentSession(), data.cached);
                this.forwardPluginMessages();
                this.refreshBankTab();
                if(!wasComplete&&this.getState().result?.status==='complete'&&this.nav)this.toolbar.openPanel(this.nav);
                this.autoStart();
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
            else if (data.type === "error") {
                // Whatever the server held may be gone (a stale reuse, a restart): send full sections next.
                this.reuse.reset();
                this.session.acceptError(data);
            }
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
        if (!this.getState().selected) {
            // No quest: the session only polls the catalog by tick (QuestHelperSession); the scene isn't read.
            this.events.clear();
            this.session.update(account, { tick: this.tick } as ReadonlyClientSnapshot);
            this.refreshHighlights();
            return;
        }
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
            // The terrain is sampled with the snapshot but packed only when the server lacks it.
            const terrain = this.geometryRequested ? collectQuestHelperTerrain(this.client, ClientState) : undefined;
            this.snapshot = { ...snapshot, ...definitions, mouse, weight, combatLevel:skills.combatLevel, bank: this.knownBank ? snapshot.bank : undefined, containers: { 93: snapshot.inventory, 94: snapshot.equipment, ...(this.knownBank ? { 95: snapshot.bank ?? [] } : {}) }, localPlayer: { ...snapshot.localPlayer, weight, combatLevel: skills.combatLevel }, geometry: this.geometryRequested ? collectQuestHelperGeometry(this.client, ClientState, false) : { x: 0, y: 0, mouse, width: this.client.renderer.canvas.width, height: this.client.renderer.canvas.height } };
            const events = this.events.drain();
            events.push({ type: "gameTick", tick: this.tick });
            this.lastSent = now;
            this.pendingSince = now;
            // The session may open on this call; sections are then sent in full for it.
            this.session.update(account);
            this.session.update(account, this.reuse.prepare(this.session.currentSession(), this.snapshot, terrain), events);
            this.refreshHighlights();
        }
        catch (error) {
            this.session.fail(error instanceof Error ? error.message : "Quest Helper snapshot is unavailable.");
            this.highlights.clear();
        }
    }
    /** QuestManager's autostart: a quest just started in game becomes the guide, if none is. */
    private autoStart(): void {
        const started = this.session.takeStartedQuests();
        const config = this.getConfig();
        if (!config.autoStartQuests || !started.length) return;
        const state = this.getState();
        if (state.selected && state.result?.status !== "complete") return;
        const quest = state.catalog?.quests.find(q => q.questKey === started[0] && q.supported);
        if (!quest) return;
        this.selectQuest(quest.questKey, quest.helperVariant);
        if (config.autoOpenSidebar && this.nav) this.toolbar.openPanel(this.nav);
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
        this.listen(this.client.widgetManager.groupLoadedListeners, (groupId: number) => {
            this.record({ type: "widgetLoaded", tick: this.tick, groupId });
            if (groupId === 12) this.guardBankTab(() => this.bankTab.init());
        });
        this.listen(this.client.widgetManager.interfaceClosedListeners, (groupId: number, _modal: number, unload: boolean) => {
            this.record({ type: "widgetClosed", tick: this.tick, groupId });
            if (groupId === 12 && unload) this.bankTab.onBankClosed();
        });
    }
    private detachSources(): void { for (const cleanup of this.cleanupSources)
        cleanup(); this.cleanupSources = []; }
    private clearRuntime(): void { this.clearRoute(); setQuestWorldMapPoint(this.client, undefined, 0); this.detachSources(); this.events.clear(); this.assembly.clear(); this.highlights.clear(); this.navigation.clear(); this.snapshot = undefined; this.account = ""; this.knownBank = false; this.pendingSince = 0; this.lastSent = 0; this.requiredVarbits.clear(); this.itemDefinitionIds.clear(); this.objectDefinitionIds.clear(); this.npcDefinitionIds.clear(); }
    private refreshHighlights(): void {
        const state = this.getState();
        const config = this.getConfig();
        if (!this.isStarted() || !this.isEnabled() || state.result?.status !== "active" || !this.snapshot) {
            this.highlights.clear();
            return;
        }
        // DetailedQuestStep's tile highlights; NPC and ground-item tiles follow their style.
        const targets = (state.result.activeStep?.targets ?? []).filter(target =>
            target.kind === "tile" || (target.kind === "npc" && config.highlightStyleNpcs === "TILE") || (target.kind === "item" && config.highlightStyleGroundItems !== "NONE"));
        this.highlights.replace(resolveTargetTiles(targets, this.snapshot, this.snapshot.plane), config.targetOverlayColor & 0xffffff);
    }
}
