// Run after `yarn build`: node --test tests/merlins-crystal-capture.test.cjs
//
// Merlin's Crystal against a whole run of the quest on live: the user's RSProx capture
// MerlinsCrystal.bin (revision 242), with local recordings 1001800 and 1001994 for the bread on the
// first visit and the wrong incantation (docs/quests/merlins-crystal/README.md). Real Player,
// PlayerSession and ClientConnection, the real plugins, cache and map: talks, clicks, drops and item
// uses are packets and each tick runs as World.process does. Ticks in the test names are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");

const KEY = "merlins_crystal";
const S = { UNSTARTED: 0, STARTED: 1, GAWAIN: 2, LANCELOT: 3, MORGAN: 4, BOUND: 5, FREED: 6, COMPLETE: 7 };
const VARP = 14;
const A = {
  READ: "quest.merlin-s-crystal:read-incantation",
  TEST: "quest.merlin-s-crystal:lady-s-test",
  ASKED: "quest.merlin-s-crystal:beggar-asked",
  DONE: "quest.merlin-s-crystal:beggar-rewarded",
  CANDLE: "quest.merlin-s-crystal:candle-asked",
  HIVE: "quest.merlin-s-crystal:hive-repelled",
};
const NPC = {
  ARTHUR: 3531, LANCELOT: 3519, GAWAIN: 3520, KAY: 3521, BEDIVERE: 3522, TRISTRAM: 3523, PELLEAS: 3524,
  LUCAN: 3525, PALOMEDES: 3526, MORDRED: 3527, MORGAN: 3528, MERLIN: 3529, LADY: 3530, BEGGAR: 3532,
  THRANTAX: 3518, CANDLE_MAKER: 3199,
};
const LOC = { CRATE: 63, CRYSTAL: 62, ALTAR: 61, HIVE: 68, JEWELLERS_DOOR: 59, KEEP_DOOR_L: 71, WORKSHOP_DOOR: 24,
  STAIRS: 15645, STAIRS_TOP: 15648 };
const FADE_SCRIPT = 948;
const MINIMAP_STATE = 6719;
const CUTSCENE_STATUS = 542;

let I;
let codec;
before(async () => {
  h.key = KEY;
  await h.setup([[2760, 3500], [2800, 3440], [2770, 3400], [3016, 3246], [2925, 3405], [3259, 3381], [2780, 3515],
    [2767, 3493], [2776, 9848], [2760, 3480]]);
  I = h.core.ItemIdentifiers;
  // NPC stats and animations (Mordred's fai_varrock_guard set, Thrantax's ghost one), as the server loads them.
  new (require("../dist/game/definition/loader/impl/NpcDefinitionLoader").NpcDefinitionLoader)().load();
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => h.teardown());

// The end of a world tick, as the Shadow of the Storm capture test runs it: queued hits land (the world's
// "combat_hits" step), deaths start from them, and the player's own NPCs are in their local list.
const baseTick = h.tick;
const { HitQueue } = require("../dist/game/content/combat/hit/HitQueue");
h.tick = (f) => {
  baseTick(f);
  HitQueue.processAll(h.core.World.processCycle);
  const owned = [...h.core.World.getNpcs()].filter((npc) => npc?.getOwner?.() === f.player);
  h.core.World.updateLocalNpcs(f.player, owned);
  for (const npc of owned) npc.setNeedsPlacement(false);
};

/** A hit through the target's real HitQueue: the engine's own death path runs from it. */
function landHit(attacker, target, damage) {
  const hit = new h.core.PendingHit(attacker, target, h.core.CombatFactory.MELEE_COMBAT,
    { delay: 0, damage, rollAccuracy: false, experience: false, handleAfterHitEffects: false });
  target.getCombat().getHitQueue().addPendingHit(hit, 0);
}

const quest = () => h.quest(KEY);
const stage = (f) => quest().getStage(f.player);
const varp = (f) => f.player.getPacketSender().getConfig?.(VARP) ?? null;
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const count = (f, id) => f.player.getInventory().getAmount(id);
const at = (f) => { const l = f.player.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
const texts = (f) => f.messages.filter((m) => !String(m.text).includes("|")).map((m) => String(m.text))
  .filter((text) => !text.startsWith("You have unlocked a new music track"));
const heads = (f) => f.calls.filter((c) => c.name === "sendNpcHeadOnInterface").map((c) => c.args[0]);
const clear = (f) => { f.calls.length = 0; f.messages.length = 0; f.animations.length = 0; };
const slotOf = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId() === id);
const npcsNear = (f, id, tile) => {
  const found = [];
  for (const npc of h.core.World.getNpcs()) {
    if (!npc || npc.getId() !== id || !npc.isRegistered?.()) continue;
    const l = npc.getLocation();
    if (tile && (l.getX() !== tile[0] || l.getY() !== tile[1] || l.getZ() !== tile[2])) continue;
    if (!tile && l.getDistance(f.player.getLocation()) > 20) continue;
    found.push(npc);
  }
  return found;
};

function actor(t, { tile = [2765, 3512, 0], stage: value = 0, items = [], attributes = {}, done = [] } = {}) {
  const f = h.actor(t, { at: tile, stage: value, done, attributes });
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount ?? 1), false);
  const sender = f.player.getPacketSender();
  for (const name of ["mountSubInterface", "closeSubInterface", "closeSubInterfaceMount", "sendCameraReset", "sendTabInterface", "sendHideNpcOps", "sendHideObjOps"]) {
    if (typeof sender[name] !== "function") continue;
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { f.calls.push({ tick: f.tick, name, args }); return original(...args); };
  }
  clear(f);
  return f;
}

/** Plays out a conversation (or a box), answering menus with `picks`; waits through held boxes. */
async function play(f, start, picks = [], { pace = 0 } = {}) {
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
    if (pace) h.ticks(f, pace);
    await h.continueLine(f);
  }
  return f.said.slice(from).map((s) => (s.who === "menu" ? `MENU[${s.title ?? ""}]: ${s.text}` : `${s.who}: ${s.text}`))
    .map((line) => line.replace(/<\/?col(=[0-9a-f]+)?>/g, ""));
}

async function click(f, id, [x, y, z = f.player.getLocation().getZ()], clickType = 1) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const before = f.messages.length;
  const from = f.player.getLocation().clone();
  const moved = () => !f.player.getLocation().equals(from);
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType }]);
  for (let i = 0; i < 20 && f.messages.length === before && !h.shown(f) && !moved(); i++) h.tick(f);
  h.ticks(f, 2);
}

async function dropItem(f, itemId) {
  await f.connection.dispatch([{ type: "inventory_action", slot: slotOf(f, itemId), itemId, widgetId: 149 << 16, option: "Drop" }]);
  f.connection.processTurnPackets();
  h.tick(f);
}

async function useItems(f, a, b) {
  await f.connection.dispatch([{ type: "inventory_use_on", slot: slotOf(f, a), itemId: a, target: { kind: "inventory", slot: slotOf(f, b), id: b } }]);
  f.connection.processTurnPackets();
  h.tick(f);
}

async function useOnObject(f, objectId, [x, y], itemId) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const before = f.messages.length;
  await f.connection.dispatch([{ type: "item_on_object", itemId, slot: slotOf(f, itemId), widgetId: 149 << 16, objectId, x, y }]);
  for (let i = 0; i < 12 && f.messages.length === before && !h.shown(f); i++) h.tick(f);
  h.tick(f);
}

function journal(f) {
  const [, layer] = h.QuestRuntime.journalWidgets(quest(), f.player);
  return layer.staticChildren.map((child) => child.text);
}

function reload(t, f, tile) {
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.player), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  h.PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  const g = actor(t, { tile: tile ?? at(f) });
  codec.hydratePlayerSave(raw).applyToPlayer(g.player);
  h.PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername(), isNewAccount: false });
  clear(g);
  return g;
}

const fadeScripts = (f) => f.calls.filter((c) => c.name === "sendSubInterface" || c.name === "sendInterfaceScript")
  .length;

// --- King Arthur and the start ------------------------------------------------------------------

test("t395-423: King Arthur's 'Start the Merlin's Crystal quest?' Yes. starts it; the message before 'I will see what I can do then.'", async (t) => {
  const f = actor(t);
  const arthur = h.spawn(f, NPC.ARTHUR, [2766, 3513, 0]);
  const said = await play(f, () => h.talk(f, arthur), ["I want to become a Knight of the Round Table!", "Yes."]);
  assert.deepEqual(said, [
    "King Arthur: Welcome to my court. I am King Arthur of the Knights of the Round Table.",
    "MENU[Select an option]: I want to become a Knight of the Round Table!|So what are you doing in Gielinor?|Thank you very much.",
    "PLAYER: I want to become a Knight of the Round Table!",
    "King Arthur: Really? Well then you will need to go on a quest to prove yourself worthy. My knights all appreciate a good quest.",
    "King Arthur: Unfortunately, our current quest is to rescue Merlin. He recently got himself trapped in some sort of magical crystal. We've moved him from the cave we found him in and now he's upstairs in his tower.",
    "MENU[Start the Merlin's Crystal quest?]: Yes.|No.",
    "PLAYER: I will see what I can do then.",
    "King Arthur: Talk to my knights if you need any help.",
  ]);
  assert.equal(stage(f), S.STARTED);
  const started = f.messages.findIndex((m) => /^You've started a new quest: .*Merlin's Crystal/.test(String(m.text)));
  assert.ok(started >= 0, JSON.stringify(texts(f)));
  assert.ok(heads(f).every((id) => id === NPC.ARTHUR), `heads ${heads(f)}`);
});

