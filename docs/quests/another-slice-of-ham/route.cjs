#!/usr/bin/env node
/**
 * Another Slice of H.A.M.: a scripted, unwatched start-to-finish route over the agent MCP.
 *
 * One process plays the whole quest with normal clicks and checks it as it goes. Before each
 * step it asks Quest Helper (the `quest_helper` tool, via the bridge) for the current step; after
 * it, the saved stage and its varp 997 wire value. The model is only needed when an assert fails:
 * fix the cause, then re-run from that step with --from on the same account.
 *
 * Run from server/ (needs the server with AGENT_MCP=1 and the Quest Helper bridge):
 *   NODE_PATH=$PWD/node_modules node ../docs/quests/another-slice-of-ham/route.cjs \
 *     --mcp http://127.0.0.1:<AGENT_MCP_PORT>/mcp --player <fresh account> [--from <step>] [--to <step>] \
 *     [--checkpoint <file>] [--out report.json]
 * with ROUTE_PASSWORD set in the environment (see below).
 *
 * Setup (declared, before the baseline): ::master, ::maxgear ranged (the two tower snipers are
 * killed with ranged: crates seal the mage off from melee), a rope, a lit bullseye
 * lantern, a tinderbox, two super attack potions, ::tele to Ur-tag. The account has the three
 * prerequisite quests at their completion values (Death to the Dorgeshuun 14, The Giant Dwarf 50,
 * The Dig Site 9); that patch happens outside this script, before it starts. After the baseline
 * there are no commands: `travel_to`, the quest's own doorways/ladders/caves and real items only.
 */
"use strict";
const { randomBytes } = require("node:crypto");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

// ---------- arguments ----------
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]);
  return pairs;
}, []));
if (!args.mcp || !args.player) {
  console.error("Usage: route.cjs --mcp http://127.0.0.1:<port>/mcp --player <name> [--from <step>] [--to <step>] [--checkpoint <file>] [--out <file>]");
  process.exit(2);
}
// Every step, in order. --from and --to must name one; step() refuses a name not listed here.
const STEPS = [
  "setup", "baseline", "1 start: talk to Ur-tag", "2 enter the railway station",
  "3 Tegdak gives the trowel and brush", "4 dig the six artefacts", "5 clean the six artefacts",
  "6 hand in the six artefacts", "7 Zanik and the wall exit", "8 the goblin scribe",
  "9 Oldak and the village sphere", "10 the generals and the two snipers",
  "11 report the snipers to the generals", "12 the sergeants in Lumbridge Swamp",
  "13 enter the H.A.M. tunnel", "14 hide, lure the guard and descend",
  "15 Sigmund: the ancient mace special", "16 complete: leave the railway",
  "17 rewards", "18 repeat talk: no second reward", "19 relog keeps the completion",
];
for (const option of ["from", "to"]) {
  if (args[option] !== undefined && !STEPS.includes(args[option])) {
    console.error(`--${option} "${args[option]}" is not a step. Steps:\n  ${STEPS.join("\n  ")}`);
    process.exit(2);
  }
}
if (args.from && args.to && STEPS.indexOf(args.to) < STEPS.indexOf(args.from)) {
  console.error(`--to "${args.to}" comes before --from "${args.from}"`);
  process.exit(2);
}
const player = String(args.player);
const QUEST = "another_slice_of_ham";
// Step 15 saves the pre-completion observation here, so a resume at "17 rewards" measures the
// reward against it. Per account; it holds an observation only, no password.
const CHECKPOINT = String(args.checkpoint ?? join(tmpdir(), `another-slice-of-ham-route-${String(args.player).toLowerCase()}.json`));
// The test account's password stays out of the repo and the report: pass it in the environment
// so a --from resume can still relog. Without it, a random one serves a single uninterrupted run.
const password = process.env.ROUTE_PASSWORD || randomBytes(9).toString("hex");

// ---------- ids and tiles (cache osrs-241_2026-10-20, see AnotherSliceOfHAM.Quest.js) ----------
const ITEM = {
  ROPE: 954, LANTERN: 4550, TINDERBOX: 590, TROWEL: 676, BRUSH: 670,
  SUPER_ATTACK: 2436, ANCIENT_MACE: 11061,
};
// The six dig spots in slice_artifact_1..6 order, with the artefact each one yields.
const DIG_SPOTS = [
  { objectId: 23290, x: 2513, y: 5563, varbit: 3551, dirty: 11049, clean: 11048 },
  { objectId: 23293, x: 2511, y: 5561, varbit: 3552, dirty: 11055, clean: 11054 },
  { objectId: 23296, x: 2513, y: 5550, varbit: 3553, dirty: 11053, clean: 11052 },
  { objectId: 23534, x: 2511, y: 5547, varbit: 3554, dirty: 11057, clean: 11056 },
  { objectId: 23301, x: 2512, y: 5544, varbit: 3555, dirty: 11051, clean: 11050 },
  { objectId: 23304, x: 2513, y: 5539, varbit: 3556, dirty: 11059, clean: 11058 },
];
const VARBIT_STAGE = 3550;
// Varp 997 carries stage varbit 3550 in bits 0-10 plus the six dig/clean varbits above it, so
// the saved stage is the low 11 bits, never the whole varp.
const STAGE_MASK = (1 << 11) - 1;
const stageOf = (obs) => (obs.varpValues?.[VARP_STAGE] ?? 0) & STAGE_MASK;
const VARBIT_ARTEFACTS = [3551, 3552, 3553, 3554, 3555, 3556];
const VARBIT_ZANIK_AT_DIG = 3557;
const VARBIT_HIDING = 3558;
const VARBIT_RECEIVED_MACE = 3564;
const VARP_STAGE = 997;
const VARP_QUEST_POINTS = 101;
const VARP_SPECIAL = 300;
const WIDGET_SPECIAL = { groupId: 593, childId: 57 };
const SIGMUND_ID = 5142;
const GUARD_NPC_ID = 5141;

