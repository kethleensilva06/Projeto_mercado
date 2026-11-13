// Aba Pedir do app (pedido do Guilherme em 05/11): os produtos que precisam de reposição, separados por fornecedor,
// com a quantidade sugerida. "Criar pedido" grava no sistema (função criar_pedido, a mesma do programa) e o WhatsApp
// abre com a mensagem pronta, com o "Pedido nº" para a resposta voltar ligada ao pedido. Regras de Models/Fornecedores.cs.
// Semana 7: o modo "Pela previsão" (padrão) usa pedido_sugerido() do script 019, a mesma conta da tela Previsão de compras
// do programa (previsão até a próxima entrega + margem - estoque - já pedido, em caixas fechadas). Sem o 019 no banco,
// volta sozinho para o modo "Abaixo do mínimo" (a regra antiga).
"use strict";

const MODELO_PADRAO = "Olá{, contato}! Aqui é {usuario}, do Mercado.\nGostaria de fazer um pedido:\n{itens}\nEntrega prevista: {previsao}.\nPode confirmar, por favor? Obrigado!";
const PRAZO_PADRAO = 3;

const ped = {
  quantidades: new Map(), desmarcados: new Set(), criados: new Map(),
  modo: null,   // "previsao" ou "minimo"; lido do aparelho ao abrir a aba (app.js, que tem o lerLocal, carrega depois)
  sugerido: null, erroSugerido: null, lidoEm: 0,
};

function categoriasDe(f) { return String(f.categorias ?? "").split(",").map((c) => normalizar(c.trim())).filter(Boolean); }

/** Fornecedor do produto: o do cadastro, um dos "também compro de" ou o primeiro (A-Z) que entrega a categoria. */
function fornecedorDe(p) {
  const ativos = est.fornecedores.filter((f) => f.ativo);
  return ativos.find((f) => f.id === p.fornecedor_id)
    ?? ativos.find((f) => est.vinculos.some((v) => v.produto_id === p.id && v.fornecedor_id === f.id))
    ?? ativos.find((f) => categoriasDe(f).includes(normalizar(p.categoria)))
    ?? null;
}

/** Quanto pedir: o dobro do mínimo menos o que tem (pelo menos o mínimo); por unidade, em caixas inteiras. */
function quantidadeSugerida(p) {
  const q = Math.max(p.minimo * 2 - p.qtd, p.minimo, p.kg ? 1 : p.porCaixa);
  if (p.kg) return Math.ceil(q * 10) / 10;
  return p.porCaixa > 1 ? Math.ceil(q / p.porCaixa) * p.porCaixa : Math.ceil(q);
}

function proximaEntrega(f, data) {
  const dias = String(f.dias_entrega ?? "").split(",").filter((d) => d !== "").map(Number);
  let d = data;
  if (!dias.length) return d;
  while (!dias.includes(d.getDay())) d = somarDias(d, 1);
  return d;
}

function previsaoDoPedido(f, itens) {
  const prazo = Math.max(...itens.map((p) => p.prazo_entrega_dias ?? f.prazo_entrega_dias ?? PRAZO_PADRAO));
  return proximaEntrega(f, somarDias(hojeLocal(), prazo));
}

function mensagemDoPedido(f, linhas, previsao, numero) {
  const contato = String(f.contato ?? "").trim();
  const itens = linhas.map(({ p, q }) => {
    const qtd = p.kg ? `${Number(q).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg` : `${q} un.`;
    const caixas = !p.kg && p.porCaixa > 1 && q % p.porCaixa === 0 ? ` (${q / p.porCaixa} ${q / p.porCaixa === 1 ? "caixa" : "caixas"})` : "";
    return `- ${qtd} ${p.nome}${caixas}`;
  }).join("\n");
  const texto = (String(f.modelo_mensagem ?? "").trim() || MODELO_PADRAO)
    .replaceAll("{, contato}", contato ? ", " + contato : "")
    .replaceAll("{contato}", contato)
    .replaceAll("{fornecedor}", f.nome)
    .replaceAll("{itens}", itens)
    .replaceAll("{previsao}", previsao.toLocaleDateString("pt-BR"))
    .replaceAll("{usuario}", estado.perfil?.nome ?? "");
  return `Pedido nº ${numero}\n\n${texto}`;
}