test("t405-418: 'No.' leaves it unstarted; started, Arthur says 'you must complete your quest' (t432)", async (t) => {
  const f = actor(t);
  const arthur = h.spawn(f, NPC.ARTHUR, [2766, 3513, 0]);
  const said = await play(f, () => h.talk(f, arthur), ["I want to become a Knight of the Round Table!", "No."]);
  assert.ok(said.includes("PLAYER: I may come back and try that later."), said.join("\n"));
  assert.equal(stage(f), S.UNSTARTED);
  quest().setStage(f.player, S.STARTED);
  const again = await play(f, () => h.talk(f, arthur), ["I want to become a Knight of the Round Table!"]);
  assert.equal(again.at(-1), "King Arthur: Well then you must complete your quest to rescue Merlin. Talk to my knights if you need any help.");
});

// --- The journal --------------------------------------------------------------------------------

const STARTED = [
  "<str>I spoke to King Arthur and he said I would be worthy of",
  "<str><str>becoming a Knight of the Round Table if I could free <str>Merlin",
  "<str>from a giant crystal that he has been trapped in.",
];
test("journal: each stage as live sent it (ticks 437, 668, 781, 1495, 1674, 1981, 2067)", async (t) => {
  const f = actor(t, { stage: S.STARTED });
  assert.deepEqual(journal(f), [...STARTED, "",
    "<col=000080>I should ask the <col=800000>other Knights<col=000080> if they have any <col=800000>advice <col=000080>for me",
    "<col=000080>on how I should go about doing this."]);
  quest().setStage(f.player, S.GAWAIN);
  assert.deepEqual(journal(f).slice(3), [
    "<col=800000>Gawain<col=000080> thinks this was the work of <col=800000>Morgan Le Faye<col=000080> who <col=000080>lives in",
    "<col=000080>an <col=800000>impenetrable fortress<col=000080> south of here full of <col=800000>renegade",
    "<col=800000>knights<col=000080> led by the evil <col=800000>Sir Mordred"]);
  quest().setStage(f.player, S.LANCELOT);
  assert.equal(journal(f).length, 7);
  assert.equal(journal(f)[6], "<col=000080>There might be a way to enter with a <col=800000>delivery by sea<col=000080>...");
  quest().setStage(f.player, S.MORGAN);
  f.player.getInventory().add(new h.core.Item(I.BAT_BONES, 1), false);
  assert.equal(journal(f).length, 17);
  assert.equal(journal(f)[15], "<col=000080>The <col=800000>Holy Sword Excalibur<col=000080> from the <col=800000>Lady of the Lake");
  assert.equal(journal(f)[16], "<str>I have some bat bones with me");
  f.player.getInventory().add(new h.core.Item(I.EXCALIBUR, 1), false);
  assert.equal(journal(f)[15], "<str>I have the Holy Sword Excalibur with me");
  quest().setStage(f.player, S.BOUND);
  assert.equal(journal(f).length, 17);
  assert.equal(journal(f)[16], "<col=000080>I should free <col=800000>Merlin<col=000080> by using <col=800000>Excalibur<col=000080> on the <col=800000>crystal");
  quest().setStage(f.player, S.FREED);
  assert.equal(journal(f).length, 19);
  assert.equal(journal(f)[16], "<str>I freed Merlin by shattering the Crystal that trapped him");
  quest().setStage(f.player, S.COMPLETE);
  assert.equal(journal(f).at(-1), "<col=ff0000>QUEST COMPLETE!");
});

// --- The knights --------------------------------------------------------------------------------

test("t447-624: the knights at stage 1, with live's lines and their own chatheads", async (t) => {
  const f = actor(t, { stage: S.STARTED });
  const cases = [
    [NPC.PALOMEDES, ["Sir Palomedes: Hello there adventurer, what do you want of me?",
      "PLAYER: I'd like some advice on breaking that Crystal Merlin's trapped in.",
      "Sir Palomedes: Sorry, I cannot help you with that."]],
    [NPC.KAY, ["Sir Kay: Good morrow!", "PLAYER: Any ideas on getting Merlin out of that crystal?",
      "Sir Kay: Unfortunately not, Sirrah.", "Sir Kay: 'Tis a magick most powerful and foul.",
      "Sir Kay: The only person I know of who would possibly have been of help is Merlin...",
      "PLAYER: Yeah, that's not actually too helpful.", "Sir Kay: I am well aware of that, adventurer."]],
    [NPC.TRISTRAM, ["Sir Tristram: Hail Arthur, King of the Britons!", "PLAYER: Um... Hello.",
      "PLAYER: Do you know much about breaking magical crystals?", "Sir Tristram: Funnily enough...",
      "Sir Tristram: Absolutely nothing.", "PLAYER: Ok. Goodbye."]],
    [NPC.PELLEAS, ["Sir Pelleas: Greetings to the court of King Arthur!", "PLAYER: Any suggestions on freeing Merlin?",
      "Sir Pelleas: My best guess would be some sort of magic. Unfortunately Merlin is our magic expert.",
      "PLAYER: Ok, well, thanks anyway."]],
  ];
  for (const [id, lines] of cases) {
    const knight = h.spawn(f, id, [2766, 3513, 0]);
    clear(f);
    assert.deepEqual(await play(f, () => h.talk(f, knight)), lines);
    assert.ok(heads(f).every((head) => head === id), `${id} heads ${heads(f)}`);
  }
});

test("t630-660: Gawain names Morgan as 'She lives in her stronghold...' is continued; then his 'Hello again.' menu", async (t) => {
  const f = actor(t, { stage: S.STARTED });
  const gawain = h.spawn(f, NPC.GAWAIN, [2766, 3513, 0]);
  const said = await play(f, () => h.talk(f, gawain), ["Do you know how Merlin got trapped?", "Any idea how to get into Morgan Le Faye's stronghold?"]);
  assert.deepEqual(said.slice(0, 6), [
    "Sir Gawain: Good day to you!",
    "MENU[Select an option]: Good day.|Any ideas on how to get Merlin out of that crystal?|Do you know how Merlin got trapped?",
    "PLAYER: Do you know how Merlin got trapped?",
    "Sir Gawain: I would guess this is the work of the evil Morgan Le Faye!",
    "PLAYER: And where could I find her?",
    "Sir Gawain: She lives in her stronghold to the south of here, guarded by some renegade knights led by Sir Mordred.",
  ]);
  assert.equal(stage(f), S.GAWAIN);
  assert.deepEqual(said.slice(6), ["MENU[Select an option]: Any idea how to get into Morgan Le Faye's stronghold?|Thank you for the information.",
    "PLAYER: Any idea how to get into Morgan Le Faye's stronghold?", "Sir Gawain: No, you've got me stumped there..."]);
  h.ticks(f, 3);
  const again = await play(f, () => h.talk(f, gawain), ["Hello again."]);
  assert.deepEqual(again, [
    "Sir Gawain: Good day to you!",
    "MENU[Select an option]: Any idea how to get into Morgan Le Faye's stronghold?|Hello again.",
    "PLAYER: Hello again.",
  ]);
});

test("t731: Lancelot's 'two ways in' line moves the quest to 3 as it shows", async (t) => {
  const f = actor(t, { stage: S.GAWAIN, tile: [2760, 3513, 1] });
  const lancelot = h.spawn(f, NPC.LANCELOT, [2759, 3513, 1]);
  const said = await play(f, () => h.talk(f, lancelot), ["Any ideas on how to get into Morgan Le Faye's stronghold?"]);
  assert.equal(said[1], "MENU[Select an option]: I want to get Merlin out of the crystal.|You're a little full of yourself aren't you?|Any ideas on how to get into Morgan Le Faye's stronghold?");
  assert.equal(said.at(-1), "Sir Lancelot: There are two ways in that I know of, the large heavy front doors, and the sea entrance, only penetrable by boat. They get all their deliveries by boat from Catherby.");
  assert.equal(stage(f), S.LANCELOT);
});

