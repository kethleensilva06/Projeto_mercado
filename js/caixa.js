/*
 * Caixa (semana 5): abre o caixa com o troco inicial, monta a venda pelo leitor de código de barras ou pelo nome,
 * recebe o pagamento e só então dá baixa nos lotes (o que vence primeiro sai primeiro). Enquanto a venda está
 * aberta os itens ficam reservados (guardados em Dados.caixa.venda). Lote vencido não pode ser vendido.
 */
(() => {
  const sessao = App.iniciar({ ativo: "caixa", perfis: ["gerente", "operador"] });
  if (!sessao) return;

  const $ = id => document.getElementById(id);
  const { esc, moeda } = App;
  const R = Regras;

  let forma = null;

  const venda = d => d.caixa.venda || [];
  const produtoDe = (d, item) => d.produtos.find(p => p.id === item.produtoId);
  const subtotal = (p, q) => Math.round(q * p.preco * 100) / 100;

  function totalVenda(d) {
    return venda(d).reduce((s, i) => {
      const p = produtoDe(d, i);
      const q = p ? R.lerQtd(i.qtd, R.porPeso(p)) : NaN;
      return s + (q > 0 ? subtotal(p, q) : 0);
    }, 0);
  }

  // ---------- Tela ----------
  function render() {
    const d = Dados.ler();
    const aberto = d.caixa.aberto;
    $("painel-abrir").hidden = aberto;
    $("area-venda").hidden = !aberto;
    $("subtitulo").textContent = aberto
      ? `Caixa aberto por ${d.caixa.abertoPor} às ${d.caixa.abertoAs} · troco inicial ${moeda(d.caixa.trocoInicial || 0)}`
      : "Registro de vendas do dia";
    if (aberto) renderVenda(d);
    renderDia(d);
  }

  function renderVenda(d) {
    const itens = venda(d);
    $("itens").innerHTML = itens.map((i, n) => {
      const p = produtoDe(d, i);
      if (!p) return "";
      return `<tr data-n="${n}">
        <td><strong>${esc(p.nome)}</strong><br>${R.pilulaCategoria(p.categoria)}</td>
        <td class="num">
          <span class="campo-qtd"><input class="qtd" inputmode="decimal" value="${esc(i.qtd)}" placeholder="${R.porPeso(p) ? "0,000" : ""}"
            aria-label="${R.porPeso(p) ? `Peso de ${esc(p.nome)} em kg` : `Quantidade de ${esc(p.nome)}`}"> ${R.sigla(p)}</span>
          <span class="field-error item-erro"></span>
        </td>
        <td class="num muted">${moeda(p.preco)}${R.porPeso(p) ? "/kg" : ""}</td>
        <td class="num subtotal"></td>
        <td><button type="button" class="icon-btn" data-tirar="${n}" aria-label="Tirar ${esc(p.nome)} da venda">×</button></td>
      </tr>`;
    }).join("");
    $("sem-itens").hidden = itens.length > 0;
    document.querySelector(".carrinho").hidden = itens.length === 0;
    atualizarTotais(d);
  }

  function atualizarTotais(d = Dados.ler()) {
    const itens = venda(d);
    document.querySelectorAll("#itens tr").forEach(tr => {
      const i = itens[Number(tr.dataset.n)];
      const p = i && produtoDe(d, i);
      if (!p) return;
      const q = R.lerQtd(i.qtd, R.porPeso(p));
      tr.querySelector(".subtotal").textContent = q > 0 ? moeda(subtotal(p, q)) : "—";
    });
    const total = totalVenda(d);
    $("total").textContent = moeda(total);
    $("qtd-itens").textContent = itens.length === 0 ? "Nenhum item" : itens.length === 1 ? "1 item na venda" : `${itens.length} itens na venda`;
    const recebido = R.lerPreco($("recebido").value);
    $("troco").textContent = moeda(recebido > total ? recebido - total : 0);
  }

  function renderDia(d) {
    const validas = d.vendas.filter(v => !v.cancelada);
    const total = validas.reduce((s, v) => s + v.total, 0);
    $("r-total").textContent = moeda(total);
    $("r-qtd").textContent = validas.length;
    $("r-ticket").textContent = moeda(validas.length ? total / validas.length : 0);

    const lista = [...d.vendas].sort((a, b) => b.id - a.id);
    $("vendas").innerHTML = lista.length ? lista.map(v => `
      <li class="${v.cancelada ? "cancelada" : ""}" data-venda="${v.id}">
        <div class="venda-texto">
          <strong>Venda nº ${v.id} · ${esc(v.hora)}${v.operador ? " · " + esc(v.operador) : ""}</strong>
          <small>${v.itens ? esc(v.itens.map(i => `${R.numero(i.qtd, i.unidade === "kg")} ${i.unidade === "kg" ? "kg" : "un."} ${i.nome}`).join(", ")) : ""}</small>
        </div>
        <span class="venda-forma">${R.FORMAS[v.forma] || esc(v.forma)}</span>
        <strong class="venda-total">${moeda(v.total)}</strong>
        ${v.cancelada ? `<span class="badge badge-danger" title="Cancelada por ${esc(v.canceladaPor || "")}">Cancelada</span>`
          : sessao.perfil === "gerente" && v.itens ? '<button type="button" class="link-btn" data-cancelar>Cancelar</button>' : ""}
      </li>`).join("") : '<li class="vazio">Nenhuma venda hoje.</li>';
  }

  // ---------- Abrir o caixa ----------
  $("form-abrir").addEventListener("submit", e => {
    e.preventDefault();
    const campo = $("troco-inicial");
    const troco = campo.value.trim() ? R.lerPreco(campo.value) : 0;
    if (isNaN(troco)) {
      $("troco-inicial-error").textContent = "Digite um valor válido, por exemplo 150,00.";
      campo.setAttribute("aria-invalid", "true");
      return campo.focus();
    }
    const d = Dados.ler();
    d.caixa = { aberto: true, abertoPor: sessao.nome, abertoAs: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), trocoInicial: troco, venda: [] };
    Dados.salvar(d);
    App.toast("Caixa aberto. Boas vendas!");
    Dados.notificar();
    $("busca").focus();
  });
  $("troco-inicial").addEventListener("input", () => { $("troco-inicial-error").textContent = ""; $("troco-inicial").removeAttribute("aria-invalid"); });

  // ---------- Busca e leitor ----------
  function encontrar(d, texto) {
    const t = R.norm(texto);
    return d.produtos.filter(p => R.norm(p.nome).includes(t) || R.norm(p.categoria).includes(t))
      .sort((a, b) => (R.norm(b.nome).startsWith(t) ? 1 : 0) - (R.norm(a.nome).startsWith(t) ? 1 : 0) || R.porNome(a, b));
  }

  function renderResultados() {
    const d = Dados.ler();
    const texto = $("busca").value.trim();
    if (texto.length < 2 || /^\d+$/.test(texto)) { $("resultados").innerHTML = ""; return; }
    const achados = encontrar(d, texto).slice(0, 6);
    $("resultados").innerHTML = achados.length ? achados.map(p => {
      const vendavel = R.vendavel(p);
      const situacao = vendavel > 0 ? `Disponível: ${R.formatar(vendavel - reservado(d, p), R.porPeso(p))}`
        : R.vencida(p) > 0 ? "Só tem lote vencido: venda bloqueada" : "Sem estoque";
      return `<button type="button" class="resultado" data-produto="${p.id}"${vendavel > 0 ? "" : " disabled"}>
        <span><strong>${esc(p.nome)}</strong> <small class="${vendavel > 0 ? "muted" : "erro"}">${esc(p.categoria)} · ${situacao}</small></span>
        <strong>${moeda(p.preco)}${R.porPeso(p) ? "/kg" : ""}</strong>
      </button>`;
    }).join("") : '<p class="history-empty">Nenhum produto encontrado.</p>';
  }

  // Quanto deste produto já está reservado na venda aberta
  function reservado(d, p) {
    const item = venda(d).find(i => i.produtoId === p.id);
    const q = item ? R.lerQtd(item.qtd, R.porPeso(p)) : 0;
    return q > 0 ? q : 0;
  }

  function erroBusca(msg) { $("busca-error").textContent = msg; }

  function adicionar(produtoId) {
    const d = Dados.ler();
    const p = d.produtos.find(x => x.id === produtoId);
    if (!p) return;
    if (R.vendavel(p) <= 0) {
      return erroBusca(R.vencida(p) > 0
        ? `${p.nome}: só há lote vencido. A venda está bloqueada; retire o produto da prateleira.`
        : `${p.nome} está sem estoque.`);
    }
    d.caixa.venda = venda(d);
    const existente = d.caixa.venda.find(i => i.produtoId === p.id);
    if (existente) {
      // Mais uma unidade do mesmo produto; no produto por quilo, só volta para o campo do peso
      if (!R.porPeso(p)) {
        const atual = R.lerQtd(existente.qtd, false) || 0;
        if (atual + 1 > R.vendavel(p)) return erroBusca(`Não há mais ${p.nome} disponível (${R.formatar(R.vendavel(p), false)} no estoque).`);
        existente.qtd = String(atual + 1);
      }
    } else {
      d.caixa.venda.push({ produtoId: p.id, qtd: R.porPeso(p) ? "" : "1" });
    }
    Dados.salvar(d);
    $("busca").value = "";
    erroBusca("");
    $("resultados").innerHTML = "";
    renderVenda(d);
    if (R.porPeso(p)) {
      // Produto por quilo: a pessoa digita o peso da balança
      const n = d.caixa.venda.findIndex(i => i.produtoId === p.id);
      const campo = document.querySelector(`#itens tr[data-n="${n}"] .qtd`);
      campo.focus();
      campo.select();
    } else {
      $("busca").focus();
    }
  }

  $("busca").addEventListener("input", () => { erroBusca(""); renderResultados(); });
  $("busca").addEventListener("keydown", e => {
    if (e.key === "Escape") { $("busca").value = ""; renderResultados(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const texto = $("busca").value.trim();
    if (!texto) return;
    const d = Dados.ler();
    if (/^\d+$/.test(texto)) {
      // O leitor "digita" o código e manda Enter
      const p = R.porCodigo(d.produtos, texto);
      return p ? adicionar(p.id) : erroBusca(`Nenhum produto com o código ${texto}. Confira o cadastro no Estoque ou busque pelo nome.`);
    }
    const primeiro = encontrar(d, texto).find(p => R.vendavel(p) > 0);
    primeiro ? adicionar(primeiro.id) : erroBusca("Nenhum produto disponível com esse nome.");
  });
  $("resultados").addEventListener("click", e => {
    const b = e.target.closest("[data-produto]");
    if (b && !b.disabled) adicionar(Number(b.dataset.produto));
  });

  // ---------- Itens ----------
  $("itens").addEventListener("input", e => {
    if (!e.target.classList.contains("qtd")) return;
    const d = Dados.ler();
    venda(d)[Number(e.target.closest("tr").dataset.n)].qtd = e.target.value;
    Dados.salvar(d);   // sem notificar: não redesenha enquanto a pessoa digita
    e.target.removeAttribute("aria-invalid");
    e.target.closest("td").querySelector(".item-erro").textContent = "";
    atualizarTotais(d);
  });
  $("itens").addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.classList.contains("qtd")) { e.preventDefault(); $("busca").focus(); }
  });
  $("itens").addEventListener("click", e => {
    const b = e.target.closest("[data-tirar]");
    if (!b) return;
    const d = Dados.ler();
    d.caixa.venda.splice(Number(b.dataset.tirar), 1);
    Dados.salvar(d);
    renderVenda(d);
    $("busca").focus();
  });

  // Confere cada item: quantidade (ou peso) válida e dentro do que pode ser vendido.
  function validarItens(d) {
    let primeiro = null;
    document.querySelectorAll("#itens tr").forEach(tr => {
      const i = venda(d)[Number(tr.dataset.n)];
      const p = produtoDe(d, i);
      const q = R.lerQtd(i.qtd, R.porPeso(p));
      const disponivel = R.vendavel(p);
      const msg = !(q > 0) ? (R.porPeso(p) ? "Digite o peso (ex.: 0,750)" : "Quantidade inválida")
        : q > disponivel ? `Só há ${R.formatar(disponivel, R.porPeso(p))}` : "";
      const campo = tr.querySelector(".qtd");
      campo.setAttribute("aria-invalid", msg ? "true" : "false");
      tr.querySelector(".item-erro").textContent = msg;
      if (msg && !primeiro) primeiro = campo;
    });
    if (primeiro) primeiro.focus();
    return !primeiro;
  }

  // ---------- Pagamento ----------
  function escolherForma(f) {
    forma = f;
    document.querySelectorAll("#formas [data-forma]").forEach(b => {
      b.classList.toggle("active", b.dataset.forma === f);
      b.setAttribute("aria-pressed", String(b.dataset.forma === f));
    });
    $("forma-error").textContent = "";
    $("painel-dinheiro").hidden = f !== "dinheiro";
    if (f === "dinheiro") $("recebido").focus();
  }
  $("formas").addEventListener("click", e => { const b = e.target.closest("[data-forma]"); if (b) escolherForma(b.dataset.forma); });
  $("recebido").addEventListener("input", () => { $("recebido-error").textContent = ""; $("recebido").removeAttribute("aria-invalid"); atualizarTotais(); });

  function finalizar() {
    const d = Dados.ler();
    if (!d.caixa.aberto) return;
    if (!venda(d).length) { erroBusca("Adicione pelo menos um produto à venda."); return $("busca").focus(); }
    if (!validarItens(d)) return;
    if (!forma) { $("forma-error").textContent = "Escolha a forma de pagamento."; return; }
    const total = Math.round(totalVenda(d) * 100) / 100;
    let recebido = null;
    if (forma === "dinheiro") {
      // Campo vazio = o cliente pagou o valor exato
      recebido = $("recebido").value.trim() ? R.lerPreco($("recebido").value) : total;
      const msg = isNaN(recebido) ? "Digite um valor válido, por exemplo 50,00." : recebido < total ? `O valor recebido é menor que o total (${moeda(total)}).` : "";
      if (msg) { $("recebido-error").textContent = msg; $("recebido").setAttribute("aria-invalid", "true"); return $("recebido").focus(); }
    }

    // Só agora (pagamento confirmado) os itens saem dos lotes: o que vence primeiro sai primeiro
    const itens = [];
    for (const i of venda(d)) {
      const p = produtoDe(d, i);
      const q = R.lerQtd(i.qtd, R.porPeso(p));
      const baixas = R.separar(p, q);
      if (!baixas) return validarItens(d);
      baixas.forEach(b => { const l = p.lotes.find(x => x.id === b.loteId); l.restante = R.arred(l.restante - b.qtd); });
      itens.push({ produtoId: p.id, nome: p.nome, unidade: p.unidade, qtd: q, preco: p.preco, lotes: baixas });
    }
    const v = {
      id: Dados.proximoId(d.vendas), hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      total, forma, operador: sessao.nome, itens, recebido, troco: recebido !== null ? Math.round((recebido - total) * 100) / 100 : 0,
    };
    d.vendas.push(v);
    d.caixa.venda = [];
    Dados.salvar(d);
    $("recebido").value = "";
    escolherForma(null);
    App.toast(v.troco > 0 ? `Venda nº ${v.id} registrada. Troco: ${moeda(v.troco)}.` : `Venda nº ${v.id} registrada (${moeda(total)}).`);
    Dados.notificar();
    $("busca").focus();
  }
  $("btn-finalizar").addEventListener("click", finalizar);

  // ---------- Cancelar (venda aberta ou venda já paga, só gerente) ----------
  const mc = $("modal-confirmar");
  let acao = null;
  function confirmar(titulo, texto, fazer) {
    $("mc-titulo").textContent = titulo;
    $("mc-texto").textContent = texto;
    acao = fazer;
    mc.showModal();
    mc.querySelector("[data-fechar]").focus();
  }
  $("mc-confirmar").addEventListener("click", () => {
    const d = Dados.ler();
    const msg = acao(d);
    Dados.salvar(d);
    mc.close();
    App.toast(msg);
    Dados.notificar();
  });
  document.querySelectorAll("[data-fechar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

  $("btn-cancelar-venda").addEventListener("click", () => {
    const n = venda(Dados.ler()).length;
    if (!n) return;
    confirmar("Cancelar a venda?", `${n === 1 ? "O item sai" : `Os ${n} itens saem`} da venda e ${n === 1 ? "volta" : "voltam"} a ficar disponíveis. Nada sai do estoque.`, d => {
      d.caixa.venda = [];
      escolherForma(null);
      $("recebido").value = "";
      return "Venda cancelada.";
    });
  });

  $("vendas").addEventListener("click", e => {
    if (!e.target.closest("[data-cancelar]")) return;
    const id = Number(e.target.closest("[data-venda]").dataset.venda);
    const v = Dados.ler().vendas.find(x => x.id === id);
    confirmar(`Cancelar a venda nº ${v.id}?`, `A venda de ${moeda(v.total)} (${(R.FORMAS[v.forma] || v.forma).toLowerCase()}) sai dos totais do dia e os itens voltam para o estoque. Devolva o valor ao cliente.`, d => {
      const venda = d.vendas.find(x => x.id === id);
      venda.cancelada = true;
      venda.canceladaPor = sessao.nome;
      // Devolve para os mesmos lotes de onde saiu
      venda.itens.forEach(i => i.lotes.forEach(b => {
        const l = d.produtos.flatMap(p => p.lotes).find(x => x.id === b.loteId);
        if (l) l.restante = R.arred(l.restante + b.qtd);
      }));
      return `Venda nº ${id} cancelada.`;
    });
  });

  // Atalhos de teclado do caixa
  document.addEventListener("keydown", e => {
    if ($("area-venda").hidden || document.querySelector("dialog[open]")) return;
    if (e.key === "F2") { e.preventDefault(); $("busca").focus(); $("busca").select(); }
    if (e.key === "F4") { e.preventDefault(); finalizar(); }
  });

  render();
  if (!$("area-venda").hidden) $("busca").focus(); else $("troco-inicial").focus();
  Dados.aoMudar(render);
})();
