(() => {
  const sessao = App.iniciar({ ativo: "fornecedores", perfis: ["gerente"] });
  if (!sessao) return;

  const $ = id => document.getElementById(id);
  const { esc, dataBR } = App;
  const norm = s => String(s).toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "");

  const STATUS = {
    "em-dia": "Em dia", pendente: "Pendente", atrasado: "Atrasado", "sem-pedidos": "Sem pedidos",
  };
  const ICON_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_ALERTA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>';

  let filtro = "todos";
  const abertos = new Set();
  let editandoId = null;
  let excluindoId = null;

  // ---------- Regras ----------
  function ultimoPedido(d, fornecedorId) {
    return d.pedidos.filter(p => p.fornecedorId === fornecedorId)
      .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id)[0] || null;
  }

  // Fornecedor de um produto: o vinculado a ele, ou o primeiro que fornece a categoria.
  function fornecedorDoProduto(d, produto) {
    return d.fornecedores.find(f => f.id === produto.fornecedorId) ||
      d.fornecedores.find(f => f.produtos.split(",").some(c => norm(c.trim()) === norm(produto.categoria))) || null;
  }

  // Produtos abaixo do mínimo que ainda não têm pedido pendente e não foram ignorados hoje.
  function sugestoes(d) {
    const hoje = Dados.hojeISO();
    return d.produtos
      .filter(p => p.qtd < p.minimo)
      .filter(p => !d.pedidos.some(o => o.status === "pendente" && o.itens.some(i => i.produtoId === p.id)))
      .filter(p => d.sugestoesIgnoradas[p.id] !== hoje)
      .map(p => ({ produto: p, fornecedor: fornecedorDoProduto(d, p) }))
      .filter(s => s.fornecedor);
  }

  const qtdSugerida = p => Math.max(p.minimo * 2 - p.qtd, p.minimo);

  function descreverItens(d, pedido) {
    return pedido.itens.map(i => {
      const p = d.produtos.find(x => x.id === i.produtoId);
      return `${i.qtd}× ${p ? p.nome : "produto removido"}`;
    }).join(", ");
  }

  // ---------- Sugestões ----------
  function renderSugestoes(d) {
    $("sugestoes").innerHTML = sugestoes(d).map(({ produto: p, fornecedor: f }) => `
      <article class="suggestion">
        <span class="suggestion-icon">${ICON_ALERTA}</span>
        <div class="suggestion-text">
          <small>Sugestão de reposição</small>
          <p><strong>${esc(p.nome)}</strong> está com estoque baixo (${p.qtd} un.). Criar pedido para <strong>${esc(f.nome)}</strong>?</p>
        </div>
        <div class="suggestion-actions">
          <button type="button" class="btn btn-primary" data-sug="criar" data-produto="${p.id}" data-fornecedor="${f.id}">Criar pedido</button>
          <button type="button" class="btn btn-ghost" data-sug="ignorar" data-produto="${p.id}">Ignorar</button>
        </div>
      </article>`).join("");
  }

  $("sugestoes").addEventListener("click", e => {
    const b = e.target.closest("[data-sug]");
    if (!b) return;
    const produtoId = Number(b.dataset.produto);
    if (b.dataset.sug === "criar") {
      abrirPedido({ fornecedorId: Number(b.dataset.fornecedor), produtoId });
    } else {
      const d = Dados.ler();
      d.sugestoesIgnoradas[produtoId] = Dados.hojeISO();
      Dados.salvar(d);
      App.toast("Sugestão ignorada por hoje.");
      Dados.notificar();
    }
  });

  // ---------- Lista ----------
  function render() {
    const d = Dados.ler();
    renderSugestoes(d);

    const comStatus = d.fornecedores.map(f => ({ f, status: Dados.statusFornecedor(d, f.id), ultimo: ultimoPedido(d, f.id) }));
    const cont = s => comStatus.filter(x => x.status === s).length;
    $("c-todos").textContent = comStatus.length;
    $("c-pendente").textContent = cont("pendente");
    $("c-atrasado").textContent = cont("atrasado");
    const pend = d.pedidos.filter(p => p.status === "pendente").length;
    $("resumo").textContent = `${comStatus.length} fornecedores · ${pend} ${pend === 1 ? "pedido aguardando" : "pedidos aguardando"} entrega · ${cont("atrasado")} com atraso`;

    const termo = norm($("busca").value.trim());
    const lista = comStatus
      .filter(x => !termo || norm(x.f.nome).includes(termo) || norm(x.f.produtos).includes(termo))
      .filter(x => filtro === "todos" || x.status === filtro)
      .sort((a, b) => a.f.nome.localeCompare(b.f.nome, "pt-BR"));

    $("vazio").hidden = lista.length > 0;
    $("vazio").textContent = termo ? `Nenhum fornecedor encontrado para “${$("busca").value.trim()}”.` : "Nenhum fornecedor neste filtro.";

    $("lista").innerHTML = lista.map(({ f, status, ultimo }) => {
      const aberto = abertos.has(f.id);
      const historico = d.pedidos.filter(p => p.fornecedorId === f.id).sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
      return `
        <tr class="row${aberto ? " open" : ""}" data-id="${f.id}">
          <td class="col-toggle">
            <button type="button" class="row-toggle" data-acao="detalhes" aria-expanded="${aberto}"
                    aria-label="Ver histórico de pedidos de ${esc(f.nome)}">${ICON_CHEVRON}</button>
          </td>
          <td class="c-nome">
            <span class="forn-name">${esc(f.nome)}</span>
            ${f.email ? `<span class="forn-email">${esc(f.email)}</span>` : ""}
          </td>
          <td class="c-tel"><span class="tel">${esc(f.telefone)}</span></td>
          <td class="c-prod">${esc(f.produtos)}</td>
          <td class="c-ult">${ultimo ? dataBR(ultimo.data) : '<span class="muted">—</span>'}</td>
          <td class="c-status"><span class="status status-${status}">${STATUS[status]}</span></td>
          <td class="c-acoes">
            <div class="actions">
              <button type="button" class="link-btn details-btn" data-acao="detalhes" aria-expanded="${aberto}">${aberto ? "Ocultar" : "Pedidos"}</button>
              <button type="button" class="link-btn" data-acao="editar">Editar</button>
              <button type="button" class="link-btn danger" data-acao="excluir">Excluir</button>
            </div>
          </td>
        </tr>
        ${aberto ? `
        <tr class="details">
          <td colspan="7">
            <p class="history-title">Histórico de pedidos</p>
            ${historico.length ? `
            <table class="history">
              <thead><tr><th>Data</th><th>Itens</th><th>Entrega</th><th>Situação</th><th></th></tr></thead>
              <tbody>
                ${historico.map(p => {
                  const atrasado = Dados.pedidoAtrasado(p);
                  const sit = p.status === "entregue" ? "em-dia" : atrasado ? "atrasado" : "pendente";
                  const sitTxt = p.status === "entregue" ? "Entregue" : atrasado ? "Atrasado" : "Aguardando";
                  const entrega = p.status === "entregue" ? `Entregue em ${dataBR(p.entregue)}` : `Previsto para ${dataBR(p.previsao)}`;
                  return `<tr>
                    <td>${dataBR(p.data)}</td>
                    <td>${esc(descreverItens(d, p))}</td>
                    <td>${entrega}</td>
                    <td><span class="status status-${sit}">${sitTxt}</span></td>
                    <td>${p.status === "pendente" ? `<button type="button" class="link-btn" data-entregar="${p.id}">Registrar entrega</button>` : ""}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>` : '<p class="history-empty">Nenhum pedido feito para este fornecedor ainda.</p>'}
            <div class="actions" style="justify-content:flex-start;margin-top:12px">
              <button type="button" class="link-btn" data-acao="pedir">+ Novo pedido para ${esc(f.nome)}</button>
            </div>
          </td>
        </tr>` : ""}`;
    }).join("");
  }

  $("lista").addEventListener("click", e => {
    const entregar = e.target.closest("[data-entregar]");
    if (entregar) return registrarEntrega(Number(entregar.dataset.entregar));
    const btn = e.target.closest("[data-acao]");
    if (!btn) return;
    const row = btn.closest("tr.details") ? btn.closest("tr.details").previousElementSibling : btn.closest("tr");
    const id = Number(row.dataset.id);
    const acao = btn.dataset.acao;
    if (acao === "detalhes") { abertos.has(id) ? abertos.delete(id) : abertos.add(id); render(); }
    if (acao === "editar") abrirFornecedor(id);
    if (acao === "excluir") abrirExclusao(id);
    if (acao === "pedir") abrirPedido({ fornecedorId: id });
  });

  $("busca").addEventListener("input", render);
  document.querySelectorAll(".chip").forEach(chip =>
    chip.addEventListener("click", () => {
      filtro = chip.dataset.filtro;
      document.querySelectorAll(".chip").forEach(c => {
        c.classList.toggle("active", c === chip);
        c.setAttribute("aria-pressed", String(c === chip));
      });
      render();
    })
  );

  // ---------- Entrega: soma ao estoque ----------
  function registrarEntrega(pedidoId) {
    const d = Dados.ler();
    const p = d.pedidos.find(x => x.id === pedidoId);
    if (!p || p.status !== "pendente") return;
    p.status = "entregue";
    p.entregue = Dados.hojeISO();
    p.itens.forEach(i => {
      const prod = d.produtos.find(x => x.id === i.produtoId);
      if (prod) { prod.qtd += i.qtd; prod.compra = Dados.hojeISO(); }
    });
    Dados.salvar(d);
    App.toast(`Entrega registrada: ${descreverItens(d, p)} somado ao estoque.`);
    Dados.notificar();
  }

  // ---------- Utilidades de formulário ----------
  function setErro(el, msg) {
    $(el.id + "-error").textContent = msg;
    el.setAttribute("aria-invalid", msg ? "true" : "false");
  }

  function mascaraTelefone(v) {
    const n = v.replace(/\D/g, "").slice(0, 11);
    if (n.length <= 2) return n.length ? `(${n}` : "";
    if (n.length <= 6) return `(${n.slice(0, 2)}) ${n.slice(2)}`;
    if (n.length <= 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
    return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  }

  document.querySelectorAll("dialog input, dialog select").forEach(el =>
    el.addEventListener("input", () => { if (el.getAttribute("aria-invalid") === "true") setErro(el, ""); })
  );
  document.querySelectorAll("[data-fechar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

  // ---------- Cadastro / edição de fornecedor ----------
  const mf = $("modal-fornecedor");
  const cf = { nome: $("f-nome"), telefone: $("f-telefone"), email: $("f-email"), produtos: $("f-produtos") };
  cf.telefone.addEventListener("input", () => { cf.telefone.value = mascaraTelefone(cf.telefone.value); });

  function abrirFornecedor(id) {
    const f = id ? Dados.ler().fornecedores.find(x => x.id === id) : null;
    editandoId = f ? f.id : null;
    $("mf-titulo").textContent = f ? "Editar fornecedor" : "Novo fornecedor";
    $("mf-salvar").textContent = f ? "Salvar alterações" : "Cadastrar fornecedor";
    Object.entries(cf).forEach(([k, el]) => { el.value = f ? f[k] || "" : ""; setErro(el, ""); });
    mf.showModal();
    cf.nome.focus();
  }

  $("form-fornecedor").addEventListener("submit", e => {
    e.preventDefault();
    const d = Dados.ler();
    const v = { nome: cf.nome.value.trim(), telefone: cf.telefone.value.trim(), email: cf.email.value.trim(), produtos: cf.produtos.value.trim() };
    const erros = {};
    if (!v.nome) erros.nome = "Informe o nome do fornecedor.";
    else if (d.fornecedores.some(f => f.id !== editandoId && norm(f.nome) === norm(v.nome))) erros.nome = "Já existe um fornecedor com esse nome.";
    const dig = v.telefone.replace(/\D/g, "");
    if (dig.length < 10) erros.telefone = "Informe o telefone com DDD.";
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) erros.email = "E-mail inválido.";
    if (!v.produtos) erros.produtos = "Informe o que esse fornecedor entrega.";
    Object.entries(cf).forEach(([k, el]) => setErro(el, erros[k] || ""));
    const primeiro = Object.keys(cf).find(k => erros[k]);
    if (primeiro) return cf[primeiro].focus();

    if (editandoId) {
      Object.assign(d.fornecedores.find(f => f.id === editandoId), v);
      d.pedidos.forEach(p => { if (p.fornecedorId === editandoId) p.fornecedor = v.nome; });
    } else {
      d.fornecedores.push({ id: d.fornecedores.reduce((m, f) => Math.max(m, f.id), 0) + 1, ...v });
    }
    Dados.salvar(d);
    mf.close();
    App.toast(editandoId ? `“${v.nome}” foi atualizado.` : `“${v.nome}” foi cadastrado.`);
    Dados.notificar();
  });

  // ---------- Exclusão ----------
  const mx = $("modal-excluir");
  function abrirExclusao(id) {
    const d = Dados.ler();
    const f = d.fornecedores.find(x => x.id === id);
    if (!f) return;
    excluindoId = id;
    const pend = d.pedidos.filter(p => p.fornecedorId === id && p.status === "pendente").length;
    $("excluir-texto").textContent = `“${f.nome}” e o histórico de pedidos dele serão removidos.` +
      (pend ? ` Atenção: há ${pend} ${pend === 1 ? "pedido pendente" : "pedidos pendentes"}.` : "") + " Esta ação não pode ser desfeita.";
    mx.showModal();
    mx.querySelector("[data-fechar]").focus();
  }
  $("btn-confirmar-excluir").addEventListener("click", () => {
    const d = Dados.ler();
    const f = d.fornecedores.find(x => x.id === excluindoId);
    d.fornecedores = d.fornecedores.filter(x => x.id !== excluindoId);
    d.pedidos = d.pedidos.filter(p => p.fornecedorId !== excluindoId);
    d.produtos.forEach(p => { if (p.fornecedorId === excluindoId) p.fornecedorId = null; });
    abertos.delete(excluindoId);
    Dados.salvar(d);
    mx.close();
    if (f) App.toast(`“${f.nome}” foi excluído.`);
    Dados.notificar();
  });

  // ---------- Novo pedido ----------
  const mp = $("modal-pedido");
  const cp = { fornecedor: $("p-fornecedor"), produto: $("p-produto"), qtd: $("p-qtd"), previsao: $("p-previsao") };

  function opcoesProduto(d, fornecedorId) {
    const f = d.fornecedores.find(x => x.id === fornecedorId);
    const cats = f ? f.produtos.split(",").map(c => norm(c.trim())) : [];
    const doFornecedor = p => p.fornecedorId === fornecedorId || cats.includes(norm(p.categoria));
    const ordenar = arr => arr.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const opt = p => `<option value="${p.id}">${esc(p.nome)}${p.qtd < p.minimo ? " — estoque baixo" : ""}</option>`;
    const sim = ordenar(d.produtos.filter(doFornecedor)), nao = ordenar(d.produtos.filter(p => !doFornecedor(p)));
    return '<option value="">Selecione o produto</option>' +
      (sim.length ? `<optgroup label="Fornecidos por este fornecedor">${sim.map(opt).join("")}</optgroup>` : "") +
      (nao.length ? `<optgroup label="Outros produtos">${nao.map(opt).join("")}</optgroup>` : "");
  }

  function atualizarInfoProduto() {
    const p = Dados.ler().produtos.find(x => x.id === Number(cp.produto.value));
    $("p-produto-info").textContent = p ? `Estoque atual: ${p.qtd} un. · mínimo: ${p.minimo} un.` : "";
  }

  function abrirPedido({ fornecedorId = null, produtoId = null } = {}) {
    const d = Dados.ler();
    if (!d.fornecedores.length) return App.toast("Cadastre um fornecedor antes de criar pedidos.");
    cp.fornecedor.innerHTML = '<option value="">Selecione o fornecedor</option>' +
      [...d.fornecedores].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        .map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join("");
    cp.fornecedor.value = fornecedorId || "";
    cp.produto.innerHTML = opcoesProduto(d, fornecedorId);
    cp.produto.value = produtoId || "";
    const p = d.produtos.find(x => x.id === produtoId);
    cp.qtd.value = p ? qtdSugerida(p) : "";
    cp.previsao.value = Dados.dia(3);
    cp.previsao.min = Dados.hojeISO();
    Object.values(cp).forEach(el => setErro(el, ""));
    atualizarInfoProduto();
    mp.showModal();
    (fornecedorId ? (produtoId ? cp.qtd : cp.produto) : cp.fornecedor).focus();
  }

  cp.fornecedor.addEventListener("change", () => {
    const atual = cp.produto.value;
    cp.produto.innerHTML = opcoesProduto(Dados.ler(), Number(cp.fornecedor.value));
    cp.produto.value = atual;
    atualizarInfoProduto();
  });
  cp.produto.addEventListener("change", () => {
    const p = Dados.ler().produtos.find(x => x.id === Number(cp.produto.value));
    if (p && !cp.qtd.value) cp.qtd.value = qtdSugerida(p);
    atualizarInfoProduto();
  });

  $("form-pedido").addEventListener("submit", e => {
    e.preventDefault();
    const erros = {};
    if (!cp.fornecedor.value) erros.fornecedor = "Escolha o fornecedor.";
    if (!cp.produto.value) erros.produto = "Escolha o produto.";
    if (!/^\d+$/.test(cp.qtd.value) || Number(cp.qtd.value) < 1) erros.qtd = "Informe uma quantidade de 1 ou mais.";
    if (!cp.previsao.value) erros.previsao = "Informe a previsão de entrega.";
    else if (cp.previsao.value < Dados.hojeISO()) erros.previsao = "A previsão não pode ser no passado.";
    Object.entries(cp).forEach(([k, el]) => setErro(el, erros[k] || ""));
    const primeiro = Object.keys(cp).find(k => erros[k]);
    if (primeiro) return cp[primeiro].focus();

    const d = Dados.ler();
    const f = d.fornecedores.find(x => x.id === Number(cp.fornecedor.value));
    const prod = d.produtos.find(x => x.id === Number(cp.produto.value));
    d.pedidos.push({
      id: d.pedidos.reduce((m, p) => Math.max(m, p.id), 0) + 1,
      fornecedorId: f.id, fornecedor: f.nome,
      data: Dados.hojeISO(), previsao: cp.previsao.value, status: "pendente",
      itens: [{ produtoId: prod.id, qtd: Number(cp.qtd.value) }],
    });
    if (!prod.fornecedorId) prod.fornecedorId = f.id;
    Dados.salvar(d);
    mp.close();
    App.toast(`Pedido criado: ${cp.qtd.value}× ${prod.nome} com ${f.nome}.`);
    Dados.notificar();
  });

  // ---------- Início ----------
  $("btn-novo").addEventListener("click", () => abrirFornecedor(null));
  $("btn-novo-pedido").addEventListener("click", () => abrirPedido());

  if (location.hash === "#novo-pedido") {
    history.replaceState(null, "", location.pathname);
    abrirPedido();
  }

  render();
  Dados.aoMudar(render);
})();
