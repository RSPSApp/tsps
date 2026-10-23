import { strict as assert } from "node:assert";

import { getTransmitCycles } from "../game/TransmitCycles";
import { ChatHistoryStore } from "../rs/cs2/ChatHistory";

// Script 553 ages messages by `clientclock - cycle`, so cycle must be the client clock, not a count.
const store = new ChatHistoryStore();
getTransmitCycles().cycleCntr = 5000;
const first = store.addMessage(0, "first");
const sameFrame = store.addMessage(2, "same frame", "Bob");
getTransmitCycles().cycleCntr = 8001;
const later = store.addMessage(0, "later");

assert.equal(store.getFullByTypeAndLine(0, 1)?.cycle, 5000);
assert.equal(store.getFullByTypeAndLine(2, 0)?.cycle, 5000);
assert.equal(store.getFullByTypeAndLine(0, 0)?.cycle, 8001);
// Messages in the same frame still walk in arrival order across types.
assert.equal(store.getNextUid(0, first), sameFrame);
assert.equal(store.getNextUid(0, sameFrame), later);
assert.equal(store.getPrevUid(0, later), sameFrame);
console.log("chat-history-cycle ok");
