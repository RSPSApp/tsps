const Common = require('./leviathan/Common.Leviathan');
const Site = require('./leviathan/Site.Leviathan');
const Fight = require('./leviathan/Fight.Leviathan');
const Rewards = require('./leviathan/Rewards.Leviathan');
module.exports = {
  name: 'Leviathan', description: 'The Leviathan: its site, the fight and the rewards.', members: true,
  register(api) {
    Common.init(api);
    Site.attach(api);
    Fight.attach(api);
    Rewards.attach(api);
  },
};
