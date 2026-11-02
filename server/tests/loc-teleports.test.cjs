// Run after `yarn build`: node --test tests/loc-teleports.test.cjs
// Captured loc teleports (docs/loc-teleports.md): which captured locs become entries
// (scripts/loc-teleport-matching.cjs), the data against the cache, and the plugin playing an
// entry as live OSRS does.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { RsmodRouteFinding } = require("../dist/game/model/movement/path/RsmodRouteFinding");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { encodeSound } = require("../dist/net/protocol/ClientProtocol");
const npcSpawns = require("../data/definitions/npc-spawns.json");

const { choose, isNetwork, refusals, toEntry, requirementFor } = require("../scripts/loc-teleport-matching.cjs");
const LocTeleports = require("../plugins/world/LocTeleports.plugin");
const data = require("../plugins/world/data/loc-teleports.json");
const decisions = require("../plugins/world/data/loc-teleport-sync.json");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Thieving = require("../plugins/skills/Thieving.plugin");

let core;
const hooks = {};
const prompts = [];
const emitted = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  Diaries.register(PluginManager.createApi("LocArrivalDiaries"));
  Thieving.register(PluginManager.createApi("HamEntranceThieving"));
  const native = PluginManager.createApi("LocArrivalTeleports");
  LocTeleports.register({
    core,
    persistAttribute() {},
    onObjectInteraction: (handler) => { hooks.object = handler; native.onObjectInteraction(handler); },
    onObjectRoute: (handler) => (hooks.route = handler),
    onItemOnObject: (handler) => (hooks.itemOnObject = handler),
    onCustomEvent: (name, handler) => (hooks[name] = handler),
    sendMultiChatboxPrompt: (player, title, ...pairs) => prompts.push({ title, options: pairs.filter((_, i) => i % 2 === 0), pick: (text) => pairs[pairs.indexOf(text) + 1]() }),
    emitCustomEvent: (name, payload) => { emitted.push([name, payload]); PluginManager.emitCustomEvent(name, payload); },
  });
});

const captured = (fields) => ({
  name: "cave_entry", id: 1, op: 1, x: 10, y: 10, z: 0, labels: [], teleports: 3, failures: [], dialogue: null,
  destinations: [{ x: 50, y: 9000, z: 0, from: [[10, 11, 0]] }], recordings: 3, ...fields,
});
const nothing = [{ status: "nothing", handledBy: null }];

test("a captured cave tsps does nothing with becomes an entry; one tsps already does doesn't", () => {
  assert.deepEqual(choose(captured({}), nothing, "Cave", decisions), { take: true });
  assert.equal(choose(captured({}), [{ status: "same" }], "Cave", decisions).reason, "tsps already does this");
  // Ladders asks other content first, so a ladder it takes and gets wrong is fixed here too.
  assert.deepEqual(choose(captured({}), [{ status: "handled-no-move", handledBy: "Ladders" }], "Ladder", decisions), { take: true });
  assert.equal(choose(captured({}), [{ status: "different", handledBy: "Agility" }], "Cave", decisions).reason, "handled by Agility");
});

test("left out: instances, networks, requirements, dialogue choices, other kinds and decisions", () => {
  const reason = (fields, display = "Cave") => choose(captured(fields), nothing, display, decisions).reason;
  assert.equal(reason({ labels: ["instance"] }), "labelled instance");
  assert.equal(reason({ labels: ["special-world"] }), undefined, "Leagues worlds move players the same way");
  assert.equal(reason({ name: "league_6_cave", labels: ["special-world"] }), "Leagues content");
  // Spirit trees and the magic mushtree: an interface picks among far-apart destinations.
  const network = { destinations: [{ x: 3676, y: 3871, z: 0 }, { x: 3760, y: 3758, z: 0 }] };
  assert.equal(isNetwork(network), true);
  assert.match(reason(network), /travel network/);
  assert.match(reason({ failures: [["That looks too steep to safely climb down with just your bare hands.", 1]] }), /refused/);
  assert.deepEqual(refusals(captured({ failures: [["You drink some of your stamina potion.", 1]] })), [], "a potion isn't a requirement");
  assert.equal(reason({ dialogue: { prompt: "Climb up or down the ladder?" } }), "dialogue choice");
  assert.equal(reason({}, "Rowboat"), "not a ladder, stair, cave or hole");
  assert.equal(reason({}, "Passageway"), undefined, "doors, gates and passageways that move the player are taken");
  assert.equal(reason({ name: "lift_back" }, "Lift"), undefined, "an included loc of another kind (a Haunted Mine lift)");
  assert.match(reason({ name: "freedomfighterentrancel" }, "Wooden doors"), /In Search of the Myreque/);
  assert.equal(reason({ name: "sailing_gangplank_shipyard" }), "In the shipyard; Sailing handles it.");
  assert.match(reason({ name: "ladder", x: 3284, y: 3165 }), /Leagues/, "one placement of a shared name");
  assert.equal(reason({ name: "ladder" }), undefined, "the other ladders of that name");
});

test("an entry keeps the captured move, with whole ticks and a destination per side", () => {
  const entry = toEntry(captured({ sequence_tick: 1.5, teleport_tick: 2.5, sounds: [[2454, 1]], fade: true }), { display: "Cave", option: "Enter", sequenceId: 11580 });
  assert.deepEqual([entry.to, entry.anim, entry.animTick, entry.tick, entry.sound, entry.fade], [[50, 9000, 0], 11580, 2, 3, 2454, true]);
  const stairs = toEntry(captured({ destinations: [{ x: 1, y: 2, z: 1, from: [[3, 3, 0]] }, { x: 5, y: 6, z: 1, from: [[9, 9, 0]] }] }), { display: "Stairs", option: "Climb" });
  assert.deepEqual(stairs.sides, [{ from: [3, 3, 0], to: [1, 2, 1] }, { from: [9, 9, 0], to: [5, 6, 1] }]);
});

test("every entry is a placed loc with that option in the rev 241 cache, once per tile and option", () => {
  const keys = new Set();
  for (const entry of data.locs) {
    const key = `${entry.x},${entry.y},${entry.z}:${entry.op}`;
    assert.ok(!keys.has(key), `${entry.name} ${key} twice`);
    keys.add(key);
    const cached = CacheDefinitions.getObject(entry.id);
    const variants = cached.transforms ? cached.transforms.filter((id) => id !== -1).map((id) => CacheDefinitions.getObject(id)) : [cached];
    assert.ok(variants.some((variant) => variant?.actions?.[entry.op - 1]), `${entry.name} (${entry.id}) has no option ${entry.op}`);
    assert.ok(entry.to || entry.sides?.length, `${entry.name} goes nowhere`);
  }
  // Left to their own work: the shipyard, spirit trees, the magic mushtree.
  assert.ok(!data.locs.some((entry) => /^(sailing_|spirittree|fossil_magic_mushtree)/.test(entry.name)));
});

