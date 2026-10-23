import { HPBAR_HUD_NPC } from "@runelite/api/gameval/VarPlayerID";
import { HPBAR_HUD_BASEHP, HPBAR_HUD_BOSS_DISABLED, HPBAR_HUD_HP } from "@runelite/api/gameval/VarbitID";
import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import type { CacheInfo } from "../../../rs/cache/CacheInfo";
import { ConfigType } from "../../../rs/cache/ConfigType";
import { IndexType } from "../../../rs/cache/IndexType";
import { ArchiveHealthBarDefinitionLoader } from "../../../rs/config/healthbar/HealthBarDefinitionLoader";
import type { NpcType } from "../../../rs/config/npctype/NpcType";
import { decodeInteractionIndex } from "../../../rs/interaction/InteractionIndex";
import { MenuTargetType } from "../../../rs/MenuEntry";
import { FONT_PLAIN_12 } from "../../../ui/fonts";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { OsrsClient } from "../../OsrsClient";
import type {
    ClientPlugin,
    HealthBarEvent,
    WidgetOverlay,
    WidgetOverlayDrawContext,
} from "../ClientPluginManager";
import {
    HITPOINTS_DISPLAY_STYLES,
    type ActorRef,
    type HitpointsDisplayStyle,
    OpponentTracker,
    bossBarText,
    healthBarLabel,
    sameActor,
} from "./opponentInfo";

/**
 * Port of RuneLite's Opponent Information: the name and health of whoever the player is
 * fighting, in a panel at the top left of the game view (Alt-drag moves it).
 *
 * Not ported: players' hitpoints as a number and the player comparison panel both come from
 * the OSRS hiscores, which this server doesn't have, so players show a percentage.
 */

type Rgba = [number, number, number, number];
const rgba = (r: number, g: number, b: number, a = 255): Rgba => [r / 255, g / 255, b / 255, a / 255];

// RuneLite's ComponentConstants and OpponentInfoOverlay colours.
const BACKGROUND = rgba(70, 61, 50, 156);
const OUTLINE = rgba(56, 48, 35, 255);
const HP_GREEN = rgba(0, 146, 54, 230);
const HP_RED = rgba(102, 15, 16, 230);
const STANDARD_WIDTH = 129;
const BORDER = 2;
const GAP = 2;
const TITLE_HEIGHT = 16;
const BAR_HEIGHT = 16;
// The game view by top level (548 fixed, 161 resizable, 164 resizable modern).
const VIEWPORTS: Record<number, number> = {
    548: (548 << 16) | 26,
    161: (161 << 16) | 91,
    164: (164 << 16) | 88,
};

/** The boss health bar (hpbar_hud) and the script that writes its text. */
const HP_HUD_TEXT = (303 << 16) | 21;
const SCRIPT_HP_HUD_UPDATE = 2103;
/** npc param: the name the boss health bar shows ("Dagannoth Kings (Echo)"). */
const PARAM_NPC_HP_NAME = 510;

const MAX_REMEMBERED_BARS = 512;

export const OpponentInfoConfig = ConfigGroup("opponentinfo", {
    hitpointsDisplayStyle: ConfigItem({
        name: "Display style",
        description: "Show opponent's hitpoints as a value (if known), percentage, or both.",
        position: 1,
        enum: HITPOINTS_DISPLAY_STYLES,
        default: "hitpoints" as HitpointsDisplayStyle,
    }),
    showOpponentsInMenu: ConfigItem({
        name: "Show opponents in menu",
        description: "Marks opponents names in the menu which you are attacking or are attacking you (NPC only).",
        position: 2,
        default: false,
    }),
    showOpponentHealthOverlay: ConfigItem({
        name: "Show opponent health overlay",
        description: "Shows a health bar overlay when a boss health overlay is not present.",
        position: 3,
        default: true,
    }),
});

type Bar = { ratio: number; scale: number };
type Rect = { x: number; y: number; w: number; h: number };
type Panel = { name: string; bar?: Bar; maxHealth?: number };

