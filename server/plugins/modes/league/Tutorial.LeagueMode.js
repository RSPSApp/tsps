/**
 * The league tutorial a new league character goes through (data/league-tutorial.json): the cache's
 * tutorial pages (league_tutorial_main, 677, over league_tutorial, 653) step a new player through
 * the Leagues Menu, the task list, the area map and the relics, as the two recorded runs show it
 * (osrs-captures 227/00196 Raging Echoes, 237/01098 Demonic Pacts). The server only moves
 * league_tutorial_completed and opens the screens; the client draws every page from the league
 * struct's tutorial struct. The task list, the area map and the relic screen belong to their own
 * plugins: the tutorial watches them open ("interface:opened") and runs its walkthrough in them
 * (ScreenHighlight). It can always be finished: a section whose screen never opens is skipped, a
 * relic or area chosen before its page counts, and a page or screen closed mid-way comes back.
 *
 *   api.emitCustomEvent("league:tutorial-stage", { player })  -> stage (league_tutorial_completed)
 */
const Common = require("./Common.LeagueMode");
const data = require("../data/league-tutorial.json");
const { FLAG_OP1 } = require("../../interface/widgetGroup");

/**
 * The tutorial's stage (league_tutorial_completed). No starting value is declared on purpose: a
 * character that joined before the tutorial existed has none and counts as finished, and a new
 * one gets 0 when it joins (`league:joined`).
 */
const STAGE_ATTRIBUTE = "league:tutorial-stage";
const OVERLAY = 1;
const SECTIONS = ["tasks", "areas", "relics", "pacts"];

function uid([group, child]) {
  return (group << 16) | child;
}

const PAGE_BUTTONS = [uid([data.screens.main, data.screens.primaryButton]), uid([data.screens.main, data.screens.secondaryButton])];
const SECTION_BUTTONS = SECTIONS.map((section) => uid(data.sections[section].button));
/** The journal's side stone on each gameframe layout (toplevel 161, 164, 548). */
const JOURNAL_STONES = Object.entries(data.journal.stones).map(([root, child]) => uid([Number(root), child]));
const WELCOME_PLAY = uid(data.welcomePlay);

/** Per player: the screens wait for the welcome screen or the character design to close. */
const awaitingOpen = new WeakSet();
/** Players whose welcome screen is up. */
const welcomeShown = new WeakSet();
/** Per player: the section whose button was clicked, waiting for its screen. */
const pendingSection = new WeakMap();
/** Per player: where a section's screen was mounted, to close it after its walkthrough. */
const sectionTarget = new WeakMap();
/** Per player: the sections whose walkthrough was seen this session (a reopened screen skips it). */
const walkthroughSeen = new WeakMap();

function flowOf(type) {
  const row = data.leagues[type];
  return row ? data.flows[row.flow] : null;
}

/** The player's stage, or null when they have finished (or never had a tutorial). */
function activeStage(player) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = player.getAttribute(STAGE_ATTRIBUTE);
  if (!flow || !Number.isInteger(stage) || stage >= flow.final) return null;
  return stage;
}

function pageOf(flow, stage) {
  return flow.stages[String(stage)] ?? null;
}

/** The page a stage belongs to: a walkthrough stage (the page's + 1) resumes at its page. */
function resumeStage(flow, stage) {
  return pageOf(flow, stage) ? stage : stage - 1;
}

/** The page a stage is on or after: its walkthrough stage counts as its page. */
function sectionAt(flow, stage) {
  return pageOf(flow, resumeStage(flow, stage));
}

/** The page after a stage: the next stage the flow lists. */
function nextPage(flow, stage) {
  return Object.keys(flow.stages).map(Number).filter((page) => page > stage).sort((a, b) => a - b)[0] ?? flow.final - 1;
}

/** league_tutorial (653) with its click blocker and the chat overlay, as captured before every page. */
function showOverlay(player) {
  const { screens, varbits } = data;
  const sender = player.getPacketSender();
  sender.sendVarbit(varbits.allowMesOverlap, 1);
  sender.sendSubInterface(uid(screens.overlay.target), screens.overlay.group, OVERLAY);
  sender.sendInterfaceDisplayState(uid([screens.overlay.group, screens.overlay.noclick]), false);
  sender.sendSubInterface(uid(screens.mesoverlay.target), screens.mesoverlay.group, OVERLAY);
  sender.sendInterfaceScript(screens.mesoverlayScript, [""]);
}

