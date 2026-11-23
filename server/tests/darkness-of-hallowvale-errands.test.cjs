// Run after `yarn build`: node --test tests/darkness-of-hallowvale-errands.test.cjs
//
// Darkness of Hallowvale, stages 80-180 (the Errands unit) against the live capture (revision 242, the
// user's recording; ticks in the unit's comments): Vertida's message, the papyrus crates, Veliaf's
// hand-in and new task, Drezel's briefing (the "Okay, thanks." exit), the bush and the werewolf scene,
// Drezel's runes, King Roald's two talks and Aeonisig's teleport, and Veliaf's 180. Real plugins, real
// Players and the world NPC ids live used; clicks go through PluginManager's own emitters.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { STAGE, VARBIT, impliedVarbits, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE } = require("../plugins/quests/hallowvale/State.DarknessOfHallowvale");

const STAGE_ATTRIBUTE = "quest.darkness_of_hallowvale.stage";
const MESSAGE = 9633, PAPYRUS = 970, LAW = 563, AIR = 556, FIRE = 554;
const OBJECTBOX = 193, OBJECTBOX_DOUBLE = 11;
// World NPCs (npc-spawns.json), as live clicked them.
const VERTIDA = 3773, VELIAF = 8277, DREZEL = 9805, ROALD = 5215, AEONISIG = 3774;
let core;
let next = 6400;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[3630, 9643], [3494, 9628], [3440, 9895], [3390, 3480], [3223, 3473]]) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
});

function actor(t, stage, x, y, z = 0, extra = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("doherr" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, z));
  player.needsPlacement = false;
  const varbits = new Map(), configs = new Map(), sounds = [], chatboxes = [], items = [], messages = [], songs = [], mounts = [];
  const sender = player.getPacketSender();
  const wrap = (method, record) => {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  };
  wrap("sendVarbit", (id, value) => varbits.set(id, value));
  wrap("sendConfig", (id, value) => configs.set(id, value));
  wrap("sendSound", (id) => sounds.push(id));
  wrap("sendAreaSound", (id) => sounds.push(id));
  wrap("sendSong", (id) => songs.push(id));
  wrap("sendChatboxInterface", (id) => chatboxes.push(id));
  wrap("sendItemOnInterfaces", (uid, item) => items.push(item));
  wrap("mountSubInterface", (uid, group) => mounts.push(group));
  const strings = [];
  wrap("sendString", (...args) => strings.push(String(args.find((arg) => typeof arg === "string") ?? "")));
  const anims = [], gfx = [];
  const perform = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { anims.push(animation.getId()); return perform(animation); };
  const graphic = player.performGraphic.bind(player);
  player.performGraphic = (g) => { gfx.push(g.getId()); return graphic(g); };
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = (text) => { messages.push(String(text)); return sendMessage(text); };
  player.setAttribute(SAVE_VERSION_ATTRIBUTE, 1);
  player.setAttribute(VARS_ATTRIBUTE, { ...impliedVarbits(stage), ...extra });
  player.setAttribute(STAGE_ATTRIBUTE, stage);
  // Priest in Peril done (varp 302 = 61): Drezel's world copy 9805 shows as 9636.
  sender.sendConfig(302, 61);
  for (const [id, value] of Object.entries(player.getAttribute(VARS_ATTRIBUTE))) sender.sendVarbit(Number(id), value);
  players.push(player);
  const npcs = [];
  t.after(() => {
    player.getDialogueManager().reset?.();
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    players.splice(players.indexOf(player), 1);
    for (const npc of npcs) if (npc?.isRegistered?.()) PM.removeNpc(npc);
  });
  const spawn = (id, nx, ny, nz = z) => {
    const npc = PM.spawnNpc({ id, x: nx, y: ny, z: nz, wanderRadius: 0 }, "DohErrandsTest");
    npcs.push(npc);
    return npc;
  };
  return { player, strings, varbits, configs, sounds, chatboxes, items, messages, anims, gfx, songs, mounts, spawn };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}

