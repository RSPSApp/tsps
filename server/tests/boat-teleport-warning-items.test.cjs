// Run after `yarn build`: node --test tests/boat-teleport-warning-items.test.cjs
// All Settings "Show warning when teleporting from your boat at sea" (471) for every kind of teleport the player picks:
// tablets and scrolls, jewellery and the other teleport items, capes, quest items and the spells outside the spell
// engine. Aboard your boat with the row on, each asks first and uses nothing up until the player says yes; with the
// row off, or ashore, each goes at once. Real engine: every plugin loaded, a real Player, the items' own handlers
// through PluginManager.emitItemAction and the real multi-choice prompt.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const TeleportWarning = require("../plugins/skills/sailing/TeleportWarning.Sailing");

let core;
let I;
let next = 9620;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const START = [3200, 3200, 0];

/** A player at sea aboard their boat (with `aboard`), the warning row on (with `warning`). */
function actor(t, { aboard = true, warning = true } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("boatwarn" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  core.RegionManager.loadMapFiles(START[0], START[1]);
  p.setLocation(new core.Location(...START));
  p.needsPlacement = false;
  const conn = new ClientConnection(channel);
  conn.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  const state = { aboard };
  const aboardOf = core.Sailing.instanceAboard;
  t.mock.method(core.Sailing, "instanceAboard", (player) => (player === p ? (state.aboard ? {} : undefined) : aboardOf.call(core.Sailing, player)));
  const teleports = [];
  const real = core.TeleportHandler.teleport;
  t.mock.method(core.TeleportHandler, "teleport", (...args) => {
    if (args[0] === p) {
      teleports.push(args[1]);
      state.aboard = false;
    }
    return real.apply(core.TeleportHandler, args);
  });
  if (warning) p.getPacketSender().sendVarbit(TeleportWarning.WARNING_VARBIT, 1);
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  return { t, p, conn, messages, state, teleports };
}

const pending = (f) => MultiChatboxPrompt.getPending(f.p);
const choose = (f, index) => MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: index });
const settle = (ticks = 12) => { for (let i = 0; i < ticks; i++) core.TaskManager.process(); };
const carried = (f) => [...f.p.getInventory().getItems(), ...f.p.getEquipment().getItems()]
  .map((item) => (item && item.getId() > 0 ? `${item.getId()}x${item.getAmount()}` : "")).join(",");

/** The item's inventory option (or, `worn`, an option the cache gives it worn), through the item action hooks. */
function use(f, itemId, option, { worn = false } = {}) {
  const slot = f.p.getInventory().getSlotForItemId(itemId);
  assert.ok(slot >= 0, `carries ${itemId}`);
  const clickType = (core.CacheDefinitions.getItem(itemId).inventoryActions ?? []).indexOf(option) + 1;
  assert.ok(worn || clickType > 0, `the cache's ${option} option on ${itemId}`);
  PM.emitItemAction({ player: f.p, itemId, slot, item: f.p.getInventory().getItems()[slot], option, clickType, handled: false });
}

/** Picks the first destination when the item opened its chat menu before the warning. */
function menu(f) {
  if (pending(f) && pending(f).title !== TeleportWarning.QUESTION) pick(f, /./);
}

/** The item's chat menu (a destination, before the warning): picks the option matching `pattern`. */
function pick(f, pattern) {
  const menu = pending(f);
  assert.ok(menu, "the destination menu");
  const index = menu.options.findIndex((option) => pattern.test(option));
  assert.notEqual(index, -1, menu.options.join(" | "));
  choose(f, index + 1);
}

const questComplete = (keys) => PM.createApi("BoatTeleportWarningQuests" + next).onCustomEvent("quest:is-complete", (query) => {
  if (keys.includes(query.key)) query.complete = true;
});

/**
 * Each teleport: `give` sets the player up (and returns the item to use), `start` begins it up to the point the
 * teleport would go, and `went` says whether it went (default: TeleportHandler.teleport ran).
 */
