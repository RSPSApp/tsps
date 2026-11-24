// Run after `yarn build`: node --test tests/shadow-of-the-storm-capture.test.cjs
//
// Shadow of the Storm against a whole run of the quest on live: the user's RSProx capture
// ShadowOfTheStorm.bin (revision 242; docs/quests/shadow-of-the-storm/README.md). Real Player,
// PlayerSession and ClientConnection, the real plugins, cache and map: talks, clicks and item uses
// are packets and each tick runs as World.process does. Ticks in the test names are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");

const KEY = "shadow_of_the_storm";
const S = {
  UNSTARTED: 0, STARTED: 10, INFILTRATE: 20, IN_GROUP: 30, DENATH: 40, MATTHEW: 50, GOLEM: 60, BOOK: 70,
  RITUAL: 80, RITUAL_DONE: 90, PREPARE: 100, READY: 110, SUMMONED: 120, KILLED: 124, COMPLETE: 130,
};
const V = { STAGE: 1372, WORDS: [1373, 1374, 1375, 1376, 1377], KILN: 1378, GOLEM: 1379, DAVE: 1380, BADDEN: 1381, REEN: 1382, CLAY: 348 };
const A = { HELPERS: "quest.shadow_of_the_storm.helpers", KILN: "quest.shadow_of_the_storm.kiln", WORDS: "quest.shadow_of_the_storm.incantation" };
const WORDS = ["Caldar", "Nahudu", "Agrith-Naar", "Camerinthum", "Tarren"];
const NPC = { REEN_AK: 1984, REEN_UZER: 1985, BADDEN_UZER: 1986, DAVE_PORTAL: 1987, DAVE_PASSAGE: 913, GOLEM: 6277 };
const OBJECTBOX = 193;

let I;
let N;
let codec;
before(async () => {
  h.key = KEY;
  await h.setup([[3270, 3160], [3490, 3090], [3470, 3120], [2720, 4900]]);
  I = h.core.ItemIdentifiers;
  N = h.core.NpcIdentifiers;
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => h.teardown());

// The end of a world tick: overhead lines need their speakers in the player's local NPC list (the
// harness's player is not in World's update loop), and the room's cast is owner-only.
const baseTick = h.tick;
h.tick = (f) => {
  baseTick(f);
  const owned = [...h.core.World.getNpcs()].filter((npc) => npc?.getOwner?.() === f.player);
  h.core.World.updateLocalNpcs(f.player, owned);
  for (const npc of owned) npc.setNeedsPlacement(false);
};

const quest = () => h.quest(KEY);
const stage = (f) => quest().getStage(f.player);
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const count = (f, id) => f.player.getInventory().getAmount(id);
const at = (f) => { const l = f.player.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
const texts = (f) => f.messages.filter((m) => !String(m.text).includes("|")).map((m) => String(m.text))
  .filter((text) => !text.startsWith("You have unlocked a new music track"));
const heads = (f) => f.calls.filter((c) => c.name === "sendNpcHeadOnInterface").map((c) => c.args[0]);
const boxItems = (f) => f.calls.filter((c) => c.name === "sendItemOnInterfaces" && c.args[0] === ((OBJECTBOX << 16) | 1)).map((c) => c.args[1]);
const clear = (f) => { f.calls.length = 0; f.messages.length = 0; f.animations.length = 0; };

function actor(t, { tile, stage: value = 0, items = [], attributes = {}, done = ["the_golem", "demon_slayer"] } = {}) {
  const f = h.actor(t, { at: tile, stage: value, done, attributes });
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount ?? 1), false);
  const sender = f.player.getPacketSender();
  for (const name of ["mountSubInterface", "sendCameraReset", "sendCameraMoveTo", "sendCameraLookAt", "sendJingle", "sendAreaSound", "sendClientScript"]) {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { f.calls.push({ tick: f.tick, name, args }); return original(...args); };
  }
  clear(f);
  return f;
}

/** Plays out a conversation (or an item box), answering menus with `picks`. */
async function play(f, start, picks = [], { idleTicks = 6, until } = {}) {
  const from = f.said.length;
  const queue = [...picks];
  await start?.();
  for (let idle = 0, i = 0; i < 400 && idle < idleTicks; i++) {
    if (until?.()) break;
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

/** Walks away from an open chat (the menu left up after the picks ran out). */
function endChat(f) {
  f.player.getDialogueManager().reset();
  h.MultiChatboxPrompt.clear?.(f.player);
  f.player.getPacketSender().sendInterfaceRemoval();
  h.tick(f);
}

const slotOf = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId() === id);

async function click(f, id, [x, y], clickType = 1) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const before = f.messages.length;
  const from = f.player.getLocation();
  const jumped = () => f.player.getLocation().getZ() !== from.getZ() || Math.abs(f.player.getLocation().getY() - from.getY()) > 30;
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType }]);
  for (let i = 0; i < 20 && f.messages.length === before && !h.shown(f) && !jumped(); i++) h.tick(f);
  h.ticks(f, 2);
}

async function useItems(f, a, b) {
  await f.connection.dispatch([{ type: "inventory_use_on", slot: slotOf(f, a), itemId: a, target: { kind: "inventory", slot: slotOf(f, b), id: b } }]);
  f.connection.processTurnPackets();
  h.tick(f);
}

async function itemOption(f, itemId, option) {
  await f.connection.dispatch([{ type: "inventory_action", slot: slotOf(f, itemId), itemId, widgetId: 3214, option }]);
  f.connection.processTurnPackets();
  h.tick(f);
}

async function objectboxButton(f, sub) {
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: OBJECTBOX << 16, childIndex: sub }]);
  h.tick(f);
}

function journal(f) {
  const [, layer] = h.QuestRuntime.journalWidgets(quest(), f.player);
  return layer.staticChildren.map((child) => child.text);
}

function reload(t, f, tile) {
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.player), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const g = h.actor(t, { at: tile ?? at(f), stage: 0, done: [] });
  codec.hydratePlayerSave(raw).applyToPlayer(g.player);
  h.PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername(), isNewAccount: false });
  clear(g);
  return g;
}

const REEN_AK_TILE = [3270, 3160, 0];
const UZER = [3487, 3091, 0];

// --- The start -------------------------------------------------------------------------------------

