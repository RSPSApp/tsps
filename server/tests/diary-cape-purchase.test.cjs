const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const { ATTR_SKIP_PERSISTENCE } = require("../plugins/bots/runtime/PersistenceConstants.PlayerBots");

let core, nextIndex = 1800, hunterStarted = false;
const actorTasks = new WeakMap();
const oldBots = process.env.DISABLE_PLAYER_BOTS;
const oldError = console.error, errors = [];
before(async () => {
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError.apply(console, args); };
  process.env.DISABLE_PLAYER_BOTS = "1";
  const root = path.resolve(__dirname, "..");
  await CachePipeline.initialize(root);
  PM.loadFromDirectory(path.join(root, "plugins"));
  core = PM.getCoreApi();
  assert.equal(core.CacheDefinitions.getNpcId("diary_queen"), core.NpcIdentifiers.TWIGGY_OKORN);
  for (const [id, name] of [
    [core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE, "Achievement diary cape"],
    [core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE_T_, "Achievement diary cape (t)"],
    [core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD, "Achievement diary hood"],
    [core.ItemIdentifiers.BONES, "Bones"],
  ]) {
    assert.equal(core.ItemDefinition.forId(id).getName(), name);
    assert.equal(core.ItemDefinition.forId(id).isStackable(), false);
  }
  core.RegionManager.init();
  for (const hook of PM.serverStartupHooks) {
    if (!["Hunter", "WarpedSceptre"].includes(hook.pluginName)) continue;
    if (hook.pluginName === "Hunter") hunterStarted = true;
    hook.handler({});
  }
});
after(() => {
  try {
    if (hunterStarted) for (const hook of PM.serverShutdownHooks) if (hook.pluginName === "Hunter") hook.handler({});
    assert.deepEqual(errors, [], "no caught plugin or engine errors");
  } finally {
    console.error = oldError;
    if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = oldBots;
  }
});

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  let npc, npcRegistered = false;
  actorTasks.set(p, []);
  t.after(() => {
    try {
      p.closeInterruptibleInterfaces();
      for (const task of actorTasks.get(p)) task.stop();
      if (npcRegistered) core.World.getNpcs().remove(npc);
      core.GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(p);
      core.TaskManager.cancelTasks(p);
      if (p.getIndex() >= 0) core.TaskManager.cancelTasks(p.getIndex());
      p.getMovementQueue().reset();
    } finally { p.setRegistered(false); }
  });
  p.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  p.setIndex(nextIndex++);
  p.setUsername("diarycape" + p.getIndex());
  p.setRegistered(true);
  const spawn = require("../data/definitions/npc-spawns.json").find(row => row.id === core.NpcIdentifiers.TWIGGY_OKORN);
  assert.ok(spawn, "Twiggy has a real authored spawn");
  const z = spawn.level ?? 0;
  core.RegionManager.loadMapFiles(spawn.x, spawn.y);
  const adjacent = [[0, 1], [1, 0], [0, -1], [-1, 0]].find(([dx, dy]) =>
    core.RegionManager.canMove(spawn.x, spawn.y, spawn.x + dx, spawn.y + dy, z, 1, 1, null)
    && core.RegionManager.canMove(spawn.x + dx, spawn.y + dy, spawn.x, spawn.y, z, 1, 1, null));
  assert.ok(adjacent, "spawn has a collision-accessible adjacent tile");
  p.setLocation(new core.Location(spawn.x + adjacent[0], spawn.y + adjacent[1], z));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", text => { messages.push(text); return p.getPacketSender(); });
  const connection = new ClientConnection(channel);
  connection.player = p;
  npc = core.NPC.create(core.NpcIdentifiers.TWIGGY_OKORN, new core.Location(spawn.x, spawn.y, z));
  npc.setScriptedMovement(true);
  npcRegistered = core.World.getNpcs().add(npc);
  assert.equal(npcRegistered, true, "Twiggy is registered in the world");
  return { p, npc, connection, messages, history: [] };
}

