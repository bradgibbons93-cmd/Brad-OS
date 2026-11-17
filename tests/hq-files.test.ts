import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { HqFiles } from '../server/hq-files.ts';
import { createApp } from '../server/app.ts';
import { openDb } from '../server/db.ts';
import { ensureWorkspaces } from '../server/seed.ts';
import type { HqConfig } from '../src/lib/hq.ts';
const roots:string[]=[];
const root=()=>{const p=mkdtempSync(join(tmpdir(),'hq-'));roots.push(p);return p;};
afterEach(()=>roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
const project=(boundary:'work'|'family')=>({slug:boundary,title:boundary,eyebrow:'',summary:'',subtitle:'',accent:'#fff',status:'',boundary,links:[],assets:[]});
const config:HqConfig={projects:{work:project('work'),family:project('family')}};
const pack=(extra:Record<string,Uint8Array>={})=>zipSync({'index.html':strToU8('<h1>Source</h1>'),'manifest.json':strToU8(JSON.stringify({title:'Source',logoPath:'img/a.png',assets:[{path:'img/a.png',name:'A',category:'Campaign',type:'image'}]})),'img/a.png':new Uint8Array([1,2,3]),'clip.mp4':new Uint8Array([0,1,2,3,4,5]),...extra});
const stream=(b:Uint8Array)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(b);c.close();}});
describe('private HQ archives',()=>{
 it('scopes import grants to one destination and consumes them after use',async()=>{
  const store=new HqFiles(root()),token=store.issue('work','library','work');
  expect(store.grant(token,'family','library')).toBeNull();
  expect(store.grant(token,'work','elsewhere')).toBeNull();
  expect((await store.import(token,'work','library',stream(pack()))).assets).toBe(1);
  expect(store.grant(token,'work','library')).toBeNull();
  expect(store.config(config,'work').projects.work.assets[0].url).toBe('/api/hq-files/work/library/img/a.png');
  expect(store.config(config,'work').projects.work.logoPreview).toBe('/api/hq-files/work/library/img/a.png');
  expect(store.file('work','library','../manifest.json')).toBeNull();
 });
 it('rejects zip traversal and absent asset bytes',async()=>{
  const store=new HqFiles(root());
  await expect(store.import(store.issue('work','bad','work'),'work','bad',stream(pack({'../escape.txt':strToU8('bad')})))).rejects.toThrow('Unsupported archive path');
  const bad=zipSync({'index.html':strToU8('x'),'manifest.json':strToU8(JSON.stringify({title:'bad',assets:[{path:'missing.png',name:'x',type:'image',category:'x'}]}))});
  await expect(store.import(store.issue('work','missing','work'),'work','missing',stream(bad))).rejects.toThrow('missing');
 });
 it('filters family content at the server and requires login before minting upload grants',async()=>{
  const db=openDb(':memory:');ensureWorkspaces(db);
  const app=createApp({db,password:'test-pass',sessionSecret:'test-secret-test-secret',hqDataDir:root(),hqConfigJson:JSON.stringify(config)});
  expect((await app.request('/api/hq-config')).status).toBe(401);
  const login=await app.request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-brad-os':'1'},body:JSON.stringify({password:'test-pass'})});
  const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const data=await (await app.request('/api/hq-config',{headers:{cookie}})).json();
  expect(Object.keys(data.projects)).toEqual(['work']);
  expect((await app.request('/api/hq-import-token',{method:'POST',headers:{cookie,'x-brad-os':'1','content-type':'application/json'},body:JSON.stringify({slug:'family',section:'source'})})).status).toBe(403);
  expect((await app.request('/api/hq-files/family/source/index.html',{headers:{cookie}})).status).toBe(403);
  const grant=await (await app.request('/api/hq-import-token',{method:'POST',headers:{cookie,'x-brad-os':'1','content-type':'application/json'},body:JSON.stringify({slug:'work',section:'source'})})).json();
  const uploaded=await app.request('/api/hq-import/work/source',{method:'POST',headers:{'authorization':'Bearer '+grant.token,'x-brad-os':'1','content-type':'application/zip'},body:new Uint8Array(pack())});
  expect(uploaded.status).toBe(200);
  const page=await app.request('/api/hq-files/work/source/index.html',{headers:{cookie}});
  expect(page.status).toBe(200);
  expect(page.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
  expect(await page.text()).toContain('<h1>Source</h1>');
  const range=await app.request('/api/hq-files/work/source/clip.mp4',{headers:{cookie,range:'bytes=1-3'}});
  expect(range.status).toBe(206);expect(range.headers.get('content-range')).toBe('bytes 1-3/6');expect([...new Uint8Array(await range.arrayBuffer())]).toEqual([1,2,3]);
  expect((await app.request('/api/hq-files/work/source/clip.mp4',{headers:{cookie,range:'bytes=10-20'}})).status).toBe(416);
  expect((await app.request('/api/hq-files/work/source/index.html')).status).toBe(401);

  db.close();
 });
});
