import { GameState, LoginIndex } from "../../GameState";
import { LoginActions } from "../../LoginAction";
import type { LoginState } from "../../LoginState";
import type { LoginAction } from "../../LoginAction";
import type { LoginRendererHost } from "../host";
import { toLayoutPoint } from "../layout/config";
import { toContentPoint } from "../layout/geometry";
import { isTitleMuteHit } from "../controls";
import { getServerListButtonPosition } from "../layout/geometry";
import { getMobileWorldIndexAtPosition } from "../world/worldSelectMobile";
import {
    SERVER_LIST_OWNER_COLUMN_START,
    SERVER_LIST_PANEL_WIDTH,
    SERVER_LIST_PLAYERS_COLUMN_START,
} from "../constants";
import { forumProfileUrl } from "../serverList";
import { ellipsis } from "../render/drawUtils";
import {
    handleWelcomeClick,
    handleWarningClick,
    handleLoginFormClick,
    handleInvalidCredentialsClick,
    handleAuthenticatorClick,
    handleForgotPasswordClick,
    handleDobClick,
    handleMessageClick,
    handleTryAgainClick,
    handleBannedClick,
    handleOkMessageClick,
    isButtonHit,
} from "./mouseHandlers";

export function handleServerListClick(host: LoginRendererHost, state: LoginState, x: number, y: number): LoginAction | undefined {

        const panelW = SERVER_LIST_PANEL_WIDTH;
        const contentH = host.probed ? host.serverList.length * 24 : 30;
        const panelH = 30 + contentH;
        const panelX = Math.floor((host.canvasWidth - panelW) / 2);
        const panelY = Math.floor((host.canvasHeight - panelH) / 2);

        // Refresh button (below panel, left)
        const btnY = panelY + panelH + 30;
        if (isButtonHit(host, x, y, panelX + panelW / 2 - 80, btnY)) {
            return LoginActions.REFRESH_SERVER_LIST;
        }

        // Close button (below panel, right)
        if (isButtonHit(host, x, y, panelX + panelW / 2 + 80, btnY)) {
            return LoginActions.CLOSE_SERVER_LIST;
        }

        // Server row clicks (only when probed)
        if (host.probed) {
            const rowStartY = panelY + 30;
            const rowH = 24;
            for (let i = 0; i < host.serverList.length; i++) {
                const ry = rowStartY + i * rowH;
                if (x >= panelX + 4 && x <= panelX + panelW - 4 && y >= ry && y < ry + rowH) {
                    const owner = host.serverList[i].ownerUsername;
                    const ownerX = panelX + SERVER_LIST_OWNER_COLUMN_START;
                    const ownerText = owner && ellipsis(
                        host,
                        owner,
                        SERVER_LIST_PLAYERS_COLUMN_START - SERVER_LIST_OWNER_COLUMN_START - 4,
                    );
                    if (owner && ownerText && host.fontPlain12 && x >= ownerX
                        && x < ownerX + host.fontPlain12.measure(ownerText)) {
                        window.open(forumProfileUrl(owner), "_blank", "noopener,noreferrer");
                        return undefined;
                    }
                    return { type: "select_server", index: i } as const;
                }
            }
        }

        // Click inside panel consumes the event (don't pass through)
        if (x >= panelX && x <= panelX + panelW && y >= panelY && y <= panelY + panelH) {
            return undefined;
        }

        // Click outside panel closes it
        return LoginActions.CLOSE_SERVER_LIST;
    
}

