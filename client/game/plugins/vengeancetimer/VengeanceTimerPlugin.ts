import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { createElement, lazy, type ReactNode } from "react";
import type { OsrsClient } from "../../OsrsClient";

export const VENGEANCE_TIME_LIMIT_VARBIT = 2451;
export const VENGEANCE_COOLDOWN_MS = 30_000;

export interface VengeanceTimerPluginConfig {
    enabled: boolean;
}

export interface VengeanceTimerPluginState {
    config: VengeanceTimerPluginConfig;
    cooldownEndsAt: number | null;
    version: number;
}

type VengeanceTimerPluginListener = () => void;

const VengeanceTimerOverlay = lazy(() =>
    import("./VengeanceTimerOverlay").then((m) => ({ default: m.VengeanceTimerOverlay })),
);

export class VengeanceTimerPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Vengeance Timer",
        description: "Shows the 30-second Vengeance cooldown.",
        tags: ["combat", "timer"],
        configKey: "vengeancetimerplugin",
    };

    renderHud(osrsClient: OsrsClient): ReactNode {
        return createElement(VengeanceTimerOverlay, { osrsClient, plugin: this });
    }

    private readonly listeners = new Set<VengeanceTimerPluginListener>();
    private cooldownActive = false;
    private cooldownEndsAt: number | null = null;
    private version = 0;
    private state: VengeanceTimerPluginState = this.createState();

    subscribe(listener: VengeanceTimerPluginListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): VengeanceTimerPluginState {
        return this.state;
    }

    setConfig(nextConfig: Partial<VengeanceTimerPluginConfig>): void {
        if (nextConfig.enabled !== undefined) {
            void this.setPluginEnabled(nextConfig.enabled);
            this.commit();
        }
    }

    syncCooldownVarbit(value: number, now = Date.now()): void {
        const active = value !== 0;
        if (active === this.cooldownActive) {
            return;
        }

        this.cooldownActive = active;
        this.cooldownEndsAt = active ? now + VENGEANCE_COOLDOWN_MS : null;
        this.commit();
    }

    getRemainingSeconds(now = Date.now()): number {
        if (this.cooldownEndsAt === null) {
            return 0;
        }
        return Math.max(0, Math.ceil((this.cooldownEndsAt - now) / 1000));
    }

    private commit(): void {
        this.version++;
        this.state = this.createState();
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (err) {
                console.log("[vengeance-timer-plugin] listener failed", err);
            }
        }
    }

    private createState(): VengeanceTimerPluginState {
        return {
            config: { enabled: this.isEnabled() },
            cooldownEndsAt: this.cooldownEndsAt,
            version: this.version,
        };
    }
}
