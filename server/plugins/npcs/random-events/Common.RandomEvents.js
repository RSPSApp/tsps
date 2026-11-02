"use strict";

// Lifecycle and serve flow adapted from GregHib/void (BSD-3-Clause);
// Genie/Dwarf owner checks and rewards adapted from LostCityRS/Content (MIT).
// See SOURCES.md and LICENSES.txt alongside this module.
const TRAY_GROUP = 297;
const TRAY_TITLE = (TRAY_GROUP << 16) | 2;
const TRAY_FIRST_FOOD = 6;
const TRAY_SELECT_ACTION = 1;
const TRAY_MODAL_SCRIPT = 2524;
const TICK_MS = 600;
// Live timeline, the same across every recording (127, 555, 1102, 3275 ...): the greeting at
// +1 tick, a line every 10 ticks after that, the goodbye at +100, gone at +103. A served event
// faces away the next tick and goes on the next multiple of 10 ticks since it appeared.
const NAG_INTERVAL_TICKS = 10;
const EVENT_LIFETIME_MS = 100 * TICK_MS;
const NAG_INTERVAL_MS = NAG_INTERVAL_TICKS * TICK_MS;
const GOODBYE_TICKS = 3;
// The puff of smoke on arrival and departure, with its area sound: 'MapAnim(id=86, height=124)',
// 'SoundArea(id=1930, radius=7)'. The Genie, Dwarf and Certers send it twice on arrival.
const SMOKE_GRAPHIC = 86;
const SMOKE_HEIGHT = 124;
const SMOKE_SOUND = 1930;
const SMOKE_SOUND_RADIUS = 7;
const WAVE_ANIMATION = 863;
const BOW_ANIMATION = 858;
const DWARF_ANIMATION = 105;
const DWARF_HIC_SOUND = 2297;
const GENIE_ARRIVAL_SOUND = 2301;
const MAYBE_LATER = "Maybe later.";
const CHECK_INTERVAL_MS = 5 * 60_000;
const MAX_INTERVAL_MS = 120 * 60_000;
const NEXT_EVENT_ATTRIBUTE = "random-events:next-at";
const MAX_DISTANCE = 15;
const DEFINITIONS_EVENT = "random-events:definitions";
const Locations = require("./Locations.RandomEvents");
const Gift = require("./GiftRewards.RandomEvents");
const Certer = require("./Certer.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");
const Flow = require("./DialogueFlow.RandomEvents");
const players = new Map();
const eventsByNpc = new Map();
let api;
let events;
let foods;