export function handleWorldSelectClick(host: LoginRendererHost, state: LoginState, x: number, y: number): LoginAction | undefined {

        // Mobile list mode: use tap-to-select
        if (host.layoutConfig.worldSelectListMode) {
            const index = getMobileWorldIndexAtPosition(host, 
                state,
                x,
                y,
                host.canvasWidth,
                host.canvasHeight,
            );

            // Close button tapped
            if (index === -2) {
                return LoginActions.CLOSE_WORLD_SELECT;
            }

            // World row tapped
            if (index >= 0 && index < host.currentSortedWorlds.length) {
                const world = host.currentSortedWorlds[index];
                if (world.population !== -1) {
                    // Can't select offline worlds
                    return { type: "select_world", worldId: world.id } as const;
                }
            }

            return undefined;
        }

        // Desktop grid mode: Cancel button (top right header area)
        if (x >= host.xPadding + 708 && x <= host.xPadding + 758 && y >= 4 && y <= 20) {
            return LoginActions.CLOSE_WORLD_SELECT;
        }

        // Sort column clicks (in header area y < 23)
        if (y < 23 && host.worldSelectArrowSprites) {
            // World column sort
            if (x >= host.xPadding + 280 && x <= host.xPadding + 320) {
                return { type: "world_sort", column: 0 } as const;
            }
            // Players column sort
            if (x >= host.xPadding + 390 && x <= host.xPadding + 430) {
                return { type: "world_sort", column: 1 } as const;
            }
            // Location column sort
            if (x >= host.xPadding + 500 && x <= host.xPadding + 540) {
                return { type: "world_sort", column: 2 } as const;
            }
            // Type column sort
            if (x >= host.xPadding + 610 && x <= host.xPadding + 650) {
                return { type: "world_sort", column: 3 } as const;
            }
        }

        // Page navigation - left arrow
        if (host.worldSelectLeftSprite && state.worldSelectPage > 0) {
            const arrowY = Math.floor(
                host.canvasHeight / 2 - host.worldSelectLeftSprite.subHeight / 2,
            );
            if (
                x >= 8 &&
                x <= 8 + host.worldSelectLeftSprite.subWidth &&
                y >= arrowY &&
                y <= arrowY + host.worldSelectLeftSprite.subHeight
            ) {
                return LoginActions.WORLD_PAGE_LEFT;
            }
        }

        // Page navigation - right arrow
        if (host.worldSelectRightSprite && state.worldSelectPage < state.worldSelectPagesCount) {
            const arrowX = host.canvasWidth - host.worldSelectRightSprite.subWidth - 8;
            const arrowY = Math.floor(
                host.canvasHeight / 2 - host.worldSelectRightSprite.subHeight / 2,
            );
            if (
                x >= arrowX &&
                x <= arrowX + host.worldSelectRightSprite.subWidth &&
                y >= arrowY &&
                y <= arrowY + host.worldSelectRightSprite.subHeight
            ) {
                return LoginActions.WORLD_PAGE_RIGHT;
            }
        }

        // World row click - look up by world ID (survives re-sorting)
        if (state.hoveredWorldId >= 0) {
            const world = host.currentSortedWorlds.find((w) => w.id === state.hoveredWorldId);
            if (world && world.population !== -1) {
                // Can't select offline worlds
                return { type: "select_world", worldId: world.id };
            }
        }

        return undefined;
    
}

export function handleMouseClick(
    host: LoginRendererHost,
    state: LoginState,
    x: number,
    y: number,
    button: number,
    gameState: GameState = GameState.LOGIN_SCREEN,
): LoginAction | undefined {

        if (button !== 1) return undefined;

        const mapped = toLayoutPoint(host, x, y);
        x = mapped.x;
        y = mapped.y;

        // Music mute button (global - works on all login screens)
        if (
            (gameState >= GameState.LOGIN_SCREEN || gameState === GameState.LOADING) &&
            host.titleMuteSprites?.[0]
        ) {
            if (isTitleMuteHit(host, x, y)) {
                return LoginActions.TOGGLE_MUSIC;
            }
        }

        // Server list overlay handling (when open) - check before button
        if (state.serverListOpen) {
            return handleServerListClick(host, state, x, y);
        }

        // Server list button (bottom left, replaces world select button)
        if (gameState >= GameState.LOGIN_SCREEN && host.worldSelectButtonSprite) {
            const buttonPos = getServerListButtonPosition(host);
            const buttonW = host.worldSelectButtonSprite.subWidth || 100;
            const buttonH = host.worldSelectButtonSprite.subHeight || 35;
            const point = toContentPoint(host, x, y);
            if (
                point.x >= buttonPos.x &&
                point.x <= buttonPos.x + buttonW &&
                point.y >= buttonPos.y &&
                point.y <= buttonPos.y + buttonH
            ) {
                return LoginActions.OPEN_SERVER_LIST;
            }
        }

        // World select overlay handling (when open)
        if (state.worldSelectOpen) {
            return handleWorldSelectClick(host, state, x, y);
        }

        // Login panels are drawn in a centered/scaled classic content band.
        const content = toContentPoint(host, x, y);

        // Route to appropriate screen handler
        switch (state.loginIndex) {
            case LoginIndex.WELCOME:
                return handleWelcomeClick(host, content.x, content.y);
            case LoginIndex.WARNING:
                return handleWarningClick(host, content.x, content.y);
            case LoginIndex.LOGIN_FORM:
                return handleLoginFormClick(host, state, content.x, content.y, gameState);
            case LoginIndex.INVALID_CREDENTIALS:
                return handleInvalidCredentialsClick(host, content.x, content.y);
            case LoginIndex.AUTHENTICATOR:
                return handleAuthenticatorClick(host, state, content.x, content.y);
            case LoginIndex.FORGOT_PASSWORD:
                return handleForgotPasswordClick(host, content.x, content.y);
            case LoginIndex.DATE_OF_BIRTH:
                return handleDobClick(host, state, content.x, content.y);
            case LoginIndex.MESSAGE:
            case LoginIndex.MUST_ACCEPT_TERMS:
                return handleMessageClick(host, state, content.x, content.y);
            case LoginIndex.TRY_AGAIN:
                return handleTryAgainClick(host, content.x, content.y);
            case LoginIndex.BANNED:
                return handleBannedClick(host, content.x, content.y);
            case LoginIndex.OK_MESSAGE:
                return handleOkMessageClick(host, content.x, content.y);
            default:
                return undefined;
        }
    
}
