// Run after `yarn build`: node --test tests/league-relic-effects-clues-slayer.test.cjs
// The clue and Slayer relics (docs/leagues.md): Treasure Seeker (and its tier 3 preview) and
// Bloodthirsty (Trailblazer Reloaded), Treasure Arbiter and Slayer Master (Raging Echoes). Each
// works for a character of its league who chose it, and for nobody else: not a character of that
// league without it, not the other league's character with the same slots, not a main character.
// Through the owners' own code where it can be driven alone: the drop table's tertiary roll, the
// clue geodes, Slayer's kill credit, superiors, reward shop, bracelet and task check.
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
const { Item } = require("../dist/game/model/Item");

let core;
const hooks = {};
const custom = {};
const realRandom = Math.random;
let I;
let Tasks;
let Superiors;
let Rewards;
let Checks;
let Bracelet;
let Geodes;
let TrailRuntime;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  I = core.ItemIdentifiers;
  GameConstants.setWorldProfile("league"); // a Trailblazer Reloaded world (the league type is the plugin config below)
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      for (const attached of lists[name]) attached(event);
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? 4 : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    getAreaManager: () => ({ inMulti: () => false }),
    getItemOnGroundManager: () => ({}),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerMagicAttackAccuracyModifier() {},
    registerMagicDamageBonusModifier() {},
    registerMeleeAttackAccuracyModifier() {},
    registerRangedAttackAccuracyModifier() {},
    registerMeleeDefenseModifier() {},
    registerMagicDefenseModifier() {},
    registerIncomingDamageModifier() {},
    registerWeaponProfile() {},
    registerRangedAmmoHandler() {},
    spawnNpc: (spawn) => {
      const definition = core.NpcDefinition.forId(spawn.id);
      const at = new Location(spawn.x, spawn.y, spawn.z ?? 0);
      return { getCombat: () => ({ attack() {} }), getId: () => spawn.id, getDefinition: () => definition, getCurrentDefinition: () => definition, getLocation: () => at, isPlayer: () => false };
    },
    onItemAction() {},
    onInterfaceActionButton() {},
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
  // The drop table's own roller, without its kill hook (these kills are Slayer's).
  require("../plugins/npcs/NpcDrops.plugin").register(new Proxy(api, { get: (target, key) => (key === "onNpcDeath" ? () => {} : target[key]) }));
  require("../plugins/skills/Slayer.plugin").register(api);
  Geodes = require("../plugins/skills/mining/ClueGeodes.Mining");
  Geodes.attach(api);
  Tasks = require("../plugins/skills/slayer/Tasks.Slayer");
  Superiors = require("../plugins/skills/slayer/Superiors.Slayer");
  Rewards = require("../plugins/skills/slayer/Rewards.Slayer");
  Checks = require("../plugins/skills/slayer/Checks.Slayer");
  Bracelet = require("../plugins/skills/slayer/SlaughterBracelet.Slayer");
  TrailRuntime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
  require("../plugins/treasuretrails/TreasureTrails.plugin").register(api);
});

afterEach(() => {
  Math.random = realRandom;
});

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

/** A real player of `profile`, logged in, with the given relic picks (tier index -> slot); varbits and varps are kept. */
function character(name, profile, picks = {}, leagueType = 4) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(3200, 3200, 0));
  player.setRegistered(true);
  const varbits = new Map();
  const varps = new Map();
  const sender = new Proxy({}, { get: (_, key) => {
    if (key === "getVarbit") return (id) => varbits.get(id) ?? 0;
    if (key === "sendVarbit") return (id, value) => { varbits.set(id, value); return sender; };
    if (key === "getVarp") return (id) => varps.get(id) ?? 0;
    if (key === "sendConfig") return (id, value) => { varps.set(id, value); return sender; };
    return () => sender;
  } });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.messages = [];
  player.sendMessage = (message) => player.messages.push(message);
  if (profile === "league") {
    player.setAttribute("league:type", leagueType);
    player.setAttribute("league:relics", picks);
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  return player;
}

function cases(picks, league = 4) {
  return {
    relic: character("relic", "league", picks, league),
    without: character("without", "league", {}, league),
    other: character("other", "league", picks, league === 4 ? 5 : 4),
    main: character("main", "main"),
  };
}

function others(who) {
  return [who.without, who.other, who.main];
}

