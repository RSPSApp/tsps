// Run after `yarn build`: node --test tests/league-relics.test.cjs
// League relics (docs/leagues.md): the catalog the client is sent, the relic interface's captured
// flow, the checks on a pick, its presentation and items, and the queries other plugins make.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");

const RELICS = 655;
const SIDE_PANEL = 656;
const uid = (group, child) => (group << 16) | child;

let core;
const hooks = {};
const custom = {};
const emitted = [];
let worldLeague = 4; // the world's pluginConfig league:type (Trailblazer Reloaded)
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league"); // a league world
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      let result;
      for (const attached of lists[name]) {
        const answer = attached(event);
        if (answer !== undefined) result = answer;
      }
      return result;
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
});

/** A real player whose packets are recorded; logged in as a new character of `profile`. */
function character(name, profile = "league", { login = true } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  const sent = { messages: [], varbits: new Map(), scripts: [], subs: [], flags: [], sounds: [], content: [], removals: 0 };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendInterfaceScript": return (id, args) => (sent.scripts.push([id, args]), sender);
        case "sendSubInterface": return (target, group) => (sent.subs.push([target, group]), sender);
        case "sendInterface": return (group) => (player.setInterfaceId(group), sent.subs.push(["main", group]), sender);
        case "sendInterfaceFlagsRange": return (...args) => (sent.flags.push(args), sender);
        case "sendSound": return (...args) => (sent.sounds.push(args), sender);
        case "sendContentData": return (source, datasets) => (sent.content.push(datasets), sender);
        case "sendInterfaceRemoval": return () => (sent.removals++, sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  if (login) hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  return Object.assign(player, { sent });
}

/** The bank as the game opens it: the banking status with bankmain as the main interface. */
function openBank(player) {
  player.setStatus(PlayerStatus.BANKING);
  player.setInterfaceId(core.Bank.MAIN_INTERFACE_ID);
  assert.equal(core.Bank.isOpen(player), true);
}

function closeBank(player) {
  player.setStatus(PlayerStatus.NONE);
  player.setInterfaceId(-1);
}

function givePoints(player, points) {
  hooks["command:leaguetask"]({ player, parts: ["leaguetask", `task-${points}-${Math.random()}`, String(points)] });
}

function dataset(player, key) {
  return player.sent.content.at(-1).find((entry) => entry.key === key).rows;
}

const query = (name, payload) => {
  for (const handler of custom[name]) handler(payload);
  return payload;
};

test("login sends the selection varbits and the league's catalog as structs and enums", () => {
  const league = character("catalog");
  for (const varbit of [10049, 10050, 10051, 10052, 10053, 11696, 17301, 17302]) {
    assert.equal(league.sent.varbits.get(varbit), 0, `league_relic_selection ${varbit}`);
  }
  assert.equal(league.sent.varbits.get(10048), 0, "league_relic_last_viewed");
  const structs = dataset(league, "structOverrides");
  const enums = dataset(league, "enumOverrides");
  const byId = new Map(structs.map((row) => [row.structId, row.params]));
  assert.equal(byId.get(4699)[870], 204000, "the Trailblazer Reloaded league struct's tier enum is ours (its tutorial pages share the row: league-tutorial.test.cjs)");
  const tiers = enums.find((row) => row.enumId === 204000);
  assert.equal(tiers.entries.length, 8);
  const costs = tiers.entries.map(([, structId]) => byId.get(structId)[877]);
  assert.deepEqual(costs, [0, 500, 1200, 2000, 4000, 7500, 15000, 24000], "Wiki: Trailblazer Reloaded's tier points");
  for (const [tier, tierStruct] of tiers.entries) {
    const relics = enums.find((row) => row.enumId === byId.get(tierStruct)[878]);
    assert.deepEqual(relics.entries.map(([key]) => key), [1, 2, 3], `tier ${tier + 1} has three relics keyed 1-3`);
    assert.equal(typeof byId.get(byId.get(tierStruct)[2045])[1020], "string", "a passive text struct");
  }
  const sorcerer = byId.get(204000 + 100 + 3 * 3 + 2);
  assert.equal(sorcerer[879], "Superior Sorcerer");
  assert.equal(sorcerer[885], 3);
  assert.equal(sorcerer[1855], 1, "it hands out items");
  assert.ok(Number.isInteger(sorcerer[881]) && Number.isInteger(sorcerer[1853]), "icons borrowed from the cache's own relic in that slot");
});

test("Raging Echoes gets its own costs and relics", () => {
  worldLeague = 5;
  const echoes = character("echoes");
  worldLeague = 4;
  const structs = new Map(dataset(echoes, "structOverrides").map((row) => [row.structId, row.params]));
  const tiers = dataset(echoes, "enumOverrides").find((row) => row.enumId === 205000);
  assert.deepEqual(structs.get(6211), { 870: 205000 });
  assert.deepEqual(tiers.entries.map(([, id]) => structs.get(id)[877]), [0, 750, 1500, 2500, 5000, 8000, 16000, 25000], "Wiki: Raging Echoes' tier points");
  assert.equal(structs.get(205000 + 100 + 0)[879], "Power Miner");
});

test("View Relics opens the interface with its click events; a slot click records the relic viewed", () => {
  const league = character("viewer");
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player: league }), true);
  assert.deepEqual(league.sent.subs.at(-1)[1], RELICS, "opened as the main modal");
  assert.deepEqual(league.sent.flags.slice(-3), [[uid(RELICS, 22), 0, 23, 2], [uid(RELICS, 6), 10, 20, 2], [uid(RELICS, 38), -1, -1, 1 << 23]], "if_setevents as captured (rev 237: the toggles take IF_SCRIPT_TRIGGER)");
  assert.equal(hooks[`button:${uid(RELICS, 22)}`]({ player: league, slot: 9 }), true);
  assert.equal(league.sent.varbits.get(10048), 9, "tier 4, slot 1");
  const [script, args] = league.sent.scripts.at(-2);
  assert.equal(script, 3193);
  assert.equal(args.length, 23, "rev 237's signature: 18 components, the state, two structs, two texts");
  assert.deepEqual(args.slice(0, 3), [uid(RELICS, 14), uid(RELICS, 23), uid(RELICS, 26)]);
  assert.deepEqual(args.slice(18, 21), [0, 204000 + 100 + 9, 204000 + 20 + 3], "state (0: the points don't reach the tier), the relic's struct, the tier's passive struct");
  assert.ok(typeof args[21] === "string" && args[21].length > 0 && typeof args[22] === "string", "the relic's description and the tier's passive text");
  assert.deepEqual(league.sent.scripts.at(-1), [3181, [uid(RELICS, 7), uid(RELICS, 53), 0, 1]], "the tooltip is 655:53 in this cache");
  assert.equal(hooks[`button:${uid(RELICS, 22)}`]({ player: league, slot: 24 }), false, "no such slot");

  const main = character("mainview", "main");
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player: main }), false, "a main character has no relics");
  assert.equal(main.sent.subs.length, 0);

  const forger = character("forger");
  givePoints(forger, 500);
  assert.equal(hooks[`button:${uid(RELICS, 22)}`]({ player: forger, slot: 0 }), false, "a slot click without View Relics is ignored");
  assert.equal(hooks[`button:${uid(RELICS, 51)}`]({ player: forger }), false, "so is a confirm");
  assert.equal(forger.getAttribute("league:relics"), undefined);
  hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player: forger });
  assert.equal(hooks[`button:${uid(RELICS, 51)}`]({ player: forger }), true);
  assert.equal(forger.sent.messages.at(-1), "Select a relic to unlock first.", "confirm with nothing viewed");
  assert.equal(forger.getAttribute("league:relics"), undefined);
});

