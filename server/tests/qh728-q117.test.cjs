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
    getChatboxGroupId: () => -1,
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
    getEquipment: () => ({ getItems: () => [] }),
    getPacketSender: () => sender,
    getSkillManager: () => ({
      addExperiences(skill, amount) { experience.push({ skill, amount }); },
    }),
    getUsername: () => 'qh728-q117', getDisplayName: () => 'qh728-q117',
    getPrivateArea: () => null,
    getLocation: () => location,
    isPlayer: () => true, isNpc: () => false, getIndex: () => 1,
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
    getMovementQueue: () => movement,
    setUntargetable: noop,
  };
  const movement = { blocked: false, reset() { return movement; }, setBlockMovement(value) { movement.blocked = value; return movement; } };
  return player;
}

/** Records what the quest draws for the player: loc animations, projectiles and tile graphics. */
function recordSends(player) {
  const sent = [];
  const sender = player.getPacketSender();
  sender.sendObjectAnimation = (object, animation) => { sent.push({ kind: 'locanim', object, id: animation.getId() }); return sender; };
  sender.sendProjectile = (from, to, offset, speed, id, startHeight, endHeight, lockon, delay) => {
    sent.push({ kind: 'projectile', from, to, speed, id, delay }); return sender;
  };
  sender.sendGraphic = (graphic, at) => { sent.push({ kind: 'graphic', id: graphic.id, delay: graphic.delay, at }); return sender; };
  return sent;
}

function tick(h, ticks = 1) {
  for (let i = 0; i < ticks; i++) for (const task of [...h.tasks]) if (task.isRunning()) task.tick();
}

/** The player picks the item up from the floor. */
function pickUp(h, player, itemId) {
  const index = h.groundItems.findIndex((entry) => entry.player === player && entry.itemId === itemId);
  assert.notEqual(index, -1, `item ${itemId} is on the floor`);
  h.groundItems.splice(index, 1);
  player.getInventory().adds(itemId, 1);
}

