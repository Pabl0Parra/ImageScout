const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const {Readable} = require('node:stream');

function safeTitle(query) {
  let title = String(query || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80).trim();
  if (!title) return 'Image';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(title)) title = `Image ${title}`.slice(0,80);
  return title[0].toUpperCase() + title.slice(1);
}

async function saveUniqueImage(directory, query, buffer) {
  const base = path.resolve(directory);
  await fs.mkdir(base, {recursive:true});
  const title = safeTitle(query);
  for (let n=1; n<1000000; n++) {
    const file = path.join(base, `${title} (${n}).png`);
    let handle;
    try { handle = await fs.open(file,'wx'); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    try { await handle.writeFile(buffer); await handle.close(); return file; }
    catch (error) { await handle.close().catch(()=>{}); await fs.unlink(file).catch(()=>{}); throw error; }
  }
  throw new Error('Too many images with this title. Try a different search title.');
}

class LibraryStore {
  constructor(file) { this.file = file; this.pending = Promise.resolve(); }
  async read() {
    try {
      const records = JSON.parse(await fs.readFile(this.file,'utf8'));
      if (!Array.isArray(records)) throw new Error('Saved image library is invalid.');
      return records;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async list() { await this.pending; return this.read(); }
  add(record) {
    const operation = this.pending.then(async()=> {
      const records = await this.read();
      const next = [record, ...records.filter(item=>item.id !== record.id)];
      await fs.mkdir(path.dirname(this.file), {recursive:true});
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary,JSON.stringify(next,null,2),'utf8');
        await fs.rename(temporary,this.file);
      } finally { await fs.unlink(temporary).catch(()=>{}); }
      return record;
    });
    this.pending = operation.catch(()=>{});
    return operation;
  }
}

async function searchImages(query, apiKey, {fetchImpl=fetch, signal}={}) {
  if (!String(query || '').trim()) return [];
  if (!apiKey || !apiKey.trim()) throw new Error('Add your SerpApi key in Settings to search.');
  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams({engine:'google_images',q:query,api_key:apiKey,safe:'active'}).toString();
  const timeout = AbortSignal.timeout(30000);
  const combined = signal ? AbortSignal.any([signal,timeout]) : timeout;
  let response, payload;
  try {
    response = await fetchImpl(url.toString(),{signal:combined,redirect:'error'});
    if (response.status===401 || response.status===403) throw new Error('KEY');
    if (response.status===429) throw new Error('QUOTA');
    if (!response.ok) throw new Error('HTTP');
    payload = await response.json();
  } catch (error) {
    if (signal?.aborted) throw new Error('Search cancelled.');
    if (timeout.aborted) throw new Error('Search timed out. Please try again.');
    if (error.message==='KEY') throw new Error('SerpApi rejected your key. Check it in Settings.');
    if (error.message==='QUOTA') throw new Error('SerpApi search quota reached. Check your plan or try again later.');
    throw new Error('Search failed. Check your network connection and try again.');
  }
  if (payload.error) {
    if (/key|unauthorized/i.test(payload.error)) throw new Error('SerpApi rejected your key. Check it in Settings.');
    if (/limit|quota|credit|run out/i.test(payload.error)) throw new Error('SerpApi search quota reached. Check your plan.');
    if (/no results|hasn.t returned any/i.test(payload.error)) return [];
    throw new Error('SerpApi could not complete this search. Try another search.');
  }
  const originals = new Set();
  return (payload.images_results || []).filter(item=>{
    if (!/^https?:\/\//i.test(item.original || '') || originals.has(item.original)) return false;
    originals.add(item.original); return true;
  }).map(item=>({
    id:createHash('sha256').update(item.original).digest('hex').slice(0,20),
    title:String(item.title || query),url:item.original,thumbnail:item.thumbnail || item.original,
    source:String(item.source || ''),width:Number(item.original_width)||0,height:Number(item.original_height)||0
  }));
}

function isPublicAddress(address) {
  if (net.isIP(address)===4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) || (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0 || (b===88 && c===99))) || (a===198 && (b===18 || b===19 || b===51)) || (a===203 && b===0 && c===113));
  }
  // Permit global unicast IPv6 only, excluding transition/documentation ranges.
  const lower = address.toLowerCase();
  return net.isIP(address)===6 && /^[23]/.test(lower) && !/^(2001:(?:db8|0|2|10|20):|2002:)/.test(lower);
}

async function publicUrl(input, lookupImpl, signal) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Use a public HTTP or HTTPS image URL.'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public HTTP or HTTPS image URL.');
  const host = url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if (host==='localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Only public image addresses are allowed.');
  const addresses = net.isIP(host) ? [{address:host,family:net.isIP(host)}] : await abortable(lookupImpl(host,{all:true}),signal);
  if (!addresses.length || addresses.some(item=>!isPublicAddress(item.address))) throw new Error('Only public image addresses are allowed.');
  return {url,addresses};
}

function abortable(operation, signal) {
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new Error('Image download timed out.'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(operation).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}

function pinnedRequest(url, addresses, signal, requestImpl) {
  return new Promise((resolve,reject)=>{
    const host=url.hostname.replace(/^\[|\]$/g,'');
    const request=requestImpl || (url.protocol==='https:' ? https.request : http.request);
    const connection=request(url,{
      signal,agent:false,
      servername:net.isIP(host) ? undefined : host,
      // DNS has already been checked. Never resolve the hostname again at connect time.
      lookup:(_hostname,options,callback)=>{
        const pinned=addresses.map(item=>({address:item.address,family:net.isIP(item.address)}));
        if (options?.all) callback(null,pinned);
        else callback(null,pinned[0].address,pinned[0].family);
      },
      headers:{accept:'image/*','accept-encoding':'identity','user-agent':'ImageScout/1.0'}
    },response=>{
      const status=response.statusCode || 500;
      resolve({status,ok:status>=200 && status<300,headers:new Headers(response.headers),body:Readable.toWeb(response)});
    });
    connection.on('error',reject);
    connection.end();
  });
}

async function downloadImage(input, {fetchImpl,maxBytes=20*1024*1024,lookupImpl=dns.lookup,requestImpl}={}) {
  const signal = AbortSignal.timeout(30000);
  let current = input;
  for (let hop=0; hop<6; hop++) {
    const {url,addresses} = await publicUrl(current,lookupImpl,signal);
    const response = fetchImpl
      ? await fetchImpl(url.toString(),{signal,redirect:'manual'})
      : await pinnedRequest(url,addresses,signal,requestImpl);
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Image server returned an invalid redirect.');
      current = new URL(location,url).toString(); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Image server refused the download. Try another image.'); }
    if (!/^image\//i.test(response.headers.get('content-type')||'')) { await response.body?.cancel(); throw new Error('This URL did not return an image.'); }
    if (Number(response.headers.get('content-length'))>maxBytes) { await response.body?.cancel(); throw new Error('Image is too large to download.'); }
    if (!response.body) throw new Error('Image download was empty.');
    const reader = response.body.getReader();
    const chunks=[]; let size=0;
    try {
      while (true) {
        const {done,value}=await reader.read(); if(done) break;
        size+=value.byteLength;
        if (size>maxBytes) throw new Error('Image is too large to download.');
        chunks.push(Buffer.from(value));
      }
    } catch(error) { await reader.cancel().catch(()=>{}); throw error; }
    finally { reader.releaseLock(); }
    if (!size) throw new Error('Image download was empty.');
    return Buffer.concat(chunks,size);
  }
  throw new Error('Image server redirected too many times.');
}

module.exports = {safeTitle,saveUniqueImage,LibraryStore,searchImages,downloadImage};