test("t573-604, 1631, 1689: Pelleas keeps the keep line at stage 3; Palomedes and Gawain ask about Excalibur at 4 and 6", async (t) => {
  const f = actor(t, { stage: S.LANCELOT });
  const pelleas = h.spawn(f, NPC.PELLEAS, [2766, 3513, 0]);
  assert.equal((await play(f, () => h.talk(f, pelleas)))[1], "PLAYER: Any suggestions on getting into Mordred's fort?");
  quest().setStage(f.player, S.MORGAN);
  const palomedes = h.spawn(f, NPC.PALOMEDES, [2765, 3513, 0]);
  assert.equal((await play(f, () => h.talk(f, palomedes)))[1], "PLAYER: I'd like some advice on finding Excalibur.");
  quest().setStage(f.player, S.FREED);
  const gawain = h.spawn(f, NPC.GAWAIN, [2767, 3513, 0]);
  assert.deepEqual(await play(f, () => h.talk(f, gawain)), ["Sir Gawain: Good day to you!",
    "PLAYER: Any ideas on finding Excalibur?", "Sir Gawain: Unfortunately not, adventurer."]);
});

test("t2108-2242: after the quest the knights' own pages, Gawain's with Holy Grail not started", async (t) => {
  const f = actor(t, { stage: S.COMPLETE });
  const cases = [
    [NPC.TRISTRAM, ["Sir Tristram: Hail Arthur, King of the Britons!", "PLAYER: Um... Hello.", "Sir Tristram: Thanks for freeing Merlin.", "PLAYER: No problem. It was easy."]],
    [NPC.LUCAN, ["Sir Lucan: Hello there adventurer.", "Sir Lucan: Congratulations on freeing Merlin!"]],
    [NPC.BEDIVERE, ["Sir Bedivere: May I help you?", "Sir Bedivere: All Knights of the Round thank you for your assistance in this trying time for us."]],
  ];
  for (const [id, lines] of cases) {
    const knight = h.spawn(f, id, [2766, 3513, 0]);
    assert.deepEqual(await play(f, () => h.talk(f, knight)), lines);
  }
  const gawain = h.spawn(f, NPC.GAWAIN, [2767, 3513, 0]);
  const said = await play(f, () => h.talk(f, gawain), ["Know you of any quests sir knight?"]);
  assert.equal(said.at(-1), "Sir Gawain: I think you've done the main quest we were on right now...");
});

// --- The crate ----------------------------------------------------------------------------------

test("t854-971: the crate ride: the fade, the copy with no minimap or tabs, the boxes, then the keep and everything back", async (t) => {
  const f = actor(t, { stage: S.LANCELOT, tile: [2801, 3443, 0] });
  clear(f);
  await click(f, LOC.CRATE, [2801, 3442, 0], 2);
  assert.deepEqual(h.shown(f)?.text, "The crate is empty. It's just about big enough to hide inside.");
  await h.continueLine(f);
  await h.choose(f, "Yes.");
  assert.equal(h.shown(f)?.text, "You climb inside the crate and wait.");
  assert.deepEqual(f.animations.map((a) => a.id), [827]);
  const fades = () => f.calls.filter((c) => c.name === "mountSubInterface" && c.args[1] === 174)
    .map((c) => c.args[3]?.postScripts?.[0]?.args);
  assert.deepEqual(fades(), [[0, 255, 0, 0, 50]], "the fade out with Yes (tick 926)");
  h.ticks(f, 2);
  assert.deepEqual(fades().at(-1), [0, 0, 0, 255, 50], "the fade in with the copy (928)");
  assert.ok(f.calls.some((c) => c.name === "sendHideNpcOps" && c.args[0] === true), "NPC menus hidden (928)");
  // The copy of 2776,9848, the minimap off and cutscene_status on.
  const inside = f.player.getLocation();
  assert.ok(inside.getX() > 6400, `in a copy: ${at(f)}`);
  assert.equal(varbit(f, MINIMAP_STATE), 2);
  assert.equal(varbit(f, CUTSCENE_STATUS), 1);
  assert.equal(h.shown(f)?.text, "You climb inside the crate and wait.", "the box is still up after the copy");
  const said = await play(f, null, ["No.", "Yes."], { pace: 1 });
  assert.deepEqual(said.slice(0, 3), ["StatementDialogue: And wait...",
    "StatementDialogue: You hear voices outside the crate. Is this your crate, Arhein?",
    "StatementDialogue: Yeah, I think so. Pack it aboard soon as you can. I'm on a tight schedule for deliveries!"]);
  assert.ok(said.includes("MENU[Would you like to get back out of the crate?]: Yes.|No."), said.join("\n"));
  assert.ok(said.includes("StatementDialogue: You wait."), said.join("\n"));
  assert.equal(said.at(-1), "StatementDialogue: You climb out of the crate.");
  assert.deepEqual(at(f), [2778, 3401, 0]);
  assert.deepEqual(fades().slice(-2), [[0, 255, 0, 0, 15], [0, 0, 0, 255, 50]], "the quick fade out, then in with the box (965, 971)");
  assert.ok(f.calls.some((c) => c.name === "sendCameraReset"), "the camera back (971)");
  assert.ok(f.calls.some((c) => c.name === "sendTabInterface"), "the tabs back (971)");
  assert.equal(varbit(f, MINIMAP_STATE), 0);
  assert.equal(varbit(f, CUTSCENE_STATUS), 0);
  assert.equal(f.player.getMovementQueue().isMovementBlocked?.() ?? false, false);
  h.ticks(f, 3);
  assert.equal(h.shown(f), null);
});

test("the crate before Lancelot's tip is not for hiding in; after the quest neither (Ours)", async (t) => {
  const f = actor(t, { stage: S.GAWAIN, tile: [2801, 3443, 0] });
  await click(f, LOC.CRATE, [2801, 3442, 0], 2);
  assert.notEqual(h.shown(f)?.text, "The crate is empty. It's just about big enough to hide inside.");
});

test("a logout in the crate leaves the player by the crates", async (t) => {
  const f = actor(t, { stage: S.LANCELOT, tile: [2801, 3443, 0] });
  await click(f, LOC.CRATE, [2801, 3442, 0], 2);
  await h.continueLine(f);
  await h.choose(f, "Yes.");
  h.ticks(f, 3);
  assert.ok(f.player.getLocation().getX() > 6400);
  const g = reload(t, f);
  assert.deepEqual(at(g), [2801, 3443, 0]);
  assert.equal(stage(g), S.LANCELOT);
});

// --- Keep Le Faye -------------------------------------------------------------------------------

test("t1027-1252: the keep's stairs land where live put the player, both ways", async (t) => {
  const f = actor(t, { stage: S.LANCELOT, tile: [2770, 3403, 0] });
  await click(f, LOC.STAIRS, [2769, 3404, 0]);
  assert.deepEqual(at(f), [2769, 3407, 1]);
  f.player.setLocation(new h.core.Location(2769, 3397, 1)); h.ticks(f, 1);
  await click(f, LOC.STAIRS, [2769, 3398, 1]);
  assert.deepEqual(at(f), [2769, 3401, 2]);
  f.player.setLocation(new h.core.Location(2770, 3401, 2)); h.ticks(f, 1);
  await click(f, LOC.STAIRS_TOP, [2769, 3399, 2]);
  assert.deepEqual(at(f), [2769, 3397, 1]);
  f.player.setLocation(new h.core.Location(2769, 3407, 1)); h.ticks(f, 1);
  await click(f, LOC.STAIRS_TOP, [2769, 3405, 1]);
  assert.deepEqual(at(f), [2769, 3403, 0]);
});

test("t1254-1264: the keep's large front doors open from inside and are locked from outside", async (t) => {
  const f = actor(t, { stage: S.MORGAN, tile: [2764, 3402, 0] });
  h.ticks(f, 2);
  await click(f, LOC.KEEP_DOOR_L, [2763, 3402, 0]);
  h.ticks(f, 3);
  assert.deepEqual(at(f), [2763, 3402, 0], "walked out through the doorway (t1254)");
  assert.notEqual(h.shown(f)?.text, "The door is securely locked. You will have to find another way in.");
  h.ticks(f, 3);
  await click(f, LOC.KEEP_DOOR_L, [2763, 3402, 0]);
  assert.equal(h.shown(f)?.text, "The door is securely locked. You will have to find another way in.", "from outside (t1264)");
  assert.deepEqual(at(f), [2763, 3402, 0]);
});

/** Mordred beaten to his last hit: his hitpoints lowered, then a real hit through his HitQueue. */
async function beatMordred(f, mordred) {
  mordred.setHitpoints(5);
  landHit(f.player, mordred, 5);
  for (let i = 0; i < 6 && h.shown(f)?.who !== "Morgan Le Faye"; i++) h.tick(f);
  assert.equal(h.shown(f)?.text, "STOP! Please... spare my son.");
}

function fightActor(t, stageValue = S.LANCELOT) {
  const f = actor(t, { stage: stageValue, tile: [2769, 3402, 2] });
  f.player.getSkillManager().setMaxLevels(h.core.Skill.ATTACK, 99);
  f.player.getSkillManager().setCurrentLevel(h.core.Skill.ATTACK, 99, false);
  f.player.getSkillManager().setMaxLevels(h.core.Skill.STRENGTH, 99);
  f.player.getSkillManager().setCurrentLevel(h.core.Skill.STRENGTH, 99, false);
  f.player.setAttribute("admin:infinite-health", true);
  const mordred = h.spawn(f, NPC.MORDRED, [2769, 3403, 2]);
  return { f, mordred };
}

