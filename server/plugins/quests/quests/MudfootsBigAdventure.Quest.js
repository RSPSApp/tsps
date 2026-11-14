/**
 * Mudfoot's Big Adventure (free-to-play quest, 3 November 2026, cache revision 242, 1 Quest Point).
 *
 * Sources: the OSRS Wiki quest page and Transcript:Mudfoot's Big Adventure / Transcript:Captain
 * Harlan (raw wikitext), and the revision 242 cache. The generated npc-dialogues export has no
 * transcript for Captain Harlan or Mudfoot, so the conversations are replayed here from the
 * Wiki transcript, as Daddy's Home does. The Wiki marks the transcript incomplete (walking away
 * from the quest area, dismissing Mudfoot, confronting outlaws without him, the stab-fight
 * overhead and the first Harlan combat-weapon lines); those cases are not invented here.
 *
 * Cache facts (dbrow 17230 `quest_mudfootsbigadventure`, gamevals):
 *   - quest id 218, start NPC captain_harlan (16821), completion value 32;
 *   - the stage is varbit `mba` (16779, bits 0-8 of varp `mba_primary` 6240); the same varp holds
 *     captain_harlan_intro (16780), captain_harlan_met_mudfoot_early (16783) and the three
 *     weapon-giveaway flags captain_harlan_bonus_melee/ranged/magic_giveaway (16784/16786/16787);
 *   - the cache's NPC transforms key the visible outlaws on the `mba` value: the ranger outlaw at
 *     the general store shows at 6, at the windmill at 10-12, the mage at 14-18 and the warrior at
 *     20-24. The stage numbers below sit inside those windows; the values between them are this
 *     server's choice, because the cache does not name them.
 *
 * Stages: 0 not started, 1 sent to Mudfoot, 6 Mudfoot recruited (ranger outlaw outside the
 * store), 10 at the windmill, 11 ranger fight, 14 to the mage (ranger dead), 16 mage fight, 20 to
 * the warrior (mage dead), 22 warrior fight, 26 report to Harlan (warrior dead), 32 complete. A
 * kill moves the stage on at once; a fight stage respawns its outlaw on login.
 *
 * Not reproduced: the "Confront" cutscene (played as dialogue), Mudfoot's own attacks (he only
 * talks), the warrior outlaw's Protect from Melee, and the Wiki's per-style overheads from Mudfoot.
 * NPC tiles come from the Wiki quest map pins and are approximate.
 */
