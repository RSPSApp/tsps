// Run after `yarn build`: node --test tests/barbarian-hastae.test.cjs
// Otto's hastae service through a real Player, native packets, the real map and QuestScenes' copy:
// rsprox recording 1529's spear conversion (menus, the anvil cutscene's timing, the exchange tick),
// the Elite Kandarin Diary price, the free conversions and a logout inside the scene.
const assert = require('node:assert/strict');
const path = require('node:path');
const {test, before, after} = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
const Training = require('../plugins/npcs/BarbarianTraining.plugin');
const {TEXT} = require('../plugins/npcs/barbariantraining/Hastae.BarbarianTraining');

const TRAINING = "Let's talk about my training.";
const LEAVE = "I'd better get going.";
let core, otto, serial = 0;
const eliteKandarin = new WeakSet();
const hookErrors = [], oldError = console.error;

before(async () => {
  console.error = (...args) => { hookErrors.push(args.map(String).join(' ')); oldError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  require('../plugins/npcs/NpcDialogues.plugin').register(PM.createApi('NpcDialogues'));
  Training.register(PM.createApi('BarbarianTraining'));
  PM.createApi('DiaryFixture').onCustomEvent('diary:is-complete', request => {
    if (request.diary === 'kandarin' && request.tier === 'elite' && eliteKandarin.has(request.player)) request.complete = true;
  });
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2502, 3485);
  otto = core.NPC.create(core.NpcIdentifiers.OTTO_GODBLESSED, new core.Location(2501, 3487, 0));
  otto.setScriptedMovement(true);
  assert.equal(core.World.getNpcs().add(otto), true);
  otto.needsPlacement = false;
  assert.equal(core.NpcIdentifiers.OTTO_GODBLESSED_2, 2915, 'brut_otto_hammer (rec 1529)');
  PM.emitServerStartup({});
  core.TaskManager.process();
});

after(() => {
  try {
    if (otto?.isRegistered()) core.World.getNpcs().removes(otto);
    PM.emitServerShutdown({});
    assert.deepEqual(hookErrors, [], 'owners must not throw');
  } finally { console.error = oldError; }
});

function fixture(t, {trained = true, items = [], coins = 0} = {}) {
  const channel = {kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {}};
  const session = new PlayerSession(channel);
  const packets = [];
  session.sendClientPacket = packet => { packets.push(packet); };
  const p = new Player(session);
  p.setUsername(`hastae${++serial}`);
  p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(2502, 3487, 0));
  assert.equal(core.World.getPlayers().add(p), true);
  p.needsPlacement = false;
  if (trained) p.setAttribute('barbarian-training', {fishingRod: 3, harpoon: 3, spear: 3, hasta: 3});
  for (const id of items) p.getInventory().adds(id, 1);
  if (coins) p.getInventory().adds(core.ItemIdentifiers.COINS, coins);
  const connection = new ClientConnection(channel); connection.player = p;
  const tick = () => {
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
    connection.processTurnPackets();
    const q = p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit(); if (q.hasPendingWork()) q.process();
    core.TaskManager.processWalkTo(p.getIndex());
  };
  const send = async (packet, turns = 1) => { await connection.dispatch([packet]); for (let i = 0; i < turns; i++) tick(); };
  const current = () => p.getDialogueManager().getCurrent();
  const resume = () => {
    const group = p.getPacketSender().getChatboxGroupId();
    return send({type: 'dialogue_continue', widgetId: (group << 16) | (group === 229 ? 4 : group === 193 ? 3 : 5), childIndex: -1});
  };
  const choose = async text => {
    const choices = current()?.getOptions?.();
    assert.ok(choices?.includes(text), `"${text}" in ${JSON.stringify(choices)}`);
    await send({type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: choices.indexOf(text) + 1});
  };
  /** Continues until a menu opens or `text` is up; the lines on the way. */
  const readTo = async (text = null) => {
    const said = [];
    for (let i = 0; i < 15; i++) {
      const entry = current();
      if (!entry || entry.getOptions) break;
      said.push(entry.getText?.());
      if (text && entry.getText?.() === text) break;
      await resume();
    }
    return said;
  };
  const talk = async () => {
    await send({type: 'npc_option', index: otto.getIndex(), clickType: 1}, 3);
    await readTo();
    assert.ok(current()?.getOptions, 'Talk-to opened a menu');
    return current().getOptions();
  };
  t.after(() => {
    p.getPacketSender().sendInterfaceRemoval();
    if (p.isRegistered()) PM.emitPlayerDisconnect({player: p});
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    if (p.isRegistered()) core.World.getPlayers().removes(p);
  });
  return {p, packets, tick, send, current, resume, choose, readTo, talk};
}

const count = (p, id) => p.getInventory().getAmount(id);
const xyz = l => [l.getX(), l.getY(), l.getZ()];
const at = p => xyz(p.getLocation());

