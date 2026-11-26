/**
 * Dwarf Cannon (members).
 *
 * The words come from the "Dwarf Cannon" transcript page (Captain Lawgof and Nulodion are
 * indexed); this plugin supplies the by-stage variant selector, the prose-condition answers, the
 * item hand-outs and the object legs. What live sends and when is from rsprox captures: local
 * 1001565 (rev 241, start to finish), 1001618 (rev 241) and 1002239 (rev 242, start to Lollk);
 * docs/quests/dwarf-cannon/README.md has the facts.
 *
 * The saved stage is varp 0 (`mcannon`) as live sets it:
 *   1 started (Lawgof's "That's the spirit!"), 2 railings reported ("Excellent! I have two men
 *   there"), 3 the watchtower's top ladder climbed (the remains only show at 3), 4 remains handed
 *   in (on the box's continue), 5 the goblin cave entered, 6 Lollk untied, 7 toolkit given,
 *   8 cannon fixed, 9 agreed to see Nulodion (the conversation's close), 10 notes and mould given,
 *   11 complete.
 * Saves from before this numbering (stage schema 0) are moved onto it once at login.
 *
 * The railings and the repair puzzle live in varbits of varp 1 (`mcannonmulti`): the six
 * mcannon_railing<n>_fixed (2240-2245), mcannon_taken_corpse (2246, live sets it with railing 6),
 * the tool selection (2235-2237) and the safety/spring (2238/2239). Completion clears them all.
 */
/** The railing rolls, out of 1 (tests replace it: other plugins share Math.random). */
const rolls = { next: () => Math.random() };

