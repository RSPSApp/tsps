// Temple of the Eye production dispatch regression.
// From server/: node --test tests/temple-of-the-eye-named-dispatch.test.cjs (after yarn build).
//
// This does not call the plugin's variant helper directly. It registers the real
// plugin through PluginManager.createApi(), registers NpcDialogues on the same
// production dispatch path, and sends a Talk-to interaction for Felix as the
// third tower apprentice. The named handler must own the interaction; otherwise
// NpcDialogues selects the stage-80 repeat variant and Felix's card never opens.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const core = PluginManager.getCoreApi();
const Runtime = require('../plugins/quests/QuestRuntime');

const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;
const TOWER_SEEN_ATTRIBUTE = 'quest.temple_of_the_eye.tower-apprentices';

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function inventoryFixture() {
  const items = new Map();
  return {
    items,
    getAmount: id => items.get(id) ?? 0,
    isFull: () => false,
    getFreeSlots: () => 28 - items.size,
    contains: id => (items.get(id) ?? 0) > 0,
    adds(id, amount = 1) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount = 1) {
      const left = Math.max(0, (items.get(id) ?? 0) - amount);
      if (left === 0) items.delete(id); else items.set(id, left);
    },
  };
}

function playerFixture() {
  const attributes = new Map();
  const messages = [];
  const log = [];
  const inventory = inventoryFixture();
  let location = new core.Location(3111, 3163, 1);
  let packet;
  packet = new Proxy({
    sendConfig() { return packet; },
    sendVarbit() { return packet; },
    sendInterface(id) { log.push(['sendInterface', id]); return packet; },
    sendString(text, uid) { log.push(['sendString', uid, text]); return packet; },
    sendInterfaceRemoval() { player.getDialogueManager().reset(); return packet; },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => { log.push([String(key), ...args]); return packet; };
    },
  });
  const player = {
    inventory,
    messages,
    log,
    getUsername: () => 'tote-dispatch', getDisplayName: () => 'tote-dispatch',
    getAttribute: key => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getSkillManager: () => ({
      getCombatLevel: () => 99,
      getMaxLevel: () => 99,
      getCurrentLevel: () => 99,
      addExperiences() {},
      addExperience() {},
    }),
    getLocation: () => location,
    moveTo: to => { location = to; },
    getDialogueManager: () => player.manager,
    getInterfaceId: () => -1,
    getPacketSender: () => packet,
    getAppearance: () => ({ isMale: () => true }),
    isRegistered: () => true,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    getIndex: () => 1,
    getArea: () => null,
    getPrivateArea: () => null,
    sendMessage: message => messages.push(message),
    setPositionToFace() {},
    performAnimation() {},
  };
  player.manager = new DialogueManager(player);
  return player;
}

function npcEvent(player, name, npcId, action = 'Talk-to') {
  return {
    player,
    npc: {},
    npcId,
    definition: {
      getId: () => npcId,
      getName: () => name,
      getActions: () => [action, null, null, null, null],
    },
    clickType: 1,
    handled: false,
  };
}

function registerProductionPlugins({ nativeNpcs = false } = {}) {
  const beforeLengths = {
    interaction: PluginManager.npcInteractionHooks.length,
    any: PluginManager.npcAnyInteractionHooks.length,
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    itemAction: PluginManager.itemActionHooks.length,
    itemOnNpc: PluginManager.itemOnNpcHooks.length,
    itemOnObject: PluginManager.itemOnObjectHooks.length,
    objectInteraction: PluginManager.objectInteractionHooks.length,
    npcDeath: PluginManager.npcDeathHooks.length,
    login: PluginManager.loginHooks.length,
    logout: PluginManager.logoutHooks.length,
    interfaceAction: PluginManager.interfaceActionClickHooks.length,
  };
  const customBefore = new Map([...PluginManager.customEventHooks].map(([name, hooks]) => [name, hooks.length]));

  const templeApi = PluginManager.createApi('TempleOfTheEyeDispatchTest');
  const spawned = [];
  const spawnNpc = templeApi.spawnNpc;
  templeApi.spawnNpc = definition => {
    if (nativeNpcs) {
      const npc = spawnNpc(definition);
      if (npc) spawned.push(npc);
      return npc;
    }
    const npc = {
      definition,
      getId: () => definition.id,
      isRegistered: () => true,
      isVisible: () => true,
      isOwnerOnly: () => true,
      getOwner: () => definition.owner,
      getPrivateArea: () => null,
      getLocation: () => new core.Location(definition.x, definition.y, definition.z),
    };
    spawned.push(npc);
    return npc;
  };
  if (!nativeNpcs) templeApi.removeNpc = () => {};
  require('../plugins/quests/quests/TempleOfTheEye.Quest')(templeApi);

  const dialogueApi = PluginManager.createApi('NpcDialoguesDispatchTest');
  require('../plugins/npcs/NpcDialogues.plugin.js').register(dialogueApi);

  const quest = Runtime.getRegisteredQuests().findLast(entry => entry.key === 'temple_of_the_eye');
  return {
    quest,
    spawned,
    cleanup() {
      if (nativeNpcs) spawned.forEach(npc => PluginManager.removeNpc(npc));
      PluginManager.npcInteractionHooks.length = beforeLengths.interaction;
      PluginManager.npcAnyInteractionHooks.length = beforeLengths.any;
      PluginManager.npcDialogueVariantHooks.length = beforeLengths.variant;
      PluginManager.npcDialogueConditionHooks.length = beforeLengths.condition;
      PluginManager.itemActionHooks.length = beforeLengths.itemAction;
      PluginManager.itemOnNpcHooks.length = beforeLengths.itemOnNpc;
      PluginManager.itemOnObjectHooks.length = beforeLengths.itemOnObject;
      PluginManager.objectInteractionHooks.length = beforeLengths.objectInteraction;
      PluginManager.npcDeathHooks.length = beforeLengths.npcDeath;
      PluginManager.loginHooks.length = beforeLengths.login;
      PluginManager.logoutHooks.length = beforeLengths.logout;
      PluginManager.interfaceActionClickHooks.length = beforeLengths.interfaceAction;
      for (const [name, hooks] of [...PluginManager.customEventHooks]) {
        const kept = hooks.filter(hook => hook.pluginName !== 'TempleOfTheEyeDispatchTest'
          && hook.pluginName !== 'NpcDialoguesDispatchTest');
        const oldLength = customBefore.get(name) ?? 0;
        if (kept.length > oldLength) kept.splice(oldLength);
        if (kept.length) PluginManager.customEventHooks.set(name, kept);
        else PluginManager.customEventHooks.delete(name);
      }
    },
  };
}

