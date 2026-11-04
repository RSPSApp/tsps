// Ordinary shipwrights destroy boats; Seb only repairs. Text stays in their canonical pages.
const { dockNear } = require('../SailingContent.Sailing');
const { MODE, openBoatSelection } = require('../BoatSelection.plugin');
const { sendBoatVarbits } = require('../BoatVarbits.Sailing');
const TARGET = 'Destroy Boat';
const CONFIRM = 'shipwright-destroy-confirm';
const DECLINE = 'shipwright-destroy-decline';
const SELECTION = 934;
const requests = new WeakMap();
let api, nextSession = 0;

function ordinary(name) {
  return name === 'Junior Jim' || (name?.startsWith('Shipwright ') && name !== 'Shipwright Seb');
}
function nearby(quote) {
  const { player, npc } = quote;
  return requests.get(player) === quote && player.isRegistered() && !player.busy()
    && npc?.isRegistered() && npc.getId() === quote.rawNpcId
    && npc.getCurrentDefinition(player)?.getName() === quote.name
    && player.getPrivateArea() === npc.getPrivateArea()
    && player.getLocation().isWithinDistance(npc.getLocation(), 5);
}
function selected(quote) {
  return nearby(quote) && quote.player.getSailing().boats.includes(quote.boat)
    && quote.boat.slot === quote.slot;
}
function loaded(boat) { return boat.cargo.some(item => item && item.amount > 0); }

/** The source's sibling following its Destroy Boat interface, without copying the transcript. */
function afterSelection(steps) {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (step.action === 'open_interface' && step.target === TARGET) return steps[index + 1]?.steps;
    for (const nested of [step.steps, ...(step.options ?? []).map(option => option.steps)]) {
      if (!Array.isArray(nested)) continue;
      const found = afterSelection(nested);
      if (found) return found;
    }
  }
  return undefined;
}
function confirmation(steps, quote) {
  const after = afterSelection(steps) ?? [];
  const source = after.find(step => step.type === 'choice' && step.options?.some(option => option.text === 'Yes, destroy it.'));
  if (!source) return [];
  const menu = structuredClone(source);
  menu.options = menu.options.map(option => ({ ...option, steps: [
    { type: 'action', action: option.text === 'Yes, destroy it.' ? CONFIRM : DECLINE, destroySession: quote.session },
    ...option.steps,
  ] }));
  quote.warned = loaded(quote.boat);
  const warning = after.find(step => step.type === 'condition')?.steps?.find(step => typeof step.npc === 'string');
  return quote.warned && warning ? [warning, menu] : quote.warned ? [] : [menu];
}
function choose(quote, slot) {
  quote.boat = quote.offered.get(slot);
  quote.slot = slot;
  if (!selected(quote)) return requests.delete(quote.player);
  const request = { player: quote.player, npc: quote.npc, npcId: quote.npcId,
    variant: { page: quote.name }, exact: true, select: steps => confirmation(steps, quote) };
  api.emitCustomEvent('npc-dialogue:start', request);
  quote.cancel = request.cancel;
  if (!request.handled) requests.delete(quote.player);
}
function open(quote) {
  const { player } = quote;
  if (!nearby(quote) || player.getDialogueManager().isActive()
    || player.getPacketSender().hasInterruptibleInterface()) return requests.delete(player);
  openBoatSelection(player, MODE.DESTROY, dockNear(player, 32) ?? {}, slot => choose(quote, slot));
}
function onAction(event) {
  const name = event.definition?.getName();
  if (!ordinary(name)) return;
  if (event.action === 'open_interface' && event.target === TARGET) {
    event.handled = true;
    event.end = true;
    const quote = { player: event.player, npc: event.npc, npcId: event.npcId, rawNpcId: event.npc?.getId(), name,
      session: ++nextSession, offered: new Map(event.player.getSailing().boats.map(boat => [boat.slot, boat])) };
    requests.set(event.player, quote);
    if (!quote.offered.size) return requests.delete(event.player);
    api.core.TaskManager.submit(new api.core.CountdownTask(event.player.getIndex(), 1, () => open(quote)));
    return;
  }
  if (event.action !== CONFIRM && event.action !== DECLINE) return;
  event.handled = true;
  const quote = requests.get(event.player);
  if (!quote || event.npc !== quote.npc || event.step.destroySession !== quote.session) {
    event.end = true;
    return;
  }
  const valid = selected(quote) && (!loaded(quote.boat) || quote.warned);
  requests.delete(event.player);
  if (event.action === DECLINE || !valid) {
    event.end = true;
    return;
  }
  const request = { player: event.player, owned: quote.boat, allow: true };
  api.emitCustomEvent('sailing:can-destroy-boat', request);
  if (!request.allow || !api.core.Sailing.removeOwnedBoat(event.player, quote.boat)) {
    event.end = true;
    return;
  }
  sendBoatVarbits(event.player);
}
function ownsNoBoats({ player, definition, text }) {
  if (!ordinary(definition?.getName()) || text !== "If the player doesn't own any boats:") return null;
  return player.getSailing().boats.length === 0;
}
function logout({ player }) {
  requests.get(player)?.cancel?.();
  requests.delete(player);
}
function replaced({ player, interfaceId }) {
  if (interfaceId < 0 || interfaceId === SELECTION) return;
  logout({ player });
}
function attach(registry) {
  api = registry;
  registry.onCustomEvent('npc-dialogue:action', onAction);
  registry.onNpcDialogueCondition(ownsNoBoats);
  registry.onCustomEvent('interface:changed', replaced);
  registry.onPlayerLogout(logout);
}
module.exports = attach;
