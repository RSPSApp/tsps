// Run after `yarn build`: node --test tests/poh-servants-dialogue.test.cjs
// House servants' conversations (Wiki: Servant; rsprox recordings): each servant's own lines at the guild, in the
// house and on items used on it; the in-house menus; the poh_servant_pay counter (16 on hire, 2 an errand, 1 a cup
// of tea) and poh_servant_lasttasktype; the wage demanded when the work runs out, and the money bag paying it.
// Real engine: every plugin loaded, a real Player; the house is a PlayerHouseInstance stand-in and the servant a
// stand-in NPC. Conversations are read from the dialogue chains and menus the module sends.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, I, N, Servants, Instance, Core, Ids, PAY, TYPE, LAST;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  Servants = require("../plugins/skills/construction/Servants.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  Core = require("../plugins/skills/construction/Core.Construction");
  Ids = require("../plugins/skills/construction/Ids.Construction");
  PAY = Ids.varbit("poh_servant_pay");
  TYPE = Ids.varbit("poh_servant_type");
  LAST = Ids.varbit("poh_servant_lasttasktype");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const BEDROOMS = () => [{ roomKey: "BEDROOM", furniture: { a: "WOODEN_BED" } }, { roomKey: "BEDROOM", furniture: { a: "WOODEN_BED" } }];
let next = 9910;
/** A player whose chatbox is recorded: lines, menus and the amount prompt, answered by the test. */
function actor(t, save) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("servants" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.setLocation(new core.Location(2662, 3333, 0));
  p.getSkillManager().setMaxLevel(core.Skill.CONSTRUCTION, 99);
  p.setAttribute("construction:house", save);
  p.getBank(0);
  const log = [], varbits = new Map(), messages = [];
  let chainEnd = null, choices = null, amount = null;
  t.mock.method(p.getDialogueManager(), "startDialogues", (builder) => {
    for (const d of builder.getDialogues().values()) {
      const kind = d.constructor.name;
      if (kind === "NpcDialogue") log.push({ npc: d.npcId, text: d.text, face: d.expression });
      else if (kind === "PlayerDialogue") log.push({ player: d.text, face: d.expression });
      else if (kind === "StatementDialogue") log.push({ mesbox: d.text });
      else if (kind === "ActionDialogue") chainEnd = d;
    }
  });
  t.mock.method(Core.api, "sendMultiChatboxPrompt", (player, title, ...pairs) => {
    log.push({ menu: title, options: pairs.filter(x => typeof x === "string") });
    choices = pairs.filter(x => typeof x === "function");
    return true;
  });
  t.mock.method(p, "setEnteredAmountAction", (action) => { amount = action; });
  const sender = p.getPacketSender();
  const varbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, "sendVarbit", (id, value) => { varbits.set(id, value); return varbit(id, value); });
  const msg = sender.sendMessage.bind(sender);
  t.mock.method(sender, "sendMessage", (text, ...rest) => { messages.push(text); return msg(text, ...rest); });
  return {
    p, log, varbits, messages,
    /** Continues the shown chain (its last line). */
    next() { const end = chainEnd; chainEnd = null; assert.ok(end, "a chain waits for a continue"); end.send(p); },
    choose(n) { const list = choices; choices = null; assert.ok(list, "a menu is open"); list[n - 1](p, n - 1, ""); },
    enter(n) { const action = amount; amount = null; assert.ok(action, "the amount prompt is open"); action.execute(n); },
    clear() { log.length = 0; messages.length = 0; },
  };
}
/** The actor in its own house with its servant standing by. */
function inHouse(t, servant, extra = []) {
  const save = { rooms: [[[...BEDROOMS(), ...extra]]], servant };
  const f = actor(t, save);
  const location = f.p.getLocation();
  const house = Object.assign(Object.create(Instance.PlayerHouseInstance.prototype), {
    owner: f.p, save, isDestroyed: () => false, enter() {}, leave() {}, getPlayers: () => [f.p], getEntryLocation: () => location,
  });
  const npc = { id: servant.id, getPrivateArea: () => house, getLocation: () => location, getMovementQueue: () => ({ reset() {} }),
    moveTo() {}, setFollowing() {}, forceChat() {} };
  t.mock.method(f.p, "getPrivateArea", () => house);
  t.mock.method(PM, "spawnNpc", () => npc);
  t.mock.method(PM, "removeNpc", () => {});
  Servants.enterServantHouse(f.p, house);
  return { ...f, save, house, npc };
}
function talkTo(player, npc, npcId) { return Servants.talk({ player, npc, npcId }); }
function useOn(f, slot) { Servants.itemOnServant({ player: f.p, target: f.npc, slot, itemId: f.p.getInventory().getItems()[slot].getId() }); }
/** The servant's errand ends: the game cycle moves past its trip. */
function returnNow(t, f) {
  const cycle = core.World.getProcessCycle() + 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  Servants.processServant(f.p);
}
const lines = (f) => f.log.map(e => e.npc !== undefined ? e.text : e.player ?? e.mesbox ?? `[${e.menu}] ${e.options.join("|")}`);
const seq = (name) => Ids.seq(name);

