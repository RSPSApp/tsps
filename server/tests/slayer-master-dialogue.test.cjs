// Run after `yarn build`: node --test tests/slayer-master-dialogue.test.cjs
// Slayer masters' talk, played by the real dialogue engine: Assignment and Talk-to's
// "I need another assignment.", the menu after a new task, cancelling, Steve's master talk and
// the equipment shop's title.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Location } = require("../dist/game/model/Location");

let core;
let Tasks;
let State;
let nextIndex = 1900;

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  new NpcDefinitionLoader().load();
  const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
  new ShopDefinitionLoader().load();
  require("../dist/game/model/container/shop/ShopManager").ShopManager.initialize();
  core = PluginManager.getCoreApi();
  require("../plugins/skills/Slayer.plugin").register(PluginManager.createApi("Slayer"));
  require("../plugins/npcs/NpcDialogues.plugin").register(PluginManager.createApi("NpcDialogues"));
  Tasks = require("../plugins/skills/slayer/Tasks.Slayer");
  State = require("../plugins/skills/slayer/State.Slayer");
});

const ASSIGNMENT = "I need another assignment.";
const MENU = ["Got any tips for me?", "Can I cancel that task? (30 Points)", "Okay, great!"];
const GOOD_LUCK = "Good luck! Don't forget to come back when you need a new assignment.";

