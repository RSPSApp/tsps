// node --test tests/nightmare.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Common = require("../plugins/bosses/nightmare/Common.Nightmare");

const hooks = { custom: {}, npc: {}, drop: null, condition: null, buttons: {} };
const COMPONENTS = { "gravestone_retrieval:items": 602 << 16 | 3, "gravestone_retrieval:button": 602 << 16 | 6, "gravestone_retrieval:discard": 602 << 16 | 14, "toplevel_osrs_stretch:mainmodal": 161 << 16 | 16 };
const achievementEvents = [];
const fakeApi = {
  core: {
    Item: class { constructor(id, amount, meta) { this.id = id; this.amount = amount; this.meta = meta; } },
    ItemDefinition: { forId: (id) => ({ isStackable: () => id === 995, getGrandExchangeValue: () => 0 }) },
    CacheDefinitions: { getComponentId: (name) => COMPONENTS[name], getVarpId: (name) => (name === "if1" ? 261 : 262) },
    examineItem() {},
  },
  persistAttribute() {},
  onPlayerDeathItemDrop(handler) { hooks.drop = handler; },
  onPlayerDeathDrops(handler) { hooks.deathDrops = handler; },
  onNpcsInteraction(names, actions) { for (const name of names) hooks.npc[name] = actions; },
  onNpcDialogueCondition(handler) { hooks.condition = handler; },
  onInterfaceActionButton(component, handler) { hooks.buttons[component] = handler; },
  onCustomEvent(name, handler) { (hooks.custom[name] ??= []).push(handler); },
  emitCustomEvent(name, event) {
    if (name === "combat-achievements:complete") achievementEvents.push(event);
    for (const handler of hooks.custom[name] ?? []) handler(event);
  },
};
Common.init(fakeApi);

const Specials = require("../plugins/bosses/nightmare/Specials.Nightmare");
const Spores = require("../plugins/bosses/nightmare/Spores.Nightmare");
const Attacks = require("../plugins/bosses/nightmare/Attacks.Nightmare");
const Claws = require("../plugins/bosses/nightmare/Claws.Nightmare");
const Sleepwalkers = require("../plugins/bosses/nightmare/Sleepwalkers.Nightmare");
const Totems = require("../plugins/bosses/nightmare/Totems.Nightmare");
const Fight = require("../plugins/bosses/nightmare/Fight.Nightmare");
const CombatAchievements = require("../plugins/bosses/nightmare/CombatAchievements.Nightmare");
const Dream = require("../plugins/bosses/nightmare/Dream.Nightmare");
const Retrieval = require("../plugins/bosses/nightmare/Retrieval.Nightmare");
Retrieval.attachRetrieval(fakeApi);
// The shared fee contract (Gravestones' in the game): paid from the inventory here.
fakeApi.onCustomEvent("gravestones:pay-fee", (request) => {
  const { coins } = request.player;
  if (coins.amount < request.amount) return;
  coins.amount -= request.amount;
  request.source = "inventory";
  request.message = `Payment has been taken from your inventory: ${request.amount.toLocaleString("en-GB")} x Coins`;
});

/** Collect on a keeper, then the Item Retrieval Service's button twice: pay, then take. */
function collectAll(player, name, id) {
  hooks.npc[name].Collect({ player, definition: { getName: () => name, getId: () => id } });
  assert.equal(player.open.has(602), true, "Collect opens the Item Retrieval Service (602)");
  hooks.buttons[COMPONENTS["gravestone_retrieval:button"]]({ player });
  hooks.buttons[COMPONENTS["gravestone_retrieval:button"]]({ player });
}

function fakePlayer() {
  const store = new Map();
  const coins = { amount: 100_000 };
  const added = [];
  const messages = [];
  const open = new Set();
  const configs = new Map();
  return {
    added,
    messages,
    coins,
    open,
    configs,
    getPacketSender: () => ({
      sendInterfaceRemoval() { open.clear(); },
      sendConfig(id, value) { configs.set(id, value); },
      sendVarbit() {},
      sendInventory() {},
      sendInterfaceScript() {},
      sendSubInterface(_parent, id) { open.add(id); },
      sendInterfaceFlagsRange() {},
      sendString() {},
      isSubInterfaceOpen: (id) => open.has(id),
    }),
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
    sendMessage: (text) => messages.push(text),
    getLocation: () => ({ clone() { return this; } }),
    getInventory: () => ({
      getAmount: () => coins.amount,
      delete: (_id, amount) => { coins.amount -= amount; },
      contains: () => false,
      getFreeSlots: () => 28,
      getAddableAmount: (item) => item.amount,
      add: (item) => added.push(item.meta == null ? [item.id, item.amount] : [item.id, item.amount, item.meta]),
      refreshItems() {},
    }),
  };
}