function initialize(pluginApi) {
  shutdown();
  api = pluginApi;
  api.persistAttribute(NEXT_EVENT_ATTRIBUTE);
  Teleports.initialize(pluginApi, { finish });
  if (typeof api.registerArea === "function") {
    for (const area of Teleports.createAreas()) api.registerArea(area);
  }
  const { NpcIdentifiers: N, ItemIdentifiers: I } = api.core;
  // [item, tray model, offer name]. The model belongs to the food by the tray's Key (cache
  // interface 297 lists models 15-21 beside names 22-29); baguette, triangle and square sandwich
  // are confirmed by correct picks (4222, 3057, 1695). "pie" is captured in the tray title (96).
  foods = [
    [I.BAGUETTE, 10726, "baguette"], [I.TRIANGLE_SANDWICH, 10732, "triangle sandwich"],
    [I.SQUARE_SANDWICH, 10731, "square sandwich"], [I.ROLL, 10727, "bread roll"],
    [I.MEAT_PIE, 10730, "pie"], [I.KEBAB, 10729, "kebab"], [I.CHOCOLATE_BAR, 10728, "chocolate bar"],
  ];
  const master = player => player.getAppearance().isMale() ? "Master" : "Mistress";
  const milord = player => player.getAppearance().isMale() ? "milord" : "milady";
  const heShe = player => player.getAppearance().isMale() ? "he" : "she";
  const certerNags = [name => `Talk to me, ${name}!`, name => `Hello, ${name}, are you there?`,
    name => `I'd like to talk to you, ${name}!`, name => `ehem... Hello ${name}, please talk to me!`];
  const oldManLines = [name => `${name}!`, name => `Hello? ${name}?`, name => `Talk to me, ${name}!`,
    name => `${name}? Are you there?`, name => `I'd like to talk to you, ${name}!`];
  // Overhead lines from the captures, which win where the Wiki transcripts differ (Rick's forms
  // of address, the Sandwich lady's punctuation); talk-to-them-later lines from the transcripts.
  events = [
    { id: N.GENIE, underwaterId: N.GENIE_2, kind: "genie", rewards: [I.LAMP], linger: true,
      greet: (name, player) => `Greetings, ${master(player)} ${name}!`,
      nags: [(name, player) => `Hello, ${master(player)} ${name}?`, (name, player) => `Ehem... ${master(player)} ${name}?`,
        (name, player) => `I'm waiting for you, ${master(player)} ${name}!`],
      goodbye: MAYBE_LATER, overheadAnimation: WAVE_ANIMATION, arrivalSmokes: [GENIE_ARRIVAL_SOUND, SMOKE_SOUND],
      otherPlayerLine: owner => `Sorry, I'm trying to talk to someone else, but ${heShe(owner)} seems to be ignoring me.`,
      leavingLine: player => `Have a nice day, ${master(player)}.`,
      rewardLine: (name, player) => `Ah, so you are there, ${master(player)} ${name}. I'm so glad you summoned me. Please take this lamp and make your wish.`,
      rewardExpression: 569 },
    { id: N.SANDWICH_LADY, kind: "sandwich", linger: true,
      greet: name => `Sandwiches, ${name}!`,
      nags: [name => `Did you hear me, ${name}?`, name => `Sandwich delivery for ${name}!`,
        () => "You think I made these just for fun?!", name => `All types of sandwiches, ${name}.`,
        name => `Come on ${name}, I made these specially!`],
      goodbye: MAYBE_LATER,
      otherPlayerLine: owner => `This is for ${owner.getUsername()}, not you.`,
      leavingLine: () => "I'd best be going - lots more sandwiches to deliver!",
      rewardLine: () => "Hope that fills you up!", rewardExpression: 567 },
    { id: N.DRUNKEN_DWARF, kind: "dwarf", rewards: [I.BEER, I.KEBAB], linger: true,
      greet: name => `'Ello der ${name}! *hic*`,
      nags: [name => `Hey, ${name}!`, name => `Oi, are you der ${name}!`, name => `Dunt ignore your mate, ${name}!`,
        name => `I've got something for you, ${name}!`, name => `Aww comeon, talk to ikle me ${name}!`],
      goodbye: "Aww, my mate doesn't like me.", overheadAnimation: DWARF_ANIMATION, overheadSound: DWARF_HIC_SOUND,
      arrivalSmokes: [SMOKE_SOUND, SMOKE_SOUND],
      otherPlayerLine: () => "You're not my matey!",
      leavingLine: () => "I need to go. 'Ave a good 'un buddy!",
      // The Wiki transcript's other wording; only the first is captured (1104, 1885).
      rewardLine: (name, player) => questComplete(player, "Forgettable Tale...")
        ? "I 'new it were you matey! I remember your kebab stories! 'Ere, have some ob the good stuff!"
        : "I 'new it were you matey! 'Ere, have some ob the good<br>stuff!",
      rewardExpression: 568 },
    { id: N.RICK_TURPENTINE, underwaterId: N.RICK_TURPENTINE_2, kind: "gift", linger: true,
      greet: (name, player) => `Good day to you, ${milord(player)}.`,
      nags: [(name, player) => `I seek a moment of your time, ${player.getAppearance().isMale() ? "sirrah" : "milady"}!`,
        (name, player) => `${name}, please speak to me, ${milord(player)}!`],
      goodbye: MAYBE_LATER, overheadAnimation: BOW_ANIMATION,
      otherPlayerLine: () => "It is someone else with whom I desire to speak, but he seems to be preoccupied.",
      leavingLine: player => `I must leave you now, ${player.getAppearance().isMale() ? "sirrah" : "ma'am"}!`,
      rewardLine: (name, player) => `Today is your lucky day, ${player.getAppearance().isMale() ? "sirrah" : "madam"}!<br>I am donating to the victims of crime to atone for my<br>past actions!`,
      rewardExpression: 569 },
    { ids: [N.NILES, N.MILES, N.GILES], underwaterIds: [N.NILES_2, N.MILES_2, N.GILES_2], kind: "certer", linger: true,
      greet: name => `Greetings ${name}, I need your help.`, nags: certerNags,
      goodbye: MAYBE_LATER, overheadAnimation: WAVE_ANIMATION, arrivalSmokes: [SMOKE_SOUND, SMOKE_SOUND],
      leaveAnimation: WAVE_ANIMATION,
      otherPlayerLine: owner => `Sorry, but I'm trying to talk to ${owner.getUsername()}, but ${heShe(owner)} seems to be ignoring me.`,
      leavingLine: () => "I must be leaving now." },
    { id: N.MYSTERIOUS_OLD_MAN_2, underwaterId: N.MYSTERIOUS_OLD_MAN_3, kind: "gift", linger: true,
      greet: (name) => oldManLines[Math.floor(Math.random() * oldManLines.length)](name), nags: oldManLines,
      goodbye: MAYBE_LATER,
      otherPlayerLine: owner => `Sorry, I'm trying to speak to someone else, but ${heShe(owner)} seems to be ignoring me.`,
      leavingLine: () => "Goodbye.",
      rewardLine: () => "Ah, so you are there. I hoped you would talk to me, I get so lonely. Here, have a present! I must be going now though.",
      rewardExpression: 569 },
  ];
  // Members plugins contribute definitions only when loaded by PluginManager.
  api.emitCustomEvent(DEFINITIONS_EVENT, { definitions: events });
}

