// Run after `yarn build`: node --test tests/gertrudes-cat-capture.test.cjs
//
// Gertrude's Cat against the revision 242 capture of a whole run (docs/quests/gertrudes-cat): the
// boys' talk from the clicked boy's side and the payment on the last line, Fluffs' swipe, hand-overs
// and the return scene on their recorded ticks, the crates, dropping the kitten, the broken fence,
// the reward (kitten follower, food, scroll) and the journal. Real plugins, a real Player and World
// NPCs, the native client packets, the quest's own stage.
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

let core;
let quest;
const BUSY = 12393;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  quest = QuestRuntime.getRegisteredQuests().find((q) => q.key === 'gertrudes_cat');
  // The lumber yard's locs (the broken fence, the empty barrels) and their collision.
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.init?.();
  RegionManager.loadMapFiles(3308, 3492, true);
});
after(() => PM.emitServerShutdown({}));

let nextIndex = 2700;
function fixture(t, [x, y, z]) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(nextIndex++); p.setUsername(`gcat${nextIndex}`);
  p.setRegistered(true); p.setLocation(new core.Location(x, y, z)); p.needsPlacement = false;
  core.World.getPlayers?.().add?.(p);
  const c = new ClientConnection(channel); c.player = p;
  const log = [];
  const tick = () => log.tick ?? 0;
  const sender = p.getPacketSender();
  for (const name of ['sendMessage', 'sendTypedMessage', 'sendVarbit', 'sendConfig', 'sendNpcHeadOnInterface', 'sendInterfaceAnimation', 'sendItemOnInterface']) {
    const original = sender[name]?.bind(sender);
    if (!original) continue;
    t.mock.method(sender, name, (...args) => { log.push([tick(), name, ...args]); return original(...args); });
  }
  const chat = p.forceChat.bind(p);
  p.forceChat = (text) => { log.push([tick(), 'player-say', text]); return chat(text); };
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
  const watch = (npc) => {
    const say = npc.forceChat.bind(npc);
    npc.forceChat = (text) => { log.push([tick(), 'npc-say', npc.getId(), text]); return say(text); };
    const act = npc.performAnimation.bind(npc);
    npc.performAnimation = (a) => { log.push([tick(), 'npc-anim', npc.getId(), a?.getId?.()]); return act(a); };
    return npc;
  };
  const npc = (id, [nx, ny, nz]) => {
    const n = watch(core.NPC.create(id, new core.Location(nx, ny, nz)));
    core.World.getNpcs().add(n);
    spawned.push(n);
    // In view, as the world's sync would have it.
    const local = p.getLocalNpcs?.();
    if (Array.isArray(local)) local.push(n);
    return n;
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      log.tick = tick() + 1;
      // Spawned actors register as they are added; watch them before they can speak.
      for (const other of core.World.getNpcs?.() ?? []) if (other && !other.__watched && [3498, 5591, 5592, 5593, 5594, 5595, 5596].includes(other.getId())) { other.__watched = true; watch(other); }
      // The server's order: the tasks first, then each player's walk to an interaction and movement.
      core.TaskManager.process();
      core.TaskManager.processWalkTo?.(p.getIndex());
      p.getMovementQueue().process();
      core.World.getNpcs?.().forEach?.((other) => other?.getMovementQueue?.().process?.());
    }
  };
  const send = async (packet) => { await c.dispatch([packet]); c.processTurnPackets(); };
  const current = () => p.getDialogueManager().getCurrent();
  const dialogueText = () => current()?.getText?.();
  const cont = async () => send({ type: 'dialogue_continue', widgetId: p.getPacketSender().getChatboxGroupId() << 16, childIndex: -1 });
  const choose = async (index) => {
    const groupId = p.getPacketSender().getChatboxGroupId();
    const prompt = core.MultiChatboxPrompt.getPending(p);
    await send(prompt || groupId === (core.OptionDialogue.OPTIONS_WIDGET_ID >>> 16)
      ? { type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index }
      : { type: 'widget_action', widgetId: groupId << 16, groupId, childId: 0, buttonNum: index });
  };
  /** Reads lines as the client is shown them: [kind, head npc id or 'player', text]. */
  const read = () => {
    const entry = current();
    if (!entry) return null;
    if (entry instanceof core.NpcDialogue) return ['npc', entry.getNpcId(), entry.getText()];
    if (entry instanceof core.PlayerDialogue) return ['player', 'player', entry.getText()];
    if (entry instanceof core.OptionDialogue) return ['options', entry.getOptions()];
    if (entry instanceof core.ItemStatementDialogue) return ['item', entry.getItemId(), entry.getText()];
    if (entry instanceof core.StatementDialogue) return ['box', null, entry.getText()];
    return ['other'];
  };
  /** Talks through, answering menus with `choices` (1-based); returns the lines shown. */
  const talk = async (choices = [], { stop } = {}) => {
    const lines = [];
    let idle = 0;
    for (let i = 0; i < 80; i++) {
      step();
      const line = read();
      if (!line) {
        if (MultiPending()) { lines.push(['options', core.MultiChatboxPrompt.getPending(p).options]); if (!choices.length) break; await choose(choices.shift()); continue; }
        // Walking up to the NPC: a few idle ticks before the first line. Once talking, a closed chatbox is the end.
        if (++idle > (lines.length ? 1 : 8)) break;
        continue;
      }
      idle = 0;
      if (line[0] === 'other') continue;
      lines.push(line);
      if (stop?.(line)) break;
      if (line[0] === 'options') { if (!choices.length) break; await choose(choices.shift()); continue; }
      await cont();
    }
    return lines;
  };
  const MultiPending = () => !!core.MultiChatboxPrompt.getPending(p);
  const clickNpc = (target, clickType) => send({ type: 'npc_option', index: target.getIndex(), clickType });
  const give = (id, n = 1) => p.getInventory().adds(id, n);
  const slot = (id) => p.getInventory().getItems().findIndex((item) => item?.getId() === id);
  const useOn = (id, target) => send({ type: 'item_on_npc', targetIndex: target.getIndex(), itemId: id, slot: slot(id), widgetId: 149 << 16 });
  const since = (from) => log.filter((entry) => entry[0] >= from);
  return { p, log, tick, step, send, npc, talk, read, cont, choose, clickNpc, give, slot, useOn, since, dialogueText, current };
}

const N = () => core.NpcIdentifiers;
const I = () => core.ItemIdentifiers;
const seq = (name) => core.CacheDefinitions.getSeqId(name);
const texts = (lines) => lines.filter((l) => l[0] !== 'options').map((l) => l[2]);

