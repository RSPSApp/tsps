/**
 * Tai Bwo Wannai Trio's shared state: ids, stages, saved progress and the helpers every unit file uses
 * (Timfraku, Lubufu, Tiadeche, Tinsay, Tamayu, Crafting, Village). `createState(api)` is called once by
 * TaiBwoWannaiTrio.Quest.js; the quest handle is set on it after registerQuest.
 *
 * Stages are the native tbwt_main varp (320), as RSProx captures local 1001562 (revision 241) and 75
 * (revision 227) set them: 1 once Timfraku has sent the player away (the continue past "Well then
 * <title>, you would do better to..."), 2 as the start prompt opens, 3 started, 4 the last son agrees
 * to return, 5 Timfraku's coins, 6 complete. The brothers' field and house NPCs are multinpcs on it
 * (6235/6237/6239 at 0-5, 6236/6238/6240 at 6).
 *
 * Tiadeche's progress is the native tbwt_tiadeche varp (321), mirrored from the saved attribute: 1 met,
 * 2 he wants a Karambwan, 3 he has the baited vessel, 4 he asks for the vessel to go to Tinsay, 5
 * Tinsay's manual, 6 the manual is his (local 1001562 ticks 6182-7917). 7 (post-quest Fishing XP
 * claimed) stays in the attribute only. Tinsay, Tamayu and Lubufu have no varp live sends; their
 * progress is saved attributes, as before (Cookers.Cooking.js and BarbarianTraining.plugin.js read
 * Tinsay's and Tamayu's).
 */
