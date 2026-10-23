/**
 * Meat and Greet (members).
 *
 * Behaviour follows the complete quest in RSProx recording 1695 (revision 226, ticks
 * 7980-8789); the words come from the "Meat and Greet" transcript page. Evidence and
 * remaining gaps: docs/p2p-varlamore-group-2-parity.md.
 *
 * Stages (varbit 11182 "mag", varp 4399), as captured:
 *   0 not started            14 two kebabs for Lelia
 *   2 started                16 Lelia ate one
 *   4 chasing the deliveries 18 ready for the advert
 *   6 both deliveries sorted 20 the minotaur turned on the player
 *   8 working out the recipe 22 minotaur dead
 *  10 a connoisseur loved it 24 Lelia sent the player back to Emelio
 *  12 off to Lelia           26 complete
 * The sibling varbits on varp 4399 carry the deliveries (mag_spice 11183, mag_meat 11184:
 * 1 asked .. 4 sent), the recipe (mag_portions_* 11185-11188, 1-4 portions, 0 before the
 * first "I think so.") and mag_testing_kebab 11189 (the test kebab handed out).
 *
 * Saves from the old 0-7 stage model are mapped onto the captured values once.
 * Rewards per the capture: 1 Quest point, 8,000 Cooking XP and access to Emelio's Kebab Shop.
 */
