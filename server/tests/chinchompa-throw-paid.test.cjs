// Run after `yarn build`: node --test tests/chinchompa-throw-paid.test.cjs
// A thrown chinchompa is paid as it leaves the hand (as worn ammo is, rsprox_transcripts/237/01156.txt). Paid on
// landing, a stack unwielded, banked, dropped or traded mid-flight made the throw free. Real engine: every plugin
// loaded, a real Player, the plugin's own ammo handler and the real TaskManager.
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
let consume;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  consume = require("../plugins/items/Chinchompas.plugin")._test.consumeChinchompa;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function thrower(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8947); p.setUsername("chin8947"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.RED_CHINCHOMPA_2, 100));
  return p;
}
const land = () => { for (let i = 0; i < 3; i++) core.TaskManager.process(); };

test("the throw is paid as it leaves the hand, so the stack moved mid-flight has already paid", (t) => {
  for (const move of ["unwield", "bank", "drop"]) {
    const p = thrower(t);
    assert.equal(consume(p, null, 1, 2), true);
    const worn = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
    assert.equal(worn.getAmount(), 99, `${move}: paid at the throw`);
    p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
    if (move === "unwield") p.getInventory().setItem(0, worn); // EquipPacketListener: the same object to the pack
    if (move === "bank") p.getBank(0).add(worn);
    land();
    const left = p.getInventory().getAmount(I.RED_CHINCHOMPA_2) + p.getBank(0).getAmount(I.RED_CHINCHOMPA_2);
    assert.equal(left, move === "drop" ? 0 : 99, `${move}: not paid a second time on landing, and not free`);
  }
});

test("the last chinchompa empties the weapon slot at the throw", (t) => {
  const p = thrower(t);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.RED_CHINCHOMPA_2, 1));
  consume(p, null, 1, 2);
  const slot = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  assert.equal(slot.getId(), -1);
  land();
  assert.ok(p.getInventory().getItems().every((item) => item.getAmount() >= 0), "no negative stack anywhere");
});

test("throws given back on top of a kept throw (ranged:ammo-saving extra) join the thrown stack", (t) => {
  const keep = (extra) => (event) => { event.saved = event.amount; event.extra = extra; };
  const p = thrower(t);
  const emit = PM.emitCustomEvent;
  t.mock.method(PM, "emitCustomEvent", (name, event) => (name === "ranged:ammo-saving" && event.player === p ? keep(2)(event) : emit.call(PM, name, event)));
  consume(p, null, 1, 2);
  land();
  assert.equal(p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getAmount(), 102, "kept, and two more");
});

/** One swing as Combat.attack runs it (start, hits, finished), the first hit forced accurate, in multicombat. */
function swing(t, p, target, bystander) {
  const method = core.CombatFactory.getMethod(p);
  const seen = [];
  const emit = PM.emitCombatHitDamage;
  t.mock.method(PM, "emitCombatHitDamage", (event) => {
    seen.push(p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId());
    return emit.call(PM, event);
  });
  t.mock.method(core.PendingHit.prototype, "isAccurate", () => true);
  t.mock.method(core.CombatFactory, "areaAttackSpreads", () => true);
  t.mock.method(core.CombatFactory, "canAttackSecondaryTarget", (_a, _t, candidate) => candidate === bystander);
  t.mock.method(p, "getLocalNpcs", () => new Map([[1, bystander]]));
  method.start(p, target);
  const hits = method.hits(p, target);
  method.finished(p, target);
  t.mock.restoreAll();
  return { hits, seen };
}

test("the last chinchompa is still in the hand while its throw is rolled, and gone right after", (t) => {
  const at = (x) => new core.Location(x, 3218, 0);
  const result = (amount) => {
    const p = thrower(t);
    p.setLocation(at(3222));
    p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.RED_CHINCHOMPA_2, amount));
    core.WeaponInterfaceManager.assign(p);
    const target = core.NPC.create(core.NpcIdentifiers.MAN, at(3227)); // 5 tiles
    const bystander = core.NPC.create(core.NpcIdentifiers.MAN, at(3228));
    return { p, ...swing(t, p, target, bystander) };
  };
  const two = result(2);
  const last = result(1);
  assert.ok(last.seen.length > 0 && last.seen.every((id) => id === I.RED_CHINCHOMPA_2), `rolled with the chinchompa in hand: ${last.seen}`);
  assert.equal(last.hits[0].getDelay(), two.hits[0].getDelay(), "the last throw lands as any other throw does");
  assert.equal(last.hits.length, 2, "and still blasts the bystander");
  assert.equal(last.p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId(), -1, "paid on the throw's tick");
  assert.equal(two.p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getAmount(), 1);
});
