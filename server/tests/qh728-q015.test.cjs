// Darkness of Hallowvale (q015) source-contract regression.
// From server/: node --test tests/qh728-q015.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

const core = PluginManager.getCoreApi();
const PROP_ID = core.NpcIdentifiers.MEIYERDITCH_CITIZEN; // 3780
const VELIAF_ID = core.NpcIdentifiers.VELIAF_HURTZ; // 989
const RAL_ID = core.NpcIdentifiers.OLD_MAN_RAL; // 3772
const DREZEL_ID = core.NpcIdentifiers.DREZEL; // 9636
const ROALD_ID = core.NpcIdentifiers.KING_ROALD; // 1399
const VERTIDA_ID = core.NpcIdentifiers.VERTIDA_SEFALATIS; // 8220
const SAFALAAN_ID = core.NpcIdentifiers.SAFALAAN_HALLOW_2; // 8216
const SARIUS_ID = core.NpcIdentifiers.SARIUS_GUILE; // 3776

function setup({ tasteOfHope = false } = {}) {
  const transcripts = [];
  runtime.startTranscript = (api, player, npcId, page, variant, select) => {
    transcripts.push({ page, variant, select });
    return true;
  };

  const custom = new Map();
  let inAidComplete = true;
  const npcHooks = [];
  const objectHooks = [];
  const itemObjectHooks = [];
  const itemItemHooks = [];
  const dialogueConditionHooks = [];
  const groundHooks = [];
  const loginHooks = [];
  const logoutHooks = [];
  const levels = new Map();
  const spawned = [], removed = [];
  const api = new Proxy({
    core: {
      ...core,
      ObjectManager: { register() {}, deregister() {} },
    },
    persistAttribute() {},
    onCustomEvent(name, fn) {
      if (!custom.has(name)) custom.set(name, []);
      custom.get(name).push(fn);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && event?.key === 'in_aid_of_the_myreque') event.complete = inAidComplete;
      for (const fn of custom.get(name) ?? []) fn(event);
    },
    onNpcInteraction(first, second) {
      if (typeof first === 'function') npcHooks.push(first);
      else for (const fn of Object.values(second ?? {})) npcHooks.push(fn);
    },
    onObjectInteraction(fn) { objectHooks.push(fn); },
    onItemOnObject(fn) { itemObjectHooks.push(fn); },
    onItemOnItem(fn) { itemItemHooks.push(fn); },
    onNpcDialogueCondition(fn) { dialogueConditionHooks.push(fn); },
    onGroundItemPickup(fn) { groundHooks.push(fn); },
    onPlayerLogin(fn) { loginHooks.push(fn); },
    onPlayerLogout(fn) { logoutHooks.push(fn); },
    onNpcHitModify() {},
    onNpcDeath() {},
    onItemAction() {},
    spawnNpc(def) {
      const npc = {
        def,
        getId: () => def.id,
        getLocation: () => new core.Location(def.x, def.y, def.z),
        setPositionToFace() {},
        isRegistered: () => true,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { removed.push(npc); },
    getWorld: () => ({ getNpcs: () => [] }),
    getItemOnGroundManager: () => ({ registerLocation() {}, getGroundItem() { return null; } }),
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        const fn = args.findLast((arg) => typeof arg === 'function');
        if (fn) npcHooks.push(fn);
      };
    },
  });

  if (tasteOfHope) require('../plugins/quests/quests/TasteOfHope.Quest')(api);
  require('../plugins/quests/quests/DarknessOfHallowvale.Quest')(api);
  const tasteQuest = tasteOfHope
    ? runtime.getRegisteredQuests().findLast((entry) => entry.key === 'taste_of_hope')
    : null;
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'darkness_of_hallowvale');

  const attributes = new Map();
  const items = new Map();
  const varbits = new Map();
  const messages = [];
  const xp = [];
  let location = new core.Location(3595, 3310, 1);
  let freeSlots = 28;
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); },
    isFull: () => freeSlots <= 0,
    getFreeSlots: () => freeSlots,
    forceAdd(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
  };
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
  }, { get(target, prop) { return prop in target ? target[prop] : () => sender; } });
  const player = {
    getUsername: () => 'qh728-q015',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({ getItems: () => [] }),
    getPacketSender: () => sender,
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: (skill) => levels.get(skill) ?? 99,
      getCombatLevel: () => 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage() {} }) }),
    getLocation: () => location,
    moveTo(value) { location = new core.Location(value.getX(), value.getY(), value.getZ()); },
    getPrivateArea: () => null,
    isPlayerBot: () => false,
    isRegistered: () => true,
    isPlayer: () => true,
    sendMessage(message) { messages.push(message); },
  };

  const emit = (name, event = {}) => {
    const payload = { player, ...event };
    api.emitCustomEvent(name, payload);
    return payload;
  };
  const action = (stepId, npcId = PROP_ID) => emit('npc-dialogue:action', { npcId, stepId });
  const choice = (option, npcId = PROP_ID) => emit('npc-dialogue:choice', { npcId, option });
  const condition = (stepId, npcId = PROP_ID) => emit('npc-dialogue:condition', { npcId, stepId, text: '' });
  const answerCondition = (stepId, npcId = VELIAF_ID) => {
    for (const handler of dialogueConditionHooks) {
      const result = handler({ player, npcId, stepId });
      if (typeof result === 'boolean') return result;
    }
    return null;
  };
  const object = (objectId, definitionId = objectId, loc) => {
    const event = {
      player,
      objectId,
      definition: { id: definitionId, getName: () => 'Object', getActions: () => [] },
      location: loc ?? location,
    };
    for (const hook of objectHooks) hook(event);
    return event;
  };
  const npc = (npcId, option = 'Talk-to') => {
    const event = {
      player,
      npcId,
      definition: { id: npcId, getName: () => 'NPC', getActions: () => [option] },
      clickType: 1,
    };
    for (const hook of npcHooks) hook(event);
    return event;
  };
  const ground = (groundItemId) => {
    const event = { player, groundItemId };
    for (const hook of groundHooks) hook(event);
    return event;
  };
  const itemOnItem = (usedItemId, usedWithItemId) => {
    const event = { player, usedItemId, usedWithItemId };
    for (const hook of itemItemHooks) hook(event);
    return event;
  };
  const login = () => {
    for (const hook of loginHooks) hook({ player });
    runtime.sendQuestVarps({ player });
  };
  const itemOnObject = (itemId, objectId, loc) => {
    const event = {
      player,
      itemId,
      objectId,
      location: loc ?? location,
      definition: { id: objectId, getName: () => 'Object', getActions: () => [] },
    };
    for (const hook of itemObjectHooks) hook(event);
    return event;
  };

  return {
    api, core, quest, tasteQuest, player, items, varbits, messages, xp, transcripts,
    spawned, removed, action, choice, condition, answerCondition, object, npc, ground, itemOnObject, itemOnItem, login, emit,
    stage: () => quest.getStage(player),
    setSkill: (skill, level) => levels.set(skill, level),
    journal: () => quest.buildJournal(player, quest),
    setStage: (value) => quest.setStage(player, value),
    setInAidComplete: (value) => { inAidComplete = value; },
    setFreeSlots: (value) => { freeSlots = value; },
    setLocation: (x, y, z) => { location = new core.Location(x, y, z); },
  };
}

