/** One row of the plugin hub, as RuneLite draws it: name, a settings cog, an on/off switch. */
export interface PluginListItemProps {
    name: string;
    description?: string;
    failure?: string;
    /** Absent for rows that can't be turned off (the client's own settings). */
    enabled?: boolean;
    onToggle?: (enabled: boolean) => void;
    /** Absent when there are no settings: no cog, and the name isn't a button. */
    onOpenConfig?: () => void;
}

function CogIcon(): JSX.Element {
    return (
        <svg className="rl-plugin-item-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M10.3 3h3.4l.5 2.4 1.6.9 2.3-.8 1.7 2.9-1.8 1.6v1.9l1.8 1.6-1.7 2.9-2.3-.8-1.6.9-.5 2.4h-3.4l-.5-2.4-1.6-.9-2.3.8-1.7-2.9 1.8-1.6v-1.9L4.2 8.4l1.7-2.9 2.3.8 1.6-.9Z" />
        </svg>
    );
}

export function PluginListItem({
    name,
    description,
    failure,
    enabled,
    onToggle,
    onOpenConfig,
}: PluginListItemProps): JSX.Element {
    const off = enabled === false;
    const label = (
        <>
            <span className="rl-plugin-item-name">{name}</span>
            {description ? <span className="rl-plugin-item-desc">{description}</span> : null}
            {failure ? <span className="rl-plugin-item-failure">Failed: {failure}</span> : null}
        </>
    );
    return (
        <div className={`rl-plugin-item${off ? " off" : ""}`} title={description}>
            {onOpenConfig ? (
                <button type="button" className="rl-plugin-item-main" onClick={onOpenConfig}>
                    {label}
                </button>
            ) : (
                <div className="rl-plugin-item-main">{label}</div>
            )}
            {onOpenConfig ? (
                <button
                    type="button"
                    className="rl-plugin-item-cog"
                    onClick={onOpenConfig}
                    aria-label={`${name} settings`}
                    title="Edit settings"
                >
                    <CogIcon />
                </button>
            ) : null}
            {onToggle ? (
                <button
                    type="button"
                    role="switch"
                    aria-checked={!off}
                    aria-label={`${off ? "Enable" : "Disable"} ${name}`}
                    title={off ? "Enable plugin" : "Disable plugin"}
                    className={`rl-switch${off ? "" : " on"}`}
                    onClick={() => onToggle(off)}
                >
                    <span className="rl-switch-knob" />
                </button>
            ) : null}
        </div>
    );
}
