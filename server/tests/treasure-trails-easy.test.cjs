const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const plugin = require("../plugins/treasuretrails/TreasureTrails.plugin");
const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
const Dialogue = require("../plugins/treasuretrails/trails/Dialogue.TreasureTrails");
const Caskets = require("../plugins/treasuretrails/trails/Caskets.TreasureTrails");
const Stash = require("../plugins/treasuretrails/trails/Stash.TreasureTrails");
const Catalogue = require("../plugins/treasuretrails/trails/Catalogue.TreasureTrails");
const { TIERS, byName } = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails");
const TABLES = require("../data/definitions/clue-caskets.json").tables;
const EASY = byName.get("easy");
const I = core.ItemIdentifiers;
const Screen = require("../plugins/treasuretrails/CasketRewardScreen.plugin");
Screen.initialize(core);

function fixture() {
  const actions = new Map(), events = new Map(), attributes = new Map(), sent = [], ground = [], spawned = [];
  let position = new core.Location(3222, 3218, 0), chain, placed = 0;
  const items = Array(28).fill(null), worn = [];
  const inventory = {
    getItems: () => items, refreshItems() {}, setItem(slot, item) { items[slot] = item; return inventory; },
    getFreeSlots: () => items.filter(i => !i).length, isFull() { return this.getFreeSlots() === 0; },
    delete(id, amount) { while (amount > 0) { const slot = items.findIndex(i => i?.getId() === id); if (slot < 0) return; const take = Math.min(amount, items[slot].getAmount()); this.deleteAtSlot(slot, take); amount -= take; } },
    deleteAtSlot(slot, amount) { const item = items[slot]; if (!item) return; if (item.getAmount() <= amount) items[slot] = null; else item.setAmount(item.getAmount() - amount); },
    adds(id, amount) { this.forceAdd(null, new core.Item(id, amount)); },
    forceAdd(player, item) { const slot = items.findIndex(i => !i); if (slot < 0) ground.push(item); else items[slot] = item; },
  };
  const sender = new Proxy({}, { get: (_, name) => (...args) => (sent.push([name, ...args]), sender) });
  const skills = { level: 1, xp: 0, getCurrentLevel() { return this.level; }, addExperiences(skill, xp) { this.xp += xp; } };
  const player = { getInventory: () => inventory, getSkillManager: () => skills, getEquipment: () => ({ getItems: () => worn }),
    getPacketSender: () => sender, getLocation: () => position, getPrivateArea: () => null, isPlayer: () => true, getAsPlayer: () => player,
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: message => sent.push(["message", message]), performAnimation: value => sent.push(["animation", value]),
    getDialogueManager: () => ({ startDialogues: value => { chain = value; } }) };
  const api = { core, persistAttribute() {}, onItemAction: (name, handlers) => actions.set(name, { ...actions.get(name), ...handlers }),
    onBeforeNpcInteraction() {}, onItemOnNpc() {}, onBeforeObjectInteraction() {}, onCanUseItem() {},
    onCustomEvent: (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent: (name, request) => { for (const fn of events.get(name) ?? []) fn(request); },
    onPlayerLogout() {}, onPlayerDisconnect() {}, onPlayerLogin() {}, onPlayerDeath() {}, onNpcDeath() {}, onInterfaceActionButton() {},
    spawnNpc: def => { const npc = { getLocation: () => new core.Location(def.x, def.y, def.z), def }; spawned.push(npc); return npc; },
    removeNpc: npc => { npc.removed = true; }, getRegionManager: () => ({ blocked: () => false, canMovestart: () => true }) };
  plugin.register(api);
  // ClueCapacity answers milestones in the game; the casket must refuse to open without it.
  api.onCustomEvent("treasure-trails:milestone-rewards", request => { request.handled = true; });
  // ...and answers for its scroll cases, which it pays itself.
  api.onCustomEvent("treasure-trails:case-eligible", request => {
    if (/scroll case/i.test(core.ItemDefinition.forId(request.itemId)?.getName?.() ?? "")) request.eligible = false;
  });
  function place(step, length = 2, slot = 0) {
    items[slot] = new core.Item(step.itemId, 1).setMetaValue(Runtime.metaKey(EASY),
      { version: 1, token: `t${slot}-${++placed}`, revision: 0, completed: 0, length, row: step.row });
    position = new core.Location(step.location.x, step.location.y, step.location.z);
    return Runtime.trails(player).find(trail => trail.slot === slot);
  }
  return { player, items, worn, skills, on: api.onCustomEvent, attributes, actions, sent, ground, spawned, place,
    event: (slot = 0) => ({ player, slot, item: items[slot], itemId: items[slot]?.getId() }),
    move: target => { position = new core.Location(target.x, target.y, target.z); },
    finish: () => { const current = chain; chain = null; for (const d of current?.getDialogues().values() ?? []) if (d instanceof core.ActionDialogue) d.send(player); },
  };
}

const steps = () => Runtime.data(EASY).steps;
const ofFamily = (family, target) => steps().filter(step => step.family === family && (!target || step.target === target));

test("clue catalogues load during registration, before any player interaction", t => {
  const load = t.mock.method(Catalogue, "load");
  const f = fixture();
  assert.deepEqual(load.mock.calls.map(call => call.arguments[1].name), TIERS.map(tier => tier.name));
  load.mock.mockImplementation(() => { throw new Error("Catalogue loaded during gameplay"); });
  f.items.fill(new core.Item(-1, 0));
  const event = { player: f.player, objectId: -1, location: { x: 0, y: 0, z: 0 }, handled: false };
  Runtime.search(event);
  Stash.interact(event);
  assert.equal(event.handled, false);
  for (const tier of TIERS) {
    f.items[0] = new core.Item(I[`CLUE_SCROLL_${tier.name.toUpperCase()}_`], 1);
    assert.equal(f.actions.get(`Clue scroll (${tier.name})`).Read(f.event()), true);
  }
});

test("conditional object interceptors run before earlier object handlers and can fall through", () => {
  const api = PluginManager.createApi("TreasureTrailsHookContract");
  const calls = [];
  api.onObjectInteraction(event => { calls.push("ordinary"); event.handled = true; });
  api.onBeforeObjectInteraction(event => { calls.push("before"); if (event.player.match) event.handled = true; });
  const object = { getDefinition: () => ({ getName: () => "Crate", getInteractions: () => ["Search"] }) };
  assert.equal(PluginManager.emitObjectInteraction({ player: { match: true }, object, objectId: 1, clickType: 1, location: { x: 0, y: 0, z: 0 }, handled: false }), true);
  assert.deepEqual(calls, ["before"]);
  calls.length = 0;
  PluginManager.emitObjectInteraction({ player: {}, object, objectId: 1, clickType: 1, location: { x: 0, y: 0, z: 0 }, handled: false });
  assert.deepEqual(calls, ["before", "ordinary"]);
});

test("every easy step is a distinct cache clue item with a solvable target", () => {
  fixture();
  const data = Runtime.data(EASY);
  // Rev 242: item 3499's clue (param 623) moved from row 1327 ("Search the boxes in a shop in Taverley.",
  // now row 17195, which no easy clue item names) to row 1328, the Duke's bedroom chest that item 2677
  // already gives, so the cache has one easy step (a cryptic loc) fewer than 241's 166.
  assert.equal(data.steps.length, 165);
  for (const [family, target, count] of [["cryptic", "npc", 41], ["cryptic", "loc", 70], ["cryptic", "coord", 8], ["emote", "coord", 33], ["map", "coord", 7], ["music", "npc", 6]])
    assert.equal(ofFamily(family, target).length, count, `${family}/${target}`);
  assert.equal(new Set(data.steps.map(step => step.itemId)).size, data.steps.length);
  for (const step of data.steps) {
    assert.equal(core.ItemDefinition.forId(step.itemId).getName(), "Clue scroll (easy)", step.key);
    if (step.target === "npc") assert.ok(step.npcIds.length, step.key);
    if (step.target === "loc") assert.ok(step.locIds.length, step.key);
    if (step.family === "emote") assert.ok(step.emotes.length === 1 && step.equipment.length && step.equipment.every(r => r.anyOf?.length || r.emptySlot != null), step.key);
    if (step.family === "music") assert.ok(Number.isInteger(step.midi) && step.track, step.key);
    if (step.family === "map") assert.ok(step.interfaceId != null, `${step.key} has no map interface`);
  }
  assert.equal(data.scroll, I.CLUE_SCROLL_EASY_);
  assert.equal(data.casket, I.REWARD_CASKET_EASY_);
  assert.equal(data.uri, core.CacheDefinitions.getNpcId("trail_easy_uri"));
});

test("a fresh easy scroll starts a 2-4 step trail on a random step once, and rereading keeps it", () => {
  const f = fixture();
  for (const [random, length] of [[0, 2], [0.33, 2], [0.34, 3], [0.66, 3], [0.67, 4], [0.9999, 4]]) assert.equal(Runtime.trailLength(EASY, () => random), length);
  f.items[0] = new core.Item(I.CLUE_SCROLL_EASY_, 1);
  assert.equal(f.actions.get("Clue scroll (easy)").Read(f.event()), true);
  const first = f.items[0];
  const state = first.getMetaValue(Runtime.metaKey(EASY));
  assert.equal(Runtime.data(EASY).byItem.get(first.getId()).row, state.row);
  assert.ok(state.length >= 2 && state.length <= 4 && state.completed === 0);
  f.actions.get("Clue scroll (easy)").Read(f.event());
  assert.equal(f.items[0], first);
  assert.deepEqual(f.items[0].getMetaValue(Runtime.metaKey(EASY)), state);
  f.actions.get("Clue scroll (easy)")["Check steps"](f.event());
  assert.deepEqual(f.sent.at(-1), ["message", "You have completed 0 steps on this easy Treasure Trail."]);
});

test("a solved step hands over another step item, and the last step a reward casket", () => {
  const f = fixture();
  const [step] = ofFamily("cryptic", "coord");
  const trail = f.place(step, 2);
  assert.equal(Runtime.advance(f.player, trail, () => 0.5), true);
  const next = f.items[0].getMetaValue(Runtime.metaKey(EASY));
  assert.deepEqual([next.completed, next.length, next.token], [1, 2, "t0-1"]);
  assert.equal(Runtime.data(EASY).byRow.get(next.row).itemId, f.items[0].getId());
  assert.equal(Runtime.advance(f.player, trail), false, "a stale snapshot cannot advance twice");
  Runtime.advance(f.player, Runtime.trails(f.player)[0]);
  assert.equal(f.items[0].getId(), I.REWARD_CASKET_EASY_);
});

test("every NPC cryptic step completes only after its dialogue, even if the NPC wanders off", () => {
  const f = fixture();
  for (const step of ofFamily("cryptic", "npc")) {
    f.items.fill(null);
    f.place(step, 2);
    // The NPC has wandered five tiles away by the time the dialogue ends.
    const npc = { getLocation: () => new core.Location(f.player.getLocation().getX() + 5, f.player.getLocation().getY(), f.player.getLocation().getZ()) };
    const event = { player: f.player, npcId: step.npcIds[0], npc, clickType: 1, handled: false, definition: { getActions: () => ["Talk-to"] } };
    Runtime.talk(event);
    assert.equal(event.handled, true, step.key);
    assert.equal(f.items[0].getId(), step.itemId);
    f.finish();
    assert.notEqual(f.items[0].getMetaValue(Runtime.metaKey(EASY)).completed, 0, step.key);
  }
  const other = { player: f.player, npcId: I.COINS, npc: {}, clickType: 1, handled: false, definition: { getActions: () => ["Talk-to"] } };
  Runtime.talk(other);
  assert.equal(other.handled, false);
});

test("every searched object step needs the exact object at the exact tile", () => {
  const f = fixture();
  for (const step of ofFamily("cryptic", "loc")) {
    f.items.fill(null);
    f.place(step, 2);
    const wrongTile = { player: f.player, objectId: step.locIds[0], location: { ...step.location, x: step.location.x + 1 }, handled: false };
    Runtime.search(wrongTile);
    assert.equal(wrongTile.handled, false, step.key);
    const right = { player: f.player, objectId: step.locIds[0], location: step.location, handled: false };
    Runtime.search(right);
    assert.equal(right.handled, true, step.key);
    assert.equal(f.items[0].getMetaValue(Runtime.metaKey(EASY)).completed, 1, step.key);
  }
});

test("dig and map steps dig only on the exact tile and plane with a spade", () => {
  const f = fixture();
  for (const step of [...ofFamily("cryptic", "coord"), ...ofFamily("map")]) {
    f.items.fill(null);
    f.place(step, 2);
    f.items[1] = new core.Item(I.SPADE, 1);
    const dig = () => { const event = { player: f.player, itemId: I.SPADE, option: "Dig", allow: true }; Runtime.dig(event); return event.allow; };
    f.move({ ...step.location, z: step.location.z + 1 });
    assert.equal(dig(), true, step.key);
    f.move(step.location);
    assert.equal(dig(), false, step.key);
    assert.equal(f.items[0].getMetaValue(Runtime.metaKey(EASY)).completed, 1, step.key);
  }
});

test("every emote step needs the location and the outfit (or nothing worn), then personal Uri", () => {
  const f = fixture();
  for (const step of ofFamily("emote")) {
    f.items.fill(null); f.worn.length = 0; f.spawned.length = 0;
    f.place(step, 2);
    // Boots alone are the wrong outfit for every step, including "nothing equipped at all".
    f.worn.push(new core.Item(I.LEATHER_BOOTS, 1));
    Runtime.emote({ player: f.player, slot: step.emotes[0] });
    assert.equal(f.spawned.length, 0, `${step.key} spawned Uri without the outfit`);
    f.worn.length = 0;
    f.worn.push(...step.equipment.filter(requirement => requirement.anyOf).map(requirement => new core.Item(requirement.anyOf[0], 1)));
    Runtime.emote({ player: f.player, slot: step.emotes[0] + 1000 });
    assert.equal(f.spawned.length, 0, `${step.key} accepted the wrong emote`);
    Runtime.emote({ player: f.player, slot: step.emotes[0] });
    assert.equal(f.spawned.length, 1, step.key);
    const event = { player: f.player, npcId: f.spawned[0].def.id, npc: f.spawned[0], clickType: 1, handled: false, definition: { getActions: () => ["Talk-to"] } };
    Runtime.talk(event);
    assert.equal(event.handled, true, step.key);
    f.finish();
    assert.equal(f.items[0].getMetaValue(Runtime.metaKey(EASY)).completed, 1, step.key);
    assert.equal(f.spawned[0].removed, true);
  }
});

test("every music step needs its own track playing when Cecilia is spoken to", () => {
  const f = fixture();
  const speak = step => {
    const event = { player: f.player, npcId: step.npcIds[0], npc: { getLocation: () => f.player.getLocation() }, clickType: 1, handled: false,
      definition: { getActions: () => ["Talk-to"] } };
    Runtime.talk(event);
    assert.equal(event.handled, true, step.key);
    f.finish();
  };
  for (const step of ofFamily("music")) {
    f.items.fill(null);
    f.place(step, 2);
    const other = ofFamily("music").find(entry => entry.midi !== step.midi);
    Runtime.songPlayed({ player: f.player, trackId: other.midi });
    speak(step);
    assert.equal(f.items[0].getMetaValue(Runtime.metaKey(EASY)).completed, 0, step.key);
    Runtime.songPlayed({ player: f.player, trackId: step.midi });
    speak(step);
    assert.equal(f.items[0].getMetaValue(Runtime.metaKey(EASY)).completed, 1, step.key);
    assert.match(Runtime.clueText(step), new RegExp(`play:<br>${step.track}<br>Thanks,<br>Cecilia`));
  }
});

test("the imported easy table rolls 2-4 resolvable rewards and the casket opens once", () => {
  const f = fixture();
  const table = TABLES.easy;
  assert.deepEqual(table.rolls, [2, 4]);
  assert.equal(table.casket_item_id, I.REWARD_CASKET_EASY_);
  assert.equal(table.entries.reduce((sum, entry) => sum + entry.weight, 0), table.out_of);
  assert.doesNotThrow(() => Caskets.prepareDrops(table.entries.map(entry => ({ itemId: entry.item_id, amount: entry.quantity[0], noted: entry.noted })), EASY));
  f.items[0] = new core.Item(I.REWARD_CASKET_EASY_, 1);
  const event = f.event();
  assert.equal(Caskets.open(event), true);
  assert.notEqual(f.items[0]?.getId(), I.REWARD_CASKET_EASY_);
  assert.equal(f.attributes.get(Runtime.completedAttribute(EASY)), 1);
  Screen.closed({ player: f.player, interfaceId: 73 });
  const granted = f.items.filter(Boolean).length + f.ground.length;
  assert.ok(granted >= 1, "rewards were given");
  assert.equal(Caskets.open(event), false, "the opened casket cannot be opened again");
});

test("opening an ordinary casket asks drops:chance once and applies its boost to the uniques", () => {
  // Easy uniques are 8.8% of the pool, 32.6% at 5x: every roll at 0.2 misses them unboosted.
  const uniques = new Set(TABLES.easy.entries.filter(row => /clue uniques$/i.test(row.section)).map(row => row.item_id));
  const openAt = (boost) => {
    const f = fixture(), asked = [];
    f.on("drops:chance", request => {
      asked.push(request);
      if (boost) request.rules.push({ pattern: /.*/, multiplier: boost });
    });
    f.items[0] = new core.Item(I.REWARD_CASKET_EASY_, 1);
    const random = Math.random;
    Math.random = () => 0.2;
    try { assert.equal(Caskets.open(f.event()), true); } finally { Math.random = random; }
    assert.equal(f.attributes.get(Runtime.completedAttribute(EASY)), 1, "the casket opened");
    Screen.closed({ player: f.player, interfaceId: 73 });
    return { asked, given: [...f.items.filter(Boolean), ...f.ground].map(item => item.getId()), player: f.player };
  };
  const plain = openAt(null);
  assert.equal(plain.asked.length, 1, "one question per casket");
  assert.equal(plain.asked[0].player, plain.player);
  assert.equal(plain.asked[0].source, "treasure-trails-casket");
  assert.ok(plain.given.every(id => !uniques.has(id)), "no rule: the ordinary odds");
  const boosted = openAt(5);
  assert.ok(boosted.given.some(id => uniques.has(id)), "a 5x rule makes the same roll a unique");
});

test("an easy casket stays shut, and is kept, without a canonical table", () => {
  const f = fixture();
  const saved = TABLES.easy;
  try {
    delete TABLES.easy;
    f.items[0] = new core.Item(I.REWARD_CASKET_EASY_, 1);
    assert.equal(Caskets.open(f.event()), true);
    assert.equal(f.items[0].getId(), I.REWARD_CASKET_EASY_);
    assert.equal(f.attributes.get(Runtime.completedAttribute(EASY)), undefined);
  } finally {
    TABLES.easy = saved;
  }
});

test("Entrana removes weapon, armour and easy-unique rolls but keeps shared rewards", () => {
  fixture();
  const sections = new Map(TABLES.easy.entries.map(entry => [entry.item_id, entry.section]));
  const kept = new Set(Caskets.entranaTable(TABLES.easy).entries.map(entry => entry.section));
  assert.deepEqual([...kept].sort(), ["Food", "Runes", "Shared treasure trail items"]);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++)
    for (const drop of Caskets.roll(EASY, { entrana: true, random }))
      if (sections.has(drop.itemId)) assert.ok(!/Weapons and armour|Easy clue uniques/.test(sections.get(drop.itemId)), String(drop.itemId));
});