function closeScreens(player) {
  const { screens, varbits } = data;
  const sender = player.getPacketSender();
  if (sender.isSubInterfaceOpen(screens.main)) sender.closeSubInterface(uid(screens.mainModal));
  sender.sendInterfaceDisplayState(uid([screens.overlay.group, screens.overlay.noclick]), true);
  sender.closeSubInterface(uid(screens.mesoverlay.target));
  sender.closeSubInterface(uid(screens.overlay.target));
  sender.sendVarbit(varbits.allowMesOverlap, 0);
}

/** Moves to `stage` and, on a page, shows it: the overlay, the page's own cue, the modal. */
function present(player, stage) {
  const flow = flowOf(Common.leagueOf(player));
  if (!flow) return;
  const { varbits, screens, journal, sections, pulse } = data;
  const sender = player.getPacketSender();
  player.setAttribute(STAGE_ATTRIBUTE, stage);
  sender.sendVarbit(varbits.stage, stage);
  const page = pageOf(flow, stage);
  if (!page) return;
  // As captured: the page closes and opens again, so the client draws the new stage's text.
  if (sender.isSubInterfaceOpen(screens.main)) sender.closeSubInterface(uid(screens.mainModal));
  showOverlay(player);
  if (page === "journal") {
    sender.sendVarbit(varbits.flashSide, data.flashJournal);
    for (const stone of JOURNAL_STONES) sender.sendInterfaceFlagsRange(stone, -1, -1, FLAG_OP1);
  } else if (page === "leagues-tab") {
    sender.sendInterfaceScript(journal.flashTabScript[0], [uid(journal.flashTabScript[1])]);
  } else if (sections[page]) {
    sender.sendInterfaceScript(pulse.start, [uid(sections[page].highlight)]);
  }
  sender.sendInterfaceScript(screens.modalSizeScript[0], screens.modalSizeScript[1]);
  sender.sendInterface(screens.main);
}

/**
 * The task catalog (LeagueTasks' `league:complete-task`) pays the task: its points, its list bit
 * and its message. With no catalog on the server nobody answers, and the points go straight to
 * LeaguePoints; a catalog that answers `found: false` (a league without the task) pays nothing.
 */
function award(player, task) {
  const request = { player, id: task.id, found: undefined, completed: false };
  Common.api.emitCustomEvent("league:complete-task", request);
  if (request.found !== undefined) return;
  Common.api.emitCustomEvent("league:award-task", { player, id: task.id, points: task.points, name: task.name });
}

/** A league that borrows another's walkthrough text gets its own name in it. */
function renamed(type, steps) {
  const rename = data.leagues[type]?.rename;
  if (!rename) return steps;
  return steps.map((step) => ({ ...step, text: { ...step.text, text: renameText(step.text.text, rename) } }));
}

function renameText(text, rename) {
  return Object.keys(rename).sort((a, b) => b.length - a.length).reduce((out, from) => out.split(from).join(rename[from]), text);
}

/** Whether what the section waits for is already done: an area beyond the starting ones, a relic, a pact. */
function alreadyDone(player, section) {
  if (section === "pacts") {
    const query = { player, pacts: [] };
    Common.api.emitCustomEvent("league:pacts", query);
    return (query.pacts ?? []).length > 0;
  }
  if (section === "relics") {
    const query = { player, league: null, chosen: {} };
    Common.api.emitCustomEvent("league:relics", query);
    return Object.keys(query.chosen ?? {}).length > 0;
  }
  if (section === "areas") return (player.getPacketSender().getVarbit?.(data.sections.areas.unlockedVarbit) | 0) > 0;
  return false;
}

/** A section's screen opened on its page (or its walkthrough stage): the walkthrough runs in it. */
function startWalkthrough(player, section, opened) {
  const type = Common.leagueOf(player);
  const flow = flowOf(type);
  const page = resumeStage(flow, player.getAttribute(STAGE_ATTRIBUTE));
  const steps = flow.walkthroughs[section];
  const { sections, pulse, screens } = data;
  pendingSection.delete(player);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(pulse.stop, [uid(sections[section].highlight)]);
  if (sender.isSubInterfaceOpen(screens.main) && opened.targetUid !== uid(screens.mainModal)) sender.closeSubInterface(uid(screens.mainModal));
  if (!steps) {
    skip(player, section);
    return;
  }
  sectionTarget.set(player, opened.targetUid);
  player.setAttribute(STAGE_ATTRIBUTE, page + 1);
  sender.sendVarbit(data.varbits.stage, page + 1);
  if (walkthroughSeen.get(player)?.has(section)) {
    // Seen this session: the screen is reopened to unlock something, not to be shown it again.
    walkthroughFinished({ player, key: `league-tutorial:${section}` });
    return;
  }
  const colour = Number(Common.core.CacheDefinitions.getStructParams(Common.league(type).struct)?.get(data.colourParam)) || Common.league(type).colour;
  Common.api.emitCustomEvent("screen-highlight:show", {
    player, key: `league-tutorial:${section}`, host: uid(sections[section].host), hint: sections[section].hint, colour, steps: renamed(type, steps),
  });
}

