// Run after `yarn build`: node --test tests/grand-exchange-sets.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Item } = require('../dist/game/model/Item');

const MAIN = 451;
const SIDE = 430;
const PACK = (MAIN << 16) | 3;
const UNPACK = SIDE << 16;
const MAX_STACK = 0x7fffffff;
// Op 1 and Examine (op 10), as live enables on both lists.
const OP1_AND_EXAMINE = (1 << 1) | (1 << 10);
let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
});

function recipes() {
  return [...core.CacheDefinitions.getEnumValues(1033)].map(([slot, enumId]) => {
    const values = core.CacheDefinitions.getEnumValues(enumId);
    return { slot, enumId, setId: values.get(-1),
      components: [...values].filter(([key]) => key >= 0).sort(([a], [b]) => a - b).map(([, id]) => id) };
  });
}

function note(id) {
  const noteId = core.ItemDefinition.forId(id).getNoteId();
  return noteId > 0 ? noteId : id;
}

function harness({ members = true, ultimate = false } = {}) {
  const npcs = new Map(), objects = new Map(), buttons = new Map(), emitted = [], events = new Map();
  require('../plugins/interface/grandexchange/Sets.GrandExchange')({
    core: { ...core, WorldDefinition: { ...core.WorldDefinition, isMembersWorld: () => members } },
    onNpcInteraction: (name, actions) => npcs.set(name, actions),
    onObjectInteraction: (name, actions) => objects.set(name, actions),
    onCustomEvent: (name, handler) => events.set(name, [...(events.get(name) ?? []), handler]),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of Array.isArray(ids) ? ids : [ids]) buttons.set(id, handler);
    },
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      if (ultimate && name === 'item-sets:can-pack') {
        payload.allow = false;
        payload.player.sendMessage('Ultimate Ironmen cannot pack item sets.');
      }
    },
  });
  function player() {
    const calls = [], messages = [];
    let interfaceId = -1;
    const sender = new Proxy({}, { get: (_, method) => (...args) => {
      calls.push([method, ...args]);
      if (method === 'sendInterfaceRemoval') interfaceId = -1;
      return sender;
    } });
    const p = {
      calls, messages, getUsername: () => 'set-trader',
      dialogueResets: 0, getDialogueManager: () => ({ reset() { p.dialogueResets++; } }),
      busy: () => false, getMovementQueue: () => ({ reset() {} }),
      getSkillManager: () => ({ stopSkillable() {} }),
      getInterfaceId: () => interfaceId, setInterfaceId: (id) => { interfaceId = id; },
      getPacketSender: () => sender, sendMessage: (message) => messages.push(message),
    };
    const inventory = new Inventory(p);
    p.getInventory = () => inventory;
    return p;
  }
  const open = (p) => npcs.get('Grand Exchange Clerk').Sets({ player: p });
  const pack = (p, recipe, extra = {}) => buttons.get(PACK)({
    player: p, buttonId: PACK, slot: recipe.slot, itemId: recipe.setId, action: 1, ...extra,
  });
  const unpack = (p, id, extra = {}) => buttons.get(UNPACK)({
    player: p, buttonId: UNPACK,
    slot: p.getInventory().getItems().findIndex((item) => item.getId() === id),
    itemId: id, action: 1, ...extra,
  });
  const emit = (name, payload) => { for (const handler of events.get(name) ?? []) handler(payload); };
  return { npcs, objects, buttons, emitted, emit, player, open, pack, unpack };
}

const snapshot = (p) => p.getInventory().getItems().map((item) => [item.getId(), item.getAmount()]);
function counts(p) {
  const result = new Map();
  for (const item of p.getInventory().getValidItems()) result.set(item.getId(), (result.get(item.getId()) ?? 0) + item.getAmount());
  return [...result].sort(([a], [b]) => a - b);
}
function expected(ids) {
  const result = new Map();
  for (const id of ids) result.set(id, (result.get(id) ?? 0) + 1);
  return [...result].sort(([a], [b]) => a - b);
}
function give(p, ids) {
  for (const id of ids) p.getInventory().add(new Item(id, 1), false);
}

