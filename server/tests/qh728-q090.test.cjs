// From server/: node --test tests/qh728-q090.test.cjs (after yarn build).
// Focused The Queen of Thieves contracts: the whole durable stage graph through
// the registered handlers, the varbit 6037 wire mapping (cache completion
// threshold 13), the chest's letter recovery, and post-quest dialogue fallback.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const index = require('../data/definitions/npc-dialogue-index.json');
const core = PluginManager.getCoreApi();
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer(options = {}) {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const log = [];
  const xp = [];
  const equipment = new Map();
  const varps=new Map(),varbits=new Map(),drops=[];
  let location = new core.Location(1796, 3782, 0);
  let thieving = options.thieving ?? 20;
  const fillers = [...Array(28).keys()].map(index => 900000 + index);
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return inventory;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return inventory;
    },
    forceAdd(owner,item) {
      if(inventory.getFreeSlots()>0 || items.has(item.getId())) inventory.adds(item.getId(),item.getAmount());
      else drops.push({isPendingRemoval:()=>false,getOwner:()=>owner.getUsername(),getItem:()=>item});
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      if ((items.get(id) ?? 0) === 0) items.delete(id);
      return true;
    },
    getFreeSlots: () => 28 - [...items.values()].filter(amount => amount > 0).length,
    isFull: () => inventory.getFreeSlots() <= 0,
    full: () => messages.push('Not enough space in your inventory.'),
  };
  const sender = new Proxy({getVarp:id=>varps.get(id)??0,getVarbit:id=>varbits.get(id)??0,
    sendVarbit(id,value){const d=CacheDefinitions.getVarbit(id),mask=(2**(d.endBit-d.startBit+1)-1)<<d.startBit;
      varps.set(d.baseVar,((varps.get(d.baseVar)??0)&~mask)|((value<<d.startBit)&mask));varbits.set(id,value);log.push(['sendVarbit',id,value]);return sender;},
  }, { get: (t, prop) => t[prop]??((...args) => { log.push([String(prop), ...args]); return sender; }) });
  return {
    attrs, items, messages, moves, log, xp, equipment, varps,varbits,drops,
    setFull(value) {
      if (value) {
        for (const id of fillers) {
          if (inventory.getFreeSlots() <= 0) break;
          if (!items.has(id)) items.set(id, 1);
        }
      } else {
        for (const id of fillers) items.delete(id);
      }
    },
    setThieving(level) { thieving = level; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getBanks: () => options.banks??[], getEquipment:()=>({getItems:()=>[...equipment.values()]}),
    getSkillManager: () => ({
      getMaxLevel: () => thieving,
      addExperiences: (_skill, amount) => xp.push(amount),
    }),
    getUsername: () => 'queen-test', getDisplayName: () => 'queen-test',
    getRights: () => 0,
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
  };
}

function wireValue(p, id = 6037) {
  for (let i = p.log.length - 1; i >= 0; i--) {
    const [name, packetId, value] = p.log[i];
    if (name === 'sendVarbit' && packetId === id) return value;
  }
  return null;
}

function harness({ realObjects = false } = {}) {
  const events = {};
  const variants = [];
  const conditions = [];
  const objectInteraction = [];
  const npcInteractions = [];
  const logins = [];
  const regionLoaded = [];
  const serverStartup = [];
  const logouts = [];
  const spawned = [];
  const npcs = [];
  const objectState = { objects: new Map(), registered: [], deregistered: [] };
  const world = { getNpcs: () => npcs, getPlayers: () => players };
  const players = [];
  const objectKey = (id, location) => `${id}:${location.x ?? location.getX()},${location.y ?? location.getY()},${location.z ?? location.getZ()}`;
  const testCore = {
    ...core,
    World:{getItems:()=>players.flatMap(p=>p.drops)},
    TaskManager: { submit: noop },
    MapObjects: {
      get: (id, location) => objectState.objects.get(objectKey(id, location)) ?? null,
      getHash: (x, y, z) => `${x},${y},${z}`,
      mapObjects: new Map(),
    },
    ObjectManager: {
      register: object => {
        objectState.registered.push(object);
        objectState.objects.set(objectKey(object.getId(), object.getLocation()), object);
      },
      deregister: (object, _sync) => {
        objectState.deregistered.push(object);
        objectState.objects.delete(objectKey(object.getId(), object.getLocation()));
      },
    },
  };
  if (realObjects) {
    testCore.MapObjects = core.MapObjects;
    testCore.ObjectManager = core.ObjectManager;
  }
  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(handler => handler(event)),
    onNpcInteraction: (name, options) => npcInteractions.push({ name, options }),
    onObjectInteraction: handler => objectInteraction.push(handler),
    onRegionLoaded: handler => regionLoaded.push(handler),
    onServerStartup: handler => serverStartup.push(handler),
    onPlayerLogin: handler => logins.push(handler),
    onPlayerLogout: handler => logouts.push(handler),
    onInterfaceActionButton: noop,
    getWorld: () => world,
    spawnNpc: definition => { spawned.push(definition); return definition; },
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/QueenOfThieves.Quest')(api);
  const npcOption = (name, option, event) => {
    for (const entry of npcInteractions) {
      if (entry.name === name && entry.options?.[option]) entry.options[option](event);
    }
  };
  return {
    api, events, variants, conditions, objectInteraction, npcInteractions, logins,
    regionLoaded, serverStartup, spawned, players, objectState, npcOption, logouts,
    objectAction: event => objectInteraction.forEach(handler => handler(event)),
    quest: runtime.getRegisteredQuests().findLast(entry => entry.key === 'the_queen_of_thieves'),
  };
}

