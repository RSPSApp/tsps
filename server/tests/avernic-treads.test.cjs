// Run after `yarn build`: node --test tests/avernic-treads.test.cjs
//
// Avernic treads take primordial, eternal and pegasian boots one pair at a time for 4,000 demon
// tears each (Wiki: Avernic treads) and Dismantle gives the treads and every pair back. The
// dismantle prompt text and the Dismantle option on the (max) treads come from rsprox capture 3360
// (rev 235): "Are you sure you wish to dismantle your avernic treads (max)?" / "Yes.|No.".
// No capture shows boots being added, so the add flow has no confirmation and no message of ours
// beyond the refusals. Everything goes through the real PluginManager hooks, the real preset
// producer (Presets.PvpMode spawnPresetItem) and the real MultiChatboxPrompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const Presets = require("../plugins/modes/pvp/Presets.PvpMode");

const TEARS_PER_PAIR = 4000;
const TREADS = 31088;
const TREADS_PR = 31091;
const TREADS_PE = 31092;
const TREADS_ET = 31093;
const TREADS_PR_PE = 31094;
const TREADS_MAX = 31097;
const BONES = 526;
const LMS_TREADS = 33172;
const TREADS_PR_ET = 31095;
const TREADS_PE_ET = 31096;

let core;
let I;
let next = 3900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
});

function actor(t, { magic = 80, runecraft = 60, currentMagic = magic, currentRunecraft = runecraft } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("treads" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3234, 3222, 0));
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevels(core.Skill.MAGIC, magic, false);
  player.getSkillManager().setMaxLevels(core.Skill.RUNECRAFTING, runecraft, false);
  player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, currentMagic, false);
  player.getSkillManager().setCurrentLevel(core.Skill.RUNECRAFTING, currentRunecraft, false);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function preset(item) {
  assert.equal(Presets.isEnabled(), true, "the Presets plugin is registered");
  const made = Presets._test.spawnPresetItem(item, Presets.getGlobalPresetPool()[0]);
  assert.equal(made.isPresetItem(), true, "the producer marked the item");
  return made;
}

const real = (id, amount = 1) => new core.Item(id, amount);
const tears = (amount) => real(I.DEMON_TEAR, amount);
const held = (player) => player.getInventory().getItems().filter((item) => item && item.getId() > 0);
const sortedIds = (list) => [...list].sort((a, b) => a - b);
const ids = (player) => sortedIds(held(player).map((item) => item.getId()));
const tearCount = (player) => player.getInventory().getAmount(I.DEMON_TEAR);
const xp = (player, skill) => player.getSkillManager().getExperience(skill);
const pending = (player) => core.MultiChatboxPrompt.getPending(player);

function give(player, ...items) {
  for (const item of items) player.getInventory().add(item, false);
}

function slotOfId(player, id) {
  const slot = player.getInventory().getItems().findIndex((item) => item && item.getId() === id);
  assert.ok(slot >= 0, "item " + id + " is in the inventory");
  return slot;
}

function useOn(player, usedId, targetId) {
  const usedSlot = slotOfId(player, usedId);
  const targetSlot = slotOfId(player, targetId);
  const used = player.getInventory().getItems()[usedSlot];
  const target = player.getInventory().getItems()[targetSlot];
  return PluginManager.emitItemOnItem({
    player, usedItem: used, usedItemId: used.getId(), usedItemSlot: usedSlot,
    usedWithItem: target, usedWithItemId: target.getId(), usedWithItemSlot: targetSlot, handled: false,
  });
}

function dismantle(player, itemId) {
  const slot = slotOfId(player, itemId);
  const item = player.getInventory().getItems()[slot];
  const index = core.CacheDefinitions.getItem(itemId).inventoryActions.indexOf("Dismantle");
  assert.ok(index >= 0, "the cache gives the treads a Dismantle option");
  return PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item, itemId, slot,
    clickType: index + 1, option: "Dismantle", handled: false,
  });
}

function answer(player, number) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

const BOOTS = [
  { name: "primordial", boots: () => I.PRIMORDIAL_BOOTS, only: TREADS_PR },
  { name: "pegasian", boots: () => I.PEGASIAN_BOOTS, only: TREADS_PE },
  { name: "eternal", boots: () => I.ETERNAL_BOOTS, only: TREADS_ET },
];

for (const entry of BOOTS) {
  test(`${entry.name} boots on the treads: the matching state, one pair of boots and 4,000 tears go`, (t) => {
    const { player } = actor(t);
    give(player, real(TREADS), real(entry.boots()), tears(TEARS_PER_PAIR + 25));
    const magic = xp(player, core.Skill.MAGIC);
    const runecraft = xp(player, core.Skill.RUNECRAFTING);
    useOn(player, entry.boots(), TREADS);
    assert.equal(xp(player, core.Skill.MAGIC) - magic, 200, "200 Magic xp (Wiki recipe)");
    assert.equal(xp(player, core.Skill.RUNECRAFTING) - runecraft, 200, "200 Runecraft xp (Wiki recipe)");
    assert.deepEqual(ids(player), sortedIds([entry.only, I.DEMON_TEAR]));
    assert.equal(tearCount(player), 25);
  });
}

