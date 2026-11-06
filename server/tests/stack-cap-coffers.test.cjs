// Run after `yarn build`: node --test tests/stack-cap-coffers.test.cjs
//
// A stack can't grow past its cap, and add() drops whatever doesn't fit, so these exchanges must
// not debit what won't arrive. Native fixture: answers and amounts go through
// ClientConnection.dispatch. Short of dispatch, because the loc would need its map and a walk: the
// coffers and the chest through PM.emitObjectInteraction, the death through
// PlayerDeathTask.dropItems, and Perdu's unlock through its _test export.
// Keep bot activity out of this native fixture.
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
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");

const Perdu = require("../plugins/items/brokenitems/Perdu.BrokenItems");
const BrokenCommon = require("../plugins/items/brokenitems/Common.BrokenItems");

const HOME = [3222, 3218];
const FURNACE_ROOM = [1945, 4965];
const NEX_CHAMBER = [2924, 5202];
const NEX_CHEST = 42854;
const NEX_FEE = 100000;
const NEX_RECLAIM = "nex:reclaim";
const BH_COFFER = "bounty-hunter:coffer";
const FURNACE_STATE = "blast-furnace";
const DEPOSIT = 1;
const WITHDRAW = 2;
const YES = 1;
const NO_SPACE = "You don't have enough inventory space.";

