// Run after `yarn build`: node --test tests/npc-chathead-animations.test.cjs
// Konar's head is not on the human chathead rig, so 589 leaves it still; live sends 8220
// (rsprox 2960, tsps#6930). Data: data/definitions/npc-captured-chatheads.json.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { NpcDialogue } = require("../dist/game/model/dialogues/entries/impl/NpcDialogue");
const { DialogueExpression } = require("../dist/game/model/dialogues/DialogueExpression");
const CAPTURED = require("../data/definitions/npc-captured-chatheads.json").npcs;

const KONAR = 8623, CHAELDAR = 404, VANNAKA = 403;
const HEAD_UID = (231 << 16) | 2;

/** The animation `NpcDialogue` sends for the head of one line. */
function headAnimation(npcId, expression, send = "send") {
  const sent = [];
  const sender = new Proxy({}, {
    get: (_, method) => (...args) => {
      if (method === "sendInterfaceAnimation") sent.push(args);
      return sender;
    },
  });
  const player = { getPacketSender: () => sender };
  new NpcDialogue(0, npcId, "Your new task.", "Speaker", expression)[send](player);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], HEAD_UID);
  return sent[0][1];
}

test("a head with its own rig gets its captured animation, whatever human mood the line asks for", () => {
  assert.equal(headAnimation(KONAR), 8220);
  assert.equal(headAnimation(KONAR, undefined, "sendHeld"), 8220);
  assert.equal(headAnimation(KONAR, DialogueExpression.ANNOYED), 8220);
  assert.equal(headAnimation(KONAR, 567), 8220);
});

test("an animation outside the human ones is sent as asked", () => {
  assert.equal(headAnimation(9580, 6550), 6550);
});

test("human heads keep the line's animation", () => {
  assert.equal(headAnimation(CHAELDAR), 589);
  assert.equal(headAnimation(VANNAKA, DialogueExpression.HAPPY), 588);
});

test("every captured row names an NPC and an animation outside the human ones", () => {
  for (const [id, { seq }] of Object.entries(CAPTURED)) {
    assert.equal(headAnimation(Number(id)), seq, id);
    assert.ok(seq < 554 || seq > 617, `${id}: ${seq}`);
  }
});