async function toSpearPrompt(f) {
  assert.deepEqual(await f.talk(), [TRAINING, TEXT.top, LEAVE]);
  await f.choose(TEXT.top);
  assert.deepEqual(await f.readTo(), [TEXT.top, TEXT.topReply]);
  assert.deepEqual(f.current().getOptions(), [TEXT.spear, TEXT.forget], 'only what the player carries (rec 1529)');
  await f.choose(TEXT.spear);
}

test('rec 1529: the spear becomes a hasta for 300,000 coins after the anvil scene, all on the exchange tick', async t => {
  const I = core.ItemIdentifiers;
  const f = fixture(t, {items: [I.ZAMORAKIAN_SPEAR], coins: 400000}), p = f.p;
  await toSpearPrompt(f);
  const said = await f.readTo();
  assert.deepEqual(said, [TEXT.spear, TEXT.spearPrice(300000)]);
  assert.equal(TEXT.spearPrice(300000), 'Yes, I can convert a Zamorakian spear into a hasta. The spirits require me to request 300,000 coins from you for this service.');
  assert.deepEqual(f.current().getOptions(), [TEXT.yes, TEXT.no]);
  assert.equal(f.current().getTitle?.() ?? TEXT.spearPrompt, TEXT.spearPrompt);
  const spearSlot = p.getInventory().getSlotForItemId(I.ZAMORAKIAN_SPEAR);
  await f.send({type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: 1}, 1); // the choice's own tick
  // Ticks after the choice: the copy opens at 2, the strikes at 6 and 10, the real map at 14, the hasta at 15.
  const states = [];
  for (let tick = 1; tick <= 15; tick++) {
    f.tick();
    states.push({tick, at: at(p), spear: count(p, I.ZAMORAKIAN_SPEAR), hasta: count(p, I.ZAMORAKIAN_HASTA), coins: count(p, I.COINS)});
  }
  assert.deepEqual(states[0].at, [2502, 3487, 0], 'still on the real map during the fade');
  assert.ok(states[1].at[0] > 6400, `in the grotto copy at tick 2: ${states[1].at}`);
  for (const s of states.slice(0, 14)) {
    assert.equal(s.spear, 1, `spear kept at tick ${s.tick}`);
    assert.equal(s.coins, 400000, `coins kept at tick ${s.tick}`);
  }
  assert.deepEqual(states[13].at, [2503, 3487, 0], 'back on the real map at tick 14');
  assert.deepEqual([states[14].spear, states[14].hasta, states[14].coins], [0, 1, 100000]);
  assert.equal(p.getInventory().getItems()[spearSlot].getId(), I.ZAMORAKIAN_HASTA, 'the hasta takes the spear slot');
  assert.equal(f.current()?.getText?.(), TEXT.spearDone);
  assert.equal(f.current()?.getItemId?.(), I.ZAMORAKIAN_HASTA, 'objectbox shows the hasta');
  assert.equal(p.getPacketSender().getVarbit(542), 0, 'cutscene_status cleared');
});

test('the anvil scene plays the hammer form, its two strikes and the captured camera inside the copy', async t => {
  const I = core.ItemIdentifiers;
  const f = fixture(t, {items: [I.ZAMORAKIAN_HASTA]}), p = f.p;
  const scenes = Training._test.hastae()._test.Scenes;
  assert.deepEqual(await f.talk(), [TRAINING, TEXT.top, LEAVE]);
  await f.choose(TEXT.top); await f.readTo();
  assert.deepEqual(f.current().getOptions(), [TEXT.hasta, TEXT.forget]);
  await f.choose(TEXT.hasta);
  assert.deepEqual(await f.readTo(), [TEXT.hasta, TEXT.hastaReply]);
  await f.send({type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: 1}, 1); // the choice's own tick
  f.tick(); f.tick();
  const scene = scenes.get(p);
  assert.ok(scene, 'scene open at tick 2');
  assert.equal(scene.otto.getId(), core.NpcIdentifiers.OTTO_GODBLESSED_2);
  assert.deepEqual(xyz(scenes.toSource(scene.otto)), [2501, 3485, 0]);
  assert.deepEqual(xyz(scenes.toSource(p)), [2503, 3486, 0]);
  assert.equal(p.getPacketSender().getVarbit(542), 1, 'cutscene_status on');
  const anims = [];
  const perform = scene.otto.performAnimation.bind(scene.otto);
  scene.otto.performAnimation = anim => { anims.push([anim.getId?.() ?? anim.id, f.tickNo]); return perform(anim); };
  for (let tick = 3; tick <= 15; tick++) { f.tickNo = tick; f.tick(); }
  assert.deepEqual(anims, [[898, 6], [898, 10]]);
  assert.equal(count(p, I.ZAMORAKIAN_SPEAR), 1);
  assert.equal(count(p, I.ZAMORAKIAN_HASTA), 0);
  assert.equal(f.current()?.getText?.(), TEXT.hastaDone);
});

