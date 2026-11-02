// Tree Gnome Village (q117) source contracts.
// From server/: node --test tests/qh728-q117.test.cjs
//
// Registered-handler tests: a starting stage and inventory are fixture-set where
// noted, then the plugin's real registered handlers receive the transcript/object
// events. The transcript runner itself is spied so these assert the selected page
// and variant, not a live dialogue playthrough.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;

const PAGE = 'Tree Gnome Village';
const VARP = 111;
const VARBIT_ORBS = 598;
const VARBIT_TRACKER_H = 599;
const VARBIT_TRACKER_Y = 600;
const VARBIT_TRACKER_X = 601;
const VARBIT_BALLISTA = 602;
const WARLORD_SPAWN = 4971;
const ELKOY_OUTSIDE = 6265;

function makePlayer() {
  const attrs = new Map();
  const slots = new Array(28).fill(null);
  const messages = [];
  const varbits = new Map();
  const configs = new Map();
  const experience = [];
  let full = false;
  let location = new core.Location(2541, 3170, 0);
  const used = () => slots.reduce((count, item) => count + (item ? 1 : 0), 0);

  const inventory = {
    getAmount(id) {
      return slots.reduce((total, item) => total + (item?.getId?.() === id ? item.getAmount() : 0), 0);
    },
    adds(id, amount = 1) {
      if (full) return false;
      for (let i = 0; i < amount; i++) {
        const slot = slots.indexOf(null);
        if (slot === -1) return false;
        slots[slot] = new core.Item(id, 1);
      }
      return true;
    },
    forceAdd(_player, item) {
      const slot = slots.indexOf(null);
      if (slot === -1) return false;
      slots[slot] = new core.Item(item.getId(), item.getAmount());
      return true;
    },
    deleteNumber(id, amount = 1) {
      let left = amount;
      for (let i = 0; i < slots.length && left > 0; i++) {
        if (slots[i]?.getId?.() !== id) continue;
        slots[i] = null;
        left--;
      }
      return left === 0;
    },
    getFreeSlots() { return full ? 0 : slots.filter((item) => item === null).length; },
    isFull() { return full || used() >= slots.length; },
    full() { messages.push('Not enough space in your inventory.'); },
  };

  const sender = new Proxy({
    getVarbit: id => varbits.get(id) ?? 0, getVarp: id => configs.get(id) ?? 0,
    sendVarbit(id, value) {
      const {baseVar,startBit,endBit}=CacheDefinitions.getVarbit(id);
      const mask=(2**(endBit-startBit+1)-1)<<startBit;
      configs.set(baseVar,((configs.get(baseVar)??0)&~mask)|((value<<startBit)&mask));
      varbits.set(id, value); return sender;
    },
    sendConfig(id, value) { configs.set(id, value); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const player = {
    attrs, messages, varbits, configs, experience,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    moveTo(next) { location = next; },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getSkillManager: () => ({
      addExperiences(skill, amount) { experience.push({ skill, amount }); },
    }),
    getUsername: () => 'qh728-q117',
    getPrivateArea: () => null,
    getLocation: () => location,
    isPlayer: () => true, isNpc: () => false, getIndex: () => 1,
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
  };
  return player;
}

function harness() {
  const events = new Map();
  const variants = [];
  const conditions = [];
  const objectHooks = [];
  const deathHooks = [];
  const loginHooks = [];
  const transcripts = [];
  const groundItems = [];
  const spawned = [], logoutHooks = [];
  const tasks=[];
  const api = new Proxy({
    core:{...core,TaskManager:{submit(task){task.setRunning(true);if(task.isImmediate())task.execute();tasks.push(task);}}},
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onObjectInteraction: (handler) => objectHooks.push(handler),
    onNpcDeath: (handler) => deathHooks.push(handler),
    onPlayerLogin: (handler) => loginHooks.push(handler),
    onPlayerLogout: handler => logoutHooks.push(handler),
    spawnNpc(definition) {
      const npc=new NPC(definition.id,new core.Location(definition.x,definition.y,definition.z));
      npc.setOwner(definition.owner);npc.isRegistered=()=>!npc.removed;
      spawned.push(npc);return npc;
    },
    removeNpc(npc){npc.removed=true;},
    onCustomEvent: (name, handler) => {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(handler);
    },
    emitCustomEvent: (name, event) => {
      for (const handler of events.get(name) ?? []) handler(event);
    },
    getItemOnGroundManager: () => ({
      registerLocation(player, item, at) { groundItems.push({ player, itemId: item.getId(), at }); },
      getGroundItem(owner, itemId, at) {
        return groundItems.find((entry) => entry.player.getUsername() === owner && entry.itemId === itemId
          && core.Location.isSameTile(entry.at, at)) ?? null;
      },
    }),
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const originalStart = runtime.startTranscript;
  runtime.startTranscript = (_api, _player, npcId, page, variant) => {
    transcripts.push({ npcId, page, variant });
    return true;
  };
  try {
    require('../plugins/quests/quests/TreeGnomeVillage.Quest')(api);
  } finally {
    runtime.startTranscript = originalStart;
  }
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'tree_gnome_village');
  return { api,tasks,events, variants, conditions, objectHooks, deathHooks, loginHooks, transcripts, groundItems, spawned, logoutHooks, quest };
}

function emit(h, name, event) {
  for (const handler of h.events.get(name) ?? []) handler(event);
}

function variant(h, player, npcId) {
  for (const handler of h.variants) {
    const choice = handler({ npcId, player });
    if (choice) return choice;
  }
  return null;
}

function choose(h, player, npcId, option) {
  emit(h, 'npc-dialogue:choice', { player, npcId, option });
}

function condition(h, player, npcId, stepId, text) {
  let answer = null;
  for (const handler of h.conditions) {
    const result = handler({ player, npcId, stepId, text });
    if (typeof result === 'boolean') { answer = result; break; }
  }
  // NpcDialogues emits condition_chosen only for the branch it actually picks.
  if (answer === true) emit(h, 'npc-dialogue:condition', { player, npcId, stepId, text });
  return answer;
}

function action(h, player, npcId, stepId) {
  const event = { player, npcId, stepId, handled: false, end: false };
  emit(h, 'npc-dialogue:action', event);
  return event;
}

function object(h, player, objectId, option) {
  const event = {
    player, object: { getId: () => objectId }, objectId,
    definition: core.ObjectDefinition.forId(objectId),
    // ObjectActionPacketListener sends the selected menu option in lowercase.
    option: option.toLowerCase(),
    location: player.getLocation(), handled: false, clickType: 1,
  };
  const start = PluginManager.objectInteractionHooks.length;
  try {
    const api = PluginManager.createApi('qh728-q117-object-dispatch');
    for (const handler of h.objectHooks) api.onObjectInteraction(handler);
    PluginManager.emitObjectInteraction(event);
  } finally {
    PluginManager.objectInteractionHooks.length = start;
  }
  return event;
}

function death(h, player, npcId) {
  const source=new NPC(7621,player.getLocation().clone());source.isRegistered=()=>true;
  const threat={player,npc:source,npcId:7621,text:"Ha, you really think you stand a chance? I'll crush you."};
  emit(h,'npc-dialogue:line',threat);threat.after?.();
  const npc=h.spawned.at(-1);
  const event = { npcId: npc.getContentId(player), killer: player, npc, damagers: [player], location: player.getLocation() };
  for (const handler of h.deathHooks) handler(event);
  return event;
}

test('fresh stage 0 to completion follows the helper stage order and canonical wire', () => {
  const h = harness();
  const p = makePlayer();
  assert.equal(h.quest.getStage(p), 0);
  assert.deepEqual(variant(h, p, N.KING_BOLREN), { page: PAGE, variant: 'tree-gnome-king' });

  emit(h, 'npc-dialogue:hook', { player: p, npcId: N.KING_BOLREN, hook: 'quest:tree-gnome-village:start' });
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(p.configs.get(VARP), 1, 'stage 1 is transmitted on varp 111');
  assert.equal(p.varbits.get(VARBIT_ORBS), 0);
  assert.equal(p.varbits.get(VARBIT_TRACKER_H), 0);
  assert.equal(p.getLocation().x, 2504, 'the start transcript guides the player out of the maze');

  assert.equal(variant(h, p, N.COMMANDER_MONTAI).variant, 'battlefield-commander-montai');
  choose(h, p, N.COMMANDER_MONTAI, "Ok, I'll gather some wood.");
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.configs.get(VARP), 2);

  assert.equal(variant(h, p, N.KING_BOLREN).variant,
    'tree-gnome-king-talking-to-king-bolren-again-after-agreeing-to-bring-logs-to-montai');
  p.getInventory().adds(I.LOGS, 6);
  condition(h, p, N.COMMANDER_MONTAI, 'cu5-py', 'If the player has 6 logs in their inventory:');
  assert.equal(h.quest.getStage(p), 3);
  assert.equal(p.getInventory().getAmount(I.LOGS), 0);

  assert.equal(variant(h, p, N.COMMANDER_MONTAI).variant, 'battlefield-talking-to-commander-montai-afterwards');
  choose(h, p, N.COMMANDER_MONTAI, "I'll try my best.");
  assert.equal(h.quest.getStage(p), 4);
  const coordinate = p.getAttribute('tree-gnome-village:ballista-coordinate');
  assert.ok(coordinate >= 0 && coordinate <= 3);
  assert.equal(p.varbits.get(VARBIT_BALLISTA), coordinate);

  assert.equal(variant(h, p, N.TRACKER_GNOME_1).variant, 'battlefield-tracker-gnomes-tracker-gnome-1');
  action(h, p, N.TRACKER_GNOME_1, 'eBZQ_A');
  assert.equal(p.varbits.get(VARBIT_TRACKER_H), 1);
  action(h, p, N.TRACKER_GNOME_2, '8H1UCb');
  assert.equal(p.varbits.get(VARBIT_TRACKER_Y), 1);
  const answers = ['FBaYjB', 'cLo8NW', 'RDXbKP', 'TPAWlA'].map((id, index) =>
    condition(h, p, N.TRACKER_GNOME_3, id,
      `If the coordinate is ${['one', 'two', 'three', 'four'][index]}:`));
  assert.deepEqual(answers, [0, 1, 2, 3].map((value) => value === coordinate));
  assert.equal(p.varbits.get(VARBIT_TRACKER_X), 1);

  object(h, p, 2181, 'Fire');
  assert.deepEqual(h.transcripts.at(-1), { npcId: N.COMMANDER_MONTAI, page: PAGE, variant: 'using-the-ballista' });
  const wrong = coordinate === 3 ? 1 : coordinate + 2;
  choose(h, p, N.COMMANDER_MONTAI, `000${wrong}`);
  assert.equal(condition(h, p, N.COMMANDER_MONTAI, '1G3SE7', 'If the player chooses the correct coordinate:'), false);
  assert.equal(h.quest.getStage(p), 4, 'a wrong coordinate does not advance');
  choose(h, p, N.COMMANDER_MONTAI, `000${coordinate + 1}`);
  assert.equal(condition(h, p, N.COMMANDER_MONTAI, '1G3SE7', 'If the player chooses the correct coordinate:'), true);
  assert.equal(h.quest.getStage(p), 5);
  assert.equal(p.configs.get(VARP), 5);

  object(h, p, 2185, 'Climb-over');
  assert.equal(p.getLocation().y, 3254);
  object(h, p, 2183, 'Open');
  assert.deepEqual(h.transcripts.at(-1), {
    npcId: N.KHAZARD_COMMANDER, page: PAGE,
    variant: 'into-the-stronghold-upon-opening-the-chest-containing-the-orb-of-protection',
  });
  action(h, p, N.KHAZARD_COMMANDER, 'PatYnA');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 1);
  assert.equal(h.quest.getStage(p), 6);

  assert.equal(variant(h, p, N.KING_BOLREN).variant, 'bringing-bolren-the-orb');
  choose(h, p, N.KING_BOLREN, 'I will find the warlord and bring back the orbs.');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 0);
  assert.equal(h.quest.getStage(p), 7);
  assert.equal(variant(h, p, N.KING_BOLREN).variant,
    'into-the-stronghold-talking-to-bolren-without-the-orb-after-finding-it');

  death(h, p, WARLORD_SPAWN);
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 1);
  death(h, p, WARLORD_SPAWN);
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 1, 'a repeat kill grants no second orb set');

  assert.equal(variant(h, p, N.KING_BOLREN).variant, 'return-of-the-orb');
  action(h, p, N.KING_BOLREN, '51Oq7J');
  assert.equal(h.quest.getStage(p), 9);
  assert.equal(p.configs.get(VARP), 9, 'cache completion threshold: varp 111 at 9');
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 0);
  assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 1);
  assert.deepEqual(p.experience, [{ skill: core.Skill.ATTACK, amount: 11450 }]);
  assert.equal(p.varbits.get(VARBIT_ORBS), 2);

  action(h, p, N.KING_BOLREN, '51Oq7J');
  assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 1, 'repeat completion grants nothing');
  assert.equal(p.experience.length, 1);

  p.varbits.clear();
  p.configs.clear();
  for (const handler of h.loginHooks) handler({ player: p });
  for (const quest of [h.quest]) runtime.sendQuestVarps({ player: p });
  assert.equal(p.configs.get(VARP), 9, 'login replays the saved stage on varp 111');
  assert.equal(p.varbits.get(VARBIT_ORBS), 2);
  assert.equal(p.varbits.get(VARBIT_BALLISTA), coordinate);
  assert.equal(p.varbits.get(VARBIT_TRACKER_H), 1);
});

