import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import type { HqConfig, HqProject } from '../src/lib/hq.ts';

const part = /^[a-zA-Z0-9_-]{1,100}$/;
const allowed = new Set(['.html','.css','.js','.json','.webp','.png','.jpg','.jpeg','.gif','.svg','.mp4','.webm','.woff','.woff2','.pdf','.txt','.md']);
const manifestSchema = z.object({
  title: z.string().max(200),
  assets: z.array(z.object({path:z.string().max(300),name:z.string().max(300),category:z.string().max(100),type:z.enum(['image','video','document']),note:z.string().max(2000).default(''),launchPick:z.boolean().optional()})).max(500).default([]),
  launch: z.object({statement:z.string().max(1000),description:z.string().max(3000),caption:z.string().max(5000),guardrail:z.string().max(2000),steps:z.array(z.object({eyebrow:z.string().max(200),title:z.string().max(300),text:z.string().max(3000),assetPath:z.string().max(300).optional(),caption:z.string().max(5000).optional()})).max(30)}).optional(),
});
function safePath(path: string) { return path.length < 400 && path.split('/').every(p => /^[a-zA-Z0-9_. -]+$/.test(p) && p !== '.' && p !== '..'); }
const mime: Record<string,string> = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.woff':'font/woff','.woff2':'font/woff2','.pdf':'application/pdf','.txt':'text/plain','.md':'text/plain'};

export class HqFiles {
  root: string;
  tokens = new Map<string,{slug:string;section:string;boundary:'work'|'family';until:number}>();
  constructor(root: string) { this.root=root; mkdirSync(root,{recursive:true}); }
  issue(slug:string,section:string,boundary:'work'|'family') {
    if (!part.test(slug)||!part.test(section)) throw new Error('Invalid archive name');
    for (const [t,v] of this.tokens) if(v.until<Date.now()) this.tokens.delete(t);
    const token=randomBytes(32).toString('hex'); this.tokens.set(token,{slug,section,boundary,until:Date.now()+15*60_000}); return token;
  }
  grant(token:string,slug:string,section:string) {
    const t=this.tokens.get(token); return t && t.until>Date.now() && t.slug===slug && t.section===section ? t : null;
  }
  async import(token:string,slug:string,section:string,body:ReadableStream<Uint8Array>|null) {
    if (!this.grant(token,slug,section)||!body) throw new Error('Invalid import grant');
    this.tokens.delete(token);
    const reader=body.getReader(), chunks:Uint8Array[]=[]; let length=0;
    for (;;) { const {done,value}=await reader.read(); if(done)break; length+=value.length; if(length>150_000_000){await reader.cancel();throw new Error('Archive exceeds 150 MB');} chunks.push(value); }
    const packed=new Uint8Array(length);let at=0;for(const b of chunks){packed.set(b,at);at+=b.length;}
    let total=0,count=0;
    const files=unzipSync(packed,{filter:f=>{total+=f.originalSize;count++;if(total>400_000_000||count>1000)throw new Error('Archive expansion limit');return !f.name.endsWith('/');}});
    for(const [path,b] of Object.entries(files))if(!safePath(path)||!allowed.has(extname(path).toLowerCase())||b.length>100_000_000)throw new Error('Unsupported archive path');
    if(!files['manifest.json']||!files['index.html'])throw new Error('Archive needs index.html and manifest.json');
    const manifest=manifestSchema.parse(JSON.parse(new TextDecoder().decode(files['manifest.json'])));
    for(const a of manifest.assets)if(!safePath(a.path)||!files[a.path])throw new Error('An asset is missing from the archive');
    files['manifest.json']=new TextEncoder().encode(JSON.stringify({...manifest,importedAt:new Date().toISOString()}));
    const parent=join(this.root,slug);mkdirSync(parent,{recursive:true});
    const temp=join(parent,'.incoming-'+randomBytes(8).toString('hex')),dest=join(parent,section),backup=join(parent,'.previous-'+section);
    mkdirSync(temp,{recursive:true});
    try { for(const [path,b] of Object.entries(files)){const p=join(temp,path);mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,b);} if(existsSync(backup))rmSync(backup,{recursive:true});if(existsSync(dest))renameSync(dest,backup);renameSync(temp,dest); }
    catch(e){rmSync(temp,{recursive:true,force:true});throw e;}
    return {files:Object.keys(files).length,assets:manifest.assets.length,title:manifest.title};
  }
  config(base:HqConfig,boundary:'work'|'family'):HqConfig {
    const projects:Record<string,HqProject>={};
    for(const [slug,p] of Object.entries(base.projects??{})){
      if(p.boundary!==boundary)continue;
      const project=structuredClone(p);project.archivePages=[];
      const dir=join(this.root,slug);
      if(existsSync(dir))for(const section of readdirSync(dir).filter(s=>part.test(s))){
        try {const m=manifestSchema.parse(JSON.parse(readFileSync(join(dir,section,'manifest.json'),'utf8')));const prefix=`/api/hq-files/${slug}/${section}/`;
          project.archivePages.push({title:m.title,url:prefix+'index.html',section});
          const assets=m.assets.map(a=>({key:section+'/'+a.path,name:a.name,type:a.type,category:a.category,status:'Stored on Railway',note:a.note,url:prefix+a.path,thumbnailUrl:a.type==='image'?prefix+a.path:undefined,previewUrl:a.type==='video'?prefix+a.path:undefined,launchPick:a.launchPick}));
          if(m.launch){project.launch={...m.launch,steps:m.launch.steps.map(s=>({...s,assetUrl:s.assetPath && safePath(s.assetPath)?prefix+s.assetPath:undefined}))};project.assets.forEach(a=>{a.launchPick=false;});}
          const names=new Set(assets.map(a=>a.name.toLowerCase().replace(/[^a-z0-9]/g,'')));
          project.assets=[...assets,...project.assets.filter(a=>!names.has(a.name.toLowerCase().replace(/[^a-z0-9]/g,'')))];
        }catch{ /* An incomplete import is never displayed. */ }
      }
      projects[slug]=project;
    }
    return {projects};
  }
  file(slug:string,section:string,path:string) {
    if(!part.test(slug)||!part.test(section)||!safePath(path)||!allowed.has(extname(path).toLowerCase()))return null;
    const file=join(this.root,slug,section,path);if(!existsSync(file))return null;
    return {body:readFileSync(file),type:mime[extname(path).toLowerCase()]||'application/octet-stream'};
  }
}