test("t1046-1087: Mordred's last hit brings Morgan beside him; 'No. He deserves to die.' kills him, the quest stays at 3", async (t) => {
  const { f, mordred } = fightActor(t);
  await beatMordred(f, mordred);
  const [morgan] = npcsNear(f, NPC.MORGAN, [2770, 3403, 2]);
  assert.ok(morgan, "Morgan beside Mordred");
  assert.ok(f.calls.some((c) => c.name === "sendGraphic" && c.args[0]?.id === 86), "her puff of smoke");
  assert.equal(heads(f).at(-1), NPC.MORGAN);
  assert.ok(mordred.getHitpoints() > 0 && !mordred.isDyingFunction(), "he is not dead yet");
  const deathAnims = [];
  const animate = mordred.performAnimation.bind(mordred);
  mordred.performAnimation = (animation) => { deathAnims.push(animation.getId()); return animate(animation); };
  const said = await play(f, null, ["No. He deserves to die."]);
  assert.deepEqual(said, [
    "MENU[Select an option]: Tell me how to untrap Merlin and I might.|No. He deserves to die.|Ok then.",
    "PLAYER: No. He deserves to die.",
  ]);
  assert.ok(texts(f).includes("You kill Mordred."), JSON.stringify(texts(f)));
  assert.ok(deathAnims.includes(6490), `his death animation fai_varrock_guard_death (t1087): ${deathAnims}`);
  h.ticks(f, 3);
  assert.equal(npcsNear(f, NPC.MORGAN).length, 0, "Morgan goes with his body");
  assert.equal(stage(f), S.LANCELOT);
});

test("t1145-1153: 'Ok then.' spares him: Morgan vanishes in a box, he is whole again, the quest stays at 3", async (t) => {
  const { f, mordred } = fightActor(t);
  await beatMordred(f, mordred);
  const said = await play(f, null, ["Ok then."]);
  assert.deepEqual(said.slice(-2), ["PLAYER: OK then.", "StatementDialogue: Morgan Le Faye vanishes."]);
  assert.equal(npcsNear(f, NPC.MORGAN).length, 0);
  assert.equal(mordred.getHitpoints(), mordred.getMaxHitpoints());
  assert.equal(stage(f), S.LANCELOT);
});

test("t1215-1229: 'Tell me how...': stage 4 once the ritual line is continued; the menu drops the question just asked", async (t) => {
  const { f, mordred } = fightActor(t);
  await beatMordred(f, mordred);
  const said = await play(f, null, ["Tell me how to untrap Merlin and I might.", "So where can I find Excalibur?", "What are the magic words?", "OK I will do all that."]);
  assert.equal(stage(f), S.MORGAN);
  const menus = said.filter((line) => line.startsWith("MENU"));
  assert.deepEqual(menus.slice(1), [
    "MENU[Select an option]: So where can I find Excalibur?|OK I will do all that.|What are the magic words?",
    "MENU[Select an option]: OK I will do all that.|What are the magic words?",
    "MENU[Select an option]: So where can I find Excalibur?|OK I will do all that.",
  ]);
  assert.deepEqual(said.slice(-2), ["PLAYER: Ok, I will go do all that.", "StatementDialogue: Morgan Le Faye vanishes."]);
  assert.equal(npcsNear(f, NPC.MORGAN).length, 0);
  assert.equal(mordred.getHitpoints(), mordred.getMaxHitpoints());
});

test("walking away from Morgan's plea before the ritual line: Mordred is whole again (Wiki, Sir Mordred)", async (t) => {
  const { f, mordred } = fightActor(t);
  await beatMordred(f, mordred);
  f.player.getPacketSender().sendInterfaceRemoval();
  f.player.getDialogueManager().reset?.();
  h.ticks(f, 3);
  assert.equal(mordred.getHitpoints(), mordred.getMaxHitpoints());
  assert.equal(stage(f), S.LANCELOT);
});

test("at stage 4 Mordred dies as anyone does (Ours)", async (t) => {
  const { f, mordred } = fightActor(t, S.MORGAN);
  mordred.setHitpoints(0);
  h.ticks(f, 2);
  assert.ok(mordred.isDyingFunction() || !mordred.isRegistered());
  assert.equal(npcsNear(f, NPC.MORGAN).length, 0);
});

// --- The black candle ---------------------------------------------------------------------------

test("t1338-1357: the candle maker asks for wax, the second talk swaps it for a black candle in its slot", async (t) => {
  const f = actor(t, { stage: S.MORGAN, tile: [2799, 3441, 0], items: [[I.BUCKET_OF_WAX, 1]] });
  const maker = h.spawn(f, NPC.CANDLE_MAKER, [2798, 3441, 0]);
  const first = await play(f, () => h.talk(f, maker), ["Have you got any black candles?"]);
  assert.deepEqual(first.slice(2), [
    "PLAYER: Have you got any black candles?", "Candle maker: BLACK candles???",
    "Candle maker: Hmmm. In the candle making trade, we have a tradition that it's very bad luck to make black candles.",
    "Candle maker: VERY bad luck.", "PLAYER: I will pay good money for one...", "Candle maker: I still dunno...",
    "Candle maker: Tell you what. I'll supply you with a black candle...", "Candle maker: IF you can bring me a bucket FULL of wax.",
  ]);
  const slot = slotOf(f, I.BUCKET_OF_WAX);
  const second = await play(f, () => h.talk(f, maker));
  assert.deepEqual(second, ["Candle maker: Have you got any wax yet?", "PLAYER: Yes, I have some now.",
    "StatementDialogue: You exchange the wax with the candle maker for a black candle."]);
  assert.equal(count(f, I.BUCKET_OF_WAX), 0);
  assert.equal(slotOf(f, I.BLACK_CANDLE), slot);
  // His terms again for a second candle (local 1001994 tick 17618).
  assert.equal((await play(f, () => h.talk(f, maker)))[0], "Candle maker: Hi! Would you be interested in some of my fine candles?");
});

test("t1937: a tinderbox lights the black candle in its slot, with no message", async (t) => {
  const f = actor(t, { stage: S.MORGAN, items: [[I.TINDERBOX, 1], [I.BLACK_CANDLE, 1]] });
  const slot = slotOf(f, I.BLACK_CANDLE);
  await useItems(f, I.TINDERBOX, I.BLACK_CANDLE);
  assert.equal(slotOf(f, I.LIT_BLACK_CANDLE), slot);
  assert.equal(count(f, I.BLACK_CANDLE), 0);
  assert.deepEqual(texts(f), []);
});

// --- Excalibur ----------------------------------------------------------------------------------

test("t1458-1504, 1733: the Lady's test; with the sword on the player she keeps the test to herself", async (t) => {
  const f = actor(t, { stage: S.MORGAN, tile: [2924, 3405, 0] });
  const lady = h.spawn(f, NPC.LADY, [2925, 3405, 0]);
  const said = await play(f, () => h.talk(f, lady), ["I seek the sword Excalibur."]);
  assert.equal(said[1], "MENU[Select an option]: Who are you?|Good day.|I seek the sword Excalibur.");
  assert.equal(said.at(-1), "PLAYER: Ok. That seems easy enough.");
  assert.equal(f.player.getAttribute(A.TEST), true);
  f.player.getInventory().add(new h.core.Item(I.EXCALIBUR, 1), false);
  const held = await play(f, () => h.talk(f, lady), ["Who are you?"]);
  assert.equal(held[1], "MENU[Select an option]: Who are you?|Good day.");
  // Her own page's answer (t1461).
  assert.deepEqual(held.slice(2), ["PLAYER: Who are you?", "The Lady of the Lake: I am the Lady of the Lake."]);
});

