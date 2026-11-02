let pluginApi;
let Skill;
let Item;
let Graphic;
let Animation;
let Location;
let TeleportHandler;
let Sound;
let Sounds;
let Equipment;
let ItemIdentifiers;
let ObjectIdentifiers;

let RUNES_BY_ALTAR_ID;
let TIARAS_BY_TALISMAN;
let TALISMANS;
let ALTAR_DESTINATIONS;
let EXIT_PORTALS;
let RIFT_RUNES;
let RUINS_BY_ID;
const RUINS_DATA = require("./data/runecrafting-ruins.json");
const OURANIA_DATA = require("./data/ourania-altar.json");
const Pouches = require("./runecrafting/Pouches.Runecrafting");
let RUINS;
/** The exit portal's sound (synth 200). */
const EXIT_PORTAL_SOUND = 200;
let ABYSS_OBSTACLES;
let PICKAXE_IDS;
let AXE_IDS;
let CRAFT_RUNES_GRAPHIC;
/** The craft graphic (spotanim runecrafting) plays at height 92 (rsprox capture 1693). */
const CRAFT_RUNES_GRAPHIC_HEIGHT = 92;
let CRAFT_RUNES_ANIMATION;
let RUNE_ESSENCE_MINE;
let OURANIA_ALTAR;
let OURANIA_RUNES;
let OURANIA_ESSENCE;
let ABYSS_INNER_RING;

const RUNE_MYSTERIES_STAGE_ATTRIBUTE = "quest.rune_mysteries.stage";
const RUNE_MYSTERIES_COMPLETE_STAGE = 6;
const ENTER_THE_ABYSS_KEY = "enter_the_abyss";
const ABYSS_LOCKED_MESSAGE = "You need to complete Enter the Abyss before you can enter the Abyss.";
const ABYSS_OBSTACLE_XP = 25;
const ABYSS_SKULL_SECONDS = 10 * 60;
/**
 * The Ourania Altar (Wiki: Ourania Altar) binds pure and daeyalt essence into a random rune each,
 * rolled out of `rolls` on its level's weights. The XP is 1.7 times the crafted rune's (1.5 times
 * that for daeyalt), and the medium Ardougne Diary adds a rune at the rune's `extraChance`, no XP.
 * Messages are captured (rsprox captures 819, 822).
 */
const OURANIA_XP_SCALE = 1.7;
const DAEYALT_XP_SCALE = 1.5;
const OURANIA_CRAFT_MESSAGE = "You bind the temple's power into runes.";
const OURANIA_DIARY_MESSAGE = "Your medium level knowledge of the local area allows you to bind additional runes.";
const OURANIA_NO_ESSENCE = "You do not have any pure or daeyalt essences to bind.";
const RIFT_GUARDIAN_BASE = 1795758;
const BLOOD_RIFT_GUARDIAN_BASE = 804984;
/** The Ourania Altar's rift guardian base, whatever rune is made (Wiki: Rift guardian). */
const OURANIA_RIFT_GUARDIAN_BASE = 1487213;
const ABYSS_TELEPORT_STEP = "o8m7y6";
const ESSENCE_TELEPORT_STEPS = new Set(["ILlRUH", "SvUvek"]);
/** The Rune Essence mine's exit portals (loc 34825, "Portal", Use). */
const ESSENCE_MINE_PORTAL = 34825;
/** Where the player stood when a wizard teleported them into the mine: the portals return there. */
const ESSENCE_MINE_RETURN_ATTRIBUTE = "runecrafting:essence-mine-return";
/** Set for the tick between stepping into a portal and the teleport, so a second click waits. */
const ESSENCE_MINE_LEAVING_ATTRIBUTE = "runecrafting:essence-mine-leaving";
/** Without a recorded wizard, back beside Aubury (a captured landing tile). */
const ESSENCE_MINE_DEFAULT_RETURN = Object.freeze([3252, 3400, 0]);
/** The Curse the portal casts on the player: projectile 109, graphic 110 (rsprox captures). */
const ESSENCE_PORTAL_PROJECTILE = 109;
const ESSENCE_PORTAL_IMPACT = 110;
/**
 * A wizard's teleport into the mine is the same Curse, cast by the wizard (rsprox captures 1628,
 * 2280): the overhead line, graphic 108 on the wizard, the projectile from 61 to 100 cycles, 110 on
 * the player after 100 cycles, area sounds 127 and 126, and the landing four ticks later.
 */
const ESSENCE_TELEPORT_LINE = "Senventior Disthine Molenko!";
const CURSE_CASTING = 108;
const CURSE_SOUND_CAST = 127;
const CURSE_SOUND_IMPACT = 126;
const ESSENCE_TELEPORT_TICKS = 4;
/**
 * The player's delayed move in progress (a wizard's Curse, a talisman held to the ruins), so a
 * second click waits and a death can cancel it. Not saved.
 */
const TRAVEL_ATTRIBUTE = "runecrafting:travel";
/** Holding a talisman to the ruins (rsprox captures): human_pickupfloor a tick after the click, the teleport two after that. */
const HOLD_TALISMAN_ANIMATION = 827;
const HOLD_TALISMAN_TICKS = 2;
/** Tiaras bound at their altar: the talisman's rune names the altar (Wiki: Tiara, XP per tiara). */
const TIARA_XP = new Map([
  ["Air", 25], ["Mind", 27.5], ["Water", 30], ["Earth", 32.5], ["Fire", 35], ["Body", 37.5], ["Cosmic", 40],
  ["Chaos", 42.5], ["Nature", 45], ["Law", 47.5], ["Death", 50], ["Blood", 52.5], ["Wrath", 52.5],
]);

const RUNE_ESSENCE_TELEPORT_NPCS = [
  "Aubury",
  "Archmage Sedridor",
  "Wizard Distentor",
  "Brimstail",
  "Wizard Cromperty",
  "Wizard Jalarast",
];

