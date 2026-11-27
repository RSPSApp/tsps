// Run after `yarn build`: node --test tests/family-crest-capture.test.cjs
//
// Family Crest against two whole runs of the quest on live, revision 242: the user's RSProx captures
// `FamilyCrest + FamilyPest.bin` (local recording 1002252) and local recording 1002185 (B below);
// docs/quests/family-crest/README.md. Real Player, PlayerSession and ClientConnection, the real plugins,
// cache and map: talks, clicks and item uses are packets and each tick runs as World.process does.
// Ticks in the test names are 1002252's unless marked B.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const { HitQueue } = require("../dist/game/content/combat/hit/HitQueue");

const KEY = "family_crest";
const VARP = 148;
const S = { UNSTARTED: 0, DIMINTHEIS: 1, CALEB: 2, CALEB_PIECE: 3, SEEKING_AVAN: 4, GEM_TRADER: 5, AVAN: 6, BOOT: 7, AVAN_PIECE: 8,
  JOHNATHON: 9, CURED: 10, COMPLETE: 11 };
const DIMINTHEIS = 4984, AVAN = 4983, CALEB = 4986, JOHNATHON = 4988, BOOT = 4985, GEM_TRADER = 2874, CHRONOZON = 4987;
const AT = { DIMINTHEIS: [3280, 3403], CALEB: [2818, 3448], AVAN: [3300, 3279], GEM: [3286, 3213], BOOT: [2980, 9808],
  JOHNATHON: [3280, 3502, 1], CHRONOZON: [3089, 9934] };
const MESSAGEBOX = 229, OBJECTBOX = 193, OBJECTBOX_DOUBLE = 11;

let I, codec;
before(async () => {
  h.key = KEY;
  await h.setup([[3280, 3403], [2818, 3448], [3300, 3279], [3286, 3213], [2980, 9808], [3280, 3502], [2722, 9690], [3089, 9934], [3272, 3185]]);
  I = h.core.ItemIdentifiers;
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => h.teardown());

const quest = (key = KEY) => h.quest(key);
const stage = (f) => quest().getStage(f.player);
const count = (f, id) => f.player.getInventory().getAmount(id);
// Game messages only: a box's own text also goes to the chat (live: message_game type=mesbox).
const texts = (f) => f.messages.filter((m) => m.type === undefined && !String(m.text).includes("|")).map((m) => String(m.text))
  .filter((text) => !text.startsWith("You have unlocked a new music track"));
const heads = (f) => [...new Set(f.calls.filter((c) => c.name === "sendNpcHeadOnInterface").map((c) => c.args[0]))];
const sounds = (f) => f.calls.filter((c) => c.name === "sendSoundEffect").map((c) => c.args[0]);
const clear = (f) => { f.calls.length = 0; f.messages.length = 0; f.animations.length = 0; };

function actor(t, { tile = AT.DIMINTHEIS, value = 0, items = [], level = 70, pest } = {}) {
  const f = h.actor(t, { at: [tile[0] + 1, tile[1], tile[2] ?? 0], stage: value, done: [] });
  const skills = f.player.getSkillManager();
  for (const skill of [h.core.Skill.MAGIC, h.core.Skill.MINING, h.core.Skill.SMITHING, h.core.Skill.CRAFTING]) {
    skills.setMaxLevels(skill, level);
    skills.setCurrentLevel(skill, level, false);
  }
  if (pest !== undefined) quest("family_pest").setStage(f.player, pest);
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount ?? 1), false);
  clear(f);
  return f;
}

/** What the chatbox shows now: a line, a menu, or a box with its interface and item. */
function shown(f) {
  const line = h.shown(f);
  if (!line) return null;
  const group = f.player.getPacketSender().getChatboxGroupId();
  if (![MESSAGEBOX, OBJECTBOX, OBJECTBOX_DOUBLE].includes(group) || line.who === "menu") return line;
  const items = f.calls.filter((c) => c.name === "sendItemOnInterfaces" && c.args[0] >> 16 === group).map((c) => c.args[1]);
  return { ...line, who: `BOX ${group}${items.length ? ` ${items.slice(-(group === OBJECTBOX_DOUBLE ? 2 : 1)).join("+")}` : ""}` };
}

/**
 * Plays a conversation: continues every line, answers menus with `picks`, and records each entry as it is shown
 * with the stage at that moment (so a test can say on which line the stage moved).
 */
async function play(f, start, picks = []) {
  const said = [];
  const queue = [...picks];
  let last = null;
  await start?.();
  for (let idle = 0, i = 0; i < 400 && idle < 6; i++) {
    const line = shown(f);
    if (!line || line.who === "ActionDialogue") { idle++; h.tick(f); continue; }
    idle = 0;
    const key = `${line.who}|${line.text}`;
    if (key !== last) {
      said.push({ entry: line.who === "menu" ? `MENU[${line.title ?? ""}]: ${line.text}` : `${line.who}: ${line.text}`, stage: stage(f), npcId: line.npcId });
      last = key;
    }
    if (line.who === "menu") {
      if (!queue.length) break;
      await h.choose(f, queue.shift());
      last = null;
      continue;
    }
    await h.continueLine(f);
  }
  return said;
}
const lines = (said) => said.map((s) => s.entry.replace(/fairy\d+/g, "[player]"));

async function talk(f, npcId, tile, picks) {
  const npc = h.spawn(f, npcId, tile);
  return { npc, said: await play(f, () => h.talk(f, npc), picks) };
}

const slotOf = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId() === id);
async function useOnNpc(f, npc, itemId) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await f.connection.dispatch([{ type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot: slotOf(f, itemId), widgetId: 149 << 16 }]);
  for (let i = 0; i < 6 && !h.shown(f); i++) h.tick(f);
}
async function useItems(f, a, b) {
  await f.connection.dispatch([{ type: "inventory_use_on", slot: slotOf(f, a), itemId: a, target: { kind: "inventory", slot: slotOf(f, b), id: b } }]);
  f.connection.processTurnPackets();
  h.tick(f);
}

function reload(t, f) {
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.player), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  h.PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  const l = f.player.getLocation();
  const g = h.actor(t, { at: [l.getX(), l.getY(), l.getZ()], stage: 0, done: [] });
  codec.hydratePlayerSave(raw).applyToPlayer(g.player);
  h.PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername(), isNewAccount: false });
  clear(g);
  return g;
}

