import { useEffect, useState } from "react";
import type { ConfigGroupDescriptor } from "@runelite/client/config/ConfigItem";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import { ConfigPanel } from "../config/ConfigPanel";

/**
 * One plugin's settings, opened from the hub as its own view (RuneLite's ConfigPanel):
 * a back arrow to the list, the name, and "Reset" to put every setting back to its default.
 * A group may word these itself (`viewLabels`), as a translation plugin does for its language.
 */
export function PluginConfigView({
    name,
    descriptor,
    configManager,
    onBack,
    onReset,
}: {
    name: string;
    descriptor: ConfigGroupDescriptor;
    configManager: ConfigManager;
    onBack: () => void;
    onReset?: () => void;
}): JSX.Element {
    // Redraw on the group's changes only when its labels may depend on them.
    const [, setVersion] = useState(0);
    useEffect(() => {
        if (!descriptor.viewLabels) return undefined;
        return configManager.addListener((event) => {
            if (event.getGroup() === descriptor.group) setVersion((version) => version + 1);
        });
    }, [configManager, descriptor]);

    const labels = descriptor.viewLabels?.() ?? {};
    const reset = (): void => {
        const question = labels.resetConfirm?.(name) ?? `Reset every ${name} setting to its default?`;
        if (!window.confirm(question)) return;
        configManager.setDefaultConfiguration(descriptor, true);
        onReset?.();
    };
    return (
        <div className="rl-plugin-config">
            <div className="rl-plugin-config-header">
                <button
                    type="button"
                    className="rl-plugin-config-back"
                    onClick={onBack}
                    aria-label={labels.back ?? "Back to plugins"}
                    title={labels.back ?? "Back"}
                >
                    <svg viewBox="0 0 12 20" aria-hidden="true">
                        <path d="M8.4 3.1 3.9 10l4.5 6.9" />
                    </svg>
                </button>
                <span className="rl-plugin-config-title">{name}</span>
                <button type="button" className="rl-sidebar-text-button" onClick={reset}>
                    {labels.reset ?? "Reset"}
                </button>
            </div>
            <div className="rl-sidebar-scrollable rl-plugin-config-body">
                <ConfigPanel descriptor={descriptor} configManager={configManager} />
            </div>
        </div>
    );
}
