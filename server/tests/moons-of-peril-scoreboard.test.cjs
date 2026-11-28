// Run after `npx tsc --build`: node --test tests/moons-of-peril-scoreboard.test.cjs
//
// Eyatlalli's scoreboard (pmoon_eyatlalli_vis_postquest's Scoreboard, interface
// perilous_moons_scoreboard): the Lunar Chest's Claim feeding it, deaths, the world's records
// across players and restarts, and the post-quest Eyatlalli that carries the option, on a real
// Player with only the network stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, beforeEach, after } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');

const Common = require('../plugins/bosses/moonsofperil/Common.MoonsOfPeril');
const attachChest = require('../plugins/bosses/moonsofperil/Chest.MoonsOfPeril');
const Arena = require('../plugins/bosses/moonsofperil/Arena.MoonsOfPeril');
const Cycle = require('../plugins/bosses/moonsofperil/Cycle.MoonsOfPeril');
const Scoreboard = require('../plugins/bosses/moonsofperil/Scoreboard.MoonsOfPeril');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'moons-scoreboard-'));
const hooks = { objects: {}, npcs: {}, deaths: [], itemOnNpc: [], persisted: new Map() };
let INTERFACE, cache;
let index = 1;

before(() => {
  CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    persistAttribute: (key, value) => hooks.persisted.set(key, value),
    onObjectInteraction: (name, actions) => { (hooks.objects[name] ??= []).push(actions); },
    onNpcInteraction: (name, actions) => { (hooks.npcs[name] ??= []).push(actions); },
    onInterfaceActionButton() {},
    onItemOnNpc: (handler) => hooks.itemOnNpc.push(handler),
    onNpcHitModify() {},
    onObjectRoute() {},
    onPlayerLogin() {},
    onPlayerDeath: (handler) => hooks.deaths.push(handler),
    registerArea() {},
    onCustomEvent() {},
    emitCustomEvent() {},
  };
  Common.init(api);
  attachChest(api);
  Arena.attachArena(api);
  Scoreboard.attachScoreboard(api);
  cache = api.core.CacheDefinitions;
  INTERFACE = cache.getInterfaceId('perilous_moons_scoreboard');
});

after(() => fs.rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => Scoreboard._useFile(path.join(scratch, `${Math.random()}.json`)));

/** A real Player with only the network stubbed; the packets it would send are recorded. */
function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(index++);
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const sender = p.getPacketSender();
  p.sent = { interfaces: [], texts: new Map(), messages: [] };
  const original = { sendInterface: sender.sendInterface, sendString: sender.sendString };
  t.mock.method(sender, 'sendInterface', function (id) { p.sent.interfaces.push(id); return original.sendInterface.apply(this, arguments); });
  t.mock.method(sender, 'sendString', function (text, uid) { p.sent.texts.set(uid, text); return original.sendString.apply(this, arguments); });
  t.mock.method(p, 'sendMessage', (text) => p.sent.messages.push(text));
  return p;
}

/** Scoreboard on Eyatlalli, the way NPCOptionPacketListener hands it to the named handlers. */
function readBoard(player) {
  for (const actions of hooks.npcs.Eyatlalli ?? []) {
    if (actions.Scoreboard?.({ player, npcId: cache.getNpcId('pmoon_eyatlalli_vis_postquest'), clickType: 3 }) === true) return true;
  }
  return false;
}

/** Claim on the Lunar Chest with `moons` subdued, through Chest.MoonsOfPeril.js's own handler. */
function claim(player, moons = ['blood']) {
  for (const moon of moons) Common.setDead(player, moon, true);
  const objectId = Common.data.chest.loc;
  for (const actions of hooks.objects['Lunar Chest'] ?? []) actions.Claim({ player, objectId, object: null });
  player.setAttribute('moons-of-peril:chest', null); // taken out, so the next Claim opens a new one
}

const text = (p, name) => p.sent.texts.get(cache.getComponentId(`perilous_moons_scoreboard:${name}`));

test('a new reader sees the cache title and zeros', (t) => {
  const p = realPlayer(t);
  assert.equal(readBoard(p), true);
  assert.deepEqual(p.sent.interfaces, [INTERFACE]);
  assert.equal(text(p, 'title_text'), 'Perilous Moons Statistics');
  for (const name of ['pkc_content', 'pd_content', 'gkc_content', 'gd_content']) assert.equal(text(p, name), '0');
});

test('each Lunar Chest Claim counts, for the player and the world; a Claim with no Moon subdued does not', (t) => {
  const p = realPlayer(t);
  claim(p, ['blood', 'blue', 'eclipse']);
  claim(p, ['eclipse']);
  claim(p, []);
  readBoard(p);
  assert.equal(text(p, 'pkc_content'), '2');
  assert.equal(text(p, 'gkc_content'), '2');
  assert.ok(p.sent.messages.some((m) => m.includes('Lunar Chest count is: <col=ff0000>2</col>')), 'the chest\'s own count agrees');
});

