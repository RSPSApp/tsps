// Run after `yarn build`: node --test tests/projectile-edge-hit-native.test.cjs
//
// A shot at a large NPC lands by the NPC's nearest tile (Wiki: Hit delay, edge to edge), one tick sooner than
// the south-west tile gives, through the real combat path: a real Player with real equipment, the combat method
// CombatFactory picks for it, and a real size-5 NPC. A bow, then two attacks that inherit RangedCombatMethod.hits:
// chinchompas and the Venator bow.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const KING_BLACK_DRAGON = 239; // size 5
const HOME = [3222, 3218];
let core;
let next = 6100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function shooter(t, x, y, weaponInterfaceName, weaponId, ammoId, meta = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("edgehit" + player.getIndex());
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  const weaponInterface = core.WeaponInterfaces[weaponInterfaceName];
  assert.ok(weaponInterface, `weapon interface ${weaponInterfaceName}`);
  const weapon = new core.Item(weaponId, ammoId ? 1 : 100);
  for (const [key, value] of Object.entries(meta)) weapon.setMetaValue(key, value);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, weapon);
  if (ammoId) player.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(ammoId, 500));
  player.setWeapon(weaponInterface);
  player.setFightType(weaponInterface.getFightType()[0]);
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return player;
}

function dragon(t, x, y) {
  const npc = PM.spawnNpc({ id: KING_BLACK_DRAGON, x, y, z: 0, wanderRadius: 0 });
  assert.ok(npc.getSize() >= 3, `a large NPC, size ${npc.getSize()}`);
  t.after(() => PM.removeNpc(npc));
  return npc;
}

// The new helper, or the old south-west measure on the old code, so the test fails on the value there.
const edge = (a, b) => (core.CombatPosition.edgeDistance ?? core.CombatPosition.distance).call(core.CombatPosition, a, b);
const delays = (method, player, npc) => method.hits(player, npc).map((hit) => hit.getDelay());
const wiki = (player, distance) => core.WeaponProfiles.hitDelays(player, distance)[0];

// The dragon's south-west tile is 3225,3210 and it covers 3225-3229 x 3210-3214 (size 5). A shooter at 3234,3212
// is 5 tiles from its edge and 9 from its south-west tile.
const NPC_AT = [3225, 3210];
const SHOOTER_AT = [3234, 3212];

test("a bow's hit lands by the nearest tile of a large NPC, a tick before the south-west tile", (t) => {
  const player = shooter(t, ...SHOOTER_AT, "LONGBOW", 859, core.ItemIdentifiers.RUNE_ARROW);
  const npc = dragon(t, ...NPC_AT);
  assert.equal(core.CombatPosition.distance(player, npc), 9, "the south-west tile is 9 away");
  assert.equal(edge(player, npc), 5, "its nearest tile 5");
  const method = core.CombatFactory.getMethod(player);
  assert.ok(method instanceof core.RangedCombatMethod, "a bow shoots with the ranged method");
  // Wiki: 1 + (3 + distance) / 6 ticks: 2 from the edge, 3 from the south-west tile.
  assert.equal(wiki(player, 5), 2);
  assert.equal(wiki(player, 9), 3);
  assert.deepEqual(delays(method, player, npc), [2]);
});

test("chinchompas, which inherit the ranged hit, land by the nearest tile too", (t) => {
  const player = shooter(t, ...SHOOTER_AT, "CHINCHOMPA", core.ItemIdentifiers.RED_CHINCHOMPA_2, null);
  const npc = dragon(t, ...NPC_AT);
  const method = core.CombatFactory.getMethod(player);
  assert.ok(method instanceof core.RangedCombatMethod, "chinchompas throw with a ranged method");
  // Thrown weapons: 1 + distance / 6 ticks: 1 from the edge (5), 2 from the south-west tile (9).
  assert.equal(wiki(player, 5), 1);
  assert.equal(wiki(player, 9), 2);
  assert.equal(delays(method, player, npc)[0], 1);
});

test("the Venator bow, which inherits the ranged hit, lands its first arrow by the nearest tile on its own profile", (t) => {
  const player = shooter(t, ...SHOOTER_AT, "SHORTBOW", core.ItemIdentifiers.VENATOR_BOW, null, { "venator-bow:charges": 100 });
  const npc = dragon(t, ...NPC_AT);
  const method = core.CombatFactory.getMethod(player);
  assert.ok(method instanceof core.RangedCombatMethod, "the Venator bow shoots with a ranged method");
  // Not the plain bow's 1 + (3 + d) / 6: the Venator's profile lands the hit with its arrow, floor((23 + d) / 15)
  // ticks (WeaponProfile.ts; rsprox 1749/1862, whose Venator targets are all one tile): 1 from the edge (5), 2 from
  // the south-west tile (9). No Venator capture has a large target, so the edge rule here is the engine's, not seen.
  assert.equal(wiki(player, 5), 1);
  assert.equal(wiki(player, 9), 2);
  assert.equal(delays(method, player, npc)[0], 1, "the first arrow lands by the edge, not the south-west tile");
});
