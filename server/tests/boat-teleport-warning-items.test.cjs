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
  // As the server's start does: Sailing's own hooks (a teleport off your boat at sea sinks it).
  core.Sailing.initialize();
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
  // A stand-in boat (Sailing's own sinking is left to the real-boat tests below): every tile is its deck.
  const boat = { containsDeckTile: () => true };
  t.mock.method(core.Sailing, "instanceAboard", (player) => (player === p ? (state.aboard ? boat : undefined) : aboardOf.call(core.Sailing, player)));
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
    name: "the escape crystal's Teleport (where it works: a Hardcore World)", give: (f) => {
      escapeAnywhere();
      return give(f, require("../plugins/items/escapecrystal/Common.EscapeCrystal").crystalId());
    },
    start: (f, id) => use(f, id, "Teleport"),
    went: (f) => f.p.getLocation().getX() !== START[0],
  },
  {
    name: "a league relic's teleport item (the relics' shared teleport, using up what it spends as it starts)",
    give: (f) => give(f, I.COINS, 1),
    start: (f) => require("../plugins/modes/leaguerelics/Teleports.LeagueRelics").go(f.p, "boat-warning",
      { label: "Lumbridge", location: new core.Location(3222, 3218, 0), remember: false },
      { onStart: () => f.p.getInventory().deleteNumber(I.COINS, 1) }),
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

let anywhere = false;
/** The escape crystal works anywhere a teleport is allowed, as on a Hardcore World. */
function escapeAnywhere() {
  if (anywhere) return;
  anywhere = true;
  PM.createApi("BoatTeleportWarningEscape").onCustomEvent("escape-crystal:anywhere", (query) => { query.allowed = true; });
}

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
  t.mock.method(spell, "castable", () => true);
  t.mock.method(core.LunarSpells, "forNearbyPlayers", (source, radius, visit) => visit(passenger.p));
  core.LunarSpells.castGroupTeleport(casterPlayer.p, spell);
  assert.equal(casterPlayer.teleports.length, 1, "the caster goes");
  assert.equal(passenger.teleports.length, 0, "the passenger is asked first");
  assert.equal(pending(passenger)?.title, TeleportWarning.QUESTION);
  choose(passenger, 1);
  assert.equal(passenger.teleports.length, 1);
});

test("the escape crystal's Auto-afk and ring of life still save the player at once, aboard with the warning on", (t) => {
  const f = actor(t);
  escapeAnywhere();
  const Activation = require("../plugins/items/escapecrystal/Activation.EscapeCrystal");
  give(f, require("../plugins/items/escapecrystal/Common.EscapeCrystal").crystalId());
  assert.equal(Activation.activate(f.p, "ring", 10), true);
  assert.notEqual(pending(f)?.title, TeleportWarning.QUESTION);
  assert.notEqual(f.p.getLocation().getX(), START[0], "saved at once");
});

// ---------------------------------------------------------------- what the teleport spends, at the yes

const GIANTSOUL_CHARGES = "giantsoul-amulet:charges";
const chargesOf = (item) => item.getMetaValue(GIANTSOUL_CHARGES);

/** A giantsoul amulet rubbed aboard, its lair picked: the warning is up. */
function rubbedGiantsoul(t) {
  const f = actor(t);
  charged(f, I.GIANTSOUL_AMULET, GIANTSOUL_CHARGES, 5);
  const amulet = f.p.getInventory().getItems()[f.p.getInventory().getSlotForItemId(I.GIANTSOUL_AMULET)];
  use(f, I.GIANTSOUL_AMULET, "Rub");
  pick(f, /./);
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION);
  return { f, amulet };
}

test("a charged item worn while the warning is open pays from the worn copy on yes", (t) => {
  const { f, amulet } = rubbedGiantsoul(t);
  // Wearing it puts a copy in the slot (with its own charges), as equipping does.
  const worn = amulet.clone();
  f.p.getInventory().deleteNumber(I.GIANTSOUL_AMULET, 1);
  f.p.getEquipment().setItem(core.Equipment.AMULET_SLOT, worn);
  choose(f, 1);
  assert.equal(f.teleports.length, 1, `it goes (${f.messages.join(" | ")})`);
  assert.equal(chargesOf(worn), 4, "the amulet the player wears paid");
});

