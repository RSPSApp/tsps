/**
 * Unlocking an area: the defaults a league character starts with, the checks on a pick (a league
 * character, an area the league offers and the character lacks, a slot left, the slot's tasks),
 * the captured presentation (the emote, the league's spotanim, the modal closed, four sounds;
 * fourteen ticks later the selection varbit, the chat message, the interface again and the
 * popup), the "New Area Available!" popup when tasks reach the next slot, the login state, the
 * threshold structs the client reads, and the queries other plugins make.
 */
const Common = require("./Common.LeagueAreaUnlocks");
const Regions = require("./Regions.LeagueAreaUnlocks");

/** The varbits the client's scripts read: each slot's area, the last viewed, whether a pick is affordable. */
function sendState(player, type) {
  const { varbits } = Common.data;
  const list = Common.unlocked(player);
  const sender = player.getPacketSender();
  varbits.selection.forEach((varbit, slot) => sender.sendVarbit(varbit, list[slot] ?? 0));
  sender.sendVarbit(varbits.available, Common.available(type, player) ? 1 : 0);
}

/**
 * A league character's first login grants the league's defaults; every login resends the state,
 * and a character standing in a locked square (the world's spawn on its first login, a square the
 * data no longer gives it) starts at the league home.
 */
function login({ player, league }) {
  // LeagueMode sends this event for every league, including those without area unlocks.
  const rules = Common.league(league);
  if (!rules) return;
  if (Common.unlocked(player).length === 0) {
    player.setAttribute(Common.AREAS_ATTRIBUTE, [...rules.defaults]);
    // A new character begins where the league starts it (Demonic Pacts: Yama's Lair).
    if (rules.start) player.moveTo(new Common.core.Location(rules.start.x, rules.start.y, rules.start.z ?? 0));
  }
  // Every unlocked area's content once: the defaults' on a new character, and any a character made
  // before it existed (or saved before an unlock's fourteen ticks ran) has not had yet.
  for (const area of Common.unlocked(player)) completeAreaContent(player, league, area);
  if (!Regions.isOpenAt(league, player, player.getLocation())) {
    player.moveTo(require("./Enforcement.LeagueAreaUnlocks").home(league, player));
  }
  player.getPacketSender().sendVarbit(Common.data.varbits.lastViewed, 0);
  sendState(player, league);
}

/** The areas whose quests, diary tasks and Combat Achievements were completed (area ids). */
const CONTENT_ATTRIBUTE = "league:area-content";

function contentGiven(player) {
  const value = player.getAttribute(CONTENT_ATTRIBUTE);
  return Array.isArray(value) ? value.map(Number) : [];
}

/**
 * What a league completes with an area (Demonic Pacts): its diary tasks (`diary:task`), its Combat
 * Achievements (`combat-achievements:complete`) and its quests (LeagueMode's `league:complete-quests`).
 */
function completeAreaContent(player, type, areaId) {
  const rules = Common.league(type);
  if (!rules?.quests && !rules?.diaryTasks && !rules?.combatAchievements) return;
  const given = contentGiven(player);
  if (given.includes(areaId)) return;
  player.setAttribute(CONTENT_ATTRIBUTE, [...given, areaId]);
  for (const [diary, , task] of rules?.diaryTasks?.[areaId] ?? []) Common.api.emitCustomEvent("diary:task", { player, diary, task });
  for (const task of rules?.combatAchievements?.[areaId] ?? []) Common.api.emitCustomEvent("combat-achievements:complete", { player, task });
  const quests = rules?.quests?.[areaId];
  if (Array.isArray(quests) && quests.length) Common.api.emitCustomEvent("league:complete-quests", { player, quests });
}

/** `league:content-rows`: the slots' task counts (script 3682 reads enum 5677's structs, param 1010). */
function contribute(rows) {
  if (!rows || !Common.league(rows.league)) return;
  const { structs, param } = Common.data.thresholds;
  structs.forEach((structId, slot) => {
    rows.structs.push({ structId, params: { [param]: Common.thresholdFor(rows.league, slot) ?? 0 } });
  });
}

/** Why a pick is refused (a message key), or null when it may go ahead. */
function refusal(player, type, areaId) {
  if (type === null) return "notLeague";
  const area = Common.area(areaId);
  if (!area || !Common.league(type).areas.includes(area.id)) return "notInLeague";
  if (Common.unlocked(player).includes(area.id)) return "alreadyUnlocked";
  const next = Common.nextSlot(type, player);
  if (next === null) return "noMoreAreas";
  if (Common.tasks(player) < next.tasks) return "moreTasks";
  // A league whose first pick is fixed (Demonic Pacts' Karamja): the slot after the defaults takes only it.
  const { firstPick, defaults } = Common.league(type);
  if (Number.isInteger(firstPick) && next.slot === defaults.length && area.id !== firstPick) return "firstPick";
  return null;
}

