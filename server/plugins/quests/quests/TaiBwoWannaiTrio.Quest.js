/**
 * Tai Bwo Wannai Trio (members; Jungle Potion, 15 Agility, 30 Cooking, 5 Fishing), aligned with two whole
 * runs of the quest on live: RSProx captures local 1001562 (revision 241) and 75 (revision 227), with
 * JunglePotion (revision 242.1) for Timfraku before and after Jungle Potion. Ticks cited in the unit files
 * are those recordings'; the facts are collected in docs/quests/tai-bwo-wannai-trio/README.md.
 *
 * The words come from the "Tai Bwo Wannai Trio" transcript page (npc-dialogues.json, osrsreboxed-db, with
 * the captures' corrections there); the unit files pick the variants, answer the prose conditions and do
 * what the captures show between the lines:
 *   Timfraku   the start (with Jungle Potion's gates), the welcome-backs, the reward and completion;
 *   Lubufu     the bait, the apprenticeship and the Karambwan vessel;
 *   Tiadeche   the vessel, his first catch and the crafting manual (native varp 321);
 *   Tinsay     his three requests and the manual;
 *   Tamayu     the potion, the spears, the Shaikahan hunts and the monkey skin;
 *   Crafting   the vessel, the burnt and marinated jogre bones, the spears and the sandwich;
 *   Village    the tribal statue and the bamboo hut doors.
 * The stages are the native tbwt_main varp (320); State.TaiBwoWannaiTrio.js lists them.
 */
const createState = require("../taibwowannaitrio/State.TaiBwoWannaiTrio");
const { buildJournal } = require("../taibwowannaitrio/Journal.TaiBwoWannaiTrio");

module.exports = function registerTaiBwoWannaiTrioQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");
  const t = createState(api);
  const { KEY, STAGE } = t;

  /** "You should go and see..." and the brothers' "I will meet you in the village..." lines. */
  function line(event) {
    t.applyPause(event);
    // Wiki-export artefact: a couple of lines end in stray "}}" braces.
    if (typeof event.text === "string" && event.text.endsWith("}}")) event.text = event.text.replace(/\}+$/, "");
    if (t.isPage(event) && event.player && /^I will meet you in the village once you have helped my brothers/.test(String(event.text))) {
      const before = event.after;
      event.after = () => {
        before?.();
        t.updateBrothers(event.player);
      };
    }
  }

  function logout({ player }) {
    if (player) t.lastUsedItem.delete(player);
  }

  /**
   * Old saves used 5 for completion; native completion is 6. Live's 5 lasts only while Timfraku's coin box
   * shows, so a 5 at login is taken as complete, as before. Tiadeche's varp is sent from his saved progress.
   */
  function login({ player }) {
    if (!player) return;
    if (t.stage(player) === STAGE.REWARDED && !t.quest.isComplete(player)) t.quest.setStage(player, STAGE.COMPLETE);
    t.sendTiadecheVarp(player);
    refreshQuestList(player);
  }

  for (const key of Object.values(KEY)) api.persistAttribute(key, 0);

  t.quest = registerQuest(api, {
    key: "tai_bwo_wannai_trio",
    name: "Tai Bwo Wannai Trio",
    varpId: t.VARP,
    startedValue: STAGE.STARTED,
    completionValue: STAGE.COMPLETE,
    questPoints: 2,
    xpRewards: [],
    scrollItemId: t.ITEM.RAW_KARAMBWAN,
    // The scroll as live shows it (local 1001562 tick 8101, 75 tick 5054): the brothers' XP, which they
    // hand out after the quest; the 2,000 coins came with Timfraku's box and aren't listed.
    otherRewards: ["5,000 Fishing XP", "5,000 Cooking XP", "2,500 Attack XP", "2,500 Strength XP"],
    buildJournal: (player) => buildJournal(t, player),
  });

  api.onCustomEvent("npc-dialogue:line", line);
  api.onPlayerLogout(logout);
  api.onPlayerLogin(login);
  t.units = {
    Timfraku: require("../taibwowannaitrio/Timfraku.TaiBwoWannaiTrio")(api, t),
    Lubufu: require("../taibwowannaitrio/Lubufu.TaiBwoWannaiTrio")(api, t),
    Tiadeche: require("../taibwowannaitrio/Tiadeche.TaiBwoWannaiTrio")(api, t),
    Tinsay: require("../taibwowannaitrio/Tinsay.TaiBwoWannaiTrio")(api, t),
    Tamayu: require("../taibwowannaitrio/Tamayu.TaiBwoWannaiTrio")(api, t),
    Crafting: require("../taibwowannaitrio/Crafting.TaiBwoWannaiTrio")(api, t),
    Village: require("../taibwowannaitrio/Village.TaiBwoWannaiTrio")(api, t),
  };
  // The tests reach the units' helpers through the registered quest.
  t.quest.state = t;
};
