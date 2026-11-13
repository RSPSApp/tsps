// Summon boat tablets (https://oldschool.runescape.wiki/w/Summon_boat): bring a boat with a
// teleport focus to the dock or mooring point the player is near. As captured (rsprox, four
// breaks): Break opens the boat selection in its Summon mode (6); choosing a boat moves it, the
// player breaks the tablet (poh_smash_magic_tablet, sound 965), and two ticks later "Your boat has
// been summoned to <dock>." with teleport_other_casting, sound 199 and the tablet used up; busy
// clears two ticks after that. Like a shipwright's recovery, the hold loses its port task cargo,
// salvage and fish (Wiki). "Last boat" summons the boat last summoned without the interface.
// ponytail: how near "near a dock" is isn't in the client cache (table 194's zones are server
// side): within SUMMON_RANGE of the gangplank or landing here, which covers the captured breaks.
// "Last boat" isn't captured: it plays as Break's choice does; its refusals and the same-dock
// message are ours.
//
// The standard spellbook's Summon Boat (https://oldschool.runescape.wiki/w/Summon_Boat): level 56,
// two law, an earth and a water rune, 66 Magic xp, after The Pandemonium. Cast near a dock it opens
// the same selection; choosing a boat uses the runes, moves the boat and plays the superheat cast
// with boat_retrieve_cast and sound 10900, and two ticks later "Your boat has been summoned to
// <dock>.". Its right-click "Last Boat" summons the boat last summoned.
//
// A boat whose hold carries cargo a summon loses (port task cargo, bounty items, salvage, fish)
// warns first: the selection closes, a message box says so, and "Summon your boat to <dock>? Any
// cargo will be lost." asks Yes or No. Ours: the tablet and "Last boat" warn the same way.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { content, dockNear } = require("./SailingContent.Sailing");
const { teleportFocusOf } = require("./BoatFacilities.Sailing");
const { openBoatSelection, MODE } = require("./BoatSelection.Sailing");
const { dropLostOnRecovery, holdsLostOnRecovery } = require("./Cargo.Sailing");
const { sendBoatVarbits } = require("./BoatVarbits.Sailing");

const LAST_SUMMONED_ATTRIBUTE = "sailing:last-summoned-boat";
const SUMMON_RANGE = 16;

function nearbyDock(player) {
  return dockNear(player, SUMMON_RANGE);
}
const VARBIT_BUSY = 12393;
const SEQ_BREAK_TABLET = 4069; // poh_smash_magic_tablet
const SOUND_BREAK_TABLET = 965;
const SEQ_CAST = 1818; // human_teleport_other_casting
const SPOT_CAST = 343; // teleport_other_casting
const SOUND_CAST = 199;
const CAST_TICKS = 2;
const BUSY_TICKS = 4;

const NOT_NEAR_DOCK = "You need to be near a dock or mooring point to use this tablet.";
const SPELL_NOT_NEAR_DOCK = "You need to be near a dock or mooring point to use this spell.";
const NO_FOCUS = "Your boat needs to have a teleport focus on it for you to do that.";
const NO_PANDEMONIUM = "You must have completed Pandemonium to use this spell.";

const SPELL_NAME = "Summon Boat";
const SPELL_EXPERIENCE = 66;
const SEQ_SPELL = 725; // human_castsuperheatitem
const SPOT_SPELL = 3546; // boat_retrieve_cast
const SOUND_SPELL = 10900;
const SOUND_SPELL_DELAY = 25;
/** Op 1 casts; op 2 is the spell's right-click "Last Boat". */
const SPELL_OP_LAST_BOAT = 2;

const CARGO_WARNING = "It seems there's something in the cargo hold of that boat. If you summon the boat, the cargo will be lost.";
const CARGO_WARNING_BOX = "It seems there's something in the cargo hold of that boat. If you<br>summon the boat, the cargo will be lost.";
const CARGO_YES = "Yes, summon it without cargo.";
const CARGO_NO = "No, I'd like to keep my cargo.";

let core;
let api;
const spells = new WeakMap();

function later(player, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, player, false); }
    execute() {
      this.stop();
      action();
    }
  })());
}

/**
 * Whether a boat has a teleport focus, or a greater one, built: only those can be summoned (Wiki;
 * table 149's Summon mode `requires_teleport_focus`, which the client checks against the varbit).
 */
function hasFocus(boat) {
  return teleportFocusOf(boat) > 0;
}

