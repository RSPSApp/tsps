// Build first: node --test tests/birthday-anniversary.test.cjs
// The 25th Anniversary event (2026 birthday): archive install/cleanup, the cache's own
// varbit-driven forms, all-or-nothing rewards, transcript conditions and the cake.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { MapRegionReplacementManager } = require('../dist/game/collision/MapRegionReplacementManager');
const Data = require('../plugins/world/seasonal/Data.BirthdayAnniversary');
const Progress = require('../plugins/world/seasonal/Progress.BirthdayAnniversary');
const Scene = require('../plugins/world/seasonal/Scene.BirthdayAnniversary');
const Actors = require('../plugins/world/seasonal/Actors.BirthdayAnniversary');
const Rewards = require('../plugins/world/seasonal/Rewards.BirthdayAnniversary');
const Dialogue = require('../plugins/world/seasonal/Dialogue.BirthdayAnniversary');
const Interactions = require('../plugins/world/seasonal/Interactions.BirthdayAnniversary');
const source = require('../plugins/world/seasonal/data/anniversary-2026-archive.json');
let core, api;
const quests = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  require('../plugins/world/DefinitionArchives.plugin').register(PM.createApi('DefinitionArchives'));
  require('../plugins/world/HolidayRewards.plugin').register(PM.createApi('HolidayRewards'));
  api = PM.createApi('BirthdayAnniversaryEvents');
  require('../plugins/world/BirthdayAnniversary.plugin').register(api);
  PM.createApi('QuestFixture').onCustomEvent('quest:is-complete', request => { if (quests.has(request.key)) request.complete = quests.get(request.key); });
});
after(() => setActive(false));
// Through the real scheduler: the reward goes through events:grant-reward, which trusts only its window.
const { setWindow } = require('./helpers/event-window.cjs');
function setActive(active) { setWindow(PM, Data.EVENT_KEY, active); }
function fixture(name = 'bdaytest') {
  const p = new Player(null);
  p.setUsername(name);
  // Only the network and world membership are stubbed: inventory, attributes and varbit sync are real.
  p.getSession = () => ({ sendClientPacket: () => true });
  p.isRegistered = () => true;
  const varbits = new Map(), messages = [];
  const sender = p.getPacketSender();
  sender.sendVarbit = (id, value) => { varbits.set(id, value); return sender; };
  p.sendMessage = message => messages.push(message);
  return { p, varbits, messages };
}
function varbit(name) { return core.CacheDefinitions.getVarbitId(name); }
function npcType(symbol) { return core.CacheDefinitions.getNpc(core.CacheDefinitions.getArchivedId(Data.BUNDLE, 'npc', symbol)); }
function formAt(symbol, progress) {
  const vars = { getVarbit: () => progress, getVarp: () => 0 };
  return npcType(symbol).transform(vars, { load: id => core.CacheDefinitions.getNpc(id) })?.name;
}

test('opening installs the archive, scenery and Realm; closing restores the world exactly, and reopens cleanly', () => {
  const bundlesBefore = JSON.stringify(core.CacheDefinitions.getDefinitionArchiveBundles());
  const regionsBefore = MapRegionReplacementManager.getRegionIds();
  const objectsBefore = core.World.getObjects().length;
  const npcsBefore = [...core.World.getNpcs()].filter(Boolean).length;
  for (let round = 0; round < 2; round++) {
    setActive(true);
    assert.equal(Scene.active(), true);
    assert.ok(core.CacheDefinitions.getArchivedId(Data.BUNDLE, 'npc', '25th_host_follower') >= core.CacheDefinitions.getCounts().npcs - 30);
    assert.ok(core.CacheDefinitions.getArchivedId(Data.BUNDLE, 'seq', '25th_portal_swirl') !== null);
    for (const [x, y] of Data.REALM_SQUARES) assert.ok(MapRegionReplacementManager.getRegionIds().includes((x << 8) | y), 'Realm square replaced');
    for (const role of ['outside', 'hat', 'inside', 'portal', 'thief', 'realm', 'grayzag']) assert.ok(Actors.parentFor(api, role), role + ' actor spawned');
    // A ritual tile stands upstairs in the Varrock house.
    const tile = core.ObjectManager.objectsAt(new core.Location(3234, 3384, 1)).find(object => Scene.archivedSymbol(api, 'loc', object.getId()) === '25th_grid_runescape_multi');
    assert.ok(tile, 'the RuneScape memento tile is placed');
    setActive(false);
    assert.equal(Scene.active(), false);
    assert.equal(JSON.stringify(core.CacheDefinitions.getDefinitionArchiveBundles()), bundlesBefore);
    assert.deepEqual(MapRegionReplacementManager.getRegionIds(), regionsBefore);
    assert.equal(core.World.getObjects().length, objectsBefore);
    assert.equal([...core.World.getNpcs()].filter(Boolean).length, npcsBefore);
  }
});

