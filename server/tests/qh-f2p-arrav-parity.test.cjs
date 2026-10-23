// Run after yarn build: node --test tests/qh-f2p-arrav-parity.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
});
let actorIndex = 1;
let worldNpcs = [];
function register() {
  const hooks = new Map(), custom = new Map(), namedNpc = new Map(), buttons = new Map();
  const spawned = [], removed = [], ground = [], prompts = [], areas = [], tasks = [];
  const api = new Proxy({
    core: { ...core, TaskManager: {
      submit: (task) => { task.setRunning(true); tasks.push(task); },
      cancelTasks: (key) => tasks.filter((task) => task.key === key).forEach((task) => task.stop()),
    } }, persistAttribute() {}, registerArea: (area) => areas.push(area),
    onCustomEvent: (event, fn) => { if (!custom.has(event)) custom.set(event, []); custom.get(event).push(fn); },
    emitCustomEvent: (event, payload) => { for (const fn of custom.get(event) || []) fn(payload); },
    onInterfaceActionButton: (ids, fn) => { for (const id of [].concat(ids)) buttons.set(id, fn); },
    onNpcInteraction: (nameOrFn, actions) => {
      if (typeof nameOrFn === 'function') hooks.set('onNpcInteraction', [nameOrFn]);
      else for (const [action, fn] of Object.entries(actions)) namedNpc.set(`${nameOrFn}:${action}`, fn);
    },
    getItemOnGroundManager: () => ({
      registerLocation: (owner, item, location) => { ground.push({ owner, item, location }); }, getGroundItem: () => null,
    }),
    getWorld: () => ({ getNpcs: () => worldNpcs }),
    sendMultiChatboxPrompt: (player, title, ...options) => prompts.push({ player, title, options }),
  }, { get(target, prop) {
    if (prop in target) return target[prop];
    return (...args) => {
      const fn = args.findLast((arg) => typeof arg === 'function')
        || Object.values(args.at(-1) || {}).find((value) => typeof value === 'function');
      if (fn) { if (!hooks.has(prop)) hooks.set(prop, []); hooks.get(prop).push(fn); }
    };
  } });
  require('../plugins/quests/quests/ShieldOfArrav.Quest')(api);
  if (!custom.has('quest:get-stage')) custom.set('quest:get-stage', []);
  custom.get('quest:get-stage').push((request) => {
    const value = request.player?.getAttribute?.(`quest.${request.key}.stage`);
    request.stage = value === undefined || value === null ? null : Number(value);
  });
  return { api, hooks, buttons, namedNpc, spawned, removed, ground, prompts, areas,
    quest: getRegisteredQuests().findLast((quest) => quest.key === 'shield_of_arrav'),
    emit: (event, payload) => api.emitCustomEvent(event, payload),
    call: (event, payload) => { for (const fn of hooks.get(event) || []) fn(payload); },
    tick: (count) => { while (count-- > 0) [...tasks].forEach((task) => task.tick()); },
  };
}
function player() {
  const attributes = new Map(), items = new Map(), bank = new Map(), packets = [], messages = [];
  let location = new core.Location(3228, 3369, 0);
  const index = actorIndex++;
  const inventory = {
    getAmount: (id) => items.get(id) || 0,
    adds: (id, amount) => items.set(id, (items.get(id) || 0) + amount),
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) || 0) - amount)),
    getFreeSlots: () => 28 - [...items].reduce((sum, [id, amount]) => sum + (id === 995 ? Number(amount > 0) : amount), 0),
    isFull: () => inventory.getFreeSlots() <= 0,
  };
  let packet;
  packet = new Proxy({}, { get: (_, method) => (...args) => { packets.push([method, ...args]); return packet; } });
  const p = { attributes, items, bank, packets, messages,
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory, getBanks: () => [{ getAmount: (id) => bank.get(id) || 0 }],
    getLocation: () => location, getUsername: () => 'QuestTester', getPacketSender: () => packet,
    getSkillManager: () => ({ getCombatLevel: () => 20, addExperiences() {} }),
    sendMessage: (message) => messages.push(message), isPlayer: () => true, isNpc: () => false,
    getAsPlayer: () => p, getIndex: () => index,
    moveTo: (value) => { location = value; },
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() {}, addSteps: (value) => { location = value; } }),
  };
  return p;
}
const sentVarbit = (p, id) => p.packets.filter(([method, packetId]) => method === 'sendVarbit' && packetId === id).map(([, , value]) => value);
const lastVarbit = (p, id) => sentVarbit(p, id).at(-1);
const variantFor = (q, p, npcId) => q.hooks.get('onNpcDialogueVariant')[0]({ player: p, npcId });
const condition = (q, p, npcId, text) => q.hooks.get('onNpcDialogueCondition')[0]({ player: p, npcId, text, pages: [{ page: 'Shield of Arrav' }] });
const interact = (q, p, objectId, action = 'Open') => q.call('onObjectInteraction', {
  player: p, objectId, clickType: 1, definition: { getInteractions: () => [action] },
});

