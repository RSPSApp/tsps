import { LOADING_BAR } from "../../LoadingBarRenderer";
import type { LoginState } from "../../LoginState";
import type { LoginRendererHost, RenderContext } from "../host";
import { withContentTransform } from "../layout/geometry";
import { drawCenteredText } from "./drawUtils";

function drawProgressBarRect(ctx: RenderContext, barX: number, barY: number, fillWidth: number): void {
    const { WIDTH: barWidth, HEIGHT: barHeight, COLOR } = LOADING_BAR;
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(barX + 1.5, barY + 1.5, barWidth - 3, barHeight - 3);
    ctx.fillStyle = "#000000";
    ctx.fillRect(barX + 2, barY + 2, barWidth - 4, barHeight - 4);
    if (fillWidth > 0) {
        ctx.fillStyle = COLOR;
        ctx.fillRect(barX + 2, barY + 2, fillWidth, barHeight - 4);
    }
}

export function drawLoadingBarToCtx(host: LoginRendererHost, ctx: RenderContext, state: LoginState): void {
    withContentTransform(host, ctx, (ctx) => {
        const centerX = host.LOGIN_BOX_CENTER;
        const barY = 245;
        const barX = centerX - LOADING_BAR.WIDTH / 2;
        drawProgressBarRect(ctx, barX, barY, Math.floor(state.loadingPercent * 3));
        const loadingText = state.loadingText || `${state.loadingPercent}%`;
        const titleText = "RuneScape is loading - please wait...";
        if (host.fontBold12) {
            drawCenteredText(host, ctx, host.fontBold12, titleText, centerX, barY - 8, 0xffffff);
            drawCenteredText(host, ctx, host.fontBold12, loadingText, centerX, barY + 23, 0xffffff);
        } else {
            ctx.font = "bold 13px Helvetica, Arial, sans-serif";
            ctx.fillStyle = "white";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(titleText, centerX, barY - 8);
            ctx.textBaseline = "middle";
            ctx.fillText(loadingText, centerX, barY + LOADING_BAR.HEIGHT / 2);
        }
    });
}

export function drawDownloadBarToCtx(host: LoginRendererHost, ctx: RenderContext, state: LoginState): void {
    withContentTransform(host, ctx, (ctx) => {
        const centerX = host.LOGIN_BOX_CENTER;
        const barY = 245;
        const barX = centerX - LOADING_BAR.WIDTH / 2;
        ctx.font = "bold 13px Helvetica, Arial, sans-serif";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("RuneScape is loading - please wait...", centerX, barY - 8);
        const progress =
            state.downloadTotal > 0
                ? Math.min(100, Math.floor((state.downloadCurrent / state.downloadTotal) * 100))
                : 0;
        drawProgressBarRect(ctx, barX, barY, Math.floor(progress * 3));
        let progressText: string;
        if (state.downloadLabel) {
            const label = state.downloadLabel.charAt(0).toUpperCase() + state.downloadLabel.slice(1);
            progressText = `Loading ${label} - ${progress}%`;
        } else {
            progressText = `${progress}%`;
        }
        ctx.fillStyle = "white";
        ctx.textBaseline = "middle";
        ctx.fillText(progressText, centerX, barY + LOADING_BAR.HEIGHT / 2);
    });
}
