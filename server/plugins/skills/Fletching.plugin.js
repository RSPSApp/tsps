const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { CreationMenu } = require("../../src/main/typescript/elvarg/game/model/menu/CreationMenu");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

// Cutting and stringing sequences carry their OSRS sound in their frames.
const CUTTING_ANIMATION = new Animation(1248);

// OSRS timing references:
// - Unstrung bows / crossbows: 3 ticks per item.
// - Bow / crossbow stringing: 2 ticks per item.
// - Arrows and darts: 2 ticks per set.
// - Feathering bolts: 1 tick per set.
const TICKS_CUT_LOGS = 3;
const TICKS_STRING_BOWS = 2;
const TICKS_ARROWS_AND_DARTS = 2;
const TICKS_FEATHER_BOLTS = 1;
const CREATION_ALL_SENTINEL = 28;

let fletchingTick = 0;

function itemId(name) {
  const id = ItemIds[name];
  return Number.isInteger(id) ? id : null;
}

function buildRecipe(config) {
  const outputId = itemId(config.output);
  if (!Number.isInteger(outputId)) {
    return null;
  }

  const requirements = [];
  for (const req of config.requirements || []) {
    const reqItemId = itemId(req.item);
    if (!Number.isInteger(reqItemId)) {
      return null;
    }
    requirements.push({
      id: reqItemId,
      amount: Number.isInteger(req.amount) && req.amount > 0 ? req.amount : 1,
      consume: req.consume !== false,
    });
  }

  return {
    key: config.key,
    outputId,
    outputAmount:
      Number.isInteger(config.outputAmount) && config.outputAmount > 0
        ? config.outputAmount
        : 1,
    level: config.level,
    xp: config.xp,
    intervalTicks: config.intervalTicks,
    animation:
      Number.isInteger(config.animationId) && config.animationId >= 0
        ? new Animation(config.animationId)
        : CUTTING_ANIMATION,
    requirements,
  };
}

function indexBy(recipeList, keyExtractor) {
  const map = new Map();
  for (const recipe of recipeList) {
    if (!recipe) {
      continue;
    }
    const key = keyExtractor(recipe);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(recipe);
  }
  return map;
}

const LOG_RECIPE_DEFINITIONS = [
  { log: "LOGS", output: "ARROW_SHAFT", outputAmount: 15, level: 1, xp: 5 },
  { log: "LOGS", output: "WOODEN_STOCK", level: 9, xp: 6 },
  { log: "LOGS", output: "SHORTBOW_U_", level: 5, xp: 5 },
  { log: "LOGS", output: "LONGBOW_U_", level: 10, xp: 10 },

  { log: "OAK_LOGS", output: "ARROW_SHAFT", outputAmount: 30, level: 15, xp: 10 },
  { log: "OAK_LOGS", output: "OAK_STOCK", level: 24, xp: 16 },
  { log: "OAK_LOGS", output: "OAK_SHORTBOW_U_", level: 20, xp: 16.5 },
  { log: "OAK_LOGS", output: "OAK_LONGBOW_U_", level: 25, xp: 25 },

  { log: "WILLOW_LOGS", output: "ARROW_SHAFT", outputAmount: 45, level: 30, xp: 15 },
  { log: "WILLOW_LOGS", output: "WILLOW_STOCK", level: 39, xp: 22 },
  { log: "WILLOW_LOGS", output: "WILLOW_SHORTBOW_U_", level: 35, xp: 33.3 },
  { log: "WILLOW_LOGS", output: "WILLOW_LONGBOW_U_", level: 40, xp: 41.5 },

  { log: "TEAK_LOGS", output: "TEAK_STOCK", level: 46, xp: 27 },

  { log: "MAPLE_LOGS", output: "ARROW_SHAFT", outputAmount: 60, level: 45, xp: 20 },
  { log: "MAPLE_LOGS", output: "MAPLE_STOCK", level: 54, xp: 32 },
  { log: "MAPLE_LOGS", output: "MAPLE_SHORTBOW_U_", level: 50, xp: 50 },
  { log: "MAPLE_LOGS", output: "MAPLE_LONGBOW_U_", level: 55, xp: 58.3 },

  { log: "MAHOGANY_LOGS", output: "MAHOGANY_STOCK", level: 61, xp: 41 },

  { log: "YEW_LOGS", output: "ARROW_SHAFT", outputAmount: 75, level: 60, xp: 25 },
  { log: "YEW_LOGS", output: "YEW_STOCK", level: 69, xp: 50 },
  { log: "YEW_LOGS", output: "YEW_SHORTBOW_U_", level: 65, xp: 67.5 },
  { log: "YEW_LOGS", output: "YEW_LONGBOW_U_", level: 70, xp: 75 },

  { log: "MAGIC_LOGS", output: "ARROW_SHAFT", outputAmount: 90, level: 75, xp: 30 },
  { log: "MAGIC_LOGS", output: "MAGIC_STOCK", level: 78, xp: 70 },
  { log: "MAGIC_LOGS", output: "MAGIC_SHORTBOW_U_", level: 80, xp: 83.3 },
  { log: "MAGIC_LOGS", output: "MAGIC_LONGBOW_U_", level: 85, xp: 91.5 },
].map((entry) =>
  buildRecipe({
    key: `log:${entry.log}:${entry.output}`,
    output: entry.output,
    outputAmount: entry.outputAmount,
    level: entry.level,
    xp: entry.xp,
    intervalTicks: TICKS_CUT_LOGS,
    animationId: 1248,
    requirements: [
      { item: "KNIFE", amount: 1, consume: false },
      { item: entry.log, amount: 1, consume: true },
    ],
  })
);

