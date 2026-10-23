/*
 * Regras do estoque, dos fornecedores e do caixa, iguais às do programa para Windows
 * (app-windows/src/MercadinhoSeuZe/Models). Usadas pelo Painel, Estoque, Fornecedores e Caixa.
 */
const Regras = (() => {
  const DIAS_ALERTA = 30;   // validade "próxima" = vence em até 30 dias
  const DIAS_CONSUMO = 60;  // dias para trás na conta do que sai por dia
  const PRAZO_PADRAO = 3;   // prazo de entrega quando o fornecedor não tem um

  const norm = s => String(s ?? "").trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const porNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR");

  // ---------- Quantidades ----------
  const porPeso = p => p.unidade === "kg";
  const qtd = p => arred(p.lotes.reduce((s, l) => s + l.restante, 0));
  const arred = n => Math.round(n * 1000) / 1000;
  const sigla = p => porPeso(p) ? "kg" : "un.";

  // "12" ou "12,35"
  function numero(n, kg) {
    return kg ? n.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) : String(Math.round(n));
  }
  // "12 unidades", "1 unidade" ou "12,35 kg"
  function formatar(n, kg) {
    return kg ? numero(n, true) + " kg" : `${numero(n)} ${Math.round(n) === 1 ? "unidade" : "unidades"}`;
  }

  // "8,50", "R$ 1.234,90" → número; NaN se inválido
  function lerPreco(txt) {
    const limpo = String(txt).replace(/[R$\s]/g, "");
    if (!/^\d{1,3}(\.?\d{3})*(,\d{1,2})?$/.test(limpo)) return NaN;
    return Number(limpo.replace(/\./g, "").replace(",", "."));
  }
  // Quantidade de 0 para cima: inteira por unidade; até 3 casas por quilo ("12,350"). NaN se inválida.
  function lerQtd(txt, kg) {
    let s = String(txt).replace(/kg/i, "").trim();
    if (!kg) return /^\d{1,6}$/.test(s) ? Number(s) : NaN;
    if (!s.includes(",")) s = s.replace(".", ",");
    return /^\d{1,6}(,\d{1,3})?$/.test(s) ? Number(s.replace(",", ".")) : NaN;
  }
  const paraCampo = n => String(arred(n)).replace(".", ",");

  // ---------- Validade ----------
  function situacao(validade) {
    const d = Dados.diasAte(validade);
    if (d === null) return null;
    if (d < 0) return { nivel: "vencido", texto: d === -1 ? "Venceu ontem" : `Venceu há ${-d} dias`, dias: d };
    if (d === 0) return { nivel: "atencao", texto: "Vence hoje", dias: d };
    if (d <= DIAS_ALERTA) return { nivel: "atencao", texto: d === 1 ? "Vence amanhã" : `Vence em ${d} dias`, dias: d };
    return { nivel: "ok", texto: `Vence em ${d} dias`, dias: d };
  }
  // Validade mais próxima entre os lotes que ainda têm unidades.
  const proximaValidade = p => p.lotes.filter(l => l.restante > 0 && l.validade).map(l => l.validade).sort()[0] || "";
  const situacaoProduto = p => situacao(proximaValidade(p));
  const vencido = p => situacaoProduto(p)?.nivel === "vencido";
  const validadeProxima = p => situacaoProduto(p)?.nivel === "atencao";

  // Dias de validade para um lote novo: a validade padrão ou o prazo do último lote com validade.
  function diasValidadeSugerida(p) {
    if (p.diasValidade) return p.diasValidade;
    const l = [...p.lotes].filter(x => x.validade && x.validade > x.compra).sort((a, b) => b.compra.localeCompare(a.compra) || b.id - a.id)[0];
    return l ? Math.round((new Date(l.validade + "T12:00") - new Date(l.compra + "T12:00")) / 86400000) : null;
  }

  // ---------- Situação do estoque ----------
  const semEstoque = p => qtd(p) === 0;
  const baixo = p => !semEstoque(p) && qtd(p) < p.minimo;

  // O que sai por dia: o que saiu dos lotes comprados nos últimos 60 dias / dias desde a compra mais antiga deles.
  function consumoDiario(p) {
    const limite = Dados.dia(-DIAS_CONSUMO);
    const recentes = p.lotes.filter(l => l.compra >= limite);
    const saiu = recentes.reduce((s, l) => s + (l.inicial - l.restante), 0);
    if (saiu <= 0) return null;
    const maisAntiga = recentes.map(l => l.compra).sort()[0];
    return saiu / Math.max(1, -Dados.diasAte(maisAntiga));
  }

  // Ponto de pedido do "Pedir antes de acabar": mínimo + o que sai por dia × prazo de entrega.
  function pontoDePedido(p, prazo) {
    const porDia = consumoDiario(p);
    if (!p.pedirAntes || porDia === null) return null;
    const ponto = p.minimo + porDia * prazo;
    return porPeso(p) ? Math.ceil(ponto * 10) / 10 : Math.ceil(ponto);
  }

  const avisoPadrao = p => porPeso(p) ? Math.ceil(p.minimo * 15) / 10 : Math.ceil(p.minimo * 1.5);

  // Com esta quantidade ou menos (e ainda acima do mínimo) aparece o aviso amarelo antecipado.
  function limiteAviso(p, d) {
    const ponto = pontoDePedido(p, d ? prazoReposicao(d, p) : PRAZO_PADRAO);
    return ponto ?? (p.aviso ?? avisoPadrao(p));
  }
  const avisoAntecipado = (p, d) => !semEstoque(p) && !baixo(p) && qtd(p) <= limiteAviso(p, d) && limiteAviso(p, d) > p.minimo;
  const precisaRepor = (p, d) => semEstoque(p) || baixo(p) || avisoAntecipado(p, d);

  // Quanto pedir: o dobro do mínimo menos o que tem (pelo menos o mínimo); por unidade, caixas inteiras.
  function qtdSugerida(p) {
    const q = Math.max(p.minimo * 2 - qtd(p), p.minimo, porPeso(p) ? 1 : p.porCaixa);
    if (porPeso(p)) return Math.ceil(q * 10) / 10;
    return p.porCaixa > 1 ? Math.ceil(q / p.porCaixa) * p.porCaixa : Math.ceil(q);
  }

  // ---------- Fornecedores ----------
  const categoriasDe = f => String(f.produtos || "").split(",").map(c => c.trim()).filter(Boolean);
  // O produto é deste fornecedor: ligado a ele ou, sem ligação, da categoria que ele entrega.
  const fornece = (f, p) => p.fornecedorId === f.id || (!p.fornecedorId && categoriasDe(f).some(c => norm(c) === norm(p.categoria)));
  const ativos = d => d.fornecedores.filter(f => f.ativo !== false).sort(porNome);
  // Fornecedor do produto: o ligado a ele ou o primeiro (A-Z) ativo que entrega a categoria.
  const fornecedorDoProduto = (d, p) =>
    ativos(d).find(f => f.id === p.fornecedorId) || ativos(d).find(f => !p.fornecedorId && fornece(f, p)) || null;
  const prazoFornecedor = f => f && f.prazo ? f.prazo : PRAZO_PADRAO;
  const prazoReposicao = (d, p) => p.prazo || prazoFornecedor(fornecedorDoProduto(d, p));
  const jaPedido = (d, p) => d.pedidos.some(o => o.status === "pendente" && o.itens.some(i => i.produtoId === p.id));

  const MODELO_PADRAO =
    "Olá{, contato}! Aqui é {usuario}, do Mercado.\n" +
    "Gostaria de fazer um pedido:\n" +
    "{itens}\n" +
    "Entrega prevista: {previsao}.\n" +
    "Pode confirmar, por favor? Obrigado!";

  // Mensagem de pedido pelo modelo do fornecedor. itens: [{ nome, qtd, unidade, porCaixa }]
  function mensagemPedido(f, itens, previsao, usuario) {
    const lista = itens.map(i => {
      const kg = i.unidade === "kg";
      const caixas = !kg && i.porCaixa > 1 && i.qtd % i.porCaixa === 0
        ? ` (${i.qtd / i.porCaixa} ${i.qtd / i.porCaixa === 1 ? "caixa" : "caixas"})` : "";
      return `- ${numero(i.qtd, kg)} ${kg ? "kg" : "un."} ${i.nome}${caixas}`;
    }).join("\n");
    const contato = (f.contato || "").trim();
    return (f.modelo && f.modelo.trim() ? f.modelo : MODELO_PADRAO)
      .replaceAll("{, contato}", contato ? ", " + contato : "")
      .replaceAll("{contato}", contato)
      .replaceAll("{fornecedor}", f.nome)
      .replaceAll("{itens}", lista)
      .replaceAll("{previsao}", previsao ? App.dataBR(previsao) : "a combinar")
      .replaceAll("{usuario}", usuario);
  }

  const soDigitos = s => String(s || "").replace(/\D/g, "");
  function linkWhatsapp(f, texto) {
    let n = soDigitos(f.whatsapp || f.telefone);
    if (n.length === 10 || n.length === 11) n = "55" + n;
    return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
  }
  const linkEmail = (f, assunto, texto) =>
    `mailto:${encodeURIComponent((f.email || "").trim())}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`;

  function mascaraTelefone(v) {
    const n = soDigitos(v).slice(0, 11);
    if (n.length <= 2) return n.length ? `(${n}` : "";
    if (n.length <= 6) return `(${n.slice(0, 2)}) ${n.slice(2)}`;
    if (n.length <= 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
    return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  }

  // ---------- Caixa ----------
  // Lotes que podem ser vendidos: com unidades e dentro da validade (lote vencido fica bloqueado).
  const lotesVendaveis = p => p.lotes.filter(l => l.restante > 0 && (!l.validade || l.validade >= Dados.hojeISO()));
  const vendavel = p => arred(lotesVendaveis(p).reduce((s, l) => s + l.restante, 0));
  const vencida = p => arred(qtd(p) - vendavel(p));

  // De onde sai a quantidade: o lote que vence primeiro sai primeiro. null se não houver o bastante.
  function separar(p, quantidade) {
    let falta = quantidade;
    const baixas = [];
    const ordem = lotesVendaveis(p).sort((a, b) =>
      (a.validade || "9999").localeCompare(b.validade || "9999") || a.compra.localeCompare(b.compra) || a.id - b.id);
    for (const l of ordem) {
      if (falta <= 0) break;
      const sai = Math.min(falta, l.restante);
      baixas.push({ loteId: l.id, qtd: arred(sai) });
      falta = arred(falta - sai);
    }
    return falta > 0 ? null : baixas;
  }

  // Código da caixa (DUN-14) ou da unidade (EAN-13): o DUN-14 repete os 12 primeiros dígitos do EAN-13.
  function porCodigo(produtos, codigo) {
    return produtos.find(p => p.codigo === codigo) ||
      (codigo.length === 13 ? produtos.find(p => /^\d{14}$/.test(p.codigo || "") && p.codigo.slice(1, 13) === codigo.slice(0, 12)) : null) || null;
  }

  const FORMAS = { dinheiro: "Dinheiro", pix: "Pix", debito: "Cartão de débito", credito: "Cartão de crédito" };

  // ---------- Categorias: cor e ícone (iguais a Views/CategoriaVisual.cs) ----------
  const ICONES = {
    carne: '<ellipse cx="11" cy="12" rx="8" ry="6"/><circle cx="11" cy="12" r="2"/><path d="M19 12h2"/>',
    queijo: '<path d="M3 18l10-12 8 12z"/><path d="M3 18v2h18v-2"/>',
    trigo: '<path d="M12 21V9M12 9c-3 0-4-3-4-5 2 0 4 1 4 5zM12 9c3 0 4-3 4-5-2 0-4 1-4 5zM12 15c-3 0-4-3-4-5 2 0 4 1 4 5zM12 15c3 0 4-3 4-5-2 0-4 1-4 5z"/>',
    cesta: '<path d="M3 10h18l-2 10H5zM7 10l5-6 5 6M9 14v3M15 14v3"/>',
    pao: '<path d="M5 11a7 4 0 0 1 14 0v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM9 9v3M12 8v3M15 9v3"/>',
    garrafa: '<path d="M9 3h6v3l2 3v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9l2-3zM7 13h10"/>',
    copo: '<path d="M6 4h12l-1.5 16h-9zM6.5 9h11"/>',
    floco: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
    folha: '<path d="M5 19C5 10 10 5 20 4c-1 10-6 15-15 15zM5 19l8-8"/>',
    bolhas: '<circle cx="9" cy="15" r="5"/><circle cx="17" cy="6" r="3"/><circle cx="17" cy="15" r="2"/>',
    gota: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
    pata: '<path d="M8 16c0-2 2-4 4-4s4 2 4 4-2 4-4 4-4-2-4-4z"/><circle cx="6" cy="10" r="1.5"/><circle cx="10" cy="6" r="1.5"/><circle cx="14" cy="6" r="1.5"/><circle cx="18" cy="10" r="1.5"/>',
    etiqueta: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="8" cy="8" r=".5"/>',
  };
  const CONHECIDAS = [
    [["acougue", "carne", "frango", "peixe"], "carne", "vermelho"],
    [["frios", "embutido"], "queijo", "rosa"],
    [["grao", "cereal"], "trigo", "ambar"],
    [["mercearia"], "cesta", "marrom"],
    [["padaria", "pao"], "pao", "ambar"],
    [["laticinio", "leite"], "garrafa", "azul"],
    [["bebida"], "copo", "ciano"],
    [["congelado"], "floco", "azul"],
    [["hortifruti", "fruta", "verdura", "legume"], "folha", "verde"],
    [["limpeza"], "bolhas", "roxo"],
    [["higiene", "perfumaria", "beleza"], "gota", "indigo"],
    [["pet", "animal"], "pata", "marrom"],
  ];
  const PALETA = ["verde", "azul", "ambar", "roxo", "ciano", "rosa", "indigo", "marrom"];

  function categoria(nome) {
    const chave = norm(nome);
    const achada = CONHECIDAS.find(([palavras]) => palavras.some(p => chave.includes(p)));
    if (achada) return { icone: ICONES[achada[1]], cor: achada[2] };
    let h = 17;
    for (const c of chave) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return { icone: ICONES.etiqueta, cor: PALETA[h % PALETA.length] };
  }
  // Etiqueta colorida com ícone e nome (o nome sempre aparece, não depende só da cor).
  function pilulaCategoria(nome) {
    const v = categoria(nome);
    return `<span class="cat cat-${v.cor}"><svg viewBox="0 0 24 24" aria-hidden="true">${v.icone}</svg>${App.esc(nome)}</span>`;
  }

  return {
    DIAS_ALERTA, PRAZO_PADRAO, MODELO_PADRAO, FORMAS, norm, porNome, porPeso, qtd, arred, sigla, numero, formatar, lerPreco, lerQtd, paraCampo,
    situacao, proximaValidade, situacaoProduto, vencido, validadeProxima, diasValidadeSugerida,
    semEstoque, baixo, consumoDiario, limiteAviso, avisoAntecipado, precisaRepor, qtdSugerida,
    categoriasDe, fornece, ativos, fornecedorDoProduto, prazoFornecedor, prazoReposicao, jaPedido,
    mensagemPedido, linkWhatsapp, linkEmail, mascaraTelefone, soDigitos,
    lotesVendaveis, vendavel, vencida, separar, porCodigo, categoria, pilulaCategoria,
  };
})();
