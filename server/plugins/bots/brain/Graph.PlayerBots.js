"use strict";

/** Validate a deterministic, single-flow graph before compiling it for a bot.
 * A branch chooses exactly one edge. A loop is allowed but only advances one
 * node per brain update, so it cannot spin indefinitely in one server tick.
 */
function nodeLabel(node) {
  if (node.kind === "if") return "If / else";
  if (node.kind === "switch") return "Switch";
  if (node.kind === "interrupt") return "Event trigger";
  if (node.kind === "disarm") return "Disarm event triggers";
  if (node.kind === "resume") return "Resume routine";
  if (node.kind === "agent") return "AI agent decision";
  if (node.kind === "action") {
    const labels = { walkTo: "Walk to tile", interactObject: "Gather", trainCombat: "Train combat", equipTool: "Equip tool", ensureItem: "Get tinderbox", dropItems: "Drop items", sellItems: "Sell items", lightFire: "Burn logs" };
    return labels[node.action?.type] ?? String(node.action?.type ?? "Action").replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  return node.kind === "start" ? "Start" : "End";
}

function portLabel(port) {
  if (port === "true") return "True";
  if (port === "false") return "False";
  if (port === "default") return "Default";
  if (port === "trigger") return "Trigger";
  if (port === "next") return "Next";
  if (port === "error") return "Error";
  if (port.startsWith("case_")) return `Case ${Number(port.slice(5)) + 1}`;
  if (port.startsWith("choice_")) return `Route ${Number(port.slice(7)) + 1}`;
  return port;
}

function validateGraph(graph) {
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("Graph needs nodes and edges.");
  if (graph.nodes.length < 1 || graph.nodes.length > 100 || graph.edges.length > 200) throw new Error("Graph needs 1–100 nodes and at most 200 connections.");
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) || nodes.has(node.id)) throw new Error("Node IDs must be unique.");
    if (!["start", "action", "if", "switch", "interrupt", "disarm", "resume", "agent", "end"].includes(node.kind)) throw new Error(`Unknown node type: ${node.kind}`);
    if (node.kind === "switch" && (!Array.isArray(node.cases) || node.cases.length < 2 || node.cases.length > 8)) throw new Error(`Switch ${node.id} needs 2–8 cases.`);
    if (node.kind === "interrupt" && (!Number.isInteger(node.priority ?? 0) || (node.priority ?? 0) < 0 || (node.priority ?? 0) > 100)) throw new Error(`Event trigger ${node.id} priority must be 0–100.`);
    if (node.kind === "agent") {
      const labels = Array.isArray(node.choices) ? node.choices.map(choice => choice?.label) : [];
      if (!Array.isArray(node.choices) || labels.length < 2 || labels.length > 8 ||
          labels.some(label => typeof label !== "string" || !label.trim()) ||
          new Set(labels.map(label => label.toLowerCase())).size !== labels.length) {
        throw new Error(`AI agent ${node.id} needs 2–8 routes with unique labels.`);
      }
    }
    nodes.set(node.id, node);
  }
  const starts = graph.nodes.filter(node => node.kind === "start");
  if (starts.length !== 1) throw new Error("A graph needs exactly one start node.");
  const outputs = new Map();
  for (const edge of graph.edges) {
    const from = nodes.get(edge?.from), to = nodes.get(edge?.to);
    if (!from || !to || to.kind === "start") throw new Error("Connection references an invalid node.");
    const allowed = from.kind === "if" ? ["true", "false"] : from.kind === "switch" ? [...(from.cases ?? []).map((_, index) => `case_${index}`), "default"] : from.kind === "interrupt" ? ["next", "trigger"] : from.kind === "agent" ? [...(from.choices ?? []).map((_, index) => `choice_${index}`), "error"] : from.kind === "action" ? ["next", "error"] : from.kind === "end" || from.kind === "resume" ? [] : ["next"];
    if (!allowed.includes(edge.port)) throw new Error(`Invalid output on node ${from.id}.`);
    const key = `${from.id}:${edge.port}`;
    if (outputs.has(key)) throw new Error(`Output ${key} has multiple connections.`);
    outputs.set(key, edge.to);
  }
  for (const node of graph.nodes) {
    const required = node.kind === "if" ? ["true", "false"] : node.kind === "switch" ? [...(node.cases ?? []).map((_, index) => `case_${index}`), "default"] : node.kind === "interrupt" ? ["next", "trigger"] : node.kind === "agent" ? (node.choices ?? []).map((_, index) => `choice_${index}`) : node.kind === "end" || node.kind === "resume" ? [] : ["next"];
    for (const port of required) if (!outputs.has(`${node.id}:${port}`)) throw new Error(`Connect the ${portLabel(port)} output of the ${nodeLabel(node)} block.`);
  }
  const visited = new Set(), pending = [starts[0].id];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const port of ["next", "error", "true", "false", "default", "trigger", ...(nodes.get(id)?.cases ?? []).map((_, index) => `case_${index}`), ...(nodes.get(id)?.choices ?? []).map((_, index) => `choice_${index}`)]) {
      const to = outputs.get(`${id}:${port}`);
      if (to) pending.push(to);
    }
  }
  if (visited.size !== nodes.size) throw new Error("Every node must be reachable from start.");
  return { nodes, outputs, start: starts[0].id };
}

