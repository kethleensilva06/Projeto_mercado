/*
 * Calendário (semana 8, só o gerente): espelha a tela CalendarioView do programa para Windows.
 * Junta a Previsão de compras e o Fechamento do dia: o mês em grade com o vendido (até hoje) e a previsão (dias
 * seguintes), o caminhão nos dias de compra, o resumo/fechamento do dia clicado e, recolhidas, as análises e os
 * dados completos da previsão.
 */

// ------------------------------------------------------------ Fonte dos dados
// Tudo o que a tela lê passa por aqui. Cada função devolve o MESMO formato das funções do banco do programa para
// Windows; para usar o banco de verdade, troque o corpo destas funções por chamadas à API.
const Fonte = {
  // calendario_mes(p_mes) do script 023: { hoje, inicio, fim, previsao_ate, dias[], fornecedores[], datas[] }
  mes: mesISO => PrevisaoSimulada.calendarioMes(mesISO),
  // pedido_sugerido() do script 022: um item por fornecedor ativo (data_pedido, itens, total, chegada...)
  sugeridos: () => PrevisaoSimulada.pedidoSugerido(),
  // previsao_alertas() do script 019
  alertas: () => PrevisaoSimulada.alertas(),
  // Resumo de um dia que já passou (no Windows: FechamentoView no modo "dia")
  diaPassado: diaISO => PrevisaoSimulada.diaPassado(diaISO),
  // Vendas por semana e média por dia da semana (no Windows: FechamentoView no modo "analises")
  analises: () => PrevisaoSimulada.analises(),
  // Hoje: vendas e caixa de verdade do site
  hoje: () => Dados.ler(),
};

