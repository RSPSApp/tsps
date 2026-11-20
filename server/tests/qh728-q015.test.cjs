// From server/ after `yarn build`: node --test --test-concurrency=1 tests/qh728-q015.test.cjs
//
// Darkness of Hallowvale regression contracts (QH728 Q015), on the rebuilt quest (live's stages and
// varbits, ../plugins/quests/hallowvale/). Real plugins, a real Player; talks, clicks, item-on-loc and
// dialogue continues/choices go through PluginManager and the dialogue manager, ticks through
// TaskManager. The per-unit tests (darkness-of-hallowvale-{boat,ghetto,errands,hassle,sketches,lab}
// .test.cjs) pin the live capture's details; this file keeps the older regressions and one
// end-to-end walk through all 36 of live's stage values.
//
// Ported from the pre-capture version (40 tests on a stubbed api: transcript step ids dispatched by
// hand, the old stage ladder 0-310 shown as varbit 320, owner-only NPC spawns, the old plugin's
// internals). Rewritten on live's stages, varbits and world NPC ids and kept: the north sketch leg and
// its journal; Vertida's message on a full bag (now: under the player, 90, and a replacement);
// Drezel's runes (room for new stacks, partial and full stacks); the full-bag handouts (Safalaan's
// supplies now land under the player, the ladder top, the rune case, the portrait key); the boat back
// to Meiyerditch at 180; the Drakan wall shortcut; completion at login; Vertida's t2mfif pointer (now
// at 170 and from 200, with the briefing at 180); Veliaf after Roald (170 -> 180); Vertida's Safalaan
// briefing (190); the sketches-given varbit 2575; the incomplete hand-in and the lost third sketch;
// lost north/west sketches; the start gates (on "Yes.", 10 on the continue of "Once you're in...",
// boostable Thieving); the In Aid continuation conditions 5iTY3c/Ao7Gq6 and Veliaf's hand-over; the
// pots' key; the ghetto door's 2578 at login; the rune case into full stacks; Taste of Hope's rod
// hand-over; no extra Veliaf spawn; out-of-order clicks; Aeonisig's teleport (now 160 -> 170 at the
// Paterdomus basement); Trader Sven; Vanstrom's five attacks; the hand-ins' cleanup; the lost sealed
// message; the quest's item actions; the rooftop route's gate. The old "quest-local handler reaches
// every mandatory stage" is the end-to-end walk; the old "western sketch receipt" is part of it.
//
// Dropped, because the capture replaced the behaviour they protected:
// - "completion keeps durable stage 310 while varbit 2573 reaches 320" and "the client wire ladder
//   matches the Quest Helper steps": the stage is varbit 2573 itself now (no alias table); 320 is
//   stored and sent as is (its login replay is kept).
// - "picking the haemalchemy book off the laboratory floor advances the laboratory leg": live sets no
//   stage on the pickup (t7457); 310 comes from Safalaan (t7644). The port asserts that instead.
// - "Sarius Guile is a real stage-240 Talk-to, split from the imported south scene": live's Sarius
//   talks by herself after the knockout copy (t6745), and 250 is on "And now be away..." (t6776); the
//   npc-dialogue-index and step-id assertions about the old scene split went with it.
// - "Vanstrom's death still resolves the ambush" and "Vanstrom's death is ignored for a non-owner": the
//   Wiki's Vanstrom cannot be damaged and the ambush is the owner's own copy; the five attacks are kept.
// "a destroyed ladder top makes the ladder wall searchable again" was a gap this port found; the Ghetto
// unit now resets 2598 when the top is destroyed.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const runtime = require("../plugins/quests/QuestRuntime");
const { STAGE, VARBIT, impliedVarbits, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE } = require("../plugins/quests/hallowvale/State.DarknessOfHallowvale");

// Record which transcript page/variant each handler plays; the real startTranscript still runs. Patched
// before the plugins load, so the units' destructured copies are this wrapper.
let transcripts = [];
const startTranscript = runtime.startTranscript;
runtime.startTranscript = (...args) => {
  transcripts.push({ npcId: args[2], page: args[3], variant: args[4] });
  return startTranscript(...args);
};

const STAGE_KEY = "quest.darkness_of_hallowvale.stage";
const IN_AID_STAGE_KEY = "quest.in_aid_of_the_myreque.stage";
const IN_AID_COMPLETE = 430;
const PAGE = "Darkness of Hallowvale";
const ROUTE = Object.values(STAGE).filter((value) => value > 0);

// World NPCs (npc-spawns.json / the cache multinpcs), as live clicked them.
const VELIAF = 8277, VERTIDA = 3773, DREZEL = 9805, ROALD = 5215, AEONISIG = 3774, CITIZEN = 3790, RAL = 3772;
const SAFALAAN_WALL = 6159, SAFALAAN_HIDEOUT = 6160, VYREWATCH = 3717, MINE_GUARD = 3690, TRADER_SVEN = 3779;
// Items (cache gamevals).
const MESSAGE = 9633, PAPYRUS = 970, CHARCOAL = 973, SKETCH_1 = 9646, SKETCH_2 = 9647, SKETCH_3 = 9648;
const SARIUS_MESSAGE = 9649, ORNATE_KEY = 9651, HAEMALCHEMY = 9652, SEALED = 9653, DOOR_KEY = 9654, LADDER_TOP = 9655;
const TOME = 9656, KNIFE = 946, LAW = 563, AIR = 556, FIRE = 554, WATER = 555, MIND = 558, DAEYALT_ORE = 9632;
// Locs.
const BOAT = 12944, CHUTE = 12947, SEA_BOAT = 12945, DOCK_ROCK = 17958;
const NORTH = [3556, 3379, 0], WEST = [3522, 3357, 0], SOUTH = [3572, 3331, 0];
const STREET = [3609, 3186, 0], MINE = [2391, 4620, 2];

let core, I;
let next = 9700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[3494, 9628], [3523, 3177], [3605, 3161], [3590, 3173], [3593, 3186], [3607, 3208], [3640, 3253],
    [3626, 9618], [3630, 9643], [3440, 9895], [3390, 3480], [3223, 3473], [3421, 9888], [3609, 3186], [2391, 4620],
    [3595, 3310], [3584, 3331], [3556, 3379], [3522, 3357], [3572, 3331], [3627, 3250], [3638, 3304], [3637, 9695]]) {
    core.RegionManager.loadMapFiles(x, y);
  }
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const players = new Set();

/** A logged-in player at `stage` with the varbits live had by then; In Aid complete and the start levels met. */
function actor(t, stage, at, { vars = {}, inAid = true, levels = {} } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername(`q015p${next}`);
  p.setRegistered(true);
  p.setLocation(new core.Location(...at));
  p.needsPlacement = false;
  if (inAid) p.setAttribute(IN_AID_STAGE_KEY, IN_AID_COMPLETE);
  p.setAttribute(SAVE_VERSION_ATTRIBUTE, 1);
  p.setAttribute(VARS_ATTRIBUTE, { ...impliedVarbits(stage), ...vars });
  p.setAttribute(STAGE_KEY, stage);
  const skills = p.getSkillManager();
  const base = { STRENGTH: 60, MAGIC: 70, CRAFTING: 73, AGILITY: 73, THIEVING: 60, MINING: 73, CONSTRUCTION: 64, HITPOINTS: 99, ...levels };
  for (const [skill, level] of Object.entries(base)) skills.setMaxLevel(core.Skill[skill], level).setCurrentLevel(core.Skill[skill], level);
  const seen = { messages: [], varbits: [], chatbox: [], items: [], strings: [], jingles: [], interfaces: [], hits: [] };
  const sender = p.getPacketSender();
  for (const [method, record] of [
    ["sendVarbit", (id, value) => seen.varbits.push([id, value])],
    ["sendChatboxInterface", (group) => seen.chatbox.push(group)],
    ["sendItemOnInterfaces", (id, item) => seen.items.push(item)],
    ["sendString", (...args) => seen.strings.push(String(args.find((arg) => typeof arg === "string") ?? ""))],
    ["sendJingle", (id) => seen.jingles.push(id)],
    ["sendInterface", (id) => seen.interfaces.push(id)],
  ]) {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  }
  const queue = p.getCombat().getHitQueue();
  const addPending = queue.addPendingDamage.bind(queue);
  queue.addPendingDamage = (list) => { for (const hit of list) seen.hits.push(hit.getDamage()); return addPending(list); };
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { seen.messages.push(String(text)); return send(text, ...rest); };
  // The login gameframe's first magic-tab mount sends the spell-unlock varps (302 among them) before the
  // quests' own varps; a test player has no gameframe, so a cutscene's tab restore would be that first mount.
  sender.spellUnlocksSent = true;
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  // Priest in Peril done (varp 302 = 61): Drezel's world copy 9805 shows as 9636.
  const priest = runtime.getRegisteredQuests().find((entry) => entry.key === "priest_in_peril");
  if (priest) priest.setStage(p, priest.completionValue);
  sender.sendConfig(302, 61);
  players.add(p);
  const npcs = [];
  t.after(() => {
    p.getDialogueManager().reset?.();
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    players.delete(p);
    core.TaskManager.cancelTasks(p.getIndex());
    for (const npc of npcs) if (npc?.isRegistered?.()) PM.removeNpc(npc);
  });
  const spawn = (id, tile) => {
    const npc = PM.spawnNpc({ id, x: tile[0], y: tile[1], z: tile[2] ?? 0, wanderRadius: 0 }, "Q015");
    npcs.push(npc);
    return npc;
  };
  return { p, seen, spawn };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const p of players) {
      AreaManager.process(p);
      p.getMovementQueue().process();
      core.TaskManager.processWalkTo(p.getIndex());
    }
    core.TaskManager.process();
    for (const p of players) p.resetUpdating();
  }
}

