import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import type { ChatMessageEvent } from "../../../network/serverConnection/types/messages";
import { sanitizeText } from "../../../widgets/menu/utils";

export const SPLIT_PRIVATE_CHAT_VARP = 287;

const DISPLAY_DURATION_MS = 10_000;
const MAX_MESSAGES = 5;

export interface SplitPrivateChatMessage {
    text: string;
    expiresAt: number;
}

export interface SplitPrivateChatState {
    messages: readonly SplitPrivateChatMessage[];
}

type SplitPrivateChatListener = () => void;

function isPrivateMessage(message: ChatMessageEvent): boolean {
    return (
        message.chatType === 3 ||
        message.chatType === 6 ||
        message.messageType === "private_in" ||
        message.messageType === "private_out"
    );
}

function isOutgoingPrivateMessage(message: ChatMessageEvent): boolean {
    return message.chatType === 6 || message.messageType === "private_out";
}

export class SplitPrivateChatPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Split Private Chat",
        description: "Shows private messages above the chatbox.",
        tags: ["chat"],
        hidden: true,
        configKey: "splitprivatechatplugin",
    };

    private readonly listeners = new Set<SplitPrivateChatListener>();
    private state: SplitPrivateChatState = { messages: [] };

    subscribe(listener: SplitPrivateChatListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): SplitPrivateChatState {
        return this.state;
    }

    addMessage(message: ChatMessageEvent, now = Date.now()): void {
        if (!isPrivateMessage(message)) {
            return;
        }

        const text = sanitizeText(message.text);
        if (!text) {
            return;
        }

        const name = sanitizeText(message.from);
        const direction = isOutgoingPrivateMessage(message) ? "To" : "From";
        const prefix = name ? `${direction} ${name}: ` : `${direction}: `;
        this.commit([
            ...this.state.messages.filter((entry) => entry.expiresAt > now),
            { text: `${prefix}${text}`, expiresAt: now + DISPLAY_DURATION_MS },
        ].slice(-MAX_MESSAGES));
    }

    prune(now = Date.now()): void {
        const messages = this.state.messages.filter((message) => message.expiresAt > now);
        if (messages.length !== this.state.messages.length) {
            this.commit(messages);
        }
    }

    clear(): void {
        if (this.state.messages.length > 0) {
            this.commit([]);
        }
    }

    private commit(messages: readonly SplitPrivateChatMessage[]): void {
        this.state = { messages };
        for (const listener of this.listeners) {
            listener();
        }
    }
}
