// Run after `yarn build`: node --test tests/dragon-forge-shared-shard.test.cjs
// Seeded quest completion and owned forge placement exercise decoded inventory ingress,
// real item-on-object dispatch, inventory, skills and task phases. No travel or wire claim.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MAIN_PROFILE } = require("../dist/game/entity/impl/player/persistence/PlayerProfile");

let core, I, ds2, forgeId;
let nextIndex = 1500;
const errors = [];
const originalError = console.error, originalWarn = console.warn;
before(async () => {
  console.error = (...args) => { errors.push(args.map(String).join(" ")); originalError(...args); };
  console.warn = (...args) => {
    if (String(args[0]).includes("hook threw")) errors.push(args.map(String).join(" "));
    originalWarn(...args);
  };
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
  ds2 = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find(q => q.key === "dragon_slayer_ii");
  assert.ok(ds2);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  forgeId = core.CacheDefinitions.getLocId("ds2_ac_forge_anvil");
  assert.ok(Number.isInteger(forgeId));
  assert.equal(core.ObjectDefinition.forId(forgeId).getName(), "Anvil");
});
after(() => {
  try { PM.emitServerShutdown({}); assert.deepEqual(errors, []); }
  finally { console.error = originalError; console.warn = originalWarn; }
});

function turn(f) {
  f.p.resetUpdating();
  core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  core.TaskManager.process();
  f.c.processTurnPackets();
  const queue = f.p.getMovementQueue();
  queue.beginCycle();
  queue.processEntityPursuit();
  if (queue.hasPendingWork()) queue.process();
  core.TaskManager.processWalkTo(f.p.getIndex());
}

function actor(t, kind, { level = 90, completed = true, hammer = true, missing = null } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)), c = new ClientConnection(channel);
  c.player = p;
  p.getSession().setPlayer(p);
  p.getSession().setTurnPacketProcessor(() => c.processTurnPackets());
  p.setUsername("shard" + nextIndex++);
  p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(p), true);
  const index = p.getIndex();
  t.after(() => {
    try { PM.emitPlayerDisconnect({ player: p, username: p.getUsername() }); }
    finally {
      try { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); }
      finally {
        p.closeInterruptibleInterfaces();
        p.getMovementQueue().reset();
        p.getMovementQueue().walkToReset();
        core.TaskManager.cancelTasks(p);
        core.TaskManager.cancelTasks(index);
        core.World.getPlayers().remove(p);
      }
    }
    assert.equal(p.isRegistered(), false);
    assert.equal(core.TaskManager.hasActiveTask(p), false);
    assert.equal(core.TaskManager.hasActiveTask(index), false);
    assert.equal(p.getMovementQueue().hasPendingWork(), false);
  });
  p.moveTo(new core.Location(3222, 3218, 0));
  p.setNeedsPlacement(false);
  assert.equal(p.getProfile(), MAIN_PROFILE);
  assert.equal(p.getPrivateArea(), null);
  assert.ok(p.getHitpoints() > 0);
  assert.equal(p.busy(), false);
  const skills = p.getSkillManager();
  skills.setMaxLevels(core.Skill.SMITHING, level, false)
    .setExperiences(core.Skill.SMITHING, core.SkillManager.getExperienceForLevel(level), false)
    .setCurrentLevel(core.Skill.SMITHING, level, false);
  assert.equal(skills.getCurrentLevel(core.Skill.SMITHING), level);
  ds2.setStage(p, completed ? ds2.completionValue : 0);
  assert.equal(ds2.isComplete(p), completed);
  const parts = kind === "plate"
    ? [core.CacheDefinitions.getObjId("dragon_chainbody"), I.DRAGON_METAL_LUMP, I.DRAGON_METAL_SHARD]
    : [core.CacheDefinitions.getObjId("dragon_sq_shield"), I.DRAGON_METAL_SLICE, I.DRAGON_METAL_SHARD];
  const output = kind === "plate" ? I.DRAGON_PLATEBODY : I.DRAGON_KITESHIELD;
  const inv = p.getInventory();
  for (const id of [...parts.filter(id => id !== missing), ...(hammer ? [I.HAMMER] : [])]) {
    assert.ok(Number.isInteger(id));
    assert.equal(core.ItemDefinition.forId(id).isNoted(), false);
    inv.add(new core.Item(id, 1), false);
    assert.equal(inv.getAmount(id), 1);
  }
  assert.equal(inv.getAmount(output), 0);
  let location;
  for (let x = 3223; x <= 3227 && !location; x++) for (let y = 3216; y <= 3220 && !location; y++) {
    const candidate = new core.Location(x, y, 0);
    if (core.MapObjects.getObjectsAt(candidate, null).length === 0
        && core.ObjectManager.objectsAt(candidate).length === 0
        && !core.World.getRemovedObjects().some(o => o.getLocation().equals(candidate) && o.getType() === 10)) location = candidate;
  }
  assert.ok(location, "clear owned forge tile");
  const object = new core.GameObject(forgeId, location, 10, 0, null).setOwner(p);
  t.after(() => {
    core.ObjectManager.deregister(object, true);
    assert.equal(core.ObjectManager.objectsAt(location).includes(object), false);
    assert.equal(core.World.getObjects().includes(object), false);
    assert.equal(core.MapObjects.ownerObjectsInScene(p, location.getX(), location.getY(), 1).includes(object), false);
  });
  core.ObjectManager.register(object, true);
  assert.equal(core.MapObjects.getPrivateArea(p, forgeId, location), object);
  const hooks = PM.itemOnObjectHooks.filter(h => h.pluginName === "Smithing" && h.handlerName === "useItemOnObject");
  assert.equal(hooks.length, 1);
  const hook = hooks[0], original = hook.handler, seen = [];
  t.mock.method(hook, "handler", function(event) {
    const result = original.call(this, event);
    if (event.player === p && event.object === object) seen.push({ itemId: event.itemId, handled: event.handled });
    return result;
  });
  return { p, c, inv, parts, output, object, seen, beforeXp: skills.getExperience(core.Skill.SMITHING), xp: kind === "plate" ? 2000 : 1000 };
}

