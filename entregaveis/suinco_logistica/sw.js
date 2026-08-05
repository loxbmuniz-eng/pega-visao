/* Service Worker do Embarque Suinco.

   ESTRATÉGIA — e por que esta e não outra
   ---------------------------------------
   Painel: **network-first com queda para cache**. O pátio muda o tempo
   todo; servir a tela do cache primeiro mostraria carga que já saiu. A rede
   vem antes, e o cache existe para quando ela falha — que no pátio acontece
   várias vezes por turno.

   API: **nunca cacheada**. Resposta de API guardada em cache é a receita
   para o porteiro ver o pátio de meia hora atrás e achar que é agora. Quem
   cuida de operar sem rede é a fila offline do adaptador, que grava e sobe
   depois — não o cache do navegador.

   O QUE ISTO NÃO FAZ
   ------------------
   Não deixa o painel funcionar offline "de verdade" na primeira visita: o
   usuário precisa ter aberto pelo menos uma vez com rede. Depois disso, a
   tela abre offline e a fila cuida das gravações. */

const VERSAO = 'suinco-v1';
const ESSENCIAIS = [
  './',
  './index.html',
  './manifest.webmanifest',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      // addAll falha inteiro se UM arquivo falhar. Aqui isso é ruim: perder
      // o cache todo porque o manifest deu 404 no deploy não ajuda ninguém.
      .then((cache) => Promise.allSettled(ESSENCIAIS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;

  // Só GET. POST/PATCH são gravação — deixar passar direto é o correto, e
  // a fila offline do painel cuida do que não sobe.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // A API fica fora do cache, sempre. Ver comentário do topo.
  if (url.hostname.startsWith('api.') || url.pathname.startsWith('/api/')
      || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/socket.io/')) {
    return;
  }

  // Outra origem (CDN do MSAL, por exemplo): não é nossa para gerenciar.
  if (url.origin !== self.location.origin) return;

  evento.respondWith(
    fetch(req)
      .then((resposta) => {
        // Guarda uma cópia para o próximo acesso sem rede. `clone()` é
        // obrigatório: o corpo da resposta só pode ser lido uma vez.
        if (resposta && resposta.ok && resposta.type === 'basic') {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(req, copia)).catch(() => {});
        }
        return resposta;
      })
      .catch(() => caches.match(req).then((cacheada) => {
        if (cacheada) return cacheada;
        // Navegação sem rede e sem cache da URL exata: devolve o painel.
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
