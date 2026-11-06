// node --test tests/champions-challenge.test.cjs
// Champions' Challenge (Wiki: Champions' Challenge, Larxus, Champion's scroll): Larxus's transcript
// covers every champion, each champion's rule, the reward conditions, Leon d'Cour's challenge, the
// statue's carry rules and which kills drop a scroll.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const DIALOGUES = require("../data/definitions/npc-dialogues.json");
const Common = require("../plugins/minigames/championschallenge/Common.ChampionsChallenge");
const Rules = require("../plugins/minigames/championschallenge/Rules.ChampionsChallenge");
const Larxus = require("../plugins/minigames/championschallenge/Larxus.ChampionsChallenge");
const Combat = require("../plugins/minigames/championschallenge/Combat.ChampionsChallenge");
const Gallery = require("../plugins/minigames/championschallenge/Gallery.ChampionsChallenge");
const Rewards = require("../plugins/minigames/championschallenge/Rewards.ChampionsChallenge");
const { QUEST_POINTS_ATTRIBUTE } = require("../plugins/quests/QuestRuntime");
const { RegionManager } = require("../dist/game/collision/RegionManager");

const WEAPON_SLOT = 3;
const CombatType = { MELEE: "melee", RANGED: "ranged", MAGIC: "magic" };
const LAMP = Common.DATA.items.lamp;
const champion = (key) => Common.byKey.get(key);
const bitsOf = (...keys) => keys.reduce((bits, key) => bits | (1 << champion(key).bit), 0);

class TestLocation { constructor(x, y, z = 0) { this.x = x; this.y = y; this.z = z; } }
const baseCore = {
  CombatType,
  Equipment: { WEAPON_SLOT },
  Location: TestLocation,
  Skill: { PRAYER: 5 },
  Misc: { randomInclusive: (min, max) => max },
  Projectile: { centreOf: (mobile) => mobile.getLocation(), arrivalTicks: () => 3 },
  applyPrayerDrainModifiers: (player, amount) => amount,
  CacheDefinitions: { getItem: () => ({ category: -1 }) },
  RegionManager,
};
const initCore = (extra = {}) => Common.init({ core: { ...baseCore, ...extra }, emitCustomEvent: () => {} });

before(() => initCore());

/** Items are { slot } for what they equip to (-1: nothing), with a name for the material rule. */
const item = (slot, name = "") => ({
  getId: () => -1,
  getDefinition: () => ({
    getEquipmentType: () => ({ getSlot: () => slot }),
    getName: () => name,
  }),
});

function player({ defeated = 0, lamps = 0, inventory = [], worn = [], free = 28, questPoints = 32 } = {}) {
  const attributes = {
    [Common.DEFEATED_ATTRIBUTE]: defeated,
    [Common.LAMPS_ATTRIBUTE]: lamps,
    [QUEST_POINTS_ATTRIBUTE]: questPoints,
  };
  const messages = [];
  return {
    messages,
    sendMessage: (text) => messages.push(text),
    getAttribute: (key) => attributes[key],
    setAttribute: (key, value) => { attributes[key] = value; },
    getInventory: () => ({
      contains: (id) => inventory.includes(id),
      getFreeSlots: () => free,
      getValidItems: () => inventory.map((entry) => (typeof entry === "number" ? item(-1) : entry)),
    }),
    getEquipment: () => ({ getValidItems: () => worn }),
  };
}

const larxusVariants = () => Object.keys(DIALOGUES.Larxus.variants);

test("Larxus's transcript has every scroll's rules and every statue refusal the plugin plays", () => {
  const variants = larxusVariants();
  for (const entry of Common.SCROLL_CHAMPIONS) {
    assert.ok(variants.includes(Larxus.scrollVariant(entry)), Larxus.scrollVariant(entry));
  }
  for (const key of ["ghoul", "lesserdemon", "leon"]) {
    const refusal = Rules.entryRefusal(champion(key), player({ inventory: [item(4)] }));
    assert.ok(variants.includes(refusal), `${key}: ${refusal}`);
  }
  const materials = Rules.entryRefusal(champion("lesserdemon"), player({ inventory: [item(-1, "Iron bar")] }));
  assert.ok(variants.includes(materials), `lesserdemon materials: ${materials}`);
});

