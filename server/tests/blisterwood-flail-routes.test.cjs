// Run after `yarn build`: node --test tests/blisterwood-flail-routes.test.cjs
//
// Replacing a lost Blisterwood flail, by Talk-to packet. Wiki (Blisterwood flail): lost before
// completion "it can be reclaimed from Veliaf Hurtz in the Icyene Graveyard for 40,000 coins";
// after completion "it is sold by Ivan Strom in Meiyerditch". The lines are Transcript:Sins of the
// Father ("talking to Veliaf after leaving the fight"). No capture shows either route. Ours: the
// refusal on a full bag, as for the Arkan blade (tests/quest-reward-room.test.cjs); every no-flail
// player getting the sale rather than the transcript's death reclaim; and the sale from the crafted
// flail on, ending there as the fight hasn't begun; and a banked flail, which isn't lost but can't
// start the fight, with its line.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [3222, 3218];
const CONTINUE_CHILD = { 231: 5, 217: 5, 193: 0, 229: 2 };
const NO_ROOM = "You don't have enough inventory space.";
const PRICE = 40000;
/** SinsOfTheFather.Quest.js: the flail is made, Safalaan's walk, ready, the castle fight, and done. */
const STAGE_FLAIL = 120;
const STAGE_SAFALAAN_WALK = 122;
const STAGE_READY = 126;
const STAGE_CASTLE = 130;
const VANESCULA = 9574;
const CASTLE_ARENA = [3565, 3362];
const GIVEN = "Veliaf gives you a Blisterwood Flail.";
const STAGE_COMPLETE = 138;
const IVANS_SUPPLIES = 1178;
const LOST_LINE = "But I've lost my flail.";
const LEFT_BEHIND = "You need your blisterwood flail with you.";
const BUY = ["Yes.", "I need more time to prepare."];

let core;
let I;
let N;
let ShopManager;
let next = 9400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  ({ ShopManager } = require("../dist/game/model/container/shop/ShopManager"));
  const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
  assert.equal(new ShopDefinitionLoader().load(), true, "the server's shops");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  ShopManager.initialize();
});
after(() => PM.emitServerShutdown({}));

function sins() {
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "sins_of_the_father");
  assert.ok(quest, "control: Sins of the Father is registered");
  return quest;
}

function actor(t, stage, coins) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("flailqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  sins().setStage(p, stage);
  const inv = p.getInventory();
  if (coins > 0) inv.setItem(0, new core.Item(I.COINS, coins));
  return { p, c, inv, messages };
}

function fill(f) {
  while (f.inv.getFreeSlots() > 0) f.inv.add(new core.Item(I.RAKE), false);
  f.inv.refreshItems();
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    f.p.needsPlacement = false;
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
  f.p.needsPlacement = false;
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

/** Plays the open conversation, answering each menu from `answers`, and returns what it showed. */
async function playChat(f, answers, onMenu) {
  const queue = [...answers];
  const shown = [];
  for (let i = 0; i < 120; i++) {
    const menu = core.MultiChatboxPrompt.getPending(f.p);
    if (menu) {
      onMenu?.();
      const choice = menu.options.findIndex((option) => option.startsWith(queue[0] ?? "\0"));
      assert.ok(choice >= 0, `"${queue[0]}" is on the menu: ${JSON.stringify(menu.options)}, after ${JSON.stringify(shown)}`);
      queue.shift();
      await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice + 1 });
      ticks(f, 1);
      continue;
    }
    const manager = f.p.getDialogueManager();
    if (!manager.isActive()) {
      ticks(f, 2);
      if (!manager.isActive() && !core.MultiChatboxPrompt.getPending(f.p)) break;
      continue;
    }
    const current = manager.getCurrent();
    if (typeof current?.getText === "function") shown.push(String(current.getText()).replace(/<br>/g, " "));
    const group = f.p.getPacketSender().getChatboxGroupId();
    if (!(current instanceof ActionDialogue) && group in CONTINUE_CHILD) {
      await send(f, { type: "dialogue_continue", widgetId: (group << 16) | CONTINUE_CHILD[group], childIndex: -1 });
    }
    ticks(f, 1);
  }
  assert.deepEqual(queue, [], `every expected menu came up, after ${JSON.stringify(shown)}`);
  return shown;
}

