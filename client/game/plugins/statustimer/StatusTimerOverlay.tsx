import { useEffect, useState } from "react";

import type { OsrsClient } from "../../OsrsClient";
import { IndexType } from "../../../rs/cache/IndexType";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { spriteToCanvas } from "../../../ui/item/ItemIcon";
import { ItemIconRenderer } from "../../../ui/item/ItemIconRenderer";
import { showAllTimers } from "../../../common/utils/DeviceUtil";
import type { StatusTimer } from "./StatusTimer";
import "./StatusTimerOverlay.css";
import { mobileCombatTimerStyle } from "../../widgets/MobileHudLayout";
import "../../widgets/MobileHudLayout.css";

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
// Sent by server/plugins/interface/BuffTimers.plugin.js.
export const ANTIFIRE_TIMER_SECONDS_VARP = 7990;
export const ANTIFIRE_TIMER_TYPE_VARP = 7991;
export const TELEBLOCK_TIMER_SECONDS_VARP = 7992;
export const STAMINA_TIMER_SECONDS_VARP = 7993;

// RuneLite GameTimer icons: antifire (normal and extended) and super antifire (normal and
// extended) are the 4-dose potions, teleblock is the spell sprite (Magicon2.TELE_BLOCK).
const ANTIFIRE_ITEMS: Record<number, number> = { 1: 2452, 2: 21978 };
const TELEBLOCK_SPRITES: Record<number, number> = { 1: 352 };
const STAMINA_ITEMS: Record<number, number> = { 1: 12625 };
const NO_SPRITES: Record<number, number> = {};
const MOBILE_SLOTS: Record<string, number> = {
    "poison-timer-infobox": 0, "freeze-timer-infobox": 1, "antifire-timer-infobox": 2,
    "teleblock-timer-infobox": 3, "stamina-timer-infobox": 4,
};

/** Timers without a type varp always have this type. */
const SINGLE_TYPE = 1;

const itemIconRenderers = new WeakMap<object, ItemIconRenderer>();

function renderItemIcon(osrsClient: OsrsClient, itemId: number): string | undefined {
    const { objTypeLoader, modelLoader, textureLoader } = osrsClient;
    if (!objTypeLoader || !modelLoader || !textureLoader) return undefined;
    let renderer = itemIconRenderers.get(objTypeLoader);
    if (!renderer) {
        renderer = new ItemIconRenderer(objTypeLoader, modelLoader, textureLoader, osrsClient.cacheSystem);
        itemIconRenderers.set(objTypeLoader, renderer);
    }
    return renderer.renderToCanvas(itemId, 1, { outline: 1, quantityMode: 0 })?.toDataURL();
}

export function StatusTimerOverlay({
    className,
    fallback,
    osrsClient,
    plugin,
    now,
    title,
    sprites,
    items,
}: {
    className: string;
    fallback: string;
    osrsClient: OsrsClient;
    plugin: StatusTimer;
    now: number;
    title: string;
    sprites: Record<number, number>;
    /** Item icons, by type, for types without a sprite. */
    items?: Record<number, number>;
}): JSX.Element | null {
    const state = plugin.getState();
    const [iconUrl, setIconUrl] = useState<string>();
    const iconType = state.type || (showAllTimers ? Number(Object.keys(sprites)[0] ?? Object.keys(items ?? {})[0] ?? SINGLE_TYPE) : 0);

    useEffect(() => {
        const spriteId = sprites[iconType];
        const itemId = items?.[iconType];
        if (!osrsClient.loadedCache || !osrsClient.cacheSystem || (spriteId === undefined && itemId === undefined)) return;
        try {
            if (spriteId === undefined) {
                setIconUrl(renderItemIcon(osrsClient, itemId!));
                return;
            }
            const index = osrsClient.cacheSystem.getIndex(IndexType.DAT2.sprites);
            const sprite = SpriteLoader.loadIntoIndexedSprite(index, spriteId);
            setIconUrl(sprite ? spriteToCanvas(sprite).toDataURL() : undefined);
        } catch {
            setIconUrl(undefined);
        }
    }, [osrsClient, osrsClient.loadedCache, sprites, items, iconType]);

    const remaining = plugin.getRemainingSeconds(now);
    if (osrsClient.isOnLoginScreen() || (!showAllTimers && (!state.active || (state.endsAt !== null && remaining <= 0)))) {
        return null;
    }

    const mobileStyle = mobileCombatTimerStyle(osrsClient, MOBILE_SLOTS[className]);
    return (
        <div className={`status-timer-infobox ${className}${mobileStyle ? " mobile-combat-timer" : ""}`} style={mobileStyle} title={title}>
            {iconUrl ? <img src={iconUrl} alt="" className="status-timer-icon" /> : <span className="status-timer-fallback">{fallback}</span>}
            <span className="status-timer-seconds">{!state.active ? 0 : state.endsAt === null ? "∞" : remaining}</span>
        </div>
    );
}

type TimerOverlayProps = { osrsClient: OsrsClient; plugin: StatusTimer; now: number };

export function PoisonTimerOverlay({ osrsClient, plugin, now }: TimerOverlayProps): JSX.Element | null {
    return <StatusTimerOverlay className="poison-timer-infobox" fallback="☠" osrsClient={osrsClient} plugin={plugin} now={now} title="Poison" sprites={POISON_SPRITES} />;
}

export function FreezeTimerOverlay({ osrsClient, plugin, now }: TimerOverlayProps): JSX.Element | null {
    return <StatusTimerOverlay className="freeze-timer-infobox" fallback="❄" osrsClient={osrsClient} plugin={plugin} now={now} title="Frozen" sprites={FREEZE_SPRITES} />;
}

export function AntifireTimerOverlay({ osrsClient, plugin, now }: TimerOverlayProps): JSX.Element | null {
    return <StatusTimerOverlay className="antifire-timer-infobox" fallback="🔥" osrsClient={osrsClient} plugin={plugin} now={now} title="Antifire" sprites={NO_SPRITES} items={ANTIFIRE_ITEMS} />;
}

export function TeleblockTimerOverlay({ osrsClient, plugin, now }: TimerOverlayProps): JSX.Element | null {
    return <StatusTimerOverlay className="teleblock-timer-infobox" fallback="⊘" osrsClient={osrsClient} plugin={plugin} now={now} title="Teleblock" sprites={TELEBLOCK_SPRITES} />;
}

export function StaminaTimerOverlay({ osrsClient, plugin, now }: TimerOverlayProps): JSX.Element | null {
    return <StatusTimerOverlay className="stamina-timer-infobox" fallback="⚡" osrsClient={osrsClient} plugin={plugin} now={now} title="Stamina" sprites={NO_SPRITES} items={STAMINA_ITEMS} />;
}
