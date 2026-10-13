# Object examines

OSRS sends a loc's examine text from the server; the cache has none of it. `ObjectDefinition.getExamine()` answers from two files in `server/data/definitions/`, read the first time anything is examined:

- **`object-examines.json`** (generated): object id → text, from the OSRS Wiki through osrsreboxed-db;
- **`object-examine-overrides.json`** (kept by hand): examines captured live, applied over the dump.

An object neither covers still gets the generic `It's a/an <name>.`. Both files are minified: hosted worlds load them into browser memory.

## Regenerating

```sh
cd ../osrsreboxed-db
python -m scripts.examines.update      # writes docs/object-examines.json
cp docs/object-examines.json ../tsps/server/data/definitions/object-examines.json
```

- **Never edit the generated file by hand:** the next dump overwrites it. Put a fix in the overrides instead.
- **The dumper** lists every page with an `{{Infobox Scenery}}` from the Wiki's `infobox_scenery` bucket (6,102 pages) and pairs each version's ids with its examine (`|id1 = 1276` / `|examine1 = One of the most common trees in Gielinor.`). 15,217 objects at the last run.
- **How it cleans the text:**
  - links, formatting and refs are stripped, and `N/A` means no examine;
  - a page listing several examines for one object, as bullets or labelled by situation ("Throne Room: …"), gives the first;
  - the Fireplace page's "(Unlit) … (Lit) …" gives the lit text.
- **Conflicts:** when two pages give one id different texts, the first is kept and the rest are logged.

## The overrides

`object-examine-overrides.json` holds 94 examines recorded in rsprox captures (https://rsprox.net/database) on normal worlds, each paired with the object examined.

- **What they cover:** the captures recorded 163. The other 69 match the dump, so they aren't kept. The 94 are ids the Wiki pages don't list (mostly Construction furniture and Sailing parts) or that it words differently.
- **Which worlds:** alpha, beta, Leagues and other event worlds are left out, because a Sailing Alpha world's ids didn't match its revision's names.
- **Pruning:** `tests/object-examines.test.cjs` fails when an override matches the dump, so ones the Wiki has caught up with can be removed.

## The examine packet

A multi-loc's text can be recorded under the variant the player sees (a farming patch's growing state, as the captures show). So when the id the client sent has no text, the examine answers from the player's variant.

## Not modelled

- **The message type:** OSRS sends examines as their own chat type (`loc_examine`); here they're sent as game messages.