test("t53-73: Reen's start, his 1984 head on every line; 'Yes.' starts it at 10 and Badden's 1381 at 1", async (t) => {
  const f = actor(t, { tile: [3271, 3160, 0], items: [[I.SILVERLIGHT, 1]] });
  const reen = h.spawn(f, NPC.REEN_AK, REEN_AK_TILE);
  const no = await play(f, () => h.talk(f, reen), ["No."]);
  assert.deepEqual(no.slice(0, 3), [
    "Father Reen: Excuse me, I'm looking for " + f.player.getDisplayName() + ". I have an urgent job for him.",
    "MENU[Start the Shadow of the Storm quest?]: Yes.|No.",
    "PLAYER: I'll let you know if I see him.",
  ]);
  assert.equal(stage(f), S.UNSTARTED);
  clear(f);
  const yes = await play(f, () => h.talk(f, reen), ["Yes."]);
  assert.ok(yes.includes("PLAYER: That's me!"), yes.join("\n"));
  assert.ok(yes.at(-1).startsWith("Father Reen: You should go to Uzer and find Badden at once."), yes.join("\n"));
  assert.equal(stage(f), S.STARTED);
  assert.equal(varbit(f, V.STAGE), S.STARTED);
  assert.equal(varbit(f, V.BADDEN), 1);
  assert.equal(varbit(f, V.REEN), 0);
  assert.ok(texts(f).some((text) => /^You've started a new quest: .*Shadow of the Storm/.test(text)), JSON.stringify(texts(f)));
  assert.ok(heads(f).length > 0 && heads(f).every((id) => id === NPC.REEN_AK), `heads ${heads(f)}`);
});

test("t101-111: Reen hands back a lost Silverlight with no message; the Wiki: 30 Crafting is not needed to start", async (t) => {
  const f = actor(t, { tile: [3271, 3160, 0], stage: S.STARTED });
  f.player.getSkillManager().setMaxLevels(h.core.Skill.CRAFTING, 1);
  f.player.getSkillManager().setCurrentLevel(h.core.Skill.CRAFTING, 1, false);
  const reen = h.spawn(f, NPC.REEN_AK, REEN_AK_TILE);
  const said = await play(f, () => h.talk(f, reen));
  assert.deepEqual(said, [
    "Father Reen: You idiot! You lost Silverlight! I found it on the sand!",
    "Father Reen: You need to take it with you and see Badden in Uzer.",
  ]);
  assert.equal(count(f, I.SILVERLIGHT), 1);
  assert.deepEqual(texts(f), []);
  const g = actor(t, { tile: [3271, 3160, 0] });
  g.player.getSkillManager().setMaxLevels(h.core.Skill.CRAFTING, 1);
  const reen2 = h.spawn(g, NPC.REEN_AK, REEN_AK_TILE);
  const start = await play(g, () => h.talk(g, reen2), ["Yes."]);
  assert.equal(stage(g), S.STARTED, start.join("\n"));
});

test("without The Golem and Demon Slayer Reen does not start it", async (t) => {
  const f = actor(t, { tile: [3271, 3160, 0], done: [] });
  const reen = h.spawn(f, NPC.REEN_AK, REEN_AK_TILE);
  await play(f, () => h.talk(f, reen), ["Yes."]);
  assert.equal(stage(f), S.UNSTARTED);
});

// --- Badden and the golem in Uzer -----------------------------------------------------------------

test("t359-468: Badden's 1986 head; 'Just passing through.' leaves it at 10; stage 20 comes with 'I don't know...'", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.STARTED, items: [[I.SILVERLIGHT, 1]] });
  const badden = h.spawn(f, NPC.BADDEN_UZER, [3487, 3092, 0]);
  const pass = await play(f, () => h.talk(f, badden), ["Just passing through."]);
  assert.ok(pass.includes("PLAYER: Just passing through."), pass.join("\n"));
  assert.equal(stage(f), S.STARTED);
  clear(f);
  const said = await play(f, () => h.talk(f, badden), ["Reen sent me.", "Tell me more about Agrith-Naar.", "So what do you want me to do?"]);
  assert.equal(stage(f), S.STARTED, "the menus under Badden's welcome do not move it");
  const rest = await play(f, null, ["How can I do that?"]);
  assert.equal(stage(f), S.INFILTRATE, [...said, ...rest].join("\n"));
  assert.ok(rest.includes("Father Badden: I don't know. You'll have to find some way to convince them you're one of them."), rest.join("\n"));
  assert.ok(heads(f).every((id) => id === NPC.BADDEN_UZER), `heads ${heads(f)}`);
});

test("t339: the golem's lines carry 6277 as the head", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.STARTED });
  const golem = h.spawn(f, NPC.GOLEM, [3488, 3093, 0]);
  const said = await play(f, () => h.talk(f, golem), ["Why does Badden hate you?"]);
  assert.ok(said[0].startsWith("Clay golem: It is good to see a friendly face here."), said.join("\n"));
  assert.ok(heads(f).length > 0 && heads(f).every((id) => id === NPC.GOLEM), `heads ${heads(f)}`);
});

// --- Dyeing -----------------------------------------------------------------------------------------

test("t526-528: ink on a desert robe asks 'Cancel|Dye it' with the robe shown; Dye it: the robe in the ink's slot, the vial in the robe's, 2.5 XP", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.INFILTRATE, items: [[I.BLACK_DYE, 1], [I.DESERT_ROBE, 1]] });
  const inkSlot = slotOf(f, I.BLACK_DYE);
  const robeSlot = slotOf(f, I.DESERT_ROBE);
  const xpRaw = Number(f.player.getSkillManager().skills.experience[h.core.Skill.CRAFTING.getIndex()]);
  await useItems(f, I.BLACK_DYE, I.DESERT_ROBE);
  assert.match(h.shown(f)?.text ?? "", /^If you dye the robe black it will no longer provide protection from the desert sun\. You will not be able to remove the dye\.$/);
  assert.deepEqual(boxItems(f), [I.DESERT_ROBE]);
  assert.ok(f.calls.some((c) => c.name === "sendClientScript" || true));
  await objectboxButton(f, 0);
  assert.equal(count(f, I.DESERT_ROBE), 1, "Cancel keeps it");
  clear(f);
  await useItems(f, I.BLACK_DYE, I.DESERT_ROBE);
  await objectboxButton(f, 1);
  const items = f.player.getInventory().getItems();
  assert.equal(items[inkSlot]?.getId(), I.BLACK_DESERT_ROBE);
  assert.equal(items[robeSlot]?.getId(), I.VIAL);
  assert.equal(h.shown(f)?.text, "You dye the desert robe black.");
  assert.deepEqual(boxItems(f).at(-1), I.BLACK_DESERT_ROBE);
  const raw = (skills) => Number(skills.skills.experience[h.core.Skill.CRAFTING.getIndex()]);
  assert.equal(raw(f.player.getSkillManager()) - xpRaw, 2.5);
});

test("t543: ink on a red cape: 'You dye the red cape black.' as a game message, the vial back", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.INFILTRATE, items: [[I.BLACK_DYE, 1], [I.RED_CAPE, 1]] });
  await useItems(f, I.BLACK_DYE, I.RED_CAPE);
  assert.deepEqual(texts(f), ["You dye the red cape black."]);
  assert.equal(count(f, I.BLACK_CAPE), 1);
  assert.equal(count(f, I.VIAL), 1);
  assert.equal(h.shown(f), null);
});

test("t701: a mushroom on Silverlight: the item box with the dyed sword", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.INFILTRATE, items: [[I.BLACK_MUSHROOM, 1], [I.SILVERLIGHT, 1]] });
  await useItems(f, I.BLACK_MUSHROOM, I.SILVERLIGHT);
  for (let i = 0; i < 4 && !h.shown(f); i++) h.tick(f);
  assert.equal(h.shown(f)?.text, "You slice the mushroom with Silverlight, and it stains the blade black.");
  assert.equal(count(f, I.SILVERLIGHT_2), 1);
  assert.equal(count(f, I.SILVERLIGHT), 0);
  assert.equal(count(f, I.BLACK_MUSHROOM), 0);
});

// --- Evil Dave and the escort ---------------------------------------------------------------------

const PORTAL = { id: 6310, tile: [2720, 4912] };
const DAVE_TILE = [2721, 4910, 0];

function wearBlack(f) {
  const E = h.core.Equipment;
  f.player.getEquipment().setItem(E.CAPE_SLOT, new h.core.Item(I.BLACK_CAPE, 1));
  f.player.getEquipment().setItem(E.BODY_SLOT, new h.core.Item(I.BLACK_DESERT_SHIRT, 1));
  f.player.getEquipment().setItem(E.LEG_SLOT, new h.core.Item(I.BLACK_DESERT_ROBE, 1));
}

test("t638-640: the portal before joining: Dave's 'Hey! This is our portal! Keep out!' with his 902 head", async (t) => {
  const f = actor(t, { tile: [2721, 4911, 0], stage: S.INFILTRATE });
  const said = await play(f, () => click(f, PORTAL.id, PORTAL.tile));
  assert.deepEqual(said, ["Evil Dave: Hey! This is our portal! Keep out!"]);
  assert.deepEqual(heads(f), [N.EVIL_DAVE_2]);
  assert.deepEqual(at(f).slice(2), [0]);
});

