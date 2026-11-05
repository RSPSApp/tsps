"use strict";

// Routes the event NPCs' Talk-to to the "2025 Halloween event" transcript
// (event-dialogues.json) and answers its conditions, choices and actions from
// Progress. The words stay in the transcript; only state lives here.
const Progress = require("./Progress.HalloweenEvents");
const Items = require("./Items.HalloweenEvents");
const Rewards = require("./Rewards.HalloweenEvents");
const PAGE = "2025 Halloween event";
const SOURCE = require("../../../data/definitions/event-dialogues.json")[PAGE];
const { STAGE } = Progress;
const NPCS = Object.freeze({
  fred_the_farmer: "fred", favour_seth_groats: "seth", farming_shopkeeper_1: "sarah",
  death_office_death: "death", aprilfoolshorsesalesman: "diango",
});
// Death's quiz: each correct answer sets its own hw25_death_qN_done bit.
const QUIZ_ANSWERS = Object.freeze(["31st of October.", "Pumpkins.", "A coven.", "Dark wizards, south of Varrock.", "Trick or treat."]);
const ENTRY_PROMPT_NO = "No.";
const sessions = new WeakMap();
const passthrough = new WeakSet();
let enabled = false;

function activate(event) { if (event.key === Progress.BUNDLE) enabled = event.active === true; }
function active() { return enabled; }
function clear({ player }) { const session = sessions.get(player); session?.cancel?.(); sessions.delete(player); }
function cancelAll(api) { for (const player of api.core.World.getPlayers()) if (player && sessions.has(player)) clear({ player }); }

/** Text of a transcript message step, so messages sent outside a conversation keep the source wording. */
function messageText(stepId) {
  const visit = steps => {
    for (const step of steps ?? []) {
      if (step.id === stepId && typeof step.text === "string") return step.text;
      const found = visit(step.steps) ?? (step.options ?? []).map(option => visit(option.steps)).find(Boolean);
      if (found) return found;
    }
    return undefined;
  };
  for (const steps of [...Object.values(SOURCE.variants), ...Object.values(SOURCE.branches ?? {})]) {
    const text = visit(steps);
    if (text) return text;
  }
  throw new Error("Missing Halloween transcript message " + stepId);
}

function start(api, { player, npc, event, variant, role }) {
  if (!enabled || !player.isRegistered() || !Array.isArray(SOURCE?.variants[variant])) return false;
  const previous = sessions.get(player);
  const session = { npc, event, variant, role };
  sessions.set(player, session);
  const request = { player, npc, npcId: npc?.getCurrentDefinition(player)?.getId() ?? npc?.getId(), variant: { page: PAGE, variant }, exact: true };
  api.emitCustomEvent("npc-dialogue:start", request);
  if (!request.handled) { if (previous) sessions.set(player, previous); else sessions.delete(player); return false; }
  previous?.cancel?.();
  session.cancel = request.cancel;
  return true;
}

