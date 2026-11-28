// Run after `yarn build`: node --test tests/fremennik-trials-merchant.test.cjs
//
// The Fremennik Trials: Sigmund the Merchant's trading chain, as rsprox 1002236 (rev 242,
// t5891-t7941) plays it, with 1001646 (rev 241) for Sigmund's Trade refusal. Real Player, session
// and connection, the real plugins and cache; conversations start as Talk-to does
// ("npc-dialogue:start" with no variant), menus and continues are packets, ticks run like
// World.process.
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

const MERCHANT = 2;
const CHAIN = "quest.fremennik_trials.merchant_chain";
const OLD = "quest.fremennik_trials.merchant";
const TRIALS = "quest.fremennik_trials.trials";
const MENU = ["Ask about the Merchant's trial", "Ask about becoming a Fremennik"];
const RELLEKKA = [2644, 3672, 0];

let core;
let I;
let N;
let next = 7700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "fremennik_trials");

function actor(t, { chain, old, merchant = 0, items = [], stage = 2 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("merch" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...RELLEKKA));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { player, connection, tick: 0, messages: [] };
  const send = player.sendMessage.bind(player);
  player.sendMessage = (text, ...rest) => { f.messages.push(text); return send(text, ...rest); };
  t.after(() => {
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  quest().setStage(player, stage);
  player.setAttribute(TRIALS, merchant << (MERCHANT * 3));
  if (old !== undefined) player.setAttribute(OLD, old);
  if (chain !== undefined) player.setAttribute(CHAIN, chain);
  else player.setAttribute(CHAIN, -1);
  for (const [id, amount = 1] of items) player.getInventory().add(new core.Item(id, amount), false);
  tick(f);
  f.messages.length = 0;
  return f;
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
}

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", title: menu.title, options: menu.options };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  return { who: current.constructor.name, text: current.getText() };
}

async function continueLine(f) {
  // The open chatbox's own continue (npc 231, player 217, statement 229).
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 }]);
  tick(f);
}

