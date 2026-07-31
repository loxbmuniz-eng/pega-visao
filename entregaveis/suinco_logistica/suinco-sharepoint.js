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
    powerAutomateArquivamento: ''
  };

  function estaConfigurado(){
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
        cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false }
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
  const GRAPH = 'https://graph.microsoft.com/v1.0';

  async function api(caminho, opcoes){
    const t = await token();
    const resp = await fetch(`${GRAPH}/sites/${SP_CONFIG.siteId}/${caminho}`, Object.assign({
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
    return Object.assign({}, registro, {
      Operador_ID: (operador && (operador.email || operador.nome)) || 'não identificado',
      Operador_Setor: (operador && operador.setor) || '—',
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
  function enfileirar(lista, registro){
    const f = lerFila();
    f.push({ lista, registro, em: new Date().toISOString() });
    gravarFila(f);
  }
  function pendentes(){ return lerFila().length; }

  async function drenarFila(){
    if(estado !== 'online') return { enviados:0, restantes:pendentes() };
    let f = lerFila(), enviados = 0;
    while(f.length){
      const item = f[0];
      try{
        await api(itens(item.lista), { method:'POST', body: JSON.stringify({ fields: item.registro }) });
        f.shift(); gravarFila(f); enviados++;
      }catch(e){
        console.warn('[Suinco] Fila interrompida, tentará de novo:', e.message);
        break;
      }
    }
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

  /* ================== 7. LEITURA ================== */
  async function pull(listaLogica, filtroOData){
    const lista = SP_CONFIG.listIds[listaLogica];
    const q = filtroOData ? `?expand=fields&$filter=${encodeURIComponent(filtroOData)}&$top=999`
                          : '?expand=fields&$top=999';
    const r = await api(itens(lista) + q);
    return ((r && r.value) || []).map(i => i.fields || i);
  }

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
    if(ok) await drenarFila();
    return { modo: estado };
  }

  return {
    SP_CONFIG, iniciar, estaConfigurado,
    estado: ()=>estado,
    conta: ()=>conta,
    aoMudarEstado,
    push, pull, drenarFila, pendentes, arquivarDia
  };
})();