/** A logged-in player beside a spawned master, driven through the client's packets. */
function harness(npcId, { points = 0, at = new Location(3089, 3524, 0) } = {}) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const channel = { kind: "test", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session, at);
  session.setPlayer(player);
  player.setIndex(nextIndex++);
  player.setUsername(`slayertalk${nextIndex}`);
  player.setRegistered(true);
  for (const skill of core.Skill.values()) player.getSkillManager().setMaxLevels(skill, 99, false);
  State.setVarbit(player, "slayer_points", points);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const npc = PluginManager.spawnNpc({ id: npcId, x: at.getX() + 1, y: at.getY(), z: at.getZ(), wanderRadius: 0 });
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  const lines = [];
  const record = () => {
    const current = player.getDialogueManager().getCurrent();
    const text = current?.getText?.();
    if (text) lines.push(text);
  };
  return {
    player, npc, lines,
    async option(name) {
      const actions = npc.getCurrentDefinition(player).getActions();
      assert.ok(actions.includes(name), `${name} in ${actions}`);
      await send({ type: "npc_option", index: npc.getIndex(), clickType: actions.indexOf(name) + 1 });
      for (let i = 0; i < 5 && !player.getDialogueManager().isActive() && !core.MultiChatboxPrompt.getPending(player); i++) TaskManager.process();
      record();
    },
    /** Continues until a menu shows or the talk ends; returns the menu's options (or null). */
    async toMenu() {
      for (let i = 0; i < 20; i++) {
        const pending = core.MultiChatboxPrompt.getPending(player);
        if (pending) return pending.options;
        if (!player.getDialogueManager().isActive()) return null;
        const group = player.getPacketSender().getChatboxGroupId();
        await send({ type: "dialogue_continue", widgetId: (group << 16) | (group === 229 ? 4 : 5), childIndex: -1 });
        record();
      }
      return null;
    },
    async choose(text) {
      const pending = core.MultiChatboxPrompt.getPending(player);
      assert.ok(pending, text);
      const index = pending.options.indexOf(text);
      assert.ok(index >= 0, `${text} in ${pending.options}`);
      await send({ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
      record();
    },
    async talkToAssignment() {
      await this.option("Talk-to");
      for (let i = 0; i < 4; i++) {
        const options = await this.toMenu();
        if (options?.includes(ASSIGNMENT)) return this.choose(ASSIGNMENT);
        assert.ok(options, "a menu with the assignment option");
        await this.choose(options[0]);
      }
      assert.fail("no assignment option");
    },
    close() {
      player.setRegistered(false);
      PluginManager.removeNpc(npc);
      core.TaskManager.cancelTasks(player.getIndex());
    },
  };
}

const id = (name) => core.CacheDefinitions.getNpcId(name);
/** Duradel, as the slayer_master_5 multinpc shows him. */
const DURADEL = 13622;

test("Assignment: the task line, then tips, cancel (with 30 points) and okay", async () => {
  const h = harness(DURADEL, { points: 37 });
  try {
    await h.option("Assignment");
    const task = Tasks.current(h.player);
    assert.ok(task, "a task is set");
    assert.equal(h.lines.at(-1), `Your new task is to kill ${task.count} ${task.task.displayName}.`);
    assert.deepEqual(await h.toMenu(), MENU);
    await h.choose(MENU[1]);
    assert.equal(h.lines.at(-1), "Your task has been cancelled.");
    assert.equal(Tasks.current(h.player), null, "the task is gone");
    assert.equal(State.varbit(h.player, "slayer_points"), 7);
    await h.toMenu();
    assert.deepEqual(h.lines.slice(-3), ["Your task has been cancelled.", "Okay, great!", GOOD_LUCK]);
    assert.equal(h.player.getDialogueManager().isActive(), false);
  } finally { h.close(); }
});

test("below 30 points the menu has no cancel; Okay, great! ends with the master's good luck", async () => {
  const h = harness(DURADEL, { points: 7 });
  try {
    await h.option("Assignment");
    assert.deepEqual(await h.toMenu(), [MENU[0], MENU[2]]);
    await h.choose(MENU[2]);
    await h.toMenu();
    assert.deepEqual(h.lines.slice(-2), ["Okay, great!", GOOD_LUCK]);
    assert.ok(Tasks.current(h.player), "the task is kept");
  } finally { h.close(); }
});

test("Got any tips for me? gives the task's tip", async () => {
  const h = harness(DURADEL);
  try {
    await h.option("Assignment");
    await h.toMenu();
    await h.choose(MENU[0]);
    await h.toMenu();
    assert.equal(h.lines.at(-1), "Great, thanks!");
    assert.equal(h.lines.at(-3), "Got any tips for me?");
  } finally { h.close(); }
});

for (const [name, npcId, praise] of [
  ["Duradel", 13622, true],
  ["Kuradal", 13623, true],
  ["Achtryn", 13621, true],
  ["Aya", 13619, true],
  ["Konar", 8623, false],
]) {
  test(`${name}: Talk-to > "${ASSIGNMENT}" assigns a task and shows the menu`, async () => {
    const h = harness(npcId, { points: 40 });
    try {
      await h.talkToAssignment();
      const options = await h.toMenu();
      const task = Tasks.current(h.player);
      assert.ok(task, "a task is set");
      const line = h.lines.at(-1);
      assert.ok(!/\[|\b0 \./.test(line), line);
      assert.match(line, new RegExp(`\\b${task.count}\\b`));
      assert.equal(line.startsWith("Excellent, you're doing great. "), praise, line);
      assert.equal(h.lines.at(-2), ASSIGNMENT);
      assert.deepEqual(options, MENU);
    } finally { h.close(); }
  });
}

test("Talk-to with a task held still gives the transcript's still-hunting line", async () => {
  const h = harness(DURADEL);
  try {
    await h.option("Assignment");
    h.player.getPacketSender().sendInterfaceRemoval();
    h.player.getDialogueManager().reset();
    await h.talkToAssignment();
    await h.toMenu();
    assert.match(h.lines.at(-1), /^You're still hunting /);
  } finally { h.close(); }
});

test("Steve as a Slayer master greets as the masters do; the wyvern-cave Steve keeps his own talk", async () => {
  const master = harness(id("slayer_master_steve"));
  try {
    await master.option("Talk-to");
    assert.equal(master.lines[0], "'Ello, and what are you after then?");
    await master.talkToAssignment();
    await master.toMenu();
    assert.ok(Tasks.current(master.player), "Steve assigns a task");
    assert.match(master.lines.at(-1), /^Excellent, you're doing great\. Your new task is to kill \d+ /);
  } finally { master.close(); }
  const cave = harness(6799);
  try {
    await cave.option("Talk-to");
    assert.equal(cave.lines[0], "Welcome to my private little wyvern area.");
  } finally { cave.close(); }
});

test("the equipment shop's title has no ' (shop)'", async () => {
  const h = harness(DURADEL);
  try {
    const scripts = [];
    const sender = h.player.getPacketSender();
    const original = sender.sendInterfaceScript.bind(sender);
    sender.sendInterfaceScript = (scriptId, args) => { scripts.push([scriptId, args]); return original(scriptId, args); };
    await h.option("Trade");
    const init = scripts.find(([scriptId]) => scriptId === 1074);
    assert.ok(init, "the shop opened");
    assert.equal(init[1][1], "Slayer Equipment");
  } finally { h.close(); }
});