function summonRefusal(player, boat, dock) {
  if (!boat) return "You can't choose that boat at the moment.";
  if (!hasFocus(boat)) return NO_FOCUS;
  if (boat.location.kind === "docked" && boat.location.dock === dock.id) return "That boat is already at the nearby dock.";
  return Sailing.recoverRefusal(player, boat.slot, dock.id);
}

/**
 * How a summon is paid for and shown, by a tablet or by the spell: `usable` before anything (it
 * sends its own refusal), `near` the line for a dock left behind, `pay` uses it up (false when it
 * can't), `cast` plays at the move and `landed` with the message.
 */
function tabletCast(itemId) {
  return {
    usable: (player) => player.getInventory().contains(itemId),
    near: NOT_NEAR_DOCK,
    // The tablet goes with the boat's move, not with the cast two ticks later (when the captures show it leave the
    // pack): dropping or banking it in between summoned the boat for free and kept the tablet.
    pay: (player) => {
      player.getInventory().deleteNumber(itemId, 1);
      return true;
    },
    cast: (player) => {
      player.performAnimation(new core.Animation(SEQ_BREAK_TABLET, 16));
      player.getPacketSender().sendSoundEffect(SOUND_BREAK_TABLET, 1, 15);
    },
    landed: (player) => {
      player.performGraphic(new core.Graphic(SPOT_CAST));
      player.performAnimation(new core.Animation(SEQ_CAST));
      const at = player.getLocation();
      core.Sounds.playAreaSound({ soundId: SOUND_CAST, x: at.getX(), y: at.getY(), level: at.getZ(), radius: 10 });
    },
  };
}

/** The spell: runes and xp at the move, with the cast's animation, graphic and sound. */
function spellCast() {
  return {
    usable: (player) => spellFor(core, SPELL_NAME, SPELL_EXPERIENCE).canCast(player, false),
    near: SPELL_NOT_NEAR_DOCK,
    pay: (player) => {
      if (!spellFor(core, SPELL_NAME, SPELL_EXPERIENCE).canCast(player, true)) return false;
      player.getSkillManager().addExperiences(core.Skill.MAGIC, SPELL_EXPERIENCE);
      return true;
    },
    cast: (player) => {
      player.performAnimation(new core.Animation(SEQ_SPELL));
      player.performGraphic(new core.Graphic(SPOT_SPELL, 92));
      player.getPacketSender().sendSoundEffect(SOUND_SPELL, 1, SOUND_SPELL_DELAY);
    },
    landed: () => {},
  };
}

/** Summons the boat in `slot` to `dock`, paid for `by` a tablet or the spell; cargo it would lose asks first. */
function summon(player, by, dock, slot) {
  const boat = player.getSailing().boats.find((owned) => owned.slot === slot);
  if (refused(player, by, boat, dock)) return;
  if (holdsLostOnRecovery(boat)) {
    warnCargo(player, dock, () => summonNow(player, by, dock, slot));
    return;
  }
  summonNow(player, by, dock, slot);
}

/** Sends the refusal, if any, and clears busy; false when the summon can go ahead. */
function refused(player, by, boat, dock) {
  const refusal = by.usable(player) ? summonRefusal(player, boat, dock) : "";
  if (refusal === null) return false;
  if (refusal) player.sendMessage(refusal);
  player.getPacketSender().sendVarbit(VARBIT_BUSY, 0);
  return true;
}

/** The message box (also a mesbox chat line), then the question; nothing is used up until Yes. */
function warnCargo(player, dock, proceed) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = core;
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT_BUSY, 0);
  const question = `Summon your boat to ${dock.theName}? Any cargo will be lost.`;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new StatementDialogue(0, CARGO_WARNING_BOX))
    .add(new ActionDialogue(1, {
      execute: () => api.sendMultiChatboxPrompt(player, question, CARGO_YES, proceed, CARGO_NO, () => {}),
    })));
}

function summonNow(player, by, dock, slot) {
  const sender = player.getPacketSender();
  const boat = player.getSailing().boats.find((owned) => owned.slot === slot);
  // Asked again after a cargo warning: the player may have walked away from the dock meanwhile.
  if (nearbyDock(player)?.id !== dock.id || Sailing.instanceAboard(player)) {
    player.sendMessage(by.near);
    sender.sendVarbit(VARBIT_BUSY, 0);
    return;
  }
  if (refused(player, by, boat, dock)) return;
  if (!by.pay(player)) {
    sender.sendVarbit(VARBIT_BUSY, 0);
    return;
  }
  Sailing.recover(player, slot, dock.id);
  dropLostOnRecovery(boat);
  sendBoatVarbits(player);
  player.setAttribute(LAST_SUMMONED_ATTRIBUTE, slot);
  by.cast(player);
  later(player, CAST_TICKS, () => {
    player.sendMessage(`Your boat has been summoned to ${dock.theName}.`);
    by.landed(player);
  });
  later(player, BUSY_TICKS, () => sender.sendVarbit(VARBIT_BUSY, 0));
}

