/* =====================================================================
   SUINCO — Adaptador SharePoint Online / Microsoft 365
   ---------------------------------------------------------------------
   Substitui o armazenamento local por Listas do SharePoint, autenticando
   com SSO corporativo (MSAL.js v2), e alimenta o modelo do Power BI com a
   nomenclatura já usada lá:

       fact_Viagens      <- cargas (a viagem em si)
       fact_StatusFrota  <- cada mudança de status de uma carga
       dim_Veiculos      <- cadastro de frota (placa -> transportadora)
       LOG_EVENTOS       <- trilha de auditoria (quem fez o quê, quando)

   ---------------------------------------------------------------------
   LEIA ANTES DE APRESENTAR ESTE ARQUIVO COMO "JÁ INTEGRADO"
   ---------------------------------------------------------------------
   Este adaptador está completo e funcional, MAS não tem como conectar em
   nenhum tenant enquanto o bloco SP_CONFIG abaixo estiver com os valores
   vazios. Esses três parâmetros só o TI da Suinco pode fornecer, porque
   dependem de provisionamento no Microsoft 365 (ver
   docs/RELATORIO_TI_HOSPEDAGEM.md, seção 9).

   Enquanto não estiver configurado, o painel opera em MODO LOCAL: tudo
   continua funcionando exatamente como antes, gravando no navegador, e a
   interface diz isso claramente no rodapé. Nenhuma tela finge estar
   conectada — foi decisão explícita não exibir "Conectado ao SharePoint"
   sem conexão real, justamente porque quem vai auditar isso é o TI.

   Depois de preencher o SP_CONFIG, nada mais precisa mudar no app: as regras
   de negócio (máquina de estados, trava de frota, indicadores) não sabem
   de onde vêm os dados e não foram tocadas.
===================================================================== */