const TILE = {
  UR_TAG: { x: 2731, y: 5364, z: 1 },
  CITY_DOORWAY: { x: 2696, y: 5278, z: 1 }, // object 23052 sits at 2695,5277,1
  TEGDAK: { x: 2512, y: 5565, z: 0 },
  SAMPLE_TABLE: { x: 2512, y: 5554, z: 0 }, // object 23527 sits at 2511,5553
  ZANIK: { x: 2512, y: 5565, z: 0 },
  WALL: { x: 2520, y: 5606, z: 0 }, // object 23285 sits at 2521,5607
  SCRIBE: { x: 2717, y: 5368, z: 1 },
  OLDAK: { x: 2703, y: 5366, z: 0 },
  GENERALS: { x: 2956, y: 3511, z: 0 },
  TOWER_LADDER: { x: 2442, y: 5417, z: 0 },
  BENTNOZE: { x: 2445, y: 5425, z: 0 },
  SERGEANT: { x: 3170, y: 3171, z: 0 },
  SWAMP_HOLE: { x: 3168, y: 3173, z: 0 }, // object 5947 sits at 3169,3172
  CAVE_ZONE: { x: 3171, y: 9568, z: 0 },
  HIDING_CRATE: { x: 2407, y: 5538, z: 0 }, // object 23283 sits at 2408,5538
  LURE: { x: 2412, y: 5537, z: 0 },
  TUNNEL_LADDER: { x: 2412, y: 5527, z: 0 }, // object 23376 sits at 2413,5526
  RAILWAY_LADDER: { x: 2543, y: 5510, z: 0 }, // object 23504 sits at 2544,5509
  STATION_LANDING: { x: 2513, y: 5556, z: 0 },
};
const VILLAGE_LANDING = { x: 2955, y: 3507, z: 0 };
const INSTANCE_LANDING = { x: 2445, y: 5425, z: 0 };
const TOWER_LANDING = { x: 2443, y: 5417, z: 2 };
const TUNNEL_LANDING = { x: 2396, y: 5553, z: 0 };
// The H.A.M. tunnel the cave zone teleports to, and the railway room the tunnel ladder drops to.
const tunnelAt = (o) => o.z === 0 && o.x >= 2393 && o.x <= 2414 && o.y >= 5525 && o.y <= 5560;
const RAILWAY_LANDING = { x: 2538, y: 5515, z: 0 };
// The station landing captured from OSRS (on a finished account) is 2488,5536: the train platform,
// with no walkable link to the dig tunnel. During the quest the doorway uses the dig floor instead.
const STATION_CAPTURE_STUB = { x: 2488, y: 5536, z: 0 };

// ---------- harness ----------
const report = {
  quest: QUEST, player, startedAt: new Date().toISOString(), steps: [], transcript: [], findings: [],
  stages: [], helper: [], digSpots: [], handIns: [],
};
let client;
let lastHelper = null;
let reached = !args.from;
let stopped = false;
let missingStateRecorded = false;

async function call(name, input = {}, { allowError = false } = {}) {
  const result = await client.callTool({ name, arguments: input }, undefined, { timeout: 600_000 });
  const text = result.content?.[0]?.text ?? "";
  if (result.isError) {
    if (allowError) return { error: text };
    throw new Error(`${name} ${JSON.stringify(input)} -> ${text}`);
  }
  try { return JSON.parse(text); } catch { return { text }; }
}

function fail(message, context = {}) {
  const error = new Error(message);
  error.context = context;
  throw error;
}

function finding(text) {
  if (!report.findings.includes(text)) report.findings.push(text);
  console.log(`  ! ${text}`);
}

async function step(name, body) {
  if (!STEPS.includes(name)) throw new Error(`step "${name}" is not listed in STEPS`);
  if (stopped) return;
  if (!reached) {
    if (name !== args.from) { console.log(`- ${name} (skipped, before --from)`); return; }
    reached = true;
  }
  const started = Date.now();
  process.stdout.write(`- ${name} ... `);
  try {
    await body();
  } catch (error) {
    report.steps.push({ name, ok: false, ms: Date.now() - started, error: error.message });
    console.log(`FAIL (${((Date.now() - started) / 1000).toFixed(1)}s)\n  ${error.message}`);
    if (error.context && Object.keys(error.context).length) console.log(`  context: ${JSON.stringify(error.context).slice(0, 4000)}`);
    if (lastHelper) console.log(`  helper step: ${JSON.stringify(lastHelper.step?.text)} stage ${lastHelper.stage} wire ${JSON.stringify(lastHelper.wire?.value)}`);
    console.log(`  resume: --from "${error.context?.resumeFrom ?? name}"`);
    throw error;
  }
  report.steps.push({ name, ok: true, ms: Date.now() - started });
  console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (args.to && name === args.to) {
    stopped = true;
    console.log(`- stopping after "${name}" (--to)`);
  }
}

const observe = (extra = {}) => call("observe", {
  player, radius: 15, varps: [VARP_STAGE, VARP_QUEST_POINTS], varbits: [VARBIT_STAGE, ...VARBIT_ARTEFACTS, VARBIT_ZANIK_AT_DIG, VARBIT_HIDING, VARBIT_RECEIVED_MACE], ...extra,
});
const count = (obs, itemId) => (obs.inventory ?? []).filter((it) => it && it.id === itemId).reduce((sum, it) => sum + (it.amount ?? 1), 0);
const slotOf = (obs, itemId) => (obs.inventory ?? []).find((it) => it && it.id === itemId)?.slot;
const equipped = (obs, itemId) => (obs.equipment ?? []).some((it) => it && it.id === itemId);

