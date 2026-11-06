// Run after `yarn build`: node --test tests/apothecary-f2p-load.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, test } = require("node:test");

const serverRoot = path.resolve(__dirname, "..");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");

before(async () => {
  await CachePipeline.initialize(serverRoot);
});

const APOTHECARY_SHOP_ID = 1423;
const STRENGTH_POTION_4 = 113;
const LIMPWURT_ROOT = 225;
const RED_SPIDERS_EGGS = 223;
const COINS = 995;
const STRENGTH_POTION_MADE_EVENT = "apothecary:strength-potion-made";

test("the ordinary Apothecary service loads and charges materials on a free world", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tsps-apothecary-f2p-"));
  const cwd = process.cwd();
  const worldModule = require.resolve("../dist/game/definition/WorldDefinition");
  const pluginManagerModule = require.resolve("../dist/plugins/PluginManager");
  try {
    fs.mkdirSync(path.join(directory, "data/definitions"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "data/definitions/world.json"),
      JSON.stringify({
        spawn: { x: 3222, y: 3219, z: 0 },
        zones: [{ minX: 3200, maxX: 3263, minY: 3200, maxY: 3263, z: 0, tags: ["f2p"] }],
        membersWorld: false,
      })
    );
    const plugins = path.join(directory, "plugins");
    fs.mkdirSync(plugins);
    fs.symlinkSync(path.join(serverRoot, "plugins/npcs/Apothecary.plugin.js"), path.join(plugins, "Apothecary.plugin.js"));

    process.chdir(directory);
    delete require.cache[worldModule];
    delete require.cache[pluginManagerModule];
    const world = require(worldModule);
    assert.equal(world.isMembersWorld(), false, "the test world is free-to-play");
    const { PluginManager } = require(pluginManagerModule);

    // Real PluginManager load: a members-tagged plugin is skipped before register().
    PluginManager.loadFromDirectory(plugins);

    const player = new Player(null);
    player.setRegistered(true);
    player.getSession = () => ({ sendClientPacket: () => true });
    player.sendMessage = () => true;
    const inventory = player.getInventory();
    inventory.add(new Item(LIMPWURT_ROOT, 1), false);
    inventory.add(new Item(RED_SPIDERS_EGGS, 1), false);
    inventory.add(new Item(COINS, 5), false);

    const price = { player, shopId: APOTHECARY_SHOP_ID, itemId: STRENGTH_POTION_4, price: 147 };
    PluginManager.emitCustomEvent("shop:buy-price", price);
    assert.equal(price.price, 5, "the F2P shop uses the Apothecary's 5-coin price");

    const limit = {
      player, shopId: APOTHECARY_SHOP_ID, itemId: STRENGTH_POTION_4,
      available: 2_000_000_000, limit: 2_000_000_000, message: null,
    };
    PluginManager.emitCustomEvent("shop:buy-limit", limit);
    assert.equal(limit.limit, 1, "the F2P purchase is capped by the one root and egg");

    const made = [];
    const observer = PluginManager.createApi("ApothecaryF2PTestObserver");
    observer.onCustomEvent(STRENGTH_POTION_MADE_EVENT, (event) => made.push(event));
    PluginManager.emitCustomEvent("shop:purchase", {
      player, shopId: APOTHECARY_SHOP_ID, itemId: STRENGTH_POTION_4, amount: 1,
    });
    assert.equal(inventory.getAmount(LIMPWURT_ROOT), 0, "the service consumes the limpwurt root");
    assert.equal(inventory.getAmount(RED_SPIDERS_EGGS), 0, "the service consumes the red spiders' eggs");
    assert.equal(made.length, 1, "a successful purchase emits the diary success event");
    assert.equal(made[0].player, player);
    assert.equal(made[0].amount, 1);
  } finally {
    process.chdir(cwd);
    delete require.cache[worldModule];
    delete require.cache[pluginManagerModule];
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