const RIFT_OBJECT_NAMES = [
  "Air rift",
  "Mind rift",
  "Water rift",
  "Earth rift",
  "Fire rift",
  "Body rift",
  "Cosmic rift",
  "Chaos rift",
  "Nature rift",
  "Law rift",
  "Death rift",
  "Blood rift",
];

function initialize(api) {
  pluginApi = api;
  ({
    Skill,
    Item,
    Graphic,
    Animation,
    Location,
    TeleportHandler,
    Sound,
    Sounds,
    Equipment,
    ItemIdentifiers,
    ObjectIdentifiers,
  } = api.core);

  CRAFT_RUNES_GRAPHIC = new Graphic(186, 0, CRAFT_RUNES_GRAPHIC_HEIGHT);
  CRAFT_RUNES_ANIMATION = new Animation(791);
  RUNE_ESSENCE_MINE = new Location(2913, 4832, 0);
  ABYSS_INNER_RING = new Location(3040, 4839, 0);
  // rc_zmi_dungeon_cracked_center_altar.
  OURANIA_ALTAR = ObjectIdentifiers.ALTAR_31;
  OURANIA_RUNES = OURANIA_DATA.runes.map((rune) => ({ ...rune, runeId: ItemIdentifiers[rune.rune] }));
  OURANIA_ESSENCE = [
    { id: ItemIdentifiers.PURE_ESSENCE, xpScale: OURANIA_XP_SCALE },
    { id: ItemIdentifiers.DAEYALT_ESSENCE, xpScale: OURANIA_XP_SCALE * DAEYALT_XP_SCALE },
  ];

  PICKAXE_IDS = [
    ItemIdentifiers.BRONZE_PICKAXE,
    ItemIdentifiers.IRON_PICKAXE,
    ItemIdentifiers.STEEL_PICKAXE,
    ItemIdentifiers.BLACK_PICKAXE,
    ItemIdentifiers.MITHRIL_PICKAXE,
    ItemIdentifiers.ADAMANT_PICKAXE,
    ItemIdentifiers.RUNE_PICKAXE,
    ItemIdentifiers.DRAGON_PICKAXE,
  ];
  AXE_IDS = [
    ItemIdentifiers.BRONZE_AXE,
    ItemIdentifiers.IRON_AXE,
    ItemIdentifiers.STEEL_AXE,
    ItemIdentifiers.BLACK_AXE,
    ItemIdentifiers.MITHRIL_AXE,
    ItemIdentifiers.ADAMANT_AXE,
    ItemIdentifiers.RUNE_AXE,
    ItemIdentifiers.DRAGON_AXE,
  ];

  // What each altar binds. Wiki (Runecraft): clicking an altar converts all the essence in the
  // inventory, so rune and pure essence go together where both work.
  const ANY_ESSENCE = { ids: [ItemIdentifiers.RUNE_ESSENCE, ItemIdentifiers.PURE_ESSENCE], missing: "You don't have any essence in your inventory." };
  const PURE_ESSENCE_ONLY = { ids: [ItemIdentifiers.PURE_ESSENCE], missing: "You do not have any pure essences to bind.", mesbox: true };
  // Kourend's Blood Altar binds dark essence fragments, never pure essence (Wiki: Blood Altar (Kourend)).
  const DARK_ESSENCE = { ids: [ItemIdentifiers.DARK_ESSENCE_FRAGMENTS], missing: "You have nothing suitable to bind.", mesbox: true };

  RUNES_BY_ALTAR_ID = new Map([
    [ObjectIdentifiers.ALTAR_33, { runeId: ItemIdentifiers.AIR_RUNE, level: 1, xp: 5, essence: ANY_ESSENCE, multiplier: [[11, 2], [22, 3], [33, 4], [44, 5], [55, 6], [66, 7], [77, 8], [88, 9], [99, 10]] }],
    [ObjectIdentifiers.ALTAR_34, { runeId: ItemIdentifiers.MIND_RUNE, level: 2, xp: 5.5, essence: ANY_ESSENCE, multiplier: [[14, 2], [28, 3], [42, 4], [56, 5], [70, 6], [84, 7], [98, 8]] }],
    [ObjectIdentifiers.ALTAR_35, { runeId: ItemIdentifiers.WATER_RUNE, level: 5, xp: 6, essence: ANY_ESSENCE, multiplier: [[19, 2], [38, 3], [57, 4], [76, 5], [95, 6]] }],
    [ObjectIdentifiers.ALTAR_36, { runeId: ItemIdentifiers.EARTH_RUNE, level: 9, xp: 6.5, essence: ANY_ESSENCE, multiplier: [[26, 2], [52, 3], [78, 4]] }],
    [ObjectIdentifiers.ALTAR_37, { runeId: ItemIdentifiers.FIRE_RUNE, level: 14, xp: 7, essence: ANY_ESSENCE, multiplier: [[35, 2], [70, 3]] }],
    [ObjectIdentifiers.ALTAR_38, { runeId: ItemIdentifiers.BODY_RUNE, level: 20, xp: 7.5, essence: ANY_ESSENCE, multiplier: [[46, 2], [92, 3]] }],
    [ObjectIdentifiers.ALTAR_39, { runeId: ItemIdentifiers.COSMIC_RUNE, level: 27, xp: 8, essence: PURE_ESSENCE_ONLY, multiplier: [[59, 2]] }],
    [ObjectIdentifiers.ALTAR_55, { runeId: ItemIdentifiers.CHAOS_RUNE, level: 35, xp: 8.5, essence: PURE_ESSENCE_ONLY, multiplier: [[74, 2]] }],
    [ObjectIdentifiers.ALTAR_57, { runeId: ItemIdentifiers.ASTRAL_RUNE, level: 40, xp: 8.7, essence: PURE_ESSENCE_ONLY, multiplier: [[82, 2]] }],
    [ObjectIdentifiers.ALTAR_46, { runeId: ItemIdentifiers.NATURE_RUNE, level: 44, xp: 9, essence: PURE_ESSENCE_ONLY, multiplier: [[91, 2]] }],
    [ObjectIdentifiers.ALTAR_40, { runeId: ItemIdentifiers.LAW_RUNE, level: 54, xp: 9.5, essence: PURE_ESSENCE_ONLY, multiplier: [[95, 2]] }],
    [ObjectIdentifiers.ALTAR_56, { runeId: ItemIdentifiers.DEATH_RUNE, level: 65, xp: 10, essence: PURE_ESSENCE_ONLY, multiplier: [[99, 2]] }],
    // Wiki: 95 Runecraft, 8 XP an essence, no multiples.
    [ObjectIdentifiers.ALTAR_58, { runeId: ItemIdentifiers.WRATH_RUNE, level: 95, xp: 8, essence: PURE_ESSENCE_ONLY, multiplier: [] }],
    // Wiki: 77 Runecraft, 23.8 XP and one blood rune a fragment.
    [ObjectIdentifiers.BLOOD_ALTAR, { runeId: ItemIdentifiers.BLOOD_RUNE, level: 77, xp: 23.8, essence: DARK_ESSENCE, multiplier: [] }],
  ]);
  // The true Blood Altar binds pure essence (Wiki: 77 Runecraft, 10.5 XP an essence).
  RUNES_BY_ALTAR_ID.set(ObjectIdentifiers.ALTAR_83, { runeId: ItemIdentifiers.BLOOD_RUNE, level: 77, xp: 10.5, essence: PURE_ESSENCE_ONLY, multiplier: [] });

  TALISMANS = new Map([
    [ItemIdentifiers.AIR_TALISMAN, { name: "Air talisman", runeId: ItemIdentifiers.AIR_RUNE, x: 2841, y: 4829, ruinX: 2983, ruinY: 3288 }],
    [ItemIdentifiers.MIND_TALISMAN, { name: "Mind talisman", runeId: ItemIdentifiers.MIND_RUNE, x: 2793, y: 4828, ruinX: 2980, ruinY: 3511 }],
    [ItemIdentifiers.WATER_TALISMAN, { name: "Water talisman", runeId: ItemIdentifiers.WATER_RUNE, x: 2720, y: 4831, ruinX: 3182, ruinY: 3162 }],
    [ItemIdentifiers.EARTH_TALISMAN, { name: "Earth talisman", runeId: ItemIdentifiers.EARTH_RUNE, x: 2655, y: 4830, ruinX: 3302, ruinY: 3477 }],
    [ItemIdentifiers.FIRE_TALISMAN, { name: "Fire talisman", runeId: ItemIdentifiers.FIRE_RUNE, x: 2576, y: 4846, ruinX: 3310, ruinY: 3252 }],
    [ItemIdentifiers.BODY_TALISMAN, { name: "Body talisman", runeId: ItemIdentifiers.BODY_RUNE, x: 2522, y: 4833, ruinX: 3050, ruinY: 3442 }],
    [ItemIdentifiers.COSMIC_TALISMAN, { name: "Cosmic talisman", runeId: ItemIdentifiers.COSMIC_RUNE, x: 2162, y: 4833, ruinX: 2405, ruinY: 4381 }],
    [ItemIdentifiers.CHAOS_TALISMAN, { name: "Chaos talisman", runeId: ItemIdentifiers.CHAOS_RUNE, x: 2281, y: 4837, ruinX: 3060, ruinY: 3585 }],
    [ItemIdentifiers.NATURE_TALISMAN, { name: "Nature talisman", runeId: ItemIdentifiers.NATURE_RUNE, x: 2400, y: 4835, ruinX: 2865, ruinY: 3022 }],
    [ItemIdentifiers.LAW_TALISMAN, { name: "Law talisman", runeId: ItemIdentifiers.LAW_RUNE, x: 2464, y: 4818, ruinX: 2858, ruinY: 3378 }],
    [ItemIdentifiers.DEATH_TALISMAN, { name: "Death talisman", runeId: ItemIdentifiers.DEATH_RUNE, x: 2208, y: 4830, ruinX: 1863, ruinY: 4639 }],
    // The ruins say "Blood Talisman" when it's held to them (rsprox captures 1636, 1840, 1850); the
    // altar's exit portal leads to (3559, 9780), beside the ruins under Mort'ton (rsprox capture 1636).
    [ItemIdentifiers.BLOOD_TALISMAN, { name: "Blood talisman", holdName: "Blood Talisman", runeId: ItemIdentifiers.BLOOD_RUNE, x: 1722, y: 3826, ruinX: 3559, ruinY: 9780, locateMessage: "The talisman doesn't seem to work. Maybe the ruins are deep underground." }],
  ]);

  // Ruins are unnamed base locs; the cache supplies their named variants and tiara varbits.
  RUINS_BY_ID = new Map();
  RUINS = RUINS_DATA.map((ruins) => {
    const definition = api.core.CacheDefinitions.getObject(ruins.ruinsId);
    const talisman = TALISMANS.get(ruins.talismanId);
    return { ...ruins, varbit: definition.transformVarbit, destination: ruins.destination ?? [talisman.x, talisman.y, 0] };
  });
  for (const ruins of RUINS) {
    const definition = api.core.CacheDefinitions.getObject(ruins.ruinsId);
    for (const id of [ruins.ruinsId, ...definition.transforms]) {
      if (id !== -1) RUINS_BY_ID.set(id, ruins);
    }
  }

  TIARAS_BY_TALISMAN = new Map(RUINS_DATA.map((ruins) => [ruins.talismanId, {
    tiaraId: ruins.tiaraId,
    runeId: TALISMANS.get(ruins.talismanId)?.runeId ?? ItemIdentifiers.WRATH_RUNE,
    xp: TIARA_XP.get(ruins.name),
  }]));

  ALTAR_DESTINATIONS = new Map(
    [...TALISMANS.values()].map((talisman) => [
      talisman.runeId,
      { x: talisman.x, y: talisman.y },
    ])
  );

  // Each altar's exit portal leads back outside its ruins (ruinX, ruinY), as rsprox captures show
  // for the earth, fire, water, nature and cosmic altars.
  EXIT_PORTALS = new Map([
    [ObjectIdentifiers.PORTAL_39, ItemIdentifiers.AIR_TALISMAN],
    [ObjectIdentifiers.PORTAL_40, ItemIdentifiers.MIND_TALISMAN],
    [ObjectIdentifiers.PORTAL_41, ItemIdentifiers.WATER_TALISMAN],
    [ObjectIdentifiers.PORTAL_42, ItemIdentifiers.EARTH_TALISMAN],
    [ObjectIdentifiers.PORTAL_43, ItemIdentifiers.FIRE_TALISMAN],
    [ObjectIdentifiers.PORTAL_44, ItemIdentifiers.BODY_TALISMAN],
    [ObjectIdentifiers.PORTAL_45, ItemIdentifiers.COSMIC_TALISMAN],
    [ObjectIdentifiers.PORTAL_46, ItemIdentifiers.LAW_TALISMAN],
    [ObjectIdentifiers.PORTAL_47, ItemIdentifiers.NATURE_TALISMAN],
    [ObjectIdentifiers.PORTAL_48, ItemIdentifiers.CHAOS_TALISMAN],
    [ObjectIdentifiers.PORTAL_49, ItemIdentifiers.DEATH_TALISMAN],
    [ObjectIdentifiers.PORTAL_100, ItemIdentifiers.BLOOD_TALISMAN],
  ].map(([portal, talisman]) => [portal, TALISMANS.get(talisman)]));

  RIFT_RUNES = new Map([
    [ObjectIdentifiers.AIR_RIFT, ItemIdentifiers.AIR_RUNE],
    [ObjectIdentifiers.MIND_RIFT, ItemIdentifiers.MIND_RUNE],
    [ObjectIdentifiers.WATER_RIFT, ItemIdentifiers.WATER_RUNE],
    [ObjectIdentifiers.EARTH_RIFT, ItemIdentifiers.EARTH_RUNE],
    [ObjectIdentifiers.FIRE_RIFT, ItemIdentifiers.FIRE_RUNE],
    [ObjectIdentifiers.BODY_RIFT, ItemIdentifiers.BODY_RUNE],
    [ObjectIdentifiers.COSMIC_RIFT, ItemIdentifiers.COSMIC_RUNE],
    [ObjectIdentifiers.CHAOS_RIFT, ItemIdentifiers.CHAOS_RUNE],
    [ObjectIdentifiers.NATURE_RIFT, ItemIdentifiers.NATURE_RUNE],
    [ObjectIdentifiers.LAW_RIFT, ItemIdentifiers.LAW_RUNE],
    [ObjectIdentifiers.DEATH_RIFT, ItemIdentifiers.DEATH_RUNE],
    [ObjectIdentifiers.BLOOD_RIFT, ItemIdentifiers.BLOOD_RUNE],
    [ObjectIdentifiers.BLOOD_RIFT_2, ItemIdentifiers.BLOOD_RUNE],
  ]);

  ABYSS_OBSTACLES = new Map([
    [ObjectIdentifiers.ROCK_111, { objectName: "Rock", action: "Mine", skill: Skill.MINING, toolIds: PICKAXE_IDS, toolMessage: "You need a pickaxe to mine through the rock.", fail: "You fail to mine through the rock." }],
    [ObjectIdentifiers.TENDRILS_4, { objectName: "Tendrils", action: "Chop", skill: Skill.WOODCUTTING, toolIds: AXE_IDS, toolMessage: "You need an axe to chop through the tendrils.", fail: "You fail to chop through the tendrils." }],
    [ObjectIdentifiers.BOIL, { objectName: "Boil", action: "Burn-down", skill: Skill.FIREMAKING, toolIds: [ItemIdentifiers.TINDERBOX], toolMessage: "You need a tinderbox to burn through the boil.", fail: "You fail to burn through the boil." }],
    [ObjectIdentifiers.EYES, { objectName: "Eyes", action: "Distract", skill: Skill.THIEVING, toolIds: null, toolMessage: null, fail: "You fail to distract the eyes." }],
    [ObjectIdentifiers.GAP_42, { objectName: "Gap", action: "Squeeze-through", skill: Skill.AGILITY, toolIds: null, toolMessage: null, fail: "You fail to squeeze through the gap." }],
    [ObjectIdentifiers.PASSAGE_4, { objectName: "Passage", action: "Go-through", skill: null, toolIds: null, toolMessage: null, fail: null }],
  ]);
}