function fredVariant(state) {
  switch (state.stage) {
    case STAGE.NEW: return "starting-off-talking-to-fred-the-farmer";
    case STAGE.STARTED: return "starting-off-talking-to-fred-after-starting-the-event";
    case STAGE.COLLECTING: return Progress.acquiredAll(state)
      ? "returning-to-fred-with-the-decorations-talking-to-fred"
      : "starting-off-talking-to-fred-after-being-suggested-to-visit-seth-groats";
    case STAGE.DECORATED: return "returning-to-fred-with-the-decorations-talking-to-fred-again";
    case STAGE.LANTERN: return state.briefed ? "the-spook-a-thon-contest-talking-to-fred-again-before-finishing-the-cutscene" : "the-spook-a-thon-contest";
    case STAGE.JUDGED: return "the-spook-a-thon-contest-talking-to-fred-after-the-cutscene";
    default: return null;
  }
}
function sethVariant(api, player, state) {
  if (state.stage === STAGE.STARTED && !state.picture) return "starting-off-talking-to-seth-groats";
  const lostPicture = !Progress.owns(api, player, Progress.DECORATIONS.picture);
  if (state.stage === STAGE.COLLECTING && (!Progress.acquiredAll(state) || lostPicture)) return "starting-off-talking-to-seth-again-after-receiving-the-picture-for-the-first-time";
  if (state.stage >= STAGE.COLLECTING && state.stage < STAGE.COMPLETE) return "returning-to-fred-with-the-decorations-talking-to-seth-groats-after-collecting-each-item";
  return null;
}
function sarahVariant(state) {
  if (state.stage < STAGE.STARTED || state.stage >= STAGE.DECORATED) return null;
  if (!state.sarahIntro) return "spooky-scarecrow-talking-to-sarah";
  if (!state.sarahEmote) return "spooky-scarecrow-talking-to-sarah-again";
  if (!state.scarecrow) return "spooky-scarecrow-returning-to-sarah";
  return "spooky-scarecrow-talking-to-sarah-after-receiving-the-scarecrow-for-the-first-time";
}
function deathVariant(state) {
  if (state.stage < STAGE.STARTED || state.stage >= STAGE.DECORATED) return null;
  if (state.lamp) return "spooky-wall-lamp-talking-to-death-again-after-receiving-the-lamp-for-the-first-time";
  return Progress.quizComplete(state) ? "spooky-wall-lamp-talking-to-death-after-finishing-the-quiz" : "spooky-wall-lamp-talking-to-death";
}
function diangoVariant(state) {
  if (state.stage === STAGE.DECORATED) return state.diangoIntro ? "spooky-pumpkin-lantern-talking-to-diango-again" : "spooky-pumpkin-lantern-talking-to-diango";
  if (state.stage === STAGE.LANTERN || state.stage === STAGE.JUDGED) return "spooky-pumpkin-lantern-talking-to-diango-after-getting-the-lantern";
  return null;
}

/** onBeforeNpcInteraction: Talk-to on an event NPC plays its stage's variant. */
function interact(api, event) {
  const { player, npc } = event;
  if (passthrough.delete(player)) return;
  const definition = npc.getCurrentDefinition(player);
  const role = Object.entries(NPCS).find(([symbol]) => api.core.CacheDefinitions.getNpcId(symbol) === definition?.getId())?.[1];
  if (!role) return;
  // Any click on an event NPC replaces its earlier conversation, so that one can
  // no longer claim the ordinary menus that follow (Sarah's menu-less variant).
  sessions.delete(player);
  if (!enabled || definition.getActions()?.[event.clickType - 1]?.toLowerCase() !== "talk-to") return;
  // Death's Domain spawns a Death per player: an actor owned by someone else, or in
  // another instance, is not this player's conversation.
  const owner = npc.getOwner?.() ?? null;
  if ((owner && owner !== player) || (npc.getPrivateArea?.() ?? null) !== (player.getPrivateArea?.() ?? null)) return;
  if (!player.isRegistered() || player.getHitpoints() <= 0 || player.busy()) return;
  const state = Progress.read(player);
  if (role === "fred" && state.stage === STAGE.COMPLETE) {
    if (Rewards.claimTradeables(api, player)) event.handled = true;
    return;
  }
  const variant = role === "fred" ? fredVariant(state) : role === "seth" ? sethVariant(api, player, state)
    : role === "sarah" ? sarahVariant(state) : role === "death" ? deathVariant(state) : diangoVariant(state);
  if (variant && start(api, { player, npc, event, variant, role })) event.handled = true;
}

function session(event) {
  const current = sessions.get(event.player);
  if (!current || !event.pages?.some(row => row.page === PAGE)) return null;
  return current;
}
function freeSlots(player) { return player.getInventory().getFreeSlots(); }

