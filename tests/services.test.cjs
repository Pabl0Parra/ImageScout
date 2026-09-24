const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let services = {};
try { services = require('../electron/services.cjs'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
test('titles are readable and safe Windows filenames', () => {
  assert.equal(typeof services.safeTitle, 'function');
  assert.equal(services.safeTitle('monkey'), 'Monkey');
  assert.equal(services.safeTitle(' ../a:b? '), 'A b');
  assert.equal(services.safeTitle('CON'), 'Image CON');
  assert.equal(services.safeTitle('...'), 'Image');
  assert.ok(services.safeTitle('a'.repeat(100)).length <= 80);
});
test('simultaneous saves never overwrite and stay in directory', async () => {
  assert.equal(typeof services.saveUniqueImage, 'function');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scout-save-'));
  try {
    const files = await Promise.all(Array.from({ length: 8 }, (_, i) => services.saveUniqueImage(dir, 'monkey', Buffer.from(String(i)))));
    assert.equal(new Set(files).size, 8);
    assert.deepEqual((await fs.readdir(dir)).sort(), Array.from({length:8}, (_,i)=>`Monkey (${i+1}).png`));
    assert.deepEqual(await Promise.all(files.map(p=>fs.readFile(p,'utf8'))), Array.from({length:8},(_,i)=>String(i)));
  } finally { await fs.rm(dir, {recursive:true,force:true}); }
});
test('library serializes writes and survives reopening', async () => {
  assert.equal(typeof services.LibraryStore, 'function');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scout-library-'));
  try {
    const file = path.join(dir, 'library.json');
    const store = new services.LibraryStore(file);
    assert.deepEqual(await store.list(), []);
    await Promise.all(Array.from({length:12},(_,i)=>store.add({id:String(i),query:'monkey',title:'Monkey',path:`${i}.png`,preview:'data:image/png;base64,AA=='})));
    assert.equal((await new services.LibraryStore(file).list()).length,12);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('search builds Google Images request and normalizes results', async () => {
  assert.equal(typeof services.searchImages,'function');
  const result = await services.searchImages('monkey', 'private-key', {fetchImpl:async (url)=> {
    const u = new URL(url); assert.equal(u.searchParams.get('engine'),'google_images'); assert.equal(u.searchParams.get('q'),'monkey');
    return Response.json({images_results:[{position:1,title:'Monkey',original:'https://example.com/a.png',thumbnail:'https://example.com/thumb.png',source:'Example',original_width:500,original_height:300}]});
  }});
  assert.equal(result[0].url,'https://example.com/a.png'); assert.equal(result[0].width,500);
});
test('search failures are actionable and do not reveal secrets', async () => {
  assert.equal(typeof services.searchImages,'function');
  await assert.rejects(services.searchImages('monkey','secret',{fetchImpl:async()=>Response.json({error:'secret'},{status:401})}), /key/i);
  await assert.rejects(services.searchImages('monkey','secret',{fetchImpl:async()=>{throw Error('https://url?api_key=secret');}}),e=>!e.message.includes('secret') && /network/i.test(e.message));
});
test('download rejects private addresses and redirects to private destinations', async () => {
  assert.equal(typeof services.downloadImage,'function');
  for (const url of ['file:///tmp/x','http://127.0.0.1/x','http://10.1.2.3/x','http://[::1]/x','http://[::ffff:127.0.0.1]/x','http://localhost/x']) {
    await assert.rejects(services.downloadImage(url,{fetchImpl:async()=>{throw Error('must not fetch');}}), /public|http/i);
  }
  await assert.rejects(services.downloadImage('https://8.8.8.8/a',{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'http://192.168.1.1/x'}})}), /public/i);
});
test('download checks MIME and bounds streamed data', async () => {
  assert.equal(typeof services.downloadImage,'function');
  const url='https://8.8.8.8/a';
  await assert.rejects(services.downloadImage(url,{fetchImpl:async()=>new Response('html',{headers:{'content-type':'text/html'}})}), /image/i);
  await assert.rejects(services.downloadImage(url,{maxBytes:3,fetchImpl:async()=>new Response('1234',{headers:{'content-type':'image/png'}})}), /large/i);
  assert.equal((await services.downloadImage(url,{fetchImpl:async()=>new Response('123',{headers:{'content-type':'image/png'}})})).toString(),'123');
});
test('duplicate image originals produce one stable result', async () => {
  const result = await services.searchImages('monkey','secret',{fetchImpl:async()=>Response.json({images_results:[{original:'https://example.com/a.png'},{original:'https://example.com/a.png'}]})});
  assert.equal(result.length,1);
});
test('download pins resolved public address into connection lookup and retains TLS hostname', async () => {
  const {EventEmitter}=require('node:events');
  const {Readable}=require('node:stream');
  let resolutions=0, connections=0;
  const result = await services.downloadImage('https://images.example/photo.png',{
    lookupImpl:async()=>{resolutions++;return [{address:resolutions===1?'8.8.8.8':'127.0.0.1',family:4}];},
    requestImpl:(url,options,onResponse)=>{
      connections++;
      assert.equal(url.hostname,'images.example');
      assert.equal(options.servername,'images.example');
      options.lookup('images.example',{all:true},(error,addresses)=>{
        assert.ifError(error); assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);
      });
      const request=new EventEmitter();
      request.end=()=>{
        const response=Readable.from([Buffer.from('PNG')]);
        response.statusCode=200; response.headers={'content-type':'image/png'};
        onResponse(response);
      };
      return request;
    }
  });
  assert.equal(result.toString(),'PNG'); assert.equal(resolutions,1); assert.equal(connections,1);
});
