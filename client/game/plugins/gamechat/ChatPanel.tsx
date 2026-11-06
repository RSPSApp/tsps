import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GameState } from "../../login/GameState";
import type { OsrsClient } from "../../OsrsClient";
import { useSubscribedGameState } from "../../useSubscribedGameState";
import { sendChat } from "../../../network/ServerConnection";
import { getChatLines, subscribeChat, type ChatChannel, type ChatLine } from "./chatStore";
import "./ChatPanel.css";

type Filter = "all" | ChatChannel;

const TABS: Array<{ key: Filter; label: string }> = [
    { key: "all", label: "Tudo" },
    { key: "game", label: "Jogo" },
    { key: "public", label: "Público" },
    { key: "private", label: "Privado" },
];

const time = (at: number) =>
    new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * The chatbox, as a panel rather than the parchment the canvas draws.
 *
 * Three things it fixes. The parchment is the brightest thing on screen and sits in the corner
 * you look at least, so it pulls the eye off the world. Nothing is timestamped, which matters in
 * a game you come back to after hours. And the channels are a row of tiny buttons with no sense
 * of what is unread.
 *
 * The canvas box stays underneath, still fed by the game; this covers it.
 */
export function ChatPanel({ osrsClient }: { osrsClient: OsrsClient }) {
    const gameState = useSubscribedGameState(osrsClient.stateMachine);
    const lines = useSyncExternalStore(subscribeChat, getChatLines, getChatLines);
    const [filter, setFilter] = useState<Filter>("all");
    const [draft, setDraft] = useState("");
    const [collapsed, setCollapsed] = useState(false);
    const [seen, setSeen] = useState<Record<ChatChannel, number>>({ game: 0, public: 0, private: 0 });
    const logRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const shown = useMemo(
        () => (filter === "all" ? lines : lines.filter((line) => line.channel === filter)),
        [lines, filter],
    );

    const counts = useMemo(() => {
        const totals: Record<ChatChannel, number> = { game: 0, public: 0, private: 0 };
        for (const line of lines) totals[line.channel] += 1;
        return totals;
    }, [lines]);

    // Stick to the newest line, which is what a log is for.
    useEffect(() => {
        const log = logRef.current;
        if (log) log.scrollTop = log.scrollHeight;
    }, [shown, collapsed]);

    // Looking at a channel marks it read; "Tudo" marks everything.
    useEffect(() => {
        setSeen((previous) =>
            filter === "all" ? { ...counts } : { ...previous, [filter]: counts[filter] },
        );
    }, [filter, counts]);

    // Only once the player is actually in the world: a chatbox over the loading bar or the login
    // page is furniture for a room nobody is in yet.
    if (gameState !== GameState.LOGGED_IN) return null;

    function submit(event: React.FormEvent) {
        event.preventDefault();
        const text = draft.trim();
        if (!text) return;
        sendChat(text, "public", 0);
        setDraft("");
    }

    return (
        <div className={`gc${collapsed ? " is-collapsed" : ""}`}>
            <div className="gc__tabs">
                {TABS.map((tab) => {
                    const unread = tab.key === "all" ? 0 : counts[tab.key] - (seen[tab.key] ?? 0);
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            className={`gc__tab${tab.key === filter ? " is-on" : ""}`}
                            onClick={() => setFilter(tab.key)}
                        >
                            {tab.label}
                            {unread > 0 && <span className="gc__unread">{unread > 99 ? "99+" : unread}</span>}
                        </button>
                    );
                })}
                <button
                    type="button"
                    className="gc__fold"
                    onClick={() => setCollapsed((value) => !value)}
                    title={collapsed ? "Abrir o chat" : "Recolher o chat"}
                    aria-label={collapsed ? "Abrir o chat" : "Recolher o chat"}
                >
                    {collapsed ? "▴" : "▾"}
                </button>
            </div>

            {!collapsed && (
                <>
                    <div className="gc__log" ref={logRef}>
                        {shown.length === 0 && <p className="gc__empty">Nada por aqui ainda.</p>}
                        {shown.map((line) => (
                            <Line key={line.id} line={line} />
                        ))}
                    </div>

                    <form className="gc__input" onSubmit={submit}>
                        <input
                            ref={inputRef}
                            type="text"
                            value={draft}
                            maxLength={80}
                            placeholder="Digite para falar"
                            onChange={(event) => setDraft(event.target.value)}
                            // The game listens for keys on the whole window: without this, typing
                            // here would also walk the character and flip through its tabs.
                            onKeyDown={(event) => event.stopPropagation()}
                            onKeyUp={(event) => event.stopPropagation()}
                            onKeyPress={(event) => event.stopPropagation()}
                        />
                    </form>
                </>
            )}
        </div>
    );
}

function Line({ line }: { line: ChatLine }) {
    const kind = line.milestone ? "is-milestone" : `is-${line.channel}`;
    return (
        <p className={`gc__line ${kind}`}>
            <span className="gc__time">{time(line.at)}</span>
            {line.name && line.channel !== "game" && <b className="gc__who">{line.name}:</b>}
            <span className="gc__text">{line.text}</span>
        </p>
    );
}
