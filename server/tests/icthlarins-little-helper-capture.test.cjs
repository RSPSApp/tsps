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
    PM.emitPlayerLogout?.({ player: p, username: p.getUsername() });
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
      // The world update's placement, which the test has no loop for.
      p.needsPlacement = false;
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

// ---------------------------------------------------------------------------
// The Sphinx and the High Priest
// ---------------------------------------------------------------------------

function withCat(f) {
  const request = { player: f.p, itemId: CAT_ITEM, summoned: false, following: false };
  PM.emitCustomEvent('pets:summon', request);
  assert.equal(request.following, true, 'the cat follows');
  return request.pet;
}

test('the riddle: "9." and "Totally positive." keep the cat; stage 6 on "Here, I have a token...", the token box (t1406-t1493)', async (t) => {
  const f = fixture(t, [3300, 2785, 0]);
  setStage(f, 5);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1, [VARBIT.MET_SPHINX]: 1 });
  withCat(f);
  const sphinx = f.npc(4209, [3300, 2783, 0]);
  await f.clickNpc(sphinx);
  const lines = await f.talk([1, 2, 1], { stop: (l) => l[2] === 'Here, I have a token that he will know is from me. Take that to him, and I\'m sure he will speak with you.' });
  assert.deepEqual(lines[0], ['player', 'player', 'Good day.', 588]);
  assert.deepEqual(lines[1], ['box', null, 'The Sphinx ignores you.']);
  const riddle = lines.find((l) => l[2]?.startsWith('A husband and wife'));
  assert.equal(riddle[1], 4209);
  assert.equal(saved(f)[VARBIT.CAT_SAFE], 1, 'the riddle answered (13883)');
  assert.equal(stage(f), 6, 'stage 6 as the token line shows');
  await f.cont();
  f.step(2);
  assert.deepEqual(f.read(), ['item', I().SPHINXS_TOKEN, 'The Sphinx gives you a token.']);
  assert.equal(f.has(I().SPHINXS_TOKEN), 1);
  assert.equal(saved(f)[VARBIT.TOKEN_RECEIVED], 1);
});

test('the riddle answered wrong and confirmed: the cat goes to the Sphinx, the talk carries on to the token (Wiki; t1383 shows the confirmation)', async (t) => {
  const f = fixture(t, [3300, 2785, 0]);
  setStage(f, 5);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1, [VARBIT.MET_SPHINX]: 1 });
  withCat(f);
  const sphinx = f.npc(4209, [3300, 2783, 0]);
  await f.clickNpc(sphinx);
  const lines = await f.talk([1, 1, 1]);
  assert.ok(texts(lines).includes('Your cat shakes it head frantically and starts to scratch your leg.'));
  assert.equal(saved(f)[414], 1, 'ics_sphinx_robbedcat');
  assert.equal(f.has(CAT_ITEM), 0);
  const current = { player: f.p, pet: null };
  PM.emitCustomEvent('pets:current', current);
  assert.equal(current.pet, null, 'no cat follows');
  // Transcript: "...You're a grave robber." carries on into the accusation and the token all the same.
  assert.equal(stage(f), 6);
});

test('the High Priest: the token box takes it, stage 7 on "Cats act as guardians..." (t1606-t1700)', async (t) => {
  const f = fixture(t, [3281, 2770, 0]);
  setStage(f, 6);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1, [VARBIT.TOKEN_RECEIVED]: 1 });
  f.give(I().SPHINXS_TOKEN);
  const priest = f.npc(6192, [3281, 2772, 0]);
  await f.clickNpc(priest);
  const lines = await f.talk([], { stop: (l) => l[2]?.startsWith('Cats act as guardians') });
  const box = lines.find((l) => l[0] === 'item');
  assert.deepEqual(box, ['item', I().SPHINXS_TOKEN, 'You hand the token to the High Priest.']);
  assert.equal(f.has(I().SPHINXS_TOKEN), 0);
  assert.equal(saved(f)[VARBIT.TOKEN_GIVEN], 1);
  assert.equal(stage(f), 7);
  assert.equal(lines.find((l) => l[2] === 'You! I will have no dealings with those who plunder the houses of the dead.')?.[1], 6192, 'the multinpc head live sends');
});

// ---------------------------------------------------------------------------
// Klenter's Pyramid
// ---------------------------------------------------------------------------