test("the guild's Rick greets with his own line and offers what he can do, his jobs and hiring", (t) => {
  const f = actor(t, { rooms: [[[...BEDROOMS()]]] });
  const npc = { getPrivateArea: () => null, getLocation: () => f.p.getLocation() };
  talkTo(f.p, npc, N.RICK + 1);
  assert.deepEqual(f.log[0], { npc: N.RICK + 1, text: "'Allo mate! Got a job going? Only 500 coins!", face: seq("chathap1") });
  f.next();
  assert.deepEqual(f.log[1], { menu: "Select an option", options: ["What can you do?", "Tell me about your previous jobs", "You're hired!"] });
});

test("hiring: the Butler's level refusal, the second-bedroom message box, the no-coins exchange, then the hire", (t) => {
  const f = actor(t, { rooms: [[[]]] });
  const npc = { getPrivateArea: () => null, getLocation: () => f.p.getLocation() };
  f.p.getSkillManager().setMaxLevel(core.Skill.CONSTRUCTION, 39);
  talkTo(f.p, npc, N.BUTLER + 1); f.next(); f.clear(); f.choose(3);
  assert.deepEqual(lines(f), ["I must respectfully decline, sir. I offer a very exclusive service and will only work for people with over level 40 Construction."]);
  f.p.getSkillManager().setMaxLevel(core.Skill.CONSTRUCTION, 99);
  f.clear(); talkTo(f.p, npc, N.BUTLER + 1); f.next(); f.clear(); f.choose(3);
  assert.deepEqual(lines(f), ["You need a second bedroom with a bed for your servant to sleep in."]);
  f.p.getAttribute("construction:house").rooms = [[[...BEDROOMS()]]];
  f.clear(); talkTo(f.p, npc, N.BUTLER + 1); f.next(); f.clear(); f.choose(3);
  assert.deepEqual(lines(f), ["You're hired... well, I don't have the money on me, but can I owe you? I'm good for it, honest.",
    "I regret that I cannot agree to begin my duties until I have been paid."]);
  f.p.getInventory().add(new core.Item(I.COINS, 6000));
  f.clear(); talkTo(f.p, npc, N.BUTLER + 1); f.next(); f.clear(); f.choose(3);
  assert.deepEqual(lines(f), ["You're hired!", "Thank you, sir. I can start work immediately."]);
  assert.equal(f.p.getInventory().getAmount(I.COINS), 6000, "paid once the line is continued");
  f.next();
  assert.equal(f.p.getInventory().getAmount(I.COINS), 1000);
  assert.equal(f.varbits.get(TYPE), 6);
  assert.equal(f.varbits.get(PAY), 16, "a new servant has 16 points of work");
});

test("the Chief servant offers dismissal only to someone with a servant, and dismisses on yes", (t) => {
  const f = actor(t, { rooms: [[[...BEDROOMS()]]] });
  const npc = { getPrivateArea: () => null, getLocation: () => f.p.getLocation() };
  talkTo(f.p, npc, N.CHIEF_SERVANT); f.next();
  assert.deepEqual(f.log.at(-1).options, ["Tell me about servants.", "Can I hire a servant?", "Thank you."]);
  f.clear(); f.choose(2);
  assert.deepEqual(lines(f), ["Can I hire a servant?", "Certainly! We have a number of servants here now looking for work. Why not have a chat to them and see which one you would like to hire?"]);
  f.p.getAttribute("construction:house").servant = { id: N.MAID, pay: 16 };
  f.clear(); talkTo(f.p, npc, N.CHIEF_SERVANT); f.next();
  assert.deepEqual(f.log.at(-1).options, ["I'd like to dismiss my servant, please.", "Can I hire a servant?", "Thank you."]);
  f.choose(1); f.next(); f.clear(); f.choose(1); f.next();
  assert.deepEqual(lines(f), ["Yes, I want to dismiss my servant.", "Very well, you no longer have a servant."]);
  assert.equal(f.p.getAttribute("construction:house").servant, undefined);
});