test('northern sketch receipt advances to the western leg and updates the journal', () => {
  const h = setup();
  h.setStage(200); // Fixture start: Safalaan has issued the sketch supplies, on the north leg.
  h.action('40UwLv');
  h.action('stfs9v');

  assert.equal(h.stage(), 210, 'the northern sketch completes the north leg');
  assert.equal(h.items.get(h.core.ItemIdentifiers.CASTLE_SKETCH_1), 1);
  assert.match(h.journal().join('\n'), /northern approach is sketched/i);
});

test('western sketch receipt advances to the southern leg', () => {
  const h = setup();
  h.setStage(210);
  h.action('9HmeKD');
  assert.equal(h.stage(), 220);
  assert.equal(h.items.get(h.core.ItemIdentifiers.CASTLE_SKETCH_2), 1);
});

test('Vertida message receipt actions use the imported ids and keep the stage on a full bag', () => {
  for (const stepId of ['2nbZ9m', 'ZsS1Zs']) {
    const h = setup();
    h.setStage(80);
    h.setFreeSlots(0);
    const blocked = h.action(stepId);
    assert.equal(blocked.handled, true, `${stepId} is consumed by the quest handler`);
    assert.equal(h.items.get(h.core.ItemIdentifiers.MESSAGE_2) ?? 0, 0);
    assert.equal(h.stage(), 80, 'the stage remains at Vertida until the message is received');

    h.setFreeSlots(1);
    h.action(stepId);
    assert.equal(h.items.get(h.core.ItemIdentifiers.MESSAGE_2), 1);
    assert.equal(h.stage(), 90);
  }
});

test('Drezel rune handout waits for enough room before advancing', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.setStage(120);
  h.setFreeSlots(2);
  h.action('CvqNxO');
  assert.equal(h.stage(), 120);
  assert.equal(h.items.get(I.AIR_RUNE) ?? 0, 0);
  assert.equal(h.items.get(I.FIRE_RUNE) ?? 0, 0);
  assert.equal(h.items.get(I.LAW_RUNE) ?? 0, 0);

  h.setFreeSlots(3);
  h.action('CvqNxO');
  assert.equal(h.stage(), 130);
  assert.equal(h.items.get(I.AIR_RUNE), 3);
  assert.equal(h.items.get(I.FIRE_RUNE), 1);
  assert.equal(h.items.get(I.LAW_RUNE), 1);
});

test('Drezel fills an existing partial rune stack before advancing', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.setStage(120);
  h.items.set(I.AIR_RUNE, 1);
  h.setFreeSlots(2);
  h.action('CvqNxO');
  assert.equal(h.stage(), 130);
  assert.equal(h.items.get(I.AIR_RUNE), 4, 'the receipt adds all three runes to the existing stack');
  assert.equal(h.items.get(I.FIRE_RUNE), 1);
  assert.equal(h.items.get(I.LAW_RUNE), 1);
  h.action('CvqNxO');
  assert.equal(h.items.get(I.AIR_RUNE), 4, 'replaying the receipt after stage 130 gives nothing more');
  assert.equal(h.items.get(I.FIRE_RUNE), 1);
  assert.equal(h.items.get(I.LAW_RUNE), 1);
});

