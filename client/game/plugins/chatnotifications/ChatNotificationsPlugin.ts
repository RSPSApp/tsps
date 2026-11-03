import type { Client } from "@runelite/api/Client";
import { GameState } from "@runelite/api/GameState";
import type { ConfigChanged, GameStateChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Notifier } from "@runelite/client/Notifier";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { chatHistory, type ChatMessage, type ChatHistoryStore } from "../../../rs/cs2/ChatHistory";
import type { OsrsClient } from "../../OsrsClient";
import { fromCSV } from "../banktags/bankTagText";
import { ChatNotificationsConfig } from "./ChatNotificationsConfig";
import { highlightTag, normalTag } from "./chatColors";

/** RuneLite's ChatMessageType ids (the OSRS chat channel ids). */
const MODCHAT = 1;
const PUBLICCHAT = 2;
const PRIVATECHAT = 3;
const PRIVATECHATOUT = 6;
const MODPRIVATECHAT = 7;
const FRIENDSCHAT = 9;
const BROADCAST = 14;
const CLAN_CHAT = 41;
const CLAN_GUEST_CHAT = 44;
const AUTOTYPER = 90;
const MODAUTOTYPER = 91;
const TRADEREQ = 101;
const CHALREQ_TRADE = 103;
const DIALOG = 114;
const MESBOX = 115;

/** The channels a mention of your name notifies for. */
const OWN_NAME_NOTIFY_TYPES = new Set([PUBLICCHAT, PRIVATECHAT, FRIENDSCHAT, MODCHAT, MODPRIVATECHAT, CLAN_CHAT, CLAN_GUEST_CHAT]);
/** Chat from players: your own lines are skipped. */
const PLAYER_CHAT_TYPES = new Set([MODCHAT, PUBLICCHAT, FRIENDSCHAT, CLAN_CHAT, CLAN_GUEST_CHAT, AUTOTYPER, MODAUTOTYPER]);

type NotifyClient = { notify(message: string): void };

/**
 * RuneLite 1.13.5 Chat Notifications: highlights your name and chosen words or regexes in chat,
 * and notifies on mentions, highlights, trades, duels, broadcasts and private messages.
 *
 * RuneLite edits the MessageNode from onChatMessage; here the plugin rewrites a line's
 * RuneLite-format text just before the chat history stores it, which is what the chatbox
 * scripts read.
 */
