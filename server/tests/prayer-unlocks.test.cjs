// Run after `yarn build`: node --test tests/prayer-unlocks.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PrayerData } = require("../dist/game/content/PrayerHandler");
const { ItemIds } = require("../dist/util/IdEnums");

const plugin = require("../plugins/skills/PrayerUnlocks.plugin");

let loginHook = null;
let prayerDisabledHook = null;
const itemActions = new Map();
let defaultAttributes = [];
let prompt = null;
let bypassHook = null;

plugin.register({
  core: { PrayerData, ItemIdentifiers: ItemIds },
  persistAttribute(key, value) { defaultAttributes.push([key, value]); },
  onPlayerLogin(handler) { loginHook = handler; },
  onPrayerDisabled(handler) { prayerDisabledHook = handler; },
  onItemAction(name, actions) { itemActions.set(name, actions); },
  emitCustomEvent(name, event) { if (name === "prayer:unlocks-bypass" && bypassHook) bypassHook(event); },
  sendMultiChatboxPrompt(player, title, ...pairs) {
    prompt = { player, title, options: [] };
    for (let i = 0; i < pairs.length; i += 2) {
      prompt.options.push({ text: pairs[i], callback: pairs[i + 1] });
    }
    return true;
  },
});

function player({ attributes = {}, items = [] } = {}) {
  const attrs = new Map(Object.entries(attributes));
  const varbits = [];
  const messages = [];
  const inventory = items.slice();
  return {
    attrs,
    varbits,
    messages,
    inventory,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => ({
      contains: (id) => inventory.includes(id),
      deleteNumber(id) {
        const index = inventory.indexOf(id);
        if (index !== -1) inventory.splice(index, 1);
      },
    }),
    getPacketSender: () => ({ sendVarbit: (id, value) => varbits.push([id, value]) }),
    sendMessage: (text) => messages.push(text),
  };
}

function denied(prayer, p) {
  const event = { player: p, prayer: PrayerData[prayer] };
  prayerDisabledHook(event);
  return event;
}

function read(name, p, itemId) {
  const action = itemActions.get(name)?.Read;
  assert.ok(action, `${name} has a Read action`);
  assert.equal(action({ player: p, itemId }), true);
}

test("the five prayers are locked until their own unlock is earned", () => {
  const p = player();
  for (const prayer of ["CHIVALRY", "PIETY", "RIGOUR", "AUGURY", "PRESERVE"]) {
    assert.equal(denied(prayer, p).disabled, true, prayer);
  }
});

test("player bots keep the prayers their loadouts assume", () => {
  const bot = player();
  bot.isPlayerBot = () => true;
  for (const prayer of ["CHIVALRY", "PIETY", "RIGOUR", "AUGURY", "PRESERVE"]) {
    assert.notEqual(denied(prayer, bot).disabled, true, prayer);
  }
});

test("a minigame that hands out the prayers can bypass the unlock", () => {
  const p = player();
  assert.equal(denied("RIGOUR", p).disabled, true);
  bypassHook = (event) => { event.bypass = true; };
  try {
    assert.notEqual(denied("RIGOUR", p).disabled, true);
    assert.notEqual(denied("CHIVALRY", p).disabled, true);
  } finally {
    bypassHook = null;
  }
});

test("Chivalry and Piety need King's Ransom, not just Prayer and Defence", () => {
  const locked = player({ attributes: { "quest.kings_ransom.stage": 80 } });
  assert.equal(denied("CHIVALRY", locked).disabled, true);
  assert.equal(denied("PIETY", locked).disabled, true);
  assert.equal(denied("PIETY", locked).message, "Complete King's Ransom to unlock Piety.");

  const complete = player({ attributes: { "quest.kings_ransom.stage": 85 } });
  assert.notEqual(denied("CHIVALRY", complete).disabled, true);
  assert.notEqual(denied("PIETY", complete).disabled, true);
});

test("reading a dexterous scroll unlocks Rigour, consumes it and syncs the varbit", () => {
  const p = player({ items: [ItemIds.DEXTEROUS_PRAYER_SCROLL, ItemIds.SHARK] });
  read("Dexterous prayer scroll", p, ItemIds.DEXTEROUS_PRAYER_SCROLL);

  assert.match(prompt.title, /archaic invocation of the gods/);
  const learn = prompt.options.find((option) => option.text === "Learn Rigour");
  assert.ok(learn);
  assert.equal(denied("RIGOUR", p).disabled, true, "not unlocked until the prompt is answered");

  learn.callback(p);
  assert.equal(p.getAttribute("prayer:rigour-unlocked"), true);
  assert.deepEqual(p.inventory, [ItemIds.SHARK], "the scroll is consumed");
  assert.deepEqual(p.varbits, [[5451, 1]]);
  assert.deepEqual(p.messages, ["You study the scroll and learn a new prayer: Rigour"]);
  assert.notEqual(denied("RIGOUR", p).disabled, true);
});

test("the arcane and torn scrolls unlock Augury and Preserve", () => {
  for (const [name, item, attribute, varbit, prayer] of [
    ["Arcane prayer scroll", ItemIds.ARCANE_PRAYER_SCROLL, "prayer:augury-unlocked", 5452, "AUGURY"],
    ["Torn prayer scroll", ItemIds.TORN_PRAYER_SCROLL, "prayer:preserve-unlocked", 5453, "PRESERVE"],
  ]) {
    const p = player({ items: [item] });
    read(name, p, item);
    prompt.options.find((option) => option.text.startsWith("Learn ")).callback(p);
    assert.equal(p.getAttribute(attribute), true, name);
    assert.deepEqual(p.varbits, [[varbit, 1]], name);
    assert.notEqual(denied(prayer, p).disabled, true, name);
  }
});

test("a learned scroll is not consumed again", () => {
  prompt = null;
  const p = player({ attributes: { "prayer:preserve-unlocked": true }, items: [ItemIds.TORN_PRAYER_SCROLL] });
  read("Torn prayer scroll", p, ItemIds.TORN_PRAYER_SCROLL);
  assert.equal(prompt, null, "no prompt");
  assert.equal(p.inventory.length, 1, "the scroll stays");
  assert.match(p.messages.at(-1), /nothing more for you to learn/);
});

test("logging in sends the three unlock varbits", () => {
  const p = player({
    attributes: { "prayer:rigour-unlocked": true, "prayer:augury-unlocked": false },
  });
  loginHook({ player: p });
  assert.deepEqual(p.varbits, [[5453, 0], [5451, 1], [5452, 0]]);
});

test("the plugin starts every unlock locked", () => {
  assert.deepEqual(defaultAttributes, [
    ["prayer:preserve-unlocked", false],
    ["prayer:rigour-unlocked", false],
    ["prayer:augury-unlocked", false],
  ]);
});