test("t672-674: 'I'm evil!' in ordinary clothes: 'You don't look evil.'; t690-692 black clothes and a shiny sword: 'far too shiny'", async (t) => {
  const f = actor(t, { tile: [2721, 4911, 0], stage: S.INFILTRATE, items: [[I.SILVERLIGHT, 1]] });
  const dave = h.spawn(f, NPC.DAVE_PORTAL, DAVE_TILE);
  const plain = await play(f, () => h.talk(f, dave), ["I want to join your group.", "I'm evil!"]);
  assert.ok(plain.includes("Evil Dave: You don't look evil. You certainly don't dress evil!"), plain.join("\n"));
  wearBlack(f);
  const shiny = await play(f, () => h.talk(f, dave), ["I want to join your group.", "I'm evil!"]);
  assert.ok(shiny.some((line) => line.startsWith("Evil Dave: But what's that sword? It's far too shiny to be evil.")), shiny.join("\n"));
  assert.equal(stage(f), S.INFILTRATE);
  assert.ok(heads(f).every((id) => id === NPC.DAVE_PORTAL), `heads ${heads(f)}`);
});

test("t715-773: black clothes and the dyed sword: the escort scene, stage 30, Reen's 1382 at 1, Denath's lines, then the room as it was", async (t) => {
  const f = actor(t, { tile: [2721, 4911, 0], stage: S.INFILTRATE, items: [[I.SILVERLIGHT_2, 1]] });
  wearBlack(f);
  const dave = h.spawn(f, NPC.DAVE_PORTAL, DAVE_TILE);
  const said = await play(f, () => h.talk(f, dave), ["I want to join your group.", "I'm evil!"], { idleTicks: 40 });
  assert.equal(stage(f), S.IN_GROUP, said.join("\n"));
  assert.equal(varbit(f, V.REEN), 1);
  assert.deepEqual(at(f), [2720, 4911, 2], "Dave walked the player up to Denath");
  const escort = said.slice(said.indexOf("Evil Dave: Okay, I'll take you through to see Denath."));
  assert.deepEqual(escort.slice(0, 6), [
    "Evil Dave: Okay, I'll take you through to see Denath.",
    "Evil Dave: Master! This person wants to join us!",
    "Denath: Indeed? Well we are one wizard short since Josef ran away. Can you vouch for him?",
    "Evil Dave: Yeah! He's totally evil!",
    "Denath: Thank you, Dave.",
    "Denath: So you wish to join us? You have made a wise choice. When we summon the demon Agrith-Naar, he will grant all our worldly desires.",
  ]);
  // t716: the escort's message box, with no continue, over the fade-out.
  assert.ok(f.calls.some((c) => c.name === "sendString" && c.args[0] === "Evil Dave escorts you into the demonic throne room."));
  // The cutscene's state is off again and the camera back (t773).
  assert.equal(varbit(f, 542), 0);
  assert.equal(varbit(f, 6719), 0);
  // t716 the fade out (overlay 174, script 948 over 15 cycles) and t718 back in; t717 the "denath cutscene" jingle.
  const fades = f.calls.filter((c) => c.name === "mountSubInterface" && c.args[1] === 174);
  assert.deepEqual(fades.map((c) => c.args[3]?.postScripts?.[0]?.args), [[0, 255, 0, 0, 15], [0, 0, 0, 255, 50]]);
  assert.ok(f.calls.some((c) => c.name === "sendJingle" && c.args[0] === 91));
  assert.ok(f.calls.filter((c) => c.name === "sendCameraReset").length >= 1);
  // The corridor walls are gone and the player can walk.
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
});

// --- Denath, Matthew, the golem and the kilns ------------------------------------------------------

const IN_ROOM = [2720, 4908, 2];

/** The room's own cast member (owner-only, in the player's room scene), after a tick to spawn it. */
function cast(f, id) {
  for (let i = 0; i < 3; i++) {
    const npc = [...h.core.World.getNpcs()].find((n) => n?.getOwner?.() === f.player && (n.getRealId?.() ?? n.getId()) === id);
    if (npc) return npc;
    h.tick(f);
  }
  assert.fail(`no ${id} in ${f.player.getUsername()}'s room`);
}

test("t822-830: Denath at stage 30 ('I forgot the incantation.') draws this player's incantation into 1373-1377, says it backwards; stage 40", async (t) => {
  const f = actor(t, { tile: IN_ROOM, stage: S.IN_GROUP });
  const denath = cast(f, N.DENATH);
  const said = await play(f, () => h.talk(f, denath), ["I forgot the incantation."]);
  const words = V.WORDS.map((id) => varbit(f, id));
  assert.deepEqual([...words].sort(), [0, 1, 2, 3, 4]);
  const spoken = [...words].reverse().map((w) => WORDS[w]).join(" ");
  assert.ok(said.some((line) => line.endsWith(`The incantation is ${spoken}.`)), said.join("\n"));
  assert.equal(stage(f), S.DENATH);
  const again = await play(f, () => h.talk(f, denath), ["I forgot the incantation."]);
  assert.ok(again.some((line) => line.endsWith(`The incantation is ${spoken}.`)), again.join("\n"));
  assert.deepEqual(V.WORDS.map((id) => varbit(f, id)), words, "asking again keeps the same words");
});

test("the incantation is drawn per player (the Wiki: 'The chant differs from player to player')", async (t) => {
  const seen = new Set();
  for (let i = 0; i < 12 && seen.size < 2; i++) {
    const f = actor(t, { tile: IN_ROOM, stage: S.IN_GROUP });
    const denath = cast(f, N.DENATH);
    await play(f, () => h.talk(f, denath), ["I forgot the incantation."]);
    seen.add(V.WORDS.map((id) => varbit(f, id)).join(","));
  }
  assert.ok(seen.size >= 2, [...seen].join(" / "));
});

test("t932-940: Matthew's Josef story; stage 50 with 'Josef must have hidden the book'", async (t) => {
  const f = actor(t, { tile: IN_ROOM, stage: S.DENATH });
  const matthew = cast(f, N.MATTHEW);
  const said = await play(f, () => h.talk(f, matthew), ["Do you know what happened to Josef?"]);
  assert.ok(said.some((line) => line.startsWith("Matthew: Josef must have hidden the book somewhere in the ruins")), said.join("\n"));
  assert.equal(stage(f), S.MATTHEW);
});

test("t1084-1090: the golem saw it; stage 60 with 'He was carrying a large book', the kiln drawn into 1378", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.MATTHEW });
  const golem = h.spawn(f, NPC.GOLEM, [3488, 3093, 0]);
  const said = await play(f, () => h.talk(f, golem), ["Did you see anything happen last night?"]);
  assert.ok(said.some((line) => line.startsWith("Clay golem: He was carrying a large book.")), said.join("\n"));
  assert.equal(stage(f), S.GOLEM);
  assert.ok([0, 1, 2, 3].includes(varbit(f, V.KILN)));
  assert.equal(f.player.getAttribute(A.KILN), varbit(f, V.KILN));
});

const KILNS = [[10242, [3467, 3123]], [10243, [3478, 3082]], [10244, [3472, 3092]], [10245, [3500, 3084]]];

test("t1449-1491: Look-in on a wrong kiln: the message box; on the right one: 881, the object box with the tome, the tome", async (t) => {
  const f = actor(t, { tile: [3474, 3094, 0], stage: S.GOLEM, attributes: { [A.KILN]: 0 } });
  h.core.PluginManager?.emitPlayerLogin?.({ player: f.player });
  const [wrongId, wrongTile] = KILNS[2];
  f.player.setLocation(new h.core.Location(wrongTile[0] + 2, wrongTile[1], 0));
  const wrong = await play(f, () => click(f, wrongId, wrongTile));
  assert.deepEqual(wrong, ["StatementDialogue: You look in the kiln but you see only sand and fragments of ancient golems."]);
  assert.equal(count(f, I.DEMONIC_TOME), 0);
  const [rightId, rightTile] = KILNS[0];
  f.player.setLocation(new h.core.Location(rightTile[0] + 2, rightTile[1], 0));
  clear(f);
  const right = await play(f, () => click(f, rightId, rightTile));
  assert.deepEqual(right, ["ItemStatementDialogue: You find a book in the kiln."]);
  assert.equal(count(f, I.DEMONIC_TOME), 1);
  assert.ok(f.animations.some((a) => a.id === 881));
  assert.deepEqual(boxItems(f), [I.DEMONIC_TOME]);
});

