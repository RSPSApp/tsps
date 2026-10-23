/**
 * Big Chompy Bird Hunting (members).
 *
 * The words come from the "Big Chompy Bird Hunting" transcript page; Rantz, Fycie
 * and Bugs are indexed, so this plugin supplies the by-stage variant selector, the
 * prose-condition answers, the start hook (granting the quest start), the ogre-arrow
 * hand-in (MSG "Rantz takes six ogre arrows off you.") and the seasoned-chompy
 * completion action. The xrsps stage machine (varp 293) and its kill counter
 * (varp 294) are ported here.
 *
 * The child shops, arrow fletching, cave/chest, bellows/toad bait, chompy
 * kill/pluck, ingredient order and spit-roast cooking are wired below as quest-local
 * interaction hooks. Arrow fletching itself is owned by the Fletching plugin.
 *
 * Revision 241 spawns Rantz as the nameless parent 1470; interaction events carry the
 * varbit-resolved content id 14793 (NpcIdentifiers.RANTZ), so both are accepted
 * alongside the historical 4855-4857 ids.
 */
module.exports = function registerBigChompyBirdHuntingQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Big Chompy Bird Hunting";
  const RANTZ_PAGE = "Rantz";
  const FYCIE_PAGE = "Fycie";
  const BUGS_PAGE = "Bugs";

  const VARP_CHOMPY_BIRD = 293;
  const VARP_CHOMPY_KILLS = 294;

  const STAGE_STARTED = 5;
  const STAGE_GIVEN_ARROWS = 10;
  const STAGE_KIDS_EXPLAINED_TOADS = 15;
  const STAGE_BELLOWS_TAKEN = 20;
  const STAGE_SHOWN_TOAD = 25;
  const STAGE_WAITING_CHOMPY = 30;
  const STAGE_CHOMPY_MISSED = 35;
  const STAGE_RANTZ_MISSED = 40;
  const STAGE_GIVEN_BOW = 45;
  const STAGE_KILLED_CHOMPY = 50;
  const STAGE_TOLD_TO_COOK = 55;
  const STAGE_CHOMPY_COOKED = 60;
  const STAGE_COMPLETE = 65;

  const START_HOOK = "quest:big-chompy-bird-hunting:start";
  /** "Rantz takes six ogre arrows off you." (Talk-to and item-use variants). */
  const TAKE_ARROWS_MESSAGE_IDS = new Set(["pzg8li", "uvhloX"]);
  /** "Rantz hands over an ogre bow. It's huge! ..." */
  const GIVE_BOW_MESSAGE_ID = "u_dBhh";
  /** Lost-bow reclaim: "You hand over the coins... and Rantz hands over the bow." */
  const RECLAIM_BOW_MESSAGE_ID = "JRiYWE";
  /** Bugs sells a knife and chisel for 10 coins. */
  const BUGS_TOOLS_MESSAGE_ID = "x2E72Z";
  /** Fycie sells 25 feathers for 50 coins. */
  const FYCIE_FEATHERS_MESSAGE_ID = "EA27SG";
  /** "You show the bloated toad to Rantz. He nods with approval." */
  const SHOW_TOAD_MESSAGE_ID = "rAqfRS";
  /** "Congratulations! Quest complete!" in handing-the-chompy-to-rantz. */
  const COMPLETE_ACTION_ID = "cmDp4e";

  /** Rantz has more than one cache id but all reach the same transcript pages. */
  const RANTZ_NPC_IDS = new Set([1470, NpcIdentifiers.RANTZ, NpcIdentifiers.RANTZ_2, NpcIdentifiers.RANTZ_3,
    NpcIdentifiers.RANTZ_4, NpcIdentifiers.RANTZ_5]);
  const FYCIE_NPC_ID = NpcIdentifiers.FYCIE;
  const BUGS_NPC_IDS = new Set([NpcIdentifiers.BUGS, NpcIdentifiers.BUGS_2]);

  const OGRE_ARROW = ItemIdentifiers.OGRE_ARROW;
  const OGRE_BOW = ItemIdentifiers.OGRE_BOW;
  const BLOATED_TOAD = ItemIdentifiers.BLOATED_TOAD;
  const RAW_CHOMPY = ItemIdentifiers.RAW_CHOMPY;
  const SEASONED_CHOMPY = ItemIdentifiers.SEASONED_CHOMPY;
  const COOKED_CHOMPY_IDS = [ItemIdentifiers.COOKED_CHOMPY, ItemIdentifiers.COOKED_CHOMPY_2];
  const OGRE_BELLOWS = ItemIdentifiers.OGRE_BELLOWS;
  const OGRE_BELLOWS_3 = ItemIdentifiers.OGRE_BELLOWS_3_;
  const OGRE_BELLOWS_2 = ItemIdentifiers.OGRE_BELLOWS_2_;
  const OGRE_BELLOWS_1 = ItemIdentifiers.OGRE_BELLOWS_1_;
  const BELLOWS_STATES = [OGRE_BELLOWS, OGRE_BELLOWS_1, OGRE_BELLOWS_2, OGRE_BELLOWS_3];

  const SWAMP_BUBBLE = ObjectIdentifiers.SWAMP_BUBBLES;
  const SWAMP_BUBBLE_2 = ObjectIdentifiers.SWAMP_BUBBLES_2;
  const CAVE_ENTRANCE = ObjectIdentifiers.CAVE_ENTRANCE_18;
  // Loc 3380/3381 are the paired "Cave exit" tiles at (2646/2647,9377), both Walk through.
  const CAVE_EXITS = new Set([ObjectIdentifiers.CAVE_EXIT_8, ObjectIdentifiers.CAVE_EXIT_9]);
  const LOCKED_CHEST = ObjectIdentifiers.LOCKED_OGRE_CHEST;
  const OPEN_CHEST = ObjectIdentifiers.UNLOCKED_OGRE_CHEST;
  // MULTI_CHOMPYBIRD_SPITROAST_ENTITY has no generated ObjectIdentifiers entry.
  const CHOMPY_SPIT_ROAST = 6895;

  const SWAMP_TOAD = NpcIdentifiers.SWAMP_TOAD;
  const CHOMPY_BIRD = NpcIdentifiers.CHOMPY_BIRD;
  const DEAD_CHOMPY = NpcIdentifiers.CHOMPY_BIRD_2;

  const HUNTED_CHOMPY = new WeakMap();
  const DEAD_CARCASS = new WeakMap();
  const FIRST_HUNTS = new WeakMap();
  const FIRST_CHOMPY = new WeakSet();
  const HUNT_WAIT_TICKS = 5;
  const HUNT_SHOT_TICKS = 2;
  const HUNT_SETTLE_TICKS = 3;
  // Ogre bow show/hat trade uses the bow's kill marks; thresholds and item ids
  // come from cache examines 2978-2995 (Ogre Bowman 30 ... Expert Dragon Archer 4000).
  const CHOMPY_HATS = [
    { label: "ogre bowman", kills: 30, item: 2978 },
    { label: "bowman", kills: 40, item: 2979 },
    { label: "ogre yeoman", kills: 50, item: 2980 },
    { label: "yeoman", kills: 70, item: 2981 },
    { label: "ogre marksman", kills: 95, item: 2982 },
    { label: "marksman", kills: 125, item: 2983 },
    { label: "ogre woodsman", kills: 170, item: 2984 },
    { label: "woodsman", kills: 225, item: 2985 },
    { label: "ogre forester", kills: 300, item: 2986 },
    { label: "forester", kills: 400, item: 2987 },
    { label: "ogre bowmaster", kills: 550, item: 2988 },
    { label: "bowmaster", kills: 700, item: 2989 },
    { label: "ogre expert", kills: 1000, item: 2990 },
    { label: "expert", kills: 1300, item: 2991 },
    { label: "ogre dragon archer", kills: 1700, item: 2992 },
    { label: "dragon archer", kills: 2250, item: 2993 },
    { label: "expert ogre dragon archer", kills: 3000, item: 2994 },
    { label: "expert dragon archer", kills: 4000, item: 2995 },
  ].sort((a, b) => b.label.length - a.label.length);
  // Cache loc 3379 is the 3x2 "Cave entrance" at (2629,2998) with Enter. Its +6400
  // interior footprint (2629-2631,9398-9399) is blocked terrain (clip 0x220100), so the
  // mouth's westmost walkable tile is (2635,9397); the chest's south approach
  // (2637,9397) is reachable from there. q006 native landed at the blocked 2630,9398.
  // The exit lands on the walkable south step of that same surface entrance (2630,2997).
  // The old -6400 mirror (2647,2977) is a separate collision-enclosed pocket: the real
  // routefinder cannot reach Rantz, the toad clearing or the swamp from it.
  const CAVE_INSIDE = { x: 2635, y: 9397, z: 0 };
  const CAVE_SURFACE = { x: 2630, y: 2997, z: 0 };
  const TOAD_CLEARING = { x: 2635, y: 2966, z: 0 };
  const SPIT_ROAST_TILE = { x: 2630, y: 2990, z: 0 };
  const BOW_RECLAIM_COST = 500;
  const RECLAIM_COIN_STEPS = new Set(["BmgmUE", "Zlt_Rt"]);
  const BUGS_COIN_STEPS = new Set(["71iNkU", "4Q95fX"]);
  const FYCIE_COIN_STEPS = new Set(["CMSJar", "GMF66H"]);

  const RANTZ_INGREDIENT_ATTRIBUTE = "big-chompy-bird-hunting:rantz-ingredient";
  const BUGS_INGREDIENT_ATTRIBUTE = "big-chompy-bird-hunting:bugs-ingredient";
  const FYCIE_INGREDIENT_ATTRIBUTE = "big-chompy-bird-hunting:fycie-ingredient";
  const BUGS_TOOLS_ATTRIBUTE = "big-chompy-bird-hunting:bugs-tools-bought";
  const FYCIE_FEATHERS_ATTRIBUTE = "big-chompy-bird-hunting:fycie-feathers-bought";
  const CHOMPY_KILLS_ATTRIBUTE = "big-chompy-bird-hunting:chompy-kills";
  const HATS_CLAIMED_ATTRIBUTE = "big-chompy-bird-hunting:hats-claimed";

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;
  const freeSlots = (player) => player.getInventory().getFreeSlots?.() ?? 0;
  const hasEquipped = (player, itemId) =>
    (player.getEquipment?.()?.getItems?.() ?? []).some((item) => item?.getId?.() === itemId);
  const hasBow = (player) => has(player, OGRE_BOW) || hasEquipped(player, OGRE_BOW);
  const ingredient = (player, key) => Number(player.getAttribute(key)) || 0;
  const chompyKills = (player) => Number(player.getAttribute(CHOMPY_KILLS_ATTRIBUTE)) || 0;
  const hatsClaimed = (player) => Number(player.getAttribute(HATS_CLAIMED_ATTRIBUTE)) || 0;
  const hatClaimed = (player, index) => (hatsClaimed(player) & (1 << index)) !== 0;
  const claimableHat = (player) => {
    const kills = chompyKills(player);
    return CHOMPY_HATS.findIndex((hat, index) => kills >= hat.kills && !hatClaimed(player, index));
  };
  const hatForText = (text) => {
    const value = String(text ?? "").toLowerCase();
    return CHOMPY_HATS.find((hat) => value.includes(hat.label));
  };
  const setIngredient = (player, key, itemId) => {
    if (itemId) player.setAttribute(key, itemId);
  };
  const actionFor = (event) => String(event.option ?? event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I hunted and cooked a seasoned chompy for Rantz.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_CHOMPY_COOKED) return ["Give the <col=800000>seasoned chompy</col> to Rantz."];
    if (stage >= STAGE_TOLD_TO_COOK) return ["Ask <col=800000>Bugs</col> and <col=800000>Fycie</col> which flavours they want,", "then cook the raw chompy on Rantz's spit roast."];
    if (stage >= STAGE_KILLED_CHOMPY) return ["Pluck the dead chompy and show its raw meat to <col=800000>Rantz</col>."];
    if (stage >= STAGE_GIVEN_BOW) return ["Shoot the chompy with the <col=800000>ogre bow</col> and ogre arrows."];
    if (stage >= STAGE_RANTZ_MISSED) return ["Talk to <col=800000>Rantz</col> and ask him to let you use the ogre bow."];
    if (stage >= STAGE_CHOMPY_MISSED) return ["Wait for Rantz to finish shooting at the chompy."];
    if (stage >= STAGE_WAITING_CHOMPY) return ["Wait for the chompy to come to the bait."];
    if (stage >= STAGE_SHOWN_TOAD) return ["Release a <col=800000>bloated toad</col> in the clearing south of Rantz."];
    if (stage >= STAGE_BELLOWS_TAKEN) return ["Fill the ogre bellows at swamp bubbles, inflate a swamp toad,", "then show the bloated toad to <col=800000>Rantz</col>."];
    if (stage >= STAGE_KIDS_EXPLAINED_TOADS) return ["Open the rock-covered chest in the cave for ogre bellows."];
    if (stage >= STAGE_GIVEN_ARROWS) return ["Ask Rantz how to attract a chompy, then speak to his children."];
    if (stage >= STAGE_STARTED) return ["Make six ogre arrows from achey logs, wolf bones and feathers,", "then give the arrows to <col=800000>Rantz</col>."];
    return ["Speak to <col=800000>Rantz</col> east of Gu'Tanoth in the Feldhil Hills."];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.FLETCHING, 262);
    skills.addExperiences(Skill.COOKING, 1470);
    skills.addExperiences(Skill.RANGED, 735);
  }

  /** Which transcript variant the clicked NPC plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (RANTZ_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page(RANTZ_PAGE, "after-big-chompy-bird-hunting");
      if (stage >= STAGE_CHOMPY_COOKED) return page(PAGE, "handing-the-chompy-to-rantz-or-trying-to-cook-another-raw-chompy");
      if (stage >= STAGE_TOLD_TO_COOK) return page(PAGE, "talking-to-rantz-with-a-raw-chompy-talking-to-rantz-again-before-cooking-the-chompy");
      if (stage >= STAGE_GIVEN_BOW) {
        if (has(player, RAW_CHOMPY)) return page(PAGE, "talking-to-rantz-with-a-raw-chompy");
        if (stage < STAGE_KILLED_CHOMPY && !hasBow(player)) {
          return page(PAGE, "talking-to-rantz-after-he-failed-reclaiming-a-lost-bow");
        }
        return page(PAGE, "talking-to-rantz-after-he-failed-talking-to-rantz-before-hunting-the-chompy");
      }
      if (stage >= STAGE_RANTZ_MISSED) return page(PAGE, "talking-to-rantz-after-he-failed");
      if (stage >= STAGE_SHOWN_TOAD) return page(PAGE, "successfully-attracting-a-chompy-after-the-chompy-eats-the-toad");
      if (stage >= STAGE_KIDS_EXPLAINED_TOADS) {
        return page(PAGE, has(player, BLOATED_TOAD)
          ? "returning-to-rantz-with-the-bloated-toad"
          : "using-ogre-arrows-made-by-the-player-on-rantz-returning-to-rantz-without-a-bloated-toad");
      }
      if (stage >= STAGE_GIVEN_ARROWS) return page(PAGE, "using-ogre-arrows-made-by-the-player-on-rantz-returning-to-rantz-without-a-bloated-toad");
      if (stage >= STAGE_STARTED) {
        return page(PAGE, has(player, OGRE_ARROW, 6)
          ? "returning-to-rantz-with-six-or-more-ogre-arrows"
          : "starting-off-returning-to-rantz-without-ogre-arrows");
      }
      return page(PAGE, "starting-off");
    }

    if (npcId === FYCIE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return page(FYCIE_PAGE, "after-big-chompy-bird-hunting");
      if (stage >= STAGE_TOLD_TO_COOK) return page(PAGE, "talking-to-rantz-with-a-raw-chompy-getting-the-ingredient-order-from-fycie");
      if (stage >= STAGE_KIDS_EXPLAINED_TOADS) return page(PAGE, "returning-to-rantz-with-the-bloated-toad-talking-to-fycie");
      if (stage >= STAGE_GIVEN_ARROWS) return page(PAGE, "using-ogre-arrows-made-by-the-player-on-rantz-talking-to-fycie");
      if (stage >= STAGE_STARTED) {
        return page(PAGE, player.getAttribute(FYCIE_FEATHERS_ATTRIBUTE)
          ? "starting-off-talking-to-fycie-talking-to-fycie-after-buying-her-feathers"
          : "starting-off-talking-to-fycie");
      }
      return null;
    }

    if (BUGS_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page(BUGS_PAGE, "after-big-chompy-bird-hunting");
      if (stage >= STAGE_TOLD_TO_COOK) return page(PAGE, "talking-to-rantz-with-a-raw-chompy-getting-the-ingredient-order-from-bugs");
      if (stage >= STAGE_KIDS_EXPLAINED_TOADS) return page(PAGE, "returning-to-rantz-with-the-bloated-toad-talking-to-bugs");
      if (stage >= STAGE_GIVEN_ARROWS) return page(PAGE, "using-ogre-arrows-made-by-the-player-on-rantz-talking-to-bugs");
      if (stage >= STAGE_STARTED) {
        return page(PAGE, player.getAttribute(BUGS_TOOLS_ATTRIBUTE)
          ? "starting-off-talking-to-bugs-without-a-chisel-and-knife-talking-to-bugs-after-buying-his-chisel-and-knife"
          : "starting-off-talking-to-bugs-without-a-chisel-and-knife");
      }
      return null;
    }

    return null;
  }

  /** Answer the transcript's prose conditions, scoped to this quest's NPCs and steps. */
  function answerCondition({ player, npcId, text, stepId }) {
    const isOurs = RANTZ_NPC_IDS.has(npcId) || npcId === FYCIE_NPC_ID || BUGS_NPC_IDS.has(npcId);
    if (!isOurs) return null;
    const value = String(text).toLowerCase();
    if (value.includes("more than six ogre arrows not made by themselves")) return false;
    if (value.includes("has less than six ogre arrows")) return !has(player, OGRE_ARROW, 6);
    if (value.includes("has six or more ogre arrows")) return has(player, OGRE_ARROW, 6);
    if (value.includes("using a raw chompy on rantz")) return false;
    if (value.includes("using ogre arrows not made by the player")) return false;
    if (value.includes("missing at least one requirement")) {
      if (!RANTZ_NPC_IDS.has(npcId) || stepId !== "THE8iv") return null;
      const skills = player.getSkillManager();
      return skills.getMaxLevel(Skill.RANGED) < 30
        || skills.getMaxLevel(Skill.COOKING) < 30
        || skills.getMaxLevel(Skill.FLETCHING) < 5;
    }
    if (value.includes("does not have the bow")) return !hasBow(player);
    if (value.includes("has an ogre bow")) return hasBow(player);
    if (value.includes("already claimed all newly claimable hats")) {
      return chompyKills(player) >= 30 && claimableHat(player) < 0;
    }
    if (value.includes("has 0 chompy kills")) return chompyKills(player) === 0;
    if (value.includes("at least one but less than 30 chompy kills")) {
      const kills = chompyKills(player);
      return kills >= 1 && kills < 30;
    }
    if (value.includes("obtained enough chompy kills for a new hat")) return claimableHat(player) >= 0;
    if (value.includes("full inventory at any point now or below")) return freeSlots(player) <= 0;
    if (value.includes("has enough inventory space")) return freeSlots(player) > 0;
    if (value.includes("not claimed the") && value.includes("hat before")) {
      const hat = hatForText(value);
      if (hat) return chompyKills(player) >= hat.kills && !hatClaimed(player, CHOMPY_HATS.indexOf(hat));
    }
    if (value.includes("doesn't have enough coins") || value.includes("has enough coins")) {
      if (!RANTZ_NPC_IDS.has(npcId) || !RECLAIM_COIN_STEPS.has(stepId)) return null;
      return value.includes("doesn't")
        ? !has(player, ItemIdentifiers.COINS, BOW_RECLAIM_COST)
        : has(player, ItemIdentifiers.COINS, BOW_RECLAIM_COST);
    }
    if (value.includes("does not have 10 coins") || value.includes("has 10 coins and inventory space")) {
      if (!BUGS_NPC_IDS.has(npcId) || !BUGS_COIN_STEPS.has(stepId)) return null;
      return value.includes("does not")
        ? !has(player, ItemIdentifiers.COINS, 10)
        : has(player, ItemIdentifiers.COINS, 10) && freeSlots(player) >= 2;
    }
    if (value.includes("does not have 50 coins") || value.includes("has 50 coins and inventory space")) {
      if (npcId !== FYCIE_NPC_ID || !FYCIE_COIN_STEPS.has(stepId)) return null;
      return value.includes("does not")
        ? !has(player, ItemIdentifiers.COINS, 50)
        : has(player, ItemIdentifiers.COINS, 50) && freeSlots(player) >= 1;
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!RANTZ_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Bellows on swamp bubbles, and raw chompy on Rantz's spit-roast. */
  function handleItemOnObject(event) {
    const { player, objectId } = event;
    const itemId = event.itemId ?? event.item?.getId?.();
    if (objectId === SWAMP_BUBBLE || objectId === SWAMP_BUBBLE_2) {
      if (quest.getStage(player) < STAGE_KIDS_EXPLAINED_TOADS) return;
      if (!BELLOWS_STATES.includes(itemId) || !has(player, itemId)) return;
      event.handled = true;
      if (itemId === OGRE_BELLOWS_3) {
        player.sendMessage("Your ogre bellows are already full of swamp gas.");
        return;
      }
      player.getInventory().deleteNumber(itemId, 1);
      player.getInventory().adds(OGRE_BELLOWS_3, 1);
      player.sendMessage("You fill the ogre bellows with thick swamp gas.");
      return;
    }
    if (objectId === CHOMPY_SPIT_ROAST && itemId === RAW_CHOMPY) {
      const location = event.location ?? event.object?.getLocation?.();
      if (location && (location.x !== SPIT_ROAST_TILE.x || location.y !== SPIT_ROAST_TILE.y)) return;
      cookChompy(event);
    }
  }

  /** Cook only once Rantz and both children have named their ingredient. */
  function cookChompy(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_TOLD_TO_COOK || quest.isComplete(player)) return;
    if (stage >= STAGE_CHOMPY_COOKED && has(player, SEASONED_CHOMPY)) return;
    if (!has(player, RAW_CHOMPY)) return;
    event.handled = true;
    const wanted = [
      ingredient(player, RANTZ_INGREDIENT_ATTRIBUTE),
      ingredient(player, BUGS_INGREDIENT_ATTRIBUTE),
      ingredient(player, FYCIE_INGREDIENT_ATTRIBUTE),
    ];
    if (wanted.some((id) => !id)) {
      player.sendMessage("Ask Rantz, Bugs and Fycie what they want with their chompy first.");
      return;
    }
    if (!wanted.every((id) => has(player, id))) {
      player.sendMessage("You don't have all the ingredients Rantz's family asked for.");
      return;
    }
    player.getInventory().deleteNumber(RAW_CHOMPY, 1);
    for (const id of wanted) player.getInventory().deleteNumber(id, 1);
    player.getInventory().adds(SEASONED_CHOMPY, 1);
    if (stage < STAGE_CHOMPY_COOKED) quest.setStage(player, STAGE_CHOMPY_COOKED);
    player.sendMessage("You add the other ingredients and cook the food.");
  }

  /** Cave entrance/exit and the ogre chest. */
  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === CAVE_ENTRANCE) {
      if (quest.getStage(player) < STAGE_KIDS_EXPLAINED_TOADS) return;
      event.handled = true;
      player.moveTo(new api.core.Location(CAVE_INSIDE.x, CAVE_INSIDE.y, CAVE_INSIDE.z));
      return;
    }
    if (CAVE_EXITS.has(objectId)) {
      if (quest.getStage(player) < STAGE_KIDS_EXPLAINED_TOADS) return;
      event.handled = true;
      player.moveTo(new api.core.Location(CAVE_SURFACE.x, CAVE_SURFACE.y, CAVE_SURFACE.z));
      return;
    }
    if (objectId !== LOCKED_CHEST && objectId !== OPEN_CHEST) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_KIDS_EXPLAINED_TOADS) return;
    event.handled = true;
    if (BELLOWS_STATES.some((id) => has(player, id))) {
      player.sendMessage("You already have some ogre bellows.");
      return;
    }
    player.getInventory().adds(OGRE_BELLOWS, 1);
    player.sendMessage("You take a pair of bellows.");
    if (stage < STAGE_BELLOWS_TAKEN) quest.setStage(player, STAGE_BELLOWS_TAKEN);
  }

  /** Inflate a swamp toad and pluck the dead chompy. */
  function handleNpcInteraction(event) {
    const npcId = event.npcId ?? event.npc?.getId?.();
    const action = actionFor(event);
    if (npcId === SWAMP_TOAD && action.includes("inflate")) {
      inflateToad(event);
      return;
    }
    if (npcId === DEAD_CHOMPY && action.includes("pluck")) pluckChompy(event);
  }

  function inflateToad(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_BELLOWS_TAKEN) return;
    const bellowsState = [OGRE_BELLOWS_3, OGRE_BELLOWS_2, OGRE_BELLOWS_1].find((id) => has(player, id));
    if (bellowsState === undefined) {
      player.sendMessage("You need ogre bellows filled with swamp gas.");
      event.handled = true;
      return;
    }
    if (freeSlots(player) <= 0) {
      player.sendMessage("You need an empty inventory slot for the bloated toad.");
      event.handled = true;
      return;
    }
    const nextState = bellowsState === OGRE_BELLOWS_3 ? OGRE_BELLOWS_2
      : bellowsState === OGRE_BELLOWS_2 ? OGRE_BELLOWS_1 : OGRE_BELLOWS;
    player.getInventory().deleteNumber(bellowsState, 1);
    player.getInventory().adds(nextState, 1);
    player.getInventory().adds(BLOATED_TOAD, 1);
    api.removeNpc(event.npc);
    player.sendMessage("You manage to catch the toad and inflate it with the swamp gas.");
    event.handled = true;
  }

  function pluckChompy(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_KILLED_CHOMPY) return;
    event.handled = true;
    if (freeSlots(player) <= 0) {
      player.sendMessage("You need an empty inventory slot to pluck the chompy.");
      return;
    }
    player.getInventory().adds(RAW_CHOMPY, 1);
    DEAD_CARCASS.delete(player);
    api.removeNpc(event.npc);
    player.sendMessage("You pluck the chompy bird.");
  }

  function spawnChompy(player) {
    const previous = HUNTED_CHOMPY.get(player);
    if (previous) api.removeNpc(previous);
    const npc = api.spawnNpc({
      id: CHOMPY_BIRD, x: TOAD_CLEARING.x, y: TOAD_CLEARING.y, z: TOAD_CLEARING.z,
      wanderRadius: 0, owner: player, ownerOnly: true,
    });
    HUNTED_CHOMPY.set(player, npc);
    return npc;
  }

  function spawnCarcass(player, location) {
    const npc = api.spawnNpc({
      id: DEAD_CHOMPY, x: location.x, y: location.y, z: location.z ?? 0,
      wanderRadius: 0, owner: player, ownerOnly: true,
    });
    DEAD_CARCASS.set(player, npc);
    return npc;
  }

  function camera(player, move, look) {
    const sender = player.getPacketSender?.();
    if (!sender) return;
    const options = { rate: 232, rate2: 100, heightRelative: false };
    if (move) sender.sendCameraMoveTo?.(move[0], move[1], move[2], options);
    if (look) sender.sendCameraLookAt?.(look[0], look[1], look[2], options);
  }

  function nearbyRantz(player) {
    const world = api.core.World;
    const near = world?.getNpcsNear?.(player.getLocation(), 16, player.getPrivateArea?.() ?? null) ?? [];
    return [...near].find((npc) => RANTZ_NPC_IDS.has(npc?.getId?.()));
  }

  function removeFirstChompyActor(player) {
    const hunt = FIRST_HUNTS.get(player);
    if (!hunt?.npc) return;
    FIRST_CHOMPY.delete(hunt.npc);
    api.removeNpc(hunt.npc);
    hunt.npc = null;
  }

  function cancelFirstHunt(player) {
    const hunt = FIRST_HUNTS.get(player);
    if (hunt) api.core.TaskManager.cancelTasks(hunt.key);
    removeFirstChompyActor(player);
    FIRST_HUNTS.delete(player);
    player.getPacketSender?.().sendCameraReset?.();
  }

  /** Stage 30: the first toad brings a chompy; Rantz shoots and misses (stage 35) before stage 40. */
  function startFirstHunt(player) {
    cancelFirstHunt(player);
    const key = {};
    const npc = api.spawnNpc({
      id: CHOMPY_BIRD, x: TOAD_CLEARING.x, y: TOAD_CLEARING.y, z: TOAD_CLEARING.z,
      wanderRadius: 0, owner: player, ownerOnly: true,
    });
    const hunt = { key, npc };
    FIRST_HUNTS.set(player, hunt);
    FIRST_CHOMPY.add(npc);
    npc.forceChat?.("Sqwirk!");
    quest.setStage(player, STAGE_WAITING_CHOMPY);
    camera(player, [2644, 2975, 400], [TOAD_CLEARING.x, TOAD_CLEARING.y, 100]);
    player.sendMessage("You carefully place the bloated toad bait. A chompy swoops down!");
    api.core.TaskManager.submit(new api.core.CountdownTask(key, HUNT_WAIT_TICKS, () => {
      if (FIRST_HUNTS.get(player) !== hunt || quest.getStage(player) !== STAGE_WAITING_CHOMPY) return;
      quest.setStage(player, STAGE_CHOMPY_MISSED);
      const rantz = nearbyRantz(player);
      rantz?.forceChat?.("Hey, dere's da chompy, I's gonna shoot it.");
      player.sendMessage("Rantz: Hey, dere's da chompy, I's gonna shoot it.");
      camera(player, null, [TOAD_CLEARING.x, TOAD_CLEARING.y, 100]);
      api.core.TaskManager.submit(new api.core.CountdownTask(key, HUNT_SHOT_TICKS, () => {
        if (FIRST_HUNTS.get(player) !== hunt || quest.getStage(player) !== STAGE_CHOMPY_MISSED) return;
        player.sendMessage("Rantz keeps missing the chompy bird...");
        rantz?.forceChat?.("Grrr...de'ese arrows are rubbish.");
        removeFirstChompyActor(player);
        player.getPacketSender?.().sendCameraReset?.();
        api.core.TaskManager.submit(new api.core.CountdownTask(key, HUNT_SETTLE_TICKS, () => {
          if (FIRST_HUNTS.get(player) !== hunt) return;
          if (player.isRegistered?.() === false || quest.getStage(player) !== STAGE_CHOMPY_MISSED) {
            FIRST_HUNTS.delete(player);
            return;
          }
          FIRST_HUNTS.delete(player);
          quest.setStage(player, STAGE_RANTZ_MISSED);
          player.sendMessage("Rantz: Grrr...de'ese arrows are rubbish.");
        }));
      }));
    }));
  }

  function incrementChompyKills(player) {
    const kills = chompyKills(player) + 1;
    player.setAttribute(CHOMPY_KILLS_ATTRIBUTE, kills);
    player.getPacketSender?.().sendConfig?.(VARP_CHOMPY_KILLS, kills);
    return kills;
  }

  function grantHat(player, text) {
    if (quest.getStage(player) < STAGE_COMPLETE || !hasBow(player) || freeSlots(player) <= 0) return;
    const hat = hatForText(text);
    if (!hat) return;
    const index = CHOMPY_HATS.indexOf(hat);
    if (hatClaimed(player, index)) return;
    if (!has(player, hat.item)) player.getInventory().adds(hat.item, 1);
    player.setAttribute(HATS_CLAIMED_ATTRIBUTE, hatsClaimed(player) | (1 << index));
  }

  /** Chompys can only be hurt with the ogre bow and ogre arrows. */
  function handleCanAttack(event) {
    const { attacker, target } = event;
    if (!attacker?.isPlayer?.()) return;
    if (FIRST_CHOMPY.has(target)) {
      event.allow = false;
      attacker.sendMessage("Rantz is shooting this chompy.");
      return;
    }
    if (HUNTED_CHOMPY.get(attacker) !== target) return;
    const { Equipment } = api.core;
    const equipment = attacker.getEquipment?.();
    const weapon = equipment?.get?.(Equipment.WEAPON_SLOT)?.getId?.();
    const arrows = equipment?.get?.(Equipment.AMMUNITION_SLOT)?.getId?.();
    if (weapon !== OGRE_BOW || arrows !== OGRE_ARROW) {
      event.allow = false;
      attacker.sendMessage("Chompys can only be hurt with an ogre bow and ogre arrows.");
    }
  }

  /** The hunted chompy leaves a pluckable carcass for the player who killed it. */
  function handleNpcDeath(event) {
    const npcId = event.npcId ?? event.npc?.getId?.();
    if (npcId !== CHOMPY_BIRD) return;
    const player = event.killer;
    if (!player?.isPlayer?.()) return;
    if (HUNTED_CHOMPY.get(player) !== event.npc) return;
    HUNTED_CHOMPY.delete(player);
    const stage = quest.getStage(player);
    const location = event.location ?? event.npc?.getLocation?.();
    if (stage >= STAGE_GIVEN_BOW && stage < STAGE_KILLED_CHOMPY) quest.setStage(player, STAGE_KILLED_CHOMPY);
    else if (stage < STAGE_KILLED_CHOMPY && !quest.isComplete(player)) return;
    if (quest.isComplete(player)) incrementChompyKills(player);
    if (location) spawnCarcass(player, location);
    player.sendMessage("You killed the chompy bird.");
  }

  /** Release the bloated toad to start the hunt. */
  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (event.itemId !== BLOATED_TOAD || !option.includes("release")) return;
    const stage = quest.getStage(event.player);
    if (stage < STAGE_SHOWN_TOAD) {
      event.player.sendMessage("You should ask Rantz where to place this toad.");
      event.handled = true;
      return;
    }
    event.handled = true;
    if (stage >= STAGE_KILLED_CHOMPY && !quest.isComplete(event.player)) {
      const hasQuestChompy = has(event.player, RAW_CHOMPY) || has(event.player, SEASONED_CHOMPY)
        || DEAD_CARCASS.has(event.player);
      if (hasQuestChompy) {
        event.player.sendMessage("You have no reason to place another toad right now.");
        return;
      }
    }
    if (stage >= STAGE_RANTZ_MISSED && stage < STAGE_GIVEN_BOW) {
      event.player.sendMessage("Talk to Rantz about the ogre bow first.");
      return;
    }
    if (event.player.getInventory().getAmount(BLOATED_TOAD) <= 0) return;
    event.player.getInventory().deleteNumber(BLOATED_TOAD, 1);
    if (quest.isComplete(event.player)) {
      spawnChompy(event.player);
      event.player.sendMessage("You place the bloated toad bait. A chompy swoops down!");
    } else if (stage >= STAGE_GIVEN_BOW) {
      spawnChompy(event.player);
      event.player.sendMessage("You carefully place the bloated toad bait. A chompy swoops down!");
    } else {
      startFirstHunt(event.player);
    }
  }

  /** QH uses the ogre arrows on Rantz; that route has its own hand-in message. */
  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!RANTZ_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(event.player);
    if (quest.isComplete(event.player) && COOKED_CHOMPY_IDS.includes(event.itemId)) {
      event.player.getInventory().deleteNumber(event.itemId, 1);
      event.handled = true;
      startTranscript(api, event.player, npcId, RANTZ_PAGE, "giving-rantz-a-cooked-chompy");
      return;
    }
    if (event.itemId !== OGRE_ARROW) return;
    if (stage < STAGE_STARTED) return;
    const variant = stage >= STAGE_GIVEN_ARROWS
      ? "using-ogre-arrows-made-by-the-player-on-rantz-using-ogre-arrows-on-rantz-after-giving-him-some-already"
      : has(event.player, OGRE_ARROW, 6)
        ? "using-ogre-arrows-made-by-the-player-on-rantz"
        : "starting-off-using-less-than-6-ogre-arrows-on-rantz";
    event.handled = true;
    startTranscript(api, event.player, npcId, PAGE, variant);
  }

  /** Ask the key question, then show the bloated toad to move on. */
  function handleDialogueChoice({ player, npcId, option }) {
    if (!RANTZ_NPC_IDS.has(npcId) || quest.getStage(player) !== STAGE_GIVEN_ARROWS) return;
    if (String(option ?? "").includes("How do we make the chompys come?")) {
      quest.setStage(player, STAGE_KIDS_EXPLAINED_TOADS);
    }
  }

  /** Record what Rantz/Bugs/Fycie ask for as their dialogue is played. */
  function handleDialogueLine({ player, npcId, text }) {
    const stage = quest.getStage(player);
    const value = String(text ?? "").toLowerCase();
    if (RANTZ_NPC_IDS.has(npcId) && stage === STAGE_KILLED_CHOMPY) {
      if (value.includes("wants onion")) setIngredient(player, RANTZ_INGREDIENT_ATTRIBUTE, ItemIdentifiers.ONION);
      else if (value.includes("wants potato")) setIngredient(player, RANTZ_INGREDIENT_ATTRIBUTE, ItemIdentifiers.POTATO);
      // Advance only once Rantz has named his ingredient, so closing the dialogue
      // before this line leaves stage 50 and replays the full cooking request.
      if (value.includes("particular about our chompy yumms")) quest.setStage(player, STAGE_TOLD_TO_COOK);
      return;
    }
    if (BUGS_NPC_IDS.has(npcId) && stage >= STAGE_TOLD_TO_COOK && stage < STAGE_CHOMPY_COOKED) {
      if (value.includes("equa leaves")) setIngredient(player, BUGS_INGREDIENT_ATTRIBUTE, ItemIdentifiers.EQUA_LEAVES);
      else if (value.includes("cabbage")) setIngredient(player, BUGS_INGREDIENT_ATTRIBUTE, ItemIdentifiers.CABBAGE);
      return;
    }
    if (npcId === FYCIE_NPC_ID && stage >= STAGE_TOLD_TO_COOK && stage < STAGE_CHOMPY_COOKED) {
      if (value.includes("tomato")) setIngredient(player, FYCIE_INGREDIENT_ATTRIBUTE, ItemIdentifiers.TOMATO);
      else if (value.includes("doogle leaves")) setIngredient(player, FYCIE_INGREDIENT_ATTRIBUTE, ItemIdentifiers.DOOGLE_LEAVES);
    }
  }

  function buyBugsTools(player) {
    if (player.getAttribute(BUGS_TOOLS_ATTRIBUTE)) return;
    if (!has(player, ItemIdentifiers.COINS, 10) || freeSlots(player) < 2) return;
    player.getInventory().deleteNumber(ItemIdentifiers.COINS, 10);
    player.getInventory().adds(ItemIdentifiers.KNIFE, 1);
    player.getInventory().adds(ItemIdentifiers.CHISEL, 1);
    player.setAttribute(BUGS_TOOLS_ATTRIBUTE, 1);
  }

  function buyFycieFeathers(player) {
    if (player.getAttribute(FYCIE_FEATHERS_ATTRIBUTE)) return;
    if (!has(player, ItemIdentifiers.COINS, 50) || freeSlots(player) < 1) return;
    player.getInventory().deleteNumber(ItemIdentifiers.COINS, 50);
    player.getInventory().adds(ItemIdentifiers.FEATHER, 25);
    player.setAttribute(FYCIE_FEATHERS_ATTRIBUTE, 1);
  }

  /** The transcript's item hand-outs and hand-ins. */
  function handleAction(event) {
    const { player, npcId, stepId, text } = event;
    if (RANTZ_NPC_IDS.has(npcId) && /this is the hat for/i.test(String(text ?? ""))) {
      grantHat(player, text);
      return;
    }
    if (BUGS_NPC_IDS.has(npcId) && stepId === BUGS_TOOLS_MESSAGE_ID) {
      buyBugsTools(player);
      return;
    }
    if (npcId === FYCIE_NPC_ID && stepId === FYCIE_FEATHERS_MESSAGE_ID) {
      buyFycieFeathers(player);
      return;
    }
    if (!RANTZ_NPC_IDS.has(npcId)) return;
    if (TAKE_ARROWS_MESSAGE_IDS.has(stepId)) {
      const stage = quest.getStage(player);
      if (stage < STAGE_STARTED || stage >= STAGE_GIVEN_ARROWS || !has(player, OGRE_ARROW, 6)) return;
      player.getInventory().deleteNumber(OGRE_ARROW, 6);
      quest.setStage(player, STAGE_GIVEN_ARROWS);
      return;
    }
    if (stepId === SHOW_TOAD_MESSAGE_ID) {
      const stage = quest.getStage(player);
      if (stage < STAGE_BELLOWS_TAKEN || stage >= STAGE_SHOWN_TOAD || !has(player, BLOATED_TOAD)) return;
      quest.setStage(player, STAGE_SHOWN_TOAD);
      return;
    }
    if (stepId === GIVE_BOW_MESSAGE_ID) {
      const stage = quest.getStage(player);
      if (stage < STAGE_RANTZ_MISSED || stage >= STAGE_GIVEN_BOW) return;
      if (!hasBow(player)) {
        if (freeSlots(player) <= 0) {
          event.handled = true;
          player.sendMessage("You need an empty inventory slot for the ogre bow.");
          return;
        }
        player.getInventory().adds(OGRE_BOW, 1);
      }
      quest.setStage(player, STAGE_GIVEN_BOW);
      return;
    }
    if (stepId === RECLAIM_BOW_MESSAGE_ID) {
      const stage = quest.getStage(player);
      if (stage < STAGE_GIVEN_BOW || stage >= STAGE_KILLED_CHOMPY || hasBow(player)) return;
      if (!has(player, ItemIdentifiers.COINS, BOW_RECLAIM_COST)) return;
      if (freeSlots(player) <= 0) {
        event.handled = true;
        player.sendMessage("You need an empty inventory slot for the ogre bow.");
        return;
      }
      player.getInventory().deleteNumber(ItemIdentifiers.COINS, BOW_RECLAIM_COST);
      player.getInventory().adds(OGRE_BOW, 1);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      if (quest.getStage(player) < STAGE_CHOMPY_COOKED || quest.isComplete(player)) return;
      if (!has(player, SEASONED_CHOMPY)) return;
      player.getInventory().deleteNumber(SEASONED_CHOMPY, 1);
      quest.complete(player);
    }
  }

  function handleLogin({ player }) {
    player.getPacketSender?.().sendConfig?.(VARP_CHOMPY_KILLS, chompyKills(player));
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    cancelFirstHunt(player);
  }

  api.persistAttribute(RANTZ_INGREDIENT_ATTRIBUTE, 0);
  api.persistAttribute(BUGS_INGREDIENT_ATTRIBUTE, 0);
  api.persistAttribute(FYCIE_INGREDIENT_ATTRIBUTE, 0);
  api.persistAttribute(BUGS_TOOLS_ATTRIBUTE, 0);
  api.persistAttribute(FYCIE_FEATHERS_ATTRIBUTE, 0);
  api.persistAttribute(CHOMPY_KILLS_ATTRIBUTE, 0);
  api.persistAttribute(HATS_CLAIMED_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "big_chompy_bird_hunting",
    name: "Big Chompy Bird Hunting",
    varpId: VARP_CHOMPY_BIRD,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.FLETCHING.getIndex(), amount: 262, label: "Fletching" },
      { skillId: Skill.COOKING.getIndex(), amount: 1470, label: "Cooking" },
      { skillId: Skill.RANGED.getIndex(), amount: 735, label: "Ranged" },
    ],
    // The bow is handed over by Rantz at the hunt step, not added again at completion;
    // the completion scroll still shows it as the quest's item reward.
    scrollItemId: OGRE_BOW,
    rewardItemLabel: "An ogre bow",
    otherRewards: ["Ability to hunt chompy birds", "Chompy bird hats from Rantz"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onCanAttack(handleCanAttack);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
