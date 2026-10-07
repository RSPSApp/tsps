import { strict as assert } from "node:assert";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ConfigStorage } from "@runelite/client/config/ConfigStorage";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { RuneLiteConfig, SidebarMode } from "@runelite/client/config/RuneLiteConfig";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { ConfigPlugin } from "@runelite/client/plugins/config/ConfigPlugin";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { PluginListPanel } from "@runelite/client/ui/plugin/PluginListPanel";
import { GroundItemsPlugin } from "../game/plugins/grounditems/GroundItemsPlugin";
import { MenuSwapperPlugin } from "../game/plugins/menuswapper/MenuSwapperPlugin";
import { NotesPlugin } from "../game/plugins/notes/NotesPlugin";
import { SidebarStore } from "../game/sidebar/SidebarStore";
import type { SidebarPersistedState } from "../game/sidebar/types";

class MemoryStorage implements ConfigStorage {
    private readonly values = new Map<string, string>();
    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
    removeItem(key: string): void {
        this.values.delete(key);
    }
    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }
    get length(): number {
        return this.values.size;
    }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const button = (tooltip: string, priority: number): NavigationButton =>
    NavigationButton.builder().tooltip(tooltip).priority(priority).build();

async function main(): Promise<void> {
    // ClientToolbar: RuneLite's order (priority, then tooltip), each button once.
    const toolbar = new ClientToolbar();
    let changes = 0;
    toolbar.subscribe(() => changes++);
    const notes = button("Notes", 7);
    const config = button("Configuration", 0);
    const xp = button("XP Tracker", 7);
    toolbar.addNavigation(notes);
    toolbar.addNavigation(xp);
    toolbar.addNavigation(config);
    toolbar.addNavigation(notes);
    assert.deepEqual(
        toolbar.getNavigations().map((b) => b.tooltip),
        ["Configuration", "Notes", "XP Tracker"],
    );
    assert.equal(changes, 3, "adding a button twice changes nothing");
    assert.equal(
        toolbar.getNavigations(),
        toolbar.getNavigations(),
        "the same array until it changes",
    );
    const opened: string[] = [];
    toolbar.onOpenPanel((b) => opened.push(b.tooltip));
    toolbar.removeNavigation(xp);
    toolbar.openPanel(xp);
    toolbar.openPanel(notes);
    assert.deepEqual(opened, ["Notes"], "only a button that's in the toolbar opens");

    // Plugins add their button while enabled and remove it when turned off.
    const configManager = new ConfigManager(undefined, new MemoryStorage());
    const pluginManager = new PluginManager(new EventBus(), configManager);
    const pluginToolbar = pluginManager.getInjector().get<ClientToolbar>(ClientToolbar);
    pluginManager.loadCorePlugins([
        ConfigPlugin,
        NotesPlugin,
        MenuSwapperPlugin,
        GroundItemsPlugin,
    ]);
    await settle();
    const tooltips = (): string[] => pluginToolbar.getNavigations().map((b) => b.tooltip);
    assert.deepEqual(
        tooltips(),
        ["Configuration", "Menu Entry Swapper"],
        "Notes is off by default",
    );
    await pluginManager.setPluginEnabled(NotesPlugin, true);
    assert.deepEqual(tooltips(), ["Configuration", "Menu Entry Swapper", "Notes"]);
    await pluginManager.setPluginEnabled(MenuSwapperPlugin, false);
    assert.deepEqual(tooltips(), ["Configuration", "Notes"]);

    // The hub: the client's own row first, listed plugins with a switch, a cog only with settings.
    const hub = renderToStaticMarkup(
        createElement(PluginListPanel, { pluginManager, configManager }),
    );
    assert.ok(hub.indexOf("RSPS.app") < hub.indexOf("Ground Items"), "client settings row first");
    assert.ok(!hub.includes(">Configuration<"), "the hidden Configuration plugin isn't listed");
    assert.ok(hub.includes('aria-label="Ground Items settings"'), "a cog where there are settings");
    assert.ok(!hub.includes('aria-label="Menu Entry Swapper settings"'), "no cog without settings");
    assert.ok(hub.includes('aria-checked="false" aria-label="Enable Menu Entry Swapper"'));
    assert.ok(hub.includes('aria-checked="true" aria-label="Disable Notes"'));

    // Reset puts a group back to its defaults; the sidebar mode defaults to docked.
    const runeLiteConfig = configManager.getConfig(RuneLiteConfig);
    assert.equal(runeLiteConfig.sidebarMode(), SidebarMode.Docked);
    configManager.setConfigValue(RuneLiteConfig, "sidebarMode", SidebarMode.Overlay);
    assert.equal(configManager.getConfiguration("runelite", "sidebarMode"), "Overlay");
    assert.equal(runeLiteConfig.sidebarMode(), SidebarMode.Overlay);
    configManager.setDefaultConfiguration(RuneLiteConfig, true);
    assert.equal(runeLiteConfig.sidebarMode(), SidebarMode.Docked);

    // SidebarStore: a rail click opens, a second click closes, and the open panel is remembered.
    let saved: SidebarPersistedState | undefined = { open: true, selectedId: "plugin_hub" };
    const persistence = {
        load: () => saved,
        save: (state: SidebarPersistedState) => (saved = state),
    };
    const store = new SidebarStore(persistence);
    assert.equal(store.getState().selected, "plugin_hub", "an old saved id just matches no button");
    store.toggle("Notes");
    assert.deepEqual(saved, { open: true, selectedId: "Notes" });
    store.toggle("Notes");
    assert.equal(store.getState().selected, null);
    assert.deepEqual(saved, { open: false, selectedId: null });
    assert.equal(
        new SidebarStore({
            load: () => ({ open: false, selectedId: "Notes" }),
            save() {},
        }).getState().selected,
        null,
    );

    console.log("runelite-client-toolbar.test.ts: all tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