test("the relic view's state: 1 for the character's own relic (its toggles unlocked), 4 for another of a chosen tier, 2 to choose, 0 out of reach", () => {
  const league = character("states");
  givePoints(league, 500);
  league.setAttribute("league:relics", { 0: 2 });
  hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player: league });
  const state = (slot) => {
    hooks[`button:${uid(RELICS, 22)}`]({ player: league, slot });
    return league.sent.scripts.filter(([script]) => script === 3193).at(-1)[1][18];
  };
  assert.equal(state(1), 1, "tier 1 slot 2: the character's own (live: 1, 237/01104)");
  assert.equal(state(0), 4, "another relic of that tier");
  assert.equal(state(3), 2, "tier 2, affordable and open");
  assert.equal(state(21), 0, "tier 8, out of reach");
});

test("a pick needs the tier's points, an empty tier and (for an item) a bank; then it is permanent", () => {
  const league = character("picker");
  const view = (slot) => hooks[`button:${uid(RELICS, 22)}`]({ player: league, slot });
  const confirm = () => hooks[`button:${uid(RELICS, 51)}`]({ player: league });
  hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player: league });

  view(11); // tier 4, slot 3: Superior Sorcerer
  confirm();
  assert.equal(league.sent.messages.at(-1), "You don't have enough League Points to unlock that tier yet.");
  assert.equal(league.getAttribute("league:relics"), undefined, "nothing written");

  givePoints(league, 2000);
  confirm();
  assert.equal(league.sent.messages.at(-1), "You need to be in a bank to unlock this relic, as it gives you an item.");
  assert.equal(league.getAttribute("league:relics"), undefined);

  // The real transition: the bank is open, View Relics replaces it as the main interface, and the pick still counts the bank.
  openBank(league);
  hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player: league });
  assert.equal(league.getInterfaceId(), RELICS, "the relic modal replaced the bank");
  assert.equal(core.Bank.isOpen(league), false, "so the bank no longer reads as open");
  view(11);
  emitted.length = 0;
  league.sent.sounds.length = 0;
  confirm();
  assert.deepEqual(league.getAttribute("league:relics"), { 3: 3 });
  assert.equal(league.sent.varbits.get(10052), 3, "league_relic_selection_3 = the slot");
  assert.equal(league.getAnimation()?.getId(), 8524, "human_relic_unlock");
  assert.equal(league.getGraphic()?.getId(), 2603, "Trailblazer Reloaded's unlock graphic");
  assert.equal(league.sent.removals, 1, "the modal closes");
  assert.deepEqual(league.sent.sounds, [[4215, 1, 8], [4211, 1, 44], [4213, 1, 80], [4212, 1, 104]]);
  const items = league.getInventory().getItems().filter((item) => item?.getId() > 0).map((item) => item.getId());
  assert.deepEqual(items.sort(), [12791, 26551].sort(), "an arcane grimoire and a rune pouch");
  const unlocked = emitted.find(([name]) => name === "league:relic-unlocked")[1];
  assert.deepEqual([unlocked.league, unlocked.tier, unlocked.slot, unlocked.relic], [4, 3, 3, "superior-sorcerer"]);

  const stale = league.sent.messages.length;
  confirm();
  assert.equal(league.sent.messages.length, stale, "the modal closed with the unlock: its confirm button is stale");

  hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player: league }); // View Relics again
  view(9);
  confirm();
  assert.equal(league.sent.messages.at(-1), "You have already chosen a relic for that tier.");
  assert.deepEqual(league.getAttribute("league:relics"), { 3: 3 });

  // Closing the modal (the client's close resets the main interface and the banking status) makes a late confirm a no-op.
  view(0);
  closeBank(league);
  const before = league.sent.messages.length;
  confirm();
  assert.equal(league.sent.messages.length, before, "no pick and no message after the modal is gone");
  assert.deepEqual(league.getAttribute("league:relics"), { 3: 3 });

  assert.equal(query("league:has-relic", { player: league, relic: "superior-sorcerer" }).active, true);
  assert.equal(query("league:has-relic", { player: league, relic: "berserker" }).active, false);
  assert.equal(query("league:highest-tier", { player: league, tier: -1 }).tier, 3);
  const gain = { player: league, skill: Skill.MAGIC, experience: 10, allow: null, multiplier: 1 };
  hooks.onCanGainExperience(gain);
  assert.equal(gain.multiplier, 8, "tier 4 reached: the tier 2 passive's 8x applies");
  closeBank(league);
});

