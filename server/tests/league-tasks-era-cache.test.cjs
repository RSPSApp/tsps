// node --test tests/league-tasks-era-cache.test.cjs
// The past leagues' task text, category and area come from their own caches (docs/leagues.md,
// Tasks, era caches), pinned by OpenRS2 id in scripts/generate-league-tasks.ts. These pin a few
// corrections they made to what the Wiki and the Demonic Pacts cache gave, so a regeneration that
// loses the era source fails here.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const catalog = require("../plugins/modes/data/league-tasks.json");

const league = (type) => catalog.leagues[type];
const byWikiId = (type, wikiId, name) => {
  const found = league(type).tasks.filter((task) => task.wikiId === wikiId && (name === undefined || task.name === name));
  assert.equal(found.length, 1, `league ${type}: one task ${wikiId}${name ? ` "${name}"` : ""}`);
  return found[0];
};

test("Trailblazer Reloaded and Raging Echoes read their own pinned caches", () => {
  assert.deepEqual(league(4).eraCache, { openrs2: 1642, date: "2023-12-12" });
  assert.deepEqual(league(5).eraCache, { openrs2: 2023, date: "2025-01-15" });
  for (const type of [4, 5]) for (const task of league(type).tasks) assert.equal(task.categorySource, "era", task.id);
  // Demonic Pacts is the current cache's own list.
  assert.equal(league(6).eraCache, undefined);
});

test("categories are the league's own, not the Demonic Pacts task of the same name or a rule", () => {
  // The Wiki's id 1522 is on two tasks; the era cache tells them apart by name.
  assert.equal(byWikiId(4, 1522, "The Frozen Door").category, 3, "a mini-quest is a Quest task");
  assert.equal(byWikiId(4, 1522, "Defeat Vardorvis").category, 2);
  assert.equal(byWikiId(5, 97).name, "Bury Some Bones");
  assert.equal(byWikiId(5, 97).category, 2, "Raging Echoes files Prayer under Combat");
});

test("names and descriptions are the in-game text; ids stay the Wiki name's slug", () => {
  const ham = byWikiId(5, 454);
  assert.equal(ham.name, "Pickpocket a HAM Member", "the game's spelling (the Wiki's H.A.M.)");
  assert.equal(ham.id, "pickpocket-a-h-a-m-member", "the id saves hold");
  assert.equal(byWikiId(5, 193).description, "Reach level 10 in any skill (not including Agility and Hitpoints)");
  const sceptre = byWikiId(4, 1677);
  assert.equal(sceptre.name, "Commune a Pharoah's Sceptre to the Necropolis", "Jagex's spelling");
  assert.equal(sceptre.id, "commune-a-pharaoh-s-sceptre-to-the-necropolis");
});

test("a task struct without an area reads the param's default, Global", () => {
  assert.equal(byWikiId(4, 1022).name, "Equip a Full Angler's Outfit");
  assert.equal(byWikiId(4, 1022).area, 0);
});

test("a rule only the in-game text words is shown but not enforced: the trigger stays the Wiki's", () => {
  // The live league did not enforce these where a capture tests them: the Dragon Axe special
  // completed in Varrock (227/00086), the first level 10 on Agility 10.
  const axe = byWikiId(5, 612);
  assert.match(axe.description, /in the Fremennik Province$/);
  assert.deepEqual(axe.trigger, { kind: "deed", event: "combat-special:performed", count: 1, items: ["Dragon axe"] });
  assert.match(byWikiId(5, 1356).description, /in Kourend$/);
  assert.deepEqual(byWikiId(5, 1356).trigger, { kind: "burn", items: ["Redwood logs"], count: 200 });
  assert.match(byWikiId(5, 1362).description, /in Kourend$/);
  assert.deepEqual(byWikiId(5, 1362).trigger, { kind: "produce", items: ["Redwood shield"], count: 1 });
  assert.match(byWikiId(5, 193).description, /not including Agility and Hitpoints/);
  assert.deepEqual(byWikiId(5, 193).trigger, { kind: "any-level", level: 10, excluding: ["HITPOINTS"] });
  assert.deepEqual(byWikiId(5, 192).trigger, { kind: "any-level", level: 5, excluding: ["HITPOINTS", "RUNECRAFTING"] });
});

test("the Wiki's corrections the captures bear out: no kiteshield or crozier, Waterbirth Island's snape grass", () => {
  // Completed in a Saradomin full helm, platebody and plateskirt with no shield (Leagues V capture).
  const rune = byWikiId(5, 17).trigger;
  assert.equal(rune.kind, "equip-any-set");
  assert.equal(rune.sets.length, 6);
  for (const set of rune.sets) assert.ok(!set.flat().some((piece) => /kiteshield/i.test(piece)), JSON.stringify(set));
  assert.deepEqual(rune.sets[0], ["Saradomin full helm", "Saradomin platebody", ["Saradomin platelegs", "Saradomin plateskirt"]]);
  for (const set of byWikiId(5, 13).trigger.sets) assert.ok(!set.some((piece) => /crozier/i.test(piece)), JSON.stringify(set));
  // "Pick up Snapegrass from Lunar Isle" completed picking up snape grass at 2553,3754.
  const snape = byWikiId(5, 1842).trigger;
  assert.equal(snape.place, "waterbirth-island");
  assert.ok(catalog.places["waterbirth-island"].rects.some(([x1, y1, x2, y2]) => x1 <= 2553 && 2553 <= x2 && y1 <= 3754 && 3754 <= y2));
});
