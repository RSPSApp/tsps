import { GameState, LoginIndex } from "../../GameState";
import type { LoginState } from "../../LoginState";
import type { LoginRendererHost, RenderContext } from "../host";
import { withContentTransform } from "../layout/geometry";
import { drawSprite } from "./drawUtils";
import {
    drawWelcomeScreen,
    drawWarningScreen,
    drawLoginForm,
    drawInvalidCredentials,
    drawAuthenticator,
} from "./loginScreensPrimary";
import {
    drawForgotPassword,
    drawMessage,
    drawDateOfBirth,
    drawNotEligible,
    drawTryAgain,
    drawWelcomeDisplayName,
    drawTerms,
    drawMustAcceptTerms,
} from "./loginScreensSecondary";
import {
    drawBanned,
    drawOkMessage,
    drawDobNotSet,
    drawDownloadLauncher,
    drawWorldHopWarning,
} from "./loginScreensTertiary";

export function drawLoginScreenToCtx(host: LoginRendererHost, ctx: RenderContext, state: LoginState, gameState: GameState): void {

        // Draw classic login panels inside the centered/scaled content band.
        withContentTransform(host, ctx, (ctx) => {
            // Draw titlebox background at classic coordinates.
            if (host.titleboxSprite) {
                drawSprite(host, ctx, host.titleboxSprite, host.LOGIN_BOX_X, host.TITLEBOX_Y);
            }

            // Route to appropriate screen
            switch (state.loginIndex) {
                case LoginIndex.WELCOME:
                    drawWelcomeScreen(host, ctx, state);
                    break;
                case LoginIndex.WARNING:
                    drawWarningScreen(host, ctx, state);
                    break;
                case LoginIndex.LOGIN_FORM:
                    drawLoginForm(host, ctx, state, gameState);
                    break;
                case LoginIndex.INVALID_CREDENTIALS:
                    drawInvalidCredentials(host, ctx, state);
                    break;
                case LoginIndex.AUTHENTICATOR:
                    drawAuthenticator(host, ctx, state);
                    break;
                case LoginIndex.FORGOT_PASSWORD:
                    drawForgotPassword(host, ctx, state);
                    break;
                case LoginIndex.MESSAGE:
                    drawMessage(host, ctx, state);
                    break;
                case LoginIndex.DATE_OF_BIRTH:
                    drawDateOfBirth(host, ctx, state);
                    break;
                case LoginIndex.NOT_ELIGIBLE:
                    drawNotEligible(host, ctx, state);
                    break;
                case LoginIndex.TRY_AGAIN:
                    drawTryAgain(host, ctx, state);
                    break;
                case LoginIndex.WELCOME_DISPLAY_NAME:
                    drawWelcomeDisplayName(host, ctx, state);
                    break;
                case LoginIndex.TERMS:
                    drawTerms(host, ctx, state);
                    break;
                case LoginIndex.MUST_ACCEPT_TERMS:
                    drawMustAcceptTerms(host, ctx, state);
                    break;
                case LoginIndex.BANNED:
                    drawBanned(host, ctx, state);
                    break;
                case LoginIndex.OK_MESSAGE:
                    drawOkMessage(host, ctx, state);
                    break;
                case LoginIndex.DOB_NOT_SET:
                    drawDobNotSet(host, ctx, state);
                    break;
                case LoginIndex.DOWNLOAD_LAUNCHER:
                    drawDownloadLauncher(host, ctx, state);
                    break;
                case LoginIndex.WORLD_HOP_WARNING:
                    drawWorldHopWarning(host, ctx, state);
                    break;
            }
        });
    
}