const stageOf = (player) => player.getAttribute(STAGE_ATTRIBUTE);
const saved = (player, id) => Number(player.getAttribute(VARS_ATTRIBUTE)?.[id]) || 0;
const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const current = (player) => player.getDialogueManager().getCurrent();
const text = (player) => current(player)?.getText?.() ?? null;
const head = (player) => current(player)?.getNpcId?.() ?? null;
const cont = (player) => player.getDialogueManager().advance();

/** The werewolf lines from the open one on: [head, text] each, continuing past each. */
function werewolfLines(player) {
  const lines = [];
  while (current(player)?.getNpcId?.() === 3827 || current(player)?.getNpcId?.() === 3826) {
    lines.push([head(player), text(player)]);
    if (lines.length === 5) break;
    cont(player);
    tick(1);
  }
  return lines;
}
const menu = (player) => core.MultiChatboxPrompt.getPending(player);
const amount = (player, id) => player.getInventory().getAmount(id);

function choose(player, option) {
  const pending = menu(player);
  assert.ok(pending, `a menu is open for "${option}"`);
  const index = pending.options.indexOf(option);
  assert.ok(index >= 0, `"${option}" in [${pending.options.join(" | ")}]`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: index + 1 });
}

/** Continues until `predicate` sees the shown line, a menu opens, or the talk ends. */
function continueUntil(player, predicate, limit = 80) {
  for (let i = 0; i < limit; i++) {
    if (predicate(text(player) ?? "")) return true;
    if (menu(player) || !current(player)) return false;
    cont(player);
  }
  return predicate(text(player) ?? "");
}
/** Continues to the next menu (or the end). */
function continueToMenu(player, limit = 80) {
  for (let i = 0; i < limit && !menu(player) && current(player); i++) cont(player);
  return !!menu(player);
}

function talk(player, npc) {
  const npcId = npc.getContentId(player);
  return PM.emitNpcInteraction({ player, npc, npcId, npcIndex: npc.getIndex(), clickType: 1,
    location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: npc.getLocation().getZ() }, handled: false });
}

