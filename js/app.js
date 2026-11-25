/*
 * Estrutura comum das telas internas: menu lateral, usuário logado,
 * botão sair, menu no celular e avisos rápidos (toast).
 * Uso: const sessao = App.iniciar({ ativo: "painel", perfis: ["gerente"] });
 */
const App = (() => {
  const ICONES = {
    painel: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    estoque: '<path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    fornecedores: '<path d="M1 6h13v10H1zM14 10h4l3 3v3h-7z"/><circle cx="5" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    calendario: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4M8 14h2M14 14h2M8 17h2"/>',
    caixa: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h4M14 13h3M7 16h4M14 16h3"/>',
    fechamento: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    previsao: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/><path d="M3 21h18"/>',
    sair: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  };

  // `pronto: false` marca as telas que ainda serão desenvolvidas.
  const MENU = [
    { id: "painel", nome: "Painel", href: "painel.html", pronto: true, perfis: ["gerente"] },
    { id: "estoque", nome: "Estoque", href: "estoque.html", pronto: true, perfis: ["gerente"] },
    { id: "fornecedores", nome: "Fornecedores", href: "fornecedores.html", pronto: true, perfis: ["gerente"] },
    { id: "calendario", nome: "Calendário", href: "calendario.html", pronto: true, perfis: ["gerente"] },
    { id: "caixa", nome: "Caixa", href: "caixa.html", pronto: true, perfis: ["gerente", "operador"] },
    { id: "fechamento", nome: "Fechamento do dia", href: "fechamento.html", pronto: true, perfis: ["gerente"] },
    { id: "previsao", nome: "Previsão de compras", href: "previsao.html", pronto: true, perfis: ["gerente"] },
  ];

  const svg = nome => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[nome]}</svg>`;

  let toastTimer;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function emBreve(nome) {
    toast(`A tela “${nome}” será desenvolvida na próxima etapa.`);
  }

  function iniciar({ ativo, perfis }) {
    const sessao = Auth.exigirLogin(perfis);
    if (!sessao) return null;

    const itens = MENU.filter(m => m.perfis.includes(sessao.perfil)).map(m => `
      <a class="nav-item${m.id === ativo ? " active" : ""}" href="${m.href}" data-id="${m.id}"
         ${m.id === ativo ? 'aria-current="page"' : ""}>
        ${svg(m.id)}<span>${m.nome}</span>${m.pronto ? "" : '<span class="soon">em breve</span>'}
      </a>`).join("");

    // Atalho do teclado para pular o menu e ir direto ao conteúdo da tela
    const main = document.querySelector("main");
    main.id = main.id || "conteudo";
    main.tabIndex = -1;
    document.body.insertAdjacentHTML("afterbegin", `<a class="pular" href="#${main.id}">Pular para o conteúdo</a>`);

    const sidebar = document.getElementById("sidebar");
    sidebar.innerHTML = `
      <a class="brand" href="${Auth.DESTINO_POR_PERFIL[sessao.perfil]}">
        <span class="brand-mark" aria-hidden="true">M</span><span class="brand-name">Mercado</span>
      </a>
      <nav class="nav" aria-label="Menu principal">${itens}</nav>
      <div class="sidebar-footer">
        <div class="user">
          <span class="avatar" aria-hidden="true"></span>
          <div><strong class="user-name"></strong><span class="user-role"></span></div>
        </div>
        <button type="button" class="btn-logout">${svg("sair")}Sair</button>
      </div>`;
    sidebar.querySelector(".avatar").textContent = sessao.nome.charAt(0);
    sidebar.querySelector(".user-name").textContent = sessao.nome;
    sidebar.querySelector(".user-role").textContent = sessao.perfil;
    sidebar.querySelector(".btn-logout").addEventListener("click", Auth.logout);

    sidebar.querySelectorAll(".nav-item").forEach(a => {
      const item = MENU.find(m => m.id === a.dataset.id);
      if (!item.pronto) a.addEventListener("click", e => { e.preventDefault(); emBreve(item.nome); });
    });

    // Menu no celular
    const toggle = document.getElementById("menu-toggle");
    const backdrop = document.getElementById("backdrop");
    const abrir = aberto => {
      sidebar.classList.toggle("open", aberto);
      backdrop.hidden = !aberto;
      toggle.setAttribute("aria-expanded", String(aberto));
    };
    toggle.addEventListener("click", () => abrir(!sidebar.classList.contains("open")));
    backdrop.addEventListener("click", () => abrir(false));

    return sessao;
  }

  const moeda = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // "Ocultar vendas" (como no programa, Views/ValoresVenda.cs): troca os valores de venda por "R$ •••••" para quem estiver
  // olhando a tela. A escolha fica guardada neste navegador e vale para todas as telas (e para as outras abas abertas).
  const CHAVE_OCULTAR = "mercado.ocultarVendas";
  const lerOcultar = () => { try { return localStorage.getItem(CHAVE_OCULTAR) === "1"; } catch (_) { return false; } };
  let ocultas = lerOcultar();
  const ouvintesOcultar = [];
  const avisarOcultar = () => {
    document.querySelectorAll("[data-ocultar-vendas]").forEach(c => { c.checked = ocultas; });
    ouvintesOcultar.forEach(fn => fn(ocultas));
  };
  window.addEventListener("storage", e => { if (e.key === CHAVE_OCULTAR) { ocultas = lerOcultar(); avisarOcultar(); } });

  const vendasOcultas = () => ocultas;
  const venda = v => ocultas ? "R$ •••••" : moeda(v);
  function definirOcultar(valor) {
    ocultas = Boolean(valor);
    try { localStorage.setItem(CHAVE_OCULTAR, ocultas ? "1" : "0"); } catch (_) {}
    avisarOcultar();
  }
  /** Avisa a tela quando o interruptor muda (para mostrar os valores de novo). */
  const aoOcultar = fn => ouvintesOcultar.push(fn);
  /** Põe o interruptor "Ocultar vendas" no cabeçalho da tela (.page-head). */
  function interruptorOcultar(alvo = document.querySelector(".page-head")) {
    if (!alvo) return;
    const rotulo = document.createElement("label");
    rotulo.className = "interruptor";
    rotulo.title = "Esconde os valores de venda da tela (vale para todas as telas deste navegador)";
    rotulo.innerHTML = '<input type="checkbox" role="switch" data-ocultar-vendas><span class="interruptor-trilho" aria-hidden="true"></span><span>Ocultar vendas</span>';
    const caixa = rotulo.querySelector("input");
    caixa.checked = ocultas;
    caixa.addEventListener("change", () => definirOcultar(caixa.checked));
    alvo.appendChild(rotulo);
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dataBR = iso => iso ? new Date(iso + "T12:00").toLocaleDateString("pt-BR") : "—";

  return { iniciar, toast, emBreve, svg, moeda, esc, dataBR, MENU, venda, vendasOcultas, aoOcultar, interruptorOcultar };
})();