const stageOf = (p) => Number(p.getAttribute(STAGE_KEY)) || 0;
const varbit = (p, id) => Number(p.getAttribute(VARS_ATTRIBUTE)?.[id]) || 0;
const amount = (p, id) => p.getInventory().getAmount(id);
const slotOf = (p, id) => p.getInventory().getItems().findIndex((item) => item?.getId() === id);
const tile = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];
const menu = (p) => core.MultiChatboxPrompt.getPending(p);
const current = (p) => p.getDialogueManager().getCurrent();
const text = (p) => String(current(p)?.getText?.() ?? "").replace(/<br>/g, " ").replace(/\s+/g, " ").trim();
const cont = (p) => p.getDialogueManager().advance();
const sent = (seen, id, value) => seen.varbits.some(([at, v]) => at === id && v === value);
const lastVariant = () => transcripts.at(-1)?.variant;
const give = (p, id, count = 1) => {
  const definition = core.ItemDefinition.forId(id);
  if (count === 1 || definition?.isStackable?.() || definition?.isNoted?.()) return p.getInventory().add(new core.Item(id, count));
  for (let i = 0; i < count; i++) p.getInventory().add(new core.Item(id, 1));
};
const fill = (p, free = 0) => { while (p.getInventory().getFreeSlots() > free) p.getInventory().add(new core.Item(I.BRONZE_DAGGER, 1)); };
const ownedNpcs = (p, id) => [...core.World.getNpcs()].filter((npc) => npc?.isRegistered?.() && npc.getOwner?.() === p
  && (id === undefined || npc.getId() === id || npc.getNpcTransformationId?.() === id));
const complete = (p, key = "darkness_of_hallowvale") => {
  const request = { player: p, key, complete: null };
  PM.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
};
const quest = () => runtime.getRegisteredQuests().find((entry) => entry.key === "darkness_of_hallowvale");
const journal = (p) => quest().buildJournal(p, quest()).join("\n");

function choose(p, option) {
  const pending = menu(p);
  assert.ok(pending, `a menu is open for "${option}" (showing "${text(p)}")`);
  const at = pending.options.findIndex((entry) => entry.startsWith(option));
  assert.ok(at >= 0, `"${option}" in [${pending.options.join(" | ")}]`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: at + 1 });
}

/** Continues (and ticks through held boxes) until a line, menu option or menu title starts with `prefix`. */
function until(p, prefix, limit = 80) {
  for (let i = 0; i < limit; i++) {
    const pending = menu(p);
    if (pending?.options?.some((entry) => entry.startsWith(prefix)) || String(pending?.title ?? "").startsWith(prefix)) return;
    if (text(p).startsWith(prefix)) return;
    if (pending) assert.fail(`menu [${pending.options.join(" | ")}] while waiting for "${prefix}"`);
    if (current(p) && current(p).isSelfAdvancing?.() !== true) cont(p);
    else tick();
  }
  assert.fail(`"${prefix}" never showed (last "${text(p)}")`);
}

/** Continues until the conversation ends or a menu opens. */
function finish(p, limit = 60) {
  for (let i = 0; i < limit; i++) {
    if (menu(p)) return;
    if (!current(p)) { tick(); if (!current(p) && !menu(p)) return; continue; }
    if (current(p).isSelfAdvancing?.() === true) tick();
    else cont(p);
  }
}

/** One interaction: it must be handled, by one handler at most (at most one transcript started). */
function once(label, fn) {
  const before = transcripts.length;
  const handled = fn();
  assert.ok(transcripts.length - before <= 1, `${label}: one transcript, not ${transcripts.slice(before).map((c) => c.variant).join(" + ")}`);
  return handled;
}

function talk(p, npc, option = "Talk-to") {
  const definition = npc.getCurrentDefinition?.(p) ?? npc.getDefinition();
  const clickType = (definition?.getActions?.() ?? []).findIndex((op) => op === option) + 1 || 1;
  const npcId = npc.getContentId?.(p) ?? npc.getId();
  return once(`${option} ${npcId}`, () => PM.emitNpcInteraction({ player: p, npc, npcId, npcIndex: npc.getIndex(), definition, clickType, action: option,
    location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: npc.getLocation().getZ() }, handled: false }));
}

function fakeObject(id, [x, y, z], face = 0, type = 10) {
  return { getId: () => id, getLocation: () => new core.Location(x, y, z), getPrivateArea: () => null, getType: () => type, getFace: () => face,
    getDefinition: () => core.ObjectDefinition.forId(id) };
}

function click(p, id, option, at, { face = 0, type = 10 } = {}) {
  const definition = core.ObjectDefinition.forPlayer(id, p) ?? core.ObjectDefinition.forId(id);
  const options = definition.getInteractions();
  const name = option ?? options.find(Boolean);
  const clickType = options.findIndex((op) => op === name) + 1;
  assert.ok(clickType > 0, `${definition.getName()} (${id}) has ${name} in [${options.join(", ")}]`);
  const [x, y, z] = at;
  return once(`${name} ${id}`, () => PM.emitObjectInteraction({ player: p, object: fakeObject(id, at, face, type), objectId: id, definition, clickType,
    option: name, location: { x, y, z }, sourceLocation: { x: p.getLocation().getX(), y: p.getLocation().getY(), z: p.getLocation().getZ() }, handled: false }));
}

function useOn(p, itemId, id, at, { face = 0, type = 10 } = {}) {
  const slot = slotOf(p, itemId);
  assert.ok(slot >= 0, `holding ${itemId}`);
  const [x, y, z] = at;
  return once(`item ${itemId} on ${id}`, () => PM.emitItemOnObject({ player: p, object: fakeObject(id, at, face, type),
    definition: core.ObjectDefinition.forPlayer(id, p) ?? undefined, objectId: id, item: p.getInventory().getItems()[slot], itemId, itemSlot: slot,
    interfaceType: 0, location: { x, y, z }, handled: false }));
}

function sketch(p) {
  const items = p.getInventory().getItems();
  const used = slotOf(p, CHARCOAL), target = slotOf(p, PAPYRUS);
  assert.ok(used >= 0 && target >= 0, "charcoal and papyrus held");
  return PM.emitItemOnItem({ player: p, usedItem: items[used], usedItemId: CHARCOAL, usedItemSlot: used,
    usedWithItem: items[target], usedWithItemId: PAPYRUS, usedWithItemSlot: target, handled: false });
}

function itemOption(p, itemId, option) {
  const slot = slotOf(p, itemId);
  const action = [1, 2, 3, 4, 6, 7].map((op) => ItemActionPacketListener.resolveInventoryWidgetAction(itemId, op)).find((a) => a?.option === option);
  assert.ok(action, `item ${itemId} has ${option}`);
  return PM.emitItemAction({ player: p, item: p.getInventory().getItems()[slot], itemId, slot, interfaceId: 149 << 16,
    clickType: action.optionIndex, option: action.option, handled: false });
}

/** Runs the Meiyerditch area tick with the notice roll forced (the Hassle unit's 1-in-150). */
function notice(p, ticks = 2) {
  const random = Math.random;
  Math.random = () => 0;
  try {
    for (let i = 0; i < ticks; i++) AreaManager.process(p);
  } finally {
    Math.random = random;
  }
}

function vyrewatch(t, id, where) {
  const npc = core.NPC.create(id, new core.Location(...where));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove?.(npc));
  return npc;
}

// ---------------------------------------------------------------------------
// The end-to-end walk
// ---------------------------------------------------------------------------

