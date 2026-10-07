import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { createBrowserRememberLoginPluginPersistence } from "./BrowserRememberLoginPluginPersistence";
import type {
    LoginCredentialsTarget,
    RememberLoginPluginConfig,
    RememberLoginPluginPersistence,
    RememberLoginPluginState,
} from "./types";

type RememberLoginPluginListener = () => void;

const DEFAULT_CONFIG: RememberLoginPluginConfig = Object.freeze({
    enabled: false,
    username: "",
    password: "",
});

const STORAGE_KEY = "osrs.plugin.remember_login.v1";

export class RememberLoginPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Remember Login",
        description: "Restores credentials stored unencrypted in this browser.",
        tags: ["login"],
        configKey: "rememberloginplugin",
    };

    private readonly listeners = new Set<RememberLoginPluginListener>();
    private readonly persistence?: RememberLoginPluginPersistence;
    private config: RememberLoginPluginConfig;
    private version = 0;

    constructor(persistence?: RememberLoginPluginPersistence) {
        super();
        this.persistence = persistence ?? createBrowserRememberLoginPluginPersistence(STORAGE_KEY);
        const loaded = this.persistence?.load();
        if (typeof loaded?.enabled === "boolean") this.setEnabledState(loaded.enabled);
        this.config = this.sanitizeConfig(loaded);
    }

    subscribe(listener: RememberLoginPluginListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): RememberLoginPluginState {
        return { config: this.getConfig(), version: this.version };
    }

    getConfig(): RememberLoginPluginConfig {
        return { ...this.config, enabled: this.isEnabled() };
    }

    setConfig(nextConfig: Partial<RememberLoginPluginConfig>): void {
        if (nextConfig.enabled !== undefined) {
            void this.setPluginEnabled(nextConfig.enabled);
            if (!nextConfig.enabled) this.clearCredentials();
        }
        this.config = this.sanitizeConfig({ ...this.config, ...nextConfig, enabled: this.isEnabled() });
        this.commit();
    }

    setEnabled(enabled: boolean, username = "", password = ""): void {
        void this.setPluginEnabled(enabled);
        if (!enabled) {
            this.clearCredentials();
            this.commit();
            return;
        }
        this.config = { ...this.config, enabled: true };
        this.remember(username, password);
    }

    remember(username: string, password: string): void {
        if (!this.isEnabled() || username.trim().length === 0 || password.length === 0) return;
        this.config = this.sanitizeConfig({ ...this.config, username, password });
        this.commit();
    }

    restore(target: LoginCredentialsTarget): void {
        if (!this.isEnabled() || !this.config.username || !this.config.password) return;
        target.username = this.config.username;
        target.password = this.config.password;
        target.currentLoginField = 1;
    }

    protected async shutDown(): Promise<void> {
        this.clearCredentials();
        this.commit();
    }

    private clearCredentials(): void {
        this.config = { ...this.config, username: "", password: "" };
        this.persistence?.save(this.config);
    }

    private sanitizeConfig(
        input: Partial<RememberLoginPluginConfig> | undefined,
    ): RememberLoginPluginConfig {
        return {
            enabled: input?.enabled ?? DEFAULT_CONFIG.enabled,
            username:
                typeof input?.username === "string"
                    ? input.username.slice(0, 320)
                    : DEFAULT_CONFIG.username,
            password:
                typeof input?.password === "string"
                    ? input.password.slice(0, 20)
                    : DEFAULT_CONFIG.password,
        };
    }

    private commit(): void {
        this.version++;
        this.persistence?.save(this.config);
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.log("[remember-login-plugin] listener failed", err);
            }
        }
    }
}
