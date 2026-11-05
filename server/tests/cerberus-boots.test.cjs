// Run after `yarn build`: node --test tests/cerberus-boots.test.cjs
//
// Eternal boots follow the rsprox capture 1521 (rev 224.1, cycles 107-126): a confirmation box,
// a Proceed / Cancel menu, and one tick after Proceed the success box with sequence 4462,
// spotanim 759, the boots in the inventory and 200 xp in Magic and Runecraft. Pegasian and
// Primordial use the same template with their own item names (inferred, not captured).
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();

const { Skill } = require("../dist/game/model/Skill");
const { Item } = require("../dist/game/model/Item");
const { Animation } = require("../dist/game/model/Animation");
const { Graphic } = require("../dist/game/model/Graphic");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { DialogueChainBuilder } = require("../dist/game/model/dialogues/builders/DialogueChainBuilder");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { DoubleItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/DoubleItemStatementDialogue");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");
const { EndDialogue } = require("../dist/game/model/dialogues/entries/impl/EndDialogue");

const PegasianBoots = require("../plugins/items/PegasianBoots.plugin");

const ANIMATION = 4462;
const SPOTANIM = 759;

class FakeTask {
  constructor(delay) { this.delay = delay; }
  stop() { this.stopped = true; }
}

const tasks = [];
const registrations = [];
const api = new Proxy({
  core: {
    Item, Skill, Animation, Graphic, ItemIdentifiers: I, Task: FakeTask,
    TaskManager: { submit: (task) => tasks.push(task) },
    DialogueChainBuilder, ItemStatementDialogue, DoubleItemStatementDialogue, ActionDialogue, EndDialogue,
  },
  onItemOnItem(first, second, handler, filter) {
    registrations.push({ first, second, handler, filter });
  },
  sendMultiChatboxPrompt(player, title, ...pairs) {
    player.prompt = {
      title,
      options: pairs.filter((_, i) => i % 2 === 0),
      callbacks: pairs.filter((_, i) => i % 2 === 1),
    };
    return true;
  },
}, { get: (target, property) => (property in target ? target[property] : () => {}) });
PegasianBoots.register(api);

const BOOTS = [
  { name: "pegasian", crystal: I.PEGASIAN_CRYSTAL, base: I.RANGER_BOOTS, result: I.PEGASIAN_BOOTS,
    names: ["Ranger boots", "Pegasian crystal", "Pegasian boots"] },
  { name: "primordial", crystal: I.PRIMORDIAL_CRYSTAL, base: I.DRAGON_BOOTS, result: I.PRIMORDIAL_BOOTS,
    names: ["Dragon boots", "Primordial crystal", "Primordial boots"] },
  { name: "eternal", crystal: I.ETERNAL_CRYSTAL, base: I.INFINITY_BOOTS, result: I.ETERNAL_BOOTS,
    names: ["Infinity boots", "Eternal crystal", "Eternal boots"] },
];

const confirmText = ([base, crystal, result]) =>
  `Are you sure you wish to infuse the ${base} and ${crystal} to create ${result}? This can not be reversed.`;
const successText = ([base, crystal, result]) =>
  `You successfully infuse the ${base} and ${crystal} to create ${result}.`;

function createInventory(ids) {
  const slots = ids.map((id) => new Item(id, 1));
  return {
    slots,
    get amounts() {
      const totals = new Map();
      for (const entry of slots) if (entry) totals.set(entry.getId(), (totals.get(entry.getId()) ?? 0) + entry.getAmount());
      return totals;
    },
    getItems: () => slots,
    getAmount: (id) => slots.reduce((sum, entry) => sum + (entry && entry.getId() === id ? entry.getAmount() : 0), 0),
    deleteNumber(id) {
      const at = slots.findIndex((entry) => entry && entry.getId() === id);
      if (at >= 0) slots[at] = null;
    },
    deleteAtSlot(slot) { slots[slot] = null; },
    addItem(item) { slots.push(item); },
  };
}