test('Sets actions open the native main and side interfaces with their own operation flags', () => {
  const h = harness(), p = h.player();
  assert.equal(typeof h.npcs.get('Grand Exchange Clerk')?.Sets, 'function');
  assert.equal(typeof h.objects.get('Grand Exchange booth')?.Sets, 'function');
  assert.equal(typeof h.buttons.get(PACK), 'function');
  assert.equal(typeof h.buttons.get(UNPACK), 'function');
  h.objects.get('Grand Exchange booth').Sets({ player: p });
  assert.equal(p.getInterfaceId(), MAIN);
  assert.ok(p.calls.some(([name, parent, group, type]) => name === 'sendSubInterface' && parent === ((161 << 16) | 16) && group === MAIN && type === 0));
  assert.ok(p.calls.some(([name, parent, group, type]) => name === 'sendSubInterface' && parent === ((161 << 16) | 74) && group === SIDE && type === 3));
  const lastSlot = Math.max(...recipes().map((recipe) => recipe.slot));
  assert.ok(p.calls.some(([name, uid, first, last, flags]) => name === 'sendInterfaceFlagsRange' && uid === PACK && first === 0 && last === lastSlot && flags === OP1_AND_EXAMINE));
  assert.ok(p.calls.some(([name, uid, first, last, flags]) => name === 'sendInterfaceFlagsRange' && uid === UNPACK && first === 0 && last === 27 && flags === OP1_AND_EXAMINE));
  assert.ok(p.calls.some(([name]) => name === 'sendItemContainer'), 'the real inventory is refreshed');
});

test("the clerk's Talk-to item sets choice closes the chat and opens item sets", () => {
  const h = harness(), p = h.player();
  const action = { player: p, action: 'open_interface', target: 'Item Sets', handled: false };
  h.emit('npc-dialogue:action', action);
  assert.equal(action.handled, true);
  assert.equal(p.dialogueResets, 1);
  assert.equal(p.calls[0][0], 'sendInterfaceRemoval');
  assert.equal(p.getInterfaceId(), MAIN);

  const other = { player: h.player(), action: 'open_interface', target: 'Grand Exchange', handled: false };
  h.emit('npc-dialogue:action', other);
  assert.equal(other.handled, false);
});

test('every native cache recipe packs and unpacks, including all available noted variants', () => {
  const h = harness(), reverse = core.CacheDefinitions.getEnumValues(1034);
  assert.ok(recipes().length > 100, 'exercise the native catalogue rather than a hand-picked list');
  for (const recipe of recipes()) {
    const label = `slot ${recipe.slot}, set ${recipe.setId}`;
    assert.equal(reverse.get(recipe.setId), recipe.enumId, label);
    const p = h.player();
    h.open(p);
    give(p, recipe.components);
    h.pack(p, recipe);
    const packedId = recipe.components.every((id) => core.ItemDefinition.forId(id).isStackable()) ? note(recipe.setId) : recipe.setId;
    assert.deepEqual(counts(p), [[packedId, 1]], `unnoted pack: ${label}`);
    h.unpack(p, packedId);
    assert.deepEqual(counts(p), expected(recipe.components), `unnoted unpack: ${label}`);

    const noted = h.player();
    h.open(noted);
    give(noted, [note(recipe.setId)]);
    h.unpack(noted, note(recipe.setId));
    assert.deepEqual(counts(noted), expected(recipe.components.map(note)), `noted unpack: ${label}`);
    if (recipe.components.every((id) => note(id) !== id)) {
      h.pack(noted, recipe, { action: undefined, opId: 1, itemId: undefined });
      assert.deepEqual(counts(noted), [[note(recipe.setId), 1]], `noted pack: ${label}`);
    }
  }
});