test("Phosani's three phases are consecutive steps of the captured form cycle 9416 -> 11153 -> 9418 -> 9417", () => {
  const forms = Common.data.npcs.phosani.sets;
  const cycle = [9416, 11153, 9418, 9417];
  for (let i = 0; i < 50; i++) {
    const sets = Specials.phosaniSets();
    assert.equal(sets.length, 3);
    const ids = sets.map((set) => forms[String(set)]);
    const start = cycle.indexOf(ids[0]);
    assert.deepEqual(ids, [0, 1, 2].map((k) => cycle[(start + k) % 4]));
    for (const set of sets) assert.ok(Common.data.specials.phosaniSets[String(set)]);
    for (const set of sets) assert.deepEqual([...Common.data.specials.phosaniOrder[String(set)]].sort(), [...Common.data.specials.phosaniSets[String(set)]].sort());
  }
});

test("each Phosani set holds a spawn, a special paired with her claws, and curse or surge", () => {
  for (const specials of Object.values(Common.data.specials.phosaniSets).filter(Array.isArray)) {
    assert.ok(specials.includes("husks") !== specials.includes("parasite"));
    assert.ok(specials.includes("spores") !== specials.includes("flowers"));
    assert.ok(specials.includes("curse") !== specials.includes("surge"));
  }
});

