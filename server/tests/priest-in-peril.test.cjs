// Priest in Peril route contract. From server/: node --test tests/priest-in-peril.test.cjs
// Dispatches the plugin's registered handlers from a fresh stage 0 through completion and
// checks varp 302 against live OSRS's values (Quest Helper's PriestInPeril steps). It proves
// the handler contracts and the wire mapping, not a natural playthrough.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require(root + '/dist/plugins/PluginManager');
const { Player } = require(root + '/dist/game/entity/impl/player/Player');
const { PlayerSession } = require(root + '/dist/net/PlayerSession');
const { ClientConnection } = require(root + '/dist/net/NetworkBuilder');
const { encodeWidgetCloseSub, encodeWidgetOpenSub, encodeWidgetSetItem, encodeWidgetSetText } =
  require(root + '/dist/net/protocol/ClientProtocol');

require('node:test').before(async () => {
  await require(root + '/dist/game/cache/CachePipeline').CachePipeline.initialize(root);
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3427, 9894);
  require(root + '/plugins/quests/quests/PriestInPeril.Quest')(
    PluginManager.createApi('native-priest-in-peril-test')
  );
});

const core = require(root + '/dist/plugins/PluginManager').PluginManager.getCoreApi();
const runtime = require(root + '/plugins/quests/QuestRuntime');
const noop = () => {};

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;
const VARP = 302;
const STAGE = 'quest.priest_in_peril.stage';
const MONUMENT_WINDOW = 272;
const MONUMENT_WINDOW_TEXT_UID = (MONUMENT_WINDOW << 16) | 7;
const MONUMENT_WINDOW_ITEM_UID = (MONUMENT_WINDOW << 16) | 8;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const CHATBOX_MODAL_TARGET_UID = (162 << 16) | 568;

// The plugin destructures these at registration: record what it plays instead of
// running the transcript runtime.
const played = [];
runtime.startTranscript = (_api, player, npcId, page, variant, select) => {
  const steps = runtime.loadTranscripts({ core })?.[page]?.variants?.[variant];
  if (!Array.isArray(steps)) return false;
  played.push({ npcId, page, variant, steps: typeof select === 'function' ? select(steps) : steps });
  return true;
};
runtime.startDialogue = (_api, _player, _context, steps) => played.push({ steps });

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const configs = [];
  const xp = [];
  const statements = [];
  const interfaces = [];
  const strings = [];
  const itemsOnInterfaces = [];
  let location = new core.Location(3415, 3489, 2);
  const sender = new Proxy({
    sendConfig(id, value) { if (id === VARP) configs.push(value); return sender; },
    sendChatboxInterface(id) { interfaces.push(id); return sender; },
    sendInterface(id) { interfaces.push(id); return sender; },
    sendString(text, uid) { strings.push([uid, text]); return sender; },
    sendItemOnInterfaces(uid, itemId, amount) { itemsOnInterfaces.push([uid, itemId, amount]); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });
  const inventory = {
    capacity: Infinity,
    fullMessages: 0,
    getAmount: (id) => items.get(id) ?? 0,
    // Slots as the real Inventory counts them: one per stack, one per unstacked item.
    usedSlots: () => [...items].reduce((sum, [id, amount]) =>
      sum + (core.ItemDefinition.forId(id)?.isStackable?.() ? 1 : amount), 0),
    isFull: () => inventory.usedSlots() >= inventory.capacity,
    full() { inventory.fullMessages++; return inventory; },
    adds(id, amount = 1) { items.set(id, inventory.getAmount(id) + amount); return inventory; },
    deleteNumber(id, amount = 1) {
      const left = inventory.getAmount(id) - amount;
      if (left > 0) items.set(id, left); else items.delete(id);
      return inventory;
    },
    forceAdd(_player, item) { return inventory.adds(item.getId(), item.getAmount()); },
  };
  return {
    attrs, items, configs, xp, statements, interfaces, strings, itemsOnInterfaces, inventory,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), getCombatLevel: () => 40 }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues: (chain) => statements.push(chain), isActive: () => false }),
    getLocation: () => location,
    moveTo(next) { location = next; },
    sendMessage: noop,
    getUsername: () => 'pip-test',
  };
}

