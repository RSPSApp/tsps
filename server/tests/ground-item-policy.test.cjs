const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Server} = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
const {PluginManager} = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const {Inventory} = require("../dist/game/model/container/impl/Inventory");
const {World} = require("../dist/game/World");
const {State} = require("../dist/game/entity/impl/grounditem/ItemOnGround");
const {MagicOnItemPacketListener} = require("../dist/net/packet/impl/MagicOnItemPacketListener");
const {ItemOnGroundManager: manager, Item, Location, ItemIdentifiers: I} = core;
const TIERS = ["beginner", "easy", "medium", "hard", "elite", "master"];

function fixture(t, {complete = true, members = true} = {}) {
  const messages = [], events = new Map(), attributes = new Map();
  const banks = Array.from({length: core.Bank.TOTAL_BANK_TABS}, () => []);
  const player = {getUsername: () => "PolicyTest", getPrivateArea: () => null,
    getLocation: () => new Location(3222, 3218), getSize: () => 1,
    getMovementQueue: () => ({reset() {}}), isRegistered: () => true, getHitpoints: () => 10,
    getPacketSender: () => ({sendItemContainer() {}, sendSoundEffect() {}}),
    getSkillManager: () => ({addExperiences() {}}), sendMessage: text => messages.push(text),
    getLastItemPickup: () => ({reset() {}}), isPlayerBot: () => false,
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getBank: tab => ({getItems: () => banks[tab]})};
  const inventory = new Inventory(player); player.getInventory = () => inventory;
  const api = {core: {...core, WorldDefinition: {isMembersWorld: () => members}},
    persistAttribute() {}, onItemAction() {}, onPlayerLogin() {}, onCanAttack() {},
    onCustomEvent(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent(name, event) { for (const fn of events.get(name) ?? []) fn(event); }};
  api.onCustomEvent("quest:is-complete", event => { if (event.key === "x_marks_the_spot") event.complete = complete; });
  require("../plugins/treasuretrails/ClueCapacity.plugin").register(api);
  t.mock.method(PluginManager, "emitCustomEvent", api.emitCustomEvent);
  t.mock.method(PluginManager, "emitGroundItemPickup", () => false);
  const items = World.getItems(), previous = items.splice(0);
  t.after(() => items.splice(0, items.length, ...previous));
  const listener = new MagicOnItemPacketListener();
  return {player, inventory, banks, attributes, messages, api,
    pile: (id, amount = 1, metadata = null) => manager.registers(player, new Item(id, amount, metadata)),
    take(source, pile) {
      if (source === "pickup") manager.pickup(player, pile);
      else listener.landGroundItemGrab(player, pile.getItem().getId(), pile.getPosition());
    }};
}

for (const source of ["pickup", "telegrab"]) {
  for (const tier of TIERS) {
    test(`${source} refuses ${tier} boxes at the combined bank/inventory cap`, t => {
      const f = fixture(t), id = I[`SCROLL_BOX_${tier.toUpperCase()}_`];
      f.banks[2] = [new Item(id, 2)];
      const pile = f.pile(id); f.take(source, pile);
      assert.equal(f.inventory.getAmount(id), 0); assert.equal(pile.isPendingRemoval(), false);
      assert.equal(pile.getItem().getAmount(), 1);
      assert.deepEqual(f.messages, ["You can't take any more of that tier of scroll box."]);
    });
  }
  for (const [quantity, expectedCredit, text] of [[3, 2, "One"], [5, 2, "Some"]]) {
    test(`${source} credits the available box capacity and destroys ${text.toLowerCase()} excess`, t => {
      const f = fixture(t), id = I.SCROLL_BOX_BEGINNER_, pile = f.pile(id, quantity);
      f.take(source, pile);
      assert.equal(f.inventory.getAmount(id), expectedCredit); assert.equal(pile.isPendingRemoval(), true);
      assert.deepEqual(f.messages, [`${text} of your scroll boxes ${text === "One" ? "was" : "were"} destroyed as you have too many of that tier.`]);
    });
  }
  test(`${source} uses saved scroll-case upgrades and counts active clues`, t => {
    const f = fixture(t), id = I.SCROLL_BOX_BEGINNER_;
    for (const key of ["treasure-trails:beginner-minor-case", "treasure-trails:beginner-major-case", "treasure-trails:mimic-case"]) f.attributes.set(key, true);
    f.banks[1] = [new Item(I.CLUE_SCROLL_BEGINNER_), new Item(id, 3)];
    const pile = f.pile(id, 2); f.take(source, pile);
    assert.equal(f.inventory.getAmount(id), 1); assert.equal(pile.isPendingRemoval(), true);
  });
  test(`${source} preserves every box when metadata requires an unavailable slot`, t => {
    const f = fixture(t), id = I.SCROLL_BOX_BEGINNER_;
    f.inventory.setItem(0, new Item(id, 1, {old: true}));
    for (let slot = 1; slot < 28; slot++) f.inventory.setItem(slot, new Item(385));
    const pile = f.pile(id, 4); f.take(source, pile);
    assert.equal(f.inventory.getAmount(id), 1); assert.equal(pile.getItem().getAmount(), 4);
    assert.equal(pile.isPendingRemoval(), false);
    assert.ok(!f.messages.some(text => text.includes("destroyed")));
  });
  test(`${source} keeps the single-clue limit before X Marks the Spot`, t => {
    const f = fixture(t, {complete: false}), id = I.CLUE_SCROLL_BEGINNER_;
    f.banks[0] = [new Item(id)]; const pile = f.pile(id); f.take(source, pile);
    assert.equal(f.inventory.getAmount(id), 0); assert.equal(pile.isPendingRemoval(), false);
  });
  test(`${source} applies generic bounded credit/discard and reports only the completed transfer`, t => {
    const f = fixture(t), observed = [], pile = f.pile(995, 5, {source: "test"});
    f.api.onCustomEvent("ground-items:take", event => { event.amount = 2; event.discard = 2; });
    f.api.onCustomEvent("ground-items:taken", event => observed.push(event));
    f.take(source, pile);
    assert.equal(f.inventory.getAmount(995), 2); assert.equal(pile.getItem().getAmount(), 1);
    assert.equal(pile.isPendingRemoval(), false);
    assert.deepEqual(observed.map(event => [event.source, event.itemId, event.amount, event.discarded]), [[source, 995, 2, 2]]);
    assert.deepEqual(f.inventory.getItems()[0].getMeta(), {source: "test"});
  });
}

for (const [label, mutate] of [
  ["refusal", event => { event.allow = false; }],
  ["increased credit", event => { event.amount++; }],
  ["negative discard", event => { event.discard = -1; }],
  ["excess discard", event => { event.discard = 6; }],
  ["fractional credit", event => { event.amount = 1.5; }],
  ["error", event => { event.error = new Error("policy unavailable"); }],
]) test(`generic transfer preserves its source after policy ${label}`, t => {
  const f = fixture(t), pile = f.pile(995, 5), observed = [];
  f.api.onCustomEvent("ground-items:take", mutate);
  f.api.onCustomEvent("ground-items:taken", event => observed.push(event));
  assert.equal(manager.transferToInventory(f.player, pile), 0);
  assert.equal(f.inventory.getAmount(995), 0); assert.equal(pile.getItem().getAmount(), 5);
  assert.equal(pile.isPendingRemoval(), false); assert.equal(observed.length, 0);
});

for (const [label, mutate] of [
  ["amount", pile => pile.getItem().setAmount(4)],
  ["identity", pile => pile.getItem().setId(385)],
  ["metadata", pile => pile.getItem().setMeta({changed: true})],
  ["owner", pile => { pile.owner = "OtherPlayer"; }],
  ["position", pile => pile.getPosition().setX(3223)],
  ["removal", pile => pile.setPendingRemoval(true)],
]) test(`generic transfer rechecks source ${label} after preparation callbacks`, t => {
  const f = fixture(t), pile = f.pile(995, 5), observed = [];
  f.api.onCustomEvent("ground-items:take", () => mutate(pile));
  f.api.onCustomEvent("ground-items:taken", event => observed.push(event));
  assert.equal(manager.transferToInventory(f.player, pile), 0);
  assert.equal(f.inventory.getAmount(995), 0); assert.equal(observed.length, 0);
});

test("a reentrant preparation cannot credit the same pile twice", t => {
  const f = fixture(t), pile = f.pile(995, 5); let callbacks = 0, nested;
  f.api.onCustomEvent("ground-items:take", () => { if (++callbacks === 1) nested = manager.transferToInventory(f.player, pile); });
  assert.equal(manager.transferToInventory(f.player, pile), 5);
  assert.equal(nested, 0); assert.equal(callbacks, 1); assert.equal(f.inventory.getAmount(995), 5);
});

test("failed inventory credit cannot discard a clue pile or announce destruction", t => {
  const f = fixture(t), id = I.SCROLL_BOX_BEGINNER_, pile = f.pile(id, 4);
  t.mock.method(f.inventory, "addItem", () => f.inventory);
  assert.equal(manager.transferToInventory(f.player, pile), 0);
  assert.equal(pile.getItem().getAmount(), 4); assert.equal(pile.isPendingRemoval(), false);
  assert.deepEqual(f.messages, []);
});

test("capacity is rechecked if a preparation callback fills the inventory", t => {
  const f = fixture(t), pile = f.pile(995, 5);
  f.api.onCustomEvent("ground-items:take", event => {
    event.discard = 2; event.amount = 2;
    for (let slot = 0; slot < 28; slot++) f.inventory.setItem(slot, new Item(385));
  });
  assert.equal(manager.transferToInventory(f.player, pile), 0);
  assert.equal(f.inventory.getAmount(995), 0); assert.equal(pile.getItem().getAmount(), 5);
});

test("a nested transfer of a different pile cannot invalidate the player's clue capacity decision", t => {
  const f = fixture(t), id = I.SCROLL_BOX_BEGINNER_;
  const outer = f.pile(id, 2, {pile: "outer"}), inner = f.pile(id, 2, {pile: "inner"});
  let nested;
  f.api.onCustomEvent("ground-items:take", event => {
    if (event.groundItem === outer) nested = manager.transferToInventory(f.player, inner);
  });
  assert.equal(manager.transferToInventory(f.player, outer), 2);
  assert.equal(nested, 0); assert.equal(f.inventory.getAmount(id), 2);
  assert.equal(inner.isPendingRemoval(), false); assert.equal(inner.getItem().getAmount(), 2);
});

for (const source of ["pickup", "telegrab"]) {
  test(`${source} takes only one active scroll from a legacy clue batch`, t => {
    const f = fixture(t), id = I.CLUE_SCROLL_BEGINNER_, pile = f.pile(id, 2);
    f.take(source, pile);
    assert.equal(f.inventory.getAmount(id), 1); assert.equal(pile.getItem().getAmount(), 1);
    assert.equal(pile.isPendingRemoval(), false);
  });
  for (const storage of ["inventory", "bank", "grave"]) {
    test(`${source} cannot collect a second active clue from the ground after the quest (${storage})`, t => {
      const f = fixture(t), id = I.CLUE_SCROLL_BEGINNER_;
      if (storage === "inventory") f.inventory.setItem(0, new Item(id));
      if (storage === "bank") f.banks[0] = [new Item(id)];
      if (storage === "grave") f.api.onCustomEvent("gravestones:state", event => { event.grave = {items: [{id, amount: 1}]}; });
      const pile = f.pile(id); f.take(source, pile);
      assert.equal(f.inventory.getAmount(id), storage === "inventory" ? 1 : 0);
      assert.equal(pile.isPendingRemoval(), false);
      assert.deepEqual(f.messages, ["You already have a clue scroll of this tier."]);
    });
  }
  test(`${source} can fill an existing box stack without a free slot`, t => {
    const f = fixture(t), id = I.SCROLL_BOX_BEGINNER_;
    f.inventory.setItem(0, new Item(id));
    for (let slot = 1; slot < 28; slot++) f.inventory.setItem(slot, new Item(385));
    const pile = f.pile(id, 4); f.take(source, pile);
    assert.equal(f.inventory.getAmount(id), 2); assert.equal(pile.isPendingRemoval(), true);
    assert.deepEqual(f.messages, ["Some of your scroll boxes were destroyed as you have too many of that tier."]);
  });
  test(`${source} cannot obtain members clues in a free world`, t => {
    const f = fixture(t, {members: false}), id = I.SCROLL_BOX_EASY_, pile = f.pile(id);
    f.take(source, pile);
    assert.equal(f.inventory.getAmount(id), 0); assert.equal(pile.isPendingRemoval(), false);
  });
}
