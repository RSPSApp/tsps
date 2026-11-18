/**
 * Lubufu, as RSProx captures local 1001562 (revision 241, ticks 5616-5993 and 6472-6557) and 75 (revision
 * 227, ticks 3251-3388) play him, with locals 1000187 and 1000406 for the bait offer:
 * - The bait offer ("I could help collect the bait.") shows in the menu after "What do you do?" once he has
 *   said what he does with his Karambwan; every recording asks "What do you do?" twice for it.
 * - After the 20 Karambwanji, "What do you use to catch Karambwan?" only ends with his answer until the
 *   third time; then "My, you're keen aren't you?", "Lubufu appears to think for a moment." with his think
 *   emote as it is continued, and 3 ticks later his apprentice offer.
 * - "Lubufu teaches you a new fishing technique." is an item box of raw Karambwanji; "Lubufu hands you a
 *   Karambwan vessel." an item box of the vessel, with the vessel and the 1,500 Fishing XP as it shows.
 *   A lost vessel's replacement comes with its box too.
 */
module.exports = function attachLubufu(api, t) {
  const { NPC, ITEM, KEY, LUBUFU } = t;
  const { Skill } = api.core;

  const BAIT_OFFER = "3QGeFs"; // "If the player has asked Lubufu what he does with his Karambwan:"
  const FEWER_THAN_THREE = "NHjou8";
  const ALL_TWENTY = "DlHvAx";
  const SOME = "LtKqTg";
  const NONE = "JEJREj";
  const THE_REST = "uQS5kE";
  const HANDED_TWENTY = "eRXQyV";
  const HANDED_SOME = new Set(["AiuAjU", "JFyxPu"]);
  const THINK_MESSAGE = "5v1T3t";
  const TEACHES = "L44AG6";
  const VESSEL_BOX = "MHOQ_w";
  const VESSEL_REWARD = "SwVHKY";
  const REPLACEMENT_BOX = "_L3Q5c";
  const REPLACEMENT = "Pl7-5H";
  const THINK_EMOTE = 857; // emote_think
  const WANTED = 20;

  const VARIANT = {
    FIRST: "talking-to-lubufu",
    AGAIN: "talking-to-lubufu-talking-to-lubufu-again",
    DELIVER: "talking-to-lubufu-delivering-raw-karambwanji-to-lubufu",
    DELIVERED: "talking-to-lubufu-talking-to-lubufu-after-delivering-raw-karambwanji",
    REFUSED: "talking-to-lubufu-talking-to-lubufu-after-refusing-to-be-his-apprentice",
    APPRENTICE: "talking-to-lubufu-subsequent-dialogue-with-lubufu",
  };

  const progress = (player) => t.state(player, KEY.LUBUFU);
  const delivered = (player) => t.state(player, KEY.LUBUFU_COUNT);

  function variant({ player, npcId }) {
    if (npcId !== NPC.LUBUFU) return null;
    const value = progress(player);
    if (value >= LUBUFU.APPRENTICE) return VARIANT.APPRENTICE;
    if (value === LUBUFU.REFUSED) return VARIANT.REFUSED;
    if (value >= LUBUFU.GIVEN) return VARIANT.DELIVERED;
    if (value >= LUBUFU.FETCH) return VARIANT.DELIVER;
    if (value <= 0) {
      t.setState(player, KEY.LUBUFU, LUBUFU.MET);
      return VARIANT.FIRST;
    }
    return VARIANT.AGAIN;
  }

  function condition({ player, stepId }) {
    if (stepId === BAIT_OFFER) return progress(player) >= LUBUFU.HEARD_KARAMBWAN;
    if (stepId === FEWER_THAN_THREE) {
      const value = progress(player);
      if (value >= LUBUFU.GIVEN && value < LUBUFU.ASKED_TWICE) {
        t.setState(player, KEY.LUBUFU, value + 1);
        return true;
      }
      return false;
    }
    const has = player.getInventory().getAmount(ITEM.RAW_KARAMBWANJI);
    const given = delivered(player);
    if (stepId === ALL_TWENTY) return given === 0 && has >= WANTED;
    if (stepId === SOME) return has > 0 && has < WANTED - given;
    if (stepId === NONE) return has === 0;
    if (stepId === THE_REST) return given > 0 && has >= WANTED - given;
    return null;
  }

  /** "I still need [#] more.": what is left of the 20. */
  function line(event) {
    if (event.npcId !== NPC.LUBUFU || !t.isPage(event) || !String(event.text).includes("[#]")) return;
    event.text = String(event.text).replace("[#]", String(Math.max(0, WANTED - delivered(event.player))));
  }

  function choice({ player, npcId, option }) {
    if (npcId !== NPC.LUBUFU) return;
    const text = String(option);
    if (text === "What do you do with your Karambwan?") t.raise(player, KEY.LUBUFU, LUBUFU.HEARD_KARAMBWAN);
    else if (text === "You sound like you could do with the help.") t.raise(player, KEY.LUBUFU, LUBUFU.FETCH);
    else if (text === "No." && progress(player) >= LUBUFU.GIVEN && progress(player) < LUBUFU.APPRENTICE) {
      t.setState(player, KEY.LUBUFU, LUBUFU.REFUSED);
    }
  }

  function handOver(player, amount) {
    t.take(player, ITEM.RAW_KARAMBWANJI, amount);
    const total = delivered(player) + amount;
    t.setState(player, KEY.LUBUFU_COUNT, total);
    t.setState(player, KEY.LUBUFU, total >= WANTED ? LUBUFU.GIVEN : LUBUFU.FETCH + total);
  }

  function action(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (stepId === HANDED_TWENTY) {
      handOver(player, WANTED);
      event.box = { items: [ITEM.RAW_KARAMBWANJI] };
      return;
    }
    if (HANDED_SOME.has(stepId)) {
      const amount = Math.min(player.getInventory().getAmount(ITEM.RAW_KARAMBWANJI), WANTED - delivered(player));
      if (amount <= 0) return;
      handOver(player, amount);
      event.text = String(event.text).replace("[#]", String(amount));
      event.box = { items: [ITEM.RAW_KARAMBWANJI] };
      return;
    }
    if (stepId === THINK_MESSAGE) {
      event.handled = true; // sent by the pause after "My, you're keen aren't you?"
      return;
    }
    if (stepId === TEACHES) {
      event.box = { items: [ITEM.RAW_KARAMBWANJI] };
      return;
    }
    if (stepId === VESSEL_BOX) {
      if (progress(player) < LUBUFU.APPRENTICE) {
        t.give(player, ITEM.VESSEL);
        t.addXp(player, Skill.FISHING, 1500);
        t.setState(player, KEY.LUBUFU, LUBUFU.APPRENTICE);
      }
      event.box = { items: [ITEM.VESSEL] };
      return;
    }
    if (stepId === REPLACEMENT_BOX) {
      t.give(player, ITEM.VESSEL);
      event.box = { items: [ITEM.VESSEL] };
      return;
    }
    if (stepId === VESSEL_REWARD || stepId === REPLACEMENT) {
      event.handled = true; // handed over with the box
    }
  }

  /** "Have you retrieved the Karambwanji yet?" also answers a Karambwanji used on him. */
  function useOn(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId !== NPC.LUBUFU || itemId !== ITEM.RAW_KARAMBWANJI) return;
    const value = progress(player);
    if (value < LUBUFU.FETCH || value >= LUBUFU.GIVEN) return;
    t.play(player, npcId, VARIANT.DELIVER, undefined, event.npc ?? event.target ?? null);
    event.handled = true;
  }

  t.pauseAfter("Lubufu", "My, you're keen aren't you?", 3, ({ player, npc }) => {
    player.sendMessage("Lubufu appears to think for a moment.");
    t.npcAnimation(npc, THINK_EMOTE);
  });

  api.onNpcDialogueVariant(variant);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:choice", choice);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("npc-dialogue:action", action);
  api.onItemOnNpc(useOn);
  return { VARIANT };
};
