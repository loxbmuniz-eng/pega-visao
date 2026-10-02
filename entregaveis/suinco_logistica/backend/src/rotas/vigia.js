/* A caixa "Vigias do sistema" (aba Usuários, só Administração).

   Devolve duas coisas, cada uma com a hora em que foi vista:
     · o que os vigias do servidor anotaram por último (vigia_registros) —
       travamento, backup, disco, certificado, bibliotecas;
     · a conferência do dado, rodada AGORA (só leitura): quem abre a caixa
       depois de corrigir uma carga quer ver o número mudar na hora, não na
       madrugada seguinte.

   Servidor com o código novo e sem a migração 057: as anotações voltam
   vazias com `semTabela: true` e a conferência do dado continua valendo —
   ela não depende da tabela nova. */
import { Router } from 'express';
import { pool } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { auditarDado, lerAnotacoes, NOMES } from '../servicos/vigia.js';

export const rotasVigia = Router();
const SO_ADMIN = [exigirLogin, exigirSetor('Administração')];

rotasVigia.get('/vigia', ...SO_ADMIN, async (req, res, next) => {
  try {
    let anotacoes = [];
    let semTabela = false;
    try {
      anotacoes = await lerAnotacoes(pool);
    } catch (e) {
      if (e.code !== '42P01') throw e; // 42P01 = tabela não existe (sem a 057)
      semTabela = true;
    }
    const dado = await auditarDado(pool);
    res.json({
      agora: new Date().toISOString(),
      semTabela,
      verificacoes: anotacoes.map((a) => ({
        verificacao: a.verificacao,
        nome: NOMES[a.verificacao] || a.verificacao,
        ok: a.ok,
        detalhe: a.detalhe,
        conferidoEm: a.conferido_em,
        problemaDesde: a.problema_desde,
      })),
      dado,
    });
  } catch (e) {
    next(e);
  }
});
