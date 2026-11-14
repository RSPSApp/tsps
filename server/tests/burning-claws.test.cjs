// Run after `yarn build`: node --test tests/burning-claws.test.cjs
//
// rsprox captures 1756 (rev 227, tick 7068) and 3327 (rev 235, tick 78): a Burning claw used on
// another swaps the pair for Burning claws on the same tick, in the first free slot, with
// human_crafting_bone_claws, synth sound 2694 (delay 8) and the objectbox text. A claw used on its
// own slot does nothing (1756 tick 5549).
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");

const BurningClaws = require("../plugins/items/BurningClaws.plugin");

before(async () => {
  await CachePipeline.initialize(process.cwd());
  BurningClaws.register(PluginManager.createApi("BurningClawsTest"));
});

function fixture(t, slots) {
  const player = new Player(null);
  const sounds = [];
  const animations = [];
  const dialogues = [];
  const messages = [];
  t.mock.method(player, "getPacketSender", () => new Proxy({}, {
    get: (_target, key) => key === "sendSoundEffect"
      ? (...args) => { sounds.push(args); return this; }
      : () => undefined,
  }));
  t.mock.method(player, "performAnimation", (animation) => animations.push(animation.getId()));
  t.mock.method(player, "sendMessage", (text) => messages.push(text));
  t.mock.method(player.getDialogueManager(), "startDialogues", (chain) => dialogues.push(chain));
  const items = player.getInventory().getItems();
  for (const [slot, id] of Object.entries(slots)) items[slot] = new Item(id, 1);
  return { player, items, sounds, animations, dialogues, messages };
}

function firstDialogue(chain) {
  return [...chain.getDialogues().values()].find((entry) => entry instanceof ItemStatementDialogue);
}

test("the cache names both items as the plugin expects", () => {
  assert.equal(ItemDefinition.forId(I.BURNING_CLAW).getName(), "Burning claw");
  assert.equal(ItemDefinition.forId(I.BURNING_CLAWS).getName(), "Burning claws");
  assert.equal(CacheDefinitions.getObjId("bone_claw"), I.BURNING_CLAW);
  assert.equal(CacheDefinitions.getObjId("bone_claws"), I.BURNING_CLAWS);
});

test("one claw on another makes Burning claws in the first free slot, with the captured feedback", (t) => {
  const f = fixture(t, { 0: I.SHARK, 1: I.SHARK, 2: I.SHARK, 3: I.SHARK, 4: I.BURNING_CLAW, 5: I.BURNING_CLAW });
  UseItemPacketListener.itemOnItem(f.player, 5, 4);
  assert.equal(f.items[4]?.getId(), I.BURNING_CLAWS);
  assert.ok(!f.items[5] || f.items[5].getId() < 0 || f.items[5].getAmount() <= 0, "the other claw is gone");
  assert.equal(f.player.getInventory().getAmount(I.BURNING_CLAW), 0);
  assert.equal(f.player.getInventory().getAmount(I.BURNING_CLAWS), 1);
  assert.deepEqual(f.animations, [CacheDefinitions.getSeqId("human_crafting_bone_claws")]);
  assert.equal(f.sounds.length, 1);
  assert.equal(f.sounds[0][0], 2694);
  assert.equal(f.sounds[0][2], 8);
  assert.equal(f.dialogues.length, 1);
  assert.deepEqual(f.messages, []);
});

test("the claws land in an earlier free slot, not the clicked one (3327: 14 on 18 gave slot 6)", (t) => {
  const slots = {};
  for (let slot = 0; slot < 6; slot++) slots[slot] = I.SHARK;
  slots[14] = I.BURNING_CLAW;
  slots[18] = I.BURNING_CLAW;
  const f = fixture(t, slots);
  UseItemPacketListener.itemOnItem(f.player, 14, 18);
  assert.equal(f.items[6]?.getId(), I.BURNING_CLAWS);
  for (const slot of [14, 18]) assert.ok(!f.items[slot] || f.items[slot].getId() < 0, `slot ${slot} emptied`);
});

test("the item box shows the claws with the captured text", (t) => {
  const f = fixture(t, { 0: I.BURNING_CLAW, 1: I.BURNING_CLAW });
  UseItemPacketListener.itemOnItem(f.player, 0, 1);
  assert.equal(f.dialogues.length, 1);
  const box = firstDialogue(f.dialogues[0]);
  assert.ok(box, "an item statement is queued");
  assert.equal(box.getText(), "You bring the two claws together and combine them.");
  assert.equal(box.getItemId(), I.BURNING_CLAWS);
});

test("a claw on its own slot changes nothing and says nothing", (t) => {
  const f = fixture(t, { 5: I.BURNING_CLAW });
  UseItemPacketListener.itemOnItem(f.player, 5, 5);
  assert.equal(f.items[5]?.getId(), I.BURNING_CLAW);
  assert.deepEqual(f.animations, []);
  assert.deepEqual(f.sounds, []);
  assert.deepEqual(f.dialogues, []);
  assert.deepEqual(f.messages, []);
});