module.exports = function registerMudfootsBigAdventureQuest(api) {
  const {
    ActionDialogue,
    DialogueChainBuilder,
    EndDialogue,
    Item,
    ItemDefinition,
    ItemIdentifiers,
    ItemOnGroundManager,
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
  const HARLAN_NPC_ID = NpcIdentifiers.CAPTAIN_HARLAN; // 16821 captain_harlan
  const MUDFOOT_NPC_ID = NpcIdentifiers.MUDFOOT; // 16829 mba_mudfoot_vis
  const MUDFOOT_SPEAR_NPC_ID = NpcIdentifiers.MUDFOOT_2; // 16830 mba_mudfoot_spear_vis
  const RANGER_VIS_NPC_ID = NpcIdentifiers.OUTLAW_15; // 16835 mba_outlaw_ranged_vis ("Confront")
  const RANGER_NOOP_NPC_ID = NpcIdentifiers.OUTLAW_16; // 16836 mba_outlaw_ranged_noop_vis (windmill, no options)
  const RANGER_COMBAT_NPC_ID = NpcIdentifiers.OUTLAW_17; // 16837 mba_outlaw_ranged_combat
  const MAGE_VIS_NPC_ID = NpcIdentifiers.OUTLAW_18; // 16839 mba_outlaw_magic_vis
  const MAGE_COMBAT_NPC_ID = NpcIdentifiers.OUTLAW_19; // 16840 mba_outlaw_magic_combat
  const WARRIOR_VIS_NPC_ID = NpcIdentifiers.OUTLAW_20; // 16842 mba_outlaw_melee_vis
  const WARRIOR_COMBAT_NPC_ID = NpcIdentifiers.OUTLAW_21; // 16843 mba_outlaw_melee_combat
  const ANTIQUE_LAMP_ITEM_ID = ItemIdentifiers.ANTIQUE_LAMP_44; // 34751 mba_lamp

  const STAGE_VARBIT = 16779;
  const HARLAN_INTRO_VARBIT = 16780;
  const MET_MUDFOOT_EARLY_VARBIT = 16783;
  const MELEE_GIVEAWAY_VARBIT = 16784;
  const RANGED_GIVEAWAY_VARBIT = 16786;
  const MAGIC_GIVEAWAY_VARBIT = 16787;

  const STAGE_SENT = 1;
  const STAGE_RECRUITED = 6;
  const STAGE_WINDMILL = 10;
  const STAGE_RANGER_FIGHT = 11;
  const STAGE_TO_MAGE = 14;
  const STAGE_MAGE_FIGHT = 16;
  const STAGE_TO_WARRIOR = 20;
  const STAGE_WARRIOR_FIGHT = 22;
  const STAGE_REPORT = 26;
  const STAGE_COMPLETE = 32;

  const ATTRIBUTE_PREFIX = "mudfoots-big-adventure:";
  const WAITING_ATTRIBUTE = `${ATTRIBUTE_PREFIX}mudfoot-waiting`;
  const HARLAN_MET_ATTRIBUTE = `${ATTRIBUTE_PREFIX}harlan-met`;
  const MET_EARLY_ATTRIBUTE = `${ATTRIBUTE_PREFIX}harlan-met-with-mudfoot`;
  const GIVEAWAYS_ATTRIBUTE = `${ATTRIBUTE_PREFIX}giveaways`;
  const LAST_CLAIM_ATTRIBUTE = `${ATTRIBUTE_PREFIX}last-claim`;
  const GIVEAWAY_MELEE = 1;
  const GIVEAWAY_RANGED = 2;
  const GIVEAWAY_MAGIC = 4;
  const CLAIM_COOLDOWN_MS = 30 * 60 * 1000;

  const START_MESSAGE = "You've started a new quest: <col=081190>Mudfoot's Big Adventure</col>";
  const LAMP_XP = 500;
  const LAMPS = 4;
  const BOUNTY_SHARE = 500;
  const COMBAT_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS, Skill.PRAYER];

  // Wiki quest-map pins (approximate world tiles).
  const MUDFOOT_HOUSE_TILE = { x: 3249, y: 3249 };
  const STORE_OUTLAW_TILE = { x: 3224, y: 3236 };
  const RANGER_TILE = { x: 3166, y: 3288 };
  const MAGE_TILE = { x: 3172, y: 3240 };
  const WARRIOR_TILE = { x: 3243, y: 3197 };
  const WAITING_SPOT_BY_STAGE = [
    [STAGE_TO_WARRIOR, { x: 3243, y: 3199 }],
    [STAGE_TO_MAGE, { x: 3170, y: 3243 }],
    [STAGE_WINDMILL, { x: 3168, y: 3288 }],
    [STAGE_RECRUITED, MUDFOOT_HOUSE_TILE],
  ];
  const WAITING_AREA_NAMES = [
    [STAGE_TO_WARRIOR, "in graveyard"],
    [STAGE_TO_MAGE, "outside ruined building behind castle"],
    [STAGE_WINDMILL, "outside windmill"],
    [STAGE_RECRUITED, "outside goblin house"],
  ];

  let quest;
  const tracked = new WeakMap();

  // --- state ----------------------------------------------------------------------------------

  const stageOf = (player) => quest.getStage(player);
  const inProgress = (player) => stageOf(player) >= STAGE_SENT && stageOf(player) < STAGE_COMPLETE;
  const hasFollower = (player) => player.getAttribute?.("pets:current")?.isRegistered?.() === true;
  const isWaiting = (player) => player.getAttribute(WAITING_ATTRIBUTE) === true;
  const giveaways = (player) => Number(player.getAttribute(GIVEAWAYS_ATTRIBUTE)) || 0;

  function sendFlags(player) {
    const sender = player.getPacketSender();
    const mask = giveaways(player);
    sender.sendVarbit(HARLAN_INTRO_VARBIT, player.getAttribute(HARLAN_MET_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(MET_MUDFOOT_EARLY_VARBIT, player.getAttribute(MET_EARLY_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(MELEE_GIVEAWAY_VARBIT, mask & GIVEAWAY_MELEE ? 1 : 0);
    sender.sendVarbit(RANGED_GIVEAWAY_VARBIT, mask & GIVEAWAY_RANGED ? 1 : 0);
    sender.sendVarbit(MAGIC_GIVEAWAY_VARBIT, mask & GIVEAWAY_MAGIC ? 1 : 0);
  }

  function unlock(player, flag) {
    player.setAttribute(GIVEAWAYS_ATTRIBUTE, giveaways(player) | flag);
    sendFlags(player);
  }

  function setStage(player, stage) {
    quest.setStage(player, stage);
    syncNpcs(player);
  }

  function minutesLeft(player) {
    const left = CLAIM_COOLDOWN_MS - (Date.now() - (Number(player.getAttribute(LAST_CLAIM_ATTRIBUTE)) || 0));
    return left > 0 ? Math.max(1, Math.ceil(left / 60000)) : 0;
  }

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

  function nearPlayer(player) {
    const location = player.getLocation();
    return { x: location.getX() + 1, y: location.getY() };
  }

  function waitingSpot(stage) {
    return (WAITING_SPOT_BY_STAGE.find(([from]) => stage >= from) ?? WAITING_SPOT_BY_STAGE[3])[1];
  }

  function waitingName(stage) {
    return (WAITING_AREA_NAMES.find(([from]) => stage >= from) ?? WAITING_AREA_NAMES[3])[1];
  }

  /** Mudfoot, and whichever outlaw the stage shows, as owner-only spawns (the cache's own transforms are not needed). */
  function syncNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = stageOf(player);
    if (stage < STAGE_SENT || stage >= STAGE_COMPLETE) {
      remove(player, "mudfoot");
      for (const key of ["ranger", "mage", "warrior"]) remove(player, key);
      return;
    }
    const spear = stage >= STAGE_WINDMILL;
    const mudfootId = spear ? MUDFOOT_SPEAR_NPC_ID : MUDFOOT_NPC_ID;
    if (stage === STAGE_SENT) {
      spawn(player, "mudfoot", MUDFOOT_NPC_ID, MUDFOOT_HOUSE_TILE);
    } else if (isWaiting(player)) {
      const mudfoot = spawn(player, "mudfoot", mudfootId, waitingSpot(stage));
      mudfoot?.setFollowing?.(null);
    } else {
      const existing = mapOf(player).get("mudfoot");
      const mudfoot = spawn(player, "mudfoot", mudfootId, existing ? existing.getLocation() : nearPlayer(player));
      mudfoot?.setFollowing?.(player);
      mudfoot?.setMobileInteraction?.(player);
    }
    if (stage === STAGE_RECRUITED) spawn(player, "ranger", RANGER_VIS_NPC_ID, STORE_OUTLAW_TILE);
    else if (stage === STAGE_WINDMILL) spawn(player, "ranger", RANGER_NOOP_NPC_ID, RANGER_TILE);
    else if (stage === STAGE_RANGER_FIGHT) spawn(player, "ranger", RANGER_COMBAT_NPC_ID, RANGER_TILE);
    else remove(player, "ranger");
    if (stage === STAGE_TO_MAGE) spawn(player, "mage", MAGE_VIS_NPC_ID, MAGE_TILE);
    else if (stage === STAGE_MAGE_FIGHT) spawn(player, "mage", MAGE_COMBAT_NPC_ID, MAGE_TILE);
    else remove(player, "mage");
    if (stage === STAGE_TO_WARRIOR) spawn(player, "warrior", WARRIOR_VIS_NPC_ID, WARRIOR_TILE);
    else if (stage === STAGE_WARRIOR_FIGHT) spawn(player, "warrior", WARRIOR_COMBAT_NPC_ID, WARRIOR_TILE);
    else remove(player, "warrior");
  }

  // --- dialogue -------------------------------------------------------------------------------

  /**
   * Plays a script of entries: ["N", npcId, text], ["P", text], ["S", text], ["I", itemId, text],
   * ["A", fn] (an action that runs when reached) and ["O", title, [[label, fn], ...]] (a menu).
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

  const harlan = (text) => ["N", HARLAN_NPC_ID, text];
  const mudfoot = (text) => ["N", MUDFOOT_NPC_ID, text];
  const you = (text) => ["P", text];

  function say(player, npcId, lines) {
    play(player, lines.map(([who, text]) => (who === "P" ? you(text) : ["N", npcId, text])));
  }

  // --- Captain Harlan -------------------------------------------------------------------------

  function greeting(player) {
    const first = player.getAttribute(HARLAN_MET_ATTRIBUTE) !== true;
    player.setAttribute(HARLAN_MET_ATTRIBUTE, true);
    sendFlags(player);
    return first
      ? "Greetings, adventurer. Captain Harlan, leader of the Lumbridge Guard, at your service. Is there anything I can do for you?"
      : "Hello again, adventurer, Is there anything I can do for you?";
  }

  /** The Wiki's "Standard dialogue" menu, with its quest-conditional entries. */
  function harlanOptions(player) {
    const stage = stageOf(player);
    const mask = giveaways(player);
    const options = [];
    if (stage === 0) options.push(["Do you need help with anything?", () => offerQuest(player)]);
    if (stage === STAGE_REPORT) options.push(["All of those thieves have been dealt with.", () => reportToHarlan(player)]);
    else if (inProgress(player)) {
      options.push([stage === STAGE_SENT ? "Could you remind me where those stolen goods were seen?" : "So, about those thieves...", () => aboutThieves(player)]);
    }
    options.push(["If you lead the Lumbridge Guard, where are the other guards?", () => otherGuards(player)]);
    if (mask & GIVEAWAY_RANGED) options.push(["Could you give me some combat advice?", () => combatAdvice(player)]);
    if (mask & GIVEAWAY_RANGED) options.push(["Do you have any weapons I could have?", () => weaponMenu(player, true)]);
    options.push(["I'd better be off.", () => say(player, HARLAN_NPC_ID, [["P", "I'd better be off."], ["N", "Until next time, adventurer."]])]);
    return options;
  }

  function talkHarlan({ player }) {
    play(player, [harlan(greeting(player)), ["O", "Select an option", harlanOptions(player)]]);
    return true;
  }

  function mainMenu(player) {
    play(player, [["O", "Select an option", harlanOptions(player)]]);
  }

  function offerQuest(player) {
    play(player, [
      you("Do you need help with anything?"),
      harlan("Well, I do actually have a bounty available at the moment that you might be interested in. 1,000 coins to whoever can bring justice to some thieves that robbed the General Store."),
      ["O", "Start the Mudfoot's Big Adventure quest?", [
        ["Yes.", () => startQuest(player)],
        ["No.", () => say(player, HARLAN_NPC_ID, [
          ["P", "Sorry, but I don't think I can help with that right now."],
          ["N", "Fair enough. Just let me know if you change your mind."],
        ])],
      ]],
    ]);
  }

  function startQuest(player) {
    if (stageOf(player) !== 0) return;
    play(player, [
      you("Sounds like a job for me. What do you know about these thieves?"),
      harlan("It happened in the night, so no one got a clear view, but a traveller passing through reckons he saw some of those goblins on the other side of the river playing with the stolen goods."),
      you("I guess I'll start over there then."),
      harlan("Good luck, adventurer."),
      ["A", () => {
        setStage(player, STAGE_SENT);
        player.sendMessage(START_MESSAGE);
      }],
    ]);
  }

  /** What Harlan says about the thieves once Mudfoot is met, by stage; the weapon entries follow the Wiki's quest transcript. */
  function aboutThieves(player) {
    const stage = stageOf(player);
    const mudfootHere = !!mapOf(player).get("mudfoot") && !isWaiting(player) && stage >= STAGE_RECRUITED;
    const menu = (...entries) => ["O", "Select an option", [
      ["Could you run me through combat basics again?", () => combatAdvice(player)],
      ...entries,
      ["I'd best get going.", () => say(player, HARLAN_NPC_ID, [["P", "I'd best get going."], ["N", "Good luck, adventurer."]])],
    ]];
    if (stage === STAGE_SENT) {
      say(player, HARLAN_NPC_ID, [
        ["P", "Could you remind me where those stolen goods were seen?"],
        ["N", "A traveller passing through reckons he saw some of those goblins on the other side of the river playing with them."],
        ["P", "I see. Sounds like that's where I should start then."],
        ["N", "Good luck, adventurer."],
      ]);
    } else if (stage === STAGE_RECRUITED) {
      const repeat = player.getAttribute(MET_EARLY_ATTRIBUTE) === true;
      player.setAttribute(MET_EARLY_ATTRIBUTE, true);
      sendFlags(player);
      say(player, HARLAN_NPC_ID, mudfootHere ? [
        ["P", "So, about those thieves..."],
        ["N", repeat ? "You still have that goblin with you. Have you worked out what's going on yet." : "You seem to have a goblin with you. Is he one of them?"],
        ["P", repeat ? "No, but I'll let you know once I've learnt more." : "No. It seems things might not be as simple as we first thought. I'll let you know once I've learnt more."],
        ["N", "Very well..."],
      ] : [
        ["P", "So, about those thieves..."],
        ["N", "Ah, yes. How goes your search?"],
        ["P", "It seems things might not be as simple as we first thought. I'll let you know once I've learnt more."],
        ["N", "Very well. Good luck, adventurer."],
      ]);
    } else if (stage === STAGE_WINDMILL || stage === STAGE_RANGER_FIGHT) {
      play(player, [
        you("So, about those thieves..."),
        harlan("Ah, yes. Your goblin friend said you should meet him up near the windmill, north of here. Don't forget to take an appropriate weapon as well. You'll want something that can stab, like a dagger or a shortsword."),
        harlan("If needed, I can sort you out with a suitable weapon. Alternatively, the blacksmith should be able to sell you one, or give you some advice on making your own. Oh, and you should probably take some food as well."),
        menu(["Could I have a weapon for stabbing?", () => questClaim(player, 0, "Could I have a weapon for stabbing?", "Of course!")]),
      ]);
    } else if (stage <= STAGE_MAGE_FIGHT) {
      play(player, [
        you("So, about those thieves..."),
        harlan("Ah, yes. How goes your hunt?"),
        you("The first one has been dealt with. We're now moving on to the second. Apparently, this one is a mage."),
        harlan("Ah, well you'll want to make sure you have a ranged weapon then."),
        menu(["Do you have a spare ranged weapon?", () => questClaim(player, 1, "Do you have a spare ranged weapon?", "I do indeed!")]),
      ]);
    } else if (stage < STAGE_REPORT) {
      play(player, [
        you("So, about those thieves..."),
        harlan("Ah, yes. How goes your hunt?"),
        you("The first two have been dealt with. We're now moving on to the last one. Apparently, this one is a warrior, but one that uses prayers to help protect himself in battle."),
        harlan("Ah, well against a warrior, magic will work best, but you'll likely also need a second attack style to overcome his prayers."),
        you("Yes, Mudfoot's going to use melee while I use magic."),
        harlan("Very good."),
        menu(["Do you have a spare magic weapon?", () => questClaim(player, 2, "Do you have a spare magic weapon?", "I do indeed!")]),
      ]);
    }
  }

  function otherGuards(player) {
    say(player, HARLAN_NPC_ID, [
      ["P", "If you lead the Lumbridge Guard, where are the other guards?"],
      ["N", "Ah, well, with Lumbridge being a fairly peaceful town, the King requested the Duke send all able bodies up to help in Varrock instead. They have much greater need for guards up there."],
      ["P", "So it's just you? Does that not cause any problems at all?"],
      ["N", "Well, like I say, this is a mostly peaceful town, so we don't have too many issues... though I suppose it is true that one or two problems do crop up from time to time..."],
    ]);
  }

  function combatAdvice(player) {
    const lines = [
      ["P", "Could you give me some combat advice?"],
      ["N", "Well, first up, there are three types of combat: melee, ranged and magic. Melee uses close up weapons like swords and warhammers, whereas ranged uses things like bows, crossbows or throwing knives."],
      ["N", "Magic is a little different. It's an innate ability, so doesn't actually need any weapons at all. That said, your spells will work better if you channel them using a staff."],
      ["P", "And the three together make up the combat triangle?"],
      ["N", "Indeed. Melee often works best against an opponent using ranged, ranged typically works best when fighting an opponent using magic, and magic is normally the best option when fighting someone using melee."],
      ["N", "Now, that said, do bear in mind that the combat triangle isn't an absolute rule. It's a good starting point, but you will sometimes come across foes that don't follow it."],
      ["P", "I see. And what about different weapon types?"],
      ["N", "Well, there are also many different kinds of weapons, and different ways of using them. Take melee for example. You have crushing attacks, slashing attacks and stabbing attacks."],
      ["N", "Different styles of attack will work better against different types of opponent, but you'll need to make sure you have the right weapon for the job."],
      ["N", "For example, if you want to use a crushing attack, you'll be wanting something like a mace or a warhammer, but if your aim is to stab, a dagger or shortsword will be what you'll need."],
      ["N", "Many weapons are capable of attacking with multiple styles, but in most cases, one style will be the preferred one. Take a scimitar for example. You can stab with it, but slashing is where it works best."],
      ["N", "If you find yourself needing a weapon, I do have a few spares. Alternatively, you might want to buy one or make one yourself. The local blacksmith might be able to help with that."],
      ["N", "The last important thing to note is food. It's most likely that when it combat, you're going to take some damage. Make sure to have some food with you so that you can heal yourself."],
      ["N", "You could just buy some, though you might want to gather and cook it yourself instead. For help with the latter, you might want to speak to the cook in the castle."],
      ["N", "Anyway, I think that covers the basics. I'd say practice is the best way to learn more, though I'm sure there are plenty of other ways for you to learn as well."],
      ["P", "I see. Thanks for the information."],
    ];
    say(player, HARLAN_NPC_ID, lines);
  }

  // The three claim kits, with the Wiki's quantities (40 arrows, 40 mind and 40 air runes).
  const SWORD = ItemIdentifiers.BRONZE_SHORTSWORD;
  const SHIELD = ItemIdentifiers.WOODEN_SHIELD;
  const BOW = ItemIdentifiers.SHORTBOW;
  const ARROWS = ItemIdentifiers.BRONZE_ARROW;
  const STAFF = ItemIdentifiers.STAFF;
  const MIND_RUNES = ItemIdentifiers.MIND_RUNE;
  const AIR_RUNES = ItemIdentifiers.AIR_RUNE;
  const KIT_LABELS = ["Could I have a shortsword and a shield?", "Could I have a shortbow and some arrows?", "Could I have a staff and some runes?"];
  const KIT_FLAGS = [GIVEAWAY_MELEE, GIVEAWAY_RANGED, GIVEAWAY_MAGIC];

  /** Free slots a set of items needs: a stack already carried needs none. */
  function slotsFor(player, items) {
    const inventory = player.getInventory();
    return items.filter(([id]) => !(ItemDefinition.forId(id).isStackable() && inventory.getAmount(id) > 0)).length;
  }

  /** What a kit yields for this player, from Transcript:Captain Harlan; {grant, text, statement, icon}. Unwritten cases give nothing and say nothing. */
  function kitOutcome(player, kit) {
    const inventory = player.getInventory();
    const has = (id) => inventory.getAmount(id) > 0;
    const free = inventory.getFreeSlots();
    if (kit === 0) {
      if (has(SWORD) && has(SHIELD)) return { text: "You already have a shortsword and a shield. Save some for the other adventurers." };
      if (!has(SWORD) && !has(SHIELD)) {
        return free >= 2
          ? { grant: [[SWORD, 1], [SHIELD, 1]], icon: SWORD, statement: "Captain Harlan gives you a bronze shortsword and a wooden shield." }
          : { text: "Ah, you don't have enough space for me to give you a shortsword, or a shield to go with it." };
      }
      if (has(SHIELD)) return free >= 1 ? { grant: [[SWORD, 1]], icon: SWORD, statement: "You already have a wooden shield, but Captain Harlan gives you a bronze shortsword to go with it." } : {};
      return {};
    }
    if (kit === 1) {
      if (!has(BOW)) {
        return free >= 1
          ? { grant: [[BOW, 1], [ARROWS, 40]], icon: BOW, statement: "Captain Harlan gives you a shortbow and 40 bronze arrows." }
          : { text: "You don't have enough space for me to give you a shortbow, nor any arrows." };
      }
      return slotsFor(player, [[ARROWS, 40]]) <= free
        ? { grant: [[ARROWS, 40]], icon: ARROWS, statement: "You already have a shortbow, but Captain Harlan gives you 40 bronze arrows to go with it." }
        : { text: "I can see you already have a shortbow. I'd give you some arrows for it, but you don't have enough space for them." };
    }
    if (!has(STAFF)) {
      return slotsFor(player, [[STAFF, 1], [MIND_RUNES, 40], [AIR_RUNES, 40]]) <= free
        ? { grant: [[STAFF, 1], [MIND_RUNES, 40], [AIR_RUNES, 40]], icon: STAFF, statement: "Captain Harlan gives you a staff, 40 mind runes and 40 air runes." }
        : { text: "You don't have enough space for me to give you a staff, nor any runes." };
    }
    return slotsFor(player, [[MIND_RUNES, 40], [AIR_RUNES, 40]]) <= free
      ? { grant: [[MIND_RUNES, 40], [AIR_RUNES, 40]], icon: MIND_RUNES, statement: "You already have a staff, but Captain Harlan gives you 40 mind runes and 40 air runes to go with it." }
      : { text: "I can see you already have a staff. I'd give you some runes to go with it, but you don't have enough space for them." };
  }

  /** Applies a kit; returns the dialogue entries that show it. */
  function applyKit(player, kit) {
    const outcome = kitOutcome(player, kit);
    const entries = [];
    if (outcome.grant) {
      for (const [id, amount] of outcome.grant) player.getInventory().forceAdd(player, new Item(id, amount));
      player.setAttribute(LAST_CLAIM_ATTRIBUTE, Date.now());
      entries.push(["I", outcome.icon, outcome.statement]);
    }
    if (outcome.text) entries.push(harlan(outcome.text));
    return entries;
  }

  const minutesText = (minutes) => minutes + (minutes === 1 ? " minute." : " minutes.");

  /** The kit menu of "Do you have any weapons I could have?" and the Claim-weapons option; "Now, is there anything else you need?" returns here. */
  function kitMenu(player) {
    const mask = giveaways(player);
    const kits = [0, 1, 2].filter((kit) => (kit === 0 ? mask & GIVEAWAY_RANGED : mask & KIT_FLAGS[kit]));
    const options = kits.map((kit) => [KIT_LABELS[kit], () => {
      const result = applyKit(player, kit);
      play(player, [you(KIT_LABELS[kit]), ...result, harlan("Now, is there anything else you need?"), ["A", () => kitMenu(player)]]);
    }]);
    options.push(["Actually, let's talk about something else.", () => {
      play(player, [you("Actually, let's talk about something else."), ["A", () => mainMenu(player)]]);
    }]);
    play(player, [["O", "Select an option", options]]);
  }

  /** "Do you have any weapons I could have?": the cooldown, then the prompt and kit menu. */
  function weaponMenu(player, withPlayerLine) {
    const mask = giveaways(player);
    const lead = withPlayerLine ? [you("Do you have any weapons I could have?")] : [];
    const minutes = minutesLeft(player);
    if (minutes) {
      const all = (mask & GIVEAWAY_MAGIC) !== 0;
      play(player, [...lead, harlan(all
        ? "I do have quite a few spare things, but I've already given you some recently. I only have so many available, so I can't go overboard. You'll have to come back in " + minutesText(minutes)
        : "I've already given you some items recently. I only have so many available, so I can't go overboard. You'll have to come back in " + minutesText(minutes))]);
      return;
    }
    const prompt = (mask & GIVEAWAY_MAGIC)
      ? "Yes, I do have quite a few spare things. I can sort you out with a shortsword and a shield, a shortbow with some arrows, or a staff with some runes. Which would you like?"
      : "Yes, I do have quite a few spare things. I can sort you out with a shortsword and a shield, or a shortbow with some arrows. Which would you like?";
    play(player, [...lead, harlan(prompt), ["A", () => kitMenu(player)]]);
  }

  /** A quest-transcript weapon request ("Could I have a weapon for stabbing?", ...). */
  function questClaim(player, kit, label, reply) {
    const minutes = minutesLeft(player);
    if (minutes) {
      play(player, [you(label), harlan("I'm afraid I've already given you some items recently. I only have so many available, so I can't go overboard. You'll have to come back in " + minutesText(minutes))]);
      return;
    }
    const result = applyKit(player, kit);
    play(player, [you(label), harlan(reply), ...result, you("Thanks. I'd best get going."), harlan("Good luck, adventurer.")]);
  }

  /** The "Claim-weapons" option: the Wiki's "Claiming weapons" menu. */
  function claimWeapons({ player }) {
    const mask = giveaways(player);
    const claims = [
      [GIVEAWAY_MELEE, "Claim a shortsword and a shield.", 0],
      [GIVEAWAY_RANGED, "Claim a shortbow and some arrows.", 1],
      [GIVEAWAY_MAGIC, "Claim a staff and some runes.", 2],
    ].filter(([flag]) => mask & flag);
    if (!claims.length) return talkHarlan({ player });
    const options = claims.map(([, label, kit]) => [label, () => {
      const minutes = minutesLeft(player);
      if (minutes) {
        say(player, HARLAN_NPC_ID, [["N", "I've already given you some items recently. I only have so many available, so I can't go overboard. You'll have to come back in " + minutesText(minutes)]]);
        return;
      }
      play(player, [...applyKit(player, kit), harlan("Now, is there anything else you need?"), ["A", () => kitMenu(player)]]);
    }]);
    options.push(["Cancel.", null]);
    play(player, [["O", "Select an option", options]]);
    return true;
  }

  // --- finishing ------------------------------------------------------------------------------

  function reportToHarlan(player) {
    const mudfootHere = !!mapOf(player).get("mudfoot") && !isWaiting(player);
    if (!mudfootHere) {
      say(player, HARLAN_NPC_ID, [
        ["P", "All of those thieves have been dealt with."],
        ["N", "Excellent! Why don't you go and fetch your goblin friend, and then we can discuss your reward."],
      ]);
      return;
    }
    play(player, [
      you("All of those thieves have been dealt with."),
      harlan("Excellent! Did you manage to work out why they did it?"),
      you("It seems they were trying to stir up trouble and frame the goblins for it. At least one of them was a H.A.M. supporter, or maybe a full member."),
      harlan("I see... It seems H.A.M. are starting to become more problematic. That is unfortunate..."),
      harlan("Anyway, that's one for me to worry about. Shall we get you sorted out with your reward?"),
      mudfoot("Yes, reward good. Me also give back stolen items. Me take good care of them. Nothing missing at all. Me check two times."),
      ["S", "Mudfoot gives Captain Harlan the items from the General Store."],
      harlan("Many thanks. Now, the bounty was for 1,000 coins, so that's 500 coins each."),
      mudfoot("500? But me the boss. Human just trusty sidekick. Me should get more money. Bigger money too. Boss always bigger than sidekick, so money be bigger to match."),
      you("Mudfoot..."),
      mudfoot("Hmm... But me suppose you do good job. Me actually quite proud of sidekick. Not as proud as me am of me, but still close. One day you maybe be as good at quests as me."),
      mudfoot("Okay, just this once, sidekick can have full 500."),
      ["S", "Captain Harlan gives Mudfoot his half of the bounty."],
      mudfoot("Okay, me go now. Time to find new quest. Maybe me solve big mystery this time."),
      you("What kind of mystery?"),
      mudfoot("Me no know. That why it mystery. Bye now."),
      you("See you around, Mudfoot."),
      ["S", "Mudfoot departs."],
      ["A", () => finish(player)],
    ]);
  }

  function finish(player) {
    if (stageOf(player) !== STAGE_REPORT) return;
    const inventory = player.getInventory();
    const needed = LAMPS + (inventory.getAmount(ItemIdentifiers.COINS) > 0 ? 0 : 1);
    if (inventory.getFreeSlots() < needed) {
      say(player, HARLAN_NPC_ID, [
        ["N", "Right then... Let's get you sorted with your half of the bounty. Alongside the coins I promised, I also have some lamps here that I think you'll find useful. I just need you to make some space for them."],
        ["P", "Okay, I'll be back shortly."],
      ]);
      return;
    }
    say(player, HARLAN_NPC_ID, [["N", "Right then... Thanks for all of your help with those thieves, adventurer. Here's your half of the bounty, along with some lamps that I think you'll find useful. All the best!"]]);
    quest.complete(player);
  }

  function grantReward(player) {
    const inventory = player.getInventory();
    inventory.forceAdd(player, new Item(ItemIdentifiers.COINS, BOUNTY_SHARE));
    for (let lamp = 0; lamp < LAMPS; lamp++) inventory.forceAdd(player, new Item(ANTIQUE_LAMP_ITEM_ID, 1));
    syncNpcs(player);
  }

  // --- Mudfoot --------------------------------------------------------------------------------

  function talkMudfoot(event) {
    const { player } = event;
    if (!inProgress(player)) return false;
    const stage = stageOf(player);
    if (stage === STAGE_SENT) {
      recruit(player);
    } else if (stage === STAGE_WINDMILL) {
      play(player, [mudfoot("Look. Nasty human over there. Kill time now."), ["A", () => startFight(player, "ranger", RANGER_COMBAT_NPC_ID, RANGER_TILE, STAGE_RANGER_FIGHT)]]);
    } else if (isWaiting(player)) {
      player.setAttribute(WAITING_ATTRIBUTE, false);
      const lines = stage >= STAGE_TO_WARRIOR
        ? [["P", "Ready to continue, Mudfoot?"], ["N", "Yes. Other goblins see last thief in graveyard. He big warrior, but he also like to pray to stupid god."], ["P", "So south east of here. Shall we get going?"], ["N", "Okay. Me behind you."]]
        : stage >= STAGE_TO_MAGE
          ? [["P", "Ready to continue, Mudfoot?"], ["N", "Yes. Other goblins say they see next thief by ruined building, west of shop. They say she use big stick that make air go magic."], ["P", "So directly south of here. In that case, shall we get going?"], ["N", "Okay. Me behind you."]]
          : stage >= STAGE_WINDMILL
            ? [["P", "Ready to continue, Mudfoot?"], ["N", "Yes. Me go grab poker and meet sidekick there."]]
            : [["P", "Okay, Mudfoot... We need to find whoever robbed the General Store. Where do we begin?"], ["N", "Other goblins see three humans who dump robbed stuff. We find all humans and make them dead. First one was man with bow. Other goblins see him go back across river. We find him there."], ["P", "Alright, let's get going then."], ["N", "Okay. Me behind you."]];
      say(player, MUDFOOT_NPC_ID, lines);
      syncNpcs(player);
    } else if (stage === STAGE_REPORT) {
      say(player, MUDFOOT_NPC_ID, [["P", "What now, Mudfoot?"], ["N", "We should go tell guard man that nasty thieves have gone dead."]]);
    } else {
      mudfootMenu(player, stage);
    }
    return true;
  }

  function recruit(player) {
    const intro = [
      mudfoot("Die, human, die!"),
      ["S", "Mudfoot hits the player for 0 damage."],
      you("Er... What are you doing?"),
      mudfoot("Me killing you."),
      ["S", "Mudfoot hits the player for 0 damage."],
      you("You're not doing a very good job..."),
      mudfoot("Wrong. You dead now."),
      you("Okay... And why are you killing me?"),
      mudfoot("Me on quest."),
      you("A quest?"),
      mudfoot("Yes. Me going to be great goblin adventurer. Other goblins will call me Mudfoot the... good at quests."),
      you("And what is this quest you're on?"),
      mudfoot("Me kill the nasty humans. Nasty humans rob other humans, but then they dump the stuff they rob here. Now we get blamed."),
      you("Wait, so it wasn't you goblins who robbed the General Store?"),
      mudfoot("No. We goblins innocent. We never rob, apart from all the other times when we did, but this not those times. This time we no do it."),
      mudfoot("Look, me have proof."),
      ["S", "Mudfoot shows you a collection of items from the General Store."],
      mudfoot("See. We keep things safe. No touch them at all, apart from when Damptoes try to eat chisel, but he no do that again now. Eating chisel make him throw up and die."),
      you("I see... Well, perhaps I can help you with your quest. I'm actually on a quest myself to find whoever robbed the General Store. Maybe we can work together?"),
      mudfoot("Hmm... me not really need help. Me very good at quest..."),
      mudfoot("But me generous also. Maybe me let human join as sidekick. Human can learn thing or two from Mudfoot."),
      you("That sounds... wonderful. Where do we begin?"),
      mudfoot("Other goblins see three humans who dump robbed stuff. We find all humans and make them dead. First one was man with bow. Other goblins see him go back across river. We find him there."),
    ];
    if (hasFollower(player)) {
      play(player, [...intro, mudfoot("You pick up follower first. Me no follow you otherwise.")]);
      return;
    }
    play(player, [
      ...intro,
      you("Alright, let's get going then."),
      mudfoot("Okay. Me behind you."),
      ["A", () => {
        player.setAttribute(WAITING_ATTRIBUTE, false);
        setStage(player, STAGE_RECRUITED);
      }],
    ]);
  }

  function mudfootMenu(player, stage) {
    const hint = stage >= STAGE_TO_WARRIOR
      ? "Other goblins say they see last thief in graveyard. He big warrior, but he also like to pray to stupid god."
      : stage >= STAGE_TO_MAGE
        ? "Other goblins say they see next thief by ruined building, west of shop. They say she use big stick that make air go magic."
        : "Other goblins see man with bow go back across river from goblin house. We find him there.";
    const area = waitingName(stage);
    play(player, [["O", "Select an option", [
      ["Where to, Mudfoot?", () => say(player, MUDFOOT_NPC_ID, [["P", "Where to, Mudfoot?"], ["N", hint]])],
      ["I need to do something else.", () => {
        player.setAttribute(WAITING_ATTRIBUTE, true);
        say(player, MUDFOOT_NPC_ID, [["P", "I need to do something else."], ["N", "Okay. Me meet you back " + area + " when you done."]]);
        syncNpcs(player);
      }],
    ]]]);
  }

  // --- the outlaws ----------------------------------------------------------------------------

  /** "Confront" (store ranger, mage, warrior). The Wiki's store cutscene is played as dialogue. */
  function confront(event) {
    const { player, npcId } = event;
    if (!inProgress(player)) return false;
    const mudfootNearby = !!mapOf(player).get("mudfoot") && !isWaiting(player);
    if (npcId === RANGER_VIS_NPC_ID && stageOf(player) === STAGE_RECRUITED) {
      if (!mudfootNearby) {
        say(player, MUDFOOT_NPC_ID, [["P", "Hmm... I should go and get Mudfoot first."]]);
        return true;
      }
      confrontStoreOutlaw(player);
      return true;
    }
    if (npcId === MAGE_VIS_NPC_ID && stageOf(player) === STAGE_TO_MAGE) {
      return confrontOutlaw(player, mudfootNearby, "mage", MAGE_COMBAT_NPC_ID, MAGE_TILE, STAGE_MAGE_FIGHT,
        ["A human helping a goblin? You're a disgrace!", "H.A.M. will get rid of people like you!"]);
    }
    if (npcId === WARRIOR_VIS_NPC_ID && stageOf(player) === STAGE_TO_WARRIOR) {
      return confrontOutlaw(player, mudfootNearby, "warrior", WARRIOR_COMBAT_NPC_ID, WARRIOR_TILE, STAGE_WARRIOR_FIGHT,
        ["My faith protects me!"]);
    }
    return false;
  }

  function confrontOutlaw(player, mudfootNearby, key, combatId, tile, fightStage, shouts) {
    if (!mudfootNearby) {
      say(player, MUDFOOT_NPC_ID, [["P", "Hmm... I should talk to Mudfoot first."]]);
      return true;
    }
    const npc = mapOf(player).get(key);
    npc?.forceChat?.(shouts[0]);
    startFight(player, key, combatId, tile, fightStage);
    return true;
  }

  function startFight(player, key, combatId, tile, fightStage) {
    player.setAttribute(WAITING_ATTRIBUTE, false);
    setStage(player, fightStage);
    const outlaw = spawn(player, key, combatId, tile);
    outlaw?.getCombat?.().attack(player);
  }

  function confrontStoreOutlaw(player) {
    play(player, [
      ["N", RANGER_VIS_NPC_ID, "Er... What is this?"],
      mudfoot("Evil human! Mudfoot kill you now!"),
      ["S", "Mudfoot attacks the outlaw, dealing 0 damage."],
      ["N", RANGER_VIS_NPC_ID, "Okay... Good luck with that..."],
      ["S", "The outlaw walks away."],
      mudfoot("Me no understand. Why no work?"),
      harlan("What's happening here? What's all the commotion?"),
      harlan(player.getAttribute(MET_EARLY_ATTRIBUTE) === true
        ? "Adventurer? You still have that goblin with you. What's going on?"
        : "A goblin? Is this the one responsible for the robbery, adventurer?"),
      you(player.getAttribute(MET_EARLY_ATTRIBUTE) === true
        ? "Well, as it turns out, Mudfoot here is actually trying to deal with the thieves as well."
        : "As it turns out, no. Mudfoot here is actually trying to deal with the thieves as well."),
      harlan("He is?"),
      mudfoot("Yes. Nasty humans try to frame innocent goblins. Me here to stop them. Me make them go dead."),
      harlan("You killed them?"),
      you("Not yet. Mudfoot seems to be having some... difficulties with that."),
      harlan("I see... In that case, come. Let us discuss this further."),
      harlan("Right, regarding these thieves... You said that your goblin friend wasn't able to kill them?"),
      mudfoot("Me try hit them with big hammer, but it no work."),
      harlan("I see. Did they have armour?"),
      you("Yes, the armour of a ranger."),
      mudfoot("Yes, ranger. Other goblins tell me rangers die best when you hit them up close. That what me do. Go close and big smack."),
      harlan("Ah... Tell me... Mudfoot... have you heard of something called the combat triangle?"),
      mudfoot("Triangle? Like roof?"),
      harlan("Yes, sometimes..."),
      harlan("Anyway, when those goblin friends of yours told you that melee works best against a ranger, that's what they were referring to."),
      mudfoot("But why triangle?"),
      harlan("Well, melee often works best against an opponent using ranged, ranged typically works best when fighting an opponent using magic, and magic is normally the best option when fighting someone using melee."),
      mudfoot("But that what me do. Me do the close up hit. Why no work?"),
      harlan("The combat triangle isn't the only thing to consider when taking on a foe. The way that you're attacking is also important. Take melee for example. You have crushing attacks, slashing attacks and stabbing attacks."),
      mudfoot("Oh, me like to do big crush best. That why me have big hammer."),
      harlan("Indeed, but the armour typically worn by a ranger is quite resilient to crushing attacks. You'll likely find you have better luck with a stabbing attack instead."),
      harlan("Of course, for that, you'll need the right weapon. As you've already noted, something like a warhammer works well for crushing, but if your aim is to stab, a weapon like a dagger or shortsword will work best."),
      mudfoot("So me go get big poker, then nasty bow man die?"),
      harlan("Well, there are no guarantees of course, but it will definitely improve your odds."),
      mudfoot("Yes... Me know all this already of course. Me just pretended not to so trusty human sidekick can do learning. Me know human afraid to ask for help."),
      you("That's not-"),
      mudfoot("It okay though. This why human sidekick and me in charge."),
      you("Hmm... Shall we go and find that outlaw and try again?"),
      mudfoot("Yes! They go north towards that windmill. Me go grab poker and meet sidekick there. You make sure you grab poker as well."),
      harlan("I can sort you out with a suitable weapon if needed, adventurer. Alternatively, the local blacksmith should be able to sell you one, or give you some advice on making your own."),
      mudfoot("Weapon good. No steal one though. Stealing bad, as Mudfoot always say, apart from when it okay, which isn't now."),
      you("Words to live by... Anything else we should grab before we do this?"),
      harlan("Given you're going into a fight, some food would be wise."),
      mudfoot("This true. Food make you feel better if you get hit, but me never get hit, so me never need food."),
      you("If you say so."),
      mudfoot("Okay, time to go now."),
      ["S", "Mudfoot departs."],
      harlan("It seems you know what you need to do next. Good luck, adventurer."),
      ["A", () => {
        unlock(player, GIVEAWAY_MELEE);
        player.setAttribute(WAITING_ATTRIBUTE, true);
        setStage(player, STAGE_WINDMILL);
      }],
    ]);
  }

  /** The stage moves on at the kill, so closing the conversation cannot strand the player at a fight with no outlaw. */
  function afterBattle(player, nextStage, flag, lines) {
    if (flag) unlock(player, flag);
    setStage(player, nextStage);
    play(player, lines.map(([who, text]) => (who === "P" ? you(text) : mudfoot(text))));
  }

  function handleNpcDeath(event) {
    const { npc } = event;
    const player = npc?.getOwner?.();
    if (!player || !inProgress(player)) return;
    const stage = stageOf(player);
    if (event.npcId === RANGER_COMBAT_NPC_ID && stage === STAGE_RANGER_FIGHT) {
      finishFight(player, "ranger", npc, [[ItemIdentifiers.SHORTBOW, 1], [ItemIdentifiers.BRONZE_ARROW, 80]]);
      afterBattle(player, STAGE_TO_MAGE, GIVEAWAY_RANGED, [
        ["P", "Right, that's the first one of those outlaws dealt with."],
        ["N", "Yes, we do good work making them dead. Me do good work especially, but human not bad either."],
        ["P", "Thanks... So, what's next?"],
        ["N", "Other goblins tell me about next thief. They say she carry big stick that make air go magic."],
        ["P", "So she's a mage. That means we'll want to use ranged against her."],
        ["N", "Yes, that why me bring best ranged weapon of all: rocks."],
        ["P", "Rocks?"],
        ["N", "Me throw them hard. Harder me throw, more death happen."],
        ["P", "I see... I think I'll stick to a bow."],
        ["N", "Yes, bow okay as well, but not as good as rocks. Maybe you use bow that first thief had, or maybe guard man tell you how to get one."],
        ["P", "And once we're ready, where do we find this mage?"],
        ["N", "Other goblins say they see her by ruined building, west of shop."],
        ["P", "So directly south of here. In that case, shall we get going?"],
        ["N", "Okay. Me behind you."],
      ]);
    } else if (event.npcId === MAGE_COMBAT_NPC_ID && stage === STAGE_MAGE_FIGHT) {
      finishFight(player, "mage", npc, [[ItemIdentifiers.STAFF, 1], [ItemIdentifiers.MIND_RUNE, 80], [ItemIdentifiers.AIR_RUNE, 80]]);
      afterBattle(player, STAGE_TO_WARRIOR, GIVEAWAY_MAGIC, [
        ["N", "Another nasty thief go dead!"],
        ["P", "She mentioned H.A.M."],
        ["N", "Nasty human must be member of nasty group. Always calling goblins monsters. We no monsters... apart from maybe Dungface. He once kill chicken just because it lay egg on his foot."],
        ["P", "I suppose this explains why they were trying to frame you."],
        ["N", "Me impossible to frame. Rattrap try it once, but he fail. Me too wriggly."],
        ["P", "What?"],
        ["N", "Humans silly anyway. They no consider powerful hero like Mudfoot! Me on quest to stop all the nasty humans."],
        ["P", "Well, on that note, just one left to go. What do you know about the last thief?"],
        ["N", "Other goblins say this one great warrior, but not as great as me."],
        ["P", "Meaning they're using melee, so we need to use magic."],
        ["N", "Magic? Me try that once. They say to cast spell you wave hands, but me just wave big hammer instead. Work just as good."],
        ["P", "Are you sure?"],
        ["N", "Yes. That why me stick with spear. This good for us though. Goblins say human do big religion."],
        ["P", "Big religion?"],
        ["N", "He pray to his stupid god to help him. Means he protected. You do close up poke, he pray to stop close up poke. You do far away throw, he pray to stop far away throw."],
        ["N", "But he stupid. He no have good god like goblins have Big High War God. His god have short attention span and only listen to one prayer at time. If me use spear and you use fancy magic, he can't stop both."],
        ["P", "I see. Sounds like we have a plan then."],
        ["N", "Yes, best plan. You get yourself magic stick. Take one from dead magic woman, or maybe guard man help. Then we kill last thief. Other goblins see him down in graveyard."],
        ["P", "So south east of here. Shall we get going?"],
        ["N", "Okay. Me behind you."],
      ]);
    } else if (event.npcId === WARRIOR_COMBAT_NPC_ID && stage === STAGE_WARRIOR_FIGHT) {
      finishFight(player, "warrior", npc, [[ItemIdentifiers.IRON_SCIMITAR, 1], [ItemIdentifiers.IRON_KITESHIELD, 1]]);
      afterBattle(player, STAGE_REPORT, 0, [
        ["P", "That's the last of those thieves dealt with!"],
        ["N", "Stupid humans should never have crossed Mudfoot the good at quests. Guard man will want to know about good job. He probably clap for us. Humans like clapping."],
        ["P", "Shall we go tell him then?"],
        ["N", "Okay. Me behind you."],
      ]);
    }
  }

  function finishFight(player, key, npc, drops) {
    const tile = npc.getLocation();
    for (const [id, amount] of drops) {
      ItemOnGroundManager.registerLocation(player, new Item(id, amount), tile, player.getPrivateArea?.(), { goesGlobal: false });
    }
    remove(player, key);
  }

  // --- Mudfoot's reactions to the NPCs around Lumbridge while he follows ----------------------

  /** Transcript:Mudfoot's Big Adventure, "Talking to NPCs while Mudfoot is following": [speaker, text]; N is the NPC. */
  const REACTIONS = new Map([
    ["Bartender", [["N", "No goblins in the pub please!"], ["M", "Okay, me go. Goblins have better super secret pub anyway."]]],
    ["Bob", [["N", "A goblin? Get out! Get out! Get out!"], ["M", "Stupid human have no manners. You need learn to say please."]]],
    ["Border Guard", [["N", "No goblins allowed! Be gone with you!"], ["M", "Rude. Me no want go through stupid gate anyway."]]],
    ["Cook", [["N", "A goblin? I don't think you should be in here..."], ["M", "Okay, but cook man just scared that me cook better than him."]]],
    ["Duke Horacio", [["N", "What's this goblin doing in the castle? Remove it at once!"], ["M", "Fine. Castle rubbish anyway."]]],
    ["Father Aereck", [["N", "No goblins in the church please!"], ["M", "Church? Sorry, me thought this poo pile. That what it look like. Rubbish church for rubbish god."]]],
    ["Father Urhney", [["N", "Go away! I'm meditating!"], ["M", "Meditating? Stupid humans with stupid word for thinking hard. Be more like goblin. We never think hard."]]],
    ["Fred the Farmer", [["N", "Hey! Get out of here!"], ["M", "Fine. Your farm rubbish anyway. You so rubbish you not even got rid of weird not-sheep outside."]]],
    ["Hans", [["N", "Oh, a goblin... Hello there, goblin."], ["M", "Hello. You walk a lot."], ["N", "Yes, I suppose I do."], ["M", "That good. Walking a lot stop you being fat."], ["N", "Yes... I guess you're right."]]],
    ["Millie Miller", [["N", "Oh, sorry, but we don't really want goblins in here..."], ["M", "Loss for you. Goblins way better than humans."]]],
    ["Shop keeper", [["N", "Hey, it's one of the goblins that robbed us. Get out!"], ["M", "We no even rob you! You be nice, or you never get back things that we no rob."]]],
    ["Shop assistant", [["N", "Hey, it's one of the goblins that robbed us. Get out!"], ["M", "We no even rob you! You be nice, or you never get back things that we no rob."]]],
    ["Sigmund", [["N", "Get this monster away from me!"], ["M", "Ha! You scared of goblin? Stupid human is stupid wimp."]]],
  ]);
  const LUMBRIDGE_AREA = { minX: 3140, maxX: 3290, minY: 3150, maxY: 3330 };

  function reactToMudfoot(event) {
    const { player, npcId } = event;
    const name = event.definition?.getName?.() ?? event.npc?.getCurrentDefinition?.(player)?.getName?.();
    const lines = REACTIONS.get(name);
    const here = player.getLocation();
    const following = !!mapOf(player).get("mudfoot") && !isWaiting(player) && stageOf(player) >= STAGE_RECRUITED && stageOf(player) < STAGE_COMPLETE;
    if (!lines || !following || here.getX() < LUMBRIDGE_AREA.minX || here.getX() > LUMBRIDGE_AREA.maxX
      || here.getY() < LUMBRIDGE_AREA.minY || here.getY() > LUMBRIDGE_AREA.maxY) return false;
    play(player, lines.map(([who, text]) => (who === "N" ? ["N", npcId, text] : mudfoot(text))));
    event.handled = true;
    return true;
  }

  // --- lamps ----------------------------------------------------------------------------------

  const lampPending = new WeakMap();

  function confirmLamp(player, item, slot, skill, name) {
    if (lampPending.get(player)?.item !== item) return null;
    lampPending.delete(player);
    const inventory = player.getInventory();
    if (inventory.get(slot) !== item) return null;
    const manager = player.getSkillManager();
    const before = manager.getExperience(skill);
    manager.addExperience(skill, LAMP_XP, true);
    if (manager.getExperience(skill) === before) return null;
    inventory.deleteAtSlot(slot, 1);
    return `You have been awarded ${LAMP_XP} ${name ?? skill.getName()} XP!`;
  }

  /** The four quest lamps rub through the shared xpreward interface (XpReward.plugin.js), combat skills and Prayer only. */
  function rubLamp(event) {
    if (event.itemId !== ANTIQUE_LAMP_ITEM_ID) return false;
    const { player, item, slot } = event;
    lampPending.set(player, { item, slot });
    api.emitCustomEvent("xpreward:open", {
      player,
      title: "Choose the stat you wish to be advanced!",
      skills: COMBAT_SKILLS,
      onConfirm: (skill, name) => confirmLamp(player, item, slot, skill, name),
    });
    return true;
  }

  // --- journal --------------------------------------------------------------------------------

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Captain Harlan asked me to catch the thieves who robbed the</str>",
        "<str>Lumbridge General Store. With the help of a goblin named</str>",
        "<str>Mudfoot, I defeated the three outlaws responsible.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_REPORT) return ["I have defeated all three outlaws.", "", "I should return to <col=800000>Captain Harlan</col>."];
    if (stage >= STAGE_TO_WARRIOR) return ["<str>I defeated the outlaw ranger and the outlaw mage.</str>", "", "I need to defeat the last outlaw, a warrior in", "<col=800000>Lumbridge Graveyard</col>. He uses Protect from Melee, so I", "should use <col=800000>Magic</col> or <col=800000>Ranged</col> against him."];
    if (stage >= STAGE_TO_MAGE) return ["<str>I defeated the outlaw ranger.</str>", "", "I need to defeat the outlaw mage near the", "<col=800000>H.A.M. hideout</col>. <col=800000>Ranged</col> works best against a mage."];
    if (stage >= STAGE_WINDMILL) return ["Mudfoot's quest and mine are the same: find the outlaws.", "", "I need to defeat an outlaw ranger near the", "<col=800000>windmill</col>. A <col=800000>stab</col> attack works best against a ranger."];
    if (stage >= STAGE_RECRUITED) return ["<str>I met a goblin named Mudfoot, who is also hunting the</str>", "<str>thieves, and he is following me as my sidekick.</str>", "", "I should find the outlaw near the <col=800000>Lumbridge General Store</col>."];
    if (stage >= STAGE_SENT) return ["<col=800000>Captain Harlan</col> wants me to catch the thieves who robbed the", "<col=800000>Lumbridge General Store</col>. A traveller saw goblins across the", "river playing with the stolen goods.", "", "I should talk to <col=800000>Mudfoot</col> at the house south of the cow field."];
    return ["I can start this quest by speaking to <col=800000>Captain Harlan</col>", "just outside the <col=800000>Lumbridge General Store</col>.", "", "There are no requirements for this quest."];
  }

  function handleLogin({ player }) {
    sendFlags(player);
    refreshQuestList(player);
    syncNpcs(player);
  }

  /** A logout takes the player's Mudfoot and outlaws with it: a relogged account is a new player object. */
  function handleLogout({ player }) {
    if (!player) return;
    remove(player, "mudfoot");
    for (const key of ["ranger", "mage", "warrior"]) remove(player, key);
    tracked.delete(player);
  }

  quest = registerQuest(api, {
    key: "mudfoots_big_adventure",
    name: "Mudfoot's Big Adventure",
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_SENT,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    otherRewards: [
      "Four antique lamps, each 500 experience in a combat skill or Prayer",
      "500 coins",
      "Basic equipment for each combat style from Captain Harlan every 30 minutes",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(WAITING_ATTRIBUTE, false);
  api.persistAttribute(HARLAN_MET_ATTRIBUTE, false);
  api.persistAttribute(MET_EARLY_ATTRIBUTE, false);
  api.persistAttribute(GIVEAWAYS_ATTRIBUTE, 0);
  api.persistAttribute(LAST_CLAIM_ATTRIBUTE, 0);

  api.onNpcInteraction("Captain Harlan", { "Talk-to": talkHarlan, "Claim-weapons": claimWeapons });
  api.onNpcInteraction("Mudfoot", { "Talk-to": talkMudfoot });
  api.onNpcInteraction("Outlaw", { Confront: confront });
  api.onNpcsInteraction([...REACTIONS.keys()], { "Talk-to": reactToMudfoot });
  api.onNpcDeath(handleNpcDeath);
  api.onItemAction("Antique lamp", { Rub: rubLamp });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};