export class OpponentInfoPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Opponent Information",
        description: "Show name and hitpoints information about the NPC you are fighting",
        tags: ["combat", "health", "hitpoints", "npcs", "overlay"],
        configKey: "opponentinfoplugin",
    };

    static config = OpponentInfoConfig;

    private readonly config = inject(ConfigManager).getConfig(OpponentInfoConfig);
    private readonly osrsClient: OsrsClient;
    private readonly tracker = new OpponentTracker();
    /** Each actor's latest health bar, by "npc:12" / "player:3". */
    private readonly bars = new Map<string, Bar>();
    private barScales?: Map<number, number>;
    /** What the panel shows: kept after the opponent despawns, as RuneLite keeps its last values. */
    private panel?: Panel;
    private panelFor?: ActorRef;

    readonly widgetOverlay: WidgetOverlay = {
        signature: () => {
            const layout = this.layout();
            if (!layout) return "";
            const { anchor, panel, label } = layout;
            return [
                anchor._absX, anchor._absY, anchor._absWidth, anchor._absHeight,
                panel.name, label?.text ?? "", label?.value ?? -1,
            ].join(",");
        },
        draw: (context) => this.draw(context),
        movable: { name: "OpponentInfoOverlay", position: OverlayPosition.TOP_LEFT },
    };

    constructor(osrsClient?: OsrsClient) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
    }

    protected override async shutDown(): Promise<void> {
        this.tracker.reset();
        this.panel = undefined;
        this.panelFor = undefined;
    }

    onHealthBar(event: HealthBarEvent): void {
        // A removed bar only hides it; the last values stay, as RuneLite's overlay keeps them.
        if (event.bar.removed) return;
        const scale = this.barScale(event.bar.id);
        if (!(scale > 0)) return;
        const key = `${event.type}:${event.serverId}`;
        this.bars.delete(key);
        this.bars.set(key, { ratio: event.bar.health2, scale });
        if (this.bars.size > MAX_REMEMBERED_BARS) this.bars.delete(this.bars.keys().next().value!);
    }

    onScriptFinished(scriptId: number): void {
        if (scriptId !== SCRIPT_HP_HUD_UPDATE || !this.isStarted()) return;
        const manager = this.osrsClient.widgetManager;
        const vars = this.osrsClient.varManager;
        const widget: any = manager?.getWidgetByUid(HP_HUD_TEXT);
        if (!widget || !vars) return;
        const text = bossBarText(
            String(widget.text ?? ""),
            vars.getVarbit(HPBAR_HUD_HP),
            vars.getVarbit(HPBAR_HUD_BASEHP),
            this.config.hitpointsDisplayStyle(),
        );
        if (text === undefined || text === widget.text) return;
        widget.text = text;
        manager.invalidateWidgetRender(widget, "opponent-info");
    }

    transformMenuEntries(entries: SimpleMenuEntry[]): SimpleMenuEntry[] {
        if (!this.isStarted() || !this.config.showOpponentsInMenu()) return entries;
        const me = this.osrsClient.controlledPlayerServerId | 0;
        const opponent = this.tracker.lastOpponent;
        let marked: SimpleMenuEntry[] | undefined;
        entries.forEach((entry, i) => {
            if (entry.option !== "Attack" || entry.targetType !== MenuTargetType.NPC) return;
            const serverId = entry.npcServerId;
            if (serverId === undefined) return;
            const attackingMe = this.npcTarget(serverId);
            const isOpponent =
                (attackingMe?.type === "player" && attackingMe.serverId === me) ||
                sameActor(opponent, { type: "npc", serverId });
            if (!isOpponent) return;
            marked ??= entries.slice();
            marked[i] = { ...entry, target: `*${entry.target ?? ""}` };
        });
        return marked ?? entries;
    }

    /** The panel to draw and where, or nothing. */
    private layout() {
        if (!this.isStarted()) return undefined;
        const opponent = this.tracker.update(this.localTarget(), performance.now());
        if (!opponent) {
            this.panel = undefined;
            this.panelFor = undefined;
            return undefined;
        }
        this.refreshPanel(opponent);
        const panel = this.panel;
        if (!panel || !this.config.showOpponentHealthOverlay() || this.hasHpHud(opponent)) {
            return undefined;
        }
        const anchor = this.viewport();
        if (!anchor) return undefined;
        const label = panel.bar
            ? healthBarLabel(panel.bar.ratio, panel.bar.scale, panel.maxHealth, this.config.hitpointsDisplayStyle())
            : undefined;
        return { anchor, panel, label };
    }

    /** Follows the opponent's name and bar while it is in view (RuneLite: while it shows a bar). */
    private refreshPanel(opponent: ActorRef): void {
        if (!sameActor(opponent, this.panelFor)) {
            this.panel = undefined;
            this.panelFor = opponent;
        }
        const bar = this.bars.get(`${opponent.type}:${opponent.serverId}`);
        if (!bar) return;
        const identity = opponent.type === "npc" ? this.npcIdentity(opponent.serverId) : this.playerIdentity(opponent.serverId);
        if (!identity) return;
        this.panel = { ...identity, bar };
    }

    private npcIdentity(serverId: number): Omit<Panel, "bar"> | undefined {
        const type = this.npcType(serverId);
        if (!type) return undefined;
        const longName = type.transformed?.params?.get(PARAM_NPC_HP_NAME);
        const name = typeof longName === "string" && longName ? longName : stripTags(type.transformed?.name ?? type.base.name);
        if (!name || name === "null") return undefined;
        const hitpoints = [type.transformed?.hitpoints, type.base.hitpoints].find((hp) => hp !== undefined && hp > 0);
        return { name, maxHealth: hitpoints };
    }

    private playerIdentity(serverId: number): Omit<Panel, "bar"> | undefined {
        const ecs = this.osrsClient.playerEcs;
        const index = ecs.getIndexForServerId(serverId);
        const name = index !== undefined ? ecs.getName(index) : undefined;
        return name ? { name: stripTags(name) } : undefined;
    }

    private npcType(serverId: number): { base: NpcType; transformed?: NpcType } | undefined {
        const client = this.osrsClient;
        const ecsId = client.npcEcs.getEcsIdForServer(serverId);
        if (ecsId === undefined || !client.npcTypeLoader) return undefined;
        const base = client.npcTypeLoader.load(client.npcEcs.getNpcTypeId(ecsId) | 0);
        if (!base) return undefined;
        const transformed = base.transforms && client.varManager
            ? base.transform(client.varManager, client.npcTypeLoader)
            : base;
        return { base, transformed };
    }

    /** What the local player is interacting with. */
    private localTarget(): ActorRef | undefined {
        const client = this.osrsClient;
        const index = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId | 0);
        if (index === undefined) return undefined;
        return toActorRef(client.playerEcs.getInteractionIndex(index));
    }

    /** What an NPC is interacting with. */
    private npcTarget(serverId: number): ActorRef | undefined {
        const ecs = this.osrsClient.npcEcs;
        const ecsId = ecs.getEcsIdForServer(serverId);
        return ecsId === undefined ? undefined : toActorRef(ecs.getInteractionIndex(ecsId));
    }

    /** The boss health bar shows this NPC: it says more than the panel would, so the panel steps aside. */
    private hasHpHud(opponent: ActorRef): boolean {
        const vars = this.osrsClient.varManager;
        if (opponent.type !== "npc" || !vars || vars.getVarbit(HPBAR_HUD_BOSS_DISABLED) !== 0) return false;
        const hudNpc = vars.getVarp(HPBAR_HUD_NPC);
        const type = this.npcType(opponent.serverId);
        return hudNpc !== -1 && !!type && (hudNpc === type.base.id || hudNpc === type.transformed?.id);
    }

    private viewport(): any {
        const client = this.osrsClient;
        const manager = client.widgetManager;
        if (!manager) return undefined;
        const uid = VIEWPORTS[manager.rootInterface];
        if (uid === undefined) return undefined;
        const anchor: any = manager.getWidgetByUid(uid);
        if (!anchor || manager.isEffectivelyHidden(uid) || !(anchor._absWidth > 0)) return undefined;
        return anchor;
    }

    /** A health bar definition's width: the ratio's scale. */
    private barScale(definitionId: number): number {
        if (!this.barScales) {
            const client = this.osrsClient;
            const cacheSystem = client.cacheSystem;
            const cacheInfo = client.loadedCache?.info as CacheInfo | undefined;
            if (!cacheSystem || !cacheInfo) return 0;
            const configs = cacheSystem.getIndex(IndexType.DAT2.configs);
            if (!configs.archiveExists(ConfigType.OSRS.healthBar)) return 0;
            const archive = configs.getArchive(ConfigType.OSRS.healthBar);
            const loader = new ArchiveHealthBarDefinitionLoader(cacheInfo, archive);
            const scales = new Map<number, number>();
            for (const id of archive.fileIds as Iterable<number>) {
                try {
                    const def = loader.load(id);
                    if (def) scales.set(id, def.width);
                } catch {}
            }
            this.barScales = scales;
        }
        return this.barScales.get(definitionId) ?? 0;
    }

    private draw(context: WidgetOverlayDrawContext): Rect[] {
        const layout = this.layout();
        if (!layout) return [];
        const { panel, label } = layout;
        const glr = context.renderer;
        const font = context.fontLoader(FONT_PLAIN_12);
        const nameWidth = font ? font.measure(panel.name) : 0;
        const width = Math.max(STANDARD_WIDTH, nameWidth + 2 * (BORDER + 3));
        const height = 2 * BORDER + TITLE_HEIGHT + (label ? GAP + BAR_HEIGHT : 0);
        const at = context.place(this.widgetOverlay, width, height);
        if (!at) return [];
        const { scaleX: sx, scaleY: sy } = at;
        const r = { x: at.x, y: at.y, w: width * sx, h: height * sy };

        // BackgroundComponent: a translucent fill in a darker outline.
        glr.drawRect(r.x, r.y, r.w, r.h, BACKGROUND);
        glr.drawRect(r.x, r.y, r.w, sy, OUTLINE);
        glr.drawRect(r.x, r.y + r.h - sy, r.w, sy, OUTLINE);
        glr.drawRect(r.x, r.y + sy, sx, r.h - 2 * sy, OUTLINE);
        glr.drawRect(r.x + r.w - sx, r.y + sy, sx, r.h - 2 * sy, OUTLINE);

        const innerX = r.x + BORDER * sx;
        const innerW = (width - 2 * BORDER) * sx;
        let y = r.y + BORDER * sy;
        drawTextGL(
            glr, context.fontLoader, panel.name,
            innerX, y, innerW, TITLE_HEIGHT * sy,
            FONT_PLAIN_12, 0xffffff, 1, 1, true, 1, undefined, sx, sy,
        );
        y += (TITLE_HEIGHT + GAP) * sy;

        if (label) {
            const barH = BAR_HEIGHT * sy;
            const ratio = label.maximum > 0 ? Math.min(1, Math.max(0, label.value / label.maximum)) : 0;
            const filled = Math.round(innerW * ratio);
            glr.drawRect(innerX, y, innerW, barH, HP_RED);
            if (filled > 0) glr.drawRect(innerX, y, filled, barH, HP_GREEN);
            drawTextGL(
                glr, context.fontLoader, label.text,
                innerX, y, innerW, barH,
                FONT_PLAIN_12, 0xffffff, 1, 1, true, 1, undefined, sx, sy,
            );
        }
        return [r];
    }
}

function toActorRef(interactionIndex: number): ActorRef | undefined {
    if ((interactionIndex | 0) < 0) return undefined;
    const decoded = decodeInteractionIndex(interactionIndex | 0);
    return decoded ? { type: decoded.type, serverId: decoded.id | 0 } : undefined;
}

function stripTags(text: string): string {
    return text.replace(/<[^>]*>/g, "");
}
