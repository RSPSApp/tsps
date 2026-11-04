import { strict as assert } from "node:assert";
import type { Client } from "@runelite/api/Client";
import { ChatMessage, ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ChatNotificationsConfig } from "../game/plugins/chatnotifications/ChatNotificationsConfig";
import { ChatNotificationsPlugin, getLastColor, stripColor } from "../game/plugins/chatnotifications/ChatNotificationsPlugin";
import { OPTION_CHAT_COLOUR_PUBLIC_OPAQUE } from "@runelite/api/gameval/VarPlayerID";
import { ChatHistoryStore } from "../rs/cs2/ChatHistory";

assert.equal(ChatNotificationsConfig.group, "chatnotification");
assert.equal(ChatNotificationsConfig.items.highlightOwnName.default, true);
assert.equal(ChatNotificationsPlugin.descriptor.enabledByDefault, false, "off by default, as RuneLite");
assert.equal(getLastColor("a <col=ff00ff>b"), "<col=ff00ff>");
assert.equal(getLastColor("a <col=ff00ff>b</col> c"), "</col>", "back to the line colour");
assert.equal(getLastColor("plain"), null);
assert.equal(stripColor("<col=ff0000>x</col>"), "x");

let publicColourSetting = 0;
const client = {
    getLocalPlayer: () => ({ getName: () => "Cool Guy" }),
    isResized: () => false,
    getVarbitValue: () => 0,
    getVarpValue: (id: number) => (id === OPTION_CHAT_COLOUR_PUBLIC_OPAQUE ? publicColourSetting : 0),
} as unknown as Client;
const history = new ChatHistoryStore();
const config = inject(ConfigManager);
const sent: string[] = [];
// The Notifier writes its message into chat; it must not be matched again.
const notifier = { notify: (m: string) => { sent.push(m); history.addMessage(0, `<col=ff0000>${m}</col>`); } };
const plugin = new ChatNotificationsPlugin(client, notifier, history);
void plugin.start();
const shown = (type: number, text: string, from = "", prefix = "") => {
    const uid = history.addMessage(type, text, from, prefix);
    const message = history.getByUid(uid)!;
    return message.runeLiteFormatMessage ?? message.text;
};

// Your name is underlined in the highlight colour wherever it appears, in any case. In public chat
// (opaque chatbox) RuneLite's default highlight is black, and the line goes back to public blue.
assert.equal(shown(2, "hi cool guy, trade?", "Bob"), "hi <col=000000><u>Cool Guy</u><col=0000ff>, trade?");
assert.equal(shown(0, "Welcome, Cool\u00a0Guy."), "Welcome, <col=ef1020><u>Cool Guy</u></col>.",
    "nbsp too; game messages highlight red and close the tag");
assert.equal(shown(2, "<col=00ff00>hey cool guy</col>", "Bob"), "<col=00ff00>hey <col=000000><u>Cool Guy</u><col=00ff00></col>",
    "the colour in force is restored after the name");
assert.equal(shown(2, "i am cool guy", "Cool Guy"), "i am cool guy", "your own lines are left alone");
{
    // The chatbox reads lines by uid (the text) as well as by line (the RuneLite format).
    const uid = history.addMessage(2, "cool guy?", "Bob");
    assert.equal(history.getByUid(uid)!.text, "<col=000000><u>Cool Guy</u><col=0000ff>?");
    assert.equal(history.getExByTypeAndLine(2, 0)[4], "<col=000000><u>Cool Guy</u><col=0000ff>?");
}
assert.deepEqual(sent, [], "no notifications by default");

// Words and regexes.
config.setConfigValue(ChatNotificationsConfig, "highlightWordsString", "dragon, abyssal whip");
config.setConfigValue(ChatNotificationsConfig, "highlightRegexString", "\\d+k\n(unclosed");
plugin.onConfigChanged(new ConfigChanged("chatnotification", "highlightWordsString", undefined, undefined));
assert.equal(shown(2, "selling Dragon bones and an abyssal whip", "Bob"),
    "selling <col=000000>Dragon<col=0000ff> bones and an <col=000000>abyssal whip<col=0000ff>");
assert.equal(shown(2, "dragonhide", "Bob"), "dragonhide", "whole words only");
assert.equal(shown(2, "buying for 500k ea", "Bob"), "buying for <col=000000>500k<col=0000ff> ea", "regex lines; a bad one is skipped");
publicColourSetting = 0x123456 + 1;
assert.equal(shown(2, "500k", "Bob"), "<col=000000>500k<col=123456>", "the in-game chat colour setting wins");
publicColourSetting = 0;

// Notifications.
config.setConfigValue(ChatNotificationsConfig, "notifyOnHighlight", true);
config.setConfigValue(ChatNotificationsConfig, "notifyOnOwnName", true);
config.setConfigValue(ChatNotificationsConfig, "notifyOnPM", true);
config.setConfigValue(ChatNotificationsConfig, "notifyOnTrade", true);
config.setConfigValue(ChatNotificationsConfig, "notifyOnBroadcast", true);
shown(2, "dragon spear?", "Bob");
assert.deepEqual(sent, ["Bob: dragon spear?"]);
sent.length = 0;
shown(41, "anyone seen cool guy", "Alice", "Clan");
assert.deepEqual(sent, ["[Clan] Alice: anyone seen cool guy"], "own name in clan chat, with the channel");
sent.length = 0;
shown(3, "hello <lt>3", "Alice");
assert.deepEqual(sent, ["Alice: hello <3"], "private messages, unescaped");
sent.length = 0;
shown(101, "Sending trade offer...", "Bob");
assert.deepEqual(sent, [], "TRADEREQ text must contain the phrase");
shown(101, "Bob wishes to trade with you.", "Bob");
assert.deepEqual(sent, ["Bob wishes to trade with you."]);
sent.length = 0;
shown(14, "<col=ff0000>News:</col> drop party|12");
assert.deepEqual(sent, ["News: drop party"], "the link token and tags go");
sent.length = 0;
shown(6, "dragon", "Bob");
assert.deepEqual(sent, [], "your own outgoing PMs never notify");

const bus = new EventBus();
bus.register(plugin);
const errors: unknown[][] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => errors.push(args);
try {
    const text = "Bob wishes to trade with you.";
    shown(101, text, "Bob");
    bus.post(new ChatMessage(101, "Bob", text, null));
    assert.deepEqual(sent, [text], "the two chat producers send exactly one trade notification");
    assert.deepEqual(errors, [], "the API chat event must not reach the history-only handler");
} finally {
    console.error = originalError;
    bus.unregister(plugin);
}
sent.length = 0;

// Disabling stops it.
void plugin.stop();
shown(2, "dragon", "Bob");
assert.deepEqual(sent, []);
assert.equal(history.beforeInsertListeners.size, 0);

console.log("chat-notifications-plugin: ok");