test("fresh stage 0 reaches 320 through all six units' handlers, every live stage once and in order", (t) => {
  const f = actor(t, 0, [3494, 9629, 0]);
  const { p, seen } = f;
  // Every value the stage attribute takes (the units' advances and the runtime's completion alike).
  const stages = [];
  const setAttribute = p.setAttribute.bind(p);
  p.setAttribute = (key, value, ...rest) => {
    if (key === STAGE_KEY && Number(value) !== stageOf(p)) stages.push(Number(value));
    return setAttribute(key, value, ...rest);
  };
  const reached = (stage) => assert.equal(stageOf(p), stage, `stage ${stage} (route so far ${stages.join(",")})`);
  const at = (...location) => { p.getDialogueManager().reset?.(); p.getPacketSender().sendInterfaceRemoval(); p.moveTo(new core.Location(...location)); tick(); };
  const veliaf = f.spawn(VELIAF, [3494, 9628, 0]);

  // --- Boat (0-50): Veliaf's start, the repairs, the push, the ride, the dock rock.
  assert.equal(talk(p, veliaf), true);
  until(p, "Is there something I can do to help out?");
  choose(p, "Is there something I can do to help out?");
  until(p, "Start the Darkness of Hallowvale quest?");
  choose(p, "Yes.");
  until(p, "Once you're in");
  reached(STAGE.NOT_STARTED);
  cont(p);
  reached(STAGE.STARTED); // the continue of "Once you're in..." (t334)
  finish(p);

  at(3523, 3180, 0);
  give(p, I.HAMMER);
  give(p, I.PLANK, 2);
  give(p, I.STEEL_NAILS, 8);
  assert.equal(click(p, BOAT, null, [3523, 3177, 0]), true);
  until(p, "Fix the boat?");
  choose(p, "Yes.");
  tick();
  p.moveTo(new core.Location(3525, 3178, 0));
  tick(6);
  reached(STAGE.BOAT_FIXED);
  at(3523, 3176, 0);
  assert.equal(click(p, CHUTE, null, [3523, 3175, 0]), true);
  until(p, "Fix the chute?");
  choose(p, "Yes.");
  tick(6);
  reached(STAGE.CHUTE_FIXED);
  at(3523, 3180, 0);
  assert.equal(click(p, BOAT, null, [3523, 3177, 0]), true); // Push: the cutscene
  tick(28);
  assert.equal(varbit(p, VARBIT.BOAT_BROKEN), 2, "the boat is in the water");
  reached(STAGE.CHUTE_FIXED);
  at(3525, 3170, 0);
  assert.equal(click(p, SEA_BOAT, null, [3522, 3169, 0]), true);
  tick(3);
  reached(STAGE.BOAT_RIDE);
  tick(13);
  assert.deepEqual(tile(p), [3605, 3161, 1], "the dock");
  p.getDialogueManager().reset?.();
  assert.equal(click(p, DOCK_ROCK, null, [3605, 3163, 1]), true);
  tick(3);
  reached(STAGE.ARRIVED);

  // --- Ghetto (50-80): the floorboards, a citizen, Old Man Ral, the route, the hideout.
  at(3590, 3173, 1);
  assert.equal(click(p, 18122, "Search", [3589, 3173, 1]), true);
  cont(p);
  choose(p, "Yes.");
  tick(3);
  assert.equal(varbit(p, VARBIT.WALL_FLOORBOARDS), 1);
  click(p, 18122, "Climb-down", [3589, 3173, 1]);
  tick(3);
  assert.deepEqual(tile(p), [3588, 3173, 0]);
  at(3593, 3186, 0);
  const citizen = f.spawn(CITIZEN, [3593, 3187, 0]);
  assert.equal(talk(p, citizen), true);
  until(p, "(whisper) Do you know about the Myreque?");
  choose(p, "(whisper) Do you know about the Myreque?");
  until(p, "Yes... but I really can't talk about them.");
  cont(p);
  reached(STAGE.WHISPERED);
  until(p, "(whisper) I really need to meet the Myreque.");
  choose(p, "(whisper) I really need to meet the Myreque.");
  until(p, "I understand, but you may not like what you find.");
  reached(STAGE.INSISTED);
  until(p, "Can you introduce me to Old Man Ral?");
  choose(p, "Can you introduce me to Old Man Ral?");
  reached(STAGE.RAL_INTRODUCED);
  at(3607, 3208, 0);
  const ral = f.spawn(RAL, [3607, 3209, 0]);
  assert.equal(talk(p, ral), true);
  until(p, "Someone said you could help me.");
  choose(p, "Someone said you could help me.");
  until(p, "Old Man Ral, the sage of Sanguinesti.");
  choose(p, "Old Man Ral, the sage of Sanguinesti.");
  until(p, "Hmph. Myreque, eh?");
  reached(STAGE.ROUTE_KNOWN);
  finish(p);
  // A few of the route's own states on the way: the first push wall, the pots' key and the door, the ladder top.
  at(3605, 3203, 1);
  assert.equal(click(p, 18128, "Push", [3605, 3204, 1], { face: 1 }), true);
  tick(3);
  assert.equal(varbit(p, VARBIT.PUSHWALL_4), 2);
  at(3607, 3222, 0);
  assert.equal(click(p, 18065, "Search", [3608, 3222, 0]), true);
  tick(2);
  assert.equal(amount(p, DOOR_KEY), 1);
  at(3608, 3221, 0);
  assert.equal(click(p, 18091, "Open", [3608, 3221, 0], { face: 2, type: 0 }), true);
  assert.equal(varbit(p, VARBIT.GHETTO_DOOR), 1);
  cont(p);
  tick(3);
  at(3625, 3241, 2);
  assert.equal(click(p, 18115, "Search", [3625, 3240, 2], { face: 2, type: 0 }), true);
  assert.equal(amount(p, LADDER_TOP), 1);
  at(3629, 3241, 1);
  assert.equal(click(p, 18116, "Search", [3629, 3240, 1], { face: 3 }), true);
  tick(2);
  assert.equal(varbit(p, VARBIT.LADDERTOP_WALL), 2, "the ladder mended");
  reached(STAGE.ROUTE_KNOWN);
  at(3640, 3253, 0);
  give(p, KNIFE);
  assert.equal(useOn(p, KNIFE, 17980, [3640, 3253, 0], { face: 3, type: 0 }), true);
  cont(p);
  tick(3);
  reached(STAGE.LATCH_UNHOOKED);
  p.getDialogueManager().reset?.();
  assert.equal(click(p, 17980, "Push", [3640, 3253, 0], { face: 3, type: 0 }), true);
  p.moveTo(new core.Location(3639, 3251, 0));
  tick(3);
  assert.equal(click(p, 18146, "Press", [3638, 3251, 0], { face: 1, type: 0 }), true);
  tick(2);
  p.moveTo(new core.Location(3639, 3250, 0));
  assert.equal(click(p, 18120, "Open", [3639, 3249, 0], { face: 1, type: 22 }), true);
  tick();
  assert.equal(click(p, 18120, "Climb-down", [3639, 3249, 0], { face: 1, type: 22 }), true);
  tick(4);
  reached(STAGE.IN_HIDEOUT);
  assert.deepEqual(tile(p), [3626, 9618, 0], "in the hideout");

  // --- Errands (80-180): Vertida, Veliaf, Drezel, the bush, the runes, King Roald, Aeonisig, Veliaf.
  at(3629, 9643, 0);
  const vertida = f.spawn(VERTIDA, [3628, 9641, 0]);
  assert.equal(talk(p, vertida), true);
  until(p, "Vertida gives you a message.");
  reached(STAGE.VERTIDA_MESSAGE);
  assert.equal(amount(p, MESSAGE), 1);
  finish(p);
  at(3494, 9629, 0);
  assert.equal(talk(p, veliaf), true);
  until(p, "You hand over the message to Veliaf.");
  reached(STAGE.MESSAGE_DELIVERED);
  until(p, "What do you want me to do?");
  cont(p);
  reached(STAGE.SENT_TO_DREZEL);
  finish(p);
  at(3440, 9893, 0);
  const drezel = f.spawn(DREZEL, [3439, 9894, 0]);
  assert.equal(talk(p, drezel), true);
  until(p, "But anyway, what do you need from me?");
  cont(p);
  reached(STAGE.DREZEL_TALKED);
  assert.equal(varbit(p, VARBIT.BUSH), 1);
  until(p, "When and where were these noises heard?");
  choose(p, "When and where were these noises heard?");
  until(p, "Okay, thanks.");
  choose(p, "Okay, thanks.");
  finish(p);
  at(3391, 3480, 0);
  assert.equal(click(p, 18121, "Search", [3390, 3480, 0]), true);
  tick(16);
  until(p, "Ouch! My poor head!");
  reached(STAGE.WEREWOLVES_SEEN);
  assert.equal(varbit(p, VARBIT.BUSH), 0);
  cont(p);
  at(3440, 9893, 0);
  assert.equal(talk(p, drezel), true);
  until(p, "Drezel gives you some runes.");
  reached(STAGE.RUNES_GIVEN);
  assert.deepEqual([amount(p, LAW), amount(p, AIR), amount(p, FIRE)], [1, 3, 1]);
  finish(p);
  at(3223, 3473, 0);
  const roald = f.spawn(ROALD, [3223, 3471, 0]);
  f.spawn(AEONISIG, [3225, 3473, 0]);
  assert.equal(talk(p, roald), true);
  until(p, "Talk to the king about Morytania.");
  choose(p, "Talk to the king about Morytania.");
  until(p, "I am sorry, but Aeonisig is my advisor");
  cont(p);
  reached(STAGE.ROALD_REFUSED);
  until(p, "Okay, thanks.");
  choose(p, "Okay, thanks.");
  finish(p);
  at(3223, 3473, 0);
  assert.equal(talk(p, roald), true);
  until(p, "Talk to the king about Morytania.");
  choose(p, "Talk to the king about Morytania.");
  until(p, "I'd like to ask a few questions if I may?");
  choose(p, "I'd like to ask a few questions if I may?");
  until(p, "What should I do now?");
  choose(p, "What should I do now?");
  until(p, "Well then, I must try to do something");
  cont(p);
  reached(STAGE.ROALD_TELEPORT);
  until(p, "Yes thanks. I'll accept the free teleport.");
  choose(p, "Yes thanks. I'll accept the free teleport.");
  until(p, "Prepare yourself for teleport!");
  cont(p);
  tick(5);
  assert.deepEqual(tile(p), [3421, 9888, 0], "Paterdomus basement");
  reached(STAGE.BACK_AT_PATERDOMUS);
  finish(p);
  at(3494, 9629, 0);
  assert.equal(talk(p, veliaf), true);
  until(p, "What should we do now? There must be someone else");
  cont(p);
  reached(STAGE.SENT_BACK);
  finish(p);

  // --- Back to Meiyerditch (the Boat unit's later trip) and a vyrewatch (Hassle), as at t5405-5840.
  at(3525, 3170, 0);
  assert.equal(click(p, SEA_BOAT, null, [3522, 3169, 0]), true);
  tick(12);
  assert.deepEqual(tile(p), [3605, 3161, 1], "the dock again");
  tick(3);
  p.getDialogueManager().reset?.();
  assert.equal(click(p, DOCK_ROCK, null, [3605, 3163, 1]), true);
  tick(3);
  at(...STREET);
  const vyre = vyrewatch(t, VYREWATCH, [3609, 3187, 0]);
  notice(p, 2);
  assert.ok(seen.messages.includes("A vyrewatch takes an interest in you."));
  until(p, "Send me to the mines!");
  choose(p, "Send me to the mines!");
  tick(13);
  assert.deepEqual(tile(p), MINE, "sent to the mine");
  core.World.getNpcs().remove?.(vyre);
  give(p, DAEYALT_ORE, 15);
  const cartDefinition = core.ObjectDefinition.forPlayer(18119, p) ?? core.ObjectDefinition.forId(18119);
  assert.equal(PM.emitItemOnObject({ player: p, object: { getId: () => 18119, getLocation: () => new core.Location(2392, 4630, 2), getDefinition: () => cartDefinition },
    definition: cartDefinition, objectId: 18119, item: p.getInventory().getItems()[slotOf(p, DAEYALT_ORE)], itemId: DAEYALT_ORE,
    itemSlot: slotOf(p, DAEYALT_ORE), interfaceType: 0, location: { x: 2392, y: 4630, z: 2 }, handled: false }), true);
  p.getDialogueManager().reset?.();
  p.moveTo(new core.Location(2389, 4618, 2));
  tick();
  assert.equal(talk(p, core.NPC.create(MINE_GUARD, new core.Location(2389, 4616, 2))), true);
  finish(p);
  tick(5);
  assert.deepEqual(tile(p), [3621, 3322, 0], "let out of the mine");
  assert.equal(varbit(p, VARBIT.MINE_PUNISHED), 1);
  reached(STAGE.SENT_BACK);

  // --- Sketches (180-250): Vertida, the lead, the Drakan wall, Safalaan, three sketches, Vanstrom, Sarius.
  at(3629, 9643, 0);
  assert.equal(talk(p, vertida), true);
  until(p, "Okay, great, that's helpful.");
  cont(p);
  reached(STAGE.SAFALAAN_DESCRIBED);
  assert.equal(varbit(p, VARBIT.SAFALAAN_VISIBLE), 1);
  until(p, "Okay, lead the way.");
  choose(p, "Okay, lead the way.");
  cont(p);
  tick(4);
  assert.deepEqual(tile(p), [3596, 3203, 1], "Vertida's lead");
  at(3595, 3310, 1);
  assert.equal(click(p, 39173, "Climb-up", [3595, 3310, 1]), true);
  tick(2);
  assert.deepEqual(tile(p), [3595, 3312, 0], "over the Drakan wall");
  at(3585, 3331, 0);
  const safalaan = f.spawn(SAFALAAN_WALL, [3584, 3331, 0]);
  assert.equal(talk(p, safalaan), true);
  until(p, "Ah, Veliaf!");
  reached(STAGE.SAFALAAN_MET);
  until(p, "Good luck, my friend.");
  reached(STAGE.SKETCHING);
  assert.deepEqual([amount(p, CHARCOAL), amount(p, PAPYRUS)], [1, 3]);
  finish(p);
  at(...NORTH);
  assert.equal(sketch(p), true);
  tick(3);
  reached(STAGE.NORTH_SKETCHED);
  assert.equal(amount(p, SKETCH_1), 1);
  at(...WEST);
  assert.equal(sketch(p), true);
  tick(10);
  until(p, "Mmm, delicious!");
  cont(p);
  tick(7);
  until(p, "But we really have to get on.");
  cont(p);
  tick(3);
  until(p, "The same is true for me, m'lady.");
  cont(p);
  tick(16);
  reached(STAGE.WEST_SKETCHED);
  assert.equal(amount(p, SKETCH_2), 1);
  assert.deepEqual(tile(p), WEST, "back from the western scene");
  at(...SOUTH);
  assert.equal(sketch(p), true);
  tick(16);
  until(p, "Ha! So we meet again");
  cont(p);
  reached(STAGE.VANSTROM_ATTACKS);
  tick(2 + 8 * 4);
  assert.equal(seen.hits.length, 5, "Vanstrom's five attacks");
  tick(13);
  until(p, "I take no orders from food sacks");
  cont(p);
  reached(STAGE.SARIUS_SAVED);
  tick(6);
  until(p, "And now be away");
  reached(STAGE.SARIUS_TALKED);
  cont(p);
  tick(5);
  p.getDialogueManager().reset?.();
  assert.equal(sketch(p), true);
  tick(3);
  assert.equal(amount(p, SKETCH_3), 1, "the third sketch, at 250");

  // --- Lab (250-320): the fireplace, the portrait, Safalaan, the tapestry, the statue, the lab, Veliaf.
  at(3627, 3252, 0);
  assert.equal(useOn(p, KNIFE, 18039, [3627, 3253, 0]), true);
  reached(STAGE.FIREPLACE_OPENED);
  assert.equal(amount(p, SARIUS_MESSAGE), 1);
  at(3627, 3249, 0);
  assert.equal(useOn(p, KNIFE, 18126, [3627, 3248, 0]), true);
  tick(2);
  assert.equal(amount(p, ORNATE_KEY), 1);
  at(3627, 9645, 0);
  const hideoutSafalaan = f.spawn(SAFALAAN_HIDEOUT, [3627, 9646, 0]);
  assert.equal(talk(p, hideoutSafalaan), true);
  until(p, "Ah yes. I have it here.");
  assert.equal(varbit(p, VARBIT.SKETCHES_GIVEN), 1);
  assert.equal([SKETCH_1, SKETCH_2, SKETCH_3].reduce((sum, id) => sum + amount(p, id), 0), 0, "the sketches handed in");
  cont(p);
  reached(STAGE.MESSAGE_SHOWN);
  finish(p);
  at(3638, 3304, 0);
  assert.equal(useOn(p, KNIFE, 18125, [3638, 3304, 0]), true);
  tick(3);
  reached(STAGE.TAPESTRY_SLASHED);
  p.getDialogueManager().reset?.();
  assert.equal(click(p, 18125, "Walk-through", [3638, 3304, 0]), true);
  tick(2);
  assert.deepEqual(tile(p), [3638, 3305, 0], "through the tapestry");
  at(3641, 3305, 0);
  assert.equal(useOn(p, ORNATE_KEY, 18127, [3641, 3304, 0]), true);
  tick(2);
  reached(STAGE.STATUE_KEYED);
  at(3641, 3306, 0);
  assert.equal(click(p, 18047, "Open", [3641, 3307, 0]), true);
  tick(1);
  reached(STAGE.LAB_OPENED);
  tick(3);
  at(3643, 3306, 0);
  assert.equal(click(p, 18049, "Climb-down", [3643, 3304, 0]), true);
  tick(5);
  assert.deepEqual(tile(p), [3637, 9695, 0], "in the laboratory");
  at(3633, 9694, 0);
  assert.equal(click(p, 18052, "Search", [3632, 9694, 0]), true);
  assert.equal(varbit(p, VARBIT.RUNECASE_SEARCHED), 1);
  // Checkpoint-free shortcut: the book is a world ground spawn (ground-items.json, 3624,9690) taken by the
  // generic ground-item pickup (or Telekinetic Grab, t7457); no quest handler is involved, so it goes in the bag.
  give(p, HAEMALCHEMY);
  reached(STAGE.LAB_OPENED);
  at(3637, 9695, 0);
  assert.equal(click(p, 18050, "Climb-up", [3637, 9696, 0]), true);
  tick(5);
  assert.deepEqual(tile(p), [3643, 3306, 0]);
  at(3627, 9645, 0);
  assert.equal(talk(p, hideoutSafalaan), true);
  until(p, "Safalaan teaches you how to unlock");
  reached(STAGE.SEALED_MESSAGE);
  assert.equal(amount(p, SEALED), 1);
  assert.equal(amount(p, HAEMALCHEMY), 0);
  finish(p);
  at(3494, 9629, 0);
  const sealedSlot = slotOf(p, SEALED);
  const points = Number(p.getAttribute("quest.points")) || 0;
  const xp = ["AGILITY", "THIEVING", "CONSTRUCTION"].map((skill) => p.getSkillManager().getExperience(core.Skill[skill]));
  assert.equal(talk(p, veliaf), true);
  until(p, "You show the message to Veliaf.");
  until(p, "You've done well. I'd say you've earnt a break.");
  reached(STAGE.SEALED_MESSAGE);
  cont(p);
  reached(STAGE.COMPLETE);
  assert.equal(complete(p), true, "the quest is complete");
  assert.equal(p.getInventory().getItems()[sealedSlot]?.getId(), TOME, "the tome takes the sealed message's slot");
  assert.equal(amount(p, SEALED), 0);
  assert.ok(sent(seen, 3412, 1), "ramble_npcs_visible");
  assert.equal(Number(p.getAttribute("quest.points")), points + 2, "two quest points");
  assert.deepEqual(["AGILITY", "THIEVING", "CONSTRUCTION"].map((skill, i) => p.getSkillManager().getExperience(core.Skill[skill]) - xp[i]),
    [7000, 6000, 2000]);
  assert.deepEqual(seen.jingles.filter((id) => id === 154), [154], "jingle 154, once");
  tick(3);
  assert.ok(seen.interfaces.includes(153), "the scroll");
  assert.ok(seen.items.includes(9661), "myq3_quest_complete_icon");
  for (const line of ["2 Quest Points", "7,000 Agility XP", "6,000 Thieving XP", "2,000 Construction XP", "A Tome of Experience"]) {
    assert.ok(seen.strings.includes(line), `the scroll's "${line}"`);
  }
  assert.match(journal(p), /QUEST COMPLETE/);

  assert.deepEqual(stages, ROUTE, "every live stage, once, in order");
});

