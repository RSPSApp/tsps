const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const { PacketSender } = require('../dist/net/packet/PacketSender');
const { encodeSound } = require('../dist/net/protocol/ClientProtocol');
const core = PluginManager.getCoreApi();
const Pets = require('../plugins/npcs/Pets.plugin');
const PUPPY = 34503, PUPPY_NPC = 16433, COINS = 995, ADOPTION = 227;
const uid = child => (ADOPTION << 16) | child;
let nextIndex = 1;
before(async () => require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..')));

function harness() {
  const events = new Map(), buttons = new Map(), hooks = new Map(), namedNpcs = new Map(), tasks = [], npcs = [], addQueue = [], removeQueue = [];
  const collection = { add(npc) { npc.setRegistered(true); npc.setIndex(nextIndex++); npcs.push(npc); return true; }, get: index => npcs.find(npc => npc.getIndex() === index), [Symbol.iterator]: function* () { yield* npcs; } };
  const api = new Proxy({
    core: { ...core, TaskManager: { submit(task) { task.setRunning(true); tasks.push(task); } } },
    getWorld: () => ({ getNpcs: () => collection, getAddNPCQueue: () => addQueue, getRemoveNPCQueue: () => removeQueue }),
    getRegionManager: () => ({ blocked: () => true }), getItemOnGroundManager: () => ({}),
    onCustomEvent(name, action) { if (!events.has(name)) events.set(name, []); events.get(name).push(action); },
    emitCustomEvent(name, value) { for (const action of events.get(name) ?? []) action(value); },
    onInterfaceActionButton(ids, fn) { for (const id of [].concat(ids)) buttons.set(id, fn); },
    onNpcInteraction(name, actions) { namedNpcs.set(name, actions); },
    sendMultiChatboxPrompt(player, title, ...pairs) { return MultiChatboxPrompt.showPrompt('Ruff puppies test', player, title, pairs); },
    log() {}, persistAttribute() {},
  }, { get: (target, key) => key in target ? target[key] : (...args) => {
    const fn = args.findLast(arg => typeof arg === 'function');
    if (fn) { if (!hooks.has(key)) hooks.set(key, []); hooks.get(key).push(fn); }
  } });
  Pets.register(api);
  const helper = require('../plugins/quests/ruff/Puppies.Quests')(api, { isComplete: player => player.complete });
  return { api, helper, npcs, removeQueue, namedNpcs,
    emit: (name, value) => api.emitCustomEvent(name, value),
    hook: (name, value) => { for (const fn of hooks.get(name) ?? []) fn(value); },
    tick: count => { while (count-- > 0) for (const task of [...tasks]) task.tick(); },
    click(player, buttonId, slot, action = 1) {
      const event = { player, buttonId, slot, action, opId: action, handled: false };
      buttons.get(buttonId)?.(event); return event;
    },
    answer(player, action) {
      const event = { player, buttonId: 193 << 16, action, handled: false };
      buttons.get(event.buttonId)(event); return event;
    },
    drop(player, id = PUPPY) { const event = { player, itemId: id, handled: false }; for (const fn of hooks.get('onItemDropPolicy') ?? []) fn(event); return event; },
  };
}

function player(h, coins = 1000, full = false) {
  const attrs = new Map(), items = new Map([[COINS, coins]]), vars = new Map(), packets = [], messages = [], animations = [];
  const index = nextIndex++;
  let main = -1, chat = -1;
  const inventory = {
    getAmount: id => items.get(id) ?? 0, contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount) => items.set(id, (items.get(id) ?? 0) + amount),
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)),
    isFull: () => full && (items.get(COINS) ?? 0) > 0,
  };
  let sender; sender = new Proxy({}, { get: (_, method) => {
    if (method === 'getVarp') return id => vars.get(id) ?? 0;
    if (method === 'getChatboxGroupId') return () => chat;
    if (method === 'isChatboxInterface') return id => chat === id;
    return (...args) => {
      packets.push([method, ...args]);
      if (method === 'sendConfig') vars.set(args[0], args[1]);
      if (method === 'sendChatboxInterface') chat = args[0];
      if (method === 'sendInterface') main = args[0];
      if (method === 'closeInterface' && args[0] === chat) chat = -1;
      if (method === 'sendInterfaceRemoval') { const old = main; main = chat = -1; h.emit('interface:closed', { player: p, interfaceId: old }); }
      return sender;
    };
  } });
  const p = {
    complete: true, attrs, items, vars, packets, messages, animations, inventory,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getUsername: () => 'PuppyTester', getDisplayName: () => 'PuppyTester', getIndex: () => index, isPlayerBot: () => false,
    getHitpoints: () => 99, getInventory: () => inventory, getBanks: () => [],
    getBank: () => ({ adds: () => true, contains: () => false }),
    getPacketSender: () => sender, getInterfaceId: () => main,
    getArea: () => null, getPrivateArea: () => null,
    getLocation: () => new core.Location(3036, 3456, 0), outterTiles: () => [],
    getMovementQueue: () => ({ reset() {} }), setPositionToFace() {},
    performAnimation: animation => animations.push(animation.getId()),
    sendMessage: message => messages.push(message), getDialogueManager: () => manager,
  };
  const manager = new DialogueManager(p);
  return p;
}