function runeMultiplier(level, runeData) {
  let amount = 1;
  for (const [requiredLevel, multiplier] of runeData.multiplier) {
    if (level >= requiredLevel) {
      amount = multiplier;
    }
  }
  return amount;
}

function hasTool(player, itemIds) {
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
  if (weapon && itemIds.includes(weapon.getId())) {
    return true;
  }
  return itemIds.some((itemId) => player.getInventory().contains(itemId));
}

function hasCompletedRuneMysteries(player) {
  const stage = Number(player.getAttribute(RUNE_MYSTERIES_STAGE_ATTRIBUTE));
  return Number.isFinite(stage) && stage >= RUNE_MYSTERIES_COMPLETE_STAGE;
}

/** The Mage of Zamorak only shares the Abyss after Enter the Abyss (Wiki). */
function hasCompletedEnterTheAbyss(player) {
  const request = { player, key: ENTER_THE_ABYSS_KEY, complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function requestTeleport(player, destination) {
  pluginApi.emitCustomEvent("lever:teleport", { player, destination: destination.clone() });
}

function ouraniaWeights(level) {
  let weights = OURANIA_DATA.levels[0].weights;
  for (const bracket of OURANIA_DATA.levels) {
    if (level >= bracket.level) weights = bracket.weights;
  }
  return weights;
}

function rollOuraniaRune(weights) {
  let roll = Math.floor(Math.random() * OURANIA_DATA.rolls);
  for (let index = 0; index < weights.length; index++) {
    roll -= weights[index];
    if (roll < 0) return OURANIA_RUNES[index];
  }
  return OURANIA_RUNES[OURANIA_RUNES.length - 1];
}

function ardougneMediumComplete(player) {
  const request = { player, diary: "ardougne", tier: "medium", complete: false };
  pluginApi.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/** Every pure and daeyalt essence becomes a rune rolled at the player's level (Wiki: Ourania Altar). */
function craftOurania(player) {
  const inventory = player.getInventory();
  if (!OURANIA_ESSENCE.some((essence) => inventory.contains(essence.id))) {
    const { DialogueChainBuilder, StatementDialogue } = pluginApi.core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, OURANIA_NO_ESSENCE)));
    return;
  }

  const weights = ouraniaWeights(player.getSkillManager().getCurrentLevel(Skill.RUNECRAFTING));
  const diary = ardougneMediumComplete(player);
  /** The essence each rune was crafted from, for the rift guardian's rolls. */
  const crafted = new Map();
  let xp = 0;
  for (const essence of OURANIA_ESSENCE) {
    while (inventory.contains(essence.id)) {
      inventory.deleteNumber(essence.id, 1);
      const rune = rollOuraniaRune(weights);
      const amount = diary && Math.random() * 100 < rune.extraChance ? 2 : 1;
      inventory.addItem(new Item(rune.runeId, amount));
      xp += rune.xp * essence.xpScale;
      crafted.set(rune, (crafted.get(rune) ?? 0) + 1);
    }
  }

  player.performGraphic(CRAFT_RUNES_GRAPHIC);
  player.performAnimation(CRAFT_RUNES_ANIMATION);
  Sounds.sendSound(player, Sound.CRAFT_RUNES);
  spam(player, OURANIA_CRAFT_MESSAGE);
  if (diary) spam(player, OURANIA_DIARY_MESSAGE);
  player.getSkillManager().addExperiences(Skill.RUNECRAFTING, xp);
  // The rift guardian rolls per essence at the altar's own base; each rune is reported for its colour.
  for (const [rune, essence] of crafted) {
    pluginApi.emitCustomEvent("runecrafting:success", {
      player,
      skill: Skill.RUNECRAFTING,
      petBase: OURANIA_RIFT_GUARDIAN_BASE,
      rolls: essence,
      runeId: rune.runeId,
      amountPerEssence: 1,
    });
  }
}

