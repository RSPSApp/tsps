#!/usr/bin/env node
/**
 * Dwarf Cannon: a scripted, unwatched start-to-finish route over the agent MCP.
 *
 * One process plays the whole quest with normal clicks and checks it as it goes. Before each
 * step it asks Quest Helper (the `quest_helper` tool, via the bridge) for the current step; after
 * it, the saved stage and its varp 0 wire value. The model is only needed when an assert fails:
 * fix the cause, then re-run from that step with --from on the same account.
 *
 * Run from server/ (needs the server with AGENT_MCP=1 and the Quest Helper bridge):
 *   NODE_PATH=$PWD/node_modules node ../docs/quests/dwarf-cannon/route.cjs \
 *     --mcp http://127.0.0.1:<AGENT_MCP_PORT>/mcp --player <fresh account> [--from <step>] [--to <step>] \
 *     [--checkpoint <file>] [--out report.json]
 * with ROUTE_PASSWORD set in the environment (see below).
 *
 * Setup (declared, before the baseline): ::master, ::maxgear melee, ::tele to Captain Lawgof.
 * After the baseline: no commands, `travel_to` and the quest's own ladders/caves only.
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
  "setup", "baseline", "1 start: talk to Captain Lawgof", "2 repair the six railings", "3 report the railings to Lawgof",
  "4 take the remains from the watchtower", "5 return the remains to Lawgof", "6 find Lollk in the goblin cave",
  "7 leave the cave by the mud pile", "8 return to Lawgof for the toolkit", "9 repair the multicannon",
  "10 report the repair to Lawgof", "11 get the notes and ammo mould from Nulodion", "12 complete: return to Lawgof",
  "13 rewards", "14 repeat talk: no second reward", "15 relog keeps the completion",
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
const QUEST = "dwarf_cannon";
// Step 12 saves the pre-completion observation here, so a resume at "13 rewards" measures the
// reward against it. Per account; it holds an observation only, no password.
const CHECKPOINT = String(args.checkpoint ?? join(tmpdir(), `dwarf-cannon-route-${String(args.player).toLowerCase()}.json`));
// The test account's password stays out of the repo and the report: pass it in the environment
// so a --from resume can still relog. Without it, a random one serves a single uninterrupted run.
const password = process.env.ROUTE_PASSWORD || randomBytes(9).toString("hex");

// ---------- ids and tiles (cache osrs-241_2026-10-20, see DwarfCannon.Quest.js) ----------
const ITEM = { HAMMER: 2347, RAILING: 14, DWARF_REMAINS: 0, TOOLKIT: 1, NULODIONS_NOTES: 3, AMMO_MOULD: 4 };
const VARP_STAGE = 0;
const VARP_QUEST_POINTS = 101;
// The six damaged railings' cache placements in walking order from Lawgof's camp, each with its
// mcannon_railingN_fixed varbit.
const RAILINGS = [
  { id: 15590, x: 2555, y: 3479, varbit: 2240 }, { id: 15591, x: 2557, y: 3468, varbit: 2241 },
  { id: 15592, x: 2559, y: 3458, varbit: 2242 }, { id: 15593, x: 2563, y: 3457, varbit: 2243 },
  { id: 15594, x: 2573, y: 3457, varbit: 2244 }, { id: 15595, x: 2577, y: 3457, varbit: 2245 },
];
const LAWGOF_TILE = { x: 2567, y: 3458, z: 0 };
const REMAINS = { id: 0, x: 2567, y: 3444, z: 2 };
const CRATE = { id: 1, x: 2571, y: 9850, z: 0 };
const MUDPILE = { id: 13, x: 2621, y: 9796, z: 0 };
const CANNON_ID = 15597;
const CANNON_GROUP = 409;
// IF1 409 components: tool buttons 1 toothed tool, 2 pliers, 3 hook; parts 7 safety, 8 spring, 9 gear.
const CANNON_TOOL = { toothed: 1, pliers: 2, hook: 3 };
const CANNON_PART = { safety: 7, spring: 8, gear: 9 };

// ---------- harness ----------
const report = { quest: QUEST, player, startedAt: new Date().toISOString(), steps: [], transcript: [], findings: [], stages: [] };
let client;
let lastHelper = null;
let reached = !args.from;
let stopped = false;

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
  report.findings.push(text);
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
    if (lastHelper) console.log(`  helper step: ${JSON.stringify(lastHelper.step?.text)} stage ${lastHelper.stage} wire ${JSON.stringify(lastHelper.wire)}`);
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

const observe = (extra = {}) => call("observe", { player, radius: 15, varps: [VARP_STAGE, VARP_QUEST_POINTS], ...extra });
const count = (obs, itemId) => (obs.inventory ?? []).filter((it) => it && it.id === itemId).reduce((sum, it) => sum + (it.amount ?? 1), 0);

/** Ask Quest Helper for the current step; assert its text names what the route does next. */
async function helperSays(...fragments) {
  lastHelper = await call("quest_helper", { player, quest: QUEST });
  const missing = (lastHelper.diagnostics ?? []).find((d) => d.code === "MISSING_STATE");
  if (lastHelper.helperStatus === "unavailable" && missing) {
    // Headless request filling answers varbits only; an objectDefinitions request fails once and
    // the next evaluation succeeds. Recorded as a shared helper-integration finding, retried once.
    finding(`quest_helper unavailable once (${missing.method}: ${missing.message}); retried`);
    lastHelper = await call("quest_helper", { player, quest: QUEST });
  }
  if (lastHelper.helperStatus !== "active" && lastHelper.helperStatus !== "complete") {
    fail(`quest helper is ${lastHelper.helperStatus}`, { diagnostics: lastHelper.diagnostics });
  }
  if (lastHelper.contract && lastHelper.contract.agrees === false) fail("cache completion contract disagrees", lastHelper.contract);
  // A sub-step (one railing's ObjectStep) can have no text of its own: its panel step has it.
  const panelStep = (lastHelper.section?.steps ?? []).find((s) => s.current);
  const text = [...(lastHelper.step?.text ?? []), ...(panelStep?.text ?? [])].join(" ").trim();
  for (const fragment of fragments) {
    if (!text.toLowerCase().includes(fragment.toLowerCase())) fail(`helper step is "${text}", expected it to mention "${fragment}"`);
  }
  for (const target of lastHelper.targets ?? []) {
    if (target.cache === "missing") finding(`helper target missing from cache: ${JSON.stringify(target)}`);
  }
  return lastHelper;
}

