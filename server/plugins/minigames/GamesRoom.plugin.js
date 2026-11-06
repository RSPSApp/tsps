module.exports = {
  name: 'GamesRoom',
  members: true,
  register(api) {
    require('./gamesroom/Runtime.GamesRoom').attach(api);
  },
};
