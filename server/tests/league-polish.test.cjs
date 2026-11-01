// Run after `yarn build`: node --test tests/league-polish.test.cjs
// The smaller Leagues pieces (docs/leagues.md): a league character plays as an Ironman and stays
// one; the admin and save commands address the world's character; a death Undying Retribution
// prevents never reaches a raid's death handler, and a real one still resets its cooldown; the
// Arcane grimoire swaps spellbooks. Everything runs through PluginManager's own dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { CommandPacketListener } = require("../dist/net/packet/impl/CommandPacketListener");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

const IRONMAN_VARBIT = 1777;
const IRONMAN_SETUP = 890;
const IRONMAN_SETUP_NONE_BUTTON = (IRONMAN_SETUP << 16) | 21;
const IRONMAN_SETUP_POPUP = 289;
const EQUIPMENT_INTERFACE = 1688;
const INVENTORY_INTERFACE = 3214;
/** Worn options come as click types from 2 (param 451) up. */
const FIRST_WORN_OPTION_CLICK = 2;

let core;
let I;
let raidDeaths = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  GameConstants.setWorldProfile("league"); // a league world; LeagueMode reads the league itself from pluginConfig (its data's default here)
  // A raid's death handler, attached before the league plugins as plugins/minigames load before plugins/modes.
  PluginManager.createApi("FakeRaid").onPlayerDeath((event) => {
    raidDeaths++;
    event.handled = true;
  });
  for (const name of ["Ironman", "LeagueMode", "LeaguePoints", "LeagueRelics"]) {
    require(`../plugins/modes/${name}.plugin`).register(PluginManager.createApi(name));
  }
  require("../plugins/commands/AdminCommands.plugin").register(PluginManager.createApi("AdminCommands"));
  require("../plugins/commands/SaveHistory.plugin").register(PluginManager.createApi("SaveHistory"));
});

/** A real player of `profile` whose messages, varbits and interfaces are recorded. */
function character(name, profile = "main", rights = null) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  if (rights !== null) player.setRights(rights);
  const sent = { messages: [], varbits: new Map(), interfaces: [], subs: [] };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendInterface": return (group) => (sent.interfaces.push(group), sender);
        case "sendSubInterface": return (uid, group) => (sent.subs.push(group), sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  return Object.assign(player, { sent });
}

function login(player, isNewAccount = true) {
  PluginManager.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount, profile: player.getProfile() });
}

function query(name, payload) {
  PluginManager.emitCustomEvent(name, payload);
  return payload;
}

const ironmanMode = (player) => query("ironman:mode", { player }).mode;

/** Adam's talk opens the setup for downgrades only; then the None button. */
function askAdamToLeaveIronman(player) {
  query("ironman:open-setup", { player, upgrades: false, handled: false });
  PluginManager.emitInterfaceActionClick({ player, buttonId: IRONMAN_SETUP_NONE_BUTTON, action: 1, handled: false });
}

/** Typing ::text in the chatbox. */
const type = (player, text) => CommandPacketListener.execute(player, text);

test("a league character logs in as a standard Ironman; a main character is untouched", () => {
  const league = character("leaguer", "league");
  login(league);
  assert.equal(league.getAttribute("ironman:mode"), "ironman", "Wiki: every league player is an Ironman");
  assert.equal(ironmanMode(league), "ironman");
  assert.equal(league.sent.varbits.get(IRONMAN_VARBIT), 1, "the client's account type");
  assert.equal(query("account:chat-icon", { player: league, icon: null }).icon, 2, "the Ironman chat icon");

  const main = character("mainchar");
  login(main);
  assert.equal(main.getAttribute("ironman:mode"), undefined);
  assert.equal(main.sent.varbits.get(IRONMAN_VARBIT), 0);
  assert.equal(ironmanMode(main), "none");
});

test("a league character made before the restriction gets it at its next login; any other mode is set right", () => {
  const earlier = character("earlier", "league");
  earlier.setAttribute("league:type", 4);
  login(earlier, false);
  assert.equal(earlier.getAttribute("ironman:mode"), "ironman");

  const hardcore = character("hardcore", "league");
  hardcore.setAttribute("ironman:mode", "hardcore"); // an admin's ::ironman, or a save from before this rule
  login(hardcore);
  assert.equal(hardcore.getAttribute("ironman:mode"), "ironman", "Wiki: every league player is a standard Ironman");
  assert.equal(hardcore.sent.varbits.get(IRONMAN_VARBIT), 1);
});

