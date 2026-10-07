// Run after `yarn build`: node --test tests/stronghold-of-security.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { Location } = require("../dist/game/model/Location");
const { Skill } = require("../dist/game/model/Skill");
const { Sounds } = require("../dist/game/Sounds");
const Sos = require("../plugins/areas/strongholdofsecurity/StrongholdOfSecurity.plugin");
const Data = require("../plugins/areas/strongholdofsecurity/SosData");
const Doors = require("../plugins/areas/strongholdofsecurity/SosDoors");
const Rewards = require("../plugins/areas/strongholdofsecurity/SosRewards");
const Travel = require("../plugins/areas/strongholdofsecurity/SosTravel");

const tasks = [];
const prompts = [];
const events = [];
const sounds = [];
Sounds.sendSound = (_player, sound) => sounds.push(sound.getId?.() ?? sound.id);
Sos.register(new Proxy({
  getTaskManager: () => ({ submit: (task) => { task.setRunning(true); tasks.push(task); } }),
  sendMultiChatboxPrompt: (player, title, ...pairs) => prompts.push({ title, pairs }),
  emitCustomEvent: (name, event) => events.push({ name, ...event }),
}, { get: (target, key) => target[key] ?? (() => {}) }));

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  for (const [x, y] of [[2039, 5244], [2356, 5218]]) RegionManager.loadMapFiles(x, y);
});

function createPlayer({ x = 2040, y = 5244, combat = 3, free = 28 } = {}) {
  const log = [];
  const attributes = new Map();
  const inventory = [];
  const levels = new Map(Skill.values().map((skill) => [skill, 99]));
  let location = new Location(x, y, 0);
  let chain = null;
  let at = 0;
  const sender = {
    sendVarbit: (id, value) => { log.push(`varbit ${id}=${value}`); return sender; },
    sendInterface: (id) => { log.push(`open ${id}`); return sender; },
    sendInterfaceScript: () => sender,
    sendInterfaceRemoval: () => { log.push("close"); return sender; },
    sendJingle: (id) => { log.push(`jingle ${id}`); return sender; },
    sendCreationMenu: (menu) => { log.push(`menu ${menu.getTitle?.() ?? menu.title}`); player.menu = menu; return sender; },
  };
  const player = {
    log, inventory, levels,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => location,
    moveTo: (to) => { location = to; log.push(`move ${to.getX()},${to.getY()},${to.getZ()}`); },
    sendMessage: (message) => log.push(message),
    performAnimation: (animation) => log.push(`anim ${animation.getId()}`),
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {} }),
    getInventory: () => ({ adds: (id, amount) => inventory.push([id, amount]), getFreeSlots: () => free }),
    getSkillManager: () => ({
      getCombatLevel: () => combat,
      getMaxLevel: () => 99,
      getCurrentLevel: (skill) => levels.get(skill),
      setCurrentLevels: (skill, level) => levels.set(skill, level),
    }),
    getHitpoints: () => levels.get(Skill.HITPOINTS),
    setHitpoints: (value) => levels.set(Skill.HITPOINTS, value),
    getDialogueManager: () => manager,
    /** The player clicks continue: the manager advances one entry, as the real one does. */
    next: () => manager.advance(),
  };
  // Like DialogueManager: an entry is shown when reached; an action entry only runs its action.
  const show = () => {
    const entry = chain?.[at];
    if (!entry) return;
    const text = entry.text ?? entry.getText?.() ?? null;
    if (text !== null) log.push(`say ${entry.name ? `${entry.name}|` : ""}${text}`);
    else entry.send(player);
  };
  const manager = {
    startDialogues: (builder) => { chain = [...builder.getDialogues().values()]; at = 0; show(); },
    advance: () => { at++; show(); },
  };
  return player;
}

const runTicks = (n = 1) => { for (let i = 0; i < n; i++) for (const task of tasks.filter((t) => t.isRunning())) task.tick(); };
const door = (x, y) => (MapObjects.mapObjects.get(MapObjects.getHash(x, y, 0)) ?? []).find((o) => o.getType() === 0);
const openDoor = (player, object) => Doors.open({ player, object, definition: { getName: () => CacheDefinitions.getObject(object.getId()).name } });

test("the data: every object and boot item as the cache names it, 33 questions with responses", () => {
  const name = (id) => CacheDefinitions.getObject(id).name;
  assert.equal(name(Data.DATA.entrance.object), "Entrance");
  for (const floor of Data.DATA.floors) {
    assert.equal(name(floor.portal), "Portal");
    if (floor.down) assert.ok(["Ladder", "Dripping vine"].includes(name(floor.down)));
    for (const id of floor.up) assert.ok(["Ladder", "Dripping vine", "Bone Chain"].includes(name(id)));
  }
  assert.deepEqual(Data.DATA.boots.map((boot) => CacheDefinitions.getItem(boot.item).name), Data.DATA.boots.map((boot) => boot.name));
  assert.equal(Data.DATA.questions.length, 33);
  for (const question of Data.DATA.questions) {
    assert.ok(question.options.length >= 2, question.question);
    for (const option of question.options) assert.ok(option.text && option.response, question.question);
  }
});

