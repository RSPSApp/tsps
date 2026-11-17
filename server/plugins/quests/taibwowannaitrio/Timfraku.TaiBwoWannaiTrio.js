/**
 * Timfraku: the start, the "welcome back" talks and the reward, as RSProx captures local 1001562
 * (revision 241, ticks 5471-5561 and 8073-8105), 75 (revision 227, ticks 3068-3106 and 5043-5066) and
 * JunglePotion (revision 242.1, ticks 534-575 and 1429-1469) play him:
 * - tbwt_main 0 -> 1 as the player continues past "Well then <title>, you would do better to...". Until
 *   Jungle Potion's news has reached Trufitus (varp 175 at 13) the menu after it is only "Why should I leave?"
 *   and "Right, I'm going then.", and the next talk is "You again! Only a fool would ignore my
 *   instructions.". A met player with the news opens with "Trufitus sent me.".
 * - "Timfraku appears to concentrate very deeply." as "Then it must be true." is continued; the chatbox
 *   closes and "I cannot thank you enough..." follows 4 ticks later.
 * - 1 -> 2 as the start prompt opens; 2 -> 3 and the start message on "Yes.". A refused start replays the
 *   prompt behind "Are you ready to help me?".
 * - The reward: 4 -> 5 and the 2,000 coins at "Timfraku hands you a big stack of gold coins." (an item box
 *   of coins_1000), 5 -> 6 with the completion as it is continued. Once the scroll is closed: "You should go
 *   and see my sons..." and the village menu.
 */