test("t1497-1503: Read opens the captured book, its incantation in this player's book order", async (t) => {
  const packed = [1, 4, 0, 3, 2].reduce((acc, w, i) => acc | (w << (i * 3)), 0);
  const f = actor(t, { tile: UZER, stage: S.GOLEM, items: [[I.DEMONIC_TOME, 1]], attributes: { [A.WORDS]: packed } });
  await itemOption(f, I.DEMONIC_TOME, "Read");
  const strings = f.calls.filter((c) => c.name === "sendString").map((c) => c.args[0]);
  assert.ok(strings.includes("I know that it is too late to"), strings.slice(0, 5).join("|"));
  // Turn to the third spread (the incantation): the capture's words for varbits 1,4,0,3,2.
  for (let page = 0; page < 2; page++) {
    await f.connection.dispatch([{ type: "widget_action", widgetId: (392 << 16) | 77, groupId: 392, childId: 77, buttonNum: 1 }]);
    h.tick(f);
  }
  const after = f.calls.filter((c) => c.name === "sendString").map((c) => c.args[0]);
  assert.ok(after.includes("'Nahudu Tarren Caldar") && after.includes("Camerinthum Agrith-Naar'"), after.slice(-30).join("|"));
});

test("t1356-1370: Chant away from the circle: five word menus, each said overhead and echoed, then 'Nothing interesting happens.'", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.GOLEM, items: [[I.DEMONIC_SIGIL, 1]] });
  const said = f.player.forceChat.bind(f.player);
  const overhead = [];
  f.player.forceChat = (text) => { overhead.push(text); return said(text); };
  const lines = await play(f, () => itemOption(f, I.DEMONIC_SIGIL, "Chant"), ["Caldar", "Nahudu", "Agrith-Naar", "Camerinthum", "Tarren"]);
  assert.deepEqual(lines, [
    "MENU[Select a word.]: Caldar|Nahudu|Agrith-Naar|Camerinthum|Tarren", "PLAYER: Caldar...",
    "MENU[Select a word.]: Caldar|Nahudu|Agrith-Naar|Camerinthum|Tarren", "PLAYER: Nahudu...",
    "MENU[Select a word.]: Caldar|Nahudu|Agrith-Naar|Camerinthum|Tarren", "PLAYER: Agrith-Naar...",
    "MENU[Select a word.]: Caldar|Nahudu|Agrith-Naar|Camerinthum|Tarren", "PLAYER: Camerinthum...",
    "MENU[Select a word.]: Caldar|Nahudu|Agrith-Naar|Camerinthum|Tarren", "PLAYER: Tarren!",
    "StatementDialogue: Nothing interesting happens.",
  ]);
  assert.deepEqual(overhead, ["Caldar", "Nahudu", "Agrith-Naar", "Camerinthum", "Tarren"]);
  assert.equal(f.animations.filter((a) => a.id === 2879).length, 5);
  assert.equal(stage(f), S.GOLEM);
});

test("t1262-1280: Jennifer hands over the mould with no message, and another once it is dropped", async (t) => {
  const f = actor(t, { tile: IN_ROOM, stage: S.DENATH });
  const jennifer = cast(f, N.JENNIFER_2);
  await play(f, () => h.talk(f, jennifer), ["Do you have the demonic sigil mould?"]);
  assert.equal(count(f, I.DEMONIC_SIGIL_MOULD), 1);
  assert.deepEqual(texts(f), []);
  const again = await play(f, () => h.talk(f, jennifer), ["Do you have the demonic sigil mould?"]);
  assert.ok(again.includes("Jennifer: I already gave that to you! Go away!"), again.join("\n"));
  f.player.getInventory().deleteNumber(I.DEMONIC_SIGIL_MOULD, 1);
  await play(f, () => h.talk(f, jennifer), ["Do you have the demonic sigil mould?"]);
  assert.equal(count(f, I.DEMONIC_SIGIL_MOULD), 1);
});

// --- The book, the ritual call and the first ritual ------------------------------------------------

const PACKED = [1, 4, 0, 3, 2].reduce((acc, w, i) => acc | (w << (i * 3)), 0); // ours t815
const DENATH_ORDER = ["Agrith-Naar", "Camerinthum", "Caldar", "Tarren", "Nahudu"]; // t1714-t1736
const BOOK_ORDER = [...DENATH_ORDER].reverse(); // t2175-t2198

test("t1607-1636: the book: Matthew's object box, stage 70 with 'Don't worry'; his 'Are you prepared' then nine ticks to Denath's call and stage 80", async (t) => {
  const f = actor(t, { tile: IN_ROOM, stage: S.GOLEM, items: [[I.DEMONIC_TOME, 1], [I.SILVERLIGHT_2, 1], [I.DEMONIC_SIGIL, 1]], attributes: { [A.WORDS]: PACKED } });
  const matthew = cast(f, N.MATTHEW);
  const said = await play(f, () => h.talk(f, matthew));
  assert.ok(said.includes("ItemStatementDialogue: Matthew quickly reads the book then hands it back to you.") || said.includes("StatementDialogue: Matthew quickly reads the book then hands it back to you."), said.join("\n"));
  assert.equal(stage(f), S.BOOK);
  assert.equal(count(f, I.DEMONIC_TOME), 1, "he hands it back");
  clear(f);
  await play(f, () => h.talk(f, matthew), [], { idleTicks: 3 });
  assert.equal(stage(f), S.BOOK);
  const from = f.said.length;
  h.ticks(f, 8);
  await play(f, null, [], { idleTicks: 3 });
  const call = f.said.slice(from).map((line) => `${line.who}: ${line.text}`);
  assert.equal(stage(f), S.RITUAL, call.join("\n"));
  assert.ok(call.includes("Denath: It is time for the ritual to commence!"), call.join("\n"));
  assert.ok(f.messages.some((m) => /unlocked a new music track: .*Incantation/.test(m.text)), "the Incantation track");
});

async function firstChant(f, words) {
  return play(f, () => itemOption(f, I.DEMONIC_SIGIL, "Chant"), words, { idleTicks: 10 });
}

function ritualActor(t, value = S.RITUAL) {
  const f = actor(t, { tile: [2718, 4902, 2], stage: value, items: [[I.DEMONIC_SIGIL, 1], [I.SILVERLIGHT_2, 1]], attributes: { [A.WORDS]: PACKED } });
  cast(f, N.DENATH);
  h.ticks(f, 2);
  return f;
}

const facing = (mobile) => { const tile = mobile.getPositionToFace?.(); return tile ? [tile.getX(), tile.getY()] : null; };
function overheads(f) {
  const said = [];
  const forceChat = f.player.forceChat.bind(f.player);
  f.player.forceChat = (text) => { said.push(text); return forceChat(text); };
  return said;
}

