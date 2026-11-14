// Run after `yarn build`: node --test tests/tar-swamp-mushroom.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const Mushroom = require("../plugins/world/TarSwampMushroom.plugin");

const MUSHROOM = 6004;
const tasks = [];
const hooks = {};
const persisted = {};
let login = null;
const core = { ...PluginManager.getCoreApi(), TaskManager: { submit: (task) => tasks.push(task) } };
Mushroom.register({
  core,
  persistAttribute: (key, value) => { persisted[key] = value; },
  onPlayerLogin: (handler) => { login = handler; },
  onCanLogout: (handler) => { hooks.canLogout = handler; },
  onPlayerLogout: (handler) => { hooks.logout = handler; },
  onObjectInteraction: (name, actions) => { hooks[name] = actions; },
  sendMultiChatboxPrompt: (player, title, ...pairs) => {
    player.prompt = { title, pairs };
    return true;
  },
});

let BED_VARBIT = null;
let FILLED_VARBIT = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  BED_VARBIT = CacheDefinitions.getVarbitId("fossil_mushroom_bed");
  FILLED_VARBIT = CacheDefinitions.getVarbitId("fossil_activity_mushroombed");
  assert.equal(BED_VARBIT, 5809);
  assert.equal(FILLED_VARBIT, 251);
});

function createPlayer({ mushrooms = 0, at = [3665, 3808, 0], attributes = {} } = {}) {
  const log = [];
  const varbits = {};
  const attrs = { ...attributes };
  let location = new Location(...at);
  let count = mushrooms;
  const sender = {
    sendVarbit: (id, value) => { varbits[id] = value; log.push(`varbit ${id}=${value}`); return sender; },
    sendSound: (id, volume, delay) => { log.push(`sound ${id} ${delay}`); return sender; },
  };
  const movement = { reset() { return movement; }, setBlockMovement: (blocked) => { log.push(blocked ? "lock" : "unlock"); return movement; } };
  const hits = [];
  return {
    log,
    varbits,
    hits,
    dialogues: [],
    registered: true,
    get mushrooms() { return count; },
    getAttribute: (key) => attrs[key],
    setAttribute: (key, value) => { attrs[key] = value; },
    getPacketSender: () => sender,
    getLocation: () => location,
    moveTo(to) { location = to; log.push(`moveTo ${to.getX()},${to.getY()},${to.getZ()}`); },
    getMovementQueue: () => movement,
    isRegistered() { return this.registered; },
    sendMessage: (text) => log.push(`message ${text}`),
    forceChat: (text) => log.push(`say ${text}`),
    performAnimation: (animation) => log.push(`anim ${animation.getId()}`),
    performGraphic: (graphic) => log.push(`gfx ${graphic.getId()}`),
    getInventory: () => ({
      getAmount: (id) => (id === MUSHROOM ? count : 0),
      delete: (id, amount) => { if (id === MUSHROOM) count -= amount; },
    }),
    getDialogueManager() { return { startDialogues: (chain) => this.dialogues.push(chain) }; },
    hitpoints: 99,
    getSkillManager() {
      return {
        getCurrentLevel: () => this.hitpoints,
        setCurrentLevel: (_skill, level) => { this.hitpoints = level; },
      };
    },
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (list) => hits.push(...list.map((hit) => hit.getDamage())) }) }),
  };
}

/** Runs the last submitted task, logging which tick each line came on. */
function runJump(player, ticks = 30) {
  const task = tasks.at(-1);
  task.setRunning?.(true);
  for (let tick = 1; tick <= ticks && task.isRunning?.() !== false; tick++) {
    const before = player.log.length;
    task.execute();
    for (let index = before; index < player.log.length; index++) player.log[index] = `+${tick} ${player.log[index]}`;
  }
}

function at(player, tick) {
  return player.log.filter((line) => line.startsWith(`+${tick} `)).map((line) => line.slice(`+${tick} `.length));
}