test("her curse shuffles what each protection stops, the same way in Phosani's dream (rsprox: magic into Melee, ranged into Magic, 0 damage)", () => {
  const player = {};
  const normal = { phosani: false, curse: new Map([[player, { attacks: 5 }]]) };
  const phosani = { phosani: true, curse: new Map([[player, { attacks: 5 }]]) };
  assert.equal(Specials.blockedBy(normal, player, "magic"), "ranged");
  assert.equal(Specials.blockedBy(normal, player, "ranged"), "melee");
  assert.equal(Specials.blockedBy(normal, player, "melee"), "magic");
  assert.equal(Specials.blockedBy(phosani, player, "melee"), "magic");
  assert.equal(Specials.blockedBy(phosani, player, "magic"), "ranged");
  assert.equal(Specials.blockedBy(phosani, player, "ranged"), "melee");
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

test("Phosani's task judgement uses the prayer, walker, damage and spore state", () => {
  const player = fakePlayer();
  player.isPlayer = () => true;
  const clean = { phosani: true, players: () => [player] };
  achievementEvents.length = 0;
  CombatAchievements.judge(clean, player);
  assert.deepEqual(achievementEvents.map(({ task }) => task).sort(), [
    "Crush Hour", "Dreamland Express", "I Would Simply React", "Perfect Phosani's Nightmare",
  ].sort());

  const failed = { phosani: true, players: () => [player] };
  CombatAchievements.prayerDisabled(failed, player);
  CombatAchievements.sleepwalkerReached(failed, true);
  CombatAchievements.crushHourFailed(failed);
  CombatAchievements.sporesSlowed(failed, player);
  CombatAchievements.damageTaken(failed, player, 1);
  achievementEvents.length = 0;
  CombatAchievements.judge(failed, player);
  assert.deepEqual(achievementEvents, [], "each recorded failure blocks its corresponding task");
});

test("Phosani's Crush Hour checks for living registered husks and parasites at death", (t) => {
  t.mock.method(Specials, "interrupt", () => {});
  t.mock.method(Sleepwalkers, "clear", () => {});
  const player = fakePlayer();

  const judgeCrushHour = (minions) => {
    const movement = { setBlockMovement() { return movement; }, reset() {} };
    const fight = Object.assign(Object.create(Fight.Fight.prototype), {
      phosani: true,
      stage: "fighting",
      tick: 0,
      events: [],
      minions: new Set(minions),
      players: () => [player],
      boss: {
        getCombat: () => ({ reset() {} }),
        setUntargetable() {},
        getMovementQueue: () => movement,
      },
    });
    fight.dying();
    achievementEvents.length = 0;
    CombatAchievements.judge(fight, player);
    return achievementEvents.some(({ task }) => task === "Crush Hour");
  };

  for (const marker of ["__nightmareHusk", "__nightmareParasite"]) {
    const survivor = { isRegistered: () => true, getHitpoints: () => 1, [marker]: {} };
    assert.equal(judgeCrushHour([survivor]), false, `${marker} survives the boss`);
  }
  const dead = { __nightmareHusk: {}, isRegistered: () => true, getHitpoints: () => 0 };
  const removed = { __nightmareParasite: {}, isRegistered: () => false, getHitpoints: () => 1 };
  const walker = { __nightmareWalker: {}, isRegistered: () => true, getHitpoints: () => 1 };
  assert.equal(judgeCrushHour([dead, removed, walker]), true, "dead, removed and non-minion NPCs do not fail it");
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
  collectAll(player, "Shura", 9414);
  assert.deepEqual(player.added, [[4151, 1]]);
  assert.equal(player.coins.amount, 40_000);
  assert.equal(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE), null);
  assert.equal(player.configs.get(261), -1, "if1 clears once Shura holds nothing");
});

test("a second dream death loses the first death's items: the keeper holds only the new death's, fee due again, meta kept", () => {
  const player = fakePlayer();
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, { holder: "shura", items: [[385, 5]], paid: true });
  const dream = { phosani: false, players: new Set([player]) };
  const original = Dream.dreamOf;
  Dream.dreamOf = (who) => (who === player ? dream : null);
  const death = {};
  try {
    hooks.drop({ player, location: death, shouldDropItems: true, item: { getId: () => 6585, getAmount: () => 1, getMeta: () => ({ charges: 30000 }) }, dropEligible: true, handled: false });
    hooks.drop({ player, location: death, shouldDropItems: true, item: { getId: () => 4151, getAmount: () => 1 }, dropEligible: true, handled: false });
    hooks.deathDrops({ player, location: death, items: [], untradeables: [] });
  } finally {
    Dream.dreamOf = original;
  }
  assert.deepEqual(player.messages, ["Your items left with Shura have been lost."], "said once, for the earlier lot");
  assert.equal(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE).paid, false);
  collectAll(player, "Shura", 9414);
  assert.equal(player.coins.amount, 40_000, "the fee is taken for the new lot");
  assert.deepEqual(player.added, [[6585, 1, { charges: 30000 }], [4151, 1]], "the same death's items stay together; the first death's food is gone");
});

test("a dream death that loses nothing still loses the earlier lot", () => {
  const player = fakePlayer();
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, { holder: "senga", items: [[385, 5]], paid: false });
  const original = Dream.dreamOf;
  Dream.dreamOf = (who) => (who === player ? { phosani: true, players: new Set([player]) } : null);
  try {
    hooks.deathDrops({ player, location: {}, items: [], untradeables: [] });
  } finally {
    Dream.dreamOf = original;
  }
  assert.equal(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE), null);
  assert.deepEqual(player.messages, ["Your items left with Sister Senga have been lost."]);
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
  fakeApi.onNpcDialogueVariant = () => {};
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

test("husk hits land with their captured projectiles (#1862)", (t) => {
  fakeApi.core.Projectile = { ticksToLand: (end) => Math.max(1, Math.ceil(end / 30)) };
  t.after(() => { delete fakeApi.core.Projectile; });
  const Husks = require("../plugins/bosses/nightmare/Husks.Nightmare");
  const shots = [];
  const strikes = [];
  t.mock.method(Common, "projectile", (_area, _from, _to, spec) => shots.push(spec));
  t.mock.method(Common, "strike", (_npc, _player, style, _max, delay) => strikes.push([style, delay]));
  for (const name of ["animation", "graphic", "areaSound"]) t.mock.method(Common, name, () => ({}));
  const player = { getLocation: () => ({}), performGraphic: () => {} };
  const husk = (style) => ({
    __nightmareHusk: { style, player, next: 0 },
    isRegistered: () => true, getHitpoints: () => 20, getLocation: () => ({}),
    performAnimation: () => {}, setPositionToFace: () => {},
  });
  const fight = { tick: 10, dream: { area: null }, players: () => [], frozen: new Map([[player, [husk("magic"), husk("ranged")]]]) };
  Husks.process(fight);
  const { husks } = Common.data;
  assert.deepEqual(shots, [husks.magic.projectile, husks.ranged.projectile]);
  // Magic lands at 67 cycles (3 ticks), ranged at 60 (2), not a tick out.
  assert.deepEqual(strikes, [["magic", 3], ["ranged", 2]]);
});

