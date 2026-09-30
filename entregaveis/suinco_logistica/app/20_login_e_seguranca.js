/* ---------- login / operador (placeholder até SSO) ---------- */
function detectarTurnoPorHora(){
  const h = new Date().getHours();
  if(h>=6 && h<14) return 'Manhã (06h–14h)';
  if(h>=14 && h<22) return 'Tarde (14h–22h)';
  return 'Noite (22h–06h)';
}
/* O PAINEL PERCEBE SOZINHO QUE O SERVIDOR FICOU PARA TRAS (26/08/2026).
   =====================================================================
   Cobranca do Luis, e ele tem razao: "voce errou e ficou em silencio numa
   operacao rodando".

   O painel sobe sozinho no Vercel; o servidor so muda quando alguem roda o
   atualizar.sh por SSH. Entre os dois ha uma janela em que a tela ja tem o
   botao novo e o servidor ainda nao tem a rota. Em 25 e 26/08 essa janela
   custou tres relatos: o botao de excluir usuario dando "Rota nao
   encontrada", e a montagem do dia acumulando 53 linhas duplicadas porque
   a de-duplicacao dependia de uma migracao que nao tinha subido.

   Nas tres vezes a informacao existia e dependia de EU lembrar de avisar.
   Na terceira eu esqueci — e a operacao rodou o dia inteiro duplicando.

   Isto tira a memoria do caminho. O /health passou a dizer a data da versao
   do servidor; aqui o painel compara com a data da propria build e avisa
   quem pode agir.

   SO PARA QUEM RESOLVE. Administracao e Logistica sao quem pede o
   atualizar.sh; a Portaria nao tem o que fazer com essa informacao, e um
   aviso que a pessoa nao pode atender vira ruido que ela aprende a ignorar.

   MARGEM DE UMA HORA. Publicar o painel e atualizar o servidor nunca
   acontecem no mesmo minuto, e uma diferenca de minutos e o fluxo normal de
   um deploy. O aviso e para a defasagem que ficou — nao para a que esta
   acontecendo agora. */
/* =====================================================================
   AVISO NO CELULAR (26/08/2026)
   ---------------------------------------------------------------------
   Pedido do dono: "eu quero que todos que estiverem com o embarquesuinco
   ligado no celular com atalho direto nos icones do celular como se fosse
   um aplicativo recebam notificacoes push a cada vez que um caminhao
   entrar na portaria ou sair, a cada vez que a programacao for finalizada
   por inteiro".

   O QUE ESTA TELA PRECISA FAZER, e é só isso: dizer com honestidade o que
   está acontecendo. Ligar é um botão; o difícil é o caso em que NÃO dá — e
   aí a tela tem que dizer POR QUE e o que fazer. "Não funcionou" sem
   motivo é o que faz a pessoa desistir e nunca mais tentar.
   ===================================================================== */

/* Espelho da regra do servidor (servicos/avisos.js). Existe para a tela
   poder dizer "você recebe isto" sem chutar. Se um dia a lista de lá
   mudar, esta muda junto — e há teste de tela que reprova se divergirem. */
function _avisosQueEsteSetorRecebe(setor){
  const recebe = [];
  if(['Logística','Administração','Expedição'].includes(setor)){
    recebe.push('🚚 Caminhão entrando na portaria');
  }
  if(['Logística','Administração'].includes(setor)){
    recebe.push('✅ Caminhão que seguiu viagem');
  }
  recebe.push('🏁 Fim da programação do dia');
  return recebe;
}

async function abrirModalAvisos(){
  document.getElementById('modal-avisos').classList.add('open');
  await atualizarModalAvisos();
}

function fecharModalAvisos(){
  document.getElementById('modal-avisos').classList.remove('open');
}

async function atualizarModalAvisos(){
  const caixaLista = document.getElementById('avisos-oquerecebe');
  const caixaEstado = document.getElementById('avisos-estado');
  const botao = document.getElementById('avisos-alternar');
  const btnTeste = document.getElementById('avisos-testar');
  const setor = (DB.operador || {}).setor || '';

  caixaLista.innerHTML = '<strong>O que você recebe, como ' + esc(setor) + ':</strong><br>'
    + _avisosQueEsteSetorRecebe(setor).map(x => '· ' + esc(x)).join('<br>');

  /* `typeof`, e não `window.SuincoSharePoint`: o adaptador é declarado com
     `const` no topo do arquivo, e const de topo NÃO vira propriedade de
     window. Escrito da outra forma, esta tela dizia "painel desatualizado"
     em todos os casos — o teste de tela pegou. */
  const api = (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.avisos) || null;
  if(!api){
    caixaEstado.textContent = 'Este painel está desatualizado. Recarregue a página.';
    botao.hidden = true; btnTeste.hidden = true;
    return;
  }

  /* Ordem das perguntas de propósito: primeiro o que impede o APARELHO
     (que a pessoa resolve sozinha), depois o que impede o SERVIDOR (que
     depende de outra pessoa). Começar pelo servidor faria o dono de um
     iPhone em aba receber "peça para atualizar o servidor" — e ele
     pediria, e continuaria sem funcionar. */
  const impedimento = api.porQueNaoPode();
  if(impedimento){
    caixaEstado.textContent = impedimento;
    botao.hidden = true; btnTeste.hidden = true;
    return;
  }

  let servidor;
  try{
    servidor = await api.estadoNoServidor();
  }catch(e){
    caixaEstado.textContent = 'Não consegui falar com o servidor agora. Tente daqui a pouco.';
    botao.hidden = true; btnTeste.hidden = true;
    return;
  }

  if(!servidor.ligado){
    caixaEstado.textContent = 'O aviso no celular ainda não foi ligado no servidor. '
      + 'É uma configuração de uma vez só — avise a Logística.';
    botao.hidden = true; btnTeste.hidden = true;
    return;
  }

  const ligado = await api.ligadoNesteAparelho();
  botao.hidden = false;
  botao.textContent = ligado ? 'Desligar neste aparelho' : 'Ligar avisos';
  botao.className = ligado ? 'btn btn-sec' : 'btn btn-primary';
  btnTeste.hidden = !ligado;

  if(ligado){
    caixaEstado.textContent = 'Ligado neste aparelho.'
      + (servidor.aparelhos > 1 ? ` Você tem ${servidor.aparelhos} aparelhos recebendo.` : '')
      + (api.ehAplicativoInstalado() ? '' :
         ' Dica: instale o painel na tela de início para o aviso chegar com o navegador fechado.');
  }else{
    caixaEstado.textContent = 'Desligado neste aparelho. '
      + 'Ao ligar, o aparelho vai pedir permissão uma vez.';
  }
}

