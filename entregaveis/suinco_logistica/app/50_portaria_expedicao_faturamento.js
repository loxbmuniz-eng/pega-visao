/* ---------- PORTARIA ---------- */
async function acaoChegadaUI(){
  const input = document.getElementById('portaria-placa');
  const placa = input.value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  /* Antes de registrar chegada, puxa o servidor (19/08/2026).

     O caso que motivou isto: o caminhão saiu sem a Portaria registrar a
     saída, e no dia seguinte o porteiro clicou "Chegou". No terminal dele a
     carga anterior não estava à vista — lista velha —, então a checagem
     local não tinha o que checar e nasceu uma carga duplicada. Uma leitura
     de meio segundo antes do clique resolve o caso comum; o servidor
     continua sendo quem recusa de verdade (PLACA_COM_CARGA_ABERTA). */
  if(SuincoSharePoint && SuincoSharePoint.estaConfigurado && SuincoSharePoint.estaConfigurado()){
    try{ await SuincoSharePoint.sincronizarAgora(); }
    catch(e){ /* sem rede: segue com o que há e o servidor decide depois */ }
  }
  /* A ETAPA DEVOLVIDA PEDE CONFIRMAÇÃO — 29/08/2026, relato do FTZ2138.

     Aqui era onde o laço se fechava: a carga que a Administração devolveu
     para "Aguardando Veículo" reaparece na fila da Portaria como "não
     chegou", e o "Chegou" a empurrava de volta na hora, calado. Quem
     corrigiu tentava de novo, e a coisa girava.

     PERGUNTA, NÃO BLOQUEIA. A Portaria tem autoridade sobre a chegada e o
     caminhão pode de fato ter chegado de novo — botão desabilitado não
     ensina o caminho, só nega. O que faltava não era permissão, era a
     INFORMAÇÃO de que aquilo tinha sido feito de propósito, por alguém,
     com motivo. A pergunta traz quem, quando e de onde para onde.

     Roda DEPOIS do `sincronizarAgora()` acima, de propósito: a devolução
     pode ter acabado de acontecer em outro terminal, e perguntar com lista
     velha é não perguntar. */
  const devolvidas = cargasAbertasPorPlaca(normalizarPlaca(placa))
    .map(c => ({ carga: c, d: etapaDevolvida(c) }))
    .filter(x => x.d && x.d.aindaVale && x.d.para === 'Aguardando Veículo');
  if(devolvidas.length){
    const { carga, d } = devolvidas[0];
    const quando = d.quando ? fmtDataHora(d.quando) : 'horário não registrado';
    const qual = carga.numeroCarga ? `a carga ${carga.numeroCarga}` : 'esta carga';
    const ok = confirm(
      `${normalizarPlaca(placa)}: a etapa foi DEVOLVIDA de propósito.\n\n`
      + `${d.setor} (${d.quem}) devolveu ${qual} de "${d.de}" para "${d.para}" em ${quando}.\n`
      + `O motivo está no Histórico da carga.\n\n`
      + `Registrar a chegada agora desfaz essa correção.\n`
      + `O caminhão chegou de novo?`);
    if(!ok){
      notify(`Chegada NÃO registrada — ${normalizarPlaca(placa)} continua em "${d.para}", `
        + `como ${d.setor} deixou. Se o caminhão chegou mesmo, clique "Chegou" e confirme.`,
        'info', 9000);
      input.value = '';
      input.focus();
      return;
    }
  }

  let r;
  try{
    r = registrarChegadaPortaria(placa, nomeOperadorAtual());
  }catch(e){
    // A trava de frota na chegada (14/08/2026) passou a RECUSAR placa fora
    // do cadastro. Sem este try/catch o erro subia sem tratamento e o
    // porteiro não via aviso nenhum — a tela ficava muda, que é o pior
    // resultado possível para quem está com o caminhão parado no portão.
    notify(e.message, 'danger', 9000);
    input.focus();
    input.select();
    return;
  }
  if(r.criadas.length){
    notify(`${normalizarPlaca(placa)}: nenhuma programação encontrada — criada entrada "Aguardando Carga" (status Aguardando Embarque). Avise a Logística para completar os dados.`, 'warn');
    tocarBeepConfirmacao();
  } else if(r.atualizadas.length){
    notifyGravacao(`${normalizarPlaca(placa)}: ${r.atualizadas.length} carga(s) agora em "Aguardando Embarque".`);
    tocarBeepConfirmacao();
  } else if(r.jaNoPatio.length){
    /* Aviso ALTO, e não informativo: este é o momento em que o porteiro
       está prestes a registrar uma chegada que não pode existir. A carga
       anterior precisa SAIR primeiro — se o caminhão já foi embora sem
       baixa, é a saída que está faltando, não a chegada. */
    notify(`${normalizarPlaca(placa)} ainda tem carga em aberto (${r.jaNoPatio.map(c=>c.numeroCarga || c.status).join(', ')}). `
      + 'Registre a SAÍDA desse caminhão antes de registrar a chegada dele de novo — '
      + 'se ele já foi embora sem baixa, use o botão "Saiu".', 'warn', 12000);
  }
  input.value = '';
  input.focus();
  renderAll();
}
/* A SAÍDA DO PÁTIO — REESCRITA DEPOIS DO INCIDENTE DE 28/08/2026.

   O QUE ACONTECEU. A Portaria deu saída na placa PUX2971 às 06:38. No
   terminal do porteiro apareceu "Seguiu Viagem", com beep de confirmação, e
   no Histórico dele a movimentação estava lá. A Bruna, em OUTRO terminal,
   continuou vendo o caminhão no pátio; ligou para o Alysson, que às 08:59
   deu a saída de novo — e o servidor aceitou, porque para ele a carga
   nunca tinha saído. Duas horas e meia com o pátio dizendo uma coisa e o
   painel de cada um dizendo outra.

   POR QUE ACONTECEU — três defeitos meus, empilhados:

   1. A rota `POST /api/portaria/saida` existe no servidor desde 20/08 e
      NINGUÉM a chamava. A saída era escrita no navegador e entregue à
      sincronia comum. A etapa que solta o caminhão do pátio era a única
      que não falava direto com quem manda.
   2. `acaoChegadaUI` puxa o servidor ANTES de agir desde 19/08, justamente
      porque lista velha produz decisão errada. A saída, que é o espelho
      dela, nunca ganhou o mesmo cuidado. Uma função, dois chamadores — e
      aqui eram dois caminhos com um cuidado só.
   3. A confirmação era otimista: o beep e o "saída registrada" tocavam
      antes de qualquer resposta do servidor. Sem rede, ou com o terminal
      em modo local, a fila offline engolia tudo em silêncio e o porteiro
      liberava o caminhão achando que estava tudo gravado.

   COMO FICA. Quem decide o que saiu é o SERVIDOR, dentro de uma transação,
   lendo o estado real da placa. A tela só repete o que ele respondeu. Se
   ele não responder, o porteiro é avisado ALTO e a placa fica marcada como
   não confirmada até alguém resolver — porque caminhão liberado com saída
   não gravada é o começo da carga fantasma do dia seguinte. */
