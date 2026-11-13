using MercadinhoSeuZe.Models;

namespace MercadinhoSeuZe.Services;

/// <summary>
/// Leitura do banco para a previsão de compras (semana 7). Só lê: produtos e lotes (EstoqueService), fornecedores (prazo),
/// vendas pagas dos últimos 28 dias (venda_itens) e o calendário (eventos_calendario, script 012). As contas ficam em
/// Models/Previsao.cs (PrevisaoCompras.Calcular). Sem a tabela de vendas ou de eventos, a leitura segue sem elas.
/// </summary>
public sealed class PrevisaoService(SupabaseApi api, Sessao sessao)
{
    // Itens de venda vêm em páginas (o banco devolve no máximo 1000 linhas por leitura)
    private const int TamanhoPagina = 1000;
    private const int MaximoPaginas = 200;

    // Eventos lidos a partir de hoje: a demanda mais longa é prazo (até 90 dias) + 7
    private const int HorizonteEventosDias = 120;

    // Uma vez por login: o que já se descobriu do banco (scripts rodados ou não) vale para as próximas leituras
    private readonly EstoqueService _estoque = new(api, sessao);
    private readonly FornecedorService _fornecedores = new(api, sessao);

    public async Task<DadosPrevisao> CarregarAsync(DateOnly hoje)
    {
        var produtos = _estoque.ListarAsync();
        var fornecedores = TentarAsync(_fornecedores.ListarAsync, new List<Fornecedor>());
        var vendas = TentarAsync(() => VendidosAsync(hoje), new Dictionary<long, decimal>());
        var eventos = TentarAsync(() => EventosAsync(hoje), new List<EventoPrevisto>());
        await Task.WhenAll(produtos, fornecedores, vendas, eventos);

        return new DadosPrevisao(
            produtos.Result,
            fornecedores.Result.Valor,
            vendas.Result.Valor,
            eventos.Result.Valor,
            vendas.Result.Ausente,
            eventos.Result.Ausente);
    }

    /// <summary>Lê uma tabela; se ela ainda não existe no banco, devolve o vazio e avisa (a tela segue sem ela).</summary>
    private static async Task<(T Valor, bool Ausente)> TentarAsync<T>(Func<Task<T>> leitura, T vazio)
    {
        try
        {
            return (await leitura(), false);
        }
        catch (TabelaInexistenteException)
        {
            return (vazio, true);
        }
    }

    /// <summary>
    /// Unidades (ou kg) vendidas de cada produto nos 28 dias anteriores a hoje (dias completos), só vendas pagas.
    /// Vendas canceladas e itens tirados ficam de fora, como no fechamento.
    /// </summary>
    private async Task<Dictionary<long, decimal>> VendidosAsync(DateOnly hoje)
    {
        var inicio = hoje.AddDays(-PrevisaoCompras.DiasHistorico).ToString("yyyy-MM-dd");
        var fim = hoje.AddDays(-1).ToString("yyyy-MM-dd");
        var vendidos = new Dictionary<long, decimal>();

        for (var pagina = 0; pagina < MaximoPaginas; pagina++)
        {
            var linhas = await api.ListarAsync<LinhaVenda>(
                $"venda_itens?select=produto_id,quantidade,vendas!inner(dia)&vendas.situacao=eq.paga" +
                $"&vendas.dia=gte.{inicio}&vendas.dia=lte.{fim}&order=id&limit={TamanhoPagina}&offset={pagina * TamanhoPagina}",
                sessao.Token);

            foreach (var l in linhas)
                if (l.ProdutoId is { } id)
                    vendidos[id] = vendidos.GetValueOrDefault(id) + l.Quantidade;

            if (linhas.Count < TamanhoPagina) break;
        }
        return vendidos;
    }

    /// <summary>Eventos do calendário de hoje até o horizonte (script 012; o gerente altera, todos leem).</summary>
    private Task<List<EventoPrevisto>> EventosAsync(DateOnly hoje)
    {
        var fim = hoje.AddDays(HorizonteEventosDias);
        return api.ListarAsync<EventoPrevisto>(
            $"eventos_calendario?select=dia,nome,fator&and=(dia.gte.{hoje:yyyy-MM-dd},dia.lte.{fim:yyyy-MM-dd})&order=dia,nome",
            sessao.Token);
    }

    private sealed record LinhaVenda(
        [property: System.Text.Json.Serialization.JsonPropertyName("produto_id")] long? ProdutoId,
        [property: System.Text.Json.Serialization.JsonPropertyName("quantidade")] decimal Quantidade);
}
