// Run after `yarn build`: node --test tests/dark-crab-elite-diary.test.cjs
// Wiki (Raw dark crab), quoting Mod Ash: "The standard roll is 3-40", but with the elite Wilderness Diary "you roll
// 13-55 / 255". The diary never changed the roll.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let core, Fishing, elite = false;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  Fishing = require("../plugins/skills/Fishing.plugin");
  const api = PluginManager.createApi("DarkCrabDiaryTest");
  Fishing.register(api);
  api.onCustomEvent("diary:is-complete", (request) => {
    if (request.diary === "wilderness" && request.tier === "elite") request.complete = elite;
  });
});

function fisher(level = 85) {
  return {
    getSkillManager: () => ({ getCurrentLevel: (skill) => (skill === core.Skill.FISHING ? level : 99) }),
    getInventory: () => ({ contains: () => true }),
    getEquipment: () => ({ contains: () => false }),
    getLocation: () => new core.Location(3200, 3700, 0),
    sendMessage() {},
    getPacketSender: () => ({ sendTypedMessage() {}, sendSoundEffect() {} }),
  };
}

test("the elite Wilderness Diary rolls dark crabs at 13-55 instead of 3-40", () => {
  const { TOOLS, FISH, catchChance } = Fishing;
  const base = catchChance(85, FISH.DARK_CRAB);
  const diary = catchChance(85, { rolls: [[13, 55]] });
  assert.ok(diary > base);
  const between = (base + diary) / 2;
  elite = false;
  assert.deepEqual(Fishing.rollCatch(fisher(), TOOLS.DARK_CRAB_POT, () => between), [], "a miss on the standard roll");
  elite = true;
  assert.deepEqual(Fishing.rollCatch(fisher(), TOOLS.DARK_CRAB_POT, () => between), [FISH.DARK_CRAB], "a catch with the diary");
  elite = false;
});

test("a failed diary roll still gets the standard roll: about 34% at 99 (Wiki, Mod Ash)", () => {
  const { TOOLS, FISH, catchChance } = Fishing;
  const diary = catchChance(99, { rolls: [[13, 55]] });
  const standard = catchChance(99, FISH.DARK_CRAB);
  // A miss on 13-55, then a hit on 3-40.
  const sequence = (values) => { let i = 0; return () => values[i++] ?? 0.99; };
  elite = true;
  assert.deepEqual(Fishing.rollCatch(fisher(99), TOOLS.DARK_CRAB_POT, sequence([diary + 0.001, standard - 0.001])),
    [FISH.DARK_CRAB], "the standard roll after a failed diary roll");
  // The combined chance over many attempts.
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let caught = 0;
  const attempts = 200000;
  for (let i = 0; i < attempts; i++) if (Fishing.rollCatch(fisher(99), TOOLS.DARK_CRAB_POT, random).length) caught++;
  assert.ok(Math.abs(caught / attempts - 0.344) < 0.005, `combined chance ${caught / attempts}`);
  assert.ok(Math.abs(1 - (1 - diary) * (1 - standard) - 0.344) < 0.001);
  elite = false;
});
