import { createElement, lazy, type ReactNode } from "react";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import type { WebGLOsrsRendererHost } from "../../../render/render/hostInterface";
import type { OverheadTextEntry } from "../../../ui/devoverlay/Overlay";
import type { OsrsClient } from "../../OsrsClient";
import { showAllTimers } from "../../../common/utils/DeviceUtil";
import { appendAttackTimerOverhead } from "../attacktimer/AttackTimerOverhead";
import { VengeanceTimer } from "../vengeancetimer/VengeanceTimer";
import { StatusTimer } from "./StatusTimer";

const TimersOverlay = lazy(() =>
    import("./TimersOverlay").then((m) => ({ default: m.TimersOverlay })),
);
const LEGACY_EFFECT_KEYS = [
    "poisontimerplugin",
    "freezetimerplugin",
    "antifiretimerplugin",
    "teleblocktimerplugin",
    "staminatimerplugin",
    "vengeancetimerplugin",
];

/** Preserve an entirely disabled timer setup without overriding the new plugin's saved switch. */
export function migrateTimersConfig(config: ConfigManager): void {
    if (config.getConfiguration("runelite", "timersplugin") !== undefined) return;
    if (
        LEGACY_EFFECT_KEYS.every((key) => config.getConfiguration("runelite", key) === "false") &&
        config.getConfiguration("runelite", "attacktimerplugin") !== "true"
    ) {
        config.setConfiguration("runelite", "timersplugin", "false");
    }
}

export class TimersPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Timers",
        description: "Attack, poison, freeze, antifire, teleblock, stamina and vengeance timers.",
        tags: [
            "combat",
            "timer",
            "attack",
            "poison",
            "freeze",
            "antifire",
            "teleblock",
            "stamina",
            "vengeance",
        ],
        configKey: "timersplugin",
    };

    readonly poison = new StatusTimer();
    readonly freeze = new StatusTimer();
    readonly antifire = new StatusTimer();
    readonly teleblock = new StatusTimer();
    readonly stamina = new StatusTimer();
    readonly vengeance = new VengeanceTimer();
    private readonly effects = [
        this.poison,
        this.freeze,
        this.antifire,
        this.teleblock,
        this.stamina,
    ];
    private readonly listeners = new Set<() => void>();

    /** Number of visible infoboxes before a slot, used to pack the shared combat row. */
    visibleInfoboxCount(before = 6, now = Date.now()): number {
        if (!this.isEnabled()) return 0;
        if (showAllTimers) return before;
        let count = 0;
        for (let i = 0; i < Math.min(before, this.effects.length); i++) {
            const timer = this.effects[i],
                state = timer.getState();
            if (state.active && (state.endsAt === null || timer.getRemainingSeconds(now) > 0))
                count++;
        }
        if (before > 5 && this.vengeance.getRemainingSeconds(now) > 0) count++;
        return count;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    override setEnabledState(enabled: boolean): void {
        if (this.isEnabled() === enabled) return;
        super.setEnabledState(enabled);
        for (const listener of this.listeners) listener();
    }

    renderHud(osrsClient: OsrsClient): ReactNode {
        return createElement(TimersOverlay, { osrsClient, plugin: this });
    }

    appendLocalPlayerOverheads(
        host: WebGLOsrsRendererHost,
        index: number | undefined,
        output: OverheadTextEntry[],
        maxEntries: number,
        playerDefaultHeightTiles: number | undefined,
    ): void {
        if (this.isEnabled())
            appendAttackTimerOverhead(
                host,
                index,
                output,
                maxEntries,
                playerDefaultHeightTiles,
                showAllTimers,
            );
    }
}