module.exports = function attachTimfraku(api, t) {
  const { STAGE, NPC, ITEM, KEY } = t;
  const { questStartMessage } = require("../QuestRuntime");

  const START_HOOK = "quest:tai-bwo-wannai-trio:start";
  const START_PROMPT = "Start the Tai Bwo Wannai Trio quest?";
  const NEWS_OPTION = "Trufitus sent me.";
  const JUNGLE_POTION_CONDITIONS = new Set(["vLy_sA", "eM-kRy"]); // "Trufitus sent me." / "Ask about Village."
  const TITLE_CONDITIONS = new Map([
    ["PXhiff", 0], ["LXM1RA", 1], ["Vp-0SW", 2], ["OdM3bk", 3], // "Welcome back, <title>."
    ["BHbgk3", 0], ["Qp2RwD", 1], ["GBsa41", 2], ["EmmfT_", 3], // "<Title>, please accept my eternal gratitude!"
  ]);
  /** Tai Bwo Wannai Cleanup's progress isn't this quest's: its villager question answers "not been doing". */
  const CLEANUP_IDLE = new Set(["0vRZC4", "zn1npS", "fFb-gR"]);
  const CLEANUP_DONE = new Set(["xNYAnZ", "rR-Pf3", "z6UDqv"]);
  const REFUSED_PROMPT_ACTION = "8xLhN9"; // "Shows quest start confirmation"
  const COIN_BOXES = new Set(["kQApU7", "GjYkNQ", "a_818f", "eFbd8R"]);
  const COIN_ACTIONS = new Set(["wbjEas", "ETkhWv", "DplpFj", "NortHx"]);
  const COMPLETE_MESSAGE = "SUa3hN";
  const CONCENTRATE_MESSAGE = "dgX3n1";
  const SENT_AWAY = /^Well then \w+, you would do better to/;
  const TITLES = [/roving adventurer/i, /travelling explorer/i, /wandering wayfarer/i, /nobody/i];
  const SCROLL_GROUP = 153;
  /** Ticks to wait for the completion scroll to open before carrying on without it. */
  const SCROLL_WAIT = 5;

  const VARIANT = {
    START: "starting-off-talking-to-timfraku",
    AGAIN: "starting-off-talking-to-timfraku-again-before-jungle-potion",
    REFUSED: "starting-off-if-the-player-refused-to-start-the-quest-and-talks-to-timfraku-again",
    STARTED: "starting-off-talking-to-timfraku-after-starting-the-quest",
    REWARD: "making-the-burnt-marinated-jogre-bones-talking-to-timfraku-after-getting-all-three-sons-home",
    AFTER: "after-tai-bwo-wannai-trio",
  };

  function variant({ player, npcId }) {
    if (npcId !== NPC.TIMFRAKU) return null;
    const stage = t.stage(player);
    if (stage >= STAGE.COMPLETE) return VARIANT.AFTER;
    if (stage >= STAGE.BROTHERS_DONE) return VARIANT.REWARD;
    if (stage >= STAGE.STARTED) return VARIANT.STARTED;
    if (stage === STAGE.PROMPTED) return VARIANT.REFUSED;
    if (stage === STAGE.MET && !t.junglePotionTold(player)) return VARIANT.AGAIN;
    return VARIANT.START;
  }

  /** Talk-to for a met player with the news: straight into "Trufitus sent me." (JunglePotion tick 1429). */
  function talk({ player, npc }) {
    if (t.stage(player) !== STAGE.MET || !t.junglePotionTold(player)) return false;
    const news = t.findStep((step) => step?.text === NEWS_OPTION && Array.isArray(step.steps));
    if (!news) return false;
    return t.play(player, NPC.TIMFRAKU, VARIANT.START, () => news.steps, npc);
  }

  function condition({ player, stepId }) {
    if (JUNGLE_POTION_CONDITIONS.has(stepId)) return t.junglePotionTold(player);
    if (TITLE_CONDITIONS.has(stepId)) return t.state(player, KEY.TITLE) === TITLE_CONDITIONS.get(stepId);
    if (CLEANUP_IDLE.has(stepId)) return true;
    if (CLEANUP_DONE.has(stepId)) return false;
    return null;
  }

  function choice({ player, npcId, option }) {
    if (npcId !== NPC.TIMFRAKU || t.stage(player) > STAGE.NOT_STARTED) return;
    const title = TITLES.findIndex((pattern) => pattern.test(String(option)));
    if (title >= 0) t.setState(player, KEY.TITLE, title);
  }

  function line(event) {
    const { player, npcId, text } = event;
    if (npcId !== NPC.TIMFRAKU || !t.isPage(event)) return;
    if (t.stage(player) !== STAGE.NOT_STARTED || !SENT_AWAY.test(String(text))) return;
    event.after = () => {
      if (t.stage(player) === STAGE.NOT_STARTED) t.quest.setStage(player, STAGE.MET);
    };
  }

  /** The start prompt opening is 1 -> 2 (local 1001562 tick 5544, JunglePotion 1458). */
  function menu({ player, npcId, prompt }) {
    if (npcId !== NPC.TIMFRAKU || prompt !== START_PROMPT) return;
    if (t.stage(player) === STAGE.MET) t.quest.setStage(player, STAGE.PROMPTED);
  }

  function start({ player, npcId, hook }) {
    if (npcId !== NPC.TIMFRAKU || hook !== START_HOOK) return;
    if (t.stage(player) >= STAGE.STARTED || !t.junglePotionTold(player)) return;
    t.quest.setStage(player, STAGE.STARTED);
    // Before "Ok, I'll do it." (local 1001562 tick 5547).
    player.sendMessage(questStartMessage(player, t.PAGE));
  }

  function action(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (stepId === REFUSED_PROMPT_ACTION) {
      // The first talk's own prompt, Yes and No as there (JunglePotion ticks 1462-1469).
      const prompt = t.findStep((step) => step?.type === "choice" && step.prompt === START_PROMPT);
      if (!prompt) return;
      event.handled = true;
      event.steps = [prompt];
      return;
    }
    if (stepId === CONCENTRATE_MESSAGE) {
      event.handled = true; // sent by the pause after "Then it must be true."
      return;
    }
    if (COIN_BOXES.has(stepId)) {
      if (t.stage(player) < STAGE.BROTHERS_DONE || t.quest.isComplete(player)) return;
      if (t.stage(player) < STAGE.REWARDED) {
        t.quest.setStage(player, STAGE.REWARDED);
        t.give(player, ITEM.COINS, 2000);
      }
      event.box = { items: [ITEM.COINS_STACK] };
      event.after = () => {
        if (!t.quest.isComplete(player)) t.quest.complete(player);
      };
      return;
    }
    if (COIN_ACTIONS.has(stepId)) {
      // The coins came with the box; the rest of the talk waits for the completion scroll.
      event.handled = true;
      event.end = true;
      afterScroll(player, event.npc);
      return;
    }
    if (stepId === COMPLETE_MESSAGE) {
      event.handled = true;
      event.end = true;
    }
  }

  /** Once the completion scroll is closed: "You should go and see my sons..." and the village menu (tick 8103). */
  function afterScroll(player, npc) {
    let seen = false;
    let waited = 0;
    const poll = () => t.later(player, 1, () => {
      const open = player.getInterfaceId?.() === SCROLL_GROUP;
      seen ||= open;
      if (open || (!seen && ++waited < SCROLL_WAIT)) return poll();
      t.play(player, NPC.TIMFRAKU, VARIANT.REWARD, rewardTail, npc);
    });
    poll();
  }

  function rewardTail(steps) {
    const menuAt = steps.findIndex((step) => step?.type === "choice");
    return steps.slice(menuAt + 1).filter((step) => step?.id !== COMPLETE_MESSAGE);
  }

  t.pauseAfter("Timfraku", "Then it must be true.", 4, ({ player }) => {
    player.sendMessage("Timfraku appears to concentrate very deeply.");
  });

  api.onNpcDialogueVariant(variant);
  api.onNpcDialogueCondition(condition);
  api.onNpcInteraction("Timfraku", { "Talk-to": talk });
  api.onCustomEvent("npc-dialogue:choice", choice);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("npc-dialogue:menu", menu);
  api.onCustomEvent("npc-dialogue:hook", start);
  api.onCustomEvent("npc-dialogue:action", action);
  return { VARIANT };
};