test('Drezel gives the full rune amounts into existing stacks with no free slots', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.setStage(120);
  h.items.set(I.AIR_RUNE, 100);
  h.items.set(I.FIRE_RUNE, 2);
  h.items.set(I.LAW_RUNE, 9);
  h.setFreeSlots(0);
  h.action('CvqNxO');
  assert.equal(h.stage(), 130);
  assert.equal(h.items.get(I.AIR_RUNE), 103);
  assert.equal(h.items.get(I.FIRE_RUNE), 3);
  assert.equal(h.items.get(I.LAW_RUNE), 10);
});

test('full-bag handouts cannot consume the charcoal, sketch, key or ladder-top leg', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;

  h.setStage(190);
  h.setFreeSlots(0);
  h.action('H84BAo');
  h.action('q1EHcV');
  assert.equal(h.stage(), 190, 'no supplies handout means no sketch leg');
  assert.equal(h.items.get(I.CHARCOAL) ?? 0, 0);

  h.setFreeSlots(28);
  h.action('H84BAo');
  h.action('q1EHcV');
  assert.equal(h.stage(), 200);
  assert.equal(h.items.get(I.CHARCOAL), 1);
  assert.equal(h.items.get(I.PAPYRUS), 3);

  h.setStage(220); // Fixture start: the southern approach is being finished.
  h.items.set(I.CASTLE_SKETCH_2, 1);
  h.items.set(I.PAPYRUS, 2); // One papyrus is used by the sketch, but the stack keeps its slot.
  h.action('aCPM8x'); // Vanstrom departs; the separate Sarius interaction is available.
  assert.equal(h.stage(), 240);
  h.npc(SARIUS_ID);
  assert.equal(h.stage(), 240);
  h.setFreeSlots(0);
  h.action('IxTC2L');
  assert.equal(h.stage(), 240, 'losing the third sketch cannot advance past sketching');
  assert.equal(h.items.get(I.CASTLE_SKETCH_3) ?? 0, 0);
  h.setFreeSlots(28);
  h.action('IxTC2L');
  assert.equal(h.stage(), 250);
  assert.equal(h.items.get(I.CASTLE_SKETCH_3), 1);

  h.setStage(65); // Fixture start: the hideout ladder shortcut is being repaired.
  h.setFreeSlots(0);
  h.action('6j1G8t');
  assert.equal(h.items.get(I.LADDER_TOP) ?? 0, 0);
  assert.notEqual(h.varbits.get(2598), 1, 'a failed handout must leave the wall searchable');
  h.setFreeSlots(28);
  h.action('6j1G8t');
  assert.equal(h.items.get(I.LADDER_TOP), 1);
  assert.equal(h.varbits.get(2598), 1);

  h.setStage(280); // Fixture start: the laboratory is open, the rune case is untouched.
  h.setFreeSlots(0);
  h.action('xVr0GB');
  assert.notEqual(h.varbits.get(2584), 1, 'a full bag leaves the rune case searchable');
  assert.equal(h.items.get(I.LAW_RUNE) ?? 0, 0);
  h.setFreeSlots(5);
  h.action('xVr0GB');
  assert.equal(h.varbits.get(2584), 1);
  assert.equal(h.items.get(I.LAW_RUNE), 1);
  assert.equal(h.items.get(I.AIR_RUNE), 3);

  h.setStage(250); // Fixture start: the fireplace/portrait chain.
  h.setFreeSlots(0);
  h.action('1UyE4K');
  h.action('JSi5fj');
  h.object(18126, 18043);
  assert.match(h.transcripts.at(-1).variant, /without-having-the-key/, 'the portrait stays recoverable');
  h.setFreeSlots(28);
  h.object(18126, 18043);
  h.action('TjjajY');
  assert.equal(h.items.get(I.LARGE_ORNATE_KEY), 1);
  assert.equal(h.varbits.get(2595), 2);

  h.items.delete(I.LARGE_ORNATE_KEY);
  h.object(18126, 18043);
  assert.match(h.transcripts.at(-1).variant, /without-having-the-key/, 'a dropped key stays reclaimable');
  h.action('TjjajY');
  assert.equal(h.items.get(I.LARGE_ORNATE_KEY), 1);
});

test('boarding the Burgh boat returns to Meiyerditch after the Misthalin leg', () => {
  const h = setup();
  h.setStage(180); // Fixture start: Veliaf has sent the player back to Sanguinesti.
  h.setLocation(3523, 3169, 0);
  h.action('3tBjzy');
  assert.deepEqual(
    [h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3588, 3173, 1]
  );
});

