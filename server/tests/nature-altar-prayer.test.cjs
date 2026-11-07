const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");

test("registered Nature Spirit altar awards the quest bonus without changing diary or ordinary altar controls", async (t) => {
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldError = console.error;
  const actors = [], tasks = new Set(), ownedNpcs = new Set(), errors = [];
  function observeOwned() {
    if (!core) return;
    const keep = (npc) => { if (npc && actors.includes(npc.getOwner?.())) ownedNpcs.add(npc); };
    core.World.getNpcs().forEach(keep);
    core.World.getAddNPCQueue().forEach(keep);
  }
  let core, submit, started = false;
  process.env.DISABLE_PLAYER_BOTS = "1";
  t.after(() => {
    try {
      observeOwned();
      for (const player of actors) if (player.isRegistered()) core.World.getPlayers().removes(player);
      if (started) PM.emitServerShutdown({});
      for (const task of tasks) if (task.isRunning()) task.stop();
      if (core) core.World.process();
      assert.ok([...tasks].every((task) => !task.isRunning()), "fixture tasks stop");
      assert.ok([...ownedNpcs].every((npc) => !npc.isRegistered() && !core.World.getAddNPCQueue().includes(npc)), "actor-owned quest NPCs are removed");
      assert.deepEqual(errors, [], "no hidden plugin or teardown errors");
    } finally {
      if (core && submit) core.TaskManager.submit = submit;
      console.error = oldError;
      if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = oldBots;
    }
  });
  console.error = (...args) => { errors.push(args.map(String).join(" ")); return oldError.apply(console, args); };
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  submit = core.TaskManager.submit;
  core.TaskManager.submit = function (...args) { if (args[0]) tasks.add(args[0]); return submit.apply(this, args); };
  core.ObjectDefinition.init();
  core.RegionManager.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  assert.equal(core.WorldDefinition.isMembersWorld(), true, "Nature Spirit plugin is enabled on the members world");
  assert.ok(PM.loadedPlugins.includes("Altars") && PM.loadedPlugins.includes("Quests"), "both production plugins actually loaded");
  const quests = require("../plugins/quests/QuestRuntime");
  const quest = quests.questNamed("Nature Spirit");
  assert.ok(quest, "actual Quests registration includes Nature Spirit");
  PM.emitServerStartup({}); started = true;
  const { World, Location, Skill, ObjectDefinition, MapObjects, RegionManager } = core;
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} });
  function actor(name) {
    const p = new Player(new PlayerSession(channel())); actors.push(p);
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name));
    p.setAttribute("bot-skip-persistence", true); p.setLocation(new Location(3441, 9736, 1));
    assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    p.getSkillManager().setMaxLevel(Skill.PRAYER, 10);
    return p;
  }
  const p = actor("nataltar");
  quest.setStage(p, 110);
  assert.equal(quest.isComplete(p), true, "real quest stage producer confirms completion");
  RegionManager.loadMapFiles(3441, 9736);
  const natural = [...MapObjects.mapObjects.values()].flat().filter((o) => {
    const l = o.getLocation();
    return l.getX() >= 3435 && l.getX() <= 3448 && l.getY() >= 9733 && l.getY() <= 9746
      && l.getZ() === 1 && ObjectDefinition.forPlayer(o.getId(), p)?.getName() === "Altar of nature";
  });
  assert.equal(natural.length, 1, "active map contains one Nature Grotto altar");
  const altar = natural[0], loc = altar.getLocation();
  const definition = ObjectDefinition.forPlayer(altar.getId(), p);
  const option = definition.getInteractions().findIndex((x) => x?.toLowerCase() === "pray-at") + 1;
  assert.ok(option > 0, "active transformed altar offers Pray-at");
  assert.equal(definition.id, 3521, "active object is the cache-backed Nature altar");
  const rotated = altar.getFace() % 2 !== 0;
  const width = rotated ? definition.getSizeY() : definition.getSizeX();
  const length = rotated ? definition.getSizeX() : definition.getSizeY();
  assert.ok(width > 0 && length > 0, "active definition supplies the altar footprint");
  const candidates = [];
  for (let dx = 0; dx < width; dx++) {
    candidates.push(new Location(loc.getX() + dx, loc.getY() - 1, loc.getZ()));
    candidates.push(new Location(loc.getX() + dx, loc.getY() + length, loc.getZ()));
  }
  for (let dy = 0; dy < length; dy++) {
    candidates.push(new Location(loc.getX() - 1, loc.getY() + dy, loc.getZ()));
    candidates.push(new Location(loc.getX() + width, loc.getY() + dy, loc.getZ()));
  }
  const adjacent = candidates.find((tile) => !RegionManager.blocked(tile, null));
  assert.ok(adjacent, "active map has a walkable tile adjacent to the rotated altar footprint");
  assert.equal(RegionManager.blocked(adjacent, null), false);
  p.setLocation(adjacent.clone());
  const diaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
  const diaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  const diary = diaryData.BY_KEY.get("morytania");
  const done = (player) => diaryProgress.doneTasks(player, diary).has("restore-your-prayer-points-at-the-nature-altar");
  const reports = new Map();
  PM.createApi("NatureAltarFixture").onCustomEvent("altar:nature", ({ player }) => reports.set(player, (reports.get(player) ?? 0) + 1));
  function observe(player) {
    const count = { animation: 0, sound: 0, update: 0 }, sender = player.getPacketSender(), skills = player.getSkillManager();
    const animation = player.performAnimation.bind(player), sound = sender.sendSoundEffect.bind(sender), update = skills.updateSkill.bind(skills);
    player.performAnimation = (...args) => { count.animation++; return animation(...args); };
    sender.sendSoundEffect = (...args) => { count.sound++; return sound(...args); };
    skills.updateSkill = (...args) => { if (args[0] === Skill.PRAYER) count.update++; return update(...args); };
    return count;
  }
  function conservation(player) {
    const sm = player.getSkillManager();
    return { hp: player.getHitpoints(), basePrayer: sm.getMaxLevel(Skill.PRAYER), xp: sm.getExperience(Skill.PRAYER),
      items: player.getInventory().getItems().map((item) => [item.getId(), item.getAmount()]), stage: quest.getStage(player) };
  }
  function pray(player, object, clickType) {
    const movement = player.getMovementQueue(), oldWalk = movement.walkToObject;
    let action;
    movement.walkToObject = (_object, queued) => { action = queued; return true; };
    const visibleId = ObjectDefinition.forPlayer(object.getId(), player)?.id;
    assert.ok(Number.isInteger(visibleId), "player sees an active cache object");
    try { new ObjectActionPacketListener().executeAction(player, visibleId, object.getLocation().getX(), object.getLocation().getY(), clickType); }
    finally { movement.walkToObject = oldWalk; }
    assert.equal(typeof action?.execute, "function", "real object listener queued the action");
    action.execute(); // adapter follows the accepted altar route; it is not a movement-timing proof.
  }
  // An ordinary cache-backed altar is a positive dispatch control before the target.
  RegionManager.loadMapFiles(2617, 3309);
  const ordinary = MapObjects.get(core.ObjectIdentifiers.ALTAR, new Location(2617, 3309, 0), null);
  assert.ok(ordinary, "active map contains the East Ardougne altar");
  const normal = actor("ordinary");
  const ordinaryAdjacent = new Location(2616, 3309, 0);
  assert.equal(RegionManager.blocked(ordinaryAdjacent, null), false, "known adjacent ordinary-altar tile is walkable");
  const placement = (tile) => {
    const clip = RegionManager.getClipping(tile.getX(), tile.getY(), tile.getZ(), null);
    return { x: tile.getX(), y: tile.getY(), z: tile.getZ(), clip, floorDecoration: (clip & 0x40000) !== 0,
      blockedCurrent: (clip & 0x12c0100) !== 0 };
  };
  console.log("nature-altar fixture placement", JSON.stringify({ nature: placement(adjacent),
    candidates: candidates.map(placement), ordinary: placement(ordinaryAdjacent) }));
  normal.setLocation(ordinaryAdjacent);
  normal.getSkillManager().setCurrentLevels(Skill.PRAYER, 1);
  const normalDef = ObjectDefinition.forPlayer(ordinary.getId(), normal);
  const normalOp = normalDef.getInteractions().findIndex((x) => x?.toLowerCase() === "pray-at") + 1;
  assert.ok(normalOp > 0); pray(normal, ordinary, normalOp);
  assert.equal(normal.getSkillManager().getCurrentLevel(Skill.PRAYER), 10, "ordinary registered altar restores Prayer");
  const skills = p.getSkillManager(); skills.setCurrentLevels(Skill.PRAYER, 1);
  const stable = conservation(p), effect = observe(p);
  assert.equal(done(p), false);
  pray(p, altar, option);
  assert.equal(skills.getCurrentLevel(Skill.PRAYER), 12, "completed quest applies the two-point bonus");
  assert.equal(done(p), true, "a below-full restore awards the existing diary task");
  assert.deepEqual(effect, { animation: 1, sound: 1, update: 2 }, "quest effect occurs once, including its existing two refresh calls");
  assert.equal(reports.get(p), 1, "one real restore event");
  assert.deepEqual(conservation(p), stable, "prayer action conserves unrelated actor state");
  const previous = { ...effect }; pray(p, altar, option);
  assert.equal(skills.getCurrentLevel(Skill.PRAYER), 12, "repeat does not stack the bonus");
  assert.deepEqual(effect, previous, "full bonus repeats no animation, sound or skill update");
  assert.equal(reports.get(p), 1, "full bonus repeats no restore event");
  const full = actor("natfull"); quest.setStage(full, 110); full.setLocation(adjacent.clone());
  full.getSkillManager().setCurrentLevels(Skill.PRAYER, 10); pray(full, altar, option);
  assert.equal(full.getSkillManager().getCurrentLevel(Skill.PRAYER), 12);
  assert.equal(done(full), false, "boost from normal full does not grant restore diary credit");
  full.getSkillManager().setCurrentLevels(Skill.PRAYER, 13); pray(full, altar, option);
  assert.equal(full.getSkillManager().getCurrentLevel(Skill.PRAYER), 13, "higher existing boost is preserved");
  const incomplete = actor("natunfinish"); quest.setStage(incomplete, 0); incomplete.setLocation(adjacent.clone());
  assert.equal(quest.isComplete(incomplete), false, "actual quest gate is incomplete");
  incomplete.getSkillManager().setCurrentLevels(Skill.PRAYER, 1);
  // Adapt the object event for this gate: the real scene can transform away an unfinished altar.
  const unfinishedEvent = { player: incomplete, object: altar, definition: ObjectDefinition.forId(3521),
    objectId: 3521, clickType: option, option: "pray-at", handled: false };
  assert.equal(PM.emitObjectInteraction(unfinishedEvent), true);
  assert.equal(incomplete.getSkillManager().getCurrentLevel(Skill.PRAYER), 10, "unfinished quest retains ordinary restoration, without the bonus");
  assert.deepEqual(errors, []);
});
