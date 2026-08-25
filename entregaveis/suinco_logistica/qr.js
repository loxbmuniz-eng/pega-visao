/* QR CODE — o desenho que o Microsoft Authenticator lê. (25/08/2026)
   =====================================================================

   Pedido do gestor: o segundo fator pelo Microsoft Authenticator.

   O painel já falava a língua do aplicativo desde a etapa 4 — o servidor
   devolve um endereço `otpauth://` e o código de 6 dígitos é o mesmo TOTP
   que Google e Microsoft leem. O que faltava era o QR.

   POR QUE ISSO IMPORTA. Sem QR, a tela pede que a pessoa digite 32
   caracteres embaralhados no celular, com "inserir chave manualmente"
   escondido atrás de um menu do aplicativo. É o passo em que a adesão
   morre: quem erra dois caracteres não sabe que errou, vê "código
   inválido" e desiste. O caminho normal do Authenticator é apontar a
   câmera. Segurança que depende de digitação manual não é adotada.

   POR QUE ESCREVER EM VEZ DE INSTALAR. Mesma decisão do totp.js ao lado.
   O painel é UM ARQUIVO, sem CDN — biblioteca externa aqui significaria
   embutir código de terceiro no pacote que roda no navegador de todo mundo,
   para auditar e atualizar para sempre. QR é aritmética determinística:
   nada de rede, nada de segredo novo, entra texto e sai matriz de pontos.

   PODE ISSO NUM CÓDIGO ESCRITO À MÃO? Só porque dá para PROVAR. O teste
   test_qr_segundo_fator.py renderiza o QR desta função e LÊ de volta com um
   decodificador independente (OpenCV), conferindo que o texto que sai é
   idêntico ao que entrou. Codificador conferido por decodificador de outra
   gente é a única verificação que vale — "parece um QR" não é verificação.

   ESCOPO: modo BYTE (ISO/IEC 18004), nível de correção M, versões 1 a 10.
   O endereço otpauth:// tem uns 130 caracteres e cabe folgado na versão 7.
   Fora desse escopo a função devolve null, e a tela cai no caminho antigo
   (a chave para digitar) em vez de mostrar um quadrado quebrado.

   O nível M (recupera ~15%) não é escolha estética: o QR é lido da tela de
   um computador pela câmera de um celular, com reflexo e mão tremendo. */

