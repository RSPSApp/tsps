// Run after `yarn build`: node --test tests/sawmill.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PacketSender } = require("../dist/net/packet/PacketSender");
const { CreationMenu } = require("../dist/game/model/menu/CreationMenu");
const { TaskManager } = require("../dist/game/task/TaskManager");
const Sawmill = require("../plugins/npcs/Sawmill.plugin");
const { start, convert, useLogOnOperator, openPlankMenu, plankMaking, data, LAST_AMOUNT_ATTRIBUTE } = Sawmill._test;

const core = PluginManager.getCoreApi();
const events = [];
const api = { core, emitCustomEvent: (name, payload) => events.push({ name, ...payload }) };
const COINS = 995;
const MAHOGANY_LOGS = 6332;
const MAHOGANY_PLANK = 8782;
const VOUCHER = 28628;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  start(api);
});

beforeEach(() => {
  events.length = 0;
});

/** 28 slots; coins and vouchers stack, everything else takes a slot each. */
function createPlayer(slots) {
  const inventory = Array.from({ length: 28 }, (_, slot) => slots[slot] ?? null);
  const stacks = (id) => id === COINS || id === VOUCHER;
  const said = [];
  let menu = null;
  const attributes = new Map();
  const player = {
    said, inventory, attributes,
    menu: () => menu,
    isRegistered: () => true,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendCreationMenu: (value) => { menu = value; } }),
    getDialogueManager: () => ({ startDialogues: (builder) => said.push([...builder.getDialogues().values()][0].text ?? [...builder.getDialogues().values()][0].getText?.()) }),
    getInventory: () => ({
      contains: (id) => inventory.some((item) => item?.id === id),
      getAmount: (id) => inventory.filter((item) => item?.id === id).reduce((sum, item) => sum + item.amount, 0),
      getFreeSlots: () => inventory.filter((item) => !item).length,
      delete: (id, amount) => {
        let left = amount;
        for (let slot = 0; slot < 28 && left > 0; slot++) {
          const item = inventory[slot];
          if (item?.id !== id) continue;
          const take = Math.min(left, item.amount);
          item.amount -= take;
          left -= take;
          if (item.amount === 0) inventory[slot] = null;
        }
      },
      adds: (id, amount) => {
        const stack = stacks(id) && inventory.find((item) => item?.id === id);
        if (stack) stack.amount += amount;
        else inventory[inventory.indexOf(null)] = { id, amount };
      },
    }),
  };
  return player;
}

const mahogany = () => data().planks.find((plank) => plank.name === "Mahogany");
const logs = (count, from = 3) => Object.fromEntries(Array.from({ length: count }, (_, i) => [from + i, { id: MAHOGANY_LOGS, amount: 1 }]));
const ids = (player) => player.inventory.map((item) => item?.id ?? -1);

test("the data: every log and plank as the cache names it; every operator has Buy-plank", () => {
  for (const plank of data().planks) {
    assert.equal(CacheDefinitions.getItem(plank.log).name, plank.name === "Wood" ? "Logs" : `${plank.name} logs`);
    assert.equal(CacheDefinitions.getItem(plank.plank).name, plank.name === "Wood" ? "Plank" : `${plank.name} plank`);
  }
  assert.equal(CacheDefinitions.getItem(VOUCHER).name, "Sawmill voucher");
  for (const id of [3101, 9140, 14659]) {
    const npc = CacheDefinitions.getNpc(id);
    assert.ok(data().operators.includes(npc.name), npc.name);
    assert.equal(npc.actions[2], "Buy-plank");
  }
});

test("as captured: Buy-plank's menu - the priced labels, at most the logs carried, opening on the last amount, mode 0", () => {
  const player = createPlayer({ 1: { id: COINS, amount: 97440 }, ...logs(20) });
  openPlankMenu(player, 3101);
  const menu = player.menu();
  assert.equal(menu.getTitle(), "How many do you wish to make?");
  assert.deepEqual(menu.getOptions().labels, ["Wood - 100gp", "Oak - 250gp", "Teak - 500gp", "Mahogany - 1,500gp", "Camphor - 2,500gp", "Ironwood - 5,000gp", "Rosewood - 7,500gp"]);
  assert.deepEqual(menu.getItems(), [1511, 1521, 6333, 6332, 32904, 32907, 32910]);
  assert.deepEqual([menu.getOptions().maxAmount, menu.getOptions().lastAmount, menu.getOptions().mode], [20, 20, 0]);
  menu.execute(MAHOGANY_LOGS, 5);
  assert.equal(player.getAttribute(LAST_AMOUNT_ATTRIBUTE), 5);
  openPlankMenu(player, 3101);
  assert.deepEqual([player.menu().getOptions().maxAmount, player.menu().getOptions().lastAmount], [15, 5], "opens on the last amount");
});