const { playerState } = require("./ActionState.PlayerBots");

/** Compile once, but retain the current node independently for every player. */
function createGraphAction(graph, compileAction, compileCondition, compileAgent = () => null) {
  const { nodes, outputs, start } = validateGraph(graph);
  const compiled = new Map();
  for (const node of nodes.values()) {
    if (node.kind === "action") compiled.set(node.id, compileAction(node.action));
    if (node.kind === "if" || node.kind === "interrupt") compiled.set(node.id, compileCondition(node.condition));
    if (node.kind === "switch") compiled.set(node.id, node.cases.map(spec => compileCondition(spec)));
    if (node.kind === "agent") compiled.set(node.id, compileAgent(node));
  }
  const stateFor = player => playerState(action, player, () => ({ id: start, position: undefined, guards: [], suspended: [] }));
  const action = {
    id: "graph",
    update(ctx) {
      const state = stateFor(ctx.player);
      let selectedGuard = null;
      const matchedGuardIndices = [];
      for (let index = state.guards.length - 1; index >= 0; index -= 1) {
        const guard = state.guards[index];
        if (!guard.condition.check(ctx)) continue;
        matchedGuardIndices.push(index);
        if (!selectedGuard || guard.priority > selectedGuard.guard.priority) selectedGuard = { guard };
      }
      if (selectedGuard) {
        const { guard } = selectedGuard;
        const active = nodes.get(state.id);
        if (active?.kind === "action" || active?.kind === "agent") ctx.brain.stopAction(compiled.get(active.id), ctx);
        state.suspended.push(state.id);
        // Consume all simultaneous matches so lower-priority routes cannot cascade on the next tick.
        for (const index of matchedGuardIndices) state.guards.splice(index, 1);
        state.id = outputs.get(`${guard.nodeId}:trigger`);
        return "running";
      }
      const node = nodes.get(state.id);
      if (node.kind === "end") return "success";
      if (node.kind === "if") {
        const port = compiled.get(node.id).check(ctx) ? "true" : "false";
        state.id = outputs.get(`${node.id}:${port}`);
        return "running";
      }
      if (node.kind === "interrupt") {
        state.guards.push({ nodeId: node.id, condition: compiled.get(node.id), priority: node.priority ?? 0 });
        state.id = outputs.get(`${node.id}:next`);
        return "running";
      }
      if (node.kind === "disarm") {
        state.guards = [];
        state.id = outputs.get(`${node.id}:next`);
        return "running";
      }
      if (node.kind === "resume") {
        const target = state.suspended.pop();
        if (!target) return "failed";
        state.id = target;
        return "running";
      }
      if (node.kind === "agent") {
        const step = compiled.get(node.id);
        const result = step.update(ctx);
        if (result === "running") return "running";
        const port = result === "success" ? step.outputPort?.(ctx) ?? "error" : "error";
        ctx.brain.stopAction(step, ctx);
        const destination = outputs.get(`${node.id}:${port}`);
        if (!destination) return "failed";
        state.id = destination;
        return "running";
      }
      if (node.kind === "switch") {
        const match = compiled.get(node.id).findIndex(condition => condition.check(ctx));
        state.id = outputs.get(`${node.id}:${match < 0 ? "default" : `case_${match}`}`);
        return "running";
      }
      if (node.kind === "start") {
        state.id = outputs.get(`${node.id}:next`);
        return "running";
      }
      const step = compiled.get(node.id);
      const result = step.update(ctx);
      if (result === "success") {
        ctx.brain.stopAction(step, ctx);
        state.id = outputs.get(`${node.id}:next`);
        return "running";
      }
      if (result === "failed" && outputs.has(`${node.id}:error`)) {
        ctx.brain.stopAction(step, ctx);
        state.id = outputs.get(`${node.id}:error`);
        return "running";
      }
      return result;
    },
    describe(ctx) {
      const node = nodes.get(stateFor(ctx.player).id);
      if (node?.kind === "agent") return compiled.get(node.id)?.describe?.(ctx) ?? `AI agent: ${node.id}`;
      if (node?.kind === "action") {
        const step = compiled.get(node.id);
        return `${node.id}: ${step?.describe?.(ctx) ?? step?.id ?? "action"}`;
      }
      return node ? `${node.kind}: ${node.id}` : "graph";
    },
    stop(ctx) {
      const state = stateFor(ctx.player), node = nodes.get(state.id);
      if (node?.kind === "action" || node?.kind === "agent") compiled.get(node.id)?.stop?.(ctx);
      state.id = start;
      state.position = undefined;
      state.guards = [];
      state.suspended = [];
    },
    madeProgress(ctx) {
      const state = stateFor(ctx.player), node = nodes.get(state.id);
      const step = node?.kind === "action" || node?.kind === "agent" ? compiled.get(node.id) : null;
      if (step?.madeProgress) return step.madeProgress(ctx) === true;
      const loc = ctx.player.getLocation?.();
      const position = loc ? `${loc.getX()},${loc.getY()},${loc.getZ()}` : null;
      const moved = state.position !== undefined && state.position !== position;
      state.position = position;
      // Graph control nodes are progress even if the bot did not move.
      return node?.kind !== "action" || moved;
    },
  };
  return action;
}

module.exports = { validateGraph, createGraphAction };
