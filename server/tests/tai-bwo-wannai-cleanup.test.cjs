// Run after `npx tsc --build`: node --test tests/tai-bwo-wannai-cleanup.test.cjs
//
// Tai Bwo Wannai Cleanup through the real plugins: every plugin loaded, the map's own jungle and
// fence locs, clicks dispatched by PluginManager, real tasks ticked, on a real Player with only the
// network stubbed. The world clock is counted here so the 149- and 1000-tick restores can be crossed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const { PluginContext } = require('../dist/plugins/PluginContext');
const originalRandom = Math.random;

const ROOT = path.join(__dirname, '..');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

process.env.DISABLE_PLAYER_BOTS = '1';

let PluginManager, core, MapObjects, ObjectDefinition, Location, Player, Item, Equipment, jungleQuest;
let Common, Locs, Jungle, Fence, Favour, Villagers, Events, GemRock, Broodoo;
let cycle = 0;
let index = 3000;

const LIGHT = [2770, 3061, 0];
const MEDIUM = [2766, 3057, 0];
const DENSE = [2771, 3075, 0];
const FENCE = [2772, 3064, 0];

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  ({ PluginManager } = require('../dist/plugins/PluginManager'));
  ({ MapObjects } = require('../dist/game/entity/impl/object/MapObjects'));
  ({ ObjectDefinition } = require('../dist/game/definition/ObjectDefinition'));
  ({ Location } = require('../dist/game/model/Location'));
  PluginManager.loadPluginSwitches = () => ({ switches: new Map() });
  const quiet = [console.log, console.info, console.debug, console.warn];
  console.log = console.info = console.debug = console.warn = () => {};
  try {
    PluginManager.loadFromDirectory(path.join(ROOT, 'plugins'));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
  } finally {
    [console.log, console.info, console.debug, console.warn] = quiet;
  }
  ({ Player } = require('../dist/game/entity/impl/player/Player'));
  ({ Item, Equipment } = core);
  core.World.getProcessCycle = () => cycle;
  for (const [x, y] of [[2760, 3020], [2840, 3020], [2760, 3100], [2840, 3100]]) core.RegionManager.loadMapFiles(x, y);
  const dir = '../plugins/minigames/taibwowannaicleanup/';
  Common = require(`${dir}Common.TaiBwoWannaiCleanup`);
  Locs = require(`${dir}Locs.TaiBwoWannaiCleanup`);
  Jungle = require(`${dir}Jungle.TaiBwoWannaiCleanup`);
  Fence = require(`${dir}Fence.TaiBwoWannaiCleanup`);
  Favour = require(`${dir}Favour.TaiBwoWannaiCleanup`);
  Villagers = require(`${dir}Villagers.TaiBwoWannaiCleanup`);
  Events = require(`${dir}Events.TaiBwoWannaiCleanup`);
  GemRock = require(`${dir}GemRock.TaiBwoWannaiCleanup`);
  Broodoo = require(`${dir}Broodoo.TaiBwoWannaiCleanup`);
  jungleQuest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find((q) => q.key === 'jungle_potion');
  PluginManager.emitServerStartup({});
});
after(() => PluginManager.emitServerShutdown({}));

beforeEach(() => {
  // Every map loc back as the cache placed it.
  for (const entry of [...Locs._changed.values()]) entry.due = -1;
  Locs.process();
});

afterEach(() => {
  for (const player of [...Jungle._sessions.keys(), ...Fence._sessions.keys(), ...GemRock._sessions.keys()]) {
    Jungle._sessions.delete(player);
    Fence._sessions.delete(player);
    GemRock._sessions.delete(player);
  }
  for (const npc of [...Events._spawned.keys()]) Events.remove(npc);
  Events._finders.clear();
});

const id = (kind, name) => core.CacheDefinitions[`get${kind}Id`](name);
const obj = (name) => id('Obj', name);
const loc = (name) => id('Loc', name);
/** A game tick: tasks, then the NPCs the world loop would add and remove. */
function tick(n = 1) {
  const { World } = core;
  for (let i = 0; i < n; i++) {
    cycle++;
    core.TaskManager.process();
    for (let npc; (npc = World.getAddNPCQueue().shift());) World.getNpcs().add(npc);
    for (let npc; (npc = World.getRemoveNPCQueue().shift());) World.getNpcs().remove(npc);
  }
}
const at = ([x, y, z]) => new Location(x, y, z);

/** A real player by the jungle, past Jungle Potion and told of the cleanup, with a red topaz machete. */
function villager(t, { told = true, machete = 'machette_redtopaz', woodcutting = 99, events = false } = {}) {
  // Most tests fix Math.random, which would also roll jungle events: those are tested on their own.
  if (!events && !Events.roll.mock) t.mock.method(Events, 'roll', () => false);
  const p = new Player(null);
  p.setIndex(index++);
  p.setUsername(`tbwc${p.getIndex()}`);
  p.setRegistered(true);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.messages = [];
  t.mock.method(p, 'sendMessage', (text) => p.messages.push(text));
  const sender = p.getPacketSender();
  const spam = sender.sendTypedMessage;
  t.mock.method(sender, 'sendTypedMessage', function (type, text) { p.messages.push(text); return spam.apply(this, arguments); });
  p.varbits = new Map();
  const send = sender.sendVarbit;
  t.mock.method(sender, 'sendVarbit', function (vid, value) { p.varbits.set(vid, value); return send.apply(this, arguments); });
  p.setLocation(new Location(2771, 3062, 0));
  jungleQuest.setStage(p, jungleQuest.completionValue);
  if (told) Common.advance(p, 1);
  if (machete) p.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(obj(machete), 1));
  const skill = p.getSkillManager();
  skill.setMaxLevel(core.Skill.WOODCUTTING, woodcutting).setCurrentLevel(core.Skill.WOODCUTTING, woodcutting);
  return p;
}

/** A login as the login packet sends it (hooks need the username). */
const login = (p) => PluginManager.emitPlayerLogin({ player: p, username: p.getUsername() });
const varbit = (p, name) => p.varbits.get(id('Varbit', name));
const xp = (p) => p.getSkillManager().getExperience(core.Skill.WOODCUTTING);

const CLEANUP_LOCS = () => [...Common.data.jungle.flatMap((jungle) => jungle.locs), ...Common.data.fence.locs].map(loc);

