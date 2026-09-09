/* Socket.IO — a camada que reduz a latência de 15 s para imediata.

   PRINCÍPIO QUE NÃO PODE SER ESQUECIDO: o socket é otimização, nunca a fonte
   da verdade. Se ele cair, o painel volta para `GET /api/estado?desde=` a
   cada 15 s — o mesmo mecanismo já validado com 10 terminais simultâneos.
   Nenhum dado depende do socket estar de pé.

   Por isso `emitir()` nunca lança: falha de socket não pode derrubar uma
   gravação que já foi confirmada no banco. O caminhão está no pátio; a
   gravação vale mesmo que o aviso não saia. */

import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { sessaoAindaVale } from './middleware/auth.js';
import { podeVerValorDeFrete } from './dominio/fluxo.js';
import { semValorDeFrete } from './dominio/cargas.js';

let io = null;

/* Quem está online agora, por operador — não por conexão.

   Uma pessoa pode ter duas abas abertas (o pátio troca de turno sem trocar
   de terminal); contar conexão faria ela "sair" da lista assim que fechasse
   UMA aba, mesmo com a outra ainda aberta. A contagem por operador só marca
   "offline" quando a ÚLTIMA conexão dele cai. */
const conexoesPorOperador = new Map(); // id do operador (string) -> nº de conexões abertas

export function operadoresOnlineIds() {
  return [...conexoesPorOperador.keys()];
}

function emitirPresenca() {
  if (!io) return;
  io.to('patio').emit('presenca:atualizada', { online: operadoresOnlineIds() });
}

export function iniciarTempoReal(servidorHttp) {
  io = new Server(servidorHttp, {
    cors: { origin: config.origens, credentials: true },
    // O pátio tem rede instável. Tolerância maior evita reconexão a cada
    // oscilação, que custa mais do que a espera.
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  /* Socket sem autenticação seria um vazamento silencioso: qualquer um na
     internet abriria uma conexão e receberia todo o movimento do pátio em
     tempo real, sem passar por nenhuma rota protegida. */
  /* A MESMA CONFERÊNCIA DE SESSÃO DO HTTP (09/09/2026). Só o jwt.verify
     deixava um operador bloqueado — ou com a senha trocada — continuar
     recebendo o pátio inteiro pelo socket até o token vencer (12 h), com
     placa, cliente e motorista. validarTokenDeSocket confere sessao_versao
     e ativo, como toda requisição HTTP. */
  io.use(async (socket, next) => {
    try {
      socket.data.operador = await validarTokenDeSocket(socket.handshake.auth?.token);
      return next();
    } catch (e) {
      return next(e instanceof Error ? e : new Error(String(e)));
    }
  });

  io.on('connection', (socket) => {
    const op = socket.data.operador;
    socket.join('patio');
    /* A SALA DO FRETE (09/09/2026). Quem pode ver valor entra também aqui,
       e é para cá que a carga completa é emitida — o `patio` recebe a mesma
       carga com os campos de dinheiro apagados.

       Duas salas, e não um filtro no cliente: esconder na tela deixaria o
       valor viajar pelo socket até o navegador do Comercial, onde qualquer
       um lê no console. O que não pode ser visto não é enviado. */
    if (podeVerValorDeFrete(op.setor)) socket.join('frete');
    console.log(`[tempo-real] ${op.nome} (${op.setor}) conectou · ${io.engine.clientsCount} online`);
    socket.emit('conectado', { operador: op, online: io.engine.clientsCount });

    // Snapshot imediato para quem acabou de conectar — sem isto, uma aba de
    // Usuários recém-aberta ficaria "sem ninguém online" até a próxima vez
    // que alguém mais entrasse ou saísse.
    socket.emit('presenca:atualizada', { online: operadoresOnlineIds() });

    const idOp = String(op.id);
    const antes = conexoesPorOperador.get(idOp) || 0;
    conexoesPorOperador.set(idOp, antes + 1);
    if (antes === 0) emitirPresenca(); // primeira conexão desta pessoa: ela estava offline

    socket.on('disconnect', (motivo) => {
      console.log(`[tempo-real] ${op.nome} saiu (${motivo}) · ${io.engine.clientsCount} online`);
      const atual = conexoesPorOperador.get(idOp) || 0;
      if (atual <= 1) {
        conexoesPorOperador.delete(idOp);
        emitirPresenca(); // última conexão desta pessoa: ela fica offline
      } else {
        conexoesPorOperador.set(idOp, atual - 1);
      }
    });
  });

  return io;
}

export async function validarTokenDeSocket(token) {
  if (!token) throw new Error('SEM_TOKEN');
  let p;
  try {
    p = jwt.verify(token, config.jwtSegredo, { algorithms: ['HS256'] });
  } catch {
    throw new Error('TOKEN_INVALIDO');
  }
  const sessao = await sessaoAindaVale(p.sub, p.sv);
  if (!sessao.vale) throw new Error(sessao.motivo || 'SESSAO_REVOGADA');
  return { id: p.sub, nome: p.nome, setor: p.setor };
}

/* Derruba as conexões de quem foi bloqueado ou teve a sessão revogada —
   o HTTP já recusa na hora; o socket precisava ser mandado embora. */
export function desconectarOperador(id) {
  if (!io) return 0;
  let n = 0;
  for (const s of io.sockets.sockets.values()) {
    if (String(s.data?.operador?.id) === String(id)) { s.disconnect(true); n++; }
  }
  return n;
}

/* Carga em tempo real, com o preço só para quem pode ver.

   Existe separada de emitir() de propósito: `emitir` serve para dezenas de
   eventos que não têm dinheiro dentro (presença, frota, programação), e
   fazer todos passarem por uma regra de frete seria pedir para alguém
   esquecer por que ela está lá. Quem emite CARGA chama esta. */
export function emitirCarga(evento, carga) {
  if (!io) return;
  try {
    io.to('frete').emit(evento, carga);
    io.to('patio').except('frete').emit(evento, semValorDeFrete(carga));
  } catch (e) {
    console.error('[tempo-real] falha ao emitir carga', evento, '—', e.message);
  }
}

export function emitir(evento, dados) {
  if (!io) return;
  try {
    io.to('patio').emit(evento, dados);
  } catch (e) {
    console.error('[tempo-real] falha ao emitir', evento, '—', e.message);
  }
}

export function conectados() {
  return io ? io.engine.clientsCount : 0;
}