function open(h, p) {
  assert.equal(h.helper.talkChase({ player: p }), true);
  p.getDialogueManager().advance(); p.getDialogueManager().advance(); h.tick(1);
  assert.equal(p.getInterfaceId(), ADOPTION);
  assert.equal(p.getPacketSender().isChatboxInterface(231), false);
}

function encodedSounds(p) {
  const encoded = [];
  const sender = new PacketSender({ getSession: () => ({ sendClientPacket: packet => { encoded.push(packet); return true; } }) });
  for (const [method, ...args] of p.packets) if (['sendSound', 'sendSoundEffect'].includes(method)) sender[method](...args);
  return encoded;
}
function payPrompt(h, p) {
  open(h, p); h.click(p, uid(24), 9); p.getDialogueManager().advance();
  assert.equal(p.getDialogueManager().getCurrent().getText(), 'Pay 200 Coins?');
}
function follower(h, p) {
  p.items.set(PUPPY, 1); assert.equal(h.drop(p).handled, true);
  return p.getAttribute('pets:current');
}
function menu(p, npc) {
  assert.equal(Pets.__internals.handlePetClick({ player: p, npc, npcId: npc.getId(), clickType: 5,
    definition: { getActions: () => ['Pet', '', 'Pick-up', '', 'Interact'] } }), true);
}
function choose(p, option) {
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: (219 << 16) | 1, action: option }), true);
}

test('native adoption previews breeds and colours, rejects locked/forged choices and charges only once after Yes', () => {
  const h = harness(), p = player(h);
  p.complete = false; assert.equal(h.helper.talkChase({ player: p }), false); p.complete = true;
  open(h, p);
  assert.equal(p.vars.get(5732), 5);
  assert.deepEqual(p.packets.filter(p => p[0] === 'sendInterfaceFlagsRange').slice(-3), [
    ['sendInterfaceFlagsRange', uid(7), 0, 60, 2], ['sendInterfaceFlagsRange', uid(21), 0, 24, 2], ['sendInterfaceFlagsRange', uid(24), 0, 10, 2],
  ]);
  assert.equal(h.click(p, uid(7), 40).handled, true); assert.equal(p.vars.get(5732), 8);
  assert.equal(h.click(p, uid(7), 50).handled, true); assert.equal(p.vars.get(5732), 10);
  assert.equal(h.click(p, uid(24), 9).handled, false); assert.equal(p.items.get(COINS), 1000);
  assert.equal(h.click(p, uid(7), 26).handled, false);
  h.click(p, uid(7), 25); h.click(p, uid(21), 2); assert.equal(p.vars.get(5733), 1);
  h.click(p, uid(21), 4); assert.equal(p.vars.get(5733), 2);
  h.click(p, uid(21), 0); assert.equal(h.click(p, uid(21), 7).handled, false);
  assert.equal(h.click(p, uid(24), 8).handled, false);
  h.click(p, uid(24), 9); assert.equal(p.getDialogueManager().getCurrent().getText(), "That'll be 200 coins.");
  p.getDialogueManager().advance(); assert.equal(h.answer(p, 0).handled, true);
  assert.equal(p.items.get(COINS), 1000); assert.equal(p.items.get(PUPPY), undefined);
  payPrompt(h, p); assert.equal(h.answer(p, 1).handled, true);
  assert.equal(p.items.get(COINS), 800); assert.equal(p.items.get(PUPPY), 1);
  assert.equal(p.getDialogueManager().getCurrent().getText(), 'Chase hands you the Labrador puppy.');
  assert.equal(h.answer(p, 1).handled, false); assert.equal(p.items.get(COINS), 800);
  assert.equal(h.click(p, uid(24), 9).handled, false);
});