const TREASURE_SEEKER = { 4: 1 };
const TREASURE_SEEKER_PREVIEW = { 2: 3 };
const BLOODTHIRSTY = { 4: 2 };
const TREASURE_ARBITER = { 4: 1 };
const SLAYER_MASTER = { 4: 3 };

const amount = (player, itemId) => player.getInventory().getAmount(itemId);
const points = (player) => player.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("slayer_points"));
const slayerXp = (player) => player.getSkillManager().getExperience(Skill.SLAYER);

/** A live NPC of this name, as Slayer sees one. */
function npcOf(name) {
  const count = core.CacheDefinitions.getCounts().npcs;
  for (let id = 0; id < count; id++) {
    const type = core.CacheDefinitions.getNpc(id);
    if (type?.name !== name || !(type.actions ?? []).includes("Attack")) continue;
    const definition = core.NpcDefinition.forId(id);
    const at = new Location(3200, 3200, 0);
    return { getId: () => id, getDefinition: () => definition, getCurrentDefinition: () => definition, getLocation: () => at, isPlayer: () => false };
  }
  throw new Error(`no NPC ${name}`);
}

// --- Clue scrolls

const HARD_CLUE = { item_id: 2722, name: "Clue scroll (hard)", quantity: [1, 1], weight: 1, out_of: 128, rarity: 1 / 128, section: "Tertiary" };

function rollClue(player, npc = null) {
  const request = { player, npc, table: { entries: [], tertiary: [HARD_CLUE] }, drops: [] };
  emit("npc-drops:roll-table", request);
  return request.drops.filter((drop) => drop.itemId === HARD_CLUE.item_id).length;
}

/**
 * The perks Treasure Seeker and Treasure Arbiter share: the other league's character with the same
 * slots holds the other of the two (tier 5, slot 1 in both), so it has them too.
 */
function clueCases(picks, league) {
  const who = cases(picks, league);
  const without = [who.without, who.main];
  Math.random = () => 0.05; // under 1 in 15, over 1 in 128
  assert.equal(rollClue(who.relic), 1, "the drop table's clue at 1 in 15");
  assert.equal(rollClue(who.other), 1, "the other league's same slot is the other clue relic");
  for (const player of without) assert.equal(rollClue(player), 0, `${player.getUsername()}'s clue stays 1 in 128`);
  Math.random = () => 0.07;
  assert.equal(rollClue(who.relic), 0, "and no likelier than 1 in 15");

  const jar = (player) => emit("hunter:impling-clue-chance", { player, impling: "NINJA", tier: "hard", oneIn: 25 }).oneIn;
  assert.equal(jar(who.relic), 15);
  for (const player of without) assert.equal(jar(player), 25, player.getUsername());

  // A clue geode through Mining's own roll: 10 times the usual odds.
  const elite = (player) => {
    player.getInventory().resetItems();
    Geodes.rollClueGeodes({ player, skill: Skill.MINING, petBase: 300000 }, () => 1.5 / Geodes.geodeChance(300000, 1, 10));
    return amount(player, I.CLUE_GEODE_ELITE_);
  };
  assert.equal(elite(who.relic), 1, "a roll 1.5 in the elite geode's odds hits at 10 times the chance");
  for (const player of without) assert.equal(elite(player), 0, `${player.getUsername()}'s geode at its usual odds`);

  const length = (player) => TrailRuntime.trailLength({ name: "hard", length: [4, 6] }, () => 0.9, player);
  assert.equal(length(who.relic), 4, "the hard trail's fewest steps");
  for (const player of without) assert.equal(length(player), 6, player.getUsername());
  const beginner = (player) => emit("treasure-trails:trail-length", { player, tier: "beginner", length: 3, minimum: 1, maximum: 3 }).length;
  assert.equal(beginner(who.relic), 1);
  const rolls = (player) => emit("treasure-trails:casket-rolls", { player, tier: "master", rolls: 5, minimum: 5, maximum: 7 }).rolls;
  assert.equal(rolls(who.relic), 7, "the master casket's most rolls");
  for (const player of without) assert.equal(rolls(player), 5, player.getUsername());
  return who;
}