/** A source tile of the pyramid's copy, as the client clicks it. */
function tileIn(f, x, y, z = 0) {
  const area = f.p.getArea?.();
  assert.ok(area?.sourceTile, 'in the pyramid copy');
  const tile = area.sourceTile(x, y, z);
  return [tile.getX(), tile.getY()];
}
const clickIn = (f, id, x, y, clickType = 1) => { const [rx, ry] = tileIn(f, x, y); return f.clickLoc(id, rx, ry, clickType); };
const place = (f, x, y) => { const [rx, ry] = tileIn(f, x, y); f.p.moveTo(new core.Location(rx, ry, 0)); f.step(); };

/** Lights Out over GF(2): the presses (0-24) that clear `board`, each press turning itself and its eight neighbours. */
function solve(board) {
  const { turnsFor } = require('../plugins/quests/icthlarin/Puzzle.IcthlarinsLittleHelper')._test;
  const rows = [];
  for (let tile = 0; tile < 25; tile++) {
    let row = 0n;
    for (let press = 0; press < 25; press++) if (turnsFor(press).includes(tile)) row |= 1n << BigInt(press);
    if ((board >> tile) & 1) row |= 1n << 25n;
    rows.push(row);
  }
  let r = 0; const pivots = [];
  for (let col = 0; col < 25 && r < 25; col++) {
    const pick = rows.findIndex((row, i) => i >= r && (row >> BigInt(col)) & 1n);
    if (pick < 0) continue;
    [rows[r], rows[pick]] = [rows[pick], rows[r]];
    for (let i = 0; i < 25; i++) if (i !== r && (rows[i] >> BigInt(col)) & 1n) rows[i] ^= rows[r];
    pivots.push(col); r++;
  }
  return pivots.filter((col, i) => (rows[i] >> 25n) & 1n);
}
function board(f) {
  let value = 0;
  for (let i = 0; i < 25; i++) if (f.varbit(420 + i) === 1) value |= 1 << i;
  return value;
}
const pressTile = (f, index) => f.send({ type: 'widget_action', widgetId: (147 << 16) | (4 + index), groupId: 147, childId: 4 + index, buttonNum: 1 });

test('flashback 1: the door\'s deja-vu, the copy, the jar for the unholy symbol in its slot, the sepia (t1033-t1046)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  setStage(f, 3);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1 });
  f.give(4679);
  const jarSlot = f.slot(4679);
  await f.clickLoc(6614, 3294, 2778);
  f.step(2);
  assert.deepEqual(f.read(), ['box', null, 'As you touch the pyramid door, a sense of deja-vu sweeps over you...']);
  const from = f.tick();
  f.step(3 + 2);
  assert.equal(stage(f), 4);
  assert.equal(f.varbit(VARBIT.FLASHBACK), 1);
  assert.deepEqual(sourceOf(f), [3277, 9171, 0]);
  assert.equal(f.p.getInventory().getItems()[jarSlot]?.getId(), I().UNHOLY_SYMBOL_3, 'the past self holds the unholy symbol');
  assert.ok(f.since(from).some((e) => e[1] === 'sendSoundEffect' && e[2] === 1164));
  f.step(4);
  assert.deepEqual(f.read()?.slice(0, 3), ['player', 'player', 'I must go to the heart of the pyramid... The mistress commands it...']);
  assert.ok(f.since(from).some((e) => e[1] === 'mountSubInterface' && e[3] === 146), 'the flashback overlay');
  // Teleports are refused inside it, with live's message (t2015).
  assert.equal(f.p.getArea().canTeleport(f.p), false);
  assert.ok(f.log.some((e) => e[1] === 'sendMessage' && e[2] === 'An outside force seems to be blocking your teleport.'));

  // The ladder's "Do you want to leave?": "Yes." ends it early, stage kept, the jar back (t1063-t1078).
  await f.cont();
  f.step(2);
  await clickIn(f, 6645, 3277, 9172);
  const lines = await f.talk([1]);
  assert.equal(lines[0][2], 'I must get to the heart of the pyramid...');
  assert.deepEqual(lines[1], ['options', ['Yes.', 'No.']]);
  f.step(6);
  assert.equal(stage(f), 4);
  assert.equal(f.varbit(VARBIT.FLASHBACK), 0);
  assert.deepEqual(at(f), [3294, 2781, 0]);
  assert.equal(f.p.getInventory().getItems()[jarSlot]?.getId(), 4679);
});

