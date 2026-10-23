import type { ConfigGroupDescriptor } from "@runelite/client/config/ConfigItem";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import { ConfigPanel } from "@runelite/client/ui/config/ConfigPanel";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";

function NPCIndicatorsIcon({ label }: { label: string }): JSX.Element {
    return (
        <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}>
            <circle cx="12" cy="8" r="3" />
            <path d="M6 19v-2a6 6 0 0 1 12 0v2M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
        </svg>
    );
}

/** Reuse the hub's generated settings so both entry points edit the same stored values. */
export function createNPCIndicatorsNavigationButton(descriptor: ConfigGroupDescriptor, configManager: ConfigManager): NavigationButton {
    return NavigationButton.builder()
        .tooltip("NPC Indicators")
        .icon(NPCIndicatorsIcon)
        .priority(6)
        .panel(() => <ConfigPanel descriptor={descriptor} configManager={configManager} />)
        .build();
}