// --- Dimintheis and the start -------------------------------------------------------------------------

test("t157-192: 'Why would he do that?' then 'Yes.' starts the quest on the pick, before 'Ok, I will help you.'", async (t) => {
  const f = actor(t);
  const { said } = await talk(f, DIMINTHEIS, AT.DIMINTHEIS, ["Why would a nobleman live in a dump like this?", "Why would he do that?", "Yes."]);
  assert.deepEqual(lines(said), [
    "Dimintheis: Hello. My name is Dimintheis, of the noble family Fitzharmon.",
    "MENU[Select an option]: Why would a nobleman live in a dump like this?|You're rich then? Can I have some money?|Hi, I am a bold adventurer.",
    "PLAYER: Why would a nobleman live in a dump like this?",
    "Dimintheis: The King has taken my estate from me until such time as I can show my family crest to him.",
    "MENU[Select an option]: Why would he do that?|So where is this crest?",
    "PLAYER: Why would he do that?",
    "Dimintheis: Well, there is a long standing rule of chivalry amongst the Varrockian aristocracy, where each noble family is in possession of a unique crest, which signifies the honour and lineage of the family. More than this",
    "Dimintheis: however, it also represents the lawful rights of each family to prove their ownership of their wealth and lands. If the family crest is lost, then the family's estate is handed over to the current monarch until the crest is",
    "Dimintheis: restored.",
    // Live breaks after the hyphen ("much in-<br>fighting", t168), so "that" stays on this page.
    "Dimintheis: This dates back to the times when there was much in-fighting amongst the noble families and their clans, and was introduced as a way of reducing the bloodshed that was devestating the ranks of the ruling classes at that",
    "Dimintheis: time. When you captured a rival family's clan, you also captured their lands and wealth.",
    "PLAYER: So where is this crest?",
    "Dimintheis: Well, my three sons took it with them many years ago when they rode out to fight in the war against the undead necromancer and his army in the battle to save Varrock.",
    "Dimintheis: For many years I had assumed them all dead, as I had heard no word from them, but recently I heard word that my son Caleb is alive and well, and trying to earn his fortune as a great chef in the lands beyond White",
    "Dimintheis: Wolf Mountain, although I know not where.",
    "MENU[Start the Family Crest quest?]: Yes.|No.",
    "PLAYER: Ok, I will help you.",
    "Dimintheis: I thank you greatly adventurer! Also... if you find Caleb... please... let him know his father still loves him...",
  ]);
  assert.equal(said.find((s) => s.entry.includes("Ok, I will help you.")).stage, S.DIMINTHEIS);
  assert.ok(texts(f).some((m) => m.startsWith("You've started a new quest:") && m.includes("Family Crest")));
  assert.deepEqual(heads(f), [DIMINTHEIS]);
  assert.equal(f.player.getPacketSender().getConfig?.(VARP) ?? stage(f), S.DIMINTHEIS);
});

test("t120-140, t193: 'No.' leaves it unstarted; started, he repeats where Caleb is", async (t) => {
  const f = actor(t);
  const { said } = await talk(f, DIMINTHEIS, AT.DIMINTHEIS, ["Hi, I am a bold adventurer.", "Why are you so desperate for it?", "No."]);
  assert.deepEqual(lines(said).slice(-2), ["PLAYER: I'm not interested in that adventure right now.", "Dimintheis: I realise it was a lot to ask of a stranger."]);
  assert.equal(stage(f), S.UNSTARTED);
  const g = actor(t, { value: S.DIMINTHEIS });
  assert.deepEqual(lines((await talk(g, DIMINTHEIS, AT.DIMINTHEIS)).said), [
    "PLAYER: Where did you say I could find your son Caleb again?",
    "Dimintheis: The only thing I have heard of my son Caleb is that he is trying to earn his fortune as a great chef somewhere in the lands beyond White Wolf Mountain.",
  ]);
});

// --- Caleb ---------------------------------------------------------------------------------------------

test("t328-337: Caleb's chef option and answer are live's words, and his head is the multi-NPC 4986", async (t) => {
  const f = actor(t, { tile: AT.CALEB, value: S.DIMINTHEIS });
  const { said } = await talk(f, CALEB, AT.CALEB, ["I see you are a chef. Can you cook me anything?"]);
  assert.deepEqual(lines(said), [
    "Caleb: Who are you? What are you after?",
    "MENU[Select an option]: Are you Caleb Fitzharmon?|Nothing, I will be on my way.|I see you are a chef. Can you cook me anything?",
    "PLAYER: I see you are a chef. Can you cook me anything?",
    "Caleb: I would, but I am very busy. I am trying to increase my reknown as one of the world's leading chefs by preparing a special and unique fish salad.",
  ]);
  assert.deepEqual(heads(f), [CALEB]);
});

test("B7754-7760, t347-365: 'Ok, I will get those.' is stage 2 on the pick; 'Why don't you just give me the crest?' as its echo is continued", async (t) => {
  for (const pick of ["Ok, I will get those.", "Why don't you just give me the crest?"]) {
    const f = actor(t, { tile: AT.CALEB, value: S.DIMINTHEIS });
    const { said } = await talk(f, CALEB, AT.CALEB, ["Are you Caleb Fitzharmon?", "So can I have your bit?", pick]);
    assert.equal(lines(said)[4], "PLAYER: I have been sent by your father. He wishes the Fitzharmon Crest to be restored.");
    const echo = said.findIndex((s) => s.entry === `PLAYER: ${pick}`);
    assert.equal(said[echo].stage, pick.startsWith("Ok") ? S.CALEB : S.DIMINTHEIS, pick);
    assert.equal(said[echo + 1].stage, S.CALEB, pick);
    assert.equal(lines(said).at(-1), pick.startsWith("Ok")
      ? "Caleb: You will? It would help me a lot!"
      : "Caleb: It's a valuable family heirloom. I think the least you can do is prove you're worthy of it before I hand it over.");
  }
});

