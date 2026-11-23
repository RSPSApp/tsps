// Run after `yarn build`: node --test tests/league-boosted-drops-data.test.cjs
// The boosted drops data (plugins/modes/data/league-boosted-drops.json) names its items the way
// the rollers name them, so a row cannot silently miss: a pattern matches whole names, and an
// item name that differs from the table's ("Tooth half of key" vs "Tooth half of key (moon key)")
// boosts nothing.
const assert = require("node:assert/strict");
const path = require("path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const BoostedDrops = require("../plugins/modes/league/BoostedDrops.LeagueMode");
const DATA = require("../plugins/modes/data/league-boosted-drops.json");
const DROPS = require("../data/definitions/npc-drops.json");

/**
 * Rows whose NPCs' loot is not their dumped table: their plugins roll a table of their own (the
 * Grotesque Guardians' data, the revenants' and the giant lairs' chests) and are checked in
 * league-passives.test.cjs.
 */
const OWN_TABLES = new Set(["Grotesque Guardians", "Revenants", "Revenants (Raging Echoes)", "Obor", "Bryophyta"]);

/**
 * Items a row names that no table drops: what a league gives in place of a part (the page's
 * "drops as a completed item"), and Raging Echoes' additions to a dragon's table.
 */
const NOT_ON_TABLES = new Set([
  "Eternal boots", "Bellator ring", "Magus ring", "Venator ring", "Ultor ring", "Ancient sceptre",
  "Amulet of rancour", "Uncharged toxic trident", "Guardian boots", "Dragon kiteshield", "Dragon platebody",
]);

/** The DT2 row's Soulreaper axe pieces: each boss's table drops its own piece only. */
const EVERY_BOSS_ROW = "Desert Treasure II bosses (Demonic Pacts)";

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

/** The data's matcher: `*` everything, `/.../` a regular expression, else the whole name; all without case. */
function matcher(text) {
  if (text === "*") return /.*/;
  if (text.length > 2 && text.startsWith("/") && text.endsWith("/")) return new RegExp(text.slice(1, -1), "i");
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

/** Every row name a table can roll: entries, tertiaries, ordered reward stages and exclusive groups. */
function tableNames(table) {
  return [
    ...(table.entries ?? []), ...(table.tertiary ?? []),
    ...(table.reward_chain?.stages ?? []).flatMap((stage) => stage.entries),
    ...(table.tertiary_groups ?? []).flatMap((group) => group.entries),
  ].map((entry) => entry.name ?? "");
}

test("every NPC row's items are on its NPCs' drop tables, by the tables' own names", () => {
  const npcs = Object.values(DROPS.npcs);
  const misses = [];
  for (const source of DATA.sources) {
    if (!source.npcs || OWN_TABLES.has(source.name)) continue;
    const patterns = source.npcs.map(matcher);
    const tables = [...new Set(npcs.filter((npc) => patterns.some((p) => p.test(npc.name ?? "") || p.test(npc.cache_name ?? ""))).flatMap((npc) => npc.tables ?? []))];
    assert.ok(tables.length > 0, `${source.name}: no NPC of that name has a table`);
    const names = tables.flatMap((id) => (DROPS.tables[id] ? tableNames(DROPS.tables[id]) : []));
    for (const item of source.items) {
      if (NOT_ON_TABLES.has(item) || source.name === EVERY_BOSS_ROW) continue;
      if (!names.some((name) => matcher(item).test(name))) misses.push(`${source.name}: ${item}`);
    }
  }
  assert.deepEqual(misses, []);
});

test("every key chest a row names is asked by its name, and the row matches its pre-rolled items", () => {
  const Data = require("../plugins/objects/keychests/Data.KeyChests");
  Data.init({ core });
  const named = Data.get().chests.filter((chest) => BoostedDrops.patternsFor(6, chest.name).length > 0);
  assert.deepEqual(named.map((chest) => chest.name).sort(), ["Brimstone chest", "Elven Crystal Chest", "Larran's big chest", "Zombie Pirate's Locker"]);
  const itemName = (entry) => CacheDefinitions.getItem?.(entry.itemId)?.name ?? core.ItemDefinition.forId(entry.itemId).getName();
  for (const chest of named) {
    const patterns = BoostedDrops.patternsFor(6, chest.name);
    const boosted = chest.loot.preRolls.flatMap((roll) => roll.oneOf).filter((entry) => patterns.some((p) => p.test(itemName(entry))));
    assert.ok(boosted.length > 0, `${chest.name}: the row matches none of its pre-rolls`);
  }
  // The Elven Crystal Chest: the dragonstone armour, not the uncut onyx (not on the page).
  const elven = named.find((chest) => chest.name === "Elven Crystal Chest");
  const patterns = BoostedDrops.patternsFor(6, elven.name);
  const [onyx, armour] = elven.loot.preRolls;
  assert.equal(onyx.oneOf.some((entry) => patterns.some((p) => p.test(itemName(entry)))), false);
  assert.equal(armour.oneOf.every((entry) => patterns.some((p) => p.test(itemName(entry)))), true, "all five pieces");
});

test("Araxxor's row boosts the Araxyte fang, the part its table drops for the amulet of rancour", () => {
  const patterns = BoostedDrops.patternsFor(6, "Araxxor");
  assert.ok(patterns.some((p) => p.test("Araxyte fang")));
  assert.ok(!patterns.some((p) => p.test("Araxyte head")), "the head is not on the page");
});
