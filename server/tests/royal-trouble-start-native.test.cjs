// Registered Advisor Ghrim start dialogue; run after yarn build in a separate process.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { NPCOptionPacketListener } = require("../dist/net/packet/impl/NPCOptionPacketListener");

test("Royal Trouble can start below its later Agility and Slayer requirements", async (t) => {
  const core = PM.getCoreApi(), { World, RegionManager, Location, NPC, TaskManager, Skill, SkillManager, MultiChatboxPrompt } = core;
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldSubmit = TaskManager.submit, oldError = console.error;
  const tasks = new Set(), players = [], npcs = [], errors = [], hooks = []; let started = false;
  process.env.DISABLE_PLAYER_BOTS = "1";
  TaskManager.submit = function (task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  t.after(() => {
    const failures = [], safely = (fn) => { try { fn(); } catch (error) { failures.push(String(error)); } };
    try {
      for (const p of players) {
        safely(() => p.closeInterruptibleInterfaces());
        safely(() => assert.equal(MultiChatboxPrompt.getPending(p), null));
        safely(() => { if (p.isRegistered()) World.getPlayers().removes(p); });
      }
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
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  RegionManager.init(); RegionManager.loadMapFiles(2733, 3415);
  PM.emitServerStartup({}); started = true;
  PM.createApi("RoyalStartObserver").onCustomEvent("npc-dialogue:hook", event => {
    if (event.hook === "quest:royal-trouble:start") hooks.push({ player: event.player, npcId: event.npcId,
      hook: event.hook, quest: event.quest, option: event.option });
  });
  const runtime = require("../plugins/quests/QuestRuntime"), throne = runtime.questNamed("Throne of Miscellania"), royal = runtime.questNamed("Royal Trouble");
  assert.ok(throne && royal, "both real quest producers registered");
  const tile = new Location(2733, 3415, 0), ghrim = NPC.create(5447, tile); npcs.push(ghrim);
  ghrim.setScriptedMovement(true); assert.equal(World.getNpcs().add(ghrim), true); ghrim.needsPlacement = false;
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  function actor(name, agility, slayer, completeThrone = true) {
    const ch = channel(), p = new Player(new PlayerSession(ch)); players.push(p);
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name)); p.setAttribute("bot-skip-persistence", true);
    p.setLocation(new Location(2732, 3415, 0)); assert.equal(RegionManager.blocked(p.getLocation(), null), false);
    assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    const skills = p.getSkillManager();
    for (const [skill, level] of [[Skill.AGILITY, agility], [Skill.SLAYER, slayer]]) {
      skills.setExperiences(skill, SkillManager.getExperienceForLevel(level), false); skills.setMaxLevel(skill, level); skills.setCurrentLevels(skill, level);
      assert.equal(skills.getMaxLevel(skill), level); assert.equal(skills.getCurrentLevel(skill), level);
    }
    if (completeThrone) throne.setStage(p, 100); // seeded completion; no prerequisite journey or quest rewards claimed
    const query = { player: p, key: "throne_of_miscellania", complete: null };
    PM.emitCustomEvent("quest:is-complete", query); assert.equal(query.complete, completeThrone);
    assert.equal(royal.getStage(p), 0);
    const connection = new ClientConnection(ch); connection.player = p;
    return { p, connection, skills };
  }
  function talk(f) {
    const def = ghrim.getCurrentDefinition(f.p), click = def.getActions().indexOf("Talk-to") + 1;
    assert.equal(def.getName(), "Advisor Ghrim"); assert.ok(click > 0);
    assert.ok([5447, 5448].includes(ghrim.getContentId(f.p)), "actual player-resolved Ghrim id is supported");
    let queued; const movement = f.p.getMovementQueue(), original = movement.walkToEntity;
    movement.walkToEntity = (target, callback) => { assert.equal(target, ghrim); queued = callback; return true; };
    try { new NPCOptionPacketListener().executeOption(f.p, ghrim.getIndex(), click); }
    finally { movement.walkToEntity = original; }
    assert.equal(typeof queued, "function"); queued(); // fixture-placed actor and captured walk callback
  }
  function untilPrompt(f) {
    const manager = f.p.getDialogueManager(), sender = f.p.getPacketSender();
    for (let n = 0; n < 30; n++) {
      const prompt = MultiChatboxPrompt.getPending(f.p);
      if (prompt) {
        assert.equal(manager.isActive(), false); assert.equal(sender.isChatboxInterface(219), true);
        assert.equal(sender.getSubInterfaceAt((162 << 16) | 568)?.groupId, 219);
        return prompt;
      }
      const current = manager.getCurrent();
      const group = current instanceof core.NpcDialogue ? 231 : current instanceof core.PlayerDialogue ? 217 : null;
      assert.ok(group, "expected NPC or player dialogue before the next prompt");
      assert.equal(sender.isChatboxInterface(group), true); assert.equal(manager.handleResume(group << 16, 0), true);
    }
    assert.fail("expected prompt was not reached");
  }
  async function choose(f, prompt, expectedTitle, option, options) {
    assert.equal(prompt.title, expectedTitle); assert.deepEqual(prompt.options, options);
    const index = prompt.options.indexOf(option); assert.ok(index >= 0, option);
    await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
    f.connection.processTurnPackets();
  }
  function snapshot(f) {
    const { p, skills } = f, sender = p.getPacketSender();
    return {
      inventory: p.getInventory().getItems().map(item => item && ({ id: item.getId(), amount: item.getAmount(), meta: structuredClone(item.getMeta()) })),
      experience: Skill.values().map(skill => skills.getExperience(skill)),
      agility: [skills.getMaxLevel(Skill.AGILITY), skills.getCurrentLevel(Skill.AGILITY), skills.getExperience(Skill.AGILITY)],
      slayer: [skills.getMaxLevel(Skill.SLAYER), skills.getCurrentLevel(Skill.SLAYER), skills.getExperience(Skill.SLAYER)],
      throne: throne.getStage(p), royal: royal.getStage(p), side: Array.from({ length: 21 }, (_, n) => sender.getVarbit(2141 + n)),
    };
  }
  async function start(f) {
    talk(f);
    const first = f.p.getDialogueManager().getCurrent();
    assert.ok(first instanceof core.NpcDialogue); assert.equal(first.getText(), "Greetings, Your Royal Highness.");
    await choose(f, untilPrompt(f), "Select an option", "Has anything been happening in the kingdom recently?", [
      "How is the Kingdom faring?", "How do I manage the kingdom?", "What am I meant to be doing again?",
      "Has anything been happening in the kingdom recently?",
    ]);
    const confirmation = untilPrompt(f), before = snapshot(f);
    assert.equal(before.throne, 100); assert.equal(before.royal, 0);
    await choose(f, confirmation, "Start the Royal Trouble quest?", "Yes.", ["Yes.", "No."]);
    const observed = hooks.filter(h => h.player === f.p);
    assert.equal(observed.length, 1); assert.deepEqual({ npcId: observed[0].npcId, hook: observed[0].hook, quest: observed[0].quest, option: observed[0].option },
      { npcId: ghrim.getContentId(f.p), hook: "quest:royal-trouble:start", quest: "Royal Trouble", option: "Yes." });
    return before;
  }
  function assertStarted(f, before, message) {
    assert.equal(royal.getStage(f.p), 10, message);
    const after = snapshot(f); assert.equal(after.royal, 10);
    assert.deepEqual({ ...after, royal: before.royal }, before, "starting preserves inventory, skills, Throne and side state");
  }
  function close(f) {
    f.p.closeInterruptibleInterfaces(); assert.equal(MultiChatboxPrompt.getPending(f.p), null);
  }
  const ordinary = actor("royalnormal", 40, 40);
  assert.equal(ghrim.getCurrentDefinition(ordinary.p).getName(), "Advisor Ghrim");
  assert.ok(ghrim.getHitpoints() > 0); assert.equal(RegionManager.blocked(ordinary.p.getLocation(), null), false);
  const ordinaryBefore = await start(ordinary); assertStarted(ordinary, ordinaryBefore, "ordinary level-40 conversation starts the quest");
  close(ordinary); const repeatBefore = snapshot(ordinary); talk(ordinary);
  const repeatFirst = ordinary.p.getDialogueManager().getCurrent();
  assert.ok(repeatFirst instanceof core.NpcDialogue); assert.equal(repeatFirst.getText(), "Greetings, Your Royal Highness.");
  const repeatPrompt = untilPrompt(ordinary);
  assert.equal(repeatPrompt.title, "Select an option"); assert.deepEqual(repeatPrompt.options, ["What am I meant to be doing again?", "Goodbye."]);
  assert.equal(hooks.filter(h => h.player === ordinary.p).length, 1); assert.deepEqual(snapshot(ordinary), repeatBefore); close(ordinary);
  const lowAgility = actor("royalagl", 39, 40);
  const agilityBefore = await start(lowAgility); assertStarted(lowAgility, agilityBefore, "Agility is not required to start");
  const lowSlayer = actor("royalslay", 40, 39);
  const slayerBefore = await start(lowSlayer); assertStarted(lowSlayer, slayerBefore, "Slayer is not required to start");
  const noThrone = actor("royalnot", 40, 40, false);
  const noThroneBefore = snapshot(noThrone);
  // Defensive registered-hook seam, separate from the natural dialogue route above.
  PM.emitCustomEvent("npc-dialogue:hook", { player: noThrone.p, npcId: ghrim.getContentId(noThrone.p), hook: "quest:royal-trouble:start", quest: "Royal Trouble", option: "Yes." });
  assert.deepEqual(snapshot(noThrone), noThroneBefore, "the registered start hook preserves the incomplete prerequisite state");
});
