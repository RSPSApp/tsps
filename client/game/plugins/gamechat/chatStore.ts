/**
 * The chat lines the replacement chatbox draws, and whoever wants to hear about them.
 *
 * The client's own chatbox keeps its history inside the widget system, where a React panel cannot
 * reach it, so this collects lines as they arrive (`onChatMessage`) from the moment the plugin
 * starts. That means the panel begins empty on a fresh login rather than replaying what the
 * canvas already drew — acceptable, because the canvas box is still underneath.
 */

/** RuneLite's ChatMessageType, for the few we group by. */
const PUBLIC_CHAT = 2;
const PRIVATE_CHAT = 3;
const PRIVATE_CHAT_OUT = 6;
const FRIENDS_CHAT = 9;
const CLAN_CHAT = 41;

export type ChatChannel = "game" | "public" | "private";

export type ChatLine = {
    id: number;
    /** When it arrived here, not when the server sent it: the event carries no time. */
    at: number;
    channel: ChatChannel;
    /** The speaker, for the channels that have one. */
    name: string | null;
    text: string;
    /** A level-up, a quest step: worth a colour of its own among the game's own messages. */
    milestone: boolean;
};

const MAX_LINES = 250;
type Listener = () => void;

let lines: ChatLine[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function channelOf(type: number): ChatChannel {
    if (type === PUBLIC_CHAT) return "public";
    if (type === PRIVATE_CHAT || type === PRIVATE_CHAT_OUT || type === FRIENDS_CHAT || type === CLAN_CHAT) {
        return "private";
    }
    return "game";
}

/** Strips the `<col=...>` and `<img=...>` tags the game writes into chat text. */
export function plain(text: string): string {
    return text.replace(/<[^>]*>/g, "");
}

/** A level or a total level: the lines a player actually wants to find again. */
function isMilestone(text: string): boolean {
    return /advanced your|you are now level|levelled up|congratulations/i.test(text);
}

export function getChatLines(): ChatLine[] {
    return lines;
}

export function addChatLine(type: number, name: string, text: string): void {
    const clean = plain(text).trim();
    if (!clean) return;
    const line: ChatLine = {
        id: nextId++,
        at: Date.now(),
        channel: channelOf(type),
        name: plain(name).trim() || null,
        text: clean,
        milestone: isMilestone(clean),
    };
    // A new array each time: the panel subscribes with useSyncExternalStore, which compares by
    // identity and would never re-render if this were mutated in place.
    lines = [...lines, line].slice(-MAX_LINES);
    for (const listener of listeners) listener();
}

export function clearChatLines(): void {
    if (lines.length === 0) return;
    lines = [];
    for (const listener of listeners) listener();
}

export function subscribeChat(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