function harness() {
  const events = new Map();
  const variants = [];
  const conditions = [];
  const objectHooks = [];
  const npcHooks = [];
  const deathHooks = [];
  const loginHooks = [];
  const transcripts = [];
  const groundItems = [];
  const spawned = [], logoutHooks = [];
  const tasks=[], walks=[];
  const api = new Proxy({
    core:{...core,TaskManager:{submit(task){task.setRunning(true);if(task.isImmediate())task.execute();tasks.push(task);}},
      PathFinder:{calculateWalkRoute(mobile,x,y){walks.push({mobile,x,y});}}},
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onObjectInteraction: (handler) => objectHooks.push(handler),
    onNpcInteraction: (name, handlers) => npcHooks.push({ name, handlers }),
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
  return { npcHooks,api,tasks,walks,events, variants, conditions, objectHooks, deathHooks, loginHooks, transcripts, groundItems, spawned, logoutHooks, quest };
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

/** A transcript step's event; message steps carry `kind: "message"`, as NpcDialogues sends them. */
const GUIDE_STEP_IDS = new Set(['ciSH8i', 'BeeQDX', 'DoDThh', 'VDxtPz', '62M3zx', 'SNdZj5', 'Pt8oyf', 'Cm8dee', 'JLPzK4']);
function action(h, player, npcId, stepId, kind = 'message', text = GUIDE_STEP_IDS.has(stepId) ? 'Elkoy guides you through the maze.' : '') {
  const event = { player, npcId, stepId, kind, step: { type: kind === 'message' ? 'message' : 'action' }, text, handled: false, end: false };
  emit(h, 'npc-dialogue:action', event);
  return event;
}

/** A transcript line as NpcDialogues lays it out: its `before` as it shows, its `after` as it is continued. */
function line(h, player, npcId, text, extra = {}) {
  const request = { player, npcId, text, step: { type: 'line' }, skip: false, ...extra };
  emit(h, 'npc-dialogue:line', request);
  request.before?.();
  request.after?.();
  return request;
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
  assert.equal(h.quest.getStage(p), 0, 'picking "Yes." does not start it yet');
  line(h, p, N.KING_BOLREN, 'I would be glad to help.');
  assert.equal(h.quest.getStage(p), 1, 'it starts as the acceptance line is continued');
  assert.ok(p.messages.some((text) => text.startsWith("You've started a new quest")));
  assert.equal(p.configs.get(VARP), 1, 'stage 1 is transmitted on varp 111');
  assert.equal(p.varbits.get(VARBIT_ORBS), 0);
  assert.equal(p.varbits.get(VARBIT_TRACKER_H), 0);
  assert.equal(p.getLocation().x, 2541, 'acceptance leaves Bolren talking inside the village');
  const guideOut = action(h, p, N.KING_BOLREN, 'GnZ1Sn');
  assert.deepEqual(guideOut.box, { statement: true, holdTicks: 4, advance: true }, 'the guide message holds over the fade');
  assert.equal(p.getLocation().x, 2541, 'the screen fades out before the player is moved');
  tick(h, 2);
  assert.equal(p.getLocation().x, 2541, 'still dark two ticks on');
  tick(h, 1);
  assert.equal(p.getLocation().x, 2504, 'the final guide-out message moves the player');

  assert.equal(variant(h, p, N.COMMANDER_MONTAI).variant, 'battlefield-commander-montai');
  choose(h, p, N.COMMANDER_MONTAI, "Ok, I'll gather some wood.");
  assert.equal(h.quest.getStage(p), 1, 'the pick alone does not move it');
  line(h, p, N.COMMANDER_MONTAI, "Ok, I'll gather some wood.");
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.configs.get(VARP), 2);

  assert.equal(variant(h, p, N.KING_BOLREN).variant,
    'tree-gnome-king-talking-to-king-bolren-again-after-agreeing-to-bring-logs-to-montai');
  p.getInventory().adds(I.LOGS, 6);
  assert.equal(condition(h, p, N.COMMANDER_MONTAI, 'cu5-py', 'If the player has 6 logs in their inventory:'), true);
  assert.equal(h.quest.getStage(p), 2, 'the logs go as the player says they have some');
  line(h, p, N.COMMANDER_MONTAI, 'I have some here. (You give six loads of logs to the commander.)');
  assert.equal(h.quest.getStage(p), 3);
  assert.equal(p.getInventory().getAmount(I.LOGS), 0);
  assert.ok(!p.messages.some((text) => text.startsWith('You give six loads')), 'no game message: the line says it');

  assert.equal(variant(h, p, N.COMMANDER_MONTAI).variant, 'battlefield-talking-to-commander-montai-afterwards');
  choose(h, p, N.COMMANDER_MONTAI, "I'll try my best.");
  line(h, p, N.COMMANDER_MONTAI, "Thank you, you're braver than most.");
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
  const hit = action(h, p, N.COMMANDER_MONTAI, '8Wc7CR');
  assert.deepEqual(hit.box, { statement: true, delayTicks: 2 }, 'the hit box opens two ticks after the launch');
  assert.equal(h.quest.getStage(p), 4, 'the stronghold is breached once the box is continued');
  hit.after();
  assert.equal(h.quest.getStage(p), 5);
  assert.equal(p.configs.get(VARP), 5);

  // The wall is an agility shortcut (human_walk_crumbledwall), not a quest teleport.
  assert.equal(object(h, p, 2185, 'Climb-over').handled, false);
  const wall = require('../plugins/skills/data/agility-shortcuts.json').shortcuts.find(entry => entry.object === 2185);
  assert.deepEqual(wall.between.ends, [[2509, 3252, 0], [2509, 3254, 0]]);
  assert.ok(wall.between.cross.some(step => step.anim === 'CRUMBLED_WALL'));
  p.setLocation(2509, 3254, 0);
  assert.equal(object(h, p, 2183, 'Open').handled, false, 'shared chest handler opens the closed loc');
  object(h, p, 2182, 'Search');
  assert.deepEqual(h.transcripts.at(-1), {
    npcId: N.KHAZARD_COMMANDER, page: PAGE,
    variant: 'into-the-stronghold-upon-opening-the-chest-containing-the-orb-of-protection',
  });
  action(h, p, N.KHAZARD_COMMANDER, 'JOh59P');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 1);
  assert.equal(h.quest.getStage(p), 6);

  assert.equal(variant(h, p, N.KING_BOLREN).variant, 'bringing-bolren-the-orb');
  choose(h, p, N.KING_BOLREN, 'I will find the warlord and bring back the orbs.');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 1, 'he takes it a line later');
  line(h, p, N.KING_BOLREN, 'You are brave, but this task will be tough even for you. I wish you the best of luck. Once again you are our only hope.');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 0);
  assert.equal(h.quest.getStage(p), 7);
  assert.equal(p.varbits.get(VARBIT_ORBS), 0, 'the first orb does not change bolren_got_orbs');
  assert.equal(variant(h, p, N.KING_BOLREN).variant,
    'into-the-stronghold-talking-to-bolren-without-the-orb-after-finding-it');
  p.setLocation(2541, 3170, 0);
  action(h, p, N.KING_BOLREN, 'dJzhSl');
  tick(h, 3);
  assert.deepEqual([p.getLocation().x, p.getLocation().y], [2504, 3191], 'Elkoy guides the player out after the first orb too');

  const kill = death(h, p, WARLORD_SPAWN);
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 0, 'the orbs are not put in the pack');
  assert.deepEqual(h.groundItems.map((entry) => [entry.itemId, entry.at.getX(), entry.at.getY()]),
    [[I.ORBS_OF_PROTECTION, kill.npc.getLocation().getX(), kill.npc.getLocation().getY()]], 'they land on his tile');
  assert.equal(h.transcripts.at(-1).variant, 'the-khazard-warlord-when-defeated');
  death(h, p, WARLORD_SPAWN);
  assert.equal(h.groundItems.length, 1, 'a repeat kill drops no second orb set while one lies there');
  pickUp(h, p, I.ORBS_OF_PROTECTION);
  death(h, p, WARLORD_SPAWN);
  assert.equal(h.groundItems.length, 0, 'or while the player carries one');
  assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION), 1);

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
  action(h, p, N.KHAZARD_COMMANDER, 'JOh59P');
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
  object(h, p, 2182, 'Search');
  action(h, p, N.KHAZARD_COMMANDER, 'JOh59P');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION), 1, 'the lost orb comes back from the chest');

  const full = makePlayer();
  h.quest.setStage(full, 5);
  full.setFull(true);
  action(h, full, N.KHAZARD_COMMANDER, 'JOh59P');
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
  pickUp(h, p, I.ORBS_OF_PROTECTION);

  h.quest.setStage(p, 8);
  p.getInventory().deleteNumber(I.ORBS_OF_PROTECTION, 1);
  death(h, p, WARLORD_SPAWN);
  pickUp(h, p, I.ORBS_OF_PROTECTION);
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
  assert.equal(p.getLocation().x, 2504, 'saying yes does not move the player at once');
  // The variant's "Elkoy guides you through the maze." is a transcript action: it plays as the message.
  const direction = action(h, p, ELKOY_OUTSIDE, 'DoDThh', null);
  direction.text = 'Elkoy guides you through the maze.';
  emit(h, 'npc-dialogue:action', direction);
  assert.equal(direction.handled, true);
  const echoed = { player: p, npcId: ELKOY_OUTSIDE, stepId: 'DoDThh', step: { type: 'message' }, text: '', handled: false };
  emit(h, 'npc-dialogue:action', echoed);
  assert.equal(echoed.handled, false, "a message step's generic event on an older runner is left to the message event");
  assert.deepEqual(direction.steps, [{ type: 'message', text: 'Elkoy guides you through the maze.', id: 'DoDThh' }]);
  const message = action(h, p, ELKOY_OUTSIDE, 'DoDThh');
  assert.equal(message.box.holdTicks, 4);
  assert.equal(p.getPacketSender().getVarbit(6719), 2, 'the minimap goes dark with the walk');
  tick(h, 2);
  assert.equal(p.getLocation().x, 2504, 'still dark');
  tick(h, 1);
  assert.equal(p.getLocation().x, 2515);
  assert.equal(p.getLocation().y, 3159);
  assert.equal(p.getMovementQueue().blocked, false);
  choose(h, p, ELKOY_OUTSIDE, 'Can you show me out of the village?');
  action(h, p, ELKOY_OUTSIDE, 'VDxtPz');
  tick(h, 3);
  assert.equal(p.getLocation().x, 2504);
  assert.equal(p.getLocation().y, 3191);
});

