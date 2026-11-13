// Run after `yarn build`: node --test tests/group-ironman.test.cjs
// GroupIronman.plugin.js with Grouping and GroupStorage: a group's mode and forming it, who may join,
// Hardcore lives, what a leaver becomes, Unranked by way of the Lumbridge tutor, and new members'
// wealth limits on trades and storage.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, beforeEach, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { Misc } = require("../dist/util/Misc");
const { DisplayNames } = require("../dist/game/entity/impl/player/DisplayNames");
const Grouping = require("../plugins/interface/Grouping.plugin");
const GroupStorage = require("../plugins/interface/GroupStorage.plugin");
const GroupIronman = require("../plugins/modes/GroupIronman.plugin");

const { Common, Hardcore, Leaving, Store, Unranked, Variants, Wealth } = GroupIronman._test;
const Groups = Grouping._test.Store;
const GroupLeaving = Grouping._test.Leaving;
const Storage = GroupStorage._test;

const COINS = 995;
const WHIP = 4151;
const BANDOS_CHESTPLATE = 11832; // 290,010 coins' worth
const FIRE_CAPE = 6570; // untradeable
const DAY_MS = 24 * 60 * 60 * 1000;

let core;
let dir;
let online;
let handlers;
let hooks;

const encoded = (name) => Misc.stringToLongBigInt(name);
const said = (player) => player.log.messages.at(-1);
const message = (key, values) => Common.message(key, values);

function emit(name, payload) {
  for (const handler of handlers.get(name) ?? []) handler(payload);
  return payload;
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const real = PluginManager.getCoreApi();
  const World = {
    getPlayers: () => ({ search: (filter) => online.find(filter) ?? null, forEach: (action) => online.forEach(action) }),
  };
  // Teleports land at once here: the travel itself is the core's.
  const TeleportHandler = { checkReqs: () => true, confirm: (player, to, proceed) => proceed(), teleport: (player, to) => player.moveTo(to) };
  core = { ...real, World, TeleportHandler, WorldDefinition: { isMembersWorld: () => true } };
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-ironman-"));
  process.env[Groups.FILE_ENV] = path.join(dir, "groups.json");
  process.env[Store.FILE_ENV] = path.join(dir, "group-ironman.json");
  process.env[Storage.Store.FILE_ENV] = path.join(dir, "group-storage.json");
  process.env[DisplayNames.FILE_ENV] = path.join(dir, "display-names.json");
  DisplayNames.reset();
  Groups.reset();
  Store.reset();
  Storage.Store.reset();
  online = [];
  handlers = new Map();
  hooks = new Map();
  const add = (key, handler) => hooks.set(key, [...(hooks.get(key) ?? []), handler]);
  const api = new Proxy({
    core,
    persistAttribute() {},
    registerCustomInterface() {},
    registerCommand: (name, handler) => add(`command:${name}`, handler),
    onObjectInteraction: (name, actions) => add(`object:${name}`, actions),
    onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    emitCustomEvent: (name, payload) => emit(name, payload),
  }, { get: (target, key) => (key in target ? target[key] : (...args) => add(String(key), args.at(-1))) });
  Grouping.register(api);
  GroupStorage.register(api);
  GroupIronman.register(api);
  // The Ironman plugin's answers, kept in the attribute it keeps.
  handlers.set("ironman:mode", [(query) => {
    query.mode = query.player?.getAttribute?.("ironman:mode") ?? "none";
  }]);
  handlers.set("ironman:set-mode", [(request) => {
    request.player.setAttribute("ironman:mode", request.mode === "none" ? null : request.mode);
    request.handled = true;
  }]);
});