/** The state script 3668 shows for an area: unlocked, available, full, a message (not this league's) or locked. */
function state(player, type, areaId) {
  const { states } = Common.data.interface;
  if (Common.unlocked(player).includes(Number(areaId))) return states.unlocked;
  switch (refusal(player, type, areaId)) {
    case null: return states.available;
    case "noMoreAreas": return states.full;
    case "notInLeague":
    case "firstPick": return states.message;
    default: return states.locked;
  }
}

/** The captured unlock, at once: the emote, the league's spotanim for the area, the modal closed, the sounds. */
function present(player, type, area) {
  const { Animation, Graphic } = Common.core;
  const ui = Common.data.interface;
  player.performAnimation(new Animation(ui.unlockAnimation));
  player.performGraphic(new Graphic(Common.spotanim(type, area.id)));
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  for (const [sound, delay] of ui.unlockSounds) sender.sendSound(sound, 1, delay);
}

/** The captured unlock, fourteen ticks on: the slot's varbit, the chat message, the interface again, the popup. */
function complete(player, type, area, slot) {
  const { varbits, notifications } = Common.data;
  const sender = player.getPacketSender();
  sender.sendVarbit(varbits.selection[slot], area.id);
  completeAreaContent(player, type, area.id);
  player.sendMessage(Common.message("unlocked", { colour: Common.colourHex(type), area: area.name }));
  require("./Interface.LeagueAreaUnlocks").open({ player });
  const popup = notifications.areaUnlocked;
  Common.api.emitCustomEvent("notification:show", {
    player,
    title: popup.title,
    text: popup.text.replace("{area}", area.name),
    colour: Common.leagueInfo(type).colour,
    jingle: popup.jingle,
  });
  sender.sendVarbit(varbits.available, Common.available(type, player) ? 1 : 0);
}

/**
 * Unlocks area `areaId` for the player, or tells them why not. Returns true when it was unlocked.
 * The save and `league:area-unlocked` are immediate; the presentation's second half runs fourteen
 * ticks on (a logout in between loses only that: the login resends the varbits).
 */
function unlock(player, areaId) {
  const type = Common.leagueOf(player);
  const why = refusal(player, type, areaId);
  if (why) {
    player.sendMessage(Common.message(why));
    return false;
  }
  const area = Common.area(areaId);
  const list = [...Common.unlocked(player), area.id];
  const slot = list.length - 1;
  player.setAttribute(Common.AREAS_ATTRIBUTE, list);
  Common.api.emitCustomEvent("league:area-unlocked", { player, league: type, area: area.id, slot });
  present(player, type, area);
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Common.data.interface.unlockDelayTicks, player, false);
    }

    execute() {
      this.stop();
      complete(player, type, area, slot);
    }
  })());
  return true;
}

/** An award that reaches the next slot's tasks shows the popup once (captures 227/00075, 00196). */
function pointsChanged({ player, tasks, previousTasks }) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  const next = Common.nextSlot(type, player);
  const before = Number.isInteger(previousTasks) ? previousTasks : tasks - 1;
  if (next === null || tasks < next.tasks || before >= next.tasks) return;
  const popup = Common.data.notifications.areaAvailable;
  player.getPacketSender().sendVarbit(Common.data.varbits.available, 1);
  Common.api.emitCustomEvent("notification:show", {
    player,
    title: popup.title,
    text: popup.text,
    colour: Common.leagueInfo(type).colour,
    jingle: popup.jingle,
  });
}

/** `league:areas` { player } -> league, unlocked (ids in order), next ({ slot, tasks } or null), available. */
function answerAreas(query) {
  if (!query) return;
  const type = query.player ? Common.leagueOf(query.player) : null;
  query.league = type;
  query.unlocked = type === null ? [] : Common.unlocked(query.player);
  query.next = type === null ? null : Common.nextSlot(type, query.player);
  query.available = type !== null && Common.available(type, query.player);
}

/** world.json pluginConfig key naming the world's league (LeagueMode reads the same one). */
const LEAGUE_TYPE_CONFIG = "league:type";

/** `league:area-at` { x, y, player | league } -> area (id or null when open), name. The world's league when neither is given. */
function answerAreaAt(query) {
  if (!query) return;
  let type = query.player ? Common.leagueOf(query.player) : Number(query.league ?? Common.api.getPluginConfig(LEAGUE_TYPE_CONFIG, 0));
  if (!Common.league(type)) type = null;
  query.area = type === null ? null : Regions.areaAt(type, query.x | 0, query.y | 0);
  query.name = query.area === null ? null : Common.area(query.area).name;
}

module.exports = function attach(api) {
  api.persistAttribute(Common.AREAS_ATTRIBUTE, []);
  api.persistAttribute(CONTENT_ATTRIBUTE, []);
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("league:content-rows", contribute);
  api.onCustomEvent("league:points-changed", pointsChanged);
  api.onCustomEvent("league:areas", answerAreas);
  api.onCustomEvent("league:area-at", answerAreaAt);
};

Object.assign(module.exports, { unlock, refusal, state, sendState });