test("every Prifddinas gate leaf can be clicked from its walkable side and crosses the city boundary", () => {
  const gates = data.locs.filter((entry) => /^prif_wall_gate_(left|right)(_exit)?$/.test(entry.name));
  assert.equal(gates.length, 16, "both leaves, inside and outside, at all four gates");
  const emitRoute = PluginManager.emitObjectRoute;
  const emitInteraction = PluginManager.emitObjectInteraction;
  PluginManager.emitObjectRoute = (event) => hooks.route(event);
  PluginManager.emitObjectInteraction = (event) => { hooks.object(event); return event.handled; };
  try {
    for (const entry of gates) {
      const object = locAt(entry.id, entry.x, entry.y, entry.z);
      const [x, y, z] = entry.approach;
      assert.equal(core.RegionManager.getClipping(x, y, z, null) & 0x200100, 0, "approach is outside the gate's collision");
      const dx = x < entry.x ? -1 : x >= entry.x + 2 ? 1 : 0;
      const dy = y < entry.y ? -1 : y >= entry.y + 2 ? 1 : 0;
      const visit = explorer([x + dx * 3, y + dy * 3, z]);
      new ObjectActionPacketListener().executeAction(visit.player, object.getId(), entry.x, entry.y, 1);
      for (let tick = 0; tick < 20; tick++) {
        core.World.processCycle++;
        visit.player.getMovementQueue().process();
        runTicks(visit, 1);
        core.TaskManager.processRemainingWalkTo();
      }
      const at = visit.player.getLocation();
      assert.deepEqual([at.getX(), at.getY(), at.getZ()], entry.to, `${entry.id} at ${entry.x},${entry.y}`);
      assert.equal(at.getX() > 3000, entry.option === "Enter", "Enter reaches the city, Exit reaches the overworld");
      core.RegionManager.loadMapFiles(at.getX(), at.getY());
      assert.equal(core.RegionManager.getClipping(at.getX(), at.getY(), at.getZ(), null) & 0x200100, 0, "arrival is clear");
      assert.equal(visit.player.getMovementQueue().isMovementBlocked(), false);
    }
  } finally {
    PluginManager.emitObjectRoute = emitRoute;
    PluginManager.emitObjectInteraction = emitInteraction;
  }
});

test("all eight Prifddinas clan-tower platforms Channel up and down and allow walking off", () => {
  const positions = [[3280,6125], [3306,6099], [3306,6065], [3280,6039], [3246,6039], [3220,6065], [3220,6099], [3246,6125]];
  const platforms = data.locs.filter((entry) => entry.name === "prif_clan_tower_teleporter");
  assert.equal(platforms.length, 16);
  for (const [x, y] of positions) for (const z of [0, 2]) {
    const object = locAt(36490, x, y, z);
    const entry = LocTeleports._test.entryFor(object, 1);
    assert.equal(CacheDefinitions.getObject(object.getId()).actions[0], "Channel");
    assert.equal(entry.option, "Channel");
    const visit = explorer([x - 1, y, z]);
    const event = { player: visit.player, object, clickType: 1, handled: false };
    hooks.object(event);
    assert.equal(event.handled, true);
    runTicks(visit, 2);
    const at = visit.player.getLocation();
    assert.deepEqual([at.getX(), at.getY(), at.getZ()], [x, y, 2 - z]);
    assert.equal(visit.player.getMovementQueue().isMovementBlocked(), false);
    assert.equal(core.RegionManager.canMove(x, y, x - 1, y, 2 - z, 1, 1, null), true, "the landing can walk off the platform");
  }
  const other = { object: locAt(36490, 3280, 6125, 0), clickType: 2, destination: null };
  hooks.route(other);
  assert.equal(other.destination, null, "uncatalogued options keep ordinary routing");
});

test("the SOTE supply cave Exit returns to a walkable tile beside its surface entrance", () => {
  const entry = data.locs.find(loc => loc.name === 'sote_supply_cave_exit');
  const object = locAt(35845, 2200, 9671, 0);
  const visit = explorer([2201, 9673, 0]);
  const request = { player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false };
  hooks.object(request);
  assert.equal(request.handled, true);
  runTicks(visit, 1);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], entry.to);
  assert.ok(locAt(35846, 2200, 3262, 0), 'the cache surface entrance is paired with the exit');
  const route = new RsmodRouteFinding((x, y, z, area) => core.RegionManager.getClipping(x, y, z, area));
  const path = route.findRoute({ level: 0, srcX: 2200, srcY: 3261, srcSize: 1,
    destX: 2194, destY: 3258, privateArea: null, moveNear: true });
  assert.equal(path.success, true, 'the landing connects to the camp by ordinary walking');
});

test("the Well of Voyage enters Iban's temple beside its real well and door", () => {
  const entry = data.locs.find((loc) => loc.id === 4005);
  assert.deepEqual([entry.x, entry.y, entry.z, entry.op, entry.to], [2341, 9622, 0, 1, [2138, 4647, 1]]);
  const source = CacheDefinitions.getObject(entry.id);
  assert.equal(source.actions[entry.op - 1], "Climb-down");

  // QH puts the temple well at 2136,4647. Its 2x2 cache footprint is not a valid landing tile,
  // and its only action is Search. The inferred landing is the first clear tile east of it.
  const well = CacheDefinitions.getObject(3359);
  assert.deepEqual([well.sizeX, well.sizeY, well.actions[0]], [2, 2, "Search"]);
  const [x, y, z] = entry.to;
  assert.ok(x >= 2138 && y >= 4647 && x <= 2139 && y <= 4648, "landing is beside the temple well footprint");

  core.RegionManager.loadMapFiles(x, y);
  const doorApproach = [[2138, 4647], [2139, 4647], [2140, 4647], [2141, 4647], [2142, 4647]];
  for (let i = 1; i < doorApproach.length; i++) {
    const [fromX, fromY] = doorApproach[i - 1];
    const [toX, toY] = doorApproach[i];
    assert.equal(core.RegionManager.canMove(fromX, fromY, toX, toY, z, 1, 1, null), true,
      `clear path from the landing to the temple door at ${toX},${toY}`);
  }
  const doorIds = new Set([3333, 3334]);
  const doors = [];
  for (let dx = 2138; dx <= 2145; dx++) for (let dy = 4645; dy <= 4650; dy++) {
    for (const id of doorIds) {
      const object = MapObjects.get(id, new core.Location(dx, dy, z), null);
      if (object) doors.push(object);
    }
  }
  assert.ok(doors.some((door) => door.getLocation().getX() === 2143 && door.getLocation().getY() >= 4647 && door.getLocation().getY() <= 4648),
    "the reachable route ends at the cache-placed Iban temple doors");
});

test("Blood Hunt's keyed bank trapdoor enters the recorded altar room", () => {
  const entry = data.locs.find((loc) => loc.name === "bmr_bank_trapdoor");
  assert.deepEqual([entry.id, entry.x, entry.y, entry.z, entry.option, entry.to],
    [61848, 2579, 7830, 0, "Climb-through", [2581, 7844, 0]]);
  const parent = CacheDefinitions.getObject(entry.id);
  assert.equal(parent.transformVarbit, 15585);
  assert.deepEqual(parent.transforms.slice(0, 2).map((id) => CacheDefinitions.getObject(id).actions[0]), ["Open", "Climb-through"]);
});