const LOG_RECIPES_BY_LOG = indexBy(LOG_RECIPE_DEFINITIONS, (recipe) =>
  recipe.requirements[1].id
);

const STRINGING_RECIPE_DEFINITIONS = [
  {
    unstrung: "SHORTBOW_U_",
    string: "BOW_STRING",
    output: "SHORTBOW",
    level: 5,
    xp: 5,
    animationId: 6678,
  },
  {
    unstrung: "LONGBOW_U_",
    string: "BOW_STRING",
    output: "LONGBOW",
    level: 10,
    xp: 10,
    animationId: 6684,
  },
  {
    unstrung: "OAK_SHORTBOW_U_",
    string: "BOW_STRING",
    output: "OAK_SHORTBOW",
    level: 20,
    xp: 16.5,
    animationId: 6679,
  },
  {
    unstrung: "OAK_LONGBOW_U_",
    string: "BOW_STRING",
    output: "OAK_LONGBOW",
    level: 25,
    xp: 25,
    animationId: 6685,
  },
  {
    unstrung: "WILLOW_SHORTBOW_U_",
    string: "BOW_STRING",
    output: "WILLOW_SHORTBOW",
    level: 35,
    xp: 33.3,
    animationId: 6680,
  },
  {
    unstrung: "WILLOW_LONGBOW_U_",
    string: "BOW_STRING",
    output: "WILLOW_LONGBOW",
    level: 40,
    xp: 41.5,
    animationId: 6686,
  },
  {
    unstrung: "MAPLE_SHORTBOW_U_",
    string: "BOW_STRING",
    output: "MAPLE_SHORTBOW",
    level: 50,
    xp: 50,
    animationId: 6681,
  },
  {
    unstrung: "MAPLE_LONGBOW_U_",
    string: "BOW_STRING",
    output: "MAPLE_LONGBOW",
    level: 55,
    xp: 58.3,
    animationId: 6687,
  },
  {
    unstrung: "YEW_SHORTBOW_U_",
    string: "BOW_STRING",
    output: "YEW_SHORTBOW",
    level: 65,
    xp: 67.5,
    animationId: 6682,
  },
  {
    unstrung: "YEW_LONGBOW_U_",
    string: "BOW_STRING",
    output: "YEW_LONGBOW",
    level: 70,
    xp: 75,
    animationId: 6688,
  },
  {
    unstrung: "MAGIC_SHORTBOW_U_",
    string: "BOW_STRING",
    output: "MAGIC_SHORTBOW",
    level: 80,
    xp: 83.3,
    animationId: 6683,
  },
  {
    unstrung: "MAGIC_LONGBOW_U_",
    string: "BOW_STRING",
    output: "MAGIC_LONGBOW",
    level: 85,
    xp: 91.5,
    animationId: 6689,
  },
  {
    unstrung: "BRONZE_CROSSBOW_U_",
    string: "CROSSBOW_STRING",
    output: "BRONZE_CROSSBOW",
    level: 9,
    xp: 6,
    animationId: 6671,
  },
  {
    unstrung: "BLURITE_CROSSBOW_U_",
    string: "CROSSBOW_STRING",
    output: "BLURITE_CROSSBOW",
    level: 24,
    xp: 16,
    animationId: 6672,
  },
  {
    unstrung: "IRON_CROSSBOW_U_",
    string: "CROSSBOW_STRING",
    output: "IRON_CROSSBOW",
    level: 39,
    xp: 22,
    animationId: 6673,
  },
  {
    unstrung: "STEEL_CROSSBOW_U_",
    string: "CROSSBOW_STRING",
    output: "STEEL_CROSSBOW",
    level: 46,
    xp: 27,
    animationId: 6674,
  },
  {
    unstrung: "MITHRIL_CROSSBOW_U_",
    string: "CROSSBOW_STRING",
    output: "MITH_CROSSBOW",
    level: 54,
    xp: 32,
    animationId: 6675,
  },
  {
    unstrung: "ADAMANT_CROSSBOW_U_",
    string: "CROSSBOW_STRING",
    output: "ADAMANT_CROSSBOW",
    level: 61,
    xp: 41,
    animationId: 6676,
  },
  {
    unstrung: "RUNITE_CROSSBOW_U_",
    string: "CROSSBOW_STRING",
    output: "RUNE_CROSSBOW",
    level: 69,
    xp: 50,
    animationId: 6677,
  },
  {
    unstrung: "DRAGON_CROSSBOW_U_",
    string: "CROSSBOW_STRING",
    output: "DRAGON_CROSSBOW",
    level: 78,
    xp: 70,
    animationId: 6677,
  },
]
  .map((entry) =>
    buildRecipe({
      key: `string:${entry.unstrung}`,
      output: entry.output,
      level: entry.level,
      xp: entry.xp,
      intervalTicks: TICKS_STRING_BOWS,
      animationId: entry.animationId,
      requirements: [
        { item: entry.unstrung, amount: 1, consume: true },
        { item: entry.string, amount: 1, consume: true },
      ],
    })
  )
  .filter(Boolean);

