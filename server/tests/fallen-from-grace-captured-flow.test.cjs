// Fallen From Grace against the user's own rsprox captures ("Fallen From Grace" P1 and P2):
// the stage ladder as live sends it, the cavern's greeting and trolls, the rockfall, the
// basement stairs into the real cathedral, Keenan's body and Elessia's letter, the door from
// outside, and the monolith. Ticks and tiles in each test are the captures'.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { TaskManager } = require('../dist/game/task/TaskManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const PAGE = 'Fallen From Grace';

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

const runTicks = (n = 1) => { for (let i = 0; i < n; i++) TaskManager.process(); };

function setup() {
  const hooks = {
    variants: [], conditions: [], object: [], custom: new Map(), deaths: [], itemActions: [],
    zones: [], exits: [], logins: [], spawned: [], removed: [], npcNamed: new Map(),
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
    onObjectInteraction(fn) { hooks.object.push(fn); },
    onItemAction(fn) { hooks.itemActions.push(fn); },
    onNpcDeath(fn) { hooks.deaths.push(fn); },
    onNpcInteraction(name, actions) { if (typeof name === 'string') hooks.npcNamed.set(name, [...(hooks.npcNamed.get(name) ?? []), actions.Investigate].filter(Boolean)); },
    onZoneEnter(zone, fn) { hooks.zones.push({ zone, fn }); },
    onZoneExit(zone, fn) { hooks.exits.push({ zone, fn }); },
    onPlayerLogin(fn) { hooks.logins.push(fn); },
    spawnNpc(def) {
      const npc = { ...def, said: [], getId: () => def.id, isRegistered: () => true, forceChat(text) { npc.said.push(text); } };
      hooks.spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { hooks.removed.push(npc); },
    getItemOnGroundManager() { return { getGroundItem() { return true; }, registerLocation() {} }; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/FallenFromGrace.Quest')(api);
  PluginManager.emitNpcDialogueCondition = (event) => {
    for (const fn of hooks.conditions) { const answer = fn(event); if (answer !== null && answer !== undefined) return answer; }
    return null;
  };
  PluginManager.emitCustomEvent = (name, event) => { for (const fn of hooks.custom.get(name) ?? []) fn(event); };
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === 'fallen_from_grace').at(-1);
  const attrs = new Map(), items = new Map(), varbits = new Map(), messages = [], log = [];
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    sendSoundEffect(id) { log.push(`sound ${id}`); return sender; },
    sendSubInterface(uid, group, mode, options) { log.push(`overlay ${group} ${options?.postScripts?.[0]?.args?.[1] ?? ''}`.trim()); return sender; },
    sendInterface(id) { p.interface = id; log.push(`interface ${id}`); return sender; },
    sendInterfaceScript(id, args) { p.script = { id, args }; return sender; },
    sendClientScript(id, ...args) { log.push(`clientscript ${id} ${args.join('|')}`.trim()); return sender; },
    sendInterfaceRemoval() { p.interface = -1; return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  let location = new core.Location(2589, 8606, 0);
  const p = {
    attrs, items, varbits, messages, log, sender,
    getAttribute: (key) => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getPacketSender: () => sender, sendMessage: (text) => messages.push(text),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0, getFreeSlots: () => 20, isFull: () => false,
      contains: (id) => (items.get(id) ?? 0) > 0,
      getValidItems: () => [...items].filter(([, n]) => n > 0).map(([id, n]) => new core.Item(id, n)), getItems: () => [...items].filter(([, n]) => n > 0).map(([id, n]) => new core.Item(id, n)),
      adds: (id, amount = 1) => items.set(id, (items.get(id) ?? 0) + amount),
      deleteNumber: (id, amount = 1) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)),
    }),
    getEquipment: () => ({ get: () => null, getItems: () => [], getAmount: () => 0 }),
    getBanks: () => [],
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences() {} }),
    getLocation: () => location, moveTo(to) { location = to; log.push(`move ${to.getX()} ${to.getY()}`); },
    setLocationForTest(to) { location = to; },
    getDialogueManager: () => p.manager, getUsername: () => 'Parity', getDisplayName: () => 'Parity', getIndex: () => 1,
    getAppearance: () => ({ isMale: () => true, getLook: () => [] }), getRights: () => core.PlayerRights?.PLAYER,
    isPlayer: () => true, isRegistered: () => true, isPlayerBot: () => false,
    setInterfaceId(id) { p.interfaceId = id; }, getInterfaceId() { return p.interfaceId; },
    setEnteredAmountAction(action) { p.amountAction = action; }, getEnteredAmountAction() { return p.amountAction; },
    setPositionToFace() {}, performAnimation(animation) { log.push(`anim ${animation?.getId?.() ?? animation?.id ?? animation}`); },
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    getArea: () => null, setArea() {}, getPrivateArea: () => null,
  };
  p.manager = new DialogueManager(p);
  const object = (objectId) => {
    const event = { player: p, objectId, handled: false, object: null, clickType: 1 };
    for (const fn of hooks.object) fn(event);
    return event;
  };
  const custom = (name, event) => { for (const fn of hooks.custom.get(name) ?? []) fn(event); return event; };
  const play = (npcId, variant) => runtime.startTranscript(api, p, npcId, PAGE, variant);
  /** Continues the conversation until `until` holds or it ends; returns the entries seen. */
  const advance = (until = () => false, limit = 60) => {
    const seen = [];
    for (let i = 0; i < limit && p.manager.getCurrent(); i++) {
      const current = p.manager.getCurrent();
      seen.push(current);
      if (until(current)) return seen;
      p.manager.advance();
    }
    return seen;
  };
  return { api, hooks, quest, p, object, custom, play, advance };
}