export class ChatNotificationsPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Chat Notifications",
        description: "Highlight and notify you of chat messages",
        tags: ["duel", "messages", "notifications", "trade", "username"],
        enabledByDefault: false,
        configKey: "chatnotificationsplugin",
    };

    static config = ChatNotificationsConfig;

    readonly config = inject(ConfigManager).getConfig(ChatNotificationsConfig);
    private readonly client: Client;
    private readonly notifier: NotifyClient;
    private readonly history: ChatHistoryStore;
    private usernameMatcher: RegExp | null = null;
    private readonly highlightPatterns: RegExp[] = [];
    /** Set while a notification is written to chat, so it isn't matched itself. */
    private notifying = false;
    private readonly listener = (message: ChatMessage) => this.onChatMessage(message);

    constructor(client?: Client, notifier?: NotifyClient, history: ChatHistoryStore = chatHistory) {
        super();
        let osrsClient: OsrsClient | undefined;
        if (client) {
            this.client = client;
        } else {
            osrsClient = inject<OsrsClient>(CLIENT_TOKEN);
            this.client = new ClientImpl(osrsClient);
        }
        this.notifier = notifier ?? new Notifier(osrsClient!);
        this.history = history;
    }

    protected async startUp(): Promise<void> {
        this.updateHighlights();
        this.history.beforeInsertListeners.add(this.listener);
    }

    protected async shutDown(): Promise<void> {
        this.history.beforeInsertListeners.delete(this.listener);
        this.usernameMatcher = null;
        this.highlightPatterns.length = 0;
    }

    onGameStateChanged(event: GameStateChanged): void {
        switch (event.getGameState()) {
            case GameState.LOGIN_SCREEN:
            case GameState.HOPPING:
                this.usernameMatcher = null;
                break;
        }
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === ChatNotificationsConfig.group) this.updateHighlights();
    }

    private updateHighlights(): void {
        this.highlightPatterns.length = 0;
        const words = String(this.config.highlightWordsString() ?? "");
        if (words.trim() !== "") {
            const joined = fromCSV(words)
                .map(escapeJagex) // we compare these strings to the raw Jagex ones
                .map(quoteAndIgnoreColor) // regex escape and ignore nested colors in the target message
                .join("|");
            // To match <word> \b doesn't work due to <> not being in \w,
            // so match \b or \s, as well as \A and \z for beginning and end of input respectively
            this.highlightPatterns.push(new RegExp(`(?:\\b|(?<=\\s)|^)(?:${joined})(?:\\b|(?=\\s)|$)`, "gi"));
        }
        for (const line of String(this.config.highlightRegexString() ?? "").split("\n")) {
            const pattern = line.trim();
            if (!pattern) continue;
            try {
                this.highlightPatterns.push(new RegExp(pattern, "gi"));
            } catch {
                // RuneLite skips patterns that don't compile.
            }
        }
    }

    /** RuneLite's onChatMessage, on the line about to be stored. */
    onChatMessage(message: ChatMessage): void {
        if (this.notifying) return;
        const name = message.from ?? "";
        switch (message.type) {
            case TRADEREQ:
                if (message.text.includes("wishes to trade with you.")) {
                    this.notify(this.config.notifyOnTrade(), unescapeJagex(message.text));
                }
                break;
            case CHALREQ_TRADE:
                if (message.text.includes("wishes to duel with you.")) {
                    this.notify(this.config.notifyOnDuel(), unescapeJagex(message.text));
                }
                break;
            case BROADCAST: {
                // Some broadcasts have links attached, notated by `|` followed by a number, while others contain color tags.
                // We don't want to see either in the printed notification.
                let broadcast = message.text;
                const urlTokenIndex = broadcast.lastIndexOf("|");
                if (urlTokenIndex !== -1) broadcast = broadcast.substring(0, urlTokenIndex);
                this.notify(this.config.notifyOnBroadcast(), unescapeJagex(broadcast));
                break;
            }
            case PRIVATECHAT:
            case MODPRIVATECHAT:
                this.notify(this.config.notifyOnPM(), unescapeJagex(`${name}: ${message.text}`));
                break;
            case PRIVATECHATOUT:
            case DIALOG:
            case MESBOX:
                return;
        }
        const localName = this.client.getLocalPlayer()?.getName() || null;
        if (PLAYER_CHAT_TYPES.has(message.type) && localName !== null && toJagexName(removeTags(name)) === localName) {
            return;
        }

        if (this.usernameMatcher === null && localName !== null) {
            const pattern = localName.split(" ")
                .map((s) => (s ? quote(s) : ""))
                .join("[  ]"); // space or nbsp
            this.usernameMatcher = new RegExp(`\\b${pattern}\\b`, "gi");
        }

        let update = false;
        let nodeValue = message.runeLiteFormatMessage ?? message.text;
        // RuneLite writes <colHIGHLIGHT> and <colNORMAL> for ChatMessageManager to resolve; this
        // client has no such pass, so they are resolved here.
        const highlight = highlightTag(this.client, message.type);
        const normal = normalTag(this.client, message.type);
        if (this.config.highlightOwnName() === true && this.usernameMatcher !== null && localName !== null) {
            const matcher = this.usernameMatcher;
            matcher.lastIndex = 0;
            if (matcher.test(nodeValue)) {
                // start not end, since username won't contain a col tag
                nodeValue = nodeValue.replace(matcher, (_match, start: number, whole: string) => {
                    const closeColor = getLastColor(whole.substring(0, start)) ?? normal;
                    return `${highlight}<u>${localName}</u>${closeColor === CLOSE_TAG ? normal : closeColor}`;
                });
                update = true;
                if (OWN_NAME_NOTIFY_TYPES.has(message.type)) {
                    this.sendNotification(this.config.notifyOnOwnName(), message);
                }
            }
        }

        let matchesHighlight = false;
        for (const pattern of this.highlightPatterns) {
            pattern.lastIndex = 0;
            if (!pattern.test(nodeValue)) continue;
            pattern.lastIndex = 0;
            nodeValue = nodeValue.replace(pattern, (match: string, ...rest: unknown[]) => {
                // The offset and whole string follow the capture groups.
                const whole = rest[rest.length - 1] as string | object;
                const input = typeof whole === "string" ? whole : (rest[rest.length - 2] as string);
                const offset = (typeof whole === "string" ? rest[rest.length - 2] : rest[rest.length - 3]) as number;
                const end = offset + match.length;
                // Determine the ending color by finding the last color tag up to and including the match.
                const closeColor = getLastColor(input.substring(0, end)) ?? normal;
                // Strip color tags from the highlighted region so that it remains highlighted correctly
                return `${highlight}${stripColor(match)}${closeColor === CLOSE_TAG ? normal : closeColor}`;
            });
            update = true;
            matchesHighlight = true;
        }

        if (matchesHighlight) this.sendNotification(this.config.notifyOnHighlight(), message);
        if (update) {
            // RuneLite's messageNode.setValue, then setRuneLiteFormatMessage: the chatbox reads
            // lines both by uid (the text) and by line (the RuneLite format).
            message.text = nodeValue;
            message.runeLiteFormatMessage = nodeValue;
        }
    }

    private sendNotification(enabled: unknown, message: ChatMessage): void {
        const name = unescapeJagex(message.from ?? "");
        const sender = message.prefix;
        let text = "";
        if (sender) text += `[${sender}] `;
        if (name) text += `${name}: `;
        text += unescapeJagex(message.text);
        this.notify(enabled, text);
    }

    private notify(enabled: unknown, message: string): void {
        if (enabled !== true) return;
        this.notifying = true;
        try {
            this.notifier.notify(message);
        } finally {
            this.notifying = false;
        }
    }
}