const STRINGING_RECIPES_BY_UNSTRUNG = new Map(
  STRINGING_RECIPE_DEFINITIONS.map((recipe) => [recipe.requirements[0].id, recipe])
);

const CROSSBOW_LIMB_RECIPE_DEFINITIONS = [
  {
    stock: "WOODEN_STOCK",
    limbs: "BRONZE_LIMBS",
    output: "BRONZE_CROSSBOW_U_",
    level: 9,
    xp: 12,
  },
  {
    stock: "OAK_STOCK",
    limbs: "BLURITE_LIMBS",
    output: "BLURITE_CROSSBOW_U_",
    level: 24,
    xp: 16,
  },
  {
    stock: "OAK_STOCK",
    limbs: "IRON_LIMBS",
    output: "IRON_CROSSBOW_U_",
    level: 39,
    xp: 22,
  },
  {
    stock: "WILLOW_STOCK",
    limbs: "STEEL_LIMBS",
    output: "STEEL_CROSSBOW_U_",
    level: 46,
    xp: 27,
  },
  {
    stock: "MAPLE_STOCK",
    limbs: "MITHRIL_LIMBS",
    output: "MITHRIL_CROSSBOW_U_",
    level: 54,
    xp: 32,
  },
  {
    stock: "MAHOGANY_STOCK",
    limbs: "ADAMANTITE_LIMBS",
    output: "ADAMANT_CROSSBOW_U_",
    level: 61,
    xp: 41,
  },
  {
    stock: "YEW_STOCK",
    limbs: "RUNITE_LIMBS",
    output: "RUNITE_CROSSBOW_U_",
    level: 69,
    xp: 50,
  },
  {
    stock: "MAGIC_STOCK",
    limbs: "DRAGON_LIMBS",
    output: "DRAGON_CROSSBOW_U_",
    level: 78,
    xp: 70,
  },
]
  .map((entry) =>
    buildRecipe({
      key: `crossbow_limb:${entry.stock}:${entry.limbs}`,
      output: entry.output,
      level: entry.level,
      xp: entry.xp,
      intervalTicks: TICKS_CUT_LOGS,
      animationId: 1248,
      requirements: [
        { item: "HAMMER", amount: 1, consume: false },
        { item: entry.stock, amount: 1, consume: true },
        { item: entry.limbs, amount: 1, consume: true },
      ],
    })
  )
  .filter(Boolean);

