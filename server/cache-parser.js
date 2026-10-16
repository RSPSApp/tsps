import fs from "fs";
import path from "path";

// CHANGE THIS: Point directly to the folder containing your .dat2 and .idx12 files
const CACHE_DIR = "./caches/osrs-241_2026-09-30/"; 

// Target structural fingerprints we want to identify
const SEARCH_TARGETS = {
  interfaces: [446, 2311], // Gold / Modern Leather IDs
  varps: [2224]            // Skilling Quantity Varp ID
};

function parseClientScripts() {
  const datPath = path.join(CACHE_DIR, "main_file_cache.dat2");
  const idxPath = path.join(CACHE_DIR, "main_file_cache.idx12"); // Index 12 contains client scripts

  if (!fs.existsSync(datPath) || !fs.existsSync(idxPath)) {
    console.error(`[Error] Could not find cache index blocks inside: ${path.resolve(CACHE_DIR)}`);
    return;
  }

  console.log("Reading Index 12 data blocks natively...");
  const idxBuffer = fs.readFileSync(idxPath);
  const datBuffer = fs.readFileSync(datPath);

  // Total entry records inside Index 12 (Each index record is strictly 6 bytes long)
  const totalEntries = Math.floor(idxBuffer.length / 6);
  console.log(`Scanning through ${totalEntries} potential compiled client scripts...\n`);
  
  let matchesFound = 0;

  for (let scriptId = 0; scriptId < totalEntries; scriptId++) {
    const offset = scriptId * 6;
    
    // Deconstruct the 6-byte index pointer data entry
    const size = (idxBuffer[offset] << 16) | (idxBuffer[offset + 1] << 8) | idxBuffer[offset + 2];
    const sector = (idxBuffer[offset + 3] << 16) | (idxBuffer[offset + 4] << 8) | idxBuffer[offset + 5];

    if (size <= 0 || sector <= 0) continue;

    // Assemble the complete file from fragmented 520-byte sectors
    let rawScriptBuffer = Buffer.alloc(0);
    let currentSector = sector;
    let remainingBytes = size;

    while (remainingBytes > 0 && currentSector > 0) {
      const datOffset = currentSector * 520;
      if (datOffset + 520 > datBuffer.length) break;

      // Structural parsing: Skip the 8-byte sector header to extract pure payload bytes
      const chunkLength = Math.min(remainingBytes, 512);
      const dataChunk = datBuffer.subarray(datOffset + 8, datOffset + 8 + chunkLength);
      
      rawScriptBuffer = Buffer.concat([rawScriptBuffer, dataChunk]);
      remainingBytes -= chunkLength;

      // Extract pointer index to the next sector chunk block
      currentSector = ((datBuffer[datOffset + 4] << 16) | (datBuffer[datOffset + 5] << 8) | datBuffer[datOffset + 6]);
    }

    if (rawScriptBuffer.length === 0) continue;

    // Scan compiled binary streams for 16-bit and 32-bit operands
    const foundInterfaces = [];
    const foundVarps = [];

    for (let i = 0; i < rawScriptBuffer.length - 2; i++) {
      const val16 = rawScriptBuffer.readUInt16BE(i);
      let val32 = -1;
      if (i < rawScriptBuffer.length - 4) {
        val32 = rawScriptBuffer.readUInt32BE(i);
      }

      SEARCH_TARGETS.interfaces.forEach(uiId => {
        if ((val16 === uiId || val32 === uiId) && !foundInterfaces.includes(uiId)) {
          foundInterfaces.push(uiId);
        }
      });

      SEARCH_TARGETS.varps.forEach(varpId => {
        if ((val16 === varpId || val32 === varpId) && !foundVarps.includes(varpId)) {
          foundVarps.push(varpId);
        }
      });
    }

    // Print script context matches
    if (foundInterfaces.length > 0 || foundVarps.length > 0) {
      matchesFound++;
      console.log(`[Script ID: ${scriptId}]`);
      if (foundInterfaces.length > 0) console.log(`  -> Matches Production Interfaces: ${foundInterfaces.join(", ")}`);
      if (foundVarps.length > 0)      console.log(`  -> Matches Quantity Varps: ${foundVarps.join(", ")}`);
      console.log("--------------------------------------------------");
    }
  }

  console.log(`\nScan finished. Identified ${matchesFound} production scripts.`);
}

parseClientScripts();
