import { useEffect, useState } from "react";

import type { ConfigManager } from "../runelite/client/config/ConfigManager";
import { RuneLiteConfig } from "../runelite/client/config/RuneLiteConfig";
import type { ProtocolNotice } from "../network/serverConnection/protocolCompatibility";

/** Presentation only: hiding a notice never changes the world's compatibility state. */
export function ProtocolNoticeBanner({ notice, configManager }: {
    notice: ProtocolNotice;
    configManager: ConfigManager;
}): JSX.Element | null {
    const config = configManager.getConfig(RuneLiteConfig);
    const [enabled, setEnabled] = useState(() => config.showProtocolCompatibilityNotices());
    const [visible, setVisible] = useState<ProtocolNotice>();

    useEffect(() => {
        setEnabled(config.showProtocolCompatibilityNotices());
        return configManager.addListener((event) => {
            if (event.getGroup() === RuneLiteConfig.group) {
                setEnabled(config.showProtocolCompatibilityNotices());
            }
        });
    }, [configManager, config]);

    useEffect(() => {
        setVisible(enabled ? notice : undefined);
        if (!enabled || !notice) return;
        const timer = setTimeout(() => setVisible(undefined), 3000);
        return () => clearTimeout(timer);
    }, [notice, enabled]);

    if (!enabled || !visible) return null;
    return (
        <div className="protocol-notice" role={visible.kind === "error" ? "alert" : "status"}>
            {visible.message}
        </div>
    );
}