test('Shilop and Wilough talk from the clicked boy\'s side, with their own heads (capture ticks 148-218)', async (t) => {
  const f = fixture(t, [3220, 3431, 0]);
  const shilop = f.npc(N().SHILOP, [3220, 3433, 0]);
  const wilough = f.npc(N().WILOUGH, [3221, 3433, 0]);
  quest.setStage(f.p, 1);
  await f.clickNpc(shilop, 1);
  let lines = await f.talk([2]);
  assert.deepEqual(lines.slice(0, 6).map((l) => [l[1], l[2]]), [
    ['player', "Hello there, I've been looking for you."],
    [N().SHILOP, "I didn't mean to take it! I just forgot to pay."],
    ['player', "What? I'm trying to help your mum find Fluffs."],
    [N().SHILOP, "Ohh...well, in that case I might be able to help. Fluffs followed me to my secret play area, I haven't seen her since."],
    ['player', 'Where is this play area?'],
    [N().SHILOP, "If I told you that, it wouldn't be a secret."],
  ]);
  assert.deepEqual(lines[6], ['options', ['Tell me sonny, or I will hurt you.', 'What will make you tell me?', "Well never mind, it's Fluffs' loss."]]);
  // Shilop alone asks for 100 coins: no "10 coins." exchange.
  assert.deepEqual(texts(lines.slice(7)), ['What will make you tell me?', 'Well...now you ask, I am a bit short on cash.', 'How much?',
    '100 coins should cover it.', '100 coins! Why should I pay you?',
    "You shouldn't, but I won't help otherwise. I never liked that cat anyway, so what do you say?"]);
  await f.choose(1);
  lines = await f.talk();
  assert.deepEqual(lines.map((l) => [l[1], l[2]]), [['player', "I'm not paying you a penny."], [N().SHILOP, "Okay then, I'll find another way to make money."]]);

  // From Wilough, Shilop chips in and Wilough defends him; the menu's "Fluffs loss" has no apostrophe.
  await f.clickNpc(wilough, 1);
  lines = await f.talk([1]);
  assert.deepEqual(lines[1], ['npc', N().WILOUGH, "I didn't mean to take it! I just forgot to pay."]);
  assert.deepEqual(lines[3], ['npc', N().SHILOP, "I might be able to help. Fluffs followed me to our secret play area and I haven't seen her since."]);
  assert.equal(lines[6][1][2], 'Well never mind, it\'s Fluffs loss.');
  assert.deepEqual(lines.slice(7).map((l) => [l[0], l[1], l[2]]), [
    ['player', 'player', 'Tell me sonny, or I will hurt you.'],
    ['npc', N().SHILOP, "W..wh..what?! Y..you wouldn't! A young lad like me!"],
    ['npc', N().WILOUGH, "If you want to hurt my brother you'll first have to get by me!"],
    ['box', null, "You decide it's best not to hurt the boy."],
  ]);
  assert.equal(quest.getStage(f.p), 1);
});

test('paying Wilough: the coins box, then the coins go and the stage moves only as the last line is continued (ticks 264-274)', async (t) => {
  const f = fixture(t, [3220, 3431, 0]);
  f.npc(N().SHILOP, [3220, 3433, 0]);
  const wilough = f.npc(N().WILOUGH, [3221, 3433, 0]);
  quest.setStage(f.p, 1);
  f.give(I().COINS, 500);
  await f.clickNpc(wilough, 1);
  let lines = await f.talk([2, 2]);
  const box = lines.findIndex((l) => l[0] === 'item');
  assert.deepEqual(lines[box], ['item', I().COINS, 'You give the lad 100 coins.']);
  assert.deepEqual(lines.slice(box + 1).map((l) => [l[1], l[2]]), [
    ['player', 'There you go, now where did you see Fluffs?'],
    [N().SHILOP, 'We play at an abandoned lumber mill to the north east. Just beyond the Jolly Boar Inn. I saw Fluffs running around in there.'],
    ['player', 'Anything else?'],
    [N().WILOUGH, "Well, you'll have to find the broken fence to get in. I'm sure you can manage that."],
  ]);
  assert.equal(quest.getStage(f.p), 2);
  assert.equal(f.p.getInventory().getAmount(I().COINS), 400);

  // Walking off after the coins box keeps both the coins and the stage.
  const g = fixture(t, [3220, 3431, 0]);
  const w2 = g.npc(N().WILOUGH, [3221, 3433, 0]);
  quest.setStage(g.p, 1);
  g.give(I().COINS, 100);
  await g.clickNpc(w2, 1);
  lines = await g.talk([2, 2]);
  assert.equal(quest.getStage(g.p), 2, 'the full talk pays');
  const h = fixture(t, [3220, 3431, 0]);
  const w3 = h.npc(N().WILOUGH, [3221, 3433, 0]);
  quest.setStage(h.p, 1);
  h.give(I().COINS, 100);
  await h.clickNpc(w3, 1);
  await h.talk([2, 2], { stop: (line) => line[0] === 'item' });
  assert.equal(h.read()?.[0], 'item');
  h.p.getDialogueManager().reset();
  h.p.getPacketSender().sendInterfaceRemoval();
  assert.equal(quest.getStage(h.p), 1, 'closing before the last line pays nothing');
  assert.equal(h.p.getInventory().getAmount(I().COINS), 100);
});

test('after paying the clicked boy says where Fluffs is; once she is found he boasts (ticks 281-290, 765-782)', async (t) => {
  const f = fixture(t, [3220, 3431, 0]);
  const shilop = f.npc(N().SHILOP, [3220, 3433, 0]);
  const wilough = f.npc(N().WILOUGH, [3221, 3433, 0]);
  quest.setStage(f.p, 2);
  await f.clickNpc(wilough, 1);
  assert.deepEqual((await f.talk()).map((l) => l[1]), ['player', N().WILOUGH]);
  await f.clickNpc(shilop, 1);
  assert.deepEqual((await f.talk()).map((l) => l[1]), ['player', N().SHILOP]);
  quest.setStage(f.p, 5);
  await f.clickNpc(wilough, 1);
  const lines = await f.talk();
  assert.deepEqual(lines.map((l) => [l[1], l[2]]), [
    ['player', 'Hello again.'], [N().WILOUGH, "You think you're tough do you?"], ['player', 'Pardon?'],
    [N().WILOUGH, 'I can beat anyone up!'], [N().SHILOP, 'He can you know!'], ['player', 'Really?'],
    [null, 'The boy begins to jump around with his fists up. You decide it\'s best not to kill him just yet.'],
  ]);
});

