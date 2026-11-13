using System.Globalization;
using System.Text.Json.Serialization;

namespace MercadinhoSeuZe.Models;

/// <summary>Um dia do calendário (tabela eventos_calendario, script 012) com o quanto o movimento sobe ou cai.</summary>
public sealed record EventoPrevisto(
    [property: JsonPropertyName("dia")] DateOnly Dia,
    [property: JsonPropertyName("nome")] string Nome,
    [property: JsonPropertyName("fator")] decimal Fator)
{
    /// <summary>Variação do movimento em relação a um dia normal: fator 1,4 = +40%; 0 = mercado fechado.</summary>
    public int Porcentagem => (int)Math.Round((Fator - 1m) * 100m, MidpointRounding.AwayFromZero);
}

/// <summary>Dados lidos do banco para a previsão de compras (PrevisaoService.CarregarAsync).</summary>
public sealed record DadosPrevisao(
    List<Produto> Produtos,
    List<Fornecedor> Fornecedores,
    /// <summary>Unidades (ou kg) vendidas de cada produto nos últimos 28 dias (vendas pagas).</summary>
    Dictionary<long, decimal> Vendidos,
    /// <summary>Eventos de hoje em diante (até o horizonte lido), por data.</summary>
    List<EventoPrevisto> Eventos,
    bool SemTabelaVendas,
    bool SemTabelaEventos);

public enum SituacaoCompra { Pedir, Atencao, Ok }

/// <summary>Uma linha da tabela de previsão de compras.</summary>
public sealed record LinhaPrevisao(
    Produto Produto,
    decimal Estoque,
    decimal VendeDia,
    decimal Proximos7,
    decimal Pedir,
    SituacaoCompra Situacao)
{
    public string Texto => Situacao switch
    {
        SituacaoCompra.Pedir => "Pedir agora",
        SituacaoCompra.Atencao => "Atenção",
        _ => "OK",
    };
}

/// <summary>Resultado da previsão, pronto para a tela.</summary>
public sealed record ResultadoPrevisao(
    List<LinhaPrevisao> Linhas,
    decimal VendaPrevista7,
    int ParaPedir,
    List<EventoPrevisto> EventosFuturos,
    List<EventoPrevisto> EventosEm30Dias);

/// <summary>
/// Previsão de compras (semana 7). Mesma regra do site (js/previsao.js), com as vendas reais do banco no lugar do
/// histórico simulado:
/// 1. média diária = unidades vendidas nos últimos 28 dias / 28 (sem vendas = 0);
/// 2. peso do dia da semana (domingo = 0) e fator do evento do dia (sem evento = 1);
/// 3. demanda de N dias = soma, dia a dia a partir de hoje, de média × peso × fator;
/// 4. prazo = produto, senão fornecedor, senão 3 dias;
/// 5. "Pedir agora" se o estoque não cobre a demanda até a entrega; "Atenção" se, depois dela, fica abaixo do mínimo;
/// 6. quanto pedir = demanda até (prazo + 7 dias) + mínimo − estoque, arredondado como no Estoque.
/// </summary>
public static class PrevisaoCompras
{
    public const int DiasHistorico = 28;
    public const int DiasAlemDoPrazo = 7;
    public const int PrazoPadrao = 3;

    /// <summary>Peso de cada dia da semana (0 = domingo): sábado e sexta vendem mais.</summary>
    public static readonly decimal[] PesoDia = [1.0m, 0.9m, 0.85m, 0.9m, 0.95m, 1.15m, 1.35m];

    private static readonly StringComparer Ordenacao = StringComparer.Create(CultureInfo.GetCultureInfo("pt-BR"), true);

    public static ResultadoPrevisao Calcular(DadosPrevisao dados, DateOnly hoje)
    {
        // Prazo do produto ou do fornecedor (o mesmo cálculo da tela de Estoque)
        Fornecedor.AplicarPrazos(dados.Produtos, dados.Fornecedores);

        // Se houver mais de um evento no mesmo dia, vale o primeiro (por nome), como no site
        var futuros = dados.Eventos.Where(e => e.Dia >= hoje).OrderBy(e => e.Dia).ThenBy(e => e.Nome, Ordenacao).ToList();
        var eventoDoDia = futuros.GroupBy(e => e.Dia).ToDictionary(g => g.Key, g => g.First());

        decimal Fator(DateOnly dia) => eventoDoDia.TryGetValue(dia, out var e) ? e.Fator : 1m;
        decimal Peso(DateOnly dia) => PesoDia[(int)dia.DayOfWeek];

        // Demanda dos próximos `dias` dias, a partir de hoje (inclusive)
        decimal Demanda(decimal media, int dias)
        {
            decimal total = 0;
            for (var k = 0; k < dias; k++)
            {
                var dia = hoje.AddDays(k);
                total += media * Peso(dia) * Fator(dia);
            }
            return total;
        }

        var linhas = new List<LinhaPrevisao>();
        decimal vendaPrevista7 = 0;
        foreach (var p in dados.Produtos)
        {
            var media = dados.Vendidos.TryGetValue(p.Id, out var vendidos) ? vendidos / DiasHistorico : 0m;
            var estoque = p.Quantidade;
            var prazo = p.PrazoReposicao;
            var ateEntrega = Demanda(media, prazo);
            var sete = Demanda(media, 7);
            var pedir = QuantoPedir(p, Demanda(media, prazo + DiasAlemDoPrazo), estoque);
            var situacao = estoque < ateEntrega ? SituacaoCompra.Pedir
                : estoque - ateEntrega < p.EstoqueMinimo ? SituacaoCompra.Atencao
                : SituacaoCompra.Ok;

            vendaPrevista7 += sete * p.Preco;
            linhas.Add(new LinhaPrevisao(p, estoque, media, sete, pedir, situacao));
        }

        // Pedir agora primeiro, depois Atenção, depois OK; dentro de cada grupo, por nome
        linhas = linhas
            .OrderBy(l => l.Situacao)
            .ThenBy(l => l.Produto.Nome, Ordenacao)
            .ToList();

        var fim30 = hoje.AddDays(30);
        return new ResultadoPrevisao(
            linhas,
            vendaPrevista7,
            linhas.Count(l => l.Situacao == SituacaoCompra.Pedir),
            futuros,
            futuros.Where(e => e.Dia <= fim30).ToList());
    }

    /// <summary>
    /// O que falta para cobrir a demanda até a entrega seguinte, mais o mínimo. Por unidade, em caixas inteiras;
    /// por peso, com 1 casa decimal (mesmo arredondamento de Produto.QuantidadeSugerida).
    /// </summary>
    private static decimal QuantoPedir(Produto p, decimal demandaAteProximaEntrega, decimal estoque)
    {
        var falta = demandaAteProximaEntrega + p.EstoqueMinimo - estoque;
        if (falta <= 0) return 0;
        if (p.PorPeso) return Math.Ceiling(falta * 10m) / 10m;
        return p.UnidadesPorCaixa > 1 ? Math.Ceiling(falta / p.UnidadesPorCaixa) * p.UnidadesPorCaixa : Math.Ceiling(falta);
    }
}
