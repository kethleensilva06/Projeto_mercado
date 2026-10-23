/*
 * Base de dados simulada (front-end).
 *
 * Faz o papel das tabelas do programa para Windows (app-windows/database): produtos com lotes, fornecedores,
 * pedidos com vários itens, vendas e caixa, enquanto o site não tem back-end. Fica guardada no
 * localStorage para que as telas leiam e escrevam nos mesmos dados.
 * Quando a API estiver pronta, troque `ler()`/`salvar()` por chamadas a ela.
 */
const Dados = (() => {
  const KEY = "mercado.dados";
  const VERSAO = 2; // 2 = lotes, pedidos com vários itens e vendas com itens (semanas 3 a 5)

  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  const hojeISO = () => iso(new Date());

  // Data relativa a hoje (ex.: dia(-3) = três dias atrás), usada nos dados de exemplo.
  function dia(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return iso(d);
  }

  // Soma dias a uma data aaaa-mm-dd.
  function somarDias(isoData, n) {
    const d = new Date(isoData + "T12:00");
    d.setDate(d.getDate() + n);
    return iso(d);
  }

  // Código de caixa DUN-14 de exemplo, com o dígito verificador certo.
  function dun14(base13) {
    const s = String(base13).padStart(13, "0");
    const soma = [...s].reduce((t, c, i) => t + Number(c) * (i % 2 === 0 ? 3 : 1), 0);
    return s + ((10 - soma % 10) % 10);
  }

  function produto(id, fornecedorId, nome, categoria, preco, minimo, extra, lotes) {
    return {
      id, fornecedorId, nome, categoria, preco, minimo,
      aviso: null, unidade: "un", diasValidade: null, codigo: "", porCaixa: 1, prazo: null, pedirAntes: false,
      ...extra,
      lotes: lotes.map((l, i) => ({ id: id * 10 + i, inicial: l[0], restante: l[1], compra: l[2], validade: l[3] || "" })),
    };
  }

  function seed() {
    return {
      versao: VERSAO,
      dia: hojeISO(),
      produtos: [
        produto(1, 1, "Arroz 5kg", "Grãos", 24.9, 10, { codigo: dun14("1789100000011"), porCaixa: 6, diasValidade: 365 },
          [[24, 12, dia(-60), dia(150)], [30, 30, dia(-11), dia(164)]]),
        produto(2, 4, "Feijão 1kg", "Grãos", 8.5, 10, { codigo: dun14("1789100000028"), porCaixa: 10, diasValidade: 180 },
          [[20, 8, dia(-22), dia(110)]]),
        produto(3, 1, "Óleo de soja", "Mercearia", 7.2, 10, { codigo: dun14("1789100000035"), porCaixa: 20, diasValidade: 300 },
          [[24, 30 - 6, dia(-35), dia(271)], [12, 6, dia(-80), dia(200)]]),
        produto(4, 3, "Sabão em pó", "Limpeza", 14.0, 6, { codigo: dun14("1789100000042"), porCaixa: 12 },
          [[12, 15 - 3, dia(-48), ""], [6, 3, dia(-90), ""]]),
        produto(5, 2, "Leite integral 1L", "Laticínios", 5.8, 12, { codigo: dun14("1789100000059"), porCaixa: 12, diasValidade: 120, prazo: 2 },
          [[48, 4, dia(-29), dia(10)]]),
        produto(6, 1, "Café 500g", "Mercearia", 18.9, 8, { codigo: dun14("1789100000066"), porCaixa: 10, diasValidade: 240, pedirAntes: true },
          [[20, 3, dia(-12), dia(131)]]),
        produto(7, 2, "Iogurte natural 170g", "Laticínios", 3.49, 10, { codigo: dun14("1789100000073"), porCaixa: 24, diasValidade: 30 },
          [[24, 12, dia(-4), dia(4)], [12, 6, dia(-40), dia(-3)]]),
        produto(8, 5, "Alcatra", "Açougue", 49.9, 5, { unidade: "kg", codigo: dun14("1789100000080"), porCaixa: 18.5, diasValidade: 10, aviso: 9 },
          [[18.5, 7.85, dia(-3), dia(7)]]),
        produto(9, 5, "Frango inteiro", "Açougue", 13.9, 8, { unidade: "kg", codigo: dun14("1789100000097"), porCaixa: 20, diasValidade: 8 },
          [[20, 14.32, dia(-2), dia(6)]]),
      ],
      fornecedores: [
        { id: 1, nome: "Distribuidora Boa Safra", telefone: "(11) 4002-1122", whatsapp: "(11) 98888-1122", email: "pedidos@boasafra.com.br", contato: "Rita", produtos: "Grãos, Mercearia", prazo: 3, envio: "whatsapp", modelo: "", observacao: "", ativo: true },
        { id: 2, nome: "Laticínios Real", telefone: "(11) 4002-5588", whatsapp: "", email: "vendas@laticiniosreal.com.br", contato: "", produtos: "Laticínios", prazo: 2, envio: "email", modelo: "", observacao: "Entrega às terças e sextas.", ativo: true },
        { id: 3, nome: "Limp Distribuidora", telefone: "(11) 4002-3344", whatsapp: "", email: "", contato: "Jorge", produtos: "Limpeza", prazo: 5, envio: "whatsapp", modelo: "", observacao: "", ativo: true },
        { id: 4, nome: "Grãos & Cia", telefone: "(11) 4002-7799", whatsapp: "", email: "contato@graosecia.com.br", contato: "", produtos: "Grãos", prazo: 7, envio: "whatsapp", modelo: "", observacao: "", ativo: true },
        { id: 5, nome: "Frigorífico Vale Verde", telefone: "(11) 4002-6611", whatsapp: "(11) 97777-6611", email: "", contato: "Seu Antônio", produtos: "Açougue", prazo: 1, envio: "whatsapp", modelo: "", observacao: "Conferir o peso na etiqueta de cada caixa.", ativo: true },
      ],
      // situacao: "pendente" (aguardando entrega), "entregue" ou "cancelado". Atraso = pendente com previsão vencida.
      pedidos: [
        { id: 1, fornecedorId: 1, data: dia(-45), previsao: dia(-42), entregue: dia(-42), status: "entregue", observacao: "", itens: [{ produtoId: 6, nome: "Café 500g", unidade: "un", qtd: 20, recebida: 20 }] },
        { id: 2, fornecedorId: 1, data: dia(-14), previsao: dia(-11), entregue: dia(-11), status: "entregue", observacao: "", itens: [{ produtoId: 1, nome: "Arroz 5kg", unidade: "un", qtd: 30, recebida: 30 }, { produtoId: 3, nome: "Óleo de soja", unidade: "un", qtd: 40, recebida: 24 }] },
        { id: 3, fornecedorId: 2, data: dia(-29), previsao: dia(-27), entregue: dia(-27), status: "entregue", observacao: "", itens: [{ produtoId: 5, nome: "Leite integral 1L", unidade: "un", qtd: 48, recebida: 48 }] },
        { id: 4, fornecedorId: 2, data: dia(-3), previsao: dia(2), status: "pendente", observacao: "", itens: [{ produtoId: 7, nome: "Iogurte natural 170g", unidade: "un", qtd: 24, recebida: null }] },
        { id: 5, fornecedorId: 3, data: dia(-30), previsao: dia(-27), entregue: dia(-27), status: "entregue", observacao: "", itens: [{ produtoId: 4, nome: "Sabão em pó", unidade: "un", qtd: 12, recebida: 12 }] },
        { id: 6, fornecedorId: 4, data: dia(-41), previsao: dia(-34), status: "pendente", observacao: "", itens: [{ produtoId: 2, nome: "Feijão 1kg", unidade: "un", qtd: 40, recebida: null }] },
      ],
      sugestoesIgnoradas: {}, // fornecedorId -> dia em que a sugestão foi ignorada
      caixa: { aberto: false },
      vendas: [],
    };
  }

  // Dados salvos pela versão anterior do site (um só lote por produto, pedido de um item): converte.
  function migrar(d) {
    let loteId = 1000;
    d.produtos = (d.produtos || []).map(p => ({
      id: p.id, fornecedorId: p.fornecedorId ?? null, nome: p.nome, categoria: p.categoria, preco: p.preco, minimo: p.minimo,
      aviso: null, unidade: "un", diasValidade: null, codigo: "", porCaixa: 1, prazo: null, pedirAntes: false,
      lotes: p.qtd > 0 ? [{ id: loteId++, inicial: p.qtd, restante: p.qtd, compra: p.compra || hojeISO(), validade: p.validade || "" }] : [],
    }));
    d.fornecedores = (d.fornecedores || []).map(f => ({
      whatsapp: "", contato: "", prazo: null, envio: "whatsapp", modelo: "", observacao: "", ativo: true, ...f,
    }));
    d.pedidos = (d.pedidos || []).map(o => ({
      observacao: "", ...o,
      itens: o.itens.map(i => {
        const p = d.produtos.find(x => x.id === i.produtoId);
        return { produtoId: i.produtoId, nome: p ? p.nome : "Produto removido", unidade: "un", qtd: i.qtd, recebida: o.status === "entregue" ? i.qtd : null };
      }),
    }));
    d.sugestoesIgnoradas = {};
    d.caixa = { aberto: false };
    d.vendas = [];
    d.versao = VERSAO;
    return d;
  }

  function ler() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
    if (!d) {
      d = seed();
      salvar(d);
    } else if (d.versao !== VERSAO) {
      d = migrar(d);
      salvar(d);
    }
    if (d.dia !== hojeISO()) {
      // Novo dia: o caixa recomeça fechado e as vendas de ontem saem da tela (os lotes já foram baixados).
      d.dia = hojeISO();
      d.vendas = [];
      d.caixa = { aberto: false };
      salvar(d);
    }
    return d;
  }

  // Dias entre hoje e a data (negativo = já passou).
  function diasAte(isoData) {
    if (!isoData) return null;
    return Math.round((new Date(isoData + "T00:00") - new Date(hojeISO() + "T00:00")) / 86400000);
  }

  const pedidoAtrasado = p => p.status === "pendente" && p.previsao && p.previsao < hojeISO();

  // Situação do fornecedor pelo último pedido (cancelados não contam): "em-dia", "pendente", "atrasado" ou "sem-pedidos".
  function statusFornecedor(d, fornecedorId) {
    const ultimo = d.pedidos.filter(p => p.fornecedorId === fornecedorId && p.status !== "cancelado")
      .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id)[0];
    if (!ultimo) return "sem-pedidos";
    if (pedidoAtrasado(ultimo)) return "atrasado";
    return ultimo.status === "pendente" ? "pendente" : "em-dia";
  }

  const proximoId = lista => lista.reduce((m, x) => Math.max(m, x.id), 0) + 1;

  function salvar(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) {}
  }

  // Avisa a tela quando os dados mudam (em outra aba ou nesta).
  function aoMudar(callback) {
    window.addEventListener("storage", e => { if (e.key === KEY) callback(); });
    window.addEventListener("mercado:dados", callback);
  }

  function notificar() {
    window.dispatchEvent(new Event("mercado:dados"));
  }

  return { ler, salvar, aoMudar, notificar, seed, hojeISO, dia, somarDias, diasAte, pedidoAtrasado, statusFornecedor, proximoId };
})();
