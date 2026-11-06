using System.Text.Json.Serialization;

namespace MercadinhoSeuZe.Models;

/// <summary>Caixa do dia (tabela caixas): aberto com o troco inicial e fechado com o dinheiro contado.</summary>
public sealed class Caixa
{
    [JsonPropertyName("id")] public long Id { get; set; }
    [JsonPropertyName("data")] public DateOnly Data { get; set; }
    [JsonPropertyName("nome_aberto_por")] public string NomeAbertoPor { get; set; } = "";
    [JsonPropertyName("aberto_em")] public DateTimeOffset AbertoEm { get; set; }
    [JsonPropertyName("troco_inicial")] public decimal TrocoInicial { get; set; }
    [JsonPropertyName("fechado_em")] public DateTimeOffset? FechadoEm { get; set; }
    // Colunas do fechamento (semana 6, script 006)
    [JsonPropertyName("nome_fechado_por")] public string? NomeFechadoPor { get; set; }
    [JsonPropertyName("dinheiro_contado")] public decimal? DinheiroContado { get; set; }
    [JsonPropertyName("observacao_fechamento")] public string? ObservacaoFechamento { get; set; }

    public bool Fechado => FechadoEm is not null;

    public string AbertoAs => AbertoEm.ToLocalTime().ToString("HH:mm");

    public string? FechadoAs => FechadoEm?.ToLocalTime().ToString("HH:mm");
}

/// <summary>Venda paga (tabela vendas) com os itens.</summary>
public sealed class Venda
{
    [JsonPropertyName("id")] public long Id { get; set; }
    [JsonPropertyName("caixa_id")] public long CaixaId { get; set; }
    [JsonPropertyName("nome_operador")] public string NomeOperador { get; set; } = "";
    [JsonPropertyName("criado_em")] public DateTimeOffset CriadoEm { get; set; }
    [JsonPropertyName("forma")] public string Forma { get; set; } = "";
    [JsonPropertyName("total")] public decimal Total { get; set; }
    [JsonPropertyName("recebido")] public decimal? Recebido { get; set; }
    [JsonPropertyName("troco")] public decimal Troco { get; set; }
    [JsonPropertyName("cancelada")] public bool Cancelada { get; set; }
    [JsonPropertyName("cancelada_por")] public string? CanceladaPor { get; set; }
    [JsonPropertyName("venda_itens")] public List<ItemVenda> Itens { get; set; } = [];

    public string Hora => CriadoEm.ToLocalTime().ToString("HH:mm");

    /// <summary>"Dinheiro", "Pix", "Cartão de débito" ou "Cartão de crédito" (mesmos nomes do site).</summary>
    public string NomeForma => FormasPagamento.Nome(Forma);
}

public sealed class ItemVenda
{
    [JsonPropertyName("nome_produto")] public string NomeProduto { get; set; } = "";
    [JsonPropertyName("unidade_medida")] public string UnidadeMedida { get; set; } = "un";
    [JsonPropertyName("quantidade")] public decimal Quantidade { get; set; }
    [JsonPropertyName("preco")] public decimal Preco { get; set; }
    [JsonPropertyName("subtotal")] public decimal Subtotal { get; set; }

    /// <summary>"2 un. Arroz 5kg" ou "0,75 kg Contrafilé".</summary>
    public string Descricao => UnidadeMedida == "kg"
        ? $"{Quantidade.ToString("0.###", new System.Globalization.CultureInfo("pt-BR"))} kg {NomeProduto}"
        : $"{Quantidade:0} un. {NomeProduto}";
}

public static class FormasPagamento
{
    public static readonly (string Id, string Nome)[] Todas =
    [
        ("dinheiro", "Dinheiro"), ("pix", "Pix"), ("debito", "Cartão de débito"), ("credito", "Cartão de crédito"),
    ];

    public static string Nome(string id) => Todas.FirstOrDefault(f => f.Id == id).Nome ?? id;
}

/// <summary>Item da venda ainda aberta no caixa: fica reservado até o pagamento (nada sai do estoque antes).</summary>
public sealed class ItemCarrinho
{
    public long ProdutoId { get; init; }
    /// <summary>O que a pessoa digitou: "3" ou o peso "0,750".</summary>
    public string Quantidade { get; set; } = "";
}

/// <summary>Resposta de registrar_venda.</summary>
public sealed record VendaRegistrada(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("total")] decimal Total,
    [property: JsonPropertyName("troco")] decimal Troco);

/// <summary>Totais de um dia (função vendas_por_dia), já sem as vendas canceladas.</summary>
public sealed record VendasDoDia(
    [property: JsonPropertyName("dia")] DateOnly Dia,
    [property: JsonPropertyName("total")] decimal Total,
    [property: JsonPropertyName("quantidade")] int Quantidade,
    [property: JsonPropertyName("dinheiro")] decimal Dinheiro,
    [property: JsonPropertyName("pix")] decimal Pix,
    [property: JsonPropertyName("debito")] decimal Debito,
    [property: JsonPropertyName("credito")] decimal Credito);

public sealed record MaisVendido(
    [property: JsonPropertyName("nome_produto")] string NomeProduto,
    [property: JsonPropertyName("unidade_medida")] string UnidadeMedida,
    [property: JsonPropertyName("quantidade")] decimal Quantidade,
    [property: JsonPropertyName("total")] decimal Total);
