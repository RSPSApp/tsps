"use strict";

const Scene=require('./Scene.ChristmasDinner');
const Dialogue=require('./Dialogue.ChristmasDinner');
const {musicBounds}=require('./data/christmas-2025-scene.json');

function track(api){
  if(!Scene.active()||!Dialogue.active())return null;
  return api.core.Music.tracks().find(row=>row.name==='All the Trimmings')?.id??null;
}
function createArea(api){
  class ChristmasMusicArea extends api.core.Area{
    getMusicTrack(){return track(api);}
  }
  // The inert area falls back to ordinary region music outside the window.
  // Selection/unlocks, manual mode, jingles and restoration belong to the session.
  return new ChristmasMusicArea(musicBounds.map(row=>new api.core.Boundary(...row)));
}

module.exports={track,createArea};