/** The option clicked on arrival: the player stands on the tile east of the loc, as walking there would. */
function click(p, tile, option) {
  const object = Locs.find(CLEANUP_LOCS(), at(tile));
  if (!p.getLocation().isWithinInteractionDistance(at(tile))) p.setLocation(new Location(tile[0] + 1, tile[1], tile[2]));
  assert.ok(object, `a loc at ${tile}`);
  const definition = ObjectDefinition.forPlayer(object.getId(), p);
  const clickType = definition.getInteractions().indexOf(option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} has ${option}`);
  const event = { player: p, object, objectId: object.getId(), definition, clickType, location: { x: tile[0], y: tile[1], z: tile[2] }, handled: false };
  PluginManager.emitObjectInteraction(event);
  return event;
}

const locAt = (tile) => Locs.find(CLEANUP_LOCS(), at(tile))?.getId();

test('hacking needs Murcaily first, a wielded machete and the Woodcutting level', (t) => {
  const untold = villager(t, { told: false });
  assert.equal(click(untold, LIGHT, 'Hack').handled, true);
  assert.equal(untold.getDialogueManager().isActive(), true, 'the recorded mesbox');
  assert.equal(Jungle._sessions.has(untold), false);

  const bare = villager(t, { machete: null });
  click(bare, LIGHT, 'Hack');
  assert.deepEqual(bare.messages, ['You need to be holding a machete to cut away this jungle.']);

  const low = villager(t, { woodcutting: 30 });
  click(low, DENSE, 'Hack');
  assert.deepEqual(low.messages, ['You need a Woodcutting level of 35 to hack this jungle.']);
  assert.equal(Jungle._sessions.has(low), false);
});

test('a hack: the result 7 ticks after the click (01858), the jungle one stage down in place, its spar, XP, then favour 3 ticks on', (t) => {
  const p = villager(t);
  mockRandom(t, () => 0);
  const before = xp(p);
  const original = MapObjects.get(loc('tai_bwo_jungle_vegetation_easy_1'), at(LIGHT), null);
  click(p, LIGHT, 'Hack');
  tick(7);
  assert.equal(locAt(LIGHT), loc('tai_bwo_jungle_vegetation_easy_2'));
  const after = MapObjects.get(loc('tai_bwo_jungle_vegetation_easy_2'), at(LIGHT), null);
  assert.equal(after.getType(), original.getType());
  assert.equal(after.getFace(), original.getFace());
  assert.equal(p.getInventory().getAmount(obj('thatching_spar_light')), 1);
  assert.equal(xp(p) - before, 32);
  assert.equal(varbit(p, 'cleanup_progress'), 2);
  assert.equal(Favour.points(p), 3, 'kept at once');
  assert.equal(varbit(p, 'vill_comm_points') ?? 0, 0, 'shown 3 ticks later');
  tick(3);
  assert.equal(varbit(p, 'vill_comm_points'), 3);
  assert.equal(varbit(p, 'favour_percentage'), 0);
  assert.equal(varbit(p, 'tbw_overlayopen'), 1, 'the overlay is up in the village');
  tick(6);
  assert.equal(locAt(LIGHT), loc('tai_bwo_jungle_vegetation_easy_3'), 'the next result, 9 ticks after the first');
});

test('a miss gives 1 XP and leaves the jungle', (t) => {
  const p = villager(t);
  mockRandom(t, () => 0.999);
  const before = xp(p);
  click(p, MEDIUM, 'Hack');
  tick(7);
  assert.equal(locAt(MEDIUM), loc('tai_bwo_jungle_vegetation_med_1'));
  assert.equal(xp(p) - before, 1);
  assert.equal(p.getInventory().getAmount(obj('thatching_spar_med')), 0);
});

test('cut to the ground: stage 5 ends the hack with the message, and the jungle grows back 149 ticks after its last change', (t) => {
  const p = villager(t);
  mockRandom(t, () => 0);
  click(p, DENSE, 'Hack');
  tick(9 * 3 + 7);
  assert.equal(locAt(DENSE), loc('tai_bwo_jungle_vegetation_hard_5'));
  assert.equal(Jungle._sessions.has(p), false);
  tick(3);
  assert.ok(p.messages.includes('This jungle has been cut back to the ground.'));
  assert.equal(p.getInventory().getAmount(obj('thatching_spar_dense')), 4);
  tick(149 - 4);
  assert.equal(locAt(DENSE), loc('tai_bwo_jungle_vegetation_hard_5'));
  tick(1);
  assert.equal(locAt(DENSE), loc('tai_bwo_jungle_vegetation_hard_1'));
});

test('the last free slot gets its spar, then the hack stops with the recorded message', (t) => {
  const p = villager(t);
  mockRandom(t, () => 0);
  p.getInventory().add(new Item(obj('bones'), 27));
  click(p, LIGHT, 'Hack');
  tick(7);
  assert.equal(p.getInventory().getAmount(obj('thatching_spar_light')), 1);
  assert.equal(Jungle._sessions.has(p), false);
  tick(3);
  assert.ok(p.messages.includes('You have no space in your inventory for any further thatching spars.'));
  p.messages.length = 0;
  click(p, LIGHT, 'Hack');
  assert.deepEqual(p.messages, ['You have no space in your inventory for any further thatching spars.']);
});

test('walking away stops the hack and keeps a favour gain already due', (t) => {
  const p = villager(t);
  mockRandom(t, () => 0);
  click(p, LIGHT, 'Hack');
  tick(7);
  p.getMovementQueue().addSteps(new Location(2771, 3063, 0));
  assert.ok(p.getMovementQueue().size() > 0, 'a step queued');
  tick(3);
  assert.equal(Jungle._sessions.has(p), false);
  assert.equal(Favour.points(p), 3);
});

test('the fence: a spar a stage on the 10th tick, every 13, to the finished fence; then back to rotten 1000 ticks on', (t) => {
  const p = villager(t);
  p.getInventory().add(new Item(obj('thatching_spar_light'), 2));
  p.getInventory().add(new Item(obj('thatching_spar_dense'), 3));
  const before = xp(p);
  assert.equal(click(p, FENCE, 'Repair').handled, true);
  tick(9);
  assert.equal(locAt(FENCE), loc('village_fence_rotten'));
  tick(1);
  assert.equal(locAt(FENCE), loc('village_fence_fixed1'));
  assert.equal(p.getInventory().getAmount(obj('thatching_spar_light')), 1);
  assert.equal(Math.floor(xp(p) - before), 28, 'a light spar: 28.1 (whole experience at 99)');
  assert.equal(Favour.points(p), 1);
  assert.equal(varbit(p, 'cleanup_progress'), 4);
  tick(13 * 3);
  assert.equal(locAt(FENCE), loc('village_fence_fixedcomplete'));
  assert.equal(Fence._sessions.has(p), false, 'a finished fence ends the repair');
  assert.equal(p.getInventory().getAmount(obj('thatching_spar_dense')), 1);
  assert.equal(Favour.points(p), 1 + 1 + 5 + 5);
  tick(1000 - 1);
  assert.equal(locAt(FENCE), loc('village_fence_fixedcomplete'));
  tick(1);
  assert.equal(locAt(FENCE), loc('village_fence_rotten'));
});

test('Reinforce puts one spar into the finished fence and restarts its decay', (t) => {
  const p = villager(t);
  p.getInventory().add(new Item(obj('thatching_spar_med'), 6));
  click(p, FENCE, 'Repair');
  tick(10 + 13 * 3);
  assert.equal(locAt(FENCE), loc('village_fence_fixedcomplete'));
  tick(500);
  click(p, FENCE, 'Reinforce');
  tick(10);
  assert.equal(p.getInventory().getAmount(obj('thatching_spar_med')), 1);
  assert.equal(Fence._sessions.has(p), false);
  tick(999);
  assert.equal(locAt(FENCE), loc('village_fence_fixedcomplete'), 'the reinforce restarted the 1000');
  tick(1);
  assert.equal(locAt(FENCE), loc('village_fence_rotten'));
});

test('no spars, or no machete, and the fence is left alone', (t) => {
  const p = villager(t);
  click(p, FENCE, 'Repair');
  assert.deepEqual(p.messages, ['You need some thatching spars in order to repair this fence.']);
  const q = villager(t, { machete: null });
  q.getInventory().add(new Item(obj('thatching_spar_light'), 1));
  click(q, FENCE, 'Repair');
  assert.deepEqual(q.messages, ['You need a machete to repair this fence.']);
  assert.equal(Fence._sessions.size, 0);
});

test('favour stops at 100%, with the recorded message', (t) => {
  const p = villager(t);
  Favour.gain(p, 998);
  assert.equal(p.messages.length, 0);
  Favour.gain(p, 3);
  assert.equal(Favour.points(p), 1000);
  assert.equal(varbit(p, 'favour_percentage'), 100);
  assert.deepEqual(p.messages, [
    'Your Favour total is now full, you cannot gain any more.<br>Talk to the villagers to get favour converted to trading sticks.',
    '<col=dc143c>Well done! You have completed a medium task in the Karamja area. Your Achievement Diary has been updated.</col>',
  ]);
});

test('sticks: the fit passes through the three recorded claims', () => {
  assert.equal(Villagers.sticksFor(419), 23);
  assert.equal(Villagers.sticksFor(1000), 79);
  assert.ok(Math.abs(Villagers.sticksFor(921) - 71) <= 2, `${Villagers.sticksFor(921)} at 921`);
  assert.equal(Villagers.sticksFor(0), 0);
  assert.equal(Villagers.sticksFor(12), 1, 'any favour left gives a stick');
});

/** Talk-to as the click packet sends it, on a villager's multinpc as the player sees it. */
function talk(p, name) {
  const villagerData = Common.data.villagers.find((v) => v.name === name);
  const npc = new core.NPC(id('Npc', `${villagerData.npc.replace('tbwcu_', 'tbwcu_')}_multinpc`), new Location(2800, 3080, 0));
  const event = { player: p, npc, npcId: npc.getContentId(p), definition: npc.getCurrentDefinition(p), npcIndex: 1, clickType: 1, location: { x: 2800, y: 3080, z: 0 }, handled: false };
  PluginManager.emitNpcInteraction(event);
  return event;
}

function continueAll(p) {
  for (let i = 0; i < 6 && p.getDialogueManager().isActive(); i++) p.getDialogueManager().advance();
}

test('the first sticks come from Murcaily after a repair; then the others give; each waits 1800 ticks', (t) => {
  const p = villager(t);
  // Logged in: every villager is due (1), so the client shows them holding sticks.
  login(p);
  assert.equal(varbit(p, 'chat_murc'), 1);
  Favour.gain(p, 600);
  // Before a repair nobody gives sticks: Murcaily's own transcript plays instead.
  assert.equal(Villagers.canClaim(p, Common.data.villagers.find((v) => v.name === 'Murcaily')), false);
  Common.advance(p, 4);
  assert.equal(Villagers.canClaim(p, Common.data.villagers.find((v) => v.name === 'Layleen')), false, 'not before Murcaily');
  const event = talk(p, 'Murcaily');
  assert.equal(event.handled, true);
  assert.equal(p.getDialogueManager().getCurrent().constructor.name, 'NpcDialogue');
  const sticks = Villagers.sticksFor(600);
  continueAll(p);
  assert.equal(p.getInventory().getAmount(obj('village_trade_sticks')), sticks);
  assert.equal(Favour.points(p), 600 - sticks);
  assert.equal(varbit(p, 'chat_murc'), 7);
  assert.equal(varbit(p, 'cleanup_progress'), 5);
  // Murcaily has nothing more for a while; Layleen now gives.
  assert.equal(Villagers.canClaim(p, Common.data.villagers.find((v) => v.name === 'Murcaily')), false);
  assert.equal(talk(p, 'Layleen').handled, true);
  continueAll(p);
  assert.equal(varbit(p, 'chat_layleen'), 7);
  tick(300);
  assert.equal(varbit(p, 'chat_murc'), 6);
  tick(300 * 5);
  assert.equal(varbit(p, 'chat_murc'), 1);
  assert.equal(Villagers.canClaim(p, Common.data.villagers.find((v) => v.name === 'Murcaily')), true);
});

test("Murcaily's transcript: his explanation tells the player, and his conditions follow the progress", (t) => {
  const p = villager(t, { told: false });
  const definition = { getName: () => 'Murcaily' };
  assert.equal(Villagers.answerCondition({ player: p, definition, text: 'First time after completing Jungle Potion:' }), true);
  const line = { player: p, definition, text: "Well Bwana, if you're stuck for something to do, you could always do a bit of handymanship about the village and cut away the jungle that lies here about." };
  Villagers.toldOnLine(line);
  assert.equal(Common.progress(p), 0, 'not until the page is reached');
  line.before();
  assert.equal(Common.progress(p), 1);
  const ask = (text) => Villagers.answerCondition({ player: p, definition, text });
  assert.equal(ask('First time after completing Jungle Potion:'), false, 'his welcome back is said until he has told them');
  assert.equal(ask("If the player hasn't hacked away at jungle:"), true);
  Common.advance(p, 2);
  assert.equal(ask('If the player has hacked away at jungle:'), true);
  assert.equal(ask("First time after hacking away at jungle if the fence hasn't been repaired yet:"), true);
  assert.equal(ask("First time after hacking away at jungle if the fence hasn't been repaired yet:"), true, 'asking is not saying it');
  const hacked = { player: p, definition, text: "I see that you've been hacking away at the jungle...good, now if you have some thatching spars you can go and fix the fence." };
  Villagers.toldOnLine(hacked);
  hacked.before();
  assert.equal(ask("First time after hacking away at jungle if the fence hasn't been repaired yet:"), false, 'only the first time it is said');
  assert.equal(ask('First time after repairing the fence:'), false, 'the claim is its own Talk-to');
});

test('a machete on a spar makes 5 skewers; a skewer on a spider carcass makes a spider on stick', (t) => {
  const p = villager(t);
  p.getInventory().add(new Item(obj('machette'), 1));
  p.getInventory().add(new Item(obj('thatching_spar_light'), 1));
  p.getInventory().add(new Item(obj('village_spider_carcass'), 1));
  const use = (a, b) => PluginManager.emitItemOnItem({ player: p, usedItemId: obj(a), usedWithItemId: obj(b), usedItem: new Item(obj(a), 1), usedWithItem: new Item(obj(b), 1), handled: false });
  use('machette', 'thatching_spar_light');
  assert.equal(p.getInventory().getAmount(obj('tbw_skewer_stick')), 5);
  assert.equal(p.getInventory().getAmount(obj('thatching_spar_light')), 0);
  assert.ok(p.messages.includes('You hack the spar into skewers.'));
  use('village_spider_carcass', 'tbw_skewer_stick');
  assert.equal(p.getInventory().getAmount(obj('tbw_skewer_stick')), 4);
  assert.equal(p.getInventory().getAmount(obj('tbw_spider_on_stick_raw')), 1);
});

test('repairing the fence ends a hack, and hacking ends a repair', (t) => {
  const p = villager(t);
  mockRandom(t, () => 0.999);
  p.getInventory().add(new Item(obj('thatching_spar_light'), 3));
  click(p, LIGHT, 'Hack');
  tick(2);
  click(p, FENCE, 'Repair');
  assert.equal(Jungle._sessions.has(p), false);
  assert.equal(Fence._sessions.has(p), true);
  tick(2);
  click(p, LIGHT, 'Hack');
  assert.equal(Fence._sessions.has(p), false);
  assert.equal(Jungle._sessions.has(p), true);
});

test('two players on one fence: the one who finds it finished stops without spending a spar', (t) => {
  const a = villager(t);
  const b = villager(t);
  a.getInventory().add(new Item(obj('thatching_spar_light'), 4));
  b.getInventory().add(new Item(obj('thatching_spar_light'), 4));
  click(a, FENCE, 'Repair');
  tick(5);
  click(b, FENCE, 'Repair');
  tick(10 + 13 * 3);
  assert.equal(locAt(FENCE), loc('village_fence_fixedcomplete'));
  tick(13 * 3);
  assert.equal(locAt(FENCE), loc('village_fence_fixedcomplete'), 'never past finished');
  assert.equal(Fence._sessions.size, 0);
  const left = a.getInventory().getAmount(obj('thatching_spar_light')) + b.getInventory().getAmount(obj('thatching_spar_light'));
  assert.equal(8 - left, 4, 'one spar a stage, between them');
});

test('a teleport away ends a hack and a repair', (t) => {
  const p = villager(t);
  mockRandom(t, () => 0.999);
  click(p, LIGHT, 'Hack');
  tick(2);
  p.setLocation(new Location(3222, 3218, 0));
  tick(1);
  assert.equal(Jungle._sessions.has(p), false);
  const q = villager(t);
  q.getInventory().add(new Item(obj('thatching_spar_light'), 1));
  click(q, FENCE, 'Repair');
  tick(2);
  q.setLocation(new Location(3222, 3218, 0));
  tick(10);
  assert.equal(Fence._sessions.has(q), false);
  assert.equal(q.getInventory().getAmount(obj('thatching_spar_light')), 1);
  assert.equal(locAt(FENCE), loc('village_fence_rotten'));
});

test('a level-up pop-up holds the hack until it is continued', (t) => {
  const p = villager(t);
  mockRandom(t, () => 0);
  click(p, LIGHT, 'Hack');
  let resume = null;
  PluginManager.emitCustomEvent('level-up:popup-opened', { player: p, skill: core.Skill.WOODCUTTING, pause: (session, onResume) => { resume = onResume; } });
  tick(20);
  assert.equal(locAt(LIGHT), loc('tai_bwo_jungle_vegetation_easy_1'), 'held');
  resume();
  tick(7);
  assert.equal(locAt(LIGHT), loc('tai_bwo_jungle_vegetation_easy_2'));
});

test('the fence, like the jungle, waits for Jungle Potion and Murcaily', (t) => {
  const p = villager(t, { told: false });
  p.getInventory().add(new Item(obj('thatching_spar_light'), 1));
  assert.equal(click(p, FENCE, 'Repair').handled, true);
  assert.equal(Fence._sessions.has(p), false);
  assert.equal(p.getDialogueManager().isActive(), true);
  assert.equal(Common.progress(p), 0);
});

test('a claim with a full inventory and no sticks held is refused, and the villager stays due', (t) => {
  const p = villager(t);
  login(p); // the villagers' chat_ varbits, so Murcaily resolves as the player sees him
  Common.advance(p, 4);
  Favour.gain(p, 500);
  p.getInventory().add(new Item(obj('bones'), 28));
  talk(p, 'Murcaily');
  continueAll(p);
  assert.ok(p.messages.includes("You don't have enough inventory space."));
  assert.equal(Favour.points(p), 500);
  assert.equal(Villagers.cooldownOf(p, Common.data.villagers.find((v) => v.name === 'Murcaily')), 1);
});

test("My Arm's Big Adventure reads, spends and hands over favour through the cleanup's events", (t) => {
  const p = villager(t);
  Favour.gain(p, 650);
  const ask = { player: p, percentage: 0 };
  PluginManager.emitCustomEvent('tai-bwo-wannai-cleanup:favour', ask);
  assert.equal(ask.percentage, 65);
  PluginManager.emitCustomEvent('tai-bwo-wannai-cleanup:spend-favour', { player: p, percentage: 60 });
  assert.equal(Favour.points(p), 50);
  // Favour the quest granted itself before the minigame existed moves over once at login.
  p.setAttribute('my-arms-big-adventure:tai-bwo-favour', 60);
  login(p);
  assert.equal(Favour.points(p), 650);
  assert.equal(p.getAttribute('my-arms-big-adventure:tai-bwo-favour'), 0);
  login(p);
  assert.equal(Favour.points(p), 650, 'only once');
  assert.equal(varbit(p, 'favour_percentage'), 65, 'one owner of the varbit');
});

test('logged in inside the village, the overlay waits for the welcome screen, then comes back', (t) => {
  const p = villager(t);
  Favour.gain(p, 10);
  assert.equal(varbit(p, 'tbw_overlayopen'), 1);
  login(p);
  const mounts = [];
  const sender = p.getPacketSender();
  const sub = sender.sendSubInterface;
  t.mock.method(sender, 'sendSubInterface', function (uid, id) { mounts.push(id); return sub.apply(this, arguments); });
  // The welcome screen's Play, as the button packet dispatches it: the overlay goes on its gameframe.
  PluginManager.emitInterfaceActionClick({ player: p, buttonId: (378 << 16) | 72, action: 1, handled: false });
  assert.deepEqual(mounts, [core.CacheDefinitions.getInterfaceId('village_community_score')]);
  assert.equal(varbit(p, 'tbw_overlayopen'), 1);
});

// ------------------------------------------------------------------ part 2: the jungle's events

const npc = (name) => id('Npc', name);
const entry = (key) => Common.data.events.table.find((e) => e.key === key);

/** Keep deterministic village rolls local while background plugins use their own randomness. */
function mockRandom(t, draw) {
  t.mock.method(Math, 'random', () => {
    const owner = PluginContext.current();
    return owner == null || owner === 'TaiBwoWannaiCleanup' ? draw() : originalRandom();
  });
}

/** Math.random answers from `values` in turn (then the last, again). */
function randoms(t, values) {
  let i = 0;
  mockRandom(t, () => values[Math.min(i++, values.length - 1)]);
}

test('the event chance: one more in 101 for each result, to 7; none at 0', (t) => {
  const p = villager(t, { events: true });
  mockRandom(t, () => 0.999);
  click(p, LIGHT, 'Hack');
  tick(7);
  assert.equal(varbit(p, 'eventchance'), 1);
  tick(9 * 8);
  assert.equal(varbit(p, 'eventchance'), 7, 'capped');
  assert.equal(Events._spawned.size, 0);
  assert.equal(Events.roll(villager(t, { events: true }), Common.data.jungle[0], null), false, 'a fresh counter never rolls');
});

test('an event takes the swing: the stall, then the message, the step back and the monster on the tile left', (t) => {
  const p = villager(t, { events: true });
  p.setLocation(new Location(LIGHT[0] + 1, LIGHT[1], 0));
  p.setAttribute(Events.COUNTER, 5);
  // The roll (hit), then the table: no gout tuber (0.99), then a snake (spider 22 + tribesman 21 = 43, of 99).
  randoms(t, [0, 0.99, 50 / 99]);
  const before = MapObjects.get(loc('tai_bwo_jungle_vegetation_easy_1'), at(LIGHT), null);
  click(p, LIGHT, 'Hack');
  tick(1);
  assert.equal(Jungle._sessions.has(p), false, 'the hack ends');
  assert.equal(varbit(p, 'eventchance'), 0);
  tick(1);
  assert.ok(p.messages.includes('A snake strikes by surprise.'));
  const [snake] = Events._spawned.keys();
  assert.ok(snake, 'a snake');
  assert.equal(snake.getId(), npc('tbwcu_snakejungle_appear'));
  assert.equal(snake.getLocation().getX(), LIGHT[0] + 1, 'on the tile the player left');
  assert.equal(locAt(LIGHT), before.getId(), 'the jungle is left as it was');
  tick(3);
  assert.equal(snake.getId(), npc('tbwcu_village_snake'), 'its attacking form');
  assert.equal(snake.getCombat().getTarget(), p);
});

test('the table follows the Wiki weights, and the gout tuber odds go 1/100 at 10 to 1/33 at 99', (t) => {
  const keys = [];
  for (let n = 0; n < 99; n++) {
    mockRandom(t, () => (n + 0.5) / 99);
    keys.push(Events.pick().key);
    t.mock.restoreAll();
  }
  const count = (key) => keys.filter((k) => k === key).length;
  assert.deepEqual([count('spider'), count('tribesman'), count('snake'), count('mosquito'), count('swarm17'), count('swarm20'), count('gemRock'), count('broodooCombat'), count('broodooPoison'), count('broodooDisease')], [22, 21, 21, 8, 7, 6, 5, 4, 3, 2]);
  assert.equal(Events.goutChance(10), 1 / 100);
  assert.equal(Events.goutChance(99), 1 / 33);
  assert.ok(Events.goutChance(50) > 1 / 100 && Events.goutChance(50) < 1 / 33);
});

test("a gout tuber: the plant, the finder's to dig with a spade, two digs, the tuber, the jungle cut back", (t) => {
  const finder = villager(t, { events: true });
  const other = villager(t, { events: true });
  finder.setLocation(new Location(LIGHT[0] + 1, LIGHT[1], 0));
  other.setLocation(new Location(LIGHT[0] - 1, LIGHT[1], 0));
  finder.setAttribute(Events.COUNTER, 7);
  randoms(t, [0, 0]); // the roll, then the gout tuber
  click(finder, LIGHT, 'Hack');
  tick(2);
  assert.equal(locAt(LIGHT) ?? MapObjects.get(loc('village_gout_tuber'), at(LIGHT), null)?.getId(), loc('village_gout_tuber'));
  assert.ok(finder.messages.includes('You hack away at the remaining bush to reveal an unusual plant.'));
  const plant = MapObjects.get(loc('village_gout_tuber'), at(LIGHT), null);
  // Both online, as the world's player list would say.
  t.mock.method(core.World, 'getPlayerByName', (name) => [finder, other].find((q) => q.getUsername() === name));
  const spade = (p) => PluginManager.emitItemOnObject({ player: p, object: plant, objectId: plant.getId(), item: new Item(obj('spade'), 1), itemId: obj('spade'), itemSlot: 0, location: { x: LIGHT[0], y: LIGHT[1], z: 0 }, handled: false });
  other.getInventory().add(new Item(obj('spade'), 1));
  spade(other);
  assert.deepEqual(other.messages, ["It's not yours to dig."]);
  finder.getInventory().add(new Item(obj('spade'), 1));
  spade(finder);
  tick(5);
  assert.equal(finder.getInventory().getAmount(obj('village_rare_tuber')), 0);
  tick(1);
  assert.equal(finder.getInventory().getAmount(obj('village_rare_tuber')), 1);
  assert.ok(finder.messages.includes('You dig up the plant and find a tuber.'));
  assert.equal(locAt(LIGHT), loc('tai_bwo_jungle_vegetation_easy_5'));
});

test('a gem rock: Mine at 40 with a pickaxe, a gem a swing, 65 XP, three gems and it is gone', (t) => {
  const p = villager(t, { events: true });
  p.setLocation(new Location(LIGHT[0] + 1, LIGHT[1], 0));
  const jungle = MapObjects.get(loc('tai_bwo_jungle_vegetation_easy_1'), at(LIGHT), null);
  Events.revealGemRock(p, Common.data.jungle[0], jungle);
  const rock = () => [1, 2, 3].map((n) => MapObjects.get(loc(`village_gem_rock${n}`), at(LIGHT), null)).find(Boolean);
  assert.equal(rock().getId(), loc('village_gem_rock1'));
  const mine = () => PluginManager.emitObjectInteraction({ player: p, object: rock(), objectId: rock().getId(), definition: ObjectDefinition.forPlayer(rock().getId(), p), clickType: 1, location: { x: LIGHT[0], y: LIGHT[1], z: 0 }, handled: false });
  mine();
  assert.ok(p.messages.includes('You need a Mining level of 40 to mine this rock.'));
  p.getSkillManager().setMaxLevel(core.Skill.MINING, 60).setCurrentLevel(core.Skill.MINING, 60);
  p.messages.length = 0;
  mine();
  assert.deepEqual(p.messages, ['You need a pickaxe to mine this rock.']);
  p.getInventory().add(new Item(obj('rune_pickaxe'), 1));
  mockRandom(t, () => 0);
  const before = p.getSkillManager().getExperience(core.Skill.MINING);
  mine();
  tick(40);
  assert.equal(p.getInventory().getAmount(obj('uncut_opal')), 3, 'opal at the top of the table');
  assert.equal(p.getSkillManager().getExperience(core.Skill.MINING) - before, 65 * 3);
  assert.ok(p.messages.includes('You just mined an Opal!'));
  assert.equal(locAt(LIGHT), loc('tai_bwo_jungle_vegetation_easy_5'));
  assert.equal(GemRock._sessions.has(p), false);
});

function spawnFor(t, p, key) {
  const n = Events.spawn(p, entry(key), new Location(LIGHT[0] + 2, LIGHT[1], 0));
  tick(entry(key).turnAfter);
  return n;
}

test("kills: the threat's favour to the killer with the recorded message; mosquitoes' Agility; spiders only after a claim", (t) => {
  const p = villager(t, { events: true });
  p.setLocation(new Location(2771, 3062, 0));
  const kill = (n) => PluginManager.emitNpcDeath({ npc: n, killer: p, npcId: n.getId(), location: { x: 0, y: 0, z: 0 } });
  const snake = spawnFor(t, p, 'snake');
  kill(snake);
  assert.equal(Favour.points(p), 10);
  assert.ok(p.messages.includes('You gain favour for killing a threat to the village.'));
  const swarm = spawnFor(t, p, 'swarm20');
  const agility = p.getSkillManager().getExperience(core.Skill.AGILITY);
  kill(swarm);
  assert.equal(p.getSkillManager().getExperience(core.Skill.AGILITY) - agility, 75);
  assert.ok(p.messages.includes('You gain experience in agility for defeating such an agile foe.'));
  const spider = spawnFor(t, p, 'spider');
  kill(spider);
  assert.equal(Favour.points(p), 20, 'no spider favour before the first sticks');
  Common.advance(p, 5);
  mockRandom(t, () => 0);
  kill(spawnFor(t, p, 'spider'));
  assert.equal(Favour.points(p), 30, '1-2%');
});

test('a tribesman leaves only bones', (t) => {
  const p = villager(t, { events: true });
  const tribesman = spawnFor(t, p, 'tribesman');
  // NpcDrops' own pass: no table for this tribesman any more, and the bones added as content loot.
  const drops = [];
  PluginManager.emitCustomEvent('npc-drops:add', { player: p, npc: tribesman, npcId: tribesman.getId(), drops });
  assert.deepEqual(drops, [{ itemId: obj('bones'), amount: 1, noted: false }]);
});

test("Broodoo victims: a player's hits do at most 3; the right item hurts, with XP; the wrong one does nothing", (t) => {
  const p = villager(t, { events: true });
  const white = spawnFor(t, p, 'broodooCombat');
  // A multi-hit blow (claws, say): 3 in all between its hits, as it is queued (before its XP).
  const { HitDamage, HitMask } = core;
  const parts = [new HitDamage(20, HitMask.RED), new HitDamage(5, HitMask.RED), new HitDamage(0, HitMask.BLUE)];
  let total = null;
  const hit = { isAccurate: () => true, getHits: () => parts, getHandleAfterHitEffects: () => false, getAttacker: () => p, getTarget: () => white, getTotalDamage: () => total ?? 25, updateTotalDamage() { total = parts.reduce((sum, d) => sum + d.getDamage(), 0); } };
  PluginManager.emitPlayerDealtDamage({ player: p, target: white, hit });
  assert.deepEqual(parts.map((d) => d.getDamage()), [3, 0, 0]);
  assert.equal(total, 3);
  p.getInventory().add(new Item(obj('bones'), 1));
  const use = (n, item) => PluginManager.emitItemOnNpc({ player: p, target: n, npcId: n.getId(), targetIndex: 1, item: new Item(item, 1), itemId: item, slot: 0, interfaceId: 149, handled: false });
  use(white, obj('bones'));
  assert.ok(p.messages.includes('Nothing interesting happens.'));
  p.getInventory().add(new Item(obj('cabbage'), 1));
  mockRandom(t, () => 0);
  const cooking = p.getSkillManager().getExperience(core.Skill.COOKING);
  const hp = white.getHitpoints();
  use(white, obj('cabbage'));
  assert.equal(p.getInventory().getAmount(obj('cabbage')), 0);
  assert.equal(white.getHitpoints(), hp - 10);
  assert.equal(p.getSkillManager().getExperience(core.Skill.COOKING) - cooking, 20, 'twice the 10 it took');
  assert.equal(white.getCombat().getKiller(false), p, "the feeder's damage makes the kill theirs");
  p.getInventory().add(new Item(obj('cabbage') + 1, 1)); // noted
  use(white, obj('cabbage') + 1);
  assert.equal(white.getHitpoints(), hp - 10, 'a noted one does nothing');
  assert.equal(p.getInventory().getAmount(obj('cabbage') + 1), 1);
  const green = spawnFor(t, p, 'broodooPoison');
  const family = { itemId: obj('4doseantipoison'), family: null };
  PluginManager.emitCustomEvent('potions:dose-family', family);
  const [, , , three, four] = family.family.byDose;
  p.getInventory().add(new Item(four, 1));
  use(green, four);
  assert.equal(p.getInventory().getAmount(four), 0);
  assert.equal(p.getInventory().getAmount(three), 1, 'one dose used');
});

test("the poison victim's hit weakens: 1-3 off five combat stats, with the message", (t) => {
  const p = villager(t, { events: true });
  const skills = p.getSkillManager();
  for (const name of ['ATTACK', 'STRENGTH', 'DEFENCE', 'RANGED', 'MAGIC']) skills.setMaxLevel(core.Skill[name], 50).setCurrentLevel(core.Skill[name], 50);
  mockRandom(t, () => 0.999);
  Broodoo.weaken(p);
  for (const name of ['ATTACK', 'STRENGTH', 'DEFENCE', 'RANGED', 'MAGIC']) assert.equal(skills.getCurrentLevel(core.Skill[name]), 47);
  assert.ok(p.messages.includes('You feel incredibly weakened.'));
});

test('a spawn left alone goes after 50 minutes', (t) => {
  const p = villager(t, { events: true });
  const snake = spawnFor(t, p, 'snake');
  tick(3000 - 4);
  assert.equal(Events._spawned.has(snake), true);
  tick(2);
  assert.equal(Events._spawned.has(snake), false);
});

test('a pickup that fills the last slot during a swing: the result cuts nothing and gives nothing', (t) => {
  const p = villager(t);
  mockRandom(t, () => 0);
  p.getInventory().add(new Item(obj('bones'), 27));
  const xpBefore = xp(p);
  click(p, LIGHT, 'Hack');
  tick(5);
  // A shark on the player's own tile, taken through the pickup packet's own handler.
  const { ItemOnGroundManager } = core;
  const { PickupItemPacketListener } = require('../dist/net/packet/impl/PickupItemPacketListener');
  const here = p.getLocation();
  ItemOnGroundManager.registerLocation(p, new Item(obj('shark'), 1), here.clone());
  t.mock.method(p, 'busy', () => false);
  PickupItemPacketListener.pickup(p, obj('shark'), here.getX(), here.getY());
  // Standing on it, the walk-to completes at once (the listener's own callback).
  if (p.getInventory().getAmount(obj('shark')) === 0) p.getMovementQueue().process?.();
  assert.equal(p.getInventory().getFreeSlots(), 0, 'the shark took the last slot');
  tick(2);
  assert.equal(locAt(LIGHT), loc('tai_bwo_jungle_vegetation_easy_1'), 'the jungle is not cut');
  assert.equal(xp(p), xpBefore, 'no XP');
  tick(3);
  assert.equal(Favour.points(p), 0, 'no favour');
  assert.equal(Jungle._sessions.has(p), false);
  assert.ok(p.messages.includes('You have no space in your inventory for any further thatching spars.'));
});

// ------------------------------------------------------------------ #1347 review

/** A shark on the player's tile, taken through the pickup packet's own handler. */
function pickUpShark(t, p) {
  const { ItemOnGroundManager } = core;
  const { PickupItemPacketListener } = require('../dist/net/packet/impl/PickupItemPacketListener');
  const here = p.getLocation();
  ItemOnGroundManager.registerLocation(p, new Item(obj('shark'), 1), here.clone());
  t.mock.method(p, 'busy', () => false);
  PickupItemPacketListener.pickup(p, obj('shark'), here.getX(), here.getY());
  assert.equal(p.getInventory().getAmount(obj('shark')), 1, 'picked up');
}

test('a full bag at the dig: the plant stays, still the finder\'s, and no tuber is lost', (t) => {
  const p = villager(t, { events: true });
  p.setLocation(new Location(LIGHT[0] + 1, LIGHT[1], 0));
  const jungle = MapObjects.get(loc('tai_bwo_jungle_vegetation_easy_1'), at(LIGHT), null);
  Events.revealGout(p, Common.data.jungle[0], jungle);
  const plant = MapObjects.get(loc('village_gout_tuber'), at(LIGHT), null);
  p.getInventory().add(new Item(obj('spade'), 1));
  p.getInventory().add(new Item(obj('bones'), 27));
  PluginManager.emitItemOnObject({ player: p, object: plant, objectId: plant.getId(), item: new Item(obj('spade'), 1), itemId: obj('spade'), itemSlot: 0, location: { x: LIGHT[0], y: LIGHT[1], z: 0 }, handled: false });
  tick(6);
  assert.equal(p.getInventory().getAmount(obj('village_rare_tuber')), 0);
  assert.ok(MapObjects.get(loc('village_gout_tuber'), at(LIGHT), null), 'the plant is still there');
  assert.ok(p.messages.includes("You don't have enough inventory space."));
  assert.ok(!p.messages.includes('You dig up the plant and find a tuber.'));
  assert.equal(Events._finders.get(`${LIGHT[0]},${LIGHT[1]},0`)?.username, p.getUsername(), 'still theirs');
});

test('a pickup filling the bag while mining: no gem taken from the rock, no XP', (t) => {
  const p = villager(t, { events: true });
  p.setLocation(new Location(LIGHT[0] + 1, LIGHT[1], 0));
  p.getSkillManager().setMaxLevel(core.Skill.MINING, 60).setCurrentLevel(core.Skill.MINING, 60);
  p.getInventory().add(new Item(obj('rune_pickaxe'), 1));
  p.getInventory().add(new Item(obj('bones'), 26));
  const jungle = MapObjects.get(loc('tai_bwo_jungle_vegetation_easy_1'), at(LIGHT), null);
  Events.revealGemRock(p, Common.data.jungle[0], jungle);
  const rock = MapObjects.get(loc('village_gem_rock1'), at(LIGHT), null);
  mockRandom(t, () => 0);
  PluginManager.emitObjectInteraction({ player: p, object: rock, objectId: rock.getId(), definition: ObjectDefinition.forPlayer(rock.getId(), p), clickType: 1, location: { x: LIGHT[0], y: LIGHT[1], z: 0 }, handled: false });
  pickUpShark(t, p);
  const before = p.getSkillManager().getExperience(core.Skill.MINING);
  tick(20);
  assert.equal(p.getInventory().getAmount(obj('uncut_opal')), 0);
  assert.equal(p.getSkillManager().getExperience(core.Skill.MINING), before);
  assert.ok(MapObjects.get(loc('village_gem_rock1'), at(LIGHT), null), 'the rock still has its gems');
  assert.equal(GemRock._sessions.has(p), false);
  assert.ok(p.messages.includes('Your inventory is too full to hold any more gems.'));
});

test('a Broodoo victim takes its attacking form at full health (100), not its hidden form\'s', (t) => {
  const p = villager(t, { events: true });
  for (const key of ['broodooCombat', 'broodooPoison', 'broodooDisease']) {
    const victim = spawnFor(t, p, key);
    assert.equal(victim.getHitpoints(), 100, key);
    assert.equal(victim.getHitpoints(), victim.getMaxHitpoints());
  }
});

test('the poison victim weakens only when its hit lands and hurts', (t) => {
  const p = villager(t, { events: true });
  const skills = p.getSkillManager();
  skills.setMaxLevel(core.Skill.ATTACK, 50).setCurrentLevel(core.Skill.ATTACK, 50);
  const green = spawnFor(t, p, 'broodooPoison');
  const Method = Broodoo.combatClass();
  const blow = () => {
    const method = new Method(green);
    method.start(green, p);
    return method.hits(green, p)[0].getHits()[0];
  };
  blow(); // dropped with its caster: never applied
  tick(4);
  assert.equal(skills.getCurrentLevel(core.Skill.ATTACK), 50, 'a hit that never lands drains nothing');
  blow().notifyApplied(0);
  assert.equal(skills.getCurrentLevel(core.Skill.ATTACK), 50, 'a hit that does nothing drains nothing');
  blow().notifyApplied(4);
  assert.ok(skills.getCurrentLevel(core.Skill.ATTACK) < 50);
  assert.ok(p.messages.includes('You feel incredibly weakened.'));
});


// Exercise an earned first claim through the registered fence, NPC and dialogue handlers.
test('native villager rewards preserve earned favour when trading sticks cannot fit', async (t) => {
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { SkillManager } = require('../dist/game/content/skill/SkillManager');
  const { MAX_STACK_AMOUNT } = require('../dist/game/model/container/StackType');
  const stick = obj('village_trade_sticks');
  const spar = obj('thatching_spar_light');
  const murcaily = Common.data.villagers.find((v) => v.first === true);
  assert.equal(murcaily.name, 'Murcaily');
  assert.equal(stick, core.ItemIdentifiers.TRADING_STICKS);
  assert.equal(core.ItemDefinition.forId(stick).isStackable(), true);
  assert.equal(Common.data.spars.find((s) => s.item === 'thatching_spar_light').points, 1);

  for (const mode of ['room', 'last stack space', 'full pack without sticks', 'capped stack']) {
    await t.test(mode, async (t) => {
      const channel = {
        kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
        close() {}, onData() {}, onError() {}, onClose() {},
      };
      const p = new Player(new PlayerSession(channel));
      p.setIndex(index++);
      p.setUsername('stickclaim' + p.getIndex());
      p.setRegistered(true);
      p.setLocation(new Location(FENCE[0] + 1, FENCE[1], FENCE[2]));
      p.needsPlacement = false;
      const connection = new ClientConnection(channel);
      connection.player = p;
      // Quest completion and the explanation are prior state; the repair earns the favour.
      jungleQuest.setStage(p, jungleQuest.completionValue);
      Common.advance(p, Common.data.progress.told);
      assert.equal(jungleQuest.isComplete(p), true);
      assert.equal(Favour.points(p), 0);
      PluginManager.emitPlayerLogin({ player: p, username: p.getUsername() });
      p.closeInterruptibleInterfaces();
      const skills = p.getSkillManager();
      const woodcutting = core.Skill.WOODCUTTING;
      skills.setExperience(woodcutting, SkillManager.getExperienceForLevel(99))
        .setMaxLevel(woodcutting, 99).setCurrentLevel(woodcutting, 99);
      assert.equal(skills.getMaxLevel(woodcutting), 99);
      assert.equal(skills.getCurrentLevel(woodcutting), 99);
      const inv = p.getInventory();
      const machete = obj('machette_redtopaz');
      p.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(machete));
      inv.add(new Item(spar), false);
      const near = mode === 'last stack space' || mode === 'capped stack';
      if (near) inv.add(new Item(stick, MAX_STACK_AMOUNT - 1), false);
      const npc = core.NPC.create(id('Npc', `${murcaily.npc}_multinpc`) ?? id('Npc', murcaily.npc),
        new Location(FENCE[0] + 1, FENCE[1] + 1, FENCE[2]));
      assert.equal(core.World.getNpcs().add(npc), true);
      assert.equal(npc.getCurrentDefinition(p).getName(), murcaily.name);
      t.after(() => {
        p.closeInterruptibleInterfaces();
        PluginManager.emitPlayerDisconnect({ player: p, username: p.getUsername() });
        PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
        p.setRegistered(false);
        core.TaskManager.cancelTasks(p.getIndex());
        core.TaskManager.cancelTasks(p);
        core.World.getNpcs().remove(npc);
        for (const ground of core.World.getItems().filter((g) => g.getOwner() === p.getUsername())) {
          core.ItemOnGroundManager.deregister(ground);
        }
      });
      const gains = [];
      const addXp = skills.addExperience.bind(skills);
      t.mock.method(skills, 'addExperience', (skill, amount, multipliers) => {
        gains.push({ skill: skill.getIndex(), amount, multipliers: !!multipliers });
        return addXp(skill, amount, multipliers);
      });
      const stores = (itemId) => ({
        inventory: inv.getAmount(itemId), equipment: p.getEquipment().getAmount(itemId),
        bank: p.getBanks().reduce((n, b, tab) => n +
          (b && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(itemId) : 0), 0),
        floor: core.World.getItems().filter((g) => !g.isPendingRemoval() && g.getOwner() === p.getUsername() &&
          g.getPrivateArea() === p.getPrivateArea() && g.getItem().getId() === itemId)
          .reduce((n, g) => n + g.getItem().getAmount(), 0),
      });
      const owned = (itemId) => Object.values(stores(itemId)).reduce((n, amount) => n + amount, 0);
      const state = () => ({
        mode, sticks: stores(stick), favour: Favour.points(p), cooldown: Villagers.cooldownOf(p, murcaily),
        progress: Common.progress(p), spar: stores(spar), machete: stores(machete), gains: [...gains],
      });
      let turns = 0;
      const turn = () => {
        assert.ok(++turns <= 48, 'bounded native phase budget');
        p.resetUpdating();
        cycle++;
        core.TaskManager.process();
        connection.processTurnPackets();
        const queue = p.getMovementQueue();
        queue.beginCycle();
        queue.processEntityPursuit();
        if (queue.hasPendingWork()) queue.process();
        core.TaskManager.processWalkTo(p.getIndex());
      };
      const send = async (packet) => { await connection.dispatch([packet]); turn(); };
      if (mode === 'capped stack') {
        const here = p.getLocation();
        core.ItemOnGroundManager.registerLocation(p, new Item(stick), here.clone());
        assert.equal(stores(stick).floor, 1);
        await send({ type: 'ground_item_action', itemId: stick, x: here.getX(), y: here.getY(), option: 'Take', optionIndex: 3 });
        for (let n = 0; n < 6 && stores(stick).floor; n++) turn();
        assert.equal(inv.getAmount(stick), MAX_STACK_AMOUNT, 'native pickup fills the stack');
        assert.equal(stores(stick).floor, 0);
      }
      const fence = Locs.find(Common.data.fence.locs.map(loc), at(FENCE));
      assert.ok(fence, 'actual loaded fence');
      const option = ObjectDefinition.forPlayer(fence.getId(), p).getInteractions().indexOf('Repair') + 1;
      assert.ok(option > 0);
      const xpBefore = skills.getExperience(woodcutting);
      await send({ type: 'object_option', id: fence.getId(), x: FENCE[0], y: FENCE[1], clickType: option, action: 'Repair' });
      for (let n = 0; n < 22 && Favour.points(p) === 0; n++) turn();
      assert.equal(Favour.points(p), 1, 'repair earns one favour point');
      assert.equal(owned(spar), 0, 'repair consumes the light spar');
      assert.equal(Common.progress(p), Common.data.progress.repaired);
      assert.ok(skills.getExperience(woodcutting) > xpBefore);
      assert.equal(skills.getCurrentLevel(woodcutting), 99);
      assert.equal(skills.getMaxLevel(woodcutting), 99);
      assert.deepEqual(gains, [{ skill: woodcutting.getIndex(), amount: 28.1, multipliers: false }]);
      if (mode === 'full pack without sticks') {
        while (inv.getFreeSlots() > 0) inv.add(new Item(core.ItemIdentifiers.LOGS), false);
      }
      const logs = stores(core.ItemIdentifiers.LOGS);
      const repairGains = gains.map((g) => ({ ...g }));
      assert.equal(Villagers.canClaim(p, murcaily), true);
      assert.equal(Villagers.cooldownOf(p, murcaily), 1);
      assert.equal(Villagers.sticksFor(Favour.points(p)), 1, 'the current invoice');
      assert.equal(inv.getAddableAmount(new Item(stick)), mode === 'capped stack' || mode === 'full pack without sticks' ? 0 : 1);
      const before = state();
      const valueBefore = owned(stick) + Favour.points(p);
      const talkOption = npc.getCurrentDefinition(p).getActions().indexOf('Talk-to') + 1;
      assert.ok(talkOption > 0);
      await send({ type: 'npc_option', index: npc.getIndex(), clickType: talkOption });
      const manager = p.getDialogueManager();
      const sender = p.getPacketSender();
      const speech = manager.getCurrent();
      assert.ok(speech instanceof core.NpcDialogue);
      assert.equal(speech.getText(), Common.message('firstClaim'));
      assert.equal(manager.getOwner(), undefined);
      assert.equal(sender.getChatboxGroupId(), 231);
      const mount = sender.subInterfaceTargets.get(231);
      assert.ok(mount);
      assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
      assert.deepEqual(state(), before, 'the offer does not consume resources');
      await send({ type: 'dialogue_continue', widgetId: (231 << 16) | 5, childIndex: -1 });
      const end = state();
      const details = JSON.stringify({ before, after: end });
      assert.equal(owned(stick) + Favour.points(p), valueBefore, 'earned favour/payment conservation: ' + details);
      const credited = owned(stick) - Object.values(before.sticks).reduce((n, amount) => n + amount, 0);
      assert.ok(credited === 0 || credited === 1, details);
      if (mode === 'room' || mode === 'last stack space') assert.equal(credited, 1, details);
      if (mode === 'full pack without sticks') assert.equal(credited, 0, details);
      assert.equal(Favour.points(p), 1 - credited, details);
      assert.equal(Villagers.cooldownOf(p, murcaily), credited ? 7 : 1, details);
      assert.equal(Common.progress(p), credited ? Common.data.progress.claimed : Common.data.progress.repaired, details);
      assert.deepEqual(stores(core.ItemIdentifiers.LOGS), logs);
      assert.equal(owned(spar), 0);
      assert.equal(owned(machete), 1);
      assert.deepEqual(gains, repairGains, 'the payout adds no XP beyond the repair');
    });
  }
});