test("in the house: with no task to repeat, Rick says 'Yes, guv?' and shows the five-option menu", (t) => {
  const f = inHouse(t, { id: N.RICK, pay: 16 });
  talkTo(f.p, f.npc, N.RICK);
  assert.deepEqual(f.log[0], { npc: N.RICK, text: "Yes, guv?", face: seq("chatquiz1") });
  f.next();
  assert.deepEqual(f.log[1], { menu: "Select an option", options: ["Serve...", "Go to the bank...", "Go to the sawmill...", "Greet guests", "You're fired"] });
  f.clear(); f.choose(3);
  assert.deepEqual(lines(f), ["Where, guv? Don't know where the sawmill is, I'm afraid!"]);
});

test("a noted item: the Demon butler's question, a zero amount, then an un-note that costs 2 and becomes the repeat", (t) => {
  const f = inHouse(t, { id: N.DEMON_BUTLER, pay: 16 });
  f.p.getInventory().setItem(0, new core.Item(I.LOGS + 1, 5));
  useOn(f, 0);
  assert.match(lines(f)[0], /^<col=000080>Dost thou wish me to exchange that certificate for the <col=000080>item that it represents\?$/);
  f.next();
  assert.deepEqual(f.log.at(-1).options, ["Yes", "No, just take it to the bank.", "No, never mind."]);
  f.clear(); f.choose(1); f.enter(0);
  assert.deepEqual(lines(f), ["<col=000080>You wish me to fetch you nothing? But, master, I <col=000080>already have it here!"]);
  useOn(f, 0); f.next(); f.choose(1); f.enter(3);
  assert.equal(f.varbits.get(PAY), 14);
  assert.equal(f.varbits.get(LAST), 2, "un-note");
  assert.equal(f.save.servant.cargo.amount, 3);
  f.p.getInventory().setItem(1, new core.Item(I.LOGS, 3));
  returnNow(t, f);
  assert.equal(f.p.getInventory().getAmount(I.LOGS), 6, "the un-noted logs handed over");
  assert.deepEqual(lines(f).at(-1), "<col=000080>Master, I have returned with what you asked me to <col=000080>retrieve.");
  f.clear(); talkTo(f.p, f.npc, N.DEMON_BUTLER);
  assert.deepEqual(f.log[0], { menu: "Repeat last task?", options: ["Un-note: 3 x Logs", "Something else..."] });
});

test("bones get each servant's own refusal", (t) => {
  for (const [id, text] of [[N.RICK, "Eww, no way mate. I ain't touching no bones."], [N.MAID, "EEEK! Um, I'm sorry sir, but I just CAN'T handle bones."],
    [N.COOK, "I refuse to handle those unhygenic bones!"], [N.BUTLER, "Out of respect for the dead, I must refuse to transport bones, sir."]]) {
    const f = inHouse(t, { id, pay: 16 });
    f.p.getInventory().setItem(0, new core.Item(I.BIG_BONES + 1, 2));
    useOn(f, 0);
    assert.deepEqual(lines(f), [text]);
  }
});

test("logs on the Cook: sawmill, the fee she names and the confirmation, then her line and the errand", (t) => {
  const f = inHouse(t, { id: N.COOK, pay: 16 });
  f.p.getInventory().setItem(0, new core.Item(I.LOGS, 1));
  f.p.getInventory().setItem(1, new core.Item(I.COINS, 500));
  useOn(f, 0);
  assert.deepEqual(lines(f), ["Okay, do you want me to take those to the sawmill, or the bank?"]);
  f.next(); f.clear(); f.choose(1); f.enter(18);
  assert.deepEqual(lines(f), ["That would cost 100 coins, you know!"]);
  f.next();
  assert.deepEqual(f.log.at(-1), { menu: "Convert the planks for 100 coins?", options: ["Yes", "No"] });
  f.clear(); f.choose(1);
  assert.deepEqual(lines(f), ["One of Gielinor's finest chefs reduced to a builder's mate. All right, I'll be back soon."]);
  f.next();
  assert.equal(f.p.getInventory().getAmount(I.COINS), 400);
  assert.equal(f.varbits.get(LAST), 4, "sawmill");
  assert.equal(f.varbits.get(PAY), 14);
});

