// Ghosts Ahoy against the user's revision 242 capture (20261112T092603-5ab63b4; facts by tick
// in docs/quests/ghosts-ahoy/README.md), played through the real plugins, dialogue engine,
// cache and map: the crone's tea and hand-in, Runedraw, the villagers, the Ghost captain, the
// tomb, the shipwreck and the save conversion.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');

let core, quest, quests, started = false, serial = 0;
const players = [], npcs = [];
const lines = new WeakMap(), varbits = new WeakMap(), messages = new WeakMap();
const previousBots = process.env.DISABLE_PLAYER_BOTS;
const STATE = require('../plugins/quests/ghostsahoy/State.GhostsAhoy');
const Runedraw = require('../plugins/quests/ghostsahoy/Runedraw.GhostsAhoy');
const Shipwreck = require('../plugins/quests/ghostsahoy/Shipwreck.GhostsAhoy');

function attempt(errors, fn) { try { fn(); } catch (error) { errors.push(error); } }

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  for (const [x, y] of [[3678, 3510], [3610, 3545], [3461, 3555], [3792, 3559]]) core.RegionManager.loadMapFiles(x, y);
  new NpcDefinitionLoader().load();
  started = true;
  PluginManager.emitServerStartup({});
  quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
  quest = quests.filter((q) => q.key === 'ghosts_ahoy').at(-1);
  const api = PluginManager.createApi('GhostsCaptureObserver');
  api.onCustomEvent('npc-dialogue:line', (e) => { if (lines.has(e.player)) lines.get(e.player).push(e.text); });
});

after(() => {
  const errors = [];
  try {
    for (const p of players) {
      attempt(errors, () => { if (p.isRegistered()) PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() }); });
      attempt(errors, () => core.TaskManager.cancelTasks(p));
      attempt(errors, () => { if (p.isRegistered()) core.World.getPlayers().remove(p); });
    }
    for (const npc of npcs) attempt(errors, () => { if (npc.isRegistered()) PluginManager.removeNpc(npc); });
  } finally {
    attempt(errors, () => { if (started) PluginManager.emitServerShutdown({}); });
    if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = previousBots;
  }
  if (errors.length) throw new AggregateError(errors, 'fixture cleanup failed');
});

const I = () => core.ItemIdentifiers;

function actor(t, { x = 3678, y = 3510, z = 0, stage = 0, amulet = true, animalMagnetism = false } = {}) {
  const channel = { kind: 'test', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session, new core.Location(x, y, z));
  session.setPlayer(p);
  p.setUsername(`ghostcap${++serial}`);
  p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  t.mock.method(p, 'onAdd', () => {});
  t.mock.method(p, 'onRemove', () => {});
  const sent = [];
  varbits.set(p, sent);
  const sender = p.getPacketSender();
  const sendVarbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, 'sendVarbit', (id, value) => { sent.push([id, value]); return sendVarbit(id, value); });
  const said = [];
  messages.set(p, said);
  const send = p.sendMessage.bind(p);
  t.mock.method(p, 'sendMessage', (m) => { said.push(m); return send(m); });
  const typed = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, 'sendTypedMessage', (type, m, from) => { said.push(m); return typed(type, m, from); });
  lines.set(p, []);
  players.push(p);
  assert.equal(core.World.getPlayers().add(p), true);
  p.setAttribute('bot-skip-persistence', true);
  for (const key of ['priest_in_peril', 'the_restless_ghost']) {
    const prerequisite = quests.filter((q) => q.key === key).at(-1);
    prerequisite.setStage(p, prerequisite.completionValue);
  }
  if (animalMagnetism) {
    const am = quests.filter((q) => q.key === 'animal_magnetism').at(-1);
    am.setStage(p, am.completionValue);
  }
  if (stage) quest.setStage(p, stage);
  if (amulet) p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I().GHOSTSPEAK_AMULET));
  t.after(() => {
    const errors = [];
    attempt(errors, () => p.getPacketSender().sendInterfaceRemoval());
    attempt(errors, () => p.getDialogueManager().reset());
    attempt(errors, () => { if (p.isRegistered()) PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() }); });
    attempt(errors, () => core.TaskManager.cancelTasks(p));
    attempt(errors, () => { if (p.isRegistered()) core.World.getPlayers().remove(p); });
    if (errors.length) throw new AggregateError(errors, 'actor cleanup failed');
  });
  return p;
}