function condition(api, event) {
  const current = session(event);
  if (!current) return undefined;
  const { player } = event, state = Progress.read(player), free = freeSlots(player);
  const others = key => Object.keys(Progress.DECORATIONS).filter(name => name !== key).every(name => state[name]);
  const lost = key => !Progress.owns(api, player, Progress.DECORATIONS[key]);
  const lanternLost = !Progress.owns(api, player, Progress.LANTERN);
  const worn = Items.wornHalloweenItems(api, player) >= 3, wielded = Items.lanternEquipped(api, player);
  const allInInventory = Object.values(Progress.DECORATIONS).every(symbol => Progress.inInventory(api, player, symbol));
  const answers = {
    // Seth
    KObH52: free === 0, "1Glkal": lost("picture"), pMyO2X: others("picture"), UBDVQJ: free === 0,
    Y1Ad4J: !others("picture"), OzXUnh: others("picture"),
    // Death
    OPsJ6E: free === 0, "5ilQgA": others("lamp"), I25KX6: free === 0, QvIFs_: !lost("lamp"),
    Bf5brT: lost("lamp") && free === 0, "i-2ikf": lost("lamp") && free > 0, "Dj6-1i": others("lamp"),
    // Sarah
    IPMBNR: free === 0, nklY0V: others("scarecrow"), lfmJa_: !lost("scarecrow"),
    C2zoGl: lost("scarecrow") && free === 0, UB3nLO: lost("scarecrow") && free > 0, "2zhZMj": others("scarecrow"),
    // Fred's hand-in
    KoXrfh: Progress.acquiredAll(state) && !allInInventory, P2asCD: Progress.acquiredAll(state) && allInInventory,
    // Diango: the source labels both first-visit branches "not wearing"; ids disambiguate.
    "9NWeHn": !worn, _MxZad: worn, "5nwfqm": free === 0, gEabbC: !worn, uDxjdh: worn,
    zjUzkT: !lanternLost, Qs3fH3: lanternLost, QzGoNG: current.fullAtReplacement ?? free === 0,
    // Contest
    "4Sjcyo": !(worn && wielded), H4FTU9: worn && wielded, JO8VAw: !(worn && wielded), Xu40ur: worn && wielded,
    "n77zq-": !Rewards.canClaim(api, player),
  };
  if (Object.hasOwn(answers, event.stepId)) return answers[event.stepId];
  // Every condition on this page is answered above; an unknown one plays nothing.
  return false;
}

function choice(api, event) {
  const current = sessions.get(event.player);
  if (!current || event.npc !== current.npc) return;
  const entry = !current.entered;
  current.entered = true;
  if (entry && event.option === ENTRY_PROMPT_NO && current.event) {
    // Declining the event question hands the click back to the NPC's ordinary owner.
    event.end = true;
    sessions.delete(event.player);
    passthrough.add(event.player);
    api.core.PluginManager.emitNpcInteraction({ ...current.event, handled: false });
    passthrough.delete(event.player);
    return;
  }
  const question = QUIZ_ANSWERS.indexOf(event.option);
  if (current.role === "death" && question >= 0) {
    Progress.update(api, event.player, state => { state.quiz |= 1 << question; return true; });
  }
}

function line(api, event) {
  const current = session(event);
  if (!current) return;
  const text = String(event.text), { player } = event;
  let after;
  if (current.role === "fred" && text.startsWith("Thank you! You might just save my haunted house dreams")) {
    after = () => Progress.update(api, player, state => state.stage === STAGE.NEW && (state.stage = STAGE.STARTED, true));
  }
  if (current.role === "death" && text.startsWith("I'm not ready to die for them")) {
    after = () => Progress.update(api, player, state => !state.deathIntro && (state.deathIntro = true));
  }
  if (current.role === "sarah" && text === "Time to get my groove on.") {
    after = () => Progress.update(api, player, state => !state.sarahIntro && (state.sarahIntro = true));
  }
  if (current.role === "fred" && current.variant === "the-spook-a-thon-contest" && text.startsWith("And you'd best put on")) {
    after = () => Progress.update(api, player, state => state.stage === STAGE.LANTERN && !state.briefed && (state.briefed = true));
  }
  const actors = current.cutscene?.actorsFor(event.step);
  if (actors) event.actors = actors;
  if (after) event.after = after;
}