/** A standard-spellbook boat spell, with the cache's level and runes (`core`: the plugin api's). */
function spellFor(core, name, experience) {
  if (spells.get(core)?.has(name)) return spells.get(core).get(name);
  const widget = core.CacheDefinitions.getSpellByName(name);
  const requirements = core.CacheDefinitions.getSpellRequirements(name);
  if (!widget || !requirements) throw new Error(`Missing cache spell: ${name}`);
  const spell = new (class extends core.Spell {
    spellId() { return widget.widgetId; }
    levelRequired() { return requirements.level; }
    baseExperience() { return experience; }
    itemsRequired() { return requirements.runes.map((rune) => new core.Item(rune.id, rune.amount)); }
    equipmentRequired() { return []; }
    startCast() {}
    getSpellbook() { return core.MagicSpellbook.NORMAL; }
  })();
  spell.members = true;
  if (!spells.has(core)) spells.set(core, new Map());
  spells.get(core).set(name, spell);
  return spell;
}

/**
 * Both boat spells need The Pandemonium done (Wiki), unless content lifts the spell's lock
 * ("magic:spell-unlocked", a league relic), as for the other quest-locked spells.
 */
function pandemoniumDone(pluginApi, player, spellName) {
  const query = { player, key: "pandemonium", complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", query);
  if (query.complete === true) return true;
  const unlock = { player, name: spellName.toLowerCase(), unlocked: false };
  pluginApi.emitCustomEvent("magic:spell-unlocked", unlock);
  return unlock.unlocked === true;
}

/** Whether a spell cast event is for the spell named `name`. */
function isSpell(event, name) {
  return String(event?.spellName ?? "").toLowerCase() === name.toLowerCase();
}

function castSpell(event) {
  if (!isSpell(event, SPELL_NAME)) return;
  event.handled = true;
  const { player } = event;
  if (!pandemoniumDone(api, player, SPELL_NAME)) {
    player.sendMessage(NO_PANDEMONIUM);
    return;
  }
  const dock = !Sailing.instanceAboard(player) && nearbyDock(player);
  if (!dock) {
    player.sendMessage(SPELL_NOT_NEAR_DOCK);
    return;
  }
  if (!player.getSailing().boats.some(hasFocus)) {
    player.sendMessage(NO_FOCUS);
    return;
  }
  if (event.opId === SPELL_OP_LAST_BOAT) {
    summonLast(player, spellCast(), dock);
    return;
  }
  openBoatSelection(player, MODE.SUMMON, dock, (slot) => summon(player, spellCast(), dock, slot));
}

function breakTablet({ player, itemId }) {
  const dock = !Sailing.instanceAboard(player) && nearbyDock(player);
  if (!dock) {
    player.sendMessage(NOT_NEAR_DOCK);
    return true;
  }
  openBoatSelection(player, MODE.SUMMON, dock, (slot) => summon(player, tabletCast(itemId), dock, slot));
  return true;
}

function lastBoat({ player, itemId }) {
  const dock = !Sailing.instanceAboard(player) && nearbyDock(player);
  if (!dock) {
    player.sendMessage(NOT_NEAR_DOCK);
    return true;
  }
  summonLast(player, tabletCast(itemId), dock);
  return true;
}

function summonLast(player, by, dock) {
  const slot = player.getAttribute(LAST_SUMMONED_ATTRIBUTE);
  if (!Number.isInteger(slot)) {
    player.sendMessage("You haven't summoned a boat yet.");
    return;
  }
  player.getPacketSender().sendVarbit(VARBIT_BUSY, 1);
  summon(player, by, dock, slot);
}

module.exports = {
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    content();
    api.persistAttribute(LAST_SUMMONED_ATTRIBUTE);
    api.onItemAction("Summon boat", { Break: breakTablet, "Last boat": lastBoat });
    api.onSpellCast(castSpell);
  },
  spellFor,
  pandemoniumDone,
  isSpell,
  _test: {
    nearbyDock, hasFocus, summon, tabletCast, spellCast, castSpell,
    SUMMON_RANGE, LAST_SUMMONED_ATTRIBUTE, CARGO_WARNING, CARGO_WARNING_BOX, CARGO_YES, CARGO_NO,
  },
};