test('early and out-of-order actions do not advance or duplicate quest items', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  p.getInventory().adds(I.LOGS, 6);
  condition(h, p, N.COMMANDER_MONTAI, 'cu5-py', 'If the player has 6 logs in their inventory:');
  assert.equal(h.quest.getStage(p), 1, 'logs are only taken while Montai waits for them');
  assert.equal(p.getInventory().getAmount(I.LOGS), 6);

  h.quest.setStage(p, 4);
  object(h, p, 2183, 'Open');
  action(h, p, N.KHAZARD_COMMANDER, 'PatYnA');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 0, 'the chest needs the ballista stage');

  h.quest.setStage(p, 8);
  action(h, p, N.KING_BOLREN, '51Oq7J');
  assert.equal(h.quest.getStage(p), 8, 'completion requires the orbs in hand');
  assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 0);

  h.quest.setStage(p, 4);
  object(h, p, 2181, 'Fire');
  assert.equal(p.messages.at(-1), 'You need the coordinates from all three tracker gnomes first.');
  assert.equal(h.transcripts.at(-1)?.variant, undefined, 'the ballista transcript waits for all trackers');
});

test('lost first orb is recoverable from the chest and a full bag drops it on the floor', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 6);
  object(h, p, 2183, 'Open');
  action(h, p, N.KHAZARD_COMMANDER, 'PatYnA');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 1, 'the lost orb comes back from the chest');

  const full = makePlayer();
  h.quest.setStage(full, 5);
  full.setFull(true);
  action(h, full, N.KHAZARD_COMMANDER, 'PatYnA');
  assert.equal(full.getInventory().getAmount(I.ORB_OF_PROTECTION), 0);
  assert.equal(h.groundItems.length, 1);
  assert.equal(h.groundItems[0].itemId, I.ORB_OF_PROTECTION);
  assert.equal(h.quest.getStage(full), 6);
});

