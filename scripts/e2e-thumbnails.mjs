// Local end-to-end check of the thumbnail feature against the PRODUCTION build.
// Usage:  npm run build && node scripts/e2e-thumbnails.mjs
// Uses the DATABASE_URL in .env (point it at a LOCAL/staging database, never production),
// seeds a throw-away user/session/files, starts `next start` on :3999 and a LOCAL fake
// DBByte API on :4010 (no real DBByte credentials or network are used), then cleans up.
// It proves OUR code against the DBByte API shape; it does NOT prove real DBByte/CDN behaviour.
import http from "http";
import crypto from "crypto";
import { spawn } from "child_process";
import { createRequire } from "module";
const require = createRequire(process.cwd()+"/");
const { Pool } = require("pg");
const sharp = require("sharp");
const fs = require("fs");
const dbUrl = fs.readFileSync(process.cwd()+"/.env","utf8").match(/DATABASE_URL=(.*)/)[1].trim();
const pool = new Pool({ connectionString: dbUrl });

const bucket = new Map(); let uploads = 0, deletes = 0;
const fake = http.createServer((req,res)=>{
  const chunks=[]; req.on("data",c=>chunks.push(c)); req.on("end", async ()=>{
    const url=new URL(req.url,"http://x"); res.setHeader("Content-Type","application/json");
    if(req.headers.authorization!=="Bearer e2e-key"){res.statusCode=401;return res.end('{"error":"bad"}');}
    if(req.method==="POST" && url.pathname==="/storage/e2e-bucket/upload"){
      const f=(await new Request("http://x",{method:"POST",headers:{"content-type":req.headers["content-type"]},body:Buffer.concat(chunks)}).formData()).get("file");
      bucket.set(f.name,Buffer.from(await f.arrayBuffer())); uploads++;
      return res.end(JSON.stringify({success:true,key:"k_"+f.name,name:f.name,size:f.size,mimeType:f.type,fileId:"x"}));
    }
    const m=url.pathname.match(/^\/storage\/e2e-bucket\/delete\/(.+)$/);
    if(req.method==="DELETE"&&m){deletes++; return res.end(bucket.delete(decodeURIComponent(m[1]))?'{"success":true}':(res.statusCode=404,'{"error":"nf"}'));}
    res.statusCode=404;res.end("{}");
  });
});
await new Promise(r=>fake.listen(4010,"127.0.0.1",r));

const tag="e2e"+Date.now();
const mk=async(n)=>{const {rows:[u]}=await pool.query("insert into users(telegram_id) values($1) returning id",[`${tag}_${n}`]);
  const tok=crypto.randomBytes(32).toString("base64url");
  await pool.query("insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 day')",[u.id,crypto.createHash("sha256").update(tok).digest("hex")]);
  const {rows:[f]}=await pool.query("insert into files(user_id,title,smart_link_slug,is_published,file_type) values($1,$2,$3,true,'image') returning id",[u.id,"F"+n,`${tag}${n}`]);
  return {uid:u.id,tok,fid:f.id,slug:`${tag}${n}`};};
const A=await mk("a"), B=await mk("b");

const srv=spawn("npx",["next","start","-p","3999"],{cwd:process.cwd(),env:{...process.env,DBBYTE_API_KEY:"e2e-key",DBBYTE_BUCKET:"e2e-bucket",DBBYTE_CDN_BASE_URL:"https://cdn.example.test/pub",DBBYTE_API_BASE_URL:"http://127.0.0.1:4010",ADMIN_TELEGRAM_IDS:`${tag}_a`}});
let log=""; srv.stdout.on("data",d=>log+=d); srv.stderr.on("data",d=>log+=d);
for(let i=0;i<60;i++){try{if((await fetch("http://127.0.0.1:3999/api/health")).ok)break;}catch{} await new Promise(r=>setTimeout(r,500));}