function harness({ shieldOfArrav = false } = {}) {
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const named = new Map();
  const itemOnObject = [];
  const npcInteraction = [];
  const deaths = [];
  const statements = [];
  const grounds = [];
  const areas = [];
  const fakeCore = { ...core, StatementDialogue: { send: (_player, text) => statements.push(text) } };
  const api = new Proxy({
    core: fakeCore,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onObjectInteraction(name, actions) { if (typeof name === 'string') named.set(name, actions); },
    onItemOnObject: (handler) => itemOnObject.push(handler),
    onNpcInteraction: (handler) => npcInteraction.push(handler),
    onNpcDeath: (handler) => deaths.push(handler),
    registerArea: (area) => areas.push(area),
    onCustomEvent(key, handler) { custom.set(key, [...(custom.get(key) ?? []), handler]); },
    emitCustomEvent(key, event) { for (const handler of custom.get(key) ?? []) handler(event); },
    getItemOnGroundManager: () => ({ registerLocation: (_player, item, at) => grounds.push([item.getId(), at.getX(), at.getY()]) }),
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  require(root + '/plugins/quests/quests/PriestInPeril.Quest')(api);
  if (shieldOfArrav) require(root + '/plugins/quests/quests/ShieldOfArrav.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'priest_in_peril');
  const player = makePlayer();
  const h = { areas, grounds, custom, variants, conditions, named, itemOnObject, npcInteraction, deaths, statements, quest, player };
  h.emit = (key, event) => {
    const request = { player, handled: false, ...event };
    for (const handler of custom.get(key) ?? []) handler(request);
    return request;
  };
  h.talk = (npcId, npcLocation = new core.Location(3417, 3489, 2)) => {
    const npc = { getLocation: () => npcLocation };
    const interaction = { player, npc, npcId, clickType: 1, handled: false };
    for (const handler of npcInteraction) handler(interaction);
    if (interaction.handled) return { handled: true };
    for (const handler of variants) {
      const value = handler({ player, npc, npcId });
      if (value) return value;
    }
    return null;
  };
  h.condition = (text) => {
    for (const handler of conditions) {
      const value = handler({ player, text });
      if (typeof value === 'boolean') return value;
    }
    return null;
  };
  h.object = (name, option, objectId, x, y, z) =>
    named.get(name)[option]({ player, objectId, location: { x, y, z } });
  h.useOn = (itemId, objectId, x, y, z) => {
    const event = { player, itemId, objectId, location: { x, y, z }, handled: false };
    for (const handler of itemOnObject) handler(event);
    return event.handled;
  };
  h.kill = (npcId, location = { x: 3410, y: 3488, z: 0 }) => {
    for (const handler of deaths) handler({ killer: player, npcId, location });
  };
  h.wire = () => player.configs.at(-1);
  h.stage = () => quest.getStage(player);
  return h;
}

const lastPlayed = () => played.at(-1);
const CELL_GATE = [O.CELL_GATE_7, 3415, 3489, 2];
const COFFIN = [O.COFFIN_7, 3413, 3486, 2];
const WELL = [O.WELL_6, 3423, 9890, 0];
const MAUSOLEUM = new core.Location(3440, 9895, 0);

let nextNativeIndex = 9000;

function nativeActor(t) {
  const frames = [];
  const channel = {
    kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: (frame) => { frames.push(Buffer.from(frame)); return true; },
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextNativeIndex++);
  player.setUsername(`pipnative${nextNativeIndex}`);
  player.setRegistered(true);
  player.setLocation(new core.Location(3426, 9894, 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection, frames };
}

async function nativeSend(f, packet) {
  await f.connection.dispatch([packet]);
  f.connection.processTurnPackets();
  for (let tick = 0; tick < 10; tick++) {
    core.TaskManager.processWalkTo(f.player.getIndex());
    f.player.getMovementQueue().process();
    core.TaskManager.process();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

const framesContain = (frames, packet) => Buffer.concat(frames).includes(packet);

test('native Study opens 272, IF_CLOSE closes 161:16, and Study reopens it', async (t) => {
  const f = nativeActor(t);
  const quest = runtime.getRegisteredQuests().find((entry) => entry.key === 'priest_in_peril');
  assert.ok(quest);
  quest.setStage(f.player, 40);
  const location = new core.Location(3427, 9894, 0);
  const object = core.MapObjects.get(O.MONUMENT_5, location.clone(), null);
  assert.ok(object, 'the real cache MONUMENT_5 must exist at 3427,9894,0');
  assert.equal(object.getId(), O.MONUMENT_5);
  assert.deepEqual([object.getLocation().getX(), object.getLocation().getY(), object.getLocation().getZ()],
    [3427, 9894, 0]);
  assert.equal(object.getType(), 10, 'the cache monument keeps shape 10');
  assert.equal(object.getFace(), 0, 'the cache monument keeps rotation 0');
  const study = () => nativeSend(f, {
    type: 'object_option', id: object.getId(), x: 3427, y: 9894, action: 'Study',
  });
  const text = 'Saradomin is the key that unlocks the mysteries of life.';
  const open = encodeWidgetOpenSub(MAIN_MODAL_TARGET_UID, MONUMENT_WINDOW, 0);
  const setText = encodeWidgetSetText(MONUMENT_WINDOW_TEXT_UID, text);
  const setItem = encodeWidgetSetItem(MONUMENT_WINDOW_ITEM_UID, I.IRON_KEY, 1);

  f.frames.length = 0;
  await study();
  assert.ok(framesContain(f.frames, open), 'Study mounts 272 into 161:16 type 0');
  assert.ok(framesContain(f.frames, setText), 'Study sends the key inscription to 272:7');
  assert.ok(framesContain(f.frames, setItem), 'Study sends the iron key emblem to 272:8');
  assert.equal(f.player.getInterfaceId(), MONUMENT_WINDOW);

  f.frames.length = 0;
  await nativeSend(f, { type: 'interface_close' });
  assert.ok(framesContain(f.frames, encodeWidgetCloseSub(MAIN_MODAL_TARGET_UID)),
    'IF_CLOSE closes the 161:16 main modal');
  assert.equal(f.player.getInterfaceId(), -1);

  f.frames.length = 0;
  await study();
  assert.ok(framesContain(f.frames, open), 'Study reopens 272 after the native close');
  assert.ok(framesContain(f.frames, setText), 'the reopened window keeps the inscription');
  assert.ok(framesContain(f.frames, setItem), 'the reopened window keeps the iron key emblem');
  assert.equal(f.player.getInterfaceId(), MONUMENT_WINDOW);

  quest.setStage(f.player, 60);
  f.frames.length = 0;
  await study();
  assert.ok(framesContain(f.frames, encodeWidgetOpenSub(CHATBOX_MODAL_TARGET_UID, 229, 0)),
    'post-quest Study stays in the 229 messagebox');
  assert.ok(framesContain(f.frames, encodeWidgetSetText((229 << 16) | 3,
    'A monument dedicated to the fallen.')));
  assert.ok(!framesContain(f.frames, open), 'post-quest Study does not open 272');
});

test('joining or completing Shield of Arrav cannot hide Priest in Peril at King Roald', () => {
  const h = harness({ shieldOfArrav: true });
  for (const shieldStage of [0, 3, 4, 5, 6, 7]) {
    h.player.attrs.set('quest.shield_of_arrav.stage', shieldStage);
    for (const npcId of [N.KING_ROALD, N.KING_ROALD_3, N.KING_ROALD_5, N.KING_ROALD_6, N.KING_ROALD_7]) {
      assert.equal(h.talk(npcId), 'starting-the-quest', `Shield stage ${shieldStage}, NPC ${npcId}`);
      assert.equal(h.stage(), 0, 'offering the quest does not accept it');
    }
  }
  h.player.items.set(I.CERTIFICATE, 1);
  assert.equal(h.talk(N.KING_ROALD), 'starting-the-quest', 'a leftover certificate after completion cannot block it');
  h.player.attrs.set(STAGE, 20);
  assert.equal(h.talk(N.KING_ROALD), 'you-killed-a-dog-talking-to-king-roald-about-the-now-dead-dog');
  assert.equal(h.stage(), 30, 'the resumed Priest dialogue still updates the quest');
});

test('unfinished Shield of Arrav hand-ins keep priority without advancing Priest in Peril', () => {
  const h = harness({ shieldOfArrav: true });
  for (const shieldStage of [4, 6]) {
    h.player.attrs.set('quest.shield_of_arrav.stage', shieldStage);
    for (const itemId of [I.CERTIFICATE, I.BROKEN_SHIELD, I.BROKEN_SHIELD_2, I.HALF_CERTIFICATE, I.HALF_CERTIFICATE_2]) {
      h.player.items.clear();
      h.player.items.set(itemId, 1);
      h.player.attrs.set(STAGE, 20);
      assert.deepEqual(h.talk(N.KING_ROALD), { page: 'Shield of Arrav', variant:
        itemId === I.CERTIFICATE ? 'finishing-up-talking-to-king-roald-with-a-full-certificate'
          : 'finishing-up-talking-to-king-roald-without-a-full-certificate' });
      assert.equal(h.stage(), 20, 'a different quest winning cannot report the guardian kill');
    }
  }
  h.player.items.clear();
  assert.equal(h.talk(N.KING_ROALD), 'you-killed-a-dog-talking-to-king-roald-about-the-now-dead-dog');
  assert.equal(h.stage(), 30, 'without a hand-in Priest in Peril regains the conversation');
});

test('the route sends live varp 302 values from start to completion', () => {
  const h = harness();
  const { player } = h;
  assert.equal(h.talk(N.KING_ROALD), 'starting-the-quest');
  h.emit('npc-dialogue:hook', { npcId: N.KING_ROALD, hook: 'quest:priest-in-peril:start' });
  assert.equal(h.wire(), 1);

  // Killing the guardian before the monks ask for it does nothing.
  h.kill(3487);
  assert.equal(h.stage(), 10);
  player.moveTo(new core.Location(3408, 3488, 0));
  assert.ok(h.emit('door:toggle', { objectId: O.LARGE_DOOR_22 }).handled);
  assert.equal(lastPlayed().variant, 'at-the-temple');
  assert.equal(h.wire(), 1, 'knocking alone agrees to nothing');
  h.emit('npc-dialogue:line', { npcId: 12240, text: 'Hey... The dog!' }).after?.();
  assert.equal(h.wire(), 1);
  const request = h.emit('npc-dialogue:line', { npcId: 12240, text: 'Then please, deal with that dog for me.' });
  assert.equal(h.wire(), 1, 'not before the player continues past the request');
  request.after();
  assert.equal(h.wire(), 2, 'agreeing to kill the dog shows the guardian (3487 -> 7620 at 0-2)');
  h.kill(3487);
  assert.equal(h.wire(), 3);

  assert.equal(h.talk(N.KING_ROALD), 'you-killed-a-dog-talking-to-king-roald-about-the-now-dead-dog');
  assert.equal(h.wire(), 4);
  assert.equal(h.talk(N.DREZEL), 'saving-drezel-and-the-world-meeting-drezel');
  assert.equal(h.wire(), 5);

  // The monk's golden key opens nothing; the north-east monument swaps it for the iron key.
  player.inventory.adds(I.GOLDEN_KEY);
  assert.ok(h.useOn(I.GOLDEN_KEY, ...CELL_GATE));
  assert.equal(lastPlayed().variant, 'saving-drezel-and-the-world-using-the-golden-key-on-the-lock');
  assert.ok(h.object('Cell gate', 'Open', ...CELL_GATE));
  assert.equal(lastPlayed().variant, 'pre-quest-attempting-to-open-the-gate');
  assert.equal(h.useOn(I.GOLDEN_KEY, O.MONUMENT_4, 3423, 9884, 0), false, 'the south monument holds the needle');
  assert.ok(h.useOn(I.GOLDEN_KEY, O.MONUMENT_5, 3427, 9894, 0));
  assert.equal(player.inventory.getAmount(I.GOLDEN_KEY), 0);
  assert.equal(player.inventory.getAmount(I.IRON_KEY), 1);

  player.inventory.adds(I.BUCKET);
  assert.ok(h.useOn(I.BUCKET, ...WELL));
  assert.equal(player.inventory.getAmount(I.MURKY_WATER), 1);
  assert.equal(h.talk(N.DREZEL), 'talking-to-drezel-with-the-iron-key');

  player.moveTo(new core.Location(3415, 3489, 2));
  assert.ok(h.object('Cell gate', 'Open', ...CELL_GATE));
  assert.equal(h.wire(), 6);
  assert.equal(lastPlayed().variant, 'talking-to-drezel-with-the-iron-key-unlocking-drezel-s-cell');
  assert.equal(player.getLocation().getX(), 3416, 'the player walks into the cell');
  assert.equal(h.condition('If the player has murky water:'), true);
  assert.equal(h.condition("If the player doesn't have murky water:"), false);
  // The condition follows the blessing message: the first blessing still plays his lines.
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: 'feQ9cD', kind: 'message' });
  assert.equal(player.inventory.getAmount(I.MURKY_WATER), 0);
  assert.equal(player.inventory.getAmount(I.BLESSED_WATER), 1);
  assert.equal(h.condition('First time blessing water:'), true);
  assert.equal(h.talk(N.DREZEL), 'talking-to-drezel-with-the-iron-key-talking-to-drezel-with-blessed-water');

  assert.ok(h.useOn(I.BLESSED_WATER, ...COFFIN));
  assert.equal(h.wire(), 7);
  assert.equal(player.inventory.getAmount(I.BLESSED_WATER), 0);
  assert.equal(h.talk(N.DREZEL), 'after-drezel-is-freed-and-the-vampyre-is-sealed');
  assert.equal(h.wire(), 8);
  assert.equal(h.talk(N.DREZEL, MAUSOLEUM), 'repairing-the-barrier');
  assert.equal(h.wire(), 10, 'varp 302 = 60 minus the 50 essence owed');

  player.inventory.adds(I.RUNE_ESSENCE, 28);
  assert.equal(h.talk(N.DREZEL, MAUSOLEUM), 'repairing-the-barrier-bringing-drezel-essence');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: 'ViQ2ji', kind: 'message' });
  assert.equal(player.inventory.getAmount(I.RUNE_ESSENCE), 0);
  assert.equal(h.wire(), 38);
  const line = { npcId: N.DREZEL, player, text: 'Thank you. I need [1-50] more.' };
  for (const handler of h.custom.get('npc-dialogue:line')) handler(line);
  assert.equal(line.text, 'Thank you. I need 22 more.');

  player.inventory.adds(I.PURE_ESSENCE, 25);
  assert.equal(h.talk(N.DREZEL, MAUSOLEUM), 'giving-drezel-the-last-of-the-essence');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: '4daSZa', kind: 'message' });
  assert.equal(player.inventory.getAmount(I.PURE_ESSENCE), 3, 'only the 22 still owed are taken');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: '5wj46V', kind: 'action' });
  assert.equal(h.wire(), 61);
  assert.ok(h.quest.isComplete(player));
  assert.deepEqual(player.xp, [[core.Skill.PRAYER.getIndex(), 1406]]);
  assert.equal(player.inventory.getAmount(I.WOLFBANE), 1);

  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: '5wj46V', kind: 'action' });
  assert.equal(player.xp.length, 1, 'a repeat completion action pays nothing');
  assert.equal(player.inventory.getAmount(I.WOLFBANE), 1);
});