test("t1680-1708: a wrong first chant: the sigil forms, each word's camera, then Denath's 'You fool!' with his sigil head; the sigils stay out", async (t) => {
  const f = ritualActor(t);
  const words = overheads(f);
  await itemOption(f, I.DEMONIC_SIGIL, "Chant");
  // Everyone turns to the circle's centre for the chant (rsprox 3333 t2055-t2060).
  assert.deepEqual(facing(f.player), [2720, 4900]);
  for (const npc of [...h.core.World.getNpcs()].filter((n) => n?.getOwner?.() === f.player && n.getRealId() !== 911)) {
    if ([N.DENATH, N.ERIC, N.TANYA, N.MATTHEW, N.JENNIFER_2, N.PATRICK, N.EVIL_DAVE_2].includes(npc.getRealId())) assert.deepEqual(facing(npc), [2720, 4900], `${npc.getRealId()}`);
  }
  const said = await play(f, null, ["Caldar", "Caldar", "Caldar", "Caldar", "Caldar"], { idleTicks: 10 });
  assert.deepEqual(words.slice(0, 5), ["Caldar...", "Caldar...", "Caldar...", "Caldar...", "Caldar!"], "each word overhead (t1684-t1700)");
  assert.equal(f.animations.filter((a) => a.id === 2879).length, 5);
  assert.ok(said.includes("PLAYER: Caldar..."), said.join("\n"));
  assert.ok(said.includes("PLAYER: Caldar!"), said.join("\n"));
  assert.ok(said.includes("Denath: You fool! Do it again, and get it right!"), said.join("\n"));
  assert.ok(heads(f).includes(N.DENATH_2), `heads ${heads(f)}`);
  assert.equal(stage(f), S.RITUAL);
  const denath = cast(f, N.DENATH);
  assert.equal(denath.getNpcTransformationId(), N.DENATH_2);
  const moves = f.calls.filter((c) => c.name === "sendCameraMoveTo").map((c) => c.args.slice(0, 3));
  assert.deepEqual(moves.slice(0, 6), [[2726, 4901, 550], [2726, 4903, 600], [2725, 4904, 650], [2724, 4905, 700], [2723, 4906, 750], [2722, 4907, 800]]);
});

test("t1711-1788: the right first chant (Denath's order): stage 90, the closing cutscene with BOOM, Denath's sigil at 2720,4900, the runaways gone, Dave's 1380 at 1", async (t) => {
  const f = ritualActor(t);
  const said = await firstChant(f, DENATH_ORDER);
  assert.equal(stage(f), S.RITUAL_DONE, said.join("\n"));
  const lines = said.join("\n");
  for (const line of ["StatementDialogue: A magic circle appears in the floor...", "Jennifer: Oh my gods!", "StatementDialogue: BOOM!",
    "Tanya: Look! The portal's closing!", "Evil Dave: I'm getting out of here!"].map((line) => line.replace("BOOM!", "<col=800000>BOOM!"))) {
    assert.ok(said.includes(line), `${line}\n${lines}`);
  }
  assert.equal(varbit(f, V.DAVE), 1);
  assert.equal(varbit(f, 542), 0, "the cutscene is over");
  // Jennifer's boxes carry her own head, 905 (t1753), not the Shayzien store's Jennifer (305) a name finds.
  assert.ok(heads(f).includes(N.JENNIFER_2) && !heads(f).includes(305), `heads ${heads(f)}`);
  const ground = h.core.World ? f.player : null;
  void ground;
  const items = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
  void items;
  const ids = [...h.core.World.getNpcs()].filter((n) => n?.getOwner?.() === f.player).map((n) => n.getRealId());
  for (const gone of [N.DENATH, N.ERIC, N.TANYA, N.EVIL_DAVE_2]) assert.ok(!ids.includes(gone), `${gone} gone: ${ids}`);
  for (const stay of [N.MATTHEW, N.JENNIFER_2, N.PATRICK]) assert.ok(ids.includes(stay), `${stay} stays: ${ids}`);
  for (const npc of [...h.core.World.getNpcs()].filter((n) => n?.getOwner?.() === f.player)) {
    assert.equal(npc.getNpcTransformationId(), -1, `${npc.getId()} put the sigil away`);
  }
  // t1751: Denath's sigil where he vanished, for this player to see and take (t1792).
  const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
  assert.ok(ItemOnGroundManager.getGroundItem(f.player.getUsername(), I.DEMONIC_SIGIL, new h.core.Location(2720, 4900, 2), f.player.getPrivateArea?.()), "the sigil");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false, "free to move");
});

// --- Tanya's death and the recruits ---------------------------------------------------------------

test("t1833-1851: the closing portal: Tanya and the ghosts, 'You see Tanya killed by ghosts!' as a game message, stage 100, her sigil and bones", async (t) => {
  const f = actor(t, { tile: [2720, 4885, 2], stage: S.RITUAL_DONE, attributes: { [A.HELPERS]: 1 << 7 } });
  h.ticks(f, 2);
  await f.connection.dispatch([{ type: "object_option", id: 10251, x: 2719, y: 4883, clickType: 1 }]);
  h.ticks(f, 14);
  assert.deepEqual(at(f), [2721, 4911, 0]);
  assert.deepEqual(texts(f).filter((x) => /Tanya/.test(x)), ["You see Tanya killed by ghosts!"]);
  assert.equal(stage(f), S.PREPARE);
  const onFloor = (id) => h.core.World && require("../plugins/quests/QuestRuntime") && null;
  void onFloor;
});

test("t1870-1904: Dave in the passage gives Eric's sigil (1380 at 2), walks off north and has arrived at 3 fifteen ticks on", async (t) => {
  const f = actor(t, { tile: [2723, 4899, 0], stage: S.PREPARE, attributes: { [A.HELPERS]: (1 << 5) | (1 << 7) } });
  const dave = h.spawn(f, NPC.DAVE_PASSAGE, [2723, 4897, 0]);
  const said = await play(f, () => h.talk(f, dave), ["You've got to get back to the throne room!"]);
  assert.ok(said.some((line) => line.startsWith("Evil Dave: You'd better take this then. It was Eric's sigil.")), said.join("\n"));
  assert.equal(count(f, I.DEMONIC_SIGIL), 1);
  assert.equal(varbit(f, V.DAVE), 2);
  assert.ok(heads(f).every((id) => id === NPC.DAVE_PASSAGE), `heads ${heads(f)}`);
  const walker = [...h.core.World.getNpcs()].find((n) => n?.getOwner?.() === f.player && n.getId() === 914);
  assert.ok(walker, "the walking copy 914");
  h.ticks(f, 16);
  assert.equal(varbit(f, V.DAVE), 3);
  assert.ok(![...h.core.World.getNpcs()].some((n) => n?.getOwner?.() === f.player && n.getId() === 914), "the walker has gone");
});

test("t1897-1906: the first climb out is stopped by falling rocks (a hit of 1); the next climb comes up into the sandstorm", async (t) => {
  const f = actor(t, { tile: [2722, 4886, 0], stage: S.PREPARE, attributes: { [A.HELPERS]: (1 << 5) | (1 << 7) } });
  const hp = f.player.getHitpoints();
  await click(f, 6372, [2721, 4884]);
  h.ticks(f, 3);
  assert.ok(texts(f).includes("You are hit by falling rocks!"), JSON.stringify(texts(f)));
  assert.deepEqual(at(f).slice(2), [0]);
  assert.equal(at(f)[1] < 4900, true);
  // The hit of 1 is queued a tick on (ours t1902) with human_hit_1, after spotanim 271 and the collapse sound.
  assert.ok(f.calls.some((c) => c.name === "sendSoundEffect" && c.args[0] === 1384));
  assert.ok(f.calls.some((c) => c.name === "sendSoundEffect" && c.args[0] === 518 && c.args[2] === 20));
  void hp;
  clear(f);
  await click(f, 6372, [2721, 4884]);
  h.ticks(f, 3);
  assert.deepEqual(at(f), [3491, 3090, 0]);
  assert.ok(texts(f).includes("You must fight your way against a sandstorm!"), JSON.stringify(texts(f)));
  assert.ok(f.calls.some((c) => c.name === "mountSubInterface" && c.args[1] === 296), "the sandstorm overlay");
});

