// Run after `yarn build`: node --test tests/mac-max-cape.test.cjs
//
// Selling a max cape back to Mac and taking a combined cape apart. Everything goes through
// ClientConnection.dispatch to a registered Mac and the real plugins: a native fixture. Commune and
// the Ring of life toggle are called from their exported menu functions, and answered by dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");

const Capes = require("../plugins/items/skillcapes/Common.SkillCapes");
const Options = require("../plugins/items/skillcapes/Options.SkillCapes");

const HOME = [3222, 3218];
const YES = 1;
const NO = 2;
const NO_ROOM_TO_SELL = "You don't have enough room for what Mac would give you.";
const NO_ROOM_TO_DISASSEMBLE = "You don't have enough inventory space to disassemble that.";
const RING_OF_LIFE_OFF = "skillcapes:ring-of-life-off";

let core;
let I;
let next = 4800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("macqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const c = new ClientConnection(channel);
  c.player = p;
  const mac = core.NPC.create(core.NpcIdentifiers.MAC, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(mac);
  t.after(() => {
    core.World.getRemoveNPCQueue?.().splice(0);
    core.World.getNpcs().remove(mac);
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, mac, inv: p.getInventory(), messages };
}

function drain(f) {
  for (let i = 0; i < 6; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const pending = (f) => core.MultiChatboxPrompt.getPending(f.p);
const answer = (f, option) => send(f, {
  type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: option,
});
const plain = (id, count = 1) => new core.Item(id, count);
const infernal = () => Capes.COMBINED_BY_ITEM.get(I.INFERNAL_CAPE);

function floor(f, id) {
  const found = ItemOnGroundManager.getGroundItem(f.p.getUsername(), id, f.p.getLocation(), f.p.getPrivateArea?.());
  return found ? found.getItem().getAmount() : 0;
}

const owned = (f, id) => f.inv.getAmount(id) + floor(f, id);

function fillTo(f, freeSlots) {
  while (f.inv.getFreeSlots() > freeSlots) f.inv.add(plain(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), freeSlots);
}

/** The real packet for an item used on Mac, then the walk to him. */
async function useOnMac(f, slot) {
  await send(f, {
    type: "item_on_npc", targetIndex: f.mac.getIndex(), itemId: f.inv.getItems()[slot].getId(), slot, widgetId: 149 << 16,
  });
  drain(f);
  assert.ok(pending(f), "Mac asks first");
}

/** A statement's Continue, as the client resumes whatever chatbox is showing. */
async function continueChat(f) {
  const group = f.p.getPacketSender().chatboxGroupId;
  await send(f, { type: "dialogue_continue", widgetId: group << 16, childIndex: -1 });
}

async function continueToPrompt(f) {
  for (let i = 0; i < 6 && !pending(f) && f.p.getDialogueManager().isActive(); i++) await continueChat(f);
  assert.ok(pending(f), "the prompt is open to be answered");
}

/** Talk-to through Mac's real transcript, choosing to sell. */
async function sellByTalking(f) {
  await send(f, { type: "npc_option", index: f.mac.getIndex(), clickType: 1 });
  drain(f);
  const wanted = /sell my max cape|^yes - receive/i;
  let chose = 0;
  for (let i = 0; i < 40; i++) {
    const prompt = pending(f);
    const current = f.p.getDialogueManager().getCurrent();
    if (prompt) {
      const index = prompt.options.findIndex((option) => wanted.test(option));
      assert.ok(index >= 0, `an option to sell in: ${prompt.options.join(" | ")}`);
      chose++;
      await answer(f, index + 1);
    } else if (current?.getOptions) {
      const options = current.getOptions().map((option) => String(option));
      const index = options.findIndex((option) => wanted.test(option));
      assert.ok(index >= 0, `an option to sell in: ${options.join(" | ")}`);
      chose++;
      await answer(f, index + 1);
    } else if (f.p.getDialogueManager().isActive()) {
      await continueChat(f);
    } else {
      break;
    }
    drain(f);
  }
  assert.ok(chose >= 2, "the conversation reached the sale");
}

function heldNothingChanged(f, capeId, slot = 0) {
  assert.equal(f.inv.getItems()[slot]?.getId(), capeId, "the cape is kept");
  assert.equal(owned(f, I.COINS), 0, "no coins");
  assert.equal(owned(f, I.INFERNAL_CAPE), 0, "the item is still inside it");
}

test("use on Mac with a full inventory sells nothing, unless a coin stack or hood makes the room", async (t) => {
  const control = actor(t);
  control.inv.setItem(0, plain(infernal().cape));
  await useOnMac(control, 0);
  assert.match(pending(control).title, /infernal/i, "the question names the cape used");
  await answer(control, YES);
  assert.equal(owned(control, I.COINS), Capes.MAX.sellBack);
  assert.equal(owned(control, I.INFERNAL_CAPE), 1);

  const full = actor(t);
  full.inv.setItem(0, plain(infernal().cape));
  fillTo(full, 0);
  await useOnMac(full, 0);
  await answer(full, YES);
  heldNothingChanged(full, infernal().cape);
  assert.ok(full.messages.includes(NO_ROOM_TO_SELL));

  const coins = actor(t);
  coins.inv.setItem(0, plain(infernal().cape));
  coins.inv.setItem(1, plain(I.COINS, 5));
  fillTo(coins, 0);
  await useOnMac(coins, 0);
  await answer(coins, YES);
  assert.equal(owned(coins, I.COINS), 5 + Capes.MAX.sellBack, "a coin stack needs no slot");
  assert.equal(owned(coins, I.INFERNAL_CAPE), 1, "and the item takes the cape's");

  const hood = actor(t);
  hood.inv.setItem(0, plain(infernal().cape));
  hood.inv.setItem(1, plain(infernal().hood));
  fillTo(hood, 0);
  await useOnMac(hood, 0);
  await answer(hood, YES);
  assert.equal(owned(hood, I.COINS), Capes.MAX.sellBack, "the hood's slot takes the coins");
  assert.equal(owned(hood, I.INFERNAL_CAPE), 1);

  const plainCape = actor(t);
  plainCape.inv.setItem(0, plain(Capes.MAX.cape));
  fillTo(plainCape, 0);
  await useOnMac(plainCape, 0);
  assert.equal(pending(plainCape).title, "Sell your max cape and hood back?", "as captured");
  await answer(plainCape, YES);
  assert.equal(owned(plainCape, I.COINS), Capes.MAX.sellBack, "a plain cape's slot is enough for the coins");
});

test("Talk-to with a full inventory sells nothing either", async (t) => {
  const control = actor(t);
  control.inv.setItem(0, plain(infernal().cape));
  await sellByTalking(control);
  assert.equal(owned(control, I.COINS), Capes.MAX.sellBack);
  assert.equal(owned(control, I.INFERNAL_CAPE), 1);

  const full = actor(t);
  full.inv.setItem(0, plain(infernal().cape));
  fillTo(full, 0);
  await sellByTalking(full);
  heldNothingChanged(full, infernal().cape);
  assert.ok(full.messages.includes(NO_ROOM_TO_SELL));
});

test("a coin stack that can't take the whole price sells nothing", async (t) => {
  const exact = actor(t);
  exact.inv.setItem(0, plain(Capes.MAX.cape));
  exact.inv.setItem(1, plain(I.COINS, MAX_STACK_AMOUNT - Capes.MAX.sellBack));
  await useOnMac(exact, 0);
  await answer(exact, YES);
  assert.equal(exact.inv.getAmount(I.COINS), MAX_STACK_AMOUNT, "control: exactly the room");
  assert.equal(exact.inv.getAmount(Capes.MAX.cape), 0);

  const over = MAX_STACK_AMOUNT - Capes.MAX.sellBack + 1;
  const f = actor(t);
  f.inv.setItem(0, plain(Capes.MAX.cape));
  f.inv.setItem(1, plain(I.COINS, over));
  await useOnMac(f, 0);
  await answer(f, YES);
  assert.equal(f.inv.getAmount(Capes.MAX.cape), 1, "the cape is kept");
  assert.equal(f.inv.getAmount(I.COINS), over, "the coins are unchanged");
  assert.ok(f.messages.includes(NO_ROOM_TO_SELL));
});

test("Yes sells the cape used on Mac, once, and nothing if that cape has gone", async (t) => {
  const setUp = (f) => {
    f.inv.setItem(0, plain(Capes.MAX.cape));
    f.inv.setItem(1, plain(infernal().cape));
  };
  const control = actor(t);
  setUp(control);
  await useOnMac(control, 0);
  await answer(control, YES);
  await answer(control, YES);
  assert.equal(owned(control, I.COINS), Capes.MAX.sellBack, "control: the first cape sold, a repeat pays nothing");
  assert.equal(control.inv.getAmount(infernal().cape), 1, "control: the other cape stays");

  const second = actor(t);
  setUp(second);
  await useOnMac(second, 1);
  await answer(second, YES);
  assert.equal(second.inv.getAmount(Capes.MAX.cape), 1, "the cape not used on Mac stays");
  assert.equal(second.inv.getAmount(infernal().cape), 0, "the cape used on Mac goes");
  assert.equal(owned(second, I.INFERNAL_CAPE), 1);

  const moved = actor(t);
  setUp(moved);
  await useOnMac(moved, 1);
  await send(moved, { type: "inventory_move", from: 1, to: 9, widgetId: 3214 });
  await answer(moved, YES);
  assert.equal(moved.inv.getAmount(Capes.MAX.cape), 1, "a moved cape is still the one");
  assert.equal(moved.inv.getAmount(infernal().cape), 0);

  const removed = actor(t);
  setUp(removed);
  await useOnMac(removed, 1);
  removed.inv.deleteAtSlot(1, 1);
  await answer(removed, YES);
  assert.equal(owned(removed, I.COINS), 0, "nothing paid");
  assert.equal(removed.inv.getAmount(Capes.MAX.cape), 1, "and another cape isn't taken instead");
});

test("the knife's prompt stays open, and Yes takes the cape apart", async (t) => {
  const useKnife = (f) => send(f, {
    type: "inventory_use_on", slot: 1, itemId: I.KNIFE,
    target: { kind: "inventory", slot: 0, itemId: infernal().cape },
  });
  const setUp = (f) => {
    f.inv.setItem(0, plain(infernal().cape));
    f.inv.setItem(1, plain(I.KNIFE));
  };

  // Control: a prompt opened outside the statement chain stays open on the same player.
  const control = actor(t);
  setUp(control);
  await useOnMac(control, 0);
  assert.ok(pending(control), "control: a prompt from outside the chain is open");
  await answer(control, NO);

  const no = actor(t);
  setUp(no);
  await useKnife(no);
  await continueToPrompt(no);
  await answer(no, NO);
  assert.equal(no.inv.getAmount(infernal().cape), 1, "No keeps it whole");

  const yes = actor(t);
  setUp(yes);
  await useKnife(yes);
  await continueToPrompt(yes);
  await answer(yes, YES);
  assert.equal(yes.inv.getAmount(infernal().cape), 0);
  assert.equal(yes.inv.getAmount(Capes.MAX.cape), 1, "the max cape");
  assert.equal(yes.inv.getAmount(I.INFERNAL_CAPE), 1, "and the item");
});

test("the knife on a full inventory takes nothing apart", async (t) => {
  const start = async (f, freeSlots) => {
    f.inv.setItem(0, plain(infernal().cape));
    f.inv.setItem(1, plain(I.KNIFE));
    fillTo(f, freeSlots);
    await send(f, {
      type: "inventory_use_on", slot: 1, itemId: I.KNIFE,
      target: { kind: "inventory", slot: 0, itemId: infernal().cape },
    });
    await continueToPrompt(f);
    await answer(f, YES);
  };
  const control = actor(t);
  await start(control, 1);
  assert.equal(owned(control, Capes.MAX.cape), 1, "control: one free slot is enough");
  assert.equal(owned(control, I.INFERNAL_CAPE), 1);

  const full = actor(t);
  await start(full, 0);
  assert.equal(full.inv.getAmount(infernal().cape), 1, "the cape stays whole");
  assert.equal(owned(full, Capes.MAX.cape), 0);
  assert.equal(owned(full, I.INFERNAL_CAPE), 0);
  assert.ok(full.messages.includes(NO_ROOM_TO_DISASSEMBLE));
});

test("Commune and the Ring of life toggle can be answered, and No changes nothing", async (t) => {
  const no = actor(t);
  Options.toggleEffect(no.p);
  await continueToPrompt(no);
  await answer(no, NO);
  assert.notEqual(no.p.getAttribute(RING_OF_LIFE_OFF), true, "control: No leaves the effect on");

  const toggle = actor(t);
  Options.toggleEffect(toggle.p);
  await continueToPrompt(toggle);
  await answer(toggle, YES);
  assert.equal(toggle.p.getAttribute(RING_OF_LIFE_OFF), true, "Yes turns it off");

  const commune = actor(t);
  Options.commune(commune.p);
  await continueToPrompt(commune);
  await answer(commune, YES);
  assert.equal(commune.p.getAttribute(Capes.JUNK_OFF_ATTRIBUTE), true, "Yes stops the gathering");
});

/** Talk-to through the real transcript up to the question about selling, and no further. */
async function talkToSaleQuestion(f) {
  await send(f, { type: "npc_option", index: f.mac.getIndex(), clickType: 1 });
  drain(f);
  for (let i = 0; i < 30 && !/^sell your/i.test(pending(f)?.title ?? ""); i++) {
    const prompt = pending(f);
    if (prompt) {
      const index = prompt.options.findIndex((option) => /sell my max cape/i.test(option));
      assert.ok(index >= 0, `an option to sell in: ${prompt.options.join(" | ")}`);
      await answer(f, index + 1);
    } else {
      assert.ok(f.p.getDialogueManager().isActive(), "the conversation is still going");
      await continueChat(f);
    }
    drain(f);
  }
}

function assertSaleBox(f, firstItemId, secondItemId) {
  const box = f.p.getDialogueManager().getCurrent();
  assert.ok(box, "a box follows the sale");
  assert.equal(box.firstItemId, firstItemId, "the cape sold");
  assert.equal(box.secondItemId, secondItemId, "and its hood");
  assert.equal(box.text, "You sell your cape and hood back to Mac.");
  assert.ok(f.p.getPacketSender().isChatboxInterface(11), "objectbox_double, as captured");
}

test("Talk-to asks as captured, with no placeholder and coins in the option", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, plain(Capes.MAX.cape));
  await talkToSaleQuestion(f);
  const price = Capes.MAX.sellBack.toLocaleString("en-US");
  assert.deepEqual(pending(f), {
    title: "Sell your max cape and hood back?",
    options: [`Yes - receive ${price} coins.`, "No, I've changed my mind."],
  });

  const variant = actor(t);
  variant.inv.setItem(0, plain(infernal().cape));
  await talkToSaleQuestion(variant);
  assert.doesNotMatch(pending(variant).title, /\[/, "a variant has no placeholder either");
  assert.match(pending(variant).title, /infernal/i);

  const no = actor(t);
  no.inv.setItem(0, plain(Capes.MAX.cape));
  await talkToSaleQuestion(no);
  await answer(no, NO);
  assert.equal(no.inv.getAmount(Capes.MAX.cape), 1, "No keeps the cape");
  assert.equal(owned(no, I.COINS), 0);
});

test("the sale shows the cape and hood box as captured, by either route", async (t) => {
  const used = actor(t);
  used.inv.setItem(0, plain(Capes.MAX.cape));
  used.inv.setItem(1, plain(Capes.MAX.hood));
  await useOnMac(used, 0);
  await answer(used, YES);
  assert.equal(owned(used, I.COINS), Capes.MAX.sellBack, "control: sold");
  assertSaleBox(used, Capes.MAX.cape, Capes.MAX.hood);

  const talked = actor(t);
  talked.inv.setItem(0, plain(Capes.MAX.cape));
  talked.inv.setItem(1, plain(Capes.MAX.hood));
  await talkToSaleQuestion(talked);
  await answer(talked, YES);
  assert.equal(owned(talked, I.COINS), Capes.MAX.sellBack, "sold by talking");
  assertSaleBox(talked, Capes.MAX.cape, Capes.MAX.hood);

  const noHood = actor(t);
  noHood.inv.setItem(0, plain(Capes.MAX.cape));
  await useOnMac(noHood, 0);
  await answer(noHood, YES);
  const box = noHood.p.getDialogueManager().getCurrent();
  assert.equal(box?.text, "You sell your cape back to Mac.", "with no hood the transcript has its own line");
  assert.equal(owned(noHood, I.COINS), Capes.MAX.sellBack);

  const refused = actor(t);
  refused.inv.setItem(0, plain(infernal().cape));
  fillTo(refused, 0);
  await useOnMac(refused, 0);
  await answer(refused, YES);
  assert.equal(refused.p.getDialogueManager().getCurrent() ?? null, null, "no box for a refused sale");
});