const h = harness();

function completeClientOfKourend(p) {
  p.attrs.set('quest.client_of_kourend.stage', 5);
}

function chestObject(id) {
  return new core.GameObject(id, new core.Location(1681, 3677, 1), 10, 0, null);
}

function registeredChest(id) {
  return [...h.objectState.objects.values()].find(object => object.getId() === id);
}

test('fresh stage 0 follows every mandatory helper leg and completes on wire 13', () => {
  const p = makePlayer({ thieving: 20 });
  h.players.length = 0;
  h.players.push(p);
  completeClientOfKourend(p);
  assert.equal(h.quest.getStage(p), 0, 'fresh stage 0');

  // Requirements: 20 Thieving and Client of Kourend (which requires X Marks).
  p.setThieving(19);
  assert.equal(h.conditions[0]({ player: p, stepId: 'vvd2A9' }), true, 'below 20 Thieving takes the refusal branch');
  assert.equal(h.conditions[0]({ player: p, stepId: 'uYbU9d' }), false);
  const refused = { player: p, npcId: core.NpcIdentifiers.TOMAS_LAWRY, hook: 'quest:the-queen-of-thieves:start', handled: false };
  h.events['npc-dialogue:hook'].forEach(handler => handler(refused));
  assert.equal(h.quest.getStage(p), 0, 'the start hook refuses below 20 Thieving');
  p.setThieving(20);
  assert.equal(h.conditions[0]({ player: p, stepId: 'vvd2A9' }), false);
  assert.equal(h.conditions[0]({ player: p, stepId: 'uYbU9d' }), true);

  const start = { player: p, npcId: core.NpcIdentifiers.TOMAS_LAWRY, hook: 'quest:the-queen-of-thieves:start', handled: false };
  h.events['npc-dialogue:hook'].forEach(handler => handler(start));
  assert.equal(h.quest.getStage(p), 1, 'Tomas start hook');
  assert.equal(wireValue(p), 1);

  const poor = { player: p, npcId: core.NpcIdentifiers.POOR_LOOKING_MAN, handled: false };
  h.npcOption('Poor looking man', 'Talk-to', poor);
  assert.equal(poor.handled, true, 'the quest owns the Poor looking man Talk-to');
  assert.equal(h.quest.getStage(p), 2, 'locals name Robert');
  assert.equal(wireValue(p), 2);

  h.events['npc-dialogue:condition'].forEach(handler => handler({ player: p, stepId: 'T-CKQt' }));
  assert.equal(h.quest.getStage(p), 3, 'Robert asks for stew');
  assert.equal(wireValue(p), 3);

  p.items.set(core.ItemIdentifiers.STEW, 1);
  const stew = { player: p, npcId: core.NpcIdentifiers.ROBERT_OREILLY, stepId: 'SuV2zA', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(stew));
  assert.equal(h.quest.getStage(p), 4, 'stew handed to Robert');
  assert.equal(p.items.get(core.ItemIdentifiers.STEW) ?? 0, 0, 'stew is consumed');
  assert.equal(wireValue(p), 4);

  const devanTask = {
    player: p, npcId: core.NpcIdentifiers.DEVAN_RUTTER,
    text: "Good. You'll find Conrad King south of the Piscarilius Foodhall. News travels fast around here so we'll know when the deed is done.",
  };
  h.events['npc-dialogue:line'].forEach(handler => handler(devanTask));
  assert.equal(h.quest.getStage(p), 5, 'Devan gives the Conrad task');
  assert.equal(wireValue(p), 6, 'helper key 6 is killConrad');

  const kill = { player: p, npcId: core.NpcIdentifiers.CONRAD_KING, stepId: '29NrrK', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(kill));
  assert.equal(h.quest.getStage(p), 6, 'Conrad killed');
  assert.equal(wireValue(p), 7, 'helper key 7 is tellDevan');

  const devanPraise = {
    player: p, npcId: core.NpcIdentifiers.DEVAN_RUTTER,
    text: 'Word on the streets is that Conrad King has met his maker. The queen is impressed. You should head on in and speak to her.',
  };
  h.events['npc-dialogue:line'].forEach(handler => handler(devanPraise));
  assert.equal(h.quest.getStage(p), 7, 'queen is impressed');
  assert.equal(wireValue(p), 8, 'helper key 8 is the queen talk');

  const reveal = { player: p, npcId: core.NpcIdentifiers.THE_QUEEN_OF_THIEVES, text: 'Now get lost.' };
  h.events['npc-dialogue:line'].forEach(handler => handler(reveal));
  assert.equal(h.quest.getStage(p), 8, 'queen revealed');
  assert.equal(wireValue(p), 10, 'helper key 10 is exposeHughes');

  const pick = { player: p, objectId: core.ObjectIdentifiers.CHEST_136, object: chestObject(core.ObjectIdentifiers.CHEST_136), location: { x: 1681, y: 3677, z: 1 }, handled: false };
  h.objectAction(pick);
  assert.equal(pick.handled, true);
  assert.equal(h.quest.getStage(p), 8, 'picklocking does not advance the stage');
  const search = registeredChest(core.ObjectIdentifiers.CHEST_137);
  assert.ok(search, 'picklocking registers the searchable chest');
  const searchEvent = { player: p, objectId: core.ObjectIdentifiers.CHEST_137, object: search, location: { x: 1681, y: 3677, z: 1 }, handled: false };
  h.objectAction(searchEvent);
  assert.equal(searchEvent.handled, true);
  assert.equal(p.items.get(core.ItemIdentifiers.LETTER_7), 1, 'letter is found');
  assert.equal(h.quest.getStage(p), 9, 'letter found');
  assert.equal(wireValue(p), 11, 'helper key 11 is talkToLawry2');

  const giveLetter = { player: p, npcId: core.NpcIdentifiers.TOMAS_LAWRY, stepId: 'CI6IE4', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(giveLetter));
  assert.equal(h.quest.getStage(p), 10, 'Tomas takes the letter');
  assert.equal(p.items.get(core.ItemIdentifiers.LETTER_7) ?? 0, 0, 'letter is consumed');
  assert.equal(wireValue(p), 12, 'helper key 12 is talkToShauna');

  const complete = { player: p, npcId: core.NpcIdentifiers.THE_QUEEN_OF_THIEVES, stepId: '4FEXH_', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(complete));
  assert.equal(complete.handled, true);
  assert.equal(h.quest.getStage(p), 11, 'quest completed');
  assert.equal(wireValue(p), 13, 'the cache completion threshold is 13');
  assert.equal(p.items.get(core.ItemIdentifiers.COINS), 2000, '2000 coins');
  assert.equal(p.items.get(core.ItemIdentifiers.THE_FISHERS_FLUTE), 1, "The Fisher's Flute");
  assert.deepEqual(p.xp, [2000], '2000 Thieving XP once');
  assert.ok(p.messages.some(message => message.includes('Congratulations')), 'completion message');

  const repeat = { player: p, npcId: core.NpcIdentifiers.THE_QUEEN_OF_THIEVES, stepId: '4FEXH_', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(repeat));
  assert.equal(p.items.get(core.ItemIdentifiers.COINS), 2000, 'repeat completion pays no second coin reward');
  assert.deepEqual(p.xp, [2000], 'repeat completion pays no second XP reward');
  assert.equal(p.items.get(core.ItemIdentifiers.THE_FISHERS_FLUTE), 1, 'repeat completion grants no second page');
});

