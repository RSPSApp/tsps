// node --test tests/nightmare.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Common = require("../plugins/bosses/nightmare/Common.Nightmare");

const hooks = { custom: {}, npc: {}, drop: null, condition: null };
const fakeApi = {
  core: {
    Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } },
    ItemDefinition: { forId: (id) => ({ isStackable: () => id === 995 }) },
  },
  persistAttribute() {},
  onPlayerDeathItemDrop(handler) { hooks.drop = handler; },
  onNpcsInteraction(names, actions) { for (const name of names) hooks.npc[name] = actions; },
  onNpcDialogueCondition(handler) { hooks.condition = handler; },
  onCustomEvent(name, handler) { (hooks.custom[name] ??= []).push(handler); },
};
Common.init(fakeApi);

const Specials = require("../plugins/bosses/nightmare/Specials.Nightmare");
const Attacks = require("../plugins/bosses/nightmare/Attacks.Nightmare");
const Claws = require("../plugins/bosses/nightmare/Claws.Nightmare");
const Sleepwalkers = require("../plugins/bosses/nightmare/Sleepwalkers.Nightmare");
const Totems = require("../plugins/bosses/nightmare/Totems.Nightmare");
const Fight = require("../plugins/bosses/nightmare/Fight.Nightmare");
const Dream = require("../plugins/bosses/nightmare/Dream.Nightmare");
const Retrieval = require("../plugins/bosses/nightmare/Retrieval.Nightmare");
Retrieval.attachRetrieval(fakeApi);

function fakePlayer() {
  const store = new Map();
  const coins = { amount: 100_000 };
  const added = [];
  const messages = [];
  return {
    added,
    messages,
    coins,
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
    sendMessage: (text) => messages.push(text),
    getInventory: () => ({
      getAmount: () => coins.amount,
      delete: (_id, amount) => { coins.amount -= amount; },
      contains: () => false,
      getFreeSlots: () => 28,
      add: (item) => added.push([item.id, item.amount]),
    }),
  };
}

test("Phosani's three phases alternate the Wiki's A and B special sets", () => {
  const isA = (set) => set === 2 || set === 4;
  for (let i = 0; i < 50; i++) {
    const sets = Specials.phosaniSets();
    assert.equal(sets.length, 3);
    assert.equal(isA(sets[0]), isA(sets[2]));
    assert.notEqual(isA(sets[0]), isA(sets[1]));
    for (const set of sets) assert.ok(Common.data.specials.phosaniSets[String(set)]);
  }
});

test("each Phosani set holds a spawn, a special paired with her claws, and curse or surge", () => {
  for (const specials of Object.values(Common.data.specials.phosaniSets).filter(Array.isArray)) {
    assert.ok(specials.includes("husks") !== specials.includes("parasite"));
    assert.ok(specials.includes("spores") !== specials.includes("flowers"));
    assert.ok(specials.includes("curse") !== specials.includes("surge"));
  }
});

test("her curse shuffles what each protection stops, the other way round in Phosani's dream", () => {
  const player = {};
  const normal = { phosani: false, curse: new Map([[player, { attacks: 5 }]]) };
  const phosani = { phosani: true, curse: new Map([[player, { attacks: 5 }]]) };
  assert.equal(Specials.blockedBy(normal, player, "magic"), "ranged");
  assert.equal(Specials.blockedBy(normal, player, "ranged"), "melee");
  assert.equal(Specials.blockedBy(normal, player, "melee"), "magic");
  assert.equal(Specials.blockedBy(phosani, player, "melee"), "ranged");
  assert.equal(Specials.blockedBy({ phosani: false, curse: new Map() }, player, "magic"), "magic");
});

test("prayer: 20% through the right protection and 120% into the wrong one; Phosani's all or nothing", () => {
  const player = {};
  const normal = { phosani: false, curse: new Map() };
  const phosani = { phosani: true, curse: new Map() };
  assert.equal(Attacks.prayerFactor(normal, player, "magic", "magic"), 0.2);
  assert.equal(Attacks.prayerFactor(normal, player, "magic", "ranged"), 1.2);
  assert.equal(Attacks.prayerFactor(normal, player, "magic", null), 1);
  assert.equal(Attacks.prayerFactor(phosani, player, "ranged", "ranged"), 0);
  assert.equal(Attacks.prayerFactor(phosani, player, "ranged", "melee"), 1);
});

test("the sleepwalkers' blast follows the Wiki's table", () => {
  assert.equal(Sleepwalkers.blastDamage(0, 4), 5);
  assert.equal(Sleepwalkers.blastDamage(1, 4), 41);
  assert.equal(Sleepwalkers.blastDamage(2, 4), 77);
  assert.equal(Sleepwalkers.blastDamage(3, 3), 149);
  assert.equal(Sleepwalkers.blastDamage(1, 2), 77);
  assert.equal(Sleepwalkers.blastDamage(2, 3), 101);
});