test("the Underground Pass south-wall cave links to the dwarf camp and back", () => {
  const down = data.locs.find((loc) => loc.name === "underground_pass_dwarf_camp_down");
  const up = data.locs.find((loc) => loc.name === "underground_pass_dwarf_camp_up");
  assert.deepEqual([down.id, down.x, down.y, down.z, down.option, down.to], [3222, 2150, 4545, 1, "Descend", [2336, 9795, 0]]);
  assert.deepEqual([up.id, up.x, up.y, up.z, up.option, up.to], [3223, 2336, 9793, 0, "Ascend", [2150, 4546, 1]]);
  assert.equal(CacheDefinitions.getObject(down.id).actions[down.op - 1], down.option);
  assert.equal(CacheDefinitions.getObject(up.id).actions[up.op - 1], up.option);

  core.RegionManager.loadMapFiles(2150, 4545);
  core.RegionManager.loadMapFiles(2336, 9795);
  assert.equal(core.RegionManager.getClipping(2150, 4546, 1, null), 0, "upper arrival is a clear tile beside Cave3222");
  assert.equal(core.RegionManager.getClipping(2336, 9795, 0, null), 0, "lower arrival is an open floor tile");
  const queue = [[2336, 9795]];
  const seen = new Set(["2336,9795"]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  let reachesNiloof = false;
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    if (Math.max(Math.abs(x - 2315), Math.abs(y - 9806)) <= 1) { reachesNiloof = true; break; }
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (nx < 2304 || nx > 2352 || ny < 9760 || ny > 9840) continue;
      if (!seen.has(key) && core.RegionManager.canMove(x, y, nx, ny, 0, 1, 1, null)) {
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
  }
  assert.equal(reachesNiloof, true, "the lower arrival can reach Niloof's cache spawn");

  const upper = explorer([2150, 4546, 1]);
  const downObject = locAt(down.id, down.x, down.y, down.z);
  hooks.object({ player: upper.player, object: downObject, objectId: down.id, clickType: 1, handled: false });
  runTicks(upper, 2);
  assert.deepEqual([upper.player.getLocation().getX(), upper.player.getLocation().getY(), upper.player.getLocation().getZ()], down.to);

  const lower = explorer(up.to);
  const upObject = locAt(up.id, up.x, up.y, up.z);
  hooks.object({ player: lower.player, object: upObject, objectId: up.id, clickType: 1, handled: false });
  runTicks(lower, 2);
  assert.deepEqual([lower.player.getLocation().getX(), lower.player.getLocation().getY(), lower.player.getLocation().getZ()], up.to);
});

test("the Ancient Cavern whirlpool requires Barbarian firemaking and pyre-ship training", () => {
  const entry = data.locs.find((loc) => loc.name === "ancient_cavern_whirlpool");
  assert.deepEqual([entry.id, entry.x, entry.y, entry.z, entry.to], [25274, 2510, 3506, 0, [1765, 5365, 1]]);
  assert.deepEqual(entry.requires?.map(({ varbit, atLeast }) => [varbit, atLeast]), [[3759, 3], [3764, 1]]);
  const object = locAt(entry.id, entry.x, entry.y, entry.z);
  const visit = explorer([2511, 3508, 0]);
  let firemaking = 0;
  let pyreShips = 0;
  const messages = [];
  const sender = visit.player.getPacketSender();
  visit.player.getPacketSender = () => new Proxy(sender, {
    get: (target, key) => key === "getVarbit"
      ? (id) => id === 3759 ? firemaking : id === 3764 ? pyreShips : 0
      : target[key],
  });
  visit.player.sendMessage = (message) => messages.push(message);
  const click = () => {
    const event = { player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false };
    hooks.object(event);
    assert.equal(event.handled, true);
  };
  click();
  assert.deepEqual(messages, [entry.requires[0].refuse.message]);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], [2511, 3508, 0]);
  firemaking = 3;
  click();
  assert.equal(messages.at(-1), entry.requires[1].refuse.message, "pyre-ship access also requires Otto's firemaking instruction");
  pyreShips = 1;
  click();
  runTicks(visit, 3);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], entry.to);
});

test("the DS2 fleet rope ladder reaches the cache-backed upper wreckage route", () => {
  const entry = data.locs.find((loc) => loc.name === "ds2_fleet_rope_ladder_upper");
  assert.deepEqual([entry.id, entry.x, entry.y, entry.z, entry.option, entry.to],
    [32322, 1673, 5710, 0, "Climb-up", [1673, 5710, 2]]);
  assert.equal(CacheDefinitions.getObject(entry.id).actions[entry.op - 1], entry.option);
  core.RegionManager.loadMapFiles(entry.x, entry.y);
  assert.equal(core.RegionManager.getClipping(...entry.to, null) & 0x200000, 0,
    "the QH landing is a clear tile on the upper deck");

  const visit = explorer([1672, 5710, 0]);
  const object = locAt(entry.id, entry.x, entry.y, entry.z);
  const event = { player: visit.player, object, objectId: entry.id, clickType: 1, handled: false };
  hooks.object(event);
  assert.equal(event.handled, true);
  runTicks(visit, 2);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], entry.to);
});

test("the DS2 cache lift boards the upper deck beside Galvek", () => {
  const entry = data.locs.find((loc) => loc.name === "ds2_fleet_lift_to_galvek");
  assert.deepEqual([entry.id, entry.x, entry.y, entry.z, entry.option, entry.to],
    [4942, 1631, 5735, 0, "Go-up", [1630, 5735, 2]]);
  assert.equal(CacheDefinitions.getObject(entry.id).actions[entry.op - 1], entry.option);
  const galvek = CacheDefinitions.getNpc(8095);
  assert.equal(galvek.size, 7, "the arrival must sit outside Galvek's 7x7 footprint");
  core.RegionManager.loadMapFiles(entry.x, entry.y);
  assert.equal(core.RegionManager.canMove(entry.to[0], entry.to[1], entry.to[0], entry.to[1], entry.to[2], 1, 1, null), true,
    "the inferred upper landing is a clear cache tile");
  assert.equal(core.RegionManager.canProjectileAttackBounds(new core.Location(...entry.to),
    new core.Location(1631, 5735, 2), 1, 1, galvek.size, galvek.size, null), true,
  "the landing can reach Galvek's real cache footprint");

  const visit = explorer([1631, 5735, 0]);
  const object = locAt(entry.id, entry.x, entry.y, entry.z);
  const event = { player: visit.player, object, objectId: entry.id, clickType: 1, handled: false };
  hooks.object(event);
  assert.equal(event.handled, true);
  runTicks(visit, entry.tick);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], entry.to);
});

test("the DS2 main-ship ladder reaches the cache-backed upper deck", () => {
  const entry = data.locs.find((loc) => loc.name === "ds2_fleet_main_ship_ladder");
  assert.deepEqual([entry.id, entry.x, entry.y, entry.z, entry.option, entry.to],
    [32325, 1655, 5688, 0, "Climb-up", [1655, 5688, 2]]);
  assert.equal(CacheDefinitions.getObject(entry.id).actions[entry.op - 1], entry.option);
  core.RegionManager.loadMapFiles(entry.x, entry.y);
  assert.equal(core.RegionManager.canMove(entry.to[0], entry.to[1], entry.to[0], entry.to[1], entry.to[2], 1, 1, null), true,
    "the QH upper-deck landing is clear in cache collision");
  const visit = explorer([1655, 5688, 0]);
  const object = locAt(entry.id, entry.x, entry.y, entry.z);
  const event = { player: visit.player, object, objectId: entry.id, clickType: 1, handled: false };
  hooks.object(event);
  assert.equal(event.handled, true);
  runTicks(visit, entry.tick);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], entry.to);
});

test("the west-return cache rope climbs onto Galvek's main deck", () => {
  const entry = data.locs.find((loc) => loc.name === "ds2_fleet_main_deck_rope");
  assert.deepEqual([entry.id, entry.x, entry.y, entry.z, entry.option, entry.to],
    [32324, 1637, 5706, 0, "Climb-up", [1630, 5735, 2]]);
  assert.equal(CacheDefinitions.getObject(entry.id).actions[entry.op - 1], entry.option);
  core.RegionManager.loadMapFiles(entry.x, entry.y);
  assert.equal(core.RegionManager.canMove(entry.to[0], entry.to[1], entry.to[0], entry.to[1], entry.to[2], 1, 1, null), true,
    "the rope landing is a walkable main-deck tile");
  const galvek = CacheDefinitions.getNpc(8095);
  const approach = new core.Location(...entry.to);
  assert.equal(core.RegionManager.canProjectileAttackBounds(approach,
    new core.Location(1631, 5735, 2), 1, 1, galvek.size, galvek.size, null), true,
  "the main-deck route reaches Galvek's real footprint");

  const visit = explorer([entry.x, entry.y, entry.z]);
  const object = locAt(entry.id, entry.x, entry.y, entry.z);
  const event = { player: visit.player, object, objectId: entry.id, clickType: 1, handled: false };
  hooks.object(event);
  assert.equal(event.handled, true);
  runTicks(visit, entry.tick);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], entry.to);
});