afterEach(() => {
  DisplayNames.reset();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A real player, logged in, whose messages and opened interfaces are recorded. */
function account(name, mode = "group") {
  const player = new Player(null);
  player.setUsername(name);
  if (mode) player.setAttribute("ironman:mode", mode);
  const log = { messages: [], interfaces: [] };
  const known = {
    sendMessage(text) { log.messages.push(text); return sender; },
    sendInterface(id) { log.interfaces.push(id); player.setInterfaceId(id); return sender; },
    sendInterfaceRemoval() { player.setInterfaceId(-1); return sender; },
  };
  const sender = new Proxy(known, { get: (target, key) => (key in target ? target[key] : () => sender) });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => log.messages.push(text);
  player.getRelations = () => ({ hasIgnore: () => false, isVisibleTo: () => true });
  online.push(player);
  Object.assign(player, { log });
  for (const handler of hooks.get("onPlayerLogin") ?? []) handler({ player, username: name });
  return player;
}

const command = (name, player, ...words) => {
  for (const handler of hooks.get(`command:${name}`)) handler({ player, parts: [name, ...words.join(" ").split(" ").filter(Boolean)] });
  return said(player);
};
const group = (player, ...words) => command("group", player, ...words);
const gim = (player, ...words) => command("gim", player, ...words);
const groupOf = (player) => Groups.groupOf("main", encoded(player.getUsername()));
const recordOf = (player) => Store.get(groupOf(player).id);
const modeOf = (player) => player.getAttribute("ironman:mode") ?? "none";
let clock = 0;
const realNow = performance.now;
/** Lets Grouping's two-second wait between invitations pass. */
function wait() {
  clock += 3000;
  performance.now = () => clock;
}

function formed(leader, ...members) {
  for (const member of members) {
    wait();
    group(leader, "invite", member.getUsername());
    group(member, "accept");
  }
  gim(leader, "form");
}

function leaveAndSettle(player) {
  group(player, "leave");
  GroupLeaving.settle(Date.now() + GroupLeaving.LEAVING_MS + 1000);
}

function choose(player, button) {
  const buttonId = core.CacheDefinitions.getComponentId(`gim_leaving:${button}`);
  for (let i = 0; i < 2; i++) Leaving.click({ player, buttonId, action: 1, handled: false });
}

test.after?.(() => {
  performance.now = realNow;
});

// --- A group's mode, forming it, joining -----------------------------------------------------

test("a group plays its leader's mode; forming makes originals and prestige; Hardcore gets a life per member and no newcomers", () => {
  const alice = account("alice", "group-hardcore");
  const bob = account("bob", "group-hardcore");
  const carl = account("carl", "group");
  wait();
  assert.equal(group(alice, "invite", "carl"), message("variantMismatch"));
  formed(alice, bob);
  const record = recordOf(alice);
  assert.deepEqual([record.variant, record.prestige, record.lives], ["hardcore", true, 2]);
  assert.deepEqual(record.originals.sort(), ["alice", "bob"]);
  assert.ok(bob.log.messages.includes(message("formed")));
  assert.equal(gim(bob, "form"), "Only the group leader can do that.");
  assert.equal(gim(alice, "form"), message("alreadyFormed"));

  const dana = account("dana", "group-hardcore");
  wait();
  assert.equal(group(alice, "invite", "dana"), message("hardcoreNoNewMembers"));
  assert.ok(carl && dana);
});

test("a formed group is warned before an invitation costs its prestige, and loses it when the player joins", () => {
  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  assert.equal(recordOf(alice).prestige, true);
  const carl = account("carl");
  wait();
  assert.equal(group(alice, "invite", "carl"), message("warnPrestige"));
  wait();
  assert.equal(group(alice, "invite", "carl"), "You invite carl to join your group.");
  group(carl, "accept");
  assert.equal(recordOf(alice).prestige, false);
  assert.ok(bob.log.messages.includes(message("prestigeLost")));
  assert.equal(recordOf(alice).originals.includes("carl"), false, "a newcomer has no individual prestige");
});

test("a ranked group that takes a player who has played before becomes Unranked; an Unranked group makes its joiners Unranked", () => {
  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  const eve = account("eve");
  eve.setAttribute(Variants.EXPERIENCED_ATTRIBUTE, true);
  wait();
  assert.equal(group(alice, "invite", "eve"), message("warnUnranked", { name: "eve" }));
  wait();
  group(alice, "invite", "eve");
  group(eve, "accept");
  assert.equal(recordOf(alice).variant, "unranked");
  assert.deepEqual([alice, bob].map(modeOf), ["group-unranked", "group-unranked"]);
  assert.ok(bob.log.messages.includes(message("nowUnranked")));

  const frank = account("frank");
  wait();
  group(alice, "invite", "frank");
  group(frank, "accept");
  assert.equal(modeOf(frank), "group-unranked");
  assert.equal(said(frank), message("youAreUnranked"));

  const gina = account("gina", "group-unranked");
  const hank = account("hank");
  wait();
  assert.equal(group(hank, "invite", "gina"), message("warnUnranked", { name: "gina" }), "an Unranked player would turn a ranked group too");
});

// --- Hardcore lives ----------------------------------------------------------------------------

test("a Hardcore group loses a life at a dangerous or unsafe death and when someone leaves; at none it is a Group Ironman group", () => {
  const alice = account("alice", "group-hardcore");
  const bob = account("bob", "group-hardcore");
  const carl = account("carl", "group-hardcore");
  formed(alice, bob, carl);
  const die = (player, itemsLost) => {
    for (const handler of hooks.get("onPlayerDeath")) handler({ player, itemsLost, handled: false });
  };
  die(alice, true);
  assert.equal(recordOf(alice).lives, 2);
  assert.ok(bob.log.messages.includes(message("lifeLost", { name: "alice", lives: 2, livesWord: "lives" })));
  die(alice, false);
  assert.equal(recordOf(alice).lives, 2, "a safe death costs nothing");
  bob.getArea = () => ({ pluginName: "PestControl", getName: () => "Pest Control" });
  die(bob, false);
  assert.equal(recordOf(alice).lives, 1, "Pest Control is unsafe for a Hardcore group");

  leaveAndSettle(carl);
  const record = recordOf(alice);
  assert.deepEqual([record.lives, record.variant], [0, "ranked"]);
  assert.deepEqual([alice, bob].map(modeOf), ["group", "group"]);
  assert.ok(alice.log.messages.includes(message("hardcoreLost")));
});

// --- Leaving -----------------------------------------------------------------------------------

test("a leaver chooses: Ranked deletes their tradeables and leads a new group, Unranked keeps items, Regular stops being an Ironman", () => {
  const alice = account("alice");
  const bob = account("bob");
  const carl = account("carl");
  const dana = account("dana");
  formed(alice, bob, carl, dana);
  bob.getInventory().adds(COINS, 500).adds(WHIP, 1).adds(FIRE_CAPE, 1);
  bob.getBank(0).adds(COINS, 1000);

  leaveAndSettle(bob);
  assert.equal(groupOf(bob), undefined);
  assert.equal(bob.getInterfaceId(), core.CacheDefinitions.getInterfaceId("gim_leaving"));
  assert.equal(Store.hasPendingChoice("bob"), true);
  choose(bob, "gim_competitive_button");
  assert.equal(bob.getInventory().getAmount(COINS), 0);
  assert.equal(bob.getInventory().getAmount(WHIP), 0);
  assert.equal(bob.getInventory().getAmount(FIRE_CAPE), 1, "untradeables stay");
  assert.equal(bob.getBank(0).getAmount(COINS), 0);
  assert.deepEqual([modeOf(bob), bob.getAttribute(Variants.EXPERIENCED_ATTRIBUTE)], ["group", true]);
  assert.equal(groupOf(bob).leader, encoded("bob"), "they lead a new group");
  assert.equal(recordOf(bob).variant, "ranked");
  assert.equal(Store.hasPendingChoice("bob"), false);

  carl.getInventory().adds(WHIP, 1);
  leaveAndSettle(carl);
  choose(carl, "gim_button");
  assert.deepEqual([modeOf(carl), carl.getInventory().getAmount(WHIP), recordOf(carl).variant], ["group-unranked", 1, "unranked"]);

  leaveAndSettle(dana);
  const one = core.CacheDefinitions.getComponentId("gim_leaving:main_button");
  Leaving.click({ player: dana, buttonId: one, action: 1, handled: false });
  assert.equal(modeOf(dana), "group", "one click only selects");
  Leaving.click({ player: dana, buttonId: one, action: 1, handled: false });
  assert.deepEqual([modeOf(dana), groupOf(dana)], ["none", undefined]);
});

test("a choice waits for the leaver's next login, saved across a restart", () => {
  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  group(bob, "leave");
  online = online.filter((player) => player !== bob);
  for (const handler of hooks.get("onPlayerLogout")) handler({ player: bob });
  GroupLeaving.settle(Date.now() + GroupLeaving.LEAVING_MS + 1000);
  Store.reset();
  const back = account("bob");
  assert.equal(back.getInterfaceId(), core.CacheDefinitions.getInterfaceId("gim_leaving"));
  assert.ok(alice);
});

// --- Unranked by way of the Lumbridge tutor ---------------------------------------------------

test("becoming Unranked off the island takes seven days; choosing it again calls it off", () => {
  const iron = account("iron", "ironman");
  const change = (player, from, upgrades = false) =>
    emit("ironman:change-mode", { player, from, to: "group-unranked", upgrades, allowed: true, reason: null });
  const first = change(iron, "ironman");
  assert.deepEqual([first.allowed, first.reason], [false, message("unrankedSwitchPending", { days: 7 })]);
  assert.equal(change(iron, "ironman").reason, message("unrankedSwitchCancelled"));
  change(iron, "ironman");
  Unranked.settle(iron, Date.now() + 6 * DAY_MS);
  assert.equal(modeOf(iron), "ironman");
  Unranked.settle(iron, Date.now() + 8 * DAY_MS);
  assert.equal(modeOf(iron), "group-unranked");

  const main = account("main", null);
  assert.equal(change(main, "none").reason, message("unrankedOnlyIron"));
  assert.equal(change(account("islander", "ironman"), "ironman", true).allowed, true, "on the island it is immediate");
});

// --- Wealth limits -----------------------------------------------------------------------------

test("a new member's receipts from the group are limited week by week, on trades and at storage Save", () => {
  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  const carl = account("carl");
  wait();
  group(alice, "invite", "carl");
  wait();
  group(alice, "invite", "carl");
  group(carl, "accept");
  assert.equal(Wealth.remaining(carl), 1_000_000);
  assert.equal(Wealth.remaining(alice), null, "originals have no limit");

  const offering = (player, items) => {
    player.getTrading = () => ({ getContainer: () => ({ getValidItems: () => items }) });
  };
  const canTrade = (player, target) => {
    const event = { player, target, allow: null };
    for (const handler of hooks.get("onCanTrade")) handler(event);
    return event.allow;
  };
  offering(alice, [new Item(COINS, 1_000_001)]);
  offering(carl, []);
  assert.equal(canTrade(alice, carl), false);
  assert.equal(said(carl), message("capReached", { left: "1,000,000" }));
  offering(alice, [new Item(COINS, 600_000)]);
  assert.equal(canTrade(alice, carl), null);
  for (const handler of hooks.get("onTradeCompleted")) handler({ player: carl, partner: alice, received: [new Item(COINS, 600_000)], given: [] });
  assert.equal(Wealth.remaining(carl), 400_000);

  Storage.Store.commit(groupOf(alice).id, [{ id: BANDOS_CHESTPLATE, amount: 2 }]);
  const takeOut = (amount) => {
    const request = { player: carl, groupId: groupOf(alice).id, items: [{ id: BANDOS_CHESTPLATE, amount }], allowed: true, reason: null };
    emit("group-storage:can-withdraw", request);
    if (request.allowed !== false) emit("group-storage:withdrawn", request);
    return request.allowed;
  };
  assert.equal(takeOut(2), false, "580,020 coins' worth is over what is left");
  assert.equal(takeOut(1), true);
  assert.equal(Wealth.remaining(carl), 400_000 - 290_010);
  assert.equal(emit("group-storage:limit", { player: carl, groupId: groupOf(alice).id, remaining: null }).remaining, 109_990);

  assert.equal(Wealth.remaining(carl, Date.now() + 2 * Wealth.WEEK_MS), 50_000_000 - 890_010, "the third week's limit");
  assert.equal(Wealth.remaining(carl, Date.now() + 4 * Wealth.WEEK_MS), null, "none from the fifth week");
});

// --- Item restrictions and prestige lost to outside help ---------------------------------------

const npcNamed = (name) => ({ getDefinition: () => ({ getName: () => name }) });

test("a newcomer can't equip a listed unique until they have killed its source; originals and the Gauntlet's own gear are free", () => {
  const { Restrictions } = GroupIronman._test;
  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  const carl = account("carl");
  wait();
  group(alice, "invite", "carl");
  wait();
  group(alice, "invite", "carl");
  group(carl, "accept");
  const equip = (player, id) => {
    const event = { player, slot: 4, item: new Item(id, 1), allow: null };
    for (const handler of hooks.get("onCanEquip")) handler(event);
    return event.allow;
  };
  assert.equal(equip(carl, BANDOS_CHESTPLATE), false);
  assert.equal(said(carl), message("restrictedItem", { source: "General Graardor" }));
  assert.equal(equip(alice, BANDOS_CHESTPLATE), null, "an original member wears it");
  handlers.set("collection-log:kill-count", [(query) => {
    if (query.category === "General Graardor") query.count = 1;
  }]);
  assert.equal(equip(carl, BANDOS_CHESTPLATE), null, "after one Graardor kill");

  assert.equal(equip(carl, WHIP), false);
  emit("npc-drops:roll", { player: carl, npc: npcNamed("Abyssal demon"), drops: [], damagers: [carl] });
  assert.equal(equip(carl, WHIP), null, "after an abyssal demon kill");
  const basicHelm = 23886; // Crystal helm (basic), the Gauntlet's own
  assert.equal(equip(carl, basicHelm), null);
  assert.equal(Restrictions.restricted(carl, Date.now() + 5 * Wealth.WEEK_MS), false, "over after five weeks");
});

test("a prestige boss kill someone outside the group helped with costs Group Prestige", () => {
  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  const stranger = account("stranger", null);
  emit("npc-drops:roll", { player: alice, npc: npcNamed("Nex"), drops: [], damagers: [alice, bob] });
  assert.equal(recordOf(alice).prestige, true, "group mates are no outsiders");
  emit("npc-drops:roll", { player: alice, npc: npcNamed("Zulrah"), drops: [], damagers: [alice, stranger] });
  assert.equal(recordOf(alice).prestige, true, "Zulrah isn't on the list");
  emit("npc-drops:roll", { player: alice, npc: npcNamed("Nex"), drops: [], damagers: [alice, stranger] });
  assert.equal(recordOf(alice).prestige, false);
  assert.ok(bob.log.messages.includes(message("prestigeLost")));
});

// --- The Node and group names --------------------------------------------------------------------

test("Group Ironmen reach The Node from Tutorial Island, the Lumbridge portal and the helm; its portal leads back and marks them as having played", () => {
  const { Node } = GroupIronman._test;
  const alice = account("alice");
  const main = account("main", null);
  assert.deepEqual(emit("tutorial-island:destination", { player: alice, location: null }).location, Node.NODE_ARRIVAL);
  assert.equal(emit("tutorial-island:destination", { player: main, location: null }).location, null);

  const portal = (player, name) => {
    let handled = false;
    for (const actions of hooks.get("object:Portal")) handled = actions.Enter({ player, objectId: core.CacheDefinitions.getLocId(name) }) || handled;
    return handled;
  };
  const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
  assert.equal(portal(alice, "gim_portal_lumbridge_portal"), true);
  assert.deepEqual(at(alice), [Node.NODE_ARRIVAL.x, Node.NODE_ARRIVAL.y]);
  assert.equal(alice.getAttribute(Variants.EXPERIENCED_ATTRIBUTE) ?? false, false);
  portal(alice, "gim_portal");
  assert.deepEqual(at(alice), [Node.LUMBRIDGE_ARRIVAL.x, Node.LUMBRIDGE_ARRIVAL.y]);
  assert.equal(alice.getAttribute(Variants.EXPERIENCED_ATTRIBUTE), true, "the mainland makes them experienced");
  portal(main, "gim_portal_lumbridge_portal");
  assert.equal(said(main), Node.MESSAGE.NOT_GROUP_IRONMAN);
  assert.equal(portal(main, "poh_portal_rimmington") || false, false, "other portals aren't The Node's");

  Node.helmTeleport({ player: alice });
  assert.deepEqual(at(alice), [Node.NODE_ARRIVAL.x, Node.NODE_ARRIVAL.y]);
});

test("Tony's armour shows the group's size on the platebody, the Hardcore set for Hardcore; Maggie's bank is for new adventurers", () => {
  const { Node } = GroupIronman._test;
  const ids = core.ItemIdentifiers;
  const alice = account("alice");
  const bob = account("bob");
  const carl = account("carl");
  formed(alice, bob, carl);
  assert.equal(Node.giveArmour(alice), "There you go. Wear it with pride.");
  assert.deepEqual([ids.GROUP_IRONMAN_HELM, ids.GROUP_IRONMAN_PLATEBODY_3, ids.GROUP_IRONMAN_PLATELEGS, ids.GROUP_IRONMAN_BRACERS]
    .map((id) => alice.getInventory().getAmount(id)), [1, 1, 1, 1], "platebody03 for a group of three");
  assert.equal(Node.giveArmour(alice), "I think you've already got the whole set.");
  const hc = account("hc", "group-hardcore");
  Node.giveArmour(hc);
  assert.equal(hc.getInventory().getAmount(ids.HARDCORE_GROUP_IRONMAN_PLATEBODY), 1, "platebody02 when not in a group");

  let opened = 0;
  bob.getBank = () => ({ open: () => opened++ });
  Node.bank({ player: bob });
  assert.equal(opened, 1);
  bob.setAttribute(Variants.EXPERIENCED_ATTRIBUTE, true);
  Node.bank({ player: bob });
  assert.deepEqual([opened, said(bob)], [1, Node.BANK_REFUSED]);
});

test("a leader renames the group through Tony; names are at most 12 letters, numbers or spaces, and unique among groups and clans", () => {
  const { Node } = GroupIronman._test;
  const { Names } = Grouping._test;
  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  const tony = { getName: () => "Group Ironman tutor" };
  const pick = (player, option) => emit("npc-dialogue:choice", { player, definition: tony, option, end: false });
  assert.equal(pick(bob, "Rename group.").end, false, "a member hears Tony's own answer");
  const choice = pick(alice, "Rename group.");
  assert.equal(choice.end, true);
  alice.getEnteredSyntaxAction().execute("Iron Pals");
  assert.equal(groupOf(alice).name, "Iron Pals");
  assert.equal(said(bob), "Your group is now called Iron Pals.");
  assert.equal(group(alice, "name", "Far too long a name"), Names.MESSAGE.TOO_LONG);
  assert.equal(group(alice, "name", "No!"), Names.MESSAGE.BAD_CHARACTERS);
  const carl = account("carl");
  group(carl, "create");
  assert.equal(group(carl, "name", "iron pals"), Names.MESSAGE.TAKEN);
  handlers.set("clans:name-taken", [(query) => { query.taken = query.name.toLowerCase() === "clanners"; }]);
  assert.equal(group(carl, "name", "Clanners"), Names.MESSAGE.TAKEN);

  pick(bob, "Yes, leave my group.");
  assert.ok(groupOf(alice).leaving.has(encoded("bob")), "Tony starts the leave");
});

// --- The Group Ironman tab ---------------------------------------------------------------------------

/** Records what the server sends the player: packet-sender calls and raw packets. */
function recording(player) {
  const calls = [];
  const packets = [];
  const base = player.getPacketSender();
  const sender = new Proxy({}, {
    get: (target, key) => (...args) => {
      calls.push([String(key), ...args]);
      base[key](...args);
      return sender;
    },
  });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: (packet) => packets.push(packet) });
  return { calls, packets, scripts: (id) => calls.filter(([name, script]) => name === "sendClientScript" && script === id) };
}

