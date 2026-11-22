// Run after `yarn build`: node --test tests/lunar-potion-share.test.cjs
// Stat Restore Pot Share and Boost Potion Share (PR 1942 review): every drinker passes the rules a
// normal drink does, and the spell needs another player, whose doses are the only ones it uses.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, after, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const { Skill } = require("../dist/game/model/Skill");
const { Spell } = require("../dist/game/content/combat/magic/Spell");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Grouping = require("../plugins/interface/Grouping.plugin");
const Potions = require("../plugins/items/Potions.plugin");
const groups = Grouping._test.Store;

/** Players a duel's No Drinks rule covers, as DuelArena's canDrink hook answers for them. */
const noDrinks = new Set();
const core = PluginManager.getCoreApi();
const { CacheDefinitions, Item, ItemIdentifiers: items, Location, MagicSpellbook, Misc } = core;
let groupDir;
let castleWars;
before(async () => {
  groupDir = fs.mkdtempSync(path.join(os.tmpdir(), "lunar-potion-share-"));
  process.env[groups.FILE_ENV] = path.join(groupDir, "groups.json");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Grouping.register(PluginManager.createApi("GroupingTest"));
  Potions.register(PluginManager.createApi("PotionsTest"));
  const castleApi = PluginManager.createApi("CastleWarsTest");
  castleWars = require("../plugins/minigames/castlewars/Game.CastleWars")(castleApi);
  require("../plugins/minigames/castlewars/Areas.CastleWars")(castleApi, castleWars);
  PluginManager.createApi("DuelTest").onCanDrink((event) => {
    if (noDrinks.has(event.player)) event.allow = false;
  });
});
after(() => fs.rmSync(groupDir, { recursive: true, force: true }));

/** A player at 0 of 99 Prayer, holding `potion` in slot 0. */
function drinker(t, potion = null) {
  const player = new Player(null), messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(player, "getPacketSender", () => sender);
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  player.getSkillManager().setMaxLevel(Skill.PRAYER, 99);
  player.getSkillManager().setCurrentLevel(Skill.PRAYER, 0, false);
  if (potion !== null) player.getInventory().setItem(0, new core.Item(potion, 1));
  return { player, messages, prayer: () => player.getSkillManager().getCurrentLevel(Skill.PRAYER) };
}

const request = (caster, targets) => {
  const event = { player: caster.player, slot: 0, kind: "restore", targets: targets.map((target) => target.player), valid: false, message: null, apply: null };
  PluginManager.emitCustomEvent("potions:share", event);
  return event;
};
const potion = (caster) => caster.player.getInventory().getItems()[0].getId();

test("a caster alone is refused: no recipient, no dose used, no free effect", (t) => {
  const caster = drinker(t, core.ItemIdentifiers.PRAYER_POTION_1_);
  const event = request(caster, []);
  assert.equal(event.valid, false);
  assert.equal(event.message, "There is nobody nearby to share your potion with.");
  assert.equal(potion(caster), core.ItemIdentifiers.PRAYER_POTION_1_);
  assert.equal(caster.prayer(), 0);
});

test("a caster under a duel's No Drinks rule is refused before the spell is paid for", (t) => {
  const caster = drinker(t, core.ItemIdentifiers.PRAYER_POTION_1_), friend = drinker(t);
  noDrinks.add(caster.player);
  try {
    const event = request(caster, [friend]);
    assert.equal(event.valid, false);
    assert.equal(event.message, "You cannot use potions here.");
    assert.equal(friend.prayer(), 0);
  } finally { noDrinks.delete(caster.player); }
});

test("a recipient under No Drinks gets nothing, and alone they don't count as a recipient", (t) => {
  const caster = drinker(t, core.ItemIdentifiers.PRAYER_POTION_4_), duellist = drinker(t), friend = drinker(t);
  noDrinks.add(duellist.player);
  try {
    assert.equal(request(caster, [duellist]).valid, false, "nobody eligible");
    const event = request(caster, [duellist, friend]);
    assert.equal(event.valid, true);
    event.apply();
    assert.equal(duellist.prayer(), 0);
    assert.equal(friend.prayer(), 31);
    assert.equal(caster.prayer(), 31, "the caster drinks one free");
    assert.equal(potion(caster), core.ItemIdentifiers.PRAYER_POTION_3_, "only the friend's dose is used");
  } finally { noDrinks.delete(duellist.player); }
});