const CROSSBOW_LIMB_RECIPES_BY_COMPONENTS = new Map();
for (const recipe of CROSSBOW_LIMB_RECIPE_DEFINITIONS) {
  const stockId = recipe.requirements[1].id;
  const limbsId = recipe.requirements[2].id;
  CROSSBOW_LIMB_RECIPES_BY_COMPONENTS.set(`${stockId}:${limbsId}`, recipe);
  CROSSBOW_LIMB_RECIPES_BY_COMPONENTS.set(`${limbsId}:${stockId}`, recipe);
}

const HEADLESS_RECIPE = buildRecipe({
  key: "ammo:headless_arrows",
  output: "HEADLESS_ARROW",
  outputAmount: 15,
  level: 1,
  xp: 15,
  intervalTicks: TICKS_ARROWS_AND_DARTS,
  animationId: 1248,
  requirements: [
    { item: "ARROW_SHAFT", amount: 15, consume: true },
    { item: "FEATHER", amount: 15, consume: true },
  ],
});

const ARROW_RECIPES_BY_TIP = new Map(
  [
    { tip: "BRONZE_ARROWTIPS", output: "BRONZE_ARROW", level: 1, xp: 19.5 },
    { tip: "IRON_ARROWTIPS", output: "IRON_ARROW", level: 15, xp: 37.5 },
    { tip: "STEEL_ARROWTIPS", output: "STEEL_ARROW", level: 30, xp: 75 },
    { tip: "MITHRIL_ARROWTIPS", output: "MITHRIL_ARROW", level: 45, xp: 112.5 },
    { tip: "ADAMANT_ARROWTIPS", output: "ADAMANT_ARROW", level: 60, xp: 150 },
    { tip: "RUNE_ARROWTIPS", output: "RUNE_ARROW", level: 75, xp: 187.5 },
    { tip: "BROAD_ARROWHEADS", output: "BROAD_ARROWS", level: 52, xp: 150 },
    { tip: "AMETHYST_ARROWTIPS", output: "AMETHYST_ARROW", level: 82, xp: 202.5 },
    { tip: "DRAGON_ARROWTIPS", output: "DRAGON_ARROW", level: 90, xp: 225 },
  ]
    .map((entry) => {
      const recipe = buildRecipe({
        key: `ammo:arrow:${entry.tip}`,
        output: entry.output,
        outputAmount: 15,
        level: entry.level,
        xp: entry.xp,
        intervalTicks: TICKS_ARROWS_AND_DARTS,
        animationId: 1248,
        requirements: [
          { item: "HEADLESS_ARROW", amount: 15, consume: true },
          { item: entry.tip, amount: 15, consume: true },
        ],
      });
      if (!recipe) {
        return null;
      }
      return [recipe.requirements[1].id, recipe];
    })
    .filter(Boolean)
);

const DART_RECIPES_BY_TIP = new Map(
  [
    { tip: "BRONZE_DART_TIP", output: "BRONZE_DART", level: 10, xp: 18 },
    { tip: "IRON_DART_TIP", output: "IRON_DART", level: 22, xp: 38 },
    { tip: "STEEL_DART_TIP", output: "STEEL_DART", level: 37, xp: 75 },
    { tip: "MITHRIL_DART_TIP", output: "MITHRIL_DART", level: 52, xp: 112 },
    { tip: "ADAMANT_DART_TIP", output: "ADAMANT_DART", level: 67, xp: 150 },
    { tip: "RUNE_DART_TIP", output: "RUNE_DART", level: 81, xp: 188 },
    { tip: "AMETHYST_DART_TIP", output: "AMETHYST_DART", level: 90, xp: 210 },
    { tip: "DRAGON_DART_TIP", output: "DRAGON_DART", level: 95, xp: 250 },
  ]
    .map((entry) => {
      const recipe = buildRecipe({
        key: `ammo:dart:${entry.tip}`,
        output: entry.output,
        outputAmount: 10,
        level: entry.level,
        xp: entry.xp,
        intervalTicks: TICKS_ARROWS_AND_DARTS,
        animationId: 1248,
        requirements: [
          { item: "FEATHER", amount: 10, consume: true },
          { item: entry.tip, amount: 10, consume: true },
        ],
      });
      if (!recipe) {
        return null;
      }
      return [recipe.requirements[1].id, recipe];
    })
    .filter(Boolean)
);

