// Real Player/Inventory/NPC, native npc_option/dialogue_continue and the production FishingTask.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const Training = require('../plugins/npcs/BarbarianTraining.plugin');
const Fishing = require('../plugins/skills/Fishing.plugin');
const FINAL_REPLY = 'We do not use these fish quite as you might expect. When you return we can speak more of this matter.';
let core, otto, spot;
let emptyTranscript = false;
const ownedNpcs = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  // These owners attach every hook used by this native path during registration.
  // Loading unrelated plugins without their startup would leave unrelated logout hooks uninitialized.
  require('../plugins/npcs/NpcDialogues.plugin').register(PM.createApi('NpcDialogues'));
  Fishing.register(PM.createApi('Fishing'));
  Training.register(PM.createApi('BarbarianTraining'));
  PM.createApi('RodTranscriptFaultFixture').onCustomEvent('npc-dialogue:start', (request) => {
    if (emptyTranscript && request.variant === 'starting-off-after-speaking-to-him-once') request.select([]);
  });
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2500, 3487);
  function npc(id, x, y) {
    const n = core.NPC.create(id, new core.Location(x, y, 0));
    n.setScriptedMovement(true);
    assert.equal(core.World.getNpcs().add(n), true);
    n.needsPlacement = false;
    ownedNpcs.push(n);
    return n;
  }
  otto = npc(core.NpcIdentifiers.OTTO_GODBLESSED, 2501, 3487);
  spot = npc(core.NpcIdentifiers.FISHING_SPOT_37, 2500, 3488);
  core.TaskManager.process();
});
after(() => {
  for (const n of ownedNpcs) if (n.isRegistered()) core.World.getNpcs().removes(n);
  PM.emitServerShutdown({});
});

function fixture(t) {
  const packets = [];
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  session.sendClientPacket = (packet) => { packets.push(packet); };
  const player = new Player(session);
  player.setUsername('rodlessonfixture');
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(2500, 3487, 0));
  assert.equal(core.World.getPlayers().add(player), true);
  player.needsPlacement = false;
  for (const [skill, level] of [[core.Skill.FISHING, 48], [core.Skill.STRENGTH, 15], [core.Skill.AGILITY, 15]]) {
    player.getSkillManager().setExperience(skill, SkillManager.getExperienceForLevel(level));
    player.getSkillManager().setMaxLevel(skill, level).setCurrentLevel(skill, level);
  }
  player.getInventory().add(new core.Item(core.ItemIdentifiers.BARBARIAN_ROD), false);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.FEATHER, 5), false);
  const connection = new ClientConnection(channel); connection.player = player;
  const tick = () => {
    core.TaskManager.processWalkTo(player.getIndex());
    player.getMovementQueue().process();
    core.TaskManager.process();
    connection.processTurnPackets();
  };
  const send = async (packet) => { await connection.dispatch([packet]); for (let i = 0; i < 3; i++) tick(); };
  const current = () => player.getDialogueManager().getCurrent();
  const resume = () => {
    const group = player.getPacketSender().getChatboxGroupId();
    return send({type: 'dialogue_continue', widgetId: (group << 16) | (group === 229 ? 4 : 5), childIndex: -1});
  };
  const option = (npc, action) => send({type: 'npc_option', index: npc.getIndex(),
    clickType: npc.getCurrentDefinition(player).getActions().indexOf(action) + 1});
  async function lesson() {
    await option(otto, 'Talk-to');
    for (let i = 0; i < 15 && !current()?.getOptions; i++) await resume();
    const choices = current()?.getOptions();
    assert.ok(choices?.includes(Training._test.TOPIC.rod));
    await send({type: 'dialogue_continue', widgetId: (219 << 16) | 1,
      childIndex: choices.indexOf(Training._test.TOPIC.rod) + 1});
  }
  t.after(() => {
    PM.emitPlayerDisconnect({player});
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
    if (player.isRegistered()) core.World.getPlayers().removes(player);
  });
  return {player, packets, tick, send, resume, option, current, lesson};
}

