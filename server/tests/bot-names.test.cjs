// node --test tests/bot-names.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateBotName, botNameProblem } = require("../plugins/bots/lib/BotNames.PlayerBots");

test("names are valid and deterministic per username", () => {
  for (let i = 1; i <= 300; i += 1) {
    const name = generateBotName(`WildyBot${i}`);
    assert.equal(botNameProblem(name), null, name);
    assert.equal(name, generateBotName(`WildyBot${i}`));
  }
});

test("names are unique when taken ones are skipped", () => {
  const taken = new Set();
  for (let i = 1; i <= 300; i += 1) {
    const name = generateBotName(`WildyBot${i}`, (n) => taken.has(n.toLowerCase()));
    assert.ok(!taken.has(name.toLowerCase()), name);
    taken.add(name.toLowerCase());
  }
  assert.equal(taken.size, 300);
});
