// A sessão de navegação: um navegador vivo, reaproveitado entre pedidos.
//
// POR QUE reaproveitar aqui (e no estúdio não): lá, estado vazado entre
// vídeos produzia o dado da linha anterior no vídeo seguinte — erro silencioso
// e caro. Aqui o agente QUER continuidade: cookie de sessão, login feito,
// carrinho montado. Cada aba é isolada; o navegador é compartilhado.
import { abrirNavegador } from './cdp.mjs';
import { abrirPagina } from './pagina.mjs';
import { ROTEIRO } from './extrair.mjs';
import { AGENTE, aguardarVez, podeVisitar } from './robos.mjs';

export class BloqueadoPorRobots extends Error {
  constructor(url, regra) {
    super(`robots.txt do site proíbe ${url}${regra ? ` (regra: Disallow ${regra})` : ''}`);
    this.nome = 'BloqueadoPorRobots';
    this.url = url;
    this.regra = regra;
  }
}

export class Sessao {
  constructor({ largura = 1280, altura = 900, ignorarRobots = false } = {}) {
    this.largura = largura;
    this.altura = altura;
    // Existe porque há usos legítimos em site próprio ou ambiente de teste.
    // Vem desligado, e quem liga assume a decisão de forma explícita.
    this.ignorarRobots = ignorarRobots;
    this.navegador = null;
  }

  async iniciar() {
    if (!this.navegador) this.navegador = await abrirNavegador();
    return this.navegador;
  }

  async #preparar(url) {
    if (!this.ignorarRobots) {
      const { permitido, atraso, regra } = await podeVisitar(url);
      if (!permitido) throw new BloqueadoPorRobots(url, regra);
      await aguardarVez(url, atraso);
    } else {
      await aguardarVez(url);
    }
    const nav = await this.iniciar();
    const pagina = await abrirPagina(nav, { largura: this.largura, altura: this.altura });
    await pagina.enviar('Network.enable');
    await pagina.enviar('Network.setUserAgentOverride', { userAgent: AGENTE });
    return pagina;
  }

  async extrair(url, { esperarMs = 400, seletor = null } = {}) {
    const pagina = await this.#preparar(url);
    try {
      await pagina.irPara(url);
      if (seletor) await this.#esperarSeletor(pagina, seletor);
      // Página que monta com JS precisa de um instante depois do load.
      else if (esperarMs) await new Promise((r) => setTimeout(r, esperarMs));
      return await pagina.avaliar(ROTEIRO);
    } finally {
      await pagina.fechar();
    }
  }

  async capturar(url, { paginaInteira = false, esperarMs = 400 } = {}) {
    const pagina = await this.#preparar(url);
    try {
      await pagina.irPara(url);
      if (esperarMs) await new Promise((r) => setTimeout(r, esperarMs));
      if (paginaInteira) {
        const m = await pagina.enviar('Page.getLayoutMetrics');
        const alturaTotal = Math.ceil(m.cssContentSize?.height ?? this.altura);
        await pagina.enviar('Emulation.setDeviceMetricsOverride', {
          width: this.largura, height: Math.min(alturaTotal, 20000),
          deviceScaleFactor: 1, mobile: false,
        });
        await new Promise((r) => setTimeout(r, 120));
      }
      return await pagina.capturar();
    } finally {
      await pagina.fechar();
    }
  }

  async #esperarSeletor(pagina, seletor, limiteMs = 10000) {
    const fim = Date.now() + limiteMs;
    while (Date.now() < fim) {
      const achou = await pagina.avaliar(`Boolean(document.querySelector(${JSON.stringify(seletor)}))`);
      if (achou) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`o seletor ${seletor} não apareceu em ${limiteMs}ms`);
  }

  // Fluxo: uma lista de passos. É como o agente automatiza tarefa de várias
  // telas sem precisar de um comando novo para cada site.
  async fluxo(passos, { url = null } = {}) {
    const primeiro = url ?? passos.find((p) => p.ir)?.ir;
    if (!primeiro) throw new Error('o fluxo precisa de pelo menos um passo "ir".');
    const pagina = await this.#preparar(primeiro);
    const saida = [];
    try {
      for (const [i, passo] of passos.entries()) {
        const registrar = (o) => saida.push({ passo: i + 1, ...o });
        if (passo.ir) {
          if (!this.ignorarRobots) {
            const { permitido, regra } = await podeVisitar(passo.ir);
            if (!permitido) throw new BloqueadoPorRobots(passo.ir, regra);
          }
          await aguardarVez(passo.ir);
          await pagina.irPara(passo.ir);
          registrar({ acao: 'ir', url: passo.ir });
        } else if (passo.esperar) {
          await this.#esperarSeletor(pagina, passo.esperar, passo.limiteMs ?? 10000);
          registrar({ acao: 'esperar', seletor: passo.esperar });
        } else if (passo.pausar) {
          await new Promise((r) => setTimeout(r, Number(passo.pausar)));
          registrar({ acao: 'pausar', ms: Number(passo.pausar) });
        } else if (passo.clicar) {
          const ok = await pagina.avaliar(
            `(() => { const e = document.querySelector(${JSON.stringify(passo.clicar)});
                      if (!e) return false; e.click(); return true; })()`);
          if (!ok) throw new Error(`passo ${i + 1}: não achei ${passo.clicar} para clicar`);
          registrar({ acao: 'clicar', seletor: passo.clicar });
        } else if (passo.digitar) {
          const ok = await pagina.avaliar(
            `(() => { const e = document.querySelector(${JSON.stringify(passo.digitar.seletor)});
                      if (!e) return false;
                      e.focus(); e.value = ${JSON.stringify(passo.digitar.texto)};
                      e.dispatchEvent(new Event('input', {bubbles:true}));
                      e.dispatchEvent(new Event('change', {bubbles:true}));
                      return true; })()`);
          if (!ok) throw new Error(`passo ${i + 1}: não achei ${passo.digitar.seletor} para preencher`);
          registrar({ acao: 'digitar', seletor: passo.digitar.seletor });
        } else if (passo.extrair) {
          registrar({ acao: 'extrair', dado: await pagina.avaliar(ROTEIRO) });
        } else if (passo.ler) {
          const valor = await pagina.avaliar(
            `(() => { const n = [...document.querySelectorAll(${JSON.stringify(passo.ler)})];
                      return n.map(e => (e.textContent || '').replace(/\\s+/g,' ').trim()); })()`);
          registrar({ acao: 'ler', seletor: passo.ler, valor });
        } else {
          throw new Error(`passo ${i + 1}: não reconheço ${JSON.stringify(passo)}`);
        }
      }
      return saida;
    } finally {
      await pagina.fechar();
    }
  }

  async fechar() {
    if (this.navegador) {
      await this.navegador.fechar();
      this.navegador = null;
    }
  }
}
