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
const BUILD = "28/08 13:15 · a830e77";
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

/* AVISO NO CELULAR (26/08/2026)
   ---------------------------------------------------------------------
   Pedido do dono: quem tem o painel instalado como aplicativo recebe um
   aviso a cada caminhão que entra na portaria, a cada saída, e quando a
   programação do dia termina.

   MOSTRAR ALGUMA COISA SEMPRE. Se um `push` chega e nenhuma notificação
   aparece, o navegador entende que o site está usando push escondido e
   pode cancelar a inscrição — no iPhone isso é regra dura. Por isso o
   `catch` no fim não é zelo: é o que impede o aparelho de ser
   desinscrito por causa de um pacote mal formado. Aviso genérico é ruim;
   ficar sem nenhum aviso, para sempre, é pior.

   IMAGEM: o `icon` é o que aparece grande, e o `badge` é o desenho
   monocromático da barra de status do Android. O mesmo arquivo serve nos
   dois — não há um ícone monocromático próprio, e um badge ausente vira
   um quadrado cinza genérico. */
self.addEventListener('push', (evento) => {
  let dados = {};
  try {
    dados = evento.data ? evento.data.json() : {};
  } catch {
    dados = {};
  }
  const titulo = dados.titulo || 'Embarque Suinco';
  const opcoes = {
    body: dados.corpo || '',
    // Agrupa: um aviso novo da MESMA placa substitui o anterior em vez de
    // empilhar dois iguais na tela.
    tag: dados.tag || 'suinco',
    renotify: true,
    icon: './assets/logo_suinco.png',
    badge: './assets/logo_suinco.png',
    data: { url: dados.url || './index.html' },
    // Sem vibração personalizada: o pátio é barulhento e cada aparelho
    // tem o padrão que o dono escolheu. Não é lugar de inventar.
  };
  evento.waitUntil((async () => {
    /* COM O PAINEL NA FRENTE, O CELULAR FICA QUIETO (pedido do dono,
       27/08/2026): se alguma janela do painel está visível, a própria
       tela já mostra a movimentação em tempo real — subir notificação
       por cima é ruído. O push existe pro app FECHADO ou em segundo
       plano. Pular o showNotification com janela visível é permitido
       pelos navegadores (a regra dura do iPhone vale para push sem
       NADA visível — janela em foco conta como visível). */
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (janelas.some((j) => j.visibilityState === 'visible')) return;
    await self.registration.showNotification(titulo, opcoes)
      .catch(() => self.registration.showNotification('Embarque Suinco', {
        body: 'Há movimento novo no pátio.',
        tag: 'suinco',
      }));
  })());
});

/* Tocar no aviso abre o painel — reaproveitando a janela que já estiver
   aberta em vez de abrir outra. Quem trabalha o turno inteiro com o
   aplicativo aberto não quer uma aba nova a cada caminhão. */
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = (evento.notification.data && evento.notification.data.url) || './index.html';
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) {
        if ('focus' in j) return j.focus();
      }
      return self.clients.openWindow(destino);
    })
  );
});

/* O navegador troca o endereço de inscrição sozinho de vez em quando
   (rodízio de chave do serviço de push). Quando isso acontece, o endereço
   guardado no servidor deixa de valer e o aparelho para de receber, em
   silêncio. Este evento é o único aviso que existe disso — o painel
   reinscreve na próxima abertura, e o endereço velho morre sozinho pela
   contagem de falhas do servidor. */
self.addEventListener('pushsubscriptionchange', (evento) => {
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      janelas.forEach((j) => j.postMessage({ tipo: 'reinscrever-avisos' }));
    })
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