async function use(f, itemId) {
  const slot = f.inv.getSlotForItemId(itemId), loc = f.object.getLocation();
  assert.ok(slot >= 0);
  await f.c.dispatch([{ type: "inventory_use_on", slot, itemId, target: { kind: "loc", id: forgeId, x: loc.getX(), y: loc.getY() } }]);
  for (let n = 0; n < 40 && f.seen.length === 0; n++) turn(f);
  assert.deepEqual(f.seen, [{ itemId, handled: true }], "ordinary decoded use reaches the registered Smithing handler");
  assert.equal(f.p.getMovementQueue().hasPendingWork(), false);
  for (let n = 0; n < 6; n++) turn(f);
}

function made(f) {
  assert.equal(f.inv.getAmount(f.output), 1);
  for (const id of f.parts) assert.equal(f.inv.getAmount(id), 0);
  assert.equal(f.inv.getAmount(I.HAMMER), 1);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.SMITHING) - f.beforeXp, f.xp);
  for (let n = 0; n < 6; n++) turn(f);
  assert.equal(f.inv.getAmount(f.output), 1, "one use makes exactly one product");
}

test("a dragon metal lump makes the complete platebody recipe", async t => {
  const f = actor(t, "plate"); await use(f, I.DRAGON_METAL_LUMP); made(f);
});
test("a dragon metal slice makes the complete kiteshield recipe", async t => {
  const f = actor(t, "kite"); await use(f, I.DRAGON_METAL_SLICE); made(f);
});
test("a shared shard still makes a kiteshield when its materials are held", async t => {
  const f = actor(t, "kite"); await use(f, I.DRAGON_METAL_SHARD); made(f);
});
for (const [name, options] of [["no hammer", { hammer: false }], ["low level", { level: 89 }], ["unfinished Dragon Slayer II", { completed: false }]]) {
  test(`platebody forging preserves materials with ${name}`, async t => {
    const f = actor(t, "plate", options);
    await use(f, I.DRAGON_METAL_LUMP);
    assert.equal(f.inv.getAmount(f.output), 0);
    for (const id of f.parts) assert.equal(f.inv.getAmount(id), 1);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.SMITHING), f.beforeXp);
  });
}
test("a shared shard chooses the complete platebody recipe without kiteshield parts", async t => {
  const f = actor(t, "plate");
  assert.equal(f.inv.getAmount(I.DRAGON_SQ_SHIELD), 0);
  assert.equal(f.inv.getAmount(I.DRAGON_METAL_SLICE), 0);
  await use(f, I.DRAGON_METAL_SHARD);
  made(f);
});
