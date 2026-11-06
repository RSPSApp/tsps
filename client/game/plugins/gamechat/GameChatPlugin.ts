import { GameState } from "@runelite/api/GameState";
import { ChatMessage, GameStateChanged } from "@runelite/api/events";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { createElement, lazy, type ReactNode } from "react";
import type { OsrsClient } from "../../OsrsClient";
import { addChatLine, clearChatLines } from "./chatStore";

const ChatPanel = lazy(() => import("./ChatPanel").then((m) => ({ default: m.ChatPanel })));

/**
 * The chatbox as a panel over the canvas one.
 *
 * The canvas box stays where it is and keeps being fed by the game: this plugin only collects the
 * same lines as they arrive and draws them again, so nothing is lost if the panel is turned off.
 * That is also why it can be a plugin at all rather than a change to the widget system.
 */
export class GameChatPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Chat",
        description: "Shows the chat as a panel, with timestamps and unread counts.",
        tags: ["chat", "interface"],
        configKey: "gamechatplugin",
    };

    onChatMessage(message: ChatMessage): void {
        addChatLine(message.getType(), message.getName(), message.getMessage());
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        // The log belongs to the account that just left.
        if (state === GameState.LOGIN_SCREEN || state === GameState.HOPPING) clearChatLines();
    }

    renderHud(_osrsClient: OsrsClient): ReactNode {
        return createElement(ChatPanel);
    }
}