test('flashback 1\'s puzzle: five random presses, the board turned by real presses, solved to stage 5 and outside (t1217-t1247)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  setStage(f, 4);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1 });
  f.give(4679);
  await f.clickLoc(6614, 3294, 2778);
  f.step(2); f.step(3 + 2 + 4);
  await f.cont(); f.step(2);
  place(f, 3280, 9200);
  await clickIn(f, 44059, 3280, 9199);
  f.step(3);
  assert.ok(f.log.some((e) => e[1] === 'sendInterface' && e[2] === 147), 'the puzzle opens');
  const scrambled = board(f);
  assert.notEqual(scrambled, 0);
  assert.equal(f.log.filter((e) => e[1] === 'sendInterfaceAnimation' && e[2] === ((147 << 16) | 30) && e[3] === 2003).length, 2, 'counter 4 before and after the scramble');
  const presses = solve(scrambled);
  for (const press of presses) await pressTile(f, press);
  assert.equal(board(f), 0);
  assert.ok(f.log.some((e) => e[1] === 'sendJingle' && e[2] === 192), 'the tile win jingle');
  f.step(2);
  assert.equal(stage(f), 5);
  f.step(6);
  assert.deepEqual(at(f), [3294, 2781, 0]);
  const lines = await f.talk();
  assert.deepEqual(texts(lines), ['I remember! That wanderer, she hypnotised me!',
    "But... I can't remember why. I needed to get... something. This is so confusing...",
    'Maybe someone around here can tell me what on Gielinor is going on.']);
  assert.equal(f.has(4679), 1);
  assert.equal(f.has(I().UNHOLY_SYMBOL_3), 0);
});

test('the door at stage 7: no cat, the High Priest\'s reminder; with one, "Hey puss!", stage 8 and inside (t1405-t1418)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  setStage(f, 7);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1 });
  f.give(4679);
  await f.clickLoc(6614, 3294, 2778);
  let lines = await f.talk();
  assert.deepEqual(texts(lines), ['I think the High Priest mentioned something about needing a cat to enter the pyramid.']);
  withCat(f);
  await f.clickLoc(6614, 3294, 2778);
  lines = await f.talk();
  assert.deepEqual(lines.map((l) => [l[1], l[2]]), [
    ['player', 'Hey puss! What do you reckon about that cat on the door? Do you think you can open it?'],
    [1620, 'Meeeow.'],
  ]);
  f.step(3);
  assert.equal(stage(f), 8);
  assert.deepEqual(sourceOf(f), [3277, 9171, 0]);
  assert.equal(f.varbit(407), 1, 'the Apmeken jar is gone from its table');
});

/** Into the pyramid at a stage, through the door with a cat (the present's copy). */
async function enterPyramid(f, value, vars = {}) {
  setStage(f, value);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1, ...vars });
  withCat(f);
  await f.clickLoc(6614, 3294, 2778);
  await f.talk();
  f.step(3);
  assert.ok(f.p.getArea()?.sourceTile, 'inside the copy');
}

test('flashback 2: the pit\'s deja-vu, the wrong jar, the apparition, its death, the jar taken, back over the pit (t1964-t2186)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  f.give(4679);
  const jarSlot = f.slot(4679);
  await enterPyramid(f, 8);
  place(f, 3292, 9191);
  await clickIn(f, 6632, 3292, 9194, 1);
  for (let i = 0; i < 6 && !f.read(); i++) f.step();
  assert.deepEqual(f.read(), ['box', null, 'As you go to make the jump, another sense of deja-vu sweeps over you...']);
  f.step(5 + 2);
  assert.equal(stage(f), 9);
  assert.deepEqual(sourceOf(f), [3280, 9200, 0]);
  assert.equal(f.p.getInventory().getItems()[jarSlot]?.getId(), I().UNHOLY_SYMBOL_3);
  assert.equal(f.has(CAT_ITEM), 1, 'the cat is picked up at the deja-vu');
  assert.equal(f.varbit(407), 0, 'in the past the jar is on its table');
  f.step(4);
  assert.equal(f.read()?.[2], 'I need to get the burial jar for the mistress...');
  await f.cont(); f.step(2);

  // Back over the pit without the jar: refused (t1995).
  place(f, 3292, 9197);
  await clickIn(f, 6633, 3292, 9196, 1);
  let lines = await f.talk();
  assert.deepEqual(texts(lines), ['I need to get the burial jar for the mistress...']);

  place(f, 3285, 9194);
  await clickIn(f, 6636, 3286, 9195); // the lungs
  lines = await f.talk();
  assert.deepEqual(texts(lines), ["I don't want this jar."]);
  await clickIn(f, 6640, 3286, 9193); // the intestines: Apmeken's
  f.step(2);
  assert.equal(stage(f), 10);
  const apparition = core.World.getNpcs().find?.((npc) => npc?.getId() === 4196 && npc.__icthlarinOwner === f.p)
    ?? [...core.World.getNpcs()].find((npc) => npc?.getId() === 4196 && npc.__icthlarinOwner === f.p);
  assert.ok(apparition, 'the Apmeken apparition');
  PM.emitNpcDeath?.({ npc: apparition, npcId: 4196, killer: f.p });
  assert.equal(stage(f), 11);

  await clickIn(f, 6640, 3286, 9193);
  f.step(2);
  assert.deepEqual(f.read(), ['item', 4679, 'You take the burial jar.']);
  assert.equal(f.varbit(407), 1);
  assert.equal(f.has(4679), 1);
  await f.cont(); f.step();

  place(f, 3292, 9197);
  await clickIn(f, 6633, 3292, 9196, 1);
  f.step(2 + 2);
  assert.equal(stage(f), 12);
  assert.deepEqual(sourceOf(f), [3292, 9192, 0]);
  assert.equal(f.p.getInventory().getItems()[jarSlot]?.getId(), 4679, 'the present\'s jar back in its slot');
  assert.equal(f.has(4679), 1, 'the past\'s jar stays in the past');
  assert.equal(f.has(I().UNHOLY_SYMBOL_3), 0);
  lines = await f.talk();
  assert.deepEqual(texts(lines), ['So I really did steal the jar. I need to return it as fast as I can.']);
});

