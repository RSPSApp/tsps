import { strict as assert } from "node:assert";
import { ChatMessage, GameStateChanged } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ChatFilterConfig, ChatFilterType } from "../game/plugins/chatfilter/ChatFilterConfig";
import { CENSOR_MESSAGE, ChatFilterPlugin } from "../game/plugins/chatfilter/ChatFilterPlugin";
import { escapeJagex, sanitize, stripAccents, unescapeJagex } from "../game/plugins/chatfilter/chatFilterText";
import { ChatHistoryStore } from "../rs/cs2/ChatHistory";

// --- Config: RuneLite's group, keys, section and defaults ---------------------------------------
assert.equal(ChatFilterConfig.group, "chatfilter");
assert.equal(ChatFilterConfig.items.filterFriendsChat.keyName, "filterClan", "RuneLite's old key");
assert.equal(ChatFilterConfig.items.filterType.default, ChatFilterType.CENSOR_WORDS);
assert.equal(ChatFilterConfig.sections?.filterLists.closedByDefault, true);
assert.equal(ChatFilterPlugin.descriptor.enabledByDefault, false, "off by default, as RuneLite");

// --- RuneLite's Text helpers ---------------------------------------------------------------------
assert.equal(unescapeJagex("a<lt>b<gt>c<col=ff0000>d</col><br>e"), "a<b>cd\ne");
assert.equal(escapeJagex("a<b>c@d\ne\r"), "a<lt>b<gt>c<at>d<br>e");
assert.equal(sanitize("<img=2>Some name"), "Some name");
assert.equal(stripAccents("Éléphant Łódź Ø"), "Elephant Lodz O");
assert.equal(stripAccents("ÉLÉ").length, 3, "one character per character");

// --- The plugin -----------------------------------------------------------------------------------
const friends = new Set(["Buddy"]);
const fcMembers = new Set(["Fc guy"]);
const clanMembers = new Set(["Clanmate"]);
const history = new ChatHistoryStore();
const plugin = new ChatFilterPlugin({
    getLocalPlayerName: () => "Me",
    isFriended: (name) => friends.has(name),
    isFriendsChatMember: (name) => fcMembers.has(name),
    isClanChatMember: (name) => clanMembers.has(name),
}, history);
let refreshes = 0;
plugin.refreshChat = () => refreshes++;
const config = inject(ConfigManager);
const set = (key: string, value: unknown) => {
    config.setConfigValue(ChatFilterConfig, key, value);
    plugin.updateFilteredPatterns();
};

/** RuneLite's chatFilterCheck callback: ints [..., 1, type, id], objects [..., message]. */
function check(type: number, text: string, from = ""): string | null {
    const id = history.addMessage(type, text, from);
    const vm: any = { intStack: [1, type, id], intStackSize: 3, stringStack: [text], stringStackSize: 1 };
    plugin.onScriptCallback({ eventName: "chatFilterCheck", vm });
    return vm.intStack[0] === 0 ? null : vm.stringStack[0];
}

const PUBLIC = 2, PRIVATE = 3, GAME = 0, CLAN = 41, TRADE = 101;
void plugin.start();
assert.equal(refreshes, 1, "startUp rebuilds the chatbox");
set("filteredWords", "goblin, rat");
assert.equal(check(PUBLIC, "A Goblin and a rat!", "Stranger"), "A ****** and a ***!", "words, any case");
assert.equal(check(PUBLIC, "nothing here", "Stranger"), "nothing here", "untouched lines keep their text");
assert.equal(check(PUBLIC, "goblin", "Me"), "goblin", "your own lines aren't filtered");
assert.equal(check(PUBLIC, "goblin", "<img=1>Buddy"), "goblin", "friends aren't, unless asked");
assert.equal(check(PRIVATE, "goblin", "Fc guy"), "goblin", "nor friends chat members");
assert.equal(check(CLAN, "goblin", "Clanmate"), "goblin", "nor clan members");
set("filterFriends", true);
set("filterFriendsChat", true);
set("filterClanChat", true);
assert.equal(check(PUBLIC, "goblin", "<img=1>Buddy"), "******");
assert.equal(check(PRIVATE, "goblin", "Fc guy"), "******");
assert.equal(check(CLAN, "goblin", "Clanmate"), "******");

assert.equal(check(GAME, "You kill the goblin."), "You kill the goblin.", "game chat only when asked");
set("filterGameChat", true);
assert.equal(check(GAME, "You kill the goblin."), "You kill the ******.");
assert.equal(check(TRADE, "goblin wishes to trade with you.", "goblin"), "goblin wishes to trade with you.",
    "trade requests are neither player nor game chat");