test('Elite Kandarin Diary: Otto asks 150,000 and takes 150,000', async t => {
  const I = core.ItemIdentifiers;
  const f = fixture(t, {items: [I.ZAMORAKIAN_SPEAR], coins: 150000}), p = f.p;
  eliteKandarin.add(p);
  await toSpearPrompt(f);
  assert.deepEqual(await f.readTo(), [TEXT.spear, TEXT.spearPrice(150000)]);
  await f.choose(TEXT.yes);
  for (let i = 0; i < 16; i++) f.tick();
  assert.deepEqual([count(p, I.ZAMORAKIAN_SPEAR), count(p, I.ZAMORAKIAN_HASTA), count(p, I.COINS)], [0, 1, 0]);
});

test('too few coins: the player declines and nothing changes', async t => {
  const I = core.ItemIdentifiers;
  const f = fixture(t, {items: [I.ZAMORAKIAN_SPEAR], coins: 299999}), p = f.p;
  await toSpearPrompt(f);
  const said = await f.readTo();
  assert.deepEqual(said, [TEXT.spear, TEXT.spearPrice(300000), TEXT.cantAfford]);
  await f.resume();
  for (let i = 0; i < 16; i++) f.tick();
  assert.ok(!f.current(), 'chat closed');
  assert.ok(!Training._test.hastae()._test.Scenes.get(p), 'no scene');
  assert.deepEqual([count(p, I.ZAMORAKIAN_SPEAR), count(p, I.COINS)], [1, 299999]);
});

test('No. keeps the spear; untrained players get no spear conversion, but anyone may turn a hasta back', async t => {
  const I = core.ItemIdentifiers;
  const f = fixture(t, {items: [I.ZAMORAKIAN_SPEAR], coins: 300000}), p = f.p;
  await toSpearPrompt(f); await f.readTo();
  await f.choose(TEXT.no);
  assert.deepEqual(await f.readTo(), [TEXT.forgetIt, TEXT.asYouWish]);
  for (let i = 0; i < 16; i++) f.tick();
  assert.deepEqual([count(p, I.ZAMORAKIAN_SPEAR), count(p, I.COINS)], [1, 300000]);

  const untrained = fixture(t, {trained: false, items: [I.ZAMORAKIAN_SPEAR], coins: 300000});
  const options = await untrained.talk();
  assert.ok(!options.includes(TEXT.top), `no hastae menu for an untrained spear: ${options}`);
  assert.ok(!options.includes(TRAINING), 'untrained players keep the topics menu');
  untrained.p.getPacketSender().sendInterfaceRemoval();
  untrained.p.getInventory().adds(I.ZAMORAKIAN_HASTA, 1);
  assert.deepEqual(await untrained.talk(), [TRAINING, TEXT.top, LEAVE]);
  await untrained.choose(TEXT.top); await untrained.readTo();
  assert.deepEqual(untrained.current().getOptions(), [TEXT.hasta, TEXT.forget]);
});

test('broken dragon hasta: untrained players hear the warning, then Otto repairs it for free', async t => {
  const I = core.ItemIdentifiers;
  const f = fixture(t, {trained: false, items: [I.BROKEN_DRAGON_HASTA]}), p = f.p;
  assert.deepEqual(await f.talk(), [TRAINING, TEXT.top, LEAVE]);
  await f.choose(TEXT.top); await f.readTo();
  assert.deepEqual(f.current().getOptions(), [TEXT.broken, TEXT.forget]);
  await f.choose(TEXT.broken);
  assert.deepEqual(await f.readTo(), [TEXT.broken, TEXT.brokenUntrained, TEXT.brokenWarning]);
  assert.deepEqual(f.current().getOptions(), [TEXT.yes, TEXT.no]);
  await f.choose(TEXT.yes);
  for (let i = 0; i < 16; i++) f.tick();
  assert.deepEqual([count(p, I.BROKEN_DRAGON_HASTA), count(p, I.DRAGON_HASTA)], [0, 1]);
  assert.equal(f.current()?.getText?.(), TEXT.brokenDone);

  const trained = fixture(t, {items: [I.BROKEN_DRAGON_HASTA]});
  await trained.talk(); await trained.choose(TEXT.top); await trained.readTo();
  await trained.choose(TEXT.broken);
  assert.deepEqual(await trained.readTo(), [TEXT.broken, TEXT.brokenTrained]);
});

test('a logout inside the scene keeps the spear and coins and saves the player outside the copy', async t => {
  const I = core.ItemIdentifiers;
  const f = fixture(t, {items: [I.ZAMORAKIAN_SPEAR], coins: 300000}), p = f.p;
  await toSpearPrompt(f); await f.readTo();
  await f.choose(TEXT.yes);
  for (let i = 0; i < 5; i++) f.tick();
  assert.ok(p.getLocation().getX() > 6400, 'in the copy');
  p.onLogout(); // the real logout: the scene's area leaves with logout = true
  for (let i = 0; i < 16; i++) f.tick();
  assert.deepEqual(at(p), [2503, 3487, 0], 'saved at the exit');
  assert.deepEqual([count(p, I.ZAMORAKIAN_SPEAR), count(p, I.ZAMORAKIAN_HASTA), count(p, I.COINS)], [1, 0, 300000]);
});
