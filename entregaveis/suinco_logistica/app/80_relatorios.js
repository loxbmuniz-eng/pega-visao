/* ---------- RELATÓRIOS (PDF gerado pelo servidor) ---------- */
/* Até 09/08/2026 o PDF saía via `window.print()` — cada aparelho decidia
   sozinho o tamanho final da página. Provado nesta mesma investigação (com
   PDFs reais, medidos byte a byte) que isso quebra: sem o motor de
   impressão do usuário respeitar `@page{size:A4 landscape}`, o relatório
   sai em Carta americana e quebra em páginas a mais — e cada aparelho
   (Chrome desktop, Safari/AirPrint no iPhone, apps de PDF no Android) pode
   decidir diferente. Pedido do usuário: "eu quero que saia no modo
   paisagem, e saiam iguais os relatorios que forem exportados tanto no ios
   ou android ou desktop".

   A correção: o SERVIDOR renderiza o PDF (backend/src/rotas/relatorios.js)
   com um Chromium que ele mesmo controla, pedindo A4 paisagem como
   PARÂMETRO da chamada — não mais uma sugestão de CSS que o aparelho do
   operador pode ignorar. O HTML/CSS enviado é exatamente o que este
   arquivo já construía para `window.print()`; só o "vira arquivo" que
   mudou de lugar. Isso também elimina de vez a necessidade de detectar
   "celular ignorou a orientação pedida" (a antiga variável `emPe`): a
   orientação agora é decidida por nós, sempre, não pelo aparelho. */
/* Encolhe o relatório pra caber numa página só, em vez de estourar pra
   uma segunda página quase vazia. Pedido direto do usuário (08/08/2026):
   "quero que os relatorios sejam one pagers... coloca tudo dentro de uma
   pagina só". */
function ajustarParaCaberEmUmaPagina(el){
  const pagina = el.querySelector('.print-page');
  if(!pagina) return;
  pagina.style.transform = '';
  pagina.style.transformOrigin = '';
  el.style.height = '';
  el.style.overflow = '';

  const PX_POR_MM = 96 / 25.4;
  const MARGEM_MM = 5; // @page{margin:5mm} em styles.css
  // A4 SEMPRE paisagem (297×210mm) — o servidor é quem gera o PDF agora e
  // sempre pede paisagem explicitamente (ver relatorios.js), então não há
  // mais "celular que imprime em pé" a compensar aqui.
  const larguraFolhaMm = 297 - MARGEM_MM*2;
  const alturaFolhaMm  = 210 - MARGEM_MM*2;

  // A largura do relatório é sempre calibrada pra folha deitada (287mm =
  // 297mm - 2×5mm de margem) — trava isso explicitamente, pra não
  // depender de o navegador ter resolvido a folha deitada ou em pé antes
  // desta medição.
  /* NÃO escreve mais largura aqui. Ela virou responsabilidade do CSS
     (@media print: .print-page{width:198mm}), junto com a folha A4
     vertical. Deixar o '287mm' da folha deitada nesta função — que já não
     é chamada na exportação — era uma contradição esperando alguém
     reativá-la e reintroduzir o bug do relatório miniaturizado. */

  const escalaLargura = Math.min(1, (larguraFolhaMm*PX_POR_MM) / pagina.scrollWidth);
  const escalaAltura  = Math.min(1, (alturaFolhaMm*PX_POR_MM) / pagina.scrollHeight);
  const escala = Math.max(0.5, Math.min(escalaLargura, escalaAltura));

  // Abaixo de 0,5% de diferença é arredondamento de sub-pixel, não
  // conteúdo estourando de verdade — sem este piso, uma carga que cabe
  // por pouco ganhava um scale(0.9997...) tecnicamente correto mas sem
  // efeito visível nenhum, só ruído no teste e no DOM.
  if(escala < 0.995){
    pagina.style.transform = `scale(${escala})`;
    pagina.style.transformOrigin = 'top left';

    /* PÁGINAS EM BRANCO SOBRANDO (achado pelo usuário, 08/08/2026, PDF
       real de celular): "transform:scale()" só encolhe o DESENHO — o
       motor de impressão pagina com base na altura de LAYOUT da caixa,
       que o transform NÃO muda. Uma .print-page com 500mm de altura
       original, escalada pra caber visualmente em 1 página de 287mm,
       continua "ocupando" 500mm no fluxo do documento pra fins de
       paginação — o motor fatia esse excedente em páginas extras.

       A CORREÇÃO (travar a altura do container pai na altura já escalada,
       com overflow:hidden) só é SEGURA quando o conteúdo escalado cabe
       INTEIRO numa página. Testado à parte, fora deste arquivo, antes de
       decidir isso: quando o container precisa mesmo de 2+ páginas (o
       piso de 50% de legibilidade não bastou pra caber tudo numa só), a
       MESMA técnica — container com altura fixa + overflow:hidden sendo
       fatiado pelo motor de impressão em mais de uma página — perde
       conteúdo de verdade (não só sobra branco: o motor de impressão
       não repagina corretamente um container com overflow:hidden cortado
       ao meio; testei com marcadores de texto em posições conhecidas e o
       do meio simplesmente sumiu, em nenhuma das páginas geradas).

       Por isso o travamento só entra quando cabe tudo numa página só
       (com pequena folga de arredondamento). Quando não cabe, o relatório
       volta ao comportamento anterior — algumas páginas podem sobrar
       quase em branco no fim, mas ISSO é preferível a perder uma linha
       real do relatório. Sem dado perdido é inegociável; página sobrando
       num caso raro e denso é o mal menor, e já era o comportamento
       aceito antes desta sessão (ver o comentário do piso de 50% acima:
       "a prioridade muda de 'cabe numa página' pra 'dá pra ler alguma
       coisa'" — nunca foi "a qualquer custo, mesmo perdendo dado"). */
    const alturaEscaladaPx = pagina.scrollHeight * escala;
    const folgaPx = 1; // arredondamento de sub-pixel, não estouro de verdade
    if(alturaEscaladaPx <= alturaFolhaMm*PX_POR_MM + folgaPx){
      el.style.height = alturaEscaladaPx + 'px';
      el.style.overflow = 'hidden';
    }
  }
}
/* Já não existe window.print() neste fluxo (ver exportarViaServidor logo
   abaixo) — ajustarParaCaberEmUmaPagina() agora é chamada direto, sem
   depender do evento 'beforeprint'. */

/* Carimbo de data do NOME DO ARQUIVO — o período filtrado, não a hora
   em que alguém clicou.

   Pedido do usuário (11/08/2026): "os relatorios filtrados por data,
   precisam sair com a data exata que foi filtrada no nome do arquivo...
   se foi do mes passado, preciso que saia com data do mes passado".

   Antes o nome sempre trazia `new Date()` — a emissão. Quem gerava hoje o
   relatório de julho recebia um arquivo carimbado com a data de hoje, e
   na pasta de downloads três relatórios de meses diferentes ficavam com
   nomes praticamente iguais, distinguíveis só abrindo um por um.

   Sem filtro nenhum não existe período a carimbar, e aí a emissão volta a
   ser a informação certa — mas marcada como `emitido-`, para ninguém
   confundir com recorte de data. */
function carimboDoPeriodo(){
  const { de, ate } = periodoRelatorio();

  if(de && ate) return de === ate ? de : `${de}_a_${ate}`;
  if(de) return `desde_${de}`;
  if(ate) return `ate_${ate}`;

  const d = new Date();
  const dia = [
    d.getFullYear(),
    String(d.getMonth()+1).padStart(2,'0'),
    String(d.getDate()).padStart(2,'0')
  ].join('-');
  return `emitido-${dia}_${String(d.getHours()).padStart(2,'0')}h${String(d.getMinutes()).padStart(2,'0')}`;
}

