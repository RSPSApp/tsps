/**
 * Chat history storage for CS2 chat operations.
 * Stores messages by type so scripts can query them.
 *
 * OSRS chat message types:
 *   0 = Game/Server messages
 *   2 = Public chat
 *   3 = Private messages (received)
 *   4 = Trade chat
 *   5 = Filtered (friends list)
 *   6 = Private messages (sent)
 *   7 = Clan chat
 *   etc.
 */

export interface ChatMessage {
    uid: number;
    type: number;
    from: string;
    prefix: string;
    text: string;
    timestamp: number;
    runeLiteFormatMessage?: string | null;
    /** Cycle counter (used by OSRS for message ordering) */
    cycle: number;
    /** True if sender is on friend list */
    isFromFriend?: boolean;
    /** True if sender is on ignore list */
    isFromIgnored?: boolean;
}

// Max messages per type to avoid unbounded growth
const MAX_MESSAGES_PER_TYPE = 100;

// Cached sorted list of all messages (lazily invalidated when messages change)
interface SortedMessagesCache {
    messages: ChatMessage[];
    valid: boolean;
}

// Map message type strings from server to numeric OSRS types
const MESSAGE_TYPE_MAP: Record<string, number> = {
    game: 0,
    server: 0,
    public: 2,
    private: 3,
    trade: 4,
    clan: 7,
    broadcast: 0,
};

export class ChatHistoryStore {
    readonly beforeInsertListeners = new Set<(message: ChatMessage) => void>();
    private messagesByHash = new Map<bigint, ChatMessage>();
    private hashes = new WeakMap<ChatMessage, bigint>();
    private links = new WeakMap<ChatMessage, { previous: ChatMessage | null; next: ChatMessage | null }>();
    private firstMessage: ChatMessage | null = null;
    private lastMessage: ChatMessage | null = null;
    // Store messages by type
    private messagesByType = new Map<number, ChatMessage[]>();
    // Global UID counter for messages
    private nextUid = 1;
    // Global cycle counter (increments each message)
    private cycle = 0;
    // Callback fired when a message is added (used to trigger chat transmit cycle)
    onMessageAdded: ((msg: ChatMessage) => void) | null = null;
    // PERF: Cached sorted list of all messages to avoid O(n log n) sort on every getNextUid/getPrevUid call
    private sortedMessagesCache: SortedMessagesCache = { messages: [], valid: false };

    addMessage(
        typeOrString: number | string,
        text: string,
        from = "",
        prefix = "",
        isFromFriend = false,
        isFromIgnored = false,
        postEvent = true,
    ): number {
        // Convert string type to number
        const type =
            typeof typeOrString === "string"
                ? (MESSAGE_TYPE_MAP[typeOrString.toLowerCase()] ?? 0)
                : typeOrString;

        const uid = this.nextUid++;
        const msg: ChatMessage = {
            uid,
            type,
            from,
            prefix,
            text,
            timestamp: Date.now(),
            cycle: this.cycle++,
            isFromFriend,
            isFromIgnored,
        };

        if (postEvent) for (const listener of this.beforeInsertListeners) listener(msg);
        let list = this.messagesByType.get(msg.type);
        if (!list) {
            list = [];
            this.messagesByType.set(msg.type, list);
        }

        // Add at the end (newest)
        list.push(msg);
        this.putMessageHash(msg, BigInt(uid));

        // Trim old messages
        while (list.length > MAX_MESSAGES_PER_TYPE) {
            const removed = list.shift()!;
            this.removeMessageHash(removed);
        }

        // PERF: Invalidate sorted messages cache when messages change
        this.sortedMessagesCache.valid = false;

        // Debug: Log message count per type
        /*console.log(
            `[ChatHistory] Added message uid=${uid} type=${type} from="${from}" text="${text.substring(
                0,
                30,
            )}". Total messages:`,
            Array.from(this.messagesByType.entries())
                .map(([t, l]) => `type${t}:${l.length}`)
                .join(", "),
        );*/

        // Notify listener (used to trigger chat transmit cycle in OsrsClient)
        if (this.onMessageAdded) {
            this.onMessageAdded(msg);
        }

        return uid;
    }

