import { GameState } from "@runelite/api/GameState";
import { ChatMessage, GameStateChanged } from "@runelite/api/events";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { createElement, lazy, type ReactNode } from "react";
import type { OsrsClient } from "../../OsrsClient";
import { GameState as ClientGameState } from "../../login/GameState";
import { CHATBOX } from "../../../runelite/api/gameval/InterfaceID";
import { hasMountedChild, suppressCanvasGroup } from "../canvasChrome";
import { addChatLine, clearChatLines } from "./chatStore";

const ChatPanel = lazy(() => import("./ChatPanel").then((m) => ({ default: m.ChatPanel })));

/**
 * The chatbox, replacing the canvas one rather than sitting on it.
 *
 * The panel collects the same lines the game sends (`onChatMessage`) and the canvas chatbox is
 * hidden for as long as the panel is up, so there is one chatbox on screen and it is this one.
 * Two exceptions give the space straight back: before the player is in the world, and whenever a
 * dialogue is mounted in the chat area — that is canvas content we do not replace, and hiding its
 * host would take the dialogue with it.
 */
export class GameChatPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Chat",
        description: "Shows the chat as a panel, with timestamps and unread counts.",
        tags: ["chat", "interface"],
        configKey: "gamechatplugin",
    };

    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);

    /**
     * Re-asserted every tick: CS2 redraws its own group and would otherwise bring the old chatbox
     * back between two ticks, which is exactly the flicker this replaces.
     */
    onGameTick(): void {
        const client = this.client;
        if (!client) return;
        const inWorld = client.gameState === ClientGameState.LOGGED_IN;
        suppressCanvasGroup(client, CHATBOX, inWorld && !hasMountedChild(client, CHATBOX));
    }

    onChatMessage(message: ChatMessage): void {
        addChatLine(message.getType(), message.getName(), message.getMessage());
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        // The log belongs to the account that just left.
        if (state === GameState.LOGIN_SCREEN || state === GameState.HOPPING) {
            clearChatLines();
            if (this.client) suppressCanvasGroup(this.client, CHATBOX, false);
        }
    }

    renderHud(osrsClient: OsrsClient): ReactNode {
        return createElement(ChatPanel, { osrsClient });
    }
}
