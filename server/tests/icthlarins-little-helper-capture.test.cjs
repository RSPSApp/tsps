// Run after `yarn build`: node --test tests/icthlarins-little-helper-capture.test.cjs
//
// Icthlarin's Little Helper against the user's revision 243 capture of a whole run (local 1002310;
// docs/quests/icthlarins-little-helper): the start and hypnosis, the arrival in Sophanem, the Sphinx's riddle
// and token, the High Priest, Klenter's Pyramid as a private copy (the door, the flashbacks and their item swap,
// the puzzle, the jars and the apparition, the pit, the sarcophagus), the embalmer, the carpenter, the
// ceremony scene and the possessed priest, Icthlarin's flashback and the completion, the journal, and live's
// chathead and animation on each line. Real plugins, a real Player with its connection, the cache and the map.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const QuestRuntime = require('../plugins/quests/QuestRuntime');

let core, quest;
const STAGE_KEY = 'quest.ictlharins_little_helper.stage';
const VARS_KEY = 'icthlarins-little-helper:varbits';
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  quest = QuestRuntime.getRegisteredQuests().find((q) => q.key === 'ictlharins_little_helper');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.init?.();
  for (const [x, y] of [[3294, 2781], [3320, 2796], [3315, 2850], [3290, 9190]]) RegionManager.loadMapFiles(x, y, true);
});
after(() => PM.emitServerShutdown({}));

const I = () => core.ItemIdentifiers;
const CAT_ITEM = 1562; // growncatobject_light
const VARBIT = { JAR: 397, KLENTER: 449, FLASHBACK: 446, POTS: [404, 405, 406, 407], MET_SPHINX: 13882, TOKEN_GIVEN: 450,
  CAT_SAFE: 13883, TOKEN_RECEIVED: 13884, PRIESTS: 408, EMBALMER: 400, SCARABS: 410 };

