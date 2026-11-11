/** RuneLite Key Remapping's PRESS_ENTER_TO_CHAT, drawn in the chat line while it is locked. */
export const PRESS_ENTER_TO_CHAT = "Press Enter to Chat...";

const isEnter = (event: KeyboardEvent): boolean => event.code === "Enter" || event.code === "NumpadEnter";

/**
 * "Press Enter to Chat" (RuneLite's Key Remapping): the chat line starts locked, so keys can do
 * other things (WASD turns the camera). Enter opens it; sending the message (Enter) or leaving it
 * (Escape, which clears what was typed) locks it again.
 */
export class EnterToTypeChat {
    private typing = false;

    constructor(private readonly hooks: {
        /** Typing started or stopped: the chat line's text changes. */
        onChange(): void;
        /** Escape left the message: forget what was typed. */
        clearDraft(): void;
    }) {}

    isTyping(): boolean {
        return this.typing;
    }

    /** Locks the chat line again, as at login. */
    lock(): void {
        this.setTyping(false);
    }

    /**
     * Switches on Enter and Escape. Returns true when the key only switched and goes no further:
     * the Enter that opens the chat line, or the Escape that leaves it (so it closes nothing).
     * The Enter that ends typing goes on to the chatbox, which sends the message.
     */
    keyDown(event: KeyboardEvent): boolean {
        if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return false;
        if (!this.typing) {
            if (!isEnter(event)) return false;
            this.setTyping(true);
            return true;
        }
        if (isEnter(event)) {
            this.setTyping(false);
            return false;
        }
        if (event.code !== "Escape") return false;
        this.hooks.clearDraft();
        this.setTyping(false);
        return true;
    }

    private setTyping(typing: boolean): void {
        if (this.typing === typing) return;
        this.typing = typing;
        this.hooks.onChange();
    }
}

/**
 * The chat line ("Name: text*") as drawn while it is locked: "Name: Press Enter to Chat...",
 * as RuneLite's setChatboxWidgetInput. Undefined for a line with no name to keep.
 */
export function lockedChatLine(text: string): string | undefined {
    const colon = text.indexOf(":");
    return colon < 0 ? undefined : `${text.slice(0, colon)}: ${PRESS_ENTER_TO_CHAT}`;
}
