// Run after `yarn build`: node --test tests/family-pest.test.cjs
//
// Family Pest (revision 242 miniquest row 140) against a whole run of it on live: the user's RSProx capture
// `FamilyCrest + FamilyPest.bin` (local recording 1002252, ticks 3041-6221; docs/quests/family-pest/README.md).
// Real Player, PlayerSession and ClientConnection, the real plugins, cache and map: talks are packets and each
// tick runs as World.process does. Ticks in the test names are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const { questRowById } = require("../plugins/quests/QuestList.QuestRuntime");

const KEY = "family_pest";
const STAGE_VARBIT = 5347;
const FLAG = { caleb: 5348, avan: 5349, johnathon: 5350 };
const MINIQUESTS_COMPLETED = 14162;
const DIMINTHEIS = 4984, AVAN = 4983, CALEB = 4986, JOHNATHON = 4988;
const AT = { DIMINTHEIS: [3280, 3403], CALEB: [2818, 3448], AVAN: [3300, 3279], JOHNATHON: [3280, 3502, 1] };
const MESSAGEBOX = 229, OBJECTBOX = 193;
const TALKED = "family-pest:talked";

let I, codec;
before(async () => {
  h.key = KEY;
  await h.setup([[3280, 3403], [2818, 3448], [3300, 3279], [3280, 3502]]);
  I = h.core.ItemIdentifiers;
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
// Game messages only: a box's own text also goes to the chat (live: message_game type=mesbox).
const texts = (f) => f.messages.filter((m) => m.type === undefined && !String(m.text).includes("|")).map((m) => String(m.text))
  .filter((text) => !text.startsWith("You have unlocked a new music track"));
const clear = (f) => { f.calls.length = 0; f.messages.length = 0; f.animations.length = 0; };

function actor(t, { tile = AT.DIMINTHEIS, value = 0, talked = [], items = [], crest = true } = {}) {
  const f = h.actor(t, { at: [tile[0] + 1, tile[1], tile[2] ?? 0], stage: 0, done: crest ? ["family_crest"] : [],
    attributes: { [TALKED]: Object.fromEntries(talked.map((name) => [name, true])) } });
  quest().setStage(f.player, value);
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount ?? 1), false);
  clear(f);
  return f;
}

function shown(f) {
  const line = h.shown(f);
  if (!line) return null;
  const group = f.player.getPacketSender().getChatboxGroupId();
  if (![MESSAGEBOX, OBJECTBOX].includes(group) || line.who === "menu") return line;
  const items = f.calls.filter((c) => c.name === "sendItemOnInterfaces" && c.args[0] >> 16 === group).map((c) => c.args[1]);
  return { ...line, who: `BOX ${group}${items.length ? ` ${items.at(-1)}` : ""}` };
}

