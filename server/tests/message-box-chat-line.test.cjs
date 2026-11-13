// Run after `yarn build`: node --test tests/message-box-chat-line.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { StatementDialogue } = require("../dist/game/model/dialogues/entries/impl/StatementDialogue");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { DoubleItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/DoubleItemStatementDialogue");
const { ChatType } = require("../dist/net/protocol/ClientProtocol");

const SET_TEXT_ALIGN = 600;
const MESSAGEBOX_TEXT = (229 << 16) | 3;

/** A player whose packet sender records every call in order. */
function recorder() {
  const calls = [];
  const sender = new Proxy({}, {
    get: (_, name) => (...args) => { calls.push([name, ...args]); return sender; },
  });
  return { calls, player: { getPacketSender: () => sender } };
}

const chatLines = (calls) => calls.filter(([name]) => name === "sendTypedMessage").map(([, type, text]) => ({ type, text }));

const JEWELLERY_LOCKED = "This destination is unlocked by reaching <col=ff0000>Hero</col> status in the Fortis<br>Colosseum.";
const BOAT_DELIVERED = "Your brand new boat has been delivered to the Pandemonium.";

test("a message box sends its text as a mesbox chat line before it opens, breaks as spaces", () => {
  const { calls, player } = recorder();
  StatementDialogue.send(player, JEWELLERY_LOCKED);
  assert.deepEqual(chatLines(calls), [{ type: ChatType.MESBOX,
    text: "This destination is unlocked by reaching <col=ff0000>Hero</col> status in the Fortis Colosseum." }]);
  assert.equal(calls[0][0], "sendTypedMessage");
  assert.equal(calls[1][0], "sendChatboxInterface");
});

test("an item box and a double item box send the line too", () => {
  const item = recorder();
  ItemStatementDialogue.send(item.player, 32859, BOAT_DELIVERED);
  assert.deepEqual(chatLines(item.calls), [{ type: ChatType.MESBOX, text: BOAT_DELIVERED }]);
  assert.equal(item.calls[0][0], "sendTypedMessage");

  const double = recorder();
  DoubleItemStatementDialogue.send(double.player, 1351, 590, "The survival expert gives you a bronze axe and a<br>tinderbox.");
  assert.deepEqual(chatLines(double.calls), [{ type: ChatType.MESBOX,
    text: "The survival expert gives you a bronze axe and a tinderbox." }]);
});

test("a chained box sends its line once, when the dialogue shows it", () => {
  const { calls, player } = recorder();
  new StatementDialogue(0, "The chest is locked.").send(player);
  new ItemStatementDialogue(1, 995, "You find some coins.").send(player);
  assert.deepEqual(chatLines(calls).map(({ text }) => text), ["The chest is locked.", "You find some coins."]);
});

test("the chat line stops at 200 characters, as live cuts it", () => {
  const box = "Leaving your boat while out at sea will result in it being <col=7f0000>lost</col>. If this<br>"
    + "happens, retrieving it will <col=7f0000>incur a gold fee</col> and any <col=7f0000>fish, salvage,<br>"
    + "<col=7f0000>crates or bounty parts</col> on board will be <col=7f0000>lost</col>.";
  const { calls, player } = recorder();
  StatementDialogue.send(player, box);
  assert.deepEqual(chatLines(calls).map(({ text }) => text), [
    "Leaving your boat while out at sea will result in it being <col=7f0000>lost</col>. If this happens, "
    + "retrieving it will <col=7f0000>incur a gold fee</col> and any <col=7f0000>fish, salvage, <col=7f0000"]);
});

test("a blank box (over a fade) sends no chat line", () => {
  const { calls, player } = recorder();
  StatementDialogue.send(player, "", false);
  assert.deepEqual(chatLines(calls), []);
});

test("the message box spreads two, three and four lines; one line or five keep line height 0", () => {
  const heights = [];
  for (const text of ["One line.", "One<br>two", "One<br>two<br>three", "1<br>2<br>3<br>4", "1<br>2<br>3<br>4<br>5"]) {
    const { calls, player } = recorder();
    StatementDialogue.send(player, text);
    const align = calls.find(([name, script]) => name === "sendClientScript" && script === SET_TEXT_ALIGN);
    assert.equal(align[5], MESSAGEBOX_TEXT);
    heights.push(align[4]);
  }
  assert.deepEqual(heights, [0, 31, 24, 17, 0]);
});