function createPlayer(ids, { magic = 60, runecraft = 60 } = {}) {
  const inventory = createInventory(ids);
  const levels = new Map([[Skill.MAGIC, magic], [Skill.RUNECRAFTING, runecraft]]);
  const player = {
    inventory,
    xp: [],
    messages: [],
    chains: [],
    animations: [],
    graphics: [],
    removals: 0,
    prompt: null,
    getInventory: () => inventory,
    getSkillManager: () => ({
      getMaxLevel: (skill) => levels.get(skill) ?? 1,
      // A boost must not satisfy the requirement: the current level is always high.
      getCurrentLevel: () => 99,
      addExperiences(skill, amount) { player.xp.push([skill, amount]); },
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.chains.push(chain) }),
    getPacketSender: () => ({ sendInterfaceRemoval() { player.removals++; } }),
    performAnimation: (animation) => player.animations.push(animation),
    performGraphic: (graphic) => player.graphics.push(graphic),
    sendMessage: (message) => player.messages.push(message),
  };
  return player;
}

function findHook(usedId, withId) {
  const used = ItemDefinition.forId(usedId).getName();
  const target = ItemDefinition.forId(withId).getName();
  return registrations.find((r) =>
    (r.first === used && r.second === target) || (r.first === target && r.second === used));
}

// Dispatch the way PluginManager does: find the hook registered for the two item names.
function use(player, usedId, withId) {
  const hook = findHook(usedId, withId);
  assert.ok(hook, `no onItemOnItem hook registered for item ${usedId} + ${withId}`);
  assert.equal(hook.filter?.noted, false, "combine must not accept noted items");
  const items = player.inventory.slots;
  const usedItem = items.find((entry) => entry && entry.getId() === usedId);
  const usedWithItem = items.find((entry) => entry && entry.getId() === withId);
  hook.handler({ player, usedItem, usedItemId: usedId, usedWithItem, usedWithItemId: withId });
}

function sorted(inventory) {
  return [...inventory.amounts.entries()].sort((a, b) => a[0] - b[0]);
}

function entries(chain) {
  return [...chain.getDialogues().values()];
}

/** Use the items, click through the confirmation box so the menu shows. */
function openMenu(player, boots) {
  tasks.length = 0;
  use(player, boots.crystal, boots.base);
  assert.equal(player.chains.length, 1, "using the items opens the confirmation box");
  const [box, action] = entries(player.chains[0]);
  assert.ok(box instanceof DoubleItemStatementDialogue);
  assert.ok(action instanceof ActionDialogue, "the menu follows the box");
  action.send(player);
  assert.ok(player.prompt, "the Proceed / Cancel menu is shown");
  return { box };
}

function runTasks() {
  while (tasks.length) tasks.shift().execute();
}

