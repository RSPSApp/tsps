import { type ConfigGroupDescriptor, type ConfigOf, isConfigGroupDescriptor } from "../config/ConfigItem";
import { ConfigManager } from "../config/ConfigManager";
import { ClientToolbar } from "../ui/ClientToolbar";

/**
 * Angular-style injector: PluginManager sets the current injector while it
 * constructs plugins, so `inject(Token)` resolves there.
 */
export class PluginInjector {
    private readonly singletons = new Map<unknown, unknown>();

    constructor(private readonly configManager: ConfigManager) {}

    provide<T>(token: unknown, instance: T): this {
        this.singletons.set(token, instance);
        return this;
    }

    get<T>(token: unknown): T {
        if (isConfigGroupDescriptor(token)) {
            return this.configManager.getConfig(token) as unknown as T;
        }
        if (!this.singletons.has(token)) {
            const name = typeof token === "function" ? token.name : String(token);
            throw new Error(`[PluginInjector] no binding for ${name}`);
        }
        return this.singletons.get(token) as T;
    }

    runWith<T>(fn: () => T): T {
        const previous = currentInjector;
        currentInjector = this;
        try {
            return fn();
        } finally {
            currentInjector = previous;
        }
    }
}

let currentInjector: PluginInjector | undefined;
let fallbackInjector: PluginInjector | undefined;

/**
 * Token for the engine client. The RuneLite-shaped `Client` facade (plan
 * §4.4) is not built yet, so plugins bind the engine client under this name
 * and keep the `OsrsClient` type via `import type`.
 */
export const CLIENT_TOKEN = "Client";

/** `private client = inject(Client)` — RuneLite's `@Inject` convention. */
export function inject<T>(token: new (...args: never[]) => T): T;
export function inject<T>(token: string): T;
export function inject<D extends ConfigGroupDescriptor>(token: D): ConfigOf<D>;
export function inject(token: unknown): unknown {
    const injector = currentInjector ?? (fallbackInjector ??= createFallbackInjector());
    return injector.get(token);
}

// Tests and standalone construction (`new GroundItemsPlugin()`) have no
// PluginManager, so config falls back to a memory-backed injector.
function createFallbackInjector(): PluginInjector {
    const configManager = new ConfigManager(undefined);
    return new PluginInjector(configManager)
        .provide(ConfigManager, configManager)
        .provide(ClientToolbar, new ClientToolbar());
}
