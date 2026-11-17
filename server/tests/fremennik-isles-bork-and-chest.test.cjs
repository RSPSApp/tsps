// Run after `yarn build`: node --test tests/fremennik-isles-bork-and-chest.test.cjs
// The Fremennik Isles: Bork's three supplies each gave their items every time they were picked (his menu stays up until
// all three are claimed), so tuna and strength and prayer potions could be farmed; and the jester chest checked for
// one free slot but gives four pieces, with its flag set first, so missing pieces were lost and the quest blocked.
// Real engine: every plugin loaded, a real Player at the quest's own stages, its dialogue actions and chest handler.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let QuestRuntime;
let next = 9200;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  QuestRuntime = require("../plugins/quests/QuestRuntime");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, stage) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("isles" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => {
    if (core.World.getPlayers().get(p.getIndex()) === p) core.World.getPlayers().removes(p);
    else p.setRegistered(false);
  });
  QuestRuntime.questNamed("The Fremennik Isles").setStage(p, stage);
  return { p, inv: p.getInventory(), messages };
}

const action = (f, stepId) => PM.emitCustomEvent("npc-dialogue:action", { player: f.p, npcId: core.NpcIdentifiers.BORK_SIGMUNDSON, stepId, kind: "action" });

test("registered Bork Request-supplies uses the guarded dialogue and persistent once-only requests", async (t) => {
  const { World, NPC, Location, TaskManager, MultiChatboxPrompt: Multi } = core;
  const errors = [], originalError = console.error;
  t.mock.method(console, "error", (...args) => { errors.push(args.map(String).join(" ")); originalError(...args); });
  const { NPCOptionPacketListener } = require("../dist/net/packet/impl/NPCOptionPacketListener");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const f = actor(t, 18);
  f.p.setRegistered(false);
  assert.equal(World.getPlayers().add(f.p), true);
  f.p.setLocation(new Location(2399, 10276, 1)); f.p.needsPlacement = false;
  const npc = NPC.create(core.NpcIdentifiers.BORK_SIGMUNDSON, new Location(2400, 10276, 1));
  npc.setScriptedMovement(true);
  assert.equal(World.getNpcs().add(npc), true); npc.needsPlacement = false;
  t.after(() => {
    f.p.getPacketSender().sendInterfaceRemoval(); f.p.getDialogueManager().reset();
    TaskManager.cancelTasks(f.p); TaskManager.cancelTasks(f.p.getIndex());
    if (f.p.isRegistered()) World.getPlayers().removes(f.p);
    PM.removeNpc(npc);
    assert.notEqual(World.getPlayers().get(f.p.getIndex()), f.p);
    assert.notEqual(World.getNpcs().get(npc.getIndex()), npc);
    assert.equal(f.p.getDialogueManager().isActive(), false);
    assert.equal(Multi.getPending(f.p), null);
    assert.deepEqual(errors, [], "no caught engine or cleanup errors");
  });
  const connection = new ClientConnection({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  connection.player = f.p;
  const options = npc.getCurrentDefinition(f.p).getActions();
  assert.equal(options[2], "Request-supplies");
  const talk = options.findIndex((s) => s?.toLowerCase() === "talk-to") + 1;
  function open(option = 3) {
    f.p.getDialogueManager().reset(); f.p.getPacketSender().sendInterfaceRemoval();
    const movement = f.p.getMovementQueue(), original = movement.walkToEntity;
    let arrival;
    movement.walkToEntity = (_npc, callback) => { arrival = callback; return true; };
    try { new NPCOptionPacketListener().executeOption(f.p, npc.getIndex(), option); }
    finally { movement.walkToEntity = original; }
    assert.equal(typeof arrival, "function");
    arrival(); // Arrival adapter only: dispatch, dialogue, containers and save remain real.
  }
  async function resume(choice = 1) {
    const pending = Multi.getPending(f.p), group = f.p.getPacketSender().chatboxGroupId;
    await connection.dispatch([{ type: "dialogue_continue", widgetId: pending ? Multi.OPTIONS_WIDGET_ID : (group << 16) | 5,
      childIndex: pending ? choice : -1 }]);
    connection.processTurnPackets();
    for (let i = 0; i < 4; i++) TaskManager.process();
  }
  async function menu(option = 3) {
    open(option);
    assert.equal(f.p.getDialogueManager().isActive(), true, "registered option opens Bork dialogue");
    for (let i = 0; i < 12 && !Multi.getPending(f.p); i++) await resume();
    assert.ok(Multi.getPending(f.p), "supplies menu is reachable");
  }
  async function finish() {
    for (let i = 0; i < 20 && f.p.getDialogueManager().isActive(); i++) await resume();
  }
  await menu(); // Regression: option 3 previously fell through to Nothing interesting happens.
  assert.equal(f.inv.getAmount(I.TUNA), 0, "opening the shortcut never grants automatically");
  await menu(talk); // Existing Talk-to remains a working control.
  const quest = QuestRuntime.questNamed("The Fremennik Isles");
  for (const stage of [0, 17, 340]) {
    quest.setStage(f.p, stage); open();
    assert.equal(f.p.getDialogueManager().isActive(), false, `no supply dialogue at stage ${stage}`);
    assert.equal(f.inv.getAmount(I.TUNA), 0);
    assert.equal(Number(f.p.getAttribute("quest.the_fremennik_isles.bork")) || 0, 0);
  }
  quest.setStage(f.p, 18);
  t.mock.method(Math, "random", () => 0.99);
  f.inv.adds(I.LOGS, 24);
  await menu(); await resume(1);
  f.inv.adds(I.LOGS, 2); // Space changes after the selection but before the grant.
  await finish();
  assert.equal(f.inv.getAmount(I.TUNA), 2);
  assert.equal(f.p.getAttribute("quest.the_fremennik_isles.bork"), 1);
  f.inv.deleteNumber(I.LOGS, 26);
  await menu(); await resume(1); await finish();
  assert.equal(f.inv.getAmount(I.TUNA), 2, "freeing space cannot top up the first request");
  f.inv.adds(I.LOGS, 26);
  await menu(); await resume(3); await finish();
  assert.equal(f.inv.getAmount(I.PRAYER_POTION_3_), 0);
  assert.equal(f.p.getAttribute("quest.the_fremennik_isles.bork"), 5);
  f.inv.deleteNumber(I.LOGS, 26);
  await menu(); await resume(3); await finish();
  assert.equal(f.inv.getAmount(I.PRAYER_POTION_3_), 0, "zero-capacity request is also consumed");
  const restored = actor(t, 18);
  PlayerSave.fromPlayer(f.p).applyToPlayer(restored.p);
  assert.equal(restored.p.getAttribute("quest.the_fremennik_isles.bork"), 5);
  assert.equal(restored.inv.getAmount(I.TUNA), 2);
  assert.equal(restored.inv.getAmount(I.PRAYER_POTION_3_), 0);
  await menu(); await resume(2); await finish();
  assert.equal(f.inv.getAmount(I.STRENGTH_POTION_4_), 4, "strength remains independently available");
  assert.equal(f.p.getAttribute("quest.the_fremennik_isles.bork"), 7);
  open();
  assert.equal(f.p.getDialogueManager().isActive(), true, "all requests lead to the exhausted dialogue");
  assert.equal(Multi.getPending(f.p), null);
  assert.match(f.p.getDialogueManager().getCurrent().getText(), /^I've run out of supplies, .*Only our bravery remains\.$/);
  await finish();
  assert.equal(f.p.getAttribute("quest.the_fremennik_isles.bork"), 7);
});

test("each of Bork's supplies is given once", (t) => {
  t.mock.method(Math, "random", () => 0.99); // the top of each range
  const f = actor(t, 18);
  action(f, "1eVvoF");
  action(f, "1eVvoF");
  assert.equal(f.inv.getAmount(I.RAW_TUNA) + f.inv.getAmount(I.TUNA), 10, "ten tuna, not twenty");
  action(f, "eJNB7e");
  action(f, "eJNB7e");
  assert.equal(f.inv.getAmount(I.STRENGTH_POTION_4_), 4);
});

test("Bork's amounts are the Wiki's ranges: 8-10 tuna, 2-4 of each potion", (t) => {
  for (const [roll, tuna, potions] of [[0, 8, 2], [0.5, 9, 3], [0.99, 10, 4]]) {
    t.mock.method(Math, "random", () => roll);
    const f = actor(t, 18);
    action(f, "1eVvoF");
    action(f, "eJNB7e");
    action(f, "eCZJLI");
    assert.equal(f.inv.getAmount(I.TUNA), tuna, `tuna at roll ${roll}`);
    assert.equal(f.inv.getAmount(I.STRENGTH_POTION_4_), potions, `strength potions at roll ${roll}`);
    assert.equal(f.inv.getAmount(I.PRAYER_POTION_3_), potions, `prayer potions at roll ${roll}`);
    Math.random.mock.restore();
  }
});

test("Bork fills the remaining space once for each supply, without a later top-up", (t) => {
  t.mock.method(Math, "random", () => 0.99);
  for (const [step, id, bit] of [["1eVvoF", I.TUNA, 1], ["eJNB7e", I.STRENGTH_POTION_4_, 2], ["eCZJLI", I.PRAYER_POTION_3_, 4]]) {
    const f = actor(t, 18);
    f.inv.adds(I.LOGS, 25);
    action(f, step);
    assert.equal(f.inv.getAmount(id), 3, "all three available slots are filled");
    assert.equal(f.p.getAttribute("quest.the_fremennik_isles.bork"), bit);
    f.inv.deleteNumber(I.LOGS, 25);
    action(f, step);
    assert.equal(f.inv.getAmount(id), 3, "freeing room does not allow a second request");
  }
});

test("a request with no inventory space still uses that supply request", (t) => {
  const f = actor(t, 18);
  f.inv.adds(I.LOGS, 28);
  action(f, "eCZJLI");
  assert.equal(f.inv.getAmount(I.PRAYER_POTION_3_), 0);
  assert.equal(f.p.getAttribute("quest.the_fremennik_isles.bork"), 4);
  f.inv.deleteNumber(I.LOGS, 28);
  action(f, "eCZJLI");
  assert.equal(f.inv.getAmount(I.PRAYER_POTION_3_), 0, "the Wiki allows only one request, even when no items fit");
});

test("the jester chest needs room for all four pieces before it gives any", (t) => {
  const f = actor(t, 4);
  for (let slot = 0; slot < 26; slot++) f.inv.setItem(slot, new core.Item(I.LOGS, 1));
  const chest = { getId: () => JESTER_CHEST_ID(), getLocation: () => f.p.getLocation() };
  const open = () => PM.emitObjectInteraction({ player: f.p, object: chest, objectId: JESTER_CHEST_ID(), definition: { getActions: () => ["Open"], getInteractions: () => ["Open"], getName: () => "Chest" }, clickType: 1, location: f.p.getLocation(), handled: false });
  open();
  assert.equal(f.inv.getAmount(I.SILLY_JESTER_HAT), 0, "two free slots take nothing");
  for (let slot = 22; slot < 26; slot++) f.inv.setItem(slot, new core.Item(-1, 0));
  open();
  assert.deepEqual([I.SILLY_JESTER_HAT, I.SILLY_JESTER_TOP, I.SILLY_JESTER_TIGHTS, I.SILLY_JESTER_BOOTS].map((id) => f.inv.getAmount(id)), [1, 1, 1, 1]);
});

// The chest also replaces a lost costume: it gives whichever of the four pieces the player lacks (Wiki: "If the jester
// outfit is lost, a player can retrieve another one from the chest behind King Gjuki Sorvott IV's throne").
function jesterChest(f) {
  const chest = { getId: () => JESTER_CHEST_ID(), getLocation: () => f.p.getLocation() };
  return () => PM.emitObjectInteraction({ player: f.p, object: chest, objectId: JESTER_CHEST_ID(), definition: { getActions: () => ["Open"], getInteractions: () => ["Open"], getName: () => "Chest" }, clickType: 1, location: f.p.getLocation(), handled: false });
}
const jesterIds = () => [I.SILLY_JESTER_HAT, I.SILLY_JESTER_TOP, I.SILLY_JESTER_TIGHTS, I.SILLY_JESTER_BOOTS];
const jesterCounts = (f) => jesterIds().map((id) => f.inv.getAmount(id));

test("a reopened jester chest gives back only the lost piece", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  f.inv.delete(I.SILLY_JESTER_HAT, 1);
  open();
  assert.deepEqual(jesterCounts(f), [1, 1, 1, 1]);
  assert.equal(f.messages.at(-1), "You take the silly jester costume from the chest.");
});

test("a reopened jester chest gives all four after the whole costume is lost", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  for (const id of jesterIds()) f.inv.delete(id, 1);
  open();
  assert.deepEqual(jesterCounts(f), [1, 1, 1, 1]);
});

test("a jester chest gives nothing while the whole costume is held", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  open();
  assert.deepEqual(jesterCounts(f), [1, 1, 1, 1]);
  assert.equal(f.messages.at(-1), "You have already taken the jester costume.");
});

