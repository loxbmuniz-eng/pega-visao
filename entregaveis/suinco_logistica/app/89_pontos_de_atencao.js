/* =====================================================================
   PONTOS DE ATENÇÃO — a caixa única, só da Administração (07/10/2026)
   =====================================================================
   Pedido do dono: um "ecossistema de dados que gera indicadores e pontos de
   atenção"; aprovado com "a caixa de atenção deixa só pra administração".

   Um ícone no topo com o número de pontos. Abrir mostra cada um por
   gravidade — o que é, desde quando, onde resolver e as cargas de exemplo.
   Quem decide o que é ponto é o SERVIDOR (rota /api/atencao, servicos/
   vigia.js): a tela só mostra o que ele viu, com a hora em que viu. Ponto
   resolvido some sozinho na próxima conferência.

   Os graves (vigia do servidor, regra do dado) já avisam no celular da
   Administração pelos vigias, na virada; os leves nunca avisam — podem ser
   legítimos e virariam barulho. */
const ATENCAO_A_CADA_MS = 5 * 60 * 1000;
let _atencao = { pontos: [], agora: null, erro: '' };
let _atencaoRelogio = null;

function atencaoDaAdministracao(){
  return !!(DB.operador && DB.operador.setor === 'Administração')
    && typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.estaConfigurado();
}

async function atualizarPontosDeAtencao(){
  const btn = document.getElementById('btn-atencao');
  if(!btn) return;
  if(!atencaoDaAdministracao()){
    btn.hidden = true;
    if(_atencaoRelogio){ clearInterval(_atencaoRelogio); _atencaoRelogio = null; }
    return;
  }
  btn.hidden = false;
  if(!_atencaoRelogio) _atencaoRelogio = setInterval(atualizarPontosDeAtencao, ATENCAO_A_CADA_MS);
  try{
    const r = await SuincoSharePoint.atencao();
    _atencao = { pontos: r.pontos || [], agora: r.agora, erro: '' };
  }catch(e){
    /* Servidor ainda sem a rota (antes do atualizar_tudo.sh) responde 404:
       a caixa diz isso — vazio nunca pode parecer "tudo certo". */
    _atencao = { pontos: [], agora: null,
      erro: e.status === 404 ? 'O servidor ainda não tem a caixa — ela passa a valer na próxima atualização do servidor.'
                             : 'Não consegui ler os pontos de atenção: ' + (e.message || 'erro') };
  }
  desenharContadorDeAtencao();
  const m = document.getElementById('modal-atencao');
  if(m && m.classList.contains('open')) desenharPontosDeAtencao();
}

function desenharContadorDeAtencao(){
  const btn = document.getElementById('btn-atencao');
  const cont = document.getElementById('atencao-contador');
  if(!btn || !cont) return;
  const n = _atencao.pontos.length;
  const graves = _atencao.pontos.filter(p => p.gravidade === 'grave').length;
  cont.hidden = n === 0;
  cont.textContent = String(n);
  btn.classList.toggle('atencao-tem-grave', graves > 0);
  const rotulo = n === 0 ? 'Pontos de atenção: nenhum' : `Pontos de atenção: ${n}${graves ? `, ${graves} grave(s)` : ''}`;
  btn.setAttribute('aria-label', rotulo);
  btn.title = rotulo;
}

const ATENCAO_GRAVIDADE = { grave: 'Grave', media: 'Média', leve: 'Leve' };

function desenharPontosDeAtencao(){
  const alvo = document.getElementById('atencao-lista');
  const quando = document.getElementById('atencao-quando');
  if(!alvo) return;
  if(quando) quando.textContent = _atencao.agora ? 'Conferido agora, ' + fmtDataHora(_atencao.agora) : '';
  if(_atencao.erro){ alvo.innerHTML = `<div class="text-dim">${esc(_atencao.erro)}</div>`; return; }
  if(!_atencao.pontos.length){
    alvo.innerHTML = '<div class="atencao-vazio">Nenhum ponto de atenção agora. Os vigias do servidor, o dado dos últimos 30 dias e o Pagamento de Frete estão coerentes.</div>';
    return;
  }
  alvo.innerHTML = '<ol class="atencao-lista">' + _atencao.pontos.map(p => {
    const exemplos = (p.exemplos || []).map(x =>
      `<li>${x.carga ? 'Carga <strong>' + esc(x.carga) + '</strong>' : ''}${x.placa ? ' · ' + esc(x.placa) : ''}${x.detalhe ? ' — ' + esc(x.detalhe) : ''}</li>`).join('')
      + (p.quantidade > (p.exemplos || []).length && (p.exemplos || []).length ? `<li class="text-dim">e mais ${p.quantidade - p.exemplos.length}</li>` : '');
    const onde = p.onde && p.onde.rotulo
      ? (p.onde.aba ? `<button type="button" class="btn btn-sec btn-sm atencao-ir" onclick="irParaPontoDeAtencaoUI('${escJs(p.onde.aba)}')">Resolver em: ${esc(p.onde.rotulo)}</button>`
                    : `<span class="atencao-onde">${esc(p.onde.rotulo)}</span>`) : '';
    return `<li class="atencao-ponto atencao-${esc(p.gravidade)}" data-codigo="${esc(p.codigo)}">
      <div class="atencao-cab"><span class="atencao-grav">${esc(ATENCAO_GRAVIDADE[p.gravidade] || p.gravidade)}</span>
        <strong class="atencao-titulo">${esc(p.titulo)}</strong>${p.quantidade > 1 ? ` <span class="atencao-qtd">${p.quantidade}</span>` : ''}</div>
      <div class="atencao-texto">${esc(p.explicacao || '')}</div>
      <div class="atencao-desde">${p.desde ? 'Desde ' + esc(fmtDataHora(p.desde)) : 'Desde: sem registro da hora'}</div>
      ${exemplos ? `<ul class="atencao-exemplos">${exemplos}</ul>` : ''}
      ${onde}
    </li>`;
  }).join('') + '</ol>';
}

async function abrirPontosDeAtencaoUI(){
  const m = document.getElementById('modal-atencao');
  if(!m) return;
  m.classList.add('open');
  desenharPontosDeAtencao();
  await atualizarPontosDeAtencao();   // abrir é querer ver o agora
}

function fecharPontosDeAtencaoUI(){
  const m = document.getElementById('modal-atencao');
  if(m) m.classList.remove('open');
}

function irParaPontoDeAtencaoUI(aba){
  fecharPontosDeAtencaoUI();
  if(aba) irParaTab(aba);
}

document.addEventListener('keydown', (ev) => {
  const m = document.getElementById('modal-atencao');
  if(ev.key === 'Escape' && m && m.classList.contains('open')) fecharPontosDeAtencaoUI();
});