test('picking the haemalchemy book off the laboratory floor advances the laboratory leg', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.setStage(280); // Fixture start: the laboratory is open, the book still on the floor.
  h.ground(I.SEALED_MESSAGE); // A different ground item must not touch the book leg.
  assert.equal(h.stage(), 280);
  h.ground(I.HAEMALCHEMY_VOLUME_1);
  assert.equal(h.stage(), 290);
});

test('the Drakan wall shortcut climbs between the city wall and Safalaan', () => {
  const h = setup();
  h.setStage(180);
  h.setLocation(3595, 3310, 1);
  const up = h.object(39173);
  assert.equal(up.handled, true);
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()], [3595, 3311, 0]);

  const down = h.object(39172);
  assert.equal(down.handled, true);
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()], [3595, 3310, 1]);
});

test('the quest-local handler reaches every mandatory stage from 0 to completion', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  const START_HOOK = 'quest:darkness-of-hallowvale:start';

  h.items.set(I.HAMMER, 1);
  h.items.set(I.PLANK, 2);
  h.items.set(I.IRON_NAILS, 8);
  h.items.set(I.KNIFE, 1);

  h.emit('npc-dialogue:hook', { npcId: VELIAF_ID, hook: START_HOOK });
  assert.equal(h.stage(), 10);

  h.condition('_usOY0');
  assert.equal(h.stage(), 20);
  h.condition('RdMtCs');
  assert.equal(h.stage(), 30);
  h.action('TZQ0Xt');
  assert.equal(h.stage(), 40);
  h.action('3tBjzy');
  assert.equal(h.stage(), 50);
  h.action('GhU7Fg');
  assert.equal(h.stage(), 52);
  h.action('lOyj8b');
  assert.equal(h.stage(), 54);

  h.choice('(whisper) Do you know about the Myreque?');
  h.choice('(whisper) I really need to meet the Myreque.');
  h.choice('How can Old Man Ral help me?');
  assert.equal(h.stage(), 60);
  h.choice('Old Man Ral, the sage of Sanguinesti.', RAL_ID);
  assert.equal(h.stage(), 65);

  h.object(18065); // Pots
  h.action('YpqCg3');
  assert.equal(h.items.get(I.DOOR_KEY_2), 1);
  const doorTile = new h.core.Location(3608, 3221, 0);
  h.setLocation(3608, 3221, 0);
  h.object(18091, 18091, doorTile);
  h.action('K30GgU');
  assert.equal(h.items.get(I.DOOR_KEY_2) ?? 0, 0);
  h.object(18091, 18091, doorTile);
  assert.notDeepEqual([h.player.getLocation().getX(), h.player.getLocation().getY()], [3608, 3221]);

  h.object(18115, 18066); // Wall with the ladder top
  h.action('6j1G8t');
  assert.equal(h.items.get(I.LADDER_TOP), 1);
  h.object(18116, 18068); // Broken floor ladder
  h.action('cjSvUe');
  assert.equal(h.items.get(I.LADDER_TOP) ?? 0, 0);
  assert.equal(h.varbits.get(2598), 2);
  h.object(18116, 18069);
  assert.deepEqual(
    [h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3629, 3239, 0]
  );

  h.itemOnObject(I.KNIFE, 17980);
  h.action('_CuGrg');
  assert.equal(h.stage(), 70);
  h.object(18146);
  h.object(18120, 17984);
  h.object(18120, 17985);
  assert.equal(h.stage(), 80);

  h.action('V3ECPh');
  assert.equal(h.stage(), 90);
  h.action('ctOdo7');
  assert.equal(h.stage(), 100);
  h.choice('Okay, will do.', DREZEL_ID);
  assert.equal(h.stage(), 110);
  h.action('x6Upep');
  assert.equal(h.stage(), 120);
  h.action('CvqNxO');
  assert.equal(h.stage(), 130);
  h.choice('Talk to the king about Morytania.', ROALD_ID);
  assert.equal(h.stage(), 140);
  h.action('K65B9f');
  assert.equal(h.stage(), 160);
  assert.equal(h.varbits.get(2573), 170, 'after the teleport the client asks for Veliaf, not Roald');
  h.npc(VELIAF_ID);
  assert.equal(h.stage(), 180, 'the canonical post-Roald Veliaf talk sends the player back');
  assert.equal(
    h.transcripts.at(-1).variant,
    'misthalin-diplomacy-talking-to-veliaf-hurtz-after-talking-to-king-roald'
  );
  assert.equal(h.varbits.get(2573), 180, 'the client asks for the Meiyerditch base');
  h.setLocation(3523, 3169, 0);
  h.action('3tBjzy');
  assert.deepEqual(
    [h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3588, 3173, 1],
    'boarding the Burgh boat returns to Meiyerditch after the Misthalin leg'
  );

  h.npc(VERTIDA_ID);
  assert.equal(
    h.transcripts.at(-1).variant,
    'close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-after-being-sent-to-inform-the-sanguinesti-myreque'
  );
  h.action('lTNaN8');
  assert.equal(h.stage(), 190);
  h.object(18056); // Rocky surface
  h.action('_bUtsy');
  h.object(18054); // Barricade
  assert.deepEqual(
    [h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3595, 3310, 1]
  );
  h.object(39173); // Wall Climb-up to Safalaan
  assert.deepEqual(
    [h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3595, 3311, 0]
  );
  h.action('H84BAo');
  assert.equal(h.stage(), 200);
  h.action('q1EHcV');
  h.action('40UwLv');
  h.action('stfs9v');
  assert.equal(h.stage(), 210);
  h.action('5hTQYh');
  h.action('9HmeKD');
  h.action('T3YqyD');
  assert.equal(h.stage(), 220);
  h.action('aCPM8x');
  assert.equal(h.stage(), 240);
  h.npc(SARIUS_ID);
  assert.equal(h.stage(), 240);
  h.action('yFIZpi');
  h.action('IxTC2L');
  assert.equal(h.stage(), 250);

  h.itemOnObject(I.KNIFE, 18039); // Fireplace
  h.action('au23P0');
  h.itemOnObject(I.KNIFE, 18126); // Portrait
  h.action('1UyE4K');
  h.action('JSi5fj');
  h.action('3RdQ7u');
  assert.equal(h.stage(), 260);
  assert.equal(h.varbits.get(2575), 1, 'the sketches are mirrored to myq3_sketches_given');
  h.action('fKY8Zv');
  h.itemOnObject(I.KNIFE, 18125); // Tapestry
  h.action('X-aSfS');
  h.itemOnObject(I.LARGE_ORNATE_KEY, 18127); // Vampyre statue
  h.action('w7RMRv');
  assert.equal(h.stage(), 280);
  h.object(18047); // Laboratory door
  assert.deepEqual(
    [h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3641, 3306, 0]
  );
  h.object(18052); // Broken rune case
  h.action('xVr0GB');
  h.ground(I.HAEMALCHEMY_VOLUME_1);
  assert.equal(h.stage(), 290);
  h.object(18050); // Laboratory stairs up
  assert.deepEqual(
    [h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()],
    [3643, 3305, 0]
  );
  h.npc(h.core.NpcIdentifiers.SAFALAAN_HALLOW_2);
  h.action('3QAxxe');
  h.action('lzpy1g');
  assert.equal(h.stage(), 300);
  assert.equal(h.items.get(I.SEALED_MESSAGE), 1);
  assert.equal(h.varbits.get(2573), 310, 'the sealed message sends the client to Veliaf to finish');

  h.npc(VELIAF_ID);
  h.action('xIJysR');
  assert.equal(h.stage(), 310);
  assert.equal(h.varbits.get(2573), 320, 'the cache completion floor is 320');
  assert.equal(h.items.get(I.SEALED_MESSAGE) ?? 0, 0, 'the sealed message is handed in');
  assert.equal(h.items.get(I.TOME_OF_EXPERIENCE_3_), 1);
  assert.deepEqual(h.xp.map((entry) => entry.amount), [7000, 6000, 2000]);
  assert.match(h.journal().join('\n'), /QUEST COMPLETE/);
});