test("as captured: a door speaks with its floor's door NPC as the head, door_chathead, under its name", () => {
  const { DoorChatDialogue } = require("../plugins/areas/strongholdofsecurity/SosDialogues");
  const calls = [];
  const sender = new Proxy({}, { get: (_t, method) => (...args) => { calls.push([method, ...args]); return sender; } });
  new DoorChatDialogue(0, 2495, "Rickety Door", "Correct!").send({ getPacketSender: () => sender });
  assert.deepEqual(calls.slice(0, 4), [
    ["sendChatboxInterface", 231],
    ["sendNpcHeadOnInterface", 2495, (231 << 16) | 2],
    ["sendInterfaceAnimation", (231 << 16) | 2, 4281],
    ["sendString", "Rickety Door", (231 << 16) | 4],
  ]);
  const npc = (id) => CacheDefinitions.getNpc(id).name;
  assert.deepEqual(Data.DATA.floors.map((floor) => npc(floor.doorHead)), ["Gate of War", "Ricketty door", "Oozing barrier", "Portal of Death"]);
});

test("as captured: entering the gap is free - busy, drag, sound; the move a tick later; then appear", () => {
  const player = createPlayer({ x: 2040, y: 5244 });
  tasks.length = 0;
  sounds.length = 0;
  openDoor(player, door(2039, 5244));
  assert.deepEqual(player.log, ["varbit 12393=1", "anim 4282"]);
  assert.deepEqual(sounds, [2858]);
  player.log.length = 0;
  runTicks();
  assert.deepEqual(player.log, ["move 2039,5244,0"]);
  player.log.length = 0;
  runTicks();
  assert.deepEqual(player.log, ["varbit 12393=0", "anim 4283"]);
});

test("as captured: leaving the gap asks; any answer gives its response and opens the door; that door is then free", () => {
  const player = createPlayer({ x: 2039, y: 5244 });
  tasks.length = 0;
  prompts.length = 0;
  openDoor(player, door(2039, 5244));
  assert.match(player.log[0], /^say Rickety Door\|To pass you must answer me this: /);
  player.next();
  const { pairs } = prompts.at(-1);
  const wrong = pairs.findIndex((entry, index) => index % 2 === 0 && !/^Correct/.test(Data.DATA.questions.find((q) => q.options.some((o) => o.text === entry))?.options.find((o) => o.text === entry)?.response ?? ""));
  pairs[(wrong >= 0 ? wrong : 0) + 1]();
  assert.match(player.log.at(-1), /^say Rickety Door\|/);
  player.log.length = 0;
  player.next();
  assert.deepEqual(player.log, ["close", "varbit 12393=1", "anim 4282", "move 2040,5244,0"], "even a wrong answer passes");
  player.log.length = 0;
  runTicks();
  assert.deepEqual(player.log, ["varbit 12393=0", "anim 4283"]);
  // Back in and out again through the door just answered: no question.
  player.log.length = 0;
  openDoor(player, door(2039, 5244));
  runTicks(2);
  openDoor(player, door(2039, 5244));
  assert.ok(!player.log.some((line) => line.startsWith("say ")));
});

test("the partner door asks again, and nothing asks once the Stronghold is complete (Wiki)", () => {
  const player = createPlayer({ x: 2037, y: 5244 });
  player.setAttribute(Doors.LAST_ANSWERED_ATTRIBUTE, "2039,5244,0");
  openDoor(player, door(2037, 5244));
  assert.match(player.log[0], /^say Rickety Door\|To pass/);
  const done = createPlayer({ x: 2037, y: 5244 });
  done.setAttribute(Data.CLAIMED_ATTRIBUTE, [0, 1, 2, 3]);
  openDoor(done, door(2037, 5244));
  assert.ok(!done.log.some((line) => line.startsWith("say ")));
  assert.equal(Doors.partnerOf(door(2356, 5218), "Portal of Death").getLocation().getY(), 5221, "the death floor's pairs too");
});

