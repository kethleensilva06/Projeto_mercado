/*
 * Base de dados simulada (front-end).
 *
 * Faz o papel das tabelas compartilhadas descritas no projeto (produtos,
 * pedidos, vendas e caixa) enquanto o back-end não existe. Fica guardada no
 * localStorage para que as telas leiam e escrevam nos mesmos dados.
 * Quando a API estiver pronta, troque `ler()`/`salvar()` por chamadas a ela.
 */
const Dados = (() => {
  const KEY = "mercado.dados";

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

  // Gera vendas de exemplo para o dia de hoje (determinístico).
  function vendasDeExemplo() {
    const formas = ["dinheiro", "cartao", "pix"];
    const vendas = [];
    let restante = 128450; // em centavos
    for (let i = 0; i < 32; i++) {
      const valor = i === 31 ? restante : 2200 + ((i * 739) % 3400);
      restante -= valor;
      const minutos = 8 * 60 + 5 + i * 9;
      vendas.push({
        id: 811 + i,
        hora: String(Math.floor(minutos / 60)).padStart(2, "0") + ":" + String(minutos % 60).padStart(2, "0"),
        total: valor / 100,
        forma: formas[i % 3],
      });
    }
    return vendas;
  }

  function seed() {
    return {
      dia: hojeISO(),
      produtos: [
        { id: 1, fornecedorId: 1, nome: "Arroz 5kg", categoria: "Grãos", qtd: 42, minimo: 10, preco: 24.9, compra: dia(-29), validade: dia(164) },
        { id: 2, fornecedorId: 4, nome: "Feijão 1kg", categoria: "Grãos", qtd: 8, minimo: 10, preco: 8.5, compra: dia(-22), validade: dia(110) },
        { id: 3, fornecedorId: 1, nome: "Óleo de soja", categoria: "Mercearia", qtd: 30, minimo: 10, preco: 7.2, compra: dia(-35), validade: dia(271) },
        { id: 4, fornecedorId: 3, nome: "Sabão em pó", categoria: "Limpeza", qtd: 15, minimo: 6, preco: 14.0, compra: dia(-48), validade: dia(683) },
        { id: 5, fornecedorId: 2, nome: "Leite integral 1L", categoria: "Laticínios", qtd: 4, minimo: 12, preco: 5.8, compra: dia(-29), validade: dia(10) },
        { id: 6, fornecedorId: 1, nome: "Café 500g", categoria: "Mercearia", qtd: 3, minimo: 8, preco: 18.9, compra: dia(-12), validade: dia(131) },
        { id: 7, fornecedorId: 2, nome: "Iogurte natural 170g", categoria: "Laticínios", qtd: 18, minimo: 10, preco: 3.49, compra: dia(-4), validade: dia(4) },
      ],
      fornecedores: [
        { id: 1, nome: "Distribuidora Boa Safra", telefone: "(11) 4002-1122", email: "pedidos@boasafra.com.br", produtos: "Grãos, mercearia" },
        { id: 2, nome: "Laticínios Real", telefone: "(11) 4002-5588", email: "vendas@laticiniosreal.com.br", produtos: "Laticínios" },
        { id: 3, nome: "Limp Distribuidora", telefone: "(11) 4002-3344", email: "", produtos: "Limpeza" },
        { id: 4, nome: "Grãos & Cia", telefone: "(11) 4002-7799", email: "contato@graosecia.com.br", produtos: "Grãos" },
      ],
      // status: "pendente" (aguardando entrega) ou "entregue". Atraso = pendente com previsão vencida.
      pedidos: [
        { id: 1, fornecedorId: 1, fornecedor: "Distribuidora Boa Safra", data: dia(-45), previsao: dia(-42), entregue: dia(-42), status: "entregue", itens: [{ produtoId: 6, qtd: 20 }] },
        { id: 2, fornecedorId: 1, fornecedor: "Distribuidora Boa Safra", data: dia(-14), previsao: dia(-11), entregue: dia(-11), status: "entregue", itens: [{ produtoId: 1, qtd: 30 }, { produtoId: 3, qtd: 24 }] },
        { id: 3, fornecedorId: 2, fornecedor: "Laticínios Real", data: dia(-29), previsao: dia(-27), entregue: dia(-27), status: "entregue", itens: [{ produtoId: 5, qtd: 48 }] },
        { id: 4, fornecedorId: 2, fornecedor: "Laticínios Real", data: dia(-3), previsao: dia(2), status: "pendente", itens: [{ produtoId: 7, qtd: 24 }] },
        { id: 5, fornecedorId: 3, fornecedor: "Limp Distribuidora", data: dia(-30), previsao: dia(-27), entregue: dia(-27), status: "entregue", itens: [{ produtoId: 4, qtd: 12 }] },
        { id: 6, fornecedorId: 4, fornecedor: "Grãos & Cia", data: dia(-41), previsao: dia(-34), status: "pendente", itens: [{ produtoId: 2, qtd: 40 }] },
      ],
      sugestoesIgnoradas: {}, // produtoId -> dia em que a sugestão foi ignorada
      caixa: { aberto: true, abertoPor: "Marcos", abertoAs: "08:02" },
      vendas: vendasDeExemplo(),
    };
  }

  function ler() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
    if (!d) {
      d = seed();
      salvar(d);
    } else if (d.produtos.some(p => !("validade" in p))) {
      // Dados salvos antes da tela de estoque: completa compra/validade.
      const base = seed().produtos;
      d.produtos.forEach(p => {
        const s = base.find(b => b.id === p.id);
        if (!("compra" in p)) p.compra = s ? s.compra : "";
        if (!("validade" in p)) p.validade = s ? s.validade : "";
      });
      salvar(d);
    }
    if (!d.fornecedores) {
      // Dados salvos antes da tela de fornecedores: cria fornecedores e o histórico de pedidos de exemplo.
      const base = seed();
      d.fornecedores = base.fornecedores;
      d.pedidos = base.pedidos;
      d.sugestoesIgnoradas = {};
      d.produtos.forEach(p => {
        const s = base.produtos.find(b => b.id === p.id);
        if (!("fornecedorId" in p)) p.fornecedorId = s ? s.fornecedorId : null;
      });
      salvar(d);
    }
    if (d.dia !== hojeISO()) {
      // Novo dia: o painel recomeça (vendas zeradas, caixa fechado).
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

  // Situação do fornecedor pelo último pedido: "em-dia", "pendente", "atrasado" ou "sem-pedidos".
  function statusFornecedor(d, fornecedorId) {
    const ultimo = d.pedidos.filter(p => p.fornecedorId === fornecedorId)
      .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id)[0];
    if (!ultimo) return "sem-pedidos";
    if (pedidoAtrasado(ultimo)) return "atrasado";
    return ultimo.status === "pendente" ? "pendente" : "em-dia";
  }

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

  return { ler, salvar, aoMudar, notificar, seed, hojeISO, dia, diasAte, pedidoAtrasado, statusFornecedor };
})();
