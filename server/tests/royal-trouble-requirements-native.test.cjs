// Registered Royal Trouble obstacle and combat policy controls; run after yarn build.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

test("Royal Trouble enforces later skill requirements without trapping players", async (t) => {
  const core = PM.getCoreApi(), { World, RegionManager, Location, NPC, GameObject, Item, TaskManager, Skill, SkillManager, CombatFactory, CanAttackResponse } = core;
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldSubmit = TaskManager.submit, oldError = console.error;
  const tasks = new Set(), players = [], npcs = [], errors = []; let started = false;
  process.env.DISABLE_PLAYER_BOTS = "1";
  TaskManager.submit = function (task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  t.after(() => {
    const failures = [], safely = fn => { try { fn(); } catch (error) { failures.push(String(error)); } };
    try {
      for (const p of players) { safely(() => p.closeInterruptibleInterfaces()); safely(() => { if (p.isRegistered()) World.getPlayers().removes(p); }); }
      for (const n of npcs) safely(() => { if (n.isRegistered()) World.getNpcs().removes(n); });
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
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); RegionManager.init(); RegionManager.loadMapFiles(2733, 3415);
  PM.emitServerStartup({}); started = true;
  const royal = require("../plugins/quests/QuestRuntime").questNamed("Royal Trouble"); assert.ok(royal);
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  function actor(name, baseAgility, currentAgility, baseSlayer, currentSlayer) {
    const p = new Player(new PlayerSession(channel())); players.push(p);
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name)); p.setAttribute("bot-skip-persistence", true);
    p.setLocation(new Location(2732, 3415, 0)); assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    const skills = p.getSkillManager();
    for (const [skill, base, current] of [[Skill.AGILITY, baseAgility, currentAgility], [Skill.SLAYER, baseSlayer, currentSlayer]]) {
      skills.setExperiences(skill, SkillManager.getExperienceForLevel(base), false); skills.setMaxLevel(skill, base); skills.setCurrentLevels(skill, current);
      assert.equal(skills.getMaxLevel(skill), base); assert.equal(skills.getCurrentLevel(skill), current);
    }
    royal.setStage(p, 10); // seeded later-action state, not an earned quest journey
    p.setAttribute("royal-trouble:used-mining-prop", true);
    p.setAttribute("royal-trouble:chapters", 5); p.setAttribute("royal-trouble:diary-read", true); p.setAttribute("royal-trouble:kids-cutscene", true);
    return p;
  }
  function click(p, id, x, y, z) {
    const def = core.ObjectDefinition.forId(id); assert.ok(def);
    const tunnel = id === 15188 || id === 15189;
    assert.equal(def.getName(), tunnel ? "Tunnel" : "Crevice");
    assert.equal(def.getActions()[0], tunnel ? "Enter" : "Squeeze-through");
    const object = new GameObject(id, new Location(x, y, z), 10, 0);
    assert.equal(object.getId(), id);
    const event = { player: p, object, objectId: id, definition: def, clickType: 1, location: { x, y, z }, handled: false };
    PM.emitObjectInteraction(event); assert.equal(event.handled, true, `registered quest handler claims ${id}`);
  }
  function at(p, x, y, z) { p.setLocation(new Location(x, y, z)); }
  function pos(p) { const l = p.getLocation(); return [l.getX(), l.getY(), l.getZ()]; }
  function snapshot(p) {
    const s = p.getSkillManager();
    return { pos: pos(p), inventory: p.getInventory().getItems().map(item => item && ({ id: item.getId(), amount: item.getAmount(), meta: structuredClone(item.getMeta()) })),
      experience: Skill.values().map(skill => s.getExperience(skill)), agility: [s.getMaxLevel(Skill.AGILITY), s.getCurrentLevel(Skill.AGILITY)],
      slayer: [s.getMaxLevel(Skill.SLAYER), s.getCurrentLevel(Skill.SLAYER)], stage: royal.getStage(p),
      prop: p.getAttribute("royal-trouble:used-mining-prop"), chapters: p.getAttribute("royal-trouble:chapters"),
      diary: p.getAttribute("royal-trouble:diary-read"), cutscene: p.getAttribute("royal-trouble:kids-cutscene") };
  }
  function xpReady(p) {
    const gate = PM.emitCanGainExperience(p, Skill.AGILITY, 1);
    assert.notEqual(gate.allow, false); assert.equal(gate.multiplier, 1);
    assert.notEqual(p.getAttribute(SkillManager.XP_LOCKED_ATTRIBUTE), true);
  }
  const high = actor("royalhigh", 40, 40, 40, 40);
  at(high, 2505, 10280, 0); xpReady(high); const highXp = high.getSkillManager().getExperience(Skill.AGILITY);
  click(high, 15186, 2505, 10281, 0);
  assert.deepEqual(pos(high), [2505, 10283, 0], "the registered first crevice works at level 40");
  const low = actor("royallow", 39, 39, 40, 40);
  at(low, 2505, 10280, 0); const lowXp = low.getSkillManager().getExperience(Skill.AGILITY);
  const lowBefore = snapshot(low);
  const lowMessages = [], originalSendMessage = low.sendMessage;
  low.sendMessage = function (message) { lowMessages.push(message); return originalSendMessage.call(this, message); };
  click(low, 15186, 2505, 10281, 0);
  assert.deepEqual(lowMessages.splice(0), ["You need an Agility level of 40 to go further into the dungeon."]);
  assert.deepEqual(pos(low), [2505, 10280, 0], "inward crevice refuses current Agility 39");
  assert.deepEqual(snapshot(low), lowBefore); assert.equal(low.getSkillManager().getExperience(Skill.AGILITY), lowXp);
  assert.equal(high.getSkillManager().getExperience(Skill.AGILITY) - highXp, core.GameConstants.EXPERIENCE_MULTIPLIER);
  const boosted = actor("royalboost", 39, 39, 40, 40);
  boosted.getSkillManager().increaseCurrentLevel(Skill.AGILITY, 1, 40);
  assert.equal(boosted.getSkillManager().getMaxLevel(Skill.AGILITY), 39); assert.equal(boosted.getSkillManager().getCurrentLevel(Skill.AGILITY), 40);
  at(boosted, 2505, 10280, 0); xpReady(boosted); const boostedXp = boosted.getSkillManager().getExperience(Skill.AGILITY);
  click(boosted, 15186, 2505, 10281, 0); assert.deepEqual(pos(boosted), [2505, 10283, 0]);
  assert.equal(boosted.getSkillManager().getExperience(Skill.AGILITY) - boostedXp, core.GameConstants.EXPERIENCE_MULTIPLIER);
  const drained = actor("royaldrain", 40, 39, 40, 40);
  at(drained, 2505, 10280, 0); click(drained, 15186, 2505, 10281, 0); assert.deepEqual(pos(drained), [2505, 10280, 0]);
  at(low, 2505, 10283, 0); click(low, 15187, 2505, 10282, 0); assert.deepEqual(pos(low), [2505, 10280, 0], "low level can leave");
  assert.deepEqual(lowMessages.splice(0), [], "leaving does not send an Agility refusal");
  assert.equal(low.getSkillManager().getExperience(Skill.AGILITY), lowXp);
  // Direct registered-handler seam with cache definitions and seeded quest state; not natural map walking.
  low.getInventory().add(new Item(core.ItemIdentifiers.PULLEY_BEAM, 1), true);
  for (const [inside, outside, from, to, exit] of [
    [15188, 15189, [2511, 10287, 1], [2514, 10291, 0], [2512, 10287, 1]],
    [15194, 15195, [2585, 10263, 0], [2580, 10268, 0], [2585, 10263, 0]],
    [15196, 15197, [2617, 10270, 0], [2617, 10275, 0], [2617, 10270, 0]],
  ]) {
    at(low, ...from); const before = snapshot(low), xp = low.getSkillManager().getExperience(Skill.AGILITY);
    click(low, inside, ...from); assert.deepEqual(lowMessages.splice(0), ["You need an Agility level of 40 to go further into the dungeon."]); assert.deepEqual(snapshot(low), before); assert.equal(low.getSkillManager().getExperience(Skill.AGILITY), xp);
    assert.equal(low.getInventory().getAmount(core.ItemIdentifiers.PULLEY_BEAM), 1, "a refused tunnel must not consume carried beams");
    at(high, ...from); xpReady(high); const prior = high.getSkillManager().getExperience(Skill.AGILITY);
    click(high, inside, ...from); assert.deepEqual(pos(high), to);
    assert.equal(high.getSkillManager().getExperience(Skill.AGILITY) - prior, core.GameConstants.EXPERIENCE_MULTIPLIER);
    at(low, ...to); const outward = snapshot(low); click(low, outside, ...to);
    assert.deepEqual(pos(low), exit); assert.deepEqual({ ...snapshot(low), pos: outward.pos }, outward);
    assert.deepEqual(lowMessages.splice(0), [], "outward passage does not send an Agility refusal");
  }
  const firstScene = actor("royalscene", 39, 39, 40, 40);
  firstScene.setAttribute("royal-trouble:kids-cutscene", false); at(firstScene, 2585, 10263, 0);
  const sceneBefore = snapshot(firstScene), sender = firstScene.getPacketSender(), originalMove = sender.sendCameraMoveTo, originalLook = sender.sendCameraLookAt; let cameras = 0;
  sender.sendCameraMoveTo = function (...args) { cameras++; return originalMove.apply(this, args); };
  sender.sendCameraLookAt = function (...args) { cameras++; return originalLook.apply(this, args); };
  try { click(firstScene, 15194, 2585, 10263, 0); } finally { sender.sendCameraMoveTo = originalMove; sender.sendCameraLookAt = originalLook; }
  assert.deepEqual(snapshot(firstScene), sceneBefore); assert.equal(cameras, 0, "a refused entry does not start the scene");
  const snake = NPC.create(1101, new Location(2733, 3415, 0)); npcs.push(snake); snake.setScriptedMovement(true);
  assert.equal(World.getNpcs().add(snake), true); snake.needsPlacement = false;
  assert.equal(snake.getCurrentDefinition().getName(), "Giant Sea Snake"); assert.ok(snake.getHitpoints() > 0);
  assert.ok((snake.getCurrentDefinition().getSlayerLevel?.() ?? 0) <= 1, "the generic Slayer definition does not supply this gate");
  const firing = require("../plugins/items/dwarfcannon/Firing.DwarfCannon");
  const slayerHigh = actor("slayerhigh", 40, 40, 40, 40), slayerLow = actor("slayerlow", 40, 40, 39, 39);
  assert.equal(CombatFactory.canAttackByPolicy(slayerHigh, snake), CanAttackResponse.CAN_ATTACK);
  assert.equal(firing.canTarget(slayerHigh, snake), true);
  const combatBefore = snapshot(slayerLow), hp = snake.getHitpoints();
  assert.notEqual(CombatFactory.canAttackByPolicy(slayerLow, snake), CanAttackResponse.CAN_ATTACK);
  assert.equal(firing.canTarget(slayerLow, snake), false);
  assert.deepEqual(snapshot(slayerLow), combatBefore); assert.equal(snake.getHitpoints(), hp);
  const other = NPC.create(core.NpcIdentifiers.GOBLIN, new Location(2733, 3416, 0)); npcs.push(other); other.setScriptedMovement(true);
  assert.equal(World.getNpcs().add(other), true); other.needsPlacement = false;
  assert.equal(CombatFactory.canAttackByPolicy(slayerLow, other), CanAttackResponse.CAN_ATTACK, "the quest gate does not block an unrelated NPC");
  slayerLow.getSkillManager().increaseCurrentLevel(Skill.SLAYER, 1, 40);
  assert.equal(slayerLow.getSkillManager().getMaxLevel(Skill.SLAYER), 39); assert.equal(slayerLow.getSkillManager().getCurrentLevel(Skill.SLAYER), 40);
  assert.equal(CombatFactory.canAttackByPolicy(slayerLow, snake), CanAttackResponse.CAN_ATTACK, "temporary Slayer boost permits attack admission");
  assert.equal(firing.canTarget(slayerLow, snake), true);
  slayerHigh.getSkillManager().setCurrentLevels(Skill.SLAYER, 39);
  assert.notEqual(CombatFactory.canAttackByPolicy(slayerHigh, snake), CanAttackResponse.CAN_ATTACK, "a drained current Slayer level is checked");
  assert.equal(firing.canTarget(slayerHigh, snake), false);
});
