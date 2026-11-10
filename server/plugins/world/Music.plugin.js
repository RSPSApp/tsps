const fs = require("fs");
const path = require("path");
const Progress = require("./Progress.Music");
const QuestUnlocks = require("./QuestUnlocks.Music");
const Playlists = require("./Playlists.Music");

const COINS = 995;
const CAPE_PRICE = 99000;
const AIR_GUITAR_VARBIT = 4673;
const MUSIC_GROUP_ID = 239;
const MUSIC_JUKEBOX_CHILD_ID = 11;
const MUSIC_NOW_PLAYING_CHILD_ID = 4;
const CURRENT_MUSIC_TRACK_VARP = 3883;
const SELECTED_TRACK_ATTRIBUTE = "music:selected-track";
const MUSIC_NOW_PLAYING_REFRESH_SCRIPT = 3936;
const MUSIC_JUKEBOX_ROW_FLAGS = 62;
const MUSIC_NOW_PLAYING_FLAGS = 60;
const WELCOME_PLAY_BUTTON_UID = (378 << 16) | 72;
/** The Music tab's Area, Shuffle and Single mode buttons and Skip Track, by the mode each sets. */
const MODE_BUTTONS = new Map([[14, 0], [15, 1], [16, 2]].map(([child, mode]) => [(MUSIC_GROUP_ID << 16) | child, mode]));
const SKIP_BUTTON_UID = (MUSIC_GROUP_ID << 16) | 17;
/** The playlist dropdown's rows: All music, then playlists 1-3, each at slot 2 * index + 1. */
const PLAYLIST_DROPDOWN_UID = (MUSIC_GROUP_ID << 16) | 21;
/** A list row's ops 3, 4 and 5 add the track to, or remove it from, playlist 1, 2 or 3. */
const FIRST_PLAYLIST_OP = 3;
/** music_current_playlist, bits 14-17 of varp 19: 0 All music, 1-3 a playlist. */
const PLAYLIST_SHIFT = 14;
/** dont_update_music_on_playlist_change, varp 19 bit 23. */
const KEEP_MUSIC_ON_PLAYLIST_BIT = 23;
/** All Settings' "Wipe custom music playlist 1" to 3 buttons, by setting id. */
const WIPE_PLAYLIST_SETTINGS = new Map([[490, 1], [491, 2], [492, 3]]);
/** An emptied playlist stops the music: silence, faded out at speed 50. */
const PLAYLIST_STOP_FADES = { fadeOutDelay: 0, fadeOutSpeed: 50, fadeInDelay: 0, fadeInSpeed: 0 };
const MODE_NAMES = ["area", "shuffle", "single"];
/** All Settings' "Music mode" dropdown (setting id, cache struct param 1077). */
const MUSIC_MODE_SETTING = 477;
/**
 * All Settings' music dropdowns the server applies, by setting id: the varbit of varp 19 each sets
 * to the option's index (shift, bits). Music area type (Modern, Classic), the mode for a track
 * picked from the list (Single, Shuffle), and which tracks the list shows.
 */
const MUSIC_SETTING_DROPDOWNS = new Map([[110, [10, 2]], [482, [24, 1]], [483, [19, 2]]]);
/**
 * chatbox_transparency: live colours an unlocked track's name by it, with no closing tag or
 * full stop (rsprox 224/01437: "<col=ff3045>Everywhere" on a transparent chatbox; 234/03275
 * sends "<col=e00a19>" until the player turns transparency on, then "<col=ff3045>").
 */
const CHATBOX_TRANSPARENCY_VARBIT = 4608;
const UNLOCK_NAME_COLOUR = { opaque: "e00a19", transparent: "ff3045" };
const HOLIDAY_TRACKS = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "data", "music-holiday-tracks.json"), "utf8")));
let core;
let pluginApi;
let trackNames;
let rowIdByTrackId;
let allTrackIds;
let nonHolidayTrackIds;
let slotByTrackId;
let canonicalTrackBySlot;
let autoUnlockTrackIds;
let selectableTracks;
/** Quest-hinted tracks and the quest names they name (QuestUnlocks.Music). */
let questUnlocks = { entries: [], questNames: [] };

