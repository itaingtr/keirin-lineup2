import {parseHTML} from 'npm:linkedom@0.18.12';
import {profileView,parseProfile} from './parser.mjs';
import {readProfileHtml} from './source.mjs';
const cache=new Map<string,{at:number,value:unknown}>(), pending=new Map<string,Promise<unknown>>();
let active=0;
const headers={'Access-Control-Allow-Origin':'https://itaingtr.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods':'GET,OPTIONS','Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return reply({error:'method'},405);
  if(request.headers.get('Origin') && request.headers.get('Origin')!=='https://itaingtr.github.io')return reply({error:'origin'},403);
  const id=new URL(request.url).searchParams.get('player_id')||'';
  if(!/^\d{6}$/.test(id))return reply({error:'invalid_player'},400);
  const cached=cache.get(id);if(cached && Date.now()-cached.at<15*60000)return reply(cached.value);
  if(!pending.has(id)){
    if(active>=6)return reply({error:'busy'},429);
    const promise=(async()=>{active++;try{
      const html=await readProfileHtml(id),{document}=parseHTML(html);
      const value=parseProfile(profileView(document),id,new Date().toISOString());
      cache.delete(id);cache.set(id,{at:Date.now(),value});if(cache.size>128)cache.delete(cache.keys().next().value!);
      return value;
    }finally{active--;}})();
    pending.set(id,promise);
  }
  try{return reply(await pending.get(id));}catch{return reply({error:'source_unavailable'},502);}finally{pending.delete(id);}
});