async function talk(t, f, npcId, answers, onMenu) {
  const npc = core.NPC.create(npcId, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  const actions = npc.getCurrentDefinition(f.p).getActions();
  const index = actions.findIndex((action) => action === "Talk-to");
  assert.ok(index >= 0, `control: ${npcId} has Talk-to: ${JSON.stringify(actions)}`);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: index + 1 });
  ticks(f, 3);
  return playChat(f, answers, onMenu);
}

const worn = (f) => f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.BLISTERWOOD_FLAIL));
const banked = (f) => f.p.getBank(0).add(new core.Item(I.BLISTERWOOD_FLAIL), false);

const held = (f) => [f.inv.getAmount(I.COINS), f.inv.getAmount(I.BLISTERWOOD_FLAIL)];

test("Veliaf, flail held: the castle offer, no charge (control)", async (t) => {
  const f = actor(t, STAGE_CASTLE, PRICE);
  f.inv.add(new core.Item(I.BLISTERWOOD_FLAIL), true);
  await talk(t, f, N.VELIAF_HURTZ_2, ["I need more time to prepare."]);
  assert.deepEqual(held(f), [PRICE, 1]);
});

test("Veliaf, flail lost: he sells another for 40,000 coins", async (t) => {
  const f = actor(t, STAGE_CASTLE, PRICE + 500);
  const shown = await talk(t, f, N.VELIAF_HURTZ_2, BUY);
  assert.ok(shown.some((line) => line.includes(LOST_LINE)), JSON.stringify(shown));
  assert.deepEqual(held(f), [500, 1]);
});

test("Veliaf, flail lost, under the price: nothing changes hands", async (t) => {
  const f = actor(t, STAGE_CASTLE, PRICE - 1);
  const shown = await talk(t, f, N.VELIAF_HURTZ_2, []);
  assert.ok(shown.some((line) => line.includes("I don't have that much.")), JSON.stringify(shown));
  assert.deepEqual(held(f), [PRICE - 1, 0]);
});

test("Veliaf, flail lost: exact coins free their slot in a full bag", async (t) => {
  const f = actor(t, STAGE_CASTLE, PRICE);
  fill(f);
  await talk(t, f, N.VELIAF_HURTZ_2, BUY);
  assert.deepEqual(held(f), [0, 1]);
});

test("Veliaf, flail lost: a full bag keeps its coins and the conversation stops", async (t) => {
  const f = actor(t, STAGE_CASTLE, PRICE + 500);
  fill(f);
  const shown = await talk(t, f, N.VELIAF_HURTZ_2, ["Yes."]);
  assert.deepEqual(held(f), [PRICE + 500, 0], "nothing changes hands");
  assert.ok(f.messages.includes(NO_ROOM), JSON.stringify(f.messages));
  assert.equal(shown.some((line) => line.includes("gives you a Blisterwood Flail")), false, JSON.stringify(shown));
  assert.equal(f.messages.includes(GIVEN), false, JSON.stringify(f.messages));
  assert.equal(f.p.getDialogueManager().isActive(), false, "the conversation is over");
});

test("Veliaf at the fight: a bought flail goes on to Let's go, back to the castle", async (t) => {
  const f = actor(t, STAGE_CASTLE, PRICE);
  await talk(t, f, N.VELIAF_HURTZ_2, ["Yes.", "Let's go."]);
  assert.deepEqual(held(f), [0, 1]);
  const at = f.p.getLocation();
  assert.deepEqual([at.getX(), at.getY()], CASTLE_ARENA);
});

