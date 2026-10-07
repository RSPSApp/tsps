import { DISEASE, POISON, SA_ENERGY } from "@runelite/api/gameval/VarPlayerID";
import { PRAYER_ALLACTIVE, STAMINA_ACTIVE } from "@runelite/api/gameval/VarbitID";
import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { VARP_GAMEFRAME_317 } from "../../../common/ui/gameframeLayout";
import { FONT_PLAIN_11 } from "../../../ui/fonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { OsrsClient } from "../../OsrsClient";
import type { ClientPlugin, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";

/** Port of RuneLite's Status Bars: HP/prayer/etc. bars beside the inventory. */

type Rgba = [number, number, number, number];
const rgba = (r: number, g: number, b: number, a = 255): Rgba => [r / 255, g / 255, b / 255, a / 255];

const BACKGROUND = rgba(0, 0, 0, 150);
const HEALTH_COLOR = rgba(225, 35, 0, 125);
const POISONED_COLOR = rgba(0, 145, 0, 150);
const VENOMED_COLOR = rgba(0, 65, 0, 150);
const DISEASE_COLOR = rgba(255, 193, 75, 181);
const PRAYER_COLOR = rgba(50, 200, 200, 175);
const ACTIVE_PRAYER_COLOR = rgba(57, 255, 186, 225);
const ENERGY_COLOR = rgba(199, 174, 0, 220);
const RUN_STAMINA_COLOR = rgba(160, 124, 72, 255);
const SPECIAL_ATTACK_COLOR = rgba(3, 153, 0, 195);

// SpriteID.OrbIcon
const HITPOINTS_ICON = 1067;
const PRAYER_ICON = 1068;
const WALK_ICON = 1069;
const SPECIAL_ICON = 1610;

const SKILL_HITPOINTS = 3;
const SKILL_PRAYER = 5;

const BAR_WIDTH = 20;
const HEIGHT = 252;
const RESIZED_BOTTOM_HEIGHT = 272;
const SKILL_ICON_HEIGHT = 35;
const COUNTER_ICON_HEIGHT = 18;

// RuneLite's Viewport enum: the widget each layout's bars hang off.
const SIDE_PANELS_FIXED = (548 << 16) | 80; // Toplevel.SIDE_PANELS
const SIDE_CONTAINER_RESIZABLE = (161 << 16) | 73; // ToplevelOsrsStretch.SIDE_CONTAINER
const SIDE_BACKGROUND_MODERN = (164 << 16) | 70; // ToplevelPreEoc.SIDE_BACKGROUND

const BAR_MODES = {
    Disabled: "disabled",
    Hitpoints: "hitpoints",
    Prayer: "prayer",
    "Run energy": "run",
    "Special attack": "special",
} as const;
type BarMode = (typeof BAR_MODES)[keyof typeof BAR_MODES];

export const StatusBarsConfig = ConfigGroup("statusbars", {
    enableCounter: ConfigItem({
        name: "Show counters",
        description: "Shows current value of the status on the bar.",
        position: 1,
        default: true,
    }),
    enableSkillIcon: ConfigItem({
        name: "Show icons",
        description: "Adds skill icons at the top of the bars.",
        position: 2,
        default: true,
    }),
    leftBarMode: ConfigItem({
        name: "Left bar",
        description: "Configures the left status bar.",
        position: 3,
        enum: BAR_MODES,
        default: "hitpoints" as BarMode,
    }),
    rightBarMode: ConfigItem({
        name: "Right bar",
        description: "Configures the right status bar.",
        position: 4,
        enum: BAR_MODES,
        default: "prayer" as BarMode,
    }),
});

type Bar = { current: number; max: number; color: Rgba; icon: number };
type Rect = { x: number; y: number; w: number; h: number };

export class StatusBarsPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Status Bars",
        description: "Draws status bars next to the inventory showing current HP & prayer and more.",
        tags: ["hitpoints", "hp", "prayer", "overlay", "combat"],
        configKey: "statusbarsplugin",
    };

    static config = StatusBarsConfig;

    private readonly config = inject(ConfigManager).getConfig(StatusBarsConfig);
    private readonly osrsClient: OsrsClient;

    readonly widgetOverlay: WidgetOverlay = {
        signature: () => {
            const layout = this.layout();
            if (!layout) return "";
            const { anchor, bars } = layout;
            return [
                anchor._absX, anchor._absY, anchor._absWidth, anchor._absHeight,
                this.config.enableCounter(), this.config.enableSkillIcon(),
                ...bars.flatMap((b) => (b ? [b.current, b.max, b.color, b.icon] : [-1])),
            ].join(",");
        },
        draw: (context) => this.draw(context),
    };

    constructor(osrsClient?: OsrsClient) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
    }

    /** The side panel to anchor to and the two bars, or nothing where they have no place (317 fixed). */
    private layout() {
        const client = this.osrsClient;
        const manager = client.widgetManager;
        if (!this.isStarted() || !manager) return undefined;
        const root = manager.rootInterface;
        const uid =
            root === 548 ? SIDE_PANELS_FIXED
            : root === 161 ? SIDE_CONTAINER_RESIZABLE
            : root === 164 ? SIDE_BACKGROUND_MODERN
            : -1;
        // The 317 frames reuse roots 548/161 under this varp; only resizable keeps the bars.
        if (uid < 0) return undefined;
        if (root === 548 && client.varManager?.getVarp(VARP_GAMEFRAME_317) === 1) return undefined;
        const anchor: any = manager.getWidgetByUid(uid);
        if (!anchor || manager.isEffectivelyHidden(uid) || !(anchor._absWidth > 0)) return undefined;
        return {
            anchor,
            modern: root === 164,
            bars: [this.bar(this.config.leftBarMode()), this.bar(this.config.rightBarMode())],
        };
    }

    private bar(mode: BarMode): Bar | undefined {
        const client = this.osrsClient;
        const vars = client.varManager;
        const cs2 = client.cs2Vm?.context;
        if (!vars || !cs2) return undefined;
        switch (mode) {
            case "hitpoints": {
                const poison = vars.getVarp(POISON);
                const color =
                    poison >= 1_000_000 ? VENOMED_COLOR
                    : poison > 0 ? POISONED_COLOR
                    : vars.getVarp(DISEASE) > 0 ? DISEASE_COLOR
                    : HEALTH_COLOR;
                return {
                    current: cs2.getStatLevel?.(SKILL_HITPOINTS) ?? 1,
                    max: cs2.getStatBase?.(SKILL_HITPOINTS) ?? 1,
                    color,
                    icon: HITPOINTS_ICON,
                };
            }
            case "prayer":
                return {
                    current: cs2.getStatLevel?.(SKILL_PRAYER) ?? 1,
                    max: cs2.getStatBase?.(SKILL_PRAYER) ?? 1,
                    color: vars.getVarbit(PRAYER_ALLACTIVE) !== 0 ? ACTIVE_PRAYER_COLOR : PRAYER_COLOR,
                    icon: PRAYER_ICON,
                };
            case "run":
                return {
                    current: Math.floor((cs2.getRunEnergy?.() ?? 0) / 100),
                    max: 100,
                    color: vars.getVarbit(STAMINA_ACTIVE) !== 0 ? RUN_STAMINA_COLOR : ENERGY_COLOR,
                    icon: WALK_ICON,
                };
            case "special":
                return {
                    current: Math.floor(vars.getVarp(SA_ENERGY) / 10),
                    max: 100,
                    color: SPECIAL_ATTACK_COLOR,
                    icon: SPECIAL_ICON,
                };
            default:
                return undefined;
        }
    }

    private draw(context: WidgetOverlayDrawContext): Rect[] {
        const layout = this.layout();
        if (!layout) return [];
        const { anchor, modern, bars } = layout;
        // Device pixels per layout unit, from the anchor's drawn size.
        const sx = anchor._absWidth / Math.max(1, anchor.width);
        const sy = anchor._absHeight / Math.max(1, anchor.height);
        const x = anchor._absX;
        const y = anchor._absY;
        // RuneLite's Viewport offsets: modern puts both bars left of the panel.
        const height = modern ? RESIZED_BOTTOM_HEIGHT : HEIGHT;
        const lefts = modern
            ? [x - 51 * sx, x - 25 * sx]
            : [x - BAR_WIDTH * sx, x + anchor._absWidth];
        const top = modern ? y : y + 4 * sy;
        const rects: Rect[] = [];
        bars.forEach((bar, i) => {
            if (!bar) return;
            const rect = { x: lefts[i], y: top, w: BAR_WIDTH * sx, h: height * sy };
            this.drawBar(context, bar, rect, sx, sy);
            rects.push(rect);
        });
        return rects;
    }

    private drawBar(context: WidgetOverlayDrawContext, bar: Bar, r: Rect, sx: number, sy: number): void {
        const glr = context.renderer;
        // BarRenderer: outline + fill in the same translucent black, then the level fill.
        glr.drawRect(r.x, r.y, r.w, r.h, BACKGROUND);
        glr.drawRect(r.x, r.y, r.w, sy, BACKGROUND);
        glr.drawRect(r.x, r.y + r.h - sy, r.w, sy, BACKGROUND);
        glr.drawRect(r.x, r.y + sy, sx, r.h - 2 * sy, BACKGROUND);
        glr.drawRect(r.x + r.w - sx, r.y + sy, sx, r.h - 2 * sy, BACKGROUND);
        const ratio = bar.max > 0 ? bar.current / bar.max : 0;
        const filled = ratio >= 1 ? r.h : Math.round(ratio * (r.h / sy)) * sy;
        if (filled > 2 * sy) {
            glr.drawRect(r.x + sx, r.y + sy + r.h - filled, r.w - 2 * sx, filled - 2 * sy, bar.color);
        }

        const showIcon = this.config.enableSkillIcon();
        if (showIcon) {
            const icon = context.sprite(bar.icon);
            if (icon) {
                const w = icon.w * sx;
                glr.drawTexture(icon, Math.round(r.x + (r.w - w) / 2), r.y + 4 * sy, w, icon.h * sy);
            }
        }
        if (this.config.enableCounter()) {
            const baseline = showIcon ? SKILL_ICON_HEIGHT : COUNTER_ICON_HEIGHT;
            drawTextGL(
                glr, context.fontLoader, String(bar.current),
                r.x, r.y, r.w, baseline * sy,
                FONT_PLAIN_11, 0xffffff, 1, 2, true, 1, undefined, sx, sy,
            );
        }
    }
}
