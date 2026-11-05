// Focused Fremennik Diary producer checks. Run with:
//   node --test tests/fremennik-diary.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const plugin = require("../plugins/achievements/diaries/FremennikDiary.plugin");

const handlers = new Map();
const zones = [];
let tasks = [];
const questsComplete = new Set();
const questsStarted = new Set();

const Npc = {
  CERULEAN_TWITCH: 5550,
  SNOWY_KNIGHT: 5554,
  SABRE_TOOTHED_KYATT: 2907,
  BLAST_FURNACE_FOREMAN: 2923,
};
const Item = {
  SNAPE_GRASS: 231,
  SILVER_ORE: 442,
  COAL: 453,
  GOLD_ORE: 444,
  ADAMANTITE_ORE: 449,
  SILVER_BAR: 2355,
  TIARA: 5525,
  DRAGONSTONE_AMULET_U_: 1683,
  OAK_LOGS: 1521,
  SUPER_DEFENCE_3_: 163,
  SUPER_DEFENCE_4_: 2442,
  BUCKET: 1925,
  ASTRAL_RUNE: 9075,
};

plugin.register({
  core: { NpcIdentifiers: Npc, ItemIdentifiers: Item, Skill: { SMITHING: { getName: () => "Smithing" } } },
  persistAttribute() {},
  onCustomEvent(name, handler) { handlers.set(name, handler); },
  onNpcDeath(handler) { handlers.set("npc:death", handler); },
  onZoneEnter(zone, handler) { zones.push([zone, handler]); },
  emitCustomEvent(name, request) {
    if (name === "quest:is-complete") request.complete = request.player.completeQuests.has(request.key);
    else if (name === "quest:is-started") request.started = request.player.startedQuests.has(request.key);
    else if (name === "diary:task") tasks.push(request);
  },
});

const T = plugin._test;
const loc = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z, x, y, z });
const npc = (id, name, x = 0, y = 0, z = 0) => ({
  getId: () => id,
  getCurrentDefinition: () => ({ getName: () => name }),
  getDefinition: () => ({ getName: () => name }),
  getLocation: () => loc(x, y, z),
});
function player(x = 2600, y = 3700, z = 0, smithing = 99) {
  const attributes = new Map();
  const p = {
    attributes,
    completeQuests: new Set(),
    startedQuests: new Set(),
    location: loc(x, y, z),
    isPlayer: () => true,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => p.location,
    isRegistered: () => true,
    getHitpoints: () => 10,
    isDyingReturn: () => false,
    getPrivateArea: () => null,
    getSkillManager: () => ({ getMaxLevel: () => smithing }),
    teleport: (nx, ny, nz = 0) => { p.location = loc(nx, ny, nz); },
  };
  return p;
}
const fire = (name, payload) => handlers.get(name)(payload);
const fired = (task) => tasks.filter((request) => request.task === task).length;

function reset() {
  tasks = [];
  questsComplete.clear();
  questsStarted.clear();
}
function granted(player, key) { player.completeQuests.add(key); return player; }
function started(player, key) { player.startedQuests.add(key); return player; }

test("easy producers credit their own task only after success", () => {
  reset();
  const p = granted(player(), "fremennik_trials");
  fire("hunter:success", { player: p, npcId: Npc.CERULEAN_TWITCH });
  assert.equal(fired("catch-a-cerulean-twitch"), 1);

  fire("shop:opened", { player: p, shopId: 1387 });
  assert.equal(fired("change-your-boots-at-yrsa-s-shoe-store"), 1);

  const crabKiller = player();
  for (let i = 0; i < 4; i++) fire("npc:death", { killer: crabKiller, npc: npc(100, "Rock Crab") });
  assert.equal(fired("kill-5-rock-crabs"), 0);
  fire("npc:death", { killer: crabKiller, npc: npc(102, "Rock Crab") });
  assert.equal(fired("kill-5-rock-crabs"), 1);

  fire("shop:opened", { player: started(player(), "giant_dwarf"), shopId: 1193 });
  assert.equal(fired("browse-the-stonemasons-shop"), 1);

  const grass = player(2500, 3730);
  for (let i = 0; i < 4; i++) fire("ground-items:taken", { player: grass, itemId: Item.SNAPE_GRASS, amount: 1, groundItem: { getPosition: () => loc(2500, 3730) } });
  assert.equal(fired("collect-5-snape-grass-on-waterbirth-island"), 0);
  fire("ground-items:taken", { player: grass, itemId: Item.SNAPE_GRASS, amount: 1, groundItem: { getPosition: () => loc(2501, 3731) } });
  assert.equal(fired("collect-5-snape-grass-on-waterbirth-island"), 1);

  fire("thieving:success", { player: started(player(2890, 10210), "giant_dwarf"), method: "stall", stall: "Crafting stall", location: loc(2890, 10210) });
  assert.equal(fired("steal-from-the-keldagrim-crafting-or-baker-s-sta"), 1);

  fire("water-source:filled", { player: player(2668, 3660), itemId: Item.BUCKET, name: "Well", location: loc(2668, 3660) });
  assert.equal(fired("fill-a-bucket-with-water-at-the-rellekka-well"), 1);

  fire("npc:death", { killer: player(), npc: npc(2261, "Giant Rock Crab") });
  assert.equal(fired("kill-5-rock-crabs"), 1);

  fire("shop:opened", { player: started(player(), "giant_dwarf"), shopId: 1 });
  assert.equal(fired("browse-the-stonemasons-shop"), 1);
});