test("a charged item gone by the yes stays: no teleport, and the player is told", (t) => {
  const { f, amulet } = rubbedGiantsoul(t);
  f.p.getInventory().deleteNumber(I.GIANTSOUL_AMULET, 1);
  choose(f, 1);
  assert.equal(f.teleports.length, 0);
  assert.ok(f.messages.includes("You no longer have the item you were teleporting with."), f.messages.join(" | "));
});

test("a charged item emptied by the yes (Uncharge meanwhile) doesn't teleport for free", (t) => {
  const { f, amulet } = rubbedGiantsoul(t);
  amulet.setMetaValue(GIANTSOUL_CHARGES, 0);
  choose(f, 1);
  assert.equal(f.teleports.length, 0);
});

test("anything else used up while the warning is open doesn't cancel the yes (food eaten, salvage deposited)", (t) => {
  const f = actor(t);
  give(f, I.VARROCK_TELEPORT, 2);
  give(f, I.SHRIMPS);
  use(f, I.VARROCK_TELEPORT, "Break");
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION);
  f.p.getInventory().deleteNumber(I.SHRIMPS, 1);
  choose(f, 1);
  assert.equal(f.teleports.length, 1);
});

test("a teleport item that is used up (a scroll) and gone by the yes stays, and the player is told", (t) => {
  const f = actor(t);
  give(f, I.NARDAH_TELEPORT);
  use(f, I.NARDAH_TELEPORT, "Teleport");
  f.p.getInventory().deleteNumber(I.NARDAH_TELEPORT, 1);
  choose(f, 1);
  assert.equal(f.teleports.length, 0);
  assert.ok(f.messages.includes("You no longer have the item you were teleporting with."), f.messages.join(" | "));
});

// ---------------------------------------------------------------- combat begun while the warning is open

test("a home teleport refuses on a yes once combat has begun while the warning was open", async (t) => {
  const f = actor(t);
  caster(f, core.MagicSpellbook.NORMAL, []);
  await cast(f, "Lumbridge Home Teleport");
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION);
  t.mock.method(core.CombatFactory, "inCombat", (player) => player === f.p);
  choose(f, 1);
  settle(40);
  assert.equal(f.p.getLocation().getX(), START[0], "stays");
  assert.ok(f.messages.includes("You can't use this spell during combat."), f.messages.join(" | "));
});

function leagueArea() {
  const Common = require("../plugins/modes/leagueareas/Common.LeagueAreaUnlocks");
  const Teleport = require("../plugins/modes/leagueareas/Teleport.LeagueAreaUnlocks");
  const type = Number(Object.keys(Common.data.leagues)[0]);
  return { Common, cast: (player) => Teleport.cast(player, type, { teleport: { x: 3222, y: 3218, z: 0 } }) };
}

test("a league area teleport refuses on a yes once combat has begun while the warning was open", (t) => {
  const f = actor(t);
  const { Common, cast: areaCast } = leagueArea();
  assert.equal(areaCast(f.p), true);
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION);
  t.mock.method(core.CombatFactory, "inCombat", (player) => player === f.p);
  choose(f, 1);
  settle(40);
  assert.equal(f.p.getLocation().getX(), START[0], "stays");
  assert.ok(f.messages.includes(Common.message("inCombat")), f.messages.join(" | "));
});

test("a league area teleport goes on a yes when out of combat", (t) => {
  const f = actor(t);
  leagueArea().cast(f.p);
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION);
  choose(f, 1);
  settle(40);
  assert.notEqual(f.p.getLocation().getX(), START[0]);
});

// ---------------------------------------------------------------- a real boat at sea