function give(p, id, amount = 1) {
  p.getInventory().add(new core.Item(id, amount), false);
  assert.ok(p.getInventory().getAmount(id) >= amount);
}

function spawn(t, id, x, y, z = 0) {
  const npc = core.NPC.create(id, new core.Location(x, y, z));
  assert.equal(core.World.getNpcs().add(npc), true);
  npcs.push(npc);
  t.after(() => { if (npc.isRegistered()) PluginManager.removeNpc(npc); });
  return npc;
}

function tick(n = 1) {
  for (let i = 0; i < n; i++) core.World.process();
}

/**
 * Plays the open conversation through: continues every page, picks each menu option from
 * `choices` in order (a menu with no choice left stops it). Returns what was shown, in order:
 * { kind: 'item' | 'statement' | 'menu', text, itemId, options }.
 */
function play(p, choices = []) {
  const shown = [];
  const manager = p.getDialogueManager();
  for (let i = 0; i < 300; i++) {
    const pending = core.MultiChatboxPrompt.getPending(p);
    if (pending) {
      shown.push({ kind: 'menu', text: pending.title, options: pending.options });
      if (!choices.length) return shown;
      const choice = choices.shift();
      const index = pending.options.indexOf(choice);
      assert.ok(index >= 0, `${choice} in ${JSON.stringify(pending.options)}`);
      PluginManager.emitInterfaceActionClick({ player: p, groupId: 219, childId: 1, buttonId: (219 << 16) | 1, slot: index + 1, action: 1, handled: false });
      continue;
    }
    if (!manager.isActive()) return shown;
    const current = manager.getCurrent();
    if (current instanceof core.ItemStatementDialogue) shown.push({ kind: 'item', itemId: current.getItemId(), text: current.getText() });
    else if (current instanceof core.StatementDialogue) shown.push({ kind: 'statement', text: current.getText() });
    if (current instanceof core.ActionDialogue && current.isSelfAdvancing()) tick();
    else manager.advance();
  }
  return shown;
}

function talk(p, npc) {
  const definition = npc.getCurrentDefinition(p);
  const clickType = definition.getActions().indexOf('Talk-to') + 1;
  assert.ok(clickType > 0, `${definition.getName()} has Talk-to`);
  return PluginManager.emitNpcInteraction({ player: p, npc, npcId: npc.getContentId(p), definition, clickType, handled: false });
}

function useItemOnItem(p, used, withItem) {
  const items = p.getInventory().getItems();
  const a = items.findIndex((item) => item?.getId() === used);
  const b = items.findIndex((item) => item?.getId() === withItem);
  return PluginManager.emitItemOnItem({ player: p, usedItem: items[a], usedItemId: used, usedItemSlot: a, usedWithItem: items[b], usedWithItemId: withItem, usedWithItemSlot: b, handled: false });
}

function objectAt(id, x, y, z) {
  const location = new core.Location(x, y, z);
  const object = core.MapObjects.get(id, location, null);
  assert.ok(object, `loc ${id} at ${x},${y},${z}`);
  return object;
}