function tabOf(player) {
  const request = emit("side-channels:gim-tab", { player, tab: null, group: null, onMount: null });
  request.onMount?.();
  return request;
}

function clickTab(player, component, slot) {
  const { Tab } = GroupIronman._test;
  const event = { player, buttonId: core.CacheDefinitions.getComponentId(component), action: 1, slot, handled: false };
  Tab.click(event);
  return event;
}

test("the Group Ironman tab: Create Group on The Node, the creation panel while forming, the group as clan type 1 once formed", () => {
  const { Tab, Node } = GroupIronman._test;
  const ids = (name) => core.CacheDefinitions.getInterfaceId(name);
  const alice = account("alice");
  const bob = account("bob");
  const main = account("main", null);
  const sent = recording(alice);
  assert.equal(tabOf(main).tab, null, "not a Group Ironman: no tab");

  let tab = tabOf(alice);
  assert.deepEqual([tab.tab, tab.group], [4, ids("gim_limited_sidepanel")]);
  assert.deepEqual(sent.scripts(5261).at(-1).slice(3), [0, core.CacheDefinitions.getComponentId("gim_limited_sidepanel:text"), Tab.MESSAGE.NO_GROUP]);
  clickTab(alice, "gim_limited_sidepanel:button");
  assert.equal(groupOf(alice), undefined, "Create Group only on The Node");

  alice.moveTo(new core.Location(Node.NODE_ARRIVAL.x, Node.NODE_ARRIVAL.y, 0));
  tabOf(alice);
  assert.equal(sent.scripts(5261).at(-1)[3], 1, "the button shows on The Node");
  clickTab(alice, "gim_limited_sidepanel:button");
  assert.ok(groupOf(alice), "Create Group makes a group");
  wait();
  group(alice, "invite", "bob");
  group(bob, "accept");

  tab = tabOf(alice);
  assert.equal(tab.group, ids("gim_creation_sidepanel"));
  assert.deepEqual(sent.scripts(4448).at(-1).slice(3), ["alice", "bob", "", "", "", "alice"]);
  assert.ok(sent.calls.some(([name, uid]) => name === "sendInterfaceFlagsRange" && uid === core.CacheDefinitions.getComponentId("gim_creation_sidepanel:contents")),
    "the leader's Kick on the member list");

  clickTab(bob, "gim_creation_sidepanel:confirm");
  assert.equal(recordOf(alice).formed, 0, "only the leader confirms");
  clickTab(alice, "gim_creation_sidepanel:confirm");
  assert.ok(recordOf(alice).formed > 0);

  const before = sent.packets.length;
  tab = tabOf(alice);
  assert.equal(tab.group, ids("gim_sidepanel"));
  assert.ok(sent.packets.length >= before + 2, "clan settings and channel, type 1");
  const settings = Tab.settingsSnapshot(groupOf(alice) && emit("grouping:get", { player: alice }).group, recordOf(alice));
  assert.deepEqual(settings.members.map(({ name, rank, extraInfo }) => [name, rank, extraInfo]),
    [["alice", 126, 1 << 28], ["bob", 0, 1 << 28]], "the leader owns it; originals have the prestige star");
  assert.equal(settings.ownerSlot, 0);
  assert.deepEqual(settings.settings.map(({ id, value }) => [id, value]), [[37, 2], [39, 1], [40, 0], [41, 0]]);

  const hc = account("hc", "group-hardcore");
  assert.equal(tabOf(hc).tab, 5);
  assert.equal(tabOf(account("loner", "group-unranked")).tab, 6);
});