async function acaoSaidaUI(){
  const input = document.getElementById('portaria-placa');
  const placa = normalizarPlaca(input.value);
  if(!placa){ notify('Informe a placa.','warn'); return; }
  const lerLacre = (id) => {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };
  const lacres = ['portaria-lacre', 'portaria-lacre-2', 'portaria-lacre-3']
    .map(lerLacre).filter(Boolean);
  const limparLacres = () => ['portaria-lacre', 'portaria-lacre-2', 'portaria-lacre-3']
    .forEach((id) => { const el = document.getElementById(id); if(el) el.value = ''; });

  const comServidor = typeof SuincoSharePoint !== 'undefined'
    && SuincoSharePoint.estaConfigurado && SuincoSharePoint.estaConfigurado()
    && typeof SuincoSharePoint.portariaSaida === 'function';

  /* SEM SERVIDOR NÃO EXISTE SAÍDA CONFIRMADA, e a tela precisa dizer isso
     com todas as letras. O caminho local continua existindo — o porteiro
     está com o caminhão na frente e não pode ficar parado —, mas ele sai
     daqui SABENDO que a baixa ainda não é oficial. */
  if(!comServidor){
    const r = registrarSaidaPortaria(placa, nomeOperadorAtual(), lacres);
    if(r.liberadas.length) limparLacres();
    marcarSaidaNaoConfirmada(placa, r.liberadas.length,
      'este terminal está sem servidor');
    avisarPendentesDaSaida(placa, r);
    input.value = ''; input.focus();
    await despedirCargas(_movIdsLiberados(r.liberadas));
    renderAll();
    return;
  }

  /* Lista velha decide errado: uma leitura antes do clique é o que separa
     "o servidor não sabia da segunda carga" de "o porteiro foi avisado". */
  try{ await SuincoSharePoint.sincronizarAgora(); }
  catch(e){ /* sem rede agora; o POST abaixo é quem vai dizer a verdade */ }

  let resposta;
  try{
    resposta = await comOverlaySync('Registrando a saída no servidor…',
      () => SuincoSharePoint.portariaSaida(placa, lacres));
  }catch(e){
    /* A saída NÃO foi gravada. Registrar localmente aqui só recriaria o
       defeito de hoje — tela verde, servidor mudo. O que se faz é gritar. */
    notify(`${placa}: a saída NÃO foi registrada no servidor `
      + `(${e && e.message ? e.message : 'sem resposta'}). `
      + 'NÃO libere o caminhão sem registrar — tente de novo, e se não passar, '
      + 'avise a Logística agora.', 'danger', 20000);
    tocarAlertaAlteracao();
    marcarSaidaNaoConfirmada(placa, 0, e && e.message ? e.message : 'sem resposta do servidor');
    input.focus(); input.select();
    return;
  }

  /* A verdade é a do servidor: o painel adota a resposta dele em vez de
     confiar no que tinha em memória. */
  await SuincoSharePoint.sincronizarAgora().catch(()=>{});
  const liberadas = (resposta && resposta.liberadas) || [];
  const pendentes = (resposta && resposta.pendentes) || [];
  limparSaidaNaoConfirmada(placa);

  if(liberadas.length){
    limparLacres();
    notifyGravacao(`${placa}: saída CONFIRMADA pelo servidor para ${liberadas.length} carga(s) — `
      + `Seguiu Viagem${lacres.length ? `, lacre ${lacres.join(' · ')}` : ''}.`);
    tocarBeepConfirmacao();
  }
  if(liberadas.length && !lacres.length){
    notify(`${placa} saiu SEM número de lacre informado. A saída está registrada; `
      + 'informe o lacre no campo ao lado da placa nas próximas.', 'warn', 7000);
  }
  avisarPendentesDaSaida(placa, { liberadas, pendentes });
  input.value = '';
  input.focus();
  /* O caminhão sai do pátio ANTES do redesenho. Se `renderAll()` viesse
     primeiro, a linha já teria sido apagada no primeiro quadro e não
     sobraria nada para ver — quem confirmou a saída ficaria sem saber qual
     das cargas da placa foi embora. Espera no máximo 240 ms. */
  await despedirCargas(_movIdsLiberados(liberadas));
  renderAll();
}

