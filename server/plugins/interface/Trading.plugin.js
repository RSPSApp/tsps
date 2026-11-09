const OFFER_INTERFACE = 335;
const CONFIRM_INTERFACE = 334;
const INVENTORY_INTERFACE = 336;

function interfaceClosed(api, { player, interfaceId }) {
  // confirmScreen changes state before replacing the offer interface.
  if (interfaceId === OFFER_INTERFACE && player.getTrading().getState() === api.core.TradeState.CONFIRM_SCREEN) return;
  if (interfaceId === OFFER_INTERFACE || interfaceId === CONFIRM_INTERFACE || interfaceId === INVENTORY_INTERFACE) {
    player.getTrading().closeTrade();
  }
}

module.exports = {
  name: "Trading",
  description: "Closes a player-to-player trade when its offer, confirmation or inventory interface is closed.",
  register(api) {
    api.onCustomEvent("interface:closed", interfaceClosed.bind(null, api));
  },
};
