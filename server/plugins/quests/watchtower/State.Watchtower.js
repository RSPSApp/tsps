/**
 * Watchtower's stages, varbits, ids, tiles and saved state, shared by the quest and its units.
 *
 * The stages are varp 212 (itwatchtower) as the user's revision 242 capture sets it (Watchtower.bin,
 * docs/quests/watchtower/README.md "Stages"): 11 -> 13 on the lever, 14 once the scroll is read; live
 * never sends 12.
 *
 * The quest's own varbits are bits 4-29 of varp 936 (the cache's watchtower_* varbits). The cache's
 * multilocs and multinpcs read the pillars (3127-3130) and the shamans (3131-3136); the others only
 * record what live recorded. They are saved, and sent again at login.
 *
 * What live keeps server-side (who gave which task, the relic parts the wizard holds, the skavid
 * words) stays in the old bit-packed attribute, whose layout older saves already use.
 */
const STAGES = Object.freeze({
  STARTED: 1, // "Try searching the surrounding area..." (tick 215)
  FINGERNAILS: 2, // "You could start by checking out the ogre settlements..." (791)
  RELIC: 3, // the wizard hands over the assembled relic (2040)
  GUTANOTH: 4, // "It's got the statue of Dalgroth..." (2314)
  RIDDLE: 5, // "I want you to bring me an item..." (2646)
  MAP: 6, // the death rune for the map (2665)
  SKAVID_CRYSTAL: 7, // "The others are with the shamans in the enclave..." (3315)
  NIGHTSHADE: 8, // the first cave nightshade on an enclave guard (3451)
  RECIPE: 9, // "Collect a guam leaf, add jangerberries..." (5065)
  MAGIC_POTION: 10, // "Here it is - a dangerous substance..." (5450)
  ALL_CRYSTALS: 11, // "Put the crystals on the pillars there..." (6004)
  COMPLETE: 13, // the lever (6050)
  READ_SCROLL: 14, // the spell scroll read (6093)
});

const VARP_QUEST = 212; // itwatchtower
const VARP_STATE = 936; // the watchtower_* varbits' base var

const VARBITS = Object.freeze({
  GUARD: 3117, // watchtower_guard: the tower guard has let the player up once (t256)
  GATE_CHAT_EAST: 3118, // watchtower_gate_chat_1: the east guards have asked for gold (t2217)
  GATE_CHAT_NORTH_WEST: 3119, // watchtower_gate_chat_2: the north-west guards have stopped the player (t2308)
  GATE_CHAT_BATTLEMENT: 3120, // watchtower_gate_chat_3: the battlement guards want a gift (t2450)
  PUZZLE: 3121, // watchtower_puzzle_chat: the city guard's riddle (t2646)
  ROCK_MINED: 3124, // watchtower_rock_mined (t5885)
  NIGHTSHADE_USED: 3125, // watchtower_nightshade_used: the first run past the enclave guards (t3635)
  ENCLAVE_SCENE: 3137, // watchtower_enclave_scene: the shaman and dragon scene seen (t3668)
  TOOTH_GOT: 3138, // watchtower_tooth_got: Gorad's tooth (t1496)
});

/**
 * The four pillars (multilocs: 0 empty, 1 crystal, 2 lit), by the crystal each takes. Live's
 * watchtower_pillar_n numbering is not the crystals' (t6014-6038): the yellow crystal sets 3128.
 */
const PILLARS = Object.freeze([
  Object.freeze({ loc: 20029, varbit: 3128, crystal: 2380, x: 2545, y: 3113 }), // yellow, south-west
  Object.freeze({ loc: 20033, varbit: 3129, crystal: 2381, x: 2548, y: 3116 }), // magenta, north-east
  Object.freeze({ loc: 20025, varbit: 3127, crystal: 2382, x: 2545, y: 3116 }), // cyan, north-west
  Object.freeze({ loc: 20037, varbit: 3130, crystal: 2383, x: 2548, y: 3113 }), // grey ("white" in the cache), south-east
]);

/** The six enclave shamans: multinpcs 6208-6213 on watchtower_shaman_1-6 (t5719-5852). */
/** `ids`: the multinpc and the shaman it shows until its varbit is 1 (qip_watchtower_ogre_shaman_0n_normal). */
const SHAMANS = Object.freeze([
  Object.freeze({ npc: 6208, varbit: 3131, ids: Object.freeze([6208, 4383]) }),
  Object.freeze({ npc: 6209, varbit: 3132, ids: Object.freeze([6209, 4387]) }),
  Object.freeze({ npc: 6210, varbit: 3133, ids: Object.freeze([6210, 4389]) }),
  Object.freeze({ npc: 6211, varbit: 3134, ids: Object.freeze([6211, 4391]) }),
  Object.freeze({ npc: 6212, varbit: 3135, ids: Object.freeze([6212, 4393]) }),
  Object.freeze({ npc: 6213, varbit: 3136, ids: Object.freeze([6213, 4395]) }),
]);