// Port of Void's initial cooldown and re-arming before an attempted spawn.
// Mod Ash's Wiki-cited timing is a real-time 60–120 minute interval.
function nextEventAt(now) {
  return now + (60 + Math.random() * 60) * 60_000;
}

function eventAvailable(definition, player) {
  return Locations.available(api, definition, player);
}

function disallowedLocation(player) {
  const location = player.getLocation();
  const x = location.getX(), y = location.getY();
  return player.getPrivateArea?.() != null || (location.getZ() === 0 && x >= 3060 && x <= 3165 &&
    ((y >= 3060 && y <= 3165) || (y >= 9400 && y <= 9620)));
}

function login({ player }) {
  if (Teleports.hasSession(player)) Teleports.departed(player, true);
  cleanup({ player });
  if (player?.isPlayerBot?.() === true) return;
  Teleports.recover(player);
  const now = Date.now();
  let nextAt = Number(player.getAttribute(NEXT_EVENT_ATTRIBUTE));
  if (!Number.isFinite(nextAt) || nextAt <= 0 || nextAt > now + MAX_INTERVAL_MS) nextAt = nextEventAt(now);
  else if (nextAt <= now) nextAt = now + (10 + Math.random() * 60) * 60_000;
  player.setAttribute(NEXT_EVENT_ATTRIBUTE, nextAt);
  players.set(player, { nextAt, checkAt: now, pending: false, active: null });
}

function eligible(player, forCommand = false) {
  return player.isRegistered() && player.isPlayerBot?.() !== true &&
    player.getHitpoints() > 0 && !player.busy() && !player.isDyingReturn?.() &&
    !player.isTeleportingReturn?.() && player.getForceMovement?.() == null &&
    !disallowedLocation(player) &&
    (forCommand || !player.getDueling?.().inDuel?.()) &&
    !(player.getNpcTransformationId?.() >= 0);
}