test('Reldo dispatches both half-of-shield transcript branches', () => {
  const q = register(), reldo = core.NpcIdentifiers.RELDO;
  const phoenix = player(); phoenix.attributes.set('shield-of-arrav.gang', 1); q.quest.setStage(phoenix, 4); phoenix.items.set(763, 1);
  assert.equal(variantFor(q, phoenix, reldo).variant, 'phoenix-gang-talking-to-reldo-with-half-of-the-shield');
  const blackArm = player(); blackArm.attributes.set('shield-of-arrav.gang', 2); q.quest.setStage(blackArm, 4); blackArm.items.set(765, 1);
  assert.equal(variantFor(q, blackArm, reldo).variant, 'black-arm-gang-talking-to-reldo-with-half-of-the-shield');
  q.quest.setStage(blackArm, 7);
  assert.equal(variantFor(q, blackArm, reldo), null);
});

test('Charlie first-ask and payment conditions do not leak the location after five coins', () => {
  const q = register(), charlie = core.NpcIdentifiers.CHARLIE_THE_TRAMP;
  const p = player(); q.quest.setStage(p, 2); p.attributes.set('shield-of-arrav:reldo-directions', true);
  assert.equal(q.hooks.get('onNpcDialogueCondition')[0]({
    player: p, npcId: charlie, text: 'If asking for the first time:', pages: [{ page: 'Charlie the Tramp' }],
  }), null, 'conditions on other Charlie pages defer to their owner');
  assert.equal(variantFor(q, p, charlie).variant, 'black-arm-gang-talking-to-charlie-the-tramp');
  assert.equal(condition(q, p, charlie, 'If asking for the first time:'), true);
  variantFor(q, p, charlie);
  assert.equal(condition(q, p, charlie, 'If asking for the first time:'), false);
  assert.equal(condition(q, p, charlie, 'Otherwise:'), true);
  assert.equal(lastVarbit(p, 11510), 1);

  const paid = player(); q.quest.setStage(paid, 3); paid.attributes.set('shield-of-arrav:black-arm-task', true); paid.items.set(995, 10);
  q.emit('npc-dialogue:action', { player: paid, npcId: charlie, stepId: '24Nlqb' });
  assert.equal(paid.items.get(995), 5);
  assert.equal(condition(q, paid, charlie, "If you haven't yet paid Charlie for the information:"), true);
  assert.equal(condition(q, paid, charlie, 'Asking again after already paying Charlie for the information:'), false);
  assert.equal(lastVarbit(paid, 11511), 0);
  q.emit('npc-dialogue:action', { player: paid, npcId: charlie, stepId: 'Fo_zeD' });
  assert.equal(paid.items.get(995), 0);
  assert.equal(condition(q, paid, charlie, "If you haven't yet paid Charlie for the information:"), false);
  assert.equal(condition(q, paid, charlie, 'Asking again after already paying Charlie for the information:'), true);
  assert.equal(lastVarbit(paid, 11511), 1);
});

