import { useEffect, useState } from "react";

import type { OsrsClient } from "../../OsrsClient";
import { IndexType } from "../../../rs/cache/IndexType";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { spriteToCanvas } from "../../../ui/item/ItemIcon";
import { showAllTimers } from "../../../common/utils/DeviceUtil";
import type { VengeanceTimer } from "./VengeanceTimer";
import "./VengeanceTimerOverlay.css";
import { mobileCombatTimerStyle } from "../../widgets/MobileHudLayout";
import "../../widgets/MobileHudLayout.css";

const VENGEANCE_SPRITE_ID = 564;

export function VengeanceTimerOverlay({
    osrsClient,
    plugin,
    now,
}: {
    osrsClient: OsrsClient;
    plugin: VengeanceTimer;
    now: number;
}): JSX.Element | null {
    const [iconUrl, setIconUrl] = useState<string>();

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
        (!showAllTimers && remaining <= 0) ||
        osrsClient.isOnLoginScreen()
    ) {
        return null;
    }

    const mobileStyle = mobileCombatTimerStyle(osrsClient, 5);
    return (
        <div className={`vengeance-timer-infobox${mobileStyle ? " mobile-combat-timer" : ""}`} style={mobileStyle} title="Vengeance cooldown">
            {iconUrl ? (
                <img src={iconUrl} alt="" className="vengeance-timer-icon" />
            ) : (
                <span className="vengeance-timer-fallback">V</span>
            )}
            <span className="vengeance-timer-seconds">{remaining}</span>
        </div>
    );
}