test("the creation panel's Kick and Cancel act at once while the group forms; once formed, leaving takes seven days", () => {
  const alice = account("alice");
  const bob = account("bob");
  const carl = account("carl");
  group(alice, "create");
  for (const member of [bob, carl]) {
    wait();
    group(alice, "invite", member.getUsername());
    group(member, "accept");
  }
  clickTab(alice, "gim_creation_sidepanel:contents", 2);
  assert.equal(groupOf(carl), undefined, "carl removed at once");
  clickTab(bob, "gim_creation_sidepanel:cancel");
  assert.equal(groupOf(bob), undefined, "bob left at once");
  const gimLeaving = core.CacheDefinitions.getInterfaceId("gim_leaving");
  assert.equal(bob.log.interfaces.includes(gimLeaving), false, "no choice for leaving a group that never formed");
  const id = groupOf(alice).id;
  clickTab(alice, "gim_creation_sidepanel:cancel");
  assert.equal(groupOf(alice), undefined, "the leader's Cancel ends the group");
  assert.equal(Store.get(id), null);

  const dana = account("dana");
  formed(dana, bob);
  group(bob, "leave");
  assert.ok(groupOf(dana).leaving.has(encoded("bob")), "a formed group keeps its leaver for seven days");
  assert.equal(group(dana, "disband"), Grouping._test.Leadership.MESSAGE.NO_DISBAND);
});