test("all three pairs in turn make the (max) treads and cost 12,000 tears", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS), real(I.ETERNAL_BOOTS), real(I.PRIMORDIAL_BOOTS), real(I.PEGASIAN_BOOTS), tears(12000));
  useOn(player, I.PRIMORDIAL_BOOTS, TREADS);
  useOn(player, I.PEGASIAN_BOOTS, TREADS_PR);
  assert.deepEqual(ids(player), sortedIds([TREADS_PR_PE, I.ETERNAL_BOOTS, I.DEMON_TEAR]));
  useOn(player, I.ETERNAL_BOOTS, TREADS_PR_PE);
  assert.deepEqual(ids(player), [TREADS_MAX]);
  assert.equal(tearCount(player), 0);
});

test("fewer than 4,000 tears: nothing is consumed", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS), real(I.PRIMORDIAL_BOOTS), tears(TEARS_PER_PAIR - 1));
  useOn(player, I.PRIMORDIAL_BOOTS, TREADS);
  assert.deepEqual(ids(player), sortedIds([TREADS, I.PRIMORDIAL_BOOTS, I.DEMON_TEAR]));
  assert.equal(tearCount(player), TEARS_PER_PAIR - 1);
});

test("below 80 Magic or 60 Runecraft: nothing is consumed", (t) => {
  for (const levels of [{ magic: 79 }, { runecraft: 59 }]) {
    const { player } = actor(t, levels);
    give(player, real(TREADS), real(I.PRIMORDIAL_BOOTS), tears(TEARS_PER_PAIR));
    useOn(player, I.PRIMORDIAL_BOOTS, TREADS);
    assert.deepEqual(ids(player), sortedIds([TREADS, I.PRIMORDIAL_BOOTS, I.DEMON_TEAR]));
    assert.equal(tearCount(player), TEARS_PER_PAIR);
  }
});

test("a pair already added is not added twice", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS_PR), real(I.PRIMORDIAL_BOOTS), tears(TEARS_PER_PAIR));
  useOn(player, I.PRIMORDIAL_BOOTS, TREADS_PR);
  assert.deepEqual(ids(player), sortedIds([TREADS_PR, I.PRIMORDIAL_BOOTS, I.DEMON_TEAR]));
  assert.equal(tearCount(player), TEARS_PER_PAIR);
});

test("a preset tear stack cannot pay: the treads stay base and the tears stay", (t) => {
  const { player, messages } = actor(t);
  give(player, real(TREADS), real(I.PRIMORDIAL_BOOTS), preset(tears(TEARS_PER_PAIR)));
  useOn(player, I.PRIMORDIAL_BOOTS, TREADS);
  assert.deepEqual(ids(player), sortedIds([TREADS, I.PRIMORDIAL_BOOTS, I.DEMON_TEAR]));
  assert.equal(tearCount(player), TEARS_PER_PAIR);
  assert.ok(messages.length >= 1, "the player is told");
});

test("with a preset and a real tear stack only the real one pays", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS), real(I.PRIMORDIAL_BOOTS), preset(tears(3000)), tears(TEARS_PER_PAIR));
  useOn(player, I.PRIMORDIAL_BOOTS, TREADS);
  assert.deepEqual(ids(player), sortedIds([TREADS_PR, I.DEMON_TEAR]));
  const left = held(player).find((item) => item.getId() === I.DEMON_TEAR);
  assert.equal(left.getAmount(), 3000);
  assert.equal(left.isPresetItem(), true, "what remains is the preset stack");
});

test("preset treads or preset boots are refused and keep their restrictions", (t) => {
  for (const [treads, boots] of [
    [preset(real(TREADS)), real(I.PRIMORDIAL_BOOTS)],
    [real(TREADS), preset(real(I.PRIMORDIAL_BOOTS))],
  ]) {
    const { player } = actor(t);
    give(player, treads, boots, tears(TEARS_PER_PAIR));
    useOn(player, I.PRIMORDIAL_BOOTS, TREADS);
    assert.deepEqual(ids(player), sortedIds([TREADS, I.PRIMORDIAL_BOOTS, I.DEMON_TEAR]));
    assert.equal(tearCount(player), TEARS_PER_PAIR);
  }
});