set("filteredRegex", "b[ae]d\n[unclosed\n");
assert.equal(check(PUBLIC, "bad bed bid", "Stranger"), "*** *** bid", "regexes; a broken one is skipped");
assert.equal(check(PUBLIC, "a <lt>goblin<gt>", "Stranger"), "a <lt>******<gt>", "escaped text stays escaped");

set("filterType", ChatFilterType.CENSOR_MESSAGE);
assert.equal(check(PUBLIC, "goblin", "Stranger"), CENSOR_MESSAGE);
set("filterType", ChatFilterType.REMOVE_MESSAGE);
assert.equal(check(PUBLIC, "goblin", "Stranger"), null, "removed: the line isn't built");
assert.equal(check(PUBLIC, "fine", "Stranger"), "fine");

set("filterType", ChatFilterType.CENSOR_WORDS);
set("filteredNames", "^spam.*");
assert.equal(check(PUBLIC, "<col=ff0000>hello</col>", "Spammer1"), "*****", "a filtered name censors the whole line");
assert.ok(plugin.isNameFiltered("SPAMMER2"), "names are matched standardized");

set("stripAccents", true);
set("filteredWords", "cafe");
assert.equal(check(PUBLIC, "un café", "Stranger"), "un ****", "accents stripped before matching");
set("stripAccents", false);
set("filteredWords", "goblin, rat");

// Collapsing duplicates: the newest copy shows with its count, the older ones go.
set("collapseGameChat", true);
const dup = (n: number) => Array.from({ length: n }, () => {
    const id = history.addMessage(GAME, "Nothing interesting happens.");
    return id;
});
const ids = dup(3);
const build = (id: number) => {
    const vm: any = { intStack: [1, GAME, id], intStackSize: 3, stringStack: ["Nothing interesting happens."], stringStackSize: 1 };
    plugin.onScriptCallback({ eventName: "chatFilterCheck", vm });
    return vm.intStack[0] === 0 ? null : vm.stringStack[0];
};
assert.deepEqual(ids.map(build), [null, null, "Nothing interesting happens. (3)"]);
// An API event must not overwrite the real history entry's duplicate identity.
const bus = new EventBus();
bus.register(plugin);
try {
    const id = history.addMessage(GAME, "undefined");
    bus.post(new ChatMessage(GAME, "", "undefined", null));
    const vm: any = { intStack: [1, GAME, id], intStackSize: 3, stringStack: ["undefined"], stringStackSize: 1 };
    plugin.onScriptCallback({ eventName: "chatFilterCheck", vm });
    assert.equal(vm.intStack[0], 1, "a real line remains visible after both chat producers run");
    assert.equal(vm.stringStack[0], "undefined");
} finally {
    bus.unregister(plugin);
}
set("collapsePlayerChat", true);
set("maxRepeatedPublicChats", 2);
const spamIds = [1, 2, 3].map(() => history.addMessage(PUBLIC, "buy gf", "Stranger"));
const buildPublic = (id: number) => {
    const vm: any = { intStack: [1, PUBLIC, id], intStackSize: 3, stringStack: ["buy gf"], stringStackSize: 1 };
    plugin.onScriptCallback({ eventName: "chatFilterCheck", vm });
    return vm.intStack[0] === 0 ? null : vm.stringStack[0];
};
assert.deepEqual(spamIds.map(buildPublic), [null, null, null], "repeated more than the repeat filter: blocked");
// A login resets the message ids: old duplicates then play back uncollapsed.
plugin.onGameStateChanged(new GameStateChanged(GameState.LOGGING_IN));
assert.deepEqual(ids.map(build), ["Nothing interesting happens.", "Nothing interesting happens.", "Nothing interesting happens."]);

// Overhead chat.
assert.equal(plugin.overheadChatText({ name: "Stranger", text: "a goblin" }), "a ******");
assert.equal(plugin.overheadChatText({ name: "Me", text: "a goblin" }), undefined, "your own overhead text stays");
set("filterType", ChatFilterType.REMOVE_MESSAGE);
assert.equal(plugin.overheadChatText({ name: "Stranger", text: "a goblin" }), " ", "removed: blank, as RuneLite");

refreshes = 0;
plugin.onConfigChanged({ getGroup: () => "chatfilter" } as any);
assert.equal(refreshes, 1, "a settings change rebuilds the chatbox");
void plugin.stop();
assert.equal(check(PUBLIC, "goblin", "Stranger"), "goblin", "stopped: nothing filtered");
assert.equal(plugin.overheadChatText({ name: "Stranger", text: "goblin" }), undefined);
assert.equal(history.beforeInsertListeners.size, 0, "shutDown stops counting duplicates");

console.log("Chat Filter plugin tests passed");