/** Server-side bits in the old attribute (its layout predates this alignment; old saves use it). */
const BITS = Object.freeze({
  SPOKEN_TOBAN: 0,
  HELPED_TOBAN: 1,
  SPOKEN_GREW: 2,
  HELPED_GREW: 3,
  SPOKEN_OG: 4,
  HELPED_OG: 5,
  RELIC: Object.freeze([6, 7, 8]), // the wizard holds relic part 1/2/3
  LEARNING_SKAVID: 12,
  LEARNED_AR: 13,
  LEARNED_IG: 14,
  LEARNED_CUR: 15,
  LEARNED_NOD: 16,
  MARKET_GIVEN: 11, // the battlement guards have their rock cake
  EAST_GATE_PAID: 25,
});
/** Bits older saves set that the varbits now hold (migrated once at login). */
const LEGACY_BITS = Object.freeze({ MARKET_WANTS: 10, GORAD_DEAD: 17, KILLS_SHIFT: 18, PLACED: Object.freeze([21, 22, 23, 24]) });

/** Saved state. The "quest.watchtower.*" key predates the kebab-case rule and stays for old saves. */
const ATTRIBUTES = Object.freeze({
  BITS: "quest.watchtower.bits",
  VARBITS: "watchtower:varbits",
  SAVE_VERSION: "watchtower:save-version",
  SCENE_EXIT: "watchtower:scene-exit",
});
const LEGACY_ENCLAVE_SCENE_ATTRIBUTE = "watchtower:enclave-scene-seen";
const SAVE_VERSION = 1;

const PAGE = "Watchtower";
const GUARD_PAGE = "Ogre guard";

const NPCS = Object.freeze({
  WIZARD: 4397, // watchtower_wizard
  WIZARDS: Object.freeze([4398, 4399, 4400]), // qip_watchtower_wizard_02-04
  TOWER_GUARD: 4405,
  OG: 4364,
  GREW: 4365,
  TOBAN: 4366,
  GORAD: 4367,
  EAST_GUARD: 4369, // ogre_guard1: the east gate, the gold bar (t2214)
  NORTH_WEST_GUARD: 4370, // ogre_guard2: the north-west gate, the relic (t2308)
  BATTLEMENT_GUARD: 4371, // ogre_guard3: the battlement, the rock cake (t2444)
  BRIDGE_GUARD: 4372, // ogre_guard4: "Leave us alone!" and the gap's toll (t2500, t2511)
  CITY_GUARD: 4373,
  SCARED_SKAVID: 4374,
  MAD_SKAVID: 4375,
  ENCLAVE_GUARD: 4381,
  OGRE_CHIEFTAIN: 4362,
  SCENE_SHAMAN: 4384, // watchtower_cutscene_ogre_shaman (t3643)
  SCENE_DRAGON: 4385, // watchtower_cutscene_blue_dragon (t3643)
});

/** The four teaching skavids, their words and the transcript section each plays (t3047-3211). */
const SKAVIDS = Object.freeze(new Map([
  [4376, Object.freeze({ word: "Ig.", bit: BITS.LEARNED_IG, variant: "skavid-search-learning-skavid-skavid-2" }), // Cur bidith
  ],
  [4377, Object.freeze({ word: "Ar.", bit: BITS.LEARNED_AR, variant: "skavid-search-learning-skavid-skavid-4" })], // Gor cur
  [4378, Object.freeze({ word: "Cur.", bit: BITS.LEARNED_CUR, variant: "skavid-search-learning-skavid-skavid-1" })], // Bidith tanath
  [4379, Object.freeze({ word: "Nod.", bit: BITS.LEARNED_NOD, variant: "skavid-search-learning-skavid-skavid-3" })], // Tanath gor
]));

const TILES = Object.freeze({
  TRELLIS_TOP: Object.freeze([2548, 3117, 1]), // t332
  TOWER_FIRST_FLOOR: Object.freeze([2545, 3111, 1]), // the tower ladder's top (t259)
  TOP_FLOOR_COPY_LADDER: Object.freeze([2933, 4712, 2]), // the completed tower's top floor
  LEVER_LANDING: Object.freeze([2928, 4715, 2]), // the lever moves the player into the completed tower (t6050)
  TOBAN_ISLAND: Object.freeze([2576, 3029, 0]), // out of Toban's tunnel (t1359)
  TOBAN_TUNNEL_OUTSIDE: Object.freeze([2500, 2988, 0]), // Toban's ladder (t1525)
  ENCLAVE_INSIDE: Object.freeze([2588, 9410, 0]), // past the enclave guards (t3638, t5666)
  ENCLAVE_EXIT: Object.freeze([2540, 3054, 0]), // the enclave's cave (t3735)
  YANILLE_HOLE: Object.freeze([2585, 3108, 0]),
  GAP_NORTH: Object.freeze([2530, 3029, 0]), // the far side of the gap (t2521)
  GAP_SOUTH: Object.freeze([2531, 3026, 0]), // and back (t2525)
});

