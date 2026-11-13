import { parseHTML } from 'npm:linkedom@0.18.12';
import { raceIdentity, parseResult } from './parser.mjs';

const origin = 'https://itaingtr.github.io';
const cache = new Map<string, {at:number; value:unknown}>();
const inflight = new Map<string, Promise<unknown>>();
let active = 0;
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
};
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers});

async function readResult(source:string) {
  const identity = raceIdentity(source), previous = cache.get(identity.source_url);
  if (previous && Date.now()-previous.at < 5000) return previous.value;
  if (inflight.has(identity.source_url)) return inflight.get(identity.source_url);
  if (active >= 8) throw new Error('busy');
  const promise = (async () => {
    active++;
    const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),12000);
    try {
      let url = identity.result_url;
      let response:Response|undefined;
      for (let step=0;step<3;step++) {
        response = await fetch(url,{redirect:'manual',signal:controller.signal,headers:{'Accept':'text/html','User-Agent':'KeirinLineup2/1.0'}});
        if (![301,302,303,307,308].includes(response.status)) break;
        const next = new URL(response.headers.get('Location') || '',url).href;
        if (raceIdentity(next).source_url !== identity.source_url) throw new Error('redirect');
        await response.body?.cancel();
        url = next;
      }
      if (!response?.ok || !response.headers.get('Content-Type')?.includes('text/html')) throw new Error('source');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('source');
      const chunks:Uint8Array[] = [];
      let bytes=0;
      try {
        while (true) {
          const {value,done} = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes>3_000_000) { await reader.cancel();throw new Error('size'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const raw = new Uint8Array(bytes);let offset=0;
      for (const chunk of chunks) { raw.set(chunk,offset);offset+=chunk.byteLength; }
      const {document} = parseHTML(new TextDecoder().decode(raw));
      const value = parseResult(document,source,new Date().toISOString());
      cache.delete(identity.source_url);
      cache.set(identity.source_url,{at:Date.now(),value});
      if (cache.size>64) cache.delete(cache.keys().next().value!);
      return value;
    } finally { clearTimeout(timeout);active--; }
  })();
  inflight.set(identity.source_url,promise);
  try { return await promise; } finally { inflight.delete(identity.source_url); }
}

// The platform verifies the existing project's JWT. No Auth/DB/Storage call is made here.
Deno.serve(async (request:Request) => {
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (request.method !== 'GET') return json({error:'method'},405);
  const caller = request.headers.get('Origin');
  if (caller && caller !== origin) return json({error:'origin'},403);
  const url = new URL(request.url), source = url.searchParams.get('source');
  try { raceIdentity(source); } catch { return json({error:'invalid_race'},400); }
  try { return json(await readResult(source!)); }
  catch (error) { return json({error:error instanceof Error && error.message==='busy'?'busy':'source_unavailable'},error instanceof Error && error.message==='busy'?429:502); }
});