test('Fluffs: the reach, her swipe and hiss at 2, "Ouch!" overhead at 3, the hint box at 7, clicks held (ticks 418-437)', async (t) => {
  const f = fixture(t, [3307, 3513, 1]);
  const fluffs = f.npc(N().GERTRUDES_CAT_2, [3306, 3513, 1]);
  quest.setStage(f.p, 2);
  const start = f.tick();
  await f.clickNpc(fluffs, 1);
  let box = null;
  for (let i = 0; i < 12 && !box; i++) { f.step(); if (f.read()?.[0] === 'box') box = f.tick(); }
  const events = f.since(start).filter((e) => ['player-anim', 'npc-anim', 'npc-say', 'player-say'].includes(e[1]) || (e[1] === 'sendVarbit' && e[2] === BUSY));
  const at = (kind) => events.find((e) => e[1] === kind);
  const t0 = at('player-anim')[0];
  assert.equal(at('player-anim')[2], seq('human_pickupfloor'));
  assert.deepEqual([at('npc-anim')[0] - t0, at('npc-anim')[3]], [2, seq('cat_attack')]);
  assert.deepEqual([at('npc-say')[0] - t0, at('npc-say')[3]], [2, 'Hisss!']);
  assert.deepEqual([at('player-say')[0] - t0, at('player-say')[2]], [3, 'Ouch!'], 'the player\'s line is overhead, not a chatbox line');
  assert.equal(box - t0, 7);
  assert.equal(f.dialogueText(), 'Maybe the cat is thirsty?');
  assert.equal(f.p.getMovementQueue().isMovementBlocked?.() ?? true, true);
  // A Stroke click while the box is up does nothing.
  const before = f.log.length;
  await f.clickNpc(fluffs, 3);
  f.step(3);
  assert.equal(f.log.slice(before).filter((e) => e[1] === 'npc-say').length, 0);
  await f.cont();
  f.step();
  assert.ok(f.since(start).some((e) => e[1] === 'sendVarbit' && e[2] === BUSY && e[3] === 0), 'BUSY clears as the box is continued');

  // Stroke gives the same hint at every stage; Pick-up's follows the stage.
  for (const [stage, op, hint] of [[3, 3, 'Perhaps the cat wants something?'], [3, 1, 'Maybe the cat is hungry?'],
    [4, 1, 'The cat seems afraid to leave. In the distance you can hear kittens mewing...'], [4, 3, 'Perhaps the cat wants something?'],
    [6, 3, 'Perhaps the cat wants something?']]) {
    quest.setStage(f.p, stage);
    await f.clickNpc(fluffs, op);
    let text = null;
    for (let i = 0; i < 12 && !text; i++) { f.step(); if (f.read()?.[0] === 'box') text = f.dialogueText(); }
    assert.equal(text, hint, `stage ${stage} op ${op}`);
    await f.cont(); f.step();
  }
  // After the quest, Pick-up is the player's line (rsprox.net recording 3222 tick 12285).
  await f.clickNpc(fluffs, 1);
  const lines = await f.talk();
  assert.deepEqual(lines, [['player', 'player', "Oh, it looks like Fluffs has returned. I'd better leave her alone."]]);
  // Talk-to: "Miaoww" over her head before the quest is done.
  quest.setStage(f.p, 2);
  const s = f.tick();
  await f.clickNpc(fluffs, 4);
  f.step(3);
  assert.ok(f.since(s).some((e) => e[1] === 'npc-say' && e[3] === 'Miaoww'));
  assert.ok(!f.since(s).some((e) => e[1] === 'sendMessage' && String(e[2]).includes('Miaoww')), 'not a chat line');
});

test('milk and the seasoned sardine: the reach, then the stage, the item and her "Mew!" a tick later, no chat message (ticks 449-480)', async (t) => {
  const f = fixture(t, [3307, 3513, 1]);
  const fluffs = f.npc(N().GERTRUDES_CAT_2, [3306, 3513, 1]);
  quest.setStage(f.p, 2);
  f.give(I().BUCKET_OF_MILK);
  const start = f.tick();
  await f.useOn(I().BUCKET_OF_MILK, fluffs);
  f.step(3);
  const reach = f.since(start).find((e) => e[1] === 'player-anim');
  assert.equal(reach[2], seq('human_pickupfloor'));
  assert.equal(quest.getStage(f.p), 3);
  assert.equal(f.p.getInventory().getAmount(I().BUCKET), 1);
  const mew = f.since(start).find((e) => e[1] === 'npc-say');
  assert.deepEqual([mew[0] - reach[0], mew[3]], [1, 'Mew!']);
  assert.ok(!f.since(start).some((e) => e[1] === 'sendMessage'), 'no game message');
  // Milk again: not hers to take now.
  f.give(I().BUCKET_OF_MILK);
  await f.useOn(I().BUCKET_OF_MILK, fluffs);
  f.step(2);
  assert.equal(f.p.getInventory().getAmount(I().BUCKET_OF_MILK), 1);
  assert.equal(quest.getStage(f.p), 3);
  // The sardine, seasoned with the Wiki's words.
  f.give(I().RAW_SARDINE); f.give(I().DOOGLE_LEAVES);
  const s = f.tick();
  await f.send({ type: 'inventory_use_on', slot: f.slot(I().DOOGLE_LEAVES), itemId: I().DOOGLE_LEAVES,
    target: { kind: 'inventory', slot: f.slot(I().RAW_SARDINE), itemId: I().RAW_SARDINE } });
  f.step();
  assert.equal(f.p.getInventory().getAmount(I().SEASONED_SARDINE), 1);
  assert.ok(f.since(s).some((e) => e[1] === 'sendMessage' && e[2] === 'You rub the doogle leaves all over the sardines.'));
  await f.useOn(I().SEASONED_SARDINE, fluffs);
  f.step(2);
  assert.equal(quest.getStage(f.p), 4);
  assert.equal(f.p.getInventory().getAmount(I().SEASONED_SARDINE), 0);
});

