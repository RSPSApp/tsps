const assert = require("node:assert/strict");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
const { Boundary } = require("../dist/game/model/Boundary");
const { World } = require("../dist/game/World");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { DamageFormulas } = require("../dist/game/content/combat/formula/DamageFormulas");
const { MagicCombatMethod } = require("../dist/game/content/combat/method/impl/MagicCombatMethod");
const { CombatFactory, CanAttackResponse } = require("../dist/game/content/combat/CombatFactory");
const AchievementDiaries = require("../plugins/achievements/AchievementDiaries.plugin");
const IceBarrageDiary = require("../plugins/achievements/diaries/ArdougneIceBarrageDiary.plugin");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

let core;
let diary;
let game;
let nextIndex = 5000;
const pendingAreaRemovals = [];
const method = new MagicCombatMethod();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("ardougne");

  AchievementDiaries.register(PluginManager.createApi("IceBarrageDiaryProgressTest"));
  IceBarrageDiary.register(PluginManager.createApi("IceBarrageDiaryTest"));

  const registry = {
    core,
    getAreaManager: () => AreaManager,
    getBonusManager: () => ({ update() {} }),
    getObjectManager: () => ({ register() {}, deregister() {}, existsLocation: () => false }),
    getRegionManager: () => require("../dist/game/collision/RegionManager").RegionManager,
    getTaskManager: () => TaskManager,
    getWorld: () => World,
    onPlayerLogout() {},
    emitCustomEvent() {},
  };
  game = require("../plugins/minigames/castlewars/Game.CastleWars")(registry);
  // Use the real game area and team state while holding the match in its active phase.
  game.getPhase = () => game.PHASE.ACTIVE;
  const registered = [];
  require("../plugins/minigames/castlewars/Areas.CastleWars")({
    core,
    registerArea: (area) => registered.push(area),
    onServerStartup() {}, onPlayerLogin() {}, onCanEquip() {}, onCanUnequip() {},
    onCustomEvent() {}, onShouldDropItemsOnDeath() {}, onPlayerDeath() {},
  }, game);
  AreaManager.areas.push(...registered);
  pendingAreaRemovals.push(...registered);
});

after(() => {
  for (const area of pendingAreaRemovals) {
    const index = AreaManager.areas.indexOf(area);
    if (index >= 0) AreaManager.areas.splice(index, 1);
  }
});

function player(t, { location = new Location(2400, 3104, 0), team = game.data.TEAM.SARADOMIN, bot = false } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), location);
  p.setIndex(nextIndex++);
  p.setUsername(`icebarrage${nextIndex}`);
  p.setRegistered(true);
  p.setNeedsPlacement(false);
  p.setHitpoints(20);
  p.setPlayerBot(bot);
  game.setTeamId(p, team);
  AreaManager.process(p);
  t.after(() => {
    p.getCombat().getHitQueue().clear();
    p.setRegistered(false);
    game.setTeamId(p, null);
    const area = p.getArea();
    if (Array.isArray(area?.players)) {
      const index = area.players.indexOf(p);
      if (index >= 0) area.players.splice(index, 1);
    }
    p.setArea(null);
  });
  return p;
}

function opposingPair(t, options = {}) {
  const caster = player(t, { ...options, team: game.data.TEAM.SARADOMIN });
  const target = player(t, { ...options, team: game.data.TEAM.ZAMORAK });
  assert.equal(caster.getArea(), game.gameArea);
  assert.equal(target.getArea(), game.gameArea);
  assert.equal(CombatFactory.canAttackPermission(caster, target), CanAttackResponse.CAN_ATTACK);
  return { caster, target };
}

