// Real pouch actions and worn Redwood lantern; run after yarn build.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { EquipPacketListener } = require("../dist/net/packet/impl/EquipPacketListener");
const { EquipmentRequirements } = require("../dist/game/model/equipment/EquipmentRequirements");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");

test("a worn Redwood lantern prevents pouch decay outside Guardians of the Rift", async (t) => {
  const core = PM.getCoreApi(), { World, RegionManager, Location, Skill, SkillManager, Equipment, Inventory, Item, ItemDefinition, TaskManager } = core;
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldSubmit = TaskManager.submit, oldError = console.error;
  const tasks = new Set(), players = [], errors = []; let started = false;
  process.env.DISABLE_PLAYER_BOTS = "1";
  TaskManager.submit = function (task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  t.after(() => {
    const failures = [], safely = (fn) => { try { fn(); } catch (error) { failures.push(String(error)); } };
    try {
      for (const player of players) safely(() => { if (player.isRegistered()) World.getPlayers().removes(player); });
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
  const Game = require("../plugins/minigames/guardiansoftherift/Game.GuardiansOfTheRift");
  const Pouches = require("../plugins/skills/runecrafting/Pouches.Runecrafting");
  const obj = (name) => { const id = core.CacheDefinitions.getObjId(name); assert.ok(Number.isInteger(id), name); return id; };
  const giant = obj("rcu_pouch_giant"), degraded = obj("rcu_pouch_giant_degrade"), essence = obj("blankrune_high");
  const redwood = obj("abyssal_lantern_redwood"), unlit = obj("abyssal_lantern"), cape = obj("skillcape_runecrafting");
  assert.equal(redwood, 26848, "active cache resolves the non-placeholder Redwood lantern");
  assert.notEqual(redwood, 26849);
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  function actor(name) {
    const p = new Player(new PlayerSession(channel())); players.push(p);
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name)); p.setAttribute("bot-skip-persistence", true);
    p.setLocation(new Location(3222, 3218, 0)); assert.equal(RegionManager.blocked(p.getLocation(), null), false);
    assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    for (const [skill, level] of [[Skill.RUNECRAFTING, 99], [Skill.FIREMAKING, 90]]) {
      p.getSkillManager().setExperiences(skill, SkillManager.getExperienceForLevel(level), false);
      p.getSkillManager().setMaxLevel(skill, level); p.getSkillManager().setCurrentLevels(skill, level);
    }
    assert.equal(Game.isPlaying(p), false, "the actor is outside the Rift match");
    p.getInventory().add(new Item(giant, 1), true);
    // 119 of the existing TSPS threshold is seeded as prior use; no journey claim.
    p.setAttribute(Pouches.POUCHES_ATTRIBUTE, { giant: { amount: 0, type: 0, decay: 119 } });
    return p;
  }
  function equip(p, id, slot) {
    p.getInventory().add(new Item(id, 1), true);
    const at = p.getInventory().getSlotForItemId(id), def = ItemDefinition.forId(id);
    assert.ok(at >= 0 && def); assert.equal(EquipmentRequirements.getUnmet(p, def), null);
    EquipPacketListener.equip(p, id, at, Inventory.INTERFACE_ID);
    assert.equal(p.getEquipment().getItems()[slot].getId(), id, "the real equip action fills the expected slot");
  }
  function action(p, id, option) {
    const at = p.getInventory().getSlotForItemId(id), def = core.CacheDefinitions.getItem(id);
    assert.ok(at >= 0); const op = def.inventoryActions.indexOf(option) + 1; assert.ok(op > 0, `${option} is cache-backed`);
    assert.equal(ItemActionPacketListener.handleAction(p, Inventory.INTERFACE_ID, id, at, op), true);
  }
  const pouchState = (p) => structuredClone(Pouches._test.states(p).giant);
  const ids = { count: core.CacheDefinitions.getVarbitId("giant_essence_pouch"),
    type: core.CacheDefinitions.getVarbitId("giant_essence_pouch_type"),
    decay: core.CacheDefinitions.getVarpId("rcu_pouch_degradation_giant") };
  for (const id of Object.values(ids)) assert.ok(Number.isInteger(id), "pouch cache state is available");
  function assertSynced(p, amount, type, decay) {
    const sender = p.getPacketSender(); assert.equal(sender.getVarbit(ids.count), amount);
    assert.equal(sender.getVarbit(ids.type), type); assert.equal(sender.getVarp(ids.decay), decay);
  }
  function oneFill(p) { p.getInventory().add(new Item(essence, 1), true); action(p, giant, "Fill"); }
  const ordinary = actor("pouchplain");
  assert.ok((ordinary.getEquipment().getItems()[Equipment.CAPE_SLOT]?.getId() ?? -1) <= 0);
  oneFill(ordinary);
  assert.equal(ordinary.getInventory().getAmount(degraded), 1, "without protection the boundary decays");
  assert.equal(pouchState(ordinary).amount, 1); assertSynced(ordinary, 1, 2, 120);
  const protectedPlayer = actor("pouchred"); equip(protectedPlayer, redwood, Equipment.SHIELD_SLOT);
  assert.ok((protectedPlayer.getEquipment().getItems()[Equipment.CAPE_SLOT]?.getId() ?? -1) <= 0);
  assert.equal(protectedPlayer.getSkillManager().getMaxLevel(Skill.FIREMAKING), 90);
  const xpBefore = Skill.values().map((skill) => protectedPlayer.getSkillManager().getExperience(skill));
  const emptyBefore = pouchState(protectedPlayer); action(protectedPlayer, giant, "Fill");
  assert.deepEqual(pouchState(protectedPlayer), emptyBefore, "a no-essence fill leaves the counter unchanged");
  oneFill(protectedPlayer);
  assert.equal(protectedPlayer.getInventory().getAmount(giant), 1, "the worn Redwood lantern prevents degradation");
  assert.equal(protectedPlayer.getInventory().getAmount(degraded), 0);
  assert.deepEqual(pouchState(protectedPlayer), { amount: 1, type: 2, decay: 119 }); assertSynced(protectedPlayer, 1, 2, 119);
  assert.equal(protectedPlayer.getEquipment().getItems()[Equipment.SHIELD_SLOT].getId(), redwood);
  assert.deepEqual(Skill.values().map((skill) => protectedPlayer.getSkillManager().getExperience(skill)), xpBefore);
  action(protectedPlayer, giant, "Empty");
  assert.equal(protectedPlayer.getInventory().getAmount(essence), 1);
  assert.deepEqual(pouchState(protectedPlayer), { amount: 0, type: 0, decay: 119 }); assertSynced(protectedPlayer, 0, 0, 119);
  assert.equal(EquipPacketListener.unequip(protectedPlayer, Equipment.SHIELD_SLOT), true);
  assert.equal(protectedPlayer.getInventory().getAmount(redwood), 1);
  action(protectedPlayer, giant, "Fill");
  assert.equal(protectedPlayer.getInventory().getAmount(degraded), 1, "decay resumes after the lantern is removed");
  assert.equal(pouchState(protectedPlayer).amount, 1); assertSynced(protectedPlayer, 1, 2, 120);
  const carried = actor("pouchcarry"); carried.getInventory().add(new Item(redwood, 1), true); oneFill(carried);
  assert.equal(carried.getInventory().getAmount(degraded), 1, "carried lantern does not provide the worn effect");
  const unlitPlayer = actor("pouchunlit"); equip(unlitPlayer, unlit, Equipment.SHIELD_SLOT); oneFill(unlitPlayer);
  assert.equal(unlitPlayer.getInventory().getAmount(degraded), 1, "unlit lantern does not provide the Redwood effect");
  const caped = actor("pouchcape"); equip(caped, cape, Equipment.CAPE_SLOT); oneFill(caped);
  assert.equal(caped.getInventory().getAmount(giant), 1, "the existing real cape perk remains effective");
  assert.equal(pouchState(caped).decay, 119);
});
