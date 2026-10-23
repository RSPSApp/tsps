/**
 * Hands the plugin api to the shared Herblore module and answers what other plugins ask:
 *   api.emitCustomEvent("herblore:unfinished", { herbId, potion: null })
 *     -> sets `potion` to the unfinished potion a clean herb makes with a vial of water (Zahur).
 *   api.emitCustomEvent("herblore:clean", { grimyId, clean: null })
 *     -> sets `clean` to the herb a grimy herb cleans into (Zahur).
 */
const Common = require("./Common.Herblore");

module.exports = function attachEvents(api) {
  Common.init(api);
  api.onCustomEvent("herblore:clean", Common.answerClean);
  api.onCustomEvent("herblore:unfinished", Common.answerUnfinished);
};