test('login and bootstrap replay the canonical wire value without changing the durable save', () => {
  const p = makePlayer();
  completeClientOfKourend(p);
  h.quest.setStage(p, 11);
  p.log.length = 0;

  h.logins.forEach(handler => handler({ player: p, username: p.getUsername() }));
  assert.equal(wireValue(p), 13, 'login resends varbit 6037 = 13');
  assert.equal(h.quest.getStage(p), 11, 'the durable save stays at 11');

  p.log.length = 0;
  h.events['player:bootstrap-complete'].forEach(handler => handler({ player: p }));
  assert.equal(wireValue(p), 13, 'bootstrap-complete resends varbit 6037 = 13');
});

test('login and bootstrap replay the completed reward bit from the durable quest stage', () => {
  const p = makePlayer();
  h.quest.setStage(p, 11);
  p.log.length = 0;

  h.logins.forEach(handler => handler({ player: p, username: p.getUsername() }));
  assert.equal(wireValue(p, 6038), 1, 'completed quest restores piscquest_reward on login');

  p.getPacketSender().sendVarbit(6038, 0);
  p.log.length = 0;
  h.events['player:bootstrap-complete'].forEach(handler => handler({ player: p }));
  assert.equal(wireValue(p, 6038), 1, 'bootstrap restores piscquest_reward after varp initialization');
  assert.equal(h.quest.getStage(p), 11, 'replay does not alter the durable quest stage');

  const incomplete = makePlayer();
  h.quest.setStage(incomplete, 10);
  incomplete.log.length = 0;
  h.logins.forEach(handler => handler({ player: incomplete, username: incomplete.getUsername() }));
  assert.equal(wireValue(incomplete, 6038), null, 'an incomplete quest does not claim the reward');
});

