/* =====================================================================
   SuincoSharePoint — adaptador para a API própria (Node + PostgreSQL)
   =====================================================================

   Substitui `suinco-sharepoint.js` SEM alterar uma linha de data.js ou
   app.js. Foi para isso que a arquitetura foi montada assim: as regras de
   negócio e a tela nunca falam com o servidor, só com este adaptador. Trocar
   o backend inteiro é trocar um arquivo.

   O nome do objeto continua `SuincoSharePoint` de propósito. Renomear
   obrigaria a mexer nos 14 pontos de chamada em data.js e app.js — mudança
   grande, risco alto, ganho zero. O comentário aqui vale mais que o nome
   bonito.

   O QUE PRECISA CONTINUAR VALENDO (contrato de 7 itens, §1.3 do playbook):

   1. Gravação local primeiro, rede depois. O porteiro registra a chegada com
      o caminhão parado na frente dele; esperar a rede não é opção.
   2. Fila offline persistida, drenada em ordem quando a rede volta.
   3. Upsert por chave de negócio — uma linha por carga, não uma por status.
   4. `_pendente` protege alteração local ainda não confirmada.
   5. Marca de leitura tomada ANTES da consulta (aqui o servidor devolve a
      dele, já com a margem aplicada).
   6. Nunca bloquear a abertura do painel por causa da rede.
   7. Estado honesto no rodapé: online, offline ou local.

   ===================================================================== */

