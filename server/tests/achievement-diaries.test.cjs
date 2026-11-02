// Run after `yarn build`: node --test tests/achievement-diaries.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const QuestRuntime = require("../plugins/quests/QuestRuntime");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Journal = require("../plugins/achievements/diaries/Journal.AchievementDiaries");
const Rewards = require("../plugins/achievements/diaries/Rewards.AchievementDiaries");
const Lamps = require("../plugins/achievements/diaries/Lamps.AchievementDiaries");
const CAPTURED = require("./fixtures/achievement-diary-journals.json").journals;

const tasks = [];
const xpRewards = [];
const SKILLS = ["Attack", "Smithing"].map((name) => ({ getName: () => name }));
Diaries.register(new Proxy({
  core: {
    Skill: { values: () => SKILLS },
    Task: require("../dist/game/task/Task").Task,
    DialogueChainBuilder: require("../dist/game/model/dialogues/builders/DialogueChainBuilder").DialogueChainBuilder,
    StatementDialogue: require("../dist/game/model/dialogues/entries/impl/StatementDialogue").StatementDialogue,
    EndDialogue: require("../dist/game/model/dialogues/entries/impl/EndDialogue").EndDialogue,
    PlayerRights: require("../dist/game/model/rights/PlayerRights").PlayerRights,
    Bank: require("../dist/game/model/container/impl/Bank").Bank,
  },
  getTaskManager: () => ({ submit: (task) => { task.setRunning(true); tasks.push(task); } }),
  emitCustomEvent: (name, request) => { if (name === "xpreward:open") xpRewards.push(request); },
}, { get: (target, key) => target[key] ?? (() => {}) }));

const dialogues = [];
QuestRuntime.startDialogue = (_api, _player, _context, steps) => {
  dialogues.push(steps);
  for (const step of steps) step.exec?.();
};

function createPlayer({ freeSlots = 28, levels = {} } = {}) {
  const log = [];
  const attributes = new Map();
  const inventory = [];
  let interfaceId = -1;
  const sender = {
    sendVarbit: (id, value) => { log.push(`varbit ${id}=${value}`); return sender; },
    sendConfig: (id, value) => { log.push(`varp ${id}=${value}`); return sender; },
    sendInterfaceScript: (id, args = []) => { log.push(`script ${id} [${args}]`); return sender; },
    sendString: (text, uid) => { log.push(`text ${uid >> 16}:${uid & 0xffff} ${text}`); return sender; },
    sendSubInterface: (_target, group) => { log.push(`open ${group}`); return sender; },
    sendInterfaceRemoval: () => { log.push(`close ${interfaceId}`); return sender; },
  };
  return {
    log,
    inventory,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => log.push(message),
    isRegistered: () => true,
    setInterfaceId: (id) => { interfaceId = id; },
    getDialogueManager: () => ({ startDialogues: (chain) => log.push(`mesbox ${JSON.stringify(chain)}`.slice(0, 40)) }),
    getInventory: () => ({
      getFreeSlots: () => freeSlots,
      adds: (id) => inventory.push(id),
      contains: (id) => inventory.includes(id),
      get: (slot) => inventory[slot],
      deleteAtSlot: (slot) => inventory.splice(slot, 1),
    }),
    getEquipment: () => ({ contains: () => false }),
    getBanks: () => [],
    getSkillManager: () => {
      const xp = new Map();
      return {
        getCurrentLevel: (skill) => levels[skill.getName()] ?? 99,
        getMaxLevel: (skill) => levels[skill.getName()] ?? 99,
        getExperience: (skill) => xp.get(skill) ?? 0,
        addExperience: (skill, amount) => { xp.set(skill, (xp.get(skill) ?? 0) + amount); log.push(`xp ${skill.getName()} ${amount}`); },
      };
    },
  };
}

const ARDOUGNE = Data.BY_KEY.get("ardougne");
const runTasks = () => { for (const task of tasks.filter((t) => t.isRunning())) task.tick(); };