test("Dismantle on the (max) treads asks the captured question and No keeps them", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS_MAX));
  dismantle(player, TREADS_MAX);
  const prompt = pending(player);
  assert.ok(prompt, "a prompt is up");
  assert.match(JSON.stringify(prompt), /Are you sure you wish to dismantle your avernic treads \(max\)\?/);
  answer(player, 2);
  assert.deepEqual(ids(player), [TREADS_MAX]);
});

test("Yes returns the base treads and all three pairs, and the tears are not refunded", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS_MAX));
  dismantle(player, TREADS_MAX);
  assert.deepEqual(ids(player), [TREADS_MAX], "nothing happens before Yes");
  answer(player, 1);
  assert.deepEqual(ids(player), sortedIds([TREADS, I.PRIMORDIAL_BOOTS, I.PEGASIAN_BOOTS, I.ETERNAL_BOOTS]));
  assert.equal(tearCount(player), 0);
});

test("Dismantle of a partly upgraded treads returns only its pairs", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS_PR_PE));
  dismantle(player, TREADS_PR_PE);
  answer(player, 1);
  assert.deepEqual(ids(player), sortedIds([TREADS, I.PRIMORDIAL_BOOTS, I.PEGASIAN_BOOTS]));
});

test("Dismantle without room for the result consumes nothing", (t) => {
  const { player } = actor(t);
  const inventory = player.getInventory();
  give(player, real(TREADS_MAX));
  for (; inventory.getFreeSlots() > 0;) give(player, real(BONES));
  assert.equal(inventory.getFreeSlots(), 0);
  dismantle(player, TREADS_MAX);
  if (pending(player)) answer(player, 1);
  assert.ok(ids(player).includes(TREADS_MAX), "the treads are still there");
  assert.equal(ids(player).includes(I.PRIMORDIAL_BOOTS), false);
});

test("preset (max) treads cannot be dismantled into free boots", (t) => {
  const { player } = actor(t);
  give(player, preset(real(TREADS_MAX)));
  dismantle(player, TREADS_MAX);
  if (pending(player)) answer(player, 1);
  assert.deepEqual(ids(player), [TREADS_MAX]);
  assert.equal(held(player)[0].isPresetItem(), true);
});

test("no experience is granted on a refusal", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS), real(I.PRIMORDIAL_BOOTS), tears(TEARS_PER_PAIR - 1));
  const magic = xp(player, core.Skill.MAGIC);
  const runecraft = xp(player, core.Skill.RUNECRAFTING);
  useOn(player, I.PRIMORDIAL_BOOTS, TREADS);
  assert.equal(xp(player, core.Skill.MAGIC), magic);
  assert.equal(xp(player, core.Skill.RUNECRAFTING), runecraft);
});

test("boosted levels count (Wiki: both skills boostable)", (t) => {
  const { player } = actor(t, { magic: 78, currentMagic: 80, runecraft: 58, currentRunecraft: 60 });
  give(player, real(TREADS), real(I.PRIMORDIAL_BOOTS), tears(TEARS_PER_PAIR));
  useOn(player, I.PRIMORDIAL_BOOTS, TREADS);
  assert.deepEqual(ids(player), [TREADS_PR]);
});

test("drained levels do not count even with a high real level", (t) => {
  for (const levels of [{ currentMagic: 79 }, { currentRunecraft: 59 }]) {
    const { player } = actor(t, { magic: 99, runecraft: 99, ...levels });
    give(player, real(TREADS), real(I.PRIMORDIAL_BOOTS), tears(TEARS_PER_PAIR));
    useOn(player, I.PRIMORDIAL_BOOTS, TREADS);
    assert.deepEqual(ids(player), sortedIds([TREADS, I.PRIMORDIAL_BOOTS, I.DEMON_TEAR]));
  }
});

test("treads used on the boots add them too, and the other states take their boots", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS), real(I.ETERNAL_BOOTS), real(I.PEGASIAN_BOOTS), tears(2 * TEARS_PER_PAIR));
  useOn(player, TREADS, I.ETERNAL_BOOTS);
  assert.deepEqual(ids(player), sortedIds([TREADS_ET, I.PEGASIAN_BOOTS, I.DEMON_TEAR]));
  useOn(player, I.PEGASIAN_BOOTS, TREADS_ET);
  assert.deepEqual(ids(player), [TREADS_PE_ET]);
});

test("the (pr)(et) state dismantles into its own two pairs", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS_PR_ET));
  dismantle(player, TREADS_PR_ET);
  answer(player, 1);
  assert.deepEqual(ids(player), sortedIds([TREADS, I.PRIMORDIAL_BOOTS, I.ETERNAL_BOOTS]));
});

test("exactly enough room: (max) dismantles into three free slots", (t) => {
  const { player } = actor(t);
  const inventory = player.getInventory();
  give(player, real(TREADS_MAX));
  while (inventory.getFreeSlots() > 3) give(player, real(BONES));
  dismantle(player, TREADS_MAX);
  answer(player, 1);
  assert.equal(ids(player).includes(TREADS_MAX), false);
  assert.equal(ids(player).includes(TREADS), true);
});

