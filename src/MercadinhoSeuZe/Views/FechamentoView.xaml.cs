using System.Globalization;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using MercadinhoSeuZe.Models;
using MercadinhoSeuZe.Services;

namespace MercadinhoSeuZe.Views;

/// <summary>
/// Fechamento do dia (semana 6): resumo das vendas de hoje, conferência do dinheiro da gaveta, fechamento do caixa
/// (função fechar_caixa), envio do resumo por e-mail e, para o gerente, as vendas por dia, semana e mês
/// (funções vendas_por_dia e mais_vendidos, script 006).
/// </summary>
public partial class FechamentoView : UserControl
{
    private static readonly CultureInfo PtBr = new("pt-BR");
    private static readonly (string Id, string Nome)[] OpcoesPeriodo = [("dia", "Por dia (14 dias)"), ("semana", "Por semana (8 semanas)"), ("mes", "Por mês (12 meses)")];

    private readonly AreaInternaView _area;
    private readonly Sessao _sessao;
    private readonly CaixaService? _servico;
    private readonly PreferenciasLocais _preferencias;
    private Caixa? _caixa;
    private List<Venda> _vendas = [];
    private string _periodo = "dia";
    private bool _carregando;

    public FechamentoView(AreaInternaView area, Sessao sessao, CaixaService? servico, PreferenciasLocais preferencias)
    {
        InitializeComponent();
        _area = area;
        _sessao = sessao;
        _servico = servico;
        _preferencias = preferencias;
        EmailResumo.Text = preferencias.EmailResumo ?? "";
        Formulario.LimparAoDigitar(EmailResumo, EmailResumoErro);
        Formulario.LimparAoDigitar(Contado, ContadoErro);
        CartaoAnalise.Visibility = sessao.Perfil == Perfil.Gerente ? Visibility.Visible : Visibility.Collapsed;
        var hoje = CaixaService.Hoje.ToDateTime(TimeOnly.MinValue).ToString("dddd, d 'de' MMMM 'de' yyyy", PtBr);
        Subtitulo.Text = char.ToUpper(hoje[0]) + hoje[1..];
        Loaded += async (_, _) => await CarregarAsync();
    }

    // ------------------------------------------------------------ Carregar e mostrar

    private async Task CarregarAsync(string? aviso = null)
    {
        if (_carregando) return;
        if (_servico is null)
        {
            MostrarErro("Sistema sem configuração do banco de dados. Veja o README.");
            return;
        }
        _carregando = true;
        try
        {
            _caixa = await _servico.CaixaDeHojeAsync();
            _vendas = _caixa is null ? [] : await _servico.VendasAsync(_caixa.Id);
            AvisoErro.Visibility = Visibility.Collapsed;
            Mostrar();
            if (aviso is not null) _area.MostrarToast(aviso);
        }
        catch (ConexaoException ex)
        {
            MostrarErro(ex.Message);
        }
        finally
        {
            _carregando = false;
        }
        if (_sessao.Perfil == Perfil.Gerente) await CarregarAnaliseAsync();
    }

    private void MostrarErro(string texto)
    {
        AvisoErroTexto.Text = texto;
        AvisoErro.Visibility = Visibility.Visible;
    }

    private async void TentarDeNovo_Click(object sender, RoutedEventArgs e) => await CarregarAsync();

    private void IrParaCaixa_Click(object sender, RoutedEventArgs e) => _area.Abrir("caixa");

    private List<Venda> Validas => _vendas.Where(v => !v.Cancelada).ToList();

    /// <summary>Troco inicial + vendas em dinheiro (o cliente deu o recebido e levou o troco: fica o total).</summary>
    private decimal Esperado => (_caixa?.TrocoInicial ?? 0) + Validas.Where(v => v.Forma == "dinheiro").Sum(v => v.Total);

