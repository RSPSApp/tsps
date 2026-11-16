/**
 * The relic catalog the client draws. The cache's relic interface reads its league struct's tier
 * enum, tier structs and relic structs, but the cache only carries the current league's, so this
 * answers LeagueMode's `league:content-rows` with a league's own structs and enums (sent as
 * structOverrides / enumOverrides at login and before the interface opens). A league the cache
 * carries (data `fromCache`) needs none. Icons are the league's own relic sprites, which the cache
 * still carries by name (league_5_relics_tli,3 ...), at the index the league's own cache gave.
 */
const Common = require("./Common.LeagueRelics");

/** League type -> its relics' icon params ([tier][slot] -> { param: sprite id }), resolved once. */
const iconCache = new Map();

/** Each relic's six icon params: the league's sprite name, the param's suffix, the relic's index. */
function iconParams(type) {
  if (iconCache.has(type)) return iconCache.get(type);
  const { CacheDefinitions } = Common.core;
  const { iconSprite, tiers } = Common.catalog(type);
  const icons = tiers.map((tier) => tier.relics.map((relic) => {
    const params = {};
    for (const [param, suffix] of Object.entries(Common.data.params.icons)) {
      const sprite = CacheDefinitions.getSpriteId(`${iconSprite}${suffix},${relic.icon}`);
      if (sprite !== null) params[param] = sprite;
    }
    return params;
  }));
  iconCache.set(type, icons);
  return icons;
}

/** structId -> params the client reads for it; a cache struct's listed params are replaced, the rest still come from the cache. */
function structRows(type) {
  const { params } = Common.data;
  const icons = iconParams(type);
  const id = Common.ids(type);
  const rows = [{ structId: Common.league(type).struct, params: { [params.tiersEnum]: id.tiersEnum } }];
  Common.catalog(type).tiers.forEach((tier, tierIndex) => {
    rows.push({ structId: id.tierStruct(tierIndex), params: {
      [params.tierCost]: tier.cost,
      [params.tierRelics]: id.relicsEnum(tierIndex),
      [params.tierPassive]: id.passiveStruct(tierIndex),
    } });
    rows.push({ structId: id.passiveStruct(tierIndex), params: { [params.passiveText]: tier.passive } });
    tier.relics.forEach((relic, slotIndex) => {
      const relicParams = {
        [params.relicName]: relic.name,
        [params.relicDescription]: relic.description,
        [params.relicTier]: tierIndex,
        [params.relicHasItem]: relic.grants?.length ? 1 : 0,
        ...icons[tierIndex][slotIndex],
      };
      rows.push({ structId: id.relicStruct(tierIndex, slotIndex + 1), params: relicParams });
    });
  });
  return rows;
}

function enumRows(type) {
  const id = Common.ids(type);
  const tiers = Common.catalog(type).tiers;
  const rows = [{
    enumId: id.tiersEnum, valueType: "J", defaultValue: -1,
    entries: tiers.map((_tier, tierIndex) => [tierIndex, id.tierStruct(tierIndex)]),
  }];
  tiers.forEach((tier, tierIndex) => rows.push({
    enumId: id.relicsEnum(tierIndex), valueType: "J", defaultValue: -1,
    entries: tier.relics.map((_relic, slotIndex) => [slotIndex + 1, id.relicStruct(tierIndex, slotIndex + 1)]),
  }));
  return rows;
}

function datasets(type) {
  return [
    { key: "structOverrides", rows: structRows(type) },
    { key: "enumOverrides", rows: enumRows(type) },
  ];
}

/** `league:content-rows` { league, structs, enums }: this league's rows, unless the cache already has them. */
function content(query) {
  const type = query?.league;
  if (!Common.catalog(type) || Common.catalog(type).fromCache) return;
  query.structs.push(...structRows(type));
  query.enums.push(...enumRows(type));
}

module.exports = function attach(api) {
  api.onCustomEvent("league:content-rows", content);
};

module.exports.datasets = datasets;
module.exports.structRows = structRows;
module.exports.enumRows = enumRows;
