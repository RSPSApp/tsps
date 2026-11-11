import { CHATINPUT } from "@runelite/api/gameval/VarClientID";
import { EnterToTypeChat, lockedChatLine } from "../chat/EnterToTypeChat";
import type { KeyRemapper } from "../InputManager";
import type { OsrsClient } from "../OsrsClient";
import type { WidgetManager } from "../../widgets/WidgetManager";
import type { WidgetNode } from "../../widgets/WidgetNode";
import { ARROW_KEY_CODES, type ArrowKey, asArrowKey, cameraArrowFor } from "./CameraKeys";

/** chatbox:input, the chat line ("Name: text*"). */
const CHATBOX_INPUT_UID = (162 << 16) | 58;
const CHATBOX_GROUP = 162;
/** The chatbox's key listener (script 73) types into the chat line only while both show. */
const CHAT_LINE_PARTS = [(CHATBOX_GROUP << 16) | 56, (CHATBOX_GROUP << 16) | 57];

/** A shown component that takes typed keys (if_setonkey). */
function listensForKeys(widgets: WidgetManager, widget: WidgetNode | null | undefined): boolean {
    const w = widget as any;
    if (!w?.eventHandlers?.onKey && !(Array.isArray(w?.onKey) && w.onKey.length > 0)) return false;
    return !widgets.isEffectivelyHidden(w.uid);
}
/** Redraws the chat line from VarC 335; the chatbox key listener (script 73) runs it after each key. */
export const CHAT_LINE_REDRAW_SCRIPT = 223;

/** WASD camera's on/off switch, wherever it is shown and kept. */
export interface WasdCameraSetting {
    isEnabled(): boolean;
    /** Calls `listener` after each change; returns a function that stops it. */
    subscribe(listener: () => void): () => void;
}

/** What WASD camera reads from the client. */
export type WasdCameraClient = Pick<
    OsrsClient,
    "inputManager" | "isLoggedIn" | "isWidgetTextInputActive" | "followPlayerCamera" | "varManager" |
    "widgetManager" | "executeScriptListener"
>;

/**
 * WASD camera with "Press Enter to Chat", as RuneLite's Key Remapping: while the chat line is
 * locked, W/A/S/D are the arrow keys and other keys type nothing into chat. Enter opens the line;
 * sending (Enter) or leaving (Escape) a message locks it again.
 */
export class WasdCamera implements KeyRemapper {
    readonly chat = new EnterToTypeChat({
        onChange: () => {
            this.redrawPending = true;
        },
        clearDraft: () => {
            this.clearDraftPending = true;
        },
    });
    /** Keys pressed as an arrow key, released as it; null for a press that went no further. */
    private readonly held = new Map<string, ArrowKey | null>();
    /** Escape left the message: cleared once the keys typed before it have reached the chat line. */
    private clearDraftPending = false;
    private redrawPending = false;
    /** The chat line's state when last checked, and whether it read "Press Enter to Chat" then. */
    private lineState = "";
    private lineLocked = false;
    private detachSetting?: () => void;

    constructor(
        private readonly client: WasdCameraClient,
        private readonly setting: WasdCameraSetting,
        /** Something else takes the keys now (First Person, a RuneLite chatbox input). */
        private readonly keysTakenElsewhere: () => boolean = () => false,
    ) {}

    /** Starts rewriting the client's keys, following the setting. */
    attach(): void {
        if (this.detachSetting) return;
        this.client.inputManager.keyRemapper = this;
        this.detachSetting = this.setting.subscribe(() => this.settingChanged());
        this.settingChanged();
    }

    detach(): void {
        if (!this.detachSetting) return;
        this.detachSetting();
        this.detachSetting = undefined;
        if (this.client.inputManager.keyRemapper === this) this.client.inputManager.keyRemapper = undefined;
        this.releaseHeld();
        this.clearDraftPending = false;
        this.redrawChatLine();
    }

    remapKeyDown(event: KeyboardEvent): KeyboardEvent | null | undefined {
        if (!this.active()) return undefined;
        // Enter or Escape switching, or an arrow key: WASD replaces the arrows, so they turn nothing.
        if (this.chat.keyDown(event) || ARROW_KEY_CODES.has(event.code)) {
            this.held.set(event.code, null);
            return null;
        }
        const arrow = this.chat.isTyping() ? undefined : cameraArrowFor(event);
        if (!arrow) return undefined;
        this.held.set(event.code, arrow);
        return asArrowKey(event, arrow);
    }