function completeAllButLast(p) {
  const record = {};
  for (const diary of Data.DIARIES)
    record[diary.key] = Data.TIERS.flatMap(tier => diary.tiers[tier].tasks.map(task => task.key));
  const diary = Data.DIARIES.at(-1), last = record[diary.key].pop();
  p.setAttribute(Progress.TASKS_ATTRIBUTE, record);
  return { diary, last };
}
function allComplete(p) {
  const result = { player: p, complete: false };
  PM.emitCustomEvent("diary:all-complete", result);
  return result.complete;
}
function qualify(p) {
  const { diary, last } = completeAllButLast(p);
  assert.equal(allComplete(p), false);
  completeLast(p, diary, last);
  assert.equal(allComplete(p), true);
}
function completeLast(p, diary, last) {
  const previous = new Set([...core.TaskManager.pendingTasks.toArray(), ...core.TaskManager.activeTasks]);
  try { assert.equal(Progress.completeTask(p, diary, last), true); }
  finally {
    for (const task of [...core.TaskManager.pendingTasks.toArray(), ...core.TaskManager.activeTasks])
      if (!previous.has(task)) actorTasks.get(p).push(task);
  }
}
function talk(f) {
  const definition = f.npc.getCurrentDefinition(f.p);
  assert.equal(definition.getName(), "Twiggy O'Korn");
  const clickType = definition.getActions().indexOf("Talk-to") + 1;
  assert.ok(clickType > 0);
  assert.equal(PM.emitNpcInteraction({ player: f.p, npc: f.npc, npcId: f.npc.getId(), definition, clickType, handled: false }), true);
}
async function resume(f, choice) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  const widgetId = choice == null ? (group << 16) | ([231, 217].includes(group) ? 5 : 0) : core.MultiChatboxPrompt.OPTIONS_WIDGET_ID;
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId, childIndex: choice ?? -1 }]);
  f.connection.processTurnPackets();
}
async function menu(f, wanted) {
  for (let i = 0; i < 40; i++) {
    const pending = core.MultiChatboxPrompt.getPending(f.p);
    if (pending) {
      assert.ok(pending.options.includes(wanted), `missing ${wanted}: ${JSON.stringify(pending.options)}`);
      return pending;
    }
    assert.ok(f.p.getDialogueManager().getCurrent(), `conversation ended before ${wanted}`);
    await resume(f);
  }
  assert.fail(`conversation never reached ${wanted}`);
}
async function choose(f, wanted) {
  const pending = await menu(f, wanted);
  await resume(f, pending.options.indexOf(wanted) + 1);
}
async function drain(f) {
  for (let i = 0; i < 40; i++) {
    if (core.MultiChatboxPrompt.getPending(f.p) || !f.p.getDialogueManager().getCurrent()) return;
    const text = f.p.getDialogueManager().getCurrent().getText?.();
    if (text) f.history.push((Array.isArray(text) ? text.join(" ") : String(text)).replace(/\s+/g, " ").trim());
    await resume(f);
  }
  assert.fail("conversation did not finish");
}
async function line(f, wanted) {
  for (let i = 0; i < 40; i++) {
    assert.equal(core.MultiChatboxPrompt.getPending(f.p), null, "unexpected choice before target line");
    const current = f.p.getDialogueManager().getCurrent();
    assert.ok(current, `conversation ended before ${wanted}`);
    const raw = current.getText?.();
    const text = Array.isArray(raw) ? raw.join(" ") : String(raw ?? "");
    if (text.includes(wanted)) return;
    await resume(f);
  }
  assert.fail(`conversation never reached ${wanted}`);
}
function coins(p, amount) { p.getInventory().adds(core.ItemIdentifiers.COINS, amount); }
function fillTo(p, free) {
  for (let i = 0; i < 28 && p.getInventory().getFreeSlots() > free; i++)
    p.getInventory().adds(core.ItemIdentifiers.BONES, 1);
  assert.equal(p.getInventory().getFreeSlots(), free);
}
function amount(p, id) { return p.getInventory().getAmount(id); }
function inventoryState(p) {
  return p.getInventory().getValidItems().map(item => [item.getId(), item.getAmount()])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
const CAPE_OPTION = "Can I get a cape like yours?";
const YES = "Okay, here's 99,000 coins.";

test("incomplete diary uses the ordinary conversation; completing the last task does not grant a cape", async t => {
  const f = actor(t), { diary, last } = completeAllButLast(f.p);
  assert.equal(allComplete(f.p), false);
  talk(f);
  const pending = await menu(f, "That's a nice cape - please tell me about it.");
  assert.ok(!pending.options.includes(CAPE_OPTION));
  f.p.closeInterruptibleInterfaces();
  completeLast(f.p, diary, last);
  assert.equal(allComplete(f.p), true);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 0);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE_T_), 0);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 0);
});

