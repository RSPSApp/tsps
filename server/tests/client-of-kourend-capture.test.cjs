// Run after `yarn build`: node --test tests/client-of-kourend-capture.test.cjs
//
// Client of Kourend against the whole-quest rsprox captures (local 1001998 and 1002104, revision 242.1;
// 1001445, revision 241; docs/quests/client-of-kourend/README.md). Real Player, PlayerSession and
// ClientConnection, the real plugins, cache and map: talks and clicks are packets, each tick runs as
// World.process does. Tick numbers in the comments are 1001998's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const KEY = "client_of_kourend";
const VEOS_PROGRESS = 5619;
const SARIM_VEOS_VIS = 12148;
const VEOS = [1825, 3691, 0];
const BY_VEOS = [1824, 3691, 0];
const ALTAR_TILE = [1712, 3884, 0]; // where the capture's player activates the orb (tick 1793)
// Each store owner, the tile the capture's player talks from, and the two city questions.
const STORES = [
  ["LEENZ", [1806, 3723, 0], [1805, 3723, 0], "Port Piscarilius", ["What is it that Port Piscarilius provides for Kourend?", "What is there to do in Port Piscarilius?"]],
  ["HORACE", [1772, 3591, 0], [1770, 3589, 0], "Hosidius", ["What is it that Hosidius provides for Great Kourend?", "What is there to do in Hosidius?"]],
  ["JENNIFER", [1520, 3592, 0], [1519, 3592, 0], "Shayzien", ["What is it that Shayzien provides for Great Kourend?", "What is there to do in Shayzien?"]],
  // The Wiki's option reads "Lovakenj" (live: "Lovakengj"); the Wiki's wording is kept.
  ["MUNTY", [1549, 3751, 0], [1551, 3753, 0], "Lovakengj", ["What is it that Lovakengj provides for Great Kourend?", "What is there to do in Lovakenj?"]],
  ["REGATH", [1720, 3723, 0], [1720, 3724, 0], "Arceuus", ["So what exactly is it the people Arceuus bring to Great Kourend?", "What is there to do in Arceuus?"]],
];

let I;
let N;
before(async () => {
  await h.setup([[1825, 3691], [1806, 3723], [1772, 3591], [1520, 3592], [1549, 3751], [1720, 3723], [1712, 3884], [3054, 3246]]);
  I = h.core.ItemIdentifiers;
  N = h.core.NpcIdentifiers;
});
after(() => h.teardown());

const quest = () => h.quest(KEY);
const varbitAt = (f, id) => f.calls.filter((c) => c.name === "sendVarbit" && c.args[0] === id).map((c) => [c.tick, c.args[1]]);
const boxItems = (f, tick) => f.calls.filter((c) => c.tick === tick && c.name === "sendItemOnInterfaces").map((c) => c.args[1]);
const saidAt = (f, tick) => f.said.filter((s) => s.tick === tick).map((s) => s.text);
const slot = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId() === id);

function actor(t, { at = BY_VEOS, done = ["x_marks_the_spot"], attributes = {} } = {}) {
  const f = h.actor(t, { at, done, attributes });
  // Veos's form-specific animations, shown to this player only.
  f.specific = [];
  const sender = f.player.getPacketSender();
  for (const name of ["sendNpcAnimationSpecific", "sendNpcSpotAnimationSpecific"]) {
    const original = sender[name].bind(sender);
    sender[name] = (npc, effect, ...rest) => {
      f.specific.push({ tick: f.tick, name, id: effect.getId() });
      return original(npc, effect, ...rest);
    };
  }
  return f;
}

/** Plays a conversation: continues each line and answers a menu with the first listed pick it offers. */
async function talk(f, start, picks = [], { repeat = [] } = {}) {
  const from = f.said.length;
  const used = new Set();
  await start();
  for (let idle = 0, i = 0; i < 400 && idle < 6; i++) {
    const line = h.shown(f);
    if (!line) { idle++; h.tick(f); continue; }
    idle = 0;
    if (line.who === "menu") {
      const options = line.text.split("|");
      const pick = picks.find((p) => options.includes(p) && (!used.has(p) || repeat.includes(p)));
      if (!pick) break;
      used.add(pick);
      await h.choose(f, pick);
      continue;
    }
    await h.continueLine(f);
  }
  return f.said.slice(from);
}

