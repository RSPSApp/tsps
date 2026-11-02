import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { createElement, lazy, type ReactNode } from "react";
import type { OsrsClient } from "../../OsrsClient";

const PoisonTimerOverlay = lazy(() =>
    import("./StatusTimerOverlay").then((m) => ({ default: m.PoisonTimerOverlay })),
);
const FreezeTimerOverlay = lazy(() =>
    import("./StatusTimerOverlay").then((m) => ({ default: m.FreezeTimerOverlay })),
);
const AntifireTimerOverlay = lazy(() =>
    import("./StatusTimerOverlay").then((m) => ({ default: m.AntifireTimerOverlay })),
);
const TeleblockTimerOverlay = lazy(() =>
    import("./StatusTimerOverlay").then((m) => ({ default: m.TeleblockTimerOverlay })),
);
const StaminaTimerOverlay = lazy(() =>
    import("./StatusTimerOverlay").then((m) => ({ default: m.StaminaTimerOverlay })),
);

export interface StatusTimerPluginConfig {
    enabled: boolean;
}

export interface StatusTimerPluginState {
    active: boolean;
    config: StatusTimerPluginConfig;
    endsAt: number | null;
    type: number;
    version: number;
}

type Listener = () => void;

export class StatusTimerPlugin extends Plugin {
    private readonly listeners = new Set<Listener>();
    private active = false;
    private config: StatusTimerPluginConfig = { enabled: true };
    private endsAt: number | null = null;
    private type = 0;
    private version = 0;
    private state: StatusTimerPluginState = this.createState();

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): StatusTimerPluginState {
        return this.state;
    }

    setConfig(config: Partial<StatusTimerPluginConfig>): void {
        if (config.enabled !== undefined) {
            void this.setPluginEnabled(config.enabled);
        }
        this.config = { enabled: this.isEnabled() };
        this.commit();
    }

    sync(seconds: number, type: number, now = Date.now()): void {
        if (seconds === 0) {
            if (this.active) {
                this.active = false;
                this.endsAt = null;
                this.type = 0;
                this.commit();
            }
            return;
        }

        if (seconds < 0) {
            if (!this.active || this.endsAt !== null || this.type !== type) {
                this.active = true;
                this.endsAt = null;
                this.type = type;
                this.commit();
            }
            return;
        }

        const nextEndsAt = now + seconds * 1000;
        const shouldRestart =
            !this.active || this.type !== type || this.getRemainingSeconds(now) < seconds - 1;
        const endsAt = shouldRestart ? nextEndsAt : Math.min(this.endsAt ?? nextEndsAt, nextEndsAt);
        if (shouldRestart || this.endsAt !== endsAt) {
            this.active = true;
            this.endsAt = endsAt;
            this.type = type;
            this.commit();
        }
    }

    getRemainingSeconds(now = Date.now()): number {
        return this.endsAt === null ? 0 : Math.max(0, Math.ceil((this.endsAt - now) / 1000));
    }

    private commit(): void {
        this.version++;
        this.state = this.createState();
        for (const listener of this.listeners) listener();
    }

    private createState(): StatusTimerPluginState {
        return {
            active: this.active,
            config: { enabled: this.isEnabled() },
            endsAt: this.endsAt,
            type: this.type,
            version: this.version,
        };
    }
}

export class PoisonTimerPlugin extends StatusTimerPlugin {
    static descriptor: PluginDescriptor = {
        name: "Poison Timer",
        description: "Shows poison or venom duration and type.",
        tags: ["combat", "timer"],
        configKey: "poisontimerplugin",
    };

    renderHud(osrsClient: OsrsClient): ReactNode {
        return createElement(PoisonTimerOverlay, { osrsClient, plugin: this });
    }
}

export class FreezeTimerPlugin extends StatusTimerPlugin {
    static descriptor: PluginDescriptor = {
        name: "Freeze Timer",
        description: "Shows the spell that froze you and its duration.",
        tags: ["combat", "timer"],
        configKey: "freezetimerplugin",
    };

    renderHud(osrsClient: OsrsClient): ReactNode {
        return createElement(FreezeTimerOverlay, { osrsClient, plugin: this });
    }
}

export class AntifireTimerPlugin extends StatusTimerPlugin {
    static descriptor: PluginDescriptor = {
        name: "Antifire Timer",
        description: "Shows how long your antifire or super antifire protection lasts.",
        tags: ["combat", "timer", "potion", "dragonfire"],
        configKey: "antifiretimerplugin",
    };

    renderHud(osrsClient: OsrsClient): ReactNode {
        return createElement(AntifireTimerOverlay, { osrsClient, plugin: this });
    }
}

export class TeleblockTimerPlugin extends StatusTimerPlugin {
    static descriptor: PluginDescriptor = {
        name: "Teleblock Timer",
        description: "Shows how long you are teleblocked.",
        tags: ["combat", "timer", "pvp", "teleport"],
        configKey: "teleblocktimerplugin",
    };

    renderHud(osrsClient: OsrsClient): ReactNode {
        return createElement(TeleblockTimerOverlay, { osrsClient, plugin: this });
    }
}

export class StaminaTimerPlugin extends StatusTimerPlugin {
    static descriptor: PluginDescriptor = {
        name: "Stamina Timer",
        description: "Shows how long your stamina potion lasts.",
        tags: ["timer", "potion", "run", "energy"],
        configKey: "staminatimerplugin",
    };

    renderHud(osrsClient: OsrsClient): ReactNode {
        return createElement(StaminaTimerOverlay, { osrsClient, plugin: this });
    }
}
