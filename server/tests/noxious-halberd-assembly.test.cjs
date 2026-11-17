// Run after `yarn build`: node --test tests/noxious-halberd-assembly.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Skill } = require("../dist/game/model/Skill");
const { TaskManager } = require("../dist/game/task/TaskManager");
const NoxiousHalberd = require("../plugins/items/NoxiousHalberd.plugin");

let api;
let pieces;
let halberd;
before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  api = PluginManager.createApi("NoxiousHalberdAssemblyTest");
  NoxiousHalberd.register(api);
  pieces = NoxiousHalberd._test.resolve().map(({ id }) => id);
  halberd = api.core.ItemIdentifiers.NOXIOUS_HALBERD;
});

function fakePlayer({ crafting = 72, smithing = 72, items = [] } = {}) {
  const inventory = [...items];
  const levels = { crafting, smithing };
  const messages = [];
  const xp = [];
  const animations = [];
  const sounds = [];
  let chain;
  const player = {
    get inventory() { return inventory; },
    messages,
    xp,
    animations,
    sounds,
    performAnimation: (animation) => animations.push(animation.getId()),
    getPacketSender: () => ({ sendSoundEffect: (...args) => sounds.push(args) }),
    setLevel: (skill, value) => { levels[skill === Skill.CRAFTING ? "crafting" : "smithing"] = value; },
    getSkillManager: () => ({
      getCurrentLevel: (skill) => skill === Skill.CRAFTING ? levels.crafting : levels.smithing,
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getInventory: () => ({
      contains: (id) => inventory.includes(id),
      deleteNumber: (id) => inventory.splice(inventory.indexOf(id), 1),
      adds: (id) => inventory.push(id),
    }),
    sendMessage: (message) => messages.push(message),
    getDialogueManager: () => ({ startDialogues: (value) => { chain = value; } }),
    get chain() { return chain; },
  };
  return player;
}

const ticks = (n) => { for (let i = 0; i < n; i++) TaskManager.process(); };

test("any two pieces report the missing one; low boosted skill levels are refused", () => {
  const player = fakePlayer({ items: pieces.slice(0, 2) });
  assert.equal(NoxiousHalberd._test.combine({ player, usedItemId: pieces[0], usedWithItemId: pieces[1] }), true);
  assert.deepEqual(player.messages, ["Creating a noxious halberd requires at least one noxious pommel."]);
  const low = fakePlayer({ crafting: 71, items: pieces });
  NoxiousHalberd._test.combine({ player: low, usedItemId: pieces[0], usedWithItemId: pieces[2] });
  assert.deepEqual(low.messages, ["Creating a Noxious Halberd requires level 72 crafting & smithing."]);
  assert.deepEqual(low.inventory, pieces);
});

test("Yes animates a tick later, then consumes all pieces once, creates the halberd, and gives both XP rewards", (t) => {
  const player = fakePlayer({ items: [...pieces] });
  t.after(() => TaskManager.cancelTasks(player));
  const original = api.sendMultiChatboxPrompt;
  let prompt;
  api.sendMultiChatboxPrompt = (_player, question, ...options) => { prompt = { question, options }; };
  try {
    assert.equal(NoxiousHalberd._test.combine({ player, usedItemId: pieces[1], usedWithItemId: pieces[0] }), true);
    const warning = player.chain.getDialogues().get(0);
    assert.match(warning.getText(), /This process is non-reversible/);
    assert.deepEqual(warning.getItemIds(), [pieces[1], pieces[0]]);
    player.chain.getDialogues().get(1).send(player);
    assert.equal(prompt.question, "Do you wish to create a noxious halberd?");
    prompt.options[3]();
    assert.deepEqual(player.inventory, pieces, "No leaves all pieces untouched");
    prompt.options[1]();
    assert.deepEqual(player.inventory, pieces, "nothing changes on the click");
    ticks(1);
    const { CacheDefinitions } = api.core;
    const sequence = CacheDefinitions.getSeqId(NoxiousHalberd._test.SEQUENCE);
    assert.notEqual(sequence, null, "the captured sequence is in the cache");
    assert.deepEqual(player.animations, [sequence]);
    ticks(2);
    assert.deepEqual(player.inventory, pieces, "still assembling");
    ticks(1);
    assert.deepEqual(player.inventory, [halberd]);
    assert.deepEqual(player.xp, [[Skill.CRAFTING, 100], [Skill.SMITHING, 100]]);
    assert.deepEqual(player.sounds, [[NoxiousHalberd._test.SOUND, 1, 0, 255]]);
    const box = player.chain.getDialogues().get(0);
    assert.deepEqual([box.getItemId(), box.getText()], [halberd, "You successfully create a noxious halberd."]);
    ticks(5);
    assert.deepEqual(player.inventory, [halberd], "made once");
  } finally {
    api.sendMultiChatboxPrompt = original;
  }
});

test("the final Yes rechecks requirements before consuming pieces", () => {
  const player = fakePlayer({ items: [...pieces] });
  const original = api.sendMultiChatboxPrompt;
  let options;
  api.sendMultiChatboxPrompt = (_player, _question, ...value) => { options = value; };
  try {
    NoxiousHalberd._test.combine({ player, usedItemId: pieces[0], usedWithItemId: pieces[1] });
    player.chain.getDialogues().get(1).send(player);
    player.setLevel(Skill.CRAFTING, 71);
    options[1]();
    assert.deepEqual(player.inventory, pieces);
    assert.deepEqual(player.messages, ["Creating a Noxious Halberd requires level 72 crafting & smithing."]);
  } finally {
    api.sendMultiChatboxPrompt = original;
  }
});

test("a piece removed or a boost lost during the assembly makes nothing", (t) => {
  const player = fakePlayer({ items: [...pieces] });
  t.after(() => TaskManager.cancelTasks(player));
  NoxiousHalberd._test.assemble(player);
  ticks(2);
  player.inventory.pop();
  ticks(2);
  assert.deepEqual(player.inventory, pieces.slice(0, 2));
  assert.deepEqual(player.xp, []);
  const low = fakePlayer({ items: [...pieces] });
  t.after(() => TaskManager.cancelTasks(low));
  NoxiousHalberd._test.assemble(low);
  ticks(3);
  low.setLevel(Skill.SMITHING, 71);
  ticks(1);
  assert.deepEqual(low.inventory, pieces);
  assert.deepEqual(low.xp, []);
});

test("recipe hook item names come from the cache", () => {
  assert.deepEqual(pieces.map((id) => CacheDefinitions.getItem(id).name), ["Noxious point", "Noxious blade", "Noxious pommel"]);
});