/** Its screen never opened (or it has no walkthrough): the tutorial moves on without it. */
function skip(player, section) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (!flow || stage === null || sectionAt(flow, stage) !== section) return;
  pendingSection.delete(player);
  present(player, nextPage(flow, resumeStage(flow, stage)));
}

function closeSectionScreen(player) {
  const target = sectionTarget.get(player);
  sectionTarget.delete(player);
  if (target !== undefined && target !== uid(data.screens.mainModal)) player.getPacketSender().closeSubInterface(target);
}

/** The section's walkthrough is over: on to the next page, unless it waits for an unlock still to come. */
function walkthroughFinished({ player, key }) {
  if (key === PACTS_AFTER_KEY) {
    pactsAfterFinished(player);
    return;
  }
  const section = /^league-tutorial:(\w+)$/.exec(String(key ?? ""))?.[1];
  const flow = player ? flowOf(Common.leagueOf(player)) : null;
  const stage = flow ? activeStage(player) : null;
  if (!section || stage === null || sectionAt(flow, stage) !== section) return;
  if (!walkthroughSeen.has(player)) walkthroughSeen.set(player, new Set());
  walkthroughSeen.get(player).add(section);
  const waits = section === "relics" || section === "pacts" || (section === "areas" && flow.areasNeedUnlock);
  if (waits && !alreadyDone(player, section)) return; // the unlock moves it on
  if (section === "pacts" && flow.walkthroughs.pactsAfter) {
    // The central pact was bought before this page: its last steps follow at once.
    showPactsAfter(player, Common.leagueOf(player));
    return;
  }
  if (section !== "relics") closeSectionScreen(player);
  sectionTarget.delete(player);
  present(player, nextPage(flow, resumeStage(flow, stage)));
}

/** The section a side panel button opens, by the button's uid. */
function sectionOfButton(buttonId) {
  return SECTIONS.find((section) => uid(data.sections[section].button) === buttonId) ?? null;
}

/** A section's button on its page: its screen should open; the section is skipped if it does not. */
function sectionClicked({ player, buttonId }) {
  const section = sectionOfButton(buttonId);
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (!section || !flow || stage === null || sectionAt(flow, stage) !== section) return false;
  pendingSection.set(player, section);
  Common.later(player, data.sections.waitTicks, () => {
    if (pendingSection.get(player) === section) skip(player, section);
  });
  // Not handled: the section's own plugin opens its screen.
  return false;
}

/** A group was mounted: the journal's Leagues tab, or a section's screen. Runs once its owner has finished opening it. */
function interfaceOpened(event) {
  const player = event?.player;
  if (!player || activeStage(player) === null) return;
  queueMicrotask(() => reactToOpen(player, event));
}

function reactToOpen(player, { groupId, targetUid }) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (stage === null) return;
  const page = pageOf(flow, stage);
  if ((page === "journal" || page === "leagues-tab") && groupId === data.journal.sidePanel) {
    award(player, data.tasks.openMenu);
    player.getPacketSender().sendVarbit(data.varbits.flashSide, 0);
    const leaguesTab = page === "journal" ? nextPage(flow, stage) : stage;
    present(player, nextPage(flow, leaguesTab));
    return;
  }
  const section = sectionAt(flow, stage);
  if (section === "pacts" && awaitingPactsAfter.has(player) && groupId === data.sections.pacts.interface) {
    sectionTarget.set(player, targetUid);
    showPactsAfter(player, Common.leagueOf(player));
    return;
  }
  if (SECTIONS.includes(section) && groupId === data.sections[section].interface) startWalkthrough(player, section, { groupId, targetUid });
}

function journalStone({ player }) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (!flow || stage === null || pageOf(flow, stage) !== "journal") return false;
  player.getPacketSender().sendVarbit(data.varbits.flashSide, 0);
  present(player, nextPage(flow, stage));
  // The client still opens the journal itself.
  return false;
}

