const repairs = require('./shipwrightrepairs/Repair.ShipwrightRepairs');
module.exports = {
  name: 'SailingShipwrightRepairs',
  description: 'Shipwright repairs for boats, attached from the Sailing repairs unit.',
  members: true,
  register(api) {
    repairs.attach(api);
  },
};