function enableMusicActions(player) {
  const rowCount = core.CacheDefinitions.getDbTableRows(44).length;
  const sender = player.getPacketSender();
  sender.sendInterfaceFlagsRange(
    (MUSIC_GROUP_ID << 16) | MUSIC_JUKEBOX_CHILD_ID,
    0,
    Math.max(0, rowCount - 1),
    MUSIC_JUKEBOX_ROW_FLAGS,
  );
  sender.sendInterfaceFlagsRange(
    (MUSIC_GROUP_ID << 16) | MUSIC_NOW_PLAYING_CHILD_ID,
    -1,
    -1,
    MUSIC_NOW_PLAYING_FLAGS,
  );
  sender.sendClientScript(MUSIC_NOW_PLAYING_REFRESH_SCRIPT);
}

function slotKey(slot) {
  return `${slot.varp}:${slot.bit}`;
}

function syncMusicVarps(player) {
  for (const trackId of autoUnlockTrackIds) Progress.unlock(player, trackId);
  for (const [id, value] of Object.entries(Progress.varpsFor(Progress.unlockedTracks(player), slotByTrackId))) {
    player.getPacketSender().sendConfig(Number(id), value);
  }
  const airGuitarUnlocked = Progress.refreshCapeUnlock(player, nonHolidayTrackIds);
  const membersWorld = core.WorldDefinition.isMembersWorld();
  player.getPacketSender().sendVarbit(AIR_GUITAR_VARBIT, membersWorld && airGuitarUnlocked ? 1 : 0);
  removeInvalidEquippedCape(player);
}