/** A real sloop of the player's, boarded at the Pandemonium (`guests` board it there too), then out to open sea. */
function atSea(f, guests = []) {
  core.Sailing.giveBoat(f.p, "sloop", "the_pandemonium");
  assert.equal(core.Sailing.board(f.p, "the_pandemonium"), null, "boards");
  const boat = core.Sailing.instanceAboard(f.p);
  assert.ok(boat, "aboard");
  const { landing } = core.Sailing.getDock("the_pandemonium");
  for (const guest of guests) {
    guest.p.setLocation(new core.Location(landing.x, landing.y, landing.z));
    const refusal = core.Sailing.boardAsGuest(guest.p, f.p, "the_pandemonium", 5);
    assert.equal(refusal, null, `boards as a guest: ${JSON.stringify(refusal)}`);
    guest.p.needsPlacement = false;
  }
  core.BoatManager.teleport(boat, { fineX: 3035 * 128, fineY: 2915 * 128 });
  // The move aboard is placed on the next tick, as the world would.
  f.p.needsPlacement = false;
  return boat;
}

/** A player with no mocked boat: the real Sailing state decides. */
function sailor(t, { warning = true } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("sailor" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  core.RegionManager.loadMapFiles(3035, 2915);
  p.setLocation(new core.Location(...START));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  if (warning) p.getPacketSender().sendVarbit(TeleportWarning.WARNING_VARBIT, 1);
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  return { t, p, messages, teleports: [] };
}

const owned = (f) => f.p.getSailing().boats[0];

test("aboard a real boat at sea: a tablet asks; no keeps the boat and the tablet, yes teleports and the boat is lost at sea", (t) => {
  const f = sailor(t);
  atSea(f);
  give(f, I.VARROCK_TELEPORT);
  use(f, I.VARROCK_TELEPORT, "Break");
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION, f.messages.join(" | ") + " busy=" + f.p.busy() + " status=" + f.p.status + " iface=" + f.p.getInterfaceId?.());
  choose(f, 2);
  settle();
  assert.ok(core.Sailing.instanceAboard(f.p), "no: still aboard");
  assert.notEqual(owned(f).location.kind, "sunk");
  assert.equal(f.p.getInventory().getAmount(I.VARROCK_TELEPORT), 1, "no: the tablet kept");

  use(f, I.VARROCK_TELEPORT, "Break");
  choose(f, 1);
  settle();
  assert.equal(core.Sailing.instanceAboard(f.p), undefined, "yes: off the boat");
  assert.equal(owned(f).location.kind, "sunk", "the boat is lost at sea");
  assert.equal(f.p.getInventory().getAmount(I.VARROCK_TELEPORT), 0, "the tablet used");
  assert.ok(Math.abs(f.p.getLocation().getX() - 3213) <= 2, `in Varrock (${f.p.getLocation().getX()})`);
});

test("aboard a real boat at sea with the warning off, a tablet teleports at once and the boat is lost", (t) => {
  const f = sailor(t, { warning: false });
  atSea(f);
  give(f, I.VARROCK_TELEPORT);
  use(f, I.VARROCK_TELEPORT, "Break");
  assert.notEqual(pending(f)?.title, TeleportWarning.QUESTION);
  settle();
  assert.equal(owned(f).location.kind, "sunk");
});

test("aboard a real boat at sea, an item teleport (glory) asks before it goes", (t) => {
  const f = sailor(t);
  atSea(f);
  give(f, I.AMULET_OF_GLORY_4_);
  use(f, I.AMULET_OF_GLORY_4_, "Rub");
  pick(f, /^Edgeville/);
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION);
  choose(f, 2);
  settle();
  assert.ok(core.Sailing.instanceAboard(f.p), "no: still aboard");
  assert.equal(f.p.getInventory().contains(I.AMULET_OF_GLORY_4_), true, "no charge used");
});

test("a guest on someone else's boat isn't asked: their own boat isn't the one at risk", (t) => {
  const owner = sailor(t);
  const guest = sailor(t);
  atSea(owner, [guest]);
  assert.ok(core.Sailing.guestBoat(guest.p), "aboard as a guest");
  give(guest, I.VARROCK_TELEPORT);
  use(guest, I.VARROCK_TELEPORT, "Break");
  assert.notEqual(pending(guest)?.title, TeleportWarning.QUESTION);
});

