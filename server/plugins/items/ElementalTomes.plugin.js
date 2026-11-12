const Common = require('./elementaltomes/Common.ElementalTomes');
const Combat = require('./elementaltomes/Combat.ElementalTomes');
const Pages = require('./elementaltomes/Pages.ElementalTomes');
const Bank = require('./elementaltomes/Bank.ElementalTomes');
const State = require('./elementaltomes/State.ElementalTomes');
module.exports = {
  name: 'Elemental Tomes',
  description: 'Tomes of fire and water: charged with burnt or soaked pages, boosting spell damage and saving runes, with page-storing and bank options.',
  members: true,
  register(api) {
    Common.initialize(api);
    Combat.initialize(api);
    Combat.attach(api);
    Pages.initialize(api);
    Pages.attach(api);
    Bank.initialize(api);
    Bank.attach(api);
    State.attach(api);
  },
};
