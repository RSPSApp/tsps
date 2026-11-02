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
    getUsername: () => 'tote-dispatch',
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

async function nativeIncantation(t, burst = false, interrupt = null, startStage = 85) {
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
    } else tick();
  }
  assert.equal(quest.getStage(player), 100, JSON.stringify({ lines, chants, actors: spawned.map(npc => ({ id: npc.getId(), registered: npc.isRegistered(), visible: npc.isVisible(), local: player.getLocalNpcs().includes(npc) })), blocked: player.getMovementQueue().isMovementBlocked() }));
  assert.equal(chants.length, 4);
  assert.deepEqual(chants.map(([id]) => id).sort(), [N.APPRENTICE_TAMARA_2, N.APPRENTICE_FELIX_3, N.APPRENTICE_CORDELIA_2, N.WIZARD_PERSTEN_3].sort());
  assert.ok(chants.every(([, text]) => text === 'Saris! Val! Curak! Belito!'));
  assert.ok(lines.includes('It worked!'));
  assert.equal(portals.length, 1, 'the actual scene portal was registered once');
  assert.equal(portals[0].getOwner(), player);
  assert.equal(core.World.getObjects().includes(portals[0]), false, 'entering the temple removed the cutscene portal');
  assert.ok(packets.length > 0, 'actual native NPC/player sync and UI packets were encoded');
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
}

test('the native incantation cast chants, opens its portal and continues into the temple', nativeIncantation);
test('continues queued on the scene-start tick cannot strand the newly spawned native cast', t => nativeIncantation(t, true));
test('a stage-90 checkpoint can replay the incantation through the native dialogue choices', t => nativeIncantation(t, true, null, 90));
test('a replacement dialogue cancels the deferred incantation start', t => nativeIncantation(t, true, 'replacement'));
test('a bank replacement cancels the deferred scene and releases its old controls', t => nativeIncantation(t, true, 'bank'));
test('a new private quest scene keeps its own controls when the deferred incantation is cancelled', t => nativeIncantation(t, true, 'scene'));
test('logout cancels the deferred incantation start', t => nativeIncantation(t, true, 'logout'));