test('Elkoy variants with no guide message walk the player as his next line shows', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 8);
  p.setLocation(2504, 3191, 0);
  const own = { player: p, npcId: ELKOY_OUTSIDE, step: { speaker: 'Elkoy' }, text: 'Ok then, take care.' };
  emit(h, 'npc-dialogue:line', own);
  assert.equal(own.before, undefined, 'no walk without a yes');
  choose(h, p, ELKOY_OUTSIDE, 'Yes please.');
  const said = { player: p, npcId: ELKOY_OUTSIDE, step: { player: 'Yes please.' }, text: 'Yes please.' };
  emit(h, 'npc-dialogue:line', said);
  assert.equal(said.before, undefined, "the player's own line is not Elkoy's");
  const line = { player: p, npcId: ELKOY_OUTSIDE, step: { speaker: 'Elkoy' }, text: 'Here we are. Feel free to have a look around.' };
  emit(h, 'npc-dialogue:line', line);
  assert.equal(line.holdTicks, 4);
  line.before();
  tick(h, 3);
  assert.deepEqual([p.getLocation().x, p.getLocation().y], [2515, 3159]);
  const later = { player: p, npcId: ELKOY_OUTSIDE, step: { speaker: 'Elkoy' }, text: 'Ok then, take care.' };
  emit(h, 'npc-dialogue:line', later);
  assert.equal(later.before, undefined, 'one yes, one walk');
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
    assert.equal(h.quest.getStage(p),8);assert.equal(p.getInventory().getAmount(I.ORBS_OF_PROTECTION),0);
    assert.deepEqual(h.groundItems.map(e=>[e.player,e.itemId,e.at.getX(),e.at.getY()]),
      [[p,I.ORBS_OF_PROTECTION,fighter.getLocation().getX(),fighter.getLocation().getY()]],'the orbs lie among his remains');
    assert.equal(h.quest.getStage(other),7);
    assert.equal(p.varbits.get(3460),1,'the talking warlord stays hidden a while after he falls');
    tick(h,29);assert.equal(p.varbits.get(3460),1);
    tick(h,1);assert.equal(p.varbits.get(3460),0,'and is back 30 ticks after the orbs drop');
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


