/* =====================================================================
   OS DOIS RELATÓRIOS DA CONFERÊNCIA DE FRETE, LIDOS DO PDF — 05/10/2026
   ---------------------------------------------------------------------
     B2B   "RELATÓRIO DE STATUS DAS ENTREGAS" (DeliveryB2B): uma linha por
           nota, com o STATUS (Finalizado, Aguardando...). Exporta UMA carga
           por vez (confirmado pelo dono).
     SIST  "WRVDA501 - Relatório de Notas por Carga" (Atak): as notas que
           foram emitidas para a carga. Também uma carga por vez.

   COMO LÊ. Recebe as páginas com o texto e a posição de cada pedaço
   (servicos/pdf_texto.js) e monta as linhas pela POSIÇÃO DAS COLUNAS, que
   vem do cabeçalho de cada página — nunca por posição fixa. Coluna que o
   relatório mudar de lugar continua certa; coluna que sumir faz a leitura
   RECUSAR dizendo qual faltou, em vez de ler o campo vizinho. É a mesma
   lição do relatório WRMVE790 (dominio/sisatak.js).

   NÃO INVENTA. O que não está legível sai vazio ou vira aviso; o número da
   carga e o número de cada nota só entram se estiverem no arquivo.

   O QUE NÃO GUARDA, de propósito: CNPJ/CPF e a chave de acesso. A chave
   serve só para conferir que o número da nota bate com o resto da linha.
   ===================================================================== */
import { ErroDeLeitura } from '../servicos/pdf_texto.js';
import { semAcento, chaveDaNota } from './pagamento_frete.js';

/* O RODAPÉ É RECONHECIDO PELO QUE É, NÃO PELO LUGAR. Primeira versão cortava
   os 8,5% de baixo da folha (rodapé real em y=28, dado em y≥64). Mas o PDF de
   uma carga longa desce até a margem da página, e um corte fixo derrubou a
   linha 31 de um relatório de 40 notas — sem erro nenhum, só uma nota a menos
   (o teste com 40 notas em 2 páginas pegou). Agora só sai o que é número de
   página: uma linha SOZINHA (no máximo 2 pedaços) embaixo da folha, com só
   "1" ou "Página 1 de 3". Linha de dado tem status, tipo, nota… e nunca é
   confundida com isso. */
const ZONA_DO_RODAPE = 0.15;
const ehNumeroDePagina = (s) => /^(\d{1,4}|pagina \d+ de \d+)$/.test(semAcento(s));

function semRodape(pg) {
  const linhas = agruparEmLinhas(pg.itens.filter((i) => i.y < pg.altura * ZONA_DO_RODAPE));
  const rodape = new Set();
  for (const l of linhas) {
    if (l.itens.length <= 2 && l.itens.every((i) => ehNumeroDePagina(i.s))) l.itens.forEach((i) => rodape.add(i));
  }
  return pg.itens.filter((i) => !rodape.has(i));
}

const por = (a, b) => b.y - a.y || a.x - b.x;

export function tipoDoRelatorio(paginas) {
  const t = semAcento((paginas[0]?.itens ?? []).map((i) => i.s).join(' '));
  if (t.includes('relatorio de status das entregas') || t.includes('deliveryb2b')) return 'B2B';
  if (t.includes('wrvda501') || t.includes('relatorio de notas por carga')) return 'SIST';
  return null;
}

/* ---------------------------------------------------------------------
   B2B
   --------------------------------------------------------------------- */
const ROTULOS_DO_BLOCO = ['motorista', 'placa', 'carga', 'carga externa', 'embarque', 'inicio viagem', 'km percorridos', 'peso total'];

/* O CAMPO "CARGA" DO B2B (ocorrência #112, 05/10/2026). Vem de dois jeitos:
   "118882" (só o número) ou "103-001-118771" (filial-operação-carga). O número
   da carga — o mesmo que o Atak chama de "Número Carga" — é o ÚLTIMO trecho
   de dígitos. Tirar todos os traços e colar ("103001118771") foi o erro que
   fez a carga 118771 não parear com o próprio Atak. Devolve também o texto
   como veio, para a prévia dizer o que leu. */
export function numeroDaCargaB2b(texto) {
  const identificador = String(texto ?? '').trim().replace(/\s+/g, '');
  const trechos = identificador.match(/\d+/g) ?? [];
  const numero = trechos.length ? trechos[trechos.length - 1] : '';
  return { numero, identificador: identificador || numero };
}

