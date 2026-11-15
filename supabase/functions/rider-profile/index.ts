import {parseHTML} from 'npm:linkedom@0.18.12';
import {profileView,parseProfile} from './parser.mjs';
import {readProfileHtml} from './source.mjs';
import {allowedCardUrl,readCardHtml,countRows,matchCounts} from './counts.mjs';
const cache=new Map<string,{at:number,value:unknown}>(), pending=new Map<string,Promise<unknown>>();
let active=0;
const headers={'Access-Control-Allow-Origin':'https://itaingtr.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods':'GET,OPTIONS','Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return reply({error:'method'},405);
  if(request.headers.get('Origin') && request.headers.get('Origin')!=='https://itaingtr.github.io')return reply({error:'origin'},403);
  const params=new URL(request.url).searchParams,id=params.get('player_id')||'',source=params.get('card_url'),car=params.get('car_number');
  if(!/^\d{6}$/.test(id))return reply({error:'invalid_player'},400);
  try{if(source)allowedCardUrl(source);if(car&&!/^[1-9]$/.test(car))throw new Error('car');}catch{return reply({error:'invalid_card'},400);}
  const key=[id,source||'',car||''].join('|');
  const cached=cache.get(key);if(cached && Date.now()-cached.at<15*60000)return reply(cached.value);
  if(!pending.has(key)){
    if(active>=6)return reply({error:'busy'},429);
    const promise=(async()=>{active++;try{
      const html=await readProfileHtml(id),{document}=parseHTML(html);
      const value=parseProfile(profileView(document),id,new Date().toISOString());
      if(source)try{
        const {document:card}=parseHTML(await readCardHtml(source));
        value.counts=matchCounts(countRows(card,source,new Date().toISOString()),value,car);
      }catch{/* A failed count refresh must retain the separate checked stock. */}
      cache.delete(key);cache.set(key,{at:Date.now(),value});if(cache.size>128)cache.delete(cache.keys().next().value!);
      return value;
    }finally{active--;}})();
    pending.set(key,promise);
  }
  try{return reply(await pending.get(key));}catch{return reply({error:'source_unavailable'},502);}finally{pending.delete(key);}
});