test("the tab follows changes: Grouping's for the players they touch, the group's record for its members", () => {
  const refreshed = [];
  handlers.set("side-channels:refresh", [({ player }) => refreshed.push(player.getUsername())]);
  const alice = account("alice");
  const bob = account("bob");
  group(alice, "create");
  assert.ok(refreshed.includes("alice"));
  wait();
  group(alice, "invite", "bob");
  refreshed.length = 0;
  group(bob, "accept");
  assert.deepEqual([...new Set(refreshed)].sort(), ["alice", "bob"]);
  refreshed.length = 0;
  gim(alice, "form");
  assert.deepEqual([...new Set(refreshed)].sort(), ["alice", "bob"], "forming redraws both");
});

// --- Storage unlocks, group settings, group chat, house teleports, inviting ---------------------

const RUNE_PLATEBODY = 1127;
const WEEK = 7 * DAY_MS;

/** Ages the group's record as if it had been formed `weeks` ago. */
function formedAgo(player, weeks) {
  const record = recordOf(player);
  record.formed = Date.now() - weeks * WEEK;
  Store.update(record);
}

test("storage unlocks: the cache's 49 tasks add 120 spaces; one counts once a member opens the storage after doing it, from the group's fifth week", () => {
  const { Unlocks } = GroupIronman._test;
  const tasks = Unlocks.taskList();
  assert.equal(tasks.length, 49);
  assert.equal(tasks.reduce((sum, task) => sum + task.slots, 0), 120, "80 + 120 = the Wiki's 200");
  assert.ok(tasks.every((task) => task.condition), "every cache task has its condition");
  assert.match(tasks[0].text, /Rune Platebody/);

  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  const capacity = (player) => emit("group-storage:capacity", { player, groupId: groupOf(alice).id, capacity: 80 }).capacity;
  alice.getEquipment().setItem(core.Equipment.BODY_SLOT, new Item(RUNE_PLATEBODY, 1));
  assert.equal(capacity(alice), 80, "not before five weeks");
  assert.deepEqual(recordOf(alice).unlocks, []);

  formedAgo(alice, 5);
  assert.equal(capacity(alice), 83);
  assert.ok(bob.log.messages.includes(message("storageUnlocked", { slots: 3, total: 83 })));
  alice.getEquipment().setItem(core.Equipment.BODY_SLOT, new Item(-1, 0));
  assert.equal(capacity(bob), 83, "an unlock is the group's for good");

  bob.getSkillManager().setMaxLevels(core.Skill.MINING, 99, false);
  assert.equal(capacity(bob), 83 + 3 + 2, "99 Mining: the gathering-skill task and the Mining one");
  assert.deepEqual(Unlocks.bitWords(recordOf(alice)), [(1 << 0) | (1 << 2) | (1 << 22), 0]);

  const snapshot = emit("grouping:get", { player: alice });
  Storage.Access.open({ player: alice, group: snapshot.group, member: snapshot.member, handled: false });
  assert.equal(Storage.Session.current(alice).storage.length, 88, "the storage draws the group's spaces");
});

