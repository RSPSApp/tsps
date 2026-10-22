import { useCallback, useEffect, useSyncExternalStore } from "react";

import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { BugReportPlugin, BugReportState } from "./BugReportPlugin";

/** The server refuses longer descriptions (server/plugins/interface/bugreports/Channel.BugReports.js). */
const MAX_DESCRIPTION = 4000;

function BugIcon({ label }: { label: string }): JSX.Element {
    return (
        <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}>
            <path d="M9.5 7.5a2.5 2.5 0 0 1 5 0" />
            <path d="M10.5 5.2 9 3.5M13.5 5.2 15 3.5" />
            <rect x="7.5" y="7.5" width="9" height="13" rx="4.5" />
            <path d="M12 11v9.5M7.5 11.5 4.5 10M7.5 15h-3M7.5 18l-2.5 1.5M16.5 11.5l3-1.5M16.5 15h3M16.5 18l2.5 1.5" />
        </svg>
    );
}

function notice(state: BugReportState): string {
    const where = state.destination
        ? `Reports are filed as issues on ${state.destination}.`
        : state.world === "available"
          ? "Reports are saved on this world's server."
          : "";
    const what = state.includeDiagnostics
        ? "Diagnostics are included by default: the last 5 minutes of client logs, your position, " +
          "inventory, equipment, skills and game settings, and the server's view of your character."
        : "Only your description and the screenshot are sent.";
    return `${what} ${where}`.trim();
}

function Thanks({ plugin, state }: { plugin: BugReportPlugin; state: BugReportState }): JSX.Element {
    return (
        <div className="rl-sidebar-panel-content" role="status">
            <div className="rl-sidebar-panel-title">Thanks for the report!</div>
            <p className="rl-sidebar-panel-copy">
                {state.issueUrl ? (
                    <>
                        It was filed as{" "}
                        <a className="rl-bug-report-link" href={state.issueUrl} target="_blank" rel="noreferrer">
                            {state.issueNumber ? `issue #${state.issueNumber}` : "an issue"}
                        </a>
                        .
                    </>
                ) : (
                    "The server saved it for the developers."
                )}
            </p>
            <button type="button" className="rl-sidebar-text-button" onClick={() => plugin.reset()}>
                Report another bug
            </button>
        </div>
    );
}

/** The Report a Bug panel: the form, then a thank-you once the server has the report. */
export function BugReportPanel({ plugin }: { plugin: BugReportPlugin }): JSX.Element {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    useEffect(() => plugin.panelShown(), [plugin]);

    if (state.phase === "sent") return <Thanks plugin={plugin} state={state} />;
    const sending = state.phase === "sending";
    const blocked = plugin.blockedReason();
    return (
        <form
            className="rl-sidebar-panel-content rl-sidebar-scrollable"
            onSubmit={(event) => {
                event.preventDefault();
                void plugin.submit();
            }}
        >
            <label className="rl-sidebar-field">
                What went wrong?
                <textarea
                    className="rl-sidebar-textarea"
                    rows={6}
                    maxLength={MAX_DESCRIPTION}
                    required
                    disabled={sending}
                    value={state.description}
                    placeholder="What happened, and what did you expect? Steps to make it happen again help most."
                    onChange={(event) => plugin.setDescription(event.target.value)}
                />
            </label>
            <label className="rl-sidebar-check">
                <input
                    type="checkbox"
                    checked={state.includeScreenshot && !!state.screenshot}
                    disabled={sending || !state.screenshot}
                    onChange={(event) => plugin.setIncludeScreenshot(event.target.checked)}
                />
                Attach a screenshot
            </label>
            {state.screenshot ? (
                <img className="rl-bug-report-screenshot" src={state.screenshot} alt="The screenshot to attach" />
            ) : (
                <p className="rl-sidebar-panel-copy">{state.capturing ? "Taking a screenshot…" : "No screenshot."}</p>
            )}
            <button
                type="button"
                className="rl-sidebar-text-button"
                disabled={sending || state.capturing || !plugin.isLoggedIn()}
                onClick={() => void plugin.retakeScreenshot()}
            >
                Retake screenshot
            </button>
            <label className="rl-sidebar-check">
                <input
                    type="checkbox"
                    checked={state.includeDiagnostics}
                    disabled={sending}
                    onChange={(event) => plugin.setIncludeDiagnostics(event.target.checked)}
                />
                Include diagnostics
            </label>
            <p className="rl-sidebar-panel-copy">{notice(state)}</p>
            {state.phase === "failed" && state.error ? (
                <p className="rl-config-warning" role="alert">
                    The report wasn't sent: {state.error}
                </p>
            ) : null}
            <button
                type="submit"
                className="rl-sidebar-text-button"
                disabled={sending || !!blocked || !state.description.trim()}
            >
                {sending ? `Sending… ${Math.round(state.progress * 100)}%` : "Send report"}
            </button>
            {blocked ? <p className="rl-sidebar-panel-copy">{blocked}</p> : null}
        </form>
    );
}

/** The Report a Bug button, second on the rail so more plugin buttons never push it off. */
export function createBugReportNavigationButton(plugin: BugReportPlugin): NavigationButton {
    return NavigationButton.builder()
        .tooltip("Report a Bug")
        .icon(BugIcon)
        .priority(1)
        .panel(() => <BugReportPanel plugin={plugin} />)
        .build();
}
