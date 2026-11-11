import type { LoginState } from "../../LoginState";
import type { LoginRendererHost, RenderContext } from "../host";
import {
    SERVER_LIST_OWNER_COLUMN_START,
    SERVER_LIST_PANEL_WIDTH,
    SERVER_LIST_PLAYERS_COLUMN_START,
} from "../constants";
import { drawGradientRect, drawButton, drawCenteredText, drawText, ellipsis } from "./drawUtils";

export function drawServerListOverlay(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12 || !host.fontPlain12) return;

        const servers = host.serverList;
        const rowH = 24;
        const headerH = 30;
        const panelW = SERVER_LIST_PANEL_WIDTH;
        const showRows = host.probed;
        const contentH = showRows ? servers.length * rowH : 30;
        const panelH = headerH + contentH;
        const panelX = Math.floor((host.canvasWidth - panelW) / 2);
        const panelY = Math.floor((host.canvasHeight - panelH) / 2);

        // Dim background - cover full canvas by inverting the render transform
        const dimScale = host.renderScale || 1;
        const dimOffX = host.renderOffsetX || 0;
        const dimOffY = host.renderOffsetY || 0;
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(
            -dimOffX / dimScale,
            -dimOffY / dimScale,
            host.renderSurfaceWidth / dimScale + 1,
            host.renderSurfaceWidth / dimScale + 1,
        );

        // Panel background
        ctx.fillStyle = "#2b2013";
        ctx.fillRect(panelX, panelY, panelW, panelH);

        // Panel border
        ctx.strokeStyle = "#6b5a3e";
        ctx.lineWidth = 2;
        ctx.strokeRect(panelX + 1, panelY + 1, panelW - 2, panelH - 2);

        // Header background
        drawGradientRect(host, 
            ctx,
            panelX + 2,
            panelY + 2,
            panelW - 4,
            headerH - 2,
            0x5c4a30,
            0x3d2e1a,
        );

        // Column headers
        const col1X = panelX + 10;
        const col2X = panelX + SERVER_LIST_OWNER_COLUMN_START;
        const col3X = panelX + SERVER_LIST_PLAYERS_COLUMN_START;
        const headerTextY = panelY + 20;
        drawText(host, ctx, host.fontBold12, "Server Name", col1X, headerTextY, 0xffcc00);
        drawText(host, ctx, host.fontBold12, "Owner", col2X, headerTextY, 0xffcc00);
        drawText(host, ctx, host.fontBold12, "Players", col3X, headerTextY, 0xffcc00);

        // Separator line
        ctx.fillStyle = "#6b5a3e";
        ctx.fillRect(panelX + 4, panelY + headerH, panelW - 8, 1);

        const confirmServer = state.serverSwitchConfirm;
        if (confirmServer) {
            // The World Switcher's confirmation, as live's chatbox asks it.
            drawCenteredText(host,
                ctx,
                host.fontPlain12,
                ellipsis(host, `Are you sure you wish to switch to ${confirmServer.name}?`, panelW - 16),
                panelX + panelW / 2,
                panelY + headerH + Math.min(contentH, 60) / 2 + 4,
                0xffffff,
            );
        } else if (!showRows) {
            // First probe not yet complete — show loading
            drawCenteredText(host, 
                ctx,
                host.fontPlain12,
                "Loading servers...",
                panelX + panelW / 2,
                panelY + headerH + 18,
                0xaaaaaa,
            );
        } else {
            // Refreshing indicator
            if (host.probing) {
                drawText(host, 
                    ctx,
                    host.fontPlain12,
                    "Refreshing...",
                    col3X - 30,
                    panelY + panelH - 4,
                    0xffcc00,
                );
            }

            // Server rows
            const rowStartY = panelY + headerH;
            for (let i = 0; i < servers.length; i++) {
                const server = servers[i];
                const ry = rowStartY + i * rowH;

                // Hover highlight
                if (state.hoveredServerIndex === i) {
                    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
                    ctx.fillRect(panelX + 4, ry, panelW - 8, rowH);
                }

                // Alternating row tint
                if (i % 2 === 0) {
                    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
                    ctx.fillRect(panelX + 4, ry, panelW - 8, rowH);
                }

                const textY = ry + 16;
                const nameMaxW = col2X - col1X - 4;
                const ownerMaxW = col3X - col2X - 4;
                drawText(host, 
                    ctx,
                    host.fontPlain12,
                    ellipsis(host, server.name, nameMaxW),
                    col1X,
                    textY,
                    0xffffff,
                );
                drawText(host, 
                    ctx,
                    host.fontPlain12,
                    ellipsis(host, server.ownerUsername ?? "—", ownerMaxW),
                    col2X,
                    textY,
                    server.ownerUsername ? 0xffcc00 : 0x777777,
                );
                if (server.playerCount === null) {
                    drawText(host, ctx, host.fontPlain12, "Offline", col3X, textY, 0xff0000);
                } else if (server.playerCount === -1) {
                    drawText(host, ctx, host.fontPlain12, "Online", col3X, textY, 0x00ff00);
                } else {
                    drawText(host, ctx, host.fontPlain12, `${server.playerCount}`, col3X, textY, 0x00ff00);
                }
            }
        }

        ctx.restore();

        // Discord notice
        drawCenteredText(host, 
            ctx,
            host.fontPlain12!,
            "Register on RSPS.app to publish your own world",
            panelX + panelW / 2,
            panelY - 8,
            0xaaaaaa,
        );

        // Buttons below the panel
        const confirming = !!confirmServer;
        drawButton(host, ctx, panelX + panelW / 2 - 80, panelY + panelH + 30, confirming ? "Cancel" : "Refresh");
        drawButton(host, ctx, panelX + panelW / 2 + 80, panelY + panelH + 30, confirming ? "Switch world" : "Close");
    
}
