import { strict as assert } from "node:assert";
import { ChatMessageType } from "@runelite/api/ChatMessageType";
import { ChatMessage } from "@runelite/api/events";
import { bindDialogueChat } from "../runelite/impl/DialogueChatSource";

// RuneLite's DIALOG (114) chat messages: "<name>|<text>" for each NPC (chat_left, 231) or player
// (chat_right, 217) dialogue page, read on the game tick after the group loads, when the server's
// text has arrived. Plugins such as Clue Scroll match Charlie's tasks and Falo the Bard on them.

assert.equal(ChatMessageType.GAMEMESSAGE, 0);
assert.equal(ChatMessageType.SPAM, 105);
assert.equal(ChatMessageType.DIALOG, 114);

const CHAT_LEFT = 231, CHAT_RIGHT = 217, CHATMENU = 219;
const uid = (group: number, child: number) => (group << 16) | child;

const widgets = new Map<number, { text?: string; isHidden?: boolean }>();
const groupLoadedListeners = new Set<(groupId: number) => void>();
const ticks = new Set<() => void>();
const client: any = {
    widgetManager: { groupLoadedListeners, getWidgetByUid: (id: number) => widgets.get(id) },
};
const posted: ChatMessage[] = [];
const unbind = bindDialogueChat(client, (e) => posted.push(e), (tick) => {
    ticks.add(tick);
    return () => ticks.delete(tick);
});
const load = (group: number) => {
    for (const listener of groupLoadedListeners) listener(group);
};
const tick = () => {
    for (const t of ticks) t();
};

// --- An NPC page: name and text, read after the tick ---------------------------------------------
widgets.set(uid(CHAT_LEFT, 4), { text: "Falo the Bard" });
widgets.set(uid(CHAT_LEFT, 6), { text: "A blood red weapon, a strong curved sword, found on the island of primate lords." });
load(CHAT_LEFT);
assert.equal(posted.length, 0, "nothing until the tick: the text arrives after the open");
tick();
assert.equal(posted.length, 1);
assert.equal(posted[0].getType(), ChatMessageType.DIALOG);
assert.equal(posted[0].getName(), "");
assert.equal(posted[0].getMessage(), "Falo the Bard|A blood red weapon, a strong curved sword, found on the island of primate lords.");
assert.equal(posted[0].getSender(), null);
tick();
assert.equal(posted.length, 1, "one message per page, not per tick");

// --- A player page ---------------------------------------------------------------------------------
widgets.set(uid(CHAT_RIGHT, 4), { text: "Kraken" });
widgets.set(uid(CHAT_RIGHT, 6), { text: "I need you to cook me a trout." });
load(CHAT_RIGHT);
tick();
assert.equal(posted.length, 2);
assert.equal(posted[1].getMessage(), "Kraken|I need you to cook me a trout.");

// --- Other groups and hidden or missing text post nothing ----------------------------------------
load(CHATMENU);
tick();
assert.equal(posted.length, 2, "a chat menu is not a dialogue page");

widgets.set(uid(CHAT_LEFT, 6), { text: "Hidden line", isHidden: true });
load(CHAT_LEFT);
tick();
assert.equal(posted.length, 2, "a hidden text widget posts nothing");

widgets.delete(uid(CHAT_LEFT, 6));
load(CHAT_LEFT);
tick();
assert.equal(posted.length, 2, "a missing text widget posts nothing");

// --- The same page loaded twice in one tick posts once ------------------------------------------
widgets.set(uid(CHAT_LEFT, 6), { text: "Twice" });
load(CHAT_LEFT);
load(CHAT_LEFT);
tick();
assert.equal(posted.length, 3);
assert.equal(posted[2].getMessage(), "Falo the Bard|Twice");

unbind();
load(CHAT_LEFT);
tick();
assert.equal(posted.length, 3, "unbinding stops the posts");
assert.equal(groupLoadedListeners.size, 0);
assert.equal(ticks.size, 0);

console.log("runelite-dialogue-chat: ok");