test("Treasure Seeker: 1 in 15 clues, 10 times the vessels, the fewest steps and most rolls; a bonus casket, sometimes a tier higher", () => {
  const who = clueCases(TREASURE_SEEKER, 4);
  Math.random = () => 0.9;
  emit("treasure-trails:casket-opened", { player: who.relic, tier: "easy" });
  assert.equal(amount(who.relic, I.REWARD_CASKET_EASY_), 0, "a 90 brings nothing");
  Math.random = () => 0;
  emit("treasure-trails:casket-opened", { player: who.relic, tier: "easy" });
  assert.equal(amount(who.relic, I.REWARD_CASKET_MEDIUM_), 1, "a 0 brings a casket, and a tier higher");
  Math.random = (() => { const rolls = [0, 0.9]; return () => rolls.shift() ?? 0.9; })();
  emit("treasure-trails:casket-opened", { player: who.relic, tier: "master" });
  assert.equal(amount(who.relic, I.REWARD_CASKET_MASTER_), 1, "a master casket's is a master casket");
  for (const player of others(who)) {
    Math.random = () => 0;
    emit("treasure-trails:casket-opened", { player, tier: "easy" });
    assert.equal(amount(player, I.REWARD_CASKET_EASY_) + amount(player, I.REWARD_CASKET_MEDIUM_), 0, player.getUsername());
  }
  const waived = emit("treasure-trails:requirement-waived", { player: who.relic, kind: "emote", waived: false }).waived;
  assert.equal(waived, false, "the item requirements are Treasure Arbiter's");
});

test("Treasure Seeker's tier 3 preview in the catalog has the same effects", () => {
  const preview = character("preview", "league", TREASURE_SEEKER_PREVIEW, 4);
  Math.random = () => 0.05;
  assert.equal(rollClue(preview), 1);
  assert.equal(emit("treasure-trails:casket-rolls", { player: preview, tier: "easy", rolls: 2, minimum: 2, maximum: 4 }).rolls, 4);
});

test("Treasure Arbiter: the shared clue perks, and emote, Falo and Charlie steps need no items; no bonus casket", () => {
  const who = clueCases(TREASURE_ARBITER, 5);
  for (const kind of ["emote", "falo", "charlie"]) {
    assert.equal(emit("treasure-trails:requirement-waived", { player: who.relic, kind, waived: false }).waived, true, kind);
    for (const player of others(who)) {
      assert.equal(emit("treasure-trails:requirement-waived", { player, kind, waived: false }).waived, false, `${player.getUsername()} ${kind}`);
    }
  }
  // An emote step that asks for gear, through the trail's own check.
  const step = { family: "emote", location: { x: 3200, y: 3200, z: 0 }, equipment: [{ anyOf: [I.RUNE_PLATEBODY] }] };
  assert.equal(TrailRuntime.emoteReady(who.relic, step), true, "the relic needs none of it");
  for (const player of others(who)) assert.equal(TrailRuntime.emoteReady(player, step), false, player.getUsername());
  Math.random = () => 0;
  emit("treasure-trails:casket-opened", { player: who.relic, tier: "easy" });
  assert.equal(amount(who.relic, I.REWARD_CASKET_EASY_) + amount(who.relic, I.REWARD_CASKET_MEDIUM_), 0, "the bonus casket is Treasure Seeker's");
});

// --- Slayer

