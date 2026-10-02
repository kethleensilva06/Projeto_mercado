(() => {
  const sessao = App.iniciar({ ativo: "estoque", perfis: ["gerente"] });
  if (!sessao) return;

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DIAS_ALERTA = 30; // validade "próxima" = vence em até 30 dias

  let filtro = "todos";
  let abertos = new Set();  // produtos com detalhes abertos
  let editandoId = null;
  let excluindoId = null;

  // ---------- Utilidades ----------
  function diasAte(isoData) {
    if (!isoData) return null;
    const hoje = new Date(Dados.hojeISO() + "T00:00");
    const alvo = new Date(isoData + "T00:00");
    return Math.round((alvo - hoje) / 86400000);
  }

  function dataBR(isoData) {
    return isoData ? new Date(isoData + "T12:00").toLocaleDateString("pt-BR") : "—";
  }

  function situacaoValidade(p) {
    const d = diasAte(p.validade);
    if (d === null) return null;
    if (d < 0) return { tipo: "danger", texto: d === -1 ? "Venceu ontem" : `Venceu há ${-d} dias` };
    if (d === 0) return { tipo: "danger", texto: "Vence hoje" };
    if (d <= DIAS_ALERTA) return { tipo: "warn", texto: d === 1 ? "Vence amanhã" : `Vence em ${d} dias` };
    return { tipo: "ok", texto: `Vence em ${d} dias` };
  }

  const baixo = p => p.qtd < p.minimo;
  const validadeProxima = p => { const s = situacaoValidade(p); return s && s.tipo !== "ok"; };

  const ICON_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  // ---------- Lista ----------
  function render() {
    const d = Dados.ler();
    const termo = $("busca").value.trim().toLocaleLowerCase("pt-BR");

    const nBaixo = d.produtos.filter(baixo).length;
    const nValidade = d.produtos.filter(validadeProxima).length;
    $("c-todos").textContent = d.produtos.length;
    $("c-baixo").textContent = nBaixo;
    $("c-validade").textContent = nValidade;
    $("resumo").textContent =
      `${d.produtos.length} produtos cadastrados · ${nBaixo} com estoque baixo · ${nValidade} com validade próxima`;

    const lista = d.produtos
      .filter(p => !termo || p.nome.toLocaleLowerCase("pt-BR").includes(termo) || p.categoria.toLocaleLowerCase("pt-BR").includes(termo))
      .filter(p => filtro === "todos" || (filtro === "baixo" ? baixo(p) : validadeProxima(p)))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    $("vazio").hidden = lista.length > 0;
    $("vazio").textContent = termo ? `Nenhum produto encontrado para “${$("busca").value.trim()}”.` : "Nenhum produto neste filtro.";

    $("lista").innerHTML = lista.map(p => {
      const sv = situacaoValidade(p);
      const aberto = abertos.has(p.id);
      const badge = sv && sv.tipo !== "ok" ? `<span class="badge badge-${sv.tipo}">${sv.texto}</span>` : "";
      const low = baixo(p);
      return `
        <tr class="row${aberto ? " open" : ""}" data-id="${p.id}">
          <td class="col-toggle">
            <button type="button" class="row-toggle" data-acao="detalhes" aria-expanded="${aberto}"
                    aria-controls="det-${p.id}" aria-label="Ver compra e validade de ${esc(p.nome)}">${ICON_CHEVRON}</button>
          </td>
          <td class="c-nome"><span class="prod-name">${esc(p.nome)}</span>${badge}</td>
          <td class="c-cat">${esc(p.categoria)}</td>
          <td class="num c-qtd">
            <span class="qty${low ? " low" : ""}"${low ? ` title="Abaixo do mínimo (${p.minimo})"` : ""}>
              ${low ? '<span class="dot-low" aria-hidden="true"></span>' : ""}${p.qtd}${low ? '<span class="sr-only"> (abaixo do mínimo)</span>' : ""}
            </span>
          </td>
          <td class="num c-preco">${App.moeda(p.preco)}</td>
          <td class="c-acoes">
            <div class="actions">
              <button type="button" class="link-btn details-btn" data-acao="detalhes" aria-expanded="${aberto}">${aberto ? "Ocultar" : "Detalhes"}</button>
              <button type="button" class="link-btn" data-acao="editar">Editar</button>
              <button type="button" class="link-btn danger" data-acao="excluir">Excluir</button>
            </div>
          </td>
        </tr>
        ${aberto ? `
        <tr class="details" id="det-${p.id}">
          <td colspan="6">
            <div class="details-grid">
              <div class="detail"><small>Data de compra</small><strong>${dataBR(p.compra)}</strong></div>
              <div class="detail${sv && sv.tipo !== "ok" ? " " + sv.tipo : ""}"><small>Validade</small><strong>${dataBR(p.validade)}</strong></div>
              ${sv ? `<div class="detail${sv.tipo !== "ok" ? " " + sv.tipo : ""}"><small>Situação</small><strong>${sv.texto}</strong></div>` : ""}
              <div class="detail"><small>Estoque mínimo</small><strong>${p.minimo} un.</strong></div>
            </div>
          </td>
        </tr>` : ""}`;
    }).join("");

    $("categorias").innerHTML = [...new Set(d.produtos.map(p => p.categoria))]
      .sort((a, b) => a.localeCompare(b, "pt-BR")).map(c => `<option value="${esc(c)}">`).join("");
  }

  $("lista").addEventListener("click", e => {
    const btn = e.target.closest("[data-acao]");
    if (!btn) return;
    const id = Number(btn.closest("tr").dataset.id);
    if (btn.dataset.acao === "detalhes") {
      abertos.has(id) ? abertos.delete(id) : abertos.add(id);
      render();
      const novo = document.querySelector(`tr[data-id="${id}"] [data-acao="detalhes"]:not([hidden])`);
      if (novo && getComputedStyle(novo).display !== "none") novo.focus();
    }
    if (btn.dataset.acao === "editar") abrirFormulario(id);
    if (btn.dataset.acao === "excluir") abrirExclusao(id);
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

  // ---------- Cadastro / edição ----------
  const modal = $("modal-produto");
  const form = $("form-produto");
  const campos = ["nome", "categoria", "qtd", "minimo", "preco", "compra", "validade"].reduce((o, k) => (o[k] = $("f-" + k), o), {});

  function setErro(el, msg) {
    $(el.id + "-error").textContent = msg;
    el.setAttribute("aria-invalid", msg ? "true" : "false");
  }

  function abrirFormulario(id) {
    const d = Dados.ler();
    const p = id ? d.produtos.find(x => x.id === id) : null;
    editandoId = p ? p.id : null;
    $("modal-titulo").textContent = p ? "Editar produto" : "Novo produto";
    $("btn-salvar").textContent = p ? "Salvar alterações" : "Cadastrar produto";
    campos.nome.value = p ? p.nome : "";
    campos.categoria.value = p ? p.categoria : "";
    campos.qtd.value = p ? p.qtd : "";
    campos.minimo.value = p ? p.minimo : "";
    campos.preco.value = p ? p.preco.toFixed(2).replace(".", ",") : "";
    campos.compra.value = p ? p.compra || "" : Dados.hojeISO();
    campos.validade.value = p ? p.validade || "" : "";
    Object.values(campos).forEach(el => setErro(el, ""));
    modal.showModal();
    campos.nome.focus();
  }

  function lerPreco(txt) {
    const limpo = txt.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
    return /^\d+(\.\d{1,2})?$/.test(limpo) ? Number(limpo) : NaN;
  }

  function validar() {
    const erros = {};
    const nome = campos.nome.value.trim();
    if (!nome) erros.nome = "Informe o nome do produto.";
    else {
      const dup = Dados.ler().produtos.find(p => p.id !== editandoId && p.nome.toLocaleLowerCase("pt-BR") === nome.toLocaleLowerCase("pt-BR"));
      if (dup) erros.nome = "Já existe um produto com esse nome.";
    }
    if (!campos.categoria.value.trim()) erros.categoria = "Informe a categoria.";
    ["qtd", "minimo"].forEach(k => {
      const v = campos[k].value;
      if (v === "" || !/^\d+$/.test(v)) erros[k] = "Use um número inteiro (0 ou mais).";
    });
    const preco = lerPreco(campos.preco.value);
    if (!(preco > 0)) erros.preco = "Informe um preço válido, ex: 8,50.";
    if (campos.compra.value && campos.validade.value && campos.validade.value < campos.compra.value) {
      erros.validade = "A validade não pode ser antes da data de compra.";
    }
    Object.entries(campos).forEach(([k, el]) => setErro(el, erros[k] || ""));
    const primeiro = Object.keys(campos).find(k => erros[k]);
    if (primeiro) campos[primeiro].focus();
    return primeiro ? null : {
      nome, categoria: campos.categoria.value.trim(),
      qtd: Number(campos.qtd.value), minimo: Number(campos.minimo.value), preco,
      compra: campos.compra.value, validade: campos.validade.value,
    };
  }

  form.addEventListener("submit", e => {
    e.preventDefault();
    const dados = validar();
    if (!dados) return;
    const d = Dados.ler();
    if (editandoId) {
      Object.assign(d.produtos.find(p => p.id === editandoId), dados);
    } else {
      const id = d.produtos.reduce((m, p) => Math.max(m, p.id), 0) + 1;
      d.produtos.push({ id, ...dados });
    }
    Dados.salvar(d);
    modal.close();
    App.toast(editandoId ? `“${dados.nome}” foi atualizado.` : `“${dados.nome}” foi cadastrado.`);
    Dados.notificar();
  });

  // Limpa erros ao digitar
  Object.values(campos).forEach(el => el.addEventListener("input", () => {
    if (el.getAttribute("aria-invalid") === "true") setErro(el, "");
  }));

  // ---------- Exclusão ----------
  const modalExcluir = $("modal-excluir");

  function abrirExclusao(id) {
    const p = Dados.ler().produtos.find(x => x.id === id);
    if (!p) return;
    excluindoId = id;
    $("excluir-texto").textContent = `“${p.nome}” será removido do estoque. Esta ação não pode ser desfeita.`;
    modalExcluir.showModal();
    modalExcluir.querySelector("[data-fechar]").focus();
  }

  $("btn-confirmar-excluir").addEventListener("click", () => {
    const d = Dados.ler();
    const p = d.produtos.find(x => x.id === excluindoId);
    d.produtos = d.produtos.filter(x => x.id !== excluindoId);
    abertos.delete(excluindoId);
    Dados.salvar(d);
    modalExcluir.close();
    if (p) App.toast(`“${p.nome}” foi excluído.`);
    Dados.notificar();
  });

  // Fechar modais
  document.querySelectorAll("[data-fechar]").forEach(b =>
    b.addEventListener("click", () => b.closest("dialog").close())
  );

  $("btn-novo").addEventListener("click", () => abrirFormulario(null));

  // Atalho do painel: estoque.html#novo abre o cadastro direto
  if (location.hash === "#novo") {
    history.replaceState(null, "", location.pathname);
    abrirFormulario(null);
  }

  render();
  Dados.aoMudar(render); // venda no caixa ou alteração em outra aba → atualiza a lista
})();
