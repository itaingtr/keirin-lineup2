export function allowedProfileUrl(value, playerId) {
  const url=new URL(value);
  if (url.protocol!=='https:' || !['keirin.jp','www.keirin.jp'].includes(url.hostname) || url.port || url.username || url.password || url.hash) throw new Error('profile source');
  if (url.pathname==='/pc/top' && !url.search) return url.href;
  if (url.pathname==='/pc/racerprofile' && [...url.searchParams].length===1 && url.searchParams.get('snum')===playerId && /^\d{6}$/.test(playerId)) return url.href;
  throw new Error('profile source');
}

export async function readProfileHtml(playerId, fetcher=fetch) {
  if (!/^\d{6}$/.test(playerId)) throw new Error('profile identity');
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),18000);
  let cookie='';
  async function read(url) {
    for (let attempt=0;attempt<3;attempt++) {
      allowedProfileUrl(url,playerId);
      const response=await fetcher(url,{redirect:'manual',signal:controller.signal,headers:{Accept:'text/html','User-Agent':'KeirinLineup2/1.0',...(cookie?{Cookie:cookie}:{})}});
      const cookies=typeof response.headers.getSetCookie==='function'?response.headers.getSetCookie():[];
      if (cookies.length) cookie=cookies.map(value=>value.split(';')[0]).join('; ');
      if ([301,302,303,307,308].includes(response.status)) {
        url=allowedProfileUrl(new URL(response.headers.get('Location')||'',url).href,playerId);
        await response.body?.cancel();continue;
      }
      if (!response.ok) throw new Error('profile unavailable');
      const reader=response.body?.getReader();if(!reader)throw new Error('profile unavailable');
      const chunks=[];let size=0;
      try {
        for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
          if(size>6000000){await reader.cancel();throw new Error('profile size');}chunks.push(value);}
      } finally {reader.releaseLock();}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      return new TextDecoder().decode(bytes);
    }
    throw new Error('profile redirect');
  }
  try {await read('https://keirin.jp/pc/top');return await read('https://keirin.jp/pc/racerprofile?snum='+playerId);}
  finally {clearTimeout(timeout);}
}
