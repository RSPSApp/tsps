/**
 * The music player's three custom playlists, of up to 100 tracks each. Each place holds a track's
 * unlock slot as bank * 100 + bit (Adventure, bank 1 bit 0, is 100), in the varbits
 * music_playlist_<playlist>_track_<place>; removing a track leaves its place empty, and an added
 * track takes the first empty place.
 */
const PLAYLISTS_ATTRIBUTE = "music:playlists";
const PLAYLIST_COUNT = 3;
const PLAYLIST_SIZE = 100;
/** music_playlist_1_track_1; the playlists' varbits run on in order, playlist by playlist. */
const FIRST_PLAYLIST_VARBIT = 19738;

/** A track's playlist value: its unlock slot as bank * 100 + bit, or undefined without one. */
function valueOf(track) {
  return Number.isInteger(track?.unlockBank) && Number.isInteger(track?.unlockBit)
    ? track.unlockBank * 100 + track.unlockBit
    : undefined;
}

function varbitOf(playlist, place) {
  return FIRST_PLAYLIST_VARBIT + (playlist - 1) * PLAYLIST_SIZE + place;
}

/** The player's playlists, each a full list of places (0 is empty). */
function playlists(player) {
  const saved = player.getAttribute?.(PLAYLISTS_ATTRIBUTE);
  return Array.from({ length: PLAYLIST_COUNT }, (_, index) => {
    const places = Array.isArray(saved?.[index]) ? saved[index] : [];
    return Array.from({ length: PLAYLIST_SIZE }, (_, place) => (Number.isInteger(places[place]) && places[place] > 0 ? places[place] : 0));
  });
}

/** The values in playlist 1-3, without its empty places. */
function values(player, playlist) {
  return playlists(player)[playlist - 1]?.filter((value) => value > 0) ?? [];
}

/**
 * Adds the value to the playlist, or removes it when it is there. Returns "added", "removed", or
 * "full" when it has no empty place left; the changed place's varbit is sent.
 */
function toggle(player, playlist, value) {
  const all = playlists(player);
  const places = all[playlist - 1];
  let place = places.indexOf(value);
  let result = "removed";
  if (place >= 0) {
    places[place] = 0;
  } else {
    place = places.indexOf(0);
    if (place < 0) return "full";
    places[place] = value;
    result = "added";
  }
  save(player, all);
  player.getPacketSender().sendVarbit(varbitOf(playlist, place), places[place]);
  return result;
}

/** Empties a playlist: every place it had is sent as 0. */
function wipe(player, playlist) {
  const all = playlists(player);
  const sender = player.getPacketSender();
  all[playlist - 1].forEach((value, place) => {
    if (value > 0) sender.sendVarbit(varbitOf(playlist, place), 0);
  });
  all[playlist - 1].fill(0);
  save(player, all);
}

/** Login: every filled place, as live sends them. */
function send(player) {
  const sender = player.getPacketSender();
  playlists(player).forEach((places, index) => places.forEach((value, place) => {
    if (value > 0) sender.sendVarbit(varbitOf(index + 1, place), value);
  }));
}

/** Saved without trailing empty places; an account with none saves nothing. */
function save(player, all) {
  const trimmed = all.map((places) => {
    let end = places.length;
    while (end > 0 && places[end - 1] === 0) end--;
    return places.slice(0, end);
  });
  player.setAttribute(PLAYLISTS_ATTRIBUTE, trimmed.every((places) => places.length === 0) ? [] : trimmed);
}

module.exports = {
  PLAYLISTS_ATTRIBUTE, PLAYLIST_COUNT, PLAYLIST_SIZE,
  valueOf, varbitOf, playlists, values, toggle, wipe, send,
};