async function startQuest(f, veos) {
  f.player.getInventory().add(new h.core.Item(I.FEATHER, 5), false);
  await talk(f, () => h.talk(f, veos), ["Have you got any quests for me?", "Yes."]);
  await talk(f, async () => {
    await f.connection.dispatch([{ type: "inventory_use_on", itemId: I.FEATHER, slot: slot(f, I.FEATHER), target: { kind: "inventory", slot: slot(f, I.ENCHANTED_SCROLL) } }]);
    h.tick(f);
  });
}

async function visitStores(f) {
  const seen = [];
  for (const [name, tile, stand, city, questions] of STORES) {
    f.player.moveTo(new h.core.Location(...stand));
    h.ticks(f, 2);
    const npc = h.spawn(f, N[name], tile);
    h.ticks(f, 2);
    const from = f.tick;
    const lines = await talk(f, () => h.talk(f, npc), [`Can I ask you about ${city}?`, ...questions]);
    seen.push({ name, city, questions, from, lines });
  }
  return seen;
}

test("the whole quest as the revision 242 captures play it", async (t) => {
  const f = actor(t);
  const veos = h.spawn(f, N.VEOS_7, VEOS);
  h.ticks(f, 3);

  await startQuest(f, veos);
  // Tick 348: the scroll in an item box, then the quill box with both items (401).
  const scrollBox = f.said.find((s) => s.text === "Veos hands you an enchanted scroll.");
  assert.deepEqual(boxItems(f, scrollBox.tick), [I.ENCHANTED_SCROLL]);
  const quillBox = f.said.find((s) => s.text.startsWith("You attune the feather"));
  assert.deepEqual(boxItems(f, quillBox.tick), [I.ENCHANTED_SCROLL, I.ENCHANTED_QUILL]);
  assert.equal(quest().getStage(f.player), 1);

  const stores = await visitStores(f);
  for (const { city, questions, lines } of stores) {
    const menus = lines.filter((s) => s.who === "menu" && s.text === questions.join("|"));
    // Ticks 449 and 468 (Leenz), 630/646, 848/865, 1055/1071, 1256/1289: the city's menu again
    // after the first answer, not the store's opening menu.
    assert.equal(menus.length, 2, `${city}: ${JSON.stringify(lines.map((s) => s.text))}`);
    const notes = lines.find((s) => s.text.startsWith("You jot down") || s.text.startsWith("As you jot down"));
    assert.ok(notes, city);
    if (notes.text.startsWith("You jot down")) assert.deepEqual(boxItems(f, notes.tick), [I.ENCHANTED_SCROLL, I.ENCHANTED_QUILL], city);
  }
  // Regath's answer burns the quill: the player's overhead "ARGH!" and 4341 with the scroll and quill box (tick 1304).
  const pain = f.said.find((s) => s.text.startsWith("Your quill and scroll glow"));
  assert.ok(f.animations.some((a) => a.tick === pain.tick && a.id === 4341));
  assert.deepEqual(boxItems(f, pain.tick), [I.ENCHANTED_SCROLL, I.ENCHANTED_QUILL]);
  // The fifth owner's notes are a plain box with the whisper, also sent to chat (tick 1320).
  const whisper = f.said.find((s) => s.text.startsWith("As you jot down the final information on Arceuus"));
  assert.equal(whisper.who, "StatementDialogue");
  assert.ok(f.messages.some((m) => m.text === "As you jot down the final information on Arceuus, you hear a mysterious whisper in your ear.<br>'Return to Veos...'"));
  assert.equal(quest().getStage(f.player), 2);

  // Back at Veos (ticks 1448-1522): the items go in a box, 3 with the agreement, the orb and 4 with his request.
  f.player.moveTo(new h.core.Location(...BY_VEOS));
  h.ticks(f, 2);
  await talk(f, () => h.talk(f, veos), ["Let's talk about your client..."]);
  const removed = f.said.find((s) => s.text === "Veos removes the items he gave you from your backpack.");
  assert.deepEqual(boxItems(f, removed.tick), [I.ENCHANTED_SCROLL, I.ENCHANTED_QUILL]);
  const agreed = f.said.find((s) => s.text === "Well, I don't necessarily believe I have much of a choice!");
  const handed = f.said.find((s) => s.text.startsWith("My client requires... another simple task."));
  assert.deepEqual(varbitAt(f, VEOS_PROGRESS).filter(([tick]) => tick >= agreed.tick && tick <= handed.tick), [[agreed.tick, 3], [handed.tick, 4]]);
  assert.equal(f.player.getInventory().getAmount(I.MYSTERIOUS_ORB), 1);
  assert.equal(quest().getStage(f.player), 3);

  // Tick 1793: the orb is held up as Wanted!'s crystal ball scans (2721, 454 at 92, sound 1900); two
  // ticks later it shatters into broken glass 1469 with glass_break 2127 and the whisper (1795).
  f.player.moveTo(new h.core.Location(...ALTAR_TILE));
  h.ticks(f, 2);
  const click = f.tick + 1;
  await h.dispatch(f, { type: "inventory_action", widgetId: h.core.CacheDefinitions.getComponentId("inventory:items"), itemId: I.MYSTERIOUS_ORB, slot: slot(f, I.MYSTERIOUS_ORB), option: "Activate", optionIndex: 2 });
  assert.ok(f.animations.some((a) => a.tick === click && a.id === 2721));
  assert.ok(f.calls.some((c) => c.tick === click && c.name === "sendSoundEffect" && c.args[0] === 1900));
  const orbLines = await talk(f, async () => h.ticks(f, 3));
  const shatter = orbLines.find((s) => s.text === "The orb shatters after being held in the air.");
  assert.equal(shatter.tick - click, 2);
  assert.deepEqual(boxItems(f, shatter.tick), [I.BROKEN_GLASS_2]);
  assert.ok(f.calls.some((c) => c.tick === shatter.tick && c.name === "sendSoundEffect" && c.args[0] === 2127));
  assert.ok(f.messages.some((m) => m.tick === shatter.tick && m.text === "You hear a whisper in your ear.<br>'Return... to Veos. My thanks...'"));
  // local 1001445 tick 5269: the whisper box keeps the quote in the Wiki's blue.
  assert.ok(orbLines.some((s) => s.text === "You hear a whisper in your ear. <col=000080>'Return... to Veos. My thanks...'</col>"));
  assert.deepEqual(varbitAt(f, VEOS_PROGRESS).at(-1), [shatter.tick, 5]);
  assert.equal(f.player.getInventory().getAmount(I.BROKEN_GLASS_2), 1);

  // Finishing up (ticks 2074-2127): the option said back, Veos's "ARGH!" with 6 and 4341, the shock
  // (560, 3170) on the next line, the client's head (2850) and blue words, then 7 and the scroll.
  f.player.moveTo(new h.core.Location(...BY_VEOS));
  h.ticks(f, 2);
  const finish = await talk(f, () => h.talk(f, veos), ["Let's talk about your client..."]);
  assert.deepEqual(finish.slice(2, 4).map((s) => s.text), ["Let's talk about your client...", "Veos, enough is enough! I've suffered through enough. Exploding orbs and burning quills..."]);
  const argh = finish.find((s) => s.text === "ARGH!");
  assert.ok(varbitAt(f, VEOS_PROGRESS).some(([tick, value]) => tick === argh.tick && value === 6));
  assert.ok(f.specific.some((e) => e.tick === argh.tick && e.name === "sendNpcAnimationSpecific" && e.id === 4341));
  const shock = finish[finish.indexOf(argh) + 1];
  assert.ok(f.specific.some((e) => e.tick === shock.tick && e.name === "sendNpcSpotAnimationSpecific" && e.id === 560));
  assert.ok(f.specific.some((e) => e.tick === shock.tick && e.name === "sendNpcAnimationSpecific" && e.id === 3170));
  const client = finish.filter((s) => s.who === "Veos' Client");
  assert.equal(client.length, 6);
  assert.ok(client.every((s) => s.text.startsWith("<col=000080>")), JSON.stringify(client));
  assert.ok(f.calls.some((c) => c.tick === client[0].tick && c.name === "sendNpcHeadOnInterface" && c.args[0] === N.VEOS_2));
  // "...no harm<br><col=000080>comes his way.": the colour starts each wrapped line again.
  assert.equal(client[2].text, "<col=000080>You need not fear for him. I will ensure no harm <col=000080>comes his way.</col>");
  h.ticks(f, 3);
  assert.equal(quest().isComplete(f.player), true);
  assert.equal(f.player.getPacketSender().getVarbit(VEOS_PROGRESS), 7);
  const scroll = f.calls.filter((c) => c.name === "sendString").map((c) => c.args[0]);
  for (const reward of ["1 Quest Point", "2 Antique Lamps", "Kourend Castle Teleport", "Kharedst's Memoirs"]) assert.ok(scroll.includes(reward), reward);
  assert.ok(f.calls.some((c) => c.name === "sendItemOnInterfaces" && c.args[0] === ((153 << 16) | 5) && c.args[1] === I.ENCHANTED_QUILL));
  assert.equal(f.player.getInventory().getAmount(I.ANTIQUE_LAMP_17), 2);
});

