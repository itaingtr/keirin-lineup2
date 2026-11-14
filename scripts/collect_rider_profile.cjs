// Explicit display-only snapshot for a searched rider; never rewrites history.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{
  const id=process.argv[2],name=process.argv[3],period=Number(process.argv[4]);
  if(!/^\d{6}$/.test(id||'')||!name||!Number.isInteger(period))throw new Error('Use JKA-ID name period');
  const {parseHTML}=require('linkedom');
  const {profileView,parseProfile}=await import('../supabase/functions/rider-profile/parser.mjs');
  const {readProfileHtml}=await import('../supabase/functions/rider-profile/source.mjs');
  const html=await readProfileHtml(id),{document}=parseHTML(html);
  const record=parseProfile(profileView(document),id,new Date().toISOString(),{name,period});
  const encoded=JSON.stringify(record)+'\n',sha=crypto.createHash('sha256').update(encoded).digest('hex');
  const root=path.resolve('site/rider-profiles'),relative='rider-profiles/'+id+'/'+sha+'.json',file=path.resolve('site',relative);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==encoded)throw new Error('Immutable snapshot differs');}
  else fs.writeFileSync(file,encoded,{flag:'wx'});
  const current=path.join(root,'current.json'),index=fs.existsSync(current)?JSON.parse(fs.readFileSync(current,'utf8')):{schema_version:1,players:{}};
  index.players[id]={player_id:id,name:record.name,period:record.period,path:relative,sha256:sha};
  fs.writeFileSync(current,JSON.stringify(index)+'\n');
  console.log('OFFICIAL RIDER PROFILE SAVED',id,record.name,record.meetings.length,'meetings',record.techniques?.unit);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