test("t370-383: the fish exchange is a messagebox; the fish go, piece 780 comes and stage 3 as it is continued", async (t) => {
  const fish = [I.SHRIMPS, I.SALMON, I.TUNA, I.BASS, I.SWORDFISH];
  const f = actor(t, { tile: AT.CALEB, value: S.CALEB, items: fish.map((id) => [id]) });
  const npc = h.spawn(f, CALEB, AT.CALEB);
  await h.talk(f, npc);
  await h.continueLine(f); // "How is the fish collecting going?"
  await h.continueLine(f); // "Got them all with me."
  assert.deepEqual([shown(f).who, shown(f).text], [`BOX ${MESSAGEBOX}`, "You exchange the fish for Caleb's piece of the crest."]);
  assert.equal(stage(f), S.CALEB);
  assert.ok(fish.every((id) => count(f, id) === 1), "the fish stay until the box is continued");
  await h.continueLine(f);
  assert.equal(stage(f), S.CALEB_PIECE);
  assert.ok(fish.every((id) => count(f, id) === 0));
  assert.equal(count(f, I.CREST_PART_2), 1, "caleb_crest (780)");
  assert.equal(count(f, I.CREST_PART), 0);
  const said = await play(f, null, ["Thank you very much!"]);
  assert.deepEqual(lines(said), ["MENU[Select an option]: Uh... what happened to the rest of it?|Thank you very much!", "PLAYER: Thank you very much.", "Caleb: You're welcome."]);
});

test("t385-399: after his piece Caleb's own talk; stage 4 comes with 'He said he was...'; then he asks how it goes", async (t) => {
  const f = actor(t, { tile: AT.CALEB, value: S.CALEB_PIECE, items: [[I.CREST_PART_2]] });
  const { said } = await talk(f, CALEB, AT.CALEB, ["Uh.. what happened to the rest of the crest?"]);
  assert.deepEqual(lines(said), [
    "Caleb: Hello again. I'm just putting the finishing touches to my masterful salad.",
    "MENU[Select an option]: Uh.. what happened to the rest of the crest?|Good luck with that then.",
    "PLAYER: Uh... what happened to the rest of it?",
    "Caleb: Well... my brothers and I had a slight disagreement about it... we all wanted to be heir to my fathers' lands, and we each ended up with a piece of the crest.",
    "Caleb: None of us wanted to give up our rights to our brothers, so we didn't want to give up our pieces of the crest, but none of us wanted to face our father by",
    "Caleb: returning to him with an incomplete crest... We each went our seperate ways many years past, none of us seeing our father or willing to give up our fragments.",
    "PLAYER: So do you know where I could find any of your brothers?",
    "Caleb: Well, we haven't really kept in touch... what with the dispute over the crest and all... I did hear from my brother Avan a while ago though.",
    "Caleb: He said he was on some kind of search for treasure, or gold, or something out in the desert east of Lumbridge. You might want to ask the traders there about him.",
    "Caleb: Avan always did have expensive tastes however. You may find he is not prepared to hand over his crest piece to you as easily as I have.",
  ]);
  assert.equal(said[7].stage, S.CALEB_PIECE);
  assert.equal(said[8].stage, S.SEEKING_AVAN);
  clear(f);
  assert.deepEqual(lines(await play(f, () => h.talk(f, f.npcs[0]))), [
    "PLAYER: Where did you say I could find Avan again?",
    "Caleb: Last I heard he was on some stupid hunt for gold or treasure, somewhere out in the desert east of Lumbridge. You might want to ask the traders there about him.",
    "Caleb: How are you doing getting the crest pieces?",
    "PLAYER: I am still working on it.",
    "Caleb: Then why are you wasting your time here?",
  ]);
});

// --- Avan, the Gem trader and Boot ---------------------------------------------------------------------

test("t511-581, B7980: the Man is busy until the Gem trader; stage 5 as his last line is continued", async (t) => {
  const f = actor(t, { tile: AT.AVAN, value: S.SEEKING_AVAN });
  assert.deepEqual(lines((await talk(f, AVAN, AT.AVAN)).said), ["Man: What? Can't you see I'm busy?", "PLAYER: Well, sooooorry..."]);
  assert.deepEqual(heads(f), [AVAN]);
  const g = actor(t, { tile: AT.GEM, value: S.SEEKING_AVAN });
  const npc = h.spawn(g, GEM_TRADER, AT.GEM);
  await h.talk(g, npc);
  await h.continueLine(g);
  await h.choose(g, "I'm in search of a man named Avan Fitzharmon.");
  for (let i = 0; i < 5; i++) await h.continueLine(g);
  assert.equal(shown(g).text, "Maybe we'll all get lucky and the scorpions will deal with him.");
  assert.equal(stage(g), S.SEEKING_AVAN);
  await h.continueLine(g);
  assert.equal(stage(g), S.GEM_TRADER);
});

test("t611-638: Avan's menu is live's; stage 6 as 'Unfortunately he has apparently returned...' is continued", async (t) => {
  const f = actor(t, { tile: AT.AVAN, value: S.GEM_TRADER });
  const { said } = await talk(f, AVAN, AT.AVAN, ["I'm looking for a man named Avan Fitzharmon."]);
  assert.equal(lines(said)[0], "MENU[Select an option]: Why are you hanging around in a scorpion pit?|I'm looking for a man named Avan Fitzharmon.");
  assert.equal(lines(said).at(-1), "PLAYER: Well, I'll see what I can do.");
  assert.equal(said.at(-2).stage, S.GEM_TRADER);
  assert.equal(said.at(-1).stage, S.AVAN);
  assert.ok(said.slice(1, -1).filter((s) => !s.entry.startsWith("PLAYER")).every((s) => s.entry.startsWith("Man: ")), "still 'Man'");
  assert.deepEqual(heads(f), [AVAN]);
});

test("t793-823: Boot's 'Hello short person.' ends the talk; stage 7 with the gold line; the gold answer stays on at 7", async (t) => {
  const f = actor(t, { tile: AT.BOOT, value: S.AVAN });
  assert.deepEqual(lines((await talk(f, BOOT, AT.BOOT, ["Hello short person."])).said),
    ["Boot: Hello tall person.", "MENU[Select an option]: Hello. I'm in search of very high quality gold.|Hello short person.|Why are you called boot?", "PLAYER: Hello short person."]);
  clear(f);
  const said = await play(f, () => h.talk(f, f.npcs[0]), ["Hello. I'm in search of very high quality gold."]);
  assert.equal(said[2].stage, S.AVAN);
  assert.equal(said[3].entry, "Boot: High quality gold eh? Hmmm... Well, the very best quality gold that I know of, is just East of the large city Ardougne, underground somewhere.");
  assert.equal(said[3].stage, S.BOOT);
  clear(f);
  const again = await play(f, () => h.talk(f, f.npcs[0]), ["Hello. I'm in search of very high quality gold."]);
  assert.equal(again[1].entry, "MENU[Select an option]: Hello. I'm in search of very high quality gold.|Hello short person.|Why are you called boot?");
  assert.equal(stage(f), S.BOOT);
  // No recording talks to him after stage 7: from 8 on his own page plays (no gold answer).
  const g = actor(t, { tile: AT.BOOT, value: S.AVAN_PIECE });
  assert.equal(lines((await talk(g, BOOT, AT.BOOT)).said)[1], "MENU[]: Hello short person.|Why are you called boot?".replace("MENU[]", "MENU[Select an option]"));
});