for (const boots of BOOTS) {
  test(`${boots.name}: using the items asks first and consumes nothing`, () => {
    const player = createPlayer([boots.crystal, boots.base]);
    const { box } = openMenu(player, boots);
    assert.deepEqual(box.getItemIds(), [boots.base, boots.crystal]);
    assert.equal(box.getText(), confirmText(boots.names));
    assert.equal(player.prompt.title, "Select an option");
    assert.deepEqual(player.prompt.options, ["Proceed with the infusion.", "Cancel."]);
    assert.deepEqual(sorted(player.inventory), sorted(createInventory([boots.crystal, boots.base])));
    assert.deepEqual(player.xp, []);
    assert.equal(tasks.length, 0);
  });

  test(`${boots.name}: dispatch works with the items used the other way round`, () => {
    const player = createPlayer([boots.crystal, boots.base]);
    use(player, boots.base, boots.crystal);
    assert.equal(player.chains.length, 1);
  });

  test(`${boots.name}: Cancel consumes nothing`, () => {
    const player = createPlayer([boots.crystal, boots.base]);
    openMenu(player, boots);
    player.prompt.callbacks[1]();
    runTasks();
    assert.deepEqual(sorted(player.inventory), sorted(createInventory([boots.crystal, boots.base])));
    assert.deepEqual(player.xp, []);
    assert.deepEqual(player.animations, []);
    assert.ok(player.removals >= 1, "the menu is closed");
  });

  test(`${boots.name}: Proceed infuses on the next tick with the captured effects`, () => {
    const player = createPlayer([boots.crystal, boots.base]);
    openMenu(player, boots);
    player.prompt.callbacks[0]();
    assert.deepEqual(sorted(player.inventory), sorted(createInventory([boots.crystal, boots.base])),
      "nothing happens until the next tick");
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].delay, 1);
    runTasks();
    assert.deepEqual(sorted(player.inventory), [[boots.result, 1]]);
    assert.deepEqual(player.xp, [[Skill.MAGIC, 200], [Skill.RUNECRAFTING, 200]]);
    assert.equal(player.animations.length, 1);
    assert.equal(player.animations[0].getId(), ANIMATION);
    assert.equal(player.graphics.length, 1);
    assert.equal(player.graphics[0].getId(), SPOTANIM);
    assert.equal(player.chains.length, 2);
    const success = entries(player.chains[1])[0];
    assert.ok(success instanceof ItemStatementDialogue);
    assert.equal(success.getItemId(), boots.result);
    assert.equal(success.getText(), successText(boots.names));
  });

  test(`${boots.name}: a stale Proceed clicked twice infuses once`, () => {
    const player = createPlayer([boots.crystal, boots.base]);
    openMenu(player, boots);
    const proceed = player.prompt.callbacks[0];
    proceed();
    proceed();
    runTasks();
    assert.deepEqual(sorted(player.inventory), [[boots.result, 1]]);
    assert.equal(player.xp.length, 2);
  });

  for (const [label, drop] of [["crystal", boots.crystal], ["base boots", boots.base]]) {
    test(`${boots.name}: the ${label} dropped after the prompt is re-checked at Proceed`, () => {
      const player = createPlayer([boots.crystal, boots.base]);
      openMenu(player, boots);
      player.inventory.deleteNumber(drop, 1);
      const left = sorted(player.inventory);
      player.prompt.callbacks[0]();
      runTasks();
      assert.deepEqual(sorted(player.inventory), left, "nothing is consumed or created");
      assert.deepEqual(player.xp, []);
      assert.deepEqual(player.animations, []);
      assert.equal(player.chains.length, 1, "no success box");
    });

    test(`${boots.name}: the ${label} dropped between Proceed and the tick is re-checked`, () => {
      const player = createPlayer([boots.crystal, boots.base]);
      openMenu(player, boots);
      player.prompt.callbacks[0]();
      player.inventory.deleteNumber(drop, 1);
      const left = sorted(player.inventory);
      runTasks();
      assert.deepEqual(sorted(player.inventory), left);
      assert.deepEqual(player.xp, []);
      assert.deepEqual(player.animations, []);
    });
  }

  for (const [label, levels] of [
    ["Magic 59", { magic: 59, runecraft: 60 }],
    ["Runecraft 59", { magic: 60, runecraft: 59 }],
  ]) {
    test(`${boots.name}: ${label} is refused with a message and nothing is consumed`, () => {
      const player = createPlayer([boots.crystal, boots.base], levels);
      tasks.length = 0;
      use(player, boots.crystal, boots.base);
      assert.deepEqual(sorted(player.inventory), sorted(createInventory([boots.crystal, boots.base])));
      assert.deepEqual(player.xp, []);
      assert.equal(player.chains.length, 0);
      assert.equal(tasks.length, 0);
      assert.equal(player.messages.length, 1);
      assert.match(player.messages[0], /60/);
    });
  }

  for (const [label, held] of [["crystal", [boots.base]], ["base boots", [boots.crystal]]]) {
    test(`${boots.name}: missing ${label} consumes nothing`, () => {
      const player = createPlayer(held);
      tasks.length = 0;
      use(player, boots.crystal, boots.base);
      assert.deepEqual(sorted(player.inventory), sorted(createInventory(held)));
      assert.deepEqual(player.xp, []);
      assert.equal(player.chains.length, 0);
      assert.equal(tasks.length, 0);
    });
  }
}

test("a crystal is not registered against another pair's base boots", () => {
  assert.equal(findHook(I.PRIMORDIAL_CRYSTAL, I.INFINITY_BOOTS), undefined);
  assert.equal(findHook(I.ETERNAL_CRYSTAL, I.DRAGON_BOOTS), undefined);
});