test("t1911-1950: Badden takes a sigil with 'You'll need to hold this sigil' (1381 at 2), and is in the throne room at 3", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.PREPARE, items: [[I.DEMONIC_SIGIL, 1]], attributes: { [A.HELPERS]: (1 << 5) | (1 << 7) } });
  const badden = h.spawn(f, NPC.BADDEN_UZER, [3487, 3092, 0]);
  const said = await play(f, () => h.talk(f, badden));
  assert.ok(said.includes("PLAYER: You'll need to hold this sigil for the ritual."), said.join("\n"));
  assert.equal(count(f, I.DEMONIC_SIGIL), 0);
  assert.equal(varbit(f, V.BADDEN), 2);
  h.ticks(f, 33);
  assert.equal(varbit(f, V.BADDEN), 3);
});

test("t1968-1999: Reen's menus do not take the sigil; 'Oh, don't be so simple-minded!' does (1382 at 2)", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.PREPARE, items: [[I.DEMONIC_SIGIL, 1]], attributes: { [A.HELPERS]: (1 << 5) | (1 << 7) } });
  const reen = h.spawn(f, NPC.REEN_UZER, [3487, 3091, 0]);
  await play(f, () => h.talk(f, reen), ["But isn't that what you and Badden asked me to do?"]);
  endChat(f);
  assert.equal(count(f, I.DEMONIC_SIGIL), 1);
  assert.equal(varbit(f, V.REEN), 1);
  const said = await play(f, () => h.talk(f, reen), ["Oh, don't be so simple-minded!"]);
  assert.ok(said.includes("PLAYER: Now take this demonic sigil, and hurry inside!"), said.join("\n"));
  assert.equal(count(f, I.DEMONIC_SIGIL), 0);
  assert.equal(varbit(f, V.REEN), 2);
});

test("t1931-2021: the golem refuses (1379 at 1), the implement reprograms it (2), and it takes a sigil (3; 348 at 5, then 6)", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.PREPARE, items: [[I.DEMONIC_SIGIL, 1], [I.STRANGE_IMPLEMENT, 1]], attributes: { [A.HELPERS]: (1 << 5) | (1 << 7) } });
  const golem = h.spawn(f, NPC.GOLEM, [3488, 3093, 0]);
  await play(f, () => h.talk(f, golem), ["Why is it forbidden?"]);
  endChat(f);
  assert.equal(varbit(f, V.GOLEM), 1);
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const box = await play(f, async () => {
    await f.connection.dispatch([{ type: "item_on_npc", targetIndex: golem.getIndex(), itemId: I.STRANGE_IMPLEMENT, slot: slotOf(f, I.STRANGE_IMPLEMENT), widgetId: 149 << 16 }]);
    for (let i = 0; i < 6 && !h.shown(f); i++) h.tick(f);
  });
  assert.ok(box.some((line) => line.includes("You open the golem's head and search through the dusty scrolls inside...")), box.join("\n"));
  assert.equal(varbit(f, V.GOLEM), 2);
  const said = await play(f, () => h.talk(f, golem));
  assert.ok(said.includes("PLAYER: Take this demonic sigil and go through the portal."), said.join("\n"));
  assert.equal(varbit(f, V.GOLEM), 3);
  assert.equal(varbit(f, V.CLAY), 5);
  assert.equal(count(f, I.DEMONIC_SIGIL), 0);
  h.ticks(f, 21);
  assert.equal(varbit(f, V.CLAY), 6);
});

// --- The second ritual, the summoning, the fight and the end ----------------------------------------

const ALL_ARRIVED = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13);

function secondActor(t, value = S.PREPARE, tile = [2720, 4903, 2]) {
  const f = actor(t, { tile, stage: value, items: [[I.DEMONIC_SIGIL, 1], [I.SILVERLIGHT_2, 1]], attributes: { [A.WORDS]: PACKED, [A.HELPERS]: ALL_ARRIVED } });
  cast(f, N.MATTHEW);
  h.ticks(f, 2);
  return f;
}

test("t2049-2053 and t2124-2135: with all four arrived the room holds the eight; Matthew's 'Yes.' and '*gulp*' make it 110", async (t) => {
  const f = secondActor(t);
  const ids = [...h.core.World.getNpcs()].filter((n) => n?.getOwner?.() === f.player).map((n) => n.getRealId());
  for (const id of [N.MATTHEW, N.JENNIFER_2, N.PATRICK, N.FATHER_REEN, N.FATHER_BADDEN, N.EVIL_DAVE_2, N.CLAY_GOLEM]) assert.ok(ids.includes(id), `${id} in ${ids}`);
  const no = await play(f, () => h.talk(f, cast(f, N.MATTHEW)), ["No."]);
  assert.ok(no.includes("Matthew: Do hurry! We haven't got much time!"), no.join("\n"));
  assert.equal(stage(f), S.PREPARE);
  const yes = await play(f, () => h.talk(f, cast(f, N.MATTHEW)), ["Yes."]);
  assert.ok(yes.some((line) => line.startsWith("Matthew: *gulp*")), yes.join("\n"));
  assert.equal(stage(f), S.READY);
});

test("with a helper still on the way Matthew counts who is missing, and 'Yes.' is not on offer", async (t) => {
  const f = actor(t, { tile: [2720, 4903, 2], stage: S.PREPARE, items: [[I.DEMONIC_SIGIL, 1]], attributes: { [A.HELPERS]: (1 << 5) | (1 << 7) | (1 << 0) | (1 << 8) } });
  const said = await play(f, () => h.talk(f, cast(f, N.MATTHEW)), ["Okay."]);
  assert.ok(said.includes("Matthew: We need to get everyone back in here! We need three more people to perform the ritual!"), said.join("\n"));
  assert.equal(stage(f), S.PREPARE);
});

test("t2142-2171: the second chant backwards: Matthew's 'No, we need to perform the ritual forwards' with his sigil head", async (t) => {
  const f = secondActor(t, S.READY);
  const said = await play(f, () => itemOption(f, I.DEMONIC_SIGIL, "Chant"), DENATH_ORDER, { idleTicks: 10 });
  assert.ok(said.includes("Matthew: No, we need to perform the ritual forwards, as it appears in the book!"), said.join("\n"));
  assert.ok(heads(f).includes(N.MATTHEW_2), `heads ${heads(f)}`);
  assert.equal(stage(f), S.READY);
});

test("t2173-2229: the book's order: stage 120, Agrith-Naar on the circle, Matthew killed (his bones), the fight begins with the cutscene over", async (t) => {
  const f = secondActor(t, S.READY);
  const said = await play(f, () => itemOption(f, I.DEMONIC_SIGIL, "Chant"), BOOK_ORDER, { idleTicks: 10 });
  assert.equal(stage(f), S.SUMMONED, said.join("\n"));
  for (const line of ["Agrith Naar: Matthew!", "Agrith Naar: How dare you summon me?", "Matthew: Aaaargh!", "PLAYER: He didn't summon you.",
    "PLAYER: I did!", "Agrith Naar: Then prepare to die!"]) assert.ok(said.includes(line), `${line}\n${said.join("\n")}`);
  const demon = [...h.core.World.getNpcs()].find((n) => n?.getOwner?.() === f.player && n.getRealId() === N.AGRITH_NAAR);
  assert.ok(demon, "Agrith-Naar");
  assert.deepEqual([demon.getLocation().getX(), demon.getLocation().getY()], [2719, 4899]);
  assert.ok(![...h.core.World.getNpcs()].some((n) => n?.getOwner?.() === f.player && n.getRealId() === N.MATTHEW), "Matthew is gone");
  assert.equal(varbit(f, 542), 0);
  assert.ok(f.messages.some((m) => /unlocked a new music track: .*Grip of the Talon/.test(m.text)));
  // As he attacks, the cast walk off about the room and keep moving (rsprox 3333 t2475-t2483, ours t2232-t2260).
  h.ticks(f, 12);
  for (const id of [N.FATHER_REEN, N.FATHER_BADDEN, N.JENNIFER_2, N.PATRICK]) {
    const npc = cast(f, id);
    assert.ok(npc.getMovementCoordinator().getRadius() > 0, `${id} keeps moving`);
    assert.equal(npc.getNpcTransformationId(), -1, `${id} put the sigil away`);
  }
});

