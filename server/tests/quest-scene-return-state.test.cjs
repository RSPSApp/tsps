// Run after `yarn build`: node --test tests/quest-scene-return-state.test.cjs
//
// What a quest scene leaves behind (#2640). Real Player, PlayerSession and ClientConnection, the real plugins, the real map and real
// packets: the scene is started with inventory_use_on (a talk click if that starts nothing) and played with dialogue_continue
// packets, the tablet is broken with inventory_action and the door opened with object_option. Each tick runs in the order of
// World.process: tasks, the player's packets, area, movement, the session's flush. No client ran.
//
// Two scenes of the same area class, Romeo and Juliet's potion scene (a copied map of Juliet's house) and Goblin Diplomacy's
// dressing room, and for each:
// - every varp, varbit, client script, interface mount, camera, hidden/display-state, player-option, mode and minimap packet the
//   scene sent has an undo (the quest's own stage and journal varbits, sent in bulk, are progress and not counted);
// - no sub-interface the player did not have before the scene is still mounted (the fade overlay, interface 174 on 161:1);
// - the map is rebuilt for the way out, a Varrock teleport tablet works and a door click sends what it sent before the scene.
// Daddy’s Home additionally checks its isolated parlour, translated demo, bystander map and exit/recovery paths.
// A fade in that closes its overlay must not close something else mounted on 161:1 in the meantime (LocTeleports, ferries,
// minecarts and many more share it): the last test mounts another interface there right after the scene's fade in.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const OP = { LOC_ADD_CHANGE: 134, LOC_DEL: 135, REBUILD_NORMAL: 141, REBUILD_REGION: 140 };
const OVERLAY_UID = (161 << 16) | 1;
const FADE_GROUP = 174;
const OTHER_GROUP = 9999; // nothing opens this group, so no plugin reacts to its mount
const VARROCK_SQUARE = [3213, 3424];
const SCENES = {
  juliet: { start: [3158, 3426, 1], key: "romeo_and_juliet", stage: 50, npc: "JULIET", item: "CADAVA_POTION", at: [3157, 3426, 1] },
  goblin: { start: [2957, 3512, 0], key: "goblin_diplomacy", stage: 1, npc: "GENERAL_BENTNOZE", item: "ORANGE_GOBLIN_MAIL", at: [2958, 3512, 0] },
};

let core;
let I;
let next = 1700; // the player list gives each test player its index; this only seeds the name

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  assert.equal(core.WorldDefinition.isMembersWorld(), true, "native Watchtower fixture uses an actual members world");
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const scene of Object.values(SCENES)) core.RegionManager.loadMapFiles(scene.start[0], scene.start[1]);
  core.RegionManager.loadMapFiles(3240, 3395);
  core.RegionManager.loadMapFiles(...VARROCK_SQUARE);
  for (const at of [[2500, 3020], [2540, 3060], [2520, 9435], [2580, 9437], [2549, 3116], [2585, 3108]]) {
    core.RegionManager.loadMapFiles(...at);
  }
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, scene) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player); // without it flushClient returns at once and no map or loc packet is ever sent
  player.setUsername("scene" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  assert.notEqual(player.getLongUsername(), 0n, "native fixture has a real login identity");
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...scene.start));
  player.needsPlacement = false;
  // Object spawns and removals are sent through World.forEachNetworkPlayer; the list registers the player and gives it its index.
  assert.equal(core.World.getPlayers().add(player), true, "the test player joins the world list");
  const connection = new ClientConnection(channel);
  connection.player = player;
  const f = { t, player, connection, scene, packets: [], tick: 0 };
  const send = session.sendClientPacket.bind(session);
  t.mock.method(session, "sendClientPacket", (frame) => {
    f.packets.push({ tick: f.tick, op: frame[0], frame });
    return send(frame);
  });
  t.after(() => {
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  return f;
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };
const quest = (key) => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === key);