test("t1638-1654: the jewellery goes in an objectbox_double; piece 779 and stage 8 as it is continued", async (t) => {
  const f = actor(t, { tile: AT.AVAN, value: S.BOOT, items: [[I.PERFECT_RING], [I.PERFECT_NECKLACE], [I.CREST_PART_2]] });
  const npc = h.spawn(f, AVAN, AT.AVAN);
  await h.talk(f, npc);
  await h.continueLine(f);
  await h.continueLine(f);
  assert.deepEqual([shown(f).who, shown(f).text], [`BOX ${OBJECTBOX_DOUBLE} ${I.PERFECT_RING}+${I.PERFECT_NECKLACE}`, "You hand Avan the perfect gold ring and necklace."]);
  assert.equal(count(f, I.PERFECT_RING), 1);
  await h.continueLine(f);
  assert.equal(stage(f), S.AVAN_PIECE);
  assert.deepEqual([count(f, I.PERFECT_RING), count(f, I.PERFECT_NECKLACE), count(f, I.CREST_PART)], [0, 0, 1]);
  assert.equal(shown(f).text, "These... these are exquisite! EXACTLY what I was searching for all of this time! Please, take my crest fragment!");
});

// --- Johnathon and Chronozon ---------------------------------------------------------------------------

test("t2017-2055: stage 9 with the poison line, the sweat messagebox, then any antipoison cures him (potion gone, liquid sound)", async (t) => {
  const f = actor(t, { tile: AT.JOHNATHON, value: S.AVAN_PIECE, items: [[I.SUPERANTIPOISON_4_]] });
  const { npc, said } = await talk(f, JOHNATHON, AT.JOHNATHON);
  assert.deepEqual(lines(said), [
    "PLAYER: Greetings. Would you happen to be Johnathon Fitzharmon?",
    "Johnathon: That... I am...",
    "PLAYER: I am here to retrieve your fragment of the Fitzharmon family crest.",
    "Johnathon: The... poison... it is all... too much... My head... will not... stop spinning...",
    `BOX ${MESSAGEBOX}: Sweat is pouring down Johnathon's face.`,
  ]);
  assert.equal(said[2].stage, S.AVAN_PIECE);
  assert.equal(said[3].stage, S.JOHNATHON);
  assert.deepEqual(heads(f), [JOHNATHON]);
  clear(f);
  const cure = await play(f, () => useOnNpc(f, npc, I.SUPERANTIPOISON_4_), [
    "So is this Chronozon hard to defeat?", "So how did you end up getting poisoned?", "Where can I find Chronozon?", "I will be on my way now."]);
  assert.equal(stage(f), S.CURED);
  assert.equal(count(f, I.SUPERANTIPOISON_4_), 0);
  assert.ok(sounds(f).includes(2401));
  assert.deepEqual(lines(cure).slice(0, 6), [
    "Johnathon: Ooooh... thank you... Wow! That's completely cured me!",
    "Johnathon: How can I reward you?",
    "PLAYER: I've come here for your piece of the Fitzharmon family crest.",
    "Johnathon: You have? Unfortunately I don't have it any more.",
    "Johnathon: In my attempts to slay the fiendish Chronozon, the blood demon, I lost a lot of equipment in our last battle when he bested me and forced me away from his den. He probably still has it now.",
    "MENU[Select an option]: So is this Chronozon hard to defeat?|Where can I find Chronozon?|So how did you end up getting poisoned?",
  ]);
  assert.equal(lines(cure).at(-1), "Johnathon: My thanks for the assistance adventurer.");
});

function blastCast(f, chronozon, name) {
  const spell = h.core.CombatSpells.getCombatSpellByName(name);
  const widget = h.core.CacheDefinitions.getSpellByName(name);
  for (const rune of spell.itemsRequired(f.player)) f.player.getInventory().add(rune.clone(), false);
  return f.connection.dispatch([{ type: "spell_on_npc", targetIndex: chronozon.getIndex(), spellWidget: widget.widgetId, spellChild: -1, spellItemId: widget.itemId }]);
}
/** World ticks with combat in them, in World.process's order: the cycle, combat before and after movement, hits. */
function fightTicks(f, chronozon, n) {
  const { World, TaskManager } = h.core;
  const combat = f.player.getCombat();
  for (let i = 0; i < n; i++) {
    f.tick++;
    World.processCycle++;
    TaskManager.process();
    f.connection.processTurnPackets();
    combat.preMovementProcess();
    f.player.getMovementQueue().process();
    combat.postMovementProcess();
    chronozon.process();
    HitQueue.processAll(World.processCycle);
    f.player.getSession().flushClient(World.processCycle);
    f.player.resetUpdating();
  }
}
/** A hit through the target's real HitQueue: the engine's own death path runs from it. */
function landHit(attacker, target, damage) {
  const hit = new h.core.PendingHit(attacker, target, h.core.CombatFactory.MELEE_COMBAT,
    { delay: 0, damage, rollAccuracy: false, experience: false, handleAfterHitEffects: false });
  target.getCombat().getHitQueue().addPendingHit(hit, 0);
}

