"use strict";
// Finds a JDK 21 for the Quest Helper bridge. Shared by the server's auto-start and the root
// `yarn bridge` / `yarn bridge:setup` scripts. QUEST_HELPER_JAVA_HOME wins, then JAVA_HOME, then
// any installed jdk-21 in the usual places.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

function javaExecutable(platform=os.platform()){return platform==='win32'?'java.exe':'java';}

function findJavaHome({env=process.env,platform=os.platform(),home=os.homedir(),exists=fs.existsSync,list=fs.readdirSync}={}) {
  const java=javaExecutable(platform);
  for(const candidate of [env.QUEST_HELPER_JAVA_HOME,env.JAVA_HOME])
    if(candidate&&exists(path.join(candidate,'bin',java)))return candidate;
  const programFiles=env.ProgramFiles??'C:/Program Files';
  const roots=platform==='win32'
    ?[path.join(programFiles,'Eclipse Adoptium'),path.join(programFiles,'Java'),path.join(programFiles,'Microsoft'),path.join(home,'.gradle','jdks')]
    :[path.join(home,'.gradle','jdks'),'/usr/lib/jvm','/Library/Java/JavaVirtualMachines'];
  for(const dir of roots){
    if(!exists(dir))continue;
    let entries;
    try{entries=list(dir);}catch{continue;}
    for(const entry of entries){
      if(!/(^|[^0-9])21([^0-9]|$)/.test(entry))continue;
      // macOS bundles keep the JDK under Contents/Home.
      for(const jdk of [path.join(dir,entry),path.join(dir,entry,'Contents','Home')])
        if(exists(path.join(jdk,'bin',java)))return jdk;
    }
  }
  return null;
}

module.exports={findJavaHome,javaExecutable};