function handleCraftRunes(event) {
  if (event.objectId === OURANIA_ALTAR) {
    craftOurania(event.player);
    event.handled = true;
    return true;
  }
  const runeData = RUNES_BY_ALTAR_ID.get(event.objectId);
  if (!runeData) {
    return false;
  }

  const player = event.player;
  const level = player.getSkillManager().getCurrentLevel(Skill.RUNECRAFTING);
  if (level < runeData.level) {
    player.sendMessage(
      `You need a Runecrafting level of at least ${runeData.level} to craft this.`
    );
    event.handled = true;
    return true;
  }

  const { essence } = runeData;
  if (!essence.ids.some((essenceId) => player.getInventory().contains(essenceId))) {
    // The true Blood Altar's and Kourend's refusals are message boxes (rsprox captures 1636, 1673).
    if (essence.mesbox) {
      const { DialogueChainBuilder, StatementDialogue } = pluginApi.core;
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, essence.missing)));
    } else {
      player.sendMessage(essence.missing);
    }
    event.handled = true;
    return true;
  }

  const amountPerEssence = runeMultiplier(level, runeData);
  let craftedEssence = 0;
  for (const essenceId of essence.ids) {
    while (player.getInventory().contains(essenceId)) {
      player.getInventory().deleteNumber(essenceId, 1);
      player.getInventory().addItem(new Item(runeData.runeId, amountPerEssence));
      craftedEssence++;
    }
  }

  if (craftedEssence > 0) {
    player.performGraphic(CRAFT_RUNES_GRAPHIC);
    player.performAnimation(CRAFT_RUNES_ANIMATION);
    Sounds.sendSound(player, Sound.CRAFT_RUNES);
    player
      .getSkillManager()
      .addExperiences(Skill.RUNECRAFTING, craftedEssence * runeData.xp);
    // The rift guardian rolls per essence (Wiki).
    pluginApi.emitCustomEvent("runecrafting:success", {
      player,
      skill: Skill.RUNECRAFTING,
      petBase: runeData.runeId === ItemIdentifiers.BLOOD_RUNE ? BLOOD_RIFT_GUARDIAN_BASE : RIFT_GUARDIAN_BASE,
      rolls: craftedEssence,
      runeId: runeData.runeId,
      amountPerEssence,
    });
  }

  event.handled = true;
  return true;
}

