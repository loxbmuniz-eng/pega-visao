#!/usr/bin/env python3
"""Compara duas medições do juiz2_medir.py e imprime o delta que interessa."""
import json, sys
ref = json.load(open(sys.argv[1])); novo = json.load(open(sys.argv[2]))
def g(d, *ks):
    for k in ks:
        d = d.get(k) if isinstance(d, dict) else None
        if d is None: return None
    return d

print('== 1440: posição / altura / cortes / contraste / faixa')
for t in ('escuro', 'claro'):
    for a in ('torre', 'programacao', 'indicadores', 'devolucoes'):
        r, n = g(ref, '1440', t, a), g(novo, '1440', t, a)
        if not r or not n: continue
        dm = n['pos']['main'][3] - r['pos']['main'][3]
        dy = n['pos']['main'][1] - r['pos']['main'][1]
        cortes = {k: v for k, v in n['cortes'].items() if v}
        cb = [(x['classe'][:22], x['razao'], x['texto'][:18]) for x in n['contraste_baixo']]
        fx = n['faixa']; fr = r['faixa']
        print(f"{t:6} {a:12} main.y Δ{dy:+d} main.h Δ{dm:+d} ({r['pos']['main'][3]}→{n['pos']['main'][3]}) "
              f"fixed={n['posFixo']['header']}/{n['posFixo']['nav']} blur={n['posFixo']['headerBlur']} cardBg={n['cardBg']} "
              f"cortes={cortes or '—'} contraste<min={cb or '—'}")
        if fx: print(f"       faixa h {fr['h'] if fr else '?'}→{fx['h']} caixas={fx['caixas']} cols={fx['cols']} linhas={fx['linhas']} buracos={fx['buracos']} "
                     f"rotulos>1linha={[x[0] for x in fx['rotulos'] if x and x[1]>1]} cortados={[x[0] for x in fx['rotulos'] if x and x[2]]}")
        if a in ('torre', 'programacao'):
            key = 'thTorre' if a == 'torre' else 'thMont'
            dif = []
            for tr_, tn in zip(r[key], n[key]):
                if abs(tr_['x'] - tn['x']) > 2 or abs(tr_['w'] - tn['w']) > 2 or tn['sw'] > tn['cw'] or tn['linhas'] != tr_['linhas']:
                    dif.append(f"{tn['txt'][:20]!r}: x{tr_['x']}→{tn['x']} w{tr_['w']}→{tn['w']} sw/cw {tn['sw']}/{tn['cw']} linhas {tr_['linhas']}→{tn['linhas']}")
            print(f"       th ({len(n[key])}): fs={n[key][0]['fs'] if n[key] else '-'} fw={n[key][0]['fw'] if n[key] else '-'} tt={n[key][0]['tt'] if n[key] else '-'} | {'; '.join(dif) or 'x/width iguais ±2, sem corte, mesmas linhas'}")
            print(f"       wraps: {n['wraps']}")
        print(f"       titulos: {[(x['t'][:18], x['h'], x['fs']) for x in n['titulos'][:3]]} fonts th={n['fonts']['th']} td={n['fonts']['td']}")

print('\n== 390: fontes <11px / rolagem / acordeão / títulos')
for t in ('escuro', 'claro'):
    for a in ('torre', 'programacao', 'indicadores', 'devolucoes', 'cadastros'):
        r, n = g(ref, '390', t, a), g(novo, '390', t, a)
        if not r or not n: continue
        print(f"{t:6} {a:12} scroll {r['scroll']}→{n['scroll']} maisLargo={n['maisLargo']} pequenos={n['pequenos'] or '—'} "
              f"main.h {r['pos']['main'][3]}→{n['pos']['main'][3]} faixa.h={(r['faixa'] or {}).get('h')}→{(n['faixa'] or {}).get('h')}")
        if n['acordeao']: print(f"       acordeão ref={[(x['t'][:14], x['h'], x['fs']) for x in r['acordeao']]}\n                novo={[(x['t'][:14], x['h'], x['fs']) for x in n['acordeao']]}")
        print(f"       titulos ref={[(x['t'][:14], x['h'], x['linhas']) for x in r['titulos'][:3]]} novo={[(x['t'][:14], x['h'], x['linhas']) for x in n['titulos'][:3]]}")

print('\n== 1280 (120 cargas): rolagem interna e th')
for a in ('torre', 'programacao'):
    r, n = g(ref, '1280', a), g(novo, '1280', a)
    if not r or not n: continue
    key = 'thTorre' if a == 'torre' else 'thMont'
    print(f"{a:12} wraps ref={r['wraps']} novo={n['wraps']}")
    print(f"       th cortados ref={[(x['txt'][:22], x['sw'], x['cw']) for x in r[key] if x['sw']>x['cw']]} novo={[(x['txt'][:22], x['sw'], x['cw']) for x in n[key] if x['sw']>x['cw']]}")
    print(f"       th linhas ref={[x['linhas'] for x in r[key]]} novo={[x['linhas'] for x in n[key]]}  faixa={n['faixa'] and {k:n['faixa'][k] for k in ('h','caixas','cols','linhas','buracos')}}")

print('\n== tablet 1024 touch'); print(' ref ', ref.get('tablet')); print(' novo', novo.get('tablet'))
print('\n== filtrando (escuro)');
for k, d in (('ref', ref), ('novo', novo)):
    f = d.get('filtrando') or {}
    print(f" {k:4} ativo={f.get('ativoRotulo')} bg={f.get('ativoBg')} sombra={str(f.get('ativoSombra'))[:60]} linhaAcesa={f.get('linhaAcesa')} tdComBarra={f.get('tdComBarra')} tdBg={f.get('tdBg')} carga={f.get('carga')}")
    print(f"      contraste<min: {[(x['classe'][:20], x['razao'], x['texto'][:16], x['fundo']) for x in f.get('contraste_baixo', [])]}")
print('\n== linha acesa (claro): veic-tipo')
for k, d in (('ref', ref), ('novo', novo)):
    l = d.get('linhaAcesaClaro') or {}
    for est in ('repouso', 'hover'):
        e = l.get(est) or {}
        print(f" {k:4} {est:7} tdBg={e.get('tdBg')} trBg={e.get('trBg')} veic={[(x['razao'], x['fundo']) for x in e.get('veic', [])]} outros<min={e.get('todos')}")
print('\n== foco'); print(' ref ', ref.get('foco')); print(' novo', novo.get('foco'))
print('\n== botões por pixel (repouso/hover)')
for t in ('escuro', 'claro'):
    print(f" {t}: ref ={g(ref,'botoes',t)}")
    print(f" {t}: novo={g(novo,'botoes',t)}")
print('\n== toque na aba'); print(' ref ', ref.get('toqueAba')); print(' novo', novo.get('toqueAba'))