test('lost orbs after the warlord are recoverable by killing him again', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 8);
  death(h, p, WARLORD_SPAWN);
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 1);

  h.quest.setStage(p, 8);
  p.getInventory().deleteNumber(I.ORBS_OF_PROTECTION, 1);
  death(h, p, WARLORD_SPAWN);
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 1, 'a lost orb set can be regained');
  assert.equal(h.quest.getStage(p), 8);
});

test('post-quest NPCs use their canonical pages, including transformed warlord forms', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 9);
  assert.equal(variant(h, p, N.KING_BOLREN), null, 'Bolren remains available to other indexed quest pages');
  assert.deepEqual(variant(h, p, N.COMMANDER_MONTAI), {
    page: 'Commander Montai', variant: 'after-returning-the-orb-of-protection-to-king-bolren',
  });
  for (const [npcId, npcPage] of [
    [N.TRACKER_GNOME_1, 'Tracker gnome 1'],
    [N.TRACKER_GNOME_2, 'Tracker gnome 2'],
    [N.TRACKER_GNOME_3, 'Tracker gnome 3'],
  ]) {
    assert.deepEqual(variant(h, p, npcId), {
      page: npcPage, variant: 'after-returning-the-orb-of-protection-to-king-bolren',
    });
  }
  p.setLocation(2504, 3191, 0);
  assert.deepEqual(variant(h, p, ELKOY_OUTSIDE), {
    page: 'Elkoy', variant: 'after-the-completion-of-tree-gnome-village-while-at-the-maze-entrance',
  });
  assert.deepEqual(variant(h, p, WARLORD_SPAWN), {
    page: 'Khazard warlord', variant: 'after-killing-him-in-tree-gnome-village',
  });
  for (const npcId of [N.KHAZARD_WARLORD_2, N.KHAZARD_WARLORD_3]) {
    assert.deepEqual(variant(h, p, npcId), {
      page: 'Khazard warlord', variant: 'after-killing-him-in-tree-gnome-village',
    });
  }
  p.setLocation(2520, 3165, 0);
  assert.deepEqual(variant(h, p, ELKOY_OUTSIDE), {
    page: 'Elkoy', variant: 'after-the-completion-of-tree-gnome-village-while-inside-the-village',
  });

  const fresh = makePlayer();
  fresh.setLocation(2504, 3191, 0);
  assert.deepEqual(variant(h, fresh, ELKOY_OUTSIDE), {
    page: 'Elkoy', variant: 'before-starting-tree-gnome-village-while-outside-the-maze',
  });

  const active = makePlayer();
  h.quest.setStage(active, 7);
  active.setLocation(2504, 3191, 0);
  assert.equal(variant(h, active, ELKOY_OUTSIDE).variant,
    'bringing-bolren-the-orb-talking-to-elkoy-after-giving-bolren-the-orb-of-protection-outside-the-maze');
  active.setLocation(2520, 3165, 0);
  assert.equal(variant(h, active, ELKOY_OUTSIDE).variant,
    'bringing-bolren-the-orb-talking-to-elkoy-after-giving-bolren-the-orb-of-protection-inside-the-maze');
});