/* Os ids das cargas que o servidor (ou o caminho local) declarou liberadas.
   A resposta do servidor vem em snake_case e a local em camelCase — uma
   função só lê as duas, em vez de duas listas que divergem na primeira
   mudança de rota. */
function _movIdsLiberados(liberadas){
  return (liberadas || []).map(c => (c && (c.id || c.carga_id)) || c).filter(Boolean);
}

/* O caminhão sai UMA vez, mas a placa pode ter mais de uma carga. Carga que
   fica para trás não pode ser um aviso que some em cinco segundos: ela é o
   motivo pelo qual outro setor vai continuar vendo o caminhão no pátio —
   foi o que a Bruna viu hoje. Então fica escrito na tela da Portaria. */
function avisarPendentesDaSaida(placa, r){
  const pendentes = r.pendentes || [];
  if(!pendentes.length && !r.liberadas.length){
    notify(`Nenhuma carga em aberto encontrada para a placa ${placa}.`, 'warn', 9000);
  }
  const faixa = document.getElementById('portaria-saida-aviso');
  if(!faixa) return;
  /* NÃO APAGA UM AVISO DE PERIGO. Os dois avisos moram na mesma faixa, e a
     ordem em que são escritos não pode decidir qual sobrevive: "a saída não
     foi confirmada" é mais grave que "sobrou carga" e não pode ser
     silenciado por não haver pendência. Este defeito apareceu no primeiro
     teste — o modo local levantava a faixa e ela era apagada uma linha
     depois. */
  if(faixa.className.indexOf('aviso-faixa-perigo') >= 0 && !faixa.hidden) return;
  if(!pendentes.length){ faixa.hidden = true; faixa.innerHTML = ''; return; }
  const lista = pendentes.map(c => `${esc(c.numeroCarga || c.numero_carga || c.id || '—')} `
    + `(${esc(c.status || c.status_atual || '—')})`).join(', ');
  faixa.hidden = false;
  faixa.className = 'aviso-faixa aviso-faixa-warn';
  faixa.innerHTML = `<strong>${esc(placa)}: ${pendentes.length} carga(s) NÃO saíram</strong> — `
    + `${lista}. Só sai o que está Faturado. Enquanto elas estiverem abertas, `
    + 'os outros setores continuam vendo este caminhão no pátio.';
  if(pendentes.length) tocarAlertaAlteracao();
}