const flags = (p) => p.attrs.get('quest.fallen_from_grace.flags') ?? 0;
const textOf = (entry) => entry?.getText?.() ?? entry?.text ?? '';

test('Muriel moves the quest to 4 with her "Thank you..." (P1 tick 129), not before', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 3);
  h.play(16319, 'following-the-trail-talking-to-muriel');
  h.advance((entry) => textOf(entry).startsWith('I see. I\'ll go over there'));
  assert.equal(h.quest.getStage(p), 3, 'still 3 on the line before');
  h.advance((entry) => textOf(entry).startsWith('Thank you...'));
  assert.equal(h.quest.getStage(p), 4);
});

test('Mortimer\'s greeting is stage 9 -> 11 at "It was those three nearby trolls" (P2 tick 57); then his variants follow the kills', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 9);
  const variantFor = () => h.hooks.variants.map((fn) => fn({ npcId: 16294, player: p })).find(Boolean);
  assert.equal(variantFor(), 'the-way-under-ardeaglais-meeting-mortimer');
  h.play(16294, 'the-way-under-ardeaglais-meeting-mortimer');
  h.advance((entry) => textOf(entry).startsWith('Fair enough'));
  assert.equal(h.quest.getStage(p), 9);
  h.advance((entry) => textOf(entry).startsWith('It was those three nearby trolls'));
  assert.equal(h.quest.getStage(p), 11);
  assert.equal(variantFor(), 'the-way-under-ardeaglais-talking-to-mortimer-before-killing-the-trolls');
  p.attrs.set('quest.fallen_from_grace.flags', flags(p) | (1 << 9));
  assert.equal(variantFor(), 'the-way-under-ardeaglais-talking-to-mortimer-after-killing-the-trolls');
});

test('landing in the cavern at stage 9 spawns the private scene and starts Mortimer\'s greeting a tick later (P2 ticks 42-43)', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 9);
  h.custom('sailing:left', { player: p, reason: 'disembark' });
  assert.equal(h.hooks.spawned.length, 0, 'not on the gangplank tick');
  runTicks(1);
  const ids = h.hooks.spawned.map((npc) => [npc.id, npc.x, npc.y, npc.ownerOnly === true, npc.owner === p]);
  assert.deepEqual(ids, [
    [16294, 2601, 8608, true, true],
    [16330, 2593, 8604, true, true],
    [16331, 2591, 8610, true, true],
    [16332, 2588, 8609, true, true],
  ]);
  assert.equal(textOf(h.advance((entry) => textOf(entry).length > 0).at(-1)), 'Hey you! Get over here, quickly!');
});