test("real Talk-to and decoded confirmation sell one set and reject replayed input", async t => {
  const f = actor(t); qualify(f.p); coins(f.p, 198000); fillTo(f.p, 4);
  const bones = amount(f.p, core.ItemIdentifiers.BONES);
  const quests = { player: f.p, canUse: null };
  PM.emitCustomEvent("quest-cape:can-use", quests);
  assert.equal(quests.canUse, false, "the registered quest-cape response is false for this fixture");
  talk(f); await choose(f, CAPE_OPTION); await choose(f, YES); await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 99000);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 1);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 1);
  assert.equal(amount(f.p, core.ItemIdentifiers.BONES), bones);
  assert.ok(f.messages.some(text => String(text).includes("Twiggy sells you a cape and hood")));
  await resume(f, 1); await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 99000);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 1);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 1);
  assert.equal(amount(f.p, core.ItemIdentifiers.BONES), bones);
});

test("exact coins and two pre-payment spaces are sufficient", async t => {
  const f = actor(t); qualify(f.p); coins(f.p, 99000); fillTo(f.p, 2);
  const bones = amount(f.p, core.ItemIdentifiers.BONES);
  talk(f); await choose(f, CAPE_OPTION); await choose(f, YES); await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 0);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 1);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 1);
  assert.equal(amount(f.p, core.ItemIdentifiers.BONES), bones);
});

test("exact payment does not make one pre-payment free slot sufficient", async t => {
  const f = actor(t); qualify(f.p); coins(f.p, 99000); fillTo(f.p, 1);
  const before = inventoryState(f.p);
  talk(f); await choose(f, CAPE_OPTION); await drain(f);
  assert.equal(core.MultiChatboxPrompt.getPending(f.p), null);
  assert.ok(f.history.some(text => text.includes("free up some space")), `unexpected dialogue: ${JSON.stringify(f.history)}`);
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 99000);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 0);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 0);
  assert.deepEqual(inventoryState(f.p), before);
});

test("insufficient coins do not sell a set", async t => {
  const f = actor(t); qualify(f.p); coins(f.p, 98999);
  const before = inventoryState(f.p);
  talk(f); await choose(f, CAPE_OPTION); await drain(f);
  assert.equal(core.MultiChatboxPrompt.getPending(f.p), null);
  assert.ok(f.history.some(text => text.includes("capes cost 99,000 coins")));
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 98999);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 0);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 0);
  assert.deepEqual(inventoryState(f.p), before);
});

test("cancelling confirmation preserves coins and items", async t => {
  const f = actor(t); qualify(f.p); coins(f.p, 99000);
  const before = inventoryState(f.p);
  talk(f); await choose(f, CAPE_OPTION); await choose(f, "Actually, forget it."); await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 99000);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 0);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 0);
  assert.deepEqual(inventoryState(f.p), before);
});

test("the costs-question route reaches the same single purchase", async t => {
  const f = actor(t); qualify(f.p); coins(f.p, 100000);
  talk(f); await choose(f, CAPE_OPTION); await choose(f, "What are your costs?");
  await choose(f, YES); await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 1000);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 1);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 1);
});

test("confirmation rechecks funds and never announces a failed sale", async t => {
  const f = actor(t); qualify(f.p); coins(f.p, 99000);
  talk(f); await choose(f, CAPE_OPTION); await choose(f, YES);
  await line(f, YES);
  f.p.getInventory().deleteNumber(core.ItemIdentifiers.COINS, 1);
  const before = inventoryState(f.p);
  await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 98999);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 0);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 0);
  assert.deepEqual(inventoryState(f.p), before);
  assert.ok(!f.messages.some(text => String(text).includes("Twiggy sells you a cape and hood")));
});