test("her shield and the totems scale past five players, up to the Wiki's caps", () => {
  assert.equal(Fight.shieldFor(false, 1), 2000);
  assert.equal(Fight.shieldFor(false, 5), 2000);
  assert.equal(Fight.shieldFor(false, 6), 2200);
  assert.equal(Fight.shieldFor(false, 80), 17000);
  assert.equal(Fight.shieldFor(false, 200), 19600);
  assert.equal(Fight.shieldFor(true, 1), 400);
  assert.equal(Totems.chargeMax({ phosani: false, teamSize: 1 }), 300);
  assert.equal(Totems.chargeMax({ phosani: false, teamSize: 10 }), 450);
  assert.equal(Totems.chargeMax({ phosani: true, teamSize: 1 }), 200);
});

test("the claws stay on the arena floor, off the totems", () => {
  const { minX, maxX, minY, maxY } = Common.data.arena;
  const tiles = Claws.arenaTiles();
  assert.ok(tiles.length > 300);
  for (const [x, y] of tiles) {
    assert.ok(x >= minX && x <= maxX && y >= minY && y <= maxY);
    assert.ok(!Claws.isTotemTile(x, y));
  }
});

test("the captured spore layouts and sleepwalker tiles are on the arena floor", () => {
  const { minX, maxX, minY, maxY } = Common.data.arena;
  const inside = ([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  assert.equal(Common.data.spores.layouts.length, 4);
  for (const layout of Common.data.spores.layouts) assert.ok(layout.every(inside));
  assert.ok(Common.data.sleepwalkers.tiles.every(inside));
  for (const lane of Common.data.surge.lanes) assert.equal(lane.length, 2);
});

test("a death in a dream leaves the items with its keeper, for 60,000 coins", () => {
  const player = fakePlayer();
  const dream = { phosani: false, players: new Set([player]) };
  const original = Dream.dreamOf;
  Dream.dreamOf = (who) => (who === player ? dream : null);
  try {
    const event = { player, item: { getId: () => 4151, getAmount: () => 1 }, dropEligible: true, handled: false };
    hooks.drop(event);
    assert.equal(event.handled, true);
  } finally {
    Dream.dreamOf = original;
  }
  assert.equal(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE).holder, "shura");
  assert.equal(hooks.condition({ player, definition: { getName: () => "Shura" }, text: "If the player has items in Shura's collection:" }), true);
  assert.equal(hooks.condition({ player, definition: { getName: () => "Sister Senga" }, text: "If the player has items in Sister Senga's collection:" }), false);
  hooks.npc.Shura.Collect({ player, definition: { getName: () => "Shura", getId: () => 9414 } });
  assert.deepEqual(player.added, [[4151, 1]]);
  assert.equal(player.coins.amount, 40_000);
  assert.equal(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE), null);
});

test("Sister Senga's introduction never leaves an action mid-chain, and sets its varbits in order", () => {
  const Sanctuary = require("../plugins/bosses/nightmare/Sanctuary.Nightmare");
  const objects = {};
  const chains = [];
  const shown = [];
  const varbits = [];
  class Line { constructor(index, a, b) { this.text = typeof a === "string" ? a : b; } }
  class ActionDialogue { constructor(index, action) { this.action = action; } }
  Object.assign(fakeApi.core, {
    DialogueChainBuilder: class { constructor() { this.list = []; } add(...items) { this.list.push(...items); return this; } },
    NpcDialogue: Line,
    PlayerDialogue: Line,
    ActionDialogue,
  });
  const store = new Map();
  const player = {
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
    getPacketSender: () => ({ sendVarbit: (id) => varbits.push(id), sendInterfaceRemoval() {} }),
    getDialogueManager: () => ({ startDialogues: (chain) => chains.push(chain) }),
  };
  fakeApi.onObjectInteraction = (name, actions) => { objects[name] = actions; };
  fakeApi.onPlayerLogin = () => {};
  Sanctuary.attachSanctuary(fakeApi);
  objects["Pool of Nightmares"]["Drink-from"]({ player });
  for (let i = 0; i < chains.length; i++) {
    const list = chains[i].list;
    list.slice(0, -1).forEach((item) => assert.ok(!(item instanceof ActionDialogue)));
    assert.ok(list.at(-1) instanceof ActionDialogue);
    shown.push(...list.slice(0, -1).map((item) => item.text));
    list.at(-1).action.execute();
  }
  assert.equal(chains.length, 3);
  assert.equal(shown.length, 17);
  assert.equal(shown[12], "Needs help does she? Maybe I could be of assistance?");
  assert.deepEqual(varbits, [Common.data.varbits.phosaniSkipIntro, Common.data.varbits.phosaniIntro]);
  assert.equal(player.getAttribute(Common.PHOSANI_INTRO_ATTRIBUTE), true);
});