async function choose(f, text) {
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.indexOf(text);
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

const inv = (f) => f.player.getInventory().getValidItems().map((item) => item.getId()).filter((id) => id !== I.COINS);
const asked = (f) => Number(f.player.getAttribute(CHAIN)) - 1;
const held = (f, id) => f.player.getInventory().getAmount(id) > 0;

function talk(f, npcId) {
  core.World.processCycle++;
  PM.emitCustomEvent("npc-dialogue:start", { player: f.player, npcId });
  tick(f);
}

/**
 * Talks to `npcId`, picks `option` at the chain menu (and `answers` at later menus), and plays
 * the talk to its end. Returns every shown line with the chain items held while it showed.
 */
async function converse(f, npcId, { option = MENU[0], answers = [] } = {}) {
  talk(f, npcId);
  const lines = [];
  const pending = [...answers];
  let chose = false;
  for (let i = 0; i < 80; i++) {
    const now = shown(f);
    if (!now) break;
    if (now.who === "menu") {
      if (!chose && now.options.includes(MENU[0])) {
        assert.deepEqual(now.options.slice(0, 2), MENU);
        lines.push({ menu: now.options });
        chose = true;
        await choose(f, option);
        continue;
      }
      assert.ok(pending.length, `unexpected menu ${JSON.stringify(now.options)}`);
      lines.push({ menu: now.options });
      await choose(f, pending.shift());
      continue;
    }
    lines.push({ text: now.text, items: inv(f) });
    await continueLine(f);
  }
  // A replayed offer starts a tick later; let it settle.
  return lines;
}

const texts = (lines) => lines.filter((line) => line.text).map((line) => line.text);
const lineWith = (lines, start) => {
  const found = lines.find((line) => line.text?.startsWith(start));
  assert.ok(found, `no line "${start}" in ${JSON.stringify(texts(lines))}`);
  return found;
};

test("Sigmund's Yes starts the chain and the trial", async (t) => {
  const f = actor(t, { chain: 0 });
  talk(f, N.SIGMUND_THE_MERCHANT);
  const lines = [];
  for (let i = 0; i < 40; i++) {
    const now = shown(f);
    if (!now) break;
    if (now.who === "menu") { assert.deepEqual(now.options, ["Yes", "No"]); await choose(f, "Yes"); continue; }
    lines.push(now.text);
    await continueLine(f);
  }
  assert.equal(lines[0], "Hello there!");
  assert.ok(lines.includes("Excellent! You will obtain this rare flower for me then?"), JSON.stringify(lines));
  assert.equal(lines.at(-1), "We are a very insular clan, so I would not expect you to have to leave this town to find whatever you need.");
  assert.equal(asked(f), 0);
  assert.equal((Number(f.player.getAttribute(TRIALS)) >>> (MERCHANT * 3)) & 7, 1);
});

test("the whole chain in live's order: requests, Askeladden's note, every trade on its hand-over line, the flower", async (t) => {
  const f = actor(t, { chain: 1, merchant: 1, items: [[I.COINS, 6000]] });
  const order = [
    [N.SAILOR_2, "I don't suppose you have any idea where I could find a rare flower from across the sea, do you?", "That sounds like a fair deal to me, outerlander."],
    [N.OLAF_THE_BARD, "I don't suppose you have any idea where I could find a love ballad, do you?"],
    [N.YRSA_2, "I don't suppose you have any idea where I could find some custom sturdy boots, do you?"],
    [N.BRUNDT_THE_CHIEFTAIN, "Greetings again outerlander! How goes your attempts to gain votes with the council of elders?"],
    [N.SIGLI_THE_HUNTSMAN, "Greetings outerlander."],
    [N.SKULGRIMEN, "I don't suppose you have any idea where I could find a finely balanced custom bowstring, do you?"],
    [N.FISHERMAN, "I don't suppose you have any idea where I could find an exotic and extremely rare fish, do you?"],
    [N.SWENSEN_THE_NAVIGATOR, "Hello!"],
    [N.PEER_THE_SEER, "I don't suppose you have any idea where I could find a weather forecast from the Fremennik Seer do you?"],
    [N.THORVALD_THE_WARRIOR, "I don't suppose you have any idea where I could find a brave and powerful warrior to act as a bodyguard?"],
    [N.MANNI_THE_REVELLER, "I don't suppose you have any idea where I could find a token to allow a seat at the champions table, do you?"],
    [N.THORA_THE_BARKEEP, "I don't suppose you have any idea where I could find the longhall barkeeps' legendary cocktail, do you?"],
  ];
  for (const [index, [npcId, first]] of order.entries()) {
    const lines = await converse(f, npcId);
    assert.equal(texts(lines)[0], first, `request ${index}`);
    assert.equal(asked(f), index + 1, `request ${index} recorded ${JSON.stringify(lines)}`);
  }
  // Askeladden: Yes pays 5,000 gp for the note, shown with "Done, and done." (t7220).
  const sale = await converse(f, N.ASKELADDEN, { answers: ["Yes"] });
  assert.equal(texts(sale)[0], "I don't suppose you have any idea where I could find a written promise from Askeladden to stay out of the Longhall?");
  assert.deepEqual(lineWith(sale, "Done, and done.").items, [I.PROMISSORY_NOTE]);
  assert.equal(f.player.getInventory().getAmount(I.COINS), 1000);
  assert.equal(asked(f), 13);

  // Hand-over leg: [npc, line the trade opens on, the line before it, item after].
  const trades = [
    [N.THORA_THE_BARKEEP, "Here you go, on the house!", "What?!?! I can't believe you...", I.PROMISSORY_NOTE, I.LEGENDARY_COCKTAIL],
    [N.MANNI_THE_REVELLER, "Here outerlander, you may take my token.", "...It is true!", I.LEGENDARY_COCKTAIL, I.CHAMPIONS_TOKEN],
    [N.THORVALD_THE_WARRIOR, "Here outerlander, take this contract;", "Here outerlander, I can suffer", I.CHAMPIONS_TOKEN, I.WARRIORS_CONTRACT],
    [N.PEER_THE_SEER, "You have not only persuaded one of the Fremennik", "Yeah, I know; I have one right here from Thorvald.", I.WARRIORS_CONTRACT, I.WEATHER_FORECAST],
    [N.SWENSEN_THE_NAVIGATOR, "Here, outerlander; you may take my map", "With this forecast", I.WEATHER_FORECAST, I.SEA_FISHING_MAP],
    [N.FISHERMAN, "Great work outerlander!", "Here. I got you your map.", I.SEA_FISHING_MAP, I.UNUSUAL_FISH],
    [N.SKULGRIMEN, "Ohh... That's a nice fish.", "Hi there. I got your fish", I.UNUSUAL_FISH, I.CUSTOM_BOW_STRING],
    [N.SIGLI_THE_HUNTSMAN, "Well met, outerlander.", "Here. I have your bowstring.", I.CUSTOM_BOW_STRING, I.TRACKING_MAP],
    [N.BRUNDT_THE_CHIEFTAIN, "Excellent work outerlander! And so quickly", "I got Sigli's hunting map for you.", I.TRACKING_MAP, I.FISCAL_STATEMENT],
    [N.YRSA_2, "Certainly! Let me have a look", "Hello. Can I have those boots now?", I.FISCAL_STATEMENT, I.STURDY_BOOTS],
    [N.OLAF_THE_BARD, "Oh! Superb! Those are great!", "As a matter of fact - I do!", I.STURDY_BOOTS, I.FREMENNIK_BALLAD],
    [N.SAILOR_2, "Oh. It's by Olaf?", "You'll be glad to know I have had a love song", I.FREMENNIK_BALLAD, I.EXOTIC_FLOWER],
  ];
  for (const [npcId, line, previous, from, to] of trades) {
    const lines = await converse(f, npcId);
    assert.deepEqual(lineWith(lines, previous).items, [from], `before "${line}"`);
    assert.deepEqual(lineWith(lines, line).items, [to], `on "${line}"`);
    assert.deepEqual(inv(f), [to], `after ${npcId}: one swap only`);
  }

  // Sigmund takes the flower on the player's line; no Congratulations message (t7941).
  f.messages.length = 0;
  talk(f, N.SIGMUND_THE_MERCHANT);
  assert.deepEqual(shown(f), { who: "PlayerDialogue", text: "Hello there!" });
  assert.ok(held(f, I.EXOTIC_FLOWER));
  const stage = quest().getStage(f.player);
  await continueLine(f);
  assert.deepEqual(shown(f), { who: "PlayerDialogue", text: "Here's that flower you wanted." });
  assert.equal(held(f, I.EXOTIC_FLOWER), false);
  assert.equal((Number(f.player.getAttribute(TRIALS)) >>> (MERCHANT * 3)) & 7, 2);
  assert.equal(quest().getStage(f.player), stage + 1);
  await continueLine(f);
  assert.match(shown(f).text, /^Incredible! Your merchanting skills/);
  await continueLine(f);
  assert.deepEqual(f.messages.filter((text) => /congratulations/i.test(text)), []);

  // Done: Sigmund's subsequent dialogue; the helpers are no longer in the chain.
  talk(f, N.SIGMUND_THE_MERCHANT);
  await continueLine(f);
  assert.match(shown(f).text, /^Hello again outerlander! I am amazed once more/);
  f.player.getDialogueManager().reset?.();
});

test("issue 4886 point 4: after the fisherman and Swensen, Peer asks for the weather forecast", async (t) => {
  // An old save stuck at the old M_SKULGRIMEN step (7): Skulgrimen asked, the fisherman is next.
  const f = actor(t, { old: 7, merchant: 0 });
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.equal(asked(f), 6);
  assert.equal((Number(f.player.getAttribute(TRIALS)) >>> (MERCHANT * 3)) & 7, 1, "the converted save shows the trial started");
  assert.equal(texts(await converse(f, N.FISHERMAN))[0], "I don't suppose you have any idea where I could find an exotic and extremely rare fish, do you?");
  assert.equal(asked(f), 7);
  const swensen = texts(await converse(f, N.SWENSEN_THE_NAVIGATOR));
  assert.equal(swensen[2], "I don't suppose you have any idea where I could find a map of deep sea fishing spots do you?");
  assert.equal(asked(f), 8);
  const peer = texts(await converse(f, N.PEER_THE_SEER));
  assert.equal(peer[0], "I don't suppose you have any idea where I could find a weather forecast from the Fremennik Seer do you?");
  assert.equal(peer.at(-1), "That is all.");
  assert.equal(asked(f), 9);
  // Again: Peer's reminder, and Swensen's "from the Seer perhaps?" reminder.
  assert.equal(texts(await converse(f, N.PEER_THE_SEER))[0], "I don't suppose you have any idea where I could find a brave and powerful warrior to act as a bodyguard?");
  assert.equal(texts(await converse(f, N.SWENSEN_THE_NAVIGATOR)).at(-1), "Uh... from the Seer perhaps?");
  assert.equal(asked(f), 9);
});

test("a request is only recorded on its own branch: Ask about becoming a Fremennik leaves it", async (t) => {
  const f = actor(t, { chain: 1, merchant: 1 });
  await converse(f, N.SAILOR_2, { option: MENU[1] });
  assert.equal(asked(f), 0);
  // Out of turn: Olaf answers the flower question and nothing is recorded.
  const olaf = texts(await converse(f, N.OLAF_THE_BARD));
  assert.deepEqual(olaf, ["I don't suppose you have any idea where I could find a rare flower from across the sea, do you?", "I'm sorry, no I don't."]);
  assert.equal(asked(f), 0);
});

test("out-of-turn talks follow the current request; only the link that wants it reminds (rsprox 1002313 t3069-t3600)", async (t) => {
  // Sigli asked for the bowstring (5 heard): the Sailor and Peer answer the bowstring question.
  const f = actor(t, { chain: 6, merchant: 1 });
  assert.equal(texts(await converse(f, N.SAILOR_2))[1], "Not really my affair, outerlander.");
  assert.equal(texts(await converse(f, N.PEER_THE_SEER))[0], "I don't suppose you have any idea where I could find a finely balanced custom bowstring, do you?");
  assert.equal(asked(f), 5);
  // Everything up to Thora heard: Thora's reminder points to Askeladden; the earlier links are asked
  // where the note is, each with their own answer.
  const g = actor(t, { chain: 13, merchant: 1 });
  const PROMISE = "I don't suppose you have any idea where I could find a written promise from Askeladden to stay out of the Longhall?";
  assert.equal(texts(await converse(g, N.THORA_THE_BARKEEP))[0], PROMISE);
  assert.deepEqual(texts(await converse(g, N.MANNI_THE_REVELLER)).slice(0, 2),
    [PROMISE, "Uh... call it a crazy hunch, but did you even try asking Askeladden about that?"]);
  assert.deepEqual(texts(await converse(g, N.THORVALD_THE_WARRIOR)).slice(0, 2), [PROMISE, "Not in the slightest."]);
});

test("after a link's own trade it plays its 'again' talk", async (t) => {
  const f = actor(t, { chain: 14, merchant: 1, items: [[I.WEATHER_FORECAST]] });
  assert.equal(texts(await converse(f, N.THORVALD_THE_WARRIOR))[0], "You didn't take much persuading to 'lower' yourself to a bodyguard.");
  assert.equal(texts(await converse(f, N.PEER_THE_SEER))[0], "So, about this forecast...");
  assert.equal(texts(await converse(f, N.ASKELADDEN))[0], "I thought you really liked the long hall?");
  assert.deepEqual(inv(f), [I.WEATHER_FORECAST]);
});

test("a lost chain item: Askeladden sells the note again for 5,000 gp", async (t) => {
  // Old save at M_FISH (20) with the fish lost: the whole request leg is heard, so Skulgrimen is asked
  // about the note like the other early links (rsprox 1002313 t3378).
  const f = actor(t, { old: 20, merchant: 0, items: [[I.COINS, 5000]] });
  assert.deepEqual(texts(await converse(f, N.SKULGRIMEN)).slice(0, 2), ["I don't suppose you have any idea where I could find a written promise from Askeladden to stay out of the Longhall?",
    "I never saw anything like that in my store before."]);
  assert.equal(asked(f), 13);
  const sale = await converse(f, N.ASKELADDEN, { answers: ["Yes"] });
  assert.deepEqual(lineWith(sale, "Done, and done.").items, [I.PROMISSORY_NOTE]);
  assert.equal(f.player.getInventory().getAmount(I.COINS), 0);
  // Short of the cash: no note.
  const g = actor(t, { chain: 14, merchant: 1, items: [[I.COINS, 100]] });
  const short = texts(await converse(g, N.ASKELADDEN, { answers: ["Yes"] }));
  assert.equal(short.at(-1), "Trying to scam me, huh buddy? Well it won't work! You come back with the cash, or don't come back at all!");
  assert.equal(held(g, I.PROMISSORY_NOTE), false);
});

test("an old save holding a chain item converts and trades on", async (t) => {
  const f = actor(t, { old: 22, merchant: 0, items: [[I.TRACKING_MAP]] });
  const lines = await converse(f, N.BRUNDT_THE_CHIEFTAIN);
  assert.deepEqual(lineWith(lines, "Excellent work outerlander!").items, [I.FISCAL_STATEMENT]);
  assert.equal(asked(f), 13);
});

test("using the item on its link plays that link's hand-over branch", async (t) => {
  const f = actor(t, { chain: 14, merchant: 1, items: [[I.SEA_FISHING_MAP]] });
  const item = f.player.getInventory().forSlot(0);
  const target = { getId: () => N.FISHERMAN };
  const event = { player: f.player, npcId: N.FISHERMAN, itemId: I.SEA_FISHING_MAP, item, slot: 0, target, handled: false };
  PM.emitItemOnNpc(event);
  tick(f);
  assert.deepEqual(shown(f), { who: "PlayerDialogue", text: "Here. I got you your map." });
  await continueLine(f);
  assert.match(shown(f).text, /^Great work outerlander!/);
  assert.deepEqual(inv(f), [I.UNUSUAL_FISH]);
});

test("Sigmund's shop refuses an outerlander with live's game message", () => {
  const { gateFor } = require("../plugins/quests/Shops.Quests.js")._test;
  assert.equal(gateFor("Sigmund the Merchant (shop)").message, "Only Fremenniks may trade with this merchant.");
});
