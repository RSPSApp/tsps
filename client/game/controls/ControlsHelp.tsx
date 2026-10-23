import React, { useCallback, useSyncExternalStore } from "react";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import { CameraConfig } from "../plugins/camera/CameraConfig";

export function ControlsHelp({ configManager, closeCameraActive, onExitCloseCamera }: {
    configManager: ConfigManager;
    closeCameraActive: boolean;
    onExitCloseCamera(): void;
}): JSX.Element | null {
    const subscribe = useCallback((listener: () => void) => configManager.addListener((event) => {
        if (event.getGroup() === CameraConfig.group) listener();
    }), [configManager]);
    const snapshot = useCallback(() => Boolean(configManager.getConfig(CameraConfig).controlsExpanded()), [configManager]);
    const expanded = useSyncExternalStore(subscribe, snapshot, snapshot);
    if (!closeCameraActive) return null;
    return <aside className={`controls-help${expanded ? " expanded" : ""}`} aria-label="Game controls" onKeyDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className="controls-help-heading">
            <button aria-expanded={expanded} aria-controls="game-controls-guide" onClick={() => configManager.setConfigValue(CameraConfig, "controlsExpanded", !expanded)}>
                Controls {expanded ? "▴" : "▾"}
            </button>
            <button onClick={onExitCloseCamera}>Exit close camera</button>
        </div>
        {expanded && <div id="game-controls-guide" className="controls-help-guide">
            <strong>Close camera is active</strong>
            <p><kbd>Backquote</kbd> (<kbd>`</kbd>, key above Tab) toggles the close camera. Press it again to exit.</p>
            <dl>
                <dt>Standard view</dt><dd>Click to walk. Right-click for options. Arrow keys or middle-mouse drag rotate the camera. Scroll over the world to zoom.</dd>
                <dt>Close camera</dt><dd><kbd>WASD</kbd> moves; hold <kbd>Shift</kbd> to run. <kbd>Alt</kbd> / Option toggles mouse look. <kbd>Space</kbd> interacts; hold it for options.</dd>
                <dt>Focus and menus</dt><dd>In close camera, <kbd>Tab</kbd> cycles movement, chat and inventory; arrow keys select items/options. <kbd>Escape</kbd> closes an open menu.</dd>
                <dt>Settings and lists</dt><dd>Move the pointer over a list to scroll it. <kbd>Alt</kbd> / Option frees the cursor in close camera so you can use Settings.</dd>
            </dl>
        </div>}
    </aside>;
}