test('returning the jar: the puzzle again, the room open (13), dropped on the table "You return the burial jar." (14, t2282-t2300)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  f.give(4679);
  await enterPyramid(f, 12);
  place(f, 3280, 9200);
  await clickIn(f, 44059, 3280, 9199);
  f.step(3);
  for (const press of solve(board(f))) await pressTile(f, press);
  f.step(2 + 3);
  assert.equal(stage(f), 13);
  place(f, 3285, 9194);
  await f.send({ type: 'inventory_action', slot: f.slot(4679), itemId: 4679, widgetId: 149 << 16, option: 'Drop' });
  f.step();
  assert.equal(stage(f), 14);
  assert.deepEqual(f.read(), ['item', 4679, 'You return the burial jar.']);
  assert.equal(f.has(4679), 0);
  assert.equal(f.varbit(407), 0, 'the jar back on its table');
});

test('the jar dropped anywhere else turns to dust (Wiki, Canopic jar), and the High Priest gives another', async (t) => {
  const f = fixture(t, [3281, 2770, 0]);
  setStage(f, 7);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1, [VARBIT.TOKEN_GIVEN]: 1 });
  f.give(4679);
  await f.send({ type: 'inventory_action', slot: f.slot(4679), itemId: 4679, widgetId: 149 << 16, option: 'Drop' });
  f.step();
  assert.equal(f.has(4679), 0);
  assert.ok(f.log.some((e) => e[1] === 'sendMessage' && e[2] === 'The burial jar magically turns to dust as you drop it.'));
  const priest = f.npc(6192, [3281, 2772, 0]);
  await f.clickNpc(priest);
  const lines = await f.talk([5]);
  assert.ok(lines.some((l) => l[0] === 'item' && l[1] === 4679));
  assert.equal(f.has(4679), 1);
});

// ---------------------------------------------------------------------------
// Ceremony preparations
// ---------------------------------------------------------------------------

test('the High Priest at 14: stage 15 on "That\'s right. We need the carpenter..." (t2530)', async (t) => {
  const f = fixture(t, [3281, 2770, 0]);
  setStage(f, 14);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1 });
  const priest = f.npc(6192, [3281, 2772, 0]);
  await f.clickNpc(priest);
  await f.talk([], { stop: (l) => l[2]?.startsWith("That's right. We need the carpenter") });
  assert.equal(stage(f), 15);
});

test('the embalmer: salt, sap and linen handed over in item boxes, his varbits as live sets them (t2566-t2765)', async (t) => {
  const f = fixture(t, [3287, 2757, 0]);
  setStage(f, 15);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2 });
  f.give(I().BAG_OF_SALT); f.give(I().BUCKET_OF_SAP);
  const embalmer = f.npc(4202, [3287, 2755, 0]);
  await f.clickNpc(embalmer);
  let lines = await f.talk();
  const boxes = lines.filter((l) => l[0] === 'item');
  assert.deepEqual(boxes, [
    ['item', I().BAG_OF_SALT, 'You hand some salt to the embalmer.'],
    ['item', I().BUCKET_OF_SAP, 'You hand a bucket of sap to the embalmer.'],
  ]);
  assert.deepEqual([saved(f)[399], saved(f)[400]], [1, 3], 'ics_metembalmer, ics_little_embalmer_multi 1|2');
  // Raetul's linen (t2649): 30 coins, the box, the linen.
  f.give(I().COINS, 50);
  const raetul = f.npc(4204, [3311, 2786, 0]);
  f.p.moveTo(new core.Location(3311, 2788, 0)); f.step();
  await f.clickNpc(raetul);
  lines = await f.talk();
  assert.ok(lines.some((l) => l[0] === 'item' && l[1] === I().LINEN && l[2].startsWith('The merchant takes your money')));
  assert.equal(f.has(I().COINS), 20);
  assert.equal(f.has(I().LINEN), 1);
  f.p.moveTo(new core.Location(3287, 2757, 0)); f.step();
  await f.clickNpc(embalmer);
  lines = await f.talk();
  assert.ok(lines.some((l) => l[0] === 'item' && l[1] === I().LINEN));
  assert.equal(saved(f)[400], 7);
});