/**
 * "runecrafting:altar-rune" { player, objectId, rune }: what an altar crafts, for content that
 * crafts its own essence there (Guardians of the Rift): { runeId, level, xp, amount, petBase } with
 * `amount` the runes an essence makes at the player's level, or null.
 */
function answerAltarRune(request) {
  const runeData = RUNES_BY_ALTAR_ID.get(request?.objectId);
  if (!runeData || !request.player) return;
  const level = request.player.getSkillManager().getCurrentLevel(Skill.RUNECRAFTING);
  request.rune = {
    runeId: runeData.runeId, level: runeData.level, xp: runeData.xp, amount: runeMultiplier(level, runeData),
    petBase: runeData.runeId === ItemIdentifiers.BLOOD_RUNE ? BLOOD_RIFT_GUARDIAN_BASE : RIFT_GUARDIAN_BASE,
  };
}

function locateDirection(player, ruinX, ruinY) {
  const dx = ruinX - player.getLocation().getX();
  const dy = ruinY - player.getLocation().getY();
  if (dx === 0 && dy === 0) {
    return null;
  }
  const northSouth = dy > 0 ? "North" : dy < 0 ? "South" : "";
  const eastWest = dx > 0 ? "East" : dx < 0 ? "West" : "";
  return [northSouth, eastWest].filter(Boolean).join("-");
}

