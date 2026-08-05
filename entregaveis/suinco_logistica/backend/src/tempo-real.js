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

let io = null;

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
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('SEM_TOKEN'));
    try {
      const p = jwt.verify(token, config.jwtSegredo);
      socket.data.operador = { id: p.sub, nome: p.nome, setor: p.setor };
      return next();
    } catch {
      return next(new Error('TOKEN_INVALIDO'));
    }
  });

  io.on('connection', (socket) => {
    const op = socket.data.operador;
    socket.join('patio');
    console.log(`[tempo-real] ${op.nome} (${op.setor}) conectou · ${io.engine.clientsCount} online`);
    socket.emit('conectado', { operador: op, online: io.engine.clientsCount });

    socket.on('disconnect', (motivo) => {
      console.log(`[tempo-real] ${op.nome} saiu (${motivo}) · ${io.engine.clientsCount} online`);
    });
  });

  return io;
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