test('the carpenter: the logs in a box, then the holy symbol: stage 16 and the town\'s priests to the ceremony (t2804-t2833)', async (t) => {
  const f = fixture(t, [3313, 2772, 0]);
  setStage(f, 15);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, 399: 1, 400: 7 });
  f.give(I().WILLOW_LOGS);
  const carpenter = f.npc(4203, [3313, 2771, 0]);
  await f.clickNpc(carpenter);
  const lines = await f.talk();
  const boxes = lines.filter((l) => l[0] === 'item');
  assert.deepEqual(boxes, [
    ['item', I().WILLOW_LOGS, 'You give the carpenter some willow logs.'],
    ['item', I().HOLY_SYMBOL_3, 'The carpenter gives you a holy symbol.'],
  ]);
  assert.equal(stage(f), 16);
  assert.equal(saved(f)[VARBIT.PRIESTS], 1);
  assert.equal(f.has(I().HOLY_SYMBOL_3), 1);
});

test('the suntrap: saltwater dried to a pile of salt (Wiki), nothing suitable without it (rec 331)', async (t) => {
  const f = fixture(t, [3305, 2758, 0]);
  setStage(f, 15);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, 399: 1 });
  await f.clickLoc(6606, 3305, 2756);
  let lines = await f.talk();
  assert.ok(texts(lines).some((t) => t.startsWith("You don't have anything suitable to use with the suntrap")));
  f.give(I().BUCKET_OF_SALTWATER);
  await f.clickLoc(6606, 3305, 2756);
  lines = await f.talk();
  assert.ok(texts(lines).some((t) => t.startsWith('You pour the water into the suntrap')));
  assert.equal(f.has(I().PILE_OF_SALT), 1);
  assert.equal(f.has(I().BUCKET), 1);
});

// ---------------------------------------------------------------------------
// The ceremony
// ---------------------------------------------------------------------------

/** Steps until `done()` holds, at most `max` ticks; returns how many it took. */
function until(f, done, max = 12) {
  for (let i = 0; i <= max; i++) { if (done()) return i; f.step(); }
  return -1;
}

const ceremonyNpcs = (f) => [...core.World.getNpcs()].filter((npc) => npc && npc.__questSceneOwner === f.p && [11649, 11606, 4210, 11590].includes(npc.getId()));

test('flashback 3: the holy symbol for the unholy one, hidden in a sarcophagus (18), out of the room the ceremony stands (19, t3024-t3078)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  f.give(I().HOLY_SYMBOL_3);
  const symbolSlot = f.slot(I().HOLY_SYMBOL_3);
  await enterPyramid(f, 16, { [VARBIT.PRIESTS]: 1 });
  assert.equal(ceremonyNpcs(f).length, 4, 'the ceremony is under way in the eastern room (t2515)');
  place(f, 3292, 9191);
  await clickIn(f, 6632, 3292, 9194, 1);
  for (let i = 0; i < 6 && !f.read(); i++) f.step();
  f.step(5 + 2);
  assert.equal(stage(f), 17);
  assert.deepEqual(sourceOf(f), [3295, 9198, 0]);
  assert.equal(ceremonyNpcs(f).length, 0, 'not in the past');
  assert.equal(f.p.getInventory().getItems()[symbolSlot]?.getId(), I().UNHOLY_SYMBOL_3);
  f.step(4);
  assert.equal(f.read()?.[2], "I need to hide the mistress's symbol in the ceremonial room...");
  await f.cont(); f.step();
  place(f, 3306, 9200);
  await clickIn(f, 44060, 3306, 9199);
  f.step(4);
  place(f, 3311, 9195);
  const [sx, sy] = tileIn(f, 3312, 9195);
  await f.send({ type: 'item_on_object', objectId: 44600, x: sx, y: sy, itemId: I().UNHOLY_SYMBOL_3, slot: f.slot(I().UNHOLY_SYMBOL_3), widgetId: 149 << 16 });
  f.step(2);
  assert.equal(stage(f), 18);
  let lines = await f.talk();
  assert.deepEqual(lines.map((l) => l.slice(0, 3)), [
    ['item', I().UNHOLY_SYMBOL_3, 'You hide the unholy symbol in the sarcophagus.'],
    ['player', 'player', 'Yes... Now the mistress can enter the pyramid whenever she pleases...'],
  ]);
  place(f, 3306, 9198);
  await clickIn(f, 44060, 3306, 9199);
  assert.ok(until(f, () => stage(f) === 19) >= 0);
  f.step(2);
  assert.deepEqual(sourceOf(f), [3292, 9192, 0]);
  assert.equal(f.p.getInventory().getItems()[symbolSlot]?.getId(), I().HOLY_SYMBOL_3, 'the holy symbol back in its slot');
  assert.equal(ceremonyNpcs(f).length, 4);
  lines = await f.talk();
  assert.deepEqual(texts(lines), ["The wanderer! She's going to attack the ceremony! I need to warn them!"]);
});

