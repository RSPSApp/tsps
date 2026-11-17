/**
 * Mudfoot's Big Adventure: ids, stages, saved state and the dialogue player the units share.
 *
 * Sources: the rsprox capture MudfootsBigAdventure (rev 242.1, the whole quest in one session; ticks below
 * are its ticks) and the OSRS Wiki (Transcript:Mudfoot's Big Adventure, Transcript:Captain Harlan,
 * Outlaw (Mudfoot's Big Adventure)); the cache wins on ids (docs/quests/mudfoots-big-adventure/README.md).
 */
const QUEST_KEY = "mudfoots_big_adventure";
const QUEST_NAME = "Mudfoot's Big Adventure";

/** The `mba` varbit (16779) as live sets it (capture ticks in brackets). */
const STAGE = {
  NOT_STARTED: 0,
  STARTED: 2, // "Yes." to Harlan's offer [127]
  SENT: 4, // his "Good luck, adventurer." [138]
  RECRUITED: 6, // "That sounds... wonderful." to Mudfoot [276]
  HARLAN_TALK: 8, // the store scene's walk back to Harlan [437]
  WINDMILL: 10, // "Mudfoot departs." [583]
  RANGER_FIGHT: 12, // the windmill fight opens [722]
  RANGER_DEAD: 14, // the ranger dies [751]
  TO_MAGE: 16, // "So directly south of here." [791]
  MAGE_FIGHT: 18, // [896]
  MAGE_DEAD: 20, // [926]
  TO_WARRIOR: 22, // "So south east of here." [971]
  WARRIOR_FIGHT: 24, // [1159]
  WARRIOR_DEAD: 26, // [1193]
  REPORT: 28, // "Shall we go tell him then?" [1203]
  REWARD: 30, // "Mudfoot departs." at Harlan [1322]
  COMPLETE: 32, // [1332]
};

/**
 * `mba_mudfoot_vis` (16782): which Mudfoot the cache shows. The base NPCs transform on it (16823 at 1, 16824
 * at 3, 16825 at 4, 16826 at 5; the followers 16827/16828 at 2). During a fight it holds the spot he waits at
 * if the player leaves (3 windmill, 4 woods), and a kill moves it to the next spot and then to 2 in one tick.
 */
const VIS = { NONE: 0, HOUSE: 1, FOLLOWING: 2, WINDMILL: 3, WOODS: 4, GRAVEYARD: 5 };

const VARBIT = {
  STAGE: 16779, // mba
  HARLAN_INTRO: 16780, // captain_harlan_intro: set as he first greets the player [18]
  MUDFOOT_VIS: 16782, // mba_mudfoot_vis
  MET_MUDFOOT_EARLY: 16783, // captain_harlan_met_mudfoot_early
  BONUS_MELEE: 16784, // captain_harlan_bonus_melee_giveaway [622]
  BONUS_RANGED: 16786, // captain_harlan_bonus_ranged_giveaway [1392]
  BONUS_MAGIC: 16787, // captain_harlan_bonus_magic_giveaway [1399]
  FIRST_THIEF_TOLD: 16788, // mudfoot_first_thief_dialogue: his "Other goblins see three humans..." [278]
  LAMPS: 16789, // mba_lamps: lamps rubbed [1490-1502]
};

const NPC = {
  HARLAN: 16821, // captain_harlan
  HARLAN_CUTSCENE: 16822, // captain_harlan_cutscene
  MUDFOOT_HOUSE: 16823, // mba_mudfoot_ruined_building
  MUDFOOT_WINDMILL: 16824, // mba_mudfoot_windmill
  MUDFOOT_WOODS: 16825, // mba_mudfoot_woods
  MUDFOOT_GRAVEYARD: 16826, // mba_mudfoot_graveyard
  MUDFOOT_FOLLOWER: 16827, // mba_mudfoot_follower (warhammer)
  MUDFOOT_FOLLOWER_SPEAR: 16828, // mba_mudfoot_follower_spear
  MUDFOOT: 16829, // mba_mudfoot_vis: the scene and report chatheads
  MUDFOOT_SPEAR: 16830, // mba_mudfoot_spear_vis
  MUDFOOT_SPEAR_COMBAT: 16831, // mba_mudfoot_spear_combat
  MUDFOOT_ROCKS_COMBAT: 16832, // mba_mudfoot_rocks_combat
  RANGER_STORE: 16833, // mba_outlaw_ranged_general_store
  RANGER_WINDMILL: 16834, // mba_outlaw_ranged_windmill
  RANGER_VIS: 16835, // mba_outlaw_ranged_vis ("Confront")
  RANGER_NOOP: 16836, // mba_outlaw_ranged_noop_vis
  RANGER_COMBAT: 16837, // mba_outlaw_ranged_combat
  MAGE_WOODS: 16838, // mba_outlaw_magic_woods
  MAGE_VIS: 16839, // mba_outlaw_magic_vis
  MAGE_COMBAT: 16840, // mba_outlaw_magic_combat
  WARRIOR_GRAVEYARD: 16841, // mba_outlaw_melee_graveyard
  WARRIOR_VIS: 16842, // mba_outlaw_melee_vis
  WARRIOR_COMBAT: 16843, // mba_outlaw_melee_combat
};

