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

test("no Grand Exchange for an Ironman", () => {
  const request = { player: account("iron", "ironman"), allow: true, message: null };
  custom["grand-exchange:can-open"](request);
  assert.equal(request.allow, false);
  const main = { player: account("main"), allow: true, message: null };
  custom["grand-exchange:can-open"](main);
  assert.equal(main.allow, true);
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