test("the data: every diary and tier, its varbits in the cache, its tasks, rewards and NPC", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  assert.equal(Data.DIARIES.length, 12);
  const width = (id) => { const v = CacheDefinitions.getVarbit(id); assert.ok(v, `varbit ${id}`); return v.endBit - v.startBit + 1; };
  const npcs = new Set();
  for (let id = 0; id < 16000; id++) {
    const npc = CacheDefinitions.getNpc(id);
    if (npc?.actions?.includes("Talk-to")) npcs.add(npc.name);
  }
  for (const diary of Data.DIARIES) {
    assert.equal(width(diary.startedVarbit) >= 1, true);
    assert.ok(npcs.has(diary.npc), `${diary.npc} can be talked to`);
    Data.TIERS.forEach((tier, index) => {
      const data = diary.tiers[tier];
      assert.ok(data.tasks.length > 0, `${diary.name} ${tier}`);
      assert.ok(2 ** width(data.countVarbit) > data.tasks.length, `${diary.name} ${tier} count fits`);
      assert.equal(width(data.completeVarbit), data.completeValue === 2 ? 2 : 1);
      assert.equal(width(data.rewardVarbit), 1);
      const [item, lamp] = data.rewardItems;
      assert.equal(CacheDefinitions.getItem(item).name, `${diary.itemNoun} ${index + 1}`);
      assert.equal(CacheDefinitions.getItem(lamp).name, "Antique lamp");
      assert.ok(Data.LAMPS.has(lamp));
      assert.ok(data.claim.some((step) => step.reward), `${diary.name} ${tier} claim gives the reward`);
    });
  }
});

test("as captured (Ardougne easy): message and count on the tick, started on the first, tier done 3 ticks after the last", () => {
  const player = createPlayer();
  tasks.length = 0;
  const easy = ARDOUGNE.tiers.easy.tasks;
  const request = { player, diary: "ardougne", task: easy[0].key };
  Diaries._test.onTask(request);
  assert.equal(request.completed, true);
  assert.deepEqual(player.log, [
    "<col=dc143c>Well done! You have completed an easy task in the Ardougne area. Your Achievement Diary has been updated.</col>",
    "varbit 6291=1",
    "varbit 4448=1",
  ]);
  player.log.length = 0;
  Diaries._test.onTask(request);
  assert.equal(request.completed, false, "only once");
  assert.deepEqual(player.log, []);
  for (const task of easy.slice(1)) Progress.completeTask(player, ARDOUGNE, task.key);
  assert.equal(player.log.at(-1), "varbit 6291=10");
  player.log.length = 0;
  runTasks(); runTasks();
  assert.deepEqual(player.log, [], "not yet");
  runTasks();
  assert.equal(player.log[0], "varbit 4458=1");
  assert.match(player.log[1], /^mesbox/);
  const query = { player, diary: "ardougne", tier: "easy" };
  Diaries._test.onIsComplete(query);
  assert.equal(query.complete, true);
  const all = { player };
  Diaries._test.onAllComplete(all);
  assert.equal(all.complete, false, "the other diaries are not done");
});

test("saves from before the attribute rename keep their progress", () => {
  const player = createPlayer();
  const easy = ARDOUGNE.tiers.easy.tasks.map((task) => task.key);
  player.setAttribute("diary.ardougne.tasks", easy);
  player.setAttribute("diary.ardougne.rewards", ["easy"]);
  Progress.restore({ player });
  assert.equal(Progress.tierCount(player, ARDOUGNE, "easy"), easy.length);
  assert.ok(Progress.claimedTiers(player, ARDOUGNE).has("easy"));
  assert.equal(player.getAttribute("diary.ardougne.tasks"), null, "the old key is cleared, so it is no longer saved");
});

test("every captured task list is rebuilt line for line from the progress it shows", () => {
  for (const diary of Data.DIARIES) {
    const captured = CAPTURED[diary.name];
    const player = createPlayer();
    // Which tasks the capture shows struck through, tier by tier (two tiers can share a first line).
    const headers = captured.map((line, index) => (/^<col=(ffff00|00ff00)>(Easy|Medium|Hard|Elite)$/.test(line) ? index : -1)).filter((index) => index >= 0);
    const done = Data.TIERS.flatMap((tier, t) => {
      const section = captured.slice(headers[t], headers[t + 1] ?? captured.length).join("\n");
      return diary.tiers[tier].tasks.filter((task) => section.includes(task.lines.map((line) => `<str>${line}`).join("\n"))).map((task) => task.key);
    });
    player.setAttribute(Progress.TASKS_ATTRIBUTE, { [diary.key]: done });
    const claimed = Data.TIERS.filter((tier, index) => captured.filter((line) => line.includes("If I ever lose my")).length > index);
    player.setAttribute(Progress.REWARDS_ATTRIBUTE, { [diary.key]: claimed });
    assert.deepEqual(Journal.journalLines(player, diary), captured, diary.name);
  }
});

