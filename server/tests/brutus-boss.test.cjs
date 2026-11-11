// From server/: node --test tests/brutus-boss.test.cjs (after yarn build and yarn ensure-cache).
//
// Brutus beyond the quest fight (plugins/bosses/Brutus.plugin.js): the Wiki's Slayer experience (116), the item
// messages, the Cow31337Killer message and Demonic Brutus's second phase. The plugins are loaded the way the server loads
// them (PluginManager.loadFromDirectory) and driven through the real dispatch (item on NPC, custom event, NPC death);
// the player and NPC are light fakes. Other plugins' hooks (drops, the quest) run on those fakes too and may log errors.
// The quest plugin's own Demonic changes are in tests/ides-of-milk-parity.test.cjs. Wiki numbers; no capture was found.
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PluginManager.emitServerStartup({});
});
after(() => PluginManager.emitServerShutdown({}));

function player(worn = []) {
  const messages = [];
  const p = {
    messages, isPlayer: () => true, sendMessage: text => messages.push(text),
    // What the quest plugin's own item-on-NPC handler reads when the potato is used.
    getAttribute: () => undefined, setAttribute() {}, getInventory: () => ({ getAmount: () => 0 }),
    getEquipment: () => ({ getItems: () => worn.map(id => ({ getId: () => id })) }),
  };
  return p;
}
/** An item used on an NPC as the dispatch builds it: the hook ignores an event without a target and an item. */
function use(p, id, itemId) { return { player: p, target: npc(id), npcId: id, item: { getId: () => itemId }, itemId, handled: false }; }
function npc(id) {
  const n = { id, said: [], hp: 100, getId: () => id, setHitpoints: value => { n.hp = value; }, forceChat: text => n.said.push(text) };
  return n;
}
const OUTFIT = [I.RUNE_BOOTS, I.RUNE_PLATEBODY, I.RUNE_PLATESKIRT, I.KLANKS_GAUNTLETS, I.DHAROKS_HELM, I.DHAROKS_GREATAXE];

test('an item used on Brutus is refused with his message; an empty bucket with the bucket message; the potato and others are not claimed', () => {
  const p = player();
  for (const id of [N.BRUTUS, N.BRUTUS_2]) {
    const event = use(p, id, I.COINS);
    assert.equal(PluginManager.emitItemOnNpc(event), true, `npc ${id}`);
    assert.equal(p.messages.at(-1), "Brutus doesn't want that.");
  }
  const before = p.messages.length;
  const bucket = use(p, N.BRUTUS, I.BUCKET);
  PluginManager.emitItemOnNpc(bucket);
  assert.equal(bucket.handled, true);
  assert.equal(p.messages.at(-1), 'You do not want to do that.');
  const potato = use(p, N.BRUTUS, I.ABYSSAL_POTATO);
  PluginManager.emitItemOnNpc(potato);
  assert.equal(potato.handled, true, "the quest plugin's own potato handling answers it");
  assert.ok(!p.messages.slice(before).includes("Brutus doesn't want that."), 'not with Brutus\'s refusal');
  const settled = p.messages.length;
  const cow = use(p, 2793, I.COINS);
  PluginManager.emitItemOnNpc(cow);
  assert.equal(cow.handled, false, 'another NPC');
  const demonic = use(p, N.DEMONIC_BRUTUS, I.COINS);
  PluginManager.emitItemOnNpc(demonic);
  assert.equal(demonic.handled, false, 'the Wiki gives the message for Brutus only');
  assert.equal(p.messages.length, settled, 'nothing was said for the controls');
});

test("Brutus' Slayer experience is 116 (twice his Hitpoints), for Brutus only", () => {
  const p = player();
  const kill = (id, xp) => { const event = { player: p, npc: npc(id), xp }; PluginManager.emitCustomEvent('slayer:task-kill', event); return event.xp; };
  assert.equal(kill(N.BRUTUS, 58), 116);
  assert.equal(kill(N.BRUTUS_2, 60), 116, 'the charging form too');
  assert.equal(kill(2793, 8), 8, 'an ordinary cow');
  assert.equal(kill(N.DEMONIC_BRUTUS, 750), 750, 'Demonic Brutus is no Cows task');
});

test("killing Brutus or Demonic Brutus in Cow31337Killer's outfit prints the Wiki's message, and only the whole outfit does", () => {
  for (const id of [N.BRUTUS, N.BRUTUS_2, N.DEMONIC_BRUTUS, N.DEMONIC_BRUTUS_2]) {
    const full = player(OUTFIT);
    PluginManager.emitNpcDeath({ killer: full, npc: npc(id), npcId: id });
    assert.deepEqual(full.messages, ['You are but an imitation of a true legend.'], `npc ${id}`);
  }
  for (let missing = 0; missing < OUTFIT.length; missing++) {
    const partial = player(OUTFIT.filter((_, i) => i !== missing));
    PluginManager.emitNpcDeath({ killer: partial, npc: npc(N.BRUTUS), npcId: N.BRUTUS });
    assert.deepEqual(partial.messages, [], `without piece ${missing}`);
  }
  const plain = player();
  PluginManager.emitNpcDeath({ killer: plain, npc: npc(N.BRUTUS), npcId: N.BRUTUS });
  assert.deepEqual(plain.messages, []);
  const cow = player(OUTFIT);
  PluginManager.emitNpcDeath({ killer: cow, npc: npc(2793), npcId: 2793 });
  assert.deepEqual(cow.messages, [], 'another NPC');
});

test('degraded Dharok pieces count for the outfit (the cache names them "Dharok\'s helm 75" and so on)', () => {
  const p = player([I.RUNE_BOOTS, I.RUNE_PLATEBODY, I.RUNE_PLATESKIRT, I.KLANKS_GAUNTLETS, I.DHAROKS_HELM_75, I.DHAROKS_GREATAXE_50]);
  PluginManager.emitNpcDeath({ killer: p, npc: npc(N.BRUTUS), npcId: N.BRUTUS });
  assert.deepEqual(p.messages, ['You are but an imitation of a true legend.']);
});

test('Demonic Brutus heals 487 and shouts "moo moo!" instead of dying the first time; the second time he dies', () => {
  const boss = npc(N.DEMONIC_BRUTUS);
  boss.hp = 0;
  assert.equal(PluginManager.emitNpcBeforeDeath({ npc: boss, preventDeath: false }), true, 'phase one is not the end');
  assert.equal(boss.hp, 487);
  assert.deepEqual(boss.said, ['moo moo!']);
  boss.hp = 0;
  assert.equal(PluginManager.emitNpcBeforeDeath({ npc: boss, preventDeath: false }), false, 'phase two ends the fight');
  assert.equal(boss.hp, 0);
  assert.deepEqual(boss.said, ['moo moo!'], 'no second shout');
  const other = npc(N.DEMONIC_BRUTUS);
  other.hp = 0;
  assert.equal(PluginManager.emitNpcBeforeDeath({ npc: other, preventDeath: false }), true, 'each fight has its own phases');
});

test('controls: Brutus himself and other NPCs die as usual at 0 Hitpoints', () => {
  for (const id of [N.BRUTUS, N.BRUTUS_2, N.DEMONIC_BRUTUS_2, 2793]) {
    const other = npc(id);
    other.hp = 0;
    assert.equal(PluginManager.emitNpcBeforeDeath({ npc: other, preventDeath: false }), false, `npc ${id}`);
    assert.equal(other.hp, 0);
    assert.deepEqual(other.said, []);
  }
});