test("Bloodthirsty: superiors 1 in 25, a quarter bloodthirsty; points and six (nine) more rolls; a sure clue; the bracelet and remote tasks", () => {
  const who = cases(BLOODTHIRSTY, 4);
  const chance = (player) => emit("slayer:superior-spawn", { player, npc: null, unlocked: true, chance: 200 }).chance;
  assert.equal(chance(who.relic), 25);
  // The others keep what the league's tier passive gives (Raging Echoes tier 3: 1 in 50), else 200.
  const { passive } = require("../plugins/modes/league/Passives.LeagueMode");
  for (const player of others(who)) assert.equal(chance(player), passive(player, "slayer")?.superiorChance ?? 200, player.getUsername());

  const nechryarch = npcOf("Nechryarch");
  // The extra rolls Superiors asks of the drop table, recorded.
  const asked = [];
  custom["npc-drops:extra-rolls"].unshift((request) => asked.push(request));
  const rewards = (player, superior) => {
    const drops = [];
    asked.length = 0;
    Math.random = () => 0.999; // no superior unique
    Superiors.addUniques({ player, npc: superior, drops });
    return { drops, rolls: asked.reduce((sum, request) => sum + request.rolls, 0), npcId: asked[0]?.npcId };
  };
  const before = points(who.relic);
  const plain = rewards(who.relic, nechryarch);
  assert.equal(plain.rolls, 6, "six rolls");
  assert.equal(core.NpcDefinition.forId(plain.npcId).getName(), "Nechryael", "on the normal monster's table");
  assert.ok(points(who.relic) > before, "and Slayer points");
  for (const player of others(who)) {
    assert.equal(rewards(player, npcOf("Nechryarch")).rolls, 0, `${player.getUsername()}: no extra rolls`);
    assert.equal(points(player), 0, `${player.getUsername()}: no points`);
  }

  const variant = npcOf("Nechryarch");
  Math.random = () => 0.1;
  emit("slayer:superior-spawned", { player: who.relic, npc: npcOf("Nechryael"), superior: variant });
  assert.ok(require("../plugins/modes/leaguerelics/Bloodthirsty.LeagueRelics").bloodthirsty.has(variant), "a 10 is bloodthirsty (25%)");
  const { drops: variantDrops, rolls: variantRolls } = rewards(who.relic, variant);
  assert.equal(variantRolls, 9, "nine rolls");
  const table = new Set(require("../plugins/modes/data/league-relics.json").effects.bloodthirsty.uniqueTable.rows.map((row) => row.item));
  assert.ok(variantDrops.some((drop) => [...table].some((name) => [I[name], core.ItemDefinition.forId(I[name]).getNoteId()].includes(drop.itemId))));
  Math.random = () => 0.9;
  assert.equal(rollClue(who.relic, variant), 1, "a bloodthirsty superior's clue is certain");
  assert.equal(rollClue(who.relic, nechryarch), 0, "a plain one's is not");
  // The rarest by chance (an elite 1/120 against a hard 10/128), and only a tier the player can take.
  const twoTiers = (player) => {
    const elite = { ...HARD_CLUE, item_id: 12073, name: "Clue scroll (elite)", out_of: 120 };
    const hard = { ...HARD_CLUE, weight: 10 };
    const request = { player, npc: variant, table: { entries: [], tertiary: [hard, elite] }, drops: [] };
    emit("npc-drops:roll-table", request);
    return request.drops.map((drop) => drop.itemId);
  };
  assert.deepEqual(twoTiers(who.relic), [12073], "the elite clue, the rarer by chance");
  const refuseElite = (request) => { if (request.tier === "elite") request.allowed = false; };
  custom["treasure-trails:can-receive"] = [refuseElite, ...(custom["treasure-trails:can-receive"] ?? [])];
  assert.deepEqual(twoTiers(who.relic), [HARD_CLUE.item_id], "an elite clue already held: the hard one");
  custom["treasure-trails:can-receive"] = custom["treasure-trails:can-receive"].filter((handler) => handler !== refuseElite);
  // A hard clue already held: the natural hard drop (later taken out by the clue capacity) does not
  // count as the guarantee, so the elite one still comes.
  const refuseHard = (request) => { if (request.tier === "hard") request.allowed = false; };
  custom["treasure-trails:can-receive"] = [refuseHard, ...(custom["treasure-trails:can-receive"] ?? [])];
  Math.random = () => 0.05; // under the hard 10/128, over the elite 1/120
  assert.ok(twoTiers(who.relic).includes(12073), "the elite clue, as the guarantee");
  custom["treasure-trails:can-receive"] = custom["treasure-trails:can-receive"].filter((handler) => handler !== refuseHard);
  Math.random = () => 0.9;
  custom["treasure-trails:can-receive"] = custom["treasure-trails:can-receive"].filter((handler) => handler !== refuseElite);

  // A Turoth's superior rolls the Turoth's own table: the id it spawned from (427, whose drops the data has).
  require("../plugins/skills/slayer/Rewards.Slayer").setUnlockBit(who.relic, require("../plugins/skills/data/slayer-superiors.json").unlockBit, true); // Bigger and Badder
  const turothDefinition = core.NpcDefinition.forId(427);
  const turoth = { getId: () => 427, getDefinition: () => turothDefinition, getCurrentDefinition: () => turothDefinition, getLocation: () => new Location(2800, 10000, 0), isPlayer: () => false };
  assert.equal(turothDefinition.getName(), "Turoth");
  Math.random = () => 0;
  const spiked = Superiors.taskKill({ player: who.relic, npc: turoth }, () => 0);
  assert.ok(spiked, "a superior spawns");
  const turothRolls = rewards(who.relic, spiked);
  assert.equal(turothRolls.npcId, 427, "the Turoth it came from, not the first Turoth in the cache");
  assert.ok(turothRolls.rolls >= 6);

  // The bracelet of slaughter: 35% and no charge.
  const braced = (player, roll) => {
    player.getEquipment().setItem(core.Equipment.HANDS_SLOT, new Item(I.BRACELET_OF_SLAUGHTER));
    return Bracelet.preventsDecrement(player, npcOf("Nechryael"), () => roll);
  };
  assert.equal(braced(who.relic, 0.3), true, "a 30 works (35%)");
  assert.equal(who.relic.getAttribute(Bracelet.CHARGES_ATTRIBUTE), undefined, "no charge used");
  for (const player of others(who)) {
    assert.equal(braced(player, 0.3), false, `${player.getUsername()}'s bracelet works 25% of the time`);
    assert.equal(braced(player, 0.2), true);
    assert.equal(player.getAttribute(Bracelet.CHARGES_ATTRIBUTE), 29, `${player.getUsername()} uses a charge`);
  }

  // The gem's check offers a task from anywhere.
  const master = core.CacheDefinitions.getVarbitId("slayer_master");
  for (const player of [who.relic, ...others(who)]) player.getPacketSender().sendVarbit(master, 6); // Duradel
  const offered = (player) => {
    const before = player.getDialogueManager().getCurrent();
    Checks.check(player);
    const now = player.getDialogueManager().getCurrent();
    return !!now && now !== before;
  };
  assert.equal(offered(who.relic), true, "the relic is offered a task");
  assert.match(who.relic.messages.at(-1), /completed/, "after the usual check");
  for (const player of others(who)) assert.equal(offered(player), false, `${player.getUsername()}: only the check`);
  const withMortimer = character("mortimer", "league", BLOODTHIRSTY, 4);
  withMortimer.getPacketSender().sendVarbit(master, 10);
  assert.equal(offered(withMortimer), false, "Mortimer's tasks are chosen in person");
});

