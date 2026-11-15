// node --test tests/freeze-resistance.test.cjs
// Freeze resistance (OSRS Wiki: Freeze): a monster's resistance shortens a freeze by that percentage and 100% means
// it is never frozen even when the spell lands. The value is the Wiki infobox's `freezeresistance`, exported per NPC
// by osrsreboxed-db (docs/npc-status-immunities.json `freeze_resistance`) and read by NpcDefinitionLoader.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server"); Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { TimerKey } = require("../dist/util/timers/TimerKey");

before(async () => {
  await CachePipeline.initialize(process.cwd());
  new NpcDefinitionLoader().load();
});

/** A freezable stand-in with the surface freezeTicks uses; `resistance` goes through the real definition. */
function target({ resistance = 0, size = 1, npc = true, unfreezable = false, area = null, existing = [] } = {}) {
  const definition = Object.assign(new NpcDefinition(), { freezeResistance: resistance });
  const timers = new Map(existing);
  const effects = { movement: 0, messages: [], effectTimers: [] };
  const registered = [];
  return {
    registered, effects, timers,
    isNpc: () => npc,
    isPlayer: () => !npc,
    getAsNpc() { return this; },
    getAsPlayer() { return this; },
    getCurrentDefinition: () => definition,
    getSize: () => size,
    getArea: () => area,
    hasFlag: (name) => unfreezable && name === "combat:unfreezable",
    getTimers: () => ({
      has: (key) => timers.has(key),
      registers: (key, ticks) => { timers.set(key, ticks); registered.push([key, ticks]); },
    }),
    getMovementQueue: () => ({ reset() { effects.movement++; } }),
    getPacketSender: () => ({ sendEffectTimer(...args) { effects.effectTimers.push(args); } }),
    sendMessage(message) { effects.messages.push(message); },
    ticks: () => timers.get(TimerKey.FREEZE),
  };
}

test("the loader reads freeze_resistance as a whole percentage and ignores anything else", () => {
  const read = (record, name = "Fixture") => {
    const definition = new NpcDefinition();
    NpcDefinitionLoader.applyStatusImmunities(definition, name, record);
    return definition.getFreezeResistance();
  };
  assert.equal(read({ name: "Fixture", freeze_resistance: 50 }), 50);
  assert.equal(read({ name: "Fixture", freeze_resistance: 100 }), 100);
  assert.equal(read({ name: "Fixture", freeze_resistance: 250 }), 100);
  assert.equal(read({ name: "Fixture", freeze_resistance: -5 }), 0);
  assert.equal(read({ name: "Fixture", freeze_resistance: "50" }), 0);
  assert.equal(read({ name: "Fixture", freeze_resistance: 33.5 }), 0);
  assert.equal(read({ name: "Fixture" }), 0, "a record from before the field");
  assert.equal(read({ name: "Other", freeze_resistance: 50 }), 0, "another cache name is not this NPC");
});

test("a freeze is shortened by the resistance, never below one tick", () => {
  for (const [resistance, expected] of [[0, 20], [20, 16], [33, 13], [50, 10], [60, 8], [99, 1]]) {
    const npc = target({ resistance });
    CombatFactory.freezeTicks(npc, 20);
    assert.equal(npc.ticks(), expected, `${resistance}%`);
  }
});

test("100% resistance is never frozen: no timer, no frozen event", () => {
  const events = [];
  PluginManager.createApi("FreezeResistanceProbe").onCustomEvent("combat:frozen", (event) => events.push(event));
  const npc = target({ resistance: 100 });
  CombatFactory.freezeTicks(npc, 20);
  assert.deepEqual(npc.registered, []);
  assert.deepEqual(events.filter((event) => event.target === npc), []);
  const free = target({ resistance: 0 });
  CombatFactory.freezeTicks(free, 20);
  assert.equal(events.filter((event) => event.target === free).length, 1, "the probe sees a landed freeze");
});

test("size alone resists nothing: a large NPC freezes by its resistance like any other (Wiki: Freeze)", () => {
  // General Graardor (size 4, no resistance on the Wiki) has "Ourg Freezer": kill him "whilst he is immobilized".
  const plain = target({ size: 4 });
  CombatFactory.freezeTicks(plain, 20);
  assert.equal(plain.ticks(), 20, "size 4, no resistance: frozen for the whole duration");
  const immune = target({ size: 5, resistance: 100 });
  CombatFactory.freezeTicks(immune, 20);
  assert.deepEqual(immune.registered, [], "100% still never frozen");
  const partial = target({ size: 5, resistance: 40 });
  CombatFactory.freezeTicks(partial, 20);
  assert.equal(partial.ticks(), 12, "40% resistance: frozen for 60% of the duration");
});