test('crates: "You search the crate.", 4 ticks, then nothing or the kitten (given as the box is continued); a dropped kitten runs off (ticks 403-615)', async (t) => {
  const f = fixture(t, [3306, 3501, 0]);
  const crates = [[3305, 3500], [3310, 3499], [3303, 3506]].map(([x, y]) => f.npc(N().CRATE, [x, y, 0]));
  quest.setStage(f.p, 4);
  f.p.setAttribute('gertrudes-cat:kitten-crate', '3310,3499');
  const search = async (crate) => {
    const from = f.log.length;
    await f.clickNpc(crate, 1);
    for (let i = 0; i < 25; i++) { f.step(); if (f.read()?.[0] === 'box' || f.log.slice(from).some((e) => e[2] === 'You find nothing.')) break; }
    return f.log.slice(from);
  };
  let seen = await search(crates[0]);
  const first = seen.find((e) => e[2] === 'You search the crate.');
  const nothing = seen.find((e) => e[2] === 'You find nothing.');
  assert.ok(first && nothing, JSON.stringify(seen.filter((e) => e[1] === 'sendMessage')));
  assert.equal(nothing[0] - first[0], 4);
  assert.ok(seen.some((e) => e[1] === 'sendVarbit' && e[2] === BUSY && e[3] === 1));
  seen = await search(crates[1]);
  assert.equal(f.dialogueText(), 'You find a kitten! You carefully place it in your backpack.');
  assert.equal(f.p.getInventory().getAmount(I().FLUFFS_KITTEN), 0, 'not before the box is continued');
  await f.cont(); f.step();
  assert.equal(f.p.getInventory().getAmount(I().FLUFFS_KITTEN), 1);

  // Dropping it: on the floor, a mew, run off at 6, gone 2 ticks after the box.
  const s = f.tick();
  await f.send({ type: 'inventory_action', slot: f.slot(I().FLUFFS_KITTEN), itemId: I().FLUFFS_KITTEN, widgetId: 3214, option: 'Drop' });
  let ran = null;
  for (let i = 0; i < 10 && !ran; i++) { f.step(); if (f.read()?.[0] === 'box') ran = f.tick(); }
  const placed = f.since(s).find((e) => e[2] === 'You place the kitten on the floor.');
  assert.ok(placed);
  assert.equal(f.p.getInventory().getAmount(I().FLUFFS_KITTEN), 0);
  assert.equal(f.dialogueText(), 'The kitten has run off!');
  assert.equal(ran - placed[0], 6);
  const actor = () => [...core.World.getNpcs()].find((n) => n?.getId?.() === N().KITTEN && n.getOwner?.() === f.p);
  assert.ok(actor(), 'the kitten is on the floor');
  assert.ok(f.since(s).some((e) => e[1] === 'npc-say' && e[2] === N().KITTEN && e[3] === 'Mew!'));
  await f.cont(); f.step(3);
  assert.ok(!actor(), 'and gone');
  assert.equal(core.World.getItemsOnGround?.()?.some?.((g) => g?.getItem?.()?.getId?.() === I().FLUFFS_KITTEN) ?? false, false, 'no item left on the floor');
  // It is back in its crate.
  seen = await search(crates[1]);
  if (f.dialogueText() !== 'You find a kitten! You carefully place it in your backpack.') console.log('DEBUG', JSON.stringify(seen.filter((e) => e[1] === 'sendMessage' || e[1] === 'sendVarbit')), f.p.getLocation().toString());
  assert.equal(f.dialogueText(), 'You find a kitten! You carefully place it in your backpack.');
});

test('the broken fence: north with human_walk_fence_north over the fence to 3308,3493, south with 839 to 3308,3491, no message (ticks 375-382, 694-701)', async (t) => {
  const f = fixture(t, [3308, 3490, 0]);
  const fence = core.CacheDefinitions.getLocId('gertrudefence');
  const s = f.tick();
  await f.send({ type: 'object_option', id: fence, x: 3308, y: 3492, clickType: 1 });
  let landed = null, beside = null, move = null;
  for (let i = 0; i < 14 && !landed; i++) {
    f.step();
    if (beside === null && f.p.getLocation().getY() === 3491) beside = f.tick();
    const force = f.p.getForceMovement?.();
    if (!move && force) move = { from: [force.getStart().getX(), force.getStart().getY()], at: [f.p.getLocation().getX(), f.p.getLocation().getY()],
      to: [force.getStart().getX() + force.getEnd().getX(), force.getStart().getY() + force.getEnd().getY()] };
    if (f.p.getLocation().getY() === 3493) landed = f.tick();
  }
  // Live climbs from the fence tile itself, the move one tile on from it (3493 to 3494). This cache
  // blocks the fence tile, so from 3308,3491 the move keeps that distance: it starts on the fence
  // (issue 6772: one tile further north, and one tile further on, than the fence it crosses).
  assert.deepEqual(move, { at: [3308, 3491], from: [3308, 3492], to: [3308, 3493] });
  // North: four ticks after reaching 3308,3491, as 3222 walks 3491 (t+1), the fence tile (t+3) and climbs (t+5).
  const north = f.since(s).find((e) => e[1] === 'player-anim' && e[2] === seq('human_walk_fence_north'));
  assert.equal(north?.[0] - beside, 4);
  assert.ok(landed, `at ${f.p.getLocation()}`);
  assert.ok(f.since(s).some((e) => e[1] === 'player-anim' && e[2] === seq('human_walk_fence_north')));
  assert.ok(!f.since(s).some((e) => e[1] === 'sendMessage'), 'no message');
  // South: two ticks after reaching 3308,3493 (the capture's ticks 696-698, 3222's 11368-11370).
  const g = fixture(t, [3308, 3495, 0]);
  const b = g.tick();
  await g.send({ type: 'object_option', id: fence, x: 3308, y: 3492, clickType: 1 });
  let arrived = null;
  for (let i = 0; i < 12 && g.p.getLocation().getY() !== 3491; i++) {
    g.step();
    if (arrived === null && g.p.getLocation().getY() === 3493) arrived = g.tick();
  }
  assert.equal(g.p.getLocation().getY(), 3491);
  const climb = g.since(b).find((e) => e[1] === 'player-anim' && e[2] === 839);
  assert.ok(climb && arrived !== null);
  assert.equal(climb[0] - arrived, 2);
});