test('quest start and completion mirror the current-cache quest-state varbit', () => {
  const q = register(), p = player();
  q.emit('npc-dialogue:hook', { player: p, hook: 'quest:shield-of-arrav:start' });
  assert.equal(q.quest.getStage(p), 1); assert.equal(lastVarbit(p, 13716), 1);
  q.quest.setStage(p, 6); p.items.set(769, 1);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.KING_ROALD_3, stepId: '25_j1f' });
  assert.equal(q.quest.getStage(p), 7); assert.equal(lastVarbit(p, 13716), 2);
  assert.equal(p.items.get(995), 600);
});

test('gang doors use the transcript lock messages', () => {
  const q = register(), p = player();
  q.emit('door:toggle', { player: p, objectId: core.ObjectIdentifiers.DOOR_71, object: null, handled: false });
  assert.ok(p.messages.includes('This door seems to be locked from the inside.'));
  p.attributes.set('shield-of-arrav.gang', 1); q.quest.setStage(p, 4);
  q.emit('door:toggle', { player: p, objectId: core.ObjectIdentifiers.DOOR_71, object: null, handled: false });
  assert.ok(p.messages.includes('The door is securely locked.'));
  q.emit('door:toggle', { player: p, objectId: core.ObjectIdentifiers.DOOR_69, object: null, handled: false });
  assert.ok(p.messages.includes('The door is securely locked.'));
});

test('shield caches use the chest or cupboard transcript messages', () => {
  const q = register();
  const phoenix = player(); phoenix.attributes.set('shield-of-arrav.gang', 1); q.quest.setStage(phoenix, 4);
  interact(q, phoenix, core.ObjectIdentifiers.CHEST_11);
  assert.ok(phoenix.messages.includes('You search the chest.'));
  assert.ok(phoenix.messages.includes('You open the chest and find half of a shield inside.'));
  assert.equal(phoenix.items.get(763), 1);
  interact(q, phoenix, core.ObjectIdentifiers.CHEST_12);
  assert.ok(phoenix.messages.includes("You open the chest, but don't find anything of interest inside."));

  const blackArm = player(); blackArm.attributes.set('shield-of-arrav.gang', 2); q.quest.setStage(blackArm, 4);
  interact(q, blackArm, core.ObjectIdentifiers.CUPBOARD_12);
  assert.ok(blackArm.messages.includes('You open the cupboard and find half of a shield inside.'));
  assert.equal(blackArm.items.get(765), 1);
  interact(q, blackArm, core.ObjectIdentifiers.CUPBOARD_13);
  assert.ok(blackArm.messages.includes("You open the cupboard, but don't find anything of interest inside."));
});

test('crossbow pickup protection uses the weaponsmaster transcript lines', () => {
  const q = register(), p = player();
  const chat = [], attacks = [];
  worldNpcs = [{ getId: () => core.NpcIdentifiers.WEAPONSMASTER, getHitpoints: () => 30, isDyingFunction: () => false,
    forceChat: (text) => chat.push(text), getCombat: () => ({ attack: (target) => attacks.push(target) }) }];
  const event = () => ({ player: p, handled: false,
    groundItem: { getItem: () => ({ getId: () => core.ItemIdentifiers.PHOENIX_CROSSBOW }),
      getPosition: () => ({ getZ: () => 1, getX: () => 3245, getY: () => 3385 }) } });
  p.attributes.set('shield-of-arrav.gang', 1); q.quest.setStage(p, 4);
  const phoenix = event(); q.call('onGroundItemPickup', phoenix);
  assert.equal(phoenix.handled, true); assert.deepEqual(chat, ["Hey! That's Straven's! He won't like you messing with that!"]); assert.equal(attacks.length, 0);
  chat.length = 0; p.attributes.set('shield-of-arrav.gang', 2);
  const blackArm = event(); q.call('onGroundItemPickup', blackArm);
  assert.equal(blackArm.handled, true); assert.deepEqual(chat, ['Stop! Thief!']); assert.deepEqual(attacks, [p]);
});