    remapKeyUp(event: KeyboardEvent): KeyboardEvent | null | undefined {
        if (!this.held.has(event.code)) return undefined;
        const arrow = this.held.get(event.code);
        this.held.delete(event.code);
        return arrow ? asArrowKey(event, arrow) : null;
    }

    isChatInputBlocked(): boolean {
        return !this.chat.isTyping() && this.active();
    }

    keysProcessed(): void {
        if (this.clearDraftPending) {
            this.clearDraftPending = false;
            this.client.varManager.setVarcString(CHATINPUT, "");
            this.redrawPending = true;
        }
        // An interface opening or closing can give the keys to it or back to the chat line.
        const state = this.chatLineState();
        if (state !== this.lineState) {
            this.lineState = state;
            const locked = this.isChatInputBlocked();
            if (locked !== this.lineLocked) this.redrawPending = true;
            this.lineLocked = locked;
        }
        if (this.redrawPending) this.redrawChatLine();
    }

    /**
     * The chat line was redrawn (script 223): while locked it reads "Name: Press Enter to Chat...",
     * as RuneLite's setChatboxInput callback sets it. VarC 335 keeps what was typed.
     */
    chatLineRedrawn(): void {
        if (!this.isChatInputBlocked()) return;
        const widgets = this.client.widgetManager;
        const line = widgets?.getWidgetByUid(CHATBOX_INPUT_UID);
        const text = typeof line?.text === "string" ? lockedChatLine(line.text) : undefined;
        if (!line || text === undefined || text === line.text) return;
        line.text = text;
        widgets.invalidateWidgetRender(line, "wasd-camera");
    }

    /**
     * RuneLite's chatboxFocused: keys may go to the chat line. Never while anything else takes typed
     * keys: a prompt (an amount, a search), another feature, the editor's free camera, or an
     * interface listening for keys.
     */
    private active(): boolean {
        const client = this.client;
        return this.detachSetting !== undefined && this.setting.isEnabled() && client.isLoggedIn() &&
            client.followPlayerCamera && !client.isWidgetTextInputActive() && !this.keysTakenElsewhere() &&
            this.chatLineTakesKeys();
    }

    /**
     * Typed keys would reach the chat line: it shows (script 73 types nothing while chatbox:56 or
     * 57 is hidden), and no other open interface listens for keys, such as All Settings' search,
     * the world map's, a prompt or a dialogue. Only the gameframe's hotkey listener is ignored.
     */
    private chatLineTakesKeys(): boolean {
        const widgets = this.client.widgetManager;
        if (!widgets) return false;
        for (const uid of CHAT_LINE_PARTS) if (!widgets.getWidgetByUid(uid) || widgets.isEffectivelyHidden(uid)) return false;
        for (const parent of widgets.interfaceParents.values()) {
            const group = parent.group | 0;
            if (group === CHATBOX_GROUP || group === widgets.rootInterface) continue;
            for (const widget of widgets.getGroup(group)?.widgetsByUid.values() ?? []) {
                if (listensForKeys(widgets, widget)) return false;
                for (const child of (widget.children ?? []) as WidgetNode[]) if (listensForKeys(widgets, child)) return false;
            }
        }
        return true;
    }

    /** What the chat line's look depends on, cheap enough to compare every frame. */
    private chatLineState(): string {
        const widgets = this.client.widgetManager;
        if (!widgets) return "";
        const hidden = CHAT_LINE_PARTS.map((uid) => (widgets.isEffectivelyHidden(uid) ? 1 : 0)).join("");
        return `${this.client.isLoggedIn()}:${widgets.rootInterface}:${widgets.interfaceParents.size}:${hidden}`;
    }

    private settingChanged(): void {
        this.chat.lock();
        if (!this.setting.isEnabled()) this.releaseHeld();
        this.redrawPending = true;
    }

    private releaseHeld(): void {
        for (const arrow of this.held.values()) if (arrow) this.client.inputManager.keys.delete(arrow.code);
        this.held.clear();
    }

    /** Runs the chatbox's own redraw, which calls chatLineRedrawn when it finishes. */
    private redrawChatLine(): void {
        this.redrawPending = false;
        const chatbox = this.client.widgetManager?.findWidget(162, 0);
        if (chatbox) this.client.executeScriptListener(chatbox, [CHAT_LINE_REDRAW_SCRIPT]);
    }
}