// ---------------------------------------------------------------------------
// Ported contracts
// ---------------------------------------------------------------------------

const groundCopies = (p, id) => core.World.getItems().filter((ground) => ground.getItem?.()?.getId?.() === id && ground.getOwner?.() === p.getUsername());
const holdsSupplies = (p) => { give(p, CHARCOAL); give(p, PAPYRUS, 3); };
const ON_THE_WALL = [3585, 3331, 0], HIDEOUT_SAFALAAN = [3627, 9645, 0], AT_VELIAF = [3494, 9629, 0];

test("the north sketch completes the north leg (210, sketch 1, 2592 = 2) and the journal moves on to the west", (t) => {
  const { p } = actor(t, STAGE.SKETCHING, NORTH);
  holdsSupplies(p);
  assert.equal(sketch(p), true);
  tick(3);
  assert.equal(stageOf(p), STAGE.NORTH_SKETCHED);
  assert.equal(amount(p, SKETCH_1), 1);
  assert.equal(varbit(p, VARBIT.SAFALAAN_VISIBLE), 2);
  assert.match(journal(p), /sketched the northern approach/);
  assert.match(journal(p), /western approach/);
});

test("Vertida's message on a full bag lands under the player with 90; without it she gives another", (t) => {
  const { p, spawn } = actor(t, STAGE.IN_HIDEOUT, [3629, 9643, 0]);
  fill(p);
  const vertida = spawn(VERTIDA, [3628, 9641, 0]);
  assert.equal(talk(p, vertida), true);
  until(p, "Vertida gives you a message.");
  assert.equal(stageOf(p), STAGE.VERTIDA_MESSAGE);
  assert.equal(amount(p, MESSAGE), 0);
  assert.equal(groundCopies(p, MESSAGE).length, 1, "the message is on the floor, not lost");
  finish(p);
  p.getDialogueManager().reset?.();
  p.getInventory().delete(I.BRONZE_DAGGER, 1);
  talk(p, vertida);
  until(p, "What should I do now?");
  choose(p, "What should I do now?");
  until(p, "Vertida gives you a message.");
  assert.equal(amount(p, MESSAGE), 1);
});

