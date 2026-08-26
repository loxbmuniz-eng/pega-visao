## O que muda, e por quê

<!-- Uma frase do que muda. Depois o MOTIVO: qual pedido, qual incidente,
     qual relato do pátio originou isto. Comentário e commit deste projeto
     explicam por quê, não o quê. -->

## Como foi verificado

<!-- Não "rodei os testes". QUAIS, e o que deu. Ex.:
     · 346 testes da API, 0 falhas
     · bateria de tela: 110 verdes
     · conferido na folha renderizada em A4, print anexo -->

- [ ] `npm run teste` no backend
- [ ] `bash publicar.sh` passou inteiro (inclui a bateria de tela)
- [ ] Se mexeu no painel: `python3 build_arquivo_unico.py` rodado

## Depende de atualizar o servidor?

<!-- Migração nova, ou mudança em backend/src, só valem depois do
     atualizar.sh na VPS. Enquanto isso, o painel pode mostrar uma coisa e
     o servidor devolver outra. Se for o caso, diga O QUE não funciona
     até lá. -->

- [ ] Não — funciona assim que o Vercel publicar
- [ ] Sim — e está declarado em `docs/O_QUE_FALTA_BLINDAR.md`

## Risco

<!-- O que pode quebrar se isto estiver errado, e como se percebe. -->
