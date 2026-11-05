// Shilo Village mound/fissure transforms (issue #2542).
// From server/: yarn build && node --test tests/shilo-village-fissure.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const N = core.NpcIdentifiers;
const MOUND_TILE = new core.Location(2921, 2999, 0);

function harness() {
  const handlers = [];
  const events = new Map();
  const api = new Proxy({
    core,
    persistAttribute() {},
    onItemOnObject(handler) { handlers.push(handler); },
    onObjectInteraction(handler) { handlers.push(handler); },
    onNpcInteraction(_name, options) { for (const handler of Object.values(options)) handlers.push(handler); },
    onPlayerLogin(handler) { handlers.push(handler); },
    onPlayerLogout(handler) { handlers.push(handler); },
    onCustomEvent(name, handler) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(handler);
    },
    emitCustomEvent(name, event) { for (const handler of events.get(name) ?? []) handler(event); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });

  const originalStart = runtime.startTranscript;
  runtime.startTranscript = () => true;
  try {
    require('../plugins/quests/quests/ShiloVillage.Quest')(api);
  } finally {
    runtime.startTranscript = originalStart;
  }
  return {
    handlers,
    emit: (name, event) => { for (const handler of events.get(name) ?? []) handler(event); },
  };
}

function makePlayer(attrs, at = new core.Location(2924, 3000, 0)) {
  const items = new Map([[I.SPADE, 1], [I.ROPE, 1], [I.LIT_TORCH, 1]]);
  const messages = [];
  const sender = new Proxy({
    getVarbit: () => 0,
    getVarp: () => 0,
  }, { get: (target, key) => key in target ? target[key] : () => sender });
  const player = {
    attrs,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getLocation: () => at,
    moveTo: (next) => { at = next; },
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      adds: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); return true; },
      deleteNumber: (id, amount = 1) => {
        const have = items.get(id) ?? 0;
        if (have < amount) return false;
        if (have === amount) items.delete(id);
        else items.set(id, have - amount);
        return true;
      },
      isFull: () => false,
      getFreeSlots: () => 28,
    }),
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, addExperiences() {} }),
    getPacketSender: () => sender,
    getPrivateArea: () => null,
    sendMessage: (message) => messages.push(message),
  };
  return { player, messages, items };
}

function owned(player) {
  return core.ObjectManager.objectsAt(MOUND_TILE).find((object) => object.getOwner?.() === player);
}

test('spade turns the mound into this player\'s fissure; light, rope and relog restore it', () => {
  const h = harness();
  const handlers = h.handlers;
  const attrs = new Map();
  const { player, items, messages } = makePlayer(attrs);
  const itemOnObject = handlers.find((handler) => handler.name === 'handleItemOnObject');
  const login = handlers.find((handler) => handler.name === 'handleLogin');
  const logout = handlers.find((handler) => handler.name === 'handleLogout');

  const use = (itemId, objectId) => {
    const event = { player, itemId, objectId, handled: false };
    itemOnObject(event);
    return event;
  };

  use(I.SPADE, O.MOUND_OF_EARTH);
  assert.equal(attrs.get('quest.shilo_village.stage'), 4);
  assert.equal(owned(player)?.getId(), O.FISSURE, 'the dug mound becomes a fissure for this player');

  use(I.SPADE, O.FISSURE);
  assert.equal(attrs.get('quest.shilo_village.stage'), 4, 'digging a fissure leaves the stage alone');
  assert.equal(owned(player)?.getId(), O.FISSURE);

  use(I.ROPE, O.FISSURE);
  assert.equal(attrs.get('quest.shilo_village.stage'), 4, 'rope before light does not advance');
  assert.equal(items.get(I.ROPE), 1, 'rope before light is not consumed');
  assert.match(messages.at(-1), /too dark/);

  use(I.LIT_TORCH, O.FISSURE);
  h.emit('npc-dialogue:choice', { player, npcId: N.TRUFITUS, option: 'No' });
  assert.equal(attrs.get('quest.shilo_village.stage'), 4, 'declining the light prompt does not advance');
  assert.equal(items.get(I.LIT_TORCH), 1, 'declining the light prompt keeps the torch');

  use(I.LIT_TORCH, O.FISSURE);
  items.delete(I.LIT_TORCH);
  h.emit('npc-dialogue:choice', { player, npcId: N.TRUFITUS, option: 'Yes' });
  assert.equal(attrs.get('quest.shilo_village.stage'), 4, 'a Yes after the light vanished does not advance');
  items.set(I.LIT_TORCH, 1);

  use(I.LIT_TORCH, O.FISSURE);
  h.emit('interface:close', { player });
  h.emit('npc-dialogue:choice', { player, npcId: N.TRUFITUS, option: 'Yes' });
  assert.equal(attrs.get('quest.shilo_village.stage'), 4, 'cancelled light prompt does not stay usable');
  assert.equal(items.get(I.LIT_TORCH), 1, 'cancelled light prompt keeps the torch');

  use(I.LIT_TORCH, O.FISSURE);
  const talk = handlers.find((handler) => handler.name === 'handleTrufitusTalk');
  talk({ player, handled: false });
  h.emit('npc-dialogue:choice', { player, npcId: N.TRUFITUS, option: 'Yes' });
  assert.equal(attrs.get('quest.shilo_village.stage'), 4, 'an unrelated Trufitus Yes does not consume a stale light prompt');
  assert.equal(items.get(I.LIT_TORCH), 1);

  use(I.LIT_TORCH, O.FISSURE);
  const objectInteraction = handlers.find((handler) => handler.name === 'handleObjectInteraction');
  objectInteraction({ player, objectId: O.FISSURE, clickType: 2 });
  h.emit('npc-dialogue:choice', { player, npcId: N.TRUFITUS, option: "Yes, I'll give it a go!" });
  assert.equal(attrs.get('quest.shilo_village.stage'), 4, 'accepting Search after replacing the light prompt does not light the fissure');
  assert.equal(items.get(I.LIT_TORCH), 1, 'Search does not consume a light source');

  use(I.LIT_TORCH, O.FISSURE);
  h.emit('npc-dialogue:choice', { player, npcId: N.TRUFITUS, option: 'Yes' });
  assert.equal(attrs.get('quest.shilo_village.stage'), 5);
  assert.equal(items.has(I.LIT_TORCH), false, 'accepting the light prompt consumes it');
  assert.equal(owned(player)?.getId(), O.FISSURE);

  use(I.ROPE, O.FISSURE);
  assert.equal(attrs.get('quest.shilo_village.stage'), 6);
  assert.equal(items.has(I.ROPE), false, 'roping consumes the rope');
  assert.equal(owned(player)?.getId(), O.FISSURE_2, 'the roped fissure replaces the plain one');

  logout({ player });
  assert.equal(owned(player), undefined, 'logout removes the session object');

  const relog = makePlayer(attrs).player;
  login({ player: relog });
  assert.equal(owned(relog)?.getId(), O.FISSURE_2, 'login rebuilds the saved roped fissure for the new session');

  core.ObjectManager.deregister(owned(relog), true);
});