test('the warlord gives up past his follow distance, walks home beside the talking warlord and fights again there', () => {
  const h=harness(),p=makePlayer();h.quest.setStage(p,7);p.setLocation(2458,3303,0);
  const source=new NPC(7621,new core.Location(2457,3302,0));source.isRegistered=()=>true;
  // West of him is blocked here; east is open.
  source.getMovementQueue=()=>({canWalkTo:(tile,from)=>from.getX()===2457&&tile.getX()!==2456});
  const e={player:p,npc:source,npcId:7621,text:"Ha, you really think you stand a chance? I'll crush you."};
  emit(h,'npc-dialogue:line',e);e.after();
  const fighter=h.spawned.at(-1),home=new core.Location(2458,3302,0);
  assert.ok(fighter.getLocation().equals(source.getLocation()),'he appears where the talking warlord stood, as live');
  assert.equal(p.varbits.get(14192),7,'current_hint_arrow points at him');
  assert.ok(fighter.getSpawnPosition().equals(home),'and goes home there, a tile he can reach');
  assert.equal(h.tasks.some(task=>task.constructor.name==='WarlordLeashTask'),false);
  const follow=fighter.getCurrentDefinition().getCombatFollowDistance();
  fighter.moveTo(new core.Location(2458+follow+1,3302,0));p.setLocation(2458+follow+2,3302,0);
  tick(h);
  assert.equal(fighter.getCombat().getTarget(),null,'past his follow distance he gives up the chase');
  assert.notEqual(fighter.removed,true,'he is not despawned');
  assert.deepEqual([h.walks.at(-1).mobile,h.walks.at(-1).x,h.walks.at(-1).y],[fighter,2458,3302],'he walks home');
  assert.equal(p.varbits.get(3460),1);
  fighter.getCombat().attack(p);tick(h);
  assert.equal(fighter.getCombat().getTarget(),null,'hit on the way home, he keeps walking home');
  fighter.moveTo(home.clone());tick(h);
  assert.equal(fighter.getCombat().getTarget(),null,'home, with his challenger out of range, he waits');
  p.setLocation(2458+follow,3302,0);tick(h);
  assert.equal(fighter.getCombat().getTarget(),p,'his challenger back in range, he attacks again');
});