test("the fetch list: the servant's reply, the live labels in three pages, and 'More...' wrapping round", (t) => {
  const f = inHouse(t, { id: N.RICK, pay: 16 });
  talkTo(f.p, f.npc, N.RICK); f.next(); f.choose(2);
  assert.deepEqual(f.log.at(-1).options, ["Take something to the bank", "Bring something from the bank"]);
  f.clear(); f.choose(2); f.next();
  assert.deepEqual(lines(f).slice(0, 2), ["Can you fetch something from the bank for me?", "Sure thing, guv. What'll it be?"]);
  f.next();
  assert.deepEqual(f.log.at(-1).options, ["Wooden planks", "Oak planks", "Teak planks", "Mahogany planks", "More..."]);
  f.choose(5);
  assert.deepEqual(f.log.at(-1).options, ["Soft clay", "Limestone brick", "Steel bar", "Cloth", "More..."]);
  f.choose(5);
  assert.deepEqual(f.log.at(-1).options, ["Gold leaf", "Marble block", "Magic housing stone", "More..."]);
  f.choose(4);
  assert.deepEqual(f.log.at(-1).options.slice(0, 1), ["Wooden planks"]);
  f.clear(); f.choose(1);
  assert.deepEqual(lines(f), ["You having a laugh, mate? You ain't got none of them in your bank!"]);
});

test("tea: Rick's line, 1 point of work, and without the kitchen his refusal and the kitchen message box", (t) => {
  const f = inHouse(t, { id: N.RICK, pay: 7 });
  talkTo(f.p, f.npc, N.RICK); f.next(); f.choose(1);
  assert.deepEqual(f.log.at(-1).options, ["Tea", "Dinner", "Drinks"]);
  f.clear(); f.choose(1);
  assert.deepEqual(lines(f), ["I'll make yer a cuppa."]);
  f.next();
  assert.equal(f.varbits.get(PAY), 6);
  assert.deepEqual(lines(f).slice(1), ["You having a laugh, mate? I can't work without proper kitchen equipment.",
    "Your kitchen must contain:<br><col=800000>A larder<br><col=800000>A stove<br><col=800000>A sink<br><col=800000>Kitchen shelves"]);
});

test("the work runs out: the Demon butler asks for his wage; without the coins only 'later' or firing", (t) => {
  const f = inHouse(t, { id: N.DEMON_BUTLER, pay: 0 }, [{ roomKey: "STUDY", furniture: { bag: "SERVANTS_MONEYBAG" } }]);
  talkTo(f.p, f.npc, N.DEMON_BUTLER);
  assert.deepEqual(lines(f), ["<col=000080>Master, if thou desirest my continued service, thou <col=000080>must render unto me the 10,000 coins that are due <col=000080>me! The money bag does not contain enough."]);
  f.next();
  assert.deepEqual(f.log.at(-1).options, ["I'll pay you later.", "You're fired!"]);
  f.p.getInventory().setItem(0, new core.Item(I.COINS, 10000));
  f.clear(); talkTo(f.p, f.npc, N.DEMON_BUTLER); f.next();
  assert.deepEqual(f.log.at(-1).options, ["Okay, here's 10,000 coins.", "I'll pay you later.", "You're fired!"]);
  f.clear(); f.choose(1); f.next();
  assert.deepEqual(lines(f), ["Okay, here's 10,000 coins.", "<col=000080>Thank you, Master. Thou hast my unfailing service."]);
  assert.equal(f.p.getInventory().getAmount(I.COINS), 0);
  assert.equal(f.varbits.get(PAY), 16);
});

test("a money bag that holds the wage pays it on the servant's return, with the game message", (t) => {
  const f = inHouse(t, { id: N.RICK, pay: 1 }, [{ roomKey: "STUDY", furniture: { bag: "SERVANTS_MONEYBAG" } }]);
  f.save.servantMoney = 3000000;
  f.p.getBank(0).add(new core.Item(I.PLANK, 5), false);
  assert.equal(Servants.startServantTask(f.p, { kind: "fetch", itemId: I.PLANK, amount: 2 }), true);
  assert.equal(f.varbits.get(PAY), 0, "the last point of work is used");
  f.clear();
  returnNow(t, f);
  assert.deepEqual(f.messages, ["<col=ef1020>Your servant takes some payment from the money bag. 2,999,500 coins remain.</col>"]);
  assert.deepEqual(lines(f), ["Here you go, mate. Got a bit lost on the way back, sorry 'bout that."]);
  assert.equal(f.p.getInventory().getAmount(I.PLANK), 2);
  assert.equal(f.varbits.get(PAY), 16);
});

test("a save from before the counter: 3 uses of 8 leaves 10 points of work", (t) => {
  const f = inHouse(t, { id: N.MAID, uses: 3 });
  talkTo(f.p, f.npc, N.MAID);
  assert.equal(f.save.servant.pay, 10);
  assert.equal(f.save.servant.uses, undefined);
});