/** Chathead animations live plays (the capture's if_setanim). */
const CHAT = {
  QUIZ1: 554, QUIZ2: 555, QUIZ3: 556, HAPPY1: 567, HAPPY2: 568, HAPPY3: 569, HAPPY4: 570,
  CONFUSED1: 575, CONFUSED2: 576, CONFUSED3: 577, CONFUSED4: 578, NEUTRAL1: 588, NEUTRAL2: 589, NEUTRAL3: 590,
  NEUTRAL4: 591, ANGRY1: 614, ANGRY2: 615, ANGRY3: 616, ANGRY4: 617, CONFUSED_IDLE: 13953, DISGRUNTLED: 13956,
  SUSPECTING: 13980,
};
/** Ours: lines the capture does not show take chatneu1. */
const DEFAULT_CHAT = CHAT.NEUTRAL1;

/** The base NPCs the chat shows Mudfoot by have no name of their own in the cache; live's chat says "Mudfoot" [195]. */
const MUDFOOT_HEADS = new Set([16823, 16824, 16825, 16826, 16827, 16828, 16829, 16830]);

const ATTRIBUTE = {
  MUDFOOT_VIS: "mudfoots-big-adventure:mudfoot-vis",
  HARLAN_MET: "mudfoots-big-adventure:harlan-met",
  MET_EARLY: "mudfoots-big-adventure:harlan-met-with-mudfoot",
  FIRST_THIEF_TOLD: "mudfoots-big-adventure:first-thief-told",
  BONUSES: "mudfoots-big-adventure:bonus-giveaways",
  LAST_CLAIM: "mudfoots-big-adventure:last-claim",
  LAMPS: "mudfoots-big-adventure:lamps-rubbed",
  /** 2: the stage holds live's values. Saves from before (1, 6, 10, 11, 14, 16, 20, 22, 26) are moved over at login. */
  SCHEME: "mudfoots-big-adventure:stage-scheme",
  /** Where a player saved inside a quest scene comes back. */
  SCENE_EXIT: "mudfoots-big-adventure:scene-exit",
  // The first version's keys, read once by the migration.
  LEGACY_WAITING: "mudfoots-big-adventure:mudfoot-waiting",
  LEGACY_GIVEAWAYS: "mudfoots-big-adventure:giveaways",
};
const STAGE_SCHEME = 2;

const BONUS = { MELEE: 1, RANGED: 2, MAGIC: 4 };