test("Adam cannot downgrade a league character; a main Ironman still can", () => {
  const league = character("locked", "league");
  login(league);
  askAdamToLeaveIronman(league);
  assert.ok(league.sent.interfaces.includes(IRONMAN_SETUP), "the setup still opens");
  assert.equal(league.sent.messages.at(-1), "As a league character, you are always an Ironman.");
  assert.equal(league.getAttribute("ironman:mode"), "ironman");
  assert.equal(league.sent.subs.includes(IRONMAN_SETUP_POPUP), false, "no confirmation popup");
  PluginManager.emitInterfaceActionClick({ player: league, buttonId: (IRONMAN_SETUP << 16) | 22, action: 1, handled: false });
  assert.equal(league.sent.messages.at(-1), "Your mode is already Ironman.", "the captured answer still comes first");

  const main = character("ironmain");
  login(main);
  query("ironman:set-mode", { player: main, mode: "ironman", handled: false });
  assert.equal(main.getAttribute("ironman:mode"), "ironman");
  askAdamToLeaveIronman(main);
  assert.ok(main.sent.subs.includes(IRONMAN_SETUP_POPUP), "the confirmation popup opens as before");
  assert.equal(main.sent.messages.includes("As a league character, you are always an Ironman."), false);
});

test("the admin and save commands address the league character on a league world, the main one elsewhere", () => {
  const calls = [];
  const snapshot = { id: 7, savedAt: "2026-10-01T00:00:00.000Z", reason: "autosave", bytes: 1 };
  const recorder = {
    exists: (name, profile) => (calls.push(["exists", name, profile]), false),
    supportsHistory: () => true,
    listSnapshots: (name, limit, profile) => (calls.push(["listSnapshots", name, limit, profile]), [snapshot]),
    restoreSnapshot: (name, id, options, profile) => (calls.push(["restoreSnapshot", name, id, profile]), { snapshot, pending: false }),
    resolveFilePath: (name, profile) => (calls.push(["resolveFilePath", name, profile]), path.join(__dirname, "nowhere", profile, `${name}.json`)),
    requestSave() {},
    cancelRequestedSave() {},
    save() {},
  };
  const previous = GameConstants.PLAYER_PERSISTENCE;
  GameConstants.PLAYER_PERSISTENCE = recorder;
  try {
    for (const profile of ["league", "main"]) {
      GameConstants.setWorldProfile(profile);
      calls.length = 0;
      const owner = character(`owner${profile}`, profile, core.PlayerRights.OWNER);
      type(owner, "unban bob");
      type(owner, "snapshots bob");
      type(owner, "rollback bob #7");
      type(owner, "reprocorruptsave bob");
      assert.deepEqual(calls, [
        ["exists", "bob", profile],
        ["listSnapshots", "bob", 15, profile],
        ["listSnapshots", "bob", 1000, profile],
        ["restoreSnapshot", "bob", 7, profile],
        ["resolveFilePath", "bob", profile],
      ], `every save lookup names the ${profile} profile`);
      assert.ok(owner.sent.messages.includes("#7  2026-10-01 00:00:00 UTC  autosave"), "the snapshot listed");
      assert.ok(owner.sent.messages.includes("bob is rolled back to #7  2026-10-01 00:00:00 UTC  autosave."));
      assert.ok(owner.sent.messages.some((text) => text.startsWith("No save file found for bob at ")));
    }
  } finally {
    GameConstants.PLAYER_PERSISTENCE = previous;
    GameConstants.setWorldProfile("league");
  }
});