test('untaught native Use-rod cannot start or catch; actual instruction unlocks at the final reply', async (t) => {
  const f = fixture(t), p = f.player, I = core.ItemIdentifiers;
  const skills = p.getSkillManager();
  const xp = skills.getExperience(core.Skill.FISHING);
  const strengthXp = skills.getExperience(core.Skill.STRENGTH), agilityXp = skills.getExperience(core.Skill.AGILITY);
  await f.option(spot, 'Use-rod');
  assert.equal(Fishing.isFishingActive(p), false, 'untaught account cannot begin a fishing session');
  for (let i = 0; i < 8; i++) f.tick();
  assert.equal(p.getInventory().getAmount(I.FEATHER), 5);
  assert.equal(p.getInventory().getAmount(I.LEAPING_TROUT), 0);
  assert.equal(p.getSkillManager().getExperience(core.Skill.FISHING), xp);
  await f.lesson();
  assert.equal(Training._test.state(p).fishingRod, 0, 'selecting the topic does not teach the lesson');
  p.getPacketSender().sendInterfaceRemoval();
  await f.option(spot, 'Use-rod');
  assert.equal(Fishing.isFishingActive(p), false, 'closing the unfinished lesson leaves fishing locked');
  await f.lesson();
  for (let i = 0; i < 30 && f.current()?.getText?.() !== FINAL_REPLY; i++) {
    assert.equal(Training._test.state(p).fishingRod, 0, 'all preceding lines remain untaught');
    await f.resume();
  }
  assert.equal(f.current()?.getText?.(), FINAL_REPLY);
  assert.equal(Training._test.state(p).fishingRod, 1, 'capture 237/01149: unlock on final reply, before another Continue');
  assert.equal(p.getPacketSender().getVarbit(Training._test.VARBITS.fishingRod), 1);
  roundTrip(t, p, 1);
  p.getPacketSender().sendInterfaceRemoval();
  await f.option(spot, 'Use-rod');
  assert.equal(Fishing.isFishingActive(p), true);
  // Controlled prerequisite revocation challenges the catch-time guard on a genuine queued session.
  Training._test.state(p).fishingRod = 0;
  for (let i = 0; i < 3; i++) f.tick();
  assert.equal(Fishing.isFishingActive(p), false, 'a queued catch rechecks training permission');
  assert.equal(p.getInventory().getAmount(I.FEATHER), 5);
  assert.equal(p.getInventory().getAmount(I.LEAPING_TROUT), 0);
  assert.equal(skills.getExperience(core.Skill.FISHING), xp);
  Training._test.state(p).fishingRod = 1;
  const priorRandom = Math.random;
  Math.random = () => 0.02;
  try {
    await f.option(spot, 'Use-rod');
    for (let i = 0; i < 2; i++) f.tick();
  } finally { Math.random = priorRandom; }
  assert.equal(p.getInventory().getAmount(I.LEAPING_TROUT), 1);
  assert.equal(p.getInventory().getAmount(I.FEATHER), 4);
  assert.equal(p.getSkillManager().getExperience(core.Skill.FISHING) - xp, 50);
  assert.equal(skills.getExperience(core.Skill.STRENGTH) - strengthXp, 5);
  assert.equal(skills.getExperience(core.Skill.AGILITY) - agilityXp, 5);
  assert.equal(Training._test.state(p).fishingRod, 2, 'first real catch completes the fishing task');
  roundTrip(t, p, 2);
  // Movement cancels an active skill, while learned progress remains owned by Training.
  p.getMovementQueue().addFirstStep(new core.Location(2499, 3487, 0));
  f.tick();
  assert.equal(Fishing.isFishingActive(p), false);
  p.getMovementQueue().reset();
  p.setLocation(new core.Location(2500, 3487, 0)); p.needsPlacement = false;
  await f.option(otto, 'Talk-to');
  for (let i = 0; i < 15 && !f.current()?.getOptions; i++) await f.resume();
  const options = f.current().getOptions();
  await f.send({type: 'dialogue_continue', widgetId: (219 << 16) | 1,
    childIndex: options.indexOf(Training._test.TOPIC.rodDone) + 1});
  assert.equal(Training._test.state(p).fishingRod, 3);
  roundTrip(t, p, 3);
  // All original baits remain usable once taught, including offcuts.
  p.getInventory().deleteNumber(I.FEATHER, 4);
  p.getInventory().add(new core.Item(I.FISH_OFFCUTS, 2), false);
  assert.ok(Fishing.hasToolRequirements(p, Fishing.TOOLS.BARBARIAN_ROD));
});

function roundTrip(t, original, stage) {
  let codec;
  require('../plugins/persistence/JsonPlayerPersistence.plugin').register({
    getSkillManager: () => SkillManager, setPlayerPersistence: (value) => { codec = value; }, log() {},
  });
  const saved = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(original), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const restored = fixture(t).player;
  codec.hydratePlayerSave(saved).applyToPlayer(restored);
  PM.emitPlayerLogin({player: restored, username: restored.getUsername()});
  assert.equal(Training._test.state(restored).fishingRod, stage, 'actual save codec/apply retains lesson stage');
  assert.equal(restored.getPacketSender().getVarbit(Training._test.VARBITS.fishingRod), stage, 'login synchronizes retained progress');
  assert.equal(Boolean(Fishing.hasToolRequirements(restored, Fishing.TOOLS.BARBARIAN_ROD)), stage >= 1);
}

