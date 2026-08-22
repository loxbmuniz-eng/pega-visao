/* SEGUNDO FATOR — TOTP (RFC 6238), sem dependência nova.
   =====================================================================

   Etapa 4 do protocolo de segurança (22/08/2026). Fecha a brecha B4: senha
   vazada de administrador dá poder de restaurar, apagar e criar usuário.

   POR QUE ESCREVER EM VEZ DE INSTALAR. TOTP é HMAC-SHA1 sobre um contador
   de 30 segundos — trinta linhas com `node:crypto`, que já vem no Node. Uma
   biblioteca a mais é mais uma dependência para auditar, atualizar e
   confiar, num projeto cuja auditoria hoje retorna zero vulnerabilidades.
   Aqui o código próprio é a escolha CONSERVADORA, não a arrojada.

   POR QUE NÃO SMS. É interceptável (troca de chip), depende de sinal — e no
   pátio o sinal falha justamente nas horas ruins. Aplicativo autenticador
   funciona no modo avião.

   COMPATIBILIDADE: SHA-1, 6 dígitos, janela de 30 s. Não é escolha de
   segurança, é o que Google Authenticator e Microsoft Authenticator falam.
   Trocar por SHA-256 quebraria os aplicativos que as pessoas realmente têm
   no celular. */

import crypto from 'node:crypto';

const ALFABETO_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASSO_SEGUNDOS = 30;
const DIGITOS = 6;

/* A janela de tolerância aceita o código anterior e o seguinte.

   Não é frouxidão: relógio de celular anda alguns segundos fora, e a pessoa
   leva um tempo entre ler e digitar. Sem tolerância, o segundo fator falha
   de forma aleatória — e controle que falha sem motivo é controle que
   alguém desliga. Uma janela para cada lado é o padrão da indústria. */
const JANELA = 1;

export function gerarSegredo(bytes = 20) {
  return paraBase32(crypto.randomBytes(bytes));
}

export function paraBase32(buf) {
  let bits = 0, valor = 0, saida = '';
  for (const b of buf) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO_B32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO_B32[(valor << (5 - bits)) & 31];
  return saida;
}

export function deBase32(txt) {
  let bits = 0, valor = 0;
  const bytes = [];
  for (const c of String(txt).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    valor = (valor << 5) | ALFABETO_B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function codigoDoMomento(segredoB32, emSegundos = Math.floor(Date.now() / 1000)) {
  const contador = Math.floor(emSegundos / PASSO_SEGUNDOS);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(contador / 2 ** 32), 0);
  buf.writeUInt32BE(contador >>> 0, 4);

  const mac = crypto.createHmac('sha1', deBase32(segredoB32)).update(buf).digest();
  // Truncagem dinâmica da RFC 4226: o último nibble diz onde ler.
  const desloc = mac[mac.length - 1] & 0x0f;
  const num = ((mac[desloc] & 0x7f) << 24)
    | ((mac[desloc + 1] & 0xff) << 16)
    | ((mac[desloc + 2] & 0xff) << 8)
    | (mac[desloc + 3] & 0xff);
  return String(num % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

/* Comparação em TEMPO CONSTANTE.

   Comparar com `===` vaza, pelo tempo de resposta, quantos dígitos iniciais
   estavam certos — e seis dígitos caem por força bruta muito mais rápido
   com essa dica. `timingSafeEqual` exige mesmo tamanho, daí a checagem de
   formato antes. */
export function conferirCodigo(segredoB32, codigoDigitado, emSegundos = Math.floor(Date.now() / 1000)) {
  const limpo = String(codigoDigitado || '').replace(/\D/g, '');
  if (limpo.length !== DIGITOS || !segredoB32) return false;
  for (let d = -JANELA; d <= JANELA; d++) {
    const esperado = codigoDoMomento(segredoB32, emSegundos + d * PASSO_SEGUNDOS);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(limpo))) return true;
  }
  return false;
}

/* O endereço que o aplicativo autenticador entende.

   O rótulo é o que a pessoa vê na lista do celular. "Embarque Suinco" antes
   do e-mail importa: quem tem seis contas no aplicativo precisa saber qual é
   esta sem abrir. */
export function enderecoParaAplicativo(email, segredoB32, emissor = 'Embarque Suinco') {
  const rotulo = encodeURIComponent(`${emissor}:${email}`);
  const params = new URLSearchParams({
    secret: segredoB32, issuer: emissor, algorithm: 'SHA1',
    digits: String(DIGITOS), period: String(PASSO_SEGUNDOS),
  });
  return `otpauth://totp/${rotulo}?${params.toString()}`;
}

/* CÓDIGOS DE RECUPERAÇÃO — o plano para o celular perdido.

   Sem eles, celular quebrado ou trocado significa depender de outro
   administrador estar disponível. Com eles, a pessoa entra sozinha uma vez
   e reconfigura com calma.

   Guardados com HASH, nunca em claro: quem ler o banco não pode usá-los. E
   cada um vale UMA vez — é a diferença entre código de recuperação e
   segunda senha. */
export function gerarCodigosRecuperacao(quantos = 8) {
  return Array.from({ length: quantos }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-'));
}

export function hashDoCodigo(codigo) {
  return crypto.createHash('sha256')
    .update(String(codigo).toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .digest('hex');
}