    private void Mostrar()
    {
        AvisoSemCaixa.Visibility = _caixa is null ? Visibility.Visible : Visibility.Collapsed;
        CartaoConferencia.Visibility = _caixa is null ? Visibility.Collapsed : Visibility.Visible;

        var resumo = ResumoDia.De(_vendas);
        Total.Text = Moeda(resumo.Total);
        Quantidade.Text = resumo.QuantidadeVendas.ToString(PtBr);
        Ticket.Text = Moeda(resumo.TicketMedio);
        var canceladas = _vendas.Where(v => v.Cancelada).ToList();
        Canceladas.Text = canceladas.Count.ToString(PtBr);
        CanceladasValor.Text = canceladas.Count == 0 ? "Nenhuma hoje" : Moeda(canceladas.Sum(v => v.Total)) + " devolvidos";

        // Por forma de pagamento
        PorForma.Children.Clear();
        foreach (var (id, nome) in FormasPagamento.Todas)
        {
            var daForma = Validas.Where(v => v.Forma == id).ToList();
            PorForma.Children.Add(LinhaValor(nome, Moeda(daForma.Sum(v => v.Total)), Plural(daForma.Count, "venda", "vendas")));
        }

        // Mais vendidos hoje
        MaisVendidosHoje.Children.Clear();
        var itens = Validas.SelectMany(v => v.Itens)
            .GroupBy(i => (i.NomeProduto, i.UnidadeMedida))
            .Select(g => (g.Key.NomeProduto, g.Key.UnidadeMedida, Quantidade: g.Sum(i => i.Quantidade), Total: g.Sum(i => i.Subtotal)))
            .OrderByDescending(x => x.Total).Take(5).ToList();
        if (itens.Count == 0)
            MaisVendidosHoje.Children.Add(Vazio("Nenhuma venda hoje."));
        foreach (var i in itens)
            MaisVendidosHoje.Children.Add(LinhaValor(i.NomeProduto, Moeda(i.Total), FormatarQtd(i.Quantidade, i.UnidadeMedida)));

        if (_caixa is null) return;

        // Conta da gaveta
        ContaGaveta.Children.Clear();
        ContaGaveta.Children.Add(LinhaValor("Troco inicial", Moeda(_caixa.TrocoInicial)));
        ContaGaveta.Children.Add(LinhaValor("Vendas em dinheiro", "+ " + Moeda(Esperado - _caixa.TrocoInicial)));
        ContaGaveta.Children.Add(LinhaValor("Esperado na gaveta", Moeda(Esperado), destaque: true));

        PainelFechar.Visibility = _caixa.Fechado ? Visibility.Collapsed : Visibility.Visible;
        PainelFechado.Visibility = _caixa.Fechado ? Visibility.Visible : Visibility.Collapsed;
        if (_caixa.Fechado)
        {
            var contado = _caixa.DinheiroContado ?? 0;
            ContaGaveta.Children.Add(LinhaValor("Contado no fechamento", Moeda(contado)));
            ContaGaveta.Children.Add(LinhaDiferenca(contado - Esperado));
            FechadoTexto.Text = $"Caixa fechado por {_caixa.NomeFechadoPor} às {_caixa.FechadoAs}." +
                                (string.IsNullOrWhiteSpace(_caixa.ObservacaoFechamento) ? "" : $" Observação: {_caixa.ObservacaoFechamento}");
            BotaoReabrir.Visibility = _sessao.Perfil == Perfil.Gerente ? Visibility.Visible : Visibility.Collapsed;
        }
        else
        {
            MostrarDiferenca();
        }
    }

    private void Contado_TextChanged(object sender, TextChangedEventArgs e)
    {
        DicaContado.Visibility = Contado.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        MostrarDiferenca();
    }

    private void MostrarDiferenca()
    {
        if (Formulario.LerPreco(Contado.Text) is not { } contado)
        {
            Diferenca.Text = "";
            return;
        }
        var diferenca = contado - Esperado;
        Diferenca.Text = diferenca == 0 ? "Confere com o esperado."
            : diferenca > 0 ? $"Sobra de {Moeda(diferenca)} em relação ao esperado."
            : $"Falta {Moeda(-diferenca)} em relação ao esperado.";
        Diferenca.Foreground = Recurso<Brush>(diferenca == 0 ? "Verde700" : diferenca > 0 ? "Ambar700" : "Vermelho600");
    }

