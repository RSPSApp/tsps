// Run after `yarn build`: node --test tests/lunar-potion-share.test.cjs
// Stat Restore Pot Share and Boost Potion Share (PR 1942 review): every drinker passes the rules a
// normal drink does, and the spell needs another player, whose doses are the only ones it uses.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Skill } = require("../dist/game/model/Skill");
const { Spell } = require("../dist/game/content/combat/magic/Spell");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
const Potions = require("../plugins/items/Potions.plugin");

/** Players a duel's No Drinks rule covers, as DuelArena's canDrink hook answers for them. */
const noDrinks = new Set();
let share;
let core;
before(async () => {
  await CachePipeline.initialize(process.cwd());
  core = PluginManager.getCoreApi();
  const api = {
    core,
    emitCanDrink: (player) => (noDrinks.has(player) ? false : undefined),
    onCustomEvent: (name, handler) => { if (name === "potions:share") share = handler; },
  };
  Potions.register(new Proxy(api, { get: (object, key) => object[key] ?? (() => {}) }));
});

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
  share(event);
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
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => { if (name === "potions:share") share(event); });
  t.mock.method(caster.player.getSkillManager(), "addExperiences", () => { throw new Error("no XP for a refused cast"); });
  assert.equal(LunarSpells.handleItemTarget(caster.player, core.ItemIdentifiers.PRAYER_POTION_1_, 0, "Stat Restore Pot Share"), true);
  assert.equal(paid, 0);
  assert.deepEqual(caster.messages, ["There is nobody nearby to share your potion with."]);
  assert.equal(caster.prayer(), 0);
});