test('only the quest\'s three trolls count, at stage 11; the third brings the flag, the message and Mortimer\'s shout (P2 tick 151)', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 11);
  for (const { zone, fn } of h.hooks.zones) if (zone.minY >= 8500) fn({ player: p });
  const [mortimer, ...trolls] = h.hooks.spawned;
  assert.equal(trolls.length, 3);
  const kill = (npcId, npc = null) => {
    const dead = npc ?? { getId: () => npcId, getLocation: () => new core.Location(2591, 8609, 0) };
    dead.getLocation ??= () => new core.Location(2591, 8609, 0);
    for (const fn of h.hooks.deaths) fn({ npc: dead, killer: p });
  };
  kill(936);
  assert.equal(p.attrs.get('quest.fallen_from_grace.troll-kills') ?? 0, 0, 'a generic mountain troll does not count');
  kill(16330, trolls[0]);
  kill(16331, trolls[1]);
  assert.equal(flags(p) & (1 << 9), 0);
  kill(16332, trolls[2]);
  assert.equal(flags(p) & (1 << 9), 1 << 9);
  assert.equal(h.quest.getStage(p), 11, 'the stage waits for Mortimer');
  assert.deepEqual(p.messages.slice(-1), ['You notice the skeleton calling you over.']);
  assert.deepEqual(mortimer.said, ['Hey! Come give me a hand over here.']);
});

test('the rockfall: a held message box and the fade, then stage 13 at 2590,8613 five ticks in (P2 ticks 162-167)', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 11);
  p.attrs.set('quest.fallen_from_grace.flags', flags(p) | (1 << 9));
  for (const { zone, fn } of h.hooks.zones) if (zone.minY >= 8500) fn({ player: p });
  assert.equal(h.hooks.spawned.length, 1, 'with the trolls dead, only the cutscene Mortimer');
  h.play(16294, 'the-way-under-ardeaglais-talking-to-mortimer-after-killing-the-trolls');
  h.advance((entry) => entry.constructor.name === 'ActionDialogue' && p.log.some((line) => line === 'anim 827'));
  assert.ok(p.log.includes('anim 827'), 'the pick-up animation');
  assert.ok(p.log.includes('overlay 174 255'), 'the fade out');
  runTicks(4);
  assert.equal(h.quest.getStage(p), 11);
  runTicks(1);
  assert.equal(h.quest.getStage(p), 13);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2590, 8613]);
  assert.equal(h.hooks.removed.length, 1, 'the cutscene Mortimer goes (the trolls are dead)');
});

test('the basement stairs with the key: the hatch, then the real cathedral at 2540,2214 and stage 16 two ticks in (P2 ticks 288-292)', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 15);
  p.items.set(I.STAIRCASE_KEY, 1);
  p.items.set(I.DULL_SUNSTONE_CORE, 1);
  const climb = h.custom('ladders:climb', { player: p, objectId: 62255, handled: false });
  assert.equal(climb.handled, true);
  assert.deepEqual(p.messages.slice(-1), ['You unlock a hatch at the top of the staircase and climb up into the cathedral.']);
  assert.ok(p.log.includes('sound 2419'));
  assert.equal(flags(p) & (1 << 6), 1 << 6, 'ffg_key_used');
  assert.equal(p.items.get(I.STAIRCASE_KEY), 0);
  runTicks(2);
  assert.equal(h.quest.getStage(p), 16);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2540, 2214]);
  assert.equal(p.items.get(I.DULL_SUNSTONE_CORE), 0, 'the dull core goes with it (tick 292)');

  // A second click during the fade is ignored; later climbs go straight up, without the hatch again.
  h.custom('ladders:climb', { player: p, objectId: 62255, handled: false });
  assert.equal(p.messages.filter((text) => text.startsWith('You unlock a hatch')).length, 1);
  runTicks(3);
  h.quest.setStage(p, 18);
  p.setLocationForTest(new core.Location(2575, 8657, 0));
  p.messages.length = 0;
  h.custom('ladders:climb', { player: p, objectId: 62255, handled: false });
  runTicks(2);
  assert.deepEqual(p.messages, []);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2540, 2214]);
});