test('an interrupted final hand-in resumes the completion without more essence', () => {
  const h = harness();
  const { player } = h;
  h.player.setAttribute(STAGE, 55);
  player.inventory.adds(I.RUNE_ESSENCE, 28);
  assert.equal(h.talk(N.DREZEL, MAUSOLEUM), 'repairing-the-barrier-bringing-drezel-essence');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: 'ViQ2ji', kind: 'message' });
  player.inventory.adds(I.RUNE_ESSENCE, 22);
  assert.equal(h.talk(N.DREZEL, MAUSOLEUM), 'giving-drezel-the-last-of-the-essence');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: '4daSZa', kind: 'message' });
  // Logged out before "Quest complete!": paid in full, nothing left to carry.
  assert.equal(player.inventory.getAmount(I.RUNE_ESSENCE), 0);
  assert.equal(h.stage(), 55);

  assert.deepEqual(h.talk(N.DREZEL, MAUSOLEUM), { handled: true });
  const { variant, steps } = lastPlayed();
  assert.equal(variant, 'giving-drezel-the-last-of-the-essence');
  assert.ok(!steps.some((step) => step.id === '4daSZa'), 'the hand-in is not replayed');
  assert.match(steps[0].text, /^Excellent! That should do it!/);
  assert.ok(steps.some((step) => step.id === '5wj46V'), 'the completion action is still ahead');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: '5wj46V', kind: 'action' });
  assert.ok(h.quest.isComplete(player));
  assert.deepEqual(player.xp, [[core.Skill.PRAYER.getIndex(), 1406]]);
  assert.equal(player.inventory.getAmount(I.WOLFBANE), 1);

  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: '5wj46V', kind: 'action' });
  assert.notDeepEqual(h.talk(N.DREZEL, MAUSOLEUM), { handled: true }, 'after completion Drezel is back to normal');
  assert.equal(player.xp.length, 1, 'the resumed completion pays once');
  assert.equal(player.inventory.getAmount(I.WOLFBANE), 1);
});