test("an agent object action without a numeric clickType resolves its cached option", () => {
  const entry = data.locs.find((loc) => loc.name === "ds2_fleet_main_ship_ladder");
  core.RegionManager.loadMapFiles(entry.x, entry.y);
  const visit = explorer([entry.x, entry.y, entry.z]);
  visit.player.getMovementQueue = () => ({ reset() {}, walkToReset() {}, walkToObject(_object, { execute }) { execute(); } });
  visit.player.setPositionToFace = () => {};
  const original = PluginManager.emitObjectInteraction;
  let observed;
  PluginManager.emitObjectInteraction = (event) => { observed = event; return true; };
  try {
    new ObjectActionPacketListener().executeAction(visit.player, entry.id, entry.x, entry.y, undefined, entry.option);
  } finally {
    PluginManager.emitObjectInteraction = original;
  }
  assert.equal(observed?.clickType, entry.op, "the option string resolves against cached action order");
  assert.equal(observed?.option, entry.option.toLowerCase(), "the plugin event carries its cache-derived option");
});

test("the Ancient Cavern's cache stairs link the arrival room, mithril floor and forge", () => {
  const expected = [
    [25338, 1769, 5365, 1, "Climb-down", [1772, 5366, 0]],
    [25339, 1778, 5344, 0, "Climb-up", [1779, 5345, 1]],
    [25340, 1778, 5344, 1, "Climb-down", [1778, 5346, 0]],
    [32212, 1744, 5323, 0, "Climb-up", [1744, 5321, 1]],
    [32211, 1744, 5322, 1, "Climb-down", [1746, 5324, 0]],
  ];
  for (const [id, x, y, z, option, to] of expected) {
    const entry = data.locs.find((loc) => loc.id === id && loc.x === x && loc.y === y && loc.z === z);
    assert.ok(entry, `cache loc ${id} at ${x},${y},${z} has a captured stair route`);
    assert.deepEqual([entry.option, entry.to], [option, to]);
    assert.ok(locAt(id, x, y, z), `cache loc ${id} has the matching ${option} option`);
  }

  const route = new RsmodRouteFinding((x, y, z, area) => core.RegionManager.getClipping(x, y, z, area));
  const lowerLanding = [1772, 5366];
  assert.equal(core.RegionManager.getClipping(...lowerLanding, 0, null) & 0x200000, 0,
    "the landing sits beside, not inside, the blocked stair footprint");
  const toMithrilStairs = route.findRoute({
    level: 0, srcX: lowerLanding[0], srcY: lowerLanding[1], srcSize: 1,
    destX: 1778, destY: 5344, privateArea: null, moveNear: true,
  });
  assert.equal(toMithrilStairs.success, true,
    "the live landing has a collision-valid route to the cache Mithril stairs");

  const forgeUpLanding = [1744, 5321];
  assert.equal(core.RegionManager.getClipping(...forgeUpLanding, 1, null) & 0x200000, 0,
    "the forge upstairs arrival is outside the blocked 2x2 stair footprint");
  const toCachedAnvil = route.findRoute({
    level: 1, srcX: forgeUpLanding[0], srcY: forgeUpLanding[1], srcSize: 1,
    destX: 1748, destY: 5288, privateArea: null, moveNear: true,
  });
  assert.equal(toCachedAnvil.success, true,
    "the forge upstairs arrival has a collision-valid route to a cache anvil");

  const forgeDownLanding = [1746, 5324];
  assert.equal(core.RegionManager.getClipping(...forgeDownLanding, 0, null) & 0x200000, 0,
    "the forge downstairs arrival is outside the blocked 2x2 stair footprint");
  const backToMithrilFloor = route.findRoute({
    level: 0, srcX: forgeDownLanding[0], srcY: forgeDownLanding[1], srcSize: 1,
    destX: 1778, destY: 5344, privateArea: null, moveNear: true,
  });
  assert.equal(backToMithrilFloor.success, true,
    "the forge downstairs arrival connects back to the upper cavern's cache stairs");
});

test("the DS2 Mithril door enters the orb room and its return door reaches the upper cavern", () => {
  const enter = data.locs.find((loc) => loc.name === "ds2_mithril_door_enter_orb_room");
  const leave = data.locs.find((loc) => loc.name === "ds2_mithril_door_leave_orb_room");
  assert.deepEqual([enter.id, enter.x, enter.y, enter.z, enter.to], [25341, 1759, 5343, 1, [1555, 4876, 0]]);
  assert.deepEqual([leave.id, leave.x, leave.y, leave.z, leave.to], [32208, 1555, 4875, 0, [1759, 5341, 1]]);
  assert.deepEqual(enter.requires, [{ item: 22093, refuse: { message: "You need the ancient key to open the Mithril door." } }]);
  assert.ok(locAt(enter.id, enter.x, enter.y, enter.z));
  assert.ok(locAt(leave.id, leave.x, leave.y, leave.z));

  const roomRoute = new RsmodRouteFinding((x, y, z, area) => core.RegionManager.getClipping(x, y, z, area));
  assert.equal(core.RegionManager.getClipping(...enter.to, null) & 0x200000, 0,
    "the arrival is a collision-valid tile inside the RuneLite orb-room zone");
  for (const id of [7506, 7507, 7508]) {
    const npc = npcSpawns.find((spawn) => spawn.id === id);
    assert.ok(npc, `the cache NPC spawn for dragon head ${id} exists`);
    assert.equal(roomRoute.findRoute({
      level: 0, srcX: enter.to[0], srcY: enter.to[1], srcSize: 1,
      destX: npc.x, destY: npc.y, privateArea: null, moveNear: true,
    }).success, true, `the arrival has a natural route to dragon head ${id}`);
  }
  assert.equal(roomRoute.findRoute({
    level: 1, srcX: leave.to[0], srcY: leave.to[1], srcSize: 1,
    destX: 1779, destY: 5345, privateArea: null, moveNear: false,
  }).success, true, "the return landing connects to the mithril dragon area");

  const portal = locAt(enter.id, enter.x, enter.y, enter.z);
  const visit = explorer([1759, 5341, 1]);
  const messages = [];
  visit.player.sendMessage = (message) => messages.push(message);
  const click = (object) => {
    const event = { player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false };
    hooks['door:toggle'](event);
    assert.equal(event.handled, true);
  };
  click(portal);
  assert.deepEqual(messages, [enter.requires[0].refuse.message], "the room requires the ancient key");
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], [1759, 5341, 1]);

  visit.player.getInventory().add(new core.Item(22093, 1), false);
  click(portal);
  runTicks(visit, 6);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], enter.to);

  click(locAt(leave.id, leave.x, leave.y, leave.z));
  runTicks(visit, 6);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], leave.to);
});

/** A real player whose packets are recorded per tick. */
function explorer(at) {
  const player = new Player(null);
  player.setUsername(`explorer${Math.random()}`);
  player.setLocation(new core.Location(...at));
  const ticks = [[]];
  const log = (entry) => ticks[ticks.length - 1].push(entry);
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === "sendVarbit") return (id, value) => (log(`varbit ${id}=${value}`), sender);
      if (key === "sendSound") return (id) => (log(`sound ${id}`), sender);
      if (key === "sendSubInterface") return (uid, id) => (log(`open ${id}`), sender);
      if (key === "closeSubInterface") return () => (log("close overlay"), sender);
      if (key === "getVarbit" || key === "getVarp") return () => 0;
      return () => sender;
    },
  });
  player.getPacketSender = () => sender;
  player.performAnimation = (animation) => log(`anim ${animation.getId()}`);
  player.isRegistered = () => true;
  const moveTo = player.moveTo.bind(player);
  player.moveTo = (location) => (log(`move ${location.getX()},${location.getY()},${location.getZ()}`), moveTo(location));
  return { player, ticks, nextTick: () => ticks.push([]) };
}

function runTicks(explorer, count) {
  for (let i = 0; i < count; i++) {
    explorer.nextTick();
    core.TaskManager.process();
  }
}

function locAt(id, x, y, z) {
  core.RegionManager.loadMapFiles(x, y);
  const object = MapObjects.get(id, new core.Location(x, y, z), null);
  assert.ok(object, `loc ${id} at ${x},${y},${z}`);
  return object;
}

function nativeHamPlayer() {
  const player = new Player(new PlayerSession({
    kind: "test", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  }));
  player.setUsername("ham-arrival").setIndex(1500);
  player.setRegistered(true);
  player.setLocation(new core.Location(3163, 3252, 0));
  return player;
}

