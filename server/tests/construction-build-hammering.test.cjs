// Run after `yarn build`: node --test tests/construction-build-hammering.test.cjs
// The furniture build flow's hammering, as the rsprox captures of poh_furniture_creation show it:
// prayed pieces (guards, the oubliette floor) with no hammer sound, the dungeon's wall pieces,
// the nail loop's sounds, the materials box and the workbench's flatpacks.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, House, Data, Workbench;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  House = require("../plugins/skills/construction/House.Construction");
  Data = require("../plugins/skills/construction/Data.Construction");
  Workbench = require("../plugins/skills/construction/Workbench.Construction")._test;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const seq = (name) => core.CacheDefinitions.getSeqId(name);
let nextIndex = 9300;

function builder(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  const index = nextIndex++;
  p.setIndex(index); p.setUsername(`hammer${index}`); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  const log = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendSound", (id) => { log.push(["sound", id]); return sender; });
  t.mock.method(sender, "sendTypedMessage", (type, text) => { log.push(["spam", text]); return sender; });
  t.mock.method(p, "performAnimation", (animation) => log.push(["anim", animation.getId()]));
  for (const id of [core.ItemIdentifiers.HAMMER, core.ItemIdentifiers.SAW]) p.getInventory().add(new core.Item(id, 1), false);
  // A high level, so no level-up joins the build.
  p.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION, 99, false).setExperiences(core.Skill.CONSTRUCTION, 13034431, false).setCurrentLevel(core.Skill.CONSTRUCTION, 99, false);
  return { p, log, t };
}

/** Runs the world's tasks one tick at a time, returning what each tick sent. */
function ticks(f, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    f.log.length = 0;
    core.TaskManager.process();
    out.push([...f.log]);
  }
  return out;
}

test("guards and the oubliette's floor pieces are prayed into place, with no hammer sound", () => {
  const pray = seq("human_pray");
  const keys = ["SPIKES", "TENTACLE_POOL", "FLAME_PIT", "ROCNAR", "SKELETON_GUARD", "GUARD_DOG", "HOBGOBLIN", "BABY_RED_DRAGON",
    "HUGE_SPIDER", "TROLL_GUARD", "HELLHOUND", "DEMON", "KALPHITE_SOLDIER", "TOK_XIL", "DAGANNOTH", "STEEL_DRAGON", "RUNE_DRAGON"];
  for (const key of keys) {
    const buildable = Data.BUILDABLE_BY_KEY.get(key);
    assert.equal(buildable.buildAnimationId, pray, key);
    assert.equal(buildable.buildSound, false, key);
  }
  // Every piece bought with coins alone is one of them, or a throne room trap.
  const coinsOnly = [...Data.BUILDABLE_BY_KEY.values()].filter((b) => b.materials.length && b.materials.every((m) => m.itemId === core.ItemIdentifiers.COINS));
  for (const buildable of coinsOnly) assert.ok(keys.includes(buildable.key) || /_TRAP$|TANGLE_VINE/.test(buildable.key), buildable.key);
});

test("hammer() plays the animation, with the sound unless told not to", (t) => {
  const f = builder(t);
  House.hammer(f.p, seq("human_pray"), false);
  assert.deepEqual(f.log, [["anim", seq("human_pray")]]);
  f.log.length = 0;
  House.hammer(f.p);
  assert.deepEqual(f.log, [["anim", seq("human_poh_build")], ["sound", 938]]);
});

test("the dungeon's cages, lights and decorations are built with the wall animation", () => {
  const wall = seq("human_poh_build_wall");
  for (const key of ["OAK_CAGE", "OAK_AND_STEEL_CAGE", "STEEL_CAGE", "SPIKED_CAGE", "BONE_CAGE", "CANDLES", "TORCH", "SKULL_TORCH",
    "DECORATIVE_BLOOD", "DECORATIVE_PIPE", "HANGING_SKELETON"]) {
    const buildable = Data.BUILDABLE_BY_KEY.get(key);
    assert.equal(buildable.buildAnimationId, wall, key);
    assert.notEqual(buildable.buildSound, false, key);
  }
});

test("a flame pit uses up its twenty tinderboxes as a material", (t) => {
  const pit = Data.BUILDABLE_BY_KEY.get("FLAME_PIT");
  assert.deepEqual(pit.materials.map((m) => [m.itemId ?? m.source, m.amount]),
    [[core.ItemIdentifiers.TINDERBOX, 20], [core.ItemIdentifiers.COINS, 125000]]);
  const f = builder(t);
  f.p.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION, 99, false).setCurrentLevel(core.Skill.CONSTRUCTION, 99, false);
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 125000), false);
  const refused = House.getBuildMaterials(f.p, {}, null, pit);
  assert.match(refused.messageBox, /^You don't have the right materials:<br><col=ef1020>20 x Tinderbox<\/col>, [^<]*Coins$/);
});

test("the materials box breaks the line after the colon and keeps each amount with its name", (t) => {
  const f = builder(t);
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.PLANK, 2), false);
  const chair = Data.BUILDABLE_BY_KEY.get("CRUDE_WOODEN_CHAIR");
  assert.equal(House.getBuildMaterials(f.p, {}, null, chair).messageBox,
    "You don't have the right materials:<br>2 x Plank, <col=ef1020>2 x Nails</col>");
});

function nailedPiece(nails) {
  return { key: "TEST", buildAnimationId: seq("human_poh_build"), materials: [{ itemId: core.ItemIdentifiers.PLANK, amount: 1 }, { source: "NAILS", amount: nails }] };
}