test("t2441-2478, t2864-2893: every Blast cast at Chronozon says 'Chronozon weakens...'; short of the four, his last hit point off, he regenerates", async (t) => {
  const f = actor(t, { tile: [3089, 9938], value: S.CURED, level: 99 });
  f.player.setHitpoints(990);
  const chronozon = h.spawn(f, CHRONOZON, AT.CHRONOZON);
  h.tick(f);
  // The Wiki: a splashed Blast doesn't count, and says nothing.
  t.mock.method(h.core.PendingHit.prototype, "isAccurate", () => false);
  clear(f);
  await blastCast(f, chronozon, "Fire Blast");
  f.connection.processTurnPackets();
  fightTicks(f, chronozon, 6);
  assert.deepEqual(texts(f).filter((m) => m.startsWith("Chronozon")), [], "a splash");
  h.core.PendingHit.prototype.isAccurate.mock.restore();
  // An accurate 0 is no hit either (the Wiki: actual damage).
  t.mock.method(h.core.PendingHit.prototype, "isAccurate", () => true);
  t.mock.method(h.core.PendingHit.prototype, "getTotalDamage", () => 0);
  clear(f);
  await blastCast(f, chronozon, "Fire Blast");
  f.connection.processTurnPackets();
  fightTicks(f, chronozon, 6);
  assert.deepEqual(texts(f).filter((m) => m.startsWith("Chronozon")), [], "an accurate 0");
  h.core.PendingHit.prototype.getTotalDamage.mock.restore();
  h.core.PendingHit.prototype.isAccurate.mock.restore();
  // Two hits that land, for real damage (the rolls are random otherwise).
  t.mock.method(h.core.PendingHit.prototype, "isAccurate", () => true);
  const damage = t.mock.method(h.core.PendingHit.prototype, "getTotalDamage", () => 10);
  for (const name of ["Wind Blast", "Water Blast"]) {
    clear(f);
    await blastCast(f, chronozon, name);
    f.connection.processTurnPackets();
    for (let i = 0; i < 8 && !texts(f).includes("Chronozon weakens..."); i++) fightTicks(f, chronozon, 1);
    assert.deepEqual(texts(f).filter((m) => m.startsWith("Chronozon")), ["Chronozon weakens..."], name);
    fightTicks(f, chronozon, 4);
  }
  h.core.PendingHit.prototype.isAccurate.mock.restore();
  damage.mock.restore();
  clear(f);
  chronozon.setHitpoints(1);
  landHit(f.player, chronozon, 5);
  fightTicks(f, chronozon, 1);
  assert.equal(chronozon.getHitpoints(), chronozon.getDefinition().getHitpoints(), "back to full");
  assert.equal(texts(f).includes("Chronozon regenerates..."), false, "the tick after (2477 -> 2478)");
  fightTicks(f, chronozon, 1);
  assert.ok(texts(f).includes("Chronozon regenerates..."));
});

test("t2910 and the Wiki: the three pieces make the crest; with two, 'You still need one more piece of the crest.'", async (t) => {
  const f = actor(t, { value: S.CURED, items: [[I.CREST_PART_2], [I.CREST_PART]] });
  await useItems(f, I.CREST_PART, I.CREST_PART_2);
  assert.deepEqual(texts(f), ["You still need one more piece of the crest."]);
  f.player.getInventory().add(new h.core.Item(I.CREST_PART_3, 1), false);
  clear(f);
  await useItems(f, I.CREST_PART_3, I.CREST_PART);
  assert.deepEqual(texts(f), ["You have restored the Family Crest."]);
  assert.deepEqual([I.CREST_PART, I.CREST_PART_2, I.CREST_PART_3, I.FAMILY_CREST].map((id) => count(f, id)), [0, 0, 0, 1]);
});

// --- The hand-in and after ----------------------------------------------------------------------------

test("t3019-3036: the crest in an objectbox, gone as it is continued; completion as the last line is continued, the scroll's lines, a save and reload", async (t) => {
  const f = actor(t, { value: S.CURED, items: [[I.FAMILY_CREST]] });
  const skills = f.player.getSkillManager();
  const xp = () => [h.core.Skill.MINING, h.core.Skill.SMITHING, h.core.Skill.CRAFTING].map((s) => skills.getExperience(s));
  const before = xp();
  const npc = h.spawn(f, DIMINTHEIS, AT.DIMINTHEIS);
  await h.talk(f, npc);
  assert.equal(shown(f).text, "I have retrieved your crest.");
  await h.continueLine(f);
  assert.deepEqual([shown(f).who, shown(f).text], [`BOX ${OBJECTBOX} ${I.FAMILY_CREST}`, "You hand the crest over to Dimintheis."]);
  assert.equal(count(f, I.FAMILY_CREST), 1);
  await h.continueLine(f);
  assert.equal(count(f, I.FAMILY_CREST), 0);
  for (let i = 0; i < 4; i++) await h.continueLine(f);
  assert.equal(shown(f).text, "They can also be granted extra powers. Take them to one of my sons, they should be able to imbue them with a skill for you.");
  assert.equal(stage(f), S.CURED);
  await h.continueLine(f);
  assert.equal(stage(f), S.COMPLETE);
  assert.equal(count(f, I.STEEL_GAUNTLETS), 1);
  assert.deepEqual(xp().map((v, i) => v - before[i]), [2000, 2000, 2000]);
  assert.ok(texts(f).some((m) => m.startsWith("Congratulations, you've completed a quest:") && m.includes("Family Crest")));
  assert.deepEqual(h.QuestRuntime.rewardLines(quest(), f.player).slice(1),
    ["1 Quest Point", "2,000 Mining XP", "2,000 Smithing XP", "2,000 Crafting XP", "Some Steel Gauntlets", "Gauntlet Skill Imbues"]);
  const g = reload(t, f);
  assert.equal(quest().getStage(g.player), S.COMPLETE);
  assert.equal(g.player.getInventory().getAmount(I.STEEL_GAUNTLETS), 1);
});

test("t3041-3062: after the quest Dimintheis's 'Other' with gauntlets held; 'Have you got any quests' with its messagebox", async (t) => {
  const f = actor(t, { value: S.COMPLETE, items: [[I.STEEL_GAUNTLETS]] });
  assert.deepEqual(lines((await talk(f, DIMINTHEIS, AT.DIMINTHEIS, ["Other"])).said), [
    "MENU[Select an option]: Have you got any quests for me?|Other",
    "Dimintheis: You have my eternal gratitude for all you have done in saving my family's honour, adventurer. Perhaps some day my sons will overcome their differences.",
    "PLAYER: Do you have any gauntlets for me?",
    "Dimintheis: No, I don't think so. You must have them yourself somewhere.",
  ]);
  clear(f);
  const quests = await play(f, () => h.talk(f, f.npcs[0]), ["Have you got any quests for me?", "I guess money does buy happiness."]);
  assert.equal(lines(quests)[2], `BOX ${MESSAGEBOX}: You murmur under your breath something about how great the rewards were last time you did a quest for Dimintheis.`);
  assert.equal(lines(quests).at(-1), "PLAYER: Nothing...");
});

