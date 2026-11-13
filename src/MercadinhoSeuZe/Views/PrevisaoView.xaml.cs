using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using MercadinhoSeuZe.Models;
using MercadinhoSeuZe.Services;

namespace MercadinhoSeuZe.Views;

/// <summary>
/// Previsão de compras (semana 7, só o gerente). Lê o estoque, as vendas dos últimos 28 dias e o calendário ao abrir a
/// tela (e no botão "Atualizar"; sem timers). Mostra os indicadores, a tabela de produtos (pedir agora, atenção, OK) e os
/// próximos eventos com a variação do movimento. Com "Ocultar vendas" ligado, os valores em R$ ficam escondidos.
/// </summary>
public partial class PrevisaoView : UserControl
{
    private static readonly CultureInfo PtBr = new("pt-BR");

    // Larguras da tabela: Produto (flexível), Estoque, Vende/dia, Próx. 7 dias, Pedir, Situação
    private static readonly GridLength[] ColunasTabela =
    [
        new(1, GridUnitType.Star), new(110), new(100), new(110), new(100), new(120)
    ];

    private readonly AreaInternaView _area;
    private readonly PrevisaoService? _servico;
    private DadosPrevisao? _dados;
    private ResultadoPrevisao? _resultado;
    private bool _estreita;

    public PrevisaoView(AreaInternaView area, PrevisaoService? servico)
    {
        InitializeComponent();
        _area = area;
        _servico = servico;
        Loaded += async (_, _) =>
        {
            ValoresVenda.Mudou += Redesenhar;
            await CarregarAsync();
        };
        Unloaded += (_, _) => ValoresVenda.Mudou -= Redesenhar;
    }

    // ------------------------------------------------------------ Dados

    private async Task CarregarAsync()
    {
        AvisoErro.Visibility = Visibility.Collapsed;
        AvisoTabelas.Visibility = Visibility.Collapsed;
        if (_servico is null)
        {
            MostrarErro("Sistema sem configuração do banco de dados. Veja o README.");
            return;
        }
        Subtitulo.Text = "Calculando a previsão…";
        try
        {
            var hoje = DateOnly.FromDateTime(DateTime.Today);
            _dados = await _servico.CarregarAsync(hoje);
            _resultado = PrevisaoCompras.Calcular(_dados, hoje);
        }
        catch (ConexaoException ex)
        {
            MostrarErro(ex.Message);
            return;
        }
        catch (Exception)
        {
            // Erro inesperado: a tela avisa e continua funcionando (o tratador global não derruba o programa)
            MostrarErro("Não foi possível calcular a previsão agora. Tente de novo.");
            return;
        }

        var avisos = new List<string>();
        if (_dados.SemTabelaVendas)
            avisos.Add("As tabelas de vendas ainda não foram criadas no banco (script database/006_semana5_caixa.sql). Sem vendas, a média é zero.");
        if (_dados.SemTabelaEventos)
            avisos.Add("O calendário de eventos ainda não existe no banco (script database/012_semana6_ajustes.sql). A previsão segue sem eventos.");
        if (avisos.Count > 0)
        {
            AvisoTabelasTexto.Text = string.Join(" ", avisos);
            AvisoTabelas.Visibility = Visibility.Visible;
        }

        Subtitulo.Text = $"Atualizado às {DateTime.Now:HH:mm} · {Plural(_resultado.Linhas.Count, "produto", "produtos")}";
        Render();
    }

    private void MostrarErro(string mensagem)
    {
        AvisoErroTexto.Text = mensagem;
        AvisoErro.Visibility = Visibility.Visible;
        Subtitulo.Text = "Não foi possível carregar a previsão.";
    }

    private async void Atualizar_Click(object sender, RoutedEventArgs e) => await CarregarAsync();

    private void Redesenhar()
    {
        if (_resultado is not null) Render();
    }

    private void AoRedimensionar(object sender, SizeChangedEventArgs e)
    {
        var estreita = e.NewSize.Width < 900;
        if (estreita == _estreita) return;
        _estreita = estreita;
        Redesenhar();
    }

    // ------------------------------------------------------------ Desenho

