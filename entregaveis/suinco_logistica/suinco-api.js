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
  let ouvintesPresenca = [];
  let ouvintesDevolucao = [];
  let ouvintesFechamentoPrograma = [];
  let timerRenovacao = null;
  let ultimaInteracao = Date.now();

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
    /* A marca vai AQUI, e não no login: `guardarToken` é o ponto único por
       onde passa todo token de servidor — o do login e o da renovação de
       sessão. Marcar só no login deixaria de fora quem entrou de manhã e
       teve a sessão renovada durante o dia. Uma função, dois chamadores. */
    marcarEntradaPeloServidor();
  }

  function limparToken() {
    token = null;
    operadorLogado = null;
    try { sessionStorage.removeItem(CHAVE_TOKEN); } catch (e) { /* ignora */ }
  }

  function estaConfigurado() {
    return SP_CONFIG.ativo && !!SP_CONFIG.api && !!lerToken();
  }

  /* SESSÃO PERDIDA NÃO É MODO LOCAL — e tratar as duas igual abriu o buraco
     em que o Rene da Expedição caiu em 31/08/2026.

     O token mora em sessionStorage: ele MORRE quando a aba fecha. No celular
     isso não é caso raro, é a rotina — o Android descarta aba em segundo
     plano o tempo todo, e o 401 de sessão vencida faz o mesmo por outro
     caminho. `DB.operador` fica no localStorage e sobrevive, então o painel
     reabre parecendo logado, com estado 'local'.

     E aí, sem token, `estaConfigurado()` responde NÃO e os cinco caminhos de
     escrita saíam com `{ enfileirado: false }` — sem recusa, sem fila, sem
     aviso. Medido: carga criada, `cargaFicouNaTela: true`, `filaOffline: 0`,
     `avisoNaTela: false`. O operador trabalha a tarde inteira gravando só no
     próprio aparelho.

     É exatamente o que a trava de offline existe para impedir, e ela não
     pegava este caso: ela cobre "a rede caiu", não "a sessão venceu" — que
     no pátio é o caso muito mais comum.

     A MARCA VIVE NO localStorage de propósito: precisa sobreviver ao token,
     senão a pergunta "esta pessoa entrou pelo servidor?" fica sem resposta
     justamente quando ela mais importa. */
  const CHAVE_ENTROU_PELO_SERVIDOR = 'suinco_entrou_pelo_servidor';

  function marcarEntradaPeloServidor() {
    try { localStorage.setItem(CHAVE_ENTROU_PELO_SERVIDOR, '1'); } catch (e) { /* modo privado */ }
  }
  function esquecerEntradaPeloServidor() {
    try { localStorage.removeItem(CHAVE_ENTROU_PELO_SERVIDOR); } catch (e) { /* ignora */ }
  }
  /* Entrou pelo servidor alguma vez NESTE aparelho e agora não tem token:
     a sessão se perdeu. Quem escolheu "Entrar sem servidor" nunca marcou,
     então o modo local continua funcionando como sempre — ele é uma decisão
     de quem usa, não um acidente. */
  function sessaoPerdida() {
    if (lerToken()) return false;
    try { return localStorage.getItem(CHAVE_ENTROU_PELO_SERVIDOR) === '1'; }
    catch (e) { return false; }
  }

  /* A MESMA DECISÃO, UM LUGAR SÓ.

     Cinco caminhos de escrita — upsert, excluir, gravarFrota, gravarRota e
     mudarStatus — repetiam `if (!estaConfigurado()) return { enfileirado:
     false }`. Cinco cópias da mesma resposta, e as cinco erradas para a
     sessão vencida. É a regra da casa: uma função, dois chamadores. */
  function semServidor() {
    if (sessaoPerdida()) {
      mudarEstado('local');
      return {
        enfileirado: false, recusado: true, sessaoExpirada: true,
        erro: 'SUA SESSÃO EXPIROU — SISTEMA INDISPONÍVEL. ENTRE DE NOVO PARA '
            + 'CONTINUAR. A alteração NÃO foi gravada.'
      };
    }
    return { enfileirado: false };
  }

  /* O endereço da API, para quem precisa falar com ela FORA do `chamar()`
     — hoje só a conferência de versão do servidor, que bate no /health sem
     token e não deve herdar o tratamento de sessão expirada. */
  function enderecoDaApi() { return SP_CONFIG.api || ''; }

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

  /* OFFLINE NÃO GRAVA. NADA. (31/08/2026 — decisão do dono.)

     As palavras dele: "se estiver conectado aceita alteração, aceita
     inclusão, aceita qualquer coisa. Offline não tem conversa não."

     E a razão que ele deu é a certa, e é a regra de sistema distribuído que
     a maioria erra:

       "a proposta do offline funciona quando você tem operações que são
        específicas de UM usuário... você bipa 10 notas, essas notas estão
        com você, ninguém mais vai mexer. Agora as cargas, um monte de
        gente mexe. Dados compartilhados você não pode tratar assim,
        porque senão pode dar sobreposição."

     Fila offline serve para dado de DONO ÚNICO. Carga é dado COMPARTILHADO:
     seis setores mexem na mesma linha ao mesmo tempo. Guardar uma alteração
     no aparelho e subir meia hora depois significa gravar por cima do que
     outra pessoa fez nesse meio tempo — sem ninguém saber.

     Foi o que aconteceu duas vezes em três dias:

       · 29/08 — o relatório do Everaldo desfez as correções do Alysson;
       · 31/08 — o Alysson alterou no computador, o celular entrou depois e
         "reverteu todas as alterações e restaurou a configuração anterior
         do telefone".

     A fila era a metade do mecanismo. A outra metade era a trava de versão
     do servidor, que nunca foi acionada porque o painel não manda a versão
     que leu — essa vem em seguida, e vale para dois terminais ONLINE ao
     mesmo tempo. Esta aqui mata a sobreposição do offline.

     Não devolve mais `{enfileirado:true}`: devolve recusa, e quem chamou
     precisa mostrar. Recusa silenciosa é como se perde dado. */
  function enfileirar(item) {
    mudarEstado('offline');
    return {
      enfileirado: false,
      recusado: true,
      offline: true,
      tipo: item && item.tipo,
      erro: 'VOCÊ ESTÁ OFFLINE — SISTEMA INDISPONÍVEL. CONECTE-SE PARA CONTINUAR. '
          + 'A alteração NÃO foi gravada.',
    };
  }

  /* A FILA QUE JÁ ESTAVA NOS APARELHOS É JOGADA FORA — uma vez, na abertura.

     Sem isto a trava valeria só daqui para frente: o que já está guardado no
     celular de quem ficou offline subiria na próxima conexão e sobrescreveria
     de novo, que é exatamente o defeito que estamos fechando.

     NÃO some calado. Devolve o que havia para a tela listar, com placa e
     tipo, para a pessoa refazer o que ainda fizer sentido. Jogar trabalho
     fora sem dizer o que era é pior que o defeito. */
  function descartarFilaAntiga() {
    const fila = lerFila();
    if (!fila.length) return { havia: 0, itens: [] };
    const itens = fila.map((f) => ({
      tipo: f.tipo,
      placa: (f.corpo && (f.corpo.placa || f.corpo.Placa)) || '',
      numeroCarga: (f.corpo && (f.corpo.numeroCarga || f.corpo.Numero_Carga)) || '',
      cargaId: f.cargaId || (f.corpo && f.corpo.cargaId) || '',
      status: f.status || '',
      quando: f.enfileiradoEm || '',
    }));
    try { localStorage.removeItem(CHAVE_FILA); } catch (e) { /* já era */ }
    return { havia: fila.length, itens };
  }

  /* "Online" é o SERVIDOR TER RESPONDIDO, não o ícone do wi-fi estar aceso.
     É a diferença entre "tenho sinal" e "a gravação chegou". */
  function estaOnline() { return estadoAtual === 'online'; }

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

      /* PAINEL NOVO, SERVIDOR VELHO — a janela entre os dois deploys.
         =================================================================
         O painel sobe sozinho no Vercel assim que a branch é publicada; o
         servidor só muda quando alguém roda o atualizar.sh por SSH. Entre
         um e outro existe uma janela em que a tela já tem o botão e o
         servidor ainda não tem a rota.

         Relato do dono (26/08/2026), com foto: clicou em Excluir na aba
         Usuários e a tela mostrou "Não consegui excluir: Rota não
         encontrada: DELETE /api/operadores/12". A frase está tecnicamente
         correta e é inútil para quem está trabalhando — parece defeito do
         painel, quando o que falta é uma atualização do servidor.

         Este tratamento já existia, mas só dentro de excluir() de carga.
         Aqui ele passa a valer para TODA chamada: qualquer rota que o
         servidor ainda não conheça vira uma frase que diz o que fazer.
         Assim a próxima função nova nasce com o aviso pronto, em vez de
         repetir este mesmo relato.

         O `codigo` continua sendo ROTA_INEXISTENTE de propósito: excluir()
         depende dele para NÃO tratar a resposta como "carga já não existe"
         — o que faria a carga sumir da tela de um e continuar no banco. */
      if (resposta.status === 404 && e.codigo === 'ROTA_INEXISTENTE') {
        e.servidorDesatualizado = true;
        e.message = 'Este painel está mais novo que o servidor: a ação que você '
          + 'pediu ainda não existe lá, e NADA foi alterado. Peça para rodar a '
          + 'atualização do servidor (atualizar.sh) e tente de novo.';
      }
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
  async function login(email, senha, codigo) {
    const r = await chamar('/auth/login', {
      metodo: 'POST',
      // `codigo` só é enviado quando existe: quem não ativou o segundo fator
      // não manda campo vazio, e o servidor não precisa distinguir os dois.
      corpo: codigo ? { email, senha, codigo } : { email, senha },
    });
    guardarToken(r.token, r.operador);
    await iniciar();
    return r.operador;
  }

  /* Segundo fator (etapa 4 do protocolo de segurança, 22/08/2026). */
  const mfa = {
    situacao: () => chamar('/auth/mfa/situacao'),
    iniciar: () => chamar('/auth/mfa/iniciar', { metodo: 'POST' }),
    confirmar: (codigo) => chamar('/auth/mfa/confirmar', { metodo: 'POST', corpo: { codigo } }),
    desativar: (senha) => chamar('/auth/mfa/desativar', { metodo: 'POST', corpo: { senha } }),
    resetarDe: (id, motivo) => chamar(
      `/api/operadores/${encodeURIComponent(id)}/mfa/resetar`,
      { metodo: 'POST', corpo: { motivo } }
    ),
  };

  function sair() {
    pararSincronia();
    if (socket) { try { socket.disconnect(); } catch (e) { /* ignora */ } socket = null; }
    limparToken();
    /* Sair é decisão de quem usa, não sessão perdida: o painel não pode
       ficar recusando escrita depois de alguém sair de propósito. */
    esquecerEntradaPeloServidor();
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
      lacre: campos.Lacre || '',
      lacre2: campos.Lacre_2 || '',
      lacre3: campos.Lacre_3 || '',
      lacreRetido: campos.Lacre_Retido || '',
      lacreRetidoMotivo: campos.Lacre_Retido_Motivo || '',
      lacreRetidoPor: campos.Lacre_Retido_Por || '',
      lacreRetidoEm: campos.Lacre_Retido_Em || null,
      programadoEm: campos.Programado_Em,
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
      /* Observacoes faltava aqui e na ida (data.js, sincronizarCarga) —
         incidente de 14/08/2026: "a Administração de Fretes não está
         puxando as observações, nem de ontem nem de hoje". O servidor
         sempre soube guardar o campo; o painel é que não o mandava nem o
         lia de volta, então a observação vivia só no navegador de quem
         digitou e o relatório saía em branco para todo mundo. */
      Observacoes: c.observacoes,
      /* OS TRÊS PONTOS DE NOVO (20/08/2026). Ao acrescentar o 2º e o 3º
         lacre, este aqui — a VOLTA do servidor — ficou para trás, e o
         efeito foi idêntico ao da observação em 14/08: o painel mandava os
         três, o banco guardava os três, e o terminal continuava mostrando
         um só, sem erro nenhum na tela. Campo novo em carga se acrescenta
         nos três lugares ou não se acrescenta: ida (data.js,
         sincronizarCarga), volta (aqui) e conversão (cargaDeLinhaRemota). */
      Lacre: c.lacre,
      Lacre_2: c.lacre2,
      Lacre_3: c.lacre3,
      Lacre_Retido: c.lacreRetido,
      /* Os três companheiros do número retido (migração 027): motivo, quem
         e quando. Vêm do servidor e o painel não os manda de volta — quem
         carimba retenção é a rota própria, não a sincronização. */
      Lacre_Retido_Motivo: c.lacreRetidoMotivo || '',
      Lacre_Retido_Por: c.lacreRetidoPor || '',
      Lacre_Retido_Em: c.lacreRetidoEm || null,
      Status_Atual: c.status,
      Aguardando_Carga: c.aguardandoCarga,
      Criado_Em: c.criadoEm,
      Programado_Em: c.programadoEm,
      Atualizado_Em: c.atualizadoEm,
      /* Última ação de GENTE (migração 026). Só na volta e na conversão —
         o painel nunca manda estes campos, quem carimba é o banco. Mandar
         seria justamente reabrir a porta do eco: um terminal desatualizado
         reescreveria "quem mexeu por último" com o que ele tinha em cache. */
      Acao_Em: c.acaoEm || null,
      Acao_Por: c.acaoPor || '',
      Acao_Setor: c.acaoSetor || '',
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
    if (lista === 'rotas') return gravarRota(campos);
    if (lista !== 'cargas') return { enfileirado: false };
    if (!estaConfigurado()) return semServidor();

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
  async function excluir(id, motivo, opcoes) {
    if (!estaConfigurado()) return semServidor();
    // forcarSeguiuViagem: exclusão de carga já finalizada, só depois que o
    // operador confirmou digitando a placa (excluirCargaSeguiuViagemUI,
    // app.js). Sem isso o servidor recusa com CARGA_JA_SAIU (cargas.js).
    const forcarSeguiuViagem = !!(opcoes && opcoes.forcarSeguiuViagem);
    try {
      // O motivo vai no corpo. Carga que já andou só sai como cancelamento,
      // e o servidor recusa cancelamento sem justificativa.
      const corpo = motivo || forcarSeguiuViagem
        ? { ...(motivo ? { motivo } : {}), ...(forcarSeguiuViagem ? { forcarSeguiuViagem: true } : {}) }
        : undefined;
      const r = await chamar('/api/cargas/' + encodeURIComponent(id), {
        metodo: 'DELETE', corpo,
      });
      mudarEstado('online');
      return { enfileirado: false, item: r };
    } catch (e) {
      /* 404 tem DOIS significados aqui, e confundi-los apaga carga de
         verdade sem apagar nada no banco.

         - CARGA_NAO_ENCONTRADA: a carga já não existe. Tratar como sucesso
           é certo — o objetivo era removê-la e ela não está lá.

         - ROTA_INEXISTENTE: o SERVIDOR é que não tem a rota DELETE, porque
           está numa versão anterior à migração de exclusão. Aqui tratar
           como sucesso é o pior caminho possível: a carga some da tela de
           quem apagou, continua no banco, continua aparecendo para os
           outros setores e volta na próxima leitura completa. Divergência
           silenciosa entre dois terminais é o defeito mais caro que este
           painel pode ter.

         O código vem do corpo JSON — o servidor identifica os dois casos
         (rotas/cargas.js e o catch-all de servidor.js). */
      if (e.status === 404 && e.codigo === 'ROTA_INEXISTENTE') {
        const desatualizado = new Error(
          'Este painel foi atualizado, mas o servidor ainda não: a rota de exclusão '
          + 'não existe lá. A carga NÃO foi excluída. Avise a TI para rodar a '
          + 'atualização do servidor antes de tentar de novo.');
        desatualizado.status = 404;
        desatualizado.codigo = 'SERVIDOR_DESATUALIZADO';
        throw desatualizado;
      }
      if (e.status === 404) return { enfileirado: false, item: null };  // já não existe
      if (e.status === 409 || e.status === 422 || e.status === 403) {
        return { enfileirado: false, recusado: true, erro: e.message };
      }
      if (eFalhaDeRede(e)) return enfileirar({ tipo: 'exclusao', cargaId: id, motivo, forcarSeguiuViagem });
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
    if (!estaConfigurado()) return semServidor();
    try {
      /* Manda TODOS os campos, não só três.

         Bug achado em 11/08/2026, ao adicionar o motorista: só placa,
         transportadora e tipoVeiculo eram enviados. Como o backend faz
         `ON CONFLICT DO UPDATE SET capacidade_kg = EXCLUDED.capacidade_kg`
         (e o mesmo para uf), os campos ausentes chegavam nulos e cada
         edição de placa pelo painel APAGAVA capacidade e UF no servidor —
         silenciosamente, porque a cópia local continuava certa e ninguém
         via a diferença até comparar com outro terminal. */
      await chamar('/api/frota', {
        metodo: 'POST',
        corpo: {
          placa: campos.Placa,
          transportadora: campos.Transportadora,
          tipoVeiculo: campos.Tipo_Veiculo,
          capacidadeKg: campos.Capacidade_Kg,
          uf: campos.UF,
          motorista: campos.Motorista,
        },
      });
      return { enfileirado: false };
    } catch (e) {
      if (eFalhaDeRede(e)) return enfileirar({ tipo: 'frota', corpo: campos });
      return { enfileirado: false, recusado: true, erro: e.message };
    }
  }

  async function gravarRota(campos) {
    if (!estaConfigurado()) return semServidor();
    try {
      await chamar('/api/rotas', {
        metodo: 'POST',
        corpo: {
          codigo: campos.Codigo,
          nome: campos.Nome,
          detalhe: campos.Detalhe,
          operador: campos.Operador,
        },
      });
      return { enfileirado: false };
    } catch (e) {
      if (eFalhaDeRede(e)) return enfileirar({ tipo: 'rota', corpo: campos });
      return { enfileirado: false, recusado: true, erro: e.message };
    }
  }

  /* Muda o status pela rota que valida a transição no servidor. É por aqui
     que o painel deve mover a carga — e é o que impede alguém com o token de
     marcar "Faturado" num caminhão que nunca chegou. */
  async function mudarStatus(cargaId, statusNovo) {
    if (!estaConfigurado()) return semServidor();
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

  /* SAÍDA DO PÁTIO — PELA ROTA PRÓPRIA DO SERVIDOR (28/08/2026).

     A rota `POST /api/portaria/saida` existe desde 20/08 e estava sendo
     chamada por NINGUÉM: o painel registrava a saída localmente e deixava
     a sincronia comum levar o status depois. Foi assim que a placa PUX2971
     saiu às 06:38 com o porteiro vendo "Seguiu Viagem" na tela e o
     servidor sem saber de nada — a Bruna, em outro terminal, continuava
     vendo o caminhão no pátio, e o Alysson teve que dar a saída de novo às
     08:59.

     Por que a rota importa, e não é preciosismo: ela resolve a placa
     INTEIRA dentro de UMA transação, lendo o estado real do banco com
     FOR UPDATE. Quem decide o que sai é o servidor, com a lista dele — não
     o que este navegador tinha em memória, que pode estar minutos atrasado.

     NÃO ENTRA NA FILA OFFLINE, pelo mesmo motivo de `corrigirEtapa`: uma
     saída que sobe sozinha meia hora depois libera um caminhão que já foi
     embora, ou pior, libera outro que entrou nesse meio-tempo. Sem rede, o
     erro sobe para a tela e o porteiro fica sabendo na hora. */
  async function portariaSaida(placa, lacres) {
    return chamar('/api/portaria/saida', {
      metodo: 'POST',
      corpo: { placa, lacres: Array.isArray(lacres) ? lacres : [lacres].filter(Boolean) },
    });
  }

  /* Correções da Administração (19/08/2026).

     Nunca entram na fila offline, de propósito: correção é ação consciente
     de uma pessoa olhando a ficha da carga, e uma correção que sobe sozinha
     meia hora depois — quando o estado já mudou — corrige a coisa errada.
     Sem rede, o erro sobe para a tela e a pessoa tenta de novo. */
  async function corrigirEtapa(cargaId, statusNovo, motivo) {
    return chamar(`/api/cargas/${encodeURIComponent(cargaId)}/corrigir-etapa`, {
      metodo: 'POST', corpo: { status: statusNovo, motivo },
    });
  }

  async function corrigirDataProgramacao(cargaId, data, motivo) {
    return chamar(`/api/cargas/${encodeURIComponent(cargaId)}/data-programacao`, {
      metodo: 'POST', corpo: { data, motivo },
    });
  }

  /* Cargas excluídas — a tela onde o "desfazer exclusão" pode ser clicado.
     Não entra no estado do painel: é consulta sob demanda da Administração,
     e misturar carga excluída com o pátio em operação seria voltar atrás na
     razão de ela ter sumido. */
  async function listarExcluidas(placa) {
    const q = placa ? '?placa=' + encodeURIComponent(placa) : '';
    return chamar('/api/cargas-excluidas' + q);
  }

  async function desfazerExclusao(cargaId, motivo) {
    return chamar(`/api/cargas/${encodeURIComponent(cargaId)}/desfazer-exclusao`, {
      metodo: 'POST', corpo: { motivo },
    });
  }

  /* O histórico da programação de um dia — INCLUI as canceladas, que a
     leitura do pátio esconde. Consulta sob demanda, como listarExcluidas:
     controle não é estado vivo do painel. */
  async function programacaoDoDia(dia) {
    return chamar('/api/programacao-do-dia?dia=' + encodeURIComponent(dia));
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
            const corpo = item.motivo || item.forcarSeguiuViagem
              ? { ...(item.motivo ? { motivo: item.motivo } : {}), ...(item.forcarSeguiuViagem ? { forcarSeguiuViagem: true } : {}) }
              : undefined;
            await chamar('/api/cargas/' + encodeURIComponent(item.cargaId), {
              metodo: 'DELETE', corpo,
            });
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
        } else if (item.tipo === 'rota') {
          await gravarRota(item.corpo);
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
      rotas: [],
    };

    /* Frota e rotas são dimensão: pesadas ou quase estáticas. Baixar a cada
       ciclo de 15 s seria desperdício — por isso vinham só na carga inicial.

       SÓ QUE "QUASE ESTÁTICA" NÃO É "ESTÁTICA" (20/08/2026). Relato do
       gestor, duas vezes no mesmo dia e em máquinas diferentes: "não entendo
       por que a rota 011 está aparecendo sem nada escrito, para mim só o
       número". A rota existia — tinha sido CADASTRADA naquele dia. Quem
       cadastrou via o nome; todo painel que estava aberto desde antes só via
       o código, porque nunca mais tinha buscado a lista de rotas. E painel
       de pátio fica aberto o dia inteiro.

       A rota volta a ser buscada a cada 5 minutos também na sincronização
       incremental. São ~30 linhas de texto: o custo é irrisório perto de um
       operador lendo "011" e não sabendo para onde o caminhão vai. A FROTA
       continua só na carga inicial — ali são milhares de placas, e o mesmo
       tratamento seria caro de verdade. */
    const agora = Date.now();
    const rotasVelhas = (agora - ultimaBuscaDeRotas) > INTERVALO_ROTAS_MS;
    if (r.completo || rotasVelhas) {
      try {
        const rotas = await chamar('/api/rotas');
        ultimaBuscaDeRotas = agora;
        dados.rotas = (rotas || []).map((rt) => ({
          Codigo: rt.codigo,
          Nome: rt.nome,
          Detalhe: rt.detalhe,
          Operador: rt.operador,
        }));
      } catch (e) {
        console.warn('[Suinco] rotas não carregaram:', e.message);
      }
    }

    if (r.completo) {
      try {
        const frota = await chamar('/api/frota');
        /* O MOTORISTA VINHA E ERA JOGADO FORA (28/08/2026).

           O servidor devolve motorista, capacidade e UF nesta rota desde
           que o campo existe. Este mapeamento copiava só quatro chaves, e
           as outras morriam aqui — então o autopreenchimento "digitou a
           placa, veio o motorista" só funcionava para quem tinha
           cadastrado aquela placa NESTE navegador. Para todo mundo que
           recebeu a frota do servidor (ou seja, todo mundo, todo dia), o
           campo chegava vazio.

           Descoberto ao investigar o relato do dono sobre a Montagem do
           Dia: "as placas que estão neles não estão puxando direto as
           infos da placa". A tela estava certa; o dado é que não chegava. */
        dados.frota = (frota || []).map((v) => ({
          Placa: v.placa,
          Transportadora: v.transportadora,
          Tipo_Veiculo: v.tipoVeiculo,
          Motorista: v.motorista,
          Capacidade_Kg: v.capacidadeKg,
          UF: v.uf,
          Precisa_Revisao: v.precisaRevisao,
        }));
      } catch (e) {
        console.warn('[Suinco] frota não carregou:', e.message);
      }
    }

    ouvintesDados.forEach((fn) => { try { fn(dados); } catch (e) { console.error(e); } });
    return dados;
  }

  /* Ver o comentário em pull(): a lista de rotas é pequena e muda durante o
     dia (Cadastros → Cadastrar Rota), então precisa ser reconferida mesmo em
     painel que não recarrega a página. */
  const INTERVALO_ROTAS_MS = 5 * 60 * 1000;
  let ultimaBuscaDeRotas = 0;

  /* GATILHO SOB DEMANDA, além do relógio.

     Esperar até 5 minutos ainda é esperar. Quando o painel recebe uma carga
     cuja ROTA ele não conhece, isso é a prova de que a lista dele está
     velha — e é exatamente o instante em que o operador está olhando a
     linha sem nome. Aqui a lista é rebuscada na hora, com trava de 60 s
     para um código realmente inexistente (erro de digitação, por exemplo)
     não virar uma chamada por ciclo de sincronização. */
  let ultimoPedidoDeRotas = 0;
  async function recarregarRotas(motivo) {
    const agora = Date.now();
    if (agora - ultimoPedidoDeRotas < 60_000) return null;
    ultimoPedidoDeRotas = agora;
    try {
      const rotas = await chamar('/api/rotas');
      ultimaBuscaDeRotas = agora;
      const dados = {
        incremental: true,
        cargas: [], movimentacoes: [], frota: [],
        rotas: (rotas || []).map((rt) => ({
          Codigo: rt.codigo, Nome: rt.nome, Detalhe: rt.detalhe, Operador: rt.operador,
        })),
      };
      ouvintesDados.forEach((fn) => { try { fn(dados); } catch (e) { console.error(e); } });
      console.info('[Suinco] lista de rotas recarregada —', motivo || 'pedido do painel');
      return dados.rotas.length;
    } catch (e) {
      console.warn('[Suinco] rotas não recarregaram:', e.message);
      return null;
    }
  }

  function pullTudo() {
    return pull(false);
  }

  /* Toda troca em tempo real (carga:criada, carga:atualizada,
     movimentacao:nova, connect — ver conectarTempoReal) chama esta função
     de novo, sem esperar a anterior terminar. Numa oscilação de rede
     normal isso é barato; mas se o SERVIDOR está recusando (429, "muitas
     requisições"), cada evento vira mais uma tentativa imediata — e como
     os eventos continuam chegando (ou o socket reconecta em loop), o
     próprio painel martela o limite que está recusando, numa espiral que
     nunca se resolve sozinha (encontrado em produção, 08/08/2026).

     Duas travas cobrem isso:
     - `sincronizando` impede duas chamadas rodando ao mesmo tempo — a
       que chegou durante a anterior só marca "roda mais uma vez ao
       terminar", não empilha.
     - `bloqueadoAte` é o recuo de verdade: depois de um 429, a próxima
       tentativa espera um tempo que DOBRA a cada novo 429 (até um teto),
       e volta ao mínimo assim que uma sincronia der certo. */
  let sincronizando = false;
  let reexecutarAoTerminar = false;
  let bloqueadoAte = 0;
  const BACKOFF_INICIAL_MS = 5000;
  const BACKOFF_MAXIMO_MS = 60000;
  let backoffAtualMs = BACKOFF_INICIAL_MS;

  async function sincronizarAgora() {
    if (Date.now() < bloqueadoAte) return;
    if (sincronizando) { reexecutarAoTerminar = true; return; }
    sincronizando = true;
    try {
      // drenarFila() NUNCA lança — ela mesma decide entre "falha de rede,
      // guarda e tenta depois" e "recusa definitiva, descarta avisando"
      // (ver comentário lá dentro). Um 429 no meio da fila cai no primeiro
      // caso e volta como item ainda pendente, não como exceção — por isso
      // o recuo também olha `restantes`, não só o catch abaixo.
      const resultadoFila = await drenarFila();
      await pull(true);
      backoffAtualMs = BACKOFF_INICIAL_MS;
      if (resultadoFila && resultadoFila.restantes > 0) {
        bloqueadoAte = Date.now() + backoffAtualMs;
        backoffAtualMs = Math.min(backoffAtualMs * 2, BACKOFF_MAXIMO_MS);
      }
    } catch (e) {
      if (eFalhaDeRede(e)) mudarEstado('offline');
      else console.warn('[Suinco] sincronia:', e.message);
      if (e && e.status === 429) {
        bloqueadoAte = Date.now() + backoffAtualMs;
        backoffAtualMs = Math.min(backoffAtualMs * 2, BACKOFF_MAXIMO_MS);
      }
    } finally {
      sincronizando = false;
      if (reexecutarAoTerminar) {
        reexecutarAoTerminar = false;
        sincronizarAgora();
      }
    }
  }

  /* ---------------------------------------------------------------
     Renovação de sessão
     ---------------------------------------------------------------
     O token vale 12 h. Num terminal de pátio que fica aberto o expediente
     inteiro, isso significa pedir senha no meio do turno — muitas vezes com
     o caminhão parado na doca esperando o registro.

     Renovar sem critério resolveria isso e criaria outro pior: sessão que
     nunca vence faz o turno da noite operar com a identidade de quem sentou
     ali de manhã, e o log de auditoria passa a mentir sobre quem fez o quê.

     Então a renovação segue o TRABALHO, não o relógio: só renova se alguém
     tocou na tela dentro da janela de inatividade. Terminal em uso continua
     vivo indefinidamente; terminal esquecido aberto vence sozinho e a
     próxima pessoa precisa se identificar. */
  const INTERVALO_RENOVACAO = 3 * 60 * 60 * 1000;   // 3 h — folga larga sobre as 12 h
  const JANELA_INATIVIDADE  = 4 * 60 * 60 * 1000;   // 4 h sem ninguém = deixa vencer

  function registrarInteracao() {
    ultimaInteracao = Date.now();
  }

  function ouvirInteracao() {
    if (typeof document === 'undefined') return;
    ['pointerdown', 'keydown', 'visibilitychange'].forEach((evento) => {
      document.addEventListener(evento, registrarInteracao, { passive: true });
    });
  }

  async function renovarSessao() {
    if (!estaConfigurado()) return { renovado: false, motivo: 'sem sessão' };
    if (Date.now() - ultimaInteracao > JANELA_INATIVIDADE) {
      return { renovado: false, motivo: 'sem uso' };
    }
    try {
      const r = await chamar('/auth/renovar', { metodo: 'POST' });
      guardarToken(r.token, r.operador);
      // O socket carrega o token no aperto de mão. Com token novo, a conexão
      // antiga segue válida até cair — e, ao cair, reconectaria com um token
      // já vencido. Reconectar agora evita esse buraco.
      conectarTempoReal();
      return { renovado: true, operador: r.operador };
    } catch (e) {
      // 401 aqui já limpou a sessão em chamar(); o painel avisa pelo rodapé.
      console.info('[Suinco] renovação de sessão não completou:', e.message);
      return { renovado: false, motivo: e.message };
    }
  }

  function iniciarRenovacaoPeriodica() {
    pararRenovacao();
    timerRenovacao = setInterval(renovarSessao, INTERVALO_RENOVACAO);
  }

  function pararRenovacao() {
    if (timerRenovacao) { clearInterval(timerRenovacao); timerRenovacao = null; }
  }

  function iniciarSincroniaPeriodica() {
    pararSincronia();
    timerSincronia = setInterval(sincronizarAgora, SP_CONFIG.intervaloSincronia);
  }

  function pararSincronia() {
    if (timerSincronia) { clearInterval(timerSincronia); timerSincronia = null; }
    pararRenovacao();
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

    /* Devoluções são servidor-first (sem cópia local sincronizada), então o
       evento não dispara pull de cargas — só avisa a tela de Devoluções
       para recarregar a lista dela, se estiver aberta. */
    socket.on('devolucao:atualizada', (aviso) => {
      ouvintesDevolucao.forEach((fn) => {
        try { fn(aviso); } catch (e) { console.warn('[Suinco] aviso de devolução:', e); }
      });
    });

    // Quem está online agora, por operador. Chega sozinho quando alguém
    // conecta/desconecta em qualquer terminal — e também assim que ESTA aba
    // conecta, com o retrato do momento (o servidor manda de propósito).
    socket.on('presenca:atualizada', (dados) => {
      const online = Array.isArray(dados?.online) ? dados.online : [];
      ouvintesPresenca.forEach((fn) => {
        try { fn(online); } catch (e) { console.warn('[Suinco] presença:', e); }
      });
    });

    // Alguém (Logística/Administração) fechou a programação atual — avisa
    // todo mundo conectado, pra ninguém perguntar pelo WhatsApp "já posso
    // programar de novo?". Ver POST /api/programacao/fechar no servidor.
    socket.on('programacao:fechada', (dados) => {
      ouvintesFechamentoPrograma.forEach((fn) => {
        try { fn(dados); } catch (e) { console.warn('[Suinco] fechamento de programação:', e); }
      });
    });

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

  /* Avisa quem está online agora (lista de ids de operador). Dispara sozinho
     quando alguém conecta/desconecta em qualquer terminal, e uma vez ao
     conectar esta aba, com o retrato do momento. */
  function aoAtualizarPresenca(fn) { if (typeof fn === 'function') ouvintesPresenca.push(fn); }

  /* Avisa que alguém fechou a programação atual (POST /api/programacao/fechar). */
  function aoFecharPrograma(fn) { if (typeof fn === 'function') ouvintesFechamentoPrograma.push(fn); }

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
    ouvirInteracao();
    iniciarRenovacaoPeriodica();

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

  /* Apaga a conta de vez. Não passa pela fila offline de propósito: sem
     servidor não há exclusão, e enfileirar daria a impressão de que a conta
     saiu quando ela ainda está lá, ativa, no aparelho de quem for entrar. */
  function excluirOperador(id) {
    return chamar(`/api/operadores/${encodeURIComponent(id)}`, { metodo: 'DELETE' });
  }

  /* O encerramento do ciclo virou responsabilidade do servidor (o histórico
     fica no banco, não em pastas). A função continua para app.js não quebrar. */
  async function arquivarDia(resumo, operador) {
    return { ok: true, observacao: 'O histórico fica no banco — não há mais arquivamento em pastas.' };
  }

  /* Fecha a programação atual — só Logística/Administração (o servidor
     confere de novo; isto aqui não é a proteção real). Recusa (409) se
     existir carga em andamento; o erro traz a lista em `e.dados.cargas`. */
  async function fecharPrograma(senha) {
    return chamar('/api/programacao/fechar', {
      metodo: 'POST',
      corpo: senha === undefined ? {} : { senha },
    });
  }

  /* Histórico de ciclos de programação (o "arquivo" que o fechamento
     alimenta). Não passa pela fila offline: é consulta, e mostrar uma
     lista velha de ciclos seria pior que dizer que não deu pra carregar. */
  function listarProgramacoes() {
    return chamar('/api/programacoes');
  }

  /* MODELO DA SEMANA E MONTAGEM DO DIA (23/08/2026).

     A etapa que ainda vivia no Excel: montar o dia sobre as rotas
     pré-definidas e só depois contratar as placas. Nada aqui passa pela
     fila offline — montar programação sem servidor criaria duas versões
     do dia, e o dia é justamente o que precisa ser um só para os cinco
     setores enxergarem o mesmo. */
  const modeloSemana = {
    listar() { return chamar('/api/modelo-semana'); },
    gravar(campos) {
      return chamar('/api/modelo-semana', { metodo: 'POST', corpo: campos });
    },
    remover(id) {
      return chamar('/api/modelo-semana/' + encodeURIComponent(id), { metodo: 'DELETE' });
    },
  };

  const montagem = {
    doDia(dia) {
      return chamar('/api/montagem' + (dia ? '?dia=' + encodeURIComponent(dia) : ''));
    },
    criar(campos) {
      return chamar('/api/montagem', { metodo: 'POST', corpo: campos });
    },
    alterar(id, campos) {
      return chamar('/api/montagem/' + encodeURIComponent(id),
        { metodo: 'PATCH', corpo: campos });
    },
    cancelar(id, motivo) {
      return chamar('/api/montagem/' + encodeURIComponent(id) + '/cancelar',
        { metodo: 'POST', corpo: { motivo } });
    },
    /* Avisa o servidor de que a montagem virou a carga `cargaId`. Quem cria
       a carga é o caminho de sempre — ver o comentário da rota no
       servidor sobre por que não há um segundo caminho de criação. */
    efetivar(id, cargaId) {
      return chamar('/api/montagem/' + encodeURIComponent(id) + '/efetivar',
        { metodo: 'POST', corpo: { cargaId } });
    },
  };

  /* Revisões de carga (Bloco B, 16/08/2026). Só a Administração — o
     servidor é quem barra, isto aqui só transporta. Não passa pela fila
     offline: restaurar sem servidor não existe (o histórico mora lá). */
  function listarRevisoes(cargaId) {
    return chamar('/api/cargas/' + encodeURIComponent(cargaId) + '/revisoes');
  }
  /* O motivo é obrigatório e vai para o histórico da carga. Era, até
     25/08/2026, um pedido a ser aprovado por outro administrador — a
     exigência caiu por decisão do dono; ver backend/src/rotas/cargas.js. */
  function restaurarRevisao(cargaId, revisaoId, motivo) {
    return chamar('/api/cargas/' + encodeURIComponent(cargaId) + '/restaurar', {
      metodo: 'POST', corpo: { revisaoId, motivo },
    });
  }

  /* Gera o PDF do relatório NO SERVIDOR — pedido do usuário (09/08/2026):
     "eu quero que saia no modo paisagem, e saiam iguais os relatorios que
     forem exportados tanto no ios ou android ou desktop". `window.print()`
     deixa cada aparelho decidir sozinho o tamanho final da página (provado
     nesta mesma investigação: sem o motor de impressão respeitar
     `@page{size:A4}`, o PDF sai em Carta americana e quebra em páginas a
     mais). Aqui o servidor renderiza com um Chromium que ele mesmo
     controla e PEDE A4/paisagem como parâmetro direto — não como sugestão
     de CSS que o aparelho do operador pode ignorar.

     Não usa `chamar()` porque a resposta é o PDF em si (bytes), não JSON —
     precisa do Blob puro, e um erro do servidor (403/409/500) ainda vem em
     JSON, então os dois formatos de resposta precisam de tratamento
     próprio aqui. */
  async function gerarRelatorioPdf({ html, css, orientacao = 'paisagem', nomeArquivo, tipo, recorte }) {
    /* `tipo` é o dono do documento (etapa 1 do protocolo de segurança,
       22/08/2026). O servidor recebe HTML montado e não tem como inferir
       QUAL relatório é — por isso o painel declara, e o servidor valida
       contra o setor. Documento sem tipo é recusado de propósito: falha
       fechada, para que um documento esquecido no mapa apareça na primeira
       tentativa em vez de virar porta aberta. */
    const t = lerToken();
    const tempo = sinalDeTimeout(45000); // Chromium subindo + renderizando: mais generoso que o timeout padrão de 20s
    let resposta;
    try {
      resposta = await fetch(SP_CONFIG.api + '/api/relatorios/pdf', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(t ? { authorization: 'Bearer ' + t } : {}),
        },
        body: JSON.stringify({ html, css, orientacao, nomeArquivo, tipo, recorte }),
        signal: tempo.signal,
      });
    } catch (e) {
      const abortou = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
      const err = new Error(abortou
        ? 'O servidor não respondeu no tempo limite ao gerar o relatório.'
        : 'Não foi possível alcançar o servidor para gerar o relatório.');
      err.motivo = abortou ? 'timeout' : 'transporte';
      throw err;
    } finally {
      tempo.cancelar();
    }

    if (!resposta.ok) {
      let dados = null;
      try { dados = await resposta.json(); } catch (e) { /* corpo não era JSON */ }
      const e = new Error((dados && dados.erro) || `Erro ${resposta.status} ao gerar o relatório.`);
      e.status = resposta.status;
      e.codigo = dados && dados.codigo;
      throw e;
    }
    return resposta.blob();
  }

  /* ---------- Devoluções — o checklist digital ----------
     Servidor-first de propósito: as operadoras trabalham em mesa com rede,
     e o checklist é um documento vivo entre setores — a fonte é o servidor,
     sem cópia local que possa ecoar dado velho (a lição das cargas na
     semana de 14–15/08). Sem conexão, a aba diz isso com todas as letras
     em vez de fingir que gravou. */
  function aoAtualizarDevolucao(fn) { if (typeof fn === 'function') ouvintesDevolucao.push(fn); }

  /* Encerra as pendências das programações ANTERIORES (20/08/2026) —
     ver o comentário da rota. Não passa pela fila offline de propósito:
     é ação em lote sobre cargas de outros setores, e "achar que fechou"
     sem confirmação do servidor seria pior que falhar na hora. */
  /* Retenção de lacre na inspeção da saída — rota própria (20/08/2026).
     Passa pelo servidor para o motivo, o autor e a hora ficarem gravados em
     campo, e não só dentro do texto da observação. */
  function reterLacre({ placa, lacreRetido, novoLacre, motivo }) {
    return chamar('/api/portaria/lacre-retido', {
      metodo: 'POST',
      corpo: { placa, lacreRetido, novoLacre, motivo },
    });
  }

  function encerrarProgramacoesAnteriores(motivo, ids) {
    return chamar('/api/cargas/encerrar-anteriores', {
      metodo: 'POST',
      corpo: ids && ids.length ? { motivo, ids } : { motivo },
    });
  }

  const devolucoesApi = {
    listar(de, ate) {
      const q = [];
      if (de) q.push('de=' + encodeURIComponent(de));
      if (ate) q.push('ate=' + encodeURIComponent(ate));
      return chamar('/api/devolucoes' + (q.length ? '?' + q.join('&') : ''));
    },
    criar(corpo) { return chamar('/api/devolucoes', { metodo: 'POST', corpo }); },
    editar(id, corpo) {
      return chamar('/api/devolucoes/' + encodeURIComponent(id), { metodo: 'PATCH', corpo });
    },
    excluir(id) {
      return chamar('/api/devolucoes/' + encodeURIComponent(id), { metodo: 'DELETE' });
    },
    etapa(id, corpo) {
      return chamar('/api/devolucoes/' + encodeURIComponent(id) + '/etapa', { metodo: 'POST', corpo });
    },
    criarItem(id, corpo) {
      return chamar('/api/devolucoes/' + encodeURIComponent(id) + '/itens', { metodo: 'POST', corpo });
    },
    editarItem(id, itemId, corpo) {
      return chamar('/api/devolucoes/' + encodeURIComponent(id) + '/itens/' + encodeURIComponent(itemId),
        { metodo: 'PATCH', corpo });
    },
    excluirItem(id, itemId) {
      return chamar('/api/devolucoes/' + encodeURIComponent(id) + '/itens/' + encodeURIComponent(itemId),
        { metodo: 'DELETE' });
    },
    criarDivergencia(id, corpo) {
      return chamar('/api/devolucoes/' + encodeURIComponent(id) + '/divergencias', { metodo: 'POST', corpo });
    },
    excluirDivergencia(id, divId) {
      return chamar('/api/devolucoes/' + encodeURIComponent(id) + '/divergencias/' + encodeURIComponent(divId),
        { metodo: 'DELETE' });
    },
    listarRevisoes(id) {
      return chamar('/api/devolucoes/' + encodeURIComponent(id) + '/revisoes');
    },
    restaurar(id, revisaoId) {
      return chamar('/api/devolucoes/' + encodeURIComponent(id) + '/restaurar',
        { metodo: 'POST', corpo: { revisaoId } });
    },
    cadastros() { return chamar('/api/devolucoes-cadastros'); },
    cadastrarSupervisor(nome) {
      return chamar('/api/devolucoes-cadastros/supervisores', { metodo: 'POST', corpo: { nome } });
    },
    cadastrarProduto(codigo, nome, pesoCaixaKg) {
      return chamar('/api/devolucoes-cadastros/produtos',
        { metodo: 'POST', corpo: { codigo, nome, pesoCaixaKg } });
    },
    cadastrarMotivo(motivo) {
      return chamar('/api/devolucoes-cadastros/motivos', { metodo: 'POST', corpo: { motivo } });
    },
    cadastrarCliente(corpo) {
      return chamar('/api/devolucoes-cadastros/clientes', { metodo: 'POST', corpo });
    },
    buscarClientes(q) {
      return chamar('/api/devolucoes-cadastros/clientes?q=' + encodeURIComponent(q || ''));
    },
    /* CSV inteiro dos clientes (76 mil linhas) — resposta é texto/blob,
       não JSON, então não passa pelo chamar(). */
    async clientesCsv() {
      const t = lerToken();
      const resposta = await fetch(SP_CONFIG.api + '/api/devolucoes-cadastros/clientes-csv', {
        headers: { ...(t ? { authorization: 'Bearer ' + t } : {}) },
      });
      if (!resposta.ok) {
        const e = new Error('O servidor recusou a exportação (' + resposta.status + ').');
        e.status = resposta.status;
        throw e;
      }
      return resposta.blob();
    },
  };

  /* =====================================================================
     AVISO NO CELULAR (26/08/2026)
     ---------------------------------------------------------------------
     Pedido do dono: quem tem o painel instalado como aplicativo recebe um
     aviso a cada caminhão que entra na portaria, a cada saída, e quando a
     programação do dia termina.

     ISTO NÃO É O SINO DA TELA. O `notify()` do painel avisa quem está
     olhando. Aqui a mensagem chega com o aplicativo FECHADO — quem entrega
     é o service worker, e o servidor fala com a Google/Apple, não com esta
     aba.

     TRÊS PORTAS PRECISAM ESTAR ABERTAS ao mesmo tempo, e o painel precisa
     saber dizer QUAL está fechada — "não funcionou" sem motivo é o que faz
     alguém desistir:
       1. o navegador suporta push (no iPhone, só com o atalho na tela de
          início — Safari em aba nunca vai receber);
       2. a pessoa deu permissão, no aparelho dela, uma vez;
       3. o servidor tem as chaves VAPID configuradas.
     ===================================================================== */

  /* A chave pública vem em base64url e o navegador exige bytes. Conversão
     mecânica: repõe o padding, desfaz as trocas do alfabeto url-safe. */
  function chaveParaBytes(base64url) {
    const resto = '='.repeat((4 - (base64url.length % 4)) % 4);
    const base64 = (base64url + resto).replace(/-/g, '+').replace(/_/g, '/');
    const cru = atob(base64);
    const bytes = new Uint8Array(cru.length);
    for (let i = 0; i < cru.length; i++) bytes[i] = cru.charCodeAt(i);
    return bytes;
  }

  function nomeDoAparelho() {
    const ua = navigator.userAgent || '';
    const sistema = /iPhone|iPad/i.test(ua) ? 'iPhone'
      : /Android/i.test(ua) ? 'Android'
      : /Windows/i.test(ua) ? 'Windows'
      : /Mac/i.test(ua) ? 'Mac' : 'Aparelho';
    const instalado = ehAplicativoInstalado() ? ' (aplicativo)' : ' (navegador)';
    return sistema + instalado;
  }

  function ehAplicativoInstalado() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  function ehIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
      // iPad moderno se apresenta como Mac; o toque é o que o denuncia.
      || (/Mac/i.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1);
  }

  const avisosApi = {
    ehAplicativoInstalado,
    ehIOS,

    /* Por que este aparelho NÃO pode receber — em uma frase que a pessoa
       entende. Devolve null quando pode. */
    porQueNaoPode() {
      if (!('serviceWorker' in navigator)) {
        return 'Este navegador não sabe receber avisos. Use o Chrome (Android) ou o Safari (iPhone).';
      }
      if (!('PushManager' in window)) {
        if (ehIOS() && !ehAplicativoInstalado()) {
          return 'No iPhone o aviso só funciona com o painel instalado na tela de início. '
            + 'Toque em Compartilhar e depois em "Adicionar à Tela de Início" — '
            + 'e abra o painel por esse ícone.';
        }
        return 'Este navegador não sabe receber avisos no celular.';
      }
      if (ehIOS() && !ehAplicativoInstalado()) {
        return 'No iPhone o aviso só funciona com o painel instalado na tela de início. '
          + 'Toque em Compartilhar e depois em "Adicionar à Tela de Início".';
      }
      if (Notification.permission === 'denied') {
        return 'Os avisos foram bloqueados para este site no seu aparelho. '
          + 'Libere nas configurações do navegador e volte aqui.';
      }
      return null;
    },

    /* O que o SERVIDOR diz: se a função está ligada lá e quantos aparelhos
       esta pessoa já inscreveu. */
    estadoNoServidor() {
      return chamar('/api/avisos/chave');
    },

    /* Este aparelho já está inscrito? Pergunta ao próprio navegador, que é
       quem sabe — o servidor conhece a conta, não o aparelho. */
    async ligadoNesteAparelho() {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
        const reg = await navigator.serviceWorker.ready;
        return Boolean(await reg.pushManager.getSubscription());
      } catch (e) { return false; }
    },

    /* Liga. Pede a permissão (uma vez, no aparelho), inscreve no navegador
       e guarda no servidor. Erro aqui vira mensagem, nunca silêncio. */
    async ligar() {
      const impedimento = this.porQueNaoPode();
      if (impedimento) throw new Error(impedimento);

      const servidor = await chamar('/api/avisos/chave');
      if (!servidor.ligado || !servidor.chavePublica) {
        throw new Error('O aviso no celular ainda não foi ligado no servidor. '
          + 'Peça para rodar a atualização do servidor antes de tentar de novo.');
      }

      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') {
        throw new Error('Você precisa permitir os avisos quando o aparelho perguntar. '
          + 'Se não apareceu nada, os avisos já estavam bloqueados nas configurações.');
      }

      const reg = await navigator.serviceWorker.ready;
      /* userVisibleOnly é obrigatório e não é enfeite: é o compromisso de
         que todo push vira notificação visível. O service worker cumpre a
         parte dele mostrando algo mesmo quando o pacote vem quebrado. */
      const inscricao = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chaveParaBytes(servidor.chavePublica),
      });

      await chamar('/api/avisos/inscrever', {
        metodo: 'POST',
        corpo: { inscricao: inscricao.toJSON(), aparelho: nomeDoAparelho() },
      });
      return true;
    },

    /* Desliga NESTE aparelho. Sai dos dois lados: do navegador (senão o
       serviço de push continua entregando) e do servidor (senão o servidor
       continua tentando, para sempre). */
    async desligar() {
      let endpoint = '';
      try {
        const reg = await navigator.serviceWorker.ready;
        const inscricao = await reg.pushManager.getSubscription();
        if (inscricao) {
          endpoint = inscricao.endpoint;
          await inscricao.unsubscribe();
        }
      } catch (e) { /* segue e limpa o servidor mesmo assim */ }
      if (endpoint) {
        await chamar('/api/avisos/desinscrever', { metodo: 'POST', corpo: { endpoint } });
      }
      return true;
    },

    /* Mandar um teste para si mesmo. Sem isto a pessoa só descobre que o
       aviso não chega no dia em que precisava dele. */
    testar() {
      return chamar('/api/avisos/testar', { metodo: 'POST' });
    },
  };

  return {
    SP_CONFIG,
    iniciar, estaConfigurado, enderecoDaApi, estado, conta, aoMudarEstado, aoReceberDados,
    aoDescartarDaFila, aoEditarCarga, aoExcluirCarga, aoAtualizarPresenca,
    aoFecharPrograma,
    login, sair, diagnosticarConexao,
    push, upsert, excluir, mudarStatus, encerrarProgramacoesAnteriores, reterLacre,
    recarregarRotas,
    corrigirEtapa, corrigirDataProgramacao, desfazerExclusao, listarExcluidas,
    programacaoDoDia, mfa,
    modeloSemana, montagem,
    pull, pullTudo, drenarFila, pendentes, descartarFilaAntiga, estaOnline,
    sessaoPerdida,
    listarOperadores, criarOperador, atualizarOperador, excluirOperador,
    sincronizarAgora, iniciarSincroniaPeriodica, pararSincronia, ultimaSincronia,
    renovarSessao, registrarInteracao,
    arquivarDia, fecharPrograma,
    gerarRelatorioPdf, listarProgramacoes,
    listarRevisoes, restaurarRevisao,
    portariaSaida,
    devolucoes: devolucoesApi, aoAtualizarDevolucao,
    avisos: avisosApi,
  };
})();