test("each nail is hammered a tick apart, with the sound on every second nail and on the last", (t) => {
  for (const [nails, sounded] of [[2, [2]], [3, [2, 3]], [6, [2, 4, 6]]]) {
    const f = builder(t);
    f.p.getInventory().add(new core.Item(core.ItemIdentifiers.IRON_NAILS, nails), false);
    let completed = 0;
    House.hammerNails(f.p, nailedPiece(nails), { building: () => true, rest: () => new Map(), complete: () => completed++ });
    const sent = ticks(f, nails + 1);
    assert.deepEqual(sent.map((tick, i) => tick.some(([kind]) => kind === "sound") ? i + 1 : 0).filter(Boolean), sounded, `${nails} nails`);
    assert.ok(sent.slice(0, nails).every((tick) => tick.some(([kind, text]) => kind === "spam" && text === "You use a nail.")));
    assert.equal(completed, 1);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.IRON_NAILS), 0);
  }
});

// The player stays in the bench's house (houseFor) for the whole test; the materials are all carried.
function workbench(f, buildable) {
  if (!f.bench) {
    f.bench = { house: {}, limit: 99 };
    f.t.mock.method(House, "houseFor", () => f.bench.house);
    f.t.mock.method(House, "getBuildMaterials", (player, house, target, piece) =>
      new Map(piece.materials.filter((m) => m.itemId != null).map((m) => [m.itemId, m.amount])));
  }
  Workbench.makeFlatpack(f.p, f.bench, buildable);
}

test("a flatpack without nails: the stool animation and XP on the pick, the flatpack after 8 ticks", (t) => {
  const f = builder(t);
  const [key, flatpack] = [...Workbench.FLATPACK_OF.entries()].find(([k]) => House.nailsOf(Data.BUILDABLE_BY_KEY.get(k)) === 0);
  const buildable = Data.BUILDABLE_BY_KEY.get(key);
  for (const m of buildable.materials) f.p.getInventory().add(new core.Item(m.itemId, m.amount), false);
  const xp = f.p.getSkillManager().getExperience(core.Skill.CONSTRUCTION);
  workbench(f, buildable);
  assert.deepEqual(f.log, [["anim", seq("human_use_workbench_stool_2")]], "no hammer sound");
  assert.ok(f.p.getSkillManager().getExperience(core.Skill.CONSTRUCTION) > xp);
  assert.ok(buildable.materials.every((m) => f.p.getInventory().getAmount(m.itemId) === 0), "materials on the pick");
  ticks(f, Workbench.FLATPACK_TICKS - 1);
  assert.equal(f.p.getInventory().getAmount(flatpack), 0);
  ticks(f, 1);
  assert.equal(f.p.getInventory().getAmount(flatpack), 1);
});

test("a nailed flatpack hammers nail by nail, then the stool animation in place of the last nail's hammer", (t) => {
  const f = builder(t);
  const [key, flatpack] = [...Workbench.FLATPACK_OF.entries()].find(([k]) => House.nailsOf(Data.BUILDABLE_BY_KEY.get(k)) === 3);
  const buildable = Data.BUILDABLE_BY_KEY.get(key);
  for (const m of buildable.materials) if (m.itemId != null) f.p.getInventory().add(new core.Item(m.itemId, m.amount), false);
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.MITHRIL_NAILS, 3), false);
  const xp = f.p.getSkillManager().getExperience(core.Skill.CONSTRUCTION);
  workbench(f, buildable);
  assert.deepEqual(f.log, [["anim", seq("human_poh_build")], ["sound", 938]]);
  const sent = ticks(f, 3);
  assert.deepEqual(sent[0].filter(([kind]) => kind !== "spam"), [["anim", seq("human_poh_build")]]);
  assert.deepEqual(sent[1].filter(([kind]) => kind !== "spam"), [["anim", seq("human_poh_build")], ["sound", 938]]);
  assert.deepEqual(sent[2].filter(([kind]) => kind !== "spam"), [["anim", seq("human_use_workbench_stool_2")]], "the last nail: silent");
  assert.ok(f.p.getSkillManager().getExperience(core.Skill.CONSTRUCTION) > xp, "XP with the last nail");
  ticks(f, Workbench.FLATPACK_TICKS - 3 - 1);
  assert.equal(f.p.getInventory().getAmount(flatpack), 0);
  ticks(f, 1);
  assert.equal(f.p.getInventory().getAmount(flatpack), 1, "8 ticks after the pick");
});

test("a flatpack still on its way is handed over on logout, and cancelling the player's tasks doesn't lose it", (t) => {
  const f = builder(t);
  const [key, flatpack] = [...Workbench.FLATPACK_OF.entries()].find(([k]) => House.nailsOf(Data.BUILDABLE_BY_KEY.get(k)) === 0);
  const buildable = Data.BUILDABLE_BY_KEY.get(key);
  for (const m of buildable.materials) f.p.getInventory().add(new core.Item(m.itemId, m.amount * 2), false);
  workbench(f, buildable);
  workbench(f, buildable);
  core.TaskManager.cancelTasks(f.p);
  ticks(f, Workbench.FLATPACK_TICKS);
  assert.equal(f.p.getInventory().getAmount(flatpack), 2, "both, after a task cancel");
  for (const m of buildable.materials) f.p.getInventory().add(new core.Item(m.itemId, m.amount), false);
  workbench(f, buildable);
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.p.getInventory().getAmount(flatpack), 3, "handed over on logout");
  ticks(f, Workbench.FLATPACK_TICKS);
  assert.equal(f.p.getInventory().getAmount(flatpack), 3, "and only once");
});
