import { LoginActions } from "../../LoginAction";
import type { LoginState } from "../../LoginState";
import { GameState, LoginIndex } from "../../GameState";
import type { LoginRendererHost } from "../host";
import {
    getWelcomeLayout,
    LOGIN_FORM_BUTTON_Y,
    LOGIN_FORM_REMEMBER_Y,
    getRememberedPlayBounds,
    REMEMBERED_SIGN_OUT_Y,
    REMEMBER_USERNAME_TEXT,
} from "../layout/geometry";
import { measureText } from "../render/drawUtils";

export function handleWelcomeClick(host: LoginRendererHost, x: number, y: number) {

        const layout = getWelcomeLayout(host);
        const newUserX = layout.centerX - layout.buttonSpacing;
        if (isButtonHit(host, x, y, newUserX, layout.buttonY)) {
            return LoginActions.NEW_USER;
        }
        const existingUserX = layout.centerX + layout.buttonSpacing;
        if (isButtonHit(host, x, y, existingUserX, layout.buttonY)) {
            return LoginActions.EXISTING_USER;
        }
        return undefined;
    
}

export function handleWarningClick(host: LoginRendererHost, x: number, y: number) {

        const buttonY = 321;
        if (isButtonHit(host, x, y, host.loginBoxCenter - 80, buttonY)) {
            return LoginActions.CONTINUE;
        }
        if (isButtonHit(host, x, y, host.loginBoxCenter + 80, buttonY)) {
            return LoginActions.CANCEL;
        }
        return undefined;
    
}

export function handleLoginFormClick(host: LoginRendererHost, state: LoginState, x: number, y: number, gameState: import('../../GameState').GameState) {

        const isConnecting = gameState === GameState.CONNECTING;

        // Field clicks (updated Y offset: 201 + 15 + 15 + 10 = 241)
        const fieldBaseY = 201 + 15 + 15 + 10;
        if (y >= fieldBaseY - 12 && y < fieldBaseY + 3) {
            return LoginActions.FIELD_USERNAME;
        }
        if (y >= fieldBaseY + 3 && y < fieldBaseY + 18) {
            return LoginActions.FIELD_PASSWORD;
        }

        // Don't process button/checkbox clicks when connecting
        if (isConnecting) {
            return undefined;
        }

        // Checkbox: the label or the box toggles it, as drawn by drawLoginForm
        if (host.optionsRadioSprite0 && host.fontBold12) {
            const labelX = host.loginBoxX + 180 - 108;
            const boxRight =
                labelX +
                measureText(host, host.fontBold12, REMEMBER_USERNAME_TEXT) +
                host.optionsRadioSprite0.subWidth;
            const top = (baseline: number) => baseline - host.fontBold12!.lineHeight;
            const boxH = host.optionsRadioSprite0.subHeight || 15;
            if (
                x >= labelX &&
                x <= boxRight &&
                y >= top(LOGIN_FORM_REMEMBER_Y) &&
                y < top(LOGIN_FORM_REMEMBER_Y) + boxH
            ) {
                return LoginActions.TOGGLE_REMEMBER;
            }
        }

        // Buttons
        const buttonY = LOGIN_FORM_BUTTON_Y;
        if (isButtonHit(host, x, y, host.loginBoxCenter - 80, buttonY)) {
            return LoginActions.LOGIN;
        }
        if (isButtonHit(host, x, y, host.loginBoxCenter + 80, buttonY)) {
            return LoginActions.CANCEL;
        }

        return undefined;
    
}

export function handleInvalidCredentialsClick(host: LoginRendererHost, x: number, y: number) {

        const centerX = host.loginBoxX + 180;
        if (isButtonHit(host, x, y, centerX, 276)) {
            return LoginActions.TRY_AGAIN;
        }
        if (isButtonHit(host, x, y, centerX, 326)) {
            return LoginActions.FORGOT_PASSWORD;
        }
        return undefined;
    
}

export function handleAuthenticatorClick(host: LoginRendererHost, state: LoginState, x: number, y: number) {

        // Trust checkbox
        if (host.fontBold12 && host.optionsRadioSprite0) {
            const trustTextWidth = measureText(host, host.fontBold12, "for 30 days: ");
            const checkboxX = host.loginBoxX + 180 - 9 + trustTextWidth + 15;
            const checkboxY = 288 - host.fontBold12.lineHeight;
            const checkboxW = host.optionsRadioSprite0.subWidth;
            const checkboxH = host.optionsRadioSprite0.subHeight || 15;
            if (
                x >= checkboxX &&
                x <= checkboxX + checkboxW &&
                y >= checkboxY &&
                y <= checkboxY + checkboxH
            ) {
                return LoginActions.TOGGLE_TRUST;
            }
        }

        // Buttons
        if (isButtonHit(host, x, y, host.loginBoxX + 180 - 80, 321)) {
            return LoginActions.CONTINUE;
        }
        if (isButtonHit(host, x, y, host.loginBoxX + 180 + 80, 321)) {
            return LoginActions.CANCEL;
        }
        return undefined;
    
}