test("the 1/50 master clue obeys clue capacity and becomes a box after X Marks the Spot", () => {
  const f = fixture();
  assert.ok(Caskets.roll(EASY, { random: () => 0 }).some(drop => drop.itemId === I.CLUE_SCROLL_MASTER_));
  assert.ok(!Caskets.roll(EASY, { random: () => 0.9999 }).some(drop => drop.itemId === I.CLUE_SCROLL_MASTER_));
  const drop = { itemId: I.CLUE_SCROLL_MASTER_, amount: 1, noted: false };
  let allowed = false, box = false;
  // Stand-ins for ClueCapacity's answers.
  f.on("treasure-trails:can-receive", request => { request.allowed = allowed; });
  f.on("treasure-trails:clue-item", request => { if (box) request.itemId = I.SCROLL_BOX_MASTER_; });
  assert.deepEqual(Caskets.clueRewards(f.player, [drop]), [], "at capacity the clue is not given");
  allowed = true;
  assert.deepEqual(Caskets.clueRewards(f.player, [drop]).map(entry => entry.itemId), [I.CLUE_SCROLL_MASTER_]);
  box = true;
  assert.deepEqual(Caskets.clueRewards(f.player, [drop]).map(entry => entry.itemId), [I.SCROLL_BOX_MASTER_]);
});