test('the weaponsmaster transcript action starts combat for non-Phoenix players', () => {
  const q = register(), p = player();
  const attacks = [];
  const npc = { getCombat: () => ({ attack: (target) => attacks.push(target) }) };
  const event = { player: p, npcId: core.NpcIdentifiers.WEAPONSMASTER, npc, stepId: '12WBZW', handled: false };
  q.emit('npc-dialogue:action', event);
  assert.equal(event.handled, true); assert.deepEqual(attacks, [p]);
  p.attributes.set('shield-of-arrav.gang', 1); q.quest.setStage(p, 4);
  const phoenix = { player: p, npcId: core.NpcIdentifiers.WEAPONSMASTER, npc, stepId: '12WBZW', handled: false };
  q.emit('npc-dialogue:action', phoenix);
  assert.deepEqual(attacks, [p]);
});

test('12WBZW reaches the quest handler through real NpcDialogues with event.npc', () => {
  const q = register(), p = player();
  const attacks = [];
  const npc = { getId: () => core.NpcIdentifiers.WEAPONSMASTER, getCombat: () => ({ attack: (target) => attacks.push(target) }) };
  let chain;
  p.getDialogueManager = () => ({ startDialogues: (builder) => { chain = builder; }, reset() {}, isActive: () => false, getCurrent: () => null });
  const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
  startDialogue(q.api, {
    player: p, npc, npcId: npc.getId(), definition: core.NpcDefinition.forId(npc.getId()),
  }, [{ type: 'action', id: '12WBZW', text: 'The Weaponsmaster starts attacking the player.' }], {},
  { pages: [{ page: 'Shield of Arrav' }] });
  for (const dialogue of chain.getDialogues().values()) dialogue.send(p);
  assert.deepEqual(attacks, [p]);
});

function realDispatchPlayer(shieldStage, ds2Stage, heroesStage, extra = {}) {
  const attributes = new Map([['quest.shield_of_arrav.stage', shieldStage]]);
  if (ds2Stage !== undefined) attributes.set('quest.dragon_slayer_ii.stage', ds2Stage);
  if (heroesStage !== undefined) attributes.set('quest.heroes_quest.stage', heroesStage);
  if (extra.tailStage !== undefined) attributes.set('quest.a_tail_of_two_cats.stage', extra.tailStage);
  if (extra.golemStage !== undefined) attributes.set('quest.the_golem.stage', extra.golemStage);
  if (extra.golemRetrieved !== undefined) attributes.set('quest.the_golem.retrieved_statuette', extra.golemRetrieved);
  if (extra.gang !== undefined) attributes.set('shield-of-arrav.gang', extra.gang);
  const items = extra.items ?? new Map();
  const state = { texts: [], packets: [], chain: null, sends: 0 };
  let packet;
  packet = new Proxy({}, { get: (_, method) => (...args) => { state.packets.push([method, ...args]); return packet; } });
  const inventory = {
    getAmount: (id) => items.get(id) || 0,
    adds: (id, amount) => items.set(id, (items.get(id) || 0) + amount),
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) || 0) - amount)),
    contains: (id) => (items.get(id) || 0) > 0,
    isFull: () => false, getFreeSlots: () => 28,
    getItems: () => [], getValidItems: () => [],
  };
  const p = {
    attributes, items,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null, getAmount: () => 0, getItems: () => [] }),
    getBanks: () => [],
    getSkillManager: () => ({ getCombatLevel: () => 20, getExperience: () => 0, getCurrentLevel: () => 1,
      getMaxLevel: () => 1, addExperience() {}, addExperiences() {} }),
    getPacketSender: () => packet,
    getDialogueManager: () => ({
      startDialogues(builder) {
        const queue = [builder];
        while (queue.length) {
          const chain = queue.shift();
          state.chain = chain;
          for (const dialogue of [...chain.getDialogues().values()]) {
            if (typeof dialogue.getText === 'function') state.texts.push(dialogue.getText());
            if (typeof dialogue.getOptions === 'function') state.texts.push(dialogue.getOptions().join(' | '));
            if (dialogue.constructor.name === 'ActionDialogue') {
              if (++state.sends > 200) throw new Error('dialogue chain runaway');
              dialogue.send(p);
            }
          }
        }
      },
      reset() {}, isActive: () => false, getCurrent: () => null, advance() {},
    }),
    getFrameUpdater: () => ({ clear() {} }),
    getUsername: () => 'RealDispatch', getLocation: () => new core.Location(3209, 3495, 0),
    getIndex: () => 101, isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p,
    getPrivateArea: () => null, getArea: () => null, moveTo() {}, sendMessage() {},
  };
  return { player: p, texts: () => state.texts, packets: () => state.packets, chain: () => state.chain };
}