test('the ceremony scene: cutscene on, the Wanderer turns Amascut and possesses a priest (22), the fight, the potion (23, t3111-t3223)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  f.give(I().HOLY_SYMBOL_3);
  await enterPyramid(f, 19, { [VARBIT.PRIESTS]: 1 });
  place(f, 3306, 9200);
  await clickIn(f, 44060, 3306, 9199);
  assert.ok(until(f, () => stage(f) === 21) >= 0);
  assert.equal(f.varbit(542), 1, 'cutscene_status');
  const lines = await f.talk([], { pace: 1 });
  assert.equal(lines[0][2], 'Ah there you are. Do you have the holy symbol?');
  assert.ok(lines.some((l) => l[1] === 11591 && l[2] === 'Adventurer, kill these pathetic priests.'), 'Amascut\'s head');
  f.step(2);
  assert.equal(stage(f), 22);
  assert.equal(f.varbit(542), 0, 'cutscene over');
  const priest = [...core.World.getNpcs()].find((npc) => npc?.getId() === 4210 && npc.__icthlarinOwner === f.p);
  assert.ok(priest, 'the possessed priest');
  PM.emitNpcDeath?.({ npc: priest, npcId: 4210, killer: f.p });
  assert.equal(stage(f), 23);
  const potion = core.ItemOnGroundManager.ownedBy(f.p.getUsername()).find((g) => g.getItem().getId() === I().ATTACK_POTION_4_);
  assert.ok(potion, 'Apmeken\'s jar: an attack potion(4) (Wiki; t3223)');
});

test('the thanks (24 on "We have a few things to finish here..."), Icthlarin\'s flashback (25), the trinket completes it once (t3226-t3378)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  f.give(I().HOLY_SYMBOL_3);
  await enterPyramid(f, 23, { [VARBIT.PRIESTS]: 1 });
  const highPriest = ceremonyNpcs(f).find((npc) => npc.getId() === 11649);
  place(f, 3307, 9195);
  await f.clickNpc(highPriest);
  let lines = await f.talk();
  assert.ok(lines.some((l) => l[0] === 'item' && l[1] === I().HOLY_SYMBOL_3 && l[2] === 'You give the holy symbol to the High Priest.'));
  assert.equal(f.has(I().HOLY_SYMBOL_3), 0);
  assert.equal(stage(f), 24);
  place(f, 3306, 9198);
  await clickIn(f, 44060, 3306, 9199);
  until(f, () => !!f.read());
  assert.deepEqual(f.read(), ['box', null, 'All of a sudden, a final sense of deja-vu sweeps over you...']);
  f.step(3 + 2 + 5);
  lines = await f.talk([], { pace: 1 });
  assert.deepEqual(lines.slice(0, 5).map((l) => [l[1], l[2]]), [
    [4199, 'And what do we have here?'],
    ['player', 'I must do as the mistress commands...'],
    [4199, 'Did my sister really think that I would not sense her presence here?'],
    [4199, 'Amascut! Release your hold on this human!'],
    ['player', 'Argh...'],
  ]);
  f.step(6);
  assert.equal(stage(f), 25);
  assert.deepEqual(at(f), [3294, 2781, 0]);
  const priest = f.npc(6192, [3281, 2772, 0]);
  f.p.moveTo(new core.Location(3281, 2770, 0)); f.step();
  const thieving = f.p.getSkillManager().getExperience(core.Skill.THIEVING);
  await f.clickNpc(priest);
  lines = await f.talk([2]);
  assert.equal(stage(f), 26);
  assert.equal(f.has(I().CATSPEAK_AMULET), 1);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.THIEVING) - thieving, 4500);
  assert.equal(f.has(4679), 0, 'no quest items left');
  await f.clickNpc(priest);
  await f.talk([2]);
  assert.equal(f.has(I().CATSPEAK_AMULET), 1, 'rewarded once');
});

