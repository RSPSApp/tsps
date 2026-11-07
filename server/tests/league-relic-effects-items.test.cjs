// Run after `yarn build`: node --test tests/league-relic-effects-items.test.cjs
// The item and teleport relics (docs/leagues.md): Fairy's Flight and Banker's Note (both leagues),
// Globetrotter (Trailblazer Reloaded), Clue Compass, Total Recall, Grimoire and Reloaded (Raging
// Echoes). Each works for a character of its league who chose it, and for nobody else: not a
// character of that league without it, not the other league's character with the same slots, not
// a main character. The destinations come from their owners (fairy rings, spirit trees, the
// jewellery box, the spellbooks, STASH units, the trail's last-read clue); the teleport is recorded.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");

let core;
const hooks = {};
const custom = {};
const itemActions = new Map();
const realRandom = Math.random;
let I;
let prompts = [];
let teleports = [];
let realTeleport;
let realCheckReqs;
let Unlock;
let TrailRuntime;
let MageArena;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  I = core.ItemIdentifiers;
  GameConstants.setWorldProfile("league"); // a Trailblazer Reloaded world (the league type is the plugin config below)
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      for (const attached of lists[name]) attached(event);
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    log() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? 4 : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    getAreaManager: () => ({ inMulti: () => false }),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerMagicAttackAccuracyModifier() {},
    registerMagicDamageBonusModifier() {},
    registerMeleeAttackAccuracyModifier() {},
    registerRangedAttackAccuracyModifier() {},
    registerMeleeDefenseModifier() {},
    registerMagicDefenseModifier() {},
    registerWeaponProfile() {},
    registerRangedAmmoHandler() {},
    onItemAction: (name, actions) => {
      if (typeof name === "string") itemActions.set(name, { ...(itemActions.get(name) ?? {}), ...actions });
    },
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push([pairs[i], pairs[i + 1]]);
      prompts.push({ player, title, options });
    },
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
  require("../plugins/world/FairyRings.plugin").register(api);
  require("../plugins/world/SpiritTrees.plugin").register(api);
  require("../plugins/treasuretrails/TreasureTrails.plugin").register(api);
  require("../plugins/skills/construction/Core.Construction").init(api);
  require("../plugins/skills/construction/JewelleryBox.Construction").attachJewelleryBoxes(api);
  MageArena = require("../plugins/minigames/magearena/Spells.MageArena");
  MageArena(api);
  Unlock = require("../plugins/modes/leaguerelics/Unlock.LeagueRelics");
  TrailRuntime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
  // The teleport itself is the core's; the relics' choice of where is what is checked here.
  realTeleport = core.TeleportHandler.teleport;
  realCheckReqs = core.TeleportHandler.checkReqs;
  core.TeleportHandler.teleport = (player, location, type, warning, onArrival) => {
    teleports.push({ player, location });
    onArrival?.();
  };
});

beforeEach(() => {
  prompts = [];
  teleports = [];
});

afterEach(() => {
  Math.random = realRandom;
  core.TeleportHandler.checkReqs = realCheckReqs;
});

test.after(() => {
  core.TeleportHandler.teleport = realTeleport;
});

/** A real player of `profile`, logged in, with the given relic picks (tier index -> slot). */
function character(name, profile, picks = {}, leagueType = 4) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(3200, 3200, 0));
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.messages = [];
  player.sendMessage = (message) => player.messages.push(message);
  if (profile === "league") {
    player.setAttribute("league:type", leagueType);
    player.setAttribute("league:relics", picks);
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  return player;
}

function cases(picks, league = 4) {
  return {
    relic: character("relic", "league", picks, league),
    without: character("without", "league", {}, league),
    other: character("other", "league", picks, league === 4 ? 5 : 4),
    main: character("main", "main"),
  };
}

function others(who) {
  return [who.without, who.other, who.main];
}

function click(itemName, option, player) {
  const event = { player, item: null, slot: 0, option, handled: false };
  itemActions.get(itemName)[option](event);
  return event;
}