/* Saída que não chegou ao servidor não pode virar assunto encerrado. Fica
   na tela, com a placa, até alguém registrar de verdade. */
function marcarSaidaNaoConfirmada(placa, quantas, motivo){
  notify(`${placa}: saída registrada SÓ NESTE TERMINAL (${motivo}). `
    + 'Os outros setores continuam vendo o caminhão no pátio. '
    + 'Confirme com a Logística antes de considerar resolvido.', 'danger', 20000);
  tocarAlertaAlteracao();
  const faixa = document.getElementById('portaria-saida-aviso');
  if(!faixa) return;
  faixa.hidden = false;
  faixa.className = 'aviso-faixa aviso-faixa-perigo';
  faixa.innerHTML = `<strong>⚠ ${esc(placa)}: saída NÃO confirmada pelo servidor</strong> — `
    + `${esc(motivo)}. ${quantas ? quantas + ' carga(s) mudaram só nesta tela. ' : ''}`
    + 'Registre de novo quando a conexão voltar, ou avise a Logística.';
}

function limparSaidaNaoConfirmada(placa){
  const faixa = document.getElementById('portaria-saida-aviso');
  if(faixa && faixa.className.indexOf('aviso-faixa-perigo') >= 0
     && faixa.innerHTML.indexOf(placa) >= 0){
    faixa.hidden = true; faixa.innerHTML = '';
  }
}

/* Retenção de lacre na inspeção da saída — pedido do gestor (18/08/2026).

   PASSA PELO SERVIDOR (20/08/2026). Antes isto era gravação local que subia
   junto com o resto da carga, e o motivo/autor/hora viviam só dentro do
   texto da observação. Agora existe rota própria e três campos próprios
   (migração 027), porque o gestor precisa dessa informação FIEL no
   relatório — e observação é campo que qualquer setor edita.

   O retorno do servidor é a fonte da verdade: se ele não achou carga para
   a placa, a tela diz isso em vez de fingir que gravou. */