test('mixed or incomplete components remain untouched and explain why they cannot be packed', () => {
  const h = harness(), recipe = recipes()[0];
  for (const ids of [recipe.components.slice(1), recipe.components.map((id, index) => index ? id : note(id))]) {
    const p = h.player();
    h.open(p);
    give(p, ids);
    const before = snapshot(p), messages = p.messages.length;
    h.pack(p, recipe);
    assert.deepEqual(snapshot(p), before);
    assert.ok(p.messages.length > messages, 'the missing complete noted/unnoted set is explained');
  }
});

test('stackable god pages pack into noted sets, including an existing stack in a full inventory', () => {
  const h = harness();
  const pageSets = recipes().filter((recipe) => recipe.components.every((id) => core.ItemDefinition.forId(id).isStackable()));
  assert.equal(pageSets.length, 6, 'all six native god-page recipes');
  for (const recipe of pageSets) {
    const p = h.player();
    h.open(p);
    give(p, [...recipe.components, ...recipe.components, note(recipe.setId), ...Array(23).fill(core.ItemIdentifiers.BONES)]);
    assert.equal(p.getInventory().getFreeSlots(), 0);
    h.pack(p, recipe);
    assert.deepEqual(counts(p), expected([...recipe.components, note(recipe.setId), note(recipe.setId), ...Array(23).fill(core.ItemIdentifiers.BONES)]));
    h.pack(p, recipe);
    assert.equal(p.getInventory().getAmount(note(recipe.setId)), 3);
    assert.equal(p.getInventory().getAmount(recipe.setId), 0);
    h.unpack(p, note(recipe.setId));
    assert.deepEqual(counts(p), expected([...recipe.components, note(recipe.setId), note(recipe.setId), ...Array(23).fill(core.ItemIdentifiers.BONES)]));
  }
});

test('unpacking uses the exact post-removal capacity and changes nothing when it cannot fit', () => {
  const h = harness(), recipe = recipes()[0], filler = core.ItemIdentifiers.BONES;
  for (const room of [recipe.components.length - 1, recipe.components.length]) {
    const p = h.player();
    h.open(p);
    give(p, [recipe.setId, ...Array(28 - room).fill(filler)]);
    const before = snapshot(p);
    h.unpack(p, recipe.setId);
    if (room < recipe.components.length) {
      assert.deepEqual(snapshot(p), before, 'insufficient room cannot consume the box or add partial pieces');
    } else {
      assert.equal(p.getInventory().getFreeSlots(), 0);
      assert.deepEqual(counts(p), expected([...recipe.components, ...Array(28 - room).fill(filler)]));
    }
  }
  const noted = h.player();
  h.open(noted);
  noted.getInventory().add(new Item(note(recipe.setId), 2), false);
  give(noted, Array(27).fill(filler));
  const before = snapshot(noted);
  h.unpack(noted, note(recipe.setId));
  assert.deepEqual(snapshot(noted), before, 'consuming one of two noted boxes frees no inventory slot');
});

test('noted packing and unpacking reject full inventories and output stack overflow atomically', () => {
  const h = harness(), recipe = recipes()[0], filler = core.ItemIdentifiers.BONES;
  const full = h.player();
  h.open(full);
  for (const id of recipe.components.map(note)) full.getInventory().add(new Item(id, 2), false);
  give(full, Array(28 - recipe.components.length).fill(filler));
  let before = snapshot(full);
  h.pack(full, recipe);
  assert.deepEqual(snapshot(full), before, 'remaining component notes keep all slots occupied');

  const packOverflow = h.player();
  h.open(packOverflow);
  give(packOverflow, recipe.components.map(note));
  packOverflow.getInventory().add(new Item(note(recipe.setId), MAX_STACK), false);
  before = snapshot(packOverflow);
  h.pack(packOverflow, recipe);
  assert.deepEqual(snapshot(packOverflow), before, 'a maximum noted-box stack cannot silently discard the new set');

  const unpackOverflow = h.player();
  h.open(unpackOverflow);
  give(unpackOverflow, [note(recipe.setId)]);
  unpackOverflow.getInventory().add(new Item(note(recipe.components[0]), MAX_STACK), false);
  before = snapshot(unpackOverflow);
  h.unpack(unpackOverflow, note(recipe.setId));
  assert.deepEqual(snapshot(unpackOverflow), before, 'an overflowing noted-piece stack cannot consume its source box');
});

