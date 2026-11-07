// Registered Sherlock dialogue, diary and clue dispatch. Run after yarn build.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NPCOptionPacketListener } = require("../dist/net/packet/impl/NPCOptionPacketListener");

test("Sherlock diary credit preserves ordinary dialogue and clue ownership", async (t) => {
  const core = PM.getCoreApi(), { World, RegionManager, Location, NPC, TaskManager } = core;
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldSubmit = TaskManager.submit, oldError = console.error;
  const tasks = new Set(), players = [], npcs = [], errors = []; let started = false;
  process.env.DISABLE_PLAYER_BOTS = "1";
  TaskManager.submit = function (task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  t.after(() => {
    const failures = [], safely = (fn) => { try { fn(); } catch (error) { failures.push(String(error)); } };
    try {
      for (const p of players) safely(() => { if (p.isRegistered()) World.getPlayers().removes(p); });
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
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  RegionManager.init(); RegionManager.loadMapFiles(2733, 3415);
  PM.emitServerStartup({}); started = true;
  const tile = new Location(2733, 3415, 0);
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  function actor(name) {
    const p = new Player(new PlayerSession(channel())); players.push(p);
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name));
    p.setAttribute("bot-skip-persistence", true); p.setLocation(new Location(2732, 3415, 0));
    assert.equal(RegionManager.blocked(p.getLocation(), null), false);
    assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    return p;
  }
  function placedNpc(id, name) {
    const n = NPC.create(id, tile.clone()); npcs.push(n); n.setScriptedMovement(true);
    assert.equal(World.getNpcs().add(n), true); n.needsPlacement = false;
    assert.equal(n.getCurrentDefinition().getName(), name);
    return n;
  }
  const sherlock = placedNpc(core.NpcIdentifiers.SHERLOCK, "Sherlock");
  const player = actor("diarytalk");
  const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  const diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("kandarin");
  function talk(p, n) {
    const def = n.getCurrentDefinition(p), click = def.getActions().indexOf("Talk-to") + 1;
    assert.ok(click > 0, "active cache exposes Talk-to");
    let queued; const movement = p.getMovementQueue(), original = movement.walkToEntity;
    movement.walkToEntity = (_target, callback) => { queued = callback; return true; };
    try { new NPCOptionPacketListener().executeOption(p, n.getIndex(), click); }
    finally { movement.walkToEntity = original; }
    assert.equal(typeof queued, "function", "real NPC listener queued the interaction");
    queued(); // Captured walking callback, not natural route/timing.
  }
  function drain(p) {
    const manager = p.getDialogueManager(), sender = p.getPacketSender(); let count = 0;
    while (manager.isActive() && count++ < 30) {
      const current = manager.getCurrent();
      const group = current instanceof core.NpcDialogue ? 231 : current instanceof core.PlayerDialogue ? 217 : null;
      assert.ok(group, "expected ordinary NPC/player dialogue"); assert.equal(sender.isChatboxInterface(group), true);
      assert.equal(manager.handleResume(group << 16, 0), true);
    }
    assert.equal(manager.isActive(), false);
  }
  assert.equal(Progress.doneTasks(player, diary).has("speak-to-sherlock"), false);
  talk(player, sherlock);
  assert.equal(Progress.doneTasks(player, diary).has("speak-to-sherlock"), true);
  assert.ok(player.getDialogueManager().getCurrent() instanceof core.PlayerDialogue, "ordinary dialogue starts after diary credit");
  assert.equal(player.getDialogueManager().getCurrent().getText(), "Hey, who're you?");
  drain(player);
  const before = [...Progress.doneTasks(player, diary)];
  talk(player, sherlock);
  assert.ok(player.getDialogueManager().getCurrent() instanceof core.PlayerDialogue, "repeat keeps the ordinary conversation");
  assert.deepEqual([...Progress.doneTasks(player, diary)], before); drain(player);
  const other = placedNpc(core.NpcIdentifiers.HANS, "Hans");
  talk(player, other);
  assert.ok(player.getDialogueManager().getCurrent() instanceof core.NpcDialogue, "other NPC dialogue remains available");
  assert.equal(player.getDialogueManager().getCurrent().getText(), "Hello. What are you doing here?");
  assert.equal(player.getPacketSender().isChatboxInterface(231), true);
  player.closeInterruptibleInterfaces(); assert.equal(player.getDialogueManager().isActive(), false);
  const cluePlayer = actor("cluetalk");
  const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
  const elite = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails").byName.get("elite");
  const step = Runtime.data(elite).steps.find((entry) => entry.skill && entry.npcIds.includes(sherlock.getId()));
  assert.ok(step, "active cache catalogue includes Sherlock skill clue");
  const state = { version: 1, token: "sherlock-control", revision: 0, completed: 1, length: 5, row: step.row };
  cluePlayer.getInventory().setItem(0, new core.Item(step.itemId, 1).setMetaValue(Runtime.metaKey(elite), state));
  const seeded = Runtime.startedTrails(cluePlayer).find((trail) => trail.state.token === state.token);
  assert.ok(seeded, "explicitly seeded elite clue is accepted by the real runtime");
  assert.equal(seeded.step.row, step.row); assert.equal(seeded.state.revision, 0);
  for (const skill of core.Skill.values()) cluePlayer.getSkillManager().setCurrentLevels(skill, 99);
  talk(cluePlayer, sherlock);
  assert.ok(cluePlayer.getDialogueManager().getCurrent() instanceof core.NpcDialogue, "clue before-hook owns the conversation");
  assert.equal(cluePlayer.getDialogueManager().getCurrent().getText(), "Ah, just what I was looking for. I have a challenge for you. If you complete it, I'll give you something.");
  assert.equal(Progress.doneTasks(cluePlayer, diary).has("speak-to-sherlock"), false, "clue hook keeps its existing priority");
  assert.equal(cluePlayer.getPacketSender().isChatboxInterface(231), true);
  assert.equal(cluePlayer.getDialogueManager().handleResume(231 << 16, 0), true);
  const itemBox = cluePlayer.getDialogueManager().getCurrent();
  assert.ok(itemBox instanceof core.ItemStatementDialogue, "handout uses the real item dialogue");
  assert.equal(itemBox.getItemId(), step.skill.itemId);
  assert.equal(itemBox.getText(), "Sherlock has given you a challenge scroll!");
  assert.equal(cluePlayer.getPacketSender().isChatboxInterface(193), true);
  assert.equal(cluePlayer.getInventory().getAmount(step.skill.itemId), 1, "the real clue handler gives its challenge scroll");
  const scroll = cluePlayer.getInventory().getItems().find((item) => item?.getId() === step.skill.itemId);
  const scrollState = structuredClone(scroll.getMetaValue(Runtime.metaKey(elite)));
  assert.equal(scrollState.token, state.token); assert.equal(scrollState.revision, state.revision);
  assert.equal(scrollState.taskDone, false); assert.ok(Runtime.data(elite).tasks.has(scrollState.task));
  assert.equal(cluePlayer.getInventory().getAmount(step.itemId), 1);
  assert.equal(cluePlayer.getDialogueManager().handleResume(193 << 16, 0), true);
  assert.equal(cluePlayer.getDialogueManager().isActive(), false, "no extra generic dialogue follows the clue handout");
  assert.equal(cluePlayer.getInventory().getAmount(step.itemId), 1);
  assert.equal(cluePlayer.getInventory().getAmount(step.skill.itemId), 1);
  assert.deepEqual(scroll.getMetaValue(Runtime.metaKey(elite)), scrollState);
  assert.equal(Progress.doneTasks(cluePlayer, diary).has("speak-to-sherlock"), false);
});
