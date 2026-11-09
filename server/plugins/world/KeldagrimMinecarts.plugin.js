/**
 * The Keldagrim minecarts (https://oldschool.runescape.wiki/w/Keldagrim_minecart_system), from
 * plugins/world/data/keldagrim-minecarts.json: tickets from the cart conductors, and the rides
 * between Keldagrim Carts' station, Ice Mountain, White Wolf Mountain and the Grand Exchange.
 * Each lives in ./keldagrimminecarts/.
 */
const Common = require("./keldagrimminecarts/Common.KeldagrimMinecarts");
const Tickets = require("./keldagrimminecarts/Tickets.KeldagrimMinecarts");
const Ride = require("./keldagrimminecarts/Ride.KeldagrimMinecarts");

module.exports = {
  name: "KeldagrimMinecarts",
  description: "Keldagrim minecarts: conductors sell tickets, with rides between Keldagrim, Ice Mountain, White Wolf Mountain and the Grand Exchange.",
  members: true,
  register(api) {
    Common.init(api);
    Tickets.attach(api);
    Ride.attach(api);
  },
};
