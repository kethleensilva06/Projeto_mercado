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
        { id: 1, nome: "Arroz 5kg", categoria: "Grãos", qtd: 42, minimo: 10, preco: 24.9, compra: dia(-29), validade: dia(164) },
        { id: 2, nome: "Feijão 1kg", categoria: "Grãos", qtd: 8, minimo: 10, preco: 8.5, compra: dia(-22), validade: dia(110) },
        { id: 3, nome: "Óleo de soja", categoria: "Mercearia", qtd: 30, minimo: 10, preco: 7.2, compra: dia(-35), validade: dia(271) },
        { id: 4, nome: "Sabão em pó", categoria: "Limpeza", qtd: 15, minimo: 6, preco: 14.0, compra: dia(-48), validade: dia(683) },
        { id: 5, nome: "Leite integral 1L", categoria: "Laticínios", qtd: 4, minimo: 12, preco: 5.8, compra: dia(-29), validade: dia(10) },
        { id: 6, nome: "Café 500g", categoria: "Mercearia", qtd: 3, minimo: 8, preco: 18.9, compra: dia(-12), validade: dia(131) },
        { id: 7, nome: "Iogurte natural 170g", categoria: "Laticínios", qtd: 18, minimo: 10, preco: 3.49, compra: dia(-4), validade: dia(4) },
      ],
      pedidos: [
        { id: 1, fornecedor: "Distribuidora Boa Safra", data: "2026-09-18", status: "pendente" },
        { id: 2, fornecedor: "Laticínios Real", data: "2026-09-10", status: "pendente" },
        { id: 3, fornecedor: "Limp Distribuidora", data: "2026-09-02", status: "entregue" },
      ],
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
    if (d.dia !== hojeISO()) {
      // Novo dia: o painel recomeça (vendas zeradas, caixa fechado).
      d.dia = hojeISO();
      d.vendas = [];
      d.caixa = { aberto: false };
      salvar(d);
    }
    return d;
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

  return { ler, salvar, aoMudar, notificar, seed, hojeISO };
})();