/** The tutorial page's buttons: Get Started (button_2), Exit Leagues / End Tutorial (button_1). */
function pageButton({ player, buttonId }) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (!flow || stage === null) return false;
  const { screens } = data;
  const page = pageOf(flow, stage);
  const primary = buttonId === uid([screens.main, screens.primaryButton]);
  if (page === "start" && !primary) {
    player.getPacketSender().sendVarbit(data.varbits.seenCutscene, 1);
    present(player, nextPage(flow, stage));
    return true;
  }
  if (page === "start" && primary) {
    // "Exit Leagues": leave the league world (ours; never pressed in a recording).
    closeScreens(player);
    player.requestLogout();
    return true;
  }
  if (page === "finish" && primary) {
    finish(player, flow);
    return true;
  }
  return false;
}

function finish(player, flow) {
  player.setAttribute(STAGE_ATTRIBUTE, flow.final);
  const sender = player.getPacketSender();
  sender.sendVarbit(data.varbits.stage, flow.final);
  sender.sendVarbit(data.varbits.orbsDisabled, 0);
  award(player, data.tasks.complete);
  closeScreens(player);
}

function areaUnlocked({ player }) {
  const flow = player ? flowOf(Common.leagueOf(player)) : null;
  const stage = flow ? activeStage(player) : null;
  // Before the areas page it is simply counted when that page's walkthrough ends.
  if (stage === null || sectionAt(flow, stage) !== "areas" || pageOf(flow, stage)) return;
  closeSectionScreen(player);
  present(player, nextPage(flow, resumeStage(flow, stage)));
}

/**
 * Demonic Pacts: buying the central pact closes the tree, which comes back five ticks later; the
 * walkthrough's last steps (`pactsAfter`) run in it then, and the next page follows them
 * (237/01098).
 */
const PACTS_AFTER_KEY = "league-tutorial:pacts-after";
const awaitingPactsAfter = new WeakSet();

function pactUnlocked({ player }) {
  const flow = player ? flowOf(Common.leagueOf(player)) : null;
  const stage = flow ? activeStage(player) : null;
  if (stage === null || sectionAt(flow, stage) !== "pacts") return;
  Common.api.emitCustomEvent("screen-highlight:close", { player });
  if (!flow.walkthroughs.pactsAfter) {
    sectionTarget.delete(player);
    present(player, nextPage(flow, resumeStage(flow, stage)));
    return;
  }
  awaitingPactsAfter.add(player);
}

function showPactsAfter(player, type) {
  awaitingPactsAfter.delete(player);
  const colour = Number(Common.core.CacheDefinitions.getStructParams(Common.league(type).struct)?.get(data.colourParam)) || Common.league(type).colour;
  Common.api.emitCustomEvent("screen-highlight:show", {
    player, key: PACTS_AFTER_KEY, host: uid(data.sections.pacts.host), hint: data.sections.pacts.hint, colour,
    steps: renamed(type, flowOf(type).walkthroughs.pactsAfter),
  });
}

function pactsAfterFinished(player) {
  const flow = player ? flowOf(Common.leagueOf(player)) : null;
  const stage = flow ? activeStage(player) : null;
  if (stage === null || sectionAt(flow, stage) !== "pacts") return;
  closeSectionScreen(player);
  present(player, nextPage(flow, resumeStage(flow, stage)));
}

function relicUnlocked({ player }) {
  const flow = player ? flowOf(Common.leagueOf(player)) : null;
  const stage = flow ? activeStage(player) : null;
  if (stage === null || sectionAt(flow, stage) !== "relics") return;
  Common.api.emitCustomEvent("screen-highlight:close", { player });
  sectionTarget.delete(player);
  present(player, nextPage(flow, resumeStage(flow, stage)));
}

/** A new league character starts the tutorial, when its league has one. */
function joined({ player, league }) {
  if (flowOf(league)) player.setAttribute(STAGE_ATTRIBUTE, 0);
}

/**
 * `league:tutorial-stage` { player } -> stage: where a tutorial in progress resumes; the league's
 * finished value (12, Leagues VI's 14) once it is over or for a character from before it.
 */
function answerStage(query) {
  const flow = query?.player ? flowOf(Common.leagueOf(query.player)) : null;
  if (!flow) return;
  const stage = activeStage(query.player);
  query.stage = stage === null ? flow.final : resumeStage(flow, stage);
}

/** Opens the current page once nothing else is up (the welcome screen, the character design). */
function openWhenReady(player) {
  if (!awaitingOpen.has(player) || welcomeShown.has(player) || player.getInterfaceId?.() > 0) return;
  awaitingOpen.delete(player);
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (stage !== null) present(player, resumeStage(flow, stage));
}

function login({ player }) {
  const flow = flowOf(Common.leagueOf(player));
  const stage = activeStage(player);
  if (stage === null) return;
  player.getPacketSender().sendVarbit(data.varbits.orbsDisabled, 1);
  player.setAttribute(STAGE_ATTRIBUTE, resumeStage(flow, stage));
  awaitingOpen.add(player);
  Common.later(player, 2, () => openWhenReady(player));
}