function nativeTicks(player, count) {
  for (let tick = 0; tick < count; tick++) {
    core.World.processCycle++;
    core.TaskManager.process();
    player.getMovementQueue().process();
    core.TaskManager.processRemainingWalkTo();
    player.resetUpdating();
  }
}

const thievingXp = (player) => player.getSkillManager().getSkills().experience[core.Skill.THIEVING.getIndex()];

test("the native H.A.M. route requires unlocking, then credits actual entry once and relocks", (t) => {
  const random = Math.random;
  Math.random = () => 0;
  t.after(() => { Math.random = random; });
  const diary = DiaryData.BY_KEY.get("lumbridge");
  const task = "enter-the-h-a-m-hideout";
  const player = nativeHamPlayer();
  const messages = [];
  player.sendMessage = (text) => messages.push(text);
  locAt(5492, 3166, 3252, 0);
  const closed = core.ObjectDefinition.forPlayer(5492, player);
  assert.equal(closed.id, 5490);
  assert.equal(closed.getInteractions()[0], "Open");
  assert.equal(closed.getInteractions()[4], "Pick-Lock");
  const start = player.getLocation().clone();
  new ObjectActionPacketListener().executeAction(player, 5492, 3166, 3252, 1);
  nativeTicks(player, 15);
  assert.ok(player.getLocation().getY() < 9000, "closed Open cannot bypass the lock");
  assert.equal(DiaryProgress.doneTasks(player, diary).has(task), false);
  assert.ok(messages.includes("This trapdoor is locked."));

  player.setLocation(start);
  new ObjectActionPacketListener().executeAction(player, 5492, 3166, 3252, 5);
  let walked = false;
  for (let tick = 0; tick < 30; tick++) {
    nativeTicks(player, 1);
    if (player.getLocation().getY() < 9000 && !player.getLocation().equals(start)) walked = true;
    assert.equal(DiaryProgress.doneTasks(player, diary).has(task), false, "unlocking is not entering");
  }
  assert.equal(walked, true, "walks through the real cache collision before operating the trapdoor");
  assert.equal(player.getPacketSender().getVarbit(235), 1);
  assert.equal(core.ObjectDefinition.forPlayer(5492, player).getInteractions()[0], "Climb-down");
  assert.equal(thievingXp(player), 3.8);
  new ObjectActionPacketListener().executeAction(player, 5492, 3166, 3252, 1);
  nativeTicks(player, 5);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], [3149, 9652, 0]);
  assert.equal(player.getPacketSender().getVarbit(235), 0, "entry relocks the per-player trapdoor");
  assert.equal(DiaryProgress.doneTasks(player, diary).has(task), true);
  assert.equal(player.getPacketSender().getVarbit(6311), 1, "the native diary tab count updates");
  assert.equal(messages.filter((line) => line.includes("Achievement Diary")).length, 1);

  player.setLocation(start);
  new ObjectActionPacketListener().executeAction(player, 5492, 3166, 3252, 5);
  nativeTicks(player, 30);
  new ObjectActionPacketListener().executeAction(player, 5492, 3166, 3252, 1);
  nativeTicks(player, 15);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], [3149, 9652, 0], "actually enters a second time");
  assert.equal(thievingXp(player), 7.6, "both unlocks completed");
  assert.equal(player.getPacketSender().getVarbit(6311), 1);
  assert.equal(messages.filter((line) => line.includes("Achievement Diary")).length, 1, "re-entry does not duplicate credit");
});

test("a failed native H.A.M. attempt retries; an optional lockpick improves the level-one roll", (t) => {
  const random = Math.random;
  Math.random = () => 0.2; // Fails 11/256 bare-handed, succeeds 61/256 with a lockpick.
  t.after(() => { Math.random = random; });
  const player = nativeHamPlayer();
  player.setLocation(new core.Location(3166, 3251, 0));
  const animations = [];
  const sounds = [];
  const sound = (id) => encodeSound(id, { loops: 1, delay: 0 });
  const send = player.getSession().sendClientPacket.bind(player.getSession());
  player.getSession().sendClientPacket = (frame) => {
    if (frame[0] === sound(0)[0]) sounds.push(Buffer.from(frame));
    return send(frame);
  };
  player.performAnimation = (animation) => animations.push(animation.getId());
  new ObjectActionPacketListener().executeAction(player, 5492, 3166, 3252, 5);
  for (let tick = 0; tick < 5 && !animations.length; tick++) nativeTicks(player, 1);
  assert.deepEqual(animations, [537]);
  // Normal capture 3199: 2402 on click T13124, again with 537 at T13125.
  assert.deepEqual(sounds, [sound(2402), sound(2402)]);
  nativeTicks(player, 7);
  assert.equal(thievingXp(player), 0, "no outcome before the nine-tick attempt");
  nativeTicks(player, 1);
  assert.equal(thievingXp(player), 0.5);
  assert.equal(player.getPacketSender().getVarbit(235), 0);
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.THIEVING), 1, "no invented numb-finger roll");
  assert.deepEqual(sounds, [sound(2402), sound(2402), sound(2581)], "failure does not duplicate the next retry sound");
  player.getInventory().add(new core.Item(core.ItemIdentifiers.LOCKPICK, 1), false);
  nativeTicks(player, 1);
  assert.deepEqual(sounds, [sound(2402), sound(2402), sound(2581), sound(2402)], "one sound with the automatic retry animation");
  nativeTicks(player, 8);
  assert.deepEqual(animations, [537, 537, 536]);
  assert.equal(player.getPacketSender().getVarbit(235), 1);
  assert.equal(thievingXp(player), 4.3);
  assert.deepEqual(sounds, [sound(2402), sound(2402), sound(2581), sound(2402), sound(52)]);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.LOCKPICK), 1, "the tool is not consumed");
  assert.equal(DiaryProgress.doneTasks(player, DiaryData.BY_KEY.get("lumbridge")).size, 0);
  new ObjectActionPacketListener().executeAction(player, 5492, 3166, 3252, 2);
  nativeTicks(player, 3);
  assert.equal(player.getPacketSender().getVarbit(235), 0, "the real open variant's Close relocks it");
  assert.equal(core.ObjectDefinition.forPlayer(5492, player).getInteractions()[4], "Pick-Lock");
});

test("native H.A.M. picking cancels on movement, another action, logout, death or a movement hold", (t) => {
  const random = Math.random;
  Math.random = () => 0;
  t.after(() => { Math.random = random; });
  for (const cancel of [
    (player) => { player.getMovementQueue().walkToReset(); player.setLocation(new core.Location(3165, 3251, 0)); },
    (player) => new ObjectActionPacketListener().executeAction(player, 5492, 3166, 3252, 1),
    (player) => PluginManager.emitCustomEvent("player:world-input", { player, kind: "item_option" }),
    (player) => player.setRegistered(false),
    (player) => player.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 0, false),
    (player) => player.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 0, false),
    (player) => player.getMovementQueue().setBlockMovement(true),
  ]) {
    const player = nativeHamPlayer();
    player.setLocation(new core.Location(3166, 3251, 0));
    new ObjectActionPacketListener().executeAction(player, 5492, 3166, 3252, 5);
    nativeTicks(player, 3);
    cancel(player);
    nativeTicks(player, 20);
    assert.equal(player.getPacketSender().getVarbit(235), 0);
    assert.equal(player.getSkillManager().getExperience(core.Skill.THIEVING), 0);
    assert.equal(DiaryProgress.doneTasks(player, DiaryData.BY_KEY.get("lumbridge")).size, 0);
  }
});