test('the ballista fires as the coordinate box is continued, as captured, or wide of the stronghold on a wrong coordinate', () => {
  // The user's rsprox capture, local 1001802 ticks 1460-1478 (revision 242).
  const h=harness(),p=makePlayer();h.quest.setStage(p,4);
  p.setAttribute('tree-gnome-village:trackers',7);p.setAttribute('tree-gnome-village:ballista-coordinate',1);
  const sent=recordSends(p);
  const sender=p.getPacketSender();
  const projectiles=[];
  sender.sendProjectile=(...args)=>{projectiles.push(args);return sender;};
  const sounds=[];sender.sendSound=(id)=>{sounds.push(id);return sender;};
  const ballista=new core.GameObject(2181,new core.Location(2508,3210,0),10,0,null);
  const fire=()=>{
    const event={player:p,object:ballista,objectId:2181,option:'fire',handled:false};
    for(const handler of h.objectHooks)handler(event);
    assert.equal(event.handled,true);
  };
  fire();choose(h,p,N.COMMANDER_MONTAI,'0004');
  const entered=action(h,p,N.COMMANDER_MONTAI,'f-0NYt');
  assert.deepEqual(entered.box,{statement:true},'"You enter the height and y coordinates..." is a message box');
  assert.equal(sent.length,0,'nothing fires until it is continued');
  entered.after();
  const [launch]=sent.splice(0);
  assert.deepEqual([launch.kind,launch.object,launch.id],['locanim',ballista,730]);
  const [from,to,,end,id,startHeight,endHeight,,delay,slope,progress]=projectiles.shift();
  assert.deepEqual([id,from.getX(),from.getY(),end,delay,slope,progress,startHeight*4,endHeight],[182,2509,3213,375,110,7,0,95,0]);
  assert.deepEqual([to.getX(),to.getY()],[2509+2*3,3254],'two coordinates out, six tiles east of the target');
  assert.deepEqual(sounds,[3488],'the launch sound; no hit sound on a miss');
  assert.equal(condition(h,p,N.COMMANDER_MONTAI,'wwt4fB','If the player chooses the wrong coordinate:'),true);
  const missed=action(h,p,N.COMMANDER_MONTAI,'B_5n9I');
  assert.deepEqual(missed.box,{statement:true,delayTicks:2});
  assert.equal(h.quest.getStage(p),4);
  sounds.length=0;
  fire();choose(h,p,N.COMMANDER_MONTAI,'0002');
  action(h,p,N.COMMANDER_MONTAI,'f-0NYt').after();
  const [,hitTo]=projectiles.shift();
  assert.deepEqual([hitTo.getX(),hitTo.getY()],[2509,3254],'into the stronghold, inside the crumbled wall');
  assert.equal(sent.some(entry=>entry.kind==='graphic'),false,'no graphic where it lands');
  assert.deepEqual(sounds,[3488]);
  tick(h,2);
  assert.deepEqual(sounds,[3488,3487],'the hit sound two ticks later, with the hit box');
  assert.equal(condition(h,p,N.COMMANDER_MONTAI,'1G3SE7','If the player chooses the correct coordinate:'),true);
  const hit=action(h,p,N.COMMANDER_MONTAI,'8Wc7CR');
  assert.equal(h.quest.getStage(p),4);
  hit.after();
  assert.equal(h.quest.getStage(p),5,'breached as the hit box is continued');
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
    const animate=n.performAnimation.bind(n);n.performAnimation=a=>{speeches.push({homeY:y,anim:a.getId()});return animate(a);};
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
  const said=f.speeches.filter(s=>s.text);
  assert.deepEqual(said.map(s=>s.text),['Su tana.','Su tana.','En tania.','En tania.','Su tana.','Su tana.','En tania.','En tania.']);
  for(const s of said)assert.equal(s.text==='Su tana.',s.homeY>3169);
  assert.equal(f.speeches.filter(s=>s.anim===12049).length,8,'each chanter plays gnome_chanting with his words');
  assert.equal(f.h.quest.getStage(f.p),9);assert.equal(f.p.getInventory().getAmount(I.ORBS_OF_PROTECTION),0);
  assert.equal(f.p.getInventory().getAmount(I.GNOME_AMULET),1);
  assert.equal(f.p.experience.length,1);
});

test('a ceremony cut off after Bolren takes the orbs cannot complete, and plays again from Bolren', () => {
  // Live takes the orbs as "The gnomes begin to chant..." opens (local 1001802 tick 2258).
  const missing=ceremonyFixture({missingNorth:true});missing.finish();
  assert.equal(missing.h.quest.getStage(missing.p),8);
  assert.equal(missing.p.getInventory().getAmount(I.ORBS_OF_PROTECTION),0,'he has them');
  assert.equal(missing.p.getAttribute('tree-gnome-village:orbs-given'),true);
  assert.equal(missing.p.varbits.get(VARBIT_ORBS),1);
  assert.equal(variant(missing.h,missing.p,N.KING_BOLREN).variant,'return-of-the-orb','Bolren still holds the ceremony');
  const cancelled=ceremonyFixture();let limit=30;
  while(cancelled.h.tasks.length===0&&limit-->0)cancelled.manager.advance();
  assert.ok(limit>0);cancelled.manager.reset();
  for(let i=0;i<12;i++)cancelled.tick();
  assert.equal(cancelled.h.quest.getStage(cancelled.p),8);
  assert.equal(cancelled.p.getInventory().getAmount(I.GNOME_AMULET),0);
  // Talking to him again finishes it.
  const king=cancelled.npcs[0];
  runtime.startTranscript(cancelled.h.api,cancelled.p,N.KING_BOLREN,PAGE,'return-of-the-orb',undefined,king);
  cancelled.finish();
  assert.equal(cancelled.h.quest.getStage(cancelled.p),9);
  assert.equal(cancelled.p.getInventory().getAmount(I.GNOME_AMULET),1);
  assert.equal(cancelled.p.getAttribute('tree-gnome-village:orbs-given'),false);
});