let nextIndex = 3300;
function fixture(t, [x, y, z] = [3315, 2849, 0]) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(nextIndex++); p.setUsername(`ilh${nextIndex}`);
  p.setRegistered(true); p.setLocation(new core.Location(x, y, z)); p.needsPlacement = false;
  core.World.getPlayers?.().add?.(p);
  const c = new ClientConnection(channel); c.player = p;
  const log = [];
  log.tick = 0;
  const tick = () => log.tick;
  const sender = p.getPacketSender();
  for (const name of ['sendMessage', 'sendVarbit', 'sendConfig', 'sendInterfaceAnimation', 'sendSoundEffect', 'sendJingle',
    'sendCameraMoveTo', 'sendCameraLookAt', 'sendCameraReset', 'mountSubInterface', 'closeSubInterface', 'sendInterface',
    'sendObjectAnimation', 'sendInterfaceRemoval']) {
    const original = sender[name]?.bind(sender);
    if (!original) continue;
    t.mock.method(sender, name, (...args) => { log.push([tick(), name, ...args]); return original(...args); });
  }
  const anim = p.performAnimation.bind(p);
  p.performAnimation = (a) => { log.push([tick(), 'player-anim', a?.getId?.()]); return anim(a); };
  const spawned = [];
  t.after(() => {
    for (const npc of spawned) core.World.getNpcs().remove(npc);
    PM.emitPlayerLogout?.({ player: p });
    p.setRegistered(false);
    core.World.getPlayers?.().remove?.(p);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  const npc = (id, [nx, ny, nz]) => {
    const n = core.NPC.create(id, new core.Location(nx, ny, nz ?? 0));
    core.World.getNpcs().add(n);
    spawned.push(n);
    const local = p.getLocalNpcs?.();
    if (Array.isArray(local)) local.push(n);
    return n;
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      log.tick++;
      core.TaskManager.process();
      core.TaskManager.processWalkTo?.(p.getIndex());
      p.getMovementQueue().process();
      core.World.getNpcs?.().forEach?.((other) => other?.getMovementQueue?.().process?.());
      core.AreaManager?.process?.(p);
    }
  };
  const send = async (packet) => { await c.dispatch([packet]); c.processTurnPackets(); };
  const current = () => p.getDialogueManager().getCurrent();
  const cont = async () => send({ type: 'dialogue_continue', widgetId: p.getPacketSender().getChatboxGroupId() << 16, childIndex: -1 });
  const choose = async (index) => {
    const groupId = p.getPacketSender().getChatboxGroupId();
    const prompt = core.MultiChatboxPrompt.getPending(p);
    await send(prompt || groupId === (core.OptionDialogue.OPTIONS_WIDGET_ID >>> 16)
      ? { type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index }
      : { type: 'widget_action', widgetId: groupId << 16, groupId, childId: 0, buttonNum: index });
  };
  /** [kind, head npc id or 'player', text, expression] as the client is shown it. */
  const read = () => {
    const entry = current();
    if (!entry) return null;
    if (entry instanceof core.NpcDialogue) return ['npc', entry.getNpcId(), entry.getText(), entry.getExpression?.() ?? entry.expression];
    if (entry instanceof core.PlayerDialogue) return ['player', 'player', entry.getText(), entry.getExpression?.() ?? entry.expression];
    if (entry instanceof core.OptionDialogue) return ['options', entry.getOptions()];
    if (entry instanceof core.ItemStatementDialogue) return ['item', entry.getItemId(), entry.getText()];
    if (entry instanceof core.StatementDialogue) return ['box', null, entry.getText()];
    return ['other'];
  };
  /** Talks through, answering menus with `choices` (1-based); returns the lines shown. */
  const talk = async (choices = [], { stop, pace = 0 } = {}) => {
    const lines = [];
    let idle = 0;
    for (let i = 0; i < 200; i++) {
      step();
      const line = read();
      if (!line) {
        if (core.MultiChatboxPrompt.getPending(p)) {
          lines.push(['options', core.MultiChatboxPrompt.getPending(p).options]);
          if (!choices.length) break;
          await choose(choices.shift());
          continue;
        }
        if (++idle > (lines.length ? 3 : 8)) break;
        continue;
      }
      idle = 0;
      if (line[0] === 'other') continue;
      if (lines.length && JSON.stringify(lines.at(-1)) === JSON.stringify(line)) continue;
      lines.push(line);
      if (stop?.(line)) break;
      if (line[0] === 'options') { if (!choices.length) break; await choose(choices.shift()); continue; }
      if (pace) step(pace);
      await cont();
    }
    return lines;
  };
  const clickNpc = (target, clickType = 1) => send({ type: 'npc_option', index: target.getIndex(), clickType });
  const clickLoc = (id, x, y, clickType = 1) => send({ type: 'object_option', id, x, y, clickType });
  const give = (id, n = 1) => p.getInventory().adds(id, n);
  const slot = (id) => p.getInventory().getItems().findIndex((item) => item?.getId() === id);
  const has = (id) => p.getInventory().getAmount(id);
  const since = (from) => log.filter((entry) => entry[0] >= from);
  const varbit = (id) => {
    const sent = log.filter((e) => e[1] === 'sendVarbit' && e[2] === id);
    return sent.length ? sent.at(-1)[3] : undefined;
  };
  return { p, c, log, tick, step, send, npc, talk, read, cont, choose, clickNpc, clickLoc, give, slot, has, since, varbit, current };
}

const stage = (f) => quest.getStage(f.p);
const setStage = (f, value) => quest.setStage(f.p, value);
const texts = (lines) => lines.filter((l) => l[0] !== 'options').map((l) => l[2]);
const saved = (f) => f.p.getAttribute(VARS_KEY) ?? {};
const at = (f) => { const l = f.p.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };

/** The pyramid copy's tile for a source tile (the scene's own translation). */
function sourceOf(f) {
  const scenes = QuestRuntime;
  const area = f.p.getArea?.();
  if (area?.toSource) { const s = area.toSource(f.p.getLocation()); return [s.getX(), s.getY(), s.getZ()]; }
  return at(f);
}