test("an agreed task with no orb yet stays 3 across a relog and Veos hands the orb over", async (t) => {
  const f = actor(t, { attributes: { "client-of-kourend:task-offered": true } });
  quest().setStage(f.player, 2);
  h.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.equal(f.player.getPacketSender().getVarbit(VEOS_PROGRESS), 3);
  // local 1001445 tick 4999: the journal asks the player to find out what the task is.
  const journal = quest().buildJournal(f.player, quest());
  assert.equal(journal.at(-1), "<col=000080>had another task for me. I should ask him what it is.");
  const veos = h.spawn(f, N.VEOS_7, VEOS);
  h.ticks(f, 2);
  await talk(f, () => h.talk(f, veos), ["Let's talk about your client...", "So what exactly is it your client now wants me to do?"]);
  assert.equal(f.player.getInventory().getAmount(I.MYSTERIOUS_ORB), 1);
  assert.equal(quest().getStage(f.player), 3);
  assert.equal(f.player.getPacketSender().getVarbit(VEOS_PROGRESS), 4);
  assert.equal(f.player.getAttribute("client-of-kourend:task-offered"), false);
});

test("the journal reads as live's for each stage", (t) => {
  const f = actor(t);
  const lines = () => quest().buildJournal(f.player, quest());
  quest().setStage(f.player, 1);
  // Tick 3798 (1001445): before the quill.
  assert.equal(lines().at(-1), "<col=000080>using a <col=800000>Feather<col=000080> on the <col=800000>Enchanted Scroll<col=000080>.");
  f.player.getInventory().add(new h.core.Item(I.ENCHANTED_QUILL, 1), false);
  f.player.setAttribute("quest.client_of_kourend.houses", 1); // Port Piscarilius (tick 4081)
  assert.deepEqual(lines().slice(-6), [
    "<col=000080>I should speak to the <col=800000>General Store Owners<col=000080> of:",
    "<col=800000>Arceuus", "<col=800000>Hosidius", "<col=800000>Lovakengj", "<str>Port Piscarilius", "<col=800000>Shayzien",
  ]);
  quest().setStage(f.player, 4);
  assert.equal(lines().at(-1), "<col=000080>what happened.");
  quest().setStage(f.player, 5);
  assert.equal(lines().at(-1), "<col=ff0000>QUEST COMPLETE!");
  assert.equal(lines().length, 22);
});