    // ------------------------------------------------------------ Fechar e reabrir

    private void Fechar_Click(object sender, RoutedEventArgs e)
    {
        if (Formulario.LerPreco(Contado.Text) is not { } contado)
        {
            Formulario.Validar(Contado, ContadoErro, false, "Conte o dinheiro da gaveta e digite o valor, por exemplo 350,00.");
            Contado.Focus();
            return;
        }
        var diferenca = contado - Esperado;
        var texto = $"Vendas do dia: {Moeda(ResumoDia.De(_vendas).Total)}. Dinheiro contado: {Moeda(contado)} " +
                    (diferenca == 0 ? "(confere com o esperado)." : diferenca > 0 ? $"(sobra de {Moeda(diferenca)})." : $"(falta {Moeda(-diferenca)}).") +
                    " Depois de fechar, não dá para vender nem cancelar venda de hoje.";
        _area.AbrirJanela(new ConfirmacaoJanela(_area, "Fechar o caixa de hoje?", texto, async () =>
        {
            await _servico!.FecharAsync(contado, Observacao.Text.Trim());
            _area.FecharJanela();
            await CarregarAsync("Caixa fechado. Bom descanso!");
        }, "Fechar o caixa", "Voltar"));
    }

    private void Reabrir_Click(object sender, RoutedEventArgs e) =>
        _area.AbrirJanela(new ConfirmacaoJanela(_area, "Reabrir o caixa de hoje?",
            "O fechamento é desfeito e o caixa volta a aceitar vendas. Conte o dinheiro de novo ao fechar.",
            async () =>
            {
                await _servico!.ReabrirAsync();
                _area.FecharJanela();
                await CarregarAsync("Caixa reaberto.");
            }, "Reabrir", "Voltar"));

    // ------------------------------------------------------------ Resumo por e-mail

    private string TextoResumo()
    {
        var resumo = ResumoDia.De(_vendas);
        var t = new StringBuilder();
        t.AppendLine($"Fechamento do dia {CaixaService.Hoje:dd/MM/yyyy} - Mercado");
        t.AppendLine();
        if (_caixa is null)
        {
            t.AppendLine("O caixa não foi aberto hoje.");
            return t.ToString();
        }
        t.AppendLine($"Caixa aberto por {_caixa.NomeAbertoPor} às {_caixa.AbertoAs}" +
                     (_caixa.Fechado ? $" e fechado por {_caixa.NomeFechadoPor} às {_caixa.FechadoAs}." : " (ainda aberto)."));
        t.AppendLine($"Vendas: {Moeda(resumo.Total)} em {Plural(resumo.QuantidadeVendas, "venda", "vendas")} (ticket médio {Moeda(resumo.TicketMedio)}).");
        var canceladas = _vendas.Where(v => v.Cancelada).ToList();
        if (canceladas.Count > 0)
            t.AppendLine($"Canceladas: {Plural(canceladas.Count, "venda", "vendas")} ({Moeda(canceladas.Sum(v => v.Total))}).");
        t.AppendLine();
        t.AppendLine("Por forma de pagamento:");
        foreach (var (id, nome) in FormasPagamento.Todas)
        {
            var daForma = Validas.Where(v => v.Forma == id).ToList();
            t.AppendLine($"- {nome}: {Moeda(daForma.Sum(v => v.Total))} ({Plural(daForma.Count, "venda", "vendas")})");
        }
        t.AppendLine();
        t.AppendLine($"Dinheiro na gaveta: troco inicial {Moeda(_caixa.TrocoInicial)} + vendas em dinheiro {Moeda(Esperado - _caixa.TrocoInicial)} = esperado {Moeda(Esperado)}.");
        if (_caixa.DinheiroContado is { } contado)
        {
            var diferenca = contado - Esperado;
            t.AppendLine($"Contado: {Moeda(contado)} " +
                         (diferenca == 0 ? "(confere)." : diferenca > 0 ? $"(sobra de {Moeda(diferenca)})." : $"(falta {Moeda(-diferenca)})."));
        }
        if (!string.IsNullOrWhiteSpace(_caixa.ObservacaoFechamento))
            t.AppendLine($"Observação: {_caixa.ObservacaoFechamento}");

        var itens = Validas.SelectMany(v => v.Itens)
            .GroupBy(i => (i.NomeProduto, i.UnidadeMedida))
            .Select(g => (g.Key.NomeProduto, g.Key.UnidadeMedida, Quantidade: g.Sum(i => i.Quantidade), Total: g.Sum(i => i.Subtotal)))
            .OrderByDescending(x => x.Total).Take(5).ToList();
        if (itens.Count > 0)
        {
            t.AppendLine();
            t.AppendLine("Mais vendidos:");
            var n = 1;
            foreach (var i in itens)
                t.AppendLine($"{n++}. {i.NomeProduto}: {FormatarQtd(i.Quantidade, i.UnidadeMedida)} - {Moeda(i.Total)}");
        }
        return t.ToString();
    }

