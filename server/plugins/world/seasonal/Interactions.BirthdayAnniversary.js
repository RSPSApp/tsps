"use strict";

const Data = require("./Data.BirthdayAnniversary");
const Progress = require("./Progress.BirthdayAnniversary");
const Scene = require("./Scene.BirthdayAnniversary");
const Actors = require("./Actors.BirthdayAnniversary");
const Dialogue = require("./Dialogue.BirthdayAnniversary");
const TELEKINETIC_GRAB_SPELL_ID = 1168;
const BIRTHDAY_FOOD_AREA = "birthday-event";
const GONE_OFF = "The cake seems to have gone off. How sad.";
// Gary waits this long for a player still walking into the room before letting them be.
const WELCOME_WAIT_TICKS = 20;

function ready(player) { return Scene.active() && player.isRegistered() && player.getHitpoints() > 0 && !player.busy(); }
function talkTo(event) {
  const action = event.npc.getCurrentDefinition(event.player)?.getActions?.()?.[event.clickType - 1];
  return String(action ?? "").toLowerCase() === "talk-to";
}
function stopFor(api, player, npc) {
  const ids = new Set([npc.getId(), npc.getCurrentDefinition(player)?.getId()]);
  return Data.STOPS.find(stop =>
    (stop.archived ?? []).some(symbol => ids.has(Scene.archivedId(api, "npc", symbol))) ||
    stop.npcs.some(name => ids.has(api.core.CacheDefinitions.getNpcId(name)))) ?? null;
}
function garyOutside(api, player, npc) {
  const state = Progress.read(player);
  let variant = "starting-off-talking-to-gary-after-asking-about-the-mementos";
  if (state.phase === "new") variant = state.met ? "starting-off-talking-to-gary-again-before-starting" : "starting-off";
  else if (state.phase === "agreed") variant = "starting-off-talking-to-gary-again-after-starting";
  return Dialogue.start(api, { player, npc, variant, met: state.met, hatless: true });
}
function garyInside(api, player, npc) {
  const state = Progress.read(player);
  if (state.phase === "returned") {
    return Dialogue.start(api, { player, npc, variant: Dialogue.cabbage(api, player) !== null
      ? "collecting-mementos-back-at-the-house-returning-with-a-cabbage" : "collecting-mementos-back-at-the-house" });
  }
  if (state.phase === "ritual" || state.phase === "portal") {
    // The cabbage is placed: the ritual (or its closing line) resumes from the cutscene step.
    return Dialogue.start(api, { player, npc, variant: "collecting-mementos-back-at-the-house-returning-with-a-cabbage",
      select: steps => Dialogue.tailFrom(steps, row => row.id === "fxjIFk") ?? steps });
  }
  return false;
}
function garyRealm(api, player, npc) {
  const state = Progress.read(player);
  if (state.phase === "realm") return Dialogue.start(api, { player, npc, variant: "finishing-up" });
  if (state.phase === "rewarding" && !Progress.rewarded(player)) {
    return Dialogue.start(api, { player, npc, variant: "finishing-up",
      select: steps => Dialogue.tailFrom(steps, row => String(row.text ?? "").startsWith("Now, I must reward you")) ?? steps });
  }
  if (Progress.rank(state.phase) >= Progress.rank("rewarding")) return Dialogue.start(api, { player, npc, variant: "in-the-realm-of-memories-wizard-gary" });
  return false;
}
function enterPortal(api, player) {
  if (Progress.read(player).phase !== "portal" && Progress.rank(Progress.read(player).phase) < Progress.rank("realm")) return false;
  const arrival = Data.REALM_ARRIVAL;
  player.moveTo(new api.core.Location(arrival.x, arrival.y, arrival.z));
  if (Progress.advance(api, player, "portal", "realm")) {
    Dialogue.start(api, { player, npc: Actors.parentFor(api, "realm"), variant: "finishing-up" });
  }
  return true;
}

/** Talk-to and Enter on the event's own actors, and the event options of memento sources. */
function interact(api, event) {
  const { player, npc } = event;
  if (!Scene.active() || !ready(player)) return;
  const role = Actors.role(api, npc);
  if (role) {
    event.handled = true;
    // A multinpc parent this player cannot see answers nothing.
    if (!npc.getCurrentDefinition(player)) return;
    if (role === "portal") { enterPortal(api, player); return; }
    if (!talkTo(event)) return;
    if (role === "follower") {
      if (Actors.follower(player) === npc) Dialogue.start(api, { player, npc, variant: "collecting-mementos-talking-to-gary-while-he-is-following-the-player" });
      return;
    }
    if (role === "outside") garyOutside(api, player, npc);
    else if (role === "inside") garyInside(api, player, npc);
    else if (role === "realm" || role === "grayzag") garyRealm(api, player, Actors.parentFor(api, "realm"));
    else if (role === "thief") memento(api, event, Data.STOPS.find(stop => stop.key === "thief"));
    return;
  }
  if (!talkTo(event)) return;
  const stop = stopFor(api, player, npc);
  if (stop) memento(api, event, stop);
}
function memento(api, event, stop) {
  const { player, npc } = event, state = Progress.read(player);
  // An ordinary talk must not inherit a finished event conversation's menu handoff.
  if (state.phase !== "collecting" || state.collected.includes(stop.key)) { Dialogue.clear({ player }); return; }
  if (Dialogue.start(api, { player, npc, variant: stop.variant, stop: stop.key, hints: true })) event.handled = true;
}
function strayed(api, { player, npc }) {
  if (Actors.follower(player) === npc && ready(player)) Dialogue.start(api, { player, npc, variant: "collecting-mementos-straying-too-far-outside-varrock" });
}
/** Returning upstairs with every memento: Gary takes his place by the grid. */
function arrived(api, { player }) {
  const state = Progress.read(player);
  if (state.phase !== "collecting" || !Progress.allCollected(state) || !Progress.advance(api, player, "collecting", "returned")) return;
  Actors.dismiss(api, player);
  // Gary speaks once the player stops in the room: the stair landing only pauses the walk,
  // and a conversation opened mid-walk closes at the next step.
  let waited = 0;
  api.getTaskManager().submit(new (class GaryWelcome extends api.core.Task {
    constructor() { super(1); }
    execute() {
      const state = welcomeState(player);
      if (state === "wait" && ++waited < WELCOME_WAIT_TICKS) return;
      this.stop();
      if (state === "ready") welcome(api, player);
    }
  })());
}
function welcomeState(player) {
  if (!ready(player) || Progress.read(player).phase !== "returned" || !Actors.inHouse(player.getLocation())) return "gone";
  return player.getMovementQueue().size() === 0 ? "ready" : "wait";
}
function welcome(api, player) {
  Dialogue.start(api, { player, npc: Actors.parentFor(api, "inside"), variant: "collecting-mementos-back-at-the-house" });
}

