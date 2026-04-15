const CACHE='veloce-taller-v1';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.json'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  // Solo cachear mismo origen
  if(url.origin!==location.origin)return;
  e.respondWith(
    caches.match(req).then(cached=>{
      if(cached)return cached;
      return fetch(req).then(resp=>{
        if(resp&&resp.status===200&&resp.type==='basic'){
          const copy=resp.clone();
          caches.open(CACHE).then(c=>c.put(req,copy));
        }
        return resp;
      }).catch(()=>caches.match('./index.html'));
    })
  );
});
