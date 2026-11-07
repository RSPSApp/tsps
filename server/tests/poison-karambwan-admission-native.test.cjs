// Real registered cooker admission; run after yarn build in a separate process.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
const { CREATION_MENU_GROUP_ID } = require("../dist/net/packet/PacketSender");

test("untrained cooks can start poorly cooked karambwan at level 1", async (t) => {
  const core = PM.getCoreApi();
  const { World, RegionManager, Location, Skill, SkillManager, Item, GameObject, MapObjects, TaskManager, Inventory } = core;
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldSubmit = TaskManager.submit, oldError = console.error;
  const tasks = new Set(), players = [], errors = []; let started = false, range = null, rangeAdded = false, rangeClipping = [];
  let Cooking = null;
  process.env.DISABLE_PLAYER_BOTS = "1";
  TaskManager.submit = function (task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  t.after(() => {
    const failures = [], safely = (fn) => { try { fn(); } catch (error) { failures.push(String(error)); } };
    try {
      for (const p of players) {
        if (started) safely(() => PM.emitPlayerDisconnect({ player: p, username: p.getUsername(), source: "fixture" }));
        if (Cooking) safely(() => assert.equal(Cooking.isCookingActive(p), false));
        safely(() => { if (p.isRegistered()) World.getPlayers().removes(p); });
      }
      if (rangeAdded) safely(() => {
        assert.equal(MapObjects.get(range.getId(), range.getLocation(), null), range);
        MapObjects.remove(range);
        assert.equal(MapObjects.get(range.getId(), range.getLocation(), null), null);
        for (const [x, y, z, clipping] of rangeClipping) assert.equal(RegionManager.getClipping(x, y, z, null), clipping);
      });
      if (started) safely(() => PM.emitServerShutdown({}));
      for (const task of tasks) safely(() => { if (task.isRunning()) task.stop(); });
      safely(() => World.process());
      for (const task of tasks) safely(() => { if (task.isRunning()) task.stop(); });
    } finally {
      TaskManager.submit = oldSubmit; console.error = oldError;
      if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = oldBots;
    }
    assert.deepEqual(failures, []); assert.deepEqual(errors, []);
  });
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  assert.equal(require("../dist/game/definition/WorldDefinition").isMembersWorld(), true);
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  RegionManager.init(); RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({}); started = true;
  Cooking = require("../plugins/skills/cooking/Cookers.Cooking");
  const CookingCommon = require("../plugins/skills/cooking/Common.Cooking");
  const obj = (name) => { const id = core.CacheDefinitions.getObjId(name); assert.ok(Number.isInteger(id), name); return id; };
  const raw = obj("tbwt_raw_karambwan"), shrimp = obj("raw_shrimp");
  assert.equal(raw, 3142, "active cache identifies unnoted raw karambwan");
  const rangeId = core.CacheDefinitions.getLocId("fai_varrock_range");
  assert.ok(Number.isInteger(rangeId));
  const definition = core.ObjectDefinition.forId(rangeId);
  assert.equal(definition.getName(), "Range"); assert.ok(definition.getActions().includes("Cook"));
  let rangeLocation = null;
  for (let x = 3222; x <= 3234 && !rangeLocation; x++) for (let y = 3218; y <= 3230 && !rangeLocation; y++) {
    const footprint = [];
    for (let dx = 0; dx < definition.getSizeX(); dx++) for (let dy = 0; dy < definition.getSizeY(); dy++) {
      const tile = new Location(x + dx, y + dy, 0);
      footprint.push([tile, RegionManager.getClipping(tile.getX(), tile.getY(), tile.getZ(), null)]);
    }
    const standing = new Location(x - 1, y, 0);
    if (footprint.every(([tile, clip]) => clip === 0 && MapObjects.getObjectsAt(tile, null).length === 0)
      && !RegionManager.blocked(standing, null) && MapObjects.getObjectsAt(standing, null).length === 0) {
      rangeLocation = new Location(x, y, 0);
      rangeClipping = footprint.map(([tile, clip]) => [tile.getX(), tile.getY(), tile.getZ(), clip]);
    }
  }
  assert.ok(rangeLocation, "an empty range footprint and adjacent standing tile exist");
  range = new GameObject(rangeId, rangeLocation, 10, 0);
  assert.equal(MapObjects.get(rangeId, rangeLocation, null), null);
  try { MapObjects.add(range); rangeAdded = true; } catch (error) { rangeAdded = MapObjects.exists(range); throw error; }
  assert.equal(MapObjects.get(rangeId, rangeLocation, null), range);
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  function actor(name, level, item, taught = false) {
    const p = new Player(new PlayerSession(channel())); players.push(p);
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name)); p.setAttribute("bot-skip-persistence", true);
    p.setLocation(rangeLocation.clone().add(-1, 0)); assert.equal(RegionManager.blocked(p.getLocation(), null), false);
    assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    const skills = p.getSkillManager(), xp = SkillManager.getExperienceForLevel(level);
    skills.setExperiences(Skill.COOKING, xp, false); skills.setMaxLevel(Skill.COOKING, level); skills.setCurrentLevels(Skill.COOKING, level);
    if (taught) p.setAttribute("quest.tai_bwo_wannai_trio.tinsay", 8); // seeded training, not a quest playthrough
    p.getInventory().add(new Item(item, 2), true);
    assert.equal(skills.getMaxLevel(Skill.COOKING), level); assert.equal(skills.getCurrentLevel(Skill.COOKING), level);
    assert.equal(skills.getExperience(Skill.COOKING), xp); assert.equal(CookingCommon.level(p), level);
    assert.equal(p.getInventory().getAmount(item), 2);
    return p;
  }
  function admission(p, item) {
    const slot = p.getInventory().getSlotForItemId(item), movement = p.getMovementQueue();
    assert.equal(Cooking.isCookingActive(p), false); assert.equal(p.getCreationMenu() == null, true);
    assert.ok(slot >= 0); let callback = null;
    const oldWalk = movement.walkToObject;
    movement.walkToObject = (object, action) => { assert.equal(object, range); callback = action.execute; };
    try { UseItemPacketListener.itemOnObject(p, Inventory.INTERFACE_ID, rangeId, item, slot, rangeLocation.getX(), rangeLocation.getY()); }
    finally { movement.walkToObject = oldWalk; }
    assert.equal(typeof callback, "function", "real item-on-object listener queues the range action");
    callback(); // controlled adjacent standing, rather than a natural walking journey
    const menu = p.getCreationMenu();
    assert.ok(menu instanceof core.CreationMenu, "the registered cooker opens the quantity menu");
    const sender = p.getPacketSender(), mount = sender.getSubInterfaceAt((162 << 16) | 568);
    assert.equal(sender.isSubInterfaceOpen(CREATION_MENU_GROUP_ID), true);
    assert.equal(mount?.groupId, CREATION_MENU_GROUP_ID);
    assert.equal(menu.getTitle(), "How many would you like to cook?");
    assert.deepEqual(menu.getItems(), [item]);
    assert.equal(p.getInventory().getAmount(item), 2);
    menu.execute(item, 1); // the normal creation-menu action starts the registered session
    assert.equal(Cooking.isCookingActive(p), true);
    assert.equal(p.getInventory().getAmount(item), 2, "no cook or burn roll has run");
  }
  const ordinary = actor("cookshrimp", 1, shrimp);
  admission(ordinary, shrimp);
  const untrained = actor("cookpoor", 1, raw);
  assert.notEqual(untrained.getAttribute("quest.tai_bwo_wannai_trio.tinsay"), 8);
  admission(untrained, raw); // baseline first target, before any random cooking outcome
  assert.equal(untrained.getSkillManager().getExperience(Skill.COOKING), 0);
  const untrained30 = actor("cookpoor30", 30, raw);
  admission(untrained30, raw);
  const trained30 = actor("cooktaught", 30, raw, true);
  admission(trained30, raw);
});