/* Junta a folha de estilo do painel para mandar junto com o relatório.

   Por que não é `document.querySelector('style')`, que era o que estava
   aqui até 14/08/2026: `querySelector` devolve o PRIMEIRO <style> do
   documento, e o código assumia que o primeiro é o do build (o
   build_arquivo_unico.py embute o CSS inteiro num <style> só). Basta
   QUALQUER outro <style> nascer antes dele — extensão de navegador,
   bloqueador de conteúdo, tema escuro de terceiro, tradutor de página —
   para o painel mandar o conteúdo do intruso, quase sempre vazio, e o
   servidor recusar com "Faltou o estilo do relatório (css)".

   Foi o incidente relatado pelo dono do projeto no Safari: o painel na
   tela estava perfeitamente estilizado (ou seja, a folha existia e tinha
   conteúdo) e mesmo assim o relatório saía sem css. Nada tinha mudado no
   código do relatório — mudou o que havia na frente dele no navegador.

   Agora junta TODOS os <style>, e ainda varre as folhas ligadas por
   <link> (caso alguém abra a fonte `index_suinco.html` em vez do arquivo
   único, onde o CSS não está embutido). Folha de outra origem lança ao ler
   `cssRules` por segurança do navegador — daí o try/catch: ignorar a que
   não dá pra ler é melhor que derrubar a exportação inteira. */
function coletarCssDoPainel(){
  const partes = [];

  document.querySelectorAll('style').forEach(s=>{
    const t = s.textContent || '';
    if(t.trim()) partes.push(t);
  });

  document.querySelectorAll('link[rel~="stylesheet"]').forEach(l=>{
    try{
      const regras = l.sheet && l.sheet.cssRules;
      if(!regras) return;
      const texto = [...regras].map(r=>r.cssText).join('\n');
      if(texto.trim()) partes.push(texto);
    }catch(e){ /* folha de outra origem: o navegador não deixa ler */ }
  });

  return partes.join('\n');
}

/* Substitui window.print(): monta o mesmo HTML que sempre foi montado,
   manda pro servidor gerar o PDF de verdade (A4 paisagem garantido) e
   baixa o arquivo pronto. */
/* ---------- Exportação de cadastros em CSV ----------
   Pedido do usuário (18/08/2026): "exportar qualquer relação de cadastros
   completa... por exemplo todo o registro de cadastro de Frota,
   atualizado". CSV e não XLSX de propósito: sai do próprio navegador, sem
   biblioteca externa (a CSP barra CDN), e com BOM + ponto-e-vírgula o
   Excel em português abre com acento e coluna certos num duplo clique. */
/* =====================================================================
   UMA CÉLULA DE CSV — e a defesa contra o Excel adivinhar tipo (10/09/2026)
   ---------------------------------------------------------------------
   RELATO DO DONO, em produção: "a coluna h do relatorio de fretes esta
   saindo em modo data entao caminhao 3/4 fica aparecendo 3 de abril".

   A coluna H é Tipo de Veículo, e "3/4" é um dos cinco tipos da tabela
   oficial de frete. O Excel aplica detecção de tipo ao conteúdo INTEIRO da
   célula: "3/4" tem forma de data e vira 3 de abril. Aspas de CSV não
   impedem — elas são sintaxe do arquivo, não declaração de tipo.

   A defesa é `="3/4"`, que o Excel resolve como texto. Fica feio num editor
   de texto e é o preço de o arquivo abrir certo onde ele é usado: Excel,
   LibreOffice e Google Planilhas entendem os três.

   SÓ NAS COLUNAS DE TEXTO, E SÓ NO QUE PRECISA. A coluna C da planilha de
   fretes é a data do faturamento e TEM de chegar como data — senão a
   Administração não ordena nem filtra por ela. E proteger "Truck", que não
   tem forma de data, só sujaria o arquivo. Por isso o chamador declara
   quais colunas são texto, e o valor só é protegido se de fato for
   ambíguo.

   ERA UMA FUNÇÃO ESCRITA DUAS VEZES. `baixarCsvCadastro` e
   `baixarCsvDoDia` tinham o mesmo escapamento copiado, palavra por palavra.
   Quatro exportações emitem tipo de veículo — planilha de fretes, tabela de
   frete, programação do dia e cadastro de Frota — e com duas cópias, o
   "3/4" consertado numa volta pela outra. A regra da casa existe para isto:
   uma função, dois chamadores.
   ===================================================================== */

/* Valor cujo conteúdo INTEIRO o Excel leria como data ou número: dígitos
   separados por / - ou . Deixa passar "combinado 1/2 carga", que o Excel
   não converte justamente porque a célula inteira não tem a forma. */
const CELULA_AMBIGUA_NO_EXCEL = /^\s*\d{1,4}\s*[/\-.]\s*\d{1,4}(\s*[/\-.]\s*\d{1,4})?\s*$/;