test("a full inventory sends the item to the bank; no room anywhere leaves the tier unchosen", () => {
  const league = character("banker");
  givePoints(league, 1200);
  const { Item, Bank } = core;
  for (let slot = 0; slot < 28; slot++) league.getInventory().add(new Item(1965, 1), false); // cabbages
  openBank(league);
  hooks["command:relic"]({ player: league, parts: ["relic", "3", "1"] }); // Banker's Note
  assert.deepEqual(league.getAttribute("league:relics"), { 2: 1 });
  assert.equal(league.getInventory().getItems().some((item) => item?.getId() === 28767), false);
  assert.equal(Bank.contains(league, new Item(28767, 1)), true, "the banker's note went to the bank");

  const crammed = character("crammed");
  givePoints(crammed, 500);
  for (let slot = 0; slot < 28; slot++) crammed.getInventory().add(new Item(1965, 1), false);
  let filler = 1;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab === Bank.BANK_SEARCH_TAB_INDEX) continue;
    const bank = crammed.getBank(tab);
    while (bank.getFreeSlots() > 0) bank.add(new Item(filler++, 1), false); // distinct ids, so nothing stacks
  }
  openBank(crammed);
  hooks["command:relic"]({ player: crammed, parts: ["relic", "2", "1"] }); // Fairy's Flight hands out an item
  assert.equal(crammed.sent.messages.at(-1), "You need room in your inventory or bank for this relic's items.");
  assert.equal(crammed.getAttribute("league:relics"), undefined, "the permanent pick is not saved without its item");
});

