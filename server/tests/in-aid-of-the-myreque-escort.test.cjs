// Run after `yarn build`: node --test tests/in-aid-of-the-myreque-escort.test.cjs
//
// In Aid of the Myreque, the Escort unit, against the user's whole-quest rsprox capture (revision 242):
// Veliaf's start (t46), the Hollows talk (290 at t3278), Radigad (300 at t3347), Ivan (310 at t3362) and
// the route map (interface 53, t3364-3483), Ivan's supplies (t3384-3411, t3780-3789), the swamp ambush
// (2000, the mist, the flee at two deaths with no food t3624-3625, the escape at three t4023-4040),
// Drezel (320 at t4068, the first line skipped), the keyhole (1982, t4269) and the trapdoor (360, t4287).
// Real plugins, a real Player, PlayerSession and ClientConnection; talks are packets, ticks as World runs.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const { impliedVarbits } = require("../plugins/quests/inaid/State.InAidOfTheMyreque");

const STAGE_KEY = "quest.in_aid_of_the_myreque.stage";
const VARS = "in-aid-of-the-myreque:varbits";
const HIDEOUT = [3508, 9838, 0];
const MAUSOLEUM = [3440, 9895, 0];
const MAP = 53;
const mapUid = (child) => (MAP << 16) | child;
const VB = { BLOOD_TITHE: 1981, HELM: 1986, LEGS: 1987, BODY: 1988, CONTROL: 1989, DEATHS: 2000, ROUTE: 2001, SICKLE: 2003, FOOD: 2005, HIDEOUT: 10367, TRAPDOOR: 1982 };

let core;
let I;
let next = 8800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[3508, 9838], [2859, 4554], [3432, 3484], [3440, 9895], [3360, 9904], [3429, 3401]]) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const stage = (f) => Number(f.player.getAttribute(STAGE_KEY)) || 0;
const vb = (f, id) => Number((f.player.getAttribute(VARS) ?? {})[id]) || 0;

function actor(t, { stage: start = 0, vars = {}, items = [], at = HIDEOUT } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("myreque" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { t, player, connection, tick: 0, calls: [], said: [], messages: [], npcs: [] };
  record(f);
  t.after(() => {
    for (const npc of f.npcs) core.World.getNpcs().remove(npc);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.World.getPlayers().remove(player);
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  player.setAttribute("in-aid-of-the-myreque:save-version", 2);
  player.setAttribute(VARS, { ...impliedVarbits(start), ...vars });
  player.setAttribute(STAGE_KEY, start);
  for (const [id, amount = 1] of items) player.getInventory().add(new core.Item(id, amount), false);
  return f;
}

function meetRequirements(f) {
  for (const key of ["in_search_of_the_myreque", "nature_spirit", "priest_in_peril", "the_restless_ghost"]) {
    f.player.setAttribute(`quest.${key}.stage`, 1000);
  }
  for (const skill of [core.Skill.CRAFTING, core.Skill.MINING, core.Skill.MAGIC, core.Skill.AGILITY]) {
    f.player.getSkillManager().setMaxLevel(skill, 99).setCurrentLevel(skill, 99);
  }
}

function spawn(f, id, tile) {
  const npc = core.NPC.create(id, new core.Location(...tile));
  core.World.getNpcs().add(npc);
  f.npcs.push(npc);
  return npc;
}

const RECORDED = /^(sendVarbit|sendConfig|sendSubInterface|sendInterfaceRemoval|sendString|sendInterfaceAnimation|sendClientScript|sendItemOnInterface)$/;
function record(f) {
  const sender = f.player.getPacketSender();
  const proto = Object.getPrototypeOf(sender);
  let depth = 0;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!RECORDED.test(name) || typeof proto[name] !== "function") continue;
    const original = proto[name];
    sender[name] = function (...args) {
      if (depth === 0) f.calls.push({ tick: f.tick, name, args });
      depth++;
      try { return original.apply(this, args); } finally { depth--; }
    };
  }
  const send = f.player.sendMessage.bind(f.player);
  f.player.sendMessage = (text, ...rest) => {
    f.messages.push({ tick: f.tick, text: String(text) });
    return send(text, ...rest);
  };
}

/**
 * One world tick. With `npcs`, the player's own NPCs also run their real process() (combat
 * included) after the plugins' tasks and before the update resets placement, as World does:
 * that is where an attack on a just-moved mobile is dropped.
 */
function tick(f, { npcs = false } = {}) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  const own = npcs ? [...core.World.getNpcs()].filter((npc) => npc?.isRegistered?.() && npc.getOwner?.() === f.player) : [];
  for (const npc of own) npc.process();
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
  for (const npc of own) npc.resetUpdating();
  const line = shown(f);
  if (line && f.said.at(-1)?.text !== line.text) f.said.push({ tick: f.tick, ...line });
}
const ticks = (f, count, options) => { for (let i = 0; i < count; i++) tick(f, options); };

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", text: menu.options.join(" | "), title: menu.title };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  return { who: current.constructor.name, text: String(current.getText()).replace(/<br>/g, " ").replace(/\s+/g, " ").trim(), npcId: current.getNpcId?.() };
}

