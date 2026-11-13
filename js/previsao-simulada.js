/*
 * PrevisaoSimulada: faz, no navegador, o papel das funções do banco do programa para Windows
 * (app-windows/database/019_semana7_tela_previsao.sql):
 *
 *   PrevisaoSimulada.tela()           → previsao_tela()      (topo da tela e aba "Teste da previsão")
 *   PrevisaoSimulada.pedidoSugerido() → pedido_sugerido()    (um item por fornecedor ativo)
 *   PrevisaoSimulada.produto(id)      → previsao_produto(id) (12 semanas para trás, 8 para a frente)
 *   PrevisaoSimulada.alertas()        → previsao_alertas()   (falta, parado, queda, alta, data)
 *
 * Cada função devolve um objeto no MESMO formato do JSON da função do banco (mesmos nomes de campos,
 * datas "aaaa-mm-dd"), para que a tela (js/previsao.js) possa trocar estas chamadas por chamadas reais
 * à API sem mudar nada no desenho.
 *
 * Como o site não tem back-end, o histórico de vendas é inventado de forma determinística (sempre igual para o
 * mesmo produto e o mesmo dia) a partir dos produtos de `Dados`. A previsão segue a mesma ideia do banco:
 *   previsto do dia = tendência × peso do dia da semana × peso do mês × (1 + extra da data especial),
 * aprendida com até 4 anos de vendas (dias normais), e o pedido sugerido usa a mesma regra do pedido_sugerido:
 *   sugerido = previsão até a entrega seguinte + 1,28 × desvio − estoque − já pedido,
 *   arredondado para cima em caixas fechadas (produto por quilo: quilos inteiros).
 * Estoque, pedidos pendentes, fornecedores e prazos vêm de verdade dos `Dados` simulados do site.
 */
