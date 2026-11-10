// Vale Totems miniquest cutscenes (plugins/quests/valetotems/Scenes.ValeTotems.js) against the
// timings of RSProx capture 20261109T224258-5ab63b4. Run after `yarn build`:
//   node --test tests/vale-totems-scenes.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");

const INSTANCE_OFFSET = 20000;
let Scenes;
const npcs = [];

/** The instance's tiles are the source tiles moved by INSTANCE_OFFSET; it only tracks who is in. */
class FakeInstance {
  constructor() { this.inside = new Set(); }
  setChunk() {}
  tile(x, y, z) {
    const { Location } = PluginManager.getCoreApi();
    return new Location(INSTANCE_OFFSET + 1312 + x, INSTANCE_OFFSET + 3320 + y, z);
  }
  enter(player) { this.inside.add(player); player.area = this; }
  leave(player, logout) { this.inside.delete(player); player.area = null; this.postLeave(player, logout); }
  postLeave() {}
  destroy() { this.destroyed = true; }
  add() {}
}

function fakeNpc(id, location) {
  const npc = {
    id, location, faced: null, animations: [], registered: true,
    getLocation: () => npc.location,
    setPositionToFace: (tile) => { npc.faced = tile; },
    performAnimation: (animation) => npc.animations.push(animation.getId()),
    isRegistered: () => npc.registered,
    getMovementQueue: () => movement(npc),
  };
  npcs.push(npc);
  return npc;
}

/** Walks one queued tile per world tick, enough for the timeline's paths. */
function movement(mobile) {
  mobile.queue ??= {
    steps: [], blocked: false,
    reset() { this.steps = []; return this; },
    setBlockMovement(value) { this.blocked = value; return this; },
    addSteps(tile) {
      const { Location } = PluginManager.getCoreApi();
      let { x, y } = this.steps.at(-1) ?? { x: mobile.getLocation().getX(), y: mobile.getLocation().getY() };
      while (x !== tile.getX() || y !== tile.getY()) {
        x += Math.sign(tile.getX() - x);
        y += Math.sign(tile.getY() - y);
        this.steps.push({ x, y, tile: new Location(x, y, 0) });
      }
    },
    size() { return this.steps.length; },
    step() { if (!this.blocked || mobile.isNpc) { const next = this.steps.shift(); if (next) mobile.location = next.tile; } },
  };
  return mobile.queue;
}

function fakeApi() {
  const core = PluginManager.getCoreApi();
  return {
    core: { ...core, TemplatedInstanceArea: FakeInstance },
    spawnNpc: ({ id, x, y, z }) => {
      const npc = fakeNpc(id, new core.Location(x, y, z));
      npc.isNpc = true;
      return npc;
    },
    removeNpc: (npc) => { npc.registered = false; },
  };
}

function createPlayer() {
  const { Location } = PluginManager.getCoreApi();
  const varps = new Map();
  const chains = [];
  const sent = { graphics: [], sounds: [], songs: [], cameras: [] };
  const sender = new Proxy({
    getVarp: (id) => varps.get(id) ?? 0,
    sendConfig: (id, value) => { varps.set(id, value); return sender; },
    getVarbit: (id) => {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      return ((varps.get(baseVar) ?? 0) >>> startBit) & ((1 << (endBit - startBit + 1)) - 1);
    },
    sendVarbit: (id, value) => {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = ((1 << (endBit - startBit + 1)) - 1) << startBit;
      varps.set(baseVar, ((varps.get(baseVar) ?? 0) & ~mask) | ((value << startBit) & mask));
      return sender;
    },
    sendGraphic: (graphic, tile) => { sent.graphics.push({ id: graphic.id, x: tile.getX(), y: tile.getY() }); return sender; },
    sendSound: (id) => { sent.sounds.push(id); return sender; },
    sendSong: (id) => { sent.songs.push(id); return sender; },
    sendCameraMoveTo: (x, y, height, options) => { sent.cameras.push({ x, y, height, cycles: options?.cycles }); return sender; },
  }, { get: (target, key) => key in target ? target[key] : () => sender });
  const player = {
    location: new Location(1366, 3367, 0), area: null, registered: true, chains, sent,
    getLocation: () => player.location,
    moveTo: (tile) => { player.location = tile; },
    setLocation: (tile) => { player.location = tile; },
    setPositionToFace() {},
    performAnimation() {},
    setUntargetable() {},
    isRegistered: () => player.registered,
    getPrivateArea: () => player.area,
    getPacketSender: () => sender,
    getMovementQueue: () => movement(player),
    getSpellbook: () => ({ getInterfaceId: () => 218 }),
    getInventory: () => ({ refreshItems() {} }),
    getEquipment: () => ({ refreshItems() {} }),
    getDialogueManager: () => ({
      startDialogues: (builder) => {
        const entries = [...builder.getDialogues().values()];
        chains.push(entries);
        // A held (blank) chatbox runs its own action; a line waits for the test to continue it.
        if (entries.length === 1 && entries[0].constructor.name === "ActionDialogue") entries[0].send(player);
      },
    }),
  };
  return player;
}

const varbit = (player, name) => player.getPacketSender().getVarbit(CacheDefinitions.getVarbitId(name));