test('progress phases land on the ranges the rev236 cache gives each varbit-driven form', () => {
  setActive(true);
  try {
    const V = Progress.PROGRESS_VALUE;
    assert.equal(formAt('rooftops_bigredjapan', V.briefed), 'BigRedJapan');
    assert.deepEqual(npcType('rooftops_bigredjapan_op').actions.filter(Boolean), ['Talk-to']);
    assert.equal(core.CacheDefinitions.getNpc(npcType('rooftops_bigredjapan').transform({ getVarbit: () => V.collecting, getVarp: () => 0 },
      { load: id => core.CacheDefinitions.getNpc(id) }).id).actions[0], 'Talk-to');
    assert.equal(formAt('25th_host_inside', V.collecting), undefined, 'Gary is not upstairs while collecting');
    assert.equal(formAt('25th_host_inside', V.returned), 'Gary');
    assert.equal(formAt('25th_portal_multi', V.ritual), undefined, 'no portal before the cutscene step');
    assert.equal(formAt('25th_portal_multi', V.portal), '<col=00ffff>Portal</col>');
    assert.equal(formAt('25th_grayzag', V.realm), 'Wizard Grayzag');
    assert.equal(formAt('25th_grayzag', V.rewarding), undefined, 'Grayzag departs');
    assert.equal(formAt('25th_host_realm', V.complete), 'Wizard Gary');
  } finally { setActive(false); }
});

test('mementos collect once each, only while collecting, and every tile varbit follows', () => {
  setActive(true);
  try {
    const { p, varbits } = fixture('bdaymem');
    assert.equal(Progress.collect(api, p, 'lowe'), false, 'not before setting off with Gary');
    for (const [from, to] of [['new', 'agreed'], ['agreed', 'briefed'], ['briefed', 'collecting']]) assert.ok(Progress.advance(api, p, from, to));
    assert.ok(Progress.collect(api, p, 'lowe'));
    assert.equal(Progress.collect(api, p, 'lowe'), false, 'a replayed hand-over changes nothing');
    for (const skill of ['ranged', 'fletching', 'fishing']) assert.equal(varbits.get(varbit('25th_tile_' + skill)), 1);
    assert.equal(varbits.get(varbit('25th_tile_attack')), 0);
    assert.equal(varbits.get(varbit('25th_progress')), Progress.PROGRESS_VALUE.collecting);
    assert.equal(Progress.nextStop(Progress.read(p)).key, 'swordshop', 'the hint names the first stop still missing');
    for (const stop of Data.STOPS) Progress.collect(api, p, stop.key);
    assert.equal(Progress.allCollected(Progress.read(p)), true);
    assert.equal(Data.SKILLS.length, 24);
  } finally { setActive(false); }
});

test('rewards are all or nothing with a full inventory, given once, and the jug note stacks', (t) => {
  setActive(true);
  t.after(() => setActive(null));
  const { p } = fixture('bdayreward');
  const I = core.ItemIdentifiers, inventory = p.getInventory();
  Progress.markComplete(api, p);
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new core.Item(I.BRONZE_DAGGER, 1));
  const request = { player: p, needed: 0 };
  Rewards.space(api, request);
  assert.equal(request.needed, 5);
  Rewards.grant(api, { player: p });
  assert.equal(Progress.rewarded(p), false);
  assert.equal(inventory.getAmount(I._25TH_ANNIVERSARY_HELMET), 0);
  for (let slot = 1; slot < 5; slot++) inventory.setItem(slot, new core.Item(-1, 0));
  inventory.setItem(5, new core.Item(I.HALF_FULL_WINE_JUG_2, 3));
  Rewards.space(api, request);
  assert.equal(request.needed, 0, 'four free slots suffice when the jug note already stacks');
  Rewards.grant(api, { player: p });
  Rewards.grant(api, { player: p });
  assert.equal(Progress.rewarded(p), true);
  for (const name of Data.REWARDS) assert.equal(inventory.getAmount(I[name]), 1, name);
  assert.equal(inventory.getAmount(I.HALF_FULL_WINE_JUG_2), 5);
  assert.deepEqual(p.getAttribute('events:completions'), [Data.EVENT_KEY], 'the grant records its once-per-account completion');
});