test('the return: stage 5, the kitten on the player\'s tile, purrs at 2 and 3, the walk off, both gone and the box at 11 (ticks 665-676)', async (t) => {
  const f = fixture(t, [3307, 3513, 1]);
  const fluffs = f.npc(N().GERTRUDES_CAT_2, [3306, 3513, 1]);
  quest.setStage(f.p, 4);
  f.give(I().FLUFFS_KITTEN);
  const start = f.tick();
  await f.useOn(I().FLUFFS_KITTEN, fluffs);
  let box = null;
  for (let i = 0; i < 16 && !box; i++) { f.step(); if (f.read()?.[0] === 'box') box = f.tick(); }
  const events = f.since(start);
  const t0 = events.find((e) => e[1] === 'player-anim')[0];
  assert.equal(quest.getStage(f.p), 5);
  const purrs = events.filter((e) => e[1] === 'npc-say' && e[3] === 'Purr...');
  assert.deepEqual(purrs.map((e) => [e[0] - t0, e[2]]), [[2, N().GERTRUDES_CAT_2], [3, N().KITTEN]]);
  assert.equal(box - t0, 11);
  assert.equal(f.dialogueText(), 'Fluffs has run off home with her offspring.');
  assert.equal(fluffs.isVisible(), false, 'Fluffs has left the loft');
  assert.ok(![...core.World.getNpcs()].some((n) => n?.getId?.() === N().KITTEN && n.getOwner?.() === f.p));
  await f.cont(); f.step();
  assert.ok(f.since(start).some((e) => e[1] === 'sendVarbit' && e[2] === BUSY && e[3] === 0));
  f.step(30);
  assert.equal(fluffs.isVisible(), true, 'and is back later');
});

test('the reward: stage 6 and the kitten following on the box\'s continue, the food 5 ticks on, the scroll 4 after (ticks 862-872)', async (t) => {
  const f = fixture(t, [3149, 3412, 0]);
  const gertrude = f.npc(N().GERTRUDE, [3149, 3413, 0]);
  quest.setStage(f.p, 5);
  const said = [];
  const say = core.NPC.prototype.forceChat;
  t.mock.method(core.NPC.prototype, 'forceChat', function (text) { said.push([f.tick(), this.getId(), text]); return say.call(this, text); });
  const start = f.tick();
  await f.clickNpc(gertrude, 1);
  const lines = await f.talk();
  assert.deepEqual(lines.filter((l) => l[0] === 'box').map((l) => l[2]), ['Gertrude gives you a hug.', 'Gertrude gives you a kitten.']);
  // Live names the base 3500, whose varp-180 transform is this head; 7284 and 7723 share its models.
  assert.deepEqual([...new Set(lines.filter((l) => l[0] === 'npc').map((l) => l[1]))], [N().GERTRUDE]);
  const t0 = f.tick();
  assert.equal(quest.getStage(f.p), 6);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.COOKING), 1525);
  const pet = { player: f.p, pet: null };
  PM.emitCustomEvent('pets:current', pet);
  assert.equal(pet.pet?.getDefinition?.()?.getName?.(), 'Kitten', 'the kitten follows');
  assert.equal(f.p.getInventory().getAmount(I().CHOCOLATE_CAKE), 0);
  f.step(6);
  const food = f.since(start).find((e) => e[1] === 'sendMessage' && e[2] === '... and some food!');
  assert.ok(food);
  assert.equal(f.p.getInventory().getAmount(I().CHOCOLATE_CAKE), 1);
  assert.equal(f.p.getInventory().getAmount(I().STEW), 1);
  f.step(5);
  const done = f.since(start).find((e) => e[1] === 'sendMessage' && String(e[2]).startsWith("Congratulations, you've completed a quest"));
  assert.ok(done);
  assert.equal(done[0] - food[0], 4);
  const kittenSays = said.filter(([, id]) => core.NpcDefinition.forId(id)?.getName?.() === 'Kitten');
  assert.deepEqual(kittenSays.map((e) => e[2]), ['Miaow!', 'Meeooow!']);
  assert.equal(kittenSays[1][0] - kittenSays[0][0], 1);
  assert.deepEqual(QuestRuntime.rewardLines(quest, f.p).slice(1), ['1 Quest Point', '1,525 Cooking XP', 'A Kitten', 'A Chocolate Cake', 'Some Stew']);
  // Talking again pays nothing twice.
  await f.clickNpc(gertrude, 1);
  await f.talk([2]);
  f.step(12);
  assert.equal(f.p.getInventory().getAmount(I().CHOCOLATE_CAKE), 1);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.COOKING), 1525);
  // Asking for another kitten while raising this one (tick 883-884).
  await f.clickNpc(gertrude, 1);
  const again = await f.talk([1]);
  assert.ok(texts(again).includes("Aren't you still raising that other kitten? Only once it's fully grown and it no longer needs your attention will I let you have another kitten."), JSON.stringify(texts(again)));
});

test('the food the reward owes survives a logout and a save between the kitten and the food', async (t) => {
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const f = fixture(t, [3149, 3412, 0]);
  const gertrude = f.npc(N().GERTRUDE, [3149, 3413, 0]);
  quest.setStage(f.p, 5);
  await f.clickNpc(gertrude, 1);
  await f.talk();
  assert.equal(quest.getStage(f.p), 6);
  PM.emitPlayerLogout?.({ player: f.p });
  const saved = PlayerSave.fromPlayer(f.p);
  const g = fixture(t, [3149, 3412, 0]);
  saved.applyToPlayer(g.p);
  assert.equal(quest.getStage(g.p), 6);
  assert.equal(g.p.getInventory().getAmount(I().CHOCOLATE_CAKE), 0);
  assert.equal(g.p.getAttribute('gertrudes-cat:food-owed'), true, 'saved');
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername() });
  assert.equal(g.p.getInventory().getAmount(I().CHOCOLATE_CAKE), 1);
  assert.equal(g.p.getInventory().getAmount(I().STEW), 1);
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername() });
  assert.equal(g.p.getInventory().getAmount(I().CHOCOLATE_CAKE), 1, 'once');
});

test('the journal reads as recorded at stages 1, 2, 4 and 5 (ticks 73, 278, 601, 703)', (t) => {
  const f = fixture(t, [3149, 3412, 0]);
  const page = (stage) => { quest.setStage(f.p, stage); return quest.buildJournal(f.p, quest); };
  assert.deepEqual(page(1), ["<str>I accepted the challenge of finding Gertrude's lost cat.", '',
    '<col=000080>I need to <col=800000>speak to Shilop and Wilough<col=000080> at the <col=800000>marketplace.']);
  assert.deepEqual(page(2).slice(1), ["<str>I spoke to Shilop, Gertrude's Son.", '',
    '<col=000080>I need to <col=800000>go to their play area <col=000080>and <col=800000>find the lost cat and return', '<col=800000>it to Gertrude.']);
  assert.deepEqual(page(4).slice(2), ["<str>I found the lost cat but it won't come back.", '<str>I gave the cat milk and sardines.', '',
    '<col=000080>I still need to <col=800000>get her to follow me home.']);
  assert.deepEqual(page(5).slice(2), ["<str>The cat didn't follow me back.", '<str>I gave the cat milk and sardines.', '<str>I gave Fluffs her kitten back.', '',
    '<col=000080>She ran off home.']);
});