test('completion keeps durable stage 310 while varbit 2573 reaches 320 and replays on login', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.setStage(300);
  h.items.set(I.SEALED_MESSAGE, 1);
  h.action('xIJysR');

  assert.equal(h.stage(), 310, 'the durable stage stays the internal alias');
  assert.equal(h.varbits.get(2573), 320, 'the cache completion floor is 320');
  assert.equal(h.quest.varbitValue(310, h.player), 320);

  h.varbits.clear();
  h.login();
  assert.equal(h.stage(), 310);
  assert.equal(h.varbits.get(2573), 320, 'login re-sends the canonical completion value');
  assert.match(h.journal().join('\n'), /QUEST COMPLETE/);
});

test('the imported post-King-Roald Vertida branch is selected and resolves through t2mfif', () => {
  const page = require('../data/definitions/npc-dialogues.json')['Darkness of Hallowvale'];
  const variant = 'misthalin-diplomacy-talking-to-vertida-sefalatis-after-talking-to-king-roald';
  assert.deepEqual(page.variants[variant], [{ type: 'call', branch: 't2mfif' }]);
  assert.equal(
    page.branches.t2mfif[1].text,
    'Myreque prevail, [player name]. You should have a chat with Safalaan. He may be able to help you.'
  );

  const h = setup();
  h.setStage(140);
  h.npc(VERTIDA_ID);
  assert.equal(h.transcripts.at(-1).variant, variant);
  h.setStage(160);
  h.npc(VERTIDA_ID);
  assert.equal(h.transcripts.at(-1).variant, variant);
  h.setStage(170);
  h.npc(VERTIDA_ID);
  assert.equal(h.transcripts.at(-1).variant, variant, 'the post-Roald window covers the legacy alias too');
  h.setStage(180);
  h.npc(VERTIDA_ID);
  assert.notEqual(h.transcripts.at(-1).variant, variant, 'back in the hideout the briefing replaces the pointer');
});