test('post-quest Bolren recovery only awards the amulet on the canonical loss branch', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 9);
  const conditionIds = ['jhUV9W', 'khpxfY', 'a0UQ7j'];

  for (const stepId of conditionIds) {
    assert.equal(condition(h, p, N.KING_BOLREN, stepId, 'If the player has lost the gnome amulet:'), true);
  }
  action(h, p, N.KING_BOLREN, 'SoVY4z');
  assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 1);
  for (const stepId of conditionIds) {
    assert.equal(condition(h, p, N.KING_BOLREN, stepId, 'If the player has lost the gnome amulet:'), false);
  }
  action(h, p, N.KING_BOLREN, 'SoVY4z');
  assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 1, 'replaying the receipt cannot duplicate the amulet');

  p.getInventory().deleteNumber(I.GNOME_AMULET, 1);
  for (const stepId of ['LUAm8Y', 'wWnJYI']) {
    action(h, p, N.KING_BOLREN, stepId);
    assert.equal(p.getInventory().getAmount(I.GNOME_AMULET), 1, `${stepId} restores the missing receipt`);
    p.getInventory().deleteNumber(I.GNOME_AMULET, 1);
  }
  p.setFull(true);
  for (const stepId of ['SoVY4z', 'LUAm8Y', 'wWnJYI']) action(h, p, N.KING_BOLREN, stepId);
  assert.equal(h.groundItems.filter((entry) => entry.itemId === I.GNOME_AMULET).length, 1,
    'a full bag leaves one recoverable amulet across repeated receipt nodes');
});