test('guide-out action waits for its canonical message and ignores other actors/stages', () => {
  const h = harness(), p = makePlayer();
  line(h, p, N.KING_BOLREN, 'I would be glad to help.');
  assert.deepEqual([p.getLocation().x,p.getLocation().y],[2541,3170]);
  action(h,p,N.ELKOY,'GnZ1Sn');tick(h,3);
  assert.equal(p.getLocation().x,2541);
  h.quest.setStage(p,2);
  action(h,p,N.KING_BOLREN,'GnZ1Sn');tick(h,3);
  assert.equal(p.getLocation().x,2541);
  h.quest.setStage(p,1);
  action(h,p,N.KING_BOLREN,'GnZ1Sn',null);tick(h,3);
  assert.equal(p.getLocation().x,2541,'only the message step guides');
  // Bolren stands at the east edge of the village box; the guide no longer depends on it.
  p.setLocation(2543,3169,0);
  action(h,p,N.KING_BOLREN,'GnZ1Sn');tick(h,3);
  assert.deepEqual([p.getLocation().x,p.getLocation().y],[2504,3191]);
  action(h,p,N.KING_BOLREN,'GnZ1Sn');tick(h,3);
  assert.equal(h.quest.getStage(p),1);
});

test('cached Elkoy Follow uses the dialogue shortcut in both directions after starting', () => {
  const h=harness(),p=makePlayer();
  const follow=h.npcHooks.find(hook=>hook.name==='Elkoy').handlers.Follow;
  assert.ok(CacheDefinitions.getNpc(N.ELKOY_2).actions.includes('Follow'));
  assert.ok(!CacheDefinitions.getNpc(N.ELKOY).actions.includes('Follow'));
  follow({player:p,npcId:ELKOY_OUTSIDE});
  assert.equal(p.getLocation().x,2541,'no shortcut before starting');
  h.quest.setStage(p,1);
  follow({player:p,npcId:N.KING_BOLREN});
  assert.equal(p.getLocation().x,2541,'unrelated NPC cannot guide');
  // Follow plays the guide answer of Elkoy's Talk-to for the stage and side (the box, then his line).
  follow({player:p,npcId:N.ELKOY_2});
  assert.deepEqual(h.transcripts.at(-1),{npcId:N.ELKOY_2,page:PAGE,
    variant:'tree-gnome-king-talking-to-elkoy-after-starting-the-quest-inside-the-maze'});
  const inside=action(h,p,N.ELKOY_2,'BeeQDX');
  assert.equal(inside.box.holdTicks,4,'the guide box holds over the fade');
  follow({player:p,npcId:N.ELKOY_2});action(h,p,N.ELKOY_2,'BeeQDX');
  assert.equal(h.tasks.filter(t=>t.isRunning()).length,1,'a second click during the walk starts no second walk');
  tick(h,3);
  assert.deepEqual([p.getLocation().x,p.getLocation().y],[2504,3191]);
  follow({player:p,npcId:ELKOY_OUTSIDE});
  action(h,p,ELKOY_OUTSIDE,'DoDThh');
  assert.deepEqual([p.getLocation().x,p.getLocation().y],[2504,3191],'the follow fades out first');
  tick(h,3);
  assert.deepEqual([p.getLocation().x,p.getLocation().y],[2515,3159]);
  assert.equal(h.quest.getStage(p),1);
});

