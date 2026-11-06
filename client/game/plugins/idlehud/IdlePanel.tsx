import { useEffect, useState } from "react";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { imageIcon, runeliteImage } from "@runelite/client/ui/runeliteImages";
import { sendChat } from "../../../network/ServerConnection";
import { getIdleState, subscribeIdleState, type IdleState } from "./idleState";
import "./IdlePanel.css";

const PAUSED: Record<string, string> = {
    click: "parado: você fez outra coisa",
    stuck: "parado: não conseguiu seguir",
    logout: "parado: saindo",
    out: "parado: sem material",
    retreat: "parado: fugiu sem comida",
};

const number = (value: number) => value.toLocaleString("pt-BR");

function rate(xpPerHour: number | null): string {
    if (xpPerHour === null) return "—";
    if (xpPerHour >= 1000) return `${Math.round(xpPerHour / 100) / 10}k`;
    return number(xpPerHour);
}

/** A sunk track with a filled run over it: the same bar as the strip and the Idle screen. */
function Bar({ percent, tone = "good" }: { percent: number; tone?: "good" | "cool" | "gold" }) {
    return (
        <span className={`ip-bar ip-bar--${tone}`}>
            <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </span>
    );
}

/** One lit pip per level bought, so the level reads without being counted. */
function Pips({ level, max }: { level: number; max: number }) {
    return (
        <span className="ip-pips" aria-label={`${level} de ${max}`}>
            {Array.from({ length: max }, (_, i) => (
                <i key={i} className={i < level ? "is-on" : undefined} />
            ))}
        </span>
    );
}

/**
 * The Idle panel, in the side bar beside the game rather than over it.
 *
 * Chosen over a full-screen panel because this is a game you leave running: the point is to watch
 * the bar climb while the character fights, which a panel that covers the world cannot do. The
 * cost is width, so everything here is written to fit a narrow column — short labels, numbers
 * right-aligned, one line per thing.
 */
export function IdlePanel() {
    const [state, setState] = useState<IdleState | null>(getIdleState());
    useEffect(() => subscribeIdleState(setState), []);

    if (!state) {
        return <div className="ip ip--empty">Entre num mundo com Idle Mode para ver isto.</div>;
    }

    if (!state.idle) {
        return (
            <div className="ip">
                <div className="ip-card ip-card--off">
                    <p className="ip-off">Idle Mode está desligado.</p>
                    <button type="button" className="ip-go" onClick={() => sendChat("::idle on", "public", 0)}>
                        Ligar o Idle Mode
                    </button>
                </div>
            </div>
        );
    }

    const stopped = state.paused !== null || !state.auto;
    const note = state.paused ? PAUSED[state.paused] ?? "parado" : !state.auto ? "retomada automática desligada" : null;

    return (
        <div className="ip">
            <div className={`ip-now${stopped ? " is-stopped" : ""}`}>
                <span className="ip-now__edge" aria-hidden="true" />
                <span className="ip-now__text">
                    <span className="ip-now__eyebrow">{stopped ? "PARADO EM" : "TRABALHANDO EM"}</span>
                    <span className="ip-now__what">{state.activity ?? "Nada escolhido ainda"}</span>
                    {note && <span className="ip-now__note">{note}</span>}
                </span>
            </div>

            <div className="ip-acts">
                <button type="button" onClick={() => sendChat("::idle off", "public", 0)}>■ Parar</button>
                <button type="button" className="ip-go" onClick={() => sendChat("::idle travel", "public", 0)}>
                    Trocar atividade
                </button>
            </div>

            <div className="ip-card">
                <span className="ip-big">
                    {number(state.points)}
                    <small>pontos idle · {rate(state.xpPerHour)} xp/h</small>
                </span>
                <Bar percent={state.nextPercent} />
                <span className="ip-muted">
                    Próximo ponto · {number(state.nextXp)} / {number(state.nextOf)} XP
                </span>
            </div>

            <div className="ip-card">
                <h3>Melhorias</h3>
                {state.upgrades.map((upgrade) => (
                    <div className="ip-row" key={upgrade.id}>
                        <span className="ip-row__name">
                            <b>{upgrade.name}</b>
                            <span>{upgrade.short}</span>
                        </span>
                        <Pips level={upgrade.level} max={upgrade.maxLevel} />
                        {upgrade.cost === null ? (
                            <span className="ip-max">máx</span>
                        ) : (
                            <button
                                type="button"
                                className={`ip-buy${upgrade.affordable ? "" : " is-dear"}`}
                                disabled={!upgrade.affordable}
                                title={
                                    upgrade.affordable
                                        ? `Comprar por ${number(upgrade.cost)} pontos`
                                        : `Faltam ${number(upgrade.cost - state.points)} pontos`
                                }
                                onClick={() => sendChat(`::idle buy ${upgrade.id}`, "public", 0)}
                            >
                                {number(upgrade.cost)}
                            </button>
                        )}
                    </div>
                ))}
            </div>

            <div className="ip-card">
                <h3>Hoje</h3>
                {state.goals.map((goal) => (
                    <div className="ip-goal" key={goal.text}>
                        <span className="ip-goal__top">
                            <b className={goal.done ? "is-done" : undefined}>{goal.text}</b>
                            <span>+{goal.points}</span>
                        </span>
                        <Bar percent={goal.target > 0 ? (goal.progress / goal.target) * 100 : 0} />
                        <span className="ip-muted">
                            {goal.done ? "concluída" : `${number(goal.progress)} / ${number(goal.target)}`}
                        </span>
                    </div>
                ))}
                <p className="ip-muted ip-bonus">
                    {state.bonus.done
                        ? `Bônus pago: +${state.bonus.points} pontos`
                        : `Todas as ${state.bonus.of} pagam +${state.bonus.points} · ${state.bonus.count}/${state.bonus.of}`}
                </p>
            </div>

            <div className="ip-card ip-card--quiet">
                <span className="ip-muted">
                    Offline paga {state.offline.efficiency}% por até {state.offline.capHours}h
                </span>
                <span className="ip-muted">
                    {state.offline.lastAway ? `Última ausência: ${state.offline.lastAway}` : "Nenhuma ausência paga ainda"}
                </span>
            </div>

        </div>
    );
}

export function createIdleNavigationButton(): NavigationButton {
    return NavigationButton.builder()
        .tooltip("Idle Mode")
        .icon(imageIcon(runeliteImage("xp_overall.png")))
        .priority(1)
        .panel(() => <IdlePanel />)
        .build();
}