function tick(count = 1, ...movers) {
  for (let i = 0; i < count; i++) {
    TaskManager.process();
    for (const mobile of movers) mobile.queue?.step();
    for (const npc of npcs) npc.queue?.step();
  }
}

/** Continues the last line on screen: the chain's action after it starts the next segment. */
function continueLine(player) {
  const chain = player.chains.at(-1);
  const action = chain.find((entry) => entry.constructor.name === "ActionDialogue");
  action.send(player);
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Scenes = require("../plugins/quests/valetotems/Scenes.ValeTotems")(fakeApi());
});

test("as captured (ticks 469-495): the ent's worship scene, its stage checkpoint and the return", () => {
  const player = createPlayer();
  const log = [];
  let tickCount = 0;
  Scenes.play(player, "worship", {
    actions: { "ent-worshipped": () => log.push(["worshipped", tickCount + 1]) },
    done: () => log.push(["done", tickCount + 1]),
  });
  assert.equal(player.getMovementQueue().blocked, true, "locked from the first fade");
  assert.equal(varbit(player, "cutscene_status"), 0, "cutscene vars wait for the rebuild");
  const step = () => { tick(1, player); tickCount++; };
  step(); step();
  assert.equal(tickCount, 2);
  assert.ok(player.area, "rebuilt into the instance two ticks after the fade (tick 471)");
  assert.equal(player.location.getX(), INSTANCE_OFFSET + 1366);
  assert.equal(varbit(player, "cutscene_status"), 1);
  assert.equal(varbit(player, "fov_clamp"), 3);
  assert.equal(varbit(player, "minimap_state"), 2);
  assert.deepEqual(player.sent.songs, [822]);
  const ent = npcs.find((npc) => npc.id === 14583 && npc.registered);
  assert.ok(ent, "the ent actor");
  while (tickCount < 10) step();
  assert.deepEqual([ent.location.getX() - INSTANCE_OFFSET, ent.location.getY() - INSTANCE_OFFSET], [1370, 3372], "the ent reaches the totem by tick 478");
  step();
  assert.deepEqual(log, [["worshipped", 11]], "stage 20 on tick 480");
  assert.deepEqual(ent.animations, [12511]);
  step(); step();
  assert.equal(player.sent.cameras.at(-1).cycles, 120, "the camera glides on tick 482");
  while (tickCount < 22) step();
  assert.equal(player.area, null, "back on the real map on tick 491");
  assert.deepEqual([player.location.getX(), player.location.getY()], [1366, 3368]);
  assert.equal(varbit(player, "fov_clamp"), 0);
  assert.equal(varbit(player, "cutscene_status"), 0, "every cutscene var goes on the exit tick");
  assert.equal(varbit(player, "minimap_state"), 0);
  assert.equal(player.getMovementQueue().blocked, true, "still locked until the fade-in");
  assert.equal(ent.registered, false, "the actors go with the instance");
  while (tickCount < 26) step();
  assert.deepEqual(log.at(-1), ["done", 26], "the talk goes on on tick 495");
  assert.equal(varbit(player, "cutscene_status"), 0);
  assert.equal(player.getMovementQueue().blocked, false);
  assert.equal(Scenes.active(player), false);
});

test("as captured (ticks 506-538): the break scene waits on its two lines, then breaks the totem", () => {
  const player = createPlayer();
  const log = [];
  Scenes.play(player, "break", { actions: { "totem-broken": () => log.push("broken") }, done: () => log.push("done") });
  tick(8, player);
  const line = player.chains.at(-1)[0];
  assert.equal(line.constructor.name, "PlayerDialogue");
  assert.equal(line.getText(), "It's a beautiful totem.");
  assert.deepEqual([player.location.getX() - INSTANCE_OFFSET, player.location.getY() - INSTANCE_OFFSET], [1371, 3373], "walked up to the totem");
  tick(20, player);
  assert.deepEqual(log, [], "the scene waits for the continue");
  continueLine(player);
  assert.equal(player.chains.at(-1)[0].getText(), "Indeed! Look at this bit!");
  continueLine(player);
  const ranulph = npcs.find((npc) => npc.id === 14582 && npc.registered);
  assert.deepEqual(ranulph.animations, [881]);
  tick(1, player);
  assert.deepEqual(log, ["broken"]);
  assert.deepEqual(player.sent.graphics.at(-1), { id: 2369, x: INSTANCE_OFFSET + 1370, y: INSTANCE_OFFSET + 3375 });
  assert.deepEqual(player.sent.sounds.slice(-2), [1739, 7018]);
  tick(11, player);
  assert.deepEqual(log, ["broken", "done"]);
  assert.deepEqual([player.location.getX(), player.location.getY()], [1366, 3368]);
});

test("a logout mid-scene puts the player back on the real map without finishing it", () => {
  const player = createPlayer();
  const log = [];
  Scenes.play(player, "offering", { actions: { "offerings-left": () => log.push("left") }, done: () => log.push("done") });
  tick(5, player);
  assert.ok(player.area);
  player.area.leave(player, true);
  assert.equal(Scenes.active(player), false);
  assert.deepEqual([player.location.getX(), player.location.getY()], [1366, 3368]);
  assert.equal(varbit(player, "fov_clamp"), 0);
  tick(30, player);
  assert.deepEqual(log, [], "the checkpoint and the end never run, so the stage replays");
});