/**
 * Ask Quest Helper for the current step; assert its text names what the route does next.
 *
 * The bridge can answer "unavailable" once while it fills a headless objectDefinitions request;
 * a retry succeeds (Dwarf Cannon's route retries exactly once). At the dig it also returns a
 * persistent MISSING_STATE diagnostic while the snapshot still carries a usable stage, so a
 * missing diagnostic is recorded once and the stage assertion is left to expectStage.
 */
async function helperSays(...fragments) {
  lastHelper = await call("quest_helper", { player, quest: QUEST });
  const missing = (lastHelper.diagnostics ?? []).find((d) => d.code === "MISSING_STATE");
  if (missing && !missingStateRecorded) {
    missingStateRecorded = true;
    finding(`Quest Helper reports MISSING_STATE (${missing.method}: ${missing.message}); helper text is checked when the bridge can fill the snapshot`);
  }
  if (lastHelper.helperStatus === "unavailable" && missing) {
    finding(`quest_helper unavailable once (${missing.method}: ${missing.message}); retried`);
    lastHelper = await call("quest_helper", { player, quest: QUEST });
  }
  report.helper.push({
    stage: lastHelper.stage, status: lastHelper.helperStatus,
    text: lastHelper.step?.text ?? null, targets: lastHelper.targets ?? [],
    diagnostics: lastHelper.diagnostics ?? [],
  });
  if (lastHelper.helperStatus !== "active" && lastHelper.helperStatus !== "complete" && lastHelper.helperStatus !== "unavailable") {
    fail(`quest helper is ${lastHelper.helperStatus}`, { diagnostics: lastHelper.diagnostics });
  }
  if (lastHelper.contract && lastHelper.contract.agrees === false) fail("cache completion contract disagrees", lastHelper.contract);
  const text = helperText(lastHelper);
  if (!text) {
    if (!(lastHelper.targets ?? []).length) finding(`quest helper step ${JSON.stringify(lastHelper.step?.id ?? null)} has neither text nor a target`);
    report.helperWithoutText = (report.helperWithoutText ?? 0) + 1;
  } else {
    for (const fragment of fragments) {
      if (!text.toLowerCase().includes(fragment.toLowerCase())) fail(`helper step is "${text}", expected it to mention "${fragment}"`);
    }
  }
  for (const target of lastHelper.targets ?? []) {
    if (target.cache === "missing") finding(`helper target missing from cache: ${JSON.stringify(target)}`);
  }
  return lastHelper;
}

/** The text of the helper's current sub-step, falling back to its panel step. */
function helperText(h) {
  // A sub-step (one dig, one clean) can have no text of its own: its panel step has it.
  const panelStep = (h.section?.steps ?? []).find((s) => s.current);
  return [...(h.step?.text ?? []), ...(panelStep?.text ?? [])].join(" ").trim();
}

/** Assert the helper step mentions at least one of the fragments (a step spans several sub-steps). */
async function helperSaysAny(...fragments) {
  await helperSays();
  const text = helperText(lastHelper);
  if (text && !fragments.some((fragment) => text.toLowerCase().includes(fragment.toLowerCase()))) {
    fail(`helper step is "${text}", expected it to mention one of ${JSON.stringify(fragments)}`);
  }
  return lastHelper;
}

/**
 * Some Quest Helper conditionals require Zanik as a follower NPC, which this server does not
 * have (Zanik "following" is varbit 3557). Their text then falls back to the railway entrance
 * even though the stage is right, so the route asserts the stage and its own transcript instead.
 */
async function helperStageOnly(stage, why) {
  finding(why);
  const h = await helperSays();
  if (h.stage !== stage) fail(`quest helper stage ${h.stage}, expected ${stage}`);
  return h;
}

/** Assert the saved stage and the varp 997 wire value (and varbit 3550, its bits 0-10). */
async function expectStage(stage) {
  const h = await call("quest_helper", { player, quest: QUEST });
  lastHelper = h;
  const obs = await observe({ radius: 1 });
  const wireNow = obs.varpValues?.[VARP_STAGE];
  const varbitNow = obs.varbitValues?.[VARBIT_STAGE];
  report.stages.push({ stage: h.stage, wire: wireNow, wireStage: wireNow & STAGE_MASK, varbit: varbitNow });
  if (h.stage !== stage || (wireNow & STAGE_MASK) !== stage || varbitNow !== stage) {
    fail(`stage ${h.stage} / varp 997 = ${wireNow} (stage bits ${wireNow & STAGE_MASK}) / varbit 3550 = ${varbitNow}, expected ${stage}`);
  }
}

/** Wait (bounded) for a condition on a fresh observation. */
async function waitFor(what, predicate, maxTicks = 20, extra = {}) {
  // Game messages are returned once per call, so keep every call's messages for the predicate.
  const messages = [];
  for (let tick = 0; tick <= maxTicks; tick += 1) {
    const obs = await observe(extra);
    messages.push(...(obs.messages ?? []));
    obs.messages = messages;
    if (predicate(obs)) return obs;
    const waited = await call("wait_ticks", { player, ticks: 1 });
    messages.push(...(waited.messages ?? []));
  }
  fail(`timed out after ${maxTicks} ticks waiting for ${what}`);
}

