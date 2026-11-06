import { GameState } from "../../GameState";
import type { LoginState } from "../../LoginState";
import type { LoginRendererHost, RenderContext } from "../host";
import {
    getWelcomeLayout,
    LOGIN_FORM_BUTTON_Y,
    LOGIN_FORM_REMEMBER_Y,
    REMEMBER_USERNAME_TEXT,
} from "../layout/geometry";
import { isCaretVisible } from "../canvas";
import { drawButton, drawCenteredText, drawText, drawSprite, measureText, getCheckboxSprite, truncateFromStart } from "./drawUtils";
import { BRAND_NAME } from "../../../../config/brand";

export function drawWelcomeScreen(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12) return;
        const layout = getWelcomeLayout(host);
        const welcomeName = state.serverName?.trim() || BRAND_NAME;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            `Welcome to ${welcomeName}`,
            layout.centerX,
            layout.titleY,
            0xffff00,
            true,
        );
        drawButton(host, 
            ctx,
            layout.centerX - layout.buttonSpacing,
            layout.buttonY,
            "New User",
        );
        drawButton(host, 
            ctx,
            layout.centerX + layout.buttonSpacing,
            layout.buttonY,
            "Existing User",
        );
    
}

export function drawWarningScreen(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12) return;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response0,
            host.loginBoxX + 180,
            201,
            0xffff00,
            true,
        );
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response1,
            host.loginBoxX + 180,
            236,
            0xffffff,
            true,
        );
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response2,
            host.loginBoxX + 180,
            251,
            0xffffff,
            true,
        );
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response3,
            host.loginBoxX + 180,
            266,
            0xffffff,
            true,
        );
        drawButton(host, ctx, host.loginBoxCenter - 80, 321, "Continue");
        drawButton(host, ctx, host.loginBoxCenter + 80, 321, "Cancel");
    
}

export function drawLoginForm(host: LoginRendererHost, ctx: RenderContext, state: LoginState, gameState: GameState) {

        if (!host.fontBold12) return;

        const isConnecting = gameState === GameState.CONNECTING;

        // Response messages at top
        let textY = 201;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response0,
            host.loginBoxX + 180,
            textY,
            0xffff00,
            true,
        );
        textY += 15;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response1,
            host.loginBoxX + 180,
            textY,
            0xffff00,
            true,
        );
        textY += 15;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response2,
            host.loginBoxX + 180,
            textY,
            0xffff00,
            true,
        );
        textY += 10; // OSRS uses 10px gap before input fields

        // Username field
        const cursor = isCaretVisible(host) ? "|" : "";
        const displayUsername = state.isUsernameHidden
            ? "*".repeat(state.username.length)
            : state.username;
        const usernameCursor = state.currentLoginField === 0 ? cursor : "";
        drawText(host, 
            ctx,
            host.fontBold12,
            "Username: " + truncateFromStart(host, displayUsername, 195) + usernameCursor,
            host.loginBoxX + 180 - 108,
            textY,
            0xffffff,
            true,
        );
        textY += 15;

        // Password field
        const passwordCursor = state.currentLoginField === 1 ? cursor : "";
        drawText(host, 
            ctx,
            host.fontBold12,
            "Password: " + state.getMaskedPassword() + passwordCursor,
            host.loginBoxX + 180 - 108,
            textY,
            0xffffff,
            true,
        );
        // Checkboxes (only show when not connecting)
        if (!isConnecting) {
            const labelX = host.loginBoxX + 180 - 108;
            const sprite = getCheckboxSprite(host, state.rememberUsername, state.rememberUsernameHover);
            if (sprite) {
                const y = LOGIN_FORM_REMEMBER_Y;
                drawText(host, ctx, host.fontBold12, REMEMBER_USERNAME_TEXT, labelX, y, 0xffff00, true);
                drawSprite(host, 
                    ctx,
                    sprite,
                    labelX + measureText(host, host.fontBold12, REMEMBER_USERNAME_TEXT),
                    y - host.fontBold12.lineHeight,
                );
            }
        }

        // Buttons (hide when connecting)
        if (!isConnecting) {
            drawButton(host, ctx, host.loginBoxCenter - 80, LOGIN_FORM_BUTTON_Y, "Login");
            drawButton(host, ctx, host.loginBoxCenter + 80, LOGIN_FORM_BUTTON_Y, "Cancel");
        }

        // Help link (only show when not connecting)
        if (!isConnecting && host.fontPlain11) {
            const helpText =
                state.loginFieldType === 1
                    ? "Can't login? Click here."
                    : "Having trouble logging in?";
            drawCenteredText(host, 
                ctx,
                host.fontPlain11,
                helpText,
                host.loginBoxX + 180,
                357,
                0xffffff,
                true,
            );
        }
    
}

export function drawInvalidCredentials(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12) return;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response0,
            host.loginBoxX + 180,
            201,
            0xffff00,
            true,
        );
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response1,
            host.loginBoxX + 180,
            221,
            0xffff00,
            true,
        );
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response2,
            host.loginBoxX + 180,
            241,
            0xffff00,
            true,
        );
        drawButton(host, ctx, host.loginBoxX + 180, 276, "Try again");
        drawButton(host, ctx, host.loginBoxX + 180, 326, "Forgotten password?");
    
}

export function drawAuthenticator(host: LoginRendererHost, ctx: RenderContext, state: LoginState) {

        if (!host.fontBold12) return;

        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            "Authenticator",
            host.loginBoxX + 180,
            201,
            0xffff00,
            true,
        );

        let textY = 236;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response1,
            host.loginBoxX + 180,
            textY,
            0xffffff,
            true,
        );
        textY += 15;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response2,
            host.loginBoxX + 180,
            textY,
            0xffffff,
            true,
        );
        textY += 15;
        drawCenteredText(host, 
            ctx,
            host.fontBold12,
            state.response3,
            host.loginBoxX + 180,
            textY,
            0xffffff,
            true,
        );
        textY += 15;

        // PIN field
        const cursor = isCaretVisible(host) ? "|" : "";
        drawText(host, 
            ctx,
            host.fontBold12,
            "PIN: " + state.getMaskedOtp() + cursor,
            host.loginBoxX + 180 - 108,
            textY,
            0xffffff,
            true,
        );

        // Trust checkbox
        textY -= 8;
        drawText(host, 
            ctx,
            host.fontBold12,
            "Trust this computer",
            host.loginBoxX + 180 - 9,
            textY,
            0xffff00,
            true,
        );
        textY += 15;
        drawText(host, 
            ctx,
            host.fontBold12,
            "for 30 days: ",
            host.loginBoxX + 180 - 9,
            textY,
            0xffff00,
            true,
        );

        const trustTextWidth = measureText(host, host.fontBold12, "for 30 days: ");
        const checkboxX = host.loginBoxX + 180 - 9 + trustTextWidth + 15;
        const checkboxY = textY - host.fontBold12.lineHeight;
        const trustSprite = state.trustComputer
            ? host.optionsRadioSprite2
            : host.optionsRadioSprite0;
        if (trustSprite) {
            drawSprite(host, ctx, trustSprite, checkboxX, checkboxY);
        }

        drawButton(host, ctx, host.loginBoxX + 180 - 80, 321, "Continue");
        drawButton(host, ctx, host.loginBoxX + 180 + 80, 321, "Cancel");
    
}