/** Skavid caves: entrance -> inside, exit -> outside (t2903-3331). */
const CAVES = Object.freeze(new Map([
  [2805, Object.freeze([2498, 9418])], // skavid_cave1 (2560,3022)
  [2806, Object.freeze([2530, 9467])], // skavid_cave2 (2522,3068)
  [2807, Object.freeze([2518, 9454])], // skavid_cave3 (2539,3052)
  [2808, Object.freeze([2498, 9451])], // skavid_cave4 (2552,3052)
  [2809, Object.freeze([2504, 9440])], // skavid_cave5 (2553,3033)
  [2810, Object.freeze([2522, 9411])], // skavid_cave6 (2527,3011)
]));
const CAVE_EXITS = Object.freeze(new Map([
  [2817, Object.freeze([2563, 3024])], // cave1exit (t3217)
  [2818, Object.freeze([2523, 3070])], // cave2exit (t3136)
  [2819, Object.freeze([2540, 3054])], // cave3exit (t3100)
  [2820, Object.freeze([2553, 3054])], // cave4exit (t2918)
  [2821, Object.freeze([2552, 3034])], // cave5exit (t3015)
  [2822, Object.freeze([2529, 3012])], // cave6exit (t3331)
]));
/**
 * Without the map the caves pass the player round a fixed circuit of surface caves (Wiki: Skavid
 * caves, the "transport system"); skavid_cave6 -> (2523,3070) with a fade is captured (t2255-2263).
 */
const MAPLESS_CAVE_ROUTES = Object.freeze(new Map([
  [2805, Object.freeze([2523, 3070])],
  [2806, Object.freeze([2540, 3055])],
  [2807, Object.freeze([2553, 3055])],
  [2808, Object.freeze([2552, 3034])],
  [2809, Object.freeze([2563, 3024])],
  [2810, Object.freeze([2523, 3070])],
]));

/** The quest's varbits live had set by each stage, for ::quest jumps and old saves. */
function impliedVarbits(stage) {
  const vars = {};
  if (stage >= STAGES.FINGERNAILS) vars[VARBITS.GUARD] = 1;
  if (stage >= STAGES.RELIC) vars[VARBITS.TOOTH_GOT] = 1;
  if (stage >= STAGES.GUTANOTH) vars[VARBITS.GATE_CHAT_NORTH_WEST] = 1;
  if (stage >= STAGES.RIDDLE) {
    vars[VARBITS.GATE_CHAT_BATTLEMENT] = 1;
    vars[VARBITS.PUZZLE] = 1;
  }
  if (stage >= STAGES.SKAVID_CRYSTAL) vars[VARBITS.GATE_CHAT_EAST] = 1;
  if (stage >= STAGES.RECIPE) {
    vars[VARBITS.NIGHTSHADE_USED] = 1;
    vars[VARBITS.ENCLAVE_SCENE] = 1;
  }
  if (stage >= STAGES.ALL_CRYSTALS) {
    vars[VARBITS.ROCK_MINED] = 1;
    for (const shaman of SHAMANS) vars[shaman.varbit] = 1;
  }
  if (stage >= STAGES.COMPLETE) for (const pillar of PILLARS) vars[pillar.varbit] = 2;
  return vars;
}

