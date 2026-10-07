import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { BIOME_INFO, SEASON_INFO, WEATHER_INFO } from "./WeatherConditions";
import type { WeatherPlugin } from "./WeatherPlugin";
import "./WeatherOverlay.css";

/** RuneLite's CyclesOverlay (ABOVE_CHATBOX_RIGHT) plus LightningOverlay. */
export function WeatherOverlay({ plugin }: { plugin: WeatherPlugin }): JSX.Element | null {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [flash, setFlash] = useState(0);

    useEffect(() => {
        if (state.lightning <= 0) return;
        setFlash(state.lightning);
        const timeout = window.setTimeout(() => setFlash(0), 150);
        return () => window.clearTimeout(timeout);
    }, [state.lightning]);

    const weather = WEATHER_INFO[state.weather];
    const biome = BIOME_INFO[state.biome];
    const season = SEASON_INFO[state.season];
    const showPanel = state.enabled && state.overlayEnabled;

    return (
        <>
            {showPanel && (
                <div className="weather-overlay">
                    <img src={state.miniOverlay ? weather.miniImage : weather.image} alt={weather.name} />
                    <img src={state.miniOverlay ? biome.miniImage : biome.image} alt={biome.name} />
                    <img src={state.miniOverlay ? season.miniImage : season.image} alt={season.name} />
                </div>
            )}
            {flash > 0 && <div className="weather-lightning-flash" />}
        </>
    );
}
