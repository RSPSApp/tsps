"use strict";

const { readAvailablePlans, planOverrideFields, savePlan } = require("../../bots/runtime/DeploymentPlans.PlayerBots");
const { originAllowed } = require("./Access.WorldAdmin");
const { HttpError, readJson, send } = require("./Http.WorldAdmin");
const { routineNames, matchRoutineIds, listedRoutines } = require("../../bots/runtime/RoutineCatalog.PlayerBots");
const botDefinitions = require("../../../data/definitions/bot-activities.json");

// Both authenticated panels can edit saved plans even with no game process.
async function planFiles(request, response, url, brainRegistry) {
  if (url.pathname !== "/api/bots/plans") return false;
  if (request.method === "GET") {
    // Offline, show built-ins and keep any installed-plugin IDs already stored in plan rows.
    const available = listedRoutines(brainRegistry ?? botDefinitions);
    const routineIds = [...new Set(available.map(activity => activity.id))];
    const names = { ...routineNames, ...Object.fromEntries(available.filter(activity => activity.codeDefined).map(activity => [activity.id, activity.name])) };
    const presets = brainRegistry?.deploymentPlans;
    const plans = readAvailablePlans(presets).map(plan => ({ ...plan, launchOverrides: planOverrideFields(plan) }));
    send(response, 200, { plans, codePlanIds: (presets ?? []).map(plan => plan.id), routineIds, routineNames: names, matchRoutineIds });
    return true;
  }
  if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
  if (!originAllowed(request)) throw new HttpError(403, "Cross-origin request refused");
  const input = await readJson(request);
  let plans;
  try { plans = savePlan(input); } catch (error) { throw new HttpError(400, error.message); }
  send(response, 200, { plans });
  return true;
}
module.exports = { planFiles };
