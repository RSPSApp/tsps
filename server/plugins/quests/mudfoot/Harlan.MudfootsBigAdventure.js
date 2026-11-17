/**
 * Captain Harlan's conversations for Mudfoot's Big Adventure: the start, his quest lines by stage, combat
 * advice, the weapon kits and his cape, and the report that ends the quest.
 *
 * Captured (rsprox MudfootsBigAdventure, ticks in brackets): every line's text and chathead animation; his
 * main menu leaves out the option just picked when it comes back [32, 101, 1371, 1377, 1401, 1415, 1422]
 * and pages past five options as three and "More options..." [628, 1259]; combat advice carries four
 * graphic boxes [605-615]; the kits [1383-1400]; the cape below 99 Defence [26-31].
 *
 * Kits: each style's first kit is a bonus (captain_harlan_bonus_*_giveaway) that the 30-minute wait does not
 * hold back; any kit given starts the wait. Live gave the sword at 622, then at 1387 refused another
 * ("come back in 22 minutes") while giving the bow and the staff (both first claims), and at 1418 refused
 * all ("30 minutes"). The minutes are the wait left, rounded (7.66 minutes after the sword: 22).
 *
 * The Wiki (Transcript:Mudfoot's Big Adventure, Transcript:Captain Harlan) wins over the capture where they
 * disagree (recorded differences in docs/quests/mudfoots-big-adventure/README.md): Harlan's "Good luck,
 * adventurer." after a quest kit, "I'd best get going." in the stage menus, and the chat ending after the
 * "come back in" refusal of "Do you have any weapons I could have?".
 */