// #4412: real cache objects and ordinary packets; quest/inventory/NPC positions are
// seeded checkpoints. These tests do not run a client or a natural full quest.
const WATCHTOWER_WIZARD = { start: [2548, 3116, 2] };
const WATCHTOWER_GUARD = { start: [2506, 3035, 0] };
const xyz = player => { const p = player.getLocation(); return [p.getX(), p.getY(), p.getZ()]; };
const items = player => player.getInventory().getItems().map(i => [i.getId(), i.getAmount()]);
function watchtowerLocs(id) {
  const out = [];
  for (const objects of core.MapObjects.mapObjects.values()) for (const object of objects) {
    const p = object.getLocation();
    if (object.getId() === id && p.getX() >= 2450 && p.getX() <= 2650 &&
      ((p.getY() >= 2950 && p.getY() <= 3150) || (p.getY() >= 9380 && p.getY() <= 9480))) out.push(object);
  }
  return out;
}
async function operateWatchtowerLoc(f, object, expected) {
  const p = object.getLocation();
  const definition = core.ObjectDefinition.forId(object.getId());
  const actions = definition.getInteractions?.() ?? definition.getActions();
  assert.ok(actions[0], `cache object ${object.getId()} has its first operation`);
  observeWatchtowerInputs(f);
  let width = definition.getSizeX(), height = definition.getSizeY();
  if (object.getFace() & 1) [width, height] = [height, width];
  // Use the actual rotated footprint: +/-1 can be inside a 4x2 cave. Try only
  // outside perimeter tiles, stopping at the FIRST delivered ordinary operation.
  // An observed wrong result fails immediately, never retries until green.
  const perimeter = [];
  for (let x = 0; x < width; x++) perimeter.push([x, -1], [x, height]);
  for (let y = 0; y < height; y++) perimeter.push([-1, y], [width, y]);
  for (const [dx, dy] of perimeter) {
    f.player.moveTo(new core.Location(p.getX() + dx, p.getY() + dy, p.getZ()));
    ticks(f, 2);
    const before = f.watchtowerObjectOps.length;
    await f.connection.dispatch([{ type: "object_option", id: object.getId(), x: p.getX(), y: p.getY(), clickType: 1 }]);
    ticks(f, 12);
    if (f.watchtowerObjectOps.length > before) {
      assert.equal(f.watchtowerObjectOps.at(-1).id, object.getId(), "ordinary packet resolves the actual cache target");
      if (expected) assert.deepEqual(xyz(f.player), expected, `ordinary object ${object.getId()} reaches its supported destination`);
      return;
    }
  }
  assert.fail(`ordinary object was not operated: ${JSON.stringify({ id: object.getId(), at: [p.getX(), p.getY(), p.getZ()], width, height, actor: xyz(f.player), messages: f.watchtowerMessages.slice(-6) })}`);
}
function observeWatchtowerInputs(f) {
  if (f.watchtowerObjectOps) return;
  f.watchtowerObjectOps = [];
  f.watchtowerItemOps = [];
  f.watchtowerMessages = [];
  const send = f.player.sendMessage;
  f.t.mock.method(f.player, "sendMessage", function (message) {
    f.watchtowerMessages.push(String(message));
    return send.call(this, message);
  });
  const objectOp = PM.emitObjectInteraction;
  f.t.mock.method(PM, "emitObjectInteraction", function (event) {
    const result = objectOp.call(this, event);
    if (event.player === f.player) f.watchtowerObjectOps.push({ id: event.objectId, option: event.option, handled: event.handled });
    return result;
  });
  const itemOp = PM.emitItemOnNpc;
  f.t.mock.method(PM, "emitItemOnNpc", function (event) {
    const result = itemOp.call(this, event);
    if (event.player === f.player) f.watchtowerItemOps.push({ item: event.itemId, npc: event.npcId, handled: event.handled });
    return result;
  });
}
function watchtowerNpc(f, id, at) {
  const npc = core.NPC.create(id, new core.Location(...at));
  assert.equal(core.World.getNpcs().add(npc), true);
  f.t.after(() => core.World.getNpcs().remove(npc));
  return npc;
}
async function useOnNpc(f, itemId, npc) {
  const slot = f.player.getInventory().getSlotForItemId(itemId);
  assert.ok(slot >= 0, "ordinary item-on-NPC input has the supplied item");
  observeWatchtowerInputs(f);
  const before = f.watchtowerItemOps.length;
  await f.connection.dispatch([{ type: "inventory_use_on", itemId, slot, target: { kind: "npc", id: npc.getIndex() } }]);
  ticks(f, 6); // same bounded walk/turn allowance as this fixture's existing playScene
  assert.ok(f.watchtowerItemOps.length > before, `ordinary item-on-NPC was delivered: ${JSON.stringify({ itemId, npcId: npc.getId(), npcAt: xyz(npc), npcHp: npc.getHitpoints(), npcRegistered: npc.isRegistered(), playerAt: xyz(f.player), hp: f.player.getHitpoints(), canMove: f.player.getMovementQueue().getMobility().canMove(), messages: f.watchtowerMessages.slice(-6) })}`);
  assert.equal(f.watchtowerItemOps.at(-1).item, itemId);
  assert.equal(f.watchtowerItemOps.at(-1).npc, npc.getContentId(f.player), "ordinary input resolves the intended current NPC");
}
async function beginRelicScene(f) {
  quest("watchtower").setStage(f.player, 2);
  f.player.setAttribute("quest.watchtower.bits", (1 << 6) | (1 << 7));
  f.player.getInventory().add(new core.Item(I.RELIC_PART_3, 1), false);
  const npc = watchtowerNpc(f, core.NpcIdentifiers.WATCHTOWER_WIZARD, [2549, 3116, 2]);
  await useOnNpc(f, I.RELIC_PART_3, npc);
  await clickThrough(f, () => f.player.getArea() instanceof core.TemplatedInstanceArea, 40);
  assert.equal(f.player.getInventory().getAmount(I.RELIC_PART_3), 0, "third part was actually handed in through the ordinary input");
  assert.equal(f.player.getAttribute("quest.watchtower.bits") & (1 << 8), 1 << 8, "third hand-in bit is set before testing cinematic absence");
  return { area: f.player.getArea(), npc };
}
async function beginEnclaveScene(f) {
  quest("watchtower").setStage(f.player, 7);
  f.player.getInventory().add(new core.Item(I.CAVE_NIGHTSHADE, 2), false);
  const npc = watchtowerNpc(f, core.NpcIdentifiers.ENCLAVE_GUARD, [2507, 3036, 0]);
  await useOnNpc(f, I.CAVE_NIGHTSHADE, npc);
  await clickThrough(f, () => f.player.getArea() instanceof core.TemplatedInstanceArea, 50);
  assert.equal(f.player.getInventory().getAmount(I.CAVE_NIGHTSHADE), 1, "ordinary guard hand-in consumes exactly one nightshade before scene assertion");
  assert.equal(quest("watchtower").getStage(f.player), 8, "ordinary guard hand-in reaches stage 8 before scene assertion");
  return f.player.getArea();
}
function assertWatchtowerRestored(f) {
  assert.equal(f.player.getArea(), null);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.isUntargetable(), false);
  assert.equal(f.player.getPacketSender().getVarbit(542), 0);
  assert.equal(f.player.getPacketSender().getVarbit(6719), 0);
  assert.equal(f.player.getAttribute("watchtower:scene-exit"), null);
}

test("Watchtower: four mapless entries follow different surface caves without light, conserving items, XP and quest state", async t => {
  const f = actor(t, { start: [2524, 3070, 0] });
  quest("watchtower").setStage(f.player, 2);
  const inventory = items(f.player), xp = f.player.getSkillManager().getExperience(core.Skill.AGILITY);
  const messages = [], send = f.player.sendMessage.bind(f.player);
  t.mock.method(f.player, "sendMessage", message => { messages.push(message); return send(message); });
  for (const [id, destination] of [[2806, [2540, 3055, 0]], [2807, [2553, 3055, 0]], [2808, [2552, 3034, 0]], [2809, [2563, 3024, 0]]]) {
    const [object] = watchtowerLocs(id);
    assert.ok(object, `current map places fixed-route cave ${id}`);
    await operateWatchtowerLoc(f, object, null);
    assert.ok(messages.some(m => m.includes("without a map")), "mapless click reached the ordinary map guard");
    assert.deepEqual(xyz(f.player), destination, "the delivered mapless operation follows the fixed circuit");
  }
  assert.deepEqual(items(f.player), inventory);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.AGILITY), xp);
  assert.equal(quest("watchtower").getStage(f.player), 2);
});

test("Watchtower: a mapped cave still requires light and then reaches its skavid interior", async t => {
  const f = actor(t, { start: [2524, 3070, 0] });
  const [object] = watchtowerLocs(2806);
  assert.ok(object, "mapped cave exists in the active cache");
  f.player.getInventory().add(new core.Item(I.SKAVID_MAP, 1), false);
  f.player.getInventory().add(new core.Item(I.LIT_CANDLE, 1), false);
  await operateWatchtowerLoc(f, object, [2532, 9469, 0]);
  f.player.getInventory().deleteNumber(I.LIT_CANDLE, 1);
  const messages = [];
  const send = f.player.sendMessage.bind(f.player);
  t.mock.method(f.player, "sendMessage", message => { messages.push(message); return send(message); });
  await operateWatchtowerLoc(f, object, null);
  assert.ok(messages.some(m => m.includes("light source")), "mapped cave refuses with actionable light feedback");
  assert.ok(f.player.getLocation().getY() < 4000, "refusal cannot enter the interior");
  f.player.getInventory().add(new core.Item(I.LIT_CANDLE, 1), false);
  await operateWatchtowerLoc(f, object, [2532, 9469, 0]);
  assert.equal(f.player.getInventory().getAmount(I.SKAVID_MAP), 1);
  assert.equal(f.player.getInventory().getAmount(I.LIT_CANDLE), 1);
});