test("the room check is item-aware: a banked item joins its stack, a new stack takes one slot of the bank's shared space", () => {
  const { Item, Bank, ItemIdentifiers } = core;
  /** A full inventory, the rune pouch banked (or not), and exactly `slots` of bank space left across the tabs. */
  const squeeze = (name, slots, { pouchBanked }) => {
    const player = character(name);
    givePoints(player, 2000);
    for (let slot = 0; slot < 28; slot++) player.getInventory().add(new Item(1965, 1), false);
    if (pouchBanked) player.getBank(0).add(new Item(ItemIdentifiers.RUNE_POUCH, 1), false);
    let filler = 1;
    for (let tab = 0; Bank.freeSlots(player) > slots; tab = (tab + 1) % Bank.BANK_SEARCH_TAB_INDEX) {
      player.getBank(tab).add(new Item(filler++, 1), false); // distinct ids spread over the tabs
    }
    assert.equal(Bank.freeSlots(player), slots);
    openBank(player);
    hooks["command:relic"]({ player, parts: ["relic", "4", "3"] }); // Superior Sorcerer: an arcane grimoire and a rune pouch
    return player;
  };
  const fits = squeeze("squeezed", 1, { pouchBanked: true });
  assert.deepEqual(fits.getAttribute("league:relics"), { 3: 3 }, "both items fit: the grimoire takes the slot, the pouch joins its stack");
  assert.equal(fits.getBank(0).getAmount(ItemIdentifiers.RUNE_POUCH), 2);
  assert.equal(Bank.contains(fits, new Item(ItemIdentifiers.ARCANE_GRIMOIRE, 1)), true);
  assert.equal(Bank.freeSlots(fits), 0);

  const none = squeeze("squeezedout", 0, { pouchBanked: true });
  assert.equal(none.sent.messages.at(-1), "You need room in your inventory or bank for this relic's items.");
  assert.equal(none.getAttribute("league:relics"), undefined, "no slot for the grimoire: refused, nothing saved");
  assert.equal(none.getBank(0).getAmount(ItemIdentifiers.RUNE_POUCH), 1, "and nothing handed out");

  // Two new stacks with one slot of bank space: every tab reports that same slot, but it is one slot.
  const shared = squeeze("sharedspace", 1, { pouchBanked: false });
  assert.equal(shared.sent.messages.at(-1), "You need room in your inventory or bank for this relic's items.");
  assert.equal(shared.getAttribute("league:relics"), undefined, "the second item has no slot: refused, nothing saved");
  assert.equal(Bank.contains(shared, new Item(ItemIdentifiers.ARCANE_GRIMOIRE, 1)), false, "and nothing handed out");
  assert.equal(Bank.freeSlots(shared), 1);

  const two = squeeze("twoslots", 2, { pouchBanked: false });
  assert.deepEqual(two.getAttribute("league:relics"), { 3: 3 });
  assert.equal(Bank.contains(two, new Item(ItemIdentifiers.ARCANE_GRIMOIRE, 1)), true);
  assert.equal(Bank.contains(two, new Item(ItemIdentifiers.RUNE_POUCH, 1)), true);
  assert.equal(Bank.freeSlots(two), 0);
});

