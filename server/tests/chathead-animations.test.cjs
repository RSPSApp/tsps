const test = require("node:test");
const assert = require("node:assert/strict");

const ANIMATIONS = require("../plugins/quests/data/chathead-animations.json");
const register = require("../plugins/quests/ChatheadAnimations.QuestRuntime.js");

function lineHandler() {
  let handler;
  register({ onCustomEvent: (name, fn) => { assert.equal(name, "npc-dialogue:line"); handler = fn; } });
  return handler;
}

const cook = { getName: () => "Cook" };

test("captured NPC and player lines get the captured chat-head animation", () => {
  const handler = lineHandler();
  const typed = { definition: cook, step: { type: "line", speaker: "Cook", text: "What am I to do?" } };
  handler(typed);
  assert.equal(typed.expression, 610);
  const npc = { definition: cook, step: { npc: "Maybe, but I won't be holding my breath." } };
  handler(npc);
  assert.equal(npc.expression, 588);
  const player = { definition: cook, step: { player: "Yes, I'll help you." } };
  handler(player);
  assert.equal(player.expression, 567);
});

test("an uncaptured line keeps the default head and a quest's own animation wins", () => {
  const handler = lineHandler();
  const uncaptured = { definition: cook, step: { npc: "How is the adventuring going, my friend?" } };
  handler(uncaptured);
  assert.equal(uncaptured.expression, undefined);
  const owned = { definition: cook, expression: 123, step: { npc: "What am I to do?" } };
  handler(owned);
  assert.equal(owned.expression, 123);
});

test("the data holds only real animation ids, under speakers' names", () => {
  for (const [speaker, lines] of Object.entries(ANIMATIONS)) {
    assert.ok(speaker.length > 0);
    for (const [text, animation] of Object.entries(lines)) {
      assert.ok(Number.isInteger(animation) && animation >= 0, `${speaker}: ${text}`);
    }
  }
});
