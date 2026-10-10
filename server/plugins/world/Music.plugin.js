const fs = require("fs");
const path = require("path");
const Progress = require("./Music.Progress");

const COINS = 995;
const CAPE_PRICE = 99000;
const AIR_GUITAR_VARBIT = 4673;
const MUSIC_GROUP_ID = 239;
const MUSIC_JUKEBOX_CHILD_ID = 11;
const MUSIC_NOW_PLAYING_CHILD_ID = 4;
const CURRENT_MUSIC_TRACK_VARP = 3883;
const MUSIC_NOW_PLAYING_REFRESH_SCRIPT = 3936;
const MUSIC_JUKEBOX_ROW_FLAGS = 62;
const MUSIC_NOW_PLAYING_FLAGS = 60;
const WELCOME_PLAY_BUTTON_UID = (378 << 16) | 72;
const HOLIDAY_TRACKS = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "data", "music-holiday-tracks.json"), "utf8")));
const DIARY_TIERS = ["easy", "medium", "hard", "elite"];
let core;
let pluginApi;
let trackNames;
let rowIdByTrackId;
let allTrackIds;
let nonHolidayTrackIds;
let slotByTrackId;
let canonicalTrackBySlot;
let autoUnlockTrackIds;

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

function unlockTrack({ player, trackId }) {
  trackId = Number(trackId);
  const name = trackNames?.[trackId];
  const slot = slotByTrackId?.[trackId];
  if (!player || !name || !slot || !Progress.unlock(player, canonicalTrackBySlot[slot.key])) return;
  const fullVarps = Progress.varpsFor(Progress.unlockedTracks(player), slotByTrackId);
  player.getPacketSender().sendConfig(slot.varp, fullVarps[slot.varp]);
  player.sendMessage(`You have unlocked a new music track: ${name}.`);
  Progress.refreshCapeUnlock(player, nonHolidayTrackIds);
}

function isDiaryComplete(player, diary, tier) {
  const request = { player, diary, tier, complete: null };
  pluginApi.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function canTrim(player) {
  if (!Progress.allUnlocked(player, allTrackIds)) return false;
  const quests = { player, canUse: false };
  pluginApi.emitCustomEvent("quest-cape:can-use", quests);
  if (quests.canUse !== true) return false;
  const { DIARIES } = require("../diaries/DiaryData");
  return DIARIES.every((diary) =>
    DIARY_TIERS.every((tier) => isDiaryComplete(player, diary.key, tier))
  );
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
    core.TeleportHandler.teleport(player, new core.Location(2689, 3550, 0), core.TeleportType.NORMAL, false);
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

function onMusicLogin({ player }) {
  syncMusicVarps(player);
  queueMicrotask(() => enableMusicActions(player));
}

function onMusicWelcomeAction({ player }) {
  queueMicrotask(() => enableMusicActions(player));
  return false;
}

function answerAirGuitarUnlock(request) {
  request.unlocked = core.WorldDefinition.isMembersWorld()
    && request.player?.getAttribute?.(Progress.AIR_GUITAR_UNLOCKED_ATTRIBUTE) === true;
}

module.exports = {
  name: "Music",
  register(api) {
    core = api.core;
    pluginApi = api;
    const tracks = core.Music.tracks();
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

    for (const attribute of [
      Progress.UNLOCKED_TRACKS_ATTRIBUTE,
      Progress.CAPE_OWNED_ATTRIBUTE,
      Progress.AIR_GUITAR_UNLOCKED_ATTRIBUTE,
    ]) api.persistAttribute(attribute);
    api.onPlayerLogin(onMusicLogin);
    api.onInterfaceActionButton(WELCOME_PLAY_BUTTON_UID, onMusicWelcomeAction);
    api.onCustomEvent("audio:play-song", onTrackPlayed);
    api.onCustomEvent("music:unlock-track", unlockTrack);
    api.onCustomEvent("music:air-guitar-unlocked", answerAirGuitarUnlock);
    api.onNpcInteraction("Olaf the Bard", { "Talk-to": talkToOlaf });
    api.onItemAction(capeAction);
    api.onCanEquip(canEquipMusicCape);
  },
  _test: {
    unlockTrack, syncMusicVarps, isDiaryComplete, canTrim, buyMusicCape, talkToOlaf, capeAction,
    enableMusicActions, removeInvalidEquippedCape,
    getCatalog: () => ({ allTrackIds, nonHolidayTrackIds, slotByTrackId, canonicalTrackBySlot, autoUnlockTrackIds }),
    canEquipMusicCape, onMusicLogin, onMusicWelcomeAction, answerAirGuitarUnlock,
    onTrackPlayed,
  },
};
