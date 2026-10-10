const UNLOCKED_TRACKS_ATTRIBUTE = "music:unlocked-tracks";
const CAPE_OWNED_ATTRIBUTE = "music:cape-owned";
const AIR_GUITAR_UNLOCKED_ATTRIBUTE = "music:air-guitar-unlocked";

const MUSIC_UNLOCK_VARPS = [
  20, 21, 22, 23, 24, 25, 298, 311, 346, 414, 464, 598, 662, 721,
  906, 1009, 1338, 1681, 2065, 2237, 2950, 3418, 3575, 4066, 4411,
  4944, 5238,
];

function trackIds(trackNames) {
  return Object.keys(trackNames ?? {}).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
}

function unlockedTracks(player) {
  const tracks = player?.getAttribute?.(UNLOCKED_TRACKS_ATTRIBUTE);
  return Array.isArray(tracks) ? [...new Set(tracks.filter(Number.isInteger))] : [];
}

function isUnlocked(player, trackId) {
  return unlockedTracks(player).includes(trackId);
}

function unlock(player, trackId) {
  if (!Number.isInteger(trackId) || isUnlocked(player, trackId)) return false;
  const tracks = unlockedTracks(player);
  tracks.push(trackId);
  tracks.sort((a, b) => a - b);
  player.setAttribute(UNLOCKED_TRACKS_ATTRIBUTE, tracks);
  return true;
}

function varpsFor(tracks, slotByTrackId = {}) {
  const varps = MUSIC_UNLOCK_VARPS.map(() => 0);
  for (const trackId of tracks) {
    const slot = slotByTrackId[trackId];
    if (!slot) continue;
    const index = MUSIC_UNLOCK_VARPS.indexOf(slot.varp);
    if (index >= 0) varps[index] |= 1 << slot.bit;
  }
  return Object.fromEntries(MUSIC_UNLOCK_VARPS.map((id, index) => [id, varps[index]]));
}

function allUnlocked(player, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return false;
  const unlocked = new Set(unlockedTracks(player));
  return ids.every((id) => unlocked.has(id));
}

function unlockedCount(player) {
  return unlockedTracks(player).length;
}

function refreshCapeUnlock(player, allNonHolidayTrackIds) {
  const unlocked = player?.getAttribute?.(CAPE_OWNED_ATTRIBUTE) === true;
  player?.setAttribute?.(AIR_GUITAR_UNLOCKED_ATTRIBUTE, unlocked);
  return unlocked;
}

module.exports = {
  UNLOCKED_TRACKS_ATTRIBUTE,
  CAPE_OWNED_ATTRIBUTE,
  AIR_GUITAR_UNLOCKED_ATTRIBUTE,
  MUSIC_UNLOCK_VARPS,
  trackIds,
  unlockedTracks,
  isUnlocked,
  unlock,
  varpsFor,
  allUnlocked,
  unlockedCount,
  refreshCapeUnlock,
};