test('adoption rechecks money, backpack capacity and the current question before transferring coins', () => {
  const h = harness(), p = player(h);
  payPrompt(h, p); p.items.set(COINS, 199); h.answer(p, 1);
  assert.equal(p.items.get(COINS), 199); assert.equal(p.items.get(PUPPY), undefined);
  const full = player(h, 201, true); payPrompt(h, full); h.answer(full, 1);
  assert.equal(full.items.get(COINS), 201); assert.equal(full.items.get(PUPPY), undefined);
  const lastSlot = player(h, 200, true); payPrompt(h, lastSlot); h.answer(lastSlot, 1);
  assert.equal(lastSlot.items.get(COINS), 0); assert.equal(lastSlot.items.get(PUPPY), 1);
  payPrompt(h, p);
  const other = new core.DialogueChainBuilder(); other.add(new core.ItemStatementDialogue(0, 995, 'Other question'));
  p.getDialogueManager().startDialogues(other);
  assert.equal(h.answer(p, 1).handled, false);
  assert.equal(p.getDialogueManager().getCurrent().getText(), 'Other question');
});

test('selection follows cache colour models and requires the rescued breed unlock', () => {
  const h = harness(), p = player(h);
  open(h, p); h.click(p, uid(7), 30); h.click(p, uid(21), 2); h.click(p, uid(24), 9);
  p.getDialogueManager().advance(); h.answer(p, 1);
  assert.equal(p.items.get(34543), 1); // Black Pug: cache preview model 62015.
  open(h, p); h.click(p, uid(7), 50);
  assert.equal(h.click(p, uid(24), 9).handled, false);
  p.vars.set(5734, 1 << 6); h.click(p, uid(21), 2); h.click(p, uid(24), 9);
  p.getDialogueManager().advance(); h.answer(p, 1);
  assert.equal(p.items.get(34561), 1); // Toasted Shiba: model 62024.
});

test('all 36 cache puppy forms use their real items and native follower pickup/drop/relog lifecycle', () => {
  const h = harness(), p = player(h);
  const puppies = Pets.__internals.PETS.filter(pet => pet.puppy);
  assert.equal(puppies.length, 36);
  for (const pet of puppies) {
    assert.equal(core.CacheDefinitions.getItem(pet.itemId).placeholderTemplate, -1);
    assert.match(core.CacheDefinitions.getNpc(pet.petId).name, /puppy/i);
    assert.equal(pet.reclaimable, false);
  }
  const npc = follower(h, p);
  assert.equal(npc.getId(), PUPPY_NPC); assert.equal(p.items.get(PUPPY), 0);
  assert.equal(p.vars.get(447), (PUPPY_NPC << 16) | npc.getIndex()); assert.equal(p.vars.get(448), PUPPY);
  assert.equal(Pets.__internals.pickup(p, npc), true);
  assert.equal(p.items.get(PUPPY), 1); assert.equal(p.vars.get(447), -1); assert.equal(p.vars.get(447) & 0xffff, 65535); assert.equal(p.vars.get(448), -1);
  assert.ok(encodedSounds(p).some(packet => packet.equals(encodeSound(2582, { loops: 1, delay: 20 }))));
  assert.equal(Pets.__internals.pickup(p, npc), false); assert.equal(p.items.get(PUPPY), 1);
  h.drop(p); h.hook('onPlayerLogout', { player: p });
  assert.equal(p.items.get(PUPPY), 0); assert.equal(p.getAttribute('pets:current'), null);
  assert.equal(p.getAttribute('pets:active-item'), PUPPY);
  h.hook('onPlayerLogin', { player: p });
  assert.equal(p.items.get(PUPPY), 0); assert.equal(p.getAttribute('pets:current').getId(), PUPPY_NPC);
  assert.deepEqual(Pets.__internals.getOwnedPetItems(p), []);
});

