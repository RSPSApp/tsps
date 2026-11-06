// Run after `yarn build`: node --test tests/agility-mark-collection-log.test.cjs
// A Mark of Grace is credited only after the real ground-item transfer succeeds, for the amount
// actually taken.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");

const MARK = 11849;
const MARK_DESPAWN_TICKS = 1000;
const COURSE_TILE = [3098, 3281, 3];
let core;
let next = 2600;
let deny = false;
let reduceTo = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.RegionManager.init();
  require("../plugins/achievements/CollectionLog.plugin").register(PM.createApi("CollectionLog"));
  require("../plugins/skills/Agility.plugin").register(PM.createApi("Agility"));
  const policy = PM.createApi("MarkCollectionPolicy");
  policy.onCustomEvent("ground-items:take", (request) => {
    if (deny) request.allow = false;
    else if (reduceTo > 0) request.amount = Math.min(request.amount, reduceTo);
  });
});

function player() {
  const p = new Player(null);
  p.setIndex(next++);
  p.setUsername(`markclog${next}`);
  p.setRegistered(true);
  p.setLocation(new Location(...COURSE_TILE));
  p.getPacketSender = () => new Proxy({ sendItemContainer: () => {}, sendMessage: () => {} },
    { get: (target, key) => target[key] ?? (() => {}) });
  return p;
}

function place(p, amount, at = COURSE_TILE) {
  return ItemOnGroundManager.registerLocation(p, new Item(MARK, amount), new Location(...at), null,
    { goesGlobal: false, despawnDelay: MARK_DESPAWN_TICKS });
}

function credited(p) {
  return (p.getAttribute("clog.items") ?? {})[MARK] ?? 0;
}

test("a successful course-mark pickup is credited exactly once", () => {
  const p = player();
  const mark = place(p, 1);
  assert.equal(ItemOnGroundManager.transferToInventory(p, mark), 1);
  assert.equal(credited(p), 1);
  assert.equal(ItemOnGroundManager.transferToInventory(p, mark), 0, "the ground item is gone");
  assert.equal(credited(p), 1, "no second credit");
});

test("a denied pickup credits nothing", () => {
  const p = player();
  const mark = place(p, 1);
  deny = true;
  try {
    assert.equal(ItemOnGroundManager.transferToInventory(p, mark), 0);
    assert.equal(credited(p), 0);
  } finally {
    deny = false;
    ItemOnGroundManager.deregister(mark);
  }
});

test("a reduced pickup credits only the amount actually taken", () => {
  const p = player();
  const mark = place(p, 3);
  reduceTo = 1;
  try {
    assert.equal(ItemOnGroundManager.transferToInventory(p, mark), 1);
    assert.equal(credited(p), 1);
  } finally {
    reduceTo = 0;
  }
  assert.equal(ItemOnGroundManager.transferToInventory(p, mark), 2);
  assert.equal(credited(p), 3);
});

test("a stack-cap partial pickup credits the amount actually added", () => {
  const p = player();
  p.getInventory().add(new Item(MARK, 2_147_483_646), true);
  const mark = place(p, 3);
  assert.equal(ItemOnGroundManager.transferToInventory(p, mark), 1);
  assert.equal(p.getInventory().getAmount(MARK), 2_147_483_647);
  assert.equal(credited(p), 1);
});

test("a mark outside a course tile is not credited", () => {
  const p = player();
  p.setLocation(new Location(3000, 3000, 0));
  const mark = place(p, 1, [3000, 3000, 0]);
  assert.equal(ItemOnGroundManager.transferToInventory(p, mark), 1);
  assert.equal(credited(p), 0);
});