function removeInvalidEquippedCape(player) {
  const { Equipment, EquipPacketListener } = core;
  const equipment = player.getEquipment();
  const cape = equipment.getItems()[Equipment.CAPE_SLOT];
  const invalid = !core.WorldDefinition.isMembersWorld() || !Progress.allUnlocked(player, nonHolidayTrackIds);
  if (!cape || ![core.ItemIdentifiers.MUSIC_CAPE, core.ItemIdentifiers.MUSIC_CAPE_T_].includes(cape.getId()) || !invalid) return;
  if (EquipPacketListener.unequip(player, Equipment.CAPE_SLOT)) return;
  const isUltimateIronman = player.getAttribute?.("ironman:mode") === "ultimate";
  const bank = isUltimateIronman ? undefined : player.getBanks().find((tab) => tab?.getFreeSlots() > 0);
  if (bank) {
    bank.add(cape, true);
    equipment.set(Equipment.CAPE_SLOT, Equipment.NO_ITEM);
    bank.refreshItems();
  } else {
    equipment.set(Equipment.CAPE_SLOT, Equipment.NO_ITEM);
    player.sendMessage("Your music cape is destroyed because you no longer meet its requirements.");
  }
  equipment.refreshItems();
  pluginApi.getBonusManager().update(player);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function unlockNameColour(player) {
  const transparent = player.getPacketSender().getVarbit(CHATBOX_TRANSPARENCY_VARBIT) === 1;
  return UNLOCK_NAME_COLOUR[transparent ? "transparent" : "opaque"];
}

function unlockTrack({ player, trackId, silent = false }) {
  trackId = Number(trackId);
  const name = trackNames?.[trackId];
  const slot = slotByTrackId?.[trackId];
  if (!player || !name || !slot || !Progress.unlock(player, canonicalTrackBySlot[slot.key])) return;
  // A login backstop: the varps and cape flag are sent whole right after it.
  if (silent) return;
  const fullVarps = Progress.varpsFor(Progress.unlockedTracks(player), slotByTrackId);
  player.getPacketSender().sendConfig(slot.varp, fullVarps[slot.varp]);
  if (core.Music.setting(player.getAudioSettings?.(), core.Music.HIDE_UNLOCK_MESSAGE_BIT) === 0) {
    player.sendMessage(`You have unlocked a new music track: <col=${unlockNameColour(player)}>${name}`);
  }
  Progress.refreshCapeUnlock(player, nonHolidayTrackIds);
}

/** true, false, or undefined for a quest the server has not got (asked under each alias the hint may mean). */
function questComplete(player, hintName) {
  for (const name of QuestUnlocks.questNameAliases(hintName)) {
    const request = { player, name };
    pluginApi.emitCustomEvent("quest:is-complete", request);
    if (request.complete !== undefined) return request.complete === true;
  }
  return undefined;
}

/**
 * Unlocks the tracks whose cache hint names `questName`, once every quest the hint needs is
 * complete ("after completing the While Guthix Sleeps and Dragon Slayer II quests.").
 */
function unlockQuestTracks(player, questName, { silent = false } = {}) {
  const isComplete = (hintName) => QuestUnlocks.hintNamesQuest(hintName, questName) ? true : questComplete(player, hintName);
  for (const { trackId, requires } of QuestUnlocks.entriesForQuest(questUnlocks.entries, questName)) {
    if (QuestUnlocks.requirementMet(requires, isComplete)) unlockTrack({ player, trackId, silent });
  }
}

function onQuestCompleted({ player, quest }) {
  if (player && quest?.name) unlockQuestTracks(player, quest.name);
}

/** Saves from before quest unlocks existed: what their completed quests should have unlocked. */
function unlockCompletedQuestTracks(player) {
  for (const name of questUnlocks.questNames) {
    if (questComplete(player, name) === true) unlockQuestTracks(player, name, { silent: true });
  }
}

function allDiariesComplete(player) {
  const request = { player, complete: false };
  pluginApi.emitCustomEvent("diary:all-complete", request);
  return request.complete === true;
}

function canTrim(player) {
  if (!Progress.allUnlocked(player, allTrackIds)) return false;
  const quests = { player, canUse: false };
  pluginApi.emitCustomEvent("quest-cape:can-use", quests);
  if (quests.canUse !== true) return false;
  return allDiariesComplete(player);
}

function buyMusicCape(player) {
  const inventory = player.getInventory();
  if (!core.WorldDefinition.isMembersWorld()) {
    player.sendMessage("The music cape is only available on members worlds.");
    return;
  }
  if (!Progress.allUnlocked(player, nonHolidayTrackIds)) {
    player.sendMessage("You need to unlock every non-holiday music track first.");
    return;
  }
  if (inventory.getAmount(COINS) < CAPE_PRICE) {
    player.sendMessage("You need 99,000 coins to buy the music cape.");
    return;
  }
  const coinSlotFreed = inventory.getAmount(COINS) === CAPE_PRICE ? 1 : 0;
  if (inventory.getFreeSlots() + coinSlotFreed < 2) {
    player.sendMessage("You need two free inventory spaces for the music cape and hood.");
    return;
  }
  const capeId = canTrim(player) ? core.ItemIdentifiers.MUSIC_CAPE_T_ : core.ItemIdentifiers.MUSIC_CAPE;
  inventory.deleteNumber(COINS, CAPE_PRICE);
  inventory.adds(capeId, 1).adds(core.ItemIdentifiers.MUSIC_HOOD, 1);
  player.setAttribute(Progress.CAPE_OWNED_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(AIR_GUITAR_VARBIT,
    Progress.refreshCapeUnlock(player, nonHolidayTrackIds) ? 1 : 0);
  player.sendMessage("You buy a music cape and music hood.");
}

function talkToOlaf({ player }) {
  const trials = { player, key: "fremennik_trials", started: false, complete: false };
  pluginApi.emitCustomEvent("quest:is-started", trials);
  pluginApi.emitCustomEvent("quest:is-complete", trials);
  if (trials.started && !trials.complete) return false;
  pluginApi.sendMultiChatboxPrompt(
    player,
    "Music cape",
    "Buy a music cape and hood (99,000 coins)",
    buyMusicCape,
    "Cancel",
    () => {},
  );
  return true;
}

function hasMusicCape(player) {
  return [
    core.ItemIdentifiers.MUSIC_CAPE,
    core.ItemIdentifiers.MUSIC_CAPE_T_,
  ].some((id) =>
    player.getInventory().contains(id)
    || player.getEquipment().contains(id)
    || player.getBanks().some((bank) => bank?.getAmount(id) > 0)
  );
}

function capeAction(event) {
  const { player, item } = event;
  const itemId = Number(event.itemId ?? item?.getId?.());
  if (![core.ItemIdentifiers.MUSIC_CAPE, core.ItemIdentifiers.MUSIC_CAPE_T_].includes(itemId)) return;
  const option = String(event.option ?? "").toLowerCase();
  if (option === "teleport") {
    event.handled = true;
    if (!core.WorldDefinition.isMembersWorld()) return;
    if (!hasMusicCape(player)) return;
    if (!Progress.allUnlocked(player, nonHolidayTrackIds)) {
      player.sendMessage("You need to unlock every non-holiday music track to use the music cape.");
      return;
    }
    // The usual teleport checks, as the other skill capes make (Common.SkillCapes teleport): Wilderness level,
    // teleblock, busy, and the area's and plugins' own refusals (jail, instances, duels).
    const destination = new core.Location(2689, 3550, 0);
    if (!core.TeleportHandler.checkReqs(player, destination)) return;
    core.TeleportHandler.teleport(player, destination, core.TeleportType.NORMAL, false);
  } else if (option === (itemId === core.ItemIdentifiers.MUSIC_CAPE ? "trim" : "untrim")) {
    event.handled = true;
    if (!core.WorldDefinition.isMembersWorld()) return;
    if (itemId === core.ItemIdentifiers.MUSIC_CAPE && !canTrim(player)) {
      player.sendMessage("You need every music track, every quest, and every Achievement Diary to trim the cape.");
      return;
    }
    item.setId(itemId === core.ItemIdentifiers.MUSIC_CAPE ? core.ItemIdentifiers.MUSIC_CAPE_T_ : core.ItemIdentifiers.MUSIC_CAPE);
    player.getInventory().refreshItems();
    player.getEquipment().refreshItems();
    player.sendMessage(itemId === core.ItemIdentifiers.MUSIC_CAPE ? "You trim the music cape." : "You untrim the music cape.");
  }
}

function canEquipMusicCape(event) {
  const { player, item } = event;
  const itemId = Number(item?.getId?.());
  if (![core.ItemIdentifiers.MUSIC_CAPE, core.ItemIdentifiers.MUSIC_CAPE_T_].includes(itemId)) return;
  if (!core.WorldDefinition.isMembersWorld()) {
    event.allow = false;
    player?.sendMessage?.("You can only wear the music cape on members worlds.");
  } else if (!Progress.allUnlocked(player, nonHolidayTrackIds)) {
    event.allow = false;
    player?.sendMessage?.("You need to unlock every non-holiday music track to wear the music cape.");
  }
}

function onTrackPlayed(event) {
  unlockTrack(event);
  const rowId = rowIdByTrackId?.[Number(event.trackId)];
  if (event.player && Number.isInteger(rowId)) {
    const sender = event.player.getPacketSender();
    sender.sendConfig(CURRENT_MUSIC_TRACK_VARP, rowId);
    sender.sendClientScript(MUSIC_NOW_PLAYING_REFRESH_SCRIPT);
  }
}

/** music_list_setup indexes db_find(music:hidden, false), not the sorted display names. */
function selectMusicTrack(event) {
  const op = event.opId ?? event.action;
  if (event.groupId !== MUSIC_GROUP_ID || event.childId !== MUSIC_JUKEBOX_CHILD_ID) return;
  if (op >= FIRST_PLAYLIST_OP && op < FIRST_PLAYLIST_OP + Playlists.PLAYLIST_COUNT) {
    togglePlaylistTrack(event.player, event.slot, op - FIRST_PLAYLIST_OP + 1);
    return;
  }
  if (op !== 1) return;
  event.handled = true;
  if (!Number.isInteger(event.slot) || event.slot < 0) return;
  const track = selectableTracks[event.slot];
  if (!track || !track.released) return;
  const { player } = event;
  const slot = slotByTrackId[track.id];
  if (!slot || !Progress.isUnlocked(player, canonicalTrackBySlot[slot.key])) {
    // Captured locked-track refusal, rsprox 226/01702 L14857 (if_button1 music:frame, then this message_game).
    player.sendMessage("You have not unlocked this track yet.");
    return;
  }
  // Cache musicplay: 0 Area, 1 Shuffle, 2 Single. Area switches to Single, or to Shuffle with the
  // "Music mode to use when manually selecting music tracks" setting, so the area tick doesn't
  // replace the choice; Shuffle and Single stay as they are (rsprox 236/03935: the Play at L25846
  // after Shuffle at L24943 sends no musicplay change).
  if ((player.getAudioSettings?.()[MUSIC_MODE_VARP] ?? 0) === 0) {
    const mode = core.Music.setting(player.getAudioSettings(), core.Music.SHUFFLE_ON_SELECTION_BIT) === 1 ? 1 : 2;
    player.setAudioSetting(MUSIC_MODE_VARP, mode);
    player.getPacketSender().sendConfig(MUSIC_MODE_VARP, mode);
  }
  player.setAttribute(SELECTED_TRACK_ATTRIBUTE, track.id);
  player.getSession().setCurrentMusicTrack(track.id);
  // The real sender also announces audio:play-song, including to Treasure Trails' Cecilia listener.
  player.getPacketSender().sendSong(track.id);
}

function onMusicLogin({ player }) {
  unlockCompletedQuestTracks(player);
  syncMusicVarps(player);
  Playlists.send(player);
  // "Default to area music mode on login", on unless the player turned it off.
  if (core.Music.setting(player.getAudioSettings?.(), core.Music.KEEP_MODE_ON_LOGIN_BIT) === 0
      && (player.getAudioSettings?.()[MUSIC_MODE_VARP] ?? 0) !== 0) {
    player.setAudioSetting(MUSIC_MODE_VARP, 0);
    player.getPacketSender().sendConfig(MUSIC_MODE_VARP, 0);
  }
  if (player.getAudioSettings?.()[MUSIC_MODE_VARP] === 2) {
    const selected = player.getAttribute(SELECTED_TRACK_ATTRIBUTE);
    const track = selectableTracks.find(track => track.id === selected && track.released);
    const slot = slotByTrackId[selected];
    if (track && slot && Progress.isUnlocked(player, canonicalTrackBySlot[slot.key])) {
      player.getSession().setCurrentMusicTrack(selected);
      player.getPacketSender().sendSong(selected);
    } else {
      // Legacy Single saves have no selection. Let the next area update supply a valid song.
      player.setAudioSetting(MUSIC_MODE_VARP, 0);
      player.getPacketSender().sendConfig(MUSIC_MODE_VARP, 0);
    }
  }
  queueMicrotask(() => enableMusicActions(player));
}

/**
 * Varp 19 as the client should hold it: the server's own bits as last sent, and the player's saved
 * music settings in theirs.
 */
function musicSettingsVarp(player) {
  const { SETTINGS_VARP, SETTINGS_MASK } = core.Music;
  const settings = player.getAudioSettings?.()[SETTINGS_VARP] ?? core.Music.DEFAULT_SETTINGS;
  return (player.getPacketSender().getVarp(SETTINGS_VARP) & ~SETTINGS_MASK) | (settings & SETTINGS_MASK);
}

function sendMusicSettings(player) {
  player.getPacketSender().sendConfig(core.Music.SETTINGS_VARP, musicSettingsVarp(player));
}

/**
 * The client sets its music settings itself and transmits the whole varp; the setting bits were
 * saved (Player.setAudioSetting keeps only those), and the server's bits are put back.
 */
function onMusicSettingsTransmitted({ player, varpId }) {
  if (varpId === core.Music.SETTINGS_VARP) sendMusicSettings(player);
}

/** The playlist in use: 0 for All music, else 1-3. */
function currentPlaylist(player) {
  return core.Music.setting(player.getAudioSettings?.(), PLAYLIST_SHIFT, 4);
}

/**
 * The tracks Shuffle plays from: every released track the player has unlocked, as the Music tab
 * lists them, or those of the playlist (1-3) when one is in use.
 */
function shuffleTracks(player, playlist = currentPlaylist(player)) {
  const inPlaylist = playlist > 0 ? new Set(Playlists.values(player, playlist)) : null;
  const ids = new Set();
  for (const track of selectableTracks) {
    const slot = slotByTrackId[track.id];
    if (!track.released || !slot || !Progress.isUnlocked(player, canonicalTrackBySlot[slot.key])) continue;
    if (inPlaylist && !inPlaylist.has(Playlists.valueOf(track))) continue;
    ids.add(track.id);
  }
  return [...ids];
}

/**
 * Shuffle's pick: a random track of those, never the one that just ended; an empty playlist plays
 * nothing (`silent`), not even the last track again.
 */
function pickShuffleTrack(request) {
  const tracks = shuffleTracks(request.player);
  const choices = tracks.filter((id) => id !== request.previous);
  if (choices.length > 0) request.track = choices[Math.floor(Math.random() * choices.length) % choices.length];
  else if (!tracks.includes(request.previous)) request.silent = true;
}

/** Starts a track now: with no fades from silence, else with the default ones. */
function playNow(player, track) {
  const session = player.getSession();
  const fromSilence = session.getCurrentMusicTrack() < 0;
  session.setCurrentMusicTrack(track);
  player.getPacketSender().sendSong(track, fromSilence ? NO_FADES : undefined);
}

function stopMusic(player) {
  player.getSession().setCurrentMusicTrack(-1);
  player.getPacketSender().sendSong(SILENCE_TRACK, PLAYLIST_STOP_FADES);
  player.getPacketSender().sendConfig(CURRENT_MUSIC_TRACK_VARP, -1);
}

/** A random track of the list now, or silence when it is empty. */
function shuffleNow(player, tracks) {
  if (tracks.length === 0) stopMusic(player);
  else playNow(player, tracks[Math.floor(Math.random() * tracks.length) % tracks.length]);
}

function setMode(player, mode, previous) {
  player.setAudioSetting(MUSIC_MODE_VARP, mode);
  player.getPacketSender().sendConfig(MUSIC_MODE_VARP, mode);
  if (mode !== previous) player.sendMessage(`You are now using the ${MODE_NAMES[mode]} music mode.`);
}

/**
 * The playlist dropdown. A playlist switches Area mode to Shuffle, and Single mode too unless its
 * track is in the playlist, then plays one of the playlist's tracks (silence when it is empty);
 * All music in Shuffle mode plays one of every unlocked track. With "Update music when changing
 * playlists" off, only the playlist changes. The client sets the playlist and mode itself first,
 * so the mode it had is the one the server last sent.
 */
function choosePlaylist({ player, slot, opId, action }) {
  const playlist = (slot - 1) / 2;
  if ((opId ?? action ?? 1) !== 1 || !Number.isInteger(playlist) || playlist < 0 || playlist > Playlists.PLAYLIST_COUNT) return;
  const { SETTINGS_VARP } = core.Music;
  const settings = player.getAudioSettings?.()[SETTINGS_VARP] ?? core.Music.DEFAULT_SETTINGS;
  player.setAudioSetting(SETTINGS_VARP, (settings & ~(0xf << PLAYLIST_SHIFT)) | (playlist << PLAYLIST_SHIFT));
  const previous = player.getPacketSender().getVarp(MUSIC_MODE_VARP);
  sendMusicSettings(player);
  if (core.Music.setting(player.getAudioSettings(), KEEP_MUSIC_ON_PLAYLIST_BIT) === 1) {
    setMode(player, previous, previous);
    return;
  }
  const tracks = shuffleTracks(player, playlist);
  if (playlist === 0) {
    setMode(player, previous, previous);
    if (previous === 1) shuffleNow(player, tracks);
    return;
  }
  const keepSingle = previous === 2 && tracks.includes(player.getSession().getCurrentMusicTrack());
  setMode(player, keepSingle ? 2 : 1, previous);
  if (!keepSingle) shuffleNow(player, tracks);
}

/** A list row's "Add to playlist" op: adds the unlocked track, or removes it when it is there. */
function togglePlaylistTrack(player, slot, playlist) {
  const track = Number.isInteger(slot) && slot >= 0 ? selectableTracks[slot] : undefined;
  const value = Playlists.valueOf(track);
  const unlockSlot = track && slotByTrackId[track.id];
  if (value === undefined || !unlockSlot || !Progress.isUnlocked(player, canonicalTrackBySlot[unlockSlot.key])) return;
  // Ours: a full playlist (100 tracks) takes no more, without a message.
  const result = Playlists.toggle(player, playlist, value);
  if (result === "full") return;
  const change = result === "added" ? "added a track to" : "removed a track from";
  player.sendMessage(`You've ${change} playlist ${playlist}: <col=${unlockNameColour(player)}>${trackNames[track.id]}`);
}

/** All Settings' "Wipe custom music playlist" buttons. */
function wipePlaylistSetting(request) {
  const playlist = WIPE_PLAYLIST_SETTINGS.get(request.settingId);
  if (playlist === undefined) return;
  Playlists.wipe(request.player, playlist);
  request.handled = true;
}

/** The Area, Shuffle and Single buttons: the mode, and the line live sends for each. */
function chooseMusicMode({ player, buttonId, opId, action }) {
  if ((opId ?? action ?? 1) !== 1) return;
  const mode = MODE_BUTTONS.get(buttonId);
  player.setAudioSetting(MUSIC_MODE_VARP, mode);
  player.getPacketSender().sendConfig(MUSIC_MODE_VARP, mode);
  player.sendMessage(`You are now using the ${MODE_NAMES[mode]} music mode.`);
  // Area mode leaves the playlist for All music, unless playlist changes keep the music.
  if (mode === 0 && currentPlaylist(player) !== 0
      && core.Music.setting(player.getAudioSettings(), KEEP_MUSIC_ON_PLAYLIST_BIT) === 0) {
    const settings = player.getAudioSettings()[core.Music.SETTINGS_VARP];
    player.setAudioSetting(core.Music.SETTINGS_VARP, settings & ~(0xf << PLAYLIST_SHIFT));
    sendMusicSettings(player);
  }
}

/** A music dropdown in All Settings: its varbit of varp 19, or the mode. */
function chooseMusicSettingOption(request) {
  const { player, settingId, option } = request;
  if (settingId === MUSIC_MODE_SETTING) {
    chooseMusicMode({ player, buttonId: [...MODE_BUTTONS.keys()][option] });
    request.handled = true;
    return;
  }
  const field = MUSIC_SETTING_DROPDOWNS.get(settingId);
  if (!field) return;
  const [shift, bits] = field;
  const mask = ((1 << bits) - 1) << shift;
  const settings = player.getAudioSettings?.()[core.Music.SETTINGS_VARP] ?? core.Music.DEFAULT_SETTINGS;
  player.setAudioSetting(core.Music.SETTINGS_VARP, (settings & ~mask) | ((option << shift) & mask));
  sendMusicSettings(player);
  request.handled = true;
}

/** Skip Track, in Shuffle mode only: another unlocked track starts at once. */
function skipTrack({ player, opId, action }) {
  if ((opId ?? action ?? 1) !== 1 || (player.getAudioSettings?.()[MUSIC_MODE_VARP] ?? 0) !== 1) return;
  const session = player.getSession();
  const request = { player, previous: session.getCurrentMusicTrack() };
  pickShuffleTrack(request);
  if (request.track === undefined) return;
  session.setCurrentMusicTrack(request.track);
  player.getPacketSender().sendSong(request.track);
}

function onMusicWelcomeAction({ player }) {
  queueMicrotask(() => enableMusicActions(player));
  return false;
}

function answerAirGuitarUnlock(request) {
  request.unlocked = core.WorldDefinition.isMembersWorld()
    && request.player?.getAttribute?.(Progress.AIR_GUITAR_UNLOCKED_ATTRIBUTE) === true;
}

const MUSIC_VOLUME_VARP = 168;
const MUSIC_MODE_VARP = 18;
/** Track 147: silence. */
const SILENCE_TRACK = 147;
const NO_FADES = { fadeOutDelay: 0, fadeOutSpeed: 0, fadeInDelay: 0, fadeInSpeed: 0 };

/**
 * As captured (rsprox revs 236-239, 17 sessions with a music volume change): when the music volume
 * varp rises from 0 the server sends silence with zero fades on that tick and the area track with
 * zero fades on the next, so the client starts the track over; dropping to 0 sends nothing.
 */
/** The latest restart queued for each player; an older one that fires later is stale. */
const restartGeneration = new WeakMap();

/** The track a restart may send now: still the session's current track, in auto mode, with volume. */
function restartStillWanted(player, track) {
  const settings = player.getAudioSettings?.() ?? {};
  return player.isRegistered?.() !== false
    && (settings[MUSIC_MODE_VARP] ?? 0) === 0
    && (settings[MUSIC_VOLUME_VARP] ?? 0) > 0
    && (player.getSession?.()?.getCurrentMusicTrack?.() ?? -1) === track;
}

function restartMusicAfterVolumeRaised({ player, varpId, previous, value }) {
  if (varpId !== MUSIC_VOLUME_VARP || previous !== 0 || !(value > 0)) return;
  if ((player.getAudioSettings?.()?.[MUSIC_MODE_VARP] ?? 0) !== 0) return;
  const track = player.getSession?.()?.getCurrentMusicTrack?.() ?? -1;
  if (track < 0) return;
  const generation = (restartGeneration.get(player) ?? 0) + 1;
  restartGeneration.set(player, generation);
  player.getPacketSender().sendSong(SILENCE_TRACK, NO_FADES);
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player, false);
    }
    execute() {
      this.stop();
      // A region change, a later rise, manual mode or volume 0 since then: the session already
      // sent what is current, so this restart must not put an older track back.
      if (restartGeneration.get(player) !== generation || !restartStillWanted(player, track)) return;
      player.getPacketSender().sendSong(track, NO_FADES);
    }
  })());
}