export function handleForgotPasswordClick(host: LoginRendererHost, x: number, y: number) {

        if (isButtonHit(host, x, y, host.loginBoxX + 180 - 80, 321)) {
            return LoginActions.RECOVER;
        }
        if (isButtonHit(host, x, y, host.loginBoxX + 180 + 80, 321)) {
            return LoginActions.BACK;
        }
        return undefined;
    
}

export function handleDobClick(host: LoginRendererHost, state: LoginState, x: number, y: number) {

        if (state.dobEntryAvailable && !state.onMobile) {
            // Desktop DOB field clicks
            const fieldY = 201 + 15 + 15 + 10;
            let fieldX = host.loginBoxCenter - 150;
            for (let i = 0; i < 8; i++) {
                if (x >= fieldX && x <= fieldX + 30 && y >= fieldY && y <= fieldY + 40) {
                    state.dobFieldIndex = i;
                    return undefined;
                }
                fieldX += i === 1 || i === 3 ? 50 : 35;
            }
            if (isButtonHit(host, x, y, host.loginBoxCenter - 80, 321)) {
                return LoginActions.CONTINUE;
            }
            if (isButtonHit(host, x, y, host.loginBoxCenter + 80, 321)) {
                return LoginActions.CANCEL;
            }
        } else {
            if (isButtonHit(host, x, y, host.loginBoxX + 180 - 80, 321)) {
                return LoginActions.CONTINUE;
            }
            if (isButtonHit(host, x, y, host.loginBoxX + 180 + 80, 321)) {
                return LoginActions.BACK;
            }
        }
        return undefined;
    
}

export function handleMessageClick(host: LoginRendererHost, state: LoginState, x: number, y: number) {

        const buttonY = state.loginIndex === LoginIndex.MESSAGE ? 321 : 311;
        if (isButtonHit(host, x, y, host.loginBoxX + 180, buttonY)) {
            return LoginActions.BACK;
        }
        return undefined;
    
}

export function handleWelcomeDisplayNameClick(host: LoginRendererHost, x: number, y: number) {

        const button = getRememberedPlayBounds(host);
        if (x >= button.x && x < button.x + button.width && y >= button.y && y < button.y + button.height) {
            return LoginActions.PLAY;
        }
        if (isButtonHit(host, x, y, host.loginBoxX + 180, REMEMBERED_SIGN_OUT_Y)) {
            return LoginActions.FORGET_REMEMBERED_LOGIN;
        }
        return undefined;
    
}

export function handleTryAgainClick(host: LoginRendererHost, x: number, y: number) {

        if (isButtonHit(host, x, y, host.loginBoxX + 180, 311)) {
            return LoginActions.TRY_AGAIN;
        }
        return undefined;
    
}

export function handleBannedClick(host: LoginRendererHost, x: number, y: number) {

        if (isButtonHit(host, x, y, host.loginBoxX + 180, 276)) {
            return LoginActions.CONTINUE;
        }
        if (isButtonHit(host, x, y, host.loginBoxX + 180, 326)) {
            return LoginActions.BACK;
        }
        return undefined;
    
}

export function handleOkMessageClick(host: LoginRendererHost, x: number, y: number) {

        if (isButtonHit(host, x, y, host.loginBoxX + 180, 301)) {
            return LoginActions.BACK;
        }
        return undefined;
    
}

export function isButtonHit(
    host: LoginRendererHost,
    clickX: number,
    clickY: number,
    buttonCenterX: number,
    buttonCenterY: number,
): boolean {

        // Login button hit bounds are center +/-75 (x) and +/-20 (y).
        const visualHalfW = 75;
        const visualHalfH = 20;

        // On touch devices, enforce minimum 44px touch targets in SCREEN space.
        // Clicks are in classic content space, so convert through contentScale.
        const scale = host.contentScale > 0 ? host.contentScale : 1.0;
        const minScreenHalf = host.layoutConfig.isTouch
            ? Math.ceil(host.layoutConfig.minTouchTarget / 2)
            : 0;
        const minLayoutHalf = minScreenHalf > 0 ? Math.ceil(minScreenHalf / scale) : 0;
        const hitHalfW = Math.max(visualHalfW, minLayoutHalf);
        const hitHalfH = Math.max(visualHalfH, minLayoutHalf);

        return (
            clickX >= buttonCenterX - hitHalfW &&
            clickX <= buttonCenterX + hitHalfW &&
            clickY >= buttonCenterY - hitHalfH &&
            clickY <= buttonCenterY + hitHalfH
        );
    
}