test("the Large spade comes with the 500th easy casket, while scroll cases stay with ClueCapacity", () => {
  const f = fixture();
  const ids = count => Caskets.itemMilestones(f.player, EASY, count).map(drop => drop.itemId);
  assert.deepEqual(ids(500), [I.LARGE_SPADE]);
  assert.deepEqual(ids(499), []);
  f.attributes.set(Runtime.completedAttribute(EASY), 499);
  f.items[0] = new core.Item(I.REWARD_CASKET_EASY_, 1);
  Caskets.open(f.event());
  assert.equal(f.attributes.get(Runtime.completedAttribute(EASY)), 500);
  Screen.closed({ player: f.player, interfaceId: 73 });
  assert.ok([...f.items, ...f.ground].some(item => item?.getId() === I.LARGE_SPADE));
});

// Wiki (Large spade): "If lost, it can be re-obtained by completing another easy clue scroll."
test("a lost Large spade comes back with any later easy casket, but not while the player still has one", () => {
  const f = fixture();
  const ids = count => Caskets.itemMilestones(f.player, EASY, count).map(drop => drop.itemId);
  assert.deepEqual(ids(501), [I.LARGE_SPADE], "past 500 with none: given again");
  assert.deepEqual(ids(400), [], "not before the milestone");
  f.items[3] = new core.Item(I.LARGE_SPADE, 1);
  assert.deepEqual(ids(501), [], "carried");
  f.items[3] = null;
  f.worn[3] = new core.Item(I.LARGE_SPADE, 1);
  assert.deepEqual(ids(501), [], "worn");
  f.worn[3] = null;
  const bank = [new core.Item(I.LARGE_SPADE, 1)];
  f.player.getBank = tab => ({ getItems: () => (tab === 2 ? bank : []) });
  assert.deepEqual(ids(501), [], "banked");
  bank[0] = new core.Item(I.LARGE_SPADE, 0);
  assert.deepEqual(ids(501), [I.LARGE_SPADE], "a bank placeholder is not the spade");
  f.player.getBank = tab => ({ getItems: () => (tab === core.Bank.BANK_SEARCH_TAB_INDEX ? [new core.Item(I.LARGE_SPADE, 1)] : []) });
  assert.deepEqual(ids(501), [I.LARGE_SPADE], "the search tab is not storage");
  delete f.player.getBank;
  // Opened twice before closing the reward screen: the first spade is still waiting there.
  f.attributes.set(Runtime.completedAttribute(EASY), 600);
  f.items[0] = new core.Item(I.REWARD_CASKET_EASY_, 2);
  Caskets.open(f.event());
  Caskets.open(f.event());
  Screen.closed({ player: f.player, interfaceId: 73 });
  assert.equal([...f.items, ...f.ground].filter(item => item?.getId() === I.LARGE_SPADE).length, 1, "one spade from two caskets");
});