test("Watchtower: Toban's own ladder returns to the tunnel's outer entrance", async t => {
  const f = actor(t, { start: [2576, 3029, 0] });
  const [ladder] = watchtowerLocs(2812), [entrance] = watchtowerLocs(2811);
  assert.ok(ladder && entrance, "both distinct Toban tunnel ends exist in the current map");
  await operateWatchtowerLoc(f, ladder, [2500, 2988, 0]);
  await operateWatchtowerLoc(f, entrance, [2576, 3029, 0]);
});

test("Watchtower: every actionable Yanille hole and the enclave opening have working returns", async t => {
  const f = actor(t, { start: [2522, 9411, 0] });
  const holes = watchtowerLocs(2823), [opening] = watchtowerLocs(2813);
  assert.ok(holes.length > 0 && opening, "current map has the reported return objects");
  for (const hole of holes) await operateWatchtowerLoc(f, hole, [2585, 3108, 0]);
  await operateWatchtowerLoc(f, opening, [2540, 3054, 0]);
  const decorative = core.ObjectDefinition.forId(2824);
  assert.ok(!(decorative.getInteractions?.() ?? decorative.getActions()).some(Boolean), "surface hole is decorative, not an invented reverse operation");
});

test("Watchtower: third relic hand-in plays its private assembly before one completed relic is awarded", async t => {
  const f = actor(t, WATCHTOWER_WIZARD), bystander = actor(t, WATCHTOWER_WIZARD);
  ticks(f, 3); ticks(bystander, 3);
  recordSender(f);
  const { area } = await beginRelicScene(f);
  assert.ok(area instanceof core.TemplatedInstanceArea, "third hand-in starts the missing assembly cinematic");
  assert.equal(f.player.getInventory().getAmount(I.RELIC_PART_3), 0);
  assert.equal(f.player.getInventory().getAmount(I.OGRE_RELIC), 0, "relic is not awarded before assembly");
  assert.equal(quest("watchtower").getStage(f.player), 2);
  const wizard = area.entities.find(n => n.isNpc?.() && n.getId() === core.NpcIdentifiers.WATCHTOWER_WIZARD);
  assert.ok(wizard, "wizard is a private actor");
  assert.equal(wizard.getAnimation().id, 5352, "cache's relic assembly animation plays");
  assert.equal(wizard.getGraphic().getId(), 969, "cache's combining-parts effect plays");
  assert.equal(bystander.player.getPrivateArea(), null);
  assert.ok(!bystander.packets.some(p => p.op === OP.REBUILD_REGION));
  f.player.getPacketSender().sendInterfaceRemoval(); // closing the held box must not strand the scene
  ticks(f, 12);
  assertWatchtowerRestored(f);
  assert.equal(area.isDestroyed(), true);
  assert.equal(quest("watchtower").getStage(f.player), 3);
  assert.equal(f.player.getInventory().getAmount(I.OGRE_RELIC), 1);
  ticks(f, 12);
  assert.equal(f.player.getInventory().getAmount(I.OGRE_RELIC), 1, "completion cannot double-award");
  assert.ok(f.packets.some(p => p.op === OP.REBUILD_REGION));
  assert.ok(f.packets.some(p => p.op === OP.REBUILD_NORMAL));
});

for (const how of ["walkout", "logout"]) test(`Watchtower: interrupted relic assembly (${how}) retains parts and can resume without another hand-in`, async t => {
  const f = actor(t, WATCHTOWER_WIZARD);
  ticks(f, 3);
  const { area, npc } = await beginRelicScene(f);
  assert.ok(area instanceof core.TemplatedInstanceArea, "assembly began through item/dialogue input");
  if (how === "logout") f.player.onLogout();
  else { f.player.moveTo(area.tile(24, 3, 2)); ticks(f, 2); }
  ticks(f, 12);
  assert.equal(area.isDestroyed(), true);
  assert.equal(quest("watchtower").getStage(f.player), 2);
  assert.equal(f.player.getInventory().getAmount(I.OGRE_RELIC), 0);
  assert.equal(f.player.getAttribute("quest.watchtower.bits") & (7 << 6), 7 << 6);
  f.player.moveTo(new core.Location(...WATCHTOWER_WIZARD.start));
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
  ticks(f, 2);
  await clickThrough(f, () => f.player.getArea() instanceof core.TemplatedInstanceArea, 40);
  assert.ok(f.player.getArea() instanceof core.TemplatedInstanceArea, "ordinary Talk-to resumes stored parts");
  ticks(f, 12);
  assertWatchtowerRestored(f);
  assert.equal(f.player.getInventory().getAmount(I.OGRE_RELIC), 1);
});

test("Watchtower: nightshade entry plays private shaman/dragon actors without changing world actors or potion progress", async t => {
  const f = actor(t, WATCHTOWER_GUARD), bystander = actor(t, { start: [2582, 9437, 0] });
  ticks(f, 3); ticks(bystander, 3);
  const casts = [], deaths = [];
  const animate = core.NPC.prototype.performAnimation;
  t.mock.method(core.NPC.prototype, "performAnimation", function (animation) {
    if (this.getId() === core.NpcIdentifiers.OGRE_SHAMAN_5) casts.push(animation.id);
    if (this.getId() === core.NpcIdentifiers.BLUE_DRAGON_6) deaths.push(animation.id);
    return animate.call(this, animation);
  });
  const bits = 1 << 12;
  f.player.setAttribute("quest.watchtower.bits", bits);
  const worldDragon = watchtowerNpc(bystander, core.NpcIdentifiers.BLUE_DRAGON, [2592, 9431, 0]);
  const hp = worldDragon.getHitpoints();
  const area = await beginEnclaveScene(f);
  assert.ok(area instanceof core.TemplatedInstanceArea, "nightshade dialogue starts the missing entry cinematic");
  assert.equal(f.player.getInventory().getAmount(I.CAVE_NIGHTSHADE), 1, "entry consumes exactly one nightshade");
  const actors = area.entities.filter(n => n.isNpc?.());
  assert.ok(actors.some(n => n.getId() === core.NpcIdentifiers.OGRE_SHAMAN_5));
  assert.ok(actors.some(n => n.getId() === core.NpcIdentifiers.BLUE_DRAGON_6));
  ticks(f, 12);
  assert.ok(casts.includes(5357), "shaman performs the dedicated spellcast");
  assert.ok(deaths.includes(92), "private dragon plays its death");
  assertWatchtowerRestored(f);
  assert.deepEqual(xyz(f.player), [2588, 9410, 0]);
  assert.equal(quest("watchtower").getStage(f.player), 8);
  assert.equal(f.player.getAttribute("quest.watchtower.bits"), bits, "scene awards no shaman kills/crystals or potion progress");
  assert.equal(worldDragon.getHitpoints(), hp, "the world dragon is unharmed");
  assert.equal(bystander.player.getPrivateArea(), null);
  assert.ok(!bystander.packets.some(p => p.op === OP.REBUILD_REGION));
  assert.equal(f.player.getAttribute("watchtower:enclave-scene-seen"), true);
});

