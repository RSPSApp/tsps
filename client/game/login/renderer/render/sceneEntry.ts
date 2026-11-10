import type { LoginState } from "../../LoginState";
import { isMapEditorUrl } from "../../../../config/clientEnv";
import type { LoginRendererHost } from "../host";
import { withRenderTransform } from "../layout/config";
import { updateLayout } from "../layout/updateLayout";
import { getCanvas, getContext } from "../canvas";
import { drawTitleBackgroundToCtx } from "./background";
import { drawLoadingBarToCtx, drawDownloadBarToCtx } from "./loadingBars";
import { drawLogoToCtx } from "./drawUtils";
import { drawTitleMuteButton } from "../controls";
import { drawEditModeLoadingScreen } from "../../../plugins/editmode/editModeLoadingScreen";

function isEditModeLaunch(): boolean {
    return isMapEditorUrl();
}

export function drawDownload(host: LoginRendererHost, state: LoginState, width: number, height: number, layoutWidth = width, layoutHeight = height) {

        const canvas = getCanvas(host, width, height);
        const ctx = getContext(host);
        if (!ctx) return;

        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        updateLayout(host, layoutWidth, layoutHeight, width, height);

        if (isEditModeLaunch()) {
            const percent = state.downloadTotal > 0
                ? ` - ${Math.min(100, Math.floor(100 * state.downloadCurrent / state.downloadTotal))}%`
                : "";
            drawEditModeLoadingScreen(host, ctx, `${state.downloadLabel || "Preparing game assets"}${percent}`);
            return;
        }

        withRenderTransform(host, ctx, () => {
            // Draw title background if available (may not be during early download)
            drawTitleBackgroundToCtx(host, ctx);
            drawLogoToCtx(host, ctx, state.serverWorldFlags);

            // Draw download progress bar
            drawDownloadBarToCtx(host, ctx, state);
        });
    
}

export function drawInitial(host: LoginRendererHost, state: LoginState, width: number, height: number, layoutWidth = width, layoutHeight = height) {

        const canvas = getCanvas(host, width, height);
        const ctx = getContext(host);
        if (!ctx) return;

        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        updateLayout(host, layoutWidth, layoutHeight, width, height);

        if (isEditModeLaunch()) {
            drawEditModeLoadingScreen(host, ctx, state.loadingText || "Initializing the editor");
            return;
        }

        withRenderTransform(host, ctx, () => {
            // Draw title background
            drawTitleBackgroundToCtx(host, ctx);
            drawLogoToCtx(host, ctx, state.serverWorldFlags);

            // Draw loading bar
            drawLoadingBarToCtx(host, ctx, state);

            // OSRS title loading state shows the music toggle before the welcome buttons appear.
            drawTitleMuteButton(host, ctx, state.titleMusicDisabled);
        });
    
}
