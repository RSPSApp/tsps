// Run after `yarn build`: node --test tests/quest-command.test.cjs
process.env.BROWSER_HOST = "1"; // Offline owners must not start WorldAdmin.
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

test("real reward owners preserve noted bank identity and miniquest overflow", async (t) => {
  const path = require("node:path");
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const player = new Player(new PlayerSession({ kind: "test", remoteAddress: "127.0.0.1",
    isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} }));
  player.setUsername("questrewardtest");
  player.setIndex(9901);
  player.setAttribute("bot-skip-persistence", true);
  const inventory = player.getInventory();
  const original = { add: inventory.add, forceAdd: inventory.forceAdd };
  const routingApi = { core, emitCanBankItem: () => true };
  const bankAmount = id => player.getBanks().reduce((sum, bank, tab) =>
    tab === core.Bank.BANK_SEARCH_TAB_INDEX ? sum : sum + bank.getAmount(id), 0);
  const ground = core.World.getItems();
  const originalGround = new Set(ground);
  const clear = () => { inventory.resetItems(); for (const bank of player.getBanks()) bank.resetItems(); };
  try {
    await t.test("normal deposit and routed notes merge into the same base stack with exact overflow tally", () => {
      const base = core.ItemIdentifiers.MITHRIL_ORE;
      const note = core.ItemDefinition.forId(base).getNoteId();
      inventory.add(new core.Item(note, 10), false);
      inventory.switchItems(player.getBank(0), new core.Item(note, 10), false, false);
      assert.equal(bankAmount(base), 10, "normal deposit control");
      const reward = new core.Item(note, 5);
      let routing = QuestCommand._test.routeRewards(routingApi, player);
      try { inventory.add(reward, false); } finally { routing.restore(); }
      assert.equal(bankAmount(base), 15);
      assert.equal(bankAmount(note), 0);
      assert.equal(routing.tally.banked, 5);
      assert.equal(reward.getId(), note, "caller retains noted identity");
      clear();
      player.getBank(0).add(new core.Item(base, 2147483645), false);
      routing = QuestCommand._test.routeRewards(routingApi, player);
      try { inventory.forceAdd(player, new core.Item(note, 5)); } finally { routing.restore(); }
      assert.equal(bankAmount(base), 2147483647);
      assert.equal(bankAmount(note), 0);
      assert.equal(inventory.getAmount(note), 3, "remainder stays noted");
      assert.equal(routing.tally.banked, 2);
    });
    clear();
    await t.test("full real bank and inventory retain every remaining treasure on the ground once", () => {
      const hooks = new Map();
      let command;
      const commandApi = new Proxy({ ...routingApi,
        registerCommand: (_name, fn) => { command = fn; },
        onCustomEvent: (name, fn) => hooks.set(name, [...(hooks.get(name) || []), fn]),
        emitCustomEvent: (name, request) => { for (const fn of hooks.get(name) || []) fn(request); },
      }, { get: (target, key) => key in target ? target[key] : () => {} });
      const making = QuestRuntime.registerQuest(commandApi, { key: "making_history", name: "Making History",
        varpId: 604, completionValue: 5, questPoints: 3 });
      require("../plugins/quests/makinghistory/EnchantedKey.MakingHistory")(commandApi, making);
      QuestCommand.register(commandApi);
      for (const quest of QuestRuntime.getRegisteredQuests()) quest.setStage(player, quest.completionValue);
      const capacity = core.Bank.getCapacity(player);
      player.getBank(0).setItems(Array.from({ length: capacity }, (_, slot) => new core.Item(1277, 1).setMeta({ slot })));
      inventory.setItems(Array.from({ length: 28 }, () => new core.Item(1277, 1)));
      assert.equal(core.Bank.freeSlots(player), 0);
      assert.equal(inventory.getFreeSlots(), 0);
      const { sites } = require("../plugins/quests/makinghistory/data/enchanted-key.json");
      const expected = new Map();
      for (const site of sites) for (const reward of site.rewards) {
        const base = core.ItemIdentifiers[reward.item];
        const id = reward.noted ? core.ItemDefinition.forId(base).getNoteId() : base;
        expected.set(id, (expected.get(id) || 0) + reward.amount);
      }
      const runAll = () => command({ player, parts: ["quest", "all"] });
      runAll();
      assert.equal(player.getAttribute("enchanted-key:treasures-found"), sites.length);
      const awarded = ground.filter(item => !originalGround.has(item));
      for (const [id, amount] of expected) {
        assert.equal(awarded.filter(item => item.getItem().getId() === id)
          .reduce((sum, item) => sum + item.getItem().getAmount(), 0), amount, `preserved reward ${id}`);
        assert.equal(bankAmount(id) + inventory.getAmount(id), 0);
      }
      assert.ok(awarded.every(item => item.getOwner() === player.getUsername()));
      const quantities = awarded.map(item => item.getItem().getAmount());
      runAll();
      assert.equal(ground.filter(item => !originalGround.has(item)).length, awarded.length);
      assert.deepEqual(awarded.map(item => item.getItem().getAmount()), quantities);
      assert.equal(inventory.add, original.add);
      assert.equal(inventory.forceAdd, original.forceAdd);
    });
  } finally {
    inventory.add = original.add;
    inventory.forceAdd = original.forceAdd;
    for (let i = ground.length - 1; i >= 0; i--) if (!originalGround.has(ground[i])) ground.splice(i, 1);
    player.getDialogueManager().reset();
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
    player.setRegistered(false);
  }
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
    setAmount(n) { this.amount = n; return this; }, setId(n) { this.id = n; return this; },
    clone() { return item(this.id, name, this.amount); },
    getDefinition() { return { getName: () => name, unNote: () => this.id }; },
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
  inventory.add(item(21760, "Kharedst's memoirs")); // in the Book of the Dead: not given
  inventory.add(item(21766, "History and Hearsay"));
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