test('puppy Pet and age menus match the captured animation, sound delay and objectbox', () => {
  const h = harness(), p = player(h), npc = follower(h, p);
  menu(p, npc); assert.deepEqual(MultiChatboxPrompt.getPending(p), { title: 'Interact with puppy', options: ['Pet.', 'Guess age.', 'Release.'] });
  choose(p, 1); assert.equal(p.animations.at(-1), -1);
  h.tick(1); assert.equal(p.animations.at(-1), 827);
  assert.equal(p.packets.some(row => row[0] === 'sendSoundEffect' && row[1] === 12122), false);
  h.tick(1); assert.deepEqual(encodedSounds(p).slice(-2), [encodeSound(652, { loops: 1, delay: 0 }), encodeSound(12122, { loops: 1, delay: 0 })]);
  menu(p, npc); choose(p, 2);
  assert.equal(p.getDialogueManager().getCurrent().getText(), 'I wonder how old you are...');
  p.getDialogueManager().advance(); h.tick(1);
  assert.equal(p.getDialogueManager().getCurrent().getItemId(), PUPPY);
  assert.match(p.getDialogueManager().getCurrent().getText(), /0 minutes.*3<br>.*hours  00 minutes/);
  assert.ok(p.packets.some(row => row[0] === 'sendInterfaceAnimation' && row[2] === 554));
});

test('release requires Yes and the full captured conversation, then cannot remove another follower', () => {
  const h = harness(), p = player(h), npc = follower(h, p);
  menu(p, npc); choose(p, 3); h.answer(p, 0); assert.equal(p.getAttribute('pets:current'), npc);
  menu(p, npc); choose(p, 3); h.answer(p, 1);
  const lines = [p.getDialogueManager().getCurrent().getText()];
  p.getDialogueManager().advance(); h.tick(1);
  for (let i = 0; i < 2; i++) { lines.push(p.getDialogueManager().getCurrent().getText()); p.getDialogueManager().advance(); }
  assert.deepEqual(lines, ["I'm sorry buddy, but we need to part ways.", 'Arf?', 'You can make your way back to the shelter, right?']);
  assert.equal(p.getAttribute('pets:current'), npc); h.tick(1);
  assert.equal(p.getAttribute('pets:current'), null); assert.equal(p.getAttribute('pets:last'), null);
  assert.equal(p.items.get(PUPPY), 0); assert.equal(p.messages.at(-1), 'Your puppy has run away.');
  assert.equal(h.removeQueue.includes(npc), true); assert.equal(p.vars.get(448), -1);
  const outsider = player(h); const request = { player: outsider, npc, released: false };
  h.emit('pets:release', request); assert.equal(request.released, false);
});

test('logout cancels delayed adoption and a stale release cannot remove a replacement follower', () => {
  const h = harness(), p = player(h);
  h.helper.talkChase({ player: p }); p.getDialogueManager().advance(); p.getDialogueManager().advance();
  h.hook('onPlayerLogout', { player: p }); h.tick(1); assert.equal(p.getInterfaceId(), -1);
  const npc = follower(h, p);
  menu(p, npc); choose(p, 3); h.answer(p, 1);
  p.getDialogueManager().advance(); h.tick(1);
  for (let i = 0; i < 2; i++) p.getDialogueManager().advance();
  Pets.__internals.pickup(p, npc); h.drop(p); const replacement = p.getAttribute('pets:current');
  h.tick(1); assert.equal(p.getAttribute('pets:current'), replacement); assert.notEqual(replacement, npc);
  assert.equal(p.messages.includes('Your puppy has run away.'), false);
});

test('real PacketSender closes the current cache chatbox while retaining the adoption modal', () => {
  let resets = 0;
  const sent = [];
  const sender = new PacketSender({
    getInterfaceId: () => ADOPTION,
    getFrameUpdater: () => ({ clearGroup() {} }),
    getDialogueManager: () => ({ reset() { resets++; } }),
    getSession: () => ({ sendClientPacket: packet => { sent.push(packet); return true; } }),
  });
  sender.sendChatboxInterface(231);
  sender.closeInterface(sender.getChatboxGroupId());
  assert.equal(sender.getChatboxGroupId(), -1);
  assert.equal(sender.isChatboxInterface(231), false);
  assert.equal(resets, 1);
  assert.equal(sent.length, 4); // Open/unhide, then close/hide the revision's native chat container.
});

test('native postquest Chase Adopt action opens the same working selector as Talk-to', () => {
  const h = harness(), p = player(h);
  require('../plugins/quests/quests/ARuffSituation.Quest')(h.api);
  p.attrs.set('quest.a_ruff_situation.stage', 120);
  const actions = h.namedNpcs.get('Chase');
  assert.equal(actions.Adopt, actions['Talk-to']);
  assert.equal(actions.Adopt({ player: p, npcId: 16489 }), true);
  p.getDialogueManager().advance(); p.getDialogueManager().advance(); h.tick(1);
  assert.equal(p.getInterfaceId(), ADOPTION);
  assert.equal(p.getPacketSender().isChatboxInterface(231), false);
});