test("Drezel's runes wait for room for the stacks not held, and then 140", (t) => {
  const { p, seen, spawn } = actor(t, STAGE.WEREWOLVES_SEEN, [3440, 9893, 0]);
  const drezel = spawn(DREZEL, [3441, 9895, 0]);
  fill(p, 2);
  talk(p, drezel);
  finish(p);
  assert.equal(stageOf(p), STAGE.WEREWOLVES_SEEN, "two free slots for three new stacks");
  assert.deepEqual([amount(p, LAW), amount(p, AIR), amount(p, FIRE)], [0, 0, 0]);
  assert.ok(seen.messages.includes("You don't have enough inventory space."));
  p.getDialogueManager().reset?.();
  p.getInventory().delete(I.BRONZE_DAGGER, 1);
  talk(p, drezel);
  until(p, "Drezel gives you some runes.");
  assert.equal(stageOf(p), STAGE.RUNES_GIVEN);
  assert.deepEqual([amount(p, LAW), amount(p, AIR), amount(p, FIRE)], [1, 3, 1]);
});

test("Drezel's runes go into existing stacks: a partial stack with two free slots, and full stacks with none", (t) => {
  const partial = actor(t, STAGE.WEREWOLVES_SEEN, [3440, 9893, 0]);
  const drezel = partial.spawn(DREZEL, [3441, 9895, 0]);
  give(partial.p, AIR, 1);
  fill(partial.p, 2);
  talk(partial.p, drezel);
  until(partial.p, "Drezel gives you some runes.");
  assert.equal(stageOf(partial.p), STAGE.RUNES_GIVEN);
  assert.deepEqual([amount(partial.p, LAW), amount(partial.p, AIR), amount(partial.p, FIRE)], [1, 4, 1]);
  finish(partial.p);
  partial.p.getDialogueManager().reset?.();
  talk(partial.p, drezel);
  finish(partial.p);
  assert.equal(amount(partial.p, AIR), 4, "talking again after 140 gives nothing more");

  const full = actor(t, STAGE.WEREWOLVES_SEEN, [3440, 9893, 0]);
  const drezel2 = full.spawn(DREZEL, [3441, 9895, 0]);
  give(full.p, AIR, 100);
  give(full.p, FIRE, 2);
  give(full.p, LAW, 9);
  fill(full.p, 0);
  talk(full.p, drezel2);
  until(full.p, "Drezel gives you some runes.");
  assert.equal(stageOf(full.p), STAGE.RUNES_GIVEN);
  assert.deepEqual([amount(full.p, LAW), amount(full.p, AIR), amount(full.p, FIRE)], [10, 103, 3]);
});

test("full-bag handouts keep their legs: Safalaan's supplies, the ladder top, the rune case and the portrait key", (t) => {
  // Safalaan: the supplies land under the player (live never had a full bag); 200 still starts the sketches.
  const wall = actor(t, STAGE.SAFALAAN_MET, ON_THE_WALL);
  fill(wall.p);
  talk(wall.p, wall.spawn(SAFALAAN_WALL, [3584, 3331, 0]));
  until(wall.p, "Good luck, my friend.");
  assert.equal(stageOf(wall.p), STAGE.SKETCHING);
  assert.equal(amount(wall.p, CHARCOAL), 0);
  assert.equal(groundCopies(wall.p, CHARCOAL).length, 1, "the charcoal is on the floor");
  assert.equal(groundCopies(wall.p, PAPYRUS).length, 3, "and the three papyrus");

  // The ladder top: a full pack leaves the wall full (2598 = 0) and searchable.
  const roof = actor(t, STAGE.ROUTE_KNOWN, [3625, 3241, 2], { vars: { [VARBIT.LADDERTOP_WALL]: 0 } });
  roof.p.setAttribute(VARS_ATTRIBUTE, Object.fromEntries(Object.entries(roof.p.getAttribute(VARS_ATTRIBUTE)).filter(([id]) => Number(id) !== VARBIT.LADDERTOP_WALL)));
  fill(roof.p);
  assert.equal(click(roof.p, 18115, "Search", [3625, 3240, 2], { face: 2, type: 0 }), true);
  assert.equal(varbit(roof.p, VARBIT.LADDERTOP_WALL), 0);
  assert.equal(amount(roof.p, LADDER_TOP), 0);
  roof.p.getInventory().delete(I.BRONZE_DAGGER, 1);
  click(roof.p, 18115, "Search", [3625, 3240, 2], { face: 2, type: 0 });
  assert.equal(varbit(roof.p, VARBIT.LADDERTOP_WALL), 1);
  assert.equal(amount(roof.p, LADDER_TOP), 1);

  // The rune case: no room, no runes and still unsearched; then the transcript's runes and 2584.
  const lab = actor(t, STAGE.LAB_OPENED, [3633, 9694, 0]);
  fill(lab.p);
  assert.equal(click(lab.p, 18052, "Search", [3632, 9694, 0]), true);
  assert.equal(varbit(lab.p, VARBIT.RUNECASE_SEARCHED), 0);
  assert.equal(amount(lab.p, LAW), 0);
  for (let i = 0; i < 5; i++) lab.p.getInventory().delete(I.BRONZE_DAGGER, 1);
  lab.p.getDialogueManager().reset?.();
  click(lab.p, 18052, "Search", [3632, 9694, 0]);
  assert.equal(varbit(lab.p, VARBIT.RUNECASE_SEARCHED), 1);
  assert.deepEqual([amount(lab.p, LAW), amount(lab.p, AIR)], [1, 3]);

  // The portrait: a full bag's key lands under the player; a lost key comes back from the slashed portrait.
  const house = actor(t, STAGE.FIREPLACE_OPENED, [3627, 3249, 0], { vars: { [VARBIT.PORTRAIT]: 0 } });
  give(house.p, KNIFE);
  fill(house.p);
  assert.equal(useOn(house.p, KNIFE, 18126, [3627, 3248, 0]), true);
  tick(1);
  assert.equal(varbit(house.p, VARBIT.PORTRAIT), 2);
  assert.equal(groundCopies(house.p, ORNATE_KEY).length, 1, "the key is on the floor");
  house.p.getInventory().delete(I.BRONZE_DAGGER, 1);
  house.p.getDialogueManager().reset?.();
  assert.equal(click(house.p, 18126, "Inspect", [3627, 3248, 0]), true);
  assert.equal(amount(house.p, ORNATE_KEY), 1, "the slashed portrait gives the key again");
});

