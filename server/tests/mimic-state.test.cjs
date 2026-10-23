const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Item } = require("../dist/game/model/Item");

function fixture() {
  const attributes = new Map();
  return {
    attributes,
    player: { getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value) },
  };
}

for (const [tier, attempts, clueRolls] of [["elite", 5, 4], ["master", 6, 7]]) {
  test(`${tier} keeps its original clue-roll count separate from every fight attempt`, () => {
    const State = require("../plugins/bosses/mimic/State.Mimic");
    const f = fixture(), item = new Item(23184);
    State.initialize(item, tier, clueRolls);
    const id = State.ensure(f.player, item).id;
    for (let spent = 0; spent <= attempts; spent++) {
      const state = State.forOpen(f.player, item);
      assert.equal(state.id, id);
      assert.equal(state.tier, tier);
      assert.equal(state.attemptsLeft, attempts - spent);
      assert.equal(state.normalRolls, Math.max(0, clueRolls - spent));
      if (spent < attempts) State.spend(f.player, item, id);
    }
  });
}

test("dropped or grave-held casket keeps lost attempts when recovered, without charging another Mimic", () => {
  const State = require("../plugins/bosses/mimic/State.Mimic");
  const f = fixture(), first = new Item(23184), second = new Item(23184);
  State.initialize(first, "master", 6);
  State.initialize(second, "elite", 5);
  const a = State.ensure(f.player, first), b = State.ensure(f.player, second);
  assert.notEqual(a.id, b.id);
  State.spend(f.player, null, a.id);
  State.spend(f.player, null, a.id);
  assert.equal(State.forOpen(f.player, first).attemptsLeft, 4);
  assert.equal(State.forOpen(f.player, first).normalRolls, 4);
  assert.equal(State.forOpen(f.player, second).attemptsLeft, 5);
  assert.equal(State.forOpen(f.player, second).normalRolls, 5);
});

test("victory belongs only to the fought casket and survives a JSON metadata/ledger round trip", () => {
  const State = require("../plugins/bosses/mimic/State.Mimic");
  const f = fixture(), first = new Item(23184), second = new Item(23184);
  State.initialize(first, "master", 7);
  State.initialize(second, "elite", 6);
  const a = State.ensure(f.player, first);
  State.ensure(f.player, second);
  State.spend(f.player, null, a.id);
  State.defeat(f.player, null, a.id);
  const saved = JSON.parse(JSON.stringify({ items: [first, second], attributes: Object.fromEntries(f.attributes) }));
  const restored = fixture();
  for (const [key, value] of Object.entries(saved.attributes)) restored.attributes.set(key, value);
  const [loadedA, loadedB] = saved.items.map(item => new Item(item.id, item.amount, item.meta));
  assert.equal(State.forOpen(restored.player, loadedA).defeated, true);
  assert.equal(State.forOpen(restored.player, loadedA).attemptsLeft, 5);
  assert.equal(State.forOpen(restored.player, loadedA).normalRolls, 6);
  assert.equal(State.forOpen(restored.player, loadedB).defeated, false);
  assert.equal(State.forOpen(restored.player, loadedB).attemptsLeft, 5);
});

test("exhaustion remains exhausted after recovery and defeated caskets do not lose attempts on exit", () => {
  const State = require("../plugins/bosses/mimic/State.Mimic");
  const f = fixture(), item = new Item(23184), won = new Item(23184);
  State.initialize(item, "elite", 5);
  const a = State.ensure(f.player, item);
  for (let i = 0; i < 7; i++) State.spend(f.player, null, a.id);
  assert.equal(State.forOpen(f.player, item).attemptsLeft, 0);
  State.initialize(won, "master", 5);
  const b = State.ensure(f.player, won);
  State.defeat(f.player, won, b.id);
  State.spend(f.player, won, b.id);
  assert.equal(State.forOpen(f.player, won).attemptsLeft, 6);
});

test("legacy elite migration reconciles its old loss mirror once and does not affect new master caskets", () => {
  const State = require("../plugins/bosses/mimic/State.Mimic");
  const f = fixture(), legacy = new Item(23184), master = new Item(23184);
  legacy.setMetaValue(State.META_KEY, { rolls: 4 });
  f.attributes.set(State.LEGACY_ROLLS_ATTRIBUTE, 3);
  f.attributes.set(State.LEGACY_DEFEATED_ATTRIBUTE, true);
  const state = State.forOpen(f.player, legacy);
  assert.equal(state.tier, "elite");
  assert.equal(state.attemptsLeft, 3);
  assert.equal(state.normalRolls, 3);
  assert.equal(state.defeated, true);
  assert.equal(f.attributes.get(State.LEGACY_DEFEATED_ATTRIBUTE), false);
  State.initialize(master, "master", 7);
  assert.equal(State.forOpen(f.player, master).attemptsLeft, 6);
  assert.equal(State.forOpen(f.player, master).normalRolls, 7);
  assert.equal(State.forOpen(f.player, master).defeated, false);
});

test("corrupt saved state fails without resetting an attempt or changing the item", () => {
  const State = require("../plugins/bosses/mimic/State.Mimic");
  for (const mutate of [
    record => { record.tier = "easy"; }, record => { record.rolls = 7; },
    record => { record.rolls = -1; }, record => { record.clueRolls = 8; },
    record => { record.id = "not-an-id"; },
    record => { record.tier = ["master"]; },
    record => { record.id = [record.id]; },
  ]) {
    const f = fixture(), item = new Item(23184);
    State.initialize(item, "master", 6);
    const record = item.getMetaValue(State.META_KEY);
    mutate(record);
    const before = structuredClone(item.getMeta());
    assert.throws(() => State.ensure(f.player, item), /Mimic.*state/i);
    assert.deepEqual(item.getMeta(), before);
    assert.equal(f.attributes.size, 0);
  }
});

test("Mimic registration preserves the loss ledger through the real player save/load path", () => {
  const { Server } = require("../dist/Server");
  Server.installProductionPathResolver();
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const State = require("../plugins/bosses/mimic/State.Mimic");
  const Reward = require("../plugins/bosses/mimic/Reward.Mimic");
  Reward.attach({ persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value), onItemAction() {}, onCustomEvent() {} });
  const player = new Player(null), item = new Item(23184);
  player.getInventory().setItem(0, item);
  State.initialize(item, "master", 7);
  const record = State.ensure(player, item);
  State.spend(player, null, record.id); // A stale item snapshot, as with a grave copy.
  State.defeat(player, null, record.id);
  const save = PlayerSave.fromPlayer(player);
  const loaded = new Player(null);
  save.applyToPlayer(loaded);
  const state = State.forOpen(loaded, loaded.getInventory().getItems()[0]);
  assert.equal(state.attemptsLeft, 5);
  assert.equal(state.normalRolls, 6);
  assert.equal(state.defeated, true);
});
