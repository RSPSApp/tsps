/**
 * What Combat Achievements hold, read from the cache on first use:
 *   enums 3981-3986    one per tier (Easy..Grandmaster): position -> task struct
 *   task struct        1306 id (its completion bit), 1308 name, 1309 description, 1310 tier (1-6),
 *                      1311 type (enum 3968), 1312 monster (enum 3970)
 *   enum 3980          tier (0-5) -> reward struct: 1330 name, 1333 antique lamp, 1335 Ghommal's hilt
 *   enum 3987          the bosses list: position -> struct, 1313 name, 1315 monster
 * A task is worth its tier in points; a tier unlocks at every point of its own tasks and the
 * tiers below (41/169/436/1100/1965/2697 at rev 241, as captured live).
 *
 * data/bosses.json (yarn dump:ca-bosses) pairs each monster with the kill-count varps its boss
 * page shows (script 4778) and the varbit counting its finished tasks (script 4780).
 * data/monsters.json names the NPCs whose deaths count for a monster where the cache name does
 * not, and the monsters counted by their own plugins instead (combat-achievements:kill).
 */
const MONSTERS_DATA = require("./data/monsters.json");
const BOSSES_DATA = require("./data/bosses.json");

const TIER_ENUMS = [3981, 3982, 3983, 3984, 3985, 3986];
const TIER_NAME_ENUM = 3967;
const TYPE_NAME_ENUM = 3968;
const MONSTER_NAME_ENUM = 3970;
const REWARD_ENUM = 3980;
const BOSS_LIST_ENUM = 3987;

const PARAM = {
  ID: 1306, NAME: 1308, DESCRIPTION: 1309, TIER: 1310, TYPE: 1311, MONSTER: 1312,
  REWARD_NAME: 1330, REWARD_LAMP: 1333, REWARD_HILT: 1335,
  BOSS_NAME: 1313, BOSS_MONSTER: 1315,
};

/** Task type ids (enum 3968). */
const TYPE = { STAMINA: 1, PERFECTION: 2, KILL_COUNT: 3, MECHANICAL: 4, RESTRICTION: 5, SPEED: 6 };

/** ca_task_completed_0..20: task id N is bit N % 32 of the (N / 32)th (script 4834). */
const TASK_VARPS = [3116, 3117, 3118, 3119, 3120, 3121, 3122, 3123, 3124, 3125, 3126, 3127, 3128, 3387, 3718, 3773, 3774, 4204, 4496, 4721, 5673];

/** Per tier, Easy first. */
const TIER_VARBITS = {
  COMPLETED: [12885, 12886, 12887, 12888, 12889, 12890], // ca_total_tasks_completed_<tier>
  THRESHOLD: [4132, 10660, 10661, 14812, 14813, 14814], // ca_threshold_<tier>
  STATUS: [12863, 12864, 12865, 12866, 12867, 12868], // ca_tier_status_<tier>: 0 locked, 1 unlocked, 2 claimed
  LAMP_CLAIMED: [12869, 12870, 12871, 12872, 12873, 12874], // ca_lamp_claimed_<tier>
};
const POINTS_VARBIT = 14815; // ca_points

/** "Kill the King Black Dragon 10 times.", "Open Obor's chest once.", "Kill a Black Dragon." */
const KILL_COUNT_PATTERN = /^(?:Kill|Defeat|Subdue|Complete|Open) (.+?)(?: (once|\d[\d,]* times))?\.?$/;
/** A kill-count task whose target carries a condition (a mode, a place, a level) is left to its plugin. */
const KILL_COUNT_CONDITION = /\b(?:in|after|within|without|and|while|using|with|on|under|levels?|at|from|before|waves?|solo|duo|trio)\b|,/i;

let core;
let data = null;

function bind(api) {
  core = api.core;
}

function killCountTarget(task) {
  if (task.type !== TYPE.KILL_COUNT) return null;
  const match = KILL_COUNT_PATTERN.exec(task.description.trim());
  if (!match || KILL_COUNT_CONDITION.test(match[1])) return null;
  return !match[2] || match[2] === "once" ? 1 : Number(match[2].replace(/\D/g, ""));
}

/**
 * The NPC names whose deaths count for a monster: the cache name, read as an NPC name would be.
 * A monster with no kill-count varp is a kind of creature, named in the plural ("Black Dragons").
 */
function npcNamesFor(name, plural) {
  const override = MONSTERS_DATA.npcs[name];
  if (override) return override;
  let base = name.replace(/^(?:DK|HM|EM|CM|XM): /, "");
  const trailingThe = /^(.*), The$/.exec(base);
  if (trailingThe) base = `The ${trailingThe[1]}`;
  const names = [base];
  if (plural && /s$/.test(base)) names.push(base.replace(/s$/, ""));
  if (/^DK: /.test(name)) names.push(`Dagannoth ${base}`);
  if (/^The /.test(base)) names.push(base.replace(/^The /, ""));
  return names;
}