test("as captured: a chest speaks, then the emote, coins and jingle; once only; Box of Health restores", () => {
  const player = createPlayer();
  player.levels.set(Skill.ATTACK, 10);
  sounds.length = 0;
  Rewards.open({ player, definition: { getName: () => "Box of Health" } });
  assert.deepEqual(sounds, [1247]);
  assert.equal(player.log[0], "say The box hinges creak and appear to be forming audible words....");
  player.log.length = 0;
  player.next(); // one click: the reward, then straight on to the congratulations
  assert.deepEqual(player.log, [
    "varbit 2311=1",
    "You feel refreshed and renewed.",
    "jingle 177",
    "say ...congratulations adventurer, you have been deemed worthy of this reward. You have also unlocked the Idea emote!",
  ]);
  assert.deepEqual(player.inventory, [[995, 5000]]);
  assert.equal(player.levels.get(Skill.ATTACK), 99);
  player.log.length = 0;
  Rewards.open({ player, definition: { getName: () => "Box of Health" } });
  assert.deepEqual(player.log, ["say You have already claimed your reward from this level."]);
});

test("as captured: the Cradle of Life speaks, shows the boots, offers all three; the first pair unlocks Stamp Foot", () => {
  const player = createPlayer();
  Rewards.open({ player, definition: { getName: () => "Cradle of Life" } });
  for (let i = 0; i < 4; i++) player.next();
  assert.ok(player.log.includes("menu Select the boots you want."));
  assert.deepEqual(player.menu.getItems?.() ?? player.menu.items, [9005, 9006, 28672]);
  player.log.length = 0;
  player.menu.execute(28672, 1);
  assert.deepEqual(player.log.slice(0, 2), ["varbit 2312=1", "jingle 158"]);
  assert.equal(player.log.at(-1), "say You claim your prize: Fancier boots<br>You have unlocked the 'Stamp Foot' emote.");
  player.log.length = 0;
  Rewards.claimBoots(player, Data.FLOORS[3], 9005);
  assert.equal(player.log.at(-1), "say You claim your prize: Fancy boots", "more boots any time");
  assert.deepEqual(player.inventory, [[28672, 1], [9005, 1]]);
});

test("as captured: the ladder down warns, then climbs; floor 2 completes the Varrock diary task", () => {
  const player = createPlayer();
  tasks.length = 0;
  events.length = 0;
  Travel.climbDown({ player, object: { getId: () => 20785 } });
  assert.deepEqual(player.log, ["varbit 3854=1", "open 579"]);
  player.log.length = 0;
  Travel.warningClick({ player, buttonId: (579 << 16) | 17 });
  assert.deepEqual(player.log, ["close", "anim 828"]);
  player.log.length = 0;
  runTicks();
  assert.deepEqual(player.log, ["You climb down the ladder to the next level.", "move 2042,5245,0"]);
  assert.deepEqual(events.map((e) => [e.name, e.diary, e.task]), [["diary:task", "varrock", "enter-the-second-level-of-the-stronghold-of-secu"]]);
  // "Don't ask me this again".
  Travel.warningClick({ player, buttonId: (579 << 16) | 20 });
  player.log.length = 0;
  Travel.climbDown({ player, object: { getId: () => 19004 } });
  assert.deepEqual(player.log, ["anim 828"]);
});

test("as captured: portals need the floor done (or the Wiki's combat level); entrance, up-ladders and the bone chain", () => {
  const low = createPlayer({ combat: 20 });
  Travel.usePortal({ player: low, object: { getId: () => 20786 } });
  assert.deepEqual(low.log, ["You must have completed this level to take this shortcut."]);
  const high = createPlayer({ combat: 26 });
  Travel.usePortal({ player: high, object: { getId: () => 20786 } });
  assert.deepEqual(high.log, ["You enter the portal to be whisked through to the treasure room.", "move 1914,5222,0"]);
  const death = createPlayer({ combat: 126 });
  Travel.usePortal({ player: death, object: { getId: () => 23922 } });
  assert.deepEqual(death.log, ["You must have completed this level to take this shortcut."], "floor 4: only once done");

  const player = createPlayer();
  Travel.enter({ player, object: { getId: () => 20790 } });
  assert.deepEqual(player.log, ["move 1859,5243,0", "say You squeeze through the hole and find a ladder a few feet down leading into the Stronghold of Security."]);
  assert.equal(Travel.enter({ player, object: { getId: () => 1 } }), false, "other entrances are not ours");
  events.length = 0;
  Travel.climbUp({ player, object: { getId: () => 19003 } });
  assert.equal(events[0].name, "ladders:climbUp");
  assert.equal(`${events[0].destination.getX()},${events[0].destination.getY()}`, "1902,5221");
  player.log.length = 0;
  Travel.climbUp({ player, object: { getId: () => 23732 } });
  assert.deepEqual(player.log, [
    "You shin up the rope, squeeze through a passage then climb a ladder.",
    "You climb up the ladder which seems to twist and wind in all directions.",
    "move 3081,3421,0",
  ]);
  assert.equal(Travel.climbDown({ player, object: { getId: () => 1 } }), false, "other ladders fall through");
});
