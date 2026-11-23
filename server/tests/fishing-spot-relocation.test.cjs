// Run after `yarn build`: node --test tests/fishing-spot-relocation.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

// rsprox captures (local 1001517, 1001439, 1001502 ...): Lumbridge Swamp's 0_50_49_saltfish spots.
const SWAMP_TILES = [[3240, 3146], [3240, 3147], [3241, 3148], [3242, 3143], [3242, 3148], [3244, 3150], [3245, 3152], [3246, 3155]];
const SWAMP_SPAWNS = [[3240, 3146], [3240, 3147], [3244, 3150], [3245, 3152], [3246, 3155]];

// Real ownership boundary, separate from the lightweight timing/selection fixtures below.
async function liveWorld(t) {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi(), Fishing = require("../plugins/skills/Fishing.plugin");
  const Relocation = require("../plugins/skills/fishing/Relocation.Fishing");
  Relocation.reset();
  const actors = [], areas = [], tasks = [], events = [], sounds = [];
  const api = PluginManager.createApi("FishingOccupancyRegression");
  api.getTaskManager = () => ({ submit(task) { tasks.push(task); return core.TaskManager.submit(task); } });
  api.emitCustomEvent = (name, event) => events.push([name, event]);
  t.mock.method(core.Sounds, "playAreaSound", (sound) => sounds.push(sound));
  t.mock.method(Math, "random", () => 0); // ordinary minimum timer and deterministic first candidate
  Relocation.attach(api, { spotTools: () => [Fishing.TOOLS.NET], names: Fishing.FISHING_SPOT_NAMES });
  t.after(() => {
    for (const npc of actors) {
      const area = npc.getPrivateArea();
      if (area) area.leave(npc, false);
      if (npc.isRegistered()) core.World.getNpcs().remove(npc);
    }
    for (const area of areas) area.destroy();
    for (const task of tasks) task.stop();
    core.TaskManager.process();
    Relocation.reset();
  });
  function area() {
    class Copy extends core.PrivateArea { postLeave(mobile) { this.remove(mobile); } }
    const value = new Copy([new core.Boundary(3230, 3260, 3130, 3170, 0)]);
    areas.push(value);
    return value;
  }
  function spot(tile, privateArea) {
    const npc = core.NPC.create(core.NpcIdentifiers.FISHING_SPOT_30, new core.Location(...tile, 0));
    assert.equal(core.World.getNpcs().add(npc), true);
    npc.setNeedsPlacement(false);
    if (privateArea) privateArea.enter(npc);
    actors.push(npc);
    return npc;
  }
  const ticks = (count) => { for (let i = 0; i < count; i++) { core.World.processCycle++; core.TaskManager.process(); } };
  return { core, Relocation, area, spot, ticks, events, sounds };
}

test("late public registration reserves its tile before timer discovery at ordinary tick251", async (t) => {
  const { core, Relocation, spot, ticks, events, sounds } = await liveWorld(t);
  const old = spot(SWAMP_TILES[0]);
  ticks(250);
  assert.deepEqual([old.getLocation().getX(), old.getLocation().getY()], SWAMP_TILES[0]);
  const late = spot(SWAMP_TILES[1]);
  assert.equal(Relocation.isRelocating(late), false, "registration is later than scan201");
  ticks(1);
  assert.equal(old.getLocation().equals(late.getLocation()), false, "a current public occupant cannot be overlapped");
  assert.deepEqual([old.getLocation().getX(), old.getLocation().getY()], SWAMP_TILES[2]);
  assert.equal(events.length, 1);
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].soundId, Relocation.MOVE_SOUND);
  assert.deepEqual([sounds[0].x, sounds[0].y], SWAMP_TILES[0]);
  assert.equal(Relocation.isRelocating(late), false, "occupancy does not eagerly enroll a timer");
  ticks(50);
  assert.equal(Relocation.isRelocating(late), true, "normal scan301 still discovers the late spot");
  core.World.getNpcs().remove(late);
  const site = Relocation.SITES.find((value) => value.name === "0_50_49_saltfish");
  assert.ok(Relocation.freeTiles(old, site).some(([x, y]) => x === SWAMP_TILES[1][0] && y === SWAMP_TILES[1][1]),
    "ordinary World removal immediately releases occupancy before the next discovery scan");
  ticks(1);
  assert.equal(Relocation.isRelocating(late), false);
  assert.equal(core.World.getNpcs().add(late), true);
  late.setNeedsPlacement(false);
  ticks(99);
  assert.equal(Relocation.isRelocating(late), true, "ordinary re-registration can enroll again at scan401");
});

test("conditional private copies do not reserve public site tiles or receive public timers", async (t) => {
  const { Relocation, area, spot, ticks } = await liveWorld(t);
  const shared = spot(SWAMP_TILES[0]), copy = area();
  const hidden = SWAMP_TILES.slice(1).map((tile) => spot(tile, copy));
  ticks(251);
  assert.deepEqual([shared.getLocation().getX(), shared.getLocation().getY()], SWAMP_TILES[1]);
  assert.ok(hidden.every((npc, index) => !Relocation.isRelocating(npc)
    && npc.getLocation().getX() === SWAMP_TILES[index + 1][0]
    && npc.getLocation().getY() === SWAMP_TILES[index + 1][1]));
});