async function alternarAvisosUI(){
  const api = SuincoSharePoint.avisos;
  const botao = document.getElementById('avisos-alternar');
  botao.disabled = true;
  try{
    if(await api.ligadoNesteAparelho()){
      await api.desligar();
      notify('Avisos desligados neste aparelho.', 'info');
    }else{
      await api.ligar();
      notify('Avisos ligados. Mande um teste para conferir.', 'success');
    }
  }catch(e){
    notify(e.message || 'Não consegui mudar os avisos.', 'error', 9000);
  }finally{
    botao.disabled = false;
    await atualizarModalAvisos();
  }
}

async function testarAvisosUI(){
  const btn = document.getElementById('avisos-testar');
  btn.disabled = true;
  try{
    const r = await SuincoSharePoint.avisos.testar();
    notify(r.enviados
      ? 'Mandei. Se não aparecer em alguns segundos, o aparelho está com os avisos bloqueados.'
      : 'O servidor não achou nenhum aparelho seu inscrito. Ligue os avisos de novo.',
      r.enviados ? 'success' : 'warning', 9000);
  }catch(e){
    notify(e.message || 'Não consegui mandar o teste.', 'error', 9000);
  }finally{
    btn.disabled = false;
  }
}

/* Reinscreve em silêncio quem JÁ tinha ligado.

   Duas coisas quebram uma inscrição sem ninguém perceber: o navegador
   trocar o endereço sozinho (rodízio de chave do serviço de push) e a
   pessoa entrar com outra conta no mesmo aparelho — a inscrição continua
   viva, mas amarrada a quem saiu. Nos dois casos o aviso simplesmente para
   de chegar, sem erro nenhum na tela.

   Por isso isto roda a cada login: se a permissão JÁ foi dada, reinscreve.
   Nunca PEDE permissão sozinho — pedir sem a pessoa ter clicado em nada é
   o caminho mais rápido para um "bloquear" definitivo. */