function lerBlocoDaCarga(itens, yRotulos) {
  const rotulos = itens
    .filter((i) => Math.abs(i.y - yRotulos) <= 2.5 && ROTULOS_DO_BLOCO.includes(semAcento(i.s)))
    .sort((a, b) => a.x - b.x);
  const valores = itens.filter((i) => i.y < yRotulos - 2.5 && i.y > yRotulos - 28);
  /* DE QUEM É CADA VALOR (ocorrência #112, 05/10/2026). Duas regras, na ordem:
     1. o valor que COMEÇA debaixo do título (de 3 pt antes a 25 pt depois do x
        do título) é daquele título — é o relatório real, alinhado à esquerda;
     2. senão, vale o CENTRO do pedaço (x + largura/2), e cada título é dono da
        faixa entre os pontos médios até os vizinhos — é o valor largo e
        centralizado, que começa antes do próprio título.
     Antes era "o título mais perto do início, até 45 pt": um valor largo ou
     deslocado caía no vizinho e CARGA EXTERNA colava em CARGA. */
  const faixas = rotulos.map((r, k) => ({
    nome: semAcento(r.s), x: r.x,
    de: k === 0 ? -Infinity : (rotulos[k - 1].x + r.x) / 2,
    ate: k + 1 < rotulos.length ? (r.x + rotulos[k + 1].x) / 2 : Infinity,
  }));
  const campo = {};
  for (const v of valores.sort(por)) {
    const sob = faixas.filter((f) => v.x >= f.x - 3 && v.x <= f.x + 25).pop();
    const centro = v.x + (v.w > 0 ? v.w / 2 : 10);
    const f = sob ?? faixas.find((x) => centro >= x.de && centro < x.ate);
    if (f) campo[f.nome] = `${campo[f.nome] ?? ''} ${v.s}`.trim();
  }
  return campo;
}

/* As colunas da tabela vêm do cabeçalho DA PÁGINA. Só as quatro que
   interessam (status, tipo, número, cliente); o resto é ignorado. Os recuos
   existem porque o texto de algumas colunas é CENTRALIZADO — começa à
   esquerda do início do título (o cliente começa ~16 pt antes do "CLIENTE"). */
function colunasDoCabecalho(itens, yCab) {
  const faixa = itens.filter((i) => i.y >= yCab - 10 && i.y <= yCab + 12);
  const inicio = (nome) => {
    const it = faixa.find((i) => semAcento(i.s) === nome);
    return it ? it.x : null;
  };
  const st = inicio('status'); const tp = inicio('tipo'); const nu = inicio('numero');
  const cl = inicio('cliente'); const re = inicio('reentrega');
  const falta = [['STATUS', st], ['TIPO', tp], ['NUMERO', nu], ['CLIENTE', cl], ['REENTREGA', re]]
    .filter(([, v]) => v === null).map(([n]) => n);
  if (falta.length) {
    throw new ErroDeLeitura('B2B_LAYOUT',
      `O relatório do B2B não tem a coluna ${falta.join(', ')} onde eu esperava — o formato mudou?`);
  }
  return {
    seqAte: st - 14,
    status: [st - 14, tp - 12],
    tipo: [tp - 12, nu - 12],
    numero: [nu - 12, cl - 30],
    cliente: [cl - 30, re - 30],
  };
}