function handleTalismanLocate(event) {
  const talisman = TALISMANS.get(event.itemId);
  if (!talisman) {
    return false;
  }

  const player = event.player;
  if (talisman.locateMessage) {
    player.sendMessage(talisman.locateMessage);
    return true;
  }

  const direction = locateDirection(player, talisman.ruinX, talisman.ruinY);
  player.sendMessage(
    direction
      ? `The talisman pulls to the ${direction}.`
      : "The talisman is having trouble pin-pointing the location."
  );
  return true;
}

function matchesRuins(ruins, itemId, tiara) {
  const specific = tiara ? ruins.tiaraId : ruins.talismanId;
  const shared = ruins.elemental
    ? tiara ? ItemIdentifiers.ELEMENTAL_TIARA : ItemIdentifiers.ELEMENTAL_TALISMAN
    : tiara ? ItemIdentifiers.CATALYTIC_TIARA : ItemIdentifiers.CATALYTIC_TALISMAN;
  return itemId === specific || itemId === shared;
}

/** Wiki: a worn Runecraft cape (or a max cape) enters every altar without a talisman or tiara;
 * the ruins' varbits (rc_no_tally_required_*) all switch on, as for a tiara (rsprox captures). */
function wearsRunecraftCape(player) {
  const request = { player, skill: "RUNECRAFTING", result: false };
  pluginApi.emitCustomEvent("skillcape:has-perk", request);
  return request.result === true;
}

function syncTiaraOptions({ player }) {
  const headId = player.getEquipment().getItems()[Equipment.HEAD_SLOT]?.getId();
  const sender = player.getPacketSender();
  const cape = wearsRunecraftCape(player);
  for (const ruins of RUINS) {
    const enabled = cape || matchesRuins(ruins, headId, true) ? 1 : 0;
    if (sender.getVarbit(ruins.varbit) !== enabled) sender.sendVarbit(ruins.varbit, enabled);
  }
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(pluginApi.core.ChatType.SPAM, text);
}

/** With a tiara (or the cape) the ruins take the player at once (rsprox captures 1549, 1632, 1636). */
function enterRuins(player, ruins) {
  player.moveTo(new Location(...ruins.destination));
  player.getPacketSender().sendSound(EXIT_PORTAL_SOUND, 1, 0);
  spam(player, "You feel a powerful force take hold of you...");
}

/**
 * A talisman held to the ruins (rsprox captures 1636, 1757, 1840, 1850): a tick after the click
 * human_pickupfloor, the portal sound, the hold line and varbit busy; two ticks later the teleport.
 */
function handleTalismanOnRuins(event) {
  const ruins = event.handled ? undefined : RUINS_BY_ID.get(event.objectId);
  if (!ruins || !matchesRuins(ruins, event.itemId, false)) return;
  event.handled = true;
  const { player, itemId } = event;
  if (player.getAttribute(TRAVEL_ATTRIBUTE)) return;
  const name = TALISMANS.get(itemId)?.holdName ?? pluginApi.core.CacheDefinitions.getItem(itemId)?.name ?? "talisman";
  const busy = pluginApi.core.CacheDefinitions.getVarbitId("busy");
  let held = false;
  travel(player, 1 + HOLD_TALISMAN_TICKS, new Location(...ruins.destination), {
    1: () => {
      held = true;
      player.performAnimation(new Animation(HOLD_TALISMAN_ANIMATION));
      player.getPacketSender().sendSound(EXIT_PORTAL_SOUND, 1, 0);
      spam(player, `You hold the ${name} towards the mysterious ruins.<br>You feel a powerful force take hold of you...`);
      player.getPacketSender().sendVarbit(busy, 1);
    },
  }, () => {
    if (held) player.getPacketSender().sendVarbit(busy, 0);
  });
}

/**
 * A talisman (or the tiara) used on its own altar with both in the inventory binds the tiara
 * (Wiki: Tiara; rsprox capture 1636: the line on the click, as spam, with no animation).
 */
function handleBindTiara(event) {
  const runeData = event.handled ? undefined : RUNES_BY_ALTAR_ID.get(event.objectId);
  // Kourend's Blood Altar binds dark essence, not tiaras; the blood tiara is the true Blood Altar's.
  if (!runeData || runeData.essence.ids.includes(ItemIdentifiers.DARK_ESSENCE_FRAGMENTS)) return;
  const { player } = event;
  const inventory = player.getInventory();
  const talismanId = event.itemId === ItemIdentifiers.TIARA
    ? [...TIARAS_BY_TALISMAN.keys()].find((id) => TIARAS_BY_TALISMAN.get(id).runeId === runeData.runeId && inventory.contains(id))
    : event.itemId;
  const tiara = TIARAS_BY_TALISMAN.get(talismanId);
  if (!tiara || tiara.runeId !== runeData.runeId || !inventory.contains(ItemIdentifiers.TIARA) || !inventory.contains(talismanId)) return;
  event.handled = true;
  inventory.delete(talismanId, 1);
  inventory.delete(ItemIdentifiers.TIARA, 1);
  inventory.addItem(new Item(tiara.tiaraId, 1));
  player.getSkillManager().addExperiences(Skill.RUNECRAFTING, tiara.xp);
  spam(player, "You bind the power of the talisman into your Tiara.");
}

function handleEnterRuins({ player, objectId }) {
  const ruins = RUINS_BY_ID.get(objectId);
  if (!ruins) return false;
  const headId = player.getEquipment().getItems()[Equipment.HEAD_SLOT]?.getId();
  if (!matchesRuins(ruins, headId, true) && !wearsRunecraftCape(player)) return false;
  enterRuins(player, ruins);
  return true;
}

function handleRuneEssenceTeleport(event) {
  const player = event.player;
  if (!hasCompletedRuneMysteries(player)) {
    player.sendMessage("You need to complete Rune Mysteries before using this teleport.");
    return true;
  }
  teleportToEssenceMine(player, event.npc);
  return true;
}