test("group settings: Group Storage shows the unlocks in its popup; Leave Group and Cancel Leave", () => {
  const { Settings } = GroupIronman._test;
  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  const click = (player, name) => Settings.click({ player, buttonId: core.CacheDefinitions.getComponentId(`gim_settings:${name}`), action: 1, handled: false });
  const mounts = [];
  const sender = bob.getPacketSender();
  const recording = new Proxy(sender, {
    get: (target, key) => (key === "sendSubInterface" ? (uid, id) => { mounts.push([uid, id]); return recording; } : target[key]),
  });
  bob.getPacketSender = () => recording;
  click(bob, "storage_unlocks");
  assert.deepEqual(mounts.at(-1), [core.CacheDefinitions.getComponentId("gim_settings:popup"), core.CacheDefinitions.getInterfaceId("gim_shared_bank_unlocks")]);
  click(bob, "quit");
  assert.ok(groupOf(alice).leaving.has(encoded("bob")), "Leave Group starts the leave");
  click(bob, "quit");
  assert.equal(groupOf(alice).leaving.has(encoded("bob")), false, "Cancel Leave takes it back");
  click(bob, "hiscores");
  assert.equal(said(bob), Settings.MESSAGE.NOT_AVAILABLE);
});

test("group chat: a line on clan type 1 reaches the group's members online, as clan chat on a channel named with a bar", () => {
  const { Chat } = GroupIronman._test;
  const alice = account("alice");
  const bob = account("bob");
  const stranger = account("stranger");
  formed(alice, bob);
  emit("grouping:rename", { player: alice, name: "Iron Pals" });
  const heard = new Map();
  for (const player of [alice, bob, stranger]) {
    const name = player.getUsername();
    player.getSession = () => ({ sendClientPacket: (packet) => heard.set(name, [...(heard.get(name) ?? []), packet]) });
    player.getHostAddress = () => "127.0.0.1";
  }
  const say = (clanType, text) => {
    const event = { player: alice, packet: { type: "clan_chat", clanType, text }, handled: false };
    for (const handler of hooks.get("onSocialPacket")) handler(event);
    return event;
  };
  assert.equal(say(1, "hello group").handled, true);
  assert.equal(heard.get("bob")?.length, 1);
  assert.equal(heard.get("alice")?.length, 1);
  assert.equal(heard.get("stranger"), undefined);
  const line = heard.get("bob")[0].toString("latin1");
  assert.ok(line.includes("|Iron Pals"), "the channel name starts with the bar the cache looks for");
  assert.equal(Chat.channelName({ name: "" }), "|Group");
  assert.equal(say(0, "clan").handled, false, "clan type 0 is the clan's own");
});