/** Gives one restored/live item; false (and the transcript ends) when it no longer fits. */
function give(api, player, symbol) {
  const id = Progress.itemId(api, symbol), item = new api.core.Item(id, 1);
  if (id === null || player.getInventory().getAddableAmount(item) !== 1) return false;
  player.getInventory().add(item);
  return true;
}

const RECEIVE = Object.freeze({
  hNcnnY: { symbol: Progress.DECORATIONS.picture, apply: s => (s.stage === STAGE.STARTED && (s.stage = STAGE.COLLECTING), s.picture = true, true) },
  Nkt5y6: { symbol: Progress.DECORATIONS.picture, apply: s => (s.picture = true) },
  iOb9RN: { symbol: Progress.DECORATIONS.lamp, apply: s => (s.lamp = true) },
  W4jzNZ: { symbol: Progress.DECORATIONS.lamp, apply: s => (s.lamp = true) },
  iZ7VCc: { symbol: Progress.DECORATIONS.scarecrow, apply: s => (s.scarecrow = true) },
  io1jlJ: { symbol: Progress.DECORATIONS.scarecrow, apply: s => (s.scarecrow = true) },
  BSrsl1: { symbol: Progress.LANTERN, apply: s => (s.stage === STAGE.DECORATED && (s.stage = STAGE.LANTERN), true) },
  Yvadoz: { symbol: Progress.LANTERN, apply: () => true },
});

function action(api, event) {
  const current = session(event);
  if (!current) return;
  const { player } = event;
  const stop = () => { event.handled = true; event.end = true; };
  const receive = RECEIVE[event.stepId];
  if (receive) {
    // Diango's replacement runs before his no-space line: remember the space it saw.
    if (event.stepId === "Yvadoz") current.fullAtReplacement = freeSlots(player) === 0;
    if (event.stepId === "Yvadoz" && current.fullAtReplacement) { event.handled = true; return; }
    if (!give(api, player, receive.symbol)) return stop();
    Progress.update(api, player, receive.apply);
    event.handled = true;
    return;
  }
  switch (event.stepId) {
    case "taze9d": // Fred takes all four decorations
      if (!Items.handOver(api, player)) return stop();
      event.handled = true;
      return;
    case "fj07Tj": // Diango unlocks every previous Halloween reward
      Rewards.unlockPrevious(api, player);
      Progress.update(api, player, state => !state.diangoIntro && (state.diangoIntro = true));
      event.handled = true;
      return;
    case "L9reaW": case "1_q8rU":
      // The chat's own close removes interfaces: open the retrieval list after it.
      afterChat(api, player, () => api.emitCustomEvent("holiday-rewards:open", { player }));
      return stop();
    case "5shIok": { // A cutscene begins
      const request = { player, session: current };
      api.emitCustomEvent("halloween-2025:cutscene-start", request);
      if (!request.handled) return stop();
      event.handled = true;
      return;
    }
    case "LRWlwH": // The cutscene ends
      api.emitCustomEvent("halloween-2025:cutscene-end", { player });
      Progress.update(api, player, state => state.stage === STAGE.LANTERN && (state.stage = STAGE.JUDGED, true));
      event.handled = true;
      return;
    case "eC17__": { // Event complete
      const rewards = Rewards.claim(api, player);
      if (!rewards) return stop();
      afterChat(api, player, () => Rewards.show(api, player, rewards));
      event.handled = true;
      return;
    }
    case "sIAJwR":
      Rewards.refuse(api, player);
      event.handled = true;
      return;
    default:
  }
}

/** Runs once this conversation has closed (its last step removes open interfaces). */
function afterChat(api, player, run) {
  const { Task, TaskManager } = api.core;
  let waited = 0;
  TaskManager.submit(new (class AfterHalloweenChat extends Task {
    constructor() { super(1, player, false); }
    execute() {
      if (!player.isRegistered()) return this.stop();
      if (player.getDialogueManager().getCurrent()) {
        // Another conversation took over: do not open on top of it.
        if (++waited >= 10) this.stop();
        return;
      }
      this.stop();
      run();
    }
  })());
}

module.exports = { activate, active, clear, cancelAll, interact, condition, choice, line, action, messageText, start };
