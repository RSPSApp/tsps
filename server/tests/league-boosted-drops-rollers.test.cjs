// Run after `yarn build`: node --test tests/league-boosted-drops-rollers.test.cjs
// A league's boosted drops (the Demonic Pacts Boosted drops page) on the rollers that roll their
// own rares: Vale offerings' uniques, the seed pack's Hespori seed, the Shades of Mort'ton silver
// chests' runescrolls and the Fountain of Rune's amulet of eternal glory. Real engine: every plugin
// loaded, real Players, and the league answering "drops:chance" through the plugins' own events.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, afterEach, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const PACTS = 6;
const realRandom = Math.random;
let core;
let I;
let next = 9700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
afterEach(() => { Math.random = realRandom; });

/** A real player; `tier` > 0 makes it a Demonic Pacts league character with that many relic tiers (5x from tier 4). */
function character(t, tier = 0) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(`boosted${next}`);
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.needsPlacement = false;
  player.setLocation(new core.Location(3200, 3200, 0));
  if (tier > 0) {
    player.setProfile("league");
    player.setAttribute("league:type", PACTS);
    player.setAttribute("league:relics", Object.fromEntries(Array.from({ length: tier }, (_, index) => [index, 1])));
  }
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player); });
  return player;
}

/** Every Math.random() call returns the next value, then `rest`. */
function randoms(values, rest = 0.5) {
  const queue = [...values];
  Math.random = () => (queue.length ? queue.shift() : rest);
}

test("the league answers 5x for a tier 4 character and nothing for a main one", (t) => {
  const ask = (player) => {
    const rules = [];
    PM.emitCustomEvent("drops:chance", { player, source: "Vale offerings", rules });
    return rules.map((rule) => rule.multiplier);
  };
  assert.deepEqual(ask(character(t, 4)), [5]);
  assert.deepEqual(ask(character(t)), []);
});

test("Vale offerings: the 1/100 unique pre-roll is 5/100 for a boosted character", (t) => {
  const Loot = require("../plugins/minigames/valetotems/Loot.ValeTotems");
  const uniques = new Set(["bowstring_spool", "fletching_knife", "greenman_mask"].map((name) => core.CacheDefinitions.getObjId(name)));
  const unique = (player, draw) => { randoms([draw]); return uniques.has(Loot.roll(player).id); };
  assert.equal(unique(character(t), 0.025), false, "unboosted: 2.5 in 100 misses the 1/100");
  assert.equal(unique(character(t), 0.009), true, "unboosted: inside 1/100");
  assert.equal(unique(character(t, 4), 0.025), true, "boosted 5x: inside 5/100");
  assert.equal(unique(character(t, 4), 0.051), false, "boosted 5x: past 5/100");
  // The three keep their 5:3:2 shares: a pick at 0.45 of the boosted weights is still the spool's half.
  randoms([0.025, 0.45]);
  assert.equal(Loot.roll(character(t, 4)).id, core.CacheDefinitions.getObjId("bowstring_spool"));
});

test("seed pack: each high-tier roll's Hespori seed is five times its 5/45, the other seeds sharing the rest", (t) => {
  const Farming = require("../plugins/skills/farming/Guild.Farming");
  // Tier 5: 1-3 high rolls; every draw is 0.5. Unboosted, 0.5 of 45 is snapdragon (rows 5,5,5,4,4 reach 23);
  // boosted, the Hespori seed is 25/45 after the two 2.5/45 rows before it, so 0.5 lands on it.
  randoms([], 0.5);
  assert.notEqual(Farming.seedPackContents(5, false, character(t))[0].id, I.HESPORI_SEED);
  randoms([], 0.5);
  assert.equal(Farming.seedPackContents(5, false, character(t, 4))[0].id, I.HESPORI_SEED);
  // Past 15/45 + the boost: a draw of 0.7 is past the Hespori seed's 0.111-0.667 and on another seed.
  randoms([], 0.7);
  assert.notEqual(Farming.seedPackContents(5, false, character(t, 4))[0].id, I.HESPORI_SEED);
});

test("Shades of Mort'ton: a silver chest's runescroll roll is five times as likely", (t) => {
  const Rewards = require("../plugins/minigames/shadesofmortton/Rewards.ShadesOfMortton");
  const books = new Set(Rewards.BOOKS.flatMap((book) => [book.book, book.scroll].map((name) => core.CacheDefinitions.getObjId(name))));
  // A bloodred chest: the lock is 1/63 (0.5 misses), the runescroll 1/76; 0.03 is 2.28 in 76.
  const roll = (player) => {
    const draws = [0.5, 0.03, 0.2];
    return books.has(Rewards.rollSilver(player, "bloodred", () => draws.shift() ?? 0.5).id);
  };
  assert.equal(roll(character(t)), false, "unboosted: 2.28 in 76 misses");
  assert.equal(roll(character(t, 4)), true, "boosted 5x: inside 5/76");
});

test("Fountain of Rune: an amulet of glory turns eternal five times as often", (t) => {
  const Recharge = require("../plugins/items/Recharge.Jewellery");
  const api = PM.createApi("BoostedDropsFountainTest");
  const charge = (player) => {
    player.setAttribute("quest.heroes_quest.stage", 999);
    player.getInventory().resetItems();
    player.getInventory().add(new core.Item(I.AMULET_OF_GLORY, 1));
    // 0.0001 of 25,000 is 2.5: past the 1/25,000, inside 5/25,000.
    randoms([], 0.0001);
    Recharge._test.rechargeAtFountain(api, { player, objectId: core.ObjectIdentifiers.FOUNTAIN_OF_RUNE, item: player.getInventory().forSlot(0), handled: false });
    return player.getInventory().contains(I.AMULET_OF_ETERNAL_GLORY);
  };
  assert.equal(charge(character(t)), false, "unboosted: recharged, not eternal");
  assert.equal(charge(character(t, 4)), true, "boosted 5x: eternal");
});

test("a Frozen Cache's ancient icon is an ancient sceptre for a Demonic Pacts character (combo boss drops)", (t) => {
  const Loot = require("../plugins/bosses/phantommuspah/Loot.PhantomMuspah");
  const open = (player) => {
    player.getInventory().resetItems();
    player.getInventory().add(new core.Item(I.FROZEN_CACHE, 1));
    // The cache's pre-roll out of 500: the frozen cache is 0-6, the ancient icon 7-8.
    randoms([8 / 500]);
    Loot.openCache({ player, itemId: I.FROZEN_CACHE });
    return player.getInventory().getItems().filter((item) => item && item.getAmount() > 0).map((item) => item.getId());
  };
  assert.deepEqual(open(character(t)), [I.ANCIENT_ICON], "a main character: the icon");
  const league = character(t);
  league.setProfile("league");
  league.setAttribute("league:type", 6);
  assert.deepEqual(open(league), [I.ANCIENT_SCEPTRE], "Demonic Pacts, no relic yet: the sceptre");
});
