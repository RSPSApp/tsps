// From server/: node --test tests/enlightened-journey-taverley.test.cjs (after yarn build).
//
// Enlightened Journey, after the quest: the first balloon trip from Taverley back to Entrana leaves
// Assistant Stan with the Taverley balloon (zep_multi_piccard 2, three ticks after landing as the
// rev 242 recording has it, kept over logout); Taverley's "Yes." opens the balloon map; and the
// flight's 40kg limit is in kg, the cache's weights being grams.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;

const PICCARD_VARBIT = 2868;
const STAGE_KEY = 'quest.enlightened_journey.stage';
const COMPLETE = 200;
const AUGUSTE = core.NpcIdentifiers.AUGUSTE;
let handlers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  handlers = { actions: [], conditions: [], logins: [], arrivals: [], emitted: [] };
  const api = new Proxy({
    core,
    onNpcDialogueCondition: (fn) => handlers.conditions.push(fn),
    onPlayerLogin: (fn) => handlers.logins.push(fn),
    onCustomEvent: (name, fn) => {
      if (name === 'npc-dialogue:action') handlers.actions.push(fn);
      if (name === 'balloon-transport:passenger-arrival') handlers.arrivals.push(fn);
    },
    emitCustomEvent: (name, event) => handlers.emitted.push([name, event]),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/EnlightenedJourney.Quest')(api);
});

function fakePlayer({ stage = COMPLETE, items = [] } = {}) {
  const attributes = { [STAGE_KEY]: stage };
  const varbits = {};
  const equipment = Array.from({ length: 14 }, () => new core.Item(-1, 0));
  const player = {
    attributes, varbits, messages: [], location: null,
    getAttribute: (k) => attributes[k],
    setAttribute: (k, v) => { attributes[k] = v; },
    moveTo: (to) => { player.location = to; },
    sendMessage: (m) => player.messages.push(m),
    getUsername: () => 'ejtest',
    isRegistered: () => true,
    getLocation: () => player.location ?? new core.Location(2938, 3421, 0),
    getInventory: () => ({ getItems: () => items, getFreeSlots: () => 28 - items.length, getAmount: () => 0 }),
    getEquipment: () => ({ getItems: () => equipment, get: (slot) => equipment[slot] }),
    getPacketSender: () => ({
      sendVarbit: (id, v) => { varbits[id] = v; },
      sendConfig() {}, sendString() {}, sendInterfaceDisplayState() {}, sendClientScript() {},
    }),
  };
  return player;
}

const condition = (player, stepId) => handlers.conditions.map((fn) => fn({ npcId: AUGUSTE, player, stepId, text: '' })).find((v) => v !== null && v !== undefined);
const login = (player) => handlers.logins.forEach((fn) => fn({ player }));

test("the flight's weight limit is 40kg: ten logs (20kg) fly, a pack of rune platebodies doesn't", () => {
  const light = fakePlayer({ items: Array.from({ length: 10 }, () => new core.Item(I.LOGS, 1)) });
  assert.equal(condition(light, 'G1OzvY'), false, '20kg carried');
  const heavy = fakePlayer({ items: Array.from({ length: 6 }, () => new core.Item(I.RUNE_PLATEBODY, 1)) });
  assert.equal(condition(heavy, 'G1OzvY'), true, 'over 40kg carried');
});

test("Taverley's \"Yes.\" after the quest opens the balloon map, not a trip (rev 242 tick 2218)", () => {
  const player = fakePlayer();
  const action = { player, npcId: AUGUSTE, stepId: 'LQAzz1', handled: false };
  handlers.actions.forEach((fn) => fn(action));
  assert.equal(action.handled, true);
  assert.equal(action.end, true);
  assert.equal(player.location, null, 'not moved');
  assert.deepEqual(handlers.emitted.map(([name]) => name), ['balloon-transport:open-map']);
});

test('flown back to Entrana from Taverley after the quest, Taverley keeps Assistant Stan, over logout too', () => {
  const player = fakePlayer();
  login(player);
  assert.equal(player.varbits[PICCARD_VARBIT], 1, 'Auguste at Taverley until then');
  const arrive = (who, from) => handlers.arrivals.forEach((fn) => fn({ player: who, station: 'entrana', origin: { station: from } }));
  arrive(player, 'craft');
  assert.equal(player.attributes['quest.enlightened_journey.taverley_stan'], undefined, 'only the trip from Taverley');
  arrive(player, 'taverley');
  assert.equal(player.varbits[PICCARD_VARBIT], 1, 'not on the landing tick');
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  assert.equal(player.varbits[PICCARD_VARBIT], 2, 'Assistant Stan three ticks later');
  const relogged = fakePlayer();
  relogged.attributes['quest.enlightened_journey.taverley_stan'] = player.attributes['quest.enlightened_journey.taverley_stan'];
  login(relogged);
  assert.equal(relogged.varbits[PICCARD_VARBIT], 2);
  const midQuest = fakePlayer({ stage: 100 });
  login(midQuest);
  assert.equal(midQuest.varbits[PICCARD_VARBIT], 1, 'landed but not complete: Auguste');
});