test('a destroyed letter can be searched again before hand-in but not after', () => {
  const p = makePlayer();
  h.players.length = 0;
  h.players.push(p);
  completeClientOfKourend(p);
  h.quest.setStage(p, 8);
  p.attrs.set('quest.the_queen_of_thieves.chest', 1);
  h.regionLoaded.forEach(handler => handler({ regionId: ((1681 >> 6) << 8) | (3677 >> 6) }));

  const search = registeredChest(core.ObjectIdentifiers.CHEST_137);
  assert.ok(search, 'an unlocked chest is searchable after a region load');
  const first = { player: p, objectId: core.ObjectIdentifiers.CHEST_137, object: search, location: { x: 1681, y: 3677, z: 1 }, handled: false };
  h.objectAction(first);
  assert.equal(p.items.get(core.ItemIdentifiers.LETTER_7), 1, 'the first search grants a letter');
  assert.equal(h.quest.getStage(p), 9);

  const again = { player: p, objectId: core.ObjectIdentifiers.CHEST_137, object: registeredChest(core.ObjectIdentifiers.CHEST_137), location: { x: 1681, y: 3677, z: 1 }, handled: false };
  h.objectAction(again);
  assert.equal(p.items.get(core.ItemIdentifiers.LETTER_7), 1, 'holding the letter cannot duplicate it');
  assert.ok(p.messages.includes('The chest is empty.'));

  p.items.delete(core.ItemIdentifiers.LETTER_7);
  p.log.length = 0;
  h.regionLoaded.forEach(handler => handler({ regionId: ((1681 >> 6) << 8) | (3677 >> 6) }));
  const restored = registeredChest(core.ObjectIdentifiers.CHEST_137);
  assert.ok(restored, 'a region reload keeps the searched chest searchable');
  const recovered = { player: p, objectId: core.ObjectIdentifiers.CHEST_137, object: restored, location: { x: 1681, y: 3677, z: 1 }, handled: false };
  h.objectAction(recovered);
  assert.equal(p.items.get(core.ItemIdentifiers.LETTER_7), 1, 'the destroyed letter is reobtained');

  h.quest.setStage(p, 10);
  const late = { player: p, objectId: core.ObjectIdentifiers.CHEST_137, object: registeredChest(core.ObjectIdentifiers.CHEST_137), location: { x: 1681, y: 3677, z: 1 }, handled: false };
  h.objectAction(late);
  assert.equal(p.items.get(core.ItemIdentifiers.LETTER_7), 1, 'after the hand-in the chest grants nothing more');
  assert.ok(p.messages.includes('The chest is empty.'));
});

test('full bag refuses the letter without opening the chest or advancing', () => {
  const p = makePlayer();
  h.players.length = 0;
  h.players.push(p);
  const early = { player: p, objectId: core.ObjectIdentifiers.CHEST_136, object: chestObject(core.ObjectIdentifiers.CHEST_136), location: { x: 1681, y: 3677, z: 1 }, handled: false };
  h.objectAction(early);
  assert.equal(early.handled, true);
  assert.ok(p.messages.includes('You have no reason to pick the lock on this chest.'), 'the chest is refused before the reveal');
  assert.equal(h.quest.getStage(p), 0);
  h.quest.setStage(p, 8);
  const pick = { player: p, objectId: core.ObjectIdentifiers.CHEST_136, object: chestObject(core.ObjectIdentifiers.CHEST_136), location: { x: 1681, y: 3677, z: 1 }, handled: false };
  h.objectAction(pick);
  p.setFull(true);
  const search = { player: p, objectId: core.ObjectIdentifiers.CHEST_137, object: registeredChest(core.ObjectIdentifiers.CHEST_137), location: { x: 1681, y: 3677, z: 1 }, handled: false };
  h.objectAction(search);
  assert.equal(p.items.get(core.ItemIdentifiers.LETTER_7) ?? 0, 0, 'no letter on a full bag');
  assert.equal(h.quest.getStage(p), 8, 'the stage does not advance');
  assert.ok(p.messages.includes('You need a free inventory space.'));
});