function click(player, id, option, [x, y, z]) {
  const definition = core.ObjectDefinition.forPlayer(id, player) ?? core.ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((op) => op === option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} (${id}) has ${option}`);
  const object = { getId: () => id, getLocation: () => new core.Location(x, y, z), getType: () => 10, getFace: () => 0 };
  return PM.emitObjectInteraction({ player, object, objectId: id, definition, clickType, option, location: { x, y, z },
    sourceLocation: { x: player.getLocation().getX(), y: player.getLocation().getY(), z: player.getLocation().getZ() }, handled: false });
}

function ownedNpcs(player) {
  return Array.from(core.World.getNpcs()).filter((npc) => npc?.isRegistered?.() && npc.getOwner?.() === player);
}

// ---------------------------------------------------------------------------

test("Vertida (world 3773): objectbox 193 with the message, the item and 90 on the box's tick", (t) => {
  const f = actor(t, STAGE.IN_HIDEOUT, 3629, 9643);
  const vertida = f.spawn(VERTIDA, 3628, 9641);
  assert.equal(talk(f.player, vertida), true);
  assert.equal(text(f.player), "Hey. You're with the Myreque aren't you?");
  assert.ok(continueUntil(f.player, (line) => line.startsWith("Vertida gives you a message.")));
  assert.equal(f.chatboxes.at(-1), OBJECTBOX, "objectbox 193 (t2939)");
  assert.equal(f.items.at(-1), MESSAGE);
  assert.equal(amount(f.player, MESSAGE), 1);
  assert.equal(stageOf(f.player), STAGE.VERTIDA_MESSAGE, "90 as the box opens");
  cont(f.player);
  assert.equal(text(f.player), "There you go.");
  assert.ok(continueToMenu(f.player));
  choose(f.player, "Okay, thanks.");
  assert.equal(amount(f.player, MESSAGE), 1, "one message only");
});

test("Inspect on Vertida's message: an objectbox with the message and the Wiki's description (#6639)", (t) => {
  const f = actor(t, STAGE.VERTIDA_MESSAGE, 3629, 9643);
  f.player.getInventory().setItem(4, new core.Item(MESSAGE, 1));
  const action = [2, 3, 4, 6, 7].map((op) => ItemActionPacketListener.resolveInventoryWidgetAction(MESSAGE, op))
    .find((candidate) => candidate?.option === "Inspect");
  assert.ok(action, "the cache's Inspect");
  assert.equal(PM.emitItemAction({ player: f.player, item: f.player.getInventory().getItems()[4], itemId: MESSAGE, slot: 4,
    interfaceId: (149 << 16), clickType: action.optionIndex, option: action.option, handled: false }), true);
  assert.equal(f.chatboxes.at(-1), OBJECTBOX);
  assert.equal(f.items.at(-1), MESSAGE);
  assert.equal(text(f.player), "It's a short message from Vertida to Veliaf. It confirms that the Sanguinesti order of the"
    + " Myreque is operational, but in need of support.");
  assert.equal(amount(f.player, MESSAGE), 1, "kept");
  assert.equal(stageOf(f.player), STAGE.VERTIDA_MESSAGE, "nothing else changes");
});

test("Vertida at 90 without the message gives another; with it she only reminds", (t) => {
  const f = actor(t, STAGE.VERTIDA_MESSAGE, 3629, 9643);
  const vertida = f.spawn(VERTIDA, 3628, 9641);
  talk(f.player, vertida);
  assert.equal(text(f.player), "Hey again. How are you?");
  assert.ok(continueToMenu(f.player));
  choose(f.player, "What should I do now?");
  assert.ok(continueUntil(f.player, (line) => line.startsWith("Vertida gives you a message.")));
  assert.equal(amount(f.player, MESSAGE), 1);
  assert.equal(f.items.at(-1), MESSAGE);
});

test("the papyrus crates: human_pickuptable, one papyrus a search, no limit", (t) => {
  const f = actor(t, STAGE.VERTIDA_MESSAGE, 3633, 9644);
  for (let i = 0; i < 5; i++) assert.equal(click(f.player, 17987, "Search", [3634, 9644, 0]), true);
  assert.equal(amount(f.player, PAPYRUS), 5);
  assert.deepEqual(f.anims, [832, 832, 832, 832, 832]);
  assert.equal(f.messages.filter((line) => line === "You find some papyrus.").length, 5);
});

test("Veliaf (world 8277): the hand-in box and 100, then 110 after \"What do you want me to do?\"", (t) => {
  const f = actor(t, STAGE.VERTIDA_MESSAGE, 3491, 9630);
  f.player.getInventory().adds(MESSAGE, 1);
  const veliaf = f.spawn(VELIAF, 3491, 9629);
  assert.equal(talk(f.player, veliaf), true);
  assert.equal(text(f.player), "Hello Veliaf.");
  assert.ok(continueUntil(f.player, (line) => line.startsWith("You hand over the message to Veliaf.")));
  assert.equal(f.chatboxes.at(-1), OBJECTBOX, "objectbox 193 (t3181)");
  assert.equal(f.items.at(-1), MESSAGE);
  assert.equal(amount(f.player, MESSAGE), 0);
  assert.equal(stageOf(f.player), STAGE.MESSAGE_DELIVERED);
  assert.ok(continueUntil(f.player, (line) => line === "What do you want me to do?"));
  assert.equal(stageOf(f.player), STAGE.MESSAGE_DELIVERED, "still 100 on the line");
  cont(f.player);
  assert.ok(text(f.player).startsWith("I've had word from Drezel"));
  assert.equal(stageOf(f.player), STAGE.SENT_TO_DREZEL, "110 (t3190)");
  assert.equal(head(f.player), VELIAF, "the world copy's head");
  cont(f.player);
  cont(f.player);
  assert.equal(current(f.player) ?? null, null, "no menu after (t3196)");
});

test("Drezel: 120 and the bush before \"Ivan mentioned...\"; the sub-menu's \"Okay, thanks.\" ends the talk", (t) => {
  const f = actor(t, STAGE.SENT_TO_DREZEL, 3440, 9893);
  const drezel = f.spawn(DREZEL, 3439, 9894);
  assert.equal(talk(f.player, drezel), true);
  assert.ok(text(f.player).startsWith("Hey, Drezel. Veliaf sent me."));
  assert.ok(continueUntil(f.player, (line) => line === "But anyway, what do you need from me?"));
  assert.equal(stageOf(f.player), STAGE.SENT_TO_DREZEL);
  cont(f.player);
  assert.ok(text(f.player).startsWith("Ivan mentioned"));
  assert.equal(stageOf(f.player), STAGE.DREZEL_TALKED, "120 (t3460)");
  assert.equal(f.varbits.get(VARBIT.BUSH), 1, "2591 = 1");
  assert.ok(continueToMenu(f.player));
  choose(f.player, "When and where were these noises heard?");
  assert.ok(continueToMenu(f.player));
  assert.deepEqual(menu(f.player).options, ["Did you hear the noises as well?", "Has anyone seen or reported anything unusual?",
    "How is Ivan? Is he okay?", "Okay, thanks."]);
  choose(f.player, "Okay, thanks.");
  continueToMenu(f.player);
  assert.equal(menu(f.player), null);
  tick(2);
  assert.equal(stageOf(f.player), STAGE.DREZEL_TALKED, "the quest goes on from 120");
  assert.ok(core.ObjectDefinition.forPlayer(18121, f.player)?.getInteractions?.()?.includes("Search"), "the searchable bush (17989)");
});

test("the bush: the werewolf scene in its copy, Morytanian Mystery, 2591 = 0 and 130 at the teardown", (t) => {
  const f = actor(t, STAGE.DREZEL_TALKED, 3391, 3480, 0, { [VARBIT.BUSH]: 1 });
  assert.equal(click(f.player, 18121, "Search", [3390, 3480, 0]), true);
  tick(4);
  assert.equal(f.varbits.get(12393), 1, "busy (t3583)");
  assert.deepEqual(at(f.player), [3390, 3479, 0], "the forced walk (t3584)");
  assert.equal(f.chatboxes.at(-1), 229, "messagebox 229 (t3586)");
  assert.ok(f.strings.includes("You search the bushes and find someone lying unconscious."));
  assert.equal(current(f.player)?.isSelfAdvancing?.(), true, "no continue (t3586)");
  tick(4);
  assert.ok(f.songs.includes(676), "werewolves (t3590)");
  assert.ok(f.messages.some((line) => line.includes("Morytanian Mystery")), "the unlock");
  tick(1);
  assert.notDeepEqual(at(f.player), [3390, 3479, 0], "in the copy (t3591)");
  assert.equal(f.varbits.get(542), 1, "cutscene_status");
  assert.equal(f.configs.get(5589), 56);
  tick(2);
  const wolves = ownedNpcs(f.player).map((npc) => npc.getId()).sort();
  assert.deepEqual(wolves, [3825, 3826], "the two werewolves (t3593)");
  tick(4);
  assert.ok(f.sounds.includes(909) && f.sounds.includes(910));
  assert.ok(f.gfx.includes(245), "stunned (t3597)");
  assert.ok(!f.anims.includes(836));
  tick(1);
  assert.ok(f.anims.includes(836), "human_death (t3598)");
  tick(1);
  assert.ok(ownedNpcs(f.player).some((npc) => npc.getNpcTransformationId() === 3827), "3825 -> 3827 (t3599)");
  tick(2);
  assert.ok(f.mounts.includes(453), "the blackout (t3601)");
  // The five "Shadowy figure" lines under the blackout, 3827's and 3826's heads in turn (t3601-3614, #6639).
  assert.deepEqual(werewolfLines(f.player), [
    [3827, "I told you to hide it properly!"],
    [3826, "Not to worry! Now we've got more!"],
    [3827, "Nah, we can't take him. It'll look suspicious."],
    [3826, "Let's go! Have you got the tithe?"],
    [3827, "Of course!"],
  ]);
  for (let i = 0; i < 6 && !(text(f.player) ?? "").startsWith("Ouch"); i++) { cont(f.player); tick(1); }
  assert.equal(saved(f.player, VARBIT.BUSH), 0, "2591 = 0 (t3618)");
  assert.equal(stageOf(f.player), STAGE.WEREWOLVES_SEEN, "130 (t3621)");
  assert.deepEqual(at(f.player), [3390, 3479, 0], "back on the map");
  assert.equal(f.varbits.get(542), 0);
  assert.equal(ownedNpcs(f.player).length, 0, "the werewolves go with the copy");
  assert.equal(text(f.player), "Ouch! My poor head!");
  cont(f.player);
  assert.equal(f.varbits.get(12393), 0, "busy cleared (t3625)");
});

test("the bush: a female character hears the Wiki's \"take her\" (live said \"him\" to a male one, t3608)", (t) => {
  const f = actor(t, STAGE.DREZEL_TALKED, 3391, 3480, 0, { [VARBIT.BUSH]: 1 });
  f.player.getAppearance().setLook(0, 1); // Appearance.GENDER: female
  assert.equal(f.player.getAppearance().isMale(), false);
  assert.equal(click(f.player, 18121, "Search", [3390, 3480, 0]), true);
  tick(19);
  assert.ok(f.mounts.includes(453), "the blackout (t3601)");
  assert.equal(werewolfLines(f.player)[2][1], "Nah, we can't take her. It'll look suspicious.");
});

test("the bush: closing the chat on a werewolf line keeps it; the scene still ends with 130 back on the map", (t) => {
  const f = actor(t, STAGE.DREZEL_TALKED, 3391, 3480, 0, { [VARBIT.BUSH]: 1 });
  assert.equal(click(f.player, 18121, "Search", [3390, 3480, 0]), true);
  tick(19);
  cont(f.player);
  tick(1);
  assert.equal(text(f.player), "Not to worry! Now we've got more!");
  const close = { player: f.player, handled: false };
  PM.emitCustomEvent("interface:close", close);
  assert.equal(close.handled, true, "the close is taken (interface_close)");
  tick(5);
  assert.equal(text(f.player), "Not to worry! Now we've got more!", "the line stays open");
  for (let i = 0; i < 8 && !(text(f.player) ?? "").startsWith("Ouch"); i++) { cont(f.player); tick(1); }
  assert.equal(stageOf(f.player), STAGE.WEREWOLVES_SEEN, "130");
  assert.deepEqual(at(f.player), [3390, 3479, 0], "back on the map");
  assert.equal(text(f.player), "Ouch! My poor head!");
  const after = { player: f.player, handled: false };
  PM.emitCustomEvent("interface:close", after);
  assert.equal(after.handled, false, "after the scene a close is ordinary");
});

test("the bush does nothing outside 120 with 2591 = 1", (t) => {
  const f = actor(t, STAGE.WEREWOLVES_SEEN, 3391, 3480);
  const definition = core.ObjectDefinition.forId(17989);
  const object = { getId: () => 18121, getLocation: () => new core.Location(3390, 3480, 0), getType: () => 10, getFace: () => 0 };
  PM.emitObjectInteraction({ player: f.player, object, objectId: 18121, definition, clickType: 1, option: "Search",
    location: { x: 3390, y: 3480, z: 0 }, handled: false });
  tick(10);
  assert.equal(ownedNpcs(f.player).length, 0);
  assert.equal(stageOf(f.player), STAGE.WEREWOLVES_SEEN);
});

test("Drezel at 130: objectbox_double 11 (law, air), one Varrock Teleport's runes and 140", (t) => {
  const f = actor(t, STAGE.WEREWOLVES_SEEN, 3440, 9893);
  const drezel = f.spawn(DREZEL, 3441, 9895);
  talk(f.player, drezel);
  assert.ok(text(f.player).startsWith("Hello, "), "Drezel speaks first (t3686)");
  assert.equal(head(f.player), DREZEL, "live's head is the world copy 9805");
  assert.ok(continueUntil(f.player, (line) => line === "Drezel gives you some runes."));
  assert.equal(f.chatboxes.at(-1), OBJECTBOX_DOUBLE, "objectbox_double 11 (t3717)");
  assert.deepEqual([amount(f.player, LAW), amount(f.player, AIR), amount(f.player, FIRE)], [1, 3, 1]);
  assert.equal(stageOf(f.player), STAGE.RUNES_GIVEN);
  cont(f.player);
  assert.equal(text(f.player), "Very well, I'll make my way to Varrock and bid you good luck.");
});

test("Drezel at 140 asks whether the player has been to Varrock (the \"again\" talk); at 170 the edicts talk", (t) => {
  const f = actor(t, STAGE.RUNES_GIVEN, 3440, 9893);
  const drezel = f.spawn(DREZEL, 3441, 9895);
  talk(f.player, drezel);
  cont(f.player);
  assert.equal(text(f.player), "Not yet, sorry. What should I do again?");
  f.player.getDialogueManager().reset();
  f.player.setAttribute(STAGE_ATTRIBUTE, STAGE.BACK_AT_PATERDOMUS);
  talk(f.player, drezel);
  cont(f.player);
  assert.ok(text(f.player).startsWith("I have. King Roald isn't able to send troops"));
});

test("King Roald at 140: the long talk, 150 on the mercenary-protocol line", (t) => {
  const f = actor(t, STAGE.RUNES_GIVEN, 3223, 3473);
  const roald = f.spawn(ROALD, 3223, 3471);
  assert.equal(talk(f.player, roald), true);
  assert.equal(text(f.player), "Greetings, your majesty.");
  assert.ok(continueToMenu(f.player));
  choose(f.player, "Talk to the king about Morytania.");
  assert.ok(continueUntil(f.player, (line) => line.startsWith("I am sorry, but Aeonisig is my advisor")));
  assert.equal(stageOf(f.player), STAGE.RUNES_GIVEN);
  cont(f.player);
  assert.equal(stageOf(f.player), STAGE.ROALD_REFUSED, "150 (t4020)");
  assert.ok(text(f.player).startsWith("This will allow all able-bodied men"));
  assert.ok(continueToMenu(f.player));
  choose(f.player, "Okay, thanks.");
});

test("King Roald at 150: no teleport option yet; 160 on the offer, then Aeonisig's teleother and 170 on landing", (t) => {
  const f = actor(t, STAGE.ROALD_REFUSED, 3223, 3473);
  const roald = f.spawn(ROALD, 3223, 3471);
  const aeonisig = f.spawn(AEONISIG, 3225, 3473);
  const casts = [];
  const cast = aeonisig.performAnimation.bind(aeonisig);
  aeonisig.performAnimation = (animation) => { casts.push(animation.getId()); return cast(animation); };
  talk(f.player, roald);
  assert.ok(continueToMenu(f.player));
  choose(f.player, "Talk to the king about Morytania.");
  assert.ok(continueToMenu(f.player));
  assert.ok(!menu(f.player).options.includes("Does your offer of a teleport still stand?"), "not offered at 150 (t4127)");
  choose(f.player, "I'd like to ask a few questions if I may?");
  assert.ok(continueToMenu(f.player));
  choose(f.player, "What should I do now?");
  assert.ok(continueUntil(f.player, (line) => line.startsWith("Well then, I must try to do something")));
  assert.equal(stageOf(f.player), STAGE.ROALD_REFUSED);
  cont(f.player);
  assert.equal(stageOf(f.player), STAGE.ROALD_TELEPORT, "160 (t4167)");
  assert.ok(continueToMenu(f.player));
  choose(f.player, "Yes thanks. I'll accept the free teleport.");
  assert.ok(continueUntil(f.player, (line) => line === "Prepare yourself for teleport!"));
  cont(f.player);
  assert.equal(current(f.player)?.getText?.() ?? null, null, "the chat closes (t4175)");
  tick(1);
  assert.deepEqual(casts, [1818], "Aeonisig casts (t4176)");
  tick(1);
  assert.ok(f.anims.includes(1816) && f.gfx.includes(342), "the impact (t4177)");
  assert.ok(f.sounds.includes(200));
  tick(2);
  assert.deepEqual(at(f.player), [3223, 3473, 0], "not moved yet");
  tick(1);
  assert.deepEqual(at(f.player), [3421, 9888, 0], "Paterdomus basement (t4180)");
  assert.equal(stageOf(f.player), STAGE.BACK_AT_PATERDOMUS, "170 on landing");
  tick(1);
  assert.equal(text(f.player), "Aeonisig teleports you back to Paterdomus.", "the box after landing (t4181)");
});

test("King Roald at 160 (declined before): the teleport option and the again talk's cast", (t) => {
  const f = actor(t, STAGE.ROALD_TELEPORT, 3223, 3473);
  const roald = f.spawn(ROALD, 3223, 3471);
  talk(f.player, roald);
  assert.ok(continueToMenu(f.player));
  choose(f.player, "Talk to the king about Morytania.");
  assert.ok(continueToMenu(f.player));
  choose(f.player, "Does your offer of a teleport still stand?");
  assert.ok(continueToMenu(f.player));
  choose(f.player, "Yes thanks. I'll accept the free teleport.");
  assert.ok(continueUntil(f.player, (line) => line === "Prepare yourself for teleport!"));
  cont(f.player);
  tick(5);
  assert.deepEqual(at(f.player), [3421, 9888, 0]);
  assert.equal(stageOf(f.player), STAGE.BACK_AT_PATERDOMUS);
  tick(1);
  assert.equal(text(f.player), "Aeonisig teleports you back to Paterdomus.");
});

test("Veliaf at 170: 180 on continuing the player's \"What should we do now?...\"", (t) => {
  const f = actor(t, STAGE.BACK_AT_PATERDOMUS, 3495, 9630);
  const veliaf = f.spawn(VELIAF, 3496, 9629);
  talk(f.player, veliaf);
  assert.equal(text(f.player), "Well met, friend.", "Veliaf speaks first (t4551)");
  assert.ok(continueUntil(f.player, (line) => line.startsWith("What should we do now? There must be someone else")));
  assert.equal(stageOf(f.player), STAGE.BACK_AT_PATERDOMUS);
  cont(f.player);
  assert.equal(stageOf(f.player), STAGE.SENT_BACK, "180 (t4611)");
  assert.ok(text(f.player).startsWith("We must inform the Sanguinesti order"));
});

test("Veliaf at 130-169 sends the player on to Roald; outside 90-179 this unit leaves him alone", (t) => {
  const f = actor(t, STAGE.RUNES_GIVEN, 3495, 9630);
  const veliaf = f.spawn(VELIAF, 3496, 9629);
  talk(f.player, veliaf);
  assert.equal(text(f.player), "You've returned already?");
  assert.ok(continueUntil(f.player, () => false) === false);
  assert.equal(stageOf(f.player), STAGE.RUNES_GIVEN);
});
