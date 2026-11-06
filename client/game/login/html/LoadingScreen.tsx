import { useEffect, useState } from "react";
import { BRAND_NAME } from "../../../config/brand";
import { GameState } from "../GameState";
import type { OsrsClient } from "../../OsrsClient";
import { useSubscribedGameState } from "../../useSubscribedGameState";
import { STRINGS, useLanguage } from "./strings";
import "./LoadingScreen.css";

const PUBLIC_PATH = `${(process.env.PUBLIC_URL ?? "").replace(/\/$/, "")}/`;

/** The bar is a row of blocks, not a sliding fill: the same pip language as the Idle screen. */
const PIPS = 32;

export type DownloadProgress = { current: number; total: number };

function formatBytes(bytes: number): string {
    if (!(bytes > 0)) return "";
    const mb = bytes / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * The loading screen, ours rather than the cache's.
 *
 * It stands in for two different waits that used to look like two different games: the first-visit
 * cache download (a red bar drawn into a black canvas) and the pause after sign-in while the world
 * arrives. Both are the same screen here, carrying the login art, so the way in reads as one
 * sequence instead of three unrelated screens.
 *
 * The world phase has no event to subscribe to — `loginState.loadingPercent` is written straight
 * into a plain object by the client — so it is read on a short interval, and only while the screen
 * is actually up.
 */
export function LoadingScreen({
    osrsClient,
    download,
}: {
    osrsClient: OsrsClient;
    download?: DownloadProgress;
}) {
    const gameState = useSubscribedGameState(osrsClient.stateMachine);
    const [lang] = useLanguage();
    const t = STRINGS[lang];
    const [, tick] = useState(0);

    const downloading = !!download && download.total > 0;
    const entering = gameState === GameState.LOADING_GAME;
    const showing = downloading || entering;

    useEffect(() => {
        if (!entering) return undefined;
        const timer = setInterval(() => tick((n) => n + 1), 200);
        return () => clearInterval(timer);
    }, [entering]);

    if (!showing) return null;

    const percent = downloading
        ? Math.max(0, Math.min(100, Math.round((download!.current / download!.total) * 100)))
        : Math.max(0, Math.min(100, osrsClient.loginState.loadingPercent | 0));
    const heading = downloading ? t.loadCache : t.loadWorld;
    // The client's own word for what it is doing beats a guess, when it has one.
    const detail = downloading
        ? `${formatBytes(download!.current)} / ${formatBytes(download!.total)}`
        : osrsClient.loginState.loadingText || "";
    const lit = Math.round((percent / 100) * PIPS);
    // Stable for the length of one wait rather than cycling: a line that changes under the eye
    // while you are watching a bar is read twice and understood neither time.
    const tip = downloading ? t.loadFirst : t.tips[percent < 100 ? (percent / 25) | 0 : 3] ?? t.tips[0];

    return (
        <div className="osi-load" lang={lang === "pt" ? "pt-BR" : lang}>
            <img className="osi-load__plate" src={`${PUBLIC_PATH}branding/login-plate.webp`} alt="" aria-hidden="true" />
            <div className="osi-load__wash" aria-hidden="true" />

            <div className="osi-load__body" role="status" aria-live="polite">
                <span className="osi-load__crest" aria-hidden="true">OS</span>
                <b className="osi-load__brand">{BRAND_NAME}</b>
                <span className="osi-load__heading">{heading}</span>

                <div className="osi-load__bar" aria-hidden="true">
                    {Array.from({ length: PIPS }, (_, i) => (
                        <i key={i} className={i < lit ? "is-lit" : undefined} />
                    ))}
                </div>

                <div className="osi-load__meta">
                    <span className="osi-load__percent">{percent}%</span>
                    {detail && <span className="osi-load__detail">{detail}</span>}
                </div>

                <p className="osi-load__tip">{tip}</p>
            </div>
        </div>
    );
}
