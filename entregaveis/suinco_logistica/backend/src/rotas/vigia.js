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
import { exigirLogin, exigirSetor, exigirUsuariosDestrancado } from '../middleware/auth.js';
import { auditarDado, lerAnotacoes, NOMES, pontosDeAtencao } from '../servicos/vigia.js';

export const rotasVigia = Router();
const SO_ADMIN = [exigirLogin, exigirSetor('Administração')];

// A caixa Vigias do sistema mora na aba Usuários: fica atrás da senha dela
// (08/10/2026). A caixa Pontos de atenção, no topo, não.
rotasVigia.get('/vigia', ...SO_ADMIN, exigirUsuariosDestrancado, async (req, res, next) => {
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

/* A caixa "Pontos de atenção" (07/10/2026) — só a Administração. O ícone do
   topo mostra quantos; abrir mostra cada um com gravidade, desde quando e
   onde resolver. Conferido na hora: quem acabou de corrigir quer ver sumir. */
rotasVigia.get('/atencao', ...SO_ADMIN, async (req, res, next) => {
  try {
    const pontos = await pontosDeAtencao(pool);
    res.json({ agora: new Date().toISOString(), total: pontos.length, pontos });
  } catch (e) {
    next(e);
  }
});
