// Run with `npx tsx tests/chat-requests.test.ts`.
//
// Request chat lines and the player option that answers each: a trade request (101) answers
// with Trade (option 2); a PvP Arena challenge (103) and load-out share (101) with the option the
// server labelled Challenge or Load-outs, so accepting one never sends Trade.
import assert from "node:assert/strict";

import { ClientState } from "../game/ClientState";
import { chatRequestOption, chatRequestSlot, isChatRequestLine } from "../game/chatRequests";

assert.equal(chatRequestOption(101, "wishes to trade with you."), "Trade");
assert.equal(chatRequestOption(101, "wishes to share load-outs with you."), "Load-outs");
assert.equal(chatRequestOption(103, "Alpha is inviting you to an unranked duel."), "Challenge");
assert.equal(chatRequestOption(0, "Alpha is inviting you to an unranked duel."), undefined, "a game line is no request");
assert.equal(chatRequestOption(101, "Welcome to Old School RuneScape."), undefined);

assert.equal(isChatRequestLine("<col=7e3200>Alpha is inviting you to an unranked duel.</col>"), true);
assert.equal(isChatRequestLine("Alpha wishes to share load-outs with you."), true);
assert.equal(isChatRequestLine("Alpha says hello."), false);

ClientState.playerOptions.clear();
ClientState.playerOptions.set(1, { option: "Challenge", priority: false });
ClientState.playerOptions.set(4, { option: "Load-outs", priority: false });
assert.equal(chatRequestSlot("Trade"), 2);
assert.equal(chatRequestSlot("Challenge"), 1);
assert.equal(chatRequestSlot("Load-outs"), 4);
ClientState.playerOptions.delete(1);
assert.equal(chatRequestSlot("Challenge"), undefined, "no Challenge option, nothing to send");
ClientState.playerOptions.clear();

console.log("chat-requests: ok");