test('Elkoy guide-in stops at the inner maze railing approach', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  p.setLocation(2504, 3191, 0);
  choose(h, p, ELKOY_OUTSIDE, 'Yes please.');
  assert.equal(p.getLocation().x, 2515);
  assert.equal(p.getLocation().y, 3159);
  choose(h, p, ELKOY_OUTSIDE, 'Can you show me out of the village?');
  assert.equal(p.getLocation().x, 2504);
  assert.equal(p.getLocation().y, 3191);
});


test('guide-in requires the normal cached Loose Railing shortcut before walking to Bolren', () => {
  const {ObjectDefinition}=require('../dist/game/definition/ObjectDefinition');
  const {RegionManager:R}=require('../dist/game/collision/RegionManager');
  const {MapObjects:M}=require('../dist/game/entity/impl/object/MapObjects');
  const {MovementQueue}=require('../dist/game/model/movement/MovementQueue');
  const {RsmodRouteFinding}=require('../dist/game/model/movement/path/RsmodRouteFinding');
  ObjectDefinition.init();R.init();R.loadMapFiles(2515,3161);
  const h=harness(),p=makePlayer();h.quest.setStage(p,6);p.setLocation(2504,3191,0);
  choose(h,p,ELKOY_OUTSIDE,'Yes please.');
  const route=(x,y,dx,dy)=>new RsmodRouteFinding(R.getClipping.bind(R)).findRoute({level:0,
    srcX:x,srcY:y,srcSize:1,destX:dx,destY:dy,destWidth:1,destLength:1,
    locShape:-1,moveNear:false,privateArea:null});
  assert.equal(route(2515,3159,2541,3164).success,false,'guide stays outside the village fence');
  assert.equal(route(2515,3159,2515,3160).success,true);
  const object=(M.mapObjects.get(M.getHash(2515,3161,0))??[]).find(o=>o.getId()===2186);
  assert.ok(object);assert.equal(ObjectDefinition.forId(2186).getActions()[0],'Squeeze-through');
  const rf=new RsmodRouteFinding(R.getClipping.bind(R));
  const mq=new MovementQueue({isPlayer:()=>false,isNpc:()=>true,getLocation:()=>p.getLocation()});
  const spec=mq.buildObjectRouteSpec(object);
  assert.equal(rf.reachedAbsolute({level:0,srcX:2515,srcY:3160,srcSize:1,
    destX:2515,destY:3161,destWidth:spec.reachWidth,destLength:spec.reachLength,
    locAngle:spec.reachAngle,locShape:spec.reachShape,blockAccessFlags:spec.reachBlockAccessFlags,privateArea:null}),true);
  p.setLocation(2515,3160,0);
  let force=null;const tasks=[];let click;
  Object.assign(p,{ getHitpoints:()=>99, getForceMovement:()=>force,setForceMovement:value=>{force=value;},
    setSkillAnimation:noop,getUpdateFlag:()=>({flag:noop}),performAnimation:noop,
    getMovementQueue:()=>({reset:noop,setBlockMovement:noop}),
    getSkillManager:()=>({getCurrentLevel:()=>99,getMaxLevel:()=>99,addExperiences:noop}) });
  require('../plugins/skills/Agility.plugin').register(new Proxy({core,
    getTaskManager:()=>({submit(task){task.setRunning(true);if(task.isImmediate())task.execute();tasks.push(task);}}),
    getItemOnGroundManager:()=>({}),onObjectFirstClick:(ids,handler)=>{if(ids.includes(2186))click=handler;},
  },{get:(t,k)=>t[k]??noop}));
  assert.equal(click({player:p,object,objectId:2186,clickType:1,location:{x:2515,y:3161,z:0}}),true);
  for(let tick=0;tick<6;tick++)for(const task of tasks)if(task.isRunning())task.tick();
  assert.deepEqual([p.getLocation().getX(),p.getLocation().getY()],[2515,3161]);
  assert.equal(route(2515,3161,2541,3164).success,true,'after normal squeeze the king is reachable');
});