test("as captured: clicking a diary opens its list in the journal scroll; closing clears busy", () => {
  const player = createPlayer();
  Journal.click({ player, buttonId: (259 << 16) | 2, opId: 1, slot: 1 });
  const lines = Journal.journalLines(player, ARDOUGNE);
  assert.deepEqual(player.log.slice(0, 4), [`varp 334=${lines.length}`, "varbit 12393=1", "script 6844 []", "text 741:2 <col=800000>Achievement Diary - Ardougne"]);
  assert.equal(player.log[4], "text 741:4 <col=ffff00>Ardougne Area Tasks");
  assert.deepEqual(player.log.slice(-3), ["script 2524 [-1,-1]", "open 741", `script 6845 [1,${lines.length}]`]);
  player.log.length = 0;
  Journal.click({ player, buttonId: (741 << 16) | 205, opId: 1 });
  Journal.closed({ player, interfaceId: 741 });
  assert.deepEqual(player.log, ["close 741", "varbit 12393=0"]);
});

test("as captured (Two-pints): the claim conversation, the cloak and lamp after \"Yes please!\", then the reward varbit", () => {
  const player = createPlayer();
  const talk = () => Rewards.talkTo({ player, definition: { getName: () => "Two-pints", getId: () => 5519 } });
  assert.equal(talk(), false, "nothing to claim: the transcript plays");
  for (const task of ARDOUGNE.tiers.easy.tasks) Progress.completeTask(player, ARDOUGNE, task.key);
  player.log.length = 0;
  dialogues.length = 0;
  assert.equal(talk(), true);
  const steps = dialogues[0];
  assert.deepEqual(steps.slice(0, 3).map((step) => step.player?.[0] ?? step.npc?.[0]), [
    "I've completed all of the easy tasks in my Ardougne achievement diary!",
    "I can see that, well done! You'll be wanting your reward then!",
    "Yes please!",
  ]);
  assert.ok(steps[3].exec, "the reward comes next");
  assert.equal(steps.at(-1).npc[0], "If you ever lose your cloak, come back to me to reclaim it.");
  assert.deepEqual(player.inventory, [13121, 13145]);
  assert.deepEqual(player.log, ["varbit 4499=1"]);
  assert.equal(talk(), false, "claimed");
});

test("claiming: full inventory, the elite skill requirement, and a lost item handed back", () => {
  const cramped = createPlayer({ freeSlots: 1 });
  for (const task of ARDOUGNE.tiers.easy.tasks) Progress.completeTask(cramped, ARDOUGNE, task.key);
  cramped.log.length = 0;
  Rewards.talkTo({ player: cramped, definition: { getName: () => "Two-pints", getId: () => 5519 } });
  assert.deepEqual(cramped.log, ["You need 2 free inventory spaces to claim your reward."]);

  const smith = createPlayer({ levels: { Smithing: 90 } });
  for (const tier of Data.TIERS) for (const task of ARDOUGNE.tiers[tier].tasks) Progress.completeTask(smith, ARDOUGNE, task.key);
  for (const tier of ["easy", "medium", "hard"]) Progress.claimTier(smith, ARDOUGNE, tier);
  dialogues.length = 0;
  Rewards.talkTo({ player: smith, definition: { getName: () => "Two-pints", getId: () => 5519 } });
  assert.match(dialogues[0][1].npc[0], /Smithing level of 91/);
  assert.ok(!Progress.claimedTiers(smith, ARDOUGNE).has("elite"));

  const player = createPlayer();
  Progress.claimTier(player, ARDOUGNE, "easy");
  Progress.claimTier(player, ARDOUGNE, "medium");
  const action = { kind: "message", player, definition: { getName: () => "Two-pints" }, text: "Two pints gives you another cloak." };
  Rewards.reclaim(action);
  assert.equal(action.handled, true);
  assert.deepEqual(player.inventory, [13122], "the highest claimed tier's cloak");
  Rewards.reclaim({ ...action });
  assert.deepEqual(player.inventory, [13122], "not while one is owned");
});