test("Port Sarim's Veos shows his travel options once Kourend has been visited", (t) => {
  // local 1001445 logs in visited and before X Marks the Spot with 4, then 2 once it is done;
  // 1001998 and 1002104 log in with 2.
  const before = actor(t, { at: [3054, 3246, 0], done: [] });
  h.PM.emitPlayerLogin({ player: before.player, username: before.player.getUsername() });
  assert.equal(before.player.getPacketSender().getVarbit(SARIM_VEOS_VIS), 3, "not yet visited: Talk-to only");
  h.PM.emitCustomEvent("ferries:arrived", { player: before.player, route: "kourend-piscarilius" });
  assert.equal(before.player.getPacketSender().getVarbit(SARIM_VEOS_VIS), 4, "the first landing adds the travel options");

  const done = actor(t, { at: [3054, 3246, 0], attributes: { "kourend:visited": true } });
  h.PM.emitPlayerLogin({ player: done.player, username: done.player.getUsername() });
  assert.equal(done.player.getPacketSender().getVarbit(SARIM_VEOS_VIS), 2);
  const npc = h.spawn(done, 1063, [3054, 3245, 0]);
  const shown = npc.getCurrentDefinition(done.player);
  assert.equal(shown.getId(), N.VEOS_5);
  assert.deepEqual(shown.getActions().filter(Boolean), ["Talk-to", "Port Piscarilius", "Land's End"]);
});
