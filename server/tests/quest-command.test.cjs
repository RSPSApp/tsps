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

test("::quest all routing: lamps skipped, bankable to the bank, unbankable and bank overflow to the inventory", () => {
  const item = (id, name, amount = 1) => ({
    id, amount,
    getId() { return this.id; }, getAmount() { return this.amount; },
    setAmount(n) { this.amount = n; return this; }, clone() { return item(this.id, name, this.amount); },
    getDefinition: () => ({ getName: () => name }),
  });
  const bank = { held: new Map(), cap: 5,
    add(it) { const now = this.held.get(it.getId()) ?? 0; this.held.set(it.getId(), Math.min(this.cap, now + it.getAmount())); },
    getAmount(id) { return this.held.get(id) ?? 0; } };
  const added = [], forced = [];
  const inventory = { add(it) { added.push([it.getId(), it.getAmount()]); return this; }, forceAdd(_p, it) { forced.push([it.getId(), it.getAmount()]); } };
  const original = { add: inventory.add, forceAdd: inventory.forceAdd };
  const player = { getInventory: () => inventory, getBanks: () => [bank], getBank: () => bank };
  const names = { 1: "Antique lamp", 2: "Tome of experience", 3: "Unbankable thing", 4: "Combat lamp", 5: "Oil lamp", 6: "Blessed lamp", 10: "Coins" };
  const CacheDefinitions = { getItem: (id) => ({ name: names[id], inventoryActions: id === 6 ? ["Pray-over", null, null, null, "Destroy"] : id === 1 || id === 4 ? ["Rub", null, null, null, "Destroy"] : [null, null, null, null, "Drop"] }) };
  const routingApi = { core: { CacheDefinitions, Bank: { BANK_SEARCH_TAB_INDEX: 9, getTabForItem: () => 0 } }, emitCanBankItem: (_p, it) => it.getId() !== 3 };
  const { restore, tally } = QuestCommand._test.routeRewards(routingApi, player);
  inventory.forceAdd(player, item(1, "Antique lamp"));
  inventory.add(item(2, "Tome of experience"));
  inventory.add(item(4, "Combat lamp"));
  inventory.add(item(5, "Oil lamp")); // a light source, not experience: banked
  inventory.add(item(6, "Blessed lamp")); // Pray-over: experience
  inventory.forceAdd(player, item(10, "Coins", 3));
  inventory.add(item(3, "Unbankable thing"));
  inventory.forceAdd(player, item(10, "Coins", 4)); // the bank holds 5: two go to the inventory
  restore();
  assert.deepEqual(tally, { banked: 6, skipped: 4 });
  assert.equal(bank.getAmount(5), 1);
  assert.equal(bank.getAmount(10), 5);
  assert.deepEqual(added, [[3, 1]]);
  assert.deepEqual(forced, [[10, 2]]);
  assert.equal(inventory.add, original.add);
  assert.equal(inventory.forceAdd, original.forceAdd);
});