const PrevisaoSimulada = (() => {
  const MARGEM = 1.28;        // pedido: em ~9 de cada 10 ciclos não falta
  const FAIXA_SEMANA = 1.33;  // faixa de 80% para uma semana (previsao_produto)
  const DIAS_FRENTE = 60;     // previsao_calcular(60)
  const ANOS_TREINO = 4;

  // O site ainda não guarda os dias de entrega nem o pedido mínimo do fornecedor (no banco: fornecedores.dias_entrega
  // e fornecedores.pedido_minimo). Enquanto isso, valores de exemplo para os fornecedores do cadastro inicial.
  // Dias: 0 = domingo … 6 = sábado. Sem dias de entrega = pedido às segundas (como no banco).
  const DIAS_ENTREGA_EXEMPLO = { 1: "1,4", 2: "2,5", 3: "3", 4: "2", 5: "1,2,3,4,5,6" };
  const PEDIDO_MINIMO_EXEMPLO = { 1: 300, 3: 250, 4: 400 };

  // ------------------------------------------------------------ Datas como número de dias (sem fuso horário)
  const DIA_MS = 86400000;
  const num = iso => { const [a, m, d] = iso.split("-").map(Number); return Math.round(Date.UTC(a, m - 1, d) / DIA_MS); };
  const iso = n => new Date(n * DIA_MS).toISOString().slice(0, 10);
  const dow = n => ((n + 4) % 7 + 7) % 7;                 // 0 = domingo (01/01/1970 foi quinta)
  // Mês e ano de cada dia guardados numa tabela (a conta passa por dezenas de milhares de dias)
  const MESES = new Int8Array(40000).fill(-1), ANOS = new Int16Array(40000);
  function guardar(n) {
    const d = new Date(n * DIA_MS);
    MESES[n] = d.getUTCMonth();
    ANOS[n] = d.getUTCFullYear();
  }
  const mes = n => { if (MESES[n] < 0) guardar(n); return MESES[n]; };   // 0 = janeiro
  const ano = n => { if (MESES[n] < 0) guardar(n); return ANOS[n]; };
  const inicioSemana = n => n - (dow(n) + 6) % 7;          // segunda-feira (date_trunc('week'))
  const hoje = () => num(Dados.hojeISO());

  // ------------------------------------------------------------ Números "aleatórios" que sempre saem iguais
  function hash(a, b, c = 0) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }
  const normal = (a, b) => Math.sqrt(-2 * Math.log(hash(a, b, 1) || 1e-9)) * Math.cos(2 * Math.PI * hash(a, b, 2));

  // ------------------------------------------------------------ Calendário de datas especiais (eventos_calendario)
  function pascoa(a) {
    const b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4;
    const g = Math.floor((c + 8) / 25), h = Math.floor((c - g + 1) / 3), i = (19 * b + c - e - h + 15) % 30;
    const k = Math.floor(d / 4), l = d % 4, m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451);
    const mesP = Math.floor((i + m - 7 * n + 114) / 31), diaP = ((i + m - 7 * n + 114) % 31) + 1;
    return Math.round(Date.UTC(a, mesP - 1, diaP) / DIA_MS);
  }
  const data = (a, m, d) => Math.round(Date.UTC(a, m - 1, d) / DIA_MS);
  function enesimo(a, m, diaSemana, n) {   // n-ésimo dia da semana do mês
    let d = data(a, m, 1);
    while (dow(d) !== diaSemana) d++;
    return d + 7 * (n - 1);
  }
  const calendario = new Map();
  function eventosDoAno(a) {
    const lista = [
      [data(a, 1, 1), "Ano Novo", 0.6],
      [pascoa(a) - 47, "Carnaval", 1.1],
      [pascoa(a) - 2, "Sexta-feira Santa", 1.25],
      [enesimo(a, 5, 0, 2), "Dia das Mães", 1.3],
      [enesimo(a, 8, 0, 2), "Dia dos Pais", 1.25],
      [enesimo(a, 11, 4, 4) + 1, "Black Friday", 1.4],
      [data(a, 12, 24), "Véspera de Natal", 1.6],
      [data(a, 12, 25), "Natal", 0.5],
      [data(a, 12, 31), "Véspera de Ano Novo", 1.5],
    ];
    lista.forEach(([dia, nome, fator]) => calendario.set(dia, { dia, nome, fator }));
  }
  const anosNoCalendario = new Set();
  function evento(n) {
    const a = ano(n);
    if (!anosNoCalendario.has(a)) { anosNoCalendario.add(a); eventosDoAno(a); }
    return calendario.get(n) || null;
  }

  // ------------------------------------------------------------ Histórico de vendas inventado (previsao_vendas_produto)
  const SEMANA_LOJA = [0.85, 0.9, 0.85, 0.9, 1.0, 1.2, 1.3];
  const MES_LOJA = [0.95, 0.9, 0.95, 0.95, 1.0, 0.95, 1.0, 1.0, 0.95, 1.0, 1.05, 1.3];
  // Quanto cada categoria sente as datas especiais (1 = como a loja)
  const PESO_DATA = { acougue: 2.2, mercearia: 1.2, graos: 0.7, laticinios: 1.0, limpeza: 0.3 };
  const catChave = c => Regras.norm(c).replace(/[^a-z]/g, "");

  const normalizar = v => { const m = v.reduce((s, x) => s + x, 0) / v.length; return v.map(x => x / (m || 1)); };

  function historico(p, ateDia) {
    const inicio = data(ano(ateDia) - 8, 1, 1);
    const kg = Regras.porPeso(p);
    const base = Math.max(0.6, p.minimo * 0.45);
    const cresc = -0.04 + 0.14 * hash(p.id, 11);
    const semana = normalizar(SEMANA_LOJA.map((x, i) => x * (0.9 + 0.2 * hash(p.id, 20 + i))));
    const meses = normalizar(MES_LOJA.map((x, i) => x * (0.92 + 0.16 * hash(p.id, 40 + i))));
    const pesoData = PESO_DATA[Object.keys(PESO_DATA).find(k => catChave(p.categoria).includes(k))] ?? 1;
    const parado = Regras.qtd(p) === 0;   // sem estoque: os últimos dias ficaram sem venda (falta na prateleira)
    const n = ateDia - inicio + 1;
    const y = new Float64Array(n);
    const falta = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const d = inicio + i;
      const nivel = base * Math.max(0.15, 1 + cresc * (d - ateDia) / 365.25);
      let media = nivel * semana[dow(d)] * meses[mes(d)];
      const ev = evento(d);
      if (ev) media *= Math.max(0.3, 1 + (ev.fator - 1) * pesoData * (0.7 + 0.6 * hash(p.id, ev.nome.length, 3)));
      // Exemplo para a aba Alertas: um produto vendendo menos e outro mais que o normal nas últimas 2 semanas
      if (d > ateDia - 14 && p.id === 4) media *= 0.4;
      if (d > ateDia - 14 && p.id === 7) media *= 1.6;
      const desvio = Math.sqrt(media * 1.2) + 0.08 * media;
      let v = Math.max(0, media + desvio * normal(p.id * 7919, d));
      if (parado && d > ateDia - 3) { v = 0; falta[i] = 1; }
      y[i] = kg ? Math.round(v * 100) / 100 : Math.round(v);
    }
    return { inicio, fim: ateDia, y, falta, valor: d => (d < inicio || d > ateDia ? 0 : y[d - inicio]) };
  }

  // ------------------------------------------------------------ Modelo (previsao_ajustar, simplificado)
  function regressao(xs, ys) {
    const n = xs.length;
    if (n < 2) return { a: n ? ys[0] : 0, b: 0 };
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const den = n * sxx - sx * sx;
    const b = den ? (n * sxy - sx * sy) / den : 0;
    return { a: (sy - b * sx) / n, b };
  }

  function ajustar(h, ini, fim) {
    ini = Math.max(ini, h.inicio);
    const t = d => (d - ini) / 365.25;
    const normais = [];
    for (let d = ini; d <= fim; d++) if (!evento(d) && !h.falta[d - h.inicio]) normais.push(d);
    let sem = Array(7).fill(1), mm = Array(12).fill(1), a = 0, b = 0;
    for (let volta = 0; volta < 3; volta++) {
      ({ a, b } = regressao(normais.map(t), normais.map(d => h.valor(d) / (sem[dow(d)] * mm[mes(d)]))));
      const tend = d => Math.max(a + b * t(d), 0.01);
      const sS = Array(7).fill(0), nS = Array(7).fill(0), sM = Array(12).fill(0), nM = Array(12).fill(0);
      normais.forEach(d => { sS[dow(d)] += h.valor(d) / (tend(d) * mm[mes(d)]); nS[dow(d)]++; });
      sem = normalizar(sS.map((s, i) => nS[i] ? s / nS[i] : 1));
      normais.forEach(d => { sM[mes(d)] += h.valor(d) / (tend(d) * sem[dow(d)]); nM[mes(d)]++; });
      mm = normalizar(sM.map((s, i) => nM[i] ? s / nM[i] : 1));
    }
    ({ a, b } = regressao(normais.map(t), normais.map(d => h.valor(d) / (sem[dow(d)] * mm[mes(d)]))));
    const ajuste = d => Math.max(a + b * t(d), 0) * sem[dow(d)] * mm[mes(d)];

    // Desvio do dia, medido no último ano do treino
    const ultimos = normais.filter(d => d > fim - 365);
    const res = ultimos.map(d => h.valor(d) - ajuste(d));
    const mediaRes = res.reduce((s, x) => s + x, 0) / (res.length || 1);
    const desvio = Math.sqrt(res.reduce((s, x) => s + (x - mediaRes) ** 2, 0) / Math.max(res.length - 1, 1));
    const mediaAjuste = ultimos.reduce((s, d) => s + ajuste(d), 0) / (ultimos.length || 1);
    const mediaDia = ultimos.reduce((s, d) => s + h.valor(d), 0) / (ultimos.length || 1);

    // Datas especiais: quanto vende a mais que o normal, em proporção
    const extras = {};
    let total = 0, emDatas = 0;
    for (let d = ini; d <= fim; d++) {
      const v = h.valor(d);
      total += v;
      const ev = evento(d);
      if (!ev) continue;
      emDatas += v;
      const aj = ajuste(d);
      if (aj <= 0) continue;
      const e = extras[ev.nome] || (extras[ev.nome] = { soma: 0, n: 0 });
      e.soma += (v - aj) / aj;
      e.n++;
    }
    const lifts = {};
    Object.entries(extras).forEach(([nome, e]) => { lifts[nome] = e.soma / e.n; });
    const tm = normais.length ? normais.reduce((s, d) => s + t(d), 0) / normais.length : 0;
    return {
      ini, fim, a, b, sem, mes: mm, ajuste, lifts, desvio, mediaDia, diasUsados: normais.length,
      desvioRel: mediaAjuste > 0 ? desvio / mediaAjuste : 0,
      nivel: Math.max(a + b * t(fim), 0),
      crescimento: (a + b * tm) > 0 ? b / (a + b * tm) : 0,
      parteDatas: total > 0 ? emDatas / total : 0,
      vendidoTotal: total,
      tendencia: d => Math.max(a + b * t(d), 0),
    };
  }

  // Previsão de um dia (previsao_dias): previsto, desvio e a data especial
  function prever(m, d) {
    const ev = evento(d);
    const lift = ev && m.lifts[ev.nome] !== undefined ? m.lifts[ev.nome] : 0;
    const previsto = Math.max(m.ajuste(d) * (1 + lift), 0);
    return { previsto, desvio: previsto > 0 ? Math.max(m.desvioRel * previsto, 0.05) : 0, evento: ev && ev.fator > 0 ? ev.nome : null };
  }

  // ------------------------------------------------------------ Teste: erro por produto e semana (previsao_testar)
  function testar(h, ini, fim) {
    const m = ajustar(h, ini - ANOS_TREINO * 365, ini - 1);
    let media60 = 0;
    for (let d = ini - 60; d < ini; d++) media60 += h.valor(d);
    media60 /= 60;
    const r = { vendido: 0, previsto: 0, abs: 0, absIngenuo: 0, absMedia: 0 };
    for (let s = ini; s <= fim; s += 7) {
      let v = 0, p = 0, ing = 0, med = 0;
      for (let d = s; d < Math.min(s + 7, fim + 1); d++) {
        v += h.valor(d);
        p += prever(m, d).previsto;
        ing += h.valor(d - 364);      // repetir o mesmo dia da semana do ano passado
        med += media60;
      }
      r.vendido += v; r.previsto += p;
      r.abs += Math.abs(v - p); r.absIngenuo += Math.abs(v - ing); r.absMedia += Math.abs(v - med);
    }
    return r;
  }
  const somar = lista => lista.reduce((t, r) => ({
    vendido: t.vendido + r.vendido, previsto: t.previsto + r.previsto,
    abs: t.abs + r.abs, absIngenuo: t.absIngenuo + r.absIngenuo, absMedia: t.absMedia + r.absMedia,
  }), { vendido: 0, previsto: 0, abs: 0, absIngenuo: 0, absMedia: 0 });
  const r4 = x => Math.round(x * 10000) / 10000;
  const r1 = x => Math.round(x * 10) / 10;
  const r3 = x => Math.round(x * 1000) / 1000;
  const erros = r => r.vendido > 0
    ? { erro: r4(r.abs / r.vendido), erro_ingenuo: r4(r.absIngenuo / r.vendido), erro_media: r4(r.absMedia / r.vendido), vies: r4((r.previsto - r.vendido) / r.vendido) }
    : { erro: null, erro_ingenuo: null, erro_media: null, vies: null };

  // ------------------------------------------------------------ Cálculo de cada produto (guardado até os dados mudarem)
  const cache = new Map();
  function analise(p) {
    const ontem = hoje() - 1;
    const chave = [p.id, p.minimo, p.categoria, p.unidade, Regras.qtd(p) === 0, ontem].join("|");
    if (cache.has(chave)) return cache.get(chave);
    const h = historico(p, ontem);
    const modelo = ajustar(h, ontem - ANOS_TREINO * 365 + 1, ontem);
    const ultimo = testar(h, hoje() - 365, ontem);
    const anoAtual = ano(hoje());
    const anos = [];
    for (let a = anoAtual - 5; a < anoAtual; a++) anos.push({ ano: a, r: testar(h, data(a, 1, 1), data(a, 12, 31)) });
    const dias = [];
    for (let d = hoje(); d < hoje() + DIAS_FRENTE; d++) dias.push({ dia: d, ...prever(modelo, d) });
    const r = { p, h, modelo, ultimo, anos, dias, diaDe: d => dias[d - hoje()] || prever(modelo, d) };
    cache.set(chave, r);
    return r;
  }

  const situacaoModelo = m => m.vendidoTotal <= 0 ? "sem_vendas"
    : m.parteDatas >= 0.5 ? "de_epoca" : (m.diasUsados < 56 || m.vendidoTotal < 10) ? "pouco_historico" : "ok";

  // Venda perdida simulada (no banco: simulacao_faltas): produto com estoque vendável para menos de 2 dias
  // de venda ficou faltando na prateleira em alguns dias da última semana.
  function faltas(d) {
    return d.produtos.map(p => {
      const a = analise(p);
      const media = a.modelo.mediaDia;
      if (media <= 0 || Regras.vendavel(p) >= media * 2) return null;
      const clientes = 4 + Math.floor(hash(p.id, hoje(), 5) * 9);
      return { p, clientes, quantidade: clientes * (Regras.porPeso(p) ? 1.2 : 1.5) };
    }).filter(Boolean);
  }

  // "Recalcula sozinha toda madrugada": no site, finge que rodou hoje às 3h
  function calculadoEm() {
    const c = new Date();
    c.setHours(3, 0, 0, 0);
    return c.toISOString();
  }

  // ------------------------------------------------------------ previsao_tela()
  function tela() {
    const d = Dados.ler();
    const analises = d.produtos.map(analise);
    const ontem = hoje() - 1;
    const geralUlt = erros(somar(analises.map(a => a.ultimo)));
    const lojaCresc = analises.length ? analises.reduce((s, a) => s + a.modelo.crescimento, 0) / analises.length : null;
    const f = faltas(d);
    const porProduto = analises.filter(a => a.ultimo.vendido >= 52).map(a => ({
      produto_id: a.p.id, produto: a.p.nome, erro: erros(a.ultimo).erro, erro_ingenuo: erros(a.ultimo).erro_ingenuo, vendido: r3(a.ultimo.vendido),
    })).filter(x => x.erro !== null);
    return {
      hoje: iso(hoje()),
      geral: analises.length ? {
        calculado_em: calculadoEm(),
        treino_ini: iso(Math.max(ontem - ANOS_TREINO * 365 + 1, Math.min(...analises.map(a => a.h.inicio)))),
        treino_fim: iso(ontem),
        crescimento_ano: lojaCresc === null ? null : r4(lojaCresc),
        teste_erro_semana: geralUlt.erro, teste_erro_ingenuo: geralUlt.erro_ingenuo,
        teste_erro_media: geralUlt.erro_media, teste_vies: geralUlt.vies,
        teste_ini: iso(hoje() - 365), teste_fim: iso(ontem),
      } : null,
      perdidas_7d: { clientes: f.reduce((s, x) => s + x.clientes, 0), produtos: f.length },
      anos: analises.length ? analises[0].anos.map((_, i) => ({ ano: analises[0].anos[i].ano, ...erros(somar(analises.map(a => a.anos[i].r))) })) : [],
      piores: [...porProduto].sort((a, b) => b.erro - a.erro).slice(0, 10),
      melhores: [...porProduto].sort((a, b) => a.erro - b.erro).slice(0, 5),
    };
  }

  // ------------------------------------------------------------ pedido_sugerido()
  function diasEntrega(f) {
    const texto = f.diasEntrega ?? DIAS_ENTREGA_EXEMPLO[f.id] ?? "";
    const dias = String(texto).split(",").map(x => x.trim()).filter(x => /^[0-6]$/.test(x)).map(Number);
    return dias.length ? dias : null;
  }

  function pedidoSugerido() {
    const d = Dados.ler();
    const h0 = hoje();
    const res = [];
    Regras.ativos(d).forEach(f => {
      const dias = diasEntrega(f);
      const prazo = f.prazo ?? 3;
      let pedido = null;
      for (let x = h0; x <= h0 + 14 && pedido === null; x++) {
        if ((!dias && dow(x) === 1) || (dias && dias.includes(dow(x + prazo)))) pedido = x;
      }
      if (pedido === null) return;
      const chegada = pedido + prazo;
      let k = 7;
      if (dias) for (let j = 1; j <= 7; j++) if (dias.includes(dow(chegada + j))) { k = j; break; }

      const itens = d.produtos.filter(p => p.fornecedorId === f.id).map(p => {
        const a = analise(p);
        const kg = Regras.porPeso(p);
        const caixa = Math.max(p.porCaixa || 1, 1);
        const ate = Math.min(chegada + k, chegada + (p.diasValidade || 3650));
        let qtd = 0, var2 = 0;
        const eventos = new Set();
        for (let x = h0; x < ate; x++) {
          const dia = a.diaDe(x);
          qtd += dia.previsto;
          var2 += dia.desvio ** 2;
          if (dia.evento) eventos.add(dia.evento);
        }
        const desvio = Math.sqrt(var2);
        const estoque = p.lotes.filter(l => l.restante > 0 && (!l.validade || num(l.validade) > h0)).reduce((s, l) => s + l.restante, 0);
        const pendente = d.pedidos.filter(o => o.status === "pendente")
          .reduce((s, o) => s + o.itens.filter(i => i.produtoId === p.id).reduce((t, i) => t + i.qtd, 0), 0);
        const falta = qtd + MARGEM * desvio - estoque - pendente;
        return {
          falta,
          item: {
            produto_id: p.id, nome: p.nome, categoria: p.categoria, unidade: kg ? "kg" : "un", caixa,
            estoque: r3(estoque), pendente: r3(pendente), previsto: r1(qtd), margem: r1(MARGEM * desvio), ate: iso(ate),
            eventos: eventos.size ? [...eventos].sort().join(", ") : null,
            sugerido: kg ? Math.ceil(falta) : Math.ceil(falta / caixa) * caixa,
            // O site não tem preço de custo: usa o custo do produto se existir, senão 70% do preço de venda (exemplo)
            custo: p.custo ?? Math.round(p.preco * 0.7 * 100) / 100,
          },
        };
      }).filter(x => x.falta > 0.05).map(x => x.item).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

      res.push({
        fornecedor_id: f.id, fornecedor: f.nome, envio_preferido: f.envio || null,
        pedido_minimo: f.pedidoMinimo ?? PEDIDO_MINIMO_EXEMPLO[f.id] ?? null,
        data_pedido: iso(pedido), pedir_hoje: pedido === h0, chegada: iso(chegada), proxima_entrega: iso(chegada + k),
        tem_pendente: d.pedidos.some(o => o.fornecedorId === f.id && o.status === "pendente"),
        total: Math.round(itens.reduce((s, i) => s + i.sugerido * (i.custo || 0), 0) * 100) / 100,
        itens,
      });
    });
    return res;
  }

  // ------------------------------------------------------------ previsao_produto(id)
  function produto(id) {
    const d = Dados.ler();
    const p = d.produtos.find(x => x.id === id);
    if (!p) return null;
    const a = analise(p);
    const m = a.modelo;
    const situacao = situacaoModelo(m);
    const base = {
      produto_id: p.id, nome: p.nome, categoria: p.categoria, unidade: Regras.porPeso(p) ? "kg" : "un", situacao,
    };
    if (situacao === "sem_vendas") return { ...base, media_dia: null, crescimento_ano: null, parte_datas: null, idx_semana: null, idx_mes: null, erro_teste: null, erro_ingenuo: null, passado: [], futuro: [], datas: [] };

    const w0 = inicioSemana(hoje());
    const passado = [];
    for (let s = w0 - 84; s < w0; s += 7) {
      let vendido = 0, previsto = 0, tendencia = 0, datas = 0;
      for (let x = s; x < s + 7; x++) {
        const v = a.h.valor(x);
        vendido += v;
        previsto += prever(m, x).previsto;
        tendencia += m.tendencia(x);
        if (evento(x)) datas += v;
      }
      passado.push({ semana: iso(s), vendido: r3(vendido), previsto: r1(previsto), tendencia: r1(tendencia), datas: r3(datas) });
    }
    const futuro = [];
    for (let s = w0; futuro.length < 8; s += 7) {
      let previsto = 0, var2 = 0;
      const eventos = new Set();
      for (let x = Math.max(s, hoje()); x < s + 7; x++) {
        const dia = a.diaDe(x);
        previsto += dia.previsto;
        var2 += dia.desvio ** 2;
        if (dia.evento) eventos.add(dia.evento);
      }
      const desvio = Math.sqrt(var2);
      futuro.push({
        semana: iso(s), previsto: r1(previsto), minimo: r1(Math.max(previsto - FAIXA_SEMANA * desvio, 0)),
        maximo: r1(previsto + FAIXA_SEMANA * desvio), eventos: eventos.size ? [...eventos].sort().join(", ") : null,
      });
    }
    const datas = Object.entries(m.lifts).map(([evento, lift]) => ({ evento, a_mais: r1(lift * m.nivel) }))
      .filter(x => x.a_mais >= 0.5).sort((x, y) => y.a_mais - x.a_mais);
    const e = erros(a.ultimo);
    return {
      ...base,
      media_dia: r4(m.mediaDia), crescimento_ano: r4(m.crescimento), parte_datas: r4(m.parteDatas),
      idx_semana: m.sem.map(r4), idx_mes: m.mes.map(r4),
      erro_teste: e.erro, erro_ingenuo: e.erro_ingenuo,
      calculado_em: calculadoEm(),
      passado, futuro, datas,
    };
  }

  // ------------------------------------------------------------ previsao_alertas()
  const ptNum = (x, casas = 1) => x.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const ddmm = n => iso(n).slice(8, 10) + "/" + iso(n).slice(5, 7);

  function alertas() {
    const d = Dados.ler();
    const h0 = hoje();
    const res = [];

    // Clientes que ficaram sem o produto
    faltas(d).sort((a, b) => b.clientes - a.clientes).slice(0, 10).forEach(f => res.push({
      tipo: "falta", produto_id: f.p.id, produto: f.p.nome,
      texto: `${f.clientes} clientes ficaram sem nos últimos 7 dias (${ptNum(f.quantidade)} ${Regras.porPeso(f.p) ? "kg" : "un."}).`,
    }));

    // Parado, queda e alta: últimos 14 dias (sem as datas especiais) contra o que o modelo espera
    const meio = [];
    d.produtos.forEach(p => {
      const a = analise(p);
      const m = a.modelo;
      if (situacaoModelo(m) !== "ok") return;
      const dias = [];
      for (let n = 1; n <= 14; n++) {
        const x = h0 - n;
        if (evento(x)) continue;
        dias.push({ n, y: a.h.valor(x), esperado: m.ajuste(x) });
      }
      const primeiraVenda = dias.find(x => x.y > 0)?.n ?? 99;
      const zerados = dias.filter(x => x.n < primeiraVenda);
      const esperadoParado = zerados.reduce((s, x) => s + x.esperado, 0);
      if (zerados.length >= 2 && esperadoParado >= 5) {
        meio.push({ ordem: 1, a: { tipo: "parado", produto_id: p.id, produto: p.nome,
          texto: `Sem venda há ${zerados.length} dias (o normal seria vender uns ${Math.round(esperadoParado)}). Está na prateleira? Está em falta?` } });
        return;
      }
      const y = dias.reduce((s, x) => s + x.y, 0);
      const esp = dias.reduce((s, x) => s + x.esperado, 0);
      if (esp > 0 && Math.abs(y - esp) > 3 * m.desvio * Math.sqrt(dias.length) && Math.abs(y / esp - 1) > 0.25) {
        const pct = Math.round((y / esp - 1) * 100);
        meio.push({ ordem: 2, a: { tipo: y < esp ? "queda" : "alta", produto_id: p.id, produto: p.nome,
          texto: `Últimos 14 dias: vendeu ${ptNum(y)}, o esperado era ${ptNum(esp)} (${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%).` } });
      }
    });
    meio.sort((x, y) => x.ordem - y.ordem || x.a.produto.localeCompare(y.a.produto, "pt-BR")).forEach(x => res.push(x.a));

    // Datas especiais chegando (próximos 21 dias)
    for (let x = h0 + 1; x <= h0 + 21; x++) {
      const ev = evento(x);
      if (!ev || ev.fator <= 1) continue;
      const vendem = d.produtos.map(p => {
        const m = analise(p).modelo;
        const lift = m.lifts[ev.nome];
        return lift === undefined ? null : { p, extra: lift * m.nivel };
      }).filter(v => v && v.extra >= 1).sort((a, b) => b.extra - a.extra).slice(0, 5);
      if (!vendem.length) continue;
      const prazo = Math.max(...vendem.map(v => (d.fornecedores.find(f => f.id === v.p.fornecedorId)?.prazo) ?? v.p.prazo ?? 3));
      const pedirAte = x - prazo - 1;
      res.push({
        tipo: "data", produto_id: null, produto: ev.nome, dia: iso(x), pedir_ate: iso(pedirAte),
        texto: `${ev.nome} em ${x - h0} dias (${ddmm(x)}). Vende a mais: ${vendem.map(v => `${v.p.nome} (+${Math.round(v.extra)})`).join(", ")}. Pedir até ${ddmm(pedirAte)}.`,
      });
    }
    return res;
  }

  function limpar() { cache.clear(); }

  return { tela, pedidoSugerido, produto, alertas, limpar };
})();
