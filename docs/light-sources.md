# Light sources: putting out and dropping your last light

Plugins: `server/plugins/items/LightSources.plugin.js` (torch, candles, candle lanterns, mining
helmet), `server/plugins/items/OilLights.plugin.js` (oil lamp and lanterns) and
`server/plugins/world/Darkness.plugin.js` (the dark areas and the last-light rule).
Tests: `server/tests/light-sources.test.cjs`.

## Captured (rsprox captures, local 1000134-1000140, rev 226, Lumbridge Swamp Caves)

- **Candle lantern, Extinguish** (lit white 4531 -> unlit 4529): "You extinguish the lantern." as
  a spam line, the item changes in its slot (1000134 ticks 365, 575, 599; 1000135; 1000140).
  The black one (4534 -> 4532) was not captured and is put out the same way.
- **Last light, Extinguish:** with nothing else lit in the caves, the item stays lit and a game
  message says why:
  - candle lantern: "Extinguishing the lantern would leave you without a light source."
    (1000134 ticks 341, 347, 354);
  - lit black candle: "Extinguishing the candle would leave you without a light source."
    (1000134 tick 370). The white candle uses the same line.
- **Last light, Drop:** "Dropping that would leave you without a light source." as a game
  message; the candle stays in its slot and no drop sound plays (1000134 tick 372).
- With a second light carried, the lantern goes out normally (1000134 tick 365, a lit black
  candle carried).

## Ours

- The oil, bullseye and sapphire lanterns use the candle lantern's refusal line; they share its
  "You extinguish the lantern." line, but their refusal was not captured.
- The lit torch and the oil lamp refuse putting out the last light silently: their lines were not
  captured.
- Drop refusal covers every carried light source (the Darkness plugin's carried list); only the
  candle was captured, and its line names no item.
- Not sent: the `darkness_level` varbit (278) and the darkness overlay strength each light gives
  in the caves (captured as 0 -> 1 -> 2 as lights go out).
