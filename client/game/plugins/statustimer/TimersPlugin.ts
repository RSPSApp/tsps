import { createElement, lazy, type ReactNode } from "react";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { TimersConfig } from "./TimersConfig";
import { appendAttackTimerOverhead } from "../attacktimer/AttackTimerOverhead";
import type { WebGLOsrsRendererHost } from "../../../render/render/hostInterface";
import type { OverheadTextEntry } from "../../../ui/devoverlay/Overlay";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import type { OsrsClient } from "../../OsrsClient";
import { showAllTimers } from "../../../common/utils/DeviceUtil";
import { VengeanceTimer } from "../vengeancetimer/VengeanceTimer";
import { StatusTimer } from "./StatusTimer";
import { getAttackTimerTicks } from "../attacktimer/attackTimerState";
import { getCurrentTick } from "../../../network/serverConnection/timing";
import { CLIENT_TOKEN, inject as injectClient } from "@runelite/client/plugins/PluginInjector";
import { openConfiguration } from "@runelite/client/plugins/config/configurationRequests";
import { skillIconSprite } from "../../../rs/skill/skillIcons";
import { SkillId } from "../../../rs/skill/skills";
import { formatTimerSeconds, TimersInfoBoxOverlay, type TimerEntry } from "./TimersInfoBoxOverlay";
import {
    ANTIFIRE_ITEMS,
    FREEZE_SPRITES,
    ITEM_TIMER_FIRST_VARP,
    ITEM_TIMER_SLOTS,
    POISON_SPRITES,
    STAMINA_ITEMS,
    TELEBLOCK_SPRITES,
    VENGEANCE_SPRITE_ID,
} from "./timerIcons";

/** The mobile gameframe (toplevel_osm): its own HTML timer slots, not the corner overlay. */
const MOBILE_ROOT = 601;

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
        description:
            "Attack, poison, freeze, antifire, teleblock, stamina and vengeance timers, and the other timed potions, " +
            "the imbued heart and hunter meat's second heal.",
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
            "potion",
            "divine",
            "overload",
            "heart",
        ],
        configKey: "timersplugin",
    };

    static config = TimersConfig;
    readonly config = inject(ConfigManager).getConfig(TimersConfig);

    readonly poison = new StatusTimer();
    readonly freeze = new StatusTimer();
    readonly antifire = new StatusTimer();
    readonly teleblock = new StatusTimer();
    readonly stamina = new StatusTimer();
    readonly vengeance = new VengeanceTimer();
    /**
     * The server's other timed effects (timerIcons ITEM_TIMER_FIRST_VARP): a timer and its icon, an
     * item id or minus a sprite id (0: an empty slot).
     */
    readonly itemTimers = Array.from({ length: ITEM_TIMER_SLOTS }, () => ({ timer: new StatusTimer(), icon: 0 }));
    readonly widgetOverlay = new TimersInfoBoxOverlay(this);
    private readonly effects = [
        this.poison,
        this.freeze,
        this.antifire,
        this.teleblock,
        this.stamina,
    ];
    private readonly listeners = new Set<() => void>();

    /** Number of visible infoboxes before a slot, used to pack the shared combat row. */
    visibleInfoboxCount(before = 7, now = Date.now()): number {
        if (!this.isEnabled()) return 0;
        if (showAllTimers) return Math.min(before, this.config.showAttackTimer() ? 6 : 7);
        let count = 0;
        for (let i = 0; i < Math.min(before, this.effects.length); i++) {
            const timer = this.effects[i],
                state = timer.getState();
            if (state.active && (state.endsAt === null || timer.getRemainingSeconds(now) > 0))
                count++;
        }
        if (before > 5 && this.vengeance.getRemainingSeconds(now) > 0) count++;
        if (before > 6 && !this.config.showAttackTimer() && this.attackTimerTicks() > 0) count++;
        for (let i = 0; i < this.itemTimers.length && 7 + i < before; i++) {
            if (this.itemTimers[i].icon !== 0 && this.itemTimers[i].timer.getRemainingSeconds(now) > 0) count++;
        }
        return count;
    }

    /** The item timer slots from their varps (seconds, then the icon), as the server sends them. */
    syncItemTimers(readVarp: (id: number) => number, now = Date.now()): void {
        this.itemTimers.forEach((slot, i) => {
            const seconds = readVarp(ITEM_TIMER_FIRST_VARP + i * 2) | 0;
            const icon = readVarp(ITEM_TIMER_FIRST_VARP + i * 2 + 1) | 0;
            slot.icon = seconds > 0 ? icon : 0;
            slot.timer.sync(slot.icon ? seconds : 0, slot.icon, now);
        });
    }

    /** The boxes to draw now, in order: the status timers, vengeance, the attack timer, then the item timers. */
    timerEntries(now = Date.now()): TimerEntry[] {
        const entries: TimerEntry[] = [];
        const status = (key: string, timer: StatusTimer, fallback: string, icon: { sprites?: Record<number, number>; items?: Record<number, number> }) => {
            const state = timer.getState();
            const remaining = timer.getRemainingSeconds(now);
            if (!showAllTimers && (!state.active || (state.endsAt !== null && remaining <= 0))) return;
            const type = state.type || Number(Object.keys(icon.sprites ?? icon.items ?? {})[0] ?? 1);
            entries.push({
                key, fallback, sprite: icon.sprites?.[type], item: icon.items?.[type],
                text: !state.active ? "0" : state.endsAt === null ? "∞" : formatTimerSeconds(remaining),
            });
        };
        status("poison", this.poison, "P", { sprites: POISON_SPRITES });
        status("freeze", this.freeze, "F", { sprites: FREEZE_SPRITES });
        status("antifire", this.antifire, "A", { items: ANTIFIRE_ITEMS });
        status("teleblock", this.teleblock, "T", { sprites: TELEBLOCK_SPRITES });
        status("stamina", this.stamina, "S", { items: STAMINA_ITEMS });
        const vengeance = this.vengeance.getRemainingSeconds(now);
        if (vengeance > 0 || showAllTimers) entries.push({ key: "vengeance", sprite: VENGEANCE_SPRITE_ID, fallback: "V", text: formatTimerSeconds(vengeance) });
        const attack = this.attackTimerTicks();
        if (!this.config.showAttackTimer() && (attack > 0 || showAllTimers)) {
            entries.push({ key: "attack", sprite: skillIconSprite(SkillId.Attack), fallback: "⚔", text: String(attack) });
        }
        this.itemTimers.forEach((slot, i) => {
            const remaining = slot.timer.getRemainingSeconds(now);
            if (slot.icon === 0 || remaining <= 0) return;
            entries.push({
                key: `item${i}:${slot.icon}`, fallback: "?", text: formatTimerSeconds(remaining),
                ...(slot.icon > 0 ? { item: slot.icon } : { sprite: -slot.icon }),
            });
        });
        return entries;
    }

    /** Whether the mobile gameframe is up: it keeps the HTML boxes in its own slots. */
    mobileGameframe(): boolean {
        try {
            return injectClient<OsrsClient>(CLIENT_TOKEN)?.widgetManager?.rootInterface === MOBILE_ROOT;
        } catch {
            return false;
        }
    }

    openSettings(): void {
        openConfiguration(TimersPlugin);
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
        if (this.isEnabled() && this.config.showAttackTimer())
            appendAttackTimerOverhead(host, index, output, maxEntries, playerDefaultHeightTiles, showAllTimers);
    }

    attackTimerTicks(): number {
        return this.isEnabled() ? getAttackTimerTicks(getCurrentTick()) : 0;
    }
}