(function (raiz) {
  'use strict';

  // ---- GF(256): a aritmética do Reed-Solomon ------------------------
  // Corpo finito com polinômio 0x11D, o da especificação do QR.
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function tabelas() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  }());

  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /* Polinômio gerador de grau `grau`: (x-a^0)(x-a^1)...(x-a^(grau-1)). */
  function gerador(grau) {
    let g = [1];
    for (let i = 0; i < grau; i++) {
      const novo = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        novo[j] ^= g[j];
        novo[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = novo;
    }
    return g;
  }

  /* Os bytes de correção de um bloco: resto da divisão polinomial. */
  function correcao(dados, quantos) {
    const g = gerador(quantos);
    const resto = new Array(quantos).fill(0);
    for (const byte of dados) {
      const fator = byte ^ resto[0];
      resto.shift();
      resto.push(0);
      for (let i = 0; i < quantos; i++) resto[i] ^= mul(g[i + 1], fator);
    }
    return resto;
  }

  // ---- Tabelas da especificação, nível M, versões 1..10 -------------
  // [total de bytes de dados, bytes de correção por bloco,
  //  blocos do grupo 1, bytes de dados por bloco do grupo 1,
  //  blocos do grupo 2, bytes de dados por bloco do grupo 2]
  const NIVEL_M = {
    1:  [16,   10, 1,  16, 0,  0],
    2:  [28,   16, 1,  28, 0,  0],
    3:  [44,   26, 1,  44, 0,  0],
    4:  [64,   18, 2,  32, 0,  0],
    5:  [86,   24, 2,  43, 0,  0],
    6:  [108,  16, 4,  27, 0,  0],
    7:  [124,  18, 4,  31, 0,  0],
    8:  [154,  22, 2,  38, 2, 39],
    9:  [182,  22, 3,  36, 2, 37],
    10: [216,  26, 4,  43, 1, 44],
  };

  // Centros dos padrões de alinhamento por versão (o 1 não tem nenhum).
  const ALINHAMENTO = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  // Informação de formato já calculada (nível M + máscara 0..7), com o
  // XOR 0x5412 da especificação aplicado.
  const FORMATO_M = [
    0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0,
  ];

  // Informação de versão (só a partir da 7).
  const INFO_VERSAO = {
    7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3,
  };

  const MASCARAS = [
    (l, c) => (l + c) % 2 === 0,
    (l) => l % 2 === 0,
    (l, c) => c % 3 === 0,
    (l, c) => (l + c) % 3 === 0,
    (l, c) => (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0,
    (l, c) => ((l * c) % 2) + ((l * c) % 3) === 0,
    (l, c) => (((l * c) % 2) + ((l * c) % 3)) % 2 === 0,
    (l, c) => (((l + c) % 2) + ((l * c) % 3)) % 2 === 0,
  ];

  /* Texto -> bytes UTF-8. O endereço otpauth traz o e-mail da pessoa e o
     nome do emissor; acento em nome de conta não pode virar lixo. */
  function utf8(texto) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(texto));
    const bytes = [];
    for (const ch of unescape(encodeURIComponent(texto))) bytes.push(ch.charCodeAt(0));
    return bytes;
  }

  function menorVersao(qtdBytes) {
    for (let v = 1; v <= 10; v++) {
      const capacidade = NIVEL_M[v][0];
      // 4 bits de modo + contador (8 bits até a v9, 16 a partir da v10).
      const bitsCabecalho = 4 + (v >= 10 ? 16 : 8);
      if (Math.ceil(bitsCabecalho / 8) + qtdBytes <= capacidade) return v;
    }
    return null;
  }

  /* O fluxo de bits: modo byte, tamanho, dados, terminador, preenchimento. */
  function montarBits(bytes, versao) {
    const bits = [];
    const push = (valor, quantos) => {
      for (let i = quantos - 1; i >= 0; i--) bits.push((valor >> i) & 1);
    };
    push(0b0100, 4);                       // modo byte
    push(bytes.length, versao >= 10 ? 16 : 8);
    for (const b of bytes) push(b, 8);

    const capacidadeBits = NIVEL_M[versao][0] * 8;
    // Terminador: até 4 zeros, ou menos se não couber.
    for (let i = 0; i < 4 && bits.length < capacidadeBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    // Preenchimento alternado da especificação, até encher a capacidade.
    const ENCHE = [0xEC, 0x11];
    for (let i = 0; bits.length < capacidadeBits; i++) push(ENCHE[i % 2], 8);

    const saida = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      saida.push(b);
    }
    return saida;
  }

  /* Intercalação de blocos: a especificação exige que os bytes saiam
     alternando entre os blocos, para que um borrão na etiqueta estrague um
     pedaço de cada bloco em vez de destruir um bloco inteiro. */
  function intercalar(dados, versao) {
    const [, ecPorBloco, g1, tam1, g2, tam2] = NIVEL_M[versao];
    const blocos = [];
    let p = 0;
    for (let i = 0; i < g1; i++) { blocos.push(dados.slice(p, p + tam1)); p += tam1; }
    for (let i = 0; i < g2; i++) { blocos.push(dados.slice(p, p + tam2)); p += tam2; }
    const ecs = blocos.map((b) => correcao(b, ecPorBloco));

    const saida = [];
    const maiorDado = Math.max(...blocos.map((b) => b.length));
    for (let i = 0; i < maiorDado; i++) {
      for (const b of blocos) if (i < b.length) saida.push(b[i]);
    }
    for (let i = 0; i < ecPorBloco; i++) {
      for (const e of ecs) saida.push(e[i]);
    }
    return saida;
  }

  /* A matriz com tudo que NÃO é dado: localizadores, temporização,
     alinhamento, e as casas reservadas para formato e versão. */
  function esqueleto(versao) {
    const n = versao * 4 + 17;
    const m = Array.from({ length: n }, () => new Array(n).fill(null));
    const reservado = Array.from({ length: n }, () => new Array(n).fill(false));

    const marcar = (l, c, v) => { m[l][c] = v; reservado[l][c] = true; };

    // Os três localizadores dos cantos, com a borda branca de separação.
    for (const [ol, oc] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let l = -1; l <= 7; l++) {
        for (let c = -1; c <= 7; c++) {
          const L = ol + l; const C = oc + c;
          if (L < 0 || C < 0 || L >= n || C >= n) continue;
          const dentro = l >= 0 && l <= 6 && c >= 0 && c <= 6;
          const anel = dentro && (l === 0 || l === 6 || c === 0 || c === 6);
          const miolo = dentro && l >= 2 && l <= 4 && c >= 2 && c <= 4;
          marcar(L, C, (anel || miolo) ? 1 : 0);
        }
      }
    }

    // Padrões de alinhamento, exceto onde colidiriam com os localizadores.
    const centros = ALINHAMENTO[versao];
    for (const l0 of centros) {
      for (const c0 of centros) {
        const cantoLocalizador = (l0 <= 8 && c0 <= 8)
          || (l0 <= 8 && c0 >= n - 9) || (l0 >= n - 9 && c0 <= 8);
        if (cantoLocalizador) continue;
        for (let l = -2; l <= 2; l++) {
          for (let c = -2; c <= 2; c++) {
            const borda = Math.abs(l) === 2 || Math.abs(c) === 2;
            marcar(l0 + l, c0 + c, (borda || (l === 0 && c === 0)) ? 1 : 0);
          }
        }
      }
    }

    // Linhas de temporização.
    for (let i = 8; i < n - 8; i++) {
      marcar(6, i, i % 2 === 0 ? 1 : 0);
      marcar(i, 6, i % 2 === 0 ? 1 : 0);
    }

    // O módulo sempre escuro, e as casas do formato (preenchidas depois).
    marcar(n - 8, 8, 1);
    for (let i = 0; i <= 8; i++) {
      if (m[8][i] === null) { m[8][i] = 0; reservado[8][i] = true; }
      if (m[i][8] === null) { m[i][8] = 0; reservado[i][8] = true; }
    }
    for (let i = 0; i < 8; i++) {
      if (m[8][n - 1 - i] === null) { m[8][n - 1 - i] = 0; reservado[8][n - 1 - i] = true; }
      if (m[n - 1 - i][8] === null) { m[n - 1 - i][8] = 0; reservado[n - 1 - i][8] = true; }
    }

    // Blocos de informação de versão (a partir da 7).
    if (versao >= 7) {
      for (let i = 0; i < 18; i++) {
        const l = Math.floor(i / 3); const c = i % 3;
        marcar(n - 11 + c, l, 0);
        marcar(l, n - 11 + c, 0);
      }
    }

    return { m, reservado, n };
  }

  /* Os dados entram em ziguezague, de baixo para cima, duas colunas por
     vez, pulando a coluna 6 (a de temporização). */
  function preencher(m, reservado, n, bytes) {
    const bits = [];
    for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
    let k = 0;
    let subindo = true;
    for (let cDir = n - 1; cDir > 0; cDir -= 2) {
      if (cDir === 6) cDir = 5;
      for (let passo = 0; passo < n; passo++) {
        const l = subindo ? (n - 1 - passo) : passo;
        for (const c of [cDir, cDir - 1]) {
          if (reservado[l][c]) continue;
          m[l][c] = k < bits.length ? bits[k] : 0;
          k++;
        }
      }
      subindo = !subindo;
    }
  }

  /* Penalidade das quatro regras da especificação. A máscara escolhida é a
     de menor penalidade — é o que evita um QR com faixas grandes de uma cor
     só, que a câmera confunde com o localizador. */
  function penalidade(m, n) {
    let p = 0;

    // Regra 1: sequências de 5 ou mais iguais, em linha e em coluna.
    for (let i = 0; i < n; i++) {
      for (const pegar of [(j) => m[i][j], (j) => m[j][i]]) {
        let atual = pegar(0); let corrida = 1;
        for (let j = 1; j < n; j++) {
          const v = pegar(j);
          if (v === atual) { corrida++; } else { if (corrida >= 5) p += corrida - 2; atual = v; corrida = 1; }
        }
        if (corrida >= 5) p += corrida - 2;
      }
    }

    // Regra 2: blocos 2x2 de uma cor só.
    for (let l = 0; l < n - 1; l++) {
      for (let c = 0; c < n - 1; c++) {
        const v = m[l][c];
        if (v === m[l][c + 1] && v === m[l + 1][c] && v === m[l + 1][c + 1]) p += 3;
      }
    }

    // Regra 3: o padrão que imita o localizador (1011101 com 4 claros ao lado).
    const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= n - 11; j++) {
        for (const alvo of [A, B]) {
          let linhaBate = true; let colunaBate = true;
          for (let k = 0; k < 11; k++) {
            if (m[i][j + k] !== alvo[k]) linhaBate = false;
            if (m[j + k][i] !== alvo[k]) colunaBate = false;
          }
          if (linhaBate) p += 40;
          if (colunaBate) p += 40;
        }
      }
    }

    // Regra 4: desequilíbrio entre escuros e claros.
    let escuros = 0;
    for (let l = 0; l < n; l++) for (let c = 0; c < n; c++) escuros += m[l][c];
    const pct = (escuros * 100) / (n * n);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return p;
  }

  /* Os 15 bits do formato entram do MAIS significativo para o menos —
     bit 14 primeiro, em (8,0) e em (n-1,8).

     Escrevi ao contrário na primeira versão e o QR não lia. Não dá para
     "quase" acertar aqui: os 15 bits são um código BCH, e o leitor confere
     antes de olhar um único módulo de dado. Bit fora de ordem = leitor
     desiste do código inteiro, sem mensagem de erro. */
  function gravarFormato(m, n, mascara) {
    const bits = FORMATO_M[mascara];
    const bit = (i) => (bits >> i) & 1;

    // Cópia 1 — em volta do localizador de cima à esquerda.
    for (let i = 0; i <= 5; i++) m[8][i] = bit(14 - i);
    m[8][7] = bit(8);
    m[8][8] = bit(7);
    m[7][8] = bit(6);
    for (let i = 0; i <= 5; i++) m[5 - i][8] = bit(5 - i);

    /* Cópia 2 — sobe pela coluna 8 (bits 14..8), pula o módulo sempre
       escuro em (n-8, 8), e termina na linha 8 à direita (bits 7..0). */
    for (let i = 0; i <= 6; i++) m[n - 1 - i][8] = bit(14 - i);
    m[n - 8][8] = 1;
    for (let i = 0; i <= 7; i++) m[8][n - 8 + i] = bit(7 - i);
  }

  function gravarVersao(m, n, versao) {
    if (versao < 7) return;
    const info = INFO_VERSAO[versao];
    for (let i = 0; i < 18; i++) {
      const b = (info >> i) & 1;
      const l = Math.floor(i / 3); const c = i % 3;
      m[n - 11 + c][l] = b;
      m[l][n - 11 + c] = b;
    }
  }

  /* Devolve a matriz de 0/1, ou null se o texto não couber até a versão 10.
     Null é resposta honesta: quem chama cai no caminho manual em vez de
     desenhar um quadrado que a câmera não lê. */
  function matriz(texto) {
    const bytes = utf8(String(texto || ''));
    const versao = menorVersao(bytes.length);
    if (!versao) return null;

    const finais = intercalar(montarBits(bytes, versao), versao);

    let melhor = null;
    for (let mascara = 0; mascara < 8; mascara++) {
      const { m, reservado, n } = esqueleto(versao);
      preencher(m, reservado, n, finais);
      for (let l = 0; l < n; l++) {
        for (let c = 0; c < n; c++) {
          if (!reservado[l][c] && MASCARAS[mascara](l, c)) m[l][c] ^= 1;
        }
      }
      gravarFormato(m, n, mascara);
      gravarVersao(m, n, versao);
      const p = penalidade(m, n);
      if (!melhor || p < melhor.p) melhor = { m, p, n };
    }
    return melhor.m;
  }

  /* SVG pronto para colar na tela.

     A BORDA CLARA DE 4 MÓDULOS NÃO É MARGEM ESTÉTICA: a especificação a
     exige, e sem ela a câmera não acha onde o código começa. Já vi isso
     ser "otimizado" e o QR parar de ler.

     Fundo branco e pontos pretos fixos, nos dois temas: o leitor precisa de
     contraste alto e a câmera lê a tela, não o CSS. QR em tema escuro com
     pontos dourados é bonito e não funciona. */
  function svg(texto, lado) {
    const m = matriz(texto);
    if (!m) return null;
    const n = m.length;
    const BORDA = 4;
    const total = n + BORDA * 2;
    const partes = [];
    for (let l = 0; l < n; l++) {
      for (let c = 0; c < n; c++) {
        if (m[l][c]) partes.push(`M${c + BORDA} ${l + BORDA}h1v1h-1z`);
      }
    }
    const px = lado || 200;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"
      viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"
      role="img" aria-label="Código QR para o aplicativo autenticador">
      <rect width="${total}" height="${total}" fill="#ffffff"/>
      <path d="${partes.join('')}" fill="#000000"/>
    </svg>`;
  }

  raiz.SuincoQR = { matriz, svg };
}(typeof window !== 'undefined' ? window : globalThis));