test("conditional public-to-private transfer ends eligibility before an ordinary due move", async (t) => {
  const { Relocation, area, spot, ticks, events } = await liveWorld(t);
  const npc = spot(SWAMP_TILES[0]);
  ticks(250);
  assert.equal(Relocation.isRelocating(npc), true);
  area().enter(npc);
  ticks(1);
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], SWAMP_TILES[0]);
  assert.equal(events.length, 0);
  assert.equal(Relocation.isRelocating(npc), false, "private spots no longer count as public timed movers");
});

async function world() {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const Fishing = require("../plugins/skills/Fishing.plugin");
  const Relocation = require("../plugins/skills/fishing/Relocation.Fishing");
  Relocation.reset();

  const npcs = [];
  const tasks = [];
  const events = [];
  const api = new Proxy({
    core,
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
    getWorld: () => ({ getNpcs: () => npcs }),
    emitCustomEvent: (name, payload) => events.push([name, payload]),
  }, { get: (target, name) => target[name] ?? (() => {}) });
  Fishing.register(api);
  const relocation = tasks.find((task) => task.constructor.name !== "FishingTask" && !task.constructor.name.includes("Minnow") &&
    String(task.execute).includes("processSpots"));

  function spot(id, x, y, z = 0, extra = {}) {
    let at = new core.Location(x, y, z);
    const npc = {
      getId: () => id,
      getIndex: () => npcs.length + 1,
      getDefinition: () => core.NpcDefinition.forId(id),
      getLocation: () => at,
      getPrivateArea: () => null,
      isRegistered: () => true,
      moveTo: () => { throw new Error("a spot moves by telejump, not a plain move"); },
      telejump: (to) => { at = to; },
      ...extra,
    };
    npcs.push(npc);
    return npc;
  }
  const sounds = [];
  const playAreaSound = core.Sounds.playAreaSound;
  core.Sounds.playAreaSound = (options) => sounds.push(options);
  const restore = () => { core.Sounds.playAreaSound = playAreaSound; };
  const ticks = (count) => { for (let i = 0; i < count; i++) relocation.execute(); };
  return { core, Fishing, Relocation, spot, ticks, sounds, events, restore };
}

test("fishing spot sites come from the captures: Lumbridge Swamp is 8 tiles shared by 5 spots", () => {
  const Relocation = require("../plugins/skills/fishing/Relocation.Fishing");
  const swamp = Relocation.SITES.find((site) => site.name === "0_50_49_saltfish");
  assert.deepEqual(swamp.tiles, SWAMP_TILES);
  assert.equal(swamp.spots, 5);
  assert.equal(swamp.plane, 0);
  for (const site of Relocation.SITES) {
    assert.ok(site.jumps > 0, `${site.name}: only sites with a recorded move`);
    const keys = site.tiles.map(([x, y]) => `${x},${y}`);
    assert.equal(new Set(keys).size, keys.length, `${site.name}: no duplicate tiles`);
  }
});

test("spots move on the Wiki's timers; stationary and minnow spots never do", async () => {
  const { Fishing, Relocation, restore } = await world();
  restore();
  const { TOOLS } = Fishing;
  assert.deepEqual(Relocation.moveTicksFor([TOOLS.NET, TOOLS.FISHING_ROD]), [250, 530]);
  assert.deepEqual(Relocation.moveTicksFor([TOOLS.SACRED_EEL_ROD]), [100, 300]);
  assert.deepEqual(Relocation.moveTicksFor([TOOLS.INFERNAL_EEL_ROD]), [100, 300]);
  assert.deepEqual(Relocation.moveTicksFor([TOOLS.ANGLERFISH_ROD]), [8, 830]);
  assert.equal(Relocation.moveTicksFor([TOOLS.KARAMBWAN_VESSEL]), null, "karambwan spots never move");
  const stationary = Object.values(TOOLS).filter((tool) => tool.stationary);
  assert.ok(stationary.length >= 2, "Civitas big net and karambwan");
  for (const tool of stationary) assert.equal(Relocation.moveTicksFor([tool]), null);
  for (const tool of Object.values(TOOLS).filter((t) => t.spot)) assert.equal(Relocation.moveTicksFor([tool]), null, "minnows move themselves");
  assert.equal(Relocation.moveTicksFor([]), null);
  // Camdozaal's spots aren't on the Wiki's never-move list, and rsprox recording 1444 shows them moving.
  const { NpcDefinition, NpcIdentifiers: N } = require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
  const camdozaal = NpcDefinition.forId(N.FISHING_SPOT_93); // camdozaal_fishingspot_1
  const tools = camdozaal.getActions().map((_, i) => Fishing.getSpotTool(N.FISHING_SPOT_93, camdozaal, i + 1)).filter(Boolean);
  assert.ok(tools.length > 0);
  assert.deepEqual(Relocation.moveTicksFor(tools), [250, 530]);
});