test("a stale Yes after the treads were swapped for the Last Man Standing item (33172) pays nothing", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS_MAX));
  dismantle(player, TREADS_MAX);
  player.getInventory().deleteAtSlot(slotOfId(player, TREADS_MAX), 1, false);
  give(player, real(LMS_TREADS));
  answer(player, 1);
  assert.deepEqual(ids(player), [LMS_TREADS]);
});

test("a stale Yes after the treads left the inventory or became a preset copy pays nothing", (t) => {
  for (const swap of [null, () => preset(real(TREADS_MAX))]) {
    const { player } = actor(t);
    give(player, real(TREADS_MAX));
    dismantle(player, TREADS_MAX);
    player.getInventory().deleteAtSlot(slotOfId(player, TREADS_MAX), 1, false);
    if (swap) give(player, swap());
    answer(player, 1);
    assert.equal(ids(player).filter((id) => id !== TREADS_MAX).length, 0);
  }
});

test("a stale Yes after another pair was added pays nothing for the old state", (t) => {
  const { player } = actor(t);
  give(player, real(TREADS_PR), real(I.PEGASIAN_BOOTS), tears(TEARS_PER_PAIR));
  dismantle(player, TREADS_PR);
  useOn(player, I.PEGASIAN_BOOTS, TREADS_PR);
  answer(player, 1);
  assert.deepEqual(ids(player), [TREADS_PR_PE]);
});

test("the Last Man Standing treads (33172) are not a (max) treads: no prompt, no pairing", (t) => {
  const { player } = actor(t);
  give(player, real(LMS_TREADS), real(I.PRIMORDIAL_BOOTS), tears(TEARS_PER_PAIR));
  useOn(player, I.PRIMORDIAL_BOOTS, LMS_TREADS);
  assert.deepEqual(ids(player), sortedIds([LMS_TREADS, I.PRIMORDIAL_BOOTS, I.DEMON_TEAR]));
  assert.equal(pending(player), null);
});

// Death in the Wilderness: the real PlayerDeathTask split and the real item definitions
// (deathComponents in item-gameplay.json, as the Nightmare staffs). Wiki: the killer gets the base
// treads and every pair applied; the tears are lost.
const { Location } = require("../dist/game/model/Location");
const { PlayerRights } = require("../dist/game/model/rights/PlayerRights");
const WILDERNESS = new Location(3090, 3600, 0);
const EDGEVILLE = new Location(3090, 3490, 0);

function deathSplit(itemId, { at = WILDERNESS, killer = { isPlayer: () => true }, keep = false, make } = {}) {
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  const item = make ? make() : real(itemId);
  const victim = { getLocation: () => at, getRights: () => PlayerRights.NONE };
  return PlayerDeathTask.splitIntoComponents(victim, killer, keep ? [item] : [], [item]).map((entry) => entry.getId());
}

test("a (max) treads lost in a Wilderness PvP death drops as the base treads and all three pairs", () => {
  assert.deepEqual(sortedIds(deathSplit(TREADS_MAX)), sortedIds([TREADS, I.PRIMORDIAL_BOOTS, I.PEGASIAN_BOOTS, I.ETERNAL_BOOTS]));
});

test("every upgraded state splits into the base treads and exactly its pairs", () => {
  const expected = new Map([
    [TREADS_PR, [I.PRIMORDIAL_BOOTS]], [TREADS_PE, [I.PEGASIAN_BOOTS]], [TREADS_ET, [I.ETERNAL_BOOTS]],
    [TREADS_PR_PE, [I.PRIMORDIAL_BOOTS, I.PEGASIAN_BOOTS]], [TREADS_PR_ET, [I.PRIMORDIAL_BOOTS, I.ETERNAL_BOOTS]],
    [TREADS_PE_ET, [I.PEGASIAN_BOOTS, I.ETERNAL_BOOTS]],
  ]);
  for (const [state, pairs] of expected) {
    assert.deepEqual(sortedIds(deathSplit(state)), sortedIds([TREADS, ...pairs]), "state " + state);
  }
});

test("treads that are kept, or lost outside the Wilderness or to no player, stay whole", () => {
  assert.deepEqual(deathSplit(TREADS_MAX, { keep: true }), [TREADS_MAX]);
  assert.deepEqual(deathSplit(TREADS_MAX, { at: EDGEVILLE }), [TREADS_MAX]);
  assert.deepEqual(deathSplit(TREADS_MAX, { killer: null }), [TREADS_MAX]);
});

test("preset (max) treads are not split into free boots on death", () => {
  assert.deepEqual(deathSplit(TREADS_MAX, { make: () => preset(real(TREADS_MAX)) }), [TREADS_MAX]);
});
