// Run after `yarn build`: node --test tests/slayer-culling-spree-offer.test.cjs
// Culling Spree (Demonic Pacts League relic, Wiki Culling_Spree_(Demonic_Pacts_League) and
// Demonic_Pacts_League/Guide/Slayer): a Slayer master offers three tasks, one a boss task (with
// Like a Boss) from the bosses in the character's unlocked areas, and the player types the kill
// count, 5 to 200. Through the real plugins (LeagueMode, LeagueRelics, LeagueAreaUnlocks, Slayer)
// and a real Player: the master's Assignment option, the chatbox menu and the amount prompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");

const DP = 6;
/** Culling Spree: tier 6 (index 5), slot 3. */
const CULLING_SPREE = { 5: 3 };
const VARLAMORE = 21;
const WILDERNESS = 11;
const ASGARNIA = 3;

let core;
let Data;
let Tasks;
let Offer;
const hooks = {};
const custom = {};
/** Chatbox menus sent: { player, title, entries: [[label, action], ...] }. */
const menus = [];
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league");
  const lists = {};
  // Only a lone handler: `onNpcInteraction("Name", { ... })` forms belong to other content.
  const on = (name) => (handler) => {
    if (typeof handler !== "function") return;
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      for (const attached of lists[name]) attached(event);
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? DP : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    getAreaManager: () => ({ inMulti: () => false }),
    getItemOnGroundManager: () => ({}),
    registerCommand() {},
    registerMagicAttackAccuracyModifier() {},
    registerMagicDamageBonusModifier() {},
    registerMeleeAttackAccuracyModifier() {},
    registerRangedAttackAccuracyModifier() {},
    registerMeleeDefenseModifier() {},
    registerMagicDefenseModifier() {},
    registerIncomingDamageModifier() {},
    registerWeaponProfile() {},
    registerRestingLevelModifier() {},
    registerRangedAmmoHandler() {},
    registerNpcCombatMethodProvider() {},
    spawnNpc: () => ({ getCombat: () => ({ attack() {} }) }),
    onItemAction() {},
    onInterfaceActionButton() {},
    sendMultiChatboxPrompt: (player, title, ...flat) => {
      const entries = [];
      for (let index = 0; index < flat.length; index += 2) entries.push([flat[index], flat[index + 1]]);
      menus.push({ player, title, entries });
      return true;
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
  require("../plugins/modes/LeagueAreaUnlocks.plugin").register(api);
  require("../plugins/skills/Slayer.plugin").register(api);
  Data = require("../plugins/skills/slayer/Data.Slayer");
  Tasks = require("../plugins/skills/slayer/Tasks.Slayer");
  Offer = require("../plugins/skills/slayer/Offer.Slayer");
});

afterEach(() => {
  Math.random = realRandom;
  menus.length = 0;
});

/** A real, logged-in player with 99s; its messages, prompts and dialogues are kept. */
function character(name, { profile = "league", picks = CULLING_SPREE, areas = [VARLAMORE], likeABoss = true, slayer = 99 } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(1666, 3136, 0));
  player.setRegistered(true);
  const sent = { messages: [], prompts: [], dialogues: [] };
  const varbits = new Map();
  const varps = new Map();
  const record = {
    sendVarbit: (id, value) => varbits.set(id, value),
    sendConfig: (id, value) => varps.set(id, value),
    sendEnterAmountPrompt: (title) => sent.prompts.push(title),
  };
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === "getVarbit") return (id) => varbits.get(id) ?? 0;
      if (key === "getVarp") return (id) => varps.get(id) ?? 0;
      return key in record ? (...args) => (record[key](...args), sender) : () => sender;
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  player.getDialogueManager = () => ({ startDialogues: (chain) => sent.dialogues.push(chain), getCurrent: () => null });
  for (const skill of core.Skill.values()) player.getSkillManager().setMaxLevels(skill, skill === Skill.SLAYER ? slayer : 99, false);
  if (profile === "league") {
    player.setAttribute("league:type", DP);
    player.setAttribute("league:relics", picks);
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  if (profile === "league") player.setAttribute("league:areas", areas);
  if (likeABoss) unlock(player, Data.get().masters.get(5).tasks.find((entry) => entry.task.id === Data.BOSS_TASK_ID).unlockRow);
  return Object.assign(player, { sent });
}

function unlock(player, unlockRow) {
  const bit = Data.get().unlocks.get(unlockRow).bit;
  const name = ["slayer_rewards_unlocks", "slayer_rewards_unlocks1", "slayer_rewards_unlocks2"][bit >> 5];
  const id = core.CacheDefinitions.getVarpId(name);
  player.getPacketSender().sendConfig(id, player.getPacketSender().getVarp(id) | (1 << (bit & 31)));
}