test('the unlocked cell replays the blessing without the unlock opening', () => {
  const h = harness();
  h.player.setAttribute(STAGE, 43);
  h.player.inventory.adds(I.MURKY_WATER, 2);
  assert.deepEqual(h.talk(N.DREZEL), { handled: true });
  const { variant, steps } = lastPlayed();
  assert.equal(variant, 'talking-to-drezel-with-the-iron-key-unlocking-drezel-s-cell');
  assert.notEqual(steps[0].id, 'TtVTbz', 'the "You use the key" message is not replayed');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: 'feQ9cD', kind: 'message' });
  assert.equal(h.player.inventory.getAmount(I.BLESSED_WATER), 2, 'every murky water is blessed');
  assert.equal(h.condition('First time blessing water:'), true);
  h.player.inventory.adds(I.MURKY_WATER);
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: 'feQ9cD', kind: 'message' });
  assert.equal(h.condition('First time blessing water:'), false, 'a second blessing skips his first-time lines');
});

test('saves from before the cell and coffin stages keep their meaning', () => {
  const h = harness();
  h.player.setAttribute(STAGE, 50); // An old save: the old plugin sealed the vampyre at 50.
  h.quest.setStage(h.player, 50);
  assert.equal(h.wire(), 8);
  assert.equal(h.talk(N.DREZEL), 'after-drezel-is-freed-and-the-vampyre-is-sealed-talking-to-drezel-again');
  assert.equal(h.talk(N.DREZEL, MAUSOLEUM), 'repairing-the-barrier');
  assert.equal(h.stage(), 55);
});