test('the Veliaf talk after the Roald teleport plays the canonical page and sends the player back', () => {
  const h = setup();
  h.setStage(140);
  h.npc(VELIAF_ID);
  assert.equal(
    h.transcripts.at(-1).variant,
    'misthalin-diplomacy-talking-to-veliaf-hurtz-after-encountering-the-werewolves',
    'before Roald answers, Veliaf still asks for his answer'
  );
  assert.equal(h.stage(), 140, 'that page gives no task, so it cannot advance the stage');

  h.setStage(160);
  h.npc(VELIAF_ID);
  assert.equal(
    h.transcripts.at(-1).variant,
    'misthalin-diplomacy-talking-to-veliaf-hurtz-after-talking-to-king-roald'
  );
  assert.equal(h.stage(), 180, 'Veliaf sends the player back to the Sanguinesti order');

  h.setStage(180);
  h.npc(VELIAF_ID);
  assert.equal(
    h.transcripts.at(-1).variant,
    'misthalin-diplomacy-talking-to-veliaf-again-after-being-sent-to-inform-the-sanguinesti-myreque'
  );
  assert.equal(h.stage(), 180, 'the repeat page does not advance the stage again');
});

test('one Vertida talk in the hideout reaches Safalaan with the canonical briefing', () => {
  const h = setup();
  const briefing =
    'close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-after-being-sent-to-inform-the-sanguinesti-myreque';

  h.setStage(180);
  h.npc(VERTIDA_ID);
  assert.equal(h.transcripts.at(-1).variant, briefing);
  h.action('lTNaN8');
  assert.equal(h.stage(), 190, '"Okay, lead the way." leads the player to Safalaan');
  assert.equal(h.varbits.get(2573), 190);

  h.setStage(199);
  h.npc(VERTIDA_ID);
  assert.equal(h.transcripts.at(-1).variant, briefing);
  h.setStage(200);
  h.npc(VERTIDA_ID);
  assert.equal(
    h.transcripts.at(-1).variant,
    'close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-again-after-being-sent-to-meet-safalaan',
    'the neighbour stage serves its own page'
  );
});

test('the client wire ladder matches the Quest Helper steps around Roald and the sealed message', () => {
  const h = setup();
  const wire = (stage) => h.quest.varbitValue(stage, h.player);

  assert.equal(wire(150), 150, 'the Roald conversation keeps its own step');
  assert.equal(wire(160), 170, 'the teleport sends the client to the Veliaf step');
  assert.equal(wire(170), 180, 'the legacy alias sends the client back to Meiyerditch');
  assert.equal(wire(180), 180);
  assert.equal(wire(290), 290, 'the book leg keeps its own step');
  assert.equal(wire(300), 310, 'the sealed message is the finish-the-quest step');
  assert.equal(wire(310), 320, 'completion stays on the cache floor');

  h.setStage(160);
  assert.equal(h.varbits.get(2573), 170);
  h.setStage(300);
  assert.equal(h.varbits.get(2573), 310);
});

test('the sketch hand-in is mirrored to myq3_sketches_given only once the sketches are given', () => {
  const h = setup();
  h.setStage(250);
  h.login();
  assert.equal(h.varbits.get(2575), 0, 'the sketches are not given yet');
  h.setStage(260);
  h.login();
  assert.equal(h.varbits.get(2575), 1, 'the overlay can drop the completed hand-in step');
});

test('a destroyed ladder top makes the ladder wall searchable again', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.setStage(65); // Fixture start: the hideout ladder shortcut is being repaired.
  h.object(18115, 18066);
  h.action('6j1G8t');
  assert.equal(h.items.get(I.LADDER_TOP), 1);
  assert.equal(h.varbits.get(2598), 1);

  h.items.delete(I.LADDER_TOP);
  h.emit('destroy-item:destroyed', { itemId: I.LADDER_TOP });
  assert.equal(h.varbits.get(2598), 0, 'destroying the top restores the wall-with-ladder transform');

  h.object(18115, 18066);
  h.action('6j1G8t');
  assert.equal(h.items.get(I.LADDER_TOP), 1, 'the canonical destroy-recovery handout works');
});

test('a lost final sketch can be re-sketched and an incomplete hand-in cannot advance', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.setStage(200);
  h.action('H84BAo'); // Fixture: Safalaan's charcoal/papyrus handout and sketch leg.
  h.items.set(I.CASTLE_SKETCH_1, 1);
  h.items.set(I.CASTLE_SKETCH_2, 1);
  h.items.set(I.PAPYRUS, 1);
  h.setStage(250); // Fixture start: all three sketches were done, then sketch 3 was destroyed.

  h.npc(SAFALAAN_ID);
  assert.equal(
    h.transcripts.at(-1).variant,
    'close-encounters-with-vyre-kind-talking-to-safalaan-hallow-after-completing-at-least-one-sketch',
    'Safalaan must not offer the all-three branch without all three'
  );
  h.action('3RdQ7u');
  assert.equal(h.stage(), 250, 'an incomplete hand-in cannot advance');
  assert.equal(h.items.get(I.CASTLE_SKETCH_1), 1);
  assert.equal(h.items.get(I.CASTLE_SKETCH_2), 1);

  h.setLocation(3572, 3331, 0);
  h.itemOnItem(I.CHARCOAL, I.PAPYRUS);
  assert.match(h.transcripts.at(-1).variant, /sketching-the-south-side-after-being-saved-by-sarius-guile/);
  h.action('yFIZpi');
  h.action('IxTC2L');
  assert.equal(h.items.get(I.CASTLE_SKETCH_3), 1, 'the missing sketch is recoverable at stage 250');
  assert.equal(h.stage(), 250);

  h.npc(SAFALAAN_ID);
  assert.equal(
    h.transcripts.at(-1).variant,
    'close-encounters-with-vyre-kind-talking-to-safalaan-hallow-with-all-three-sketches'
  );
  h.action('3RdQ7u');
  assert.equal(h.stage(), 260);
});

