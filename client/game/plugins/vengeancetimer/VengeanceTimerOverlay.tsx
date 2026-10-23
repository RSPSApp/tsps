import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { OsrsClient } from "../../OsrsClient";
import { IndexType } from "../../../rs/cache/IndexType";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { spriteToCanvas } from "../../../ui/item/ItemIcon";
import { VENGEANCE_TIME_LIMIT_VARBIT, type VengeanceTimerPlugin } from "./VengeanceTimerPlugin";
import "./VengeanceTimerOverlay.css";

const VENGEANCE_SPRITE_ID = 564;

export function VengeanceTimerOverlay({
    osrsClient,
    plugin,
}: {
    osrsClient: OsrsClient;
    plugin: VengeanceTimerPlugin;
}): JSX.Element | null {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [now, setNow] = useState(Date.now());
    const [iconUrl, setIconUrl] = useState<string>();

    useEffect(() => {
        const sync = () => {
            const value = osrsClient.varManager?.getVarbit(VENGEANCE_TIME_LIMIT_VARBIT) ?? 0;
            plugin.syncCooldownVarbit(value);
            setNow(Date.now());
        };

        sync();
        const interval = window.setInterval(sync, 200);
        return () => window.clearInterval(interval);
    }, [osrsClient, plugin]);

    useEffect(() => {
        if (!osrsClient.loadedCache || !osrsClient.cacheSystem) {
            return;
        }
        try {
            const spriteIndex = osrsClient.cacheSystem.getIndex(IndexType.DAT2.sprites);
            const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, VENGEANCE_SPRITE_ID);
            if (sprite) {
                setIconUrl(spriteToCanvas(sprite).toDataURL());
            }
        } catch {}
    }, [osrsClient, osrsClient.loadedCache]);

    const remaining = plugin.getRemainingSeconds(now);
    if (
        !state.config.enabled ||
        state.cooldownEndsAt === null ||
        remaining <= 0 ||
        osrsClient.isOnLoginScreen()
    ) {
        return null;
    }

    return (
        <div className="vengeance-timer-infobox" title="Vengeance cooldown">
            {iconUrl ? (
                <img src={iconUrl} alt="" className="vengeance-timer-icon" />
            ) : (
                <span className="vengeance-timer-fallback">V</span>
            )}
            <span className="vengeance-timer-seconds">{remaining}</span>
        </div>
    );
}
