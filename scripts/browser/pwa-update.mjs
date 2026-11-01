/* global window, caches */
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=resolve('apps/admin-web/dist');let version='one';
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('{}');return;}let path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}try{if(!(await stat(path)).isFile())path=resolve(root,'index.html');}catch{path=resolve(root,'index.html');}let body=await readFile(path);if(pathname==='/sw.js'){body=Buffer.from(body.toString().replace(/const CACHE = PREFIX \+ "[^"]+";/,`const CACHE = PREFIX + "pwa-update-${version}";`));res.setHeader('Cache-Control','no-store');}res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(body);}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/login`);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.evaluate(()=>window.__unsaved='kept');
version='two';await page.evaluate(async()=>{await(await navigator.serviceWorker.ready).update();});await page.getByRole('button',{name:'Update app',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__unsaved),'kept');
page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Update app',exact:true}).click();assert.equal(await page.evaluate(()=>window.__unsaved),'kept');assert(await page.evaluate(async()=>!!(await navigator.serviceWorker.ready).waiting));
page.once('dialog',d=>d.accept());await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Update app',exact:true}).click()]);assert.equal(await page.evaluate(()=>window.__unsaved),undefined);await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.some(k=>k.endsWith('pwa-update-two'))&&!keys.some(k=>k.endsWith('pwa-update-one'));});
version='three';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('button',{name:'Update app',exact:true}).waitFor();await page.reload();await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.some(k=>k.endsWith('pwa-update-three'))&&!keys.some(k=>k.endsWith('pwa-update-two'));});
console.log('PWA update lifecycle passed: refresh automatically activates a waiting update;  waiting prompt, no forced reload, cancel preserves edits, accepted update activates, old cache removed, foreground update detected.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
