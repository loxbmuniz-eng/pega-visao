/* =====================================================================
   A PERGUNTA DO PAINEL — uma janela só para toda ação que pede certeza,
   senha ou motivo (08/10/2026, auditoria /impeccable, Lote 2).
   ---------------------------------------------------------------------
   Até aqui o painel perguntava pelas caixas do navegador (prompt/confirm):
     · a SENHA de fechamento da programação, a nova senha de um usuário e a
       senha do segundo fator eram digitadas À VISTA, letra por letra, na
       frente de quem estivesse olhando a tela;
     · o motivo de "Encerrar a programação anterior" já vinha ESCRITO
       ("Caminhões já saíram…") — um Enter de reflexo carimbava no histórico
       um motivo que ninguém escreveu;
     · a caixa do navegador não tem título, corta texto longo, mostra a
       lista de cargas como um bloco corrido e, quando a pessoa erra, fecha
       e manda começar de novo.

   Agora é uma função só, para todos os chamadores (regra da casa). A senha
   não aparece; o motivo nasce em branco e é obrigatório; o que está errado
   aparece DENTRO da janela, dizendo o que fazer, e a janela não fecha —
   botão desabilitado não ensina o caminho, só nega.

   perguntarUI({ titulo, texto, lista, campo, botao, cancelar, perigo, soAviso })
     → Promise: null = desistiu · true = confirmou (sem campo) ·
                o que foi digitado (com campo)
   soAviso: só o botão de entendido — para o aviso que não tem escolha.
   campo: { tipo: 'motivo' | 'senha' | 'digitar', rotulo, dica,
            minimo (letras), nova (senha nova: autocomplete e "Mostrar"),
            exigir (texto que precisa ser digitado), normalizar (fn) }
   ===================================================================== */
let _pergunta = null;   // { resolver, op, voltarPara }

