const encounters = new WeakMap();

function hasGear(player) {
  return (player.getEquipment?.().getItems?.() ?? []).some((item) => (item?.getId?.() ?? item?.id ?? -1) >= 0);
}

function spawn({ player }) {
  encounters.set(player, { geared: hasGear(player), consumed: false, attacked: false });
}

function hit({ player }) {
  const encounter = encounters.get(player);
  if (encounter) encounter.attacked = true;
}

function consume({ player }) {
  const encounter = encounters.get(player);
  if (encounter) encounter.consumed = true;
}

function equipmentChanged({ player }) {
  const encounter = encounters.get(player);
  if (encounter && hasGear(player)) encounter.geared = true;
}

module.exports = function attachBrutusTasks(api, Fights) {
  api.onCustomEvent("ides-of-milk:brutus-spawn", spawn);
  api.onCustomEvent("ides-of-milk:brutus-hit", hit);
  api.onCustomEvent("food:eaten", consume);
  api.onCustomEvent("potions:drunk", consume);
  api.onCustomEvent("equipment:changed", equipmentChanged);
  Fights.onKill("Brutus", {
    "Beef vs Beef": (fight) => {
      const encounter = encounters.get(fight.player);
      return encounter !== undefined && !encounter.geared && !encounter.consumed && !hasGear(fight.player);
    },
    "Smarter than a Cow": (fight) => encounters.get(fight.player)?.attacked === false,
  });
};
