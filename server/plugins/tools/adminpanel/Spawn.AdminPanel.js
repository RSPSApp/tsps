const { PlayerToolError, searchItems } = require('../PlayerTools');
const Npcs = require('./Npcs.AdminPanel');
const MAX_BATCH = 20;
const KINDS = ['npc', 'item'];
const actions = () => ['Spawn 1 under me', 'Spawn X'];
function fail(message, status = 409) { throw new PlayerToolError(status, message); }
function requireActor(api, actor) {
  const { core } = api;
  if (!actor || !core.PlayerRights.hasAdminRights(actor) || !core.PluginManager.playerHasCommandRights(actor, 'admin')) fail('Admin access is no longer available.', 403);
  if (!actor.isRegistered() || core.World.getPlayerByName(actor.getUsername()) !== actor) fail('Your player session is offline. Reopen Admin after logging in.');
  if (actor.getProfile() !== (core.GameConstants.WORLD_PROFILE ?? 'main')) fail('Your player is on a different world profile.');
  if (core.Server.isShuttingDown()) fail('Wait until the server has finished restarting.');
  if (actor.isDyingReturn() || actor.getHitpoints() <= 0 || actor.isTeleportingReturn()) fail('Wait until you are alive and have finished teleporting.');
}
function status(api, actor) {
  const event = { actor, player: actor };
  api.emitCustomEvent('admin:testing-tools', event);
  return { allowed: event.allowed ?? {}, spawned: event.spawned ?? 0 };
}
function search(api, actor, kind, query) {
  requireActor(api, actor);
  if (!KINDS.includes(kind)) fail('Choose NPCs or Items.', 400);
  if (!status(api, actor).allowed[kind]) return [];
  return kind === 'npc' ? Npcs.search(api.core, String(query)) : searchItems(api.core, String(query));
}
function apply(api, actor, { kind, id, count = 1, random = false }) {
  requireActor(api, actor);
  if (!KINDS.includes(kind)) fail('Choose NPCs or Items.', 400);
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) fail(`Choose a count from 1 to ${MAX_BATCH}.`, 400);
  if (!random && count !== 1) fail('Use Spawn X to spawn a batch.', 400);
  const event = { actor, player: actor, action: kind === 'npc' ? 'spawn-npcs' : 'spawn-items',
    id, amount: count, placement: random ? 'near-actor' : 'under-actor' };
  api.emitCustomEvent('admin:testing-tools', event);
  if (!event.handled) fail(event.error ?? 'Admin spawning is unavailable.');
  return { ok: true, message: event.message, count: event.count ?? count };
}
function clearNpcs(api, actor) {
  requireActor(api, actor);
  const event = { actor, player: actor, action: 'remove-npcs' };
  api.emitCustomEvent('admin:testing-tools', event);
  if (!event.handled) fail(event.error ?? 'Admin NPC cleanup is unavailable.');
  return { ok: true, message: event.message };
}
module.exports = { MAX_BATCH, KINDS, actions, search, status, apply, clearNpcs };
