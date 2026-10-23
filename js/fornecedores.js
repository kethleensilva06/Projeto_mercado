(() => {
  const sessao = App.iniciar({ ativo: "fornecedores", perfis: ["gerente"] });
  if (!sessao) return;

  const $ = id => document.getElementById(id);
  const { esc, dataBR } = App;
  const R = Regras;

  const STATUS = { "em-dia": "Em dia", pendente: "Pendente", atrasado: "Atrasado", "sem-pedidos": "Sem pedidos" };
  const ICON_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_ALERTA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>';

  let filtro = "todos";
  const abertos = new Set();

  // ---------- Regras da tela ----------
  const produtosDe = (d, f) => d.produtos.filter(p => R.fornece(f, p)).sort(R.porNome);
  const emFalta = (d, p) => R.semEstoque(p) || R.baixo(p);
  const temFalta = (d, f) => produtosDe(d, f).some(p => emFalta(d, p));
  const urgencia = p => R.semEstoque(p) ? 0 : R.baixo(p) ? 1 : 2;
  // O que falta e ainda não está pedido (para "Pedir o que falta" e as sugestões)
  const paraPedir = (d, f) => produtosDe(d, f)
    .filter(p => R.precisaRepor(p, d) && !R.jaPedido(d, p) && R.fornecedorDoProduto(d, p)?.id === f.id)
    .sort((a, b) => urgencia(a) - urgencia(b) || R.porNome(a, b));

  function ultimoPedido(d, f) {
    return d.pedidos.filter(p => p.fornecedorId === f.id && p.status !== "cancelado")
      .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id)[0] || null;
  }

  const qtdCurta = (q, unidade) => `${R.numero(q, unidade === "kg")} ${unidade === "kg" ? "kg" : "un."}`;
  const descreverItens = pedido => pedido.itens.map(i => `${qtdCurta(i.qtd, i.unidade)} ${i.nome}`).join(", ");

  function sinal(d, p) {
    if (emFalta(d, p)) return '<span class="dot-low" aria-hidden="true"></span>';
    if (R.avisoAntecipado(p, d)) return '<span class="sinal-aviso" aria-hidden="true"></span>';
    return "";
  }

  // ---------- Sugestões (uma por fornecedor) ----------
  function renderSugestoes(d) {
    const hoje = Dados.hojeISO();
    $("sugestoes").innerHTML = R.ativos(d)
      .map(f => ({ f, itens: paraPedir(d, f) }))
      .filter(s => s.itens.length && d.sugestoesIgnoradas[s.f.id] !== hoje)
      .map(({ f, itens }) => {
        const nomes = itens.slice(0, 3).map(p => `<strong>${esc(p.nome)}</strong> (${R.formatar(R.qtd(p), R.porPeso(p))})`).join(", ") +
          (itens.length > 3 ? ` e mais ${itens.length - 3}` : "");
        return `
        <article class="suggestion">
          <span class="suggestion-icon">${ICON_ALERTA}</span>
          <div class="suggestion-text">
            <small>Sugestão de reposição</small>
            <p>${nomes} ${itens.length === 1 ? "precisa" : "precisam"} de reposição. Criar pedido para <strong>${esc(f.nome)}</strong>?</p>
          </div>
          <div class="suggestion-actions">
            <button type="button" class="btn btn-primary" data-sug="criar" data-fornecedor="${f.id}">Criar pedido</button>
            <button type="button" class="btn btn-ghost" data-sug="ignorar" data-fornecedor="${f.id}">Ignorar hoje</button>
          </div>
        </article>`;
      }).join("");
  }

  $("sugestoes").addEventListener("click", e => {
    const b = e.target.closest("[data-sug]");
    if (!b) return;
    const id = Number(b.dataset.fornecedor);
    const d = Dados.ler();
    if (b.dataset.sug === "criar") {
      const f = d.fornecedores.find(x => x.id === id);
      abrirPedido(id, paraPedir(d, f).map(p => p.id));
    } else {
      d.sugestoesIgnoradas[id] = Dados.hojeISO();
      Dados.salvar(d);
      App.toast("Sugestão ignorada por hoje.");
      Dados.notificar();
    }
  });

  // ---------- Lista ----------
  function situacaoDe(d, f) {
    return Dados.statusFornecedor(d, f.id);
  }

  function passa(d, f, filtroAtual) {
    if (filtroAtual === "desativados") return f.ativo === false;
    if (f.ativo === false) return false;
    if (filtroAtual === "todos") return true;
    if (filtroAtual === "falta") return temFalta(d, f);
    if (filtroAtual === "pendente") return d.pedidos.some(o => o.fornecedorId === f.id && o.status === "pendente");
    if (filtroAtual === "atrasado") return d.pedidos.some(o => o.fornecedorId === f.id && Dados.pedidoAtrasado(o));
    return true;
  }

  function render() {
    const d = Dados.ler();
    renderSugestoes(d);

    const ativos = d.fornecedores.filter(f => f.ativo !== false);
    const pendentes = d.pedidos.filter(o => o.status === "pendente");
    const atrasados = pendentes.filter(Dados.pedidoAtrasado);
    const cont = k => d.fornecedores.filter(f => passa(d, f, k)).length;
    $("k-todos").textContent = ativos.length;
    $("k-pendente").textContent = pendentes.length;
    $("k-atrasado").textContent = atrasados.length;
    $("k-falta").textContent = cont("falta");
    ["todos", "pendente", "atrasado", "falta", "desativados"].forEach(k => { $("c-" + k).textContent = cont(k); });
    document.querySelectorAll(".chip[data-filtro]").forEach(c => {
      c.classList.toggle("active", c.dataset.filtro === filtro);
      c.setAttribute("aria-pressed", String(c.dataset.filtro === filtro));
    });
    document.querySelectorAll(".kpi-q").forEach(b => b.classList.toggle("active", b.dataset.filtro === filtro));
    $("resumo").textContent = `${ativos.length} fornecedores · ${pendentes.length} ${pendentes.length === 1 ? "pedido aguardando" : "pedidos aguardando"} entrega · ${atrasados.length} com atraso`;

    const termo = R.norm($("busca").value);
    const lista = d.fornecedores
      .filter(f => passa(d, f, filtro))
      .filter(f => !termo || [f.nome, f.produtos, f.contato, f.telefone, f.email].some(t => R.norm(t).includes(termo)) ||
        produtosDe(d, f).some(p => R.norm(p.nome).includes(termo)))
      .sort(R.porNome);

    $("vazio").hidden = lista.length > 0;
    $("vazio").textContent = termo ? `Nenhum fornecedor encontrado para “${$("busca").value.trim()}”.` : "Nenhum fornecedor neste filtro.";

    $("lista").innerHTML = lista.map(f => {
      const aberto = abertos.has(f.id);
      const status = situacaoDe(d, f);
      const ultimo = ultimoPedido(d, f);
      const produtos = produtosDe(d, f).sort((a, b) => urgencia(a) - urgencia(b) || R.porNome(a, b));
      const mostrar = produtos.slice(0, 4).map(p => `<span class="prod-chip">${sinal(d, p)}${esc(p.nome)}</span>`).join("") +
        (produtos.length > 4 ? `<span class="prod-chip mais">+${produtos.length - 4}</span>` : "");
      return `
        <tr class="row${aberto ? " open" : ""}${f.ativo === false ? " desativado" : ""}" data-id="${f.id}">
          <td class="c-nome">
            <span class="forn-name">${esc(f.nome)}</span>
            <span class="forn-email">${f.contato ? "Falar com " + esc(f.contato) : f.email ? esc(f.email) : ""}</span>
          </td>
          <td class="c-tel"><span class="tel">${esc(f.telefone)}</span></td>
          <td class="c-prod">${produtos.length ? `<div class="prod-chips">${mostrar}</div>` : `<span class="muted">${esc(f.produtos)}</span>`}</td>
          <td class="c-ult">${ultimo ? dataBR(ultimo.data) : '<span class="muted">—</span>'}</td>
          <td class="c-status">${f.ativo === false ? '<span class="status status-sem-pedidos">Desativado</span>' : `<span class="status status-${status}">${STATUS[status]}</span>`}</td>
          <td class="col-toggle">
            <button type="button" class="row-toggle" data-acao="detalhes" aria-expanded="${aberto}"
                    aria-label="Ver produtos e pedidos de ${esc(f.nome)}">${ICON_CHEVRON}</button>
          </td>
        </tr>
        ${aberto ? `<tr class="details" data-id="${f.id}"><td colspan="6">${detalhes(d, f, produtos)}</td></tr>` : ""}`;
    }).join("");
  }

  function detalhes(d, f, produtos) {
    const falta = paraPedir(d, f);
    const historico = d.pedidos.filter(p => p.fornecedorId === f.id).sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
    const desativado = f.ativo === false;
    return `
      <div class="actions acoes-forn">
        ${desativado ? "" : `
        <button type="button" class="link-btn" data-acao="falta"${falta.length ? "" : " disabled"}>Pedir o que falta${falta.length ? ` (${falta.length})` : ""}</button>
        <button type="button" class="link-btn" data-acao="pedir">+ Novo pedido</button>`}
        <button type="button" class="link-btn" data-acao="editar">Editar</button>
        ${desativado
          ? '<button type="button" class="link-btn" data-acao="reativar">Reativar</button>'
          : `<button type="button" class="link-btn danger" data-acao="excluir">${historico.length ? "Desativar" : "Excluir"}</button>`}
      </div>
      <div class="details-grid">
        <div class="detail"><small>Telefone</small><strong>${esc(f.telefone)}</strong></div>
        <div class="detail"><small>WhatsApp</small><strong>${esc(f.whatsapp || f.telefone)}</strong></div>
        <div class="detail"><small>E-mail</small><strong>${f.email ? esc(f.email) : "—"}</strong></div>
        <div class="detail"><small>Entrega</small><strong>${R.prazoFornecedor(f)} dias · pedidos por ${f.envio === "email" ? "e-mail" : "WhatsApp"}</strong></div>
        ${f.observacao ? `<div class="detail"><small>Observação</small><strong>${esc(f.observacao)}</strong></div>` : ""}
      </div>
      <div class="contato-rapido">
        <span>Contato rápido:</span>
        <a class="link-btn" href="${R.linkWhatsapp(f, saudacao(f))}" target="_blank" rel="noopener">WhatsApp</a>
        ${f.email ? `<a class="link-btn" href="${R.linkEmail(f, "Mercado", saudacao(f))}">E-mail</a>` : ""}
        <button type="button" class="link-btn" data-acao="copiar">Copiar telefone</button>
      </div>
      <p class="history-title">Produtos (${produtos.length})</p>
      ${produtos.length ? `<div class="prod-lista">${produtos.map(p => `
        <span class="prod-item">${sinal(d, p)}<strong>${esc(p.nome)}</strong>
          <small>${R.formatar(R.qtd(p), R.porPeso(p))} · mín. ${R.numero(p.minimo, R.porPeso(p))}${R.jaPedido(d, p) ? " · já pedido" : ""}</small></span>`).join("")}</div>`
        : '<p class="history-empty">Nenhum produto ligado. Cadastre a categoria em “O que entrega” ou escolha este fornecedor no cadastro do produto.</p>'}
      <p class="history-title">Histórico de pedidos</p>
      ${historico.length ? `
      <table class="history">
        <thead><tr><th>Data</th><th>Itens</th><th>Entrega</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          ${historico.map(p => {
            const atrasado = Dados.pedidoAtrasado(p);
            const sit = p.status === "entregue" ? "em-dia" : p.status === "cancelado" ? "sem-pedidos" : atrasado ? "atrasado" : "pendente";
            const sitTxt = p.status === "entregue" ? "Entregue" : p.status === "cancelado" ? "Cancelado" : atrasado ? "Atrasado" : "Aguardando";
            const entrega = p.status === "entregue" ? `Entregue em ${dataBR(p.entregue)}` : p.status === "cancelado" ? "—" : `Previsto para ${dataBR(p.previsao)}`;
            const diferente = p.status === "entregue" ? p.itens.filter(i => i.recebida !== null && i.recebida !== i.qtd)
              .map(i => i.recebida === 0 ? `${i.nome} não veio` : `${i.nome}: veio ${qtdCurta(i.recebida, i.unidade)}`) : [];
            return `<tr data-pedido="${p.id}">
              <td>${dataBR(p.data)}</td>
              <td>${esc(descreverItens(p))}${diferente.length ? `<br><small class="diferenca">${esc(diferente.join(" · "))}</small>` : ""}${p.observacao ? `<br><small class="muted">${esc(p.observacao)}</small>` : ""}</td>
              <td>${entrega}</td>
              <td><span class="status status-${sit}">${sitTxt}</span></td>
              <td class="acoes-pedido">${p.status === "pendente" ? `
                <button type="button" class="link-btn" data-acao="entrega">Registrar entrega</button>
                <button type="button" class="link-btn" data-acao="reenviar">Reenviar</button>
                <button type="button" class="link-btn danger" data-acao="cancelar">Cancelar</button>` : ""}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>` : '<p class="history-empty">Nenhum pedido feito para este fornecedor ainda.</p>'}`;
  }

  const saudacao = f => `Olá${f.contato ? ", " + f.contato.trim() : ""}! Aqui é ${sessao.nome}, do Mercado.`;

  $("lista").addEventListener("click", e => {
    const btn = e.target.closest("button[data-acao]");
    const linha = e.target.closest("tr.row");
    if (!btn && linha && !e.target.closest("a")) return alternar(Number(linha.dataset.id));
    if (!btn) return;
    const id = Number(btn.closest("[data-id]").dataset.id);
    const pedidoId = btn.closest("[data-pedido]") ? Number(btn.closest("[data-pedido]").dataset.pedido) : null;
    const d = Dados.ler();
    const f = d.fornecedores.find(x => x.id === id);
    switch (btn.dataset.acao) {
      case "detalhes": return alternar(id);
      case "falta": return abrirPedido(id, paraPedir(d, f).map(p => p.id));
      case "pedir": return abrirPedido(id, []);
      case "editar": return abrirFornecedor(id);
      case "excluir": return confirmarExclusao(f);
      case "reativar": return reativar(f);
      case "copiar": return copiar(f.whatsapp || f.telefone, "Telefone copiado.");
      case "entrega": return abrirEntrega(pedidoId);
      case "reenviar": return abrirEnvio(pedidoId, "Reenviar pedido");
      case "cancelar": return confirmarCancelamento(pedidoId);
    }
  });

  function alternar(id) {
    abertos.has(id) ? abertos.delete(id) : abertos.add(id);
    render();
    const b = document.querySelector(`tr.row[data-id="${id}"] .row-toggle`);
    if (b) b.focus();
  }

  $("busca").addEventListener("input", render);
  document.querySelectorAll("[data-filtro]").forEach(b => b.addEventListener("click", () => { filtro = b.dataset.filtro; render(); }));

  async function copiar(texto, aviso) {
    try { await navigator.clipboard.writeText(texto); App.toast(aviso); }
    catch (_) { App.toast("Não foi possível copiar. Selecione o texto e use Ctrl+C."); }
  }

  // ---------- Utilidades de formulário ----------
  function setErro(el, msg) {
    const erro = $(el.id + "-error");
    if (erro) erro.textContent = msg;
    el.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  document.querySelectorAll("dialog input, dialog select, dialog textarea").forEach(el =>
    el.addEventListener("input", () => { if (el.getAttribute("aria-invalid") === "true") setErro(el, ""); }));
  document.querySelectorAll("[data-fechar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

  // ---------- Cadastro / edição de fornecedor ----------
  const mf = $("modal-fornecedor");
  const cf = ["nome", "telefone", "whatsapp", "email", "contato", "produtos", "prazo", "modelo", "observacao"]
    .reduce((o, k) => (o[k] = $("f-" + k), o), {});
  let editandoId = null;
  cf.telefone.addEventListener("input", () => { cf.telefone.value = R.mascaraTelefone(cf.telefone.value); });
  cf.whatsapp.addEventListener("input", () => { cf.whatsapp.value = R.mascaraTelefone(cf.whatsapp.value); });
  $("f-modelo-padrao").addEventListener("click", () => { cf.modelo.value = R.MODELO_PADRAO; });

  function renderCategorias() {
    const d = Dados.ler();
    const usadas = R.categoriasDe({ produtos: cf.produtos.value }).map(R.norm);
    $("f-categorias").innerHTML = [...new Set(d.produtos.map(p => p.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR"))
      .filter(c => !usadas.includes(R.norm(c)))
      .map(c => `<button type="button" class="chip" data-categoria="${esc(c)}">+ ${esc(c)}</button>`).join("");
  }
  cf.produtos.addEventListener("input", renderCategorias);
  $("f-categorias").addEventListener("click", e => {
    const b = e.target.closest("[data-categoria]");
    if (!b) return;
    cf.produtos.value = [...R.categoriasDe({ produtos: cf.produtos.value }), b.dataset.categoria].join(", ");
    setErro(cf.produtos, "");
    renderCategorias();
  });

  function abrirFornecedor(id) {
    const f = id ? Dados.ler().fornecedores.find(x => x.id === id) : null;
    editandoId = f ? f.id : null;
    $("mf-titulo").textContent = f ? "Editar fornecedor" : "Novo fornecedor";
    $("mf-salvar").textContent = f ? "Salvar alterações" : "Cadastrar fornecedor";
    Object.entries(cf).forEach(([k, el]) => { el.value = f ? (f[k] ?? "") : ""; setErro(el, ""); });
    cf.modelo.value = f && f.modelo ? f.modelo : R.MODELO_PADRAO;
    document.querySelector(`input[name="envio"][value="${f ? f.envio : "whatsapp"}"]`).checked = true;
    $("f-envio-error").textContent = "";
    renderCategorias();
    mf.showModal();
    cf.nome.focus();
  }

  $("form-fornecedor").addEventListener("submit", e => {
    e.preventDefault();
    const d = Dados.ler();
    const envio = document.querySelector('input[name="envio"]:checked').value;
    const v = {
      nome: cf.nome.value.trim(), telefone: cf.telefone.value.trim(), whatsapp: cf.whatsapp.value.trim(), email: cf.email.value.trim(),
      contato: cf.contato.value.trim(), produtos: R.categoriasDe({ produtos: cf.produtos.value }).join(", "),
      prazo: cf.prazo.value.trim() ? Number(cf.prazo.value) : null, envio,
      modelo: cf.modelo.value.trim() === R.MODELO_PADRAO.trim() ? "" : cf.modelo.value, observacao: cf.observacao.value.trim(),
    };
    const erros = {};
    if (!v.nome) erros.nome = "Informe o nome do fornecedor.";
    else if (d.fornecedores.some(f => f.id !== editandoId && R.norm(f.nome) === R.norm(v.nome))) erros.nome = "Já existe um fornecedor com esse nome.";
    if (R.soDigitos(v.telefone).length < 10) erros.telefone = "Informe o telefone com DDD.";
    if (v.whatsapp && R.soDigitos(v.whatsapp).length < 10) erros.whatsapp = "Informe o WhatsApp com DDD (ou deixe vazio).";
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) erros.email = "E-mail inválido.";
    if (!v.produtos) erros.produtos = "Informe o que esse fornecedor entrega.";
    if (cf.prazo.value.trim() && !(/^\d+$/.test(cf.prazo.value.trim()) && v.prazo >= 1)) erros.prazo = "Use um número de dias (1 ou mais).";
    if (!cf.modelo.value.includes("{itens}")) erros.modelo = "A mensagem precisa ter {itens} para a lista de produtos.";
    Object.entries(cf).forEach(([k, el]) => setErro(el, erros[k] || ""));
    $("f-envio-error").textContent = envio === "email" && !v.email ? "Para enviar por e-mail, cadastre o e-mail." : "";
    const primeiro = Object.keys(cf).find(k => erros[k]);
    if (primeiro) return cf[primeiro].focus();
    if ($("f-envio-error").textContent) return cf.email.focus();

    if (editandoId) Object.assign(d.fornecedores.find(f => f.id === editandoId), v);
    else d.fornecedores.push({ id: Dados.proximoId(d.fornecedores), ativo: true, ...v });
    Dados.salvar(d);
    mf.close();
    App.toast(editandoId ? `“${v.nome}” foi atualizado.` : `“${v.nome}” foi cadastrado.`);
    Dados.notificar();
  });

  // ---------- Confirmação (excluir, desativar, cancelar) ----------
  const mc = $("modal-confirmar");
  let acaoConfirmar = null;
  function confirmar(titulo, texto, botao, voltar, acao) {
    $("mc-titulo").textContent = titulo;
    $("mc-texto").textContent = texto;
    $("mc-confirmar").textContent = botao;
    $("mc-voltar").textContent = voltar;
    acaoConfirmar = acao;
    mc.showModal();
    $("mc-voltar").focus();
  }
  $("mc-confirmar").addEventListener("click", () => {
    const d = Dados.ler();
    const msg = acaoConfirmar(d);
    Dados.salvar(d);
    mc.close();
    App.toast(msg);
    Dados.notificar();
  });

  // Com pedidos, o fornecedor não é apagado: fica desativado e o histórico continua.
  function confirmarExclusao(f) {
    const d = Dados.ler();
    const temPedidos = d.pedidos.some(p => p.fornecedorId === f.id);
    if (temPedidos) {
      confirmar("Desativar fornecedor?", `“${f.nome}” tem pedidos no histórico, então não é apagado: fica desativado, sai das sugestões e dos pedidos novos, e o histórico continua. Dá para reativar depois.`,
        "Desativar", "Cancelar", dd => { dd.fornecedores.find(x => x.id === f.id).ativo = false; abertos.delete(f.id); return `“${f.nome}” foi desativado.`; });
    } else {
      confirmar("Excluir fornecedor?", `“${f.nome}” será removido. Os produtos ligados a ele ficam sem fornecedor principal. Esta ação não pode ser desfeita.`,
        "Excluir", "Cancelar", dd => {
          dd.fornecedores = dd.fornecedores.filter(x => x.id !== f.id);
          dd.produtos.forEach(p => { if (p.fornecedorId === f.id) p.fornecedorId = null; });
          abertos.delete(f.id);
          return `“${f.nome}” foi excluído.`;
        });
    }
  }

  function reativar(f) {
    const d = Dados.ler();
    d.fornecedores.find(x => x.id === f.id).ativo = true;
    Dados.salvar(d);
    App.toast(`“${f.nome}” foi reativado.`);
    Dados.notificar();
  }

  function confirmarCancelamento(pedidoId) {
    const d = Dados.ler();
    const p = d.pedidos.find(x => x.id === pedidoId);
    const f = d.fornecedores.find(x => x.id === p.fornecedorId);
    confirmar("Cancelar pedido?", `O pedido de ${dataBR(p.data)} para ${f.nome} (${descreverItens(p)}) fica no histórico como cancelado. Avise o fornecedor se ele já estiver separando a mercadoria.`,
      "Cancelar pedido", "Voltar", dd => { dd.pedidos.find(x => x.id === pedidoId).status = "cancelado"; return "Pedido cancelado."; });
  }

  // ---------- Novo pedido ----------
  const mp = $("modal-pedido");
  const cp = { fornecedor: $("p-fornecedor"), busca: $("p-busca"), previsao: $("p-previsao"), observacao: $("p-observacao") };
  let itens = [];                 // [{ produtoId, qtd (texto) }]
  let previsaoAutomatica = null;

  const fornecedorEscolhido = d => d.fornecedores.find(x => x.id === Number(cp.fornecedor.value)) || null;

  function abrirPedido(fornecedorId = null, produtoIds = []) {
    const d = Dados.ler();
    if (!R.ativos(d).length) return App.toast("Cadastre um fornecedor antes de criar pedidos.");
    cp.fornecedor.innerHTML = '<option value="">Selecione o fornecedor</option>' +
      R.ativos(d).map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join("");
    cp.fornecedor.value = fornecedorId || "";
    itens = produtoIds.map(id => ({ produtoId: id, qtd: R.paraCampo(R.qtdSugerida(d.produtos.find(p => p.id === id))) }));
    cp.busca.value = "";
    cp.observacao.value = "";
    cp.previsao.value = "";
    previsaoAutomatica = null;
    Object.values(cp).forEach(el => setErro(el, ""));
    renderPedido();
    mp.showModal();
    (!fornecedorId ? cp.fornecedor : itens.length ? mp.querySelector(".item-qtd") : cp.busca).focus();
  }

  // Previsão = hoje + maior prazo entre os itens (prazo do produto ou do fornecedor), até a pessoa mudar a data.
  function preencherPrevisao(d) {
    const f = fornecedorEscolhido(d);
    const prazos = itens.map(i => d.produtos.find(p => p.id === i.produtoId)).filter(Boolean).map(p => p.prazo || R.prazoFornecedor(f));
    const prazo = prazos.length ? Math.max(...prazos) : R.prazoFornecedor(f);
    if (cp.previsao.value && cp.previsao.value !== previsaoAutomatica) return;
    cp.previsao.value = previsaoAutomatica = Dados.dia(prazo);
    $("p-previsao-dica").textContent = f ? `Hoje + ${prazo} ${prazo === 1 ? "dia" : "dias"} (${f.prazo ? `prazo de ${f.nome}` : "prazo padrão"}).` : "";
  }

  function renderPedido() {
    const d = Dados.ler();
    const f = fornecedorEscolhido(d);
    $("p-itens").innerHTML = itens.map((i, n) => {
      const p = d.produtos.find(x => x.id === i.produtoId);
      if (!p) return "";
      const kg = R.porPeso(p);
      const situacao = R.semEstoque(p) ? ["sem estoque", "erro"] : R.baixo(p) ? ["estoque baixo", "erro"] : R.avisoAntecipado(p, d) ? ["chegando no mínimo", "ambar"] : ["", ""];
      return `<div class="item-pedido" data-n="${n}">
        <div class="item-nome"><strong>${esc(p.nome)}</strong>
          <small class="${situacao[1]}">Estoque: ${R.formatar(R.qtd(p), kg)} (mín. ${R.numero(p.minimo, kg)})${!kg && p.porCaixa > 1 ? ` · caixa com ${R.numero(p.porCaixa)}` : ""}${situacao[0] ? " · " + situacao[0] : ""}${R.jaPedido(d, p) ? " · já tem pedido pendente" : ""}</small></div>
        <div class="item-campo">
          <input class="item-qtd" inputmode="decimal" value="${esc(i.qtd)}" aria-label="Quantidade de ${esc(p.nome)}">
          <span>${R.sigla(p)}</span>
          <span class="field-error item-erro"></span>
        </div>
        <button type="button" class="icon-btn" data-tirar="${n}" aria-label="Tirar ${esc(p.nome)} do pedido">×</button>
      </div>`;
    }).join("");
    $("p-sem-itens").hidden = itens.length > 0;
    const falta = f ? paraPedir(d, f).filter(p => !itens.some(i => i.produtoId === p.id)) : [];
    $("p-falta").hidden = falta.length === 0;
    $("p-falta").textContent = `Adicionar tudo que falta (${falta.length})`;
    preencherPrevisao(d);
    renderResultados();
    atualizarPrevia();
  }

  function renderResultados() {
    const d = Dados.ler();
    const f = fornecedorEscolhido(d);
    const termo = R.norm(cp.busca.value);
    if (!termo) { $("p-resultados").innerHTML = ""; return; }
    const achados = d.produtos
      .filter(p => !itens.some(i => i.produtoId === p.id))
      .filter(p => R.norm(p.nome).includes(termo) || R.norm(p.categoria).includes(termo) || (p.codigo || "").includes(termo))
      .sort((a, b) => (f && R.fornece(f, b) ? 1 : 0) - (f && R.fornece(f, a) ? 1 : 0) || R.porNome(a, b))
      .slice(0, 6);
    $("p-resultados").innerHTML = achados.length ? achados.map(p => `
      <button type="button" class="resultado" data-produto="${p.id}">
        <span>${sinal(d, p)}<strong>${esc(p.nome)}</strong> <small class="muted">${esc(p.categoria)}${f && R.fornece(f, p) ? " · deste fornecedor" : ""}</small></span>
        <small>${R.formatar(R.qtd(p), R.porPeso(p))}</small>
      </button>`).join("") : '<p class="history-empty">Nenhum produto encontrado.</p>';
  }

  function adicionar(produtoId) {
    const d = Dados.ler();
    if (!itens.some(i => i.produtoId === produtoId)) {
      itens.push({ produtoId, qtd: R.paraCampo(R.qtdSugerida(d.produtos.find(p => p.id === produtoId))) });
    }
    cp.busca.value = "";
    setErro(cp.busca, "");
    renderPedido();
    const campos = mp.querySelectorAll(".item-qtd");
    const campo = campos[itens.findIndex(i => i.produtoId === produtoId)];
    if (campo) { campo.focus(); campo.select(); }
  }

  function atualizarPrevia() {
    const d = Dados.ler();
    const f = fornecedorEscolhido(d);
    $("p-previa").textContent = f
      ? R.mensagemPedido(f, linhasMensagem(d), cp.previsao.value, sessao.nome)
      : "Escolha o fornecedor para ver a mensagem.";
  }

  const linhasMensagem = d => itens.map(i => {
    const p = d.produtos.find(x => x.id === i.produtoId);
    const q = R.lerQtd(i.qtd, R.porPeso(p));
    return { nome: p.nome, unidade: p.unidade, qtd: isNaN(q) ? 0 : q, porCaixa: p.porCaixa };
  });

  cp.fornecedor.addEventListener("change", () => { setErro(cp.fornecedor, ""); renderPedido(); });
  cp.busca.addEventListener("input", renderResultados);
  cp.busca.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const texto = cp.busca.value.trim();
    if (!texto) return;
    const d = Dados.ler();
    // Leitor na caixa: código exato; senão o primeiro resultado da busca
    const p = R.porCodigo(d.produtos, texto) || null;
    if (p) return adicionar(p.id);
    const primeiro = $("p-resultados").querySelector("[data-produto]");
    if (primeiro) return adicionar(Number(primeiro.dataset.produto));
    setErro(cp.busca, /^\d+$/.test(texto) ? `Nenhum produto com o código ${texto}.` : "Nenhum produto encontrado.");
  });
  cp.previsao.addEventListener("input", () => { $("p-previsao-dica").textContent = ""; atualizarPrevia(); });
  $("p-resultados").addEventListener("click", e => {
    const b = e.target.closest("[data-produto]");
    if (b) adicionar(Number(b.dataset.produto));
  });
  $("p-itens").addEventListener("input", e => {
    if (!e.target.classList.contains("item-qtd")) return;
    itens[Number(e.target.closest("[data-n]").dataset.n)].qtd = e.target.value;
    e.target.removeAttribute("aria-invalid");
    e.target.parentElement.querySelector(".item-erro").textContent = "";
    atualizarPrevia();
  });
  $("p-itens").addEventListener("click", e => {
    const b = e.target.closest("[data-tirar]");
    if (!b) return;
    itens.splice(Number(b.dataset.tirar), 1);
    renderPedido();
  });
  $("p-falta").addEventListener("click", () => {
    const d = Dados.ler();
    paraPedir(d, fornecedorEscolhido(d)).forEach(p => {
      if (!itens.some(i => i.produtoId === p.id)) itens.push({ produtoId: p.id, qtd: R.paraCampo(R.qtdSugerida(p)) });
    });
    renderPedido();
  });

  $("form-pedido").addEventListener("submit", e => {
    e.preventDefault();
    const d = Dados.ler();
    const f = fornecedorEscolhido(d);
    let ok = true;
    if (!f) { setErro(cp.fornecedor, "Escolha o fornecedor."); ok = false; }
    if (!itens.length) { setErro(cp.busca, "Adicione pelo menos um produto."); ok = false; }
    mp.querySelectorAll(".item-pedido").forEach(el => {
      const i = itens[Number(el.dataset.n)];
      const p = d.produtos.find(x => x.id === i.produtoId);
      const q = R.lerQtd(i.qtd, R.porPeso(p));
      if (!(q > 0)) {
        const campo = el.querySelector(".item-qtd");
        campo.setAttribute("aria-invalid", "true");
        el.querySelector(".item-erro").textContent = R.porPeso(p) ? "Use um peso, ex: 12,5" : "Use 1 ou mais";
        if (ok) campo.focus();
        ok = false;
      }
    });
    if (!cp.previsao.value) { setErro(cp.previsao, "Informe a previsão de entrega."); ok = false; }
    else if (cp.previsao.value < Dados.hojeISO()) { setErro(cp.previsao, "A previsão não pode ser no passado."); ok = false; }
    if (!ok) return;

    const pedido = {
      id: Dados.proximoId(d.pedidos), fornecedorId: f.id, data: Dados.hojeISO(), previsao: cp.previsao.value,
      status: "pendente", observacao: cp.observacao.value.trim(),
      itens: itens.map(i => {
        const p = d.produtos.find(x => x.id === i.produtoId);
        return { produtoId: p.id, nome: p.nome, unidade: p.unidade, qtd: R.lerQtd(i.qtd, R.porPeso(p)), recebida: null };
      }),
    };
    d.pedidos.push(pedido);
    Dados.salvar(d);
    mp.close();
    abertos.add(f.id);
    Dados.notificar();
    abrirEnvio(pedido.id, "Pedido criado");
  });

  // ---------- Envio pelo WhatsApp / e-mail ----------
  const me = $("modal-envio");
  let fornecedorEnvio = null;
  let pedidoEnvio = null;

  function abrirEnvio(pedidoId, titulo) {
    const d = Dados.ler();
    const p = d.pedidos.find(x => x.id === pedidoId);
    const f = d.fornecedores.find(x => x.id === p.fornecedorId);
    fornecedorEnvio = f;
    pedidoEnvio = p;
    $("me-titulo").textContent = titulo;
    $("me-sub").textContent = `${f.nome} · ${descreverItens(p)}`;
    $("me-mensagem").value = R.mensagemPedido(f, p.itens.map(i => ({ ...i, porCaixa: d.produtos.find(x => x.id === i.produtoId)?.porCaixa })), p.previsao, sessao.nome);
    // O meio preferido fica como botão principal; o outro continua disponível
    const email = f.envio === "email" && f.email;
    $("me-whatsapp").className = "btn " + (email ? "btn-ghost" : "btn-primary");
    $("me-email").className = "btn " + (email ? "btn-primary" : "btn-ghost");
    $("me-email").hidden = !f.email;
    $("me-botoes").classList.toggle("invertido", !!email);
    atualizarLinks();
    me.showModal();
    (email ? $("me-email") : $("me-whatsapp")).focus();
  }

  function atualizarLinks() {
    const texto = $("me-mensagem").value;
    $("me-whatsapp").href = R.linkWhatsapp(fornecedorEnvio, texto);
    $("me-email").href = R.linkEmail(fornecedorEnvio, `Pedido de ${dataBR(pedidoEnvio.data)} - Mercado`, texto);
  }
  $("me-mensagem").addEventListener("input", atualizarLinks);
  $("me-copiar").addEventListener("click", () => copiar($("me-mensagem").value, "Mensagem copiada."));

  // ---------- Registrar entrega ----------
  const mr = $("modal-entrega");
  let pedidoEntrega = null;

  function abrirEntrega(pedidoId) {
    const d = Dados.ler();
    const p = d.pedidos.find(x => x.id === pedidoId);
    if (!p || p.status !== "pendente") return App.toast("Este pedido não está mais pendente.");
    const f = d.fornecedores.find(x => x.id === p.fornecedorId);
    pedidoEntrega = p.id;
    $("mr-sub").textContent = `${f ? f.nome : "Fornecedor"} · pedido de ${dataBR(p.data)}`;
    $("r-data").value = Dados.hojeISO();
    setErro($("r-data"), "");
    $("r-itens").innerHTML = p.itens.map((i, n) => {
      const prod = d.produtos.find(x => x.id === i.produtoId);
      const dias = prod ? R.diasValidadeSugerida(prod) : null;
      return `<tr data-n="${n}">
        <td><strong>${esc(i.nome)}</strong><br><small class="muted">Pedido: ${qtdCurta(i.qtd, i.unidade)}${prod ? "" : " · produto removido do estoque"}</small></td>
        <td><input class="r-qtd" inputmode="decimal" value="${R.paraCampo(i.qtd)}" aria-label="Quanto chegou de ${esc(i.nome)}"${prod ? "" : " disabled"}> ${i.unidade === "kg" ? "kg" : "un."}
            <span class="field-error r-erro"></span></td>
        <td><input class="r-validade" type="date" data-dias="${dias || ""}" value="${dias ? Dados.dia(dias) : ""}" aria-label="Validade de ${esc(i.nome)}"${prod ? "" : " disabled"}></td>
      </tr>`;
    }).join("");
    mr.showModal();
    mr.querySelector(".r-qtd:not([disabled])")?.focus();
  }

  // A data da entrega muda a validade que veio pela validade padrão
  $("r-data").addEventListener("input", () => {
    mr.querySelectorAll(".r-validade").forEach(v => {
      if (v.dataset.dias && $("r-data").value && !v.dataset.mudou) v.value = Dados.somarDias($("r-data").value, Number(v.dataset.dias));
    });
  });
  $("r-itens").addEventListener("input", e => {
    if (e.target.classList.contains("r-validade")) e.target.dataset.mudou = "1";
    if (e.target.classList.contains("r-qtd")) { e.target.removeAttribute("aria-invalid"); e.target.parentElement.querySelector(".r-erro").textContent = ""; }
  });

  $("form-entrega").addEventListener("submit", e => {
    e.preventDefault();
    const d = Dados.ler();
    const p = d.pedidos.find(x => x.id === pedidoEntrega);
    const data = $("r-data").value;
    let ok = true;
    if (!data) { setErro($("r-data"), "Informe a data da entrega."); ok = false; }
    else if (data > Dados.hojeISO()) { setErro($("r-data"), "A entrega não pode ser no futuro."); ok = false; }
    const leituras = [...mr.querySelectorAll("#r-itens tr")].map(tr => {
      const i = p.itens[Number(tr.dataset.n)];
      const campo = tr.querySelector(".r-qtd");
      if (campo.disabled) return { i, q: 0, validade: "" };
      const q = R.lerQtd(campo.value, i.unidade === "kg");
      if (isNaN(q)) {
        campo.setAttribute("aria-invalid", "true");
        tr.querySelector(".r-erro").textContent = "Quantidade inválida (0 = não veio)";
        ok = false;
      }
      const validade = tr.querySelector(".r-validade").value;
      if (validade && data && validade < data) { tr.querySelector(".r-erro").textContent = "Validade antes da entrega"; ok = false; }
      return { i, q, validade };
    });
    if (!ok) return;
    if (leituras.every(l => l.q === 0)) return App.toast("Nada chegou? Use “Cancelar” no pedido em vez de registrar a entrega.");

    // Tudo ou nada: um lote por item recebido, com data de compra = data da entrega
    let loteId = Dados.proximoId(d.produtos.flatMap(x => x.lotes));
    leituras.forEach(({ i, q, validade }) => {
      i.recebida = q;
      const prod = d.produtos.find(x => x.id === i.produtoId);
      if (prod && q > 0) prod.lotes.push({ id: loteId++, inicial: q, restante: q, compra: data, validade });
    });
    p.status = "entregue";
    p.entregue = data;
    Dados.salvar(d);
    mr.close();
    App.toast(`Entrega registrada: ${leituras.filter(l => l.q > 0).length} ${leituras.filter(l => l.q > 0).length === 1 ? "lote entrou" : "lotes entraram"} no estoque.`);
    Dados.notificar();
  });

  // ---------- Início ----------
  $("btn-novo").addEventListener("click", () => abrirFornecedor(null));
  $("btn-novo-pedido").addEventListener("click", () => abrirPedido());

  render();
  Dados.aoMudar(render);

  // Atalhos: fornecedores.html#novo-pedido (Painel) e #entrega-ID (leitor do Estoque)
  const hash = location.hash;
  if (hash) history.replaceState(null, "", location.pathname);
  if (hash === "#novo-pedido") abrirPedido();
  const entrega = /^#entrega-(\d+)$/.exec(hash);
  if (entrega) {
    const p = Dados.ler().pedidos.find(x => x.id === Number(entrega[1]));
    if (p) { abertos.add(p.fornecedorId); render(); abrirEntrega(p.id); }
  }
})();