test("t1597-1642: the jeweller's door brings the beggar; bread on the second visit turns him into the Lady and wins Excalibur", async (t) => {
  const f = actor(t, { stage: S.MORGAN, tile: [3016, 3247, 0], attributes: { [A.TEST]: true } });
  let beggar = null;
  const plea = await play(f, async () => {
    await click(f, LOC.JEWELLERS_DOOR, [3016, 3246, 0]);
    [beggar] = npcsNear(f, NPC.BEGGAR, [3016, 3247, 0]);
  }, ["No I don't have any bread with me."]);
  assert.ok(beggar, "the beggar on the tile by the door");
  assert.deepEqual(plea, [
    "Beggar: Please, stranger... my family and I are starving...",
    "Beggar: Could you find it in your heart to spare me a simple loaf of bread?",
    "MENU[Select an option]: Yes certainly.|No I don't have any bread with me.",
    "PLAYER: No, I don't have any bread with me.",
    "Beggar: Well, if you get some, you know where to come.",
  ]);
  h.ticks(f, 2);
  assert.equal(npcsNear(f, NPC.BEGGAR).length, 0, "gone with the talk (t1603)");
  f.player.getInventory().add(new h.core.Item(I.BREAD, 1), false);
  await click(f, LOC.JEWELLERS_DOOR, [3016, 3246, 0]);
  h.ticks(f, 3);
  const [waiting] = npcsNear(f, NPC.BEGGAR);
  assert.ok(waiting, "he waits by the door (t1617)");
  assert.ok(f.player.getLocation().getX() >= 3016, `the player stays outside with him: ${at(f)}`);
  const breadSlot = slotOf(f, I.BREAD);
  const said = await play(f, () => h.talk(f, waiting), ["Yes, here you go."]);
  assert.deepEqual(said, [
    "Beggar: Have you got any bread for me yet?",
    "MENU[Select an option]: Yes, here you go.|No, I still have none.",
    "PLAYER: Yes, here you go.",
    "StatementDialogue: You give the bread to the beggar.",
    "Beggar: Thank you very much!",
    "StatementDialogue: The beggar has turned into the Lady of the Lake!",
    "The Lady of the Lake: Well done. You have passed my test.",
    "The Lady of the Lake: Here is Excalibur, guard it well.",
  ]);
  assert.equal(count(f, I.BREAD), 0);
  assert.equal(slotOf(f, I.EXCALIBUR), breadSlot);
  h.ticks(f, 2);
  assert.equal(npcsNear(f, NPC.LADY, [3016, 3247, 0]).length, 0);
  assert.equal(f.player.getAttribute(A.DONE), true);
  // The test is over: the door is a door again.
  clear(f);
  await click(f, LOC.JEWELLERS_DOOR, [3016, 3246, 0]);
  assert.equal(npcsNear(f, NPC.BEGGAR).length, 0);
});

test("local 1001800: bread on the first visit, 'Yes certainly.'", async (t) => {
  const f = actor(t, { stage: S.MORGAN, tile: [3016, 3247, 0], attributes: { [A.TEST]: true }, items: [[I.BREAD, 1]] });
  const said = await play(f, () => click(f, LOC.JEWELLERS_DOOR, [3016, 3246, 0]), ["Yes certainly."]);
  assert.deepEqual(said.slice(3, 6), ["PLAYER: Yes, certainly.", "StatementDialogue: You give the bread to the beggar.", "Beggar: Thank you very much!"]);
  assert.equal(count(f, I.EXCALIBUR), 1);
});

// --- The magic words and the ritual -------------------------------------------------------------

test("t1836: the chaos altar's inscription; read once its box is continued", async (t) => {
  const f = actor(t, { stage: S.MORGAN, tile: [3259, 3382, 0] });
  await click(f, LOC.ALTAR, [3259, 3381, 0], 2);
  assert.equal(h.shown(f)?.text, "You find a small inscription at the bottom of the altar. It reads: 'Snarthon Candtrick Termanto'.");
  assert.notEqual(f.player.getAttribute(A.READ), true);
  await h.continueLine(f);
  assert.equal(f.player.getAttribute(A.READ), true);
});

function ritualActor(t, { read = true, lit = true } = {}) {
  const items = [[I.BAT_BONES, 1], [lit ? I.LIT_BLACK_CANDLE : I.BLACK_CANDLE, 1], [I.EXCALIBUR, 1]];
  const f = actor(t, { stage: S.MORGAN, tile: [2780, 3515, 0], items, attributes: read ? { [A.READ]: true } : {} });
  h.ticks(f, 2); // a player who has been standing there
  return f;
}

test("t1945-1958: bat bones dropped on the symbol: the step back, Thrantax in smoke, the words, stage 5; the bones stay", async (t) => {
  const f = ritualActor(t);
  await dropItem(f, I.BAT_BONES);
  assert.equal(count(f, I.BAT_BONES), 1, "not dropped");
  h.ticks(f, 3);
  assert.deepEqual(at(f), [2778, 3515, 0]);
  const [thrantax] = npcsNear(f, NPC.THRANTAX, [2780, 3515, 0]);
  assert.ok(thrantax, "Thrantax on the symbol");
  assert.ok(f.calls.some((c) => c.name === "sendGraphic" && c.args[0]?.id === 86));
  assert.equal(h.shown(f)?.text, "Suddenly a mighty spirit appears!");
  const said = await play(f, null, ["Snarthon Candtrick Termanto"]);
  const menu = said.find((line) => line.startsWith("MENU"));
  assert.deepEqual(menu.replace(/^MENU\[[^\]]*\]: /, "").split("|").sort(),
    ["Snarthanto Candon Termtrick", "Snarthon Candtrick Termanto", "Snarthtrick Candanto Termon"]);
  assert.deepEqual(said.slice(-8, -1), [
    "PLAYER: Snarthon...", "PLAYER: Candtrick...", "PLAYER: Termanto!", "Thrantax the Mighty: GRAAAAAARGH!",
    "Thrantax the Mighty: Thou hast me in thine control. So that I mayst return from whence I came, I must grant thee a boon. What dost thou wish of me?",
    "PLAYER: I wish to free Merlin from his giant crystal!", "Thrantax the Mighty: GRAAAAAARGH!",
  ]);
  assert.equal(said.at(-1), "Thrantax the Mighty: The deed is done. Thou mayst now shatter Merlin's crystal with Excalibur, and I can once more rest. Begone! And leave me once more in peace.");
  assert.equal(stage(f), S.BOUND);
  h.ticks(f, 2);
  assert.equal(npcsNear(f, NPC.THRANTAX).length, 0);
  assert.equal(count(f, I.BAT_BONES), 1);
  assert.equal(count(f, I.LIT_BLACK_CANDLE), 1);
});

test("local 1001994 t17478-17490: the wrong words: the candle goes on his roar and he attacks", async (t) => {
  const f = ritualActor(t);
  f.player.setAttribute("admin:infinite-health", true);
  await dropItem(f, I.BAT_BONES);
  h.ticks(f, 3);
  const said = await play(f, null, ["Snarthtrick Candanto Termon"]);
  assert.deepEqual(said.slice(-4), ["PLAYER: Snarthtrick...", "PLAYER: Candato...", "PLAYER: Termon!", "Thrantax the Mighty: GRAAAAAARGH!"]);
  assert.equal(count(f, I.LIT_BLACK_CANDLE), 0);
  const [thrantax] = npcsNear(f, NPC.THRANTAX);
  assert.ok(thrantax);
  assert.equal(thrantax.getCombat().getTarget?.(), f.player);
  assert.equal(stage(f), S.MORGAN);
  h.ticks(f, 35);
  assert.equal(npcsNear(f, NPC.THRANTAX).length, 0, "gone after a while");
});

test("without the words or the lit candle: the page's lines, nothing appears", async (t) => {
  const unread = ritualActor(t, { read: false });
  await dropItem(unread, I.BAT_BONES);
  assert.equal(h.shown(unread)?.text, "I think I'd better learn the words of binding before summoning a mighty spirit...");
  assert.equal(count(unread, I.BAT_BONES), 1);
  const unlit = ritualActor(t, { lit: false });
  await dropItem(unlit, I.BAT_BONES);
  h.tick(unlit);
  assert.ok(texts(unlit).includes("You can sense a powerful presence here..."), JSON.stringify(texts(unlit)));
  assert.equal(npcsNear(unlit, NPC.THRANTAX).length, 0);
});

// --- The crystal --------------------------------------------------------------------------------

function towerActor(t, stageValue, items = []) {
  const f = actor(t, { stage: stageValue, tile: [2767, 3492, 2], items });
  return f;
}

test("t2052-2059: Smash with Excalibur wielded: the messages, stage 6, the swing, Merlin where the crystal was", async (t) => {
  const f = towerActor(t, S.BOUND);
  f.player.getEquipment().setItem(h.core.Equipment.WEAPON_SLOT, new h.core.Item(I.EXCALIBUR, 1));
  let merlin = null;
  const said = await play(f, async () => {
    await click(f, LOC.CRYSTAL, [2767, 3493, 2]);
    assert.deepEqual(texts(f).slice(0, 2), ["You attempt to smash the crystal...", "... and it shatters under the force of Excalibur!"]);
    assert.equal(stage(f), S.FREED);
    assert.ok(f.animations.some((a) => a.id === 390));
    [merlin] = npcsNear(f, NPC.MERLIN, [2767, 3493, 2]);
  });
  assert.ok(merlin, "Merlin on the crystal's tile");
  assert.deepEqual(said, [
    "Merlin: Thank you! Thank you! Thank you!",
    "Merlin: It's not fun being trapped in a giant crystal!",
    "Merlin: Go speak to King Arthur, I'm sure he'll reward you!",
    "StatementDialogue: You have set Merlin free. Now talk to King Arthur.",
  ]);
  assert.ok(heads(f).every((id) => id === NPC.MERLIN), `heads ${heads(f)}`);
  h.ticks(f, 2);
  assert.equal(npcsNear(f, NPC.MERLIN, [2767, 3493, 2]).length, 0);
});