function celulaCsv(valor, ehTexto){
  const cru = String(valor ?? '');
  const conteudo = (ehTexto && CELULA_AMBIGUA_NO_EXCEL.test(cru)) ? `="${cru}"` : cru;
  // Escapamento de CSV depois da proteção: o ="..." traz aspas, e elas
  // precisam ser dobradas como qualquer outra.
  return /[";\n\r]/.test(conteudo) ? '"' + conteudo.replace(/"/g, '""') + '"' : conteudo;
}

/* Monta o corpo do CSV. `colunasDeTexto` são NOMES de cabeçalho, não
   índices: assim reordenar colunas não silenciosamente desprotege uma. */
function corpoCsv(cabecalhos, linhas, colunasDeTexto){
  const texto = new Set(colunasDeTexto || []);
  const daColuna = cabecalhos.map((c) => texto.has(c));
  return [cabecalhos.map((c) => celulaCsv(c, false)),
          ...linhas.map((l) => l.map((v, i) => celulaCsv(v, daColuna[i])))]
    .map((l) => l.join(';')).join('\r\n');
}

function baixarCsvCadastro(nome, cabecalhos, linhas, colunasDeTexto){
  const corpo = corpoCsv(cabecalhos, linhas, colunasDeTexto);
  // BOM: sem ele o Excel pt-BR abre "Ç" como lixo — visto em campo.
  const blob = new Blob(['﻿' + corpo], { type: 'text/csv;charset=utf-8' });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const carimbo = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Suinco_Cadastro_${nome}_${carimbo}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  notifyGravacao(`Cadastro de ${nome} exportado: ${linhas.length} registro(s).`);
}

function exportarFrotaCsv(){
  baixarCsvCadastro('Frota',
    ['Placa','Transportadora','Tipo de Veículo','Motorista','Capacidade (kg)','UF','Última Movimentação','Precisa Revisão'],
    DB.frota.map((f) => [f.placa, f.transportadora || '', f.tipoVeiculo || '',
      f.motorista || '', f.capacidadeKg ?? '', f.uf || '',
      f.dataUltimaMovimentacao || '', f.precisaRevisao ? 'Sim' : 'Não']),
    // "Última Movimentação" fica fora: é data e precisa continuar data.
    ['Placa','Transportadora','Tipo de Veículo','Motorista','UF','Precisa Revisão']);
}

function exportarRotasCsv(){
  baixarCsvCadastro('Rotas',
    ['Código','Nome','Detalhe','Operador'],
    ROTAS.map((r) => [r.codigo, r.nome || '', r.detalhe || '', r.operador || '']));
}

function exportarTransportadorasCsv(){
  // Derivada da Frota (fonte viva): cada transportadora com quantas placas
  // tem hoje — mais útil que a lista solta de nomes.
  const porNome = new Map();
  DB.frota.forEach((f) => {
    const nome = (f.transportadora || '').trim();
    if (!nome) return;
    porNome.set(nome, (porNome.get(nome) || 0) + 1);
  });
  baixarCsvCadastro('Transportadoras',
    ['Transportadora','Placas cadastradas'],
    [...porNome.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/* `opcoes` (06/10/2026): o PDF do Pagamento de Frete sai em folha DEITADA e
   leva no nome a data do dia, não o período da aba Relatórios — que ele não
   usa. Os outros relatórios não passam nada e saem como sempre saíram. */
async function exportarViaServidor(el, nomeDoRelatorio, tipo, opcoes = {}){
  /* `tipo` identifica o documento para o servidor decidir se o SEU setor
     pode gerá-lo (etapa 1 do protocolo de segurança, 22/08/2026). Não é
     opcional: documento sem tipo é recusado, de propósito — assim um
     documento esquecido no mapa aparece na primeira tentativa, em vez de
     virar uma porta aberta que ninguém nota. */
  if(!SuincoSharePoint || !SuincoSharePoint.estaConfigurado || !SuincoSharePoint.estaConfigurado()){
    notify('Exportar relatório exige conexão com o servidor — é o que garante que o PDF sai sempre igual, em qualquer aparelho.', 'warn', 6000);
    return;
  }

  document.querySelectorAll('.print-only').forEach(x=>x.style.display='none');
  el.style.display = 'block';
  /* NÃO encolhe mais (11/08/2026). `ajustarParaCaberEmUmaPagina` existia
     para o tempo em que o navegador do operador imprimia: ela aplicava
     transform:scale() para tentar caber na folha.

     Com o servidor gerando o PDF, isso passou a ESTRAGAR o resultado, e o
     usuário mandou o PDF provando: transform só encolhe o DESENHO — a
     altura de LAYOUT continua a original. O conteúdo saía miniaturizado
     no canto superior esquerdo (ancorado em transform-origin:top left) e
     o motor de impressão AINDA quebrava nas páginas da altura não
     escalada. Daí "1/4 da página e 3 folhas em branco".

     Agora o conteúdo é montado na largura real da folha e o servidor
     pagina naturalmente: enche a página, quebra quando precisa, sem
     miniatura e sem folha vazia. */

  // Sem acento, espaço ou barra: o nome vira arquivo, e cada sistema
  // operacional estraga esses caracteres de um jeito diferente.
  const limpo = (nomeDoRelatorio || 'Relatorio')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const carimbo = opcoes.carimbo || carimboDoPeriodo();
  const nomeArquivo = `Suinco_${limpo}_${carimbo}`;

  const limpar = ()=>{
    el.style.display='none';
    // Desfaz o encolhimento de ajustarParaCaberEmUmaPagina — o container é
    // reaproveitado na próxima exportação, e a pré-visualização em tela
    // (se alguém abrir de novo) não deve ficar menor por causa disso.
    const pagina = el.querySelector('.print-page');
    if(pagina){ pagina.style.transform=''; pagina.style.transformOrigin=''; pagina.style.width=''; }
    el.style.height=''; el.style.overflow='';
  };

  notify('Gerando relatório em PDF…', 'info', 4000);
  try{
    const css = coletarCssDoPainel();
    if(!css.trim()){
      // Melhor parar aqui e dizer o que houve do que gastar a viagem até o
      // servidor pra ele responder "faltou o css" — que foi exatamente o
      // que o operador viu no incidente de 14/08/2026, sem pista nenhuma
      // do que fazer a respeito.
      notify('Não achei a folha de estilo do painel para montar o relatório. '
        + 'Recarregue a página (ou abra numa aba anônima, sem extensões) e tente de novo.',
        'danger', 9000);
      limpar();
      return;
    }
    const html = el.outerHTML;
    const blob = await SuincoSharePoint.gerarRelatorioPdf({
      html, css, orientacao: opcoes.orientacao || 'retrato', nomeArquivo, tipo,
      recorte: opcoes.recorte || carimbo,
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${nomeArquivo}.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify('Relatório baixado.', 'success');
  }catch(e){
    const msg = String(e && e.message || '');
    const semPermissao = /não gera este documento|DOCUMENTO_SEM_PERMISSAO/i.test(msg);
    /* RELATÓRIO NOVO, SERVIDOR ANTIGO — DIGA A VERDADE (09/09/2026).
       =================================================================
       A mensagem do servidor para documento fora do mapa é "Atualize a
       página e tente de novo". Ela está certa para o caso que a escreveu
       (aba velha em cache, sem o tipo novo no código do painel) e MENTE no
       caso oposto: o painel está novo, o servidor é que não conhece o
       documento ainda. Aí atualizar a página não resolve nada, e quem segue
       o conselho tenta três vezes antes de pedir ajuda.

       É a porta pela qual os incidentes de 25 e 26/08 chegaram: botão
       publicado antes da rota. O portão passou a avisar da pendência, mas o
       aviso vai para o dono — não para quem está com o dedo no botão.

       Esta frase diz o que de fato aconteceu e o que destrava. Ela some
       sozinha no dia em que o servidor subir: o documento passa a existir no
       mapa e este galho nunca mais é percorrido. */
    const servidorAtrasado = /DOCUMENTO_DESCONHECIDO|não está no mapa de permissões/i.test(msg);
    notify(
      semPermissao
        ? 'Seu setor não gera este documento. Peça à Logística ou à Administração.'
        : servidorAtrasado
          ? 'Este relatório é novo e o SERVIDOR ainda não foi atualizado — '
            + 'atualizar a página não resolve. Ele funciona depois que a atualização do '
            + 'servidor rodar. Os outros relatórios continuam normais.'
          : 'Não consegui gerar o relatório: ' + (msg || 'erro desconhecido'),
      'danger', servidorAtrasado ? 12000 : 7000);
  }finally{
    limpar();
  }
}
// PDF Operacional — sequenciamento de carregamento do dia, redesenhado pra
// bater visualmente com a planilha real que a operação usa hoje.
// DECISÃO: cargas ainda com a flag "Aguardando Carga" (dados incompletos,
// sem Rota/Nº de Carga — texto "Aguardando Carga" no campo Número da
// Carga) ficam de fora desta lista — elas aparecem na Torre de Controle e
// na fila de pendências da Programação, mas não fazem sentido numa
// planilha de sequenciamento de carregamento ainda sem dados.
const CORES_PRA_ONDE = { 'CROSS-DOCKING':'#374a86', 'ENTREGA DIRETA':'#8f1f26', 'RET FRIGO':'#b9903f' };

/* Busca o estado mais recente do servidor ANTES de montar qualquer
   relatório — pedido direto: "os relatórios são nossa fonte de verdade
   absoluta", e até aqui eles montavam a folha com o que já estava na
   MEMÓRIA do navegador no instante do clique, sem forçar nada novo. Isso
   é normalmente o dado certo (o painel sincroniza sozinho o tempo todo),
   mas "normalmente" não é "sempre": aba de celular em segundo plano,
   rede instável por alguns minutos, terminal que ficou aberto sem uso —
   qualquer um desses atrasa a sincronia, e o relatório saía com o
   resíduo de antes de uma exclusão/edição/criação que já tinha
   acontecido em outro lugar.

   pullTudo() é leitura completa (não incremental) — não é o ciclo de 15s
   de sempre, é forçado, aqui, agora, antes de montar a folha. Falha de
   rede não trava o relatório: o operador com o caminhão esperando não
   pode ficar sem o documento por causa de uma rede ruim por dois
   segundos — ele recebe o aviso e o relatório sai com o melhor dado que
   o terminal já tinha. */
async function atualizarDadosAntesDoRelatorio(){
  if(typeof SuincoSharePoint === 'undefined' || !SuincoSharePoint.estaConfigurado()) return;
  try{
    notify('Buscando os dados mais recentes do servidor…', 'info', 2500);
    await SuincoSharePoint.pullTudo();
  }catch(e){
    console.warn('[Suinco] não foi possível atualizar antes do relatório:', e);
    notify('Não consegui confirmar com o servidor agora — o relatório sai com os dados '
         + 'mais recentes que este aparelho já tinha. Confira a conexão e gere de novo se puder.',
           'warn', 9000);
  }
}
// ORDEM DAS COLUNAS: os três campos de estado da carga vêm PRIMEIRO, na
// ordem em que a linha do tempo acontece — Status (a etapa dos 6), depois
// Status de Carregamento (a leitura do pátio) e por fim Faturado. Antes o
// Status ficava no meio da tabela, entre "Tipo de Operação" e "Placa", e quem
// lia a folha precisava caçar a informação mais importante no meio das
// colunas de cadastro. Identificação e cadastro (Seq., Carga, Destino, Rota,
// Placa, Transportadora...) vêm depois, porque respondem "qual carga é",
// não "em que pé ela está".
/* MONTAR e EXPORTAR são duas coisas (20/08/2026).

   Separado porque o relatório passou a ter um segundo leitor: o robô que
   manda o andamento do carregamento no grupo do WhatsApp de 3 em 3 horas.
   O servidor abre o painel sem operador nenhum na frente, chama
   `montarRelatorioOperacional()` e imprime o MESMO documento que a
   Logística exporta pela tela.

   Duplicar o modelo do relatório no servidor era o outro caminho, e seria
   o começo de dois relatórios que divergem no primeiro ajuste de coluna
   que alguém fizer aqui e esquecer de fazer lá. Uma fonte só. */
/* CAMINHÃO COM DUAS CARGAS: a informação fica no RODAPÉ, não na célula.

   Duas tentativas erradas antes desta, no mesmo dia (26/08/2026), e as duas
   valem registro porque a lição é a mesma:

     · escrever "(1 de 2, rotas diferentes)" dentro da célula da placa. A
       coluna Placa tem 7,5% da folha e não quebra linha: o texto inchou a
       coluna para um terço da página e derrubou a tabela inteira do A4. O
       dono viu o relatório do dia assim — "TA TOTALMENTE ZUADO";
     · encurtar para "1/2*" e pôr numa linha própria dentro da célula. O
       layout parou de quebrar, mas o dono foi direto ao ponto: "NAO PRECISA
       DESSA INFORMACAO 1 DE 2 2 DE 2, MANTEM A PLACA E QUE SEJA NORMAL
       MARCAR 2 CARGAS NUMA PLACA SO".

   Ele está certo, e a correção é melhor do que as duas: duas cargas no mesmo
   caminhão é rotina do pátio, não anomalia, e anomalia é o que merece marca
   na linha. As duas linhas já mostram a mesma placa com rotas diferentes —
   quem lê enxerga. O rodapé nomeia o caso para quem confere a folha inteira,
   e é lá que sobra largura para dizer QUAIS são as rotas.

   A regra que fica: célula de coluna estreita recebe DADO, nunca explicação. */
function avisoDePlacaRepetida(lista){
  const porPlaca = new Map();
  lista.forEach(c => {
    const p = normalizarPlaca(c.placa);
    if(!porPlaca.has(p)) porPlaca.set(p, []);
    porPlaca.get(p).push(c);
  });
  const repetidas = [...porPlaca.entries()].filter(([, cs]) => cs.length > 1);
  if(!repetidas.length) return '';
  /* TEXTO CORRIDO, sem <ul>. A caixa de aviso desta folha foi desenhada
     para uma ou duas linhas de texto; uma lista dentro dela empurra o bloco
     e come espaço da tabela numa folha que já é apertada. O mesmo formato
     do aviso de numeração, que já roda há semanas sem problema. */
  const itens = repetidas.map(([p, cs]) => {
    const rotas = [...new Set(cs.map(c => rotaCurta(c.rota) || 'sem rota'))];
    return `<strong>${esc(p)}</strong> (${cs.length} cargas`
      + `${rotas.length > 1 ? `, rotas ${esc(rotas.join(' e '))}` : ''})`;
  }).join(' · ');
  return `<div class="doc-aviso-numeracao">
    <strong>Caminhão com mais de uma carga:</strong> ${itens}. São viagens
    diferentes do mesmo veículo, não duplicidade.
  </div>`;
}

/* AS DATAS DE UMA LINHA DE RELATÓRIO — pedido do dono, 26/08/2026:
   "puxamos o relatório de administração de fretes dos últimos 30 dias e não
   está vindo com DATA, eu preciso da data e hora em cada linha de relatório,
   de todos os relatórios que precisam dessa informação clara".

   Ele está certo, e o relatório de fretes não tinha data NENHUMA: quatro
   colunas — número, placa, rota, observações. Trinta dias assim não se
   confere.

   UMA CARGA TEM MAIS DE UMA DATA, e confundi-las já produziu incidente. São
   três relógios diferentes:

     · a DATA DA PROGRAMAÇÃO — o dia a que a viagem pertence;
     · a ENTRADA no pátio — quando o caminhão de fato chegou;
     · a SAÍDA — quando ele seguiu viagem.

   Elas coincidem quase sempre, e se separam justamente nos casos que dão
   problema: caminhão programado num dia que só sai no outro. Foi isso que
   fez duas cargas sumirem do relatório em 19/08.

   A DATA DA PROGRAMAÇÃO usa `programadoEm || criadoEm` — exatamente o mesmo
   campo que `filtrarPorDataProgramacao` usa para decidir se a linha entra no
   período. Mostrar uma data diferente da que filtrou seria a receita para
   alguém jurar que o relatório está errado.

   FUSO: aqui NÃO se corta o texto do ISO com slice(0,10). O carimbo vem em
   UTC; cortar a string devolve o dia de Londres, e qualquer coisa depois das
   21h daqui apareceria no dia seguinte. `toLocaleDateString('pt-BR')`
   converte para o fuso de quem lê, que é o do pátio. */
function dataCurtaLocal(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR');
}

async function montarRelatorioOperacional(){
  await atualizarDadosAntesDoRelatorio();
  const el = document.getElementById('print-operacional');
  // TODAS as cargas da programação do dia, INCLUSIVE as já concluídas
  // ("Seguiu Viagem"). Antes usava cargasAbertas(), que exclui as concluídas,
  // e a carga sumia do relatório justamente quando o processo terminava.
  // Esse relatório é atualizado num grupo de WhatsApp ao longo do dia inteiro,
  // acompanhando o fluxo de carregamento: a linha precisa continuar visível,
  // mudando de cor conforme avança, até o fim do dia. Some só quando a carga
  // deixa de existir.
  // Segue de fora apenas o que a Portaria registrou sem programação prévia
  // (aguardandoCarga), que ainda não tem dados para sequenciar.
  // Respeita o filtro de Data da Programação da aba Relatórios.
  const lista = cargasDoRelatorio().slice().sort(ordenarPorSequenciaDeCarregamento);
  const linhas = lista.map((c)=>{
    const pesoTon = ((c.peso||0)/1000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const praOndeStyle = c.praOnde ? `style="background:${CORES_PRA_ONDE[c.praOnde]||'#e9b954'};color:#fff;font-weight:800"` : '';
    // Status real da carga (os 6), com o preenchimento sólido da escala do
    // gestor — é o que permite ler o andamento do dia de relance na foto
    // mandada no grupo.
    const cs = corStatusRelatorio(c.status);
    /* Classe por coluna, não posição.

       As larguras eram definidas por nth-child, calibradas quando a tabela
       tinha 16 colunas. Ao remover três, toda largura passou a cair na
       coluna errada — o Status ficou com os 5% que eram do "Faturado" e
       espremia "Aguardando Embarque" em duas linhas. Com classe, mover ou
       remover coluna não desalinha mais nada. */
    return `<tr>
      <td class="c-seq">${c.sequencia ?? '—'}</td>
      <td class="c-carga">${esc(c.numeroCarga).toUpperCase()||'—'}</td>
      <td class="c-status" style="background:${cs.fundo};color:${cs.texto}">${esc(c.status)}</td>
      ${/* ROTA + OPERADOR, empilhados na mesma célula (14/09/2026).

             Pedido do dono: "o operador tipo totalservice, montes claros,
             isso é pra aparecer no relatório operacional ali junto com a
             rota". O Faturamento identifica a praça pelo operador, não pelo
             número.

             Empilhado, e não coluna nova: a folha já tem 12 colunas em A4
             deitado e a 13ª tiraria largura do Status, que precisa caber
             "AGUARDANDO EMBARQUE" em uma linha (ver styles.css). O mesmo
             padrão da célula de veículo, onde placa manda e transportadora
             e tipo ficam de apoio, menores.

             Rota sem operador não ganha linha nenhuma — 13 das 33 ainda não
             têm, e uma linha vazia em metade da folha é ruído. */''
      }<td class="c-rota"><span class="rota-praca">${esc(rotaCurta(c.rota))}</span>${
        /* O CENTRO DE DISTRIBUIÇÃO ENTROU JUNTO (14/09/2026). Sem ele, a
           521 e a 538 saem idênticas na folha: as duas são "São Paulo
           Interior" e as duas são CargoFrio. O que as distingue é o CD —
           Ribeirão Preto numa, Marília na outra. Ver rotaApoio(). */''
      }${/* A CIDADE DA CARGA VEM ANTES DO APOIO (21/09/2026).

             Pedido do dono: "na coluna rota, precisa sair o destino também,
             além do codigo da rota, pois só a regiao deixa confuso para os
             motoristas e acaba atrapalhando a operacao".

             Ordem pensada para quem lê a folha no pátio: rota em cima (é por
             ela que a Logística fala), cidade no meio (é o que o motorista
             precisa), CD e operadora embaixo (é o que o Faturamento usa).

             Sem destino, nada é escrito — nunca "(sem destino)". A folha vai
             para reunião e para o pátio; campo dizendo que falta cadastro é
             conversa de quem mantém o sistema, e a pendência já aparece na
             tela de Cadastros, onde dá para resolver. */''
      }${destinoDaCarga(c)
        ? `<span class="rota-destino">${esc(destinoDaCarga(c))}</span>` : ''
      }${rotaApoio(c.rota)
        ? `<span class="rota-op">${esc(rotaApoio(c.rota))}</span>` : ''
      }</td>
      <td class="c-operacao" ${praOndeStyle}>${c.praOnde ? esc(PRA_ONDE_LABEL[c.praOnde]) : '—'}</td>
      <td class="c-placa">${c.placa ? esc(c.placa).toUpperCase()
        : '<span class="liso">a contratar</span>'}</td>
      <td class="c-transp">${esc(c.transportadora)||'—'}</td>
      <td class="c-veiculo">${esc(c.tipoVeiculo)||'—'}</td>
      <td class="c-peso">${pesoTon}</td>
      <td class="c-palet">${paletizadaDaCarga(c)}</td>
      <td class="c-entregas">${c.qtdEntregas ?? 1}</td>
      <td class="c-ganchos">${c.qtdGanchos ? c.qtdGanchos : '<span class="liso">Liso</span>'}</td>
    </tr>`;
  }).join('');
  const agora = new Date();
  const concluidas = lista.filter(c=>c.status==='Seguiu Viagem').length;
  /* Conta SEPARADA, decisão do dono (26/08): a tonelagem já planejada
     aparece sem se misturar com o que já tem caminhão contratado. */
  const semCaminhao = lista.filter(c=>!c.placa);
  const semCaminhaoTon = (semCaminhao.reduce((s,c)=>s+(c.peso||0),0)/1000)
    .toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  el.innerHTML = `
    <div class="print-page doc-denso">
      ${cabecalhoDocumento({
        titulo: 'Relatório Operacional',
        subtitulo: 'Logística — ordem de montagem e acompanhamento no pátio',
      })}
      <!-- A legenda de cores saiu daqui também (05/08/2026).

           Eu tinha defendido mantê-la, porque a foto vai para o grupo do
           WhatsApp e quem recebe não teria como saber o que cada cor
           significa. O gestor decidiu pela remoção, e o argumento dele é
           melhor: a coluna Status traz o nome da etapa POR EXTENSO em cada
           linha. A cor é reforço, não a informação — a legenda explicava
           algo que já estava escrito. -->
      <table>
        <thead><tr>
          <th class="c-seq">Seq.</th>
          <th class="c-carga">Nº Carga</th>
          <th class="c-status">Status</th>
          <th class="c-rota">Rota</th>
          <th class="c-operacao">Tipo de Operação</th>
          <th class="c-placa">Placa</th>
          <th class="c-transp">Transportadora</th>
          <th class="c-veiculo">Tipo de Veículo</th>
          <th class="c-peso">Peso (ton)</th>
          <!-- Rótulos abreviados, e não por economia de espaço: nesta
               largura o navegador quebrava a palavra ao meio e saía
               "Paletizad a" e "Entrega s" na folha. Rótulo partido parece
               erro de digitação num documento que vai para reunião.
               O significado vai no rodapé. -->
          <th class="c-palet">Palet.</th>
          <th class="c-entregas">Entr.</th>
          <!-- "Ganch.", pelo mesmo motivo de "Palet." e "Entr." logo acima:
               nesta largura o navegador cortava a palavra. Com a coluna
               Data / Hora (26/08/2026) a folha ficou mais apertada e
               "GANCHOS" passou a sair cortado no cabeçalho. O significado
               está no rodapé, junto com "Liso = sem gancheira". -->
          <th class="c-ganchos">Ganch.</th>
        </tr></thead>
        <tbody>${linhas || '<tr><td colspan="13" class="text-center text-dim">Nenhuma carga no período selecionado.</td></tr>'}</tbody>
        ${lista.length ? `<tfoot>${/* 8 é o número de colunas antes do Peso. A coluna "Data / Hora" chegou
             a existir aqui em 26/08 e saiu no mesmo dia, por decisão do dono:
             a folha do Operacional é do DIA, com a mesma data em toda linha e
             o dia já escrito no cabeçalho — a coluna gastava largura para
             repetir o que o documento inteiro já dizia. As datas ficaram onde
             fazem falta: no Fretes, que é de período. */''
           }${rodapeSomatorios(lista, 8, ['peso','', 'entregas','ganchos'])}</tfoot>` : ''}
      </table>
      <!-- Nota de rodapé enxugada.

           A anterior tinha cinco linhas explicando decisões de projeto —
           por que tal coluna saiu, o que a cor significa. Isso interessa a
           quem mantém o sistema, não a quem lê a folha no pátio. O que
           sobra é a única coisa que o leitor precisa saber e não consegue
           deduzir olhando a tabela. -->
      ${avisoDeNumeracao(lista)}
      ${avisoDePlacaRepetida(lista)}
      ${/* Os lacres do dia, logo abaixo da tabela: quem confere a folha no
            pátio termina de ler as cargas e encontra o controle de lacre no
            mesmo documento, sem precisar de outro relatório. */''}
      ${blocoLacresPdf(lista)}
      ${rodapeDocumento(
        'Todas as cargas da programação aparecem, em qualquer status — as concluídas ' +
        'continuam na lista para o acompanhamento do dia inteiro.<br>' +
        '<strong>Palet.</strong> = carga paletizada · <strong>Entr.</strong> = quantidade de ' +
        'entregas · <strong>Liso</strong> = sem gancheira.',
        'Todas as cargas do período selecionado, na SEQUÊNCIA DE CARREGAMENTO '
        + 'definida pela Logística — a mesma ordem da tela. Cargas sem sequência '
        + 'aparecem no fim. Cargas excluídas ou canceladas não entram.',
        fichaDocumento({
          titulo: 'Relatório Operacional',
          contagem: lista.length,
          extra: `<strong>Concluídas:</strong> ${concluidas} de ${lista.length}`
            + (semCaminhao.length
              ? ` · <strong>Sem caminhão contratado:</strong> ${semCaminhao.length} carga(s), ${semCaminhaoTon} t`
              : ''),
        }))}
    </div>`;
  return el;
}

async function exportarPdfOperacional(){
  const el = await montarRelatorioOperacional();
  await exportarViaServidor(el, 'Relatorio-Operacional', 'relatorio-operacional');
}

/* ---------- EXPORT POWER BI (CSV) ----------
   Dispara o download dos 5 CSVs (fato/dimensão) gerados em data.js.
   Ponte temporária — ver docs/POWERBI_EXPORT.md. */
function baixarArquivoTexto(nome, conteudo){
  const BOM = '﻿'; // BOM UTF-8 — Excel PT-BR abre acentuação corretamente
  const blob = new Blob([BOM + conteudo], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
function exportarCsvPowerBI(){
  const arquivos = gerarArquivosCsvPowerBI();
  arquivos.forEach((f,i)=>{
    setTimeout(()=>baixarArquivoTexto(f.nome, f.conteudo), i*250);
  });
  notify(`Exportando ${arquivos.length} arquivos CSV (fato/dimensão) para Power BI…`, 'success');
}

/* =====================================================================
   PADRÃO DE DOCUMENTO DOS RELATÓRIOS
   =====================================================================

   Os três relatórios passam a ter o mesmo cabeçalho e o mesmo rodapé. Isso
   não é estética: documento logístico circula fora do sistema — vai para o
   grupo, para o e-mail da transportadora, para a pasta do faturamento — e
   precisa se identificar sozinho. Quem recebe uma folha solta tem que
   saber o que é, de quando, de que recorte e quem gerou, sem perguntar.

   DENSIDADE POR RELATÓRIO. O Operacional tem 13 colunas e só cabe em A4
   deitado com letra pequena; o de Fretes tem 3 e sobra papel. Usar a mesma
   densidade nos dois — que era o caso — deixa o de Fretes ilegível para
   economizar espaço que ninguém estava usando.

     doc-denso   → Operacional: A4 deitado, 13 colunas
     doc-normal  → Executivo: A4 deitado, blocos e tabelas médias
     doc-amplo   → Fretes: A4 em pé, 3 colunas, leitura confortável
*/
/* ====================================================================
   PADRÃO DE DOCUMENTO — estrutura de relatório de auditoria
   ====================================================================
   Os três relatórios circulam fora do pátio: vão para a diretoria, para
   reunião com transportadora e para grupo de WhatsApp. Documento sem
   procedência é documento que alguém contesta na primeira divergência.

   A estrutura segue o que firmas de auditoria usam, e cada peça responde
   a uma pergunta que sempre aparece:

     Referência        "de qual emissão estamos falando?"
     Base de preparação "o que exatamente foi contado?"
     Fonte              "de onde veio esse número?"
     Emitido por        "quem gerou?"
     Classificação      "posso encaminhar isto?"
     Página X de Y      "está faltando folha?"

   Nada aqui muda cálculo. É procedência. */

/* Referência do documento: SUI-OPE-20260806-1432.

   Serve para citar uma emissão específica em e-mail ou ata. Dois relatórios
   do mesmo dia, com números diferentes, deixam de ser "aquele relatório" e
   passam a ter nome — que é a diferença entre resolver a divergência e
   discutir sobre ela. */
function referenciaDocumento(titulo){
  const d = new Date();
  const p = n => String(n).padStart(2,'0');
  const sigla = {
    'Relatório Operacional': 'OPE',
    'Relatório Executivo':   'EXE',
    'Administração de Fretes':'ADM',
  }[titulo] || 'DOC';
  return `SUI-${sigla}-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`
       + `-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* Identificação do documento em UMA LINHA, logo abaixo do cabeçalho.

   PERCURSO ATÉ AQUI, porque a peça foi de tabela a nada em três passos:

   1. Tabela de duas colunas por seis linhas, abaixo do cabeçalho. Correta
      e custando um quinto da primeira folha antes de qualquer dado.
   2. Uma linha corrida no mesmo lugar. Melhor, mas ainda entre o título e
      o primeiro número.
   3. Fora do cabeçalho. Referência, período, registros e observação são
      dados de CONFERÊNCIA — quem confere lê uma vez, quem decide não lê
      nunca. Ficam no rodapé, com o resto da procedência.

   O que sobra no alto é o que identifica o documento numa foto: marca,
   título, subtítulo e classificação. Nada mais. */
/* Quando e por quem — em destaque no cabeçalho, não só no rodapé.

   A ficha do rodapé (fichaDocumento) já tinha essa informação, mas em
   corpo pequeno, embaixo de tudo — quem abre o PDF pra conferir "isso é de
   agora ou é o de ontem?" precisa rolar a folha inteira pra achar. Pedido
   direto: precisa estar claro no nível do relatório, não escondido no
   rodapé. Repete o mesmo dado (não substitui a ficha, que também tem
   Referência/Período/Registros), no canto onde o olho já procura em
   qualquer memorando — ao lado do título, junto do selo "Uso interno". */
function cabecalhoDocumento({ titulo, subtitulo }) {
  const operador = (DB.operador && DB.operador.nome) || '—';
  const setor = (DB.operador && DB.operador.setor) || '';
  return `
    <div class="doc-cabecalho">
      <img src="assets/logo_suinco_web.png" alt="Suinco" class="doc-logo">
      <div class="doc-identidade">
        <div class="doc-empresa">SUINCO — Cooperativa Agroindustrial</div>
        <h1 class="doc-titulo">${esc(titulo)}</h1>
        ${subtitulo ? `<div class="doc-subtitulo">${esc(subtitulo)}</div>` : ''}
      </div>
      <div class="doc-cabecalho-meta">
        <div class="doc-classificacao">Uso interno</div>
        <div class="doc-gerado-em">
          <span class="doc-gerado-quando">${esc(fmtDataHora(new Date().toISOString()))}</span>
          <span class="doc-gerado-quem">${esc(operador)}${setor ? ' · ' + esc(setor) : ''}</span>
        </div>
      </div>
    </div>`;
}

/* Ficha de identificação, no pé do documento.

   "Emitido em" e "Emitido por" perderam os rótulos: uma data com hora e um
   nome de pessoa não precisam de etiqueta para serem reconhecidos. O que
   os rótulos faziam era ocupar duas larguras de coluna para dizer o óbvio.

   Os que ficaram — Entidade, Referência, Período, Registros — nomeiam
   coisas que NÃO se identificam sozinhas: "SUI-EXE-20260806-1744" sem a
   palavra "Referência" é ruído, e um número solto não diz se são cargas,
   dias ou quilos. */
/* `recorte` (06/10/2026): documento que não usa o período da aba Relatórios
   (o do Pagamento de Frete usa os filtros da própria aba) troca a linha
   "Período" por "Filtro" — escrever ali um período que ele não aplicou seria
   a ficha mentindo sobre o que o documento contém. */
function fichaDocumento({ titulo, contagem, extra, recorte }) {
  const agora = new Date();
  const operador = (DB.operador && DB.operador.nome) || '—';
  const setor = (DB.operador && DB.operador.setor) || '';

  const campos = [
    ['Entidade',   'Suinco — Cooperativa Agroindustrial'],
    ['Referência',  referenciaDocumento(titulo)],
    recorte !== undefined ? ['Filtro', recorte] : ['Período', rotuloPeriodoRelatorio()],
    contagem !== undefined ? ['Registros', String(contagem)] : null,
  ].filter(Boolean);

  return `
    <div class="doc-ficha">
      <div class="doc-ficha-campos">
        ${campos.map(([r,v])=>`
          <div class="doc-ficha-campo">
            <span class="doc-ficha-rot">${esc(r)}</span>
            <span class="doc-ficha-val">${esc(v)}</span>
          </div>`).join('')}
      </div>
      <div class="doc-ficha-emissao">
        <span class="doc-ficha-quando">${esc(fmtDataHora(agora.toISOString()))}</span>
        <span class="doc-ficha-quem">${esc(operador)}${setor ? ' · ' + esc(setor) : ''}</span>
      </div>
      ${extra ? `<div class="doc-ficha-obs">${extra}</div>` : ''}
    </div>`;
}

/* Nota de fonte, no pé de cada tabela.

   "De onde veio esse número?" é a primeira pergunta em qualquer reunião
   onde o número desagrada. Respondida no próprio documento, a discussão
   passa direto para o que fazer a respeito. */
function fonteDocumento(texto){
  return `<div class="doc-fonte">Fonte: ${texto}</div>`;
}

/* A "Base de preparação" desceu para cá (06/08/2026).

   É um parágrafo de três linhas explicando O QUE FOI CONTADO. Informação
   necessária — é a diferença entre "o número está errado" e "o número
   responde outra pergunta" — mas ninguém a lê ANTES do número; lê depois,
   quando o número desagrada.

   Estava entre o cabeçalho e o primeiro dado, empurrando o conteúdo folha
   abaixo em todos os três relatórios. No rodapé cumpre a mesma função, ao
   lado da nota de alcance e limitações, que é a seção do mesmo assunto. */
/* Aviso de conferência dos números da carga, impresso no próprio relatório.

   Pedido do gestor (15/08/2026): "o relatório precisa ser muito fiel aos
   números das cargas, não pode existir erro nesse relatório".

   O sistema não tem como adivinhar que `118713` era pra ser `118173`, nem
   escolher qual das duas cargas `118105` é a verdadeira. O que ele PODE
   fazer — e não fazia — é parar de imprimir um total como se estivesse
   tudo certo. Número repetido soma a mesma carga duas vezes no rodapé, que
   é exatamente a conferência de tonelagem que não fechava.

   Fica junto do total, não no fim da folha: quem confere olha o total, e é
   ali que a dúvida precisa aparecer. Não bloqueia nada — o relatório sai
   igual, só deixa de esconder. */
function avisoDeNumeracao(lista){
  const p = problemasDeNumeracao(lista);
  if(!p.total) return '';

  const partes = [];
  if(p.duplicados.length){
    const itens = p.duplicados.map(d =>
      `<strong>${esc(d.numero)}</strong> (${d.quantidade}× — ${esc(d.placas.join(', '))}` +
      `${d.pesoSomado ? ` · ${(d.pesoSomado/1000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} t somadas` : ''})`
    ).join(' · ');
    partes.push(`<strong>${p.duplicados.length} número(s) repetido(s):</strong> ${itens}. `
      + 'O total acima soma essas cargas mais de uma vez.');
  }
  if(p.foraDoPadrao.length){
    const itens = p.foraDoPadrao.map(f =>
      `<strong>${esc(f.numero)}</strong> (${esc(f.carga.placa)})`).join(' · ');
    partes.push(`<strong>${p.foraDoPadrao.length} número(s) fora do padrão:</strong> ${itens}.`);
  }
  if(p.semNumero.length){
    const itens = p.semNumero.map(c => esc(c.placa)).join(' · ');
    partes.push(`<strong>${p.semNumero.length} carga(s) sem número:</strong> ${itens}.`);
  }

  return `<div class="doc-aviso-numeracao">
    <strong>⚠ Conferir antes de usar este relatório</strong><br>${partes.join('<br>')}
  </div>`;
}

function rodapeDocumento(nota, base, ficha){
  return `<div class="doc-rodape">
      ${nota ? `<div class="doc-nota">${nota}</div>` : ''}
      ${ficha || ''}
      ${base ? `<div class="doc-base"><strong>Base de preparação.</strong> ${base}</div>` : ''}
      <div class="doc-limitacoes">
        <strong>Alcance e limitações.</strong> Documento gerado automaticamente a
        partir dos registros operacionais do pátio, na data e hora de emissão
        indicadas acima. Reflete o que foi registrado pelos setores até aquele
        instante; registros feitos sem conexão sobem quando a rede retorna e podem
        alterar números de emissões anteriores. Não constitui documento fiscal
        nem contábil.
      </div>
      <div class="doc-assinatura">
        Programação de Embarque Suinco · embarquesuinco.com.br
        <span class="doc-pagina"></span>
      </div>
    </div>`;
}

/* Título de seção do PDF — mesma marcação repetida várias vezes no executivo. */
function tituloSecaoPdf(texto, sub){
  return `<div class="print-secao">
      <div class="print-secao-tit">${texto}</div>
      ${sub ? `<div class="print-secao-sub">${sub}</div>` : ''}
    </div>`;
}

/* Tabela de distribuição por status, com a cor de cada status.
   A cor é a MESMA da badge da tela (STATUS_COR_RELATORIO em data.js) — o
   gestor lê o PDF com o mesmo código de cores do painel. */
/* `ocultarZerados` existe para o bloco de concluídas.

   Nas cargas EM ABERTO, etapa vazia é informação: "nenhuma carga parada em
   Faturamento" diz algo ao gestor. Nas CONCLUÍDAS não: por definição elas
   estão todas em "Seguiu Viagem", então os outros cinco status saem sempre
   zerados e enchem meia página com linhas que não dizem nada. */
function blocoDistribuicaoStatus(dist, total, titulo, explicacao, ocultarZerados){
  if(ocultarZerados) dist = dist.filter(d => d.qtd > 0);
  if(ocultarZerados && !dist.length){
    return tituloSecaoPdf(titulo, explicacao) +
      `<div class="print-vazio">Nenhuma carga concluída no período.</div>`;
  }
  return tituloSecaoPdf(titulo, explicacao) +
    `<table>
      <thead><tr><th>Status</th><th>Setor responsável</th><th>Cargas</th><th>% do total</th><th>Distribuição</th></tr></thead>
      <tbody>
        ${dist.map(d=>`
          <tr>
            <td><span class="status-pill" style="background:${d.cor.fundo};color:${d.cor.texto};border-color:${d.cor.borda}">${esc(d.status)}</span></td>
            <td class="text-dim">${esc(d.setor)}</td>
            <td class="num-forte">${d.qtd}</td>
            <td>${total ? d.pct + '%' : '—'}</td>
            <td class="barra-cel">
              <span class="barra-trilho"><span class="barra-preenche" style="width:${d.pct}%;background:${d.cor.destaque}"></span></span>
            </td>
          </tr>`).join('')}
      </tbody>
      <tfoot><tr><th>Total</th><th></th><th class="num-forte">${total}</th><th>${total ? '100%' : '—'}</th><th></th></tr></tfoot>
    </table>`;
}

/* Linha do tempo das cargas no relatório executivo.
   Formato de matriz — uma linha por carga, uma coluna por etapa do fluxo —
   em vez de repetir a timeline vertical da tela para cada carga: assim o
   gestor compara as cargas entre si e enxerga de imediato onde uma delas
   travou. Cada célula traz a HORA e o OPERADOR que registrou aquele passo
   (pedido explícito: "qual operador fez o input"), com a cor do status.
   Etapa não ocorrida fica visivelmente vazia — é o que denuncia o gargalo. */
function blocoTimelineCargas(cargas, titulo, explicacao){
  if(!cargas.length){
    return tituloSecaoPdf(titulo, explicacao) +
      `<div class="print-vazio">Nenhuma carga no recorte deste relatório.</div>`;
  }
  const linhas = cargas.map(c=>{
    const historico = historicoDaCarga(c.id);
    const sequencia = sequenciaDeStatusDaCarga(historico);
    const ind = indicadoresDaCarga(c.id);
    const celulas = STATUS_FLOW.map(status=>{
      // Carga que nasceu em "Aguardando Carga" nunca teve "Aguardando
      // Veículo" — marcamos como não aplicável em vez de fingir atraso.
      if(!sequencia.includes(status)){
        return `<td class="tl-cel tl-na" title="Etapa não aplicável a esta carga">n/a</td>`;
      }
      const mov = historico.find(m=>m.statusNovo===status);
      if(!mov) return `<td class="tl-cel tl-pendente">—</td>`;
      const cor = corStatusRelatorio(status);
      /* A cor do texto vai na CÉLULA, não só na hora.

         O operador e o setor usavam cor fixa do tema e sumiam sobre as
         células escuras — "Seguiu Viagem" é verde-escuro, e nome do
         operador em cor de texto claro do tema desaparecia na folha. Com a
         cor no `td`, as três linhas herdam o par certo de fundo e texto. */
      return `<td class="tl-cel" style="background:${cor.fundo};color:${cor.texto};border-left:3px solid ${cor.borda}">
          <span class="tl-hora">${fmtHora(mov.timestamp)}</span>
          <span class="tl-quem">${esc(mov.operador)}</span>
          <span class="tl-setor">${esc(mov.setor)}</span>
        </td>`;
    }).join('');
    return `<tr>
        <td class="tl-carga">
          <span class="tl-placa">${esc(c.placa)}</span>
          <span class="tl-num">${esc(c.numeroCarga || '—')}</span>
          <span class="tl-transp">${esc(c.transportadora || '—')}</span>
        </td>
        ${celulas}
        <td class="tl-total">${fmtDuracao(ind.tempoPatioTotal)}</td>
      </tr>`;
  }).join('');

  return tituloSecaoPdf(titulo, explicacao) +
    `<table class="tabela-timeline">
      <thead>
        <tr>
          <th>Carga</th>
          ${STATUS_FLOW.map(s=>{
            const cor = corStatusRelatorio(s);
            /* A cor do status vira SUBLINHADO, não cor do texto.

               No papel o cabeçalho tem fundo claro, e `cor.texto` é a cor
               feita para ir SOBRE o fundo colorido do status — clara. Clara
               sobre claro é texto invisível, e foi exatamente o que saiu na
               folha: "Aguardando Veículo" e "Seguiu Viagem" sumiram.

               Com o sublinhado, a coluna continua codificada por cor e o
               texto fica legível nos dois fundos. */
            return `<th style="border-bottom:3px solid ${cor.fundo}">`
                 + `<span class="tl-th">${esc(s)}</span></th>`;
          }).join('')}
          <th>Pátio</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
    <div class="print-legenda">
      Cada célula mostra a <strong>hora</strong> e o <strong>operador</strong> que registrou a etapa, com o setor abaixo.
      <strong>—</strong> = etapa ainda não ocorrida · <strong>n/a</strong> = etapa não aplicável (carga registrada direto no pátio, sem programação prévia).
      <strong>Pátio</strong> = tempo entre a chegada física e a saída.
    </div>`;
}

async function exportarPdfExecutivo(){
  await atualizarDadosAntesDoRelatorio();
  const el = document.getElementById('print-executivo');
  const agora = new Date();

  /* Respeita o mesmo filtro de Data da Programação dos outros relatórios.
     Antes o executivo ignorava o filtro e saía sempre com tudo — o gestor
     recortava o período, gerava, e recebia um relatório de outro recorte
     sem nenhum aviso. */
  const doPeriodo = cargasDoRelatorio();
  const abertas = doPeriodo.filter(c=>c.status!=='Seguiu Viagem');

  /* Caminhões que a Portaria registrou SEM programação prévia
     (aguardandoCarga) precisam de conta própria, e o motivo é um bug real
     achado na auditoria de 11/08/2026: o indicador "Aguardando Dados da
     Carga" era calculado sobre `abertas`, que vem de cargasDoRelatorio()
     — e essa função exclui aguardandoCarga de propósito. O número era,
     por construção, SEMPRE ZERO.

     Pior que um número errado: um número que parece tranquilizador. O
     gestor lia "0 aguardando dados" com dois caminhões parados no pátio
     sem nota, ocupando doca, esperando alguém completar o cadastro.

     Ficam fora da LISTA do relatório (não há o que sequenciar sem número
     de carga, peso nem rota — esse critério continua certo), mas entram
     na CONTAGEM, que é o que responde "o que está me travando agora". */
  const { de: _relDe, ate: _relAte } = periodoRelatorio();
  const aguardandoDados = filtrarPorDataProgramacao(
    DB.cargas.filter(c=>c.aguardandoCarga), _relDe, _relAte);
  const concluidasTodas = doPeriodo.filter(c=>c.status==='Seguiu Viagem');
  const concluidasHoje = concluidasTodas;

  // Lead time médio do histórico completo (mesma conta da versão anterior).
  let somaLead=0, nLead=0;
  concluidasTodas.forEach(c=>{
    const ind = indicadoresDaCarga(c.id);
    if(ind.leadTimeTotal!==null){ somaLead+=ind.leadTimeTotal; nLead++; }
  });
  // Lead time médio só do dia — é o número que o gestor cobra na reunião.
  let somaHoje=0, nHoje=0;
  concluidasHoje.forEach(c=>{
    const ind = indicadoresDaCarga(c.id);
    if(ind.leadTimeTotal!==null){ somaHoje+=ind.leadTimeTotal; nHoje++; }
  });

  const distAbertas = distribuicaoPorStatus(abertas);
  const distHoje = distribuicaoPorStatus(concluidasHoje);

  /* Quantas cargas AINDA ABERTAS já passaram da meta de pátio.
     É o número que decide a manhã do gestor, e por isso ocupa a primeira
     casa do painel. Conta sobre a mesma meta usada no resto do relatório
     (metaTempoPatio), para que dois números do mesmo documento não
     discordem entre si.

     Conta sobre TODAS as abertas, e não sobre analiseGargalos().pendentesAntigas
     — essa lista é cortada em dez para caber na folha, e um indicador que
     empaca em "10" quando há quinze cargas travadas engana justamente no
     dia em que o gestor mais precisa dele. */
  /* Pela CHEGADA, pela mesma função da lista de Gargalos (data.js). Contar
     por atualizadoEm imprimia "0 Paradas Além da Meta" com um caminhão
     parado 17h47 — duas linhas acima da timeline que mostrava a chegada
     às 06:00. Auditoria de 09/09/2026. */
  const metaPatio = metaTempoPatio();
  const paradas = paradasAlemDaMeta(abertas);
  const paradasAlemDaMeta_ = paradas.total;

  el.innerHTML = `
    <div class="print-page doc-normal">
      ${cabecalhoDocumento({
        titulo: 'Relatório Executivo',
        subtitulo: 'Logística — indicadores, gargalos e pontos críticos do pátio',
      })}

      <!-- A legenda de cores saiu daqui (05/08/2026).

           Ela faz sentido no relatório OPERACIONAL, que vira foto no grupo
           do WhatsApp para quem está no pátio sem o painel aberto e precisa
           saber o que cada cor significa.

           No executivo é ruído: o leitor é a diretoria, que olha número, e
           os chips coloridos logo abaixo do cabeçalho pareciam botões de
           filtro. A distribuição por status vem logo abaixo, com o nome do
           status escrito por extenso em cada linha. -->

      <!-- ORDEM DO DOCUMENTO: por decisão, não por tema.

           A versão anterior seguia a ordem natural de quem escreve um
           relatório: volume, depois médias, depois análise, e o que exige
           ação hoje aparecia na página três, no meio dos gargalos.

           Gestor de logística lê de cima para baixo e decide nos primeiros
           trinta segundos. A pergunta dele é "o que falta terminar?", não
           "como foi ontem?". A ordem agora responde nessa sequência:

             1. O QUE EXIGE AÇÃO AGORA — o que está travado e há quanto tempo
             2. ONDE ESTÁ A FILA      — em que etapa o pátio acumulou
             3. ONDE O TEMPO SE PERDE — média de pátio e gargalos do período
             4. HISTÓRICO             — o que já saiu, para conferência

           Concluída não some do relatório: desce. Ela serve para conferir e
           para fechar o dia, não para decidir. -->

      <div class="print-bloco-tit">1 · O que exige ação agora</div>

      <div class="grid4" style="margin-bottom:18px">
        ${metaNosIndicadores() ? `<div class="stat-box"><div class="stat-num">${paradasAlemDaMeta_}</div><div class="stat-label">Paradas Além da Meta</div></div>` : ''}
        <div class="stat-box"><div class="stat-num">${aguardandoDados.length}</div><div class="stat-label">Aguardando Dados da Carga</div></div>
        <div class="stat-box"><div class="stat-num">${abertas.length}</div><div class="stat-label">Cargas em Aberto</div></div>
        <div class="stat-box"><div class="stat-num">${fmtDuracao(nHoje?Math.round(somaHoje/nHoje):null)}</div><div class="stat-label">Lead Time Médio (período)</div></div>
      </div>

      ${blocoPendentesAntigasPdf(doPeriodo)}

      <div class="print-bloco-tit">2 · Onde está a fila</div>

      ${painelStatusHorizontal(distAbertas, abertas.length,
        'Cargas em aberto por status',
        'Onde está parada, agora, cada carga que ainda não saiu. Leia da esquerda para a direita: é o caminho do caminhão pelo pátio, e um acúmulo mostra onde a fila está se formando.')}

      ${blocoTimelineCargas(abertas,
        'Linha do tempo — cargas ainda em aberto',
        'Carga a carga: as colunas vazias à direita mostram em qual etapa cada uma está parada agora, e quem registrou a última.')}

      <div class="print-bloco-tit">3 · Onde o tempo se perde</div>

      ${blocoTempoMedioPatioPdf(concluidasTodas)}

      ${blocoRankingAtrasoPdf(doPeriodo)}

      ${blocoGargalosPdf(doPeriodo)}

      <!-- A linha do tempo carga-a-carga das CONCLUÍDAS saiu daqui (08/08/2026).

           Pedido do usuário: "tem muita informação ali" — ele chegou a sugerir
           fundir esta tabela com a das cargas em aberto (seção 2), depois
           recuou e pediu pra eu achar a melhor solução usando a queixa real,
           não a sugestão literal.

           A tabela em matriz (uma linha por carga, uma coluna por etapa, com
           hora+operador em cada célula) é o formato certo pra decidir sobre
           cargas ABERTAS — é o que aparece na seção 2. Repeti-la aqui pras
           concluídas duplicava esse mesmo nível de detalhe operacional pra
           cargas que, pela própria lógica do documento (comentário "ORDEM DO
           DOCUMENTO" acima), servem só pra "conferir e fechar o dia, não pra
           decidir". Era a seção mais pesada do relatório (uma tabela inteira
           de 8 colunas) resolvendo a pergunta de menor prioridade.

           Ficou só blocoDistribuicaoStatus: quantas cargas saíram e quando —
           a pergunta que "conferência" realmente faz. Quem precisa do
           carga-a-carga de uma concluída específica busca ela no Histórico
           (que já tem timeline vertical por carga, sob demanda). -->

      ${blocoDistribuicaoStatus(distHoje, concluidasHoje.length,
        'Cargas concluídas',
        'Cargas que chegaram a "Seguiu Viagem" — o caminhão saiu do pátio. Só esse status conta como concluída.',
        true)}

      ${rodapeDocumento(
        '<strong>Lead Time</strong> = da criação da carga até a saída do caminhão. ' +
        '<strong>Tempo de Pátio</strong> = da chegada física até a saída. ' +
        `Lead time médio no período: ${fmtDuracao(nLead?Math.round(somaLead/nLead):null)}.`,
        'Indicadores calculados sobre as cargas CONCLUÍDAS no período — as que '
        + 'percorreram as seis etapas até "Seguiu Viagem". Carga ainda em '
        + 'andamento não entra em média de tempo: etapa sem fim não tem duração, '
        + 'e contá-la como zero puxaria a média para baixo.',
        fichaDocumento({
          titulo: 'Relatório Executivo',
          contagem: doPeriodo.length,
          extra: `<strong>Em aberto:</strong> ${abertas.length} · <strong>Concluídas:</strong> ${concluidasTodas.length}`,
        }))}
    </div>`;
  await exportarViaServidor(el, 'Relatorio-Executivo', 'relatorio-executivo');
}

