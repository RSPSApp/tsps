// Run after `yarn build`: node --test tests/stronghold-chest-room.test.cjs
//
// Each coin chest in the Stronghold of Security pays once (Wiki: "The rewards can only be obtained
// once"), so a reward that can't be paid must stay unclaimed. The Wiki says nothing about a full
// inventory: refusing is ours, and these tests hold conservation rather than the wording.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");

const HOME = [3222, 3218];
const CLAIMED = "sos.claimed";
const MAX_STACK = 2147483647;
const CHESTS = [
  { name: "Gift of Peace", option: "Open", coins: 2000, floor: 0 },
  { name: "Grain of Plenty", option: "Search", coins: 3000, floor: 1 },
  { name: "Box of Health", option: "Open", coins: 5000, floor: 2 },
];

let core;
let I;
let codec;
let next = 5200;
const objectIds = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
  const wanted = new Set(CHESTS.map((chest) => chest.name));
  for (let id = 0; id < 60000 && objectIds.size < wanted.size; id++) {
    let name = null;
    try { name = core.ObjectDefinition.forId(id)?.getName?.(); } catch { name = null; }
    if (wanted.has(name) && !objectIds.has(name)) objectIds.set(name, id);
  }
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("sosroom" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory() };
}

function reload(t, f) {
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const g = actor(t);
  codec.hydratePlayerSave(raw).applyToPlayer(g.p);
  g.p.setRegistered(true);
  g.p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  g.p.needsPlacement = false;
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false });
  return g;
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function fillTo(f, freeSlots) {
  while (f.inv.getFreeSlots() > freeSlots) f.inv.add(new core.Item(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), freeSlots);
}

function freeOne(f) {
  f.inv.setItem(f.inv.getItems().findIndex((held) => held?.getId() === I.RAKE), new core.Item(-1, 0));
  f.inv.refreshItems();
}

function coins(f) {
  const ground = ItemOnGroundManager.getGroundItem(f.p.getUsername(), I.COINS, f.p.getLocation(), f.p.getPrivateArea?.());
  return f.inv.getAmount(I.COINS) + (ground ? ground.getItem().getAmount() : 0);
}

const claimed = (f, chest) => (f.p.getAttribute(CLAIMED) ?? []).includes(chest.floor);

async function click(t, f, chest) {
  const id = objectIds.get(chest.name);
  assert.ok(Number.isInteger(id), `the cache has ${chest.name}`);
  const [x, y] = [HOME[0] + 1, HOME[1]];
  const object = new core.GameObject(id, new core.Location(x, y, 0), 10, 0, null);
  core.ObjectManager.register(object, true);
  t.after(() => core.ObjectManager.deregister(object, true));
  const actions = core.ObjectDefinition.forId(id).getActions?.() ?? [];
  const index = actions.findIndex((action) => action === chest.option);
  await send(f, { type: "object_option", id, x, y, clickType: index >= 0 ? index + 1 : 1, action: chest.option });
  ticks(f, 3);
}

async function resume(f) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  await send(f, { type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 });
  ticks(f, 1);
}

async function runOut(f) {
  for (let i = 0; i < 12 && f.p.getDialogueManager().getCurrent(); i++) await resume(f);
}

for (const chest of CHESTS) {
  test(`${chest.name}: one free slot pays once, and a full inventory keeps the reward for later`, async (t) => {
    const control = actor(t);
    fillTo(control, 1);
    await click(t, control, chest);
    await runOut(control);
    assert.equal(coins(control), chest.coins, "control: one free slot takes the coins");
    assert.equal(claimed(control, chest), true, "control: the floor is claimed");
    await click(t, control, chest);
    await runOut(control);
    assert.equal(coins(control), chest.coins, "control: opening again pays nothing");

    const f = actor(t);
    fillTo(f, 0);
    await click(t, f, chest);
    await runOut(f);
    assert.equal(coins(f), 0, "nothing can be paid");
    assert.equal(claimed(f, chest), false, "so the floor stays unclaimed");
    assert.equal(f.p.getDialogueManager().isActive(), false, "and the conversation has ended");
    freeOne(f);
    await click(t, f, chest);
    await runOut(f);
    assert.equal(coins(f), chest.coins, "with room, the reward is paid");
    assert.equal(claimed(f, chest), true, "and only now claimed");
    await click(t, f, chest);
    await runOut(f);
    assert.equal(coins(f), chest.coins, "and only once");
  });
}

test("the room is checked when the reward is taken, not when the chest is opened", async (t) => {
  const chest = CHESTS[0];
  const f = actor(t);
  fillTo(f, 1);
  await click(t, f, chest);
  assert.ok(f.p.getDialogueManager().getCurrent(), "control: the opening statement is showing");
  fillTo(f, 0);
  await runOut(f);
  assert.equal(coins(f), 0, "no room by the time of the reward");
  assert.equal(claimed(f, chest), false, "so the floor stays unclaimed");
});

test("a coin stack near the cap keeps the reward, and an exact fit pays it", async (t) => {
  const chest = CHESTS[0];
  const exact = actor(t);
  exact.inv.add(new core.Item(I.COINS, MAX_STACK - chest.coins), false);
  await click(t, exact, chest);
  await runOut(exact);
  assert.equal(exact.inv.getAmount(I.COINS), MAX_STACK, "control: an exact fit takes it all");
  assert.equal(claimed(exact, chest), true, "control: and claims the floor");

  const f = actor(t);
  f.inv.add(new core.Item(I.COINS, MAX_STACK - chest.coins + 1), false);
  await click(t, f, chest);
  await runOut(f);
  assert.equal(f.inv.getAmount(I.COINS), MAX_STACK - chest.coins + 1, "no partial payment");
  assert.equal(claimed(f, chest), false, "and the floor stays unclaimed");
});

test("Box of Health restores stats only with the reward", async (t) => {
  const chest = CHESTS[2];
  const drained = (f) => f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK);
  const start = (f) => {
    f.p.getSkillManager().setMaxLevels(core.Skill.ATTACK, 50, false).setCurrentLevels(core.Skill.ATTACK, 20, false);
  };
  const control = actor(t);
  start(control);
  await click(t, control, chest);
  await runOut(control);
  assert.equal(drained(control), 50, "control: the reward restores the stat");

  const f = actor(t);
  start(f);
  fillTo(f, 0);
  await click(t, f, chest);
  await runOut(f);
  assert.equal(drained(f), 20, "a refused reward restores nothing, or it could be had again and again");
});

test("a claimed floor and an unclaimed one both survive a real save and reload", async (t) => {
  const chest = CHESTS[0];
  const refused = actor(t);
  fillTo(refused, 0);
  await click(t, refused, chest);
  await runOut(refused);
  const g = reload(t, refused);
  assert.equal(claimed(g, chest), false, "the refused floor is still unclaimed");
  freeOne(g);
  await click(t, g, chest);
  await runOut(g);
  assert.equal(coins(g), chest.coins, "and pays after the reload");
  const h = reload(t, g);
  await click(t, h, chest);
  await runOut(h);
  assert.equal(coins(h), chest.coins, "once");
});
