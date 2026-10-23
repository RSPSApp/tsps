const assert = require("node:assert/strict");
const { test } = require("node:test");
const Shared = require("../plugins/bosses/mimic/Shared.Mimic");
const State = require("../plugins/bosses/mimic/State.Mimic");
const Lair = require("../plugins/bosses/mimic/Lair.Mimic");
const Challenge = require("../plugins/bosses/mimic/Challenge.Mimic");
const Reward = require("../plugins/bosses/mimic/Reward.Mimic");
const { Item } = require("../dist/game/model/Item");
const { Location } = require("../dist/game/model/Location");

class PrivateArea {
  enter(player) { player.area = this; }
  add(npc) { npc.area = this; }
  destroy() {}
  postLeave() {}
}

function fixture() {
  const items = [new Item(23184), new Item(23184)], attributes = new Map(), messages = [], queue = [], events = new Map();
  const player = {
    isRegistered: () => true, getHitpoints: () => 10, isPlayer: () => true, getAsPlayer() { return this; },
    getArea() { return this.area; }, getPrivateArea() { return this.area; },
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({getItems: () => items, getSlotForItemId: id => items.findIndex(item => item?.getId() === id),
      deleteAtSlot(slot) { items[slot] = null; }, deleteNumber(id) { items[items.findIndex(item => item?.getId() === id)] = null; },
      refreshItems() {}, forceAdd(_player, item) { const slot = items.indexOf(null); if (slot >= 0) items[slot] = item; else items.push(item); }}),
    moveTo() {}, sendMessage: text => messages.push(text),
  };
  const core = { ItemIdentifiers: {MIMIC: 23184, MAHOGANY_PLANK: 8782}, NpcIdentifiers: {THE_MIMIC: 7979, THE_MIMIC_2: 8633},
    ObjectIdentifiers: {}, PrivateArea, Boundary: class {}, Location, World: {getRemoveNPCQueue: () => queue},
    Item, ItemDefinition: {forId: id => ({getId: () => id, isStackable: () => true, getNoteId: () => -1, getName: () => "Coins"})} };
  const api = {core, registerArea() {}, onObjectInteraction() {}, persistAttribute() {}, onItemAction() {},
    onCustomEvent(name, handler) { if (!events.has(name)) events.set(name, []); events.get(name).push(handler); },
    emitCustomEvent(name, event) { for (const handler of events.get(name) ?? []) handler(event); },
    spawnNpc: definition => ({ hp: 100, getId: () => definition.id, isRegistered: () => true, getHitpoints() { return this.hp; },
      getPrivateArea() { return this.area; }, getArea() { return this.area; }, setNpcTransformationId() {}, setFlag() {}, getCombat: () => ({attack() {}}) }) };
  Shared.bind(api); Lair.attach(api); Reward.attach(api);
  require("../plugins/treasuretrails/RewardCaskets.plugin").register(api);
  State.initialize(items[0], "master", 7);
  State.initialize(items[1], "elite", 6);
  const first = items[0], second = items[1];
  const a = State.ensure(player, first), b = State.ensure(player, second);
  return { player, items, first, second, a, b, messages, attributes, api };
}

test("leaving charges the entered casket after it was dropped and another Mimic moved to its slot", () => {
  const f = fixture();
  assert.equal(Lair.enterArena(f.player), true);
  const area = f.player.area, session = Lair.sessionOf(area);
  Challenge.challenge({player: f.player, npc: session.casket});
  f.items[0] = f.second; f.items[1] = null;
  area.postLeave(f.player, false);
  assert.equal(State.forOpen(f.player, f.first).attemptsLeft, 5);
  assert.equal(State.forOpen(f.player, f.second).attemptsLeft, 5);
});

test("arena victory unlocks only the entered casket even if it is no longer carried", () => {
  const f = fixture();
  Lair.enterArena(f.player);
  const area = f.player.area, session = Lair.sessionOf(area);
  Challenge.challenge({player: f.player, npc: session.casket});
  f.items[0] = f.second; f.items[1] = null;
  session.casket.hp = 0;
  const event = {player: f.player, npc: session.casket, npcId: 8633};
  Reward.onDropsGenerated(event);
  assert.equal(event.handled, true);
  area.postLeave(f.player, false);
  assert.equal(State.forOpen(f.player, f.first).defeated, true);
  assert.equal(State.forOpen(f.player, f.first).attemptsLeft, 6);
  assert.equal(State.forOpen(f.player, f.second).defeated, false);
});

test("a defeated or exhausted casket cannot begin another fight", () => {
  for (const won of [false, true]) {
    const f = fixture();
    if (won) State.defeat(f.player, f.first, f.a.id);
    else for (let i = 0; i < 6; i++) State.spend(f.player, f.first, f.a.id);
    assert.equal(Lair.enterArena(f.player), false);
    assert.equal(f.player.area, undefined);
    assert.ok(f.messages.length);
  }
});

test("a simultaneous player and boss death keeps the victory and charges no attempt", () => {
  const f = fixture();
  Lair.enterArena(f.player);
  const area = f.player.area, session = Lair.sessionOf(area);
  Challenge.challenge({player: f.player, npc: session.casket});
  session.casket.hp = 0;
  f.player.getHitpoints = () => 0;
  const event = {player: f.player, npc: session.casket, npcId: 8633};
  Reward.onDropsGenerated(event);
  area.postLeave(f.player, false);
  assert.equal(event.handled, true);
  assert.equal(State.forOpen(f.player, f.first).defeated, true);
  assert.equal(State.forOpen(f.player, f.first).attemptsLeft, 6);
});

test("opening a victorious second Mimic consumes its slot and leaves the first casket untouched", () => {
  const f = fixture();
  State.defeat(f.player, f.second, f.b.id);
  const original = Math.random;
  try { Math.random = () => 0.1; Reward.openMimic({player: f.player, slot: 1, item: f.second}); }
  finally { Math.random = original; }
  assert.equal(f.items[0], f.first);
  assert.equal(f.items[1].getId(), 1079);
  assert.equal(f.items[1].getAmount(), 1);
  assert.equal(State.forOpen(f.player, f.first).defeated, false);
  assert.equal(f.attributes.get(State.LEDGER_ATTRIBUTE)[f.b.id], undefined);
});

test("victory in one Mimic does not authorize opening another casket", () => {
  const f = fixture();
  State.defeat(f.player, f.first, f.a.id);
  Reward.openMimic({player: f.player, slot: 1, item: f.second});
  assert.equal(f.items[0], f.first);
  assert.equal(f.items[1], f.second);
  assert.equal(f.items.some(item => item?.getId() === 995), false);
  assert.match(f.messages[0], /attempt the Mimic's challenge/);
});
