/* =====================================================================
   MOBILE — tabela vira cartão
   =====================================================================

   No celular, tabela de 14 colunas com rolagem lateral é inutilizável: o
   usuário perde a referência da linha no primeiro deslize. O CSS resolve
   isso transformando cada linha num cartão, mas para isso precisa saber o
   rótulo de cada célula — que só existe no <thead>.

   Esta função deriva o rótulo do próprio cabeçalho, em vez de exigir que
   cada `<td>` no código carregue um data-rotulo escrito à mão. É a
   diferença entre a marcação continuar certa sozinha quando alguém
   acrescentar uma coluna, e ela silenciosamente sair do ar.

   Roda depois de cada render. Custo: um passe pelas células visíveis da
   aba atual, uma vez por pintura. */
function prepararTabelasMobile(raiz){
  const escopo = raiz || document.querySelector('.tab-page.active') || document;
  escopo.querySelectorAll('table').forEach(tab=>{
    // Tabela de relatório impresso fica de fora: no PDF ela precisa
    // continuar tabela, e o cartão quebraria o layout de página.
    if(tab.closest('.print-page')) return;

    const cabecalhos = [...tab.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    if(!cabecalhos.length) return;
    tab.classList.add('mobile-cartao');

    tab.querySelectorAll('tbody tr').forEach(tr=>{
      [...tr.children].forEach((td, i)=>{
        const rotulo = cabecalhos[i];
        /* Célula que ATRAVESSA a tabela não é um campo, é um contêiner — a
           linha de detalhe do Histórico é um <td colspan="6"> com o registro
           inteiro dentro. Rotular pela posição colava nela o nome da PRIMEIRA
           coluna: o detalhe abria com um "DATA/HORA" dourado em cima de um
           bloco que não é data nenhuma. Sem rótulo ela cai na regra de
           largura inteira, que é o que um contêiner precisa. */
        if(td.colSpan > 1 || !rotulo || /^(ação|acao|ações|acoes)$/i.test(rotulo)){
          td.removeAttribute('data-rotulo');
          td.removeAttribute('data-larg');
          td.removeAttribute('data-sec');
          return;
        }
        td.setAttribute('data-rotulo', rotulo);
        // Os dois carimbos que o CSS do celular lê. Ver ROTULOS_LARGURA_CHEIA
        // e ROTULOS_SECUNDARIOS: a decisão está lá, num lugar só; aqui é só
        // aplicação.
        if(ROTULOS_LARGURA_CHEIA.has(rotulo)) td.setAttribute('data-larg', 'cheia');
        else td.removeAttribute('data-larg');
        if(ROTULOS_SECUNDARIOS.has(rotulo)) td.setAttribute('data-sec', '1');
        else td.removeAttribute('data-sec');
      });
    });
    // Carimbou, então já dá para dizer quais linhas têm algo escondido —
    // e fazer isso aqui dentro tira a dependência de ordem que existia
    // quando as duas coisas eram chamadas em pontos diferentes do render.
    marcarCartoesExpansiveis(tab);
  });
}

/* =====================================================================
   USUÁRIOS — administração pela interface
   =====================================================================

   Existe para tirar o cadastro de operador do SSH. Enquanto criar um
   porteiro exigia abrir terminal, a operação dependia de alguém com acesso
   ao servidor toda vez que entrasse gente nova — e essa fricção é o que
   faz nascer senha compartilhada.

   Toda a validação de verdade está no servidor (rotas/operadores.js). Aqui
   é conveniência: a tela não decide nada que o servidor não confirme. */

/* =====================================================================
   VIGIAS DO SISTEMA (02/10/2026) — só Administração
   =====================================================================
   Pedido do dono: "no raio-X, tudo que fala 'se quebrar', você vai criar
   uma prevenção de quebra pra cada possibilidade apontada".

   Mostra o que o servidor conferiu sozinho (backend/scripts/
   vigia_servidor.mjs) e a conferência do dado, rodada na hora em que a
   caixa abre. A tela não decide nada: só mostra o que o servidor viu,
   com a hora em que viu. Servidor que ainda não tem os vigias responde 404
   — a caixa diz isso em vez de ficar vazia, para ninguém achar que vazio
   é "tudo certo". */
async function renderVigias(){
  const card = document.getElementById('card-vigias');
  const alvo = document.getElementById('vigias-painel');
  if(!card || !alvo) return;
  const admin = !!(DB.operador && DB.operador.setor === 'Administração');
  card.hidden = !admin;
  if(!admin) return;
  if(typeof SuincoSharePoint === 'undefined' || !SuincoSharePoint.estaConfigurado()){
    alvo.innerHTML = '<div class="text-dim">Os vigias moram no servidor — entre com seu usuário para ver.</div>';
    return;
  }
  let r;
  try{
    r = await SuincoSharePoint.vigia();
  }catch(e){
    alvo.innerHTML = '<div class="text-dim">' + (e.status === 404
      ? 'O servidor ainda não tem os vigias — eles começam a valer na próxima atualização do servidor.'
      : 'Não consegui ler os vigias: ' + esc(e.message)) + '</div>';
    return;
  }
  const quando = iso => iso ? fmtDataHora(iso) : '—';
  const item = (ok, nome, detalhe, rodape) =>
    `<li class="vigia-item ${ok ? 'vigia-ok' : 'vigia-problema'}">
       <span class="vigia-nome">${esc(nome)} <span class="vigia-estado">${ok ? 'ok' : 'com problema'}</span></span>
       <span class="vigia-detalhe">${detalhe}</span>
       ${rodape ? `<span class="vigia-quando">${rodape}</span>` : ''}
     </li>`;

  let servidor;
  if(r.semTabela){
    servidor = '<div class="text-dim">O servidor tem os vigias mas ainda não aplicou a migração 057 — as conferências não têm onde ser anotadas.</div>';
  }else if(!r.verificacoes.length){
    servidor = '<div class="text-dim">Os vigias ainda não rodaram neste servidor. A primeira conferência acontece na próxima atualização dele.</div>';
  }else{
    servidor = '<ul class="vigia-lista">' + r.verificacoes.map(v => item(v.ok, v.nome, esc(v.detalhe),
      'conferido em ' + quando(v.conferidoEm) + (v.ok || !v.problemaDesde ? '' : ' · com problema desde ' + quando(v.problemaDesde))
    )).join('') + '</ul>';
  }

  const dado = '<ul class="vigia-lista">' + (r.dado || []).map(a => {
    const ok = a.quantidade === 0;
    const exemplos = ok ? '' : '<ul class="vigia-exemplos">' + a.exemplos.map(x =>
      `<li>Carga <strong>${esc(x.carga || '—')}</strong> · ${esc(x.placa || 'sem placa')}${x.detalhe ? ' — ' + esc(x.detalhe) : ''}</li>`
    ).join('') + (a.quantidade > a.exemplos.length ? `<li class="text-dim">e mais ${a.quantidade - a.exemplos.length}</li>` : '') + '</ul>';
    return item(ok, a.titulo, ok ? 'nenhuma nos últimos 30 dias' : `${a.quantidade} carga(s). ${esc(a.explicacao)}${exemplos}`, '');
  }).join('') + '</ul>';

  alvo.innerHTML =
    '<div class="vigia-bloco"><div class="vigia-titulo">O servidor</div>' + servidor + '</div>'
    + '<div class="vigia-bloco"><div class="vigia-titulo">O dado gravado <span class="text-dim">— conferido agora, ' + quando(r.agora) + '</span></div>' + dado + '</div>';
}

let _usuarios = [];

async function renderUsuarios(){
  const tbody = document.getElementById('usr-tbody');
  const vazio = document.getElementById('usr-empty');
  if(!tbody) return;
  renderVigias();

  if(typeof SuincoSharePoint === 'undefined' || !SuincoSharePoint.estaConfigurado()){
    tbody.innerHTML = '';
    vazio.hidden = false;
    vazio.textContent = 'Esta tela precisa de conexão com o servidor. Faça login para usá-la.';
    return;
  }

  try{
    _usuarios = await SuincoSharePoint.listarOperadores();
  }catch(e){
    tbody.innerHTML = '';
    vazio.hidden = false;
    vazio.textContent = e.status === 403
      ? 'Só a Administração acessa esta tela.'
      : 'Não consegui carregar os usuários: ' + e.message;
    return;
  }

  vazio.hidden = _usuarios.length > 0;
  vazio.textContent = 'Nenhum usuário cadastrado.';

  const euMesmo = (DB.operador && DB.operador.email) || '';

  tbody.innerHTML = _usuarios.map(u=>{
    const sou = u.email === euMesmo;
    const online = _operadoresOnline.has(String(u.id));
    const acesso = u.ultimoAcesso ? fmtDataHora(u.ultimoAcesso)
      : '<span class="text-dim">nunca acessou</span>';
    return `<tr${u.ativo ? '' : ' class="linha-inativa"'}>
      <td><span class="presenca-dot${online ? ' online' : ''}" title="${online ? 'Online agora' : 'Offline'}" aria-label="${online ? 'Online agora' : 'Offline'}"></span> <strong>${esc(u.nome)}</strong>${sou ? ' <span class="chip-voce">você</span>' : ''}</td>
      <td>${esc(u.email)}</td>
      <td>
        <select class="setor-inline" onchange="alterarSetorUsuarioUI('${escJs(u.id)}', this.value)"
                ${sou ? 'title="Você não pode mudar o próprio setor — perderia o acesso a esta tela"' : ''}>
          ${SETORES.map(st=>`<option value="${esc(st)}" ${u.setor===st?'selected':''}>${esc(st)}</option>`).join('')}
        </select>
      </td>
      <td>${u.ativo ? '<span class="sit-ativo">Ativo</span>' : '<span class="sit-inativo">Bloqueado</span>'}</td>
      <td>${acesso}</td>
      <td class="no-print">
        <div class="gap8">
          <button class="btn btn-sec btn-sm" onclick="redefinirSenhaUsuarioUI('${escJs(u.id)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-chave"/></svg>Senha</button>
          ${sou ? '' : `<button class="btn btn-sec btn-sm" onclick="resetarMfaDeUI('${escJs(u.id)}','${escJs(u.nome)}')"
              title="Remove o segundo fator de quem perdeu o celular — fica registrado e avisa os outros administradores"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-sem-celular"/></svg>2º fator</button>`}
          ${u.ativo
            ? `<button class="btn btn-danger btn-sm" onclick="bloquearUsuarioUI('${escJs(u.id)}', false)" ${sou?'disabled title="Você não pode bloquear a si mesmo"':''}><svg class="ico ico-btn" aria-hidden="true"><use href="#i-proibido"/></svg>Bloquear</button>`
            : `<button class="btn btn-success btn-sm" onclick="bloquearUsuarioUI('${escJs(u.id)}', true)"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-ok"/></svg>Reativar</button>`}
          ${sou ? '' : `<button class="btn btn-danger btn-sm btn-excluir-usuario"
              onclick="excluirUsuarioUI('${escJs(u.id)}')"
              title="Apaga a conta de vez. O histórico do que a pessoa registrou continua."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-lixeira"/></svg>Excluir</button>`}
        </div>
      </td>
    </tr>`;
  }).join('');

  prepararTabelasMobile(document.getElementById('tab-usuarios'));
}

function _usuarioPorId(id){
  return _usuarios.find(u => String(u.id) === String(id));
}

async function criarUsuarioUI(){
  const email = (document.getElementById('usr-email').value || '').trim();
  const nome = (document.getElementById('usr-nome').value || '').trim();
  const setor = document.getElementById('usr-setor').value;
  const senhaEl = document.getElementById('usr-senha');
  const senha = senhaEl.value || '';

  if(!email || !nome){ notify('Informe e-mail e nome.', 'warn'); return; }
  if(senha.length < 8){ notify('A senha precisa de pelo menos 8 caracteres.', 'warn'); return; }

  try{
    await SuincoSharePoint.criarOperador({ email, nome, setor, senha });
    // Limpa a senha do DOM imediatamente. Esta tela é usada num terminal
    // que pode ficar aberto, e campo de senha preenchido é o que o
    // próximo a sentar ali encontra.
    senhaEl.value = '';
    document.getElementById('usr-email').value = '';
    document.getElementById('usr-nome').value = '';
    notify(`Usuário ${nome} criado no setor ${setor}.`, 'success');
    renderUsuarios();
  }catch(e){
    notify('Não criou: ' + e.message, 'danger');
  }
}

async function alterarSetorUsuarioUI(id, setor){
  const u = _usuarioPorId(id);
  if(!u) return;
  if(!confirm(`Mudar ${u.nome} para o setor ${setor}?\n\nIsso muda o que essa pessoa vê e o que consegue registrar.`)){
    renderUsuarios();   // devolve o select ao valor anterior
    return;
  }
  try{
    await SuincoSharePoint.atualizarOperador(id, { setor });
    notify(`${u.nome} agora é ${setor}.`, 'success');
  }catch(e){
    notify('Não alterou: ' + e.message, 'danger');
  }
  renderUsuarios();
}

async function bloquearUsuarioUI(id, ativar){
  const u = _usuarioPorId(id);
  if(!u) return;
  const acao = ativar ? 'Reativar' : 'Bloquear';
  const aviso = ativar
    ? `Reativar ${u.nome}? A pessoa volta a conseguir entrar.`
    : `Bloquear ${u.nome}?\n\nEla perde o acesso na hora. O histórico do que ela registrou é preservado.`;
  if(!confirm(aviso)) return;
  try{
    await SuincoSharePoint.atualizarOperador(id, { ativo: ativar });
    notify(`${u.nome} ${ativar ? 'reativado' : 'bloqueado'}.`, 'success');
  }catch(e){
    notify(`Não conseguiu ${acao.toLowerCase()}: ` + e.message, 'danger');
  }
  renderUsuarios();
}

/* EXCLUIR DE VEZ — pedido do dono (25/08/2026): "não tem um botão excluir
   usuários, somente bloquear, preciso poder excluir também".

   Bloquear continua sendo o caminho normal, e a caixa de confirmação diz
   isso em vez de só perguntar "tem certeza?": quem saiu da empresa fica
   melhor BLOQUEADO (perde o acesso, mantém a ficha). Excluir é para o
   cadastro errado, o teste e o duplicado.

   Confirmação DIGITADA, não um "OK". Excluir conta não se desfaz pela
   tela, e o clique de reflexo em cima do botão vermelho ao lado do
   Bloquear é justamente o erro provável aqui. */
async function excluirUsuarioUI(id){
  const u = _usuarioPorId(id);
  if(!u) return;
  const resposta = prompt(`EXCLUIR a conta de ${u.nome} (${u.email})?\n\n`
    + 'A conta some da lista e a pessoa cai na hora. Isto NÃO se desfaz.\n\n'
    + 'O histórico do que ela registrou (chegadas, saídas, faturamentos) '
    + 'continua no sistema com o nome dela.\n\n'
    + 'Se a pessoa só saiu da empresa, BLOQUEAR é melhor: tira o acesso e '
    + 'mantém a ficha.\n\n'
    + 'Para confirmar, digite EXCLUIR:');
  if(resposta === null) return;
  if(resposta.trim().toUpperCase() !== 'EXCLUIR'){
    notify('Não excluí — a confirmação não conferiu.', 'warn', 5000);
    return;
  }
  try{
    await SuincoSharePoint.excluirOperador(id);
    notify(`Conta de ${u.nome} excluída.`, 'success', 6000);
  }catch(e){
    notify('Não consegui excluir: ' + (e && e.message || 'erro'), 'danger', 9000);
  }
  renderUsuarios();
}

async function redefinirSenhaUsuarioUI(id){
  const u = _usuarioPorId(id);
  if(!u) return;
  // prompt() em vez de campo na tabela: a senha não fica escrita no DOM
  // depois, e o navegador não a guarda no autofill de formulário.
  const senha = prompt(`Nova senha para ${u.nome} (${u.email}).\n\nMínimo 8 caracteres. Anote e entregue pessoalmente — ela não aparece de novo.`);
  if(senha === null) return;
  if(senha.length < 8){ notify('A senha precisa de pelo menos 8 caracteres.', 'warn'); return; }
  try{
    await SuincoSharePoint.atualizarOperador(id, { senha });
    notify(`Senha de ${u.nome} redefinida.`, 'success');
  }catch(e){
    notify('Não redefiniu: ' + e.message, 'danger');
  }
}