test("Excalibur used on the crystal from the bag shatters it (the Wiki's walkthrough)", async (t) => {
  const f = towerActor(t, S.BOUND, [[I.EXCALIBUR, 1]]);
  h.ticks(f, 2);
  await useOnObject(f, LOC.CRYSTAL, [2767, 3493], I.EXCALIBUR);
  assert.ok(texts(f).includes("... and it shatters under the force of Excalibur!"), JSON.stringify(texts(f)));
  assert.equal(stage(f), S.FREED);
});

test("the crystal without the boon, without the sword, with a hammer (Wiki); after the quest 'already freed' (t2263)", async (t) => {
  const f = towerActor(t, S.MORGAN);
  f.player.getEquipment().setItem(h.core.Equipment.WEAPON_SLOT, new h.core.Item(I.EXCALIBUR, 1));
  await click(f, LOC.CRYSTAL, [2767, 3493, 2]);
  assert.deepEqual(texts(f), ["You attempt to smash the crystal...", "...but it seems to be protected by a dark force"]);
  // Smash swings the wielded weapon: Excalibur in the bag is not it.
  const bagged = towerActor(t, S.BOUND, [[I.EXCALIBUR, 1]]);
  await click(bagged, LOC.CRYSTAL, [2767, 3493, 2]);
  assert.deepEqual(texts(bagged), ["You attempt to smash the crystal...", "...but your weapon didn't do any damage at all."]);
  assert.equal(stage(bagged), S.BOUND);
  const bare = towerActor(t, S.BOUND);
  await click(bare, LOC.CRYSTAL, [2767, 3493, 2]);
  assert.deepEqual(texts(bare), ["You attempt to smash the crystal...", "...but your weapon didn't do any damage at all."]);
  const hammer = towerActor(t, S.BOUND, [[I.HAMMER, 1]]);
  await click(hammer, LOC.CRYSTAL, [2767, 3493, 2]);
  assert.deepEqual(texts(hammer), ["You attempt to smash the crystal...", "...but hammering it had absolutely no effect."]);
  const done = towerActor(t, S.COMPLETE);
  await click(done, LOC.CRYSTAL, [2767, 3493, 2]);
  assert.deepEqual(texts(done), ["You have already freed Merlin from the giant crystal."]);
});

// --- The end ------------------------------------------------------------------------------------

test("t2093-2103: King Arthur dubs the player: 6 quest points, 1,000 Firemaking XP, the scroll; once", async (t) => {
  const f = actor(t, { stage: S.FREED });
  const arthur = h.spawn(f, NPC.ARTHUR, [2766, 3513, 0]);
  const xp = f.player.getSkillManager().getExperience(h.core.Skill.FIREMAKING);
  const said = await play(f, () => h.talk(f, arthur));
  assert.deepEqual(said.slice(0, 2), ["PLAYER: I have freed Merlin from his crystal!",
    "King Arthur: Ah. A good job, well done. I dub thee a Knight Of The Round Table. You are now an honorary knight."]);
  h.ticks(f, 3);
  assert.equal(stage(f), S.COMPLETE);
  assert.equal(f.player.getSkillManager().getExperience(h.core.Skill.FIREMAKING) - xp, 1000);
  assert.ok(texts(f).some((text) => /^Congratulations, you've completed a quest: .*Merlin's Crystal/.test(text)));
  assert.deepEqual(h.QuestRuntime.rewardLines(quest(), f.player).slice(1, 4), ["6 Quest Points", "1,000 Firemaking XP", "Excalibur"]);
  const again = await play(f, () => h.talk(f, arthur), ["I am weary of questing for the time being..."]);
  assert.equal(again[0], "PLAYER: Now I am a knight of the round table, do you have any more quests for me?");
  assert.equal(f.player.getSkillManager().getExperience(h.core.Skill.FIREMAKING) - xp, 1000, "rewarded once");
});

test("t2185: Merlin's workshop door won't open after the quest with Holy Grail not started", async (t) => {
  const f = actor(t, { stage: S.COMPLETE, tile: [2764, 3502, 1] });
  await click(f, LOC.WORKSHOP_DOOR, [2764, 3503, 1]);
  assert.ok(texts(f).includes("The door won't open."), JSON.stringify(texts(f)));
});

// --- The beehive (Wiki Transcript:Beehive) ------------------------------------------------------

test("the beehive: stung without repellent; repellent then the bucket fills it, the repellent kept", async (t) => {
  const f = actor(t, { stage: S.MORGAN, tile: [2763, 3443, 0], items: [[I.BUCKET, 1], [I.INSECT_REPELLENT, 1]] });
  f.player.setAttribute("admin:infinite-health", true);
  await useOnObject(f, LOC.HIVE, [2762, 3443], I.BUCKET);
  assert.deepEqual(texts(f), ["Bees fly out of the hive and sting you!", "Maybe you can find something to drive them away briefly."]);
  clear(f);
  await useOnObject(f, LOC.HIVE, [2762, 3443], I.INSECT_REPELLENT);
  assert.equal(h.shown(f)?.text, "You pour insect repellent on the beehive. You see bees leaving the hive.");
  await h.continueLine(f);
  const bucketSlot = slotOf(f, I.BUCKET);
  const said = await play(f, () => useOnObject(f, LOC.HIVE, [2762, 3443], I.BUCKET));
  assert.deepEqual(said, ["ItemStatementDialogue: You try to get some wax from the beehive...",
    "ItemStatementDialogue: You succeed in filling your bucket! Meanwhile, the bees fly back to the hive as the repellent wears off."]);
  assert.equal(count(f, I.BUCKET_OF_WAX), 1);
  assert.equal(slotOf(f, I.BUCKET_OF_WAX), bucketSlot, "the wax in the bucket's slot");
  assert.equal(count(f, I.INSECT_REPELLENT), 1);
});

// --- Saves --------------------------------------------------------------------------------------

test("the stage and the quest's own progress survive a save and reload", async (t) => {
  const f = actor(t, { stage: S.MORGAN, attributes: { [A.READ]: true, [A.TEST]: true, [A.ASKED]: true, [A.CANDLE]: true } });
  const g = reload(t, f, [2765, 3512, 0]);
  assert.equal(stage(g), S.MORGAN);
  for (const key of [A.READ, A.TEST, A.ASKED, A.CANDLE]) assert.equal(g.player.getAttribute(key), true, key);
});

// --- Outside the quest's window, early and late -------------------------------------------------

test("before the start and outside their stages the shared NPCs keep their own pages", async (t) => {
  const f = actor(t, { stage: S.UNSTARTED });
  const lancelot = h.spawn(f, NPC.LANCELOT, [2766, 3513, 0]);
  const own = await play(f, () => h.talk(f, lancelot));
  assert.ok(own.some((line) => line.includes("I seek a quest!")), own.join("\n"));
  f.player.getPacketSender().sendInterfaceRemoval();
  h.ticks(f, 2);
  quest().setStage(f.player, S.LANCELOT);
  const lady = h.spawn(f, NPC.LADY, [2765, 3513, 0]);
  const ladySaid = await play(f, () => h.talk(f, lady), ["Good day."]);
  assert.match(ladySaid[0], /^The Lady of the Lake: Good day to you (sir|madam)\.$/, "her own page's greeting");
  quest().setStage(f.player, S.BOUND);
  const maker = h.spawn(f, NPC.CANDLE_MAKER, [2767, 3513, 0]);
  assert.notEqual((await play(f, () => h.talk(f, maker), ["No thank you."]))[2], "PLAYER: Have you got any black candles?");
});

test("early clicks: the altar's words and the symbol only from stage 4; bones dropped off the symbol fall", async (t) => {
  const f = actor(t, { stage: S.LANCELOT, tile: [3259, 3382, 0] });
  await click(f, LOC.ALTAR, [3259, 3381, 0], 2);
  assert.notEqual(h.shown(f)?.text, "You find a small inscription at the bottom of the altar. It reads: 'Snarthon Candtrick Termanto'.");
  const g = actor(t, { stage: S.LANCELOT, tile: [2780, 3515, 0], items: [[I.BAT_BONES, 1], [I.LIT_BLACK_CANDLE, 1]], attributes: { [A.READ]: true } });
  h.ticks(g, 2);
  await dropItem(g, I.BAT_BONES);
  h.ticks(g, 4);
  assert.equal(count(g, I.BAT_BONES), 0, "dropped as any item");
  assert.equal(npcsNear(g, NPC.THRANTAX).length, 0);
  const off = actor(t, { stage: S.MORGAN, tile: [2775, 3515, 0], items: [[I.BAT_BONES, 1], [I.LIT_BLACK_CANDLE, 1]], attributes: { [A.READ]: true } });
  h.ticks(off, 2);
  await dropItem(off, I.BAT_BONES);
  h.ticks(off, 4);
  assert.equal(count(off, I.BAT_BONES), 0);
  assert.equal(npcsNear(off, NPC.THRANTAX).length, 0);
});

