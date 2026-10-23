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
    });
  }
}