const SuincoSharePoint = (function(){
  'use strict';

  /* ================== 1. CONFIGURAÇÃO (TI PREENCHE AQUI) ==================
     Os valores abaixo saem do provisionamento descrito no relatório
     técnico. Enquanto qualquer um estiver vazio, o painel permanece em modo
     local — de propósito, para não haver falsa sensação de integração. */
  const SP_CONFIG = {
    // Entra ID -> App registrations -> sua aplicação -> Application (client) ID
    clientId: '',
    // Entra ID -> Directory (tenant) ID
    tenantId: '',
    // ID do site no Graph. Obtém-se com:
    //   GET https://graph.microsoft.com/v1.0/sites/suinco.sharepoint.com:/sites/Logistica
    siteId:   '',
    // Precisa bater com o Redirect URI cadastrado no App registration.
    redirectUri: window.location.origin + window.location.pathname,

    // Nomes das Listas — iguais à nomenclatura do modelo do Power BI, para o
    // conector ler sem renomear nada.
    listIds: {
      cargas:        'fact_Viagens',
      movimentacoes: 'fact_StatusFrota',
      frota:         'dim_Veiculos',
      logs:          'LOG_EVENTOS'
    },

    // Opcional: URL do fluxo do Power Automate que cria /Ano/Mês/Dia/ e
    // arquiva o ciclo. Vazio = o encerramento não apaga nem move nada.
    powerAutomateArquivamento: '',

    // De quanto em quanto tempo o painel busca as mudanças dos outros setores.
    // 15 s é o equilíbrio entre "parece tempo real" e não castigar o tenant:
    // com ~20 pessoas dá cerca de 80 leituras/minuto, muito abaixo do limite.
    intervaloSincroniaMs: 15000,

    // Base da API. Só mude para apontar a um proxy corporativo ou ao servidor
    // de simulação usado nos testes automatizados (ver modoSimulacao).
    graphBaseUrl: 'https://graph.microsoft.com/v1.0',

    /* modoSimulacao — EXCLUSIVO PARA TESTE.
       Quando true, o adaptador NÃO autentica via MSAL e fala direto com
       graphBaseUrl. Existe para provar a operação compartilhada sem depender
       de um tenant real (ver docs/SIMULACAO_MULTIUSUARIO.md).
       Trava de segurança: só tem efeito se graphBaseUrl apontar para
       localhost/127.0.0.1. Apontando para o Graph real, é ignorado e a
       autenticação normal acontece — não há como desligar o SSO em produção
       mexendo nesta chave. */
    modoSimulacao: false
  };

  // A trava de segurança do modoSimulacao, num lugar só.
  function simulando(){
    return SP_CONFIG.modoSimulacao === true
        && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(SP_CONFIG.graphBaseUrl + '/');
  }

  function estaConfigurado(){
    if(simulando()) return !!SP_CONFIG.siteId;
    return !!(SP_CONFIG.clientId && SP_CONFIG.tenantId && SP_CONFIG.siteId);
  }

  /* ================== 2. ESTADO DE CONEXÃO ==================
     Três estados possíveis, e a interface mostra exatamente o que vale:
       'local'    -> sem configuração de TI; grava só no navegador
       'online'   -> autenticado e gravando no SharePoint
       'offline'  -> configurado, mas sem rede: grava local e enfileira */
  let estado = 'local';
  let msalApp = null;
  let conta = null;
  const ouvintes = [];

  function setEstado(novo, detalhe){
    if(estado === novo) return;
    estado = novo;
    ouvintes.forEach(fn=>{ try{ fn(estado, detalhe); }catch(e){ console.error(e); } });
  }
  function aoMudarEstado(fn){ ouvintes.push(fn); fn(estado, null); }

  /* ================== 3. AUTENTICAÇÃO (MSAL v2 / SSO) ================== */
  async function autenticar(){
    if(!estaConfigurado()) { setEstado('local'); return false; }
    if(simulando()){
      conta = { username: 'simulacao@local', homeAccountId: 'sim' };
      setEstado('online');
      return true;
    }
    if(typeof msal === 'undefined'){
      console.warn('[Suinco] MSAL.js não carregou (sem rede ou aberto via file://). Seguindo em modo local.');
      setEstado('local', 'MSAL indisponível');
      return false;
    }
    try{
      msalApp = new msal.PublicClientApplication({
        auth: {
          clientId: SP_CONFIG.clientId,
          authority: `https://login.microsoftonline.com/${SP_CONFIG.tenantId}`,
          redirectUri: SP_CONFIG.redirectUri
        },
        // storeAuthStateInCookie:true — necessário quando o painel roda
        // dentro do iframe do Teams, onde o retorno do redirect nem sempre
        // enxerga o storage da janela.
        // cacheLocation permanece 'sessionStorage', NÃO 'localStorage': nos
        // terminais compartilhados do pátio, token em localStorage sobrevive
        // ao fechamento do navegador e o próximo operador herdaria a sessão
        // do anterior — o que arruinaria justamente a trilha de auditoria que
        // esta integração existe para garantir.
        cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: true }
      });
      await msalApp.initialize();
      const resp = await msalApp.handleRedirectPromise();
      if(resp && resp.account) conta = resp.account;
      if(!conta){
        const contas = msalApp.getAllAccounts();
        if(contas.length) conta = contas[0];
      }
      if(!conta){
        // Dentro do Teams o usuário já está logado: o redirect é silencioso.
        await msalApp.loginRedirect({ scopes: escopos() });
        return false; // a página recarrega
      }
      setEstado('online');
      return true;
    }catch(e){
      console.error('[Suinco] Falha na autenticação:', e);
      setEstado('offline', e.message);
      return false;
    }
  }

  // Escopos do Microsoft Graph.
  // NOTA DE SEGURANÇA para o TI: o rascunho original pedia
  // 'Sites.ReadWrite.All', que dá escrita em TODOS os sites do tenant.
  // Aqui usamos 'Sites.Selected', que limita o acesso ao site de Logística e
  // é o que costuma passar em revisão de segurança. Com Sites.Selected, o
  // administrador ainda precisa conceder a permissão àquele site específico
  // (uma vez, via Graph ou PowerShell) — está descrito no relatório do TI.
  function escopos(){
    return ['https://graph.microsoft.com/Sites.Selected', 'User.Read'];
  }

  async function token(){
    if(simulando()) return 'token-de-simulacao';
    if(!msalApp || !conta) throw new Error('Não autenticado');
    try{
      const r = await msalApp.acquireTokenSilent({ scopes: escopos(), account: conta });
      return r.accessToken;
    }catch(e){
      // Renovação silenciosa falhou (sessão do Windows expirou, por ex.):
      // pede login de novo em vez de travar em silêncio.
      await msalApp.acquireTokenRedirect({ scopes: escopos() });
      throw e;
    }
  }

  /* ================== 4. CHAMADAS À API DO SHAREPOINT ================== */
  async function api(caminho, opcoes){
    const t = await token();
    const resp = await fetch(`${SP_CONFIG.graphBaseUrl}/sites/${SP_CONFIG.siteId}/${caminho}`, Object.assign({
      headers: {
        'Authorization': `Bearer ${t}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    }, opcoes || {}));
    if(resp.status === 401) { setEstado('offline', 'Sessão expirada'); throw new Error('401'); }
    if(resp.status === 403) throw new Error('Sem permissão nesta Lista — falar com o TI.');
    if(!resp.ok) throw new Error(`Graph ${resp.status}`);
    return resp.status === 204 ? null : resp.json();
  }

  const itens = lista => `lists/${lista}/items`;

  /* Campos de rastreabilidade exigidos para o Copilot conseguir responder
     "quem autorizou a saída da placa X às 14h?" — todo registro gravado
     leva o operador e o instante da sincronia. */
  function carimbar(registro, operador){
    // Operador_ID prioriza a identidade AUTENTICADA (UPN/e-mail vindo do
    // MSAL) sobre o nome digitado na tela de login. Diferença que importa
    // para auditoria: o nome digitado é auto-declarado — qualquer pessoa
    // digita qualquer nome —, enquanto o UPN é verificado pelo Entra ID.
    // Numa pergunta como "quem autorizou a saída da placa X às 14h?", a
    // resposta precisa se sustentar. Sem autenticação, cai no nome digitado
    // e fica explícito que é auto-declarado.
    const autenticado = conta && (conta.username || conta.homeAccountId);
    return Object.assign({}, registro, {
      Operador_ID: autenticado
        || (operador && (operador.email || operador.nome) ? `(auto-declarado) ${operador.email || operador.nome}` : 'não identificado'),
      Operador_Nome: (operador && operador.nome) || '',
      Operador_Setor: (operador && operador.setor) || '—',
      Operador_Verificado: !!autenticado,
      Timestamp_Sincronia: new Date().toISOString()
    });
  }

  /* ================== 5. FILA OFFLINE ==================
     A Portaria não pode parar porque o wi-fi do pátio oscilou. Toda escrita
     entra numa fila persistida no navegador; quando a conexão volta, a fila
     é drenada na ordem em que os eventos aconteceram. */
  const FILA_KEY = 'suinco_fila_sync';

  function lerFila(){
    try{ return JSON.parse(localStorage.getItem(FILA_KEY) || '[]'); }
    catch(e){ return []; }
  }
  function gravarFila(f){
    try{ localStorage.setItem(FILA_KEY, JSON.stringify(f)); }catch(e){}
  }
  function enfileirar(lista, registro, campoChave){
    const f = lerFila();
    f.push({ lista, registro, campoChave: campoChave || null, em: new Date().toISOString() });
    gravarFila(f);
  }
  function pendentes(){ return lerFila().length; }

  async function drenarFila(){
    // Não exige estado 'online': quem chama já decidiu que vale tentar. Se a
    // rede continuar fora, a primeira tentativa falha e a fila fica intacta.
    if(estado === 'local') return { enviados:0, restantes:pendentes() };
    let f = lerFila(), enviados = 0;
    while(f.length){
      const item = f[0];
      try{
        if(item.campoChave){
          // Reenvio de upsert: pode ser que outro terminal já tenha criado a
          // linha enquanto este estava offline — por isso procura antes.
          const id = await acharItemId(item.lista, item.campoChave, item.registro[item.campoChave]);
          if(id) await api(`${itens(item.lista)}/${id}`, { method:'PATCH', body: JSON.stringify({ fields: item.registro }) });
          else   await api(itens(item.lista), { method:'POST', body: JSON.stringify({ fields: item.registro }) });
        }else{
          await api(itens(item.lista), { method:'POST', body: JSON.stringify({ fields: item.registro }) });
        }
        f.shift(); gravarFila(f); enviados++;
      }catch(e){
        console.warn('[Suinco] Fila interrompida, tentará de novo:', e.message);
        break;
      }
    }
    if(f.length === 0 && typeof liberarPendencias === 'function') liberarPendencias();
    return { enviados, restantes: f.length };
  }

  /* ================== 6. ESCRITA (local-first) ==================
     Grava SEMPRE no navegador primeiro e devolve na hora; a ida ao
     SharePoint acontece em seguida, sem bloquear a tela.

     Por que local-first e não "await direto no SharePoint": a Portaria
     registra chegada com o caminhão parado na frente dela. Travar o botão
     por 300–800 ms de rede a cada clique — ou pior, perder o registro
     quando a rede cai — seria degradar a operação em nome da arquitetura.
     Assim o registro nunca se perde: ou já foi, ou está na fila. */
  async function push(listaLogica, registro, operador){
    const lista = SP_CONFIG.listIds[listaLogica];
    if(!lista) throw new Error('Lista desconhecida: ' + listaLogica);
    const carimbado = carimbar(registro, operador);
    if(estado !== 'online'){ enfileirar(lista, carimbado); return { enfileirado:true }; }
    try{
      await api(itens(lista), { method:'POST', body: JSON.stringify({ fields: carimbado }) });
      return { enfileirado:false };
    }catch(e){
      enfileirar(lista, carimbado);
      setEstado('offline', e.message);
      return { enfileirado:true, erro:e.message };
    }
  }

  /* ================== 6-b. UPSERT (uma linha por carga) ==================
     A gravação anterior era sempre POST, então cada mudança de status criava
     uma linha NOVA em fact_Viagens — uma carga que percorre os 6 status virava
     6 linhas. Isso quebrava a leitura compartilhada (qual linha é a carga?) e
     obrigaria o Power BI a desduplicar.

     Agora: procura a linha pela chave de negócio, faz PATCH se existir e POST
     se não. O id do item no SharePoint fica em cache para as próximas
     gravações não precisarem procurar de novo. */
  const idsRemotos = new Map();   // "lista::chave" -> id do item no SharePoint

  async function acharItemId(lista, campoChave, valorChave){
    const cacheKey = lista + '::' + valorChave;
    if(idsRemotos.has(cacheKey)) return idsRemotos.get(cacheKey);
    const q = `?$filter=fields/${campoChave} eq '${String(valorChave).replace(/'/g,"''")}'&$top=1`;
    const r = await api(itens(lista) + q);
    const item = r && r.value && r.value[0];
    if(item){ idsRemotos.set(cacheKey, item.id); return item.id; }
    return null;
  }

  async function upsert(listaLogica, campoChave, registro, operador){
    const lista = SP_CONFIG.listIds[listaLogica];
    if(!lista) throw new Error('Lista desconhecida: ' + listaLogica);
    const carimbado = carimbar(registro, operador);
    const valorChave = carimbado[campoChave];
    if(estado !== 'online' || !valorChave){
      enfileirar(lista, carimbado, campoChave);
      return { enfileirado:true };
    }
    try{
      const id = await acharItemId(lista, campoChave, valorChave);
      if(id){
        await api(`${itens(lista)}/${id}`, { method:'PATCH', body: JSON.stringify({ fields: carimbado }) });
      }else{
        const criado = await api(itens(lista), { method:'POST', body: JSON.stringify({ fields: carimbado }) });
        if(criado && criado.id) idsRemotos.set(lista + '::' + valorChave, criado.id);
      }
      return { enfileirado:false };
    }catch(e){
      enfileirar(lista, carimbado, campoChave);
      setEstado('offline', e.message);
      return { enfileirado:true, erro:e.message };
    }
  }

  /* ================== 7. LEITURA ================== */
  async function pull(listaLogica, filtroOData){
    const lista = SP_CONFIG.listIds[listaLogica];
    const q = filtroOData ? `?expand=fields&$filter=${encodeURIComponent(filtroOData)}&$top=999`
                          : '?expand=fields&$top=999';
    const r = await api(itens(lista) + q);
    return ((r && r.value) || []).map(i => i.fields || i);
  }

  /* ================== 7-b. SINCRONIA COMPARTILHADA ==================
     É isto que torna o painel multiusuário: a cada ciclo, busca o estado das
     Listas e entrega a quem chamou. O SharePoint não empurra mudanças para o
     navegador, então a atualização é por consulta periódica — 15 s por padrão.
     Para a operação isso é indistinguível de tempo real: o intervalo é menor
     que o tempo de qualquer ação física no pátio.

     A consulta pede só o que mudou desde a última vez (`Timestamp_Sincronia`),
     o que mantém o tráfego pequeno mesmo com a Lista crescendo — e evita
     esbarrar no limite de 5.000 itens por consulta. */
  let ultimaSincronia = null;
  let timerSincronia = null;
  const ouvintesDados = [];

  function aoReceberDados(fn){ ouvintesDados.push(fn); }

  async function pullTudo(incremental){
    /* A marca do "até quando já li" é tomada ANTES de consultar, não depois.
       Fazendo depois abre-se uma janela de corrida: uma escrita que chega
       entre a consulta e a marcação fica com Timestamp_Sincronia menor que a
       marca, e o filtro `gt` a exclui PARA SEMPRE — a alteração daquele setor
       nunca mais apareceria neste terminal. O defeito só se manifesta com
       vários operadores agindo ao mesmo tempo, que é justamente a operação
       real; foi encontrado na simulação com três navegadores.

       A MARGEM existe pelo mesmo motivo, contra diferença de relógio entre a
       estação e o servidor. Reler alguns registros é inofensivo — a fusão é
       idempotente —, enquanto perder um é permanente. Na dúvida, sobrepor. */
    const MARGEM_MS = 5000;
    const marcaDestaLeitura = new Date(Date.now() - MARGEM_MS).toISOString();
    const filtro = (incremental && ultimaSincronia)
      ? `fields/Timestamp_Sincronia gt '${ultimaSincronia}'` : null;
    const [cargas, movimentacoes, frota] = await Promise.all([
      pull('cargas', filtro).catch(e=>{ console.warn('[Suinco] pull cargas:', e.message); return null; }),
      pull('movimentacoes', filtro).catch(e=>{ console.warn('[Suinco] pull movimentações:', e.message); return null; }),
      // A frota muda raramente: só é buscada na carga inicial.
      incremental ? Promise.resolve(null) : pull('frota', null).catch(()=>null)
    ]);
    if(cargas === null && movimentacoes === null) throw new Error('Falha ao ler do SharePoint');
    ultimaSincronia = marcaDestaLeitura;
    return { cargas: cargas||[], movimentacoes: movimentacoes||[], frota, incremental: !!incremental };
  }

  async function sincronizarAgora(incremental){
    // Roda TAMBÉM quando o estado é 'offline'. Este é o caminho de recuperação:
    // o evento 'online' do navegador só dispara quando a placa de rede volta,
    // e não cobre o caso mais comum — o servidor recusou ou expirou enquanto a
    // rede seguia de pé. Sem isto, um único erro deixava o terminal offline
    // até alguém recarregar a página, com a fila parada.
    if(estado === 'local') return null;
    const estavaOffline = (estado === 'offline');
    try{
      // Offline: uma leitura curta primeiro, para confirmar que voltou antes
      // de despejar a fila inteira contra um servidor possivelmente fora.
      if(estavaOffline) await api(itens(SP_CONFIG.listIds.cargas) + '?$top=1');
      await drenarFila();
      const dados = await pullTudo(incremental);
      if(estado !== 'online') setEstado('online');
      ouvintesDados.forEach(fn=>{ try{ fn(dados); }catch(e){ console.error(e); } });
      return dados;
    }catch(e){
      console.warn('[Suinco] sincronia:', e.message);
      setEstado('offline', e.message);
      return null;
    }
  }

  function iniciarSincroniaPeriodica(){
    if(timerSincronia) clearInterval(timerSincronia);
    timerSincronia = setInterval(()=>{ sincronizarAgora(true); }, SP_CONFIG.intervaloSincroniaMs);
    // Voltar para a aba é o momento em que a informação desatualizada mais
    // incomoda: força uma leitura imediata em vez de esperar o próximo ciclo.
    document.addEventListener('visibilitychange', ()=>{
      if(!document.hidden) sincronizarAgora(true);
    });
  }
  function pararSincronia(){ if(timerSincronia){ clearInterval(timerSincronia); timerSincronia = null; } }

  /* ================== 8. ENCERRAR E ARQUIVAR CICLO ==================
     Dispara o fluxo do Power Automate que cria /Ano/Mês/Dia/ e arquiva a
     lista operacional para o turno seguinte. Sem URL de fluxo configurada,
     apenas devolve o resumo do que seria arquivado — nunca apaga nada por
     conta própria, porque apagar o dia é irreversível. */
  async function arquivarDia(resumo, operador){
    const payload = carimbar({
      Acao: 'ENCERRAR_CICLO',
      Data_Ciclo: new Date().toISOString().slice(0,10),
      Total_Cargas: resumo.total,
      Concluidas: resumo.concluidas,
      Em_Aberto: resumo.emAberto
    }, operador);

    if(!SP_CONFIG.powerAutomateArquivamento){
      return { disparado:false, motivo:'Fluxo do Power Automate não configurado', payload };
    }
    const resp = await fetch(SP_CONFIG.powerAutomateArquivamento, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    if(!resp.ok) throw new Error('Power Automate respondeu ' + resp.status);
    return { disparado:true, payload };
  }

  /* ================== 9. MONITOR DE CONEXÃO ================== */
  function monitorarRede(){
    window.addEventListener('online', async ()=>{
      if(!estaConfigurado()) return;
      const ok = await autenticar();
      if(ok) await drenarFila();
    });
    window.addEventListener('offline', ()=>{
      if(estaConfigurado()) setEstado('offline', 'Sem rede');
    });
  }

  /* ================== 10. INICIALIZAÇÃO ================== */
  async function iniciar(){
    monitorarRede();
    if(!estaConfigurado()){ setEstado('local'); return { modo:'local' }; }
    const ok = await autenticar();
    if(!ok) return { modo: estado };
    await drenarFila();
    const dados = await sincronizarAgora(false);   // carga inicial completa
    iniciarSincroniaPeriodica();
    return { modo: estado, dados };
  }

  return {
    SP_CONFIG, iniciar, estaConfigurado,
    estado: ()=>estado,
    conta: ()=>conta,
    aoMudarEstado,
    push, upsert, pull, pullTudo, drenarFila, pendentes, arquivarDia,
    aoReceberDados, sincronizarAgora, iniciarSincroniaPeriodica, pararSincronia,
    ultimaSincronia: ()=>ultimaSincronia
  };
})();