test("the Rellekka tiara needs mine, bar and furnace in order, and resets on another task", () => {
  reset();
  const p = granted(player(2616, 3666), "fremennik_trials");
  p.teleport(2660, 3700);
  fire("mining:success", { player: p, itemId: Item.SILVER_ORE });
  assert.equal(p.getAttribute("fremennik-diary:tiara-stage"), 1);
  p.teleport(2616, 3666);
  fire("smelting:success", { player: p, itemId: Item.SILVER_BAR });
  assert.equal(p.getAttribute("fremennik-diary:tiara-stage"), 2);
  fire("crafting:made", { player: p, itemId: Item.TIARA });
  assert.equal(fired("craft-a-tiara-from-scratch-in-rellekka"), 1);
  assert.equal(p.getAttribute("fremennik-diary:tiara-stage"), 0);

  const resetPlayer = granted(player(2660, 3700), "fremennik_trials");
  fire("mining:success", { player: resetPlayer, itemId: Item.SILVER_ORE });
  T.onDiaryTask({ player: resetPlayer, diary: "fremennik", task: "browse-the-stonemasons-shop" });
  assert.equal(resetPlayer.getAttribute("fremennik-diary:tiara-stage"), 0);
  resetPlayer.teleport(2616, 3666);
  fire("smelting:success", { player: resetPlayer, itemId: Item.SILVER_BAR });
  fire("crafting:made", { player: resetPlayer, itemId: Item.TIARA });
  assert.equal(fired("craft-a-tiara-from-scratch-in-rellekka"), 1);
});

test("easy province actions: stronghold, oak, and tiara negatives", () => {
  reset();
  T.onTrollStrongholdEnter({ player: player(2836, 10090, 2) });
  assert.equal(fired("enter-the-troll-stronghold"), 1);

  const lumberjack = player();
  fire("woodcutting:success", { player: lumberjack, itemId: Item.OAK_LOGS });
  assert.equal(fired("chop-and-burn-some-oak-logs-in-the-fremennik-pro"), 0);
  fire("firemaking:success", { player: lumberjack, itemId: Item.OAK_LOGS });
  assert.equal(fired("chop-and-burn-some-oak-logs-in-the-fremennik-pro"), 1);

  const outsider = player(3000, 3000);
  fire("woodcutting:success", { player: outsider, itemId: Item.OAK_LOGS });
  fire("firemaking:success", { player: outsider, itemId: Item.OAK_LOGS });
  assert.equal(fired("chop-and-burn-some-oak-logs-in-the-fremennik-pro"), 1);

  const noOre = player(2660, 3700);
  fire("mining:success", { player: noOre, itemId: Item.SILVER_ORE });
  assert.equal(noOre.getAttribute("fremennik-diary:tiara-stage"), undefined);
});

