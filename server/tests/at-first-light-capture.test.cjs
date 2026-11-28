// Run after `yarn build`: node --test tests/at-first-light-capture.test.cjs
//
// At First Light against a whole run of the quest on live: the user's RSProx capture AtFirstLight.bin
// (revision 243, afl 0 -> 12; docs/quests/at-first-light/README.md). Real Player, PlayerSession and
// ClientConnection, the real plugins, cache and map: talks, clicks and item uses are packets, the locs
// are clicked with the multiloc base ids and tiles the client sends, and each tick runs as World.process
// does. Ticks in the test names are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");

const KEY = "at_first_light";
const VB = { AFL: 9835, REPORT: 9836, BEDCHECK: 9837, BEDREPAIR: 9838, DISTRACT: 9839, HOUSETRAPPED: 9840, MASTERMET: 9841,
  SAMPLE: 9842, MOUSE: 9843, WOLF: 9995 };
const NPC = { APATURA: 13120, VERITY: 13127, WOLF: 13126, KIKO: 12934, ATZA: 12933, FOX_MULTI: 13400, FOX: 12932,
  FOX_GUILD_MULTI: 13422, FOX_GUILD: 13426 };
// The client's ids and tiles (the multiloc bases): the cat bed, the two bushes and Atza's pile.
const LOC = { BED: [50878, [1552, 9460, 0]], LEAFY: [50876, [1618, 2979, 0]], ROUGH: [50877, [1673, 2992, 0]],
  PILE: [52976, [1697, 3063, 0]] };
// Where the recording stood for each talk or click (the tile it walked to).
const TILE = { APATURA: [1555, 3034, 0], BURROW: [1552, 9459, 0], VERITY: [1559, 9463, 0], WOLF: [1555, 9462, 0], KIKO: [1552, 9459, 0],
  FOX: [1623, 2981, 0], ATZA: [1698, 3063, 0] };
const place = (f, tile) => f.player.setLocation(new h.core.Location(...tile));

let I;
let codec;
before(async () => {
  h.key = KEY;
  await h.setup([[1554, 3033], [1552, 9460], [1623, 2982], [1673, 2992], [1697, 3063], [1549, 3045]]);
  I = h.core.ItemIdentifiers;
  new (require("../dist/game/definition/loader/impl/NpcDefinitionLoader").NpcDefinitionLoader)().load();
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => h.teardown());

const quest = () => h.quest(KEY);
const stage = (f) => quest().getStage(f.player);
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const count = (f, id) => f.player.getInventory().getAmount(id);
const slotOf = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId() === id);
const clear = (f) => { f.calls.length = 0; f.messages.length = 0; f.animations.length = 0; };
const sounds = (f) => f.calls.filter((c) => c.name === "sendSoundEffect").map((c) => ({ tick: c.tick, id: c.args[0], delay: c.args[2] }));
const varbitSets = (f, id) => f.calls.filter((c) => c.name === "sendVarbit" && c.args[0] === id).map((c) => c.args[1]);

function actor(t, { tile = TILE.APATURA, stage: value = 0, items = [], attributes = {} } = {}) {
  const f = h.actor(t, { at: tile, stage: value, done: ["children_of_the_sun", "eagles_peak"], attributes });
  const skills = f.player.getSkillManager();
  for (const [skill, level] of [[h.core.Skill.HUNTER, 46], [h.core.Skill.HERBLORE, 30], [h.core.Skill.CONSTRUCTION, 27]]) {
    skills.setMaxLevels(skill, level);
    skills.setCurrentLevel(skill, level, false);
  }
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount ?? 1), false);
  const sender = f.player.getPacketSender();
  for (const name of ["sendInterfaceAnimation", "sendPlayerHeadOnInterface", "sendClientScript"]) {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { f.calls.push({ tick: f.tick, name, args }); return original(...args); };
  }
  clear(f);
  return f;
}