test("each scroll's rule sentence matches the style the plugin enforces", () => {
  const variants = DIALOGUES.Larxus.variants;
  for (const entry of Common.SCROLL_CHAMPIONS) {
    const line = variants[Larxus.scrollVariant(entry)][0].npc;
    const { only, not } = entry.rule;
    if (only) assert.match(line, new RegExp(`only allowed to use ${only} attacks`), entry.key);
    if (not) assert.match(line, new RegExp(`not allowed to use any ${not} attacks`), entry.key);
  }
});

test("style rules refuse the styles a champion forbids, with the captured wording", () => {
  assert.equal(Rules.styleRefusal(champion("giant"), CombatType.MELEE), null);
  assert.equal(Rules.styleRefusal(champion("giant"), CombatType.RANGED), "only allowed to use Melee");
  assert.equal(Rules.styleRefusal(champion("skeleton"), CombatType.MAGIC), "only allowed to use Ranged");
  assert.equal(Rules.styleRefusal(champion("zombie"), CombatType.MAGIC), "not allowed to use Magic");
  assert.equal(Rules.styleRefusal(champion("zombie"), CombatType.RANGED), null);
  assert.equal(Rules.styleRefusal(champion("hobgoblin"), CombatType.MELEE), "not allowed to use Melee");
  assert.equal(Rules.styleRefusal(champion("jogre"), CombatType.RANGED), "not allowed to use Ranged");
  assert.equal(Rules.styleRefusal(champion("imp"), CombatType.MAGIC), null);
});

test("the statue lets in only what each fight allows", () => {
  const weapon = item(WEAPON_SLOT);
  const armour = item(4);
  // Wiki: the Ghoul allows only a weapon in the weapon slot, with an empty inventory.
  assert.equal(Rules.entryRefusal(champion("ghoul"), player({ worn: [weapon] })), null);
  assert.ok(Rules.entryRefusal(champion("ghoul"), player({ worn: [weapon], inventory: [weapon] })));
  assert.ok(Rules.entryRefusal(champion("ghoul"), player({ worn: [weapon, armour] })));
  assert.ok(Rules.entryRefusal(champion("ghoul"), player({ inventory: [6799] })), "the scroll itself is not a weapon");
  assert.equal(Rules.entryRefusal(champion("lesserdemon"), player({ inventory: [item(-1)] })), null);
  assert.ok(Rules.entryRefusal(champion("lesserdemon"), player({ worn: [armour] })));
  assert.ok(Rules.entryRefusal(champion("lesserdemon"), player({ inventory: [weapon] })));
  assert.ok(Rules.entryRefusal(champion("lesserdemon"), player({ inventory: [item(-1, "Iron bar")] })), "materials to make equipment");
  assert.ok(Rules.entryRefusal(champion("lesserdemon"), player({ inventory: [item(-1, "Knife")] })), "a fletching tool");
  assert.ok(Rules.entryRefusal(champion("lesserdemon"), player({ inventory: [item(-1, "Imbued heart")] })), "the Wiki names the imbued heart");
  assert.equal(Rules.entryRefusal(champion("lesserdemon"), player({ inventory: [item(-1, "Fire rune")] })), null, "runes are allowed");
  assert.equal(Rules.entryRefusal(champion("lesserdemon"), player({ inventory: [item(-1, "Prayer potion(4)")] })), null, "potions are allowed");
  assert.equal(Rules.entryRefusal(champion("leon"), player({ worn: [weapon, armour] })), null);
  assert.ok(Rules.entryRefusal(champion("leon"), player({ inventory: [item(-1)] })));
  assert.equal(Rules.entryRefusal(champion("giant"), player({ inventory: [6800] })), null);
});