test("the spell isn't paid for when the share is refused", (t) => {
  const caster = drinker(t, core.ItemIdentifiers.PRAYER_POTION_1_);
  let paid = 0;
  t.mock.method(Spell.prototype, "canCast", () => { paid++; return true; });
  t.mock.method(caster.player.getSkillManager(), "addExperiences", () => { throw new Error("no XP for a refused cast"); });
  assert.equal(LunarSpells.handleItemTarget(caster.player, core.ItemIdentifiers.PRAYER_POTION_1_, 0, "Stat Restore Pot Share"), true);
  assert.equal(paid, 0);
  assert.deepEqual(caster.messages, ["There is nobody nearby to share your potion with."]);
  assert.equal(caster.prayer(), 0);
});

/** A private world (as PrivateArea is: an area with its own objects), e.g. one solo Colosseum run. */
const instance = (name) => ({ name, getObjects: () => [], getName: () => name });
const { World } = require("../dist/game/World");

/** Casts Stat Restore Pot Share for `caster` with `others` as the world's players, paying always. */
function castShare(t, caster, others) {
  caster.player.getSkillManager().setMaxLevel(Skill.DEFENCE, 99);
  t.mock.method(World, "getPlayers", () => [caster.player, ...others.map((other) => other.player)]);
  t.mock.method(Spell.prototype, "canCast", () => true);
  return LunarSpells.handleItemTarget(caster.player, potion(caster), 0, "Stat Restore Pot Share");
}

test("a player on the same tile in another instance is not a recipient", (t) => {
  const caster = drinker(t, core.ItemIdentifiers.PRAYER_POTION_4_), stranger = drinker(t);
  caster.player.setArea(instance("run A"));
  stranger.player.setArea(instance("run B"));
  assert.equal(caster.player.getLocation().equals(stranger.player.getLocation()), true, "same coordinates");
  castShare(t, caster, [stranger]);
  assert.deepEqual(caster.messages, ["There is nobody nearby to share your potion with."]);
  assert.equal(stranger.prayer(), 0);
  assert.equal(caster.prayer(), 0);
  assert.equal(potion(caster), core.ItemIdentifiers.PRAYER_POTION_4_);
});

test("a player in the same instance still shares", (t) => {
  const caster = drinker(t, core.ItemIdentifiers.PRAYER_POTION_4_), partner = drinker(t), run = instance("run A");
  caster.player.setArea(run);
  partner.player.setArea(run);
  castShare(t, caster, [partner]);
  assert.equal(partner.prayer(), 31);
  assert.equal(caster.prayer(), 31);
  assert.equal(potion(caster), core.ItemIdentifiers.PRAYER_POTION_3_);
});

test("a targeted Lunar spell ignores a player in another instance", (t) => {
  const caster = drinker(t), stranger = drinker(t);
  caster.player.setArea(instance("run A"));
  stranger.player.setArea(instance("run B"));
  t.mock.method(Spell.prototype, "canCast", () => { throw new Error("must not cast"); });
  assert.equal(LunarSpells.handlePlayerTarget(caster.player, stranger.player, "Heal Other"), false);
});

function scene(t) {
  const online = [];
  t.mock.method(World, "getPlayers", () => online);
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  return function player(name, x = 3200, y = 3200, acceptsAid = false) {
    const session = new PlayerSession(channel);
    const account = new Player(session, new Location(x, y, 0));
    account.setUsername(name);
    account.setIndex(online.push(account));
    account.setRegistered(true);
    account.setAttribute("accept-aid", acceptsAid);
    session.setPlayer(account);
    return account;
  };
}

function makeGroup(leader, members, ironman) {
  const now = Date.now();
  const id = (player) => Misc.stringToLongBigInt(player.getUsername());
  const group = groups.create(leader.getProfile(), id(leader), now, ironman);
  for (const member of members) groups.addMember(group, id(member), now);
  groups.reset();
}