test('variant selection switches on every durable stage and post-quest falls back to Lady Shauna', () => {
  const p = makePlayer();
  completeClientOfKourend(p);
  const variant = npcId => h.variants[0]({ player: p, npcId });
  h.quest.setStage(p, 4);
  assert.equal(variant(core.NpcIdentifiers.DEVAN_RUTTER), 'stewing-in-the-sewers-talking-to-devan');
  h.quest.setStage(p, 5);
  assert.equal(variant(core.NpcIdentifiers.DEVAN_RUTTER), 'stewing-in-the-sewers-talking-to-devan-again');
  h.quest.setStage(p, 6);
  assert.equal(variant(core.NpcIdentifiers.DEVAN_RUTTER), 'revelation-of-a-redhead-returning-to-devan');
  h.quest.setStage(p, 7);
  assert.equal(variant(core.NpcIdentifiers.THE_QUEEN_OF_THIEVES), 'revelation-of-a-redhead-talking-to-the-queen-of-thieves');
  h.quest.setStage(p, 8);
  assert.equal(variant(core.NpcIdentifiers.THE_QUEEN_OF_THIEVES), 'revelation-of-a-redhead-talking-to-the-queen-of-thieves-again');
  h.quest.setStage(p, 9);
  p.items.set(core.ItemIdentifiers.LETTER_7, 1);
  assert.equal(variant(core.NpcIdentifiers.TOMAS_LAWRY), 'bringing-down-the-law-ry-returning-to-tomas');
  h.quest.setStage(p, 10);
  assert.equal(variant(core.NpcIdentifiers.TOMAS_LAWRY), 'bringing-down-the-law-ry-returning-to-tomas-talking-to-tomas-again');
  assert.equal(variant(core.NpcIdentifiers.THE_QUEEN_OF_THIEVES), 'bringing-down-the-law-ry-returning-to-lady-piscarilius');

  h.quest.setStage(p, 11);
  p.items.set(core.ItemIdentifiers.THE_FISHERS_FLUTE,1);
  assert.equal(variant(core.NpcIdentifiers.THE_QUEEN_OF_THIEVES), null, 'post-quest uses the NPC default page');
  const defaultPages = index[String(core.NpcIdentifiers.THE_QUEEN_OF_THIEVES)];
  assert.equal(defaultPages?.[0]?.page, 'Transcript:Lady Shauna Piscarilius', 'NPC 7908 defaults to Lady Shauna dialogue');
});

test('Conrad keeps his Murder option scoped to the Devan task', () => {
  const p = makePlayer();
  completeClientOfKourend(p);
  const murder = { player: p, npcId: core.NpcIdentifiers.CONRAD_KING, handled: false };
  h.npcOption('Conrad King', 'Murder', murder);
  assert.equal(murder.handled, true);
  assert.ok(p.messages.includes('You have no reason to kill this man.'));
  assert.equal(h.quest.getStage(p), 0);

  h.quest.setStage(p, 5);
  const later = { player: p, npcId: core.NpcIdentifiers.CONRAD_KING, handled: false };
  h.npcOption('Conrad King', 'Murder', later);
  assert.equal(later.handled, true);
  h.quest.setStage(p, 6);
  const already = { player: p, npcId: core.NpcIdentifiers.CONRAD_KING, handled: false };
  h.npcOption('Conrad King', 'Murder', already);
  assert.ok(p.messages.includes('You have already dealt with Conrad King.'));
});

