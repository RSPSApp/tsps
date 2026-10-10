// Run after `yarn build`: node --test tests/port-tasks.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

const hooks = { objects: {}, npcs: {}, items: {}, clicks: [], login: [], custom: {} };
let common;
let board;
let ledger;
let master;

before(async () => {
  await CachePipeline.initialize();
  const core = { ...PluginManager.getCoreApi(), WeaponInterfaceManager: { assign() {} } };
  const api = {
    core,
    persistAttribute() {},
    onPlayerLogin: (handler) => hooks.login.push(handler),
    onObjectInteraction: (name, actions) => { hooks.objects[name] = { ...hooks.objects[name], ...actions }; },
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onItemAction: (name, actions) => { hooks.items[name] = actions; },
    onInterfaceActionClick: (handler) => hooks.clicks.push(handler),
    onCustomEvent: (name, handler) => { hooks.custom[name] = handler; },
    sendMultiChatboxPrompt: (player, title, ...pairs) => { hooks.prompt = { title, pairs }; },
  };
  require("../plugins/skills/sailing/PortTasks.plugin").register(api);
  common = require("../plugins/skills/sailing/porttasks/Common.PortTasks");
  board = require("../plugins/skills/sailing/porttasks/Board.PortTasks");
  ledger = require("../plugins/skills/sailing/porttasks/Ledger.PortTasks");
  master = require("../plugins/skills/sailing/porttasks/PortMaster.PortTasks");
});

const PANDEMONIUM_BOARD = { id: 60288, x: 3058, y: 2985 };
const PANDEMONIUM_LEDGER = { x: 3061, y: 2985, z: 0 };
const PORT_SARIM_LEDGER = { x: 3028, y: 3194, z: 0 };
const JEWELLERY_TASK = 20; // Port Sarim jewellery delivery: the Pandemonium to Port Sarim, 78 XP

function createPlayer(level = 99) {
  const attributes = new Map();
  const log = [];
  const equipment = Array.from({ length: 14 }, () => null);
  const inventory = [];
  const { Item } = PluginManager.getCoreApi();
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => {
      if (key === "sendVarbit" || key === "sendConfig") log.push(`${key} ${args[0]}=${args[1]}`);
      if (key === "sendInterfaceScript") log.push(`script ${args[0]} ${JSON.stringify(args[1])}`);
      if (key === "sendSubInterface") log.push(`open ${args[1]}`);
      if (key === "closeSubInterface") log.push(`close ${args[0]}`);
      return sender;
    },
  });
  const dialogues = [];
  return {
    log, dialogues, inventory, attributes,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    setInterfaceId(id) { this.interfaceId = id; },
    getInterfaceId() { return this.interfaceId; },
    setEnteredAmountAction(action) { this.amountAction = action; },
    sendMessage: (text) => log.push(`message ${text}`),
    performAnimation: (anim) => log.push(`seq ${anim.getId()}`),
    getUpdateFlag: () => ({ flag() {} }),
    getSkillManager: () => ({
      getMaxLevel: () => level,
      addExperiences: (skill, xp) => log.push(`xp ${xp}`),
    }),
    getEquipment: () => ({
      getItems: () => equipment,
      setItem: (slot, item) => { equipment[slot] = item.getId() > 0 ? item : null; },
      refreshItems() {},
    }),
    getInventory: () => ({
      getFreeSlots: () => 28 - inventory.length,
      getAmount: (id) => inventory.filter((item) => item.getId() === id).length,
      addItem: (item) => inventory.push(item),
      contains: (id) => inventory.some((item) => item.getId() === id),
      deleteNumber: (id) => inventory.splice(inventory.findIndex((item) => item.getId() === id), 1),
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => dialogues.push(chain) }),
    getSailing: () => ({ boats: [] }),
    item: (id) => new Item(id, 1),
  };
}