    private void EnviarEmail_Click(object sender, RoutedEventArgs e)
    {
        var email = EmailResumo.Text.Trim();
        var valido = System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$");
        if (!Formulario.Validar(EmailResumo, EmailResumoErro, valido, "Digite um e-mail válido, por exemplo gerencia@mercado.com.br."))
        {
            EmailResumo.Focus();
            return;
        }
        _preferencias.EmailResumo = email;
        _preferencias.Salvar();
        if (!ContatoRapido.AbrirEmail(email, $"Fechamento do dia {CaixaService.Hoje:dd/MM/yyyy}", TextoResumo()))
            _area.MostrarToast("Nenhum programa de e-mail configurado. Use \"Copiar resumo\" e cole no seu e-mail.");
    }

    private void CopiarResumo_Click(object sender, RoutedEventArgs e) =>
        _area.MostrarToast(ContatoRapido.Copiar(TextoResumo()) ? "Resumo copiado." : "Não foi possível copiar. Tente de novo.");

    // ------------------------------------------------------------ Análise (gerente)

    private void MontarPeriodos()
    {
        Periodos.Children.Clear();
        foreach (var (id, nome) in OpcoesPeriodo)
        {
            var botao = new Button { Content = nome, Style = Recurso<Style>("Chip"), Tag = _periodo == id ? "ativo" : null };
            botao.Click += async (_, _) => { _periodo = id; await CarregarAnaliseAsync(); };
            Periodos.Children.Add(botao);
        }
    }

    private async Task CarregarAnaliseAsync()
    {
        MontarPeriodos();
        if (_servico is null) return;
        var hoje = CaixaService.Hoje;
        // Cada período: (início, fim, rótulo)
        var periodos = new List<(DateOnly Inicio, DateOnly Fim, string Rotulo)>();
        if (_periodo == "dia")
            for (var d = hoje.AddDays(-13); d <= hoje; d = d.AddDays(1))
                periodos.Add((d, d, d == hoje ? "Hoje" : d.ToString("ddd dd/MM", PtBr)));
        else if (_periodo == "semana")
        {
            var segunda = hoje.AddDays(-(((int)hoje.DayOfWeek + 6) % 7));
            for (var s = segunda.AddDays(-7 * 7); s <= segunda; s = s.AddDays(7))
                periodos.Add((s, s.AddDays(6), s == segunda ? "Esta semana" : $"{s:dd/MM} a {s.AddDays(6):dd/MM}"));
        }
        else
        {
            var primeiro = new DateOnly(hoje.Year, hoje.Month, 1);
            for (var m = primeiro.AddMonths(-11); m <= primeiro; m = m.AddMonths(1))
            {
                var nome = m.ToString("MMM/yy", PtBr);
                periodos.Add((m, m.AddMonths(1).AddDays(-1), char.ToUpper(nome[0]) + nome[1..]));
            }
        }
        var inicio = periodos[0].Inicio;
        var fim = hoje;

        try
        {
            var dias = _servico.VendasPorDiaAsync(inicio, fim);
            var mais = _servico.MaisVendidosAsync(inicio, fim, 8);
            await Task.WhenAll(dias, mais);
            AnaliseErro.Visibility = Visibility.Collapsed;
            MostrarAnalise(periodos.Select(p =>
            {
                var noPeriodo = dias.Result.Where(d => d.Dia >= p.Inicio && d.Dia <= p.Fim).ToList();
                return (p.Rotulo, Total: noPeriodo.Sum(d => d.Total), Quantidade: noPeriodo.Sum(d => d.Quantidade));
            }).ToList(), mais.Result, inicio, fim);
        }
        catch (ConexaoException ex)
        {
            AnaliseErro.Text = "Não foi possível ler as vendas do período: " + ex.Message;
            AnaliseErro.Visibility = Visibility.Visible;
            Barras.Children.Clear();
            MaisVendidosPeriodo.Children.Clear();
        }
    }