/** The NPC definition of a master by its cache name. */
function masterNpc(name) {
  const count = core.CacheDefinitions.getCounts().npcs;
  for (let id = 0; id < count; id++) {
    const type = core.CacheDefinitions.getNpc(id);
    if (type?.name === name && (type.actions ?? []).includes("Assignment")) return core.NpcDefinition.forId(id);
  }
  throw new Error(`no Slayer master named ${name}`);
}

/** The master's Assignment option, as a click on it. */
function assignment(player, name) {
  const definition = masterNpc(name);
  const event = { player, npc: null, definition, clickType: 3, handled: false };
  hooks.onNpcInteraction(event);
  return event;
}

/** Answers the open amount prompt as the client's resume packet does (NetworkBuilder dialogue_amount). */
function typeAmount(player, amount) {
  const action = player.getEnteredAmountAction();
  if (action && (amount > 0 || (amount === 0 && action.acceptsZero === true))) action.execute(amount);
  player.setEnteredAmountAction(null);
}

function offered(menu) {
  return menu.entries.map(([label]) => label);
}

const bossNames = () => new Set([...Data.get().bosses.values()].map((task) => task.displayName));

test("Duradel offers three tasks, one a boss from the unlocked areas, and the typed count is the task", () => {
  const player = character("spree");
  assert.equal(assignment(player, "Duradel").handled, true);
  assert.equal(menus.length, 1, "a menu instead of an assignment");
  assert.equal(Tasks.current(player), null, "nothing assigned yet");
  const labels = offered(menus[0]);
  assert.equal(labels.length, 3);
  assert.equal(new Set(labels).size, 3, "no task twice");
  const bosses = labels.filter((label) => bossNames().has(label));
  assert.deepEqual(bosses, ["Vardorvis"], "only Varlamore unlocked: Vardorvis is the one boss (Wiki)");

  const [, chooseBoss] = menus[0].entries.find(([label]) => label === "Vardorvis");
  chooseBoss();
  assert.equal(player.sent.prompts.at(-1), "How many would you like to slay? (5-200)");
  typeAmount(player, 200);
  const task = Tasks.current(player);
  assert.equal(task.taskId, Data.BOSS_TASK_ID);
  assert.equal(task.task.displayName, "Vardorvis");
  assert.equal(task.count, 200);
  assert.equal(task.original, 200);
  assert.equal(task.masterId, 5, "Duradel's task, for his points and streak");
  assert.deepEqual(Offer.stored(player), [], "the offer is spent");
  assert.equal(player.sent.dialogues.length, 1, "Duradel says the task");
});

test("a regular task takes the count typed (5), and out-of-range, 0 and a cancelled prompt assign nothing", () => {
  const player = character("counts");
  assignment(player, "Duradel");
  const first = offered(menus[0]);
  const regular = menus[0].entries.find(([label]) => !bossNames().has(label));

  regular[1]();
  typeAmount(player, 201);
  assert.equal(Tasks.current(player), null);
  assert.equal(player.sent.messages.at(-1), "You must choose an amount between 5 and 200.");
  regular[1]();
  typeAmount(player, 0);
  assert.equal(Tasks.current(player), null, "0 is out of range, not dropped silently");
  assert.equal(player.sent.messages.at(-1), "You must choose an amount between 5 and 200.");
  regular[1]();
  player.getEnteredAmountAction().execute(-3);
  assert.equal(player.sent.messages.at(-1), "You must choose an amount between 5 and 200.", "a negative count says so too");
  regular[1]();
  typeAmount(player, 4);
  assert.equal(Tasks.current(player), null);
  // A closed prompt sends nothing; the abort clears the action (PacketSender.abortInputPrompt).
  regular[1]();
  player.setEnteredAmountAction(null);
  assert.equal(Tasks.current(player), null);

  // Talking again offers the same tasks until one is picked.
  assignment(player, "Duradel");
  assert.deepEqual(offered(menus[1]), first);
  const again = menus[1].entries.find(([label]) => label === regular[0]);
  again[1]();
  typeAmount(player, 5);
  const task = Tasks.current(player);
  assert.equal(task.task.displayName, regular[0]);
  assert.equal(task.count, 5);
});