test('canonical warlord threat creates an owned full-health attack form and real death task grants earned orbs', () => {
  const {NPCDeathTask}=require('../dist/game/task/impl/NPCDeathTask');
  const {CacheDefinitions}=require('../dist/game/cache/CacheDefinitions');
  const h=harness(),p=makePlayer(),other=makePlayer();h.quest.setStage(p,7);h.quest.setStage(other,7);
  const source=new NPC(4971,new core.Location(2457,3302,0));source.isRegistered=()=>true;
  assert.equal(CacheDefinitions.getNpc(4971).transformVarbit,3460);
  assert.equal(source.getCurrentDefinition(p).getId(),7621);
  assert.equal(source.getCurrentDefinition(p).isAttackable(),false);
  const threat={player:p,npc:source,npcId:7621,text:"Ha, you really think you stand a chance? I'll crush you."};
  emit(h,'npc-dialogue:line',threat);
  assert.equal(h.spawned.length,0,'closing threat before continuing does not start a fight');
  threat.after();const fighter=h.spawned.at(-1);
  assert.equal(CacheDefinitions.getVarbitId('khazard_warlord_fighting'),3460);
  assert.equal(p.varbits.get(3460),1);
  assert.equal(source.getCurrentDefinition(p),undefined,'talk parent is hidden for its encounter owner');
  assert.notEqual(source.getContentId(p),7621,'hidden parent cannot resolve conversational content');
  assert.equal(fighter.getOwner(),p);assert.equal(fighter.getContentId(p),7622);
  assert.equal(fighter.getCurrentDefinition(p).isAttackable(),true);
  assert.ok(fighter.getCurrentDefinition(p).getActions().some(a=>a?.toLowerCase()==='attack'));
  assert.equal(fighter.getHitpoints(),NpcDefinition.forId(7622).getHitpoints());
  assert.ok(fighter.getHitpoints()>10,"not the conversational form default health");
  assert.equal(fighter.getCombat().getTarget(),p);
  assert.equal(source.getCurrentDefinition(other).getId(),7621,'shared NPC stays conversational for others');
  threat.after();assert.equal(h.spawned.length,1,'repeat continuation cannot duplicate encounter');
  for(const handler of h.deathHooks)handler({npc:source,npcId:7622,killer:p});
  assert.equal(h.quest.getStage(p),7,'unrelated same-ID death cannot advance');
  fighter.getCombat().addDamage(p,1);
  const hooks=PluginManager.npcDeathHooks;const depth=hooks.length;
  for(const handler of h.deathHooks)hooks.push({pluginName:'q117-real-death',handler});
  try {
    const task=new NPCDeathTask(fighter);task.execute();task.execute();
    assert.equal(h.quest.getStage(p),8);assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION),1);
    assert.equal(h.quest.getStage(other),7);
    assert.equal(p.varbits.get(3460),0);
    assert.equal(source.getCurrentDefinition(p).getId(),7621);
  } finally { hooks.length=depth; }
});