const CASES = [
  {
    name: "a teleport tablet", give: (f) => give(f, I.VARROCK_TELEPORT, 2), start: (f, id) => use(f, id, "Break"),
  },
  {
    name: "a teleport scroll", give: (f) => give(f, I.NARDAH_TELEPORT, 2), start: (f, id) => use(f, id, "Teleport"),
  },
  {
    name: "teleport jewellery (amulet of glory)", give: (f) => give(f, I.AMULET_OF_GLORY_4_),
    start: (f, id) => { use(f, id, "Rub"); pick(f, /^Edgeville/); },
  },
  {
    name: "a ring of wealth", give: (f) => give(f, I.RING_OF_WEALTH_5_),
    start: (f, id) => { use(f, id, "Rub"); pick(f, /^Grand Exchange/); },
  },
  {
    name: "a skill cape", give: (f) => { f.p.getSkillManager().setMaxLevel(core.Skill.CRAFTING, 99); return give(f, I.CRAFTING_CAPE); },
    start: (f, id) => use(f, id, "Teleport"),
  },
  {
    name: "the music cape", give: (f) => {
      f.t.mock.method(require("../plugins/world/Progress.Music"), "allUnlocked", () => true);
      return give(f, I.MUSIC_CAPE);
    },
    start: (f, id) => use(f, id, "Teleport"),
  },
  {
    name: "a diary cloak", give: (f) => give(f, I.ARDOUGNE_CLOAK_1), start: (f, id) => use(f, id, "Monastery Teleport"),
  },
  {
    name: "the Amulet of the Eye", give: (f) => give(f, I.AMULET_OF_THE_EYE), start: (f, id) => use(f, id, "Teleport"),
  },
  {
    name: "the ectophial", give: (f) => give(f, I.ECTOPHIAL), start: (f, id) => use(f, id, "Empty"),
    went: (f) => f.p.getInventory().contains(I.ECTOPHIAL_2),
  },
  {
    name: "a royal seed pod", give: (f) => give(f, I.ROYAL_SEED_POD), start: (f, id) => use(f, id, "Commune"),
  },
  {
    name: "a teleport crystal", give: (f) => give(f, I.TELEPORT_CRYSTAL_1_), start: (f, id) => use(f, id, "Lletya"),
  },
  {
    name: "an Iorwerth camp teleport", give: (f) => give(f, I.IORWERTH_CAMP_TELEPORT, 2), start: (f, id) => use(f, id, "Teleport"),
  },
  {
    name: "a Drakan's medallion", give: (f) => { questComplete(["sins_of_the_father"]); return give(f, I.DRAKANS_MEDALLION); },
    start: (f, id) => { use(f, id, "Teleport"); pick(f, /^Ver Sinhaza/); },
  },
  {
    name: "the Sailing cape", give: (f) => give(f, I.SAILING_CAPE),
    start: (f, id) => { use(f, id, "Teleport"); pick(f, /Pandemonium/); },
  },
  {
    name: "a charged item (giantsoul amulet)", give: (f) => charged(f, I.GIANTSOUL_AMULET, "giantsoul-amulet:charges", 5),
    start: (f, id) => { use(f, id, "Rub"); pick(f, /./); },
  },
  {
    name: "Xeric's talisman", give: (f) => charged(f, I.XERICS_TALISMAN, "xerics-talisman:charges", 5),
    start: (f, id) => { use(f, id, "Rub"); pick(f, /Lookout/); },
  },
  {
    name: "a ring of shadows", give: (f) => charged(f, I.RING_OF_SHADOWS, "ring-of-shadows:charges", 5),
    start: (f, id) => { use(f, id, "Teleport"); pick(f, /./); },
  },
  {
    name: "a cowbell amulet", give: (f) => charged(f, I.COWBELL_AMULET_2, "cowbell-amulet:charges", 5),
    start: (f, id) => use(f, id, "Teleport", { worn: true }),
  },
  {
    name: "the Chronicle", give: (f) => { f.p.setAttribute("chronicle:charges", 5); return give(f, I.CHRONICLE); },
    start: (f, id) => use(f, id, "Teleport"),
  },
  {
    name: "the Camulet", give: (f) => give(f, I.CAMULET), start: (f, id) => { use(f, id, "Rub"); menu(f); },
  },
  {
    name: "the skull sceptre", give: (f) => give(f, I.SKULL_SCEPTRE), start: (f, id) => use(f, id, "Invoke"),
  },
  {
    name: "a quetzal whistle", give: (f) => {
      f.p.setAttribute("quetzals:whistle-charges", { basic: 5 });
      f.p.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId("settings_quetzalwhistle_default_tp"), 1);
      return give(f, I.BASIC_QUETZAL_WHISTLE);
    },
    start: (f, id) => use(f, id, "Signal"),
    went: (f) => { settle(); return f.p.getLocation().getX() !== START[0]; },
  },
  {
    name: "the Archivist's folio", give: (f) => charged(f, I.ARCHIVISTS_FOLIO, "fractured-archive:folio-charges", 5),
    start: (f, id) => use(f, id, "Read"),
  },
  {
    name: "a teleport scroll with its own plugin (Guthixian temple teleport)",
    give: (f) => { questComplete(["while_guthix_sleeps"]); return give(f, 29684, 2); }, start: (f, id) => use(f, id, "Teleport"),
  },
  {
    name: "a Lunar teleport spell", give: (f) => {
      questComplete(["lunar_diplomacy", "dream_mentor"]);
      return caster(f, core.MagicSpellbook.LUNAR, [[9075, 10], [563, 10], [557, 10], [555, 10], [554, 10]]);
    },
    start: (f) => cast(f, "Moonclan Teleport"),
  },
  {
    name: "an Arceuus teleport spell", give: (f) => caster(f, core.MagicSpellbook.ARCEUUS, [[563, 10], [557, 10]]),
    start: (f) => cast(f, "Arceuus Library Teleport"),
  },
  {
    name: "a home teleport", give: (f) => caster(f, core.MagicSpellbook.NORMAL, []), start: (f) => cast(f, "Lumbridge Home Teleport"),
    went: (f) => { settle(40); return f.p.getLocation().getX() !== START[0]; },
  },
];