test("'Have you any rewards for me?' follows the defeats, the lamp and what was claimed", () => {
  const ask = (state, text) => Larxus.answerCondition({ player: player(state), npcId: Common.LARXUS, text });
  assert.equal(ask({}, "Before defeating any champions:"), true);
  const giant = bitsOf("giant");
  assert.equal(ask({ defeated: giant }, "Before defeating any champions:"), false);
  assert.equal(ask({ defeated: giant }, "Before claiming a reward:"), true);
  assert.equal(ask({ defeated: giant, inventory: [LAMP] }, "Before claiming a reward:"), false);
  assert.equal(ask({ defeated: giant, inventory: [LAMP] }, "While holding a Champion's lamp:"), true);
  assert.equal(ask({ defeated: giant, lamps: giant }, "Before claiming a reward:"), false);
  assert.equal(ask({ defeated: giant, lamps: giant }, "While holding a Champion's lamp:"), false);
  assert.equal(ask({ inventory: [6800] }, "If the player has a Champion's scroll in their inventory:"), true);
  assert.equal(ask({}, "If the player has a Champion's scroll in their inventory:"), false);
  assert.equal(ask({ free: 0 }, "If the player has no inventory space:"), true);
});

test("Leon d'Cour challenges only once all ten champions are beaten, and gives his cape after", () => {
  const ten = Common.SCROLL_CHAMPIONS.reduce((bits, entry) => bits | (1 << entry.bit), 0);
  const nine = ten & ~bitsOf("lesserdemon");
  assert.equal(Common.leonUnlocked(player({ defeated: nine })), false);
  assert.equal(Common.leonUnlocked(player({ defeated: ten })), true);
  const variants = larxusVariants();
  const leonDefeated = Larxus.pickVariant({ player: player({ defeated: ten | bitsOf("leon") }), npcId: Common.LARXUS });
  assert.ok(variants.includes(leonDefeated));
  assert.match(leonDefeated, /after-defeating-leon/);
});

test("the lamp claims the first champion beaten and not yet rubbed for", () => {
  const state = { defeated: bitsOf("giant", "imp"), lamps: bitsOf("giant") };
  assert.equal(Common.unclaimed(player(state)), champion("imp"));
  assert.equal(Common.unclaimed(player({ defeated: bitsOf("giant"), lamps: bitsOf("giant") })), null);
});