function dispatchNpc(player, npcId) {
  const definition = core.NpcDefinition.forId(npcId);
  const npc = { getId: () => npcId, getCurrentDefinition: () => definition,
    getLocation: () => new core.Location(3209, 3495, 0), getIndex: () => 101 };
  const event = { player, npc, npcId, clickType: 1, handled: false };
  return { handled: PluginManager.emitNpcInteraction(event), event };
}

function dispatchReldo(player) {
  return dispatchNpc(player, core.NpcIdentifiers.RELDO);
}

function ensureRealPlugins() {
  if (global.__arravRealPlugins) return;
  // Quest files export their register(api) function; Quests.plugin uses this same API.
  require('../plugins/quests/quests/DragonSlayerII.Quest')(PluginManager.createApi('DragonSlayerII'));
  // Production order: Heroes registers before Shield of Arrav.
  require('../plugins/quests/quests/HeroesQuest.Quest')(PluginManager.createApi('HeroesQuest'));
  require('../plugins/quests/quests/ShieldOfArrav.Quest')(PluginManager.createApi('ShieldOfArrav'));
  // Production QUESTS order after Shield: TailOfTwoCats, then TheGolem.
  require('../plugins/quests/quests/TailOfTwoCats.Quest')(PluginManager.createApi('TailOfTwoCats'));
  require('../plugins/quests/quests/TheGolem.Quest')(PluginManager.createApi('TheGolem'));
  // Test fixture for the runtime owner's quest:get-stage query, using the actual registry.
  const queryFixture = PluginManager.createApi('ArravAuditQueryFixture');
  queryFixture.onCustomEvent('quest:get-stage', (request) => {
    const target = getRegisteredQuests().find((entry) => entry.key === request.key);
    request.stage = target ? target.getStage(request.player) : null;
  });
  PluginManager.registerPluginCandidate({
    pluginPath: 'NpcDialogues.plugin.js', pluginName: 'NpcDialogues',
    plugin: require('../plugins/npcs/NpcDialogues.plugin'), dependsOn: [],
  });
  global.__arravRealPlugins = true;
}

function dispatchText(dispatch) {
  const menuOptions = dispatch.packets()
    .filter(([method, script, , options]) => method === 'sendClientScript' && script === 58 && typeof options === 'string')
    .map(([, , , options]) => options.split('|').join(' | '));
  return [...dispatch.texts(), ...menuOptions].join('\n');
}

test('real PluginManager named dispatch defers inactive DS2 Reldo and keeps active DS2', () => {
  ensureRealPlugins();

  const inactive = realDispatchPlayer(0, 0);
  assert.equal(dispatchReldo(inactive.player).handled, true);
  const inactiveText = dispatchText(inactive);
  assert.match(inactiveText, /Hello, stranger\./, 'inactive DS2 must defer to the Shield start transcript');
  assert.doesNotMatch(inactiveText, /Ask about Tristan\./);

  const active = realDispatchPlayer(0, 8);
  assert.equal(dispatchReldo(active.player).handled, true);
  const activeText = dispatchText(active);
  assert.match(activeText, /Ask about Tristan\./, 'active DS2 key chapter must still own Reldo');
  assert.doesNotMatch(activeText, /Hello, stranger\./);

  for (const [label, ds2Stage] of [['completed', 14], ['unrelated forge chapter', 9]]) {
    const deferred = realDispatchPlayer(0, ds2Stage);
    assert.equal(dispatchReldo(deferred.player).handled, true, `${label} DS2 must defer`);
    const text = dispatchText(deferred);
    assert.match(text, /Hello, stranger\./, `${label} DS2 must let Shield handle Reldo`);
    assert.doesNotMatch(text, /Ask about Tristan\./);
  }
});

