using MercadinhoSeuZe.Models;

namespace MercadinhoSeuZe.Services;

/// <summary>
/// Caixa e vendas no Supabase (scripts database/005_semana5_caixa.sql e 006_semana6_fechamento.sql).
/// Abrir, vender, cancelar e fechar só pelas funções do banco: elas conferem o perfil e dão baixa nos lotes.
/// </summary>
public sealed class CaixaService(SupabaseApi api, Sessao sessao)
{
    private const string CamposVenda = "id,caixa_id,nome_operador,criado_em,forma,total,recebido,troco,cancelada,cancelada_por," +
                                       "venda_itens(nome_produto,unidade_medida,quantidade,preco,subtotal)";

    /// <summary>Data de hoje no mercado (o mesmo dia que o banco usa, horário de Brasília).</summary>
    public static DateOnly Hoje => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTime(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("E. South America Standard Time")));

    /// <summary>O caixa de hoje, ou null se ainda não foi aberto.</summary>
    public async Task<Caixa?> CaixaDeHojeAsync()
    {
        var lista = await api.ListarAsync<Caixa>($"caixas?select=*&data=eq.{Hoje:yyyy-MM-dd}", sessao.Token);
        return lista.FirstOrDefault();
    }

    /// <summary>Vendas do caixa (inclusive as canceladas), da mais nova para a mais antiga.</summary>
    public Task<List<Venda>> VendasAsync(long caixaId) =>
        api.ListarAsync<Venda>($"vendas?select={CamposVenda}&caixa_id=eq.{caixaId}&order=id.desc", sessao.Token);

    public Task AbrirAsync(decimal trocoInicial) =>
        api.ChamarAsync<long>("abrir_caixa", new { p_troco_inicial = trocoInicial }, sessao.Token);

    /// <summary>Itens = (produto, quantidade). recebido = null no dinheiro quando o cliente pagou o valor exato.</summary>
    public async Task<VendaRegistrada> RegistrarAsync(string forma, decimal? recebido, IEnumerable<(long ProdutoId, decimal Quantidade)> itens) =>
        await api.ChamarAsync<VendaRegistrada>("registrar_venda", new
        {
            p_forma = forma,
            p_recebido = recebido,
            p_itens = itens.Select(i => new { produto_id = i.ProdutoId, quantidade = i.Quantidade }).ToList()
        }, sessao.Token) ?? throw new ConexaoException("Resposta inválida do servidor.");

    public Task CancelarVendaAsync(long vendaId) =>
        api.ChamarAsync<object>("cancelar_venda", new { p_venda_id = vendaId }, sessao.Token);

    // ------------------------------------------------------------ Fechamento (semana 6)

    public Task FecharAsync(decimal dinheiroContado, string? observacao) =>
        api.ChamarAsync<object>("fechar_caixa", new { p_dinheiro_contado = dinheiroContado, p_observacao = observacao }, sessao.Token);

    public Task ReabrirAsync() => api.ChamarAsync<object>("reabrir_caixa", new { }, sessao.Token);

    public async Task<List<VendasDoDia>> VendasPorDiaAsync(DateOnly inicio, DateOnly fim) =>
        await api.ChamarAsync<List<VendasDoDia>>("vendas_por_dia",
            new { p_inicio = inicio.ToString("yyyy-MM-dd"), p_fim = fim.ToString("yyyy-MM-dd") }, sessao.Token) ?? [];

    public async Task<List<MaisVendido>> MaisVendidosAsync(DateOnly inicio, DateOnly fim, int limite = 10) =>
        await api.ChamarAsync<List<MaisVendido>>("mais_vendidos",
            new { p_inicio = inicio.ToString("yyyy-MM-dd"), p_fim = fim.ToString("yyyy-MM-dd"), p_limite = limite }, sessao.Token) ?? [];
}