test('warlord owned combat cancels on logout and can retry without progress grants', () => {
  const h=harness(),p=makePlayer();h.quest.setStage(p,7);
  const source=new NPC(7621,new core.Location(2457,3302,0));source.isRegistered=()=>true;
  const start=()=>{const e={player:p,npc:source,npcId:7621,text:"Ha, you really think you stand a chance? I'll crush you."};emit(h,'npc-dialogue:line',e);e.after();};
  start();const first=h.spawned.at(-1);h.logoutHooks.forEach(fn=>fn({player:p}));
  assert.equal(first.removed,true);assert.equal(h.quest.getStage(p),7);
  assert.equal(p.varbits.get(3460),0);
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION),0);
  start();assert.notEqual(h.spawned.at(-1),first);assert.equal(h.spawned.at(-1).getCurrentDefinition(p).isAttackable(),true);
});


test('the warlord gives up past his combat follow distance instead of chasing across the map', () => {
  const h=harness(),p=makePlayer();h.quest.setStage(p,7);p.setLocation(2458,3302,0);
  const source=new NPC(7621,new core.Location(2457,3302,0));source.isRegistered=()=>true;
  const e={player:p,npc:source,npcId:7621,text:"Ha, you really think you stand a chance? I'll crush you."};
  emit(h,'npc-dialogue:line',e);e.after();
  const fighter=h.spawned.at(-1);
  const leash=h.tasks.find(task=>task.constructor.name==='WarlordLeashTask');
  assert.ok(leash,'the encounter is leashed');
  const follow=fighter.getCurrentDefinition().getCombatFollowDistance();
  fighter.moveTo(new core.Location(2457+follow,3302,0));
  leash.execute();
  assert.notEqual(fighter.removed,true,'within reach he keeps fighting');
  fighter.moveTo(new core.Location(2457+follow+1,3302,0));
  leash.execute();
  assert.equal(fighter.removed,true,'past it he goes');
  assert.equal(p.varbits.get(3460),0);
  assert.equal(h.quest.getStage(p),7,'the fight can be started again');
});