test("The Nightmare's loot roll is marked as loot, not a second kill: the fight counts the kill", () => {
  const Loot = require("../plugins/bosses/nightmare/Loot.Nightmare");
  const emitted = [];
  fakeApi.emitCustomEvent = (name, payload) => {
    emitted.push([name, payload]);
    if (name === "npc-drops:roll-table") payload.drops.push({ itemId: 995, amount: 1 });
  };
  fakeApi.getItemOnGroundManager = () => ({ registerLocation() {} });
  fakeApi.core.ItemIdentifiers = { BIG_BONES: 532, BONES: 526 };
  fakeApi.core.Item = class { constructor(itemId, amount) { this.itemId = itemId; this.amount = amount; } };
  fakeApi.core.ItemDefinition = { forId: () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => true }) };
  const player = fakePlayer();
  const fight = {
    phosani: false,
    boss: {},
    dream: { tile: () => ({}), area: {} },
    contribution: new Map([[player, { shield: 1, totems: 1 }]]),
  };
  Loot.reward(fight, [player]);
  const rolls = emitted.filter(([name]) => name === "npc-drops:roll").map(([, payload]) => payload);
  assert.equal(rolls.length, 1);
  assert.equal(rolls[0].countKill, false);
  assert.equal(rolls[0].npc, fight.boss);
});

test("a team's kill gives its uniques once, to one player by weight of damage (Wiki), and everyone their own roll", (t) => {
  const Loot = require("../plugins/bosses/nightmare/Loot.Nightmare");
  const STAFF = 24422;
  fakeApi.emitCustomEvent = (name, payload) => {
    // Every roll of her table comes up with a staff: a per-player unique roll would give one to everybody.
    if (name === "npc-drops:roll-table") payload.drops.push({ itemId: STAFF, amount: 1 }, { itemId: 995, amount: 1 });
  };
  const placed = [];
  fakeApi.getItemOnGroundManager = () => ({ registerLocation(player, item) { placed.push([player, item.itemId]); } });
  fakeApi.core.ItemIdentifiers = { BIG_BONES: 532, BONES: 526, NIGHTMARE_STAFF: STAFF };
  fakeApi.core.Item = class { constructor(itemId, amount) { this.itemId = itemId; this.amount = amount; } };
  fakeApi.core.ItemDefinition = { forId: () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => true }) };
  const [a, b, c] = [fakePlayer(), fakePlayer(), fakePlayer()];
  const fight = {
    phosani: false, boss: {}, dream: { tile: () => ({}), area: {} },
    contribution: new Map([[a, { shield: 1, totems: 1 }], [b, { shield: 1, totems: 1 }], [c, { shield: 97, totems: 1 }]]),
  };
  t.mock.method(Math, "random", () => 0.5); // halfway through the damage: player c's share
  Loot.reward(fight, [a, b, c]);
  const staffs = placed.filter(([, id]) => id === STAFF);
  assert.equal(staffs.length, 1, "one staff for the kill, not one each");
  assert.equal(staffs[0][0], c, "to the player whose damage the roll fell in");
  for (const player of [a, b, c]) assert.ok(placed.some(([who, id]) => who === player && id === 995), "everyone rolls the rest");
});

