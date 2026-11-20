// Run after `yarn build`: node --test tests/in-aid-of-the-myreque-store.test.cjs
//
// In Aid of the Myreque, stages 110-210 (the Store unit), against the live capture (revision 242):
// Aurel's agreement on his own line (t1305), the roof/wall/booth/bank-wall/chimney repairs (Inspect,
// mesbox, "Fix the ...?" Yes./No., pest_repair + hammer sounds, two ticks later the varbit, the
// materials, objectbox_double/objectbox and +100 Crafting), the crate that never changes item and
// keeps its stock in varbits 1991-1993, the hand-in (1984 + 170 on "Aurel quickly puts the stock
// out..."), Cornelius' recruiting with the fade (1979 + 200), the citizen line that sets 205 and the
// furnace fuel (1980 = 2 only). Real plugins, a real Player; clicks go through PluginManager.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");

const STAGE = "quest.in_aid_of_the_myreque.stage";
const VARS = "in-aid-of-the-myreque:varbits";
const SAVE_VERSION = "in-aid-of-the-myreque:save-version";
const { impliedVarbits } = require("../plugins/quests/inaid/State.InAidOfTheMyreque");
const V = { ROOF: 1974, WALL: 1975, BOOTH: 1977, BANK_WALL: 1978, TELLER: 1979, FURNACE: 1980, STOCKED: 1984, AXES: 1991, FOOD: 1992, TINDER: 1993 };
const uid = (group, child) => (group << 16) | child;
const MESBOX = uid(229, 3), OBJBOX = uid(193, 2), DOUBLE = uid(11, 2), NPC_TEXT = uid(231, 6), PLAYER_TEXT = uid(217, 6);
const ROOF = 12751, STORE_WALL = 12752, BOOTH = 12759, BANK_WALL = 12760, FURNACE = 12805;
const BURGH = { x: 3515, y: 3238, z: 0 };
let core, I, N, index = 8800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, stage, vars = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(`iaotmstore${index}`);
  p.setRegistered(true);
  p.setLocation(new core.Location(BURGH.x, BURGH.y, BURGH.z));
  p.needsPlacement = false;
  p.setAttribute(SAVE_VERSION, 2);
  p.setAttribute(VARS, { ...impliedVarbits(stage), ...vars });
  p.setAttribute(STAGE, stage);
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  const seen = { strings: [], chatbox: [], sounds: [], anims: [], messages: [], items: [], scripts: [] };
  const sender = p.getPacketSender();
  const spy = (method, record) => {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  };
  spy("sendString", (text, id) => seen.strings.push([id, String(text)]));
  spy("sendChatboxInterface", (group) => seen.chatbox.push(group));
  spy("sendSound", (id, volume, delay) => seen.sounds.push([id, delay]));
  spy("sendItemOnInterfaces", (id, item) => seen.items.push(item));
  const anim = p.performAnimation.bind(p);
  p.performAnimation = (animation) => { seen.anims.push(animation.getId()); return anim(animation); };
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { seen.messages.push(String(text)); return send(text, ...rest); };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, seen };
}

const stageOf = (p) => p.getAttribute(STAGE);
const varbit = (p, id) => p.getPacketSender().getVarbit(id);
const texts = (seen, id) => seen.strings.filter(([at]) => at === id).map(([, text]) => text.replace(/<br>/g, " "));
const lastText = (seen, id) => texts(seen, id).at(-1);
const tick = (n = 1) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const menu = (p) => core.MultiChatboxPrompt.getPending(p);

function choose(p, text) {
  const pending = menu(p);
  assert.ok(pending, `a menu is open for "${text}"`);
  const at = pending.options.indexOf(text);
  assert.ok(at >= 0, `"${text}" in [${pending.options.join(" | ")}]`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: at + 1 });
}