function createCommon(api) {
  const {
    ActionDialogue, DialogueChainBuilder, DoubleItemStatementDialogue, EndDialogue, GraphicStatementDialogue,
    ItemStatementDialogue, NpcDialogue, OptionDialogue, PlayerDialogue, StatementDialogue,
  } = api.core;
  let quest = null;

  const stageOf = (player) => (quest ? quest.getStage(player) : 0);
  const inProgress = (player) => stageOf(player) >= STAGE.STARTED && stageOf(player) < STAGE.COMPLETE;
  const complete = (player) => stageOf(player) >= STAGE.COMPLETE;
  const visOf = (player) => Number(player.getAttribute(ATTRIBUTE.MUDFOOT_VIS)) || 0;
  const flag = (player, key) => player.getAttribute(key) === true;

  function sendState(player) {
    const sender = player.getPacketSender();
    const bonuses = Number(player.getAttribute(ATTRIBUTE.BONUSES)) || 0;
    sender.sendVarbit(VARBIT.HARLAN_INTRO, flag(player, ATTRIBUTE.HARLAN_MET) ? 1 : 0);
    sender.sendVarbit(VARBIT.MUDFOOT_VIS, visOf(player));
    sender.sendVarbit(VARBIT.MET_MUDFOOT_EARLY, flag(player, ATTRIBUTE.MET_EARLY) ? 1 : 0);
    sender.sendVarbit(VARBIT.BONUS_MELEE, bonuses & BONUS.MELEE ? 1 : 0);
    sender.sendVarbit(VARBIT.BONUS_RANGED, bonuses & BONUS.RANGED ? 1 : 0);
    sender.sendVarbit(VARBIT.BONUS_MAGIC, bonuses & BONUS.MAGIC ? 1 : 0);
    sender.sendVarbit(VARBIT.FIRST_THIEF_TOLD, flag(player, ATTRIBUTE.FIRST_THIEF_TOLD) ? 1 : 0);
    sender.sendVarbit(VARBIT.LAMPS, Number(player.getAttribute(ATTRIBUTE.LAMPS)) || 0);
  }

  function setVis(player, value) {
    player.setAttribute(ATTRIBUTE.MUDFOOT_VIS, value);
    player.getPacketSender().sendVarbit(VARBIT.MUDFOOT_VIS, value);
  }

  function setFlag(player, key, varbit) {
    player.setAttribute(key, true);
    player.getPacketSender().sendVarbit(varbit, 1);
  }

  /** Runs `on` as the entry shows, before its text. */
  function hooked(entry, on) {
    if (!on) return entry;
    const send = entry.send.bind(entry);
    entry.send = (player) => { on(); send(player); };
    return entry;
  }

  /**
   * Plays a script. Entries: { npc, text, anim, name } (chat_left), { player: text, anim } (chat_right),
   * { box: text } (messagebox), { item, text } (objectbox), { items: [a, b], text } (objectbox_double),
   * { graphic, text } (graphicbox), { menu: title, options: [[label, fn], ...] }; any entry may carry `on`,
   * run as it shows. `then` runs after the last entry is continued; a chain that ends without opening
   * anything else closes the chatbox at once.
   */
  function play(player, entries, then) {
    const chain = new DialogueChainBuilder();
    const manager = player.getDialogueManager();
    const close = (entry) => {
      if (manager.getCurrent?.() !== entry) return;
      manager.reset();
      player.getPacketSender().sendInterfaceRemoval();
    };
    let index = 0;
    for (const entry of entries.filter(Boolean)) {
      let dialogue;
      if (entry.npc !== undefined) {
        const name = entry.name ?? (MUDFOOT_HEADS.has(entry.npc) ? "Mudfoot" : undefined);
        dialogue = new NpcDialogue(index, entry.npc, entry.text, name, entry.anim ?? DEFAULT_CHAT);
      } else if (entry.player !== undefined) {
        dialogue = new PlayerDialogue(index, entry.player, entry.anim ?? DEFAULT_CHAT);
      } else if (entry.box !== undefined) {
        dialogue = new StatementDialogue(index, entry.box);
      } else if (entry.items) {
        dialogue = new DoubleItemStatementDialogue(index, entry.items[0], entry.items[1], entry.text);
      } else if (entry.item !== undefined) {
        dialogue = new ItemStatementDialogue(index, entry.item, entry.text);
      } else if (entry.graphic !== undefined) {
        dialogue = new GraphicStatementDialogue(index, entry.graphic, entry.text);
      } else if (entry.menu !== undefined) {
        const options = entry.options;
        const menu = new OptionDialogue(index, {
          executeOption(option) {
            const choice = options[Number(option) - 1];
            choice?.[1]?.();
            close(menu);
          },
        }, ...options.map((option) => option[0])).setTitle(entry.menu);
        dialogue = menu;
      } else {
        continue;
      }
      chain.add(hooked(dialogue, entry.on));
      index++;
    }
    if (then) {
      const action = new ActionDialogue(index++, { execute: () => { then(); close(action); } });
      chain.add(action);
    }
    chain.add(new EndDialogue(index));
    manager.startDialogues(chain);
  }

  /** Script entries: an NPC's chat_left line and the player's chat_right line. */
  const npcLine = (npc, text, anim, extra = {}) => ({ npc, text, anim, ...extra });
  const playerLine = (text, anim, extra = {}) => ({ player: text, anim, ...extra });

  return {
    STAGE, VIS, VARBIT, NPC, CHAT, ATTRIBUTE, BONUS, STAGE_SCHEME, QUEST_KEY, QUEST_NAME,
    setQuest: (handle) => { quest = handle; },
    quest: () => quest,
    stageOf, inProgress, complete, visOf, flag, setVis, setFlag, sendState, play, npcLine, playerLine,
    setStage: (player, stage) => quest.setStage(player, stage),
  };
}

module.exports = { createCommon, STAGE, VIS, VARBIT, NPC, CHAT, ATTRIBUTE, BONUS, STAGE_SCHEME, QUEST_KEY, QUEST_NAME };
