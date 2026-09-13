'use strict';
const CACHE='soccerbotstudio-admin-shell-v1';
const ROOT=new URL('./',self.location.href);
const SHELL=['./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png'].map(path=>new URL(path,ROOT).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('soccerbotstudio-admin-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
 const shellPage=new URL('./index.html',ROOT).href;
 if(event.request.mode==='navigate'&&(url.pathname===ROOT.pathname||url.pathname===new URL(shellPage).pathname)){
  event.respondWith(fetch(event.request).then(response=>{
   if(!response.ok)throw new Error('Navigation unavailable');
   const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(shellPage,copy)));return response;
  }).catch(()=>caches.match(shellPage)));return;
 }
 if(SHELL.includes(url.href))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
