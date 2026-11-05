// Run after `yarn build`: node --test tests/desert-diary-actions.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const DESERT = Data.BY_KEY.get("desert");
const done = (player, task) => Progress.doneTasks(player, DESERT).has(task);

test("Desert Diary skill, combat and Pyramid Plunder tasks credit only their qualifying action", async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const scheduler = { submit(task) { task.setRunning(true); } };
  const api = {
    ...PluginManager.createApi("DesertDiaryActionTest"),
    core,
    getTaskManager: () => scheduler,
  };
  Diaries.register(api);

  let index = 2000;
  function actor(x, y, z = 0, area = null) {
    const player = new Player(null, new core.Location(x, y, z));
    player.setIndex(index++);
    player.setUsername("desert-diary-test");
    player.setRegistered(true);
    player.setNeedsPlacement(false);
    player.getSession = () => ({ sendClientPacket: () => true, write() {} });
    player.getPrivateArea = () => area;
    return player;
  }
  const send = (name, event) => PluginManager.emitCustomEvent(name, event);
  const npc = (name, x, y, z = 0) => ({
    getLocation: () => new core.Location(x, y, z),
    getCurrentDefinition: () => ({ getName: () => name }),
    getDefinition: () => ({ getName: () => name }),
    getPrivateArea: () => null,
  });
  const kill = (player, name, x, y, z = 0) => PluginManager.emitNpcDeath({ killer: player, npc: npc(name, x, y, z) });

  // Hunter: the two named catches.
  const hunter = actor(3403, 3090);
  send("hunter:success", { player: hunter, npcId: core.NpcIdentifiers.GOLDEN_WARBLER });
  send("hunter:success", { player: hunter, npcId: core.NpcIdentifiers.ORANGE_SALAMANDER });
  assert.equal(done(hunter, "catch-a-golden-warbler"), true);
  assert.equal(done(hunter, "catch-an-orange-salamander"), true);
  send("hunter:success", { player: hunter, npcId: core.NpcIdentifiers.CRIMSON_SWIFT });
  assert.equal(done(hunter, "catch-a-golden-warbler"), true, "a different catch does not add the task again");

  // Five clay in the Uzer mine, not four, and not outside it.
  const clay = actor(3405, 3160);
  for (let i = 0; i < 4; i++) send("mining:success", { player: clay, itemId: core.ItemIdentifiers.CLAY });
  assert.equal(done(clay, "mine-5-clay-in-the-north-eastern-desert"), false);
  send("mining:success", { player: clay, itemId: core.ItemIdentifiers.CLAY });
  assert.equal(done(clay, "mine-5-clay-in-the-north-eastern-desert"), true);
  const wrongClay = actor(3200, 2900);
  for (let i = 0; i < 5; i++) send("mining:success", { player: wrongClay, itemId: core.ItemIdentifiers.CLAY });
  assert.equal(done(wrongClay, "mine-5-clay-in-the-north-eastern-desert"), false);

  // Granite, teak, yew balcony, smithing, cooking, herblore.
  const granite = actor(3200, 2900);
  send("mining:success", { player: granite, itemId: core.ItemIdentifiers.GRANITE_500G_ });
  assert.equal(done(granite, "mine-some-granite"), true);
  const teak = actor(3510, 3072);
  send("woodcutting:success", { player: teak, logId: core.ItemIdentifiers.TEAK_LOGS });
  assert.equal(done(teak, "chop-some-teak-logs-near-uzer"), true);
  const groundTeak = actor(3200, 2900);
  send("woodcutting:success", { player: groundTeak, logId: core.ItemIdentifiers.TEAK_LOGS });
  assert.equal(done(groundTeak, "chop-some-teak-logs-near-uzer"), false);
  const balcony = actor(3440, 2910, 1);
  send("firemaking:success", { player: balcony, itemId: core.ItemIdentifiers.YEW_LOGS });
  assert.equal(done(balcony, "burn-some-yew-logs-on-the-nardah-mayor-s-balcony"), true);
  const downstairs = actor(3440, 2910);
  send("firemaking:success", { player: downstairs, itemId: core.ItemIdentifiers.YEW_LOGS });
  assert.equal(done(downstairs, "burn-some-yew-logs-on-the-nardah-mayor-s-balcony"), false);
  const nardahSmith = actor(3409, 2921);
  send("smithing:success", { player: nardahSmith, itemId: core.ItemIdentifiers.MITHRIL_PLATEBODY });
  assert.equal(done(nardahSmith, "create-a-mithril-platebody-in-nardah"), true);
  const outsideSmith = actor(3200, 2900);
  send("smithing:success", { player: outsideSmith, itemId: core.ItemIdentifiers.MITHRIL_PLATEBODY });
  assert.equal(done(outsideSmith, "create-a-mithril-platebody-in-nardah"), false);
  const oven = actor(3433, 2885);
  send("cooking:success", { player: oven, itemId: core.ItemIdentifiers.WILD_PIE, objectId: 10377 });
  assert.equal(done(oven, "bake-a-wild-pie-at-the-nardah-clay-oven"), true);
  const range = actor(3433, 2885);
  send("cooking:success", { player: range, itemId: core.ItemIdentifiers.WILD_PIE, objectId: 114 });
  assert.equal(done(range, "bake-a-wild-pie-at-the-nardah-clay-oven"), false);
  const potion = actor(3300, 3000);
  send("herblore:made", { player: potion, itemId: core.ItemIdentifiers.COMBAT_POTION_3_ });
  assert.equal(done(potion, "create-a-combat-potion-in-the-desert"), true);
  const outsidePotion = actor(3000, 3000);
  send("herblore:made", { player: outsidePotion, itemId: core.ItemIdentifiers.COMBAT_POTION_3_ });
  assert.equal(done(outsidePotion, "create-a-combat-potion-in-the-desert"), false);

  // NPC kills.
  const vulture = actor(3335, 2862);
  kill(vulture, "Vulture", 3335, 2862);
  assert.equal(done(vulture, "kill-a-vulture"), true);
  const lizard = actor(3400, 3050);
  kill(lizard, "Desert lizard", 3400, 3050);
  assert.equal(done(lizard, "slay-a-desert-lizard"), true);
  const queen = actor(3474, 9496);
  kill(queen, "Kalphite Queen", 3474, 9496);
  assert.equal(done(queen, "kill-the-kalphite-queen"), true);
  const dust = actor(3200, 9370);
  kill(dust, "Dust devil", 3200, 9370);
  assert.equal(done(dust, "slay-a-dust-devil-in-the-desert-cave-with-a-slay"), false,
    "the Slayer helmet is required");
  dust.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(core.ItemIdentifiers.SLAYER_HELMET));
  kill(dust, "Dust devil", 3200, 9370);
  assert.equal(done(dust, "slay-a-dust-devil-in-the-desert-cave-with-a-slay"), true);
  const wrongDust = actor(1708, 10014);
  wrongDust.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(core.ItemIdentifiers.SLAYER_HELMET));
  kill(wrongDust, "Dust devil", 1708, 10014);
  assert.equal(done(wrongDust, "slay-a-dust-devil-in-the-desert-cave-with-a-slay"), false);
  const locust = actor(3280, 9245);
  kill(locust, "Locust rider", 3280, 9245);
  assert.equal(done(locust, "defeat-a-locust-rider-with-keris"), false, "Keris must be equipped");
  locust.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.KERIS));
  kill(locust, "Locust rider", 3280, 9245);
  assert.equal(done(locust, "defeat-a-locust-rider-with-keris"), true);

  // Five potato cactus pickups in the Kalphite Lair.
  const cactus = actor(3180, 9420);
  for (let i = 0; i < 5; i++) {
    send("ground-items:taken", {
      player: cactus,
      groundItem: { position: new core.Location(3180, 9420) },
      itemId: core.ItemIdentifiers.POTATO_CACTUS,
      amount: 1,
    });
  }
  assert.equal(done(cactus, "collect-5-potato-cactus-from-the-kalphite-hive"), true);
  const wrongCactus = actor(3400, 2900);
  for (let i = 0; i < 5; i++) {
    send("ground-items:taken", {
      player: wrongCactus,
      groundItem: { position: new core.Location(3400, 2900) },
      itemId: core.ItemIdentifiers.POTATO_CACTUS,
      amount: 1,
    });
  }
  assert.equal(done(wrongCactus, "collect-5-potato-cactus-from-the-kalphite-hive"), false);

  // Pyramid Plunder: the first room's sarcophagus, the final room's chest, Simon's artefacts.
  const plunder = actor(3300, 2900);
  send("pyramid-plunder:sarcophagus-opened", { player: plunder, room: 1 });
  send("pyramid-plunder:chest-searched", { player: plunder, room: 8 });
  send("pyramid-plunder:artefacts-sold", { player: plunder });
  assert.equal(done(plunder, "open-the-sarcophagus-in-the-first-room-of-pyrami"), true);
  assert.equal(done(plunder, "steal-from-the-grand-gold-chest-in-the-final-roo"), true);
  assert.equal(done(plunder, "sell-some-artefacts-to-simon-templeton"), true);
  const otherRoom = actor(3300, 2900);
  send("pyramid-plunder:sarcophagus-opened", { player: otherRoom, room: 2 });
  send("pyramid-plunder:chest-searched", { player: otherRoom, room: 7 });
  assert.equal(done(otherRoom, "open-the-sarcophagus-in-the-first-room-of-pyrami"), false);
  assert.equal(done(otherRoom, "steal-from-the-grand-gold-chest-in-the-final-roo"), false);

  // Menaphite Thug: a knock-out followed by a pickpocket.
  const thug = actor(3340, 2950);
  send("thieving:success", { player: thug, method: "pickpocket", target: "Menaphite Thug" });
  assert.equal(done(thug, "knock-out-and-pickpocket-a-menaphite-thug"), false, "without a knock-out");
  send("thieving:blackjack-knockout", { player: thug, npcId: core.NpcIdentifiers.MENAPHITE_THUG });
  send("thieving:success", { player: thug, method: "pickpocket", target: "Menaphite Thug" });
  assert.equal(done(thug, "knock-out-and-pickpocket-a-menaphite-thug"), true);

  // Sophanem altar restores at least 85 Prayer.
  const altar = actor(3280, 2775);
  send("altars:prayed", { player: altar, location: { x: 3280, y: 2774, z: 0 }, restored: 84 });
  assert.equal(done(altar, "restore-at-least-85-prayer-points-when-praying-a"), false);
  send("altars:prayed", { player: altar, location: { x: 3280, y: 2774, z: 0 }, restored: 85 });
  assert.equal(done(altar, "restore-at-least-85-prayer-points-when-praying-a"), true);
  const otherAltar = actor(3200, 2900);
  send("altars:prayed", { player: otherAltar, location: { x: 3200, y: 2900, z: 0 }, restored: 99 });
  assert.equal(done(otherAltar, "restore-at-least-85-prayer-points-when-praying-a"), false);
});