module.exports = function registerMeatAndGreetQuest(api) {
  const {
    ActionDialogue,
    Animation,
    Boundary,
    CombatMethod,
    CombatType,
    CountdownTask,
    DialogueChainBuilder,
    GameObject,
    Graphic,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    PendingHit,
    PrayerHandler,
    PrivateArea,
    Skill,
    StatementDialogue,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");

  const PAGE = "Meat and Greet";
  const START_HOOK = "quest:meat-and-greet:start";
  const CHILDREN_OF_THE_SUN_KEY = "children_of_the_sun";

  const EMELIO_NPC_ID = NpcIdentifiers.EMELIO; // 13804
  const SPICE_MERCHANT_NPC_ID = NpcIdentifiers.SPICE_MERCHANT; // 13337
  const ALBA_NPC_ID = NpcIdentifiers.ALBA; // 13807
  const LELIA_NPC_ID = NpcIdentifiers.LELIA; // 13806
  const ANNOUNCER_NPC_ID = 13811; // gameval mag_announcer
  const DIRE_WOLF_ALPHA_NPC_ID = NpcIdentifiers.DIRE_WOLF_ALPHA; // 13812
  const DIRE_WOLF_NPC_ID = 13813; // gameval mag_direwolf_minion
  const CUTSCENE_MINOTAUR_NPC_ID = NpcIdentifiers.MINOTAUR_6; // 13814, mag_minotaur_cutscene
  const MINOTAUR_NPC_ID = NpcIdentifiers.MINOTAUR_7; // 13815, mag_minotaur
  const CONNOISSEURS = {
    [NpcIdentifiers.LUCAS]: "Lucas", // 13808
    [NpcIdentifiers.RENATA]: "Renata", // 13809
    [NpcIdentifiers.VINCENS]: "Vincens", // 13810
  };

  const TEST_KEBAB_ITEM_ID = ItemIdentifiers.TEST_KEBAB; // 29898, the connoisseurs'
  const LELIA_KEBAB_ITEM_ID = ItemIdentifiers.TEST_KEBAB_2; // 29899, Lelia's and the advert's

  const VARP_MAG = 4399;
  const STAGE_VARBIT = 11182;
  const STAGE_STARTED = 2;
  const STAGE_DELIVERIES = 4;
  const STAGE_INGREDIENTS = 6;
  const STAGE_RECIPE = 8;
  const STAGE_TESTED = 10;
  const STAGE_MARKETING = 12;
  const STAGE_KEBABS = 14;
  const STAGE_LELIA_ATE = 16;
  const STAGE_ADVERT = 18;
  const STAGE_FIGHT = 20;
  const STAGE_MINOTAUR_DEAD = 22;
  const STAGE_TOLD = 24;
  const STAGE_COMPLETE = 26;

  /** Sibling varbits of varp 4399: [varbit, first bit, width]. */
  const VARS = {
    spice: [11183, 7, 4],
    meat: [11184, 11, 4],
    meatPortions: [11185, 15, 3],
    saladPortions: [11186, 18, 3],
    spicePortions: [11187, 21, 3],
    saucePortions: [11188, 24, 3],
    testing: [11189, 27, 1],
  };
  const INGREDIENTS = ["meat", "salad", "spice", "sauce"];
  const RECIPE = { meat: 4, salad: 2, spice: 1, sauce: 3 };
  const WORDS = ["", "one", "two", "three", "four"];

  const VARS_ATTRIBUTE = "meat-and-greet:vars";
  const STAGE_VERSION_ATTRIBUTE = "meat-and-greet:stage-version";
  const FAILED_TEST_ATTRIBUTE = "meat-and-greet:failed-test";
  const OLD_BITS_ATTRIBUTE = "quest.meat_and_greet.bits";
  const OLD_RECIPE_ATTRIBUTE = "quest.meat_and_greet.recipe";
  const STAGE_VERSION = 1;

  // The spice box keypad (interface 888, clientscript 7374) and its code, as captured.
  const KEYPAD_INTERFACE = 888;
  const KEYPAD_SCRIPT = 7374;
  const KEYPAD_SCRIPT_ARGS = [(KEYPAD_INTERFACE << 16) | 6, (KEYPAD_INTERFACE << 16) | 5, 2, 5, 4, 6, 2];
  const SPICE_BOX_CODE = 2546;
  const UNLOCK_SOUND = 2419;

  // The wolf den: a private copy, the alpha and its exit, and the captured fades.
  const DEN_BOUNDS = [1464, 1495, 9488, 9519, 1];
  const DEN_ENTRY_TILE = [1486, 9502, 1];
  const DEN_EXIT_TILE = [1499, 3130, 0];
  const ALPHA_TILE = [1477, 9501, 1];
  const PACK_WOLF_TILE = [1485, 9500, 1];
  const DEN_EXIT_LOC = { id: 54691, x: 1487, y: 9501, z: 1, type: 10, face: 0 }; // direwolf_cave_exit_instance
  const CRAWL_ANIMATION = 11580;
  // ponytail: one capture call at ~66% health; add a second when a longer fight shows one.
  const PACK_CALL_FRACTION = 2 / 3;

  // The Colosseum advert and fight, in a private copy of the arena.
  const ARENA_BOUNDS = [1806, 1842, 3088, 3128, 0];
  const LOBBY_TILE = [1820, 9484, 0];
  const ADVERT_TILE = [1824, 3098];
  const FIGHT_TILE = [1824, 3105];
  const CUTSCENE_MINOTAUR_TILE = [1824, 3111];
  const MINOTAUR_TILE = [1824, 3113];
  const ARENA_GATE = { id: 54689, x: 1823, y: 3091, z: 0, type: 10, face: 1 }; // mag_combat_leave
  const ARENA_TRACK_ID = 782; // "Are You Not Entertained?"
  const EAT_ANIMATION = 829;

  // Captured minotaur attacks: melee 11584, the "Moo!" magic 11585 (gfx 2950, impact 2951 or
  // splash 85 two ticks later) every fourth swing, and the "Moooooo!" shouts (11586, a camera
  // shake) at 50% and 25% hitpoints that make its attacks a tick faster.
  const MINOTAUR = {
    melee: 11584, magic: 11585, shout: 11586, cast: 2950, impact: 2951, splash: 85, castSound: 8035,
    speed: 5, shoutSpeed: 3, magicEvery: 4, thresholds: [0.5, 0.25],
  };

  const FADE_UID = (161 << 16) | 1;
  const CUTSCENE_STATUS_VARBIT = 542;
  const MINIMAP_STATE_VARBIT = 6719;
  const CAMERA_RATES = { rate: 232, rate2: 100 };

  // Transcript step ids and lines the quest acts on.
  const BOX_STEP_IDS = new Set(["gRONbi", "6xwjpY"]);
  const UNLOCKED_STEP = "wKaVhu";
  const TEST_KEBAB_STEP_IDS = new Set(["7WnuHP", "CNNvQb"]);
  const TEST_KEBAB_MESSAGES = new Set(["sw-3DW", "92XhYq"]);
  const TASTE_STEP = "Zu920h";
  const KEBABS_MESSAGE = "NUZMwQ";
  const KEBABS_ACTION = "_LMMpb";
  const LELIA_EATS_STEP = "rFr1Qu";
  const ADVERT_STEP = "8544ms";
  const ADVERT_EAT_STEP = "SnagHV";
  const RESTOCK_MESSAGES = new Set(["SWQ5Sk", "O43OKz"]);
  const START_LINE = "Okay, I guess I can go see where they've got to.";
  const SPICE_LOOK_LINE = "Sure thing!";
  const SPICE_SENT_LINE = "Kuani! You did it! I'll have these sent over to Emelio right away. Thanks for the help.";
  const ALBA_TASK_LINE = "Okay, I'll head over there and deal with this wolf.";
  const ALBA_SENT_LINE = "Kuani! Thank you so much for the help, iknami. While you were gone, I was able to get Emelio's order finished. It's on the way to him now.";
  const RECIPE_TASK_LINE = "Head on out there and have a chat with them to see if you can work out the perfect ratio of meat, salad, spice and sauce.";
  const MARKETING_LINE = "You must visit Lelia at the Colosseum at once. Take her a sample of our fine kebabs, and she will beg us to let her help sell them to the people of Varlamore!";
  const ADVERT_LINE = "Yup. Next contest starts soon and we don't have another slot for weeks.";
  const FIGHT_LINE = "Oh boy...";
  const TOLD_LINE = "Now, I need to get things ready for the next slot. Why don't you go and tell Emelio about the good impression his kebabs made.";
  const DONE_LINE = "Right...";
  const CONNOISSEUR_SPEAKER = "[Lucas/Renata/Vincens]";
  const SCENE_SPEAKERS = { "Colosseum Announcer": ANNOUNCER_NPC_ID, Minotaur: CUTSCENE_MINOTAUR_NPC_ID };

  let quest;
  /** Player -> den or arena scene. */
  const scenes = new Map();
  const playerTasks = new WeakMap();

  // ==========================================================================
  // State
  // ==========================================================================

  function packed(player) {
    return Number(player.getAttribute(VARS_ATTRIBUTE)) || 0;
  }

  function sub(player, name) {
    const [, shift, width] = VARS[name];
    return (packed(player) >>> shift) & ((1 << width) - 1);
  }

  function setSub(player, name, value) {
    const [varbit, shift, width] = VARS[name];
    const mask = ((1 << width) - 1) << shift;
    player.setAttribute(VARS_ATTRIBUTE, ((packed(player) & ~mask) | ((value << shift) & mask)) >>> 0);
    player.getPacketSender().sendVarbit(varbit, value);
  }

  function stage(player) {
    return quest.getStage(player);
  }

  function advance(player, value) {
    if (stage(player) < value) quest.setStage(player, value);
  }

  function heldCount(player, itemId) {
    return player.getInventory().getAmount(itemId);
  }

  function freeSlots(player) {
    return player.getInventory().getFreeSlots();
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function portions(player) {
    return Object.fromEntries(INGREDIENTS.map((name) => [name, sub(player, `${name}Portions`)]));
  }

  function recipeCorrect(player) {
    const current = portions(player);
    return INGREDIENTS.every((name) => current[name] === RECIPE[name]);
  }

  function amount(count) {
    return `${WORDS[count]} portion${count === 1 ? "" : "s"}`;
  }

  /** The transcript's "[number] portion[s]" blanks, in meat/salad/spice/sauce order, in words. */
  function fillPortions(player, text) {
    const current = portions(player);
    let index = 0;
    return text.replace(/\[number\] portion\[s\]/g, () => amount(current[INGREDIENTS[index++]] || 1));
  }

  /** Both deliveries sent moves the quest on, whichever finished last. */
  function deliveriesSorted(player) {
    if (sub(player, "spice") === 4 && sub(player, "meat") === 4) advance(player, STAGE_INGREDIENTS);
  }

  function later(key, ticks, callback) {
    if (key?.isPlayer?.()) {
      const player = key;
      key = playerTasks.get(player);
      if (!key) { key = {}; playerTasks.set(player, key); }
    }
    TaskManager.submit(new CountdownTask(key, ticks, callback));
  }

  function variantSteps(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }

  /** The step list holding a step id anywhere in a variant, and its index there. */
  function locate(steps, id) {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (step?.id === id) return { list: steps, index };
      for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const found = Array.isArray(nested) ? locate(nested, id) : null;
        if (found) return found;
      }
    }
    return null;
  }

  // ==========================================================================
  // Variants
  // ==========================================================================

  function selectEmelio(player) {
    const current = stage(player);
    if (current === 0) return "starting-out-talking-to-emelio";
    if (current <= STAGE_DELIVERIES) {
      if (sub(player, "spice") === 4) return "searching-for-spices-talking-to-emelio-after-unlocking-the-box-before-taking-care-of-the-buffalo-meat";
      if (sub(player, "meat") === 4) return "browsing-for-buffalo-meat-talking-to-emelio-after-taking-care-of-the-buffalo-meat-before-unlocking-the-spice-box";
      return "starting-out-talking-to-emelio-again";
    }
    if (current === STAGE_INGREDIENTS) return "making-the-ultimate-kebab-talking-to-emelio";
    if (current === STAGE_RECIPE) {
      if (sub(player, "testing") === 1) return "making-the-ultimate-kebab-talking-to-emilio-before-getting-a-connoisseur-to-taste-test-the-current-test-kebab";
      if (player.getAttribute(FAILED_TEST_ATTRIBUTE) === true) return "making-the-ultimate-kebab-talking-to-emelio-after-a-failed-taste-test";
      return "making-the-ultimate-kebab-talking-to-emelio-again";
    }
    if (current === STAGE_TESTED) return "making-the-ultimate-kebab-talking-to-emelio-after-a-successful-taste-test";
    if (current === STAGE_MARKETING) return "making-the-ultimate-kebab-talking-to-emelio-again-after-a-successful-taste-test";
    if (current === STAGE_KEBABS) return "making-the-ultimate-kebab-talking-to-emelio-after-receiving-the-two-test-kebabs";
    if (current < STAGE_FIGHT) {
      // Quest Helper's getAnotherKebabFromEmelio leg applies once Lelia has eaten one:
      // the restock dialogue is the stage-10/14 "two test kebabs" variant.
      return heldCount(player, LELIA_KEBAB_ITEM_ID) === 0
        ? "making-the-ultimate-kebab-talking-to-emelio-after-receiving-the-two-test-kebabs"
        : "guerilla-marketing-talking-to-emilio-after-giving-leila-a-test-kebab";
    }
    if (current === STAGE_FIGHT) return "guerilla-marketing-talking-to-emilio-after-leaving-the-fortis-colosseum-but-before-killing-the-minotaur";
    if (current < STAGE_COMPLETE) return "wrapping-up";
    return { page: "Emelio", variant: "standard-dialogue-after-meat-and-greet" };
  }

  function selectSpiceMerchant(player) {
    if (stage(player) !== STAGE_DELIVERIES) return null;
    const spice = sub(player, "spice");
    // The unlock scene's final line sends the delivery; resume it if interrupted.
    if (spice === 3) return "searching-for-spices-unlocking-the-box";
    if (spice >= 4) return "searching-for-spices-talking-to-the-spice-merchant-after-unlocking-the-box";
    return spice === 2 ? "searching-for-spices-talking-to-the-spice-merchant-again" : "searching-for-spices";
  }

  function selectAlba(player) {
    const current = stage(player);
    if (current > STAGE_DELIVERIES || (current === STAGE_DELIVERIES && sub(player, "meat") === 4)) return { page: "Alba", variant: "after-meat-and-greet" };
    if (current !== STAGE_DELIVERIES) return { page: "Alba", variant: "before-meat-and-greet" };
    const meat = sub(player, "meat");
    if (meat === 3) return "browsing-for-buffalo-meat-talking-to-alba-after-killing-the-dire-wolf-alpha";
    return meat === 2 ? "browsing-for-buffalo-meat-talking-to-alba-talking-to-alba-again" : "browsing-for-buffalo-meat-talking-to-alba";
  }

  function selectConnoisseur(player, name) {
    const current = stage(player);
    const suffix = name.toLowerCase();
    if (current >= STAGE_TESTED) return `making-the-ultimate-kebab-talking-to-${suffix}-after-a-successful-taste-test`;
    if (current === STAGE_RECIPE) {
      return heldCount(player, TEST_KEBAB_ITEM_ID) > 0
        ? "making-the-ultimate-kebab-getting-the-connoisseurs-to-taste-test-the-current-test-kebab"
        : `making-the-ultimate-kebab-talking-to-${suffix}`;
    }
    return current === STAGE_INGREDIENTS ? `making-the-ultimate-kebab-talking-to-${suffix}-before-emelio` : null;
  }

  function selectLelia(player) {
    const current = stage(player);
    if (current === STAGE_KEBABS) return "guerilla-marketing";
    if (current === STAGE_LELIA_ATE || current === STAGE_ADVERT) return "guerilla-marketing-talking-to-leila-after-being-told-to-market-the-kebab";
    if (current === STAGE_FIGHT) return "guerilla-marketing-talking-to-lelia-after-leaving-the-fortis-colosseum-but-before-killing-the-minotaur";
    if (current === STAGE_MINOTAUR_DEAD) return "guerilla-marketing-talking-to-lelia-after-killing-the-minotaur";
    if (current === STAGE_TOLD) return "guerilla-marketing-talking-to-lelia-again-after-killing-the-minotaur";
    return null;
  }

  function selectVariant({ npcId, player }) {
    if (!quest || !player) return null;
    if (npcId === EMELIO_NPC_ID) return selectEmelio(player);
    if (npcId === SPICE_MERCHANT_NPC_ID) return selectSpiceMerchant(player);
    if (npcId === ALBA_NPC_ID) return selectAlba(player);
    if (npcId === LELIA_NPC_ID) return selectLelia(player);
    if (CONNOISSEURS[npcId]) return selectConnoisseur(player, CONNOISSEURS[npcId]);
    return null;
  }

  /**
   * Repairs the variants whose Wiki "above" jumps the transcript cannot follow, and builds
   * Emelio's recipe menus with the current portions, as captured.
   */
  function shapeVariant(player, variant, steps) {
    if (variant === "guerilla-marketing") return [...steps.slice(0, -1), readyCheck(steps.at(-1))];
    if (variant === "making-the-ultimate-kebab-talking-to-emelio-again") return recipeOpening(player, steps);
    if (variant === "making-the-ultimate-kebab-talking-to-emelio-after-a-failed-taste-test") {
      return [...steps.slice(0, 2), { ...steps[2], text: fillPortions(player, steps[2].text) }, ...recipeMenu(player)];
    }
    if (variant === "making-the-ultimate-kebab-talking-to-emelio-again-after-a-successful-taste-test") {
      const full = variantSteps("making-the-ultimate-kebab-talking-to-emelio-after-a-successful-taste-test");
      return full.slice(full.findIndex((step) => step.text === MARKETING_LINE));
    }
    if (variant === "guerilla-marketing-talking-to-leila-after-being-told-to-market-the-kebab") {
      const conditions = variantSteps("guerilla-marketing").filter((step) => step.type === "condition");
      return [steps[0], ...conditions.slice(0, -1), readyCheck(conditions.at(-1))];
    }
    if (variant === "guerilla-marketing-talking-to-lelia-after-leaving-the-fortis-colosseum-but-before-killing-the-minotaur") {
      return [...steps.slice(0, -1), {
        type: "choice",
        options: [
          { text: "I think so.", steps: [{ player: "I think so." }, { type: "action", id: "mag:fight-again" }] },
          { text: "I need to prepare first.", steps: [{ player: "I need to prepare first." }, { type: "line", speaker: "Lelia", text: "Well make it quick." }] },
        ],
      }];
    }
    return steps;
  }

  /** Lelia's "ready?" menu, as captured: "I think so." beside "I need to prepare first." (split apart in the export). */
  function readyCheck(condition) {
    const [ready, , prepare] = condition.steps;
    if (ready?.type !== "choice" || prepare?.type !== "choice") return condition;
    return { ...condition, steps: [{ ...ready, options: [...ready.options, ...prepare.options] }] };
  }

  function recipeOpening(player, steps) {
    const [opening, menu] = steps;
    const thinkSo = menu.options[0];
    const firstTime = INGREDIENTS.every((name) => sub(player, `${name}Portions`) === 0);
    const again = variantSteps("making-the-ultimate-kebab-talking-to-emelio-again-after-saying-that-the-ingredient-ratios-were-found")[0];
    const summary = firstTime
      ? [{ type: "action", id: "mag:first-recipe" }, thinkSo.steps[0]]
      : [{ ...again, text: fillPortions(player, again.text) }];
    return [opening, {
      ...menu,
      options: [
        { ...thinkSo, steps: [{ player: "I think so." }, ...summary, { type: "action", id: "mag:recipe-menu" }] },
        ...menu.options.slice(1),
      ],
    }];
  }

  /** Emelio's adjust menu: the current portions in the option text, as captured. */
  function recipeMenu(player) {
    const current = portions(player);
    const adjust = variantSteps("making-the-ultimate-kebab-talking-to-emelio-again")[1].options[0].steps.find((step) => step.type === "choice");
    const perfect = adjust.options.find((option) => option.text === "I think that's perfect!").steps;
    const [said, summary, happy] = perfect;
    return [{
      type: "choice",
      prompt: "Select an option",
      options: [
        ...INGREDIENTS.map((name) => ({
          text: `Adjust ${name} (currently at ${amount(current[name] || 1)}).`,
          steps: [{ type: "action", id: `mag:adjust:${name}` }],
        })),
        {
          text: "I think that's perfect!",
          steps: [said, { ...summary, text: fillPortions(player, summary.text) }, {
            ...happy,
            options: [happy.options[0], { ...happy.options[1], steps: [...happy.options[1].steps, { type: "action", id: "mag:recipe-menu" }] }],
          }],
        },
      ],
    }];
  }

  function portionMenu(player, name) {
    const current = portions(player)[name] || 1;
    return [{
      type: "choice",
      prompt: `Adjust number of ${name} portions to:`,
      options: [
        ...[1, 2, 3, 4].map((count) => ({
          text: `${WORDS[count][0].toUpperCase()}${WORDS[count].slice(1)}${count === current ? " (current)" : ""}.`,
          steps: [
            { type: "action", id: `mag:set:${name}:${count}` },
            { player: `Let's try ${amount(count)} of ${name}.` },
            { type: "line", speaker: "Emelio", text: count === current ? "That's what we have already. Maybe we should change something else." : "Very well. Anything else?" },
            { type: "action", id: "mag:recipe-menu" },
          ],
        })),
        { text: "Cancel.", steps: [{ type: "action", id: "mag:recipe-menu" }] },
      ],
    }];
  }

  /** Talk-to plays the quest's own variant, reshaped where the Wiki export needs it. */
  function talkTo(event, npcId) {
    const { player } = event;
    if (event.npcId !== npcId || scenes.has(player)) return false;
    const choice = selectVariant({ npcId, player });
    if (typeof choice !== "string") return false;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, choice, (steps) => shapeVariant(player, choice, steps), event.npc ?? null);
    return true;
  }

  // ==========================================================================
  // Conditions, lines and actions
  // ==========================================================================

  function answerCondition({ npcId, player, stepId }) {
    switch (stepId) {
      case "VVK8P_": case "QCbFCI": case "G_sGI4":
        return freeSlots(player) === 0;
      case "PNqiJZ": case "pt89vQ":
        return freeSlots(player) > 0;
      case "xP8rLp":
        return heldCount(player, TEST_KEBAB_ITEM_ID) === 0;
      case "yUPGB0":
        return heldCount(player, TEST_KEBAB_ITEM_ID) > 0;
      case "3_tkee": case "iIEWvT":
        return freeSlots(player) < 2;
      case "r0O40y": case "pii5SL":
        return freeSlots(player) >= 2;
      case "V-2FC1":
        return heldCount(player, LELIA_KEBAB_ITEM_ID) === 1;
      case "cL9ltx":
        return heldCount(player, LELIA_KEBAB_ITEM_ID) === 0;
      case "iOngTK":
        return heldCount(player, LELIA_KEBAB_ITEM_ID) >= 2;
      case "nfs5Ro":
        return CONNOISSEURS[npcId] ? !recipeCorrect(player) : null;
      case "qy1Uj2":
        return CONNOISSEURS[npcId] ? recipeCorrect(player) : null;
      case "t1LsOv": case "TK2D06": case "Nf11kS":
        return heldCount(player, LELIA_KEBAB_ITEM_ID) === 0;
      case "1Ji6Ve": case "6jK71j": case "6-kSjK":
        return heldCount(player, LELIA_KEBAB_ITEM_ID) > 0;
      default:
        return null;
    }
  }

  /** Line events fire as a run of lines is queued, so state the capture changes as a line appears goes in `before`. */
  function handleLine(event) {
    const { player, npcId, text, step } = event;
    if (typeof text !== "string") return;
    const at = (expected, action) => { if (text === expected) event.before = action; };
    if (text.includes("[number] portion[s]")) event.text = fillPortions(player, text);
    if (CONNOISSEURS[npcId] && step?.speaker === CONNOISSEUR_SPEAKER) {
      event.speakerId = npcId;
      event.speakerName = CONNOISSEURS[npcId];
    }
    if (SCENE_SPEAKERS[step?.speaker]) {
      event.speakerId = SCENE_SPEAKERS[step.speaker];
      event.speakerName = step.speaker;
    }
    const current = stage(player);
    if (npcId === EMELIO_NPC_ID) {
      if (current === STAGE_STARTED) at(START_LINE, () => {
        advance(player, STAGE_DELIVERIES);
        if (sub(player, "spice") === 0) setSub(player, "spice", 1);
        if (sub(player, "meat") === 0) setSub(player, "meat", 1);
      });
      if (current === STAGE_INGREDIENTS) at(RECIPE_TASK_LINE, () => advance(player, STAGE_RECIPE));
      if (current === STAGE_TESTED) at(MARKETING_LINE, () => advance(player, STAGE_MARKETING));
      // Stage 22 still owes Lelia's "tell Emelio" conversation (24); only the told stage hands in.
      if (current >= STAGE_TOLD && current < STAGE_COMPLETE && text === DONE_LINE) event.after = () => quest.complete(player);
      return;
    }
    if (npcId === SPICE_MERCHANT_NPC_ID) {
      if (sub(player, "spice") === 1) at(SPICE_LOOK_LINE, () => setSub(player, "spice", 2));
      if (sub(player, "spice") === 3) at(SPICE_SENT_LINE, () => { setSub(player, "spice", 4); deliveriesSorted(player); });
      return;
    }
    if (npcId === ALBA_NPC_ID) {
      if (sub(player, "meat") === 1) at(ALBA_TASK_LINE, () => setSub(player, "meat", 2));
      if (sub(player, "meat") === 3) at(ALBA_SENT_LINE, () => { setSub(player, "meat", 4); deliveriesSorted(player); });
      return;
    }
    if (npcId === LELIA_NPC_ID) {
      if (current === STAGE_LELIA_ATE) at(ADVERT_LINE, () => advance(player, STAGE_ADVERT));
      if (current === STAGE_MINOTAUR_DEAD) at(TOLD_LINE, () => advance(player, STAGE_TOLD));
      if (current === STAGE_ADVERT && text === FIGHT_LINE) event.after = () => startFight(player, true);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    const id = String(stepId ?? "");
    if (id.startsWith("mag:")) {
      event.handled = true;
      if (id === "mag:first-recipe") for (const name of INGREDIENTS) setSub(player, `${name}Portions`, 1);
      if (id === "mag:recipe-menu") event.steps = recipeMenu(player);
      if (id.startsWith("mag:adjust:")) event.steps = portionMenu(player, id.slice("mag:adjust:".length));
      if (id.startsWith("mag:set:")) {
        const [, , name, count] = id.split(":");
        setSub(player, `${name}Portions`, Number(count));
      }
      if (id === "mag:fight-again") startFight(player, false);
      return;
    }
    if (event.kind === "message") {
      if (TEST_KEBAB_MESSAGES.has(stepId)) event.box = { items: [TEST_KEBAB_ITEM_ID] };
      if (stepId === KEBABS_MESSAGE || stepId === LELIA_EATS_STEP || RESTOCK_MESSAGES.has(stepId)) event.box = { items: [LELIA_KEBAB_ITEM_ID] };
      if (stepId === UNLOCKED_STEP) event.box = { statement: true };
    }
    if (npcId === SPICE_MERCHANT_NPC_ID && BOX_STEP_IDS.has(stepId)) {
      event.handled = true;
      event.end = true;
      // The transcript closes its chatbox as this action ends; the keypad opens after.
      later(player, 1, () => openSpiceBox(player));
      return;
    }
    if (npcId === EMELIO_NPC_ID) {
      if (TEST_KEBAB_MESSAGES.has(stepId)) {
        if (heldCount(player, TEST_KEBAB_ITEM_ID) === 0) player.getInventory().adds(TEST_KEBAB_ITEM_ID, 1);
        setSub(player, "testing", 1);
        player.setAttribute(FAILED_TEST_ATTRIBUTE, false);
      }
      if (TEST_KEBAB_STEP_IDS.has(stepId) || stepId === KEBABS_ACTION) event.handled = true;
      if (stepId === KEBABS_MESSAGE) {
        player.getInventory().adds(LELIA_KEBAB_ITEM_ID, Math.max(0, 2 - heldCount(player, LELIA_KEBAB_ITEM_ID)));
        advance(player, STAGE_KEBABS);
      }
      if (RESTOCK_MESSAGES.has(stepId)) {
        const target = stage(player) >= STAGE_LELIA_ATE ? 1 : 2;
        player.getInventory().adds(LELIA_KEBAB_ITEM_ID, Math.max(0, target - heldCount(player, LELIA_KEBAB_ITEM_ID)));
      }
      return;
    }
    if (CONNOISSEURS[npcId] && stepId === TASTE_STEP) {
      event.handled = true;
      if (heldCount(player, TEST_KEBAB_ITEM_ID) > 0) player.getInventory().deleteNumber(TEST_KEBAB_ITEM_ID, 1);
      event.npc?.performAnimation?.(new Animation(EAT_ANIMATION));
      if (recipeCorrect(player)) {
        advance(player, STAGE_TESTED);
      } else {
        setSub(player, "testing", 0);
        player.setAttribute(FAILED_TEST_ATTRIBUTE, true);
      }
      return;
    }
    if (npcId === LELIA_NPC_ID) {
      if (stepId === LELIA_EATS_STEP && stage(player) === STAGE_KEBABS) {
        // Without a kebab there is nothing to eat; the transcript's ready check then sends the
        // player back to Emelio, whose restock dialogue covers the lost item.
        if (heldCount(player, LELIA_KEBAB_ITEM_ID) === 0) return;
        player.getInventory().deleteNumber(LELIA_KEBAB_ITEM_ID, 1);
        event.npc?.performAnimation?.(new Animation(EAT_ANIMATION));
        advance(player, STAGE_LELIA_ATE);
      }
      if (stepId === ADVERT_STEP) {
        event.handled = true;
        // Returning to Lelia after she ate (stage 16) uses the short ready-check variant,
        // which has no "Yup..." line; agreeing there must still mark the advert ready.
        if (stage(player) === STAGE_LELIA_ATE) advance(player, STAGE_ADVERT);
        beginAdvert(player);
      }
      if (stepId === ADVERT_EAT_STEP) {
        event.handled = true;
        player.performAnimation(new Animation(EAT_ANIMATION));
      }
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== EMELIO_NPC_ID || hook !== START_HOOK || stage(player) !== 0) return;
    if (!isQuestComplete(player, CHILDREN_OF_THE_SUN_KEY)) {
      player.sendMessage("You must complete Children of the Sun before starting this quest.");
      return;
    }
    player.setAttribute(VARS_ATTRIBUTE, 0);
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage("You've started a new quest: <col=081190>Meat and Greet</col>");
  }

  // ==========================================================================
  // The spice box
  // ==========================================================================

  function openSpiceBox(player) {
    if (stage(player) !== STAGE_DELIVERIES || sub(player, "spice") !== 2) return;
    player.getPacketSender().sendInterface(KEYPAD_INTERFACE).sendClientScript(KEYPAD_SCRIPT, ...KEYPAD_SCRIPT_ARGS);
    player.setEnteredAmountAction({ execute: (value) => enterCode(player, value) });
  }

  function enterCode(player, value) {
    if (stage(player) !== STAGE_DELIVERIES || sub(player, "spice") !== 2) return;
    player.getPacketSender().sendInterfaceRemoval();
    // ponytail: a wrong code's reply is not recorded; the box just stays shut.
    if (Number(value) !== SPICE_BOX_CODE) {
      player.sendMessage("The box remains locked.");
      return;
    }
    setSub(player, "spice", 3);
    player.getPacketSender().sendSound(UNLOCK_SOUND, 1, 0);
    startTranscript(api, player, SPICE_MERCHANT_NPC_ID, PAGE, "searching-for-spices-unlocking-the-box");
  }

  // ==========================================================================
  // Scenes: the wolf den and the Colosseum
  // ==========================================================================

  class MagScene extends PrivateArea {
    constructor(player, [minX, maxX, minY, maxY, z]) {
      super([new Boundary(minX, maxX, minY, maxY, z)]);
      this.owner = player;
    }
    postLeave(mobile, logout) {
      const scene = scenes.get(mobile);
      if (mobile === this.owner && scene?.area === this) {
        scene.area = null;
        endScene(mobile, logout);
      }
      super.postLeave(mobile, logout);
    }
  }

  function fade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, 174, 1, {
      postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }

  function controls(player, active, cutscene = false) {
    player.getMovementQueue().reset().setBlockMovement(active);
    player.setUntargetable(active && cutscene);
    player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, active ? 2 : 0);
    if (cutscene || !active) player.getPacketSender().sendVarbit(CUTSCENE_STATUS_VARBIT, active ? 1 : 0);
  }

  function hold(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, "", false) })
    ));
  }

  function face(player, [x, y]) {
    player.setPositionToFace(new Location(x, y, player.getLocation().getZ()));
  }

  function actor(player, scene, id, [x, y, z = 0], faceTile) {
    const npc = api.spawnNpc({ id, x, y, z, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__meatAndGreetOwner = player;
    scene.area.add(npc);
    scene.actors.push(npc);
    if (faceTile) npc.setPositionToFace(new Location(faceTile[0], faceTile[1], z));
    return npc;
  }

  /** A loc only this scene shows; `opFlags` hides ops (the den exit until the alpha falls). */
  function sceneLoc(scene, { id, x, y, z, type, face: rotation }, opFlags) {
    const loc = new GameObject(id, new Location(x, y, z), type, rotation, scene.area);
    if (opFlags !== undefined) {
      loc.opFlags = opFlags;
      loc.getOpFlags = () => loc.opFlags;
    }
    scene.area.add(loc);
    scene.locs.push(loc);
    scene.owner.getPacketSender().sendObject(loc);
    return loc;
  }

  function openScene(player, name, bounds) {
    const scene = { name, owner: player, actors: [], locs: [], area: new MagScene(player, bounds) };
    scenes.set(player, scene);
    scene.area.enter(player);
    return scene;
  }

  function endScene(player, logout) {
    const scene = scenes.get(player);
    if (!scene) return;
    scenes.delete(player);
    TaskManager.cancelTasks(scene);
    for (const npc of scene.actors.splice(0)) api.removeNpc(npc);
    for (const loc of scene.locs.splice(0)) player.getPacketSender().sendObjectRemoval(loc);
    const area = scene.area;
    scene.area = null;
    if (area && player.getArea() === area) area.leave(player, logout);
    controls(player, false);
    player.getPacketSender().sendCameraReset();
    if (logout) player.moveTo(new Location(...(scene.name === "den" ? DEN_EXIT_TILE : LOBBY_TILE)));
  }

  /** Crawling in or out: the crawl, a fade, the move two ticks on and the fade back. */
  function crawl(player, arrive) {
    controls(player, true);
    player.performAnimation(new Animation(CRAWL_ANIMATION));
    fade(player, true);
    later(player, 2, arrive);
    later(player, 3, () => { fade(player, false); controls(player, false); });
  }

  function enterDen(event) {
    const { player } = event;
    if (sub(player, "meat") !== 2 || scenes.has(player)) return false;
    event.handled = true;
    crawl(player, () => {
      const scene = openScene(player, "den", DEN_BOUNDS);
      player.moveTo(new Location(...DEN_ENTRY_TILE));
      face(player, [DEN_ENTRY_TILE[0] - 1, DEN_ENTRY_TILE[1]]);
      scene.alpha = actor(player, scene, DIRE_WOLF_ALPHA_NPC_ID, ALPHA_TILE, [1483, 9501]);
      scene.exit = sceneLoc(scene, DEN_EXIT_LOC, 0);
      later(scene, 2, () => scene.alpha?.forceChat("Grrr!"));
    });
    return true;
  }

  function leaveDen(event) {
    const { player } = event;
    const scene = scenes.get(player);
    if (scene?.name !== "den") return false;
    event.handled = true;
    if (sub(player, "meat") < 3) return true;
    crawl(player, () => {
      endScene(player, false);
      player.moveTo(new Location(...DEN_EXIT_TILE));
      face(player, [DEN_EXIT_TILE[0] + 1, DEN_EXIT_TILE[1]]);
    });
    return true;
  }

  function beginAdvert(player) {
    if (scenes.has(player)) return;
    hold(player);
    fade(player, true);
    later(player, 2, () => {
      const scene = openScene(player, "arena", ARENA_BOUNDS);
      controls(player, true, true);
      player.moveTo(new Location(...ADVERT_TILE, 0));
      face(player, [ADVERT_TILE[0], ADVERT_TILE[1] + 1]);
      scene.cutscene = actor(player, scene, CUTSCENE_MINOTAUR_NPC_ID, CUTSCENE_MINOTAUR_TILE, [1824, 3105]);
      later(scene, 1, () => player.getPacketSender().sendCameraMoveTo(1819, 3099, 600, CAMERA_RATES).sendCameraLookAt(1826, 3112, 300, CAMERA_RATES));
      later(scene, 2, () => fade(player, false));
      later(scene, 4, () => {
        startTranscript(api, player, LELIA_NPC_ID, PAGE, "guerilla-marketing", (steps) => {
          const found = locate(steps, ADVERT_STEP);
          return found ? found.list.slice(found.index + 1) : [];
        });
      });
    });
  }

  /** The minotaur turns: fade, the fighting minotaur and the way out; or straight back in. */
  function startFight(player, fromAdvert) {
    if (fromAdvert) {
      advance(player, STAGE_FIGHT);
      if (heldCount(player, LELIA_KEBAB_ITEM_ID) > 0) player.getInventory().deleteNumber(LELIA_KEBAB_ITEM_ID, 1);
    }
    hold(player);
    fade(player, true);
    controls(player, true);
    later(scenes.get(player) ?? player, 2, () => {
      let scene = scenes.get(player);
      if (scene) {
        for (const npc of scene.actors.splice(0)) api.removeNpc(npc);
      } else {
        scene = openScene(player, "arena", ARENA_BOUNDS);
      }
      player.getDialogueManager().reset();
      player.moveTo(new Location(...FIGHT_TILE, 0));
      face(player, [FIGHT_TILE[0], FIGHT_TILE[1] + 1]);
      scene.minotaur = actor(player, scene, MINOTAUR_NPC_ID, MINOTAUR_TILE, FIGHT_TILE);
      scene.gate = sceneLoc(scene, ARENA_GATE);
      player.getPacketSender().sendCameraReset().sendVarbit(CUTSCENE_STATUS_VARBIT, 0);
      player.setUntargetable(false);
      api.emitCustomEvent("music:unlock-track", { player, trackId: ARENA_TRACK_ID });
      player.getPacketSender().sendSong(ARENA_TRACK_ID);
      later(scene, 2, () => { fade(player, false); controls(player, false); });
    });
  }

  function leaveArena(event) {
    const { player } = event;
    if (scenes.get(player)?.name !== "arena") return false;
    event.handled = true;
    endScene(player, false);
    player.moveTo(new Location(...LOBBY_TILE));
    face(player, [LOBBY_TILE[0], LOBBY_TILE[1] + 1]);
    return true;
  }

  /** Back to Lelia in the lobby after the kill, and her verdict. */
  function minotaurDefeated(player) {
    const scene = scenes.get(player);
    if (!scene) return;
    later(scene, 1, () => {
      advance(player, STAGE_MINOTAUR_DEAD);
      fade(player, true);
      controls(player, true);
    });
    later(scene, 3, () => {
      endScene(player, false);
      player.moveTo(new Location(...LOBBY_TILE));
      face(player, [LOBBY_TILE[0], LOBBY_TILE[1] + 1]);
      controls(player, true);
      later(player, 2, () => { fade(player, false); controls(player, false); });
      later(player, 4, () => startTranscript(api, player, LELIA_NPC_ID, PAGE, "guerilla-marketing-talking-to-lelia-after-killing-the-minotaur"));
    });
  }

  // ==========================================================================
  // Combat: the alpha's pack call and the minotaur
  // ==========================================================================

  /** The provider builds a method per attack, so the fight's state lives on the minotaur. */
  class QuestMinotaurCombat extends CombatMethod {
    constructor(npc) {
      super();
      this.state = npc ? (npc.__minotaurFight ??= { swings: 0, speed: MINOTAUR.speed, shouts: 0, current: "melee" })
        : { swings: 0, speed: MINOTAUR.speed, shouts: 0, current: "melee" };
    }
    /** What the next swing is; attackSpeed runs before start, so this must not change state. */
    kind() {
      const state = this.state;
      if (state.shouts > 0) return "shout";
      return state.swings % MINOTAUR.magicEvery === MINOTAUR.magicEvery - 1 ? "magic" : "melee";
    }
    type() { return this.state.current === "magic" ? CombatType.MAGIC : CombatType.MELEE; }
    attackSpeed() { return this.kind() === "shout" ? MINOTAUR.shoutSpeed : this.state.speed; }
    attackDistance() { return 1; }
    start(npc, target) {
      const state = this.state;
      state.current = this.kind();
      if (state.current === "shout") {
        state.shouts--;
        state.speed--;
        npc.performAnimation(new Animation(MINOTAUR.shout));
        npc.forceChat("Moooooo!");
        const sender = target.getPacketSender?.();
        for (let axis = 0; axis < 3; axis++) sender?.sendCameraShake(axis, 5, 0, 0);
        later(npc, 2, () => target.getPacketSender?.().sendCameraReset());
        return;
      }
      state.swings++;
      if (state.current === "magic") {
        npc.performAnimation(new Animation(MINOTAUR.magic));
        npc.performGraphic(new Graphic(MINOTAUR.cast));
        target.getPacketSender?.().sendSound(MINOTAUR.castSound, 1, 0);
        return;
      }
      npc.performAnimation(new Animation(MINOTAUR.melee));
      // The "Moo!" warning comes half a cycle before the magic swing.
      if (this.kind() === "magic") later(npc, state.speed - Math.floor(state.speed / 2), () => npc.forceChat("Moo!"));
    }
    hits(npc, target) {
      const current = this.state.current;
      if (current === "shout") return [];
      if (current !== "magic") return [new PendingHit(npc, target, this, 0)];
      const hit = new PendingHit(npc, target, this, 2);
      const blocked = !hit.isAccurate() || PrayerHandler.isActivated(target, PrayerHandler.PROTECT_FROM_MAGIC);
      target.performGraphic(new Graphic(blocked ? MINOTAUR.splash : MINOTAUR.impact, 60, 120));
      return [hit];
    }
  }

  /** The alpha calls one pack wolf; the minotaur shouts at its thresholds. */
  function handleHitResolved({ target }) {
    if (!target?.isNpc?.()) return;
    const owner = target.__meatAndGreetOwner;
    const scene = owner ? scenes.get(owner) : null;
    if (!scene) return;
    const ratio = target.getHitpoints() / Math.max(1, target.getMaxHitpoints?.() ?? 1);
    if (target === scene.alpha) {
      if (target.getHitpoints() <= 0) alphaDown(owner, scene);
      else if (!scene.packCalled && ratio <= PACK_CALL_FRACTION) callPack(owner, scene);
      return;
    }
    if (target === scene.minotaur && target.getHitpoints() > 0) {
      const fight = new QuestMinotaurCombat(target).state;
      scene.thresholds ??= [...MINOTAUR.thresholds];
      while (scene.thresholds.length && ratio <= scene.thresholds[0]) {
        scene.thresholds.shift();
        fight.shouts++;
      }
    }
  }

  function callPack(player, scene) {
    scene.packCalled = true;
    player.sendMessage("<col=e00a19>The dire wolf calls to its pack!");
    scene.alpha.forceChat("Aarrooooo!");
    const at = player.getLocation();
    scene.pack = actor(player, scene, DIRE_WOLF_NPC_ID, PACK_WOLF_TILE, [at.getX(), at.getY()]);
    scene.pack?.getCombat().attack(player);
  }

  /** The alpha falls: the meat is sorted, the exit opens and the pack wolf flees. */
  function alphaDown(player, scene) {
    if (scene.alphaDown) return;
    scene.alphaDown = true;
    setSub(player, "meat", 3);
    if (scene.exit) {
      scene.exit.opFlags = 1;
      player.getPacketSender().sendObject(scene.exit);
    }
    const wolf = scene.pack;
    if (!wolf || wolf.getHitpoints?.() <= 0) return;
    wolf.getCombat().reset?.();
    wolf.forceChat("Aarrooooo!");
    wolf.getMovementQueue().addSteps(new Location(DEN_EXIT_LOC.x, DEN_EXIT_LOC.y, DEN_EXIT_LOC.z));
    later(scene, 3, () => {
      api.removeNpc(wolf);
      scene.actors = scene.actors.filter((npc) => npc !== wolf);
    });
  }

  function handleNpcDeath(event) {
    const owner = event.npc?.__meatAndGreetOwner;
    const scene = owner ? scenes.get(owner) : null;
    if (!scene) return;
    scene.actors = scene.actors.filter((npc) => npc !== event.npc);
    if (event.npc === scene.alpha) alphaDown(owner, scene);
    if (event.npc === scene.minotaur && stage(owner) === STAGE_FIGHT) minotaurDefeated(owner);
  }

  // ==========================================================================
  // Saves from the old stage model
  // ==========================================================================

  /** Old stages 1-7 (and their bits) onto the captured values, once. */
  function migrate(player) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === STAGE_VERSION) return;
    const old = stage(player);
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    if (old <= 0 || old > 7) return;
    const bits = Number(player.getAttribute(OLD_BITS_ATTRIBUTE)) || 0;
    const has = (bit) => (bits & (1 << bit)) !== 0;
    const mapped = [0, STAGE_DELIVERIES, STAGE_INGREDIENTS, STAGE_RECIPE, STAGE_TESTED,
      has(6) ? STAGE_FIGHT : has(5) ? STAGE_ADVERT : STAGE_KEBABS, STAGE_MINOTAUR_DEAD, STAGE_COMPLETE][old];
    player.setAttribute(VARS_ATTRIBUTE, 0);
    setSub(player, "spice", old > 1 || has(1) ? 4 : has(0) ? 2 : 1);
    setSub(player, "meat", old > 1 || has(4) ? 4 : has(3) ? 3 : has(2) ? 2 : 1);
    if (old >= 3) {
      const recipe = Number(player.getAttribute(OLD_RECIPE_ATTRIBUTE)) || 0;
      INGREDIENTS.forEach((name, index) => setSub(player, `${name}Portions`, ((recipe >> (index * 3)) & 7) || 1));
    }
    quest.setStage(player, mapped);
  }

  function syncVars({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    migrate(player);
    for (const name of Object.keys(VARS)) player.getPacketSender().sendVarbit(VARS[name][0], sub(player, name));
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (player) endScene(player, true);
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function deliveryLines(player) {
    const lines = [];
    const spice = sub(player, "spice"), meat = sub(player, "meat");
    if (spice === 4) lines.push("I spoke to the Spice Merchant in the Bazaar and sorted out a missing Spice Delivery.");
    else if (spice >= 2) lines.push("The Spice Merchant told me the Spice Delivery had arrived, but asked me to help open it.");
    else lines.push("I need to speak to the Spice Merchant in the Bazaar about a missing Spice Delivery.");
    if (meat === 4) lines.push("I spoke to Alba at Ortus Farm and sorted out a missing Meat Delivery.");
    else if (meat === 3) lines.push("I dealt with the Wolves at the Den west of Ortus Farm. I should ask Alba to send the Meat Delivery.");
    else if (meat === 2) lines.push("Alba asked me to head to the Den west of the Farm and kill the Largest Wolf.");
    else lines.push("I need to speak to Alba at Ortus Farm about a missing Meat Delivery.");
    return lines;
  }

  function buildJournal(player, questHandle) {
    const current = questHandle.getStage(player);
    const intro = [
      "I spoke to Emelio in Outer Fortis. He asked me for some help in",
      "setting up Varlamore's first Kebab Shop. To do so, I chased up",
      "some Missing Deliveries for him.",
    ];
    const recipe = [
      "With the Missing Deliveries sorted, Emelio and I needed to",
      "perfect the recipe for the Kebabs with the help of some",
      "'Connoisseurs'.",
    ];
    if (current >= STAGE_COMPLETE) {
      return [
        "<str>I spoke to Emelio in Outer Fortis and helped him set up</str>",
        "<str>Varlamore's first Kebab Shop. I sorted out the missing</str>",
        "<str>deliveries, perfected the recipe with the Connoisseurs and</str>",
        "<str>advertised the Kebabs at the Fortis Colosseum.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (current >= STAGE_MINOTAUR_DEAD) {
      return [...intro, ...recipe,
        "Lelia arranged a slot for me to enter the Fortis Colosseum and",
        "advertise the Kebabs. A Minotaur went rogue and I had to defeat",
        "it, but the crowd was still impressed.",
        "I should let Emelio know."];
    }
    if (current >= STAGE_FIGHT) {
      return [...intro, ...recipe,
        "Lelia arranged a slot for me to enter the Fortis Colosseum and",
        "advertise the Kebabs. However, a Minotaur involved in the",
        "advertisement went rogue. I'll need to defeat it."];
    }
    if (current >= STAGE_LELIA_ATE) {
      return [...intro, ...recipe,
        "Lelia at the Fortis Colosseum has arranged a slot for me to",
        "enter the Colosseum and advertise the Kebabs. I should speak",
        "to her when I'm ready to do so."];
    }
    if (current >= STAGE_MARKETING) {
      return [...intro, ...recipe,
        "Before we can start selling the Kebabs, Emelio wants us to",
        "market them to the people of Varlamore. He's asked me to take",
        "some to Lelia in the Fortis Colosseum."];
    }
    if (current >= STAGE_TESTED) {
      return [...intro, ...recipe.slice(0, 2), "'Connoisseurs'. I should see what Emelio needs now."];
    }
    if (current >= STAGE_RECIPE) {
      return [...intro,
        "With the Missing Deliveries sorted, Emelio now needs me to help",
        "perfect the recipe for the Kebabs. He's gathered a selection of",
        "'Connoisseurs' to help with this. I'll need to get their opinions",
        "on the right ratio of Ingredients to create the perfect Kebab."];
    }
    if (current >= STAGE_INGREDIENTS) {
      return [...intro.slice(0, 2), "some Missing Deliveries for him. I should see what he needs now."];
    }
    if (current >= STAGE_STARTED) {
      return [
        "I spoke to Emelio in Outer Fortis. He asked me for help in",
        "setting up Varlamore's first Kebab Shop. To do so, he needs me",
        "to chase up some Missing Deliveries.",
        "",
        ...deliveryLines(player),
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Emelio</col> at his home",
      "in <col=800000>Outer Fortis</col>.",
      "",
      "I must have completed <col=800000>Children of the Sun</col> first.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.COOKING, 8000);
  }

  api.persistAttribute(VARS_ATTRIBUTE, 0);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE);
  api.persistAttribute(FAILED_TEST_ATTRIBUTE, false);
  api.persistAttribute(OLD_BITS_ATTRIBUTE);
  api.persistAttribute(OLD_RECIPE_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "meat_and_greet",
    name: "Meat and Greet",
    varpId: VARP_MAG,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.COOKING.getIndex(), amount: 8000, label: "Cooking" }],
    scrollItemId: TEST_KEBAB_ITEM_ID,
    otherRewards: ["Access to Emelio's Kebab Shop"],
    buildJournal,
    onReward: grantReward,
  });

  const talkers = [
    ["Emelio", EMELIO_NPC_ID], ["Spice Merchant", SPICE_MERCHANT_NPC_ID], ["Alba", ALBA_NPC_ID], ["Lelia", LELIA_NPC_ID],
    ...Object.entries(CONNOISSEURS).map(([npcId, name]) => [name, Number(npcId)]),
  ];
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  for (const [name, npcId] of talkers) api.onNpcInteraction(name, { "Talk-to": (event) => talkTo(event, npcId) });
  api.onObjectInteraction("Wolf Den", { Enter: enterDen });
  api.onObjectInteraction("Cave", { Exit: leaveDen, "Quick-exit": leaveDen });
  api.onObjectInteraction("Gate", { Exit: leaveArena, "Quick-exit": leaveArena });
  api.registerNpcCombatMethodProvider([MINOTAUR_NPC_ID], QuestMinotaurCombat, { singleton: false });
  api.onCombatHitResolved(handleHitResolved);
  api.onNpcDeath(handleNpcDeath);
  api.onCustomEvent("player:bootstrap-complete", syncVars);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