function createState(api, getQuest) {
  function vars(player) {
    const saved = player.getAttribute(ATTRIBUTES.VARBITS);
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  }

  function get(player, varbit) {
    return Number(vars(player)[varbit]) || 0;
  }

  /** Sets, saves and sends a quest varbit. */
  function set(player, varbit, value) {
    const next = { ...vars(player) };
    if ((value | 0) === 0) delete next[varbit];
    else next[varbit] = value | 0;
    player.setAttribute(ATTRIBUTES.VARBITS, next);
    player.getPacketSender().sendVarbit(varbit, value | 0);
  }

  function bits(player) {
    const value = Number(player.getAttribute(ATTRIBUTES.BITS));
    return Number.isFinite(value) ? value | 0 : 0;
  }
  const hasBit = (player, bit) => (bits(player) & (1 << bit)) !== 0;
  function setBit(player, bit, on = true) {
    const value = bits(player);
    player.setAttribute(ATTRIBUTES.BITS, (on ? value | (1 << bit) : value & ~(1 << bit)) | 0);
  }

  const stage = (player) => getQuest().getStage(player);

  /** Stage changes made by this quest's own code, so `stageChanged` can tell an outside jump. */
  const ownChange = new WeakSet();
  function own(player, fn) {
    ownChange.add(player);
    try {
      return fn();
    } finally {
      ownChange.delete(player);
    }
  }
  function setStage(player, value) {
    own(player, () => getQuest().setStage(player, value));
  }
  /** Moves the stage forward only; returns whether it moved. */
  function advance(player, value) {
    if (stage(player) >= value) return false;
    setStage(player, value);
    return true;
  }

  /** Sends every saved quest varbit again (login). */
  function replay(player) {
    const sender = player.getPacketSender();
    for (const [varbit, value] of Object.entries(vars(player))) sender.sendVarbit(Number(varbit), value | 0);
  }

  /**
   * Brings a save from before the capture alignment onto live's stages and varbits, once: the old
   * completion (12) is live's 13, and the old attribute bits become the varbits that now hold them.
   */
  function migrate(player) {
    if ((Number(player.getAttribute(ATTRIBUTES.SAVE_VERSION)) || 0) >= SAVE_VERSION) return false;
    player.setAttribute(ATTRIBUTES.SAVE_VERSION, SAVE_VERSION);
    const old = stage(player);
    if (old <= 0) return false;
    const mapped = old === 12 ? STAGES.COMPLETE : old;
    const legacy = bits(player);
    const next = { ...impliedVarbits(mapped), ...vars(player) };
    if (legacy & (1 << LEGACY_BITS.MARKET_WANTS)) next[VARBITS.GATE_CHAT_BATTLEMENT] = 1;
    if (legacy & (1 << LEGACY_BITS.GORAD_DEAD)) next[VARBITS.TOOTH_GOT] = 1;
    const kills = (legacy >>> LEGACY_BITS.KILLS_SHIFT) & 0x7;
    SHAMANS.slice(0, kills).forEach((shaman) => { next[shaman.varbit] = 1; });
    if (mapped < STAGES.COMPLETE) {
      LEGACY_BITS.PLACED.forEach((bit, index) => {
        // The old bits were yellow, grey, cyan, magenta.
        const pillar = [PILLARS[0], PILLARS[3], PILLARS[2], PILLARS[1]][index];
        if (legacy & (1 << bit)) next[pillar.varbit] = 1;
      });
    }
    if (player.getAttribute(LEGACY_ENCLAVE_SCENE_ATTRIBUTE) === true) {
      next[VARBITS.ENCLAVE_SCENE] = 1;
      player.setAttribute(LEGACY_ENCLAVE_SCENE_ATTRIBUTE, false);
    }
    player.setAttribute(ATTRIBUTES.VARBITS, next);
    if (mapped !== old) setStage(player, mapped);
    return true;
  }

  /**
   * "quest:stage-changed" from outside this quest's own code (::quest, a quest pack's completion):
   * the varbits become what live had by that stage, so the tower and the enclave match the jump.
   */
  function stageChanged({ player, key, stage: value }) {
    if (key !== getQuest()?.key || !player || ownChange.has(player)) return;
    const next = impliedVarbits(value);
    const sender = player.getPacketSender();
    for (const varbit of Object.keys(vars(player))) if (!(varbit in next)) sender.sendVarbit(Number(varbit), 0);
    player.setAttribute(ATTRIBUTES.VARBITS, next);
    player.setAttribute(ATTRIBUTES.SAVE_VERSION, SAVE_VERSION);
    replay(player);
  }

  function register() {
    api.persistAttribute(ATTRIBUTES.BITS, 0);
    api.persistAttribute(ATTRIBUTES.VARBITS, {});
    api.persistAttribute(ATTRIBUTES.SAVE_VERSION, 0);
    api.persistAttribute(LEGACY_ENCLAVE_SCENE_ATTRIBUTE, false);
    api.onCustomEvent("quest:stage-changed", stageChanged);
  }

  return { get, set, bits, hasBit, setBit, stage, setStage, advance, own, replay, migrate, register };
}

module.exports = {
  STAGES, VARP_QUEST, VARP_STATE, VARBITS, PILLARS, SHAMANS, BITS, ATTRIBUTES, SAVE_VERSION, PAGE, GUARD_PAGE,
  NPCS, SKAVIDS, TILES, CAVES, CAVE_EXITS, MAPLESS_CAVE_ROUTES, impliedVarbits, createState,
};