    /**
     * Get message count for a given type.
     */
    getLength(type: number): number {
        return this.messagesByType.get(type)?.length ?? 0;
    }

    /**
     * Get message text by type and line index.
     * Line 0 is the NEWEST message (bottom of chatbox).
     * This matches OSRS behavior where line 0 = most recent.
     */
    getByTypeAndLine(type: number, line: number): string {
        const list = this.messagesByType.get(type);
        if (!list || list.length === 0) return "";

        // Line 0 = newest = last in array, Line N = oldest
        if (line < 0 || line >= list.length) return "";

        // Convert line index: line 0 = last element, line 1 = second-to-last, etc.
        const arrayIndex = list.length - 1 - line;
        return list[arrayIndex].runeLiteFormatMessage ?? list[arrayIndex].text;
    }

    /**
     * Get full message data by type and line index.
     * Line 0 is the NEWEST message (bottom of chatbox).
     * Returns: [count/uid, cycle, sender, prefix, text, friendStatus]
     * friendStatus: 0 = neither, 1 = friend, 2 = ignored
     */
    getFullByTypeAndLine(
        type: number,
        line: number,
    ): {
        count: number;
        cycle: number;
        sender: string;
        prefix: string;
        text: string;
        friendStatus: number;
    } | null {
        const list = this.messagesByType.get(type);
        if (!list || list.length === 0) return null;
        if (line < 0 || line >= list.length) return null;

        // Convert line index: line 0 = last element (newest), line N = oldest
        const arrayIndex = list.length - 1 - line;
        const msg = list[arrayIndex];
        return {
            count: msg.uid, // In OSRS this is 'count' field of Message
            cycle: msg.cycle,
            sender: msg.from,
            prefix: msg.prefix,
            text: msg.runeLiteFormatMessage ?? msg.text,
            friendStatus: msg.isFromFriend ? 1 : msg.isFromIgnored ? 2 : 0,
        };
    }

    /**
     * Get extended message info by type and line index.
     * Line 0 is the NEWEST message (bottom of chatbox).
     * Returns: [uid, unknown1, from, prefix, text, unknown2, clan, timestamp]
     */
    getExByTypeAndLine(
        type: number,
        line: number,
    ): [number, number, string, string, string, number, string, number] {
        const list = this.messagesByType.get(type);
        if (!list || list.length === 0) {
            return [0, 0, "", "", "", 0, "", 0];
        }

        // Line 0 = newest = last in array, Line N = oldest
        if (line < 0 || line >= list.length) {
            return [0, 0, "", "", "", 0, "", 0];
        }

        // Convert line index: line 0 = last element (newest), line N = oldest
        const arrayIndex = list.length - 1 - line;
        const msg = list[arrayIndex];
        return [msg.uid, 0, msg.from, msg.prefix, msg.runeLiteFormatMessage ?? msg.text, 0, "", msg.timestamp];
    }

