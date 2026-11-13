// Run after `yarn build`: node --test tests/ferocious-gloves.test.cjs
//
// The Lithkren Vault machinery and hydra leather (docs/ferocious-gloves.md), from the rsprox.net
// index: recordings 1527 and 722 (dormant), 1526 tick 817 (no hammer), 1527 ticks 19/38 and 1526
// tick 895 (menus, human_smithing, 4 ticks to human_casting and sound 140, 3 more to the swap), and
// 1521 (the leather's Inspect). A real Player and the real multiloc on varbit 6104.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const FerociousGloves = require("../plugins/items/FerociousGloves.plugin");

const { RECIPES, DORMANT, NO_HAMMER, INSPECT, CAST_TICK, DONE_TICK, SOUND, investigate, useOnMachine, inspectLeather } = FerociousGloves._test;
const DS2_VARBIT = 6104;
const DS2_COMPLETE = 215;

let core;
let prompts;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const api = PluginManager.createApi("FerociousGlovesTest");
  // Record the Yes/No menus instead of opening them.
  FerociousGloves.register(new Proxy(api, {
    get: (target, name) => name === "sendMultiChatboxPrompt"
      ? (player, title, ...pairs) => prompts.push({ player, title, pairs })
      : target[name],
  }));
});

const obj = (gameval) => core.CacheDefinitions.getObjId(gameval);
const loc = (gameval) => core.CacheDefinitions.getLocId(gameval);
const MACHINE = () => loc("ds2_lithkren_vault_machine01");

function fixture(t, { quest = DS2_COMPLETE, items = [] } = {}) {
  prompts = [];
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.getPacketSender().sendVarbit(DS2_VARBIT, quest);
  for (const [slot, gameval] of items) player.getInventory().setItem(slot, new core.Item(obj(gameval), 1));
  const boxes = [];
  t.mock.method(player.getDialogueManager(), "startDialogues", (chain) => {
    const first = chain.getDialogues().get(0);
    boxes.push({ text: first.getText?.(), item: first.getItemId?.() ?? null });
  });
  const animations = [];
  t.mock.method(player, "performAnimation", (animation) => animations.push(animation.getId()));
  const sounds = [];
  t.mock.method(player.getPacketSender(), "sendSound", (id) => { sounds.push(id); return player.getPacketSender(); });
  t.after(() => core.TaskManager.cancelTasks(player));
  return { player, boxes, animations, sounds, at: (slot) => player.getInventory().getItems()[slot]?.getId() ?? -1 };
}

function ticks(n) {
  for (let i = 0; i < n; i++) core.TaskManager.process();
}

function yes(prompt) {
  prompt.pairs[1](prompt.player, 1, prompt.pairs[0]);
}

test("the machine is the Investigate variant only once Dragon Slayer II is complete", (t) => {
  const done = fixture(t, { items: [[2, "hydra_leather"], [5, "hammer"]] });
  assert.equal(core.ObjectDefinition.forPlayer(MACHINE(), done.player).getInteractions()[0], "Investigate");
  assert.equal(investigate({ player: done.player, objectId: MACHINE() }), true);

  const before = fixture(t, { quest: 200, items: [[2, "hydra_leather"], [5, "hammer"]] });
  assert.equal(core.ObjectDefinition.forPlayer(MACHINE(), before.player).getName(), "Machinery");
  assert.equal(useOnMachine({ player: before.player, objectId: MACHINE() }), false, "the dormant pre-quest variant does nothing");
  assert.equal(prompts.length, 0);
});

test("with neither leather nor gloves the machine looks dormant (recs 1527, 722)", (t) => {
  const f = fixture(t, { items: [[5, "hammer"]] });
  investigate({ player: f.player, objectId: MACHINE() });
  assert.deepEqual(f.boxes.map((b) => b.text), [DORMANT]);
  assert.equal(prompts.length, 0);
});