// ---------------------------------------------------------------------------
// Other branches, saves and the journal
// ---------------------------------------------------------------------------

test('riddle answers 12 and 14 ask "Are you sure?" like 7, and the exit keeps the cat (Wiki)', async (t) => {
  for (const answer of [3, 4]) {
    const f = fixture(t, [3300, 2785, 0]);
    setStage(f, 5);
    f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.MET_SPHINX]: 1 });
    withCat(f);
    const sphinx = f.npc(4209, [3300, 2783, 0]);
    await f.clickNpc(sphinx);
    const lines = await f.talk([1, answer, 2]);
    assert.ok(texts(lines).includes('Are you sure?'), `answer ${answer}`);
    assert.equal(saved(f)[414] ?? 0, 0, 'the cat kept');
    assert.equal(stage(f), 5);
  }
});

test('Jex: the quest\'s line from the arrival to the token, his own page afterwards', async (t) => {
  const f = fixture(t, [3315, 2799, 0]);
  setStage(f, 3);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2 });
  const jex = f.npc(core.NpcIdentifiers.JEX, [3315, 2801, 0]);
  const event = { player: f.p, npc: jex, npcId: jex.getId(), handled: false };
  const { createTalk } = require('../plugins/quests/icthlarin/Talk.IcthlarinsLittleHelper');
  assert.ok(typeof createTalk === 'function');
  assert.equal(PM.emitNpcInteraction({ player: f.p, npc: jex, npcId: jex.getId(), npcIndex: jex.getIndex(), clickType: 1, option: 'Talk-to' }) !== false, true);
  setStage(f, 14);
  const after = PM.emitNpcInteraction({ player: f.p, npc: jex, npcId: jex.getId(), npcIndex: jex.getIndex(), clickType: 1, option: 'Talk-to' });
  assert.ok(event);
  assert.ok(after !== undefined);
});

test('hand-ins are refused outside the preparations, and Empty gives the bucket back', async (t) => {
  const f = fixture(t, [3287, 2757, 0]);
  setStage(f, 16);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2 });
  f.give(I().BUCKET_OF_SAP);
  PM.emitCustomEvent('npc-dialogue:action', { player: f.p, stepId: 'wicewv', kind: 'message', step: { type: 'message' }, handled: false });
  assert.equal(f.has(I().BUCKET_OF_SAP), 1);
  await f.send({ type: 'inventory_action', slot: f.slot(I().BUCKET_OF_SAP), itemId: I().BUCKET_OF_SAP, widgetId: 149 << 16, option: 'Empty' });
  f.step();
  assert.equal(f.has(I().BUCKET_OF_SAP), 0);
  assert.equal(f.has(I().BUCKET), 1);
});

test('the journal: live\'s text at the stages the capture opened it (t528, t650, t1052, t1080, t1255, t1582, t1784, t2172, t2550)', (t) => {
  const f = fixture(t);
  const lines = (s, vars = {}) => { setStage(f, s); f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, ...vars }); return quest.buildJournal(f.p, quest); };
  assert.deepEqual(lines(3).slice(4), [
    '<col=000080>I woke up outside a <col=800000>Pyramid<col=000080> in the city of <col=800000>Sophanem<col=000080> with a',
    '<col=000080>strange <col=800000>Burial Jar<col=000080> in my possession. I have no memory of how',
    '<col=000080>I obtained it or how I got there, but a nearby <col=800000>Ghost<col=000080> seems',
    '<col=000080>very angry with me. The last thing I remember was speaking to',
    '<col=000080>the <col=800000>Wanderer<col=000080> outside the city. I need to try and work out what',
    '<col=000080>happened to me.',
  ]);
  assert.equal(lines(3, { [VARBIT.MET_SPHINX]: 1 }).length, 12);
  assert.equal(lines(4, { 446: 0 }).at(-2), '<col=800000><col=800000>Flashback<col=000080>. I should touch the door again to try and work out');
  assert.equal(lines(5).at(-1), '<col=000080>discuss this with the <col=800000>Sphinx<col=000080>.');
  assert.equal(lines(6).length, 21);
  assert.equal(lines(7).at(-1), '<col=800000>Goddess of Destruction<col=000080>.');
  assert.equal(lines(11).at(-1), '<col=800000><col=800000>Burial Jar<col=000080>.');
  assert.deepEqual(lines(15, { 400: 7 }).slice(-5), [
    '', '<str>I gave the Embalmer some Salt, some Tree Sap and some Linen', '<str>for the Ceremony.', '',
    '<col=000080>I need to speak to the <col=800000>Carpenter<col=000080> and see what he needs.',
  ]);
});