const base="http://127.0.0.1:3999"; const results=[]; const ok=(n,c,extra="")=>{results.push([c,n,extra]);};
const ck=(u)=>({cookie:`onfile_session=${u.tok}`});
const form=(buf,name="t.jpg",type="image/jpeg")=>{const f=new FormData();f.append("file",new File([buf],name,{type}));return f;};
const jpg=await sharp({create:{width:2000,height:1000,channels:3,background:"#3366cc"}}).jpeg().toBuffer();
const jpg2=await sharp({create:{width:300,height:300,channels:3,background:"#cc3333"}}).jpeg().toBuffer();

let r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"POST",body:form(jpg)});
ok("unauthenticated upload -> 401",r.status===401,r.status);
r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"POST",headers:{...ck(B)},body:form(jpg)});
ok("other creator's file -> 404",r.status===404,r.status);
r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"POST",headers:{"x-telegram-id":`${tag}_a`,"x-user-id":String(A.uid)},body:form(jpg)});
ok("spoofed telegram/user id headers w/o session -> 401",r.status===401,r.status);
r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"POST",headers:{...ck(B),"x-telegram-id":`${tag}_a`,"x-user-id":String(A.uid)},body:form(jpg)});
ok("spoofed ids with another user's session -> 404",r.status===404,r.status);
r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"POST",headers:{...ck(A)},body:form(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),"x.png","image/png")});
ok("SVG renamed .png -> 415",r.status===415,r.status+" "+(await r.text()).slice(0,80));
r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"POST",headers:{...ck(A)},body:form(Buffer.alloc(4*1024*1024+1024,1))});
ok(">4MB upload -> 413",r.status===413,r.status);
ok("no DBByte upload happened for rejected requests",uploads===0,uploads);

r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"POST",headers:{...ck(A)},body:form(jpg)});
let j=await r.json(); const url1=j.thumbnail?.url;
ok("owner upload -> 200 + webp, 1280 max",r.status===200&&j.thumbnail.mimeType==="image/webp"&&j.thumbnail.width===1280&&j.thumbnail.height===640,JSON.stringify(j.thumbnail));
ok("response is no-store",r.headers.get("cache-control")==="private, no-store");
ok("URL is {cdn}/{bucket}/thumb-uid-fid-version.webp",new RegExp(`^https://cdn.example.test/pub/e2e-bucket/thumb-${A.uid}-${A.fid}-[0-9a-f]{16}\\.webp$`).test(url1||""),url1);
ok("DBByte bucket holds 1 object, which is webp",bucket.size===1&&(await sharp([...bucket.values()][0]).metadata()).format==="webp");

r=await fetch(`${base}/api/files`,{headers:ck(A)}); j=await r.json();
ok("My Library list includes thumbnailUrl",j.files?.[0]?.thumbnailUrl===url1,j.files?.[0]?.thumbnailUrl);
r=await fetch(`${base}/api/link/${A.slug}`); j=await r.json();
ok("File Access (public link API) returns the same thumbnailUrl",j.file?.thumbnailUrl===url1);
ok("public link API leaks no password/telegram ids",!JSON.stringify(j).includes(`${tag}_`)&&!("password" in j.file));

r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"POST",headers:{...ck(A)},body:form(jpg2)});
j=await r.json(); const url2=j.thumbnail?.url;
ok("replace -> new versioned URL",r.status===200&&url2&&url2!==url1);
ok("old object deleted only after replace, 1 object left",bucket.size===1&&deletes===1,`bucket=${bucket.size} deletes=${deletes}`);
r=await fetch(`${base}/api/files`,{headers:ck(A)}); j=await r.json();
ok("library immediately shows new URL",j.files[0].thumbnailUrl===url2);

r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"DELETE",headers:ck(B)});
ok("other creator DELETE -> 404, thumbnail intact",r.status===404&&bucket.size===1,r.status);
r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"DELETE"});
ok("unauthenticated DELETE -> 401",r.status===401);
r=await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"DELETE",headers:ck(A)});
ok("owner DELETE -> 200, object removed",r.status===200&&bucket.size===0);
r=await fetch(`${base}/api/files`,{headers:ck(A)}); j=await r.json();
ok("library no longer references the thumbnail",j.files[0].thumbnailUrl===null);
r=await fetch(`${base}/api/link/${A.slug}`); j=await r.json();
ok("file access page no longer references it",j.file.thumbnailUrl===null);