test('warlord fighting visibility replays actual encounter and clears orphan state without touching siblings', () => {
  const h=harness(),p=makePlayer();h.quest.setStage(p,7);
  const source=new NPC(4971,new core.Location(2457,3302,0));source.isRegistered=()=>true;
  const d=CacheDefinitions.getVarbit(3460), mask=(2**(d.endBit-d.startBit+1)-1)<<d.startBit;
  const siblings=0x5a5a5a5a & ~mask;
  p.configs.set(d.baseVar,siblings);p.varbits.set(3460,1);
  h.loginHooks.forEach(fn=>fn({player:p}));
  assert.equal(p.varbits.get(3460),0,'login without an actor clears orphan hiding');
  const e={player:p,npc:source,npcId:7621,text:"Ha, you really think you stand a chance? I'll crush you."};
  emit(h,'npc-dialogue:line',e);e.after();
  p.varbits.set(3460,0);p.configs.set(d.baseVar,siblings);
  emit(h,'player:bootstrap-complete',{player:p});
  assert.equal(p.varbits.get(3460),1);assert.equal(source.getCurrentDefinition(p),undefined);
  assert.equal(p.configs.get(d.baseVar)&~mask,siblings);
  h.logoutHooks.forEach(fn=>fn({player:p}));
  p.varbits.set(3460,1);emit(h,'player:bootstrap-complete',{player:p});
  assert.equal(p.varbits.get(3460),0);assert.equal(source.getCurrentDefinition(p).getId(),7621);
  assert.equal(p.configs.get(d.baseVar)&~mask,siblings);
});


function ceremonyFixture({missingNorth=false}={}) {
  const h=harness(),p=makePlayer();h.quest.setStage(p,8);p.getInventory().adds(I.ORBS_OF_PROTECTION,1);
  const manager=new DialogueManager(p);p.getDialogueManager=()=>manager;p.getFrameUpdater=()=>null;
  p.getPacketSender().sendInterfaceRemoval=()=>{manager.reset();return p.getPacketSender();};
  const speeches=[];
  const king=new NPC(N.KING_BOLREN,new core.Location(2542,3169,0));
  king.isRegistered=()=>true;king.setVisible(true);
  const npcs=[king];
  for(const [x,y]of [[2541,3168],[2542,3167],[2541,3171],[2542,3172]]) {
    if(missingNorth&&y>3169)continue;
    const n=new NPC(N.LOCAL_GNOME_2,new core.Location(x,y,0));
    n.isRegistered=()=>true;n.setVisible(true);
    const say=n.forceChat.bind(n);n.forceChat=text=>{speeches.push({homeY:y,text});say(text);};
    npcs.push(n);
  }
  // A northern cohort member wandered south: role follows its real spawn, not current drift.
  npcs.find(n=>n.getSpawnPosition().getY()===3171)?.moveTo(new core.Location(2540,3164,0));
  p.getLocalNpcs=()=>npcs;
  runtime.startTranscript(h.api,p,N.KING_BOLREN,PAGE,'return-of-the-orb',undefined,king);
  const tick=()=>{for(const t of [...h.tasks])if(t.isRunning())t.tick();};
  const finish=()=>{let limit=100;while(manager.isActive()&&limit-->0){if(!(manager.getCurrent() instanceof core.ActionDialogue))manager.advance();tick();}assert.ok(limit>0);};
  return {h,p,manager,npcs,speeches,tick,finish};
}

test('real ceremony runner binds both real gnome cohorts and reaches canonical completion action', () => {
  const f=ceremonyFixture();f.finish();
  assert.deepEqual(f.speeches.map(s=>s.text),['Su tana.','Su tana.','En tania.','En tania.','Su tana.','Su tana.','En tania.','En tania.']);
  for(const s of f.speeches)assert.equal(s.text==='Su tana.',s.homeY>3169);
  assert.equal(f.h.quest.getStage(f.p),9);assert.equal(f.p.getInventory().getAmount(I.ORBS_OF_PROTECTION),0);
  assert.equal(f.p.getInventory().getAmount(I.GNOME_AMULET),1);
  assert.equal(f.p.experience.length,1);
});

test('missing ceremony cohort or cancelled overhead cannot consume orbs or complete', () => {
  const missing=ceremonyFixture({missingNorth:true});missing.finish();
  assert.equal(missing.h.quest.getStage(missing.p),8);assert.equal(missing.p.getInventory().getAmount(I.ORBS_OF_PROTECTION),1);
  const cancelled=ceremonyFixture();let limit=30;
  while(cancelled.h.tasks.length===0&&limit-->0)cancelled.manager.advance();
  assert.ok(limit>0);cancelled.manager.reset();
  for(let i=0;i<12;i++)cancelled.tick();
  assert.equal(cancelled.h.quest.getStage(cancelled.p),8);assert.equal(cancelled.p.getInventory().getAmount(I.ORBS_OF_PROTECTION),1);
  assert.equal(cancelled.p.getInventory().getAmount(I.GNOME_AMULET),0);
});