test("an Ironman in a team keeps their own Nightmare roll (Wiki: group-boss rewards), the real Ironman rule applied", () => {
  const Loot = require("../plugins/bosses/nightmare/Loot.Nightmare");
  const IronCommon = require("../plugins/modes/ironman/Common.Ironman");
  const events = new Map();
  const ironApi = new Proxy({
    core: fakeApi.core,
    onCustomEvent(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent(name, payload) { for (const fn of events.get(name) ?? []) fn(payload); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  IronCommon.init(ironApi);
  require("../plugins/modes/ironman/Loot.Ironman")(ironApi);
  ironApi.onCustomEvent("ironman:shared-kill-keeps", Loot.ironmanKeeps);
  fakeApi.emitCustomEvent = (name, payload) => {
    if (name === "npc-drops:roll-table") payload.drops.push({ itemId: 995, amount: 1 });
    else ironApi.emitCustomEvent(name, payload);
  };
  const placed = [];
  fakeApi.getItemOnGroundManager = () => ({ registerLocation(player, item) { placed.push([player, item.itemId]); } });
  fakeApi.core.ItemIdentifiers = { BIG_BONES: 532, BONES: 526 };
  fakeApi.core.Item = class { constructor(itemId, amount) { this.itemId = itemId; this.amount = amount; } };
  fakeApi.core.ItemDefinition = { forId: () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => true }) };
  const [iron, main] = [fakePlayer(), fakePlayer()];
  iron.setAttribute(IronCommon.MODE_ATTRIBUTE, "ironman");
  const fight = { phosani: false, boss: {}, dream: { tile: () => ({}), area: {} },
    contribution: new Map([[iron, { shield: 1, totems: 1 }], [main, { shield: 1, totems: 1 }]]) };
  Loot.reward(fight, [iron, main]);
  assert.ok(placed.some(([who, id]) => who === iron && id === 995), "the Ironman's roll is placed");
  assert.ok(placed.some(([who, id]) => who === main && id === 995));
  // Another monster's shared kill is still lost for the Ironman.
  const other = { player: iron, npc: {}, npcId: 1, drops: [{ itemId: 995, amount: 1 }], damagers: [iron, main] };
  ironApi.emitCustomEvent("npc-drops:roll", other);
  assert.deepEqual(other.drops, []);
});

test("the pet's 1/800 is shared by party size (Wiki: 1/800 solo, 1/2,400 for 3, 1/4,000 at 5 or more)", (t) => {
  const Loot = require("../plugins/bosses/nightmare/Loot.Nightmare");
  const PET = 24491;
  fakeApi.emitCustomEvent = (name, payload) => {
    if (name === "npc-drops:roll-table") payload.drops.push({ itemId: PET, amount: 1 }, { itemId: 995, amount: 1 });
  };
  const placed = [];
  fakeApi.getItemOnGroundManager = () => ({ registerLocation(player, item) { placed.push([player, item.itemId]); } });
  fakeApi.core.ItemIdentifiers = { BIG_BONES: 532, BONES: 526 };
  fakeApi.core.Item = class { constructor(itemId, amount) { this.itemId = itemId; this.amount = amount; } };
  fakeApi.core.ItemDefinition = { forId: () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => true }) };
  const fightOf = (players) => ({ phosani: false, boss: {}, dream: { tile: () => ({}), area: {} },
    contribution: new Map(players.map((player) => [player, { shield: 1, totems: 1 }])) });
  // Every table roll comes up with the pet; a roll of 0.5 keeps it only for a party of one (0.5 * 1 < 1, not 0.5 * 3).
  t.mock.method(Math, "random", () => 0.5);
  const solo = fakePlayer();
  Loot.reward(fightOf([solo]), [solo]);
  assert.equal(placed.filter(([, id]) => id === PET).length, 1, "solo: the table's 1/800 as it is");
  placed.length = 0;
  const trio = [fakePlayer(), fakePlayer(), fakePlayer()];
  Loot.reward(fightOf(trio), trio);
  assert.equal(placed.filter(([, id]) => id === PET).length, 0, "a party of three keeps it only a third of the time");
  // Five started, four have gone by the kill: the one left still shares the pet as a party of five.
  placed.length = 0;
  const last = fakePlayer();
  Loot.reward({ ...fightOf([last]), teamSize: 5 }, [last]);
  assert.equal(placed.filter(([, id]) => id === PET).length, 0, "the team counted when the fight started");
});

