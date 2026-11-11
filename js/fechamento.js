(() => {
  const sessao = App.iniciar({ ativo: "fechamento", perfis: ["gerente"] });
  if (!sessao) return;

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const moeda = App.moeda;
  const CHAVE = dia => "mercado.fechamento." + dia;

  // Registro do dia fechado (fica neste navegador; o envio do resumo por e-mail é feito pelo programa para Windows)
  function lerFechamento(dia) {
    try { return JSON.parse(localStorage.getItem(CHAVE(dia))); } catch (_) { return null; }
  }
  function gravarFechamento(dia, registro) {
    try { localStorage.setItem(CHAVE(dia), JSON.stringify(registro)); } catch (_) {}
  }

  const hora = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  function lista(el, itens, vazio) {
    el.innerHTML = itens.length
      ? itens.map(i => `<li><span>${i.texto}</span><strong>${i.valor}</strong></li>`).join("")
      : `<li class="empty">${vazio}</li>`;
  }

  function render() {
    const d = Dados.ler();
    const validas = d.vendas.filter(v => !v.cancelada);
    const canceladas = d.vendas.filter(v => v.cancelada);
    const total = validas.reduce((s, v) => s + v.total, 0);
    const fechamento = lerFechamento(d.dia);

    $("data-dia").textContent = new Date(d.dia + "T12:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    $("kpi-total").textContent = moeda(total);
    $("kpi-vendas").textContent = String(validas.length);
    $("kpi-vendas-sub").textContent = validas.length === 1 ? "venda paga" : "vendas pagas";
    $("kpi-ticket").textContent = moeda(validas.length ? total / validas.length : 0);
    $("kpi-cancel").textContent = String(canceladas.length);

    // Formas de pagamento
    const porForma = {};
    validas.forEach(v => { porForma[v.forma] = (porForma[v.forma] || 0) + v.total; });
    lista($("formas"), Object.entries(porForma).sort((a, b) => b[1] - a[1]).map(([forma, valor]) => ({
      texto: esc(Regras.FORMAS[forma] || forma),
      valor: `${moeda(valor)}${total ? ` · ${Math.round(valor / total * 100)}%` : ""}`,
    })), "Nenhuma venda paga ainda.");

    // Mais vendidos (pelo valor vendido de cada produto)
    const produtos = {};
    validas.forEach(v => v.itens.forEach(i => {
      const p = produtos[i.produtoId] || (produtos[i.produtoId] = { nome: i.nome, valor: 0 });
      p.valor += i.qtd * i.preco;
    }));
    lista($("mais-vendidos"), Object.values(produtos).sort((a, b) => b.valor - a.valor).slice(0, 5).map(p => ({
      texto: esc(p.nome), valor: moeda(p.valor),
    })), "Ainda não há produtos vendidos.");

    // Vendas por hora
    const porHora = {};
    validas.forEach(v => { const h = v.hora.slice(0, 2); porHora[h] = (porHora[h] || 0) + v.total; });
    lista($("por-hora"), Object.keys(porHora).sort().map(h => ({ texto: `${h}h`, valor: moeda(porHora[h]) })),
      "Nenhuma venda ainda.");

    // Cancelamentos
    lista($("cancelamentos"), canceladas.map(v => ({
      texto: `Venda nº ${v.id} · ${esc(v.hora)}${v.canceladaPor ? " · cancelada por " + esc(v.canceladaPor) : ""}`,
      valor: moeda(v.total),
    })), "Nenhuma venda cancelada hoje.");

    // Situação do caixa e do dia
    const caixaAberto = d.caixa.aberto;
    $("aviso-caixa").hidden = !caixaAberto;
    $("aviso-caixa").textContent = caixaAberto
      ? `O caixa está aberto por ${d.caixa.abertoPor}. Feche o caixa antes de fechar o dia.`
      : "";
    $("situacao").textContent = fechamento ? "Dia fechado" : caixaAberto ? "Caixa aberto" : "Em andamento";

    const botao = $("btn-fechar");
    if (fechamento) {
      $("fechar-texto").textContent = `Dia fechado às ${fechamento.fechadoAs}, com ${moeda(fechamento.total)} vendidos.`;
      botao.disabled = true;
    } else {
      $("fechar-texto").textContent = caixaAberto
        ? "Só é possível fechar o dia com o caixa fechado."
        : "Confira os números e feche o dia. Depois de fechado, o resumo fica registrado.";
      botao.disabled = caixaAberto;
    }
  }

  $("btn-fechar").addEventListener("click", () => {
    const d = Dados.ler();
    if (d.caixa.aberto || lerFechamento(d.dia)) return;
    const validas = d.vendas.filter(v => !v.cancelada);
    const total = validas.reduce((s, v) => s + v.total, 0);
    gravarFechamento(d.dia, { fechadoAs: hora(), total, vendas: validas.length });
    App.toast("Dia fechado.");
    render();
  });

  render();
  Dados.aoMudar(render);
})();