async function talk(f, npc) {
  for (let i = 0; i < 10 && f.player.busy(); i++) tick(f);
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
  for (let i = 0; i < 20 && !shown(f); i++) tick(f);
}

async function continueLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0), childIndex: -1 }]);
  tick(f);
}

async function choose(f, text) {
  const pending = MultiChatboxPrompt.getPending(f.player);
  if (!pending) assert.fail(`no menu for "${text}"; said: ${JSON.stringify(f.said.slice(-5))}`);
  const index = pending.options.findIndex((option) => option.startsWith(text));
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(pending.options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

async function until(f, text, limit = 60) {
  for (let i = 0; i < limit; i++) {
    const line = shown(f);
    if (line?.text?.startsWith(text) || (line?.who === "menu" && line.text.includes(text))) return f.tick;
    if (line && line.who !== "menu") await continueLine(f);
    else tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

function useOnNpc(f, npc, itemId) {
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  const event = { player: f.player, target: npc, definition: npc.getCurrentDefinition(f.player), npcId: npc.getCurrentDefinition(f.player).getId(),
    targetIndex: npc.getIndex(), item: f.player.getInventory().getItems()[slot], itemId, slot, interfaceId: 149 << 16, handled: false };
  PM.emitItemOnNpc(event);
  return event.handled;
}

function clickMap(f, child) {
  return PM.emitInterfaceActionClick({ player: f.player, buttonId: mapUid(child), action: 1, handled: false });
}

function objectClick(f, id, [x, y, z], option) {
  const definition = core.ObjectDefinition.forPlayer(id, f.player) ?? core.ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((entry) => entry === option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} has ${option}`);
  return PM.emitObjectInteraction({ player: f.player, object: { getId: () => id, getLocation: () => new core.Location(x, y, z) },
    objectId: id, definition, clickType, option, location: { x, y, z }, sourceLocation: { x, y, z }, handled: false });
}

const hideoutIvan = (f) => spawn(f, 9630, [3512, 9842, 0]);
const varbitSent = (f, id, value) => f.calls.some((c) => c.name === "sendVarbit" && c.args[0] === id && c.args[1] === value);
const ownedNpcs = (f, id) => [...core.World.getNpcs()].filter((npc) => npc && npc.getId() === id && npc.getOwner?.() === f.player && npc.isRegistered());

test("Veliaf's start: 20 as \"Exactly. Head down to Burgh de Rott...\" shows, not on the Yes (t28-46)", async (t) => {
  const f = actor(t);
  meetRequirements(f);
  const veliaf = spawn(f, 9620, [3506, 9838, 0]);
  await talk(f, veliaf);
  assert.equal(shown(f).text, "You're back. Any luck in Canifis?");
  await until(f, "Yes. | No.");
  await choose(f, "Yes.");
  await until(f, "And you want me to scout the place out?");
  assert.equal(stage(f), 0, "not on the option");
  await continueLine(f);
  assert.ok(shown(f).text.startsWith("Exactly. Head down to Burgh de Rott"));
  assert.equal(stage(f), 20);
});

test("Veliaf refuses the start without the requirements", async (t) => {
  const f = actor(t);
  const veliaf = spawn(f, 9620, [3506, 9838, 0]);
  await talk(f, veliaf);
  assert.equal(stage(f), 0);
  assert.ok(f.messages.some((m) => m.text.includes("In Search of the Myreque")));
});

test("Radigad, Polmafi and Ivan keep their job-offer lines at 20 (t53-69)", async (t) => {
  const f = actor(t, { stage: 20 });
  await talk(f, spawn(f, 9626, [3509, 9832, 0]));
  assert.equal(shown(f).text, "Hello again.");
  await until(f, "Hello. I hear you're doing some important work for Veliaf.");
  await continueLine(f);
  await talk(f, hideoutIvan(f));
  assert.equal(shown(f).text, "Is something new and exciting happening?");
});

test("the Hollows talk sets 290 on Continue past \"I'll see what I can dig up.\" (t3233-3278)", async (t) => {
  const f = actor(t, { stage: 280, vars: { [VB.BLOOD_TITHE]: 3 } });
  await talk(f, spawn(f, 9620, [3506, 9838, 0]));
  assert.equal(shown(f).text, "Well met, friend. Glad you made it back in one piece.");
  await until(f, "I'll see what I can dig up.");
  assert.equal(stage(f), 280);
  await continueLine(f);
  assert.equal(stage(f), 290);
  assert.ok(shown(f).text.startsWith("Before you go, do you mind telling Polmafi"));
  await until(f, "What do I need to do now?");
  assert.ok(f.said.every((s) => s.text !== "Hello again."), "the menu follows at once (t3282)");
});

test("Radigad told first: 300 as the player's line shows; Polmafi then has his \"getting my stuff\" line (t3347-3353)", async (t) => {
  const f = actor(t, { stage: 290 });
  await talk(f, spawn(f, 9626, [3508, 9832, 0]));
  assert.ok(shown(f).text.startsWith("Hey. Veliaf says it's time to head down"));
  assert.equal(stage(f), 300);
  await until(f, "Okay. Thanks for letting me know. I'll tell Polmafi.");
  await continueLine(f);
  await talk(f, spawn(f, 9628, [3513, 9837, 0]));
  assert.ok(shown(f).text.startsWith("Don't worry, I'm just getting my stuff together"));
  assert.equal(stage(f), 300);
});

test("Ivan before the others are told, then 310 on Continue past \"That's right...\" and the route map (t3356-3364)", async (t) => {
  const early = actor(t, { stage: 290 });
  await talk(early, hideoutIvan(early));
  assert.equal(shown(early).text, "Hey there. I hear you're going to be taking me to the temple.");
  await until(early, "That's right. I just need to speak with Polmafi and Radigad");

  const f = actor(t, { stage: 300 });
  await talk(f, hideoutIvan(f));
  await until(f, "That's right. We should get going soon.");
  assert.equal(stage(f), 300);
  await continueLine(f);
  assert.equal(stage(f), 310);
  assert.equal(shown(f).text, "Very well. I'm ready, lead the way.");
  await continueLine(f);
  tick(f);
  assert.equal(f.player.getInterfaceId(), MAP, "burgh_map open");
  assert.ok(f.calls.some((c) => c.name === "sendClientScript" && c.args[0] === 1281), "burgh_set_hover");
  assert.equal(shown(f), null, "no juvinate line in the hideout");
});

test("Ivan's armour: each piece taken with its varbit and the 1989 mask; the legs \"wear them\"; a repeat is refused (t3384-3401)", async (t) => {
  const f = actor(t, { stage: 310, items: [[I.STEEL_MED_HELM], [I.STEEL_CHAINBODY], [I.STEEL_PLATELEGS], [I.STEEL_MED_HELM]] });
  const ivan = hideoutIvan(f);
  assert.equal(useOnNpc(f, ivan, I.STEEL_MED_HELM), true);
  tick(f);
  assert.equal(vb(f, VB.HELM), 1);
  assert.equal(vb(f, VB.CONTROL), 1);
  assert.equal(f.player.getInventory().getAmount(I.STEEL_MED_HELM), 1);
  assert.equal(shown(f).text, "Thanks for the helmet! That's great! It's going to help a lot! I'm going to wear it under my normal clothes.");
  await continueLine(f);
  useOnNpc(f, ivan, I.STEEL_CHAINBODY);
  tick(f);
  assert.equal(vb(f, VB.CONTROL), 5);
  await continueLine(f);
  useOnNpc(f, ivan, I.STEEL_PLATELEGS);
  tick(f);
  assert.equal(vb(f, VB.LEGS), 1);
  assert.equal(vb(f, VB.CONTROL), 7);
  assert.equal(shown(f).text, "Thanks for the steel legs! That's great! It's going to help a lot! I'm going to wear them under my normal clothes.");
  await continueLine(f);
  useOnNpc(f, ivan, I.STEEL_MED_HELM);
  tick(f);
  assert.equal(shown(f).text, "Thanks for the offer of a helmet, but you've already given me one!");
  assert.equal(f.player.getInventory().getAmount(I.STEEL_MED_HELM), 1, "the second helm is kept");
});

test("the sickle: its objectbox, then 2003 and the sickle taken as Ivan answers (t3406-3411)", async (t) => {
  const f = actor(t, { stage: 300, items: [[I.SILVER_SICKLE]] });
  const ivan = hideoutIvan(f);
  useOnNpc(f, ivan, I.SILVER_SICKLE);
  tick(f);
  assert.equal(shown(f).text, "You offer the sickle to Ivan.");
  assert.equal(f.player.getPacketSender().getChatboxGroupId(), 193);
  await continueLine(f);
  assert.equal(shown(f).text, "You might find this sickle helpful on our travels.");
  assert.equal(f.player.getInventory().getAmount(I.SILVER_SICKLE), 1);
  await continueLine(f);
  assert.equal(vb(f, VB.SICKLE), 1);
  assert.equal(f.player.getInventory().getAmount(I.SILVER_SICKLE), 0);
  assert.ok(shown(f).text.startsWith("Many thanks friend, I shall endeavour"));
});

test("food: \"offer all\" hands over 8 salmon, 2005 = 8 on the box's Continue, \"another 7 bits\" (t3780-3789)", async (t) => {
  const f = actor(t, { stage: 310, items: Array.from({ length: 8 }, () => [I.SALMON]) });
  const ivan = hideoutIvan(f);
  useOnNpc(f, ivan, I.SALMON);
  tick(f);
  assert.equal(shown(f).text, "Would you like to offer Ivan all of this food type in your inventory?");
  await continueLine(f);
  await choose(f, "Yes, I'll offer all");
  await until(f, "You hand over some food to Ivan.");
  assert.equal(f.player.getInventory().getAmount(I.SALMON), 8, "the food leaves with 2005, on the box's continue (t3789)");
  assert.equal(vb(f, VB.FOOD), 0);
  await continueLine(f);
  assert.equal(f.player.getInventory().getAmount(I.SALMON), 0);
  assert.equal(vb(f, VB.FOOD), 8);
  assert.equal(shown(f).text, "Ohh delicious, some food! I'll keep that for the trip. I could carry another 7 bits of food.");
});

test("food: \"just one\" hands over one; other food gets Ivan's favourites line", async (t) => {
  const f = actor(t, { stage: 310, items: [[I.SALMON], [I.SALMON], [I.SHRIMPS]] });
  const ivan = hideoutIvan(f);
  useOnNpc(f, ivan, I.SALMON);
  tick(f);
  await continueLine(f);
  await choose(f, "Nope, I'll just given him one.");
  await until(f, "You hand over some food to Ivan.");
  await continueLine(f);
  assert.equal(vb(f, VB.FOOD), 1);
  assert.equal(f.player.getInventory().getAmount(I.SALMON), 1);
  await continueLine(f);
  useOnNpc(f, ivan, I.SHRIMPS);
  tick(f);
  assert.ok(shown(f).text.startsWith("Thanks for the kind offer of food, but my favourites"));
});

function openMapAt310(f) {
  return (async () => {
    await talk(f, hideoutIvan(f));
    await until(f, "Very well. I'm ready, lead the way.");
    await continueLine(f);
    tick(f);
    assert.equal(f.player.getInterfaceId(), MAP);
  })();
}

async function startRoute2(f, options) {
  await openMapAt310(f);
  assert.equal(clickMap(f, 28), true, "route2_layer");
  assert.ok(f.calls.some((c) => c.name === "sendClientScript" && c.args[0] === 1470), "burgh_highlight_2");
  assert.equal(clickMap(f, 37), true, "text_travel_layer2");
  assert.ok(f.messages.some((m) => m.text === "You decide to take route 2."));
  assert.deepEqual(f.calls.filter((c) => c.name === "sendInterfaceAnimation" && c.args[0] >>> 16 === MAP).map((c) => c.args), [[mapUid(18), 3561], [mapUid(19), 3561]]);
  const travelled = f.tick;
  ticks(f, 5, options);
  assert.equal(vb(f, VB.ROUTE), 0, "not before six ticks");
  tick(f, options);
  assert.equal(f.tick - travelled, 6);
  assert.equal(vb(f, VB.ROUTE), 1);
}

const juvinates = (f) => ownedNpcs(f, 4443);
function kill(npc) {
  npc.setHitpoints(0);
  npc.appendDeath();
}

test("route 2: the ambush copy with Ivan 4441, four juvinates 4443, follower varp and the juvinate's line (t3477-3484)", async (t) => {
  const f = actor(t, { stage: 310 });
  await startRoute2(f);
  assert.equal(f.player.getArea?.()?.getName?.(), "in-aid-of-the-myreque-ambush scene", "in the private copy");
  assert.notDeepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [3512, 9842], "out of the hideout");
  assert.equal(juvinates(f).length, 4);
  const [ivan] = ownedNpcs(f, 4441);
  assert.ok(ivan, "Ivan 4441");
  assert.ok(f.calls.some((c) => c.name === "sendConfig" && c.args[0] === 447 && c.args[1] === ((4441 << 16) | ivan.getIndex())));
  assert.notEqual(f.player.getInterfaceId(), MAP, "the map closes");
  tick(f);
  assert.equal(shown(f)?.text, "There's that tasty morsel Ivan! Time for some food...");
});

/** Puts an NPC `dx, dy` tiles from another mobile (instance coordinates). */
function placeNear(npc, other, dx, dy) {
  const at = other.getLocation();
  npc.moveTo(new core.Location(at.getX() + dx, at.getY() + dy, at.getZ()));
}

test("route 2: the juvinates wander; none starts on the player; one near Ivan goes for him, one at a time (t3491, t3890-3893, Wiki, #6482)", async (t) => {
  const f = actor(t, { stage: 310 });
  await startRoute2(f); // NPCs held still until the positions are set
  // Indices and flags: assert's diff of two mobiles never finishes.
  const target = (npc) => npc.getCombat().getTarget();
  const onIvan = (ivan) => juvinates(f).filter((juvinate) => target(juvinate)?.getIndex?.() === ivan.getIndex());
  const [ivan] = ownedNpcs(f, 4441);
  ticks(f, 6); // still on their spawn tile, 4 tiles from Ivan
  assert.equal(juvinates(f).every((juvinate) => target(juvinate) == null), true, "nobody engages at once (live: the player struck first, t3491)");
  const [first, second, third] = juvinates(f);
  placeNear(third, ivan, 5, 0);
  placeNear(first, ivan, 0, 3);
  ticks(f, 3, { npcs: true });
  assert.deepEqual(onIvan(ivan).map((juvinate) => juvinate.getIndex()), [first.getIndex()], "the one 3 tiles off goes for him (t3890), not the one 5 off");
  assert.equal(target(ivan)?.getIndex?.(), first.getIndex(), "Ivan fights back (t3893)");
  assert.equal(juvinates(f).some((juvinate) => target(juvinate) === f.player), false, "none on the player");
  placeNear(second, ivan, -1, 0);
  ticks(f, 2, { npcs: true });
  assert.equal(onIvan(ivan).length, 1, "one at a time");
  placeNear(second, ivan, -1, 0);
  kill(first);
  ticks(f, 2, { npcs: true });
  assert.deepEqual(onIvan(ivan).map((juvinate) => juvinate.getIndex()), [second.getIndex()], "Wiki: the next one goes for him");
});

test("Ivan flees mid-fight: the juvinates break off, even with a retaliation queued, and his line stays (t3625-3629, #6482)", async (t) => {
  const f = actor(t, { stage: 310 });
  await startRoute2(f, { npcs: true });
  ticks(f, 2);
  const [ivan] = ownedNpcs(f, 4441);
  const [onPlayer] = juvinates(f);
  f.player.getCombat().attack(onPlayer); // the player takes one on
  onPlayer.getCombat().attack(f.player, true); // and it answers
  ticks(f, 2, { npcs: true });
  assert.equal(onPlayer.getCombat().getTarget() === f.player, true, "the player is under attack");
  // A hit that landed this tick has queued the juvinate's retaliation (CombatFactory's task, keyed on it).
  const { Task } = require("../dist/game/task/Task");
  core.TaskManager.submit(new (class extends Task { execute() { onPlayer.getCombat().attack(f.player, true); this.stop(); } })(1, onPlayer, false));
  ivan.setHitpoints(1);
  ticks(f, 2, { npcs: true });
  assert.equal(ownedNpcs(f, 4441).length, 0, "Ivan is gone");
  // Before: the juvinate kept hitting the player, and its next hit closed the line (every hit
  // closes the player's interfaces), so Ivan left without a word.
  for (const juvinate of juvinates(f)) assert.equal(juvinate.getCombat().getTarget() == null, true, "only wandering");
  assert.equal(f.player.getCombat().getTarget() == null, true, "Ours: the player's fight stops too (live: their foe had just died, t3624)");
  ticks(f, 4, { npcs: true });
  assert.ok(shown(f)?.text.startsWith("I'm getting badly beaten up here"), "his line is still up");
});

test("injured Ivan with no food flees; deaths make mist; Exit path and reopening the map reset the attempt (t3577-3811)", async (t) => {
  const f = actor(t, { stage: 310 });
  await startRoute2(f);
  ticks(f, 2);
  const [first, second] = juvinates(f);
  kill(first);
  assert.equal(vb(f, VB.DEATHS), 1);
  assert.equal(first.isRegistered(), false, "gone at once");
  const mist = ownedNpcs(f, 4435);
  assert.equal(mist.length, 1, "a mist on its tile");
  ticks(f, 10);
  assert.equal(ownedNpcs(f, 4435).length, 0, "the mist fades");
  kill(second);
  assert.equal(vb(f, VB.DEATHS), 2, "2000 = 2 (t3624)");
  assert.equal(ownedNpcs(f, 4441).length, 1, "Ivan is still there on the death's tick");
  const [ivan] = ownedNpcs(f, 4441);
  ivan.setHitpoints(1); // The capture has no HP values; reproduce its failure through the health watcher.
  tick(f);
  assert.equal(ownedNpcs(f, 4441).length, 0, "Ivan leaves the tick after (t3625)");
  assert.ok(shown(f).text.startsWith("I'm getting badly beaten up here"));
  assert.equal(shown(f).npcId, 4440);
  assert.equal(stage(f), 310);
  assert.equal(objectClick(f, 12820, [2859, 4552, 0], "Escape"), true);
  tick(f);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [3429, 3401]);
  f.player.moveTo(new core.Location(...HIDEOUT));
  f.player.getDialogueManager().reset?.();
  tick(f);
  await openMapAt310(f);
  assert.equal(vb(f, VB.DEATHS), 0);
});

test("healthy Ivan can finish route two without food; a repeated death cannot repeat the arrival", async (t) => {
  const f = actor(t, { stage: 310 });
  await startRoute2(f);
  ticks(f, 2);
  const [ivan] = ownedNpcs(f, 4441);
  ivan.setHitpoints(ivan.getMaxHitpoints());
  const [first, second, third] = juvinates(f);
  kill(first);
  kill(second);
  tick(f);
  assert.equal(ownedNpcs(f, 4441).length, 1, "two enemy deaths cannot make an uninjured Ivan flee");
  assert.equal(ivan.getHitpoints(), ivan.getMaxHitpoints());
  assert.equal(vb(f, VB.FOOD), 0, "supplies are optional");
  assert.equal(stage(f), 310);
  kill(third);
  kill(third);
  assert.equal(vb(f, VB.DEATHS), 3, "the same enemy is counted once");
  assert.equal(juvinates(f).length, 0);
  ticks(f, 12);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [3432, 3484]);
  assert.equal(ownedNpcs(f, 4441).length, 1, "one arrival Ivan");
  assert.equal(stage(f), 310, "his thanks must still finish");
  await until(f, "Not a problem. I need to chat to Drezel");
  await continueLine(f);
  assert.equal(stage(f), 315);
  assert.equal(vb(f, VB.HIDEOUT), 1);
  ticks(f, 8);
  assert.equal(ownedNpcs(f, 4441).length, 0);
  assert.equal(stage(f), 315, "no repeated escort advancement");
});

test("healthy Ivan keeps unused food after two route-two enemy deaths", async (t) => {
  const f = actor(t, { stage: 310, vars: { [VB.FOOD]: 1 } });
  await startRoute2(f);
  ticks(f, 2);
  const [ivan] = ownedNpcs(f, 4441);
  ivan.setHitpoints(ivan.getMaxHitpoints());
  const [first, second] = juvinates(f);
  kill(first);
  kill(second);
  tick(f);
  assert.equal(ownedNpcs(f, 4441).length, 1);
  assert.equal(ivan.getHitpoints(), ivan.getMaxHitpoints());
  assert.equal(vb(f, VB.FOOD), 1, "food is only consumed when Ivan needs healing");
});

test("Ivan defeated without food still flees even before an enemy dies", async (t) => {
  const f = actor(t, { stage: 310 });
  await startRoute2(f);
  ticks(f, 2);
  const [ivan] = ownedNpcs(f, 4441);
  kill(ivan);
  assert.equal(ownedNpcs(f, 4441).length, 0);
  assert.equal(vb(f, VB.DEATHS), 0);
  assert.equal(stage(f), 310);
});

test("ambush with food: three deaths escape, the second leg, outside Paterdomus, 315 and 10367 on the player's line (t4023-4044)", async (t) => {
  const f = actor(t, { stage: 310, vars: { [VB.FOOD]: 8 } });
  await startRoute2(f);
  ticks(f, 2);
  for (const juvinate of juvinates(f).slice(0, 3)) kill(juvinate);
  assert.equal(vb(f, VB.DEATHS), 3);
  assert.equal(juvinates(f).length, 0, "the rest go");
  assert.equal(ownedNpcs(f, 4441).length, 0);
  tick(f);
  assert.equal(shown(f).text, "You manage to escape from the rest of the vampyre juvinates and continue on your journey.");
  const box = f.tick;
  for (let i = 0; i < 12 && f.player.getLocation().getX() !== 3432; i++) tick(f);
  assert.ok(f.calls.some((c) => c.name === "sendInterfaceAnimation" && c.args[1] === 3562), "burgh_map_route2_pt2");
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [3432, 3484]);
  assert.ok(f.tick - box >= 9);
  tick(f);
  const [ivan] = ownedNpcs(f, 4441);
  assert.deepEqual([ivan.getLocation().getX(), ivan.getLocation().getY()], [3432, 3485]);
  assert.ok(shown(f).text.startsWith("Many thanks for bringing me safely to the temple."));
  await until(f, "Not a problem. I need to chat to Drezel");
  assert.equal(stage(f), 310);
  await continueLine(f);
  assert.equal(stage(f), 315);
  assert.equal(vb(f, VB.HIDEOUT), 1);
  ticks(f, 4);
  assert.equal(ownedNpcs(f, 4441).length, 0, "Ivan goes");
  assert.notDeepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [3440, 9887], "no teleport into the basement");
});

function drezel(f) {
  f.player.getPacketSender().sendConfig(302, 61);
  return spawn(f, 9805, [3441, 9894, 0]);
}

test("Drezel at 315: his first transcript line is skipped; 320/330/340 on the captured lines; 350 with the key box (t4057-4264)", async (t) => {
  const f = actor(t, { stage: 315, at: MAUSOLEUM });
  await talk(f, drezel(f));
  assert.ok(shown(f).text.startsWith("Well done for bringing Ivan to the temple"), JSON.stringify(shown(f)));
  await until(f, "Yes, it seems to be");
  assert.equal(stage(f), 315);
  await continueLine(f);
  assert.equal(stage(f), 320);
  await until(f, "Veliaf told me about Ivandis.");
  await choose(f, "Veliaf told me about Ivandis.");
  await until(f, "But you don't even know what he said about Ivandis.");
  await continueLine(f);
  assert.equal(stage(f), 330);
  await until(f, "Is there somewhere that I might get more information");
  await choose(f, "Is there somewhere that I might get more information");
  await until(f, "So you have no further information on him");
  await continueLine(f);
  assert.equal(stage(f), 340);
  await until(f, "The lives of those pitiful few");
  await choose(f, "The lives of those pitiful few");
  await until(f, "Drezel gives you a key.");
  assert.equal(stage(f), 350);
  assert.equal(f.player.getInventory().getAmount(I.TEMPLE_LIBRARY_KEY), 1);
  assert.equal(f.player.getPacketSender().getChatboxGroupId(), 193);
});

test("Drezel gives another key at 350 when it is lost", async (t) => {
  const f = actor(t, { stage: 350, at: MAUSOLEUM });
  await talk(f, drezel(f));
  assert.equal(shown(f).text, "I've lost my library key.");
  await until(f, "Thanks for that!");
  assert.equal(f.player.getInventory().getAmount(I.TEMPLE_LIBRARY_KEY), 1);
});

test("keyhole: Inspect is a mesbox; the key sets 1982 with its mesbox, stage and key unchanged; the trapdoor takes 360 to the library (t4269-4287)", async (t) => {
  const f = actor(t, { stage: 350, at: [3442, 9898, 0], items: [[I.TEMPLE_LIBRARY_KEY]] });
  assert.equal(objectClick(f, 12765, [3443, 9898, 0], "Inspect"), true);
  tick(f);
  assert.equal(shown(f).text, "You inspect the panel. It looks like there's some sort of keyhole in it.");
  assert.equal(f.player.getPacketSender().getChatboxGroupId(), 229);
  f.player.getDialogueManager().reset?.();
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === I.TEMPLE_LIBRARY_KEY);
  const use = { player: f.player, object: { getId: () => 12765, getLocation: () => new core.Location(3443, 9898, 0) },
    definition: core.ObjectDefinition.forId(12765), objectId: 12765, item: f.player.getInventory().getItems()[slot], itemId: I.TEMPLE_LIBRARY_KEY,
    itemSlot: slot, interfaceType: 149 << 16, location: { x: 3443, y: 9898, z: 0 }, handled: false };
  PM.emitItemOnObject(use);
  assert.equal(use.handled, true);
  tick(f);
  assert.equal(vb(f, VB.TRAPDOOR), 1);
  assert.ok(varbitSent(f, VB.TRAPDOOR, 1));
  assert.equal(shown(f).text, "You use the library key in the keyhole and you hear a click to the left of you.");
  assert.equal(stage(f), 350);
  assert.equal(f.player.getInventory().getAmount(I.TEMPLE_LIBRARY_KEY), 1, "the key is kept");
  f.player.getDialogueManager().reset?.();
  assert.equal(core.ObjectDefinition.forPlayer(12762, f.player)?.getName?.(), "Trapdoor", "the multiloc opens for this player");
  assert.equal(objectClick(f, 12762, [3441, 9899, 0], "Climb-down"), true, "the client sends the multiloc base id");
  assert.equal(stage(f), 350);
  tick(f);
  assert.equal(stage(f), 360);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [3360, 9904]);
  assert.deepEqual(f.messages.filter((m) => m.text.includes("climb")), [], "no message");
});

test("Ivan eats when hurt: 2005 down by one with the Wiki's message; with none left he gives up (t3950)", async (t) => {
  const f = actor(t, { stage: 310, vars: { [VB.FOOD]: 1 } });
  await startRoute2(f);
  const [ivan] = ownedNpcs(f, 4441);
  ivan.setHitpoints(1);
  ticks(f, 2);
  assert.equal(vb(f, VB.FOOD), 0);
  assert.ok(f.messages.some((m) => m.text === "Ivan : Urgh, just had too eat some food, I only have 0 left."), JSON.stringify(f.messages));
  ivan.setHitpoints(1);
  ticks(f, 2);
  assert.equal(ownedNpcs(f, 4441).length, 0, "no food: Ivan leaves");
  assert.equal(stage(f), 310);
});

test("a teleport between the trapdoor's animation and the climb cancels the climb", async (t) => {
  const f = actor(t, { stage: 350, vars: { [VB.TRAPDOOR]: 1 } });
  f.player.setLocation(new core.Location(3440, 9899, 0));
  f.player.getPacketSender().sendVarbit(VB.TRAPDOOR, 1); // the client's view of 1982
  assert.equal(objectClick(f, 12762, [3441, 9899, 0], "Climb-down"), true);
  f.player.moveTo(new core.Location(3222, 3218, 0));
  tick(f);
  assert.equal(stage(f), 350, "no 360");
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [3222, 3218]);
});

test("wrong stages: Ivan takes nothing before 290; the keyhole refuses the key before 350; no map before 310", async (t) => {
  const f = actor(t, { stage: 280, items: [[I.STEEL_MED_HELM], [I.TEMPLE_LIBRARY_KEY]] });
  assert.equal(useOnNpc(f, hideoutIvan(f), I.STEEL_MED_HELM), false);
  assert.equal(vb(f, VB.HELM), 0);
  const use = { player: f.player, object: { getId: () => 12765, getLocation: () => new core.Location(3443, 9898, 0) },
    definition: core.ObjectDefinition.forId(12765), objectId: 12765, item: null, itemId: I.TEMPLE_LIBRARY_KEY,
    itemSlot: 1, interfaceType: 149 << 16, location: { x: 3443, y: 9898, z: 0 }, handled: false };
  PM.emitItemOnObject(use);
  assert.equal(vb(f, VB.TRAPDOOR), 0);
  f.player.getPacketSender().sendInterface(MAP);
  assert.equal(clickMap(f, 37), false);
  assert.equal(vb(f, VB.ROUTE), 0);
});

test("the arrival Ivan outside Paterdomus goes with a logout; a walked-off thanks plays again from him", async (t) => {
  const f = actor(t, { stage: 310, vars: { [VB.FOOD]: 8 } });
  await startRoute2(f);
  ticks(f, 2);
  for (const juvinate of juvinates(f).slice(0, 3)) kill(juvinate);
  for (let i = 0; i < 14 && ownedNpcs(f, 4441).length === 0; i++) tick(f);
  const [ivan] = ownedNpcs(f, 4441);
  assert.ok(ivan, "Ivan outside the temple");
  f.player.getPacketSender().sendInterfaceRemoval(); // walked off mid-thanks
  await talk(f, ivan);
  assert.ok(shown(f).text.startsWith("Many thanks for bringing me safely to the temple."), "his thanks again, not 'Excuse me.'");
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  assert.equal(ivan.isRegistered(), false, "no orphaned owner-only Ivan");
});

test("a won ambush survives a logout before Ivan's arrival: saved outside Paterdomus, Ivan delivered", async (t) => {
  const f = actor(t, { stage: 310, vars: { [VB.FOOD]: 8 } });
  await startRoute2(f);
  ticks(f, 2);
  for (const juvinate of juvinates(f).slice(0, 3)) kill(juvinate);
  tick(f);
  assert.equal(shown(f).text, "You manage to escape from the rest of the vampyre juvinates and continue on your journey.");
  f.player.onLogout(); // the production logout callback
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [3432, 3484], "not back in Mort Myre");
  assert.equal(stage(f), 315);
  assert.equal(vb(f, VB.HIDEOUT), 1);
});
