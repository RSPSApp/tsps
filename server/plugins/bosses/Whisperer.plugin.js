const Common = require('./whisperer/Common.Whisperer');
const Site = require('./whisperer/Site.Whisperer');
const Fight = require('./whisperer/Fight.Whisperer');
module.exports = { name: 'The Whisperer', description: 'The Whisperer: its site and the fight.', members: true, register(api) { Common.init(api); Site.attach(api); Fight.attach(api); } };
