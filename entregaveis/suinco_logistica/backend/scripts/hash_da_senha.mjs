/* Lê uma senha da ENTRADA PADRÃO e escreve o base64 do hash bcrypt (08/10/2026).
   Usado por gravar_senha_usuarios.sh. A senha nunca passa por argumento nem
   por variável de ambiente — os dois aparecem na lista de processos. Custo 12,
   o mesmo das senhas dos operadores (CUSTO_BCRYPT em rotas/operadores.js). */
import bcrypt from 'bcryptjs';

let senha = '';
for await (const pedaco of process.stdin) senha += pedaco;
process.stdout.write(Buffer.from(bcrypt.hashSync(senha, 12)).toString('base64'));