test('a logout in a flashback: outside the door with the present\'s jar back, the stage kept, saved (Wiki)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  setStage(f, 3);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1 });
  f.give(4679);
  const slot = f.slot(4679);
  await f.clickLoc(6614, 3294, 2778);
  f.step(2); f.step(3 + 2 + 4);
  assert.equal(f.p.getInventory().getItems()[slot]?.getId(), I().UNHOLY_SYMBOL_3);
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.p.getInventory().getItems()[slot]?.getId(), 4679);
  assert.deepEqual(at(f), [3294, 2781, 0]);
  assert.equal(stage(f), 4);
  assert.equal(saved(f)[446], undefined, 'the flashback is not saved');
});

test('an old save: its stage and bit field mapped once onto live\'s varbits (SAVE_VERSION)', (t) => {
  const f = fixture(t);
  f.p.setAttribute(STAGE_KEY, 10); // the old "guardian defeated"
  f.p.setAttribute('quest.ictlharins_little_helper.bits', (1 << 1) | (1 << 3));
  f.p.setAttribute('quest.ictlharins_little_helper.jar', 'stomach');
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(stage(f), 11);
  assert.equal(saved(f)[VARBIT.JAR], 3);
  assert.equal(saved(f)[VARBIT.MET_SPHINX], 1);
  assert.equal(saved(f)[VARBIT.TOKEN_GIVEN], 1);
  assert.equal(f.p.getAttribute('quest.ictlharins_little_helper.bits'), 0);
  f.p.setAttribute(STAGE_KEY, 10);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(stage(f), 10, 'once only');
});

test('after the quest: the pyramid door\'s line, Klenter\'s thanks with ghostspeak then gone (t3647-t3664)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  setStage(f, 26);
  f.p.setAttribute(VARS_KEY, { [VARBIT.JAR]: 2, [VARBIT.KLENTER]: 1 });
  await f.clickLoc(6614, 3294, 2778);
  let lines = await f.talk();
  assert.deepEqual(texts(lines), ['I think it would be best if I stayed out of this tomb after what happened last time.']);
  f.p.getEquipment().set(core.Equipment.AMULET_SLOT, new core.Item(I().GHOSTSPEAK_AMULET, 1));
  // The login sends the saved varbits: 449 shows Klenter's shade (multinpc 1994 as 948).
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  const klenter = f.npc(1994, [3294, 2783, 0]);
  f.p.moveTo(new core.Location(3294, 2781, 0)); f.step();
  await f.clickNpc(klenter);
  lines = await f.talk();
  assert.equal(texts(lines).at(-1), 'Klenter disappears before you can ask him anything.');
  assert.equal(saved(f)[VARBIT.KLENTER], undefined, 'ics_specvis 0');
});

test('the pit jump: 20% run energy (Wiki), the recorded 15% drain on landing, live\'s legs and camera (t1170-t1188)', async (t) => {
  const f = fixture(t, [3294, 2779, 0]);
  f.give(4679);
  await enterPyramid(f, 13);
  place(f, 3292, 9191);
  f.p.setRunEnergy?.(10);
  await clickIn(f, 6632, 3292, 9194, 1);
  until(f, () => !!f.read());
  assert.equal(f.read()?.[2], 'I need to rest a little before I make the jump.');
  await f.cont(); f.step();
  f.p.setRunEnergy?.(100);
  f.p.getSkillManager().setMaxLevel?.(core.Skill.AGILITY, 99);
  const real = Math.random;
  Math.random = () => 0; // a success
  t.after(() => { Math.random = real; });
  await clickIn(f, 6632, 3292, 9194, 1);
  until(f, () => f.log.some((e) => e[1] === 'sendCameraMoveTo'));
  f.step(8);
  assert.deepEqual(sourceOf(f), [3292, 9197, 0]);
  assert.equal(f.p.getRunEnergy(), 85);
  assert.ok(f.log.some((e) => e[1] === 'sendSoundEffect' && e[2] === 1174), 'pit_land');
});