/**
 * The Music tab's rows in the order its Play slot counts them: music_list_setup indexes
 * db_find(music:hidden, false), before sorting. Column 13 is whether the track is released.
 */
function buildSelectableTracks(tracks) {
  const tracksByRow = new Map(tracks.map(track => [track.rowId, track]));
  return core.CacheDefinitions.getDbTableRows(44)
    .filter(row => row.int(9, 0) === 0)
    .map(row => ({ ...tracksByRow.get(row.id), released: row.int(13, 1) === 1 }));
}

module.exports = {
  name: "Music",
  description: "The music tab: track unlocking, jukebox selection, now-playing, the music cape from Olaf the Bard and air guitar unlock.",
  register(api) {
    core = api.core;
    pluginApi = api;
    const tracks = core.Music.tracks();
    selectableTracks = buildSelectableTracks(tracks);
    trackNames = Object.fromEntries(tracks.map(({ id, name }) => [id, name]));
    rowIdByTrackId = Object.fromEntries(tracks.map(({ id, rowId }) => [id, rowId]));
    slotByTrackId = {};
    const groups = new Map();
    for (const track of tracks) {
      if (!Number.isInteger(track.unlockBank) || !Number.isInteger(track.unlockBit)) continue;
      const varp = Progress.MUSIC_UNLOCK_VARPS[track.unlockBank - 1];
      if (varp === undefined || track.unlockBit < 0 || track.unlockBit > 31) continue;
      const slot = { varp, bit: track.unlockBit };
      slot.key = slotKey(slot);
      slotByTrackId[track.id] = slot;
      if (!groups.has(slot.key)) groups.set(slot.key, []);
      groups.get(slot.key).push(track);
    }
    canonicalTrackBySlot = {};
    for (const [key, entries] of groups) canonicalTrackBySlot[key] = entries[0].id;
    allTrackIds = [...groups.values()].map((entries) => entries[0].id);
    nonHolidayTrackIds = [...groups.values()]
      .filter((entries) => !entries.every(({ name }) => HOLIDAY_TRACKS.has(name)))
      .map((entries) => entries[0].id);
    autoUnlockTrackIds = [...groups.values()]
      .filter((entries) => entries.some(({ autoUnlock }) => autoUnlock))
      .map((entries) => entries[0].id);
    questUnlocks = QuestUnlocks.questTracks(tracks);

    api.persistAttribute(Progress.UNLOCKED_TRACKS_ATTRIBUTE);
    api.persistAttribute(Progress.CAPE_OWNED_ATTRIBUTE);
    api.persistAttribute(Progress.AIR_GUITAR_UNLOCKED_ATTRIBUTE, false);
    api.persistAttribute(SELECTED_TRACK_ATTRIBUTE, -1);
    api.persistAttribute(Playlists.PLAYLISTS_ATTRIBUTE, []);
    api.onPlayerLogin(onMusicLogin);
    api.onInterfaceActionButton(WELCOME_PLAY_BUTTON_UID, onMusicWelcomeAction);
    api.onCustomEvent("gameframe:ready", onMusicWelcomeAction);
    api.onInterfaceActionButton((MUSIC_GROUP_ID << 16) | MUSIC_JUKEBOX_CHILD_ID, selectMusicTrack);
  // A tab mounted again later (Tutorial Island's unlocks) lost its flags too.
  api.onCustomEvent("gameframe:tab-mounted", ({ player, group }) => {
    if (group === MUSIC_GROUP_ID) queueMicrotask(() => enableMusicActions(player));
  });
  api.onCustomEvent("audio:setting-changed", restartMusicAfterVolumeRaised);
    api.onCustomEvent("audio:setting-changed", onMusicSettingsTransmitted);
    api.onCustomEvent("music:shuffle-track", pickShuffleTrack);
    api.onCustomEvent("settings:option-chosen", chooseMusicSettingOption);
    api.onInterfaceActionButton([...MODE_BUTTONS.keys()], chooseMusicMode);
    api.onInterfaceActionButton(SKIP_BUTTON_UID, skipTrack);
    api.onInterfaceActionButton(PLAYLIST_DROPDOWN_UID, choosePlaylist);
    api.onCustomEvent("settings:setting-clicked", wipePlaylistSetting);
    api.onCustomEvent("audio:play-song", onTrackPlayed);
    api.onCustomEvent("music:unlock-track", unlockTrack);
    api.onCustomEvent("quest:completed", onQuestCompleted);
    api.onCustomEvent("music:air-guitar-unlocked", answerAirGuitarUnlock);
    api.onNpcInteraction("Olaf the Bard", { "Talk-to": talkToOlaf });
    api.onItemAction(capeAction);
    api.onCanEquip(canEquipMusicCape);
  },
  _test: {
    unlockTrack, syncMusicVarps, allDiariesComplete, canTrim, buyMusicCape, talkToOlaf, capeAction,
    enableMusicActions, removeInvalidEquippedCape,
    getCatalog: () => ({ allTrackIds, nonHolidayTrackIds, slotByTrackId, canonicalTrackBySlot, autoUnlockTrackIds, questUnlocks }),
    canEquipMusicCape, onMusicLogin, onMusicWelcomeAction, answerAirGuitarUnlock,
    onTrackPlayed, questComplete, unlockQuestTracks, onQuestCompleted, unlockCompletedQuestTracks,
    musicSettingsVarp, pickShuffleTrack, chooseMusicMode, skipTrack, selectMusicTrack, chooseMusicSettingOption,
    choosePlaylist, togglePlaylistTrack, wipePlaylistSetting, shuffleTracks,
  },
};