function advanceAll(player, limit = 200) {
  const lines = [];
  while (player.manager.getCurrent() && limit-- > 0) {
    const current = player.manager.getCurrent();
    lines.push(current.getText?.() ?? '');
    player.manager.advance();
    core.TaskManager.process();
  }
  assert.ok(limit > 0, 'dialogue did not finish');
  return lines;
}

test('Felix the third tower apprentice keeps his named conversation and opens his riddle card', () => {
  const { quest, cleanup } = registerProductionPlugins();
  try {
    assert.ok(quest, 'Temple of the Eye registered');
    const player = playerFixture();
    quest.setStage(player, 75);
    player.setAttribute(TOWER_SEEN_ATTRIBUTE, 5); // Cordelia (1) and Tamara (4) done.

    const event = npcEvent(player, 'Apprentice Felix', N.APPRENTICE_FELIX_2);
    const handled = PluginManager.emitNpcInteraction(event);

    assert.equal(handled, true, 'the named Talk-to owns the interaction');
    assert.equal(event.handled, true);
    assert.equal(quest.getStage(player), 80, 'Felix is the third riddle');
    assert.equal(player.getAttribute(TOWER_SEEN_ATTRIBUTE) & 7, 7);

    const first = player.manager.getCurrent();
    assert.ok(first, 'the named handler started a conversation');
    assert.match(first.getText(), /^So, if that's six and this is eight/);
    assert.doesNotMatch(first.getText(), /Could I see that puzzle again\?/);

    const lines = advanceAll(player);
    assert.ok(lines.includes("Okay, I'll show you the puzzle."),
      `Felix's first riddle transcript ran: ${JSON.stringify(lines)}`);
    assert.ok(!lines.includes('Could I see that puzzle again?'),
      'the generic fallback did not replace the first-time conversation');
    assert.ok(lines.some(line => line.length > 0), 'dialogue had lines');
    assert.ok(player.log.some(([name, id]) => name === 'sendInterface' && id === 291),
      'Felix riddle interface 291 opened');
  } finally {
    cleanup();
  }
});

test("a save parked on Felix's tutorial step still hears his cell explanation first", () => {
  const { quest, cleanup } = registerProductionPlugins();
  try {
    const player = playerFixture();
    quest.setStage(player, 115);
    player.setAttribute('temple-of-the-eye:tutorial', 5);

    const first = npcEvent(player, 'Apprentice Felix', N.APPRENTICE_FELIX_4);
    assert.equal(PluginManager.emitNpcInteraction(first), true);
    assert.match(player.manager.getCurrent().getText(), /^What have you found\?/);
    const firstLines = advanceAll(player);
    assert.ok(firstLines.some((line) => line.includes('containers on this table contain small amounts of')),
      `the first tutorial talk names the weak cells: ${JSON.stringify(firstLines)}`);
    assert.doesNotMatch(firstLines.join(' '), /You should take one of these containers to Tamara/);

    const again = npcEvent(player, 'Apprentice Felix', N.APPRENTICE_FELIX_4);
    assert.equal(PluginManager.emitNpcInteraction(again), true);
    assert.match(player.manager.getCurrent().getText(), /You should take one of these containers to Tamara/);
    advanceAll(player);
  } finally {
    cleanup();
  }
});

test('the temple apprentices keep their exploration repeat conversations', () => {
  const { quest, cleanup } = registerProductionPlugins();
  try {
    const player = playerFixture();
    quest.setStage(player, 105);

    const felix = npcEvent(player, 'Apprentice Felix', N.APPRENTICE_FELIX_4);
    assert.equal(PluginManager.emitNpcInteraction(felix), true);
    assert.match(player.manager.getCurrent().getText(), /^Still looking at that statue\?/,
      'Felix has no shortcut "felix-again" variant; his repeat still plays');
    advanceAll(player);

    const cordelia = npcEvent(player, 'Apprentice Cordelia', N.APPRENTICE_CORDELIA_3);
    assert.equal(PluginManager.emitNpcInteraction(cordelia), true);
    assert.match(player.manager.getCurrent().getText(), /^Any luck with this hole\?/);
    advanceAll(player);

    const tamara = npcEvent(player, 'Apprentice Tamara', N.APPRENTICE_TAMARA_3);
    assert.equal(PluginManager.emitNpcInteraction(tamara), true);
    assert.match(player.manager.getCurrent().getText(), /^Discovered anything more about these rune guardians\?/);
    advanceAll(player);
  } finally {
    cleanup();
  }
});

test('Tamara replaces the weak cell a player never took before the altar', () => {
  const { quest, cleanup } = registerProductionPlugins();
  try {
    const player = playerFixture();
    quest.setStage(player, 115);
    player.setAttribute('temple-of-the-eye:tutorial', 35);

    const event = npcEvent(player, 'Apprentice Tamara', N.APPRENTICE_TAMARA_3);
    assert.equal(PluginManager.emitNpcInteraction(event), true);
    assert.equal(player.getInventory().getAmount(I.WEAK_CELL), 1, 'Tamara supplied the missing weak cell');
    assert.equal(player.getInventory().getAmount(I.CATALYTIC_GUARDIAN_STONE), 1, 'and the lost catalytic stone');
    advanceAll(player);
  } finally {
    cleanup();
  }
});

test('the temple, vision and tutorial play in separate instances, and closing returns to the temple', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { quest, cleanup } = registerProductionPlugins({ nativeNpcs: true });
  const packets = [];
  const channel = {
    kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: packet => { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(1802); player.setUsername('tote-scenes'); player.setRegistered(true);
  player.setLocation(new core.Location(3104, 9573));
  const connection = new ClientConnection(channel); connection.player = player;
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3104, 9573);
  t.after(() => {
    player.closeInterruptibleInterfaces();
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
    cleanup();
  });
  quest.setStage(player, 90);
  player.setAttribute('quest.temple_of_the_eye.stage-schema', 2);
  PluginManager.loginHooks.find(hook => hook.pluginName === 'TempleOfTheEyeDispatchTest')
    .handler({ player, username: player.getUsername() });
  const action = (stepId, npcId = N.WIZARD_PERSTEN_4) => {
    const event = { player, npcId, stepId, kind: 'action', handled: false, text: stepId };
    PluginManager.emitCustomEvent('npc-dialogue:action', event);
    return event;
  };
  const line = (text, npcId = N.WIZARD_PERSTEN_3, step = {}) => {
    const event = { player, npcId, text, step, handled: false };
    PluginManager.emitCustomEvent('npc-dialogue:line', event);
    return event;
  };

  assert.equal(action('I_aoEy').handled, true);
  const temple = player.getPrivateArea();
  assert.ok(temple?.contains?.(player.getLocation()), 'the temple is a private instance the player is inside');
  assert.equal(quest.getStage(player), 95);
  assert.equal(spawnedNpcs().length, 0, 'arrival cast waits for its recorded portal cues');
  for (let i = 0; i < 33; i++) { core.World.processCycle++; core.TaskManager.process(); for (const npc of core.World.getNpcs()) npc.process(); }
  assert.equal(spawnedNpcs().length, 4, 'all four actors walked in before the first speech');
  assert.ok(spawnedNpcs().every(npc => npc.getPrivateArea?.() === temple), 'temple cast belongs to the instance');

  quest.setStage(player, 105);
  assert.equal(action('Wc3Ys0').handled, true);
  assert.equal(quest.getStage(player), 110);
  const vision = player.getPrivateArea();
  assert.equal(vision?.getName?.(), 'Temple of the Eye (vision)', 'the vision has its own copy');
  assert.notEqual(vision, temple);
  assert.ok(vision.contains(player.getLocation()));
  const returnLine = line('[player name]?');
  returnLine.before?.();
  const templeAgain = player.getPrivateArea();
  const visionReturn = player.getLocation();
  assert.equal(templeAgain?.getName?.(), 'Temple of the Eye');
  assert.equal(visionReturn.getX(), templeAgain.getBaseX() + 56);
  assert.equal(visionReturn.getY(), templeAgain.getBaseY() + 70);

  action('9R5c1w', N.WIZARD_PERSTEN_3);
  action('dUuNRU', N.WIZARD_PERSTEN_3);
  assert.equal(action('2OgBfc', N.THE_GREAT_GUARDIAN_3).handled, true);
  const tutorial = player.getPrivateArea();
  assert.ok(tutorial?.contains?.(player.getLocation()), 'the tutorial is its own instance');
  assert.notEqual(tutorial, temple);
  assert.equal(quest.getStage(player), 115);

  // An old save on Felix's step hears his explanation once, not the "see Tamara" repeat.
  player.setAttribute('temple-of-the-eye:tutorial', 25);
  player.setAttribute('temple-of-the-eye:felix-cells', 1);
  player.getInventory().adds(I.GUARDIAN_FRAGMENTS, 5);
  const hints = [];
  const sender = player.getPacketSender();
  const sendHint = sender.sendPositionalHint.bind(sender);
  sender.sendPositionalHint = (location, tilePosition, height, plane) => {
    hints.push({ x: location.getX(), y: location.getY(), height });
    return sendHint(location, tilePosition, height, plane);
  };
  const felix = {
    player, npc: {}, npcId: N.APPRENTICE_FELIX_4,
    definition: { getId: () => N.APPRENTICE_FELIX_4, getName: () => 'Apprentice Felix', getActions: () => ['Talk-to', null, null, null, null] },
    clickType: 1, handled: false,
  };
  assert.equal(PluginManager.emitNpcInteraction(felix), true);
  core.TaskManager.process();
  core.TaskManager.process();
  assert.deepEqual(hints.at(-1), {
    x: tutorial.getBaseX() + 52,
    y: tutorial.getBaseY() + 47,
    height: 64,
  }, 'the arrow moved to the middle of the workbench');

  // The third power-up closes the rift back in the temple instance.
  player.setAttribute('temple-of-the-eye:tutorial', 70);
  player.getInventory().adds(I.ELEMENTAL_GUARDIAN_STONE, 1);
  const power = {
    player, npc: {}, npcId: N.THE_GREAT_GUARDIAN_3,
    definition: { getId: () => N.THE_GREAT_GUARDIAN_3, getName: () => 'The Great Guardian', getActions: () => ['Power-up', null, null, null, null] },
    clickType: 1, handled: false,
  };
  assert.equal(PluginManager.emitNpcInteraction(power), true);
  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(quest.getStage(player), 120);
  assert.equal(player.getPrivateArea()?.getName?.(), 'Temple of the Eye');
  assert.notEqual(player.getPrivateArea(), tutorial);

  assert.equal(action('wd6dSZ', N.THE_GREAT_GUARDIAN_3).handled, true);
  assert.equal(quest.getStage(player), 125);
  assert.equal(player.getPrivateArea(), null);
  assert.ok(packets.length > 0, 'the native client received packets');
});

test('the vision walks the player to the Mysterious Stone before the voices start', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { quest, cleanup } = registerProductionPlugins({ nativeNpcs: true });
  const channel = {
    kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(1803); player.setUsername('tote-vision'); player.setRegistered(true);
  player.setLocation(new core.Location(3104, 9573));
  const connection = new ClientConnection(channel); connection.player = player;
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3104, 9573);
  t.after(() => {
    player.closeInterruptibleInterfaces();
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
    cleanup();
  });
  quest.setStage(player, 90);
  player.setAttribute('quest.temple_of_the_eye.stage-schema', 2);
  PluginManager.loginHooks.find(hook => hook.pluginName === 'TempleOfTheEyeDispatchTest')
    .handler({ player, username: player.getUsername() });
  PluginManager.emitCustomEvent('npc-dialogue:action',
    { player, npcId: N.WIZARD_PERSTEN_4, stepId: 'I_aoEy', kind: 'action', handled: false, text: 'I_aoEy' });
  quest.setStage(player, 105);
  player.setAttribute('quest.temple_of_the_eye.temple-apprentices', 7);
  const cameraLooks = [];
  const sender = player.getPacketSender();
  const sendCameraLookAt = sender.sendCameraLookAt;
  sender.sendCameraLookAt = (x, y, height, rates) => {
    cameraLooks.push({ x, y, height, rates });
    return sendCameraLookAt.call(sender, x, y, height, rates);
  };
  function tick() {
    core.World.processCycle++;
    core.TaskManager.process();
    connection.processTurnPackets();
    player.getMovementQueue().process(); core.TaskManager.processWalkTo(player.getIndex());
    player.getSession().flushClient(core.World.processCycle);
    player.resetUpdating();
  }

  const manager = player.getDialogueManager();
  assert.equal(PluginManager.emitNpcInteraction(npcEvent(player, 'Wizard Persten', N.WIZARD_PERSTEN_4)), true);
  for (let i = 0; i < 20 && quest.getStage(player) === 105; i++) {
    manager.advance();
    if (quest.getStage(player) === 105) tick();
  }
  assert.equal(quest.getStage(player), 110, 'the vision began');
  const vision = player.getPrivateArea();
  assert.equal(vision?.getName?.(), 'Temple of the Eye (vision)');
  const start = { x: player.getLocation().getX(), y: player.getLocation().getY() };
  assert.deepEqual(start, { x: vision.getBaseX() + 32, y: vision.getBaseY() + 42 }, 'the player arrives at 2400,5738');
  const voices = () => manager.getCurrent()?.getText?.() === 'Saradomin be with you.';

  const path = [], blocked = [];
  for (let i = 1; i <= 24 && !voices(); i++) {
    // Held Space: the held chatbox ignores Continues while the player walks.
    manager.handleResume((player.getPacketSender().getChatboxGroupId() << 16) | 5, -1);
    tick();
    path.push(player.getLocation().getY() - vision.getBaseY());
    blocked.push(player.getMovementQueue().isMovementBlocked());
  }
  assert.deepEqual(blocked.map((value, i) => value ? null : i + 1).filter(Boolean),
    [11, 12, 13, 14, 15, 16, 17], 'control is released only for the walk');
  assert.equal(path.length, 24, `the voices wait 24 ticks: ${JSON.stringify(path)}`);
  assert.ok(voices(), 'the first voice speaks once the player is at the stone');
  // Capture 1693: still for 10 ticks, then one tile a tick to y=5731 (seven tiles south).
  assert.deepEqual(path.slice(0, 10), Array(10).fill(42), 'the player waits on arrival');
  assert.deepEqual(path.slice(10, 17), [41, 40, 39, 38, 37, 36, 35], 'then walks south to the stone');
  assert.ok(path.slice(17).every(y => y === 35), 'and stays beside it');
  assert.equal(player.getLocation().getX(), start.x);
  assert.equal(player.getMovementQueue().isMovementBlocked(), true, 'the cutscene keeps control during the voices');
  const pan = cameraLooks.find(look => look.rates?.rate === 1);
  assert.deepEqual(pan && [pan.x - vision.getBaseX(), pan.y - vision.getBaseY(), pan.height], [35, 32, 560],
    'the camera pans to the stone (2403,5728) as the walk starts');

  manager.advance(); tick();
  assert.match(manager.getCurrent()?.getText?.() ?? '', /^And with you, Zachariah/, 'the transcript carries on');
});

