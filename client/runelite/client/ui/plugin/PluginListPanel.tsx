import { useEffect, useReducer, useState } from "react";

import type { PluginClass } from "@runelite/client/plugins/Plugin";
import type { PluginManager } from "@runelite/client/plugins/PluginManager";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import { RuneLiteConfig } from "@runelite/client/config/RuneLiteConfig";
import { PluginConfigView } from "./PluginConfigView";
import { PluginListItem } from "./PluginListItem";
import { comparePlugins, getPinnedPlugins, setPluginPinned } from "./pinnedPlugins";
import { runeliteImage } from "@runelite/client/ui/runeliteImages";
import { onConfigurationRequest, takePendingConfiguration } from "@runelite/client/plugins/config/configurationRequests";

/** The client's own settings row, pinned above the plugins (RuneLite's "RuneLite" entry). */
const CLIENT_NAME = "RSPS.app";

type View = { kind: "list" } | { kind: "client" } | { kind: "plugin"; pluginClass: PluginClass };

function matches(pluginClass: PluginClass, needle: string): boolean {
    if (!needle) return true;
    const { name, description, tags } = pluginClass.descriptor;
    return [name, description ?? "", ...(tags ?? [])].join(" ").toLowerCase().includes(needle);
}

/**
 * The plugin hub (RuneLite's PluginListPanel): a search field, then every listed plugin with a
 * pin star, an on/off switch and, where it has settings, a cog that opens them as their own
 * view. Pinned plugins come first.
 */
export function PluginListPanel({
    pluginManager,
    configManager,
}: {
    pluginManager: PluginManager;
    configManager: ConfigManager;
}): JSX.Element {
    const [, forceUpdate] = useReducer((version: number) => version + 1, 0);
    useEffect(() => pluginManager.subscribe(forceUpdate), [pluginManager]);
    useEffect(
        () =>
            configManager.addListener((event) => {
                if (event.getGroup() === RuneLiteConfig.group) forceUpdate();
            }),
        [configManager],
    );
    const [search, setSearch] = useState("");
    const [view, setView] = useState<View>(() => {
        const requested = takePendingConfiguration();
        return requested ? { kind: "plugin", pluginClass: requested } : { kind: "list" };
    });
    useEffect(() => onConfigurationRequest((pluginClass) => {
        takePendingConfiguration();
        setView({ kind: "plugin", pluginClass });
    }), []);
    const back = (): void => setView({ kind: "list" });

    if (view.kind === "client") {
        return (
            <PluginConfigView
                name={CLIENT_NAME}
                descriptor={RuneLiteConfig}
                configManager={configManager}
                onBack={back}
            />
        );
    }
    if (view.kind === "plugin" && view.pluginClass.config) {
        const { pluginClass } = view;
        return (
            <PluginConfigView
                name={pluginClass.descriptor.name}
                descriptor={pluginClass.config!}
                configManager={configManager}
                onBack={back}
                onReset={() => pluginManager.getPlugin(pluginClass)?.resetConfiguration()}
            />
        );
    }

    const needle = search.trim().toLowerCase();
    const pinned = getPinnedPlugins(configManager);
    const pluginClasses = pluginManager
        .getPluginClasses()
        .filter((pluginClass) => !pluginClass.descriptor.hidden && matches(pluginClass, needle))
        .sort((a, b) =>
            comparePlugins(
                { name: a.descriptor.name, pinned: pinned.has(a.descriptor.name) },
                { name: b.descriptor.name, pinned: pinned.has(b.descriptor.name) },
                needle,
            ),
        );
    const showClientRow = !needle || CLIENT_NAME.toLowerCase().includes(needle);

    return (
        <div className="rl-plugin-list">
            {/* RuneLite's IconTextField: a search icon, the text, and a clear button. */}
            <div className="rl-plugin-search-bar">
                <label className="rl-plugin-search">
                    <img
                        className="rl-plugin-search-icon"
                        src={runeliteImage("search.png")}
                        alt=""
                        width={24}
                        height={24}
                    />
                    <input
                        type="search"
                        value={search}
                        aria-label="Search plugins"
                        onChange={(event) => setSearch(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape" && search) {
                                event.stopPropagation();
                                setSearch("");
                            }
                        }}
                    />
                    {search ? (
                        <button
                            type="button"
                            className="rl-plugin-search-clear"
                            aria-label="Clear search"
                            onClick={() => setSearch("")}
                        >
                            ×
                        </button>
                    ) : null}
                </label>
            </div>
            <div className="rl-sidebar-scrollable rl-plugin-list-items">
                {showClientRow ? (
                    <PluginListItem
                        name={CLIENT_NAME}
                        description="Client settings"
                        onOpenConfig={() => setView({ kind: "client" })}
                    />
                ) : null}
                {pluginClasses.map((pluginClass) => (
                    <PluginListItem
                        key={pluginManager.keyOf(pluginClass)}
                        name={pluginClass.descriptor.name}
                        description={pluginClass.descriptor.description}
                        failure={pluginManager.getFailure(pluginClass)}
                        pinned={pinned.has(pluginClass.descriptor.name)}
                        onPin={(pin) =>
                            setPluginPinned(configManager, pluginClass.descriptor.name, pin)
                        }
                        enabled={pluginManager.isEnabled(pluginClass)}
                        onToggle={pluginClass.descriptor.toggleable === false ? undefined : (enabled) =>
                            void pluginManager.setPluginEnabled(pluginClass, enabled)
                        }
                        onOpenConfig={
                            pluginClass.config
                                ? () => setView({ kind: "plugin", pluginClass })
                                : undefined
                        }
                    />
                ))}
                {pluginClasses.length === 0 && !showClientRow ? (
                    <p className="rl-sidebar-panel-copy">No plugins match “{search}”.</p>
                ) : null}
            </div>
        </div>
    );
}