function clickObject(p, object, option) {
  const definition = object.getDefinition();
  const clickType = definition.getInteractions().indexOf(option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} has ${option}: ${JSON.stringify(definition.getInteractions())}`);
  const at = object.getLocation();
  return PluginManager.emitObjectInteraction({ player: p, object, objectId: object.getId(), definition, clickType, location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false });
}

const lastVarbit = (p, id) => (varbits.get(p).filter(([v]) => v === id).at(-1) ?? [])[1];
const has = (p, id) => p.getInventory().getAmount(id) > 0;

test('the Old crone hands over her cup and drinks the milky tea in one talk each (issue 4166)', (t) => {
  const p = actor(t, { x: 3463, y: 3557, stage: 3 });
  const crone = spawn(t, core.NpcIdentifiers.OLD_CRONE, 3464, 3558);
  give(p, I().NETTLE_TEA);
  assert.equal(talk(p, crone), true);
  const first = play(p);
  // Ticks 357-365: the asking, the tea, the cup in an item box.
  assert.deepEqual(lines.get(p).slice(0, 5), [
    'Were you once a disciple of Necrovarus in the Temple of Phasmatys, old woman?',
    "I don't remember; I am so old and my memory goes back only so far...",
    'Is there anything that can help to refresh your memory?',
    'Yes, I would love a nice hot cup of nettle tea.',
    "Here's some tea for you, like you asked.",
  ]);
  assert.deepEqual(first.find((s) => s.kind === 'item'), { kind: 'item', itemId: I().PORCELAIN_CUP, text: 'The old crone gives you her special cup.' });
  assert.ok(has(p, I().PORCELAIN_CUP));
  assert.deepEqual(varbits.get(p).filter(([id]) => id === STATE.VARBIT.NETTLE_TEA).map(([, v]) => v), [1, 2]);
  assert.equal(quest.getStage(p), 3);

  // Ticks 373-383: the tea into her cup, then the milk.
  assert.equal(useItemOnItem(p, I().NETTLE_TEA, I().PORCELAIN_CUP), true);
  assert.ok(has(p, I().CUP_OF_TEA_6) && has(p, I().BOWL) && !has(p, I().PORCELAIN_CUP));
  give(p, I().BUCKET_OF_MILK);
  assert.equal(useItemOnItem(p, I().CUP_OF_TEA_6, I().BUCKET_OF_MILK), true);
  assert.ok(has(p, I().CUP_OF_TEA_7) && has(p, I().BUCKET));

  lines.set(p, []);
  assert.equal(talk(p, crone), true);
  const second = play(p);
  // Tick 409: the questvar moves as the player offers the cup; the box follows (411).
  assert.equal(quest.getStage(p), 4);
  assert.equal(lastVarbit(p, 217), 4);
  assert.equal(lastVarbit(p, STATE.VARBIT.NETTLE_TEA), 3);
  assert.ok(!has(p, I().CUP_OF_TEA_7));
  assert.ok(lines.get(p).includes("Here's a lovely cup of milky tea for you, in your own special cup."));
  assert.deepEqual(second.find((s) => s.kind === 'statement')?.text, 'As the old woman drinks the cup of milky tea, enlightenment glows from within her eyes.');
  // Worn amulet: only "Yes, I'm wearing one right now." (448), and the translation page before her menu (452).
  assert.ok(lines.get(p).includes("Yes, I'm wearing one right now."));
  assert.ok(!lines.get(p).includes("No I don't, I'm afraid."));
  const menu = second.find((s) => s.kind === 'menu');
  assert.equal(lines.get(p).at(-1), 'I cannot read the strange letters of the eastern lands. I will need something to help me translate the book.');
  assert.deepEqual(menu.options, [
    'You are doing so much for me - is there anything I can do for you?',
    'Remind me - what can I do about Necrovarus?',
    'What did you want me to get for you?',
    'I\'ll go and search for those items you asked for.',
  ]);
  // The son's story and the toy boat (455-459), shown with the repaired boat's model.
  const story = play(p, ['You are doing so much for me - is there anything I can do for you?']);
  assert.deepEqual(story.find((s) => s.kind === 'item'), { kind: 'item', itemId: I().MODEL_SHIP_2, text: 'The old woman gives you a toy boat.' });
  assert.ok(has(p, I().MODEL_SHIP));
  assert.equal(lastVarbit(p, STATE.VARBIT.TOY_BOAT), 1);

  // Again (470-490): her "not found your son" menu.
  assert.equal(talk(p, crone), true);
  assert.deepEqual(play(p).find((s) => s.kind === 'menu').options[0], 'I am afraid I have not found your son yet.');
});

test('with Animal Magnetism done the crone asks Necrovarus or the farmers first (ticks 346-353)', (t) => {
  const p = actor(t, { x: 3463, y: 3557, stage: 3, animalMagnetism: true });
  const crone = spawn(t, core.NpcIdentifiers.OLD_CRONE, 3464, 3558);
  assert.equal(talk(p, crone), true);
  const shown = play(p);
  assert.deepEqual(shown[0].options, ["I'm here about Necrovarus.", "I'm here about the farmers east of here."]);
  play(p, ["I'm here about the farmers east of here."]);
  assert.ok(lines.get(p).includes('Hello there, just dropping in to thank you again. It all went perfectly. Alice and Malcolm can communicate again.'));
  assert.equal(talk(p, crone), true);
  play(p);
  lines.set(p, []);
  play(p, ["I'm here about Necrovarus."]);
  assert.deepEqual(lines.get(p).slice(0, 3), [
    "I'm here about Necrovarus.",
    'Were you once a disciple of Necrovarus in the Temple of Phasmatys, old woman?',
    "I don't remember; I am so old and my memory goes back only so far...",
  ]);
});

test('the robes, book and manual go in one talk and the amulet glows three ticks after the ritual (ticks 1798-1808)', (t) => {
  const p = actor(t, { x: 3463, y: 3557, stage: 4 });
  const crone = spawn(t, core.NpcIdentifiers.OLD_CRONE, 3464, 3558);
  for (const id of [I().MYSTICAL_ROBES, I().BOOK_OF_HARICANTO, I().TRANSLATION_MANUAL]) give(p, id);
  assert.equal(talk(p, crone), true);
  const shown = play(p);
  assert.deepEqual(lines.get(p), [
    'I have something for you.',
    'Good - the robes of Necrovarus.',
    'The Book of Haricanto! I have no idea how you came by this, but well done!!',
    'A translation manual - yes, this should do the job.',
    "Wonderful; that's everything I need.",
    'I will now perform the ritual of enchantment.',
  ]);
  for (const id of [I().MYSTICAL_ROBES, I().BOOK_OF_HARICANTO, I().TRANSLATION_MANUAL]) assert.ok(!has(p, id));
  for (const varbit of [STATE.VARBIT.GIVEN_ROBES, STATE.VARBIT.GIVEN_BOOK, STATE.VARBIT.GIVEN_MANUAL]) assert.equal(lastVarbit(p, varbit), 1);
  assert.equal(quest.getStage(p), 5);
  assert.equal(shown.filter((s) => s.kind === 'item').length, 0, 'no box until the ritual is done');
  assert.equal(p.getDialogueManager().isActive(), false, 'the chat closes for the ritual');
  tick(2);
  assert.equal(quest.getStage(p), 5);
  tick(1);
  assert.equal(quest.getStage(p), 6);
  assert.equal(p.getEquipment().get(core.Equipment.AMULET_SLOT).getId(), I().GHOSTSPEAK_AMULET_2);
  const current = p.getDialogueManager().getCurrent();
  assert.ok(current instanceof core.ItemStatementDialogue);
  assert.equal(current.getText(), 'The ghostspeak amulet emits a green glow from its gem.');
});

test('Runedraw: the board, Robin\'s draws, the wins that move the bow and the signing (ticks 1226-1415)', async (t) => {
  const p = actor(t, { x: 3672, y: 3492, stage: 4 });
  const robin = spawn(t, core.NpcIdentifiers.ROBIN, 3671, 3492);
  STATE.set(p, STATE.VARBIT.BOW, 1);
  give(p, I().OAK_LONGBOW);
  give(p, I().COINS, 1000);
  const R = Runedraw._test;
  const rune = (name) => R.bagContents().find((r) => r.id === I()[name]);
  R.setRobinDelay(() => 2);
  t.after(() => R.setRobinDelay(() => 2 + Math.floor(Math.random() * 3)));

  await t.test('the autograph request and a loss with nothing owed', () => {
    R.setShuffle(() => [rune('AIR_RUNE'), rune('COSMIC_RUNE'), rune('DEATH_RUNE'), rune('MIND_RUNE')]);
    assert.equal(talk(p, robin), true);
    play(p);
    assert.deepEqual(lines.get(p).slice(0, 3), [
      'Would you sign this oak longbow for me?',
      "I'm sorry, I don't sign autographs.",
      "While you're here, though, why don't you have a game of Runedraw with me? If you've got 25 gold pieces I've got a bag of runes we can use.",
    ]);
    play(p, ["Yes, I'll give you a game."]);
    assert.equal(p.getInventory().getAmount(I().COINS), 975);
    assert.equal(lastVarbit(p, STATE.VARBIT.BOW), 2);
    assert.equal(p.getInterfaceId(), core.CacheDefinitions.getInterfaceId('ahoy_runedraw'));
    const draw = core.CacheDefinitions.getComponentId('ahoy_runedraw:runedraw_btn_draw');
    PluginManager.emitInterfaceActionClick({ player: p, buttonId: draw, action: 1, handled: false });
    tick(2); // Robin's cosmic
    PluginManager.emitInterfaceActionClick({ player: p, buttonId: draw, action: 1, handled: false });
    assert.ok(messages.get(p).includes("You've lost the game of Runedraw."));
    // Closing the board starts Robin's reply (tick 1263).
    lines.set(p, []);
    p.getPacketSender().sendInterfaceRemoval();
    const shown = play(p);
    assert.deepEqual(lines.get(p).slice(0, 2), ['Well done, you beat me.', 'How about another game?']);
    assert.deepEqual(shown.at(-1).options, ["Yes, I'll give you a game.", 'How do you play Runedraw?', "No, that doesn't sound fun."]);
    play(p, ["No, that doesn't sound fun."]);
    // Talking again after the loss opens with it (1274).
    lines.set(p, []);
    assert.equal(talk(p, robin), true);
    play(p);
    assert.equal(lines.get(p)[0], 'Well done, you beat me.');
    p.getPacketSender().sendInterfaceRemoval();
  });

  await t.test('four wins: each moves the bow, then the 100 coins and the signed bow', () => {
    R.setShuffle(() => [rune('FIRE_RUNE'), rune('DEATH_RUNE'), rune('AIR_RUNE')]);
    const expected = [25, 50, 75];
    for (let game = 0; game < 4; game++) {
      lines.set(p, []);
      assert.equal(talk(p, robin), true);
      play(p, game === 0 ? ["Yes, I'll give you a game."] : []);
      if (game > 0) play(p, ["Yes, I'll give you a game."]);
      const draw = core.CacheDefinitions.getComponentId('ahoy_runedraw:runedraw_btn_draw');
      PluginManager.emitInterfaceActionClick({ player: p, buttonId: draw, action: 1, handled: false });
      tick(2); // Robin draws death
      assert.equal(lastVarbit(p, STATE.VARBIT.BOW), 3 + game);
      lines.set(p, []);
      p.getPacketSender().sendInterfaceRemoval();
      const shown = play(p);
      if (game < 3) {
        assert.equal(lines.get(p)[0], `So are you going to pay up then? You owe me ${expected[game]} gold coins!`);
        assert.equal(shown.at(-1).options.at(-1), "No, you didn't pay up the last time you lost.");
        play(p, ["No, you didn't pay up the last time you lost."]);
      } else {
        assert.equal(lines.get(p)[0], "I've had enough of you not paying up - you owe me 100 gold coins. I'm going to tell the ghosts what you're doing.");
        assert.deepEqual(shown.find((s) => s.kind === 'item'), { kind: 'item', itemId: I().SIGNED_OAK_BOW, text: 'Robin signs the oak longbow for you.' });
      }
    }
    assert.ok(has(p, I().SIGNED_OAK_BOW) && !has(p, I().OAK_LONGBOW));
    assert.equal(lastVarbit(p, STATE.VARBIT.BOW), 7);
    assert.equal(p.getInventory().getAmount(I().COINS), 975 - 4 * 25);
  });
});

test('villagers: a ghost asked once has had its say, the bribe is 2 and the tenth signature has its own box', (t) => {
  const p = actor(t, { x: 3661, y: 3497, stage: 4 });
  p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I().BEDSHEET_2));
  give(p, I().PETITION_FORM);
  give(p, I().ECTO_TOKEN, 20);
  STATE.set(p, STATE.VARBIT.SIGNATURES, STATE.SIGNATURES_FORM + 9);
  const ghost = spawn(t, core.NpcIdentifiers.GHOST_VILLAGER, 3662, 3497);
  let shown = [];
  for (let i = 0; i < 40 && lastVarbit(p, STATE.VARBIT.SIGNATURES) !== STATE.SIGNATURES_FULL; i++) {
    lines.set(p, []);
    const fresh = spawn(t, core.NpcIdentifiers.GHOST_VILLAGER, 3662, 3497);
    talk(p, fresh);
    shown = play(p, ['Okay, if you insist.']);
    if (lines.get(p).some((line) => /cost you/.test(line))) assert.ok(lines.get(p).includes("Oh, it'll cost you 2 ecto-tokens."));
  }
  assert.equal(lastVarbit(p, STATE.VARBIT.SIGNATURES), STATE.SIGNATURES_FULL);
  assert.deepEqual(shown.find((s) => s.kind === 'item'), { kind: 'item', itemId: I().PETITION_FORM, text: 'You have succeeded in obtaining 10 signatures on the petition form!' });
  // A ghost who has already answered (1540-1544).
  STATE.set(p, STATE.VARBIT.SIGNATURES, STATE.SIGNATURES_FORM + 3);
  lines.set(p, []);
  talk(p, ghost);
  play(p, ['Okay, if you insist.']);
  lines.set(p, []);
  talk(p, ghost);
  play(p);
  assert.deepEqual(lines.get(p), ['Would you sign this petition form, please?', "You only just asked me the same thing! Leave me alone - I've had my say!"]);
});

test('the Ghost captain sails with the captured fade, fare and landing (ticks 1110-1167)', (t) => {
  const p = actor(t, { x: 3702, y: 3487, stage: 4 });
  give(p, I().ECTO_TOKEN, 39);
  const captain = spawn(t, core.NpcIdentifiers.GHOST_CAPTAIN, 3703, 3487);
  const definition = captain.getCurrentDefinition(p);
  const travel = definition.getActions().indexOf('Travel') + 1;
  assert.ok(travel > 0);
  const mounts = [];
  const sender = p.getPacketSender();
  const mount = sender.mountSubInterface.bind(sender);
  t.mock.method(sender, 'mountSubInterface', (uid, group, type, options) => { mounts.push([group, options?.postScripts?.[0]?.args]); return mount(uid, group, type, options); });
  assert.equal(PluginManager.emitNpcInteraction({ player: p, npc: captain, npcId: 3005, definition, clickType: travel, handled: false }), true);
  assert.equal(p.getInventory().getAmount(I().ECTO_TOKEN), 14);
  assert.deepEqual(mounts[0], [174, [0, 255, 0, 0, 50]]);
  tick(3);
  assert.equal(p.getLocation().getX(), 3702);
  tick(1);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3792, 3559]);
  tick(1);
  assert.deepEqual(mounts[1], [174, [0, 0, 0, 255, 50]]);
  tick(2);
  // And back, free.
  assert.equal(PluginManager.emitNpcInteraction({ player: p, npc: captain, npcId: 3005, definition, clickType: travel, handled: false }), true);
  tick(4);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3702, 3487]);
  assert.equal(p.getInventory().getAmount(I().ECTO_TOKEN), 14);
  tick(3);
});

test('the tomb: the disciple at the locked door, the bone key kept, the coffin\'s robes (ticks 1668-1705)', (t) => {
  const p = actor(t, { x: 3655, y: 3514, z: 1, stage: 4 });
  spawn(t, core.NpcIdentifiers.GHOST_DISCIPLE, 3655, 3520, 1);
  const door = objectAt(core.ObjectIdentifiers.DOOR_144, 3656, 3514, 1);
  clickObject(p, door, 'Open');
  play(p);
  assert.deepEqual(lines.get(p), [
    'What are you doing going in there?',
    'Err, I was just curious...',
    'Inside that room is a coffin, inside which lie the mortal remains of our most glorious master, Necrovarus. None may enter.',
  ]);
  give(p, I().BONE_KEY_2);
  const items = p.getInventory().getItems();
  const slot = items.findIndex((item) => item?.getId() === I().BONE_KEY_2);
  const at = door.getLocation();
  PluginManager.emitItemOnObject({ player: p, item: items[slot], itemId: I().BONE_KEY_2, itemSlot: slot, object: door, objectId: door.getId(), interfaceType: 0, location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false });
  assert.ok(messages.get(p).includes('You unlock the door.'));
  assert.equal(lastVarbit(p, STATE.VARBIT.TEMPLE_DOOR), 1);
  assert.ok(has(p, I().BONE_KEY_2), 'the key is kept (tick 1689)');
  lines.set(p, []);
  clickObject(p, door, 'Open');
  assert.deepEqual(lines.get(p), [], 'no disciple once unlocked');
  tick(3);

  p.setLocation(new core.Location(3658, 3513, 1));
  const coffin = objectAt(core.ObjectIdentifiers.COFFIN_14, 3659, 3513, 1);
  clickObject(p, coffin, 'Open');
  assert.ok(messages.get(p).includes('The coffin creaks open...'));
  const open = objectAt(core.ObjectIdentifiers.COFFIN_15, 3659, 3513, 1);
  clickObject(p, open, 'Search');
  const shown = play(p);
  assert.deepEqual(shown[0], { kind: 'item', itemId: I().MYSTICAL_ROBES, text: 'You take the Robes of Necrovarus from the remains of his mortal body.' });
  assert.ok(has(p, I().MYSTICAL_ROBES));
  assert.ok(messages.get(p).includes('Nothing interesting happens.'));
  clickObject(p, objectAt(core.ObjectIdentifiers.COFFIN_15, 3659, 3513, 1), 'Close');
  assert.ok(messages.get(p).includes('You close the coffin.'));
  assert.ok(core.MapObjects.get(core.ObjectIdentifiers.COFFIN_14, new core.Location(3659, 3513, 1), null));
});

test('the shipwreck: the lobster guards its chest, the office chest unlocks with the key, the mast needs a low wind', (t) => {
  const p = actor(t, { x: 3617, y: 3542, stage: 4 });
  // The guarded chest (581-617).
  clickObject(p, objectAt(core.ObjectIdentifiers.CLOSED_CHEST_29, 3618, 3542, 0), 'Open');
  tick(1);
  const chest = objectAt(core.ObjectIdentifiers.OPEN_CHEST_25, 3618, 3542, 0);
  clickObject(p, chest, 'Search');
  assert.ok(messages.get(p).includes('You are attacked by a giant lobster!!'));
  const lobster = Shipwreck._test.lobsters.get(p);
  assert.ok(lobster && lobster.getId() === core.NpcIdentifiers.GIANT_LOBSTER);
  PluginManager.emitNpcDeath({ killer: p, npc: lobster, npcId: lobster.getId(), location: { x: 3616, y: 3543, z: 0 } });
  assert.equal(lastVarbit(p, STATE.VARBIT.LOBSTER), 1);
  clickObject(p, chest, 'Search');
  assert.deepEqual(play(p)[0], { kind: 'item', itemId: I().MAP_SCRAP_2, text: 'You find a piece of a map inside the chest.' });
  clickObject(p, chest, 'Search');
  assert.equal(messages.get(p).at(-1), 'You search the chest but find nothing.');

  // The office chest (906-923).
  p.setLocation(new core.Location(3618, 3545, 1));
  const locked = objectAt(core.ObjectIdentifiers.CLOSED_CHEST_28, 3619, 3545, 1);
  clickObject(p, locked, 'Open');
  assert.equal(messages.get(p).at(-1), 'The chest is locked.');
  STATE.set(p, STATE.VARBIT.TOY_BOAT, 2);
  give(p, I().CHEST_KEY_4);
  const items = p.getInventory().getItems();
  const slot = items.findIndex((item) => item?.getId() === I().CHEST_KEY_4);
  PluginManager.emitItemOnObject({ player: p, item: items[slot], itemId: I().CHEST_KEY_4, itemSlot: slot, object: locked, objectId: locked.getId(), interfaceType: 0, location: { x: 3619, y: 3545, z: 1 }, handled: false });
  assert.deepEqual(play(p)[0], { kind: 'item', itemId: I().CHEST_KEY_4, text: 'You unlock the chest.' });
  assert.equal(lastVarbit(p, STATE.VARBIT.TOY_BOAT), 3);
  clickObject(p, objectAt(core.ObjectIdentifiers.CLOSED_CHEST_28, 3619, 3545, 1), 'Open');
  assert.deepEqual(play(p)[0], { kind: 'item', itemId: I().MAP_SCRAP, text: 'You find a piece of a map inside the chest.' });
  assert.equal(messages.get(p).at(-1), 'You search the chest but find nothing.');
  assert.ok(core.MapObjects.get(core.ObjectIdentifiers.CLOSED_CHEST_28, new core.Location(3619, 3545, 1), null), 'shut again');

  // The mast (634-724): nothing to see in a high wind, one part in a low one.
  p.setLocation(new core.Location(3618, 3543, 2));
  PluginManager.updatePlayerZones(p);
  assert.ok(Shipwreck._test.windy.has(p), 'the top deck shows the wind');
  const mast = objectAt(core.ObjectIdentifiers.MAST_6, 3619, 3543, 2);
  Shipwreck._test.windy.get(p).low = false;
  clickObject(p, mast, 'Search');
  assert.equal(play(p)[0].text, 'You can see a tattered flag blowing in the wind.<br>The wind is blowing too hard to make out any details.');
  Shipwreck._test.windy.get(p).low = true;
  clickObject(p, mast, 'Search');
  assert.match(play(p)[0].text, /^You can see a tattered flag blowing in the wind\.<br>The (top half of the flag|bottom half of the flag|skull emblem) is coloured (red|yellow|blue|orange|green|purple)\.$/);
  p.setLocation(new core.Location(3614, 3541, 1));
  PluginManager.updatePlayerZones(p);
  assert.ok(!Shipwreck._test.windy.has(p), 'the overlay goes with the deck');
});

test('Necrovarus burns the full petition and drops the bone key at the player\'s feet (ticks 1634-1648)', (t) => {
  const p = actor(t, { x: 3660, y: 3516, stage: 4 });
  const necrovarus = spawn(t, core.NpcIdentifiers.NECROVARUS, 3660, 3515);
  give(p, I().PETITION_FORM);
  STATE.set(p, STATE.VARBIT.SIGNATURES, STATE.SIGNATURES_FULL);
  talk(p, necrovarus);
  const shown = play(p);
  assert.deepEqual(shown.filter((s) => s.kind === 'statement').map((s) => s.text), [
    'The petition form turns to ashes in your hand.',
    'In his rage, Necrovarus drops a key on the floor.',
  ]);
  assert.ok(has(p, I().ASHES) && !has(p, I().PETITION_FORM));
  assert.equal(lastVarbit(p, STATE.VARBIT.SIGNATURES), STATE.SIGNATURES_BURNED);
  assert.ok(!has(p, I().BONE_KEY_2), 'the key is on the floor, not in the pack');
});

test('commanding Necrovarus and Velorina\'s thanks complete the quest as live does (ticks 1934-1973)', (t) => {
  const p = actor(t, { x: 3660, y: 3516, stage: 6, amulet: false });
  p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I().GHOSTSPEAK_AMULET_2));
  const necrovarus = spawn(t, core.NpcIdentifiers.NECROVARUS, 3660, 3515);
  talk(p, necrovarus);
  const shown = play(p, ['Let any ghost who so wishes pass on into the next world.']);
  assert.deepEqual(shown.find((s) => s.kind === 'menu').text, 'What do you want to command Necrovarus to do?');
  assert.equal(shown.find((s) => s.kind === 'item').itemId, I().GHOSTSPEAK_AMULET_2);
  assert.equal(quest.getStage(p), 7);
  assert.equal(p.getEquipment().get(core.Equipment.AMULET_SLOT).getId(), I().GHOSTSPEAK_AMULET);

  const velorina = spawn(t, core.NpcIdentifiers.VELORINA, 3678, 3510);
  p.setLocation(new core.Location(3678, 3511, 0));
  lines.set(p, []);
  talk(p, velorina);
  const thanks = play(p);
  assert.deepEqual(thanks.find((s) => s.kind === 'item'), { kind: 'item', itemId: I().ECTOPHIAL, text: 'Velorina gives you a vial of bright green ectoplasm.' });
  assert.ok(lines.get(p)[0].endsWith('- I sensed the removal of Necrovarus\'s psychic barrier!'));
  assert.equal(quest.getStage(p), 8);
  assert.equal(lastVarbit(p, 217), 8);
  assert.ok(has(p, I().ECTOPHIAL));
  assert.ok(messages.get(p).some((m) => m.startsWith("Congratulations, you've completed a quest:")));
});

test('a save from before the varbits keeps its progress', (t) => {
  const p = actor(t, { stage: 4 });
  p.setAttribute(STATE.LEGACY.bow, 7);
  p.setAttribute(STATE.LEGACY.toy, 2);
  p.setAttribute(STATE.LEGACY.signatures, 4);
  p.setAttribute(STATE.LEGACY.givenBook, 1);
  p.setAttribute(STATE.LEGACY.tomb, 1);
  p.setAttribute(STATE.LEGACY.toyTop, 4);
  PluginManager.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.equal(STATE.get(p, STATE.VARBIT.BOW), 7);
  assert.equal(STATE.get(p, STATE.VARBIT.TOY_BOAT), 2);
  assert.equal(STATE.get(p, STATE.VARBIT.SIGNATURES), STATE.SIGNATURES_FORM + 4);
  assert.equal(STATE.get(p, STATE.VARBIT.GIVEN_BOOK), 1);
  assert.equal(STATE.get(p, STATE.VARBIT.TEMPLE_DOOR), 1);
  assert.deepEqual(STATE.flag(p, STATE.TOY_FLAG_ATTRIBUTE), [4, 0, 0]);
  assert.equal(p.getAttribute(STATE.LEGACY.bow), undefined);
  assert.equal(lastVarbit(p, STATE.VARBIT.BOW), 7);
  assert.equal(lastVarbit(p, 217), 4);
});