    private void Render()
    {
        var r = _resultado!;

        Kpis.Children.Clear();
        Kpis.Children.Add(Kpi("IconeAlerta", r.ParaPedir > 0 ? "Vermelho600" : "Verde700", r.ParaPedir.ToString(PtBr), "Para pedir",
            r.ParaPedir == 0 ? "Nenhum produto abaixo da demanda até a entrega" : "Produtos em “Pedir agora”"));
        Kpis.Children.Add(Kpi("IconeCarteira", "Verde700", ValoresVenda.Moeda(r.VendaPrevista7), "Venda prevista (7 dias)",
            "Quantidade prevista × preço, nos próximos 7 dias"));
        Kpis.Children.Add(Kpi("IconeEtiqueta", "Ambar700", r.EventosEm30Dias.Count.ToString(PtBr), "Eventos nos próximos 30 dias",
            r.EventosEm30Dias.Count == 0 ? "Nenhum evento no período" : string.Join(", ", r.EventosEm30Dias.Select(e => e.Nome))));
        Kpis.Columns = Kpis.Children.Count;

        Conteudo.Children.Clear();
        var tabela = Cartao("Produtos", Tabela(r.Linhas));
        var eventos = Cartao("Próximos eventos", ListaEventos(r.EventosFuturos.Take(6)), margemBaixo: 16);
        Conteudo.Children.Add(DuasColunas(tabela, eventos));
    }

    private FrameworkElement Tabela(List<LinhaPrevisao> linhas)
    {
        var painel = new StackPanel();
        painel.Children.Add(Suave("Pedir agora e atenção vêm primeiro. “Pedir” cobre a entrega e mais 7 dias."));
        if (linhas.Count == 0)
        {
            painel.Children.Add(Suave("Nenhum produto cadastrado."));
            return painel;
        }

        // Cabeçalho da tabela
        painel.Children.Add(LinhaTabela(
            new TextBlock { Text = "PRODUTO", Style = Estilo("Cabecalho") },
            "ESTOQUE", "VENDE/DIA", "PRÓX. 7 DIAS", "PEDIR", null));

        foreach (var l in linhas)
        {
            painel.Children.Add(new Border { Height = 1, Background = Pincel("Linha") });
            var p = l.Produto;
            var nome = new TextBlock
            {
                Text = p.Nome, FontSize = 15, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center, ToolTip = p.Nome
            };
            painel.Children.Add(LinhaTabela(nome,
                Quantidade(l.Estoque, p), Previsto(l.VendeDia, p), Previsto(l.Proximos7, p),
                l.Pedir > 0 ? Quantidade(l.Pedir, p) : "—", l));
        }
        return painel;
    }

    /// <summary>
    /// Uma linha da tabela. Cabeçalho: linha = null (textos em maiúsculas). Produto: linha preenchida (situação em etiqueta).
    /// Colunas: produto, estoque, vende/dia, próx. 7 dias, pedir, situação.
    /// </summary>
    private Grid LinhaTabela(FrameworkElement primeira, string estoque, string vendeDia, string proximos, string pedir, LinhaPrevisao? linha)
    {
        var cabecalho = linha is null;
        var grade = new Grid { Margin = new Thickness(0, cabecalho ? 0 : 10, 0, cabecalho ? 10 : 10) };
        foreach (var largura in ColunasTabela) grade.ColumnDefinitions.Add(new ColumnDefinition { Width = largura });

        grade.Children.Add(primeira);
        Grid.SetColumn(primeira, 0);
        Celula(grade, estoque, 1, cabecalho);
        Celula(grade, vendeDia, 2, cabecalho);
        Celula(grade, proximos, 3, cabecalho);
        Celula(grade, pedir, 4, cabecalho, negrito: true);

        if (linha is null)
        {
            var rotulo = new TextBlock { Text = "SITUAÇÃO", Style = Estilo("Cabecalho"), Margin = new Thickness(4, 0, 0, 0) };
            Grid.SetColumn(rotulo, 5);
            grade.Children.Add(rotulo);
        }
        else
        {
            var (fundo, cor) = linha.Situacao switch
            {
                SituacaoCompra.Pedir => ("Vermelho50", "Vermelho600"),
                SituacaoCompra.Atencao => ("Ambar50", "Ambar700"),
                _ => ("Verde50", "Verde700"),
            };
            var pilula = new Border
            {
                Background = Pincel(fundo), CornerRadius = new CornerRadius(3), Padding = new Thickness(8, 3, 8, 3),
                Margin = new Thickness(4, 0, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock { Text = linha.Texto, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = Pincel(cor) }
            };
            Grid.SetColumn(pilula, 5);
            grade.Children.Add(pilula);
        }
        return grade;
    }

    /// <summary>Número alinhado à direita numa coluna da tabela (cabeçalho em maiúsculas, pequeno).</summary>
    private void Celula(Grid grade, string texto, int coluna, bool cabecalho, bool negrito = false)
    {
        var t = cabecalho
            ? new TextBlock { Text = texto, Style = Estilo("Cabecalho") }
            : new TextBlock { Text = texto, FontSize = 14, FontWeight = negrito ? FontWeights.Bold : FontWeights.Normal, VerticalAlignment = VerticalAlignment.Center };
        t.TextAlignment = TextAlignment.Right;
        t.HorizontalAlignment = HorizontalAlignment.Stretch;
        t.Margin = new Thickness(0, 0, 12, 0);
        Grid.SetColumn(t, coluna);
        grade.Children.Add(t);
    }

    private FrameworkElement ListaEventos(IEnumerable<EventoPrevisto> eventos)
    {
        var lista = new StackPanel();
        var lidos = eventos.ToList();
        if (lidos.Count == 0)
        {
            lista.Children.Add(Suave("Nenhum evento cadastrado."));
            return lista;
        }
        foreach (var e in lidos)
        {
            var linha = new DockPanel { Margin = new Thickness(0, 8, 0, 8) };
            var pct = e.Porcentagem;
            var texto = (pct >= 0 ? "+" : "−") + Math.Abs(pct).ToString(PtBr) + "%";
            var porcentagem = new TextBlock
            {
                Text = texto, FontSize = 15, FontWeight = FontWeights.Bold, VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(12, 0, 0, 0),
                Foreground = Pincel(pct > 0 ? "Verde700" : "Suave")
            };
            DockPanel.SetDock(porcentagem, Dock.Right);
            linha.Children.Add(porcentagem);

            var texto2 = new StackPanel();
            texto2.Children.Add(new TextBlock { Text = e.Nome, FontSize = 14.5, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, ToolTip = e.Nome });
            texto2.Children.Add(Suave(e.Dia.ToString("ddd dd/MM", PtBr)));
            linha.Children.Add(texto2);

            if (lista.Children.Count > 0) lista.Children.Add(new Border { Height = 1, Background = Pincel("Linha") });
            lista.Children.Add(linha);
        }
        return lista;
    }

    /// <summary>Indicador da faixa (mesmo visual do Fechamento e do Estoque, sem clique).</summary>
    private Button Kpi(string icone, string cor, string valor, string rotulo, string dica)
    {
        var conteudo = new StackPanel();
        conteudo.Children.Add(new Border
        {
            Width = 22, Height = 22, HorizontalAlignment = HorizontalAlignment.Left,
            Child = new ContentControl { Style = Estilo("Icone"), Tag = FindResource(icone), Foreground = Pincel(cor), Width = 16 }
        });
        conteudo.Children.Add(new TextBlock { Text = valor, Style = Estilo("KpiValor"), TextTrimming = TextTrimming.CharacterEllipsis });
        conteudo.Children.Add(new TextBlock { Text = rotulo, Style = Estilo("KpiRotulo") });
        conteudo.Children.Add(new TextBlock { Text = dica, Style = Estilo("KpiSub"), FontSize = 12, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) });
        return new Button { Style = Estilo("Kpi"), Content = conteudo, Cursor = System.Windows.Input.Cursors.Arrow, Focusable = false, ToolTip = dica };
    }

