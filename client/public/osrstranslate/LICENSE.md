# OSRS Translate additions

`additions-pt-BR.json` and `additions-ESP.json` are tsps's own Portuguese and Spanish
translations for the OSRS Translate PT-BR plugin (`client/game/plugins/osrstranslate/`). They are
project-owned entries and historical contributions to the author's dictionary repository,
[walterrezende12-tech/osrs-translate-translations](https://github.com/walterrezende12-tech/osrs-translate-translations)
(including historical pull requests #4, #5 and #6 there; each file
lists the commits it was built from), and are distributed here under this repository's licence (BSD-2,
see `/LICENSE`). None of the author's own dictionary entries are included: the plugin downloads
those from his repository at run time.

Each file lists the author's commit it was compared against and the pull request commits it was
built from. `add` holds entries his dictionaries lack; `fix` holds `[his current text, ours]`
pairs for entries we corrected. The plugin uses an addition only while his dictionary has no entry
for that text, and a fix only while his entry is still exactly the text it replaces, so both stop
mattering once he merges and republishes.

Project-owned entries also come from `client/scripts/osrs-translate-additions/*.json` under
this repository's BSD-2 licence. Their `localSources` fingerprints use LF-normalized source bytes;
they do not require an external contribution. Existing upstream references describe historical inputs.

Rebuild with `client/scripts/osrs-translate-additions.mjs` (see its header); do not edit the JSON
by hand. The translations are drafts that have not yet been reviewed by a native speaker.