function itemOnNpc(api, event) {
  const { player, target } = event;
  if (!Scene.active()) return;
  const role = Actors.role(api, target);
  if (!role || !target.getCurrentDefinition(player)) return;
  event.handled = true;
  if (role === "follower" && Actors.follower(player) === target) {
    Dialogue.start(api, { player, npc: target, variant: "collecting-mementos-using-any-item-on-gary-while-collecting-momentos" });
  } else if (role === "inside" && Progress.read(player).phase === "returned") {
    const isCabbage = Data.CABBAGES.some(name => api.core.ItemIdentifiers[name] === event.itemId);
    Dialogue.start(api, { player, npc: target, variant: isCabbage ? "collecting-mementos-back-at-the-house-returning-with-a-cabbage"
      : "collecting-mementos-back-at-the-house-using-any-item-other-than-a-cabbage-on-gary" });
  }
}
function itemOnObject(api, event) {
  const symbol = Scene.archivedSymbol(api, "loc", event.objectId);
  if (!symbol?.startsWith("25th_grid_")) return;
  event.handled = true;
  const variant = Progress.complete(event.player) ? "post-event-using-an-item-on-one-of-the-mementos" : "collecting-mementos-using-any-item-on-a-ritual-tile";
  Dialogue.start(api, { player: event.player, npc: Actors.parentFor(api, "inside"), variant });
}
function spellOnNpc(api, event) {
  if (!Scene.active() || Actors.role(api, event.npc) !== "hat" || !event.npc.getCurrentDefinition(event.player)) return;
  const name = event.spellName ?? event.spell?.name ?? event.spell?.getName?.();
  if (name !== "Telekinetic Grab" && event.spellId !== TELEKINETIC_GRAB_SPELL_ID) return;
  event.handled = true;
  Dialogue.start(api, { player: event.player, npc: Actors.parentFor(api, "outside"), variant: "starting-off-attempting-to-telegrab-his-hat", hatless: true });
}

/** The event ladder joins the inn's balcony (plane 1) and its roof (plane 3) at one tile. */
function climb(api, request) {
  const symbol = Scene.archivedSymbol(api, "loc", request.objectId);
  if (symbol !== "25th_ladder_bottom" && symbol !== "25th_ladder_top") return;
  request.handled = true;
  const p = request.object.getLocation(), up = symbol === "25th_ladder_bottom";
  // forceapproach=north below and south above: the player steps off on that side.
  const destination = new api.core.Location(p.getX(), p.getY() + (up ? -1 : 1), up ? 3 : 1);
  api.emitCustomEvent(up ? "ladders:climbUp" : "ladders:climbDown", { player: request.player, destination });
}
function leaveRealm(api, { player }) {
  const exit = Data.REALM_EXIT;
  player.moveTo(new api.core.Location(exit.x, exit.y, exit.z));
  return true;
}
function exitPortal(api, event) {
  if (Scene.archivedSymbol(api, "loc", event.objectId) !== "25th_portal_exit") return false;
  return leaveRealm(api, event);
}
function takeCake(api, { player, objectId }) {
  // The 2026 cake is its own (yellow) rev236 definition, so it is usually the archived copy.
  const cake = objectId === api.core.CacheDefinitions.getLocId("birthdaycake_full") || Scene.archivedSymbol(api, "loc", objectId) === "birthdaycake_full";
  if (!Scene.active() || !cake) return false;
  const slice = new api.core.Item(api.core.ItemIdentifiers.SLICE_OF_BIRTHDAY_CAKE, 1);
  if (player.getInventory().getAddableAmount(slice) !== 1) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  player.getInventory().addItem(slice);
  return true;
}
/** Wiki Slice of birthday cake: after the event, eating one throws every slice away. */
function cakeArea(api, request) {
  if (request?.area !== BIRTHDAY_FOOD_AREA) return;
  if (Scene.active()) { request.inside = true; return; }
  const inventory = request.player.getInventory(), id = api.core.ItemIdentifiers.SLICE_OF_BIRTHDAY_CAKE;
  inventory.delete(id, inventory.getAmount(id));
  request.message = GONE_OFF;
}
module.exports = { interact, strayed, arrived, itemOnNpc, itemOnObject, spellOnNpc, climb, exitPortal, leaveRealm, takeCake, cakeArea };
