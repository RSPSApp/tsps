/**
 * The Writing's on the Wall (members quest, 3 November 2026, cache revision 242, 1 Quest Point).
 * Betty at Land's End, Sergeant Hudson's permission, the Land's End evidence and witnesses, the
 * report to Hudson, Betty and the clues at her uncle's house in Hosidius, Port Piscarilius (the cell,
 * Jensen's house), the Shayzien crime scene, the island hideout and the finale, and the reward.
 *
 * Sources: the OSRS Wiki quest page and Transcript:The Writing's on the Wall (raw wikitext, sha256
 * in docs/quests/writings-on-the-wall/README.md) and the revision 242 cache. The generated
 * npc-dialogues export has no transcript for these NPCs, so the conversations are replayed here
 * from the Wiki text (as Daddy's Home and Mudfoot's Big Adventure do). The Wiki marks the
 * transcript incomplete; those cases are not invented.
 *
 * Cache facts (dbrow 17231 `quest_writingsonthewall`, gamevals):
 *   - quest id 219, members, start NPC wotw_betty_lands_end (16845), completion value 48,
 *     requirements Agility 22 and Thieving 20, rewards 2,500 Agility and 2,500 Thieving XP;
 *   - the stage is varbit `wotw` (16800, bits 0-8 of varp `wotw_primary` 6242); 36 flag varbits
 *     (16801-16834) live in that varp and in `wotw_secondary` 6243;
 *   - the cache's NPC and loc transforms key what is visible on that value: Betty at Land's End 0-12,
 *     Hudson and the corporals at Land's End 0-8, Betty outside her uncle's house 12-14 and inside
 *     16-20, the Land's End body inspectable at 4-6 and only "searchable" at 0-2 and 8-12. The
 *     stage numbers below sit inside those windows; the cache does not name the values between
 *     them, so they are this server's choice.
 *
 * Stages: 0 not started, 1 told to find Hudson, 4 permission to investigate, 8 all Land's End
 * evidence found (report to Hudson), 12 reported and at the uncle's house (10 is not used), 16 in the
 * basement, 20 all Hosidius clues found (ready for Port Piscarilius), 22 the arrest (passed through),
 * 24 in the cell, 26 plank out, 30 Jensen's house done, 32 back in the cell, 34 the cell wall read, 36 the
 * war tent scene done, 40 all Shayzien clues found (the island hideout opens), 44 the finale seen (Hudson
 * waits in the hideout), 48 complete.
 */
