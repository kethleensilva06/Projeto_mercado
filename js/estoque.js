(() => {
  const sessao = App.iniciar({ ativo: "estoque", perfis: ["gerente"] });
  if (!sessao) return;

  const $ = id => document.getElementById(id);
  const { esc, dataBR } = App;
  const R = Regras;

  const ICON_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_ALERTA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>';

  // Filtros em uso (mesmas opções da janela de filtros do programa)
  const SITUACOES = {
    baixo: ["Estoque baixo", p => R.baixo(p)],
    repor: ["Repor em breve", (p, d) => R.avisoAntecipado(p, d)],
    sem: ["Sem estoque", p => R.semEstoque(p)],
    validade: ["Validade próxima", p => R.validadeProxima(p)],
    vencidos: ["Vencidos", p => R.vencido(p)],
    semcodigo: ["Sem código de barras", p => !p.codigo],
  };
  const TIPOS = { un: ["Por unidade", p => !R.porPeso(p)], kg: ["Por quilo", p => R.porPeso(p)] };
  const ORDENS = { nome: "Nome (A-Z)", validade: "Validade mais próxima", quantidade: "Menor quantidade" };
  const filtros = { situacao: "", categoria: "", tipo: "", ordem: "nome" };

  const abertos = new Set();
  let excluir = null;   // { tipo: "produto" | "lote", produtoId, loteId }

  // ---------- Lista ----------
  function passa(p, d, f = filtros, termo = "") {
    if (f.situacao && !SITUACOES[f.situacao][1](p, d)) return false;
    if (f.categoria && R.norm(p.categoria) !== R.norm(f.categoria)) return false;
    if (f.tipo && !TIPOS[f.tipo][1](p)) return false;
    if (termo && !(R.norm(p.nome).includes(termo) || R.norm(p.categoria).includes(termo) || (p.codigo || "").includes(termo))) return false;
    return true;
  }

  function ordenar(lista) {
    if (filtros.ordem === "validade") return lista.sort((a, b) => (R.proximaValidade(a) || "9999").localeCompare(R.proximaValidade(b) || "9999") || R.porNome(a, b));
    if (filtros.ordem === "quantidade") return lista.sort((a, b) => R.qtd(a) - R.qtd(b) || R.porNome(a, b));
    return lista.sort(R.porNome);
  }

  function sinalQuantidade(p, d) {
    if (R.semEstoque(p) || R.baixo(p)) {
      const t = R.semEstoque(p) ? "Sem estoque" : `Abaixo do mínimo (${R.formatar(p.minimo, R.porPeso(p))})`;
      return `<span class="qty low" title="${t}"><span class="dot-low" aria-hidden="true"></span>${R.formatar(R.qtd(p), R.porPeso(p))}<span class="sr-only"> (${t})</span></span>`;
    }
    if (R.avisoAntecipado(p, d)) {
      const t = `Chegando no mínimo: aviso em ${R.formatar(R.limiteAviso(p, d), R.porPeso(p))}. Hora de pedir.`;
      return `<span class="qty" title="${t}"><span class="sinal-aviso" aria-hidden="true"></span>${R.formatar(R.qtd(p), R.porPeso(p))}<span class="sr-only"> (${t})</span></span>`;
    }
    return `<span class="qty">${R.formatar(R.qtd(p), R.porPeso(p))}</span>`;
  }

  function alertaValidade(sv) {
    if (!sv || sv.nivel === "ok") return "";
    return `<span class="alerta-validade ${sv.nivel}" title="${sv.texto}">${ICON_ALERTA}<span class="sr-only">${sv.texto}</span></span>`;
  }

  function render() {
    const d = Dados.ler();
    const termo = R.norm($("busca").value);
    const total = d.produtos.length;

    $("k-total").textContent = total;
    $("k-baixo").textContent = d.produtos.filter(R.baixo).length;
    $("k-sem").textContent = d.produtos.filter(R.semEstoque).length;
    $("k-validade").textContent = d.produtos.filter(R.validadeProxima).length;
    $("k-vencidos").textContent = d.produtos.filter(R.vencido).length;
    document.querySelectorAll(".kpi-q").forEach(b => b.classList.toggle("active", b.dataset.situacao === filtros.situacao && (!!filtros.situacao || nFiltros() === 0)));

    const lista = ordenar(d.produtos.filter(p => passa(p, d, filtros, termo)));
    const nBaixo = d.produtos.filter(p => R.baixo(p) || R.semEstoque(p)).length;
    const nValidade = d.produtos.filter(p => R.validadeProxima(p) || R.vencido(p)).length;
    $("resumo").textContent = `${total} produtos cadastrados · ${nBaixo} abaixo do mínimo ou zerados · ${nValidade} com validade próxima ou vencida`;

    renderFiltrosAtivos(lista.length, total);
    $("vazio").hidden = lista.length > 0;
    $("vazio").textContent = termo ? `Nenhum produto encontrado para “${$("busca").value.trim()}”.` : "Nenhum produto neste filtro.";

    $("lista").innerHTML = lista.map(p => {
      const aberto = abertos.has(p.id);
      const sv = R.situacaoProduto(p);
      return `
        <tr class="row${aberto ? " open" : ""}" data-id="${p.id}">
          <td class="c-nome"><span class="prod-name">${esc(p.nome)}</span></td>
          <td class="c-cat">${R.pilulaCategoria(p.categoria)}</td>
          <td class="num c-qtd">${sinalQuantidade(p, d)}</td>
          <td class="num c-preco">${App.moeda(p.preco)}${R.porPeso(p) ? '<small class="muted"> /kg</small>' : ""}</td>
          <td class="c-alerta">${alertaValidade(sv)}</td>
          <td class="col-toggle">
            <button type="button" class="row-toggle" data-acao="detalhes" aria-expanded="${aberto}"
                    aria-controls="det-${p.id}" aria-label="Ver lotes, validade e editar ${esc(p.nome)}">${ICON_CHEVRON}</button>
          </td>
        </tr>
        ${aberto ? `<tr class="details" id="det-${p.id}" data-id="${p.id}"><td colspan="6">${detalhes(p, d)}</td></tr>` : ""}`;
    }).join("");

    $("categorias").innerHTML = [...new Set(d.produtos.map(p => p.categoria))]
      .sort((a, b) => a.localeCompare(b, "pt-BR")).map(c => `<option value="${esc(c)}">`).join("");
  }

  function detalhes(p, d) {
    const kg = R.porPeso(p);
    const f = R.fornecedorDoProduto(d, p);
    const sv = R.situacaoProduto(p);
    const pendente = d.pedidos.find(o => o.status === "pendente" && o.itens.some(i => i.produtoId === p.id));
    const lotes = [...p.lotes].sort((a, b) => b.compra.localeCompare(a.compra) || b.id - a.id);
    return `
      <div class="details-grid">
        <div class="detail"><small>Em estoque</small><strong>${R.formatar(R.qtd(p), kg)}</strong></div>
        <div class="detail"><small>Estoque mínimo</small><strong>${R.formatar(p.minimo, kg)}</strong></div>
        <div class="detail"><small>Aviso antecipado</small><strong>${R.formatar(R.limiteAviso(p, d), kg)}</strong></div>
        <div class="detail${sv && sv.nivel !== "ok" ? (sv.nivel === "vencido" ? " danger" : " warn") : ""}">
          <small>Próxima validade</small><strong>${R.proximaValidade(p) ? `${dataBR(R.proximaValidade(p))} · ${sv.texto}` : "—"}</strong></div>
        <div class="detail"><small>Fornecedor</small><strong>${f ? esc(f.nome) : "—"}</strong></div>
        <div class="detail"><small>Entrega</small><strong>${R.prazoReposicao(d, p)} dias${p.pedirAntes ? " · pedir antes" : ""}</strong></div>
        <div class="detail"><small>Caixa</small><strong>${p.codigo ? esc(p.codigo) : "sem código"} · ${R.numero(p.porCaixa, kg)} ${kg ? "kg" : "un."}</strong></div>
        <div class="detail"><small>Validade padrão</small><strong>${p.diasValidade ? p.diasValidade + " dias" : "—"}</strong></div>
      </div>
      ${pendente ? `<p class="aviso aviso-azul">Tem pedido pendente para ${esc(d.fornecedores.find(x => x.id === pendente.fornecedorId)?.nome || "fornecedor")} (previsto para ${dataBR(pendente.previsao)}).</p>` : ""}
      <div class="actions acoes-produto">
        <button type="button" class="link-btn" data-acao="lote">+ Novo lote</button>
        <button type="button" class="link-btn" data-acao="editar">Editar produto</button>
        <button type="button" class="link-btn danger" data-acao="excluir">Excluir</button>
      </div>
      <p class="history-title">Lotes</p>
      ${lotes.length ? `
      <table class="history lotes">
        <thead><tr><th>Restante / comprado</th><th>Vendido</th><th>Compra</th><th>Validade</th><th></th></tr></thead>
        <tbody>
          ${lotes.map(l => {
            const s = R.situacao(l.validade);
            const pct = l.inicial > 0 ? Math.round(l.restante / l.inicial * 100) : 0;
            const alerta = l.restante > 0 && s && s.nivel !== "ok";
            return `<tr data-lote="${l.id}"${l.restante === 0 ? ' class="esgotado"' : ""}>
              <td><span class="barra" aria-hidden="true"><span style="width:${pct}%"></span></span>
                  ${R.numero(l.restante, kg)}/${R.numero(l.inicial, kg)} ${R.sigla(p)}${l.restante === 0 ? ' <small class="muted">esgotado</small>' : ""}</td>
              <td>${R.numero(R.arred(l.inicial - l.restante), kg)} ${R.sigla(p)}</td>
              <td>${dataBR(l.compra)}</td>
              <td>${l.validade ? dataBR(l.validade) : '<span class="muted">não vence</span>'}
                  ${alerta ? `<span class="alerta-validade ${s.nivel}" title="${s.texto}">${ICON_ALERTA}<span class="sr-only">${s.texto}</span></span>` : ""}</td>
              <td class="acoes-lote">
                <button type="button" class="link-btn" data-acao="editar-lote">Editar</button>
                <button type="button" class="link-btn danger" data-acao="excluir-lote">Excluir</button>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>` : '<p class="history-empty">Nenhum lote. Use “Novo lote” quando a mercadoria chegar.</p>'}`;
  }

  $("lista").addEventListener("click", e => {
    const btn = e.target.closest("[data-acao]");
    const linha = e.target.closest("tr.row");
    if (!btn && linha) {
      // Clicar na linha também abre/fecha
      alternar(Number(linha.dataset.id));
      return;
    }
    if (!btn) return;
    const id = Number(btn.closest("[data-id]").dataset.id);
    const loteId = btn.closest("[data-lote]") ? Number(btn.closest("[data-lote]").dataset.lote) : null;
    const acao = btn.dataset.acao;
    if (acao === "detalhes") alternar(id);
    if (acao === "editar") abrirProduto(id);
    if (acao === "excluir") abrirExclusao({ tipo: "produto", produtoId: id });
    if (acao === "lote") abrirLote(id, null);
    if (acao === "editar-lote") abrirLote(id, loteId);
    if (acao === "excluir-lote") abrirExclusao({ tipo: "lote", produtoId: id, loteId });
  });

  function alternar(id) {
    abertos.has(id) ? abertos.delete(id) : abertos.add(id);
    render();
    const b = document.querySelector(`tr.row[data-id="${id}"] .row-toggle`);
    if (b) b.focus();
  }

  $("busca").addEventListener("input", render);

  document.querySelectorAll(".kpi-q").forEach(b => b.addEventListener("click", () => {
    filtros.situacao = filtros.situacao === b.dataset.situacao ? "" : b.dataset.situacao;
    render();
  }));

  // ---------- Filtros ----------
  const nFiltros = () => ["situacao", "categoria", "tipo"].filter(k => filtros[k]).length + (filtros.ordem !== "nome" ? 1 : 0);

  function renderFiltrosAtivos(mostrando, total) {
    const etiquetas = [];
    if (filtros.situacao) etiquetas.push(["situacao", SITUACOES[filtros.situacao][0]]);
    if (filtros.categoria) etiquetas.push(["categoria", filtros.categoria]);
    if (filtros.tipo) etiquetas.push(["tipo", TIPOS[filtros.tipo][0]]);
    if (filtros.ordem !== "nome") etiquetas.push(["ordem", "Ordem: " + ORDENS[filtros.ordem]]);
    const n = nFiltros();
    $("n-filtros").hidden = n === 0;
    $("n-filtros").textContent = n;
    const el = $("filtros-ativos");
    el.hidden = etiquetas.length === 0 && !$("busca").value.trim();
    el.innerHTML = etiquetas.map(([k, t]) =>
      `<span class="etiqueta">${esc(t)}<button type="button" data-tirar="${k}" aria-label="Tirar o filtro ${esc(t)}">×</button></span>`).join("") +
      `<span class="mostrando">Mostrando ${mostrando} de ${total}</span>` +
      (etiquetas.length ? '<button type="button" class="link-simples" data-tirar="todos">Limpar filtros</button>' : "");
  }

  $("filtros-ativos").addEventListener("click", e => {
    const b = e.target.closest("[data-tirar]");
    if (!b) return;
    if (b.dataset.tirar === "todos") Object.assign(filtros, { situacao: "", categoria: "", tipo: "", ordem: "nome" });
    else filtros[b.dataset.tirar] = b.dataset.tirar === "ordem" ? "nome" : "";
    render();
  });

  // A janela trabalha numa cópia; só vale ao clicar em "Mostrar N produtos".
  let rascunho = null;
  function abrirFiltros() {
    rascunho = { ...filtros };
    renderOpcoes();
    $("modal-filtros").showModal();
  }

  function renderOpcoes() {
    const d = Dados.ler();
    const termo = R.norm($("busca").value);
    const conta = mudanca => d.produtos.filter(p => passa(p, d, { ...rascunho, ...mudanca }, termo)).length;
    const opcao = (grupo, valor, texto, n) =>
      `<button type="button" class="chip${rascunho[grupo] === valor ? " active" : ""}" data-grupo="${grupo}" data-valor="${esc(valor)}" aria-pressed="${rascunho[grupo] === valor}">${esc(texto)}${n === null ? "" : ` <span>${n}</span>`}</button>`;

    $("op-situacao").innerHTML = opcao("situacao", "", "Todas", conta({ situacao: "" })) +
      Object.entries(SITUACOES).map(([k, [t]]) => [k, t, conta({ situacao: k })]).filter(x => x[2] > 0 || rascunho.situacao === x[0])
        .map(([k, t, n]) => opcao("situacao", k, t, n)).join("");
    const cats = [...new Set(d.produtos.map(p => p.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    $("op-categoria").innerHTML = opcao("categoria", "", "Todas", conta({ categoria: "" })) +
      cats.map(c => [c, conta({ categoria: c })]).filter(x => x[1] > 0 || rascunho.categoria === x[0]).map(([c, n]) => opcao("categoria", c, c, n)).join("");
    $("op-tipo").innerHTML = opcao("tipo", "", "Todos", conta({ tipo: "" })) +
      Object.entries(TIPOS).map(([k, [t]]) => [k, t, conta({ tipo: k })]).filter(x => x[2] > 0 || rascunho.tipo === x[0])
        .map(([k, t, n]) => opcao("tipo", k, t, n)).join("");
    $("op-ordem").innerHTML = Object.entries(ORDENS).map(([k, t]) => opcao("ordem", k, t, null)).join("");
    const n = conta({});
    $("filtros-mostrar").textContent = n === 1 ? "Mostrar 1 produto" : `Mostrar ${n} produtos`;
  }

  $("modal-filtros").addEventListener("click", e => {
    const b = e.target.closest("[data-grupo]");
    if (!b) return;
    rascunho[b.dataset.grupo] = b.dataset.valor;
    renderOpcoes();
  });
  $("filtros-limpar").addEventListener("click", () => { rascunho = { situacao: "", categoria: "", tipo: "", ordem: "nome" }; renderOpcoes(); });
  $("form-filtros").addEventListener("submit", e => {
    e.preventDefault();
    Object.assign(filtros, rascunho);
    $("modal-filtros").close();
    render();
  });
  $("btn-filtros").addEventListener("click", abrirFiltros);

  // ---------- Utilidades de formulário ----------
  function setErro(el, msg) {
    $(el.id + "-error").textContent = msg;
    el.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  document.querySelectorAll("dialog input, dialog select").forEach(el =>
    el.addEventListener("input", () => { if (el.getAttribute("aria-invalid") === "true") setErro(el, ""); }));
  document.querySelectorAll("[data-fechar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

  // Validade pré-definida: compra + dias, recalculada quando a compra muda, até a pessoa digitar outra validade.
  function validadeAutomatica(compra, validade, dica, dias, origem) {
    let automatica = null;
    const recalcular = () => {
      const n = dias();
      const manual = validade.value && validade.value !== automatica;
      if (!n || !compra.value) { dica.textContent = ""; return; }
      dica.textContent = manual ? `Pela ${origem()} seriam ${n} dias (você mudou a data).` : `Preenchida pela ${origem()} (${n} dias depois da compra).`;
      if (manual) return;
      validade.value = automatica = Dados.somarDias(compra.value, n);
    };
    compra.addEventListener("input", recalcular);
    validade.addEventListener("input", recalcular);
    return { recalcular, zerar: () => { automatica = null; } };
  }

  // ---------- Cadastro / edição de produto ----------
  const mProduto = $("modal-produto");
  const cp = ["nome", "categoria", "fornecedor", "prazo", "preco", "minimo", "aviso", "dias", "codigo", "porcaixa", "qtd", "compra", "validade"]
    .reduce((o, k) => (o[k] = $("f-" + k), o), {});
  let editandoId = null;

  const autoProduto = validadeAutomatica(cp.compra, cp.validade, $("f-validade-dica"),
    () => { const n = Number(cp.dias.value); return /^\d+$/.test(cp.dias.value) && n > 0 ? n : null; },
    () => "validade padrão do produto");
  cp.dias.addEventListener("input", autoProduto.recalcular);

  function ajustarUnidade() {
    const kg = $("f-kg").checked;
    $("f-preco-rotulo").textContent = kg ? "Preço por kg (R$)" : "Preço (R$)";
    $("f-porcaixa-rotulo").textContent = kg ? "Kg por caixa (aproximado)" : "Unidades por caixa";
    $("f-minimo").placeholder = kg ? "ex: 5,5" : "ex: 10";
    $("f-qtd").previousElementSibling.textContent = kg ? "Quantidade (kg)" : "Quantidade";
  }
  $("f-kg").addEventListener("change", ajustarUnidade);

  function abrirProduto(id, codigo = "", sugestao = null) {
    const d = Dados.ler();
    const p = id ? d.produtos.find(x => x.id === id) : null;
    editandoId = p ? p.id : null;
    $("modal-titulo").textContent = p ? "Editar produto" : "Novo produto";
    $("btn-salvar").textContent = p ? "Salvar alterações" : "Cadastrar produto";
    $("secao-lote").hidden = !!p;
    const kg = p ? R.porPeso(p) : false;
    cp.fornecedor.innerHTML = '<option value="">Quem entrega a categoria</option>' +
      R.ativos(d).map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join("");
    cp.nome.value = p ? p.nome : (sugestao?.nome || "");
    cp.categoria.value = p ? p.categoria : (sugestao?.categoria || "");
    cp.fornecedor.value = p && p.fornecedorId ? p.fornecedorId : "";
    cp.prazo.value = p && p.prazo ? p.prazo : "";
    $("f-kg").checked = kg;
    cp.preco.value = p ? p.preco.toFixed(2).replace(".", ",") : "";
    cp.minimo.value = p ? R.paraCampo(p.minimo) : "";
    cp.aviso.value = p && p.aviso !== null ? R.paraCampo(p.aviso) : "";
    $("f-pedir").checked = p ? !!p.pedirAntes : false;
    cp.dias.value = p && p.diasValidade ? p.diasValidade : "";
    cp.codigo.value = p ? p.codigo || "" : codigo;
    cp.porcaixa.value = p ? R.paraCampo(p.porCaixa) : "1";
    cp.qtd.value = "0";
    cp.compra.value = Dados.hojeISO();
    cp.validade.value = "";
    autoProduto.zerar();
    $("f-validade-dica").textContent = "";
    $("f-achado").hidden = !sugestao;
    if (sugestao) $("f-achado").textContent = `Achamos este código no ${sugestao.fonte}: confira o nome e a categoria antes de salvar.`;
    ajustarUnidade();
    Object.values(cp).forEach(el => setErro(el, ""));
    mProduto.showModal();
    (sugestao ? cp.preco : cp.nome).focus();
  }

  $("form-produto").addEventListener("submit", e => {
    e.preventDefault();
    const d = Dados.ler();
    const kg = $("f-kg").checked;
    const erros = {};
    const nome = cp.nome.value.trim();
    if (!nome) erros.nome = "Informe o nome do produto.";
    else if (d.produtos.some(p => p.id !== editandoId && R.norm(p.nome) === R.norm(nome))) erros.nome = "Já existe um produto com esse nome.";
    if (!cp.categoria.value.trim()) erros.categoria = "Informe a categoria.";
    const prazo = cp.prazo.value.trim() ? Number(cp.prazo.value) : null;
    if (cp.prazo.value.trim() && !(/^\d+$/.test(cp.prazo.value.trim()) && prazo >= 1)) erros.prazo = "Use um número de dias (1 ou mais).";
    const preco = R.lerPreco(cp.preco.value);
    if (!(preco > 0)) erros.preco = "Informe um preço válido, ex: 8,50.";
    const minimo = R.lerQtd(cp.minimo.value, kg);
    if (isNaN(minimo)) erros.minimo = kg ? "Use um peso, ex: 5,5." : "Use um número inteiro (0 ou mais).";
    const aviso = cp.aviso.value.trim() ? R.lerQtd(cp.aviso.value, kg) : null;
    if (aviso !== null && (isNaN(aviso) || aviso <= minimo)) erros.aviso = "Use um número maior que o mínimo (ou deixe vazio).";
    const dias = cp.dias.value.trim() ? Number(cp.dias.value) : null;
    if (cp.dias.value.trim() && !(/^\d+$/.test(cp.dias.value.trim()) && dias >= 1)) erros.dias = "Use um número de dias (1 ou mais).";
    const codigo = cp.codigo.value.trim();
    if (codigo && d.produtos.some(p => p.id !== editandoId && p.codigo === codigo)) erros.codigo = "Este código já é de outro produto.";
    const porCaixa = R.lerQtd(cp.porcaixa.value, kg);
    if (!(porCaixa > 0)) erros.porcaixa = "Use um número maior que zero.";
    let qtd = 0;
    if (!editandoId) {
      qtd = R.lerQtd(cp.qtd.value || "0", kg);
      if (isNaN(qtd)) erros.qtd = kg ? "Use um peso, ex: 12,350." : "Use um número inteiro (0 ou mais).";
      if (qtd > 0 && !cp.compra.value) erros.compra = "Informe a data de compra.";
      if (cp.validade.value && cp.compra.value && cp.validade.value < cp.compra.value) erros.validade = "A validade não pode ser antes da compra.";
    }
    Object.entries(cp).forEach(([k, el]) => setErro(el, erros[k] || ""));
    const primeiro = Object.keys(cp).find(k => erros[k]);
    if (primeiro) return cp[primeiro].focus();

    const campos = {
      nome, categoria: cp.categoria.value.trim(), fornecedorId: cp.fornecedor.value ? Number(cp.fornecedor.value) : null, prazo,
      unidade: kg ? "kg" : "un", preco, minimo, aviso, pedirAntes: $("f-pedir").checked, diasValidade: dias, codigo, porCaixa,
    };
    if (editandoId) {
      Object.assign(d.produtos.find(p => p.id === editandoId), campos);
    } else {
      const id = Dados.proximoId(d.produtos);
      const loteId = Dados.proximoId(d.produtos.flatMap(p => p.lotes));
      d.produtos.push({ id, ...campos, lotes: qtd > 0 ? [{ id: loteId, inicial: qtd, restante: qtd, compra: cp.compra.value, validade: cp.validade.value }] : [] });
    }
    Dados.salvar(d);
    mProduto.close();
    App.toast(editandoId ? `“${nome}” foi atualizado.` : `“${nome}” foi cadastrado.`);
    Dados.notificar();
  });

  // ---------- Lote ----------
  const mLote = $("modal-lote");
  const cl = ["caixas", "inicial", "restante", "compra", "validade"].reduce((o, k) => (o[k] = $("l-" + k), o), {});
  let lote = null; // { produtoId, loteId }
  let produtoDoLote = null;

  const autoLote = validadeAutomatica(cl.compra, cl.validade, $("l-validade-dica"),
    () => produtoDoLote ? R.diasValidadeSugerida(produtoDoLote) : null,
    () => produtoDoLote && produtoDoLote.diasValidade ? "validade padrão do produto" : "validade do último lote");

  function abrirLote(produtoId, loteId, caixasLidas = 0) {
    const d = Dados.ler();
    const p = d.produtos.find(x => x.id === produtoId);
    if (!p) return;
    const l = loteId ? p.lotes.find(x => x.id === loteId) : null;
    const kg = R.porPeso(p);
    lote = { produtoId, loteId };
    produtoDoLote = p;
    $("lote-titulo").textContent = l ? "Editar lote" : "Novo lote";
    $("lote-produto").textContent = `${p.nome} · ${R.formatar(R.qtd(p), kg)} em estoque`;
    $("lote-salvar").textContent = l ? "Salvar lote" : "Adicionar lote";
    $("l-inicial-rotulo").textContent = kg ? "Quantidade comprada (kg)" : "Quantidade comprada";
    $("campo-restante").hidden = !l;
    // Caixas: por unidade multiplica; por quilo o peso varia, então pede o peso da etiqueta.
    $("campo-caixas").hidden = !!l || kg || p.porCaixa <= 1;
    $("l-caixas-dica").textContent = `${R.numero(p.porCaixa)} unidades por caixa`;
    cl.caixas.value = !l && !kg && p.porCaixa > 1 ? String(caixasLidas || 1) : "";
    cl.inicial.value = l ? R.paraCampo(l.inicial) : kg ? (caixasLidas ? R.paraCampo(p.porCaixa * caixasLidas) : "") : String((caixasLidas || 1) * p.porCaixa);
    cl.restante.value = l ? R.paraCampo(l.restante) : "";
    cl.compra.value = l ? l.compra : Dados.hojeISO();
    cl.validade.value = l ? l.validade : "";
    autoLote.zerar();
    $("l-validade-dica").textContent = kg && !l ? "Confira o peso na etiqueta da caixa (o peso das caixas de carne varia)." : "";
    if (!l) autoLote.recalcular();

    const pendente = !l && d.pedidos.find(o => o.status === "pendente" && o.itens.some(i => i.produtoId === p.id));
    $("lote-pedido").hidden = !pendente;
    if (pendente) {
      const f = d.fornecedores.find(x => x.id === pendente.fornecedorId);
      $("lote-pedido-texto").textContent = `Este produto está num pedido pendente para ${f ? f.nome : "o fornecedor"} (de ${dataBR(pendente.data)}). `;
      $("lote-pedido-link").href = `fornecedores.html#entrega-${pendente.id}`;
    }
    Object.values(cl).forEach(el => setErro(el, ""));
    mLote.showModal();
    ($("campo-caixas").hidden ? cl.inicial : cl.caixas).focus();
    ($("campo-caixas").hidden ? cl.inicial : cl.caixas).select();
  }

  cl.caixas.addEventListener("input", () => {
    if (/^\d+$/.test(cl.caixas.value) && produtoDoLote) cl.inicial.value = String(Number(cl.caixas.value) * produtoDoLote.porCaixa);
  });

  $("form-lote").addEventListener("submit", e => {
    e.preventDefault();
    const d = Dados.ler();
    const p = d.produtos.find(x => x.id === lote.produtoId);
    const kg = R.porPeso(p);
    const erros = {};
    const inicial = R.lerQtd(cl.inicial.value, kg);
    if (!(inicial > 0)) erros.inicial = kg ? "Informe o peso, ex: 18,750." : "Informe a quantidade (1 ou mais).";
    let restante = inicial;
    if (lote.loteId) {
      restante = R.lerQtd(cl.restante.value, kg);
      if (isNaN(restante)) erros.restante = "Quantidade inválida.";
      else if (restante > inicial) erros.restante = "Não pode ser maior que a quantidade comprada.";
    }
    if (!cl.compra.value) erros.compra = "Informe a data de compra.";
    if (cl.validade.value && cl.compra.value && cl.validade.value < cl.compra.value) erros.validade = "A validade não pode ser antes da compra.";
    Object.entries(cl).forEach(([k, el]) => setErro(el, erros[k] || ""));
    const primeiro = Object.keys(cl).find(k => erros[k]);
    if (primeiro) return cl[primeiro].focus();

    if (lote.loteId) {
      Object.assign(p.lotes.find(l => l.id === lote.loteId), { inicial, restante, compra: cl.compra.value, validade: cl.validade.value });
    } else {
      p.lotes.push({ id: Dados.proximoId(d.produtos.flatMap(x => x.lotes)), inicial, restante: inicial, compra: cl.compra.value, validade: cl.validade.value });
    }
    Dados.salvar(d);
    mLote.close();
    abertos.add(p.id);
    App.toast(lote.loteId ? "Lote atualizado." : `Lote de ${R.formatar(inicial, kg)} de ${p.nome} adicionado.`);
    Dados.notificar();
    $("leitor").focus();
  });

  // ---------- Leitor de código de barras ----------
  // O leitor "digita" o código e aperta Enter.
  $("leitor").addEventListener("keydown", async e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const codigo = $("leitor").value.trim();
    if (!codigo) return;
    $("leitor").value = "";
    const d = Dados.ler();
    const p = d.produtos.find(x => x.codigo === codigo);
    if (p) return abrirLote(p.id, null, 1);
    App.toast("Código novo: procurando o produto nos bancos abertos…");
    abrirProduto(null, codigo, await buscarCodigo(codigo));
  });

  // Código desconhecido: procura no Open Food Facts, Open Beauty Facts e Open Products Facts (grátis, sem chave).
  async function buscarCodigo(codigo) {
    let gtin = codigo;
    if (/^\d{14}$/.test(codigo)) {
      // Caixa (DUN-14) → unidade (EAN-13): tira o primeiro dígito e refaz o verificador
      const base = codigo.slice(1, 13);
      const soma = [...base].reduce((t, c, i) => t + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
      gtin = base + ((10 - soma % 10) % 10);
    }
    const bancos = [["world.openfoodfacts.org", "Open Food Facts"], ["world.openbeautyfacts.org", "Open Beauty Facts"], ["world.openproductsfacts.org", "Open Products Facts"]];
    const controle = new AbortController();
    const tempo = setTimeout(() => controle.abort(), 6000);
    try {
      for (const [host, fonte] of bancos) {
        const r = await fetch(`https://${host}/api/v2/product/${gtin}.json?fields=product_name,brands,quantity,categories`, { signal: controle.signal });
        if (!r.ok) continue;
        const j = await r.json();
        const pr = j.product;
        if (j.status !== 1 || !pr || !pr.product_name) continue;
        const marca = (pr.brands || "").split(",")[0].trim();
        const nome = [pr.product_name, marca && !R.norm(pr.product_name).includes(R.norm(marca)) ? marca : "", pr.quantity || ""].filter(Boolean).join(" ");
        return { nome: nome.slice(0, 80), categoria: categoriaProvavel(pr.categories || ""), fonte };
      }
    } catch (_) {
      // Sem internet ou demorou: abre o cadastro vazio
    } finally {
      clearTimeout(tempo);
    }
    return null;
  }

  function categoriaProvavel(texto) {
    const t = R.norm(texto);
    const mapa = [["carne", "Açougue"], ["queijo", "Frios"], ["leite", "Laticínios"], ["iogurte", "Laticínios"], ["bebida", "Bebidas"], ["agua", "Bebidas"],
      ["arroz", "Grãos"], ["feijao", "Grãos"], ["cereal", "Grãos"], ["pao", "Padaria"], ["biscoito", "Mercearia"], ["congelad", "Congelados"],
      ["fruta", "Hortifrúti"], ["limpeza", "Limpeza"], ["detergente", "Limpeza"], ["higiene", "Higiene"], ["shampoo", "Higiene"], ["pet", "Pet"]];
    return (mapa.find(([k]) => t.includes(k)) || [null, ""])[1];
  }

  // ---------- Exclusão ----------
  const mExcluir = $("modal-excluir");
  function abrirExclusao(alvo) {
    const d = Dados.ler();
    const p = d.produtos.find(x => x.id === alvo.produtoId);
    if (!p) return;
    excluir = alvo;
    if (alvo.tipo === "produto") {
      $("excluir-titulo").textContent = "Excluir produto?";
      $("excluir-texto").textContent = `“${p.nome}” e os lotes dele serão removidos do estoque. Esta ação não pode ser desfeita.`;
    } else {
      const l = p.lotes.find(x => x.id === alvo.loteId);
      $("excluir-titulo").textContent = "Excluir lote?";
      $("excluir-texto").textContent = `O lote de ${dataBR(l.compra)} (${R.formatar(l.restante, R.porPeso(p))} restantes) de “${p.nome}” será removido.`;
    }
    mExcluir.showModal();
    mExcluir.querySelector("[data-fechar]").focus();
  }

  $("btn-confirmar-excluir").addEventListener("click", () => {
    const d = Dados.ler();
    const p = d.produtos.find(x => x.id === excluir.produtoId);
    if (excluir.tipo === "produto") {
      d.produtos = d.produtos.filter(x => x.id !== excluir.produtoId);
      abertos.delete(excluir.produtoId);
      App.toast(`“${p.nome}” foi excluído.`);
    } else {
      p.lotes = p.lotes.filter(l => l.id !== excluir.loteId);
      App.toast("Lote excluído.");
    }
    Dados.salvar(d);
    mExcluir.close();
    Dados.notificar();
  });

  $("btn-novo").addEventListener("click", () => abrirProduto(null));

  // Atalho do painel: estoque.html#novo abre o cadastro direto
  if (location.hash === "#novo") {
    history.replaceState(null, "", location.pathname);
    abrirProduto(null);
  } else {
    $("leitor").focus();
  }

  render();
  Dados.aoMudar(render); // venda no caixa ou alteração em outra aba → atualiza a lista
})();