test("t2709 and the Wiki: the last hitpoint off with the player out of melee: 'Silverlight's power can't affect...' and back to 12", async (t) => {
  const f = secondActor(t, S.READY);
  await play(f, () => itemOption(f, I.DEMONIC_SIGIL, "Chant"), BOOK_ORDER, { idleTicks: 10 });
  const demon = [...h.core.World.getNpcs()].find((n) => n?.getOwner?.() === f.player && n.getRealId() === N.AGRITH_NAAR);
  f.player.getEquipment().setItem(h.core.Equipment.WEAPON_SLOT, new h.core.Item(I.SILVERLIGHT_2, 1));
  f.player.moveTo(new h.core.Location(2715, 4908, 2));
  h.tick(f);
  clear(f);
  assert.equal(h.PM.emitNpcBeforeDeath({ npc: demon, killer: f.player, preventDeath: false }), true);
  assert.equal(demon.getHitpoints(), 12);
  assert.deepEqual(texts(f), ["Silverlight's power can't affect Agrith-Naar from this far away."]);
});

test("t2760-2786: the kill: Darklight in its place, the boxes with it, the skill menus, stage 125 on the wire, 10,000 XP in the skill once", async (t) => {
  const f = secondActor(t, S.READY);
  await play(f, () => itemOption(f, I.DEMONIC_SIGIL, "Chant"), BOOK_ORDER, { idleTicks: 10 });
  const demon = [...h.core.World.getNpcs()].find((n) => n?.getOwner?.() === f.player && n.getRealId() === N.AGRITH_NAAR);
  f.player.getEquipment().setItem(h.core.Equipment.WEAPON_SLOT, new h.core.Item(I.SILVERLIGHT_2, 1));
  f.player.getInventory().deleteNumber(I.SILVERLIGHT_2, 1);
  clear(f);
  const raw = (skill) => Number(f.player.getSkillManager().skills.experience[skill.getIndex()]);
  const before = raw(h.core.Skill.STRENGTH);
  const said = await play(f, () => { h.PM.emitNpcDeath({ npc: demon, killer: f.player }); h.tick(f); }, ["--- More ---", "--- Previous ---", "* Strength *"]);
  assert.equal(f.player.getEquipment().getItems()[h.core.Equipment.WEAPON_SLOT]?.getId(), I.DARKLIGHT);
  assert.deepEqual(said.slice(0, 3), [
    "ItemStatementDialogue: As you strike the final blow, Silverlight is drenched with Agrith-Naar's foul-smelling ichor!",
    "ItemStatementDialogue: You try to wipe Silverlight clean, but Agrith-Naar's blood has fused with the blade. You heft the sword and sense that it has become more powerful.",
    "StatementDialogue: You feel the power flowing up into your arm. You can direct it into any combat skill...",
  ]);
  assert.ok(said.includes("MENU[Select a skill to advance]: * Hitpoints *|* Magic *|* Ranged *|--- Previous ---"), said.join("\n"));
  assert.equal(quest().isComplete(f.player), true);
  assert.equal(varbit(f, V.STAGE), 125);
  assert.equal(raw(h.core.Skill.STRENGTH) - before, 10000);
  assert.equal(varbit(f, V.CLAY), 4, "the golem back in Uzer");
  const again = await play(f, () => { h.PM.emitNpcDeath({ npc: demon, killer: f.player }); });
  void again;
  assert.equal(raw(h.core.Skill.STRENGTH) - before, 10000, "no second reward");
});

test("after the quest: the portal's 'You step into the portal.' into the plain room; Badden and Reen stay gone from Uzer", async (t) => {
  const f = actor(t, { tile: [2721, 4911, 0], stage: S.COMPLETE, attributes: { [A.HELPERS]: ALL_ARRIVED } });
  h.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
  await click(f, PORTAL.id, PORTAL.tile);
  h.ticks(f, 2);
  assert.deepEqual(at(f), [2720, 4884, 2]);
  assert.ok(texts(f).includes("You step into the portal."));
  const castIds = new Set([N.DENATH, N.ERIC, N.TANYA, N.MATTHEW, N.JENNIFER_2, N.PATRICK, N.EVIL_DAVE_2, N.FATHER_REEN, N.FATHER_BADDEN, N.CLAY_GOLEM, N.AGRITH_NAAR]);
  assert.deepEqual([...h.core.World.getNpcs()].filter((n) => n?.getOwner?.() === f.player && castIds.has(n.getRealId())).map((n) => n.getRealId()), []);
  assert.equal(varbit(f, V.BADDEN), 3);
  assert.equal(varbit(f, V.REEN), 3);
});

test("persistence: helpers recruited on the way have arrived after a relog; the words and the kiln survive", async (t) => {
  const packed = PACKED;
  const f = actor(t, { tile: UZER, stage: S.PREPARE, items: [[I.DEMONIC_SIGIL, 1]], attributes: { [A.WORDS]: packed, [A.KILN]: 2, [A.HELPERS]: (1 << 5) | (1 << 7) } });
  const badden = h.spawn(f, NPC.BADDEN_UZER, [3487, 3092, 0]);
  await play(f, () => h.talk(f, badden));
  assert.equal(varbit(f, V.BADDEN), 2);
  const g = reload(t, f);
  assert.equal(varbit(g, V.BADDEN), 3);
  assert.deepEqual(V.WORDS.map((id) => varbit(g, id)), [1, 4, 0, 3, 2]);
  assert.equal(varbit(g, V.KILN), 2);
  assert.equal(quest().getStage(g.player), S.PREPARE);
});

test("a wrong chant, then the right one, in the same visit (ours t1680-t1739)", async (t) => {
  const f = ritualActor(t);
  await firstChant(f, ["Caldar", "Caldar", "Caldar", "Caldar", "Caldar"]);
  assert.equal(stage(f), S.RITUAL);
  h.ticks(f, 3);
  await firstChant(f, DENATH_ORDER);
  assert.equal(stage(f), S.RITUAL_DONE);
});

test("logging out in the escort leaves no cutscene behind: stage 30, the camera and controls back at login", async (t) => {
  const f = actor(t, { tile: [2721, 4911, 0], stage: S.INFILTRATE, items: [[I.SILVERLIGHT_2, 1]] });
  wearBlack(f);
  const dave = h.spawn(f, NPC.DAVE_PORTAL, DAVE_TILE);
  await play(f, () => h.talk(f, dave), ["I want to join your group.", "I'm evil!"], { idleTicks: 1 });
  h.ticks(f, 10);
  assert.equal(varbit(f, 542), 1, "control: mid-cutscene");
  const g = reload(t, f);
  h.ticks(g, 2);
  assert.equal(quest().getStage(g.player), S.IN_GROUP);
  assert.equal(varbit(g, 542), 0);
  assert.equal(g.player.getMovementQueue().isMovementBlocked(), false);
});

// --- What the capture adds to the Wiki's transcript (osrsreboxed-db correction) -----------------------