/** Assert the saved stage and the varp 0 wire value. */
async function expectStage(stage, wire = stage) {
  const h = await call("quest_helper", { player, quest: QUEST });
  lastHelper = h;
  const obs = await observe({ radius: 1 });
  const wireNow = obs.varpValues?.[VARP_STAGE];
  report.stages.push({ stage: h.stage, wire: wireNow });
  if (h.stage !== stage || wireNow !== wire) fail(`stage ${h.stage} / varp 0 = ${wireNow}, expected ${stage} / ${wire}`);
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
 * Play the open dialogue to its end. Options are answered from `picks` (substring, in order), or
 * else from the helper's dialogueChoices for the current step; anything else is a failure.
 */
async function playDialogue(picks = []) {
  const queue = [...picks];
  let waits = 0;
  for (let page = 0; page < 120; page += 1) {
    const d = await call("dialogue", { player }, { allowError: true });
    if (!d || d.error || !d.kind || d.kind === "none") return;
    if (d.kind === "options") {
      report.transcript.push({ options: d.options });
      const helperChoices = (lastHelper?.step?.dialogueChoices ?? []).map((choice) => choice.text);
      const wanted = queue.length ? queue[0] : null;
      const match = wanted
        ? d.options.find((option) => option.toLowerCase().includes(wanted.toLowerCase()))
        : d.options.find((option) => helperChoices.some((choice) => option.toLowerCase().includes(choice.toLowerCase())));
      if (!match) fail(`no option for ${wanted ? `"${wanted}"` : `helper choices ${JSON.stringify(helperChoices)}`}`, { options: d.options });
      if (wanted) queue.shift();
      report.transcript.push({ chose: match });
      await call("dialogue_choose", { player, option: match });
      continue;
    }
    if (d.kind === "other") {
      // An internal action waiting for its scheduled callback: let it run, never click through it.
      if (++waits > 10) fail("dialogue stuck on an internal action", d);
      await call("wait_ticks", { player, ticks: 1 });
      continue;
    }
    report.transcript.push({ speaker: d.speaker, text: d.text });
    await call("dialogue_continue", { player });
  }
  fail("dialogue did not end after 120 pages");
}

/** Wait (bounded) until a dialogue is open: a scripted search or pick-up opens it a few ticks later. */
async function waitForDialogue(what, maxTicks = 10) {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const waited = await call("wait_ticks", { player, ticks: 1 });
    if (waited.open === "dialogue") return;
  }
  fail(`no dialogue opened for ${what} within ${maxTicks} ticks`);
}

