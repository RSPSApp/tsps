const assert = require("node:assert/strict");
const { test } = require("node:test");

const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Diary = require("../plugins/achievements/diaries/ArdougneAleckHunterEmporiumDiary.plugin");
const shopData = require("../data/definitions/shops.json").find(({ id }) => id === 1007);

ItemDefinition.forId = (id) => ({
  getId: () => id,
  getName: () => `Item ${id}`,
  getValue: () => 1,
  getBloodMoneyValue: () => 0,
  getExamine: () => "",
  isStackable: () => false,
});

function player({ x = 2568, y = 3082, z = 0, privateArea = null, registered = true, hitpoints = 10 } = {}) {
  let status = PlayerStatus.NONE;
  let interfaceId = -1;
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit" ? () => sender : () => sender });
  return {
    getStatus: () => status,
    setStatus: (value) => { status = value; },
    getInterfaceId: () => interfaceId,
    setInterfaceId: (value) => { interfaceId = value; },
    getPacketSender: () => sender,
    getSession: () => ({ sendClientPacket: () => true }),
    getInventory: () => ({ getItems: () => [] }),
    getAttribute: () => 0,
    isPlayerBot: () => false,
    getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => z }),
    getPrivateArea: () => privateArea,
    isRegistered: () => registered,
    getHitpoints: () => hitpoints,
    isDyingReturn: () => false,
  };
}

test("Ardougne Easy Aleck task requires opening the public shop near Aleck", () => {
  ShopDefinition.replace([
    new ShopDefinition(shopData.id, shopData.name, shopData.currency, shopData.originalStock, 1, 1, 1, "core"),
    new ShopDefinition(1008, "Aleck's Hunter Emporium", "COINS", [], 1, 1, 1, "test"),
  ]);
  ShopManager.initialize();

  const api = PluginManager.createApi("ArdougneAleckHunterEmporiumDiaryTest");
  const progress = [];
  let denyOpen = false;
  api.onCustomEvent("diary:task", (event) => progress.push(event));
  api.onCanShop((event) => {
    if (denyOpen && event.shopId === 1007) event.allow = false;
  });
  Diary.register(api);

  const firstOpen = player();
  assert.equal(ShopManager.open(firstOpen, 1007), true);
  assert.equal(ShopManager.getOpenShop(firstOpen).name, "Aleck's Hunter Emporium.");
  assert.deepEqual(progress.map(({ player: owner, diary, task }) => [owner, diary, task]), [[
    firstOpen, "ardougne", "view-aleck-s-hunter-emporium-in-yanille",
  ]]);

  const secondOpen = player();
  assert.equal(ShopManager.open(secondOpen, 1007), true);
  assert.equal(progress.at(-1).player, secondOpen);

  const wrongShop = player();
  ShopManager.open(wrongShop, 1008);
  assert.equal(progress.some((event) => event.player === wrongShop), false);

  for (const [label, options] of [
    ["distant", { x: 2580, y: 3082 }],
    ["wrong plane", { z: 1 }],
    ["private instance", { privateArea: {} }],
    ["unregistered", { registered: false }],
    ["dead", { hitpoints: 0 }],
  ]) {
    const invalidLocation = player(options);
    ShopManager.open(invalidLocation, 1007);
    assert.equal(progress.some((event) => event.player === invalidLocation), false, `${label} does not count`);
  }

  denyOpen = true;
  const denied = player();
  assert.equal(ShopManager.open(denied, 1007), true, "the existing API reports a handled veto");
  assert.equal(ShopManager.getOpenShop(denied), null);
  assert.equal(progress.some((event) => event.player === denied), false);
});
