const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Shared = require('../plugins/minigames/guardiansoftherift/Shared.GuardiansOfTheRift');
const Records = require('../plugins/minigames/guardiansoftherift/Records.GuardiansOfTheRift');
let variant, condition, itemUse, inspect;
const custom = new Map();
const api = new Proxy({
  core: PluginManager.getCoreApi(),
  onNpcDialogueVariant: handler => { variant = handler; },
  onNpcDialogueCondition: handler => { condition = handler; },
  onItemOnNpc: handler => { itemUse = handler; },
  onItemAction: (name, actions) => { if (name === "Tarnished locket") inspect = actions.Inspect; },
  onCustomEvent: (name, handler) => custom.set(name, [...(custom.get(name) ?? []), handler]),
  emitCustomEvent(name, event) { if (name === 'quest:is-complete') event.complete = event.key === 'temple_of_the_eye' && event.player.questDone; for (const handler of custom.get(name) ?? []) handler(event); },
}, { get: (target, key) => target[key] ?? (() => {}) });
before(async () => {
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  Shared.bind(api);
  require('../plugins/npcs/LumbridgeGuide.plugin').register(api);
  require('../plugins/minigames/guardiansoftherift/Amulet.GuardiansOfTheRift').attach(api);
});
function player({ unlocked = false, questDone = true, free = 1, ownedAt, ownedId = 26914 } = {}) {
  const attributes = new Map();
  const items = new Map();
  const sender = { sendVarbit: () => sender };
  if (ownedAt === 'inventory') items.set(ownedId, 1);
  const p = {
    questDone, messages: [],
    getAttribute: key => attributes.get(key), setAttribute: (key,value) => attributes.set(key,value),
    getInventory: () => ({ contains: id => items.has(id), getFreeSlots: () => free, adds: (id,n) => { items.set(id,(items.get(id)||0)+n); return true; }, deleteNumber: id => items.delete(id) }),
    getEquipment: () => ({ contains: id => ownedAt === 'equipment' && id === ownedId }),
    getBanks: () => ownedAt === 'bank' ? [{ contains: id => id === ownedId }] : [],
    getPacketSender: () => sender, sendMessage: text => p.messages.push(text), items,
  };
  if (unlocked) Records.setSetting(p, 'gotr_amulet_of_the_eye_obtained', 1);
  return p;
}
const event = p => ({ player: p, definition: { getName: () => 'Lumbridge Guide' }, pages: [{ page: 'Lumbridge Guide' }] });
const reclaim = p => { const r = { ...event(p), kind: 'message', stepId: 'xm3rMD' }; api.emitCustomEvent('npc-dialogue:action',r); return r; };
test('Guide offers recovery only after the actual amulet unlock and quest completion', () => {
  for (const p of [player(), player({ unlocked:true, questDone:false })]) {
    assert.match(variant(event(p)).variant, /still-has.*not-unlocked/);
    const denied = reclaim(p);assert.equal(denied.end,true);assert.equal(p.items.has(26914),false);
  }
  assert.match(variant(event(player({unlocked:true}))).variant, /lost-the-amulet/);
});
test('regular and recoloured amulets in inventory, equipment or bank suppress recovery', () => {
  for (const ownedId of [26914,26990,26992,26994]) for (const ownedAt of ['inventory','equipment','bank']) {
    const p=player({unlocked:true,ownedAt,ownedId});assert.match(variant(event(p)).variant,/still-has/);
    const denied=reclaim(p);assert.equal(denied.end,true);assert.equal(p.items.get(26914)??0,ownedAt==='inventory'&&ownedId===26914?1:0);
  }
});
test('space condition and handout recheck prevent a false full warning, duplicates and stale claims', () => {
  const p=player({unlocked:true});
  assert.equal(condition({...event(p),stepId:'9nafop'}),false);
  const granted=reclaim(p);assert.equal(p.items.get(26914),1);assert.deepEqual(granted.box,{items:[26914]});
  reclaim(p);assert.equal(p.items.get(26914),1);
  const full=player({unlocked:true,free:0});assert.equal(condition({...event(full),stepId:'9nafop'}),true);assert.equal(reclaim(full).end,true);assert.equal(full.items.size,0);
});
test('legitimate locket exchange establishes the persisted unlock and frees its occupied slot', () => {
  const p=player({free:0});p.items.set(26910,1);inspect({player:p});
  const exchange={...event(p),kind:'message',stepId:'HnwS8y'};
  api.emitCustomEvent('npc-dialogue:action',exchange);
  assert.equal(p.items.has(26910),false);assert.equal(p.items.get(26914),1);
  assert.equal(Records.setting(p,'gotr_amulet_of_the_eye_obtained'),1);
});

test('an uninspected locket cannot be exchanged and another page cannot trigger the handout', () => {
  const p=player();p.items.set(26910,1);
  const uninspected={...event(p),kind:'message',stepId:'HnwS8y'};
  api.emitCustomEvent('npc-dialogue:action',uninspected);
  assert.equal(uninspected.end,true);assert.equal(p.items.has(26910),true);assert.equal(p.items.has(26914),false);
  const other={...event(player({unlocked:true})),pages:[{page:'Other NPC'}],kind:'message',stepId:'xm3rMD'};
  api.emitCustomEvent('npc-dialogue:action',other);assert.equal(other.handled,undefined);
});