test('the lumber yard\'s empty barrel and crate: searched, then "You find nothing." 4 ticks later (ticks 386-398)', async (t) => {
  const f = fixture(t, [3309, 3497, 0]);
  const barrel = core.CacheDefinitions.getLocId('gertrudeempty_barrel');
  const s = f.tick();
  await f.send({ type: 'object_option', id: barrel, x: 3310, y: 3497, clickType: 1 });
  f.step(7);
  const seen = f.since(s).filter((e) => e[1] === 'sendMessage');
  const a = seen.find((e) => e[2] === 'You search the barrel.');
  const b = seen.find((e) => e[2] === 'You find nothing.');
  assert.ok(a && b, JSON.stringify(seen));
  assert.equal(b[0] - a[0], 4);
});

test('starting: "You\'ve started a new quest" with the stage as the player agrees (tick 63)', async (t) => {
  const f = fixture(t, [3149, 3412, 0]);
  const gertrude = f.npc(N().GERTRUDE, [3149, 3413, 0]);
  quest.setStage(f.p, 0);
  await f.clickNpc(gertrude, 1);
  const from = f.log.length;
  const lines = await f.talk([1]);
  assert.equal(quest.getStage(f.p), 1);
  const started = f.log.slice(from).findIndex((e) => e[1] === 'sendMessage' && String(e[2]).startsWith("You've started a new quest"));
  assert.ok(started >= 0);
  const thanks = lines.findIndex((l) => String(l[2]).startsWith('Really? Thank you so much!'));
  assert.ok(thanks > 0, 'the start comes before her thanks');
});

test('Fluffs after the hand-in: "Miaoww" overhead without a catspeak amulet; wrong items and a double use', async (t) => {
  const f = fixture(t, [3307, 3513, 1]);
  const fluffs = f.npc(N().GERTRUDES_CAT_2, [3306, 3513, 1]);
  quest.setStage(f.p, 6);
  const s = f.log.length;
  await f.clickNpc(fluffs, 4);
  f.step(3);
  assert.ok(f.log.slice(s).some((e) => e[1] === 'npc-say' && e[3] === 'Miaoww'));
  assert.equal(f.read(), null, 'no chatbox');
  // A seasoned sardine after the quest (Wiki, Seasoned sardine).
  f.give(I().SEASONED_SARDINE);
  const w = f.log.length;
  await f.useOn(I().SEASONED_SARDINE, fluffs);
  f.step(2);
  assert.ok(f.log.slice(w).some((e) => e[1] === 'sendMessage' && e[2] === 'Nothing interesting happens.'));
  assert.equal(f.p.getInventory().getAmount(I().SEASONED_SARDINE), 1);
  // Two milk uses before the stage tick spend one bucket.
  quest.setStage(f.p, 2);
  f.give(I().BUCKET_OF_MILK, 1); f.give(I().BUCKET_OF_MILK, 1);
  await f.useOn(I().BUCKET_OF_MILK, fluffs);
  await f.useOn(I().BUCKET_OF_MILK, fluffs);
  f.step(3);
  assert.equal(quest.getStage(f.p), 3);
  assert.equal(f.p.getInventory().getAmount(I().BUCKET_OF_MILK), 1);
});

test('a logout on the tick after the milk or the sardine still lands the hand-over in the save', async (t) => {
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  for (const [stage, item, next, back] of [[2, () => I().BUCKET_OF_MILK, 3, () => I().BUCKET], [3, () => I().SEASONED_SARDINE, 4, null]]) {
    const f = fixture(t, [3307, 3513, 1]);
    const fluffs = f.npc(N().GERTRUDES_CAT_2, [3306, 3513, 1]);
    quest.setStage(f.p, stage);
    f.give(item());
    await f.useOn(item(), fluffs);
    assert.equal(f.p.getInventory().getAmount(item()), 0, 'the item went');
    assert.equal(quest.getStage(f.p), stage, 'the stage waits a tick');
    PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
    const g = fixture(t, [3307, 3513, 1]);
    PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);
    assert.equal(quest.getStage(g.p), next);
    if (back) assert.equal(g.p.getInventory().getAmount(back()), 1);
  }
});

test('a banked kitten: the crate holds no second one', async (t) => {
  const f = fixture(t, [3306, 3501, 0]);
  const crate = f.npc(N().CRATE, [3305, 3500, 0]);
  quest.setStage(f.p, 4);
  f.p.setAttribute('gertrudes-cat:kitten-crate', '3305,3500');
  f.p.getBank(0).add(new core.Item(I().FLUFFS_KITTEN, 1));
  const from = f.log.length;
  await f.clickNpc(crate, 1);
  for (let i = 0; i < 20 && !f.log.slice(from).some((e) => e[2] === 'You find nothing.'); i++) f.step();
  assert.ok(f.log.slice(from).some((e) => e[2] === 'You find nothing.'));
  assert.equal(f.p.getInventory().getAmount(I().FLUFFS_KITTEN), 0);
});

test('paying Shilop: the coins and the stage go as the coins box shows; Shilop gives both directions (recording 1001963, ticks 9151-9178)', async (t) => {
  const f = fixture(t, [3220, 3431, 0]);
  const shilop = f.npc(N().SHILOP, [3220, 3433, 0]);
  f.npc(N().WILOUGH, [3221, 3433, 0]);
  quest.setStage(f.p, 1);
  f.give(I().COINS, 150);
  await f.clickNpc(shilop, 1);
  await f.talk([2, 2], { stop: (line) => line[0] === 'item' });
  assert.deepEqual(f.read(), ['item', I().COINS, 'You give the lad 100 coins.']);
  assert.equal(quest.getStage(f.p), 2, 'paid as the box shows');
  assert.equal(f.p.getInventory().getAmount(I().COINS), 50);
  await f.cont();
  const lines = await f.talk();
  assert.deepEqual(lines.map((l) => [l[1], l[2]]), [
    ['player', 'There you go, now where did you see Fluffs ?'],
    [N().SHILOP, 'I play at an abandoned lumber mill to the north east. Just beyond the Jolly Boar Inn. I saw Fluffs running around in there.'],
    ['player', 'Anything else?'],
    [N().SHILOP, "Well, you'll have to find the broken fence to get in. I'm sure you can manage that."],
  ]);
  assert.equal(f.p.getInventory().getAmount(I().COINS), 50, 'once');
});

