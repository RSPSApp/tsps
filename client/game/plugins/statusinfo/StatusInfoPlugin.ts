import type { StatChanged } from "@runelite/api/events";
import * as VarbitID from "@runelite/api/gameval/VarbitID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { openConfiguration } from "@runelite/client/plugins/config/configurationRequests";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { getCurrentTick } from "../../../network/serverConnection/timing";
import { EquipmentDisplaySlot } from "../../../rs/config/player/Equipment";
import { skillIconSprite } from "../../../rs/skill/skillIcons";
import { SKILL_IDS, SkillId } from "../../../rs/skill/skills";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import type { OsrsClient } from "../../OsrsClient";
import { getAttackTimerTicks } from "../attacktimer/attackTimerState";
import { StatusTimer } from "../statustimer/StatusTimer";
import {
    ANTIFIRE_ITEMS,
    ANTIFIRE_TIMER_SECONDS_VARP,
    ANTIFIRE_TIMER_TYPE_VARP,
    FREEZE_SPRITES,
    ITEM_TIMER_FIRST_VARP,
    ITEM_TIMER_SLOTS,
    POISON_SPRITES,
    STAMINA_ITEMS,
    STAMINA_TIMER_SECONDS_VARP,
    TELEBLOCK_SPRITES,
    TELEBLOCK_TIMER_SECONDS_VARP,
    VENGEANCE_SPRITE_ID,
} from "../statustimer/timerIcons";
import { VENGEANCE_TIME_LIMIT_VARBIT, VengeanceTimer } from "../vengeancetimer/VengeanceTimer";
import { StatusInfoConfig } from "./StatusInfoConfig";
import {
    formatQuantity,
    formatTimerSeconds,
    StatusInfoOverlay,
    type BoostEntry,
    type TimerEntry,
} from "./StatusInfoOverlay";

/** Boosted stats restore one level every 100 ticks (one minute), or 150 with Preserve on. */
const RESTORE_TICKS = 100;
const PRESERVE_RESTORE_TICKS = 150;
/**
 * The server's poison and freeze timer varps (seconds, then the type), as the Timers plugin reads
 * them (StatusTimerOverlay.tsx, which loads its stylesheet, so they are repeated here).
 */
export const POISON_TIMER_SECONDS_VARP = 7996;
export const POISON_TIMER_TYPE_VARP = 7997;
export const FREEZE_TIMER_SECONDS_VARP = 7998;
export const FREEZE_TIMER_SPELL_VARP = 7999;
/** How often the timers are read from their varps (ms). */
const SYNC_INTERVAL = 200;

/** What the boxes read: varps and varbits, the skill levels, the worn items and the tick. */
export interface StatusInfoGame {
    varp(id: number): number;
    varbit(id: number): number;
    levels(skill: SkillId): { boosted: number; real: number } | undefined;
    worn(slot: number): { itemId: number; quantity: number } | undefined;
    /** The item a stack of this many shows as (its count object), as the game draws it. */
    stackIcon(itemId: number, quantity: number): number;
    tick(): number;
    /** The ticks to the next attack. */
    attackTicks(): number;
}

/**
 * Status Info: the game's buff bar as a movable, scalable overlay. Stat boosts (with their
 * restore and boost bars), the status and potion timers, the attack timer and the ammo left, in
 * the buff bar's own style. It reads the same varps as the Timers plugin, on its own, so it works
 * with Timers off.
 */