async function registrarLacreRetidoUI(){
  const v = (id)=> (document.getElementById(id)||{}).value || '';
  const placa = v('lacre-ret-placa');
  if(!normalizarPlaca(placa)){ notify('Informe a placa do caminhão.','warn'); return; }
  const retido = v('lacre-ret-numero').trim();
  if(!retido){ notify('Informe o número do lacre retido.','warn'); return; }
  const novo = v('lacre-ret-novo').trim();
  const motivo = v('lacre-ret-motivo').trim();
  if(!motivo){
    notify('Diga o motivo da retenção — é ele que vai para o relatório e explica a ocorrência depois.', 'warn', 7000);
    return;
  }
  try{
    const r = await comOverlaySync('Registrando a retenção do lacre…',
      () => SuincoSharePoint.reterLacre({
        placa: normalizarPlaca(placa), lacreRetido: retido, novoLacre: novo, motivo,
      }));
    if(!r.total){
      notify(`Nenhuma carga encontrada para a placa ${normalizarPlaca(placa)} — nem saída de hoje, nem em aberto.`, 'warn', 7000);
      return;
    }
    await SuincoSharePoint.sincronizarAgora();
    notifyGravacao(`${normalizarPlaca(placa)}: lacre ${retido} retido em ${r.total} carga(s)`
      + (novo ? ` — novo lacre ${novo}` : '') + '.');
    tocarBeepConfirmacao();
    ['lacre-ret-placa','lacre-ret-numero','lacre-ret-novo','lacre-ret-motivo']
      .forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
    renderAll();
  }catch(e){
    notify('Não consegui registrar a retenção: ' + (e && e.message ? e.message : 'erro no servidor')
      + '. O lacre NÃO foi marcado como retido.', 'danger', 9000);
  }
}
/* Fila da Portaria com ação direta por linha.

   Motivo: o registro por digitação de placa continua existindo (é mais rápido
   para quem já decorou a placa e está com o caminhão na frente), mas obriga a
   digitar certo. O botão por linha elimina o erro de digitação, que era a
   principal fonte de retrabalho na portaria.

   O botão só aparece quando a ação é VÁLIDA para o status atual — a máquina de
   estados não é contornada aqui, apenas exposta. Carga em "Aguardando Veículo"
   mostra Chegou; em "Faturado" mostra Saiu; nas etapas intermediárias não
   mostra nada, porque a ação é de outro setor. */
function renderPortariaProgramadas(){
  const lista = cargasAbertas().slice().sort(ordenarPorAcaoDoSetor('Portaria'));
  const tb = document.getElementById('portaria-prog-tbody');
  if(!tb) return;
  tb.innerHTML = lista.map(c=>{
    let acao = '<span class="text-dim">—</span>';
    if(c.status === 'Aguardando Veículo'){
      acao = `<button class="btn btn-success btn-sm" onclick="portariaChegouCarga('${escJs(c.placa)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-caminhao"/></svg>Chegou</button>`;
    } else if(c.status === 'Faturado'){
      acao = `<button class="btn btn-warn btn-sm" onclick="portariaSaiuCarga('${escJs(c.placa)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-bandeira"/></svg>Saiu</button>`;
    } else if(c.status === 'Aguardando Embarque'){
      /* O CAMINHÃO QUE SÓ TROUXE DEVOLUÇÃO (08/09/2026).

         Pedido do dono, vindo da Portaria: "ele tem que ter a opção só de
         depois colocar lá que ele saiu, que é só devolução, então ele não
         vai carregar". E a rotina, nas palavras dele: "muitas vezes chega,
         descarrega e vai embora e muitas vezes chega, descarrega e fica no
         pátio aguardando carga novamente".

         Por isso o botão fica AQUI e não na entrada: qual dos dois casos é
         só se sabe na hora de sair. Quem vai carregar continua vendo o
         fluxo normal — este botão não substitui nada, ele acrescenta a
         única saída que faltava. */
      acao = `<button class="btn btn-sm btn-saida-devolucao"
        title="O caminhão entregou devolução e vai embora sem carregar."
        onclick="portariaSaiuSoDevolucaoUI('${escJs(c.id)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-desfazer"/></svg>Só devolução — saiu</button>`;
    }
    return `<tr>
      <td class="col-identificacao">${esc(c.placa)}${marcaCargaDaPlaca(c, lista)}${marcaEtapaDevolvidaHtml(c)}${marcaSaiuSemCarregarHtml(c)}</td>
      <td class="col-identificacao">${esc(c.numeroCarga)||'—'}</td>
      <td>${esc(c.transportadora)||'—'}</td>
      <td>${esc(rotaCurta(c.rota))}</td>
      <td>${badgeHtml(c.status)}${situacaoPlacaHtml(c)}</td>
      <td class="no-print">${acao}</td>
    </tr>`;
  }).join('');
  document.getElementById('portaria-prog-empty').hidden = lista.length>0;
}
// Reaproveitam exatamente o mesmo caminho da digitação por placa — inclusive o
// tratamento em lote da saída, já que o caminhão sai uma vez só.
function portariaChegouCarga(placa){
  document.getElementById('portaria-placa').value = placa;
  acaoChegadaUI();
}
function portariaSaiuCarga(placa){
  document.getElementById('portaria-placa').value = placa;
  acaoSaidaUI();
}

