import type { LoginState } from "../LoginState";
import type { LoginRendererHost } from "./host";
import { toLayoutPoint } from "./layout/config";
import { getGridLayout, getSortedWorlds, findHoveredWorld } from "./world/worldData";
import { SERVER_LIST_PANEL_WIDTH } from "./constants";
import { toContentPoint } from "./layout/geometry";

export function computeHoveredWorldIndex(host: LoginRendererHost, state: LoginState, _width: number, _height: number) {

        if (!state.worldSelectOpen) return -1;

        const sortedWorlds = getSortedWorlds(host);
        const worldCount = sortedWorlds.length;

        // Use cached grid layout (same as drawWorldSelect)
        const layout = getGridLayout(host, worldCount);

        // Use consolidated hover detection
        const hoverResult = findHoveredWorld(host, sortedWorlds, layout, state.worldSelectPage);
        return hoverResult.index;
    
}

export function computeHoveredServerIndex(host: LoginRendererHost, state: LoginState) {

        if (!state.serverListOpen || !host.probed) return -1;

        const servers = host.serverList;
        const rowH = 24;
        const headerH = 30;
        const panelW = SERVER_LIST_PANEL_WIDTH;
        const panelH = headerH + servers.length * rowH;
        const panelX = Math.floor((host.canvasWidth - panelW) / 2);
        const panelY = Math.floor((host.canvasHeight - panelH) / 2);

        const rowStartY = panelY + headerH;
        const mx = host.mouseX;
        const my = host.mouseY;

        if (mx >= panelX + 4 && mx <= panelX + panelW - 4) {
            for (let i = 0; i < servers.length; i++) {
                const ry = rowStartY + i * rowH;
                if (my >= ry && my < ry + rowH) {
                    return i;
                }
            }
        }
        return -1;
    
}

export function setMousePosition(host: LoginRendererHost, x: number, y: number) {

        const mapped = toLayoutPoint(host, x, y);
        host.mouseX = mapped.x;
        host.mouseY = mapped.y;
    
}

/** Update a plugin's hover state in content coordinates. */
export function updateExtensionHover(host: LoginRendererHost, state: LoginState): void {
    if (!state.extension || state.serverListOpen) return;
    const point = toContentPoint(host, host.mouseX, host.mouseY);
    state.extension.hover(host, point.x, point.y);
}
