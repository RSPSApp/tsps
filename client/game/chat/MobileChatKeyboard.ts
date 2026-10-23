import type { InputManager } from "../InputManager";
import type { VarManager } from "../../rs/config/vartype/VarManager";
import { isMobileMode, isTouchDevice } from "../../common/utils/DeviceUtil";

const CHAT_INPUT_VARC = 335;
const OSRS_KEY_ENTER = 84;
const OSRS_KEY_BACKSPACE = 85;

export type MobileChatKeyboardDeps = {
    inputManager: InputManager;
    varManager: VarManager;
};

/**
 * Soft-keyboard bridge for mobile chat (CS2 mobile_keyboardshow / hide).
 * Uses a near-invisible HTML input focused under the tap gesture when possible.
 */
export class MobileChatKeyboard {
    private input?: HTMLInputElement;
    private open = false;
    private lastValue = "";

    constructor(private readonly deps: MobileChatKeyboardDeps) {}

    get isOpen(): boolean {
        return this.open;
    }

    show(hint: string = "", keyboardType: number = 0): void {
        if (typeof document === "undefined" || (!isMobileMode && !isTouchDevice)) return;
        const input = this.ensureInput();
        input.placeholder = hint;
        input.inputMode = (keyboardType | 0) === 1 ? "numeric" : "text";
        input.value = this.deps.varManager.getVarcString(CHAT_INPUT_VARC) ?? "";
        this.lastValue = input.value;
        this.open = true;
        try {
            input.focus({ preventScroll: true });
        } catch {
            try {
                input.focus();
            } catch {}
        }
    }

    hide(): void {
        this.open = false;
        try {
            this.input?.blur();
        } catch {}
    }

    private ensureInput(): HTMLInputElement {
        if (this.input?.isConnected) return this.input;
        const input = document.createElement("input");
        input.type = "text";
        input.autocomplete = "off";
        input.dataset.mobileChatInput = "true";
        // Keep the native caret above the keyboard so typing cannot pan the game out of view.
        input.style.cssText =
            "position:fixed;top:0;left:0;width:16px;height:16px;font-size:16px;border:0;padding:0;margin:0;opacity:0;pointer-events:none";
        input.addEventListener("input", () => {
            if (!this.open) return;
            const next = input.value;
            const prev = this.lastValue;
            for (let i = prev.length; i > 0 && next.length < i; i--) {
                this.deps.inputManager.enqueueOsrsKeyPress(OSRS_KEY_BACKSPACE, "Backspace");
            }
            const start = Math.min(prev.length, next.length);
            for (let i = start; i < next.length; i++) {
                this.deps.inputManager.enqueueTypedChar(next.charCodeAt(i));
            }
            this.lastValue = next;
        });
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                this.deps.inputManager.enqueueOsrsKeyPress(OSRS_KEY_ENTER, "Enter");
            }
        });
        document.body.appendChild(input);
        this.input = input;
        return input;
    }
}