test("lamps: the xpreward interface, offering skills at the lamp's level, and the Wiki's experience", () => {
  const player = createPlayer({ levels: { Attack: 29, Smithing: 30 } });
  player.inventory.push(13145);
  xpRewards.length = 0;
  Lamps.rub({ player, item: 13145, itemId: 13145, slot: 0 });
  const request = xpRewards.at(-1);
  assert.equal(request.minLevel, 30, "varp 261: the cache greys out lower skills");
  const [attack, smithing] = SKILLS;
  assert.equal(request.onConfirm(attack, "Attack"), null, "and the server refuses them too");
  assert.deepEqual(player.inventory, [13145], "kept");
  Lamps.rub({ player, item: 13145, itemId: 13145, slot: 0 });
  assert.equal(xpRewards.at(-1).onConfirm(smithing, "Smithing"), "You have been awarded 2,500 Smithing XP!");
  assert.equal(player.log.at(-1), "xp Smithing 2500");
  assert.deepEqual(player.inventory, []);
});

test("::diary shows, completes and resets, matching names like ::quest", () => {
  const player = createPlayer();
  const run = (command) => Diaries._test.diaryCommand({ player, parts: command.split(" ") });
  run("diary lumbridge");
  assert.equal(player.log.at(-1), "Lumbridge & Draynor: easy 0/12, medium 0/12, hard 0/11, elite 0/6.");
  run("diary kourend easy complete");
  assert.equal(player.log.at(-1), "Kourend & Kebos: easy 12/12, medium 0/13, hard 0/10, elite 0/8.");
  run("diary kourend all reset");
  assert.equal(player.log.at(-1), "Kourend & Kebos: easy 0/12, medium 0/13, hard 0/10, elite 0/8.");
  run("diary a");
  assert.match(player.log.at(-1), /^"a" matches /);
  run("diary varrock complete");
  assert.match(player.log.at(-1), /^Usage/);
});

test("the Elite Karamja Diary doubles Tokkul, and only that diary's elite tier does", () => {
  const player = createPlayer();
  const run = (command) => Diaries._test.diaryCommand({ player, parts: command.split(" ") });
  const tokkul = (amount) => {
    const request = { player, amount };
    Diaries._test.onTokkul(request);
    return request.amount;
  };
  assert.equal(tokkul(8032), 8032);
  run("diary karamja hard complete");
  assert.equal(tokkul(8032), 8032, "the hard tier is not enough");
  run("diary ardougne elite complete");
  assert.equal(tokkul(8032), 8032, "another diary's elite tier is not enough");
  run("diary karamja elite complete");
  assert.equal(tokkul(8032), 16064);
  assert.equal(tokkul(0), 0);
});