test("the boat back from Burgh de Rott after the Misthalin leg lands at the Meiyerditch dock (180)", (t) => {
  const { p, seen } = actor(t, STAGE.SENT_BACK, [3525, 3170, 0]);
  assert.equal(click(p, SEA_BOAT, null, [3522, 3169, 0]), true);
  tick(12);
  assert.deepEqual(tile(p), [3605, 3161, 1]);
  assert.ok(seen.messages.includes("You board the boat and sail to Meiyerditch."));
  assert.ok(!seen.interfaces.includes(454), "no boat map on a later trip");
  assert.equal(stageOf(p), STAGE.SENT_BACK);
});

test("picking up the haemalchemy book sets no stage (t7457); Safalaan's sealed message is 310", (t) => {
  const { p } = actor(t, STAGE.LAB_OPENED, HIDEOUT_SAFALAAN);
  give(p, HAEMALCHEMY);
  assert.equal(stageOf(p), STAGE.LAB_OPENED);
  talk(p, core.NPC.create(SAFALAAN_HIDEOUT, new core.Location(3627, 9646, 0)));
  until(p, "Safalaan teaches you how to unlock");
  assert.equal(stageOf(p), STAGE.SEALED_MESSAGE);
});

test("the Drakan wall shortcut climbs between the city wall and Safalaan", (t) => {
  const { p } = actor(t, STAGE.SENT_BACK, [3595, 3310, 1]);
  assert.equal(click(p, 39173, "Climb-up", [3595, 3310, 1]), true);
  tick(2);
  assert.deepEqual(tile(p), [3595, 3312, 0]);
  assert.equal(click(p, 39172, null, [3595, 3311, 0]), true);
  tick(2);
  assert.deepEqual(tile(p), [3595, 3310, 1]);
});

test("completion is stored and sent as 320 and replays at login with the journal's QUEST COMPLETE", (t) => {
  const { p, seen } = actor(t, STAGE.COMPLETE, AT_VELIAF);
  seen.varbits.length = 0;
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.equal(stageOf(p), 320);
  assert.equal(p.getPacketSender().getVarbit(VARBIT.QUEST), 320, "varbit 2573 is 320 after the login replay");
  assert.ok(sent(seen, 3412, 1), "ramble_npcs_visible again");
  assert.equal(complete(p), true);
  assert.match(journal(p), /QUEST COMPLETE/);
});

test("Vertida's pointer to Safalaan (t2mfif) after Roald and after the supplies; the briefing at 180", (t) => {
  const page = require("../data/definitions/npc-dialogues.json")[PAGE];
  for (const variant of ["misthalin-diplomacy-talking-to-vertida-sefalatis-after-talking-to-king-roald",
    "close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-after-talking-to-safalaan-hallow"]) {
    assert.deepEqual(page.variants[variant], [{ type: "call", branch: "t2mfif" }]);
  }
  for (const [stage, variant] of [
    [STAGE.BACK_AT_PATERDOMUS, "misthalin-diplomacy-talking-to-vertida-sefalatis-after-talking-to-king-roald"],
    [STAGE.SENT_BACK, "close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-after-being-sent-to-inform-the-sanguinesti-myreque"],
    [STAGE.SKETCHING, "close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-after-talking-to-safalaan-hallow"],
  ]) {
    const { p, spawn } = actor(t, stage, [3629, 9643, 0]);
    assert.equal(talk(p, spawn(VERTIDA, [3628, 9641, 0])), true);
    assert.equal(lastVariant(), variant, `Vertida at ${stage}`);
  }
});

test("Veliaf after the Roald teleport sends the player back (180); after that his re-talk keeps 180", (t) => {
  const before = actor(t, STAGE.RUNES_GIVEN, AT_VELIAF);
  talk(before.p, before.spawn(VELIAF, [3494, 9628, 0]));
  assert.equal(lastVariant(), "misthalin-diplomacy-talking-to-veliaf-hurtz-after-encountering-the-werewolves");
  finish(before.p);
  assert.equal(stageOf(before.p), STAGE.RUNES_GIVEN, "before Roald answers he gives no task");

  const { p, spawn } = actor(t, STAGE.BACK_AT_PATERDOMUS, AT_VELIAF);
  const veliaf = spawn(VELIAF, [3494, 9628, 0]);
  talk(p, veliaf);
  assert.equal(lastVariant(), "misthalin-diplomacy-talking-to-veliaf-hurtz-after-talking-to-king-roald");
  until(p, "We must inform the Sanguinesti order");
  assert.equal(stageOf(p), STAGE.SENT_BACK);
  finish(p);
  p.getDialogueManager().reset?.();
  talk(p, veliaf);
  assert.equal(lastVariant(), "misthalin-diplomacy-talking-to-veliaf-again-after-being-sent-to-inform-the-sanguinesti-myreque");
  finish(p);
  assert.equal(stageOf(p), STAGE.SENT_BACK);
});

test("one Vertida talk in the hideout describes Safalaan (190, 2592 = 1); her lead lands west of Trader Sven", (t) => {
  const { p, spawn } = actor(t, STAGE.SENT_BACK, [3629, 9643, 0]);
  const vertida = spawn(VERTIDA, [3628, 9641, 0]);
  talk(p, vertida);
  until(p, "He's very distinctive.");
  assert.equal(stageOf(p), STAGE.SAFALAAN_DESCRIBED);
  assert.equal(p.getPacketSender().getVarbit(VARBIT.QUEST), STAGE.SAFALAAN_DESCRIBED);
  assert.equal(varbit(p, VARBIT.SAFALAAN_VISIBLE), 1);
  until(p, "Okay, lead the way.");
  choose(p, "Okay, lead the way.");
  cont(p);
  tick(4);
  assert.deepEqual(tile(p), [3596, 3203, 1]);
});

test("myq3_sketches_given (2575) is set only by the hand-in and replays at login", (t) => {
  const { p, seen, spawn } = actor(t, STAGE.FIREPLACE_OPENED, HIDEOUT_SAFALAAN);
  assert.equal(varbit(p, VARBIT.SKETCHES_GIVEN), 0, "not implied at 260");
  for (const id of [SKETCH_1, SKETCH_2, SKETCH_3]) give(p, id);
  talk(p, spawn(SAFALAAN_HIDEOUT, [3627, 9646, 0]));
  until(p, "You give the sketches to Safalaan.");
  assert.equal(varbit(p, VARBIT.SKETCHES_GIVEN), 1);
  finish(p);
  seen.varbits.length = 0;
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.ok(sent(seen, VARBIT.SKETCHES_GIVEN, 1), "sent again at login");
});

test("a destroyed ladder top makes the ladder wall searchable again", (t) => {
  const { p } = actor(t, STAGE.ROUTE_KNOWN, [3625, 3241, 2], { vars: { [VARBIT.LADDERTOP_WALL]: 1 } });
  PM.emitCustomEvent("destroy-item:destroyed", { player: p, itemId: LADDER_TOP, amount: 1 });
  assert.equal(varbit(p, VARBIT.LADDERTOP_WALL), 0);
  click(p, 18115, "Search", [3625, 3240, 2], { face: 2, type: 0 });
  assert.equal(amount(p, LADDER_TOP), 1);
});

test("at 250 an incomplete hand-in keeps the sketches; a lost third sketch is drawn again, then the hand-in takes all three", (t) => {
  const { p, spawn } = actor(t, STAGE.SARIUS_TALKED, HIDEOUT_SAFALAAN);
  give(p, SKETCH_1);
  give(p, SKETCH_2);
  const safalaan = spawn(SAFALAAN_HIDEOUT, [3627, 9646, 0]);
  talk(p, safalaan);
  assert.equal(lastVariant(), "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-after-completing-at-least-one-sketch");
  finish(p);
  assert.equal(varbit(p, VARBIT.SKETCHES_GIVEN), 0);
  assert.deepEqual([amount(p, SKETCH_1), amount(p, SKETCH_2)], [1, 1]);
  p.getDialogueManager().reset?.();
  p.moveTo(new core.Location(...SOUTH));
  give(p, CHARCOAL);
  give(p, PAPYRUS);
  assert.equal(sketch(p), true);
  tick(3);
  assert.equal(amount(p, SKETCH_3), 1, "the third sketch again, without Vanstrom");
  assert.equal(stageOf(p), STAGE.SARIUS_TALKED);
  p.getDialogueManager().reset?.();
  p.moveTo(new core.Location(...HIDEOUT_SAFALAAN));
  talk(p, safalaan);
  assert.equal(lastVariant(), "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-with-all-three-sketches");
  until(p, "You give the sketches to Safalaan.");
  assert.equal(varbit(p, VARBIT.SKETCHES_GIVEN), 1);
});