test("core: the menu sends the captured 2046 arguments, after the last item's varp (the space key); menus without options are unchanged", () => {
  const scripts = [];
  const attributes = new Map();
  const sender = new Proxy({ player: { setCreationMenu() {}, getAttribute: (key) => attributes.get(key) } }, {
    get: (target, key) => (key in target ? target[key] : key === "sendInterfaceScript"
      ? (id, args) => { scripts.push([id, args]); return sender; }
      : key === "sendConfig" ? (id, value) => { scripts.push([`varp ${id}`, value]); return sender; }
      : () => sender),
  });
  attributes.set("creation-menu:last-item", 3);
  const send = (menu) => PacketSender.prototype.sendCreationMenu.call(sender, menu);
  send(new CreationMenu("How many do you wish to make?", [1511, 6332], { execute() {} }, { labels: ["Wood - 100gp", "Mahogany - 1,500gp"], maxAmount: 19, lastAmount: 5, mode: 0 }));
  const varp = scripts.findIndex(([id]) => id === "varp 2673");
  assert.deepEqual(scripts[varp], ["varp 2673", 3], "space picks the 4th item, the one chosen last");
  assert.ok(varp < scripts.findIndex(([id]) => id === 2046), "before the menu script reads it");
  attributes.clear();
  const [, args] = scripts.find(([id]) => id === 2046);
  assert.deepEqual([args[0], args[1], args[2], args[3], args[4], args.at(-1)], [0, "How many do you wish to make?|Wood - 100gp|Mahogany - 1,500gp", 19, 1511, 6332, 5]);
  scripts.length = 0;
  send(new CreationMenu("What would you like to make?", [1511], { execute() {} }));
  const [, plain] = scripts.find(([id]) => id === 2046);
  assert.deepEqual([plain[0], plain[1], plain[2], plain.at(-1)], [13, "What would you like to make?|Logs", 28, 28]);
});

test("as captured: plank by plank - the coins, a log, then the plank in the first free slot", () => {
  // The captured inventory: a ring, the coins, a necklace, then the logs.
  const player = createPlayer({ 0: { id: 11980, amount: 1 }, 1: { id: COINS, amount: 97440 }, 2: { id: 11111, amount: 1 }, ...logs(20) });
  assert.equal(convert(player, 3101, mahogany(), 5), 5);
  assert.equal(player.getInventory().getAmount(COINS), 97440 - 5 * 1500);
  assert.deepEqual(ids(player).slice(3, 9), [MAHOGANY_PLANK, MAHOGANY_PLANK, MAHOGANY_PLANK, MAHOGANY_PLANK, MAHOGANY_PLANK, MAHOGANY_LOGS], "each plank in its log's slot");
  assert.deepEqual(player.said, []);
});

test("as captured: coins for one of two - one plank (in the coins' slot), then the operator's line", () => {
  const player = createPlayer({ 0: { id: 11980, amount: 1 }, 1: { id: COINS, amount: 1500 }, 21: { id: MAHOGANY_LOGS, amount: 1 }, 22: { id: MAHOGANY_LOGS, amount: 1 } });
  assert.equal(convert(player, 3101, mahogany(), 2), 1);
  assert.equal(ids(player)[1], MAHOGANY_PLANK);
  assert.equal(ids(player)[21], -1);
  assert.deepEqual(player.said, ["Those planks cost 1500 coins. You don't have enough money for all of them."]);
});