module.exports = function registerDwarfCannonQuest(api) {
  const {
    Skill, ItemIdentifiers, NpcIdentifiers, Location, Animation, CountdownTask, TaskManager, HitDamage, HitMask,
    GameObject, Item, ItemOnGroundManager, NPC, World, Direction,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Dwarf Cannon";
  const LAWGOF_PAGE = "Captain Lawgof";
  const LAWGOF = NpcIdentifiers.CAPTAIN_LAWGOF;
  const LOLLK = NpcIdentifiers.LOLLK;
  const NULODION = NpcIdentifiers.NULODION;
  const I = ItemIdentifiers;

  const VARP_DWARF_CANNON = 0;

  const STAGE_FIX_RAILINGS = 1;
  const STAGE_CHECK_WATCHTOWER = 2;
  const STAGE_TOWER_CLIMBED = 3;
  const STAGE_FIND_LOLLK = 4;
  const STAGE_IN_CAVE = 5;
  const STAGE_LOLLK_RESCUED = 6;
  const STAGE_REPAIR_CANNON = 7;
  const STAGE_CANNON_REPAIRED = 8;
  const STAGE_SPEAK_TO_NULODION = 9;
  const STAGE_RETURN_NOTES = 10;
  const STAGE_COMPLETE = 11;

  /** Saves written before the stage followed varp 0 (stage schema 0), old stage -> new. */
  const STAGE_SCHEMA_ATTRIBUTE = "dwarf-cannon:stage-schema";
  const STAGE_SCHEMA = 1;
  const LEGACY_STAGES = {
    2: () => STAGE_FIX_RAILINGS, // railings fixed, not yet reported: live stays on 1
    3: (player) => has(player, I.DWARF_REMAINS) ? STAGE_TOWER_CLIMBED : STAGE_CHECK_WATCHTOWER,
    5: () => STAGE_LOLLK_RESCUED,
    6: () => STAGE_REPAIR_CANNON,
  };

  // Transcript step ids (npc-dialogues.json, "Dwarf Cannon").
  const STEP = {
    SIX_RAILINGS: "s7iFdl",
    HAMMER: "dTVH6M",
    ANOTHER_RAILING: "09BKsq",
    REMAINS_GIVEN: "KcffSR",
    UNTIED: "yacVSg",
    RUNS_OFF: "VYQQX5",
    TOOLKIT: "dqO_5X",
    ANOTHER_TOOLKIT: "R6x03x",
    TOOLKIT_BACK: "A9qG_N",
    NOTES_AND_MOULD: "udZI3D",
    MORE_NOTES: "vxwzuL",
    ANOTHER_MOULD: "3LMqqz",
    COMPLETE: "c8LrCL",
    CANNON_SENT: "jsDXQ4",
  };
  // The lines whose display (or close) moves varp 0 in the capture.
  const START_LINE = /^That's the spirit!/;
  const REPORT_LINE = /^Excellent! I have two men there/;
  const NULODION_ACCEPTED_LINE = "Okay, I'll see what I can do.";
  const TAKE_REMAINS_LINE = "I had better take these remains.";

  // Locs (cache osrs-242).
  const RAILING_OBJECT_IDS = [15590, 15591, 15592, 15593, 15594, 15595]; // mcannon_railing<n>_multiloc
  const INTACT_RAILING_OBJECT_ID = 15601; // mcannon_dwarf_railing_fixed: the camp fence's unbroken parts
  const REMAINS_OBJECT_ID = 0; // mcannonremains_multiloc: Dwarf remains (15596) while varp 0 is 3
  const REMAINS_TILE = { x: 2567, y: 3444, z: 2 };
  const CRATE_OBJECT_ID = 1; // mcannoncrateboy
  const CRATE_TILE = { x: 2571, y: 9850, z: 0 };
  const CANNON_OBJECT_ID = 15597; // mcannon_cannon_multiloc: broken (5) to 7, fixed (6) from 8
  const TOWER_LADDER_OBJECT_ID = 11; // mcannonladder, to the watchtower's top floor
  const CAVE_ENTRANCE_OBJECT_ID = 2; // mcannoncave
  const MUDPILE_OBJECT_ID = 13; // mcanmudpile
  const MUDPILE_TILE = { x: 2621, y: 9796, z: 0 };
  const OUTSIDE_CAVE_TILE = { x: 2623, y: 3391, z: 0 };

  // Captured timings and ids.
  const LADDER_ANIMATION = 828; // human_reachforladder
  const CHATNEU1 = 588; // the intact railing's player head
  const MUDPILE_ANIMATION_TICKS = 2; // from arrival
  const MUDPILE_MOVE_TICKS = 3;
  const SEARCH_ANIMATION = 827; // human_pickupfloor
  const UNTIE_ANIMATION = 832; // human_pickuptable, client delay 30
  const UNTIE_ANIMATION_DELAY = 30;
  const CHILD_SEEN_TICKS = 3; // "Inside you see a dwarf child, tied up!" after "You search the crate..."
  const UNTIED_TICKS = 5;
  const LOLLK_TILE = [2571, 9851, 0];
  const LOLLK_EXIT = [[2570, 9851], [2569, 9850], [2568, 9849], [2567, 9848]];
  const LOLLK_GONE_TICKS = 4;
  /** Ours: Lollk leaves anyway if the talk is abandoned before "runs off". */
  const LOLLK_TIMEOUT_TICKS = 100;

  // The repair puzzle: cache IF1 group 409. Tools 1-3, safety/spring/gear 7-9, the mechanism 5.
  const CANNON_INTERFACE_GROUP = 409;
  const CANNON_INTERFACE_PARTS = new Map([[7, "safety"], [8, "spring"], [9, "gear"]]);
  const CANNON_TOOL_VARBITS = new Map([[1, 2235], [2, 2236], [3, 2237]]); // mcannonmulti_tool<n>
  const PART_TOOLS = { safety: 2, spring: 3, gear: 1 }; // the Wiki's pliers, hooked tool, toothed tool
  // IF1 409 has no CS1 comparisons: the server selects its cached tool models (captured).
  const CANNON_TOOL_MODELS = new Map([[1, [15328, 15326]], [2, [15330, 15329]], [3, [15332, 15331]]]);
  const CANNON_MECHANISM_COMPONENT = (CANNON_INTERFACE_GROUP << 16) | 5;
  const SEQ = {
    IDLE: 3196, // mcannon_interface_gun_idle
    SAFETY_WITH_SPRING: 3198, // mcannon_interface_gun_safety_off_with_spring (captured)
    SAFETY: 3200, // mcannon_interface_gun_safety_off
    ATTACH_SPRING: 3202, // mcannon_interface_gun_attach_spring (captured)
    ATTACH_SPRING_WITH_SAFETY: 4155, // mcannon_interface_safety_off_attaching_spring
    WORK_WITH_SPRING: 3205, // mcannon_interface_gun_work_with_spring (captured)
  };
  const CANNON_SAFETY_VARBIT = 2238; // mcannon_safety_on
  const CANNON_SPRING_VARBIT = 2239; // mcannon_spring_set
  /** The interface closes 4 ticks after the gear (capture 1001565 ticks 5493-5497). */
  const CANNON_FIXED_CLOSE_TICKS = 4;

  // Railings.
  const RAILS_MASK_ATTRIBUTE = "dwarf-cannon:rails-fixed-mask";
  const RAILING_FIXED_VARBITS = [2240, 2241, 2242, 2243, 2244, 2245];
  const TAKEN_CORPSE_VARBIT = 2246; // set with railing 6 in all three captures
  const RAILS_REQUIRED = RAILING_FIXED_VARBITS.length;
  const RAILING_REPAIR_ANIMATION = 4190; // mcannon_hammer_anim
  const RAILING_REPAIR_SOUND = 2721; // anvil_4
  // From "You attempt to replace": the hammering 2 ticks on, the outcome 2 after it; a stat
  // drain swings again 4 ticks after its outcome, a hit ends the attempt (all three captures).
  const RAILING_SWING_TICKS = 2;
  const RAILING_OUTCOME_TICKS = 2;
  const RAILING_RETRY_TICKS = 4;
  // Wiki "Railing": Crafting only, 24% at level 1, 59% at 99 (Mod Ash), charted low 60 / high 150.
  const RAILING_LOW = 60;
  const RAILING_HIGH = 150;
  // Wiki "Railing": a failure is one of four effects at 25% each; the captures pair each with
  // its message and cry, and play one of sounds 518-521 (delay 20) with it.
  const RAILING_FAILURES = [
    { message: "Your arm is getting tired.", cry: "Urrrgh!", drain: () => Skill.CRAFTING },
    { message: "You cut yourself on the rusty old railing.", cry: "Oooch!", damage: 1 },
    { message: "You accidentally crush your hand in the railing.", cry: "Ow!", damage: 2 },
    { message: "You wrench your back trying to handle the railings.", cry: "Gah!", drain: () => Skill.STRENGTH },
  ];
  const RAILING_FAIL_SOUNDS = [518, 519, 520, 521];
  const RAILING_FAIL_SOUND_DELAY = 20;

  const QUEST_VARBITS = [...CANNON_TOOL_VARBITS.values(), CANNON_SAFETY_VARBIT, CANNON_SPRING_VARBIT,
    ...RAILING_FIXED_VARBITS, TAKEN_CORPSE_VARBIT];

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;
  const at = (location, tile) => location?.x === tile.x && location?.y === tile.y && location?.z === tile.z;
  const pick = (values) => values[Math.floor(rolls.next() * values.length)];

  function addItem(player, itemId, quantity = 1) {
    if (!has(player, itemId)) player.getInventory().adds(itemId, quantity);
  }

  let quest;
  const stage = (player) => quest.getStage(player);
  /** Lollk, untied, per rescuer. */
  const rescuedLollk = new Map();
  /** Players part-way through the crate's search: the tile they search from and the movement hold it took (live is busy for it). */
  const searching = new WeakMap();

  function buildJournal(player, questHandle) {
    const current = questHandle.getStage(player);
    if (current >= STAGE_COMPLETE) {
      return [
        "<str>I helped Captain Lawgof defend his outpost.</str>",
        "<str>I can use dwarf multicannons and make cannonballs.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (current >= STAGE_RETURN_NOTES) return ["I have Nulodion's notes and ammo mould.", "I should return to <col=800000>Captain Lawgof</col>."];
    if (current >= STAGE_SPEAK_TO_NULODION) return ["I should speak to <col=800000>Nulodion</col> at the", "dwarven mine entrance south of Ice Mountain."];
    if (current >= STAGE_CANNON_REPAIRED) return ["The multicannon is repaired.", "I should report to <col=800000>Captain Lawgof</col>."];
    if (current >= STAGE_REPAIR_CANNON) return ["I should use the <col=800000>toolkit</col> on the broken cannon."];
    if (current >= STAGE_LOLLK_RESCUED) return ["I found Lollk alive in the goblin cave.", "I should return to <col=800000>Captain Lawgof</col>."];
    if (current >= STAGE_FIND_LOLLK) return ["The goblins took Lollk.", "I should search the <col=800000>crates</col> inside their cave to the south-east."];
    if (current >= STAGE_CHECK_WATCHTOWER) return ["Captain Lawgof lost contact with his watch tower.", "I should find <col=800000>Gilob</col> at the tower to the south."];
    if (current >= STAGE_FIX_RAILINGS && allRailingsFixed(player)) return ["I've fixed all the broken railings.", "I should report back to <col=800000>Captain Lawgof</col>."];
    if (current >= STAGE_FIX_RAILINGS) return ["Captain Lawgof gave me replacement rails and a hammer.", "I should repair the broken railings."];
    return ["I can start this quest by talking to <col=800000>Captain Lawgof</col> south of the <col=800000>Coal Trucks</col>, north-west of the <col=800000>Fishing Guild</col>."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 750);
  }

  // ---------------------------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------------------------

  /** At 4 and 5, Lawgof repeats his rescue instructions without taking the remains again. */
  function remindAboutLollk({ player, npc, npcId }) {
    if (npcId !== LAWGOF || (stage(player) !== STAGE_FIND_LOLLK && stage(player) !== STAGE_IN_CAVE)) return false;
    return startTranscript(api, player, npcId, PAGE,
      "finding-the-remains-talking-to-captain-lawgof-after-getting-the-remains",
      (steps) => steps.slice(steps.findIndex((step) => step.id === STEP.REMAINS_GIVEN) + 1), npc);
  }

  function selectVariant({ npcId, player }) {
    const current = stage(player);

    if (npcId === LAWGOF) {
      if (current >= STAGE_COMPLETE) return page(LAWGOF_PAGE, "after-completing-dwarf-cannon");
      if (current >= STAGE_RETURN_NOTES) return page(PAGE, "talking-to-lawgof-after-getting-the-ammo-mould");
      if (current >= STAGE_SPEAK_TO_NULODION) return page(PAGE, "fixing-the-cannon-talking-to-captain-lawgof-after-fixing-the-cannon-talking-to-captain-lawgof-again-after-agreeing-to-see-nulodion");
      if (current >= STAGE_CANNON_REPAIRED) return page(PAGE, "fixing-the-cannon-talking-to-captain-lawgof-after-fixing-the-cannon");
      if (current >= STAGE_REPAIR_CANNON) return page(PAGE, "fixing-the-cannon-talking-to-captain-lawgof-before-fixing-the-cannon");
      if (current >= STAGE_LOLLK_RESCUED) return page(PAGE, "the-dwarf-child-talking-to-captain-lawgof-after-finding-lollk");
      if (current >= STAGE_FIND_LOLLK) return page(PAGE, "finding-the-remains-talking-to-captain-lawgof-after-getting-the-remains");
      if (current >= STAGE_TOWER_CLIMBED) {
        return has(player, I.DWARF_REMAINS)
          ? page(PAGE, "finding-the-remains-talking-to-captain-lawgof-after-getting-the-remains")
          : page(PAGE, "finding-the-remains-talking-to-captain-lawgof-after-picking-up-and-losing-the-remains");
      }
      if (current >= STAGE_CHECK_WATCHTOWER) {
        return page(PAGE, "fixing-the-railings-talking-to-captain-lawgof-after-fixing-the-railings-talking-to-captain-lawgof-again-without-visiting-the-watchtower");
      }
      if (current >= STAGE_FIX_RAILINGS) {
        return allRailingsFixed(player)
          ? page(PAGE, "fixing-the-railings-talking-to-captain-lawgof-after-fixing-the-railings")
          : page(PAGE, "fixing-the-railings-talking-to-captain-lawgof-before-fixing-the-railings");
      }
      return page(PAGE, "captain-lawgof");
    }

    if (npcId === NULODION) {
      if (current >= STAGE_COMPLETE) return null;
      if (current >= STAGE_RETURN_NOTES) return page(PAGE, "fixing-the-cannon-talking-to-nulodion-again");
      if (current === STAGE_SPEAK_TO_NULODION) return page(PAGE, "fixing-the-cannon-talking-to-nulodion");
      return null;
    }

    return null;
  }

  function answerCondition({ player, npcId, text }) {
    if (![LAWGOF, NULODION, LOLLK].includes(npcId)) return null;
    const value = String(text).toLowerCase();
    if (value.includes("does not have a hammer")) return !has(player, I.HAMMER);
    if (value.includes("does not have a railing")) return !has(player, I.RAILING);
    if (value.includes("player has no railings")) return !has(player, I.RAILING);
    if (value.includes("player has at least 1 railing")) return has(player, I.RAILING);
    if (value.includes("player has no inventory space")) {
      const inventory = player.getInventory();
      if (npcId === NULODION && stage(player) === STAGE_SPEAK_TO_NULODION) return inventory.getFreeSlots() < missingNotesAndMould(player);
      return inventory.isFull();
    }
    if (value.includes("player already has the remains")) return has(player, I.DWARF_REMAINS);
    if (value.includes("player lost the toolkit")) return !has(player, I.TOOLKIT);
    if (value.includes("player lost the notes")) return !has(player, I.NULODIONS_NOTES);
    if (value.includes("player lost the ammo mould")) return !has(player, I.AMMO_MOULD);
    if (value.includes("player does not have the notes and ammo mould")) {
      return !has(player, I.NULODIONS_NOTES) || !has(player, I.AMMO_MOULD);
    }
    return null;
  }

  const missingNotesAndMould = (player) => [I.NULODIONS_NOTES, I.AMMO_MOULD].filter((itemId) => !has(player, itemId)).length;

  /**
   * The lines live moves varp 0 on. Line events come as the chain is built, so a change on a
   * line's display goes in `before` (run as the line is reached), one on its close in `after`.
   */
  function handleLine(event) {
    const { player, npcId, text } = event;
    const line = String(text ?? "");
    if (npcId === LAWGOF && stage(player) === 0 && START_LINE.test(line)) {
      event.before = () => {
        if (stage(player) === 0) quest.setStage(player, STAGE_FIX_RAILINGS);
      };
    } else if (npcId === LAWGOF && stage(player) === STAGE_FIX_RAILINGS && allRailingsFixed(player) && REPORT_LINE.test(line)) {
      event.before = () => {
        if (stage(player) === STAGE_FIX_RAILINGS) quest.setStage(player, STAGE_CHECK_WATCHTOWER);
      };
    } else if (npcId === LAWGOF && stage(player) === STAGE_CANNON_REPAIRED && line === NULODION_ACCEPTED_LINE && event.step?.player) {
      // Captured on the conversation's close, after the player's line.
      event.after = () => {
        if (stage(player) === STAGE_CANNON_REPAIRED) quest.setStage(player, STAGE_SPEAK_TO_NULODION);
      };
    } else if (line === TAKE_REMAINS_LINE && event.step?.player) {
      // The remains go into the pack (and off the floor) as the line closes.
      event.after = () => takeRemains(player);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    switch (stepId) {
      // "The Dwarf Captain gives you six railings.": an item box with a railing, the railings with it.
      case STEP.SIX_RAILINGS: {
        if (npcId !== LAWGOF) return;
        const missing = RAILS_REQUIRED - player.getInventory().getAmount(I.RAILING);
        if (missing > 0) player.getInventory().adds(I.RAILING, missing);
        event.box = { items: [I.RAILING] };
        return;
      }
      case STEP.HAMMER:
        if (npcId === LAWGOF) addItem(player, I.HAMMER);
        return;
      case STEP.ANOTHER_RAILING:
        if (npcId === LAWGOF) addItem(player, I.RAILING);
        return;
      // "You give the Dwarf Captain his subordinate's remains...": an item box; on its continue
      // the remains go and varp 0 moves to 4.
      case STEP.REMAINS_GIVEN:
        if (npcId !== LAWGOF || stage(player) !== STAGE_TOWER_CLIMBED || !has(player, I.DWARF_REMAINS)) return;
        event.box = { items: [I.DWARF_REMAINS] };
        event.after = () => {
          if (stage(player) !== STAGE_TOWER_CLIMBED || !has(player, I.DWARF_REMAINS)) return;
          player.getInventory().deleteNumber(I.DWARF_REMAINS, 1);
          quest.setStage(player, STAGE_FIND_LOLLK);
        };
        return;
      case STEP.RUNS_OFF:
        sendLollkHome(player);
        return;
      case STEP.TOOLKIT:
        if (npcId !== LAWGOF || stage(player) !== STAGE_LOLLK_RESCUED || player.getInventory().isFull()) return;
        addItem(player, I.TOOLKIT);
        if (has(player, I.TOOLKIT)) quest.setStage(player, STAGE_REPAIR_CANNON);
        return;
      case STEP.ANOTHER_TOOLKIT:
        if (npcId === LAWGOF && stage(player) === STAGE_REPAIR_CANNON) addItem(player, I.TOOLKIT);
        return;
      // Wiki "Toolkit": every copy in the inventory goes.
      case STEP.TOOLKIT_BACK:
        if (npcId !== LAWGOF) return;
        player.getInventory().deleteNumber(I.TOOLKIT, player.getInventory().getAmount(I.TOOLKIT));
        return;
      // "The Cannon Engineer gives you some notes and a mould.": a two-item box; varp 0 is 10 with it.
      case STEP.NOTES_AND_MOULD:
        if (npcId !== NULODION || stage(player) !== STAGE_SPEAK_TO_NULODION) return;
        if (player.getInventory().getFreeSlots() < missingNotesAndMould(player)) return;
        addItem(player, I.NULODIONS_NOTES);
        addItem(player, I.AMMO_MOULD);
        event.box = { items: [I.NULODIONS_NOTES, I.AMMO_MOULD] };
        quest.setStage(player, STAGE_RETURN_NOTES);
        return;
      case STEP.MORE_NOTES:
        if (npcId === NULODION && stage(player) === STAGE_RETURN_NOTES) addItem(player, I.NULODIONS_NOTES);
        return;
      case STEP.ANOTHER_MOULD:
        if (npcId === NULODION && stage(player) === STAGE_RETURN_NOTES) addItem(player, I.AMMO_MOULD);
        return;
      // "The Black Guard sent Lawgof this cannon...": a message box ({{tbox}}).
      case STEP.CANNON_SENT:
        event.box = { statement: true };
        return;
      case STEP.COMPLETE:
        completeQuest(player, npcId);
        return;
      default:
    }
  }

  /** Live takes the notes and the mould (Wiki "Ammo mould": both are given to Lawgof) and clears the quest varbits. */
  function completeQuest(player, npcId) {
    if (npcId !== LAWGOF || stage(player) < STAGE_RETURN_NOTES || quest.isComplete(player)) return;
    if (!has(player, I.NULODIONS_NOTES) || !has(player, I.AMMO_MOULD)) return;
    player.getInventory().deleteNumber(I.NULODIONS_NOTES, 1);
    player.getInventory().deleteNumber(I.AMMO_MOULD, 1);
    player.setAttribute(RAILS_MASK_ATTRIBUTE, 0);
    for (const varbit of QUEST_VARBITS) player.getPacketSender().sendVarbit(varbit, 0);
    quest.complete(player);
  }

  // ---------------------------------------------------------------------------------------------
  // The railings
  // ---------------------------------------------------------------------------------------------

  const railingMask = (player) => Number(player.getAttribute(RAILS_MASK_ATTRIBUTE)) || 0;
  const railingFixed = (player, index) => (railingMask(player) & (1 << index)) !== 0;
  const allRailingsFixed = (player) => railingMask(player) === (1 << RAILS_REQUIRED) - 1;

  /** The chance a swing fixes the railing, out of 1. */
  function railingSuccessChance(player) {
    const level = Math.max(1, Math.min(99, player.getSkillManager().getCurrentLevel(Skill.CRAFTING)));
    return (1 + Math.floor((RAILING_LOW * (99 - level)) / 98 + (RAILING_HIGH * (level - 1)) / 98 + 0.5)) / 256;
  }

  function inspectRailing(player, railingIndex) {
    const current = stage(player);
    if (current >= STAGE_CHECK_WATCHTOWER || (current === STAGE_FIX_RAILINGS && railingFixed(player, railingIndex))) {
      sayFixedAll(player);
      return;
    }
    // Ours: before the quest, the box alone.
    brokenRailingBox(player, current === STAGE_FIX_RAILINGS ? () => attemptRailing(player, railingIndex) : null);
  }

  /**
   * Inspect on the fence's unbroken railing (local 1001618 tick 3397, before the quest's railings
   * were fixed): the player's line, chatneu1, with no stage condition in the capture.
   */
  function inspectIntactRailing(player) {
    const { DialogueChainBuilder, PlayerDialogue, EndDialogue } = api.core;
    const chain = new DialogueChainBuilder()
      .add(new PlayerDialogue(0, "This part of the railing seems fine.", CHATNEU1))
      .add(new EndDialogue(1));
    player.getDialogueManager().startDialogues(chain);
  }

  function sayFixedAll(player) {
    startTranscript(api, player, LAWGOF, PAGE, "fixing-the-railings-inspecting-a-fixed-railing-or-using-a-railing-on-a-fixed-railing");
  }

  /** "This railing is broken and needs to be replaced." is a message box; its continue makes the attempt. */
  function brokenRailingBox(player, then) {
    const { DialogueChainBuilder, StatementDialogue, ActionDialogue, EndDialogue } = api.core;
    const chain = new DialogueChainBuilder().add(new StatementDialogue(0, "This railing is broken and needs to be replaced."));
    // Live closes the box with "You attempt to replace..." (if_closesub messagebox), so the chat
    // closes first and the follow-up (the attempt, or the no-railing line) starts on its own.
    const closeThen = () => {
      player.getDialogueManager().reset();
      player.getPacketSender().sendInterfaceRemoval();
      then();
    };
    chain.add(then ? new ActionDialogue(1, { execute: closeThen }) : new EndDialogue(1));
    player.getDialogueManager().startDialogues(chain);
  }

  function attemptRailing(player, railingIndex) {
    if (stage(player) !== STAGE_FIX_RAILINGS || railingFixed(player, railingIndex)) return;
    if (!has(player, I.RAILING)) {
      startTranscript(api, player, LAWGOF, PAGE, "fixing-the-railings-trying-to-fix-a-railing",
        (steps) => steps.find((step) => step.text === "If the player does not have a railing:")?.steps ?? []);
      return;
    }
    // The Wiki transcript's spelling; live sends "replace" (all three captures).
    player.sendMessage("You attempt to repalce the broken railing...");
    if (!has(player, I.HAMMER)) {
      player.sendMessage("You will need a hammer to fix the railings.");
      return;
    }
    swingAtRailing(player, railingIndex, RAILING_SWING_TICKS);
  }

  /**
   * One hammering: the animation and sound `delay` ticks on, the outcome 2 after. Keyed to the
   * player's index, so walking away or fighting cancels it.
   */
  function swingAtRailing(player, railingIndex, delay) {
    TaskManager.submit(new CountdownTask(player.getIndex(), delay, () => {
      if (!canSwing(player, railingIndex)) return;
      player.performAnimation(new Animation(RAILING_REPAIR_ANIMATION));
      player.getPacketSender().sendSound(RAILING_REPAIR_SOUND, 1, 0);
      TaskManager.submit(new CountdownTask(player.getIndex(), RAILING_OUTCOME_TICKS, () => finishSwing(player, railingIndex)));
    }));
  }

  function canSwing(player, railingIndex) {
    return player.isRegistered() && stage(player) === STAGE_FIX_RAILINGS && !railingFixed(player, railingIndex)
      && has(player, I.RAILING) && has(player, I.HAMMER);
  }

  function finishSwing(player, railingIndex) {
    if (!canSwing(player, railingIndex)) return;
    if (rolls.next() >= railingSuccessChance(player)) {
      const failure = pick(RAILING_FAILURES);
      failRailing(player, failure);
      if (failure.drain) swingAtRailing(player, railingIndex, RAILING_RETRY_TICKS);
      return;
    }
    fixRailing(player, railingIndex);
  }

  function fixRailing(player, railingIndex) {
    player.getInventory().deleteNumber(I.RAILING, 1);
    player.setAttribute(RAILS_MASK_ATTRIBUTE, railingMask(player) | (1 << railingIndex));
    sendRailingVarbits(player, railingIndex);
    player.sendMessage("This railing is now fixed.");
    if (allRailingsFixed(player)) sayFixedAll(player);
  }

  function sendRailingVarbits(player, railingIndex) {
    player.getPacketSender().sendVarbit(RAILING_FIXED_VARBITS[railingIndex], 1);
    if (railingIndex === RAILS_REQUIRED - 1) player.getPacketSender().sendVarbit(TAKEN_CORPSE_VARBIT, 1);
  }

  /** One of four failures: its message and cry, then 1 or 2 damage or a point off Crafting or Strength. */
  function failRailing(player, failure) {
    player.sendMessage(failure.message);
    player.forceChat(failure.cry);
    player.getPacketSender().sendSound(pick(RAILING_FAIL_SOUNDS), 1, RAILING_FAIL_SOUND_DELAY);
    if (failure.damage) {
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(failure.damage, HitMask.RED)]);
      return;
    }
    const skill = failure.drain();
    const skills = player.getSkillManager();
    skills.setCurrentLevel(skill, Math.max(0, skills.getCurrentLevel(skill) - 1), true);
  }

  // ---------------------------------------------------------------------------------------------
  // The remains, the cave and Lollk
  // ---------------------------------------------------------------------------------------------

  /** The player's line plays first; the remains are taken as it closes, off the floor for them. */
  function pickUpRemains(player) {
    if (stage(player) !== STAGE_TOWER_CLIMBED) return;
    startTranscript(api, player, LAWGOF, PAGE, "finding-the-remains-picking-up-the-remains");
  }

  function takeRemains(player) {
    if (stage(player) !== STAGE_TOWER_CLIMBED || has(player, I.DWARF_REMAINS)) return;
    // The transcript: "Remains drop to ground with full inventory."
    if (player.getInventory().isFull()) ItemOnGroundManager.registers(player, new Item(I.DWARF_REMAINS, 1));
    else player.getInventory().adds(I.DWARF_REMAINS, 1);
    const tile = new Location(REMAINS_TILE.x, REMAINS_TILE.y, REMAINS_TILE.z);
    player.getPacketSender().sendObjectRemoval(new GameObject(REMAINS_OBJECT_ID, tile, 10, 0, null));
  }

  /** "loc-teleports:arrived": the tower's top ladder shows the remains (3), the cave entrance starts the search (5). */
  function arrivedByLoc({ player, objectId }) {
    if (objectId === TOWER_LADDER_OBJECT_ID && stage(player) === STAGE_CHECK_WATCHTOWER) quest.setStage(player, STAGE_TOWER_CLIMBED);
    else if (objectId === CAVE_ENTRANCE_OBJECT_ID && stage(player) === STAGE_FIND_LOLLK) quest.setStage(player, STAGE_IN_CAVE);
  }

  function searchCrate(player) {
    const current = stage(player);
    // Ours: 4 as well as 5, for a save migrated in the cave.
    if (current !== STAGE_FIND_LOLLK && current !== STAGE_IN_CAVE) {
      startTranscript(api, player, LAWGOF, PAGE, "the-dwarf-child-searching-the-crate-containing-lollk-before-returning-the-remains");
      return;
    }
    if (searching.has(player)) return;
    // Live holds the player for the search (varbit busy from the search to Lollk's first line;
    // a second click in 1001565 did nothing), so walking waits; a move by other means ends it.
    const queue = player.getMovementQueue().reset().setBlockMovement(true);
    searching.set(player, { from: player.getLocation().clone(), hold: queue.getBlockMovementGeneration() });
    // Captured (1001565, 1002239): the search, the child 3 ticks on, untied 2 after that.
    player.sendMessage("You search the crate...");
    player.performAnimation(new Animation(SEARCH_ANIMATION));
    TaskManager.submit(new CountdownTask(player, CHILD_SEEN_TICKS, () => {
      if (!stillSearching(player)) return endSearch(player);
      player.sendMessage("Inside you see a dwarf child, tied up!");
      player.performAnimation(new Animation(UNTIE_ANIMATION, UNTIE_ANIMATION_DELAY));
    }));
    TaskManager.submit(new CountdownTask(player, UNTIED_TICKS, () => untieLollk(player)));
  }

  /**
   * Still registered, alive, on the tile the search began from, and still holding its own movement
   * hold: a death (whose task takes the hold) or anything else that moves or re-holds the player ends it.
   */
  function stillSearching(player) {
    const search = searching.get(player);
    return !!search && player.isRegistered() && player.getHitpoints() > 0 && !player.isDyingReturn()
      && player.getLocation().equals(search.from)
      && player.getMovementQueue().getBlockMovementGeneration() === search.hold;
  }

  /**
   * Clears the search; the movement hold is released only while it is still the search's own, and
   * never for a dying player, whose death task takes and gives back the hold itself.
   */
  function endSearch(player) {
    const search = searching.get(player);
    if (!search) return;
    searching.delete(player);
    const queue = player.getMovementQueue();
    const dying = player.getHitpoints() <= 0 || player.isDyingReturn();
    if (!dying && queue.getBlockMovementGeneration() === search.hold) queue.setBlockMovement(false);
  }

  function untieLollk(player) {
    const searched = stillSearching(player);
    endSearch(player);
    const current = stage(player);
    if (!searched || (current !== STAGE_FIND_LOLLK && current !== STAGE_IN_CAVE)) return;
    player.sendMessage("You untie the child.");
    quest.setStage(player, STAGE_LOLLK_RESCUED);
    const lollk = spawnLollk(player);
    startTranscript(api, player, LOLLK, PAGE, "the-dwarf-child-searching-the-crate-containing-lollk",
      (steps) => steps.slice(steps.findIndex((step) => step.id === STEP.UNTIED) + 1), lollk);
  }

  /** Lollk appears north of the crate shouting "Hooray!" (captured). */
  function spawnLollk(player) {
    removeLollk(player);
    const lollk = NPC.create(LOLLK, new Location(...LOLLK_TILE));
    World.getNpcs().add(lollk);
    lollk.setFace(Direction.SOUTH);
    lollk.forceChat("Hooray!");
    rescuedLollk.set(player, lollk);
    TaskManager.submit(new CountdownTask(lollk, LOLLK_TIMEOUT_TICKS, () => removeLollk(player, lollk)));
    return lollk;
  }

  /** "The dwarf child runs off into the caverns.": four steps south-west, gone the tick after. */
  function sendLollkHome(player) {
    const lollk = rescuedLollk.get(player);
    if (!lollk) return;
    for (const [x, y] of LOLLK_EXIT) lollk.getMovementQueue().addSteps(new Location(x, y, LOLLK_TILE[2]));
    TaskManager.submit(new CountdownTask(lollk, LOLLK_GONE_TICKS, () => removeLollk(player, lollk)));
  }

  function removeLollk(player, which = rescuedLollk.get(player)) {
    if (!which || rescuedLollk.get(player) !== which) return;
    rescuedLollk.delete(player);
    World.getNpcs().remove(which);
  }

  /** Captured: the reach-for-ladder animation 2 ticks after arrival, outside a tick later. */
  function climbMudPile(player) {
    player.getMovementQueue().reset().setBlockMovement(true);
    TaskManager.submit(new CountdownTask(player, MUDPILE_ANIMATION_TICKS, () => player.performAnimation(new Animation(LADDER_ANIMATION))));
    TaskManager.submit(new CountdownTask(player, MUDPILE_MOVE_TICKS, () => {
      player.getMovementQueue().setBlockMovement(false);
      player.moveTo(new Location(OUTSIDE_CAVE_TILE.x, OUTSIDE_CAVE_TILE.y, OUTSIDE_CAVE_TILE.z));
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // The cannon
  // ---------------------------------------------------------------------------------------------

  function inspectCannon(player) {
    if (stage(player) === STAGE_REPAIR_CANNON && has(player, I.TOOLKIT)) {
      startTranscript(api, player, LAWGOF, PAGE, "fixing-the-cannon-inspecting-the-broken-multicannon-after-getting-the-toolkit");
    } else {
      startTranscript(api, player, LAWGOF, PAGE, "captain-lawgof-inspecting-the-broken-multicannon");
    }
  }

  function useToolkitOnCannon(event) {
    const { player, objectId, itemId } = event;
    if (objectId !== CANNON_OBJECT_ID || itemId !== I.TOOLKIT) return;
    if (stage(player) !== STAGE_REPAIR_CANNON || !has(player, I.TOOLKIT)) return;
    const sender = player.getPacketSender();
    for (const varbit of [...CANNON_TOOL_VARBITS.values(), CANNON_SAFETY_VARBIT, CANNON_SPRING_VARBIT]) sender.sendVarbit(varbit, 0);
    sender.sendInterface(CANNON_INTERFACE_GROUP);
    selectCannonTool(player, null);
    sender.sendInterfaceAnimation(CANNON_MECHANISM_COMPONENT, SEQ.IDLE);
    event.handled = true;
  }

  function selectCannonTool(player, selected) {
    const sender = player.getPacketSender();
    for (const [child, varbit] of CANNON_TOOL_VARBITS) {
      const active = child === selected;
      sender.sendVarbit(varbit, active ? 1 : 0);
      sender.sendInterfaceRawModel((CANNON_INTERFACE_GROUP << 16) | child, CANNON_TOOL_MODELS.get(child)[active ? 1 : 0]);
    }
  }

  /** The selected tool stays selected after it is used (captured). */
  function handleCannonRepairClick(event) {
    const { player, buttonId } = event;
    if ((event.groupId ?? (buttonId >>> 16)) !== CANNON_INTERFACE_GROUP || stage(player) !== STAGE_REPAIR_CANNON
      || player.getInterfaceId() !== CANNON_INTERFACE_GROUP) return;
    const childId = event.childId ?? (buttonId & 0xffff);
    const sender = player.getPacketSender();
    if (CANNON_TOOL_VARBITS.has(childId)) {
      selectCannonTool(player, childId);
      event.handled = true;
      return;
    }
    const part = CANNON_INTERFACE_PARTS.get(childId);
    if (!part || sender.getVarbit(CANNON_TOOL_VARBITS.get(PART_TOOLS[part])) !== 1) return;
    const safety = sender.getVarbit(CANNON_SAFETY_VARBIT) === 1;
    const spring = sender.getVarbit(CANNON_SPRING_VARBIT) === 1;
    if (part === "safety") {
      sender.sendVarbit(CANNON_SAFETY_VARBIT, 1);
      sender.sendInterfaceAnimation(CANNON_MECHANISM_COMPONENT, spring ? SEQ.SAFETY_WITH_SPRING : SEQ.SAFETY);
    } else if (part === "spring") {
      sender.sendVarbit(CANNON_SPRING_VARBIT, 1);
      sender.sendInterfaceAnimation(CANNON_MECHANISM_COMPONENT, safety ? SEQ.ATTACH_SPRING_WITH_SAFETY : SEQ.ATTACH_SPRING);
    } else if (safety && spring) {
      player.sendMessage("Well done! You've fixed the cannon! Better go and tell Captain Lawgof.");
      quest.setStage(player, STAGE_CANNON_REPAIRED);
      sender.sendInterfaceAnimation(CANNON_MECHANISM_COMPONENT, SEQ.WORK_WITH_SPRING);
      TaskManager.submit(new CountdownTask(player, CANNON_FIXED_CLOSE_TICKS, () => {
        if (player.getInterfaceId() === CANNON_INTERFACE_GROUP) sender.sendInterfaceRemoval();
      }));
    } else {
      // Ours: the gear before the safety and spring does nothing.
      return;
    }
    event.handled = true;
  }

  // ---------------------------------------------------------------------------------------------
  // Locs and items
  // ---------------------------------------------------------------------------------------------

  function handleObjectInteraction(event) {
    const { player, objectId, option } = event;
    const action = String(option ?? "").toLowerCase();
    const railingIndex = RAILING_OBJECT_IDS.indexOf(objectId);
    if (railingIndex >= 0 && action === "inspect") {
      inspectRailing(player, railingIndex);
      event.handled = true;
    } else if (objectId === INTACT_RAILING_OBJECT_ID && action === "inspect") {
      inspectIntactRailing(player);
      event.handled = true;
    } else if (objectId === REMAINS_OBJECT_ID && at(event.location, REMAINS_TILE) && action === "take") {
      pickUpRemains(player);
      event.handled = true;
    } else if (objectId === CRATE_OBJECT_ID && at(event.location, CRATE_TILE) && action === "search") {
      searchCrate(player);
      event.handled = true;
    } else if (objectId === CANNON_OBJECT_ID && action === "inspect") {
      inspectCannon(player);
      event.handled = true;
    } else if (objectId === CANNON_OBJECT_ID && action === "fire") {
      startTranscript(api, player, LAWGOF, PAGE, "fixing-the-cannon-fire-the-fixed-dwarf-multicannon");
      event.handled = true;
    } else if (objectId === CANNON_OBJECT_ID && action === "pick-up") {
      startTranscript(api, player, LAWGOF, PAGE, "fixing-the-cannon-pick-up-the-fixed-dwarf-multicannon");
      event.handled = true;
    } else if (objectId === MUDPILE_OBJECT_ID && at(event.location, MUDPILE_TILE) && action === "climb-over") {
      climbMudPile(player);
      event.handled = true;
    }
  }

  /**
   * Items on a railing. The transcript: a railing on a fixed one is "I've fixed all these
   * railings now."; any other item "That's better, ..." (the Wiki's trivia: a hammer on a broken
   * one too, without fixing it). Ours: a railing on a broken one is an Inspect.
   */
  function useItemOnRailing(event) {
    const { player, objectId, itemId } = event;
    const railingIndex = RAILING_OBJECT_IDS.indexOf(objectId);
    if (railingIndex < 0) return;
    event.handled = true;
    if (itemId !== I.RAILING) {
      startTranscript(api, player, LAWGOF, PAGE, "fixing-the-railings-using-other-items-on-fixed-railing");
    } else {
      inspectRailing(player, railingIndex);
    }
  }

  function handleItemOnObject(event) {
    useToolkitOnCannon(event);
    if (!event.handled) useItemOnRailing(event);
  }

  /** Moves a save written before the stage followed varp 0 onto it, once. */
  function migrateStage(player) {
    if (Number(player.getAttribute(STAGE_SCHEMA_ATTRIBUTE)) >= STAGE_SCHEMA) return;
    player.setAttribute(STAGE_SCHEMA_ATTRIBUTE, STAGE_SCHEMA);
    const migrate = LEGACY_STAGES[stage(player)];
    if (migrate) quest.setStage(player, migrate(player));
  }

  function handleLogin({ player }) {
    migrateStage(player);
    if (!quest.isComplete(player)) {
      for (let index = 0; index < RAILS_REQUIRED; index++) {
        if (railingFixed(player, index)) sendRailingVarbits(player, index);
      }
    }
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    endSearch(player);
    removeLollk(player);
  }

  quest = registerQuest(api, {
    key: "dwarf_cannon",
    name: "Dwarf Cannon",
    varpId: VARP_DWARF_CANNON,
    startedValue: STAGE_FIX_RAILINGS,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 750, label: "Crafting" }],
    // Captured scroll (1001565 tick 5895): the toolkit, and these four lines.
    scrollItemId: I.TOOLKIT,
    rewardText: ["1 Quest Point", "750 Crafting XP", "Ability to use a", "Dwarf Multicannon"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(RAILS_MASK_ATTRIBUTE, 0);
  api.persistAttribute(STAGE_SCHEMA_ATTRIBUTE, 0);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcInteraction("Captain Lawgof", { "Talk-to": remindAboutLollk });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("loc-teleports:arrived", arrivedByLoc);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onInterfaceActionClick(handleCannonRepairClick);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};

module.exports._test = { rolls };
