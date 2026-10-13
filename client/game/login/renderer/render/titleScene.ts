import { GameState } from "../../GameState";
import type { LoginState } from "../../LoginState";
import type { LoginRendererHost } from "../host";
import { getCanvas, getContext, isCaretVisible } from "../canvas";
import { withRenderTransform, getViewportTransformStateHash, getTitleAssetStateHash } from "../layout/config";
import { updateLayout } from "../layout/updateLayout";
import { getLogicalFirePositions, getServerListButtonPosition, withContentTransform } from "../layout/geometry";
import { drawTitleBackgroundToCtx } from "./background";
import { drawLoadingBarToCtx } from "./loadingBars";
import { drawLoginScreenToCtx } from "./loginScreensRouter";
import { drawServerListOverlay } from "./serverListOverlay";
import { drawWorldSelectGridOnly } from "../world/worldSelectGridDraw";
import { drawWorldSelectHoverOnly } from "../world/worldSelectHover";
import { drawTitleMuteButton } from "../controls";
import { drawLogoToCtx, drawSprite, drawCenteredText } from "./drawUtils";

export function computeTitleStateHash(
    host: LoginRendererHost,
    state: LoginState,
    gameState: GameState,
    width: number,
    height: number,
    layoutWidth: number,
    layoutHeight: number,
    skipFire: boolean,
): string {

        return `${gameState}|${state.loginIndex}|${state.username.length}|${
            state.password.length
        }|${state.otp.length}|${state.currentLoginField}|${state.onMobile}|${
            state.virtualKeyboardVisible
        }|${state.serverListOpen}|${state.hoveredServerIndex}|${state.serverName}|${host.probing}|${
            host.probed
        }|${host.serverList.map((s) => s.playerCount).join(",")}|${state.worldSelectOpen}|${
            state.worldSelectPage
        }|${state.loadingPercent}|${state.rememberUsername}|${state.isUsernameHidden}|${
            state.trustComputer
        }|${state.titleMusicDisabled}|${
            state.worldId
        }|${width}|${height}|${layoutWidth}|${layoutHeight}|${skipFire}|${host.worldSortOption}|${
            host.worldSortDirection
        }|${isCaretVisible(host)}|${getViewportTransformStateHash(host)}|${getTitleAssetStateHash(host)}`;
    
}