    private Border Cartao(string titulo, UIElement conteudo, double margemBaixo = 16)
    {
        var painel = new StackPanel();
        painel.Children.Add(new TextBlock { Text = titulo, FontSize = 18, FontWeight = FontWeights.Bold, Margin = new Thickness(0, 0, 0, 12) });
        painel.Children.Add(conteudo);
        return new Border { Style = Estilo("CartaoBorda"), Padding = new Thickness(24, 22, 24, 22), Margin = new Thickness(0, 0, 0, margemBaixo), Child = painel };
    }

    /// <summary>Tabela (2 partes) e eventos (1 parte) lado a lado; na janela estreita, um embaixo do outro.</summary>
    private FrameworkElement DuasColunas(FrameworkElement esquerda, FrameworkElement direita)
    {
        if (_estreita)
        {
            var pilha = new StackPanel();
            pilha.Children.Add(esquerda);
            pilha.Children.Add(direita);
            return pilha;
        }
        var grade = new Grid();
        grade.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        grade.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(16) });
        grade.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grade.Children.Add(esquerda);
        Grid.SetColumn(direita, 2);
        grade.Children.Add(direita);
        return grade;
    }

    private TextBlock Suave(string texto) => new() { Text = texto, FontSize = 13.5, Style = Estilo("TextoSuave"), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 8) };

    private Style Estilo(string chave) => (Style)FindResource(chave);

    private Brush Pincel(string chave) => (Brush)FindResource(chave);

    /// <summary>Quantidade no formato do Estoque: "12 un." ou "1,5 kg" (Produto.Numero e Produto.Sigla).</summary>
    private static string Quantidade(decimal quantidade, Produto p) => $"{p.Numero(quantidade)} {p.Sigla}";

    /// <summary>Previsão com uma casa decimal (ex.: "0,4 un." ou "2,5 kg").</summary>
    private static string Previsto(decimal quantidade, Produto p) => $"{quantidade.ToString("0.0", PtBr)} {p.Sigla}";

    private static string Plural(int n, string um, string varios) => $"{n.ToString(PtBr)} {(n == 1 ? um : varios)}";
}