async function garantirInscricaoDeAvisos(){
  try{
    const api = (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.avisos) || null;
    if(!api) return;
    if(typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if(api.porQueNaoPode()) return;
    await api.ligar();
  }catch(e){
    /* Silêncio de propósito: quem não ligou os avisos não pode ganhar uma
       mensagem de erro sobre eles ao entrar no painel. */
  }
}

/* O service worker avisa quando o endereço de inscrição mudou. */
if(typeof navigator !== 'undefined' && navigator.serviceWorker){
  navigator.serviceWorker.addEventListener('message', (ev)=>{
    if(ev.data && ev.data.tipo === 'reinscrever-avisos') garantirInscricaoDeAvisos();
  });
}

const _FOLGA_DEPLOY_MS = 60 * 60 * 1000;

async function conferirVersaoDoServidor(){
  const setor = (DB.operador || {}).setor;
  if(setor !== 'Administração' && setor !== 'Logística') return;

  const nossoEm = (typeof window !== 'undefined' && window.SUINCO_BUILD_EM) || null;
  if(!nossoEm) return;   // build de desenvolvimento, sem carimbo

  try {
    const r = await fetch(SuincoSharePoint.enderecoDaApi() + '/health');
    if(!r.ok) return;
    const saude = await r.json();
    if(!saude || !saude.versaoEm) return;   // servidor antigo, sem o campo

    const servidor = new Date(saude.versaoEm).getTime();
    const painel   = new Date(nossoEm).getTime();
    if(!Number.isFinite(servidor) || !Number.isFinite(painel)) return;
    if(servidor >= painel - _FOLGA_DEPLOY_MS) return;   // em dia

    const horas = Math.round((painel - servidor) / 3600000);
    const quanto = horas < 24
      ? `${horas} hora(s)`
      : `${Math.round(horas / 24)} dia(s)`;
    notify(
      `O servidor está ${quanto} atrás deste painel (servidor: ${esc(saude.versao)}). `
      + 'Funções novas podem não funcionar até rodar a atualização do servidor '
      + '(atualizar.sh). Avise a TI.',
      'warn', 15000);
  } catch(e){
    /* Sem rede, ou /health fora do ar: silêncio. Este aviso é um extra —
       transformá-lo em mais um erro na tela de quem já está sem conexão
       seria trocar ajuda por barulho. */
  }
}

/* A pergunta única: esta pessoa pode ver a tela de trabalho AGORA?

   Não é "ela já entrou alguma vez" — é "ela tem sessão". Ver ocorrência
   #25. Quem entrou pelo servidor precisa de token; quem escolheu o modo
   local não tem e-mail e não depende de nenhum. */
function temSessaoParaOPainel(){
  if(!DB.operador) return false;
  if(!DB.operador.email) return true;          // modo local, de propósito
  if(typeof SuincoSharePoint === 'undefined'
     || !SuincoSharePoint.sessaoPerdida) return true;
  return !SuincoSharePoint.sessaoPerdida();
}

function abrirLogin(){
  /* Pré-login: o painel some por inteiro (body.pre-login esconde tudo que
     não é a tela de entrada — ver styles.css). Não é só estética: terminal
     de pátio fica ligado o dia todo, e quem ainda não se identificou não
     deve ver carga, placa nem status ao fundo. */
  document.body.classList.add('pre-login');
  const v = document.getElementById('login-versao');
  if(v) v.textContent = 'versão ' + BUILD_ID;
  document.getElementById('modal-operador').classList.add('open');
  /* A FAIXA TEM QUE SAIR AGORA, e não só deixar de nascer.

     A guarda `loginAberto()` em atualizarFaixaOffline só decide o que fazer
     QUANDO ELA É CHAMADA. A faixa nasce numa mudança de estado; se a tela de
     login abre DEPOIS disso, ninguém chama a função de novo e a faixa
     vermelha fica parada por cima do formulário.

     Reproduzido em 31/08/2026, desktop e celular:

         nasceu: True · faixaContinua: True

     O dono, com a operação em andamento: "a faixa ta aparecendo ainda até na
     parte do desktop zuando tudo, as pessoas nao conseguem fazer o proprio
     login". Depois da correção do z-index o toque já chegava no formulário,
     mas uma tarja vermelha escrita "SISTEMA INDISPONÍVEL" em cima da caixa
     de entrada faz qualquer um parar de tentar — e estava certo em parar,
     porque até ontem era verdade.

     Guarda não basta quando o estado pode mudar dos dois lados: quem abre o
     login também precisa avisar. */
  atualizarFaixaOffline('login');
  // Qual formulário aparece não é escolha do usuário: se o servidor está
  // configurado, é e-mail e senha. O modo local fica atrás de um link, para
  // ninguém cair nele por acidente e achar que está compartilhando dados
  // quando não está.
  mostrarLoginServidor();
  const email = document.getElementById('login-email');
  if(email) setTimeout(()=>email.focus(), 60);
}

function mostrarLoginServidor(){
  const srv = document.getElementById('login-servidor');
  const loc = document.getElementById('login-local');
  if(srv) srv.hidden = false;
  if(loc) loc.hidden = true;
  esconderErroLogin();
}

function mostrarLoginLocal(){
  const srv = document.getElementById('login-servidor');
  const loc = document.getElementById('login-local');
  if(srv) srv.hidden = true;
  if(loc) loc.hidden = false;
}

function mostrarErroLogin(msg){
  const el = document.getElementById('login-erro');
  if(!el) { notify(msg, 'warn'); return; }
  el.textContent = msg;
  el.hidden = false;
}

function esconderErroLogin(){
  const el = document.getElementById('login-erro');
  if(el) el.hidden = true;
}

/* Traduz a falha de login para uma frase que diz o que fazer.

   "Servidor não respondeu" era a resposta para quatro problemas diferentes:
   senha certa mas serviço fora, muitas tentativas no mesmo minuto, aparelho
   sem caminho até a API e erro interno do servidor. Quem está no pátio não
   tem como distinguir, e o relato que chega no WhatsApp é sempre o mesmo —
   o que torna o diagnóstico remoto impossível.

   Cada retorno carrega um código curto entre colchetes. Não é decoração: é
   o que o operador fotografa e manda, e o que permite responder sem pedir
   para abrir o console do navegador. */
async function explicarFalhaDeLogin(e){
  /* DOIS 429 DIFERENTES, e confundi-los foi metade do problema do René
     (25/08/2026): a tela dizia "muitas tentativas deste local" para quem
     tinha digitado a senha certa uma vez só.

     BLOQUEIO_TEMPORARIO é da CONTA — cinco senhas erradas nela — e o
     servidor já manda a frase com quantos minutos faltam. Repassar a dele
     é melhor do que inventar uma versão mais vaga aqui.

     LIMITE_LOGIN é do LOCAL, e desde 26/08 só conta senha ERRADA: se esta
     mensagem aparecer para alguém que digitou certo, é defeito, não
     excesso de gente entrando junto. */
  if(e && e.codigo === 'BLOQUEIO_TEMPORARIO'){
    return (e.message || 'Esta conta está bloqueada por alguns minutos.') + ' [CONTA]';
  }
  if(e && e.status === 429){
    return 'Muitas senhas erradas deste local no último minuto. '
         + 'Espere 1 minuto e tente de novo. Se você não errou a senha, '
         + 'avise a Logística — isto não é para acontecer. [LIMITE]';
  }
  if(e && e.status >= 500){
    return `O servidor recebeu o pedido mas falhou (erro ${e.status}). `
         + 'Isso é do servidor, não da sua senha. Avise a Logística. [HTTP'+e.status+']';
  }
  if(e && e.codigo === 'ORIGEM_NAO_AUTORIZADA'){
    // O servidor sabe qual endereço foi barrado e qual é o certo. Repassar a
    // frase dele é melhor do que reescrever aqui uma versão mais vaga.
    return (e.message || 'Endereço não autorizado.') + ' [ENDEREÇO]';
  }
  if(e && e.status === 401){
    return 'E-mail ou senha incorretos. Confira maiúsculas e espaços. [SENHA]';
  }
  if(e && e.status){
    return (e.message || `Erro ${e.status}.`) + ` [HTTP${e.status}]`;
  }

  // Sem status: o pedido não chegou a virar resposta. A sonda separa
  // "seu aparelho não alcança o servidor" de "alcança, mas foi barrado".
  let alcance = 'inalcancavel';
  try{
    if(typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.diagnosticarConexao){
      alcance = await SuincoSharePoint.diagnosticarConexao();
    }
  }catch(err){ /* a sonda nunca deve derrubar a mensagem de erro */ }

  if(alcance === 'filtrado'){
    // A sonda com CORS passou: o servidor aceita este endereço e respondeu.
    // O que caiu foi o envio do login — algo no meio do caminho está
    // barrando. Mandar avisar a Logística aqui seria conselho errado: o
    // problema está na rede ou no computador de quem tenta entrar.
    return 'Este computador alcança o servidor, mas algo está bloqueando o '
         + 'envio do login — normalmente firewall da empresa, antivírus ou '
         + 'extensão do navegador. Teste numa janela anônima ou usando os '
         + 'dados do celular. [FILTRADO]';
  }
  if(alcance === 'alcancavel'){
    return 'O servidor está no ar, mas recusou a entrada vinda deste aparelho. '
         + 'Avise a Logística — não adianta tentar de novo. [BLOQUEIO]';
  }
  if(e && e.motivo === 'timeout'){
    return 'O servidor demorou demais para responder. Verifique a internet '
         + 'deste aparelho e tente de novo. [TEMPO]';
  }
  return 'Este aparelho não está alcançando o servidor. Verifique o Wi-Fi ou '
       + 'os dados móveis; se a internet estiver boa, avise a Logística. [REDE]';
}

/* ---------- TESTE DE CONEXÃO ----------
   Roda no navegador de quem não consegue entrar e mostra em qual etapa a
   requisição morre. Existe porque duas máquinas Windows da mesma empresa
   falharam igual enquanto celulares no 4G entravam normalmente — e a essa
   altura o diagnóstico à distância já tinha virado adivinhação.

   As quatro sondas não são arbitrárias: cada uma remove uma camada.

   1. Alcance bruto (no-cors) — o pacote sai deste aparelho e chega em
      algum lugar? Falhou aqui, é rede, DNS ou o servidor fora.
   2. Leitura permitida (CORS) — o navegador conseguiu LER a resposta?
      Falhou só aqui, o endereço não está autorizado no servidor.
   3. Pedido de permissão (preflight) — o POST com content-type JSON exige
      um OPTIONS antes. Proxy corporativo costuma descartar OPTIONS em
      silêncio. Falhou só aqui, é a rede da empresa filtrando.
   4. Envio simples — o mesmo POST em text/plain não exige OPTIONS. Se esta
      passa e a 3 falha, está provado que o problema é o preflight, e existe
      contorno sem depender da TI.

   Nenhuma sonda envia senha: a 3 e a 4 mandam corpo vazio de propósito, e
   a resposta esperada é justamente a recusa por falta de campos. */
async function sondarConexao(nome, executar){
  const inicio = Date.now();
  try{
    const detalhe = await executar();
    return { nome, ok:true, detalhe, ms: Date.now()-inicio };
  }catch(e){
    return { nome, ok:false, detalhe: (e && e.name ? e.name+': ' : '') + (e && e.message || 'falhou'),
             ms: Date.now()-inicio };
  }
}

async function rodarTesteDeConexao(){
  const caixa = document.getElementById('teste-conexao');
  if(!caixa) return;
  const api = (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.SP_CONFIG.api) || '';
  caixa.hidden = false;
  caixa.innerHTML = '<div class="teste-titulo">Testando…</div>';

  const resultados = [];

  resultados.push(await sondarConexao('1. Alcance até o servidor', async ()=>{
    await fetch(api + '/health', { mode:'no-cors' });
    return 'o pacote chegou';
  }));

  resultados.push(await sondarConexao('2. Leitura permitida (endereço autorizado)', async ()=>{
    const r = await fetch(api + '/health');
    const j = await r.json();
    return 'servidor respondeu · banco ' + (j.banco || '?');
  }));

  resultados.push(await sondarConexao('3. Pedido de permissão (OPTIONS)', async ()=>{
    const r = await fetch(api + '/auth/login', {
      method:'POST', headers:{'content-type':'application/json'}, body:'{}'
    });
    return 'passou · servidor respondeu ' + r.status;
  }));

  resultados.push(await sondarConexao('4. Envio simples (sem OPTIONS)', async ()=>{
    const r = await fetch(api + '/auth/login', {
      method:'POST', headers:{'content-type':'text/plain'}, body:'{}'
    });
    return 'passou · servidor respondeu ' + r.status;
  }));

  const ok = resultados.map(r=>r.ok);
  let conclusao;
  if(!ok[0]){
    conclusao = 'Este aparelho não alcança o servidor. É a internet daqui, '
              + 'o DNS da rede, ou o servidor está fora.';
  } else if(!ok[1] && !ok[2] && !ok[3]){
    /* O pacote chega e NENHUMA resposta pode ser lida.

       Duas causas produzem exatamente isto, e a diferença não está visível
       daqui: ou o endereço deste painel não está autorizado no servidor, ou
       algo entre este aparelho e o servidor está removendo as respostas —
       proxy da empresa, antivírus que inspeciona HTTPS, filtro de rede.

       O desempate é de graça e não precisa de ninguém técnico: se o MESMO
       endereço abre e entra num celular pelo 4G, o servidor está correto e
       o problema é a rede daqui. Foi assim que este caso se resolveu. */
    conclusao = 'O servidor recebe, mas nenhuma resposta consegue chegar '
              + 'inteira neste navegador. Teste o mesmo endereço num celular '
              + 'usando 4G (sem o Wi-Fi da empresa): se lá funcionar, quem '
              + 'está bloqueando é a rede daqui, e a TI precisa liberar '
              + (api || 'o endereço da API') + ' na porta 443 sem inspeção de '
              + 'HTTPS. Se falhar também no 4G, o problema é meu — me mande '
              + 'esta tela.';
  } else if(!ok[1]){
    conclusao = 'O servidor responde mas recusa este endereço. É configuração '
              + 'do servidor — me mande esta tela.';
  } else if(!ok[2] && ok[3]){
    conclusao = 'A rede desta empresa está descartando o pedido de permissão '
              + '(OPTIONS). O envio simples passou — dá para contornar sem '
              + 'depender da TI. Me mande esta tela.';
  } else if(!ok[2] && !ok[3]){
    conclusao = 'A rede alcança o servidor mas bloqueia o envio do login. '
              + 'Firewall ou antivírus da empresa. Precisa liberar '
              + (api || 'o endereço da API') + ' na porta 443.';
  } else {
    conclusao = 'Todas as etapas passaram. Se ainda não entra, o problema é '
              + 'o e-mail ou a senha — não a conexão.';
  }

  const linhas = resultados.map(r=>
    `<div class="teste-linha ${r.ok?'passou':'falhou'}">`
    + `<span class="teste-marca">${r.ok?'✓':'✕'}</span>`
    + `<span class="teste-nome">${esc(r.nome)}</span>`
    + `<span class="teste-detalhe">${esc(r.detalhe)} · ${r.ms}ms</span></div>`).join('');

  caixa.innerHTML = `<div class="teste-titulo">Teste de conexão</div>${linhas}`
    + `<div class="teste-conclusao">${esc(conclusao)}</div>`
    + `<div class="teste-rodape">${esc(api)} · ${esc(location.origin)} · `
    + `${new Date().toLocaleString('pt-BR')}</div>`;
}

/* Login contra o servidor.

   O setor NÃO é enviado nem escolhido: vem no token que o servidor assina, a
   partir do cadastro do operador. É o que fecha o furo de a permissão de
   setor ser decidida pelo cliente. */
async function entrarNoServidor(){
  const email = (document.getElementById('login-email').value || '').trim();
  const senha = document.getElementById('login-senha').value || '';
  const codigo = (document.getElementById('login-codigo') || {}).value || '';
  const botao = document.getElementById('btn-entrar');

  if(!email || !senha){ mostrarErroLogin('Informe e-mail e senha.'); return; }
  if(typeof SuincoSharePoint === 'undefined'){
    mostrarErroLogin('Painel sem conexão configurada. Use "Entrar só neste aparelho".');
    return;
  }

  esconderErroLogin();
  botao.disabled = true;
  botao.textContent = 'Entrando…';

  try{
    const op = await SuincoSharePoint.login(email, senha, codigo);
    // O id vem junto para o painel saber distinguir "eu editei" de "outro
    // editou" — dois operadores podem ter o mesmo primeiro nome.
    DB.operador = { id: op.id, nome: op.nome, setor: op.setor, email: op.email,
      /* O QUE ESTE SETOR PODE GERAR, dito pelo servidor (23/09/2026). É a
         lista que decide qual botão de relatório aparece. Ver
         `podeGerarDocumentoUI` para o que acontece quando ela não vem. */
      documentos: op.documentos,
      turno: detectarTurnoPorHora() };
    SuincoStore.save();

    // Limpa a senha do DOM assim que ela deixa de ser necessária. Terminal de
    // pátio é compartilhado, e campo preenchido é o tipo de coisa que o
    // próximo turno encontra.
    document.getElementById('login-senha').value = '';

    document.getElementById('modal-operador').classList.remove('open');
    revelarPainel();
    atualizarHeaderOperador();
    aplicarPermissoesSetor();
    renderAll();
    notify(`Bem-vindo, ${op.nome}! Setor: ${op.setor}`, 'success');
    conferirVersaoDoServidor();   // sem await: não segura a entrada de ninguém
    garantirInscricaoDeAvisos(); // idem: e nunca pede permissão sozinho
  }catch(e){
    /* SEGUNDO FATOR (etapa 4). O servidor recusa com MFA_NECESSARIO quando
       a senha está certa e falta o código. Revelar o campo só aqui — e não
       de saída — significa que quem não ativou nunca vê um campo que não
       usa, e quem ativou é levado ao passo seguinte sem precisar entender
       nada de segurança. */
    const precisaCodigo = /MFA_NECESSARIO|aplicativo autenticador/i.test(String(e && e.message || ''));
    if(precisaCodigo){
      const bloco = document.getElementById('login-mfa-bloco');
      const campo = document.getElementById('login-codigo');
      if(bloco) bloco.hidden = false;
      if(campo){ campo.value = ''; campo.focus(); }
      mostrarErroLogin('Digite o código do seu aplicativo autenticador.');
    }else{
      const codigoErrado = /MFA_INVALIDO|Código incorreto/i.test(String(e && e.message || ''));
      if(codigoErrado){
        const campo = document.getElementById('login-codigo');
        if(campo){ campo.value = ''; campo.focus(); }
      }
      mostrarErroLogin(await explicarFalhaDeLogin(e));
    }
  }finally{
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}

/* =====================================================================
   PEDIDOS DE APROVAÇÃO — desligado em 25/08/2026
   =====================================================================
   Este card era o outro lado da segunda assinatura: quem pedia para
   restaurar, corrigir etapa ou devolver carga excluída aparecia aqui para
   outro administrador aprovar.

   O dono tirou a exigência ("quem for da administração não precisa da
   autorização de nada") e, com ela, este card perdeu função: não há mais
   pedido nenhum a fazer. Ver o comentário no topo de
   backend/src/rotas/cargas.js para o que a trava protegia e o que ficou
   no lugar dela.

   A função continua existindo e continua sendo chamada de um lugar só —
   para MANTER O CARD ESCONDIDO. Sem isto, o card do HTML voltaria a
   aparecer vazio para quem estivesse com a página aberta. */
async function renderPedidosAprovacaoUI(){
  const card = document.getElementById('card-aprovacoes');
  if(card) card.hidden = true;
}

/* =====================================================================
   SEGUNDO FATOR — a tela de quem ativa o próprio
   =====================================================================
   Etapa 4 do protocolo de segurança (22/08/2026). Fica na aba Usuários,
   porque é onde a pessoa já vai cuidar da própria conta.

   O texto foi escrito para quem nunca ouviu falar de TOTP: a tela fala em
   "aplicativo autenticador" e "código de 6 dígitos", nunca em "segredo
   compartilhado" ou "one-time password". Controle que a pessoa não entende
   é controle que ela contorna. */
async function renderMinhaSegurancaUI(){
  const alvo = document.getElementById('mfa-painel');
  if(!alvo || !SuincoSharePoint.estaConfigurado || !SuincoSharePoint.estaConfigurado()) return;
  let sit;
  try{
    sit = await SuincoSharePoint.mfa.situacao();
  }catch(e){
    // Servidor ainda sem a etapa 4: some em silêncio em vez de mostrar erro
    // para quem não pediu nada.
    alvo.innerHTML = '';
    return;
  }
  if(sit.mfa_ativo){
    alvo.innerHTML = `
      <div class="mfa-ativo">
        <div><strong>Segundo fator ATIVO</strong>${sit.mfa_ativado_em
          ? ` · desde ${esc(fmtDataHora(sit.mfa_ativado_em))}` : ''}</div>
        <div class="card-sub" style="margin:6px 0 10px">
          Restam <strong>${Number(sit.codigos_restantes || 0)}</strong> códigos de recuperação.
          ${Number(sit.codigos_restantes || 0) <= 2
            ? 'Estão acabando — desative e ative de novo para gerar um lote novo.' : ''}
        </div>
        <button class="btn btn-sec btn-sm" onclick="desativarMfaUI()">Desativar segundo fator</button>
      </div>`;
    return;
  }
  alvo.innerHTML = `
    <div class="card-sub">Seu acesso está protegido só pela senha. Com o segundo fator,
      quem descobrir sua senha ainda não entra.</div>
    <button class="btn btn-primary btn-sm" onclick="iniciarMfaUI()">Ativar segundo fator</button>`;
}

/* ATIVAR O SEGUNDO FATOR — com QR, porque é assim que a pessoa faz.

   Pedido do gestor (25/08/2026): "a autenticação de dois fatores eu quero
   pelo Microsoft Authenticator".

   O painel já falava a língua do aplicativo — o que faltava era o QR. Antes,
   a tela pedia que a pessoa achasse "inserir chave manualmente" dentro de um
   menu do aplicativo e digitasse 32 caracteres embaralhados no celular. É o
   passo em que a adesão morre: quem erra dois caracteres não sabe que errou,
   vê "código inválido" e desiste.

   A CHAVE CONTINUA NA TELA, embaixo do QR e sem destaque. Não é redundância
   boba: câmera quebrada, permissão negada, aplicativo de empresa que só
   aceita entrada manual — e QR na tela de computador que o operador acessa
   pelo próprio celular (não dá para fotografar a própria tela). Uma saída
   só é uma saída frágil.

   Se o desenho do QR falhar por qualquer motivo, a tela mostra a chave e
   segue funcionando — nunca um quadrado quebrado no lugar. */
async function iniciarMfaUI(){
  const alvo = document.getElementById('mfa-painel');
  try{
    const r = await SuincoSharePoint.mfa.iniciar();
    const qr = (typeof SuincoQR !== 'undefined' && r.endereco)
      ? SuincoQR.svg(r.endereco, 190) : null;
    alvo.innerHTML = `
      <div class="mfa-passos">
        <div class="mfa-passo"><strong>1.</strong> No celular, abra o
          <strong>Microsoft Authenticator</strong> (ou o Google Authenticator —
          os dois servem e são gratuitos).</div>
        <div class="mfa-passo"><strong>2.</strong> Toque em <em>+</em> →
          <em>Conta corporativa ou de estudante</em> → <em>Ler código QR</em>
          e aponte a câmera para o quadrado abaixo.
          ${qr ? `<div class="mfa-qr">${qr}</div>` : ''}
          <details class="mfa-manual">
            <summary>Não consegue ler o código? Digite a chave</summary>
            <div class="card-sub" style="margin-top:6px">No aplicativo, escolha
              <em>inserir chave manualmente</em> e digite:</div>
            <div class="mfa-segredo">${esc((r.segredo.match(/.{1,4}/g) || []).join(' '))}</div>
            <span class="card-sub">Conta: Embarque Suinco · ${esc((DB.operador||{}).email || '')}</span>
          </details>
        </div>
        <div class="mfa-passo"><strong>3.</strong> Digite abaixo o código de 6 dígitos
          que o aplicativo mostrar:
          <div class="form-row" style="margin-top:8px">
            <input type="text" id="mfa-confirmar-codigo" placeholder="000000" maxlength="6"
                   inputmode="numeric" style="max-width:140px">
            <button class="btn btn-primary btn-sm" onclick="confirmarMfaUI()">Confirmar e ativar</button>
            <button class="btn btn-sec btn-sm" onclick="renderMinhaSegurancaUI()">Cancelar</button>
          </div>
        </div>
      </div>`;
  }catch(e){
    notify('Não consegui iniciar: ' + (e && e.message || 'erro'), 'danger', 6000);
  }
}

async function confirmarMfaUI(){
  const campo = document.getElementById('mfa-confirmar-codigo');
  const codigo = (campo && campo.value || '').trim();
  if(codigo.length !== 6){ notify('Digite os 6 dígitos do aplicativo.', 'warn'); return; }
  try{
    const r = await SuincoSharePoint.mfa.confirmar(codigo);
    const alvo = document.getElementById('mfa-painel');
    /* Os códigos de recuperação aparecem UMA VEZ. Mostrar em bloco grande,
       com o aviso de imprimir, porque a pessoa que fechar esta tela sem
       guardar vai depender de um administrador no dia em que perder o
       celular. */
    alvo.innerHTML = `
      <div class="mfa-recuperacao">
        <div class="mfa-recuperacao-tit">Guarde estes códigos agora — eles não aparecem de novo</div>
        <div class="card-sub">Cada um serve UMA vez, para entrar sem o celular.
          Imprima e guarde fora do aparelho.</div>
        <div class="mfa-codigos">${r.codigosRecuperacao.map(c=>`<span>${esc(c)}</span>`).join('')}</div>
        <div class="form-row" style="margin-top:10px">
          <button class="btn btn-sec btn-sm" onclick="window.print()">Imprimir</button>
          <button class="btn btn-primary btn-sm" onclick="renderMinhaSegurancaUI()">Já guardei</button>
        </div>
      </div>`;
    notify('Segundo fator ativado.', 'success');
  }catch(e){
    notify(e && e.message || 'Código incorreto.', 'danger', 6000);
  }
}

async function desativarMfaUI(){
  const senha = prompt('Confirme sua senha para desativar o segundo fator:');
  if(!senha) return;
  try{
    await SuincoSharePoint.mfa.desativar(senha);
    notify('Segundo fator desativado.', 'warn');
    renderMinhaSegurancaUI();
  }catch(e){
    notify(e && e.message || 'Não consegui desativar.', 'danger', 6000);
  }
}

async function resetarMfaDeUI(id, nome){
  const motivo = prompt(`Por que está removendo o segundo fator de ${nome}?\n`
    + '(fica registrado e avisa os outros administradores)');
  if(!motivo || !motivo.trim()) return;
  try{
    const r = await SuincoSharePoint.mfa.resetarDe(id, motivo.trim());
    notify(r.aviso || 'Segundo fator removido.', 'success', 8000);
    if(typeof renderUsuarios === 'function') renderUsuarios();
  }catch(e){
    notify(e && e.message || 'Não consegui remover.', 'danger', 6000);
  }
}
function confirmarOperador(){
  const nome = document.getElementById('login-nome').value.trim();
  if(!nome){ notify('Informe seu nome.','warn'); return; }
  DB.operador = {
    nome,
    setor: document.getElementById('login-setor').value,
    // Turno deixou de ser perguntado no login (pedido do gestor: menos
    // campos). Continua sendo gravado, agora derivado da hora — o histórico
    // precisa saber em que turno o registro aconteceu, e perguntar isso ao
    // operador nunca acrescentou informação que o relógio já não tivesse.
    turno: detectarTurnoPorHora()
  };
  SuincoStore.save();
  document.getElementById('modal-operador').classList.remove('open');
  revelarPainel();
  atualizarHeaderOperador();
  aplicarPermissoesSetor();
  renderAll();
  notify(`Bem-vindo, ${nome}! Setor: ${DB.operador.setor}`, 'success');
}
function trocarUsuario(){
  DB.operador = null;
  SuincoStore.save();
  // Encerra a sessão no adaptador também. Sem isto o token continuaria
  // válido no aparelho e o próximo operador herdaria a sessão de quem saiu
  // — justamente o problema que terminal compartilhado cria.
  if(typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.sair){
    try{ SuincoSharePoint.sair(); }catch(e){ console.warn('[Suinco] sair:', e); }
  }
  atualizarHeaderOperador();
  abrirLogin();
}
/* Tira o corpo do pré-login e dá uma entrada suave ao painel. A classe de
   animação é temporária de propósito: fica só o tempo do efeito, para não
   re-animar a cada render. `prefers-reduced-motion` é respeitado no CSS. */
function revelarPainel(){
  document.body.classList.remove('pre-login');
  document.body.classList.add('painel-entrando');
  setTimeout(()=>document.body.classList.remove('painel-entrando'), 600);
}

function atualizarHeaderOperador(){
  const el = document.getElementById('operator-name');
  el.textContent = DB.operador ? `${DB.operador.nome} · ${DB.operador.setor}` : '—';
}
// Cada setor vê apenas as próprias abas (SETOR_PERMISSOES em data.js).
// Decisão confirmada pelo usuário: manter a ocultação, não liberar tudo.
// Para operar outro posto — cobertura de turno, por exemplo — usa-se
// "Trocar usuário" no cabeçalho e entra-se com o setor correspondente; o
// modal de login explica isso, para ninguém concluir que a tela não existe.
/* ESTE SETOR PODE GERAR ESTE DOCUMENTO? (23/09/2026)
   ---------------------------------------------------------------
   PEDIDO DO DONO, escolhendo entre três saídas: "a" — esconder o botão que a
   filial não pode usar.

   A REGRA NÃO MORA AQUI. Ela mora em `backend/src/dominio/documentos.js`, e
   quem a aplica de verdade é `podeGerar` na rota do PDF. O painel só RECEBE
   a resposta pronta, no login e na restauração de sessão, e usa para decidir
   o que desenhar. Escrever a lista de setores aqui seria a segunda cópia da
   mesma decisão — e a primeira divergência já custou três ocorrências: a
   Qualidade em 11/09 e as duas filiais em 23/09, todas com o mesmo formato
   (botão visível, servidor respondendo 403).

   LISTA AUSENTE NÃO ESCONDE NADA. Quem entrou por "Entrar só neste aparelho"
   não tem servidor, e um painel ligado a um servidor ainda não atualizado
   também não recebe a lista. Nos dois casos o botão continua aparecendo
   exatamente como aparecia antes desta mudança: quem decide é o servidor, e
   esconder por falta de informação tiraria da Logística um relatório que ela
   sempre teve. Some o botão quando se SABE que ele seria recusado, nunca
   quando não se sabe. */
/* A LISTA NÃO PODE ENVELHECER NA CÓPIA LOCAL. `DB.operador` vem do disco e
   sobrevive a reaberturas; se o dono mudar o que um setor gera, quem não
   fizer login de novo ficaria com a lista de ontem. `iniciar()` já pergunta
   ao servidor quem você é (`/auth/eu`) — aqui só copiamos a resposta por
   cima, e só quando ela existe, para não apagar o que já estava valendo. */
function sincronizarDocumentosDoSetor(){
  if(!DB.operador || typeof SuincoSharePoint === 'undefined') return;
  const conta = SuincoSharePoint.conta && SuincoSharePoint.conta();
  if(!conta || !Array.isArray(conta.documentos)) return;
  const antes = JSON.stringify(DB.operador.documentos || null);
  DB.operador.documentos = conta.documentos;
  if(JSON.stringify(conta.documentos) !== antes) SuincoStore.save();
  aplicarDonosDeDocumentoUI();
}

function podeGerarDocumentoUI(tipo){
  const lista = DB.operador && DB.operador.documentos;
  if(!Array.isArray(lista)) return true;
  return lista.includes(tipo);
}

/* Aplica a lista aos botões marcados com data-documento. A marcação fica no
   HTML, junto do botão, para que acrescentar um relatório novo seja um
   atributo — e não mais uma linha de JavaScript que alguém esquece. */
function aplicarDonosDeDocumentoUI(){
  document.querySelectorAll('[data-documento]').forEach(el=>{
    el.hidden = !podeGerarDocumentoUI(el.dataset.documento);
  });
}

function aplicarPermissoesSetor(){
  if(!DB.operador) return;
  const doSetor = SETOR_PERMISSOES[DB.operador.setor] || [];
  const admin = DB.operador.setor === 'Administração';
  // Comercial não vê nem "Minha segurança" (30/09/2026) — ver SETORES_SEM_MINHA_SEGURANCA.
  const usuariosLiberada = !SETORES_SEM_MINHA_SEGURANCA.includes(DB.operador.setor);
  document.querySelectorAll('.nav-tab').forEach(el=>{
    /* A aba Usuários passa a ser de TODOS (22/08/2026, etapa 4).

       O motivo é o segundo fator: proteger a própria conta não pode ser
       privilégio de quem administra os outros. Quem não é Administração vê
       ali só "Minha segurança" — os cards de gerenciar usuários continuam
       escondidos, e o servidor recusa as rotas de qualquer jeito. */
    const liberada = doSetor.includes(el.dataset.tab)
      || (el.dataset.tab === 'usuarios' && usuariosLiberada);
    el.hidden = !liberada;
  });
  // Dentro da aba Usuários: gerenciar gente é só da Administração.
  document.querySelectorAll('#tab-usuarios .card').forEach(card=>{
    if(card.id === 'card-minha-seguranca') return;
    card.hidden = !admin;
  });
  if(!doSetor.includes(TAB_ATUAL) && !(TAB_ATUAL === 'usuarios' && usuariosLiberada)) irParaTab(doSetor[0] || 'torre');
  // Mesmo funil das abas: quem já chama isto no login, na restauração e na
  // troca de usuário passa a acertar os botões de relatório junto.
  aplicarDonosDeDocumentoUI();
  atualizarAvisoSetorAba();
}

// Abas onde o box "o que se faz aqui" aparece — pedido do usuário
// (08/08/2026): "que essas explicacoes... se apliquem somente aos
// setores portaria expedicao e faturamento relatorio, historico pois
// isso toma um puta espaco". Torre, Programação, Indicadores, Cadastros
// e Usuários perdem o box: são telas que já se explicam pelo próprio
// conteúdo (uma tabela, um formulário, um painel de números), diferente
// de Portaria/Expedição/Faturamento, onde a ação de status não é óbvia
// só olhando a tela.
const ABAS_COM_FUNCAO = new Set(['portaria', 'expedicao', 'faturamento', 'relatorios', 'historico']);

// Preenche, no topo de cada aba permitida, o box que explica a função dela.
function atualizarAvisoSetorAba(){
  document.querySelectorAll('.funcao-aba').forEach(box=>{
    const tab = box.dataset.tab;
    const info = TAB_FUNCAO[tab];
    if(!info || !ABAS_COM_FUNCAO.has(tab)){ box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML =
      `<div class="funcao-linha">` +
        `<span class="funcao-chip">${info.setor}</span>` +
        `<span class="funcao-oque"><strong>O que se faz aqui:</strong> ${info.oque}</span>` +
      `</div>` +
      `<div class="funcao-move"><strong>Efeito no status:</strong> ${info.move}</div>`;
  });
}

/* ---------- A senha de aba foi REMOVIDA ------------------------------
   Programação e Indicadores pediam uma senha fixa, escrita em texto puro
   no próprio arquivo e visível com Ctrl+U. Ela nasceu quando o painel não
   tinha login nenhum e era a única barreira existente.

   Hoje ela só atrapalha. Quem abre essas abas já entrou com e-mail e senha
   individuais, e o setor vem do token assinado pelo servidor: a Programação
   só aparece para quem tem direito a ela, e a API recusa a gravação de quem
   não tem — independentemente do que a tela mostre.

   Manter uma senha compartilhada ao lado disso tinha dois custos e nenhum
   ganho: atrasava quem tem direito de entrar, e ensinava a operação a
   digitar uma senha coletiva que qualquer um lê no código-fonte.

   As funções foram apagadas em vez de esvaziadas para que ninguém volte a
   chamá-las achando que protegem alguma coisa. */