test("t3798-3800 and the Wiki: holding goldsmith gauntlets he names them; with none he gives the lost pair back", async (t) => {
  const f = actor(t, { value: S.COMPLETE, items: [[I.GOLDSMITH_GAUNTLETS]] });
  assert.equal(lines((await talk(f, DIMINTHEIS, AT.DIMINTHEIS, ["Other"])).said).at(-1),
    "Dimintheis: You asked Avan to convert them into goldsmithing gauntlets, didn't you? I think you must still have them somewhere.");
  const g = actor(t, { value: S.COMPLETE });
  g.player.setAttribute("family-crest:gauntlets", I.CHAOS_GAUNTLETS);
  const { said } = await talk(g, DIMINTHEIS, AT.DIMINTHEIS, ["Other", "Yes please."]);
  assert.deepEqual(lines(said).slice(3), [
    "Dimintheis: Yes, your chaos gauntlets returned to me through their magic power recently. Would you like them back?",
    "MENU[Select an option]: Yes please.|Not right now.",
    "PLAYER: Yes please.",
    "Dimintheis: Here you go.",
    `BOX ${OBJECTBOX} ${I.CHAOS_GAUNTLETS}: Dimintheis returns your gauntlets.`,
  ]);
  assert.equal(g.player.getInventory().getAmount(I.CHAOS_GAUNTLETS), 1);
});

test("t3237-3253, t3352-3364: with steel gauntlets the sons' free imbue; Avan's objectbox shows the goldsmith gauntlets", async (t) => {
  const f = actor(t, { tile: AT.AVAN, value: S.COMPLETE, items: [[I.STEEL_GAUNTLETS]] });
  const { said } = await talk(f, AVAN, AT.AVAN, ["That sounds good, improve them for me."]);
  assert.deepEqual(lines(said), [
    "Avan: I received word from my father of your assistance to our family. You have my thanks for restoring our honour.",
    "PLAYER: Your father mentioned that you could improve these gauntlets in some way for me...",
    "Avan: Indeed I can. In my long time searching for the 'perfect' gold I learned a lot about gold items. I can improve these gauntlets so that they provide more than normal",
    "Avan: experience when smithing gold. I can easily modify these for you.",
    "MENU[Select an option]: That sounds good, improve them for me.|I think I'll check my other options with your brothers.",
    "PLAYER: That sounds good, improve them for me.",
    `BOX ${OBJECTBOX} ${I.GOLDSMITH_GAUNTLETS}: Avan takes your gauntlets, takes out a small hammer, and pounds them into a slightly new shape, then hands them back to you.`,
  ]);
  assert.deepEqual([count(f, I.STEEL_GAUNTLETS), count(f, I.GOLDSMITH_GAUNTLETS)], [0, 1]);
  assert.deepEqual(heads(f), [AVAN]);
  const g = actor(t, { tile: AT.JOHNATHON, value: S.COMPLETE, items: [[I.STEEL_GAUNTLETS]] });
  const john = await talk(g, JOHNATHON, AT.JOHNATHON, ["I shall see what options your brothers can offer me first."]);
  assert.equal(lines(john.said)[2], "Johnathon: And right he is at that. Although my skill with Death Rune magicks was not great enough to defeat Chronozon, I am adequately skilled at Chaos Rune magicks.");
  assert.equal(lines(john.said).at(-1), "Johnathon: I doubt they will offer anything as useful as my magical boost, but as you wish.");
});

// --- The Witchaven Dungeon ------------------------------------------------------------------------------

const locAt = (id, x, y, z = 0) => {
  for (const list of h.core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === z) return object;
    }
  }
  return null;
};
const INVISWALL = 38848, POSH_DOOR_OPEN = 1542;

test("t1210-1243: a locked lever door says 'This door is locked.'; with the outer lever up g2h1 swaps to inviswall and its leaf, lets the player through and is back two ticks later", async (t) => {
  const f = actor(t, { tile: [2722, 9709], value: S.BOOT });
  const D = h.core.ObjectIdentifiers;
  await h.clickObject(f, D.DOOR_77, [2723, 9711]);
  h.ticks(f, 4);
  assert.ok(texts(f).includes("This door is locked."));
  clear(f);
  await h.clickObject(f, D.LEVER_11, [2722, 9710]);
  h.ticks(f, 3);
  assert.ok(texts(f).includes("The lever is now up."));
  assert.ok(f.animations.some((a) => a.id === h.core.CacheDefinitions.getSeqId("macro_lever_switch_up")), "macro_lever_switch_up (t1217)");
  assert.ok(sounds(f).includes(2400), "synth 2400 lever");
  f.player.moveTo(new h.core.Location(2722, 9673, 0));
  h.tick(f);
  clear(f);
  await h.dispatch(f, { type: "object_option", id: D.DOOR_75, x: 2722, y: 9671, clickType: 1 });
  let opened = false;
  for (let i = 0; i < 6 && !opened; i++) { h.tick(f); opened = locAt(POSH_DOOR_OPEN, 2722, 9672) !== null; }
  assert.ok(opened, "inactiveposhdoor on 2722,9672 (t1241)");
  assert.ok(locAt(INVISWALL, 2722, 9671), "inviswall on the doorway");
  assert.ok(sounds(f).includes(62), "door_open");
  for (let i = 0; i < 4 && f.player.getLocation().getY() > 9671; i++) h.tick(f);
  assert.equal(f.player.getLocation().getY(), 9671, "the player walks onto the doorway");
  h.ticks(f, 3);
  assert.equal(locAt(POSH_DOOR_OPEN, 2722, 9672), null, "and the door is back (t1243)");
  assert.ok(locAt(D.DOOR_75, 2722, 9671));
  assert.equal(texts(f).includes("This door is locked."), false);
});

test("ours: after the quest and before Family Pest, a son's Talk-to goes straight into his gauntlets talk", async (t) => {
  const f = actor(t, { tile: AT.CALEB, value: S.COMPLETE, items: [[I.GOLDSMITH_GAUNTLETS]], pest: 0 });
  assert.deepEqual(lines((await talk(f, CALEB, AT.CALEB, ["No thanks."])).said), [
    "Caleb: I heard you brought the completed crest to my father. I must say, that was awfully impressive work.",
    "PLAYER: It was easy really.",
    "Caleb: Yes well... Is there anything I can help you with?",
    "MENU[Select an option]: Can you change my gauntlets for me?|No thanks.",
    "PLAYER: No thanks.",
  ]);
});