test("the real Sophanem altar credits the elite task only when it restores 85+ Prayer", async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const Altars = require("../plugins/objects/Altars.plugin");
  const api = PluginManager.createApi("DesertDiarySophanemAltarTest");
  Diaries.register(api);
  Altars.register(api);

  const altarId = 20377;
  const location = [3280, 2774, 0];
  const definition = core.ObjectDefinition.forId(altarId);
  assert.equal(definition.getName(), "Altar");
  assert.ok(definition.getInteractions().includes("Pray-at"));

  let index = 3000;
  function actor(current, max) {
    const player = new Player(null, new core.Location(3280, 2775, 0));
    player.setIndex(index++);
    player.setUsername("desert-altar-test");
    player.setRegistered(true);
    player.setNeedsPlacement(false);
    player.getSession = () => ({ sendClientPacket: () => true, write() {} });
    player.getPrivateArea = () => null;
    player.getSkillManager().setMaxLevel(core.Skill.PRAYER, max);
    player.getSkillManager().setCurrentLevels(core.Skill.PRAYER, current);
    return player;
  }
  function pray(player) {
    const object = new core.GameObject(altarId, new core.Location(...location), 10, 0, null);
    const event = { player, object, objectId: altarId, clickType: 1, handled: false };
    assert.equal(PluginManager.emitObjectInteraction(event), true);
    assert.equal(event.handled, true);
  }

  const restored = actor(10, 99);
  pray(restored);
  assert.equal(restored.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 99);
  assert.equal(done(restored, "restore-at-least-85-prayer-points-when-praying-a"), true);

  const tooLittle = actor(30, 99);
  pray(tooLittle);
  assert.equal(done(tooLittle, "restore-at-least-85-prayer-points-when-praying-a"), false);

  const full = actor(99, 99);
  pray(full);
  assert.equal(done(full, "restore-at-least-85-prayer-points-when-praying-a"), false);
});