test("Slayer Master: the Morytania Diary's Slayer XP also lifts a Slayer Tower kill with no task, and the count stays (Wiki: Morytania Diary)", () => {
  const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
  const { onIsComplete } = require("../plugins/achievements/AchievementDiaries.plugin")._test;
  custom["diary:is-complete"] = [onIsComplete];
  const who = cases(SLAYER_MASTER, 5);
  const elite = Diaries.TIERS.flatMap((tier) => Diaries.BY_KEY.get("morytania").tiers[tier].tasks.map((task) => task.key));
  for (const player of [who.relic, ...others(who)]) {
    player.setAttribute("achievement-diaries:tasks", { morytania: elite });
    player.isPlayer = () => true;
  }
  const bloodveld = npcOf("Bloodveld");
  const tower = new Location(3420, 3560, 0);
  const inTower = { ...bloodveld, getLocation: () => tower };
  const base = bloodveld.getDefinition().getHitpoints();
  assert.equal(emit("slayer:on-task", { player: who.relic, npc: inTower, onTask: false }).onTask, true, "on task through the relic");
  // The relic character holds a Turael task, which Bloodvelds do not count for.
  const turael = [...require("../plugins/skills/slayer/Data.Slayer").get().masters.values()].find((master) => master.names.includes("Turael"));
  Tasks.assign(who.relic, turael);
  const task = Tasks.current(who.relic);
  hooks.onNpcDeath({ killer: who.relic, npc: inTower });
  assert.equal(slayerXp(who.relic), base * 1.1, "the elite diary's 10% on the off-task kill");
  assert.equal(Tasks.current(who.relic).count, task.count, "the task's count does not fall");
  const before = slayerXp(who.relic);
  hooks.onNpcDeath({ killer: who.relic, npc: bloodveld });
  assert.equal(slayerXp(who.relic) - before, base, "outside the tower, no bonus");
  for (const player of others(who)) {
    hooks.onNpcDeath({ killer: player, npc: inTower });
    assert.equal(slayerXp(player), 0, `${player.getUsername()} gets none`);
  }
});

