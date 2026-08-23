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

/* CARIMBO DO BUILD — reescrito por build_arquivo_unico.py a cada geração.

   Existe por um motivo específico e já observado em produção: o navegador
   só instala um service worker novo se os BYTES do sw.js mudarem. Enquanto
   esta linha era fixa ('suinco-v1'), 44 deploys seguidos de index.html não
   mexeram em nada aqui — então nenhum SW novo era instalado, `skipWaiting`
   e `clients.claim` nunca rodavam, `controllerchange` nunca disparava, e a
   recarga automática descrita em index_suinco.html simplesmente não
   acontecia. Quem ficava com a aba aberta o turno inteiro (o caso normal no
   pátio) seguia na versão velha sem nenhum sinal disso.

   Com o carimbo aqui dentro, todo build muda este arquivo, o navegador
   instala o SW novo e a auto-atualização funciona como está documentada.
   Trocar o nome do cache junto é de propósito: o `activate` apaga os caches
   de versões anteriores, e com isso a cópia velha do index.html sai de cena
   em vez de sobreviver a um deploy. */
const BUILD = "23/08 19:00 · 89955e2";
const VERSAO = 'suinco-' + BUILD;
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

  // Outra origem: não é nossa para gerenciar (o painel não carrega mais
  // script de CDN de terceiro desde a saída do MSAL/SharePoint).
  if (url.origin !== self.location.origin) return;

  // Navegação (abrir/recarregar a página) ignora o cache HTTP do próprio
  // navegador, não só o Cache Storage: sem isso, "network-first" podia
  // devolver uma cópia do disco que o navegador considerava "fresca" pelos
  // headers padrão, e o deploy novo só aparecia depois de um F12 manual.
  const opcoesFetch = req.mode === 'navigate' ? { cache: 'no-store' } : undefined;

  evento.respondWith(
    fetch(req, opcoesFetch)
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
