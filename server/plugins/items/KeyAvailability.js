/** Stored reusable keys are available only with a carried ring. Never use this for a physical handover. */
function storedKey(api, player, itemId) {
  const request = { player, itemId, available: false };
  api.emitCustomEvent("steel-key-ring:contains", request);
  return request.available === true;
}

/** Ownership queries include a genuine banked ring; door access still requires a carried ring. */
function ownsStoredKey(api, player, itemId) {
  const request = { player, itemId, owned: false };
  api.emitCustomEvent("steel-key-ring:contains", request);
  return request.owned === true;
}

function hasKey(api, player, itemId) {
  return player.getInventory().contains(itemId) || storedKey(api, player, itemId);
}

module.exports = { hasKey, storedKey, ownsStoredKey };
