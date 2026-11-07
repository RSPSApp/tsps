import { LoginIndex } from "../../GameState";
import type { LoginState } from "../../LoginState";
import type { LoginRendererHost } from "../host";
export function handleKeyInput(host: LoginRendererHost, state: LoginState, key: string, char: string) {
        if (state.extension) return state.extension.key(key, char);

        if (state.loginIndex === LoginIndex.LOGIN_FORM) {
            if (key === "Tab") {
                state.currentLoginField = state.currentLoginField === 0 ? 1 : 0;
                return true;
            }
            if (key === "Enter") {
                if (state.currentLoginField === 0 && state.username.length > 0) {
                    state.currentLoginField = 1;
                    return true;
                }
                // Enter on password field handled by action system
                return false;
            }
            if (key === "Backspace") {
                if (state.currentLoginField === 0) {
                    if (state.username.length > 0) {
                        state.username = state.username.slice(0, -1);
                    }
                } else {
                    if (state.password.length > 0) {
                        state.password = state.password.slice(0, -1);
                    }
                }
                return true;
            }
            if (char.length === 1 && char.charCodeAt(0) >= 32) {
                if (state.currentLoginField === 0) {
                    if (state.username.length < 320) {
                        state.username += char;
                    }
                } else {
                    if (state.password.length < 20) {
                        state.password += char;
                    }
                }
                return true;
            }
        } else if (state.loginIndex === LoginIndex.AUTHENTICATOR) {
            if (key === "Backspace") {
                if (state.otp.length > 0) {
                    state.otp = state.otp.slice(0, -1);
                }
                return true;
            }
            if (char >= "0" && char <= "9") {
                if (state.otp.length < 6) {
                    state.otp += char;
                }
                return true;
            }
        } else if (state.loginIndex === LoginIndex.FORGOT_PASSWORD) {
            if (key === "Backspace") {
                if (state.username.length > 0) {
                    state.username = state.username.slice(0, -1);
                }
                return true;
            }
            if (char.length === 1 && char.charCodeAt(0) >= 32) {
                if (state.username.length < 320) {
                    state.username += char;
                }
                return true;
            }
        } else if (
            state.loginIndex === LoginIndex.DATE_OF_BIRTH &&
            state.dobEntryAvailable &&
            !state.onMobile
        ) {
            if (key === "Tab") {
                state.dobFieldIndex = (state.dobFieldIndex + 1) % 8;
                return true;
            }
            if (key === "Backspace") {
                const current = state.dobFields[state.dobFieldIndex];
                if (current && current.length > 0) {
                    state.dobFields[state.dobFieldIndex] = current.slice(0, -1);
                } else if (state.dobFieldIndex > 0) {
                    state.dobFieldIndex--;
                }
                return true;
            }
            if (char >= "0" && char <= "9") {
                const current = state.dobFields[state.dobFieldIndex] ?? "";
                if (current.length < 1) {
                    state.dobFields[state.dobFieldIndex] = current + char;
                    if (state.dobFieldIndex < 7) {
                        state.dobFieldIndex++;
                    }
                }
                return true;
            }
        }
        return false;
    
}