test('closed chest opening falls through without an orb; only open Search starts the reward', () => {
  const h=harness(),p=makePlayer();
  h.quest.setStage(p,5);
  assert.equal(object(h,p,2183,'Open').handled,false);
  assert.equal(object(h,p,2183,'Search').handled,false,'closed loc has no Search');
  assert.equal(object(h,p,2182,'Open').handled,false,'open loc has no Open');
  assert.equal(h.transcripts.length,0);
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION),0);
  assert.equal(object(h,p,2182,'Search').handled,true);
  assert.equal(h.transcripts.length,1);
  action(h,p,N.KHAZARD_COMMANDER,'JOh59P');
  object(h,p,2182,'Search');
  assert.equal(h.transcripts.length,1,'a second search cannot repeat the reward');
  assert.equal(p.messages.at(-1),'The chest is empty.');
  assert.equal(p.getInventory().getAmount(I.ORB_OF_PROTECTION),1);
});

test('the closed stronghold door keeps the canonical outside lock at every quest stage', () => {
  const h=harness(), p=makePlayer();
  const at=new core.Location(2502,3250,0);
  const closed=new core.GameObject(core.ObjectIdentifiers.DOOR_67,at,0,1,null);
  for (const stage of [0,1,4,5,6,7,8,9]) {
    h.quest.setStage(p,stage);
    p.setLocation(2502,3250);
    const event={player:p,object:closed,objectId:closed.getId(),handled:false};
    emit(h,'door:toggle',event);
    assert.equal(event.handled,true);
    assert.equal(h.transcripts.at(-1).variant,'into-the-stronghold-opening-the-stronghold-door-from-the-outside');
    assert.equal(h.quest.getStage(p),stage);
  }
  const count=h.transcripts.length;
  for (const object of [
    new core.GameObject(core.ObjectIdentifiers.DOOR_67,new core.Location(2502,3251,0),0,2,null),
    new core.GameObject(core.ObjectIdentifiers.DOOR_67,new core.Location(2502,3250,1),0,1,null),
    new core.GameObject(core.ObjectIdentifiers.DOOR_3,at,0,1,null),
  ]) {
    const event={player:p,object,objectId:object.getId(),handled:false};
    emit(h,'door:toggle',event);
    assert.equal(event.handled,false,'open pose, other plane and other door keep ordinary handling');
  }
  p.setLocation(2502,3251);
  const inside={player:p,object:closed,objectId:closed.getId(),handled:false};
  emit(h,'door:toggle',inside);
  assert.equal(inside.handled,false);
  assert.equal(h.transcripts.length,count);
});

