/**
 * Native tanner324. The tanners' own option opens it (Ellis, Tanner, Sbott, Eodan); other content
 * requests it through tanning:open after checking access. tanning.json "prices" lists tanners who
 * charge more than the default, per hide row. Ellis and the Crafting Guild tanner are
 * free-to-play (https://oldschool.runescape.wiki/w/Tanning), so the plugin is not members-only;
 * the members tanners stand in members areas. A tan closes the interface (docs/tanning.md).
 */
const data = require('./data/tanning.json');
const GROUP = 324;
// Current-cache gamevals: tanning_a_all through tanning_h_1; native IF1 buttons say Tan All/X/5/1.
const CLOSE = (GROUP << 16) | 91;
const BUTTONS = Array.from({ length:32 }, (_, index) => (GROUP << 16) | (124 + index));
const opened = new WeakMap();
let api = null;

function openTanning(event) {
  if (!event.player || event.handled) return;
  const { player, npc } = event;
  const context = { npc, origin: player.getLocation().clone(), prices: event.prices ?? null };
  event.handled = true;
  player.getPacketSender().sendInterface(GROUP);
  opened.set(player, context);
  for (const [index, hide] of data.hides.entries()) {
    const price = priceOf(context, index);
    player.getPacketSender().sendItemOnInterfaces((GROUP << 16) | (100 + index), hide.product, 250)
      .sendString(hide.name, (GROUP << 16) | (108 + index))
      .sendString(`${price} coin${price === 1 ? "" : "s"}`, (GROUP << 16) | (116 + index));
  }
}

function priceOf(context, index) {
  return context.prices?.[index] ?? data.hides[index].price;
}

function tradeWithTanner(event) {
  const prices = data.prices?.[event.definition?.getName?.()];
  openTanning({ player: event.player, npc: event.npc, prices });
}

function tan(player, index, requested, context) {
  const hide = data.hides[index], price = priceOf(context, index);
  if (opened.get(player) !== context || !Number.isSafeInteger(requested) || requested < 1) return 0;
  const at = player.getLocation();
  if (at.getZ() !== context.origin.getZ() || Math.max(Math.abs(at.getX() - context.origin.getX()), Math.abs(at.getY() - context.origin.getY())) > 8
    || context.npc?.isRegistered?.() === false) return 0;
  const inventory = player.getInventory(), held = inventory.getAmount(hide.raw);
  if (held === 0) { player.sendMessage("You don't have any suitable hides to tan."); return 0; }
  const count = Math.min(requested, held, Math.floor(inventory.getAmount(data.coins) / price));
  if (count === 0) { player.sendMessage("You don't have enough coins to pay for tanning."); return 0; }
  inventory.deleteNumber(data.coins, count * price);
  inventory.deleteNumber(hide.raw, count);
  inventory.adds(hide.product, count);
  if (hide.hide) player.sendMessage(count === 1 ? `The tanner tans your ${hide.hide}.` : `The tanner tans ${count} ${hide.hide}s for you.`);
  opened.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
  api?.emitCustomEvent('tanning:done', { player, tanner: context.npc?.getCurrentDefinition?.()?.getName?.() ?? context.npc?.getDefinition?.()?.getName?.(), count });
  return count;
}

function click(event) {
  const { player, buttonId } = event, context = opened.get(player);
  if (!context) return;
  if (buttonId === CLOSE) { event.handled = true; opened.delete(player); player.getPacketSender().sendInterfaceRemoval(); return; }
  const index = (buttonId & 0xffff) - 124;
  if (buttonId >>> 16 !== GROUP || index < 0 || index >=32) return;
  event.handled = true;
  const row = index % 8, option = Math.floor(index / 8);
  if (option === 1) {
    player.setEnteredAmountAction({ execute: amount => tan(player, row, amount, context) });
    player.getPacketSender().sendEnterAmountPrompt('How many would you like to tan?');
  } else tan(player, row, option === 0 ? 0x7fffffff : option === 2 ? 5 : 1, context);
}

function close({ player, interfaceId }) {
  if (interfaceId === GROUP) opened.delete(player);
}

function logout({ player }) { opened.delete(player); }

module.exports = {
  name: 'Tanning',
  register(pluginApi) {
    api = pluginApi;
    api.onCustomEvent('tanning:open', openTanning);
    api.onNpcsInteraction(['Ellis', 'Tanner', 'Sbott'], { Trade: tradeWithTanner });
    api.onNpcInteraction('Eodan', { 'Tan-hides': tradeWithTanner });
    api.onInterfaceActionButton([CLOSE, ...BUTTONS], click);
    api.onCustomEvent('interface:closed', close);
    api.onPlayerLogout(logout);
  },
};