test("worn jester pieces count as owned", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  f.inv.delete(I.SILLY_JESTER_HAT, 1);
  f.p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.SILLY_JESTER_HAT, 1));
  open();
  assert.deepEqual(jesterCounts(f), [0, 1, 1, 1], "no second hat");
  assert.equal(f.messages.at(-1), "You have already taken the jester costume.");
});

test("a reopened jester chest needs a slot for every missing piece", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  f.inv.delete(I.SILLY_JESTER_TOP, 1);
  f.inv.delete(I.SILLY_JESTER_TIGHTS, 1);
  for (let slot = 0; slot < 28; slot++) if (!(f.inv.get(slot)?.getId?.() > 0)) f.inv.setItem(slot, new core.Item(I.LOGS, 1));
  f.inv.setItem(27, new core.Item(-1, 0));
  open();
  assert.deepEqual(jesterCounts(f), [1, 0, 0, 1], "one free slot takes neither missing piece");
  assert.equal(f.messages.at(-1), "You need some free inventory space to take the costume.");
  f.inv.setItem(26, new core.Item(-1, 0));
  open();
  assert.equal(f.inv.getAmount(I.SILLY_JESTER_TOP) + f.inv.getAmount(I.SILLY_JESTER_TIGHTS), 2);
});

function JESTER_CHEST_ID() {
  return core.ObjectIdentifiers.CHEST_70; // the plugin's JESTER_CHEST (21299)
}