function numeroWhatsapp(f) {
  const d = String(f.whatsapp || f.telefone || "").replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? "55" + d : d;
}

async function carregarPedir(forcar = false) {
  const alvo = $("abaPedir");
  if (!est.produtos) alvo.innerHTML = `<p class="carregando">Carregando o que precisa repor…</p>`;
  ped.modo ??= lerLocal("modo-pedir") === "minimo" ? "minimo" : "previsao";
  const lerSugerido = forcar || !ped.sugerido || Date.now() - ped.lidoEm > 60000;
  const [erro, sugerido] = await Promise.all([
    carregarEstoqueDados(forcar),
    lerSugerido ? sb.rpc("pedido_sugerido") : Promise.resolve(null),
  ]);
  if (erro) { alvo.innerHTML = `<div class="aviso perigo">${esc(mensagemDeErro(erro))}</div>`; return; }
  if (sugerido) {
    ped.sugerido = sugerido.error ? null : sugerido.data ?? [];
    ped.erroSugerido = sugerido.error ?? null;
    ped.lidoEm = Date.now();
  }
  mostrarPedir();
}

function trocarModoPedir(modo) {
  ped.modo = modo;
  gravarLocal("modo-pedir", modo);
  ped.quantidades.clear();
  ped.desmarcados.clear();
  mostrarPedir();
}

function emModoPrevisao() { return ped.modo === "previsao" && ped.sugerido != null; }

function dataCurta(texto) { return deIso(texto).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }); }

/** Grupos do modo "Pela previsão": um por fornecedor com algo a pedir, na ordem de pedir (hoje primeiro). */
function gruposDaPrevisao() {
  const produtos = new Map((est.produtos ?? []).map((p) => [p.id, p]));
  return (ped.sugerido ?? [])
    .filter((s) => s.itens.length)
    .map((s) => {
      const f = est.fornecedores.find((x) => x.id === s.fornecedor_id) ?? { id: s.fornecedor_id, nome: s.fornecedor, ativo: true };
      const itens = s.itens.map((i) => {
        const p = produtos.get(i.produto_id)
          ?? { id: i.produto_id, nome: i.nome, kg: i.unidade === "kg", porCaixa: Number(i.caixa ?? 1), qtd: Number(i.estoque), minimo: 0, situacao: "ok" };
        return { ...p, sug: i };
      });
      return { f, itens, info: s };
    })
    .sort((a, b) => a.info.data_pedido.localeCompare(b.info.data_pedido) || a.f.nome.localeCompare(b.f.nome));
}

function sugestaoDe(p) { return p.sug ? Number(p.sug.sugerido) : quantidadeSugerida(p); }

function gruposAtuais() { return emModoPrevisao() ? gruposDaPrevisao() : gruposDeReposicao(); }

function gruposDeReposicao() {
  const grupos = new Map();
  for (const p of est.produtos ?? []) {
    if (p.situacao === "ok" || est.pendentes.has(p.id)) continue;
    const f = fornecedorDe(p);
    const chave = f?.id ?? 0;
    if (!grupos.has(chave)) grupos.set(chave, { f, itens: [] });
    grupos.get(chave).itens.push(p);
  }
  const ordem = { sem: 0, baixo: 1, aviso: 2 };
  for (const g of grupos.values()) g.itens.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.nome.localeCompare(b.nome));
  return [...grupos.values()].sort((a, b) => (a.f ? 0 : 1) - (b.f ? 0 : 1) || (a.f?.nome ?? "").localeCompare(b.f?.nome ?? ""));
}

