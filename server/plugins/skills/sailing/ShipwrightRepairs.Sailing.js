const repairs = require('./shipwrightrepairs/Repair.ShipwrightRepairs');
module.exports = {
  register(api) {
    repairs.attach(api);
  },
};
