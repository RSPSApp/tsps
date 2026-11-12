module.exports = {
  name: 'Elemental Spells',
  description: 'Elemental combat spells: strike to wave casting, elemental weaknesses and the fragment effects.',
  register(api) {
    require('./elementalspells/Common.ElementalSpells').init(api);
    require('./elementalspells/Base.ElementalSpells').attach(api);
    require('./elementalspells/Weakness.ElementalSpells').attach(api);
    require('./elementalspells/Fragments.ElementalSpells').attach(api);
  },
};