test("confirmation rechecks diary eligibility and inventory space", async t => {
  for (const change of ["diary", "space"]) {
    const f = actor(t); qualify(f.p); coins(f.p, 99000);
    talk(f); await choose(f, CAPE_OPTION); await choose(f, YES);
    await line(f, YES);
    if (change === "diary") {
      const { diary, last } = completeAllButLast(f.p);
      assert.ok(last && diary);
      assert.equal(allComplete(f.p), false);
    } else fillTo(f.p, 1);
    const before = inventoryState(f.p);
    await drain(f);
    assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 99000, change);
    assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 0, change);
    assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 0, change);
    assert.deepEqual(inventoryState(f.p), before, change);
    assert.ok(!f.messages.some(text => String(text).includes("Twiggy sells you a cape and hood")), change);
  }
});

test("a controlled all-quests response selects the trimmed cape", async t => {
  const f = actor(t); qualify(f.p); coins(f.p, 99000);
  // This exercises the registered consumer with a controlled response, not a
  // claim that every live cache quest is implemented or completed in this fixture.
  const hooks = PM.customEventHooks.get("quest-cape:can-use");
  const count = hooks.length;
  t.after(() => hooks.splice(count));
  PM.createApi("DiaryCapeQuestResponseTest").onCustomEvent("quest-cape:can-use", request => {
    if (request.player === f.p) request.canUse = true;
  });
  talk(f); await choose(f, CAPE_OPTION); await choose(f, YES); await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 0);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE_T_), 1);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 1);
});

test("a banked cape reaches the owned conversation and buys another set", async t => {
  const f = actor(t); qualify(f.p); coins(f.p, 100000);
  f.p.getBank(0).adds(core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE, 1);
  talk(f); await choose(f, "Cape"); await choose(f, "Can I buy another cape?");
  await choose(f, "I want another set. Here's 99,000 coins."); await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 1000);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 1);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 1);
  assert.equal(f.p.getBank(0).getAmount(core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 1);
});

test("a cape in inventory reaches the owned conversation", async t => {
  const f = actor(t); qualify(f.p);
  f.p.getInventory().adds(core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE, 1);
  talk(f);
  const pending = await menu(f, "Hood");
  assert.ok(pending.options.includes("Cape"));
});

test("worn-only cape uses the completed-diary conversation; retail variant priority is unknown", async t => {
  const f = actor(t); qualify(f.p);
  f.p.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE, 1));
  talk(f);
  const pending = await menu(f, CAPE_OPTION);
  assert.ok(!pending.options.includes("Hood"));
});

test("owned-cape repeat purchase still checks two pre-payment spaces", async t => {
  const f = actor(t); qualify(f.p); coins(f.p, 99000);
  f.p.getBank(0).adds(core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE, 1);
  fillTo(f.p, 1);
  const before = inventoryState(f.p);
  talk(f); await choose(f, "Cape"); await choose(f, "Can I buy another cape?"); await drain(f);
  assert.equal(core.MultiChatboxPrompt.getPending(f.p), null);
  assert.ok(f.history.some(text => text.includes("free up some space")));
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 99000);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE), 0);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 0);
  assert.deepEqual(inventoryState(f.p), before);
});

test("owned-cape hood choice gives one free hood and ignores replayed input", async t => {
  const f = actor(t); qualify(f.p);
  f.p.getBank(0).adds(core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE_T_, 1);
  talk(f); await choose(f, "Hood"); await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 1);
  assert.equal(amount(f.p, core.ItemIdentifiers.COINS), 0);
  await resume(f, 1); await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 1);
});