test("as captured: no coins, nothing made; no logs, the other line", () => {
  const broke = createPlayer({ 21: { id: MAHOGANY_LOGS, amount: 1 }, 22: { id: MAHOGANY_LOGS, amount: 1 } });
  assert.equal(convert(broke, 3101, mahogany(), 2), 0);
  assert.deepEqual(broke.said, ["Those planks cost 1500 coins. You don't have enough money for all of them."]);
  const empty = createPlayer({ 1: { id: COINS, amount: 50000 } });
  assert.equal(convert(empty, 3101, mahogany(), 1), 0);
  assert.deepEqual(empty.said, ["You'll need to bring me some more logs."]);
});

test("as captured: a log used on the operator makes one plank on the spot, or gets the coins line", () => {
  const operator = { getId: () => 3101, getDefinition: () => ({ getName: () => "Sawmill operator" }) };
  const player = createPlayer({ 0: { id: 11980, amount: 1 }, 1: { id: COINS, amount: 100000 }, ...logs(3, 2) });
  const event = { player, target: operator, itemId: MAHOGANY_LOGS, handled: false };
  useLogOnOperator(event);
  assert.equal(event.handled, true);
  assert.equal(player.getInventory().getAmount(MAHOGANY_PLANK), 1, "one, not all three");
  assert.equal(ids(player)[2], MAHOGANY_PLANK, "in the first log's slot");
  assert.equal(player.getInventory().getAmount(COINS), 98500);

  const broke = createPlayer({ 4: { id: MAHOGANY_LOGS, amount: 1 } });
  useLogOnOperator({ player: broke, target: operator, itemId: MAHOGANY_LOGS, handled: false });
  assert.deepEqual(broke.said, ["Those planks cost 1500 coins. You don't have enough money for all of them."]);

  const other = { player, target: { getId: () => 1, getDefinition: () => ({ getName: () => "Banker" }) }, itemId: MAHOGANY_LOGS, handled: false };
  useLogOnOperator(other);
  assert.equal(other.handled, false);
});

test("vouchers (Wiki): two planks for one log's price; without room, one plank and the voucher kept", () => {
  const roomy = createPlayer({ 0: { id: VOUCHER, amount: 3 }, 1: { id: COINS, amount: 3000 }, 2: { id: MAHOGANY_LOGS, amount: 1 } });
  assert.equal(convert(roomy, 3101, mahogany(), 1), 2);
  assert.equal(roomy.getInventory().getAmount(MAHOGANY_PLANK), 2);
  assert.equal(roomy.getInventory().getAmount(VOUCHER), 2);
  assert.equal(roomy.getInventory().getAmount(COINS), 1500);

  const full = createPlayer({ 0: { id: VOUCHER, amount: 1 }, 1: { id: COINS, amount: 3000 }, ...logs(26, 2) });
  convert(full, 3101, mahogany(), 1);
  assert.equal(full.getInventory().getAmount(MAHOGANY_PLANK), 1);
  assert.equal(full.getInventory().getAmount(VOUCHER), 1, "no room for the second plank");
});

test("Talk-to's Plank-making action opens the menu after the conversation closes", () => {
  const player = createPlayer({ 1: { id: COINS, amount: 1000 }, 3: { id: 1511, amount: 1 } });
  const event = { player, npc: { getId: () => 3101, getDefinition: () => ({ getName: () => "Sawmill operator" }) }, action: "open_interface", target: "Plank-making", handled: false };
  plankMaking(event);
  assert.deepEqual([event.handled, event.end], [true, true]);
  assert.equal(player.menu(), null);
  TaskManager.process();
  TaskManager.process();
  assert.equal(player.menu().getOptions().maxAmount, 1);
});

test("Varrock diary: a normal plank, and 20 mahogany planks in one go", () => {
  const wood = createPlayer({ 1: { id: COINS, amount: 1000 }, 3: { id: 1511, amount: 1 } });
  convert(wood, 3101, data().planks[0], 1);
  const lots = createPlayer({ 1: { id: COINS, amount: 50000 }, ...logs(20) });
  convert(lots, 3101, mahogany(), 20);
  const few = createPlayer({ 1: { id: COINS, amount: 50000 }, ...logs(19) });
  convert(few, 3101, mahogany(), 19);
  assert.deepEqual(events.map((event) => event.task), ["make-a-normal-plank-at-the-sawmill", "make-20-mahogany-planks-in-one-go"]);
});