/** Plays a conversation, answering menus with `picks` and the quantity menu with `amount`; each entry with the stage then. */
async function play(f, start, picks = [], amount = 1) {
  const said = [];
  const queue = [...picks];
  const menus = new Set();
  let last = null;
  await start?.();
  for (let idle = 0, i = 0; i < 400 && idle < 6; i++) {
    const line = shown(f);
    const menu = f.player.getCreationMenu?.();
    if (!line && menu && !menus.has(menu)) {
      menus.add(menu);
      said.push({ entry: `SKILLMULTI[${menu.getTitle()}]: ${menu.getItems().join(",")} ${JSON.stringify(menu.getOptions())}`, stage: stage(f) });
      menu.execute(menu.getItems()[0], amount);
      h.tick(f);
      continue;
    }
    if (!line || line.who === "ActionDialogue") { idle++; h.tick(f); continue; }
    idle = 0;
    const key = `${line.who}|${line.text}`;
    if (key !== last) {
      said.push({ entry: line.who === "menu" ? `MENU[${line.title ?? ""}]: ${line.text}` : `${line.who}: ${line.text}`, stage: stage(f),
        flags: Object.values(FLAG).map((id) => varbit(f, id)).join("") });
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

async function talk(f, npcId, tile, picks, amount) {
  const npc = h.spawn(f, npcId, tile);
  return { npc, said: await play(f, () => h.talk(f, npc), picks, amount) };
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

test("the quest is keyed on the cache: row 140, varbit family_quest_progress, completion 3", () => {
  const row = questRowById(140, CacheDefinitions);
  assert.equal(row.displayname[0], "Family Pest");
  assert.equal(row.startnpc[0], DIMINTHEIS);
  assert.equal(row.endstate[0], 3);
  assert.deepEqual(row.requirement_quests, [48]);
  const gamevals = new Gamevals();
  const varbits = gamevals.namesOf(GamevalKind.VARBIT);
  assert.deepEqual([5347, 5348, 5349, 5350].map((id) => varbits.get(id)), ["family_quest_progress", "family_quest_caleb", "family_quest_avan", "family_quest_johnathon"]);
  assert.equal(gamevals.namesOf(GamevalKind.VARP).get(1418), "family_quest_varp");
  assert.equal(quest().varbitId, STAGE_VARBIT);
  assert.equal(quest().questPoints, 0);
});

test("t3063-3077: 'Oh come on, however menial' starts it as the player's line is continued, with no start message; the smell is a messagebox", async (t) => {
  const f = actor(t);
  const { said } = await talk(f, DIMINTHEIS, AT.DIMINTHEIS, ["Have you got any quests for me?", "Oh come on, however menial, I want to help!"]);
  assert.deepEqual(lines(said), [
    "MENU[Select an option]: Have you got any quests for me?|Other",
    "PLAYER: Do you have any quests for me? I really want one. I really want to help out!",
    `BOX ${MESSAGEBOX}: You murmur under your breath something about how great the rewards were last time you did a quest for Dimintheis.`,
    "Dimintheis: My family consider what you did for us a great service. We couldn't possibly trouble you further.",
    "PLAYER: There must be SOMETHING you need help with. I am a great adventurer after all.",
    "Dimintheis: There really isn't anything, I am very content with life right now.",
    "MENU[Select an option]: I guess money does buy happiness.|Oh come on, however menial, I want to help!",
    "PLAYER: Oh come on, surely there's something I can help out with! I want to help, however menial it is.",
    "Dimintheis: Okay okay. Fine then. Whilst I don't have anything for you, how about you try my sons, they are always wanting something done.",
    "PLAYER: Fantastic! I'll get straight to it!",
    `BOX ${MESSAGEBOX}: You smell the sweet smell of the great rewards that may soon come.`,
  ]);
  assert.equal(said[7].stage, 0);
  assert.equal(said[8].stage, 1);
  assert.equal(varbit(f, STAGE_VARBIT), 1);
  assert.deepEqual(texts(f), [], "no 'You've started a new quest' (live sends none)");
});

test("t3203-3253: Johnathon, the first son asked: the menu, his flag as his last line is continued, 'fades slightly'; asked again, his Gauntlets talk", async (t) => {
  const f = actor(t, { tile: AT.JOHNATHON, value: 1, items: [[I.STEEL_GAUNTLETS]] });
  const { said } = await talk(f, JOHNATHON, AT.JOHNATHON, ["Family Pest"]);
  assert.deepEqual(lines(said), [
    "MENU[Select an option]: Family Pest|Gauntlets",
    "PLAYER: I killed demons, I cured your poison and restored your family's honour! What can I help you with next Johnathon?",
    "Johnathon: Actually, come to think of it...",
    `BOX ${MESSAGEBOX}: Your eyes light up.`,
    "PLAYER: Yes...",
    "Johnathon: I've been having this issue. You see the lady I seek is trapped up the top of a very large tower of a very large castle, and has been for all of her life so far.",
    "Johnathon: There is but one problem, a fierce dragon circles the castle, breathing fire at anyone who dares go near.",
    `BOX ${MESSAGEBOX}: The sweet smell of the great rewards sweeps over you with incredible speed.`,
    "PLAYER: This is sounding like a great opportunity to be heroic, shall I go get her for you?",
    "Johnathon: Ha ha! You would believe anything. That was just a children's story!",
    "PLAYER: Very funny Johnathon, I can't help but laugh...",
    "PLAYER: So do you actually have any problems I can help you with?",
    "Johnathon: Everything is fantastic [player]! You adventurers really do seem to love quests, but I do not have one for you today.",
    "PLAYER: Very well, I'll go and see if your other brothers need anything...",
    `BOX ${MESSAGEBOX}: The sweet smell of the great rewards that may come fades slightly.`,
  ]);
  assert.equal(said[12].flags, "000", "caleb, avan, johnathon");
  assert.equal(said[13].flags, "001");
  assert.ok(said.every((s) => !s.npcId || s.npcId === JOHNATHON), "Johnathon's head is the multi-NPC 4988");
  clear(f);
  const again = await play(f, () => h.talk(f, f.npcs[0]), ["Gauntlets", "I shall see what options your brothers can offer me first."]);
  assert.deepEqual(lines(again).slice(0, 2), ["MENU[Select an option]: Family Pest|Gauntlets", "Johnathon: Hello again. My family now considers you a hero."]);
  assert.equal(lines(again).at(-1), "Johnathon: I doubt they will offer anything as useful as my magical boost, but as you wish.");
});

test("t3336-3365: Avan, the second son: 'fades even more'; his Gauntlets improve steel gauntlets in an objectbox", async (t) => {
  const f = actor(t, { tile: AT.AVAN, value: 1, talked: ["johnathon"], items: [[I.STEEL_GAUNTLETS]] });
  const { said } = await talk(f, AVAN, AT.AVAN, ["Family Pest"]);
  assert.deepEqual(lines(said).slice(-3), [
    "Avan: I couldn't bring myself to trouble you any further [player]. Thank you for everything, but I am content.",
    "PLAYER: Very well, I'll go and see if your other brothers need anything...",
    `BOX ${MESSAGEBOX}: The sweet smell of the great rewards that may come fades even more.`,
  ]);
  assert.equal(said.at(-2).flags, "011");
  clear(f);
  const gauntlets = await play(f, () => h.talk(f, f.npcs[0]), ["Gauntlets", "That sounds good, improve them for me."]);
  assert.equal(lines(gauntlets).at(-1), `BOX ${OBJECTBOX} ${I.GOLDSMITH_GAUNTLETS}: Avan takes your gauntlets, takes out a small hammer, and pounds them into a slightly new shape, then hands them back to you.`);
  assert.deepEqual([count(f, I.STEEL_GAUNTLETS), count(f, I.GOLDSMITH_GAUNTLETS)], [0, 1]);
});

test("t3501-3536: Caleb, the last son: 'I do one quest for you all...' and 'almost faded completely'; his paid change asks 25,000 coins", async (t) => {
  const f = actor(t, { tile: AT.CALEB, value: 1, talked: ["johnathon", "avan"], items: [[I.GOLDSMITH_GAUNTLETS]] });
  const { said } = await talk(f, CALEB, AT.CALEB, ["Family Pest"]);
  assert.deepEqual(lines(said).slice(1, 3), [
    "PLAYER: Caleb! As an adventurer, I am ready to help you with whatever you need... again! What can I help you with?",
    `BOX ${MESSAGEBOX}: You daydream briefly of what the rich family could offer you this time as a reward.`,
  ]);
  assert.deepEqual(lines(said).slice(-2), [
    "PLAYER: I do one quest for you all and it solves all of your problems? Amazing... I'll go and tell your father how happy you all are!",
    `BOX ${MESSAGEBOX}: The sweet smell of the great rewards that may come has almost faded completely.`,
  ]);
  assert.equal(said.at(-2).flags, "111");
  assert.equal(stage(f), 1, "stage 2 is Dimintheis's");
  clear(f);
  assert.deepEqual(lines(await play(f, () => h.talk(f, f.npcs[0]), ["Gauntlets", "Can you change my gauntlets for me?"])), [
    "MENU[Select an option]: Family Pest|Gauntlets",
    "Caleb: I heard you brought the completed crest to my father. I must say, that was awfully impressive work.",
    "PLAYER: It was easy really.",
    "Caleb: Yes well... Is there anything I can help you with?",
    "MENU[Select an option]: Can you change my gauntlets for me?|No thanks.",
    "PLAYER: Can you change my gauntlets for me?",
    "Caleb: Yes certainly, though it will cost you 25,000 coins.",
    "PLAYER: Oh, right.",
  ]);
});

test("t3790-3841: back at Dimintheis: stage 2 with 'I need 500,000 coins...'; Refuse; then Yes takes the coins on the pick and completes it, no message, jingle or scroll", async (t) => {
  const f = actor(t, { value: 1, talked: ["johnathon", "avan", "caleb"], items: [[I.COINS, 600000]] });
  const { said } = await talk(f, DIMINTHEIS, AT.DIMINTHEIS, ["Family Pest", "Refuse"]);
  assert.deepEqual(lines(said).slice(0, 4), [
    "MENU[Select an option]: Family Pest|Other",
    "PLAYER: I have been and spoken to Avan, Caleb and Johnathon and none of them need anything from me!",
    "Dimintheis: That is excellent news [player]. It's good to hear they are doing well.",
    `BOX ${MESSAGEBOX}: The sweet smell of great rewards is a distant memory.`,
  ]);
  const ask = said.findIndex((s) => s.entry.startsWith("Dimintheis: I need 500,000 coins."));
  assert.equal(said[ask - 1].stage, 1);
  assert.equal(said[ask].stage, 2);
  assert.deepEqual(lines(said).slice(-3), [
    "MENU[Hand Dimintheis 500,000 coins?]: Yes|Refuse",
    "PLAYER: You don't need 500,000 coins from me! I don't believe you! You can keep your rewards.",
    "Dimintheis: I will be here if you change your mind.",
  ]);
  clear(f);
  const before = varbit(f, MINIQUESTS_COMPLETED);
  const yes = await play(f, () => h.talk(f, f.npcs[0]), ["Family Pest", "Yes"]);
  assert.equal(lines(yes)[1], "Dimintheis: I need 500,000 coins. Can you help me out with that?");
  assert.deepEqual(lines(yes).slice(-3), [
    `BOX ${OBJECTBOX} ${CacheDefinitions.getObjId("coins_10000")}: You hand over 500,000 coins to Dimintheis.`,
    "Dimintheis: Thank you very much. In appreciation, I will inform Avan, Caleb and Johnathon that you did yet another great deed for the family, and that you would find more pairs of those gauntlets useful.",
    "PLAYER: Well this didn't feel very heroic...",
  ]);
  assert.equal(yes.at(-3).stage, 3, "complete as the box opens");
  assert.equal(count(f, I.COINS), 100000);
  assert.equal(varbit(f, STAGE_VARBIT), 3);
  assert.equal(varbit(f, MINIQUESTS_COMPLETED), before + 1);
  assert.deepEqual(texts(f), []);
  assert.equal(f.calls.some((c) => c.name === "sendSubInterface" && c.args.includes(153)), false, "no quest scroll");
  const g = reload(t, f);
  assert.equal(quest().getStage(g.player), 3);
  assert.deepEqual(Object.values(FLAG).map((id) => g.player.getPacketSender().getVarbit(id)), [1, 1, 1]);
});

test("the Wiki: without 500,000 coins Dimintheis's ask ends 'I don't have enough coins on me.'", async (t) => {
  const f = actor(t, { value: 2, talked: ["johnathon", "avan", "caleb"], items: [[I.COINS, 1000]] });
  const { said } = await talk(f, DIMINTHEIS, AT.DIMINTHEIS, ["Family Pest"]);
  assert.equal(lines(said).at(-1), "PLAYER: I don't have enough coins on me.");
  assert.equal(stage(f), 2);
  assert.equal(count(f, I.COINS), 1000);
});

test("t3842-3904: after it, Dimintheis's steel gauntlets: skillmulti mode 23, as many as there is room for, 1 preselected; the pairs, an objectbox, 'Here you go.'", async (t) => {
  const f = actor(t, { value: 3, items: [[I.GOLDSMITH_GAUNTLETS]] });
  const free = f.player.getInventory().getFreeSlots();
  const { said } = await talk(f, DIMINTHEIS, AT.DIMINTHEIS, ["Could I get some more gauntlets, please?", "Yes, I do want some steel gauntlets, please."], 3);
  assert.deepEqual(lines(said), [
    "PLAYER: Hello Dimintheis.",
    "Dimintheis: I will not forget what you did for my family, [player]. Those 500,000 coins have allowed us to put food on the table.",
    "PLAYER: That's no problem.",
    "MENU[Select an option]: Could I get some more gauntlets, please?|I thought these gauntlets were a family heirloom.",
    "PLAYER: Could I get some more gauntlets, please?",
    "Dimintheis: You may, but you'll have to ask my sons for them, unless you just want the plain steel gauntlets.",
    "MENU[Select an option]: Yes, I do want some steel gauntlets, please.|No thanks, I'll ask your sons instead.",
    "PLAYER: Yes, I do want some steel gauntlets, please.",
    `SKILLMULTI[How many would you like to take?]: ${I.STEEL_GAUNTLETS} {"mode":23,"maxAmount":${free},"lastAmount":1}`,
    `BOX ${OBJECTBOX} ${I.STEEL_GAUNTLETS}: Dimintheis hands you some steel gauntlets.`,
    "Dimintheis: Here you go.",
  ]);
  assert.equal(count(f, I.STEEL_GAUNTLETS), 3);
});

test("t6025-6221: a son hands out his pairs at once to a player without any (Johnathon, Caleb), and offers a menu to one with them (Avan)", async (t) => {
  const f = actor(t, { tile: AT.JOHNATHON, value: 3, items: [[I.STEEL_GAUNTLETS]] });
  const { said } = await talk(f, JOHNATHON, AT.JOHNATHON, [], 1);
  assert.deepEqual(lines(said), [
    "Johnathon: I received word from my father that you assisted us again! I get the feeling you weren't going to stop trying until you did though.",
    "Johnathon: If you want, I'll provide you with as many pairs of chaos gauntlets as you wish, to say thanks.",
    `SKILLMULTI[How many would you like to take?]: ${I.CHAOS_GAUNTLETS} {"mode":23,"maxAmount":${27},"lastAmount":1}`,
    `BOX ${OBJECTBOX} ${I.CHAOS_GAUNTLETS}: Johnathon hands you some chaos gauntlets.`,
    "Johnathon: You will find the power of bolt spells increases substantially whilst wearing these gauntlets.",
    "PLAYER: Thank you.",
  ]);
  assert.equal(count(f, I.CHAOS_GAUNTLETS), 1);
  const g = actor(t, { tile: AT.AVAN, value: 3, items: [[I.GOLDSMITH_GAUNTLETS]] });
  const avan = await talk(g, AVAN, AT.AVAN, ["Could I have some more goldsmith gauntlets, please?"], 2);
  assert.deepEqual(lines(avan.said).slice(0, 3), [
    "Avan: I received word from my father that you assisted us again! I get the feeling you weren't going to stop trying until you did though.",
    "MENU[Select an option]: Could I have some more goldsmith gauntlets, please?|You're welcome.",
    "PLAYER: Could I have some more goldsmith gauntlets, please?",
  ]);
  assert.equal(lines(avan.said).at(-2), "Avan: You will find the rate you gain experience when smelting gold much improved whilst wearing these gauntlets.");
  assert.equal(g.player.getInventory().getAmount(I.GOLDSMITH_GAUNTLETS), 3);
});

test("the Wiki: asked again, a son's 'Family Pest' is his short refusal; Dimintheis before all three asks after them", async (t) => {
  const f = actor(t, { tile: AT.JOHNATHON, value: 1, talked: ["johnathon"] });
  assert.deepEqual(lines((await talk(f, JOHNATHON, AT.JOHNATHON, ["Family Pest"])).said), [
    "MENU[Select an option]: Family Pest|Gauntlets",
    "PLAYER: Are you sure there's nothing I can do, perhaps even teach you about Death Rune magicks, where your skills do not live up to mine.",
    "Johnathon: I find that very insulting [player]. You do not need to remind me of your superior skills. Leave me be.",
  ]);
  const g = actor(t, { value: 1, talked: ["johnathon"] });
  assert.deepEqual(lines((await talk(g, DIMINTHEIS, AT.DIMINTHEIS, ["Family Pest"])).said), [
    "MENU[Select an option]: Family Pest|Other",
    "Dimintheis: Have you spoke to Avan, Caleb and Johnathon yet?",
    "PLAYER: Nope, not yet!",
  ]);
  assert.equal(stage(g), 1);
});