test('in-quest monument Study opens the quest monument window for every inscription', () => {
  const inscriptions = [
    [O.MONUMENT, 'Saradomin is the vessel that keeps us safe from harm.', I.GOLDEN_POT],
    [O.MONUMENT_2, 'Saradomin is the hammer that crushes evil everywhere.', I.GOLDEN_HAMMER],
    [O.MONUMENT_3, 'Saradomin is the delicate touch that brushes us with love.', I.GOLDEN_FEATHER],
    [O.MONUMENT_4, 'Saradomin is the needle that binds our lives together.', I.GOLDEN_NEEDLE],
    [O.MONUMENT_5, 'Saradomin is the key that unlocks the mysteries of life.', I.IRON_KEY],
    [O.MONUMENT_6, 'Saradomin is the spark that lights the fire in our hearts.', I.GOLDEN_TINDERBOX],
    [O.MONUMENT_7, 'Saradomin is the light that shines throughout our lives.', I.GOLDEN_CANDLE],
  ];
  for (const [objectId, text, emblem] of inscriptions) {
    const h = harness();
    h.player.setAttribute(STAGE, 40);
    h.object('Monument', 'Study', objectId, 3423, 9890, 0);
    assert.deepEqual(h.player.interfaces, [MONUMENT_WINDOW], `monument ${objectId} opens 272`);
    assert.deepEqual(h.player.strings, [[MONUMENT_WINDOW_TEXT_UID, text]], 'only 272:7 gets the inscription');
    assert.deepEqual(h.player.itemsOnInterfaces, [[MONUMENT_WINDOW_ITEM_UID, emblem, 1]],
      `monument ${objectId} shows its canonical emblem on 272:8`);
    assert.deepEqual(h.player.statements, [], 'in-quest Study does not use messagebox 229');
  }
});

