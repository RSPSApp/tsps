import { useEffect, useRef, useState } from "react";
import { BRAND_NAME } from "../../../config/brand";
import { GameState } from "../GameState";
import type { OsrsClient } from "../../OsrsClient";
import { useSubscribedGameState } from "../../useSubscribedGameState";
import { STRINGS, useLanguage, type Lang } from "./strings";
import "./LoginScreen.css";

/** Upstream mounts the client under /play; this build sits at the root. Either way the art is
 *  beside index.html, so the path has to come from the build rather than be written in. */
const PUBLIC_PATH = `${(process.env.PUBLIC_URL ?? "").replace(/\/$/, "")}/`;

const LANGS: Lang[] = ["pt", "en", "es"];
const LANG_LABEL: Record<Lang, string> = { pt: "PT", en: "EN", es: "ES" };

/**
 * The login screen, as a page rather than something painted into the canvas.
 *
 * The canvas login still exists underneath and still owns the protocol: this only fills in the
 * fields and calls `loginFromForm`, which takes the same path the canvas form takes. What it buys
 * is real text inputs (the canvas ones are hand-rolled and awkward on mobile and for password
 * managers), real fonts and layout instead of the cache's two bitmap faces, and a size that
 * reflows — which is the same list the mobile item on the roadmap is waiting for.
 */
export function LoginScreen({ osrsClient }: { osrsClient: OsrsClient }) {
    const gameState = useSubscribedGameState(osrsClient.stateMachine);
    const [lang, setLang] = useLanguage();
    const [username, setUsername] = useState(() => osrsClient.loginState.username ?? "");
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(() => osrsClient.loginState.rememberUsername ?? false);
    const [complaint, setComplaint] = useState<string | undefined>();
    const usernameRef = useRef<HTMLInputElement>(null);
    const t = STRINGS[lang];

    const connecting = gameState === GameState.CONNECTING;
    const onLogin = gameState === GameState.LOGIN_SCREEN;

    useEffect(() => {
        if (onLogin && !osrsClient.loginState.username) usernameRef.current?.focus();
    }, [onLogin, osrsClient]);

    // A rejected login comes back to the login screen with the reason in the response lines.
    useEffect(() => {
        if (!onLogin) return;
        const state = osrsClient.loginState;
        const said = [state.response0, state.response1, state.response2].filter(Boolean).join(" ").trim();
        if (said) setComplaint(said);
    }, [onLogin, osrsClient]);

    if (!onLogin && !connecting) return null;

    function submit(event: React.FormEvent) {
        event.preventDefault();
        setComplaint(undefined);
        const said = osrsClient.loginFromForm(username.trim(), password, remember);
        if (said) setComplaint(said);
    }

    return (
        <div className="osi-login" lang={lang === "pt" ? "pt-BR" : lang}>
            <img className="osi-login__plate" src={`${PUBLIC_PATH}branding/login-plate.webp`} alt="" aria-hidden="true" />
            <div className="osi-login__wash osi-login__wash--left" aria-hidden="true" />
            <div className="osi-login__wash osi-login__wash--right" aria-hidden="true" />

            <header className="osi-login__bar">
                <span className="osi-login__crest" aria-hidden="true">OS</span>
                <span className="osi-login__lock">
                    <b>{BRAND_NAME}</b>
                    <span>{t.worldLine}</span>
                </span>
                <span className="osi-login__spacer" />
                <div className="osi-login__langs" role="group" aria-label={t.language}>
                    {LANGS.map((code) => (
                        <button
                            key={code}
                            type="button"
                            className={`osi-login__lang${code === lang ? " is-on" : ""}`}
                            aria-pressed={code === lang}
                            onClick={() => setLang(code)}
                        >
                            {LANG_LABEL[code]}
                        </button>
                    ))}
                </div>
            </header>

            <div className="osi-login__cols">
                <section className="osi-login__pitch">
                    <span className="osi-login__eyebrow">{t.eyebrow}</span>
                    <h1 className="osi-login__head">
                        <span className="osi-login__h1">{t.h1}</span>
                        <span className="osi-login__h2">{t.h2}</span>
                        <span className="osi-login__h3">{t.h3}</span>
                        <span className="osi-login__h4">{t.h4}</span>
                    </h1>
                    <ul className="osi-login__tiles">
                        {t.tiles.map((tile) => (
                            <li key={tile.label} className="osi-login__tile">
                                <b>{tile.value}</b>
                                <span>{tile.label}</span>
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="osi-login__frame">
                    <form className="osi-login__pane" onSubmit={submit}>
                        <p className="osi-login__kicker">{t.kicker}</p>
                        <h2 className="osi-login__title">{t.title}</h2>
                        <p className="osi-login__sub">{t.greet}</p>

                        <label className="osi-login__label" htmlFor="osi-user">{t.user}</label>
                        <input
                            id="osi-user"
                            ref={usernameRef}
                            className="osi-login__input"
                            type="text"
                            autoComplete="username"
                            maxLength={20}
                            value={username}
                            disabled={connecting}
                            onChange={(e) => setUsername(e.target.value)}
                        />

                        <label className="osi-login__label" htmlFor="osi-pass">{t.pass}</label>
                        <input
                            id="osi-pass"
                            className="osi-login__input"
                            type="password"
                            autoComplete="current-password"
                            maxLength={20}
                            value={password}
                            disabled={connecting}
                            onChange={(e) => setPassword(e.target.value)}
                        />

                        <label className="osi-login__remember">
                            <input
                                type="checkbox"
                                checked={remember}
                                disabled={connecting}
                                onChange={(e) => setRemember(e.target.checked)}
                            />
                            {t.remember}
                        </label>

                        {complaint && <p className="osi-login__error" role="alert">{complaint}</p>}

                        <button className="osi-login__go" type="submit" disabled={connecting}>
                            {connecting ? t.connecting : t.go}
                        </button>

                        <p className="osi-login__help">{t.help}</p>
                    </form>
                </section>
            </div>
        </div>
    );
}
