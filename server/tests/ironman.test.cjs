// Run after `yarn build`: node --test tests/ironman.test.cjs
// Ironman account types (docs/ironman.md): setting one, and the rules each follows.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { DuelState } = require("../dist/game/content/Duelling");
const DuelArena = require("../plugins/minigames/DuelArena.plugin");

let core;
const hooks = {};
const custom = {};
const emitted = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const on = (name) => (handler) => (hooks[name] = handler);
  const api = new Proxy({
    core,
    persistAttribute() {},
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onCustomEvent: (name, handler) => (custom[name] = handler),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      custom[name]?.(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  // DuelArena first: this harness keeps one handler per core hook, and the Ironman rules below
  // must be the ones that answer.
  DuelArena.register(api);
  require("../plugins/modes/Ironman.plugin").register(api);
});

/** A real player whose messages and varbits are recorded. */
function account(name, mode = null) {
  const player = new Player(null);
  player.setUsername(name);
  const messages = [];
  const varbits = new Map();
  const sender = new Proxy({}, {
    get: (target, key) => (key === "sendVarbit" ? (id, value) => (varbits.set(id, value), sender) : () => sender),
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  if (mode) hooks["command:ironman"]({ player, parts: ["ironman", mode] });
  messages.length = 0;
  return Object.assign(player, { messages, varbits });
}

test("::ironman sets the mode: the attribute, the ironman varbit (1777) and the chat icon", () => {
  const admin = account("admin");
  const target = account("ironwoman");
  core.World.getPlayerByName = (name) => (name === "ironwoman" ? target : undefined);
  hooks["command:ironman"]({ player: admin, parts: ["ironman", "hardcore", "ironwoman"] });
  assert.equal(target.getAttribute("ironman:mode"), "hardcore");
  assert.equal(target.varbits.get(1777), 3, "the cache's enum 859: 3 is Hardcore Ironman");
  const icon = { player: target, icon: null };
  custom["account:chat-icon"](icon);
  assert.equal(icon.icon, 10);
  assert.ok(emitted.some(([name, payload]) => name === "account:refresh-chat-icons" && payload.player === target));
  hooks["command:ironman"]({ player: admin, parts: ["ironman", "none", "ironwoman"] });
  assert.equal(target.getAttribute("ironman:mode"), null);
  assert.equal(target.varbits.get(1777), 0);
});

test("no trading either way, with the captured lines", () => {
  const iron = account("iron", "ironman");
  const main = account("main");
  const fromIron = { player: iron, target: main, handled: false };
  hooks.onTradeRequest(fromIron);
  assert.deepEqual([fromIron.handled, iron.messages], [true, ["You are an Ironman. You stand alone."]]);
  const toIron = { player: main, target: iron, handled: false };
  hooks.onTradeRequest(toIron);
  assert.deepEqual([toIron.handled, main.messages], [true, ["iron is an Ironman. He stands alone."]]);
  const mains = { player: main, target: account("other"), handled: false };
  hooks.onTradeRequest(mains);
  assert.equal(mains.handled, false, "two normal accounts trade as before");
});

test("onCanTrade refuses the window itself, whichever side is the Ironman", () => {
  const iron = account("iron", "ironman");
  const main = account("main");
  const fromIron = { player: iron, target: main, allow: null };
  hooks.onCanTrade(fromIron);
  assert.deepEqual([fromIron.allow, iron.messages], [false, ["You are an Ironman. You stand alone."]]);
  const toIron = { player: main, target: iron, allow: null };
  hooks.onCanTrade(toIron);
  assert.deepEqual([toIron.allow, main.messages], [false, ["iron is an Ironman. He stands alone."]]);
  const mains = { player: main, target: account("other"), allow: null };
  hooks.onCanTrade(mains);
  assert.equal(mains.allow, null, "two normal accounts can still trade");
});

test("an Ironman can't stake in the Duel Arena; a free duel is fine", () => {
  for (const mode of ["ironman", "ultimate", "hardcore"]) {
    const player = account(`staker-${mode}`, mode);
    const request = { player, allow: true, message: null };
    custom["duelarena:can-stake"](request);
    assert.deepEqual([request.allow, request.message],
      [false, "As an Ironman, you cannot take part in a staked duel."]);
    assert.deepEqual(player.messages, [], "the Duel Arena shows the request's message");
  }
  const main = { player: account("main"), allow: true, message: null };
  custom["duelarena:can-stake"](main);
  assert.equal(main.allow, true);
});

test("a mode change between the two final acceptances refuses the staked duel", (t) => {
  const staker = account("staker");
  const opponent = account("opponent");
  for (const [player, x] of [[staker, 3330], [opponent, 3331]]) {
    player.setLocation(new core.Location(x, 3250, 0));
  }
  staker.getInventory().adds(995, 1000);
  const session = {
    players: [staker, opponent], mask: 0, accepted: new Set(), stage: "confirm",
    offers: new Map([[staker, new Map([[0, new core.Item(995, 1000)]])], [opponent, new Map()]]),
  };
  session.snapshots = session.players.map(DuelArena._test.snapshot);
  for (const player of session.players) {
    DuelArena._test.sessions.set(player, session);
    player.getDueling().setState(DuelState.CONFIRM_SCREEN);
  }

  // The staker offers coins and confirms the duel as a normal account.
  DuelArena._test.accept(staker, session);
  assert.deepEqual([...session.accepted], [staker]);

  const findPlayer = core.World.getPlayerByName;
  core.World.getPlayerByName = (name) => (name === "staker" ? staker : undefined);
  t.after(() => { core.World.getPlayerByName = findPlayer; });
  hooks["command:ironman"]({ player: account("admin"), parts: ["ironman", "ironman", "staker"] });
  staker.messages.length = 0;

  // The opponent's confirmation re-checks the staker, who is now an Ironman.
  DuelArena._test.accept(opponent, session);
  assert.equal(session.stage, "confirm", "the duel never starts");
  assert.deepEqual([...session.accepted], [staker], "the opponent is not accepted either");
  assert.deepEqual(staker.messages, ["As an Ironman, you cannot take part in a staked duel."]);
  assert.equal(staker.getInventory().getAmount(995), 1000, "the coins stay in the staker's inventory");
  assert.equal(opponent.getDueling().getState(), DuelState.CONFIRM_SCREEN);
});

test("an Ironman can't pick up other players' items; their own and world spawns are fine", () => {
  const iron = account("iron", "ironman");
  const pick = (owner) => {
    const event = { player: iron, groundItem: { getOwner: () => owner }, handled: false };
    hooks.onGroundItemPickup(event);
    return event.handled;
  };
  assert.equal(pick("someoneelse"), true);
  assert.deepEqual(iron.messages, ["You're an Ironman, so you can't take items that other players have dropped."]);
  assert.equal(pick("iron"), false);
  assert.equal(pick(null), false);
  const main = account("main");
  const event = { player: main, groundItem: { getOwner: () => "someoneelse" }, handled: false };
  hooks.onGroundItemPickup(event);
  assert.equal(event.handled, false, "normal accounts pick up as before");
});

test("stacks from different owners never merge, so an Ironman can't inherit a drop", t => {
  const iron = account("iron", "ironman");
  const main = account("main");
  const manager = core.ItemOnGroundManager;
  const { State } = require("../dist/game/entity/impl/grounditem/ItemOnGround");
  const items = core.World.getItems(), previous = items.splice(0);
  t.after(() => items.splice(0, items.length, ...previous));

  // A main's drop cannot join the Ironman's public stack...
  const ironPile = manager.registerLocation(iron, new core.Item(995, 10), new core.Location(3200, 3200));
  ironPile.setState(State.SEEN_BY_EVERYONE);
  const mainPile = manager.registerLocation(main, new core.Item(995, 5), new core.Location(3200, 3200));
  assert.deepEqual([ironPile.getItem().getAmount(), mainPile.getItem().getAmount()], [10, 5]);
  assert.equal(mainPile.getOwner(), "main");

  // ...and the Ironman's drop cannot join the main's public stack.
  const mainPublic = manager.registerLocation(main, new core.Item(995, 7), new core.Location(3201, 3200));
  mainPublic.setState(State.SEEN_BY_EVERYONE);
  const own = manager.registerLocation(iron, new core.Item(995, 3), new core.Location(3201, 3200));
  assert.deepEqual([own.getOwner(), own.getItem().getAmount(), mainPublic.getItem().getAmount()],
    ["iron", 3, 7]);

  // The same owner still stacks, and the Ironman keeps it.
  const merged = manager.registerLocation(iron, new core.Item(995, 2), new core.Location(3201, 3200));
  assert.equal(own.getItem().getAmount(), 5);
  assert.equal(items.includes(merged), false, "merged into the Ironman's own stack");
});

test("a kill another player helped with gives an Ironman nothing; a solo kill keeps its drop", () => {
  const iron = account("iron", "ironman");
  const helper = account("helper");
  const shared = { player: iron, drops: [{ id: 995 }], damagers: [iron, helper] };
  custom["npc-drops:roll"](shared);
  assert.deepEqual([shared.drops, iron.messages], [[], ["As an Ironman, you don't get loot if other players helped you kill the monster."]]);
  const solo = { player: iron, drops: [{ id: 995 }], damagers: [iron] };
  custom["npc-drops:roll"](solo);
  assert.equal(solo.drops.length, 1);
});

test("attacking an npc someone else damaged warns once about kill credit", () => {
  const iron = account("iron", "ironman");
  const npc = { isNpc: () => true, getCombat: () => ({ getRecentDamagers: () => [account("helper")] }) };
  iron.isPlayer = () => true;
  hooks.onCanAttack({ attacker: iron, target: npc, allow: null });
  hooks.onCanAttack({ attacker: iron, target: npc, allow: null });
  assert.deepEqual(iron.messages, ["As an Ironman, you might not receive kill-credit for this monster."]);
});

test("shops sell an Ironman only their own stock", () => {
  const iron = account("iron", "ironman");
  const stocked = { player: iron, available: 15, original: 10, limit: 15, message: null };
  custom["shop:buy-limit"](stocked);
  assert.equal(stocked.limit, 10);
  const playerSold = { player: iron, available: 4, original: 0, limit: 4, message: null };
  custom["shop:buy-limit"](playerSold);
  assert.deepEqual([playerSold.limit, playerSold.message], [0, "As an Ironman, you can only buy the shop's own stock."]);
  const main = { player: account("main"), available: 4, original: 0, limit: 4, message: null };
  custom["shop:buy-limit"](main);
  assert.equal(main.limit, 4);
});

test("Ironmen may only place single-bond buy offers", () => {
  assert.equal(typeof custom["ge:offer-confirmed"], "function", "Ironman offer listener is registered");
  for (const mode of ["ironman", "ultimate", "hardcore"]) {
    const player = account(`ge-${mode}`, mode);
    for (const [itemId, sell, quantity, allowed] of [
      [core.ItemIdentifiers.OLD_SCHOOL_BOND, false, 1, true],
      [core.ItemIdentifiers.OLD_SCHOOL_BOND, false, 2, false],
      [core.ItemIdentifiers.OLD_SCHOOL_BOND, true, 1, false],
      [core.ItemIdentifiers.COINS, false, 1, false],
      [core.ItemIdentifiers.COINS, true, 1, false],
    ]) {
      player.messages.length = 0;
      const request = { player, itemId, sell, quantity, accepted: true };
      custom["ge:offer-confirmed"](request);
      assert.equal(request.accepted, allowed, `${mode}: ${itemId}/${sell}/${quantity}`);
      assert.deepEqual(player.messages, allowed ? [] : ["Ironmen can only buy one bond per Grand Exchange offer."]);
    }
    const priorVeto = { player, itemId: core.ItemIdentifiers.OLD_SCHOOL_BOND, sell: false, quantity: 1, accepted: false };
    custom["ge:offer-confirmed"](priorVeto);
    assert.equal(priorVeto.accepted, false, "another plugin's veto is retained");
  }
  const main = { player: account("main"), itemId: core.ItemIdentifiers.COINS, sell: false, quantity: 1, accepted: true };
  custom["ge:offer-confirmed"](main);
  assert.equal(main.accepted, true);
});

test("an Ultimate Ironman can't bank and keeps nothing on death; a standard Ironman can", () => {
  const uim = account("uim", "ultimate");
  const bank = { player: uim, allow: null };
  hooks.onCanBank(bank);
  assert.deepEqual([bank.allow, uim.messages], [false, ["As an Ultimate Ironman, you cannot use the bank."]]);
  const keep = { player: uim, item: {}, keep: null };
  hooks.onShouldKeepItemOnDeath(keep);
  assert.equal(keep.keep, false);
  const im = { player: account("im", "ironman"), allow: null };
  hooks.onCanBank(im);
  assert.equal(im.allow, null);
});

test('only Ultimate Ironmen are refused item-set packing', () => {
  for (const mode of [null, 'ironman', 'hardcore', 'ultimate']) {
    const p = account('set-trader', mode);
    const request = { player: p, allow: true };
    custom['item-sets:can-pack'](request);
    assert.equal(request.allow, mode !== 'ultimate');
    assert.deepEqual(p.messages, mode === 'ultimate' ? ['Ultimate Ironmen cannot pack item sets.'] : []);
  }
});

test("a Hardcore Ironman's dangerous death makes them a standard Ironman; a safe death doesn't", () => {
  const safe = account("safe", "hardcore");
  hooks.onPlayerDeath({ player: safe, killer: null, itemsLost: false, handled: false });
  assert.equal(safe.getAttribute("ironman:mode"), "hardcore");
  const hcim = account("hcim", "hardcore");
  hooks.onPlayerDeath({ player: hcim, killer: null, itemsLost: true, handled: false });
  assert.equal(hcim.getAttribute("ironman:mode"), "ironman");
  assert.deepEqual([hcim.varbits.get(1777), hcim.varbits.get(5403), hcim.varbits.get(1776)], [1, 1, 1]);
  assert.ok(hcim.varbits.get(5405) > 8000, "the downgrade date in days since 27 Feb 2002");
  assert.deepEqual(hcim.messages, ["You have fallen as a Hardcore Ironman. You are now a standard Ironman."]);
});

test("an Ironman gets no combat experience from fighting players", () => {
  const iron = account("iron", "ironman");
  const target = account("pker");
  target.isPlayer = () => true;
  iron.getCombat = () => ({ getTarget: () => target });
  const event = { player: iron, skill: core.Skill.STRENGTH, experience: 40, allow: null };
  hooks.onCanGainExperience(event);
  assert.equal(event.allow, false);
  const cooking = { player: iron, skill: core.Skill.COOKING, experience: 40, allow: null };
  hooks.onCanGainExperience(cooking);
  assert.equal(cooking.allow, null);
});

test("loot from a player an Ironman kills is registered to the fallen player, out of the Ironman's reach", () => {
  const iron = account("iron", "ironman");
  const fallen = account("fallen");
  const registered = [];
  const manager = core.ItemOnGroundManager;
  const original = manager.registerLocation;
  manager.registerLocation = (owner, item) => registered.push([owner.getUsername(), item]);
  try {
    const event = { player: fallen, killer: iron, item: { id: 4151 }, location: {}, dropEligible: true, suppressDefaultDrop: false, handled: false };
    hooks.onPlayerDeathItemDrop(event);
    assert.equal(event.suppressDefaultDrop, true);
    assert.deepEqual(registered.map(([owner]) => owner), ["fallen"]);
  } finally {
    manager.registerLocation = original;
  }
});

test("StaffCrowns: a staff crown wins, else the account's icon, else none", () => {
  const icons = {};
  const staffApi = {
    core,
    onPlayerLogin: (handler) => (icons.login = handler),
    onCustomEvent: (name, handler) => (icons[name] = handler),
    emitCustomEvent: (name, payload) => custom[name]?.(payload),
  };
  require("../plugins/interface/StaffCrowns.plugin").register(staffApi);
  const shown = (player) => {
    icons.login({ player });
    return player.getChatIcons();
  };
  const iron = account("iron", "ultimate");
  assert.deepEqual(shown(iron), [3]);
  const ironMod = account("ironmod", "ironman");
  ironMod.setRights(core.PlayerRights.MODERATOR);
  assert.deepEqual(shown(ironMod), [0], "the player moderator crown wins");
  for (const rights of [core.PlayerRights.ADMINISTRATOR, core.PlayerRights.OWNER, core.PlayerRights.DEVELOPER]) {
    const staff = account("staffiron", "ironman");
    staff.setRights(rights);
    assert.deepEqual(shown(staff), [1], `staff rank ${rights.getId()} gets the gold crown instead of its Ironman helmet`);
    staff.setRights(core.PlayerRights.NONE);
    icons["account:refresh-chat-icons"]({ player: staff });
    assert.deepEqual(staff.getChatIcons(), [2], "refresh restores the account icon when staff rights are removed");
  }
  assert.deepEqual(shown(account("main")), []);
});

test("no presets for an Ironman (they hand out items); normal accounts keep them", () => {
  const iron = { player: account("iron", "ironman"), allow: true, message: null };
  custom["presets:can-use"](iron);
  assert.deepEqual([iron.allow, iron.message], [false, "As an Ironman, you cannot use presets."]);
  const main = { player: account("main"), allow: true, message: null };
  custom["presets:can-use"](main);
  assert.equal(main.allow, true);
});

for (const source of ["pickup", "telegrab"]) {
  for (const mode of ["ironman", "ultimate", "hardcore"]) {
    test(`real ${source} cannot bypass ${mode} ground-item ownership`, t => {
      const player = account("GroundIron", mode), manager = core.ItemOnGroundManager;
      const {State} = require("../dist/game/entity/impl/grounditem/ItemOnGround");
      const {MagicOnItemPacketListener} = require("../dist/net/packet/impl/MagicOnItemPacketListener");
      const listener = new MagicOnItemPacketListener();
      player.setLocation(new core.Location(3222, 3218));
      t.mock.method(player, "isRegistered", () => true);
      t.mock.method(PluginManager, "emitCustomEvent", (name, event) => custom[name]?.(event));
      t.mock.method(PluginManager, "emitGroundItemPickup", event => {
        hooks.onGroundItemPickup(event); return event.handled;
      });
      const items = core.World.getItems(), previous = items.splice(0);
      t.after(() => items.splice(0, items.length, ...previous));
      const take = pile => source === "pickup" ? manager.pickup(player, pile)
        : listener.landGroundItemGrab(player, pile.getItem().getId(), pile.getPosition());
      const pile = manager.registers(player, new core.Item(995, 5));
      pile.owner = "OtherPlayer"; pile.setState(State.SEEN_BY_EVERYONE);
      take(pile);
      assert.equal(player.getInventory().getAmount(995), 0); assert.equal(pile.isPendingRemoval(), false);
      assert.deepEqual(player.messages, ["You're an Ironman, so you can't take items that other players have dropped."]);
      pile.owner = player.getUsername(); take(pile);
      assert.equal(player.getInventory().getAmount(995), 5, "own items remain available");
      const spawn = manager.registers(player, new core.Item(995, 7));
      spawn.owner = null; spawn.setState(State.SEEN_BY_EVERYONE); spawn.staticSpawn = true;
      take(spawn);
      assert.equal(player.getInventory().getAmount(995), 12, "unowned world spawns remain available");
      const publicUntradeable = manager.registers(player, new core.Item(core.ItemIdentifiers.SAWDUST));
      publicUntradeable.owner = undefined; publicUntradeable.setState(State.SEEN_BY_EVERYONE);
      assert.equal(publicUntradeable.isStaticSpawn(), false);
      assert.equal(publicUntradeable.getItem().isTradeable(), false);
      assert.equal(manager.canSee(player, publicUntradeable), true);
      take(publicUntradeable);
      assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.SAWDUST), 1,
        "temporary unowned world items remain available to every Ironman mode");
    });
  }
}

test("Ironman Telegrab refuses other-owned loot before spending runes or scheduling a projectile", t => {
  const player = account("CastingIron", "ironman"), manager = core.ItemOnGroundManager;
  const {State} = require("../dist/game/entity/impl/grounditem/ItemOnGround");
  const {MagicOnItemPacketListener} = require("../dist/net/packet/impl/MagicOnItemPacketListener");
  const {TaskManager} = require("../dist/game/task/TaskManager");
  const listener = new MagicOnItemPacketListener(); let spent = 0, scheduled = 0;
  player.setLocation(new core.Location(3222, 3218));
  t.mock.method(player, "getClickDelay", () => ({elapsedTime: () => true}));
  t.mock.method(player.getSkillManager(), "getCurrentLevel", () => 99);
  t.mock.method(listener, "runeCosts", () => []);
  t.mock.method(listener, "hasRunes", () => true);
  t.mock.method(listener, "consumeRunes", () => { spent++; });
  t.mock.method(TaskManager, "submit", () => { scheduled++; });
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => custom[name]?.(event));
  const items = core.World.getItems(), previous = items.splice(0);
  t.after(() => items.splice(0, items.length, ...previous));
  const pile = manager.registers(player, new core.Item(995, 5));
  pile.owner = "OtherPlayer"; pile.setState(State.SEEN_BY_EVERYONE);
  listener.castGroundItem(player, 995, 3222, 3218, 1168);
  assert.deepEqual(player.messages, ["You're an Ironman, so you can't take items that other players have dropped."]);
  assert.equal(spent, 0); assert.equal(scheduled, 0);
  assert.equal(pile.isPendingRemoval(), false); assert.equal(player.getInventory().getAmount(995), 0);
});


