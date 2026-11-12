// Run after `yarn build`: node --test tests/prayer-deadeye-mystic-vigour.test.cjs
// Deadeye and Mystic Vigour (Wiki): scroll upgrades of Eagle Eye and Mystic Might.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PrayerData, PrayerHandler } = require("../dist/game/content/PrayerHandler");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { DamageFormulas } = require("../dist/game/content/combat/formula/DamageFormulas");
const { ItemIds } = require("../dist/util/IdEnums");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Skill } = require("../dist/game/model/Skill");

const plugin = require("../plugins/skills/PrayerUnlocks.plugin");

const PRAYER_MYSTICMIGHT = 4127;
const PRAYER_EAGLEEYE = 4126;
const PRAYER_DEADEYE = 16090;
const PRAYER_MYSTICVIGOUR = 16091;
const DEADEYE_UNLOCKED = 16097;
const MYSTIC_VIGOUR_UNLOCKED = 16098;

const itemActions = new Map();
let prayerDisabledHook = null;
let prompt = null;
plugin.register({
  core: { PrayerData, PrayerHandler, ItemIdentifiers: ItemIds, Skill },
  persistAttribute() {},
  onPlayerLogin() {},
  onPrayerDisabled(handler) { prayerDisabledHook = handler; },
  onCustomEvent() {},
  onItemAction(name, actions) { itemActions.set(name, actions); },
  emitCustomEvent() {},
  sendMultiChatboxPrompt(player, title, ...pairs) {
    prompt = { title, options: [] };
    for (let i = 0; i < pairs.length; i += 2) prompt.options.push({ text: pairs[i], callback: pairs[i + 1] });
    return true;
  },
});

/** A real Player with its packets, messages and sounds recorded. */
function nativePlayer(t, { prayer = 99, attributes = {}, items = [] } = {}) {
  const player = new Player(null);
  const varbits = [];
  const messages = [];
  const sender = new Proxy({}, {
    get: (_target, name) => (...args) => {
      if (name === "sendVarbit") varbits.push([args[0], args[1]]);
      return sender;
    },
  });
  t.mock.method(player, "getPacketSender", () => sender);
  t.mock.method(player, "sendMessage", (text) => messages.push(text));
  player.setRegistered(true);
  player.getSkillManager().setMaxLevel(Skill.PRAYER, prayer, false);
  player.getSkillManager().setCurrentLevel(Skill.PRAYER, prayer, false);
  player.getSkillManager().setMaxLevel(Skill.DEFENCE, 99, false);
  player.getSkillManager().setCurrentLevel(Skill.DEFENCE, 99, false);
  for (const [key, value] of Object.entries(attributes)) player.setAttribute(key, value);
  // The scroll's slot only; the real container needs the cache's item definitions.
  const inventory = items.slice();
  t.mock.method(player, "getInventory", () => ({
    contains: (id) => inventory.includes(id),
    deleteNumber(id) {
      const index = inventory.indexOf(id);
      if (index !== -1) inventory.splice(index, 1);
    },
  }));
  return { player, varbits, messages };
}

const vigour = { "prayer:mystic-vigour-unlocked": true };
const deadeye = { "prayer:deadeye-unlocked": true };

test("the scrolls teach Deadeye and Mystic Vigour without locking Eagle Eye or Mystic Might", (t) => {
  for (const [name, item, attribute, varbit, learn] of [
    ["Deadeye prayer scroll", ItemIds.DEADEYE_PRAYER_SCROLL, "prayer:deadeye-unlocked", DEADEYE_UNLOCKED, "Learn Deadeye"],
    ["Mystic vigour prayer scroll", ItemIds.MYSTIC_VIGOUR_PRAYER_SCROLL, "prayer:mystic-vigour-unlocked", MYSTIC_VIGOUR_UNLOCKED, "Learn Mystic Vigour"],
  ]) {
    const { player, varbits, messages } = nativePlayer(t, { items: [item] });
    for (const prayer of ["EAGLE_EYE", "MYSTIC_MIGHT"]) {
      const event = { player, prayer: PrayerData[prayer] };
      prayerDisabledHook(event);
      assert.notEqual(event.disabled, true, `${prayer} needs no scroll`);
    }
    prompt = null;
    assert.equal(itemActions.get(name).Read({ player, itemId: item }), true);
    assert.match(prompt.title, /archaic invocation of the gods/);
    prompt.options.find((option) => option.text === learn).callback();
    assert.equal(player.getAttribute(attribute), true, name);
    assert.equal(player.getInventory().contains(item), false, "the scroll is consumed");
    assert.deepEqual(varbits, [[varbit, 1]], name);
    assert.equal(messages.at(-1), `You study the scroll and learn a new prayer: ${learn.slice(6)}`);
  }
});