test('a save rewarded before EventScheduler kept completions is imported on login and never rewarded again', (t) => {
  setActive(true);
  t.after(() => setActive(null));
  const { p } = fixture('bdaylegacy');
  const I = core.ItemIdentifiers;
  Progress.markComplete(api, p);
  Progress.markRewarded(p);
  Rewards.importClaim(api, { player: p });
  Rewards.importClaim(api, { player: p });
  assert.deepEqual(p.getAttribute('events:completions'), [Data.EVENT_KEY]);
  Rewards.grant(api, { player: p });
  assert.equal(p.getInventory().getAmount(I._25TH_ANNIVERSARY_HELMET), 0);
});

test('a rolled-back save whose completion is recorded settles its progress instead of granting again', (t) => {
  setActive(true);
  t.after(() => setActive(null));
  const { p } = fixture('bdayrollback');
  Progress.markComplete(api, p);
  api.emitCustomEvent('events:record-completion', { player: p, completion: Data.EVENT_KEY });
  Rewards.grant(api, { player: p });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers._25TH_ANNIVERSARY_HELMET), 0);
  assert.equal(Progress.rewarded(p), true);
});

test('a full inventory at the reward step: Diango keeps the cosmetics after the window, with no second set', () => {
  const { p } = fixture('bdaydiango');
  const names = core.CacheDefinitions.getObjNames(), inventory = p.getInventory(), I = core.ItemIdentifiers;
  const unlocked = () => p.getAttribute('holiday-rewards:unlocked') ?? [];
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new core.Item(I.BRONZE_DAGGER, 1));
  setActive(true);
  Progress.markComplete(api, p);
  PM.emitCustomEvent('birthday-2026:reward', { player: p });
  assert.equal(Progress.rewarded(p), false, 'the hand-out waits for space');
  assert.equal(unlocked().length, 0, 'nothing is claimable from Diango while Wizard Gary still holds it');
  setActive(false);
  // Closing settles online players; this fixture is not in the world list, so it logs in after.
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.equal(Progress.rewarded(p), true, 'the closed window settles it');
  assert.deepEqual(p.getAttribute('events:completions'), [Data.EVENT_KEY], 'settling records the completion outside the window');
  for (const name of Data.REWARDS) assert.ok(unlocked().includes(names.get(I[name])), name + ' claimable from Diango');
  // A reopened window cannot hand out a second set on top of Diango's.
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new core.Item(-1, 0));
  setActive(true);
  try {
    PM.emitCustomEvent('birthday-2026:reward', { player: p });
    for (const name of Data.REWARDS) assert.equal(inventory.getAmount(I[name]), 0, name);
  } finally { setActive(false); }
});

test('transcript conditions read real quest state, the 20th Anniversary absence and completion', () => {
  setActive(true);
  try {
    const { p } = fixture('bdaycond');
    const ask = (text, page = Data.PAGE, stepId) => Dialogue.condition(api, { player: p, text, stepId, pages: [{ page }] });
    quests.set(Data.QUESTS.impCatcher, true);
    assert.equal(ask('If Imp Catcher has been completed:'), true);
    assert.equal(ask('If the player has not completed Imp Catcher:'), false);
    quests.set(Data.QUESTS.impCatcher, false);
    assert.equal(ask('If Imp Catcher has been completed:'), false);
    assert.equal(ask("If the player hasn't previously completed the 20th Anniversary event:"), true);
    assert.equal(ask('If the player has previously completed the 20th Anniversary event:'), false);
    assert.equal(ask("If Gary isn't with the player:"), true);
    assert.equal(ask('If Gary is with the player:'), false);
    assert.equal(ask('If the player has completed the 25th Anniversary event:', 'Wizard Grayzag'), false);
    Progress.markComplete(api, p);
    assert.equal(ask('If the player has completed the 25th Anniversary event:', 'Wizard Grayzag'), true, 'his ordinary page remembers it');
    assert.equal(ask('An unmodelled condition:'), false, 'no guessed truth');
    assert.equal(ask('If Imp Catcher has been completed:', 'Some other page'), undefined, 'other pages are left alone');
  } finally { setActive(false); }
});

test('a slice of birthday cake eats during the event and goes off afterwards', () => {
  const { p } = fixture('bdaycake'), id = core.ItemIdentifiers.SLICE_OF_BIRTHDAY_CAKE;
  p.getInventory().addItem(new core.Item(id, 1));
  p.getInventory().addItem(new core.Item(id, 1));
  setActive(true);
  const during = { player: p, area: 'birthday-event', inside: false, message: 'default' };
  PM.emitCustomEvent('food:area', during);
  assert.equal(during.inside, true);
  setActive(false);
  const afterwards = { player: p, area: 'birthday-event', inside: false, message: 'default' };
  PM.emitCustomEvent('food:area', afterwards);
  assert.equal(afterwards.inside, false);
  assert.equal(afterwards.message, 'The cake seems to have gone off. How sad.');
  assert.equal(p.getInventory().getAmount(id), 0, 'every slice is thrown away');
});