test('an NPC its page makes immune ("combat:unfreezable": Tekton, the DT2 Ancient Guardian) is never frozen, whatever its resistance', () => {
  const events = [];
  PluginManager.createApi("FreezeUnfreezableProbe").onCustomEvent("combat:frozen", (event) => events.push(event));
  for (const size of [1, 4]) {
    let policyCalls = 0;
    const npc = target({ size, unfreezable: true, area: { canFreeze() { policyCalls++; return true; } } });
    CombatFactory.freezeTicks(npc, 20, null, null, "bind");
    assert.deepEqual(npc.registered, [], `size ${size}`);
    assert.equal(policyCalls, 0, "explicit immunity returns before the target-area policy");
    assert.deepEqual(events.filter((event) => event.target === npc), []);
  }
});

test("a player is unaffected", () => {
  const player = target({ npc: false, resistance: 100 });
  CombatFactory.freezeTicks(player, 20, null);
  assert.equal(player.ticks(), 20);
});

test("a listener that already models the resistance is not applied twice (Phantom Muspah: 33% = 66% of the duration)", () => {
  PluginManager.createApi("FreezeResistanceExact").onCustomEvent("combat:freeze-duration", (event) => {
    if (event.target.exact) { event.ticks *= 0.5; event.resisted = true; }
  });
  const npc = Object.assign(target({ resistance: 50 }), { exact: true });
  CombatFactory.freezeTicks(npc, 20);
  assert.equal(npc.ticks(), 10, "the listener's 50% only, not 25%");
});

test("the exported data reaches real definitions: Wiki infobox values by NPC id", () => {
  const resistance = (id) => NpcDefinition.forId(id).getFreezeResistance();
  for (const [id, expected, what] of [
    [7221, 50, "Scurrius (public)"], [7222, 50, "Scurrius (private)"],
    [12077, 33, "Phantom Muspah, ranged"], [12079, 33, "Phantom Muspah, shielded"],
    [12377, 50, "Scarred imp"], [12335, 50, "Wighted Leech"],
    [14017, 100, "Hueycoatl body"], [13011, 100, "Blood Moon"], [13013, 100, "Blue Moon"],
    [3129, 0, "K'ril Tsutsaroth (no resistance on the Wiki)"],
  ]) assert.equal(resistance(id), expected, what);
});


// F: actual factory boundary with supplied Mobile surfaces, not native attacks.
test('F only literal false from the target area prevents all new freeze side effects',()=>{
  const events=[],api=PluginManager.createApi('FreezeAreaBoundary');
  for(const name of ['combat:freeze-duration','combat:frozen'])api.onCustomEvent(name,e=>events.push([name,e.target]));
  for(const answer of [false,null,undefined,true,0,'']){
    const calls=[],source={getArea(){throw Error('source area must not vote');}};
    const area={canFreeze(t,s){calls.push([t,s]);return answer;}};
    const player=target({npc:false,area});
    CombatFactory.freezeTicks(player,8,undefined,source);
    assert.deepEqual(calls,[[player,source]]);
    assert.equal(player.ticks(),answer===false?undefined:8,String(answer));
    assert.equal(player.effects.movement,answer===false?0:1);
    assert.equal(player.effects.messages.length,answer===false?0:1);
    assert.equal(player.effects.effectTimers.length,answer===false?0:1);
    assert.equal(events.filter(([,t])=>t===player).length,answer===false?0:2);
    assert.deepEqual(player.registered,answer===false?[]:[[TimerKey.FREEZE,8],[TimerKey.FREEZE_IMMUNITY,13]]);
  }
});
test('F absent and inherited neutral policy preserve legacy duration and aftermath',()=>{
  const {Area}=require('../dist/game/model/areas/Area');
  for(const area of [null,{},Object.create(Area.prototype)]){
    const player=target({npc:false,area});CombatFactory.freezeTicks(player,32,null);
    assert.deepEqual(player.registered,[[TimerKey.FREEZE,32],[TimerKey.FREEZE_IMMUNITY,37]]);
    assert.equal(player.effects.movement,1);assert.deepEqual(player.effects.messages,[]);
    assert.equal(player.effects.effectTimers.length,1);
  }
});
test('F existing freeze or immunity returns before policy and preserves exact state',()=>{
  for(const key of [TimerKey.FREEZE,TimerKey.FREEZE_IMMUNITY]){
    const state={remaining:7},area={canFreeze(){throw Error('existing state must return before policy');}};
    const player=target({npc:false,area,existing:[[key,state]]});CombatFactory.freezeTicks(player,32);
    assert.equal(player.timers.get(key),state);assert.deepEqual(state,{remaining:7});
    assert.deepEqual(player.registered,[]);assert.deepEqual(player.effects,{movement:0,messages:[],effectTimers:[]});
  }
});
test('F true policy still obeys canonical resistance and duration clamp',()=>{
  const area={canFreeze:()=>true};
  const immune=target({resistance:100,area});CombatFactory.freezeTicks(immune,20);assert.deepEqual(immune.registered,[]);
  const partial=target({resistance:50,area});CombatFactory.freezeTicks(partial,20);assert.equal(partial.ticks(),10);
  const zero=target({area});CombatFactory.freezeTicks(zero,0);assert.equal(zero.ticks(),1,'zero duration is not a veto');
});

