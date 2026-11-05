# Item Prices

This plugin follows RuneLite's Item Prices settings and displays the connected world's TSPS guide quote alongside the cache-derived high-alchemy value. Missing guide quotes and nonpositive alchemy values are omitted; store prices are never presented as GE quotes. Stack totals and per-item values are shown when configured. High-alchemy profit requires its setting, GE display with a positive guide quote, a positive cache-derived HA value, and a positive nature-rune guide quote. As in RuneLite, profit can display when the HA value row itself is hidden.

The plugin is disabled by default. Supported hover targets are inventory, the main and side banks, the seed vault, the seed-vault deposit interface, and the POH costume-room side panel. Coins and platinum tokens use their stack coin value. Inventory prices are hidden by default; a selected High Level Alchemy spell in `ClientState` overrides that setting when `Show prices while alching` is enabled. Equipment is not a RuneLite Item Prices target. The price panel avoids measured native item-action text and Item Stats' tooltip bounds, stays within the canvas, and uses client-scoped tooltip state; Item Stats drawing, scale and placement remain unchanged. When neither the mouseover timer nor action text has usable bounds, it reserves a conservative area near the pointer instead; that fallback is approximate.

**Known differences from RuneLite:** the alchemy check uses TSPS spell-selection state rather than RuneLite's `BeforeRender` event/opcode lifecycle. For the six Barrows sets, the base and repaired 25/50/75/100 variants map to their tradeable base IDs using RuneLite `ItemMapping` data; broken pieces retain their own quote IDs. Ornamented Barrows pieces and other RuneLite mappings (charged forms, kits, other variants, and conversions) are not included. Unmapped items use only their own connected-world quote, never a store-price substitute. Stack totals use RuneLite-style K/M/B abbreviations; values use exact integer arithmetic and ASCII minus signs. Low alchemy is not displayed. High-alchemy value is derived with TSPS's existing 60% store-price convention; profit is omitted until a nature-rune quote is available.

RuneLite source reference: `runelite-client/src/main/java/net/runelite/client/plugins/itemprices`. Its `ItemPricesPlugin.java` and `ItemPricesConfig.java` carry this BSD-2-Clause notice:

```text
Copyright (c) 2018 Charlie Waters
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The Barrows mapping data is adapted from RuneLite's `runelite-client/src/main/java/net/runelite/client/game/ItemMapping.java`, which carries this additional BSD-2-Clause notice:

```text
Copyright (c) 2018, Tomas Slusny <slusnucky@gmail.com>
Copyright (c) 2018, Seth <Sethtroll3@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