test("registers the cache names and options, saving the bed", () => {
  assert.equal(typeof hooks["Rubber cap mushroom"]["Jump on"], "function");
  assert.equal(typeof hooks["Mud pit"].Fill, "function");
  assert.equal(persisted[Mushroom._test.BED_ATTRIBUTE], 0);
  assert.equal(persisted[Mushroom._test.FILLED_ATTRIBUTE], false);
  assert.equal(Mushroom.members, true);
  assert.equal(hooks.canLogout, Mushroom._test.holdLogout);
  assert.equal(hooks.logout, Mushroom._test.landOnLogout);
});

test("Fill with fewer than 9 bittercaps refuses with the captured line and keeps them", () => {
  const player = createPlayer({ mushrooms: 8 });
  assert.equal(hooks["Mud pit"].Fill({ player }), true);
  assert.deepEqual(player.log, ["message You'll need 9 Bittercap mushrooms to fill the pit."]);
  assert.equal(player.mushrooms, 8);
  assert.equal(player.getAttribute(Mushroom._test.BED_ATTRIBUTE), undefined);
});

test("Fill with 9 bittercaps uses them, makes the bed and shows the object box", () => {
  const player = createPlayer({ mushrooms: 10 });
  hooks["Mud pit"].Fill({ player });
  assert.equal(player.mushrooms, 1);
  assert.equal(player.varbits[FILLED_VARBIT], 1);
  assert.equal(player.varbits[BED_VARBIT], 1);
  assert.equal(player.getAttribute(Mushroom._test.BED_ATTRIBUTE), 1);
  assert.ok(player.log.includes("anim 2292"));
  assert.ok(player.log.includes("sound 2432 0"));
  assert.equal(player.dialogues.length, 1);
});

test("Jump on with the bed made goes straight into the captured cushioned jump", () => {
  const player = createPlayer({ attributes: { [Mushroom._test.BED_ATTRIBUTE]: 1 } });
  assert.equal(hooks["Rubber cap mushroom"]["Jump on"]({ player }), true);
  assert.equal(player.prompt, undefined);
  runJump(player);
  assert.deepEqual(at(player, 1), ["moveTo 3665,3808,1"]);
  assert.deepEqual(at(player, 2), ["moveTo 3664,3810,1"]);
  assert.deepEqual(at(player, 5), ["gfx 1411", "anim 4365", "sound 1694 0"]);
  assert.deepEqual(at(player, 9), ["moveTo 3687,3756,1"]);
  assert.deepEqual(at(player, 11), [`varbit ${BED_VARBIT}=0`, "gfx 1410", "anim 4367", "sound 1695 0"]);
  assert.deepEqual(at(player, 20), ["moveTo 3685,3756,1"]);
  assert.deepEqual(at(player, 23), ["moveTo 3685,3756,0", "unlock"]);
  assert.deepEqual(player.hits, []);
  assert.equal(player.getAttribute(Mushroom._test.BED_ATTRIBUTE), 0);
});

test("Jump on with no bed warns first; declining stays put", () => {
  const player = createPlayer();
  const before = tasks.length;
  hooks["Rubber cap mushroom"]["Jump on"]({ player });
  const { title, pairs } = player.prompt;
  assert.equal(title, "That might damage you A LOT if you proceed.");
  assert.deepEqual(pairs.filter((entry) => typeof entry === "string"), ["I'll take the risk of the damage.", "I'd better not in that case."]);
  pairs[3]();
  assert.equal(tasks.length, before);
  assert.deepEqual(player.log, []);
});

test("taking the risk lands hard: no bed graphic, then Ow! and a 40-50 hit at the drop", () => {
  for (let run = 0; run < 20; run++) {
    const player = createPlayer();
    hooks["Rubber cap mushroom"]["Jump on"]({ player });
    player.prompt.pairs[1]();
    runJump(player);
    assert.deepEqual(at(player, 11), ["anim 4367", "sound 1695 0"]);
    assert.deepEqual(at(player, 23), ["moveTo 3685,3756,0", "say Ow!", "sound 519 20", "unlock"]);
    assert.equal(player.hits.length, 1);
    assert.ok(player.hits[0] >= 40 && player.hits[0] <= 50, `hit ${player.hits[0]}`);
  }
});