module.exports = function createHarlan(api, common, deps) {
  const { ItemDefinition, ItemIdentifiers, Item, Skill } = api.core;
  const { STAGE, VIS, VARBIT, NPC, CHAT, ATTRIBUTE, BONUS, play, npcLine, playerLine, stageOf } = common;
  const { questStartMessage } = require("../QuestRuntime");

  const H = (text, anim, extra) => npcLine(NPC.HARLAN, text, anim, extra);
  const M = (text, anim, extra) => npcLine(NPC.MUDFOOT, text, anim, extra);
  const P = playerLine;

  const CLAIM_WAIT_MS = 30 * 60 * 1000;
  const COINS_250_MODEL = 1002; // coins_250, the report box's coin pile [1308]
  const GRAPHIC = { WORN_EQUIPMENT: 901, COMBAT_OPTIONS: 168, SKILLS: 898 }; // graphicbox_set_graphic [605, 607, 615]

  // --- menus -------------------------------------------------------------------------------

  /** A menu that comes back leaves out the option just picked; past five, three and "More options...". */
  function menu(player, options, exclude) {
    const shown = options.filter(([label]) => label !== exclude);
    if (shown.length <= 5) {
      play(player, [{ menu: "Select an option", options: shown }]);
      return;
    }
    // Ours: the second page (not captured) holds the rest.
    const rest = shown.slice(3);
    play(player, [{ menu: "Select an option", options: [...shown.slice(0, 3), ["More options...", () =>
      play(player, [{ menu: "Select an option", options: rest }])]] }]);
  }

  function greeting(player) {
    const first = player.getAttribute(ATTRIBUTE.HARLAN_MET) !== true;
    if (first) common.setFlag(player, ATTRIBUTE.HARLAN_MET, VARBIT.HARLAN_INTRO);
    return first
      ? H("Greetings, adventurer. Captain Harlan, leader of the Lumbridge Guard, at your service. Is there anything I can do for you?", CHAT.QUIZ3)
      : H("Hello again, adventurer, Is there anything I can do for you?", CHAT.QUIZ2);
  }

  function talk({ player }) {
    play(player, [greeting(player)], () => mainMenu(player));
    return true;
  }

  const kitsUnlocked = (player) => stageOf(player) >= STAGE.WINDMILL;

  function questOption(player) {
    const stage = stageOf(player);
    if (stage === STAGE.NOT_STARTED) return ["Do you need help with anything?", () => offer(player)];
    if (stage < STAGE.RECRUITED) return ["Could you remind me where those stolen goods were seen?", () => remind(player)];
    if (stage < STAGE.REPORT) return ["So, about those thieves...", () => aboutThieves(player)];
    if (stage < STAGE.COMPLETE) return ["All of those thieves have been dealt with.", () => report(player)];
    return null;
  }

  function mainOptions(player) {
    const options = [];
    const quest = questOption(player);
    if (quest) options.push(quest);
    options.push(["If you lead the Lumbridge Guard, where are the other guards?", () => otherGuards(player)]);
    if (kitsUnlocked(player)) {
      options.push(["Could you give me some combat advice?", () => combatAdvice(player)]);
      options.push(["Do you have any weapons I could have?", () => weapons(player)]);
    }
    options.push(["About that cape you're wearing...", () => cape(player)]);
    options.push(["I'd better be off.", () => play(player, [P("I'd better be off.", CHAT.NEUTRAL1), H("Until next time, adventurer.", CHAT.NEUTRAL1)])]);
    return options;
  }

  function mainMenu(player, exclude) {
    menu(player, mainOptions(player), exclude);
  }

  // --- the standard options ----------------------------------------------------------------

  function otherGuards(player) {
    const label = "If you lead the Lumbridge Guard, where are the other guards?";
    play(player, [
      P(label, CHAT.QUIZ2),
      H("Ah, well, with Lumbridge being a fairly peaceful town, the King requested the Duke send all able bodies up to help in Varrock instead. They have much greater need for guards up there.", CHAT.NEUTRAL4),
      P("So it's just you? Does that not cause any problems at all?", CHAT.QUIZ2),
      H("Well, like I say, this is a mostly peaceful town, so we don't have too many issues... though I suppose it is true that one or two problems do crop up from time to time...", CHAT.CONFUSED4),
    ], () => mainMenu(player, label));
  }

  /** The combat lesson both "Could you give me some combat advice?" and "...run me through combat basics again?" give [596-615, 1354-1369]. */
  function advice() {
    return [
      H("Well, first up, there are three types of combat: melee, ranged and magic. Melee uses close up weapons like swords and warhammers, whereas ranged uses things like bows, crossbows or throwing knives.", CHAT.NEUTRAL4),
      H("Magic is a little different. It's an innate ability, so doesn't actually need any weapons at all. That said, your spells will work better if you channel them using a staff.", CHAT.NEUTRAL4),
      P("And the three together make up the combat triangle?", CHAT.QUIZ1),
      H("Indeed. Melee often works best against an opponent using ranged, ranged typically works best when fighting an opponent using magic, and magic is normally the best option when fighting someone using melee.", CHAT.NEUTRAL4),
      H("Now, that said, do bear in mind that the combat triangle isn't an absolute rule. It's a good starting point, but you will sometimes come across foes that don't follow it.", CHAT.NEUTRAL3),
      P("I see. And what about different weapon types?", CHAT.QUIZ1),
      H("Well, there are also many different kinds of weapons, and different ways of using them. Take melee for example. You have crushing attacks, slashing attacks and stabbing attacks.", CHAT.NEUTRAL4),
      H("Different styles of attack will work better against different types of opponent, but you'll need to make sure you have the right weapon for the job.", CHAT.NEUTRAL3),
      H("For example, if you want to use a crushing attack, you'll be wanting something like a mace or a warhammer, but if your aim is to stab, a dagger or shortsword will be what you'll need.", CHAT.NEUTRAL4),
      { graphic: GRAPHIC.WORN_EQUIPMENT, text: "Different pieces of equipment have different stats, making them effective in different situations. You can view your equipment stats in the Worn Equipment panel." },
      H("Many weapons are capable of attacking with multiple styles, but in most cases, one style will be the preferred one. Take a scimitar for example. You can stab with it, but slashing is where it works best.", CHAT.NEUTRAL4),
      { graphic: GRAPHIC.COMBAT_OPTIONS, text: "The same weapon can be used in multiple ways. You can use the attack options in the Combat Options panel to select how you want to use your currently equipped weapon." },
      { graphic: GRAPHIC.COMBAT_OPTIONS, text: "Different attack options will also grant different types of XP. For example, some options will reward Attack XP when used, whereas others will reward Strength XP. Each attack option shows what XP will be given." },
      H("If you find yourself needing a weapon, I do have a few spares. Alternatively, you might want to buy one or make one yourself. The local blacksmith might be able to help with that.", CHAT.NEUTRAL4),
      H("The last important thing to note is food. It's most likely that when it combat, you're going to take some damage. Make sure to have some food with you so that you can heal yourself. ", CHAT.NEUTRAL4),
      H("You could just buy some, though you might want to gather and cook it yourself instead. For help with the latter, you might want to speak to the cook in the castle.", CHAT.NEUTRAL3),
      H("Anyway, I think that covers the basics. I'd say practice is the best way to learn more, though I'm sure there are plenty of other ways for you to learn as well.", CHAT.NEUTRAL3),
      { graphic: GRAPHIC.SKILLS, text: "To learn more about combat, see the guides for Attack, Strength, Defence, Ranged, Magic, Prayer and Hitpoints in the Skills panel." },
    ];
  }

  function combatAdvice(player) {
    const label = "Could you give me some combat advice?";
    play(player, [P(label, CHAT.QUIZ1), ...advice(), P("I see. Thanks for the information.", CHAT.HAPPY1)], () => mainMenu(player, label));
  }

  /**
   * Below 99 Defence, as captured [26-31]. With 99 the Wiki's menu: what follows its options is missing on the
   * Wiki, so the skillcape sellers (Sellers.SkillCapes) make the sale and the hood with no lines of his own.
   */
  function cape(player) {
    const label = "About that cape you're wearing...";
    if (player.getSkillManager().getMaxLevel(Skill.DEFENCE) < 99) {
      play(player, [
        P(label, CHAT.QUIZ1),
        H("Ah, yes. This cape is a symbol of achievement. Specifically, it marks me as someone who has mastered the fine art of defence. Only someone skilled enough is allowed to wear one.", CHAT.NEUTRAL4),
        P("So could I have one?", CHAT.QUIZ1),
        H("I'm afraid not, adventurer, but I'm sure you'll get there one day.", CHAT.NEUTRAL2),
        { item: ItemIdentifiers.DEFENCE_CAPE, text: "You need to have fully mastered the Defence skill by reaching level 99 to be able to buy and wear the Defence Skillcape." },
      ], () => mainMenu(player, label));
      return;
    }
    const buy = () => play(player, [
      P("Could I buy another one?"),
      H("Of course! However, there is a price for a cape like this. It will cost you 99,000 coins."),
      { menu: "Select an option", options: [
        ["Sounds good to me.", () => api.emitCustomEvent("skillcapes:buy", { player, skill: "DEFENCE" })],
        ["99,000 coins? That's too much for me.", null],
      ] },
    ]);
    play(player, [P(label), H("Ah, yes. What about it?"), { menu: "Select an option", options: [
      ["Could I buy another one?", buy],
      ["Could I have another hood for mine?", () => api.emitCustomEvent("skillcapes:hood", { player, skill: "DEFENCE" })],
    ] }]);
  }

  // --- the quest ---------------------------------------------------------------------------

  function offer(player) {
    play(player, [
      P("Do you need help with anything?", CHAT.QUIZ1),
      H("Well, I do actually have a bounty available at the moment that you might be interested in. 1,000 coins to whoever can bring justice to some thieves that robbed the General Store.", CHAT.NEUTRAL4),
      { menu: "Start the Mudfoot's Big Adventure quest?", options: [
        ["Yes.", () => start(player)],
        ["No.", () => play(player, [
          P("Sorry, but I don't think I can help with that right now.", CHAT.NEUTRAL1),
          H("Fair enough. Just let me know if you change your mind.", CHAT.NEUTRAL2),
        ])],
      ] },
    ]);
  }

  /** Live sets 2 as "Yes." is picked and 4 as his last line shows, with Mudfoot showing at his house [127, 138]. */
  function start(player) {
    if (stageOf(player) !== STAGE.NOT_STARTED) return;
    deps.begin(player);
    player.sendMessage(questStartMessage(player, common.QUEST_NAME));
    play(player, [
      P("Sounds like a job for me. What do you know about these thieves?", CHAT.QUIZ2),
      H("It happened in the night, so no one got a clear view, but a traveller passing through reckons he saw some of those goblins on the other side of the river playing with the stolen goods.", CHAT.NEUTRAL4),
      P("I guess I'll start over there then.", CHAT.NEUTRAL1),
      H("Good luck, adventurer.", CHAT.NEUTRAL1, { on: () => deps.sendToMudfoot(player) }),
    ]);
  }

  function remind(player) {
    play(player, [
      P("Could you remind me where those stolen goods were seen?", CHAT.QUIZ2),
      H("A traveller passing through reckons he saw some of those goblins on the other side of the river playing with them.", CHAT.NEUTRAL3),
      P("I see. Sounds like that's where I should start then.", CHAT.NEUTRAL1),
      // Ours: a player who left his first talk at stage 2 is sent on here.
      H("Good luck, adventurer.", CHAT.NEUTRAL1, { on: () => deps.sendToMudfoot(player) }),
    ]);
  }

  const goodLuck = (player, label) => play(player, [P(label, CHAT.NEUTRAL1), H("Good luck, adventurer.", CHAT.NEUTRAL1)]);

  /** "So, about those thieves...", by stage (Wiki Transcript:Mudfoot's Big Adventure; the windmill lines captured [631-638]). */
  function aboutThieves(player) {
    const stage = stageOf(player);
    const label = "So, about those thieves...";
    if (stage < STAGE.HARLAN_TALK) {
      const following = deps.following(player);
      const again = player.getAttribute(ATTRIBUTE.MET_EARLY) === true;
      if (following) common.setFlag(player, ATTRIBUTE.MET_EARLY, VARBIT.MET_MUDFOOT_EARLY);
      play(player, following ? [
        P(label),
        H(again ? "You still have that goblin with you. Have you worked out what's going on yet." : "You seem to have a goblin with you. Is he one of them?"),
        P(again ? "No, but I'll let you know once I've learnt more." : "No. It seems things might not be as simple as we first thought. I'll let you know once I've learnt more."),
        H("Very well..."),
      ] : [
        P(label),
        H("Ah, yes. How goes your search?"),
        P("It seems things might not be as simple as we first thought. I'll let you know once I've learnt more."),
        H("Very well. Good luck, adventurer."),
      ]);
      return;
    }
    if (stage < STAGE.WINDMILL) {
      // Ours: the talk after the store scene, left before its end, starts again.
      deps.resumeHarlanTalk(player);
      return;
    }
    if (stage < STAGE.RANGER_DEAD) {
      play(player, [
        P(label, CHAT.QUIZ1),
        H("Ah, yes. Your goblin friend said you should meet him up near the windmill, north of here. Don't forget to take an appropriate weapon as well. You'll want something that can stab, like a dagger or a shortsword.", CHAT.NEUTRAL4),
        H("If needed, I can sort you out with a suitable weapon. Alternatively, the blacksmith should be able to sell you one, or give you some advice on making your own. Oh, and you should probably take some food as well.", CHAT.NEUTRAL4),
      ], () => windmillMenu(player));
      return;
    }
    if (stage < STAGE.MAGE_DEAD) {
      play(player, [
        P(label),
        H("Ah, yes. How goes your hunt?"),
        P("The first one has been dealt with. We're now moving on to the second. Apparently, this one is a mage."),
        H("Ah, well you'll want to make sure you have a ranged weapon then."),
      ], () => mageMenu(player));
      return;
    }
    play(player, [
      P(label),
      H("Ah, yes. How goes your hunt?"),
      P("The first two have been dealt with. We're now moving on to the last one. Apparently, this one is a warrior, but one that uses prayers to help protect himself in battle."),
      H("Ah, well against a warrior, magic will work best, but you'll likely also need a second attack style to overcome his prayers."),
      P("Yes, Mudfoot's going to use melee while I use magic."),
      H("Very good."),
    ], () => warriorMenu(player));
  }

  const BASICS = "Could you run me through combat basics again?";
  const basics = (player, back) => play(player, [P(BASICS, CHAT.QUIZ1), ...advice()], () => back(BASICS));

  /** After the store scene [588]; "Thanks. I'd best get going." as captured there and on the Wiki. */
  function afterSceneMenu(player, exclude) {
    menu(player, [
      [BASICS, () => basics(player, (label) => afterSceneMenu(player, label))],
      ["Could I have a weapon for stabbing?", () => questKit(player, KIT.MELEE, "Could I have a weapon for stabbing?", "Of course!")],
      ["Thanks. I'd best get going.", () => play(player, [P("Thanks. I'd best get going.", CHAT.HAPPY1), H("Good luck, adventurer.", CHAT.NEUTRAL1)])],
    ], exclude);
  }

  /** Recorded difference: live's third option here is "Thanks. I'd best get going." [635]; the Wiki's is followed. */
  function windmillMenu(player, exclude) {
    menu(player, [
      [BASICS, () => basics(player, (label) => windmillMenu(player, label))],
      ["Could I have a weapon for stabbing?", () => questKit(player, KIT.MELEE, "Could I have a weapon for stabbing?", "Of course!")],
      ["I'd best get going.", () => goodLuck(player, "I'd best get going.")],
    ], exclude);
  }

  /** The Wiki lists two options here. */
  function mageMenu(player, exclude) {
    menu(player, [
      [BASICS, () => basics(player, (label) => mageMenu(player, label))],
      ["Do you have a spare ranged weapon?", () => questKit(player, KIT.RANGED, "Do you have a spare ranged weapon?", "I do indeed!")],
    ], exclude);
  }

  function warriorMenu(player, exclude) {
    menu(player, [
      [BASICS, () => basics(player, (label) => warriorMenu(player, label))],
      ["Do you have a spare magic weapon?", () => questKit(player, KIT.MAGIC, "Do you have a spare magic weapon?", "I do indeed!")],
      ["I'd best get going.", () => goodLuck(player, "I'd best get going.")],
    ], exclude);
  }

  // --- the kits ----------------------------------------------------------------------------

  const KIT = { MELEE: 0, RANGED: 1, MAGIC: 2 };
  const KIT_BONUS = [BONUS.MELEE, BONUS.RANGED, BONUS.MAGIC];
  const KIT_VARBIT = [VARBIT.BONUS_MELEE, VARBIT.BONUS_RANGED, VARBIT.BONUS_MAGIC];
  const KIT_ASK = ["Could I have a shortsword and a shield?", "Could I have a shortbow and some arrows?", "Could I have a staff and some runes?"];
  const KIT_CLAIM = ["Claim a shortsword and a shield.", "Claim a shortbow and some arrows.", "Claim a staff and some runes."];
  /** Wiki: the sword from the ranger fight on, the bow once the ranger is dead, the staff once the mage is. */
  const KIT_FROM = [STAGE.WINDMILL, STAGE.RANGER_DEAD, STAGE.MAGE_DEAD];
  const { BRONZE_SHORTSWORD: SWORD, WOODEN_SHIELD: SHIELD, SHORTBOW: BOW, BRONZE_ARROW: ARROWS, STAFF, MIND_RUNE, AIR_RUNE } = ItemIdentifiers;

  const kitAvailable = (player, kit) => common.complete(player) || stageOf(player) >= KIT_FROM[kit];
  const kits = (player) => [KIT.MELEE, KIT.RANGED, KIT.MAGIC].filter((kit) => kitAvailable(player, kit));
  const bonuses = (player) => Number(player.getAttribute(ATTRIBUTE.BONUSES)) || 0;
  const bonusLeft = (player, kit) => (bonuses(player) & KIT_BONUS[kit]) === 0;

  function waitLeft(player) {
    const left = CLAIM_WAIT_MS - (Date.now() - (Number(player.getAttribute(ATTRIBUTE.LAST_CLAIM)) || 0));
    return left > 0 ? Math.max(1, Math.round(left / 60000)) : 0;
  }

  const claimable = (player, kit) => waitLeft(player) === 0 || bonusLeft(player, kit);
  const anyClaimable = (player) => kits(player).some((kit) => claimable(player, kit));
  const minutes = (player) => `${waitLeft(player)} ${waitLeft(player) === 1 ? "minute" : "minutes"}.`;
  const recently = (player) => `I've already given you some items recently. I only have so many available, so I can't go overboard. You'll have to come back in ${minutes(player)}`;

  /** Free slots a set of items needs: a stack already carried needs none. */
  function slotsFor(player, items) {
    const inventory = player.getInventory();
    return items.filter(([id]) => !(ItemDefinition.forId(id).isStackable() && inventory.getAmount(id) > 0)).length;
  }

  /** What a kit gives this player (Transcript:Captain Harlan). Cases the Wiki marks missing give nothing and say nothing. */
  function kitOutcome(player, kit) {
    const inventory = player.getInventory();
    const has = (id) => inventory.getAmount(id) > 0;
    const free = inventory.getFreeSlots();
    if (kit === KIT.MELEE) {
      if (has(SWORD) && has(SHIELD)) return { text: "You already have a shortsword and a shield. Save some for the other adventurers." };
      if (!has(SWORD) && !has(SHIELD)) {
        return free >= 2
          ? { grant: [[SWORD, 1], [SHIELD, 1]], box: { items: [SWORD, SHIELD], text: "Captain Harlan gives you a bronze shortsword and a wooden shield." } }
          : { text: "Ah, you don't have enough space for me to give you a shortsword, or a shield to go with it." };
      }
      if (has(SHIELD)) {
        return free >= 1 ? { grant: [[SWORD, 1]], box: { item: SWORD, text: "You already have a wooden shield, but Captain Harlan gives you a bronze shortsword to go with it." } } : {};
      }
      return {};
    }
    if (kit === KIT.RANGED) {
      if (!has(BOW)) {
        return free >= 1
          ? { grant: [[BOW, 1], [ARROWS, 40]], box: { items: [BOW, ARROWS], text: "Captain Harlan gives you a shortbow and 40 bronze arrows." } }
          : { text: "You don't have enough space for me to give you a shortbow, nor any arrows." };
      }
      return slotsFor(player, [[ARROWS, 40]]) <= free
        ? { grant: [[ARROWS, 40]], box: { item: ARROWS, text: "You already have a shortbow, but Captain Harlan gives you 40 bronze arrows to go with it." } }
        : { text: "I can see you already have a shortbow. I'd give you some arrows for it, but you don't have enough space for them." };
    }
    if (!has(STAFF)) {
      return slotsFor(player, [[STAFF, 1], [MIND_RUNE, 40], [AIR_RUNE, 40]]) <= free
        ? { grant: [[STAFF, 1], [MIND_RUNE, 40], [AIR_RUNE, 40]], box: { items: [STAFF, MIND_RUNE], text: "Captain Harlan gives you a staff, 40 mind runes and 40 air runes." } }
        : { text: "You don't have enough space for me to give you a staff, nor any runes." };
    }
    return slotsFor(player, [[MIND_RUNE, 40], [AIR_RUNE, 40]]) <= free
      ? { grant: [[MIND_RUNE, 40], [AIR_RUNE, 40]], box: { items: [MIND_RUNE, AIR_RUNE], text: "You already have a staff, but Captain Harlan gives you 40 mind runes and 40 air runes to go with it." } }
      : { text: "I can see you already have a staff. I'd give you some runes to go with it, but you don't have enough space for them." };
  }

  /** Gives a kit; the entries that show it. A kit given uses the style's bonus and starts the wait. */
  function giveKit(player, kit) {
    const outcome = kitOutcome(player, kit);
    if (!outcome.grant) return outcome.text ? [H(outcome.text)] : [];
    for (const [id, amount] of outcome.grant) player.getInventory().forceAdd(player, new Item(id, amount));
    player.setAttribute(ATTRIBUTE.LAST_CLAIM, Date.now());
    player.setAttribute(ATTRIBUTE.BONUSES, bonuses(player) | KIT_BONUS[kit]);
    player.getPacketSender().sendVarbit(KIT_VARBIT[kit], 1);
    return [outcome.box];
  }

  /** "Do you have any weapons I could have?" [1382-1400, 1418-1422]. */
  function weapons(player) {
    const label = "Do you have any weapons I could have?";
    if (!anyClaimable(player)) {
      const all = kits(player).length === 3;
      play(player, [P(label, CHAT.QUIZ1), H(all
        ? `I do have quite a few spare things, but I've already given you some recently. I only have so many available, so I can't go overboard. You'll have to come back in ${minutes(player)}`
        : recently(player), CHAT.NEUTRAL4)]);
      return;
    }
    const available = kits(player);
    // Ours: with only the sword unlocked (the Wiki marks his line missing) the menu comes straight away.
    const prompt = available.length === 3
      ? H("Yes, I do have quite a few spare things. I can sort you out with a shortsword and a shield, a shortbow with some arrows, or a staff with some runes. Which would you like?", CHAT.NEUTRAL4)
      : available.length === 2
        ? H("Yes, I do have quite a few spare things. I can sort you out with a shortsword and a shield, or a shortbow with some arrows. Which would you like?", CHAT.NEUTRAL4)
        : null;
    play(player, [P(label, CHAT.QUIZ1), prompt], () => kitMenu(player, null));
  }

  /** The kit menu; it comes back without the kit just asked for, and leaves for his main menu once nothing more can be given. */
  function kitMenu(player, last) {
    const options = kits(player).filter((kit) => kit !== last).map((kit) => [KIT_ASK[kit], () => askKit(player, kit)]);
    options.push([last === null ? "Actually, let's talk about something else." : "Let's talk about something else.", () => {
      if (last === null) play(player, [P("Actually, let's talk about something else.", CHAT.QUIZ1)], () => mainMenu(player, "Do you have any weapons I could have?"));
      else mainMenu(player, "Do you have any weapons I could have?");
    }]);
    play(player, [{ menu: "Select an option", options }]);
  }

  const kitNext = (player, kit) => (anyClaimable(player) ? kitMenu(player, kit) : mainMenu(player, "Do you have any weapons I could have?"));

  function askKit(player, kit) {
    if (!claimable(player, kit)) {
      play(player, [P(KIT_ASK[kit], CHAT.QUIZ1), H(recently(player), CHAT.NEUTRAL3)], () => kitNext(player, kit));
      return;
    }
    play(player, [P(KIT_ASK[kit], CHAT.QUIZ1), ...giveKit(player, kit), H("Now, is there anything else you need?", CHAT.QUIZ1)], () => kitNext(player, kit));
  }

  /** A kit asked for in a quest talk ("Could I have a weapon for stabbing?", ...): the Wiki's lines around it. */
  function questKit(player, kit, label, yes) {
    if (!claimable(player, kit)) {
      play(player, [P(label, CHAT.QUIZ1), H(`I'm afraid I've already given you some items recently. I only have so many available, so I can't go overboard. You'll have to come back in ${minutes(player)}`)]);
      return;
    }
    play(player, [
      P(label, CHAT.QUIZ1),
      H(yes, CHAT.HAPPY1),
      ...giveKit(player, kit),
      P("Thanks. I'd best get going.", CHAT.HAPPY1),
      // Recorded difference: live ends here [623-625]; the Wiki has his "Good luck, adventurer.".
      H("Good luck, adventurer.", CHAT.NEUTRAL1),
    ]);
  }

  /** The Claim-weapons option: the Wiki's "Claiming weapons" menu, each entry as its kit-menu question. */
  function claimWeapons({ player }) {
    const available = kits(player);
    if (!available.length) return talk({ player });
    play(player, [{ menu: "Select an option", options: [
      ...available.map((kit) => [KIT_CLAIM[kit], () => {
        if (!claimable(player, kit)) {
          play(player, [H(recently(player), CHAT.NEUTRAL3)]);
          return;
        }
        play(player, [...giveKit(player, kit), H("Now, is there anything else you need?", CHAT.QUIZ1)], () => kitNext(player, kit));
      }]),
      ["Cancel.", null],
    ] }]);
    return true;
  }

  // --- the report --------------------------------------------------------------------------

  function report(player) {
    const label = "All of those thieves have been dealt with.";
    if (stageOf(player) >= STAGE.REWARD) {
      // Ours: Mudfoot has gone; the reward is all that is left.
      play(player, [P(label, CHAT.HAPPY1)], () => deps.reward(player));
      return;
    }
    if (!deps.following(player)) {
      play(player, [P(label, CHAT.HAPPY1), H("Excellent! Why don't you go and fetch your goblin friend, and then we can discuss your reward.")]);
      return;
    }
    play(player, [
      P(label, CHAT.HAPPY1),
      H("Excellent! Did you manage to work out why they did it?", CHAT.HAPPY2),
      P("It seems they were trying to stir up trouble and frame the goblins for it. At least one of them was a H.A.M. supporter, or maybe a full member.", CHAT.NEUTRAL3),
      H("I see... It seems H.A.M. are starting to become more problematic. That is unfortunate...", CHAT.SUSPECTING),
      H("Anyway, that's one for me to worry about. Shall we get you sorted out with your reward?", CHAT.NEUTRAL2),
      M("Yes, reward good. Me also give back stolen items. Me take good care of them. Nothing missing at all. Me check two times.", CHAT.HAPPY3),
      { items: [ItemIdentifiers.TINDERBOX, ItemIdentifiers.SHEARS], text: "Mudfoot gives Captain Harlan the items from the General Store." },
      H("Many thanks. Now, the bounty was for 1,000 coins, so that's 500 coins each.", CHAT.HAPPY2),
      M("500? But me the boss. Human just trusty sidekick. Me should get more money. Bigger money too. Boss always bigger than sidekick, so money be bigger to match.", CHAT.CONFUSED3),
      P("Mudfoot...", CHAT.DISGRUNTLED),
      M("Hmm... But me suppose you do good job. Me actually quite proud of sidekick. Not as proud as me am of me, but still close. One day you maybe be as good at quests as me.", CHAT.CONFUSED4),
      M("Okay, just this once, sidekick can have full 500.", CHAT.HAPPY1),
      { item: COINS_250_MODEL, text: "Captain Harlan gives Mudfoot his half of the bounty." },
      M("Okay, me go now. Time to find new quest. Maybe me solve big mystery this time.", CHAT.CONFUSED2),
      P("What kind of mystery?", CHAT.QUIZ1),
      M("Me no know. That why it mystery. Bye now.", CHAT.CONFUSED1),
      P("See you around, Mudfoot.", CHAT.HAPPY1),
    ], () => deps.mudfootDeparts(player, STAGE.REWARD, VIS.NONE, () => deps.reward(player)));
  }

  /**
   * His last lines [1326]: the reward needs four free slots and one for the coins (Wiki); without them the
   * Wiki's "make some space" lines and the quest waits at stage 30.
   */
  function rewardLines(player, onComplete) {
    const inventory = player.getInventory();
    const needed = 4 + (inventory.getAmount(ItemIdentifiers.COINS) > 0 ? 0 : 1);
    if (inventory.getFreeSlots() < needed) {
      play(player, [
        H("Right then... Let's get you sorted with your half of the bounty. Alongside the coins I promised, I also have some lamps here that I think you'll find useful. I just need you to make some space for them."),
        P("Okay, I'll be back shortly."),
      ]);
      return;
    }
    play(player, [H("Right then... Thanks for all of your help with those thieves, adventurer. Here's your half of the bounty, along with some lamps that I think you'll find useful. All the best!", CHAT.HAPPY4)], onComplete);
  }

  return { talk, claimWeapons, mainMenu, afterSceneMenu, rewardLines, kitOutcome, waitLeft, KIT, H, M };
};
