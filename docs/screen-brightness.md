# Screen brightness

The Settings "Screen brightness" slider, from the rev 241 cache.

## How OSRS does it

- **It's a device option:** brightness is device option 6, kept by the client. No varp is involved: no cache script reads varp 166 (`option_brightness`, the old 1–4 setting) or varbit 10729 (`option_brightness_remember`) any more.
- **The slider** is built by script 381, as setting 15. It's a track of notches (one per position, 21 for brightness), each a component with the left-click option "Adjust Brightness" and `cc_setonop(439, [15, position, …])`. Clicking along the track picks a notch.
- **Writing:** script 439 calls 3966, which sets `deviceoption_set(6, clamp(0, 100, position × 5))`, then 3941 moves the handle.
- **Reading:** script 3961 returns `deviceoption_get(6) / 5` for setting 15.
- **Not the slider:** script 526 → 837 → 9443 → 9444 is the notch's hover tooltip (9444 is the bespoke tooltip script). Varp 2856 (`settings_varp_1`) packs 16 other settings; the slider only redraws when it changes.

## In this client

`client/ui/ScreenBrightness.ts`:
- **The value:** device option 6, 0–100 in steps of 5, kept in `localStorage` (`osrs.screenBrightness`), like the interface scaling. The client's device options start with it, so the slider shows it.
- **The renderer's brightness** is OSRS's gamma exponent: colours are `pow(rgb, gamma)`. Like native `DefaultsGroup.setBrightness`, the slider maps 0–100 linearly from 1.0 (darkest) to 0.5 (brightest): `gamma = 0.5 + (100 − value) / 200`.
- **The default** is 50 (gamma 0.75).
- **Applying it:** `OsrsClient.setDeviceOption` sends option 6 to `applyScreenBrightness`, which saves it and sets the renderer's gamma. The debug panel's Brightness control uses the same scale and path.

### Textures

Flat colours get the gamma in `hslToRgb` and pass through unchanged (they sample a white texel). Textures are uploaded at gamma 1.0, so `render/shaders/includes/brightness.glsl` (and its WGSL copies in `main.frag.wgsl.ts` and `actor.wgsl.ts`) applies `pow(texel, gamma)` once, then multiplies the vertex lighting, like native `Texture.loadPixels`.

## Not verified

- **OSRS's default position.**
- **The interface and minimap:** whether brightness affects them in OSRS. Here only the 3D scene changes.

## Testing

`client/tests/screen-brightness.test.ts`: the mapping, the default, and saving (including blocked storage). `client/tests/brightness-shader-equations.test.ts`: the shader helpers against native texture bytes and flat-palette passthrough.