test('an empty transcript and Otto moving away before the last reply cannot teach rod fishing', async (t) => {
  const f = fixture(t), p = f.player;
  roundTrip(t, p, 0);
  emptyTranscript = true;
  try { await f.lesson(); }
  finally { emptyTranscript = false; }
  assert.equal(Training._test.state(p).fishingRod, 0);
  assert.equal(p.getDialogueManager().isActive(), false);
  await f.lesson();
  for (let i = 0; i < 30 && f.current()?.getText?.() !== 'So I can obtain new foods from these fishing spots?'; i++) await f.resume();
  assert.equal(f.current()?.getText?.(), 'So I can obtain new foods from these fishing spots?');
  const priorLocation = otto.getLocation();
  otto.setLocation(new core.Location(2510, 3490, 0));
  try { await f.resume(); }
  finally { otto.setLocation(priorLocation); }
  assert.equal(Training._test.state(p).fishingRod, 0, 'distance is checked again on final reply boundary');
  assert.equal(p.getDialogueManager().isActive(), false);
});

test('disk SQLite save, worker flush and fresh-store load retain native rod progress across logout', async (t) => {
  const fs = require('node:fs'), os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'barbarian-rod-disk-'));
  const Plugin = require('../plugins/persistence/SqlitePlayerPersistence.plugin');
  const Store = Plugin.SqlitePlayerPersistence;
  const previousPath = Store.DATABASE_PATH, previousImport = Store.IMPORT_LEGACY_JSON;
  Store.DATABASE_PATH = path.join(directory, 'players.sqlite');
  Store.IMPORT_LEGACY_JSON = false;
  let persistence;
  async function closeStore() {
    if (!persistence) return;
    await persistence.flush();
    const writer = persistence.writer;
    persistence.writer = null;
    if (writer) await writer.terminate();
    persistence.database.close();
    persistence = null;
  }
  t.after(async () => {
    try { await closeStore(); }
    finally {
      Store.DATABASE_PATH = previousPath;
      Store.IMPORT_LEGACY_JSON = previousImport;
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      assert.ok(path.basename(directory).startsWith('barbarian-rod-disk-'));
      fs.rmSync(directory, {recursive: true, force: true});
    }
  });
  Plugin.register({getSkillManager: () => SkillManager,
    setPlayerPersistence(value) { persistence = value; }, log() {}});

  async function relog(f, expected) {
    const p = f.player;
    p.getPacketSender().sendInterfaceRemoval();
    PM.emitPlayerDisconnect({player: p});
    core.World.getPlayers().removes(p); // Real onRemove/onLogout cancels the old session.
    persistence.save(p, 'rod-lesson-disk-regression');
    await persistence.flush();
    assert.equal(persistence.unwritten.size, 0, 'worker has committed every queued row');
    assert.equal(persistence.inFlight.size, 0);
    assert.ok(fs.statSync(Store.DATABASE_PATH).size > 0);
    await closeStore();
    persistence = new Store(); // No in-memory pending-save fallback from the writer instance.
    assert.equal(persistence.unwritten.size, 0);
    const loaded = persistence.load(p.getUsername());
    assert.ok(loaded, 'fresh store reads a committed save from the actual database');
    const restored = fixture(t);
    loaded.applyToPlayer(restored.player);
    restored.player.needsPlacement = false;
    PM.emitPlayerLogin({player: restored.player, username: restored.player.getUsername()});
    assert.equal(Training._test.state(restored.player).fishingRod, expected);
    assert.equal(restored.player.getPacketSender().getVarbit(Training._test.VARBITS.fishingRod), expected);
    assert.equal(Boolean(Fishing.hasToolRequirements(restored.player, Fishing.TOOLS.BARBARIAN_ROD)), expected >= 1);
    return restored;
  }

  let f = fixture(t);
  await f.lesson();
  assert.equal(Training._test.state(f.player).fishingRod, 0);
  f = await relog(f, 0); // Interrupted instruction must stay locked on disk too.
  await f.option(spot, 'Use-rod');
  assert.equal(Fishing.isFishingActive(f.player), false);
  await f.lesson();
  for (let i = 0; i < 30 && f.current()?.getText?.() !== FINAL_REPLY; i++) await f.resume();
  assert.equal(f.current()?.getText?.(), FINAL_REPLY);
  f = await relog(f, 1);
  const priorRandom = Math.random;
  Math.random = () => 0.02;
  try {
    await f.option(spot, 'Use-rod');
    for (let i = 0; i < 2; i++) f.tick();
  } finally { Math.random = priorRandom; }
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.LEAPING_TROUT), 1);
  f = await relog(f, 2);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.LEAPING_TROUT), 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.FEATHER), 4);
  await f.option(otto, 'Talk-to');
  for (let i = 0; i < 15 && !f.current()?.getOptions; i++) await f.resume();
  const options = f.current().getOptions();
  await f.send({type: 'dialogue_continue', widgetId: (219 << 16) | 1,
    childIndex: options.indexOf(Training._test.TOPIC.rodDone) + 1});
  assert.equal(Training._test.state(f.player).fishingRod, 3);
  f = await relog(f, 3);
  await f.option(spot, 'Use-rod');
  assert.equal(Fishing.isFishingActive(f.player), true, 'acknowledged training remains usable after disk reload');
});