test('monuments guard their items until the coffin is sealed and give one souvenir each', () => {
  const h = harness();
  h.player.setAttribute(STAGE, 40);
  h.object('Monument', 'Study', O.MONUMENT_5, 3427, 9894, 0);
  assert.deepEqual(h.player.interfaces, [MONUMENT_WINDOW]);
  assert.deepEqual(h.player.strings.at(-1),
    [MONUMENT_WINDOW_TEXT_UID, 'Saradomin is the key that unlocks the mysteries of life.']);
  assert.deepEqual(h.player.itemsOnInterfaces.at(-1), [MONUMENT_WINDOW_ITEM_UID, I.IRON_KEY, 1]);
  h.player.inventory.adds(I.HAMMER, 2);
  assert.ok(h.useOn(I.HAMMER, O.MONUMENT_2, 3423, 9895, 0));
  assert.equal(h.player.inventory.getAmount(I.GOLDEN_HAMMER), 1);
  assert.ok(h.useOn(I.HAMMER, O.MONUMENT_2, 3423, 9895, 0));
  assert.equal(h.statements.at(-1), 'You have already taken the Golden hammer.');
  assert.equal(h.player.inventory.getAmount(I.HAMMER), 1);

  h.player.setAttribute(STAGE, 60);
  h.object('Monument', 'Study', O.MONUMENT_5, 3427, 9894, 0);
  assert.equal(h.statements.at(-1), 'A monument dedicated to the fallen.');
  assert.equal(h.player.interfaces.filter((id) => id === MONUMENT_WINDOW).length, 1,
    'post-quest Study does not open the monument window');
  h.player.inventory.adds(I.BUCKET);
  assert.equal(h.useOn(I.BUCKET, ...WELL), false, 'after the quest the well fills an ordinary bucket of water');
});