function potionCast(player, name, potion, amount = 1) {
  const spell = CacheDefinitions.getSpellByName(name);
  const { runes } = CacheDefinitions.getSpellRequirements(name);
  const inventory = player.getInventory();
  inventory.setItem(0, new Item(potion, amount));
  runes.forEach((rune, index) => inventory.setItem(index + 1, new Item(rune.id, rune.amount)));
  player.setSpellbook(MagicSpellbook.LUNAR);
  const skills = player.getSkillManager();
  for (const skill of [Skill.DEFENCE, Skill.MAGIC]) skills.setMaxLevel(skill, 99).setCurrentLevel(skill, 99, false);

  const connection = new ClientConnection(player.getSession().getChannel());
  connection.player = player;
  const initialXp = skills.getExperience(Skill.MAGIC);
  async function queue(slot = 0) {
    await connection.dispatch([{
      type: "widget_target", targetWidgetId: 149 << 16, targetSlot: slot, targetItemId: potion,
      sourceWidgetId: spell.widgetId, sourceSlot: -1, sourceItemId: spell.itemId,
    }]);
  }
  return {
    runes,
    queue,
    turn: () => connection.processTurnPackets(),
    async cast() {
      await queue();
      connection.processTurnPackets();
    },
    assertUnspent() {
      assert.deepEqual([inventory.getItems()[0].getId(), inventory.getItems()[0].getAmount()], [potion, amount]);
      for (const rune of runes) assert.equal(inventory.getAmount(rune.id), rune.amount);
      assert.equal(skills.getExperience(Skill.MAGIC), initialXp);
    },
  };
}

for (const [name, full, remaining, skill, start, result] of [
  ["Stat Restore Pot Share", items.PRAYER_POTION_4_, items.PRAYER_POTION_2_, Skill.PRAYER, 10, 32],
  ["Boost Potion Share", items.ATTACK_POTION_4_, items.ATTACK_POTION_2_, Skill.ATTACK, 60, 69],
]) {
  test(name + " reaches a teammate with Accept Aid off and a nearby player with it on", async (t) => {
    const player = scene(t);
    const caster = player("cast " + name[0]);
    const outsider = player("outsider " + name[0], 3201, 3200);
    const teammate = player("mate " + name[0], 3202, 3202);
    const tooFar = player("far " + name[0], 3203, 3202);
    const willing = player("willing " + name[0], 3200, 3200, true);
    makeGroup(caster, [teammate, tooFar], true);
    for (const account of [caster, teammate, tooFar, outsider, willing]) {
      account.getSkillManager().setMaxLevel(skill, 60).setCurrentLevel(skill, start, false);
    }
    const { cast, runes } = potionCast(caster, name, full);
    await cast();

    const level = (account) => account.getSkillManager().getCurrentLevel(skill);
    assert.equal(level(teammate), result, "the teammate is eligible at the corner of the 5x5 area");
    assert.equal(level(willing), result, "a player who accepts aid still shares the potion");
    assert.equal(level(caster), result, "the caster receives the free dose");
    assert.equal(level(outsider), start, "Accept Aid off still excludes outsiders");
    assert.equal(level(tooFar), start, "shared group membership does not extend the spell range");
    assert.equal(caster.getInventory().getItems()[0].getId(), remaining, "two recipients cost two doses");
    for (const { id } of runes) assert.equal(caster.getInventory().getAmount(id), 0);
  });
}

test("an ordinary group does not bypass Accept Aid or spend any supplies", async (t) => {
  const player = scene(t);
  const caster = player("normal cast");
  const teammate = player("normal mate");
  makeGroup(caster, [teammate], false);
  const potion = items.PRAYER_POTION_4_;
  const { cast, runes } = potionCast(caster, "Stat Restore Pot Share", potion);
  await cast();
  assert.equal(caster.getInventory().getItems()[0].getId(), potion);
  for (const { id, amount } of runes) assert.equal(caster.getInventory().getAmount(id), amount);
});

for (const [name, noted, skill, start] of [
  ["Stat Restore Pot Share", items.PRAYER_POTION_2__2, Skill.PRAYER, 10],
  ["Boost Potion Share", items.SUPER_COMBAT_POTION_2__2, Skill.ATTACK, 60],
]) {
  for (const amount of [1, 5]) {
    test(`${name} preserves a stack of ${amount} potion banknotes with a teammate in range`, async (t) => {
      const player = scene(t);
      const caster = player(`note ${name[0]}${amount}`);
      const mate = player(`mate ${name[0]}${amount}`);
      makeGroup(caster, [mate], true);
      for (const account of [caster, mate]) account.getSkillManager().setMaxLevel(skill, 60).setCurrentLevel(skill, start, false);
      const action = potionCast(caster, name, noted, amount);
      assert.equal(new Item(noted, 1).getDefinition().isNoted(), true);
      await action.cast();
      action.assertUnspent();
      for (const account of [caster, mate]) assert.equal(account.getSkillManager().getCurrentLevel(skill), start);
    });
  }
}