test("medium producers credit only in their area, with their quest gate", () => {
  reset();
  fire("npc:death", { killer: player(), npc: npc(4501, "Brine rat") });
  assert.equal(fired("slay-a-brine-rat"), 1);

  fire("eagle-transport:arrived", { player: granted(player(), "eagles_peak"), eyrie: "polar" });
  assert.equal(fired("travel-to-the-snowy-hunter-area-via-eagle"), 1);
  fire("eagle-transport:arrived", { player: granted(player(), "eagles_peak"), eyrie: "desert" });
  assert.equal(fired("travel-to-the-snowy-hunter-area-via-eagle"), 1);
  fire("eagle-transport:arrived", { player: player(), eyrie: "polar" });
  assert.equal(fired("travel-to-the-snowy-hunter-area-via-eagle"), 1);

  fire("mining:success", { player: granted(player(2660, 3700), "fremennik_trials"), itemId: Item.COAL });
  assert.equal(fired("mine-some-coal-in-rellekka"), 1);
  fire("mining:success", { player: granted(player(3000, 3000), "fremennik_trials"), itemId: Item.COAL });
  assert.equal(fired("mine-some-coal-in-rellekka"), 1);

  fire("thieving:success", { player: granted(player(2646, 3675), "fremennik_trials"), method: "stall", stall: "Fish stall", location: loc(2646, 3675) });
  assert.equal(fired("steal-from-the-rellekka-fish-stalls"), 1);
  fire("thieving:success", { player: granted(player(3000, 3000), "fremennik_trials"), method: "stall", stall: "Fish stall", location: loc(3000, 3000) });
  assert.equal(fired("steal-from-the-rellekka-fish-stalls"), 1);

  fire("teleport:landed", { player: granted(started(player(), "fairytale_ii_cure_a_queen"), "fremennik_trials"), source: "fairy-ring", code: "CIP" });
  assert.equal(fired("travel-to-miscellania-by-fairy-ring"), 1);

  fire("hunter:success", { player: player(), npcId: Npc.SNOWY_KNIGHT });
  assert.equal(fired("catch-a-snowy-knight"), 1);

  const secondGrass = player(2500, 3730);
  for (let i = 0; i < 5; i++) fire("ground-items:taken", { player: secondGrass, itemId: Item.SNAPE_GRASS, amount: 1, groundItem: { getPosition: () => loc(2500, 3730) } });
  assert.equal(fired("collect-5-snape-grass-on-waterbirth-island"), 1);

  const petOwner = started(player(), "fremennik_trials");
  const petHouse = { owner: petOwner, getRoomPositionAt: () => ({}), getRoom: () => ({ roomKey: "MENAGERIE_INDOORS" }) };
  petOwner.getPrivateArea = () => petHouse;
  fire("ground-items:taken", { player: petOwner, itemId: 3695, amount: 1, source: "pickup", groundItem: { getPrivateArea: () => petHouse } });
  assert.equal(fired("pick-up-your-pet-rock-from-your-poh-menagerie"), 1);
  fire("ground-items:taken", { player: started(player(), "fremennik_trials"), itemId: 1555, amount: 1, source: "pickup", groundItem: { getPrivateArea: () => ({}) } });
  assert.equal(fired("pick-up-your-pet-rock-from-your-poh-menagerie"), 1);

  fire("mining:success", { player: player(2400, 4950), itemId: Item.GOLD_ORE });
  assert.equal(fired("mine-some-gold-at-the-arzinian-mine"), 1);
  fire("mining:success", { player: player(3000, 3000), itemId: Item.GOLD_ORE });
  assert.equal(fired("mine-some-gold-at-the-arzinian-mine"), 1);
});