test("H.A.M. diary credit requires the exact entrance and landing, and a completed move", () => {
  const diary = DiaryData.BY_KEY.get("lumbridge");
  const entrance = locAt(5492, 3166, 3252, 0);
  const done = (visit) => DiaryProgress.doneTasks(visit.player, diary).size;
  for (const { before, after } of [
    { before: (visit) => visit.player.getMovementQueue().setBlockMovement(true) },
    { after: (visit) => { visit.player.isRegistered = () => false; } },
    { after: (visit) => visit.player.setLocation(new core.Location(3163, 3252, 0)) },
  ]) {
    const visit = explorer([3166, 3251, 0]);
    before?.(visit);
    hooks.object({ player: visit.player, object: entrance, clickType: 1, handled: false });
    after?.(visit);
    runTicks(visit, 3);
    assert.equal(done(visit), 0, "blocked, logged-out or interrupted travel gives no diary credit");
  }
  const other = explorer([3077, 3492, 0]);
  hooks.object({ player: other.player, object: locAt(12266, 3077, 3493, 0), clickType: 1, handled: false });
  runTicks(other, 6);
  assert.equal(other.player.getLocation().getY(), 9893, "another real trapdoor route still works");
  assert.equal(done(other), 0, "entering another trapdoor does not count");

  const failedMove = explorer([3166, 3251, 0]);
  failedMove.player.moveTo = () => {};
  hooks.object({ player: failedMove.player, object: entrance, clickType: 1, handled: false });
  runTicks(failedMove, 3);
  assert.equal(done(failedMove), 0, "an unsuccessful move does not emit an arrival");

  const lock = explorer([3166, 3251, 0]);
  hooks.object({ player: lock.player, object: entrance, clickType: 5, handled: false });
  runTicks(lock, 3);
  assert.equal(done(lock), 0, "a lock-picking click without entry is not the diary task");

  for (const change of [
    { objectId: 6434 },
    { location: { x: 3165, y: 3252, z: 0 } },
    { at: [3149, 9652, 1] },
    { at: [3166, 3251, 0] },
    { privateArea: {} },
  ]) {
    const visit = explorer(change.at ?? [3149, 9652, 0]);
    if (change.privateArea) visit.player.getPrivateArea = () => change.privateArea;
    PluginManager.emitCustomEvent("loc-teleports:arrived", {
      player: visit.player, objectId: change.objectId ?? 5492,
      location: change.location ?? { x: 3166, y: 3252, z: 0 },
    });
    assert.equal(done(visit), 0, "other objects, placements, planes, destinations and private copies do not count");
  }
});

test("the Tlati dragon nest cave plays as captured: crawl, sound and fade, then in on tick 4", () => {
  // Captured: crawl animation and sound 2454 two ticks after arriving, the fade out with them,
  // the minimap off a tick later, the move on tick 4, the fade back in a tick after it. The
  // click is handled the tick after arriving, so each comes one tick earlier from the click.
  const object = locAt(57591, 1288, 3133, 0);
  const visit = explorer([1289, 3136, 0]);
  const event = { player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false };
  hooks.object(event);
  assert.equal(event.handled, true);
  runTicks(visit, 6);
  assert.deepEqual(visit.ticks, [
    [],
    ["anim 11580", "sound 2454", "open 174"],
    ["varbit 6719=2"],
    ["move 1245,9527,0"],
    ["varbit 6719=0", "open 174"],
    [],
    ["close overlay"],
  ]);
});

test("a Climb that Ladders would ask about goes the captured way: the Arceuus library stairs go up", () => {
  const object = locAt(27851, 1612, 3818, 1);
  const visit = explorer([1615, 3819, 1]);
  const request = { player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false };
  hooks["ladders:climb"](request);
  assert.equal(request.handled, true);
  runTicks(visit, 3);
  assert.deepEqual(visit.player.getLocation().getZ(), 2);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY()], [1608, 3819]);
});

test("the Hunter Guild stairs fade as captured and land where live OSRS does, both ways", () => {
  // Captured (226/1695, 237/4002): the fade out two ticks after arriving, the minimap off a tick
  // later, the move on tick 4, the fade back in a tick after it, the overlay closed two ticks on.
  const down = locAt(51641, 1556, 3048, 0);
  const visit = explorer([1557, 3047, 0]);
  const request = { player: visit.player, object: down, objectId: down.getId(), clickType: 1, handled: false };
  hooks["ladders:climb"](request);
  assert.equal(request.handled, true);
  // A second click while on the way changes nothing: the stairs are already being taken.
  const again = { player: visit.player, object: down, objectId: down.getId(), clickType: 1, handled: false };
  hooks["ladders:climb"](again);
  runTicks(visit, 6);
  assert.deepEqual(visit.ticks, [
    [],
    ["open 174"],
    ["varbit 6719=2"],
    ["move 1558,9451,0"],
    ["varbit 6719=0", "open 174"],
    [],
    ["close overlay"],
  ]);
  assert.equal(visit.player.getMovementQueue().isMovementBlocked(), false);

  const up = locAt(51642, 1557, 9448, 0);
  const back = explorer([1557, 9451, 0]);
  const climb = { player: back.player, object: up, objectId: up.getId(), clickType: 1, handled: false };
  hooks["ladders:climb"](climb);
  assert.equal(climb.handled, true);
  runTicks(back, 6);
  const at = back.player.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [1558, 3047, 0]);
});

test("the Wilderness Slayer Cave's exits lead out beside their surface stairs, and the north stairs lead in (#1350)", () => {
  const walk = (id, x, y, from, hook) => {
    const object = locAt(id, x, y, 0);
    const visit = explorer(from);
    const request = { player: visit.player, object, objectId: id, clickType: 1, handled: false };
    hooks[hook](request);
    assert.equal(request.handled, true, `loc ${id} is taken`);
    runTicks(visit, 3);
    const at = visit.player.getLocation();
    return [at.getX(), at.getY(), at.getZ()];
  };
  assert.deepEqual(walk(40389, 3384, 10050, [3385, 10052, 0], "object"), [3259, 3663, 0], "south exit");
  assert.deepEqual(walk(40391, 3405, 10146, [3406, 10145, 0], "object"), [3293, 3749, 0], "north exit");
  assert.deepEqual(walk(40390, 3293, 3746, [3293, 3749, 0], "ladders:climb"), [3406, 10145, 0], "north entrance");
});

test("another tile or option isn't claimed: the click falls through to whoever handles it", () => {
  const object = locAt(57591, 1288, 3133, 0);
  const visit = explorer([1289, 3136, 0]);
  const event = { player: visit.player, object, objectId: object.getId(), clickType: 2, handled: false };
  hooks.object(event);
  assert.equal(event.handled, false);
});

test("a staircase used from either end takes the side the player stands on", () => {
  const entry = data.locs.find((loc) => loc.name === "ds2_lithkren_dungeon_stairs_lower");
  const { destinationFor } = LocTeleports._test;
  assert.deepEqual(destinationFor(entry, new core.Location(3549, 10468, 0)), [3549, 10473, 0]);
  assert.deepEqual(destinationFor(entry, new core.Location(3549, 10473, 0)), [3549, 10468, 0]);
});

test("Lletya's north and south tree passes cross the western wall from either side", () => {
  for (const [name, x, y, inside, outside] of [
    ["lletya_tree_pass_west_north", 2305, 3191, [2306, 3192, 0], [2304, 3192, 0]],
    ["lletya_tree_pass_west_south", 2305, 3195, [2306, 3195, 0], [2304, 3195, 0]],
  ]) {
    const entry = data.locs.find((loc) => loc.name === name);
    assert.deepEqual(entry?.sides.map((side) => [side.from, side.to]), [[inside, outside], [outside, inside]]);
    const object = locAt(8742, x, y, 0);
    for (const [start, destination] of [[inside, outside], [outside, inside]]) {
      const visit = explorer(start);
      const event = { player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false };
      hooks.object(event);
      assert.equal(event.handled, true, `${name} claims Pass from ${start}`);
      runTicks(visit, 2);
      assert.deepEqual(
        [visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()],
        destination,
        `${name} moves to the tile on the opposite side`,
      );
    }
  }
});