test('closed interfaces, forged slots and mismatched item ids cannot exchange inventory items', () => {
  const h = harness(), recipe = recipes()[0], p = h.player();
  h.open(p);
  give(p, recipe.components);
  const before = snapshot(p);
  for (const extra of [{ slot: -1 }, { slot: Math.max(...recipes().map((r) => r.slot)) + 1 },
    { slot: 0.5 }, { slot: NaN }, { itemId: recipe.components[0] }, { action: 99 }]) {
    h.pack(p, recipe, extra);
    assert.deepEqual(snapshot(p), before);
  }
  p.setInterfaceId(-1);
  h.pack(p, recipe);
  assert.deepEqual(snapshot(p), before);

  const box = h.player();
  h.open(box);
  give(box, [recipe.setId]);
  const boxed = snapshot(box);
  for (const extra of [{ slot: -1 }, { slot: 28 }, { slot: 0.5 }, { slot: 1 },
    { itemId: recipe.components[0] }, { action: 99 }]) {
    h.unpack(box, recipe.setId, extra);
    assert.deepEqual(snapshot(box), boxed);
  }
  box.setInterfaceId(-1);
  h.unpack(box, recipe.setId);
  assert.deepEqual(snapshot(box), boxed);
  h.open(box);
  h.unpack(box, recipe.setId, { action: undefined, opId: 1, itemId: undefined });
  assert.deepEqual(counts(box), expected(recipe.components), 'native opId works without an optional item-id hint');
});

test('free worlds refuse members sets while free sets still exchange normally', () => {
  const h = harness({ members: false });
  const members = recipes().find((recipe) => core.CacheDefinitions.getItem(recipe.setId).isMembers);
  const free = recipes().find((recipe) => !core.CacheDefinitions.getItem(recipe.setId).isMembers);
  assert.ok(members && free);
  for (const recipe of [members, free]) {
    const p = h.player();
    h.open(p);
    give(p, recipe.components);
    const before = snapshot(p);
    h.pack(p, recipe);
    if (recipe === members) assert.deepEqual(snapshot(p), before);
    else assert.deepEqual(counts(p), [[recipe.setId, 1]]);
    const box = h.player();
    h.open(box);
    give(box, [recipe.setId]);
    const boxed = snapshot(box);
    h.unpack(box, recipe.setId);
    if (recipe === members) assert.deepEqual(snapshot(box), boxed);
    else assert.deepEqual(counts(box), expected(recipe.components));
  }
});

test('the Ultimate Ironman permission event can block packing without blocking viewing or unpacking', () => {
  const h = harness({ ultimate: true }), recipe = recipes()[0], p = h.player();
  h.open(p);
  assert.equal(p.getInterfaceId(), MAIN, 'Ultimate Ironmen may view set contents');
  give(p, recipe.components);
  const before = snapshot(p);
  h.pack(p, recipe);
  assert.deepEqual(snapshot(p), before);
  assert.ok(h.emitted.some(([name, payload]) => name === 'item-sets:can-pack' && payload.player === p && payload.allow === false));
  assert.ok(p.messages.length > 0);
  const box = h.player();
  h.open(box);
  give(box, [recipe.setId]);
  h.unpack(box, recipe.setId);
  assert.deepEqual(counts(box), expected(recipe.components));
});