function buildCastHits(caster, target, { spellName = "ICE_BARRAGE", accurate = true, zeroDamage = false, localPlayers = [] } = {}) {
  const spell = core.CombatSpells[spellName].getSpell();
  caster.getCombat().setCastSpell(spell);
  caster.getLocalPlayers = () => new Map(localPlayers.map((p) => [p.getIndex(), p]));
  const oldAccuracy = AccuracyFormulasDpsCalc.rollAccuracy;
  const oldBounds = DamageFormulas.sourceHitBounds;
  AccuracyFormulasDpsCalc.rollAccuracy = () => accurate;
  if (zeroDamage) DamageFormulas.sourceHitBounds = () => ({ minimum: 0, maximum: 0 });
  try {
    return method.hits(caster, target);
  } finally {
    AccuracyFormulasDpsCalc.rollAccuracy = oldAccuracy;
    DamageFormulas.sourceHitBounds = oldBounds;
  }
}

function queueHits(hits) {
  for (const hit of hits) CombatFactory.addPendingHit(hit);
}

function processImpact(hit) {
  const cycle = World.getProcessCycle() + hit.getDelay();
  hit.getTarget().getCombat().getHitQueue().process(cycle);
}

function tasks(player) {
  return Progress.doneTasks(player, diary);
}

test("a queued opposing-player Ice Barrage impact in the active game area advances Elite progress", (t) => {
  const { caster, target } = opposingPair(t);
  const [hit] = buildCastHits(caster, target);
  assert.equal(hit.getSpell().spellId(), IceBarrageDiary._test.ICE_BARRAGE_SPELL_ID);
  assert.equal(hit.getHandleAfterHitEffects(), true);
  queueHits([hit]);
  assert.equal(Progress.tierCount(caster, diary, "elite"), 0, "launching a cast does not complete the task");
  processImpact(hit);
  assert.ok(tasks(caster).has(IceBarrageDiary._test.TASK));
  assert.equal(caster.getPacketSender().getVarbit(diary.tiers.elite.countVarbit), 1);
  assert.equal(caster.getPacketSender().getVarbit(diary.startedVarbit), 1);
});

test("a successful accurate hit counts with zero damage, but a splash does not", (t) => {
  const accurate = opposingPair(t);
  const [zeroHit] = buildCastHits(accurate.caster, accurate.target, { zeroDamage: true });
  assert.equal(zeroHit.isAccurate(), true);
  assert.equal(zeroHit.getTotalDamage(), 0);
  queueHits([zeroHit]);
  processImpact(zeroHit);
  assert.ok(tasks(accurate.caster).has(IceBarrageDiary._test.TASK));

  const splash = opposingPair(t);
  const [splashHit] = buildCastHits(splash.caster, splash.target, { accurate: false });
  assert.equal(splashHit.isAccurate(), false);
  assert.equal(splashHit.getTotalDamage(), 0);
  queueHits([splashHit]);
  processImpact(splashHit);
  assert.equal(Progress.tierCount(splash.caster, diary, "elite"), 0);
});

test("the real Castle Wars area admits upper-floor players and credits their queued hit", (t) => {
  const upperFloor = new Location(2429, 3074, 3);
  const { caster, target } = opposingPair(t, { location: upperFloor });
  assert.equal(caster.getArea(), game.gameArea);
  assert.equal(target.getArea(), game.gameArea);
  const [hit] = buildCastHits(caster, target);
  queueHits([hit]);
  processImpact(hit);
  assert.ok(tasks(caster).has(IceBarrageDiary._test.TASK));
});

