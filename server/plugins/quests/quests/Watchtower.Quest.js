/**
 * Watchtower (members), aligned with a whole run of the quest on live: the user's RSProx capture
 * Watchtower.bin (revision 242.1; docs/quests/watchtower/README.md, with every capture fact the
 * plugin relies on and the recording's ticks). The words are the Wiki's: the "Watchtower" transcript
 * (revision 15399934), with the lines it still lacks added from the capture in osrsreboxed-db's
 * capture-sources.json. Where the capture and the Wiki differ the Wiki is kept.
 *
 * Units in plugins/quests/watchtower/: State (stages, the varp 936 varbits, ids, tiles, old saves),
 * Journal (the capture's journal) and Scenes (the enclave scene, the relic, the scared skavid).
 * The two Gu'Tanoth gates are pass-through gates in plugins/objects/Doors.plugin.js; this plugin
 * says who may pass (door:toggle).
 *
 * Rewards (the capture's scroll, tick 6062; the Wiki): 4 Quest points, 15,250 Magic XP, 5,000 coins
 * and the Watchtower Teleport spell scroll.
 */
module.exports = function registerWatchtowerQuest(api) {
  const core = api.core;
  const { Skill, Location, Animation, Graphic, ItemIdentifiers: I, DialogueChainBuilder, ItemStatementDialogue } = core;
  const { DoubleItemStatementDialogue, HitDamage, HitMask, Sound, Sounds, CountdownTask } = core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts, giveReward, questStartMessage } = require("../QuestRuntime");
  const W = require("../watchtower/State.Watchtower");
  const { journal } = require("../watchtower/Journal.Watchtower");
  const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
  const Darkness = require("../../world/Darkness.plugin");
  ObstacleRunner.init(api);

  const { STAGES, VARBITS, BITS, NPCS, PAGE, GUARD_PAGE, TILES } = W;
  let quest;
  const state = W.createState(api, () => quest);

  // ------------------------------------------------------------------ ids

  const ITEMS = Object.freeze({
    FINGERNAILS: I.FINGERNAILS, OLD_ROBE: I.OLD_ROBE, UNUSUAL_ARMOUR: I.UNUSUAL_ARMOUR,
    DAMAGED_DAGGER: I.DAMAGED_DAGGER, EYE_PATCH: I.TATTERED_EYE_PATCH,
    RELIC_PARTS: Object.freeze([I.RELIC_PART_1, I.RELIC_PART_2, I.RELIC_PART_3]),
    RELIC: I.OGRE_RELIC, MAP: I.SKAVID_MAP, TOOTH: I.OGRE_TOOTH, KEY: I.TOBANS_KEY, GOLD: I.TOBANS_GOLD,
    ROCK_CAKE: I.ROCK_CAKE, CRYSTALS: Object.freeze([I.CRYSTAL, I.CRYSTAL_2, I.CRYSTAL_3, I.CRYSTAL_4]),
    NIGHTSHADE: I.CAVE_NIGHTSHADE, MAGIC_POTION: I.MAGIC_OGRE_POTION, SCROLL: I.SPELL_SCROLL,
    DRAGON_BONES: I.DRAGON_BONES, DEATH_RUNE: I.DEATH_RUNE, COINS: I.COINS, TINDERBOX: I.TINDERBOX,
    VIAL_OF_WATER: I.VIAL_OF_WATER, JANGERBERRIES: I.JANGERBERRIES, GUAM_LEAF: I.GUAM_LEAF,
    GUAM_POTION: I.GUAM_POTION_UNF_, JANGER_VIAL: I.VIAL_3, GUAM_JANGER_VIAL: I.VIAL_4, POTION: I.POTION_3,
    GROUND_BAT_BONES: I.GROUND_BAT_BONES, BAT_BONES: I.BAT_BONES, PESTLE: I.PESTLE_AND_MORTAR,
    GOLD_BAR: I.GOLD_BAR, VIAL: I.VIAL, SHAMAN_ROBE: I.SHAMAN_ROBE,
  });
  const [CRYSTAL_YELLOW, CRYSTAL_MAGENTA, CRYSTAL_CYAN, CRYSTAL_GREY] = ITEMS.CRYSTALS;
  /** The decoy evidence, in the order the wizard's "I have this [robe/dagger/armour/eyepatch]..." names it. */
  const DECOYS = [[ITEMS.OLD_ROBE, "robe"], [ITEMS.DAMAGED_DAGGER, "dagger"], [ITEMS.UNUSUAL_ARMOUR, "armour"], [ITEMS.EYE_PATCH, "eyepatch"]];

  const LOCS = Object.freeze({
    TOWER_LADDER: 2833, // towerladder: the ground floor's ladder, guarded (t256)
    TOP_LADDER_UP: 2796, // watchladderup: to the top floor
    TRELLIS: 20056, // qip_watchtower_trellis_base
    BUSHES: Object.freeze(new Map([[2798, null], [2799, I.FINGERNAILS], [2800, I.DAMAGED_DAGGER], [2801, I.TATTERED_EYE_PATCH],
      [2802, I.OLD_ROBE], [2803, I.UNUSUAL_ARMOUR]])),
    // tree_ropeswing4_norope, tree_ropeswing3, and tree_ropeswing4 with the rope tied (t1195).
    ROPE_TREE: 23638, ROPE_SWING_BACK: 23570, ROPE_SWING_ROPED: 23571,
    TOBAN_CAVE: 2811, TOBAN_LADDER: 2812, TOBAN_CHEST: 2790,
    EAST_GATE: Object.freeze([2786, 2787]), NORTH_WEST_GATE: Object.freeze([2788, 2789]),
    CAKE_COUNTER: 2793, CAKE_COUNTER_EMPTY: 2792, BATTLEMENT: 2832, GAP_NORTH: 2830, GAP_SOUTH: 2831,
    ENCLAVE_ENTRANCE: 2804, ENCLAVE_EXIT: 2813, ENCLAVE_GATE: 2815, ROCK: 2816, LEVER: 2794,
    YANILLE_HOLE: 2823,
  });

  /** The bushes' Wiki conditions ("Old robe:" ...), by the item each holds. */
  const BUSH_CONDITIONS = new Map([
    [ITEMS.OLD_ROBE, "old robe:"], [ITEMS.UNUSUAL_ARMOUR, "unusual armour:"], [ITEMS.DAMAGED_DAGGER, "damaged dagger:"],
    [ITEMS.EYE_PATCH, "tattered eye patch:"], [ITEMS.FINGERNAILS, "fingernails:"],
  ]);

  // ------------------------------------------------------------------ captured animations and sounds

  const SEQ = Object.freeze({
    SEARCH_BUSH: 5216, CLIMB: 828, ROPE_THROW: 775, ROPE_SWING: 751, ROPE_SWING_LOC: 497, CHEST: 832,
    BATTLEMENT: 839, GAP_JUMP: 5355, GRIND: 364, EXPLODE: 365, POUR_POTION: 5361, PICKUP: 827, LEVER: 835,
    READ_SCROLL: 5354,
  });
  const SOUND = Object.freeze({
    ROPE_SWING: 2494, UNLOCK: 2419, CHEST_OPEN: 52, CHEST_CLOSE: 51, CLIMB_WALL: 2453, JUMP: 2461, GRIND: 2608,
    VIAL_MIX: 2611, EXPLODE: 1486, SHAMAN_CRY: 3268, PICK: 2581, PILLAR: 975, LEVER: 2400,
  });
  const SPOTANIM_EXPLODE = 176;
  const JINGLE_MACHINE_ON = 234;
  const MAX_SHAMANS = 6;

  // ------------------------------------------------------------------ helpers

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  function bankHas(player, itemId) {
    try {
      return Number(player.getBank?.()?.getAmount?.(itemId) ?? 0) > 0;
    } catch {
      return false;
    }
  }
  const owns = (player, itemId) => held(player, itemId) || bankHas(player, itemId);
  const give = (player, itemId) => { if (!held(player, itemId)) player.getInventory().adds(itemId, 1); };
  const take = (player, itemId, amount = 1) => { if (held(player, itemId)) player.getInventory().deleteNumber(itemId, amount); };
  const stage = (player) => quest.getStage(player);
  const complete = (player) => quest.isComplete(player);
  const level = (player, skill) => player.getSkillManager().getCurrentLevel(skill);
  const sound = (player, id, delay = 0) => Sounds.sendSound(player, new Sound(id, 1, delay, 0));
  const later = (player, ticks, fn) => api.getTaskManager().submit(new CountdownTask(player, ticks, () => {
    if (player.isRegistered?.() !== false) fn();
  }));
  const relicPartsHeld = (player) => W.BITS.RELIC.filter((bit) => state.hasBit(player, bit)).length;
  const shamansDead = (player) => W.SHAMANS.filter((shaman) => state.get(player, shaman.varbit) === 1).length;
  const learnedWords = (player) => [...W.SKAVIDS.values()].filter((skavid) => state.hasBit(player, skavid.bit)).length;
  const allCrystals = (player) => ITEMS.CRYSTALS.every((itemId) => held(player, itemId));
  const allPlaced = (player) => W.PILLARS.every((pillar) => state.get(player, pillar.varbit) >= 1);
  const inBox = (player, minX, maxX, minY, maxY) => {
    const at = player.getLocation();
    return at.getX() >= minX && at.getX() <= maxX && at.getY() >= minY && at.getY() <= maxY;
  };
  const near = (player, [x, y], range = 1) => {
    const at = player.getLocation();
    return Math.max(Math.abs(at.getX() - x), Math.abs(at.getY() - y)) <= range;
  };

  function variantSteps(page, variant) {
    const steps = loadTranscripts(api)?.[page]?.variants?.[variant];
    return Array.isArray(steps) ? steps : null;
  }
  /** A condition's own steps on a page, by its id. */
  function conditionSteps(page, variant, id) {
    return (variantSteps(page, variant) ?? []).find((step) => step.id === id)?.steps ?? [];
  }
  const play = (player, npcId, variant, select, page = PAGE, npc = null) => startTranscript(api, player, npcId, page, variant, select, npc);

  /** One item box (two items: the double box), as live hands out quest items (t1405, t1716). */
  function itemBox(player, text, first, second) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(second === undefined
      ? new ItemStatementDialogue(0, first, text) : new DoubleItemStatementDialogue(0, first, second, text)));
  }
  /** A dump message's text, so boxes say the Wiki's words. */
  function messageText(variant, id) {
    const find = (steps) => {
      for (const step of steps ?? []) {
        if (step.id === id) return step.text;
        const inner = find(step.steps) ?? step.options?.map((option) => find(option.steps)).find(Boolean);
        if (inner) return inner;
      }
      return null;
    };
    return find(variantSteps(PAGE, variant));
  }

  function nearestNpc(player, test, range = 12) {
    let best = null;
    let bestDistance = Infinity;
    const at = player.getLocation();
    for (const npc of core.World.getNpcs()) {
      if (!npc?.isRegistered?.() || !test(npc)) continue;
      const there = npc.getLocation();
      if (there.getZ() !== at.getZ()) continue;
      const distance = Math.max(Math.abs(there.getX() - at.getX()), Math.abs(there.getY() - at.getY()));
      if (distance <= range && distance < bestDistance) {
        best = npc;
        bestDistance = distance;
      }
    }
    return best;
  }
  const attack = (npc, player) => npc?.getCombat?.()?.attack(player);
  const damage = (player, amount) => player.getCombat().getHitQueue().addPendingDamage([new HitDamage(amount, HitMask.RED)]);

  const ctx = { state, variantSteps };
  const scenes = require("../watchtower/Scenes.Watchtower")(api, ctx);

  // ------------------------------------------------------------------ the journal

  function buildJournal(player) {
    return journal(stage(player), {
      fingernails: held(player, ITEMS.FINGERNAILS), gold: held(player, ITEMS.GOLD), tooth: held(player, ITEMS.TOOTH),
      map: held(player, ITEMS.MAP),
      spokenOg: state.hasBit(player, BITS.SPOKEN_OG), helpedOg: state.hasBit(player, BITS.HELPED_OG),
      spokenGrew: state.hasBit(player, BITS.SPOKEN_GREW), helpedGrew: state.hasBit(player, BITS.HELPED_GREW),
      helpedToban: state.hasBit(player, BITS.HELPED_TOBAN), eastGatePaid: state.hasBit(player, BITS.EAST_GATE_PAID),
      learning: state.hasBit(player, BITS.LEARNING_SKAVID),
      learnedIg: state.hasBit(player, BITS.LEARNED_IG), learnedAr: state.hasBit(player, BITS.LEARNED_AR),
      learnedCur: state.hasBit(player, BITS.LEARNED_CUR), learnedNod: state.hasBit(player, BITS.LEARNED_NOD),
      shamansLeft: MAX_SHAMANS - shamansDead(player),
    }) ?? [];
  }

  // ------------------------------------------------------------------ the spell

  const hasReadSpellScroll = (player) => stage(player) >= STAGES.READ_SCROLL;

  function canCastWatchtowerTeleport(event) {
    if (event.spellName?.trim().toLowerCase() !== "watchtower teleport" || hasReadSpellScroll(event.player)) return;
    event.allow = false;
    event.player?.sendMessage?.("You need to read the Watchtower spell scroll before casting this spell.");
  }

  /** "magic:teleport-quest-lock": the house portals ask what casting needs (Wiki, Portal chamber). */
  function watchtowerPortalLock(event) {
    if (event?.name?.trim().toLowerCase() !== "watchtower teleport" || hasReadSpellScroll(event.player)) return;
    event.refusal ??= `You need to read the Watchtower spell scroll to ${event.action ?? "cast this spell"}.`;
  }

  // ------------------------------------------------------------------ which conversation plays

  function wizardVariant(player) {
    const value = stage(player);
    if (value <= 0) return "getting-started-speaking-to-the-watchtower-wizard";
    if (value === STAGES.STARTED) return "searching-for-evidence-talking-to-the-watchtower-wizard";
    if (value === STAGES.FINGERNAILS) return "ogre-investigations-talking-to-the-watchtower-wizard";
    if (value === STAGES.RELIC) return "ogre-investigations-talking-to-the-watchtower-wizard-again";
    if (value <= STAGES.RIDDLE) return "entering-gu-tanoth-talking-to-the-watchtower-wizard-after-gaining-access-to-the-city";
    if (value === STAGES.MAP) return "skavid-search-talking-to-the-watchtower-wizard-after-getting-the-skavid-map";
    if (value === STAGES.SKAVID_CRYSTAL) return "skavid-search-talking-to-the-watchtower-wizard-after-learning-to-navigate-the-skavid-caves";
    if (value === STAGES.NIGHTSHADE) return "entering-the-enclave-talking-to-the-watchtower-wizard-after-discovering-the-shamans-are-invincible";
    if (value === STAGES.RECIPE) {
      return held(player, ITEMS.POTION)
        ? "entering-the-enclave-talking-to-the-watchtower-wizard-after-making-the-potion"
        : "entering-the-enclave-talking-to-the-watchtower-wizard-after-discovering-the-shamans-are-invincible-talking-to-the-watchtower-wizard-again";
    }
    if (value === STAGES.MAGIC_POTION) {
      // A magic potion lost before the last shaman: a new potion is infused again.
      if (needsNewPotion(player)) return "entering-the-enclave-talking-to-the-watchtower-wizard-after-making-the-potion";
      if (allCrystals(player)) return "reviving-the-watchtower-talking-to-the-watchtower-wizard-with-all-the-crystals";
      if (shamansDead(player) >= MAX_SHAMANS) {
        return "entering-the-enclave-returning-to-the-watchtower-wizard-after-killing-the-shamans-without-mining-the-rock";
      }
      return "entering-the-enclave-talking-to-the-watchtower-wizard-before-killing-the-shamans";
    }
    if (value === STAGES.ALL_CRYSTALS) return "reviving-the-watchtower-talking-to-the-watchtower-wizard-again";
    return "post-quest-talking-to-the-watchtower-wizard";
  }

  /** At stage 10 with shamans left, no magic potion anywhere and a new mixed potion in the pack. */
  function needsNewPotion(player) {
    return stage(player) === STAGES.MAGIC_POTION && shamansDead(player) < MAX_SHAMANS
      && !owns(player, ITEMS.MAGIC_POTION) && held(player, ITEMS.POTION);
  }

  function otherWizardVariant(value) {
    if (value <= 0) return "getting-started-speaking-to-a-wizard";
    if (value === STAGES.STARTED) return "searching-for-evidence-speaking-to-a-wizard";
    if (value === STAGES.FINGERNAILS) return "ogre-investigations-talking-to-a-wizard";
    if (value === STAGES.RELIC) return "ogre-investigations-talking-to-a-wizard-2";
    if (value <= STAGES.RIDDLE) return "entering-gu-tanoth-talking-to-the-wizards-after-gaining-access-to-the-city";
    if (value === STAGES.MAP) return "skavid-search-talking-to-the-wizards-after-getting-the-skavid-map";
    if (value === STAGES.SKAVID_CRYSTAL) return "skavid-search-talking-to-the-wizards-after-learning-to-navigate-the-skavid-caves";
    if (value === STAGES.NIGHTSHADE) return "entering-the-enclave-talking-to-the-wizards-after-discovering-the-shamans-are-invincible";
    if (value === STAGES.RECIPE) {
      return "entering-the-enclave-talking-to-the-watchtower-wizard-after-discovering-the-shamans-are-invincible-talking-to-the-wizards-after-learning-the-potion-recipe";
    }
    if (value === STAGES.MAGIC_POTION) return "reviving-the-watchtower-talking-to-a-wizard";
    if (value === STAGES.ALL_CRYSTALS) return "reviving-the-watchtower-talking-to-a-wizard-before-activating-the-generator";
    return "post-quest-talking-to-a-wizard";
  }

  function ogVariant(player) {
    const value = stage(player);
    if (value < STAGES.FINGERNAILS || value >= STAGES.RELIC) return null;
    if (state.hasBit(player, BITS.HELPED_OG)) return "ogre-investigations-og-speaking-to-og-after-giving-him-toban-s-gold";
    if (state.hasBit(player, BITS.SPOKEN_OG)) return "ogre-investigations-og-speaking-to-og-again";
    return "ogre-investigations-og";
  }

  function grewVariant(player) {
    const value = stage(player);
    // His yellow crystal is not used until the pillars: he hands out another until the quest is done (Wiki, 2021:
    // the crystals can be re-obtained; the wizard sends the player back to whoever gave one).
    if (state.hasBit(player, BITS.HELPED_GREW) && value >= STAGES.FINGERNAILS && value < STAGES.COMPLETE) {
      return "ogre-investigations-grew-speaking-to-grew-after-giving-him-gorad-s-tooth";
    }
    if (value < STAGES.FINGERNAILS || value >= STAGES.RELIC) return null;
    if (state.hasBit(player, BITS.SPOKEN_GREW)) return "ogre-investigations-grew-speaking-to-grew-again";
    return "ogre-investigations-grew";
  }

  function tobanVariant(player) {
    const value = stage(player);
    if (value < STAGES.FINGERNAILS || value >= STAGES.RELIC) return null;
    if (state.hasBit(player, BITS.HELPED_TOBAN)) return "ogre-investigations-toban-speaking-to-toban-after-giving-him-dragon-bones";
    if (state.hasBit(player, BITS.SPOKEN_TOBAN)) return "ogre-investigations-toban-speaking-to-toban-again";
    return "ogre-investigations-toban";
  }

  function cityGuardVariant(player) {
    const value = stage(player);
    if (value < STAGES.GUTANOTH) return null;
    if (value === STAGES.GUTANOTH) return "entering-gu-tanoth-seeking-passage";
    // With the death rune the guard takes it at once (t2661: "I worked it out!").
    if (value === STAGES.RIDDLE) {
      return held(player, ITEMS.DEATH_RUNE)
        ? "entering-gu-tanoth-seeking-passage-using-the-death-rune-on-the-guard-or-talking-to-him-with-it"
        : "entering-gu-tanoth-seeking-passage-talking-to-the-city-guard-again";
    }
    return "entering-gu-tanoth-seeking-passage-talking-to-him-after-having-given-him-the-rune";
  }

  /**
   * The battlement guards: their first talk until they ask for a gift (t2444), then the gift talk, whose Wiki
   * "After giving him the rock cake" line plays once they have it (recorded difference: live played the first talk
   * again after the cake, t6252).
   */
  function battlementGuardVariant(player) {
    return state.get(player, VARBITS.GATE_CHAT_BATTLEMENT) === 1
      ? "entering-gu-tanoth-ogre-guard-talking-to-the-ogre-guard-again"
      : "entering-gu-tanoth-ogre-guard";
  }

  function scaredSkavidVariant(player) {
    const value = stage(player);
    if (value < STAGES.MAP) return null;
    if (!state.hasBit(player, BITS.LEARNING_SKAVID)) return "skavid-search-scared-skavid";
    if (learnedWords(player) >= W.SKAVIDS.size) return "skavid-search-talking-to-the-scared-skavid-after-learning-skavid";
    return "skavid-search-scared-skavid-talking-to-the-scared-skavid-again";
  }

  function selectVariant({ npcId, player }) {
    const value = stage(player);
    if (npcId === NPCS.WIZARD) return wizardVariant(player);
    if (NPCS.WIZARDS.includes(npcId)) return otherWizardVariant(value);
    if (npcId === NPCS.TOWER_GUARD) return "getting-started-speaking-to-a-tower-guard";
    if (npcId === NPCS.OG) return ogVariant(player);
    if (npcId === NPCS.GREW) return grewVariant(player);
    if (npcId === NPCS.TOBAN) return tobanVariant(player);
    if (npcId === NPCS.GORAD) {
      return toothDone(player)
        ? "ogre-investigations-grew-talking-to-gorad-after-getting-his-tooth" : "ogre-investigations-grew-facing-gorad";
    }
    if (npcId === NPCS.BATTLEMENT_GUARD) return battlementGuardVariant(player);
    if (npcId === NPCS.BRIDGE_GUARD) return "entering-gu-tanoth-talking-to-the-southern-ogre-guard";
    if (npcId === NPCS.CITY_GUARD) return cityGuardVariant(player);
    if (npcId === NPCS.SCARED_SKAVID) return scaredSkavidVariant(player);
    if (W.SKAVIDS.has(npcId)) return value >= STAGES.MAP ? W.SKAVIDS.get(npcId).variant : null;
    if (npcId === NPCS.MAD_SKAVID) {
      if (value >= STAGES.SKAVID_CRYSTAL) return "skavid-search-the-mad-skavid-talking-to-the-mad-skavid-again";
      return value === STAGES.MAP && learnedWords(player) >= W.SKAVIDS.size ? "skavid-search-the-mad-skavid" : null;
    }
    if (npcId === NPCS.ENCLAVE_GUARD) {
      return value < STAGES.SKAVID_CRYSTAL
        ? "entering-the-enclave-talking-to-an-enclave-guard-before-getting-the-mad-skavid-s-crystal"
        : "entering-the-enclave-talking-to-an-enclave-guard";
    }
    if (npcId === NPCS.OGRE_CHIEFTAIN && inBox(player, 2560, 2623, 9408, 9471)) {
      return "entering-the-enclave-inside-the-enclave-talking-to-an-ogre-chieftain";
    }
    if (W.SHAMANS.some((shaman) => shaman.ids.includes(npcId))) return "entering-the-enclave-inside-the-enclave-talking-to-an-ogre-shaman";
    return null;
  }

  // ------------------------------------------------------------------ the Wiki's prose conditions

  function answerCondition(event) {
    if (!event.pages?.some((entry) => entry.page === PAGE || entry.page === GUARD_PAGE)) return null;
    const { player, text, stepId } = event;
    const answer = newConditions(event);
    if (answer !== null) return answer;
    if (!player || text === undefined) return null;
    const value = String(text).toLowerCase();
    const has = (itemId) => held(player, itemId);
    const bank = (itemId) => bankHas(player, itemId);
    const [PART_1, PART_2, PART_3] = ITEMS.RELIC_PARTS;

    if (value.includes("with no evidence to show him")) return ![ITEMS.FINGERNAILS, ...DECOYS.map(([id]) => id)].some(has);
    if (value.includes("with any of the evidence besides fingernails")) return !has(ITEMS.FINGERNAILS) && DECOYS.some(([id]) => has(id));
    if (value.includes("with the fingernails")) return has(ITEMS.FINGERNAILS);

    const bush = searchingBush.get(player);
    for (const [itemId, label] of BUSH_CONDITIONS) if (value.includes(label)) return bush === itemId && !has(itemId);
    if (value.includes("searching the same bush after finding an item in it")) return bush != null && has(bush);
    if (value.includes("finding nothing")) return bush === null;

    if (value.includes("without dragon bones")) return !has(ITEMS.DRAGON_BONES);
    if (value.includes("with dragon bones")) return has(ITEMS.DRAGON_BONES);
    if (value.includes("with toban's key")) return has(ITEMS.KEY);
    if (value.includes("without toban's key")) return !has(ITEMS.KEY);
    if (value.includes("if the player no longer has the key")) return !owns(player, ITEMS.KEY);
    if (value.includes("if the player has the key on them")) return has(ITEMS.KEY);
    if (value.includes("if the player has the key stored somewhere")) return bank(ITEMS.KEY);

    if (value.includes("if the player has the relic part on them")) {
      if (stepId === "9Vr3sO") return has(PART_3);
      if (stepId === "rnvWxa") return has(PART_1);
      if (stepId === "_zSkbp") return has(PART_2);
      return ITEMS.RELIC_PARTS.some(has);
    }
    if (value.includes("if the player lost the relic part") || value.includes("if the player doesn't have the relic part")) {
      if (stepId === "dgZQL8") return !owns(player, PART_2);
      if (stepId === "qlelFq") return !owns(player, PART_1);
      return !ITEMS.RELIC_PARTS.some((id) => owns(player, id));
    }
    if (value.includes("if the relic part is stored somewhere")) {
      if (stepId === "U7LsnZ") return bank(PART_2);
      if (stepId === "JvNuhW") return bank(PART_1);
      return ITEMS.RELIC_PARTS.some(bank);
    }
    if (value.includes("without the ogre tooth")) return !has(ITEMS.TOOTH);
    if (value.includes("with the ogre tooth")) return has(ITEMS.TOOTH);
    if (value.includes("after killing gorad")) return state.get(player, VARBITS.TOOTH_GOT) === 1;

    if (value.includes("if the player has the relic in their inventory")) return has(ITEMS.RELIC);
    if (value.includes("if the player lost the relic")) return !owns(player, ITEMS.RELIC);
    if (value.includes("if the player stored the relic somewhere")) return bank(ITEMS.RELIC);
    if (value.includes("if the player is not carrying the relic")) return !has(ITEMS.RELIC);
    if (value.includes("if the player is carrying the relic")) return has(ITEMS.RELIC);


    if (value.includes("without an ogre rockcake")) return !has(ITEMS.ROCK_CAKE);
    if (value.includes("with an ogre rockcake")) return has(ITEMS.ROCK_CAKE);
    if (value.includes("if the player doesn't have 20 coins")) return player.getInventory().getAmount(ITEMS.COINS) < 20;
    if (value.includes("if the player has 20 coins")) return player.getInventory().getAmount(ITEMS.COINS) >= 20;

    if (value.includes("if the player does not have a skavid map in their inventory or bank")) return !owns(player, ITEMS.MAP);
    if (value.includes("if the player has a skavid map in their bank")) return bank(ITEMS.MAP);
    if (value.includes("if the player has a skavid map in their inventory")) return has(ITEMS.MAP);
    if (value.includes("with a light source but no tinderbox")) return Darkness.hasLightSource(player) && !has(ITEMS.TINDERBOX);

    if (value.includes("if the player has the crystal on them")) return has(CRYSTAL_YELLOW);
    if (value.includes("if the player doesn't have the crystal")) return !owns(player, CRYSTAL_YELLOW);
    if (value.includes("if the crystal is stored somewhere")) return stepId === "Sm4F0t" ? bank(CRYSTAL_MAGENTA) : bank(CRYSTAL_YELLOW);
    // Wiki (Watchtower, Changes, 19 May 2021): re-obtainable "right up until the quest has been completed"; after it, "I haves no more".
    if (value.includes("if the player lost the crystal")) return !complete(player) && !owns(player, CRYSTAL_MAGENTA);
    if (value.includes("if the player has the crystal")) return complete(player) || has(CRYSTAL_MAGENTA);

    const kills = shamansDead(player);
    if (value.includes("after killing one shaman")) return kills === 1;
    if (value.includes("after killing two shamans")) return kills === 2;
    if (value.includes("after killing three shamans")) return kills === 3;
    if (value.includes("after killing four shamans")) return kills === 4;
    if (value.includes("after killing five shamans")) return kills === 5;
    if (value.includes("after killing the last shaman")) return kills >= MAX_SHAMANS && !owns(player, CRYSTAL_CYAN);
    // After the quest no crystal (Wiki); Ours: the "already have" message stands for it.
    if (value.includes("searching the shaman robe while already having the crystal")) return complete(player) || owns(player, CRYSTAL_CYAN);
    if (value.includes("searching the shaman robe while not having the crystal")) return !complete(player) && !owns(player, CRYSTAL_CYAN);

    if (value.includes("if the player has read the spell scroll")) return hasReadSpellScroll(player);
    if (value.includes("if the player has not read the spell scroll")) return !hasReadSpellScroll(player);
    if (value.includes("if the player lost the spell scroll")) return !owns(player, ITEMS.SCROLL);
    if (value.includes("if the player has the spell scroll")) return has(ITEMS.SCROLL);
    return null;
  }

  /** The conditions of Transcript:Watchtower revision 15399934 that are not in the older wording below. */
  function newConditions({ player, text, npcId }) {
    const value = String(text ?? "").toLowerCase();
    const has = (itemId) => held(player, itemId);
    const bush = searchingBush.get(player);
    if (value.includes("before starting the quest, the bush with the fingernails")) return stage(player) <= 0 && bush === ITEMS.FINGERNAILS;
    if (value.includes("before starting the quest")) return stage(player) <= 0 && (bush === undefined || bush !== ITEMS.FINGERNAILS);
    if (value.includes("the first time after starting the quest")) return stage(player) >= STAGES.STARTED;
    if (value.includes("looking at the broken bridge")) return false;
    if (value.includes("entering the tunnel")) return true;
    if (npcId === NPCS.OG && value.includes("if the player has the gold")) return has(ITEMS.GOLD);
    if (npcId === NPCS.OG && value === "otherwise:") return !has(ITEMS.GOLD);
    if (value.includes("the first part he takes")) return relicPartsHeld(player) === 1;
    if (value.includes("each later part")) return relicPartsHeld(player) >= 2;
    if (value === "the first time:") return state.get(player, VARBITS.GATE_CHAT_EAST) === 0 && !eastGateOpen(player);
    if (value.includes("afterwards, without a gold bar")) return state.get(player, VARBITS.GATE_CHAT_EAST) === 1 && !eastGateOpen(player) && !has(ITEMS.GOLD_BAR);
    if (value.includes("afterwards, with a gold bar")) return state.get(player, VARBITS.GATE_CHAT_EAST) === 1 && !eastGateOpen(player) && has(ITEMS.GOLD_BAR);
    if (value.includes("after giving him the gold")) return eastGateOpen(player);
    if (value.includes("with a relic part")) return ITEMS.RELIC_PARTS.some(has);
    if (value.includes("with nothing")) return !ITEMS.RELIC_PARTS.some(has);
    if (value.includes("after giving him the rock cake")) return state.hasBit(player, BITS.MARKET_GIVEN);
    if (value.includes("without an ogre rockcake")) return !has(ITEMS.ROCK_CAKE) && !state.hasBit(player, BITS.MARKET_GIVEN);
    if (value.includes("with an ogre rockcake")) return has(ITEMS.ROCK_CAKE) && !state.hasBit(player, BITS.MARKET_GIVEN);
    if (value.includes("with no space for the map")) {
      return player.getInventory().isFull() && player.getInventory().getAmount(ITEMS.DEATH_RUNE) !== 1;
    }
    if (value.includes("without the skavid map")) return !has(ITEMS.MAP);
    if (value.includes("without a light source or a tinderbox")) return !Darkness.hasLightSource(player) && !has(ITEMS.TINDERBOX);
    if (value.includes("before the scared skavid has taught")) return !state.hasBit(player, BITS.LEARNING_SKAVID);
    if (value.includes("searching the shaman robe before killing all the shamans")) return shamansDead(player) < MAX_SHAMANS;
    return null;
  }
  /** Which option the Rock of Dalgroth was clicked with, for its conditions. */

  // ------------------------------------------------------------------ lines: what live does as each shows

  /** The relic parts still to go to the wizard in this talk, in hand-in order. */
  const relicQueue = new WeakMap();
  /** A skavid word the player has just said right (the reply line confirms it). */

  const LINE = Object.freeze({
    START_SEARCH: "Try searching the surrounding area.",
    NAILS_THROWN: "You could start by checking out the ogre settlements around here.",
    DECOY: "I have this [robe/dagger/armour/eyepatch]...",
    OG_KEY: "Here is a key to the chest it's in.",
    OG_GOLD: "Well, well, the little t'ing has got it!",
    OG_PART_AGAIN: "Grrr, why do I bother?",
    OG_KEY_AGAIN: "Stoopid! Take another and don't lose it!",
    MAD_SKAVID_CRYSTAL_AGAIN: "Alright, take this one then...",
    GREW_CRYSTAL_AGAIN: "I suppose you want another?",
    GREW_PART_AGAIN: "Stupid morsel, I have another.",
    GORAD: "You shut your face! I smack you till you dead and sorry!",
    RELIC_FIRST: "Ah, it's part of an old ogre statue.",
    RELIC_MORE: "Ah, it's more of that old ogre statue.",
    RELIC_ASSEMBLE: "Well, if you ever want to make friends with an ogre",
    NORTH_WEST_STOP: "Stop, creature! Only ogres and their friends allowed in this city.",
    NORTH_WEST_WELCOME: "It's got the statue of Dalgroth.",
    NORTH_WEST_PASS: "It's the small creature; you may pass.",
    EAST_ASKS: "You will be my friend only with gold.",
    EAST_TAKES: "It's brought it! On your way.",
    EAST_PASS: "I know you, creature; you may pass.",
    GIFT_ASKED: "Prove it to us with a gift.",
    CAKE_TAKEN: "Well, well, look at this. My favourite: rock cake!",
    RIDDLE: "I want you to bring me an item: I will give you all the letters of this item",
    SKAVID_TEACH: "You will have to learn skavid, otherwise they will not talks to you.",
    SKAVID_SHOUT: "You shut your mouth! Don't tell them anything!",
    SKAVID_CRY: "Tanath cur, tanath cur!",
    MAD_SKAVID_CRYSTAL: "The others are with the shamans in the enclave",
    NIGHTSHADE: "What is this? Arrrrgh! I cannot stand this plant!",
    RECIPE: "Collect a guam leaf, add jangerberries, then mix in some ground bat bones.",
    INFUSE: "That's great news; let me infuse it with magic...",
    INFUSED: "Here it is - a dangerous substance.",
    PILLARS: "Put the crystals on the pillars there and throw the lever",
    WOW_TUNNEL: "Wow! That tunnel went a long way.",
  });
  const starts = (request, line) => String(request.text ?? "").startsWith(line);

  function onLine(request) {
    const { player } = request;
    if (!player || !request.pages?.some((entry) => entry.page === PAGE || entry.page === GUARD_PAGE)) return;
    const npc = request.npc;
    // The start: the stage moves as the wizard sends the player searching (t215).
    if (starts(request, LINE.START_SEARCH)) {
      request.before = () => startQuest(player);
      return;
    }
    if (starts(request, LINE.NAILS_THROWN)) {
      request.before = () => {
        if (stage(player) !== STAGES.STARTED || !held(player, ITEMS.FINGERNAILS)) return;
        take(player, ITEMS.FINGERNAILS);
        state.setStage(player, STAGES.FINGERNAILS);
      };
      return;
    }
    if (request.text === LINE.DECOY) {
      const decoy = DECOYS.find(([itemId]) => held(player, itemId));
      if (decoy) request.text = `I have this ${decoy[1]}...`;
      return;
    }
    if (starts(request, LINE.OG_KEY)) {
      request.before = () => {
        state.setBit(player, BITS.SPOKEN_OG);
        give(player, ITEMS.KEY);
      };
      return;
    }
    if (starts(request, LINE.OG_GOLD)) {
      request.before = () => {
        if (!held(player, ITEMS.GOLD)) return;
        take(player, ITEMS.GOLD);
        give(player, ITEMS.RELIC_PARTS[0]);
        state.setBit(player, BITS.HELPED_OG);
      };
      return;
    }
    if (starts(request, LINE.OG_KEY_AGAIN)) {
      request.before = () => give(player, ITEMS.KEY);
      return;
    }
    if (starts(request, LINE.MAD_SKAVID_CRYSTAL_AGAIN)) {
      request.before = () => give(player, CRYSTAL_MAGENTA);
      return;
    }
    if (starts(request, LINE.OG_PART_AGAIN)) {
      request.before = () => give(player, ITEMS.RELIC_PARTS[0]);
      return;
    }
    if (starts(request, LINE.GREW_CRYSTAL_AGAIN)) {
      request.before = () => give(player, CRYSTAL_YELLOW);
      return;
    }
    if (starts(request, LINE.GREW_PART_AGAIN)) {
      request.before = () => give(player, ITEMS.RELIC_PARTS[1]);
      return;
    }
    if (request.text === LINE.GORAD) {
      // Wiki: "Talk to him and tell him that you have come to knock his teeth out. He will attack you."
      request.after = () => attack(npc, player);
      return;
    }
    if (starts(request, LINE.RELIC_FIRST) || starts(request, LINE.RELIC_MORE)) {
      request.before = () => handInNextPart(player);
      return;
    }
    if (starts(request, LINE.RELIC_ASSEMBLE)) {
      // The wizard works the parts together for three ticks under an empty box (t2037-2040).
      request.pauseTicks = 3;
      request.after = () => scenes.assembleRelic(player, npc);
      return;
    }
    if (starts(request, LINE.NORTH_WEST_STOP)) {
      request.before = () => state.set(player, VARBITS.GATE_CHAT_NORTH_WEST, 1);
      return;
    }
    if (starts(request, LINE.NORTH_WEST_WELCOME)) {
      request.before = () => {
        if (!held(player, ITEMS.RELIC)) return;
        take(player, ITEMS.RELIC);
        state.set(player, VARBITS.GATE_CHAT_NORTH_WEST, 1);
        state.advance(player, STAGES.GUTANOTH);
      };
      request.after = () => walkThroughGate(player, NORTH_WEST_GATE);
      return;
    }
    if (request.text === LINE.NORTH_WEST_PASS) {
      request.after = () => walkThroughGate(player, NORTH_WEST_GATE);
      return;
    }
    if (starts(request, LINE.EAST_ASKS)) {
      request.before = () => state.set(player, VARBITS.GATE_CHAT_EAST, 1);
      return;
    }
    if (request.text === LINE.EAST_TAKES || request.text === LINE.EAST_PASS) {
      if (request.text === LINE.EAST_TAKES) request.before = () => {
        if (!held(player, ITEMS.GOLD_BAR)) return;
        take(player, ITEMS.GOLD_BAR);
        state.setBit(player, BITS.EAST_GATE_PAID);
      };
      request.after = () => walkThroughGate(player, EAST_GATE);
      return;
    }
    if (starts(request, LINE.GIFT_ASKED)) {
      request.before = () => state.set(player, VARBITS.GATE_CHAT_BATTLEMENT, 1);
      return;
    }
    if (starts(request, LINE.CAKE_TAKEN)) {
      request.before = () => {
        if (!held(player, ITEMS.ROCK_CAKE)) return;
        take(player, ITEMS.ROCK_CAKE);
        state.setBit(player, BITS.MARKET_GIVEN);
      };
      return;
    }
    if (starts(request, LINE.RIDDLE) && stage(player) === STAGES.GUTANOTH) {
      request.before = () => {
        state.set(player, VARBITS.PUZZLE, 1);
        state.advance(player, STAGES.RIDDLE);
      };
      return;
    }
    if (starts(request, LINE.SKAVID_TEACH)) {
      // The chat closes; a hidden ogre strikes the skavid and is gone again (t2995-3001).
      request.pauseTicks = 6;
      request.after = () => scenes.silenceSkavid(player, npc, LINE.SKAVID_SHOUT, LINE.SKAVID_CRY);
      return;
    }
    if ((request.text === LINE.SKAVID_SHOUT || request.text === LINE.SKAVID_CRY) && request.step?.presentation === "overhead") {
      request.skip = true;
      return;
    }
    if (starts(request, LINE.MAD_SKAVID_CRYSTAL)) {
      request.before = () => {
        give(player, CRYSTAL_MAGENTA);
        state.advance(player, STAGES.SKAVID_CRYSTAL);
      };
      return;
    }
    if (starts(request, LINE.RECIPE)) {
      request.before = () => state.advance(player, STAGES.RECIPE);
      return;
    }
    if (request.text === LINE.INFUSE) {
      // "The wizard mutters strange words over the liquid..." as the chat closes; the potion four ticks on (t5446-5450).
      request.pauseTicks = 4;
      request.after = () => player.sendMessage("The wizard mutters strange words over the liquid...");
      return;
    }
    if (starts(request, LINE.INFUSED)) {
      request.before = () => {
        if (!held(player, ITEMS.POTION)) return;
        take(player, ITEMS.POTION);
        give(player, ITEMS.MAGIC_POTION);
        state.advance(player, STAGES.MAGIC_POTION);
      };
      return;
    }
    if (starts(request, LINE.PILLARS)) {
      request.before = () => state.advance(player, STAGES.ALL_CRYSTALS);
      return;
    }
    skavidLine(request);
  }

  /**
   * The skills are not needed to start (Wiki: every requirement "[not required to start]", "[boostable]"); each step
   * checks its own (the trellis, the cake, the rock, the potion).
   */
  function startQuest(player) {
    if (stage(player) >= STAGES.STARTED) return;
    state.setStage(player, STAGES.STARTED);
    player.sendMessage(questStartMessage(player, "Watchtower"));
  }

  function handInNextPart(player) {
    const queue = relicQueue.get(player) ?? [];
    const index = queue.shift();
    if (index === undefined) return;
    const itemId = ITEMS.RELIC_PARTS[index];
    if (!held(player, itemId) || state.hasBit(player, BITS.RELIC[index])) return;
    take(player, itemId);
    state.setBit(player, BITS.RELIC[index]);
  }

  // ------------------------------------------------------------------ the skavids

  /** The teaching skavids' lines: the game messages live sends around them (t3047-3211). */
  /**
   * The teaching skavids. The Wiki (with the capture's lines in capture-sources) carries their messages; the plugin
   * marks the word learned as the right reply shows, and gives the shared sections the skavid's own phrase.
   */
  function skavidLine(request) {
    const { player } = request;
    const skavid = W.SKAVIDS.get(request.npcId);
    if (!skavid) return;
    const steps = variantSteps(PAGE, skavid.variant) ?? [];
    // "Before the scared skavid has taught the player any words" is written for Skavid 1 ("Bidith tanath...").
    if (!state.hasBit(player, BITS.LEARNING_SKAVID) && request.step?.type === "line" && request.text === "Bidith tanath...") {
      request.text = steps[0]?.text ?? request.text;
      return;
    }
    const answer = steps.find((step) => step.type === "choice")?.options?.find((option) => option.text === skavid.word)?.steps ?? [];
    const reply = answer.find((step) => step.type === "line")?.text;
    if (reply && request.text === reply) request.before = () => state.setBit(player, skavid.bit);
  }

  /** The "already talked" line: Skavid 1's "Cur tanath!" (t3052); Ours: the others say nothing but the message. */
  const SKAVID_AGAIN_LINE = new Map([[4378, "Cur tanath!"]]);

  function talkSkavid(event) {
    const { player, npcId, npc } = event;
    const skavid = W.SKAVIDS.get(npcId);
    if (!skavid || stage(player) < STAGES.MAP) return false;
    if (!state.hasBit(player, BITS.LEARNING_SKAVID)) {
      play(player, npcId, "skavid-search-learning-skavid", null, PAGE, npc);
      return true;
    }
    if (state.hasBit(player, skavid.bit)) {
      const again = SKAVID_AGAIN_LINE.get(npcId);
      play(player, npcId, "skavid-search-learning-skavid-talking-to-a-skavid-again",
        (steps) => again ? steps : steps.filter((step) => step.type !== "line"), PAGE, npc);
      return true;
    }
    return false;
  }
  const SKAVID_AGAIN_PLACEHOLDER = "[Cur tanath!/Gor nod!/...]";
  function skavidAgainLine(request) {
    const again = SKAVID_AGAIN_LINE.get(request.npcId);
    if (again && request.text === SKAVID_AGAIN_PLACEHOLDER) request.text = again;
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player) return;
    const text = String(option ?? "");
    caveChoice(event);
    if (npcId === NPCS.TOBAN && text === "I could do something for you...") state.setBit(player, BITS.SPOKEN_TOBAN);
    else if (npcId === NPCS.GREW && text === "Don't eat me; I can help you.") state.setBit(player, BITS.SPOKEN_GREW);
    else if (npcId === NPCS.SCARED_SKAVID && text === "Okay, okay, I'm not going to hurt you.") state.setBit(player, BITS.LEARNING_SKAVID);
    else if (npcId === NPCS.TOBAN && text === "I can't find the relic part you gave me.") {
      // Ours: the Wiki has only the "you lie to me" answer; a lost part comes back without a word.
      // A tick on, after the Wiki's "if the player has the relic part" branch has been judged (no liar line).
      if (!owns(player, ITEMS.RELIC_PARTS[2]) && state.hasBit(player, BITS.HELPED_TOBAN) && !state.hasBit(player, BITS.RELIC[2])) {
        later(player, 1, () => give(player, ITEMS.RELIC_PARTS[2]));
      }
    }
  }

  // ------------------------------------------------------------------ dialogue actions and messages

  /** The dump's message steps that hand items over, as item boxes (t1405-6066). */
  const ITEM_MESSAGES = new Map([
    ["0-eoVh", (player) => { // Toban: "The ogre gives you part of a statue."
      take(player, ITEMS.DRAGON_BONES);
      give(player, ITEMS.RELIC_PARTS[2]);
      state.setBit(player, BITS.HELPED_TOBAN);
      return [ITEMS.RELIC_PARTS[2]];
    }],
    ["qdm4Oz", () => null], // Toban's chest: the chest opens it (openTobanChest)
    ["EGhmsB", () => [ITEMS.RELIC_PARTS[0]]], // Og: the part went with his line
    ["g2LcFM", (player) => { // Grew: the part and the yellow crystal
      take(player, ITEMS.TOOTH);
      give(player, ITEMS.RELIC_PARTS[1]);
      // The tooth frees one slot for two items: with a full pack the crystal goes under the player, not nowhere.
      if (!held(player, CRYSTAL_YELLOW)) giveReward(player, CRYSTAL_YELLOW, 1);
      state.setBit(player, BITS.HELPED_GREW);
      return [ITEMS.RELIC_PARTS[1], CRYSTAL_YELLOW];
    }],
    ["kS6m_z", (player) => { // the wizard's relic
      if (stage(player) !== STAGES.FINGERNAILS || relicPartsHeld(player) < 3) return null;
      give(player, ITEMS.RELIC);
      state.setStage(player, STAGES.RELIC);
      return [ITEMS.RELIC];
    }],
    ["KRA6Uf", (player) => { give(player, ITEMS.RELIC); return [ITEMS.RELIC]; }], // "The wizard gives you another statue."
    ["WGTZbp", () => [ITEMS.ROCK_CAKE]], // "You offer the guard a rock cake." (the cake goes with his next line)
    ["WySYmL", (player) => { // the death rune for the map
      take(player, ITEMS.DEATH_RUNE);
      give(player, ITEMS.MAP);
      state.advance(player, STAGES.MAP);
      return [ITEMS.MAP];
    }],
    ["F_ChuY", (player) => { give(player, ITEMS.MAP); return [ITEMS.MAP]; }], // "The guard gives you another map."
    ["-ZqDtE", () => [CRYSTAL_MAGENTA]], // the mad skavid (the crystal went with his line)
    ["KXRXHc", (player) => { // the last shaman's crystal
      give(player, CRYSTAL_CYAN);
      return [CRYSTAL_CYAN];
    }],
    ["LGWwUr", () => [ITEMS.SHAMAN_ROBE, CRYSTAL_CYAN]], // the robe, already holding the crystal
    ["BOIu3d", (player) => { give(player, CRYSTAL_CYAN); return [ITEMS.SHAMAN_ROBE, CRYSTAL_CYAN]; }],
    ["55Yxf-", () => [CRYSTAL_GREY]], // the rock's crystal (mineRock gives it)
  ]);
  /** Messages the plugin sends itself, or that end the conversation. */
  const SELF_MESSAGES = new Set(["Hc4rny", "QGCKsr", "qpwWbO", "VSYvDt", "EAAUUD", "UT4_jQ", "Z7N4ZW", "zrDead"]);

  function handleMessage(event) {
    const { player, stepId } = event;
    const handOut = ITEM_MESSAGES.get(stepId);
    if (handOut) {
      const items = handOut(player);
      if (items) event.box = { items };
      return;
    }
    if (SHAMAN_BLASTS.has(stepId)) {
      damage(player, SHAMAN_BLASTS.get(stepId));
      return;
    }
    if (stepId === "a11a16") { // City guard: "You are under attack!"
      attack(event.npc, player);
      return;
    }
    if (SELF_MESSAGES.has(stepId)) {
      event.handled = true;
      event.end = true;
    }
  }

  /** Wiki: talking to a shaman costs 20 Hitpoints, attacking one 30 ("A magic blast comes from the shaman..."). */
  const SHAMAN_BLASTS = new Map([["kRiiBJ", 20], ["MPH1Oe", 30]]);
  const ATTACKS = new Set(["7Todw2", "fPxWjU", "0AF8qI", "n72ZBl", "qS75F0", "LvlTzx", "WdYOsW"]);
  const PUSHBACKS = new Set(["ECbzBh", "yOnYb4"]);

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId || !event.pages?.some((entry) => entry.page === PAGE || entry.page === GUARD_PAGE)) return;
    if (caveAnswer(event)) {
      event.handled = true;
      return;
    }
    if (event.kind === "message") {
      handleMessage(event);
      return;
    }
    if (ATTACKS.has(stepId)) {
      event.handled = true;
      // Og's and Grew's "Guards!": one of their ogres comes for the player (t1053, t1226).
      const attacker = stepId === "7Todw2" || stepId === "fPxWjU"
        ? nearestNpc(player, (npc) => npc.getDefinition?.()?.getName?.() === "Ogre")
        : event.npc;
      attack(attacker, player);
      return;
    }
    if (PUSHBACKS.has(stepId)) {
      // Wiki: "pushes you back down the hill, stunning you and dealing 3 damage". Ours: no capture says where to.
      event.handled = true;
      damage(player, 3);
      return;
    }
    if (stepId === "rEZMuS") { // the toll paid: the jump
      event.handled = true;
      payToll(player);
      return;
    }
    if (stepId === "DdGVML") { // "(The gate opens and the player walks through)": the line's `after` walks (t2222-2230)
      event.handled = true;
      return;
    }
    if (stepId === "ZA8RuD") { // "Gorad hits the player for 12 damage."
      event.handled = true;
      event.npc?.performAnimation?.(new Animation(359));
      damage(player, 12);
      return;
    }
    if (stepId === "-QBFep" || stepId === "IAWRsb" || stepId === "dQ-zw3" || stepId === "C8UbfC" || stepId === "Xje1jx"
      || stepId === "Bt1nR2" || stepId === "h6thcG") {
      event.handled = true;
      if (stepId === "IAWRsb") give(player, ITEMS.SCROLL);
      else if (stepId === "-QBFep") give(player, ITEMS.MAP);
      else {
        const itemId = { "dQ-zw3": ITEMS.FINGERNAILS, "C8UbfC": ITEMS.OLD_ROBE, "Xje1jx": ITEMS.UNUSUAL_ARMOUR,
          "Bt1nR2": ITEMS.DAMAGED_DAGGER, "h6thcG": ITEMS.EYE_PATCH }[stepId];
        give(player, itemId);
      }
      return;
    }
    if (["dd7KHH", "v-vEZl", "ATVVrG", "wq3K7d", "tTts4h"].includes(stepId)) event.handled = true;
  }

  // ------------------------------------------------------------------ the Watchtower

  /** The ground floor's ladder: the guards keep it until the quest starts, and wave the player up once (t255-259). */
  function climbTowerLadder(event) {
    const { player, object } = event;
    if (event.objectId !== LOCS.TOWER_LADDER || object?.getLocation?.().getX() !== 2544 || object.getLocation().getY() !== 3111) return;
    event.handled = true;
    // The Wiki's "Attempting to climb the ladder": refused before the quest; waved up the first time after it.
    if (stage(player) <= 0) {
      play(player, NPCS.TOWER_GUARD, "getting-started-attempting-to-climb-the-ladder");
      return;
    }
    if (state.get(player, VARBITS.GUARD) === 0) {
      state.set(player, VARBITS.GUARD, 1);
      play(player, NPCS.TOWER_GUARD, "getting-started-attempting-to-climb-the-ladder");
      climbAfterChat(player, TILES.TOWER_FIRST_FLOOR);
      return;
    }
    climbTo(player, TILES.TOWER_FIRST_FLOOR);
  }

  /** The climb: seq 828 and the floor a tick later (t2017-2018). */
  function climbTo(player, tile) {
    api.emitCustomEvent("ladders:climbUp", { player, destination: new Location(tile[0], tile[1], tile[2]) });
  }
  /** Climbs once the guard's line is continued (t258-259). */
  function climbAfterChat(player, tile) {
    let ticks = 0;
    const from = player.getLocation().clone();
    const task = new core.Task(1, false);
    task.execute = () => {
      if (!player.isRegistered?.() || ++ticks > 100) { task.stop(); return; }
      // Walking off during the line (or after it) leaves the player where they went.
      if (!player.getLocation().equals(from)) { task.stop(); return; }
      if (player.getDialogueManager().isActive?.()) return;
      task.stop();
      climbTo(player, tile);
    };
    api.getTaskManager().submit(task);
  }

  /** The completed tower's top floor is the copy the lever moved the player to (Wiki: "the instanced version"). */
  function climbToTopFloor(event) {
    const { player, object } = event;
    if (event.objectId !== LOCS.TOP_LADDER_UP || !complete(player)) return;
    const at = object?.getLocation?.();
    if (!at || at.getX() !== 2549 || at.getY() !== 3111 || at.getZ() !== 1) return;
    event.handled = true;
    climbTo(player, TILES.TOP_FLOOR_COPY_LADDER);
  }

  function claimLadder(event) {
    if (event.objectId === LOCS.TOWER_LADDER) climbTowerLadder(event);
    else if (event.objectId === LOCS.TOP_LADDER_UP) climbToTopFloor(event);
    else if (event.objectId === LOCS.TOBAN_LADDER) {
      event.handled = true;
      tobanLadder(event.player);
    }
  }

  /** The trellis: the two messages and the climb, then the first floor and 31 Agility XP two ticks later (t330-332; Wiki). */
  function climbTrellis({ player }) {
    if (level(player, Skill.AGILITY) < 18) {
      // Ours: the requirement is the Wiki's; no capture shows the refusal.
      player.sendMessage("You need an Agility level of 18 to climb this wall.");
      return true;
    }
    if (ObstacleRunner.isBusy(player)) return true;
    ObstacleRunner.run({ player }, [
      { msg: "You climb up the wall..." }, { msg: "...and squeeze in through the window." }, { anim: SEQ.CLIMB },
      { wait: 2 }, { tele: [...TILES.TRELLIS_TOP] }, { run: () => player.getSkillManager().addExperiences(Skill.AGILITY, 31) },
    ]);
    return true;
  }

  /** A bush: the search animation and the Wiki's line at once (t284-588). */
  const searchingBush = new WeakMap();
  function searchBush(event) {
    const { player, objectId } = event;
    if (!LOCS.BUSHES.has(objectId)) return false;
    // Before the quest the Wiki's "Before starting the quest" lines play (the fingernails' bush says it overhead).
    player.performAnimation(new Animation(SEQ.SEARCH_BUSH));
    searchingBush.set(player, LOCS.BUSHES.get(objectId));
    play(player, NPCS.TOWER_GUARD, "searching-for-evidence-searching-the-bushes");
    later(player, 1, () => searchingBush.delete(player));
    return true;
  }

  // ------------------------------------------------------------------ the wizard's relic

  /** The relic hand-in as live plays it: each part with the wizard's line, then the assembly (t2026-2040). */
  function relicSteps(player) {
    const variant = "ogre-investigations-assembling-the-relic";
    const partLines = ["c6SUn4", "XLwHKL", "Dp7Zpc"].map((id) => conditionSteps(PAGE, variant, id));
    const first = conditionSteps(PAGE, variant, "SjAiJr");
    const more = conditionSteps(PAGE, variant, "uNxIgi");
    const done = conditionSteps(PAGE, variant, "HQGBKU");
    const queue = [];
    const steps = [];
    let count = relicPartsHeld(player);
    ITEMS.RELIC_PARTS.forEach((itemId, index) => {
      if (state.hasBit(player, BITS.RELIC[index]) || !held(player, itemId)) return;
      queue.push(index);
      steps.push(...partLines[index], ...(++count === 1 ? first : more));
    });
    if (count === ITEMS.RELIC_PARTS.length) steps.push(...done);
    // Wiki: "If any are still missing, the conversation then carries on as above ("How's it going?")".
    else if (steps.length) steps.push(...(variantSteps(PAGE, "ogre-investigations-talking-to-the-watchtower-wizard") ?? []));
    return { steps, queue };
  }

  function startRelicTalk(player, npc) {
    const { steps, queue } = relicSteps(player);
    if (!steps.length) return false;
    relicQueue.set(player, queue);
    play(player, NPCS.WIZARD, "ogre-investigations-assembling-the-relic", () => steps, PAGE, npc);
    return true;
  }

  function talkWizard(event) {
    const { player, npcId, npc } = event;
    if (npcId !== NPCS.WIZARD || stage(player) !== STAGES.FINGERNAILS) return false;
    // A part to hand in, or all three already with him (a talk cut short before the relic): he finishes it.
    const toHandIn = ITEMS.RELIC_PARTS.some((itemId, index) => held(player, itemId) && !state.hasBit(player, BITS.RELIC[index]));
    if (!toHandIn && relicPartsHeld(player) < ITEMS.RELIC_PARTS.length) return false;
    return startRelicTalk(player, npc);
  }

  // ------------------------------------------------------------------ Og, Grew, Toban and Gorad

  /** The rope swing to Grew's island (t1192-1197) and back (t1254-1262). */
  function crossGrewRiver(event, entering) {
    const { player, object } = event;
    if (!object) return;
    const at = object.getLocation();
    const x = entering ? 2499 : 2511, y = entering ? 3087 : 3090;
    if (at.getX() !== x || at.getY() !== y || at.getZ() !== 0) return;
    event.handled = true;
    const from = player.getLocation();
    if (ObstacleRunner.isBusy(player) || from.getZ() !== 0 || (entering ? from.getX() > 2501 : from.getY() > 3092)) return;
    if (entering && !held(player, I.ROPE)) return;
    const start = entering ? [2501, 3087] : [2511, 3091];
    if (Math.max(Math.abs(from.getX() - start[0]), Math.abs(from.getY() - start[1])) > 3) return;
    const end = entering ? [2505, 3087] : [2511, 3096];
    const roped = new core.GameObject(LOCS.ROPE_SWING_ROPED, at.clone(), object.getType(), object.getFace(), player.getPrivateArea());
    let task;
    let ropeConsumed = false;
    const steps = [{ walk: [start], arrive: true }, { faceDir: entering ? "east" : "north" }];
    if (entering) steps.push(
      { msg: "You tie the rope to the tree..." }, { anim: SEQ.ROPE_THROW }, { wait: 1 },
      { run: () => {
        if (!held(player, I.ROPE)) { task.stop(); return; }
        take(player, I.ROPE);
        ropeConsumed = true;
        player.getPacketSender().sendObject(roped);
      } },
      { wait: 1 }
    );
    steps.push(
      { objAnim: SEQ.ROPE_SWING_LOC },
      { move: end, anim: SEQ.ROPE_SWING, delay: 20, speed: [45, 70], dir: entering ? "east" : "north", ticks: 0 },
      { wait: 1 }, { msg: "You skillfully swing across." }, { sound: SOUND.ROPE_SWING },
      // The swing back gives 3 Agility XP with its message (t1262, t1784); the swing over gives none (t1197).
      ...(entering ? [] : [{ run: () => player.getSkillManager().addExperiences(Skill.AGILITY, 3) }]),
      { wait: 2 }, { tele: end }
    );
    task = ObstacleRunner.run({ player, object: entering ? roped : object }, steps, {
      onFinish: (completed) => {
        if (!entering) return;
        if (completed && !ropeConsumed) {
          if (held(player, I.ROPE)) take(player, I.ROPE);
          else player.moveTo(new Location(start[0], start[1], 0));
        }
        player.getPacketSender().sendObject(object);
      },
    });
  }

  /** Toban's tunnel: "You enter the cave.", the island and the player's line, together (t1359). */
  function enterTobanCave({ player }) {
    player.moveTo(new Location(...TILES.TOBAN_ISLAND));
    play(player, NPCS.TOBAN, "ogre-investigations-toban-toban-s-island",
      () => conditionSteps(PAGE, "ogre-investigations-toban-toban-s-island", "6oNe9n"));
    return true;
  }

  /** Toban's ladder: the message and the tunnel's mouth on the same tick (t1525). */
  function tobanLadder(player) {
    player.sendMessage("You climb down the ladder.");
    player.moveTo(new Location(...TILES.TOBAN_TUNNEL_OUTSIDE));
  }

  /** Toban's chest: the key turns (seq 832, sound 2419), the gold a tick later in a box (t1509-1515). */
  function openTobanChest({ player }) {
    if (!held(player, ITEMS.KEY)) {
      play(player, NPCS.TOBAN, "ogre-investigations-toban-looting-toban-s-chest");
      return true;
    }
    if (ObstacleRunner.isBusy(player)) return true;
    player.performAnimation(new Animation(SEQ.CHEST, 5));
    sound(player, SOUND.UNLOCK, 10);
    player.getMovementQueue().reset();
    later(player, 1, () => {
      if (!held(player, ITEMS.KEY)) return;
      take(player, ITEMS.KEY);
      give(player, ITEMS.GOLD);
      sound(player, SOUND.CHEST_OPEN);
      sound(player, SOUND.CHEST_CLOSE, 60);
      const text = messageText("ogre-investigations-toban-looting-toban-s-chest", "qdm4Oz") ?? "You find a stash of gold inside.";
      itemBox(player, text, ITEMS.GOLD);
    });
    return true;
  }

  /** Gorad's tooth, three ticks after his death, in a box (t1493-1496). */
  function handleNpcDeath({ killer, npc, npcId }) {
    if (!killer || npcId !== NPCS.GORAD) return;
    const value = stage(killer);
    if (value < STAGES.FINGERNAILS || value >= STAGES.RELIC || state.hasBit(killer, BITS.HELPED_GREW)) return;
    later(killer, 3, () => {
      // Wiki: keep a slot free for the tooth, "or you will have to kill him again".
      if (held(killer, ITEMS.TOOTH) || killer.getInventory().isFull()) return;
      give(killer, ITEMS.TOOTH);
      state.set(killer, VARBITS.TOOTH_GOT, 1);
      const text = messageText("ogre-investigations-grew-facing-gorad", "Hc4rny") ?? "He's dropped a tooth. You grab it quickly.";
      itemBox(killer, text, ITEMS.TOOTH);
    });
  }

  // ------------------------------------------------------------------ Gu'Tanoth

  const EAST_GATE = { leaf: [LOCS.EAST_GATE[1], 2549, 3028], inside: [2549, 3028] };
  const NORTH_WEST_GATE = { leaf: [LOCS.NORTH_WEST_GATE[0], 2504, 3062], inside: [2504, 3062] };
  /** The east guards let the player by once paid (Wiki: the gold bar is needed; "use the gold bar on one of the guards"). */
  const eastGateOpen = (player) => state.hasBit(player, BITS.EAST_GATE_PAID);

  /** After the guard's line the player walks to the gate, which opens and shuts behind them (t2222-2230, t2314-2321). */
  function walkThroughGate(player, gate) {
    const [id, x, y] = gate.leaf;
    const object = core.MapObjects.get(id, new Location(x, y, 0), null);
    if (!object) return;
    const queue = player.getMovementQueue();
    queue.reset();
    queue.addSteps(new Location(gate.inside[0], gate.inside[1], 0));
    let ticks = 0;
    const task = new core.Task(1, false);
    task.execute = () => {
      if (!player.isRegistered?.() || ++ticks > 12) { task.stop(); return; }
      if (!near(player, gate.inside, 0) && (queue.size?.() ?? 0) > 0) return;
      task.stop();
      if (near(player, gate.inside, 1)) api.emitCustomEvent("door:open", { player, object, handled: false });
    };
    api.getTaskManager().submit(task);
  }

  /**
   * Open on a city gate (Doors has no "City gate" name: the cache uses it elsewhere): the guards' say decides, then the
   * pass-through opening through door:open (t3257-3285); refused, the guards talk (t2207).
   */
  function openCityGate(event) {
    const { player, objectId, object } = event;
    const east = LOCS.EAST_GATE.includes(objectId);
    if (!east && !LOCS.NORTH_WEST_GATE.includes(objectId)) return false;
    if (cityGate({ player, objectId }) || !object) return true;
    api.emitCustomEvent("door:open", { player, object, handled: false });
    return true;
  }

  /** Who may pass a city gate; the others hear the guards (t2207, t3257-3285). Returns whether it refused. */
  function cityGate(request) {
    const { player, objectId } = request;
    const east = LOCS.EAST_GATE.includes(objectId);
    if (!east && !LOCS.NORTH_WEST_GATE.includes(objectId)) return false;
    const allowed = complete(player) || (east ? eastGateOpen(player) : stage(player) >= STAGES.GUTANOTH);
    if (allowed) return false;
    request.handled = true;
    // Transcript:Watchtower, "Entering Gu'Tanoth": "A nearby guard calls you over."
    player.sendMessage("A nearby guard calls you over.");
    const guard = nearestNpc(player, (npc) => npc.getId() === (east ? NPCS.EAST_GUARD : NPCS.NORTH_WEST_GUARD), 8);
    if (east) talkEastGuard({ player, npc: guard });
    else talkNorthWestGuard({ player, npc: guard, npcId: NPCS.NORTH_WEST_GUARD });
    return true;
  }

  /** The east guards: the Watchtower page's "East gate guard". */
  function talkEastGuard({ player, npc }) {
    play(player, NPCS.EAST_GUARD, "entering-gu-tanoth-east-gate-guard", null, PAGE, npc);
    return true;
  }

  /**
   * The north-west guards: once through, their pass line (t3410); before, the Watchtower page's
   * "City guard", where the first stop is said even with the relic in the pack (t2308-2314).
   */
  function talkNorthWestGuard({ player, npc }) {
    if (stage(player) >= STAGES.GUTANOTH || complete(player)) {
      play(player, NPCS.NORTH_WEST_GUARD, "entering-gu-tanoth-city-guard-talking-to-the-city-guard-after-giving-him-the-relic", null, PAGE, npc);
      return true;
    }
    const variant = "entering-gu-tanoth-city-guard";
    const carrying = held(player, ITEMS.RELIC);
    const first = state.get(player, VARBITS.GATE_CHAT_NORTH_WEST) === 0;
    // With the relic, only the Wiki's "carrying the relic" branch (live also played the stop lines first, t2308-2314).
    if (carrying || first) {
      play(player, NPCS.NORTH_WEST_GUARD, variant, null, PAGE, npc);
      return true;
    }
    play(player, NPCS.NORTH_WEST_GUARD, "entering-gu-tanoth-city-guard-talking-to-the-city-guard-again", null, PAGE, npc);
    return true;
  }

  /** Talking to the battlement guards (OGRE_GUARD_6). */
  function talkBattlementGuard({ player, npc }) {
    play(player, NPCS.BATTLEMENT_GUARD, battlementGuardVariant(player), null, PAGE, npc);
    return true;
  }

  /** The rock cake stall: one cake a click (t2355, t2372). */
  /** Players whose counter is empty: empty_rock_cake_counter (2792) for 12 ticks (Wiki: 7.2 seconds; live 11, t2356-2367). */
  const emptyCounter = new WeakSet();
  function stealRockCake({ player, object }) {
    // Wiki (Rock cake): "Rock cakes cannot be gained until the relevant part of the Watchtower quest." Ours: no message.
    if (stage(player) < STAGES.GUTANOTH && !complete(player)) return true;
    if (emptyCounter.has(player)) {
      player.sendMessage("Nothing interesting happens."); // the empty counter's answer (t2359)
      return true;
    }
    if (level(player, Skill.THIEVING) < 15) {
      player.sendMessage("You need a Thieving level of at least 15 to steal a rock cake."); // Ours: Wiki requirement
      return true;
    }
    if (!player.getClickDelay().elapsedTime(1000)) return true;
    if (player.getInventory().isFull()) {
      player.getInventory().full();
      return true;
    }
    player.getClickDelay().reset();
    player.getInventory().adds(ITEMS.ROCK_CAKE, 1);
    player.getSkillManager().addExperiences(Skill.THIEVING, 6.4);
    player.sendMessage("You cautiously grab a cake from the stall.");
    if (object) {
      const empty = new core.GameObject(LOCS.CAKE_COUNTER_EMPTY, object.getLocation().clone(), object.getType(), object.getFace(), player.getPrivateArea());
      emptyCounter.add(player);
      player.getPacketSender().sendObject(empty);
      later(player, 12, () => {
        emptyCounter.delete(player);
        player.getPacketSender().sendObject(object);
      });
    }
    return true;
  }

  /**
   * The battlement: from outside only once the guards have their cake; the climb two ticks after
   * arriving, seq 839 and sound 2453 with the move (t2465-2467, back at t6241-6248).
   */
  function climbBattlement(event) {
    const { player, object } = event;
    const at = object?.getLocation?.();
    if (!at || at.getX() !== 2507 || at.getZ() !== 0) return false;
    if (ObstacleRunner.isBusy(player)) return true;
    const from = player.getLocation();
    const fromWest = from.getX() < 2507;
    // After the quest "a rock cake and a death rune are no longer necessary" (Wiki, Skavid map).
    if (fromWest && !complete(player) && !state.hasBit(player, BITS.MARKET_GIVEN)) {
      const guard = nearestNpc(player, (npc) => npc.getId() === NPCS.BATTLEMENT_GUARD, 8);
      return talkBattlementGuard({ player, npc: guard });
    }
    const y = Math.min(3012, Math.max(3011, from.getY()));
    const start = [fromWest ? 2506 : 2508, y];
    const end = [fromWest ? 2508 : 2506, y];
    ObstacleRunner.run({ player, object }, [
      { walk: [start], arrive: true }, { wait: 2 },
      { move: end, anim: SEQ.BATTLEMENT, delay: 30, speed: [30, 90], dir: fromWest ? "east" : "west", ticks: 2 },
    ]);
    later(player, 2, () => sound(player, SOUND.CLIMB_WALL));
    return true;
  }

  /** The gap: the toll guard's talk north (t2507-2521); back south free (t2525). */
  function jumpGap(event) {
    const { player, objectId } = event;
    if (ObstacleRunner.isBusy(player)) return true;
    if (objectId === LOCS.GAP_SOUTH) {
      // Wiki (Gap (Gu'Tanoth), Mod Ash): jumping back resets the toll; teleporting out keeps it paid.
      state.setBit(player, BITS.TOLL_PAID, false);
      jumpAcross(player, false);
      play(player, NPCS.BRIDGE_GUARD, "entering-gu-tanoth-crossing-back-across-the-bridge");
      return true;
    }
    if (stage(player) < STAGES.GUTANOTH) {
      player.sendMessage("Nothing interesting happens.");
      return true;
    }
    // Wiki (Gap (Gu'Tanoth)): "Level 25 Agility is required". Ours: the refusal's words; no capture has one.
    if (level(player, Skill.AGILITY) < 25) {
      player.sendMessage("You need an Agility level of 25 to jump this gap.");
      return true;
    }
    if (state.hasBit(player, BITS.TOLL_PAID)) {
      jumpAcross(player, true);
      return true;
    }
    const guard = nearestNpc(player, (npc) => npc.getId() === NPCS.BRIDGE_GUARD, 12);
    play(player, NPCS.BRIDGE_GUARD, "entering-gu-tanoth-crossing-the-bridge", null, PAGE, guard);
    return true;
  }

  /** The toll: 20 coins, the message, the jump and 5 Agility XP on the same tick (t2521). */
  function payToll(player) {
    // Only from the bridge deck south of the gap: the jump's move ignores clipping.
    const here = player.getLocation();
    if (here.getZ() !== 0 || here.getY() > 3026 || !near(player, [2530, 3026], 1)) return;
    if (player.getInventory().getAmount(ITEMS.COINS) < 20) return;
    player.getInventory().deleteNumber(ITEMS.COINS, 20);
    state.setBit(player, BITS.TOLL_PAID);
    player.sendMessage("You daringly jump across the chasm.");
    jumpAcross(player, true);
  }

  /** The jump: seq 5355 and sound 2461 with a 45-cycle move from where the player stands (t2521, t2525). */
  function jumpAcross(player, northward) {
    const end = northward ? TILES.GAP_NORTH : TILES.GAP_SOUTH;
    // Wiki (Gap (Gu'Tanoth)): 5 Agility XP a jump from the south, and 20 coins each time, after the quest too.
    if (northward) player.getSkillManager().addExperiences(Skill.AGILITY, 5);
    ObstacleRunner.run({ player }, [
      { move: [end[0], end[1]], anim: SEQ.GAP_JUMP, speed: [0, 45], dir: northward ? "north" : "south" },
      { sound: SOUND.JUMP },
    ]);
  }

  // ------------------------------------------------------------------ the skavid caves

  /** A skavid cave: with the map, "You enter the cave..." and the inside on arrival (t2903, t2947). */
  /** The cave a player is about to go into (its prompt's answer), and where. */
  const pendingCave = new WeakMap();
  const CAVE_VARIANT = "skavid-search-entering-the-caves";

  /**
   * A skavid cave, as the Wiki's "Entering the caves": without the map, the message and another cave (the circuit;
   * the capture's cave6 fade, t2255-2260); without a light or a tinderbox, the dark prompt; with a light but no
   * tinderbox, the tinderbox prompt; otherwise "You enter the cave..." and the inside on arrival (t2903, t2947).
   */
  function enterSkavidCave(event) {
    const { player, objectId } = event;
    const inside = W.CAVES.get(objectId);
    if (!inside) return false;
    pendingCave.set(player, { objectId, inside });
    const light = Darkness.hasLightSource(player), tinderbox = held(player, ITEMS.TINDERBOX);
    if (!held(player, ITEMS.MAP)) {
      play(player, NPCS.SCARED_SKAVID, CAVE_VARIANT, () => conditionSteps(PAGE, CAVE_VARIANT, "1FNZaU"));
      return true;
    }
    if (!light && !tinderbox) {
      play(player, NPCS.SCARED_SKAVID, CAVE_VARIANT, () => conditionSteps(PAGE, CAVE_VARIANT, "nyQebD"));
      return true;
    }
    if (!light) {
      player.sendMessage("It is far too dark in there. I will need a light source."); // Ours: the Wiki has no such case
      return true;
    }
    if (!tinderbox) {
      play(player, NPCS.SCARED_SKAVID, CAVE_VARIANT, () => conditionSteps(PAGE, CAVE_VARIANT, "bQJSWe"));
      return true;
    }
    intoCave(player, inside);
    return true;
  }
  function intoCave(player, [x, y], message = true) {
    pendingCave.delete(player);
    if (message) player.sendMessage("You enter the cave...");
    player.moveTo(new Location(x, y, 0));
  }
  /** The mapless circuit: the fade, the next cave three ticks later, the fade back. */
  function maplessCircuit(player) {
    const cave = pendingCave.get(player);
    pendingCave.delete(player);
    const route = cave && W.MAPLESS_CAVE_ROUTES.get(cave.objectId);
    if (!route) return;
    ObstacleRunner.run({ player }, [{ fade: "out" }, { wait: 3 }, { tele: [route[0], route[1], 0] }, { wait: 2 }, { fade: "in" }, { wait: 3 }]);
  }
  /** The caves' prompts: in on "I'm not scared of the dark!" (its own message) or "I'll be fine without a tinderbox.". */
  function caveAnswer(event) {
    const { player, stepId, kind } = event;
    const cave = pendingCave.get(player);
    if (!cave) return false;
    if (stepId === "porSMW") { maplessCircuit(player); return true; }
    if (kind === "message" && stepId === "-9KBp5") { intoCave(player, cave.inside, false); return false; }
    return false;
  }
  function caveChoice(event) {
    const cave = pendingCave.get(event.player);
    if (cave && event.option === "I'll be fine without a tinderbox.") intoCave(event.player, cave.inside);
  }

  function leaveSkavidCave(event) {
    const exit = W.CAVE_EXITS.get(event.objectId);
    if (!exit) return false;
    event.player.moveTo(new Location(exit[0], exit[1], 0));
    return true;
  }

  // ------------------------------------------------------------------ the enclave

  /** The enclave entrance (2804's tiles); the run past only takes a player still beside it. */
  const ENCLAVE_DOOR = [2506, 3038];
  /** "door"-like entry past the guards: the warning screen, then in (t3633-3638, t6303-6311). */
  function runPastGuards(player) {
    const proceed = () => {
      player.sendMessage("You run past the guard while he's busy.");
      const first = state.get(player, VARBITS.NIGHTSHADE_USED) === 0;
      if (first) state.set(player, VARBITS.NIGHTSHADE_USED, 1);
      if (!complete(player) && state.get(player, VARBITS.ENCLAVE_SCENE) === 0) {
        scenes.playEnclaveScene(player, () => near(player, ENCLAVE_DOOR, 6));
        return;
      }
      later(player, 3, () => { if (near(player, ENCLAVE_DOOR, 6)) player.moveTo(new Location(...TILES.ENCLAVE_INSIDE)); });
    };
    const warning = { player, warning: 12, proceed };
    api.emitCustomEvent("warning-screen:show", warning);
    if (!warning.handled) proceed();
  }

  /** Cave nightshade on an enclave guard: his line (stage 8 the first time), then the warning (t3451, t3632). */
  function nightshadeOnGuard(player, npc) {
    if (stage(player) < STAGES.SKAVID_CRYSTAL) {
      player.sendMessage("I think I had better deal with those skavids first..."); // Ours: no capture
      return;
    }
    take(player, ITEMS.NIGHTSHADE);
    state.advance(player, STAGES.NIGHTSHADE);
    const variant = "entering-the-enclave-using-cave-nightshade-on-an-enclave-guard";
    enclaveDistracted.add(player);
    play(player, NPCS.ENCLAVE_GUARD, variant, (steps) => steps.slice(0, 1), PAGE, npc);
  }
  const enclaveDistracted = new WeakSet();
  function nightshadeLine(request) {
    if (!starts(request, LINE.NIGHTSHADE) || !enclaveDistracted.has(request.player)) return;
    const player = request.player;
    request.after = () => {
      enclaveDistracted.delete(player);
      // The warning opens as the chat closes (t3633); a tick on, so the chat's close leaves it up.
      later(player, 1, () => runPastGuards(player));
    };
  }

  function enterEnclave({ player }) {
    if (complete(player)) {
      runPastGuards(player);
      return true;
    }
    const guard = nearestNpc(player, (npc) => npc.getId() === NPCS.ENCLAVE_GUARD, 8);
    play(player, NPCS.ENCLAVE_GUARD, "entering-the-enclave-attempting-to-enter-the-ogre-enclave-before-distracting-the-guards", null, PAGE, guard);
    return true;
  }

  function leaveEnclave({ player }) {
    player.moveTo(new Location(...TILES.ENCLAVE_EXIT));
    return true;
  }

  function enclaveGate({ player }) {
    player.sendMessage("The gate is locked tight.<br>You'll have to find another way out.");
    return true;
  }

  /** The magic ogre potion on a shaman: poured (seq 5361), the shaman gone eight ticks later (t5709-5852). */
  function potionOnShaman(player, npcId) {
    const shaman = W.SHAMANS.find((entry) => entry.ids.includes(npcId));
    if (!shaman || stage(player) < STAGES.MAGIC_POTION || !held(player, ITEMS.MAGIC_POTION)) return false;
    if (state.get(player, shaman.varbit) === 1) return true;
    if (level(player, Skill.MAGIC) < 14) {
      player.sendMessage("You need a Magic level of 14 or over to use this potion."); // Ours: Wiki requirement
      return true;
    }
    if (ObstacleRunner.isBusy(player)) return true;
    // The pour lands only on a player still where it began, alive, with the potion (a teleport or death cancels it).
    const from = player.getLocation().clone();
    const stillThere = () => !player.isDying?.() && player.getHitpoints() > 0 && held(player, ITEMS.MAGIC_POTION)
      && player.getLocation().getZ() === from.getZ() && player.getLocation().getDistance(from) <= 1;
    ObstacleRunner.run({ player }, [{ anim: SEQ.POUR_POTION }, { wait: 8 }, { run: () => { if (stillThere()) shamanDestroyed(player, shaman); } }]);
    return true;
  }

  function shamanDestroyed(player, shaman) {
    player.sendMessage("There is a bright flash!");
    player.sendMessage("The ogre dissolves into spirit form.");
    state.set(player, shaman.varbit, 1);
    if (shamansDead(player) >= MAX_SHAMANS) {
      player.sendMessage("You hear a scream...<br>The shaman dissolves before your eyes.");
      take(player, ITEMS.MAGIC_POTION);
      give(player, ITEMS.VIAL);
      player.performAnimation(new Animation(SEQ.PICKUP, 1));
      sound(player, SOUND.SHAMAN_CRY);
      sound(player, SOUND.PICK);
    }
    play(player, NPCS.WIZARD, "entering-the-enclave-killing-the-ogre-shamans", (steps) => steps.filter((step) =>
      !/shaman robe/i.test(step.text ?? "")));
  }

  function searchShamanRobe({ player }) {
    if (shamansDead(player) < MAX_SHAMANS) {
      play(player, NPCS.WIZARD, "entering-the-enclave-killing-the-ogre-shamans",
        () => conditionSteps(PAGE, "entering-the-enclave-killing-the-ogre-shamans", "D7pWK9"));
      return true;
    }
    play(player, NPCS.WIZARD, "entering-the-enclave-killing-the-ogre-shamans", (steps) => steps.filter((step) =>
      /shaman robe while/i.test(step.text ?? "")));
    return true;
  }

  /** Prospect: the two messages four ticks apart (t3714-3718). */
  function prospectRock({ player }) {
    if (ObstacleRunner.isBusy(player)) return true;
    // Wiki (Rock of Dalgroth): after mining, and after the quest, "The rock has a gap in which a crystal used to sit."
    if (complete(player) || (state.get(player, VARBITS.ROCK_MINED) === 1 && owns(player, CRYSTAL_GREY))) {
      const steps = variantSteps(PAGE, "entering-the-enclave-prospecting-the-rock-of-dalgroth-after-mining-it") ?? [];
      ObstacleRunner.run({ player }, [{ msg: steps[0]?.text }, { wait: 4 }, { msg: steps[1]?.text }]);
      return true;
    }
    ObstacleRunner.run({ player }, [{ msg: "You examine the rock for ores..." }, { wait: 4 }, { msg: "The rock contains a crystal!" }]);
    return true;
  }

  /** Mine: once the shamans are gone, the swing and four ticks later the crystal in a box (t5881-5885). */
  function mineRock({ player }) {
    // After the quest "the rock no longer serves any purpose" (Wiki): Ours, the "again" line stands for it.
    if (complete(player)) {
      play(player, NPCS.WIZARD, "entering-the-enclave-attempting-to-mine-the-rock-of-dalgroth-again");
      return true;
    }
    if (stage(player) < STAGES.MAGIC_POTION || shamansDead(player) < MAX_SHAMANS) {
      // The Wiki's "The Rock of Dalgroth before killing the shamans", Mining: the player's line.
      play(player, NPCS.WIZARD, "entering-the-enclave-inside-the-enclave-the-rock-of-dalgroth-before-killing-the-shamans",
        () => conditionSteps(PAGE, "entering-the-enclave-inside-the-enclave-the-rock-of-dalgroth-before-killing-the-shamans", "w1gpgY"));
      return true;
    }
    if (owns(player, CRYSTAL_GREY)) {
      play(player, NPCS.WIZARD, "entering-the-enclave-attempting-to-mine-the-rock-of-dalgroth-again");
      return true;
    }
    if (level(player, Skill.MINING) < 40) {
      player.sendMessage("You need a Mining level of 40 to mine this rock."); // Ours: Wiki requirement
      return true;
    }
    const request = { player, pickaxe: null };
    api.emitCustomEvent("mining:best-pickaxe", request);
    if (!request.pickaxe) {
      player.sendMessage("You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.");
      return true;
    }
    if (ObstacleRunner.isBusy(player) || player.getInventory().isFull()) {
      if (player.getInventory().isFull()) player.getInventory().full();
      return true;
    }
    player.sendMessage("You swing your pick at the rock...");
    const animation = request.pickaxe.animation;
    ObstacleRunner.run({ player }, [
      { anim: animation?.getId?.() ?? animation }, { wait: 4 },
      { run: () => {
        give(player, CRYSTAL_GREY);
        state.set(player, VARBITS.ROCK_MINED, 1);
        play(player, NPCS.WIZARD, "entering-the-enclave-mining-the-rock-of-dalgroth");
      } },
    ], { keepAnimation: false });
    return true;
  }

  // ------------------------------------------------------------------ the potion

  function handleItemOnItem(event) {
    const { player } = event;
    if (!player) return;
    const ids = [event.usedItemId, event.usedWithItemId];
    const both = (a, b) => ids.includes(a) && ids.includes(b);

    if (ITEMS.RELIC_PARTS.includes(ids[0]) && ITEMS.RELIC_PARTS.includes(ids[1])) {
      event.handled = true;
      const [step] = variantSteps(PAGE, "ogre-investigations-using-the-relic-parts-on-each-other") ?? [];
      if (step?.text) player.sendMessage(step.text);
      return;
    }
    // The bat bones ground with the pestle: seq 364 and sound 2608 (t5084, t5277).
    if (both(ITEMS.BAT_BONES, ITEMS.PESTLE)) {
      event.handled = true;
      take(player, ITEMS.BAT_BONES);
      player.getInventory().adds(ITEMS.GROUND_BAT_BONES, 1);
      player.performAnimation(new Animation(SEQ.GRIND));
      sound(player, SOUND.GRIND);
      player.sendMessage("You grind the bones to a powder.");
      return;
    }
    const steps = [
      [ITEMS.GUAM_POTION, ITEMS.JANGERBERRIES, ITEMS.GUAM_JANGER_VIAL, ["You mix the jangerberries into your potion."]],
      [ITEMS.GUAM_JANGER_VIAL, ITEMS.GROUND_BAT_BONES, ITEMS.POTION, ["You mix the ground bones into the liquid.", "You produce a strong potion."]],
      [ITEMS.VIAL_OF_WATER, ITEMS.JANGERBERRIES, ITEMS.JANGER_VIAL, ["You mix the jangerberries into the water."]], // Ours
    ];
    const step = steps.find(([a, b]) => both(a, b));
    // The wrong order: ground bones into the guam potion explodes (t5087).
    // Wiki (Vial (jangerberries)): "Adding a guam leaf will cause the potion to explode, dealing 5 damage".
    const leafExplodes = both(ITEMS.JANGER_VIAL, ITEMS.GUAM_LEAF);
    const explodes = leafExplodes || both(ITEMS.GUAM_POTION, ITEMS.GROUND_BAT_BONES);
    const evaporates = both(ITEMS.VIAL_OF_WATER, ITEMS.GROUND_BAT_BONES);
    if (!step && !explodes && !evaporates) return;
    event.handled = true;
    if (stage(player) < STAGES.RECIPE) {
      player.sendMessage("Hmm, perhaps I shouldn't mix these together. It might have unpredictable results."); // Ours
      return;
    }
    if (level(player, Skill.HERBLORE) < 14) {
      player.sendMessage("You need a Herblore level of 14 or above to make this potion."); // Ours: Wiki requirement
      return;
    }
    if (evaporates) {
      // The Wiki's "Ground bat bones into a vial of water": its message and the player's line. Ours: both are used up.
      take(player, ITEMS.VIAL_OF_WATER);
      take(player, ITEMS.GROUND_BAT_BONES);
      player.getInventory().adds(ITEMS.VIAL, 1);
      const mixing = "entering-the-enclave-talking-to-the-watchtower-wizard-after-discovering-the-shamans-are-invincible-mixing-the-potion";
      const branch = (variantSteps(PAGE, mixing) ?? []).find((s) => /vial of water/i.test(s.text ?? ""));
      if (branch) play(player, NPCS.WIZARD, mixing, () => branch.steps ?? []);
      return;
    }
    if (explodes) {
      take(player, leafExplodes ? ITEMS.JANGER_VIAL : ITEMS.GUAM_POTION);
      take(player, leafExplodes ? ITEMS.GUAM_LEAF : ITEMS.GROUND_BAT_BONES);
      player.getInventory().adds(ITEMS.VIAL, 1);
      if (!leafExplodes) player.sendMessage("You mix the ground bones into the liquid.");
      player.sendMessage("You mixed the ingredients incorrectly and the mixture exploded.");
      player.performAnimation(new Animation(SEQ.EXPLODE));
      player.performGraphic(Graphic.atHeight(SPOTANIM_EXPLODE, 92));
      sound(player, SOUND.VIAL_MIX);
      sound(player, SOUND.EXPLODE);
      damage(player, 5);
      return;
    }
    const [a, b, result, messages] = step;
    take(player, a);
    take(player, b);
    player.getInventory().adds(result, 1);
    player.getSkillManager().addExperiences(Skill.HERBLORE, 10);
    sound(player, SOUND.VIAL_MIX);
    for (const message of messages) player.sendMessage(message);
  }

  // ------------------------------------------------------------------ the shield generator

  /** A crystal on a pillar: the reach (seq 832), the crystal in a tick later with sound 975 (t6010-6038). */
  function crystalOnPillar(player, pillar, itemId) {
    if (stage(player) < STAGES.ALL_CRYSTALS || complete(player)) return false;
    if (state.get(player, pillar.varbit) >= 1) return true;
    if (pillar.crystal !== itemId) {
      play(player, NPCS.WIZARD, "reviving-the-watchtower-placing-a-crystal-on-the-wrong-pillar");
      return true;
    }
    if (ObstacleRunner.isBusy(player)) return true;
    ObstacleRunner.run({ player }, [
      { anim: SEQ.CHEST }, { wait: 1 },
      { run: () => {
        if (!held(player, itemId)) return;
        take(player, itemId);
        state.set(player, pillar.varbit, 1);
        sound(player, SOUND.PILLAR);
      } },
    ]);
    return true;
  }

  /** The lever: before the crystals, its message; with them, the shield and the completion (t6047-6062). */
  function pullLever({ player, object }) {
    const at = object?.getLocation?.();
    if (at && at.getX() !== 2543) return false;
    if (complete(player)) return false;
    if (stage(player) < STAGES.ALL_CRYSTALS || !allPlaced(player)) {
      play(player, NPCS.WIZARD, "reviving-the-watchtower-pulling-the-lever-before-placing-the-crystals");
      return true;
    }
    if (ObstacleRunner.isBusy(player)) return true;
    player.performAnimation(new Animation(SEQ.LEVER));
    player.getMovementQueue().reset();
    later(player, 1, () => activateShield(player));
    return true;
  }

  function activateShield(player) {
    if (complete(player)) return;
    const variant = "reviving-the-watchtower-activating-the-shield-generator";
    for (const itemId of ITEMS.CRYSTALS) take(player, itemId, player.getInventory().getAmount(itemId));
    // Into the completed tower first: a reward that does not fit lands there, not on the floor left behind.
    player.moveTo(new Location(...TILES.LEVER_LANDING));
    // The rewards (onReward) go with the stage, so a logout in the next ticks cannot save a completion without
    // them. Live sends them four ticks on (t6054), with the wizard's first line.
    state.own(player, () => quest.complete(player, { scroll: false, announce: false }));
    player.sendMessage(messageText(variant, "EAAUUD") ?? "The magic force field activates.");
    for (const pillar of W.PILLARS) state.set(player, pillar.varbit, 2);
    sound(player, SOUND.LEVER);
    player.getPacketSender().sendJingle(JINGLE_MACHINE_ON, 0);
    // The reward and the wizard's thanks four ticks later; the scroll after his two lines (t6054-6062).
    later(player, 4, () => {
      const wizard = nearestNpc(player, (npc) => npc.getId() === NPCS.WIZARD, 12);
      play(player, NPCS.WIZARD, variant, (steps) => steps.filter((step) => step.type === "line"), PAGE, wizard);
      completionAfterChat(player);
    });
  }

  /** Every completion's rewards (the lever, ::quest, a quest pack); `experience: false` holds the XP back. */
  function grantReward(player, _quest, options = {}) {
    if (options.experience !== false) player.getSkillManager().addExperiences(Skill.MAGIC, 15250);
    giveReward(player, ITEMS.COINS, 5000);
    giveReward(player, ITEMS.SCROLL, 1);
  }

  /** The completion message and scroll three ticks after the wizard's last line (t6059-6062). */
  function completionAfterChat(player) {
    let ticks = 0;
    const task = new core.Task(1, false);
    task.execute = () => {
      if (!player.isRegistered?.()) { task.stop(); return; }
      // Announced once the thanks close, or after 200 ticks whatever the chat (the scroll waits for it).
      if (player.getDialogueManager().isActive?.() && ++ticks <= 200) return;
      task.stop();
      later(player, 2, () => quest.announceCompletion(player));
    };
    api.getTaskManager().submit(task);
  }

  /** The scroll: read, the stage, then the two boxes and the dust (t6093-6096). */
  function readSpellScroll(event) {
    const { player } = event;
    if (!player || !held(player, ITEMS.SCROLL)) return;
    event.handled = true;
    if (!complete(player)) return;
    if (hasReadSpellScroll(player)) {
      player.sendMessage("You have already learnt the Watchtower teleport spell."); // Ours: no capture
      return;
    }
    const steps = variantSteps(PAGE, "post-quest-reading-the-spell-scroll") ?? [];
    const [memorise, cast, dust] = steps.map((step) => step.text);
    // The scroll goes with the stage (live: two ticks later, t6095), so a logout between keeps neither half alone.
    take(player, ITEMS.SCROLL);
    state.setStage(player, STAGES.READ_SCROLL);
    player.performAnimation(new Animation(SEQ.READ_SCROLL));
    const box = (text) => new core.StatementDialogue(0, text);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(box(memorise)));
    later(player, 2, () => {
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(box(cast)));
      later(player, 1, () => player.sendMessage(dust));
    });
  }

  // ------------------------------------------------------------------ hooks

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    const done = (result) => { if (result) event.handled = true; };
    if (objectId === LOCS.BATTLEMENT) return done(climbBattlement(event));
    if (objectId === LOCS.GAP_NORTH || objectId === LOCS.GAP_SOUTH) return done(jumpGap(event));
    if (objectId === LOCS.ROPE_SWING_BACK && (event.option === "Swing-on" || event.clickType === 1)) return crossGrewRiver(event, false);
    if (LOCS.BUSHES.has(objectId)) return done(searchBush(event));
    if (objectId === LOCS.TRELLIS) return done(climbTrellis(event));
    if (objectId === LOCS.TOBAN_CHEST) return done(openTobanChest(event));
    if (objectId === LOCS.TOBAN_CAVE) return done(enterTobanCave(event));
    if (objectId === LOCS.TOBAN_LADDER) {
      tobanLadder(player);
      return done(true);
    }
    if (objectId === LOCS.YANILLE_HOLE) {
      player.sendMessage("You enter the tunnel.");
      player.sendMessage("So that's how the skavids are getting into Yanille!");
      player.moveTo(new Location(...TILES.YANILLE_HOLE));
      return done(true);
    }
    if (objectId === LOCS.CAKE_COUNTER) return done(stealRockCake(event));
    if (LOCS.EAST_GATE.includes(objectId) || LOCS.NORTH_WEST_GATE.includes(objectId)) return done(openCityGate(event));
    if (objectId === LOCS.LEVER) return done(pullLever(event));
    if (objectId === LOCS.ROCK) {
      const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
      return done(option.includes("prospect") ? prospectRock(event) : mineRock(event));
    }
    if (objectId === LOCS.ENCLAVE_ENTRANCE) return done(enterEnclave(event));
    if (objectId === LOCS.ENCLAVE_EXIT) return done(leaveEnclave(event));
    if (objectId === LOCS.ENCLAVE_GATE) return done(enclaveGate(event));
    if (W.CAVES.has(objectId)) return done(enterSkavidCave(event));
    if (W.CAVE_EXITS.has(objectId)) return done(leaveSkavidCave(event));
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (objectId === LOCS.ROPE_TREE && itemId === I.ROPE) {
      crossGrewRiver(event, true);
      return;
    }
    if (objectId === LOCS.TOBAN_CHEST && itemId === ITEMS.KEY) {
      event.handled = true;
      openTobanChest(event);
      return;
    }
    const pillar = W.PILLARS.find((entry) => entry.loc === objectId);
    if (pillar && ITEMS.CRYSTALS.includes(itemId) && crystalOnPillar(player, pillar, itemId)) event.handled = true;
  }

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!player || !npcId) return;
    const npc = event.target ?? event.npc ?? null;
    const stop = () => { event.handled = true; };

    if (npcId === NPCS.WIZARD) {
      const value = stage(player);
      if (value === STAGES.STARTED && DECOYS.some(([id]) => id === itemId)) {
        // A decoy shown to the wizard: "Let me see..." and the rest of his answer (t652-666).
        play(player, NPCS.WIZARD, "searching-for-evidence-using-evidence-other-than-the-fingernails-on-the-watchtower-wizard", null, PAGE, npc);
        return stop();
      }
      if (ITEMS.CRYSTALS.includes(itemId) && value >= STAGES.FINGERNAILS && value < STAGES.ALL_CRYSTALS) {
        play(player, NPCS.WIZARD, "ogre-investigations-using-a-crystal-on-the-watchtower-wizard", null, PAGE, npc);
        return stop();
      }
      if (value === STAGES.STARTED && itemId === ITEMS.FINGERNAILS) {
        play(player, NPCS.WIZARD, "searching-for-evidence-talking-to-the-watchtower-wizard", null, PAGE, npc);
        return stop();
      }
      if (value === STAGES.FINGERNAILS && ITEMS.RELIC_PARTS.includes(itemId)) {
        if (startRelicTalk(player, npc)) return stop();
      }
      if ((value === STAGES.RECIPE || needsNewPotion(player)) && itemId === ITEMS.POTION) {
        play(player, NPCS.WIZARD, "entering-the-enclave-talking-to-the-watchtower-wizard-after-making-the-potion", null, PAGE, npc);
        return stop();
      }
      return;
    }
    if (npcId === NPCS.TOBAN && itemId === ITEMS.DRAGON_BONES && state.hasBit(player, BITS.SPOKEN_TOBAN)
      && !state.hasBit(player, BITS.HELPED_TOBAN)) {
      play(player, NPCS.TOBAN, "ogre-investigations-toban-speaking-to-toban-again", null, PAGE, npc);
      return stop();
    }
    if (npcId === NPCS.OG && itemId === ITEMS.GOLD && state.hasBit(player, BITS.SPOKEN_OG) && !state.hasBit(player, BITS.HELPED_OG)) {
      play(player, NPCS.OG, "ogre-investigations-og-speaking-to-og-again", null, PAGE, npc);
      return stop();
    }
    if (npcId === NPCS.GREW && itemId === ITEMS.TOOTH && state.hasBit(player, BITS.SPOKEN_GREW) && !state.hasBit(player, BITS.HELPED_GREW)) {
      play(player, NPCS.GREW, "ogre-investigations-grew-speaking-to-grew-again", null, PAGE, npc);
      return stop();
    }
    if (npcId === NPCS.EAST_GUARD && itemId === ITEMS.GOLD_BAR) {
      // Wiki: "use the gold bar on one of the guards to gain access".
      talkEastGuard({ player, npc });
      return stop();
    }
    if (npcId === NPCS.NORTH_WEST_GUARD && itemId === ITEMS.RELIC) {
      player.sendMessage("The ogre has not asked you for anything."); // Wiki: Watchtower guide
      return stop();
    }
    if (npcId === NPCS.NORTH_WEST_GUARD) {
      play(player, NPCS.NORTH_WEST_GUARD, "entering-gu-tanoth-city-guard-using-another-item-on-the-city-guard", null, PAGE, npc);
      return stop();
    }
    if (npcId === NPCS.BATTLEMENT_GUARD && itemId === ITEMS.ROCK_CAKE && state.get(player, VARBITS.GATE_CHAT_BATTLEMENT) === 1
      && !state.hasBit(player, BITS.MARKET_GIVEN)) {
      play(player, NPCS.BATTLEMENT_GUARD, "entering-gu-tanoth-ogre-guard-talking-to-the-ogre-guard-again", null, PAGE, npc);
      return stop();
    }
    if (npcId === NPCS.CITY_GUARD && stage(player) === STAGES.RIDDLE) {
      play(player, NPCS.CITY_GUARD, itemId === ITEMS.DEATH_RUNE
        ? "entering-gu-tanoth-seeking-passage-using-the-death-rune-on-the-guard-or-talking-to-him-with-it"
        : "entering-gu-tanoth-seeking-passage-using-the-wrong-item-on-the-guard", null, PAGE, npc);
      return stop();
    }
    if (npcId === NPCS.ENCLAVE_GUARD && itemId === ITEMS.NIGHTSHADE) {
      nightshadeOnGuard(player, npc);
      return stop();
    }
    if (itemId === ITEMS.MAGIC_POTION && potionOnShaman(player, npcId)) stop();
  }

  function handleLogin({ player }) {
    state.migrate(player);
    state.replay(player);
    refreshQuestList(player);
  }

  function lines(request) {
    onLine(request);
    skavidAgainLine(request);
    nightshadeLine(request);
  }

  quest = registerQuest(api, {
    key: "watchtower",
    name: "Watchtower",
    varpId: W.VARP_QUEST,
    startedValue: STAGES.STARTED,
    completionValue: STAGES.COMPLETE,
    questPoints: 4,
    xpRewards: [{ skillId: Skill.MAGIC.getIndex(), amount: 15250, label: "Magic" }],
    // The scroll shows the relic (t6062); the coins and the spell scroll come with grantReward, on the lever.
    scrollItemId: ITEMS.RELIC,
    otherRewards: ["5,000 Coins", "The Watchtower Teleport Spell"],
    buildJournal,
    onReward: grantReward,
  });

  state.register();
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCanTeleport(canCastWatchtowerTeleport);
  api.onCustomEvent("magic:teleport-quest-lock", watchtowerPortalLock);
  api.onCustomEvent("npc-dialogue:line", lines);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("ladders:climb", claimLadder);
  api.onCustomEvent("door:toggle", cityGate);
  api.onNpcInteraction("Watchtower Wizard", { "Talk-to": talkWizard });
  api.onNpcInteraction("Skavid", { "Talk-to": talkSkavid });
  api.onNpcInteraction("Ogre guard", { "Talk-to": talkOgreGuard });
  for (const name of ["Og", "Grew", "Toban", "Mad skavid"]) api.onNpcInteraction(name, { "Talk-to": talkQuestOgre });
  api.onNpcAttackOption(attackOption);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemAction("Spell scroll", { Read: readSpellScroll });
  api.onItemAction("Shaman robe", { Search: searchShamanRobe });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(scenes.cancel);
  api.onPlayerDeath(scenes.cancel);

  /**
   * The quest's NPCs with no Wiki talk at the player's stage (Og, Grew, Toban before or after their part, the mad
   * skavid before the words): Ours, nothing happens, rather than the page's first variant (the Tower guard's lines).
   */
  /**
   * The mad skavid's greeting (Wiki: "one of four phrases, each with its own answer: 'Ar cur...' (Gor), 'Bidith ig...'
   * (Cur), 'Cur tanath...' (Bidith) or 'Gor nod...' (Tanath). A wrong answer gives 'The response was wrong.' and
   * Mad skavid: ???"). The capture's was "Bidith ig..." / Cur (t3310-3313). The reward is the transcript's own.
   */
  const MAD_SKAVID_PHRASES = [["Ar cur...", "Gor."], ["Bidith ig...", "Cur."], ["Cur tanath...", "Bidith."], ["Gor nod...", "Tanath."]];
  function madSkavidSteps() {
    const steps = variantSteps(PAGE, "skavid-search-the-mad-skavid") ?? [];
    const greeting = steps.find((step) => step.type === "line");
    const choice = steps.find((step) => step.type === "choice");
    const reward = choice?.options?.find((option) => option.text === "Tanath.")?.steps?.filter((step) => step.player === undefined) ?? [];
    if (!greeting || !choice || !reward.length) return null;
    const [phrase, answer] = MAD_SKAVID_PHRASES[Math.floor(Math.random() * MAD_SKAVID_PHRASES.length)];
    return [{ ...greeting, text: phrase }, { ...choice, options: choice.options.map((option) => ({
      ...option,
      steps: option.text === answer
        ? [{ player: answer }, ...reward]
        : [{ player: option.text }, { type: "message", text: "The response was wrong." }, { ...greeting, text: "???" }],
    })) }];
  }

  function talkQuestOgre(event) {
    const { player, npcId } = event;
    if (npcId === NPCS.MAD_SKAVID && selectVariant(event) === "skavid-search-the-mad-skavid") {
      const steps = madSkavidSteps();
      if (steps) {
        play(player, npcId, "skavid-search-the-mad-skavid", () => steps, PAGE, event.npc);
        return true;
      }
    }
    const variant = npcId === NPCS.OG ? ogVariant(player) : npcId === NPCS.GREW ? grewVariant(player)
      : npcId === NPCS.TOBAN ? tobanVariant(player) : npcId === NPCS.MAD_SKAVID ? selectVariant(event) : undefined;
    return variant === null;
  }

  /** Gorad's tooth is out and kept, or given: a lost tooth means killing him again (Wiki). */
  const toothDone = (player) => owns(player, ITEMS.TOOTH) || state.hasBit(player, BITS.HELPED_GREW) || stage(player) >= STAGES.RELIC;

  /** Attacking a shaman: the blast (Wiki); attacking Gorad once his tooth is out: "You don't need to fight him now." */
  function attackQuestNpc(event) {
    const { player, npcId, npc } = event;
    if (W.SHAMANS.some((shaman) => shaman.ids.includes(npcId))) {
      if (shamansDead(player) >= MAX_SHAMANS) return false;
      play(player, npcId, "entering-the-enclave-inside-the-enclave-attacking-an-ogre-shaman", null, PAGE, npc);
      return true;
    }
    if (npcId === NPCS.GORAD && toothDone(player)) {
      play(player, NPCS.GORAD, "ogre-investigations-grew-attacking-gorad-after-getting-his-tooth", null, PAGE, npc);
      return true;
    }
    return false;
  }
  /** Attack goes through the attack-option hook (NPCOptionPacketListener), not onNpcInteraction. */
  function attackOption(event) {
    if (!event.player || !event.npc) return;
    if (attackQuestNpc(event)) event.handled = true;
  }

  /** The Gu'Tanoth guards by who they are. */
  function talkOgreGuard(event) {
    if (event.npcId === NPCS.EAST_GUARD) return talkEastGuard(event);
    if (event.npcId === NPCS.NORTH_WEST_GUARD) return talkNorthWestGuard(event);
    if (event.npcId === NPCS.BATTLEMENT_GUARD) return talkBattlementGuard(event);
    return false;
  }
};
