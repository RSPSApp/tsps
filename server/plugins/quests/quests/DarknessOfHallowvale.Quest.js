/**
 * Darkness of Hallowvale (members).
 *
 * Aligned with a full live playthrough (rsprox capture, revision 242, the user's recording
 * "Darkness of Hallowvale"); the facts each step relies on, with capture ticks, are in
 * docs/quests/darkness-of-hallowvale/README.md. Words come from the "Darkness of Hallowvale"
 * transcript page (npc-dialogues.json); the units below pick its variants and do what live did
 * around them.
 *
 * The stage is varbit 2573 with live's values; the rest of the quest's state is live's own quest
 * varbits (varps 869/870), which the cache's multilocs (the Burgh boat and chute, the Meiyerditch
 * floorboards, push walls, table trapdoor, ladder wall and hideout trapdoor, the Paterdomus bush, the
 * laboratory's portrait, tapestry and statue) and multinpcs (Safalaan, Sarius) read per player.
 * See ../hallowvale/State.DarknessOfHallowvale.js.
 *
 * Units (../hallowvale/):
 * - Boat: Veliaf's start, the boat and chute repairs, the push, the boat ride and the dock rocks
 *   (stages 0-50, and the return trips).
 * - Ghetto: the floorboards, the citizens, Old Man Ral, the rooftop route and the hideout entry
 *   (50-80, and the hideout trapdoor at every later visit).
 * - Errands: Vertida's message, Veliaf, Drezel, the bush and the werewolves, King Roald and
 *   Aeonisig's teleport (80-180).
 * - Hassle: the vyrewatch who stop the player in Meiyerditch, and the mine punishment.
 * - Sketches: Safalaan, the three castle sketches, the western scene, Vanstrom's ambush and Sarius
 *   (180-250).
 * - Lab: the fireplace, Safalaan's hand-in, the portrait, tapestry, statue and laboratory, the
 *   sealed message, completion and the Tome of Experience (250-320).
 */
