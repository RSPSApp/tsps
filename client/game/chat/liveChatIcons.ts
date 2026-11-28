import { CHAT_LINE_REDRAW_SCRIPT } from "../input/WasdCamera";

export const CHAT_ICONS_CHANNEL = "account:chat-icons";

export interface LiveChatIconsHost {
    getLocalChatIcons(): readonly number[];
    setLocalChatIcons(icons: number[]): void;
    markChatTransmit(): void;
    widgetManager?: { findWidget(group: number, child: number): unknown } | null;
    executeScriptListener(widget: unknown, listener: number[]): void;
}

export function sanitizeChatIcons(raw: unknown): number[] | null {
    if (!Array.isArray(raw)) return null;
    return raw
        .map((icon) => Number(icon))
        .filter((icon) => Number.isFinite(icon) && icon >= 0 && icon <= 255)
        .map((icon) => icon | 0);
}

export function redrawChatInputLine(
    host: Pick<LiveChatIconsHost, "widgetManager" | "executeScriptListener">,
): boolean {
    const chatbox = host.widgetManager?.findWidget(162, 0);
    if (!chatbox) return false;
    host.executeScriptListener(chatbox, [CHAT_LINE_REDRAW_SCRIPT]);
    return true;
}

/**
 * Handles the server's `account:chat-icons` plugin message so mid-session rank/crown
 * changes update the local chatbox input line (`162:58`) immediately without relogging.
 */
export function handleChatIconsPluginMessage(
    message: { channel?: unknown; data?: unknown } | null | undefined,
    host: LiveChatIconsHost,
): boolean {
    if (message?.channel !== CHAT_ICONS_CHANNEL) return false;
    const nextChatIcons = sanitizeChatIcons((message.data as { chatIcons?: unknown } | null)?.chatIcons);
    if (!nextChatIcons) return false;

    const prev = host.getLocalChatIcons();
    const changed =
        nextChatIcons.length !== prev.length ||
        nextChatIcons.some((icon, idx) => icon !== prev[idx]);

    host.setLocalChatIcons(nextChatIcons);
    if (changed) {
        host.markChatTransmit();
        redrawChatInputLine(host);
    }
    return true;
}