test("an easy STASH unit is built with Construction 27, then stores and returns its full outfit", () => {
  const f = fixture();
  const units = [...Stash.stashes().values()].filter(unit => unit.tier === EASY);
  assert.equal(units.length, 31);
  const unit = units[0];
  const locId = unit.step.stash.locId;
  const use = () => { const event = { player: f.player, objectId: locId, location: unit.location, handled: false }; Stash.interact(event); return event.handled; };
  f.items.fill(null);
  [[I.HAMMER, 1], [I.SAW, 1], [I.PLANK, 2], [I.DRAGON_NAILS, 10]].forEach(([id, amount], slot) => { f.items[slot] = new core.Item(id, amount); });
  f.skills.level = 26;
  assert.equal(use(), true);
  assert.deepEqual(f.attributes.get(Stash.BUILT_ATTRIBUTE), undefined, "level 26 cannot build");
  f.skills.level = 27;
  use();
  assert.deepEqual(f.attributes.get(Stash.BUILT_ATTRIBUTE), undefined, "dragon nails do not work");
  f.items[4] = new core.Item(I.BRONZE_NAILS, 10);
  use();
  assert.deepEqual(f.attributes.get(Stash.BUILT_ATTRIBUTE), [locId]);
  assert.equal(f.skills.xp, 150);
  assert.ok(f.items.every(item => !item || ![I.PLANK, I.BRONZE_NAILS].includes(item.getId())));
  assert.ok(f.sent.some(([name, varbit, value]) => name === "sendVarbit" && varbit === unit.varbit && value === 1));
  f.items.fill(null);
  const outfit = unit.step.equipment.filter(requirement => requirement.anyOf).map(requirement => requirement.anyOf[0]);
  outfit.slice(1).forEach((id, slot) => { f.items[slot] = new core.Item(id, 1); });
  use();
  assert.equal(f.attributes.get(Stash.STORED_ATTRIBUTE), undefined, "a partial outfit is not stored");
  f.items[20] = new core.Item(outfit[0], 1);
  use();
  assert.deepEqual([...f.attributes.get(Stash.STORED_ATTRIBUTE)[locId]].sort(), [...outfit].sort());
  assert.ok(f.items.every(item => !item));
  f.items.fill(new core.Item(I.COINS, 1));
  use();
  assert.ok(f.attributes.get(Stash.STORED_ATTRIBUTE)[locId], "a full inventory keeps the stored outfit");
  f.items.fill(null);
  use();
  assert.equal(f.attributes.get(Stash.STORED_ATTRIBUTE)[locId], undefined);
  assert.deepEqual(f.items.filter(Boolean).map(item => item.getId()).sort(), [...outfit].sort());
});

