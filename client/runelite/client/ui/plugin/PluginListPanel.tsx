import { useEffect, useReducer, useState } from "react";

import type { PluginClass } from "@runelite/client/plugins/Plugin";
import type { PluginManager } from "@runelite/client/plugins/PluginManager";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import { RuneLiteConfig } from "@runelite/client/config/RuneLiteConfig";
import { PluginConfigView } from "./PluginConfigView";
import { PluginListItem } from "./PluginListItem";

/** The client's own settings row, pinned above the plugins (RuneLite's "RuneLite" entry). */
const CLIENT_NAME = "RSPS.app";

type View = { kind: "list" } | { kind: "client" } | { kind: "plugin"; pluginClass: PluginClass };

function matches(pluginClass: PluginClass, needle: string): boolean {
    if (!needle) return true;
    const { name, description, tags } = pluginClass.descriptor;
    return [name, description ?? "", ...(tags ?? [])].join(" ").toLowerCase().includes(needle);
}

/**
 * The plugin hub (RuneLite's PluginListPanel): every listed plugin with an on/off switch and,
 * where it has settings, a cog that opens them as their own view.
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
    const [search, setSearch] = useState("");
    const [view, setView] = useState<View>({ kind: "list" });
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
    const pluginClasses = pluginManager
        .getPluginClasses()
        .filter((pluginClass) => !pluginClass.descriptor.hidden && matches(pluginClass, needle))
        .sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name));
    const showClientRow = !needle || CLIENT_NAME.toLowerCase().includes(needle);

    return (
        <div className="rl-plugin-list">
            <input
                type="search"
                className="rl-plugin-search"
                value={search}
                placeholder="Search plugins"
                aria-label="Search plugins"
                onChange={(event) => setSearch(event.target.value)}
            />
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
                        enabled={pluginManager.isEnabled(pluginClass)}
                        onToggle={(enabled) =>
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