// ---------------------------------------------------------------------------------------------
// After the quest: Gertrude's kittens and the kitten's Interact menu (issue 6772)
// ---------------------------------------------------------------------------------------------

const following = (p) => { const request = { player: p, pet: null }; PM.emitCustomEvent('pets:current', request); return request.pet; };
const SOLD = 'Gertrude gives you another kitten.';
const RAISING = "Aren't you still raising that other kitten? Only once it's fully grown and it no longer needs your attention will I let you have another kitten.";
const kittenOp = (npc, p, name) => npc.getCurrentDefinition(p).getActions().findIndex((action) => action === name) + 1;

test('"Yes please." sells a kitten through her real page: the coins go and a kitten follows (issue 6772 item 6)', async (t) => {
  const f = fixture(t, [3149, 3412, 0]);
  const gertrude = f.npc(N().GERTRUDE, [3149, 3413, 0]);
  quest.setStage(f.p, 6);
  f.give(I().COINS, 150);
  await f.clickNpc(gertrude, 1);
  const lines = await f.talk([1, 1]);
  // No Ring of Charos(a): her [Charm] option is not offered.
  const menus = lines.filter((l) => l[0] === 'options').map((l) => l[1]);
  assert.deepEqual(menus[1], ['Yes please.', 'No thanks.'], JSON.stringify(menus));
  assert.deepEqual(lines.filter((l) => l[0] === 'box').map((l) => l[2]), [SOLD]);
  assert.equal(f.p.getInventory().getAmount(I().COINS), 50);
  assert.equal(following(f.p)?.getDefinition?.()?.getName?.(), 'Kitten', 'the kitten follows');
  // Raising it now, she won't sell another.
  await f.clickNpc(gertrude, 1);
  assert.ok(texts(await f.talk([1])).includes(RAISING));
  assert.equal(f.p.getInventory().getAmount(I().COINS), 50);
});

test('with the Ring of Charos(a) worn her [Charm] option is offered', async (t) => {
  const f = fixture(t, [3149, 3412, 0]);
  const gertrude = f.npc(N().GERTRUDE, [3149, 3413, 0]);
  quest.setStage(f.p, 6);
  f.give(I().COINS, 150);
  f.p.getEquipment().set(core.Equipment.RING_SLOT, new core.Item(I().RING_OF_CHAROS_A_, 1));
  await f.clickNpc(gertrude, 1);
  const lines = await f.talk([1], { stop: (l) => l[0] === 'options' && l[1].includes('Yes please.') });
  assert.deepEqual(lines.at(-1)[1], ['Yes please.', 'No thanks.', "[Charm] I'm quite fussy over cats - can I pick my own?"]);
});

test('a kitten placeholder in the bank is no kitten; a banked kitten or cat still is (issue 6772 item 5)', async (t) => {
  const f = fixture(t, [3149, 3412, 0]);
  const gertrude = f.npc(N().GERTRUDE, [3149, 3413, 0]);
  quest.setStage(f.p, 6);
  f.give(I().COINS, 300);
  const bank = f.p.getBank(0);
  bank.add(new core.Item(I().PET_KITTEN_3, 1));
  bank.delete?.(new core.Item(I().PET_KITTEN_3, 1), true);
  bank.set(0, new core.Item(I().PET_KITTEN_3, 0));
  assert.ok(bank.contains(I().PET_KITTEN_3) && bank.getAmount(I().PET_KITTEN_3) === 0, 'a placeholder');
  await f.clickNpc(gertrude, 1);
  assert.deepEqual((await f.talk([1, 1])).filter((l) => l[0] === 'box').map((l) => l[2]), [SOLD]);
  assert.ok(following(f.p));

  // A banked normal cat counts (Wiki, Gertrude); an overgrown one does not.
  const g = fixture(t, [3149, 3412, 0]);
  const other = g.npc(N().GERTRUDE, [3149, 3413, 0]);
  quest.setStage(g.p, 6);
  g.give(I().COINS, 300);
  g.p.getBank(0).add(new core.Item(I().PET_CAT_2, 1));
  await g.clickNpc(other, 1);
  assert.ok(texts(await g.talk([1])).includes(RAISING));
  g.p.getBank(0).set(0, new core.Item(core.CacheDefinitions.getObjId('overgrown_cat_white') ?? 1568, 1));
  await g.clickNpc(other, 1);
  assert.deepEqual((await g.talk([1, 1])).filter((l) => l[0] === 'box').map((l) => l[2]), [SOLD]);
});

test('her right-click Kitten option sells one without the ring, and refuses without coins or while raising one', async (t) => {
  const f = fixture(t, [3149, 3412, 0]);
  // The world's Gertrude (3500), shown after the quest as 7723 with "Kitten".
  const gertrude = f.npc(core.CacheDefinitions.getNpcId('gertrude') ?? 3500, [3149, 3413, 0]);
  quest.setStage(f.p, 6);
  const op = kittenOp(gertrude, f.p, 'Kitten');
  assert.ok(op > 0);
  f.give(I().COINS, 99);
  await f.clickNpc(gertrude, op);
  assert.deepEqual(await f.talk(), [['npc', N().GERTRUDE, "I'll want 100 coins for a kitten."]], 'with her own head and name');
  assert.equal(following(f.p), null);
  f.give(I().COINS, 1);
  await f.clickNpc(gertrude, op);
  assert.deepEqual((await f.talk()).map((l) => [l[0], l[2]]), [['box', SOLD]]);
  assert.equal(f.p.getInventory().getAmount(I().COINS), 0);
  assert.equal(following(f.p)?.getDefinition?.()?.getName?.(), 'Kitten');
  f.give(I().COINS, 100);
  await f.clickNpc(gertrude, op);
  assert.deepEqual((await f.talk()).map((l) => [l[0], l[2]]), [['npc', RAISING]]);
  assert.equal(f.p.getInventory().getAmount(I().COINS), 100);
});