test("\"Have nothing equipped at all\" steps accept only an empty outfit", () => {
  const f = fixture();
  const bare = steps().filter(step => step.family === "emote" && step.equipment.every(requirement => requirement.emptySlot != null));
  assert.deepEqual(bare.map(step => step.key).sort(), ["cluehelper_emote_easy_20", "cluehelper_emote_easy_5"]);
  for (const step of bare) {
    f.place(step, 2);
    f.worn.length = 0;
    assert.equal(Runtime.emoteReady(f.player, step), true, step.key);
    f.worn.push(new core.Item(I.GOLD_RING, 1));
    assert.equal(Runtime.emoteReady(f.player, step), false, step.key);
  }
});

test("a dig that gives the next easy clue plays the dig sound and says \"You've found another clue!\"", t => {
  const boxes = [];
  t.mock.method(Dialogue, "itemBox", (player, itemId, text) => boxes.push(text));
  const f = fixture();
  f.place(ofFamily("map", "coord")[0], 3);
  f.items[1] = new core.Item(I.SPADE, 1);
  const event = { player: f.player, itemId: I.SPADE, option: "Dig", allow: true };
  Runtime.dig(event);
  assert.equal(event.allow, false);
  assert.ok(f.sent.some(([kind, id]) => kind === "sendSoundEffect" && id === 1470), "dig sound 1470");
  assert.deepEqual(boxes, ["You've found another clue!"]);
});