test("Watchtower: full-inventory assembly resume keeps progress pending until the relic is delivered", async t => {
  const f = actor(t, WATCHTOWER_WIZARD);
  ticks(f, 3);
  const { area, npc } = await beginRelicScene(f);
  assert.ok(area instanceof core.TemplatedInstanceArea);
  area.leave(f.player, true);
  f.player.moveTo(new core.Location(...WATCHTOWER_WIZARD.start));
  const inventory = f.player.getInventory();
  while (inventory.getFreeSlots() > 0) inventory.add(new core.Item(I.RAKE), false);
  assert.equal(inventory.getFreeSlots(), 0, "resumption starts with an actually full bag");
  const before = items(f.player);
  const resume = async () => {
    await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
    ticks(f, 2);
    await clickThrough(f, () => f.player.getArea() instanceof core.TemplatedInstanceArea, 40);
    assert.ok(f.player.getArea() instanceof core.TemplatedInstanceArea, "Talk-to resumes all retained parts");
    ticks(f, 12);
  };
  await resume();
  assert.equal(quest("watchtower").getStage(f.player), 2, "failed award cannot advance the quest");
  assert.equal(inventory.getAmount(I.OGRE_RELIC), 0);
  assert.deepEqual(items(f.player), before, "full-bag refusal preserves inventory");
  assert.equal(f.player.getAttribute("quest.watchtower.bits") & (7 << 6), 7 << 6);
  inventory.deleteNumber(I.RAKE, 1);
  assert.equal(inventory.getFreeSlots(), 1);
  await resume();
  assert.equal(quest("watchtower").getStage(f.player), 3);
  assert.equal(inventory.getAmount(I.OGRE_RELIC), 1);
  assert.equal(inventory.getAmount(I.RAKE), 27);
  ticks(f, 12);
  assert.equal(inventory.getAmount(I.OGRE_RELIC), 1);
});

test("Watchtower: early nightshade use is refused without consumption or a cinematic", async t => {
  const f = actor(t, WATCHTOWER_GUARD);
  quest("watchtower").setStage(f.player, 6);
  const npc = watchtowerNpc(f, core.NpcIdentifiers.ENCLAVE_GUARD, [2507, 3036, 0]);
  f.player.getInventory().add(new core.Item(I.CAVE_NIGHTSHADE, 1), false);
  const messages = [], send = f.player.sendMessage.bind(f.player);
  t.mock.method(f.player, "sendMessage", message => { messages.push(message); return send(message); });
  await useOnNpc(f, I.CAVE_NIGHTSHADE, npc);
  ticks(f, 6);
  assert.ok(messages.some(m => m.includes("deal with those skavids")), "valid ordinary target reaches the quest gate");
  assert.equal(f.player.getInventory().getAmount(I.CAVE_NIGHTSHADE), 1);
  assert.equal(quest("watchtower").getStage(f.player), 6);
  assert.ok(!(f.player.getArea() instanceof core.TemplatedInstanceArea));
});

test("Watchtower: an in-scene saved checkpoint recovers at the real enclave entrance", async t => {
  const f = actor(t, WATCHTOWER_GUARD);
  const area = await beginEnclaveScene(f);
  assert.ok(area instanceof core.TemplatedInstanceArea);
  const saved = { at: f.player.getLocation().clone(), exit: f.player.getAttribute("watchtower:scene-exit") };
  area.leave(f.player, true);
  const restored = actor(t, WATCHTOWER_GUARD);
  restored.player.setLocation(saved.at);
  restored.player.setAttribute("watchtower:scene-exit", saved.exit);
  quest("watchtower").setStage(restored.player, 8);
  PM.emitPlayerLogin({ player: restored.player, username: restored.player.getUsername() });
  ticks(restored, 4);
  assert.deepEqual(xyz(restored.player), [2588, 9410, 0]);
  assert.equal(restored.player.getAttribute("watchtower:scene-exit"), null);
  assert.equal(quest("watchtower").getStage(restored.player), 8);
  assert.notEqual(restored.player.getAttribute("watchtower:enclave-scene-seen"), true, "interrupted scene is not marked watched");
});

test("Watchtower: forced death cancels assembly and uses a real grave exit without granting the relic", async t => {
  const f = actor(t, WATCHTOWER_WIZARD);
  ticks(f, 3);
  const { area } = await beginRelicScene(f);
  assert.ok(area instanceof core.TemplatedInstanceArea);
  const request = { player: f.player, tile: { x: f.player.getLocation().getX(), y: f.player.getLocation().getY(), z: 2 } };
  PM.emitCustomEvent("gravestones:grave-location", request);
  assert.deepEqual(request.tile, { x: 2548, y: 3116, z: 2 });
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args.map(String).join(" ")));
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  f.player.setHitpoints(0);
  core.TaskManager.submit(new PlayerDeathTask(f.player));
  ticks(f, 12);
  assert.deepEqual(errors, []);
  assert.equal(area.isDestroyed(), true);
  assert.ok(f.player.getLocation().getX() < 8192);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.isUntargetable(), false);
  assert.equal(f.player.getInventory().getAmount(I.OGRE_RELIC), 0);
  assert.equal(quest("watchtower").getStage(f.player), 2);
  const returned = f.player.getLocation().clone();
  ticks(f, 12);
  assert.ok(f.player.getLocation().equals(returned), "cancelled scene cannot move the player or grant its item later");
});

// ---- tablet and door ------------------------------------------------------------------------------------------------

/** The Varrock teleport tablet, broken with a real inventory_action: whether the player left. */
async function breakTablet(f) {
  f.player.getInventory().add(new core.Item(I.VARROCK_TELEPORT, 1), false);
  const slot = f.player.getInventory().getSlotForItemId(I.VARROCK_TELEPORT);
  const start = f.player.getLocation().clone();
  await f.connection.dispatch([{ type: "inventory_action", slot, itemId: I.VARROCK_TELEPORT, widgetId: 3214, option: "Break" }]);
  ticks(f, 12);
  const end = f.player.getLocation();
  return Math.abs(end.getX() - start.getX()) + Math.abs(end.getY() - start.getY()) > 20;
}

/**
 * The ordinary doors (a wall loc with an Open option) of one kind, nearest first. A door stays open once clicked, so each use
 * needs its own, and a double door sends more packets than a single one, so only doors of the same id are compared.
 */
