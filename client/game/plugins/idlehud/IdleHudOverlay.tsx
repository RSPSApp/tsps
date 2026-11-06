import { useEffect, useState } from "react";
import { sendChat } from "../../../network/ServerConnection";
import { getIdleState, subscribeIdleState, type IdleState } from "./idleState";
import "./IdleHudOverlay.css";

/** Why auto-resume stopped, in the player's words rather than the server's key. */
const PAUSED: Record<string, string> = {
    click: "parado: você fez outra coisa",
    stuck: "parado: não conseguiu seguir",
    logout: "parado: saindo",
    out: "parado: sem material",
    retreat: "parado: fugiu sem comida",
};

function rate(xpPerHour: number | null): string {
    if (xpPerHour === null) return "—";
    if (xpPerHour >= 1000) return `${Math.round(xpPerHour / 100) / 10}k`;
    return String(xpPerHour);
}

/**
 * The strip that is always on screen while Idle Mode is on: what the character is doing, how fast,
 * and how close the next idle point is. Clicking it opens the full Idle screen, which is the
 * accessible way in — before this, the only ways were a command or a button two taps deep in the
 * journal tab.
 */
export function IdleHudOverlay() {
    const [state, setState] = useState<IdleState | null>(getIdleState());
    useEffect(() => subscribeIdleState(setState), []);

    // Nothing to say until the server has pushed a state, and nothing to show when idle is off:
    // the HUD is for watching work happen, and there is no work.
    if (!state?.idle) return null;

    const stopped = state.paused !== null || !state.auto;
    const note = state.paused ? PAUSED[state.paused] ?? "parado" : !state.auto ? "retomada automática desligada" : null;

    return (
        <div className={`idle-hud${stopped ? " idle-hud--stopped" : ""}`}>
            <span className="idle-hud__edge" aria-hidden="true" />
            <button
                type="button"
                className="idle-hud__body"
                onClick={() => sendChat("::idle", "public", 0)}
                title="Abrir a tela do Idle"
            >
                <span className="idle-hud__line">
                    <span className="idle-hud__activity">{state.activity ?? "Nada escolhido ainda"}</span>
                    <span className="idle-hud__rate">{rate(state.xpPerHour)} xp/h</span>
                </span>
                <span className="idle-hud__track" aria-hidden="true">
                    <span className="idle-hud__fill" style={{ width: `${state.nextPercent}%` }} />
                </span>
                <span className="idle-hud__line idle-hud__line--small">
                    <span>{note ?? `${state.nextPercent}% do próximo ponto`}</span>
                    <span className="idle-hud__points">{state.points.toLocaleString("pt-BR")} pts</span>
                </span>
            </button>
            {/* Switching off used to mean opening the screen, which is exactly what a fight made
                impossible. It belongs here, one click away and never covered by anything. */}
            <button
                type="button"
                className="idle-hud__stop"
                onClick={() => sendChat("::idle off", "public", 0)}
                title="Desligar o Idle Mode"
                aria-label="Desligar o Idle Mode"
            >
                <span aria-hidden="true">■</span>
            </button>
        </div>
    );
}
