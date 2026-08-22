import { Router } from 'express';
import { consultar } from '../banco.js';
import { exigirTokenBI } from '../middleware/auth.js';
import { registrarLeitura } from '../servicos/registro_leitura.js';

export const rotasBI = Router();

/* Export para o Power BI.

   LISTA BRANCA, não montagem dinâmica de nome. Interpolar `req.params.view`
   direto no SQL seria injeção — `/bi/x;DROP TABLE...`. Nome de objeto não
   aceita parâmetro `$1` no PostgreSQL, então a única defesa correta é o
   conjunto fixo abaixo. Nada entra aqui sem estar nesta lista.

   As views reproduzem os cabeçalhos do CSV que o painel já exporta, ao pé da
   letra. O modelo do Power BI que vocês montaram continua funcionando sem
   refazer medida nenhuma — só troca o arquivo pela conexão. */
const VIEWS = new Map([
  ['dim_carga', 'vw_dim_carga'],
  ['fact_movimentacoes', 'vw_fact_movimentacoes'],
  ['dim_frota', 'vw_dim_frota'],
  ['dim_transportadora', 'vw_dim_transportadora'],
  ['dim_status', 'vw_dim_status'],
  ['dim_rota', 'vw_dim_rota'],
  ['tempos_por_etapa', 'vw_tempos_por_etapa'],
]);

rotasBI.get('/', exigirTokenBI, (req, res) => {
  res.json({
    views: [...VIEWS.keys()],
    formatos: ['json', 'csv'],
    exemplo: '/bi/dim_carga?formato=csv',
  });
});

rotasBI.get('/:view', exigirTokenBI, async (req, res, next) => {
  try {
    const tabela = VIEWS.get(String(req.params.view));
    if (!tabela) {
      return res.status(404).json({
        erro: `View desconhecida. Disponíveis: ${[...VIEWS.keys()].join(', ')}.`,
        codigo: 'VIEW_DESCONHECIDA',
      });
    }

    const { rows, fields } = await consultar(`SELECT * FROM ${tabela}`);

    /* O token do BI não é uma pessoa — é uma chave. Por isso o registro
       guarda a chave como operador e o endereço de origem: quando a mesma
       chave começa a puxar a base de um IP novo, é isso que denuncia. */
    await registrarLeitura({
      tipo: `bi:${req.params.view}`,
      detalhe: String(req.query.formato || 'json'),
      linhas: rows.length,
      operador: { id: 'token-bi', nome: 'Power BI', setor: 'Integração' },
      ip: req.ip,
    });

    if (String(req.query.formato) === 'csv') {
      const cabecalhos = fields.map((f) => f.name);
      const linhas = [cabecalhos.map(csvCampo).join(';')];
      for (const r of rows) linhas.push(cabecalhos.map((c) => csvCampo(r[c])).join(';'));
      res.type('text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.view}.csv"`);
      // BOM para o Excel abrir acentuação certa — mesmo comportamento do
      // export do painel. Escrito como \uFEFF e não como o caractere
      // literal: BOM invisível no meio do código some em qualquer editor
      // distraído, e a acentuação quebra sem ninguém saber por quê.
      return res.send('\uFEFF' + linhas.join('\r\n'));
    }

    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

/* Ponto e vírgula como separador: é o que o Excel em português espera. Vírgula
   faria a planilha abrir tudo numa coluna só. */
function csvCampo(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
