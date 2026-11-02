/**
 * Shadow of the Storm (members).
 *
 * Words come from the "Shadow of the Storm" transcript page; the stage values,
 * NPC visibility varbits and incantation mechanics come from the cache (varp 602
 * "agrith_quest_varp") cross-checked against QuestHelper's ShadowOfTheStorm:
 *
 *   0  not started          40 Denath explained      90 Denath desummoned
 *   10 started (Reen)        50 Matthew told          100 Tanya killed
 *   20 told to infiltrate    60 golem told            110 eight ready
 *   30 in the group          70 tome shown            120 Agrith-Naar summoned
 *                            80 first ritual          124 killed / reward
 *                                                     130 complete
 *
 * The stage is varbit 1372 "agrith_quest" (sibling bits hold the incantation
 * words 1373-1377, kiln 1378, golem 1379, Dave 1380, Badden 1381, Reen 1382).
 * Those siblings and 1381/1382 also drive the legacy Uzer spawns' transforms
 * (1984-1988 -> 893/895/902/912), so they are kept in step with player state.
 *
 * Sources: RSProx capture 3333, cache varp
 * dump, OSRS Wiki transcripts, and Quest Helper pinned at
 * https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/shadowofthestorm/ShadowOfTheStorm.java
 * (stages and IncantationStep ordering). The capture confirms the plane-2 throne
 * room, the 6310 -> (2720,4884,2) / 6282 -> (2721,4911,0) portals, Denath's
 * spoken order and the varbit tome order.
 *
 * Gaps: the broken-kiln objects carry no cache option, so the plugin adds
 * "Search" to their runtime definition (MCP sees it, a stock client cache does
 * not) and re-applies it after startup on login/bootstrap; the ritual page's
 * single 5-word menu is expanded into the captured five picks; the rug
 * merchant's sandstorm dialogue and reading the tome are not wired; "black"
 * clothing is recognised by item name rather than an exhaustive list; the
 * Tanya portal-closing and second-summoning camera/shake/actor beats follow the
 * capture through QuestScenes, but not every cosmetic sound/sequence; cancelling
 * the reward skill menu is recovered by talking to a surviving wizard; a relog
 * during the fight respawns Agrith-Naar.
 */
