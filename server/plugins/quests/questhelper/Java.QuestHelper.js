"use strict";
// Finds a JDK 21 for the Quest Helper bridge. Shared by the server's auto-start and the root
// `yarn bridge` / `yarn bridge:setup` scripts. QUEST_HELPER_JAVA_HOME wins, then JAVA_HOME, then
// any installed jdk-21 in the usual places.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

function javaExecutable(platform=os.platform()){return platform==='win32'?'java.exe':'java';}

/**
 * A JDK's major version from its `release` file, else from a folder name such as jdk-21.0.5 (a
 * "21" after a dot is a patch number: jdk-17.0.21 is 17). Null when neither says.
 */
function majorVersion(home,{read=file=>fs.readFileSync(file,'utf8')}={}) {
  try {
    const match=/^JAVA_VERSION="(?:1\.)?(\d+)/m.exec(read(path.join(home,'release')));
    if(match)return Number(match[1]);
  } catch {}
  const named=/(?:^|[^0-9.])(\d+)(?:[.+_-]|$)/.exec(path.basename(home));
  return named?Number(named[1]):null;
}

function findJavaHome({env=process.env,platform=os.platform(),home=os.homedir(),exists=fs.existsSync,list=fs.readdirSync,read}={}) {
  const java=javaExecutable(platform);
  // An explicit home is trusted unless it says it is another version: JAVA_HOME is often a 17.
  for(const candidate of [env.QUEST_HELPER_JAVA_HOME,env.JAVA_HOME])
    if(candidate&&exists(path.join(candidate,'bin',java))&&[21,null].includes(majorVersion(candidate,{read})))return candidate;
  const programFiles=env.ProgramFiles??'C:/Program Files';
  const roots=platform==='win32'
    ?[path.join(programFiles,'Eclipse Adoptium'),path.join(programFiles,'Java'),path.join(programFiles,'Microsoft'),path.join(home,'.gradle','jdks')]
    :[path.join(home,'.gradle','jdks'),'/usr/lib/jvm','/Library/Java/JavaVirtualMachines'];
  for(const dir of roots){
    if(!exists(dir))continue;
    let entries;
    try{entries=list(dir);}catch{continue;}
    for(const entry of entries){
      // macOS bundles keep the JDK under Contents/Home.
      for(const jdk of [path.join(dir,entry),path.join(dir,entry,'Contents','Home')])
        if(exists(path.join(jdk,'bin',java))&&majorVersion(jdk,{read})===21)return jdk;
    }
  }
  return null;
}

module.exports={findJavaHome,javaExecutable,majorVersion};