/** A board showing the jewellery task last, as the Pandemonium's did in a recording. */
function withBoard(player) {
  const rows = common.DATA.boards.the_pandemonium.filter((row) => common.taskByRow(row)?.id !== JEWELLERY_TASK).slice(0, 7);
  rows.push(common.DATA.tasks.find((task) => task.id === JEWELLERY_TASK).row);
  player.setAttribute(common.BOARDS_ATTRIBUTE, { the_pandemonium: rows });
  return rows;
}

function inspect(player) {
  hooks.objects["Notice board"].Inspect({ player, objectId: PANDEMONIUM_BOARD.id, location: PANDEMONIUM_BOARD });
}

function clickEntry(player, entry) {
  for (const click of hooks.clicks) click({ player, groupId: 941, childId: 3, slot: entry * 6 });
}

test("the data: every courier task has its ports, crate and Wiki XP; 23 boards of 26", () => {
  const courier = common.DATA.tasks.filter((task) => task.type === "courier" && task.board);
  assert.equal(courier.length, 439, "441, less the two quest deliveries (no board)");
  assert.ok(courier.every((task) => task.cargoPort && task.destination && task.crate > 0 && task.xp > 0));
  assert.equal(Object.keys(common.DATA.boards).length, 23);
  const jewellery = common.taskById(JEWELLERY_TASK);
  assert.deepEqual([jewellery.row, jewellery.crate, jewellery.cargoPort, jewellery.destination, jewellery.xp],
    [8683, 32682, "the_pandemonium", "port_sarim", 78], "as recorded and on the Wiki");
});

test("a notice board shows eight tasks, the same each time, and a click opens one's details (rsprox)", () => {
  const player = createPlayer();
  inspect(player);
  const init = player.log.find((line) => line.startsWith("script 8912 "));
  const rows = JSON.parse(init.slice("script 8912 ".length));
  assert.equal(rows.length, 8);
  assert.ok(rows.every((row) => common.DATA.boards.the_pandemonium.includes(row)));
  assert.ok(player.log.includes("open 941"));
  player.log.length = 0;
  inspect(player);
  assert.ok(player.log.includes(`script 8912 ${JSON.stringify(rows)}`), "kept");
  player.log.length = 0;
  clickEntry(player, 7);
  assert.ok(player.log.includes("open 942"));
  assert.ok(player.log.includes(`script 8900 ${JSON.stringify([(941 << 16) | 5, rows[7], 0, 0])}`), "slot 42 is the eighth task");
});

test("accepting fills a slot and redraws the board; the limits refuse (slots by level, level, bounties)", () => {
  const player = createPlayer();
  withBoard(player);
  inspect(player);
  clickEntry(player, 7);
  player.log.length = 0;
  player.amountAction.execute(1);
  assert.ok(player.log.includes(`sendVarbit 19574=${JEWELLERY_TASK}`), "port_task_slot_0_id");
  assert.ok(player.log.includes("message You have accepted the <col=0090bc>Port Sarim jewellery delivery</col> port task."));
  assert.ok(player.log.some((line) => line.startsWith("script 8912 ")), "the board again");

  const novice = createPlayer(1);
  novice.setAttribute(common.SLOTS_ATTRIBUTE, [{ id: 1, taken: 0, delivered: 0 }]);
  assert.match(board.refusal(novice, common.taskById(JEWELLERY_TASK)), /any more port tasks/, "one slot at level 1");
  assert.match(board.refusal(createPlayer(1), common.taskById(16)), /Sailing level of 20/);
  assert.match(board.refusal(createPlayer(), common.taskById(445)), /Bounty/);
});

test('the Prying Times prerequisite can query an available port-task slot', () => {
  const player = createPlayer();
  const request = { player, available: false };
  hooks.custom['sailing:has-port-task-slot'](request);
  assert.equal(request.available, true);
  player.setAttribute(common.SLOTS_ATTRIBUTE, Array.from({ length: 5 }, (_, id) => ({ id, taken: 0, delivered: 0 })));
  hooks.custom['sailing:has-port-task-slot'](request);
  assert.equal(request.available, false);
});