/** The world NPC with this id nearest the tile: live spawns them with the world (npc-spawns.json). */
function worldNpc(id, [x, y, z]) {
  let best = null;
  for (const npc of h.core.World.getNpcs()) {
    if (!npc || npc.getId() !== id || !npc.isRegistered?.()) continue;
    const l = npc.getLocation();
    if (l.getZ() !== z) continue;
    const d = Math.max(Math.abs(l.getX() - x), Math.abs(l.getY() - y));
    if (d <= 8 && (!best || d < best.d)) best = { npc, d };
  }
  return best?.npc ?? null;
}

function npcAt(f, id, tile) {
  return worldNpc(id, tile) ?? h.spawn(f, id, tile);
}

/** The npc-spawns.json row for this id at this tile, spawned as the world spawns it (the harness spawns none). */
const SPAWNS = require("../data/definitions/npc-spawns.json");
const spawned = new Map();
function worldSpawn(id, [x, y, z]) {
  const row = SPAWNS.find((r) => r.id === id && r.x === x && r.y === y && (r.level ?? 0) === z);
  assert.ok(row, `npc-spawns.json has ${id} at (${x}, ${y}, ${z})`);
  if (!spawned.has(id)) {
    const npc = h.core.NPC.create(id, new h.core.Location(x, y, z));
    h.core.World.getNpcs().add(npc);
    spawned.set(id, npc);
  }
  return spawned.get(id);
}

/** Plays out a conversation, answering menus with `picks`; lines as "who: text", menus as MENU[...]. */
async function play(f, start, picks = []) {
  const from = f.said.length;
  const queue = [...picks];
  await start?.();
  for (let idle = 0, i = 0; i < 400 && idle < 8; i++) {
    const line = h.shown(f);
    if (!line || line.who === "ActionDialogue") { idle++; h.tick(f); continue; }
    idle = 0;
    if (line.who === "menu") {
      if (!queue.length) break;
      await h.choose(f, queue.shift());
      continue;
    }
    await h.continueLine(f);
  }
  return f.said.slice(from).map((s) => (s.who === "menu" ? `MENU[${s.title ?? ""}]: ${s.text}` : `${s.who}: ${s.text}`));
}

/** Each NPC line's head and every line's chathead animation, in the order shown. */
const heads = (f) => f.calls.filter((c) => c.name === "sendNpcHeadOnInterface").map((c) => c.args[0]);
const expressions = (f) => f.calls.filter((c) => c.name === "sendInterfaceAnimation").map((c) => c.args[1]);

async function click(f, [id, [x, y]], clickType = 1) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType }]);
  f.connection.processTurnPackets();
  h.tick(f);
}

async function useOnNpc(f, npc, itemId) {
  await h.dispatch(f, { type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot: slotOf(f, itemId), widgetId: 149 << 16 });
  for (let i = 0; i < 10 && !h.shown(f); i++) h.tick(f);
}

async function useItems(f, a, b) {
  await f.connection.dispatch([{ type: "inventory_use_on", slot: slotOf(f, a), itemId: a, target: { kind: "inventory", slot: slotOf(f, b), id: b } }]);
  f.connection.processTurnPackets();
  h.tick(f);
}

async function useOnLoc(f, [objectId, [x, y]], itemId) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await f.connection.dispatch([{ type: "item_on_object", itemId, slot: slotOf(f, itemId), widgetId: 149 << 16, objectId, x, y }]);
  for (let i = 0; i < 12 && !h.shown(f); i++) h.tick(f);
}

function journal(f) {
  const [, layer] = h.QuestRuntime.journalWidgets(quest(), f.player);
  return layer.staticChildren.map((child) => child.text).filter((text) => text !== undefined);
}

function reload(t, f, tile) {
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.player), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  h.PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  const g = actor(t, { tile: tile ?? [f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()] });
  codec.hydratePlayerSave(raw).applyToPlayer(g.player);
  h.PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername(), isNewAccount: false });
  h.PM.emitCustomEvent("player:bootstrap-complete", { player: g.player });
  clear(g);
  return g;
}