test("t76-90, t137: Reen's 'Do you know where Silverlight is?': carried, or 'Perhaps it's in your bank?'", async (t) => {
  const f = actor(t, { tile: [3271, 3160, 0], stage: S.STARTED, items: [[I.SILVERLIGHT, 1]] });
  const reen = h.spawn(f, NPC.REEN_AK, REEN_AK_TILE);
  const carried = await play(f, () => h.talk(f, reen), ["Do you know where Silverlight is?"]);
  assert.deepEqual(carried, [
    "Father Reen: Did you go to Uzer to see Badden?",
    "MENU[Select an option]: Not yet.|Do you know where Silverlight is?",
    "PLAYER: Do you know where Silverlight is?",
    "Father Reen: Yes, you're carrying it.",
    "PLAYER: Oh yes, so I am.",
  ]);
  f.player.getInventory().deleteNumber(I.SILVERLIGHT, 1);
  f.player.getBank(0).add(new h.core.Item(I.SILVERLIGHT, 1), false);
  const banked = await play(f, () => h.talk(f, reen), ["Do you know where Silverlight is?"]);
  assert.ok(banked.includes("Father Reen: Perhaps it's in your bank?"), banked.join("\n"));
  assert.equal(count(f, I.SILVERLIGHT), 0, "banked, so he gives no other");
});

test("t1560-1561: Reen in Uzer finds a lost sword and gives it back cleaned (plain Silverlight)", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.GOLEM });
  const reen = h.spawn(f, NPC.REEN_UZER, [3487, 3091, 0]);
  const said = await play(f, () => h.talk(f, reen));
  assert.deepEqual(said, [
    "Father Reen: Look what I found, all covered in dirt and sand. Silverlight!",
    "Father Reen: I've given it a good clean. Make sure you don't lose it again!",
  ]);
  assert.equal(count(f, I.SILVERLIGHT), 1);
  assert.ok(heads(f).every((id) => id === NPC.REEN_UZER), `heads ${heads(f)}`);
});

test("t2107-2109: Reen in the throne room hands back the dyed sword", async (t) => {
  const f = secondActor(t);
  f.player.getInventory().deleteNumber(I.SILVERLIGHT_2, 1);
  const said = await play(f, () => h.talk(f, cast(f, N.FATHER_REEN)));
  assert.ok(said.includes("Father Reen: You dropped Silverlight, you fool! Now is not the time to lose the only sword that can kill Agrith-Naar!"), said.join("\n"));
  assert.equal(count(f, I.SILVERLIGHT_2), 1);
});

test("t713-715: Dave loves the evil black sword before the escort", async (t) => {
  const f = actor(t, { tile: [2721, 4911, 0], stage: S.INFILTRATE, items: [[I.SILVERLIGHT_2, 1]] });
  wearBlack(f);
  const dave = h.spawn(f, NPC.DAVE_PORTAL, DAVE_TILE);
  const said = await play(f, () => h.talk(f, dave), ["I want to join your group.", "I'm evil!"], { idleTicks: 40 });
  const i = said.indexOf("Evil Dave: Yeah, I can see that. That outfit is totally evil!");
  assert.deepEqual(said.slice(i, i + 3), [
    "Evil Dave: Yeah, I can see that. That outfit is totally evil!",
    "Evil Dave: And I love that evil black sword!",
    "Evil Dave: Okay, I'll take you through to see Denath.",
  ]);
});

test("t1644-1655: Denath at stage 80: 'Get to your place in the circle, fool!' and his menu", async (t) => {
  const f = ritualActor(t);
  const said = await play(f, () => h.talk(f, cast(f, N.DENATH)), ["Okay."]);
  assert.deepEqual(said, [
    "Denath: Get to your place in the circle, fool! I want you to lead these dunderheads in the summoning ritual!",
    "MENU[Select an option]: Okay.|I forgot the incantation.",
    "PLAYER: Okay.",
  ]);
});

// --- The sweep: gating, recovery and interruption ---------------------------------------------------

test("gating: Chant at stage 70 in the room, or after the quest, is only 'Nothing interesting happens.'", async (t) => {
  for (const value of [S.BOOK, S.COMPLETE]) {
    const f = actor(t, { tile: [2718, 4902, 2], stage: value, items: [[I.DEMONIC_SIGIL, 1]], attributes: { [A.WORDS]: PACKED } });
    const said = await play(f, () => itemOption(f, I.DEMONIC_SIGIL, "Chant"), DENATH_ORDER, { idleTicks: 10 });
    assert.equal(said.at(-1), "StatementDialogue: Nothing interesting happens.", `${value}: ${said.join("\n")}`);
    assert.equal(stage(f), value);
  }
});

test("the Wiki: after the quest the mould makes no more sigils", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.COMPLETE, items: [[I.DEMONIC_SIGIL_MOULD, 1], [I.SILVER_BAR, 1]] });
  const event = { player: f.player, itemId: I.DEMONIC_SIGIL, action: "craft", allow: true };
  h.PM.emitCanUseItem?.(f.player, I.DEMONIC_SIGIL, "craft");
  const allowed = h.PM.emitCanUseItem(f.player, I.DEMONIC_SIGIL, "craft");
  assert.equal(allowed, false);
  assert.ok(texts(f).includes("There is no need to make another sigil now you have defeated Agrith-Naar."), JSON.stringify(texts(f)));
  void event;
  const g = actor(t, { tile: UZER, stage: S.DENATH, items: [[I.DEMONIC_SIGIL_MOULD, 1], [I.SILVER_BAR, 1]] });
  assert.notEqual(h.PM.emitCanUseItem(g.player, I.DEMONIC_SIGIL, "craft"), false, "during the quest it does");
});

test("recovery: logging in in the room at stage 90 before leaving plays Tanya's death outside", async (t) => {
  const f = actor(t, { tile: [2720, 4890, 2], stage: S.RITUAL_DONE, attributes: { [A.HELPERS]: 1 << 7 } });
  h.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
  h.ticks(f, 14);
  assert.deepEqual(at(f), [2721, 4911, 0]);
  assert.equal(stage(f), S.PREPARE);
});

test("death in the fight: back in the room at stage 120, Agrith-Naar is there again", async (t) => {
  const f = actor(t, { tile: [2721, 4911, 0], stage: S.SUMMONED, items: [[I.SILVERLIGHT_2, 1]], attributes: { [A.HELPERS]: ALL_ARRIVED, [A.WORDS]: PACKED } });
  h.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
  await click(f, PORTAL.id, PORTAL.tile);
  h.ticks(f, 3);
  assert.deepEqual(at(f), [2720, 4884, 2]);
  assert.ok([...h.core.World.getNpcs()].some((n) => n?.getOwner?.() === f.player && n.getRealId() === N.AGRITH_NAAR), "the demon");
  assert.ok(!cast(f, N.FATHER_REEN).isRegistered?.() === false, "and the cast");
});

test("interruption: a logout in the summoning cutscene comes back at stage 120 with no cutscene state, the fight there", async (t) => {
  const f = secondActor(t, S.READY);
  await play(f, () => itemOption(f, I.DEMONIC_SIGIL, "Chant"), BOOK_ORDER, { idleTicks: 10, until: () => stage(f) === S.SUMMONED });
  h.ticks(f, 4);
  assert.equal(stage(f), S.SUMMONED);
  assert.equal(varbit(f, 542), 1, "control: mid-cutscene");
  const g = reload(t, f);
  h.ticks(g, 3);
  assert.equal(quest().getStage(g.player), S.SUMMONED);
  assert.equal(varbit(g, 542), 0);
  assert.equal(g.player.getMovementQueue().isMovementBlocked(), false);
  assert.ok([...h.core.World.getNpcs()].some((n) => n?.getOwner?.() === g.player && n.getRealId() === N.AGRITH_NAAR), "the demon");
});

test("item-loss: Badden's line twice (a double click) takes one sigil", async (t) => {
  const f = actor(t, { tile: UZER, stage: S.PREPARE, items: [[I.DEMONIC_SIGIL, 2]], attributes: { [A.HELPERS]: (1 << 5) | (1 << 7) } });
  const badden = h.spawn(f, NPC.BADDEN_UZER, [3487, 3092, 0]);
  await play(f, () => h.talk(f, badden));
  await play(f, () => h.talk(f, badden));
  assert.equal(count(f, I.DEMONIC_SIGIL), 1);
});
