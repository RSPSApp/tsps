import { strict as assert } from "node:assert";

import { GameState } from "../runelite/api/GameState";
import { ChatMessage, GameStateChanged } from "../runelite/api/events";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { CLIENT_TOKEN, PluginInjector } from "../runelite/client/plugins/PluginInjector";
import {
    SPLIT_PRIVATE_CHAT_VARP,
    SplitPrivateChatPlugin,
} from "../game/plugins/splitprivatechat/SplitPrivateChatPlugin";

let splitVarp = 0;
const fakeClient = { varManager: { getVarp: (id: number) => (id === SPLIT_PRIVATE_CHAT_VARP ? splitVarp : 0) } };
const plugin = new PluginInjector(new ConfigManager(undefined))
    .provide(CLIENT_TOKEN, fakeClient)
    .runWith(() => new SplitPrivateChatPlugin());

plugin.onChatMessage(new ChatMessage(3, "Alice", "Hidden", null));
assert.equal(plugin.getState().messages.length, 0, "split chat off keeps private messages in the chatbox");
splitVarp = 1;
plugin.onChatMessage(new ChatMessage(3, "Alice", "Shown", null));
assert.equal(plugin.getState().messages.length, 1, "split chat on shows private messages");
plugin.onGameStateChanged(new GameStateChanged(GameState.LOGIN_SCREEN));
assert.equal(plugin.getState().messages.length, 0, "logging out clears split chat");

plugin.addMessage(new ChatMessage(2, "Alice", "Hello", null), 1_000);
assert.equal(plugin.getState().messages.length, 0, "public chat must stay out of split chat");

plugin.addMessage(new ChatMessage(3, "<img=1>Alice", "<col=ff0000>Hello</col>", null), 1_000);
plugin.addMessage(new ChatMessage(6, "Bob", "Hi", null), 1_001);
assert.deepEqual(
    plugin.getState().messages.map((message) => message.text),
    ["From Alice: Hello", "To Bob: Hi"],
);

plugin.prune(11_001);
assert.equal(plugin.getState().messages.length, 0, "expired messages must disappear");

console.log("split private chat plugin smoke test passed");