test("a Raging Echoes tier-1 tool is handed out without a bank, as the Leagues V tutorial unlock was", () => {
  worldLeague = 5;
  const echoes = character("wrangler");
  worldLeague = 4;
  const { ItemIdentifiers } = core;
  hooks["command:relic"]({ player: echoes, parts: ["relic", "1", "3"] }); // Animal Wrangler (osrs-captures 227/00196)
  assert.deepEqual(echoes.getAttribute("league:relics"), { 0: 3 });
  assert.equal(echoes.getInventory().contains(ItemIdentifiers.ECHO_HARPOON), true, "the Echo harpoon lands in the inventory");
});

test("points crossing a tier's cost show the captured popup, once, for tiers still open", () => {
  const league = character("thresholds");
  emitted.length = 0;
  givePoints(league, 400);
  assert.equal(emitted.filter(([name, payload]) => name === "notification:show" && payload.title === "New Relic Available!").length, 0);
  givePoints(league, 900); // 1300: tiers 2 (500) and 3 (1200)
  const popups = emitted.filter(([name, payload]) => name === "notification:show" && payload.title === "New Relic Available!").map(([, payload]) => payload);
  assert.deepEqual(popups.map((popup) => popup.text), [
    "You've gained enough points to unlock a tier 2 Relic!",
    "You've gained enough points to unlock a tier 3 Relic!",
  ]);
  assert.deepEqual([popups[0].colour, popups[0].jingle], [16742144, { id: 281, length: 4500 }]);
  emitted.length = 0;
  givePoints(league, 10);
  assert.equal(emitted.filter(([name, payload]) => name === "notification:show" && payload.title === "New Relic Available!").length, 0, "not again");
});