function load() {
  if (data) return data;
  const { CacheDefinitions } = core;
  const enumOf = (id) => CacheDefinitions.getEnumValues(id);
  const tierNames = enumOf(TIER_NAME_ENUM);
  const typeNames = enumOf(TYPE_NAME_ENUM);

  const monsters = new Map();
  for (const [key, name] of enumOf(MONSTER_NAME_ENUM)) {
    if (Number(key) <= 0) continue;
    monsters.set(Number(key), {
      key: Number(key), name: String(name), tasks: [], killVarps: [], tasksVarbit: null,
      byEvent: MONSTERS_DATA.countedByEvent.includes(String(name)),
      npcNames: [],
    });
  }
  for (const boss of BOSSES_DATA) {
    const monster = monsters.get(boss.key);
    if (!monster) continue;
    monster.killVarps = boss.killVarps.map((varp) => varp.id);
    monster.tasksVarbit = boss.tasksVarbit?.id ?? null;
  }
  for (const monster of monsters.values()) {
    if (!monster.byEvent) monster.npcNames = npcNamesFor(monster.name, monster.killVarps.length === 0);
  }

  const tiers = TIER_ENUMS.map((_, index) => {
    const reward = CacheDefinitions.getStructParams(Number(enumOf(REWARD_ENUM).get(index)));
    return {
      tier: index + 1,
      index,
      name: String(tierNames.get(index + 1)),
      points: index + 1,
      lamp: Number(reward.get(PARAM.REWARD_LAMP)),
      hilt: Number(reward.get(PARAM.REWARD_HILT)),
      tasks: [],
      threshold: 0,
    };
  });

  const tasks = new Map();
  const byName = new Map();
  TIER_ENUMS.forEach((enumId) => {
    for (const struct of enumOf(enumId).values()) {
      const params = CacheDefinitions.getStructParams(Number(struct));
      const task = {
        id: Number(params.get(PARAM.ID)),
        struct: Number(struct),
        name: String(params.get(PARAM.NAME)),
        description: String(params.get(PARAM.DESCRIPTION)),
        tier: Number(params.get(PARAM.TIER)),
        type: Number(params.get(PARAM.TYPE)),
        typeName: String(typeNames.get(Number(params.get(PARAM.TYPE))) ?? ""),
        monsterKey: Number(params.get(PARAM.MONSTER)),
      };
      task.points = task.tier;
      task.monster = monsters.get(task.monsterKey) ?? null;
      task.killCount = killCountTarget(task);
      tasks.set(task.id, task);
      byName.set(task.name.toLowerCase(), task);
      tiers[task.tier - 1].tasks.push(task);
      task.monster?.tasks.push(task);
    }
  });
  let cumulative = 0;
  for (const tier of tiers) {
    cumulative += tier.tasks.length * tier.points;
    tier.threshold = cumulative;
  }

  const bossList = [...enumOf(BOSS_LIST_ENUM)].map(([position, struct]) => {
    const params = CacheDefinitions.getStructParams(Number(struct));
    return { position: Number(position), name: String(params.get(PARAM.BOSS_NAME)), monster: monsters.get(Number(params.get(PARAM.BOSS_MONSTER))) ?? null };
  });

  const monstersByNpcName = new Map();
  for (const monster of monsters.values()) {
    for (const npcName of monster.npcNames) monstersByNpcName.set(npcName.toLowerCase(), monster);
  }
  const monstersByName = new Map([...monsters.values()].map((monster) => [monster.name.toLowerCase(), monster]));

  data = { tasks, byName, tiers, monsters, monstersByName, monstersByNpcName, bossList };
  return data;
}

const tasks = () => load().tasks;
const task = (id) => load().tasks.get(Number(id)) ?? null;
/** A task by its cache name, case-insensitive ("Perfect Zulrah"). */
const taskNamed = (name) => load().byName.get(String(name).toLowerCase()) ?? null;
const tiers = () => load().tiers;
const monsters = () => load().monsters;
/** A monster by its cache name ("Zulrah", "DK: Rex", "Nightmare, The"), case-insensitive. */
const monsterNamed = (name) => load().monstersByName.get(String(name).toLowerCase()) ?? null;
const monsterForNpc = (npcName) => load().monstersByNpcName.get(String(npcName).toLowerCase()) ?? null;
const bossList = () => load().bossList;
const totalPoints = () => load().tiers.at(-1).threshold;

module.exports = {
  TYPE, TASK_VARPS, TIER_VARBITS, POINTS_VARBIT,
  bind, load, tasks, task, taskNamed, tiers, monsters, monsterNamed, monsterForNpc, bossList, totalPoints, killCountTarget,
};