const dentro = (x, [de, ate]) => x >= de && x < ate;
const juntar = (lista) => lista.sort(por).map((i) => i.s.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

function lerLinhasDoB2b(itens, yCab, yFim, col) {
  const regiao = itens.filter((i) => i.y < yCab - 8 && i.y > yFim);
  const seqs = regiao.filter((i) => i.x < col.seqAte && /^\d+$/.test(i.s.trim())).sort(por);
  const linhas = [];
  for (let k = 0; k < seqs.length; k += 1) {
    const topo = k === 0 ? Infinity : (seqs[k - 1].y + seqs[k].y) / 2;
    const base = k === seqs.length - 1 ? -Infinity : (seqs[k].y + seqs[k + 1].y) / 2;
    const banda = regiao.filter((i) => i.y <= topo && i.y > base);
    linhas.push({
      seq: Number(seqs[k].s),
      status: juntar(banda.filter((i) => dentro(i.x, col.status))),
      tipo: juntar(banda.filter((i) => dentro(i.x, col.tipo))),
      numero: juntar(banda.filter((i) => dentro(i.x, col.numero))),
      cliente: juntar(banda.filter((i) => dentro(i.x, col.cliente))),
    });
  }
  return linhas;
}

export function lerB2B(paginas) {
  const cargas = [];
  let atual = null;
  let colunas = null;

  for (const pg of paginas) {
    const itens = semRodape(pg);
    const eventos = [];
    for (const i of itens) {
      const t = semAcento(i.s);
      if (t === 'motorista') eventos.push({ y: i.y, tipo: 'bloco' });
      if (t === 'seq' && itens.some((o) => semAcento(o.s) === 'status' && Math.abs(o.y - i.y) <= 3)) {
        eventos.push({ y: i.y, tipo: 'cabecalho' });
      }
    }
    eventos.sort((a, b) => b.y - a.y);

    for (let k = 0; k < eventos.length; k += 1) {
      const ev = eventos[k];
      if (ev.tipo === 'bloco') {
        const campo = lerBlocoDaCarga(itens, ev.y);
        const { numero, identificador } = numeroDaCargaB2b(campo.carga);
        const externa = (campo['carga externa'] ?? '').replace(/\D/g, '');
        if (!numero) {
          throw new ErroDeLeitura('B2B_SEM_CARGA', 'Não achei o número da carga no cabeçalho do relatório do B2B.');
        }
        /* O MESMO número em vários blocos é UMA carga: o B2B repete o cabeçalho a
           cada grupo de entregas. Em 05/10/2026 uma carga de 31 notas (6 páginas,
           12 blocos) virou 12 "cargas" de 12, 1, 1, 3… notas e não pareou com o
           Atak (ocorrência #112). */
        atual = cargas.find((c) => c.numero === numero);
        if (!atual) {
          atual = {
            numero, identificador, externa, embarque: campo.embarque ?? '', pesoTotal: campo['peso total'] ?? '', linhas: [], avisos: [],
          };
          if (identificador !== numero) {
            atual.avisos.push(`No B2B a carga aparece como ${identificador}; o número da carga é o último trecho, ${numero} — o mesmo do Atak.`);
          }
          if (numero.length > 8) {
            atual.avisos.push(`O número da carga no B2B tem ${numero.length} dígitos (${numero}) — mais que o normal. `
              + 'O painel pareia com o Atak pelo número do sistema; confira o par na prévia.');
          }
          cargas.push(atual);
        }
      } else {
        if (!atual) {
          throw new ErroDeLeitura('B2B_SEM_CARGA', 'A tabela do B2B vem antes do número da carga — o formato mudou?');
        }
        colunas = colunasDoCabecalho(itens, ev.y);
        const proximo = eventos.slice(k + 1).find((e) => e.tipo === 'bloco');
        const yFim = proximo ? proximo.y + 2 : -Infinity;
        atual.linhas.push(...lerLinhasDoB2b(itens, ev.y, yFim, colunas));
      }
    }
  }

  if (!cargas.length) {
    throw new ErroDeLeitura('B2B_SEM_CARGA', 'Não achei nenhuma carga neste relatório do B2B.');
  }
  for (const c of cargas) {
    if (!c.linhas.length) {
      throw new ErroDeLeitura('B2B_SEM_NOTAS', `Não achei nenhuma nota na carga ${c.numero} do B2B.`);
    }
    for (const l of c.linhas) {
      if (!chaveDaNota(l.numero)) c.avisos.push(`A linha ${l.seq} do B2B não tem número de nota legível.`);
      if (!l.status) c.avisos.push(`A linha ${l.seq} do B2B (nota ${l.numero || '?'}) não tem status.`);
    }
    c.linhas = c.linhas.filter((l) => chaveDaNota(l.numero)).map((l) => ({
      seq: l.seq, status: l.status, tipo: l.tipo, nota: chaveDaNota(l.numero), cliente: l.cliente,
    }));
  }
  return { tipo: 'B2B', cargas };
}

/* ---------------------------------------------------------------------
   SIST (Atak · WRVDA501)
   --------------------------------------------------------------------- */
function agruparEmLinhas(itens) {
  const linhas = [];
  for (const i of [...itens].sort(por)) {
    const l = linhas.find((x) => Math.abs(x.y - i.y) <= 2.5);
    if (l) l.itens.push(i);
    else linhas.push({ y: i.y, itens: [i] });
  }
  for (const l of linhas) l.itens.sort((a, b) => a.x - b.x);
  return linhas.sort((a, b) => b.y - a.y);
}

function colunasDoSist(linha) {
  const inicio = (nome) => {
    const it = linha.itens.find((i) => semAcento(i.s) === nome);
    return it ? it.x : null;
  };
  const ne = inicio('ne'); const cli = inicio('cliente'); const cnpj = inicio('cnpj/cpf');
  const cid = inicio('cidade'); const uf = inicio('uf'); const chave = inicio('chave_de_acesso');
  const falta = [['NE', ne], ['Cliente', cli], ['CNPJ/CPF', cnpj], ['Cidade', cid], ['UF', uf], ['Chave_de_Acesso', chave]]
    .filter(([, v]) => v === null).map(([n]) => n);
  if (falta.length) {
    throw new ErroDeLeitura('SIST_LAYOUT',
      `O relatório do sistema (WRVDA501) não tem a coluna ${falta.join(', ')} onde eu esperava — o formato mudou?`);
  }
  return {
    nota: [ne - 15, cli - 6], cliente: [cli - 6, cnpj - 6], cidade: [cid - 6, uf - 6], uf: [uf - 6, chave - 6],
  };
}

export function lerSist(paginas) {
  const cargas = new Map();
  let atual = null;
  let colunas = null;

  for (const pg of paginas) {
    for (const linha of agruparEmLinhas(pg.itens)) {
      const texto = linha.itens.map((i) => i.s).join(' ');
      const mCarga = semAcento(texto).match(/numero\s+carga:\s*(\d+)/);
      if (mCarga) {
        const numero = mCarga[1];
        if (!cargas.has(numero)) cargas.set(numero, { numero, notas: [], avisos: [] });
        atual = cargas.get(numero);
        continue;
      }
      if (linha.itens.some((i) => semAcento(i.s) === 'chave_de_acesso')) {
        colunas = colunasDoSist(linha);
        continue;
      }
      /* Linha de nota = depois do cabeçalho das colunas e começando por data.
         A data de emissão do relatório (canto de cima, "29/09/2026") também
         começa por data — e vem ANTES do cabeçalho, por isso não conta. */
      if (!colunas) continue;
      const primeiro = linha.itens[0];
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(primeiro.s.trim())) continue; // rodapé, filtros, título
      /* A data e hora de emissão ("21/09/2026 14:29:38") se repetem no topo de
         CADA página do WRVDA501 — da 2ª em diante já há carga e colunas, e a
         linha passava por nota sem número ("não tem número de nota legível"),
         um aviso falso no relatório real da 118771 (05/10/2026). Linha só com
         data e hora não é nota. */
      if (linha.itens.length <= 2 && linha.itens.slice(1).every((i) => /^\d{2}:\d{2}:\d{2}$/.test(i.s.trim()))) continue;
      if (!atual) {
        throw new ErroDeLeitura('SIST_SEM_CARGA', 'As notas do sistema vêm antes do número da carga — o formato mudou?');
      }
      const nota = chaveDaNota(juntar(linha.itens.filter((i) => dentro(i.x, colunas.nota))));
      if (!nota) {
        atual.avisos.push(`Uma linha de ${primeiro.s} do sistema não tem número de nota legível.`);
        continue;
      }
      const cliTxt = juntar(linha.itens.filter((i) => dentro(i.x, colunas.cliente)));
      const mc = cliTxt.match(/^(\d+)\s*-\s*(.*)$/);
      const chave = (linha.itens.find((i) => /^\d{44}$/.test(i.s.trim())) ?? {}).s;
      if (chave && chaveDaNota(chave.slice(25, 34)) !== nota) {
        atual.avisos.push(`A nota ${nota}: o número não bate com a chave de acesso do relatório.`);
      }
      atual.notas.push({
        data: primeiro.s.trim(), nota,
        clienteCodigo: mc ? mc[1] : '', cliente: mc ? mc[2].trim() : cliTxt,
        cidade: juntar(linha.itens.filter((i) => dentro(i.x, colunas.cidade))),
        uf: juntar(linha.itens.filter((i) => dentro(i.x, colunas.uf))),
      });
    }
  }

  if (!colunas) {
    throw new ErroDeLeitura('SIST_LAYOUT', 'Não achei o cabeçalho das colunas do relatório do sistema (WRVDA501).');
  }
  if (!cargas.size) {
    throw new ErroDeLeitura('SIST_SEM_CARGA', 'Não achei o número da carga no relatório do sistema (WRVDA501).');
  }
  for (const c of cargas.values()) {
    if (!c.notas.length) {
      throw new ErroDeLeitura('SIST_SEM_NOTAS', `Não achei nenhuma nota na carga ${c.numero} do sistema.`);
    }
  }
  return { tipo: 'SIST', cargas: [...cargas.values()] };
}

/* A porta única: recebe as páginas, descobre de qual relatório se trata
   (pelo CONTEÚDO, não pelo nome do arquivo — "118882 - SIST.pdf" renomeado
   continua sendo o que é) e devolve as cargas lidas. */
export function lerRelatorioDeFrete(paginas) {
  const tipo = tipoDoRelatorio(paginas);
  if (tipo === 'B2B') return lerB2B(paginas);
  if (tipo === 'SIST') return lerSist(paginas);
  throw new ErroDeLeitura('RELATORIO_DESCONHECIDO',
    'Este PDF não é o relatório do B2B (Status das Entregas) nem o do sistema (WRVDA501 — Notas por Carga).');
}