test('a full inventory keeps a stacked monument item until the souvenir fits', () => {
  for (const [item, golden, monument, x, y] of [
    [I.FEATHER, I.GOLDEN_FEATHER, O.MONUMENT_3, 3427, 9890],
    [I.NEEDLE, I.GOLDEN_NEEDLE, O.MONUMENT_4, 3423, 9884],
  ]) {
    const h = harness();
    const inv = h.player.inventory;
    h.player.setAttribute(STAGE, 40);
    inv.capacity = 28;
    inv.adds(item, 10);
    inv.adds(I.BUCKET, 27);
    assert.ok(inv.isFull());
    assert.ok(h.useOn(item, monument, x, y, 0));
    assert.equal(inv.fullMessages, 1);
    assert.equal(inv.getAmount(item), 10, 'the stack is untouched');
    assert.equal(inv.getAmount(golden), 0);
    assert.equal(h.player.getAttribute('priest-in-peril:souvenirs') ?? 0, 0, 'the souvenir stays untaken');

    inv.deleteNumber(I.BUCKET, 1);
    assert.ok(h.useOn(item, monument, x, y, 0));
    assert.equal(inv.getAmount(item), 9);
    assert.equal(inv.getAmount(golden), 1, 'the retry with a free slot gets the souvenir');
  }
});

test('only the hooded level 30 monk drops the golden key, from the King\'s warning to the coffin', () => {
  const h = harness();
  h.player.setAttribute(STAGE, 20);
  h.kill(N.MONK_OF_ZAMORAK_17);
  assert.deepEqual(h.grounds, [], 'not before the King has been told');
  h.player.setAttribute(STAGE, 30);
  h.kill(N.MONK_OF_ZAMORAK_15);
  h.kill(N.MONK_OF_ZAMORAK_16);
  assert.deepEqual(h.grounds, [], 'the level 17 and 22 monks carry no key');
  h.kill(N.MONK_OF_ZAMORAK_17);
  assert.deepEqual(h.grounds, [[I.GOLDEN_KEY, 3410, 3488]]);
  h.player.setAttribute(STAGE, 46);
  h.kill(N.MONK_OF_ZAMORAK_17);
  assert.equal(h.grounds.length, 1, 'no key once the coffin is sealed');
});