test('F actual Muspah registered duration handler passes through neutral factory once, with nonmatching controls', () => {
  const { Area } = require('../dist/game/model/areas/Area');
  const unitRoot = require('node:path').resolve(__dirname, '../plugins/bosses/phantommuspah') + require('node:path').sep;
  const oldModules = new Map(Object.entries(require.cache).filter(([file]) => file.startsWith(unitRoot)));
  // Isolate the genuine units' module-local Common initialization from any prior
  // import. No boss, session, attack or scheduled fight callback is executed.
  for (const file of oldModules.keys()) delete require.cache[file];
  const customBefore = PluginManager.customEventHooks.get('combat:freeze-duration');
  const savedCustom = customBefore?.slice();
  const registries = ['npcCombatMethodProviders', 'npcHitModifyHooks', 'npcBeforeDeathHooks'];
  const before = new Map(registries.map(key => [key, PluginManager[key].slice()]));
  try {
    const Common = require('../plugins/bosses/phantommuspah/Common.PhantomMuspah');
    const Fight = require('../plugins/bosses/phantommuspah/Fight.PhantomMuspah');
    const api = PluginManager.createApi('FreezeFactoryActualMuspah');
    Common.init(api); // Loads the real plugin data; no copied ids or listener formula.
    Fight.attachFight(api);
    assert.equal(PluginManager.customEventHooks.get('combat:freeze-duration').length, (savedCustom?.length ?? 0) + 1);
    const durations = [];
    api.onCustomEvent('combat:freeze-duration', event => durations.push({ target: event.target, ticks: event.ticks, resisted: event.resisted }));
    for (const form of ['ranged', 'melee', 'shielded', 'final']) {
      const npc = Object.assign(target({ npc: true, resistance: 33, size: 3, area: Object.create(Area.prototype) }), {
        getId: () => Common.data.npcs[form],
      });
      CombatFactory.freezeTicks(npc, 20);
      const event = durations.find(row => row.target === npc);
      assert.ok(event, form + ': actual factory emitted the duration event');
      assert.equal(event.ticks, 20 * 0.66, form + ': actual Muspah handler adjusted duration');
      assert.equal(event.resisted, true, form + ': canonical resistance is already modeled');
      assert.equal(npc.ticks(), 13, form + ': floor13, not a second 33% reduction');
      assert.deepEqual(npc.registered, [[TimerKey.FREEZE, 13], [TimerKey.FREEZE_IMMUNITY, 18]]);
      assert.equal(npc.effects.movement, 1);
    }
    for (const [label, id] of [['teleport', Common.data.npcs.teleport], ['nonmatching supplied id', -1]]) {
      // Supplied eligible neutral NPC surfaces isolate handler nonmatching behavior;
      // they do not claim a spawned teleport-form fight accepts normal targeting.
      const npc = Object.assign(target({ npc: true, resistance: 0, size: 1, area: Object.create(Area.prototype) }), { getId: () => id });
      CombatFactory.freezeTicks(npc, 20);
      const event = durations.find(row => row.target === npc);
      assert.ok(event, label);assert.equal(event.ticks, 20, label);assert.equal(event.resisted, false, label);
      assert.deepEqual(npc.registered, [[TimerKey.FREEZE, 20], [TimerKey.FREEZE_IMMUNITY, 25]]);
    }
  } finally {
    if (savedCustom) PluginManager.customEventHooks.set('combat:freeze-duration', savedCustom);
    else PluginManager.customEventHooks.delete('combat:freeze-duration');
    for (const [key, saved] of before) PluginManager[key].splice(0, PluginManager[key].length, ...saved);
    for (const file of Object.keys(require.cache)) if (file.startsWith(unitRoot)) delete require.cache[file];
    for (const [file, module] of oldModules) require.cache[file] = module;
  }
  assert.deepEqual(PluginManager.customEventHooks.get('combat:freeze-duration'), savedCustom);
  for (const [key, saved] of before) assert.deepEqual(PluginManager[key], saved);
});
