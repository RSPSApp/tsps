import type { ConfigGroupDescriptor } from "@runelite/client/config/ConfigItem";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import { ConfigPanel } from "../config/ConfigPanel";

/**
 * One plugin's settings, opened from the hub as its own view (RuneLite's ConfigPanel):
 * a back arrow to the list, the name, and "Reset" to put every setting back to its default.
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
    const reset = (): void => {
        if (!window.confirm(`Reset every ${name} setting to its default?`)) return;
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
                    aria-label="Back to plugins"
                    title="Back"
                >
                    <svg viewBox="0 0 12 20" aria-hidden="true">
                        <path d="M8.4 3.1 3.9 10l4.5 6.9" />
                    </svg>
                </button>
                <span className="rl-plugin-config-title">{name}</span>
                <button type="button" className="rl-sidebar-text-button" onClick={reset}>
                    Reset
                </button>
            </div>
            <div className="rl-sidebar-scrollable rl-plugin-config-body">
                <ConfigPanel descriptor={descriptor} configManager={configManager} />
            </div>
        </div>
    );
}