function perguntarUI(op){
  op = op || {};
  if(_pergunta) perguntaResponderUI(null);
  let m = document.getElementById('modal-pergunta');
  if(!m){
    m = document.createElement('div');
    m.className = 'modal-overlay';
    m.id = 'modal-pergunta';
    document.body.appendChild(m);
  }
  const campo = op.campo || null;
  const paragrafos = String(op.texto || '').split(/\n{2,}/).filter(p => p.trim())
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const lista = op.lista && op.lista.length
    ? `<ul class="pergunta-lista">${op.lista.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
  m.innerHTML = `<div class="modal-box pergunta-box${op.perigo ? ' pergunta-perigo' : ''}" role="alertdialog" aria-modal="true"
      aria-labelledby="pergunta-titulo" aria-describedby="pergunta-texto">
      <h2 id="pergunta-titulo">${esc(op.titulo || 'Confirmar')}</h2>
      <div id="pergunta-texto" class="pergunta-texto">${paragrafos}${lista}</div>
      ${campo ? _perguntaCampoHtml(campo) : ''}
      <p class="pergunta-erro" id="pergunta-erro" role="alert" hidden></p>
      <div class="pergunta-botoes">
        ${op.soAviso ? '' : `<button type="button" class="btn btn-sec" id="pergunta-cancelar" onclick="perguntaResponderUI(null)">${esc(op.cancelar || 'Cancelar')}</button>`}
        <button type="button" class="btn ${op.perigo ? 'btn-danger' : 'btn-primary'}" id="pergunta-ok" onclick="perguntaConfirmarUI()">${esc(op.botao || 'Confirmar')}</button>
      </div>
    </div>`;
  const voltarPara = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  m.classList.add('open');
  /* O foco nasce onde a pessoa vai agir: no campo, quando há o que digitar;
     no Cancelar, quando a ação é perigosa e não há campo (o Enter de
     reflexo desiste em vez de apagar); no botão da ação nos demais. */
  const foco = campo ? 'pergunta-campo' : op.perigo && !op.soAviso ? 'pergunta-cancelar' : 'pergunta-ok';
  setTimeout(() => { const el = document.getElementById(foco); if(el) el.focus(); }, 30);
  return new Promise((resolver) => { _pergunta = { resolver, op, voltarPara }; });
}

function _perguntaCampoHtml(campo){
  const descr = `aria-describedby="${campo.dica ? 'pergunta-dica ' : ''}pergunta-erro"`;
  const dica = campo.dica ? `<span class="pergunta-dica" id="pergunta-dica">${esc(campo.dica)}</span>` : '';
  let controle;
  if(campo.tipo === 'motivo'){
    controle = `<textarea id="pergunta-campo" rows="2" maxlength="500" ${descr} aria-required="true"></textarea>`;
  } else if(campo.tipo === 'senha'){
    controle = `<div class="pergunta-senha">
        <input id="pergunta-campo" type="password" autocomplete="${campo.nova ? 'new-password' : 'current-password'}"
          spellcheck="false" autocapitalize="off" ${descr} aria-required="true">
        <button type="button" class="btn btn-sec" id="pergunta-mostrar" aria-pressed="false"
          aria-controls="pergunta-campo" onclick="perguntaMostrarSenhaUI()">Mostrar</button>
      </div>`;
  } else {
    controle = `<input id="pergunta-campo" type="text" autocomplete="off" spellcheck="false" ${descr} aria-required="true">`;
  }
  const rotulo = campo.rotulo || (campo.tipo === 'motivo' ? 'Motivo' : campo.tipo === 'senha' ? 'Senha' : 'Confirmação');
  return `<div class="pergunta-campo"><label for="pergunta-campo">${esc(rotulo)}</label>${dica}${controle}</div>`;
}

/* "Mostrar" existe para a senha NOVA que o administrador vai anotar e
   entregar — conferir o que digitou antes de gravar. Começa escondida. */
function perguntaMostrarSenhaUI(){
  const el = document.getElementById('pergunta-campo');
  const bt = document.getElementById('pergunta-mostrar');
  if(!el || !bt) return;
  const mostrar = el.type === 'password';
  el.type = mostrar ? 'text' : 'password';
  bt.setAttribute('aria-pressed', String(mostrar));
  bt.textContent = mostrar ? 'Esconder' : 'Mostrar';
  el.focus();
}

/* O erro fica na janela, com o que fazer — e a janela não fecha. */
function _perguntaErro(texto){
  const e = document.getElementById('pergunta-erro');
  if(e){ e.textContent = texto; e.hidden = false; }
  const el = document.getElementById('pergunta-campo');
  if(el){ el.setAttribute('aria-invalid', 'true'); el.focus(); }
}

function perguntaConfirmarUI(){
  if(!_pergunta) return;
  const campo = _pergunta.op.campo;
  if(!campo) return perguntaResponderUI(true);
  const el = document.getElementById('pergunta-campo');
  const bruto = el ? el.value : '';
  if(campo.tipo === 'senha'){
    if(!bruto.trim()) return _perguntaErro(campo.erroVazio || 'Digite a senha.');
    if(campo.minimo && bruto.length < campo.minimo)
      return _perguntaErro(`A senha precisa de pelo menos ${campo.minimo} caracteres — esta tem ${bruto.length}.`);
    return perguntaResponderUI(bruto);
  }
  const valor = bruto.trim();
  if(campo.tipo === 'motivo'){
    if(!valor) return _perguntaErro(campo.erroVazio || 'Escreva o motivo — ele fica no histórico com o seu nome.');
    if(campo.minimo && valor.length < campo.minimo)
      return _perguntaErro(`Escreva um motivo com pelo menos ${campo.minimo} letras.`);
    return perguntaResponderUI(valor);
  }
  const norm = campo.normalizar || (s => String(s).trim().toUpperCase());
  if(!valor) return _perguntaErro(`Para confirmar, digite ${campo.exigir}.`);
  if(norm(valor) !== norm(campo.exigir))
    return _perguntaErro(`Não confere. Digite exatamente: ${campo.exigir}`);
  return perguntaResponderUI(valor);
}

function perguntaResponderUI(resposta){
  const m = document.getElementById('modal-pergunta');
  if(m){ m.classList.remove('open'); m.innerHTML = ''; }   // a senha não fica no DOM depois
  const atual = _pergunta;
  _pergunta = null;
  if(!atual) return;
  if(atual.voltarPara && document.contains(atual.voltarPara)){
    try{ atual.voltarPara.focus(); }catch(_){}
  }
  atual.resolver(resposta);
}

/* Teclado: Esc desiste; Enter confirma (Shift+Enter quebra a linha do
   motivo); Tab circula só dentro da janela — atrás dela está a tela que
   a pergunta suspendeu. */
document.addEventListener('keydown', (ev) => {
  if(!_pergunta) return;
  const m = document.getElementById('modal-pergunta');
  if(!m || !m.classList.contains('open')) return;
  if(ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); perguntaResponderUI(null); return; }
  if(ev.key === 'Enter' && !ev.shiftKey && ev.target && ev.target.id === 'pergunta-campo'){
    ev.preventDefault(); perguntaConfirmarUI(); return;
  }
  if(ev.key === 'Tab'){
    const focaveis = [...m.querySelectorAll('button, input, textarea')].filter(el => !el.disabled && el.offsetParent !== null);
    if(!focaveis.length) return;
    const i = focaveis.indexOf(document.activeElement);
    const prox = ev.shiftKey ? (i <= 0 ? focaveis.length - 1 : i - 1) : (i === -1 || i === focaveis.length - 1 ? 0 : i + 1);
    ev.preventDefault();
    focaveis[prox].focus();
  }
}, true);
