// Run after `yarn build`: node --test tests/quest-activity-pet-sources.test.cjs
// Quest and activity pet sources on a real Player and Inventory: the Bloodhound from a master
// casket, Felkrash's wily cats, the wily/lazy cycle and a grown cat's hellcat.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

const BLOODHOUND = 19730;
const MASTER_CASKET = require("../data/definitions/clue-caskets.json").tables.master.casket_item_id;
const events = new Map();
const emitted = [];
// The world registers an added NPC, as World.getNpcs().add does in game.
const worldNpcs = Object.assign([], { add: (npc) => { npc.setRegistered?.(true); return true; }, get: () => null });
const addQueue = [];
const removeQueue = [];
const world = { sendMessage() {}, getNpcs: () => worldNpcs, getAddNPCQueue: () => addQueue, getRemoveNPCQueue: () => removeQueue };
let core, Pets, Caskets, fixtures = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    getWorld: () => world,
    getRegionManager: () => ({ blocked: () => true, canMovestart: () => true }),
    getItemOnGroundManager: () => ({ registerNonGlobal() {}, registerLocation() {} }),
    onCustomEvent: (name, handler) => events.set(name, [...(events.get(name) ?? []), handler]),
    emitCustomEvent: (name, request) => {
      emitted.push([name, request]);
      for (const handler of events.get(name) ?? []) handler(request);
    },
  }, { get: (target, name) => target[name] ?? (() => {}) });
  Pets = require("../plugins/npcs/Pets.plugin");
  Pets.register(api);
  require("../plugins/treasuretrails/TreasureTrails.plugin").register(api);
  // ClueCapacity owns the scroll-case milestones; none fall on these completions.
  api.onCustomEvent("treasure-trails:milestone-rewards", (request) => { request.handled = true; });
  Caskets = require("../plugins/treasuretrails/trails/Caskets.TreasureTrails");
});

const realRandom = Math.random;
beforeEach(() => {
  Math.random = realRandom;
  emitted.length = 0;
  worldNpcs.length = 0;
  addQueue.length = 0;
  removeQueue.length = 0;
});

function realPlayer({ follower = null } = {}) {
  const player = new Player(null);
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  player.setUsername(`pet-sources-${++fixtures}`);
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  player.setLocation(new core.Location(3222, 3218, 0));
  if (follower) player.setAttribute("pets:current", follower);
  return { player, messages, inventory: player.getInventory() };
}

/** Someone else's follower: the slot is taken, so a new pet goes to the backpack. */
const OTHER_FOLLOWER = { isRegistered: () => true, getId: () => -1 };

function catNpc(player, npcId) {
  return {
    id: npcId,
    isRegistered: () => true,
    isPet: () => true,
    getId() { return this.id; },
    getIndex: () => 7,
    getOwner: () => player,
    getLocation: () => new core.Location(3222, 3219, 0),
    getDefinition: () => ({ getName: () => "cat" }),
  };
}

function follow(player, npcId) {
  const npc = catNpc(player, npcId);
  player.setAttribute("pets:current", npc);
  Pets.__internals.trackCatFollower(player, npc, Pets.__internals.PET_BY_ID.get(npcId));
  return npc;
}

function vermin(name) {
  const npc = { isRegistered: () => true, getLocation: () => new core.Location(3223, 3219, 0), getDefinition: () => ({ getName: () => name }) };
  worldNpcs.length = 0;
  worldNpcs.push(npc);
  return npc;
}

/** One successful catch by the current follower. */
function catchOne(player, name) {
  vermin(name);
  const npc = player.getAttribute("pets:current");
  Math.random = () => 0;
  try {
    assert.equal(Pets.__internals.chaseVermin(player, npc, Pets.__internals.PET_BY_ID.get(npc.getId())), true);
  } finally {
    Math.random = realRandom;
  }
}

function emit(name, request) {
  for (const handler of events.get(name) ?? []) handler(request);
  return request;
}

function openMasterCasket(player, random) {
  player.getInventory().setItem(0, new core.Item(MASTER_CASKET, 1));
  Math.random = random;
  try {
    const event = { player, slot: 0, item: player.getInventory().getItems()[0], itemId: MASTER_CASKET };
    assert.equal(Caskets.open(event), true);
    assert.equal(event.error, undefined);
  } finally {
    Math.random = realRandom;
  }
}

