// EchoBosses' own modules: Actors dresses a real normal boss NPC from the real cache and the
// generated Wiki profile; Sessions accepts, marks and completes an encounter once; Loot rolls
// the Echo equipment with its first-copy guarantee.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const core = require('../dist/plugins/PluginManager').PluginManager.getCoreApi();
const Actors = require('../plugins/modes/echobosses/Actors.EchoBosses');
const Sessions = require('../plugins/modes/echobosses/Sessions.EchoBosses');
const Loot = require('../plugins/modes/echobosses/Loot.EchoBosses');
const variants = require('../data/definitions/npc-encounter-variants.json');
const { CacheDefinitions, NpcDefinition, NpcIdentifiers, ItemIdentifiers } = core;

let events, logs, config;
function pluginApi() {
  events = []; logs = []; config = new Map();
  return { core, log: message => logs.push(message), onServerStartup() {}, onCustomEvent() {}, onPlayerLogout() {},
    onPlayerDisconnect() {}, onPlayerDeath() {}, onServerShutdown() {}, persistAttribute() {},
    getPluginConfig: (key, fallback) => config.has(key) ? config.get(key) : fallback,
    emitCustomEvent: (name, event) => events.push({ name, event }) };
}
function leaguePlayer(name, { orb = true } = {}) {
  const attributes = new Map([['league:type', 6]]);
  return { name, getProfile: () => 'league', getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    isRegistered: () => true, getHitpoints: () => 99, getInventory: () => ({ contains: () => orb }) };
}
function spawn(symbol) {
  return core.NPC.create(CacheDefinitions.getNpcId(symbol), new core.Location(3200, 3200, 0));
}
const sequence = values => { let index = 0; return () => values[index++ % values.length]; };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  require('../plugins/modes/league/Common.LeagueMode').init?.({ ...pluginApi(), getPluginConfig: () => null });
});

test('every Echo role dresses its normal boss with the Wiki profile, leaving the normal definition alone', () => {
  const api = pluginApi(); Actors.attach(api);
  for (const entry of Actors.ROLES) {
    const npc = spawn(entry.normal), profile = variants.bosses[entry.boss].profiles[entry.profile];
    const definition = NpcDefinition.forId(npc.getId()), before = { hp: definition.getHitpoints(), speed: definition.getAttackSpeed(), stats: [...definition.getStats()] };
    assert.ok(Actors.dress(npc, entry.boss, entry.role, true), `${entry.boss} ${entry.role}`);
    assert.equal(npc.getMaxHitpoints(), profile.hitpoints); assert.equal(npc.getHitpoints(), profile.hitpoints);
    if (Number.isInteger(profile.attack_speed)) assert.equal(npc.getCurrentDefinition().getAttackSpeed(), profile.attack_speed);
    if (Number.isInteger(profile.max_hit)) assert.equal(npc.getCurrentDefinition().getMaxHit(), profile.max_hit);
    if (Number.isInteger(profile.defence_level)) assert.equal(npc.getCurrentDefinition().getStats()[2], profile.defence_level);
    assert.deepEqual({ hp: definition.getHitpoints(), speed: definition.getAttackSpeed(), stats: [...definition.getStats()] }, before,
      `${entry.normal}'s own definition is untouched`);
    assert.ok(CacheDefinitions.getNpc(npc.getId()).actions.includes('Attack'), `${entry.normal} keeps its Attack action`);
  }
  assert.deepEqual(logs, []);
});

test('each Echo wears its stub\'s whole model list without the normal recolours, with its Echo name and level', () => {
  Actors.attach(pluginApi());
  const dressed = (boss, role, symbol) => { const npc = spawn(symbol); Actors.dress(npc, boss, role, true); return npc.getTypeCustomisationForUpdate(); };
  const stub = symbol => CacheDefinitions.getNpc(CacheDefinitions.getNpcId(symbol));
  // As live sends Echo Hunllef and Thermy (rsprox.net 1158/1161).
  assert.deepEqual(dressed('corrupted-hunllef', 'boss', 'crystal_hunllef_melee_hm'),
    { name: 'Corrupted Hunllef (Echo)', combatLevel: 1117, models: [60373], recolours: [] });
  assert.deepEqual(dressed('thermonuclear-smoke-devil', 'boss', 'smoke_devil_boss'),
    { name: 'Thermonuclear Smoke Devil (Echo)', combatLevel: 602, models: [60399], recolours: [] });
  for (const [role, symbol, echo] of [['rex', 'dagcave_melee_boss', 'league_6_dagcave_melee_boss'], ['prime', 'dagcave_magic_boss', 'league_6_dagcave_magic_boss']]) {
    const custom = dressed('dagannoth-kings', role, symbol);
    assert.deepEqual(custom.models, stub(echo).modelIds, `${role}: the whole Echo model list, not the normal form's slots`);
    assert.deepEqual(custom.recolours, [], `${role}: the normal form's recolours are dropped`);
  }
  assert.deepEqual(dressed('kalphite-queen', 'air', 'kalphite_flyingqueen').models, stub('league_6_kalphite_flyingqueen').modelIds);
  assert.equal(dressed('kalphite-queen', 'ground', 'kalphite_queen').combatLevel, 499, 'each Queen form its own level');
  const dusk = dressed('grotesque-guardians', 'dusk-final', 'gargboss_dusk_phase4');
  assert.equal(dusk.models, undefined, 'the size-6 phase 4 keeps its normal appearance');
  assert.equal(dusk.name, 'Dusk (Echo)');
  // No NPC stub: the single Echo model the League Areas panel draws (leagues_echo_bosses struct).
  assert.deepEqual(dressed('king-black-dragon', 'boss', 'king_dragon'),
    { name: 'King Black Dragon (Echo)', combatLevel: 414, models: [60340], recolours: [] });
  assert.deepEqual(dressed('amoxliatl', 'boss', 'amoxliatl'),
    { name: 'Amoxliatl (Echo)', combatLevel: 328, models: [60338], recolours: [] });
});