test('the manhole opens and the ladder returns to the surface landing', () => {
  const p = makePlayer();
  h.players.length = 0;
  h.players.push(p);
  const closed = new core.GameObject(core.ObjectIdentifiers.MANHOLE_7, new core.Location(1813, 3745, 0), 10, 0, null);
  const openEvent = { player: p, objectId: core.ObjectIdentifiers.MANHOLE_7, object: closed, location: { x: 1813, y: 3745, z: 0 }, handled: false };
  h.objectAction(openEvent);
  assert.equal(openEvent.handled, true);
  assert.ok(registeredChest(core.ObjectIdentifiers.MANHOLE_8), 'closed manhole becomes the open manhole');

  const ladder = new core.GameObject(core.ObjectIdentifiers.LADDER_367, new core.Location(1813, 10145, 0), 10, 0, null);
  const up = { player: p, objectId: core.ObjectIdentifiers.LADDER_367, object: ladder, location: { x: 1813, y: 10145, z: 0 }, handled: false };
  let climbed = null;
  h.events['ladders:climbUp'] = [event => { climbed = event; }];
  h.objectAction(up);
  assert.equal(up.handled, true);
  assert.ok(climbed, 'the ladder hands off to the ladders climb-up event');
  assert.deepEqual([climbed.destination.getX(), climbed.destination.getY(), climbed.destination.getZ()], [1813, 3746, 0]);
});

test('the Warrens tent doorway moves the player to the far side of its wall', () => {
  const p = makePlayer();
  const door = new core.GameObject(core.ObjectIdentifiers.DOORWAY_10, new core.Location(1765, 10149, 0), 10, 0, null);
  p.setLocation(1765, 10148, 0);
  const enter = { player: p, objectId: core.ObjectIdentifiers.DOORWAY_10, object: door, location: { x: 1765, y: 10149, z: 0 }, handled: false };
  h.objectAction(enter);
  assert.equal(enter.handled, true);
  assert.deepEqual(p.moves.at(-1), [1765, 10151, 0]);

  p.setLocation(1765, 10150, 0);
  const leave = { player: p, objectId: core.ObjectIdentifiers.DOORWAY_10, object: door, location: { x: 1765, y: 10149, z: 0 }, handled: false };
  h.objectAction(leave);
  assert.deepEqual(p.moves.at(-1), [1765, 10148, 0]);
});


test('placed transform parents own the reveal and login replay without cloned children', () => {
  const p = makePlayer(), resolve = id => CacheDefinitions.resolveNpc(id, p.getPacketSender())?.id;
  assert.equal(resolve(7926), 7904);
  assert.equal(resolve(7928), undefined, "Conrad is absent before his task");
  h.quest.setStage(p, 5);
  assert.equal(resolve(7928), 7907);
  assert.equal(resolve(7929), 7908);
  h.quest.setStage(p, 7);
  assert.equal(resolve(7929), 7908);
  p.getPacketSender().sendVarbit(6038, 1);
  h.quest.setStage(p, 8);
  assert.equal(resolve(7929), 7909);
  assert.equal(p.varps.get(1672) & 63, 10, 'progress bits remain canonical');
  assert.equal((p.varps.get(1672) >> 6) & 1, 1, 'reward sibling is preserved');
  const spawns = require('../data/definitions/npc-spawns.json');
  for (const id of [7926, 7928, 7929]) assert.ok(spawns.some(npc => npc.id === id));
  h.serverStartup.forEach(fn => fn());
  assert.equal(h.spawned.length, 0);
  for (const replay of [() => h.logins.forEach(fn => fn({ player: p })), () => h.api.emitCustomEvent('player:bootstrap-complete', { player: p })]) {
    p.varbits.set(12145, 0); replay(); assert.equal(resolve(7929), 7909);
  }
});

test('the real Lady Shauna reward id pays full-bag coins once', () => {
  const p = makePlayer(); h.quest.setStage(p, 10); p.setFull(true);
  assert.equal(h.variants[0]({ player: p, npcId: 7909 }), 'bringing-down-the-law-ry-returning-to-lady-piscarilius');
  const e = { player: p, npcId: 7909, stepId: '4FEXH_', handled: false };
  h.api.emitCustomEvent('npc-dialogue:action', e);
  assert.equal(e.handled, true); assert.equal(h.quest.getStage(p), 11);
  assert.equal(p.drops.find(d => d.getItem().getId() === 995)?.getItem().getAmount(), 2000);
  h.api.emitCustomEvent('npc-dialogue:action', { ...e, handled: false });
  assert.equal(p.drops.filter(d => d.getItem().getId() === 995).length, 1);
  assert.deepEqual(p.xp, [2000]);
});

