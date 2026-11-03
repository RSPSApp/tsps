import { CHATBOX, MAGIC_SPELLBOOK } from "@runelite/api/gameval/InterfaceID";
import { TOOLTIP_BUILT, TOOLTIP_TIME } from "@runelite/api/gameval/VarClientID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { type Tooltip, TooltipManager } from "@runelite/client/ui/overlay/tooltip/TooltipManager";
import { minMenuSnapshot, type MinMenuSnapshot } from "../../../rs/cs2/minimenu";
import { FONT_PLAIN_12 } from "../../../ui/fonts";
import { getClientClock } from "../../TransmitCycles";
import type { OsrsClient } from "../../OsrsClient";
import { MouseHighlightConfig } from "./MouseHighlightConfig";

/** What the plugin reads from the client: the hovered entry and native tooltip state. */
export type MouseHighlightClient = {
    hoveredEntry(): MinMenuSnapshot;
    getVarcIntValue(varcId: number): number;
    getGameCycle(): number;
    nativeTooltipVisible(text: string): boolean;
};

/** Options too common to be worth a tooltip (MouseHighlightOverlay's switch). */
const TRIVIAL_OPTIONS = new Set(["Walk here", "Cancel", "Continue", "Set heading"]);
const NATIVE_MOUSEOVER_TIMER = 4725;

function nativeTooltipVisible(client: OsrsClient, text: string): boolean {
    const widgets = client.widgetManager;
    // Cache 4728 uses plain12 near the pointer; 4727's separate top-left label uses bold12.
    return widgets?.getActiveTimerWidgets().some((root) => root.onTimer?.[0] === NATIVE_MOUSEOVER_TIMER &&
        root.children?.some((child) => child?.type === 4 && !child.hidden && child.fontId === FONT_PLAIN_12 &&
            child.text?.trim() === text.trim() && !widgets.isEffectivelyHidden(child.uid))) ?? false;
}

/**
 * RuneLite 1.13.5 Mouse Tooltips: the left-click option under the cursor ("Attack Goblin
 * (level-2)") as a tooltip, on the world and on interfaces.
 */
export class MouseHighlightPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Mouse Tooltips",
        description: "Render default actions as a tooltip",
        tags: ["actions", "overlay"],
        configKey: "mousehighlightplugin",
    };

    static config = MouseHighlightConfig;

    readonly config = inject(ConfigManager).getConfig(MouseHighlightConfig);
    private readonly client: MouseHighlightClient;
    private readonly tooltips: TooltipManager;
    private readonly source = () => this.tooltip();

    constructor(client?: MouseHighlightClient, tooltips?: TooltipManager) {
        super();
        this.tooltips = tooltips ?? inject(TooltipManager);
        if (client) {
            this.client = client;
        } else {
            const osrsClient = inject<OsrsClient>(CLIENT_TOKEN);
            this.client = {
                hoveredEntry: () => minMenuSnapshot(osrsClient),
                getVarcIntValue: (varcId) => osrsClient.varManager?.getVarcInt(varcId) ?? 0,
                getGameCycle: () => getClientClock(),
                nativeTooltipVisible: (text) => nativeTooltipVisible(osrsClient, text),
            };
        }
    }

    protected async startUp(): Promise<void> {
        this.tooltips.addFront(this.source);
    }

    protected async shutDown(): Promise<void> {
        this.tooltips.remove(this.source);
    }

    /** MouseHighlightOverlay.render: the tooltip for this frame, if any. */
    tooltip(): Tooltip | undefined {
        const entry = this.client.hoveredEntry();
        const option = entry.option;
        const target = entry.target;
        if (!option) return undefined;

        // Trivial options that don't need to be highlighted, add more as they appear.
        if (TRIVIAL_OPTIONS.has(option)) return undefined;
        // Hide overlay on sliding puzzle boxes
        if (option === "Move" && target.includes("Sliding piece")) return undefined;

        if (entry.hasComponentHover) {
            const groupId = (entry.widgetUid ?? -1) >>> 16;
            if (this.config.uiTooltip() !== true) return undefined;
            if (this.config.chatboxTooltip() !== true && groupId === CHATBOX) return undefined;
            if (this.config.disableSpellbooktooltip() === true && groupId === MAGIC_SPELLBOOK) return undefined;
        }

        // If this varc is set, a tooltip will be displayed soon
        if (this.client.getVarcIntValue(TOOLTIP_TIME) > this.client.getGameCycle()) return undefined;
        // If this varc is set, a tooltip is already being displayed
        if (this.client.getVarcIntValue(TOOLTIP_BUILT) === 1) return undefined;

        const text = option + (target ? ` ${target}` : "");
        // Cache 4728 builds a near-pointer tooltip without the legacy TOOLTIP_BUILT flag.
        if (this.client.nativeTooltipVisible(text)) return undefined;
        return { text };
    }
}