async function talkTo(npc, picks = []) {
  const result = await call("interact", { player, target: npc, option: "Talk-to" });
  if (result.result !== "dialogue") await waitForDialogue(`Talk-to ${npc}`);
  await playDialogue(picks);
}

/** travel_to until arrival; a blocked leg or a note is recorded, and two failures in a row stop. */
async function travel(to, { exact = false } = {}) {
  let failures = 0;
  for (let leg = 0; leg < 30; leg += 1) {
    const r = await call("travel_to", { player, x: to.x, y: to.y, z: to.z ?? 0, exact, run: true, budgetTicks: 300 });
    for (const l of r.legs ?? []) if (l.note) finding(`travel_to note near (${r.x}, ${r.y}, ${r.z}): ${l.note}`);
    if (r.result === "arrived") return r;
    if (r.result === "in-progress" || r.result === "budget" || r.result === "out-of-budget") { failures = 0; continue; }
    if (r.result === "dialogue" || r.open === "dialogue") { await playDialogue(); continue; }
    finding(`travel_to ${JSON.stringify(to)} returned ${r.result} at (${r.x}, ${r.y}, ${r.z}): ${r.reason ?? ""}`);
    if (++failures >= 2) fail(`travel_to ${JSON.stringify(to)} failed twice: ${r.result}`, r);
  }
  fail(`travel_to ${JSON.stringify(to)} did not arrive in 30 calls`);
}