test("a sword lost before the crystal: the Lady sets her test again and the beggar gives one Excalibur", async (t) => {
  const f = actor(t, { stage: S.BOUND, tile: [2924, 3405, 0], attributes: { [A.TEST]: true, [A.ASKED]: true, [A.DONE]: true } });
  const lady = h.spawn(f, NPC.LADY, [2925, 3405, 0]);
  const said = await play(f, () => h.talk(f, lady), ["I seek the sword Excalibur."]);
  assert.equal(said.at(-1), "PLAYER: Ok. That seems easy enough.");
  assert.equal(f.player.getAttribute(A.DONE), false);
  f.player.moveTo(new h.core.Location(3016, 3247, 0));
  h.ticks(f, 2);
  f.player.getInventory().add(new h.core.Item(I.BREAD, 1), false);
  await play(f, () => click(f, LOC.JEWELLERS_DOOR, [3016, 3246, 0]), ["Yes certainly."]);
  assert.equal(count(f, I.EXCALIBUR), 1);
  await click(f, LOC.JEWELLERS_DOOR, [3016, 3246, 0]);
  assert.equal(npcsNear(f, NPC.BEGGAR).length, 0, "no second beggar with the sword in hand");
});

test("after the quest the Lady gives a lost Excalibur back for 500 coins (Wiki, Excalibur); not one owned", async (t) => {
  const f = actor(t, { stage: S.COMPLETE, tile: [2924, 3405, 0], items: [[I.COINS, 600]] });
  const lady = h.spawn(f, NPC.LADY, [2925, 3405, 0]);
  const said = await play(f, () => h.talk(f, lady), ["I seek the sword Excalibur."]);
  assert.ok(said.includes("The Lady of the Lake: 500 gold coins ought to do it."), said.join("\n"));
  assert.equal(count(f, I.EXCALIBUR), 1);
  assert.equal(count(f, I.COINS), 100);
  const again = await play(f, () => h.talk(f, lady));
  assert.ok(!again.some((line) => line.includes("I seek the sword Excalibur.")), again.join("\n"));
  assert.equal(count(f, I.EXCALIBUR), 1);
});

test("the captured head animations: Morgan's plea chatsad1, Merlin's thanks chathap1 (ticks 1080, 2053)", async (t) => {
  const { f, mordred } = fightActor(t);
  const anims = [];
  const sender = f.player.getPacketSender();
  const original = sender.sendInterfaceAnimation.bind(sender);
  sender.sendInterfaceAnimation = (uid, animation) => { anims.push(animation); return original(uid, animation); };
  await beatMordred(f, mordred);
  assert.equal(anims.at(-1), 610);
  const g = towerActor(t, S.BOUND);
  g.player.getEquipment().setItem(h.core.Equipment.WEAPON_SLOT, new h.core.Item(I.EXCALIBUR, 1));
  const gSender = g.player.getPacketSender();
  const gOriginal = gSender.sendInterfaceAnimation.bind(gSender);
  const merlinAnims = [];
  gSender.sendInterfaceAnimation = (uid, animation) => { merlinAnims.push(animation); return gOriginal(uid, animation); };
  await click(g, LOC.CRYSTAL, [2767, 3493, 2]);
  assert.equal(merlinAnims.at(-1), 567);
});

// --- More of the page, and the ways out of each delay -------------------------------------------

test("t452, 583, 593: Lucan, Bedivere and Lancelot at stage 1", async (t) => {
  const f = actor(t, { stage: S.STARTED, tile: [2760, 3513, 1] });
  const lucan = h.spawn(f, NPC.LUCAN, [2761, 3513, 1]);
  assert.deepEqual((await play(f, () => h.talk(f, lucan))).slice(-2), [
    "Sir Lucan: The Lady of the Lake is looking after it I believe... but I know not where she resides currently.",
    "PLAYER: Thanks. I'll try and find someone who does.",
  ]);
  const bedivere = h.spawn(f, NPC.BEDIVERE, [2759, 3513, 1]);
  assert.equal((await play(f, () => h.talk(f, bedivere)))[1], "PLAYER: Merlin's in a crystal. Little help?");
  const lancelot = h.spawn(f, NPC.LANCELOT, [2760, 3514, 1]);
  const said = await play(f, () => h.talk(f, lancelot), ["I want to get Merlin out of the crystal."]);
  assert.equal(said.at(-1), "Sir Lancelot: Well, if the Knights of the Round Table can't manage it, I can't see how a commoner like you could succeed where we have failed.");
  assert.equal(stage(f), S.STARTED);
});

test("Talk-to Sir Mordred at stage 3 (Wiki): his challenge, then he attacks", async (t) => {
  const { f, mordred } = fightActor(t);
  const said = await play(f, () => h.talk(f, mordred));
  assert.deepEqual(said, ["Sir Mordred: You DARE to invade MY stronghold?!?! Have at thee knave!!!"]);
  h.ticks(f, 2);
  assert.equal(mordred.getCombat().getTarget?.(), f.player);
  assert.ok(!texts(f).includes("Sir Mordred attacks."), "the Wiki's stage direction is not a message");
});

test("a crate ride whose chat is closed puts the player back by the crates, everything restored (Ours)", async (t) => {
  const f = actor(t, { stage: S.LANCELOT, tile: [2801, 3443, 0] });
  await click(f, LOC.CRATE, [2801, 3442, 0], 2);
  await h.continueLine(f);
  await h.choose(f, "Yes.");
  h.ticks(f, 3);
  assert.ok(f.player.getLocation().getX() > 6400);
  f.player.getPacketSender().sendInterfaceRemoval();
  f.player.getDialogueManager().reset?.();
  h.ticks(f, 4);
  assert.deepEqual(at(f), [2801, 3443, 0]);
  assert.equal(varbit(f, MINIMAP_STATE), 0);
  assert.equal(varbit(f, CUTSCENE_STATUS), 0);
  assert.equal(stage(f), S.LANCELOT);
});

test("a summoning walked out of: Thrantax leaves after a while and the quest stays at 4", async (t) => {
  const f = ritualActor(t);
  await dropItem(f, I.BAT_BONES);
  h.ticks(f, 4);
  assert.equal(npcsNear(f, NPC.THRANTAX).length, 1);
  f.player.getPacketSender().sendInterfaceRemoval();
  f.player.getDialogueManager().reset?.();
  h.ticks(f, 36);
  assert.equal(npcsNear(f, NPC.THRANTAX).length, 0);
  assert.equal(stage(f), S.MORGAN);
  assert.equal(count(f, I.LIT_BLACK_CANDLE), 1, "the candle is kept");
  // He can be summoned again, from the symbol (the step back left the player two tiles west of it).
  f.player.moveTo(new h.core.Location(2780, 3515, 0));
  h.ticks(f, 2);
  await dropItem(f, I.BAT_BONES);
  h.ticks(f, 4);
  assert.equal(npcsNear(f, NPC.THRANTAX).length, 1);
});

test("Merlin goes when his box is closed early; the stage is already 6", async (t) => {
  const f = towerActor(t, S.BOUND);
  f.player.getEquipment().setItem(h.core.Equipment.WEAPON_SLOT, new h.core.Item(I.EXCALIBUR, 1));
  await click(f, LOC.CRYSTAL, [2767, 3493, 2]);
  assert.equal(npcsNear(f, NPC.MERLIN, [2767, 3493, 2]).length, 1);
  f.player.getPacketSender().sendInterfaceRemoval();
  f.player.getDialogueManager().reset?.();
  h.ticks(f, 3);
  assert.equal(npcsNear(f, NPC.MERLIN, [2767, 3493, 2]).length, 0);
  assert.equal(stage(f), S.FREED);
  const g = reload(t, f, [2767, 3492, 2]);
  assert.equal(stage(g), S.FREED);
});

test("the beggar's gift with an otherwise full inventory: Excalibur takes the bread's slot", async (t) => {
  const f = actor(t, { stage: S.MORGAN, tile: [3016, 3247, 0], attributes: { [A.TEST]: true }, items: [[I.BREAD, 1]] });
  while (f.player.getInventory().getFreeSlots() > 0) f.player.getInventory().add(new h.core.Item(I.LOGS, 1), false);
  const slot = slotOf(f, I.BREAD);
  await play(f, () => click(f, LOC.JEWELLERS_DOOR, [3016, 3246, 0]), ["Yes certainly."]);
  assert.equal(slotOf(f, I.EXCALIBUR), slot);
  assert.equal(f.player.getInventory().getFreeSlots(), 0);
});

/** A climb: the click, then ticks until the plane changes (the walk to the ladder comes first). */
async function climb(f, id, tile) {
  const z = f.player.getLocation().getZ();
  await f.connection.dispatch([{ type: "object_option", id, x: tile[0], y: tile[1], clickType: 1 }]);
  for (let i = 0; i < 25 && f.player.getLocation().getZ() === z; i++) h.tick(f);
  h.ticks(f, 2);
}