test('Keenan\'s body hands over the letter in an item box at stage 18; reading it is stage 19 on the long scroll (P2 ticks 434, 449)', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 18);
  assert.equal(h.object(62374).handled, true);
  const box = h.advance((entry) => entry.constructor.name === 'ItemStatementDialogue').at(-1);
  assert.equal(box?.getItemId?.() ?? box?.itemId, I.FINAL_LETTER);
  assert.equal(p.items.get(I.FINAL_LETTER), 1);
  assert.equal(flags(p) & (1 << 13), 1 << 13, 'ffg_found_body');
  assert.equal(h.quest.getStage(p), 18, 'the body alone is not 19');
  h.advance();
  const read = { player: p, itemId: I.FINAL_LETTER, option: 'Read', handled: false };
  for (const fn of h.hooks.itemActions) fn(read);
  assert.equal(read.handled, true);
  assert.equal(h.quest.getStage(p), 19);
  assert.ok(p.log.includes('interface 625'), 'the long scroll');
  assert.ok(p.log.some((line) => line.startsWith('clientscript 418 |After all these years')));
});

test('the cathedral doors from outside, before the player is in, are "firmly locked" in a message box', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 13);
  const request = h.custom('madangel:cathedral-door', { player: p, objectId: 62368, handled: false });
  assert.equal(request.handled, true);
  const box = h.advance((entry) => textOf(entry).length > 0).at(-1);
  assert.equal(box?.constructor?.name, 'StatementDialogue');
  assert.match(textOf(box), /^The door is firmly locked\./);
  h.quest.setStage(p, 20);
  assert.equal(h.custom('madangel:cathedral-door', { player: p, objectId: 62368, handled: false }).handled, false, 'after the quest, the ordinary doors');
});

test('the monolith: the notebook in an item box at stage 4 (P1 tick 156), then mined 11 ticks after the swing (P1 ticks 168-180)', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 4);
  const definition = { getInteractions: () => ['Mine'] };
  const click = () => { const event = { player: p, objectId: 62216, clickType: 1, definition, handled: false }; for (const fn of h.hooks.object) fn(event); return event; };
  assert.equal(click().handled, true);
  const box = h.advance((entry) => entry.constructor.name === 'ItemStatementDialogue').at(-1);
  assert.equal(box?.getItemId?.() ?? box?.itemId, I.SCRAWLED_NOTEBOOK);
  assert.equal(h.quest.getStage(p), 5);
  assert.ok(p.log.includes('sound 2582'));
  assert.equal(flags(p) & (1 << 2), 0, 'ffg_keenans_book waits for the first read (P1 tick 161)');
  const read = { player: p, itemId: I.SCRAWLED_NOTEBOOK, option: 'Read', handled: false };
  for (const fn of h.hooks.itemActions) fn(read);
  assert.equal(flags(p) & (1 << 2), 1 << 2);
  h.advance();

  p.items.set(I.BRONZE_PICKAXE, 1);
  assert.equal(click().handled, true);
  assert.deepEqual(p.messages.slice(-1), ['You swing your pick at the monolith.']);
  runTicks(10);
  assert.equal(p.items.get(I.SUNSTONE) ?? 0, 0);
  runTicks(1);
  assert.equal(p.items.get(I.SUNSTONE), 1);
  assert.deepEqual(p.messages.slice(-1), ['You manage to mine some sunstone.']);
  assert.ok(p.log.includes('sound 3600'));
});

test('a troll killed before Mortimer\'s request still counts; the call comes with his request', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 9);
  for (const { zone, fn } of h.hooks.zones) if (zone.minY >= 8500) fn({ player: p });
  const [mortimer, ...trolls] = h.hooks.spawned;
  assert.equal(trolls.length, 3, 'the trolls are there on arrival (P2 tick 42)');
  const kill = (npc) => { npc.getLocation = () => new core.Location(2591, 8609, 0); for (const fn of h.hooks.deaths) fn({ npc, killer: p }); };
  for (const troll of trolls) kill(troll);
  assert.equal(flags(p) & (1 << 9), 0, 'not before he has asked');
  h.play(16294, 'the-way-under-ardeaglais-meeting-mortimer');
  h.advance((entry) => textOf(entry).startsWith('It was those three nearby trolls'));
  assert.equal(h.quest.getStage(p), 11);
  assert.equal(flags(p) & (1 << 9), 1 << 9, 'all three already dead');
  assert.deepEqual(mortimer.said, ['Hey! Come give me a hand over here.']);
});

