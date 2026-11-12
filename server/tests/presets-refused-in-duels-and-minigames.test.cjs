// Run after `yarn build`: node --test tests/presets-refused-in-duels-and-minigames.test.cjs
// A preset load wrote gear straight into the slots, set 99 stats and full health after only a Wilderness check: in a
// No Weapons duel it re-geared the player mid-fight, and in a minigame that keeps its own gear (Last Man Standing,
// Castle Wars) it banked the minigame's items and stripped the team cape. It now refuses in a duel, in combat and in
// an area that won't let the player teleport unless its preset policy permits re-gearing; each piece must pass
// the normal equip checks first. Real engine:
// every plugin loaded with PvpMode, a real Player, Bank and Inventory, the real applyPreset.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test, mock } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
require("./helpers/pvp-mode-on.cjs");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { Presetable } = require("../dist/game/content/presets/Presetable");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");

let core;
let I;
let Presets;
const hookErrors = [];
before(async () => {
  mock.method(console, "error", (...args) => hookErrors.push(args.map(String).join(" ")));
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Presets = require("../plugins/modes/pvp/Presets.PvpMode");
  // Bot-free loading also skips BH because it depends on PlayerBots. Register its
  // canonical plugin once for these real-area tests; no bot runtime or World loop runs.
  assert.equal(AreaManager.areas.some((area) => area.getName() === "BountyHunterLobby"), false);
  require("../plugins/minigames/BountyHunter.plugin").register(PM.createApi("BountyHunter"));
  assert.equal(AreaManager.areas.filter((area) => area.getName() === "BountyHunterLobby").length, 1);
  assert.equal(AreaManager.areas.filter((area) => area.getName() === "BountyHunterArena").length, 1);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  mock.restoreAll();
  assert.deepEqual(hookErrors, [], "plugin hooks, including cleanup, must not throw");
});