test('the stronghold door lets the player out as live: inviswall, the open leaf north, a step out, shut two ticks later', () => {
  // The user's rsprox capture, local 1001802 ticks 1587-1592 (revision 242).
  const {RegionManager}=require('../dist/game/collision/RegionManager');
  const {ObjectManager}=require('../dist/game/entity/impl/object/ObjectManager');
  const {MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
  if(RegionManager.regions.size===0)RegionManager.init();
  RegionManager.loadMapFiles(2502,3250);
  const h=harness(),p=makePlayer(),tasks=[],names=new Map(),sounds=[];
  h.quest.setStage(p,6);
  const steps=[];
  const movement={reset(){steps.length=0;return movement;},setBlockMovement(){return movement;},addSteps(at){steps.push(at);},size:()=>steps.length};
  p.getMovementQueue=()=>movement;
  require('../plugins/objects/Doors.plugin').register({
    core:{...core,ObjectManager,MapObjects,Sounds:{sendSound(player,id){sounds.push(id);}},TaskManager:{
      submit(task){task.setRunning(true);tasks.push(task);},
      cancelTasks(key){for(const task of tasks)if(task.key===key)task.stop();},
    }},
    onObjectInteraction:(name,handlers)=>names.set(name,handlers),
    onRegionLoaded(){},onServerStartup(){},onObjectRoute(){},
    onCustomEvent:h.api.onCustomEvent,emitCustomEvent:h.api.emitCustomEvent,
  });
  const click=object=>names.get('Door').Open({player:p,object,objectId:object.getId(),
    definition:core.ObjectDefinition.forId(object.getId()),location:{
      x:object.getLocation().getX(),y:object.getLocation().getY(),z:0},clickType:1});
  const closed=MapObjects.get(core.ObjectIdentifiers.DOOR_67,new core.Location(2502,3250,0),null);
  assert.ok(closed,'active-cache physical door exists');
  assert.equal(closed.getFace(),1);
  p.setLocation(2502,3251);
  assert.equal(click(closed),true,'Open from inside');
  assert.ok(MapObjects.get(38848,new core.Location(2502,3250,0),null),'inviswall on the doorway');
  assert.equal(MapObjects.get(1539,new core.Location(2502,3251,0),null)?.getFace(),2,'inactivepoordoor on the tile north');
  assert.deepEqual(steps.map(at=>[at.getX(),at.getY()]),[[2502,3250]],'the player steps out onto the doorway tile');
  for(let i=0;i<2;i++)for(const task of [...tasks])if(task.isRunning())task.tick();
  assert.equal(MapObjects.get(core.ObjectIdentifiers.DOOR_67,new core.Location(2502,3250,0),null)?.getFace(),1,'shut two ticks later');
  assert.equal(MapObjects.get(1539,new core.Location(2502,3251,0),null),null);
  p.setLocation(2502,3250);
  const count=h.transcripts.length;
  click(MapObjects.get(core.ObjectIdentifiers.DOOR_67,new core.Location(2502,3250,0),null));
  assert.equal(h.transcripts.length,count+1,'from outside it is locked');
  assert.equal(h.quest.getStage(p),6);
});

test('Talk-to on the unindexed Elkoy and warlord spawns plays the quest page, and leaves other stages to the generic page', () => {
  const h = harness();
  const talk = h.npcHooks.filter((hook) => hook.handlers['Talk-to']);
  assert.deepEqual(talk.map((hook) => hook.name).sort(), ['Elkoy', 'Khazard warlord']);
  const p = makePlayer();
  const via = (name, npc) => talk.find((hook) => hook.name === name).handlers['Talk-to']({ player: p, npc, npcId: npc.getId() });
  const elkoy = new NPC(ELKOY_OUTSIDE, new core.Location(2504, 3193, 0));
  const warlord = new NPC(WARLORD_SPAWN, new core.Location(2457, 3302, 0));
  assert.equal(via('Elkoy', elkoy), false, 'before the quest the generic Elkoy page plays');
  h.quest.setStage(p, 7);
  p.setLocation(2504, 3191, 0);
  assert.equal(via('Elkoy', elkoy), true);
  assert.deepEqual(h.transcripts.at(-1), { npcId: ELKOY_OUTSIDE, page: PAGE,
    variant: 'bringing-bolren-the-orb-talking-to-elkoy-after-giving-bolren-the-orb-of-protection-outside-the-maze' });
  assert.equal(via('Khazard warlord', warlord), true);
  assert.deepEqual(h.transcripts.at(-1), { npcId: WARLORD_SPAWN, page: PAGE, variant: 'the-khazard-warlord' });
  assert.equal(via('Elkoy', new NPC(N.ELKOY, new core.Location(2504, 3193, 0))), false, 'indexed ids keep the dialogue plugin');
  h.quest.setStage(p, 9);
  assert.equal(via('Elkoy', elkoy), false, 'after the quest the Elkoy page plays');
});

test('an object click that carries only its click index still fires the ballista and searches the chest', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 4);
  p.setAttribute('tree-gnome-village:trackers', 7);
  const click = (objectId, clickType) => {
    const event = { player: p, object: { getId: () => objectId }, objectId, definition: core.ObjectDefinition.forId(objectId),
      clickType, location: p.getLocation(), handled: false };
    for (const handler of h.objectHooks) handler(event);
    return event.handled;
  };
  const fireSlot = core.ObjectDefinition.forId(2181).getInteractions().findIndex((o) => o === 'Fire') + 1;
  assert.ok(fireSlot > 0);
  assert.equal(click(2181, fireSlot), true);
  assert.equal(h.transcripts.at(-1).variant, 'using-the-ballista');
  assert.equal(click(2181, fireSlot === 1 ? 2 : 1), false, 'another slot of the same loc is not Fire');
});

test('after a cut-off ceremony, killing the warlord again drops no second set of orbs', () => {
  const h=harness(),p=makePlayer();h.quest.setStage(p,8);p.setAttribute('tree-gnome-village:orbs-given',true);
  death(h,p,WARLORD_SPAWN);
  assert.equal(h.groundItems.length,0,'Bolren already holds them');
  assert.equal(h.transcripts.some(t=>t.variant==='the-khazard-warlord-when-defeated'),false);
});

test('two kills within 30 ticks keep the talking warlord hidden 30 ticks after the second', () => {
  const h=harness(),p=makePlayer();h.quest.setStage(p,7);
  death(h,p,WARLORD_SPAWN);tick(h,10);
  death(h,p,WARLORD_SPAWN);
  tick(h,25);assert.equal(p.varbits.get(3460),1,'the first fall\'s timer does not show him early');
  tick(h,5);assert.equal(p.varbits.get(3460),0);
});
