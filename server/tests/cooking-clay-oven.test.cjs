// Run after `yarn build`: node --test tests/cooking-clay-oven.test.cjs
// The Hosidius Kitchen's clay ovens ("Clay oven" in the cache) cook ordinary food for players with
// the easy Kourend & Kebos Diary, with the Mess registered before Cooking as in game (plugins load
// in path order): the Mess's oven keeps servery food and passes everything else on.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");

before(() => CachePipeline.initialize());

test("raw moonlight antelope cooks on a Hosidius Kitchen clay oven, by Cook and by using it", async (t) => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  core.ObjectDefinition.init();
  core.RegionManager.init();
  require("../plugins/minigames/TheMess.plugin").register(PluginManager.createApi("TheMess"));
  require("../plugins/skills/Cooking.plugin").register(PluginManager.createApi("Cooking"));
  PluginManager.createApi("Rumours").onCustomEvent("hunter:rumours-completed", (request) => { request.completed = 50; });
  const diary = { easy: true, elite: false };
  PluginManager.createApi("TestKourendDiary").onCustomEvent("diary:is-complete", (request) => {
    if (request.diary === "kourend") request.complete = diary[request.tier] === true;
  });
  const Cooking = require("../plugins/skills/Cooking.plugin");

  const obj = (name) => core.CacheDefinitions.getObjId(name);
  const raw = obj("hunting_antelopemoon_meat"), cooked = obj("antelopemoon_cooked"), burnt = obj("burnt_antelope");
  const oven = new core.GameObject(core.ObjectIdentifiers.CLAY_OVEN_3, new core.Location(1677, 3622), 10, 0);
  assert.equal(oven.getDefinition().getName(), "Clay oven");
  core.MapObjects.add(oven);
  t.after(() => core.MapObjects.remove(oven));

  let index = 2900;
  function cook() {
    const p = new Player(new PlayerSession({ kind: "test", isOpen: () => true, send: () => true }))
      .setUsername(`antelope${index}`).setIndex(index++);
    p.setRegistered(true); p.setLocation(new core.Location(1677, 3621)); p.setNeedsPlacement(false);
    p.getSkillManager().setCurrentLevel(core.Skill.COOKING, 150, false).setMaxLevels(core.Skill.COOKING, 150, false)
      .setExperience(core.Skill.COOKING, SkillManager.getExperienceForLevel(99));
    p.getInventory().adds(raw, 1);
    t.after(() => { p.setRegistered(false); Cooking._test.activeSessions.delete(p); core.TaskManager.cancelTasks(p.getIndex()); });
    return p;
  }
  const done = (p) => p.getInventory().getAmount(raw) === 0
    && p.getInventory().getAmount(cooked) + p.getInventory().getAmount(burnt) === 1;

  // Cook (a single raw item on a range cooks at once).
  const clicker = cook();
  const definition = oven.getDefinition();
  assert.equal(PluginManager.emitObjectInteraction({ player: clicker, object: oven, objectId: oven.getId(), definition,
    location: { x: 1677, y: 3622, z: 0 }, clickType: definition.getActions().indexOf("Cook") + 1, handled: false }), true);
  assert.ok(done(clicker), "Cook cooks the antelope");
  assert.equal(clicker.getInventory().getAmount(cooked), 1, "level 150 never burns it");

  // Using the meat on the oven starts the ordinary cook loop.
  const user = cook();
  assert.equal(PluginManager.emitItemOnObject({ player: user, object: oven, objectId: oven.getId(), itemId: raw,
    item: user.getInventory().get(0), slot: 0, handled: false }), true);
  assert.ok(Cooking.isCookingActive(user), "using it on the oven starts cooking");

  // Wiki (Hosidius Kitchen): the easy Kourend & Kebos Diary is required to use the ranges.
  diary.easy = false;
  const blocked = cook();
  assert.equal(PluginManager.emitObjectInteraction({ player: blocked, object: oven, objectId: oven.getId(), definition,
    location: { x: 1677, y: 3622, z: 0 }, clickType: definition.getActions().indexOf("Cook") + 1, handled: false }), true);
  assert.equal(Cooking.isCookingActive(blocked), false, "no cooking without the easy diary");
  assert.equal(blocked.getInventory().getAmount(raw), 1, "and the food is untouched");
});