let next = 9090;
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("preset" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0));
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => {
    const area = p.getArea();
    if (typeof area?.hasMember === "function" && area.hasMember(p)) area.leave(p, true);
    p.setArea(null);
    p.setRegistered(false);
  });
  return { p, messages };
}
const preset = () => new Presetable("qa", [new core.Item(I.SHARK, 5)], [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);

const geared = () => new Presetable("qa", [new core.Item(I.SHARK, 5)], [new core.Item(I.ABYSSAL_WHIP, 1)], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);

function refused(t, f, pattern) {
  f.p.getInventory().setItem(0, new core.Item(I.LOBSTER, 1));
  Presets.applyPreset(f.p, geared());
  assert.equal(f.p.getInventory().getAmount(I.LOBSTER), 1, "what was carried stays, not banked");
  assert.equal(f.p.getInventory().getAmount(I.SHARK), 0, "no preset loaded");
  assert.equal(f.p.getEquipment().getAmount(I.ABYSSAL_WHIP), 0, "no preset gear worn");
  assert.ok(f.messages.some((m) => pattern.test(m)), f.messages.join(" | "));
}

test("no preset during a duel", (t) => {
  const { DuelState } = require("../dist/game/content/Duelling");
  const f = actor(t);
  f.p.getDueling().setState(DuelState.IN_DUEL);
  refused(t, f, /during a duel/);
});

test("no preset in an area that keeps the player in (it refuses teleports): LMS, Castle Wars, raids", (t) => {
  const f = actor(t);
  t.mock.method(f.p, "getArea", () => ({ canTeleport: () => false }));
  refused(t, f, /can't load a preset here/);
});

test("no preset at any stage of a duel, from the request on", (t) => {
  const { DuelState } = require("../dist/game/content/Duelling");
  for (const state of ["REQUESTED_DUEL", "DUEL_SCREEN", "CONFIRM_SCREEN"]) {
    const f = actor(t);
    f.p.getDueling().setState(DuelState[state]);
    refused(t, f, /during a duel/);
  }
});

test("no preset where a plugin's teleport hook refuses (the Inferno, Fight Caves, Gauntlet, Pest Control)", (t) => {
  const f = actor(t);
  // What the Inferno's noTeleportOut answers for a player in a run: those minigames refuse there, not by area.
  t.mock.method(PM, "emitCanTeleport", () => false);
  refused(t, f, /can't load a preset here/);
});

test("no preset whose gear the normal equip checks refuse here", (t) => {
  const f = actor(t);
  t.mock.method(PM, "emitCanEquip", () => false);
  refused(t, f, /can't wear the Abyssal whip here/);
});

test("elsewhere a preset still loads as before", (t) => {
  const f = actor(t);
  Presets.applyPreset(f.p, geared());
  assert.equal(f.p.getInventory().getAmount(I.SHARK), 5);
  assert.equal(f.p.getEquipment().getAmount(I.ABYSSAL_WHIP), 1);
});

// Seeded locations and an in-memory PlayerSession exercise the registered command and
// widget handlers with production areas, inventory and banks; no client or World loop.
function place(f, x, y, z = 0) {
  f.p.setLocation(new core.Location(x, y, z));
  AreaManager.process(f.p);
}

function openFromCommand(f) {
  const { CommandPacketListener } = require("../dist/net/packet/impl/CommandPacketListener");
  const { GROUP_ID } = require("../plugins/modes/pvp/PresetsWidget.PvpMode");
  assert.equal(f.p.isPlayerBot(), false, "normal players must not take the bot bypass");
  assert.equal(Presets.isEnabled(), true, "PvpMode is actually registered");
  assert.ok(f.p.getHitpoints() > 0, "the ordinary command parser accepts a living player");
  CommandPacketListener.execute(f.p, "::presets");
  assert.equal(f.p.getInterfaceId(), GROUP_ID, f.messages.join(" | "));
  const selected = f.p.getAttribute("pvp:current-preset");
  assert.equal(selected, Presets.getGlobalPresetPool()[0], "the command selects the configured first loadout");
  assert.ok(selected.getInventory().length > 0);
  for (const item of selected.getEquipment()) {
    const slot = core.CacheDefinitions.getItem(item.getId()).wearPos;
    assert.notEqual(PM.emitCanEquip(f.p, slot, item), false, `configured gear must be eligible: ${f.messages.join(" | ")}`);
  }
  for (const item of [...selected.getEquipment(), ...selected.getInventory()]) {
    const request = { player: f.p, item, allow: true, messages: [] };
    PM.emitCustomEvent("quest:can-equip", request);
    assert.equal(request.allow, true, `quest prerequisites must be supplied: ${request.messages.join(" | ")}`);
  }
  return selected;
}

function clickLoad(f) {
  const { COMPONENT, uid } = require("../plugins/modes/pvp/PresetsWidget.PvpMode");
  assert.equal(PM.emitInterfaceActionClick({ player: f.p, buttonId: uid(COMPONENT.LOAD_BUTTON),
    action: 1, opId: 1, handled: false }), true, "registered Load widget consumes the click");
}

function carriedState(p) {
  const items = (container) => container.getItems().map((item) => item
    ? [item.getId(), item.getAmount(), item.getMeta()] : null);
  return {
    inventory: items(p.getInventory()), equipment: items(p.getEquipment()),
    banks: Array.from({ length: Bank.TOTAL_BANK_TABS }, (_, tab) => items(p.getBank(tab))),
    skills: core.Skill.values().map((skill) => [p.getSkillManager().getCurrentLevel(skill), p.getSkillManager().getMaxLevel(skill)]),
    hitpoints: p.getHitpoints(), spellbook: p.getSpellbook(),
  };
}

function seedCarried(f) {
  // Supply the configured first loadout's climbing-boots prerequisite, not a quest playthrough.
  const quest = require("../plugins/quests/QuestRuntime").questNamed("Death Plateau");
  assert.ok(quest, "the real equipment-requirement quest is registered");
  quest.setStage(f.p, quest.completionValue);
  assert.equal(quest.isComplete(f.p), true);
  f.p.getInventory().setItem(0, new core.Item(I.LOBSTER, 2));
  f.p.getBank(0).setItem(0, new core.Item(I.COINS, 123));
}

function expectLoad(f, selected, label) {
  assert.deepEqual(f.p.getInventory().getValidItems().map((item) => [item.getId(), item.getAmount()]),
    selected.getInventory().map((item) => [item.getId(), item.getAmount()]), `${label}: ${f.messages.join(" | ")}`);
  assert.ok(f.p.getInventory().getValidItems().every((item) => item.isPresetItem()), "spawned copies retain preset metadata");
  const equipment = (items) => items.map((item) => [item.getId(), item.getAmount()]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(equipment(f.p.getEquipment().getValidItems()), equipment(selected.getEquipment()), "configured equipment is worn");
  assert.deepEqual([core.Skill.ATTACK, core.Skill.DEFENCE, core.Skill.STRENGTH, core.Skill.HITPOINTS,
    core.Skill.RANGED, core.Skill.PRAYER, core.Skill.MAGIC].map((skill) => f.p.getSkillManager().getMaxLevel(skill)),
  selected.getStats(), "configured combat stats are applied");
  assert.equal(f.p.getBank(0).getAmount(I.LOBSTER), 2, "real carried food is banked exactly once");
  assert.equal(f.p.getBank(0).getAmount(I.COINS), 123, "existing bank stock is conserved");
}

function expectLoadRefused(f, pattern) {
  const before = carriedState(f.p);
  clickLoad(f);
  assert.deepEqual(carriedState(f.p), before, "refusal preserves items, all bank tabs, stats, health and spellbook");
  assert.ok(f.messages.some((message) => pattern.test(message)), f.messages.join(" | "));
}

test("ordinary ::presets and Load work outside and in the safe Bounty Hunter lobby", (t) => {
  const outside = actor(t);
  seedCarried(outside);
  const selected = openFromCommand(outside);
  clickLoad(outside);
  expectLoad(outside, selected, "outside positive establishes a valid configured loadout");

  const f = actor(t);
  seedCarried(f);
  const bh = require("../plugins/minigames/bountyhunter/State.BountyHunter");
  place(f, bh.CRATER.lobbyArrival.x, bh.CRATER.lobbyArrival.y);
  assert.equal(f.p.getArea().getName(), "BountyHunterLobby");
  assert.equal(bh.inLobby(f.p), true, "production area entry owns the player");
  assert.equal(f.p.getArea().canTeleport(f.p, 20), false, "lobby teleport refusal stays intact");
  const lobbyPreset = openFromCommand(f);
  clickLoad(f);
  expectLoad(f, lobbyPreset, "safe BH lobby must load the configured preset through the ordinary widget");
});

test("Bounty Hunter arena still refuses the ordinary Load without changing possessions or stats", (t) => {
  const f = actor(t);
  seedCarried(f);
  place(f, 3423, 4050);
  assert.equal(f.p.getArea().getName(), "BountyHunterArena");
  openFromCommand(f);
  expectLoadRefused(f, /can't load a preset here/);
  assert.equal(f.p.getArea().canTeleport(f.p, 20), false);
});

test("a lobby interface cannot load after moving into the arena, before or after area processing", (t) => {
  const f = actor(t);
  seedCarried(f);
  place(f, 3423, 4061);
  openFromCommand(f);
  const lobby = f.p.getArea();
  f.p.setLocation(new core.Location(3423, 4050, 0));
  assert.equal(f.p.getArea(), lobby, "area membership deliberately lags the live tile");
  expectLoadRefused(f, /can't load a preset here/);
  AreaManager.process(f.p);
  assert.equal(f.p.getArea().getName(), "BountyHunterArena");
  openFromCommand(f);
  expectLoadRefused(f, /can't load a preset here/);
});

test("lobby permission never bypasses a duel or combat begun after opening presets", (t) => {
  const { DuelState } = require("../dist/game/content/Duelling");
  for (const combat of [false, true]) {
    const f = actor(t);
    seedCarried(f);
    place(f, 3423, 4061);
    openFromCommand(f);
    if (combat) f.p.getCombat().setTarget(actor(t).p);
    else f.p.getDueling().setState(DuelState.REQUESTED_DUEL);
    expectLoadRefused(f, combat ? /during combat/ : /during a duel/);
  }
});

test("a global teleport veto still refuses a lobby load", (t) => {
  const f = actor(t);
  seedCarried(f);
  place(f, 3423, 4061);
  openFromCommand(f);
  t.mock.method(PM, "emitCanTeleport", () => false);
  expectLoadRefused(f, /can't load a preset here/);
});

test("lobby loading rechecks the account and existing Clan Wars veto after the interface opens", (t) => {
  for (const ironman of [true, false]) {
    const f = actor(t);
    seedCarried(f);
    place(f, 3423, 4061);
    openFromCommand(f);
    if (ironman) {
      const Ironman = require("../plugins/modes/ironman/Common.Ironman");
      f.p.setAttribute(Ironman.MODE_ATTRIBUTE, "ironman");
    } else {
      // Seed only membership to exercise the existing consumer, not a match playthrough.
      const C = require("../plugins/minigames/clanwars/Common.ClanWars");
      assert.equal(C.matches.has(f.p), false);
      C.matches.set(f.p, {});
      t.after(() => C.matches.delete(f.p));
    }
    expectLoadRefused(f, ironman ? /As an Ironman, you cannot use presets/ : /Leave Clan Wars before loading a preset/);
  }
});

test("area preset policy is tri-state and defaults to the existing teleport restriction", (t) => {
  for (const [permission, teleport, allowed] of [[true, false, true], [false, true, false], [null, false, false], [undefined, false, false]]) {
    const f = actor(t);
    const area = { canTeleport: () => teleport };
    if (permission !== undefined) area.canLoadPreset = () => permission;
    t.mock.method(f.p, "getArea", () => area);
    if (allowed) {
      assert.equal(Presets.applyPreset(f.p, geared()), true);
      assert.equal(f.p.getInventory().getAmount(I.SHARK), 5);
    } else {
      refused(t, f, /can't load a preset here/);
    }
  }
});