test("Slayer Master: every Slayer monster on task (XP, no count), free rewards, a bonus on the 100th kill of each", () => {
  const who = cases(SLAYER_MASTER, 5);
  const demon = npcOf("Abyssal demon");
  const onTask = (player, npc) => emit("slayer:on-task", { player, npc, onTask: false }).onTask;
  assert.equal(onTask(who.relic, demon), true, "on task with no task");
  assert.equal(onTask(who.relic, npcOf("Man")), false, "not a Slayer monster");
  for (const player of others(who)) assert.equal(onTask(player, demon), false, player.getUsername());

  // A task from Turael (who never gives abyssal demons) stays as it is.
  const turael = [...require("../plugins/skills/slayer/Data.Slayer").get().masters.values()].find((master) => master.names.includes("Turael"));
  Tasks.assign(who.relic, turael);
  const task = Tasks.current(who.relic);
  assert.ok(task, "a Turael task");
  hooks.onNpcDeath({ killer: who.relic, npc: demon });
  assert.ok(slayerXp(who.relic) > 0, "the demon's Slayer XP, off task");
  assert.equal(Tasks.current(who.relic).count, task.count, "the task's count does not fall");
  for (const player of others(who)) {
    player.isPlayer = () => true;
    hooks.onNpcDeath({ killer: player, npc: demon });
    assert.equal(slayerXp(player), 0, `${player.getUsername()} gets none off task`);
  }

  // An off-task superior's Slayer XP comes once: ten times its hitpoints.
  const greater = npcOf("Greater abyssal demon");
  const beforeSuperior = slayerXp(who.relic);
  hooks.onNpcDeath({ killer: who.relic, npc: greater });
  assert.equal(slayerXp(who.relic) - beforeSuperior, greater.getDefinition().getHitpoints() * 10);
  // No Brimstone or Larran's key from a kill that only counts as on task.
  const placed = [];
  const place = (request) => placed.push(request);
  custom["npc-drops:place"] = [place, ...(custom["npc-drops:place"] ?? [])];
  require("../plugins/skills/slayer/Keys.Slayer").taskKill({ player: who.relic, npc: demon, offTask: true }, () => 0);
  assert.equal(placed.length, 0, "no key");
  custom["npc-drops:place"] = custom["npc-drops:place"].filter((handler) => handler !== place);

  // The 100th kill of a monster.
  const kills = require("../plugins/modes/leaguerelics/SlayerMaster.LeagueRelics").KILLS_ATTRIBUTE;
  who.relic.setAttribute(kills, { "Abyssal demon": 98 });
  const xp = slayerXp(who.relic);
  hooks.onNpcDeath({ killer: who.relic, npc: demon });
  assert.ok(!who.relic.messages.some((line) => /bonus Slayer XP/.test(line)), "the 99th is a plain kill");
  hooks.onNpcDeath({ killer: who.relic, npc: demon });
  assert.ok(who.relic.messages.some((line) => /^You gain [\d,]+ bonus Slayer XP\.$/.test(line)), who.relic.messages.join(" | "));
  assert.ok(slayerXp(who.relic) - xp > 2 * demon.getDefinition().getHitpoints() + 1000, "with the bonus");

  // The reward shop: free for the relic.
  const enumItems = core.CacheDefinitions.getEnumValues(840);
  const pouchSlot = [...enumItems.entries()].find(([, item]) => item === I.RUNE_POUCH)?.[0];
  assert.ok(Number.isInteger(pouchSlot), "the rune pouch is on the buy tab");
  Rewards.buy({ player: who.relic, slot: pouchSlot, opId: 2 });
  assert.equal(amount(who.relic, I.RUNE_POUCH), 1, "a rune pouch for no points");
  for (const player of others(who)) {
    Rewards.buy({ player, slot: pouchSlot, opId: 2 });
    assert.equal(amount(player, I.RUNE_POUCH), 0, `${player.getUsername()} needs the points`);
  }
  const bit = [...require("../plugins/skills/slayer/Data.Slayer").get().unlocks.values()].find((entry) => entry.cost > 0).bit;
  Rewards.unlock(who.relic, bit);
  assert.equal(Tasks.hasUnlockBit(who.relic, bit), true, "an unlock for no points");
  for (const player of others(who)) {
    Rewards.unlock(player, bit);
    assert.equal(Tasks.hasUnlockBit(player, bit), false, player.getUsername());
  }
});