module.exports = function registerDarknessOfHallowvaleQuest(api) {
  const { Skill } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");
  const { createState, STAGE, VARBIT } = require("../hallowvale/State.DarknessOfHallowvale");
  const { createCommon, PAGE } = require("../hallowvale/Common.DarknessOfHallowvale");

  let quest;
  const state = createState(api, () => quest);
  const common = createCommon(api, state);

  /** Live's completion jingle and scroll model (capture t7755: jingle 154, model 9661). */
  const COMPLETION_JINGLE = 154;
  const COMPLETE_ICON_ITEM_ID = 9661; // myq3_quest_complete_icon
  const REWARD_XP = [
    { skill: Skill.AGILITY, amount: 7000, label: "Agility" },
    { skill: Skill.THIEVING, amount: 6000, label: "Thieving" },
    { skill: Skill.CONSTRUCTION, amount: 2000, label: "Construction" },
  ];

  // ---------------------------------------------------------------------------
  // Requirements (shared with the units through `requirements`)
  // ---------------------------------------------------------------------------

  // Cache DB row 22 column 23: Strength 40, Magic 33, Crafting 32, Agility 26, Thieving 22, Mining 20,
  // Construction 5.
  const REQUIRED_SKILLS = [
    { skill: Skill.CONSTRUCTION, level: 5, label: "Construction", boostable: true },
    { skill: Skill.MINING, level: 20, label: "Mining" },
    // Wiki (Darkness of Hallowvale): "The level 22 Thieving requirement to begin the quest is boostable".
    { skill: Skill.THIEVING, level: 22, label: "Thieving", boostable: true },
    { skill: Skill.AGILITY, level: 26, label: "Agility", boostable: true },
    { skill: Skill.CRAFTING, level: 32, label: "Crafting" },
    { skill: Skill.MAGIC, level: 33, label: "Magic", boostable: true },
    { skill: Skill.STRENGTH, level: 40, label: "Strength" },
  ];

  /** In Aid of the Myreque must be complete before this quest can start. */
  function inAidComplete(player) {
    const request = { player, key: "in_aid_of_the_myreque", complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** Whether this Veliaf talk follows In Aid of the Myreque's completion scroll straight on (its Rod unit answers). */
  function continuingFromInAid(player) {
    const request = { player, continuing: false };
    api.emitCustomEvent("in-aid-of-the-myreque:continuing", request);
    return request.continuing === true;
  }

  /** A Taste of Hope owns Veliaf's rod hand-out while its own stage is in that window. */
  function tasteNeedsVeliafRod(player) {
    const request = { player, needsRod: false };
    api.emitCustomEvent("taste-of-hope:needs-veliaf-rod", request);
    return request.needsRod === true;
  }

  function skillLevel(skills, entry) {
    return entry.boostable ? skills.getCurrentLevel(entry.skill) : skills.getMaxLevel(entry.skill);
  }

  function meetsRequirements(player) {
    if (!inAidComplete(player)) return false;
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.every((entry) => skillLevel(skills, entry) >= entry.level);
  }

  function requirementsMessage(player) {
    if (!inAidComplete(player)) player.sendMessage("You must have completed In Aid of the Myreque to start this quest.");
    const skills = player.getSkillManager();
    for (const entry of REQUIRED_SKILLS) {
      if (skillLevel(skills, entry) < entry.level) player.sendMessage(`You need ${entry.level} ${entry.label} to start this quest.`);
    }
  }

  const requirements = { inAidComplete, continuingFromInAid, tasteNeedsVeliafRod, meetsRequirements, requirementsMessage };
  const context = { api, state, common, requirements, STAGE, VARBIT, PAGE, quest: () => quest };

  // ---------------------------------------------------------------------------
  // Journal (ours: live's journal text was not captured; the stage meanings are live's)
  // ---------------------------------------------------------------------------

  const JOURNAL = [
    [STAGE.SEALED_MESSAGE, [
      "Safalaan gave me a <col=800000>sealed message</col> for Veliaf.",
      "",
      "I should take it to <col=800000>Veliaf Hurtz</col> in the basement of the",
      "pub in <col=800000>Burgh de Rott</col> to finish the quest.",
    ]],
    [STAGE.LAB_OPENED, [
      "I found the laboratory beneath the statue.",
      "",
      "I should search it, then take what I find to <col=800000>Safalaan</col>.",
    ]],
    [STAGE.MESSAGE_SHOWN, [
      "Safalaan read Sarius' message: the laboratory is behind the",
      "<col=800000>tapestry</col> and the <col=800000>vampyre statue</col> near the hideout.",
    ]],
    [STAGE.FIREPLACE_OPENED, [
      "I found a <col=800000>message</col> behind the fireplace tiles.",
      "",
      "I should show it to <col=800000>Safalaan</col> in the hideout.",
    ]],
    [STAGE.SARIUS_TALKED, [
      "Sarius Guile saved me from Vanstrom. Her message is hidden 'behind",
      "tiles where smoke is carried away from the depiction of statuesque evil'.",
      "",
      "I should finish the sketches and take them to <col=800000>Safalaan</col>.",
    ]],
    [STAGE.VANSTROM_ATTACKS, [
      "Vanstrom Klause attacked me while I was sketching the southern approach.",
    ]],
    [STAGE.WEST_SKETCHED, [
      "I have sketched the northern and western approaches to Castle Drakan.",
      "",
      "I should sketch the <col=800000>southern approach</col>.",
    ]],
    [STAGE.NORTH_SKETCHED, [
      "I have sketched the northern approach to Castle Drakan.",
      "",
      "I should sketch the <col=800000>western approach</col>.",
    ]],
    [STAGE.SKETCHING, [
      "Safalaan asked me to sketch Castle Drakan from the north, then",
      "the west, then the south.",
    ]],
    [STAGE.SAFALAAN_DESCRIBED, [
      "Vertida told me to find <col=800000>Safalaan</col>, who is scouting",
      "<col=800000>Castle Drakan</col> from the walls.",
    ]],
    [STAGE.SENT_BACK, [
      "Veliaf wants me to take the news to the Sanguinesti Myreque.",
      "",
      "I should find <col=800000>Vertida</col> in the Meiyerditch hideout.",
    ]],
    [STAGE.BACK_AT_PATERDOMUS, [
      "King Roald would not help. I should report back to",
      "<col=800000>Veliaf Hurtz</col> in Burgh de Rott.",
    ]],
    [STAGE.ROALD_REFUSED, [
      "King Roald refused to send troops because of the Guthixian edicts.",
    ]],
    [STAGE.RUNES_GIVEN, [
      "Drezel gave me runes for a Varrock teleport.",
      "",
      "I should speak to <col=800000>King Roald</col> in Varrock Castle.",
    ]],
    [STAGE.WEREWOLVES_SEEN, [
      "I was knocked out while searching the bush outside Paterdomus.",
      "",
      "I should tell <col=800000>Drezel</col> what I saw.",
    ]],
    [STAGE.DREZEL_TALKED, [
      "Drezel says strange noises have been heard outside Paterdomus.",
      "",
      "I should search the <col=800000>bush</col> outside the temple.",
    ]],
    [STAGE.SENT_TO_DREZEL, [
      "Veliaf wants me to find out what <col=800000>Drezel</col> has seen at Paterdomus.",
    ]],
    [STAGE.VERTIDA_MESSAGE, [
      "Vertida gave me a <col=800000>message</col> for Veliaf.",
      "",
      "I should take it to <col=800000>Veliaf Hurtz</col> in Burgh de Rott.",
    ]],
    [STAGE.IN_HIDEOUT, [
      "I made it into the Sanguinesti Myreque hideout.",
      "",
      "I should speak to <col=800000>Vertida</col>.",
    ]],
    [STAGE.ROUTE_KNOWN, [
      "Old Man Ral told me to follow the <col=800000>sickle symbols</col> across the",
      "rooftops to reach the Myreque hideout in sector three.",
    ]],
    [STAGE.RAL_INTRODUCED, [
      "A citizen told me to speak to <col=800000>Old Man Ral</col>, the 'sage of",
      "Sanguinesti', in the centre of sector one.",
    ]],
    [STAGE.ARRIVED, [
      "I reached Meiyerditch. I should ask a <col=800000>citizen</col>, quietly,",
      "about the Myreque.",
    ]],
    [STAGE.CHUTE_FIXED, [
      "The boat and its chute are repaired.",
      "",
      "I should push the boat into the water and row it across.",
    ]],
    [STAGE.BOAT_FIXED, [
      "The boat is repaired. I should repair the <col=800000>boat chute</col>.",
    ]],
    [STAGE.STARTED, [
      "Veliaf wants me to find a way into the Sanguinesti region and",
      "make contact with the Myreque there.",
      "",
      "I should repair the <col=800000>boat</col> at the Burgh de Rott docks.",
    ]],
  ];

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE.COMPLETE) {
      return [
        "<str>Veliaf asked me to make contact with the Sanguinesti Myreque.</str>",
        "<str>I reached the hideout in Meiyerditch and carried their messages.</str>",
        "<str>I sketched Castle Drakan and found the laboratory.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    for (const [value, lines] of JOURNAL) if (stage >= value) return lines;
    return [
      "I can start this quest by talking to <col=800000>Veliaf Hurtz</col> in the",
      "basement of the pub in <col=800000>Burgh de Rott</col>.",
      "",
      "I need to have completed <col=800000>In Aid of the Myreque</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    for (const reward of REWARD_XP) skills.addExperiences(reward.skill, reward.amount);
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  function handleLogin({ player }) {
    state.migrate(player);
    state.replay(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    state.clearTransient(player);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  state.register();
  quest = registerQuest(api, {
    key: "darkness_of_hallowvale",
    name: "Darkness of Hallowvale",
    varpId: 869, // myreque_3_main_var
    varbitId: VARBIT.QUEST,
    startedValue: STAGE.STARTED,
    completionValue: STAGE.COMPLETE,
    completionJingleId: COMPLETION_JINGLE,
    questPoints: 2,
    xpRewards: REWARD_XP.map((reward) => ({ skillId: reward.skill.getIndex(), amount: reward.amount, label: reward.label })),
    // Live's scroll (capture t7755, interface 153 lines 9-13) and its model.
    rewardText: [
      "2 Quest Points",
      "7,000 Agility XP",
      "6,000 Thieving XP",
      "2,000 Construction XP",
      "A Tome of Experience",
    ],
    scrollItemId: COMPLETE_ICON_ITEM_ID,
    buildJournal,
    onReward: grantReward,
  });

  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);

  require("../hallowvale/Boat.DarknessOfHallowvale")(context);
  require("../hallowvale/Ghetto.DarknessOfHallowvale")(context);
  require("../hallowvale/Errands.DarknessOfHallowvale")(context);
  require("../hallowvale/Hassle.DarknessOfHallowvale")(context);
  require("../hallowvale/Sketches.DarknessOfHallowvale")(context);
  require("../hallowvale/Lab.DarknessOfHallowvale")(context);
};