test("leather without a hammer is refused (rec 1526 tick 817)", (t) => {
  const f = fixture(t, { items: [[2, "hydra_leather"]] });
  investigate({ player: f.player, objectId: MACHINE() });
  assert.deepEqual(f.boxes.map((b) => b.text), [NO_HAMMER]);
  assert.equal(prompts.length, 0);
});

test("making the gloves: menu, human_smithing, casting and sound at 4, the swap in place at 7 (recs 1526, 1527)", (t) => {
  const f = fixture(t, { items: [[2, "hydra_leather"], [5, "hammer"]] });
  useOnMachine({ player: f.player, objectId: MACHINE() });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].title, "Are sure you want to make some ferocious gloves?");
  assert.deepEqual([prompts[0].pairs[0], prompts[0].pairs[2]], ["Yes.", "No."]);
  yes(prompts[0]);
  assert.deepEqual(f.animations, [core.CacheDefinitions.getSeqId("human_smithing")]);
  ticks(CAST_TICK - 1);
  assert.deepEqual(f.sounds, []);
  ticks(1);
  assert.deepEqual(f.animations, [core.CacheDefinitions.getSeqId("human_smithing"), core.CacheDefinitions.getSeqId("human_casting")]);
  assert.deepEqual(f.sounds, [SOUND]);
  ticks(DONE_TICK - CAST_TICK - 1);
  assert.equal(f.at(2), obj("hydra_leather"), "nothing swapped before tick 7");
  f.player.getMovementQueue().reset();
  ticks(1);
  assert.equal(f.at(2), obj("ferocious_gloves"));
  assert.equal(f.at(5), obj("hammer"));
  assert.deepEqual(f.boxes, [{ text: RECIPES[0].done, item: obj("ferocious_gloves") }]);
});

test("reverting the gloves gives the leather back in the same slot (rec 1527 tick 19)", (t) => {
  const f = fixture(t, { items: [[2, "ferocious_gloves"], [5, "hammer"]] });
  investigate({ player: f.player, objectId: MACHINE() });
  assert.equal(prompts[0].title, "Would you like to revert your ferocious gloves into hydra leather?");
  yes(prompts[0]);
  ticks(DONE_TICK);
  assert.equal(f.at(2), obj("hydra_leather"));
  assert.deepEqual(f.boxes.map((b) => b.text), [RECIPES[1].done]);
});

test("No, or the leather gone before the swap, changes nothing", (t) => {
  const f = fixture(t, { items: [[2, "hydra_leather"], [5, "hammer"]] });
  investigate({ player: f.player, objectId: MACHINE() });
  prompts[0].pairs[3](f.player, 2, "No.");
  ticks(DONE_TICK);
  assert.equal(f.at(2), obj("hydra_leather"));
  assert.deepEqual(f.animations, []);

  investigate({ player: f.player, objectId: MACHINE() });
  yes(prompts[1]);
  f.player.getInventory().delete(obj("hydra_leather"), 1);
  ticks(DONE_TICK);
  assert.equal(f.player.getInventory().contains(obj("ferocious_gloves")), false);
  assert.deepEqual(f.boxes, []);
});

test("a second Yes while the machine runs does not start another", (t) => {
  const f = fixture(t, { items: [[2, "hydra_leather"], [3, "hydra_leather"], [5, "hammer"]] });
  investigate({ player: f.player, objectId: MACHINE() });
  investigate({ player: f.player, objectId: MACHINE() });
  yes(prompts[0]);
  yes(prompts[1]);
  ticks(DONE_TICK);
  assert.equal(f.at(2), obj("ferocious_gloves"));
  assert.equal(f.at(3), obj("hydra_leather"));
});

test("hydra leather's Inspect shows the leather with its line (rec 1521)", (t) => {
  const f = fixture(t);
  inspectLeather({ player: f.player, itemId: obj("hydra_leather") });
  assert.deepEqual(f.boxes, [{ text: INSPECT, item: obj("hydra_leather") }]);
});
