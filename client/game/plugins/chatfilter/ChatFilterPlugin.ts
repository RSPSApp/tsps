import { GameState } from "@runelite/api/GameState";
import type { ConfigChanged, GameStateChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { chatHistory, type ChatHistoryStore, type ChatMessage } from "../../../rs/cs2/ChatHistory";
import { markChatTransmit } from "../../TransmitCycles";
import type { OsrsClient } from "../../OsrsClient";
import { fromCSV, standardize } from "../banktags/bankTagText";
import type { ScriptCallbackEvent } from "../ClientPluginManager";
import { ChatFilterConfig, ChatFilterType } from "./ChatFilterConfig";
import {
    compilePattern,
    escapeJagex,
    quote,
    retainJagexPrintable,
    sanitize,
    stripAccents,
    unescapeJagex,
} from "./chatFilterText";

/** RuneLite's ChatMessageType ids (the OSRS chat channel ids); its GIM types are -1. */
const GAMEMESSAGE = 0;
const MODCHAT = 1;
const PUBLICCHAT = 2;
const PRIVATECHAT = 3;
const ENGINE = 4;
const MODPRIVATECHAT = 7;
const FRIENDSCHAT = 9;
const FRIENDSCHATNOTIFICATION = 11;
const ITEM_EXAMINE = 27;
const NPC_EXAMINE = 28;
const OBJECT_EXAMINE = 29;
const CLAN_CHAT = 41;
const CLAN_MESSAGE = 43;
const CLAN_GUEST_CHAT = 44;
const CLAN_GUEST_MESSAGE = 46;
const AUTOTYPER = 90;
const SPAM = 105;
const NPC_SAY = 116;

/** Chat from players, filtered by their name and the word lists. */
const PLAYER_TYPES = new Set([PUBLICCHAT, MODCHAT, AUTOTYPER, PRIVATECHAT, MODPRIVATECHAT, FRIENDSCHAT, CLAN_CHAT, CLAN_GUEST_CHAT]);
/** Game chat, filtered by the word lists when "Filter game chat" is on. */
const GAME_TYPES = new Set([GAMEMESSAGE, ENGINE, FRIENDSCHATNOTIFICATION, ITEM_EXAMINE, NPC_EXAMINE, OBJECT_EXAMINE, SPAM,
    CLAN_MESSAGE, CLAN_GUEST_MESSAGE, NPC_SAY]);
const COLLAPSIBLE_MESSAGETYPES = new Set([ENGINE, GAMEMESSAGE, ITEM_EXAMINE, NPC_EXAMINE, OBJECT_EXAMINE, SPAM, PUBLICCHAT,
    MODCHAT, NPC_SAY]);
/** The LinkedHashMaps' MAX_ENTRIES. */
const MAX_ENTRIES = 100;

export const CENSOR_MESSAGE = "Hey, everyone, I just tried to say something very silly!";

/** Who a name belongs to, as Chat Filter asks the client. */
export type ChatFilterClient = {
    getLocalPlayerName(): string | null;
    isFriended(name: string): boolean;
    isFriendsChatMember(name: string): boolean;
    isClanChatMember(name: string): boolean;
};

type Duplicate = { messageId: number; count: number };

/** Names as the game compares them: no case, and underscores, hyphens and nbsp as spaces. */
function sameName(a: string, b: string): boolean {
    const jagex = (name: string) => name.replace(/[ _-]/g, " ").trim().toLowerCase();
    return jagex(a) === jagex(b);
}

/**
 * RuneLite 1.13.5 Chat Filter: censors or removes chat by word, regex or player name, and
 * collapses repeated lines. RuneLite's patched chatbox scripts (rs/cs2/runelite/chatScripts.ts)
 * ask it about every line with the "chatFilterCheck" callback; overhead chat goes through the
 * client's overheadChatText hook.
 */
export class ChatFilterPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Chat Filter",
        description: "Censor user configurable words or patterns from chat",
        enabledByDefault: false,
        configKey: "chatfilterplugin",
    };

    static config = ChatFilterConfig;

    readonly config = inject(ConfigManager).getConfig(ChatFilterConfig);
    private readonly client: ChatFilterClient;
    private readonly history: ChatHistoryStore;
    private filteredPatterns: RegExp[] = [];
    private filteredNamePatterns: RegExp[] = [];
    private readonly duplicateChatCache = new Map<string, Duplicate>();
    private readonly filterCache = new Map<number, Map<number, string | null>>();
    private readonly listener = (message: ChatMessage) => this.handleChatMessage(message);
    /** Rebuilds the chatbox (RuneLite's client.refreshChat). */
    refreshChat: () => void = markChatTransmit;

    constructor(client?: ChatFilterClient, history: ChatHistoryStore = chatHistory) {
        super();
        this.client = client ?? osrsChatFilterClient(inject<OsrsClient>(CLIENT_TOKEN));
        this.history = history;
    }

    protected async startUp(): Promise<void> {
        this.updateFilteredPatterns();
        this.history.beforeInsertListeners.add(this.listener);
        this.refreshChat();
    }

    protected async shutDown(): Promise<void> {
        this.history.beforeInsertListeners.delete(this.listener);
        this.filteredPatterns = [];
        this.filteredNamePatterns = [];
        this.duplicateChatCache.clear();
        this.filterCache.clear();
        this.refreshChat();
    }

    onGameStateChanged(event: GameStateChanged): void {
        switch (event.getGameState()) {
            // Login drops references to all messages and also resets the global message id counter.
            // Invalidate the message id so it doesn't collide later when rebuilding the chatfilter.
            case GameState.CONNECTION_LOST:
            case GameState.HOPPING:
            case GameState.LOGGING_IN:
                for (const duplicate of this.duplicateChatCache.values()) duplicate.messageId = -1;
                this.filterCache.clear();
        }
    }

    onScriptCallback({ eventName, vm }: ScriptCallbackEvent): void {
        if (eventName !== "chatFilterCheck" || !this.isStarted()) return;
        const intStack = vm.intStack;
        const intStackSize = vm.intStackSize;
        const objectStack = vm.stringStack;
        const objectStackSize = vm.stringStackSize;

        const messageType = intStack[intStackSize - 2];
        const messageId = intStack[intStackSize - 1];
        let message: string | null = String(objectStack[objectStackSize - 1] ?? "");
        const messageNode = this.history.getByUid(messageId);
        if (!messageNode) return;
        const name = messageNode.from ?? "";
        let duplicateCount = 0;
        let blockMessage = false;

        if (PLAYER_TYPES.has(messageType)) {
            if (this.canFilterPlayer(sanitize(name))) {
                message = this.censorCached(messageNode, name, message);
                blockMessage = message === null;
            }
        } else if (GAME_TYPES.has(messageType)) {
            if (this.config.filterGameChat() === true) {
                message = this.censorCached(messageNode, null, message);
                blockMessage = message === null;
            }
        }

        const shouldCollapse = messageType === PUBLICCHAT || messageType === MODCHAT
            ? this.config.collapsePlayerChat() === true
            : COLLAPSIBLE_MESSAGETYPES.has(messageType) && this.config.collapseGameChat() === true;
        if (!blockMessage && shouldCollapse) {
            const duplicateCacheEntry = this.duplicateChatCache.get(`${name}:${message}`);
            // If messageId is -1 then this is a replayed message, which we can't easily collapse since we don't know
            // the most recent message. This is only for public chat since it is the only thing both replayed and also
            // collapsed. Just allow uncollapsed playback.
            if (duplicateCacheEntry && duplicateCacheEntry.messageId !== -1) {
                const maxRepeated = Number(this.config.maxRepeatedPublicChats()) || 0;
                blockMessage = duplicateCacheEntry.messageId !== messageId
                    || ((messageType === PUBLICCHAT || messageType === MODCHAT)
                        && maxRepeated > 0 && duplicateCacheEntry.count > maxRepeated);
                duplicateCount = duplicateCacheEntry.count;
            }
        }

        if (blockMessage) {
            // Block the message
            intStack[intStackSize - 3] = 0;
        } else {
            // Replace the message
            if (duplicateCount > 1) message += ` (${duplicateCount})`;
            objectStack[objectStackSize - 1] = message;
        }
    }

    /** RuneLite's onOverheadTextChanged, for players. */
    overheadChatText({ name, text }: { name: string; text: string }): string | undefined {
        if (!this.isStarted() || !name || !this.canFilterPlayer(name)) return undefined;
        return this.censorMessage(name, text) ?? " ";
    }

    /** Handle the history node before insertion, rather than the API EventBus payload. */
    private handleChatMessage(message: ChatMessage): void {
        if (!COLLAPSIBLE_MESSAGETYPES.has(message.type)) return;
        // remove and re-insert into map to move to end of list
        const key = `${message.from ?? ""}:${message.text}`;
        const duplicate = this.duplicateChatCache.get(key) ?? { messageId: -1, count: 0 };
        this.duplicateChatCache.delete(key);
        duplicate.count++;
        duplicate.messageId = message.uid;
        this.duplicateChatCache.set(key, duplicate);
        if (this.duplicateChatCache.size > MAX_ENTRIES) {
            this.duplicateChatCache.delete(this.duplicateChatCache.keys().next().value!);
        }
    }

    canFilterPlayer(playerName: string): boolean {
        const local = this.client.getLocalPlayerName();
        const isMessageFromSelf = local !== null && playerName === local;
        return !isMessageFromSelf
            && (this.config.filterFriends() === true || !this.client.isFriended(playerName))
            && (this.config.filterFriendsChat() === true || !this.client.isFriendsChatMember(playerName))
            && (this.config.filterClanChat() === true || !this.client.isClanChatMember(playerName));
    }

    /** The censored message, null when it is removed, or the message itself when nothing matched. */
    censorMessage(username: string | null, message: string): string | null {
        const filterType = this.config.filterType();
        if (username !== null && this.isNameFiltered(username)) {
            switch (filterType) {
                case ChatFilterType.CENSOR_WORDS:
                    return "*".repeat(unescapeJagex(message).length);
                case ChatFilterType.CENSOR_MESSAGE:
                    return CENSOR_MESSAGE;
                case ChatFilterType.REMOVE_MESSAGE:
                    return null;
            }
        }

        let strippedMessage = retainJagexPrintable(unescapeJagex(message)).replace(/ /g, " ");
        const strippedAccents = this.stripAccents(strippedMessage);
        let filtered = false;
        for (const pattern of this.filteredPatterns) {
            let sb = "";
            let idx = 0;
            for (const match of strippedAccents.matchAll(pattern)) {
                switch (filterType) {
                    case ChatFilterType.CENSOR_WORDS:
                        sb += strippedMessage.substring(idx, match.index) + "*".repeat(match[0].length);
                        idx = match.index + match[0].length;
                        filtered = true;
                        break;
                    case ChatFilterType.CENSOR_MESSAGE:
                        return CENSOR_MESSAGE;
                    case ChatFilterType.REMOVE_MESSAGE:
                        return null;
                }
            }
            sb += strippedMessage.substring(idx);
            strippedMessage = sb;
        }
        return filtered ? escapeJagex(strippedMessage) : message;
    }

    private censorCached(messageNode: ChatMessage, username: string | null, message: string): string | null {
        let map = this.filterCache.get(messageNode.type);
        if (!map) {
            map = new Map();
            this.filterCache.set(messageNode.type, map);
        }
        if (map.has(messageNode.uid)) return map.get(messageNode.uid)!;
        const censoredMessage = this.censorMessage(username, message);
        map.set(messageNode.uid, censoredMessage);
        if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!);
        return censoredMessage;
    }

    updateFilteredPatterns(): void {
        const patterns: RegExp[] = [];
        const namePatterns: RegExp[] = [];
        for (const word of fromCSV(String(this.config.filteredWords() ?? ""))) {
            patterns.push(new RegExp(quote(this.stripAccents(word)), "gi"));
        }
        for (const line of lines(String(this.config.filteredRegex() ?? ""))) {
            const pattern = compilePattern(this.stripAccents(line));
            if (pattern) patterns.push(pattern);
        }
        for (const line of lines(String(this.config.filteredNames() ?? ""))) {
            const pattern = compilePattern(this.stripAccents(line));
            if (pattern) namePatterns.push(pattern);
        }
        this.filteredPatterns = patterns;
        this.filteredNamePatterns = namePatterns;
        this.filterCache.clear();
    }

    private stripAccents(input: string): string {
        return this.config.stripAccents() === true ? stripAccents(input) : input;
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== ChatFilterConfig.group) return;
        this.updateFilteredPatterns();
        //Refresh chat after config change to reflect current rules
        if (this.isStarted()) this.refreshChat();
    }

    isNameFiltered(playerName: string): boolean {
        const sanitizedName = standardize(playerName);
        return this.filteredNamePatterns.some((pattern) => {
            pattern.lastIndex = 0;
            return pattern.test(sanitizedName);
        });
    }
}

/** NEWLINE_SPLITTER: split on newlines, trimmed, empties dropped. */
function lines(text: string): string[] {
    return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

/** The friends list, friends chat and clan channels as the game client holds them. */
function osrsChatFilterClient(client: OsrsClient): ChatFilterClient {
    const context = () => client.cs2Vm?.context;
    return {
        getLocalPlayerName: () => client.localPlayerName || null,
        isFriended: (name) => (context()?.friendList ?? []).some((friend) => sameName(friend.name, name)),
        isFriendsChatMember: (name) => (context()?.clanMembers ?? []).some((member) => sameName(member.name, name)),
        isClanChatMember: (name) => [context()?.clanChannel, context()?.listenedClanChannel]
            .some((channel) => channel?.userNames.some((member) => sameName(member, name)) === true),
    };
}