/**
 * Play the open dialogue to its end. Options are answered from `picks` (substring, in order).
 * An unexpected options page picks the helper's matching choice, then the first option, and is
 * recorded: the transcripts in this quest only offer a choice at the start, Zanik and the
 * generals, all of which are passed explicitly.
 */
async function playDialogue(picks = []) {
  const queue = [...picks];
  let waits = 0;
  for (let page = 0; page < 200; page += 1) {
    const d = await call("dialogue", { player }, { allowError: true });
    if (!d || d.error || !d.kind || d.kind === "none") return;
    if (d.kind === "options") {
      report.transcript.push({ options: d.options });
      const helperChoices = (lastHelper?.step?.dialogueChoices ?? []).map((choice) => choice.text);
      const wanted = queue.length ? queue[0] : null;
      const match = wanted
        ? d.options.find((option) => option.toLowerCase().includes(wanted.toLowerCase()))
        : d.options.find((option) => helperChoices.some((choice) => option.toLowerCase().includes(choice.toLowerCase()))) ?? d.options[0];
      if (!match) fail(`no option for ${wanted ? `"${wanted}"` : "the helper choice"}`, { options: d.options });
      if (!wanted) console.log(`\n  note: unexpected dialogue options ${JSON.stringify(d.options)}; chose "${match}"`);
      if (wanted) queue.shift();
      report.transcript.push({ chose: match });
      await call("dialogue_choose", { player, option: match });
      continue;
    }
    if (d.kind === "other") {
      // An internal action waiting for its scheduled callback: let it run, never click through it.
      if (++waits > 40) fail("dialogue stuck on an internal action", d);
      await call("wait_ticks", { player, ticks: 1 });
      continue;
    }
    report.transcript.push({ speaker: d.speaker, text: d.text });
    await call("dialogue_continue", { player });
  }
  fail("dialogue did not end after 200 pages");
}

/** Wait (bounded) until a dialogue is open: a scripted search or dig opens it a few ticks later. */
async function waitForDialogue(what, maxTicks = 12) {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const waited = await call("wait_ticks", { player, ticks: 1 });
    if (waited.open === "dialogue") return;
  }
  fail(`no dialogue opened for ${what} within ${maxTicks} ticks`);
}

async function drainDialogue() {
  const d = await call("dialogue", { player }, { allowError: true });
  if (d && !d.error && d.kind && d.kind !== "none") await playDialogue();
}

async function talkTo(npc, picks = []) {
  const result = await call("interact", { player, target: npc, option: "Talk-to" });
  if (result.result !== "dialogue" && result.open !== "dialogue") await waitForDialogue(`Talk-to ${npc}`);
  await playDialogue(picks);
}

/** travel_to until arrival; a blocked leg or a note is recorded, and two failures in a row stop. */
async function travel(to, { exact = false, tolerateNoRoute = false } = {}) {
  let failures = 0;
  for (let leg = 0; leg < 40; leg += 1) {
    const r = await call("travel_to", { player, x: to.x, y: to.y, z: to.z ?? 0, exact, run: true, budgetTicks: 300 });
    for (const l of r.legs ?? []) if (l.note) finding(`travel_to note near (${r.x}, ${r.y}, ${r.z}): ${l.note}`);
    if (r.result === "arrived") return r;
    if (r.result === "in-progress" || r.result === "budget" || r.result === "out-of-budget") { failures = 0; continue; }
    if (r.result === "dialogue" || r.open === "dialogue") { await playDialogue(); continue; }
    // A zone handler can move the player mid-leg (the swamp hole teleports to the tunnel),
    // which leaves travel_to with no route from the new position. The caller re-checks.
    if (r.result === "no-route" && tolerateNoRoute) return r;
    finding(`travel_to ${JSON.stringify(to)} returned ${r.result} at (${r.x}, ${r.y}, ${r.z}): ${r.reason ?? ""}`);
    if (++failures >= 2) fail(`travel_to ${JSON.stringify(to)} failed twice: ${r.result}`, r);
  }
  fail(`travel_to ${JSON.stringify(to)} did not arrive in 40 calls`);
}

async function objectOption(id, x, y, option) {
  return call("object_option", { player, id, x, y, option });
}

async function useItemOnItem(item, slot, id, x, y) {
  return call("use_item", { player, item, slot, on: "loc", id, x, y });
}

const specialButton = () => call("send_packet", {
  player,
  message: {
    type: "widget_action",
    widgetId: (WIDGET_SPECIAL.groupId << 16) | WIDGET_SPECIAL.childId,
    groupId: WIDGET_SPECIAL.groupId,
    childId: WIDGET_SPECIAL.childId,
    buttonNum: 1, simple: true,
  },
});

async function specialEnergy() {
  const obs = await observe({ radius: 1, varps: [VARP_SPECIAL] });
  return obs.varpValues?.[VARP_SPECIAL];
}

async function waitForSpecialEnergy(maxTicks = 520) {
  for (let ticks = 0; ticks < maxTicks; ticks += 10) {
    if ((await specialEnergy()) >= 1000) return;
    await call("wait_ticks", { player, ticks: 10 });
  }
  fail(`special energy did not return to 100% within ${maxTicks} ticks`);
}

