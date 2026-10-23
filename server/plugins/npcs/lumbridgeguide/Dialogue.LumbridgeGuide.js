// The normal F2P conversation must remain available when members' recovery
// content is absent. The owning reward plugin answers whether recovery applies.
const PAGE = "Lumbridge Guide";
const NORMAL = "standard-dialogue-if-the-player-still-has-the-amulet-of-the-eye-or-has-not-unlocked-it";
const LOST = "standard-dialogue-if-the-player-lost-the-amulet-of-the-eye";
let pluginApi;

function chooseVariant(event) {
  if (!event.pages?.some(({ page }) => page === PAGE)) return null;
  const request = { player: event.player, reclaim: false };
  pluginApi.emitCustomEvent("lumbridge-guide:amulet-status", request);
  return { page: PAGE, variant: request.reclaim ? LOST : NORMAL };
}

module.exports = function attach(api) {
  pluginApi = api;
  api.onNpcDialogueVariant(chooseVariant);
};
