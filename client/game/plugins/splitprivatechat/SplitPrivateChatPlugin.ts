import { GameState } from "@runelite/api/GameState";
import { ChatMessage, GameStateChanged } from "@runelite/api/events";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { createElement, lazy, type ReactNode } from "react";
import type { OsrsClient } from "../../OsrsClient";
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

const SplitPrivateChatOverlay = lazy(() =>
    import("./SplitPrivateChatOverlay").then((m) => ({ default: m.SplitPrivateChatOverlay })),
);

// RuneLite's ChatMessageType.PRIVATECHAT and PRIVATECHATOUT.
const PRIVATECHAT = 3;
const PRIVATECHATOUT = 6;

export class SplitPrivateChatPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Split Private Chat",
        description: "Shows private messages above the chatbox.",
        tags: ["chat"],
        hidden: true,
        configKey: "splitprivatechatplugin",
    };

    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private readonly listeners = new Set<SplitPrivateChatListener>();

    onChatMessage(message: ChatMessage): void {
        if (this.client.varManager?.getVarp(SPLIT_PRIVATE_CHAT_VARP) === 1) this.addMessage(message);
    }

    onGameStateChanged(event: GameStateChanged): void {
        if (event.getGameState() === GameState.LOGIN_SCREEN) this.clear();
    }

    renderHud(osrsClient: OsrsClient): ReactNode {
        return createElement(SplitPrivateChatOverlay, { osrsClient, plugin: this });
    }
    private state: SplitPrivateChatState = { messages: [] };

    subscribe(listener: SplitPrivateChatListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): SplitPrivateChatState {
        return this.state;
    }

    addMessage(message: ChatMessage, now = Date.now()): void {
        const type = message.getType();
        if (type !== PRIVATECHAT && type !== PRIVATECHATOUT) {
            return;
        }

        const text = sanitizeText(message.getMessage());
        if (!text) {
            return;
        }

        const name = sanitizeText(message.getName());
        const direction = type === PRIVATECHATOUT ? "To" : "From";
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