test("Lumbridge Swamp spots jump between the captured tiles: free tiles only, 250-530 ticks apart, a sound where they left", async () => {
  const { core, Relocation, spot, ticks, sounds, events, restore } = await world();
  const { NpcIdentifiers: N } = core;
  try {
    const spots = SWAMP_SPAWNS.map(([x, y]) => spot(N.FISHING_SPOT_30, x, y));
    const elsewhere = spot(N.FISHING_SPOT_30, 2900, 3120);
    ticks(1);
    for (const s of spots) assert.ok(Relocation.isRelocating(s));
    assert.equal(Relocation.isRelocating(elsewhere), false, "a spot on no captured site stays put");

    const tiles = new Set(SWAMP_TILES.map(([x, y]) => `${x},${y}`));
    const last = new Map(spots.map((s) => [s, 1]));
    const gaps = [];
    for (let t = 2; t <= 20000; t++) {
      const before = new Map(spots.map((s) => [s, `${s.getLocation().getX()},${s.getLocation().getY()}`]));
      const heard = sounds.length;
      ticks(1);
      let moved = 0;
      for (const s of spots) {
        const now = `${s.getLocation().getX()},${s.getLocation().getY()}`;
        if (now === before.get(s)) continue;
        moved++;
        assert.ok(tiles.has(now), `${now} is a captured tile`);
        // Two spots moving on one tick may swap into a tile the other just left.
        const stayed = spots.filter((other) => other !== s &&
          `${other.getLocation().getX()},${other.getLocation().getY()}` === before.get(other));
        assert.ok(!stayed.some((other) => before.get(other) === now), "never onto a tile another spot held");
        gaps.push(t - last.get(s));
        last.set(s, t);
      }
      const played = sounds.slice(heard);
      assert.equal(played.length, moved);
      for (const sound of played) {
        assert.equal(sound.soundId, 2601);
        assert.equal(sound.radius, 5);
        assert.ok([...before.values()].includes(`${sound.x},${sound.y}`), "the sound is at the tile left");
      }
      const occupied = spots.map((s) => `${s.getLocation().getX()},${s.getLocation().getY()}`);
      assert.equal(new Set(occupied).size, spots.length, "no two spots share a tile");
    }
    assert.ok(gaps.length > 150, `spots kept moving (${gaps.length} moves)`);
    // The first move comes anywhere up to 530 ticks after boot, every later one 250-530 after the last.
    assert.ok(gaps.every((gap) => gap >= 1 && gap <= 530));
    const later = gaps.filter((gap, i) => i >= spots.length);
    assert.ok(later.every((gap) => gap >= 250 && gap <= 530), `gaps ${Math.min(...later)}-${Math.max(...later)}`);
    assert.equal(elsewhere.getLocation().getX(), 2900);
    assert.ok(events.some(([name]) => name === "fishing:spot-moved"));
  } finally {
    restore();
  }
});

test("a spot with every site tile held waits; another fishing spot on a tile holds it too", async () => {
  const { core, Relocation, spot, ticks, sounds, restore } = await world();
  const { NpcIdentifiers: N } = core;
  try {
    const spots = SWAMP_TILES.slice(0, 7).map(([x, y]) => spot(N.FISHING_SPOT_30, x, y));
    // Another spot type standing on the last free tile (live shares tiles between spot types).
    spot(N.FISHING_SPOT_21, ...SWAMP_TILES[7]);
    ticks(1);
    assert.equal(Relocation.moveSpot(spots[0]), false, "nowhere free");
    assert.deepEqual([spots[0].getLocation().getX(), spots[0].getLocation().getY()], SWAMP_TILES[0]);
    assert.equal(sounds.length, 0);
    ticks(2000);
    assert.equal(sounds.length, 0, "no spot moves while every tile is held");
  } finally {
    restore();
  }
});

test("spots in a private area, and agent advance-time brings moves closer", async () => {
  const { core, Relocation, spot, ticks, restore } = await world();
  const { NpcIdentifiers: N } = core;
  try {
    const instanced = spot(N.FISHING_SPOT_30, 3240, 3146, 0, { getPrivateArea: () => ({}) });
    const open = spot(N.FISHING_SPOT_30, 3240, 3147);
    ticks(1);
    assert.equal(Relocation.isRelocating(instanced), false, "instances keep their own spots");
    assert.ok(Relocation.isRelocating(open));
    const event = { ms: 530 * 600, handledBy: [] };
    Relocation.advanceTime(event);
    assert.deepEqual(event.handledBy, ["Fishing spot movement"]);
    ticks(1);
    assert.notDeepEqual([open.getLocation().getX(), open.getLocation().getY()], [3240, 3147], "moved on the next tick");
  } finally {
    restore();
  }
});

test("spots that join the world a few ticks after boot are picked up at once, not a scan later", async () => {
  const { core, Relocation, spot, ticks, restore } = await world();
  const { NpcIdentifiers: N } = core;
  try {
    ticks(3);
    const late = spot(N.FISHING_SPOT_30, 3240, 3146);
    ticks(1);
    assert.ok(Relocation.isRelocating(late), "spawns load over the first ticks after boot");
  } finally {
    restore();
  }
});