test("a death Undying Retribution prevents never reaches a raid's death handler; a real one resets the cooldown", () => {
  const tiers = require("../plugins/modes/data/league-relics.json").leagues["4"].tiers;
  const tier = tiers.findIndex((entry) => entry.relics.some((relic) => relic.key === "undying-retribution"));
  const slot = tiers[tier].relics.findIndex((relic) => relic.key === "undying-retribution") + 1;
  const league = character("undying", "league");
  league.setAttribute("league:type", 4); // Trailblazer Reloaded's relic
  login(league);
  league.setAttribute("league:relics", { [tier]: slot });
  assert.equal(query("league:has-relic", { player: league, relic: "undying-retribution" }).active, true);
  const maxHitpoints = league.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);

  raidDeaths = 0;
  league.setHitpoints(0); // a killing blow: Player.setHitpoints appends the death itself
  assert.notEqual(league.isDying, true, "the death never starts");
  assert.equal(league.getHitpoints(), maxHitpoints, "hitpoints restored");
  for (let tick = 0; tick < 4; tick++) core.TaskManager.process();
  assert.equal(raidDeaths, 0, "nothing for a raid to count: no death task ran");
  const readyAt = Number(league.getAttribute("league:undying-retribution-ready-at"));
  assert.ok(readyAt > Date.now(), "on cooldown");

  league.setHitpoints(0);
  assert.equal(league.isDying, true, "on cooldown the death goes ahead");
  for (let tick = 0; tick < 4; tick++) core.TaskManager.process();
  assert.equal(raidDeaths, 1, "the raid handled the real death");
  assert.equal(league.getAttribute("league:undying-retribution-ready-at"), 0, "a real death ends the cooldown even when another plugin handled it");
});

test("the Arcane grimoire changes spellbook, goes back to the previous one and reports it", () => {
  const { MagicSpellbook } = core;
  const grimoire = new core.Item(I.ARCANE_GRIMOIRE, 1);
  const click = (player, clickType, interfaceId = INVENTORY_INTERFACE) => PluginManager.emitItemAction({
    player, interfaceId, item: grimoire, itemId: I.ARCANE_GRIMOIRE, slot: 0, clickType, handled: false,
  });
  const pick = (player, name) => {
    const pending = MultiChatboxPrompt.getPending(player);
    assert.ok(pending, "a spellbook prompt is open");
    MultiChatboxPrompt.selectOption(player, pending.options.indexOf(name));
  };
  const league = character("sorcerer", "league");
  login(league);
  assert.equal(league.getSpellbook(), MagicSpellbook.NORMAL);

  assert.equal(click(league, 4), true, "Check Previous");
  assert.equal(league.sent.messages.at(-1), "You haven't changed spellbook with the grimoire yet.");
  assert.equal(click(league, 3), true, "Previous Spellbook");
  assert.equal(league.sent.messages.at(-1), "You haven't changed spellbook with the grimoire yet.");

  assert.equal(click(league, 1), true, "Change Spellbook");
  assert.deepEqual(MultiChatboxPrompt.getPending(league), { title: "Choose a spellbook", options: ["Ancient", "Lunar", "Arceuus", "Cancel"] }, "every book but the current");
  pick(league, "Ancient");
  assert.equal(league.getSpellbook(), MagicSpellbook.ANCIENT);
  assert.equal(league.sent.messages.at(-1), "You have changed your magic spellbook.", "the altars' own swap");
  assert.equal(league.getAttribute("league:grimoire-previous-spellbook"), "NORMAL");

  assert.ok(league.getSkillManager().getMaxLevel(core.Skill.DEFENCE) < 40);
  click(league, 1);
  pick(league, "Lunar");
  assert.equal(league.sent.messages.at(-1), "You need at least level 40 Defence to use the Lunar spellbook.", "the swap's own requirement");
  assert.equal(league.getSpellbook(), MagicSpellbook.ANCIENT);
  assert.equal(league.getAttribute("league:grimoire-previous-spellbook"), "NORMAL", "a refused swap remembers nothing");

  league.setSpellbook(MagicSpellbook.NORMAL); // an altar in between
  click(league, 3);
  assert.equal(league.getSpellbook(), MagicSpellbook.NORMAL);
  assert.equal(league.getAttribute("league:grimoire-previous-spellbook"), "NORMAL", "already on the previous book: nothing changes, nothing is remembered");
  league.setSpellbook(MagicSpellbook.ANCIENT);

  assert.equal(click(league, FIRST_WORN_OPTION_CLICK + 1, EQUIPMENT_INTERFACE), true, "Previous Spellbook, worn (param 452)");
  assert.equal(league.getSpellbook(), MagicSpellbook.NORMAL);
  assert.equal(league.getAttribute("league:grimoire-previous-spellbook"), "ANCIENT", "it toggles");
  click(league, 4);
  assert.equal(league.sent.messages.at(-1), "Your previous spellbook was the Ancient spellbook.");

  const main = character("muggle");
  login(main);
  assert.equal(click(main, 1), true);
  assert.equal(main.sent.messages.at(-1), "Only a league character can use the grimoire.");
  assert.equal(MultiChatboxPrompt.getPending(main), null);
  assert.equal(main.getSpellbook(), MagicSpellbook.NORMAL);
});