test('the open north trapdoor climbs down beside the mausoleum ladder; the others are left to LocTeleports', () => {
  const h = harness();
  const climb = (objectId, x, y) => {
    const request = { player: h.player, objectId, object: { getLocation: () => new core.Location(x, y, 0) }, handled: false };
    for (const handler of h.custom.get('ladders:climb')) handler(request);
    return request.handled;
  };
  const landings = [];
  h.custom.set('ladders:climbDown', [({ destination }) => landings.push([destination.getX(), destination.getY()])]);
  assert.equal(climb(O.TRAPDOOR_6, 3405, 3507), true);
  assert.deepEqual(landings, [[3405, 9906]]);
  assert.equal(climb(O.TRAPDOOR_6, 3097, 3468), false, "Edgeville's trapdoor is not the quest's");
  assert.equal(climb(O.TRAPDOOR_13, 3422, 3485), false, "the church trapdoor's captured Climb-down is LocTeleports'");
  assert.equal(climb(O.LADDER_216, 3405, 9907), false, "the mausoleum ladder's captured climb is LocTeleports'");
  assert.equal(h.named.has('Trapdoor'), false, 'Open and Close play the captured loc swaps');
});

test('the mausoleum gate needs the golden key once, and the key monument refuses a second swap', () => {
  const h = harness();
  const gate = (y) => {
    h.player.moveTo(new core.Location(3405, y, 0));
    return h.emit('door:toggle', { objectId: O.GATE_70, object: { getLocation: () => new core.Location(3405, 9895, 0) } });
  };
  h.player.setAttribute(STAGE, 30);
  assert.equal(gate(9896).handled, true, 'locked from the ladder side without the key');
  assert.equal(lastPlayed().variant, 'pre-quest-attempting-to-open-the-gate');
  assert.equal(gate(9894).handled, false, 'the monument side always opens');
  h.player.inventory.adds(I.GOLDEN_KEY);
  assert.equal(gate(9896).handled, false, 'the golden key opens it (Doors swings it)');
  h.player.inventory.deleteNumber(I.GOLDEN_KEY);
  assert.equal(gate(9896).handled, false, 'after the first time it needs no key');

  h.player.inventory.adds(I.GOLDEN_KEY);
  h.player.inventory.adds(I.IRON_KEY);
  assert.ok(h.useOn(I.GOLDEN_KEY, O.MONUMENT_5, 3427, 9894, 0));
  assert.equal(h.statements.at(-1), 'You have already swapped the golden key for the iron key.');
  assert.equal(h.player.inventory.getAmount(I.GOLDEN_KEY), 1);
});

test('the guardian refuses attacks before the quest and every spell', () => {
  const h = harness();
  const messages = [];
  let spell = null;
  h.player.sendMessage = (text) => messages.push(text);
  h.player.getCombat = () => ({ getSelectedSpell: () => spell });
  const attacker = { isPlayer: () => true, getAsPlayer: () => h.player };
  const guardian = { getId: () => 3487 };
  const [area] = h.areas;
  assert.equal(area.canAttack(attacker, guardian), false);
  assert.equal(messages.at(-1), 'You have no reason to do that!');
  h.player.setAttribute(STAGE, 10);
  assert.equal(area.canAttack(attacker, guardian), null, 'melee and ranged are the normal combat rules');
  spell = { id: 'wind strike' };
  assert.equal(area.canAttack(attacker, guardian), false);
  assert.equal(messages.at(-1), 'Your spells do not seem to affect it.');
  assert.equal(area.canAttack(attacker, { getId: () => N.MONK_OF_ZAMORAK_17 }), null);
});

test('the temple doors walk the player through instead of standing open', () => {
  const h = harness();
  const door = () => h.emit('door:toggle', { objectId: O.LARGE_DOOR_22 });
  h.player.setAttribute(STAGE, 10);
  h.player.moveTo(new core.Location(3408, 3488, 0));
  door();
  assert.equal(h.player.getLocation().getX(), 3408, 'before the King is told the monks only answer');
  h.player.setAttribute(STAGE, 30);
  assert.ok(door().handled);
  assert.equal(h.player.getLocation().getX(), 3409);
  assert.ok(door().handled);
  assert.equal(h.player.getLocation().getX(), 3408);
  h.player.setAttribute(STAGE, 0);
  h.player.moveTo(new core.Location(3409, 3489, 0));
  assert.ok(door().handled);
  assert.equal(h.player.getLocation().getX(), 3408, 'anyone inside can leave');
});