test("lobby, waiting rooms, private areas, bots, NPCs, self-hits, and wrong spells do not count", (t) => {
  const { caster, target } = opposingPair(t);
  const [valid] = buildCastHits(caster, target);
  const wrongSpell = core.CombatSpells.ICE_BLITZ.getSpell();
  caster.getCombat().setCastSpell(wrongSpell);
  const [wrong] = buildCastHits(caster, target, { spellName: "ICE_BLITZ" });
  queueHits([wrong]);
  processImpact(wrong);
  assert.equal(Progress.tierCount(caster, diary, "elite"), 0);

  const lobbyPlayer = player(t, { location: new Location(2440, 3089, 0), team: null });
  const waitingPlayer = player(t, { location: new Location(2381, 9489, 0), team: null });
  assert.equal(lobbyPlayer.getArea(), game.lobbyArea);
  assert.equal(waitingPlayer.getArea(), game.waitingAreas[game.data.TEAM.SARADOMIN]);
  assert.notEqual(lobbyPlayer.getArea(), game.gameArea);
  assert.notEqual(waitingPlayer.getArea(), game.gameArea);

  const botCaster = opposingPair(t, { bot: true });
  const [botCastHit] = buildCastHits(botCaster.caster, botCaster.target);
  queueHits([botCastHit]);
  processImpact(botCastHit);
  assert.equal(Progress.tierCount(botCaster.caster, diary, "elite"), 0);

  const botTarget = opposingPair(t);
  botTarget.target.setPlayerBot(true);
  const [botTargetHit] = buildCastHits(botTarget.caster, botTarget.target);
  queueHits([botTargetHit]);
  processImpact(botTargetHit);
  assert.equal(Progress.tierCount(botTarget.caster, diary, "elite"), 0);

  const privateCaster = player(t);
  class TestPrivateArea extends PrivateArea {}
  const privateArea = new TestPrivateArea([new Boundary(2398, 2402, 3102, 3106, 0)]);
  privateArea.add(privateCaster);
  const privateTarget = player(t, { team: game.data.TEAM.ZAMORAK });
  const [privateHit] = buildCastHits(privateCaster, privateTarget);
  queueHits([privateHit]);
  processImpact(privateHit);
  assert.equal(Progress.tierCount(privateCaster, diary, "elite"), 0);

  const npc = new core.NPC(core.NpcIdentifiers.MAN, new Location(2401, 3104, 0));
  npc.setRegistered(true);
  game.setTeamId(caster, game.data.TEAM.SARADOMIN);
  const npcHits = buildCastHits(caster, npc);
  assert.equal(npcHits[0].getTarget(), npc);
  queueHits(npcHits);
  processImpact(npcHits[0]);
  assert.equal(Progress.tierCount(caster, diary, "elite"), 0);

  const selfHits = buildCastHits(caster, caster);
  queueHits(selfHits);
  processImpact(selfHits[0]);
  assert.equal(Progress.tierCount(caster, diary, "elite"), 0);
  assert.equal(valid.getTarget(), target);
});

test("a secondary barrage impact does not stand in for the primary cast target", (t) => {
  const { caster, target: primary } = opposingPair(t);
  const secondary = player(t, { location: new Location(2401, 3104, 0), team: game.data.TEAM.ZAMORAK });
  const hits = buildCastHits(caster, primary, { localPlayers: [primary, secondary] });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].getHandleAfterHitEffects(), true);
  assert.equal(hits[1].getHandleAfterHitEffects(), false);
  queueHits([hits[1]]);
  processImpact(hits[1]);
  assert.equal(Progress.tierCount(caster, diary, "elite"), 0);
});

test("a canceled queued cast does not grant progress and a lethal impact does", (t) => {
  const canceled = opposingPair(t);
  const [canceledHit] = buildCastHits(canceled.caster, canceled.target);
  queueHits([canceledHit]);
  assert.equal(Progress.tierCount(canceled.caster, diary, "elite"), 0);
  canceled.target.getCombat().getHitQueue().clear();
  processImpact(canceledHit);
  assert.equal(Progress.tierCount(canceled.caster, diary, "elite"), 0);

  const lethal = opposingPair(t);
  lethal.target.setHitpoints(1);
  const [lethalHit] = buildCastHits(lethal.caster, lethal.target);
  queueHits([lethalHit]);
  assert.equal(Progress.tierCount(lethal.caster, diary, "elite"), 0);
  processImpact(lethalHit);
  assert.equal(lethal.target.getHitpoints(), 0);
  assert.ok(tasks(lethal.caster).has(IceBarrageDiary._test.TASK));
});