test("the escape crystal's Teleport reports what happened: saved at once ashore, not yet while the warning asks", (t) => {
  escapeAnywhere();
  const Activation = require("../plugins/items/escapecrystal/Activation.EscapeCrystal");
  const crystal = require("../plugins/items/escapecrystal/Common.EscapeCrystal").crystalId();
  const ashore = actor(t, { aboard: false });
  give(ashore, crystal);
  assert.equal(Activation.activate(ashore.p, "teleport"), true, "ashore: saved");
  const aboard = actor(t);
  give(aboard, crystal);
  assert.equal(Activation.activate(aboard.p, "teleport"), false, "asked: not saved yet");
  assert.equal(pending(aboard)?.title, TeleportWarning.QUESTION);
  assert.equal(aboard.p.getInventory().contains(crystal), true, "the crystal kept until the yes");
});

test("a Lunar teleport the player can't cast (no runes, or under 40 Defence) says why and doesn't ask, aboard with the warning on", async (t) => {
  questComplete(["lunar_diplomacy", "dream_mentor"]);
  const noRunes = actor(t);
  caster(noRunes, core.MagicSpellbook.LUNAR, []);
  await cast(noRunes, "Moonclan Teleport");
  assert.notEqual(pending(noRunes)?.title, TeleportWarning.QUESTION, "not asked");
  assert.ok(noRunes.messages.length > 0, "told why");
  assert.equal(noRunes.teleports.length, 0);

  const weak = actor(t);
  caster(weak, core.MagicSpellbook.LUNAR, [[9075, 10], [563, 10], [557, 10], [555, 10], [554, 10]]);
  weak.p.getSkillManager().setMaxLevels(core.Skill.DEFENCE, 1, false);
  await cast(weak, "Moonclan Teleport");
  assert.notEqual(pending(weak)?.title, TeleportWarning.QUESTION, "not asked");
  assert.ok(weak.messages.includes("You need at least level 40 Defence to cast Lunar spells."), weak.messages.join(" | "));
});

// ---------------------------------------------------------------- an item moved to another slot while the warning asks

const slotOf = (f, id) => f.p.getInventory().getSlotForItemId(id);
/** Moves the item to the last inventory slot, as dragging it there does. */
function drag(f, id) {
  const from = slotOf(f, id);
  const to = f.p.getInventory().capacity() - 1;
  f.p.getInventory().swap(from, to);
  assert.equal(slotOf(f, id), to, "moved");
}

test("a revenant cave teleport asks its own question, then the boat warning; moved to another slot meanwhile, yes still teleports and uses it", (t) => {
  const f = actor(t);
  give(f, I.REVENANT_CAVE_TELEPORT, 2);
  use(f, I.REVENANT_CAVE_TELEPORT, "Teleport");
  assert.notEqual(pending(f)?.title, TeleportWarning.QUESTION, "its own question first");
  choose(f, 1);
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION, "then the boat warning");
  drag(f, I.REVENANT_CAVE_TELEPORT);
  choose(f, 1);
  assert.equal(f.teleports.length, 1, `it goes (${f.messages.join(" | ")})`);
  assert.equal(f.p.getInventory().getAmount(I.REVENANT_CAVE_TELEPORT), 1, "one scroll used");
});

test("a revenant cave teleport goes at once after its own question with the warning off", (t) => {
  const f = actor(t, { warning: false });
  give(f, I.REVENANT_CAVE_TELEPORT);
  use(f, I.REVENANT_CAVE_TELEPORT, "Teleport");
  choose(f, 1);
  assert.notEqual(pending(f)?.title, TeleportWarning.QUESTION);
  assert.equal(f.teleports.length, 1);
});

test("the ectophial moved to another slot while the warning asks still pours on yes", (t) => {
  const f = actor(t);
  give(f, I.ECTOPHIAL);
  use(f, I.ECTOPHIAL, "Empty");
  assert.equal(pending(f)?.title, TeleportWarning.QUESTION);
  drag(f, I.ECTOPHIAL);
  choose(f, 1);
  assert.equal(f.p.getInventory().contains(I.ECTOPHIAL_2), true, "poured");
  assert.equal(f.p.getInventory().contains(I.ECTOPHIAL), false);
});