test("the Wiki: a lost first piece comes back from Caleb in an objectbox; one in the bank is not lost", async (t) => {
  const f = actor(t, { tile: AT.CALEB, value: S.GEM_TRADER });
  const { said } = await talk(f, CALEB, AT.CALEB, ["I have lost the piece you gave me."]);
  assert.deepEqual(lines(said).slice(-3), [
    "Caleb: I have some good news for you then. One of my customers found this on their travels and recognised it as mine and returned it to me here.",
    `BOX ${OBJECTBOX} ${I.CREST_PART_2}: Caleb hands over his crest piece to you again.`,
    "Caleb: I suggest you be less careless in the future. The crest is extremely valuable, and utterly irreplaceable.",
  ]);
  assert.equal(count(f, I.CREST_PART_2), 1);
  const g = actor(t, { tile: AT.CALEB, value: S.GEM_TRADER });
  g.player.getBank(0).add(new h.core.Item(I.CREST_PART_2, 1));
  assert.deepEqual(lines((await talk(g, CALEB, AT.CALEB)).said).slice(-2), ["PLAYER: I am still working on it.", "Caleb: Then why are you wasting your time here?"]);
});

test("the Wiki: the skills are not needed to start; below them the warning box comes before the prompt and 'Yes.' starts it", async (t) => {
  const f = actor(t, { level: 30 });
  const { said } = await talk(f, DIMINTHEIS, AT.DIMINTHEIS, ["Why would a nobleman live in a dump like this?", "So where is this crest?", "Yes."]);
  const warning = said.findIndex((s) => s.entry.startsWith(`BOX ${MESSAGEBOX}: Before starting this quest, be aware`));
  assert.ok(warning > 0, lines(said).join("\n"));
  assert.equal(said[warning + 1].entry, "MENU[Start the Family Crest quest?]: Yes.|No.");
  assert.equal(stage(f), S.DIMINTHEIS);
  assert.equal(texts(f).some((m) => m.startsWith("You need a")), false);
});

test("ours: walking away after the crest is handed over (3027) and before the last line: the next talk plays the hand-in again and completes it", async (t) => {
  const f = actor(t, { value: S.CURED, items: [[I.FAMILY_CREST]] });
  const npc = h.spawn(f, DIMINTHEIS, AT.DIMINTHEIS);
  await h.talk(f, npc);
  await h.continueLine(f);
  await h.continueLine(f); // the crest box: the crest is his now
  assert.equal(count(f, I.FAMILY_CREST), 0);
  f.player.getPacketSender().sendInterfaceRemoval();
  f.player.getDialogueManager().reset?.();
  h.ticks(f, 2);
  const g = reload(t, f);
  assert.equal(quest().getStage(g.player), S.CURED);
  const said = await play(g, () => h.talk(g, h.spawn(g, DIMINTHEIS, AT.DIMINTHEIS)));
  assert.equal(lines(said)[1], `BOX ${OBJECTBOX} ${I.FAMILY_CREST}: You hand the crest over to Dimintheis.`);
  assert.equal(quest().getStage(g.player), S.COMPLETE);
  assert.equal(g.player.getInventory().getAmount(I.STEEL_GAUNTLETS), 1);
});

test("a save from before the crest ids were put right (Caleb's piece as 779): Avan's jewellery gives 780, so the crest can be made", async (t) => {
  const f = actor(t, { tile: AT.AVAN, value: S.BOOT, items: [[I.PERFECT_RING], [I.PERFECT_NECKLACE], [I.CREST_PART]] });
  await play(f, () => h.talk(f, h.spawn(f, AVAN, AT.AVAN)));
  assert.equal(stage(f), S.AVAN_PIECE);
  assert.deepEqual([count(f, I.CREST_PART), count(f, I.CREST_PART_2)], [1, 1]);
});

// --- The perfect gold at a furnace -----------------------------------------------------------------------

const FURNACE = 24009, FURNACE_AT = [3272, 3185];

test("t1518-1536: Smelt with only 'perfect' gold ore offers the Gold bar alone; each bar is 'You smelt the gold in the furnace.' and an empty line", async (t) => {
  const f = actor(t, { tile: [3271, 3186], value: S.BOOT, items: [[I.PERFECT_GOLD_ORE], [I.PERFECT_GOLD_ORE]] });
  const menus = [];
  const sender = f.player.getPacketSender();
  const send = sender.sendCreationMenu.bind(sender);
  sender.sendCreationMenu = (menu) => { menus.push(menu); return send(menu); };
  await h.dispatch(f, { type: "object_option", id: FURNACE, x: FURNACE_AT[0], y: FURNACE_AT[1], clickType: 2 });
  for (let i = 0; i < 10 && !menus.length; i++) h.tick(f);
  assert.equal(menus.length, 1);
  assert.deepEqual(menus[0].getItems(), [I.GOLD_BAR]);
  assert.equal(menus[0].getOptions().maxAmount, 2);
  menus[0].execute(I.GOLD_BAR, 2);
  h.ticks(f, 14);
  assert.equal(count(f, I.PERFECT_GOLD_BAR), 2);
  assert.deepEqual(f.messages.map((m) => String(m.text)).filter((m) => m === "" || m.includes("smelt")),
    ["You smelt the gold in the furnace.", "", "You smelt the gold in the furnace.", ""]);
});

test("t1561-1574, B9330-9342: a 'perfect' gold bar on the furnace opens crafting_gold; its ruby necklace and ring are the 'perfect' pieces, no message", async (t) => {
  const f = actor(t, { tile: [3271, 3186], value: S.BOOT,
    items: [[I.PERFECT_GOLD_BAR], [I.PERFECT_GOLD_BAR], [I.RUBY], [I.RUBY], [I.RING_MOULD], [I.NECKLACE_MOULD]] });
  for (const [component, made, open] of [[26, I.PERFECT_NECKLACE, "smelt"], [11, I.PERFECT_RING, "use"]]) {
    if (open === "smelt") await h.dispatch(f, { type: "object_option", id: FURNACE, x: FURNACE_AT[0], y: FURNACE_AT[1], clickType: 2 });
    else await f.connection.dispatch([{ type: "item_on_object", itemId: I.PERFECT_GOLD_BAR, slot: slotOf(f, I.PERFECT_GOLD_BAR), widgetId: 149 << 16,
      objectId: FURNACE, x: FURNACE_AT[0], y: FURNACE_AT[1] }]);
    for (let i = 0; i < 10 && f.player.getInterfaceId() !== 446; i++) h.tick(f);
    assert.equal(f.player.getInterfaceId(), 446, `crafting_gold (${open})`);
    clear(f);
    h.PM.emitInterfaceActionClick({ player: f.player, buttonId: (446 << 16) | component, action: 1, handled: false });
    h.ticks(f, 4);
    assert.equal(count(f, made), 1, String(made));
    assert.deepEqual(texts(f), []);
  }
  assert.deepEqual([count(f, I.PERFECT_GOLD_BAR), count(f, I.RUBY)], [0, 0]);
});

