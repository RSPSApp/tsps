/**
 * Sir Tiffy's common post-quest conversation. Quest selectors register first:
 * training, Wanted!, Slug Menace and Devious Minds retain their own stage windows.
 * Words and shop actions come from the existing Wiki transcript, not a second shop.
 */
const { startTranscript } = require("./QuestRuntime");

const PAGE = "Sir Tiffy Cashien";
const RECRUITMENT_DRIVE = "recruitment_drive";
const WANTED = "wanted";
const SLUG_MENACE = "the_slug_menace";
let pluginApi;

function complete(player, key) {
  const request = { player, key, complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function commonVariant(player) {
  if (complete(player, SLUG_MENACE)) return "after-slug-menace";
  return complete(player, WANTED) ? "after-wanted" : "after-recruitment-drive";
}

function selectVariant({ player, npcId }) {
  if (!player || npcId !== pluginApi.core.NpcIdentifiers.SIR_TIFFY_CASHIEN) return null;
  if (!complete(player, RECRUITMENT_DRIVE)) return null;
  return { page: PAGE, variant: commonVariant(player) };
}

/** Quest-page common options reuse Sir Tiffy's canonical menu and purchase branch. */
function chooseCommonTopic(event) {
  const { player, npcId, option, pages } = event;
  if (!player || npcId !== pluginApi.core.NpcIdentifiers.SIR_TIFFY_CASHIEN) return;
  if (!pages?.some(({ page }) => ["Wanted!", "The Slug Menace", "Devious Minds"].includes(page))) return;
  if (!complete(player, RECRUITMENT_DRIVE)) return;
  const variant = commonVariant(player);
  if (option === "Something else.") {
    event.end = startTranscript(pluginApi, player, npcId, PAGE, variant, undefined, event.npc);
    return;
  }
  if (option !== "Ask about buying armour" && option !== "Can I buy some armour?") return;
  event.end = startTranscript(pluginApi, player, npcId, PAGE, variant, (steps) =>
    steps.find((step) => step.type === "choice")?.options
      ?.find((entry) => entry.text === "Can I buy some armour?")?.steps ?? [], event.npc);
}

module.exports = function attachSirTiffy(api) {
  // This module is attached after the quest selectors, only on a members world.
  pluginApi = api;
  api.onNpcDialogueVariant(selectVariant);
  api.onCustomEvent("npc-dialogue:choice", chooseCommonTopic);
};