test('the Mad Angel\'s sunstone crystal drops only when one is owed (Wiki: no bank chest built, none owned)', () => {
  const h = setup(), p = h.p;
  const ask = () => h.custom('npc-drops:quest-item', { player: p, itemId: I.SUNSTONE_CRYSTAL, allowed: undefined }).allowed;
  assert.equal(ask(), true);
  p.items.set(I.SUNSTONE_CRYSTAL, 1);
  assert.equal(ask(), false, 'one is carried');
  p.items.set(I.SUNSTONE_CRYSTAL, 0);
  p.sender.getVarbit = (id) => (id === 15774 ? 1 : 0);
  assert.equal(ask(), false, 'the bank chest is built');
  assert.equal(h.custom('npc-drops:quest-item', { player: p, itemId: 995, allowed: undefined }).allowed, undefined, 'other rows are left alone');
});

test('a logout during the stairs fade still reaches stage 16 on the next climb', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 15);
  p.items.set(I.STAIRCASE_KEY, 1);
  p.items.set(I.DULL_SUNSTONE_CORE, 1);
  h.custom('ladders:climb', { player: p, objectId: 62255, handled: false });
  p.isRegistered = () => false;
  runTicks(6);
  p.isRegistered = () => true;
  assert.equal(h.quest.getStage(p), 15, 'the move never happened');
  h.custom('ladders:climb', { player: p, objectId: 62255, handled: false });
  runTicks(2);
  assert.equal(h.quest.getStage(p), 16);
  assert.equal(p.items.get(I.DULL_SUNSTONE_CORE), 0);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2540, 2214]);
});

test('the door: sound 2402 with the question; seven wrong guesses end with the Wiki\'s numb-fingers box', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 19);
  p.getLocation = () => new core.Location(2541, 2215, 0);
  let prompt = null;
  h.api.sendMultiChatboxPrompt = (player, title, ...pairs) => { prompt = pairs; return true; };
  const request = h.custom('madangel:cathedral-door', { player: p, objectId: 62368, handled: false });
  assert.equal(request.handled, true);
  assert.ok(p.log.includes('sound 2402'));
  assert.ok(prompt, 'the question');
  prompt[1](p);
  assert.equal(p.interface, 811);
  for (let i = 0; i < 7; i++) {
    p.amountAction.execute(i === 0 ? 1 : 0);
    runTicks(1);
  }
  assert.equal(p.amountAction ?? null, null);
  assert.equal(textOf(p.manager.getCurrent()), "Your fingers go numb from fiddling with the lock. You'll need to try again.");
  assert.equal(flags(p) & (1 << 7), 0);
});

test('someone inside the doors before stage 16 is let out by the ordinary door', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 8);
  p.getLocation = () => new core.Location(2541, 2215, 0);
  assert.equal(h.custom('madangel:cathedral-door', { player: p, objectId: 62368, handled: false }).handled, false);
});

test('from stage 15 the powered golem lets the player back through the passage (ours: re-entry after a death or logout)', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 16);
  p.setLocationForTest(new core.Location(2573, 8649, 0));
  const event = { player: p, npcId: core.NpcIdentifiers.POWERED_GOLEM, handled: false };
  for (const fn of h.hooks.npcNamed.get('Powered golem') ?? []) fn(event);
  assert.equal(event.handled, true);
  runTicks(2);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2573, 8655]);
  h.quest.setStage(p, 20);
  const done = { player: p, npcId: core.NpcIdentifiers.POWERED_GOLEM, handled: false };
  for (const fn of h.hooks.npcNamed.get('Powered golem') ?? []) fn(done);
  assert.equal(done.handled, false, 'after the quest it is not the quest\'s');
});