test("a master casket's Bloodhound joins the backpack through the pet path, not the reward screen", () => {
  const { player, messages, inventory } = realPlayer({ follower: OTHER_FOLLOWER });
  openMasterCasket(player, () => 0);
  assert.equal(inventory.getAmount(BLOODHOUND), 1, "one Bloodhound");
  assert.ok(messages.includes("You feel something weird sneaking into your backpack."));
  assert.ok(Pets.__internals.getOwnedPetItems(player).includes(BLOODHOUND), "insured for Probita");
  const awards = emitted.filter(([name, request]) => name === "pets:award" && request.itemId === BLOODHOUND);
  assert.equal(awards.length, 1);
  assert.equal(awards[0][1].source, "treasure-trails:casket");
  assert.equal(awards[0][1].awarded, true);
  const logged = emitted.filter(([name, request]) => name === "collection-log:obtain" && request.itemId === BLOODHOUND);
  assert.equal(logged.length, 1, "logged once, by the pet record");
  assert.ok(messages.some((text) => text.startsWith("Well done, you've completed")), "the casket itself still opened");
});

test("a Bloodhound rolled with a follower out and a full backpack goes to Probita", () => {
  const { player, messages, inventory } = realPlayer({ follower: OTHER_FOLLOWER });
  inventory.add(new core.Item(core.ItemIdentifiers.SPADE, 27), false);
  openMasterCasket(player, () => 0);
  assert.equal(inventory.getAmount(BLOODHOUND), 0);
  assert.ok(Pets.__internals.getOwnedPetItems(player).includes(BLOODHOUND));
  assert.ok(messages.some((text) => text.includes("Probita can help")));
});

test("an owned Bloodhound is a would-have-been-followed miss and a casket without the roll awards none", () => {
  const { player, messages, inventory } = realPlayer({ follower: OTHER_FOLLOWER });
  player.setAttribute("pets.owned", [BLOODHOUND]);
  openMasterCasket(player, () => 0);
  assert.equal(inventory.getAmount(BLOODHOUND), 0);
  assert.ok(messages.includes("You have a funny feeling like you would have been followed..."));

  const second = realPlayer({ follower: OTHER_FOLLOWER });
  openMasterCasket(second.player, () => 0.5);
  assert.equal(second.inventory.getAmount(BLOODHOUND), 0);
  assert.equal(emitted.filter(([name]) => name === "pets:award").length, 1, "only the first player's roll");
});

test("Felkrash trains a carried overgrown cat into a wily cat of its colour, one at a time", () => {
  const { player, inventory } = realPlayer();
  const I = core.ItemIdentifiers;
  inventory.add(new core.Item(1568, 1), false); // overgrown cat, white
  assert.deepEqual(pick(emit("pets:wily-cat-status", { player, overgrown: false, wily: false })), { overgrown: true, wily: false });

  assert.equal(emit("pets:train-wily-cat", { player, trained: false }).trained, true);
  assert.equal(inventory.getAmount(1568), 0);
  assert.equal(inventory.getAmount(I.WILY_CAT), 1, "white wily cat 6555");
  assert.deepEqual(pick(emit("pets:wily-cat-status", { player, overgrown: false, wily: false })), { overgrown: false, wily: true });

  inventory.add(new core.Item(1567, 1), false);
  assert.equal(emit("pets:train-wily-cat", { player, trained: false }).trained, false, "a wily cat already owned");
  assert.equal(inventory.getAmount(1567), 1);
  assert.equal(inventory.getAmount(I.WILY_CAT_2), 0);
});

test("an overgrown hellcat follower becomes a wily hellcat in place", () => {
  const { player } = realPlayer();
  follow(player, 5604);
  assert.equal(emit("pets:train-wily-cat", { player, trained: false }).trained, true);
  assert.equal(player.getAttribute("pets:current").getId(), core.NpcIdentifiers.WILY_HELLCAT);
  assert.equal(player.getAttribute("pets:last"), core.ItemIdentifiers.WILY_HELLCAT);
  assert.equal(player.getAttribute("pets:cat").stage, "wily_hellcat");
});

test("a wily cat turns lazy, and about fifteen rats retrain it a few minutes later", () => {
  const { player } = realPlayer();
  const N = core.NpcIdentifiers;
  follow(player, N.WILY_CAT); // white
  const state = player.getAttribute("pets:cat");
  assert.equal(state.stage, "wily");
  state.lazyIn = 2;
  assert.equal(Pets.__internals.catTick(player), true);
  assert.equal(player.getAttribute("pets:current").getId(), N.WILY_CAT, "still wily after one tick");
  assert.equal(Pets.__internals.catTick(player), true);
  assert.equal(player.getAttribute("pets:current").getId(), N.LAZY_CAT, "white lazy cat 1626");
  assert.equal(player.getAttribute("pets:cat").stage, "lazy");

  for (let i = 0; i < 14; i++) catchOne(player, "Rat");
  assert.ok(!(player.getAttribute("pets:cat").wilyIn > 0), "fourteen rats are not enough");
  catchOne(player, "Hell-Rat"); // hell-rats count too (Wiki "Lazy cat")
  const waiting = player.getAttribute("pets:cat");
  assert.ok(waiting.wilyIn - waiting.growth >= 4 && waiting.wilyIn - waiting.growth <= 6);
  while (player.getAttribute("pets:cat").stage === "lazy") assert.equal(Pets.__internals.catTick(player), true);
  assert.equal(player.getAttribute("pets:current").getId(), N.WILY_CAT);
  assert.equal(player.getAttribute("pets:last"), core.ItemIdentifiers.WILY_CAT);
});

