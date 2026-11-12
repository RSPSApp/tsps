module.exports = {
  name: 'GamesRoom',
  description: 'Adds the Burthorpe Games Room board games, such as Draughts, Runelink and Runesquares, with tables, challenges, spectating and ranks.',
  members: true,
  register(api) {
    require('./gamesroom/Runtime.GamesRoom').attach(api);
  },
};