    /// <summary>Uma barra por período, todas da mesma cor (é uma série só), com o valor escrito ao lado.</summary>
    private void MostrarAnalise(List<(string Rotulo, decimal Total, int Quantidade)> linhas, List<MaisVendido> mais, DateOnly inicio, DateOnly fim)
    {
        var total = linhas.Sum(l => l.Total);
        var vendas = linhas.Sum(l => l.Quantidade);
        AnaliseResumo.Text = $"{inicio:dd/MM/yyyy} a {fim:dd/MM/yyyy}: {Moeda(total)} em {Plural(vendas, "venda", "vendas")}" +
                             (vendas > 0 ? $" · ticket médio {Moeda(total / vendas)}" : "") + ". Vendas canceladas não entram.";

        Barras.Children.Clear();
        var maior = Math.Max(linhas.Max(l => l.Total), 0.01m);
        foreach (var (rotulo, valor, quantidade) in linhas)
        {
            var linha = new Grid { Margin = new Thickness(0, 3, 0, 3), Background = Brushes.Transparent,
                ToolTip = $"{rotulo}: {Moeda(valor)} em {Plural(quantidade, "venda", "vendas")}" };
            linha.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(_periodo == "semana" ? 118 : 86) });
            linha.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            linha.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(104) });
            var nome = new TextBlock { Text = rotulo, FontSize = 13, Foreground = Recurso<Brush>("Suave"), VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.NoWrap };
            linha.Children.Add(nome);

            var trilho = new Grid { Height = 14, VerticalAlignment = VerticalAlignment.Center };
            var proporcao = (double)(valor / maior);
            trilho.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(proporcao, GridUnitType.Star) });
            trilho.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - proporcao, GridUnitType.Star) });
            if (valor > 0)
                trilho.Children.Add(new Border { Background = Recurso<Brush>("Toldo"), CornerRadius = new CornerRadius(0, 4, 4, 0) });
            var fundo = new Border { BorderBrush = Recurso<Brush>("Linha"), BorderThickness = new Thickness(1, 0, 0, 0) };
            Grid.SetColumnSpan(fundo, 2);
            trilho.Children.Add(fundo);
            Grid.SetColumn(trilho, 1);
            linha.Children.Add(trilho);

            var texto = new TextBlock { Text = valor > 0 ? Moeda(valor) : "—", FontSize = 13, FontWeight = FontWeights.SemiBold, TextAlignment = TextAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(texto, 2);
            linha.Children.Add(texto);
            System.Windows.Automation.AutomationProperties.SetName(linha, (string)linha.ToolTip);
            Barras.Children.Add(linha);
        }

        MaisVendidosPeriodo.Children.Clear();
        if (mais.Count == 0)
            MaisVendidosPeriodo.Children.Add(Vazio("Nenhuma venda no período."));
        foreach (var m in mais)
            MaisVendidosPeriodo.Children.Add(LinhaValor(m.NomeProduto, Moeda(m.Total), FormatarQtd(m.Quantidade, m.UnidadeMedida)));
    }

    // ------------------------------------------------------------ Peças

    /// <summary>"Rótulo ........ R$ 10,00" com um detalhe miúdo embaixo do rótulo, separado por linha tracejada.</summary>
    private FrameworkElement LinhaValor(string rotulo, string valor, string? detalhe = null, bool destaque = false)
    {
        var linha = new DockPanel { Margin = new Thickness(0, 7, 0, 7) };
        var direita = new TextBlock
        {
            Text = valor, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 0, 0),
            FontWeight = destaque ? FontWeights.ExtraBold : FontWeights.SemiBold, FontSize = destaque ? 18 : 14
        };
        if (destaque) direita.FontFamily = Recurso<FontFamily>("FonteTitulo");
        DockPanel.SetDock(direita, Dock.Right);
        linha.Children.Add(direita);
        var esquerda = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        esquerda.Children.Add(new TextBlock { Text = rotulo, FontSize = 14, FontWeight = destaque ? FontWeights.Bold : FontWeights.Normal });
        if (detalhe is not null)
            esquerda.Children.Add(new TextBlock { Text = detalhe, FontSize = 12, Foreground = Recurso<Brush>("Suave") });
        linha.Children.Add(esquerda);
        return new Border
        {
            BorderBrush = Recurso<Brush>(destaque ? "Tinta" : "LinhaTracejada"),
            BorderThickness = destaque ? new Thickness(0, 2, 0, 0) : new Thickness(0, 0, 0, 1),
            Child = linha
        };
    }

    private FrameworkElement LinhaDiferenca(decimal diferenca)
    {
        var texto = diferenca == 0 ? "Confere" : diferenca > 0 ? "Sobra de " + Moeda(diferenca) : "Falta " + Moeda(-diferenca);
        var linha = (Border)LinhaValor("Diferença", texto);
        var dock = (DockPanel)linha.Child;
        ((TextBlock)dock.Children[0]).Foreground = Recurso<Brush>(diferenca == 0 ? "Verde700" : diferenca > 0 ? "Ambar700" : "Vermelho600");
        return linha;
    }

    private TextBlock Vazio(string texto) => new() { Text = texto, Style = Recurso<Style>("TextoSuave"), FontSize = 14, Margin = new Thickness(0, 6, 0, 6) };

    private void AoRedimensionar(object sender, SizeChangedEventArgs e)
    {
        Totais.Columns = e.NewSize.Width < 520 ? 1 : e.NewSize.Width < 900 ? 2 : 4;
        var empilhar = e.NewSize.Width < 820;
        ColunaDireita.Width = empilhar ? new GridLength(0) : new GridLength(1, GridUnitType.Star);
        Grid.SetColumn(ColunaResumo, empilhar ? 0 : 1);
        Grid.SetRow(ColunaResumo, empilhar ? 1 : 0);
        CartaoConferencia.Margin = new Thickness(0, 0, empilhar ? 0 : 20, 20);
        ColunaMaisVendidos.Width = empilhar ? new GridLength(0) : new GridLength(1, GridUnitType.Star);
        Grid.SetColumn(BlocoMaisVendidos, empilhar ? 0 : 1);
        Grid.SetRow(BlocoMaisVendidos, empilhar ? 1 : 0);
        BlocoMaisVendidos.Margin = new Thickness(0, empilhar ? 18 : 0, 0, 0);
        Barras.Margin = new Thickness(0, 0, empilhar ? 0 : 24, 0);
    }

    private T Recurso<T>(string chave) => (T)FindResource(chave);

    private static string Moeda(decimal valor) => valor.ToString("C", PtBr);

    private static string FormatarQtd(decimal q, string unidade) => Produto.FormatarQuantidade(q, unidade == "kg");

    private static string Plural(int n, string um, string varios) => $"{n} {(n == 1 ? um : varios)}";
}