test('a form change keeps the damage dealt; an unknown role is refused', () => {
  Actors.attach(pluginApi());
  const npc = spawn('kalphite_queen');
  Actors.dress(npc, 'kalphite-queen', 'ground', true);
  npc.setHitpoints(100);
  Actors.dress(npc, 'kalphite-queen', 'air', false);
  assert.equal(npc.getHitpoints(), 100);
  assert.equal(Actors.dress(npc, 'kalphite-queen', 'nowhere', false), null);
  assert.deepEqual(Actors.dress(npc, 'kalphite-queen', 'air', false).maxHits, [{ label: 'melee', maxHit: 38 }, { label: 'ranged', maxHit: 35 }, { label: 'magic', maxHit: 49 }]);
});

test('Sessions dresses and marks only its own actors, and completes an encounter once', () => {
  const api = pluginApi(); Actors.attach(api); Loot.attach(api); Sessions.attach(api);
  const player = leaguePlayer('EchoSession'), claim = { player, boss: 'cerberus', token: null };
  Sessions.claim(claim); assert.ok(claim.token);
  const npc = spawn('cerberus_attacking');
  const stranger = { player, boss: 'cerberus', role: 'boss', npc, token: 'not-the-token', configured: false };
  Sessions.configure(stranger); assert.equal(stranger.configured, false); assert.equal(npc.getAttribute('echo-boss:encounter'), undefined);
  const configure = { player, boss: 'cerberus', role: 'boss', npc, token: claim.token, configured: false };
  Sessions.configure(configure);
  assert.equal(configure.configured, true); assert.equal(npc.getAttribute('echo-boss:encounter').token, claim.token); assert.equal(npc.getMaxHitpoints(), 1620);
  const completed = { player, boss: 'cerberus', token: claim.token, npcs: [npc], location: npc.getLocation() };
  Sessions.completed(completed); Sessions.completed({ ...completed });
  assert.equal(events.filter(row => row.name === 'echo-boss:credited').length, 1);
  assert.equal(events.find(row => row.name === 'echo-boss:credited').event.killCount, 1);
  Sessions.release({ player, token: claim.token }); assert.equal(Sessions.sessions.has(player), false);
});

test('Echo equipment: listed rate, guarantee at twice it, boss rare multiplier once, received never re-guaranteed', () => {
  const api = pluginApi(); Loot.attach(api);
  const roll = (boss, kills, received = {}, random = () => 0.99) => Loot.rollUniques(boss, kills, received, random).map(drop => drop.itemId);
  const tecpatl = variants.bosses.amoxliatl.unique_table.entries[0].item_id;
  assert.deepEqual(roll('amoxliatl', 59), [], 'no drop before the guarantee on a high roll');
  assert.deepEqual(roll('amoxliatl', 60), [tecpatl], 'guaranteed on the 60th kill (1/30)');
  assert.deepEqual(roll('amoxliatl', 60, { [`amoxliatl:${tecpatl}`]: true }), [], 'not again once received');
  assert.deepEqual(roll('amoxliatl', 1, {}, () => 0.99 / 30), [tecpatl], 'a roll under 1/30 hits');
  assert.deepEqual(roll('amoxliatl', 1, {}, () => 1.5 / 30), [], 'a roll over 1/30 misses');
  config.set('NpcDrops:bossRareMultiplier', 2);
  assert.deepEqual(roll('amoxliatl', 1, {}, () => 1.5 / 30), [tecpatl], 'the world multiplier doubles the chance');
  config.delete('NpcDrops:bossRareMultiplier');
  const thermy = variants.bosses['thermonuclear-smoke-devil'].unique_table.entries.map(entry => entry.item_id);
  assert.equal(thermy.length, 2);
  assert.deepEqual(roll('thermonuclear-smoke-devil', 50), thermy, 'both Thermy items guaranteed on kill 50');
  assert.deepEqual(roll('thermonuclear-smoke-devil', 1, {}, sequence([0, 0.99])), [thermy[0]], 'each Thermy item rolls on its own');
});

test('Loot counts completions, remembers what was received and delivers through the encounter', () => {
  const api = pluginApi(); Loot.attach(api);
  const player = leaguePlayer('EchoLoot');
  player.setAttribute(Loot.LOOT_ATTRIBUTE, { version: 1, kills: { cerberus: 49 }, received: {} });
  const result = Loot.complete({ player, boss: 'cerberus', npcs: [], location: new core.Location(1, 1, 0) }, () => 0.99);
  assert.deepEqual(result, { success: true, killCount: 50 });
  const fang = variants.bosses.cerberus.unique_table.entries[0].item_id;
  assert.equal(player.getAttribute(Loot.LOOT_ATTRIBUTE).received[`cerberus:${fang}`], true);
  assert.deepEqual(events.find(row => row.name === 'npc-drops:place').event.drops, [{ itemId: fang, amount: 1 }]);
  let queued = null;
  Loot.complete({ player, boss: 'cerberus', npcs: [], queueReward: drops => { queued = drops; } }, () => 0.99);
  assert.deepEqual(queued, [], 'a chest hook is always called, empty or not');
  player.setAttribute(Loot.LOOT_ATTRIBUTE, { version: 2 });
  assert.deepEqual(Loot.complete({ player, boss: 'cerberus', npcs: [] }), { success: false }, 'a malformed save is never overwritten');
  assert.equal(ItemIdentifiers.COINS > 0, true);
});