function doorsOfOneKind(around, level, radius = 20) {
  const byId = new Map();
  for (let x = around[0] - radius; x <= around[0] + radius; x++) {
    for (let y = around[1] - radius; y <= around[1] + radius; y++) {
      for (const object of core.MapObjects.getObjectsAt(new core.Location(x, y, level), null) ?? []) {
        const definition = core.ObjectDefinition.forId(object.getId());
        if (!/door|gate/i.test(definition?.getName?.() ?? "") || !(definition?.getActions?.() ?? []).includes("Open")) continue;
        const list = byId.get(object.getId()) ?? [];
        list.push({ object, x, y, level, distance: Math.abs(x - around[0]) + Math.abs(y - around[1]) });
        byId.set(object.getId(), list);
      }
    }
  }
  const kinds = [...byId.values()].filter((list) => list.length >= 2).sort((a, b) => Math.min(...a.map((d) => d.distance)) - Math.min(...b.map((d) => d.distance)));
  assert.ok(kinds.length, "two doors of one kind near " + around);
  return kinds[0].sort((a, b) => a.distance - b.distance);
}

/**
 * One door click as a real object_option, from the door's own tile and then its neighbours until one of them changes the door
 * (a wall door is used from either side; which side can reach it is not known here). What it sent: loc removals and additions.
 */
async function useDoor(f, door) {
  for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    f.player.moveTo(new core.Location(door.x + dx, door.y + dy, door.level));
    ticks(f, 3);
    const from = f.packets.length;
    await f.connection.dispatch([{ type: "object_option", id: door.object.getId(), x: door.x, y: door.y, clickType: 1 }]);
    ticks(f, 8);
    const sent = f.packets.slice(from);
    const removals = sent.filter((entry) => entry.op === OP.LOC_DEL).length;
    const additions = sent.filter((entry) => entry.op === OP.LOC_ADD_CHANGE).length;
    if (removals + additions > 0) return { removals, additions };
  }
  return { removals: 0, additions: 0 };
}

// ---- the undo ledger -------------------------------------------------------------------------------------------------
const LEDGER_METHODS = /^(sendVarbit|sendConfig|sendVarp|sendVarc|sendClientScript|sendInterfaceScript|sendSubInterface|mountSubInterface|closeSubInterface|closeInterface|closeCurrentChatbox|sendInterfaceRemoval|sendInterface|sendChatboxInterface|sendInterfaceDisplayState|sendInterfaceHidden|sendCamera\w*|sendPlayerOption|sendInteractionMode|sendResetInteractionMode|sendMinimap\w*|sendTab\w*|sendWalkable\w*|sendFlashingTab|sendWidgetHidden|\w*Hidden|\w*Lock\w*|\w*Mode\w*)$/;

/** Wraps the packet sender so every outer call of a state-changing method is written down with its arguments. */
function recordSender(f) {
  const sender = f.player.getPacketSender();
  f.ledger = { calls: [], before: null };
  let depth = 0;
  const proto = Object.getPrototypeOf(sender);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor" || typeof proto[name] !== "function" || !LEDGER_METHODS.test(name)) continue;
    const original = proto[name];
    sender[name] = function (...args) {
      if (depth === 0) {
        const entry = { tick: f.tick, name, args: args.map((arg) => (typeof arg === "object" && arg !== null ? "{" + Object.keys(arg).join(",") + "}" : arg)) };
        if (name === "sendVarbit") entry.was = sender.getVarbit(args[0]);
        if (name === "sendConfig" || name === "sendVarp") entry.was = sender.getVarp(args[0]);
        f.ledger.calls.push(entry);
      }
      depth++;
      try { return original.apply(this, args); } finally { depth--; }
    };
  }
  f.ledger.before = ledgerState(f);
}

function ledgerState(f) {
  const sender = f.player.getPacketSender();
  const state = { mounts: {}, chatbox: sender.getChatboxGroupId(), varbits: {}, varps: {} };
  for (const [group, mount] of sender.subInterfaceTargets) state.mounts[mount.targetUid] = group;
  for (const call of f.ledger?.calls ?? []) {
    if (call.name === "sendVarbit") state.varbits[call.args[0]] = sender.getVarbit(call.args[0]);
    if (call.name === "sendConfig" || call.name === "sendVarp") state.varps[call.args[0]] = sender.getVarp(call.args[0]);
  }
  return state;
}

/** Pairs what the scene sent with what undid it; what is left over. */
function unpaired(f) {
  const now = ledgerState(f);
  const before = f.ledger.before;
  const left = [];
  // A quest stage change re-sends a hundred varbits in one tick; they carry progress, not scene state.
  const perTick = {};
  for (const c of f.ledger.calls) if (c.was !== undefined) perTick[c.tick] = (perTick[c.tick] ?? 0) + 1;
  const bulk = new Set(Object.keys(perTick).filter((tickNumber) => perTick[tickNumber] >= 10).map(Number));
  const firstWas = {};
  for (const call of f.ledger.calls) {
    if (call.was === undefined || bulk.has(call.tick) || `${call.name}:${call.args[0]}` in firstWas) continue;
    firstWas[`${call.name}:${call.args[0]}`] = call.was;
  }
  for (const key of Object.keys(firstWas)) {
    const [name, id] = key.split(":");
    const kind = name === "sendVarbit" ? "varbits" : "varps";
    if (now[kind][id] !== firstWas[key]) left.push(`${kind.slice(0, -1)} ${id}: was ${firstWas[key]}, now ${now[kind][id]}`);
  }
  for (const uid of new Set([...Object.keys(before.mounts), ...Object.keys(now.mounts)])) {
    if (before.mounts[uid] !== now.mounts[uid]) left.push(`mount ${uid >>> 16}:${uid & 0xffff}: was group ${before.mounts[uid] ?? "none"}, now ${now.mounts[uid] ?? "none"}`);
  }
  if (before.chatbox !== now.chatbox) left.push(`chatbox group: was ${before.chatbox}, now ${now.chatbox}`);
  const camera = f.ledger.calls.filter((c) => /^sendCamera/.test(c.name));
  if (camera.length && !["sendCameraReset", "sendCameraUnlock"].includes(camera.at(-1).name)) left.push(`camera: last call is ${camera.at(-1).name}`);
  const toggles = {};
  for (const c of f.ledger.calls.filter((c) => /Hidden|DisplayState/.test(c.name))) (toggles[`${c.name}:${c.args[0]}`] ??= []).push(c.args.slice(1).join("/"));
  for (const [key, values] of Object.entries(toggles)) if (new Set(values).size === 1) left.push(`${key} only ever set to ${values[0]} (${values.length}x)`);
  return left;
}

// ---- playing a scene ---------------------------------------------------------------------------------------------------

/**
 * What a client does to keep a dialogue going: a Continue on the open chatbox, or the first option of a menu, as real
 * dialogue_continue packets; one world tick between clicks, until `done()`.
 */