/** Java's Pattern.quote. */
function quote(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteAndIgnoreColor(text: string): string {
    let out = "";
    for (const c of text) out += `${quote(c)}(?:<col=[^>]*?>)?`;
    return out;
}

const CLOSE_TAG = "</col>";

/** The colour tag in force at the end of `text`: null for none, "</col>" for the line's normal colour. */
export function getLastColor(text: string): string | null {
    const colIdx = text.lastIndexOf("<col=");
    const colEndIdx = text.lastIndexOf(CLOSE_TAG);
    if (colEndIdx > colIdx) {
        // ends in a </col> which resets the color to normal
        return CLOSE_TAG;
    }
    if (colIdx === -1) return null; // no color
    const closeIdx = text.indexOf(">", colIdx);
    if (closeIdx === -1) return null; // unclosed col tag
    return text.substring(colIdx, closeIdx + 1); // include the >
}

export function stripColor(text: string): string {
    return text.replace(/(<col=[0-9a-f]+>|<\/col>)/g, "");
}

/** RuneLite's Text.escapeJagex. */
function escapeJagex(text: string): string {
    return text.replace(/</g, "<lt>").replace(/>/g, "<gt>");
}

/**
 * RuneLite's Text.unescapeJagex, which also drops the remaining tags: the browser notification
 * shows the text as it is, and the chat line the Notifier writes adds its own colour.
 */
function unescapeJagex(text: string): string {
    return text.replace(/<lt>/g, "\u0000").replace(/<gt>/g, "\u0001")
        .replace(/<[^>]*>/g, "")
        .replace(/\u0000/g, "<").replace(/\u0001/g, ">");
}

/** RuneLite's Text.removeTags. */
function removeTags(text: string): string {
    return text.replace(/<[^>]*>/g, "");
}

/** RuneLite's Text.toJagexName: non-breaking spaces, underscores and hyphens to spaces, trimmed. */
function toJagexName(text: string): string {
    return text.replace(/[ _-]/g, " ").replace(/[^\x20-\x7e]/g, "").trim();
}
