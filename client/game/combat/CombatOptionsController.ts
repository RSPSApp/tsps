import type { PlayerEcs } from "../ecs/PlayerEcs";
import {
    PRAYER_HEAD_ICON_IDS,
    PRAYER_NAME_SET,
    PRAYER_NAME_TO_VARBIT,
    PrayerName,
    PrayerVarbits,
    prayerSetToBitmask,
} from "../../rs/prayer/prayers";
import type { VarManager } from "../../rs/config/vartype/VarManager";
import { VARP_ATTACK_STYLE, VARP_OPTION_RUN } from "../../common/vars";

export type CombatOptionsControllerDeps = {
    getVarManager: () => VarManager | undefined;
    playerEcs: PlayerEcs;
    getControlledPlayerServerId: () => number;
    getCombatWeaponCategory: () => number;
};

/**
 * Client-side combat options and prayer state sync.
 * Keeps local state, varps/varbits, and ECS head icons aligned with CS2 scripts.
 */
export class CombatOptionsController {
    activePrayers: Set<PrayerName> = new Set();
    quickPrayers: Set<PrayerName> = new Set();
    quickPrayersEnabled: boolean = false;

    autoRetaliateEnabled: boolean = true;
    combatStyleSlot: number = 0;
    combatSpellId: number = -1;

    private specialEnergyPercent: number = 100;
    private specialAttackEnabled: boolean = false;

    constructor(private readonly deps: CombatOptionsControllerDeps) {}

    /** Seed varps/varbits after VarManager is constructed. */
    initVarDefaults(): void {
        this.updateSpecialEnergy(this.specialEnergyPercent);
        this.syncPrayerVarbits();
    }

    setRunMode(on: boolean, force: boolean = false): void {
        const normalized = !!on;
        const varManager = this.deps.getVarManager();
        const currentVarp = varManager?.getVarp(VARP_OPTION_RUN) ?? 0;
        const currentRunOn = currentVarp !== 0;
        if (!force && normalized === currentRunOn) return;

        // Set varp - this triggers onVarpChange which:
        // 1. Syncs OsrsClient.runMode
        // 2. Sends varp_transmit to server (since varp 173 is in TRANSMIT_VARPS)
        varManager?.setVarp(VARP_OPTION_RUN, normalized ? 1 : 0);

        // Update ECS running state
        try {
            const serverId = this.deps.getControlledPlayerServerId();
            const idx = this.deps.playerEcs.getIndexForServerId(serverId);
            if (idx !== undefined) {
                this.deps.playerEcs.setRunning(idx, normalized);
            }
        } catch {}
    }

    getSpecialEnergy(): number {
        return this.specialEnergyPercent;
    }

    isSpecialAttackEnabled(): boolean {
        return this.specialAttackEnabled;
    }

    setSpecialAttackEnabled(on: boolean, opts: { fromServer?: boolean } = {}): void {
        const normalized = !!on;
        this.specialAttackEnabled = normalized;
        // CS2 reads %sa_attack (varp 301) for special attack toggle state
        this.deps.getVarManager()?.setVarp(301, normalized ? 1 : 0);
        if (opts.fromServer) return;
    }

    toggleSpecialAttack(): void {
        this.setSpecialAttackEnabled(!this.specialAttackEnabled);
    }

    updateSpecialEnergy(percent: number): void {
        const value = Number.isFinite(percent) ? Math.floor(percent) : 0;
        this.specialEnergyPercent = Math.max(0, Math.min(100, value));
        // CS2 reads %sa_energy (varp 300) which stores 0-1000 (divides by 10 for percentage display)
        this.deps.getVarManager()?.setVarp(300, this.specialEnergyPercent * 10);
    }

    setAutoRetaliate(on: boolean, fromServer: boolean = false): void {
        const normalized = !!on;
        if (!fromServer && normalized === this.autoRetaliateEnabled) return;
        this.autoRetaliateEnabled = normalized;
    }

    setCombatStyleSlot(
        style: number,
        opts: { fromServer?: boolean; category?: number } = {},
    ): void {
        const normalized = Math.max(0, style | 0);
        this.combatStyleSlot = normalized;
        // CRITICAL: Update varp 43 so CS2 scripts know the selected combat style
        // This affects which button is highlighted in the combat options interface
        const varManager = this.deps.getVarManager();
        if (varManager) {
            varManager.setVarp(VARP_ATTACK_STYLE, normalized);
        }
        if (opts.fromServer) return;
    }