test("t1531-1536: Smelt with a 'perfect' bar, the moulds and one 'perfect' ore still held smelts the ore at once; the gold menu waits until it is gone", async (t) => {
  const f = actor(t, { tile: [3271, 3186], value: S.BOOT,
    items: [[I.PERFECT_GOLD_BAR], [I.PERFECT_GOLD_ORE], [I.RUBY], [I.RUBY], [I.RING_MOULD], [I.NECKLACE_MOULD]] });
  const menus = [];
  const sender = f.player.getPacketSender();
  const send = sender.sendCreationMenu.bind(sender);
  sender.sendCreationMenu = (menu) => { menus.push(menu); return send(menu); };
  await h.dispatch(f, { type: "object_option", id: FURNACE, x: FURNACE_AT[0], y: FURNACE_AT[1], clickType: 2 });
  h.ticks(f, 8);
  assert.notEqual(f.player.getInterfaceId(), 446, "not the jewellery menu");
  assert.equal(menus.length, 0, "one ore left: no menu (1531-1536)");
  assert.deepEqual([count(f, I.PERFECT_GOLD_BAR), count(f, I.PERFECT_GOLD_ORE)], [2, 0]);
});

test("the Wiki ('perfect' gold bar): it makes the other gold jewellery too, without the prefix; used on the furnace it makes the 'perfect' ruby ring even with a plain gold bar carried", async (t) => {
  const f = actor(t, { tile: [3271, 3186], value: S.BOOT, items: [[I.PERFECT_GOLD_BAR], [I.SAPPHIRE], [I.RING_MOULD]] });
  await h.dispatch(f, { type: "object_option", id: FURNACE, x: FURNACE_AT[0], y: FURNACE_AT[1], clickType: 2 });
  for (let i = 0; i < 6 && f.player.getInterfaceId() !== 446; i++) h.tick(f);
  assert.equal(f.player.getInterfaceId(), 446);
  h.PM.emitInterfaceActionClick({ player: f.player, buttonId: (446 << 16) | 9, action: 1, handled: false });
  h.ticks(f, 4);
  assert.deepEqual([count(f, I.SAPPHIRE_RING), count(f, I.PERFECT_GOLD_BAR)], [1, 0]);

  const g = actor(t, { tile: [3271, 3186], value: S.BOOT, items: [[I.GOLD_BAR], [I.PERFECT_GOLD_BAR], [I.RUBY], [I.RING_MOULD]] });
  h.ticks(g, 2);
  await g.connection.dispatch([{ type: "item_on_object", itemId: I.PERFECT_GOLD_BAR, slot: slotOf(g, I.PERFECT_GOLD_BAR), widgetId: 149 << 16,
    objectId: FURNACE, x: FURNACE_AT[0], y: FURNACE_AT[1] }]);
  for (let i = 0; i < 10 && g.player.getInterfaceId() !== 446; i++) h.tick(g);
  assert.equal(g.player.getInterfaceId(), 446);
  h.PM.emitInterfaceActionClick({ player: g.player, buttonId: (446 << 16) | 11, action: 1, handled: false });
  h.ticks(g, 4);
  // The slayer ring too, from a 'perfect' bar (Ring bling unlocked).
  const k = actor(t, { tile: [3271, 3186], value: S.BOOT, level: 80, items: [[I.PERFECT_GOLD_BAR], [I.ENCHANTED_GEM], [I.RING_MOULD]] });
  k.player.getPacketSender().sendVarbit(h.core.CacheDefinitions.getVarbitId(require("../plugins/skills/data/crafting.json").gold.slayerRing.unlockVarbit), 1);
  await h.dispatch(k, { type: "object_option", id: FURNACE, x: FURNACE_AT[0], y: FURNACE_AT[1], clickType: 2 });
  for (let i = 0; i < 6 && k.player.getInterfaceId() !== 446; i++) h.tick(k);
  h.PM.emitInterfaceActionClick({ player: k.player, buttonId: (446 << 16) | require("../plugins/skills/data/crafting.json").gold.slayerRing.component, action: 1, handled: false });
  h.ticks(k, 4);
  assert.deepEqual([k.player.getInventory().getAmount(I.PERFECT_GOLD_BAR), k.player.getInventory().getAmount(I.ENCHANTED_GEM),
    k.player.getInventory().getAmount(I.SLAYER_RING_8_)], [0, 0, 1], "slayer ring made");
  assert.deepEqual([g.player.getInventory().getAmount(I.PERFECT_RING), g.player.getInventory().getAmount(I.RUBY_RING), g.player.getInventory().getAmount(I.GOLD_BAR)], [1, 0, 1]);
});

test("the Wiki: four Blasts that hit for 0 don't count; his last hit point off, he still regenerates", async (t) => {
  const f = actor(t, { tile: [3089, 9938], value: S.CURED, level: 99 });
  f.player.setHitpoints(990);
  const chronozon = h.spawn(f, CHRONOZON, AT.CHRONOZON);
  h.tick(f);
  t.mock.method(h.core.PendingHit.prototype, "isAccurate", () => true);
  t.mock.method(h.core.PendingHit.prototype, "getTotalDamage", () => 0);
  for (const name of ["Wind Blast", "Water Blast", "Earth Blast", "Fire Blast"]) {
    await blastCast(f, chronozon, name);
    f.connection.processTurnPackets();
    fightTicks(f, chronozon, 6);
  }
  h.core.PendingHit.prototype.getTotalDamage.mock.restore();
  h.core.PendingHit.prototype.isAccurate.mock.restore();
  chronozon.setHitpoints(1);
  landHit(f.player, chronozon, 5);
  fightTicks(f, chronozon, 2);
  assert.equal(chronozon.getHitpoints(), chronozon.getDefinition().getHitpoints(), "back to full");
});