function spawn(player, state, now, definition = null) {
  const origin = player.getLocation();
  const { Location } = api.core;
  // LostCity uses a line-of-walk square beside the player; the local collision
  // manager's traversal check rejects walls as well as blocked destination tiles.
  // Any of the eight squares around a standing player, diagonals too (live spawn offsets).
  const candidates = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const region = api.getRegionManager();
  const tiles = candidates.map(([dx, dy]) => new Location(origin.getX() + dx, origin.getY() + dy, origin.getZ()))
    .filter((location) => !region.blocked(location, player.getPrivateArea?.()) &&
      region.canMovestart(origin, location, 1, 1, player.getPrivateArea?.()));
  if (!tiles.length) return false;
  definition ??= events[Math.floor(Math.random() * events.length)];
  const underwater = Locations.underwater(player);
  const idIndex = definition.ids ? Math.floor(Math.random() * definition.ids.length) : -1;
  const foodIndex = definition.kind === "sandwich" ? Math.floor(Math.random() * foods.length) : null;
  const tile = tiles[Math.floor(Math.random() * tiles.length)];
  const npc = api.spawnNpc({
    id: definition.ids
      ? ((underwater && definition.underwaterIds) || definition.ids)[idIndex]
      : (underwater && definition.underwaterId) || definition.id,
    x: tile.getX(), y: tile.getY(), z: tile.getZ(),
    owner: player, wanderRadius: 0,
  });
  if (!npc) return false;
  const active = {
    player, npc, definition, startedAt: now, expiresAt: now + (definition.lifetimeMs ?? EVENT_LIFETIME_MS),
    nextNagAt: now + NAG_INTERVAL_MS, greeted: !definition.greet,
    foodIndex,
    trayOpen: false,
  };
  state.active = active;
  eventsByNpc.set(npc, active);
  if (!definition.stationary) {
    npc.setFollowing(player);
    npc.setMobileInteraction(player);
  }
  if (definition.greeting) npc.forceChat(`${definition.greeting} ${player.getUsername()}!`);
  for (const sound of definition.arrivalSmokes ?? [SMOKE_SOUND]) smoke(npc, player, sound);
  definition.onSpawn?.(active);
  return true;
}