/** Continues boxes until a menu opens or the conversation ends (a held box gets its ticks). */
function proceed(p, limit = 40) {
  for (let i = 0; i < limit; i++) {
    if (menu(p)) return;
    const manager = p.getDialogueManager();
    if (!manager.getCurrent()) { tick(); if (!manager.getCurrent() && !menu(p)) return; continue; }
    manager.advance();
  }
}

function inspect(p, id, option = "Inspect") {
  const definition = ObjectDefinition.forPlayer(id, p) ?? ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((op) => op === option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} has ${option}`);
  const at = { x: BURGH.x, y: BURGH.y, z: 0 };
  return PM.emitObjectInteraction({ player: p, object: { getId: () => id, getLocation: () => new core.Location(at.x, at.y, 0), getDefinition: () => definition },
    objectId: id, definition, clickType, location: at, sourceLocation: at, handled: false });
}

function talk(p, npcId, option = "Talk-to") {
  const npc = core.NPC.create(npcId, new core.Location(BURGH.x + 1, BURGH.y, 0));
  const definition = npc.getCurrentDefinition?.(p) ?? npc.getDefinition();
  const clickType = definition.getActions().findIndex((op) => op === option) + 1;
  const event = { player: p, npc, npcId: npc.getId(), definition, clickType, action: option, handled: false };
  PM.emitNpcInteraction(event);
  return event;
}

function give(p, itemId, amount) {
  const definition = core.ItemDefinition?.forId?.(itemId);
  if (definition?.isStackable?.() || amount === 1) return p.getInventory().add(new core.Item(itemId, amount));
  for (let i = 0; i < amount; i++) p.getInventory().add(new core.Item(itemId, 1));
}

function repairKit(p, planks = 3, nails = 12) {
  give(p, I.HAMMER, 1);
  give(p, I.PLANK, planks);
  give(p, I.STEEL_NAILS, nails);
}

function crafting(p) {
  return p.getSkillManager().getExperience(core.Skill.CRAFTING);
}

// ---------------------------------------------------------------------------

test("Aurel at 110: 140 comes with his 'Please can you fix the roof...' line, not with the option", (t) => {
  const { p, seen } = player(t, 110);
  talk(p, N.AUREL);
  proceed(p);
  assert.deepEqual(menu(p).options, ["What do you do here?", "What do you think of your town?", "I'd like to help fix up the town.", "I'd best be off."], "live's menu at t1296");
  assert.equal(lastText(seen, PLAYER_TEXT), "Hey there, I'm finished with my project at the inn.");
  choose(p, "I'd like to help fix up the town.");
  assert.equal(stageOf(p), 110, "the option alone leaves the stage");
  for (let i = 0; i < 10 && lastText(seen, PLAYER_TEXT) !== "What needs fixing?"; i++) p.getDialogueManager().advance();
  assert.equal(stageOf(p), 110, "still 110 on 'What needs fixing?'");
  p.getDialogueManager().advance();
  assert.match(lastText(seen, NPC_TEXT), /^Please can you fix the roof, then the walls/);
  assert.equal(stageOf(p), 140, "140 as Aurel's line shows (t1305)");
});

test("Razvan's 'I'd like to help fix up the town.' at 110 does not move the stage", (t) => {
  const { p, seen } = player(t, 110);
  talk(p, N.RAZVAN);
  proceed(p);
  assert.equal(lastText(seen, PLAYER_TEXT), "Hey there, I'm finished with my project at the inn.", "the after-the-inn citizens' page (t1164)");
  choose(p, "I'd like to help fix up the town.");
  proceed(p);
  assert.ok(texts(seen, NPC_TEXT).some((line) => /Go and have a chat with Aurel/.test(line)));
  assert.equal(stageOf(p), 110);
});

test("the roof: Inspect, mesbox, 'Fix the roof?' Yes. -> hammering, two ticks later 1974, 150, 3 planks + 12 nails, double box, +100 Crafting", (t) => {
  const { p, seen } = player(t, 140);
  repairKit(p);
  give(p, I.STEEL_NAILS, 88);
  const xp = crafting(p);
  assert.equal(inspect(p, ROOF), true);
  assert.equal(lastText(seen, MESBOX), "The roof looks like it's seen better days. The planks are all rotten and the nails have gone rusty.");
  proceed(p);
  assert.equal(menu(p).title, "Fix the roof?");
  assert.deepEqual(menu(p).options, ["Yes.", "No."]);
  choose(p, "Yes.");
  assert.deepEqual(seen.anims, [3931], "pest_repair on the Yes tick");
  assert.deepEqual(seen.sounds, [[2101, 0], [2101, 20], [2101, 40]], "hammer_wood x3");
  assert.equal(varbit(p, V.ROOF), 0, "nothing changes on the Yes tick");
  assert.equal(p.getInventory().getAmount(I.PLANK), 3);
  tick(2);
  assert.equal(varbit(p, V.ROOF), 1);
  assert.equal(stageOf(p), 150);
  assert.equal(p.getInventory().getAmount(I.PLANK), 0);
  assert.equal(p.getInventory().getAmount(I.STEEL_NAILS), 88, "12 nails used (100 -> 88)");
  assert.deepEqual(seen.sounds.at(-1), [1710, 0], "m2_build");
  assert.ok([-1, 65535].includes(seen.anims.at(-1)), "the animation reset");
  assert.ok(seen.chatbox.includes(11), "objectbox_double");
  assert.equal(lastText(seen, DOUBLE), "You use some wooden planks and nails to patch up the hole in the roof.");
  assert.deepEqual(seen.items.slice(-2), [I.PLANK, I.STEEL_NAILS]);
  assert.ok(crafting(p) - xp >= 100, "Crafting experience");
  assert.equal(ObjectDefinition.forPlayer(ROOF, p).getName(), "Repaired Roof");
});

test("the store wall at 150 -> 160 with the full inspect text; without materials the transcript's refusal and nothing taken", (t) => {
  const { p, seen } = player(t, 150);
  inspect(p, STORE_WALL);
  assert.match(lastText(seen, MESBOX), /It looks like it was once boarded up with nails and wooden planks\.$/);
  proceed(p);
  assert.equal(menu(p).title, "Fix the wall?");
  choose(p, "Yes.");
  assert.match(lastText(seen, MESBOX), /You need a hammer, 3 basic planks and 12 nails of any kind\./);
  assert.equal(stageOf(p), 150);
  repairKit(p);
  p.getDialogueManager().reset();
  inspect(p, STORE_WALL);
  proceed(p);
  choose(p, "Yes.");
  tick(2);
  assert.equal(varbit(p, V.WALL), 1);
  assert.equal(stageOf(p), 160);
  assert.equal(lastText(seen, DOUBLE), "You use some wooden planks and nails to fix up the wall.");
});

test("before Aurel asks (110) the roof shows its text only and cannot be fixed", (t) => {
  const { p, seen } = player(t, 110);
  repairKit(p);
  inspect(p, ROOF);
  proceed(p);
  assert.equal(menu(p), null);
  assert.equal(varbit(p, V.ROOF), 0);
  assert.equal(stageOf(p), 110);
  assert.equal(texts(seen, MESBOX).length, 1);
});

test("Aurel at 160: the crate on his stock line's continue, 165; 'I'd like to help...' no longer offered", (t) => {
  const { p, seen } = player(t, 160);
  p.setAttribute("in-aid-of-the-myreque:crate-food", 1);
  talk(p, N.AUREL);
  proceed(p);
  assert.equal(texts(seen, NPC_TEXT)[0], "Hi there. You've done a good job on my store! It's starting to look great!");
  assert.deepEqual(menu(p).options, ["What do you do here?", "What do you think of your town?", "What should I do now?", "I'd best be off."], "live's menu at t1349");
  choose(p, "What should I do now?");
  for (let i = 0; i < 6 && !/^I need 3 tinderboxes/.test(lastText(seen, NPC_TEXT) ?? ""); i++) p.getDialogueManager().advance();
  assert.equal(lastText(seen, NPC_TEXT), "I need 3 tinderboxes, 10 snails of any type and 10 bronze axes.");
  assert.equal(stageOf(p), 160);
  p.getDialogueManager().advance();
  assert.equal(stageOf(p), 165);
  assert.equal(p.getInventory().getAmount(I.CRATE), 1);
  assert.equal(lastText(seen, OBJBOX), "Aurel gives you a crate.");
  assert.equal(seen.items.at(-1), I.CRATE);
});

test("the crate: empty search, then each request filled from its menu into varbits 1993/1991/1992; the item stays 7630", (t) => {
  const { p, seen } = player(t, 165);
  p.setAttribute("in-aid-of-the-myreque:crate-food", 1);
  give(p, I.CRATE, 1);
  const crateSlot = () => p.getInventory().getItems().findIndex((item) => item?.getId() === I.CRATE);
  const action = [1, 2, 3, 4, 6, 7].map((op) => ItemActionPacketListener.resolveInventoryWidgetAction(I.CRATE, op)).find((a) => a?.option === "Search");
  const search = () => PM.emitItemAction({ player: p, item: p.getInventory().getItems()[crateSlot()], itemId: I.CRATE, slot: crateSlot(),
    interfaceId: 149 << 16, clickType: action.optionIndex, option: action.option, handled: false });
  search();
  assert.equal(lastText(seen, MESBOX), "The crate is empty.");
  p.getDialogueManager().reset();
  const use = (itemId) => {
    const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
    return PM.emitItemOnItem({ player: p, usedItem: p.getInventory().getItems()[slot], usedItemId: itemId, usedItemSlot: slot,
      usedWithItem: p.getInventory().getItems()[crateSlot()], usedWithItemId: I.CRATE, usedWithItemSlot: crateSlot(), handled: false });
  };
  for (const [itemId, amount, title, added, full, vb] of [
    [I.TINDERBOX, 3, "tinderboxes", "You add 3 tinderboxes to the crate.", "The crate is now full of tinderboxes.", V.TINDER],
    [I.BRONZE_AXE, 10, "bronze axes", "You add 10 bronze axes to the crate.", "The crate is now full of bronze axes.", V.AXES],
    [I.THIN_SNAIL, 10, "food", "You add 10 snails to the crate.", "The crate is now full of food.", V.FOOD],
  ]) {
    give(p, itemId, amount);
    use(itemId);
    assert.equal(menu(p).title, `Would you like to fill the crate with ${title}?`);
    assert.deepEqual(menu(p).options, ["Yes, I'll fill the crate.", "No, I just want to add one."]);
    choose(p, "Yes, I'll fill the crate.");
    assert.equal(varbit(p, vb), amount);
    assert.equal(p.getInventory().getAmount(itemId), 0, "every needed one goes at once");
    assert.equal(lastText(seen, OBJBOX), added);
    assert.equal(seen.items.at(-1), itemId);
    p.getDialogueManager().advance();
    assert.equal(lastText(seen, MESBOX), full);
    p.getDialogueManager().reset();
  }
  assert.equal(p.getInventory().getAmount(I.CRATE), 1, "still the 7630 crate");
  assert.equal(p.getInventory().getAmount(7631), 0);
  assert.equal(stageOf(p), 165);
});

test("the hand-in: crate objectbox, Aurel's 'Wow', then 1984 + 170 + the crate gone with 'Aurel quickly puts the stock out...'", (t) => {
  const { p, seen } = player(t, 165, { [V.TINDER]: 3, [V.AXES]: 10, [V.FOOD]: 10 });
  p.setAttribute("in-aid-of-the-myreque:crate-food", 1);
  give(p, I.CRATE, 1);
  talk(p, N.AUREL);
  assert.equal(lastText(seen, OBJBOX), "You show the full crate to Aurel who takes it off your hands.");
  assert.equal(seen.items.at(-1), I.CRATE);
  assert.equal(stageOf(p), 165);
  assert.equal(p.getInventory().getAmount(I.CRATE), 1);
  p.getDialogueManager().advance();
  assert.match(lastText(seen, NPC_TEXT), /^Wow, that's fantastic/);
  assert.equal(stageOf(p), 165, "nothing changes on Aurel's 'Wow'");
  p.getDialogueManager().advance();
  assert.equal(lastText(seen, MESBOX), "Aurel quickly puts the stock out around the shop.");
  assert.equal(varbit(p, V.STOCKED), 1);
  assert.equal(stageOf(p), 170);
  assert.equal(p.getInventory().getAmount(I.CRATE), 0);
});

test("a partly filled crate is not handed in", (t) => {
  const { p } = player(t, 165, { [V.TINDER]: 3 });
  give(p, I.CRATE, 1);
  talk(p, N.AUREL);
  proceed(p);
  assert.equal(stageOf(p), 165);
  assert.equal(p.getInventory().getAmount(I.CRATE), 1);
});

test("the bank booth at 170: 2 planks, 8 nails, 1 swamp paste; 1977 + 180; its Bank refuses until Cornelius serves", (t) => {
  const { p, seen } = player(t, 170);
  repairKit(p, 2, 8);
  give(p, I.SWAMP_PASTE, 2);
  inspect(p, BOOTH);
  assert.match(lastText(seen, MESBOX), /^This bank booth is in an awful condition/);
  proceed(p);
  assert.equal(menu(p).title, "Fix the booth?");
  choose(p, "Yes.");
  assert.deepEqual(seen.anims, [3931]);
  tick(2);
  assert.equal(varbit(p, V.BOOTH), 1);
  assert.equal(stageOf(p), 180);
  assert.equal(p.getInventory().getAmount(I.SWAMP_PASTE), 1);
  assert.equal(p.getInventory().getAmount(I.PLANK), 0);
  assert.equal(p.getInventory().getAmount(I.STEEL_NAILS), 0);
  assert.deepEqual(seen.items.slice(-2), [I.SWAMP_PASTE, I.PLANK]);
  assert.match(lastText(seen, DOUBLE), /^You use some swamp paste to fix the bits of glass/);
  const ops = ObjectDefinition.forPlayer(BOOTH, p).getInteractions();
  assert.equal(ops[0], "Bank", "1977 = 1 shows 12798 at once");
  assert.equal(ops[2], "Collect");
  p.getDialogueManager().reset();
  inspect(p, BOOTH, "Bank");
  assert.equal(lastText(seen, MESBOX), "While the booth looks functional, there still isn't anyone working behind the booth to serve you.");
});

test("the bank wall waits for the booth, then 3 planks + 12 nails, 1978 + 190", (t) => {
  const { p, seen } = player(t, 170);
  repairKit(p);
  inspect(p, BANK_WALL);
  proceed(p);
  assert.equal(menu(p), null, "no repair before the booth");
  assert.equal(stageOf(p), 170);
  const ready = player(t, 180);
  repairKit(ready.p);
  inspect(ready.p, BANK_WALL);
  proceed(ready.p);
  choose(ready.p, "Yes.");
  tick(2);
  assert.equal(varbit(ready.p, V.BANK_WALL), 1);
  assert.equal(stageOf(ready.p), 190);
  assert.equal(lastText(ready.seen, DOUBLE), "You use some wooden planks and nails to fix up the wall.");
  assert.equal(seen.chatbox.includes(11), false);
});

test("Cornelius at 170: the bank citizens' one five-option menu and 'start with the bank booth'", (t) => {
  const { p, seen } = player(t, 170);
  talk(p, 6214);
  proceed(p);
  assert.deepEqual(menu(p).options.slice(0, 4), ["What do you do here?", "What do you think of your town?", "How did everyone come to be here?", "What should I do now?"], "live's menu at t2018");
  choose(p, "What should I do now?");
  proceed(p);
  assert.ok(texts(seen, NPC_TEXT).includes("It would be good if you could fix the bank up. I'd suggest starting with the bank booth first."));
  assert.equal(stageOf(p), 170);
});

test("Cornelius at 190: greeting, 'What should I do now?', the recruiting lines, the fade, then 1979 + 200 two ticks on", (t) => {
  const { p, seen } = player(t, 190);
  talk(p, 6214);
  assert.equal(texts(seen, NPC_TEXT)[0], "Hey it's you! You're doing a great job with the town! It's really getting a lot better!");
  proceed(p);
  choose(p, "What should I do now?");
  for (let i = 0; i < 12 && lastText(seen, MESBOX) === undefined; i++) p.getDialogueManager().advance();
  assert.ok(texts(seen, PLAYER_TEXT).includes("Do you fancy the job?"));
  assert.equal(lastText(seen, MESBOX), "Cornelius gets changed into some more suitable attire and stands behind the bank booth.");
  assert.equal(varbit(p, V.TELLER), 0);
  tick(2);
  assert.equal(varbit(p, V.TELLER), 1);
  assert.equal(stageOf(p), 200);
  const n6215 = core.NPC.create(6215, new core.Location(3493, 3211, 0));
  assert.equal(n6215.getCurrentDefinition(p)?.getId(), N.CORNELIUS_2, "the banker behind the booth");
});

test("a citizen's furnace line at 200 sets 205; again at 205 it stays", (t) => {
  const { p, seen } = player(t, 200);
  talk(p, N.RAZVAN);
  proceed(p);
  assert.equal(texts(seen, NPC_TEXT)[0], "Hello there. Thank you so much for all of your work so far. We all really appreciate it.");
  choose(p, "What should I do now?");
  for (let i = 0; i < 4 && !/old furnace/.test(lastText(seen, NPC_TEXT)); i++) p.getDialogueManager().advance();
  assert.match(lastText(seen, NPC_TEXT), /old furnace were up and working again\.$/);
  assert.equal(stageOf(p), 205);
});

test("the furnace chimney at 205: 2 steel bars, hammer_steel, 1980 = 1 and 210, the steel-bar box", (t) => {
  const { p, seen } = player(t, 205);
  give(p, I.HAMMER, 1);
  give(p, I.STEEL_BAR, 2);
  inspect(p, FURNACE);
  assert.match(lastText(seen, MESBOX), /^There's a large hole in the chimney/);
  proceed(p);
  assert.equal(menu(p).title, "Fix the chimney?");
  choose(p, "Yes.");
  assert.deepEqual(seen.sounds, [[2099, 0], [2099, 20], [2099, 40]]);
  tick(2);
  assert.equal(varbit(p, V.FURNACE), 1);
  assert.equal(stageOf(p), 210);
  assert.equal(p.getInventory().getAmount(I.STEEL_BAR), 0);
  assert.equal(lastText(seen, OBJBOX), "You use some steel bars to fix the hole in the furnace chimney.");
  assert.equal(seen.items.at(-1), I.STEEL_BAR);
});

test("fuel at 210: 'Refuel the furnace?' Yes. -> coal gone, m2_fillcoal, a tick later 1980 = 2 and the coal box; the stage stays", (t) => {
  const { p, seen } = player(t, 210);
  give(p, I.COAL, 1);
  inspect(p, FURNACE);
  assert.equal(lastText(seen, MESBOX), "The furnace has been repaired now. However, it needs some fuel before it can be used.");
  proceed(p);
  assert.equal(menu(p).title, "Refuel the furnace?");
  choose(p, "Yes.");
  assert.deepEqual(seen.anims, [832]);
  assert.equal(p.getInventory().getAmount(I.COAL), 0);
  assert.deepEqual(seen.sounds, [[1709, 0]]);
  tick(1);
  assert.equal(varbit(p, V.FURNACE), 2);
  assert.equal(stageOf(p), 210);
  assert.equal(lastText(seen, OBJBOX), "You place some coal into the newly fixed furnace.");
});
