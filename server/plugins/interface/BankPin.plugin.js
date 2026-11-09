/**
 * The Bank PIN (https://oldschool.runescape.wiki/w/Bank_PIN), from plugins/interface/data/
 * bank-pin.json: the settings a Banker opens, the keypad, the bank's lock, and the lock on the
 * other things the PIN protects ("bank-pin:guard"), and whether one is set ("bank-pin:status").
 * Each lives in ./bankpin/.
 */
const Common = require("./bankpin/Common.BankPin");
const Keypad = require("./bankpin/Keypad.BankPin");
const Settings = require("./bankpin/Settings.BankPin");
const Guard = require("./bankpin/Guard.BankPin");

module.exports = {
  name: "BankPin",
  description: "The Bank PIN: the Banker settings, the keypad, the bank lock, and the guard on other PIN-protected actions.",
  register(api) {
    Common.init(api);
    Keypad.attach(api);
    Settings.attach(api);
    Guard.attach(api, { onForgotten: Settings.forgot });
  },
};