test('diary tasks follow successful native gameplay actions', async t => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { NPCDeathTask } = require('../dist/game/task/impl/NPCDeathTask');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  const core = PluginManager.getCoreApi(), pending = [], observed = [], npcs = [], credits = [];
  core.ObjectDefinition.init();
  const scheduler = { submit(task) { task.setRunning(true); pending.push(task); } };
  const api = { ...PluginManager.createApi('DiaryGameplayTest'),
    core: { ...core, TaskManager: scheduler, ObjectManager: { register() {}, deregister() {} } },
    getTaskManager: () => scheduler,
  };
  api.onCustomEvent('thieving:done', event => observed.push(event));
  api.onCustomEvent('diary:task', event => credits.push(event));
  Diaries.register(api);
  require('../plugins/skills/Thieving.plugin').register(api);
  require('../plugins/skills/Runecrafting.plugin').register(api);
  t.mock.method(Math, 'random', () => 0);
  let index = 1000;
  t.after(() => { for (const npc of npcs) core.World.getNpcs().remove(npc); core.World.getRemoveNPCQueue().splice(0); });
  function actor(x, y, z = 0) {
    const player = new Player(null, new core.Location(x, y, z));
    player.setIndex(index++); player.setUsername('diary-test'); player.setRegistered(true); player.setNeedsPlacement(false);
    player.getSession = () => ({ sendClientPacket: () => true, write() {} });
    player.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 99);
    return player;
  }
  function spawn(id, x, y, z = 0) {
    const npc = PluginManager.spawnNpc({ id, x, y, z, wanderRadius: 0 }, 'DiaryGameplayTest');
    assert.ok(npc); npcs.push(npc); return npc;
  }
  function advance(count = 1) {
    for (let tick = 0; tick < count; tick++) for (const task of [...pending]) if (task.isRunning()) task.tick();
  }
  const completed = (player, diary, task) => Progress.doneTasks(player, Data.BY_KEY.get(diary)).has(task);
  const TEA = 'steal-from-the-tea-stall-in-varrock';
  const PICKPOCKET = 'pickpocket-a-man-or-woman-in-lumbridge';
  const ZOMBIE = 'kill-a-zombie-in-draynor-sewers';
  const SEDRIDOR = 'have-sedridor-teleport-you-to-the-essence-mine';

  await t.test('Varrock tea theft credits the diary only when delayed loot arrives', () => {
    const player = actor(3268, 3410);
    const object = new core.GameObject(core.ObjectIdentifiers.TEA_STALL, new core.Location(3269, 3410, 0), 10, 1, null);
    assert.equal(object.getDefinition().getName(), 'Tea stall');
    assert.equal(PluginManager.emitObjectInteraction({ player, object, objectId: object.getId(), location: { x: 3269, y: 3410, z: 0 }, clickType: 2, handled: false }), true);
    assert.equal(completed(player, 'varrock', TEA), false);
    advance();
    assert.equal(player.getInventory().contains(core.ItemIdentifiers.CUP_OF_TEA), true, 'real stall producer awarded tea');
    assert.equal(observed.at(-1).kind, 'stall');
    assert.equal(completed(player, 'varrock', TEA), true);
    assert.equal(player.getPacketSender().getVarbit(6319), 1);
  });

  await t.test('both Man and Woman count on every Lumbridge castle floor', () => {
    for (const z of [0, 1, 2]) for (const id of [core.NpcIdentifiers.MAN_5, core.NpcIdentifiers.WOMAN_9]) {
      const player = actor(3209, 3219, z), npc = spawn(id, 3210, 3219, z);
      const name = npc.getCurrentDefinition(player).getName();
      assert.ok(['Man', 'Woman'].includes(name));
      assert.equal(PluginManager.emitNpcInteraction({ player, npc, npcId: id, clickType: 3, handled: false }), true);
      advance();
      assert.equal(observed.at(-1).succeeded, true, 'real pickpocket outcome succeeded');
      assert.equal(completed(player, 'lumbridge', PICKPOCKET), true, `${name} on floor ${z}`);
      assert.equal(player.getPacketSender().getVarbit(6311), 1);
    }
  });

  await t.test('all three Draynor sewer Zombie spawns count through NPCDeathTask', () => {
    for (const [id, x, y] of [[core.NpcIdentifiers.ZOMBIE_14, 3086, 9674], [core.NpcIdentifiers.ZOMBIE_31, 3088, 9672], [core.NpcIdentifiers.ZOMBIE_33, 3096, 9672]]) {
      assert.equal(CacheDefinitions.getNpc(id).name, 'Zombie');
      const player = actor(x - 1, y), npc = spawn(id, x, y);
      npc.__skipDefaultRespawn = true;
      npc.getCombat().addDamage(player, npc.getMaxHitpoints()); npc.setHitpoints(0);
      const death = new NPCDeathTask(npc); death.execute();
      assert.equal(completed(player, 'lumbridge', ZOMBIE), false, 'starting the death animation is not yet a kill');
      death.execute();
      assert.equal(completed(player, 'lumbridge', ZOMBIE), true, `Zombie ${id}`);
      assert.equal(player.getPacketSender().getVarbit(6311), 1);
    }
  });

  await t.test('Sedridor parent morph credits the essence teleport once on tick four', () => {
    const player = actor(3104, 9571);
    player.setAttribute('quest.rune_mysteries.stage', 6); player.getPacketSender().sendConfig(63, 6);
    const npc = spawn(5034, 3103, 9571); // Cache's nameless Sedridor parent, resolved through varp 63.
    assert.equal(npc.getCurrentDefinition(player).getName(), 'Archmage Sedridor');
    assert.equal(PluginManager.emitNpcInteraction({ player, npc, npcId: npc.getContentId(player), clickType: 3, handled: false }), true);
    PluginManager.emitNpcInteraction({ player, npc, npcId: npc.getContentId(player), clickType: 3, handled: false });
    advance(3);
    assert.equal(completed(player, 'lumbridge', SEDRIDOR), false);
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3104, 9571]);
    advance();
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2913, 4832]);
    assert.equal(completed(player, 'lumbridge', SEDRIDOR), true);
    assert.equal(player.getPacketSender().getVarbit(6311), 1);
    advance(5);
    assert.equal(player.getPacketSender().getVarbit(6311), 1);
    assert.equal(credits.filter(event => event.player === player && event.task === SEDRIDOR).length, 1, 'repeated clicks during travel do not duplicate credit');
  });

  await t.test('tea from Kourend and attempts whose final inventory slot fills do not count', () => {
    for (const [x, y, fillDuringAttempt] of [[1648, 3683, false], [3269, 3410, true]]) {
      const player = actor(x - 1, y);
      const object = new core.GameObject(core.ObjectIdentifiers.TEA_STALL, new core.Location(x, y, 0), 10, 1, null);
      PluginManager.emitObjectInteraction({ player, object, objectId: object.getId(), location: { x, y, z: 0 }, clickType: 2, handled: false });
      if (fillDuringAttempt) for (let slot = 0; slot < 28; slot++) player.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.CABBAGE));
      advance();
      assert.equal(player.getInventory().contains(core.ItemIdentifiers.CUP_OF_TEA), !fillDuringAttempt);
      assert.equal(completed(player, 'varrock', TEA), false);
    }
  });

  await t.test('a successful Varrock pickpocket and a failed Lumbridge pickpocket do not count', sub => {
    for (const [x, y, fails] of [[3234, 3398, false], [3210, 3219, true]]) {
      const player = actor(x - 1, y), npc = spawn(core.NpcIdentifiers.MAN_5, x, y);
      if (fails) sub.mock.method(Math, 'random', () => 0.999);
      PluginManager.emitNpcInteraction({ player, npc, npcId: npc.getId(), clickType: 3, handled: false });
      advance();
      assert.equal(observed.at(-1).succeeded, !fails);
      assert.equal(completed(player, 'lumbridge', PICKPOCKET), false);
    }
  });

  await t.test('a Varrock sewer Zombie does not count as a Draynor sewer kill', () => {
    const player = actor(3121, 9658), npc = spawn(core.NpcIdentifiers.ZOMBIE_32, 3122, 9658);
    assert.equal(npc.getCurrentDefinition(player).getName(), 'Zombie');
    npc.__skipDefaultRespawn = true;
    npc.getCombat().addDamage(player, npc.getMaxHitpoints()); npc.setHitpoints(0);
    const death = new NPCDeathTask(npc); death.execute(); death.execute();
    assert.equal(completed(player, 'lumbridge', ZOMBIE), false);
  });

  for (const reason of ['quest incomplete', 'blocked', 'cancelled', 'death', 'logout', 'other wizard']) {
    await t.test(`Sedridor task is not awarded when ${reason}`, sub => {
      const player = actor(3104, 9571);
      if (reason !== 'quest incomplete') {
        player.setAttribute('quest.rune_mysteries.stage', 6); player.getPacketSender().sendConfig(63, 6);
      }
      const npc = spawn(reason === 'other wizard' ? core.NpcIdentifiers.AUBURY_3 : 5034, 3103, 9571);
      if (reason === 'blocked') sub.mock.method(core.TeleportHandler, 'checkReqs', () => false);
      PluginManager.emitNpcInteraction({ player, npc, npcId: npc.getContentId(player), clickType: reason === 'other wizard' ? 4 : 3, handled: false });
      if (reason === 'cancelled') for (const task of pending) if (task.key === player) task.stop();
      if (reason === 'death') PluginManager.emitPlayerDeath({ player });
      if (reason === 'logout') player.setRegistered(false);
      advance(4);
      assert.equal(completed(player, 'lumbridge', SEDRIDOR), false);
      assert.equal(credits.some(event => event.player === player && event.task === SEDRIDOR), false);
      assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], reason === 'other wizard' ? [2913, 4832] : [3104, 9571]);
    });
  }
});