async function clickThrough(f, done, limit = 600) {
  for (let i = 0; i < limit && !done(); i++) {
    const group = f.player.getPacketSender().getChatboxGroupId();
    if (MultiChatboxPrompt.getPending(f.player)) {
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: 1 }]);
    } else if (f.player.getDialogueManager().isActive() && group >= 0) {
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 }]);
    }
    tick(f);
  }
}

/** Runs a scene as a player does, from the item used on the NPC to the player being out again; the area it was in. */
async function playScene(f) {
  const scene = f.scene;
  quest(scene.key).setStage(f.player, scene.stage);
  f.player.getInventory().add(new core.Item(I[scene.item], 1), false);
  const npc = core.NPC.create(core.NpcIdentifiers[scene.npc], new core.Location(...scene.at));
  core.World.getNpcs().add(npc);
  f.t.after(() => core.World.getNpcs().remove(npc));
  const slot = f.player.getInventory().getSlotForItemId(I[scene.item]);
  await f.connection.dispatch([{ type: "inventory_use_on", itemId: I[scene.item], slot, target: { kind: "npc", id: npc.getIndex() } }]);
  ticks(f, 6);
  if (!f.player.getDialogueManager().isActive() && !f.player.getArea()) {
    await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
    ticks(f, 6);
  }
  let inside = null;
  await clickThrough(f, () => {
    inside ??= f.player.getArea();
    return inside !== null && f.player.getArea() === null;
  });
  ticks(f, 8);
  return inside;
}

for (const which of Object.keys(SCENES)) {
  test(`${which}: after the scene every packet it sent is undone, nothing stays mounted, and the map, tablet and door are as before`, async (t) => {
    const scene = SCENES[which];
    const f = actor(t, scene);
    ticks(f, 3);
    const [controlDoor, door] = doorsOfOneKind(scene.start, scene.start[2]);
    const failures = [];

    // The control: the same checks on the same player before any scene.
    assert.equal(await breakTablet(f), true, "control: the tablet works before the scene");
    const baseline = await useDoor(f, controlDoor);
    assert.ok(baseline.removals >= 1 && baseline.additions >= 1, "control: a door click removes the closed door and adds the open one: " + JSON.stringify(baseline));
    f.player.moveTo(new core.Location(...scene.start));
    ticks(f, 4);
    f.packets.length = 0;
    const mountedBefore = [...f.player.getPacketSender().subInterfaceTargets.keys()];

    recordSender(f);
    const inside = await playScene(f);
    assert.ok(inside, "the player was inside the scene's area at some point");
    for (const entry of unpaired(f)) failures.push("unpaired: " + entry);
    const extra = [...f.player.getPacketSender().subInterfaceTargets.keys()].filter((group) => !mountedBefore.includes(group));
    if (extra.length) failures.push(`the scene left sub-interfaces mounted: ${JSON.stringify(extra)} (a fade overlay stays on 161:1)`);
    const now = {
      area: f.player.getArea(), privateArea: f.player.getPrivateArea(), busy: f.player.busy(), movementBlocked: f.player.getMovementQueue().isMovementBlocked(),
      teleporting: f.player.isTeleportingReturn(), untargetable: f.player.isUntargetable(), dialogueActive: f.player.getDialogueManager().isActive(),
    };
    for (const [name, value] of Object.entries({ area: null, privateArea: null, busy: false, movementBlocked: false, teleporting: false, untargetable: false, dialogueActive: false })) {
      if (now[name] !== value) failures.push(`after the scene ${name} is ${now[name]}, expected ${value}`);
    }
    if (!f.packets.some((entry) => entry.op === OP.REBUILD_NORMAL)) failures.push("no normal map rebuild reached the session when the scene ended");

    if (!(await breakTablet(f))) failures.push("the teleport tablet did not work after the scene");
    f.player.moveTo(new core.Location(...scene.start));
    ticks(f, 4);
    const opened = await useDoor(f, door);
    if (opened.removals !== baseline.removals || opened.additions !== baseline.additions) {
      failures.push(`a door click sent ${JSON.stringify(opened)} after the scene, ${JSON.stringify(baseline)} before`);
    }
    assert.deepEqual(failures, [], `${which}: ${failures.join("; ")}`);
  });
}

test("goblin: a fade in that closes its own overlay leaves another interface mounted on 161:1 inside that window alone", async (t) => {
  const f = actor(t, SCENES.goblin);
  ticks(f, 3);
  const sender = f.player.getPacketSender();
  // Right after each fade in of the scene, another plugin mounts its own interface on the same slot (a ladder or transport
  // clicked the moment controls came back). The fade's own close must not take it down.
  const mount = sender.mountSubInterface;
  let others = 0;
  sender.mountSubInterface = function (uid, group, type, options) {
    const mounted = mount.call(this, uid, group, type, options);
    const args = options?.postScripts?.[0]?.args;
    if (group === FADE_GROUP && args && args[1] === 0 && args[3] === 255) {
      core.TaskManager.submit(new core.CountdownTask(f.player, 1, () => { others++; sender.sendSubInterface(uid, OTHER_GROUP, 1); }));
    }
    return mounted;
  };
  await playScene(f);
  assert.ok(others > 0, "the scene faded in at least once");
  assert.equal(sender.subInterfaceTargets.get(OTHER_GROUP)?.targetUid, OVERLAY_UID, "the other interface is still mounted on 161:1");
  assert.equal(sender.subInterfaceTargets.has(FADE_GROUP), false, "and the fade overlay is not");
});

test("shared quest fade-in closes only its own mount after the animation", (t) => {
  const f = actor(t, SCENES.juliet);
  const sender = f.player.getPacketSender();
  const scenes = require("../plugins/quests/QuestScenes").createQuestScenes({ core });
  const mounted = () => sender.getSubInterfaceAt(OVERLAY_UID);

  scenes.fade(f.player, false);
  assert.equal(mounted()?.groupId, FADE_GROUP, "fade-in is initially mounted");
  ticks(f, 2);
  assert.equal(mounted()?.groupId, FADE_GROUP, "fade remains during the animation");
  ticks(f, 1);
  assert.equal(mounted(), undefined, "completed fade-in closes");

  scenes.fade(f.player, false);
  sender.sendSubInterface(OVERLAY_UID, OTHER_GROUP, 1);
  ticks(f, 3);
  assert.equal(mounted()?.groupId, OTHER_GROUP, "replacement interface survives");

  scenes.fade(f.player, false);
  scenes.fade(f.player, true);
  const laterFade = mounted();
  ticks(f, 3);
  assert.equal(mounted(), laterFade, "later fade-out survives the old fade-in close");

  scenes.fade(f.player, false);
  scenes.closeFade(f.player);
  sender.sendSubInterface(OVERLAY_UID, OTHER_GROUP, 1);
  ticks(f, 3);
  assert.equal(mounted()?.groupId, OTHER_GROUP, "an explicit close makes the delayed token stale");
});