test("owned-cape free hood requires space at the handout", async t => {
  const f = actor(t); qualify(f.p);
  f.p.getBank(0).adds(core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE, 1);
  talk(f); await menu(f, "Hood");
  await choose(f, "Hood");
  // Change the inventory after the affirmative branch is chosen and before its handout.
  await line(f, "Most certainly, and free of charge!");
  fillTo(f.p, 0);
  const before = inventoryState(f.p);
  await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 0);
  assert.deepEqual(inventoryState(f.p), before);
  assert.ok(!f.messages.some(text => String(text).includes("Twiggy hands you another hood")));
});

function withdrawLeavingPlaceholder(f, id) {
  const bank = f.p.getBank(0);
  f.p.setPlaceholders(true);
  assert.ok(core.ItemDefinition.forId(id).getPlaceholderId() >= 0, "the active cache supports a cape placeholder");
  bank.adds(id, 1);
  bank.open();
  assert.equal(core.Bank.isOpen(f.p), true, "real bank is open before withdrawal");
  const slot = bank.getSlotForItemId(id);
  assert.ok(slot >= 0);
  core.Bank.withdraw(f.p, id, slot, 1, 0);
  assert.equal(f.p.getInventory().getAmount(id), 1, "the real bank withdrawal delivered the cape");
  assert.equal(bank.getItems()[slot].getId(), id, "withdrawal retained the original cape ID");
  assert.equal(bank.getItems()[slot].getAmount(), 0, "withdrawal produced a zero-amount placeholder");
  assert.equal(bank.contains(id), true, "contains includes that row");
  assert.equal(bank.getAmount(id), 0, "the bank contains no actual cape");
  f.p.getInventory().deleteNumber(id, 1); // The withdrawn cape is subsequently lost.
  for (const cape of [core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE_T_]) {
    assert.equal(f.p.getInventory().getAmount(cape), 0);
    assert.equal(f.p.getEquipment().getAmount(cape), 0);
  }
  f.p.closeInterruptibleInterfaces();
  assert.equal(core.Bank.isOpen(f.p), false, "Twiggy is reached after closing the bank");
  return bank;
}

test("a real zero-amount cape placeholder does not select the owned conversation", async t => {
  for (const id of [core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE, core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE_T_]) {
    const f = actor(t); qualify(f.p);
    const bank = withdrawLeavingPlaceholder(f, id);
    const before = inventoryState(f.p);
    talk(f);
    const pending = await menu(f, CAPE_OPTION);
    assert.ok(!pending.options.includes("Hood"));
    assert.equal(bank.contains(id), true);
    assert.equal(bank.getAmount(id), 0);
    assert.deepEqual(inventoryState(f.p), before);
  }
});

test("a real banked cape still selects the owned conversation beside another placeholder", async t => {
  const f = actor(t); qualify(f.p);
  const empty = core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE;
  const held = core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE_T_;
  const bank = withdrawLeavingPlaceholder(f, empty);
  f.p.getBank(1).adds(held, 1);
  assert.equal(bank.contains(empty), true);
  assert.equal(bank.getAmount(empty), 0);
  assert.equal(f.p.getBank(1).getAmount(held), 1);
  talk(f); await choose(f, "Hood"); await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 1);
  assert.equal(f.p.getBank(1).getAmount(held), 1);
  assert.equal(bank.getAmount(empty), 0);
});

test("an owned-hood handout is refused if the banked cape becomes a placeholder", async t => {
  const f = actor(t); qualify(f.p);
  const id = core.ItemIdentifiers.ACHIEVEMENT_DIARY_CAPE, bank = f.p.getBank(0);
  bank.adds(id, 1);
  assert.equal(bank.getAmount(id), 1);
  talk(f); await choose(f, "Hood");
  await line(f, "Most certainly, and free of charge!");
  // Simulate an intervening ownership change while the existing dialogue is open.
  const slot = bank.getSlotForItemId(id);
  assert.ok(slot >= 0);
  bank.getItems()[slot].setAmount(0);
  assert.equal(bank.contains(id), true);
  assert.equal(bank.getAmount(id), 0);
  const before = inventoryState(f.p);
  await drain(f);
  assert.equal(amount(f.p, core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD), 0);
  assert.deepEqual(inventoryState(f.p), before);
  assert.ok(!f.messages.some(text => String(text).includes("Twiggy hands you another hood")));
});
