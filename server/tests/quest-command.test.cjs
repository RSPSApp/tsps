// Run after `yarn build`: node --test tests/quest-command.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const QuestRuntime = require("../plugins/quests/QuestRuntime");
const QuestCommand = require("../plugins/quests/QuestCommand.plugin");

const api = new Proxy({}, { get: () => () => {} });
const grandTree = QuestRuntime.registerQuest(api, { key: "the_grand_tree", name: "The Grand Tree", varpId: 150, completionValue: 160, questPoints: 5 });
QuestRuntime.registerQuest(api, { key: "tree_gnome_village", name: "Tree Gnome Village", varpId: 111, completionValue: 9, questPoints: 2 });

function createPlayer() {
  const attributes = new Map();
  const messages = [];
  const varps = new Map();
  const sender = new Proxy({}, {
    get: (_target, method) => (method === "sendConfig" ? (id, value) => { varps.set(id, value); return sender; } : () => sender),
  });
  return {
    messages,
    varps,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => sender,
    getInventory: () => ({ adds() {} }),
  };
}

const run = (player, command) => QuestCommand._test.questCommand({ player, parts: command.split(" ") });

test("::quest grand tree complete completes it as the quest does, with its points", () => {
  const player = createPlayer();
  run(player, "quest grand tree complete");
  assert.ok(grandTree.isComplete(player));
  assert.equal(player.getAttribute("quest.points"), 5);
  assert.equal(player.varps.get(150), 160, "the quest's varp follows");
  assert.equal(player.messages.at(-1), "The Grand Tree: stage 160 (complete; completes at 160).");
});

test("reset and a stage number set the stage, and quest points follow completion", () => {
  const player = createPlayer();
  run(player, "quest the_grand_tree 160");
  assert.equal(player.getAttribute("quest.points"), 5);
  run(player, "quest The Grand Tree 40");
  assert.equal(grandTree.getStage(player), 40);
  assert.equal(player.getAttribute("quest.points"), 0);
  run(player, "quest grand tree reset");
  assert.equal(grandTree.getStage(player), 0);
  assert.equal(player.messages.at(-1), "The Grand Tree: stage 0 (not started; completes at 160).");
});

test("names: a partial name must match one quest", () => {
  const player = createPlayer();
  run(player, "quest tree");
  assert.equal(player.messages.at(-1), '"tree" matches 2 quests: The Grand Tree, Tree Gnome Village.');
  run(player, "quest dragon slayer ii");
  assert.equal(player.messages.at(-1), 'No quest matches "dragon slayer ii".');
  run(player, "quest");
  assert.match(player.messages.at(-1), /^Usage/);
});