module.exports = function registerShadowOfTheStormQuest(api) {
  const {
    CountdownTask,
    Flag,
    Item,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    Skill,
    StatementDialogue,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const PAGE = "Shadow of the Storm";
  const GOLEM_PAGE = "Clay golem";
  const START_HOOK = "quest:shadow-of-the-storm:start";

  // ============================================================================
  // Ids
  // ============================================================================

  const VARP_SHADOW_OF_THE_STORM = 602; // agrith_quest_varp
  const VARBIT_AGRITH_QUEST = 1372; // agrith_quest (stage)
  const VARBIT_INCANTATION_WORDS = [1373, 1374, 1375, 1376, 1377]; // agrith_incantation_1..5
  const VARBIT_AGRITH_KILN = 1378;
  const VARBIT_CONVINCED_GOLEM = 1379;
  const VARBIT_CONVINCED_DAVE = 1380;
  const VARBIT_BADDEN_UZER = 1381;
  const VARBIT_REEN_UZER = 1382;

  // Legacy world spawns (npc-spawns.json) whose transforms resolve to the ids above.
  const REEN_ALKHARID_NPC_ID = 1984; // agrith_reen_alkharid -> 893
  const REEN_UZER_NPC_ID = 1985; // agrith_reen_uzer -> 893
  const BADDEN_UZER_NPC_ID = 1986; // agrith_badden_uzer -> 895
  const DAVE_AT_PORTAL_NPC_ID = 1987; // agrith_dave_at_portal -> 902
  const DAVE_IN_PASSAGE_NPC_ID = 913; // agrith_dave_in_passage -> 902
  /** The world's Uzer golem placeholder (varbit 348 -> 5134/5135/5136). */
  const GOLEM_PLACEHOLDER_NPC_ID = 6277;

  const REEN_NPC_IDS = new Set([
    NpcIdentifiers.FATHER_REEN, // 893
    NpcIdentifiers.FATHER_REEN_2, // 894
    REEN_ALKHARID_NPC_ID,
    REEN_UZER_NPC_ID,
  ]);
  const BADDEN_NPC_IDS = new Set([
    NpcIdentifiers.FATHER_BADDEN, // 895
    NpcIdentifiers.FATHER_BADDEN_2, // 896
    BADDEN_UZER_NPC_ID,
  ]);
  const DAVE_NPC_IDS = new Set([
    NpcIdentifiers.EVIL_DAVE, // 901
    NpcIdentifiers.EVIL_DAVE_2, // 902
    DAVE_AT_PORTAL_NPC_ID,
    DAVE_IN_PASSAGE_NPC_ID,
  ]);
  const DENATH_NPC_IDS = new Set([NpcIdentifiers.DENATH, NpcIdentifiers.DENATH_2]); // 897/898
  const ERIC_NPC_IDS = new Set([NpcIdentifiers.ERIC, NpcIdentifiers.ERIC_2]); // 899/900
  const MATTHEW_NPC_IDS = new Set([NpcIdentifiers.MATTHEW, NpcIdentifiers.MATTHEW_2]); // 903/904
  const JENNIFER_NPC_IDS = new Set([NpcIdentifiers.JENNIFER_2, NpcIdentifiers.JENNIFER_3]); // 905/906
  const TANYA_NPC_IDS = new Set([NpcIdentifiers.TANYA, NpcIdentifiers.TANYA_2]); // 907/908
  const PATRICK_NPC_IDS = new Set([NpcIdentifiers.PATRICK, NpcIdentifiers.PATRICK_2]); // 909/910
  const GOLEM_NPC_IDS = new Set([
    NpcIdentifiers.CLAY_GOLEM, // 917
    NpcIdentifiers.CLAY_GOLEM_2, // 918
    NpcIdentifiers.BROKEN_CLAY_GOLEM, // 5134
    NpcIdentifiers.DAMAGED_CLAY_GOLEM, // 5135
    NpcIdentifiers.CLAY_GOLEM_3, // 5136
    GOLEM_PLACEHOLDER_NPC_ID,
  ]);
  const OWN_NPC_IDS = new Set([
    ...REEN_NPC_IDS,
    ...BADDEN_NPC_IDS,
    ...DAVE_NPC_IDS,
    ...DENATH_NPC_IDS,
    ...ERIC_NPC_IDS,
    ...MATTHEW_NPC_IDS,
    ...JENNIFER_NPC_IDS,
    ...TANYA_NPC_IDS,
    ...PATRICK_NPC_IDS,
    ...GOLEM_NPC_IDS,
  ]);
  /** Legacy ids whose chathead should show the resolved variant. */
  const LEGACY_NPC_CHAT_HEAD = new Map([
    [REEN_ALKHARID_NPC_ID, NpcIdentifiers.FATHER_REEN],
    [REEN_UZER_NPC_ID, NpcIdentifiers.FATHER_REEN],
    [BADDEN_UZER_NPC_ID, NpcIdentifiers.FATHER_BADDEN],
    [DAVE_AT_PORTAL_NPC_ID, NpcIdentifiers.EVIL_DAVE_2],
    [DAVE_IN_PASSAGE_NPC_ID, NpcIdentifiers.EVIL_DAVE_2],
  ]);

  const SILVERLIGHT_ITEM_ID = ItemIdentifiers.SILVERLIGHT; // 2402
  const DYED_SILVERLIGHT_ITEM_ID = ItemIdentifiers.SILVERLIGHT_2; // 6745
  const DARKLIGHT_ITEM_ID = ItemIdentifiers.DARKLIGHT; // 6746
  /** Every form of the sword: having any of them means Reen has nothing to replace. */
  const SILVERLIGHT_FORMS = [SILVERLIGHT_ITEM_ID, DYED_SILVERLIGHT_ITEM_ID, DARKLIGHT_ITEM_ID];
  /**
   * Black mushroom ink dyes desert clothing (Wiki, Black mushroom ink). The message follows the
   * captured goblin mail dye ("You dye the goblin mail black.", synth_sound 2392).
   */
  const BLACK_DYEABLE_CLOTHING = new Map([
    [ItemIdentifiers.DESERT_SHIRT, { result: ItemIdentifiers.BLACK_DESERT_SHIRT, name: "desert shirt" }], // 1833 -> 6750
    [ItemIdentifiers.DESERT_ROBE, { result: ItemIdentifiers.BLACK_DESERT_ROBE, name: "desert robe" }], // 1835 -> 6752
  ]);
  const DYE_SOUND = 2392;
  const DEMONIC_SIGIL_MOULD_ITEM_ID = ItemIdentifiers.DEMONIC_SIGIL_MOULD; // 6747
  const DEMONIC_SIGIL_ITEM_ID = ItemIdentifiers.DEMONIC_SIGIL; // 6748
  const DEMONIC_TOME_ITEM_ID = ItemIdentifiers.DEMONIC_TOME; // 6749
  const STRANGE_IMPLEMENT_ITEM_ID = ItemIdentifiers.STRANGE_IMPLEMENT; // 4619
  const BLACK_MUSHROOM_ITEM_ID = ItemIdentifiers.BLACK_MUSHROOM; // 4620
  const BLACK_DYE_ITEM_ID = ItemIdentifiers.BLACK_DYE; // 4622 "Black mushroom ink"
  const SILVER_BAR_ITEM_ID = ItemIdentifiers.SILVER_BAR; // 2355

  const BLACK_MUSHROOM_OBJECT_ID = ObjectIdentifiers.BLACK_MUSHROOMS; // 6311
  // The four agrith kilns in Uzer: 10242 at 3467,3123, 10243 at 3478,3082, 10244 at
  // 3472,3092 and 10245 at 3500,3084. Each shows a "Look-in" child (10246-10248) only
  // at stage 60; otherwise their children are the optionless 6327-6330.
  const SURFACE_KILN_OBJECT_IDS = [10242, 10243, 10244, 10245]; // agrith_kiln_1..4
  const KILN_OBJECT_IDS = new Set([
    ...SURFACE_KILN_OBJECT_IDS,
    ObjectIdentifiers.BROKEN_KILN, // 6327
    ObjectIdentifiers.BROKEN_KILN_2, // 6328
    ObjectIdentifiers.BROKEN_KILN_3, // 6329
    ObjectIdentifiers.BROKEN_KILN_4, // 6330
  ]);
  /**
   * Josef hid the tome in a kiln picked when the golem tells you about it: varbit 1378
   * agrith_kiln holds 0-3 and the tome is in agrith_kiln_{value + 1} (capture 572: 0->2 and
   * the tome in agrith_kiln_3; capture 3333: left at 0 and the tome in agrith_kiln_1).
   */
  const KILN_COUNT = SURFACE_KILN_OBJECT_IDS.length;

  // ============================================================================
  // Stages and state
  // ============================================================================

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 10;
  const STAGE_INFILTRATE = 20;
  const STAGE_IN_GROUP = 30;
  const STAGE_DENATH_TOLD = 40;
  const STAGE_MATTHEW_TOLD = 50;
  const STAGE_GOLEM_TOLD = 60;
  const STAGE_BOOK_SHOWN = 70;
  const STAGE_RITUAL = 80;
  const STAGE_RITUAL_DONE = 90;
  const STAGE_PREPARE = 100;
  const STAGE_READY = 110;
  const STAGE_SUMMONED = 120;
  const STAGE_KILLED = 124;
  const STAGE_COMPLETE = 130;
  // Capture 3333 ends the native agrith_quest varbit at 125 (t26125); the
  // server's legacy internal completion stage is 130. The varbit is 7 bits
  // (1372, bits 0-6), so mirror completion as 125 while keeping stage 130.
  const VARBIT_QUEST_FINISHED = 125;

  const CRAFTING_REQUIREMENT = 30;
  const COMBAT_XP = 10000;
  const DEMON_HP_ON_REGEN = 12;

  const HELPERS_ATTRIBUTE = "quest.shadow_of_the_storm.helpers";
  const KILN_ATTRIBUTE = "quest.shadow_of_the_storm.kiln";
  const INCANTATION_ATTRIBUTE = "quest.shadow_of_the_storm.incantation";
  const REWARD_ATTRIBUTE = "quest.shadow_of_the_storm.reward";
  const SUMMON_ASSEMBLED_ATTRIBUTE = "shadow-of-the-storm:summon-assembled";

  const BIT_DAVE = 1 << 0;
  const BIT_BADDEN = 1 << 1;
  const BIT_REEN = 1 << 2;
  const BIT_GOLEM = 1 << 3;
  const BIT_GOLEM_REPROGRAMMED = 1 << 4;
  const BIT_TANYA = 1 << 5;
  const ALL_HELPERS_MASK = BIT_DAVE | BIT_BADDEN | BIT_REEN | BIT_GOLEM;

  /** Uzer underground (the room The Golem's temple lives in) and the plane-2 throne room. */
  const UNDERGROUND_ZONE = { minX: 2700, maxX: 2745, minY: 4875, maxY: 4925, levels: [0] };
  const THRONE_ZONE = { minX: 2706, maxX: 2738, minY: 4879, maxY: 4918, levels: [2] };
  const RITUAL_TILE = { x: 2720, y: 4903, z: 2 };
  const THRONE_ENTRY_TILE = { x: 2720, y: 4883, z: 2 };
  const DEMON_TILE = { x: 2719, y: 4899, z: 2 }; // capture t2458
  const PORTAL_ENTER_OBJECT_ID = 6310; // Golem_PORTAL, outside -> plane 2
  const PORTAL_EXIT_OBJECT_ID = 6282; // Golem_DEMON_PORTAL, plane 2 -> outside

  /**
   * Owner-only plane-2 throne room cast from capture 3333. The first ritual
   * uses Denath and the apprentices plus Evil Dave; after Tanya is killed the
   * second ritual uses the three priests, Dave and the reprogrammed golem.
   */
  const RITUAL_CAST = [
    { key: "denath", id: NpcIdentifiers.DENATH, x: 2720, y: 4912 },
    { key: "eric", id: NpcIdentifiers.ERIC, x: 2717, y: 4890 },
    { key: "tanya", id: NpcIdentifiers.TANYA, x: 2714, y: 4903 },
    { key: "matthew", id: NpcIdentifiers.MATTHEW, x: 2722, y: 4900 },
    { key: "jennifer", id: NpcIdentifiers.JENNIFER_2, x: 2723, y: 4898 },
    { key: "patrick", id: NpcIdentifiers.PATRICK, x: 2718, y: 4893 },
    { key: "dave", id: NpcIdentifiers.EVIL_DAVE_2, x: 2720, y: 4883 },
  ];
  const SECOND_CAST = [
    { key: "reen", id: NpcIdentifiers.FATHER_REEN, x: 2722, y: 4898 },
    { key: "badden", id: NpcIdentifiers.FATHER_BADDEN, x: 2722, y: 4902 },
    { key: "dave", id: NpcIdentifiers.EVIL_DAVE_2, x: 2720, y: 4897 },
    { key: "matthew", id: NpcIdentifiers.MATTHEW, x: 2718, y: 4902 },
    { key: "jennifer", id: NpcIdentifiers.JENNIFER_2, x: 2717, y: 4900 },
    { key: "patrick", id: NpcIdentifiers.PATRICK, x: 2718, y: 4898 },
    { key: "golem", id: NpcIdentifiers.CLAY_GOLEM_2, x: 2723, y: 4900 },
  ];

  const INCANTATION_WORDS = ["Caldar", "Nahudu", "Agrith-Naar", "Camerinthum", "Tarren"];
  const WORD_INDEX = new Map(INCANTATION_WORDS.map((word, index) => [word.toLowerCase(), index]));
  /**
   * Denath's spoken order in capture 3333: "Nahudu Caldar Tarren Agrith-Naar
   * Camerinthum". The five varbits store the tome order, which is the reverse
   * ([3,2,4,0,1]), so the first ritual picks Denath's order and the second
   * picks the varbit order.
   */
  const DENATH_ORDER = [1, 0, 4, 2, 3];
  const BOOK_ORDER = [...DENATH_ORDER].reverse();
  const FIRST_RITUAL_VARIANT = "performing-the-ritual-getting-in-place";
  const SECOND_RITUAL_VARIANT = "summoning-agrith-naar-in-position";

  const SKILL_BY_OPTION = new Map([
    ["Strength *", Skill.STRENGTH],
    ["Attack *", Skill.ATTACK],
    ["Defence *", Skill.DEFENCE],
    ["Hitpoints *", Skill.HITPOINTS],
    ["Magic *", Skill.MAGIC],
    ["Ranged *", Skill.RANGED],
  ]);
  const SKILL_BY_INDEX = new Map(
    [...SKILL_BY_OPTION.values()].map((skill) => [skill.getIndex(), skill])
  );

  // Condition step ids on the "Shadow of the Storm" page.
  const COND_REEN_START = "svZZrt"; // still has Silverlight at the start
  const COND_REEN_AGAIN_START = "_Q8pfm"; // still has Silverlight, talking to Reen again
  const COND_BADDEN_SILVERLIGHT_PRESENT = "A17tY2"; // still has Silverlight for Badden
  const COND_BADDEN_SILVERLIGHT_LOST = "JkC4Vq"; // lost Silverlight before Badden
  const COND_REF_START = new Set([COND_REEN_START, COND_REEN_AGAIN_START, COND_BADDEN_SILVERLIGHT_PRESENT]);
  const COND_REEN_LOST = new Set(["fllvV0", "X3Ql5k"]); // Reen can hand Silverlight back
  const COND_REF_LOST = new Set([...COND_REEN_LOST, COND_BADDEN_SILVERLIGHT_LOST]);
  const COND_NOT_ENOUGH_BLACK = "JikimW";
  const COND_BLACK_UNDYED = "4k0GUd";
  const COND_BLACK_DYED = "4Y24pa";
  const COND_THRONE_GEMS_REMOVED = "7wLvM8";
  const COND_THRONE_GEMS_PRESENT = "rioSQu";
  const COND_MOULD_FREE = "lfudoK";
  const COND_MOULD_NO_SPACE = "FCmkX6";
  const COND_MOULD_HELD = "k9kfs8";
  const COND_ERIC_WALKED_AWAY = "VYAAJ_";
  const COND_KILN_WRONG = "uo9abT";
  const COND_KILN_BOOK = "3DMFjV";
  const COND_KILN_BOOK_HELD = "qgKzKk";
  const COND_MATTHEW_NO_BOOK = "UiRe9o";
  const COND_MATTHEW_BOOK = "6Gz0Kx";
  const COND_MATTHEW_UNDYED = "Gf2Mqg";
  const COND_MATTHEW_DYED = "ayHNXA";
  const COND_RITUAL_WRONG = "U6mX5q";
  const COND_RITUAL_CORRECT = "q1RJ9d";
  const COND_PEOPLE_FOUR = "PEnb-0";
  const COND_PEOPLE_THREE = "t5gSPE";
  const COND_PEOPLE_TWO = "piK4Mv";
  const COND_PEOPLE_ONE = "NHy6EJ";
  const COND_BADDEN_NO_SIGIL = "3fuR91";
  const COND_BADDEN_SIGIL = "qv5YFB";
  const COND_REEN_NO_SIGIL = "9PtqFf";
  const COND_REEN_SIGIL = "Aw3U2E";
  const COND_GOLEM_NO_SIGIL = "gI6c58";
  const COND_GOLEM_SIGIL = "AWNaLn";
  const COND_SUMMON_NO_SIGIL = "no5_C7";
  const COND_SUMMON_NO_SWORD = "az5CGG";
  const COND_SUMMON_READY = "pblmt4";
  const COND_SUMMON_BACKWARDS = "bAuvv8";
  const COND_SUMMON_CORRECT = "P8GKUN";

  // Action/message step ids.
  const MSG_REEN_GIVES_SWORD = "Kh2EP0";
  const MSG_DYE_PICK_MUSHROOM = "E-w57a"; // to-uzer-dyeing-silverlight-black
  const MSG_DYE_SLICE = "iGN0Yu";
  const MSG_ESCORT_THRONE = "SzrKim";
  const MSG_DAVE_RETURNS = "vzuhlL";
  const MSG_TANYA_KILLED = "iWR7Wz";
  const ACTION_RITUAL_ASSEMBLES = "FK8qAZ";
  const ACTION_MATTHEW_KILLED = "X9FA-a";
  const ACTION_DEMON_ATTACKS = "YKZEof";
  const ACTION_GOLEM_REPROGRAMMED = "Aha_-j";
  const ACTION_QUEST_COMPLETE = "EDRKBv";

  // ============================================================================
  // State
  // ============================================================================

  let quest;
  let itemOnGroundManager;
  const Scenes = createQuestScenes(api, { onEnd: () => {} });

  /** player -> Map of wizard key -> spawned npc (owner-only throne room). */
  const wizardNpcs = new WeakMap();
  /** player -> their Agrith-Naar. */
  const demonNpcs = new WeakMap();
  /** player -> incantation words picked this run. */
  const ritualPicks = new WeakMap();
  const ritualViewDistances = new WeakMap();
  /** player -> whether the kiln last searched is the correct one. */
  const kilnSearchCorrect = new WeakMap();

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  const ownsItem = (player, itemId) =>
    hasItem(player, itemId) ||
    (player.getEquipment().getItems() || []).some((item) => item && item.getId?.() === itemId);

  const bankedItem = (player, itemId) =>
    player.getBanks?.()?.some((bank) => bank && bank.getAmount(itemId) > 0) === true;

  /** Carried or worn, as the ritual needs it. */
  const hasSilverlight = (player) =>
    ownsItem(player, SILVERLIGHT_ITEM_ID) || ownsItem(player, DYED_SILVERLIGHT_ITEM_ID);
  /** Carried, worn or banked in any form, so Reen never hands out a second sword. */
  const ownsSilverlight = (player) =>
    SILVERLIGHT_FORMS.some((itemId) => ownsItem(player, itemId) || bankedItem(player, itemId));
  const hasDyedSilverlight = (player) => ownsItem(player, DYED_SILVERLIGHT_ITEM_ID);

  function silverlightEquipped(player) {
    return (player.getEquipment().getItems() || []).some(
      (item) =>
        item &&
        (item.getId?.() === DYED_SILVERLIGHT_ITEM_ID || item.getId?.() === SILVERLIGHT_ITEM_ID)
    );
  }

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function helperBits(player) {
    return Number(player.getAttribute(HELPERS_ATTRIBUTE)) || 0;
  }

  function setHelperBits(player, bits) {
    player.setAttribute(HELPERS_ATTRIBUTE, bits);
  }

  /** The kiln (0-3) holding this player's tome. */
  function hiddenKiln(player) {
    return Number(player.getAttribute(KILN_ATTRIBUTE)) || 0;
  }

  function hideTome(player) {
    const kiln = Math.floor(Math.random() * KILN_COUNT);
    player.setAttribute(KILN_ATTRIBUTE, kiln);
    player.getPacketSender().sendVarbit(VARBIT_AGRITH_KILN, kiln);
  }

  function packedIncantation(player) {
    return Number(player.getAttribute(INCANTATION_ATTRIBUTE)) || 0;
  }

  function chosenSkill(player) {
    const index = Number(player.getAttribute(REWARD_ATTRIBUTE));
    return Number.isFinite(index) ? SKILL_BY_INDEX.get(index) : undefined;
  }

  function wordAt(player, index) {
    return (packedIncantation(player) >> (index * 3)) & 7;
  }

  function giveItem(player, itemId, message) {
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space for that.");
      return false;
    }
    player.getInventory().adds(itemId, 1);
    if (message) player.sendMessage(message);
    return true;
  }

  function chatboxOpen(player) {
    const prompt = api.core.MultiChatboxPrompt?.getPending?.(player) ?? null;
    return player.getDialogueManager?.()?.isActive?.() === true || prompt !== null;
  }

  /** Runs `fn` once the current dialogue has fully closed (a chat menu is a tick). */
  function afterDialogue(player, fn) {
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        if (chatboxOpen(player)) {
          afterDialogue(player, fn);
          return;
        }
        fn();
      })
    );
  }

  // ============================================================================
  // Varbits and spawns
  // ============================================================================

  /** Re-sends the sibling varbits the stage and helper bits imply. */
  function syncShadowVarbits(player) {
    const packet = player.getPacketSender();
    const stage = quest.getStage(player);
    const bits = helperBits(player);
    // 1381/1382 also choose the Uzer Badden/Reen transform; 2 hides them, so put
    // them back to 1 once the quest is done and their after-killing lines matter.
    const post = stage >= STAGE_COMPLETE;
    packet.sendVarbit(
      VARBIT_BADDEN_UZER,
      stage >= STAGE_STARTED ? (post || !(bits & BIT_BADDEN) ? 1 : 2) : 0
    );
    packet.sendVarbit(
      VARBIT_REEN_UZER,
      stage >= STAGE_STARTED ? (post || !(bits & BIT_REEN) ? 1 : 2) : 0
    );
    // 1372 no longer maps the portal Dave past stage 110, so keep the passage
    // spawn (varbit 1380) visible through the stage-90 recruitment and after.
    packet.sendVarbit(VARBIT_CONVINCED_DAVE, stage >= STAGE_IN_GROUP ? 1 : 0);
    packet.sendVarbit(
      VARBIT_CONVINCED_GOLEM,
      bits & BIT_GOLEM ? 3 : bits & BIT_GOLEM_REPROGRAMMED ? 2 : 0
    );
    packet.sendVarbit(VARBIT_AGRITH_KILN, hiddenKiln(player));
    for (let index = 0; index < VARBIT_INCANTATION_WORDS.length; index++) {
      packet.sendVarbit(VARBIT_INCANTATION_WORDS[index], wordAt(player, index));
    }
  }

  function setStage(player, value) {
    quest.setStage(player, value);
    syncShadowVarbits(player);
    ensureWizardNpcs(player);
  }

  function ensureWizardNpcs(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_IN_GROUP || stage >= STAGE_COMPLETE) {
      removeAllWizards(player);
      return;
    }
    const cast = (stage < STAGE_PREPARE ? RITUAL_CAST : SECOND_CAST)
      .filter((spawn) => !(stage >= STAGE_SUMMONED && spawn.key === "matthew"))
      .filter((spawn) => !(stage >= STAGE_RITUAL_DONE && spawn.key === "denath"));
    let tracked = wizardNpcs.get(player);
    if (!tracked) {
      tracked = new Map();
      wizardNpcs.set(player, tracked);
    }
    const wanted = new Set(cast.map((spawn) => spawn.key));
    for (const [key, npc] of tracked) {
      if (wanted.has(key)) continue;
      api.removeNpc(npc);
      tracked.delete(key);
    }
    for (const spawn of cast) {
      const existing = tracked.get(spawn.key);
      if (existing && existing.isRegistered?.() !== false && existing.getPrivateArea?.()?.isDestroyed?.() !== true) {
        syncWizardArea(player, existing);
        existing.moveTo?.(new Location(spawn.x, spawn.y, 2));
        continue;
      }
      if (existing) api.removeNpc(existing);
      const npc = api.spawnNpc({
        id: spawn.id,
        x: spawn.x,
        y: spawn.y,
        z: 2,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) {
        tracked.set(spawn.key, npc);
        syncWizardArea(player, npc);
      }
    }
  }

  function syncWizardArea(player, npc) {
    if (npc.getOwner?.() !== player || npc.isOwnerOnly?.() !== true) return;
    const previous = npc.getPrivateArea?.() ?? null;
    const area = Scenes.get(player)?.area ?? null;
    if ((player.getPrivateArea?.() ?? null) !== area) return;
    if (previous === area) return;
    previous?.remove(npc);
    if (area) area.add(npc);
    else npc.setArea(null);
  }

  /** Keep the quest's temporary cast when the camera scene's private area is destroyed. */
  function releaseRitualCast(player, scene) {
    for (const npc of wizardNpcs.get(player)?.values() ?? []) {
      if (npc.getOwner?.() === player && npc.isOwnerOnly?.() === true && npc.getPrivateArea?.() === scene.area) {
        scene.area.remove(npc);
      }
    }
  }

  function restoreRitualView(player) {
    if (!ritualViewDistances.has(player)) return;
    player.setNpcViewDistance(ritualViewDistances.get(player));
    ritualViewDistances.delete(player);
  }

  function removeWizard(player, key) {
    const tracked = wizardNpcs.get(player);
    const npc = tracked?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    tracked.delete(key);
  }

  function removeAllWizards(player) {
    const tracked = wizardNpcs.get(player);
    if (!tracked) return;
    for (const npc of tracked.values()) api.removeNpc(npc);
    tracked.clear();
  }

  function removeDemon(player) {
    const npc = demonNpcs.get(player);
    if (!npc) return;
    api.removeNpc(npc);
    demonNpcs.delete(player);
  }

  // ============================================================================
  // Black clothing (Evil Dave's gate)
  // ============================================================================

  /** Names the wiki says Dave does not accept even though they read "black". */
  const BLACK_ITEM_EXCEPTIONS = new Set([
    "black beret",
    "black boater",
    "black cavalier",
    "black defender",
    "black headband",
    "black knife",
    "black leprechaun hat",
    "black mask",
    "black satchel",
    "black spiky vambraces",
  ]);

  function isBlackClothing(name) {
    const value = String(name ?? "").toLowerCase();
    if (!value) return false;
    if (value === "darklight") return true;
    if (value === "priest gown" || value === "priest robe") return true;
    if (value.startsWith("ghostly ") || value.startsWith("shade robe")) return true;
    if (value.includes("mystic") && value.includes("(dark)")) return true;
    if (value.includes("graceful") && value.includes("hallowed")) return true;
    if (!value.startsWith("black ")) return false;
    if (value.startsWith("black naval") || value.startsWith("black elegant")) return false;
    if (value.startsWith("black mask")) return false;
    return !BLACK_ITEM_EXCEPTIONS.has(value);
  }

  function countBlackClothing(player) {
    let count = 0;
    for (const item of player.getEquipment().getItems() || []) {
      if (!item) continue;
      const id = item.getId?.();
      if (isBlackClothing(ItemDefinition.forId(id)?.getName?.())) count++;
    }
    return count;
  }

  // ============================================================================
  // Dialogue variant selection
  // ============================================================================

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (stage >= STAGE_KILLED && stage < STAGE_COMPLETE) {
      // The reward skill menu can be escaped; let a surviving wizard replay it.
      if (MATTHEW_NPC_IDS.has(npcId) || JENNIFER_NPC_IDS.has(npcId) || PATRICK_NPC_IDS.has(npcId)) {
        return "summoning-agrith-naar-killing-agrith-naar";
      }
    }

    if (stage >= STAGE_COMPLETE) {
      if (REEN_NPC_IDS.has(npcId)) return "after-killing-agrith-naar-father-reen";
      if (BADDEN_NPC_IDS.has(npcId)) return "after-killing-agrith-naar-father-badden";
      if (DAVE_NPC_IDS.has(npcId)) return "after-killing-agrith-naar-evil-dave";
      if (JENNIFER_NPC_IDS.has(npcId)) return "after-killing-agrith-naar-jennifer";
      if (PATRICK_NPC_IDS.has(npcId)) return "after-killing-agrith-naar-patrick";
      if (GOLEM_NPC_IDS.has(npcId)) {
        return { page: GOLEM_PAGE, variant: "standard-dialogue-after-completion-of-shadow-of-the-storm" };
      }
      return null;
    }

    if (REEN_NPC_IDS.has(npcId)) {
      // Do not let the generic dialogue engine accept the quest without the
      // prerequisite quests if its any-NPC hook wins the race.
      if (stage === STAGE_NOT_STARTED && !shadowPrereqsMet(player)) return null;
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-father-reen";
      if (stage >= STAGE_INFILTRATE) return "infiltrating-the-wizards-talking-to-father-reen-at-uzer";
      if (stage >= STAGE_STARTED) return "starting-off-talking-to-father-reen-again";
      return "starting-off";
    }

    if (BADDEN_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-father-badden";
      if (stage >= STAGE_DENATH_TOLD) return "infiltrating-the-wizards-talking-to-father-badden";
      if (stage >= STAGE_IN_GROUP) {
        return stage >= STAGE_MATTHEW_TOLD
          ? "infiltrating-the-wizards-asking-around-about-last-night-father-badden"
          : "infiltrating-the-wizards-reporting-back-to-father-badden";
      }
      if (stage >= STAGE_INFILTRATE) return "to-uzer-talking-to-father-badden-again";
      if (stage >= STAGE_STARTED) return "to-uzer-talking-to-father-badden";
      return null;
    }

    if (DAVE_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_SUMMONED) {
        return "summoning-agrith-naar-talking-to-everyone-after-summoning-agrith-naar-evil-dave";
      }
      if (stage >= STAGE_READY) return "summoning-agrith-naar-talking-to-everyone-in-the-ritual-evil-dave";
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-evil-dave-2";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-evil-dave";
      if (stage >= STAGE_INFILTRATE) return "infiltrating-the-wizards";
      return "to-uzer-talking-to-evil-dave";
    }

    if (DENATH_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_BOOK_SHOWN) return "performing-the-ritual";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-denath";
      return null;
    }

    if (MATTHEW_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_SUMMONED) return null; // killed by Agrith-Naar
      if (stage >= STAGE_READY) return "summoning-agrith-naar";
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-matthew-again";
      if (stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-matthew";
      if (stage >= STAGE_BOOK_SHOWN) {
        return "infiltrating-the-wizards-talking-to-matthew-again-after-showing-him-the-book";
      }
      if (stage >= STAGE_MATTHEW_TOLD) return "infiltrating-the-wizards-returning-to-matthew";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-matthew";
      return null;
    }

    if (JENNIFER_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_SUMMONED) {
        return "summoning-agrith-naar-talking-to-everyone-after-summoning-agrith-naar-jennifer";
      }
      if (stage >= STAGE_READY) return "summoning-agrith-naar-talking-to-everyone-in-the-ritual-jennifer";
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-jennifer-2";
      if (stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-jennifer";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-jennifer";
      return null;
    }

    if (PATRICK_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_SUMMONED) {
        return "summoning-agrith-naar-talking-to-everyone-after-summoning-agrith-naar-patrick";
      }
      if (stage >= STAGE_READY) return "summoning-agrith-naar-talking-to-everyone-in-the-ritual-patrick";
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-patrick-2";
      if (stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-patrick";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-patrick";
      return null;
    }

    if (TANYA_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-tanya";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-tanya";
      return null;
    }

    if (ERIC_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-eric";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-eric";
      return null;
    }

    if (GOLEM_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_RITUAL_DONE) {
        return helperBits(player) & BIT_GOLEM_REPROGRAMMED
          ? "performing-the-ritual-talking-to-the-golem-after-reprogramming"
          : "performing-the-ritual-talking-to-the-clay-golem";
      }
      if (stage >= STAGE_GOLEM_TOLD) return "to-uzer-talking-to-the-clay-golem";
      if (stage >= STAGE_MATTHEW_TOLD) {
        return "infiltrating-the-wizards-asking-around-about-last-night-clay-golem";
      }
      if (stage >= STAGE_IN_GROUP) return "to-uzer-talking-to-the-clay-golem";
      return null;
    }

    return null;
  }

  // ============================================================================
  // Condition answers
  // ============================================================================

  function peopleLeft(player) {
    return 4 - popcount(helperBits(player) & ALL_HELPERS_MASK);
  }

  function popcount(value) {
    let count = 0;
    let bits = value;
    while (bits) {
      count += bits & 1;
      bits >>= 1;
    }
    return count;
  }

  function firstRitualCorrect(player) {
    const picks = ritualPicks.get(player);
    if (!Array.isArray(picks) || picks.length !== INCANTATION_WORDS.length) return false;
    // The first incantation is the reverse of Denath's order, as the demonic
    // tome gives it (Quest Helper IncantationStep(reverse = true)).
    const last = INCANTATION_WORDS.length - 1;
    return picks.every((word, index) => word === wordAt(player, last - index));
  }

  function secondRitualCorrect(player) {
    const picks = ritualPicks.get(player);
    if (!Array.isArray(picks) || picks.length !== INCANTATION_WORDS.length) return false;
    // The second incantation uses the tome/varbit order directly
    // (Quest Helper IncantationStep(reverse = false)).
    return picks.every((word, index) => word === wordAt(player, index));
  }

  function answerCondition({ player, npcId, stepId, text }) {
    if (!stepId) return null;

    if (COND_REF_START.has(stepId)) return ownsSilverlight(player);
    if (COND_REF_LOST.has(stepId)) return !ownsSilverlight(player);

    if (stepId === COND_NOT_ENOUGH_BLACK) return countBlackClothing(player) < 3;
    if (stepId === COND_BLACK_UNDYED) {
      return countBlackClothing(player) >= 3 && !hasDyedSilverlight(player);
    }
    if (stepId === COND_BLACK_DYED) {
      return countBlackClothing(player) >= 3 && hasDyedSilverlight(player);
    }

    if (stepId === COND_THRONE_GEMS_REMOVED) return throneGemsRemoved(player);
    if (stepId === COND_THRONE_GEMS_PRESENT) return !throneGemsRemoved(player);

    if (stepId === COND_MOULD_FREE) {
      return !hasItem(player, DEMONIC_SIGIL_MOULD_ITEM_ID) && !player.getInventory().isFull();
    }
    if (stepId === COND_MOULD_NO_SPACE) {
      return !hasItem(player, DEMONIC_SIGIL_MOULD_ITEM_ID) && player.getInventory().isFull();
    }
    if (stepId === COND_MOULD_HELD) return hasItem(player, DEMONIC_SIGIL_MOULD_ITEM_ID);

    if (stepId === COND_ERIC_WALKED_AWAY) return false;

    if (stepId === COND_KILN_WRONG) return kilnSearchCorrect.get(player) === false;
    if (stepId === COND_KILN_BOOK) {
      return (
        kilnSearchCorrect.get(player) === true &&
        !hasItem(player, DEMONIC_TOME_ITEM_ID) &&
        quest.getStage(player) < STAGE_BOOK_SHOWN
      );
    }
    if (stepId === COND_KILN_BOOK_HELD) {
      return hasItem(player, DEMONIC_TOME_ITEM_ID) || quest.getStage(player) >= STAGE_BOOK_SHOWN;
    }

    if (stepId === COND_MATTHEW_NO_BOOK) return !hasItem(player, DEMONIC_TOME_ITEM_ID);
    if (stepId === COND_MATTHEW_BOOK) return hasItem(player, DEMONIC_TOME_ITEM_ID);
    if (stepId === COND_MATTHEW_UNDYED) return !hasDyedSilverlight(player);
    if (stepId === COND_MATTHEW_DYED) return hasDyedSilverlight(player);

    const left = peopleLeft(player);
    if (stepId === COND_PEOPLE_FOUR) return left === 4;
    if (stepId === COND_PEOPLE_THREE) return left === 3;
    if (stepId === COND_PEOPLE_TWO) return left === 2;
    if (stepId === COND_PEOPLE_ONE) return left === 1;

    const bits = helperBits(player);
    if (stepId === COND_BADDEN_NO_SIGIL) return !(bits & BIT_BADDEN) && !hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_BADDEN_SIGIL) return (bits & BIT_BADDEN) !== 0 || hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_REEN_NO_SIGIL) return !(bits & BIT_REEN) && !hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_REEN_SIGIL) return (bits & BIT_REEN) !== 0 || hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_GOLEM_NO_SIGIL) return !(bits & BIT_GOLEM) && !hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_GOLEM_SIGIL) return (bits & BIT_GOLEM) !== 0 || hasItem(player, DEMONIC_SIGIL_ITEM_ID);

    if (stepId === COND_SUMMON_NO_SIGIL) return !hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_SUMMON_NO_SWORD) {
      return hasItem(player, DEMONIC_SIGIL_ITEM_ID) && !hasSilverlight(player);
    }
    if (stepId === COND_SUMMON_READY) {
      return hasItem(player, DEMONIC_SIGIL_ITEM_ID) && hasSilverlight(player);
    }

    return null;
  }

  /** The Golem's throne gems flag (shared, persisted attribute of that quest). */
  function throneGemsRemoved(player) {
    return Boolean(player.getAttribute("quest.the_golem.throne_gems"));
  }

  // ============================================================================
  // Dialogue events
  // ============================================================================

  function restoreSilverlight(player) {
    if (ownsSilverlight(player)) return;
    giveItem(player, SILVERLIGHT_ITEM_ID, "Reen hands you a shining silver sword.");
  }

  function recruitHelper(player, bit) {
    const bits = helperBits(player);
    if (bits & bit) return;
    if (!hasItem(player, DEMONIC_SIGIL_ITEM_ID)) return;
    player.getInventory().deleteNumber(DEMONIC_SIGIL_ITEM_ID, 1);
    finishRecruit(player, bits | bit);
  }

  function recruitEvilDave(player) {
    const bits = helperBits(player);
    if (bits & BIT_DAVE) return;
    if (!giveItem(player, DEMONIC_SIGIL_ITEM_ID, "Evil Dave gives you Eric's demonic sigil.")) return;
    finishRecruit(player, bits | BIT_DAVE);
  }

  function finishRecruit(player, bits) {
    setHelperBits(player, bits);
    const stage = quest.getStage(player);
    if (stage < STAGE_PREPARE) {
      setStage(player, STAGE_PREPARE);
      return;
    }
    if ((bits & ALL_HELPERS_MASK) === ALL_HELPERS_MASK) setStage(player, STAGE_READY);
    else syncShadowVarbits(player);
  }

  function dropDenathsSigil(player) {
    // Capture 3333: Denath's sigil lands at 2720,4900 on the throne-room floor.
    const tile = new Location(2720, 4900, 2);
    if (itemOnGroundManager.getGroundItem(player.getUsername(), DEMONIC_SIGIL_ITEM_ID, tile)) return;
    itemOnGroundManager.registerLocation(player, new Item(DEMONIC_SIGIL_ITEM_ID, 1), tile);
  }

  function onFirstRitualComplete(player) {
    setStage(player, STAGE_RITUAL_DONE);
    dropDenathsSigil(player);
  }

  function inRitualCircle(player) {
    return player.getLocation().isWithinDistance(
      new Location(RITUAL_TILE.x, RITUAL_TILE.y, RITUAL_TILE.z), 8);
  }

  function shake(player, random) {
    player.getPacketSender().sendCameraShake(1, random, 0, 0);
  }

  function cameraBeat(scene, tick, move, look, rates = Scenes.CAMERA_RATES) {
    Scenes.later(scene, tick, () => {
      if (move) Scenes.camera(scene.owner, move, look ?? move, rates);
    });
  }

  /**
   * Capture 3333 t2109-t2123: the post-first-ritual camera moves, BOOM and
   * world shakes while Matthew explains what happened, then the portal-closing
   * loc 10251 appears and the camera resets. Scene cleanup removes the loc and
   * restores controls if the player leaves or logs out.
   */
  function startFirstRitualClosing(player) {
    const scene = Scenes.open(player, "shadow-first-ritual-close", [[2706, 2738, 4879, 4918, 2]], { beforeEnd: releaseRitualCast });
    ensureWizardNpcs(player);
    cameraBeat(scene, 0, [2722, 4900, 500], [2717, 4901, 150]);
    Scenes.later(scene, 1, () => Scenes.camera(player, [2718, 4900, 900], [2717, 4901, 150], { rate: 1, rate2: 1 }));
    cameraBeat(scene, 1, [2716, 4904, 300], [2719, 4902, 150]);
    cameraBeat(scene, 2, [2722, 4904, 300], [2718, 4902, 150]);
    cameraBeat(scene, 3, [2720, 4907, 300], [2719, 4902, 150]);
    cameraBeat(scene, 4, [2722, 4896, 800], [2719, 4902, 150]);
    Scenes.later(scene, 4, () => Scenes.camera(player, [2722, 4894, 1200], [2719, 4902, 150], { rate: 1, rate2: 1 }));
    Scenes.later(scene, 5, () => {
      StatementDialogue.send(player, "<col=800000>BOOM!", false);
      shake(player, 15);
      Scenes.camera(player, [2717, 4905, 300], [2719, 4900, 150]);
    });
    Scenes.later(scene, 6, () => {
      Scenes.loc(scene, { id: 10251, x: 2719, y: 4883, z: 2, type: 10, rotation: 0 });
      shake(player, 1);
      Scenes.camera(player, [2723, 4899, 300], [2719, 4902, 150]);
    });
    cameraBeat(scene, 7, [2718, 4906, 500], [2720, 4883, 300]);
    Scenes.later(scene, 7, () => Scenes.camera(player, [2718, 4890, 500], [2720, 4883, 300], { rate: 10, rate2: 10 }));
    cameraBeat(scene, 8, [2722, 4887, 500], [2720, 4897, 150]);
    cameraBeat(scene, 9, [2718, 4905, 300], [2720, 4897, 150]);
    cameraBeat(scene, 10, [2717, 4903, 250], [2719, 4902, 150], { rate: 1, rate2: 1 });
    cameraBeat(scene, 11, [2720, 4897, 350], [2719, 4902, 150]);
    Scenes.later(scene, 11, () => Scenes.camera(player, [2720, 4887, 350], [2719, 4902, 150], { rate: 1, rate2: 1 }));
    Scenes.later(scene, 13, () => Scenes.end(player));
  }

  function startFirstIncantation(player) {
    const stage = quest.getStage(player);
    if (stage !== STAGE_BOOK_SHOWN && stage !== STAGE_RITUAL) return;
    if (!inRitualCircle(player)) {
      player.sendMessage("You must stand in the ritual circle to lead the incantation.");
      return;
    }
    if (!hasItem(player, DEMONIC_SIGIL_ITEM_ID)) {
      player.sendMessage("You need a demonic sigil to lead the ritual.");
      return;
    }
    if (!hasDyedSilverlight(player)) {
      player.sendMessage("You need Silverlight with you to face Agrith-Naar.");
      return;
    }
    if (!packedIncantation(player)) assignIncantation(player);
    // Dave's captured tile is twenty tiles away; the whole chorus must be local and visible.
    if (typeof player.getNpcViewDistance === "function") {
      if (!ritualViewDistances.has(player)) ritualViewDistances.set(player, player.getNpcViewDistance());
      const distance = Math.max(...RITUAL_CAST.map(({ x, y }) => Math.max(Math.abs(x - RITUAL_TILE.x), Math.abs(y - RITUAL_TILE.y)))) + 1;
      player.setNpcViewDistance(Math.max(player.getNpcViewDistance(), distance));
    }
    ritualPicks.delete(player);
    setStage(player, STAGE_RITUAL);
    playRitualMenus(player, NpcIdentifiers.DENATH, FIRST_RITUAL_VARIANT, () =>
      resolveFirstIncantation(player)
    );
  }

  function startSecondIncantation(player) {
    if (quest.getStage(player) !== STAGE_READY) return;
    if (!player.getAttribute(SUMMON_ASSEMBLED_ATTRIBUTE)) {
      player.sendMessage("You should speak to Matthew and get into position before leading the ritual.");
      return;
    }
    if (!inRitualCircle(player)) {
      player.sendMessage("You must stand in the ritual circle to lead the incantation.");
      return;
    }
    if (!hasItem(player, DEMONIC_SIGIL_ITEM_ID) || !hasSilverlight(player)) return;
    ritualPicks.delete(player);
    // Capture 3333 t2429: the summoning camera starts with the first word menu.
    Scenes.open(player, "shadow-second-ritual", [[2706, 2738, 4879, 4918, 2]], { beforeEnd: releaseRitualCast });
    ensureWizardNpcs(player);
    Scenes.camera(player, [2720, 4894, 550], [2720, 4900, 150]);
    playRitualMenus(player, NpcIdentifiers.MATTHEW, SECOND_RITUAL_VARIANT, () =>
      resolveSecondIncantation(player)
    );
  }

  /**
   * The incantation variants hold one 5-word menu followed by five "[Word N]"
   * echo pairs and the two outcome conditions. Conditions resolve when the
   * dialogue is built, i.e. before any word is picked, so expand the single menu
   * into the wiki's five selections, drop the outcomes, and evaluate afterwards.
   */
  function ritualMenuSteps(steps, outcomeIds) {
    const queue = withoutConditions(steps, outcomeIds);
    const choiceIndex = queue.findIndex((step) => step.type === "choice");
    if (choiceIndex === -1) return queue;
    const choice = queue[choiceIndex];
    const echoes = [];
    const after = [];
    for (const step of queue.slice(choiceIndex + 1)) {
      const text = typeof step.player === "string" ? step.player : step.type === "line" ? step.text : "";
      if (/\[Word \d/.test(String(text ?? "")) && echoes.length < 10) echoes.push(step);
      else after.push(step);
    }
    if (echoes.length < 10) return queue;
    const expanded = [];
    for (let pick = 0; pick < 5; pick++) {
      expanded.push({ ...choice, options: choice.options.map((option) => ({ ...option })) });
      expanded.push(echoes[pick * 2], echoes[pick * 2 + 1]);
    }
    return [...queue.slice(0, choiceIndex), ...expanded, ...after];
  }

  function playRitualMenus(player, npcId, variant, onDone) {
    const outcomeIds = new Set([COND_RITUAL_WRONG, COND_RITUAL_CORRECT, COND_SUMMON_BACKWARDS, COND_SUMMON_CORRECT]);
    if (!startTranscript(api, player, npcId, PAGE, variant, (steps) => ritualMenuSteps(steps, outcomeIds))) {
      return;
    }
    afterDialogue(player, onDone);
  }

  function playOutcome(player, npcId, variant, conditionId) {
    startTranscript(api, player, npcId, PAGE, variant, (steps) =>
      conditionSteps(steps, conditionId).filter(
        (step) => step.type !== "unavailable" && step.type !== "reference"
      )
    );
  }

  function resolveFirstIncantation(player) {
    restoreRitualView(player);
    if (quest.getStage(player) !== STAGE_RITUAL) return;
    const correct = firstRitualCorrect(player);
    ritualPicks.delete(player);
    if (correct) {
      onFirstRitualComplete(player);
      startFirstRitualClosing(player);
      playOutcome(player, NpcIdentifiers.DENATH, FIRST_RITUAL_VARIANT, COND_RITUAL_CORRECT);
      afterDialogue(player, () => beginPortalClosing(player));
    } else {
      playOutcome(player, NpcIdentifiers.DENATH, FIRST_RITUAL_VARIANT, COND_RITUAL_WRONG);
    }
  }

  function resolveSecondIncantation(player) {
    if (quest.getStage(player) !== STAGE_READY) return;
    const correct = secondRitualCorrect(player);
    ritualPicks.delete(player);
    if (correct) {
      setStage(player, STAGE_SUMMONED);
      playOutcome(player, NpcIdentifiers.MATTHEW, SECOND_RITUAL_VARIANT, COND_SUMMON_CORRECT);
    } else {
      playOutcome(player, NpcIdentifiers.MATTHEW, SECOND_RITUAL_VARIANT, COND_SUMMON_BACKWARDS);
      const scene = Scenes.get(player);
      if (scene) Scenes.later(scene, 2, () => Scenes.end(player));
    }
  }

  function assignIncantation(player) {
    let packed = 0;
    for (let i = 0; i < BOOK_ORDER.length; i++) packed |= (BOOK_ORDER[i] & 7) << (i * 3);
    player.setAttribute(INCANTATION_ATTRIBUTE, packed);
    for (let i = 0; i < VARBIT_INCANTATION_WORDS.length; i++) {
      player.getPacketSender().sendVarbit(VARBIT_INCANTATION_WORDS[i], BOOK_ORDER[i]);
    }
  }

  /** A variant without the given condition wrappers (the ritual outcome tails). */
  function withoutConditions(steps, conditionIds) {
    return steps.filter((step) => !(step.type === "condition" && conditionIds.has(step.id)));
  }

  /** The body of one condition step, anywhere in the given steps. */
  function conditionSteps(steps, conditionId) {
    for (const step of steps ?? []) {
      if (step.type === "condition" && step.id === conditionId) return step.steps ?? [];
      if (Array.isArray(step.steps)) {
        const found = conditionSteps(step.steps, conditionId);
        if (found.length) return found;
      }
    }
    return [];
  }

  function spawnAgrithNaar(player) {
    if (demonNpcs.has(player)) return;
    removeWizard(player, "matthew");
    const npc = api.spawnNpc({
      id: NpcIdentifiers.AGRITH_NAAR,
      x: DEMON_TILE.x,
      y: DEMON_TILE.y,
      z: DEMON_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) demonNpcs.set(player, npc);
    const scene = Scenes.get(player) ?? Scenes.open(player, "shadow-summoning", [[2706, 2738, 4879, 4918, 2]]);
    Scenes.camera(player, [2722, 4907, 500], [2720, 4900, 500]);
    Scenes.later(scene, 1, () => Scenes.camera(player, [2719, 4907, 500], [2720, 4900, 500], { rate: 1, rate2: 1 }));
    Scenes.later(scene, 10, () => Scenes.camera(player, [2718, 4897, 400], [2720, 4903, 150]));
    Scenes.later(scene, 11, () => Scenes.camera(player, [2719, 4900, 350], [2720, 4903, 150]));
    Scenes.later(scene, 12, () => Scenes.camera(player, [2719, 4909, 500], [2720, 4900, 150]));
    Scenes.later(scene, 14, () => Scenes.end(player));
  }

  function convertSilverlightToDarklight(player) {
    const equipment = player.getEquipment();
    const slot = (equipment.getItems() || []).findIndex(
      (item) =>
        item &&
        (item.getId?.() === DYED_SILVERLIGHT_ITEM_ID || item.getId?.() === SILVERLIGHT_ITEM_ID)
    );
    if (slot >= 0) {
      equipment.set(slot, new Item(DARKLIGHT_ITEM_ID, 1)).refreshItems();
      player.getUpdateFlag?.().flag?.(Flag.APPEARANCE);
      return;
    }
    const inventory = player.getInventory();
    if (inventory.getAmount(DYED_SILVERLIGHT_ITEM_ID) > 0) {
      inventory.deleteNumber(DYED_SILVERLIGHT_ITEM_ID, 1);
    } else if (inventory.getAmount(SILVERLIGHT_ITEM_ID) > 0) {
      inventory.deleteNumber(SILVERLIGHT_ITEM_ID, 1);
    }
    inventory.adds(DARKLIGHT_ITEM_ID, 1);
  }

  function completeQuest(player) {
    if (quest.isComplete(player)) return;
    const skill = chosenSkill(player);
    if (skill) {
      quest.xpRewards = [{ skillId: skill.getIndex(), amount: COMBAT_XP, label: skill.getName() }];
    }
    quest.complete(player);
    // complete() sets the stage itself, so repair the sibling varbits here:
    // the post-quest Reen/Badden transforms need to come back.
    syncShadowVarbits(player);
    Scenes.end(player);
    removeAllWizards(player);
    removeDemon(player);
  }

  function handleConditionEvent(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    if (COND_REEN_LOST.has(stepId)) {
      restoreSilverlight(player);
      return;
    }
    if (stepId === COND_BADDEN_SILVERLIGHT_PRESENT || stepId === COND_BADDEN_SILVERLIGHT_LOST) {
      if (quest.getStage(player) === STAGE_STARTED) setStage(player, STAGE_INFILTRATE);
      return;
    }
    if (stepId === COND_BLACK_DYED) {
      if (quest.getStage(player) === STAGE_INFILTRATE) setStage(player, STAGE_IN_GROUP);
      return;
    }
    if (stepId === COND_MOULD_FREE) {
      if (!hasItem(player, DEMONIC_SIGIL_MOULD_ITEM_ID)) {
        giveItem(player, DEMONIC_SIGIL_MOULD_ITEM_ID, "Jennifer gives you the demonic sigil mould.");
      }
      return;
    }
    if (stepId === COND_KILN_BOOK) {
      if (!hasItem(player, DEMONIC_TOME_ITEM_ID)) {
        giveItem(player, DEMONIC_TOME_ITEM_ID, "You find a demonic tome in the kiln.");
      }
      return;
    }
    if (stepId === COND_MATTHEW_UNDYED || stepId === COND_MATTHEW_DYED) {
      if (quest.getStage(player) < STAGE_BOOK_SHOWN) setStage(player, STAGE_BOOK_SHOWN);
      return;
    }
    if (stepId === COND_GOLEM_NO_SIGIL) {
      player.getPacketSender().sendVarbit(VARBIT_CONVINCED_GOLEM, 1);
      return;
    }
    if (stepId === COND_BADDEN_SIGIL) {
      recruitHelper(player, BIT_BADDEN);
      return;
    }
    if (stepId === COND_REEN_SIGIL) {
      recruitHelper(player, BIT_REEN);
      return;
    }
    if (stepId === COND_GOLEM_SIGIL) {
      recruitHelper(player, BIT_GOLEM);
      return;
    }
    if (stepId === COND_SUMMON_READY) {
      // Talking to Matthew assembles the circle; the fight itself begins when
      // the player clicks Chant on their demonic sigil.
      player.setAttribute(SUMMON_ASSEMBLED_ATTRIBUTE, true);
      return;
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    // Capture 572/3333: only the slice line shows, in an item box with the dyed sword.
    if (stepId === MSG_DYE_PICK_MUSHROOM) {
      event.handled = true;
      return;
    }
    if (stepId === MSG_DYE_SLICE) {
      event.box = { items: [DYED_SILVERLIGHT_ITEM_ID] };
      return;
    }
    if (stepId === MSG_REEN_GIVES_SWORD) {
      restoreSilverlight(player);
      return; // leave the wiki message to play
    }
    if (stepId === MSG_ESCORT_THRONE) {
      if (quest.getStage(player) === STAGE_INFILTRATE) setStage(player, STAGE_IN_GROUP);
      player.moveTo(new Location(THRONE_ENTRY_TILE.x, THRONE_ENTRY_TILE.y, THRONE_ENTRY_TILE.z));
      return; // leave the wiki message to play
    }
    if (stepId === MSG_DAVE_RETURNS) {
      recruitEvilDave(player);
      return; // leave the wiki message to play
    }
    if (stepId === MSG_TANYA_KILLED) {
      tanyaKilled(player);
      return; // leave the wiki message to play
    }
    if (stepId === ACTION_RITUAL_ASSEMBLES) {
      // Denath gets everyone into place; the player then clicks the demonic
      // sigil's Chant option to lead the incantation (Quest Helper
      // IncantationStep), so do not auto-start the menus here.
      event.handled = true;
      if (quest.getStage(player) === STAGE_BOOK_SHOWN) setStage(player, STAGE_RITUAL);
      return;
    }
    if (stepId === ACTION_MATTHEW_KILLED) {
      event.handled = true;
      removeWizard(player, "matthew");
      return;
    }
    if (stepId === ACTION_DEMON_ATTACKS) {
      event.handled = true;
      spawnAgrithNaar(player);
      return;
    }
    if (stepId === ACTION_GOLEM_REPROGRAMMED) {
      const bits = helperBits(player);
      if (!(bits & BIT_GOLEM_REPROGRAMMED)) {
        setHelperBits(player, bits | BIT_GOLEM_REPROGRAMMED);
        player.getPacketSender().sendVarbit(VARBIT_CONVINCED_GOLEM, 2);
      }
      return; // leave the wiki messages to play
    }
    if (stepId === ACTION_QUEST_COMPLETE) {
      event.handled = true;
      event.end = true;
      completeQuest(player);
      return;
    }
  }

  function handleChoice({ player, npcId, option }) {
    if (!player) return;
    const text = String(option ?? "");

    const wordIndex = WORD_INDEX.get(text.toLowerCase());
    if (wordIndex !== undefined) {
      let picks = ritualPicks.get(player);
      if (!Array.isArray(picks) || picks.length >= INCANTATION_WORDS.length) picks = [];
      picks.push(wordIndex);
      ritualPicks.set(player, picks);
      const scene = Scenes.get(player);
      if (scene?.name === "shadow-second-ritual" && picks.length <= 5) {
        const beat = [
          [2719, 4894, 600, 1], [2718, 4895, 650, 2], [2717, 4896, 700, 3],
          [2716, 4897, 750, 4], [2715, 4899, 800, 5],
        ][picks.length - 1];
        Scenes.later(scene, 1, () => {
          Scenes.camera(player, [beat[0], beat[1], beat[2]], [2720, 4900, 150], { rate: 1, rate2: 1 });
          shake(player, beat[3]);
        });
      }
      return;
    }

    const skill = SKILL_BY_OPTION.get(text);
    if (skill) {
      player.setAttribute(REWARD_ATTRIBUTE, skill.getIndex());
      return;
    }

    const stage = quest.getStage(player);
    // "What do I have to do?" is asked of Denath during Evil Dave's escort, so it can
    // arrive with Dave's id; "I forgot the incantation." lets Denath's own talk catch up.
    if (stage === STAGE_IN_GROUP && (text === "What do I have to do?" || text === "I forgot the incantation.")) {
      if (!packedIncantation(player)) assignIncantation(player);
      setStage(player, STAGE_DENATH_TOLD);
      return;
    }
    if (MATTHEW_NPC_IDS.has(npcId) && text === "Do you know what happened to Josef?" && stage === STAGE_DENATH_TOLD) {
      setStage(player, STAGE_MATTHEW_TOLD);
      return;
    }
    if (GOLEM_NPC_IDS.has(npcId) && text === "Did you see anything happen last night?" && stage === STAGE_MATTHEW_TOLD) {
      hideTome(player);
      setStage(player, STAGE_GOLEM_TOLD);
    }
  }

  /** Fills the wiki placeholders and echoes the incantation words chosen. */
  function fillTranscriptText(event) {
    if (!event?.player || typeof event.text !== "string") return;
    if (!OWN_NPC_IDS.has(event.npcId)) return;
    let text = event.text;
    if (text.includes("[player name]")) {
      text = text.replace(/\[player name\]/gi, String(event.player.getUsername()));
    }
    if (text.includes("[him/her]") || text.includes("[his/her]") || text.includes("[He/She]")) {
      const male = event.player.getAppearance?.().isMale?.() !== false;
      text = text
        .replace(/\[him\/her\]/g, male ? "him" : "her")
        .replace(/\[his\/her\]/g, male ? "his" : "her")
        .replace(/\[He\/She\]/g, male ? "He" : "She");
    }
    if (text.includes("[Word ")) {
      const picks = ritualPicks.get(event.player) ?? [];
      text = text.replace(/\[Word (\d)(!)?\]/g, (match, number, emphasis) => {
        const pick = picks[Number(number) - 1];
        return pick === undefined ? match : INCANTATION_WORDS[pick] + (emphasis ?? "");
      });
    }
    if (event.step?.speaker === "[Everyone]" && event.step.presentation === "overhead") {
      const stage = quest.getStage(event.player);
      if (stage === STAGE_RITUAL || stage === STAGE_READY) {
        const cast = stage === STAGE_RITUAL ? RITUAL_CAST : SECOND_CAST;
        const tracked = wizardNpcs.get(event.player);
        event.actors = cast.map(({ key }) => {
          const actor = tracked?.get(key);
          return actor?.getOwner?.() === event.player && actor.isOwnerOnly?.() === true ? actor : undefined;
        });
      }
    }
    // Native NpcDialogues resolves the pblmt4 condition at build time and can
    // emit the branch as a condition_chosen action; the resolved line is the
    // reliable signal that Matthew accepted the sigil + Silverlight. Guard it
    // with the real stage/items/helpers so an early line can never assemble.
    if (
      MATTHEW_NPC_IDS.has(event.npcId) &&
      quest.getStage(event.player) === STAGE_READY &&
      /here we go/i.test(text) &&
      (helperBits(event.player) & ALL_HELPERS_MASK) === ALL_HELPERS_MASK &&
      hasItem(event.player, DEMONIC_SIGIL_ITEM_ID) &&
      hasSilverlight(event.player)
    ) {
      event.player.setAttribute(SUMMON_ASSEMBLED_ATTRIBUTE, true);
    }
    event.text = text;
  }

  /** "The Golem" / "Demon Slayer" are the wiki prerequisites for this quest. */
  function shadowPrereqsMet(player) {
    return (
      player.getSkillManager().getMaxLevel(Skill.CRAFTING) >= CRAFTING_REQUIREMENT &&
      questComplete(player, "the_golem") &&
      questComplete(player, "demon_slayer")
    );
  }

  const PREREQUISITE_MESSAGE =
    `You need ${CRAFTING_REQUIREMENT} Crafting, The Golem and Demon Slayer before you can start Shadow of the Storm.`;

  function refuseShadowStart(player) {
    // The transcript has no prerequisite refusal branch, so use the generic
    // requirement message instead of inventing NPC speech.
    player.sendMessage(PREREQUISITE_MESSAGE);
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !REEN_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (!shadowPrereqsMet(player)) {
      player.sendMessage(PREREQUISITE_MESSAGE);
      return;
    }
    // A reset re-runs the start: drop the progress that lives outside the stage.
    player.setAttribute(HELPERS_ATTRIBUTE, 0);
    player.setAttribute(KILN_ATTRIBUTE, 0);
    player.setAttribute(INCANTATION_ATTRIBUTE, 0);
    player.setAttribute(REWARD_ATTRIBUTE, 0);
    player.setAttribute(SUMMON_ASSEMBLED_ATTRIBUTE, false);
    setStage(player, STAGE_STARTED);
  }

  // ============================================================================
  // Interactions
  // ============================================================================

  function dyeSilverlight(player, reagentId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_RITUAL_DONE) {
      player.sendMessage("You have no reason to do that.");
      return;
    }
    if (!hasItem(player, SILVERLIGHT_ITEM_ID)) return;
    if (reagentId !== undefined && !hasItem(player, reagentId)) return;
    // Wiki: dyeing takes every Silverlight carried and leaves one dyed sword.
    player.getInventory().deleteNumber(SILVERLIGHT_ITEM_ID, player.getInventory().getAmount(SILVERLIGHT_ITEM_ID));
    if (reagentId !== undefined) player.getInventory().deleteNumber(reagentId, 1);
    player.getInventory().adds(DYED_SILVERLIGHT_ITEM_ID, 1);
    startTranscript(api, player, NpcIdentifiers.FATHER_REEN, PAGE, "to-uzer-dyeing-silverlight-black");
  }

  /**
   * "Chant" on the demonic sigil is what starts both incantations in OSRS;
   * Quest Helper highlights the inventory sigil for exactly this step.
   */
  function handleItemAction(event) {
    if (event.itemId !== DEMONIC_SIGIL_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("chant")) return;
    event.handled = true;
    const stage = quest.getStage(event.player);
    if (stage === STAGE_BOOK_SHOWN || stage === STAGE_RITUAL) startFirstIncantation(event.player);
    else if (stage === STAGE_READY) startSecondIncantation(event.player);
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (objectId !== BLACK_MUSHROOM_OBJECT_ID || itemId !== SILVERLIGHT_ITEM_ID) return;
    event.handled = true;
    dyeSilverlight(player);
  }

  function dyeClothing(player, clothingId) {
    const { result, name } = BLACK_DYEABLE_CLOTHING.get(clothingId);
    if (!hasItem(player, BLACK_DYE_ITEM_ID) || !hasItem(player, clothingId)) return;
    player.getInventory().deleteNumber(BLACK_DYE_ITEM_ID, 1);
    player.getInventory().deleteNumber(clothingId, 1);
    player.getInventory().adds(result, 1);
    player.getPacketSender().sendSoundEffect(DYE_SOUND, 1, 0);
    player.sendMessage(`You dye the ${name} black.`);
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = [usedItemId, usedWithItemId];
    const clothingId = ids.find((id) => BLACK_DYEABLE_CLOTHING.has(id));
    if (clothingId !== undefined && ids.includes(BLACK_DYE_ITEM_ID)) {
      event.handled = true;
      dyeClothing(player, clothingId);
      return;
    }
    if (!ids.includes(SILVERLIGHT_ITEM_ID)) return;
    const reagentId = ids.includes(BLACK_MUSHROOM_ITEM_ID)
      ? BLACK_MUSHROOM_ITEM_ID
      : ids.includes(BLACK_DYE_ITEM_ID)
        ? BLACK_DYE_ITEM_ID
        : undefined;
    if (reagentId === undefined) return;
    event.handled = true;
    dyeSilverlight(player, reagentId);
  }

  function smeltDemonicSigil(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_IN_GROUP || stage >= STAGE_COMPLETE) return false;
    if (!hasItem(player, DEMONIC_SIGIL_MOULD_ITEM_ID)) return false;
    event.handled = true;
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < CRAFTING_REQUIREMENT) {
      player.sendMessage(`You need a Crafting level of ${CRAFTING_REQUIREMENT} to cast a demonic sigil.`);
      return;
    }
    if (!hasItem(player, SILVER_BAR_ITEM_ID)) {
      player.sendMessage("You need a silver bar to cast a demonic sigil.");
      return;
    }
    player.getInventory().deleteNumber(SILVER_BAR_ITEM_ID, 1);
    player.getInventory().adds(DEMONIC_SIGIL_ITEM_ID, 1);
    player.sendMessage("You pour the molten silver into the demonic sigil mould.");
  }

  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!GOLEM_NPC_IDS.has(npcId)) return;
    if (event.itemId !== STRANGE_IMPLEMENT_ITEM_ID) return;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_RITUAL_DONE || stage >= STAGE_COMPLETE) return; // The Golem owns the implement otherwise
    event.handled = true;
    if (helperBits(player) & BIT_GOLEM_REPROGRAMMED) return;
    setHelperBits(player, helperBits(player) | BIT_GOLEM_REPROGRAMMED);
    player.getPacketSender().sendVarbit(VARBIT_CONVINCED_GOLEM, 2);
    startTranscript(api, player, npcId, PAGE, "performing-the-ritual-reprogramming-the-golem");
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    const portalStage = quest.getStage(player);
    if (objectId === PORTAL_ENTER_OBJECT_ID && portalStage >= STAGE_IN_GROUP && portalStage < STAGE_COMPLETE) {
      event.handled = true;
      player.sendMessage("You step into the portal.");
      player.moveTo(new Location(2720, 4884, 2));
      ensureWizardNpcs(player);
      return;
    }
    if (objectId === PORTAL_EXIT_OBJECT_ID && portalStage >= STAGE_IN_GROUP && portalStage < STAGE_COMPLETE) {
      event.handled = true;
      player.sendMessage("You step into the portal.");
      player.moveTo(new Location(2721, 4911, 0));
      return;
    }
    if (!KILN_OBJECT_IDS.has(objectId)) return;
    ensureKilnSearchActions();
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_GOLEM_TOLD || stage >= STAGE_RITUAL) {
      player.sendMessage("You don't know what you are looking for.");
      return;
    }
    kilnSearchCorrect.set(player, objectId === SURFACE_KILN_OBJECT_IDS[hiddenKiln(player)]);
    startTranscript(api, player, NpcIdentifiers.MATTHEW, PAGE, "infiltrating-the-wizards-searching-kilns");
  }

  function handleNpcInteraction(event) {
    const { player } = event;
    if (!player) return;
    const actions = event.definition?.getActions?.() ?? [];
    const action = String(actions[event.clickType - 1] ?? "").toLowerCase();
    const talk = action === "talk-to" || (action === "" && event.clickType === 1);
    if (!talk) return;

    if (REEN_NPC_IDS.has(event.npcId) && quest.getStage(player) === STAGE_NOT_STARTED) {
      event.handled = true;
      if (!shadowPrereqsMet(player)) {
        refuseShadowStart(player);
        return;
      }
      startTranscript(api, player, event.npcId, PAGE, "starting-off");
      return;
    }

    if (GOLEM_NPC_IDS.has(event.npcId)) {
      const selected = selectVariant({ npcId: event.npcId, player });
      if (!selected) return; // let The Golem's plugin run its own dialogue
      const page = typeof selected === "string" ? PAGE : selected.page ?? PAGE;
      const variant = typeof selected === "string" ? selected : selected.variant;
      event.handled = true;
      startTranscript(api, player, event.npcId, page, variant);
      return;
    }

    const chatHead = LEGACY_NPC_CHAT_HEAD.get(event.npcId);
    if (chatHead === undefined) return;
    syncShadowVarbits(player);
    const variant = selectVariant({ npcId: event.npcId, player });
    if (!variant) return;
    event.handled = true;
    startTranscript(api, player, chatHead, PAGE, typeof variant === "string" ? variant : variant.variant);
  }

  function tanyaKilled(player) {
    const bits = helperBits(player);
    if (bits & BIT_TANYA) return false;
    setHelperBits(player, bits | BIT_TANYA);
    if (quest.getStage(player) < STAGE_PREPARE) setStage(player, STAGE_PREPARE);
    const tile = new Location(2722, 4905, 0);
    if (!itemOnGroundManager.getGroundItem(player.getUsername(), DEMONIC_SIGIL_ITEM_ID, tile)) {
      // World-owned, not cutscene-owned: the Tanya scene PrivateArea is
      // destroyed at tick 10 and would deregister a private-area item.
      itemOnGroundManager.registerLocation(player, new Item(DEMONIC_SIGIL_ITEM_ID, 1), tile, null);
    }
    return true;
  }

  /**
   * Capture 3333 t2139-t2150: the portal closes, the player returns to
   * 2721,4911,0, Tanya (919) and three ghosts (1989) appear under a fixed
   * camera, the ghosts kill her, and the sigil drops where she stood.
   */
  function beginPortalClosing(player) {
    if (quest.getStage(player) !== STAGE_RITUAL_DONE) return;
    if (helperBits(player) & BIT_TANYA) return;
    // Do not cut the first-ritual camera track if the player clicks through
    // the outcome dialogue faster than the captured beats.
    if (Scenes.get(player)?.name === "shadow-first-ritual-close") {
      TaskManager.submit(new CountdownTask(player, 1, () => beginPortalClosing(player)));
      return;
    }
    player.moveTo(new Location(2721, 4911, 0));
    const scene = Scenes.open(player, "shadow-tanya-death", [[2706, 2738, 4879, 4918, 0]]);
    const tanya = Scenes.actor(scene, 919, [2722, 4905, 0], [2722, 4900]);
    const ghosts = [
      [2721, 4904], [2722, 4904], [2723, 4904],
    ].map(([x, y]) => Scenes.actor(scene, 1989, [x, y, 0], [2722, 4900]));
    Scenes.camera(player, [2721, 4897, 350], [2722, 4911, 25]);
    Scenes.later(scene, 7, () => {
      startTranscript(api, player, NpcIdentifiers.MATTHEW, PAGE, "performing-the-ritual-walking-out-of-the-portal");
      if (tanya) Scenes.removeActor(scene, tanya);
      for (const ghost of ghosts) if (ghost) Scenes.removeActor(scene, ghost);
      if (!(helperBits(player) & BIT_TANYA)) {
        player.sendMessage("You see Tanya killed by ghosts!");
        tanyaKilled(player);
      }
    });
    Scenes.later(scene, 10, () => {
      Scenes.end(player);
      // The sigil was created while the player was inside the scene area, so
      // refresh ground items now that they are back in the world.
      itemOnGroundManager.onRegionChange(player);
    });
  }

  function handleAgrithNaarBeforeDeath(event) {
    const npc = event.npc;
    if (!npc || npc.getId?.() !== NpcIdentifiers.AGRITH_NAAR) return;
    const killer = npc.getCombat?.().getKiller?.(false);
    if (!killer || killer.isPlayer?.() !== true) return;
    if (demonNpcs.get(killer) !== npc) return;
    if (silverlightEquipped(killer)) return;
    npc.setHitpoints(DEMON_HP_ON_REGEN);
    killer.sendMessage("Agrith-Naar's wounds close. You must strike the final blow with Silverlight!");
    event.preventDeath = true;
  }

  function handleAgrithNaarDeath(event) {
    const killer = event.killer;
    const npc = event.npc;
    if (!killer?.isPlayer?.() || !npc) return;
    if (demonNpcs.get(killer) !== npc) return;
    demonNpcs.delete(killer);
    convertSilverlightToDarklight(killer);
    setStage(killer, STAGE_KILLED);
    startTranscript(api, killer, NpcIdentifiers.MATTHEW, PAGE, "summoning-agrith-naar-killing-agrith-naar");
  }

  // ============================================================================
  // Session lifecycle
  // ============================================================================

  /** The strange implement is needed again after the first ritual. */
  function ensureImplement(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_RITUAL_DONE || stage >= STAGE_COMPLETE) return;
    if (hasItem(player, STRANGE_IMPLEMENT_ITEM_ID)) return;
    const tile = new Location(2713, 4913, 0);
    if (itemOnGroundManager.getGroundItem(player.getUsername(), STRANGE_IMPLEMENT_ITEM_ID, tile)) return;
    itemOnGroundManager.registerLocation(player, new Item(STRANGE_IMPLEMENT_ITEM_ID, 1), tile);
  }

  function handleZoneEnter({ player }) {
    if (!player) return;
    ensureWizardNpcs(player);
    ensureDemon(player);
    ensureImplement(player);
  }

  /** Re-tracks, or respawns, the fight after a relog. */
  function ensureDemon(player) {
    if (demonNpcs.has(player) || quest.getStage(player) !== STAGE_SUMMONED) return;
    for (const npc of api.getWorld?.().getNpcs?.() ?? []) {
      if (npc?.getId?.() === NpcIdentifiers.AGRITH_NAAR && npc.getOwner?.() === player) {
        demonNpcs.set(player, npc);
        return;
      }
    }
    spawnAgrithNaar(player);
  }

  function handleLogin({ player }) {
    if (!player) return;
    ensureKilnSearchActions();
    refreshQuestList(player);
    syncShadowVarbits(player);
    ensureWizardNpcs(player);
    ensureDemon(player);
    ensureImplement(player);
    if (quest.getStage(player) === STAGE_RITUAL_DONE && !(helperBits(player) & BIT_TANYA)) {
      beginPortalClosing(player);
    }
  }

  function handleBootstrapComplete({ player }) {
    if (!player) return;
    ensureKilnSearchActions();
    syncShadowVarbits(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    restoreRitualView(player);
    Scenes.end(player, true);
    removeAllWizards(player);
    removeDemon(player);
  }

  // ============================================================================
  // Journal
  // ============================================================================

  function helperLine(done, doneText, pendingText) {
    return done ? `<str>${doneText}</str>` : pendingText;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Father Reen sent me to Uzer, where the dark wizard Denath was</str>",
        "<str>trying to summon the demon Agrith-Naar.</str>",
        "<str>Denath was Agrith-Naar all along. With the priests and a clay</str>",
        "<str>golem I summoned him again and slew him with Silverlight, which</str>",
        "<str>became the mighty sword Darklight.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RITUAL_DONE) {
      const bits = helperBits(player);
      return [
        "<str>Denath was Agrith-Naar all along, and the ritual sent him back</str>",
        "<str>to his own dimension.</str>",
        "",
        "I must gather eight people to summon him again and slay him with",
        "<col=800000>Silverlight</col>. I need a <col=800000>demonic sigil</col> for each helper.",
        helperLine(bits & BIT_DAVE, "Evil Dave will return to the throne room.", "I must convince <col=800000>Evil Dave</col> to return."),
        helperLine(bits & BIT_BADDEN, "Father Badden will help.", "Father Badden needs a <col=800000>demonic sigil</col>."),
        helperLine(bits & BIT_REEN, "Father Reen will help.", "Father Reen needs a <col=800000>demonic sigil</col>."),
        helperLine(
          bits & BIT_GOLEM,
          "The clay golem will help.",
          bits & BIT_GOLEM_REPROGRAMMED
            ? "The clay golem needs a <col=800000>demonic sigil</col>."
            : "I should reprogram the <col=800000>clay golem</col> with the <col=800000>strange implement</col>."
        ),
      ];
    }
    if (stage >= STAGE_BOOK_SHOWN) {
      return [
        "<str>I infiltrated Denath's group and made a demonic sigil.</str>",
        "<str>I found Josef's demonic tome and showed it to Matthew.</str>",
        "",
        "I should stand ready for the ritual to summon Agrith-Naar.",
      ];
    }
    if (stage >= STAGE_GOLEM_TOLD) {
      return [
        "<str>I infiltrated Denath's group and made a demonic sigil.</str>",
        "<str>The clay golem told me Josef hid a book in one of the broken</str>",
        "<str>kilns in Uzer.</str>",
        "",
        hasItem(player, DEMONIC_TOME_ITEM_ID)
          ? "I have the <col=800000>demonic tome</col>; I should show it to <col=800000>Matthew</col>."
          : "I should search the <col=800000>broken kilns</col> for the tome.",
      ];
    }
    if (stage >= STAGE_MATTHEW_TOLD) {
      return [
        "<str>I infiltrated Denath's group and made a demonic sigil.</str>",
        "<str>Matthew told me Josef hid a book he had read somewhere in the</str>",
        "<str>ruins, and that the <col=800000>clay golem</col> saw what happened.</str>",
        "",
        "I should ask the <col=800000>clay golem</col> about last night.",
      ];
    }
    if (stage >= STAGE_DENATH_TOLD) {
      return [
        "<str>I infiltrated Denath's group and made a demonic sigil.</str>",
        "<str>Denath taught me the incantation that will summon Agrith-Naar.</str>",
        "",
        "I should get a <col=800000>demonic sigil mould</col> from <col=800000>Jennifer</col>",
        "and speak to <col=800000>Matthew</col>.",
      ];
    }
    if (stage >= STAGE_IN_GROUP) {
      return [
        "<str>Father Badden sent me to infiltrate Denath's group in Uzer.</str>",
        "<str>Evil Dave let me into the demon's throne room.</str>",
        "",
        "I should speak to <col=800000>Denath</col>.",
      ];
    }
    if (stage >= STAGE_INFILTRATE) {
      return [
        "<str>Father Reen told me to help kill the demon Agrith-Naar when</str>",
        "<str>Denath summons it in Uzer.</str>",
        "<str>Father Badden told me to infiltrate the group of dark wizards.</str>",
        "",
        "I need to look evil: wear three black items and dye my",
        "<col=800000>Silverlight</col> black with a <col=800000>black mushroom</col>.",
        "I will need level 30 Crafting to make a demonic sigil.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Father Reen told me the dark wizard Denath plans to summon</str>",
        "<str>the demon Agrith-Naar in the lost city of Uzer.</str>",
        "",
        "I should take <col=800000>Silverlight</col> and find <col=800000>Father Badden</col>",
        "at the <col=800000>ruins of Uzer</col>.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Father Reen</col>",
      "south of the <col=800000>Al Kharid</col> bank.",
      "",
      "I must have completed <col=800000>The Golem</col> and <col=800000>Demon Slayer</col>,",
      "and I should be able to defeat a level 100 demon.",
    ];
  }

  function grantReward(player) {
    const skill = chosenSkill(player) ?? Skill.STRENGTH;
    player.getSkillManager().addExperiences(skill, COMBAT_XP);
  }

  /** The broken kilns have no cache option; give them the wiki's "Search". */
  function ensureKilnSearchActions() {
    for (const objectId of KILN_OBJECT_IDS) {
      const definition = ObjectDefinition.forId(objectId);
      if (!definition) continue;
      const actions = definition.getInteractions?.();
      if (Array.isArray(actions) && actions.includes("Search")) continue;
      definition.interactions = ["Search"];
    }
  }

  // ============================================================================
  // Registration
  // ============================================================================

  itemOnGroundManager = api.getItemOnGroundManager();

  quest = registerQuest(api, {
    key: "shadow_of_the_storm",
    name: "Shadow of the Storm",
    varpId: VARP_SHADOW_OF_THE_STORM,
    varbitId: VARBIT_AGRITH_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    varbitValue(stage) {
      return stage >= STAGE_COMPLETE ? VARBIT_QUEST_FINISHED : stage | 0;
    },
    questPoints: 1,
    xpRewards: [],
    scrollItemId: DARKLIGHT_ITEM_ID,
    rewardItemLabel: "Darklight",
    buildJournal,
    onReward: grantReward,
  });

  ensureKilnSearchActions();

  api.persistAttribute(HELPERS_ATTRIBUTE);
  api.persistAttribute(KILN_ATTRIBUTE);
  api.persistAttribute(INCANTATION_ATTRIBUTE);
  api.persistAttribute(REWARD_ATTRIBUTE);
  api.persistAttribute(SUMMON_ASSEMBLED_ATTRIBUTE, false);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:condition", handleConditionEvent);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", fillTranscriptText);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrapComplete);
  api.onItemAction(handleItemAction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnObject("Silver bar", "Furnace", smeltDemonicSigil, { noted: false });
  api.onItemOnItem(handleItemOnItem, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onZoneEnter(UNDERGROUND_ZONE, handleZoneEnter);
  api.onZoneEnter(THRONE_ZONE, handleZoneEnter);
  api.onNpcBeforeDeath(handleAgrithNaarBeforeDeath);
  api.onNpcDeath(handleAgrithNaarDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