test("Stat Restore Pot Share gives the recorded refusal for an incompatible potion", async (t) => {
  const player = scene(t);
  const caster = player("wrong pot");
  player("willing pot", 3200, 3200, true);
  const messages = [];
  t.mock.method(caster, "sendMessage", (message) => messages.push(message));
  // rsprox 4103 ticks 761–762 targets this item ID.
  const action = potionCast(caster, "Stat Restore Pot Share", items.EXTREME_ENERGY_POTION_4_);
  await action.cast();
  action.assertUnspent();
  assert.deepEqual(messages, ["You cannot use the spell on that object."]);
});

test("Castle Wars refuses Boost Potion Share by either aid route during the match", async (t) => {
  const player = scene(t);
  const caster = player("match cast", 2400, 3100);
  const mate = player("match mate", 2401, 3100);
  makeGroup(caster, [mate], true);
  const sides = [[caster, castleWars.TEAM.SARADOMIN], [mate, castleWars.TEAM.ZAMORAK]];
  for (const [account, team] of sides) {
    account.setArea(castleWars.gameArea);
    castleWars.setTeamId(account, team);
    account.getSkillManager().setMaxLevel(Skill.ATTACK, 60).setCurrentLevel(Skill.ATTACK, 60, false);
  }
  t.mock.method(castleWars, "isPlaying", (account) => account === caster || account === mate);
  const messages = [];
  t.mock.method(caster, "sendMessage", (message) => messages.push(message));
  const action = potionCast(caster, "Boost Potion Share", items.ATTACK_POTION_1_);
  for (const acceptsAid of [false, true]) {
    mate.setAttribute("accept-aid", acceptsAid);
    await action.cast();
    action.assertUnspent();
    for (const [account] of sides) assert.equal(account.getSkillManager().getCurrentLevel(Skill.ATTACK), 60);
  }
  assert.deepEqual(messages, Array(2).fill("You don't want to help your enemies"));
});

test("a full animation stall holds only the latest potion-share click until release", async (t) => {
  const player = scene(t);
  const caster = player("stall cast");
  const mate = player("stall mate", 3200, 3200, true);
  mate.getSkillManager().setMaxLevel(Skill.PRAYER, 60).setCurrentLevel(Skill.PRAYER, 10, false);
  const potion = items.PRAYER_POTION_2_;
  const action = potionCast(caster, "Stat Restore Pot Share", potion);
  caster.getInventory().setItem(5, new Item(potion, 1));
  let cycle = 100;
  t.mock.method(World, "getProcessCycle", () => cycle);
  caster.getCombat().setAnimationStall(2);
  await action.queue();
  await action.queue(5);
  action.turn();
  action.assertUnspent();
  assert.equal(mate.getSkillManager().getCurrentLevel(Skill.PRAYER), 10);
  cycle += 2;
  action.turn();
  assert.equal(caster.getInventory().getItems()[0].getId(), potion);
  assert.equal(caster.getInventory().getItems()[5].getId(), items.PRAYER_POTION_1_);
  assert.equal(mate.getSkillManager().getCurrentLevel(Skill.PRAYER), 32);
});

test("a potion-share click during the death task grants no effect and spends nothing", async (t) => {
  const player = scene(t);
  const caster = player("dying cast");
  const mate = player("dying mate", 3200, 3200, true);
  mate.getSkillManager().setMaxLevel(Skill.PRAYER, 60).setCurrentLevel(Skill.PRAYER, 10, false);
  const action = potionCast(caster, "Stat Restore Pot Share", items.PRAYER_POTION_2_);
  const queue = caster.getCombat().getHitQueue();
  queue.addPendingDamage([new HitDamage(caster.getHitpoints(), HitMask.RED)]);
  queue.process(World.getProcessCycle());
  assert.equal(caster.getHitpoints(), 0);
  assert.equal(caster.isDyingReturn(), true);
  t.after(() => core.TaskManager.cancelTasks(caster.getIndex()));
  await action.cast();
  action.assertUnspent();
  assert.equal(mate.getSkillManager().getCurrentLevel(Skill.PRAYER), 10);
});