(() => {
  const sessao = App.iniciar({ ativo: "calendario", perfis: ["gerente"] });
  if (!sessao) return;

  const $ = id => document.getElementById(id);
  const esc = App.esc;
  const moeda = App.moeda;
  const moeda0 = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  // "R$ 38,4 mil" nos indicadores (o valor inteiro não cabe)
  const moedaCurta = v => Math.abs(v) < 10000 ? moeda(v) : `R$ ${(v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`;
  // Na grade do celular: "850" ou "1,2k"
  const valorMini = v => v < 1000 ? String(Math.round(v)) : `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  const plural = (n, um, varios) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
  const capitalizar = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const dataDia = iso => new Date(iso + "T12:00");
  const longa = iso => capitalizar(dataDia(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }));
  const ddmm = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "";
  const nomeMes = iso => capitalizar(dataDia(iso).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  const somarMeses = (iso, n) => {
    const d = dataDia(iso.slice(0, 7) + "-01");
    d.setMonth(d.getMonth() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };
  const CHAVE_FECHAMENTO = dia => "mercado.fechamento." + dia;

  let mes = Dados.hojeISO().slice(0, 7) + "-01";
  let selecionado = Dados.hojeISO();
  let dados = null;
  let sugeridos = [];

  // ------------------------------------------------------------ Carregar
  function carregar() {
    $("aviso-erro").hidden = true;
    $("nome-mes").textContent = nomeMes(mes);
    try {
      dados = Fonte.mes(mes);
      sugeridos = Fonte.sugeridos() || [];
    } catch (e) {
      console.warn(e);
      dados = null;
      $("aviso-erro-texto").textContent = "Não foi possível carregar o calendário.";
      $("aviso-erro").hidden = false;
      $("subtitulo").textContent = "Não foi possível carregar o calendário.";
      return;
    }
    // Mudou de mês: escolhe hoje (se for este mês) ou o dia 1
    if (selecionado < dados.inicio || selecionado > dados.fim)
      selecionado = dados.hoje >= dados.inicio && dados.hoje <= dados.fim ? dados.hoje : dados.inicio;
    redesenhar();
  }

  function redesenhar() {
    if (!dados) return;
    const hoje = dados.hoje;
    $("btn-hoje").hidden = mes === hoje.slice(0, 7) + "-01" && selecionado === hoje;
    mostrarKpis();
    mostrarGrade();
    mostrarDia();
  }

  // ------------------------------------------------------------ Dias de compra
  // Dia de pedir de cada fornecedor com itens no pedido sugerido (sem pedido pendente) e o último dia para pedir
  // para uma data festiva. Chave = dia; valor = linhas do que comprar.
  function diasDeCompra() {
    const res = {};
    const por = (dia, titulo, detalhe, sugerido) => (res[dia] = res[dia] || []).push({ titulo, detalhe, sugerido });
    sugeridos.forEach(s => {
      if (!s.itens.length || s.tem_pendente) return;
      por(s.data_pedido, s.fornecedor,
        `${plural(s.itens.length, "produto", "produtos")}${s.total > 0 ? `, ≈ ${moeda0(s.total)}` : ""}: ` +
        s.itens.slice(0, 4).map(i => i.nome).join(", ") + (s.itens.length > 4 ? "…" : ""), s);
    });
    (dados.datas || []).forEach(f => {
      if (f.fator >= 1.2 && f.pedir_ate >= dados.hoje)   // só as datas que mexem de verdade no movimento
        por(f.pedir_ate, `Último dia para pedir para ${f.nome} (${ddmm(f.dia)})`,
          f.produtos ? `Vende a mais: ${f.produtos}` : "Movimento maior que o normal", null);
    });
    return res;
  }

  // ------------------------------------------------------------ Indicadores
  function kpi(cor, valor, rotulo, dica) {
    return `<article class="kpi" title="${esc(dica)}">
      <div class="kpi-top"><span class="kpi-label">${esc(rotulo)}</span><span class="cal-kpi-ponto ${cor}" aria-hidden="true"></span></div>
      <strong class="kpi-value">${esc(valor)}</strong>
      <span class="kpi-sub">${esc(dica)}</span>
    </article>`;
  }

  function mostrarKpis() {
    const d = dados, hoje = d.hoje;
    const vendido = d.dias.reduce((s, x) => s + (x.vendido || 0), 0);
    const previsto = d.dias.filter(x => x.dia > hoje || (x.dia === hoje && !x.vendido)).reduce((s, x) => s + (x.previsto || 0), 0);
    const semPrevisao = d.dias.filter(x => x.dia > hoje && x.previsto == null && !x.fechado_evento).length;
    const anoPassado = d.dias.filter(x => x.dia <= hoje).reduce((s, x) => s + (x.ano_passado || 0), 0);
    const passou = d.fim < hoje, futuro = d.inicio > hoje;
    const vendas = d.dias.reduce((s, x) => s + (x.vendas || 0), 0);

    const k = [];
    k.push(kpi("icon-green", futuro ? "—" : moedaCurta(vendido), passou ? "Vendido no mês" : "Vendido até hoje",
      futuro ? "Mês que ainda não começou" : `${plural(vendas, "venda", "vendas")} pagas`));
    if (!passou) {
      k.push(kpi("icon-blue", previsto > 0 ? moedaCurta(previsto) : "—", "Previsto até o fim do mês",
        previsto <= 0 ? "Sem previsão para estes dias ainda"
          : semPrevisao > 0 ? `A previsão cobre até ${ddmm(d.previsao_ate)}; ${plural(semPrevisao, "dia fica", "dias ficam")} sem conta`
            : "Pela previsão de cada produto × preço de hoje"));
      k.push(kpi("icon-green", moedaCurta(vendido + previsto), "Mês inteiro (estimado)", `${moeda(vendido)} vendido + ${moeda(previsto)} previsto`));
    }
    if (anoPassado > 0 && !futuro) {
      const v = (vendido - anoPassado) / anoPassado;
      k.push(kpi(v >= 0 ? "icon-green" : "icon-amber", `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`, "Contra o ano passado",
        `Mesmos dias da semana, 52 semanas antes: ${moeda(anoPassado)}`));
    }
    const compras = Object.keys(diasDeCompra()).filter(x => x >= hoje && x <= d.fim).length;
    k.push(kpi(compras > 0 ? "icon-amber" : "icon-green", String(compras), "Dias de compra",
      compras > 0 ? "Daqui até o fim do mês, com produtos para pedir" : "Nenhum até o fim do mês"));
    $("kpis").innerHTML = k.join("");

    const fechados = d.dias.filter(x => x.fechado).length;
    const abertos = d.dias.filter(x => x.dia < hoje && !x.fechado && (x.vendas || 0) > 0).length;
    $("subtitulo").textContent = futuro ? "Previsão de vendas e dias de compra do mês."
      : plural(fechados, "dia fechado", "dias fechados") +
        (abertos > 0 ? ` · ${plural(abertos, "dia com venda ainda sem fechar", "dias com venda ainda sem fechar")}` : "") +
        " · clique num dia para ver o resumo, o fechamento ou a previsão.";
  }

  // ------------------------------------------------------------ Grade do mês
  function mostrarGrade() {
    const d = dados, hoje = d.hoje;
    const compras = diasDeCompra();
    const rotina = {};
    d.fornecedores.forEach(f => (f.dias || []).forEach(x => (rotina[x] = rotina[x] || []).push(f.fornecedor)));
    const maior = Math.max(0, ...d.dias.map(x => Math.max(x.vendido || 0, x.previsto || 0)));
    const primeiro = dataDia(d.inicio).getDay();

    let html = "";
    for (let i = 0; i < primeiro; i++) html += '<span class="cal-vazio" aria-hidden="true"></span>';
    d.dias.forEach(dia => {
      const ehHoje = dia.dia === hoje, passado = dia.dia < hoje, escolhido = dia.dia === selecionado;
      const c = compras[dia.dia];
      const r = rotina[dia.dia];

      // Valor: vendido (até hoje) ou previsto (≈)
      let texto = "", mini = "", prev = false, num = 0;
      if (dia.vendido != null && (passado || (ehHoje && dia.vendido > 0))) { texto = moeda(dia.vendido); mini = valorMini(dia.vendido); num = dia.vendido; }
      else if (dia.previsto != null && !passado) { texto = "≈ " + moeda(dia.previsto); mini = "≈" + valorMini(dia.previsto); prev = true; num = dia.previsto; }
      else if (passado && !dia.fechado_evento) { texto = moeda(0); mini = "0"; }

      let sinais = "";
      if (dia.fechado) sinais += '<span class="cal-check" title="Dia fechado">✓</span>';
      if (c && c.length) sinais += `<span class="cal-caminhao compra" title="${esc(c.map(x => `${x.titulo}: ${x.detalhe}`).join("\n"))}"></span>`;
      else if (r && dia.dia >= hoje) sinais += `<span class="cal-caminhao" title="${esc("Dia de pedido de " + r.join(", "))}"></span>`;

      const evento = dia.evento ? (dia.fechado_evento ? `${dia.evento} (fechado)` : dia.evento) : "";
      // Nome acessível: data, valor, data especial e sinais
      const partes = [longa(dia.dia) + (ehHoje ? " (hoje)" : "")];
      if (dia.vendido != null && (passado || ehHoje)) partes.push(`vendido ${moeda(dia.vendido)} (${plural(dia.vendas || 0, "venda", "vendas")})`);
      if (dia.previsto != null && !passado) partes.push(`previsto ≈ ${moeda0(dia.previsto)}, entre ${moeda0(dia.previsto_min)} e ${moeda0(dia.previsto_max)}`);
      if (evento) partes.push(evento);
      if (dia.fechado) partes.push("dia fechado");
      if (c && c.length) partes.push("dia de compra");
      else if (r && dia.dia >= hoje) partes.push("dia de pedido de rotina");

      const barra = maior > 0 && num > 0 ? `<span class="cal-barra${prev ? " prev" : ""}" style="width:${Math.max(4, Math.round(num / maior * 100))}%"></span>` : "";
      html += `<button type="button" class="cal-dia-btn${passado ? " passado" : ""}${ehHoje ? " hoje" : ""}${escolhido ? " escolhido" : ""}${prev ? " futuro" : ""}${evento ? " com-evento" : ""}"
          data-dia="${dia.dia}" aria-pressed="${escolhido}" ${ehHoje ? 'aria-current="date"' : ""} tabindex="${escolhido ? 0 : -1}"
          aria-label="${esc(partes.join(", "))}" title="${esc(partes.join("\n"))}">
        <span class="cal-topo"><span class="cal-num">${Number(dia.dia.slice(8))}</span><span class="cal-sinais">${sinais}</span></span>
        ${evento ? `<span class="cal-evento">${esc(evento)}</span>` : ""}
        <span class="cal-baixo">
          ${texto ? `<span class="cal-valor${prev ? " cal-prev" : ""}"><span class="cal-cheio">${esc(texto)}</span><span class="cal-mini">${esc(mini)}</span></span>` : ""}
          ${barra}
        </span>
      </button>`;
    });
    $("grade").innerHTML = html;
  }

  function escolher(dia, focar) {
    selecionado = dia;
    $("btn-hoje").hidden = false;
    mostrarGrade();
    mostrarDia();
    if (focar) $("grade").querySelector(`[data-dia="${dia}"]`)?.focus();
  }

  $("grade").addEventListener("click", e => {
    const b = e.target.closest(".cal-dia-btn");
    if (b) escolher(b.dataset.dia, true);
  });

  // Teclado: setas andam pelos dias (←→ um dia, ↑↓ uma semana), Home/End vão ao começo e ao fim do mês
  $("grade").addEventListener("keydown", e => {
    const b = e.target.closest(".cal-dia-btn");
    if (!b || !dados) return;
    const passo = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const lista = dados.dias.map(x => x.dia);
    let i = lista.indexOf(b.dataset.dia);
    if (passo) i = Math.min(Math.max(i + passo, 0), lista.length - 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = lista.length - 1;
    else return;
    e.preventDefault();
    escolher(lista[i], true);
  });

  // ------------------------------------------------------------ Dia escolhido
  function cartao(titulo, corpo) {
    return `<section class="card cal-detalhe"><h3 class="card-title">${esc(titulo)}</h3>${corpo}</section>`;
  }

  function cartaoCompras(compras) {
    return cartao("Dia de compra", `<ul class="cal-compras">${compras.map((c, i) => `
      <li>
        <span class="cal-caminhao compra" aria-hidden="true"></span>
        <div>
          <strong>${esc(c.titulo)}</strong>
          <p>${esc(c.detalhe + (c.sugerido ? ` · chega ${ddmm(c.sugerido.chegada)} e precisa durar até ${ddmm(c.sugerido.proxima_entrega)}` : ""))}</p>
        </div>
        ${c.sugerido ? `<button type="button" class="btn btn-primary cal-montar" data-fornecedor="${c.sugerido.fornecedor_id}">Montar pedido</button>` : ""}
      </li>`).join("")}</ul>`);
  }

  function rotinaDoDia(dia) {
    const nomes = dados.fornecedores.filter(f => (f.dias || []).includes(dia)).map(f => f.fornecedor);
    return nomes.length === 0
      ? "Nenhum fornecedor tem pedido marcado para este dia."
      : `Dia de pedido de rotina de ${nomes.join(", ")}. A lista do que pedir sai no próprio dia (a previsão usa o estoque daquele dia).`;
  }

  const lista = (itens, vazio) => `<ul class="fc-lista">${itens.length
    ? itens.map(i => `<li><span>${i.texto}</span><strong>${i.valor}</strong></li>`).join("")
    : `<li class="empty">${esc(vazio)}</li>`}</ul>`;

  const kpiDia = (rotulo, valor, sub) => `<article class="kpi"><div class="kpi-top"><span class="kpi-label">${esc(rotulo)}</span></div>
    <strong class="kpi-value">${esc(valor)}</strong><span class="kpi-sub">${esc(sub)}</span></article>`;

  // Hoje: as vendas de verdade do site e o "Fechar o dia" (o mesmo registro da tela Fechamento do dia)
  function detalheHoje() {
    const d = Fonte.hoje();
    const validas = d.vendas.filter(v => !v.cancelada);
    const canceladas = d.vendas.filter(v => v.cancelada);
    const total = validas.reduce((s, v) => s + v.total, 0);
    let fechamento = null;
    try { fechamento = JSON.parse(localStorage.getItem(CHAVE_FECHAMENTO(d.dia))); } catch (_) {}

    const porForma = {};
    validas.forEach(v => { porForma[v.forma] = (porForma[v.forma] || 0) + v.total; });
    const produtos = {};
    validas.forEach(v => v.itens.forEach(i => {
      const p = produtos[i.produtoId] || (produtos[i.produtoId] = { nome: i.nome, valor: 0 });
      p.valor += i.qtd * i.preco;
    }));

    const textoFechar = fechamento ? `Dia fechado às ${esc(fechamento.fechadoAs)}, com ${moeda(fechamento.total)} vendidos.`
      : d.caixa.aberto ? `O caixa está aberto por ${esc(d.caixa.abertoPor || "alguém")}. Feche o caixa antes de fechar o dia.`
        : "Confira os números e feche o dia. Depois de fechado, o resumo fica registrado.";

    return `<section class="kpis cal-kpis-dia" aria-label="Indicadores do dia">
        ${kpiDia("Vendido hoje", moeda(total), "Vendas pagas, sem as canceladas")}
        ${kpiDia("Vendas", String(validas.length), validas.length === 1 ? "venda paga" : "vendas pagas")}
        ${kpiDia("Ticket médio", moeda(validas.length ? total / validas.length : 0), "Valor médio por venda")}
        ${kpiDia("Cancelamentos", String(canceladas.length), "Vendas canceladas hoje")}
      </section>
      <div class="grid-2">
        ${cartao("Formas de pagamento", lista(Object.entries(porForma).sort((a, b) => b[1] - a[1]).map(([f, v]) => ({
          texto: esc(Regras.FORMAS[f] || f), valor: `${moeda(v)}${total ? ` · ${Math.round(v / total * 100)}%` : ""}`,
        })), "Nenhuma venda paga ainda."))}
        ${cartao("Mais vendidos", lista(Object.values(produtos).sort((a, b) => b.valor - a.valor).slice(0, 5).map(p => ({
          texto: esc(p.nome), valor: moeda(p.valor),
        })), "Ainda não há produtos vendidos."))}
      </div>
      <section class="card cal-detalhe fc-fechar">
        <h3 class="card-title">Fechar o dia</h3>
        <p>${textoFechar}</p>
        <div class="cal-acoes">
          <button type="button" class="btn btn-primary" id="btn-fechar" ${fechamento || d.caixa.aberto ? "disabled" : ""}>Fechar o dia</button>
          <a class="link-simples" href="fechamento.html">Abrir o Fechamento do dia</a>
        </div>
      </section>`;
  }

  // Dia que já passou: resumo do histórico (simulado no site)
  function detalhePassado(dia, info) {
    const r = Fonte.diaPassado(dia);
    const comparacao = r.semana_passada > 0 ? (r.total - r.semana_passada) / r.semana_passada : null;
    return `<section class="kpis cal-kpis-dia" aria-label="Indicadores do dia">
        ${kpiDia("Vendido", moeda(r.total), comparacao === null ? "Vendas pagas"
          : `${comparacao >= 0 ? "+" : "−"}${Math.round(Math.abs(comparacao) * 100)}% contra ${moeda(r.semana_passada)} na semana passada`)}
        ${kpiDia("Vendas", String(r.vendas), r.vendas === 1 ? "venda paga" : "vendas pagas")}
        ${kpiDia("Ticket médio", moeda(r.vendas ? r.total / r.vendas : 0), "Valor médio por venda")}
        ${kpiDia("Situação", info.fechado ? "Fechado" : "Sem fechar", info.fechado ? "O resumo do dia ficou registrado" : "Ninguém fechou este dia")}
      </section>
      ${cartao("Mais vendidos", lista(r.produtos.slice(0, 5).map(p => ({
        texto: `${esc(p.nome)} · ${p.qtd.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${p.unidade}`, valor: moeda(p.valor),
      })), "Nenhuma venda neste dia."))}
      <p class="cal-nota">No site, os dias anteriores são simulados e só o dia de hoje pode ser fechado. No programa para Windows,
        fechar ou reabrir um dia que já passou pede usuário e senha de um gerente.</p>`;
  }

  function detalheFuturo(info, compras) {
    let previsao;
    if (info.previsto != null) {
      previsao = `<p class="cal-previsto">≈ ${moeda(info.previsto)}</p>
        <p class="cal-suave">Em 8 de cada 10 dias assim a venda fica entre ${moeda0(info.previsto_min)} e ${moeda0(info.previsto_max)}.</p>` +
        (info.ano_passado != null ? `<p class="cal-suave">Mesmo dia da semana no ano passado: ${moeda(info.ano_passado)}.</p>` : "");
    } else {
      previsao = `<p class="cal-suave">${esc(info.fechado_evento ? "Loja fechada neste dia (calendário de datas)."
        : dados.previsao_ate ? `A previsão só vai até ${ddmm(dados.previsao_ate)}. Ela é recalculada toda madrugada e anda junto com os dias.`
          : "Ainda não há previsão calculada.")}</p>`;
    }
    return cartao("Previsão de vendas", previsao) +
      (compras.length ? cartaoCompras(compras) : cartao("Compras", `<p class="cal-suave">${esc(rotinaDoDia(selecionado))}</p>`));
  }

  function mostrarDia() {
    const d = dados, hoje = d.hoje;
    const info = d.dias.find(x => x.dia === selecionado);
    if (!info) return;
    $("titulo-dia").textContent = longa(selecionado) + (selecionado === hoje ? " (hoje)" : "");
    const compras = diasDeCompra()[selecionado] || [];
    const evento = info.evento ? `${info.evento} · ` : "";

    if (selecionado <= hoje) {
      $("sub-dia").textContent = evento + "Resumo de todos os caixas e o fechamento do dia." +
        (selecionado === hoje && compras.length ? " Hoje também é dia de compra (veja abaixo)." : "");
      $("detalhe-dia").innerHTML = selecionado === hoje
        ? detalheHoje() + (compras.length ? cartaoCompras(compras) : "")
        : detalhePassado(selecionado, info);
      return;
    }
    $("sub-dia").textContent = evento + "Previsão de vendas e o que pedir neste dia.";
    $("detalhe-dia").innerHTML = detalheFuturo(info, compras);
  }

  // Ações dentro do dia escolhido
  $("detalhe-dia").addEventListener("click", e => {
    if (e.target.closest("#btn-fechar")) {
      const d = Dados.ler();
      if (d.caixa.aberto || localStorage.getItem(CHAVE_FECHAMENTO(d.dia))) return;
      const validas = d.vendas.filter(v => !v.cancelada);
      const total = validas.reduce((s, v) => s + v.total, 0);
      try {
        localStorage.setItem(CHAVE_FECHAMENTO(d.dia), JSON.stringify({
          fechadoAs: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), total, vendas: validas.length,
        }));
      } catch (_) {}
      App.toast("Dia fechado.");
      carregar();
      return;
    }
    const montar = e.target.closest(".cal-montar");
    if (montar) montarPedido(Number(montar.dataset.fornecedor));
  });

  // "Montar pedido": abre o pedido já preenchido na tela Fornecedores (mesmo atalho da Previsão de compras)
  function montarPedido(fornecedorId) {
    const s = sugeridos.find(x => x.fornecedor_id === fornecedorId);
    if (!s) { App.toast("Fornecedor não encontrado. Atualize a tela."); return; }
    try {
      sessionStorage.setItem("mercado.pedidoSugerido", JSON.stringify({
        fornecedorId, itens: s.itens.map(i => ({ produtoId: i.produto_id, qtd: i.sugerido })),
      }));
    } catch (_) {
      App.toast("Não foi possível abrir o pedido neste navegador.");
      return;
    }
    location.href = "fornecedores.html#pedido-sugerido";
  }

  // ------------------------------------------------------------ Áreas recolhidas (criadas só na primeira vez que abrem)
  function montarAnalises() {
    const a = Fonte.analises();
    const maior = Math.max(1, ...a.semanas.map(s => s.total));
    const nomes = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const maiorDia = Math.max(1, ...a.dia_semana);
    const linhas = (itens, max) => `<ul class="cal-barras">${itens.map(i => `
      <li><span class="cal-barras-rotulo">${esc(i.rotulo)}</span>
        <span class="cal-barras-trilho" aria-hidden="true"><span style="width:${Math.round(i.valor / max * 100)}%"></span></span>
        <strong>${moeda(i.valor)}</strong></li>`).join("")}</ul>`;
    $("analises").innerHTML = `<div class="grid-2">
        ${cartao("Vendas por semana (12 semanas)", linhas(a.semanas.map(s => ({ rotulo: `Semana de ${ddmm(s.semana)}`, valor: s.total })), maior))}
        ${cartao("Média por dia da semana (últimos 84 dias)", linhas(a.dia_semana.map((v, i) => ({ rotulo: nomes[i], valor: v })), maiorDia))}
      </div>
      <p class="cal-nota">As análises completas (por dia, semana e mês, categorias, formas de pagamento, perdas e cancelamentos)
        estão no programa para Windows. <a class="link-simples" href="fechamento.html">Abrir o Fechamento do dia</a></p>`;
  }

  function montarPrevisao() {
    const alertas = Fonte.alertas() || [];
    const cartoes = sugeridos.map(s => {
      const corpo = s.itens.length
        ? `<div class="cal-tabela-caixa"><table class="cal-tabela">
            <thead><tr><th>Produto</th><th class="num">Estoque</th><th class="num">Vende até lá</th><th class="num">Pedir</th></tr></thead>
            <tbody>${s.itens.map(i => `<tr><td>${esc(i.nome)}${i.eventos ? `<small class="cal-ev">${esc(i.eventos)}</small>` : ""}</td>
              <td class="num">${i.estoque.toLocaleString("pt-BR")} ${i.unidade}</td>
              <td class="num">${i.previsto.toLocaleString("pt-BR")} ${i.unidade}</td>
              <td class="num"><strong>${i.sugerido.toLocaleString("pt-BR")} ${i.unidade}</strong></td></tr>`).join("")}</tbody>
          </table></div>`
        : `<p class="cal-suave">Nada para pedir agora: o estoque e o que já foi pedido dão até a próxima entrega.</p>`;
      const quando = s.pedir_hoje ? "Pedir hoje" : `Pedir em ${ddmm(s.data_pedido)}`;
      return cartao(s.fornecedor, `<p class="cal-suave">${esc(quando)} · chega ${ddmm(s.chegada)} e precisa durar até ${ddmm(s.proxima_entrega)}` +
        `${s.tem_pendente ? " · já tem pedido pendente" : ""}${s.total > 0 ? ` · ≈ ${moeda0(s.total)}` : ""}</p>${corpo}` +
        (s.itens.length ? `<div class="cal-acoes"><button type="button" class="btn btn-primary cal-montar" data-fornecedor="${s.fornecedor_id}">Montar pedido</button></div>` : ""));
    }).join("");
    $("previsao-completa").innerHTML = `<h3 class="cal-sub-titulo">Pedido sugerido</h3>${cartoes || '<p class="cal-suave">Nenhum fornecedor ativo.</p>'}
      ${cartao("Alertas", lista(alertas.map(a => ({ texto: `<strong>${esc(a.produto)}</strong> · ${esc(a.texto)}`, valor: "" })), "Nenhum alerta agora."))}
      <p class="cal-nota">Previsão por produto e teste da previsão: <a class="link-simples" href="previsao.html">Abrir a Previsão de compras</a></p>`;
  }

  $("previsao-completa").addEventListener("click", e => {
    const montar = e.target.closest(".cal-montar");
    if (montar) montarPedido(Number(montar.dataset.fornecedor));
  });

  function recolhida(id, montar) {
    let feito = false;
    $(id).addEventListener("toggle", () => {
      if (!$(id).open || feito) return;
      try { montar(); feito = true; }
      catch (e) { console.warn(e); App.toast("Não foi possível carregar esta parte. Tente de novo."); }
    });
  }
  recolhida("exp-analises", montarAnalises);
  recolhida("exp-previsao", montarPrevisao);

  // ------------------------------------------------------------ Navegação
  $("btn-anterior").addEventListener("click", () => { mes = somarMeses(mes, -1); carregar(); });
  $("btn-proximo").addEventListener("click", () => { mes = somarMeses(mes, 1); carregar(); });
  $("btn-hoje").addEventListener("click", () => {
    selecionado = Dados.hojeISO();
    mes = selecionado.slice(0, 7) + "-01";
    carregar();
  });
  $("btn-tentar").addEventListener("click", carregar);

  // Atalho "Ver conta" (como no Windows): calendario.html#previsao abre os dados completos da previsão
  if (location.hash === "#previsao") {
    history.replaceState(null, "", location.pathname);
    $("exp-previsao").open = true;
    setTimeout(() => $("exp-previsao").scrollIntoView(), 0);
  }

  carregar();
  Dados.aoMudar(() => { PrevisaoSimulada.limpar(); carregar(); });
})();