const button = (child) => call("send_packet", {
  player,
  message: { type: "widget_action", widgetId: (CANNON_GROUP << 16) | child, groupId: CANNON_GROUP, childId: child, buttonNum: 1, simple: true },
});

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
    await call("command", { player, text: "maxgear melee", ticks: 1 });
    await call("command", { player, text: `tele ${LAWGOF_TILE.x} ${LAWGOF_TILE.y} ${LAWGOF_TILE.z}`, ticks: 2 });
  });

  await step("baseline", async () => {
    baseline = await observe();
    report.baseline = {
      tile: [baseline.x, baseline.y, baseline.z], stage: baseline.varpValues[VARP_STAGE], questPoints: baseline.varpValues[VARP_QUEST_POINTS],
      craftingXp: baseline.skills.Crafting.xp, inventory: baseline.inventory, equipment: (baseline.equipment ?? []).map((it) => it?.id),
    };
    if (report.baseline.stage !== 0) fail("baseline stage is not 0");
  });

  await step("1 start: talk to Captain Lawgof", async () => {
    await helperSays("Talk to Captain Lawgof");
    await talkTo("Captain Lawgof", ["Yes."]);
    await expectStage(1);
    const obs = await observe();
    if (count(obs, ITEM.RAILING) < 6 || count(obs, ITEM.HAMMER) < 1) fail("expected 6 railings and a hammer", { inventory: obs.inventory });
  });

  await step("2 repair the six railings", async () => {
    await helperSays("railings");
    const helperTarget = lastHelper.targets.find((t) => t.kind === "object");
    if (!RAILINGS.some((r) => r.id === helperTarget?.ids?.[0] && r.x === helperTarget.x && r.y === helperTarget.y)) {
      fail("the helper's railing is not one of the six placements", { helperTarget });
    }
    for (const railing of RAILINGS) {
      const { varbit } = railing;
      // The repair succeeds at random (50%, unverified); a failure costs a hit and a retry.
      for (let attempt = 1; ; attempt += 1) {
        if (attempt > 12) fail(`railing ${railing.id} not fixed after 12 attempts`);
        await call("object_option", { player, id: railing.id, x: railing.x, y: railing.y, option: "Inspect" });
        const after = await waitFor(`railing ${railing.id} attempt`, (o) => o.varbitValues[varbit] === 1 || (o.messages ?? []).some((m) => /tired|cut yourself|crush|wrench/.test(m)), 40, { varbits: [varbit] });
        if (after.varbitValues[varbit] === 1) break;
      }
      if ((await call("dialogue", { player }, { allowError: true }))?.kind) await playDialogue();
    }
    await expectStage(2);
  });

  await step("3 report the railings to Lawgof", async () => {
    await helperSays("Captain Lawgof");
    await talkTo("Captain Lawgof");
    await expectStage(3);
  });

  await step("4 take the remains from the watchtower", async () => {
    await helperSays("remains");
    // The tile south of the remains is inside the top floor; north of them is outside the tower.
    await travel({ x: REMAINS.x, y: REMAINS.y - 1, z: REMAINS.z });
    await call("object_option", { player, id: REMAINS.id, x: REMAINS.x, y: REMAINS.y, option: "Take" });
    await waitFor("the dwarf remains", (o) => count(o, ITEM.DWARF_REMAINS) === 1, 10);
    await waitForDialogue("taking the remains");
    await playDialogue();
  });

  await step("5 return the remains to Lawgof", async () => {
    await helperSays("Captain Lawgof");
    await travel(LAWGOF_TILE);
    await talkTo("Captain Lawgof");
    await expectStage(4);
    if (count(await observe(), ITEM.DWARF_REMAINS) !== 0) fail("the remains were not handed in");
  });

  await step("6 find Lollk in the goblin cave", async () => {
    await helperSays("goblin cave");
    await travel({ x: CRATE.x, y: CRATE.y + 1, z: CRATE.z });
    await helperSays("crate");
    await call("object_option", { player, id: CRATE.id, x: CRATE.x, y: CRATE.y, option: "Search" });
    await waitForDialogue("the crate containing Lollk");
    await playDialogue();
    await expectStage(5, 6);
  });

  await step("7 leave the cave by the mud pile", async () => {
    await travel({ x: MUDPILE.x, y: MUDPILE.y + 1, z: 0 });
    await call("object_option", { player, id: MUDPILE.id, x: MUDPILE.x, y: MUDPILE.y, option: "Climb-over" });
    await waitFor("the surface by the cave", (o) => o.y < 6400, 10);
  });

  await step("8 return to Lawgof for the toolkit", async () => {
    await helperSays("Captain Lawgof");
    await travel(LAWGOF_TILE);
    await talkTo("Captain Lawgof");
    await expectStage(6, 7);
    if (count(await observe(), ITEM.TOOLKIT) !== 1) fail("no toolkit");
  });

  await step("9 repair the multicannon", async () => {
    await helperSays("toolkit", "multicannon");
    const obs = await observe({ radius: 20 });
    const cannon = obs.objects.find((o) => o.id === CANNON_ID);
    if (!cannon) fail("broken multicannon not found");
    await call("use_item", { player, item: "Toolkit", on: "loc", id: CANNON_ID, x: cannon.x, y: cannon.y });
    const opened = await call("wait_ticks", { player, ticks: 1 });
    if (opened.open !== "interface") fail("the toolkit did not open the cannon interface", opened);
    // Follow the helper's puzzle steps ("Click the pliers and use it on the safety switch...").
    // The Wiki order is the same: pliers on safety, hook on spring, then the toothed tool on the gear.
    const clicks = [
      [/pliers/i, CANNON_TOOL.pliers, CANNON_PART.safety],
      [/hook/i, CANNON_TOOL.hook, CANNON_PART.spring],
      [/toothed/i, CANNON_TOOL.toothed, CANNON_PART.gear],
    ];
    const wikiOrder = clicks.map(([, tool, part]) => [tool, part]);
    report.cannonSteps = [];
    let selected = null;
    for (let click = 0; click < 8; click += 1) {
      const h = await call("quest_helper", { player, quest: QUEST });
      if (h.stage >= 8) break;
      const text = (h.step?.text ?? []).join(" ");
      report.cannonSteps.push(text);
      const match = clicks.find(([pattern]) => pattern.test(text));
      if (!match) {
        finding(`Quest Helper does not see the open cannon interface (step: "${text}"); clicked the Wiki order instead`);
        for (const [tool, part] of wikiOrder) {
          await button(tool);
          await call("wait_ticks", { player, ticks: 1 });
          await button(part);
          await call("wait_ticks", { player, ticks: 1 });
        }
        break;
      }
      const [, tool, part] = match;
      await button(selected === tool ? part : tool);
      selected = selected === tool ? null : tool;
      await call("wait_ticks", { player, ticks: 1 });
    }
    await expectStage(8);
  });

  await step("10 report the repair to Lawgof", async () => {
    await helperSays("Captain Lawgof");
    await talkTo("Captain Lawgof");
    await expectStage(9);
    if (count(await observe(), ITEM.TOOLKIT) !== 0) fail("the toolkit was not returned");
  });

  await step("11 get the notes and ammo mould from Nulodion", async () => {
    await helperSays("Nulodion");
    const target = lastHelper.targets.find((t) => t.kind === "npc");
    await travel({ x: target.x, y: target.y, z: target.plane ?? 0 });
    await talkTo("Nulodion");
    await expectStage(10);
    const obs = await observe();
    if (count(obs, ITEM.NULODIONS_NOTES) !== 1 || count(obs, ITEM.AMMO_MOULD) !== 1) fail("missing the notes or the ammo mould", { inventory: obs.inventory });
  });

  await step("12 complete: return to Lawgof", async () => {
    await helperSays("Captain Lawgof");
    await travel(LAWGOF_TILE);
    report.preCompletion = await observe();
    if (report.preCompletion.varpValues[VARP_STAGE] !== 10) fail("expected stage 10 before the completion talk");
    writeFileSync(CHECKPOINT, JSON.stringify({ player: player.toLowerCase(), preCompletion: report.preCompletion }));
    await talkTo("Captain Lawgof");
    await expectStage(11);
  });

  await step("13 rewards", async () => {
    // A resume here measures against step 12's saved observation, never against the completed state.
    if (!report.preCompletion) {
      const saved = existsSync(CHECKPOINT) ? JSON.parse(readFileSync(CHECKPOINT, "utf8")) : null;
      if (saved?.player !== player.toLowerCase() || saved.preCompletion?.varpValues?.[VARP_STAGE] !== 10) {
        fail(`no pre-completion checkpoint for ${player} at ${CHECKPOINT}: resume from step 12 on an account at stage 10`,
          { resumeFrom: "12 complete: return to Lawgof" });
      }
      report.preCompletion = saved.preCompletion;
      report.preCompletionFrom = "checkpoint";
    }
    const before = report.preCompletion;
    const after = await observe();
    const close = await call("close_interface", { player }, { allowError: true });
    report.rewards = {
      questPoints: after.varpValues[VARP_QUEST_POINTS] - before.varpValues[VARP_QUEST_POINTS],
      craftingXp: after.skills.Crafting.xp - before.skills.Crafting.xp,
      notes: count(after, ITEM.NULODIONS_NOTES), ammoMould: count(after, ITEM.AMMO_MOULD), closed: !close.error,
    };
    const r = report.rewards;
    if (r.questPoints !== 1 || r.craftingXp !== 750 || r.notes !== 0 || r.ammoMould !== 1) fail("rewards are wrong", r);
    const h = await call("quest_helper", { player, quest: QUEST });
    if (!h.complete || h.helperStatus !== "complete") fail(`after completion: complete ${h.complete}, helper ${h.helperStatus}`);
  });

  await step("14 repeat talk: no second reward", async () => {
    const before = await observe();
    await talkTo("Captain Lawgof");
    const after = await observe();
    if (after.varpValues[VARP_QUEST_POINTS] !== before.varpValues[VARP_QUEST_POINTS] || after.skills.Crafting.xp !== before.skills.Crafting.xp) {
      fail("the repeat talk changed QP or XP");
    }
  });

  await step("15 relog keeps the completion", async () => {
    const before = await observe();
    await call("logout", { player });
    await call("login", { username: player, password });
    const after = await observe();
    const same = after.varpValues[VARP_STAGE] === 11 && after.varpValues[VARP_QUEST_POINTS] === before.varpValues[VARP_QUEST_POINTS]
      && after.skills.Crafting.xp === before.skills.Crafting.xp && count(after, ITEM.AMMO_MOULD) === 1;
    if (!same) fail("state changed across the relog", { before: before.varpValues, after: after.varpValues });
    await expectStage(11);
  });
}

(async () => {
  client = new Client({ name: "dwarf-cannon-route", version: "1.0.0" });
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