test("the world's numbers are every player's, a reader's own rows stay theirs", (t) => {
  const a = realPlayer(t);
  const b = realPlayer(t);
  claim(a);
  claim(b);
  claim(b);
  Scoreboard.died(b);
  readBoard(a);
  assert.equal(text(a, 'pkc_content'), '1');
  assert.equal(text(a, 'pd_content'), '0');
  assert.equal(text(a, 'gkc_content'), '3');
  assert.equal(text(a, 'gd_content'), '1');
});

test("a death inside a Moon's arena counts, through Arena.MoonsOfPeril.js's own death hook", (t) => {
  const p = realPlayer(t);
  // The Blood Moon's arena as the server sets it up (its Moon not spawned): the player enters the
  // area for real, with the Moon already subdued so no fight starts.
  if (!Cycle.arenas.has('blood')) Cycle.arenas.set('blood', new Cycle.MoonArena('blood'));
  t.after(() => Cycle.arenas.delete('blood'));
  Common.setDead(p, 'blood', true);
  const area = Arena.areas.get('blood');
  const [x, y, z] = Common.data.moons.blood.tile;
  p.setLocation(new Location(x, y, z));
  area.enter(p);
  assert.ok(Arena.arenaOfPlayer(p), 'in the arena');
  for (const handler of hooks.deaths) handler({ player: p, killer: null, handled: false });
  area.leave(p, false);
  readBoard(p);
  assert.equal(text(p, 'pd_content'), '1');
  assert.equal(text(p, 'gd_content'), '1');
});

test('a death outside the Moons\' arenas is not counted', (t) => {
  const p = realPlayer(t);
  p.setLocation(new Location(1523, 9575, 0));
  for (const handler of hooks.deaths) handler({ player: p, killer: null, handled: false });
  readBoard(p);
  assert.equal(text(p, 'pd_content'), '0');
  assert.equal(text(p, 'gd_content'), '0');
});

test('deaths are a saved attribute starting at 0, and the world records survive a restart', (t) => {
  assert.equal(hooks.persisted.get(Scoreboard.DEATHS_ATTRIBUTE), 0);
  assert.equal(hooks.persisted.get(Scoreboard.CHESTS_ATTRIBUTE), 0, 'the chest count was already saved');
  const file = path.join(scratch, 'restart.json');
  Scoreboard._useFile(file);
  const p = realPlayer(t);
  claim(p);
  Scoreboard.died(p);
  Scoreboard.died(p);
  Scoreboard._useFile(file); // as a restart reads it again
  const q = realPlayer(t);
  readBoard(q);
  assert.equal(text(q, 'gkc_content'), '1');
  assert.equal(text(q, 'gd_content'), '2');
  readBoard(p);
  assert.equal(text(p, 'pd_content'), '2');
});

test('reading twice sends the board twice and counts nothing', (t) => {
  const p = realPlayer(t);
  readBoard(p);
  readBoard(p);
  assert.deepEqual(p.sent.interfaces, [INTERFACE, INTERFACE]);
  assert.equal(text(p, 'gkc_content'), '0');
});

test('the shrine Eyatlalli is the post-quest multinpc: Scoreboard only once pmoon_eyatlalli_vis is 1', () => {
  const spawns = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'definitions', 'npc-spawns.json'), 'utf8'));
  const base = cache.getNpcId('pmoon_eyatlalli_postquest');
  const shrine = spawns.filter((s) => s.name === 'Eyatlalli');
  assert.deepEqual(shrine.map((s) => [s.id, s.x, s.y, s.level, s.direction]), [[base, 1523, 9578, 0, 3]], 'rsprox 237/01104: one, facing west');
  const varbit = cache.getVarbitId('pmoon_eyatlalli_vis');
  const resolve = (value) => cache.resolveNpc(base, { getVarbit: (id) => (id === varbit ? value : 0), getVarp: () => 0 });
  assert.equal(resolve(0), undefined, 'hidden until the varbit is set');
  const shown = resolve(1);
  assert.equal(shown?.name, 'Eyatlalli');
  assert.equal(shown?.actions?.[2], 'Scoreboard');
});

test("sulphurous essence on the shrine's Eyatlalli still reaches her offerings through the nameless parent", (t) => {
  const { NPC } = require('../dist/game/entity/impl/npc/NPC');
  const { Item } = require('../dist/game/model/Item');
  const npc = new NPC(cache.getNpcId('pmoon_eyatlalli_postquest'), new Location(1523, 9578, 0));
  const p = realPlayer(t);
  p.getPacketSender().sendVarbit(cache.getVarbitId('pmoon_eyatlalli_vis'), 1);
  const essence = Common.core.ItemIdentifiers.SULPHUROUS_ESSENCE;
  p.getInventory().add(new Item(essence, 3), false);
  const before = p.getSkillManager().getExperience(Common.core.Skill.RUNECRAFTING);
  const event = { player: p, target: npc, itemId: essence, handled: false };
  for (const handler of hooks.itemOnNpc) handler(event);
  assert.equal(event.handled, true);
  assert.equal(p.getInventory().getAmount(essence), 0);
  assert.equal(p.getSkillManager().getExperience(Common.core.Skill.RUNECRAFTING) - before, 150);
});