test("lost north and west sketches are drawn again on their tiles at 250 without moving the stage", (t) => {
  for (const [spot, sketchId] of [[NORTH, SKETCH_1], [WEST, SKETCH_2]]) {
    const { p } = actor(t, STAGE.SARIUS_TALKED, spot);
    give(p, CHARCOAL);
    give(p, PAPYRUS);
    if (sketchId === SKETCH_2) give(p, SKETCH_1);
    assert.equal(sketch(p), true);
    tick(4);
    assert.equal(amount(p, sketchId), 1);
    assert.equal(amount(p, PAPYRUS), 0, "the papyrus became the sketch");
    assert.equal(stageOf(p), STAGE.SARIUS_TALKED);
    assert.equal([3733, 3740, 3744, 3700].flatMap((id) => ownedNpcs(p, id)).length, 0, "no western scene again");
  }
});

test("the start gates use the cache DB thresholds on Yes; 10 comes on the continue of 'Once you're in...'", (t) => {
  const startTalk = (p, veliaf) => {
    talk(p, veliaf);
    until(p, "Is there something I can do to help out?");
    choose(p, "Is there something I can do to help out?");
    until(p, "Start the Darkness of Hallowvale quest?");
    choose(p, "Yes.");
  };
  const short = actor(t, 0, AT_VELIAF, { levels: { MINING: 19 } });
  startTalk(short.p, short.spawn(VELIAF, [3494, 9628, 0]));
  assert.ok(short.seen.messages.includes("You need 20 Mining to start this quest."));
  finish(short.p);
  assert.equal(stageOf(short.p), 0);

  const ready = actor(t, 0, AT_VELIAF, { levels: { MINING: 20 } });
  startTalk(ready.p, ready.spawn(VELIAF, [3494, 9628, 0]));
  assert.equal(stageOf(ready.p), 0, "Yes itself changes nothing (t326)");
  until(ready.p, "Once you're in");
  cont(ready.p);
  assert.equal(stageOf(ready.p), STAGE.STARTED);

  // Wiki: "The level 22 Thieving requirement to begin the quest is boostable".
  const boosted = actor(t, 0, AT_VELIAF, { levels: { THIEVING: 21 } });
  boosted.p.getSkillManager().setCurrentLevel(core.Skill.THIEVING, 22);
  startTalk(boosted.p, boosted.spawn(VELIAF, [3494, 9628, 0]));
  assert.ok(!boosted.seen.messages.some((line) => line.includes("22 Thieving")));
  until(boosted.p, "Once you're in");
  cont(boosted.p);
  assert.equal(stageOf(boosted.p), STAGE.STARTED);
});

test("stage-0 Veliaf: 'So what now?' straight after In Aid (5iTY3c), 'Hello again' later (Ao7Gq6); no claim on other NPCs", (t) => {
  const { p } = actor(t, 0, AT_VELIAF);
  const ask = (stepId, npcId = 9489) => PM.emitNpcDialogueCondition({ player: p, npcId, stepId, text: "", pages: [{ page: PAGE }] });
  assert.equal(ask("5iTY3c"), false, "a later talk is not the continuation");
  assert.equal(ask("Ao7Gq6"), true);
  const api = PM.createApi("Q015Continuing");
  api.onCustomEvent("in-aid-of-the-myreque:continuing", (request) => { if (request.player === p) request.continuing = true; });
  const hooks = PM.customEventHooks.get("in-aid-of-the-myreque:continuing");
  const hook = hooks.at(-1);
  t.after(() => hooks.splice(hooks.indexOf(hook), 1));
  assert.equal(ask("5iTY3c"), true, "straight after In Aid, the continuation");
  assert.equal(ask("Ao7Gq6"), false);
  assert.notEqual(PM.emitNpcDialogueCondition({ player: p, npcId: 3775, stepId: "5iTY3c", text: "", pages: [{ page: "Safalaan Hallow" }] }), true,
    "another page's condition is not answered by this quest");
});

test("stage-0 Veliaf belongs to In Aid of the Myreque until it is complete", (t) => {
  const early = actor(t, 0, AT_VELIAF, { inAid: false });
  early.p.setAttribute(IN_AID_STAGE_KEY, 380);
  const before = transcripts.length;
  talk(early.p, early.spawn(VELIAF, [3494, 9628, 0]));
  assert.ok(!transcripts.slice(before).some((call) => call.page === PAGE), "no Darkness transcript");
  assert.equal(stageOf(early.p), 0);

  const { p, spawn } = actor(t, 0, AT_VELIAF);
  talk(p, spawn(VELIAF, [3494, 9628, 0]));
  assert.equal(lastVariant(), "starting-the-quest-talking-to-veliaf-hurtz");
});

test("the pots give the door key once: not while one is carried, not after the door is unlocked, and nothing on a full bag", (t) => {
  const { p } = actor(t, STAGE.ROUTE_KNOWN, [3607, 3222, 0], { vars: { [VARBIT.GHETTO_DOOR]: 0 } });
  p.setAttribute(VARS_ATTRIBUTE, Object.fromEntries(Object.entries(p.getAttribute(VARS_ATTRIBUTE)).filter(([id]) => Number(id) !== VARBIT.GHETTO_DOOR)));
  fill(p);
  click(p, 18065, "Search", [3608, 3222, 0]);
  tick(2);
  assert.equal(amount(p, DOOR_KEY) + groundCopies(p, DOOR_KEY).length, 0, "a full bag finds nothing");
  p.getInventory().delete(I.BRONZE_DAGGER, 1);
  click(p, 18065, "Search", [3608, 3222, 0]);
  tick(2);
  assert.equal(amount(p, DOOR_KEY), 1);
  p.getDialogueManager().reset?.();
  p.getInventory().delete(I.BRONZE_DAGGER, 1);
  click(p, 18065, "Search", [3608, 3222, 0]);
  tick(2);
  assert.equal(amount(p, DOOR_KEY), 1, "no second key while one is carried");
});

test("the ghetto door's unlock (2578) takes the key, is sent to the client and replays at login", (t) => {
  const { p, seen } = actor(t, STAGE.ROUTE_KNOWN, [3608, 3221, 0]);
  p.setAttribute(VARS_ATTRIBUTE, Object.fromEntries(Object.entries(p.getAttribute(VARS_ATTRIBUTE)).filter(([id]) => Number(id) !== VARBIT.GHETTO_DOOR)));
  give(p, DOOR_KEY);
  assert.equal(click(p, 18091, "Open", [3608, 3221, 0], { face: 2, type: 0 }), true);
  assert.ok(sent(seen, VARBIT.GHETTO_DOOR, 1));
  assert.equal(amount(p, DOOR_KEY), 0);
  seen.varbits.length = 0;
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.ok(sent(seen, VARBIT.GHETTO_DOOR, 1), "login sends the saved door state");
});

test("the rune case fills existing rune stacks with no free slots", (t) => {
  const { p } = actor(t, STAGE.LAB_OPENED, [3633, 9694, 0]);
  for (const id of [LAW, FIRE, AIR, WATER, MIND]) give(p, id, 1);
  fill(p);
  const before = [LAW, FIRE, AIR, WATER, MIND].map((id) => amount(p, id));
  assert.equal(click(p, 18052, "Search", [3632, 9694, 0]), true);
  assert.equal(varbit(p, VARBIT.RUNECASE_SEARCHED), 1);
  const after = [LAW, FIRE, AIR, WATER, MIND].map((id) => amount(p, id));
  assert.ok(after.some((value, i) => value > before[i]), "the transcript's runes went into the stacks");
  assert.deepEqual([amount(p, LAW), amount(p, AIR)], [2, 4]);
});

test("Darkness yields Veliaf only while A Taste of Hope reports it needs his rod", (t) => {
  const { p, spawn } = actor(t, STAGE.STARTED, AT_VELIAF);
  const veliaf = spawn(VELIAF, [3494, 9628, 0]);
  let needsRod = false;
  const api = PM.createApi("Q015TasteOfHope");
  api.onCustomEvent("taste-of-hope:needs-veliaf-rod", (request) => { if (request.player === p && needsRod) request.needsRod = true; });
  const hooks = PM.customEventHooks.get("taste-of-hope:needs-veliaf-rod");
  const hook = hooks.at(-1);
  t.after(() => hooks.splice(hooks.indexOf(hook), 1));
  talk(p, veliaf);
  assert.equal(transcripts.at(-1).page, PAGE, "Darkness keeps Veliaf before the rod request");
  p.getDialogueManager().reset?.();
  needsRod = true;
  for (const stage of [STAGE.STARTED, STAGE.VERTIDA_MESSAGE, STAGE.SENT_BACK, STAGE.SEALED_MESSAGE]) {
    p.setAttribute(STAGE_KEY, stage);
    const before = transcripts.length;
    talk(p, veliaf);
    assert.ok(!transcripts.slice(before).some((call) => call.page === PAGE), `no Darkness talk at ${stage} while Taste needs the rod`);
    p.getDialogueManager().reset?.();
  }
  needsRod = false;
  p.setAttribute(STAGE_KEY, STAGE.STARTED);
  talk(p, veliaf);
  assert.equal(transcripts.at(-1).page, PAGE, "Darkness has him again after the hand-out");
});

