export const VENGEANCE_TIME_LIMIT_VARBIT = 2451;
export const VENGEANCE_COOLDOWN_MS = 30_000;

export class VengeanceTimer {
    private cooldownActive = false;
    private cooldownEndsAt: number | null = null;

    syncCooldownVarbit(value: number, now = Date.now()): void {
        const active = value !== 0;
        if (active === this.cooldownActive) return;
        this.cooldownActive = active;
        this.cooldownEndsAt = active ? now + VENGEANCE_COOLDOWN_MS : null;
    }

    getRemainingSeconds(now = Date.now()): number {
        return this.cooldownEndsAt === null
            ? 0
            : Math.max(0, Math.ceil((this.cooldownEndsAt - now) / 1000));
    }
}