test("scrolls drop only with 32 Quest Points, and never for a champion already beaten", () => {
  const drops = () => [{ itemId: 6800, amount: 1 }, { itemId: 995, amount: 10 }];
  const fresh = player();
  const kept = drops();
  Rewards.gateScrollDrops({ player: fresh, drops: kept });
  assert.equal(kept.length, 2);
  assert.match(fresh.messages[0], /A Champion's scroll falls to the ground/);

  const beaten = player({ defeated: bitsOf("giant") });
  const withheld = drops();
  Rewards.gateScrollDrops({ player: beaten, drops: withheld });
  assert.deepEqual(withheld.map((drop) => drop.itemId), [995]);
  assert.match(beaten.messages[0], /You have a funny feeling that you would have received a Champion's scroll/);

  const newcomer = player({ questPoints: 31 });
  const none = drops();
  Rewards.gateScrollDrops({ player: newcomer, drops: none });
  assert.deepEqual(none.map((drop) => drop.itemId), [995]);
  assert.equal(newcomer.messages.length, 0);
});

test("the Goblin's spell drains Prayer, and only when it lands", () => {
  let drained = 0;
  const target = {
    isPlayer: () => true,
    getAsPlayer: () => target,
    getSkillManager: () => ({ decreaseCurrentLevel: (skill, amount) => { drained += amount; } }),
  };
  const landed = { isAccurate: () => true, getTarget: () => target, getAttacker: () => null };
  assert.equal(Combat.drainPrayer({ drainPrayer: 1 }, landed, null), 1);
  assert.equal(drained, 1);
  assert.equal(Combat.drainPrayer({ drainPrayer: 1 }, { ...landed, isAccurate: () => false }, null), 0);
  assert.equal(drained, 1);
});

test("the Jogre's poison starts at 8 damage, not the generic NPC severity", () => {
  const poison = { attacker: { getId: () => champion("jogre").npc }, severity: 30, venomous: false };
  Combat.adjustChampionPoison(poison);
  // Ordinary poison stores five severity points per starting damage.
  assert.equal(poison.severity, 40);
  assert.equal(poison.venomous, false);
  let damageFromSeverity;
  try {
    ({ CombatPoisonEffect: { damageFromSeverity } } = require("../dist/game/task/impl/CombatPoisonEffect"));
  } catch {
    damageFromSeverity = (severity) => Math.floor((severity + 4) / 5);
  }
  assert.equal(damageFromSeverity(poison.severity), 8, "the first poison pulse deals 8");
});

test("a projectile's hit lands when it arrives", () => {
  assert.equal(Combat.landingTicks({ style: "RANGED", projectile: 494 }, {}, {}), 3);
  assert.equal(Combat.landingTicks({ style: "RANGED", landingTicks: 1 }, {}, {}), 1);
  assert.equal(Combat.landingTicks({ style: "MELEE" }, {}, {}), 0);
});

test("the Imp teleports inside the arena when damaged", () => {
  const location = (x, y) => ({
    getX: () => x,
    getY: () => y,
    getZ: () => 0,
    equals: (other) => other.getX() === x && other.getY() === y && other.getZ() === 0,
  });
  let moved = null;
  const npc = {
    getHitpoints: () => 30,
    getLocation: () => location(3170, 9758),
    getMovementQueue: () => ({ reset: () => {} }),
    moveTo: (tile) => { moved = tile; },
  };
  const session = {
    player: { getLocation: () => location(0, 0) },
    champion: npc,
    challenge: champion("imp"),
    worldTile: () => [3170, 9758],
    tile: ([x, y]) => location(x, y),
    area: { getClip: () => 0 },
  };
  npc.getHitpoints = () => 40;
  Combat.processChampion(session, npc);
  npc.getHitpoints = () => 30;
  const random = Math.random;
  Math.random = () => 0;
  try {
    Combat.processChampion(session, npc);
  } finally {
    Math.random = random;
  }
  assert.ok(moved, "the Imp moved");
  assert.ok(moved.getX() >= Common.DATA.arena.minX && moved.getX() <= Common.DATA.arena.maxX);
  assert.ok(moved.getY() >= Common.DATA.arena.minY && moved.getY() <= Common.DATA.arena.maxY);
});

test("leaving the basement rescues a champion's scroll left on its floor", (t) => {
  const area = {};
  const removed = [];
  const added = [];
  const placed = [];
  const scroll = { getPrivateArea: () => area, isPendingRemoval: () => false, getItem: () => ({ getId: () => 6800, getAmount: () => 1 }) };
  // Native pickup credits the inventory and leaves its ground source pending until the next
  // ground-item pass. Cleanup must not credit the same scroll again.
  const pickedUp = { getPrivateArea: () => area, isPendingRemoval: () => true, getItem: () => ({ getId: () => 6801, getAmount: () => 1 }) };
  const other = { getPrivateArea: () => area, isPendingRemoval: () => false, getItem: () => ({ getId: () => 995, getAmount: () => 10 }) };
  class TestItem { constructor(id, amount) { this.id = id; this.amount = amount; } getId() { return this.id; } getAmount() { return this.amount; } }
  initCore({
    World: { getItems: () => [scroll, pickedUp, other] },
    ItemOnGroundManager: {
      deregister: (item) => removed.push(item),
      registerLocation: (player, item) => placed.push(item),
    },
    Item: TestItem,
  });
  t.after(() => initCore());
  const session = {
    area,
    player: { getInventory: () => ({ getFreeSlots: () => 1, adds: (id, amount) => added.push([id, amount]) }) },
  };
  Gallery.rescueScrolls(session);
  assert.deepEqual(added, [[6800, 1]]);
  assert.deepEqual(removed, [scroll]);
  assert.equal(placed.length, 0);
});
