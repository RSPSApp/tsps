/**
 * Revenants: the plugin api the units share.
 */
let api = null;
let core = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

/**
 * The drop boost for one roll ("drops:chance" { player, source, rules }; a league's boosted
 * drops answer it by the revenant's name): an item id's multiplier, the matching rules' product.
 */
function dropBoost(player, source) {
  const rules = [];
  api?.emitCustomEvent?.("drops:chance", { player, source, rules });
  if (rules.length === 0) return () => 1;
  return (itemId) => {
    const name = core.ItemDefinition.forId(itemId)?.getName?.() ?? "";
    return rules.reduce((value, rule) => (rule.pattern.test(name) ? value * rule.multiplier : value), 1);
  };
}

module.exports = {
  init,
  dropBoost,
  get api() { return api; },
  get core() { return core; },
};