function spawnedNpcs() {
  return [...core.World.getNpcs()].filter(npc => npc.isOwnerOnly?.() === true
    && npc.getOwner?.()?.getUsername?.() === 'tote-scenes');
}

async function nativeIncantation(t, burst = false, interrupt = null, startStage = 85, holdSpace = false) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const { quest, spawned, cleanup } = registerProductionPlugins({ nativeNpcs: true });
  const packets = [];
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: packet => { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(1800); player.setUsername('tote-incantation'); player.setRegistered(true);
  player.setLocation(new core.Location(3104, 9573));
  const connection = new ClientConnection(channel); connection.player = player;
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3104, 9573);
  t.after(() => { player.closeInterruptibleInterfaces(); player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); cleanup(); });
  quest.setStage(player, startStage);
  player.setAttribute('quest.temple_of_the_eye.stage-schema', 2);
  PluginManager.loginHooks.find(hook => hook.pluginName === 'TempleOfTheEyeDispatchTest').handler({ player, username: player.getUsername() });
  const sedridor = PluginManager.spawnNpc({ id: N.ARCHMAGE_SEDRIDOR_2, x: 3105, y: 9573, z: 0 });
  t.after(() => PluginManager.removeNpc(sedridor));
  const manager = player.getDialogueManager(), lines = [], chants = [], portals = [];
  let heldContinues = 0;
  // Capture the arrival camera: its look target is just south of the temple's copied square.
  const cameraMoves = [], cameraLooks = [];
  const packetSender = player.getPacketSender();
  const sendCameraMoveTo = packetSender.sendCameraMoveTo;
  const sendCameraLookAt = packetSender.sendCameraLookAt;
  packetSender.sendCameraMoveTo = (x, y, height, rates) => {
    cameraMoves.push([x, y, height]);
    return sendCameraMoveTo.call(packetSender, x, y, height, rates);
  };
  packetSender.sendCameraLookAt = (x, y, height, rates) => {
    cameraLooks.push([x, y, height]);
    return sendCameraLookAt.call(packetSender, x, y, height, rates);
  };
  const registerObject = core.ObjectManager.register;
  t.mock.method(core.ObjectManager, 'register', function(object, ...args) {
    const result = registerObject.call(this, object, ...args);
    if (object.getId() === core.ObjectIdentifiers.PORTAL_106) portals.push(object);
    return result;
  });
  const forceChat = core.NPC.prototype.forceChat;
  t.mock.method(core.NPC.prototype, 'forceChat', function(text) { chants.push([this.getId(), text]); return forceChat.call(this, text); });
  function tick() {
    core.World.processCycle++;
    core.TaskManager.process();
    connection.processTurnPackets();
    player.getMovementQueue().process(); core.TaskManager.processWalkTo(player.getIndex());
    for (const npc of core.World.getNpcs()) npc.process();
    core.World.updateLocalNpcs(player, [...core.World.getNpcs()]);
    player.getSession().flushClient(core.World.processCycle);
    player.resetUpdating(); for (const npc of core.World.getNpcs()) npc.resetUpdating();
  }
  async function send(packet) { await connection.dispatch([packet]); tick(); }
  tick();
  await send({ type: 'npc_option', index: sedridor.getIndex(), clickType: 1 });
  for (let step = 0; step < 120 && quest.getStage(player) < 100; step++) {
    if (interrupt && quest.getStage(player) === 90 && manager.getCurrent()?.constructor.name === 'ActionDialogue') {
      let replacement, replacementScenes, bank;
      if (interrupt === 'logout') {
        player.setRegistered(false);
        PluginManager.logoutHooks.find(hook => hook.pluginName === 'TempleOfTheEyeDispatchTest').handler({ player, username: player.getUsername() });
      } else if (interrupt === 'bank') {
        player.getBank(0).open();
        bank = player.getInterfaceId();
        assert.ok(bank >= 0, 'the actual bank replaced the held cutscene');
      } else {
        if (interrupt === 'scene') {
          replacementScenes = require('../plugins/quests/QuestScenes').createQuestScenes(PluginManager.createApi('ReplacementScene'));
          replacementScenes.open(player, 'replacement', [[3090, 3110, 9560, 9580, 0]]);
          replacementScenes.controls(player, true, true);
        }
        manager.startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, 'Replacement conversation.')));
        replacement = manager.getCurrent();
      }
      tick(); tick(); tick();
      assert.equal(chants.length, 0, 'the cancelled deferred scene never starts');
      assert.equal(player.getAttribute('temple-of-the-eye:basement-portal-open') ?? false, false);
      assert.equal(quest.getStage(player), 90);
      assert.ok(spawned.filter(npc => [N.APPRENTICE_TAMARA_2, N.APPRENTICE_FELIX_3, N.APPRENTICE_CORDELIA_2,
        N.WIZARD_TRAIBORN_2, N.ARCHMAGE_SEDRIDOR_3, N.WIZARD_PERSTEN_3].includes(npc.getId())).every(npc => !npc.isRegistered()), 'cancelled cast was removed');
      if (replacement) assert.equal(manager.getCurrent(), replacement, 'the deferred scene cannot replace a newer chatbox');
      if (bank !== undefined) assert.equal(player.getInterfaceId(), bank, 'cleanup preserves the new bank');
      if (interrupt !== 'logout') {
        assert.equal(player.getMovementQueue().isMovementBlocked(), interrupt === 'scene', 'only a new private scene keeps control');
        assert.equal(player.getPacketSender().getVarbit(542), interrupt === 'scene' ? 1 : 0);
      }
      replacementScenes?.end(player);
      if (interrupt !== 'logout') {
        player.closeInterruptibleInterfaces();
        await send({ type: 'npc_option', index: sedridor.getIndex(), clickType: 1 });
        await send({ type: 'dialogue_continue', widgetId: (231 << 16) | 5, childIndex: -1 });
        assert.ok(MultiChatboxPrompt.getPending(player)?.options.includes("So we're ready to perform the incantation?"), 'earned stage 90 remains retryable through native Talk-to');
      }
      return;
    }
    const choice = MultiChatboxPrompt.getPending(player);
    if (choice) {
      const index = choice.options.findIndex(text => text === "Let's do it." || text === "So we're ready to perform the incantation?");
      assert.ok(index >= 0, JSON.stringify(choice));
      await send({ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
    } else if (burst && manager.getCurrent()?.getText?.() === "Let's do it.") {
      await connection.dispatch([217, 231, 231, 231].map(group => ({
        type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1,
      })));
      tick();
    } else if (manager.getCurrent()?.getText) {
      lines.push(manager.getCurrent().getText().replace(/\s+/g, ' '));
      await send({ type: 'dialogue_continue', widgetId: (player.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
    } else if (holdSpace && player.getPacketSender().getChatboxGroupId() >= 0) {
      // Held Space: a Continue on whatever chatbox is still up while the chant (or a hold) waits on its timer.
      heldContinues++;
      await send({ type: 'dialogue_continue', widgetId: (player.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
    } else tick();
  }
  assert.equal(quest.getStage(player), 100, JSON.stringify({ lines, chants, actors: spawned.map(npc => ({ id: npc.getId(), registered: npc.isRegistered(), visible: npc.isVisible(), local: player.getLocalNpcs().includes(npc) })), blocked: player.getMovementQueue().isMovementBlocked() }));
  assert.equal(player.getNpcTransformationId(), -1, 'arrival restores the real player appearance');
  assert.equal(player.getNpcViewDistance(), 15, 'normal arrival end restores the prior NPC view');
  assert.equal(chants.length, 4);
  assert.deepEqual(chants.map(([id]) => id).sort(), [N.APPRENTICE_TAMARA_2, N.APPRENTICE_FELIX_3, N.APPRENTICE_CORDELIA_2, N.WIZARD_PERSTEN_3].sort());
  assert.ok(chants.every(([, text]) => text === 'Saris! Val! Curak! Belito!'));
  if (!holdSpace) assert.ok(lines.includes('It worked!'), 'held Space may skip it as soon as it shows');
  assert.equal(portals.length, 1, 'the actual scene portal was registered once');
  assert.equal(portals[0].getOwner(), player);
  assert.equal(core.World.getObjects().includes(portals[0]), false, 'entering the temple removed the cutscene portal');
  assert.ok(packets.length > 0, 'actual native NPC/player sync and UI packets were encoded');
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);

  // Raw1693 arrival camera source (2399,5636) looks at (2399,5626). Both now
  // fall within the captured scenic palette, south of the original playable room.
  const temple = player.getPrivateArea();
  assert.ok(temple, 'the temple instance is still active at the arrival checkpoint');
  const arrivalIndex = cameraMoves.findIndex(([x, y, height]) =>
    x === temple.getBaseX() + 55 && y === temple.getBaseY() + 36 && height === 550);
  assert.ok(arrivalIndex >= 0, 'arrival camera move is translated into the instance');
  assert.deepEqual(cameraLooks[arrivalIndex], [temple.getBaseX() + 55, temple.getBaseY() + 26, 300],
    'arrival camera look is translated even though it is outside the copied square');

  if (holdSpace) assert.ok(heldContinues > 0, 'Continues reached the waiting chant');
}

test('the native incantation cast chants, opens its portal and continues into the temple', nativeIncantation);
test('continues queued on the scene-start tick cannot strand the newly spawned native cast', t => nativeIncantation(t, true));
test('a stage-90 checkpoint can replay the incantation through the native dialogue choices', t => nativeIncantation(t, true, null, 90));
test('a replacement dialogue cancels the deferred incantation start', t => nativeIncantation(t, true, 'replacement'));
test('a bank replacement cancels the deferred scene and releases its old controls', t => nativeIncantation(t, true, 'bank'));
test('a new private quest scene keeps its own controls when the deferred incantation is cancelled', t => nativeIncantation(t, true, 'scene'));
test('logout cancels the deferred incantation start', t => nativeIncantation(t, true, 'logout'));
test('Continues held through the chant cannot end its timed overhead line', t => nativeIncantation(t, true, null, 85, true));

function nativeSceneFixture(t, username = 'tote-capture') {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const registered = registerProductionPlugins({ nativeNpcs: true });
  const faces = []; const faceTile = core.NPC.prototype.faceTile;
  t.mock.method(core.NPC.prototype, 'faceTile', function(location) { faces.push({ npc: this, x: location.getX(), y: location.getY() }); return faceTile.call(this, location); });
  const packets = [];
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: packet => { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(1804); player.setUsername(username); player.setRegistered(true);
  player.setLocation(new core.Location(3104, 9573));
  const connection = new ClientConnection(channel); connection.player = player;
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3104, 9573);
  const hook = name => PluginManager[name].find(entry => entry.pluginName === 'TempleOfTheEyeDispatchTest');
  function tick(count = 1) {
    while (count--) {
      core.World.processCycle++; core.TaskManager.process(); connection.processTurnPackets();
      require('../dist/game/model/areas/AreaManager').AreaManager.process(player);
      player.getMovementQueue().process(); core.TaskManager.processWalkTo(player.getIndex());
      for (const npc of core.World.getNpcs()) npc.process();
      core.World.updateLocalNpcs(player, [...core.World.getNpcs()]);
      player.getSession().flushClient(core.World.processCycle);
      player.resetUpdating(); for (const npc of core.World.getNpcs()) npc.resetUpdating();
    }
  }
  const action = stepId => PluginManager.emitCustomEvent('npc-dialogue:action',
    { player, npcId: N.WIZARD_PERSTEN_4, stepId, kind: 'action', handled: false, text: stepId });
  t.after(() => {
    hook('logoutHooks').handler({ player, username }); player.closeInterruptibleInterfaces();
    player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); registered.cleanup();
  });
  player.setAttribute('quest.temple_of_the_eye.stage-schema', 2);
  return { ...registered, player, connection, packets, faces, hook, tick, action,
    enter() { registered.quest.setStage(player, 90); hook('loginHooks').handler({ player, username }); action('I_aoEy'); return player.getPrivateArea(); } };
}

function assertCapturedPalette(area, kind) {
  const crypto = require('node:crypto');
  const capture = require('../plugins/quests/data/temple-of-the-eye-templates.json');
  for (const view of capture.views.filter(view => view.kind === kind)) {
    const bytes = Buffer.alloc(4 * 4 * 13 * 13); let offset = 0;
    for (let plane = 0; plane < 4; plane++) for (let x = 0; x < 13; x++) for (let y = 0; y < 13; y++) {
      const chunk = area.getChunk(plane, x + view.offset[0], y + view.offset[1]);
      const packed = chunk ? (chunk.sourcePlane << 24) | (chunk.sourceChunkX << 14) | (chunk.sourceChunkY << 3) | (chunk.rotation << 1) : -1;
      bytes.writeInt32BE(packed, offset); offset += 4;
    }
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), view.paletteSha256,
      `all 676 raw template entries, including holes, at capture tick ${view.tick}`);
  }
}

test('raw1693 arrival palette and portal actors run through actual NPC processing', t => {
  const f = nativeSceneFixture(t), { player, tick } = f;
  const area = f.enter();
  assertCapturedPalette(area, 'temple');
  assert.equal(area.contains(area.sourceTile(2398, 5630)), false, 'scenery does not expand the playable room');
  assert.equal(area.contains(area.sourceTile(2398, 5632)), true);
  assert.equal(player.getNpcTransformationId(), 716, 'recorded invisible camera actor');
  tick(15);
  const persten = f.spawned.find(npc => npc.getId() === 11438 && npc.isRegistered());
  assert.ok(persten, 'Persten arrives at raw tick4483, fifteen ticks after rebuild');
  assert.equal(persten.getLocation().getY(), area.getBaseY() + 30, 'source5630 is outside old playable bounds');
  assert.equal(persten.getPrivateArea(), area, 'outside actor remains activated in its owner area');
  // Raw1693 requires the native large NPC update: the portal begins21 tiles away.
  assert.equal(player.getNpcViewDistance(),21);
  assert.equal(player.getLocalNpcs().includes(persten), true, 'portal animation is published even outside the normal15-tile view');
  tick(5);
  assert.equal(persten.getLocation().getY(), area.getBaseY() + 31, 'actual World NPC processing takes the first north step');
  tick(6);
  assert.equal(persten.getLocation().getY(), area.getBaseY() + 37, 'recorded seven-tile walk completes');
  assert.equal(player.getLocalNpcs().includes(persten), true, 'walking into view publishes the actual NPC');
  tick(7);
  const cast = f.spawned.filter(npc => [11438,11441,11444,11447].includes(npc.getId()) && npc.isRegistered());
  assert.equal(cast.length, 4);
  assert.ok(cast.every(npc => player.getLocalNpcs().includes(npc)), 'all four recorded actors are actually synced to the client');
  assert.deepEqual(cast.map(npc => [npc.getId(), npc.getLocation().getX() - area.getBaseX(), npc.getLocation().getY() - area.getBaseY()]).sort(),
    [[11438,54,37],[11441,54,35],[11444,56,35],[11447,55,35]].sort(), 'raw actor endpoints, not normalized transcript guesses');
  assert.ok(cast.every(npc => !npc.hasFlag('movement:ignore-clipping')));
  assert.equal(player.getDialogueManager().getCurrent().getText(), 'Well this is... unexpected.');
  assert.ok(f.packets.length > 0, 'real native sync packets emitted');
});

for (const interruption of ['dialogue', 'bank', 'logout', 'scene']) {
  test(`arrival ${interruption} cancellation releases its model and scripted actors`, t => {
    const f = nativeSceneFixture(t), { player, tick } = f;
    f.enter(); tick(21);
    const cast = f.spawned.filter(npc => npc.getId() === 11438 && npc.isRegistered());
    assert.equal(cast.length, 1);
    assert.equal(cast[0].hasFlag('movement:ignore-clipping'), true);
    let replacement, scenes, bank;
    if (interruption === 'logout') {
      player.setRegistered(false); f.hook('logoutHooks').handler({ player, username: player.getUsername() });
    } else if (interruption === 'bank') { player.getBank(0).open(); bank = player.getInterfaceId(); }
    else {
      if (interruption === 'scene') {
        scenes = require('../plugins/quests/QuestScenes').createQuestScenes(PluginManager.createApi('ReplacementArrival'));
        scenes.open(player, 'replacement', [[3090,3110,9560,9580,0]]); player.moveTo(new core.Location(3100,9570)); scenes.controls(player, true, true);
      }
      player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, 'Replacement.')));
      replacement = player.getDialogueManager().getCurrent();
    }
    tick(35);
    assert.equal(player.getNpcTransformationId(), -1);
    assert.equal(player.getNpcViewDistance(),15);
    assert.ok(cast.every(npc => !npc.hasFlag('movement:ignore-clipping') && !npc.isScriptedMovement()), 'removed actors release movement exceptions');
    assert.ok(f.spawned.filter(npc => [11438,11441,11444,11447].includes(npc.getId())).every(npc => !npc.isRegistered()), 'stale callbacks cannot respawn the cast');
    if (replacement) assert.equal(player.getDialogueManager().getCurrent(), replacement);
    if (bank !== undefined) assert.equal(player.getInterfaceId(), bank);
    if (interruption !== 'logout') {
      assert.equal(player.getMovementQueue().isMovementBlocked(), interruption === 'scene');
      assert.equal(player.getPacketSender().getVarbit(542), interruption === 'scene' ? 1 : 0, 'camera controls released unless owned by the replacement');
    }
    scenes?.end(player);
  });
}