// ---------- the route ----------
async function route() {
  let baseline;

  await step("setup", async () => {
    const online = await call("list_players");
    const names = (online.players ?? online).map((p) => (p.username ?? p.name ?? p).toString().toLowerCase());
    if (!names.includes(player.toLowerCase())) {
      await call("login", { username: player, password });
    }
    const h = await call("quest_helper", { player, quest: QUEST });
    if (h.stage !== 0) fail(`account already has stage ${h.stage}; use a fresh account or --from`);
    await call("command", { player, text: "master", ticks: 1 });
    await call("command", { player, text: "maxgear ranged", ticks: 1 });
    await call("command", { player, text: `item ${ITEM.ROPE}`, ticks: 1 });
    await call("command", { player, text: `item ${ITEM.LANTERN}`, ticks: 1 });
    await call("command", { player, text: `item ${ITEM.TINDERBOX}`, ticks: 1 });
    await call("command", { player, text: `item ${ITEM.SUPER_ATTACK} 2`, ticks: 1 });
    await call("command", { player, text: `tele ${TILE.UR_TAG.x} ${TILE.UR_TAG.y} ${TILE.UR_TAG.z}`, ticks: 2 });
  });

  await step("baseline", async () => {
    baseline = await observe();
    report.baseline = {
      tile: [baseline.x, baseline.y, baseline.z], stage: stageOf(baseline),
      questPoints: baseline.varpValues[VARP_QUEST_POINTS], miningXp: baseline.skills.Mining.xp, prayerXp: baseline.skills.Prayer.xp,
      inventory: baseline.inventory, equipment: (baseline.equipment ?? []).map((it) => it?.id),
    };
    if (report.baseline.stage !== 0) fail("baseline stage is not 0");
    if (count(baseline, ITEM.ROPE) !== 1 || count(baseline, ITEM.TROWEL) !== 0) fail("baseline items are wrong", report.baseline);
  });

  await step("1 start: talk to Ur-tag", async () => {
    await helperSays("Ur-tag");
    await travel(TILE.UR_TAG);
    await talkTo("Ur-tag", ["What are you arguing about", "Yes"]);
    await expectStage(1);
  });

  await step("2 enter the railway station", async () => {
    await helperSays("railway entrance");
    await travel(TILE.CITY_DOORWAY);
    await objectOption(23052, 2695, 5277, "Enter");
    await waitFor("the station landing", (o) => o.x >= 2500 && o.x <= 2530 && o.y >= 5540 && o.y <= 5570 && o.z === 0, 10);
    // The captured landing (2488,5536) is the post-quest train platform; the quest doorway
    // intercepts stage 1-10 players and uses the dig floor.
    finding(`captured station landing ${JSON.stringify(STATION_CAPTURE_STUB)} is the post-quest platform, cut off from the dig tunnel; the quest doorway lands at ${JSON.stringify(TILE.STATION_LANDING)}`);
    await expectStage(1);
  });

  await step("3 Tegdak gives the trowel and brush", async () => {
    await helperSays();
    await travel(TILE.TEGDAK);
    await talkTo("Tegdak");
    await expectStage(2);
    const obs = await observe();
    if (count(obs, ITEM.TROWEL) !== 1 || count(obs, ITEM.BRUSH) !== 1) fail("no trowel or specimen brush", { inventory: obs.inventory });
  });

  await step("4 dig the six artefacts", async () => {
    await helperSays("artefacts");
    for (const spot of DIG_SPOTS) {
      await travel({ x: spot.x, y: spot.y, z: 0 }, { exact: true });
      await useItemOnItem("Trowel", slotOf(await observe(), ITEM.TROWEL), spot.objectId, spot.x, spot.y);
      const after = await waitFor(`spot ${spot.objectId}`, (o) => o.varbitValues[spot.varbit] === 1 && count(o, spot.dirty) === 1, 20);
      report.digSpots.push({ objectId: spot.objectId, varbit: spot.varbit, dirty: count(after, spot.dirty) });
      await drainDialogue();
    }
    const obs = await observe();
    for (const spot of DIG_SPOTS) if (obs.varbitValues[spot.varbit] !== 1) fail(`spot ${spot.objectId} varbit is ${obs.varbitValues[spot.varbit]}`);
    const dirty = DIG_SPOTS.reduce((sum, spot) => sum + count(obs, spot.dirty), 0);
    if (dirty !== 6) fail(`expected six dirty artefacts, found ${dirty}`, { inventory: obs.inventory });
    await expectStage(2);
  });

  await step("5 clean the six artefacts", async () => {
    await helperSays("clean");
    await travel(TILE.SAMPLE_TABLE);
    for (let index = 0; index < DIG_SPOTS.length; index += 1) {
      let obs = await observe();
      const spot = DIG_SPOTS.find((entry) => count(obs, entry.dirty) > 0);
      if (!spot) fail(`no dirty artefact left at clean ${index + 1}`, { inventory: obs.inventory });
      await useItemOnItem("Artefact", slotOf(obs, spot.dirty), 23527, 2511, 5553);
      await waitFor(`clean ${spot.objectId}`, (o) => count(o, spot.dirty) === 0 && count(o, spot.clean) === 1, 20);
      await drainDialogue();
    }
    const obs = await observe();
    const clean = DIG_SPOTS.reduce((sum, spot) => sum + count(obs, spot.clean), 0);
    const dirty = DIG_SPOTS.reduce((sum, spot) => sum + count(obs, spot.dirty), 0);
    if (clean !== 6 || dirty !== 0) fail(`expected six clean artefacts and no dirty ones, found ${clean}/${dirty}`, { inventory: obs.inventory });
    await expectStage(2);
  });

  await step("6 hand in the six artefacts", async () => {
    await helperSays("Tegdak");
    for (let index = 1; index <= DIG_SPOTS.length; index += 1) {
      await travel(TILE.TEGDAK);
      await talkTo("Tegdak");
      const obs = await observe();
      const delivered = VARBIT_ARTEFACTS.filter((varbit) => obs.varbitValues[varbit] === 2).length;
      report.handIns.push({ handIn: index, delivered, stage: stageOf(obs) });
      if (delivered !== index) fail(`after hand-in ${index}: ${delivered} varbits at 2`, { varbits: obs.varbitValues });
    }
    await expectStage(3);
    const obs = await observe();
    if (obs.varbitValues[VARBIT_ZANIK_AT_DIG] !== 1) fail(`Zanik is not at the dig (varbit 3557 = ${obs.varbitValues[VARBIT_ZANIK_AT_DIG]})`);
  });

  await step("7 Zanik and the wall exit", async () => {
    await helperSays("Zanik");
    await travel(TILE.ZANIK);
    await talkTo("Zanik", ["Okay"]);
    await expectStage(3);
    await travel(TILE.WALL);
    await objectOption(23285, 2521, 5607, "Enter");
    await waitFor("Dorgesh-Kaan after the wall", (o) => o.x >= 2600 && o.z === 1, 10);
  });

  await step("8 the goblin scribe", async () => {
    await helperStageOnly(3, "Quest Helper cannot see Zanik as a follower (this server tracks varbit 3557), so at stage 3 it falls back to \"Enter the railway entrance\" instead of the scribe; the route talks to the scribe itself");
    await travel(TILE.SCRIBE);
    await talkTo("Goblin scribe");
    await expectStage(4);
  });

  await step("9 Oldak and the village sphere", async () => {
    await helperStageOnly(4, "the same missing follower leaves Quest Helper on \"Enter the railway entrance\" at stage 4 instead of Oldak; the route talks to Oldak itself");
    await travel(TILE.OLDAK);
    await talkTo("Oldak");
    await expectStage(5);
    const obs = await observe();
    if (obs.x < 2940 || obs.x > 2970 || obs.y < 3490 || obs.y > 3520 || obs.z !== 0) {
      fail(`expected the Goblin Village landing ${JSON.stringify(VILLAGE_LANDING)}, at (${obs.x}, ${obs.y}, ${obs.z})`);
    }
  });

  await step("10 the generals and the two snipers", async () => {
    // A --from resume lands after the ambush, already inside the instance at stage 6.
    if (stageOf(await observe()) === 5) {
      await helperSays("General");
      await travel(TILE.GENERALS);
      await talkTo("General Wartface");
      await waitFor("the Goblin Village instance", (o) => o.x >= 2430 && o.x <= 2460 && o.y >= 5409 && o.y <= 5438, 10);
    }
    // The ambush cutscene ends at live stage 6. Quest Helper then says to make for the tower
    // (before the climb) or to kill the two H.A.M. members (on top), depending on the zone.
    await helperSaysAny("Kill", "tower");
    await objectOption(23531, 2442, 5417, "Climb-up");
    await waitFor("the tower top", (o) => o.z === 2, 10);
    for (const [id, x, y, name] of [[5157, 2440, 5418, "H.A.M. Archer"], [5158, 2447, 5418, "H.A.M. Mage"]]) {
      for (let round = 0; round < 80; round += 1) {
        const obs = await observe({ radius: 12 });
        const d = await call("dialogue", { player }, { allowError: true });
        if (d && !d.error && d.kind && d.kind !== "none") { await playDialogue(); continue; }
        const npc = (obs.npcs ?? []).find((n) => n.id === id && n.hitpoints > 0);
        if (!npc) break;
        await call("npc_option", { player, index: npc.index, option: "Attack" });
        await call("wait_ticks", { player, ticks: 3 });
        if (round === 79) fail(`${name} still alive after 80 attack rounds`);
      }
    }
    // The second death is handled on the next game tick, after the last attack observation.
    await waitFor("both snipers dead", (o) => o.varbitValues[VARBIT_STAGE] === 7, 20);
    await expectStage(7);
  });

  await step("11 report the snipers to the generals", async () => {
    await helperSays("General");
    await objectOption(23532, 2442, 5417, "Climb-down");
    await waitFor("the instance landing", (o) => o.z === 0, 10);
    await talkTo("General Bentnoze");
    await expectStage(8);
    const obs = await observe();
    if (count(obs, ITEM.ANCIENT_MACE) !== 1 && !equipped(obs, ITEM.ANCIENT_MACE)) fail("the generals did not give the ancient mace", { inventory: obs.inventory });
    if (obs.varbitValues[VARBIT_RECEIVED_MACE] !== 1) fail(`varbit 3564 = ${obs.varbitValues[VARBIT_RECEIVED_MACE]}, expected 1`);
  });

  await step("12 the sergeants in Lumbridge Swamp", async () => {
    await helperSays("Sergeants");
    await travel(TILE.SERGEANT);
    await talkTo("Sergeant Slimetoes");
    await expectStage(9);
  });

  await step("13 enter the H.A.M. tunnel", async () => {
    await helperSays("Swamp Caves");
    await travel(TILE.SWAMP_HOLE);
    // The quest expects a rope on the hole; using it consumes the rope and writes the cave's
    // roped attribute. Without it the descent has no rope to climb back out on.
    await useItemOnItem("Rope", slotOf(await observe(), ITEM.ROPE), 5947, 3169, 3172);
    await objectOption(5947, 3169, 3172, "Climb-down");
    // The captured hole teleport lands at CAVE_LANDING (3172,9569), inside the quest's cave
    // zone: entering it starts "the-under-underground" and moves the player to the tunnel.
    let arrived = false;
    for (let tick = 0; tick < 12 && !arrived; tick += 1) {
      arrived = tunnelAt(await observe({ radius: 1 }));
      const d = await call("dialogue", { player }, { allowError: true });
      if (d && !d.error && d.kind && d.kind !== "none") await playDialogue();
      if (!arrived) await call("wait_ticks", { player, ticks: 1 });
    }
    if (!arrived) {
      // A different landing would sit outside the zone; walking in starts the same handler.
      await travel(TILE.CAVE_ZONE, { tolerateNoRoute: true });
      for (let tick = 0; tick < 12 && !arrived; tick += 1) {
        arrived = tunnelAt(await observe({ radius: 1 }));
        if (!arrived) await call("wait_ticks", { player, ticks: 1 });
      }
    }
    const open = await call("dialogue", { player }, { allowError: true });
    if (open && !open.error && open.kind && open.kind !== "none") await playDialogue();
    if (!arrived) fail("the cave zone did not move the player into the H.A.M. tunnel");
    await waitFor("the H.A.M. tunnel landing", tunnelAt, 12);
    await expectStage(9);
  });

  await step("14 hide, lure the guard and descend", async () => {
    // One helper step spans hide, wait, lure and descend, and a --from resume lands mid-way.
    await helperSaysAny("crate", "lure", "Climb down", "final fight");
    await travel(TILE.HIDING_CRATE);
    await objectOption(23283, 2408, 5538, "Hide-behind");
    await waitFor("the hiding crate", (o) => o.varbitValues[VARBIT_HIDING] === 1, 10);
    // The patrol checkpoint is a two-tick countdown; wait for it before leaving the crate tile.
    await call("wait_ticks", { player, ticks: 3 });
    await travel(TILE.LURE);
    // Luring is the corridor's zone trigger: the last guard engages the sergeants and the
    // transcript plays as the player walks in (travel answers it). Assert the fight itself,
    // because travel_to may already have consumed the transcript.
    let engaged = false;
    for (let tick = 0; tick < 12 && !engaged; tick += 1) {
      const d = await call("dialogue", { player }, { allowError: true });
      if (d && !d.error && d.kind && d.kind !== "none") { await playDialogue(); continue; }
      const obs = await observe({ radius: 12 });
      engaged = (obs.npcs ?? []).some((n) => n.id === GUARD_NPC_ID
        && Math.abs(n.x - 2412) <= 2 && Math.abs(n.y - 5536) <= 2
        && (n.hitpoints < n.maxHitpoints || (n.interactingIndex ?? -1) >= 0));
      if (!engaged) await call("wait_ticks", { player, ticks: 1 });
    }
    if (!engaged) fail("the guards did not engage the sergeants after the lure");
    await travel(TILE.TUNNEL_LADDER);
    await objectOption(23376, 2413, 5526, "Climb-down");
    await waitFor("the railway landing", (o) => o.x >= 2520 && o.x <= 2560 && o.y >= 5500 && o.y <= 5530, 12);
    await drainDialogue();
    // The descent keeps live stage 9; the ancient mace special starts stage 10.
    await expectStage(9);
  });

  await step("15 Sigmund: the ancient mace special", async () => {
    await helperSays("ancient mace");
    // Save the pre-completion observation here: the completion happens inside Sigmund's death
    // transcript, so there is no later moment before the quest completes to take it.
    report.preCompletion = await observe({ radius: 12 });
    if (stageOf(report.preCompletion) !== 9) fail("expected stage 9 before the fight");
    writeFileSync(CHECKPOINT, JSON.stringify({ player: player.toLowerCase(), preCompletion: report.preCompletion }));

    // The mace must be wielded for its special; the super attack potion lifts the accuracy roll.
    let obs = await observe();
    const maceSlot = slotOf(obs, ITEM.ANCIENT_MACE);
    if (maceSlot === undefined && !equipped(obs, ITEM.ANCIENT_MACE)) fail("no ancient mace to wield", { inventory: obs.inventory });
    if (maceSlot !== undefined) await call("inventory_option", { player, slot: maceSlot, option: "Wield" });
    await call("wait_ticks", { player, ticks: 2 });
    obs = await observe();
    if (!equipped(obs, ITEM.ANCIENT_MACE)) fail("the ancient mace is not equipped", { equipment: obs.equipment });
    const potionSlot = slotOf(obs, ITEM.SUPER_ATTACK);
    if (potionSlot !== undefined) {
      await call("inventory_option", { player, slot: potionSlot, option: "Drink" });
      await call("wait_ticks", { player, ticks: 2 });
    }

    // A special can miss (it drains 100% whether it lands or not). Retry only after the 10% per
    // 50-tick restore returns the bar to 100%; the route has no commands to refill it.
    let favour = false;
    for (let attempt = 1; attempt <= 6 && !favour; attempt += 1) {
      if ((await specialEnergy()) < 1000) await waitForSpecialEnergy();
      await specialButton();
      await call("wait_ticks", { player, ticks: 1 });
      obs = await observe({ radius: 12 });
      const sigmund = (obs.npcs ?? []).find((n) => n.id === SIGMUND_ID);
      if (!sigmund) fail("Sigmund is not in the railway");
      await call("npc_option", { player, index: sigmund.index, option: "Attack" });
      for (let tick = 0; tick < 8; tick += 1) {
        await call("wait_ticks", { player, ticks: 2 });
        const d = await call("dialogue", { player }, { allowError: true });
        if (d && !d.error && d.kind && d.kind !== "none") {
          const joined = JSON.stringify(d);
          if (/overcoming Saradomin|last of my prayer/i.test(joined) || d.kind === "npc") { favour = true; break; }
        }
      }
      if (!favour) finding(`ancient mace special attempt ${attempt} missed; waiting for special energy to restore`);
      if (favour) await drainDialogue();
    }
    if (!favour) fail("the ancient mace special did not land after 6 attempts");
    await expectStage(10);

    // With the prayer stripped, finish him. His death starts the "defeating-sigmund" transcript,
    // which unties Zanik, opens the line and completes the quest.
    for (let round = 0; round < 100; round += 1) {
      const d = await call("dialogue", { player }, { allowError: true });
      if (d && !d.error && d.kind && d.kind !== "none") { await playDialogue(); continue; }
      obs = await observe({ radius: 12 });
      if (stageOf(obs) >= 11) break;
      const sigmund = (obs.npcs ?? []).find((n) => n.id === SIGMUND_ID && n.hitpoints > 0);
      if (!sigmund) {
        await call("wait_ticks", { player, ticks: 3 });
        continue;
      }
      await call("npc_option", { player, index: sigmund.index, option: "Attack" });
      await call("wait_ticks", { player, ticks: 3 });
      if (round === 99) fail("Sigmund still alive after 100 attack rounds");
    }
    await drainDialogue();
    await expectStage(11);
  });

  await step("16 complete: leave the railway", async () => {
    // The completion scroll is a client interface; close it before moving.
    const close = await call("close_interface", { player }, { allowError: true });
    if (close.error) finding(`close_interface after completion: ${String(close.error).slice(0, 200)}`);
    await travel(TILE.RAILWAY_LADDER);
    await objectOption(23504, 2544, 5509, "Climb-up");
    await waitFor("the station landing after the railway", (o) => o.x >= 2500 && o.x <= 2530 && o.y >= 5530 && o.y <= 5570, 12);
    await travel(TILE.WALL);
    await objectOption(23285, 2521, 5607, "Enter");
    await waitFor("Dorgesh-Kaan after the railway", (o) => o.x >= 2600 && o.z === 1, 12);
    await travel(TILE.UR_TAG);
    await expectStage(11);
  });

  await step("17 rewards", async () => {
    // A resume here measures against step 15's saved observation, never against the completed state.
    if (!report.preCompletion) {
      const saved = existsSync(CHECKPOINT) ? JSON.parse(readFileSync(CHECKPOINT, "utf8")) : null;
      if (saved?.player !== player.toLowerCase() || stageOf(saved.preCompletion) !== 9) {
        fail(`no pre-completion checkpoint for ${player} at ${CHECKPOINT}: resume from step 15 on an account at stage 10`,
          { resumeFrom: "15 Sigmund: the ancient mace special" });
      }
      report.preCompletion = saved.preCompletion;
      report.preCompletionFrom = "checkpoint";
    }
    const before = report.preCompletion;
    const after = await observe();
    report.rewards = {
      questPoints: after.varpValues[VARP_QUEST_POINTS] - before.varpValues[VARP_QUEST_POINTS],
      miningXp: after.skills.Mining.xp - before.skills.Mining.xp,
      prayerXp: after.skills.Prayer.xp - before.skills.Prayer.xp,
      mace: count(after, ITEM.ANCIENT_MACE) + (equipped(after, ITEM.ANCIENT_MACE) ? 1 : 0),
    };
    const r = report.rewards;
    if (r.questPoints !== 1 || r.miningXp !== 3000 || r.prayerXp !== 3000 || r.mace !== 1) fail("rewards are wrong", r);
    const h = await call("quest_helper", { player, quest: QUEST });
    if (!h.complete || h.helperStatus !== "complete") fail(`after completion: complete ${h.complete}, helper ${h.helperStatus}`);
  });

  await step("18 repeat talk: no second reward", async () => {
    const before = await observe();
    await travel(TILE.UR_TAG);
    await talkTo("Ur-tag");
    const after = await observe();
    if (after.varpValues[VARP_QUEST_POINTS] !== before.varpValues[VARP_QUEST_POINTS]
      || after.skills.Mining.xp !== before.skills.Mining.xp || after.skills.Prayer.xp !== before.skills.Prayer.xp) {
      fail("the repeat talk changed QP or XP");
    }
    await expectStage(11);
  });

  await step("19 relog keeps the completion", async () => {
    const before = await observe();
    await call("logout", { player });
    await call("login", { username: player, password });
    await call("wait_ticks", { player, ticks: 4 });
    const after = await observe();
    const same = stageOf(after) === 11
      && after.varpValues[VARP_QUEST_POINTS] === before.varpValues[VARP_QUEST_POINTS]
      && after.skills.Mining.xp === before.skills.Mining.xp && after.skills.Prayer.xp === before.skills.Prayer.xp
      && (count(after, ITEM.ANCIENT_MACE) === 1 || equipped(after, ITEM.ANCIENT_MACE));
    if (!same) fail("state changed across the relog", { before: before.varpValues, after: after.varpValues });
    const h = await call("quest_helper", { player, quest: QUEST });
    if (!h.complete || h.stage !== 11) fail(`after relog: helper complete ${h.complete}, stage ${h.stage}`);
  });
}

(async () => {
  client = new Client({ name: "another-slice-of-ham-route", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(String(args.mcp))));
  const started = Date.now();
  let ok = true;
  try {
    await route();
    // Belt and braces: a --from that never ran a step is not a pass.
    if (!reached) throw new Error(`--from "${args.from}" was never reached; no steps ran`);
  } catch (error) {
    ok = false;
    if (!report.steps.some((s) => !s.ok)) console.log(error.message);
  }
  report.ok = ok;
  report.totalMs = Date.now() - started;
  console.log(`\n${ok ? "PASSED" : "FAILED"} in ${(report.totalMs / 1000).toFixed(1)}s; findings: ${report.findings.length}`);
  if (args.out) writeFileSync(String(args.out), JSON.stringify(report, null, 2));
  await client.close();
  process.exit(ok ? 0 : 1);
})();