test('start skill gates use the cache DB thresholds at Veliaf and the start hook', () => {
  const h = setup();
  const START_HOOK = 'quest:darkness-of-hallowvale:start';
  h.setSkill(h.core.Skill.MINING, 19);

  h.emit('npc-dialogue:hook', { npcId: VELIAF_ID, hook: START_HOOK });
  assert.equal(h.stage(), 0);
  assert.ok(h.messages.some((message) => /20 Mining/.test(message)));

  const transcripts = h.transcripts.length;
  h.npc(VELIAF_ID);
  assert.equal(h.stage(), 0);
  assert.equal(h.transcripts.length, transcripts, 'Veliaf does not start the quest transcript');
  assert.ok(h.messages.filter((message) => /20 Mining/.test(message)).length >= 2);

  h.setSkill(h.core.Skill.MINING, 20);
  h.emit('npc-dialogue:hook', { npcId: VELIAF_ID, hook: START_HOOK });
  assert.equal(h.stage(), 10);
});

test('stage-0 Veliaf transcript selects only the canonical In Aid continuation', () => {
  const h = setup();
  assert.equal(h.answerCondition('5iTY3c'), true, 'the In Aid prerequisite selects the continuation branch');
  assert.equal(h.answerCondition('Ao7Gq6'), false, 'the returning-player branch cannot run as an unknown condition');
  assert.equal(h.answerCondition('5iTY3c', SAFALAAN_ID), null,
    'the condition does not claim an unrelated NPC transcript');
});

test('stage-0 Veliaf yields to In Aid until its completion is public', () => {
  const h = setup();
  h.setInAidComplete(false);
  const yielded = h.npc(VELIAF_ID);
  assert.notEqual(yielded.handled, true, 'Darkness leaves the shared NPC event available to In Aid');
  assert.equal(h.transcripts.length, 0);
  assert.equal(h.stage(), 0);

  h.setInAidComplete(true);
  h.npc(VELIAF_ID);
  assert.equal(h.transcripts.at(-1).variant, 'starting-the-quest-talking-to-veliaf-hurtz');
});

test('Pots can return the door key but do not duplicate one already carried', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.setStage(65);
  h.setFreeSlots(0);
  h.action('YpqCg3');
  assert.equal(h.items.get(I.DOOR_KEY_2) ?? 0, 0);

  h.setFreeSlots(1);
  h.action('YpqCg3');
  assert.equal(h.items.get(I.DOOR_KEY_2), 1);
  h.action('YpqCg3');
  assert.equal(h.items.get(I.DOOR_KEY_2), 1, 'replaying the canonical receipt cannot add a duplicate');
});

test('shortcut door unlock state is sent to the client and restored on login', () => {
  const h = setup();
  h.setStage(65);
  h.items.set(h.core.ItemIdentifiers.DOOR_KEY_2, 1);

  h.action('K30GgU');
  assert.equal(h.varbits.get(2578), 1, 'unlocking the door updates its cache varbit');
  assert.equal(h.items.get(h.core.ItemIdentifiers.DOOR_KEY_2), 0, 'the canonical action consumes the key');

  h.varbits.delete(2578);
  h.login();
  assert.equal(h.varbits.get(2578), 1, 'login reapplies the persisted door state');
});

test('the rune case fills existing rune stacks at zero free slots', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  h.setStage(280); // Fixture start: the laboratory and unsearched rune case are available.
  for (const id of [I.LAW_RUNE, I.FIRE_RUNE, I.AIR_RUNE, I.WATER_RUNE, I.MIND_RUNE]) {
    h.items.set(id, 1);
  }
  h.setFreeSlots(0);
  h.action('xVr0GB');

  assert.equal(h.varbits.get(2584), 1);
  assert.equal(h.items.get(I.LAW_RUNE), 2);
  assert.equal(h.items.get(I.FIRE_RUNE), 4);
  assert.equal(h.items.get(I.AIR_RUNE), 4);
  assert.equal(h.items.get(I.WATER_RUNE), 2);
  assert.equal(h.items.get(I.MIND_RUNE), 2);
});

