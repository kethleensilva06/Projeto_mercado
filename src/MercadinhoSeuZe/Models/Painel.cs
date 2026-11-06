namespace MercadinhoSeuZe.Models;

/// <summary>Totais de vendas do dia (o que todos os perfis podem ver), sem as vendas canceladas.</summary>
public record ResumoDia(decimal Total, int QuantidadeVendas)
{
    public decimal TicketMedio => QuantidadeVendas > 0 ? Total / QuantidadeVendas : 0;

    public static ResumoDia De(IEnumerable<Venda> vendas)
    {
        var validas = vendas.Where(v => !v.Cancelada).ToList();
        return new(validas.Sum(v => v.Total), validas.Count);
    }
}
