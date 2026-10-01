# Transferência de titularidade para a Suinco

Pedido do dono em 01/10/2026: *"vamos começar a preparar o terreno pra
transferência de titularidade pra Suinco? começando pelo GitHub, que está no
meu pessoal"*. Proposta feita e **guardada para depois** a pedido dele
("guarda isso pra fazermos depois"). Nada abaixo foi executado.

## O que está na conta pessoal hoje

| Peça | Onde está | Etapa |
|---|---|---|
| Repositório do código | GitHub `loxbmuniz-eng/pega-visao` | 1 (esta) |
| Site (painel) | Vercel, time pessoal `loxbmuniz-engs-projects`, projetos `pega-visao` e `embarquesuinco.com.br` | depois |
| Domínio | Registro.br | depois |
| Servidor | VPS Hostinger | depois |

## Achado que muda a prioridade — o repositório é PÚBLICO

Conferido em 01/10/2026 (`list_repos`: `visibility: public`). Qualquer pessoa
na internet vê:

- o código e as regras da operação;
- **o cadastro de clientes** — `backend/migrations/019_clientes_oficiais.sql`
  (12 MB) e `044_cadastro_geral_clientes_02-09.sql`: código, nome, apelido,
  vendedor e supervisor de cada cliente. Dado pessoal e comercial (LGPD);
- `frota_seed_2026.csv` — placas e transportadoras;
- o IP do servidor, citado nos scripts.

Senha, chave e token **não** estão no repositório (o portão confere a cada
publicação). Tornar privado protege daqui para a frente; o que já foi público
pode ter sido copiado — isso não se desfaz.

## Passo zero — o e-mail titular (01/10/2026)

O dono definiu o e-mail que será titular e contato de todos os serviços:
**embarquelog@suinco.com.br**. O chamado para a TI criá-lo está em
`docs/CHAMADO_TI_EMAIL_EMBARQUELOG.md`. Vale para GitHub, Vercel, Registro.br
(domínio, em nome do CNPJ) e Hostinger (servidor).

## A ordem segura (aprovada como ideia, não executada)

1. **Organização da Suinco no GitHub** (o dono cria; grátis). Dois donos:
   ele e alguém da TI — a empresa não pode depender de uma pessoa só.
2. **Chave de leitura para o servidor** (deploy key só deste repositório).
   Hoje o servidor baixa o código sem senha porque o repositório é público;
   privado sem isso, o `atualizar.sh` quebra no `git pull`. A chave é criada
   DENTRO do servidor e nunca passa por conversa. Comando para o dono segue a
   regra do CLAUDE.md (conferido linha por linha nas duas versões, um por
   linha), com teste antes.
3. **Transferir** (Settings → Transfer). O GitHub redireciona o endereço
   antigo — servidor, Vercel e os agentes seguem funcionando. Logo depois:
   instalar na organização o app do Vercel (senão o site para de publicar) e
   o app do Claude; conferir o secret `ANTHROPIC_API_KEY` dos workflows
   `claude.yml` e `claude-revisao.yml`; trocar o endereço antigo em
   `backend/scripts/migrar_servidor.sh` (`REPO=`) e em
   `docs/AGENTE_NO_GIT_E_NO_SERVIDOR.md`.
4. **Tornar privado** — só depois do passo 2 provado com um `atualizar`.

**Custo a saber:** repositório privado consome minutos do GitHub Actions
(2.000/mês no plano grátis). Hoje `testes.yml` roda em todo push. Se passar,
limitar ao que importa — a bateria completa já roda no portão.

## Perguntas em aberto para o dono

1. A Suinco já tem organização no GitHub? Qual nome (sugestão:
   `suinco-logistica` ou `suinco`)? Quem é o segundo dono?
2. Tornar o repositório **privado** na mudança? Recomendação: sim, pelo
   cadastro de clientes exposto.