test("the second unique roll counts the whole party, not only the players who earned a roll (Wiki: (party size - 5)%)", (t) => {
  const Loot = require("../plugins/bosses/nightmare/Loot.Nightmare");
  const STAFF = 24422;
  fakeApi.emitCustomEvent = (name, payload) => {
    if (name === "npc-drops:roll-table") payload.drops.push({ itemId: STAFF, amount: 1 });
  };
  const placed = [];
  fakeApi.getItemOnGroundManager = () => ({ registerLocation(player, item) { placed.push([player, item.itemId]); } });
  fakeApi.core.ItemIdentifiers = { BIG_BONES: 532, BONES: 526, NIGHTMARE_STAFF: STAFF };
  fakeApi.core.Item = class { constructor(itemId, amount) { this.itemId = itemId; this.amount = amount; } };
  fakeApi.core.ItemDefinition = { forId: () => ({ getNoteId: () => -1, isNoted: () => false, isStackable: () => true }) };
  // A party of 30 (25% second roll); only two of them hit both the shield and the totems.
  const party = Array.from({ length: 30 }, () => fakePlayer());
  const fight = { phosani: false, boss: {}, teamSize: 30, dream: { tile: () => ({}), area: {} },
    contribution: new Map([[party[0], { shield: 1, totems: 1 }], [party[1], { shield: 1, totems: 1 }]]) };
  t.mock.method(Math, "random", () => 0.2); // 20 < 25: the second roll happens for a party of 30
  Loot.reward(fight, party);
  assert.equal(placed.filter(([, id]) => id === STAFF).length, 2, "both unique rolls, by the party's size");
});

const SPORE_INFECTED = "<col=ff289d>The Nightmare's spores have infected you, making you feel drowsy!</col>";
const SPORE_REINFECTED = "<col=ff289d>The Nightmare's spores have reinfected you, making you feel drowsy!</col>";
const SPORE_WORN = "<col=229628>The Nightmare's infection has worn off.</col>";
const SPORE_SUMMONED = "<col=a53fff>The Nightmare summons some infectious spores!</col>";

function sporeFight(t, phosani = false) {
  const packets = [];
  const objects = new Set();
  const players = [];
  const achievements = [];
  const location = (x, y) => ({ getX: () => x, getY: () => y, getZ: () => 0 });
  const movement = { setBlockMovement: () => movement, reset() {} };
  const fight = Object.assign(Object.create(Fight.Fight.prototype), {
    phosani, tick: 0, events: [], phase: 1, phaseCount: 3, hitpoints: 3200,
    stage: "totems", nextAttackTick: Infinity, totems: [], curse: new Map(),
    drowsy: new Map(), parasites: new Map(), frozen: new Map(), minions: new Set(), walkers: [],
    dream: { tile: ([x, y]) => location(x, y), arenaTile: (loc) => [loc.getX(), loc.getY()] },
    players: () => players,
    boss: {
      isRegistered: () => true, getCombat: () => ({ getLastAttack: () => ({ reset() {} }) }),
      moveTo() {}, performAnimation() {}, performGraphic() {}, showHitsplat() {},
      getMovementQueue: () => movement, setUntargetable() {},
      setNpcTransformationId: (id) => packets.push([fight.tick, "form", id]),
    },
    healthBar() {}, updateHud() {}, won() {},
  });
  t.after(() => Common.init(fakeApi));
  Common.init({
    ...fakeApi,
    emitCustomEvent(name, event) {
      if (name === "combat-achievements:complete") achievements.push(event);
    },
    core: {
      ...fakeApi.core,
      GameObject: class {
        constructor(id, loc) { this.id = id; this.loc = loc; }
        getLocation() { return this.loc; }
      },
      Animation: class { constructor(id) { this.id = id; } },
      Graphic: class { constructor(id) { this.id = id; } },
      ObjectManager: { register: (obj) => objects.add(obj), deregister: (obj) => objects.delete(obj) },
      ChatType: { SPAM: 105 },
      Skill: { PRAYER: 5 },
    },
  });
  t.mock.method(Claws, "chain", () => {});
  t.mock.method(Sleepwalkers, "summon", () => {});

  function addPlayer() {
    const player = fakePlayer();
    player.tile = location(0, 0);
    player.running = true;
    const record = (kind, ...args) => packets.push([fight.tick, kind, ...args]);
    Object.assign(player, {
      getLocation: () => player.tile, move: (x, y) => { player.tile = location(x, y); },
      isRegistered: () => true, isPlayer: () => true,
      isRunningReturn: () => player.running, setRunning: (running) => { player.running = running; },
      sendMessage: (text) => record("game", text), forceChat: (text) => record("overhead", text),
      getSkillManager: () => ({ getCurrentLevel: () => 85, setCurrentLevel() {} }),
      getPacketSender: () => ({
        sendConfig: (...args) => record("varp", ...args),
        sendTypedMessage: (type, text) => record(type, text),
        sendObjectAnimation: (object, anim) => record("loc", object.__sporeTile, anim.id),
        sendAreaSound: (id, x, y, z, volume, delay, range) => record("area sound", id, delay, range),
        sendSoundEffect() {}, sendClientScript() {}, closeSubInterface() {},
      }),
    });
    players.push(player);
    return player;
  }

  function tick(move) {
    fight.process();
    move?.();
    for (const player of players) fight.processPlayer(player);
  }
  function until(target) {
    while (fight.tick < target) tick();
  }
  const lines = () => packets.filter(([, type, text]) => type === "game" && [SPORE_INFECTED, SPORE_REINFECTED, SPORE_WORN].includes(text));
  const bursts = () => packets.filter(([, type, , anim]) => type === "loc" && anim === 8632);
  return { fight, packets, objects, addPlayer, tick, until, lines, bursts, achievements };
}

