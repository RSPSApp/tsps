import { useSyncExternalStore } from "react";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import { isPortraitLeftHanded, subscribePortraitHandedness } from "./PortraitLayout";
import { PortraitModeConfig } from "./PortraitModePlugin";

const HAND =
    "M7 24 3 17c-1-2 1-3 2-2l2 2V7c0-2 3-2 3 0v5-8c0-2 3-2 3 0v8-6c0-2 3-2 3 0v7-4c0-2 3-2 3 0v9l-2 6Z";

export function PortraitHandednessButton({
    configManager,
}: {
    configManager: ConfigManager;
}): JSX.Element {
    const left = useSyncExternalStore(subscribePortraitHandedness, isPortraitLeftHanded);
    return (
        <button
            type="button"
            className="rl-sidebar-rail-button portrait-handedness-toggle"
            aria-label="Left-handed mode"
            aria-pressed={left}
            title={`${left ? "Left" : "Right"}-handed mode — switch to ${left ? "right" : "left"}-handed mode`}
            onClick={() => configManager.setConfigValue(PortraitModeConfig, "leftHanded", !left)}
        >
            <svg className="portrait-handedness-icon" viewBox="0 0 48 28" aria-hidden="true">
                <path
                    d={HAND}
                    transform="translate(22 0) scale(-1 1)"
                    opacity={left ? 1 : 0.25}
                    data-hand="left"
                />
                <path
                    d={HAND}
                    transform="translate(25 0)"
                    opacity={left ? 0.25 : 1}
                    data-hand="right"
                />
            </svg>
        </button>
    );
}