/**
 * Into the mine on the wizard's Curse, remembering where the player stood so the portals can send
 * them back.
 */
function teleportToEssenceMine(player, wizard) {
  if (player.getAttribute(TRAVEL_ATTRIBUTE)) return;
  if (!TeleportHandler.checkReqs(player, RUNE_ESSENCE_MINE, Infinity)) return;
  const at = player.getLocation();
  player.setAttribute(ESSENCE_MINE_RETURN_ATTRIBUTE, [at.getX(), at.getY(), at.getZ()]);
  player.getPacketSender().sendInterfaceRemoval();
  travel(player, ESSENCE_TELEPORT_TICKS, RUNE_ESSENCE_MINE.clone(), {
    [ESSENCE_TELEPORT_TICKS]: () => {
      if (wizard?.getCurrentDefinition?.(player)?.getName() === "Archmage Sedridor") {
        pluginApi.emitCustomEvent("diary:task", { player, diary: "lumbridge", task: "have-sedridor-teleport-you-to-the-essence-mine" });
      }
    },
  });
  if (wizard) {
    wizard.forceChat?.(ESSENCE_TELEPORT_LINE);
    wizard.setPositionToFace?.(at);
    wizard.performGraphic?.(new Graphic(CURSE_CASTING, 0, 92));
    player.getPacketSender().sendProjectile(wizard.getLocation(), at, 0, 100, ESSENCE_PORTAL_PROJECTILE, 31, 31, player, 61, 16, 128);
  }
  player.performGraphic(new Graphic(ESSENCE_PORTAL_IMPACT, 100, 124));
  player.getPacketSender()
    .sendAreaSound(CURSE_SOUND_CAST, at.getX(), at.getY(), at.getZ())
    .sendAreaSound(CURSE_SOUND_IMPACT, at.getX(), at.getY(), at.getZ());
}

/**
 * Moves the player to `destination` after `ticks`, running `steps[n]` on tick n first, held as
 * the core's teleports hold them (TeleportHandler): movement blocked, untargetable and
 * teleporting until the landing. The landing emits "teleport:landed" with where the travel began,
 * as the core's teleports do. A death (dying, or the respawn's onPlayerDeath), a logout or a later
 * travel cancels it; `onRelease` runs whenever the hold ends, landed or not. A death leaves the
 * movement and targeting holds to the death sequence, which resets them on respawn.
 */
function travel(player, ticks, destination, steps = {}, onRelease = undefined) {
  const { Task } = pluginApi.core;
  const token = { from: player.getLocation?.()?.clone?.() ?? null, fromInstance: player.getPrivateArea?.() != null, onRelease };
  player.setAttribute(TRAVEL_ATTRIBUTE, token);
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement(true);
  player.setUntargetable?.(true);
  player.setTeleporting?.(true);
  let tick = 0;
  pluginApi.getTaskManager().submit(new (class extends Task {
    constructor() {
      super(1, player, false);
    }
    execute() {
      if (player.getAttribute(TRAVEL_ATTRIBUTE) !== token || player.isRegistered?.() === false) {
        this.stop();
        return;
      }
      if (player.isDyingReturn?.() || player.getHitpoints?.() <= 0) {
        releaseTravel(player, token, false);
        this.stop();
        return;
      }
      tick++;
      steps[tick]?.();
      if (tick < ticks) return;
      releaseTravel(player, token);
      player.moveTo(destination);
      pluginApi.emitCustomEvent("teleport:landed", { player, from: token.from, fromInstance: token.fromInstance, to: destination });
      this.stop();
    }
    stop() {
      releaseTravel(player, token);
      super.stop();
    }
  })());
}

/**
 * Ends a travel's hold, once, and only while it is still the player's current one; `restore`
 * false (a death) leaves movement and targeting to the death sequence.
 */
function releaseTravel(player, token, restore = true) {
  if (player.getAttribute(TRAVEL_ATTRIBUTE) !== token) return;
  player.setAttribute(TRAVEL_ATTRIBUTE, null);
  player.setTeleporting?.(false);
  if (restore) {
    player.getMovementQueue().setBlockMovement(false);
    player.setUntargetable?.(false);
  }
  token.onRelease?.();
}

/** A death cancels a travel in progress: the respawned player stays where they respawn. */
function cancelTravelOnDeath({ player }) {
  const token = player?.getAttribute?.(TRAVEL_ATTRIBUTE);
  if (token) releaseTravel(player, token, false);
}

/**
 * A mine portal sends the player back to the wizard who teleported them in (Wiki: Rune
 * Essence mine). As rsprox captures (rev 226-228) show it: on arrival "You step through the
 * portal..." with the portal casting Curse at the player (projectile 109 over 30 cycles,
 * graphic 110 after 30 cycles at height 124), then a tick later the teleport, with sound 200.
 */
function handleEssenceMinePortal(event) {
  const { player, location } = event;
  if (player.getAttribute(ESSENCE_MINE_LEAVING_ATTRIBUTE)) return true;
  const saved = player.getAttribute(ESSENCE_MINE_RETURN_ATTRIBUTE);
  const [x, y, z] = Array.isArray(saved) && saved.length === 3 ? saved : ESSENCE_MINE_DEFAULT_RETURN;
  const here = player.getLocation();
  spam(player, "You step through the portal...");
  player.getPacketSender().sendProjectile(
    new Location(location.x, location.y, location.z), here, 0, 30, ESSENCE_PORTAL_PROJECTILE, 15, 31, player, 0, 16, 128
  );
  player.performGraphic(new Graphic(ESSENCE_PORTAL_IMPACT, 30, 124));
  player.getMovementQueue().reset();
  player.setAttribute(ESSENCE_MINE_LEAVING_ATTRIBUTE, true);
  afterTicks(1, () => {
    player.setAttribute(ESSENCE_MINE_LEAVING_ATTRIBUTE, null);
    player.moveTo(new Location(x, y, z));
    player.getPacketSender().sendSound(EXIT_PORTAL_SOUND, 1, 0);
  });
  return true;
}

