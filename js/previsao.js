(() => {
  const sessao = App.iniciar({ ativo: "previsao", perfis: ["gerente"] });
  if (!sessao) return;

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const moeda = App.moeda;
  const R = Regras;

  const DIAS_HISTORICO = 28;
  const DIAS_HORIZONTE_EXTRA = 7; // além do prazo de entrega, cobre mais uma semana

  // Peso de cada dia da semana (0 = domingo): sábado e sexta vendem mais
  const PESO_DIA = [1.0, 0.9, 0.85, 0.9, 0.95, 1.15, 1.35];

  // Calendário de exemplo (o programa lê eventos_calendario do banco)
  const EVENTOS = [
    { data: "2026-11-27", nome: "Black Friday", fator: 1.4 },
    { data: "2026-12-24", nome: "Véspera de Natal", fator: 1.6 },
    { data: "2026-12-25", nome: "Natal", fator: 0.5 },
    { data: "2026-12-31", nome: "Véspera de Ano Novo", fator: 1.5 },
    { data: "2027-01-01", nome: "Ano Novo", fator: 0.6 },
  ];

  const hoje = () => Dados.hojeISO();
  const diaSemana = iso => new Date(iso + "T12:00").getDay();
  const pesoDia = iso => PESO_DIA[diaSemana(iso)];
  const eventoDe = iso => EVENTOS.find(e => e.data === iso);

  // Número entre 0 e 1 que sempre sai igual para o mesmo produto e o mesmo dia (a tela não muda a cada abertura)
  const ruido = (id, k) => {
    const x = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  // Histórico simulado: vendas por dia dos últimos 28 dias (em unidades do produto)
  function mediaDiaria(p) {
    const base = Math.max(0.4, p.minimo * 0.35);
    let soma = 0;
    for (let k = 1; k <= DIAS_HISTORICO; k++) {
      const iso = Dados.somarDias(hoje(), -k);
      soma += base * pesoDia(iso) * (0.75 + 0.5 * ruido(p.id, k));
    }
    return soma / DIAS_HISTORICO;
  }

  // Demanda prevista para os próximos `dias` dias (com dia da semana e eventos)
  function demanda(media, dias) {
    let total = 0;
    for (let k = 0; k < dias; k++) {
      const iso = Dados.somarDias(hoje(), k);
      total += media * pesoDia(iso) * (eventoDe(iso)?.fator ?? 1);
    }
    return total;
  }

  const prazoDe = (d, p) => p.prazo ?? (d.fornecedores.find(f => f.id === p.fornecedorId)?.prazo) ?? 3;

  // Quanto pedir: o que falta para cobrir a demanda até a entrega seguinte, mais o mínimo que deve sobrar
  function quantoPedir(p, necessidade, estoque) {
    const falta = necessidade + p.minimo - estoque;
    if (falta <= 0) return 0;
    if (R.porPeso(p)) return Math.ceil(falta * 10) / 10;
    return p.porCaixa > 1 ? Math.ceil(falta / p.porCaixa) * p.porCaixa : Math.ceil(falta);
  }

  function situacao(estoque, ateEntrega, minimo) {
    if (estoque < ateEntrega) return { nivel: "pedir", texto: "Pedir agora" };
    if (estoque - ateEntrega < minimo) return { nivel: "atencao", texto: "Atenção" };
    return { nivel: "ok", texto: "OK" };
  }

  const fmt = (n, p) => R.formatar(n, R.porPeso(p));

  function render() {
    const d = Dados.ler();
    const linhas = d.produtos.map(p => {
      const media = mediaDiaria(p);
      const estoque = R.qtd(p);
      const prazo = prazoDe(d, p);
      const ateEntrega = demanda(media, prazo);
      const sete = demanda(media, 7);
      const pedir = quantoPedir(p, demanda(media, prazo + DIAS_HORIZONTE_EXTRA), estoque);
      const sit = situacao(estoque, ateEntrega, p.minimo);
      return { p, media, estoque, sete, pedir, sit, valor7: sete * p.preco };
    }).sort((a, b) => ({ pedir: 0, atencao: 1, ok: 2 })[a.sit.nivel] - ({ pedir: 0, atencao: 1, ok: 2 })[b.sit.nivel]
      || a.p.nome.localeCompare(b.p.nome, "pt-BR"));

    const paraPedir = linhas.filter(l => l.sit.nivel === "pedir").length;
    const valor7 = linhas.reduce((s, l) => s + l.valor7, 0);
    const eventos30 = EVENTOS.filter(e => e.data >= hoje() && e.data <= Dados.somarDias(hoje(), 30));

    $("kpi-pedir").textContent = String(paraPedir);
    $("kpi-7dias").textContent = moeda(valor7);
    $("kpi-eventos").textContent = String(eventos30.length);
    $("kpi-eventos-sub").textContent = eventos30.length ? eventos30.map(e => e.nome).join(", ") : "Nenhum evento no período";

    const rotulo = { pedir: "Pedir agora", atencao: "Atenção", ok: "OK" };
    $("produtos").innerHTML = linhas.map(l => `
      <tr>
        <td>${esc(l.p.nome)}</td>
        <td>${fmt(l.estoque, l.p)}</td>
        <td>${fmt(Math.round(l.media * 10) / 10, l.p)}</td>
        <td>${fmt(Math.round(l.sete * 10) / 10, l.p)}</td>
        <td><strong>${l.pedir > 0 ? fmt(l.pedir, l.p) : "—"}</strong></td>
        <td><span class="pv-situacao pv-${l.sit.nivel}">${rotulo[l.sit.nivel]}</span></td>
      </tr>`).join("");

    const proximos = EVENTOS.filter(e => e.data >= hoje()).slice(0, 6);
    $("eventos").innerHTML = proximos.length
      ? proximos.map(e => {
          const pct = Math.round((e.fator - 1) * 100);
          return `<li><span>${esc(e.nome)} · ${new Date(e.data + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                  <strong>${pct >= 0 ? "+" : ""}${pct}%</strong></li>`;
        }).join("")
      : '<li class="empty">Nenhum evento cadastrado.</li>';
  }

  render();
  Dados.aoMudar(render);
})();