/* Saída do caminhão que entrou só para entregar devolução (08/09/2026).

   PERGUNTA EXPLICANDO, não bloqueia: é a regra da casa — "botão
   desabilitado não ensina o caminho, só nega". O porteiro tem autoridade
   para encerrar; o que ele precisa é saber o que o gesto faz antes de
   fazer. E o gesto é grande: encerra a carga sem passar por Expedição e
   Faturamento.

   Quem decide de verdade é o SERVIDOR — ele recusa a transição sem a
   confirmação e devolve a explicação. Aqui a pergunta é feita antes para
   não gastar a viagem, mas se alguém chamar esta função direto, a recusa
   continua acontecendo no lugar certo. */
async function portariaSaiuSoDevolucaoUI(cargaId){
  const c = DB.cargas.find(x=>x.id === cargaId);
  if(!c) return;
  const ok = confirm(
    `SAÍDA SEM CARREGAR — placa ${c.placa}\n\n`
    + 'Este caminhão ainda não carregou. Confirmando, fica registrado que ele '
    + 'entrou, entregou a devolução e foi embora sem carregar.\n\n'
    + 'Se ele vai FICAR no pátio para carregar, cancele: o fluxo normal segue '
    + 'pela Expedição.'
  );
  if(!ok) return;
  const r = await SuincoSharePoint.mudarStatus(cargaId, 'Seguiu Viagem', { soDevolucao: true });
  /* `mudarStatus` DEVOLVE a recusa em vez de lançar — quem chama precisa
     olhar o valor (regra da casa, e a ocorrência que a criou). */
  if(r && r.recusado){
    notify(r.erro || 'O servidor recusou a saída.', 'error');
    return;
  }
  if(r && r.enfileirado){
    notify('Sem servidor agora — a saída foi para a fila e sobe quando a conexão voltar.', 'warn');
    return;
  }
  /* Quem manda é a transação: só depois de o servidor confirmar é que a
     tela puxa o estado de volta. Escrever a saída local antes e sincronizar
     depois foi exatamente como a placa PUX2971 saiu na tela do porteiro
     sem o servidor saber (28/08). */
  await SuincoSharePoint.sincronizarAgora();
  notifyGravacao(`Placa ${c.placa} saiu — só devolução, sem carregamento.`);
  tocarBeepConfirmacao();
  await despedirCargas([cargaId]);
  renderAll();
}

function renderPortariaPatio(){
  const noPatio = cargasAbertas().filter(c=>c.status!=='Aguardando Veículo');
  const porPlaca = {};
  noPatio.forEach(c=>{ (porPlaca[c.placa] = porPlaca[c.placa]||[]).push(c); });
  const placas = Object.keys(porPlaca);
  document.getElementById('portaria-patio-tbody').innerHTML = placas.map(p=>{
    const cargas = porPlaca[p];
    const transp = cargas[0].transportadora || '—';
    /* Uma definição só de "entrada no pátio" — ver entradaNoPatioDe().
       Sem `|| c.criadoEm`: quando não há chegada registrada a coluna fica
       vazia, em vez de mostrar a data em que a linha foi criada com cara
       de hora de chegada. */
    const chegada = cargas.map(entradaNoPatioDe).filter(Boolean).sort()[0] || null;
    /* A CONTA ERA SÓ DO QUE JÁ ESTAVA NO PÁTIO (20/08/2026).

       No print do programador de embarque a placa aparecia aqui com "1
       carga em aberto" enquanto tinha DUAS — a segunda ainda esperava o
       registro de chegada. Contar só metade do caminhão é o mesmo
       mal-entendido da coluna Status, de outro ângulo: o caminhão é um só,
       e a Portaria precisa saber que falta encostar a outra. */
    const todas = cargasAbertasPorPlaca(p);
    const aguardando = todas.filter(c=>c.status === 'Aguardando Veículo');
    const contagem = aguardando.length
      ? `${cargas.length} no pátio <span class="sit-acao">+ ${aguardando.length} sem entrada</span>`
      : String(cargas.length);
    return `<tr>
      <td>${esc(p)}</td><td>${esc(transp)}</td><td>${contagem}</td>
      <td>${cargas.map(c=>badgeHtml(c.status)).join(' ')}
        ${aguardando.map(c=>`<span class="badge-espera" title="Esta carga da MESMA placa ainda não teve a chegada registrada.">${esc(c.numeroCarga)||'sem nº'}: aguardando entrada</span>`).join(' ')}</td>
      <td>${chegada ? fmtDataHora(chegada)
            : '<span class="text-dim">chegada não registrada</span>'}</td>
    </tr>`;
  }).join('');
  document.getElementById('portaria-patio-empty').hidden = placas.length>0;
}

