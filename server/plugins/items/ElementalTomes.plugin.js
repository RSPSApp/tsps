const Common = require('./elementaltomes/Common.ElementalTomes');
const Combat = require('./elementaltomes/Combat.ElementalTomes');
const Pages = require('./elementaltomes/Pages.ElementalTomes');
const Bank = require('./elementaltomes/Bank.ElementalTomes');
module.exports = {
  name: 'Elemental Tomes',
  members: true,
  register(api) {
    Common.initialize(api);
    Combat.initialize(api);
    Combat.attach(api);
    Pages.initialize(api);
    Pages.attach(api);
    Bank.initialize(api);
    Bank.attach(api);
  },
};