test("re-infection restarts the 25-tick duration and skips the yawn due on that tick", (t) => {
  t.mock.method(Common, "pick", () => [[5, 5], [10, 10]]);
  const { fight, packets, addPlayer, tick, until, lines, bursts } = sporeFight(t);
  const player = addPlayer();
  player.move(5, 5);
  Spores.start(fight);
  until(6);
  assert.deepEqual(lines(), [[6, "game", SPORE_INFECTED]]);
  assert.deepEqual(packets.filter(([, kind]) => kind === "varp"), [[6, "varp", 173, 0]]);
  until(18);
  tick(() => player.move(10, 10));
  until(20);
  assert.deepEqual(bursts().map(([tick]) => tick), [6, 20]);
  until(44);
  assert.equal(Specials.drowsyDelay(fight, player), 1);
  until(45);
  assert.equal(Specials.drowsyDelay(fight, player), 0);
  assert.deepEqual(lines(), [[6, "game", SPORE_INFECTED], [20, "game", SPORE_REINFECTED], [45, "game", SPORE_WORN]]);
  assert.deepEqual(packets.filter(([, kind]) => kind === "overhead"),
    [8, 14, 22, 28, 34, 40].map((tick) => [tick, "overhead", "*yawn*"]));
});

test("re-infection sends its own game message (rsprox 1764 11483)", (t) => {
  const { fight, addPlayer, until, lines } = sporeFight(t);
  const player = addPlayer();
  Specials.makeDrowsy(fight, player);
  until(14);
  Specials.makeDrowsy(fight, player);
  assert.deepEqual(lines(), [[0, "game", SPORE_INFECTED], [14, "game", SPORE_REINFECTED]]);
});

test("two spores arm at +5 and a player beside both bursts them at +6 after stepping away", (t) => {
  t.mock.method(Common, "pick", () => [[5, 5], [6, 6]]);
  const { fight, packets, objects, addPlayer, tick, until, lines, bursts } = sporeFight(t);
  const player = addPlayer();
  player.move(5, 5);
  Spores.start(fight);
  until(5);
  assert.deepEqual([...objects].map(({ id }) => id), [37739, 37739]);
  assert.deepEqual(lines(), []);
  tick(() => {
    assert.ok(player.running, "movement runs before the infection consumes the pending burst");
    player.move(8, 8);
  });
  assert.deepEqual(bursts(), [[6, "loc", [5, 5], 8632], [6, "loc", [6, 6], 8632]]);
  assert.deepEqual(packets.filter(([, kind]) => kind === "area sound"), [
    [6, "area sound", 4273, 12, 5], [6, "area sound", 4273, 12, 5],
  ]);
  assert.deepEqual(lines(), [[6, "game", SPORE_INFECTED]]);
  assert.deepEqual(packets.filter(([tick]) => tick === 6).map(([, kind]) => kind),
    ["game", "varp", "loc", "area sound", "loc", "area sound"]);
});