for (const stage of [STAGE_FLAIL, STAGE_SAFALAAN_WALK, STAGE_READY]) {
  test(`stage ${stage}, flail lost: Veliaf sells another, and the fight doesn't begin`, async (t) => {
    const f = actor(t, stage, PRICE + 500);
    const shown = await talk(t, f, N.VELIAF_HURTZ_2, ["Yes."]);
    assert.ok(shown.some((line) => line.includes(LOST_LINE)), JSON.stringify(shown));
    assert.deepEqual(held(f), [500, 1]);
    assert.ok(f.messages.includes(GIVEN), JSON.stringify(f.messages));
    assert.equal(f.p.getDialogueManager().isActive(), false, "no Let's go before the fight");
    const at = f.p.getLocation();
    assert.deepEqual([at.getX(), at.getY()], HOME, "still at the graveyard side");
    assert.equal(sins().getStage(f.p), stage, "the quest doesn't move");
  });

  test(`stage ${stage}, flail lost: under the price nothing changes hands`, async (t) => {
    const f = actor(t, stage, PRICE - 1);
    const shown = await talk(t, f, N.VELIAF_HURTZ_2, []);
    assert.ok(shown.some((line) => line.includes("I don't have that much.")), JSON.stringify(shown));
    assert.deepEqual(held(f), [PRICE - 1, 0]);
  });

  test(`stage ${stage}, flail held: no sale (control)`, async (t) => {
    const f = actor(t, stage, PRICE);
    f.inv.add(new core.Item(I.BLISTERWOOD_FLAIL), true);
    const shown = await talk(t, f, N.VELIAF_HURTZ_2, []);
    assert.equal(shown.some((line) => line.includes(LOST_LINE)), false, JSON.stringify(shown));
    assert.deepEqual(held(f), [PRICE, 1]);
  });
}

for (const [where, place] of [["wielded", () => worn], ["banked", () => banked]]) {
  test(`stage 120, flail ${where}: Veliaf's normal page, no sale, and the quest moves on`, async (t) => {
    const f = actor(t, STAGE_FLAIL, PRICE);
    place()(f);
    const shown = await talk(t, f, N.VELIAF_HURTZ_2, []);
    assert.equal(shown.some((line) => line.includes(LOST_LINE)), false, JSON.stringify(shown));
    assert.deepEqual(held(f), [PRICE, 0], "no charge");
    assert.equal(sins().getStage(f.p), STAGE_SAFALAAN_WALK);
  });

  test(`stage 126, flail ${where}: Veliaf's normal page, no sale`, async (t) => {
    const f = actor(t, STAGE_READY, PRICE);
    place()(f);
    const shown = await talk(t, f, N.VELIAF_HURTZ_2, []);
    assert.equal(shown.some((line) => line.includes(LOST_LINE)), false, JSON.stringify(shown));
    assert.deepEqual(held(f), [PRICE, 0], "no charge");
    assert.equal(sins().getStage(f.p), STAGE_READY);
  });
}

test("stage 130, flail wielded: no sale, and Let's go is offered", async (t) => {
  const f = actor(t, STAGE_CASTLE, PRICE);
  worn(f);
  const shown = await talk(t, f, N.VELIAF_HURTZ_2, ["I need more time to prepare."]);
  assert.equal(shown.some((line) => line.includes(LOST_LINE)), false, JSON.stringify(shown));
  assert.deepEqual(held(f), [PRICE, 0], "no charge");
});

test("stage 130, flail banked: no sale and no way to the fight, and it says why", async (t) => {
  const f = actor(t, STAGE_CASTLE, PRICE);
  banked(f);
  const shown = await talk(t, f, N.VELIAF_HURTZ_2, []);
  assert.equal(shown.some((line) => line.includes(LOST_LINE)), false, JSON.stringify(shown));
  assert.deepEqual(held(f), [PRICE, 0], "no charge");
  assert.ok(f.messages.includes(LEFT_BEHIND), JSON.stringify(f.messages));
  const at = f.p.getLocation();
  assert.deepEqual([at.getX(), at.getY()], HOME);
});