export function drawTitle(host: LoginRendererHost, state: LoginState, gameState: GameState, width: number, height: number, skipFire = false, hoverOnly = false, layoutWidth = width, layoutHeight = height) {

        const canvas = getCanvas(host, width, height);
        const ctx = getContext(host);
        if (!ctx) return;

        updateLayout(host, layoutWidth, layoutHeight, width, height);

        // Compute state hash for caching (excludes hover-related state)
        const stateHash = computeTitleStateHash(host, 
            state,
            gameState,
            width,
            height,
            layoutWidth,
            layoutHeight,
            skipFire,
        );
        const cacheValid =
            host.titleCache !== null &&
            host.titleCacheStateHash === stateHash &&
            host.titleCacheWidth === width &&
            host.titleCacheHeight === height;

        // Fast path: if only hover changed and cache is valid, skip full redraw
        if (hoverOnly && cacheValid && state.worldSelectOpen) {
            // Blit cached title to main canvas
            ctx.drawImage(host.titleCache!, 0, 0);
            // Draw only hover overlay
            withRenderTransform(host, ctx, () => {
                drawWorldSelectHoverOnly(host, ctx, state, host.canvasWidth, host.canvasHeight);
            });
            return;
        }

        // Full redraw path - either cache miss or not hover-only
        if (!cacheValid) {
            // Create or resize title cache
            if (
                !host.titleCache ||
                host.titleCacheWidth !== width ||
                host.titleCacheHeight !== height
            ) {
                host.titleCache = new OffscreenCanvas(width, height);
                host.titleCacheCtx = host.titleCache.getContext("2d");
            }

            if (host.titleCacheCtx) {
                const cacheCtx = host.titleCacheCtx;

                cacheCtx.fillStyle = "#000000";
                cacheCtx.fillRect(0, 0, width, height);
                withRenderTransform(host, cacheCtx, () => {
                    // Draw title background
                    drawTitleBackgroundToCtx(host, cacheCtx);

                    if (!state.serverListOpen) {
                        // Loading state (gameState 0) - shows progress bar
                        if (gameState === GameState.LOADING) {
                            drawLoadingBarToCtx(host, cacheCtx, state);
                        }

                        // Login screen (gameState 10, 20, or 50) - shows loginIndex-based views
                        if (
                            gameState === GameState.LOGIN_SCREEN ||
                            gameState === GameState.CONNECTING ||
                            gameState === GameState.SPECIAL_LOGIN
                        ) {
                            drawLoginScreenToCtx(host, cacheCtx, state, gameState);
                        }
                    }

                    // Rune animations (only on login screen - gameState >= 10)
                    // Skip if using separate fire texture
                    if (
                        !skipFire &&
                        gameState >= GameState.LOGIN_SCREEN &&
                        host.loginScreenRunesAnimation
                    ) {
                        cacheCtx.save();
                        cacheCtx.beginPath();
                        cacheCtx.rect(
                            host.containerX,
                            0,
                            host.containerWidth,
                            host.containerHeight,
                        );
                        cacheCtx.clip();

                        // Lock flames to the scaled background art (pillar braziers).
                        const firePos = getLogicalFirePositions(host);
                        const drawFireAt = (x: number) => {
                            cacheCtx.save();
                            cacheCtx.translate(x, firePos.y);
                            cacheCtx.scale(firePos.scale, firePos.scale);
                            host.loginScreenRunesAnimation!.draw(cacheCtx, 0, host.cycle);
                            cacheCtx.restore();
                        };
                        drawFireAt(firePos.leftX);
                        drawFireAt(firePos.rightX);

                        cacheCtx.restore();
                    }

                    if (!state.serverListOpen) {
                        // Logo
                        drawLogoToCtx(host, cacheCtx);

                        // Mute button (only when gameState >= 10)
                        if (gameState >= GameState.LOGIN_SCREEN) {
                            drawTitleMuteButton(host, cacheCtx, state.titleMusicDisabled);
                        }
                    }

                    // Server list button (bottom left) — same baseline as mute button
                    if (
                        gameState >= GameState.LOGIN_SCREEN &&
                        host.worldSelectButtonSprite &&
                        host.fontPlain11
                    ) {
                        const buttonPos = getServerListButtonPosition(host);
                        const buttonSprite = host.worldSelectButtonSprite;
                        const buttonFont = host.fontPlain11;
                        withContentTransform(host, cacheCtx, (ctx) => {
                            drawSprite(host, ctx, buttonSprite, buttonPos.x, buttonPos.y);
                            drawCenteredText(host,
                                ctx,
                                buttonFont,
                                state.serverName,
                                buttonPos.x + (buttonSprite.subWidth >> 1),
                                buttonPos.y + 22,
                                0xffffff,
                                true,
                            );
                        });
                    }

                    // Server list overlay
                    if (state.serverListOpen) {
                        drawServerListOverlay(host, cacheCtx, state);
                    }

                    // World select grid (without hover) - uses its own cache
                    if (state.worldSelectOpen) {
                        drawWorldSelectGridOnly(host, 
                            cacheCtx,
                            state,
                            host.canvasWidth,
                            host.canvasHeight,
                        );
                    }
                });

                // Update cache metadata
                host.titleCacheStateHash = stateHash;
                host.titleCacheWidth = width;
                host.titleCacheHeight = height;
            }
        }

        // Blit cached title to main canvas
        if (host.titleCache) {
            ctx.drawImage(host.titleCache, 0, 0);
        }

        // Draw hover overlay on main canvas (not cached)
        if (state.worldSelectOpen) {
            withRenderTransform(host, ctx, () => {
                drawWorldSelectHoverOnly(host, ctx, state, host.canvasWidth, host.canvasHeight);
            });
        }
    
}