function give(f, itemId, amount = 1) {
  f.p.getInventory().add(new core.Item(itemId, amount), false);
  return itemId;
}

function charged(f, itemId, key, charges) {
  give(f, itemId);
  f.p.getInventory().getItems()[f.p.getInventory().getSlotForItemId(itemId)].setMetaValue(key, charges);
  return itemId;
}

function caster(f, book, runes) {
  f.p.setSpellbook(book);
  f.p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false);
  f.p.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  f.p.getSkillManager().setMaxLevels(core.Skill.DEFENCE, 99, false);
  f.p.getSkillManager().setCurrentLevel(core.Skill.DEFENCE, 99, false);
  for (const [id, amount] of runes) give(f, id, amount);
  return -1;
}

/** The spell's own button on the spellbook, as the client's click is. */
async function cast(f, name) {
  const spell = core.CacheDefinitions.getSpellByName(name);
  assert.ok(spell, name);
  const { widgetId } = spell;
  await f.conn.dispatch([{ type: "widget_action", widgetId, groupId: widgetId >>> 16, childId: widgetId & 65535, slot: -1, buttonNum: 1 }]);
  f.conn.processTurnPackets();
}

for (const teleport of CASES) {
  test(`${teleport.name} aboard your boat asks first with the warning on, uses nothing on no, and goes on yes`, async (t) => {
    const f = actor(t);
    const went = () => (teleport.went ? teleport.went(f) : f.teleports.length > 0);
    const id = teleport.give(f);
    const before = carried(f);
    await teleport.start(f, id);
    assert.equal(pending(f)?.title, TeleportWarning.QUESTION, `the warning (${f.messages.join(" | ")})`);
    assert.equal(went(), false, "not gone yet");
    assert.equal(carried(f), before, "nothing used up yet");
    choose(f, 2);
    settle();
    assert.equal(went(), false, "no: stays aboard");
    assert.equal(carried(f), before, "no: nothing used up");

    await teleport.start(f, id);
    assert.equal(pending(f)?.title, TeleportWarning.QUESTION);
    choose(f, 1);
    assert.equal(went(), true, `yes: the teleport goes (${f.messages.join(" | ")})`);
  });

  test(`${teleport.name} goes at once with the warning off, or ashore`, async (t) => {
    for (const setup of [{ warning: false }, { aboard: false }]) {
      const f = actor(t, setup);
      const id = teleport.give(f);
      await teleport.start(f, id);
      assert.notEqual(pending(f)?.title, TeleportWarning.QUESTION, JSON.stringify(setup));
      assert.equal(teleport.went ? teleport.went(f) : f.teleports.length > 0, true, `${JSON.stringify(setup)}: ${f.messages.join(" | ")}`);
    }
  });
}

test("a tablet's yes still goes when the player gained an item while the warning was open (a catch, salvage)", (t) => {
  const f = actor(t);
  give(f, I.VARROCK_TELEPORT, 2);
  use(f, I.VARROCK_TELEPORT, "Break");
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION);
  give(f, I.RAW_SHRIMPS);
  choose(f, 1);
  assert.equal(f.teleports.length, 1);
});

test("a tablet's yes does nothing once the tablet has gone", (t) => {
  const f = actor(t);
  give(f, I.VARROCK_TELEPORT);
  use(f, I.VARROCK_TELEPORT, "Break");
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION);
  f.p.getInventory().deleteNumber(I.VARROCK_TELEPORT, 1);
  choose(f, 1);
  assert.equal(f.teleports.length, 0);
});

test("a Lunar group teleport asks a passenger aboard their own boat before taking them, and takes them on yes", (t) => {
  const passenger = actor(t);
  const casterPlayer = actor(t, { aboard: false });
  const spell = core.LunarSpells.GROUP_TELEPORTS.get("tele group catherby");
  t.mock.method(spell, "pay", () => true);
  t.mock.method(core.LunarSpells, "forNearbyPlayers", (source, radius, visit) => visit(passenger.p));
  core.LunarSpells.castGroupTeleport(casterPlayer.p, spell);
  assert.equal(casterPlayer.teleports.length, 1, "the caster goes");
  assert.equal(passenger.teleports.length, 0, "the passenger is asked first");
  assert.equal(pending(passenger)?.title, TeleportWarning.QUESTION);
  choose(passenger, 1);
  assert.equal(passenger.teleports.length, 1);
});