function mostrarPedir() {
  const previsao = emModoPrevisao();
  const grupos = gruposAtuais();
  const criados = [...ped.criados.values()];
  const semPrevisao = ped.modo === "previsao" && ped.sugerido == null;
  const explicacao = previsao
    ? "Pela previsão de vendas: o que vai vender até a próxima entrega, mais uma margem, menos o estoque e o que já foi pedido."
    : "Produtos sem estoque, abaixo do mínimo ou perto dele, que ainda não estão em pedido pendente.";
  $("abaPedir").innerHTML = `
    <h2>Pedir</h2>
    <div class="chips" role="group" aria-label="Como sugerir o pedido">
      <button class="chip ${ped.modo === "previsao" ? "ativo" : ""}" data-modo="previsao" aria-pressed="${ped.modo === "previsao"}">Pela previsão</button>
      <button class="chip ${ped.modo === "minimo" ? "ativo" : ""}" data-modo="minimo" aria-pressed="${ped.modo === "minimo"}">Abaixo do mínimo</button>
    </div>
    <p class="sub">${explicacao}</p>
    ${semPrevisao ? `<div class="aviso atencao"><div>A previsão não carregou; mostrando os produtos abaixo do mínimo.<small>${esc(erroDaPrevisao(ped.erroSugerido))}</small></div></div>` : ""}
    ${criados.map((c) => `<div class="aviso ok-borda"><div>Pedido nº ${c.id} para <b>${esc(c.f.nome)}</b> criado.
      <small>Envie a mensagem: o WhatsApp abre com o pedido pronto.</small>
      <div class="botoes-linha"><a class="primario link-botao" href="https://wa.me/${numeroWhatsapp(c.f)}?text=${encodeURIComponent(c.texto)}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>
      <button class="fantasma" data-copiar="${c.id}">Copiar</button></div></div></div>`).join("")}
    ${grupos.length ? grupos.map(cartaoFornecedor).join("")
      : `<p class="vazio">${previsao ? "A previsão não pede nada agora: o estoque e os pedidos a caminho cobrem até a próxima entrega." : "Nada para repor agora."}</p>`}`;

  for (const b of document.querySelectorAll("[data-modo]")) b.onclick = () => trocarModoPedir(b.dataset.modo);
  for (const c of document.querySelectorAll("[data-qtd]"))
    c.addEventListener("input", () => ped.quantidades.set(Number(c.dataset.qtd), c.value));
  for (const c of document.querySelectorAll("[data-marcar]"))
    c.addEventListener("change", () => { const id = Number(c.dataset.marcar); c.checked ? ped.desmarcados.delete(id) : ped.desmarcados.add(id); });
  for (const b of document.querySelectorAll("[data-criar]")) b.onclick = () => criarPedido(Number(b.dataset.criar), b);
  for (const b of document.querySelectorAll("[data-copiar]"))
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(ped.criados.get(Number(b.dataset.copiar)).texto); toast("Mensagem copiada."); }
      catch { toast("Não foi possível copiar."); }
    };
}

function erroDaPrevisao(e) {
  return /does not exist|PGRST202|Could not find the function/i.test(String(e?.message ?? e ?? ""))
    ? "O banco ainda não tem a previsão da semana 7 (scripts 016 e 019)."
    : mensagemDeErro(e);
}

/** Linha de baixo do item: no modo previsão, quanto vende até a entrega seguinte; no outro, a situação e o mínimo. */
function detalheDoItem(p) {
  if (p.sug) {
    const s = p.sug;
    const partes = [`tem ${formatarQtd(p, s.estoque)}`];
    if (Number(s.pendente) > 0) partes.push(`já pedido ${formatarQtd(p, s.pendente)}`);
    partes.push(`vende ~${formatarQtd(p, s.previsto)} até ${deIso(s.ate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`);
    return esc(partes.join(" · ")) + (s.eventos ? ` · <span class="txt-atencao">${esc(s.eventos)}</span>` : "");
  }
  const [rotulo, classe] = SITUACOES[p.situacao];
  return `<span class="txt-${classe}">${rotulo}</span> · tem ${formatarQtd(p, p.qtd)}, mínimo ${formatarQtd(p, p.minimo)}`;
}