test('Darkness yields Veliaf only when Taste of Hope will handle the requested rod', () => {
  const h = setup({ tasteOfHope: true });
  h.setStage(10);
  h.tasteQuest.setStage(h.player, 120);

  const query = () => {
    const request = { player: h.player, needsRod: false };
    h.api.emitCustomEvent('taste-of-hope:needs-veliaf-rod', request);
    return request.needsRod;
  };
  assert.equal(query(), false, 'the other quest does not own Veliaf until the rod was requested');
  const before = h.transcripts.length;
  h.npc(VELIAF_ID);
  assert.equal(h.transcripts.at(-1).page, 'Darkness of Hallowvale',
    'Darkness keeps its conversation before the rod request');

  h.choice('I need the Rod of Ivandis.', VERTIDA_ID);
  assert.equal(query(), true, 'Taste publicly reports its exact rod handout window');
  h.npc(VELIAF_ID);
  assert.equal(h.transcripts.length, before + 2);
  assert.equal(h.transcripts.at(-1).page, 'A Taste of Hope');
  assert.equal(h.transcripts.at(-1).variant, 'the-legendary-weapon-talking-to-veliaf');

  h.condition('J8N5DP', VELIAF_ID);
  assert.equal(query(), false, 'the public query stops after the rod is claimed');
  h.items.delete(7639);
  assert.equal(query(), false, 'a claimed rod is not reissued after its loss');
  h.npc(VELIAF_ID);
  assert.equal(h.transcripts.at(-1).page, 'Darkness of Hallowvale',
    'Darkness owns the shared NPC again after the handout');

  h.tasteQuest.setStage(h.player, 135);
  assert.equal(query(), false, 'the public query closes when Taste advances to Ranis');
});

test('Darkness does not add a second owner-only Veliaf after In Aid completion', () => {
  const h = setup();
  h.setStage(10);
  h.login();
  assert.equal(
    h.spawned.some((npc) => npc.getId() === VELIAF_ID),
    false,
    'In Aid leaves its canonical Veliaf at the tile; Darkness reuses it'
  );
});

test('Sarius Guile is a real stage-240 Talk-to, split from the imported south scene', () => {
  const I = h => h.core.ItemIdentifiers;
  const page = require('../data/definitions/npc-dialogues.json')['Darkness of Hallowvale'];
  const index = require('../data/definitions/npc-dialogue-index.json');
  const variant = 'close-encounters-with-vyre-kind-sketching-the-south-side';
  assert.ok(
    (index[SARIUS_ID] ?? []).some(
      (entry) => entry.page === 'Transcript:Darkness of Hallowvale' && entry.variants.includes(variant)
    ),
    'the cache NPC 3776 Talk-to is indexed to the imported Darkness south-scene variant'
  );

  const h = setup();
  const items = I(h);
  h.setStage(200);
  h.action('H84BAo'); // Fixture: Safalaan supplies and the sketch leg.
  h.items.set(items.CASTLE_SKETCH_1, 1);
  h.items.set(items.CASTLE_SKETCH_2, 1);
  h.items.set(items.PAPYRUS, 1);
  h.setStage(210); // Fixture start: the first southern sketch is about to be drawn.
  h.setLocation(3572, 3331, 0);

  h.itemOnItem(items.CHARCOAL, items.PAPYRUS);
  const scene = h.transcripts.at(-1);
  assert.equal(scene.variant, variant);
  assert.equal(typeof scene.select, 'function', 'the scene uses an imported-step selector');
  const sceneSteps = scene.select(page.variants[variant]);
  assert.ok(sceneSteps.some((step) => step.id === 'aCPM8x'), 'the scene keeps Vanstrom departing');
  assert.ok(!sceneSteps.some((step) => /^Awaken!/.test(step.text ?? '')), 'the wake-up hint is not folded into the scene');

  h.action('T3YqyD');
  assert.equal(h.stage(), 220);
  h.action('aCPM8x');
  assert.equal(h.stage(), 240);
  assert.ok(
    h.spawned.some((npc) => npc.getId() === SARIUS_ID),
    'stage 240 spawns the source NPC at 3572,3331'
  );

  // Finish-first order: sketch 3 is held but completion waits for the separate Sarius talk.
  h.action('yFIZpi');
  h.action('IxTC2L');
  assert.equal(h.items.get(items.CASTLE_SKETCH_3), 1);
  assert.equal(h.stage(), 240, 'the final sketch alone cannot skip Sarius');

  h.npc(SARIUS_ID);
  const talk = h.transcripts.at(-1);
  assert.equal(talk.variant, variant);
  assert.equal(typeof talk.select, 'function');
  const talkSteps = talk.select(page.variants[variant]);
  assert.equal(talkSteps[0]?.type, 'line');
  assert.equal(talkSteps[0]?.speaker, 'Sarius Guile');
  assert.match(talkSteps[0]?.text ?? '', /^Awaken!/);
  assert.ok(!talkSteps.some((step) => step.id === 'L482aT'), 'the Talk-to does not replay Vanstrom appearing');
  assert.ok(talkSteps.some((step) => step.id === 'p6b9Lc'), 'the imported Sarius departure remains');
  assert.equal(h.stage(), 250, 'talking to Sarius completes the all-three sketch leg');
  assert.ok(h.removed.some((npc) => npc.getId() === SARIUS_ID), 'Sarius is released after stage 250');
});