test("below 62 / 63 Prayer the scroll can't be read, so Eagle Eye and Mystic Might stay (Wiki)", (t) => {
  for (const [name, item, slot, level, text] of [
    ["Deadeye prayer scroll", ItemIds.DEADEYE_PRAYER_SCROLL, "EAGLE_EYE", 61,
      "You need a Prayer level of at least 62 to learn Deadeye."],
    ["Mystic vigour prayer scroll", ItemIds.MYSTIC_VIGOUR_PRAYER_SCROLL, "MYSTIC_MIGHT", 62,
      "You need a Prayer level of at least 63 to learn Mystic Vigour."],
  ]) {
    const { player, varbits, messages } = nativePlayer(t, { prayer: level, items: [item] });
    prompt = null;
    assert.equal(itemActions.get(name).Read({ player, itemId: item }), true);
    assert.equal(prompt, null, `${name}: no prompt`);
    assert.deepEqual(messages, [text]);
    assert.equal(player.getInventory().contains(item), true, "the scroll stays");
    assert.deepEqual(varbits, []);
    assert.equal(PrayerHandler.canUse(player, PrayerData[slot], true), true, `${slot} still usable`);
  }
});

test("Mystic Might's slot sends prayer_mysticvigour after prayer_mysticmight once learnt (rsprox recs 3273, 3276)", (t) => {
  const { player, varbits } = nativePlayer(t, { attributes: vigour });
  PrayerHandler.activatePrayerPrayerId(player, PrayerHandler.MYSTIC_MIGHT);
  const on = varbits.filter(([id]) => id === PRAYER_MYSTICMIGHT || id === PRAYER_MYSTICVIGOUR);
  assert.deepEqual(on, [[PRAYER_MYSTICMIGHT, 1], [PRAYER_MYSTICVIGOUR, 1]]);
  assert.equal(PrayerHandler.mysticVigourActive(player), true);

  varbits.length = 0;
  PrayerHandler.deactivatePrayer(player, PrayerHandler.MYSTIC_MIGHT);
  const off = varbits.filter(([id]) => id === PRAYER_MYSTICMIGHT || id === PRAYER_MYSTICVIGOUR);
  assert.deepEqual(off, [[PRAYER_MYSTICMIGHT, 0], [PRAYER_MYSTICVIGOUR, 0]]);
  assert.equal(PrayerHandler.mysticVigourActive(player), false);
});

test("without the scroll Eagle Eye sends no Deadeye varbit and stays Eagle Eye", (t) => {
  const { player, varbits } = nativePlayer(t);
  PrayerHandler.activatePrayerPrayerId(player, PrayerHandler.EAGLE_EYE);
  assert.equal(PrayerHandler.isActivated(player, PrayerHandler.EAGLE_EYE), true);
  assert.equal(varbits.some(([id]) => id === PRAYER_DEADEYE), false);
  assert.equal(PrayerHandler.deadeyeActive(player), false);
  assert.equal(AccuracyFormulasDpsCalc.rangedAttackPrayerPercent(player), 115);
  assert.equal(DamageFormulas.rangedStrengthPrayerPercent(player), 115);
  assert.equal(AccuracyFormulasDpsCalc.defencePrayerPercent(player), 100);
});

