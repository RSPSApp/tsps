import { GameState } from "@runelite/api/GameState";
import type { ConfigChanged, GameStateChanged, NpcChanged, NpcDespawned, NpcSpawned } from "@runelite/api/events";
import { Notifier } from "@runelite/client/Notifier";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { baseNpcTypeId } from "../../../custom/npcs/NpcModelOverrideRegistry";
import { getEffectiveNpcType } from "../../../render/webgpu/actors/actorPacking";
import type { NpcType } from "../../../rs/config/npctype/NpcType";
import { toRuneLiteGameState } from "../../../runelite/impl/GameStateMapping";
import type { OsrsClient } from "../../OsrsClient";
import { stripTags } from "../npcindicators/npcMatching";
import { type Impling, type ImplingType, findImpling, implingTypeName } from "./Impling";
import { ImplingMode, ImplingsConfig } from "./ImplingsConfig";
import { ImplingsOverlay } from "./ImplingsOverlay";

/** A property of ImplingsConfig (the group's item names are plain strings to the type checker). */
type ConfigKey = keyof typeof ImplingsConfig.items;

/** Which config item holds each type's mode and colour (RuneLite's showImplingType / implingColor switches). */
const TYPE_CONFIG: Record<ImplingType, { mode: ConfigKey; color: ConfigKey }> = {
    BABY: { mode: "showBaby", color: "babyColor" },
    YOUNG: { mode: "showYoung", color: "youngColor" },
    GOURMET: { mode: "showGourmet", color: "gourmetColor" },
    EARTH: { mode: "showEarth", color: "earthColor" },
    ESSENCE: { mode: "showEssence", color: "essenceColor" },
    ECLECTIC: { mode: "showEclectic", color: "eclecticColor" },
    NATURE: { mode: "showNature", color: "natureColor" },
    MAGPIE: { mode: "showMagpie", color: "magpieColor" },
    NINJA: { mode: "showNinja", color: "ninjaColor" },
    CRYSTAL: { mode: "showCrystal", color: "crystalColor" },
    DRAGON: { mode: "showDragon", color: "dragonColor" },
    LUCKY: { mode: "showLucky", color: "luckyColor" },
};

/** RuneLite's HighlightedNpc as the Implings plugin builds it: tile and name, minimap name per config. */
export type HighlightedImpling = {
    ecsId: number;
    id: number;
    type: ImplingType;
    name: string;
    /** 0xAARRGGBB */
    color: number;
};

/**
 * RuneLite 1.13.5 Implings. Highlights implings (per type: off, highlight, or highlight and notify)
 * with a tile, their name and a minimap dot, and in Puro-Puro can mark the impling spawn points.
 */
export class ImplingsPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Implings",
        enabledByDefault: false,
        description: "Highlight nearby implings on the minimap and on-screen",
        tags: ["hunter", "minimap", "overlay", "imp"],
        configKey: "implingsplugin",
    };

    static config = ImplingsConfig;

    private readonly configManager = inject(ConfigManager);
    readonly config = this.configManager.getConfig(ImplingsConfig);
    private readonly osrsClient: OsrsClient;
    readonly notifier: Notifier;
    /** Highlighted implings by ECS id (RuneLite's NpcOverlayService highlights). */
    readonly highlightedNpcs = new Map<number, HighlightedImpling>();
    readonly widgetOverlay: ImplingsOverlay;

    constructor(osrsClient?: OsrsClient) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.notifier = new Notifier(this.osrsClient);
        this.widgetOverlay = new ImplingsOverlay(this);
    }

    protected async startUp(): Promise<void> {
        this.rebuild();
    }

    protected async shutDown(): Promise<void> {
        this.highlightedNpcs.clear();
    }

    getClient(): OsrsClient {
        return this.osrsClient;
    }

    /** The local player's tile (RuneLite's getLocalPlayer().getWorldLocation()), if known. */
    playerTile(): { x: number; y: number; plane: number } | undefined {
        const client: any = this.osrsClient;
        const players = client?.playerEcs;
        const index = players?.getIndexForServerId?.(client.controlledPlayerServerId);
        if (index === undefined) return undefined;
        return { x: players.getX(index) >> 7, y: players.getY(index) >> 7, plane: players.getLevel(index) | 0 };
    }

    // ------------------------------------------------------------------ config

    /** RuneLite's showImplingType. */
    showImplingType(type: ImplingType): ImplingMode {
        const value = String(this.config[TYPE_CONFIG[type].mode]());
        return value in ImplingMode ? (value as ImplingMode) : "NONE";
    }

    /** RuneLite's showImpling: highlighted when the mode is HIGHLIGHT or NOTIFY. */
    showImpling(impling: Impling): boolean {
        return this.showImplingType(impling.type) !== "NONE";
    }

    /** RuneLite's implingColor, as 0xAARRGGBB. */
    implingColor(type: ImplingType): number {
        return Number(this.config[TYPE_CONFIG[type].color]()) >>> 0;
    }

    // ------------------------------------------------------------------ npcs

    npcId(ecsId: number): number {
        return baseNpcTypeId(this.osrsClient.npcEcs.getNpcTypeId(ecsId) | 0);
    }

    npcType(ecsId: number): NpcType | undefined {
        const id = this.npcId(ecsId);
        return id >= 0 ? getEffectiveNpcType(this.osrsClient, id) : undefined;
    }

    /** RuneLite's isTarget: the highlight for an NPC, or undefined. */
    private target(ecsId: number): HighlightedImpling | undefined {
        const id = this.npcId(ecsId);
        const impling = findImpling(id);
        if (!impling || !this.showImpling(impling)) return undefined;
        const name = this.npcType(ecsId)?.name;
        return {
            ecsId,
            id,
            type: impling.type,
            name: name && name !== "null" ? stripTags(name) : `${implingTypeName(impling.type)} impling`,
            color: this.implingColor(impling.type),
        };
    }

    private refresh(ecsId: number): void {
        const target = this.target(ecsId);
        if (target) this.highlightedNpcs.set(ecsId, target);
        else this.highlightedNpcs.delete(ecsId);
    }

    /** NpcOverlayService.rebuild(): re-evaluates every loaded NPC. */
    rebuild(): void {
        this.highlightedNpcs.clear();
        const state = toRuneLiteGameState((this.osrsClient as any)?.gameState);
        if (state !== GameState.LOGGED_IN && state !== GameState.LOADING) return;
        const npcs = this.osrsClient.npcEcs;
        if (!npcs) return;
        for (const ecsId of npcs.getAllActiveIds()) {
            if (npcs.isLinked(ecsId)) this.refresh(ecsId);
        }
    }

    private notifyIfWanted(npcId: number): void {
        const impling = findImpling(baseNpcTypeId(npcId));
        if (impling && this.showImplingType(impling.type) === "NOTIFY") {
            this.notifier.notify(`${implingTypeName(impling.type)} impling is in the area`);
        }
    }

    // ------------------------------------------------------------------ events

    onNpcSpawned(event: NpcSpawned): void {
        const npc = event.getNpc();
        this.refresh(npc.ecsId);
        this.notifyIfWanted(npc.id);
    }

    onNpcChanged(event: NpcChanged): void {
        const npc = event.getNpc();
        this.refresh(npc.ecsId);
        this.notifyIfWanted(npc.id);
    }

    onNpcDespawned(event: NpcDespawned): void {
        this.highlightedNpcs.delete(event.getNpc().ecsId);
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if (state === GameState.LOGIN_SCREEN || state === GameState.HOPPING) this.highlightedNpcs.clear();
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === ImplingsConfig.group) this.rebuild();
    }
}
