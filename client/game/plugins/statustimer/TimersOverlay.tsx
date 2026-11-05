import { showAllTimers } from "../../../common/utils/DeviceUtil";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { IndexType } from "../../../rs/cache/IndexType";
import { skillIconSprite } from "../../../rs/skill/skillIcons";
import { SkillId } from "../../../rs/skill/skills";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { spriteToCanvas } from "../../../widgets/gl/texture-cache";
import type { OsrsClient } from "../../OsrsClient";
import { VENGEANCE_TIME_LIMIT_VARBIT } from "../vengeancetimer/VengeanceTimer";
import { VengeanceTimerOverlay } from "../vengeancetimer/VengeanceTimerOverlay";
import { mobileCombatTimerStyle } from "../../widgets/MobileHudLayout";
import type { TimersPlugin } from "./TimersPlugin";
import {
    AntifireTimerOverlay,
    FreezeTimerOverlay,
    PoisonTimerOverlay,
    StaminaTimerOverlay,
    TeleblockTimerOverlay,
    ANTIFIRE_TIMER_SECONDS_VARP,
    ANTIFIRE_TIMER_TYPE_VARP,
    FREEZE_TIMER_SECONDS_VARP,
    FREEZE_TIMER_SPELL_VARP,
    POISON_TIMER_SECONDS_VARP,
    POISON_TIMER_TYPE_VARP,
    STAMINA_TIMER_SECONDS_VARP,
    TELEBLOCK_TIMER_SECONDS_VARP,
} from "./StatusTimerOverlay";

export function TimersOverlay({
    osrsClient,
    plugin,
}: {
    osrsClient: OsrsClient;
    plugin: TimersPlugin;
}): JSX.Element | null {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getEnabled = useCallback(() => plugin.isEnabled(), [plugin]);
    const enabled = useSyncExternalStore(subscribe, getEnabled, getEnabled);
    const [, refresh] = useState(0);
    const [combatIcon, setCombatIcon] = useState<string>();

    useEffect(() => {
        if (!osrsClient.loadedCache || !osrsClient.cacheSystem) return;
        try {
            const sprites = osrsClient.cacheSystem.getIndex(IndexType.DAT2.sprites);
            const sprite = SpriteLoader.loadIntoIndexedSprite(sprites, skillIconSprite(SkillId.Attack));
            setCombatIcon(sprite ? spriteToCanvas(sprite).toDataURL() : undefined);
        } catch {
            setCombatIcon(undefined);
        }
    }, [osrsClient, osrsClient.loadedCache]);

    useEffect(() => {
        const timers = [
            [plugin.poison, POISON_TIMER_SECONDS_VARP, POISON_TIMER_TYPE_VARP],
            [plugin.freeze, FREEZE_TIMER_SECONDS_VARP, FREEZE_TIMER_SPELL_VARP],
            [plugin.antifire, ANTIFIRE_TIMER_SECONDS_VARP, ANTIFIRE_TIMER_TYPE_VARP],
            [plugin.teleblock, TELEBLOCK_TIMER_SECONDS_VARP],
            [plugin.stamina, STAMINA_TIMER_SECONDS_VARP],
        ] as const;
        const sync = () => {
            const now = Date.now();
            for (const [timer, secondsVarp, typeVarp] of timers) {
                timer.sync(
                    osrsClient.varManager?.getVarp(secondsVarp) ?? 0,
                    typeVarp === undefined ? 1 : (osrsClient.varManager?.getVarp(typeVarp) ?? 0),
                    now,
                );
            }
            plugin.vengeance.syncCooldownVarbit(
                osrsClient.varManager?.getVarbit(VENGEANCE_TIME_LIMIT_VARBIT) ?? 0,
                now,
            );
            if (plugin.isEnabled()) refresh(now);
        };
        // Track cooldown starts while hidden so re-enabling retains the real remaining time.
        sync();
        const interval = window.setInterval(sync, 200);
        return () => window.clearInterval(interval);
    }, [osrsClient, plugin]);

    if (!enabled || osrsClient.isOnLoginScreen()) return null;
    const now = Date.now();
    const attackTicks = plugin.attackTimerTicks();
    const attackStyle = mobileCombatTimerStyle(osrsClient, 6);
    return (
        <>
            <PoisonTimerOverlay osrsClient={osrsClient} plugin={plugin.poison} now={now} />
            <FreezeTimerOverlay osrsClient={osrsClient} plugin={plugin.freeze} now={now} />
            <AntifireTimerOverlay osrsClient={osrsClient} plugin={plugin.antifire} now={now} />
            <TeleblockTimerOverlay osrsClient={osrsClient} plugin={plugin.teleblock} now={now} />
            <StaminaTimerOverlay osrsClient={osrsClient} plugin={plugin.stamina} now={now} />
            <VengeanceTimerOverlay osrsClient={osrsClient} plugin={plugin.vengeance} now={now} />
            {!plugin.config.showAttackTimer() && (attackTicks > 0 || showAllTimers) && (
                <div className={`status-timer-infobox attack-timer-infobox${attackStyle ? " mobile-combat-timer" : ""}`} style={attackStyle} title="Next attack (ticks)">
                    {combatIcon && <img src={combatIcon} alt="" className="status-timer-icon" />}
                    <span className="status-timer-seconds">{attackTicks}</span>
                </div>
            )}
        </>
    );
}