test('the Realm map squares re-encode to the original loc file bytes', () => {
  setActive(true);
  try {
    const { decodeLocs } = require('../scripts/import-anniversary-definitions.cjs');
    for (const square of source.realm) {
      const encoded = Scene.encodeLocs(core, square.locs);
      const decoded = decodeLocs(encoded);
      assert.equal(decoded.length, square.locs.length);
      const expected = square.locs.map(([identity, position, flags]) => [typeof identity === 'number' ? identity
        : core.CacheDefinitions.getArchivedId(Data.BUNDLE, 'loc', identity), position, flags].join(':')).sort();
      assert.deepEqual(decoded.map(row => [row.id, row.position, row.flags].join(':')).sort(), expected);
    }
  } finally { setActive(false); }
});

test('Interactions route memento sources by cache name, and the event Thief by archive', () => {
  setActive(true);
  try {
    assert.ok(Interactions.interact);
    const harlow = core.NPC.create(core.CacheDefinitions.getNpcId('dr_harlow'), new core.Location(3222, 3397, 0));
    const { p } = fixture('bdayroute');
    const event = { player: p, npc: harlow, npcId: harlow.getId(), clickType: 1, handled: false };
    Interactions.interact(api, event);
    assert.equal(event.handled, false, 'before setting off Dr Harlow keeps his ordinary dialogue');
  } finally { setActive(false); }
});

test('BigRedJapan yields to his event version through the spawn loader, loaded or still pending', () => {
  const { NpcSpawnDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcSpawnDefinitionLoader');
  const { NpcSpawnDefinition } = require('../dist/game/definition/NpcSpawnDefinition');
  const roof = new core.Location(3232, 3401, 3), nativeId = core.CacheDefinitions.getNpcId('rooftops_bigredjapan');
  const loader = new NpcSpawnDefinitionLoader();
  const spawnFile = () => {
    const definitions = [loader.toDefinition({ id: nativeId, x: 3232, y: 3401, level: 3, direction: 6, wanderRadius: 0 }, 'test')];
    NpcSpawnDefinition.replace(definitions);
    loader.applyToWorld(definitions);
  };
  const natives = () => [...core.World.getNpcs()].filter(npc => npc?.getId() === nativeId && npc.getSpawnPosition().equals(roof));
  const eventCopies = () => [...core.World.getNpcs()].filter(npc => npc && Scene.archivedSymbol(api, 'npc', npc.getId()) === 'rooftops_bigredjapan');
  try {
    // Pending when the window opens: the first visitor sees only the event version.
    spawnFile();
    setActive(true);
    NpcSpawnDefinitionLoader.activateNear(roof);
    assert.equal(natives().length, 0);
    assert.equal(eventCopies().length, 1);
    setActive(false);
    NpcSpawnDefinitionLoader.activateNear(roof);
    assert.equal(natives().length, 1, 'he comes back through the loader');
    assert.ok(natives()[0].getSpawnLineage(), 'still tracked by the spawn loader');
    assert.equal(eventCopies().length, 0);
    // Already standing there when the window opens.
    setActive(true);
    assert.equal(natives().length, 0);
    assert.equal(eventCopies().length, 1);
    setActive(false);
    NpcSpawnDefinitionLoader.activateNear(roof);
    assert.equal(natives().length, 1);
  } finally {
    setActive(false);
    loader.applyToWorld([]);
    for (const npc of natives()) core.World.getNpcs().remove(npc);
    NpcSpawnDefinition.replace([]);
  }
});

test('a finished memento talk does not hijack the source\'s ordinary menu later', () => {
  setActive(true);
  try {
    const { p } = fixture('bdayhijack');
    for (const [from, to] of [['new', 'agreed'], ['agreed', 'briefed'], ['briefed', 'collecting']]) Progress.advance(api, p, from, to);
    const aubury = core.NPC.create(core.CacheDefinitions.getNpcId('aubury'), new core.Location(3253, 3402, 0));
    Progress.collect(api, p, 'aubury');
    const event = { player: p, npc: aubury, npcId: aubury.getId(), clickType: 1, handled: false };
    Interactions.interact(api, event);
    assert.equal(event.handled, false, 'Aubury talks normally once his mementos are given');
    const choice = { player: p, npc: aubury, option: 'Yes please!', end: false };
    Dialogue.choice(api, choice);
    assert.equal(choice.end, false, 'his own "Yes please!" is not re-routed');
  } finally { setActive(false); }
});