// whole-file delete cleans the object
await fetch(`${base}/api/files/${A.fid}/thumbnail`,{method:"POST",headers:{...ck(A)},body:form(jpg)});
ok("re-upload works",bucket.size===1);
r=await fetch(`${base}/api/files/${A.fid}`,{method:"DELETE",headers:ck(A)});
ok("deleting the FILE removes thumbnail object too",r.status===200&&bucket.size===0,`bucket=${bucket.size}`);

// admin
r=await fetch(`${base}/api/admin/storage`,{headers:ck(B)}); ok("admin API: non-admin -> 403",r.status===403,r.status);
r=await fetch(`${base}/api/admin/storage`); ok("admin API: anonymous -> 401",r.status===401,r.status);
r=await fetch(`${base}/api/admin/storage`,{headers:ck(A)}); j=await r.json();
ok("admin API: admin -> 200, manual/unknown labelling, no official API",r.status===200&&j.officialUsageApiAvailable===false&&j.metrics.every(m=>m.source==="unknown")&&j.estimated.source==="estimated",JSON.stringify(j.metrics.map(m=>m.source)));
r=await fetch(`${base}/api/admin/storage`,{method:"PUT",headers:{...ck(A),"content-type":"application/json"},body:JSON.stringify({metric:"storage_bytes",used:19*2**30,limit:20*2**30})}); j=await r.json();
ok("admin PUT 95% -> restricted, uploads blocked",r.status===200&&j.overallLevel==="restricted"&&j.uploadsBlocked===true,j.overallLevel);
// need a fresh file for an upload attempt
const {rows:[f3]}=await pool.query("insert into files(user_id,title,smart_link_slug,is_published) values($1,'x',$2,true) returning id",[A.uid,tag+"c"]);
const before=uploads;
r=await fetch(`${base}/api/files/${f3.id}/thumbnail`,{method:"POST",headers:{...ck(A)},body:form(jpg)}); j=await r.json();
ok("upload while restricted -> 503 uploads_paused, DBByte untouched",r.status===503&&j.code==="uploads_paused"&&uploads===before,r.status+" "+j.code);
await pool.query("delete from storage_usage_manual");
r=await fetch(`${base}/api/files/${f3.id}/thumbnail`,{method:"POST",headers:{...ck(A)},body:form(jpg)});
ok("upload after usage cleared -> 200",r.status===200,r.status);
r=await fetch(`${base}/api/user/me`,{headers:ck(A)}); j=await r.json(); ok("/api/user/me still works & flags admin",r.status===200&&j.user.isAdmin===true);
r=await fetch(`${base}/api/user/me`,{headers:ck(B)}); j=await r.json(); ok("/api/user/me non-admin isAdmin=false",j.user.isAdmin===false);
r=await fetch(`${base}/f/${A.slug}`); ok("/f/[slug] page renders 200",r.status===200,r.status);
r=await fetch(`${base}/admin/storage`); ok("/admin/storage page renders 200 (data gated by API)",r.status===200);

// cleanup
for(const u of [A,B]){await pool.query("delete from files where user_id=$1",[u.uid]);await pool.query("delete from sessions where user_id=$1",[u.uid]);await pool.query("delete from users where id=$1",[u.uid]);}
await pool.query("delete from thumbnail_failures where user_id in ($1,$2)",[A.uid,B.uid]);
srv.kill("SIGTERM"); fake.close(); await pool.end();
let bad=0; for(const [c,n,e] of results){console.log((c?"PASS":"FAIL")+"  "+n+(c?"":"   <= "+e)); if(!c)bad++;}
console.log(`\n${results.length-bad}/${results.length} passed`);
if(bad){console.log("--- server log tail:\n"+log.slice(-1500));}
process.exit(bad?1:0);