// #4491: checkpoint seed is after removal; Talk-to and Listen are real packets, with real tasks/map/session.
const YARLO_SCENE = { start: [3240, 3395, 0] };
async function listenToYarlo(f) {
  const q = quest("daddys_home");
  assert.ok(q, "Daddy's Home is registered");
  q.setStage(f.player, 3);
  f.player.setAttribute("daddys-home:furniture", Array(7).fill(2));
  const npc = core.NPC.create(core.NpcIdentifiers.OLD_MAN_YARLO, new core.Location(3240, 3395, 0));
  assert.equal(core.World.getNpcs().add(npc), true);
  f.t.after(() => core.World.getNpcs().remove(npc));
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
  ticks(f, 4);
  await clickThrough(f, () => f.player.getDialogueManager().getCurrent() instanceof core.OptionDialogue, 40);
  const menu = f.player.getDialogueManager().getCurrent();
  assert.ok(menu instanceof core.OptionDialogue, "ordinary Yarlo dialogue reaches the choice");
  assert.equal(menu.getOptions()[0], "Listen to Yarlo.");
  assert.equal(q.getStage(f.player), 3, "choice alone cannot advance the quest");
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex: 1 }]);
  ticks(f, 4);
  return f.player.getArea();
}

test("Yarlo: current-cache parlour geometry is available for an isolated demonstration", () => {
  const { getTemplateRegion, templateChunkKey } = require("../dist/game/collision/TemplateRegionData");
  const room = require("../plugins/skills/construction/data/rooms.json").find(room => room.key === "PARLOUR");
  const region = getTemplateRegion(((room.sourceChunkX >> 3) << 8) | (room.sourceChunkY >> 3));
  assert.ok(region, "current cache contains the construction template region");
  const locs = region.chunks[templateChunkKey(0, room.sourceChunkX, room.sourceChunkY)];
  assert.ok(locs.length > 0, "candidate chunk contains real cache locs");
  assert.ok(locs.some(loc => loc.id === 4517 && loc.localX === 4 && loc.localY === 59 && loc.type === 10 && loc.face === 2),
    "current parlour has the chair hotspot used by the demonstration");
});

test("Yarlo: Listen replaces the Varrock house map with an isolated room and returns safely", async (t) => {
  const f = actor(t, YARLO_SCENE);
  ticks(f, 3);
  t.after(() => { const area = f.player.getArea(); if (area) area.leave(f.player, true); });
  const bystander = actor(t, YARLO_SCENE);
  ticks(bystander, 3);
  const realObjects = () => {
    const locs = [];
    for (let x = 3235; x <= 3247; x++) for (let y = 3390; y <= 3400; y++) {
      for (const o of core.MapObjects.getObjectsAt(new core.Location(x, y, 0), null) ?? []) locs.push(`${x},${y}:${o.getId()}:${o.getType()}:${o.getFace()}`);
    }
    return locs.sort();
  };
  const houseBefore = realObjects();
  assert.ok(houseBefore.length > 0, "bystander starts in the real house map");
  f.player.getInventory().add(new core.Item(I.PLANK, 2), false);
  const inventoryBefore = f.player.getInventory().getItems().map(i => [i.getId(), i.getAmount()]);
  const xpBefore = f.player.getSkillManager().getExperience(core.Skill.CONSTRUCTION);
  recordSender(f);
  const area = await listenToYarlo(f);
  assert.ok(area, "Listen starts the lecture's private scene");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), true, "cinematic blocks movement");
  assert.equal(f.player.isUntargetable(), true, "cinematic protects its owner");
  assert.ok(area instanceof core.TemplatedInstanceArea,
    "Listen must rebuild a template map instead of drawing demonstration furniture over Yarlo's real Varrock house");
  assert.ok(f.player.getLocation().getX() >= 8192, "owner is moved to the allocated copy");
  const palette = area.buildScenePalette(f.player.getLocation().getX() >> 3, f.player.getLocation().getY() >> 3).palette.flat(2).filter(n => n !== -1);
  assert.ok(palette.length > 0, "client receives actual map chunks");
  for (const packed of palette) {
    const x = (packed >>> 14) & 1023, y = (packed >>> 3) & 2047;
    assert.ok(!(x >= 398 && x <= 410 && y >= 418 && y <= 430), "palette excludes the Varrock house and surrounding chunks");
  }
  const rebuild = f.packets.find(p => p.op === OP.REBUILD_REGION)?.frame;
  assert.ok(rebuild, "session sends an actual encoded instance rebuild");
  assert.deepEqual(decodeTemplateChunks(rebuild).sort((a, b) => a - b), palette.slice().sort((a, b) => a - b));
  assert.equal(palette.length, 4, "only the one-room chunk on each plane is copied");
  for (let z = 0; z < 4; z++) assert.deepEqual(area.getChunk(z, 0, 0), {
    sourceChunkX: 232, sourceChunkY: 887, sourcePlane: z, rotation: 0,
  });
  const template = area.getChunkObjects(0, 0, 0);
  for (const [id, x, y, type, face] of [[4517, 4, 3, 10, 2], [4521, 0, 1, 10, 0], [4523, 3, 7, 10, 1]]) {
    assert.ok(template.some(o => o.getId() === id && o.getLocation().getX() === area.getBaseX() + x &&
      o.getLocation().getY() === area.getBaseY() + y && o.getType() === type && o.getFace() === face), "cache hotspot geometry " + id);
  }
  const demo = area.getObjects();
  for (const [id, x, y, face] of [[6752, 4, 3, 2], [6768, 0, 1, 0], [6780, 3, 7, 1]]) {
    assert.ok(demo.some(o => o.getId() === id && o.getLocation().getX() === area.getBaseX() + x &&
      o.getLocation().getY() === area.getBaseY() + y && o.getType() === 10 && o.getFace() === face), "demonstration at matching hotspot " + id);
  }
  const builder = area.entities.find(n => n.isNpc?.() && n.getId() === core.NpcIdentifiers.OLD_MAN_YARLO_2);
  assert.ok(builder, "builder belongs to the private copy");
  assert.deepEqual([builder.getLocation().getX(), builder.getLocation().getY()], [area.getBaseX() + 5, area.getBaseY() + 5]);
  assert.deepEqual([builder.getPositionToFace().getX(), builder.getPositionToFace().getY()], [area.getBaseX() + 4, area.getBaseY() + 3]);
  const camera = f.ledger.calls.find(c => c.name === "sendCameraMoveTo");
  assert.deepEqual(camera?.args.slice(0, 2), [area.getBaseX() + 3, area.getBaseY() + 7], "camera follows translated room tiles");
  tick(bystander);
  assert.deepEqual(realObjects(), houseBefore, "owner's demonstration leaves the real house unchanged");
  assert.equal(bystander.player.getPrivateArea(), null);
  assert.ok(!bystander.packets.some(p => p.op === OP.REBUILD_REGION), "bystander stays on normal map");
  assert.equal(f.player.getInventory().getAmount(I.MARLOS_CRATE ?? 24940), 0, "lecture cannot award the quest reward");
  // Closing the held messagebox does not strand the cinematic; its timed completion still runs.
  f.player.getPacketSender().sendInterfaceRemoval();
  const beforeReturnFrames = f.packets.length;
  ticks(f, 160);
  await clickThrough(f, () => !f.player.getDialogueManager().isActive(), 80);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()], [3240, 3395, 0]);
  assert.equal(f.player.getArea(), null);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.isUntargetable(), false);
  assert.equal(quest("daddys_home").getStage(f.player), 5);
  assert.deepEqual(f.player.getAttribute("daddys-home:furniture"), Array(7).fill(2));
  assert.equal(f.player.getPacketSender().getVarbit(542), 0);
  assert.equal(f.player.getPacketSender().getVarbit(6719), 0);
  assert.ok(f.packets.slice(beforeReturnFrames).some(p => p.op === OP.REBUILD_NORMAL), "normal map is rebuilt on return");
  assert.equal(f.player.getAttribute("daddys-home:lecture-exit"), null);
  assert.deepEqual(f.player.getInventory().getItems().map(i => [i.getId(), i.getAmount()]), inventoryBefore, "lecture consumes no building supplies");
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.CONSTRUCTION), xpBefore, "lecture awards no building XP");
  assert.equal(area.isDestroyed(), true);
  assert.equal(f.player.getPacketSender().getSubInterfaceAt(OVERLAY_UID), undefined, "fade is closed");
});


