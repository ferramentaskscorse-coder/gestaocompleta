/* Preço Certo — service worker
   Estratégia: REDE PRIMEIRO, cache como reserva.
   Sempre que houver internet, a versão mais nova é usada —
   evita o problema clássico de "publiquei e nada mudou". */

const CACHE = "preco-certo-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // não intercepta as chamadas do Firebase/Google
  const url = e.request.url;
  if (url.includes("googleapis.com") || url.includes("gstatic.com/firebasejs")) return;

  e.respondWith(
    fetch(e.request)
      .then(resp => {
        const copia = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