    setActivePrayers(
        prayers: Iterable<string | PrayerName>,
        opts: { fromServer?: boolean } = {},
    ): void {
        const normalized = Array.from(prayers ?? [])
            .map((p) => String(p) as PrayerName)
            .filter((name): name is PrayerName => PRAYER_NAME_SET.has(name));
        const unique = Array.from(new Set(normalized));
        const prev = this.activePrayers;
        const changed = unique.length !== prev.size || unique.some((entry) => !prev.has(entry));
        if (changed || opts.fromServer) {
            this.activePrayers = new Set(unique);
            this.syncPrayerVarbits();
            this.syncLocalPrayerHeadIcon();
        }
        if (opts.fromServer || !changed) return;
    }

    /**
     * The controlled player does not always receive its own appearance mask.
     * Mirror the server-confirmed prayer set into the local render entity so
     * its overhead icon changes immediately as it does for nearby players.
     */
    syncLocalPrayerHeadIcon(): void {
        const serverId = this.deps.getControlledPlayerServerId() | 0;
        if (serverId < 0) return;
        const index = this.deps.playerEcs.getIndexForServerId(serverId);
        if (index === undefined) return;

        let icon = -1;
        if (this.activePrayers.has("protect_from_melee")) {
            icon = PRAYER_HEAD_ICON_IDS.protect_melee;
        } else if (this.activePrayers.has("protect_from_missiles")) {
            icon = PRAYER_HEAD_ICON_IDS.protect_missiles;
        } else if (this.activePrayers.has("protect_from_magic")) {
            icon = PRAYER_HEAD_ICON_IDS.protect_magic;
        } else if (this.activePrayers.has("retribution")) {
            icon = PRAYER_HEAD_ICON_IDS.retribution;
        } else if (this.activePrayers.has("redemption")) {
            icon = PRAYER_HEAD_ICON_IDS.redemption;
        } else if (this.activePrayers.has("smite")) {
            icon = PRAYER_HEAD_ICON_IDS.smite;
        }

        this.deps.playerEcs.setHeadIconPrayer(index, icon);
    }

    /** Sync prayer state to varbits for CS2 scripts (prayer_op, prayer_redraw, etc.) */
    syncPrayerVarbits(): void {
        const varManager = this.deps.getVarManager();
        if (!varManager) return;

        // Set individual prayer varbits (4104-4129, 5464-5466)
        // Each prayer has its own 1-bit varbit that shares an underlying varp
        // CS2 scripts read %prayer_allactive which is the raw varp containing all bits
        for (const [prayerName, varbitId] of Object.entries(PRAYER_NAME_TO_VARBIT)) {
            const isActive = this.activePrayers.has(prayerName as PrayerName) ? 1 : 0;
            varManager.setVarbit(varbitId, isActive);
        }
    }

    /** Sync quick prayer state to varbits for CS2 scripts */
    syncQuickPrayerVarbits(): void {
        const varManager = this.deps.getVarManager();
        if (!varManager) return;

        // Sync quick-prayer selected bitmask for setup UI scripts.
        // quickprayer_selected uses the same bit positions as prayer_allactive.
        varManager.setVarbit(
            PrayerVarbits.QUICKPRAYER_SELECTED,
            prayerSetToBitmask(this.quickPrayers),
        );

        // Set QUICKPRAYER_ACTIVE flag (varbit 4103) - whether quick prayers are enabled
        varManager.setVarbit(
            PrayerVarbits.QUICKPRAYER_ACTIVE,
            this.quickPrayersEnabled ? 1 : 0,
        );
    }

    setQuickPrayers(
        prayers: Iterable<string | PrayerName>,
        opts: { fromServer?: boolean } = {},
    ): void {
        const normalized = Array.from(prayers ?? [])
            .map((p) => String(p) as PrayerName)
            .filter((name): name is PrayerName => PRAYER_NAME_SET.has(name));
        const unique = Array.from(new Set(normalized));
        const prev = this.quickPrayers;
        const changed = unique.length !== prev.size || unique.some((entry) => !prev.has(entry));
        if (changed || opts.fromServer) {
            this.quickPrayers = new Set(unique);
            this.syncQuickPrayerVarbits();
        }
        if (opts.fromServer || !changed) return;
    }

    setQuickPrayersEnabled(enabled: boolean, opts: { fromServer?: boolean } = {}): void {
        const normalized = !!enabled;
        if (this.quickPrayersEnabled === normalized && !opts.fromServer) return;
        this.quickPrayersEnabled = normalized;
        this.syncQuickPrayerVarbits();
    }

    setCombatSpell(spellId: number | null, opts: { fromServer?: boolean } = {}): void {
        const normalized =
            spellId != null && Number.isFinite(spellId) && (spellId | 0) > 0 ? spellId | 0 : -1;
        this.combatSpellId = normalized;
        if (opts.fromServer) return;
    }
}