test("the ledger table: a crate in both hands at the cargo port, then delivered at the destination (rsprox)", () => {
  const player = createPlayer();
  player.setAttribute(common.SLOTS_ATTRIBUTE, [{ id: JEWELLERY_TASK, taken: 0, delivered: 0 }]);
  hooks.objects["Ledger table"]["Take-cargo"]({ player, location: PORT_SARIM_LEDGER });
  assert.equal(common.heldCrate(player), undefined, "nothing to collect at Port Sarim");
  hooks.objects["Ledger table"]["Take-cargo"]({ player, location: PANDEMONIUM_LEDGER });
  assert.equal(common.heldCrate(player), 32682);
  assert.ok(player.log.includes("seq 832") && player.log.includes("sendVarbit 19575=1") && player.log.includes("sendVarbit 19134=1"));
  assert.ok(player.log.includes("sendVarbit 19590=1"), "port_task_last_cargo_taken: slot 0");
  player.log.length = 0;
  hooks.objects["Ledger table"]["Take-cargo"]({ player, location: PANDEMONIUM_LEDGER });
  assert.equal(player.dialogues.length, 1, "hands full: a statement, no second crate");

  player.setAttribute(common.BOARDS_ATTRIBUTE, { the_pandemonium: [common.taskById(JEWELLERY_TASK).row] });
  const random = Math.random;
  Math.random = () => 0.5; // a coin bag, no shark paint
  try {
    hooks.objects["Ledger table"]["Deposit-cargo"]({ player, location: PORT_SARIM_LEDGER });
  } finally {
    Math.random = random;
  }
  assert.equal(common.heldCrate(player), undefined);
  assert.ok(player.log.includes("xp 78"));
  assert.ok(player.log.includes("message You have finished the <col=0090bc>Port Sarim jewellery delivery</col> port task."));
  assert.deepEqual(player.inventory.map((item) => item.getId()), [common.DATA.coinBags[0]], "a tiny coin bag");
  assert.equal(common.slots(player)[0], null);
  assert.ok(player.log.includes("sendConfig 5207=1") && player.log.includes("sendVarbit 19591=1"));
  assert.notEqual(player.getAttribute(common.BOARDS_ATTRIBUTE).the_pandemonium[0], common.taskById(JEWELLERY_TASK).row,
    "its entry on the board is drawn again");
});

test("bags: sized by the task's base XP, 1 in 5 the destination's reward bag", () => {
  const medium = { xp: 1011, destination: "port_piscarilius" };
  assert.equal(ledger.rewardBag(medium, () => 0.9), common.DATA.coinBags[2]);
  assert.equal(ledger.rewardBag(medium, () => 0.1), common.DATA.rewardBags.port_piscarilius[2]);
  assert.equal(ledger.rewardBag({ xp: 6000, destination: "aldarin" }, () => 0.9), common.DATA.coinBags[4]);
});

test("a port master cancels a task and its crates, and has nothing to cancel or claim otherwise", () => {
  const player = createPlayer();
  const npc = { getId: () => 15461 };
  hooks.npcs["Port master"]["Cancel-task"]({ player, npc });
  hooks.npcs["Port master"]["Claim-rewards"]({ player, npc });
  assert.equal(player.dialogues.length, 2);
  player.setAttribute(common.SLOTS_ATTRIBUTE, [{ id: JEWELLERY_TASK, taken: 1, delivered: 0 }]);
  common.carry(player, 32682, 0);
  master.cancel(player, 0);
  assert.equal(common.slots(player)[0], null);
  assert.equal(common.heldCrate(player), undefined);
  player.setAttribute(common.UNCLAIMED_ATTRIBUTE, [common.DATA.coinBags[1]]);
  hooks.npcs["Port master"]["Claim-rewards"]({ player, npc });
  assert.deepEqual(player.inventory.map((item) => item.getId()), [common.DATA.coinBags[1]]);
});