test('Mind and both Water returns restore exactly one tutorial cast, then the closing Guardian faces the rift', t => {
  const f = nativeSceneFixture(t), { player, quest, tick } = f;
  quest.setStage(player, 115);
  player.setAttribute('temple-of-the-eye:tutorial', 30);
  player.setAttribute('quest.temple_of_the_eye.mind-briefed', 1);
  player.setLocation(new core.Location(3613,9496));
  f.hook('loginHooks').handler({ player, username: player.getUsername() });
  let tutorial = player.getPrivateArea();
  assertCapturedPalette(tutorial, 'tutorial');
  const objectAction = (id, option) => {
    const event = { player, objectId: id, object: { getId: () => id }, definition: { getName: () => '', getInteractions: () => [option] }, clickType: 1, option, handled: false };
    assert.equal(PluginManager.emitObjectInteraction(event), true, `production object action ${id} ${option}`);
  };
  const castIds = [11445,11448,11442,11456];
  const assertCast = () => {
    for (const id of castIds) {
      const npcs = [...core.World.getNpcs()].filter(npc => npc.getOwner?.() === player && npc.getId() === id && npc.isRegistered());
      assert.equal(npcs.length, 1, `one owned actor ${id}`); assert.equal(npcs[0].getPrivateArea(), tutorial);
    }
    const guardian = [...core.World.getNpcs()].find(npc => npc.getOwner?.() === player && npc.getId() === 11456);
    assert.ok(f.faces.some(face => face.npc === guardian && face.x === tutorial.getBaseX()+55 && face.y === tutorial.getBaseY()+80), 'raw tutorial Guardian face coord was published');
    assert.equal(guardian.getFace().getDirection().getId(), 1, 'persistent north spawn facing');
  };
  assertCast();
  for (const progress of [30,45,60]) {
    player.setAttribute('temple-of-the-eye:tutorial', progress);
    player.getInventory().adds(I.GUARDIAN_ESSENCE, 5); player.getInventory().adds(I.UNCHARGED_CELL, 1);
    if (progress === 60) {
      player.getInventory().adds(26888, 1);
      assert.equal(PluginManager.emitItemOnObject({ player, object: {}, objectId: 43810, itemId: 26888,
        objectDefinition: { getName: () => 'Guardian of Water' }, itemDefinition: { getName: () => 'Portal talisman (water)', isNoted: () => false }, handled: false }), true);
    } else objectAction(progress === 30 ? 43822 : 43821, 'Enter');
    tick(3);
    assert.equal(player.getPrivateArea(), null, 'altar uses the ordinary map');
    assert.ok(castIds.every(id => ![...core.World.getNpcs()].some(npc => npc.getOwner?.() === player && npc.getId() === id)), 'outbound cast is removed');
    objectAction(progress === 30 ? 34761 : 34762, 'Craft-rune');
    assert.equal(player.getAttribute('temple-of-the-eye:tutorial'), progress + 5);
    objectAction(progress === 30 ? 34749 : 34750, 'Use'); tick(3);
    tutorial = player.getPrivateArea();
    assert.equal(tutorial?.getName(), 'Temple of the Eye (tutorial)'); assertCast();
    const count = core.World.getObjects().filter(object => object.getOwner?.() === player).length;
    objectAction(progress === 30 ? 34749 : 34750, 'Use'); tick(3); assertCast();
    assert.equal(core.World.getObjects().filter(object => object.getOwner?.() === player).length, count, 'repeat return does not duplicate tutorial props');
    assert.equal(quest.getStage(player),115); assert.equal(quest.isComplete(player),false);
  }
  player.setAttribute('temple-of-the-eye:tutorial',70);
  PluginManager.emitNpcInteraction(npcEvent(player,'The Great Guardian',11456,'Power-up')); tick(5);
  assert.equal(quest.getStage(player),120);
  const temple = player.getPrivateArea();
  const guardian = [...core.World.getNpcs()].find(npc => npc.getOwner?.() === player && npc.getId() === 11455);
  assert.ok(f.faces.some(face => face.npc === guardian && face.x === temple.getBaseX()+55 && face.y === temple.getBaseY()+80), 'raw8812 face10751,4368 maps to source2399,5680');
  assert.equal(guardian.getFace().getDirection().getId(),1);
  const felix = [...core.World.getNpcs()].find(npc => npc.getOwner?.() === player && npc.getId() === 11447);
  assert.equal(felix.getLocation().getX(),temple.getBaseX()+57,'raw8813..8815 Felix walks west to source2401');
});