test("trapdoor swaps: each loc has its option, and becomes the other state", () => {
  const swaps = require("../plugins/world/data/loc-swaps.json").swaps;
  for (const swap of swaps) {
    assert.equal(CacheDefinitions.getObject(swap.id)?.actions?.[swap.op - 1], swap.option, swap.name);
    assert.ok(CacheDefinitions.getObject(swap.becomes)?.name, `${swap.name} becomes ${swap.becomes}`);
  }
});

test("Draynor's trapdoor opens as captured, into the open trapdoor Ladders climbs down", () => {
  // Captured: "You open the trapdoor." a tick after arriving, the open-chest animation and
  // sound 91 a tick later, the open trapdoor on tick 3. Its Climb-down already led to the
  // cellar (3084, 9671) through Ladders; only Open did nothing.
  const closed = locAt(6434, 3084, 3272, 0);
  const visit = explorer([3084, 3273, 0]);
  visit.player.sendMessage = (text) => visit.ticks[visit.ticks.length - 1].push(`message ${text}`);
  const event = { player: visit.player, object: closed, objectId: closed.getId(), clickType: 1, handled: false };
  hooks.object(event);
  assert.equal(event.handled, true);
  runTicks(visit, 2);
  assert.deepEqual(visit.ticks, [["message You open the trapdoor."], ["anim 536", "sound 91"], []]);
  assert.ok(MapObjects.get(6435, new core.Location(3084, 3272, 0), null), "the open trapdoor is in place");
  assert.equal(MapObjects.get(6434, new core.Location(3084, 3272, 0), null), null, "the closed one is gone");
});

test("Monk's Friend keeps its cave ladder; other cellar ladders of that id go where the captures show", () => {
  // The ordinary cellar ladder (17385) is placed in many cellars; Monk's Friend sent every one of
  // them to its cave exit in Ardougne.
  const entry = data.locs.find((loc) => loc.id === 17385 && loc.x === 3405 && loc.y === 9907);
  assert.deepEqual(entry?.to, [3405, 3506, 0], "the cellar under the trapdoor north of Paterdomus");
  assert.ok(!data.locs.some((loc) => loc.x === 2561 && loc.y === 9622), "the cave's own ladder stays with the quest");
});

test("status lines, level-ups, food and unreachable clicks aren't refusals; a character turning the player away is", () => {
  const noise = ["<col=ff#>Your prayers have been drained!</col>", "Congratulations, you've just advanced your Agility level. You are now level #.",
    "You eat the shark.", "It heals some health.", "I can't reach that!", "<col=ef#>You have completed your task! You killed</col> # Bloodveld"];
  assert.deepEqual(refusals(captured({ failures: noise.map((message) => [message, 1]) })), []);
  assert.deepEqual(refusals(captured({ failures: [["Goblin guard|Go away, human! We already tell you not to come in!", 1]] })), ["Goblin guard|Go away, human! We already tell you not to come in!"]);
});

test("a gate decided in loc-teleport-sync.json lets a refused loc in, for one tile or every placement of a name", () => {
  const refused = { failures: [["Monk of Zamorak|You better dress appropriately, if you want to go up there!", 4]] };
  assert.match(choose(captured({ name: "chaos_temple_ladder", x: 2939, y: 3518, ...refused }), nothing, "Ladder", { ...decisions, requirements: [] }).reason, /refused/);
  assert.deepEqual(choose(captured({ name: "chaos_temple_ladder", x: 2939, y: 3518, ...refused }), nothing, "Ladder", decisions), { take: true });
  assert.ok(requirementFor({ name: "elid_crevice_clickzone", x: 3373, y: 2906, z: 0 }, decisions), "no tile: every placement");
  for (const entry of data.locs.filter((loc) => loc.name === "elid_crevice_clickzone")) assert.equal(entry.requires?.[0]?.tied, 954, `${entry.x},${entry.y}`);
});

/** Sets every skill's level, for a total. */
function withLevels(player, level) {
  for (const skill of core.Skill.values()) player.getSkillManager().setMaxLevel(skill, level, false).setCurrentLevels(skill, level, false);
}

test("the Chaos Temple ladder needs a total level of 500 and Zamorak robes worn, refusing as captured", () => {
  const object = locAt(31580, 2939, 3518, 0);
  const climb = (setup) => {
    const visit = explorer([2939, 3517, 0]);
    const said = [];
    visit.player.sendMessage = (text) => said.push(text);
    visit.player.getDialogueManager().startDialogues = (chain) => said.push([...chain.getDialogues().values()].map((line) => line.text).join(" / "));
    setup(visit.player);
    const request = { player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false };
    hooks["ladders:climb"](request);
    runTicks(visit, 2);
    return { said, at: visit.player.getLocation().getZ() };
  };
  assert.deepEqual(climb((player) => withLevels(player, 1)), { said: ["You need a skill total of 500 and a set of Zamorak robes equipped to go upstairs."], at: 0 });
  assert.deepEqual(climb((player) => withLevels(player, 30)), { said: ["You better dress appropriately, if you want to go up there!"], at: 0 });
  const robed = climb((player) => {
    withLevels(player, 30);
    player.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(1035, 1)).setItem(core.Equipment.LEG_SLOT, new core.Item(1033, 1));
  });
  assert.deepEqual(robed, { said: [], at: 1 });
});

test("the Elid crevice needs a rope tied first: too steep without, and the rope stays tied", () => {
  const object = locAt(10416, 3374, 2905, 0);
  const visit = explorer([3375, 2905, 0]);
  const said = [];
  visit.player.getDialogueManager().startDialogues = (chain) => said.push([...chain.getDialogues().values()].map((line) => line.text).join(" / "));
  const climb = () => hooks.object({ player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false });
  climb();
  runTicks(visit, 5);
  assert.deepEqual([said, visit.player.getLocation().getY()], [["That looks too steep to safely climb down with just your bare hands."], 2905]);
  const rope = { player: visit.player, object, objectId: object.getId(), itemId: 954, handled: false };
  hooks.itemOnObject(rope);
  assert.equal(rope.handled, true);
  runTicks(visit, 5);
  assert.deepEqual([said.at(-1), visit.player.getLocation().getY()], ["You climb down the rope.", 9305]);
  assert.deepEqual(visit.player.getAttribute("loc-teleports:tied"), ["elid_crevice_clickzone"], "tied for every later climb");
});

test("the Lumbridge Swamp Caves dark hole needs a rope tied once, as the game's entrance", () => {
  const interactions = new Map();
  const itemOnObject = new Map();
  const listeners = new Map();
  const logins = [];
  const api = {
    core,
    persistAttribute() {},
    onObjectInteraction: (name, actions) => interactions.set(name, { ...(interactions.get(name) ?? {}), ...actions }),
    onItemOnObject: (item, object, handler) => itemOnObject.set(`${item}:${object}`, handler),
    onCustomEvent: (name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
    emitCustomEvent: (name, payload) => (listeners.get(name) ?? []).forEach((handler) => handler(payload)),
    onPlayerLogin: (handler) => logins.push(handler),
    getTaskManager: () => core.TaskManager,
    sendMultiChatboxPrompt: () => true,
  };
  require("../plugins/objects/Ladders.plugin").register(api);
  const Misthalin = require("../plugins/areas/Misthalin.plugin");
  Misthalin.register(api);

  const object = locAt(5947, 3169, 3172, 0);
  assert.equal(CacheDefinitions.getObject(5947).actions[0], "Climb-down");
  const landing = (x, y) => Misthalin._test.swampCavesLanding({ x, y, z: 0 });
  assert.deepEqual([landing(3169, 3171), landing(3168, 3172), landing(3170, 3172), landing(3169, 3173)], [
    { x: 3169, y: 9571, z: 0 }, { x: 3168, y: 9572, z: 0 }, { x: 3170, y: 9572, z: 0 }, { x: 3167, y: 9573, z: 0 },
  ], "the tile below the side the player used (shortest-path transports)");
  core.RegionManager.loadMapFiles(3168, 9572);
  assert.equal(core.RegionManager.blocked(new core.Location(3168, 9572, 0), null), false, "the landing is walkable");

  const visit = explorer([3168, 3172, 0]);
  const click = () => {
    const event = { player: visit.player, object, objectId: 5947, clickType: 1, location: { x: 3169, y: 3172, z: 0 }, handled: false };
    interactions.get("Dark hole")["Climb-down"](event);
    return event;
  };
  assert.equal(click().handled, true);
  runTicks(visit, 2);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY()], [3168, 3172], "no rope: stays on the surface");
  assert.ok(visit.player.getAttribute(Misthalin._test.SWAMP_CAVE_ROPED_ATTRIBUTE) !== true);

  visit.player.getInventory().add(new core.Item(954, 1), false);
  const rope = { player: visit.player, object, objectId: 5947, itemId: 954, location: { x: 3169, y: 3172, z: 0 }, handled: false };
  assert.equal(itemOnObject.get("Rope:Dark hole")(rope), true);
  assert.equal(rope.handled, true);
  assert.equal(visit.player.getAttribute(Misthalin._test.SWAMP_CAVE_ROPED_ATTRIBUTE), true, "the rope stays tied");
  assert.equal(visit.player.getInventory().getAmount(954), 0, "the rope is used up");
  assert.ok(visit.ticks.flat().includes(`varbit ${Misthalin._test.SWAMP_CAVE_ROPED_VARBIT}=1`));

  click();
  runTicks(visit, 2);
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], [3168, 9572, 0]);
  visit.nextTick();
  logins[0]({ player: visit.player });
  assert.deepEqual(visit.ticks.at(-1), [`varbit ${Misthalin._test.SWAMP_CAVE_ROPED_VARBIT}=1`], "the varbit is restored on login");
});