module.exports = function createState(api) {
  const { ItemIdentifiers: I, NpcIdentifiers: N, ObjectIdentifiers: O, Skill, Item, CountdownTask, TaskManager } = api.core;
  const { startTranscript, loadTranscripts } = require("../QuestRuntime");

  const t = {
    api,
    PAGE: "Tai Bwo Wannai Trio",
    /** Set by TaiBwoWannaiTrio.Quest.js once the quest is registered. */
    quest: null,

    VARP: 320, // tbwt_main
    TIADECHE_VARP: 321, // tbwt_tiadeche
    STAGE: Object.freeze({ NOT_STARTED: 0, MET: 1, PROMPTED: 2, STARTED: 3, BROTHERS_DONE: 4, REWARDED: 5, COMPLETE: 6 }),

    /**
     * Jungle Potion complete (varp 175 at 12; 13 once Trufitus is told): the transcript's "If the player has
     * completed Jungle Potion:". Captures show a player before it (JunglePotion t534-575) and at 13 (t1429),
     * none at 12, so the Wiki's condition decides.
     */
    JUNGLE_POTION_STAGE: "quest.jungle_potion.stage",
    JUNGLE_POTION_COMPLETE: 12,

    NPC: Object.freeze({
      TIMFRAKU: N.TIMFRAKU, // 4698
      TIADECHE: [N.TIADECHE, N.TIADECHE_2], // 4699, 4700
      TINSAY: [N.TINSAY, N.TINSAY_2], // 4701, 4702
      TAMAYU: [N.TAMAYU, N.TAMAYU_2, N.TAMAYU_3, N.TAMAYU_4], // 4703-4706
      LUBUFU: N.LUBUFU, // 4707
      HUNT_TAMAYU: 4705, // tbwt_tamayu_hunter
      HUNT_TAMAYU_VICTOR: 4706, // tbwt_tamayu_final_hunter
      HUNT_SHAIKAHAN: 4709, // tbwt_beast_cutscene
    }),

    ITEM: Object.freeze({
      COINS: I.COINS,
      COINS_STACK: 1003, // coins_1000: Timfraku's box picture (local 1001562 tick 8097)
      RAW_KARAMBWANJI: I.RAW_KARAMBWANJI, // 3150
      COOKED_KARAMBWANJI: 21394, // tbwt_quest_cooked_karambwanji (3151 is a Null)
      RAW_KARAMBWAN: I.RAW_KARAMBWAN, // 3142
      COOKED_KARAMBWAN: I.COOKED_KARAMBWAN, // 3144
      POORLY_COOKED_KARAMBWAN: I.POISON_KARAMBWAN, // 3146, tbwt_poorly_cooked_karambwan
      RAW_KARAMBWAN_PASTE: I.KARAMBWAN_PASTE, // 3152
      POISON_KARAMBWAN_PASTE: I.KARAMBWAN_PASTE_2, // 3153, tbwt_poisonous_karambwan_paste
      COOKED_KARAMBWAN_PASTE: I.KARAMBWAN_PASTE_3, // 3154
      RAW_KARAMBWANJI_PASTE: I.KARAMBWANJI_PASTE, // 3155
      COOKED_KARAMBWANJI_PASTE: I.KARAMBWANJI_PASTE_2, // 3156
      VESSEL: I.KARAMBWAN_VESSEL, // 3157
      LOADED_VESSEL: I.KARAMBWAN_VESSEL_3, // 3159, tbwt_karambwan_vessel_loaded_with_karambwanji
      CRAFTING_MANUAL: I.CRAFTING_MANUAL, // 3161
      BANANA: I.BANANA,
      SLICED_BANANA: I.SLICED_BANANA, // 3162
      KARAMJAN_RUM: I.KARAMJAN_RUM, // 431
      SLICED_BANANA_RUM: I.KARAMJAN_RUM_2, // 3164
      BANANA_RUM: I.KARAMJAN_RUM_3, // 3165
      SEAWEED: I.SEAWEED,
      MONKEY_CORPSE: I.MONKEY_CORPSE, // 3166
      MONKEY_SKIN: I.MONKEY_SKIN, // 3167
      MONKEY_BONES: I.MONKEY_BONES, // 3183, mm_normal_monkey_bones
      SEAWEED_SANDWICH: I.SEAWEED_SANDWICH, // 3168
      STUFFED_MONKEY: I.STUFFED_MONKEY, // 3169
      JOGRE_BONES: I.JOGRE_BONES, // 3125
      BURNT_JOGRE_BONES: I.BURNT_JOGRE_BONES, // 3127
      BURNT_RAW_PASTY_BONES: I.PASTY_JOGRE_BONES, // 3128
      BURNT_COOKED_PASTY_BONES: I.PASTY_JOGRE_BONES_2, // 3129
      MARINATED_BONES: I.MARINATED_J_BONES, // 3130, burnt
      RAW_PASTY_BONES: I.PASTY_JOGRE_BONES_3, // 3131
      COOKED_PASTY_BONES: I.PASTY_JOGRE_BONES_4, // 3132
      MARINATED_UNBURNT_BONES: I.MARINATED_J_BONES_2, // 3133
      ASHES: I.ASHES,
      TINDERBOX: I.TINDERBOX,
      PESTLE_AND_MORTAR: I.PESTLE_AND_MORTAR,
      KNIFE: I.KNIFE,
      RUNE_SPEAR_KP: I.RUNE_SPEAR_KP_,
      AGILITY_POTIONS: new Map([[I.AGILITY_POTION_4_, 4], [I.AGILITY_POTION_3_, 3], [I.AGILITY_POTION_2_, 2], [I.AGILITY_POTION_1_, 1]]),
    }),

    LOC: Object.freeze({
      STATUES: new Set([O.TRIBAL_STATUE, O.TRIBAL_STATUE_2, O.TRIBAL_STATUE_3]),
      BAMBOO_DOOR: O.BAMBOO_DOOR, // 779
      BURNING_BONES: 3862, // bones_in_paste_fire, "Burning bones"
      RAPIDS_ROCKS: 2231, // zqclimbingrocks, "Rocks"
    }),

    KEY: Object.freeze({
      TIADECHE: "quest.tai_bwo_wannai_trio.tiadeche",
      TINSAY: "quest.tai_bwo_wannai_trio.tinsay",
      TAMAYU: "quest.tai_bwo_wannai_trio.tamayu",
      LUBUFU: "quest.tai_bwo_wannai_trio.lubufu",
      AGILITY: "quest.tai_bwo_wannai_trio.agility",
      SPEAR: "quest.tai_bwo_wannai_trio.spear",
      TITLE: "quest.tai_bwo_wannai_trio.title",
      KARAMBWAN: "quest.tai_bwo_wannai_trio.karambwan",
      LUBUFU_COUNT: "quest.tai_bwo_wannai_trio.lubufu-count",
    }),

    TIADECHE: Object.freeze({ MET: 1, WAITING: 2, TRAPPED: 3, ASKED_MANUAL: 4, HAS_MANUAL: 5, DONE: 6, CLAIMED: 7 }),
    TINSAY: Object.freeze({ BANANA: 2, SANDWICH: 4, BONES: 6, DONE: 7, CLAIMED: 8 }),
    TAMAYU: Object.freeze({ MET: 2, WATCHED: 3, DONE: 4, CLAIMED: 5 }),
    /**
     * Lubufu: 1 met, 2 he has said what he does with his Karambwan (his bait offer shows), 5 + n bait
     * delivered (5 asked for it), 25 all 20 delivered, 26-27 "What do you use to catch Karambwan?" asked
     * once or twice since, 28 the apprenticeship refused, 31 apprentice.
     */
    LUBUFU: Object.freeze({ MET: 1, HEARD_KARAMBWAN: 2, FETCH: 5, GIVEN: 25, ASKED_TWICE: 27, REFUSED: 28, APPRENTICE: 31 }),
    LUBUFU_ASKS_BEFORE_OFFER: 3,

    /** The item used on an NPC, for the transcript's "if the player uses..." conditions. */
    lastUsedItem: new Map(),
  };

  t.state = (player, key) => Number(player.getAttribute(key)) || 0;
  t.setState = (player, key, value) => {
    player.setAttribute(key, value | 0);
    if (key === t.KEY.TIADECHE) t.sendTiadecheVarp(player);
  };
  t.raise = (player, key, value) => {
    if (t.state(player, key) < value) t.setState(player, key, value);
  };
  t.sendTiadecheVarp = (player) => {
    player.getPacketSender().sendConfig(t.TIADECHE_VARP, Math.min(t.state(player, t.KEY.TIADECHE), t.TIADECHE.DONE));
  };
  t.held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  t.take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  t.give = (player, itemId, amount = 1) => player.getInventory().forceAdd(player, new Item(itemId, amount));
  t.level = (player, skill) => player.getSkillManager().getCurrentLevel(skill);
  t.addXp = (player, skill, amount) => player.getSkillManager().addExperiences(skill, amount);
  t.stage = (player) => t.quest.getStage(player);
  t.junglePotionDone = (player) => t.state(player, t.JUNGLE_POTION_STAGE) >= t.JUNGLE_POTION_COMPLETE;
  t.isPage = (event) => (event?.pages ?? []).some((entry) => (entry?.page ?? entry) === t.PAGE);
  t.later = (player, ticks, callback) => TaskManager.submit(new CountdownTask(player, ticks, () => {
    if (player.isRegistered?.() !== false) callback();
  }));
  /** A timer not tied to a player: it runs on through a logout (a fire left burning). */
  const worldKey = {};
  t.worldLater = (ticks, callback) => TaskManager.submit(new CountdownTask(worldKey, ticks, callback));
  /**
   * A hand-out due `ticks` from now (an item box live shows a few ticks later): given then, or at once if the
   * player logs out first, so nothing taken from them is lost in the gap.
   */
  const pending = new WeakMap();
  t.giveLater = (player, ticks, give) => {
    const list = pending.get(player) ?? [];
    const entry = { give, done: false };
    list.push(entry);
    pending.set(player, list);
    t.later(player, ticks, () => {
      if (entry.done) return;
      entry.done = true;
      give();
      const left = (pending.get(player) ?? []).filter((other) => !other.done);
      if (left.length) pending.set(player, left);
      else pending.delete(player);
    });
  };
  t.flushPending = (player) => {
    for (const entry of pending.get(player) ?? []) {
      if (!entry.done) {
        entry.done = true;
        entry.give();
      }
    }
    pending.delete(player);
  };
  t.npcAnimation = (npc, id) => npc?.performAnimation?.(new api.core.Animation(id));
  t.play = (player, npcId, variant, select, npc = null) => startTranscript(api, player, npcId, t.PAGE, variant, select, npc);
  t.Skill = Skill;
  t.dialogueRecord = () => loadTranscripts(api)?.[t.PAGE];
  /** The first step (depth first, through options and the page's shared branches) `match` accepts. */
  t.findStep = (match) => {
    const record = t.dialogueRecord();
    const walk = (list) => {
      for (const step of list ?? []) {
        if (match(step)) return step;
        const found = walk(step.steps) ?? (step.options ?? []).map((option) => (match(option) ? option : walk(option.steps))).find(Boolean);
        if (found) return found;
      }
      return null;
    };
    for (const steps of [...Object.values(record?.variants ?? {}), ...Object.values(record?.branches ?? {})]) {
      const found = walk(steps);
      if (found) return found;
    }
    return null;
  };

  /** Every brother back at the village: the stage moves on (the last son's own talk, local 1001562 tick 7942). */
  t.updateBrothers = (player) => {
    if (t.stage(player) >= t.STAGE.BROTHERS_DONE) return;
    const home = t.state(player, t.KEY.TIADECHE) >= t.TIADECHE.DONE
      && t.state(player, t.KEY.TINSAY) >= t.TINSAY.DONE
      && t.state(player, t.KEY.TAMAYU) >= t.TAMAYU.DONE;
    if (home) t.quest.setStage(player, t.STAGE.BROTHERS_DONE);
  };

  /**
   * Line-keyed pauses: after the player continues past `text` (on Tai Bwo Wannai Trio's page), the chatbox
   * closes, `then(event)` runs (a message, an animation) and the conversation carries on `ticks` later, as
   * live plays them; `when(event)` can limit it to one branch. Registered by the unit files, which mark the
   * message steps their `then` already sent as handled.
   */
  t.pauses = new Map();
  t.pauseAfter = (speaker, text, ticks, then, when) => {
    t.pauses.set(`${speaker}|${text}`, { ticks, then, when });
  };
  /** The quest's line listener: applies a registered pause to the line it names. */
  t.applyPause = (event) => {
    if (!event.player || !t.isPage(event)) return;
    const step = event.step ?? {};
    const speaker = typeof step.player === "string" || /^player$/i.test(step.speaker ?? "") ? "Player" : step.speaker ?? "";
    const pause = t.pauses.get(`${speaker}|${event.text}`);
    if (!pause || (pause.when && !pause.when(event))) return;
    const before = event.after;
    event.after = () => {
      before?.();
      pause.then?.(event);
    };
    event.pauseTicks = pause.ticks;
  };

  return t;
};
