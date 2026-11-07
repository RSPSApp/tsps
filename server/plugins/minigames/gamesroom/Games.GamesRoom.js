'use strict';

// Native boardgames_game values and options label components, verified against
// the revision 241 challenge/options scripts and active cache.
const GAMES = {
  draughts: { id: 0, title: 'Draughts', width: 8, height: 8, squareInput: true, spectatable: true,
    optionTimeLabel: 'com_42', optionRankLabel: 'com_56' },
  runelink: { id: 1, title: 'Runelink', width: 7, height: 6, squareInput: false, spectatable: true,
    optionTimeLabel: 'com_45', optionRankLabel: 'com_43' },
  runesquares: { id: 2, title: 'Runesquares', width: 8, height: 8, squareInput: false,
    optionTimeLabel: 'com_42', optionRankLabel: 'com_56' },
  // boardgames_table_runeversi carries View-game in the active cache.
  runeversi: { id: 3, title: 'Runeversi', width: 8, height: 8, squareInput: false, spectatable: true,
    optionTimeLabel: 'com_42', optionRankLabel: 'com_56' },
};

module.exports = { GAMES };