test("a reload restores the picks, and another league never answers for them", () => {
  const league = character("reloader");
  givePoints(league, 0);
  hooks["command:relic"]({ player: league, parts: ["relic", "1", "1"] });
  assert.deepEqual(league.getAttribute("league:relics"), { 0: 1 });
  const again = character("reloader", "league", { login: false });
  again.setAttribute("league:type", league.getAttribute("league:type"));
  again.setAttribute("league:relics", { ...league.getAttribute("league:relics") });
  hooks.onPlayerLogin({ player: again, username: "reloader", isNewAccount: false, profile: "league" });
  assert.equal(again.sent.varbits.get(10049), 1, "the saved pick is sent again");
  assert.equal(query("league:has-relic", { player: again, relic: "endless-harvest" }).active, true);

  worldLeague = 5;
  const echoes = character("otherleague");
  worldLeague = 4;
  givePoints(echoes, 2500);
  hooks["command:relic"]({ player: echoes, parts: ["relic", "4", "3"] }); // Raging Echoes' Equilibrium
  assert.deepEqual(echoes.getAttribute("league:relics"), { 3: 3 });
  assert.equal(query("league:has-relic", { player: echoes, relic: "superior-sorcerer" }).active, false, "the same slot in another league is another relic");
  assert.equal(query("league:has-relic", { player: echoes, relic: "equilibrium" }).active, true);

  const main = character("mainrelic", "main");
  hooks["command:relic"]({ player: main, parts: ["relic", "1", "1"] });
  assert.equal(main.sent.messages.at(-1), "Only a league character can unlock relics.");
  assert.equal(main.getAttribute("league:relics"), undefined);
});

test("Demonic Pacts' slots count each tier's relics, as client script 3189 does: tier 7 holds two, so tier 8 is slots 20-22", () => {
  const Common = require("../plugins/modes/leaguerelics/Common.LeagueRelics");
  const { slotToRelic } = require("../plugins/modes/leaguerelics/Interface.LeagueRelics");
  worldLeague = 6;
  const pacts = character("pactslots");
  worldLeague = 4;
  const catalog = Common.catalog(6);
  assert.equal(catalog.tiers[6].relics.length, 2, "Flow State and Reloaded");
  assert.deepEqual([18, 19, 20, 21, 22].map((sub) => slotToRelic(catalog, sub)), [
    { tier: 6, slot: 1 }, { tier: 6, slot: 2 }, { tier: 7, slot: 1 }, { tier: 7, slot: 2 }, { tier: 7, slot: 3 },
  ]);
  assert.equal(slotToRelic(catalog, 23), null, "23 relics: no slot 23");
  assert.deepEqual(slotToRelic(Common.catalog(4), 23), { tier: 7, slot: 3 }, "three a tier: the old tier x 3 + slot");
  hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player: pacts });
  const struct = (sub) => {
    assert.equal(hooks[`button:${uid(RELICS, 22)}`]({ player: pacts, slot: sub }), true);
    assert.equal(pacts.sent.varbits.get(10048), sub, "league_relic_last_viewed is the raw slot (rec 1135)");
    return pacts.sent.scripts.filter(([script]) => script === 3193).at(-1)[1][19];
  };
  assert.equal(struct(19), 1127, "rec 1135: slot 19 views Reloaded");
  assert.equal(struct(20), catalog.tiers[7].relics[0].struct, "Executioner");
  assert.equal(struct(21), catalog.tiers[7].relics[1].struct, "Minion");
  assert.equal(struct(22), 6454, "rec 1135: slot 22 views Flask of Fervour");
  assert.equal(hooks[`button:${uid(RELICS, 22)}`]({ player: pacts, slot: 23 }), false);

  givePoints(pacts, 60000);
  openBank(pacts);
  hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player: pacts });
  hooks[`button:${uid(RELICS, 22)}`]({ player: pacts, slot: 22 });
  hooks[`button:${uid(RELICS, 51)}`]({ player: pacts });
  assert.deepEqual(pacts.getAttribute("league:relics"), { 7: 3 }, "slot 22's confirm unlocks Flask of Fervour, tier 8's third");
  assert.equal(pacts.sent.varbits.get(17302), 3);
  closeBank(pacts);
});

