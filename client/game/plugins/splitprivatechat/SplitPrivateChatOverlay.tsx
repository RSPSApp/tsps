import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { OsrsClient } from "../../OsrsClient";
import { SPLIT_PRIVATE_CHAT_VARP, type SplitPrivateChatPlugin } from "./SplitPrivateChatPlugin";
import "./SplitPrivateChatOverlay.css";

export function SplitPrivateChatOverlay({
    osrsClient,
    plugin,
}: {
    osrsClient: OsrsClient;
    plugin: SplitPrivateChatPlugin;
}): JSX.Element | null {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [splitEnabled, setSplitEnabled] = useState(false);

    useEffect(() => {
        const sync = () => {
            const enabled = osrsClient.varManager?.getVarp(SPLIT_PRIVATE_CHAT_VARP) === 1;
            if (!enabled) {
                plugin.clear();
            }
            plugin.prune();
            setSplitEnabled(enabled);
        };
        sync();
        const interval = window.setInterval(sync, 250);
        return () => window.clearInterval(interval);
    }, [osrsClient, plugin]);

    if (osrsClient.isOnLoginScreen() || !splitEnabled || state.messages.length === 0) {
        return null;
    }

    return (
        <div className="split-private-chat" aria-live="polite">
            {state.messages.map((message, index) => (
                <div key={`${message.expiresAt}-${index}`} className="split-private-chat-message">
                    {message.text}
                </div>
            ))}
        </div>
    );
}