test('shared gang NPCs keep Shield introductions before the book and preserve active Heroes', () => {
  ensureRealPlugins();
  const KATRINE = core.NpcIdentifiers.KATRINE;
  const STRAVEN = core.NpcIdentifiers.STRAVEN;

  for (const [stage, hasBook] of [[0, false], [1, false], [1, true], [2, false], [3, false]]) {
    for (const [npcId, name] of [[KATRINE, 'Katrine'], [STRAVEN, 'Straven']]) {
      const h = realDispatchPlayer(stage);
      if (hasBook) h.player.items.set(core.ItemIdentifiers.BOOK, 1);
      const dispatch = dispatchNpc(h.player, npcId);
      assert.equal(dispatch.handled, true, `${name} at Shield stage ${stage} must start a dialogue`);
      const text = dispatchText(h);
      assert.doesNotMatch(text, /Welcome to the Heroes' Guild/,
        `${name} at Shield stage ${stage} must not fall back to Achietties`);
      if (npcId === KATRINE) {
        assert.match(text, /It's a private business\. Can I help you at all\?/);
        assert.match(text, /I've heard you're the Black Arm Gang\./);
      } else {
        assert.match(text, /What's through that door\?/);
        assert.match(text, /I know who you are!/);
      }
      assert.equal(h.player.attributes.get('quest.shield_of_arrav.stage'), stage,
        `${name} must not silently advance the Shield stage`);
    }
  }

  // The early acceptance choice must not claim the task while READ_BOOK still guards it.
  const earlyKatrine = realDispatchPlayer(1);
  dispatchNpc(earlyKatrine.player, KATRINE);
  PluginManager.emitCustomEvent('npc-dialogue:choice', {
    player: earlyKatrine.player, npcId: KATRINE, option: 'Okay, no problem.',
  });
  assert.equal(earlyKatrine.player.attributes.get('quest.shield_of_arrav.stage'), 1);
  assert.equal(earlyKatrine.player.attributes.get('shield-of-arrav:black-arm-task'), undefined);

  const earlyStraven = realDispatchPlayer(1);
  dispatchNpc(earlyStraven.player, STRAVEN);
  PluginManager.emitCustomEvent('npc-dialogue:choice', {
    player: earlyStraven.player, npcId: STRAVEN, option: "I'd like to offer you my services.",
  });
  assert.equal(earlyStraven.player.attributes.get('quest.shield_of_arrav.stage'), 1);
  assert.equal(earlyStraven.player.attributes.get('shield-of-arrav:phoenix-task'), undefined);

  // Production order: Heroes' Quest answers first for its active stages.
  for (const [npcId, expected, forbidden] of [
    [STRAVEN, /Took me YEARS to get that rank\./, /What's through that door\?/],
    [KATRINE, /Is there any way I can get the rank of master thief\?/, /It's a private business\./],
  ]) {
    const h = realDispatchPlayer(1, undefined, 1);
    const dispatch = dispatchNpc(h.player, npcId);
    assert.equal(dispatch.handled, true);
    const text = dispatchText(h);
    assert.match(text, expected, 'active Heroes variant must win');
    assert.doesNotMatch(text, forbidden, 'Shield must not hijack active Heroes');
    assert.doesNotMatch(text, /Welcome to the Heroes' Guild/);
    assert.equal(h.player.attributes.get('quest.shield_of_arrav.stage'), 1, 'Shield stage unchanged');
    assert.equal(h.player.attributes.get('quest.heroes_quest.stage'), 1, 'Heroes stage unchanged');
    assert.equal(h.player.attributes.get('shield-of-arrav:black-arm-task'), undefined);
    assert.equal(h.player.attributes.get('shield-of-arrav:phoenix-task'), undefined);
  }
});

test('Shield defers Reldo to active A Tail of Two Cats and Curator to active The Golem', () => {
  ensureRealPlugins();

  for (const [tailStage, expected] of [
    [4, /I have a cat related question\./],
    [5, /So, about Robert the Strong\.\.\./],
  ]) {
    const h = realDispatchPlayer(0, undefined, undefined, { tailStage });
    assert.equal(dispatchReldo(h.player).handled, true);
    const text = dispatchText(h);
    assert.match(text, expected, 'active Tail of Two Cats must own Reldo');
    assert.doesNotMatch(text, /I'm in search of a quest\./, 'Shield must not hijack active Tail');
    assert.equal(h.player.attributes.get('quest.shield_of_arrav.stage'), 0, 'Shield stage unchanged');
    assert.equal(h.player.attributes.get('quest.a_tail_of_two_cats.stage'), tailStage, 'Tail stage unchanged');
  }

  const noTail = realDispatchPlayer(0);
  assert.equal(dispatchReldo(noTail.player).handled, true);
  assert.match(dispatchText(noTail), /I'm in search of a quest\./, 'inactive Tail still lets Shield start');

  for (const { golemStage, retrieved } of [
    { golemStage: 1, retrieved: false },
    { golemStage: 2, retrieved: false },
    { golemStage: 3, retrieved: true },
  ]) {
    const h = realDispatchPlayer(4, undefined, undefined, {
      gang: 1, golemStage, golemRetrieved: retrieved, items: new Map([[763, 1]]),
    });
    assert.equal(dispatchNpc(h.player, core.NpcIdentifiers.CURATOR_HAIG_HALEN).handled, true);
    const text = dispatchText(h);
    assert.match(text, /I'm looking for a statuette recovered from the city of Uzer\./,
      'The Golem must own the Curator conversation in stages 1..3');
    assert.doesNotMatch(text, /I'm here about the Shield of Arrav\./, 'Shield must not hijack active Golem');
    assert.equal(h.player.attributes.get('quest.shield_of_arrav.stage'), 4, 'Shield hand-in must not run');
    assert.equal(h.player.items.get(763), 1, 'Shield half must not be consumed');
    assert.equal(h.player.attributes.get('quest.the_golem.stage'), golemStage, 'Golem stage unchanged');
  }

  for (const golemStage of [4, 10]) {
    const h = realDispatchPlayer(4, undefined, undefined, {
      gang: 1, golemStage, golemRetrieved: true, items: new Map([[763, 1]]),
    });
    assert.equal(dispatchNpc(h.player, core.NpcIdentifiers.CURATOR_HAIG_HALEN).handled, true);
    const text = dispatchText(h);
    assert.match(text, /I'm here about the Shield of Arrav\./,
      'Shield hand-in must resume after the statuette is placed or The Golem is complete');
    assert.doesNotMatch(text, /statuette recovered from the city of Uzer/, 'Golem must no longer own the Curator');
    assert.equal(h.player.attributes.get('quest.shield_of_arrav.stage'), 6, 'Shield hand-in must run');
    assert.equal(h.player.items.get(763) || 0, 0, 'Shield half must be consumed by the hand-in');
  }

  const noGolem = realDispatchPlayer(4, undefined, undefined, { gang: 1, items: new Map([[763, 1]]) });
  assert.equal(dispatchNpc(noGolem.player, core.NpcIdentifiers.CURATOR_HAIG_HALEN).handled, true);
  const controlText = dispatchText(noGolem);
  assert.match(controlText, /I'm here about the Shield of Arrav\./, 'Shield hand-in still runs when Golem is inactive');
  assert.doesNotMatch(controlText, /statuette recovered from the city of Uzer/);
});
