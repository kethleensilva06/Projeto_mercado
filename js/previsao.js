/*
 * Previsão de compras (semana 7, só o gerente). Igual à tela do programa para Windows (Views/PrevisaoView):
 * indicadores no topo e 4 abas: "Pedido sugerido" (cada fornecedor: quando pedir, quando chega, o que pedir),
 * "Produto" (12 semanas vendidas x esperadas, 8 semanas à frente com a faixa, dia da semana, mês e datas especiais),
 * "Teste da previsão" (erro ano a ano contra repetir o ano passado) e "Alertas".
 * Nada é calculado aqui: tudo vem pronto de PrevisaoSimulada (no programa: previsao_tela, pedido_sugerido,
 * previsao_produto e previsao_alertas do banco), no mesmo formato.
 */
(() => {
  const sessao = App.iniciar({ ativo: "previsao", perfis: ["gerente"] });
  if (!sessao) return;

  const $ = id => document.getElementById(id);
  const esc = App.esc;
  const moeda = App.moeda;

  // ------------------------------------------------------------ Fonte dos dados (trocar por chamadas à API)
  const Fonte = {
    tela: () => PrevisaoSimulada.tela(),
    sugeridos: () => PrevisaoSimulada.pedidoSugerido(),
    alertas: () => PrevisaoSimulada.alertas(),
    produto: id => PrevisaoSimulada.produto(id),
  };

  let tela = null;
  let sugeridos = [];
  let alertas = [];
  let produto = null;     // previsao_produto do produto aberto na aba "Produto"
  let aba = "pedido";

  // ------------------------------------------------------------ Formatos (iguais aos do programa)
  const pct = v => (v ?? 0).toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 0 });
  const qtd = (v, kg) => kg
    ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: v >= 100 ? 0 : 1 })} kg`
    : `${Math.round(v)} un.`;
  const indice = i => (i >= 1 ? "+" : "−") + pct(Math.abs(i - 1));
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const dataLocal = iso => new Date(iso + "T12:00");
  const ddmm = iso => dataLocal(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  function nomeDia(iso) {
    const hoje = Dados.hojeISO();
    if (iso === hoje) return "hoje";
    if (iso === Dados.somarDias(hoje, 1)) return "amanhã";
    const d = dataLocal(iso);
    return `${d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")} ${ddmm(iso)}`;
  }
  const porPeso = x => x.unidade === "kg";

  // ------------------------------------------------------------ Ícones
  const ICONES = {
    tendencia: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    alerta: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
    caminhao: '<path d="M1 6h13v10H1zM14 10h4l3 3v3h-7z"/><circle cx="5" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  };
  const icone = (nome, cor) => `<span class="kpi-icon icon-${cor}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome]}</svg></span>`;

  // ------------------------------------------------------------ Peças da tela
  const suave = (texto, classe = "") => `<p class="pv-suave ${classe}">${esc(texto)}</p>`;
  const cartao = (titulo, html, classe = "") =>
    `<section class="card pv-cartao ${classe}"><h2 class="card-title">${esc(titulo)}</h2>${html}</section>`;
  const duasColunas = (a, b) => `<div class="pv-duas">${a}${b}</div>`;
  const etiqueta = (texto, cor) => `<span class="pv-etiqueta pv-${cor}">${esc(texto)}</span>`;

  // Barra horizontal (Graficos.Barra do programa): rótulo, barra proporcional e o valor escrito
  function barra(rotulo, valor, maximo, texto, cor) {
    const largura = maximo > 0 ? Math.max(0, Math.min(100, valor / maximo * 100)) : 0;
    return `<div class="pv-barra">
      <span class="pv-barra-rotulo">${esc(rotulo)}</span>
      <span class="pv-barra-trilho" aria-hidden="true"><span class="pv-barra-cheia pv-fundo-${cor}" style="width:${largura.toFixed(1)}%"></span></span>
      <span class="pv-barra-valor">${esc(texto)}</span>
    </div>`;
  }

  function kpi(nomeIcone, cor, valor, rotulo, dica) {
    return `<article class="kpi" title="${esc(dica)}">
      <div class="kpi-top"><span class="kpi-label">${esc(rotulo)}</span>${icone(nomeIcone, cor)}</div>
      <strong class="kpi-value">${esc(valor)}</strong>
      <span class="kpi-sub">${esc(dica)}</span>
    </article>`;
  }

  // ------------------------------------------------------------ Dados
  function carregar() {
    $("aviso-erro").hidden = true;
    $("btn-atualizar").disabled = true;
    try {
      tela = Fonte.tela();
      sugeridos = Fonte.sugeridos();
      alertas = Fonte.alertas();
      if (produto) produto = Fonte.produto(produto.produto_id);
    } catch (e) {
      console.error(e);
      $("aviso-erro-texto").textContent = "Não foi possível calcular a previsão. Tente de novo.";
      $("aviso-erro").hidden = false;
      $("subtitulo").textContent = "Não foi possível carregar a previsão.";
      return;
    } finally {
      $("btn-atualizar").disabled = false;
    }
    mostrar();
  }

  function abrirProduto(id) {
    try {
      produto = Fonte.produto(id);
    } catch (e) {
      console.error(e);
      App.toast("Não foi possível abrir a previsão deste produto.");
      return;
    }
    if (!produto) { App.toast("Produto não encontrado. Atualize a tela."); return; }
    const deOutraAba = aba !== "produto";
    trocarAba("produto");
    if (deOutraAba) {
      $("abas").scrollIntoView({ block: "start" });
      $("conteudo").focus({ preventScroll: true });
    }
  }

  // ------------------------------------------------------------ Navegação
  function trocarAba(nova) {
    aba = nova;
    document.querySelectorAll("#abas [role=tab]").forEach(b => {
      const ativa = b.dataset.aba === nova;
      b.classList.toggle("active", ativa);
      b.setAttribute("aria-selected", String(ativa));
      b.tabIndex = ativa ? 0 : -1;
    });
    $("conteudo").setAttribute("aria-labelledby", "aba-" + nova);
    $("busca-produto").hidden = nova !== "produto";
    mostrar();
    if (nova === "produto" && !produto) $("busca").focus();
  }

  function mostrar() {
    if (!tela) return;
    mostrarTopo();
    const painel = $("painel");
    switch (aba) {
      case "produto": painel.innerHTML = htmlProduto(); mostrarResultadosBusca(); break;
      case "teste": painel.innerHTML = htmlTeste(); break;
      case "alertas": painel.innerHTML = htmlAlertas(); break;
      default: painel.innerHTML = htmlPedidos();
    }
  }

  // ------------------------------------------------------------ Topo
  const paraPedirHoje = () => sugeridos.filter(s => s.pedir_hoje && !s.tem_pendente && s.itens.length > 0);

  function mostrarTopo() {
    const g = tela.geral;
    if (!g) {
      $("subtitulo").textContent = "A previsão ainda não foi calculada.";
    } else {
      const calc = new Date(g.calculado_em);
      const quando = `${calc.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${calc.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
      const ini = dataLocal(g.treino_ini).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
      $("subtitulo").textContent = `Calculada em ${quando} com as vendas de ${ini} até ${App.dataBR(g.treino_fim)}. Recalcula sozinha toda madrugada.`;
    }
    const perdidas = tela.perdidas_7d;
    const hoje = paraPedirHoje();
    $("kpis").innerHTML = [
      kpi("tendencia", "green", g && g.teste_erro_semana != null ? pct(g.teste_erro_semana) : "—", "Erro da previsão",
        g && g.teste_erro_ingenuo != null ? `Por produto e semana, no último ano. Repetir o ano passado erraria ${pct(g.teste_erro_ingenuo)}.` : "Precisa de mais de 1 ano de vendas para testar"),
      kpi("alerta", perdidas && perdidas.clientes > 0 ? "red" : "green", perdidas ? perdidas.clientes.toLocaleString("pt-BR") : "—", "Vendas perdidas (7 dias)",
        perdidas ? `Clientes sem o produto nos últimos 7 dias (${plural(perdidas.produtos, "produto", "produtos")})` : "Ainda não há registro de falta"),
      kpi("caminhao", hoje.length ? "amber" : "green", String(hoje.length), "Pedir hoje",
        hoje.length ? hoje.map(s => s.fornecedor).join(", ") : "Nenhum fornecedor para pedir hoje"),
      kpi("alerta", alertas.length ? "amber" : "green", String(alertas.length), "Alertas",
        alertas.length ? "Faltas, produtos parados e datas chegando" : "Nada fora do normal"),
    ].join("");
    $("aba-alertas").textContent = alertas.length ? `Alertas (${alertas.length})` : "Alertas";
  }

  // ------------------------------------------------------------ Aba "Pedido sugerido"
  function htmlPedidos() {
    let html = suave("Para cada fornecedor: o próximo dia de pedido (para chegar num dia em que ele entrega), e quanto pedir para durar até a " +
      "entrega seguinte. Sugerido = o que deve vender até lá + uma margem de segurança − o estoque − o que já foi pedido, em caixas fechadas.", "pv-intro");
    if (!sugeridos.length) {
      return html + cartao("Nenhum fornecedor ativo", suave("Cadastre os fornecedores e ligue cada produto ao seu fornecedor (cadastro do produto)."));
    }
    const prioridade = s => (s.pedir_hoje && !s.tem_pendente ? 0 : 1);
    [...sugeridos].sort((a, b) => prioridade(a) - prioridade(b) || a.data_pedido.localeCompare(b.data_pedido) || a.fornecedor.localeCompare(b.fornecedor, "pt-BR"))
      .forEach(s => { html += cartaoFornecedor(s); });
    return html;
  }

  function cartaoFornecedor(s) {
    const situacao = s.tem_pendente ? etiqueta("Pedido a caminho", "azul")
      : s.pedir_hoje ? etiqueta("Pedir hoje", "ambar")
      : etiqueta(`Próximo pedido: ${nomeDia(s.data_pedido)}`, "verde");
    let html = `<div class="pv-situacao">${situacao}
      <span class="pv-suave">Pedido feito ${s.pedir_hoje ? "hoje" : esc(nomeDia(s.data_pedido))} chega ${esc(nomeDia(s.chegada))} e precisa durar até ${esc(nomeDia(s.proxima_entrega))}.</span></div>`;
    if (s.tem_pendente) html += suave("Já tem pedido pendente deste fornecedor: o que foi pedido já está descontado da sugestão.");
    if (!s.itens.length) return cartao(s.fornecedor, html + suave("Nada a pedir: o estoque e o que já foi pedido cobrem até a entrega seguinte."), "pv-forn");

    const linhas = s.itens.map(i => {
      const kg = porPeso(i);
      const caixas = !kg && i.caixa > 1 ? `<small>${Math.round(i.sugerido / i.caixa)} cx de ${Math.round(i.caixa)}</small>` : "";
      return `<tr>
        <td class="c-prod"><button type="button" class="link-simples" data-produto="${i.produto_id}" title="Ver a previsão deste produto">${esc(i.nome)}</button>
          ${i.eventos ? `<small class="pv-eventos">Inclui: ${esc(i.eventos)}</small>` : ""}</td>
        <td class="num">${esc(qtd(i.estoque, kg))}</td>
        <td class="num c-larga">${i.pendente > 0 ? esc(qtd(i.pendente, kg)) : "—"}</td>
        <td class="num">${esc(qtd(i.previsto, kg))}</td>
        <td class="num c-larga">+${esc(qtd(i.margem, kg))}</td>
        <td class="num c-pedir"><strong>${esc(qtd(i.sugerido, kg))}</strong>${caixas}</td>
      </tr>`;
    }).join("");
    html += `<div class="pv-tabela-caixa"><table class="pv-tabela">
      <caption class="sr-only">Pedido sugerido de ${esc(s.fornecedor)}</caption>
      <thead><tr>
        <th scope="col">Produto</th><th scope="col" class="num">Estoque</th><th scope="col" class="num c-larga">Já pedido</th>
        <th scope="col" class="num">Vende até lá</th><th scope="col" class="num c-larga">Margem</th><th scope="col" class="num">Pedir</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>`;

    const abaixo = s.pedido_minimo != null && s.total < s.pedido_minimo;
    html += `<div class="pv-rodape">
      <div>
        <strong>Custo estimado: ${esc(moeda(s.total))} · ${plural(s.itens.length, "item", "itens")}</strong>
        ${abaixo ? `<p class="pv-minimo">Abaixo do pedido mínimo do fornecedor (${esc(moeda(s.pedido_minimo))}).</p>` : ""}
      </div>
      <button type="button" class="btn btn-primary" data-fornecedor="${s.fornecedor_id}">Revisar e criar pedido</button>
    </div>`;
    return cartao(s.fornecedor, html, "pv-forn");
  }

  // Abre o mesmo "Novo pedido" do Fornecedores, já com os itens e as quantidades sugeridas.
  function abrirPedido(fornecedorId) {
    const s = sugeridos.find(x => x.fornecedor_id === fornecedorId);
    if (!s) return;
    if (!Dados.ler().fornecedores.some(f => f.id === fornecedorId && f.ativo !== false)) {
      App.toast("Fornecedor não encontrado. Atualize a tela.");
      return;
    }
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

  // ------------------------------------------------------------ Aba "Produto"
  function mostrarResultadosBusca() {
    const texto = Regras.norm($("busca").value);
    let lista;
    let rotulo = "";
    if (!texto) {
      // Sem busca: os produtos com alerta primeiro
      const vistos = new Set();
      lista = alertas.filter(a => a.produto_id != null && !vistos.has(a.produto_id) && vistos.add(a.produto_id))
        .slice(0, 8).map(a => ({ id: a.produto_id, nome: a.produto }));
      if (lista.length) rotulo = '<span class="pv-suave pv-com-alerta">Com alerta:</span>';
    } else {
      lista = Dados.ler().produtos.filter(p => Regras.norm(p.nome).includes(texto)).sort(Regras.porNome).slice(0, 12)
        .map(p => ({ id: p.id, nome: p.nome }));
      if (!lista.length) rotulo = '<span class="pv-suave">Nenhum produto encontrado.</span>';
    }
    $("resultados").innerHTML = rotulo + lista.map(p => {
      const ativo = produto && produto.produto_id === p.id;
      return `<button type="button" class="chip${ativo ? " active" : ""}" data-produto="${p.id}" aria-pressed="${ativo}">${esc(p.nome)}</button>`;
    }).join("");
  }

  function htmlProduto() {
    const p = produto;
    if (!p) return suave("Busque um produto para ver quanto ele vendeu, quanto a previsão esperava e o que vem pela frente.");
    const kg = porPeso(p);
    const aviso = { pouco_historico: "Pouco histórico: a previsão se apoia mais no jeito da categoria e da loja.",
      de_epoca: "Produto de época: vende quase só nas datas especiais (veja a lista abaixo).",
      sem_vendas: "Este produto ainda não tem vendas: não há previsão." }[p.situacao];
    let corpo = aviso ? suave(aviso) : "";

    const numeros = [];
    const numero = (valor, rotulo) => `<div class="pv-numero"><strong>${esc(valor)}</strong><span>${esc(rotulo)}</span></div>`;
    if (p.media_dia != null) numeros.push(numero(qtd(p.media_dia, kg), "por dia, em média"));
    if (p.crescimento_ano != null) numeros.push(numero((p.crescimento_ano >= 0 ? "+" : "−") + pct(Math.abs(p.crescimento_ano)), "crescimento por ano"));
    if (p.parte_datas) numeros.push(numero(pct(p.parte_datas), "vendido em datas especiais"));
    if (p.erro_teste != null) numeros.push(numero(pct(p.erro_teste), p.erro_ingenuo != null ? `erro no teste (ano passado: ${pct(p.erro_ingenuo)})` : "erro no teste"));
    if (numeros.length) corpo += `<div class="pv-numeros">${numeros.join("")}</div>`;

    if (p.passado.length || p.futuro.length) {
      corpo += suave("Verde escuro: o que vendeu em cada semana; traço amarelo: o que a previsão esperava. Verde claro: as próximas semanas, " +
        "com a faixa onde a venda deve cair em 8 de cada 10 semanas. Passe o mouse nas colunas.");
      corpo += grafico(p, kg);
    }
    let html = cartao(`${p.nome} · ${p.categoria}`, corpo);

    if (p.idx_semana && p.idx_semana.length === 7 && p.idx_mes && p.idx_mes.length === 12) {
      const dias = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
      const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
      const maxD = Math.max(...p.idx_semana), maxM = Math.max(...p.idx_mes);
      html += duasColunas(
        cartao("Dia da semana", suave("Comparado a um dia médio.") + p.idx_semana.map((v, i) => barra(dias[i], v, maxD, indice(v), v >= 1 ? "verde" : "ambar")).join("")),
        cartao("Mês do ano", suave("Comparado a um mês médio.") + p.idx_mes.map((v, i) => barra(meses[i], v, maxM, indice(v), v >= 1 ? "verde" : "ambar")).join("")));
    }

    const maxData = p.datas.length ? Math.max(...p.datas.map(x => x.a_mais)) : 0;
    html += cartao("Datas especiais (a mais no dia, hoje)", p.datas.length
      ? `<div class="pv-barras-largas">${p.datas.slice(0, 12).map(x => barra(x.evento, x.a_mais, maxData, "+" + qtd(x.a_mais, kg), "roxo")).join("")}</div>`
      : suave("Nenhuma data especial muda a venda deste produto."));
    return html;
  }

  // Gráfico de colunas (Graficos.Previsao do programa): passado (vendido + traço do previsto) e futuro (previsto + faixa)
  function grafico(p, kg) {
    const pontos = [
      ...p.passado.map(w => ({ rotulo: ddmm(w.semana), vendido: w.vendido, previsto: w.previsto, futuro: false,
        dica: `Semana de ${ddmm(w.semana)}: vendeu ${qtd(w.vendido, kg)}, a previsão esperava ${qtd(w.previsto, kg)}` +
          (w.datas > 0 ? ` (incluindo ${qtd(w.datas, kg)} de datas especiais)` : "") })),
      ...p.futuro.map(w => ({ rotulo: ddmm(w.semana), previsto: w.previsto, minimo: w.minimo, maximo: w.maximo, futuro: true,
        dica: `Semana de ${ddmm(w.semana)}: previsão ${qtd(w.previsto, kg)} (entre ${qtd(w.minimo, kg)} e ${qtd(w.maximo, kg)})` +
          (w.eventos ? ` · ${w.eventos}` : "") })),
    ];
    const L = 46, T = 10, W = 760, H = 200, B = 26;
    const maximo = Math.max(1, ...pontos.map(x => Math.max(x.vendido || 0, x.previsto || 0, x.maximo || 0))) * 1.08;
    const y = v => T + H - (v / maximo) * H;
    const passo = (W - L - 6) / pontos.length;
    const larg = passo * 0.62;
    const grade = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const v = maximo / 1.08 * f;
      return `<line x1="${L}" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="pv-g-grade"/>
        <text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="pv-g-eixo" text-anchor="end">${esc(kg ? v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : Math.round(v))}</text>`;
    }).join("");
    const colunas = pontos.map((x, i) => {
      const cx = L + passo * i + passo / 2;
      const x0 = (cx - larg / 2).toFixed(1);
      let g = `<g class="pv-g-semana"><title>${esc(x.dica)}</title><rect x="${(L + passo * i).toFixed(1)}" y="${T}" width="${passo.toFixed(1)}" height="${H}" class="pv-g-alvo"/>`;
      if (!x.futuro) {
        g += `<rect x="${x0}" y="${y(x.vendido).toFixed(1)}" width="${larg.toFixed(1)}" height="${(T + H - y(x.vendido)).toFixed(1)}" class="pv-g-vendido"/>`;
        g += `<line x1="${(cx - larg / 2 - 3).toFixed(1)}" x2="${(cx + larg / 2 + 3).toFixed(1)}" y1="${y(x.previsto).toFixed(1)}" y2="${y(x.previsto).toFixed(1)}" class="pv-g-traco-fundo"/>`;
        g += `<line x1="${(cx - larg / 2 - 2).toFixed(1)}" x2="${(cx + larg / 2 + 2).toFixed(1)}" y1="${y(x.previsto).toFixed(1)}" y2="${y(x.previsto).toFixed(1)}" class="pv-g-traco"/>`;
      } else {
        g += `<rect x="${x0}" y="${y(x.previsto).toFixed(1)}" width="${larg.toFixed(1)}" height="${(T + H - y(x.previsto)).toFixed(1)}" class="pv-g-futuro"/>`;
        g += `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(x.maximo).toFixed(1)}" y2="${y(x.minimo).toFixed(1)}" class="pv-g-faixa"/>`;
        g += `<line x1="${(cx - 5).toFixed(1)}" x2="${(cx + 5).toFixed(1)}" y1="${y(x.maximo).toFixed(1)}" y2="${y(x.maximo).toFixed(1)}" class="pv-g-faixa"/>`;
        g += `<line x1="${(cx - 5).toFixed(1)}" x2="${(cx + 5).toFixed(1)}" y1="${y(x.minimo).toFixed(1)}" y2="${y(x.minimo).toFixed(1)}" class="pv-g-faixa"/>`;
      }
      if (i % 2 === 0) g += `<text x="${cx.toFixed(1)}" y="${T + H + 18}" class="pv-g-eixo" text-anchor="middle">${esc(x.rotulo)}</text>`;
      return g + "</g>";
    }).join("");
    const hojeX = L + passo * p.passado.length;
    const divisa = p.passado.length && p.futuro.length
      ? `<line x1="${hojeX.toFixed(1)}" x2="${hojeX.toFixed(1)}" y1="${T}" y2="${T + H}" class="pv-g-hoje"/><text x="${(hojeX + 4).toFixed(1)}" y="${T + 12}" class="pv-g-eixo">esta semana</text>` : "";
    const resumo = `Gráfico: ${p.passado.length} semanas vendidas e ${p.futuro.length} semanas previstas de ${p.nome}.`;
    // Mesmo conteúdo do gráfico para leitor de tela (a tabela fica dentro de um div: tabela não encolhe até 1px)
    const tabela = `<div class="sr-only"><table><caption>Semanas de ${esc(p.nome)}</caption>
      <thead><tr><th scope="col">Semana</th><th scope="col">Resumo</th></tr></thead>
      <tbody>${pontos.map(x => `<tr><td>${esc(x.rotulo)}</td><td>${esc(x.dica)}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="pv-grafico" role="region" aria-label="Gráfico de vendas e previsão" tabindex="0">
      <svg viewBox="0 0 ${W} ${T + H + B}" role="img" aria-label="${esc(resumo)}">${grade}${divisa}${colunas}</svg>
    </div>
    <ul class="pv-legenda" aria-hidden="true">
      <li><span class="pv-l-vendido"></span>Vendido</li><li><span class="pv-l-traco"></span>Previsão esperava</li>
      <li><span class="pv-l-futuro"></span>Próximas semanas</li><li><span class="pv-l-faixa"></span>Faixa (8 em 10)</li>
    </ul>${tabela}`;
  }

  // ------------------------------------------------------------ Aba "Teste da previsão"
  function htmlTeste() {
    const t = tela;
    let corpo = suave("Para cada ano, a previsão aprendeu só com os 4 anos anteriores e foi conferida semana a semana, produto a produto, " +
      "com o que vendeu de verdade. Comparação: repetir as vendas do mesmo período do ano passado.");
    const anos = t.anos.filter(a => a.erro != null);
    if (!anos.length) {
      corpo += suave(t.geral && t.geral.teste_erro_semana != null
        ? `Último ano (${App.dataBR(t.geral.teste_ini)} a ${App.dataBR(t.geral.teste_fim)}): erro de ${pct(t.geral.teste_erro_semana)}; repetir o ano passado: ${pct(t.geral.teste_erro_ingenuo)}.`
        : "Ainda não há teste: precisa de mais de 1 ano de vendas.");
    } else {
      const maximo = Math.max(...anos.map(a => Math.max(a.erro ?? 0, a.erro_ingenuo ?? 0)));
      corpo += [...anos].sort((a, b) => b.ano - a.ano).map(a => barra(String(a.ano), a.erro ?? 0, maximo,
        `${pct(a.erro)} · ano passado ${pct(a.erro_ingenuo)}`, (a.erro ?? 0) <= (a.erro_ingenuo ?? 0) ? "verde" : "vermelho")).join("");
      const ganhou = anos.filter(a => (a.erro ?? 0) < (a.erro_ingenuo ?? 0)).length;
      corpo += suave(`A previsão errou menos que repetir o ano passado em ${ganhou} de ${anos.length} anos.`, "pv-depois");
    }
    let html = cartao("Erro por ano (por produto e semana)", `<div class="pv-barras-anos">${corpo}</div>`);
    html += duasColunas(cartaoErros("Onde mais erra", t.piores, "vermelho"), cartaoErros("Onde mais acerta", t.melhores, "verde"));
    html += cartao("Por que ainda erra?", suave(
      "Boa parte do erro é sorte: mesmo sabendo exatamente quantos clientes viriam em cada dia, a escolha de cada cliente varia. " +
      "Nos testes com os dados de exemplo, só cerca de 1,5 ponto do erro semanal é culpa da previsão. Por isso o pedido usa a margem " +
      "de segurança e olha o ciclo do fornecedor (2 semanas erram bem menos que 1)."));
    return html;
  }

  function cartaoErros(titulo, lista, cor) {
    if (!lista.length) return cartao(titulo, suave("Sem teste ainda."));
    const maximo = Math.max(...lista.map(x => x.erro));
    return cartao(titulo, `<div class="pv-barras-largas">${lista.map(x => barra(x.produto, x.erro, maximo, pct(x.erro), cor)).join("")}</div>`);
  }

  // ------------------------------------------------------------ Aba "Alertas"
  function htmlAlertas() {
    if (!alertas.length) {
      return cartao("Nenhum alerta", suave("Nenhum produto parado, nenhuma venda fora do normal e nenhuma data especial nos próximos 21 dias."));
    }
    const grupos = [["falta", "Clientes sem o produto"], ["parado", "Produtos parados"], ["queda", "Vendendo menos que o normal"],
      ["alta", "Vendendo mais que o normal"], ["data", "Datas especiais chegando"]];
    return grupos.map(([tipo, titulo]) => {
      const doTipo = alertas.filter(a => a.tipo === tipo);
      if (!doTipo.length) return "";
      return cartao(`${titulo} (${doTipo.length})`, `<ul class="pv-alertas">${doTipo.map(a => `
        <li>
          <div><strong>${esc(a.produto)}</strong><p>${esc(a.texto)}</p></div>
          ${a.produto_id != null ? `<button type="button" class="link-btn" data-produto="${a.produto_id}" aria-label="Ver produto ${esc(a.produto)}">Ver produto</button>` : ""}
        </li>`).join("")}</ul>`);
    }).join("");
  }

  // ------------------------------------------------------------ Eventos
  $("btn-atualizar").addEventListener("click", () => {
    PrevisaoSimulada.limpar();
    carregar();
    if (tela) App.toast("Previsão atualizada.");
  });
  $("btn-tentar").addEventListener("click", () => { PrevisaoSimulada.limpar(); carregar(); });

  const abas = [...document.querySelectorAll("#abas [role=tab]")];
  $("abas").addEventListener("click", e => {
    const b = e.target.closest("[role=tab]");
    if (b) trocarAba(b.dataset.aba);
  });
  $("abas").addEventListener("keydown", e => {
    const i = abas.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === "ArrowRight") j = (i + 1) % abas.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + abas.length) % abas.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = abas.length - 1;
    if (j === null) return;
    e.preventDefault();
    abas[j].focus();
    trocarAba(abas[j].dataset.aba);
  });

  $("conteudo").addEventListener("click", e => {
    const p = e.target.closest("[data-produto]");
    if (p) return abrirProduto(Number(p.dataset.produto));
    const f = e.target.closest("[data-fornecedor]");
    if (f) abrirPedido(Number(f.dataset.fornecedor));
  });
  $("busca").addEventListener("input", mostrarResultadosBusca);

  carregar();
  Dados.aoMudar(carregar);
})();