/* ---------- AÇÃO POR PLACA COM SELETOR DE CARGA (Expedição/Faturamento) ----------
   Regra: se a placa tiver mais de uma carga elegível pra mesma transição,
   pergunta qual carga está sendo processada — EXCETO na Portaria (chegada/
   saída), que já tem sua própria lógica em lote acima. */
function acaoRapidaPlaca(inputId, statusOrigem, statusDestino){
  const input = document.getElementById(inputId);
  const placa = input.value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  const elegiveis = cargasAbertasPorPlaca(placa).filter(c=>c.status===statusOrigem);
  if(elegiveis.length===0){
    notify(`Nenhuma carga da placa ${normalizarPlaca(placa)} está em "${statusOrigem}".`, 'warn');
    return;
  }
  if(elegiveis.length===1){
    executarAvanco(elegiveis[0].id, statusDestino);
    input.value = '';
    return;
  }
  abrirModalPicker(elegiveis, statusDestino, ()=>{ input.value=''; });
}
/* FATURAR PEDE CONFIRMAÇÃO — e mostra QUAL carga (25/08/2026).

   Pedido do gestor: "quando o faturista clicar em FATURAR, aparecer um
   alerta na tela para confirmar aquela etapa".

   Faturar é a última etapa do pátio e a única que sai do painel para o
   dinheiro. Diferente de "Iniciar Embarque", que a pessoa corrige em
   dois cliques, uma carga faturada por engano vira nota emitida.

   A pergunta NÃO é "tem certeza?" — essa todo mundo aprende a clicar sem
   ler. A pergunta é "é esta carga?", e por isso a janela mostra número,
   placa, transportadora, destino e peso. O erro que ela existe para pegar
   é o de LINHA trocada numa tabela de dez cargas, não o de dedo.

   A trava mora aqui, no executarAvanco, e não no botão: as duas portas
   que chegam a "Faturado" (o botão da linha e o campo de placa da ação
   rápida, que ainda passa pelo seletor quando a placa tem mais de uma
   carga) desembocam nesta função. Guardar só o botão deixaria a outra
   porta destrancada. */
let _faturarPendente = null;

function pedirConfirmacaoFaturamentoUI(cargaId){
  const c = getCarga(cargaId);
  if(!c){ notify('Carga não encontrada.', 'danger'); return; }
  _faturarPendente = cargaId;
  const linha = (rot, val) => `<div class="fat-conf-linha">
      <span class="fat-conf-rot">${rot}</span>
      <span class="fat-conf-val">${esc(val) || '—'}</span></div>`;
  document.getElementById('faturar-resumo').innerHTML =
      linha('Nº da carga', c.numeroCarga)
    + linha('Placa', c.placa)
    + linha('Transportadora', c.transportadora)
    + linha('Destino', c.destino)
    + linha('Peso', `${(c.peso || 0).toLocaleString('pt-BR')} kg`);
  document.getElementById('modal-faturar').classList.add('open');
  // O foco vai para CANCELAR, não para o botão que age: quem apertar Enter
  // por reflexo não fatura sem ler.
  const cancelar = document.getElementById('faturar-cancelar');
  if(cancelar) cancelar.focus();
}

