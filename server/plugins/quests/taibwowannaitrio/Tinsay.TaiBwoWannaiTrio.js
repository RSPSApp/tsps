/**
 * Tinsay, as RSProx captures local 1001562 (revision 241, ticks 7405-7764) and 75 (revision 227, ticks
 * 4794-4951) play him:
 * - "Tinsay pauses and then mutters to himself." as "Right ... what do you need?" is continued; the chatbox
 *   closes and his first request follows 4 ticks later.
 * - Each hand-in is an item box of what he takes, taken as it shows. The rum: he drinks it (human_drink_rum) as
 *   its box is continued and speaks 4 ticks later; "I'm thinking..." holds the chat 4 ticks; the sandwich: he
 *   eats it a tick after its box (human_eat) and speaks 5 ticks after it; the marinated bones: he eats them
 *   with jingle 188 as the box is continued, retches (human_wretch) 2 ticks later and speaks after 9.
 * - The vessel for Tiadeche: "Tinsay studies it..." as its box is continued, then 4 ticks later the
 *   manual's box, with the manual and tbwt_tiadeche 4 -> 5.
 */
module.exports = function attachTinsay(api, t) {
  const { STAGE, NPC, ITEM, KEY, TINSAY, TIADECHE } = t;
  const { Skill } = api.core;
  const IDS = new Set(NPC.TINSAY);

  const PAUSE_MESSAGE = "y3Vbh-";
  const VESSEL_TOO_EARLY = "mycL8b";
  const NO_RUM = "wkGJMe";
  const WHOLE_BANANA = "exk_5R";
  const SLICED_BANANA = "QDlylL";
  const DOESNT_HAVE_RUM = "3e7vFr";
  const STUFFED_BANANA = "VXRd1B";
  const RUM_BOX = "IXEFig";
  const WHOLE_BANANA_BOX = "xzzxiX";
  const PONDER = "LXwTh3";
  const DANCE = "UtApcf";
  const HAS_SANDWICH = "CKZ0T7";
  const HAS_STUFFED_MONKEY = "o9ILMF";
  const NO_SANDWICH = "i6dLag";
  const SEAWEED_IN_CORPSE = "MJSqdp";
  const KNIFE_ON_CORPSE = "fHuWt7";
  const SANDWICH_BOX = "pLz59h";
  const STUFFED_MONKEY_BOX = "BHHJe8";
  const EATS_SANDWICH = "MOaBEm";
  const PERFECT_BONES = "Ar9mSL";
  const PERFECT_BONES_BOX = "oYUlzJ";
  const BURNT_BONES_BACK = "9Y-LRA";
  const VESSEL_USED = "rOMRJI";
  const EMPTY_VESSEL = "yCJLDq";
  const LOADED_VESSEL = "4QFTNU";
  const VESSEL_BOXES = new Map([["e9Ifrf", ITEM.VESSEL], ["bOGzJV", ITEM.LOADED_VESSEL]]);
  const MANUAL_BOX = "eoqtfS";
  const MANUAL = "421qSm";
  const TRAINS = "D8g07Z";
  const COOKING_XP = "7ImFQ8";
  /** Third request: condition -> the bones it asks about; box -> the bones it takes (none: he hands them back). */
  const BONE_CONDITIONS = new Map([
    ["WMXxp-", ITEM.JOGRE_BONES], ["P0qdnY", ITEM.COOKED_PASTY_BONES], ["AHCnj-", ITEM.RAW_PASTY_BONES],
    ["lFWfhk", ITEM.BURNT_JOGRE_BONES], ["QztAou", ITEM.BURNT_RAW_PASTY_BONES], ["sMrB0F", ITEM.BURNT_COOKED_PASTY_BONES],
    ["Tz_TII", ITEM.MARINATED_UNBURNT_BONES],
  ]);
  const BONE_BOXES = new Map([
    ["9Dc7f8", [ITEM.JOGRE_BONES, false]], ["1hgXFH", [ITEM.COOKED_PASTY_BONES, true]], ["wOLrxV", [ITEM.RAW_PASTY_BONES, true]],
    ["ikziTk", [ITEM.BURNT_JOGRE_BONES, false]], ["OMlNu0", [ITEM.BURNT_RAW_PASTY_BONES, true]],
    ["coR50A", [ITEM.BURNT_COOKED_PASTY_BONES, true]], ["R2IY0e", [ITEM.MARINATED_UNBURNT_BONES, true]],
  ]);
  const DRINK_RUM = 1194; // human_drink_rum
  const EAT = 829; // human_eat
  const RETCH = 1196; // human_wretch
  const BONES_JINGLE = 188;
  const MANUAL_DELAY = 4;

  const VARIANT = {
    FIRST: "reaching-tinsay-talking-to-tinsay",
    RUM: "reaching-tinsay-talking-to-tinsay-again",
    SANDWICH: "reaching-tinsay-talking-to-tinsay-again-with-his-second-request",
    BONES: "reaching-tinsay-talking-to-tinsay-again-with-his-third-request",
    PERFECT: "making-the-burnt-marinated-jogre-bones-giving-tinsay-the-perfect-jogre-bones",
    LATER: "making-the-burnt-marinated-jogre-bones-subsequent-dialogue-with-tinsay",
    REWARD: "post-quest-dialogue-with-the-brothers-talking-to-tinsay",
    BACK: "post-quest-dialogue-with-the-brothers-subsequent-dialogue-with-tinsay",
  };

  const progress = (player) => t.state(player, KEY.TINSAY);
  const used = (player) => t.lastUsedItem.get(player);
  const hasRum = (player) => t.held(player, ITEM.SLICED_BANANA_RUM) || t.held(player, ITEM.BANANA_RUM);

  function variant({ player, npcId }) {
    if (!IDS.has(npcId)) return null;
    t.lastUsedItem.delete(player);
    const value = progress(player);
    if (t.stage(player) >= STAGE.COMPLETE && value >= TINSAY.DONE) return value >= TINSAY.CLAIMED ? VARIANT.BACK : VARIANT.REWARD;
    if (t.stage(player) < STAGE.STARTED) return null;
    if (value >= TINSAY.DONE) return VARIANT.LATER;
    if (value >= TINSAY.BONES) return t.held(player, ITEM.MARINATED_BONES) ? VARIANT.PERFECT : VARIANT.BONES;
    if (value >= TINSAY.SANDWICH) return VARIANT.SANDWICH;
    if (value >= TINSAY.BANANA) return VARIANT.RUM;
    return VARIANT.FIRST;
  }

  function condition({ player, stepId }) {
    if (BONE_CONDITIONS.has(stepId)) return t.held(player, BONE_CONDITIONS.get(stepId));
    switch (stepId) {
      case VESSEL_TOO_EARLY: return (used(player) === ITEM.VESSEL || used(player) === ITEM.LOADED_VESSEL) && progress(player) < TINSAY.DONE;
      case NO_RUM: case DOESNT_HAVE_RUM: return !hasRum(player);
      case WHOLE_BANANA: return t.held(player, ITEM.BANANA_RUM) && !t.held(player, ITEM.SLICED_BANANA_RUM);
      case SLICED_BANANA: return t.held(player, ITEM.SLICED_BANANA_RUM);
      case HAS_SANDWICH: return t.held(player, ITEM.SEAWEED_SANDWICH);
      case HAS_STUFFED_MONKEY: return t.held(player, ITEM.STUFFED_MONKEY);
      case NO_SANDWICH: return !t.held(player, ITEM.SEAWEED_SANDWICH) && !t.held(player, ITEM.STUFFED_MONKEY);
      case PERFECT_BONES: return t.held(player, ITEM.MARINATED_BONES);
      case VESSEL_USED: return used(player) === ITEM.VESSEL || used(player) === ITEM.LOADED_VESSEL;
      case EMPTY_VESSEL: return used(player) === ITEM.VESSEL;
      case LOADED_VESSEL: return used(player) === ITEM.LOADED_VESSEL;
      case STUFFED_BANANA: case SEAWEED_IN_CORPSE: case KNIFE_ON_CORPSE: return false; // item-on-item messages (Crafting)
      default: return null;
    }
  }

  function action(event) {
    const { player, stepId, npc } = event;
    if (!player || !stepId) return;
    if (BONE_BOXES.has(stepId)) {
      const [itemId, taken] = BONE_BOXES.get(stepId);
      if (taken) t.take(player, itemId);
      event.box = { items: [itemId] };
      return;
    }
    if (VESSEL_BOXES.has(stepId)) {
      const itemId = VESSEL_BOXES.get(stepId);
      t.take(player, itemId);
      event.box = { items: [itemId] };
      return;
    }
    switch (stepId) {
      case PAUSE_MESSAGE:
        t.raise(player, KEY.TINSAY, TINSAY.BANANA);
        event.handled = true; // sent by the pause after "Right ... what do you need?"
        return;
      case RUM_BOX:
        t.take(player, ITEM.SLICED_BANANA_RUM);
        t.raise(player, KEY.TINSAY, TINSAY.SANDWICH);
        event.box = { items: [ITEM.SLICED_BANANA_RUM], pauseTicks: 4 };
        event.after = () => t.npcAnimation(npc, DRINK_RUM);
        return;
      case WHOLE_BANANA_BOX:
        event.box = { items: [ITEM.BANANA_RUM] };
        return;
      case PONDER:
        event.wait = (resume) => t.later(player, 4, resume);
        return;
      case DANCE:
        event.handled = true;
        return;
      case SANDWICH_BOX:
        t.take(player, ITEM.SEAWEED_SANDWICH);
        t.raise(player, KEY.TINSAY, TINSAY.BONES);
        event.box = { items: [ITEM.SEAWEED_SANDWICH] };
        return;
      case STUFFED_MONKEY_BOX:
        event.box = { items: [ITEM.STUFFED_MONKEY] };
        return;
      case EATS_SANDWICH:
        event.wait = (resume) => {
          t.later(player, 1, () => t.npcAnimation(npc, EAT));
          t.later(player, 5, resume);
        };
        return;
      case PERFECT_BONES_BOX:
        t.take(player, ITEM.MARINATED_BONES);
        t.raise(player, KEY.TINSAY, TINSAY.DONE);
        event.box = { items: [ITEM.MARINATED_BONES], pauseTicks: 9 };
        event.after = () => {
          t.npcAnimation(npc, EAT);
          player.getPacketSender().sendJingle(BONES_JINGLE, 0);
          t.later(player, 2, () => t.npcAnimation(npc, RETCH));
        };
        return;
      case BURNT_BONES_BACK:
        event.handled = true; // he never took them
        return;
      case MANUAL_BOX:
        // The manual and varp 321 4 -> 5 come as its box shows (local 1001562 tick 7761).
        event.box = { items: [ITEM.CRAFTING_MANUAL], delayTicks: MANUAL_DELAY };
        t.later(player, MANUAL_DELAY, () => {
          t.give(player, ITEM.CRAFTING_MANUAL);
          if (t.state(player, KEY.TIADECHE) >= TIADECHE.ASKED_MANUAL) t.raise(player, KEY.TIADECHE, TIADECHE.HAS_MANUAL);
        });
        return;
      case MANUAL:
        event.handled = true; // came with the box
        return;
      case TRAINS:
        event.box = { items: [ITEM.MARINATED_BONES] };
        return;
      case COOKING_XP:
        if (progress(player) < TINSAY.CLAIMED) {
          t.addXp(player, Skill.COOKING, 5000);
          t.setState(player, KEY.TINSAY, TINSAY.CLAIMED);
        }
        event.handled = true;
    }
  }

  /** Items used on him: his hand-ins (as the matching "Have you found...?" talk), and the vessel for Tiadeche. */
  function useOn(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!IDS.has(npcId) || t.stage(player) < STAGE.STARTED) return;
    const npc = event.npc ?? event.target ?? null;
    const value = progress(player);
    const conditionsOnly = (steps) => steps.filter((step) => step?.type === "condition");
    if (itemId === ITEM.VESSEL || itemId === ITEM.LOADED_VESSEL) {
      t.lastUsedItem.set(player, itemId);
      if (value >= TINSAY.DONE) {
        if (t.state(player, KEY.TIADECHE) < TIADECHE.ASKED_MANUAL) return;
        t.play(player, npcId, VARIANT.LATER, conditionsOnly, npc);
      } else {
        t.play(player, npcId, VARIANT.FIRST, conditionsOnly, npc);
      }
      event.handled = true;
      return;
    }
    const handIn = value === TINSAY.BANANA && (itemId === ITEM.SLICED_BANANA_RUM || itemId === ITEM.BANANA_RUM) ? VARIANT.RUM
      : value === TINSAY.SANDWICH && (itemId === ITEM.SEAWEED_SANDWICH || itemId === ITEM.STUFFED_MONKEY) ? VARIANT.SANDWICH
        : value === TINSAY.BONES && itemId === ITEM.MARINATED_BONES ? VARIANT.PERFECT
          : value === TINSAY.BONES && [...BONE_CONDITIONS.values()].includes(itemId) ? VARIANT.BONES
            : null;
    if (!handIn) return;
    t.lastUsedItem.set(player, itemId);
    t.play(player, npcId, handIn, undefined, npc);
    event.handled = true;
  }

  t.pauseAfter("Player", "Right ... what do you need?", 4, ({ player }) => {
    player.sendMessage("Tinsay pauses and then mutters to himself.");
  });

  api.onNpcDialogueVariant(variant);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:action", action);
  api.onItemOnNpc(useOn);
  return { VARIANT };
};