// --- Apatura before the quest -------------------------------------------------------------------

test("t113-181: the first meeting sets afl_mastermet on 'Well, I'm Apatura', 'What do you do here?' returns to the menu, later talks open with 'Nilsal, hunter.'", async (t) => {
  const f = actor(t);
  const apatura = npcAt(f, NPC.APATURA, [1554, 3033, 0]);
  const first = await play(f, () => h.talk(f, apatura), ["What do you do here?", "I'd better be off."]);
  assert.deepEqual(first.slice(0, 5), [
    "Guildmaster Apatura: Oh, you're a new face around here, aren't you?",
    "PLAYER: I am indeed. Just exploring the savannah.",
    "Guildmaster Apatura: Well, I'm Apatura. Let me welcome you to our small corner of Varlamore.",
    "MENU[Select an option]: What do you do here?|Can I help you with anything?|I'd better be off.",
    "PLAYER: What do you do here?",
  ]);
  assert.equal(first.at(-3), "Guildmaster Apatura: Absolutely! There's always more work to be done. Head down into the Burrow and talk to the other hunters to get an idea of what we need help with.");
  assert.equal(first.at(-2), "MENU[Select an option]: Can I help you with anything?|I'd better be off.");
  assert.equal(first.at(-1), "PLAYER: I'd better be off.");
  assert.equal(varbit(f, VB.MASTERMET), 1);
  assert.deepEqual([...new Set(heads(f))], [NPC.APATURA]);
  // chatquiz1, chathap1, chathap2 (ticks 120-123).
  assert.deepEqual(expressions(f).slice(0, 3), [554, 567, 568]);

  const again = await play(f, () => h.talk(f, apatura), ["Can I help you with anything?", "No."]);
  assert.deepEqual(again.slice(0, 3), [
    "Guildmaster Apatura: Nilsal, hunter.",
    "PLAYER: Nilsal, Apatura.",
    "MENU[Select an option]: What do you do here?|Can I help you with anything?|I'd better be off.",
  ]);
  assert.equal(again.at(-1), "Guildmaster Apatura: Tetamo... Well, hopefully it's not too important.");
  assert.equal(stage(f), 0);

  const start = await play(f, () => h.talk(f, apatura), ["Can I help you with anything?", "Yes."]);
  assert.equal(stage(f), 1);
  assert.ok(start.includes("PLAYER: Great! Point me in her direction and I'll get cracking!"));
  assert.ok(f.messages.some((m) => /You've started a new quest: .*At First Light/.test(m.text)));
  assert.deepEqual(journal(f).slice(0, 3), [
    "<col=000080>I spoke to <col=800000>Guildmaster Apatura<col=000080> in the <col=800000>Hunter Guild<col=000080>. She told",
    "<col=000080>me that <col=800000>Guild Scribe Verity<col=000080> needed help with something and",
    "<col=000080>asked me to speak to her in <col=800000>The Burrow<col=000080> below the <col=800000>Guild<col=000080>.",
  ]);
});

test("afl_mastermet persists: after a save and reload Apatura opens with 'Nilsal, hunter.'", async (t) => {
  const f = actor(t);
  await play(f, () => h.talk(f, npcAt(f, NPC.APATURA, [1554, 3033, 0])), ["I'd better be off."]);
  assert.equal(varbit(f, VB.MASTERMET), 1);
  const g = reload(t, f);
  assert.equal(varbit(g, VB.MASTERMET), 1);
  const said = await play(g, () => h.talk(g, npcAt(g, NPC.APATURA, [1554, 3033, 0])), ["I'd better be off."]);
  assert.equal(said[0], "Guildmaster Apatura: Nilsal, hunter.");
});

// --- The Burrow ---------------------------------------------------------------------------------

test("t241-426: Verity, Wolf's mouse, Kiko's Pet (human_pickupfloor), the bed through 50878 before and after the mouse, Wolf's pyre fox hint", async (t) => {
  const f = actor(t, { tile: TILE.BURROW, stage: 1, attributes: { "at-first-light:stage-version": 1 } });
  const verity = npcAt(f, NPC.VERITY, [1559, 9464, 0]);
  const wolf = npcAt(f, NPC.WOLF, [1554, 9462, 0]);
  const kiko = npcAt(f, NPC.KIKO, [1552, 9460, 0]);

  place(f, TILE.VERITY);
  const v = await play(f, () => h.talk(f, verity), ["Yes please."]);
  assert.ok(v.includes("PLAYER: Well, actually, I heard there might be something I could help you with?"), "the comma, tick 259");
  assert.equal(stage(f), 2);

  clear(f);
  place(f, TILE.WOLF);
  const w = await play(f, () => h.talk(f, wolf));
  assert.ok(w.includes("PLAYER: Well, then I guess the first step is to work out what he went to get. Could I take a look at Kiko's bed?"));
  assert.ok(w.includes("Guild Hunter Wolf (Master): Absolutely!"));
  assert.equal(stage(f), 3);
  assert.equal(count(f, I.TOY_MOUSE), 1);
  assert.equal(varbit(f, VB.MOUSE), 1);
  // Wolf's "..." gets chatsad1 here (tick 292), not the shared table's 614.
  const dots = f.calls.findIndex((c) => c.name === "sendPlayerHeadOnInterface" && f.calls.slice(f.calls.indexOf(c)).some((d) => d.name === "sendString" && d.args[0] === "..."));
  assert.ok(f.calls.slice(dots).some((c) => c.name === "sendInterfaceAnimation" && c.args[1] === 610));

  clear(f);
  place(f, TILE.KIKO);
  const pet = await play(f, () => h.talk(f, kiko));
  assert.deepEqual(pet, ["Guild Hunter Kiko: Can you scratch my belly next? It's perfectly safe."]);
  assert.deepEqual(f.animations.map((a) => a.id), [827]);

  // Kiko not distracted: he won't let the player at the bed (tick 334).
  const sleepy = await play(f, () => click(f, LOC.BED));
  assert.deepEqual(sleepy, ["Guild Hunter Kiko: Do you mind? I'm trying to sleep here."]);
  assert.equal(varbit(f, VB.BEDCHECK), 0);

  f.player.getInventory().delete(I.TOY_MOUSE, 1);
  f.player.getInventory().add(new h.core.Item(I.TOY_MOUSE_WOUND_, 1), false);
  const mouse = await play(f, () => useOnNpc(f, kiko, I.TOY_MOUSE_WOUND_));
  assert.deepEqual(mouse, ["PLAYER: Here you go, little guy.", "Guild Hunter Kiko: A mouse? Fantastic!"]);
  assert.equal(varbit(f, VB.DISTRACT), 1);
  assert.equal(count(f, I.TOY_MOUSE_WOUND_), 0);

  const bed = await play(f, () => click(f, LOC.BED));
  assert.equal(bed.length, 1);
  assert.match(bed[0], /^StatementDialogue: You check the cat's bed\./);
  assert.equal(varbit(f, VB.BEDCHECK), 1);
  assert.equal(stage(f), 3, "the bed check alone leaves the stage");

  place(f, TILE.WOLF);
  const hint = await play(f, () => h.talk(f, wolf));
  assert.ok(hint.includes("PLAYER: Why not?"));
  assert.equal(stage(f), 4);
  assert.deepEqual(journal(f).slice(8, 13), [
    "<col=000080>I distracted <col=800000>Kiko<col=000080> and then inspected his <col=800000>Bed<col=000080> to find some of",
    "<col=000080>the fur missing. <col=800000>Fox<col=000080> presumably took a sample to help him",
    "<col=000080>find the right replacement. <col=800000>Wolf<col=000080> suggested I look for him near",
    "<col=000080>the <col=800000>Pyre Foxes<col=000080> on the way to the <col=800000>Locus Oasis<col=000080>, as he'll have",
    "<col=000080>likely stopped off there.",
  ]);
});

// --- Fox ----------------------------------------------------------------------------------------

test("Fox is live's world multinpc: 13400 by the oasis shows as 12932 at stages 4-10 only, 13422 by the guild as 13426 from 11", (t) => {
  const savannah = worldSpawn(NPC.FOX_MULTI, [1623, 2982, 0]);
  const guild = worldSpawn(NPC.FOX_GUILD_MULTI, [1548, 3048, 0]);
  assert.equal(SPAWNS.find((r) => r.id === NPC.FOX_MULTI).wanderRadius, 0, "the injured Fox stays put");
  assert.ok(!SPAWNS.some((r) => [NPC.FOX, NPC.FOX_GUILD].includes(r.id)), "no always-visible Fox form is spawned");
  for (const [value, there, home] of [[0, -1, -1], [3, -1, -1], [4, NPC.FOX, -1], [10, NPC.FOX, -1], [11, -1, NPC.FOX_GUILD], [12, -1, NPC.FOX_GUILD]]) {
    const f = actor(t, { tile: TILE.FOX, stage: value });
    assert.equal(savannah.getCurrentDefinition(f.player)?.getId?.() ?? -1, there, `savannah Fox at stage ${value}`);
    assert.equal(guild.getCurrentDefinition(f.player)?.getId?.() ?? -1, home, `guild Fox at stage ${value}`);
  }
});

test("t546-717: Fox found (5), 'I think I've got them both.' by the leaves held, the bushes through 50876/50877, the poultice", async (t) => {
  const f = actor(t, { tile: TILE.FOX, stage: 4, items: [[I.JERBOA_TAIL, 2]] });
  const fox = worldSpawn(NPC.FOX_MULTI, [1623, 2982, 0]);
  const found = await play(f, () => h.talk(f, fox));
  assert.equal(found[0], "PLAYER: Are you Fox? Everyone's worried about you.");
  assert.equal(found.at(-1), "Guild Hunter Fox: Don't forget... your traps for the jerboa... they're boxy...");
  assert.equal(stage(f), 5);

  const none = await play(f, () => h.talk(f, fox), ["I think I've got them both."]);
  assert.equal(none.at(-1), "Guild Hunter Fox: It doesn't look like you do... Who's the one with the head wound again?");

  // The pick: the animation on arrival, the sound a tick later, the leaf in an item box two ticks on (ticks 603-606).
  f.player.setLocation(new h.core.Location(1618, 2980, 0));
  clear(f);
  await click(f, LOC.LEAFY);
  const clicked = f.tick;
  h.ticks(f, 3);
  assert.equal(f.animations[0]?.id, 10094);
  assert.deepEqual(sounds(f).map((s) => [s.id, s.delay]), [[2581, 15]]);
  assert.ok(sounds(f)[0].tick > f.animations[0].tick, "the pick sound follows the animation");
  assert.equal(count(f, I.SMOOTH_LEAF), 1);
  assert.equal(h.shown(f)?.who, "ItemStatementDialogue");
  assert.ok(clicked);
  await play(f);
  f.player.setLocation(new h.core.Location(1673, 2993, 0));
  await click(f, LOC.ROUGH);
  h.ticks(f, 3);
  await play(f);
  assert.equal(count(f, I.STICKY_LEAF), 1);

  f.player.setLocation(new h.core.Location(...TILE.FOX));
  const both = await play(f, () => h.talk(f, fox), ["I think I've got them both."]);
  assert.deepEqual(both.slice(-3), [
    "Guild Hunter Fox: Yay, Fox will be pleased. I'll let him know right now!",
    "PLAYER: ...",
    "Guild Hunter Fox: He's very mean... He says you'll have to... tie them up with the cute little jerb tail.",
  ]);

  clear(f);
  await useItems(f, I.JERBOA_TAIL, I.STICKY_LEAF);
  assert.equal(count(f, I.MAKESHIFT_POULTICE), 1);
  assert.deepEqual(f.animations.map((a) => a.id), [10097]);
  assert.deepEqual(sounds(f).map((s) => [s.id, s.delay]), [[2608, 25]]);
  await play(f);

  const poultice = await play(f, () => h.talk(f, fox));
  assert.ok(poultice.includes("Guild Hunter Fox: Well, it's your lucky day! Take this sample to a woman called Atza in Outer Fortis. She'll have exactly what we need."));
  assert.equal(stage(f), 7);
  assert.equal(count(f, I.FUR_SAMPLE), 1);
});

test("a full inventory: the leaf goes to the ground (Wiki), and the box still shows", async (t) => {
  const f = actor(t, { tile: [1618, 2980, 0], stage: 5 });
  const inventory = f.player.getInventory();
  while (inventory.getFreeSlots() > 0) inventory.add(new h.core.Item(I.BRONZE_AXE, 1), false);
  await click(f, LOC.LEAFY);
  h.ticks(f, 3);
  assert.equal(count(f, I.SMOOTH_LEAF), 0);
  const ground = h.core.ItemOnGroundManager.ownedBy(f.player.getUsername());
  assert.ok(ground.some((item) => item.getItem().getId() === I.SMOOTH_LEAF), "the smooth leaf lies under the player");
  assert.match(h.shown(f)?.text ?? "", /You pull a smooth leaf off the bush\./);
});

// --- Wolf after the poultice ------------------------------------------------------------------

test("t859-861: the first Wolf talk after the poultice is the single captured line and sets afl_wolf_dialogue; then 'How's the Fox situation?'", async (t) => {
  const f = actor(t, { tile: TILE.WOLF, stage: 7, attributes: { "at-first-light:stage-version": 1 } });
  const wolf = npcAt(f, NPC.WOLF, [1554, 9462, 0]);
  const first = await play(f, () => h.talk(f, wolf));
  assert.deepEqual(first, [
    "PLAYER: I've found Fox. He's been injured by something out in the savannah, but he's doing okay. He's got me doing a few things for him whilst he recuperates.",
    "Guild Hunter Wolf (Master): Ha! Now that's the Fox I know. I'll have to give him some odd jobs once he's back to make up for ones you're covering!",
  ]);
  assert.equal(varbit(f, VB.WOLF), 1);
  const g = reload(t, f);
  assert.equal(varbit(g, VB.WOLF), 1);
  const again = await play(g, () => h.talk(g, npcAt(g, NPC.WOLF, [1554, 9462, 0])));
  assert.equal(again[0], "Guild Hunter Wolf (Master): How's the Fox situation?");
});

test("stage 5, Wolf before the poultice: the Wiki's 'I've found Fox...' sets afl_wolf_dialogue too", async (t) => {
  const f = actor(t, { tile: TILE.WOLF, stage: 5, attributes: { "at-first-light:stage-version": 1 } });
  const said = await play(f, () => h.talk(f, npcAt(f, NPC.WOLF, [1554, 9462, 0])));
  assert.equal(said[0], "PLAYER: I've found Fox. He's been injured by something out in the savannah.");
  assert.equal(varbit(f, VB.WOLF), 1);
});

// --- Atza ---------------------------------------------------------------------------------------

test("t968-1037: Atza takes the sample (8), her chores line cries, the pile through 52976 builds on the click and after each player line, then the trimmed fur (9)", async (t) => {
  const f = actor(t, { tile: TILE.ATZA, stage: 7, items: [[I.FUR_SAMPLE, 1], [I.HAMMER, 1]], attributes: { "at-first-light:stage-version": 1 } });
  const atza = npcAt(f, NPC.ATZA, [1698, 3062, 0]);
  const first = await play(f, () => h.talk(f, atza));
  assert.equal(stage(f), 8);
  assert.equal(varbit(f, VB.HOUSETRAPPED), 1);
  assert.equal(first.at(-1), "Atza: It's all in that pile on the floor there. You can work it out, I'm sure.");
  assert.ok(sounds(f).some((s) => s.id === 3424), "tol_homonculus_crying on 'Oh... Fox usually helps me with my chores' (tick 992)");

  f.player.setLocation(new h.core.Location(1697, 3062, 0));
  clear(f);
  const from = f.said.length;
  await click(f, LOC.PILE);
  const said = await play(f);
  const lines = f.said.slice(from);
  assert.deepEqual(said.slice(0, 6), [
    "Atza: So anyway, how did you come to be doing this for Fox?",
    "PLAYER: Well, he actually got attacked on his way over here.",
    "Atza: Shouldn't you be helping him heal up?",
    "PLAYER: Oh he'll be alright. He was on the mend when I left him.",
    "PLAYER: All done!",
    "Atza: Oh, that's looking much better.",
  ]);
  const builds = f.animations.filter((a) => a.id === 3676).map((a) => a.tick);
  const woods = sounds(f).filter((s) => s.id === 938);
  assert.equal(builds.length, 3, "three rounds of work: on the click and after each of the player's two lines");
  assert.deepEqual(woods.map((s) => s.tick), builds);
  assert.ok(woods.every((s) => s.delay === 10));
  // Atza answers two ticks after each build that follows a player line (ticks 1019 -> 1021, 1026 -> 1028).
  const shownAt = (text) => lines.find((l) => l.text === text)?.tick;
  assert.equal(shownAt("Shouldn't you be helping him heal up?") - builds[1], 2);
  assert.equal(shownAt("All done!") - builds[2], 2);
  assert.equal(varbit(f, VB.HOUSETRAPPED), 2);
  assert.equal(stage(f), 9);
  assert.equal(count(f, I.TRIMMED_FUR), 1);
});

// --- Back at the guild --------------------------------------------------------------------------

test("t1251: the jerboa tail on 50878 repairs the bed: afl_bedrepair and 11, then the box, human_crafting, stiching and 10 Crafting XP", async (t) => {
  const f = actor(t, { tile: TILE.BURROW, stage: 10, items: [[I.TRIMMED_FUR, 1], [I.JERBOA_TAIL, 1], [I.NEEDLE, 1]],
    attributes: { "at-first-light:stage-version": 1 } });
  const xp = f.player.getSkillManager().getExperience(h.core.Skill.CRAFTING);
  const said = await play(f, () => useOnLoc(f, LOC.BED, I.JERBOA_TAIL));
  assert.deepEqual(said, [
    "StatementDialogue: You carefully fix up Kiko's bed.",
    "Guild Hunter Kiko: Well, as much as I resent the trickery used, this bed is much comfier now.",
  ]);
  assert.equal(stage(f), 11);
  assert.equal(varbit(f, VB.BEDREPAIR), 1);
  assert.deepEqual(f.animations.map((a) => a.id), [10794]);
  assert.ok(sounds(f).some((s) => s.id === 2591));
  const order = f.calls.map((c) => (c.name === "sendVarbit" && c.args[0] === VB.BEDREPAIR ? "varbit" : c.name === "sendSoundEffect" && c.args[0] === 2591 ? "sound" : null)).filter(Boolean);
  assert.deepEqual(order, ["varbit", "sound"]);
  assert.equal(f.player.getSkillManager().getExperience(h.core.Skill.CRAFTING) - xp, 10);
  assert.equal(count(f, I.TRIMMED_FUR) + count(f, I.JERBOA_TAIL), 0);
});

test("journal as captured at stages 7, 8, 9 and 10 (ticks 764, 1004, 1063, 1133)", (t) => {
  const at = (value, attributes = {}) => journal(actor(t, { stage: value, attributes: { "at-first-light:stage-version": 1, ...attributes } }));
  assert.equal(at(7)[14], "<str>I created a Poultice for Fox and gave it to him.");
  assert.equal(at(7)[15], "<col=800000>Fox<col=000080> explained to me that he was attacked whilst on route to");
  assert.equal(at(8)[19], "<col=000080>I took the <col=800000>Fur Sample<col=000080> to <col=800000>Atza<col=000080> in <col=800000>Outer Fortis<col=000080>. She asked me to");
  assert.equal(at(9)[21], "<col=800000><col=800000>Fox<col=000080> near the <col=800000>Locus Oasis<col=000080> and let him know.");
  const report = at(10);
  assert.equal(report.length, 25);
  assert.equal(report[20], "<str>the Trimmed Fur needed to fix Kiko's Bed.");
  assert.equal(report[24], "<col=000080>deliver a <col=800000>Report<col=000080> from him to <col=800000>Guild Scribe Verity<col=000080>.");
  assert.equal(at(12).at(-1), "<col=ff0000>QUEST COMPLETE!");
});

test("post-quest: Apatura's rumour milestones answer from the rumours done (none: her menu at once, tick 1329)", async (t) => {
  const f = actor(t, { stage: 12, attributes: { "at-first-light:stage-version": 1, "hunter.rumours": { assignments: {}, active: null, completed: 0, outfit: 0 } } });
  const apatura = npcAt(f, NPC.APATURA, [1554, 3033, 0]);
  const said = await play(f, () => h.talk(f, apatura), []);
  assert.deepEqual(said, [
    "Guildmaster Apatura: Nilsal, hunter.",
    "PLAYER: Nilsal, Apatura.",
    "MENU[Select an option]: What do you do here?|I'd better be off.",
  ]);
  const veteran = actor(t, { stage: 12, attributes: { "at-first-light:stage-version": 1, "hunter.rumours": { assignments: {}, active: null, completed: 60, outfit: 0 } } });
  const asked = await play(veteran, () => h.talk(veteran, apatura), []);
  assert.match(asked[2], /^Guildmaster Apatura: I see you've been doing a lot of work for the guild of late\./);
});

test("Destroy on each quest item opens the confirmation with its Wiki note (no capture destroys them)", async (t) => {
  const notes = {
    [I.SMOOTH_LEAF]: "You can pick another from a bush in the Avium Savannah.",
    [I.STICKY_LEAF]: "You can pick another from a bush near the Locus Oasis.",
    [I.MAKESHIFT_POULTICE]: "You can craft another from a smooth leaf, a sticky leaf, and an embertailed jerboa tail.",
    [I.FUR_SAMPLE]: "You can obtain another from Guild Hunter Fox in the Avium Savannah.",
    [I.TRIMMED_FUR]: "You can obtain some more from Atza in Outer Fortis.",
    [I.FOXS_REPORT]: "You can obtain another from Guild Hunter Fox in the Avium Savannah.",
  };
  for (const [itemId, note] of Object.entries(notes).map(([id, text]) => [Number(id), text])) {
    const f = actor(t, { stage: 9, items: [[itemId, 1]] });
    await f.connection.dispatch([{ type: "inventory_action", slot: slotOf(f, itemId), itemId, widgetId: 149 << 16, option: "Destroy" }]);
    f.connection.processTurnPackets();
    h.tick(f);
    const shown = f.calls.filter((c) => c.name === "sendClientScript").flatMap((c) => c.args.flat(2)).map(String);
    assert.ok(shown.some((arg) => arg.includes(note)), `${itemId}: ${note}`);
    assert.equal(count(f, itemId), 1, "nothing is destroyed before the confirmation");
  }
});

test("Read on Fox's report: the Wiki's line about his report", async (t) => {
  const f = actor(t, { stage: 10, items: [[I.FOXS_REPORT, 1]] });
  const said = await play(f, async () => {
    await f.connection.dispatch([{ type: "inventory_action", slot: slotOf(f, I.FOXS_REPORT), itemId: I.FOXS_REPORT, widgetId: 149 << 16, option: "Read" }]);
    f.connection.processTurnPackets();
    h.tick(f);
  });
  const shown = said.length ? said : f.messages.map((m) => String(m.text));
  assert.ok(shown.some((line) => line.includes("It's Fox's report. It details the creature he was tracking, his attack, and my help.")), JSON.stringify(shown));
  assert.equal(count(f, I.FOXS_REPORT), 1);
});