function fecharModalFaturar(){
  document.getElementById('modal-faturar').classList.remove('open');
  _faturarPendente = null;
}

function confirmarFaturamentoUI(){
  const id = _faturarPendente;
  fecharModalFaturar();
  if(id) executarAvanco(id, 'Faturado', true);
}

function executarAvanco(cargaId, statusDestino, jaConfirmado){
  if(statusDestino === 'Faturado' && !jaConfirmado){
    pedirConfirmacaoFaturamentoUI(cargaId);
    return;
  }
  try{
    const c = getCarga(cargaId);
    avancarStatusCarga(cargaId, statusDestino, nomeOperadorAtual(), setorOperadorAtual());
    notifyGravacao(`${c.placa}: agora em "${statusDestino}".`);
    tocarBeepConfirmacao();
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}
function avancarStatusUI(cargaId){
  const c = getCarga(cargaId); if(!c) return;
  const acao = NEXT_ACAO[c.status];
  if(!acao){ notify('Esta carga não tem uma próxima ação automática.', 'warn'); return; }
  executarAvanco(cargaId, acao.destino);
}
function abrirModalPicker(cargas, statusDestino, aoConfirmar){
  currentPickerCallback = (cargaId)=>{ executarAvanco(cargaId, statusDestino); if(aoConfirmar) aoConfirmar(); };
  document.getElementById('picker-titulo').textContent = `Esta placa tem ${cargas.length} cargas em aberto`;
  document.getElementById('picker-sub').textContent = 'Selecione qual carga está sendo processada:';
  document.getElementById('picker-lista').innerHTML = cargas.map(c=>`
    <div class="modal-list-item">
      <div><strong>Nº ${esc(c.numeroCarga)||'(sem número)'} — Destino: ${esc(c.destino)||'—'}</strong><br>
        <span class="text-dim">${esc(c.cliente)||'sem cliente'} · ${c.peso||0}kg · ${badgeHtml(c.status)}</span></div>
      <button class="btn btn-primary btn-sm" onclick="confirmarPicker('${escJs(c.id)}')">Selecionar</button>
    </div>`).join('');
  document.getElementById('modal-picker').classList.add('open');
}
function confirmarPicker(cargaId){
  const callback = currentPickerCallback;
  fecharModalPicker();
  if(callback) callback(cargaId);
}
function fecharModalPicker(){
  document.getElementById('modal-picker').classList.remove('open');
  currentPickerCallback = null;
}

/* ---------- EXPEDIÇÃO ---------- */
function renderExpedicao(){
  const alvo = ['Aguardando Embarque','Embarque Iniciado'];
  const lista = cargasAbertas().filter(c=>alvo.includes(c.status)).sort(ordenarPorAcaoDoSetor('Expedição'));
  document.getElementById('exp-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td>${c.sequencia ?? '—'}</td><td class="col-identificacao">${esc(c.numeroCarga)||'—'}</td><td class="col-identificacao">${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td>
      <td>${esc(c.destino)||'—'}</td><td>${badgeHtml(c.status)}</td>
      <td class="no-print">${botaoAvancoHtml(c)}</td>
    </tr>`).join('');
  document.getElementById('exp-empty').hidden = lista.length>0;
}

/* ---------- FATURAMENTO ---------- */
function renderFaturamento(){
  const alvo = ['Embarque Finalizado','Faturado'];
  const lista = cargasAbertas().filter(c=>alvo.includes(c.status)).sort(ordenarPorAcaoDoSetor('Faturamento'));
  document.getElementById('fat-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td class="col-identificacao">${esc(c.numeroCarga)||'—'}</td><td class="col-identificacao">${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td><td>${esc(c.destino)||'—'}</td>
      <td>${c.peso||0}</td><td>${badgeHtml(c.status)}</td>
      <td class="no-print">${botaoAvancoHtml(c)}</td>
    </tr>`).join('');
  document.getElementById('fat-empty').hidden = lista.length>0;
}