const BOLT_RECIPES_BY_UNFINISHED = new Map(
  [
    { unf: "BRONZE_BOLTS_UNF_", output: "BRONZE_BOLTS", level: 9, xp: 5 },
    { unf: "BLURITE_BOLTS_UNF_", output: "BLURITE_BOLTS", level: 24, xp: 10 },
    { unf: "IRON_BOLTS_UNF_", output: "IRON_BOLTS", level: 39, xp: 15 },
    { unf: "SILVER_BOLTS_UNF_", output: "SILVER_BOLTS", level: 43, xp: 25 },
    { unf: "STEEL_BOLTS_UNF_", output: "STEEL_BOLTS", level: 46, xp: 35 },
    { unf: "MITHRIL_BOLTS_UNF_", output: "MITHRIL_BOLTS", level: 54, xp: 50 },
    { unf: "UNFINISHED_BROAD_BOLTS", output: "BROAD_BOLTS", level: 55, xp: 30 },
    { unf: "ADAMANT_BOLTS_UNF_", output: "ADAMANT_BOLTS", level: 61, xp: 70 },
    { unf: "RUNITE_BOLTS_UNF_", output: "RUNITE_BOLTS", level: 69, xp: 100 },
    { unf: "DRAGON_BOLTS_UNF_", output: "DRAGON_BOLTS", level: 84, xp: 120 },
  ]
    .map((entry) => {
      const recipe = buildRecipe({
        key: `ammo:bolt:${entry.unf}`,
        output: entry.output,
        outputAmount: 10,
        level: entry.level,
        xp: entry.xp,
        intervalTicks: TICKS_FEATHER_BOLTS,
        animationId: 1248,
        requirements: [
          { item: "FEATHER", amount: 10, consume: true },
          { item: entry.unf, amount: 10, consume: true },
        ],
      });
      if (!recipe) {
        return null;
      }
      return [recipe.requirements[1].id, recipe];
    })
    .filter(Boolean)
);

function getFletchingLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.FLETCHING);
}

