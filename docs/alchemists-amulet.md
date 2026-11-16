# Alchemist's amulet

The Mixology reward now grants 50 charges on purchase. Wearing the charged amulet gives a 15%
chance of one extra dose when brewing an eligible product, spends one charge only on success,
and grants the recipe's ordinary XP. Charge consumes whole, unrestricted amulets of chemistry,
ten charges each, up to 5,000. Uncharge returns noted chemistry amulets equal to charges divided
by ten, rounded down; the remainder is lost. A full inventory or capped return stack refuses
before changing the item. The final charge leaves the uncharged amulet and brewing continues,
regardless of the ordinary amulet of chemistry's stop setting.

## Sources and evidence limits

- [OSRS Wiki: Alchemist's amulet](https://oldschool.runescape.wiki/w/Alchemist%27s_amulet)
  establishes these mechanics, including variable-dose upgrades and haemostatic dressing. It
  excludes Guthix rest, unfinished and four-dose products. Direct Wiki retrieval was blocked;
  research used the cached complete page in the local osrsreboxed source data.
- Pinned cache reference `6e5033af6215963581a51b348f452320ff18f0f6`, `config/dump.obj` and
  `config/dump.dbrow`, plus active-cache inspection: uncharged 29988, charged 29990, dummy
  29992 excluded; Wear/Charge and charged Check/Uncharge operations; Mixology stock and prices.
- No matching recording was found. The new messages, amount prompt and confirmation wording
  are uncaptured implementation text. Charge currently accepts unnoted chemistry amulets;
  noted-input charging and generic bank charge-notification settings are not verified here.
- The Wiki does not explicitly define charge ownership. Item metadata is an implementation
  inference following existing charged equipment; separate items keep separate charge counts.
  A charged ID with no metadata receives no implicit free charges.

## Production path and shared change

`ClientConnection` decodes inventory Use and widget actions; `ItemActionPacketListener` and
PluginManager dispatch into `AmuletOfChemistry.plugin.js` and
`alchemistsamulet/Alchemist.AmuletOfChemistry.js`. Deferred charge/uncharge actions recheck the
original current container, slot, item reference, ID and metadata. Real bank removal/return
invalidates the request. Inventory transformations are planned on copied slots before commit.

The native Herblore ingredient action reaches `Mixing.Herblore.mix/offer/start/makeOne`, whose
existing `herblore:mix` request selects the extra-dose product using `potions:dose-family`.
Only the matching `herblore:made` consumes a charge after actual ingredients/output/XP and
only while the shared `extraDose` flag remains owned by the amulet. League effects that
supply the fourth dose clear that flag; the pending amulet token is cleared even on cancellation. The
ordinary chemistry roll and five-charge player state are preserved. Prescription goggles
still save secondaries independently. Omnishop validates payment/capacity before its existing
`omnishop:purchase` listener grants the actual 50-charge item and collection-log event.

The Wiki states: "If killed by a player while wearing this amulet unprotected, it will appear
at your gravestone with 0 charges." `Death.Gravestones.js` therefore adds
`gravestones:pvp-items`: the grave owner derives eligible exact references from this death's
lost worn untradeables and filters nominated references against that original set. The amulet
nominates only the lost worn copy, converts it to uncharged and clears charges. The grave
owner snapshots the original worn slot and ID before the query, then updates a copied layout
only for accepted transformed items so auto-equip retrieval restores the correct slot. Other PvP
loot, protected/carried amulets and third-party items retain the existing routing. Disabled
graves and Ultimate Ironmen retain the shared no-grave policy. PvM and protected items retain
their charges. Existing grave persistence stores item metadata; PlayerSave restores it too.

## Verification

Own server TypeScript build passed. Focused command:

```bash
node --test tests/alchemists-amulet.test.cjs tests/herblore.test.cjs tests/mastering-mixology.test.cjs tests/gravestones.test.cjs
```

The initial focused run passed 142 tests, including 12 new tests on real Player, Inventory, Equipment, Bank and
serialized persistence with only the network captured. Native decoded packets exercise
charge/uncharge menus, ordinary potion ingredient use through actual Herblore `makeOne`,
make-all final depletion and unchanged recipe XP, the 15% boundary, ordinary chemistry,
prescription goggles, paid Mixology purchase and its no-space refusal. Real death routing
checks lost worn/carried/protected/PvM cases, plus a malicious policy nomination of
third-party and tradeable items. RNG is controlled for deterministic brew outcomes. The
existing consumer files include mocked fixtures; they supplement the new real-object tests.
Variable-dose/dressing/Guthix eligibility checks call the shared dose helper directly.

The initial new tests failed on missing brewing/charging/uncharge behavior; the death test
separately failed on absent PvP grave routing before the shared change. Rendering-client
screenshots, actual login/relogin walkthrough and independent review remain pending; unit
tests and decoded native packets alone do not verify client rendering or retail prompt text.

Independent review then reproduced two defects: Friendly Forager's fourth dose still spent
the upgraded amulet's charge, and the transformed PvP amulet's old layout ID prevented
grave auto-equip. Both failing reviewer assertions were retained unchanged and passed after
fixes. Two maintained native regressions now exercise the actual relic and death/retrieval
paths, with ordinary chemistry, normal potion XP at the League multiplier, cleared pending
tokens, and uncharged-PvP/charged-PvM auto-equip controls. The scoped follow-up run passed
62 tests across the independent harness, 14 maintained amulet tests, gravestones and the
relevant relic/fragment production consumers. No full suite or unchanged 142-test repeat
was required. Scoped independent re-review and rendered client QA remain pending.