test("Nardah's cache Clay Oven cooks a wild pie through both gameplay interactions and credits the diary", async (t) => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const Cooking = require("../plugins/skills/Cooking.plugin");
  const tasks = [];
  const api = {
    ...PluginManager.createApi("DesertDiaryClayOvenTest"),
    getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
  };
  Diaries.register(api);
  Cooking.register(api);
  const oven = new core.GameObject(core.ObjectIdentifiers.CLAY_OVEN, new core.Location(3433, 2885, 0), 10, 0, null);
  assert.equal(oven.getDefinition().getName(), "Clay Oven");
  assert.ok(oven.getDefinition().getInteractions().includes("Cook"));
  // Supply the local map placement; dispatch, cache definitions, inventory and the cooking loop are real.
  t.mock.method(core.MapObjects, "get", (id) => id === oven.getId() ? oven : null);
  t.mock.method(oven, "isWithinInteractionDistance", () => true);
  let index = 4000;
  for (const interaction of ["use", "cook"]) {
    const player = new Player(null, new core.Location(3433, 2884, 0));
    player.setIndex(index++);
    player.setUsername("desert-clay-oven-test");
    player.setRegistered(true);
    player.setNeedsPlacement(false);
    player.getSession = () => ({ sendClientPacket: () => true, write() {} });
    player.getPrivateArea = () => null;
    player.getSkillManager().setMaxLevel(core.Skill.COOKING, 99);
    player.getSkillManager().setCurrentLevels(core.Skill.COOKING, 99);
    player.getInventory().adds(core.ItemIdentifiers.RAW_WILD_PIE, 1);
    const event = { player, object: oven, objectId: oven.getId(), itemId: core.ItemIdentifiers.RAW_WILD_PIE, item: new core.Item(core.ItemIdentifiers.RAW_WILD_PIE), clickType: 1, handled: false };
    if (interaction === "use") PluginManager.emitItemOnObject(event);
    else PluginManager.emitObjectInteraction(event);
    assert.equal(event.handled, true, `${interaction} reaches the Clay Oven cooking handler`);
    assert.equal(Cooking.isCookingActive(player), true);
    tasks[0].execute();
    tasks[0].execute();
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.RAW_WILD_PIE), 0);
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.WILD_PIE), 1);
    assert.equal(done(player, "bake-a-wild-pie-at-the-nardah-clay-oven"), true);
    // Retire this session before checking the next interaction.
    tasks[0].execute();
  }
});