function reclaimLine(p) {
  const e = { player: p, npcId: 7909, text: 'Looking for your reward, idiot? Take it and get lost.' };
  h.api.emitCustomEvent('npc-dialogue:line', e); return e;
}
const LOST_PAGE_VARIANT = 'if-the-player-lost-the-memoir-page-before-using-it-on-the-memoir';
test('reclaim waits for Continue, retries full bags and guards bank, equipment and recorded pages', () => {
  const banks = [null], p = makePlayer({ banks }); h.quest.setStage(p, 11);
  const variant = () => h.variants[0]({ player: p, npcId: 7909 });
  assert.equal(variant()?.variant, LOST_PAGE_VARIANT);
  const cancelled = reclaimLine(p);
  assert.equal(p.items.has(21764), false, 'showing or cancelling the final line grants nothing');
  p.setFull(true); cancelled.after();
  assert.equal(p.drops.length, 0, 'full bag leaves page available for retry');
  assert.equal(variant()?.variant, LOST_PAGE_VARIANT);
  p.setFull(false); reclaimLine(p).after();
  assert.equal(p.items.get(21764), 1); assert.equal(variant(), null);
  p.items.delete(21764); banks.push({ getAmount: id => id === 21764 ? 1 : 0 });
  assert.equal(variant(), null, 'banked page'); banks.length = 0;
  p.equipment.set(0, new core.Item(21764, 1)); assert.equal(variant(), null, 'equipped page');
  p.equipment.clear(); p.getPacketSender().sendVarbit(7921, 1);
  assert.equal(variant(), null, 'page already in memoir');
});

test('real lost-page transcript waits for final Continue, cancellation and full-bag retry', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const p = makePlayer(); h.quest.setStage(p, 11);
  const manager = new DialogueManager(p); p.getDialogueManager = () => manager;
  const start = () => runtime.startTranscript(h.api, p, 7909, 'Lady Shauna Piscarilius', LOST_PAGE_VARIANT);
  assert.equal(start(), true); assert.equal(p.items.has(21764), false);
  manager.reset(); assert.equal(p.items.has(21764), false);
  p.setFull(true); start(); manager.advance();
  assert.equal(p.items.has(21764), false); assert.equal(p.drops.length, 0);
  p.setFull(false); start(); assert.equal(p.items.has(21764), false);
  manager.advance(); assert.equal(p.items.get(21764), 1);
  start(); manager.advance(); assert.equal(p.items.get(21764), 1);
});

test('QOT and actual AKD hooks preserve earned reveal and hidden forms in either order', () => {
  const filename = require.resolve('../plugins/quests/quests/AKingdomDivided.Quest');
  let register;
  if (process.env.Q090_AKD_SOURCE) {
    const Module = require('node:module'), mod = new Module(filename, module);
    mod.filename = filename; mod.paths = module.paths;
    mod._compile(require('node:fs').readFileSync(process.env.Q090_AKD_SOURCE, 'utf8'), filename);
    register = mod.exports;
  } else register = require(filename);
  const firstLogin = h.logins.length, firstStage = h.events['quest:stage-changed'].length;
  register(h.api);
  const akd = runtime.getRegisteredQuests().find(q => q.key === 'a_kingdom_divided');
  const qhooks = h.events['quest:stage-changed'].slice(0, firstStage), ahooks = h.events['quest:stage-changed'].slice(firstStage);
  const qlogins = h.logins.slice(0, firstLogin), alogins = h.logins.slice(firstLogin);
  const later = makePlayer();
  akd.setStage(later, 110);
  later.getPacketSender().sendVarbit(12145, 0);
  h.api.emitCustomEvent('player:bootstrap-complete', { player: later });
  assert.equal(later.varbits.get(12145), 1, 'QOT respects the actual later AKD stage query');
  for (const reverse of [false, true]) {
    const hooks = reverse ? [...ahooks, ...qhooks] : [...qhooks, ...ahooks];
    const logins = reverse ? [...alogins, ...qlogins] : [...qlogins, ...alogins];
    const p = makePlayer(); h.quest.setStage(p, 8); akd.setStage(p, 0);
    p.getPacketSender().sendVarbit(12145, 0);
    hooks.forEach(fn => fn({ player: p, key: 'a_kingdom_divided' }));
    assert.equal(p.varbits.get(12145), 1, 'AKD zero cannot remask earned Shauna');
    p.getPacketSender().sendVarbit(12145, 0); logins.forEach(fn => fn({ player: p }));
    h.api.emitCustomEvent('player:bootstrap-complete', { player: p });
    assert.equal(p.varbits.get(12145), 1, 'login/bootstrap retain reveal in either order');
    for (const value of [2, 3]) {
      p.getPacketSender().sendVarbit(12145, value);
      hooks.forEach(fn => fn({ player: p, key: 'a_kingdom_divided' }));
      logins.forEach(fn => fn({ player: p })); h.api.emitCustomEvent('player:bootstrap-complete', { player: p });
      assert.equal(p.varbits.get(12145), value, 'later hidden form stays hidden');
      assert.equal(CacheDefinitions.resolveNpc(7929, p.getPacketSender()), undefined);
    }
  }
});