test("an adult cat becomes a hellcat on its seventh hell-rat, keeps its age, and milk turns it back", () => {
  const { player, messages, inventory } = realPlayer();
  follow(player, 1620); // adult cat, white
  player.getAttribute("pets:cat").growth = 230;
  for (let i = 0; i < 6; i++) catchOne(player, "Hell-Rat");
  assert.equal(player.getAttribute("pets:current").getId(), 1620, "six are not enough");
  catchOne(player, "Hell-Rat");
  assert.equal(player.getAttribute("pets:current").getId(), 1625, "hellcat");
  const state = player.getAttribute("pets:cat");
  assert.equal(state.stage, "hellcat");
  assert.equal(state.growth, 230, "a cat that turns hell continues to age (Wiki, Mod Ash)");
  assert.equal(state.colour, 1);
  assert.equal(messages.at(-1), "Your cat catches the hell-rat and turns into a hellcat.");

  inventory.add(new core.Item(core.ItemIdentifiers.BUCKET_OF_MILK, 1), false);
  Pets.__internals.handleItemOnCat({ player, target: player.getAttribute("pets:current"), itemId: core.ItemIdentifiers.BUCKET_OF_MILK });
  assert.equal(player.getAttribute("pets:current").getId(), 1620, "back to the white adult cat");
  assert.equal(inventory.getAmount(core.ItemIdentifiers.BUCKET), 1);
});

test("an overgrown cat never turns hell from hell-rats", () => {
  const { player } = realPlayer();
  follow(player, 5599); // overgrown cat, white
  for (let i = 0; i < 7; i++) catchOne(player, "Hell-Rat");
  assert.equal(player.getAttribute("pets:current").getId(), 5599);
  assert.equal(player.getAttribute("pets:cat").stage, "overgrown");
});

test("a lazy cat that turns hell keeps its retraining progress", () => {
  const { player } = realPlayer();
  const N = core.NpcIdentifiers;
  follow(player, N.LAZY_CAT); // white
  for (let i = 0; i < 6; i++) catchOne(player, "Rat");
  for (let i = 0; i < 7; i++) catchOne(player, "Hell-Rat");
  const state = player.getAttribute("pets:cat");
  assert.equal(player.getAttribute("pets:current").getId(), N.LAZY_HELLCAT);
  assert.equal(state.stage, "lazy_hellcat");
  assert.equal(state.lazyRats, 13, "every catch, hell-rats included, still counts toward retraining");
});

test("Felkrash training a carried overgrown hellcat keeps its colour for the wily hellcat", () => {
  const { player, inventory } = realPlayer();
  player.setAttribute("pets:cat", { stage: "overgrown_hellcat", colour: 1, growth: 0, hungerAt: 0, attentionAt: 0 });
  inventory.add(new core.Item(core.ItemIdentifiers.OVERGROWN_HELLCAT, 1), false);
  assert.equal(emit("pets:train-wily-cat", { player, trained: false }).trained, true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.WILY_HELLCAT), 1);
  assert.equal(player.getAttribute("pets:cat").stage, "wily_hellcat");

  // Summoned and given milk, it is the white wily cat, not the default colour.
  const npc = follow(player, core.NpcIdentifiers.WILY_HELLCAT);
  assert.equal(player.getAttribute("pets:cat").colour, 1);
  inventory.add(new core.Item(core.ItemIdentifiers.BUCKET_OF_MILK, 1), false);
  Pets.__internals.handleItemOnCat({ player, target: npc, itemId: core.ItemIdentifiers.BUCKET_OF_MILK });
  assert.equal(player.getAttribute("pets:current").getId(), core.NpcIdentifiers.WILY_CAT, "white wily cat 5584");
});

test("a cat does not turn while the player already has a hellcat outside the menagerie", () => {
  const { player, inventory } = realPlayer();
  inventory.add(new core.Item(7582, 1), false); // a hellcat carried
  follow(player, 1620); // adult cat, white
  for (let i = 0; i < 7; i++) catchOne(player, "Hell-Rat");
  assert.equal(player.getAttribute("pets:current").getId(), 1620);
  assert.equal(player.getAttribute("pets:cat").stage, "cat");
});

function pick({ overgrown, wily }) {
  return { overgrown, wily };
}