test("the thirtieth-tick mass burst checks the previous tile for infection", (t) => {
  t.mock.method(Common, "pick", () => [[5, 5], [6, 5]]);
  const { fight, addPlayer, tick, until, lines, bursts } = sporeFight(t, true);
  const near = addPlayer();
  const far = addPlayer();
  Spores.start(fight);
  until(28);
  tick(() => {
    near.move(4, 5);
    far.move(8, 5);
  });
  assert.deepEqual(bursts(), [], "arriving beside a spore on tick 29 does not burst it yet");
  tick(() => near.move(2, 5));
  assert.deepEqual(lines(), [[30, "game", SPORE_INFECTED]]);
  assert.equal(Specials.drowsyDelay(fight, near), 2);
  assert.equal(Specials.drowsyDelay(fight, far), 0);
  assert.equal(bursts().length, 4, "both players see both bursts");
});

test("Phosani's spores survive the charge, then burst at the blast and end drowsiness silently", (t) => {
  t.mock.method(Common, "pick", () => [[5, 5], [9, 9], [10, 9]]);
  const { fight, packets, objects, addPlayer, tick, until, lines, bursts } = sporeFight(t, true);
  const player = addPlayer();
  Spores.start(fight);
  until(7);
  fight.totemsCharged();
  assert.deepEqual([...objects].map(({ id }) => id), [37739, 37739, 37739]);
  tick(() => player.move(5, 5));
  until(11);
  assert.deepEqual(lines(), [[9, "game", SPORE_INFECTED]]);
  tick(() => player.move(9, 9));
  until(13);
  assert.ok(packets.some(([tick, kind, id]) => tick === 13 && kind === "form" && id === 9422));
  assert.deepEqual(bursts(), [[9, "loc", [5, 5], 8632], [13, "loc", [9, 9], 8632], [13, "loc", [10, 9], 8632]]);
  assert.equal(Specials.drowsyDelay(fight, player), 0);
  player.running = true;
  until(40);
  assert.ok(player.running);
  assert.deepEqual(lines(), [[9, "game", SPORE_INFECTED]]);
  assert.deepEqual(packets.filter(([, kind]) => kind === "overhead"), [[11, "overhead", "*yawn*"]]);
  assert.equal(objects.size, 0);
});

test("the Nightmare's last totem blast bursts the spores four ticks after the charge", (t) => {
  t.mock.method(Common, "pick", () => [[5, 5]]);
  const { fight, addPlayer, until, lines, bursts } = sporeFight(t);
  const player = addPlayer();
  fight.phase = fight.phaseCount;
  Spores.start(fight);
  until(7);
  Specials.makeDrowsy(fight, player);
  fight.totemsCharged();
  until(10);
  assert.deepEqual(bursts(), []);
  until(11);
  assert.deepEqual(bursts(), [[11, "loc", [5, 5], 8632]]);
  assert.equal(Specials.drowsyDelay(fight, player), 0);
  until(34);
  assert.deepEqual(lines(), [[7, "game", SPORE_INFECTED]]);
});

test("Phosani's death ends a re-infection silently without clearing its achievement failure", (t) => {
  const { fight, packets, addPlayer, until, lines, achievements } = sporeFight(t, true);
  const player = addPlayer();
  Specials.makeDrowsy(fight, player);
  CombatAchievements.sporesSlowed(fight, player);
  until(13);
  fight.at(1, () => Specials.makeDrowsy(fight, player));
  until(25);
  assert.equal(Specials.drowsyDelay(fight, player), 2);
  fight.dying();
  assert.equal(Specials.drowsyDelay(fight, player), 0);
  until(42);
  assert.deepEqual(lines(), [[0, "game", SPORE_INFECTED], [14, "game", SPORE_REINFECTED]], "no worn-off line after her death");
  assert.deepEqual(packets.filter(([, kind]) => kind === "overhead"),
    [2, 8, 16, 22].map((tick) => [tick, "overhead", "*yawn*"]));
  CombatAchievements.judge(fight, player);
  const tasks = achievements.filter((event) => event.player === player).map(({ task }) => task);
  assert.ok(tasks.includes("I Would Simply React"), "the achievement event collector receives this player's awards");
  assert.ok(!tasks.includes("Perfect Phosani's Nightmare"), "the spore failure survived re-infection");
});

test("the spore summon line is spam with its original colour and text", (t) => {
  const { fight, packets, addPlayer, until } = sporeFight(t);
  addPlayer();
  Spores.start(fight);
  until(2);
  assert.deepEqual(packets.filter(([, , text]) => text === SPORE_SUMMONED), [[2, 105, SPORE_SUMMONED]]);
});