test("a registered Neitiznot stump checks current Woodcutting before making a shield", async (t) => {
  const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
  const { World, Location, ObjectDefinition, MapObjects, RegionManager, Skill, NPC } = core;
  const players = [], npcs = [], errors = [], oldError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  t.after(() => {
    const cleanupErrors = [];
    const safely = (fn) => { try { fn(); } catch (error) { cleanupErrors.push(String(error)); } };
    try {
      for (const p of players) {
        const index = p.getIndex();
        safely(() => p.getPacketSender().sendInterfaceRemoval());
        safely(() => p.getDialogueManager().reset());
        safely(() => core.TaskManager.cancelTasks(p));
        safely(() => core.TaskManager.cancelTasks(index));
        safely(() => { if (p.isRegistered()) World.getPlayers().removes(p); });
        safely(() => assert.equal(p.isRegistered(), false));
        safely(() => assert.notEqual(World.getPlayers().get(index), p));
        safely(() => assert.equal(p.getDialogueManager().isActive(), false));
        safely(() => assert.equal(core.MultiChatboxPrompt.getPending(p), null));
      }
      for (const n of npcs) {
        const index = n.getIndex();
        safely(() => core.TaskManager.cancelTasks(n));
        safely(() => core.TaskManager.cancelTasks(index));
        safely(() => { if (n.isRegistered()) PM.removeNpc(n); });
        safely(() => assert.equal(n.isRegistered(), false));
        safely(() => assert.notEqual(World.getNpcs().get(index), n));
      }
    } finally { console.error = oldError; }
    assert.deepEqual(cleanupErrors, [], "owned actor cleanup completed");
    assert.deepEqual(errors, [], "no captured engine or cleanup errors");
  });
  RegionManager.init();
  // The checked-in Neitiznot bank rectangle is a region anchor, not a claim
  // about a stump tile. The actual active-map object is discovered below.
  RegionManager.loadMapFiles(2339, 3806);
  const objects = [...MapObjects.mapObjects.values()].flat().filter((o) => {
    const l = o.getLocation();
    return o.getId() === core.ObjectIdentifiers.WOODCUTTING_STUMP && l.getZ() === 0
      && l.getX() >= 2304 && l.getX() <= 2367 && l.getY() >= 3776 && l.getY() <= 3839;
  });
  assert.ok(objects.length > 0, "the active Neitiznot region contains a cache-backed stump");
  const stump = objects[0], loc = stump.getLocation(), definition = ObjectDefinition.forId(stump.getId());
  assert.equal(definition.getName(), "Woodcutting stump");
  const clickType = definition.getActions().findIndex((name) => name?.toLowerCase() === "cut-wood") + 1;
  assert.ok(clickType > 0, "the active cache exposes Cut-wood");
  const rotated = stump.getFace() % 2 !== 0;
  const width = rotated ? definition.getSizeY() : definition.getSizeX();
  const length = rotated ? definition.getSizeX() : definition.getSizeY();
  assert.ok(width > 0 && length > 0);
  const candidates = [];
  for (let x = 0; x < width; x++) candidates.push(new Location(loc.getX() + x, loc.getY() - 1, loc.getZ()), new Location(loc.getX() + x, loc.getY() + length, loc.getZ()));
  for (let y = 0; y < length; y++) candidates.push(new Location(loc.getX() - 1, loc.getY() + y, loc.getZ()), new Location(loc.getX() + width, loc.getY() + y, loc.getZ()));
  const passable = candidates.filter((tile) => !RegionManager.blocked(tile, null));
  assert.ok(passable.length, "the selected stump has an unblocked adjacent tile");
  const quest = QuestRuntime.questNamed("The Fremennik Isles"); assert.ok(quest);
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  const probe = new Player(new PlayerSession(channel()));
  const queue = probe.getMovementQueue();
  const spec = queue.buildObjectRouteSpec(stump, 0);
  const adjacent = passable.find((tile) => {
    probe.setLocation(tile.clone());
    return queue.reachesObject(stump, spec);
  });
  assert.ok(adjacent, "the selected adjacent tile reaches the stump using the real route predicate");
  let nextActor = 0;
  function nativeActor(stage, base, current) {
    const p = new Player(new PlayerSession(channel())); players.push(p);
    const name = `stump${nextActor++}`;
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name));
    p.setAttribute("bot-skip-persistence", true); p.setLocation(adjacent.clone());
    assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    const sm = p.getSkillManager();
    sm.setExperiences(Skill.WOODCUTTING, core.SkillManager.getExperienceForLevel(base), false);
    sm.setMaxLevel(Skill.WOODCUTTING, base); sm.setCurrentLevels(Skill.WOODCUTTING, Math.min(base, current));
    if (current > base) sm.increaseCurrentLevel(Skill.WOODCUTTING, current - base, current);
    quest.setStage(p, stage);
    assert.equal(quest.getStage(p), stage); assert.equal(sm.getMaxLevel(Skill.WOODCUTTING), base);
    assert.equal(sm.getCurrentLevel(Skill.WOODCUTTING), current);
    assert.equal(ObjectDefinition.forPlayer(stump.getId(), p)?.id, stump.getId());
    assert.equal(MapObjects.getPrivateArea(p, stump.getId(), loc), stump);
    return p;
  }
  function materials(p, withNail = true) {
    for (const [id, amount] of [[I.ARCTIC_PINE_LOGS, 2], [I.ROPE, 1], [I.HAMMER, 1], ...(withNail ? [[I.BRONZE_NAILS, 1]] : [])]) p.getInventory().add(new core.Item(id, amount), true);
  }
  function snapshot(p) {
    const sm = p.getSkillManager();
    return { inventory: p.getInventory().getItems().map((item) => [item.getId(), item.getAmount(), structuredClone(item.getMeta())]),
      stage: quest.getStage(p), wcBase: sm.getMaxLevel(Skill.WOODCUTTING), wcCurrent: sm.getCurrentLevel(Skill.WOODCUTTING),
      wcXp: sm.getExperience(Skill.WOODCUTTING), craftXp: sm.getExperience(Skill.CRAFTING), hp: p.getHitpoints() };
  }
  // Cut-wood opens the stump's skillmulti (Neitiznot shield, Arctic pine split log); the test picks `choice`.
  function useStump(p, choice = I.NEITIZNOT_SHIELD) {
    assert.equal(World.getPlayers().get(p.getIndex()), p, "registered actor identity");
    assert.equal(p.isRegistered(), true);
    assert.ok(p.getHitpoints() > 0);
    assert.notEqual(p.isDyingReturn(), true);
    assert.equal(p.getPrivateArea() ?? null, null);
    const movement = p.getMovementQueue();
    assert.equal(movement.reachesObject(stump, movement.buildObjectRouteSpec(stump, 0)), true, "actor reaches the actual stump");
    let queued; const original = movement.walkToObject;
    movement.walkToObject = (_object, action) => { queued = action; return true; };
    try { new ObjectActionPacketListener().executeAction(p, stump.getId(), loc.getX(), loc.getY(), clickType); }
    finally { movement.walkToObject = original; }
    assert.equal(typeof queued?.execute, "function", "the real object listener queued the action");
    queued.execute(); // Scoped walk adapter: no natural walking or timing claim.
    const menu = p.getCreationMenu();
    assert.deepEqual(menu?.getItems(), [I.NEITIZNOT_SHIELD, I.SPLIT_LOG], "Cut-wood opens the stump's menu");
    menu.execute(choice, 1);
    core.TaskManager.process();
    core.TaskManager.process();
  }
  const diaryTask = "craft-a-neitiznot-shield-on-neitiznot";
  const completionCounts = new Map(), emitCustomEvent = PM.emitCustomEvent;
  t.mock.method(PM, "emitCustomEvent", (name, payload) => {
    if (name === "diary:task-completed" && payload?.diary === "fremennik" && payload.task === diaryTask) {
      completionCounts.set(payload.player, (completionCounts.get(payload.player) ?? 0) + 1);
    }
    return emitCustomEvent.call(PM, name, payload);
  });
  function hasShieldTask(player) {
    const request = { player, diary: "fremennik", task: diaryTask, done: null };
    PM.emitCustomEvent("diary:has-task", request);
    assert.equal(typeof request.done, "boolean", "the registered diary query answered");
    return request.done;
  }
  function taskCount(player) {
    return (player.getAttribute("achievement-diaries:tasks")?.fremennik ?? [])
      .filter((key) => key === diaryTask).length;
  }
  // A fixture-placed registered Mawnis proves that an existing shield can
  // advance the quest independently of the shield-making level.
  const owner = nativeActor(17, 55, 55);
  owner.getInventory().add(new core.Item(I.NEITIZNOT_SHIELD, 1), true);
  const mawnis = NPC.create(core.NpcIdentifiers.MAWNIS_BUROWGAR, adjacent.clone()); npcs.push(mawnis);
  mawnis.setScriptedMovement(true); assert.equal(World.getNpcs().add(mawnis), true); mawnis.needsPlacement = false;
  const npcDefinition = mawnis.getCurrentDefinition(owner);
  assert.equal(npcDefinition.getName(), "Mawnis Burowgar");
  const talk = npcDefinition.getActions().findIndex((name) => name?.toLowerCase() === "talk-to") + 1;
  assert.ok(talk > 0);
  const nloc = mawnis.getLocation();
  assert.equal(PM.emitNpcInteraction({ player: owner, npc: mawnis, npcId: mawnis.getId(), npcIndex: mawnis.getIndex(),
    location: { x: nloc.getX(), y: nloc.getY(), z: nloc.getZ() }, definition: npcDefinition, clickType: talk, handled: false }), true);
  assert.equal(quest.getStage(owner), 18, "a carried shield permits existing continuation below 56");
  assert.equal(owner.getInventory().getAmount(I.NEITIZNOT_SHIELD), 1);
  const refused = nativeActor(17, 55, 55); materials(refused);
  assert.equal(hasShieldTask(refused), false);
  const before = snapshot(refused); useStump(refused);
  assert.equal(hasShieldTask(refused), false, "under-level attempt gives no diary task");
  assert.deepEqual(snapshot(refused), before, "under-level shield attempt keeps all materials, XP and stage");
  assert.equal(refused.getInventory().getAmount(I.SPLIT_LOG), 0, "refusal cannot fall through to log splitting");
  assert.equal(refused.getInventory().getAmount(I.NEITIZNOT_SHIELD), 0);
  const drained = nativeActor(17, 56, 55); materials(drained);
  assert.equal(hasShieldTask(drained), false);
  const drainedBefore = snapshot(drained); useStump(drained);
  assert.equal(hasShieldTask(drained), false);
  assert.deepEqual(snapshot(drained), drainedBefore, "current level, not an undrained base level, governs admission");
  for (const scenario of ["wrong stage", "missing nail", "already owned"]) {
    const p = nativeActor(scenario === "wrong stage" ? 16 : 17, 55, 55);
    materials(p, scenario !== "missing nail");
    if (scenario === "already owned") p.getInventory().add(new core.Item(I.NEITIZNOT_SHIELD, 1), true);
    const sm = p.getSkillManager(), xp = sm.getExperience(Skill.WOODCUTTING), craftXp = sm.getExperience(Skill.CRAFTING);
    const stage = quest.getStage(p), shield = p.getInventory().getAmount(I.NEITIZNOT_SHIELD);
    const rope = p.getInventory().getAmount(I.ROPE), nail = p.getInventory().getAmount(I.BRONZE_NAILS);
    assert.equal(hasShieldTask(p), false, scenario);
    useStump(p);
    assert.equal(hasShieldTask(p), false, scenario + " gives no shield diary credit");
    assert.equal(p.getInventory().getAmount(I.ARCTIC_PINE_LOGS), 2, scenario + ": the shield choice never splits the logs");
    assert.equal(p.getInventory().getAmount(I.SPLIT_LOG), 0, scenario);
    assert.equal(p.getInventory().getAmount(I.NEITIZNOT_SHIELD), shield, scenario);
    assert.equal(p.getInventory().getAmount(I.ROPE), rope, scenario);
    assert.equal(p.getInventory().getAmount(I.BRONZE_NAILS), nail, scenario);
    assert.equal(p.getInventory().getAmount(I.HAMMER), 1, scenario);
    assert.equal(quest.getStage(p), stage, scenario);
    assert.equal(sm.getExperience(Skill.WOODCUTTING), xp, scenario);
    assert.equal(sm.getExperience(Skill.CRAFTING), craftXp, scenario);
  }
  for (const [base, current] of [[56, 56], [55, 56]]) {
    const p = nativeActor(17, base, current); materials(p);
    assert.equal(hasShieldTask(p), false, "fresh actor has no shield task");
    const wcXp = p.getSkillManager().getExperience(Skill.WOODCUTTING); useStump(p);
    assert.equal(p.getInventory().getAmount(I.NEITIZNOT_SHIELD), 1);
    assert.equal(p.getInventory().getAmount(I.ARCTIC_PINE_LOGS), 0);
    assert.equal(p.getInventory().getAmount(I.ROPE), 0);
    assert.equal(p.getInventory().getAmount(I.BRONZE_NAILS), 0);
    assert.equal(p.getInventory().getAmount(I.HAMMER), 1);
    assert.equal(quest.getStage(p), 17);
    assert.equal(p.getSkillManager().getMaxLevel(Skill.WOODCUTTING), base);
    assert.equal(p.getSkillManager().getCurrentLevel(Skill.WOODCUTTING), current);
    assert.equal(p.getSkillManager().getExperience(Skill.WOODCUTTING), wcXp);
    assert.equal(hasShieldTask(p), true, "real shield crafting credits the diary");
    assert.equal(taskCount(p), 1, "the persisted task list contains one credit");
    assert.equal(completionCounts.get(p), 1, "the registered progress consumer emits one completion");
    const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
    const saved = PlayerSave.fromPlayer(p), restored = new Player(null);
    saved.applyToPlayer(restored);
    assert.equal(hasShieldTask(restored), true, "PlayerSave conversion preserves the credited task");
    assert.equal(taskCount(restored), 1);
    p.getInventory().deleteNumber(I.NEITIZNOT_SHIELD, 1);
    materials(p); useStump(p);
    assert.equal(p.getInventory().getAmount(I.NEITIZNOT_SHIELD), 1, "second craft succeeds");
    assert.equal(hasShieldTask(p), true);
    assert.equal(taskCount(p), 1, "repeat crafting cannot duplicate the task key");
    assert.equal(completionCounts.get(p), 1, "repeat crafting emits no second completion");
  }
});

test("a banked costume is owned: the jester chest gives no second set", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  for (const id of jesterIds()) {
    f.inv.delete(id, 1);
    f.p.getBank(0).add(new core.Item(id, 1), false);
  }
  open();
  assert.deepEqual(jesterCounts(f), [0, 0, 0, 0], "nothing from the chest");
  assert.equal(f.messages.at(-1), "You have already taken the jester costume.");
});
