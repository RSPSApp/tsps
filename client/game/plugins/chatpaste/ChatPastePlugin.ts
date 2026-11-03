import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { InputManager } from "../../InputManager";
import type { OsrsClient } from "../../OsrsClient";

/** The longest chat line the game sends (and its typed-character queue holds 128). */
export const MAX_PASTE_LENGTH = 80;

type PasteTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** Whether a key event is the paste shortcut: Ctrl+V, or Cmd+V on a Mac. */
export function isPasteShortcut(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "code" | "key">): boolean {
    return (event.ctrlKey || event.metaKey) && !event.altKey && (event.code === "KeyV" || event.key.toLowerCase() === "v");
}

/**
 * Clipboard text as one chat line: line breaks and tabs become spaces, and characters the game's
 * fonts have no glyph for (controls, anything past Latin-1) go.
 */
export function pasteText(text: string): string {
    return text
        .replace(/[\r\n\t]+/g, " ")
        .replace(/[^ -~ -ÿ]/g, "")
        .slice(0, MAX_PASTE_LENGTH);
}

/**
 * Ctrl+V (Cmd+V on a Mac) in the game types the clipboard's text, as if typed: into the chatbox,
 * or whatever text input (a bank search, an amount) is open. Not a RuneLite plugin.
 *
 * The game swallows key presses, so the paste shortcut is let through to the browser, which
 * then fires a paste event with the text.
 */
export class ChatPastePlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Chat Paste",
        description: "Paste text into the chatbox with Ctrl+V",
        tags: ["chat", "clipboard", "copy", "paste", "input"],
        enabledByDefault: false,
        configKey: "chatpasteplugin",
    };

    private readonly input: Pick<InputManager, "addInputFilter" | "enqueueTypedChar">;
    private readonly target: PasteTarget | undefined;
    private removeFilter?: () => void;
    private readonly onPaste = (event: Event) => this.paste(event as ClipboardEvent);

    constructor(input?: Pick<InputManager, "addInputFilter" | "enqueueTypedChar">, target?: PasteTarget) {
        super();
        this.input = input ?? inject<OsrsClient>(CLIENT_TOKEN).inputManager;
        this.target = target ?? (typeof document !== "undefined" ? document : undefined);
    }

    protected async startUp(): Promise<void> {
        // Returning true skips the game's handling, preventDefault included.
        this.removeFilter = this.input.addInputFilter((type, event) =>
            (type === "keyPressed" || type === "keyReleased") && "code" in event && isPasteShortcut(event));
        this.target?.addEventListener("paste", this.onPaste);
    }

    protected async shutDown(): Promise<void> {
        this.removeFilter?.();
        this.removeFilter = undefined;
        this.target?.removeEventListener("paste", this.onPaste);
    }

    paste(event: Pick<ClipboardEvent, "clipboardData" | "target" | "preventDefault">): void {
        // A paste into the page's own fields (the plugin panels, the login form) is theirs.
        if (isEditable(event.target)) return;
        const text = pasteText(event.clipboardData?.getData("text/plain") ?? "");
        if (!text) return;
        event.preventDefault();
        for (const char of text) this.input.enqueueTypedChar(char.charCodeAt(0));
    }
}

function isEditable(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element || typeof element.tagName !== "string") return false;
    const tag = element.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable === true;
}
