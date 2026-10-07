import type { NavigationButton } from "@runelite/client/ui/NavigationButton";

/** The open panel: the button's name with a close button, then the plugin's panel. */
export function SidebarPanel({
    button,
    onClose,
}: {
    button: NavigationButton;
    onClose: () => void;
}): JSX.Element | null {
    const Panel = button.panel;
    if (!Panel) return null;
    return (
        <section className="rl-sidebar-panel" aria-label={button.tooltip}>
            <header className="rl-sidebar-panel-header">
                <span className="rl-sidebar-panel-heading">{button.tooltip}</span>
                <button
                    type="button"
                    className="rl-sidebar-panel-close"
                    onClick={onClose}
                    aria-label="Close panel"
                    title="Close"
                >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                    </svg>
                </button>
            </header>
            <div className="rl-sidebar-panel-body">
                <Panel />
            </div>
        </section>
    );
}