test("Teleport to House's Group options: Choose lists the group's members online, Previous goes back to the last one", () => {
  const { Houses } = GroupIronman._test;
  const alice = account("alice");
  const bob = account("bob");
  const picked = [];
  const ask = (player, previous) => emit("teleports:group-house", { player, previous, pick: (owner) => picked.push(owner.getUsername()), handled: false });
  assert.equal(ask(alice, false).handled, false, "no group: SpellTeleports says live's line");
  formed(alice, bob);
  assert.equal(ask(alice, true).handled, true);
  assert.equal(said(alice), Houses.MESSAGE.NO_PREVIOUS);
  ask(alice, false);
  hooks.get("sendMultiChatboxPrompt").at(-1)();
  assert.deepEqual(picked, ["bob"]);
  ask(alice, true);
  assert.deepEqual(picked, ["bob", "bob"], "Previous: the same house");
  online.splice(online.indexOf(bob), 1);
  for (const handler of hooks.get("onPlayerLogout") ?? []) handler({ player: bob });
  ask(alice, true);
  assert.equal(said(alice), Houses.MESSAGE.PREVIOUS_OFFLINE);
});

test("inviting on The Node without commands: Apply invites, the invitee gets live's chat line, and Apply back on the inviter accepts", () => {
  const { Recruiting, Node } = GroupIronman._test;
  const alice = account("alice");
  const bob = account("bob");
  const carl = account("carl");
  const lines = [];
  for (const player of [alice, bob, carl]) {
    player.moveTo(new core.Location(Node.NODE_ARRIVAL.x, Node.NODE_ARRIVAL.y, 0));
    player.getSession = () => ({ sendClientPacket: (packet) => lines.push([player.getUsername(), packet]) });
  }
  const apply = (player, target) => emit("player:option-route", { player, target, option: Recruiting.APPLY_OPTION_SLOT, handled: false });
  assert.equal(Recruiting.APPLY_OPTION_SLOT, 1, "the slot an invitation line's option uses (chat_op_core: opplayer(1, name))");

  emit("grouping:create", { player: alice });
  wait();
  apply(alice, bob);
  assert.ok(groupOf(alice).invites.has(encoded("bob")), "Apply invites");
  const line = lines.filter(([to]) => to === "bob").at(-1)?.[1];
  assert.ok(line, "the invitee gets the invitation as a chat line");
  assert.deepEqual(line, core.encodeChatMessage("game", Recruiting.MESSAGE.FORM_GROUP("alice"), "alice", "", -1, Recruiting.INVITE_CHAT_TYPE.FORMING));
  assert.equal(bob.log.messages.some((text) => text.includes("::group")), false, "no command in the invitation");

  wait();
  apply(bob, alice);
  assert.ok(groupOf(alice).members.has(encoded("bob")), "Apply back on the inviter (the chat line's option) accepts");

  wait();
  apply(bob, carl);
  assert.equal(said(bob), Recruiting.MESSAGE.NOT_LEADER, "a member who isn't the leader can't invite");

  const form = { player: alice, buttonId: core.CacheDefinitions.getComponentId("gim_creation_sidepanel:confirm"), action: 1, handled: false };
  GroupIronman._test.Tab.click(form);
  assert.ok(recordOf(alice).formed > 0, "Confirm in the creation panel forms the group");
  wait();
  apply(alice, carl);
  assert.equal(said(alice), Recruiting.MESSAGE.NOT_INVITING);
  Recruiting.toggle(alice);
  assert.equal(Recruiting.statusOf(alice, { role: "leader" }), Recruiting.STATUS.INVITING);
  wait();
  apply(alice, carl);
  assert.equal(said(alice), message("warnPrestige"), "a formed group's invitation still warns first");
  wait();
  apply(alice, carl);
  const groupWith = lines.filter(([to]) => to === "carl").at(-1)?.[1];
  assert.deepEqual(groupWith, core.encodeChatMessage("game", Recruiting.MESSAGE.GROUP_WITH("alice"), "alice", "", -1, Recruiting.INVITE_CHAT_TYPE.FORMED));

  const dana = account("dana");
  const erin = account("erin");
  emit("grouping:create", { player: dana });
  wait();
  const target = { player: dana, target: erin, spellWidget: core.CacheDefinitions.getComponentId("gim_creation_sidepanel:invite"), handled: false };
  emit("magic:spell-on-player", target);
  assert.equal(target.handled, true);
  assert.ok(groupOf(dana).invites.has(encoded("erin")), "the creation panel's Invite used on a player");
});

test("the group settings' rows: Step down picks the next leader and Cancel keeps the lead; Members removes and keeps a member", () => {
  const { Settings } = GroupIronman._test;
  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  const prompts = [];
  Common.api.sendMultiChatboxPrompt = (player, title, ...pairs) => { prompts.push({ title, pairs }); return true; };
  const scripts = [];
  const sender = alice.getPacketSender();
  const recording = new Proxy(sender, {
    get: (target, key) => (key === "sendClientScript" ? (...args) => { scripts.push(args); return recording; } : target[key]),
  });
  alice.getPacketSender = () => recording;
  const click = (name) => Settings.click({ player: alice, buttonId: core.CacheDefinitions.getComponentId(`gim_settings:${name}`), action: 1, handled: false });
  const pick = (title, option) => {
    const prompt = prompts.filter((each) => each.title === title).at(-1);
    prompt.pairs[prompt.pairs.indexOf(option) + 1]();
  };

  Settings.open(alice);
  assert.deepEqual(scripts.map(([id]) => id), [5508, 5509, 5509, 5509], "the static box, then name, leader and members rows");
  assert.deepEqual(scripts.at(-1).slice(2), [1, 0, "Members:|alice, bob|Manage"], "the leader's button; the last row draws Close");

  click("abdication");
  pick(Settings.MESSAGE.WHO_LEADS, "bob");
  assert.equal(groupOf(alice).stepDown?.successor, encoded("bob"), "bob leads in 7 days");
  click("abdication");
  assert.equal(groupOf(alice).stepDown, null, "Cancel keeps the lead");

  click("members");
  pick(Settings.MESSAGE.WHICH_MEMBER, "bob");
  pick(Settings.MESSAGE.REMOVE("bob"), "Yes, remove them.");
  assert.equal(groupOf(alice).leaving.get(encoded("bob"))?.kicked, true, "bob is being removed");
  click("members");
  pick(Settings.MESSAGE.WHICH_MEMBER, "bob");
  pick(Settings.MESSAGE.KEEP("bob"), "Yes, keep them.");
  assert.equal(groupOf(alice).leaving.has(encoded("bob")), false, "kept");

  const bobClick = { player: bob, buttonId: core.CacheDefinitions.getComponentId("gim_settings:abdication"), action: 1, handled: false };
  Settings.click(bobClick);
  assert.equal(said(bob), Settings.MESSAGE.NOT_LEADER);
});