test("Darkness spawns no Veliaf of its own at login: the world's 8277 is used", (t) => {
  const { p } = actor(t, STAGE.STARTED, AT_VELIAF);
  const near = ownedNpcs(p).filter((npc) => Math.abs(npc.getLocation().getX() - 3494) <= 32 && Math.abs(npc.getLocation().getY() - 9628) <= 32);
  assert.deepEqual(near.map((npc) => npc.getId()), [], "no owner-only NPC in the Burgh de Rott hideout");
});

test("out of order: an unstarted quest gives nothing at the fireplace, portrait, statue, lab door, Drezel or Safalaan", (t) => {
  const { p, spawn } = actor(t, 0, [3627, 3252, 0]);
  give(p, KNIFE);
  give(p, ORNATE_KEY);
  useOn(p, KNIFE, 18039, [3627, 3253, 0]);
  p.getDialogueManager().reset?.();
  useOn(p, KNIFE, 18126, [3627, 3248, 0]);
  tick(2);
  p.getDialogueManager().reset?.();
  useOn(p, ORNATE_KEY, 18127, [3641, 3304, 0]);
  tick(3);
  p.getDialogueManager().reset?.();
  click(p, 18047, "Open", [3641, 3307, 0]);
  tick(2);
  p.getDialogueManager().reset?.();
  talk(p, spawn(DREZEL, [3441, 9895, 0]));
  finish(p);
  p.getDialogueManager().reset?.();
  talk(p, spawn(SAFALAAN_HIDEOUT, [3627, 9646, 0]));
  finish(p);
  assert.equal(stageOf(p), 0, "nothing moves an unstarted quest");
  for (const id of [SARIUS_MESSAGE, SEALED, SKETCH_3, LAW, AIR]) assert.equal(amount(p, id), 0, `no ${id}`);
  assert.equal(varbit(p, VARBIT.PORTRAIT), 0);
  assert.equal(varbit(p, VARBIT.STATUE), 0);

  const early = actor(t, STAGE.SKETCHING, [3627, 3252, 0]);
  give(early.p, KNIFE);
  useOn(early.p, KNIFE, 18039, [3627, 3253, 0]);
  early.p.getDialogueManager().reset?.();
  useOn(early.p, KNIFE, 18125, [3638, 3304, 0]);
  tick(3);
  assert.equal(stageOf(early.p), STAGE.SKETCHING, "the laboratory chain waits for the sketches");
  assert.equal(amount(early.p, SARIUS_MESSAGE), 0);
  assert.equal(varbit(early.p, VARBIT.TAPESTRY), 0);
});

test("Aeonisig Raispher answers as King Roald again and teleports the player to Paterdomus (160 -> 170)", (t) => {
  const { p, spawn } = actor(t, STAGE.ROALD_TELEPORT, [3224, 3473, 0]);
  const aeonisig = spawn(AEONISIG, [3225, 3473, 0]);
  assert.equal(talk(p, aeonisig), true);
  assert.equal(transcripts.at(-1).page, PAGE);
  assert.equal(lastVariant(), "misthalin-diplomacy-talking-to-king-roald-again");
  until(p, "Talk to the king about Morytania.");
  choose(p, "Talk to the king about Morytania.");
  until(p, "Does your offer of a teleport still stand?");
  choose(p, "Does your offer of a teleport still stand?");
  until(p, "Yes thanks. I'll accept the free teleport.");
  choose(p, "Yes thanks. I'll accept the free teleport.");
  until(p, "Prepare yourself for teleport!");
  cont(p);
  tick(5);
  assert.deepEqual(tile(p), [3421, 9888, 0]);
  assert.equal(stageOf(p), STAGE.BACK_AT_PATERDOMUS);
});

test("Trader Sven keeps his own conversation (no quest unit claims him)", (t) => {
  const { p } = actor(t, STAGE.ROUTE_KNOWN, [3597, 3203, 1]);
  const sven = core.NPC.create(TRADER_SVEN, new core.Location(3598, 3203, 1));
  const before = transcripts.length;
  assert.equal(talk(p, sven), true);
  assert.ok(!transcripts.slice(before).some((call) => call.page === PAGE), "not a Darkness transcript");
  assert.ok(current(p) || menu(p), "a conversation is open");
});

test("Vanstrom's ambush at 220: 230 past 'Prepare to die!', five attacks, then Sarius (240) and 250", (t) => {
  const { p, seen } = actor(t, STAGE.WEST_SKETCHED, SOUTH, { vars: { [VARBIT.SAFALAAN_VISIBLE]: 2 } });
  give(p, CHARCOAL);
  give(p, SKETCH_1);
  give(p, SKETCH_2);
  give(p, PAPYRUS);
  assert.equal(sketch(p), true);
  tick(16);
  until(p, "Ha! So we meet again");
  assert.equal(stageOf(p), STAGE.WEST_SKETCHED);
  cont(p);
  assert.equal(stageOf(p), STAGE.VANSTROM_ATTACKS);
  tick(2 + 8 * 4);
  assert.equal(seen.hits.length, 5);
  tick(13);
  until(p, "I take no orders from food sacks");
  cont(p);
  assert.equal(stageOf(p), STAGE.SARIUS_SAVED);
  tick(6);
  until(p, "And now be away");
  assert.equal(stageOf(p), STAGE.SARIUS_TALKED);
});

test("the hand-ins remove every copy: all sketches at Safalaan, every sealed message at Veliaf", (t) => {
  const a = actor(t, STAGE.FIREPLACE_OPENED, HIDEOUT_SAFALAAN);
  for (const id of [SKETCH_1, SKETCH_2, SKETCH_3]) give(a.p, id, 2);
  talk(a.p, a.spawn(SAFALAAN_HIDEOUT, [3627, 9646, 0]));
  until(a.p, "You give the sketches to Safalaan.");
  for (const id of [SKETCH_1, SKETCH_2, SKETCH_3]) assert.equal(amount(a.p, id), 0, `sketch ${id} fully handed in`);

  const b = actor(t, STAGE.SEALED_MESSAGE, AT_VELIAF);
  give(b.p, SEALED, 2);
  talk(b.p, b.spawn(VELIAF, [3494, 9628, 0]));
  until(b.p, "You've done well. I'd say you've earnt a break.");
  cont(b.p);
  assert.equal(stageOf(b.p), STAGE.COMPLETE);
  assert.equal(amount(b.p, SEALED), 0, "the sealed message is fully handed in");
  assert.equal(amount(b.p, TOME), 1);
});

test("a lost sealed message is given again by Safalaan and can be read", (t) => {
  const { p, spawn } = actor(t, STAGE.SEALED_MESSAGE, HIDEOUT_SAFALAAN);
  talk(p, spawn(SAFALAAN_HIDEOUT, [3627, 9646, 0]));
  assert.equal(lastVariant(), "in-search-of-statuesque-evil-talking-to-safalaan-hallow-after-losing-the-sealed-message");
  until(p, "Safalaan gives you a sealed message.");
  assert.equal(amount(p, SEALED), 1);
  finish(p);
  p.getDialogueManager().reset?.();
  assert.equal(itemOption(p, SEALED, "Read"), true);
  assert.ok(text(p).length > 0, "the sealed message's box");
});

test("the quest's item actions: sketches Look-at their interfaces, Haemalchemy Read; other items stay with their owners", (t) => {
  const { p, seen } = actor(t, STAGE.LAB_OPENED, [3627, 3250, 0]);
  give(p, I.HAMMER);
  for (const id of [SKETCH_1, SKETCH_2, SKETCH_3, HAEMALCHEMY]) give(p, id);
  const hammer = slotOf(p, I.HAMMER);
  assert.equal(PM.emitItemAction({ player: p, item: p.getInventory().getItems()[hammer], itemId: I.HAMMER, slot: hammer, interfaceId: 149 << 16,
    clickType: 1, option: "Look-at", handled: false }), false, "the hammer is not this quest's");
  for (const id of [SKETCH_1, SKETCH_2, SKETCH_3]) assert.equal(itemOption(p, id, "Look-at"), true);
  assert.deepEqual(seen.interfaces.filter((id) => [455, 456, 457].includes(id)), [455, 457, 456], "north, west, south");
  assert.equal(itemOption(p, HAEMALCHEMY, "Read"), true);
  assert.equal(text(p), "This book seems far too complex for you. Maybe Safalaan will know what to do with it.");
});

test("the sickle-symbol rooftop route moves only after Ral gives it (65)", (t) => {
  const { p } = actor(t, STAGE.ROUTE_KNOWN, [3598, 3203, 1]);
  assert.equal(click(p, 18070, "Jump-to", [3598, 3201, 1], { type: 22 }), true);
  tick(2);
  assert.deepEqual(tile(p), [3598, 3201, 1]);
  p.moveTo(new core.Location(3595, 3203, 0));
  tick();
  assert.equal(click(p, 17974, "Climb-up", [3595, 3204, 0]), true);
  tick(3);
  assert.deepEqual(tile(p), [3595, 3205, 1]);

  const blocked = actor(t, STAGE.RAL_INTRODUCED, [3598, 3203, 1]);
  assert.equal(click(blocked.p, 18070, "Jump-to", [3598, 3201, 1], { type: 22 }), true);
  assert.ok(text(blocked.p).startsWith("You're pretty sure you'll get lost"));
  tick(2);
  assert.deepEqual(tile(blocked.p), [3598, 3203, 1], "the route is closed before Ral's directions");
});
