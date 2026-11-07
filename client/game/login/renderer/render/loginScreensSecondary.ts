import type { LoginState } from "../../LoginState";
import type { LoginRendererHost, RenderContext } from "../host";
import { isCaretVisible } from "../canvas";
import {
    getRememberedPlayBounds,
    REMEMBERED_SIGN_OUT_TEXT,
    REMEMBERED_SIGN_OUT_Y,
    REMEMBERED_PLAY_Y,
    REMEMBERED_TITLE_Y,
} from "../layout/geometry";
import { drawButton, drawCenteredText, drawSprite, drawText, truncateFromStart } from "./drawUtils";

export function drawForgotPassword(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12 || !host.fontPlain12) return;

        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            "Forgotten your password?",
            host.loginBoxX + 180,
            201,
            0xffff00,
            true,
        );

        let textY = 221;
        drawCenteredText(host, 
            ctx,
            host.fontPlain12,
            state.response1,
            host.loginBoxX + 180,
            textY,
            0xffffff,
            true,
        );
        textY += 15;
        drawCenteredText(host, 
            ctx,
            host.fontPlain12,
            state.response2,
            host.loginBoxX + 180,
            textY,
            0xffffff,
            true,
        );
        textY += 15;
        drawCenteredText(host, 
            ctx,
            host.fontPlain12,
            state.response3,
            host.loginBoxX + 180,
            textY,
            0xffffff,
            true,
        );
        textY += 15;

        const cursor = isCaretVisible(host) ? "|" : "";
        const displayUsername = truncateFromStart(host, state.username, 215);
        drawText(host, 
            ctx,
            host.fontBold12,
            "Email: " + displayUsername + cursor,
            host.loginBoxX + 180 - 108,
            textY,
            0xffffff,
            true,
        );

        drawButton(host, ctx, host.loginBoxX + 180 - 80, 321, "Recover");
        drawButton(host, ctx, host.loginBoxX + 180 + 80, 321, "Back");

        if (host.fontPlain11) {
            drawCenteredText(host, 
                ctx,
                host.fontPlain11,
                "Still having trouble logging in?",
                host.loginBoxCenter,
                356,
                0x0fffffff,
                true,
            );
        }
    
}

export function drawMessage(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12) return;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response1,
            host.loginBoxX + 180,
            216,
            0xffffff,
            true,
        );
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response2,
            host.loginBoxX + 180,
            231,
            0xffffff,
            true,
        );
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response3,
            host.loginBoxX + 180,
            246,
            0xffffff,
            true,
        );
        drawButton(host, ctx, host.loginBoxX + 180, 321, "Back");
    
}

export function drawDateOfBirth(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12) return;

        if (state.dobEntryAvailable && !state.onMobile) {
            // Desktop DOB entry
            let textY = 201;
            drawCenteredText(host, 
                ctx,
                host.fontBold12,
                state.response1,
                host.loginBoxCenter,
                textY,
                0xffff00,
                true,
            );
            textY += 15;
            drawCenteredText(host, 
                ctx,
                host.fontBold12,
                state.response2,
                host.loginBoxCenter,
                textY,
                0xffff00,
                true,
            );
            textY += 15;
            drawCenteredText(host, 
                ctx,
                host.fontBold12,
                state.response3,
                host.loginBoxCenter,
                textY,
                0xffff00,
                true,
            );

            // DOB fields would be drawn here
            drawButton(host, ctx, host.loginBoxCenter - 80, 321, "Submit");
            drawButton(host, ctx, host.loginBoxCenter + 80, 321, "Cancel");
        } else {
            // Mobile alternative
            drawCenteredText(host, 
                ctx,
                host.fontBold12,
                "Your date of birth isn't set.",
                host.loginBoxX + 180,
                216,
                0xffff00,
                true,
            );
            drawButton(host, ctx, host.loginBoxX + 180 - 80, 321, "Set Date of Birth");
            drawButton(host, ctx, host.loginBoxX + 180 + 80, 321, "Back");
        }
    
}

export function drawNotEligible(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12) return;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            "Sorry, but your account is not eligible to play.",
            host.loginBoxX + 180,
            216,
            0xffff00,
            true,
        );
        drawButton(host, ctx, host.loginBoxX + 180, 301, "Ok");
    
}

export function drawTryAgain(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12) return;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response1,
            host.loginBoxX + 180,
            216,
            0xffffff,
            true,
        );
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response2,
            host.loginBoxX + 180,
            231,
            0xffffff,
            true,
        );
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response3,
            host.loginBoxX + 180,
            246,
            0xffffff,
            true,
        );
        drawButton(host, ctx, host.loginBoxX + 180, 311, "Try Again");
    
}

export function drawWelcomeDisplayName(
    host: LoginRendererHost,
    ctx: RenderContext,
    state: LoginState,
    isConnecting: boolean,
) {

        if (!host.fontBold12) return;
        const centerX = host.loginBoxX + 180;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            `Welcome to ${state.serverName?.trim() || "RSPS.app"}`,
            centerX,
            REMEMBERED_TITLE_Y,
            0xffff00,
            true,
        );
        if (isConnecting) {
            drawCenteredText(host, ctx, host.fontBold12, state.response1, centerX, REMEMBERED_PLAY_Y + 5, 0xffffff, true);
            return;
        }

        const button = getRememberedPlayBounds(host);
        if (host.titlebuttonLargeSprite && host.playNowTextSprite) {
            drawSprite(host, ctx, host.titlebuttonLargeSprite, button.x, button.y);
            // Centred on the sprite's full canvas: drawSprite adds the offset of its trimmed pixels.
            const text = host.playNowTextSprite;
            drawSprite(host, 
                ctx,
                text,
                centerX - Math.floor(text.width / 2),
                REMEMBERED_PLAY_Y - 13 - Math.floor(text.height / 2),
            );
        } else {
            drawButton(host, ctx, centerX, REMEMBERED_PLAY_Y - 8, "Play Now");
        }
        drawCenteredText(host, ctx, host.fontBold12, state.displayName, centerX, REMEMBERED_PLAY_Y + 18, 0xffff00, true);

        drawButton(host, ctx, centerX, REMEMBERED_SIGN_OUT_Y, REMEMBERED_SIGN_OUT_TEXT);
    
}

export function drawTerms(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12) return;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            "Terms and Conditions",
            host.loginBoxX + 180,
            201,
            0xffff00,
            true,
        );
        drawButton(host, ctx, host.loginBoxCenter - 80, 311, "Accept");
        drawButton(host, ctx, host.loginBoxCenter + 80, 311, "Decline");
    
}

export function drawMustAcceptTerms(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12) return;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            "You must accept the terms to continue.",
            host.loginBoxX + 180,
            216,
            0xffff00,
            true,
        );
        drawButton(host, ctx, host.loginBoxX + 180, 311, "Back");
    
}