function gertrudesCatDone(f) {
  const gc = QuestRuntime.getRegisteredQuests().find((q) => q.key === 'gertrudes_cat');
  gc.setStage(f.p, gc.completionValue ?? 6);
}

// ---------------------------------------------------------------------------
// Starting out
// ---------------------------------------------------------------------------

test('"No." to the start menu: the Wanderer\'s "Fool!", and nothing starts (t452-t457)', async (t) => {
  const f = fixture(t);
  gertrudesCatDone(f);
  const wanderer = f.npc(4194, [3315, 2850, 0]);
  await f.clickNpc(wanderer);
  const lines = await f.talk([2]);
  assert.deepEqual(lines.slice(-2).map((l) => [l[1], l[2]]), [
    ['player', "Sorry, I've got other things to do."],
    [6187, 'Fool! Only I can give you the knowledge on the secret passageway!'],
  ]);
  assert.equal(stage(f), 0);
});

test('the start: live\'s heads and animations per line, the cat picked up, "Yes." starts with the jar picked (t456-t480)', async (t) => {
  const f = fixture(t);
  gertrudesCatDone(f);
  f.give(I().WATERSKIN_4_); f.give(I().TINDERBOX);
  const wanderer = f.npc(4194, [3315, 2850, 0]);
  await f.clickNpc(wanderer);
  const lines = await f.talk([1], { stop: (l) => l[2] === 'Good... Now, look into my eyes...' });
  const byText = new Map(lines.map((l) => [l[2], l]));
  // Normal eyes (4193) and red eyes (6187) by line, with live's chat animations (chatneu1 588, chatshock1 571).
  assert.deepEqual(byText.get('Hello to you too, adventurer.').slice(1, 2).concat(byText.get('Hello to you too, adventurer.')[3]), [4193, 588]);
  assert.deepEqual([byText.get('Aghhh get that cat away from me. Quickly please.')[1], byText.get('Aghhh get that cat away from me. Quickly please.')[3]], [6187, 571]);
  assert.equal(byText.get('No!')[1], 6187);
  assert.equal(stage(f), 1);
  assert.equal(saved(f)[VARBIT.JAR] >= 1 && saved(f)[VARBIT.JAR] <= 3, true, 'a jar is picked');
});

test('the hypnosis: "Don\'t blink..." continued blacks out and holds; 4 ticks on stage 3, Klenter, the jar in the waterskin\'s slot (t485-t493)', async (t) => {
  const f = fixture(t);
  gertrudesCatDone(f);
  f.give(I().TINDERBOX);
  f.give(I().WATERSKIN_4_);
  const skinSlot = f.slot(I().WATERSKIN_4_);
  setStage(f, 1);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2 });
  const wanderer = f.npc(4194, [3315, 2850, 0]);
  await f.clickNpc(wanderer);
  const lines = await f.talk([], { stop: (l) => l[2] === "Don't blink..." });
  assert.deepEqual(texts(lines), ['Good... Now, look into my eyes...', 'Look deeply into them...', "Don't blink..."]);
  const from = f.tick();
  await f.cont();
  f.step(1);
  assert.ok(f.since(from).some((e) => e[1] === 'sendSoundEffect' && e[2] === 1164), 'hypnotise');
  assert.ok(f.since(from).some((e) => e[1] === 'mountSubInterface' && e[3] === 174), 'the fade overlay');
  assert.equal(stage(f), 1);
  f.step(4);
  assert.equal(stage(f), 3);
  assert.equal(saved(f)[VARBIT.KLENTER], 1);
  assert.deepEqual(at(f), [3294, 2782, 0]);
  assert.equal(f.p.getInventory().getItems()[skinSlot]?.getId(), 4679, 'the Apmeken jar takes the waterskin\'s slot');
  assert.equal(f.has(I().TINDERBOX), 0);
  f.step(4);
  assert.deepEqual(f.read(), ['box', null, 'You slowly pick yourself off the ground. Your head is pounding, and an irrational sense of guilt nags you.']);
});