test("Reloaded (Demonic Pacts, rec 1135): the repick varbits and line on its unlock, the extra pick in selection_other, re-sent at login", () => {
  const SELECTION_OTHER = [17554, 17555, 17556, 17557, 17558, 17559, 17560, 17561];
  const REPICK = [17562, 17563, 17564, 17565, 17566, 17567, 17568, 17569];
  worldLeague = 6;
  const player = character("reloadedpick");
  worldLeague = 4;
  const picks = { 0: 3, 1: 3, 2: 1, 3: 2, 4: 2, 5: 1 };
  player.setAttribute("league:relics", { ...picks });
  givePoints(player, 60000);
  const open = () => hooks[`button:${uid(SIDE_PANEL, 44)}`]({ player });
  const view = (slot) => {
    hooks[`button:${uid(RELICS, 22)}`]({ player, slot });
    return player.sent.scripts.filter(([script]) => script === 3193).at(-1)[1][18];
  };
  const confirm = () => hooks[`button:${uid(RELICS, 51)}`]({ player });

  open();
  view(19);
  confirm();
  assert.equal(player.sent.varbits.get(17301), 2, "league_relic_selection_6 0->2");
  assert.deepEqual(player.sent.messages.slice(-2), [
    "Congratulations, you've unlocked a new Relic: <col=FE206A>Reloaded</col>.",
    "<col=FE206A>You can now pick another relic below tier seven!",
  ]);
  assert.deepEqual(REPICK.map((id) => player.sent.varbits.get(id)), [1, 1, 1, 1, 1, 1, 0, 0], "repick_0-5 0->1");

  open();
  assert.equal(view(15), 1, "Grimoire, tier 6's own pick");
  assert.equal(view(17), 5, "Culling Spree: another relic of a chosen tier the extra pick may take (3193 state 5)");
  assert.equal(view(18), 4, "Flow State: Reloaded's own tier is not among them");
  assert.equal(view(16), 5, "Eternal Sustenance");
  const before = player.sent.messages.length;
  player.sent.varbits.delete(11696);
  confirm();
  assert.deepEqual(player.getAttribute("league:relics"), { ...picks, 6: 2 }, "the tier's own pick stays");
  assert.equal(player.sent.varbits.get(SELECTION_OTHER[5]), 2, "league_relic_selection_other_5 0->2");
  assert.equal(player.sent.varbits.has(11696), false, "league_relic_selection_5 is not sent");
  assert.deepEqual(REPICK.map((id) => player.sent.varbits.get(id)), [0, 0, 0, 0, 0, 0, 0, 0], "repick_0-5 1->0");
  assert.deepEqual(player.sent.messages.slice(before), ["Congratulations, you've unlocked a new Relic: <col=FE206A>Eternal Sustenance</col>."], "no other line");
  assert.equal(query("league:has-relic", { player, relic: "eternal-sustenance" }).active, true);
  open();
  assert.equal(view(16), 1, "the extra pick is the character's own");
  assert.equal(view(17), 4, "and the rest of its tier is taken");

  const again = character("reloadedpick", "league", { login: false });
  again.setAttribute("league:type", player.getAttribute("league:type"));
  again.setAttribute("league:relics", { ...player.getAttribute("league:relics") });
  again.setAttribute("league:relics-extra", { ...player.getAttribute("league:relics-extra") });
  hooks.onPlayerLogin({ player: again, username: "reloadedpick", isNewAccount: false, profile: "league" });
  assert.deepEqual(SELECTION_OTHER.map((id) => again.sent.varbits.get(id)), [0, 0, 0, 0, 0, 2, 0, 0], "selection_other re-sent at login");
  assert.deepEqual(REPICK.map((id) => again.sent.varbits.get(id)), [0, 0, 0, 0, 0, 0, 0, 0]);

  const unused = character("reloadedunused", "league", { login: false });
  unused.setAttribute("league:type", 6);
  unused.setAttribute("league:relics", { ...picks, 6: 2 });
  hooks.onPlayerLogin({ player: unused, username: "reloadedunused", isNewAccount: false, profile: "league" });
  assert.deepEqual(REPICK.map((id) => unused.sent.varbits.get(id)), [1, 1, 1, 1, 1, 1, 0, 0], "an unused Reloaded marks its tiers again at login");
});