function afterTicks(ticks, action) {
  const { Task } = pluginApi.core;
  pluginApi.getTaskManager().submit(new (class extends Task {
    constructor() {
      super(ticks);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function teleportToAbyss(player) {
  if (!hasCompletedEnterTheAbyss(player)) {
    player.sendMessage(ABYSS_LOCKED_MESSAGE);
    return;
  }
  if (!TeleportHandler.checkReqs(player, ABYSS_INNER_RING)) {
    return;
  }
  player.getSkillManager().setCurrentLevels(Skill.PRAYER, 0);
  // The Mage of Zamorak skulls the player for 10 minutes (Wiki).
  pluginApi.core.CombatFactory.skull(player, pluginApi.core.SkullType.WHITE_SKULL, ABYSS_SKULL_SECONDS);
  requestTeleport(player, ABYSS_INNER_RING);
}

function handleZamorakTeleport(event) {
  teleportToAbyss(event.player);
  return true;
}

function handleDialogueAction(event) {
  if (event.handled || event.action !== "teleport") {
    return;
  }

  const player = event.player;
  if (event.stepId === ABYSS_TELEPORT_STEP) {
    teleportToAbyss(player);
  } else if (ESSENCE_TELEPORT_STEPS.has(event.stepId)) {
    if (!hasCompletedRuneMysteries(player)) {
      player.sendMessage("You need to complete Rune Mysteries before using this teleport.");
    } else {
      teleportToEssenceMine(player, event.npc);
    }
  } else {
    return;
  }

  event.handled = true;
  event.end = true;
}

function abyssObstacleChance(player, obstacle) {
  if (obstacle.skill == null) {
    return 100;
  }
  return Math.min(100, player.getSkillManager().getCurrentLevel(obstacle.skill) + 1);
}

function handleAbyssObstacle(event) {
  const obstacle = ABYSS_OBSTACLES.get(event.objectId);
  if (!obstacle) {
    return false;
  }

  const player = event.player;
  if (obstacle.toolIds && !hasTool(player, obstacle.toolIds)) {
    player.sendMessage(obstacle.toolMessage);
    return true;
  }

  if (Math.random() * 100 < abyssObstacleChance(player, obstacle)) {
    if (obstacle.skill != null) {
      player.getSkillManager().addExperiences(obstacle.skill, ABYSS_OBSTACLE_XP);
    }
    requestTeleport(player, ABYSS_INNER_RING.clone());
  } else {
    player.sendMessage(obstacle.fail);
  }
  return true;
}

/**
 * An altar's exit portal: outside its ruins, with the portal's sound and "You step through the
 * portal...", as captured (on the tick after arriving, when the click is handled). Leaving
 * through Guardians of the Rift's altars returns to the Temple of the Eye instead; that's the
 * minigame's.
 */
function handleExitPortal(event) {
  if (event.objectId === ESSENCE_MINE_PORTAL) return handleEssenceMinePortal(event);
  const talisman = EXIT_PORTALS.get(event.objectId);
  if (!talisman || talisman.ruinX === undefined) return false;
  const { player } = event;
  player.moveTo(new Location(talisman.ruinX, talisman.ruinY, 0));
  player.getPacketSender().sendSound(EXIT_PORTAL_SOUND, 1, 0);
  spam(player, "You step through the portal...");
  return true;
}

function handleEnterRift(event) {
  const runeId = RIFT_RUNES.get(event.objectId);
  if (!runeId) {
    return false;
  }
  const destination = ALTAR_DESTINATIONS.get(runeId);
  if (destination) {
    requestTeleport(event.player, new Location(destination.x, destination.y, 0));
  }
  return true;
}

module.exports = {
  name: "Runecrafting",
  register(api) {
    initialize(api);
    api.persistAttribute(ESSENCE_MINE_RETURN_ATTRIBUTE);

    api.onPlayerLogin(syncTiaraOptions);
    api.onPlayerDeath(cancelTravelOnDeath);
    api.onCustomEvent("equipment:changed", syncTiaraOptions);
    api.onItemOnObject(handleTalismanOnRuins, { noted: false });
    api.onItemOnObject(handleBindTiara, { noted: false });
    api.onObjectInteraction("Mysterious ruins", { Enter: handleEnterRuins });
    api.onObjectInteraction("Altar", { "Craft-rune": handleCraftRunes });
    api.onObjectInteraction("Blood Altar", { Bind: handleCraftRunes });
    api.onObjectInteraction("Portal", { Use: handleExitPortal });

    Pouches.attach(api);
    api.onCustomEvent("runecrafting:altar-rune", answerAltarRune);

    for (const talisman of TALISMANS.values()) {
      api.onItemAction(talisman.name, { Locate: handleTalismanLocate });
    }

    for (const npcName of RUNE_ESSENCE_TELEPORT_NPCS) {
      api.onNpcInteraction(npcName, { Teleport: handleRuneEssenceTeleport });
    }
    api.onNpcInteraction("Mage of Zamorak", { Teleport: handleZamorakTeleport });
    api.onCustomEvent("npc-dialogue:action", handleDialogueAction);

    for (const objectName of RIFT_OBJECT_NAMES) {
      api.onObjectInteraction(objectName, {
        "Exit-through": handleEnterRift,
        "Exit-through (Kourend)": handleEnterRift,
      });
    }

    for (const obstacle of ABYSS_OBSTACLES.values()) {
      api.onObjectInteraction(obstacle.objectName, {
        [obstacle.action]: handleAbyssObstacle,
      });
    }

    api.log("registered", {
      altars: RUNES_BY_ALTAR_ID.size,
      talismans: TALISMANS.size,
      rifts: RIFT_RUNES.size,
      abyssObstacles: ABYSS_OBSTACLES.size,
    });
  },
};