function stopFletchingSession(activeSessions, player, resetAnimation = true) {
  if (!activeSessions.has(player)) {
    return;
  }
  activeSessions.delete(player);
  if (resetAnimation) {
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

function hasRequirements(inventory, recipe) {
  for (const req of recipe.requirements) {
    if (inventory.getAmount(req.id) < req.amount) {
      return false;
    }
  }
  return true;
}

function maxCraftable(inventory, recipe) {
  let max = Number.MAX_SAFE_INTEGER;
  for (const req of recipe.requirements) {
    if (!req.consume) {
      if (inventory.getAmount(req.id) <= 0) {
        return 0;
      }
      continue;
    }
    max = Math.min(max, Math.floor(inventory.getAmount(req.id) / req.amount));
  }
  return max === Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, max);
}

function consumeRequirements(inventory, recipe) {
  for (const req of recipe.requirements) {
    if (req.consume) {
      inventory.deleteNumber(req.id, req.amount);
    }
  }
}

function performFletchingAction(player, recipe) {
  const inventory = player.getInventory();
  const level = getFletchingLevel(player);
  if (level < recipe.level) {
    player.sendMessage(`You need a Fletching level of at least ${recipe.level} to do this.`);
    return false;
  }

  if (!hasRequirements(inventory, recipe)) {
    player.sendMessage("You don't have the required materials to fletch that item.");
    return false;
  }

  consumeRequirements(inventory, recipe);
  inventory.addItem(new Item(recipe.outputId, recipe.outputAmount));
  player.performAnimation(recipe.animation);
  player.getSkillManager().addExperiences(Skill.FLETCHING, recipe.xp);

  return true;
}

function startFletchingSession(activeSessions, player, recipe, requestedAmount) {
  if (!recipe || !Number.isInteger(requestedAmount) || requestedAmount <= 0) {
    return false;
  }

  const level = getFletchingLevel(player);
  if (level < recipe.level) {
    player.sendMessage(`You need a Fletching level of at least ${recipe.level} to do this.`);
    return false;
  }

  const inventory = player.getInventory();
  const available = maxCraftable(inventory, recipe);
  if (available <= 0) {
    player.sendMessage("You don't have the required materials to fletch that item.");
    return false;
  }

  const targetAmount =
    requestedAmount === CREATION_ALL_SENTINEL
      ? available
      : Math.min(requestedAmount, available);
  if (!Number.isInteger(targetAmount) || targetAmount <= 0) {
    return false;
  }

  stopFletchingSession(activeSessions, player, false);
  activeSessions.set(player, {
    recipe,
    remaining: targetAmount,
    interval: recipe.intervalTicks,
    nextActionTick: fletchingTick + recipe.intervalTicks,
    location: player.getLocation().clone(),
  });

  player.performAnimation(recipe.animation);

  return true;
}

function sendCreationMenuForRecipes(activeSessions, player, title, recipes) {
  const validRecipes = (recipes || []).filter(Boolean);
  if (validRecipes.length <= 0) {
    return false;
  }

  stopFletchingSession(activeSessions, player, false);

  const recipeByOutput = new Map();
  for (const recipe of validRecipes) {
    recipeByOutput.set(recipe.outputId, recipe);
  }

  player.getPacketSender().sendCreationMenu(
    new CreationMenu(
      title,
      validRecipes.map((recipe) => recipe.outputId),
      {
        execute: (outputId, amount) => {
          const recipe = recipeByOutput.get(outputId);
          if (!recipe) {
            return;
          }
          startFletchingSession(activeSessions, player, recipe, amount);
        },
      }
    )
  );

  return true;
}

class FletchingTask extends Task {
  constructor(activeSessions) {
    super(1);
    this.activeSessions = activeSessions;
    this.cycle = 0;
  }

  execute() {
    this.cycle++;
    fletchingTick = this.cycle;

    for (const [player, session] of this.activeSessions) {
      if (!player || !player.isRegistered?.() || player.getHitpoints() <= 0) {
        this.activeSessions.delete(player);
        continue;
      }

      if (!player.getLocation().equals(session.location) ||
          player.getMovementQueue().size() > 0 || player.getForceMovement() != null) {
        stopFletchingSession(this.activeSessions, player);
        continue;
      }

      if (!Number.isInteger(session.remaining) || session.remaining <= 0) {
        stopFletchingSession(this.activeSessions, player, false);
        continue;
      }

      if (this.cycle < session.nextActionTick) {
        continue;
      }

      session.nextActionTick = this.cycle + session.interval;

      if (!performFletchingAction(player, session.recipe)) {
        stopFletchingSession(this.activeSessions, player);
        continue;
      }

      session.remaining--;
      if (session.remaining <= 0) {
        stopFletchingSession(this.activeSessions, player, false);
      }
    }
  }
}

function resolveKnifeOnLogsRecipe(logId) {
  return LOG_RECIPES_BY_LOG.get(logId) || null;
}

function resolveStringingRecipe(itemA, itemB) {
  const bowStringId = itemId("BOW_STRING");
  const crossbowStringId = itemId("CROSSBOW_STRING");

  const isStringPair =
    itemA === bowStringId ||
    itemB === bowStringId ||
    itemA === crossbowStringId ||
    itemB === crossbowStringId;
  if (!isStringPair) {
    return null;
  }

  const unstrungId =
    itemA === bowStringId || itemA === crossbowStringId ? itemB : itemA;
  const recipe = STRINGING_RECIPES_BY_UNSTRUNG.get(unstrungId);
  if (!recipe) {
    return null;
  }

  const requiredStringId = recipe.requirements[1].id;
  const usedStringId = unstrungId === itemA ? itemB : itemA;
  return requiredStringId === usedStringId ? recipe : null;
}

function resolveCrossbowLimbRecipe(itemA, itemB) {
  return CROSSBOW_LIMB_RECIPES_BY_COMPONENTS.get(`${itemA}:${itemB}`) || null;
}

function resolveHeadlessRecipe(itemA, itemB) {
  if (!HEADLESS_RECIPE) {
    return null;
  }
  const shaftId = itemId("ARROW_SHAFT");
  const featherId = itemId("FEATHER");
  if (
    (itemA === shaftId && itemB === featherId) ||
    (itemA === featherId && itemB === shaftId)
  ) {
    return HEADLESS_RECIPE;
  }
  return null;
}

function resolveArrowRecipe(itemA, itemB) {
  const headlessId = itemId("HEADLESS_ARROW");
  if (itemA !== headlessId && itemB !== headlessId) {
    return null;
  }
  const tipId = itemA === headlessId ? itemB : itemA;
  return ARROW_RECIPES_BY_TIP.get(tipId) || null;
}

function resolveDartRecipe(itemA, itemB) {
  const featherId = itemId("FEATHER");
  if (itemA !== featherId && itemB !== featherId) {
    return null;
  }
  const tipId = itemA === featherId ? itemB : itemA;
  return DART_RECIPES_BY_TIP.get(tipId) || null;
}

function resolveBoltRecipe(itemA, itemB) {
  const featherId = itemId("FEATHER");
  if (itemA !== featherId && itemB !== featherId) {
    return null;
  }
  const unfId = itemA === featherId ? itemB : itemA;
  return BOLT_RECIPES_BY_UNFINISHED.get(unfId) || null;
}

let TaskManager;

module.exports = {
  name: "Fletching",
  members: true,
  register(api) {
    TaskManager = api.getTaskManager();
    const activeSessions = new Map();
    TaskManager.submit(new FletchingTask(activeSessions));

    api.onPlayerDisconnect(({ player }) => {
      stopFletchingSession(activeSessions, player, false);
    });
    api.onPlayerLevelUp(({ player }) => {
      stopFletchingSession(activeSessions, player, false);
    });

    api.onItemOnItem((event) => {
      const { player, usedItemId, usedWithItemId } = event;

      const knifeId = itemId("KNIFE");
      if (usedItemId === knifeId || usedWithItemId === knifeId) {
        const logId = usedItemId === knifeId ? usedWithItemId : usedItemId;
        const recipes = resolveKnifeOnLogsRecipe(logId);
        if (!recipes) {
          return;
        }
        sendCreationMenuForRecipes(
          activeSessions,
          player,
          "What would you like to make?",
          recipes
        );
        event.handled = true;
        return;
      }

      const stringingRecipe = resolveStringingRecipe(usedItemId, usedWithItemId);
      if (stringingRecipe) {
        sendCreationMenuForRecipes(
          activeSessions,
          player,
          "How many would you like to make?",
          [stringingRecipe]
        );
        event.handled = true;
        return;
      }

      const crossbowLimbRecipe = resolveCrossbowLimbRecipe(usedItemId, usedWithItemId);
      if (crossbowLimbRecipe) {
        sendCreationMenuForRecipes(
          activeSessions,
          player,
          "How many would you like to make?",
          [crossbowLimbRecipe]
        );
        event.handled = true;
        return;
      }

      const headlessRecipe = resolveHeadlessRecipe(usedItemId, usedWithItemId);
      if (headlessRecipe) {
        sendCreationMenuForRecipes(
          activeSessions,
          player,
          "How many would you like to make?",
          [headlessRecipe]
        );
        event.handled = true;
        return;
      }

      const arrowRecipe = resolveArrowRecipe(usedItemId, usedWithItemId);
      if (arrowRecipe) {
        sendCreationMenuForRecipes(
          activeSessions,
          player,
          "How many would you like to make?",
          [arrowRecipe]
        );
        event.handled = true;
        return;
      }

      const dartRecipe = resolveDartRecipe(usedItemId, usedWithItemId);
      if (dartRecipe) {
        sendCreationMenuForRecipes(
          activeSessions,
          player,
          "How many would you like to make?",
          [dartRecipe]
        );
        event.handled = true;
        return;
      }

      const boltRecipe = resolveBoltRecipe(usedItemId, usedWithItemId);
      if (boltRecipe) {
        sendCreationMenuForRecipes(
          activeSessions,
          player,
          "How many would you like to make?",
          [boltRecipe]
        );
        event.handled = true;
      }
    }, { noted: false });

    api.log("registered", {
      logMenus: LOG_RECIPES_BY_LOG.size,
      stringables: STRINGING_RECIPES_BY_UNSTRUNG.size,
      crossbows: CROSSBOW_LIMB_RECIPE_DEFINITIONS.length,
      arrowTips: ARROW_RECIPES_BY_TIP.size,
      darts: DART_RECIPES_BY_TIP.size,
      bolts: BOLT_RECIPES_BY_UNFINISHED.size,
    });
  },
};
