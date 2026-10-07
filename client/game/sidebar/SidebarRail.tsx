import type { NavigationButton } from "@runelite/client/ui/NavigationButton";

/** The always-visible column of sidebar icons on the right edge (RuneLite's toolbar). */
export function SidebarRail({
    buttons,
    selected,
    onClick,
}: {
    buttons: ReadonlyArray<NavigationButton>;
    selected: string | null;
    onClick: (button: NavigationButton) => void;
}): JSX.Element {
    return (
        <nav className="rl-sidebar-rail" aria-label="Sidebar">
            {buttons.map((button) => {
                const active = selected === button.tooltip;
                const Icon = button.icon;
                return (
                    <button
                        key={button.tooltip}
                        type="button"
                        className={`rl-sidebar-rail-button${active ? " active" : ""}`}
                        onClick={() => onClick(button)}
                        aria-label={button.tooltip}
                        aria-pressed={button.panel ? active : undefined}
                        title={button.tooltip}
                    >
                        {Icon ? (
                            <Icon label={button.tooltip} />
                        ) : (
                            <span className="rl-sidebar-icon-fallback">
                                {button.tooltip.slice(0, 1)}
                            </span>
                        )}
                    </button>
                );
            })}
        </nav>
    );
}