const SuincoSharePoint = (function () {
  'use strict';

  /* ---------------------------------------------------------------
     Configuração
     --------------------------------------------------------------- */
  const SP_CONFIG = {
    // Endereço da API. Em produção é o subdomínio do VPS; rodando local,
    // aponte para http://127.0.0.1:3000.
    api: 'https://api.embarquesuinco.com.br',

    // De quanto em quanto tempo consultar quando o socket está fora do ar.
    // Com o socket ativo isto vira só uma rede de segurança.
    intervaloSincronia: 15000,

    // Deixe false para o painel abrir em modo local, sem tentar a rede.
    ativo: true,
  };

  const CHAVE_TOKEN = 'suinco_token';
  const CHAVE_FILA = 'suinco_fila_api';
  const CHAVE_MARCA = 'suinco_marca_sync';

  let estadoAtual = 'local';        // 'online' | 'offline' | 'local'
  let operadorLogado = null;
  let token = null;
  let socket = null;
  let timerSincronia = null;
  let ultimaMarca = null;
  let ouvintesEstado = [];
  let ouvintesDados = [];
  let ouvintesDescarte = [];
  let ouvintesEdicao = [];
  let ouvintesExclusao = [];

  /* ---------------------------------------------------------------
     Sessão

     O token fica em sessionStorage, não em localStorage. Terminal de pátio
     é compartilhado: com localStorage a sessão do porteiro do turno da
     manhã continuaria válida para quem sentar ali à noite.
     --------------------------------------------------------------- */
  function lerToken() {
    if (token) return token;
    try { token = sessionStorage.getItem(CHAVE_TOKEN); } catch (e) { token = null; }
    return token;
  }

  function guardarToken(t, operador) {
    token = t;
    operadorLogado = operador;
    try { sessionStorage.setItem(CHAVE_TOKEN, t); } catch (e) { /* modo privado */ }
  }

  function limparToken() {
    token = null;
    operadorLogado = null;
    try { sessionStorage.removeItem(CHAVE_TOKEN); } catch (e) { /* ignora */ }
  }

  function estaConfigurado() {
    return SP_CONFIG.ativo && !!SP_CONFIG.api && !!lerToken();
  }

  /* ---------------------------------------------------------------
     Fila offline
     --------------------------------------------------------------- */
  function lerFila() {
    try { return JSON.parse(localStorage.getItem(CHAVE_FILA) || '[]'); }
    catch (e) { return []; }
  }

  function gravarFila(fila) {
    try { localStorage.setItem(CHAVE_FILA, JSON.stringify(fila)); }
    catch (e) { console.warn('[Suinco] fila não coube no armazenamento local'); }
  }

  function enfileirar(item) {
    const fila = lerFila();
    fila.push({ ...item, enfileiradoEm: new Date().toISOString() });
    gravarFila(fila);
    mudarEstado('offline');
    return { enfileirado: true };
  }

  function pendentes() {
    return lerFila().length;
  }

  /* ---------------------------------------------------------------
     HTTP
     --------------------------------------------------------------- */
  /* Timeout de requisição, com queda para o método antigo.

     `AbortSignal.timeout()` é limpo, mas só existe a partir do Safari 16 e
     do Chrome 103. Num Mac com Safari mais antigo ele nem chega a tentar a
     rede: lança TypeError na hora de montar a chamada, e o painel reporta
     "servidor não respondeu" quando o servidor está perfeitamente no ar.

     Difícil de diagnosticar justamente porque a mensagem aponta para o
     lugar errado. O AbortController existe desde 2017 e resolve igual. */
  function sinalDeTimeout(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return { signal: AbortSignal.timeout(ms), cancelar: () => {} };
    }
    if (typeof AbortController === 'undefined') {
      return { signal: undefined, cancelar: () => {} };   // sem timeout, mas funciona
    }
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    return { signal: ctrl.signal, cancelar: () => clearTimeout(id) };
  }

  async function chamar(caminho, opcoes = {}) {
    const t = lerToken();
    const tempo = sinalDeTimeout(opcoes.timeoutMs || 20000);
    let resposta;
    try {
      resposta = await fetch(SP_CONFIG.api + caminho, {
        method: opcoes.metodo || 'GET',
        headers: {
          'content-type': 'application/json',
          ...(t ? { authorization: 'Bearer ' + t } : {}),
        },
        body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
        signal: tempo.signal,
      });
    } catch (e) {
      /* O fetch falhou antes de existir resposta. Sem etiqueta, tudo isso
         chega na tela como "servidor não respondeu" — que é o que estamos
         tentando parar de fazer. Aqui separamos o que dá para separar:
         estouro de tempo tem nome próprio (AbortError), o resto é falha de
         transporte (DNS, TLS, CORS, rede do celular). */
      const abortou = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
      const err = new Error(abortou
        ? 'O servidor não respondeu no tempo limite.'
        : 'Não foi possível alcançar o servidor.');
      err.motivo = abortou ? 'timeout' : 'transporte';
      err.causaOriginal = e;
      throw err;
    } finally {
      // Sem isto o temporizador segura o navegador acordado por 20 s a
      // cada chamada, e são muitas ao longo de um turno.
      tempo.cancelar();
    }

    /* 401 tem DOIS significados, e tratá-los igual confunde o operador.

       No /auth/login quer dizer "e-mail ou senha errados" — não havia sessão
       para expirar, e dizer "sessão expirada" faz quem errou a senha ficar
       procurando o que expirou em vez de reconferir o que digitou.

       Em qualquer outra rota quer dizer que o token venceu ou foi revogado,
       e aí limpar a sessão é o certo: sem isso o painel insiste com um token
       morto e enche a tela de erro a cada 15 s. */
    const eLogin = caminho.startsWith('/auth/login');

    if (resposta.status === 401 && !eLogin) {
      limparToken();
      mudarEstado('local');
      const e = new Error('Sessão expirada. Faça login de novo.');
      e.status = 401;
      throw e;
    }

    const texto = await resposta.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch (e) { /* não era JSON */ }

    if (!resposta.ok) {
      const e = new Error((dados && dados.erro) || `Erro ${resposta.status}`);
      e.status = resposta.status;
      e.codigo = dados && dados.codigo;
      e.dados = dados;
      throw e;
    }
    // 201 e 200 significam coisas diferentes no POST de carga: criada agora
    // ou já existia. Quem precisa dessa distinção pede o status junto.
    return opcoes.comStatus ? { status: resposta.status, dados } : dados;
  }

  /* Distingue "a rede caiu" de "o servidor recusou".

     A diferença decide o que fazer com a gravação: falha de rede vai para a
     fila e sobe depois; recusa do servidor (placa fora da frota, transição
     inválida) NÃO pode ir para a fila — ficaria tentando para sempre uma
     coisa que nunca vai ser aceita. */
  function eFalhaDeRede(e) {
    if (e && e.status) return e.status >= 500 || e.status === 429;
    return true; // TypeError de fetch, AbortError, DNS — tudo isso é rede
  }

  /* Segunda pergunta ao servidor, feita SÓ quando a primeira falhou.

     "Failed to fetch" é a mesma frase para DNS fora, certificado inválido,
     CORS recusado, Wi-Fi caído e servidor parado — o navegador esconde o
     motivo de propósito. Mas dá para reduzir o campo com uma sonda em
     `mode:'no-cors'`: ela não lê a resposta (e por isso não depende de
     CORS), só diz se o pacote chegou em algum lugar.

     - sonda passa  → a rede alcança o servidor; o que quebrou foi a
       permissão de origem (CORS/preflight) ou a rota de login;
     - sonda falha  → não há caminho até api.embarquesuinco.com.br a partir
       deste aparelho: rede, DNS, certificado ou serviço fora.

     É a diferença entre "chama a TI" e "troca de Wi-Fi", e o operador do
     pátio consegue relatar isso pelo WhatsApp sem abrir o console. */
  async function diagnosticarConexao() {
    /* Duas sondas, porque uma só confunde dois problemas muito diferentes.

       A primeira é um GET normal, com CORS. Se ela passa, o navegador
       conseguiu falar com a API E leu a resposta — ou seja, o endereço deste
       painel ESTÁ autorizado. Se mesmo assim o login falhou no transporte, o
       que quebrou foi o pedido do login em si: o POST usa cabeçalho
       Authorization e content-type, e por isso passa antes por um OPTIONS
       (preflight). Firewall corporativo, antivírus com inspeção de HTTPS e
       extensão de navegador derrubam exatamente esse OPTIONS, deixando o GET
       simples passar. É o caso do computador que falha enquanto o mesmo
       usuário entra pelo 4G do celular.

       A segunda é a sonda em `mode:'no-cors'`, que não lê a resposta e por
       isso não depende de autorização de origem. Ela só diz se o pacote
       chegou a algum lugar.

       Três respostas, três ações diferentes — e nenhuma delas é "avise a
       Logística" quando o problema está na rede de quem tenta entrar. */
    const tempo = sinalDeTimeout(6000);
    try {
      const r = await fetch(SP_CONFIG.api + '/health', { signal: tempo.signal });
      if (r.ok) return 'filtrado';   // alcança e é autorizado: sobrou o preflight
    } catch (e) { /* segue para a segunda sonda */ }
    finally { tempo.cancelar(); }

    const tempo2 = sinalDeTimeout(6000);
    try {
      await fetch(SP_CONFIG.api + '/health', { mode: 'no-cors', signal: tempo2.signal });
      return 'alcancavel';           // chega, mas a resposta não pôde ser lida
    } catch (e) {
      return 'inalcancavel';         // não há caminho até a API deste aparelho
    } finally {
      tempo2.cancelar();
    }
  }

  /* ---------------------------------------------------------------
     Login
     --------------------------------------------------------------- */
  async function login(email, senha) {
    const r = await chamar('/auth/login', {
      metodo: 'POST',
      corpo: { email, senha },
    });
    guardarToken(r.token, r.operador);
    await iniciar();
    return r.operador;
  }

  function sair() {
    pararSincronia();
    if (socket) { try { socket.disconnect(); } catch (e) { /* ignora */ } socket = null; }
    limparToken();
  }

  function conta() {
    return operadorLogado;
  }

  /* ---------------------------------------------------------------
     Escrita — a mesma assinatura que o adaptador do SharePoint tinha
     ---------------------------------------------------------------
     data.js chama `upsert('cargas', 'Carga_ID', {campos SharePoint})`. Aqui
     o payload é traduzido de volta para o formato da API. A tradução é feia,
     mas é o preço de não mexer em data.js — e mexer em data.js custaria
     revalidar todas as regras de negócio já testadas. */

  function deLinhaParaApi(campos) {
    return {
      id: campos.Carga_ID,
      numeroCarga: campos.Numero_Carga || '',
      placa: campos.Placa,
      transportadora: campos.Transportadora || '',
      tipoVeiculo: campos.Tipo_Veiculo || '',
      motorista: campos.Motorista || '',
      cliente: campos.Cliente || '',
      destino: campos.Destino || '',
      peso: campos.Peso_Kg || 0,
      doca: campos.Doca || '',
      rota: campos.Rota_Codigo || '',
      sequencia: campos.Sequencia,
      praOnde: campos.Pra_Onde,
      paletizada: campos.Paletizada,
      qtdGanchos: campos.Qtd_Ganchos || 0,
      qtdEntregas: campos.Qtd_Entregas,
      observacoes: campos.Observacoes || '',
      status: campos.Status_Atual,
      aguardandoCarga: campos.Aguardando_Carga === true || campos.Aguardando_Carga === 'Sim',
    };
  }

  function daApiParaLinha(c) {
    return {
      Carga_ID: c.id,
      Numero_Carga: c.numeroCarga,
      Placa: c.placa,
      Transportadora: c.transportadora,
      Tipo_Veiculo: c.tipoVeiculo,
      Motorista: c.motorista,
      Cliente: c.cliente,
      Destino: c.destino,
      Peso_Kg: c.peso,
      Doca: c.doca,
      Rota_Codigo: c.rota,
      Sequencia: c.sequencia,
      Pra_Onde: c.praOnde,
      Paletizada: c.paletizada,
      Qtd_Ganchos: c.qtdGanchos,
      Qtd_Entregas: c.qtdEntregas,
      Status_Atual: c.status,
      Aguardando_Carga: c.aguardandoCarga,
      Criado_Em: c.criadoEm,
      Atualizado_Em: c.atualizadoEm,
      Excluida: c.excluida === true,
    };
  }

  function movDaApiParaLinha(m) {
    return {
      Movimentacao_ID: m.id,
      Carga_ID: m.cargaId,
      Placa: m.placa,
      Status_Anterior: m.statusAnterior,
      Status_Novo: m.statusNovo,
      Setor: m.setor,
      Data_Evento: m.data,
      Operador_Nome: m.operador,
    };
  }

  /* Grava a carga. Cria se não existe, atualiza se existe — a API resolve
     isso pelo id, então o painel não precisa saber qual dos dois é. */
  async function upsert(lista, chave, campos, operador) {
    if (lista === 'frota') return gravarFrota(campos);
    if (lista !== 'cargas') return { enfileirado: false };
    if (!estaConfigurado()) return { enfileirado: false };

    const corpo = deLinhaParaApi(campos);
    try {
      /* Criar e editar são rotas diferentes, e por muito tempo só a
         primeira era usada.

         O POST de carga usa ON CONFLICT DO NOTHING — o que é certo para a
         fila offline reenviar sem duplicar, mas significa que editar uma
         carga que já existe não gravava NADA no servidor. A troca de placa
         aparecia no navegador de quem editou e em nenhum outro: some ao
         recarregar, o Power BI nunca vê, e o pátio segue com a placa antiga.

         Status 200 no POST quer dizer "já existia". Aí a edição vai pelo
         PATCH, que é onde o servidor valida campo por campo e anuncia a
         mudança para todo mundo. */
      const r = await chamar('/api/cargas', { metodo: 'POST', corpo, comStatus: true });
      mudarEstado('online');
      if (r.status !== 200) return { enfileirado: false, item: r.dados };

      try {
        const salva = await chamar('/api/cargas/' + encodeURIComponent(corpo.id), {
          metodo: 'PATCH', corpo,
        });
        return { enfileirado: false, item: salva };
      } catch (e2) {
        /* Nada que este setor possa editar mudou. Não é erro: acontece toda
           vez que a Portaria grava uma carga por causa de outro campo. */
        if (e2.codigo === 'SEM_CAMPOS_PERMITIDOS') {
          return { enfileirado: false, item: r.dados };
        }
        throw e2;
      }
    } catch (e) {
      if (e.status === 409 || e.status === 422 || e.status === 403) {
        // Recusa legítima do servidor. Enfileirar seria insistir para sempre.
        console.warn('[Suinco] gravação recusada:', e.message);
        return { enfileirado: false, recusado: true, erro: e.message };
      }
      if (eFalhaDeRede(e)) return enfileirar({ tipo: 'carga', corpo });
      throw e;
    }
  }

  /* Exclusão de carga programada.

     Antes ela não existia: o painel apagava a linha do próprio navegador e
     pronto. O servidor nunca sabia, a leitura seguinte trazia a carga de
     volta, e o operador via reaparecer o que tinha acabado de excluir.

     Recusa definitiva (carga já em operação, setor sem permissão) NÃO vai
     para a fila — seria insistir para sempre em algo que nunca será aceito.
     Falha de rede vai, porque a exclusão precisa acontecer mesmo que a rede
     tenha caído no instante do clique. */
  async function excluir(id) {
    if (!estaConfigurado()) return { enfileirado: false };
    try {
      const r = await chamar('/api/cargas/' + encodeURIComponent(id), { metodo: 'DELETE' });
      mudarEstado('online');
      return { enfileirado: false, item: r };
    } catch (e) {
      if (e.status === 404) return { enfileirado: false, item: null };  // já não existe
      if (e.status === 409 || e.status === 422 || e.status === 403) {
        return { enfileirado: false, recusado: true, erro: e.message };
      }
      if (eFalhaDeRede(e)) return enfileirar({ tipo: 'exclusao', cargaId: id });
      throw e;
    }
  }

  async function push(lista, campos, operador) {
    // Movimentações e logs são gerados pelo próprio servidor quando o status
    // muda — gravá-los daqui duplicaria cada evento no Power BI. A função
    // continua existindo porque data.js a chama; ela só não precisa mais
    // fazer nada.
    return { enfileirado: false, ignorado: true };
  }

  async function gravarFrota(campos) {
    if (!estaConfigurado()) return { enfileirado: false };
    try {
      await chamar('/api/frota', {
        metodo: 'POST',
        corpo: {
          placa: campos.Placa,
          transportadora: campos.Transportadora,
          tipoVeiculo: campos.Tipo_Veiculo,
        },
      });
      return { enfileirado: false };
    } catch (e) {
      if (eFalhaDeRede(e)) return enfileirar({ tipo: 'frota', corpo: campos });
      return { enfileirado: false, recusado: true, erro: e.message };
    }
  }

  /* Muda o status pela rota que valida a transição no servidor. É por aqui
     que o painel deve mover a carga — e é o que impede alguém com o token de
     marcar "Faturado" num caminhão que nunca chegou. */
  async function mudarStatus(cargaId, statusNovo) {
    if (!estaConfigurado()) return { enfileirado: false };
    try {
      const c = await chamar(`/api/cargas/${encodeURIComponent(cargaId)}/status`, {
        metodo: 'POST',
        corpo: { status: statusNovo },
      });
      mudarEstado('online');
      return { enfileirado: false, item: c };
    } catch (e) {
      if (eFalhaDeRede(e)) {
        return enfileirar({ tipo: 'status', cargaId, status: statusNovo });
      }
      return { enfileirado: false, recusado: true, erro: e.message };
    }
  }

  /* ---------------------------------------------------------------
     Fila — drenagem em ordem
     ---------------------------------------------------------------
     A ORDEM IMPORTA e não pode ser paralelizada: "chegou" tem que subir
     antes de "iniciou embarque", senão o servidor recusa a segunda por
     transição inválida e a alteração se perde. */
  async function drenarFila() {
    if (!estaConfigurado()) return { enviados: 0, restantes: pendentes() };
    const fila = lerFila();
    if (!fila.length) return { enviados: 0, restantes: 0 };

    let enviados = 0;
    const sobraram = [];
    const descartados = [];

    for (let i = 0; i < fila.length; i++) {
      const item = fila[i];
      try {
        if (item.tipo === 'carga') {
          // Mesmo caminho do upsert: se a carga já existe, o POST não grava
          // nada e a edição precisa ir pelo PATCH. Sem isto, tudo o que foi
          // editado offline subia e era descartado em silêncio pelo
          // ON CONFLICT DO NOTHING — o pior tipo de perda, a que parece
          // sucesso.
          const r = await chamar('/api/cargas', {
            metodo: 'POST', corpo: item.corpo, comStatus: true,
          });
          if (r.status === 200) {
            try {
              await chamar('/api/cargas/' + encodeURIComponent(item.corpo.id), {
                metodo: 'PATCH', corpo: item.corpo,
              });
            } catch (e2) {
              if (e2.codigo !== 'SEM_CAMPOS_PERMITIDOS') throw e2;
            }
          }
        } else if (item.tipo === 'exclusao') {
          try {
            await chamar('/api/cargas/' + encodeURIComponent(item.cargaId), { metodo: 'DELETE' });
          } catch (e2) {
            // Carga que já não existe é exclusão bem-sucedida por outro
            // caminho, não falha. Insistir aqui travaria a fila inteira,
            // que precisa subir em ordem.
            if (e2.status !== 404) throw e2;
          }
        } else if (item.tipo === 'status') {
          await chamar(`/api/cargas/${encodeURIComponent(item.cargaId)}/status`, {
            metodo: 'POST', corpo: { status: item.status },
          });
        } else if (item.tipo === 'frota') {
          await gravarFrota(item.corpo);
        }
        enviados++;
      } catch (e) {
        if (eFalhaDeRede(e)) {
          // Rede caiu de novo no meio da drenagem. Guarda este e todos os
          // seguintes — quebrar a ordem aqui é o que causaria a recusa em
          // cascata na próxima tentativa.
          sobraram.push(...fila.slice(i));
          break;
        }
        /* Recusa definitiva (placa fora da frota, setor sem permissão,
           transição inválida). Manter na fila faria o painel tentar para
           sempre algo que nunca será aceito.

           Mas descartar em SILÊNCIO seria repetir o pior erro que já
           corrigimos neste projeto: o operador registrou a chegada, viu na
           tela, foi para casa — e a gravação nunca subiu. Por isso o item
           descartado é devolvido a quem chamou, para o painel avisar. */
        console.warn('[Suinco] item da fila descartado —', e.message, item);
        descartados.push({ item, motivo: e.message, codigo: e.codigo });
      }
    }

    gravarFila(sobraram);
    if (enviados) mudarEstado(sobraram.length ? 'offline' : 'online');

    if (descartados.length) {
      ouvintesDescarte.forEach((fn) => {
        try { fn(descartados); } catch (e2) { console.error(e2); }
      });
    }
    return { enviados, restantes: sobraram.length, descartados };
  }

  /* ---------------------------------------------------------------
     Leitura
     --------------------------------------------------------------- */
  function lerMarca() {
    if (ultimaMarca) return ultimaMarca;
    try { ultimaMarca = localStorage.getItem(CHAVE_MARCA); } catch (e) { ultimaMarca = null; }
    return ultimaMarca;
  }

  function guardarMarca(m) {
    ultimaMarca = m;
    try { localStorage.setItem(CHAVE_MARCA, m); } catch (e) { /* ignora */ }
  }

  async function pull(incremental = true) {
    if (!estaConfigurado()) return null;

    const desde = incremental ? lerMarca() : null;
    const caminho = '/api/estado' + (desde ? '?desde=' + encodeURIComponent(desde) : '');

    const r = await chamar(caminho);

    /* A marca vem do SERVIDOR, já recuada 5 s. Isso resolve do lado certo o
       bug que causou perda permanente de atualização na versão anterior: o
       relógio do terminal não participa mais da conta, então defasagem entre
       máquinas deixa de ser problema. */
    guardarMarca(r.marca);
    mudarEstado('online');

    const dados = {
      incremental: !r.completo,
      cargas: (r.cargas || []).map(daApiParaLinha),
      movimentacoes: (r.movimentacoes || []).map(movDaApiParaLinha),
      frota: [],
    };

    // A frota é dimensão: pesada (749 placas) e quase estática. Baixar a
    // cada ciclo de 15 s seria desperdício — só vem na carga inicial.
    if (r.completo) {
      try {
        const frota = await chamar('/api/frota');
        dados.frota = (frota || []).map((v) => ({
          Placa: v.placa,
          Transportadora: v.transportadora,
          Tipo_Veiculo: v.tipoVeiculo,
          Precisa_Revisao: v.precisaRevisao,
        }));
      } catch (e) {
        console.warn('[Suinco] frota não carregou:', e.message);
      }
    }

    ouvintesDados.forEach((fn) => { try { fn(dados); } catch (e) { console.error(e); } });
    return dados;
  }

  function pullTudo() {
    return pull(false);
  }

  async function sincronizarAgora() {
    try {
      await drenarFila();
      await pull(true);
    } catch (e) {
      if (eFalhaDeRede(e)) mudarEstado('offline');
      else console.warn('[Suinco] sincronia:', e.message);
    }
  }

  function iniciarSincroniaPeriodica() {
    pararSincronia();
    timerSincronia = setInterval(sincronizarAgora, SP_CONFIG.intervaloSincronia);
  }

  function pararSincronia() {
    if (timerSincronia) { clearInterval(timerSincronia); timerSincronia = null; }
  }

  function ultimaSincronia() {
    return lerMarca();
  }

  /* ---------------------------------------------------------------
     Tempo real
     ---------------------------------------------------------------
     O socket é OTIMIZAÇÃO, não fonte da verdade. Se não conectar, a
     consulta periódica continua rodando e nada se perde — só demora até
     15 s em vez de ser imediato. Por isso nenhuma falha aqui é tratada
     como erro do painel. */
  function conectarTempoReal() {
    if (typeof io === 'undefined') {
      console.info('[Suinco] socket.io ausente — usando consulta periódica.');
      return;
    }
    if (socket) { try { socket.disconnect(); } catch (e) { /* ignora */ } }

    socket = io(SP_CONFIG.api, {
      auth: { token: lerToken() },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
    });

    socket.on('connect', () => {
      mudarEstado('online');
      // Ao reconectar pode ter havido movimento no intervalo. Uma consulta
      // incremental fecha o buraco — o socket não guarda o que perdeu.
      sincronizarAgora();
    });

    socket.on('disconnect', () => {
      // Não vira 'offline': a consulta periódica continua funcionando, e
      // dizer "offline" com a rede boa seria mentir para o operador.
      console.info('[Suinco] tempo real caiu — seguindo por consulta periódica.');
    });

    const aplicar = () => sincronizarAgora();
    socket.on('carga:criada', aplicar);
    socket.on('carga:atualizada', aplicar);
    socket.on('movimentacao:nova', aplicar);

    /* Aviso de edição — separado do dado de propósito.

       `carga:atualizada` manda recarregar; `carga:editada` conta a notícia
       para a pessoa. O adaptador não decide como mostrar (isso é da tela),
       só entrega — inclusive quem editou, para o painel não avisar a própria
       pessoa do que ela acabou de fazer. */
    socket.on('carga:excluida', (aviso) => {
      // Chega como aviso, mas também precisa mexer nos dados: a carga tem
      // que sair da tela agora, não na próxima consulta.
      sincronizarAgora();
      ouvintesExclusao.forEach((fn) => {
        try { fn(aviso); } catch (e) { console.warn('[Suinco] aviso de exclusão:', e); }
      });
    });

    socket.on('carga:editada', (aviso) => {
      ouvintesEdicao.forEach((fn) => {
        try { fn(aviso); } catch (e) { console.warn('[Suinco] aviso de edição:', e); }
      });
    });
    socket.on('frota:atualizada', () => pullTudo().catch(() => {}));
    socket.on('connect_error', (e) => {
      console.info('[Suinco] tempo real indisponível:', e.message);
    });
  }

  /* ---------------------------------------------------------------
     Estado do rodapé
     --------------------------------------------------------------- */
  function mudarEstado(novo) {
    if (novo === estadoAtual) return;
    estadoAtual = novo;
    ouvintesEstado.forEach((fn) => { try { fn(novo); } catch (e) { console.error(e); } });
  }

  function estado() { return estadoAtual; }
  function aoMudarEstado(fn) { if (typeof fn === 'function') ouvintesEstado.push(fn); }
  function aoReceberDados(fn) { if (typeof fn === 'function') ouvintesDados.push(fn); }

  /* Avisa quando um item da fila foi recusado de vez e descartado. O painel
     precisa disto para dizer ao operador que aquela gravação NÃO subiu —
     silêncio aqui é perda de dado disfarçada de sucesso. */
  function aoDescartarDaFila(fn) { if (typeof fn === 'function') ouvintesDescarte.push(fn); }

  /* Avisa que OUTRO operador editou uma carga já programada. Chega pelo
     socket, com o que mudou e quem mudou. */
  function aoEditarCarga(fn) { if (typeof fn === 'function') ouvintesEdicao.push(fn); }

  /* Avisa que OUTRO operador excluiu uma carga programada. */
  function aoExcluirCarga(fn) { if (typeof fn === 'function') ouvintesExclusao.push(fn); }

  /* ---------------------------------------------------------------
     Início
     ---------------------------------------------------------------
     NUNCA lança. O painel tem que abrir mesmo sem rede, sem servidor e sem
     login — em modo local, com o rodapé dizendo a verdade. Um painel que não
     abre é pior que um painel que abre sem sincronia. */
  async function iniciar() {
    if (!SP_CONFIG.ativo || !SP_CONFIG.api) { mudarEstado('local'); return; }
    if (!lerToken()) { mudarEstado('local'); return; }

    try {
      const eu = await chamar('/auth/eu');
      operadorLogado = eu.operador;
      mudarEstado('online');
    } catch (e) {
      mudarEstado(e.status === 401 ? 'local' : 'offline');
      // Segue adiante mesmo assim: a fila e a consulta periódica continuam
      // valendo, e a próxima tentativa pode dar certo.
    }

    conectarTempoReal();
    iniciarSincroniaPeriodica();

    try { await sincronizarAgora(); } catch (e) { /* já tratado dentro */ }

    // O navegador avisa quando a rede volta. Aproveitar isso esvazia a fila
    // no segundo em que dá, em vez de esperar o próximo ciclo de 15 s.
    window.addEventListener('online', sincronizarAgora);
    window.addEventListener('offline', () => mudarEstado('offline'));
  }

  /* ---------------------------------------------------------------
     Operadores — usado só pela aba Usuários (Administração)
     ---------------------------------------------------------------
     Estas quatro funções NÃO passam pela fila offline de propósito.
     Criar usuário sem confirmação do servidor daria a impressão de que a
     pessoa já pode entrar, e ela não poderia — pior que falhar na hora. */
  function listarOperadores() {
    return chamar('/api/operadores');
  }

  function criarOperador(dados) {
    return chamar('/api/operadores', { metodo: 'POST', corpo: dados });
  }

  function atualizarOperador(id, campos) {
    return chamar(`/api/operadores/${encodeURIComponent(id)}`, {
      metodo: 'PATCH', corpo: campos,
    });
  }

  /* O encerramento do ciclo virou responsabilidade do servidor (o histórico
     fica no banco, não em pastas). A função continua para app.js não quebrar. */
  async function arquivarDia(resumo, operador) {
    return { ok: true, observacao: 'O histórico fica no banco — não há mais arquivamento em pastas.' };
  }

  return {
    SP_CONFIG,
    iniciar, estaConfigurado, estado, conta, aoMudarEstado, aoReceberDados,
    aoDescartarDaFila, aoEditarCarga, aoExcluirCarga,
    login, sair, diagnosticarConexao,
    push, upsert, excluir, mudarStatus,
    pull, pullTudo, drenarFila, pendentes,
    listarOperadores, criarOperador, atualizarOperador,
    sincronizarAgora, iniciarSincroniaPeriodica, pararSincronia, ultimaSincronia,
    arquivarDia,
  };
})();