test("a window that asks first: the game's question, then out on Yes, a tick after the climb", () => {
  // Captured: "Climb out of the window?" Yes./No.; the climb and sound a tick after the answer, out a tick later.
  const object = locAt(52998, 1670, 3088, 0);
  const visit = explorer([1670, 3088, 0]);
  hooks.object({ player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false });
  const prompt = prompts.pop();
  assert.deepEqual([prompt.title, prompt.options], ["Climb out of the window?", ["Yes.", "No."]]);
  prompt.pick("Yes.");
  runTicks(visit, 2);
  assert.deepEqual(visit.ticks, [[], ["anim 828", "sound 2452"], ["move 1670,3087,0"]]);
  const stay = explorer([1670, 3088, 0]);
  hooks.object({ player: stay.player, object, objectId: object.getId(), clickType: 1, handled: false });
  prompts.pop().pick("No.");
  runTicks(stay, 3);
  assert.deepEqual([stay.player.getLocation().getX(), stay.player.getLocation().getY()], [1670, 3088], "No. stays");
});

test("a ladder that asks up or down: the captured way goes there, the other is Ladders' to find", () => {
  const object = locAt(12965, 3164, 3307, 1);
  const visit = explorer([3164, 3306, 1]);
  hooks["ladders:climb"]({ player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false });
  const prompt = prompts.pop();
  assert.deepEqual([prompt.title, prompt.options], ["Climb up or down the ladder?", ["Climb Up.", "Climb Down."]]);
  prompt.pick("Climb Down.");
  assert.equal(emitted.at(-1)[0], "ladders:climbDown");
  hooks["ladders:climb"]({ player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false });
  prompts.pop().pick("Climb Up.");
  runTicks(visit, 1);
  assert.equal(visit.player.getLocation().getZ(), 2);
});


test('The White Knights Castle west stairs connect every floor to the WGS herb patch', () => {
 const stairs=data.locs.filter(e=>e.name.startsWith('fai_falador_castle_spiralstairs'));
 assert.equal(stairs.length,6);
 for(const [z,up] of [[0,true],[1,true],[2,true],[1,false],[2,false],[3,false]]){
  const e=stairs.find(e=>e.z===z&&e.option===(up?'Climb-up':'Climb-down'));assert.ok(e);
  assert.equal(e.to[2],z+(up?1:-1));
 }
});


test("Tears of Guthix northern rocks let both cave shelves cross in either direction", () => {
  const { RegionManager } = core;
  RegionManager.loadMapFiles(3240, 9524);
  for (const y of [9524, 9525]) {
    const object = locAt(6673, 3240, y, 2);
    for (const [from, to] of [[[3241, y, 2], [3239, y, 2]], [[3239, y, 2], [3241, y, 2]]]) {
      const visit = explorer(from);
      const event = { player: visit.player, object, objectId: 6673, clickType: 1, handled: false };
      hooks.object(event); assert.equal(event.handled, true); runTicks(visit, 3);
      assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], to);
      const outward = to[0] < 3240 ? -1 : 1;
      assert.equal(RegionManager.canMove(to[0], to[1], to[0] + outward, to[1], 2, 1, 1), true, 'landing is on a walkable shelf');
    }
  }
});


test("Araxyte cave reverse tunnels return to the quest nest", () => {
  const { destinationFor } = LocTeleports._test;
  const east = data.locs.find(loc => loc.id === 54272 && loc.x === 3693);
  const south = data.locs.find(loc => loc.id === 54272 && loc.x === 3681);
  const north = data.locs.find(loc => loc.id === 54273);
  assert.deepEqual(destinationFor(east, new core.Location(3696, 9839, 0)), [3689, 9837, 0]);
  assert.deepEqual(destinationFor(south, new core.Location(3684, 9822, 0)), [3677, 9822, 0]);
  assert.deepEqual(destinationFor(north, new core.Location(3680, 9849, 0)), [3680, 9842, 0]);
});

test("the Pandemonium cave's Opening exits as captured: crawl, sound and fade, then out on tick 5", () => {
  // Captured (235, 237): the same crawl and sound as the way in, the move back beside the entrance.
  const object = locAt(58093, 3041, 9397, 0);
  const visit = explorer([3042, 9399, 0]);
  const event = { player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false };
  hooks.object(event);
  assert.equal(event.handled, true);
  runTicks(visit, 7);
  const flat = visit.ticks.flat();
  assert.ok(flat.includes("anim 11580") && flat.includes("sound 2454") && flat.includes("open 174"));
  assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], [3046, 2996, 0]);
});

test("the plain exits and entrances taken by name land where live OSRS does", () => {
  const cases = [
    ["wyvern_snow_cave_entrance", 10596, [3055, 9561, 0], [3056, 9562, 0]],
    ["wyvern_snow_cave_exit", 10595, [3055, 9556, 0], [3057, 9555, 0]],
    ["molch_temple_lizard_dwelling", 34402, [1292, 3657, 0], [1292, 3659, 0]],
    ["zeah_cata_exit_giants_den", 42350, [1639, 10047, 0], [1640, 10047, 0]],
    ["fossil_flora_swamp_bellshroom_return", 30671, [3655, 3751, 0], [3656, 3751, 0]],
    ["rc_zmi_dungeon_wall_crack_entrance", 29626, [3053, 5587, 0], [3052, 5587, 0]],
  ];
  for (const [name, id, at, from] of cases) {
    assert.ok(decisions.include[name], `${name} is taken by name`);
    const entry = data.locs.find((loc) => loc.name === name);
    const visit = explorer(from);
    const object = locAt(id, ...at);
    const event = { player: visit.player, object, objectId: object.getId(), clickType: 1, handled: false };
    hooks.object(event);
    assert.equal(event.handled, true, name);
    runTicks(visit, entry.tick + 3);
    assert.deepEqual([visit.player.getLocation().getX(), visit.player.getLocation().getY(), visit.player.getLocation().getZ()], entry.to, name);
  }
});

test("hand-added gates are decisions, so a sync keeps them", () => {
  for (const entry of data.locs.filter((loc) => loc.requires || loc.mesbox)) {
    const gate = requirementFor(entry, decisions);
    assert.deepEqual(entry.requires, gate?.requires, `${entry.name} ${entry.x},${entry.y}`);
  }
});