    /**
     * Get message by UID
     */
    getByUid(uid: number): ChatMessage | undefined {
        return this.messagesByHash.get(BigInt(uid));
    }
    getMessageByHash(hash: bigint): ChatMessage | undefined { return this.messagesByHash.get(hash); }
    getMessageHash(message: ChatMessage): bigint { return this.hashes.get(message) ?? BigInt(message.uid); }
    getMessageNext(message: ChatMessage): ChatMessage | null { return this.links.get(message)?.next ?? null; }
    getMessagePrevious(message: ChatMessage): ChatMessage | null { return this.links.get(message)?.previous ?? null; }
    getAllMessageNodes(): ChatMessage[] { const messages: ChatMessage[] = []; for (let message = this.firstMessage; message; message = this.getMessageNext(message)) messages.push(message); return messages; }
    getMessageTypes(): number[] { return [...this.messagesByType.keys()]; }
    getMessagesOfType(type: number): ChatMessage[] { return (this.messagesByType.get(type) ?? []).slice().reverse(); }
    putMessageHash(message: ChatMessage, hash: bigint): void {
        this.removeMessageHash(message);
        this.messagesByHash.set(hash, message); this.hashes.set(message, hash);
        this.links.set(message, { previous: this.lastMessage, next: null });
        if (this.lastMessage) this.links.get(this.lastMessage)!.next = message;
        else this.firstMessage = message;
        this.lastMessage = message;
    }
    private removeMessageHash(message: ChatMessage): void {
        const hash = this.getMessageHash(message);
        const link = this.links.get(message);
        if (!link) return;
        if (this.messagesByHash.get(hash) === message) {
            let previous = link.previous;
            while (previous && this.getMessageHash(previous) !== hash) previous = this.getMessagePrevious(previous);
            if (previous) this.messagesByHash.set(hash, previous); else this.messagesByHash.delete(hash);
        }
        if (link.previous) this.links.get(link.previous)!.next = link.next; else this.firstMessage = link.next;
        if (link.next) this.links.get(link.next)!.previous = link.previous; else this.lastMessage = link.previous;
        this.links.delete(message);
    }
    removeMessage(message: ChatMessage): void {
        const list = this.messagesByType.get(message.type), index = list?.indexOf(message) ?? -1;
        if (list && index >= 0) list.splice(index, 1);
        this.removeMessageHash(message);
        this.sortedMessagesCache.valid = false;
    }

    /**
     * PERF: Get sorted messages from cache, rebuilding only when invalidated.
     * This avoids O(n log n) sort + O(n) array allocation on every call.
     */
    private getSortedMessages(): ChatMessage[] {
        if (this.sortedMessagesCache.valid) {
            return this.sortedMessagesCache.messages;
        }

        // Rebuild cache - collect all messages
        const allMessages: ChatMessage[] = [];
        for (const list of this.messagesByType.values()) {
            for (let i = 0; i < list.length; i++) {
                allMessages.push(list[i]);
            }
        }

        // Sort by cycle (chronological order)
        allMessages.sort((a, b) => a.cycle - b.cycle);

        // Cache the result
        this.sortedMessagesCache.messages = allMessages;
        this.sortedMessagesCache.valid = true;

        return allMessages;
    }

    /**
     * Get next UID after the given one ACROSS ALL types.
     * Messages are ordered by cycle (time). Returns -1 if no next message.
     * This matches OSRS behavior where chat_getnextuid traverses all message types.
     */
    getNextUid(_type: number, currentUid: number): number {
        // PERF: Use cached sorted list instead of rebuilding every call
        const allMessages = this.getSortedMessages();

        // Find current message and return next one's UID
        const idx = allMessages.findIndex((m) => m.uid === currentUid);
        if (idx === -1 || idx >= allMessages.length - 1) return -1;

        return allMessages[idx + 1].uid;
    }

    /**
     * Get previous UID before the given one ACROSS ALL types.
     * Messages are ordered by cycle (time). Returns -1 if no previous message.
     * This matches OSRS behavior where chat_getprevuid traverses all message types.
     */
    getPrevUid(_type: number, currentUid: number): number {
        // PERF: Use cached sorted list instead of rebuilding every call
        const allMessages = this.getSortedMessages();

        // Find current message and return previous one
        const idx = allMessages.findIndex((m) => m.uid === currentUid);
        if (idx <= 0) return -1;

        return allMessages[idx - 1].uid;
    }

    /**
     * Clear all messages
     */
    clear(): void {
        this.messagesByType.clear();
        this.messagesByHash.clear();
        this.links = new WeakMap();
        this.firstMessage = this.lastMessage = null;
        // PERF: Clear and invalidate the sorted messages cache
        this.sortedMessagesCache.messages = [];
        this.sortedMessagesCache.valid = false;
    }

    /**
     * Get the latest (most recent) message across all types.
     * Returns the message with the highest UID.
     */
    getLatestMessage(): ChatMessage | undefined {
        let latest: ChatMessage | undefined;
        for (const list of this.messagesByType.values()) {
            if (list.length > 0) {
                const lastInList = list[list.length - 1];
                if (!latest || lastInList.uid > latest.uid) {
                    latest = lastInList;
                }
            }
        }
        return latest;
    }
}

// Global singleton instance
export const chatHistory = new ChatHistoryStore();
