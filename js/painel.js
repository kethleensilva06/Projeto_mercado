(() => {
  const sessao = App.iniciar({ ativo: "painel", perfis: ["gerente"] });
  if (!sessao) return;

  const $ = id => document.getElementById(id);
  const ICONE = {
    estoque: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    pedido: '<path d="M1 6h13v10H1zM14 10h4l3 3v3h-7z"/><circle cx="5" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    caixa: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h4"/>',
  };
  const COR = { estoque: "icon-amber", pedido: "icon-blue", caixa: "icon-green" };

  function turno(h) {
    if (h < 12) return "turno da manhã";
    if (h < 18) return "turno da tarde";
    return "turno da noite";
  }

  function cabecalho() {
    const agora = new Date();
    $("saudacao").textContent = `Olá, ${sessao.nome}`;
    const data = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    $("data-turno").textContent = data.charAt(0).toUpperCase() + data.slice(1) + " — " + turno(agora.getHours());
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function plural(n, um, varios) { return n === 1 ? `${n} ${um}` : `${n} ${varios}`; }

  let anterior = null;
  function render() {
    const d = Dados.ler();
    const total = d.vendas.reduce((s, v) => s + v.total, 0);
    const qtdVendas = d.vendas.length;
    const baixos = d.produtos.filter(p => p.qtd < p.minimo);
    const pendentes = d.pedidos.filter(p => p.status === "pendente");

    const valores = {
      "kpi-vendas": App.moeda(total),
      "kpi-estoque": plural(baixos.length, "produto", "produtos"),
      "kpi-pedidos": plural(pendentes.length, "pedido", "pedidos"),
      "kpi-ticket": App.moeda(qtdVendas ? total / qtdVendas : 0),
    };
    Object.entries(valores).forEach(([id, v]) => {
      const el = $(id);
      if (anterior && anterior[id] !== v) {
        const card = el.closest(".kpi");
        card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
      }
      el.textContent = v;
    });
    anterior = valores;
    $("kpi-vendas-sub").textContent = plural(qtdVendas, "venda realizada", "vendas realizadas");
    $("atalho-caixa").textContent = d.caixa.aberto ? "Ir para o caixa" : "Abrir caixa";

    // Avisos: gerados a partir dos dados de estoque, pedidos e caixa
    const avisos = [];
    baixos.forEach(p => avisos.push({
      tipo: "estoque",
      texto: `<strong>${esc(p.nome)}</strong> está com estoque baixo (${plural(p.qtd, "unidade", "unidades")}).`,
      quando: "Estoque",
    }));
    pendentes.forEach(p => avisos.push({
      tipo: "pedido",
      texto: Dados.pedidoAtrasado(p)
        ? `Pedido para <strong>${esc(p.fornecedor)}</strong> está atrasado (previsto para ${App.dataBR(p.previsao)}).`
        : `Pedido para <strong>${esc(p.fornecedor)}</strong> ainda não foi entregue.`,
      quando: "Pedido de " + new Date(p.data + "T12:00").toLocaleDateString("pt-BR"),
    }));
    if (d.caixa.aberto) {
      avisos.push({
        tipo: "caixa",
        texto: `Caixa aberto por <strong>${esc(d.caixa.abertoPor)}</strong> às ${esc(d.caixa.abertoAs)}.`,
        quando: "Hoje",
      });
    }

    $("avisos").innerHTML = avisos.length
      ? avisos.map(a => `
          <li>
            <span class="alert-icon ${COR[a.tipo]}"><svg viewBox="0 0 24 24">${ICONE[a.tipo]}</svg></span>
            <div><p>${a.texto}</p><time>${a.quando}</time></div>
          </li>`).join("")
      : '<li class="empty">Nenhum aviso no momento.</li>';

    $("atualizado").textContent = "Atualizado às " +
      new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  // Atalhos para telas que ainda não existem
  document.querySelectorAll(".shortcut[data-tela]").forEach(a =>
    a.addEventListener("click", e => { e.preventDefault(); App.emBreve(a.dataset.tela); })
  );

  cabecalho();
  render();
  Dados.aoMudar(render);            // nova venda ou alteração → atualiza na hora
  setInterval(() => { cabecalho(); render(); }, 30000);
})();
