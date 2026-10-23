import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { OsrsClient } from "../../OsrsClient";
import { IndexType } from "../../../rs/cache/IndexType";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { spriteToCanvas } from "../../../ui/item/ItemIcon";
import type { StatusTimerPlugin } from "./StatusTimerPlugin";
import "./StatusTimerOverlay.css";

const POISON_SPRITES: Record<number, number> = { 1: 1061, 2: 1102 };
const FREEZE_SPRITES: Record<number, number> = {
    1572: 319,
    1582: 320,
    1592: 321,
    12861: 325,
    12881: 326,
    12871: 327,
    12891: 328,
};

export const POISON_TIMER_SECONDS_VARP = 7996;
export const POISON_TIMER_TYPE_VARP = 7997;
export const FREEZE_TIMER_SECONDS_VARP = 7998;
export const FREEZE_TIMER_SPELL_VARP = 7999;

export function StatusTimerOverlay({
    className,
    fallback,
    osrsClient,
    plugin,
    secondsVarp,
    title,
    typeVarp,
    sprites,
}: {
    className: string;
    fallback: string;
    osrsClient: OsrsClient;
    plugin: StatusTimerPlugin;
    secondsVarp: number;
    title: string;
    typeVarp: number;
    sprites: Record<number, number>;
}): JSX.Element | null {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [now, setNow] = useState(Date.now());
    const [iconUrl, setIconUrl] = useState<string>();

    useEffect(() => {
        const sync = () => {
            plugin.sync(
                osrsClient.varManager?.getVarp(secondsVarp) ?? 0,
                osrsClient.varManager?.getVarp(typeVarp) ?? 0,
            );
            setNow(Date.now());
        };
        sync();
        const interval = window.setInterval(sync, 200);
        return () => window.clearInterval(interval);
    }, [osrsClient, plugin, secondsVarp, typeVarp]);

    useEffect(() => {
        const spriteId = sprites[state.type];
        if (!osrsClient.loadedCache || !osrsClient.cacheSystem || spriteId === undefined) return;
        try {
            const index = osrsClient.cacheSystem.getIndex(IndexType.DAT2.sprites);
            const sprite = SpriteLoader.loadIntoIndexedSprite(index, spriteId);
            setIconUrl(sprite ? spriteToCanvas(sprite).toDataURL() : undefined);
        } catch {
            setIconUrl(undefined);
        }
    }, [osrsClient, osrsClient.loadedCache, sprites, state.type]);

    const remaining = plugin.getRemainingSeconds(now);
    if (!state.config.enabled || !state.active || (state.endsAt !== null && remaining <= 0) || osrsClient.isOnLoginScreen()) {
        return null;
    }

    return (
        <div className={`status-timer-infobox ${className}`} title={title}>
            {iconUrl ? <img src={iconUrl} alt="" className="status-timer-icon" /> : <span className="status-timer-fallback">{fallback}</span>}
            <span className="status-timer-seconds">{state.endsAt === null ? "∞" : remaining}</span>
        </div>
    );
}

export function PoisonTimerOverlay({ osrsClient, plugin }: { osrsClient: OsrsClient; plugin: StatusTimerPlugin }): JSX.Element | null {
    return <StatusTimerOverlay className="poison-timer-infobox" fallback="☠" osrsClient={osrsClient} plugin={plugin} secondsVarp={POISON_TIMER_SECONDS_VARP} title="Poison" typeVarp={POISON_TIMER_TYPE_VARP} sprites={POISON_SPRITES} />;
}

export function FreezeTimerOverlay({ osrsClient, plugin }: { osrsClient: OsrsClient; plugin: StatusTimerPlugin }): JSX.Element | null {
    return <StatusTimerOverlay className="freeze-timer-infobox" fallback="❄" osrsClient={osrsClient} plugin={plugin} secondsVarp={FREEZE_TIMER_SECONDS_VARP} title="Frozen" typeVarp={FREEZE_TIMER_SPELL_VARP} sprites={FREEZE_SPRITES} />;
}