test("stage 130: a flail that comes to hand during the conversation means no charge", async (t) => {
  const f = actor(t, STAGE_CASTLE, PRICE);
  let given = false;
  await talk(t, f, N.VELIAF_HURTZ_2, ["Yes."], () => {
    if (!given) f.inv.add(new core.Item(I.BLISTERWOOD_FLAIL), true);
    given = true;
  });
  assert.deepEqual(held(f), [PRICE, 1]);
  assert.equal(f.messages.includes(GIVEN), false, JSON.stringify(f.messages));
});

test("stage 126, Vanescula: a wielded flail starts the fight", async (t) => {
  const f = actor(t, STAGE_READY, 0);
  worn(f);
  await talk(t, f, VANESCULA, ["I'm ready."]);
  assert.equal(sins().getStage(f.p), STAGE_CASTLE);
});

test("stage 126, Vanescula: a banked flail doesn't start the fight, and it says why", async (t) => {
  const f = actor(t, STAGE_READY, 0);
  banked(f);
  await talk(t, f, VANESCULA, ["I'm ready."]);
  assert.equal(sins().getStage(f.p), STAGE_READY);
  assert.ok(f.messages.includes(LEFT_BEHIND), JSON.stringify(f.messages));
});

test("stage 130: bought, then more time, then a later Let's go still returns to the castle", async (t) => {
  const f = actor(t, STAGE_CASTLE, PRICE);
  await talk(t, f, N.VELIAF_HURTZ_2, ["Yes.", "I need more time to prepare."]);
  assert.deepEqual(held(f), [0, 1]);
  await talk(t, f, N.VELIAF_HURTZ_2, ["Let's go."]);
  const at = f.p.getLocation();
  assert.deepEqual([at.getX(), at.getY()], CASTLE_ARENA);
});

test("stage 126: Vanescula won't start the fight with no flail, and will once it's bought", async (t) => {
  const f = actor(t, STAGE_READY, PRICE);
  await talk(t, f, VANESCULA, ["I'm ready."]);
  assert.equal(sins().getStage(f.p), STAGE_READY, "control: no flail, no fight");
  assert.ok(f.messages.includes(LEFT_BEHIND), JSON.stringify(f.messages));
  const before = f.p.getLocation();
  assert.deepEqual([before.getX(), before.getY()], HOME, "and not sent on the Ivan escort");
  await talk(t, f, N.VELIAF_HURTZ_2, ["Yes."]);
  assert.deepEqual(held(f), [0, 1]);
  await talk(t, f, VANESCULA, ["I'm ready."]);
  assert.equal(sins().getStage(f.p), STAGE_CASTLE);
});

test("post-Sins Ivan: 'I need another flail.' opens Ivan's Supplies and the flail costs 40,000", async (t) => {
  const f = actor(t, STAGE_COMPLETE, PRICE + 500);
  // Holding the quest's tome (24690): without it, Ivan's first conversation only hands it back.
  f.inv.add(new core.Item(24690), true);
  await talk(t, f, N.IVAN_STROM, ["I need another flail."]);
  const shop = ShopManager.shopsById.get(IVANS_SUPPLIES);
  assert.ok(shop, "control: the shop is loaded");
  const slot = ShopManager.displayEntries(shop).findIndex(({ itemId }) => itemId === I.BLISTERWOOD_FLAIL);
  assert.ok(slot >= 0, "the flail is in stock");
  ShopManager.handleWidgetAction(f.p, {
    groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option: "Buy 1", slot: slot + 1, itemId: I.BLISTERWOOD_FLAIL,
  });
  assert.deepEqual(held(f), [500, 1]);
});
