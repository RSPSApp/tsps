import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { createMenuSwapperNavigationButton } from "./MenuSwapperPanel";
import { ClientState } from "../../ClientState";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import type { MenuTransformContext } from "../../../ui/menu/menuTransforms";
import { createBrowserMenuSwapperPluginPersistence } from "./BrowserMenuSwapperPersistence";
import { applyMenuSwaps } from "./menuSwaps";
import type {
    MenuSwapKind,
    MenuSwapperPluginConfig,
    MenuSwapperPluginPersistence,
    MenuSwapperPluginState,
} from "./types";

type MenuSwapperPluginListener = () => void;

const DEFAULT_CONFIG: MenuSwapperPluginConfig = Object.freeze({
    enabled: true,
    presets: { bank: false, trade: false, pickpocket: false, shiftDrop: false },
    swaps: {},
    shiftSwaps: {},
});

function withDefaults(
    saved: Partial<MenuSwapperPluginConfig> | undefined,
): MenuSwapperPluginConfig {
    return {
        enabled: saved?.enabled ?? DEFAULT_CONFIG.enabled,
        presets: { ...DEFAULT_CONFIG.presets, ...saved?.presets },
        swaps: { ...saved?.swaps },
        shiftSwaps: { ...saved?.shiftSwaps },
    };
}

/**
 * RuneLite-style menu entry swapper: Shift + right-click a target for "Swap left click" /
 * "Swap shift click", plus a few built-in presets. Swaps are saved per NPC, object or item id.
 */
export class MenuSwapperPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Menu Entry Swapper",
        description: "Choose the left-click and shift-click options of things.",
        tags: ["menu"],
        configKey: "menuentryswapper",
    };

    private readonly listeners = new Set<MenuSwapperPluginListener>();
    private readonly clientToolbar = inject(ClientToolbar);
    private navButton?: NavigationButton;
    private readonly persistence?: MenuSwapperPluginPersistence;
    private config: MenuSwapperPluginConfig;
    private state: MenuSwapperPluginState;
    private version = 0;

    constructor(persistence?: MenuSwapperPluginPersistence) {
        super();
        this.persistence = persistence ?? createBrowserMenuSwapperPluginPersistence("osrs.plugin.menu_swapper.v1");
        this.config = withDefaults(this.persistence?.load());
        this.state = { config: this.config, version: this.version };
    }

    protected async startUp(): Promise<void> {
        this.navButton = createMenuSwapperNavigationButton(this);
        this.clientToolbar.addNavigation(this.navButton);
    }

    protected async shutDown(): Promise<void> {
        if (this.navButton) this.clientToolbar.removeNavigation(this.navButton);
        this.navButton = undefined;
    }

    subscribe(listener: MenuSwapperPluginListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): MenuSwapperPluginState {
        return this.state;
    }

    setConfig(next: Partial<MenuSwapperPluginConfig>): void {
        if (next.enabled !== undefined) {
            void this.setPluginEnabled(next.enabled);
        }
        this.config = withDefaults({ ...this.config, ...next, enabled: this.isEnabled() });
        this.version++;
        this.state = { config: this.config, version: this.version };
        this.persistence?.save(this.config);
        for (const listener of this.listeners) listener();
    }

    /** Saves a swap for a target key, or clears it when `option` is null. */
    setSwap(kind: MenuSwapKind, key: string, option: string | null, name: string): void {
        const field = kind === "left" ? "swaps" : "shiftSwaps";
        const swaps = { ...this.config[field] };
        if (option === null) delete swaps[key];
        else swaps[key] = { option, name };
        this.setConfig({ [field]: swaps });
    }

    resetSwaps(): void {
        this.setConfig({ swaps: {}, shiftSwaps: {} });
    }

    transformMenuEntries(
        entries: SimpleMenuEntry[],
        context: MenuTransformContext,
    ): SimpleMenuEntry[] {
        return applyMenuSwaps(
            entries,
            { ...context, isShiftHeld: ClientState.isShiftPressed() },
            { ...this.config, enabled: this.isEnabled() },
            (kind, key, option, name) => this.setSwap(kind, key, option, name),
        );
    }
}
