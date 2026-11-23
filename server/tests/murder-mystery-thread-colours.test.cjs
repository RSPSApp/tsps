"use strict";
// Murder Mystery's Frank and Elizabeth ask "If the criminal's thread is blue" (Transcript:Murder Mystery, as
// imported from osrsreboxed-db): a red culprit must get their "not blue" answer, a blue one the match.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

before(async () => {
  h.key = "murder_mystery";
  await h.setup([[2740, 3570]]);
});
after(() => h.teardown());

async function askFrank(t, murderer, thread) {
  const f = h.actor(t, { at: [2741, 3561, 0], stage: 1, items: [[thread]], attributes: { "quest.murder_mystery.murderer": murderer } });
  const frank = h.spawn(f, 6200, [2742, 3561, 0]);
  const said = await h.converse(f, () => h.talk(f, frank), ["Do you recognise this thread?"]);
  return said;
}

test("Frank and a red culprit's thread (Bob, 1808): the 'isn't blue' answer", async (t) => {
  const said = await askFrank(t, 2, 1808);
  assert.ok(said.some((line) => line.startsWith("Frank: It looks like thread to me")), said.join("\n"));
  assert.ok(!said.some((line) => line.includes("same material as my trousers")), said.join("\n"));
});

test("Frank and a blue culprit's thread (Frank, 1810): the trousers match", async (t) => {
  const said = await askFrank(t, 6, 1810);
  assert.ok(said.some((line) => line.includes("same material as my trousers")), said.join("\n"));
});