let core;
let I;
let next = 5200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  // Bounty Hunter depends on PlayerBots, so attach its real coffer with bots disabled.
  require("../plugins/minigames/bountyhunter/Coffer.BountyHunter")(PM.createApi("BountyHunterCofferTest"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at = HOME) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("stackcap" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const answer = (f, option) => send(f, {
  type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: option,
});
const plain = (id, count = 1) => new core.Item(id, count);
const pending = (f) => core.MultiChatboxPrompt.getPending(f.p);

function fillTo(f, freeSlots) {
  while (f.inv.getFreeSlots() > freeSlots) f.inv.add(plain(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), freeSlots);
}

function useLoc(f, name, option, id) {
  const location = new core.Location(f.p.getLocation().getX() + 1, f.p.getLocation().getY(), 0);
  const interaction = option.charAt(0).toUpperCase() + option.slice(1);
  return PM.emitObjectInteraction({
    player: f.p, object: new core.GameObject(id, location, 10, 0, null), objectId: id, clickType: 1, option,
    definition: { getName: () => name, getInteractions: () => [interaction] },
    location: { x: location.getX(), y: location.getY(), z: 0 },
    sourceLocation: { x: f.p.getLocation().getX(), y: f.p.getLocation().getY(), z: 0 },
    handled: false,
  });
}

/** A coffer's real menu and amount prompt. */
async function coffer(f, id, option, amount) {
  assert.ok(useLoc(f, "Coffer", "use", id), "the coffer took the click");
  assert.ok(pending(f), "the coffer's menu is open");
  await answer(f, option);
  assert.ok(f.p.getEnteredAmountAction(), "the amount prompt is open");
  await send(f, { type: "dialogue_amount", amount });
}

// ------------------------------------------------------------------ Blast Furnace coffer

const FURNACE_LOC = 1;
const furnaceCoffer = (f) => f.p.getAttribute(FURNACE_STATE).coffer;

async function fundFurnace(f, amount) {
  f.inv.setItem(0, plain(I.COINS, amount));
  await coffer(f, FURNACE_LOC, DEPOSIT, amount);
  assert.equal(furnaceCoffer(f), amount, "deposited");
  assert.equal(f.inv.getAmount(I.COINS), 0, "from the inventory");
}

test("Blast Furnace coffer: only what the coin stack can hold leaves the coffer", async (t) => {
  const control = actor(t, FURNACE_ROOM);
  await fundFurnace(control, 1000);
  await coffer(control, FURNACE_LOC, WITHDRAW, 1000);
  assert.equal(control.inv.getAmount(I.COINS), 1000, "control: withdrawn");
  assert.equal(furnaceCoffer(control), 0, "control: the coffer is empty");

  const exact = actor(t, FURNACE_ROOM);
  await fundFurnace(exact, 1000);
  exact.inv.setItem(0, plain(I.COINS, MAX_STACK_AMOUNT - 1000));
  await coffer(exact, FURNACE_LOC, WITHDRAW, 1000);
  assert.equal(exact.inv.getAmount(I.COINS), MAX_STACK_AMOUNT, "exactly the room");
  assert.equal(furnaceCoffer(exact), 0);

  const f = actor(t, FURNACE_ROOM);
  await fundFurnace(f, 1000);
  f.inv.setItem(0, plain(I.COINS, MAX_STACK_AMOUNT - 5));
  await coffer(f, FURNACE_LOC, WITHDRAW, 1000);
  assert.equal(f.inv.getAmount(I.COINS), MAX_STACK_AMOUNT, "the stack filled");
  assert.equal(furnaceCoffer(f), 995, "the coffer keeps the rest");
});

test("Blast Furnace coffer: an uncapped coffer can't lose its excess to a large withdrawal", async (t) => {
  const held = 1800000000;
  const stored = 500000000;
  const control = actor(t, FURNACE_ROOM);
  await fundFurnace(control, stored);
  await coffer(control, FURNACE_LOC, WITHDRAW, stored);
  assert.equal(control.inv.getAmount(I.COINS), stored, "control: no stack, all of it");

  const f = actor(t, FURNACE_ROOM);
  await fundFurnace(f, stored);
  f.inv.setItem(0, plain(I.COINS, held));
  await coffer(f, FURNACE_LOC, WITHDRAW, stored);
  assert.equal(f.inv.getAmount(I.COINS) + furnaceCoffer(f), held + stored, "coins plus coffer are conserved");
});

test("Blast Furnace coffer: no room at all refuses with the existing message", async (t) => {
  const control = actor(t, FURNACE_ROOM);
  await fundFurnace(control, 1000);
  fillTo(control, 1);
  await coffer(control, FURNACE_LOC, WITHDRAW, 1000);
  assert.equal(control.inv.getAmount(I.COINS), 1000, "control: one free slot takes the coins");

  const capped = actor(t, FURNACE_ROOM);
  await fundFurnace(capped, 1000);
  capped.inv.setItem(0, plain(I.COINS, MAX_STACK_AMOUNT));
  await coffer(capped, FURNACE_LOC, WITHDRAW, 1000);
  assert.equal(furnaceCoffer(capped), 1000, "a stack at the cap takes nothing");
  assert.equal(capped.messages.at(-1), NO_SPACE);

  const full = actor(t, FURNACE_ROOM);
  await fundFurnace(full, 1000);
  fillTo(full, 0);
  await coffer(full, FURNACE_LOC, WITHDRAW, 1000);
  assert.equal(furnaceCoffer(full), 1000, "a full inventory with no coins takes nothing");
  assert.equal(full.messages.at(-1), NO_SPACE);
});

// ------------------------------------------------------------------ Bounty Hunter coffer

test("Bounty Hunter coffer: only what the coin stack can hold leaves the coffer", async (t) => {
  const id = () => core.ObjectIdentifiers.COFFER_4;
  const control = actor(t);
  control.p.setAttribute(BH_COFFER, 1000);
  await coffer(control, id(), WITHDRAW, 1000);
  assert.equal(control.inv.getAmount(I.COINS), 1000, "control: withdrawn");
  assert.equal(control.p.getAttribute(BH_COFFER), 0, "control: the coffer is empty");

  const f = actor(t);
  f.p.setAttribute(BH_COFFER, 1000);
  f.inv.setItem(0, plain(I.COINS, MAX_STACK_AMOUNT - 5));
  await coffer(f, id(), WITHDRAW, 1000);
  assert.equal(f.inv.getAmount(I.COINS), MAX_STACK_AMOUNT, "the stack filled");
  assert.equal(f.p.getAttribute(BH_COFFER), 995, "the coffer keeps the rest");

  const capped = actor(t);
  capped.p.setAttribute(BH_COFFER, 1000);
  capped.inv.setItem(0, plain(I.COINS, MAX_STACK_AMOUNT));
  await coffer(capped, id(), WITHDRAW, 1000);
  assert.equal(capped.p.getAttribute(BH_COFFER), 1000, "a stack at the cap takes nothing");
  assert.equal(capped.messages.at(-1), NO_SPACE);
});

// ------------------------------------------------------------------ Nex's chest

function dieWithRunes(f) {
  // Three better items are kept on a death, so the runes go to the chest.
  for (let slot = 10; slot < 13; slot++) f.inv.setItem(slot, plain(I.TUMEKENS_SHADOW_UNCHARGED_));
  f.inv.setItem(0, plain(I.DEATH_RUNE, 1000));
  PlayerDeathTask.dropItems(f.p, null, new core.Location(...NEX_CHAMBER, 0));
  assert.ok((f.p.getAttribute(NEX_RECLAIM) ?? []).length > 0, "the chest took the runes");
}

async function claim(f) {
  f.inv.add(plain(I.COINS, NEX_FEE), true);
  useLoc(f, "Chest", "claim", NEX_CHEST);
  assert.ok(pending(f), "the chest asks first");
  await answer(f, YES);
}

const inChest = (f) => (f.p.getAttribute(NEX_RECLAIM) ?? []).reduce((sum, [id, count]) => sum + (id === I.DEATH_RUNE ? count : 0), 0);

test("Nex chest: a stack that can't take the stored amount keeps the items and the fee", async (t) => {
  const control = actor(t, NEX_CHAMBER);
  dieWithRunes(control);
  await claim(control);
  assert.equal(control.inv.getAmount(I.DEATH_RUNE), 1000, "control: reclaimed");
  assert.equal(control.inv.getAmount(I.COINS), 0, "control: the fee is paid");
  assert.equal(inChest(control), 0, "control: the chest is empty");

  const exact = actor(t, NEX_CHAMBER);
  dieWithRunes(exact);
  exact.inv.add(plain(I.DEATH_RUNE, MAX_STACK_AMOUNT - 1000), true);
  await claim(exact);
  assert.equal(exact.inv.getAmount(I.DEATH_RUNE), MAX_STACK_AMOUNT, "exactly the room");
  assert.equal(inChest(exact), 0);

  const nearCap = MAX_STACK_AMOUNT - 5;
  const f = actor(t, NEX_CHAMBER);
  dieWithRunes(f);
  f.inv.add(plain(I.DEATH_RUNE, nearCap), true);
  await claim(f);
  assert.equal(f.inv.getAmount(I.DEATH_RUNE), nearCap, "the stack is unchanged");
  assert.equal(inChest(f), 1000, "the chest keeps them");
  assert.equal(f.inv.getAmount(I.COINS), NEX_FEE, "no fee taken");
  assert.equal(f.messages.at(-1), NO_SPACE);
});

test("Nex chest: the fee counts as room for stored coins, and a refusal charges nothing", async (t) => {
  const reclaimCoins = async (f, stored, held) => {
    for (let slot = 10; slot < 13; slot++) f.inv.setItem(slot, plain(I.TUMEKENS_SHADOW_UNCHARGED_));
    f.inv.setItem(0, plain(I.COINS, stored));
    PlayerDeathTask.dropItems(f.p, null, new core.Location(...NEX_CHAMBER, 0));
    assert.deepEqual(f.p.getAttribute(NEX_RECLAIM), [[I.COINS, stored]], "the chest took the coins");
    f.inv.setItem(5, plain(I.COINS, held));
    useLoc(f, "Chest", "claim", NEX_CHEST);
    assert.ok(pending(f), "the chest asks first");
    await answer(f, YES);
  };
  const storedCoins = (f) => (f.p.getAttribute(NEX_RECLAIM) ?? []).reduce((sum, [, count]) => sum + count, 0);

  const control = actor(t, NEX_CHAMBER);
  await reclaimCoins(control, 1000, 500000);
  assert.equal(control.inv.getAmount(I.COINS), 500000 - NEX_FEE + 1000, "control: paid and reclaimed");
  assert.equal(storedCoins(control), 0, "control: the chest is empty");

  const capped = actor(t, NEX_CHAMBER);
  await reclaimCoins(capped, 1000, MAX_STACK_AMOUNT);
  assert.equal(capped.inv.getAmount(I.COINS), MAX_STACK_AMOUNT - NEX_FEE + 1000, "a full stack has the fee's room");
  assert.equal(storedCoins(capped), 0, "the chest is empty");

  const exact = actor(t, NEX_CHAMBER);
  await reclaimCoins(exact, NEX_FEE + 50, MAX_STACK_AMOUNT - 50);
  assert.equal(exact.inv.getAmount(I.COINS), MAX_STACK_AMOUNT, "spare room plus the fee is exactly enough");
  assert.equal(storedCoins(exact), 0);

  const over = actor(t, NEX_CHAMBER);
  await reclaimCoins(over, NEX_FEE + 51, MAX_STACK_AMOUNT - 50);
  assert.equal(over.inv.getAmount(I.COINS), MAX_STACK_AMOUNT - 50, "one coin too many charges nothing");
  assert.equal(storedCoins(over), NEX_FEE + 51, "and the chest keeps them");
  assert.equal(over.messages.at(-1), NO_SPACE);
});

test("Nex chest: paying the last coins frees a slot only once, so stored coins and an item both need room", async (t) => {
  const whipOwned = (f) => f.inv.getAmount(I.ABYSSAL_WHIP)
    + (f.p.getAttribute(NEX_RECLAIM) ?? []).filter(([id]) => id === I.ABYSSAL_WHIP).length;
  const reclaimBoth = async (f, freeSlots) => {
    for (let slot = 10; slot < 13; slot++) f.inv.setItem(slot, plain(I.TUMEKENS_SHADOW_UNCHARGED_));
    f.inv.setItem(0, plain(I.COINS, 1000));
    f.inv.setItem(1, plain(I.ABYSSAL_WHIP));
    PlayerDeathTask.dropItems(f.p, null, new core.Location(...NEX_CHAMBER, 0));
    assert.equal(f.p.getAttribute(NEX_RECLAIM).length, 2, "the chest took the coins and the whip");
    f.inv.setItem(5, plain(I.COINS, NEX_FEE));
    while (f.inv.getFreeSlots() > freeSlots) f.inv.add(plain(I.RAKE), false);
    useLoc(f, "Chest", "claim", NEX_CHEST);
    assert.ok(pending(f), "the chest asks first");
    await answer(f, YES);
  };
  const control = actor(t, NEX_CHAMBER);
  await reclaimBoth(control, 1);
  assert.equal(control.inv.getAmount(I.ABYSSAL_WHIP), 1, "control: one free slot takes the whip");
  assert.equal(control.inv.getAmount(I.COINS), 1000, "control: the fee's slot takes the coins");

  const full = actor(t, NEX_CHAMBER);
  await reclaimBoth(full, 0);
  assert.equal(whipOwned(full), 1, "the whip is held or still in the chest");
  assert.equal(full.inv.getAmount(I.COINS), NEX_FEE, "no fee taken");
  assert.equal(full.p.getAttribute(NEX_RECLAIM).length, 2, "the chest keeps both");
  assert.equal(full.messages.at(-1), "You need 1 free inventory spaces to reclaim your items.");
});

// ------------------------------------------------------------------ Perdu's unlock

test("Perdu unlock: a coin stack that can't take the refund leaves the item locked", async (t) => {
  const refund = () => BrokenCommon.DATA.unlockRefund;
  const unlockedId = () => BrokenCommon.lookup(I.FIRE_CAPE_L_).form.unlockedId;
  const parchment = () => BrokenCommon.idOf(BrokenCommon.TROUVER_PARCHMENT);
  const start = (f, coins) => {
    f.inv.setItem(0, plain(I.FIRE_CAPE_L_));
    f.inv.setItem(1, plain(I.COINS, coins));
    Perdu._test.unlock(f.p, 0, I.FIRE_CAPE_L_);
  };
  const control = actor(t);
  start(control, 1000);
  assert.equal(control.inv.getAmount(unlockedId()), 1, "control: unlocked");
  assert.equal(control.inv.getAmount(I.COINS), 1000 + refund(), "control: refunded");
  assert.equal(control.inv.getAmount(parchment()), 1, "control: the parchment back");

  const exact = actor(t);
  start(exact, MAX_STACK_AMOUNT - refund());
  assert.equal(exact.inv.getAmount(unlockedId()), 1, "exactly the room");
  assert.equal(exact.inv.getAmount(I.COINS), MAX_STACK_AMOUNT);

  const over = MAX_STACK_AMOUNT - refund() + 1;
  const f = actor(t);
  start(f, over);
  assert.equal(f.inv.getAmount(I.FIRE_CAPE_L_), 1, "still locked");
  assert.equal(f.inv.getAmount(unlockedId()), 0);
  assert.equal(f.inv.getAmount(I.COINS), over, "the coins are unchanged");
  assert.equal(f.inv.getAmount(parchment()), 0, "no parchment");
  assert.equal(f.messages.at(-1), NO_SPACE);
});

// Exercise the registered Perdu interaction as well as the direct coin-cap check above.
test("native Perdu unlock conserves the parchment entitlement at the stack limit", async (t) => {
  const parchment = BrokenCommon.idOf(BrokenCommon.TROUVER_PARCHMENT);
  assert.equal(parchment, I.TROUVER_PARCHMENT);
  assert.equal(core.ItemDefinition.forId(parchment).isStackable(), true, "active-cache stackability");
  assert.equal(BrokenCommon.lookup(I.INFERNAL_CAPE).form.lockedId, I.INFERNAL_CAPE_L_);
  assert.equal(BrokenCommon.lookup(I.INFERNAL_CAPE_L_).form.unlockedId, I.INFERNAL_CAPE);
  const refund = BrokenCommon.DATA.unlockRefund;
  const fee = BrokenCommon.DATA.lockCost;

  for (const mode of ["room", "exact-stack", "full-inventory", "capped-stack"]) {
    await t.test(mode, async (t) => {
      const f = actor(t, [3226, 3218]);
      const { p, inv } = f;
      const npc = core.NPC.create(core.NpcIdentifiers.PERDU, new core.Location(3227, 3218, 0));
      assert.equal(core.World.getNpcs().add(npc), true);
      assert.equal(npc.getCurrentDefinition(p).getName(), "Perdu", "real morph-visible actor");
      t.after(() => {
        p.closeInterruptibleInterfaces();
        core.TaskManager.cancelTasks(p.getIndex());
        core.TaskManager.cancelTasks(p);
        core.World.getNpcs().remove(npc);
        for (const ground of core.World.getItems().filter((g) => g.getOwner() === p.getUsername())) {
          core.ItemOnGroundManager.deregister(ground);
        }
      });
      let turns = 0;
      const turn = () => {
        assert.ok(++turns <= 32, "bounded native phase budget");
        p.resetUpdating();
        core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
        core.TaskManager.process();
        f.c.processTurnPackets();
        const queue = p.getMovementQueue();
        queue.beginCycle();
        queue.processEntityPursuit();
        if (queue.hasPendingWork()) queue.process();
        core.TaskManager.processWalkTo(p.getIndex());
      };
      const packet = async (value) => {
        await f.c.dispatch([value]);
        turn();
      };
      const floor = (id) => core.World.getItems()
        .filter((g) => !g.isPendingRemoval() && g.getOwner() === p.getUsername() &&
          g.getPrivateArea() === p.getPrivateArea() && g.getItem().getId() === id)
        .reduce((n, g) => n + g.getItem().getAmount(), 0);
      const owned = (id) => inv.getAmount(id) + p.getEquipment().getAmount(id) +
        p.getBanks().reduce((n, b, i) => n +
          (b && i !== core.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(id) : 0), 0) + floor(id);
      const state = () => ({
        mode, parchment: owned(parchment), coins: owned(I.COINS),
        locked: owned(I.INFERNAL_CAPE_L_), unlocked: owned(I.INFERNAL_CAPE), free: inv.getFreeSlots(),
      });
      async function offer(itemId) {
        p.getDialogueManager().reset();
        p.getPacketSender().sendInterfaceRemoval();
        await packet({ type: "item_on_npc", widgetId: 149 << 16, targetIndex: npc.getIndex(),
          itemId, slot: inv.getSlotForItemId(itemId) });
        for (let n = 0; n < 8 && !p.getDialogueManager().getCurrent() && !pending(f); n++) turn();
        assert.equal(pending(f), null, "Perdu starts a native line, not an invented option callback");
        assert.match(p.getDialogueManager().getCurrent()?.getText?.() ?? "",
          itemId === I.INFERNAL_CAPE ? /cost you/ : /returning your parchment/);
        const group = p.getPacketSender().getChatboxGroupId();
        assert.ok(group >= 0);
        await packet({ type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 });
        const menu = pending(f);
        assert.ok(menu, "native line must hand off to the real plugin prompt");
        assert.equal(p.getDialogueManager().isActive(), false, "MultiChatboxPrompt owns this response");
        assert.ok(menu.options[0].startsWith(itemId === I.INFERNAL_CAPE ? "Lock item" : "Yes"));
        return menu;
      }
      const capped = mode === "capped-stack", full = mode === "full-inventory";
      const initial = (mode === "exact-stack" || capped) ? MAX_STACK_AMOUNT : 2;
      inv.add(plain(I.INFERNAL_CAPE), false);
      inv.add(plain(parchment, initial), false);
      inv.add(plain(I.COINS, fee + 1000), false);
      await offer(I.INFERNAL_CAPE);
      await packet({ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: 1 });
      assert.equal(owned(I.INFERNAL_CAPE_L_), 1, "actual paid lock producer");
      assert.equal(owned(I.INFERNAL_CAPE), 0);
      assert.equal(owned(parchment), initial - 1);
      assert.equal(owned(I.COINS), 1000);
      if (capped) {
        const at = p.getLocation();
        core.ItemOnGroundManager.registerLocation(p, plain(parchment), at.clone());
        assert.equal(floor(parchment), 1);
        await packet({ type: "ground_item_action", itemId: parchment, x: at.getX(), y: at.getY(),
          option: "Take", optionIndex: 3 });
        for (let n = 0; n < 6 && floor(parchment) > 0; n++) turn();
        assert.equal(inv.getAmount(parchment), MAX_STACK_AMOUNT, "native pickup tops the ordinary stack back up");
        assert.equal(floor(parchment), 0);
      }
      if (full) fillTo(f, 0);
      const before = state();
      await offer(I.INFERNAL_CAPE_L_);
      assert.match(pending(f).title, /Unlock it/);
      assert.equal(inv.getAddableAmount(plain(parchment)), capped ? 0 : 1, "observable native output capacity");
      assert.equal(inv.getAddableAmount(plain(I.COINS, refund)), refund, "coin refund has room");
      await packet({ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: 1 });
      const end = state();
      const details = JSON.stringify({ before, end });
      assert.equal(end.parchment + end.locked, before.parchment + before.locked,
        "returned parchment plus retained locked entitlement must be conserved: " + details);
      const refuse = capped || full;
      assert.equal(end.locked, refuse ? 1 : 0, details);
      assert.equal(end.unlocked, refuse ? 0 : 1, details);
      assert.equal(end.coins, before.coins + (refuse ? 0 : refund), details);
      assert.equal(end.parchment, before.parchment + (refuse ? 0 : 1), details);
    });
  }
});