function welcomeScreenShown({ player }) {
  if (player) welcomeShown.add(player);
}

function welcomePlay({ player }) {
  welcomeShown.delete(player);
  Common.later(player, 1, () => openWhenReady(player));
  return false;
}

/**
 * The page or a section's screen closed. Waiting to open: try again. Otherwise, a tick later, if
 * nothing has replaced it (a section's screen opening is the next step), the page comes back, so
 * a closed page or a walkthrough left half way never strands the player under the click blocker.
 */
function interfaceClosed({ player, interfaceId }) {
  if (!player) return;
  if (awaitingOpen.has(player)) {
    Common.later(player, 1, () => openWhenReady(player));
    return;
  }
  const stage = activeStage(player);
  const watched = interfaceId === data.screens.main || SECTIONS.some((section) => data.sections[section].interface === interfaceId);
  if (stage === null || !watched) return;
  Common.later(player, 1, () => {
    const flow = flowOf(Common.leagueOf(player));
    const now = activeStage(player);
    if (now === null || now !== stage || player.getInterfaceId?.() > 0 || player.getPacketSender().isSubInterfaceOpen(data.screens.main)) return;
    Common.api.emitCustomEvent("screen-highlight:close", { player });
    sectionTarget.delete(player);
    present(player, resumeStage(flow, now));
  });
}

function logout({ player }) {
  awaitingOpen.delete(player);
  welcomeShown.delete(player);
  pendingSection.delete(player);
  sectionTarget.delete(player);
  walkthroughSeen.delete(player);
  awaitingPactsAfter.delete(player);
}

/** Leagues II and IV borrow Leagues V's tutorial struct (747), whose pages name Leagues V: copies with their own name. */
function content(query) {
  const rename = data.leagues[query?.league]?.rename;
  if (!rename) return;
  const { CacheDefinitions } = Common.core;
  const { structParam, titleParam, bodyParam, virtualIdOffsets } = data.pages;
  const leagueStruct = Common.league(query.league).struct;
  const tutorialStruct = CacheDefinitions.getStructParams(leagueStruct)?.get(structParam);
  if (!Number.isInteger(tutorialStruct)) return;
  const source = CacheDefinitions.getStructParams(tutorialStruct);
  const struct = query.base + virtualIdOffsets.struct;
  const titles = query.base + virtualIdOffsets.titles;
  const bodies = query.base + virtualIdOffsets.bodies;
  const copy = (enumId) => [...CacheDefinitions.getEnumValues(enumId).entries()].sort(([a], [b]) => a - b).map(([key, text]) => [key, renameText(String(text), rename)]);
  const titleRows = copy(source.get(titleParam));
  query.structs.push({ structId: leagueStruct, params: { [structParam]: struct } });
  query.structs.push({ structId: struct, params: { ...Object.fromEntries(source), [titleParam]: titles, [bodyParam]: bodies } });
  query.enums.push({ enumId: titles, valueType: "s", defaultValue: titleRows[0]?.[1] ?? "", entries: titleRows });
  query.enums.push({ enumId: bodies, valueType: "s", defaultValue: "", entries: copy(source.get(bodyParam)) });
}

module.exports = function attach(api) {
  api.persistAttribute(STAGE_ATTRIBUTE);
  api.onCustomEvent("league:joined", joined);
  api.onCustomEvent("league:tutorial-stage", answerStage);
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("league:content-rows", content);
  api.onCustomEvent("league:area-unlocked", areaUnlocked);
  api.onCustomEvent("league:relic-unlocked", relicUnlocked);
  api.onCustomEvent("league:pact-unlocked", pactUnlocked);
  api.onCustomEvent("interface:opened", interfaceOpened);
  api.onCustomEvent("interface:closed", interfaceClosed);
  api.onCustomEvent("screen-highlight:finished", walkthroughFinished);
  api.onCustomEvent("welcome-screen:shown", welcomeScreenShown);
  api.onPlayerLogout(logout);
  api.onInterfaceActionButton(WELCOME_PLAY, welcomePlay);
  api.onInterfaceActionButton(JOURNAL_STONES, journalStone);
  api.onInterfaceActionButton(PAGE_BUTTONS, pageButton);
  api.onInterfaceActionButton(SECTION_BUTTONS, sectionClicked);
};

module.exports.STAGE_ATTRIBUTE = STAGE_ATTRIBUTE;
module.exports.data = data;