module.exports = function registerTheWritingsOnTheWallQuest(api) {
  const {
    ActionDialogue,
    Area,
    Boundary,
    DialogueChainBuilder,
    EndDialogue,
    ItemIdentifiers,
    ItemStatementDialogue,
    Location,
    NpcDialogue,
    NpcIdentifiers,
    OptionDialogue,
    PlayerDialogue,
    Skill,
    StatementDialogue,
  } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  // --- cache ids (rev 242 gamevals) -----------------------------------------------------------
  const STAGE_VARBIT = 16800; // wotw
  const BETTY_NPC_ID = 16850; // wotw_betty_child "Betty"
  const HUDSON_NPC_ID = 16861; // wotw_hudson_child "Sergeant Hudson"
  const BREIMAN_NPC_ID = 16866; // wotw_soldier_child_1 "Corporal Breiman"
  const CAMPTER_NPC_ID = 16871; // wotw_soldier_child_2 "Corporal Campter"
  const GUARD_ONE_NPC_ID = 16867; // wotw_soldier_cutscene_1 (the Piscarilius guards, wotw 22-32)
  const GUARD_TWO_NPC_ID = 16872; // wotw_soldier_cutscene_2
  const MONK_NPC_ID = 16873; // wotw_monk
  const JOYCE_NPC_ID = 16874; // wotw_farmer "Joyce"
  const HUGOR_NPC_ID = 7478; // kw_hugor
  // Lan is a multi-NPC (kw_butcher_lan, 7479, keyed on `wotw`); interactions carry the resolved child, visible at wotw 0-8 and 36-48.
  const LAN_NPC_ID = 16805; // kw_butcher_lan_vis "Lan the Butcher"

  const AGILITY_REQUIREMENT = 22;
  const THIEVING_REQUIREMENT = 20;

  const STAGE_STARTED = 1;
  const STAGE_PERMITTED = 4;
  const STAGE_REPORT = 8;
  const STAGE_REPORTED = 10;
  const STAGE_UNCLE = 12;
  const STAGE_BASEMENT = 16;
  const STAGE_CLUES = 20;
  const STAGE_PISCARILIUS = 22; // arrested at Port Piscarilius
  const STAGE_CELL = 24; // in the cell, looking for a way out
  const STAGE_ESCAPED = 26; // the plank is out; Captain Jensen's house is next
  const STAGE_JENSEN_DONE = 30; // every clue in Jensen's house found; return to the cell
  const STAGE_CELL_BLOOD = 32; // back in the cell: Betty is gone and the east wall has a message
  const STAGE_DECODE = 34; // the wall is read; the letter can be decoded
  const STAGE_SHAYZIEN = 36; // the war tent scene is done; Edwards' house is next
  const STAGE_SHAYZIEN_DONE = 40; // every Shayzien clue found; the island hideout opens
  const STAGE_FINALE = 44; // the finale has been seen; Hudson waits in the hideout
  const STAGE_COMPLETE = 48;

  // The flag varbits this flight reads, with the level each must reach for the evidence to count.
  const FLAG_VARBITS = {
    letter: 16801, // wotw_lands_end_letter (2 = taken)
    hands: 16802,
    wall: 16803, // wotw_lands_end_wall
    news: 16804, // wotw_lands_end_news (2 = taken)
    knife: 16805,
    butcherQuestioned: 16806,
    history: 16807, // Betty told me about her family
    bettyAlibi: 16808,
    hugorAlibi: 16809,
    foundWindow: 16811,
    hosidiusHead: 16812, // 1 = found in the compost, 2 = inspected
    certificate: 16813, // 2 = taken
    uncleJob: 16816, // Joyce
    drinkingHabits: 16817, // Betty on the drinking
    strangerInfo: 16818, // the monk
    confrontationInfo: 16819, // Betty on the Keystone Lodge
    piscHead: 16820,
    piscFeet: 16821,
    cellBlood: 16822,
    piscTorso: 16823,
    piscDagger: 16824,
    piscWardrobe: 16825,
    piscBed: 16826,
    plankRemoved: 16834,
    drawersBlood: 0, // no cache varbit: the drawers' blood is read through interface 985
    shayzienWall: 16827, // 2 bits
    shayzienShelves: 16828,
    shayzienEyes: 16829,
    shayzienVictimInfo: 16830, // asked Hudson about the victim
    shayzienWitness: 16831, // Kyle
    shayzienHands: 16832,
  };
  const REQUIRED_LEVEL = { letter: 2, news: 2, hosidiusHead: 2, certificate: 2 };
  const FLAGS_ATTRIBUTE = "writings-on-the-wall:flags";
  const LANDS_END_EVIDENCE = ["letter", "news", "wall", "knife", "butcherQuestioned", "history", "hugorAlibi"];
  const HOSIDIUS_CLUES = ["hosidiusHead", "certificate", "uncleJob", "strangerInfo", "drinkingHabits", "confrontationInfo"];
  const SHAYZIEN_CLUES = ["shayzienWall", "shayzienShelves", "shayzienEyes", "shayzienHands", "shayzienWitness"];
  const JENSEN_CLUES = ["piscHead", "piscFeet", "piscTorso", "piscDagger", "piscWardrobe", "piscBed"];
  const ASKED_ATTRIBUTE = "writings-on-the-wall:asked";

  // Interfaces and items (rev 242 gamevals).
  const CERTIFICATE_INTERFACE = 984; // wotw_certificate_hosidius
  const LETTER_HOSIDIUS_INTERFACE = 986; // wotw_letter_hosidius
  const LETTER_LANDS_END_INTERFACE = 987; // wotw_letter_lands_end
  const NEWS_INTERFACE = 988; // wotw_news_lands_end
  const BLOOD_LANDS_END_INTERFACE = 990; // wotw_wall_lands_end
  const JACKS_LETTER = ItemIdentifiers.LETTER_18; // wotw_letter_lands_end
  const NEWSPAPER = ItemIdentifiers.NEWSPAPER_CUTTING; // wotw_news_lands_end
  const BLOODY_KNIFE = ItemIdentifiers.BLOODY_KNIFE_2; // wotw_knife_lands_end
  const HUMAN_HEAD = ItemIdentifiers.HUMAN_HEAD; // wotw_head_hosidius
  const BERNARDS_LETTER = ItemIdentifiers.LETTER_19; // wotw_letter_hosidius
  const CERTIFICATE = ItemIdentifiers.CERTIFICATE_11; // wotw_certificate_hosidius

  // Loc ids (the base multi-loc and its variants), from the cache gamevals.
  const BODY_LANDS_END = new Set([50789, 50790, 50791, 50792]);
  const BLOOD_LANDS_END = new Set([50793, 50794, 50795]);
  const SHELVES_LANDS_END = 50798;
  const BUTCHER_BED = 50799;
  const FRONT_DOOR = 50800;
  const BACK_DOOR = 50801;
  const WINDOW = 50803;
  const BODY_BASEMENT = new Set([50804, 50805, 50806]);
  const COMPOST_BIN = 50808;
  const BOOKCASE = 50810;
  const HOUSE = { minX: 1784, maxX: 1789, minY: 3521, maxY: 3527 };
  const WINDOW_INSIDE = { x: 1784 }; // the window is the loc at 1783,3525; the tile east of it is inside the house
  const WINDOW_OUTSIDE = { x: 1782 };
  const BASEMENT_ARRIVAL = { x: 1749, y: 9936 };
  // Port Piscarilius (rev 242 gamevals; tiles from the cache map).
  const CELL_WALL = 50812; // wotw_piscarilius_cell_wall: Remove-plank, then Climb-over (varbit wotw_plank_removed)
  const BODY_JENSEN = new Set([50815, 50816, 50817]); // wotw_armour_stand_piscarilius
  const DRAWERS_JENSEN = 50819; // wotw_drawers_piscarilius
  const WARDROBE_JENSEN = 63314;
  const BED_JENSEN = 63315;
  const BLOOD_CELL = new Set([63309, 63310]); // wotw_blood_piscarilius
  const DRAWERS_INTERFACE = 985; // wotw_drawers_piscarilius
  const BLOOD_CELL_INTERFACE = 991; // wotw_wall_piscarilius
  const CELL = { x: 1788, y: 3781 }; // inside the guardhouse cell, west of the blood wall at (1789,3780)
  const CELL_AREA = { minX: 1786, maxX: 1790, minY: 3779, maxY: 3782 };
  const JENSEN_HOUSE = { minX: 1752, maxX: 1760, minY: 3773, maxY: 3785 };
  // Shayzien (rev 242 gamevals; the Wiki map pins give the war tent, Edwards' house and Kyle).
  const BODY_EDWARDS = new Set([63316, 63317, 63318]); // wotw_bed_shayzien
  const BLOOD_SHAYZIEN = new Set([63320, 63321]); // wotw_blood_shayzien
  const SHELVES_SHAYZIEN = 63322; // wotw_drink_shelves_shayzien
  const BLOOD_SHAYZIEN_INTERFACE = 992; // wotw_wall_shayzien
  const WAR_TENT_AREA = { minX: 1480, maxX: 1490, minY: 3631, maxY: 3641 };
  const KYLE_NPC_ID = 16875; // wotw_forester "Kyle"
  // The island hideout (rev 242 gamevals; tiles from the cache map and the Wiki's Watson's house pin).
  const PLANT = 63325; // wotw_hideout_trapdoor_bush "Plant" at 1615,3582
  const HIDEOUT_LADDER = 63326; // wotw_hideout_ladder "Ladder" Climb-up at 1623,9932
  const BLOOD_HIDEOUT = new Set([63327, 63328]); // wotw_blood_hideout
  const HIDEOUT_INTERFACE = 989; // wotw_wall_hideout
  // North of the ladder (1623,9932): the column whose door (loc 11783 at 1623,9936) leads to the wall room. (1624,9936) is a side corridor cut off from it.
  const HIDEOUT_ARRIVAL = { x: 1623, y: 9934 };
  const ISLAND_EXIT = { x: 1617, y: 3584 };
  const AMULET_OF_SIGHT = ItemIdentifiers.AMULET_OF_SIGHT; // 34762
  const AMULET_PRICE = 1500;
  const BASEMENT_LADDER = 41428; // "Ladder" (Climb-up) at 1750,9933
  const HOUSE_LADDER = 41427; // "Ladder" (Climb-down) at 1789,3521: the way back down to Betty
  const BASEMENT_EXIT = { x: 1785, y: 3524 }; // back up into the house

  const START_MESSAGE = "You've started a new quest: <col=081190>The Writing's on the Wall</col>";

  // Approximate tiles: Land's End from the quest start map, Hosidius from the Wiki's house polygon.
  const TILES = {
    betty: { x: 1519, y: 3438 },
    hudson: { x: 1518, y: 3440 },
    breiman: { x: 1521, y: 3441 },
    campter: { x: 1517, y: 3437 },
    bettyUncleOutside: { x: 1786, y: 3519 },
    bettyUncleInside: { x: 1748, y: 9936 },
    joyce: { x: 1777, y: 3524 },
    cellBetty: { x: 1787, y: 3781 },
    guardOne: { x: 1757, y: 3776 },
    guardTwo: { x: 1757, y: 3780 },
    shayzienArrival: { x: 1451, y: 3638 },
    shayzienHudson: { x: 1451, y: 3640 },
    shayzienBreiman: { x: 1453, y: 3639 },
    shayzienCampter: { x: 1449, y: 3638 },
    kyle: { x: 1452, y: 3629 },
    hudsonHideout: { x: 1624, y: 9940 }, // inside the wall room, where the finale is read
    hudsonAdministration: { x: 1521, y: 3567 },
    monk: { x: 1787, y: 3512 },
  };

  let quest;
  const tracked = new WeakMap();

  // --- state ----------------------------------------------------------------------------------

  const stageOf = (player) => quest.getStage(player);
  const objectAttr = (player, key) => (player.getAttribute(key) && typeof player.getAttribute(key) === "object" ? player.getAttribute(key) : {});
  const flagsOf = (player) => objectAttr(player, FLAGS_ATTRIBUTE);
  const flagLevel = (player, name) => Number(flagsOf(player)[name]) || 0;
  const hasFlag = (player, name) => flagLevel(player, name) >= (REQUIRED_LEVEL[name] ?? 1);
  const allFlags = (player, names) => names.every((name) => hasFlag(player, name));
  const askedOf = (player) => objectAttr(player, ASKED_ATTRIBUTE);

  function sendFlags(player) {
    const flags = flagsOf(player);
    const sender = player.getPacketSender();
    for (const [name, varbit] of Object.entries(FLAG_VARBITS)) if (varbit) sender.sendVarbit(varbit, Number(flags[name]) || 0);
  }

  function setFlag(player, name, level = 1) {
    if (flagLevel(player, name) >= level) return;
    player.setAttribute(FLAGS_ATTRIBUTE, { ...flagsOf(player), [name]: level });
    sendFlags(player);
    const stage = stageOf(player);
    if (stage >= STAGE_PERMITTED && stage < STAGE_REPORT && allFlags(player, LANDS_END_EVIDENCE)) setStage(player, STAGE_REPORT);
    if (stage >= STAGE_BASEMENT && stage < STAGE_CLUES && allFlags(player, HOSIDIUS_CLUES)) setStage(player, STAGE_CLUES);
    if (stage >= STAGE_ESCAPED && stage < STAGE_JENSEN_DONE && allFlags(player, JENSEN_CLUES)) setStage(player, STAGE_JENSEN_DONE);
    if (stage >= STAGE_SHAYZIEN && stage < STAGE_SHAYZIEN_DONE && allFlags(player, SHAYZIEN_CLUES)) setStage(player, STAGE_SHAYZIEN_DONE);
  }

  function asked(player, key) {
    player.setAttribute(ASKED_ATTRIBUTE, { ...askedOf(player), [key]: true });
  }

  function setStage(player, stage) {
    quest.setStage(player, stage);
    syncNpcs(player);
  }

  const meetsRequirements = (player) => {
    const skills = player.getSkillManager();
    return skills.getMaxLevel(Skill.AGILITY) >= AGILITY_REQUIREMENT && skills.getMaxLevel(Skill.THIEVING) >= THIEVING_REQUIREMENT;
  };

  // --- spawned NPCs ---------------------------------------------------------------------------

  function mapOf(player) {
    let map = tracked.get(player);
    if (!map) tracked.set(player, (map = new Map()));
    return map;
  }

  function spawn(player, key, id, tile) {
    const map = mapOf(player);
    if (map.get(key)?.getId?.() === id) return map.get(key);
    remove(player, key);
    const npc = api.spawnNpc({ id, x: tile.x, y: tile.y, z: 0, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (npc) map.set(key, npc);
    return npc;
  }

  function remove(player, key) {
    const map = tracked.get(player);
    const npc = map?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    map.delete(key);
  }

  /** The cache's visibility windows: who stands where at each stage. */
  function syncNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = stageOf(player);
    const at = (key, show, id, tile) => (show ? spawn(player, key, id, tile) : remove(player, key));
    at("hudson", stage <= STAGE_REPORT, HUDSON_NPC_ID, TILES.hudson);
    at("breiman", stage <= STAGE_REPORT, BREIMAN_NPC_ID, TILES.breiman);
    at("campter", stage <= STAGE_REPORT, CAMPTER_NPC_ID, TILES.campter);
    at("betty-lands-end", stage < STAGE_UNCLE, BETTY_NPC_ID, TILES.betty);
    at("betty-outside", stage >= STAGE_UNCLE && stage < STAGE_BASEMENT, BETTY_NPC_ID, TILES.bettyUncleOutside);
    at("betty-inside", stage >= STAGE_BASEMENT && stage <= STAGE_CLUES, BETTY_NPC_ID, TILES.bettyUncleInside);
    at("joyce", stage >= STAGE_UNCLE && stage < STAGE_PISCARILIUS, JOYCE_NPC_ID, TILES.joyce);
    at("monk", stage >= STAGE_UNCLE && stage < STAGE_PISCARILIUS, MONK_NPC_ID, TILES.monk);
    at("betty-cell", stage >= STAGE_CELL && stage < STAGE_CELL_BLOOD, BETTY_NPC_ID, TILES.cellBetty);
    const shayzien = stage >= STAGE_SHAYZIEN && stage <= STAGE_SHAYZIEN_DONE;
    at("hudson-shayzien", shayzien, HUDSON_NPC_ID, TILES.shayzienHudson);
    at("breiman-shayzien", shayzien, BREIMAN_NPC_ID, TILES.shayzienBreiman);
    at("campter-shayzien", shayzien, CAMPTER_NPC_ID, TILES.shayzienCampter);
    at("kyle", shayzien, KYLE_NPC_ID, TILES.kyle);
    at("hudson-hideout", stage === STAGE_FINALE, HUDSON_NPC_ID, TILES.hudsonHideout);
    at("hudson-administration", stage >= STAGE_COMPLETE, HUDSON_NPC_ID, TILES.hudsonAdministration);
    at("guard-one", stage >= STAGE_PISCARILIUS && stage <= STAGE_CELL_BLOOD, GUARD_ONE_NPC_ID, TILES.guardOne);
    at("guard-two", stage >= STAGE_PISCARILIUS && stage <= STAGE_CELL_BLOOD, GUARD_TWO_NPC_ID, TILES.guardTwo);
  }

  // --- dialogue -------------------------------------------------------------------------------

  /**
   * Plays a script: ["N", npcId, text], ["P", text], ["S", text] (a box), ["A", fn] (an action when
   * reached) and ["O", title, [[label, fn], ...]] (a menu).
   */
  function play(player, entries) {
    const chain = new DialogueChainBuilder();
    entries.forEach((entry, index) => {
      const [kind] = entry;
      if (kind === "N") chain.add(new NpcDialogue(index, entry[1], entry[2]));
      else if (kind === "P") chain.add(new PlayerDialogue(index, entry[1]));
      else if (kind === "S") chain.add(new StatementDialogue(index, entry[1]));
      else if (kind === "I") chain.add(new ItemStatementDialogue(index, entry[1], entry[2]));
      else if (kind === "A") chain.add(new ActionDialogue(index, { execute: () => entry[1]() }));
      else if (kind === "O") {
        const options = entry[2];
        chain.add(new OptionDialogue(index, {
          executeOption(option) {
            const choice = options[Number(option) - 1];
            if (choice?.[1]) choice[1]();
            else player.getPacketSender().sendInterfaceRemoval();
          },
        }, ...options.map((option) => option[0])).setTitle(entry[1]));
      }
    });
    chain.add(new EndDialogue(entries.length));
    player.getDialogueManager().startDialogues(chain);
  }

  /** A conversation as [speaker, text] pairs: "P" is the player, anything else the NPC. */
  function say(player, npcId, lines) {
    play(player, lines.map(([who, text]) => (who === "P" ? ["P", text] : ["N", npcId, text])));
  }

  /** A menu of questions ending in the transcript's "Actually, I'll be back later." / "That's all for now." exit. */
  function questionMenu(player, npcId, key, questions, farewell, exitLabel) {
    const options = questions.map(([label, lines, after]) => [label, () => {
      asked(player, `${key}:${label}`);
      play(player, [...lines.map(([who, text]) => (who === "P" ? ["P", text] : ["N", npcId, text])), ["A", () => {
        if (after) after(player);
        questionMenu(player, npcId, key, questions, farewell, exitLabel);
      }]]);
    }]);
    const any = questions.some(([label]) => askedOf(player)[`${key}:${label}`]);
    const exit = exitLabel ?? (any ? "That's all for now." : "Actually, I'll be back later.");
    options.push([exit, () => say(player, npcId, [
      ["P", exit],
      ...(farewell ? [["N", farewell]] : []),
    ])]);
    play(player, [["O", "Select an option", options]]);
  }

  // --- Betty ----------------------------------------------------------------------------------

  function startQuest(player) {
    if (stageOf(player) !== 0) return;
    play(player, [
      ["P", "Of course."],
      ["N", BETTY_NPC_ID, "Thank you. Talk to Sergeant Hudson. He's in charge of the investigation. You'll need his permission to help."],
      ["A", () => {
        setStage(player, STAGE_STARTED);
        player.sendMessage(START_MESSAGE);
      }],
    ]);
  }

  function talkBetty(event) {
    const { player, npcId } = event;
    if (npcId !== BETTY_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage === 0) {
      const open = [
        ["P", "Hello there. Who are you?"],
        ["N", BETTY_NPC_ID, "Oh... Hello. The name's Betty."],
        ["P", "You seem upset. What's wrong?"],
      ];
      if (!meetsRequirements(player)) {
        play(player, [...open, ["N", BETTY_NPC_ID, "Nothing you can help me with."]]);
        return true;
      }
      play(player, [
        ...open,
        ["N", BETTY_NPC_ID, "My father, Jack. He's been murdered! The authorities are here, but they don't seem to care! I don't know what to do."],
        ["P", "Well, maybe I could help. I could do some investigating of my own."],
        ["N", BETTY_NPC_ID, "You... You'd do that?"],
        ["O", "Start The Writing's on the Wall quest?", [
          ["Yes.", () => startQuest(player)],
          ["No.", () => say(player, BETTY_NPC_ID, [
            ["P", "Well... No. Sorry, but I don't have time. I hope it all works out for you though."],
            ["N", "I... Thank you."],
          ])],
        ]],
      ]);
    } else if (stage === STAGE_STARTED) {
      say(player, BETTY_NPC_ID, [["N", "Have you spoken to Sergeant Hudson yet?"], ["P", "Not yet."], ["N", "Please hurry."]]);
    } else if (stage >= STAGE_PERMITTED && stage < STAGE_REPORTED) {
      landsEndBetty(player, stage);
    } else if (stage === STAGE_UNCLE) {
      uncleOutside(player);
    } else if (stage >= STAGE_BASEMENT && stage <= STAGE_CLUES) {
      uncleBasement(player, stage);
    } else if (stage === STAGE_CELL) {
      say(player, BETTY_NPC_ID, [["N", "Have you found a way out yet?"], ["P", "Not yet."], ["N", "Please hurry. We need to find out what's happened."]]);
    } else if (stage >= STAGE_ESCAPED && stage < STAGE_CELL_BLOOD && !JENSEN_CLUES.some((name) => flagLevel(player, name) > 0)) {
      // The Wiki's transcript has no Betty line once Jensen's body has been seen, so none is invented.
      say(player, BETTY_NPC_ID, [["N", "What are you doing back here? You need to get over to Captain Jensen's house and then investigate whatever has happened there! Hurry!"], ["P", "I'll go right away."]]);
    } else {
      return false;
    }
    return true;
  }

  function landsEndBetty(player, stage) {
    const everything = stage >= STAGE_REPORT;
    const found = LANDS_END_EVIDENCE.some((name) => hasFlag(player, name));
    const opening = everything
      ? [["N", BETTY_NPC_ID, "Have you found anything yet?"],
        ["P", "Nothing totally solid, but I've definitely uncovered some things that the authorities will want to know about."],
        ["N", BETTY_NPC_ID, "I guess you should let Sergeant Hudson know."]]
      : [["N", BETTY_NPC_ID, "Have you found anything yet?"],
        ["P", found ? "I've found a few things, but I think there's still more to uncover." : "Not yet."],
        ["N", BETTY_NPC_ID, "Please hurry."]];
    const bettyMenu = () => {
      const questions = [
        ["Did you see or hear anything before your father's death?", [
          ["P", "Did you see or hear anything before your father's death?"],
          ["N", "No, I wasn't here when it happened. I was doing some shopping up in Shayzien. Everything seemed normal when I left, but then I came back and I found him like... like that..."],
        ], () => setFlag(player, "bettyAlibi")],
        ["Do you know why someone would want your father dead?", [
          ["P", "Do you know why someone would want your father dead?"],
          ["N", "Maybe... but... it surely can't be possible..."],
          ["P", "What is it?"],
          ["N", "It was a long time ago, when I was just a child. My mother and sister were murdered, right here in Land's End, but they never found the killer..."],
          ["N", "My father used to be a judge you see. A lot of criminals would have considered him an enemy. Most likely one of them killed my family to get to him."],
          ["N", "But that was so long ago... Could they really have come back now?"],
          ["P", "Hopefully not, but we can't rule anything out at this point."],
        ], () => setFlag(player, "history")],
      ];
      const options = questions.map(([label, lines, after]) => [label, () => play(player, [
        ...lines.map(([who, text]) => (who === "P" ? ["P", text] : ["N", BETTY_NPC_ID, text])),
        ["A", () => { if (after) after(); bettyMenu(); }],
      ])]);
      options.push(["I'll get back to it.", () => say(player, BETTY_NPC_ID, [["P", "I'll get back to it."]])]);
      play(player, [["O", "Select an option", options]]);
    };
    play(player, [...opening, ["A", bettyMenu]]);
  }

  function uncleOutside(player) {
    if (askedOf(player)["betty:outside"]) {
      say(player, BETTY_NPC_ID, [["N", "Have you found a way inside yet?"], ["P", "Not yet. I'll keep working on it."], ["N", "Thanks. This is very unusual..."]]);
      return;
    }
    asked(player, "betty:outside");
    say(player, BETTY_NPC_ID, [
      ["N", "You made it."],
      ["P", "Hey, Betty. Is your uncle not around?"],
      ["N", "I don't know... The doors are locked, which is very odd..."],
      ["P", "He doesn't normally lock them?"],
      ["N", "No. This is a very safe area. He never normally needs to."],
      ["P", "Curious... Let me see if I can find a way inside."],
    ]);
  }

  function uncleBasement(player, stage) {
    const everything = stage >= STAGE_CLUES;
    if (everything) {
      play(player, [
        ["N", BETTY_NPC_ID, "Have you found anything yet?"],
        ["P", "Yes, I've found a few things that might be of note, but the main one is that I found some symbols, just like the ones back at your home."],
        ["N", BETTY_NPC_ID, "Symbols? What do they mean?"],
        ["P", "They seem to be part of some sort of cipher. There was also a letter back at your home that had the same symbols on it."],
        ["N", BETTY_NPC_ID, "A cipher...? I don't understand. Why would the killer be doing this?"],
        ["P", "I'm not sure, but it seems they want us to translate the letter. They're clearly intentionally leaving clues for how to do so."],
        ["N", BETTY_NPC_ID, "But... if they're leaving clues, yet you don't have enough to translate the letter yet, that can only mean..."],
        ["P", "They plan to strike again... if they haven't already. Betty, we need to get you to safety. We need to go to Sergeant Hudson."],
        ["N", BETTY_NPC_ID, "No... We can't trust him! This kingdom is rotten to its core. It's the very thing my father spent so long fighting. We can't trust anyone of authority here."],
        ["P", "Surely there must be someone?"],
        ["N", BETTY_NPC_ID, "My father... he was good friends with a Shayzien captain, before they both retired. Captain Jensen is her name. She was one of the good ones. She can help us. I trust her."],
        ["P", "Hmm... Alright, where can we find her?"],
        ["N", BETTY_NPC_ID, "She lives in Port Piscarilius now."],
        ["P", "In that case, let's head over there. It's not safe for you to travel alone, so we'll go together."],
        ["N", BETTY_NPC_ID, "Okay... Just let me know when you're ready to go."],
        ["O", "Select an option", [
          ["Let's get going.", () => depart(player)],
          ["I need to do something else first.", () => say(player, BETTY_NPC_ID, [["P", "I need to do something else first."], ["N", "Okay... Just, please don't take too long."]])],
        ]],
      ]);
      return;
    }
    const found = HOSIDIUS_CLUES.some((name) => hasFlag(player, name));
    const opening = [["N", BETTY_NPC_ID, "Have you found anything yet?"], ["P", found ? "I've found a few things, but I think there's still more to uncover." : "Not yet."], ["N", BETTY_NPC_ID, "Okay..."]];
    const menu = () => {
      const questions = [
        ["Do you know why someone would want your uncle dead?", [
          ["P", "Do you know why someone would want your uncle dead?"],
          ["N", "No. Uncle Bernard wasn't like my father, working some dangerous job. Before he retired, he was just a clerical assistant. He spent his days filing papers! He wasn't even a proper member of the army!"],
        ]],
        ["Was your uncle a big drinker?", [
          ["P", "Was your uncle a big drinker?"],
          ["N", "I suppose so. He was always a big fan of wine."],
          ["P", "Would he drink with others, or alone?"],
          ["N", "Mostly alone. He liked his privacy. He'd always be happy to get a bottle or two out if he did have visitors though. He'd always insist on me or my father having at least one drink with him if we visited."],
        ], () => setFlag(player, "drinkingHabits")],
      ];
      if (hasFlag(player, "certificate")) {
        questions.push(["Have you heard of the Keystone Lodge?", [
          ["P", "Have you heard of the Keystone Lodge?"],
          ["N", "Yes... It was some special group Uncle Bernard was part of. Father was a member as well. I don't really know what it was all about. Something to do with self- betterment for the good of all, I think."],
          ["N", "It all seemed a bit silly to me, but it kept them happy, at least... until the group closed down a few months ago."],
          ["P", "Do you know why it closed?"],
          ["N", "Lack of new members apparently."],
        ], () => setFlag(player, "confrontationInfo")]);
      }
      const options = questions.map(([label, lines, after]) => [label, () => play(player, [
        ...lines.map(([who, text]) => (who === "P" ? ["P", text] : ["N", BETTY_NPC_ID, text])),
        ["A", () => { if (after) after(); menu(); }],
      ])]);
      options.push(["I'll get back to it.", () => say(player, BETTY_NPC_ID, [["P", "I'll get back to it."]])]);
      play(player, [["O", "Select an option", options]]);
    };
    play(player, [...opening, ["A", menu]]);
  }

  /** "Let's get going.": the arrest and the cell are Piscarilius content (flight 2); this plays the transcript up to the cell. */
  function depart(player) {
    play(player, [
      ["P", "Let's get going."],
      ["S", "You depart for Port Piscarilius with Betty."],
      ["N", HUDSON_NPC_ID, "So here you are."],
      ["P", "Sergeant Hudson? What is this?"],
      ["N", HUDSON_NPC_ID, "What this is, is the two of you now being suspects in a murder investigation. You were spotted at a crime scene, and yet you chose not to report what happened there."],
      ["P", "Hang on! We can explain!"],
      ["N", HUDSON_NPC_ID, "I hope you can, and you will very much get your chance to do so. Corporal, find a cell for them in the local guardhouse. We'll question them once we're done here."],
      ["S", "The corporal escorts you and Betty to a cell in the nearby guardhouse."],
      ["N", BETTY_NPC_ID, "No, no, no! This can't be happening..."],
      ["N", BETTY_NPC_ID, "Can't those fools see what they're doing?! Something horrible is happening, and rather than doing anything about it, they just throw us in a cell instead!"],
      ["P", "They're not wrong though. We did fail to report a murder to them."],
      ["N", BETTY_NPC_ID, "With good reason!"],
      ["P", "Well, let's hope we can explain that to them when they come to question us."],
      ["N", BETTY_NPC_ID, "What? We can't just stay here! Don't you see? They were already here when we arrived! They can't have known where we were going. Something bad must have happened! We need to find out what!"],
      ["P", "How? Betty, we're locked in a cell."],
      ["N", BETTY_NPC_ID, "This is hardly the Shayzien Prison. These walls are rotting away! There must be a way through one of them."],
      ["P", "Perhaps, but breaking out of here is going to make us look even more guilty!"],
      ["N", BETTY_NPC_ID, "We don't have a choice. You need to get out of here, get over to Captain Jensen's house and then investigate whatever has happened there."],
      ["P", "And what about you?"],
      ["N", BETTY_NPC_ID, "I'll stay here. I can throw the guards off your scent if they find out you're gone. And if the killer is after me, I'll hopefully be a little bit safer here... for now at least."],
      ["P", "I don't like this, Betty, but alright. I'll see if I can find a way out."],
      ["A", () => {
        setStage(player, STAGE_CELL);
        player.moveTo(new Location(CELL.x, CELL.y, 0));
      }],
    ]);
  }

  // --- Shayzien soldiers ----------------------------------------------------------------------

  function talkHudson(event) {
    const { player, npcId } = event;
    if (npcId !== HUDSON_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage === 0) {
      say(player, HUDSON_NPC_ID, [["P", "What's going on here?"], ["N", "I'm afraid there's been a murder. Now please, move along. We need space to conduct our investigation."]]);
    } else if (stage === STAGE_STARTED) {
      play(player, [
        ["P", "Are you Sergeant Hudson?"],
        ["N", HUDSON_NPC_ID, "That's right. What do you need?"],
        ["P", "Betty said you were the one in charge of the investigation into her father's murder. I was wondering if I could help."],
        ["N", HUDSON_NPC_ID, "Well, thank you for the offer, but we've got this in hand."],
        ["P", "Betty doesn't seem to feel that way. She doesn't think you care."],
        ["N", HUDSON_NPC_ID, "The girl has just lost her father. Of course she's going to be emotional right now. She has nothing to fear though. We'll get to the bottom of this."],
        ["P", "Perhaps you'll get to the bottom of it faster with an extra pair of hands. I could be quite useful."],
        ["N", HUDSON_NPC_ID, "Hmm... Well if it makes Betty feel better, then fine. Feel free to have a look around the house. Just don't go messing up any evidence."],
        ["A", () => setStage(player, STAGE_PERMITTED)],
      ]);
    } else if (stage === STAGE_REPORT) {
      reportToHudson(player);
    } else if (stage >= STAGE_COMPLETE) {
      postQuestHudson(player);
    } else if (stage === STAGE_FINALE) {
      finaleHudson(player);
    } else if (stage >= STAGE_SHAYZIEN && stage <= STAGE_SHAYZIEN_DONE) {
      shayzienHudson(player, stage);
    } else if (stage >= STAGE_PERMITTED && stage < STAGE_REPORT) {
      say(player, HUDSON_NPC_ID, [
        ["P", "What do I need to be doing?"],
        ["N", "You don't need to be doing anything. We have everything in hand here."],
        ["P", "You know what I mean..."],
        ["N", "If you wish to investigate the crime scene, I won't stop you, but I'm not going to waste time telling you how to do it. I'm busy enough as it is."],
      ]);
    } else {
      return false;
    }
    return true;
  }

  function reportToHudson(player) {
    play(player, [
      ["P", "I've found some interesting things that you should know about."],
      ["N", HUDSON_NPC_ID, "There's a good chance we've found them ourselves already, but let's hear them."],
      ["P", "The victim was seemingly killed by a stab wound to the heart, and it seems they were specifically targeted by the killer. Some sort of encoded message was left on them, and there were more symbols on the wall as well."],
      ["N", HUDSON_NPC_ID, "And?"],
      ["P", "The victim was once a judge and made a fair few enemies. It's possible one of them specifically targeted him. If so, it might not be the first time. Many years ago, his wife and daughter were killed as well."],
      ["N", HUDSON_NPC_ID, "Yes, Betty told us that as well, but none of this gives us much to go on. As you said, he likely had multiple enemies. We need something more specific."],
      ["P", "Well, from what a neighbour overheard, the killer was likely known to the victim."],
      ["N", HUDSON_NPC_ID, "That's not too surprising and doesn't actually narrow things down much. He knew a lot of people, and would remember a lot more from his past."],
      ["N", HUDSON_NPC_ID, "Unfortunately, it doesn't seem you've really uncovered anything that will help us. Still, maybe your work will reassure Betty a bit. Now, it's time we started wrapping up here."],
      ["P", "Well, hang on... What about the local butcher?"],
      ["N", HUDSON_NPC_ID, "What about him?"],
      ["P", "An odd acting butcher who has no produce, yet did have a blood-covered knife hidden under his bed. Does that not seem a bit suspicious?"],
      ["N", HUDSON_NPC_ID, "A blood-covered knife? We missed that..."],
      ["N", HUDSON_NPC_ID, "Still, it's hardly proof of anything. We haven't found any real link between him and the victim, nor do we have any more information on the odd symbols."],
      ["N", HUDSON_NPC_ID, "However, I would say we have enough reason to take him in for questioning. I'll have the corporals arrange it..."],
      ["S", "A cutscene begins. Sergeant Hudson and the player approach Betty."],
      ["N", HUDSON_NPC_ID, "Right, I think we've done all we need to here. Someone will be out soon to take care of your father's body. In the meantime, Betty, do you have anywhere else you can go?"],
      ["N", BETTY_NPC_ID, "To my uncle's south of Hosidius, but... is that it? You're not going to do anything else?"],
      ["N", HUDSON_NPC_ID, "We'll continue our investigation back at the Shayzien Administration. We have some leads to explore and a person of interest to question further. We'll let you know if we learn anything."],
      ["N", BETTY_NPC_ID, "And in the meantime, the killer gets to remain loose?! What if they come back?! What if I'm next?!"],
      ["N", HUDSON_NPC_ID, "I promise you, we don't want a killer out there any longer than they need to be. We will find them, Betty. You have my word."],
      ["N", HUDSON_NPC_ID, "For now, if you're feeling unsafe, I can arrange for you to have some protection."],
      ["N", BETTY_NPC_ID, "Protection? From you? I know what you people are like. Father told me more than a few stories about the 'honourable' Shayzien Constabulary..."],
      ["N", BETTY_NPC_ID, "No. You people can't protect me. I'll be better off on my own."],
      ["N", HUDSON_NPC_ID, "I'm sorry you feel that way. Will you at least allow me to arrange an escort to take you to your uncle's home?"],
      ["N", BETTY_NPC_ID, "No... I'll make my own way there... after I've properly said goodbye to my father."],
      ["N", HUDSON_NPC_ID, "If you're sure... Take care of yourself, Betty. We'll be in touch soon."],
      ["S", "The cutscene ends."],
      ["P", "Would you like me to take you to Hosidius?"],
      ["N", BETTY_NPC_ID, "No. Thank you, but I'd like some time alone. A quiet walk is the sort of thing I need. But..."],
      ["P", "What is it?"],
      ["N", BETTY_NPC_ID, "I shouldn't ask any more of you... but I just don't trust the authorities to see this through. Could you meet me at my uncle's house? I want to talk through everything a bit more."],
      ["P", "Of course. It's not a problem."],
      ["N", BETTY_NPC_ID, "Thank you. My uncle lives south of the city itself, just north west of the Tithe Farm. I'll meet you there."],
      ["A", () => setStage(player, STAGE_UNCLE)],
    ]);
  }

  function talkCorporal(npcId, name) {
    return (event) => {
      const { player } = event;
      if (event.npcId !== npcId) return false;
      const stage = stageOf(player);
      if (stage === 0) {
        say(player, npcId, [["P", "What's going on here?"], ["N", "There's been a murder. No need to worry though, we're here to get to the bottom of it."]]);
      } else if (stage === STAGE_STARTED) {
        say(player, npcId, [
          ["P", "What's going on here?"],
          ["N", "There's been a murder. No need to worry though, we're here to get to the bottom of it."],
          ["P", "Anything I can help with?"],
          ["N", "We have things under control. That said, if you think you can contribute, you might want to speak to Sergeant Hudson. He's in charge here."],
        ]);
      } else if (stage >= STAGE_SHAYZIEN && stage <= STAGE_SHAYZIEN_DONE) {
        say(player, npcId, npcId === BREIMAN_NPC_ID
          ? [["N", "Sorry, but I do need to keep an eye on you. Sergeant's orders."], ["P", "Fair enough."]]
          : [["N", "If it's any consolation, friend, I don't think you're guilty. Hopefully you understand that we can't be too careful though."], ["P", "I understand, and thank you."]]);
      } else if (stage >= STAGE_PERMITTED && stage <= STAGE_REPORT) {
        (npcId === BREIMAN_NPC_ID ? permittedBreiman : permittedCampter)(player);
      } else {
        return false;
      }
      return true;
    };
  }

  function permittedBreiman(player) {
    say(player, BREIMAN_NPC_ID, [
      ["N", "How goes it? You're the one doing some of your own investigating, right?"],
      ["P", "That's right."],
      ["N", "Pleased to meet you. I'm Corporal Michael Breiman. I work with Corporal Campter and Sergeant Hudson."],
      ["P", "And you guys at the ones who investigate things like this?"],
      ["N", "Like murder? Yup, that's our domain. Very cheery."],
      ["N", "We work for the Shayzien Constabulary. It's part of the Shayzien Military. We investigate crimes all across the kingdom."],
      ["P", "I see. What are your thoughts so far?"],
      ["N", "Well, it's still a bit early to suggest too much. That said, this one doesn't look good."],
      ["P", "Do any murders look good?"],
      ["N", "Well... No, but this one could be particularly nasty. You see, there are generally three kinds of murder."],
      ["N", "First, you've got your petty crime that gets out of hand. Thievery and the like. From time to time, a thief ends up biting off more than they can chew, and the victim fights back."],
      ["N", "Both parties panic in that situation, and it sometimes ends badly."],
      ["N", "Then you've got your domestic violence. An argument breaks out between the victim and someone close to them and it spirals out of control. It's by far the most common type of murder we see."],
      ["N", "Now, the thing about those first two is that the killer never sets out to kill someone. One thing leads to another and then there's a body on the floor. That's what's so dangerous about the third kind."],
      ["N", "You see, with the third kind of murder, the killer wants the victim dead. They plan for it, sometimes for months. They set out with the intention of ending someone's life."],
      ["P", "And you think that's what we're dealing with here?"],
      ["N", "It definitely looks that way. Our victim here was a bit of a public figure before he retired. I even remember hearing stories about him when I was a kid."],
      ["N", "That, combined with the lovely decoration on the wall, and the way the victim's been dismembered... Well, it doesn't paint a good picture..."],
      ["N", "Anyway, I'll let you get on with your investigation. If you need anything, just let me or my partner know. She should be outside somewhere."],
      ["P", "Will do. Thanks."],
    ]);
  }

  function permittedCampter(player) {
    say(player, CAMPTER_NPC_ID, [
      ["P", "Hello there."],
      ["N", "Hello, citizen. I hear you're going to be doing some investigating with us."],
      ["P", "That's right. Not that your boss seemed very happy about it."],
      ["N", "Ah, don't worry about him. He can be a bit short with people sometimes. It's how he is when he's in his thinking mode."],
      ["P", "Thinking mode?"],
      ["N", "That's right. He's the brains of the operation you see. I'm Corporal Sarah Campter. It's my job, along with my partner, to gather up any evidence and interview the witnesses."],
      ["N", "Once we've done that, we present it to the Sergeant and he pieces it all together. He's caught more killers than you could count!"],
      ["P", "I see. So, any tips for my investigation?"],
      ["N", "Well, when it comes to murder, there are a few things we generally look at. First, there's the body itself. Determining the cause of death is a good start for any investigation."],
      ["N", "After that, there's searching the crime scene, or any other areas of interest. We look for anything the killer might have left behind, but also possible hints at a motive that could be hidden amongst the victim's possessions."],
      ["N", "Finally, the witnesses. We'll interview anyone who we think might have seen something, or who might have had contact with the victim before their death. Neighbours... family... Those kinds of people,"],
      ["N", "They can often fill in critical gaps in the evidence, but be careful. Even when not guilty, people have a habit of telling lies."],
      ["P", "I see. Thanks for the help."],
      ["N", "Don't mention it. If you need anything else, my partner should be over in the house. He might have some useful information for you."],
    ]);
  }

  // --- the Land's End witnesses ---------------------------------------------------------------

  function inInvestigation(player) {
    const stage = stageOf(player);
    return stage >= STAGE_PERMITTED && stage <= STAGE_REPORT;
  }

  function talkHugor(event) {
    const { player, npcId } = event;
    if (npcId !== HUGOR_NPC_ID || !inInvestigation(player)) return false;
    play(player, [
      ["N", HUGOR_NPC_ID, "Got any *hic* wine?"],
      ["P", "No... But I did want to ask you some questions about the murder that happened up the road."],
      ["N", HUGOR_NPC_ID, "Ah, yeah... *hic* Go on then."],
      ["A", () => questionMenu(player, HUGOR_NPC_ID, "hugor", [
        ["What do you know about the victim?", [
          ["P", "What do you know about the victim?"],
          ["N", "*hic* Jack Holland! That was his name. Older *hic* chap. Lived here a long time with his daughter, Betty."],
          ["P", "And did you know him well?"],
          ["N", "Well? No I don't think he *hic* is very well. Someone killed him!"],
          ["P", "Yes, I'm aware. I meant 'well' as in 'familiar'."],
          ["N", "Oh! No not really. He was a *hic* private sort. Never looked happy really. Probably could have done with having a bit of wine."],
        ]],
        ["Did you see or hear anything around the time of the murder?", [
          ["P", "Did you see or hear anything around the time of the murder?"],
          ["N", "That I did! I was just pouring myself a bit of *hic* wine, when I heard someone shout something."],
          ["P", "What was it?"],
          ["N", "Oh... er... I think it was... 'You!'"],
          ["P", "Hmm... Interesting..."],
        ], () => setFlag(player, "hugorAlibi")],
        ["Do you know why someone would want the victim dead?", [
          ["P", "Do you know why someone would want the victim dead?"],
          ["N", "No, I don't *hic* think so. I didn't know him too well though."],
        ]],
      ])],
    ]);
    return true;
  }

  function talkLan(event) {
    const { player, npcId } = event;
    if (npcId !== LAN_NPC_ID || !inInvestigation(player)) return false;
    const questions = [
      ["What do you know about the victim?", [
        ["P", "What do you know about the victim?"],
        ["N", "Well... er... he didn't used to live 'ere all the time. I think this was his holiday home or somethin' like that. Then 'bout ten years ago he moved here permanently."],
        ["P", "And you were living here back then as well?"],
        ["N", "Yup. I've been runnin' me butchers here for a long time. A long time indeed..."],
        ["P", "You must have interacted with each other quite a bit then in that time?"],
        ["N", "Nope. He kept 'imself to 'imself. I like to do the same. It's nice an' peaceful here. No disturbances. You can get on with things without people botherin' you."],
        ["P", "Business must be slow if you're running a butchers in a quiet place like this. Especially given you don't seem to have much product around..."],
        ["N", "Heh! I don't keep it up here, do I? It's all down in the basement. I keep it there, that I do."],
        ["P", "What basement?"],
        ["N", "..."],
        ["P", "..."],
        ["N", "..."],
        ["P", "Maybe I should take a look around..."],
      ], () => setFlag(player, "butcherQuestioned")],
      ["Did you see or hear anything around the time of the murder?", [
        ["P", "Did you see or hear anything around the time of the murder?"],
        ["N", "Nope. I was sleepin'. Guess that's what he's doing now, heh!"],
        ["P", "You find murder funny?"],
        ["N", "No... Was just sayin', I was..."],
      ]],
      ["Do you know why someone would want the victim dead?", [
        ["P", "Do you know why someone would want the victim dead?"],
        ["N", "Maybe his daughter killed him 'cause he was snoring too loud?"],
        ["P", "That doesn't seem likely..."],
        ["N", "No? It's a very small house for two people. I wouldn't blame her if she'd got a bit sick of 'im."],
        ["P", "So you can't think of any actual reason why someone would want him dead?"],
        ["N", "Nope. I think he was some big important somebody up in Shayzien once, but that was a long time ago. By the end he was just a nobody. Forgotten. Just like the rest of us..."],
      ]],
    ];
    if (hasFlag(player, "knife")) {
      questions.push(["I found this knife under your bed...", [
        ["P", "I found this knife under your bed..."],
        ["S", "You show the knife to Lan."],
        ["N", "Hey, that's my knife! I've been lookin' for that for a long while... A very long while indeed."],
        ["P", "Why does it have blood on it?"],
        ["N", "From the meat."],
        ["P", "I see..."],
      ]]);
    }
    play(player, [
      ["N", LAN_NPC_ID, "What d'ya want?"],
      ["P", "I'm looking into the murder that happened just up the road. I wanted to ask you a few questions."],
      ["N", LAN_NPC_ID, "Oh... I guess tha's okay..."],
      ["A", () => questionMenu(player, LAN_NPC_ID, "lan", questions)],
    ]);
    return true;
  }

  // --- Hosidius witnesses ---------------------------------------------------------------------

  function hosidiusWitness(npcId, key, questions, farewell) {
    return (event) => {
      const { player } = event;
      if (event.npcId !== npcId || stageOf(player) < STAGE_BASEMENT || stageOf(player) > STAGE_CLUES) return false;
      play(player, [
        ["P", "Hello there. I was wondering if I could ask you some questions?"],
        ["N", npcId, npcId === MONK_NPC_ID ? "Go ahead, my child." : "Questions? Yes, I suppose so."],
        ["A", () => questionMenu(player, npcId, key, questions, farewell)],
      ]);
      return true;
    };
  }

  const talkMonk = hosidiusWitness(MONK_NPC_ID, "monk", [
    ["Do you know anything about the person who lives in this house?", [
      ["P", "Do you know anything about the person who lives in this house?"],
      ["N", "Ah, you mean that blaspheming dissident! He is not someone worth knowing about, but alas, I have had the misfortune of interacting with him."],
      ["P", "Okay, there's clearly a story here."],
      ["N", "That there is, my child. I am from the nearby camp of peaceful monks. We spend our days dedicating ourselves to Saradomin, and sometimes spreading his teachings across the kingdom."],
      ["N", "I regularly travel around here, sharing the word of our holy lord. That is what I am doing right now, in fact, and it was what I was doing when he came and confronted me."],
      ["P", "What did he confront you about?"],
      ["N", "He said I had no business spreading the word of Saradomin anywhere near his home. He said it was an affront to his order, whatever that means. He then threatened to get violent if I did it again!"],
      ["P", "I see..."],
    ], (player) => setFlag(player, "strangerInfo")],
    ["Have you seen anything odd around here lately?", [
      ["P", "Have you seen anything odd around here lately?"],
      ["N", "No, I don't think so. Everything has been nice and quiet."],
      ["P", "No one acting suspicious at all? Or even just someone you didn't recognise?"],
      ["N", "No one at all. I'm very good at remembering people. It's an important part of my work."],
      ["P", "I see. Fair enough."],
    ]],
  ], "Saradomin be with you.");

  const talkJoyce = hosidiusWitness(JOYCE_NPC_ID, "joyce", [
    ["Do you know anything about the person who lives in that house?", [
      ["P", "Do you know anything about the person who lives in that house?"],
      ["N", "Aye, that's the home of Bernard Holland. He's not the most social of people, but he's normally friendly enough. Always says hello when he heads out to tend to his onions."],
      ["P", "So he's a farmer as well then?"],
      ["N", "Not like we are. I think for him it's more of a hobby. I seem to recall that he didn't always live around here. Shayzien is where he used to be from I think."],
    ], (player) => setFlag(player, "uncleJob")],
    ["Have you seen anything odd around here lately?", [
      ["P", "Have you seen anything odd around here lately?"],
      ["N", "Odd? Like what?"],
      ["P", "Maybe someone new passing through and acting suspicious, or something like that."],
      ["N", "Someone new? We don't get many new people coming through here. We're nice and out of the way. Typically it's just people heading past to go to the Tithe Farm."],
    ]],
  ]);

  // --- Land's End and Hosidius objects ---------------------------------------------------------

  const inHouse = (player) => {
    const here = player.getLocation();
    return here.getX() >= HOUSE.minX && here.getX() <= HOUSE.maxX && here.getY() >= HOUSE.minY && here.getY() <= HOUSE.maxY;
  };
  const give = (player, itemId) => player.getInventory().forceAdd(player, new api.core.Item(itemId, 1));
  const holds = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const nothing = (player, text) => player.sendMessage(text);

  /** A four-way body inspection menu; `parts` maps a label to [text, itemId?, action?], then returns to the menu. */
  function inspectBody(player, parts) {
    const options = parts.map(([label, text, icon, action]) => [label, () => play(player, [
      icon ? ["I", icon, text] : ["S", text],
      ["A", () => { if (action) action(); else inspectBody(player, parts); }],
    ])]);
    options.push(["Nothing.", null]);
    play(player, [["O", "What would you like to do?", options]]);
  }

  function inspectJack(player) {
    const parts = [
      ["Inspect the head.", "You inspect the victim's head. His eyes are wide open and are looking towards the wall by the door."],
      ["Inspect the arms.", "You inspect the victim's arms. They are coated in blood and both hands have been removed.", null, () => { setFlag(player, "hands"); inspectBody(player, parts); }],
      ["Inspect the torso.", "You inspect the victim's torso. There's a single stab wound to the heart that is almost certainly the cause of death. You also spot a letter, hidden under the victim.", JACKS_LETTER, () => takeLetter(player, parts)],
      ["Inspect the legs.", "You inspect the victim's legs. You don't find anything of note."],
    ];
    inspectBody(player, parts);
  }

  function takeLetter(player, parts) {
    if (flagLevel(player, "letter") >= 2) return inspectBody(player, parts);
    play(player, [["O", "Take the letter?", [
      ["Yes.", () => {
        give(player, JACKS_LETTER);
        setFlag(player, "letter", 2);
        play(player, [["I", JACKS_LETTER, "You take the letter from under the body."], ["A", () => inspectBody(player, parts)]]);
      }],
      ["No.", null],
    ]]]);
  }

  function inspectBernard(player) {
    const parts = [
      ["Inspect the head.", "You can't inspect the victim's head as it has been completely removed."],
      ["Inspect the arms.", "You inspect the victim's arms. Next to one of the hands is a half-drunk bottle of wine. Curiously, the fluid inside appears to have separated in a way that you wouldn't expect from wine."],
      ["Inspect the torso.", "You inspect the victim's torso. There's a single stab wound to the heart that is almost certainly the cause of death."],
      ["Inspect the legs.", "You inspect the victim's legs. The shoes are covered in dirt."],
    ];
    inspectBody(player, parts);
  }

  function bodyOption(event) {
    const { player, objectId } = event;
    const option = String(event.option ?? "").toLowerCase();
    if (BODY_LANDS_END.has(objectId)) {
      if (option === "inspect" && stageOf(player) >= STAGE_PERMITTED) inspectJack(player);
      else if (option === "search") nothing(player, "You search the body, but find nothing of note.");
      else return false;
      return true;
    }
    if (BODY_BASEMENT.has(objectId) && option === "inspect" && stageOf(player) >= STAGE_BASEMENT) {
      inspectBernard(player);
      return true;
    }
    if (BODY_JENSEN.has(objectId) && option === "inspect" && stageOf(player) >= STAGE_ESCAPED && stageOf(player) <= STAGE_CELL_BLOOD) {
      inspectJensen(player);
      return true;
    }
    if (BODY_EDWARDS.has(objectId) && option === "inspect" && stageOf(player) >= STAGE_SHAYZIEN && stageOf(player) <= STAGE_SHAYZIEN_DONE) {
      inspectEdwards(player);
      return true;
    }
    return false;
  }

  function bloodInspect(event) {
    const { player, objectId } = event;
    if (BLOOD_CELL.has(objectId)) return cellBlood(event);
    if (BLOOD_SHAYZIEN.has(objectId)) return shayzienBlood(event);
    if (BLOOD_HIDEOUT.has(objectId)) return hideoutBlood(event);
    if (!BLOOD_LANDS_END.has(objectId) || stageOf(player) < STAGE_PERMITTED) return false;
    player.getPacketSender().sendInterface(BLOOD_LANDS_END_INTERFACE);
    setFlag(player, "wall");
    return true;
  }

  function shelvesSearch(event) {
    const { player, objectId } = event;
    if (objectId === SHELVES_SHAYZIEN) return shayzienShelves(event);
    if (objectId !== SHELVES_LANDS_END || stageOf(player) < STAGE_PERMITTED) return false;
    if (flagLevel(player, "news") < 2) {
      give(player, NEWSPAPER);
      setFlag(player, "news", 2);
    }
    return true;
  }

  function butcherBed(event) {
    const { player, objectId } = event;
    if (objectId === BED_JENSEN) return jensenBed(event);
    if (objectId !== BUTCHER_BED || stageOf(player) < STAGE_PERMITTED) return false;
    if (hasFlag(player, "knife")) {
      nothing(player, "You search the bed, but find nothing of note.");
      return true;
    }
    give(player, BLOODY_KNIFE);
    setFlag(player, "knife");
    play(player, [["I", BLOODY_KNIFE, "You search the bed and find a bloody knife under it."]]);
    return true;
  }

  function doorOpen({ player, objectId }) {
    if (objectId !== FRONT_DOOR && objectId !== BACK_DOOR) return false;
    const stage = stageOf(player);
    if (stage < STAGE_UNCLE || stage >= STAGE_BASEMENT) return false;
    if (!inHouse(player) || flagLevel(player, "foundWindow") < 1) {
      play(player, [["S", "The door is securely locked."]]);
      return true;
    }
    play(player, [
      ["P", "That's the door open. No sign of your uncle though..."],
      ["N", BETTY_NPC_ID, "Maybe he's downstairs... Wait here. I'll go have a look."],
      ["S", "Betty climbs down to the basement."],
      ["N", BETTY_NPC_ID, "No!"],
      ["P", "Betty?!"],
      ["S", "The cutscene ends with the player in the basement, finding a headless body."],
      ["N", BETTY_NPC_ID, "He's... He's..."],
      ["N", BETTY_NPC_ID, "This can't be happening... This can't be happening!"],
      ["P", "We'd better get to Shayzien right away. We need to tell Sergeant Hudson about this."],
      ["N", BETTY_NPC_ID, "What? No!"],
      ["P", "Betty..."],
      ["N", BETTY_NPC_ID, "Don't you see? We can't trust him! We can't trust anyone! No. We need to work out what happened on our own."],
      ["P", "We can't keep the authorities out of this, Betty. But... maybe I could take a look around first. I could at least make sure we know what happened before we speak to them."],
      ["N", BETTY_NPC_ID, "Yes... Do it."],
      ["A", () => {
        player.moveTo(new Location(BASEMENT_ARRIVAL.x, BASEMENT_ARRIVAL.y, 0));
        setStage(player, STAGE_BASEMENT);
      }],
    ]);
    return true;
  }

  function beforeDoor(event) {
    if (event.handled || (event.objectId !== FRONT_DOOR && event.objectId !== BACK_DOOR)) return;
    if (String(event.option ?? "").toLowerCase() !== "open") return;
    if (doorOpen(event) !== false) event.handled = true;
  }

  function windowClimb({ player, objectId }) {
    if (objectId !== WINDOW || stageOf(player) < STAGE_UNCLE || stageOf(player) >= STAGE_BASEMENT) return false;
    const outside = !inHouse(player);
    player.moveTo(new Location(outside ? WINDOW_INSIDE.x : WINDOW_OUTSIDE.x, 3525, 0));
    if (outside) setFlag(player, "foundWindow");
    nothing(player, "You climb through the window.");
    return true;
  }

  function climbUpLadder(event) {
    return basementLadder(event) || hideoutLadder(event);
  }

  /** The house ladder has no counterpart in the map either; while Betty waits in the basement it leads back down to her. */
  function houseLadderDown({ player, objectId }) {
    const stage = stageOf(player);
    if (objectId !== HOUSE_LADDER || stage < STAGE_BASEMENT || stage > STAGE_CLUES) return false;
    api.emitCustomEvent("ladders:climbDown", { player, destination: new Location(BASEMENT_ARRIVAL.x, BASEMENT_ARRIVAL.y, 0) });
    return true;
  }

  /** The basement ladder has no counterpart in the map, so the generic climb needs the destination. */
  function basementLadder({ player, objectId }) {
    const stage = stageOf(player);
    if (objectId !== BASEMENT_LADDER || stage < STAGE_BASEMENT || stage > STAGE_CLUES) return false;
    api.emitCustomEvent("ladders:climbUp", { player, destination: new Location(BASEMENT_EXIT.x, BASEMENT_EXIT.y, 0) });
    return true;
  }

  function compostSearch({ player, objectId }) {
    if (objectId !== COMPOST_BIN || stageOf(player) < STAGE_BASEMENT) return false;
    if (flagLevel(player, "hosidiusHead") >= 1) {
      nothing(player, "You search the compost bin, but all you find is compost.");
      return true;
    }
    give(player, HUMAN_HEAD);
    setFlag(player, "hosidiusHead");
    play(player, [["I", HUMAN_HEAD, "You search the compost bin and find a decapitated head hidden in it."]]);
    return true;
  }

  function bookcaseSearch({ player, objectId }) {
    if (objectId !== BOOKCASE || stageOf(player) < STAGE_BASEMENT) return false;
    if (flagLevel(player, "certificate") >= 2) {
      nothing(player, "You search the bookcase, but find nothing of note.");
      return true;
    }
    give(player, CERTIFICATE);
    setFlag(player, "certificate", 2);
    play(player, [["I", CERTIFICATE, "You search the bookcase and find a certificate."]]);
    return true;
  }

  function readLetter({ player, itemId }) {
    if (itemId === JACKS_LETTER) player.getPacketSender().sendInterface(LETTER_LANDS_END_INTERFACE);
    else if (itemId === BERNARDS_LETTER) player.getPacketSender().sendInterface(LETTER_HOSIDIUS_INTERFACE);
    else return false;
    return true;
  }

  function readNewspaper({ player, itemId }) {
    if (itemId !== NEWSPAPER) return false;
    player.getPacketSender().sendInterface(NEWS_INTERFACE);
    return true;
  }

  function readCertificate({ player, itemId }) {
    if (itemId !== CERTIFICATE) return false;
    player.getPacketSender().sendInterface(CERTIFICATE_INTERFACE);
    return true;
  }

  function inspectKnife({ player, itemId }) {
    if (itemId !== BLOODY_KNIFE) return false;
    play(player, [["I", BLOODY_KNIFE, "It's a sharp knife that's covered in blood."]]);
    return true;
  }

  function inspectHead({ player, itemId }) {
    if (itemId !== HUMAN_HEAD) return false;
    if (flagLevel(player, "hosidiusHead") < 2) {
      give(player, BERNARDS_LETTER);
      setFlag(player, "hosidiusHead", 2);
      play(player, [["I", HUMAN_HEAD, "You take a closer look at the head and notice the tongue is missing. In its place is a letter. You take it."]]);
    } else {
      play(player, [["I", HUMAN_HEAD, "You take a closer look at the head and notice the tongue is missing. In its place is a letter."]]);
    }
    return true;
  }

  // --- Port Piscarilius -----------------------------------------------------------------------

  const inArea = (location, box) => location.getX() >= box.minX && location.getX() <= box.maxX && location.getY() >= box.minY && location.getY() <= box.maxY;
  const inCellStages = (player) => stageOf(player) >= STAGE_CELL && stageOf(player) < STAGE_CELL_BLOOD;

  /** The jail wall: the plank comes out of the north wall (Remove-plank), then the gap is climbed over either way. */
  function cellWall(event) {
    const { player, objectId } = event;
    if (objectId !== CELL_WALL || stageOf(player) < STAGE_CELL || stageOf(player) >= STAGE_DECODE) return false;
    const option = String(event.option ?? "").toLowerCase();
    if (option === "remove-plank") {
      play(player, [["S", "You remove a loose plank to reveal a gap in the wall."], ["A", () => {
        setFlag(player, "plankRemoved");
        if (stageOf(player) === STAGE_CELL) setStage(player, STAGE_ESCAPED);
      }]]);
      return true;
    }
    if (option !== "climb-over") return false;
    nothing(player, "You climb through the gap at the top of the wall.");
    const inside = inArea(player.getLocation(), CELL_AREA);
    player.moveTo(new Location(1787, inside ? 3783 : 3781, 0));
    if (!inside && stageOf(player) === STAGE_JENSEN_DONE) setStage(player, STAGE_CELL_BLOOD);
    return true;
  }

  function inspectJensen(player) {
    const parts = [
      ["Inspect the head.", "You inspect the victim's head. Beneath the helmet, there is a bruise on her forehead and her nose appears to be broken. However, this doesn't appear to have been the cause of death.", null, () => { setFlag(player, "piscHead"); inspectBody(player, parts); }],
      ["Inspect the arms.", "You inspect the victim's arms. You don't find anything of note."],
      ["Inspect the torso.", "You inspect the victim's torso. In spite of the armour she is wearing, there's a single stab wound to the heart that is almost certainly the cause of death. It looks like this was only possible due to the armour not actually being quite on properly.", null, () => { setFlag(player, "piscTorso"); inspectBody(player, parts); }],
      ["Inspect the legs.", "You inspect the victim's legs. They are coated in blood and both feet have been removed.", null, () => { setFlag(player, "piscFeet"); inspectBody(player, parts); }],
    ];
    inspectBody(player, parts);
  }

  function drawersInspect({ player, objectId }) {
    const stage = stageOf(player);
    if (objectId !== DRAWERS_JENSEN || stage < STAGE_PISCARILIUS || stage > 40) return false;
    const menu = () => play(player, [["S", "There is a large amount of blood on top of the drawers."], ["O", "Select an option", [
      ["Inspect the blood.", () => {
        player.getPacketSender().sendInterface(DRAWERS_INTERFACE);
        setFlag(player, "drawersBlood");
      }],
      ["Search the drawers.", () => {
        setFlag(player, "piscDagger");
        play(player, [["S", "You go to search the drawers and notice one is open. There is a dagger inside."], ["A", menu]]);
      }],
      ["Do nothing.", null],
    ]]]);
    menu();
    return true;
  }

  function wardrobeSearch({ player, objectId }) {
    if (objectId !== WARDROBE_JENSEN || stageOf(player) < STAGE_ESCAPED) return false;
    setFlag(player, "piscWardrobe");
    play(player, [["S", "The wardrobe is mostly empty. From the mess inside, it looks like some things were taken from it in a hurry. One of the things still in it is an old pair of Shayzien boots."]]);
    return true;
  }

  function jensenBed({ player, objectId }) {
    if (objectId !== BED_JENSEN || stageOf(player) < STAGE_ESCAPED) return false;
    setFlag(player, "piscBed");
    play(player, [["S", "The bed looks noticeably fancier than any of the other furniture. You notice a carving at the bottom of it: 'We shape the stone. The stone shapes us.'"]]);
    return true;
  }

  function cellBlood({ player, objectId }) {
    if (!BLOOD_CELL.has(objectId) || stageOf(player) < STAGE_CELL_BLOOD || stageOf(player) > STAGE_DECODE) return false;
    player.getPacketSender().sendInterface(BLOOD_CELL_INTERFACE);
    setFlag(player, "cellBlood");
    if (stageOf(player) === STAGE_CELL_BLOOD) setStage(player, STAGE_DECODE);
    return true;
  }

  /** The guards in Jensen's house: standing next to either one sends the player back to the cell (an unconfirmed guess; the Wiki gives no rule). */
  class JensenHouseArea extends Area {
    constructor() { super([new Boundary(JENSEN_HOUSE.minX, JENSEN_HOUSE.maxX, JENSEN_HOUSE.minY, JENSEN_HOUSE.maxY, 0)]); }
    process(actor) {
      if (!actor.isPlayer?.()) return;
      const player = actor.getAsPlayer();
      const stage = stageOf(player);
      if (stage < STAGE_ESCAPED || stage >= STAGE_CELL_BLOOD) return;
      const here = player.getLocation();
      const caught = [TILES.guardOne, TILES.guardTwo].some((guard) => Math.abs(here.getX() - guard.x) <= 1 && Math.abs(here.getY() - guard.y) <= 1);
      if (!caught) return;
      mapOf(player).get("guard-one")?.forceChat?.("Hey! You're meant to be in a cell!");
      player.moveTo(new Location(CELL.x, CELL.y, 0));
      play(player, [["S", "You're spotted and are sent back to the cell in the nearby guardhouse."]]);
    }
  }

  /** The cell blocks teleports (the Wiki message), so the wall is the only way out. */
  class CellArea extends Area {
    constructor() { super([new Boundary(CELL_AREA.minX, CELL_AREA.maxX, CELL_AREA.minY, CELL_AREA.maxY, 0)]); }
    canTeleport(player) {
      if (!inCellStages(player)) return null;
      player.sendMessage("A teleport block has been placed on this cell. You'll need to find another way out.");
      return false;
    }
  }

  // --- Shayzien --------------------------------------------------------------------------------

  /** Hudson at Edwards' house: the question menu, then the "all clues" conversation once everything is found. */
  function shayzienHudson(player, stage) {
    if (stage >= STAGE_SHAYZIEN_DONE) {
      const again = askedOf(player)["hudson:allclues"] === true;
      asked(player, "hudson:allclues");
      const tail = [
        ["P", again ? "I've still not managed to piece things together yet." : "I've found a few potential things of note, but nothing obvious that could lead us to the killer."],
        ["N", again ? "Well, you'd best hope that changes soon." : "Well, you'd best start piecing it all together. We need to work out where the killer is. If we can't, then I needn't remind you that you're still the prime suspect."],
      ];
      const lines = again ? [
        ["P", "I'm very aware... Any help that you'd like to provide?"],
        ["N", "Only what I've already told you. It seems the the killer wants to be found... or at least, they want to prove that we're not smart enough to find them."],
        ["N", "That means they've almost certainly revealed their location to us already. We just need to work out how they've done so. Given their love for symbols and ciphers, it's unlikely to be obvious."],
        ["P", "And if I do manage to work it out?"],
        ["N", "Go there and see if you're right."],
        ["P", "Hmm..."],
      ] : [
        ["P", "And what about you? Are you not going to help with the piecing everything together?"],
        ["N", "I am attempting to do so right now."],
        ["P", "And? Surely you must have some thoughts by now?"],
        ["N", "Some. You yourself said that the killer has been toying with us from the get go. It seems they want to be found... or at least, they want to prove that we're not smart enough to find them."],
        ["N", "That means they've almost certainly revealed their location to us already. We just need to work out how they've done so. Given their love for symbols and ciphers, it's unlikely to be obvious."],
        ["P", "Hmm... And if I do manage to work it out?"],
        ["N", "Go there and see if you're right."],
        ["P", "Alone?"],
        ["N", "Oh, don't worry. We'll be keeping a close eye on you... from a distance."],
        ["P", "You're not planning to use me as bait, are you?"],
        ["N", "That would be against procedure."],
        ["P", "Then what is it you're not telling me?"],
        ["N", "At this point, all manner of things. Once again, you are currently the prime suspect. I don't wish to share any more with you than I need to. If you wish to prove your innocence, the onus is on you."],
        ["P", "Hmm..."],
      ];
      play(player, [["N", HUDSON_NPC_ID, "Yes?"], ...[...tail, ...lines].map(([who, text]) => (who === "P" ? ["P", text] : ["N", HUDSON_NPC_ID, text]))]);
      return;
    }
    play(player, [
      ["N", HUDSON_NPC_ID, "What a mess... Let's hope we can find something here that can lead us to the killer. I needn't remind you that if we can't, then you're still the prime suspect."],
      ["A", () => questionMenu(player, HUDSON_NPC_ID, "hudson-shayzien", [
        ["What can you tell me about the victim?", [
          ["P", "What can you tell me about the victim?"],
          ["N", "Commissioner Edwards. He led the Shayzien Constabulary for years, until he stepped down a couple of years ago. This is where he retired to."],
          ["P", "With a role like that, I'm guessing there are no shortages of possible suspects?"],
          ["N", "No. Every criminal in this kingdom would likely consider Edwards their enemy."],
        ], (who) => setFlag(who, "shayzienVictimInfo")],
        ["Did anything come from questioning that butcher?", [
          ["P", "Did anything come from questioning that butcher?"],
          ["N", "No. All it did was confirm what we already knew. He had no obvious motive, and a butcher being in possession of a knife isn't enough evidence to mean anything."],
        ]],
        ["Did you learn anything of note at the other crime scenes?", [
          ["P", "Did you learn anything of note at the other crime scenes?"],
          ["N", "All manner of things, but none of them have led us to the killer yet."],
          ["P", "Anything you'd care to share?"],
          ["N", "No, but given you've been rather busy yourself, I'm guessing you know everything anyway."],
        ]],
      ], null, "Best I get to it then.")],
    ]);
  }

  function talkKyle(event) {
    const { player, npcId } = event;
    if (npcId !== KYLE_NPC_ID || stageOf(player) < STAGE_SHAYZIEN || stageOf(player) > STAGE_SHAYZIEN_DONE) return false;
    play(player, [
      ["P", "Hello there. Could I ask you some questions about the recent murder?"],
      ["N", KYLE_NPC_ID, "Okay."],
      ["A", () => questionMenu(player, KYLE_NPC_ID, "kyle", [
        ["What do you know about the victim?", [
          ["P", "What do you know about the victim?"],
          ["N", "Old man."],
          ["P", "Did you see much of him?"],
          ["N", "No."],
          ["P", "But you did know him?"],
          ["N", "A little. Seen him picking berries before."],
          ["P", "And that's it?"],
          ["N", "Yup."],
        ]],
        ["Did you see or hear anything around the time of the murder?", [
          ["P", "Did you see or hear anything around the time of the murder?"],
          ["N", "Yup."],
          ["P", "What was it?"],
          ["N", "Person in a hood."],
          ["P", "What were they doing?"],
          ["N", "Running away from the house."],
          ["P", "Anything else you can tell me about them?"],
          ["N", "Slender build."],
        ], (who) => setFlag(who, "shayzienWitness")],
        ["Do you know why someone would want the victim dead?", [
          ["P", "Do you know why someone would want the victim dead?"],
          ["N", "Yup."],
          ["P", "You do?"],
          ["N", "He was important once. Put criminals away... or killed them."],
          ["P", "Anything more specific?"],
          ["N", "No."],
        ]],
      ])],
    ]);
    return true;
  }

  function inspectEdwards(player) {
    const parts = [
      ["Inspect the head.", "You inspect the victim's head. Both of his eyes have been removed.", null, () => { setFlag(player, "shayzienEyes"); inspectBody(player, parts); }],
      ["Inspect the arms.", "You inspect the victim's arms. One of the hands has a fresh cut on it, suggesting the victim tried to fight back.", null, () => { setFlag(player, "shayzienHands"); inspectBody(player, parts); }],
      ["Inspect the torso.", "You inspect the victim's torso. There's a single stab wound to the heart that is almost certainly the cause of death."],
      ["Inspect the legs.", "You inspect the victim's legs. You don't find anything of note."],
    ];
    inspectBody(player, parts);
  }

  function shayzienBlood({ player, objectId }) {
    if (!BLOOD_SHAYZIEN.has(objectId) || stageOf(player) < STAGE_SHAYZIEN || stageOf(player) > STAGE_SHAYZIEN_DONE) return false;
    player.getPacketSender().sendInterface(BLOOD_SHAYZIEN_INTERFACE);
    setFlag(player, "shayzienWall");
    return true;
  }

  function shayzienShelves({ player, objectId }) {
    if (objectId !== SHELVES_SHAYZIEN || stageOf(player) < STAGE_SHAYZIEN || stageOf(player) > STAGE_SHAYZIEN_DONE) return false;
    setFlag(player, "shayzienShelves");
    play(player, [["S", "You search the shelves and find various bottles of wine. You notice one of the bottles has an inscription on it: 'We shape the stone. The stone shapes us.'"]]);
    return true;
  }

  /** The war tent: once the wall is read, walking up to it plays the Wiki's scene and drops the player at Edwards' house. */
  class WarTentArea extends Area {
    constructor() { super([new Boundary(WAR_TENT_AREA.minX, WAR_TENT_AREA.maxX, WAR_TENT_AREA.minY, WAR_TENT_AREA.maxY, 0)]); }
    process(actor) {
      if (!actor.isPlayer?.()) return;
      const player = actor.getAsPlayer();
      if (stageOf(player) !== STAGE_DECODE) return;
      warTentScene(player);
    }
  }

  /** The stage moves on first: the area runs every tick, and a conversation restarted each tick could never finish. */
  function warTentScene(player) {
    setStage(player, STAGE_SHAYZIEN);
    play(player, [
      ["N", HUDSON_NPC_ID, "Going somewhere?"],
      ["P", "Sergeant Hudson! We need to act fast! I think the killer is targeting a Shayzien leader!"],
      ["N", HUDSON_NPC_ID, "You flee one crime scene, arrive at another, then escape imprisonment, but now you expect me to listen to you? Why?"],
      ["P", "I take it you saw the message left in that cell? Betty is missing!"],
      ["N", HUDSON_NPC_ID, "Yes, and right now you're the prime suspect."],
      ["P", "We don't have time for this!"],
      ["S", "Corporal Breiman runs towards Sergeant Hudson."],
      ["N", BREIMAN_NPC_ID, "Sergeant Hudson! Sergeant Hudson!"],
      ["N", HUDSON_NPC_ID, "What is it, Corporal?"],
      ["N", BREIMAN_NPC_ID, "It's not good, Sergeant. The killer has struck again!"],
      ["N", HUDSON_NPC_ID, "Right, take this one to a cell. Make sure it's a bit more secure this time..."],
      ["N", BREIMAN_NPC_ID, "I don't think it was them, Sergeant. A hooded figure was spotted leaving the crime scene, literally just now!"],
      ["N", HUDSON_NPC_ID, "An accomplice then... Sent here to cause a distraction for the killer so they could strike again."],
      ["P", "Sergeant, I know you don't trust me, but you have to believe me! I had nothing to do with any of this. I'm just trying to save Betty!"],
      ["N", HUDSON_NPC_ID, "Then how did you know where the killer would be next?"],
      ["P", "From the letter they left in Land's End. I managed to translate it. They wanted us to know. They've been toying with us the whole time!"],
      ["N", HUDSON_NPC_ID, "You translated the letter? Curious..."],
      ["P", "Please... let me help, Sergeant. We still have a chance to save Betty."],
      ["N", HUDSON_NPC_ID, "Hmm... Very well, but the Corporal here will be keeping a very close eye on you."],
      ["N", HUDSON_NPC_ID, "Who is the victim, Corporal?"],
      ["N", BREIMAN_NPC_ID, "It's... It's the former Commissioner."],
      ["N", HUDSON_NPC_ID, "I see..."],
      ["N", HUDSON_NPC_ID, "Come on then, let's get over there."],
      ["A", () => player.moveTo(new Location(TILES.shayzienArrival.x, TILES.shayzienArrival.y, 0))],
    ]);
  }

  // --- The island, the finale and the reward ---------------------------------------------------

  /** The plant on the island hides the trapdoor to the hideout. */
  function plantInspect({ player, objectId }) {
    if (objectId !== PLANT || stageOf(player) < STAGE_SHAYZIEN_DONE) return false;
    play(player, [["O", "It looks like there's a trapdoor under the plant.", [
      ["Go down it.", () => {
        player.getPacketSender().sendInterfaceRemoval();
        player.moveTo(new Location(HIDEOUT_ARRIVAL.x, HIDEOUT_ARRIVAL.y, 0));
      }],
      ["Leave it.", null],
    ]]]);
    return true;
  }

  /** The hideout ladder has no counterpart in the map (the trapdoor is a plant), so the plugin supplies the exit. */
  function hideoutLadder({ player, objectId }) {
    if (objectId !== HIDEOUT_LADDER || stageOf(player) < STAGE_SHAYZIEN_DONE) return false;
    api.emitCustomEvent("ladders:climbUp", { player, destination: new Location(ISLAND_EXIT.x, ISLAND_EXIT.y, 0) });
    return true;
  }

  function hideoutBlood({ player, objectId }) {
    const stage = stageOf(player);
    if (!BLOOD_HIDEOUT.has(objectId) || stage < STAGE_SHAYZIEN_DONE || stage > STAGE_FINALE) return false;
    player.getPacketSender().sendInterface(HIDEOUT_INTERFACE);
    if (stage >= STAGE_FINALE) return true;
    // The stage moves on first, so closing the conversation cannot strand the player before Hudson.
    setStage(player, STAGE_FINALE);
    play(player, [
      ["N", 16853, "Get up."],
      ["N", BETTY_NPC_ID, "I said get up."],
      ["P", "Betty...? What is this...?"],
      ["N", BETTY_NPC_ID, "You should know what this is... You investigated it. All those clues... and you still couldn't work it out."],
      ["P", "It was... It was you!"],
      ["N", BETTY_NPC_ID, "Of course it was me. Who else could it have been?"],
      ["P", "But... your own father... Why?"],
      ["N", BETTY_NPC_ID, "Because he was a monster! For my entire childhood we lived in fear of him, until the day finally came when my mother decided enough was enough..."],
      ["N", BETTY_NPC_ID, "But he couldn't allow that! He couldn't let her be free. That's why he poisoned her! Her and my sister!"],
      ["N", BETTY_NPC_ID, "Then, with a little help from his Keystone Lodge friends, he had it all covered up!"],
      ["N", BETTY_NPC_ID, "But now, after all these years, it's finally over! They're finally dead! All that remains now, is you."],
      ["P", "Me? Why? I tried to help you!"],
      ["N", BETTY_NPC_ID, "But you never once looked deeper! Don't you see? You're just as big a part of the problem as they were!"],
      ["N", BETTY_NPC_ID, "People like them... the only reason they get away with the things they do is because people like you stand by and let them!"],
      ["N", BETTY_NPC_ID, "You never really cared! You people never do! This was all just a bit of fun to you. But now the fun is over..."],
      ["N", HUDSON_NPC_ID, "Indeed it is."],
      ["S", "The three Shayzien soldiers arrive."],
      ["N", BETTY_NPC_ID, "What...? How?!"],
      ["N", HUDSON_NPC_ID, "By following the clues, Betty. Isn't that what you wanted?"],
      ["N", BETTY_NPC_ID, "But you never even cared!"],
      ["N", HUDSON_NPC_ID, "Oh I very much did. That's why one of the first things I did was look into the death of your mother and sister. The investigation into their deaths was quite thorough..."],
      ["N", HUDSON_NPC_ID, "The conclusion? An illness. One so tragic, the surviving daughter never fully recovered. She spent years in care, but eventually her father decided to bring her home."],
      ["N", HUDSON_NPC_ID, "He was advised against it. She was unpredictable. Sometimes even violent. But he insisted."],
      ["N", BETTY_NPC_ID, "You're lying!"],
      ["N", HUDSON_NPC_ID, "The people you killed were innocent, Betty. No one is to blame for what happened to your mother and sister. You've just never been able to accept that."],
      ["N", HUDSON_NPC_ID, "Now, I think it's time to bring this madness to an end. You're coming with us, Betty."],
      ["N", BETTY_NPC_ID, "So you can execute me in front of a cheering crowd? Or lock me in a cell to live the rest of my life with no sunlight and a diet of mouldy bread? No. This ends here!"],
      ["S", "Betty stabs herself and dies."],
      ["N", HUDSON_NPC_ID, "*sigh*"],
      ["N", HUDSON_NPC_ID, "Come on, adventurer, let's get you out of here. Corporals... get started on cleaning up here."],
      ["S", "The cutscene ends."],
    ]);
    return true;
  }

  /** Hudson after the finale: the last conversation, then the reward. */
  function finaleHudson(player) {
    play(player, [
      ["N", HUDSON_NPC_ID, "Well... This one is going to have some paperwork to deal with..."],
      ["P", "When did you realise?"],
      ["N", HUDSON_NPC_ID, "Hmm?"],
      ["P", "That it was Betty."],
      ["N", HUDSON_NPC_ID, "She was a prime suspect from the start. Such is always the case when dealing with a murder. In the vast majority of cases, the killer and the victim know each other."],
      ["N", HUDSON_NPC_ID, "As for when I knew for sure, I had a strong hunch, but it was just that until you led us to her."],
      ["P", "It would have been nice of you to tell me..."],
      ["N", HUDSON_NPC_ID, "Yes, it would have been, but through your own choices, you made yourself a suspect as well. It's nothing personal, but that is the way of things I'm afraid."],
      ["P", "I suppose..."],
      ["N", HUDSON_NPC_ID, "If it makes you feel better, your work did end up being useful. You found a couple of things we missed, and you did a good job piecing everything together."],
      ["N", HUDSON_NPC_ID, "I can't offer you much as thanks, but I do have an amulet here that might be useful to you."],
      ["N", HUDSON_NPC_ID, "Now, I'd best get to work. We have a lot of tidying up to do. All the best, adventurer."],
      ["S", "Sergeant Hudson departs."],
      ["A", () => {
        if (stageOf(player) === STAGE_FINALE) quest.complete(player);
      }],
    ]);
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.AGILITY, 2500);
    skills.addExperiences(Skill.THIEVING, 2500);
    syncNpcs(player);
  }

  /** Hudson at the Shayzien Administration after the quest: Transcript:Sergeant Hudson. */
  function postQuestHudson(player) {
    const menu = () => play(player, [["O", "Select an option", [
      ["How are things going?", () => play(player, [
        ["P", "How are things going?"],
        ["N", HUDSON_NPC_ID, "Well, this is Kourend, so there's never any shortage of work to be doing. We've had three murders in the past couple of days alone."],
        ["P", "Any interesting ones?"],
        ["N", HUDSON_NPC_ID, "Like the Betty case? No, just a few robberies gone wrong in Piscarilius."],
        ["P", "Maybe I could help you out with one of them?"],
        ["N", HUDSON_NPC_ID, "Thank you for the offer, but I think it would be best if you left the investigating to us this time."],
        ["P", "Fair enough."],
        ["A", menu],
      ])],
      ["Could I have another amulet?", () => anotherAmulet(player, menu)],
      ["I'd best get going.", () => say(player, HUDSON_NPC_ID, [["P", "I'd best get going."]])],
    ]]]);
    play(player, [["N", HUDSON_NPC_ID, "Adventurer."], ["A", menu]]);
  }

  function anotherAmulet(player, back) {
    const inventory = player.getInventory();
    const lead = [["P", "Could I have another amulet?"], ["N", HUDSON_NPC_ID, "You can, but it will cost you 1,500 coins."]];
    if (inventory.getAmount(ItemIdentifiers.COINS) < AMULET_PRICE) {
      play(player, [...lead, ["P", "Ah, I don't have enough on me. Never mind."], ["A", back]]);
    } else if (inventory.getFreeSlots() < 1 && inventory.getAmount(ItemIdentifiers.COINS) > AMULET_PRICE) {
      play(player, [...lead, ["P", "Ah, I don't have enough space to carry it. Never mind."], ["A", back]]);
    } else {
      play(player, [...lead, ["O", "Pay 1,500 coins for an amulet of sight?", [
        ["Yes.", () => {
          if (inventory.getAmount(ItemIdentifiers.COINS) < AMULET_PRICE) return;
          inventory.deleteNumber(ItemIdentifiers.COINS, AMULET_PRICE);
          give(player, AMULET_OF_SIGHT);
          play(player, [["P", "Sounds good to me."], ["I", AMULET_OF_SIGHT, "You give Sergeant Hudson 1,500 coins and he gives you an amulet of sight in return."], ["P", "Thanks!"], ["A", () => postQuestHudson(player)]]);
        }],
        ["No.", () => play(player, [["P", "I think I'll pass."], ["N", HUDSON_NPC_ID, "Very well."], ["A", () => postQuestHudson(player)]])],
      ]]]);
    }
  }

  // --- journal --------------------------------------------------------------------------------

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) return ["<str>Betty Holland was the killer. She took her own life when the Shayzien Constabulary found her.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    if (stage >= STAGE_FINALE) return ["<str>I found the killer's hideout.</str>", "", "I should talk to <col=800000>Sergeant Hudson</col>."];
    if (stage >= STAGE_SHAYZIEN_DONE) return ["<str>I searched the former Commissioner's house.</str>", "", "The killer wants to be found. I need to work out where they are, and", "go there."];
    if (stage >= STAGE_SHAYZIEN) return ["<str>Sergeant Hudson let me look at the crime scene.</str>", "", "I should search <col=800000>Commissioner Edwards' house</col> in the Shayzien Encampment and", "talk to <col=800000>Kyle</col>."];
    if (stage >= STAGE_DECODE) return ["<str>I found Betty gone and a message on the cell wall.</str>", "", "I should decode the letter and go to the <col=800000>War Tent</col> in the", "<col=800000>Shayzien Encampment</col>."];
    if (stage >= STAGE_CELL_BLOOD) return ["<str>I searched Captain Jensen's house.</str>", "", "Betty is gone. I should read the message on the <col=800000>cell wall</col>."];
    if (stage >= STAGE_JENSEN_DONE) return ["<str>I searched Captain Jensen's house.</str>", "", "I should return to the <col=800000>cell</col>."];
    if (stage >= STAGE_ESCAPED) return ["<str>I removed a plank from the cell wall.</str>", "", "I need to search <col=800000>Captain Jensen's house</col>, the north-westernmost house in", "<col=800000>Port Piscarilius</col>, without being seen by the guards."];
    if (stage >= STAGE_PISCARILIUS) return ["I went to Port Piscarilius with Betty and we were arrested.", "", "I need to find a way out of the <col=800000>cell</col>."];
    if (stage >= STAGE_CLUES) return ["<str>I found clues at Betty's uncle's house.</str>", "", "I should go with Betty to <col=800000>Port Piscarilius</col> to see Captain Jensen."];
    if (stage >= STAGE_UNCLE) return ["<str>I told Sergeant Hudson what I found.</str>", "", "I need to meet <col=800000>Betty</col> at her uncle's house, north west of the", "<col=800000>Tithe Farm</col>, and look for clues."];
    if (stage >= STAGE_REPORT) return ["I have found what I can at <col=800000>Land's End</col>.", "", "I should tell <col=800000>Sergeant Hudson</col> what I found."];
    if (stage >= STAGE_PERMITTED) return ["<col=800000>Sergeant Hudson</col> has let me look around the house at <col=800000>Land's End</col>.", "", "I should inspect the body, search the house and talk to the neighbours."];
    if (stage >= STAGE_STARTED) return ["<col=800000>Betty</col>'s father has been murdered. I should speak to", "<col=800000>Sergeant Hudson</col> to get permission to investigate."];
    return ["I can start this quest by speaking to <col=800000>Betty</col> at", "<col=800000>Land's End</col>.", "", "I need level 22 Agility and level 20 Thieving (not boostable)."];
  }

  function handleLogin({ player }) {
    sendFlags(player);
    refreshQuestList(player);
    syncNpcs(player);
  }

  quest = registerQuest(api, {
    key: "writings_on_the_wall",
    name: "The Writing's on the Wall",
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.AGILITY.getIndex(), amount: 2500, label: "Agility" },
      { skillId: Skill.THIEVING.getIndex(), amount: 2500, label: "Thieving" },
    ],
    buildJournal,
    rewardItemId: AMULET_OF_SIGHT,
    rewardItemLabel: "An amulet of sight",
    onReward: grantReward,
  });

  api.persistAttribute(FLAGS_ATTRIBUTE, {});
  api.persistAttribute(ASKED_ATTRIBUTE, {});

  api.onNpcInteraction("Betty", { "Talk-to": talkBetty });
  api.onNpcInteraction("Sergeant Hudson", { "Talk-to": talkHudson });
  api.onNpcInteraction("Corporal Breiman", { "Talk-to": talkCorporal(BREIMAN_NPC_ID) });
  api.onNpcInteraction("Corporal Campter", { "Talk-to": talkCorporal(CAMPTER_NPC_ID) });
  api.onNpcInteraction("Hugor", { "Talk-to": talkHugor });
  api.onNpcInteraction("Lan the Butcher", { "Talk-to": talkLan });
  api.onNpcInteraction("Monk", { "Talk-to": talkMonk });
  api.onNpcInteraction("Joyce", { "Talk-to": talkJoyce });
  api.onNpcInteraction("Kyle", { "Talk-to": talkKyle });
  api.onObjectInteraction("Dead Body", { Inspect: bodyOption, Search: bodyOption });
  api.onObjectInteraction("Blood", { Inspect: bloodInspect });
  api.onObjectInteraction("Shelves", { Search: shelvesSearch });
  api.onObjectInteraction("Bed", { Search: butcherBed });
  // The generic door handler would open these doors first, so the quest answers before the named hooks run.
  api.onBeforeObjectInteraction(beforeDoor);
  api.onObjectInteraction("Window", { "Climb-through": windowClimb });
  api.onObjectInteraction("Ladder", { "Climb-up": climbUpLadder });
  api.onObjectInteraction("Ladder", { "Climb-down": houseLadderDown });
  api.onObjectInteraction("Plant", { Inspect: plantInspect });
  api.onObjectInteraction("Compost Bin", { Search: compostSearch });
  api.onObjectInteraction("Wall", { "Remove-plank": cellWall, "Climb-over": cellWall });
  api.onObjectInteraction("Drawers", { Inspect: drawersInspect });
  api.onObjectInteraction("Wardrobe", { Search: wardrobeSearch });
  api.registerArea(new JensenHouseArea());
  api.registerArea(new CellArea());
  api.registerArea(new WarTentArea());
  api.onObjectInteraction("Bookcase", { Search: bookcaseSearch });
  api.onItemAction("Letter", { Read: readLetter });
  api.onItemAction("Newspaper cutting", { Read: readNewspaper });
  api.onItemAction("Certificate", { Read: readCertificate });
  api.onItemAction("Bloody knife", { Inspect: inspectKnife });
  api.onItemAction("Human head", { Inspect: inspectHead });
  api.onPlayerLogin(handleLogin);
};

/** Every tile the plugin moves a player to (z 0), so the test can check each against the map's collision. */
module.exports.MOVE_TO_TILES = Object.freeze({
  cell: [1788, 3781], cellInside: [1787, 3781], cellOutside: [1787, 3783],
  basementArrival: [1749, 9936], houseExit: [1785, 3524],
  windowInside: [1784, 3525], windowOutside: [1782, 3525],
  shayzienArrival: [1451, 3638],
  hideoutArrival: [1623, 9934], islandExit: [1617, 3584],
});