export class StatusInfoPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Status Info",
        description: "Stat boosts, timers and the ammo left, styled like the game's buff bar.",
        tags: ["boosts", "timers", "potion", "ammo", "buff", "combat", "overlay"],
        configKey: "statusinfoplugin",
        enabledByDefault: false,
    };

    static config = StatusInfoConfig;
    readonly config = inject(ConfigManager).getConfig(StatusInfoConfig);

    /**
     * The client, taken while the plugin manager builds this plugin: `inject` only resolves then.
     * Undefined where nothing provides one (tests).
     */
    private readonly client: OsrsClient | undefined = (() => {
        try {
            return inject<OsrsClient>(CLIENT_TOKEN);
        } catch {
            return undefined;
        }
    })();

    /** Tests replace this; in game it reads the client. */
    game: StatusInfoGame = {
        varp: (id) => this.client?.varManager?.getVarp(id) ?? 0,
        varbit: (id) => this.client?.varManager?.getVarbit(id) ?? 0,
        levels: (skill) => {
            if (!this.client) return undefined;
            const impl = new ClientImpl(this.client);
            return { boosted: impl.getBoostedSkillLevel(skill), real: impl.getRealSkillLevel(skill) };
        },
        worn: (slot) => this.client?.equipment?.getSlot(slot),
        stackIcon: (itemId, quantity) => {
            const loader = this.client?.objTypeLoader;
            try {
                return loader?.load(itemId)?.getCountObj(loader, quantity)?.id ?? itemId;
            } catch {
                return itemId;
            }
        },
        tick: () => getCurrentTick(),
        attackTicks: () => getAttackTimerTicks(getCurrentTick()),
    };

    readonly poison = new StatusTimer();
    readonly freeze = new StatusTimer();
    readonly antifire = new StatusTimer();
    readonly teleblock = new StatusTimer();
    readonly stamina = new StatusTimer();
    readonly vengeance = new VengeanceTimer();
    /** The server's other timed effects: a timer and its icon, an item id or minus a sprite id (0: none). */
    readonly itemTimers = Array.from({ length: ITEM_TIMER_SLOTS }, () => ({ timer: new StatusTimer(), icon: 0 }));
    readonly widgetOverlay = new StatusInfoOverlay(this);

    /** Levels from StatChanged, which can be ahead of the client's own skill table. */
    private readonly levels = new Map<SkillId, { boosted: number; real: number }>();
    /** Each boosted stat's highest boost since it was last unboosted. */
    private readonly maxBoosts = new Map<SkillId, number>();
    /** The tick a boosted stat last restored a level (-1: none seen yet). */
    private lastRestoreTick = -1;
    private syncTimer: ReturnType<typeof setInterval> | undefined;

    protected async startUp(): Promise<void> {
        this.syncTimers();
        if (typeof setInterval === "function") this.syncTimer = setInterval(() => this.syncTimers(), SYNC_INTERVAL);
    }

    protected async shutDown(): Promise<void> {
        if (this.syncTimer !== undefined) clearInterval(this.syncTimer);
        this.syncTimer = undefined;
    }

    /** Reads every timer from its varps, as the Timers plugin's HUD does. */
    syncTimers(now = Date.now()): void {
        const timers = [
            [this.poison, POISON_TIMER_SECONDS_VARP, POISON_TIMER_TYPE_VARP],
            [this.freeze, FREEZE_TIMER_SECONDS_VARP, FREEZE_TIMER_SPELL_VARP],
            [this.antifire, ANTIFIRE_TIMER_SECONDS_VARP, ANTIFIRE_TIMER_TYPE_VARP],
            [this.teleblock, TELEBLOCK_TIMER_SECONDS_VARP],
            [this.stamina, STAMINA_TIMER_SECONDS_VARP],
        ] as const;
        for (const [timer, secondsVarp, typeVarp] of timers) {
            timer.sync(this.game.varp(secondsVarp), typeVarp === undefined ? 1 : this.game.varp(typeVarp), now);
        }
        this.itemTimers.forEach((slot, i) => {
            const seconds = this.game.varp(ITEM_TIMER_FIRST_VARP + i * 2) | 0;
            const icon = this.game.varp(ITEM_TIMER_FIRST_VARP + i * 2 + 1) | 0;
            slot.icon = seconds > 0 ? icon : 0;
            slot.timer.sync(slot.icon ? seconds : 0, slot.icon, now);
        });
        this.vengeance.syncCooldownVarbit(this.game.varbit(VENGEANCE_TIME_LIMIT_VARBIT), now);
    }

    onStatChanged(event: StatChanged): void {
        const skill = event.getSkill();
        const before = this.levels.get(skill) ?? this.game.levels(skill);
        const now = { boosted: event.getBoostedLevel(), real: event.getLevel() };
        this.levels.set(skill, now);
        // A boosted stat going down one level (its real level the same) is the stat restore.
        if (before && before.real === now.real && before.boosted > before.real && now.boosted === before.boosted - 1) {
            this.lastRestoreTick = this.game.tick();
        }
        const boost = now.boosted - now.real;
        if (boost <= 0) this.maxBoosts.delete(skill);
        else if (boost > (this.maxBoosts.get(skill) ?? 0)) this.maxBoosts.set(skill, boost);
    }

    /** The boosted stats' boxes, in skill order. */
    boostEntries(): BoostEntry[] {
        if (!this.config.showBoosts()) return [];
        const interval = this.game.varbit(VarbitID.PRAYER_PRESERVE) === 1 ? PRESERVE_RESTORE_TICKS : RESTORE_TICKS;
        // Until a restore has been seen its timing is unknown, so the bar starts full.
        const elapsed = this.lastRestoreTick < 0 ? 0 : (this.game.tick() - this.lastRestoreTick) % interval;
        const restore = 1 - Math.max(0, elapsed) / interval;
        const entries: BoostEntry[] = [];
        for (const skill of SKILL_IDS) {
            const levels = this.levels.get(skill) ?? this.game.levels(skill);
            if (!levels) continue;
            const boost = levels.boosted - levels.real;
            if (boost <= 0) continue;
            const max = Math.max(boost, this.maxBoosts.get(skill) ?? 0);
            entries.push({ key: `boost:${skill}`, sprite: skillIconSprite(skill), text: String(levels.boosted), restore, boost: boost / max });
        }
        return entries;
    }

    /** The ammunition worn and how much is left; a stack of thrown weapons when no ammo is. */
    ammoEntry(): TimerEntry | undefined {
        if (!this.config.showAmmo()) return undefined;
        const box = (slot: { itemId: number; quantity: number } | undefined, minimum: number): TimerEntry | undefined =>
            slot && slot.itemId > 0 && slot.quantity >= minimum
                ? {
                    key: `ammo:${slot.itemId}`, fallback: "A", text: formatQuantity(slot.quantity),
                    // A big stack shows as one: the game's own picture for that many.
                    item: this.game.stackIcon(slot.itemId, slot.quantity),
                }
                : undefined;
        return box(this.game.worn(EquipmentDisplaySlot.AMMO), 1) ?? box(this.game.worn(EquipmentDisplaySlot.WEAPON), 2);
    }

    /** The timer row: the status timers, vengeance, the attack timer, the item timers, then the ammo. */
    timerEntries(now = Date.now()): TimerEntry[] {
        const entries: TimerEntry[] = [];
        if (this.config.showTimers()) {
            const status = (key: string, timer: StatusTimer, fallback: string,
                icon: { sprites?: Record<number, number>; items?: Record<number, number> }) => {
                const state = timer.getState();
                const remaining = timer.getRemainingSeconds(now);
                if (!state.active || (state.endsAt !== null && remaining <= 0)) return;
                const type = state.type || Number(Object.keys(icon.sprites ?? icon.items ?? {})[0] ?? 1);
                entries.push({
                    key, fallback, sprite: icon.sprites?.[type], item: icon.items?.[type],
                    text: state.endsAt === null ? "∞" : formatTimerSeconds(remaining),
                });
            };
            status("poison", this.poison, "P", { sprites: POISON_SPRITES });
            status("freeze", this.freeze, "F", { sprites: FREEZE_SPRITES });
            status("antifire", this.antifire, "A", { items: ANTIFIRE_ITEMS });
            status("teleblock", this.teleblock, "T", { sprites: TELEBLOCK_SPRITES });
            status("stamina", this.stamina, "S", { items: STAMINA_ITEMS });
            const vengeance = this.vengeance.getRemainingSeconds(now);
            if (vengeance > 0) entries.push({ key: "vengeance", sprite: VENGEANCE_SPRITE_ID, fallback: "V", text: formatTimerSeconds(vengeance) });
        }
        if (this.config.showAttackTimer()) {
            const attack = this.game.attackTicks();
            if (attack > 0) entries.push({ key: "attack", sprite: skillIconSprite(SkillId.Attack), fallback: "⚔", text: String(attack) });
        }
        if (this.config.showTimers()) {
            this.itemTimers.forEach((slot, i) => {
                const remaining = slot.timer.getRemainingSeconds(now);
                if (slot.icon === 0 || remaining <= 0) return;
                entries.push({
                    key: `item${i}:${slot.icon}`, fallback: "?", text: formatTimerSeconds(remaining),
                    ...(slot.icon > 0 ? { item: slot.icon } : { sprite: -slot.icon }),
                });
            });
        }
        const ammo = this.ammoEntry();
        if (ammo) entries.push(ammo);
        return entries;
    }

    openSettings(): void {
        openConfiguration(StatusInfoPlugin);
    }
}
