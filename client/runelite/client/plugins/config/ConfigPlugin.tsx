import { ConfigManager } from "../../config/ConfigManager";
import { ClientToolbar } from "../../ui/ClientToolbar";
import { NavigationButton } from "../../ui/NavigationButton";
import { PluginListPanel } from "../../ui/plugin/PluginListPanel";
import { Plugin, type PluginDescriptor } from "../Plugin";
import { inject } from "../PluginInjector";
import { PluginManager } from "../PluginManager";

function WrenchIcon({ label }: { label: string }): JSX.Element {
    return (
        <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}>
            <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17l3 3 5.5-5.5a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.4-.6-.6-2.4Z" />
        </svg>
    );
}

/**
 * RuneLite's Configuration plugin: always on and not listed itself, it puts the plugin hub
 * (every plugin with its switch and settings) behind the first sidebar button.
 */
export class ConfigPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Configuration",
        hidden: true,
        configKey: "configplugin",
    };

    private readonly clientToolbar = inject(ClientToolbar);
    private readonly pluginManager = inject(PluginManager);
    private readonly configManager = inject(ConfigManager);
    private navButton?: NavigationButton;

    protected async startUp(): Promise<void> {
        const pluginManager = this.pluginManager;
        const configManager = this.configManager;
        this.navButton = NavigationButton.builder()
            .tooltip("Configuration")
            .icon(WrenchIcon)
            .priority(0)
            .panel(() => (
                <PluginListPanel pluginManager={pluginManager} configManager={configManager} />
            ))
            .build();
        this.clientToolbar.addNavigation(this.navButton);
    }

    protected async shutDown(): Promise<void> {
        if (this.navButton) this.clientToolbar.removeNavigation(this.navButton);
        this.navButton = undefined;
    }
}
