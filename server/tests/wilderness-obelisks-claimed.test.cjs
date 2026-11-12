// Registered diary claim and Wilderness obelisk interaction; run after yarn build.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

test("registered obelisk destination requires the claimed Wilderness hard reward", async (t) => {
  const core = PM.getCoreApi();
  const { World, RegionManager, MapObjects, ObjectDefinition, Location, NPC, TaskManager } = core;
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldSubmit = TaskManager.submit, oldError = console.error;
  const tasks = new Set(), players = [], npcs = [], errors = [];
  let started = false, verifyRestoration = null;
  process.env.DISABLE_PLAYER_BOTS = "1";
  TaskManager.submit = function (task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  t.after(() => {
    const failures = [], safely = (fn) => { try { fn(); } catch (error) { failures.push(String(error)); } };
    try {
      for (const p of players) safely(() => { if (p.isRegistered()) World.getPlayers().removes(p); });
      for (const n of npcs) safely(() => { if (n.isRegistered()) World.getNpcs().removes(n); });
      if (started) safely(() => PM.emitServerShutdown({}));
      if (verifyRestoration) safely(verifyRestoration);
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
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  RegionManager.init(); RegionManager.loadMapFiles(3154, 3618);
  PM.emitServerStartup({}); started = true;
  const obeliskId = 14829, loc = new Location(3154, 3618, 0);
  const stone = MapObjects.get(obeliskId, loc, null), definition = ObjectDefinition.forId(obeliskId);
  const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
  const corners = [[3154, 3618], [3158, 3618], [3154, 3622], [3158, 3622]];
  const assertStones = () => { for (const [x, y] of corners) { const at = new Location(x, y, 0);
    assert.ok(MapObjects.get(obeliskId, at, null), `original stone ${x},${y}`);
    assert.equal(MapObjects.get(14825, at, null), null, `no glowing stone ${x},${y}`); } };
  verifyRestoration = () => { assert.equal(require("../plugins/areas/WildernessObelisks.plugin")._test.active.size, 0); assertStones(); };
  assertStones();
  assert.ok(stone, "active map has the recorded level 13 obelisk stone");
  assert.equal(definition.getName(), "Obelisk");
  const actions = definition.getInteractions();
  for (const action of ["Set Destination", "Teleport to Destination", "Activate"]) assert.ok(actions.includes(action), action);
  assert.ok(Number.isInteger(core.CacheDefinitions.getVarbitId("wilderness_portal_choice")));
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  const actor = (name) => {
    const p = new Player(new PlayerSession(channel())); players.push(p);
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name));
    p.setAttribute("bot-skip-persistence", true); p.setLocation(new Location(3153, 3618, 0));
    assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    assert.equal(RegionManager.blocked(p.getLocation(), null), false, "fixture standing tile is unblocked");
    return p;
  };
  const click = (p, action) => {
    const current = MapObjects.getPrivateArea(p, obeliskId, loc);
    assert.ok(current, "the current map stone is present");
    const def = ObjectDefinition.forPlayer(obeliskId, p);
    assert.equal(def.getName(), "Obelisk");
    const type = def.getInteractions().indexOf(action) + 1;
    assert.ok(type > 0, `active cache exposes ${action}`);
    let queued; const movement = p.getMovementQueue(), original = movement.walkToObject;
    movement.walkToObject = (_object, callback) => { queued = callback; return true; };
    try { new ObjectActionPacketListener().executeAction(p, obeliskId, loc.getX(), loc.getY(), type); }
    finally { movement.walkToObject = original; }
    assert.equal(typeof queued?.execute, "function", `${action} queues the real object action`);
    queued.execute(); // Scoped walk callback adapter; no natural walking claim.
  };
  const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  const diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("wilderness");
  const uncompleted = actor("obelincomp");
  click(uncompleted, "Set Destination"); assert.notEqual(uncompleted.getInterfaceId(), 187);
  const obelisks = require("../plugins/areas/WildernessObelisks.plugin");
  click(uncompleted, "Activate"); assert.equal(obelisks._test.active.size, 1, "ordinary random activation remains available");
  assert.equal(obelisks._test.active.get(0).chosen, false);
  obelisks._test.resetActive(); assertStones();
  const p = actor("obelclaim");
  // Seed the prerequisite task completions and lower-tier claims through the actual progress unit.
  for (const tier of ["easy", "medium", "hard"]) for (const task of diary.tiers[tier].tasks) assert.equal(Progress.completeTask(p, diary, task.key), true);
  for (const tier of ["easy", "medium"]) Progress.claimTier(p, diary, tier);
  assert.equal(Progress.isTierComplete(p, diary, "hard"), true);
  assert.equal(Progress.claimedTiers(p, diary).has("hard"), false);
  const before = { inventory: p.getInventory().getItems().map((item) => [item.getId(), item.getAmount(), structuredClone(item.getMeta())]),
    done: [...Progress.doneTasks(p, diary)], claimed: [...Progress.claimedTiers(p, diary)], xp: core.Skill.values().map((skill) => p.getSkillManager().getExperience(skill)) };
  click(p, "Set Destination"); assert.notEqual(p.getInterfaceId(), 187, "completed but unclaimed must not open the menu");
  assert.deepEqual(core.Skill.values().map((skill) => p.getSkillManager().getExperience(skill)), before.xp);
  assert.deepEqual([...Progress.doneTasks(p, diary)], before.done);
  assert.deepEqual([...Progress.claimedTiers(p, diary)], before.claimed);
  assert.deepEqual(p.getInventory().getItems().map((item) => [item.getId(), item.getAmount(), structuredClone(item.getMeta())]), before.inventory);
  p.setAttribute("wilderness-obelisks:destination", 1);
  click(p, "Teleport to Destination");
  assert.equal(obelisks._test.active.size, 0, "unclaimed cannot start a chosen teleport");
  const npc = NPC.create(core.NpcIdentifiers.LESSER_FANATIC, new Location(3153, 3618, 0)); npcs.push(npc);
  npc.setScriptedMovement(true); assert.equal(World.getNpcs().add(npc), true); npc.needsPlacement = false;
  const nd = npc.getCurrentDefinition(p), talk = nd.getActions().findIndex((v) => v?.toLowerCase() === "talk-to") + 1;
  assert.equal(nd.getName(), "Lesser Fanatic"); assert.ok(talk > 0);
  assert.equal(PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), npcIndex: npc.getIndex(), definition: nd,
    location: { x: 3153, y: 3618, z: 0 }, clickType: talk, handled: false }), true);
  const manager = p.getDialogueManager(), sender = p.getPacketSender();
  const expected = diary.tiers.hard.claim.filter((step) => !step.reward);
  let count = 0;
  for (; manager.isActive() && count < expected.length; count++) {
    const current = manager.getCurrent();
    const group = current instanceof core.NpcDialogue ? 231 : current instanceof core.PlayerDialogue ? 217 : null;
    assert.ok(group, "claim uses the expected NPC or player dialogue");
    const step = expected[count];
    assert.equal(group, step.npc !== undefined ? 231 : 217);
    assert.equal(String(current.getText()).replace(/\s+/g, " ").trim(), String(step.npc ?? step.player).replace(/\s+/g, " ").trim());
    assert.equal(sender.isChatboxInterface(group), true);
    assert.equal(manager.handleResume(group << 16, 0), true);
  }
  assert.equal(manager.isActive(), false); assert.equal(count, expected.length);
  assert.equal(Progress.claimedTiers(p, diary).has("hard"), true, "actual NPC dialogue grants the hard reward");
  assert.deepEqual([...Progress.doneTasks(p, diary)], before.done);
  assert.deepEqual([...Progress.claimedTiers(p, diary)], [...before.claimed, "hard"]);
  assert.deepEqual(core.Skill.values().map((skill) => p.getSkillManager().getExperience(skill)), before.xp);
  const afterItems = p.getInventory().getItems().filter((item) => item.getId() > 0).map((item) => [item.getId(), item.getAmount()]);
  const beforeItems = before.inventory.filter(([id]) => id > 0).map(([id, amount]) => [id, amount]);
  assert.deepEqual(afterItems, [...beforeItems, ...diary.tiers.hard.rewardItems.map((id) => [id, 1])]);
  for (const id of diary.tiers.hard.rewardItems) assert.equal(p.getInventory().getAmount(id), 1);
  click(p, "Set Destination"); assert.equal(p.getInterfaceId(), 187);
  const choice = { player: p, buttonId: (187 << 16) | 3, groupId: 187, childId: 3, action: 1, handled: false };
  assert.equal(PM.emitInterfaceActionClick(choice), true);
  assert.equal(p.getAttribute("wilderness-obelisks:destination"), 2);
  assert.notEqual(p.getInterfaceId(), 187);
  click(p, "Teleport to Destination"); assert.equal(obelisks._test.active.size, 1);
  assert.deepEqual(obelisks._test.active.get(0), { to: 1, chosen: true });
  PM.emitServerShutdown({}); started = false;
  assert.equal(obelisks._test.active.size, 0); assertStones();
});