test("hard producers, including quest gates and the 56-astral guard", () => {
  reset();
  fire("spell:teleport-arrival", { player: granted(player(), "eadgars_ruse"), name: "Trollheim teleport" });
  assert.equal(fired("teleport-to-trollheim"), 1);
  fire("spell:teleport-arrival", { player: player(), name: "Trollheim teleport" });
  assert.equal(fired("teleport-to-trollheim"), 1);

  fire("hunter:success", { player: player(), npcId: Npc.SABRE_TOOTHED_KYATT });
  assert.equal(fired("catch-a-sabre-toothed-kyatt"), 1);

  fire("herblore:made", { player: player(2650, 3680), itemId: Item.SUPER_DEFENCE_4_ });
  assert.equal(fired("mix-a-super-defence-potion-in-the-fremennik-prov"), 1);
  fire("herblore:made", { player: player(3000, 3000), itemId: Item.SUPER_DEFENCE_4_ });
  assert.equal(fired("mix-a-super-defence-potion-in-the-fremennik-prov"), 1);

  fire("thieving:success", { player: started(player(2890, 10210), "giant_dwarf"), method: "stall", stall: "Gem stall", location: loc(2890, 10210) });
  assert.equal(fired("steal-from-the-keldagrim-gem-stall"), 1);

  fire("fremennik-isles:shield-made", { player: player(2314, 3784) });
  assert.equal(fired("craft-a-neitiznot-shield-on-neitiznot"), 1);

  const jatizso = player(2400, 10200);
  started(jatizso, "the_fremennik_isles");
  for (let i = 0; i < 4; i++) fire("mining:success", { player: jatizso, itemId: Item.ADAMANTITE_ORE });
  assert.equal(fired("mine-5-adamantite-ores-on-jatizso"), 0);
  fire("mining:success", { player: jatizso, itemId: Item.ADAMANTITE_ORE });
  assert.equal(fired("mine-5-adamantite-ores-on-jatizso"), 1);
  fire("mining:success", { player: player(2400, 10200), itemId: Item.ADAMANTITE_ORE });
  assert.equal(fired("mine-5-adamantite-ores-on-jatizso"), 1);

  fire("miscellania:approval-changed", { player: player(), value: 126, max: 127 });
  assert.equal(fired("obtain-100-support-from-your-kingdom-subjects"), 0);
  fire("miscellania:approval-changed", { player: player(), value: 127, max: 127 });
  assert.equal(fired("obtain-100-support-from-your-kingdom-subjects"), 1);

  fire("spell:teleport-arrival", { player: granted(player(), "lunar_diplomacy"), name: "Waterbirth teleport" });
  assert.equal(fired("teleport-to-waterbirth-island"), 1);

  fire("npc-dialogue:line", { player: started(player(0, 0, 0, 60), "giant_dwarf"), npcId: Npc.BLAST_FURNACE_FOREMAN, text: "A human has level 60 smithing? How extraordinary!" });
  assert.equal(fired("obtain-the-blast-furnace-foreman-s-permission-to"), 1);
  fire("npc-dialogue:line", { player: started(player(0, 0, 0, 59), "giant_dwarf"), npcId: Npc.BLAST_FURNACE_FOREMAN, text: "A human has level 60 smithing? How extraordinary!" });
  assert.equal(fired("obtain-the-blast-furnace-foreman-s-permission-to"), 1);

  const astral = granted(player(), "lunar_diplomacy");
  fire("runecrafting:success", { player: astral, runeId: Item.ASTRAL_RUNE, rolls: 27, amountPerEssence: 2 });
  assert.equal(fired("craft-56-astral-runes-simultaneously-from-essenc"), 0);
  fire("runecrafting:success", { player: astral, runeId: Item.ASTRAL_RUNE, rolls: 28, amountPerEssence: 2 });
  assert.equal(fired("craft-56-astral-runes-simultaneously-from-essenc"), 1);
  fire("runecrafting:success", { player: astral, runeId: Item.ASTRAL_RUNE, rolls: 56, amountPerEssence: 1 });
  assert.equal(fired("craft-56-astral-runes-simultaneously-from-essenc"), 1);
});

test("elite sets: Dagannoth Kings reset, GWD generals and the spiritual mage", () => {
  reset();
  const kingKiller = player();
  fire("npc:death", { killer: kingKiller, npc: npc(2265, "Dagannoth Supreme") });
  fire("npc:death", { killer: kingKiller, npc: npc(2266, "Dagannoth Prime") });
  assert.equal(fired("kill-each-of-the-dagannoth-kings"), 0);
  fire("npc:death", { killer: kingKiller, npc: npc(2267, "Dagannoth Rex") });
  assert.equal(fired("kill-each-of-the-dagannoth-kings"), 1);

  const resetKiller = player();
  fire("npc:death", { killer: resetKiller, npc: npc(2265, "Dagannoth Supreme") });
  T.onDiaryTask({ player: resetKiller, diary: "fremennik", task: "slay-a-brine-rat" });
  fire("npc:death", { killer: resetKiller, npc: npc(2266, "Dagannoth Prime") });
  fire("npc:death", { killer: resetKiller, npc: npc(2267, "Dagannoth Rex") });
  assert.equal(fired("kill-each-of-the-dagannoth-kings"), 1);

  const generalKiller = player();
  for (const [faction, id] of Object.entries({ armadyl: 3162, bandos: 2215, saradomin: 2205, zamorak: 3129 })) {
    fire("godwars:kill", { player: generalKiller, faction, npcId: id });
  }
  assert.equal(fired("kill-the-generals-of-armadyl-bandos-saradomin-an"), 1);
  fire("godwars:kill", { player: generalKiller, faction: "bandos", npcId: 2216 });
  assert.equal(fired("kill-the-generals-of-armadyl-bandos-saradomin-an"), 1);

  fire("npc:death", { killer: player(), npc: npc(3161, "Spiritual mage", 2883, 5356, 2) });
  assert.equal(fired("slay-a-spiritual-mage-within-the-godwars-dungeon"), 1);
  fire("npc:death", { killer: player(), npc: npc(3161, "Spiritual mage", 3000, 3000, 0) });
  assert.equal(fired("slay-a-spiritual-mage-within-the-godwars-dungeon"), 1);
});

