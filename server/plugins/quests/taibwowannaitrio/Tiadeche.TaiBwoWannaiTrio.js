/**
 * Tiadeche, as RSProx captures local 1001562 (revision 241, ticks 6182-6257, 6699-6730, 7903-7942) and 75
 * (revision 227, ticks 3660-3769, 4989-5007) play him. tbwt_tiadeche (varp 321): 0 -> 1 on the first
 * talk, 1 -> 2 as "I will return only when I have caught a Karambwan." shows, 2 -> 3 as the baited vessel is
 * handed over, 3 -> 4 as he asks for it to go to Tinsay, 4 -> 5 with Tinsay's manual (Tinsay's unit), 5 -> 6
 * as the manual is handed over.
 * - "As you say, Bwana." continued: "Tiadeche attempts to use the Karambwan vessel.", the chatbox closes, he
 *   lowers the vessel (human_octopus_pot) 2 ticks later and "Bwana! I cannot believe my eyes!" comes 12 ticks
 *   after the continue.
 * - Accepting his first catch: "Tiadeche hands you his first catch!" is an item box of the raw Karambwan,
 *   which comes with it. Left before his request, the next talk is "Can we return to the village now?".
 * - The manual handed over: jingle 189 as its box is continued.
 */
module.exports = function attachTiadeche(api, t) {
  const { STAGE, NPC, ITEM, KEY, TIADECHE } = t;
  const { Skill } = api.core;
  const IDS = new Set(NPC.TIADECHE);

  const KARAMBWAN_USED = "00m3t0";
  const EMPTY_VESSEL_USED = "sBS6JT";
  const KARAMBWANJI_USED = "8w39R7";
  const LOADED_VESSEL_USED = "GczJaQ";
  const EMPTY_VESSEL_BOX = "ZUMuMt";
  const EMPTY_VESSEL_BACK = "DSvWDo";
  const KARAMBWANJI_BOX = "ggBY_Z";
  const LOADED_VESSEL_BOX = "Tbc1Ao";
  const ATTEMPT_MESSAGES = ["4uBWh6", "zu0rzm"];
  const FIRST_CATCH_BOX = "Z-azHp";
  const FIRST_CATCH = "1kqTlj";
  const CONTINUES = new Set(["ANSmTx", "fXp887"]);
  const ANOTHER_CATCH_CONDITION = "yYWl4g";
  const ANOTHER_CATCH = "qZLfX8";
  const TAKEN_TO_TINSAY = "HAViRJ";
  const NOT_TAKEN = "-A0I8i";
  const NO_MANUAL = "79lVcQ";
  const HAS_MANUAL = "D6zlGH";
  const MANUAL_BOX = "IaGlW4";
  const TRAINS = "B1PNYN";
  const KNOWLEDGE = "OGt54i";
  const FISHING_XP = "C5UYJa";
  const OCTOPUS_POT = 1193; // human_octopus_pot
  const MANUAL_JINGLE = 189;

  const BEFORE_WANTS = "Your father requests that you return to the village.";
  const BEFORE_REQUEST = "And that is?";

  const VARIANT = {
    FIRST: "talking-to-tiadeche",
    USED: "talking-to-tiadeche-talking-to-tiadeche-again",
    TRAPPED: "talking-to-tiadeche-talking-to-tiadeche-after-he-traps-a-karambwan",
    LATER: "talking-to-tiadeche-subsequent-dialogue-with-tiadeche",
    REWARD: "post-quest-dialogue-with-the-brothers-talking-to-tiadeche",
    STALL: "post-quest-dialogue-with-the-brothers-subsequent-dialogue-with-tiadeche",
  };
  const USED_ITEMS = new Set([ITEM.VESSEL, ITEM.LOADED_VESSEL, ITEM.RAW_KARAMBWANJI, ITEM.RAW_KARAMBWAN, ITEM.COOKED_KARAMBWAN, ITEM.POORLY_COOKED_KARAMBWAN]);

  const progress = (player) => t.state(player, KEY.TIADECHE);

  function variant({ player, npcId }) {
    if (!IDS.has(npcId)) return null;
    t.lastUsedItem.delete(player);
    const value = progress(player);
    if (t.stage(player) >= STAGE.COMPLETE && value >= TIADECHE.DONE) return value >= TIADECHE.CLAIMED ? VARIANT.STALL : VARIANT.REWARD;
    if (t.stage(player) < STAGE.STARTED) return null;
    if (value >= TIADECHE.ASKED_MANUAL) return VARIANT.LATER;
    if (value === TIADECHE.TRAPPED) return VARIANT.TRAPPED;
    t.raise(player, KEY.TIADECHE, TIADECHE.MET);
    return VARIANT.FIRST;
  }

  function condition({ player, stepId }) {
    const used = t.lastUsedItem.get(player);
    switch (stepId) {
      case KARAMBWAN_USED: return used === ITEM.RAW_KARAMBWAN || used === ITEM.COOKED_KARAMBWAN || used === ITEM.POORLY_COOKED_KARAMBWAN;
      case EMPTY_VESSEL_USED: return used === ITEM.VESSEL;
      case KARAMBWANJI_USED: return used === ITEM.RAW_KARAMBWANJI;
      case LOADED_VESSEL_USED: return used === ITEM.LOADED_VESSEL;
      case ANOTHER_CATCH_CONDITION: return t.state(player, KEY.KARAMBWAN) < 1;
      case TAKEN_TO_TINSAY: return progress(player) >= TIADECHE.HAS_MANUAL;
      case NOT_TAKEN: return progress(player) < TIADECHE.HAS_MANUAL;
      case NO_MANUAL: return !t.held(player, ITEM.CRAFTING_MANUAL);
      case HAS_MANUAL: return t.held(player, ITEM.CRAFTING_MANUAL);
      default: return null;
    }
  }

  /**
   * The varp moves as his line shows, which is as the line before it is continued (line events come as the
   * conversation is queued, a few lines early): "Your father requests..." before "I will return only...",
   * "And that is?" before "Take a Karambwan vessel to my brother Tinsay.".
   */
  function line(event) {
    const { player, npcId, text, step } = event;
    if (!IDS.has(npcId) || !t.isPage(event) || typeof step?.player !== "string") return;
    const value = text === BEFORE_WANTS ? TIADECHE.WAITING : text === BEFORE_REQUEST ? TIADECHE.ASKED_MANUAL : 0;
    if (!value) return;
    const before = event.after;
    event.after = () => {
      before?.();
      t.raise(player, KEY.TIADECHE, value);
    };
  }

  function action(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    switch (stepId) {
      case EMPTY_VESSEL_BOX:
        t.take(player, ITEM.VESSEL);
        event.box = { items: [ITEM.VESSEL] };
        return;
      case EMPTY_VESSEL_BACK:
        t.give(player, ITEM.VESSEL);
        event.handled = true;
        return;
      case KARAMBWANJI_BOX:
        t.take(player, ITEM.RAW_KARAMBWANJI);
        event.box = { items: [ITEM.RAW_KARAMBWANJI] };
        return;
      case LOADED_VESSEL_BOX:
        t.take(player, ITEM.LOADED_VESSEL);
        t.raise(player, KEY.TIADECHE, TIADECHE.TRAPPED);
        event.box = { items: [ITEM.LOADED_VESSEL] };
        return;
      case FIRST_CATCH_BOX:
      case ANOTHER_CATCH:
        if (t.state(player, KEY.KARAMBWAN) < 1) {
          t.give(player, ITEM.RAW_KARAMBWAN);
          t.setState(player, KEY.KARAMBWAN, 1);
        }
        if (stepId === FIRST_CATCH_BOX) event.box = { items: [ITEM.RAW_KARAMBWAN] };
        else event.handled = true;
        return;
      case FIRST_CATCH:
        event.handled = true; // came with the box
        return;
      case MANUAL_BOX:
        t.take(player, ITEM.CRAFTING_MANUAL);
        t.raise(player, KEY.TIADECHE, TIADECHE.DONE);
        event.box = { items: [ITEM.CRAFTING_MANUAL] };
        event.after = () => player.getPacketSender().sendJingle(MANUAL_JINGLE, 0);
        return;
      case TRAINS:
        event.box = { items: [ITEM.RAW_KARAMBWAN] };
        return;
      case KNOWLEDGE:
        event.box = { statement: true };
        return;
      case FISHING_XP:
        if (progress(player) < TIADECHE.CLAIMED) {
          t.addXp(player, Skill.FISHING, 5000);
          t.setState(player, KEY.TIADECHE, TIADECHE.CLAIMED);
        }
        event.handled = true;
        return;
      default:
        if (CONTINUES.has(stepId)) event.handled = true;
        else if (ATTEMPT_MESSAGES.includes(stepId)) event.handled = true; // sent by the pause after "As you say, Bwana."
    }
  }

  function useOn(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!IDS.has(npcId) || t.stage(player) < STAGE.STARTED) return;
    const npc = event.npc ?? event.target ?? null;
    const value = progress(player);
    if (itemId === ITEM.CRAFTING_MANUAL && value >= TIADECHE.ASKED_MANUAL && value < TIADECHE.DONE) {
      t.play(player, npcId, VARIANT.LATER, undefined, npc);
      event.handled = true;
      return;
    }
    if (value !== TIADECHE.WAITING || !USED_ITEMS.has(itemId)) return;
    t.lastUsedItem.set(player, itemId);
    t.play(player, npcId, VARIANT.USED, undefined, npc);
    event.handled = true;
  }

  t.pauseAfter("Tiadeche", "As you say, Bwana.", 12, ({ player, npc }) => {
    player.sendMessage("Tiadeche attempts to use the Karambwan vessel.");
    t.later(player, 2, () => t.npcAnimation(npc, OCTOPUS_POT));
  });

  api.onNpcDialogueVariant(variant);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("npc-dialogue:action", action);
  api.onItemOnNpc(useOn);
  return { VARIANT };
};