for (const checkpoint of ['speech', 'pan', 'locator', 'resumed speech']) {
  for (const interruption of ['escape', 'dialogue', 'bank']) {
    test(`arrival ${checkpoint} ${interruption} replacement releases only its cinematic ownership`, t => {
      const f = nativeSceneFixture(t), { player, tick } = f;
      f.enter(); tick(33);
      const manager = player.getDialogueManager();
      assert.equal(manager.getCurrent().getText(), 'Well this is... unexpected.');
      if (checkpoint !== 'speech') {
        manager.advance(); tick(); manager.advance(); tick(); manager.advance();
        if (checkpoint !== 'pan') {
          tick(24); assert.equal(manager.getCurrent().getText(), 'Let me cast a locator spell!');
          manager.advance();
          if (checkpoint === 'resumed speech') {
            tick(3); assert.match(manager.getCurrent().getText(), /^It seems we're deep below the sea/);
          }
        }
      }
      let replacement, bank;
      if (interruption === 'escape') player.closeInterruptibleInterfaces();
      else if (interruption === 'bank') { player.getBank(0).open(); bank = player.getInterfaceId(); }
      else {
        manager.startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0,'New conversation.')));
        replacement = manager.getCurrent();
      }
      tick(30);
      assert.equal(player.getNpcTransformationId(),-1);
      assert.equal(player.getNpcViewDistance(),15);
      assert.equal(player.getMovementQueue().isMovementBlocked(),false);
      assert.equal(player.getPacketSender().getVarbit(542),0);
      assert.ok(f.spawned.filter(npc => [11438,11441,11444,11447].includes(npc.getId())).every(npc => !npc.isRegistered() && !npc.hasFlag('movement:ignore-clipping') && !npc.isScriptedMovement()));
      if (replacement) assert.equal(manager.getCurrent(),replacement,'old scene preserves replacement conversation');
      if (bank !== undefined) assert.equal(player.getInterfaceId(),bank,'old scene preserves replacement bank');
    });
  }
}


test('arrival preserves a wider preexisting NPC view on cancellation', t => {
  const f = nativeSceneFixture(t); f.player.setNpcViewDistance(35); f.enter(); f.tick(33);
  assert.equal(f.player.getNpcViewDistance(),35);
  f.player.closeInterruptibleInterfaces(); f.tick();
  assert.equal(f.player.getNpcViewDistance(),35);
  assert.equal(f.player.getNpcTransformationId(),-1);
});
