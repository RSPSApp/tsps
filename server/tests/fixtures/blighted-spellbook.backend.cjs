// Plain-Node compiled-server half of the joined client regression. No listener or Server.main.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

async function main() {
  assert.equal(process.env.NODE_OPTIONS, undefined);
  assert.equal(process.env.NODE_PATH, undefined);
  const server = path.resolve(__dirname, '../..');
  const profile = process.argv[2];
  assert.ok(['ordinary', 'mage-bank', 'pvp'].includes(profile), 'one fixed episode profile');
  const os = require('node:os');
  const worldModule = require.resolve('../../dist/game/definition/WorldDefinition');
  assert.equal(require.cache[worldModule], undefined, 'profile precedes native world imports');
  const shippedWorld = JSON.parse(fs.readFileSync(path.join(server, 'data/definitions/world.json'), 'utf8'));
  assert.equal(fs.existsSync(path.join(server, 'data/definitions/world.local.json')), false,
    'no inherited deployment world override');
  const profileWorld = structuredClone(shippedWorld);
  if (profile === 'pvp') profileWorld.zones.push({ tags: ['pvp'] });
  assert.deepEqual(profileWorld.plugins, shippedWorld.plugins, 'same selected plugin switches');
  assert.deepEqual(profileWorld.pluginConfig, shippedWorld.pluginConfig, 'same selected plugin configuration');
  const privateTemp = fs.realpathSync(os.tmpdir());
  const profileDirectory = fs.mkdtempSync(path.join(privateTemp, 'blighted-2321-profile-'));
  const originalCwd = process.cwd();
  let nativeWorld, profileFailure;
  try {
    assert.equal(path.dirname(fs.realpathSync(profileDirectory)), privateTemp, 'owned profile under private TEMP');
    fs.mkdirSync(path.join(profileDirectory, 'data/definitions'), { recursive: true });
    fs.writeFileSync(path.join(profileDirectory, 'data/definitions/world.json'), JSON.stringify(profileWorld));
    process.chdir(profileDirectory);
    // Same actual loader pattern as world-local-config.test.cjs, before any dependent import.
    nativeWorld = require(worldModule);
    assert.deepEqual(nativeWorld.getWorldDefinition().zones,
      nativeWorld.parseWorldDefinition(profileWorld).zones, 'native parsed profile zones');
  } catch (error) {
    profileFailure = error;
  } finally {
    try { process.chdir(originalCwd); } catch (error) { profileFailure ??= error; }
    try {
      assert.equal(path.dirname(path.resolve(profileDirectory)), privateTemp, 'owned profile cleanup containment');
      fs.rmSync(profileDirectory, { recursive: true, force: false });
    } catch (error) { profileFailure ??= error; }
  }
  if (profileFailure) throw profileFailure;
  const { Server } = require('../../dist/Server');
  Server.installProductionPathResolver();
  const { CachePipeline } = require('../../dist/game/cache/CachePipeline');
  const { CacheDefinitions } = require('../../dist/game/cache/CacheDefinitions');
  const { PluginManager: PM } = require('../../dist/plugins/PluginManager');
  const { ClientConnection } = require('../../dist/net/NetworkBuilder');
  const { World } = require('../../dist/game/World');
  const core = PM.getCoreApi();
  assert.equal(core.CacheDefinitions, CacheDefinitions, 'one compiled server graph');
  assert.equal(core.WorldDefinition, nativeWorld, 'same native configured world graph');
  assert.equal(core.WorldDefinition.hasGlobalWorldTag('pvp'), profile === 'pvp', 'fixed native global profile');
  const ordinaryTile = new core.Location(3222, 3218, 0);
  assert.equal(core.WorldDefinition.WORLD_ZONE_BOUNDARIES.pvp.some(boundary => boundary.inside(ordinaryTile)),
    profile === 'pvp', 'native ordinary-tile profile boundaries');
  assert.ok(require.resolve('../../dist/net/NetworkBuilder').endsWith('.js'));
  const target = fs.readFileSync(path.join(server, 'target.txt'), 'utf8').trim();
  assert.equal(target, 'osrs-241_2026-10-20');
  assert.equal(CachePipeline.isValid(path.join(server, 'caches', target)), true,
    'sealed cache required; no download fallback');
  await CachePipeline.initialize(server);
  const { AreaManager } = require('../../dist/game/model/areas/AreaManager');
  const FeroxBounds = require('../../plugins/areas/ferox/Bounds.FeroxEnclave');
  const FEROX = new core.Location(3130, 3630, 0);
  const TRUE_WILDERNESS = new core.Location(3391, 3595, 0); // Existing pvp-retreat.test.cjs native border fixture.
  assert.equal(FeroxBounds.isInsideEnclave(FEROX), true, 'prerequisite: original start is Ferox');
  assert.equal(FeroxBounds.isSafeLocation(TRUE_WILDERNESS), false, 'prerequisite: separate Wilderness is not Ferox safe ground');
  assert.equal(core.Wilderness.isInLocation(TRUE_WILDERNESS), true, 'prerequisite: separate actual Wilderness policy');
  assert.equal(core.Wilderness.levelAt(3391, 3595), 10, 'prerequisite: existing levelled Wilderness tile');
  const policyDefinitions = {};
  for (const [id, baseVar, bit] of [[6549, 3465, 27], [5963, 1105, 22]]) {
    const definition = core.CacheDefinitions.getVarbit(id);
    const actual = { baseVar: definition.baseVar, startBit: definition.startBit, endBit: definition.endBit };
    assert.deepEqual(actual, { baseVar, startBit: bit, endBit: bit }, `prerequisite: active server supporting definition ${id}`);
    policyDefinitions[id] = actual;
  }
  const priorAreas = AreaManager.areas.slice();
  assert.equal(priorAreas.length, 0, 'isolated selected area composition');
  const packets = [], rows = [];
  let connection, player, slot, failure;
  const priorCycle = World.processCycle;
  const priorPersistence = core.GameConstants.PLAYER_PERSISTENCE;
  core.GameConstants.PLAYER_PERSISTENCE = {
    requestSave() {}, cancelRequestedSave() {}, save() {}, load() { return null; }, exists() { return false; },
  };
  function snapshot(label, expected, quiet = false) {
    // Capture the real transport boundary, including later synchronous turns.
    // Native flushPackets returns true for an empty queue: idle rows need no output.
    assert.equal(player.getSession().flushPackets(), true, 'native outbound snapshot flush');
    assert.ok(packets.length <= 512, 'bounded packet batch');
    let serverObservation;
    try {
      const at = player.getLocation(), definition = core.CacheDefinitions.getVarbit(11028);
      serverObservation = { location: [at.getX(), at.getY(), at.getZ()], area: player.getArea()?.getName() ?? null,
        wildernessLevel: core.Wilderness.levelAt(at.getX(), at.getY()), pvp: core.WorldDefinition.hasGlobalWorldTag('pvp'),
        definition: { baseVar: definition.baseVar, startBit: definition.startBit, endBit: definition.endBit },
        mirror: player.getPacketSender().getVarbit(11028), backing: player.getPacketSender().getVarp(definition.baseVar),
        supportingPolicy: { definitions: policyDefinitions,
          insideFerox: player.getPacketSender().getVarbit(6549), feroxBacking: player.getPacketSender().getVarp(3465),
          insideWilderness: player.getPacketSender().getVarbit(5963), wildernessStatistics: player.getPacketSender().getVarp(1105) },
        sacks: player.getInventory().getAmount(24613), magic: player.getSkillManager().getCurrentLevel(core.Skill.MAGIC) };
    } catch (error) { serverObservation = { diagnosticError: String(error).slice(0, 256) }; }
    rows.push({ label, expected, quiet, serverObservation, packets: packets.splice(0).map(b => b.toString('base64')) });
    assert.equal(player.getInventory().getAmount(24613), 2, 'availability never spends sacks');
  }
  function turn() {
    World.processCycle++;
    // World.process runs tasks before the player/AreaManager phase, then the process hooks.
    // This also advances the real Wilderness login remount task; no task callback is replaced.
    core.TaskManager.process();
    player.process();
    PM.emitPlayerProcess({ player });
    player.resetUpdating();
  }
  try {
    assert.equal(process.env.TSPS_DISPLAY_NAMES_FILE, undefined, 'no foreign display-name override');
    assert.equal(fs.existsSync(path.join(server, 'data/saves/display-names.json')), false,
      'scratch fixture must not read an existing account display-name file');
    // Match selected discovery order; Ferox registers its local areas before broad Wilderness startup.
    require('../../plugins/areas/FeroxEnclave.plugin').register(PM.createApi('blighted-spellbook-ferox'));
    // All consumers see the same native static definition and zone arrays.
    require('../../plugins/areas/Wilderness.plugin').register(PM.createApi('blighted-spellbook-wilderness'));
    require('../../plugins/items/BlightedSpellSacks.plugin').register(PM.createApi('blighted-spellbook-regression'));
    PM.emitServerStartup({ timestamp: Date.now() });
    assert.equal(AreaManager.areas.length, 3, 'prerequisite: native Ferox, free-for-all and Wilderness areas');
    assert.equal(AreaManager.get(FEROX)?.constructor.name, 'FeroxEnclaveArea', 'prerequisite: real Ferox area wins priority');
    assert.equal(AreaManager.get(TRUE_WILDERNESS)?.constructor.name, 'WildernessArea', 'prerequisite: distinct real Wilderness area');
    const channel = {
      kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send(bytes) { packets.push(Buffer.from(bytes)); return true; },
      close() {}, onData() {}, onError() {}, onClose() {},
    };
    connection = new ClientConnection(channel);
    // Authenticated-save checkpoint only: ordinary handshake still owns actual Player creation,
    // World insertion, login event, spellbook/inventory mount and bootstrap-complete emission.
    connection.pending = {
      username: 'blighted2321', profile: 'main', passwordHash: 'fixture-not-a-credential',
      save: { applyToPlayer(p) {
        p.setLocation(profile === 'ordinary' ? FEROX.clone() :
          profile === 'mage-bank' ? new core.Location(2539, 4712, 0) : new core.Location(3222, 3218, 0));
        p.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
        p.getInventory().add(new core.Item(24613, 2), false);
      } },
    };
    connection.inject([{ type: 'handshake', name: 'blighted2321', clientType: 0, capabilities: 0 }]);
    await connection.idle();
    player = connection.getPlayer();
    assert.ok(player && player.isRegistered(), 'actual handshake added owned Player');
    slot = player.getIndex();
    assert.equal(World.getPlayers().get(slot), player);
    assert.equal(player.getSpellbook(), core.MagicSpellbook.NORMAL);
    if (profile === 'ordinary') {
      // Bootstrap plus the first native area turn, so Ferox's own supporting producer is exercised.
      turn();
      assert.equal(player.getPacketSender().getVarbit(6549), 1, 'prerequisite: real Ferox enter input');
      assert.equal(player.getPacketSender().getVarbit(5963), 0, 'prerequisite: Ferox is not attackable Wilderness');
      snapshot('initial-ferox-bootstrap', 1);
      turn(); snapshot('unchanged-ferox', 1, true);
      player.setLocation(new core.Location(3222, 3218, 0));
      turn(); snapshot('ordinary-safe-location', 0);
      turn(); snapshot('unchanged-safe-location', 0, true);
      // Preserve direct Ferox->Safe; this separate edge must not mask its supporting input.
      player.setLocation(TRUE_WILDERNESS.clone());
      turn();
      assert.equal(player.getPacketSender().getVarbit(5963), 1, 'prerequisite: actual separate Wilderness enter input');
      snapshot('true-wilderness-entry', 1);
      turn(); snapshot('unchanged-true-wilderness', 1, true);
      player.setLocation(new core.Location(3222, 3218, 0));
      turn(); snapshot('leave-true-wilderness', 0);
      turn(); snapshot('unchanged-after-wilderness', 0, true);
    } else if (profile === 'mage-bank') {
      snapshot('mage-arena-bank-bootstrap', 1);
      turn(); snapshot('unchanged-mage-arena-bank', 1, true);
    } else {
      snapshot('pvp-world-bootstrap', 1);
      turn(); snapshot('unchanged-pvp-world', 1, true);
    }
  } catch (error) {
    failure = error;
  } finally {
    // Register cleanup before handshake; the connection can own a Player even if it failed
    // before returning one to the caller. Remove through its container while registered.
    const owned = player ?? connection?.getPlayer();
    const cleanupErrors = [];
    function clean(action) { try { action(); } catch (error) { cleanupErrors.push(error); } }
    clean(() => connection?.cleanup('fixture-complete'));
    if (owned) {
      const ownedSlot = slot ?? owned.getIndex();
      clean(() => {
        if (owned.isRegistered()) PM.emitPlayerDisconnect({ player: owned,
          username: owned.getUsername(), source: owned.getDisconnectSource() ?? 'fixture-complete' });
      });
      clean(() => core.TaskManager.cancelTasks(owned));
      clean(() => { if (owned.isRegistered()) World.getPlayers().remove(owned); });
      clean(() => assert.notEqual(World.getPlayers().get(ownedSlot), owned, 'owned slot released'));
      clean(() => assert.equal(owned.isRegistered(), false, 'owned registration released'));
      const removal = World.getRemovePlayerQueue();
      const queued = removal.indexOf(owned);
      if (queued >= 0) removal.splice(queued, 1);
    }
    clean(() => AreaManager.areas.splice(0, AreaManager.areas.length, ...priorAreas));
    core.GameConstants.PLAYER_PERSISTENCE = priorPersistence;
    World.processCycle = priorCycle;
    clean(() => CachePipeline.getStore().close());
    failure ??= cleanupErrors[0];
  }
  if (failure) throw failure;
  const result = { kind: 'complete', profile, rows };
  assert.ok(JSON.stringify(result).length < 262144, 'bounded IPC result');
  await new Promise((resolve, reject) => process.send(result, error => error ? reject(error) : resolve()));
  process.disconnect();
}
main().catch(error => { console.error(error); process.exitCode = 1; if (process.connected) process.disconnect(); });