function questComplete(player, name) {
  const request = { player, name, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function smoke(npc, owner, sound = SMOKE_SOUND) {
  if (!owner.isRegistered()) return;
  const tile = npc.getLocation();
  owner.getPacketSender().sendGlobalGraphic(new api.core.Graphic(SMOKE_GRAPHIC, 0, SMOKE_HEIGHT), tile);
  const area = owner.getPrivateArea?.();
  api.core.World.forEachNetworkPlayer((viewer) => {
    if (viewer.getPrivateArea?.() !== area || !tile.isViewableFrom(viewer.getLocation())) return;
    viewer.getPacketSender().sendAreaSound(sound, tile.getX(), tile.getY(), tile.getZ(), 1, 0, SMOKE_SOUND_RADIUS);
  });
}

/** One overhead line, with the animation (and for the Dwarf the hic) that goes with it. */
function speak(active, text) {
  const { npc, definition, player } = active;
  npc.forceChat(text);
  if (definition.overheadAnimation != null) npc.performAnimation(new api.core.Animation(definition.overheadAnimation));
  if (definition.overheadSound != null) player.getPacketSender().sendSound(definition.overheadSound, 1, 0);
}

function spawnCommand(event) {
  event.handled = true;
  const { player, parts } = event;
  const index = parts.length === 1 ? Math.floor(Math.random() * events.length) : Number(parts[1]);
  if (parts.length > 2 || (parts.length === 2 && !/^\d+$/.test(parts[1])) ||
      !Number.isInteger(index) || index < 0 || index >= events.length) {
    player.sendMessage(`Usage: ::randevt [id] (0-${events.length - 1}; omit id for random).`);
    return;
  }
  if (!eligible(player, true) || !eventAvailable(events[index], player)) {
    player.sendMessage("Random events cannot appear here or while you are busy.");
    return;
  }
  login({ player }); // Replace the previous owned event and re-arm its cooldown.
  const state = players.get(player);
  state.nextAt = nextEventAt(Date.now());
  player.setAttribute(NEXT_EVENT_ATTRIBUTE, state.nextAt);
  if (spawn(player, players.get(player), Date.now(), events[index])) {
    player.sendMessage(`Spawned random event ${index} (${events[index].kind}).`);
  } else {
    player.sendMessage("No traversable square is available beside you.");
  }
}

function valid(active, player, now = Date.now()) {
  if (!active || active.player !== player || active.npc.getOwner() !== player ||
      players.get(player)?.active !== active || now >= active.expiresAt ||
      !player.isRegistered() || player.getHitpoints() <= 0) return false;
  const a = player.getLocation(), b = active.npc.getLocation();
  return player.getPrivateArea?.() == null && a.getZ() === b.getZ() && a.getDistance(b) <= MAX_DISTANCE &&
    !disallowedLocation(player) && Locations.available(api, active.definition, player, true);
}

function closeInterface(active) {
  if (active.interfaceId && active.player.getInterfaceId() === active.interfaceId) {
    active.player.getPacketSender().sendInterfaceRemoval();
  }
}

function finish(active) {
  const state = players.get(active.player);
  if (state?.active === active) state.active = null;
  state?.leaving?.delete(active);
  eventsByNpc.delete(active.npc);
  closeInterface(active);
  smoke(active.npc, active.player);
  try { active.definition.onFinish?.(active); }
  catch (error) { console.error("[RandomEvents] event cleanup failed", error); }
  finally { api.removeNpc(active.npc); }
}

/** The event is over but its NPC stays until `removeAt`: it stops following and looks away. */
function retire(active, removeAt) {
  const state = players.get(active.player);
  if (!state) { finish(active); return; }
  if (state.active === active) state.active = null;
  closeInterface(active);
  active.leaving = true;
  active.removeAt = removeAt;
  active.npc.setFollowing(null);
  active.npc.setMobileInteraction(null);
  (state.leaving ??= new Set()).add(active);
}

/** Ends an event its owner dealt with, whatever the outcome: the NPC goes on its 10-tick beat. */
function leave(active) {
  const { definition, npc, startedAt } = active;
  if (definition.witherTicks != null) { wither(active); return true; }
  if (!definition.linger) { finish(active); return true; }
  if (definition.leaveAnimation != null) npc.performAnimation(new api.core.Animation(definition.leaveAnimation));
  const beat = Math.floor(Math.round((Date.now() - startedAt) / TICK_MS) / NAG_INTERVAL_TICKS) + 1;
  retire(active, startedAt + beat * NAG_INTERVAL_MS);
  return true;
}

function wither(active) {
  active.npc.performAnimation(new api.core.Animation(active.definition.witherAnimation));
  retire(active, Date.now() + active.definition.witherTicks * TICK_MS);
}

/** Ignored to the end: the goodbye line, or the plant's wilting, then gone. */
function expire(active, now) {
  if (active.definition.witherTicks != null) { wither(active); return; }
  active.npc.forceChat(active.definition.goodbye);
  retire(active, now + GOODBYE_TICKS * TICK_MS);
}

function processLeaving(state, now) {
  if (!state.leaving) return;
  for (const active of [...state.leaving]) if (now >= active.removeAt) finish(active);
}

function processPlayer({ player }) {
  if (!api) return;
  let state = players.get(player);
  if (!state) {
    login({ player });
    state = players.get(player);
  }
  if (!state) return;
  const now = Date.now();
  Teleports.process(player);
  processLeaving(state, now);
  if (state.active) {
    const active = state.active;
    const { definition } = active;
    if (now >= active.expiresAt && (definition.goodbye != null || definition.witherTicks != null)) {
      expire(active, now);
      return;
    }
    if (!valid(active, player, now)) { finish(active); return; }
    const username = player.getUsername();
    if (!active.greeted) {
      if (now - active.startedAt >= TICK_MS / 2) {
        active.greeted = true;
        speak(active, definition.greet(username, player));
      }
    } else if (definition.nags && now >= active.nextNagAt) {
      speak(active, definition.nags[Math.floor(Math.random() * definition.nags.length)](username, player));
      active.nextNagAt += NAG_INTERVAL_MS;
    } else if (definition.greeting && !definition.nags && now >= active.nextNagAt) {
      active.npc.forceChat(`${definition.greeting} ${username}!`);
      active.nextNagAt += NAG_INTERVAL_MS;
    }
    return;
  }
  if (Teleports.hasSession(player)) return;
  if (!state.pending) {
    if (now < state.checkAt) return;
    state.checkAt = now + CHECK_INTERVAL_MS;
    if (now < state.nextAt) return;
    state.pending = true;
  }
  if (api.getPluginConfig("random-events:enabled", true) === false) return;
  if (disallowedLocation(player)) {
    state.pending = false;
    state.nextAt = nextEventAt(now);
    player.setAttribute(NEXT_EVENT_ATTRIBUTE, state.nextAt);
    return;
  }
  if (!eligible(player)) return;
  const available = events.filter(definition => eventAvailable(definition, player));
  if (!available.length) {
    state.pending = false;
    state.nextAt = nextEventAt(now);
    player.setAttribute(NEXT_EVENT_ATTRIBUTE, state.nextAt);
    return;
  }
  state.pending = false;
  state.nextAt = nextEventAt(now);
  player.setAttribute(NEXT_EVENT_ATTRIBUTE, state.nextAt);
  spawn(player, state, now, available[Math.floor(Math.random() * available.length)]);
}

/** Ends the event and hands over its rewards; what doesn't fit is placed on the ground. */
function serve(active, rewards, exchange = null, options = {}) {
  const player = active.player;
  if (!valid(active, player)) return false;
  const inventory = player.getInventory();
  if (exchange && (inventory.get(exchange.slot) !== exchange.item || exchange.item.getAmount() !== 1)) return false;
  // Void clears state before serving: repeated interactions cannot claim twice.
  leave(active);
  if (exchange) inventory.deleteAtSlot(exchange.slot, 1);
  Rewards.give(api, player, rewards, options);
  return true;
}

function rewardDialogue(active) {
  const { player, npc, definition } = active;
  const line = definition.rewardLine?.(player.getUsername(), player);
  if (line) Flow.chat(api, { player, npcId: npc.getId(), lines: [{ text: line, expression: definition.rewardExpression }] });
}

/** Someone else's event, or the owner's after it finished or in a place it can't stay. */
function refuse(active, player) {
  const { definition, npc, player: owner } = active;
  if (player !== owner) {
    if (definition.otherPlayerMessage) player.sendMessage(definition.otherPlayerMessage);
    else if (definition.otherPlayerStatement) Flow.statement(api, player, definition.otherPlayerStatement);
    else {
      const line = definition.otherPlayerLine?.(owner, player);
      if (line) Flow.chat(api, { player, npcId: npc.getId(), lines: [line] });
    }
    return;
  }
  if (definition.leavingStatement) { Flow.statement(api, player, definition.leavingStatement); return; }
  const line = active.leaving ? definition.leavingLine?.(player) : (definition.zoneLine ?? definition.leavingLine)?.(player);
  if (line) Flow.chat(api, { player, npcId: npc.getId(), lines: [line] });
}

function talk({ player, npc }) {
  const active = eventsByNpc.get(npc);
  if (!active) return false; // Other NPCs with these names retain their own dialogue.
  if (active.leaving || !valid(active, player)) {
    refuse(active, player);
    return true;
  }
  if (active.definition.talk) {
    active.definition.talk(active, { valid, serve, finish, leave, api, teleport: spec => Teleports.begin(active, spec) });
    return true;
  }
  if (active.definition.kind === "certer") { Certer.open(api, active); return true; }
  if (active.definition.kind === "gift") {
    active.gift ??= Gift.roll(api);
    if (!serve(active, [active.gift])) return true;
    rewardDialogue(active);
    return true;
  }
  if (active.definition.kind !== "sandwich") {
    if (serve(active, active.definition.rewards)) rewardDialogue(active);
    return true;
  }
  Flow.chat(api, {
    player, npcId: npc.getId(),
    lines: [{ text: `You look hungry to me. I tell you what -<br>have a ${foods[active.foodIndex][2]} on me.`, expression: 589 }],
    onEnd: () => valid(active, player) && openTray(active),
  });
  return true;
}

function openTray(active) {
  const player = active.player;
  active.trayOpen = true;
  active.interfaceId = TRAY_GROUP;
  // The foods land in a new random order each time the tray opens (1695, 3057, 549, 1839).
  const order = foods.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  active.trayOrder = order;
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval(); // Closes the offer line still in the chatbox.
  sender.sendClientScript(TRAY_MODAL_SCRIPT, -1, -1);
  sender.sendInterface(TRAY_GROUP);
  order.forEach((food, index) => sender.sendInterfaceRawModel((TRAY_GROUP << 16) | (TRAY_FIRST_FOOD + index), foods[food][1]));
  sender.sendString(`Have a ${foods[active.foodIndex][2]} for free!`, TRAY_TITLE);
}

function chooseSandwich(event) {
  const { player, buttonId } = event;
  if ((buttonId >>> 16) !== TRAY_GROUP) return;
  const index = (buttonId & 0xffff) - TRAY_FIRST_FOOD;
  if (index < 0 || index >= foods.length) return;
  event.handled = true;
  const active = players.get(player)?.active;
  if (event.action !== TRAY_SELECT_ACTION || !active?.trayOpen || active.definition.kind !== "sandwich" ||
      player.getInterfaceId() !== TRAY_GROUP || !valid(active, player)) return;
  if (active.trayOrder[index] !== active.foodIndex) {
    leave(active);
    Flow.chat(api, { player, npcId: active.npc.getId(), lines: ["Hey, I didn't say you could have that!"] });
    return;
  }
  let id = foods[active.foodIndex][0];
  if (id === api.core.ItemIdentifiers.BAGUETTE && Math.floor(Math.random() * 64) === 0) id = api.core.ItemIdentifiers.STALE_BAGUETTE;
  if (serve(active, [id])) rewardDialogue(active);
}

function dismiss({ player, npc }) {
  const active = eventsByNpc.get(npc);
  if (!active) return false;
  if (active.leaving) {
    // Told to go while waiting for his beat. A wilting plant is already going at its own pace.
    if (player === active.player && active.definition.witherTicks == null) finish(active);
    return true;
  }
  if (!valid(active, player)) return true;
  if (active.definition.witherTicks != null) wither(active); else finish(active);
  return true;
}

function chooseCerter(event) {
  Certer.choose(api, players.get(event.player)?.active, event, { valid, serve, finish, leave });
}

// Deaths and logins end a stay without moving the player again; logging out moves them
// back to their return tile before the save so nobody is persisted inside an event area.
function cleanup({ player }) {
  const active = players.get(player)?.active;
  if (active) finish(active);
  removeLeaving(player);
  players.delete(player);
  if (Teleports.hasSession(player)) Teleports.departed(player, false);
}

function removeLeaving(player) {
  for (const active of [...(players.get(player)?.leaving ?? [])]) finish(active);
}

function logoutCleanup({ player }) {
  const active = players.get(player)?.active;
  if (active) finish(active);
  removeLeaving(player);
  players.delete(player);
  if (Teleports.hasSession(player)) Teleports.departed(player, true);
}

function shutdown() {
  for (const active of [...eventsByNpc.values()]) finish(active);
  players.clear();
  Teleports.shutdown();
}

function activeFor(player) {
  return players.get(player)?.active ?? null;
}

function advanceTime({ player, ms, handledBy }) {
  const state = players.get(player);
  if (!state) return;
  state.nextAt -= ms;
  state.checkAt -= ms;
  player.setAttribute(NEXT_EVENT_ATTRIBUTE, state.nextAt);
  if (state.active) {
    state.active.startedAt -= ms;
    state.active.expiresAt -= ms;
    state.active.nextNagAt -= ms;
  }
  for (const active of state.leaving ?? []) active.removeAt -= ms;
  handledBy.push("RandomEvents");
}

module.exports = { DEFINITIONS_EVENT, leave, initialize, login, processPlayer, spawnCommand, talk, chooseSandwich, chooseCerter, dismiss, cleanup, logoutCleanup, shutdown, activeFor, finish, serve, valid, advanceTime };