test("the rowboat at Tutorial Island's south end takes Group Ironmen to The Node", () => {
  const { Node } = GroupIronman._test;
  const alice = account("alice");
  const main = account("main", null);
  const row = (player) => {
    let handled = false;
    for (const actions of hooks.get("object:Rowboat")) handled = actions.Travel({ player, objectId: core.CacheDefinitions.getLocId("gim_boat") }) || handled;
    return handled;
  };
  assert.equal(row(alice), true);
  assert.deepEqual([alice.getLocation().getX(), alice.getLocation().getY()], [Node.NODE_ARRIVAL.x, Node.NODE_ARRIVAL.y]);
  row(main);
  assert.equal(said(main), Node.MESSAGE.NOT_GROUP_IRONMAN);
});

test("raids with outsiders: a Hardcore group's member is refused; a group with prestige is warned, then loses it", () => {
  const alice = account("alice", "group-hardcore");
  const bob = account("bob", "group-hardcore");
  formed(alice, bob);
  const stranger = account("stranger", null);
  const check = (players) => emit("group-pvm:can-start", { players, activity: "the Chambers of Xeric", allowed: true, reason: null });
  assert.equal(check([alice, bob]).allowed, true, "group mates only");
  const refused = check([alice, stranger]);
  assert.equal(refused.allowed, false);
  assert.equal(refused.reason, message("hardcoreOutsiders", { name: "alice", activity: "the Chambers of Xeric" }));

  const carl = account("carl");
  const dana = account("dana");
  formed(carl, dana);
  assert.equal(check([carl, stranger]).allowed, true);
  assert.equal(said(carl), message("prestigeOutsidersWarning", { activity: "the Chambers of Xeric" }));
  emit("group-pvm:started", { players: [carl, dana], activity: "the Chambers of Xeric" });
  assert.equal(recordOf(carl).prestige, true, "with group mates only, it stays");
  emit("group-pvm:started", { players: [carl, stranger], activity: "the Chambers of Xeric" });
  assert.equal(recordOf(carl).prestige, false);
  assert.ok(dana.log.messages.includes(message("prestigeLost")));
});

// --- Boss doors, bans, combat achievements' team size, a ranked leaver's losses ------------------

test("a boss's door judges only the player walking in: a Hardcore member is kept out with outsiders inside, an outsider isn't kept out by them", () => {
  const alice = account("alice", "group-hardcore");
  const bob = account("bob", "group-hardcore");
  formed(alice, bob);
  const stranger = account("stranger", null);
  const door = (entrant, inside) => emit("group-pvm:can-start", { players: [entrant, ...inside], entrant, activity: "Nex", allowed: true, reason: null });
  assert.equal(door(alice, [bob]).allowed, true, "group mates only");
  const refused = door(alice, [stranger]);
  assert.equal(refused.allowed, false);
  assert.equal(refused.reason, message("hardcoreOutsidersYou", { name: "alice", activity: "Nex" }));
  assert.equal(door(stranger, [alice]).allowed, true, "a Hardcore member inside can't lock out the public");
});

test("a member banned for good costs a formed group its Group Prestige", () => {
  const alice = account("alice");
  const bob = account("bob");
  formed(alice, bob);
  const query = emit("grouping:of-account", { name: "bob", groups: [] });
  assert.deepEqual(query.groups.map((group) => group.id), [groupOf(alice).id], "found by name, as for an offline account");
  emit("account:banned", { name: "carl" });
  assert.equal(recordOf(alice).prestige, true, "someone else's ban");
  emit("account:banned", { name: "bob" });
  assert.equal(recordOf(alice).prestige, false);
  assert.ok(alice.log.messages.includes(message("prestigeLost")));
});

test("combat achievements: a Group Ironman's team is their group, 1 without one; others have no cap", () => {
  const alice = account("alice");
  const bob = account("bob");
  const main = account("main", null);
  const size = (player) => emit("combat-achievements:team-size", { player, size: null }).size;
  assert.equal(size(alice), 1);
  formed(alice, bob);
  assert.equal(size(alice), 2);
  assert.equal(size(main), null);
});

test("a ranked leaver loses tradeables, reward caskets and untradeable forms of tradeables; other untradeables stay", () => {
  const { Wipe } = GroupIronman._test;
  const named = new Map();
  const count = core.CacheDefinitions.getCounts().items;
  for (let id = 0; id < count && named.size < 6; id++) {
    const name = String(core.ItemDefinition.forId(id)?.getName?.() ?? "");
    if (["Reward casket (easy)", "Slayer helmet (i)", "Dharok's helm 100", "Scroll box (easy)", "Fire cape", "Abyssal whip"].includes(name) && !named.has(name)
      && !core.ItemDefinition.forId(id).isNoted?.()) named.set(name, id);
  }
  const lost = (name) => Wipe.lost(new Item(named.get(name), 1));
  assert.equal(named.size, 6, [...named.keys()].join(", "));
  assert.equal(lost("Abyssal whip"), true, "tradeable");
  assert.equal(lost("Reward casket (easy)"), true);
  assert.equal(lost("Slayer helmet (i)"), true, "imbued (the Wiki's test)");
  assert.equal(lost("Dharok's helm 100"), true, "degraded Barrows");
  assert.equal(lost("Scroll box (easy)"), false, "scroll boxes are kept");
  assert.equal(lost("Fire cape"), false);
});