test("clicks mid-jump are ignored, and a logout stops the jump", () => {
  const player = createPlayer({ attributes: { [Mushroom._test.BED_ATTRIBUTE]: 1 } });
  hooks["Rubber cap mushroom"]["Jump on"]({ player });
  const count = tasks.length;
  assert.equal(hooks["Rubber cap mushroom"]["Jump on"]({ player }), true);
  assert.equal(hooks["Mud pit"].Fill({ player }), true);
  assert.equal(tasks.length, count);
  player.registered = false;
  runJump(player, 2);
  assert.ok(player.log.some((line) => line.endsWith("unlock")));
  assert.ok(!player.log.some((line) => line.includes("moveTo")));
});

test("leaving the world mid-air (tasks stopped first, as World does) still lands before the save", () => {
  const player = createPlayer();
  hooks["Rubber cap mushroom"]["Jump on"]({ player });
  player.prompt.pairs[1]();
  runJump(player, 3);
  assert.equal(player.getLocation().getZ(), 1);
  player.registered = false;
  tasks.at(-1).stop();
  Mushroom._test.landOnLogout({ player });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], [3685, 3756, 0]);
  assert.ok(player.hitpoints >= 49 && player.hitpoints <= 59, `hp ${player.hitpoints}`);
});

test("login restores the bed and the filled flag for the client's multiloc", () => {
  const player = createPlayer({ attributes: { [Mushroom._test.BED_ATTRIBUTE]: 1, [Mushroom._test.FILLED_ATTRIBUTE]: true } });
  login({ player });
  assert.equal(player.varbits[BED_VARBIT], 1);
  assert.equal(player.varbits[FILLED_VARBIT], 1);
  const fresh = createPlayer();
  login({ player: fresh });
  assert.deepEqual(fresh.varbits, {});
});

test("the Logout button is held during the jump, and not otherwise", () => {
  const player = createPlayer({ attributes: { [Mushroom._test.BED_ATTRIBUTE]: 1 } });
  const idle = { player, allow: null };
  Mushroom._test.holdLogout(idle);
  assert.equal(idle.allow, null);
  hooks["Rubber cap mushroom"]["Jump on"]({ player });
  const held = { player, allow: null };
  Mushroom._test.holdLogout(held);
  assert.equal(held.allow, false);
});

test("a dropped connection mid-air is saved on the ground, the bed used or the hit taken", () => {
  const cushioned = createPlayer({ attributes: { [Mushroom._test.BED_ATTRIBUTE]: 1 } });
  hooks["Rubber cap mushroom"]["Jump on"]({ player: cushioned });
  runJump(cushioned, 3);
  Mushroom._test.landOnLogout({ player: cushioned });
  assert.equal(cushioned.getLocation().getZ(), 0);
  assert.deepEqual([cushioned.getLocation().getX(), cushioned.getLocation().getY()], [3685, 3756]);
  assert.equal(cushioned.getAttribute(Mushroom._test.BED_ATTRIBUTE), 0);
  assert.equal(cushioned.hitpoints, 99);
  const free = { player: cushioned, allow: null };
  Mushroom._test.holdLogout(free);
  assert.equal(free.allow, null);

  const hard = createPlayer();
  hooks["Rubber cap mushroom"]["Jump on"]({ player: hard });
  hard.prompt.pairs[1]();
  runJump(hard, 15);
  Mushroom._test.landOnLogout({ player: hard });
  assert.equal(hard.getLocation().getZ(), 0);
  assert.ok(hard.hitpoints >= 49 && hard.hitpoints <= 59, `hp ${hard.hitpoints}`);

  const low = createPlayer();
  low.hitpoints = 20;
  hooks["Rubber cap mushroom"]["Jump on"]({ player: low });
  low.prompt.pairs[1]();
  runJump(low, 4);
  Mushroom._test.landOnLogout({ player: low });
  assert.equal(low.hitpoints, 1);
});

test("a logout after the drop changes nothing more", () => {
  const player = createPlayer();
  hooks["Rubber cap mushroom"]["Jump on"]({ player });
  player.prompt.pairs[1]();
  runJump(player);
  player.log.length = 0;
  Mushroom._test.landOnLogout({ player });
  assert.deepEqual(player.log, []);
  assert.equal(player.hitpoints, 99);
});