/** Picks a menu option by its label (exact, or the start of it), following "More..." pages. */
function choose(label) {
  for (;;) {
    const prompt = prompts.at(-1);
    assert.ok(prompt, `a menu with ${label}`);
    const found = prompt.options.find(([text]) => text === label || text.startsWith(label));
    if (found) return found[1]();
    const more = prompt.options.find(([text]) => text === "More...");
    assert.ok(more, `${label} in ${prompt.options.map(([text]) => text).join(", ")}`);
    more[1]();
  }
}

const FAIRYS_FLIGHT_TR = { 1: 1 };
const FAIRYS_FLIGHT_RE = { 2: 3 };
const GLOBETROTTER = { 1: 2 };
const BANKERS_NOTE_TR = { 2: 1 };
const BANKERS_NOTE_RE = { 5: 2 };
const CLUE_COMPASS = { 2: 1 };
const TOTAL_RECALL = { 5: 1 };
const GRIMOIRE = { 6: 2 };
const RELOADED = { 3: 2 };
const BANK_HEIST = { 2: 2 };

const at = (teleport) => [teleport.location.getX(), teleport.location.getY(), teleport.location.getZ()];

test("Fairy's Flight (both leagues): fairy rings by code, spirit trees, tool leprechauns; the last destination; only unlocked areas", () => {
  const rings = [];
  for (const handler of custom["fairy-rings:destinations"]) handler({ list: rings });
  const ajr = rings.find((ring) => ring.code === "AJR");
  assert.ok(ajr, "the cache's AJR");
  for (const [picks, league] of [[FAIRYS_FLIGHT_TR, 4], [FAIRYS_FLIGHT_RE, 5]]) {
    teleports = [];
    const relic = character(`flight${league}`, "league", picks, league);
    click("Fairy mushroom", "Teleport", relic);
    assert.deepEqual(prompts.at(-1).options.map(([text]) => text), ["Fairy rings", "Spirit trees", "Tool leprechauns"]);
    choose("Fairy rings");
    choose("A...");
    choose("AJR");
    assert.deepEqual(at(teleports.at(-1)), [ajr.location.getX(), ajr.location.getY(), ajr.location.getZ()], `league ${league}: AJR`);
    click("Fairy mushroom", "Last-destination", relic);
    assert.equal(teleports.length, 2, "and there again");
    assert.deepEqual(at(teleports[1]), at(teleports[0]));
  }

  const who = cases(FAIRYS_FLIGHT_TR, 4);
  teleports = [];
  click("Fairy mushroom", "Spirit-tree", who.relic);
  assert.ok(prompts.at(-1).options.some(([text]) => /Grand Exchange/.test(text)), "the Grand Exchange tree");
  choose("Grand Exchange");
  assert.ok(teleports.length === 1);
  click("Fairy mushroom", "Tool-leprechauns", who.relic);
  assert.ok(prompts.at(-1).options.every(([text]) => /^Near |^More/.test(text)), "named after their fairy rings");
  for (const player of [who.without, who.main]) {
    const before = prompts.length;
    click("Fairy mushroom", "Teleport", player);
    assert.equal(prompts.length, before, `${player.getUsername()}'s mushroom does nothing`);
  }

  // An area the character has not unlocked (as league-areas would answer).
  const area = (query) => { query.area = "asgarnia"; };
  const unlocked = (query) => { query.unlocked = ["misthalin"]; };
  custom["league:area-at"] = [area, ...(custom["league:area-at"] ?? [])];
  custom["league:areas"] = [unlocked, ...(custom["league:areas"] ?? [])];
  teleports = [];
  click("Fairy mushroom", "Last-destination", who.relic);
  assert.equal(teleports.length, 0, "a locked area");
  assert.match(who.relic.messages.at(-1), /haven't unlocked/);
  custom["league:area-at"] = custom["league:area-at"].filter((handler) => handler !== area);
  custom["league:areas"] = custom["league:areas"].filter((handler) => handler !== unlocked);
});

test("Globetrotter: the spellbooks' teleports and the jewellery box's, no higher than level 20 Wilderness", () => {
  const who = cases(GLOBETROTTER, 4);
  click("Globetrotter pendant", "Nexus", who.relic);
  assert.deepEqual(prompts.at(-1).options.map(([text]) => text).slice(0, 4), ["Standard", "Ancient", "Lunar", "Arceuus"]);
  choose("Standard");
  choose("Varrock Teleport");
  assert.deepEqual(at(teleports.at(-1)), [3213, 3424, 0]);
  click("Globetrotter pendant", "Jewellery", who.relic);
  choose("Castle Wars");
  assert.equal(teleports.length, 2, "a jewellery box destination");

  // Level 25 Wilderness: the pendant's limit is 20.
  let limit = null;
  core.TeleportHandler.checkReqs = (player, location, level) => { limit = level; return level >= 25; };
  click("Globetrotter pendant", "Nexus", who.relic);
  choose("Standard");
  choose("Lumbridge Teleport");
  assert.equal(limit, 20);
  assert.equal(teleports.length, 2, "refused from level 25");
  click("Globetrotter pendant", "Jewellery", who.relic);
  choose("Edgeville");
  assert.equal(limit, 30, "a glory destination teleports from level 30");
  for (const player of others(who)) {
    const before = prompts.length;
    click("Globetrotter pendant", "Nexus", player);
    assert.equal(prompts.length, before, `${player.getUsername()}'s pendant does nothing`);
  }
});

test("Banker's Note: preset copies (PvP presets on a league world) are refused, and only plain copies are noted", () => {
  const relic = character("notepreset", "league", BANKERS_NOTE_TR, 4);
  const inventory = relic.getInventory();
  inventory.add(new Item(I.BANKERS_NOTE, 1), false);
  const preset = () => {
    const item = new Item(I.LOGS, 1);
    for (const meta of [Item.UNTRADEABLE_META, Item.UNBANKABLE_META, Item.PRESET_META]) item.setMetaValue(meta, true);
    return item;
  };
  for (let i = 0; i < 3; i++) inventory.add(preset(), false);
  const note = inventory.getItems().find((item) => item?.getId() === I.BANKERS_NOTE);
  const logs = inventory.getItems().find((item) => item?.getId() === I.LOGS);
  hooks.onItemOnItem({ player: relic, usedItem: logs, usedWithItem: note, handled: false });
  const notedLogs = core.ItemDefinition.forId(I.LOGS).getNoteId();
  assert.equal(inventory.getAmount(notedLogs), 0, "no plain notes from preset logs");
  assert.equal(inventory.getAmount(I.LOGS), 3, "the preset logs stay");
  assert.equal(relic.messages.at(-1), "Preset items cannot be used for this.");
  for (let i = 0; i < 2; i++) inventory.add(new Item(I.LOGS, 1), false);
  hooks.onItemOnItem({ player: relic, usedItem: logs, usedWithItem: note, handled: false });
  assert.equal(inventory.getAmount(notedLogs), 2, "the two plain logs are noted");
  assert.equal(inventory.getAmount(I.LOGS), 3, "the three preset logs are left");
});

test("Banker's Note (both leagues): an item used on it is noted or unnoted; Activate repeats it, Toggle switches, the quantities", () => {
  for (const [picks, league] of [[BANKERS_NOTE_TR, 4], [BANKERS_NOTE_RE, 5]]) {
    const relic = character(`note${league}`, "league", picks, league);
    const inventory = relic.getInventory();
    inventory.add(new Item(I.BANKERS_NOTE, 1), false);
    for (let i = 0; i < 5; i++) inventory.add(new Item(I.LOGS, 1), false);
    const note = inventory.getItems().find((item) => item?.getId() === I.BANKERS_NOTE);
    const logs = inventory.getItems().find((item) => item?.getId() === I.LOGS);
    const use = { player: relic, usedItem: logs, usedWithItem: note, handled: false };
    hooks.onItemOnItem(use);
    assert.equal(use.handled, true);
    const notedLogs = core.ItemDefinition.forId(I.LOGS).getNoteId();
    assert.equal(inventory.getAmount(I.LOGS), 0, `league ${league}: noted`);
    assert.equal(inventory.getAmount(notedLogs), 5);
    click("Banker's note", "Toggle", relic);
    click("Banker's note", "Activate", relic);
    assert.equal(inventory.getAmount(I.LOGS), 5, "Activate, toggled, unnotes them");
    let entered;
    relic.setEnteredAmountAction = (action) => { entered = action; };
    click("Banker's note", "Note-Quantity", relic);
    entered.execute(2);
    click("Banker's note", "Toggle", relic);
    click("Banker's note", "Activate", relic);
    assert.equal(inventory.getAmount(notedLogs), 2, "two at a time");
  }

  // Noting a full inventory: 27 logs and the note, no noted logs yet; the logs' slots make room.
  const gatherer = character("notegather", "league", BANKERS_NOTE_TR, 4);
  const pack = gatherer.getInventory();
  pack.add(new Item(I.BANKERS_NOTE, 1), false);
  while (pack.getFreeSlots() > 0) pack.add(new Item(I.LOGS, 1), false);
  assert.equal(pack.getAmount(I.LOGS), 27);
  const [packNote, packLogs] = [I.BANKERS_NOTE, I.LOGS].map((id) => pack.getItems().find((item) => item?.getId() === id));
  hooks.onItemOnItem({ player: gatherer, usedItem: packLogs, usedWithItem: packNote, handled: false });
  assert.equal(pack.getAmount(core.ItemDefinition.forId(I.LOGS).getNoteId()), 27, "all 27 noted");
  assert.equal(pack.getAmount(I.LOGS), 0);

  // Unnoting into a full inventory loses nothing: only what fits comes out.
  const full = character("notefull", "league", BANKERS_NOTE_TR, 4);
  const bag = full.getInventory();
  const notedLogs = core.ItemDefinition.forId(I.LOGS).getNoteId();
  bag.add(new Item(I.BANKERS_NOTE, 1), false).add(new Item(notedLogs, 10), false);
  while (bag.getFreeSlots() > 3) bag.add(new Item(I.BRONZE_DAGGER, 1), false);
  const use = (player) => {
    const [note, logs] = [I.BANKERS_NOTE, notedLogs].map((id) => player.getInventory().getItems().find((item) => item?.getId() === id));
    hooks.onItemOnItem({ player, usedItem: logs, usedWithItem: note, handled: false });
  };
  use(full);
  assert.equal(bag.getAmount(I.LOGS), 3, "three slots, three logs");
  assert.equal(bag.getAmount(notedLogs), 7, "and the other seven still noted");
  click("Banker's note", "Activate", full);
  assert.equal(bag.getAmount(I.LOGS) + bag.getAmount(notedLogs), 10, "a full inventory unnotes none and loses none");
  bag.deleteNumber(notedLogs, 7);
  bag.deleteNumber(I.LOGS, 3);
  click("Banker's note", "Activate", full);
  assert.match(full.messages.at(-1), /none of that/, "the remembered item gone");
  const who = cases(BANKERS_NOTE_TR, 4);
  for (const player of [who.without, who.main]) {
    player.getInventory().add(new Item(I.BANKERS_NOTE, 1), false).add(new Item(I.LOGS, 1), false);
    const [note, logs] = [I.BANKERS_NOTE, I.LOGS].map((id) => player.getInventory().getItems().find((item) => item?.getId() === id));
    const use = { player, usedItem: logs, usedWithItem: note, handled: false };
    hooks.onItemOnItem(use);
    assert.equal(use.handled, false, player.getUsername());
    assert.equal(player.getInventory().getAmount(I.LOGS), 1);
  }
});

test("Clue Compass: STASH units and Falo, the last-read clue's step; it is the item Falo asks for", () => {
  const who = cases(CLUE_COMPASS, 5);
  click("Clue compass", "Teleport", who.relic);
  const labels = prompts.at(-1).options.map(([text]) => text);
  assert.ok(labels.some((text) => /STASH units/.test(text)), labels.join(", "));
  choose("Falo the Bard");
  assert.deepEqual(at(teleports.at(-1)), [2689, 3550, 0]);

  // A clue read, through the trail's own state; the compass goes where it leads.
  who.relic.getInventory().add(new Item(I.CLUE_SCROLL_EASY_, 1), false);
  const slot = who.relic.getInventory().getSlotForItemId(I.CLUE_SCROLL_EASY_);
  let trail = null;
  Math.random = (() => { let n = 0; return () => ((n += 0.137) % 1); })();
  for (let tries = 0; tries < 30 && !(trail?.step?.location && trail.step.target !== "kill"); tries++) {
    who.relic.getInventory().setItem(slot, new Item(I.CLUE_SCROLL_EASY_, 1));
    trail = TrailRuntime.stateOf(who.relic, slot);
  }
  assert.ok(trail?.step?.location, "an easy step with a place");
  who.relic.setAttribute("treasure-trails:last-read", { tier: trail.tier.name, token: trail.state.token });
  click("Clue compass", "Current-step", who.relic);
  assert.deepEqual(at(teleports.at(-1)), [trail.step.location.x, trail.step.location.y, trail.step.location.z ?? 0]);

  const falo = (player, itemId) => {
    const request = { player, kind: "falo", itemId, waived: false };
    for (const handler of custom["treasure-trails:requirement-waived"]) handler(request);
    return request.waived;
  };
  assert.equal(falo(who.relic, I.CLUE_COMPASS), true);
  assert.equal(falo(who.relic, I.LOGS), false, "not any item (that is Treasure Arbiter)");
  for (const player of others(who)) assert.equal(falo(player, I.CLUE_COMPASS), false, player.getUsername());
});

test("Total Recall: Save-memory keeps the place, Hitpoints (up to 127), Prayer and special; Teleport-back sets them back; not in an instance", () => {
  const who = cases(TOTAL_RECALL, 5);
  const relic = who.relic;
  relic.getSkillManager().setCurrentLevel(Skill.PRAYER, 30, false);
  relic.setSpecialPercentage(60);
  relic.moveTo(new Location(3222, 3218, 0));
  click("Crystal of Echoes", "Save-memory", relic);
  relic.moveTo(new Location(3093, 3493, 0));
  relic.setNeedsPlacement(false); // placed, as a tick after the move
  relic.getSkillManager().setCurrentLevel(Skill.PRAYER, 1, false);
  relic.setSpecialPercentage(0);
  click("Crystal of Echoes", "Teleport-back", relic);
  assert.deepEqual(at(teleports.at(-1)), [3222, 3218, 0]);
  assert.equal(relic.getSkillManager().getCurrentLevel(Skill.PRAYER), 30);
  assert.equal(relic.getHitpoints(), 10, "the Hitpoints kept");
  assert.equal(relic.getSpecialPercentage(), 60);
  click("Crystal of Echoes", "Check-memories", relic);
  assert.match(relic.messages.at(-1), /3222, 3218/);
  relic.getPrivateArea = () => ({});
  click("Crystal of Echoes", "Save-memory", relic);
  assert.match(relic.messages.at(-1), /can't remember/);
  for (const player of others(who)) {
    click("Crystal of Echoes", "Save-memory", player);
    assert.equal(player.getAttribute(require("../plugins/modes/leaguerelics/TotalRecall.LeagueRelics").MEMORY_ATTRIBUTE), undefined, player.getUsername());
  }
});

test("Grimoire: the Mage Arena's god spells cast anywhere without their 100 casts", () => {
  const who = cases(GRIMOIRE, 5);
  const godSpell = MageArena._test.GODS[0].spellId;
  const disabled = (player) => {
    const event = { player, spellId: godSpell, disabled: false };
    MageArena._test.spellDisabled(event);
    return event.disabled;
  };
  assert.equal(disabled(who.relic), false);
  for (const player of others(who)) assert.equal(disabled(player), true, player.getUsername());
});

test("Reloaded: a second relic of tiers 1 to 3, a different one from the tier's own; its item; only one", () => {
  const relic = character("reloaded", "league", { 0: 1, 1: 1, 2: 1, 3: 2 }, 5);
  const has = (key) => require("../plugins/modes/leaguerelics/Common.LeagueRelics").hasRelic(relic, key);
  assert.equal(has("bank-heist"), false);
  relic.getInventory().resetItems();
  assert.equal(Unlock.unlock(relic, 2, 2, { bankOpen: true }), true, "tier 3's second relic");
  assert.equal(has("bank-heist"), true, "Bank Heist as well as Clue Compass");
  assert.equal(has("clue-compass"), true);
  assert.equal(relic.getInventory().getAmount(I.BANKERS_BRIEFCASE), 1, "with its briefcase");
  assert.equal(Unlock.unlock(relic, 1, 2, { bankOpen: true }), false, "one extra pick only");
  assert.equal(has("dodgy-deals"), false);

  const again = character("reloaded2", "league", { 0: 1, 3: 2 }, 5);
  assert.equal(Unlock.unlock(again, 0, 1, { bankOpen: true }), false, "not the tier's own pick");
  assert.equal(Unlock.unlock(again, 4, 2, { bankOpen: true }), false, "not a tier above 3 (and tier 5 is not chosen)");

  const without = character("noreload", "league", { 0: 1, 2: 1 }, 5);
  assert.equal(Unlock.unlock(without, 2, 2, { bankOpen: true }), false, "without Reloaded: the tier is taken");
  const tr = character("trreload", "league", { 0: 1, 2: 1, 3: 2 }, 4);
  assert.equal(Unlock.unlock(tr, 2, 2, { bankOpen: true }), false, "Trailblazer Reloaded's same slot is not Reloaded");
});

test("Bank Heist: every bank, bank chest and deposit box in the cache's map, named after the nearest place, grouped; only unlocked areas", () => {
  const DATA = require("../plugins/modes/data/league-bank-heist.json");
  assert.ok(DATA.banks.length > 100, "the generated list");
  for (const bank of DATA.banks) assert.ok(["bank", "bank chest", "deposit box"].includes(bank.kind));
  const tiles = new Set(DATA.banks.map((bank) => `${bank.x},${bank.y},${bank.z}`));
  assert.equal(tiles.size, DATA.banks.length, "no bank twice");
  const who = cases(BANK_HEIST, 5);
  click("Banker's briefcase", "Teleport", who.relic);
  const runs = prompts.at(-1).options.map(([text]) => text);
  assert.ok(runs.length >= 2, runs.join(", "));
  const Heist = require("../plugins/modes/leaguerelics/BankHeist.LeagueRelics");
  const list = Heist._test.banks(who.relic);
  assert.equal(list.length, DATA.banks.length, "one destination a bank");
  assert.ok(list.some((bank) => bank.label === "Lumbridge bank"), "Lumbridge's, by its place");
  assert.ok(list.some((bank) => bank.label === "Edgeville bank"));
  const edgeville = list.find((bank) => bank.label === "Edgeville bank");
  choose(Heist._test.groups(who.relic, list).find(([, run]) => run.includes(edgeville))[0]);
  choose("Edgeville bank");
  const [x, y] = at(teleports.at(-1));
  assert.ok(Math.abs(x - edgeville.location.getX()) <= 4 && Math.abs(y - edgeville.location.getY()) <= 4, "at the bank");

  // With the map's clipping: a booth's own tile is solid, and the landing is the customers' side.
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  RegionManager.init();
  const Teleports = require("../plugins/modes/leaguerelics/Teleports.LeagueRelics");
  const draynor = list.find((bank) => bank.label === "Draynor Village bank");
  const landed = Teleports.landing(draynor.location);
  assert.ok(Teleports.reach(landed, 30) >= 30, "open floor to walk from");
  assert.ok(landed.getX() >= 3092, "not behind the counter (the bankers stand west of x 3092)");
  click("Banker's briefcase", "Last-destination", who.relic);
  assert.equal(teleports.length, 2);

  // With the league's areas answering, the banks are grouped by area.
  const area = (query) => {
    if (query.y > 4500) return; // no league area: Other
    query.area = query.x < 3000 ? "kandarin" : "misthalin";
    query.name = query.x < 3000 ? "Kandarin" : "Misthalin";
  };
  custom["league:area-at"] = [area, ...(custom["league:area-at"] ?? [])];
  click("Banker's briefcase", "Teleport", who.relic);
  assert.deepEqual(prompts.at(-1).options.map(([text]) => text), ["Kandarin", "Misthalin", "Other"]);
  const locked = (query) => { query.unlocked = ["misthalin"]; };
  custom["league:areas"] = [locked, ...(custom["league:areas"] ?? [])];
  click("Banker's briefcase", "Teleport", who.relic);
  assert.deepEqual(prompts.at(-1).options.map(([text]) => text), ["Misthalin", "Other"], "a locked area's banks are not offered");
  custom["league:areas"] = custom["league:areas"].filter((handler) => handler !== locked);
  custom["league:area-at"] = custom["league:area-at"].filter((handler) => handler !== area);
  for (const player of others(who)) {
    const before = prompts.length;
    click("Banker's briefcase", "Teleport", player);
    assert.equal(prompts.length, before, `${player.getUsername()}'s briefcase does nothing`);
  }
});