test("the boss comes only from unlocked areas, evenly; without Like a Boss the three are regular tasks", () => {
  const wilderness = new Set(["The Abyssal Sire", "Callisto", "The Chaos Elemental", "The Chaos Fanatic", "Crazy Archaeologists",
    "The King Black Dragon", "Scorpia", "Venenatis", "Vet'ion"]);
  const seen = new Set();
  for (let roll = 0; roll < 40; roll++) {
    const player = character(`areas-${roll}`, { areas: [VARLAMORE, WILDERNESS] });
    let next = 0;
    // Steps the boss pick through every allowed boss; the regular picks don't matter here.
    Math.random = () => ((next++ % 3 === 0) ? (roll % 10) / 10 + 0.01 : 0.5);
    const choices = Offer.roll(player, Data.get().masters.get(5), Offer.offerFor(player, Data.get().masters.get(5)));
    Math.random = realRandom;
    const boss = choices.filter((choice) => choice.boss);
    assert.equal(boss.length, 1);
    const name = Data.get().bosses.get(boss[0].boss).displayName;
    assert.ok(name === "Vardorvis" || wilderness.has(name), `${name} is in Varlamore or the Wilderness`);
    seen.add(name);
  }
  assert.ok(seen.size > 2, "more than one boss rolls");

  const noBoss = character("no-boss", { likeABoss: false });
  assignment(noBoss, "Duradel");
  const labels = offered(menus.at(-1));
  assert.equal(labels.length, 3);
  assert.equal(labels.filter((label) => bossNames().has(label)).length, 0, "Like a Boss off: three regular tasks (Wiki)");
});

test("an unlocked area's level-gated boss needs the level; a boss past the league (Shellbane Gryphon) is never offered", () => {
  const master = Data.get().masters.get(5);
  const player = character("low", { areas: [VARLAMORE, ASGARNIA, WILDERNESS], slayer: 85 });
  const offer = Offer.offerFor(player, master);
  const allowed = Tasks.bossChoices(player).filter(([, task]) => offer.bossAllowed(task)).map(([, task]) => task.displayName);
  assert.ok(allowed.includes("The Abyssal Sire"), "85 Slayer");
  assert.ok(!allowed.includes("Cerberus"), "Cerberus needs 91");
  assert.ok(allowed.includes("General Graardor"));
  assert.ok(!allowed.includes("Zulrah"), "Tirannwn is locked");
  assert.ok(!allowed.includes("The Shellbane Gryphon"));
});

test("without the relic (no relic picked, a main character) the master assigns as before", () => {
  const others = [
    character("without", { picks: {} }),
    character("main", { profile: "main" }),
  ];
  for (const player of others) {
    assignment(player, "Duradel");
    assert.equal(menus.length, 0, "no menu");
    const task = Tasks.current(player);
    assert.ok(task, "an assignment straight away");
    assert.notEqual(player.sent.prompts.length, 1);
  }
});

test("Konar's offered task keeps her area; a remote assignment (slayer:assignment) offers the choice too", async () => {
  const player = character("konar");
  assignment(player, "Konar quo Maten");
  const regular = menus.at(-1).entries.find(([label]) => !bossNames().has(label));
  regular[1]();
  typeAmount(player, 50);
  const task = Tasks.current(player);
  assert.equal(task.count, 50);
  assert.ok(task.area, "Konar picks the area");

  const remote = character("remote");
  const request = { player: remote, npcName: "Duradel", master: "Duradel", line: null };
  for (const handler of custom["slayer:assignment"]) handler(request);
  assert.equal(request.line, null, "no line: the choice follows");
  await Promise.resolve();
  assert.equal(menus.at(-1).player, remote);
  assert.equal(menus.at(-1).entries.length, 3);
  menus.at(-1).entries[0][1]();
  typeAmount(remote, 10);
  assert.equal(Tasks.current(remote).count, 10);
  assert.match(remote.sent.messages.at(-1), /^Your new task is to kill 10 /, "said as a message without an NPC");
});

test("Krystilia's offered boss is a Wilderness one; any task assigned spends a waiting offer", () => {
  const krystilia = Data.get().masters.get(7);
  const player = character("krystilia", { areas: [VARLAMORE, ASGARNIA, WILDERNESS] });
  const offer = Offer.offerFor(player, krystilia);
  assert.equal(offer.wilderness, true);
  const allowed = Tasks.bossChoices(player).filter(([, task]) => offer.bossAllowed(task)).map(([, task]) => task.displayName);
  assert.ok(allowed.length > 0);
  assert.ok(!allowed.includes("Vardorvis") && !allowed.includes("General Graardor"), "not outside the Wilderness");
  assert.ok(allowed.includes("Callisto"));

  const waiting = character("waiting");
  assignment(waiting, "Duradel");
  assert.equal(Offer.stored(waiting).length, 3);
  Tasks.assign(waiting, Data.get().masters.get(10));
  assert.deepEqual(Offer.stored(waiting), [], "another task (Mortimer's) spends the offer");
});