// Connected native regression: real Ironman, GE and Bonds registrations and decoded UI actions.
// No client rendering or retail Ironman-specific widget is claimed.
test("Ironmen use GE only for single-bond buys, with safe collection", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const PM = PluginManager;
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
  t.after(() => PM.emitServerShutdown({}));
  const I = core.ItemIdentifiers;
  let next = 1400;
  function actor(mode, scope) {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(next++); p.setUsername(`geiron${p.getIndex()}`); p.setRegistered(true);
    p.setAttribute("bot-skip-persistence", true);
    p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
    const c = new ClientConnection(channel); c.player = p;
    const sender = p.getPacketSender(), messages = [], varbits = new Map(), configs = new Map();
    const original = sender.sendMessage.bind(sender), originalVarbit = sender.sendVarbit.bind(sender), originalConfig = sender.sendConfig.bind(sender);
    sender.sendMessage = message => { messages.push(message); return original(message); };
    sender.sendVarbit = (id, value) => { varbits.set(id, value); return originalVarbit(id, value); };
    sender.sendConfig = (id, value) => { configs.set(id, value); return originalConfig(id, value); };
    scope.after(() => {
      PM.emitPlayerLogout({ player: p, username: p.getUsername() });
      p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p);
    });
    if (mode) {
      const request = { player: p, mode, handled: false };
      PM.emitCustomEvent("ironman:set-mode", request);
      assert.equal(request.handled, true, "real account mode producer");
    }
    p.getInventory().setItem(0, new core.Item(I.COINS, 1_000_000_000));
    p.getInventory().setItem(2, new core.Item(I.PLATINUM_TOKEN, 3));
    return { p, c, inv: p.getInventory(), messages, varbits, configs };
  }
  async function button(f, child, slot = 0, itemId = -1, action = 1, group = 465) {
    await f.c.dispatch([{ type: "widget_action", widgetId: (group << 16) | child,
      groupId: group, childId: child, buttonNum: action, slot, itemId }]);
    f.c.processTurnPackets();
  }
  function open(f) {
    PM.emitCommand({ player: f.p, raw: "ge", base: "ge", parts: ["ge"], handled: false });
    assert.equal(f.p.getInterfaceId(), 465, "the registered GE entry opens");
  }
  const placed = f => Object.values(f.p.getAttribute("grand-exchange-offers") ?? {});
  async function selectBuy(f, itemId, quantity = 1) {
    await button(f, 7, 3);
    const search = f.p.getEnteredSyntaxAction();
    assert.ok(search, "buy search is active");
    search.execute(String(itemId));
    if (quantity === 2) await button(f, 34, 2);
  }
  async function confirm(f) {
    const oldTimeout = global.setTimeout, emit = PM.emitCustomEvent, callbacks = [], confirmations = [];
    try {
      global.setTimeout = (callback, delay) => { callbacks.push({ callback, delay }); return { unref() {} }; };
      PM.emitCustomEvent = function(name, event) {
        if (name === "ge:offer-confirmed") confirmations.push({ itemId: event.itemId, sell: event.sell });
        return emit.call(PM, name, event);
      };
      await button(f, 30);
    } finally { global.setTimeout = oldTimeout; PM.emitCustomEvent = emit; }
    return { callbacks, confirmations };
  }
  async function sell(f, id) {
    f.inv.setItem(1, new core.Item(id, 1));
    await button(f, 0, 1, id, 1, 467);
    return confirm(f);
  }
  const banks = f => Array.from({ length: core.Bank.TOTAL_BANK_TABS }, (_, tab) =>
    f.p.getBank(tab).getItems().map(item => [item.getId(), item.getAmount()]));
  for (const mode of ["ironman", "ultimate", "hardcore"]) {
    await t.test(`${mode}: buy and collect a bond`, async st => {
      const f = actor(mode, st); open(f);
      await selectBuy(f, I.OLD_SCHOOL_BOND);
      const before = f.inv.getAmount(I.COINS);
      const { callbacks: timers } = await confirm(f);
      assert.equal(placed(f).length, 1, "single bond accepted");
      const offer = placed(f)[0];
      assert.equal(offer.itemId, I.OLD_SCHOOL_BOND); assert.equal(offer.quantity, 1);
      assert.equal(f.inv.getAmount(I.COINS), before - offer.total, "only price escrowed");
      assert.equal(timers.length, 1, "the GE scheduled completion");
      timers[0].callback(); assert.equal(offer.finished, true);
      await button(f, 6);
      assert.equal(placed(f).length, 0);
      assert.equal(f.inv.getAmount(I.OLD_SCHOOL_BOND), 0);
      assert.equal(f.inv.getAmount(I.OLD_SCHOOL_BOND_UNTRADEABLE_), 1, "Bonds converts collection");
    });
  }
  for (const [name, id, quantity] of [["two bonds", I.OLD_SCHOOL_BOND, 2], ["non-bond", I.RUNE_SCIMITAR, 1]]) {
    await t.test(`reject ${name} buy before escrow`, async st => {
      const f = actor("ironman", st); open(f); await selectBuy(f, id, quantity);
      const coins = f.inv.getAmount(I.COINS), tokens = f.inv.getAmount(I.PLATINUM_TOKEN), limits = JSON.stringify(f.p.getAttribute("grand-exchange-limits") ?? {});
      assert.equal(f.configs.get(1151), id, "selected item"); assert.equal(f.varbits.get(4396), quantity, "selected quantity");
      const { confirmations } = await confirm(f);
      assert.deepEqual(confirmations, [{ itemId: id, sell: false }], "the intended offer reaches confirmation");
      assert.equal(placed(f).length, 0); assert.equal(f.inv.getAmount(I.COINS), coins);
      assert.equal(f.inv.getAmount(I.PLATINUM_TOKEN), tokens);
      assert.equal(JSON.stringify(f.p.getAttribute("grand-exchange-limits") ?? {}), limits);
    });
  }
  for (const [name, id] of [["bond", I.OLD_SCHOOL_BOND], ["ordinary item", I.RUNE_SCIMITAR]]) {
    await t.test(`reject ${name} sale before escrow`, async st => {
      const f = actor("ironman", st); open(f);
      const coins = f.inv.getAmount(I.COINS), tokens = f.inv.getAmount(I.PLATINUM_TOKEN), limits = JSON.stringify(f.p.getAttribute("grand-exchange-limits") ?? {});
      const { confirmations } = await sell(f, id);
      assert.deepEqual(confirmations, [{ itemId: id, sell: true }], "the intended sale reaches confirmation");
      assert.equal(placed(f).length, 0); assert.equal(f.inv.getAmount(id), 1);
      assert.equal(f.inv.getAmount(I.COINS), coins); assert.equal(f.inv.getAmount(I.PLATINUM_TOKEN), tokens);
      assert.equal(JSON.stringify(f.p.getAttribute("grand-exchange-limits") ?? {}), limits);
    });
  }
  await t.test("an untradeable bond cannot be sold", async st => {
    const f = actor("ironman", st); open(f);
    f.inv.setItem(1, new core.Item(I.OLD_SCHOOL_BOND_UNTRADEABLE_, 1));
    await button(f, 0, 1, I.OLD_SCHOOL_BOND_UNTRADEABLE_, 1, 467);
    await confirm(f);
    assert.equal(placed(f).length, 0);
    assert.equal(f.inv.getAmount(I.OLD_SCHOOL_BOND_UNTRADEABLE_), 1);
  });
  await t.test("recheck mode after offer setup", async st => {
    const f = actor(null, st); open(f); await selectBuy(f, I.RUNE_SCIMITAR);
    const request = { player: f.p, mode: "ironman", handled: false };
    PM.emitCustomEvent("ironman:set-mode", request); assert.equal(request.handled, true);
    const coins = f.inv.getAmount(I.COINS); const { confirmations } = await confirm(f);
    assert.deepEqual(confirmations, [{ itemId: I.RUNE_SCIMITAR, sell: false }]);
    assert.equal(placed(f).length, 0); assert.equal(f.inv.getAmount(I.COINS), coins);
  });
  await t.test("ordinary accounts retain non-bond buying", async st => {
    const f = actor(null, st); open(f); await selectBuy(f, I.RUNE_SCIMITAR);
    const before = f.inv.getAmount(I.COINS); await confirm(f);
    assert.equal(placed(f).length, 1); assert.equal(f.inv.getAmount(I.COINS), before - placed(f)[0].total);
  });
  await t.test("ordinary accounts retain selling", async st => {
    const f = actor(null, st); open(f); await sell(f, I.RUNE_SCIMITAR);
    assert.equal(placed(f).length, 1); assert.equal(f.inv.getAmount(I.RUNE_SCIMITAR), 0);
  });
  await t.test("Ultimate bank collection refuses and inventory collection succeeds", async st => {
    const f = actor("ultimate", st); open(f); await selectBuy(f, I.OLD_SCHOOL_BOND);
    const { callbacks: timers } = await confirm(f); assert.equal(placed(f).length, 1); assert.equal(timers.length, 1);
    timers[0].callback(); assert.equal(placed(f)[0].finished, true);
    const bankBefore = banks(f), offerBefore = JSON.stringify(placed(f)), coins = f.inv.getAmount(I.COINS);
    await button(f, 6, 0, -1, 2);
    assert.deepEqual(banks(f), bankBefore); assert.equal(JSON.stringify(placed(f)), offerBefore);
    assert.equal(f.inv.getAmount(I.COINS), coins);
    assert.equal(placed(f).length, 1, "bank refusal preserves offer");
    assert.equal(f.inv.getAmount(I.OLD_SCHOOL_BOND_UNTRADEABLE_), 0);
    await button(f, 6);
    assert.equal(placed(f).length, 0); assert.equal(f.inv.getAmount(I.OLD_SCHOOL_BOND_UNTRADEABLE_), 1);
  });
  await t.test("standard Ironman can collect a bought bond into bank", async st => {
    const f = actor("ironman", st); open(f); await selectBuy(f, I.OLD_SCHOOL_BOND);
    const { callbacks: timers } = await confirm(f); assert.equal(timers.length, 1); timers[0].callback();
    await button(f, 6, 0, -1, 2);
    assert.equal(placed(f).length, 0);
    const tab = core.Bank.getTabForItem(f.p, I.OLD_SCHOOL_BOND);
    assert.equal(f.p.getBank(tab).getAmount(I.OLD_SCHOOL_BOND_UNTRADEABLE_), 1);
  });
  await t.test("Ultimate collection box cannot bank an already completed bond", async st => {
    const f = actor("ultimate", st); open(f); await selectBuy(f, I.OLD_SCHOOL_BOND);
    const { callbacks: timers } = await confirm(f); assert.equal(timers.length, 1); timers[0].callback();
    PM.emitCommand({ player: f.p, raw: "gecollect", base: "gecollect", parts: ["gecollect"], handled: false });
    assert.equal(f.p.getInterfaceId(), 402);
    const bankBefore = banks(f), offerBefore = JSON.stringify(placed(f)), coins = f.inv.getAmount(I.COINS);
    await button(f, 4, 0, -1, 1, 402);
    assert.deepEqual(banks(f), bankBefore); assert.equal(JSON.stringify(placed(f)), offerBefore);
    assert.equal(f.inv.getAmount(I.COINS), coins);
    assert.equal(placed(f).length, 1, "bank collection retains the offer");
    await button(f, 3, 0, -1, 1, 402);
    assert.equal(placed(f).length, 0); assert.equal(f.inv.getAmount(I.OLD_SCHOOL_BOND_UNTRADEABLE_), 1);
  });
  await t.test("full inventory retains a completed bond offer", async st => {
    const f = actor("ironman", st); open(f); await selectBuy(f, I.OLD_SCHOOL_BOND);
    const { callbacks: timers } = await confirm(f); assert.equal(timers.length, 1); timers[0].callback();
    for (let slot = 1; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.TINDERBOX, 1));
    assert.equal(f.inv.getFreeSlots(), 0);
    await button(f, 6);
    assert.equal(placed(f).length, 1); assert.equal(f.inv.getAmount(I.OLD_SCHOOL_BOND_UNTRADEABLE_), 0);
    f.inv.setItem(1, new core.Item(-1, 0));
    await button(f, 6);
    assert.equal(placed(f).length, 0); assert.equal(f.inv.getAmount(I.OLD_SCHOOL_BOND_UNTRADEABLE_), 1);
  });
  await t.test("locked PIN guards entry and resumes a legal purchase", async st => {
    const f = actor("ironman", st);
    const pin = require("../plugins/interface/bankpin/Common.BankPin");
    f.p.setAttribute("bank-pin:hash", pin.hash(f.p, "2468"));
    PM.emitCommand({ player: f.p, raw: "ge", base: "ge", parts: ["ge"], handled: false });
    assert.equal(f.p.getInterfaceId(), 213, "actual PIN keypad opens before the GE");
    const answer = f.p.getEnteredAmountAction();
    assert.ok(answer, "keypad owns the active amount action");
    answer.execute(2468);
    for (let i = 0; i < 3; i++) core.TaskManager.process();
    assert.equal(f.p.getInterfaceId(), 465, "correct PIN resumes GE");
    await selectBuy(f, I.OLD_SCHOOL_BOND); await confirm(f);
    assert.equal(placed(f).length, 1, "legal purchase after PIN");
  });
});
