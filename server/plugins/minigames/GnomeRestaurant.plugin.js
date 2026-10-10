"use strict";

/**
 * Gnome Restaurant, the Aluft Aloft food delivery minigame: Gianne jnr.'s easy and hard
 * orders, the Aluft Aloft box and its time limit, delivery by using the ordered dish on the
 * customer, and the coin/item tips and credits. Each unit lives in ./gnomerestaurant/.
 */
const Orders = require("./gnomerestaurant/Orders.GnomeRestaurant");
const Delivery = require("./gnomerestaurant/Delivery.GnomeRestaurant");

module.exports = {
  name: "GnomeRestaurant",
  members: true,
  register(api) {
    Orders(api);
    Delivery(api);
  },
  _test: {
    ...Orders._test,
    ...Delivery._test,
    init(api) {
      Orders._test.init(api);
      Delivery._test.init(api);
    },
  },
};