test("Deadeye: +18% Ranged accuracy and strength, +5% Defence (Wiki); prayer_deadeye after prayer_eagleeye (rec 3279)", (t) => {
  const { player, varbits } = nativePlayer(t, { attributes: deadeye });
  PrayerHandler.activatePrayerPrayerId(player, PrayerHandler.EAGLE_EYE);
  assert.deepEqual(varbits.filter(([id]) => id === PRAYER_EAGLEEYE || id === PRAYER_DEADEYE),
    [[PRAYER_EAGLEEYE, 1], [PRAYER_DEADEYE, 1]]);
  assert.equal(AccuracyFormulasDpsCalc.rangedAttackPrayerPercent(player), 118);
  assert.equal(DamageFormulas.rangedStrengthPrayerPercent(player), 118);
  assert.equal(AccuracyFormulasDpsCalc.defencePrayerPercent(player), 105);
});

test("Mystic Vigour: +18% Magic accuracy and defence, +3% Magic damage, +5% Defence (Wiki)", (t) => {
  const { player } = nativePlayer(t, { attributes: vigour });
  PrayerHandler.activatePrayerPrayerId(player, PrayerHandler.MYSTIC_MIGHT);
  assert.equal(AccuracyFormulasDpsCalc.magicAttackPrayerPercent(player), 118);
  assert.equal(DamageFormulas.magicDamagePrayerPermille(player), 30);
  assert.equal(AccuracyFormulasDpsCalc.defencePrayerPercent(player), 105);

  const might = nativePlayer(t).player;
  PrayerHandler.activatePrayerPrayerId(might, PrayerHandler.MYSTIC_MIGHT);
  assert.equal(AccuracyFormulasDpsCalc.magicAttackPrayerPercent(might), 115);
  assert.equal(DamageFormulas.magicDamagePrayerPermille(might), 20);
});

test("their Defence boost stacks with Steel Skin, additively (Wiki)", (t) => {
  const { player } = nativePlayer(t, { attributes: { ...deadeye, ...vigour } });
  PrayerHandler.activatePrayerPrayerId(player, PrayerHandler.STEEL_SKIN);
  PrayerHandler.activatePrayerPrayerId(player, PrayerHandler.EAGLE_EYE);
  assert.equal(PrayerHandler.isActivated(player, PrayerHandler.STEEL_SKIN), true, "Deadeye leaves Steel Skin on");
  assert.equal(AccuracyFormulasDpsCalc.defencePrayerPercent(player), 120);
});

test("Deadeye needs 62 Prayer and Mystic Vigour 63 where their slot shows them (Wiki)", (t) => {
  const low = nativePlayer(t, { prayer: 62, attributes: vigour });
  assert.equal(PrayerHandler.canUse(low.player, PrayerData.MYSTIC_MIGHT, true), false);
  assert.deepEqual(low.messages, ["You need a Prayer level of at least 63 to use Mystic Vigour."]);
  const ok = nativePlayer(t, { prayer: 62, attributes: deadeye });
  assert.equal(PrayerHandler.canUse(ok.player, PrayerData.EAGLE_EYE, true), true);
  const plain = nativePlayer(t, { prayer: 45 });
  assert.equal(PrayerHandler.canUse(plain.player, PrayerData.MYSTIC_MIGHT, true), true, "Mystic Might keeps its 45");
});

test("learning Deadeye with Eagle Eye already on lights the Deadeye varbit", (t) => {
  const { player, varbits } = nativePlayer(t, { items: [ItemIds.DEADEYE_PRAYER_SCROLL] });
  PrayerHandler.activatePrayerPrayerId(player, PrayerHandler.EAGLE_EYE);
  varbits.length = 0;
  itemActions.get("Deadeye prayer scroll").Read({ player, itemId: ItemIds.DEADEYE_PRAYER_SCROLL });
  prompt.options.find((option) => option.text === "Learn Deadeye").callback();
  assert.deepEqual(varbits, [[DEADEYE_UNLOCKED, 1], [PRAYER_DEADEYE, 1]]);
});