/** Decode the client-bound REBUILD_REGION palette, independent of the area's internal chunk getters. */
function decodeTemplateChunks(frame) {
  assert.equal(frame.readUInt16BE(1), frame.length - 3);
  let bit = 80; // opcode/length + seven-byte rebuild header
  const read = count => {
    let n = 0;
    for (let i = 0; i < count; i++, bit++) { assert.ok(bit < frame.length * 8); n = n * 2 + ((frame[bit >> 3] >> (7 - (bit & 7))) & 1); }
    return n;
  };
  const chunks = [];
  for (let i = 0; i < 4 * 13 * 13; i++) if (read(1)) chunks.push(read(26));
  return chunks;
}

for (const how of ["walkout", "logout"]) {
  test(`Yarlo: ${how} destroys the copy, cancels lecture tasks and returns to a real exit`, async (t) => {
    const f = actor(t, YARLO_SCENE);
    ticks(f, 3);
    const area = await listenToYarlo(f);
    t.after(() => { if (!area.isDestroyed()) area.leave(f.player, true); });
    assert.ok(area instanceof core.TemplatedInstanceArea);
    assert.deepEqual(f.player.getAttribute("daddys-home:lecture-exit"), [3240, 3395, 0]);
    if (how === "logout") f.player.onLogout(); // actual production logout callback, with persistence disabled for fixture
    else {
      // Movement is normally blocked: forced boundary crossing exercises the area's ordinary leave caller.
      f.player.moveTo(area.tile(8, 3, 0));
      ticks(f, 2);
    }
    ticks(f, 160);
    assert.equal(area.isDestroyed(), true);
    assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()], [3240, 3395, 0]);
    assert.equal(f.player.getAttribute("daddys-home:lecture-exit"), null);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
    assert.equal(f.player.isUntargetable(), false);
    assert.equal(f.player.getPacketSender().getVarbit(542), 0);
    assert.equal(f.player.getPacketSender().getVarbit(6719), 0);
    assert.equal(f.player.getPacketSender().getSubInterfaceAt(OVERLAY_UID), undefined);
    assert.equal(quest("daddys_home").getStage(f.player), 5);
    assert.deepEqual(f.player.getAttribute("daddys-home:furniture"), Array(7).fill(2));
  });
}

test("Yarlo: a saved in-copy checkpoint recovers on login after the old scene is gone", async (t) => {
  const f = actor(t, YARLO_SCENE);
  ticks(f, 3);
  const area = await listenToYarlo(f);
  assert.ok(area instanceof core.TemplatedInstanceArea);
  const savedExit = [...f.player.getAttribute("daddys-home:lecture-exit")];
  const savedPosition = f.player.getLocation().clone();
  // Model the saved state at an abrupt stop. This is not a disk reload or a running-server restart.
  area.leave(f.player, true);
  const restored = actor(t, YARLO_SCENE);
  restored.player.setLocation(savedPosition);
  restored.player.setAttribute("daddys-home:lecture-exit", savedExit);
  restored.player.setAttribute("daddys-home:furniture", Array(7).fill(2));
  quest("daddys_home").setStage(restored.player, 3);
  PM.emitPlayerLogin({ player: restored.player, username: restored.player.getUsername() });
  ticks(restored, 4);
  assert.deepEqual([restored.player.getLocation().getX(), restored.player.getLocation().getY(), restored.player.getLocation().getZ()], [3240, 3395, 0]);
  assert.equal(restored.player.getAttribute("daddys-home:lecture-exit"), null);
  assert.deepEqual(restored.player.getAttribute("daddys-home:furniture"), Array(7).fill(2));
  assert.equal(restored.player.getMovementQueue().isMovementBlocked(), false);
});


test("Yarlo: a forced death uses the real grave exit and cannot leave lecture tasks or an off-map player", async (t) => {
  const f = actor(t, YARLO_SCENE);
  ticks(f, 3);
  const area = await listenToYarlo(f);
  assert.ok(area instanceof core.TemplatedInstanceArea);
  t.after(() => { if (!area.isDestroyed()) area.leave(f.player, true); });
  // The cinematic is untargetable. This forces the engine's actual death task to cover recovery,
  // rather than claiming a naturally reachable combat death during the lecture.
  const request = { player: f.player, tile: { x: f.player.getLocation().getX(), y: f.player.getLocation().getY(), z: 0 } };
  PM.emitCustomEvent("gravestones:grave-location", request);
  assert.deepEqual(request.tile, { x: 3240, y: 3395, z: 0 });
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args.map(String).join(" ")));
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  core.TaskManager.submit(new PlayerDeathTask(f.player));
  ticks(f, 12);
  assert.deepEqual(errors, [], "death must not fall through its exception recovery");
  assert.equal(area.isDestroyed(), true);
  assert.ok(f.player.getLocation().getX() < 8192, "death cannot strand the player at the instance allocation");
  assert.equal(f.player.getAttribute("daddys-home:lecture-exit"), null);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.isUntargetable(), false);
  assert.equal(quest("daddys_home").getStage(f.player), 5);
  const returned = f.player.getLocation().clone();
  ticks(f, 160);
  assert.ok(f.player.getLocation().equals(returned), "cancelled lecture cannot teleport the player later");
});