function cartaoFornecedor(g) {
  const f = g.f;
  const linhas = g.itens.map((p) => {
    const q = ped.quantidades.get(p.id) ?? String(sugestaoDe(p)).replace(".", ",");
    return `<label class="item-pedido">
      <input type="checkbox" data-marcar="${p.id}" ${ped.desmarcados.has(p.id) ? "" : "checked"} ${f ? "" : "disabled"}>
      <span class="produto-nome"><b>${esc(p.nome)}</b><small>${detalheDoItem(p)}</small></span>
      <span class="qtd-pedido"><input inputmode="decimal" data-qtd="${p.id}" value="${esc(q)}" aria-label="Quantidade de ${esc(p.nome)}" ${f ? "" : "disabled"}><small>${p.kg ? "kg" : "un."}</small></span>
    </label>`;
  }).join("");
  if (!f) return `<div class="cartao"><h3>Sem fornecedor</h3><p class="sub">Ligue estes produtos a um fornecedor no programa (Estoque > Editar).</p>${linhas}</div>`;
  if (g.info) {
    const s = g.info;
    const quando = s.pedir_hoje ? `<b class="txt-atencao">Pedir hoje</b>` : `Pedir ${esc(dataCurta(s.data_pedido))}`;
    const minimo = Number(s.pedido_minimo ?? 0);
    return `<div class="cartao"><h3>${esc(f.nome)}</h3>
      <p class="sub">${quando} · chega ${esc(dataCurta(s.chegada))}${s.tem_pendente ? ` · <span class="txt-ok">pedido a caminho</span>` : ""}</p>
      ${linhas}
      <p class="sub" style="margin-top:10px">Custo estimado: <b>${esc(moeda(s.total))}</b> · ${plural(g.itens.length, "item", "itens")}</p>
      ${minimo > 0 && Number(s.total) < minimo ? `<p class="sub txt-atencao">Abaixo do pedido mínimo do fornecedor (${esc(moedaReal(minimo))}).</p>` : ""}
      <button class="primario" data-criar="${f.id}" style="margin-top:12px">Criar pedido e abrir o WhatsApp</button></div>`;
  }
  const previsao = previsaoDoPedido(f, g.itens);
  return `<div class="cartao"><h3>${esc(f.nome)}</h3>
    <p class="sub">${plural(g.itens.length, "produto", "produtos")} · entrega prevista ${previsao.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</p>
    ${linhas}
    <button class="primario" data-criar="${f.id}" style="margin-top:12px">Criar pedido e abrir o WhatsApp</button></div>`;
}

function lerQuantidade(texto, kg) {
  const v = Number(String(texto ?? "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return null;
  return kg ? Math.round(v * 1000) / 1000 : Number.isInteger(v) ? v : null;
}

async function criarPedido(fornecedorId, botao) {
  const g = gruposAtuais().find((x) => x.f?.id === fornecedorId);
  if (!g) return;
  const linhas = [];
  for (const p of g.itens) {
    if (ped.desmarcados.has(p.id)) continue;
    const q = lerQuantidade(ped.quantidades.get(p.id) ?? String(sugestaoDe(p)), p.kg);
    if (q == null) { toast(`Quantidade inválida em ${p.nome}${p.kg ? "" : " (use número inteiro)"}.`); return; }
    linhas.push({ p, q });
  }
  if (!linhas.length) { toast("Marque pelo menos um produto."); return; }
  const previsao = g.info ? deIso(g.info.chegada) : previsaoDoPedido(g.f, linhas.map((l) => l.p));
  botao.disabled = true;
  const { data: id, error } = await sb.rpc("criar_pedido", {
    p_fornecedor_id: g.f.id, p_previsao: iso(previsao), p_observacao: null,
    p_itens: linhas.map(({ p, q }) => ({ produto_id: p.id, quantidade: q, custo: null })),
  });
  if (error) { botao.disabled = false; toast(mensagemDeErro(error)); return; }
  const texto = mensagemDoPedido(g.f, linhas, previsao, id);
  ped.criados.set(id, { id, f: g.f, texto });
  for (const { p } of linhas) { ped.quantidades.delete(p.id); est.pendentes.add(p.id); }
  if (g.info) {
    // O que foi pedido agora conta como "já pedido": some da lista até a previsão ser lida de novo
    const pedidos = new Set(linhas.map(({ p }) => p.id));
    g.info.itens = g.info.itens.filter((i) => !pedidos.has(i.produto_id));
    g.info.tem_pendente = true;
    ped.lidoEm = 0;
  }
  mostrarPedir();
  window.scrollTo(0, 0);
  toast(`Pedido nº ${id} criado. Toque em "Enviar pelo WhatsApp".`);
}
