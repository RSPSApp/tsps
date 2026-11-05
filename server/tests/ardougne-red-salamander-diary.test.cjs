const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Hunter = require("../plugins/skills/hunter/Context.Hunter");
const Traps = require("../plugins/skills/hunter/Traps.Hunter");
const HunterData = require("../plugins/skills/hunter/Data.Hunter");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryPlugin = require("../plugins/achievements/diaries/ArdougneRedSalamanderDiary.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

let core;
let emit;
const diary = DiaryData.BY_KEY.get("ardougne");
const { TASK, RED_SALAMANDER_METHOD } = DiaryPlugin._test;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const listeners = new Map();
  emit = (name, event) => (listeners.get(name) ?? []).forEach((handler) => handler(event));
  const api = new Proxy({
    core,
    onCustomEvent(name, handler) {
      const handlers = listeners.get(name) ?? [];
      handlers.push(handler);
      listeners.set(name, handlers);
    },
    emitCustomEvent: emit,
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  Progress(api);
  api.onCustomEvent("diary:task", Diaries._test.onTask);
  DiaryPlugin.register(api);
  Hunter.H.api = { core, emitCustomEvent: emit };
  Hunter.H.core = {
    ...core,
    ObjectManager: { deregister() {} },
    World: { getRemovedObjects: () => [] },
  };
  Hunter.H.data = HunterData.build(Hunter.H.core);
  Hunter.H.traps.clear();
  Hunter.H.actions.clear();
  Hunter.H.tick = 0;
});

function fixture(t, { state = "caught", full = false } = {}) {
  const player = new Player(null, new core.Location(2700, 3300, 0));
  player.setIndex(2499);
  player.setUsername("ardougne-red-salamander-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  const inventory = player.getInventory();
  if (full) {
    for (let slot = 0; slot < inventory.capacity(); slot++) inventory.setItem(slot, new core.Item(core.ItemIdentifiers.BONES, 1));
  } else {
    inventory.setItem(0, new core.Item(core.ItemIdentifiers.SMALL_FISHING_NET, 1));
    inventory.setItem(1, new core.Item(core.ItemIdentifiers.ROPE, 1));
  }
  const location = player.getLocation().clone();
  const creature = Hunter.H.data.creatures.find((entry) => entry.npc === core.NpcIdentifiers.RED_SALAMANDER);
  const object = {
    getId: () => creature.caught,
    getLocation: () => location,
    getPrivateArea: () => null,
  };
  const trap = {
    player,
    kind: RED_SALAMANDER_METHOD,
    location,
    area: null,
    base: null,
    objects: [object],
    state,
    creature,
    xp: 272,
    rewards: null,
    expires: 100,
    bait: null,
    smoked: false,
    npc: null,
  };
  Hunter.H.traps.add(trap);
  t.after(() => {
    Hunter.H.traps.delete(trap);
    Hunter.H.actions.delete(player);
    player.setRegistered(false);
  });
  return { player, object, trap };
}

function done(player) {
  return Progress.doneTasks(player, diary).has(TASK);
}

test("collecting a caught red salamander completes Ardougne Hard task 6", (t) => {
  const { player, object, trap } = fixture(t);

  assert.equal(Traps.check({ player, object }), true);
  assert.ok(Hunter.H.actions.has(player), "collection waits for the trap's dismantle ticks");
  Hunter.H.tick = 2;
  Hunter.processActions();

  assert.ok(player.getInventory().contains(core.ItemIdentifiers.RED_SALAMANDER));
  assert.equal(trap.state, "caught");
  assert.ok(done(player));
  assert.equal(Progress.tierCount(player, diary, "hard"), 1);
  assert.equal(player.getPacketSender().getVarbit(diary.tiers.hard.countVarbit), 1);
  assert.equal(player.getPacketSender().getVarbit(diary.startedVarbit), 1);
});

test("failed and full-inventory traps do not complete the task", (t) => {
  const failed = fixture(t, { state: "failed" });
  assert.equal(Traps.check({ player: failed.player, object: failed.object }), true);
  assert.equal(Hunter.H.actions.has(failed.player), false);
  assert.equal(done(failed.player), false);

  const full = fixture(t, { full: true });
  assert.equal(Traps.check({ player: full.player, object: full.object }), true);
  assert.equal(Hunter.H.actions.has(full.player), false);
  assert.equal(done(full.player), false);
  assert.equal(full.trap.state, "caught", "a full inventory leaves the caught trap intact");
});

test("moving before collection finishes cancels it without diary progress", (t) => {
  const { player, object } = fixture(t);
  Traps.check({ player, object });
  player.moveTo(new core.Location(2701, 3300, 0));
  Hunter.H.tick = 2;
  Hunter.processActions();

  assert.equal(done(player), false);
  assert.equal(Hunter.H.actions.has(player), false);
});

test("other Hunter results and invalid players do not complete the task", () => {
  const player = new Player(null, new core.Location(2700, 3300, 0));
  player.setIndex(2499);
  player.setUsername("ardougne-red-salamander-test-invalid");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  const initialCount = player.getPacketSender().getVarbit(diary.tiers.hard.countVarbit);
  const fire = (who, method, npcId) => emit("hunter:success", { player: who, method, npcId });

  fire(player, RED_SALAMANDER_METHOD, core.NpcIdentifiers.ORANGE_SALAMANDER);
  fire(player, "box", core.NpcIdentifiers.RED_SALAMANDER);
  fire(null, RED_SALAMANDER_METHOD, core.NpcIdentifiers.RED_SALAMANDER);
  fire({ isRegistered: () => false, getHitpoints: () => 99 }, RED_SALAMANDER_METHOD, core.NpcIdentifiers.RED_SALAMANDER);

  assert.equal(Progress.doneTasks(player, diary).has(TASK), false);
  assert.equal(player.getPacketSender().getVarbit(diary.tiers.hard.countVarbit), initialCount);
  player.setRegistered(false);
});