test("t495-621, 2046-2075: Camelot's tower ladders and great-hall stairs land as live", async (t) => {
  const f = actor(t, { stage: S.STARTED, tile: [2748, 3493, 0] });
  h.ticks(f, 2);
  const legs = [
    [26107, [2747, 3493, 0], [2748, 3493, 1]], [26107, [2749, 3491, 1], [2749, 3492, 2]],
    [25606, [2749, 3491, 2], [2749, 3492, 1]], [25606, [2747, 3493, 1], [2748, 3493, 0]],
  ];
  for (const [id, loc, landing] of legs) {
    await climb(f, id, loc);
    assert.deepEqual(at(f), landing, `${id} at ${loc}`);
  }
  f.player.moveTo(new h.core.Location(2751, 3508, 0));
  h.ticks(f, 2);
  await climb(f, 26106, [2750, 3509, 0]);
  assert.deepEqual(at(f), [2751, 3513, 1]);
  await climb(f, 25604, [2750, 3511, 1]);
  assert.deepEqual(at(f), [2751, 3508, 0]);
  f.player.moveTo(new h.core.Location(2768, 3493, 0));
  h.ticks(f, 2);
  for (const [id, loc, landing] of [[26107, [2769, 3493, 0], [2768, 3493, 1]], [26107, [2767, 3491, 1], [2767, 3492, 2]],
    [25606, [2767, 3491, 2], [2767, 3492, 1]], [25606, [2769, 3493, 1], [2768, 3493, 0]]]) {
    await climb(f, id, loc);
    assert.deepEqual(at(f), landing, `${id} at ${loc}`);
  }
});

test("the branches no recording took (Wiki): each answers something", async (t) => {
  const f = actor(t, { stage: S.STARTED, tile: [2760, 3513, 1] });
  const lancelot = h.spawn(f, NPC.LANCELOT, [2761, 3513, 1]);
  const full = await play(f, () => h.talk(f, lancelot), ["You're a little full of yourself aren't you?"]);
  assert.ok(full.length > 3 && full[2] === "PLAYER: You're a little full of yourself aren't you?", full.join("\n"));
  f.player.getPacketSender().sendInterfaceRemoval();
  h.ticks(f, 2);
  const g = actor(t, { stage: S.STARTED });
  const gawain = h.spawn(g, NPC.GAWAIN, [2766, 3513, 0]);
  const thanks = await play(g, () => h.talk(g, gawain), ["Do you know how Merlin got trapped?", "Thank you for the information."]);
  assert.deepEqual(thanks.slice(-2), ["PLAYER: Thank you for the information.", "Sir Gawain: It is the least I can do."]);
  const asked = await play(g, () => h.talk(g, gawain), ["Any idea how to get into Morgan Le Faye's stronghold?"]);
  assert.deepEqual(asked.slice(-2), ["PLAYER: Any idea how to get into Morgan Le Faye's stronghold?", "Sir Gawain: No, you've got me stumped there..."]);
  const m = actor(t, { stage: S.MORGAN, tile: [2799, 3441, 0] });
  const maker = h.spawn(m, NPC.CANDLE_MAKER, [2798, 3441, 0]);
  assert.deepEqual((await play(m, () => h.talk(m, maker), ["No thank you."])).slice(-1), ["PLAYER: No thank you."]);
  const b = actor(t, { stage: S.MORGAN, tile: [3016, 3247, 0], attributes: { [A.TEST]: true } });
  const none = await play(b, () => click(b, LOC.JEWELLERS_DOOR, [3016, 3246, 0]), ["Yes certainly."]);
  assert.deepEqual(none.slice(-3), ["PLAYER: Yes, certainly.", "PLAYER: ... except I don't have any bread on me at the moment...",
    "Beggar: Well, if you get some, you know where to come."]);
  assert.equal(count(b, I.EXCALIBUR), 0);
});

test("a second plea after a spared Mordred is beaten again; Morgan never on the player's tile; no fighting meanwhile", async (t) => {
  const { f, mordred } = fightActor(t);
  await beatMordred(f, mordred);
  await play(f, null, ["Ok then."]);
  assert.equal(mordred.getHitpoints(), mordred.getMaxHitpoints());
  f.player.moveTo(new h.core.Location(2770, 3403, 2));
  h.ticks(f, 2);
  clear(f);
  await beatMordred(f, mordred);
  const [morgan] = npcsNear(f, NPC.MORGAN);
  assert.ok(morgan, "she pleads again");
  assert.ok(!(morgan.getLocation().getX() === 2770 && morgan.getLocation().getY() === 3403), "not on the player's tile");
  assert.equal(mordred.getHitpoints(), 1);
  // A hit already in the air while she pleads changes nothing; the plea stays up.
  landHit(f.player, mordred, 5);
  h.ticks(f, 3);
  assert.equal(h.shown(f)?.text, "STOP! Please... spare my son.");
  assert.equal(mordred.getHitpoints(), 1);
});

test("the beggar's talk closed after the bread is given: no sword, and another loaf is needed (Wiki)", async (t) => {
  const f = actor(t, { stage: S.MORGAN, tile: [3016, 3247, 0], attributes: { [A.TEST]: true }, items: [[I.BREAD, 1]] });
  await click(f, LOC.JEWELLERS_DOOR, [3016, 3246, 0]);
  for (let i = 0; i < 30 && h.shown(f)?.text !== "Thank you very much!"; i++) {
    const line = h.shown(f);
    if (line?.who === "menu") await h.choose(f, "Yes certainly.");
    else if (line) await h.continueLine(f);
    else h.tick(f);
  }
  assert.equal(h.shown(f)?.text, "Thank you very much!");
  assert.equal(count(f, I.BREAD), 0, "the bread is gone");
  f.player.getPacketSender().sendInterfaceRemoval();
  f.player.getDialogueManager().reset?.();
  h.ticks(f, 3);
  assert.equal(count(f, I.EXCALIBUR), 0);
  assert.equal(npcsNear(f, NPC.BEGGAR).length + npcsNear(f, NPC.LADY, [3016, 3247, 0]).length, 0);
  // Back at the door: he asks again, and a new loaf wins the sword.
  f.player.getInventory().add(new h.core.Item(I.BREAD, 1), false);
  await click(f, LOC.JEWELLERS_DOOR, [3016, 3246, 0]);
  const [beggar] = npcsNear(f, NPC.BEGGAR);
  assert.ok(beggar);
  await play(f, () => h.talk(f, beggar), ["Yes, here you go."]);
  assert.equal(count(f, I.EXCALIBUR), 1);
});

test("t1967: stage 5 as Thrantax's deed line shows, so closing it there keeps the boon", async (t) => {
  const f = ritualActor(t);
  await dropItem(f, I.BAT_BONES);
  h.ticks(f, 3);
  for (let i = 0; i < 40 && !String(h.shown(f)?.text ?? "").startsWith("The deed is done."); i++) {
    const line = h.shown(f);
    if (line?.who === "menu") await h.choose(f, line.text.split("|").includes("Snarthon Candtrick Termanto") ? "Snarthon Candtrick Termanto" : line.text.split("|")[0]);
    else if (line) await h.continueLine(f);
    else h.tick(f);
  }
  assert.ok(String(h.shown(f)?.text).startsWith("The deed is done."));
  assert.equal(stage(f), S.BOUND, "before the line is continued");
  const g = reload(t, f, [2778, 3515, 0]);
  assert.equal(stage(g), S.BOUND, "a logout on the line keeps it");
});

test("one player's plea does not hold Mordred for another player", async (t) => {
  const { f, mordred } = fightActor(t);
  await beatMordred(f, mordred);
  const other = actor(t, { stage: S.LANCELOT, tile: [2768, 3403, 2] });
  assert.notEqual(h.PM.emitCanAttack(other.player, mordred), false, "the other player is not refused");
  assert.equal(h.PM.emitCanAttack(f.player, mordred), false, "the pleading player and her son don't fight");
  assert.equal(h.PM.emitCanAttack(mordred, f.player), false);
});

test("two players' pleas on one Mordred: the first ending leaves the second's hold", async (t) => {
  const { f, mordred } = fightActor(t);
  await beatMordred(f, mordred);
  const b = actor(t, { stage: S.LANCELOT, tile: [2768, 3403, 2] });
  landHit(b.player, mordred, 5);
  for (let i = 0; i < 6 && h.shown(b)?.who !== "Morgan Le Faye"; i++) h.tick(b);
  assert.equal(h.shown(b)?.text, "STOP! Please... spare my son.");
  f.player.getPacketSender().sendInterfaceRemoval();
  f.player.getDialogueManager().reset?.();
  h.ticks(f, 3);
  assert.equal(mordred.getHitpoints(), 1, "still held for the second player");
  assert.equal(h.PM.emitCanAttack(b.player, mordred), false);
  assert.notEqual(h.PM.emitCanAttack(f.player, mordred), false, "the first player's hold is gone");
});