test("negative paths: unstarted quests, wrong location, wrong item", () => {
  reset();
  fire("shop:opened", { player: player(), shopId: 1387 });
  assert.equal(fired("change-your-boots-at-yrsa-s-shoe-store"), 0);
  fire("shop:opened", { player: player(), shopId: 1193 });
  assert.equal(fired("browse-the-stonemasons-shop"), 0);

  fire("thieving:success", { player: player(), method: "pickpocket", stall: "Gem stall", location: loc(2890, 10210) });
  assert.equal(fired("steal-from-the-keldagrim-gem-stall"), 0);
  fire("thieving:success", { player: started(player(3000, 3000), "giant_dwarf"), method: "stall", stall: "Gem stall", location: loc(3000, 3000) });
  assert.equal(fired("steal-from-the-keldagrim-gem-stall"), 0);

  fire("crafting:made", { player: granted(player(2660, 3700), "fremennik_trials"), itemId: Item.TIARA });
  assert.equal(fired("craft-a-tiara-from-scratch-in-rellekka"), 0);

  fire("water-source:filled", { player: player(2668, 3660), itemId: Item.SNAPE_GRASS, name: "Well", location: loc(2668, 3660) });
  assert.equal(fired("fill-a-bucket-with-water-at-the-rellekka-well"), 0);
  fire("water-source:filled", { player: player(3000, 3000), itemId: Item.BUCKET, name: "Well", location: loc(3000, 3000) });
  assert.equal(fired("fill-a-bucket-with-water-at-the-rellekka-well"), 0);

  fire("miscellania:approval-changed", { player: player(), value: 126, max: 127 });
  assert.equal(fired("obtain-100-support-from-your-kingdom-subjects"), 0);
});


test("native-context diary guards accept an owned POH and a three-dose super defence", () => {
  reset();
  const owner = started(player(), "fremennik_trials");
  const house = { owner, getRoomPositionAt: () => ({}), getRoom: () => ({ roomKey: "MENAGERIE_INDOORS" }) };
  owner.getPrivateArea = () => house;
  fire("ground-items:taken", { player: owner, itemId: 3695, amount: 1, source: "pickup", groundItem: { getPrivateArea: () => house } });
  assert.equal(fired("pick-up-your-pet-rock-from-your-poh-menagerie"), 1);
  fire("ground-items:taken", { player: owner, itemId: 1555, amount: 1, source: "pickup", groundItem: { getPrivateArea: () => house } });
  fire("ground-items:taken", { player: owner, itemId: 3695, amount: 1, source: "pickup", groundItem: { getPrivateArea: () => ({ owner }) } });
  fire("ground-items:taken", { player: owner, itemId: 3695, amount: 1, source: "telegrab", groundItem: { getPrivateArea: () => house } });
  house.buildingMode = true;
  fire("ground-items:taken", { player: owner, itemId: 3695, amount: 1, source: "pickup", groundItem: { getPrivateArea: () => house } });
  house.buildingMode = false;
  owner.isRegistered = () => false;
  fire("ground-items:taken", { player: owner, itemId: 3695, amount: 1, source: "pickup", groundItem: { getPrivateArea: () => house } });
  assert.equal(fired("pick-up-your-pet-rock-from-your-poh-menagerie"), 1);

  fire("herblore:made", { player: player(2650, 3680), itemId: Item.SUPER_DEFENCE_3_ });
  assert.equal(fired("mix-a-super-defence-potion-in-the-fremennik-prov"), 1);
  fire("herblore:made", { player: player(3000, 3000), itemId: Item.SUPER_DEFENCE_3_ });
  assert.equal(fired("mix-a-super-defence-potion-in-the-fremennik-prov"), 1);
});