/** A kitten following the player, as Gertrude hands it over. */
function kittenFollower(f) {
  PM.emitCustomEvent('pets:summon', { player: f.p, itemId: I().PET_KITTEN_2, following: false, pet: null, summoned: false });
  const kitten = following(f.p);
  assert.ok(kitten);
  kitten.setLocation(f.p.getLocation().clone().add(1, 0));
  if (!kitten.__watched) { kitten.__watched = true; }
  const say = kitten.forceChat.bind(kitten);
  kitten.forceChat = (text) => { f.log.push([f.tick(), 'npc-say', kitten.getId(), text]); return say(text); };
  const act = kitten.performAnimation.bind(kitten);
  kitten.performAnimation = (a) => { f.log.push([f.tick(), 'npc-anim', kitten.getId(), a?.getId?.()]); return act(a); };
  return kitten;
}

async function interactMenu(f, kitten) {
  await f.clickNpc(kitten, kittenOp(kitten, f.p, 'Interact'));
  for (let i = 0; i < 4 && !core.MultiChatboxPrompt.getPending(f.p); i++) f.step();
  return core.MultiChatboxPrompt.getPending(f.p);
}

test('Stroke: the message, both animations, then 3 ticks on the purr and the player\'s line (capture ticks 918-924; issue 6772 item 3)', async (t) => {
  const f = fixture(t, [3151, 3413, 0]);
  const kitten = kittenFollower(f);
  const sounds = [];
  const sound = f.p.getPacketSender().sendSoundEffect.bind(f.p.getPacketSender());
  t.mock.method(f.p.getPacketSender(), 'sendSoundEffect', (id, ...rest) => { sounds.push([f.tick(), id]); return sound(id, ...rest); });
  const menu = await interactMenu(f, kitten);
  assert.deepEqual(menu, { title: 'Interact with kitten', options: ['Stroke', 'Chase Vermin', 'Guess age', 'Shoo away'] });
  const s = f.tick();
  await f.choose(1);
  const now = f.since(s);
  assert.ok(now.some((e) => e[1] === 'sendMessage' && e[2] === 'You softly stroke your cat.'));
  assert.ok(now.some((e) => e[1] === 'player-anim' && e[2] === seq('human_pickupfloor')));
  assert.ok(now.some((e) => e[1] === 'npc-anim' && e[3] === seq('cat_rollingover')));
  assert.ok(now.some((e) => e[1] === 'sendVarbit' && e[2] === BUSY && e[3] === 1));
  assert.ok(f.p.getAttribute('pets:cat').attentionAt > Date.now(), 'the stroke still counts as attention');
  f.step(3);
  const purr = f.since(s).find((e) => e[1] === 'npc-say' && e[3] === 'Purr...purr...');
  assert.equal(purr?.[0] - s, 3);
  assert.deepEqual(sounds.map(([tick, id]) => [tick - s, id]), [[3, 340]]);
  assert.deepEqual(f.read(), ['player', 'player', 'That cat sure loves to be stroked.']);
  await f.cont();
  f.step();
  assert.equal(f.read(), null);
  assert.deepEqual(f.since(s).filter((e) => e[1] === 'sendVarbit' && e[2] === BUSY).map((e) => e[3]).at(-1), 0);
});

test('Guess age: the player wonders, then the age in a message box (capture tick 943-946; issue 6772 item 2)', async (t) => {
  const f = fixture(t, [3151, 3413, 0]);
  const kitten = kittenFollower(f);
  await interactMenu(f, kitten);
  await f.choose(3);
  assert.deepEqual(f.read(), ['player', 'player', 'I wonder how old you are...']);
  await f.cont();
  assert.deepEqual(f.read(), ['box', null, 'After taking a good look at your kitten you guess that its age is: 0 minutes. And approximate time until fully adult: 3 hours  00 minutes, assuming you look after it.']);
  await f.cont();
  f.step();
  assert.equal(f.read(), null);
  // rsprox.net 3219's later guesses: one minute in, and 1 hour 13 minutes in.
  const { ageText } = require('../plugins/npcs/pets/CatInteract.Pets')._test;
  assert.match(ageText({ growth: 1 }), /its age is: 1 minute\. And approximate time until fully adult: 2 hours 58 minutes,/);
  assert.match(ageText({ growth: 49 }), /its age is: 1 hour 13 minutes\. And approximate time until fully adult: 1 hour 46 minutes,/);
});

test('Shoo away asks first: "No I\'m not." keeps the kitten, "Yes I am." shoos it off a tick later (capture tick 952-956, 3219 tick 23993-24008; issue 6772 item 4)', async (t) => {
  const f = fixture(t, [3151, 3413, 0]);
  const kitten = kittenFollower(f);
  await interactMenu(f, kitten);
  await f.choose(4);
  assert.deepEqual(core.MultiChatboxPrompt.getPending(f.p), { title: 'Are you sure you want to shoo away the cat?', options: ['Yes I am.', "No I'm not."] });
  assert.equal(following(f.p), kitten, 'still following while it asks');
  const s = f.tick();
  await f.choose(2);
  assert.ok(f.since(s).some((e) => e[1] === 'sendTypedMessage' && e[2] === core.ChatType.SPAM && e[3] === 'You choose not to shoo away the cat.'));
  assert.equal(following(f.p), kitten);

  await interactMenu(f, kitten);
  await f.choose(4);
  const y = f.tick();
  await f.choose(1);
  assert.ok(f.since(y).some((e) => e[1] === 'player-say' && e[2] === 'Shoo cat!'));
  assert.equal(following(f.p), kitten, 'gone a tick later');
  f.step();
  const ran = f.since(y).find((e) => e[1] === 'sendMessage' && e[2] === 'The cat has run away.');
  assert.equal(ran?.[0] - y, 1);
  assert.ok(f.since(y).some((e) => e[1] === 'npc-say' && e[3] === 'Meeeooow!'));
  assert.equal(following(f.p), null);
  assert.equal(f.p.getAttribute('pets:cat'), null);
});

test('a walk away from the stroke\'s line or the age box still clears BUSY', async (t) => {
  const f = fixture(t, [3151, 3413, 0]);
  const kitten = kittenFollower(f);
  for (const option of [1, 3]) {
    await interactMenu(f, kitten);
    const s = f.tick();
    await f.choose(option);
    f.step(option === 1 ? 3 : 0);
    assert.ok(f.read(), 'a line is open');
    await f.send({ type: 'move', worldX: 3151, worldY: 3416, modifierFlags: 0, run: false });
    assert.equal(f.read(), null, 'the walk closes it');
    f.step(2);
    assert.equal(f.since(s).filter((e) => e[1] === 'sendVarbit' && e[2] === BUSY).map((e) => e[3]).at(-1), 0);
  }
});