test('floor reward and an existing recorded-page varbit block reclaim across replay', () => {
  const p = makePlayer(); h.players.length = 0; h.players.push(p); h.quest.setStage(p, 10); p.setFull(true);
  h.api.emitCustomEvent('npc-dialogue:action', { player: p, npcId: 7909, stepId: '4FEXH_', handled: false });
  assert.equal(h.variants[0]({ player: p, npcId: 7909 }), null, 'owned reward on floor blocks replacement');
  p.drops.length = 0; p.setFull(false);
  p.getPacketSender().sendVarbit(7921, 1);
  h.logins.forEach(fn => fn({ player: p })); h.api.emitCustomEvent('player:bootstrap-complete', { player: p });
  assert.equal(h.variants[0]({ player: p, npcId: 7909 }), null, 'recorded page stays unavailable');
  assert.equal(p.varbits.get(7921), 1);
});

test('actual Lady Shauna Talk-to dispatch chooses the quest reward over her default page', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const p = makePlayer();
  h.quest.setStage(p, 10);
  const manager = new DialogueManager(p);
  p.getDialogueManager = () => manager;
  let talk;
  h.api.onAnyNpcInteraction = options => { talk = options['Talk-to']; };
  require('../plugins/npcs/NpcDialogues.plugin').register(h.api);
  const hook = { pluginName: 'q090-actual-dispatch', handler: h.variants[0] };
  PluginManager.npcDialogueVariantHooks.unshift(hook);
  try {
    const npc = new NPC(7929, new core.Location(1764, 10158, 0));
    const id = CacheDefinitions.resolveNpc(npc.getId(), p.getPacketSender()).id;
    assert.equal(id, 7909);
    assert.equal(talk({ player: p, npc, npcId: id, definition: NpcDefinition.forId(id) }), true);
    for (let count = 0; count < 40 && manager.isActive(); count++) manager.advance();
    assert.equal(h.quest.getStage(p), 11, 'real indexed Talk-to runs the mandatory quest reward');
    assert.equal(p.items.get(995), 2000);
    assert.equal(p.items.get(21764), 1);
    assert.deepEqual(p.xp, [2000]);
  } finally {
    PluginManager.npcDialogueVariantHooks.splice(PluginManager.npcDialogueVariantHooks.indexOf(hook), 1);
  }
});

test('real owner chest overlays keep two players independent and preserve map geometry through logout', () => {
  const local = harness({ realObjects: true });
  const a = makePlayer(), b = makePlayer();
  const location = new core.Location(1681, 3677, 1);
  const base = core.MapObjects.get(10084, location, null);
  assert.ok(base, 'active map has the original Hughes chest');
  assert.equal(base.getType(), 10);
  assert.equal(base.getFace(), 0);
  const clipping = RegionManager.getClipping(1681, 3677, 1, null);
  const own = (p, id) => core.MapObjects.getPrivateArea(p, id, location);
  local.quest.setStage(a, 8);
  local.quest.setStage(b, 8);
  local.logins.forEach(fn => { fn({ player: a }); fn({ player: b }); });
  try {
    assert.equal(own(a, 41760)?.getOwner(), a);
    assert.equal(own(b, 41760)?.getOwner(), b);
    local.objectAction({ player: a, objectId: 41760, object: own(a, 41760), location });
    assert.equal(own(a, 41761)?.getOwner(), a);
    assert.equal(own(b, 41760)?.getOwner(), b, 'another player must still pick the lock');
    local.objectAction({ player: b, objectId: 41761, object: own(a, 41761), location });
    assert.equal(b.items.has(21774), false, 'Search cannot bypass this player\'s lock');
    assert.equal(local.quest.getStage(b), 8);
    local.objectAction({ player: a, objectId: 41761, object: own(a, 41761), location });
    assert.equal(a.items.get(21774), 1);
    local.logouts.forEach(fn => fn({ player: a }));
    assert.equal(core.MapObjects.ownerObjectsInScene(a, 1664, 3648, 64).length, 0);
    local.logins.forEach(fn => fn({ player: a }));
    assert.equal(own(a, 41761)?.getOwner(), a, 'login rebuilds saved Search state');
    assert.equal(own(b, 41760)?.getOwner(), b);
    assert.equal(core.MapObjects.get(10084, location, null), base, 'base map chest remains intact');
    assert.equal(RegionManager.getClipping(1681, 3677, 1, null), clipping, 'owner visuals do not change shared clipping');
  } finally {
    local.logouts.forEach(fn => { fn({ player: a }); fn({ player: b }); });
  }
});
