using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using MercadinhoSeuZe.Models;
using MercadinhoSeuZe.Services;

namespace MercadinhoSeuZe.Views;

/// <summary>
/// Caixa (semana 5, igual a caixa.html do site): abre o caixa com o troco inicial, monta a venda pelo leitor de
/// código de barras ou pelo nome, recebe o pagamento e só então dá baixa nos lotes (função registrar_venda; o lote
/// que vence primeiro sai primeiro). Enquanto a venda está aberta os itens ficam reservados (AreaInternaView.VendaAberta)
/// e nada sai do estoque. Lote vencido não pode ser vendido. Só o gerente cancela uma venda já paga.
/// </summary>
public partial class CaixaView : UserControl
{
    private static readonly CultureInfo PtBr = new("pt-BR");
    private static readonly (string Id, string Nome)[] Botoes = [("dinheiro", "Dinheiro"), ("pix", "Pix"), ("debito", "Débito"), ("credito", "Crédito")];

    private readonly AreaInternaView _area;
    private readonly Sessao _sessao;
    private readonly CaixaService? _servico;
    private readonly EstoqueService? _estoque;
    private Caixa? _caixa;
    private List<Venda> _vendas = [];
    private List<Produto> _produtos = [];
    private string? _forma;
    private bool _carregando;
    private bool _compacta;
    // Campos de cada linha do carrinho, para atualizar o subtotal enquanto a pessoa digita
    private readonly List<(ItemCarrinho Item, Produto Produto, TextBox Campo, TextBlock Erro, TextBlock Subtotal)> _linhas = [];

    public CaixaView(AreaInternaView area, Sessao sessao, CaixaService? servico, EstoqueService? estoque)
    {
        InitializeComponent();
        _area = area;
        _sessao = sessao;
        _servico = servico;
        _estoque = estoque;
        AjustarColunas(CabecalhoCarrinho);
        MontarFormas();
        Loaded += async (_, _) => await CarregarAsync();

        // Atalhos do caixa: F2 vai para a busca, F4 finaliza a venda
        PreviewKeyDown += (_, e) =>
        {
            if (AreaVenda.Visibility != Visibility.Visible || _area.JanelaAberta) return;
            if (e.Key == Key.F2) { e.Handled = true; Busca.Focus(); Busca.SelectAll(); }
            else if (e.Key == Key.F4) { e.Handled = true; _ = FinalizarAsync(); }
        };
    }

    private List<ItemCarrinho> Venda => _area.VendaAberta;

    // ------------------------------------------------------------ Carregar e mostrar

    private async Task CarregarAsync(string? aviso = null)
    {
        if (_carregando) return;
        if (_servico is null || _estoque is null)
        {
            MostrarErro("Sistema sem configuração do banco de dados. Veja o README.");
            return;
        }
        _carregando = true;
        try
        {
            var caixa = _servico.CaixaDeHojeAsync();
            var produtos = _estoque.ListarAsync();
            await Task.WhenAll(caixa, produtos);
            _caixa = caixa.Result;
            _produtos = produtos.Result;
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
    }

    private void MostrarErro(string texto)
    {
        AvisoErroTexto.Text = texto;
        AvisoErro.Visibility = Visibility.Visible;
        PainelAbrir.Visibility = AreaVenda.Visibility = AvisoFechado.Visibility = Visibility.Collapsed;
        Subtitulo.Text = "Não foi possível carregar o caixa.";
    }

    private async void TentarDeNovo_Click(object sender, RoutedEventArgs e) => await CarregarAsync();

    private void Mostrar()
    {
        var aberto = _caixa is { Fechado: false };
        PainelAbrir.Visibility = _caixa is null ? Visibility.Visible : Visibility.Collapsed;
        AreaVenda.Visibility = aberto ? Visibility.Visible : Visibility.Collapsed;
        AvisoFechado.Visibility = _caixa is { Fechado: true } ? Visibility.Visible : Visibility.Collapsed;
        Subtitulo.Text = _caixa is null
            ? "Registro de vendas do dia"
            : $"Caixa aberto por {_caixa.NomeAbertoPor} às {_caixa.AbertoAs} · troco inicial {Moeda(_caixa.TrocoInicial)}";
        if (_caixa is { Fechado: true })
            AvisoFechadoTexto.Text = $"O caixa de hoje foi fechado por {_caixa.NomeFechadoPor} às {_caixa.FechadoAs}. Novas vendas, só amanhã.";

        if (aberto)
        {
            // Tira da venda aberta o que não existe mais no estoque
            Venda.RemoveAll(i => _produtos.All(p => p.Id != i.ProdutoId));
            MostrarCarrinho();
        }
        else if (_caixa is null)
        {
            Dispatcher.BeginInvoke(() => { TrocoInicial.Focus(); TrocoInicial.SelectAll(); });
        }
        MostrarDia();
    }

    private void MostrarDia()
    {
        var resumo = ResumoDia.De(_vendas);
        Total.Text = Moeda(resumo.Total);
        Quantidade.Text = resumo.QuantidadeVendas.ToString(PtBr);
        Ticket.Text = Moeda(resumo.TicketMedio);

        Vendas.Children.Clear();
        if (_vendas.Count == 0)
            Vendas.Children.Add(new TextBlock { Text = "Nenhuma venda hoje.", Style = Recurso<Style>("TextoSuave"), FontSize = 14, Margin = new Thickness(0, 6, 0, 6) });
        foreach (var v in _vendas)
            Vendas.Children.Add(LinhaVenda(v));
    }

    private FrameworkElement LinhaVenda(Venda v)
    {
        var linha = new DockPanel { Margin = new Thickness(0, 10, 0, 10) };

        var direita = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        direita.Children.Add(new Border
        {
            BorderBrush = Recurso<Brush>("LinhaForte"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(3),
            Padding = new Thickness(8, 1, 8, 2), Margin = new Thickness(0, 0, 14, 0), VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock { Text = v.NomeForma, FontSize = 12, FontWeight = FontWeights.SemiBold }
        });
        direita.Children.Add(new TextBlock
        {
            Text = Moeda(v.Total), FontFamily = Recurso<FontFamily>("FonteTitulo"), FontWeight = FontWeights.ExtraBold, FontSize = 16,
            MinWidth = 96, TextAlignment = TextAlignment.Right, VerticalAlignment = VerticalAlignment.Center,
            TextDecorations = v.Cancelada ? TextDecorations.Strikethrough : null
        });
        if (v.Cancelada)
            direita.Children.Add(new Border
            {
                Background = Recurso<Brush>("Vermelho50"), CornerRadius = new CornerRadius(3), Padding = new Thickness(8, 2, 8, 2),
                Margin = new Thickness(14, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center,
                ToolTip = v.CanceladaPor is null ? null : $"Cancelada por {v.CanceladaPor}",
                Child = new TextBlock { Text = "Cancelada", FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = Recurso<Brush>("Vermelho600") }
            });
        else if (_sessao.Perfil == Perfil.Gerente && _caixa is { Fechado: false })
        {
            var cancelar = new Button { Content = "Cancelar", Style = Recurso<Style>("BotaoLink"), Foreground = Recurso<Brush>("Vermelho600"), Margin = new Thickness(14, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            System.Windows.Automation.AutomationProperties.SetName(cancelar, $"Cancelar a venda nº {v.Id}");
            cancelar.Click += (_, _) => ConfirmarCancelamento(v);
            direita.Children.Add(cancelar);
        }
        DockPanel.SetDock(direita, Dock.Right);
        linha.Children.Add(direita);

        var texto = new StackPanel { Margin = new Thickness(0, 0, 16, 0), Opacity = v.Cancelada ? 0.6 : 1 };
        texto.Children.Add(new TextBlock { Text = $"Venda nº {v.Id} · {v.Hora} · {v.NomeOperador}", FontWeight = FontWeights.SemiBold, FontSize = 14 });
        texto.Children.Add(new TextBlock
        {
            Text = string.Join(", ", v.Itens.Select(i => i.Descricao)), FontSize = 13, Foreground = Recurso<Brush>("Suave"),
            TextTrimming = TextTrimming.CharacterEllipsis, TextWrapping = TextWrapping.NoWrap, ToolTip = string.Join("\n", v.Itens.Select(i => i.Descricao))
        });
        linha.Children.Add(texto);

        return new Border { BorderBrush = Recurso<Brush>("LinhaTracejada"), BorderThickness = new Thickness(0, 0, 0, 1), Child = linha };
    }

    // ------------------------------------------------------------ Abrir o caixa

    private async void AbrirCaixa_Click(object sender, RoutedEventArgs e) => await AbrirCaixaAsync();

    private async void TrocoInicial_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        await AbrirCaixaAsync();
    }

    private async Task AbrirCaixaAsync()
    {
        var texto = TrocoInicial.Text.Trim();
        var troco = texto.Length == 0 ? 0 : Formulario.LerPreco(texto);
        if (!Formulario.Validar(TrocoInicial, TrocoInicialErro, troco is not null, "Digite um valor válido, por exemplo 150,00."))
        {
            TrocoInicial.Focus();
            return;
        }
        BotaoAbrir.IsEnabled = false;
        try
        {
            await _servico!.AbrirAsync(troco!.Value);
            await CarregarAsync("Caixa aberto. Boas vendas!");
            Busca.Focus();
        }
        catch (ConexaoException ex)
        {
            Formulario.Validar(TrocoInicial, TrocoInicialErro, false, ex.Message);
            await CarregarAsync();
        }
        finally
        {
            BotaoAbrir.IsEnabled = true;
        }
    }

    // ------------------------------------------------------------ Busca e leitor

    /// <summary>Lotes que podem ser vendidos: com unidades e dentro da validade (lote vencido fica bloqueado).</summary>
    private static decimal Vendavel(Produto p)
    {
        var hoje = CaixaService.Hoje;
        return p.Lotes.Where(l => l.QuantidadeRestante > 0 && (l.Validade is null || l.Validade >= hoje)).Sum(l => l.QuantidadeRestante);
    }

    /// <summary>Quanto deste produto já está reservado na venda aberta.</summary>
    private decimal Reservado(Produto p) =>
        Venda.FirstOrDefault(i => i.ProdutoId == p.Id) is { } item && Formulario.LerQuantidade(item.Quantidade, p.PorPeso) is > 0 and var q ? q : 0;

    /// <summary>
    /// Código da caixa (DUN-14) ou da unidade (EAN-13): o DUN-14 repete os 12 primeiros dígitos do EAN-13, então o
    /// leitor encontra o produto passando a caixa ou a embalagem da unidade (igual a porCodigo do site).
    /// </summary>
    private Produto? PorCodigo(string codigo) =>
        _produtos.FirstOrDefault(p => p.CodigoBarrasCaixa?.Trim() == codigo)
        ?? (codigo.Length == 13
            ? _produtos.FirstOrDefault(p => p.CodigoBarrasCaixa?.Trim() is { Length: 14 } dun && dun.All(char.IsDigit) && dun[1..13] == codigo[..12])
            : null);

    private List<Produto> Encontrar(string texto) => _produtos
        .Where(p => Contem(p.Nome, texto) || Contem(p.Categoria, texto))
        .OrderByDescending(p => PtBr.CompareInfo.IsPrefix(p.Nome, texto, CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace))
        .ThenBy(p => p.Nome, StringComparer.Create(PtBr, true))
        .ToList();

    private void Busca_TextChanged(object sender, TextChangedEventArgs e)
    {
        DicaBusca.Visibility = Busca.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        BuscaErro.Text = "";
        MostrarResultados();
    }

    private void MostrarResultados()
    {
        Resultados.Children.Clear();
        var texto = Busca.Text.Trim();
        if (texto.Length < 2 || texto.All(char.IsDigit))
        {
            CaixaResultados.Visibility = Visibility.Collapsed;
            return;
        }
        var achados = Encontrar(texto).Take(6).ToList();
        if (achados.Count == 0)
            Resultados.Children.Add(new TextBlock { Text = "Nenhum produto encontrado.", Style = Recurso<Style>("TextoSuave"), FontSize = 14, Margin = new Thickness(14, 10, 14, 10) });
        foreach (var p in achados)
            Resultados.Children.Add(Resultado(p));
        CaixaResultados.Visibility = Visibility.Visible;
    }

    private Button Resultado(Produto p)
    {
        var vendavel = Vendavel(p);
        var situacao = vendavel > 0 ? $"Disponível: {p.Formatar(vendavel - Reservado(p))}"
            : p.Quantidade > 0 ? "Só tem lote vencido: venda bloqueada" : "Sem estoque";

        var conteudo = new DockPanel();
        var preco = new TextBlock { Text = Moeda(p.Preco) + (p.PorPeso ? "/kg" : ""), FontWeight = FontWeights.Bold, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 0, 0) };
        DockPanel.SetDock(preco, Dock.Right);
        conteudo.Children.Add(preco);
        var nome = new TextBlock { VerticalAlignment = VerticalAlignment.Center };
        nome.Inlines.Add(new System.Windows.Documents.Run(p.Nome) { FontWeight = FontWeights.SemiBold });
        nome.Inlines.Add(new System.Windows.Documents.Run($"  {p.Categoria} · {situacao}")
        {
            FontSize = 13, Foreground = Recurso<Brush>(vendavel > 0 ? "Suave" : "Vermelho600")
        });
        conteudo.Children.Add(nome);

        var botao = new Button
        {
            Content = conteudo, IsEnabled = vendavel > 0, Cursor = Cursors.Hand, HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Template = ItemResultado(), FocusVisualStyle = Recurso<Style>("FocoVisivel")
        };
        System.Windows.Automation.AutomationProperties.SetName(botao, $"{p.Nome}, {Moeda(p.Preco)}, {situacao}");
        botao.Click += (_, _) => Adicionar(p);
        return botao;
    }

    private ControlTemplate ItemResultado()
    {
        var borda = new FrameworkElementFactory(typeof(Border)) { Name = "Fundo" };
        borda.SetValue(Border.BackgroundProperty, Brushes.Transparent);
        borda.SetValue(Border.PaddingProperty, new Thickness(14, 9, 14, 9));
        borda.AppendChild(new FrameworkElementFactory(typeof(ContentPresenter)));
        var modelo = new ControlTemplate(typeof(Button)) { VisualTree = borda };
        var sobre = new Trigger { Property = IsMouseOverProperty, Value = true };
        sobre.Setters.Add(new Setter(Border.BackgroundProperty, Recurso<Brush>("EtiquetaClara"), "Fundo"));
        modelo.Triggers.Add(sobre);
        var foco = new Trigger { Property = IsKeyboardFocusedProperty, Value = true };
        foco.Setters.Add(new Setter(Border.BackgroundProperty, Recurso<Brush>("EtiquetaClara"), "Fundo"));
        modelo.Triggers.Add(foco);
        var desligado = new Trigger { Property = IsEnabledProperty, Value = false };
        desligado.Setters.Add(new Setter(OpacityProperty, 0.7));
        modelo.Triggers.Add(desligado);
        return modelo;
    }

    private void Busca_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape && Busca.Text.Length > 0)
        {
            e.Handled = true;
            Busca.Clear();
            return;
        }
        if (e.Key == Key.Down && CaixaResultados.Visibility == Visibility.Visible && Resultados.Children.OfType<Button>().FirstOrDefault(b => b.IsEnabled) is { } primeiroResultado)
        {
            e.Handled = true;
            primeiroResultado.Focus();
            return;
        }
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        var texto = Busca.Text.Trim();
        if (texto.Length == 0) return;
        if (texto.All(char.IsDigit))
        {
            // O leitor "digita" o código e aperta Enter
            if (PorCodigo(texto) is { } p) Adicionar(p);
            else BuscaErro.Text = $"Nenhum produto com o código {texto}. Confira o cadastro no Estoque ou busque pelo nome.";
            return;
        }
        if (Encontrar(texto).FirstOrDefault(p => Vendavel(p) > 0) is { } primeiro) Adicionar(primeiro);
        else BuscaErro.Text = "Nenhum produto disponível com esse nome.";
    }

    private void Adicionar(Produto p)
    {
        var vendavel = Vendavel(p);
        if (vendavel <= 0)
        {
            BuscaErro.Text = p.Quantidade > 0
                ? $"{p.Nome}: só há lote vencido. A venda está bloqueada; retire o produto da prateleira."
                : $"{p.Nome} está sem estoque.";
            return;
        }
        var existente = Venda.FirstOrDefault(i => i.ProdutoId == p.Id);
        if (existente is not null)
        {
            // Mais uma unidade do mesmo produto; no produto por quilo, só volta para o campo do peso
            if (!p.PorPeso)
            {
                var atual = Formulario.LerQuantidade(existente.Quantidade, false) ?? 0;
                if (atual + 1 > vendavel)
                {
                    BuscaErro.Text = $"Não há mais {p.Nome} disponível ({p.Formatar(vendavel)} no estoque).";
                    return;
                }
                existente.Quantidade = (atual + 1).ToString(PtBr);
            }
        }
        else
        {
            Venda.Add(new ItemCarrinho { ProdutoId = p.Id, Quantidade = p.PorPeso ? "" : "1" });
        }
        Busca.Clear();
        BuscaErro.Text = "";
        MostrarCarrinho();
        if (p.PorPeso && _linhas.FirstOrDefault(l => l.Produto.Id == p.Id) is { Campo: { } campo })
        {
            // Produto por quilo: a pessoa digita o peso da balança
            Dispatcher.BeginInvoke(() => { campo.Focus(); campo.SelectAll(); });
        }
        else
        {
            Busca.Focus();
        }
    }

    // ------------------------------------------------------------ Carrinho

    private void MostrarCarrinho()
    {
        Itens.Children.Clear();
        _linhas.Clear();
        foreach (var item in Venda)
        {
            var p = _produtos.First(x => x.Id == item.ProdutoId);
            Itens.Children.Add(LinhaItem(item, p));
        }
        Carrinho.Visibility = Venda.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        SemItens.Visibility = Venda.Count > 0 ? Visibility.Collapsed : Visibility.Visible;
        AtualizarTotais();
    }

    private FrameworkElement LinhaItem(ItemCarrinho item, Produto p)
    {
        var grade = new Grid { MinHeight = 60 };
        AjustarColunas(grade);

        var nome = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(4, 8, 12, 8) };
        nome.Children.Add(new TextBlock { Text = p.Nome, FontWeight = FontWeights.SemiBold });
        var detalhe = new WrapPanel { Margin = new Thickness(0, 3, 0, 0) };
        detalhe.Children.Add(CategoriaVisual.Pilula(this, p.Categoria, 12));
        if (_compacta)
            detalhe.Children.Add(new TextBlock { Text = Moeda(p.Preco) + (p.PorPeso ? "/kg" : ""), FontSize = 13, Foreground = Recurso<Brush>("Suave"), Margin = new Thickness(8, 1, 0, 0) });
        nome.Children.Add(detalhe);
        Colocar(grade, nome, 0);

        var campo = new TextBox { Text = item.Quantidade, Width = _compacta ? 74 : 92, MinHeight = 38, MaxLength = 9, Padding = new Thickness(10, 0, 10, 0), HorizontalContentAlignment = HorizontalAlignment.Right };
        System.Windows.Automation.AutomationProperties.SetName(campo, p.PorPeso ? $"Peso de {p.Nome} em kg" : $"Quantidade de {p.Nome}");
        var dica = new TextBlock { Text = p.PorPeso ? "0,000" : "", Foreground = Recurso<Brush>("Placeholder"), IsHitTestVisible = false, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 0, 11, 0), Visibility = item.Quantidade.Length == 0 ? Visibility.Visible : Visibility.Collapsed };
        var caixaCampo = new Grid();
        caixaCampo.Children.Add(campo);
        caixaCampo.Children.Add(dica);
        var linhaCampo = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        linhaCampo.Children.Add(caixaCampo);
        linhaCampo.Children.Add(new TextBlock { Text = p.Sigla, Width = 26, Margin = new Thickness(6, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, Foreground = Recurso<Brush>("Suave") });
        var erro = new TextBlock { Style = Recurso<Style>("ErroCampo"), TextAlignment = TextAlignment.Right, Margin = new Thickness(0, 4, 0, 0) };
        var celulaQtd = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 8, 8, 8) };
        celulaQtd.Children.Add(linhaCampo);
        celulaQtd.Children.Add(erro);
        Colocar(grade, celulaQtd, 1);

        var preco = Celula(Moeda(p.Preco) + (p.PorPeso ? "/kg" : ""), suave: true);
        Colocar(grade, preco, 2);
        var subtotal = Celula("—");
        subtotal.FontWeight = FontWeights.SemiBold;
        Colocar(grade, subtotal, 3);

        var tirar = new Button { Content = "×", Style = Recurso<Style>("LinkSuave"), FontSize = 22, FontWeight = FontWeights.Normal, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, ToolTip = "Tirar da venda" };
        System.Windows.Automation.AutomationProperties.SetName(tirar, $"Tirar {p.Nome} da venda");
        tirar.Click += (_, _) =>
        {
            Venda.Remove(item);
            MostrarCarrinho();
            Busca.Focus();
        };
        Colocar(grade, tirar, 4);

        campo.TextChanged += (_, _) =>
        {
            item.Quantidade = campo.Text;
            dica.Visibility = campo.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            campo.Tag = null;
            erro.Text = "";
            AtualizarTotais();
        };
        campo.PreviewKeyDown += (_, e) =>
        {
            if (e.Key != Key.Enter) return;
            e.Handled = true;
            Busca.Focus();
        };

        _linhas.Add((item, p, campo, erro, subtotal));
        return new Border { BorderBrush = Recurso<Brush>("LinhaTracejada"), BorderThickness = new Thickness(0, 0, 0, 1), Child = grade };
    }

    private static decimal? QuantidadeValida(ItemCarrinho item, Produto p) =>
        Formulario.LerQuantidade(item.Quantidade, p.PorPeso) is > 0 and var q ? q : null;

    private static decimal Subtotal(Produto p, decimal q) => Math.Round(q * p.Preco, 2, MidpointRounding.AwayFromZero);

    private decimal TotalDaVenda() =>
        _linhas.Sum(l => QuantidadeValida(l.Item, l.Produto) is { } q ? Subtotal(l.Produto, q) : 0);

    private void AtualizarTotais()
    {
        foreach (var l in _linhas)
            l.Subtotal.Text = QuantidadeValida(l.Item, l.Produto) is { } q ? Moeda(Subtotal(l.Produto, q)) : "—";
        var total = TotalDaVenda();
        TotalVenda.Text = Moeda(total);
        QuantidadeItens.Text = Venda.Count switch { 0 => "Nenhum item", 1 => "1 item na venda", var n => $"{n} itens na venda" };
        var recebido = Formulario.LerPreco(Recebido.Text) ?? 0;
        Troco.Text = Moeda(recebido > total ? recebido - total : 0);
    }

    /// <summary>Confere cada item: quantidade (ou peso) válida e dentro do que pode ser vendido.</summary>
    private bool ValidarItens()
    {
        TextBox? primeiro = null;
        foreach (var l in _linhas)
        {
            var q = QuantidadeValida(l.Item, l.Produto);
            var disponivel = Vendavel(l.Produto);
            var mensagem = q is null ? (l.Produto.PorPeso ? "Digite o peso (ex.: 0,750)" : "Quantidade inválida")
                : q > disponivel ? $"Só há {l.Produto.Formatar(disponivel)}" : "";
            Formulario.Validar(l.Campo, l.Erro, mensagem.Length == 0, mensagem);
            if (mensagem.Length > 0) primeiro ??= l.Campo;
        }
        primeiro?.Focus();
        return primeiro is null;
    }

    // ------------------------------------------------------------ Pagamento

    private void MontarFormas()
    {
        Formas.Children.Clear();
        foreach (var (id, nome) in Botoes)
        {
            var botao = new Button { Content = nome, Style = Recurso<Style>("Chip"), MinHeight = 44, Tag = _forma == id ? "ativo" : null };
            System.Windows.Automation.AutomationProperties.SetName(botao, $"Pagar com {FormasPagamento.Nome(id)}");
            botao.Click += (_, _) => EscolherForma(id);
            Formas.Children.Add(botao);
        }
    }

    private void EscolherForma(string? forma)
    {
        _forma = forma;
        MontarFormas();
        FormaErro.Text = "";
        PainelDinheiro.Visibility = forma == "dinheiro" ? Visibility.Visible : Visibility.Collapsed;
        if (forma == "dinheiro") Dispatcher.BeginInvoke(() => Recebido.Focus());
    }

    private void Recebido_TextChanged(object sender, TextChangedEventArgs e)
    {
        DicaRecebido.Visibility = Recebido.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        Recebido.Tag = null;
        RecebidoErro.Text = "";
        AtualizarTotais();
    }

    private async void Finalizar_Click(object sender, RoutedEventArgs e) => await FinalizarAsync();

    private async Task FinalizarAsync()
    {
        if (_caixa is not { Fechado: false } || !BotaoFinalizar.IsEnabled) return;
        if (Venda.Count == 0)
        {
            BuscaErro.Text = "Adicione pelo menos um produto à venda.";
            Busca.Focus();
            return;
        }
        if (!ValidarItens()) return;
        if (_forma is null)
        {
            FormaErro.Text = "Escolha a forma de pagamento.";
            return;
        }
        var total = TotalDaVenda();
        decimal? recebido = null;
        if (_forma == "dinheiro" && Recebido.Text.Trim().Length > 0)
        {
            // Campo vazio = o cliente pagou o valor exato
            recebido = Formulario.LerPreco(Recebido.Text);
            var mensagem = recebido is null ? "Digite um valor válido, por exemplo 50,00."
                : recebido < total ? $"O valor recebido é menor que o total ({Moeda(total)})." : "";
            if (!Formulario.Validar(Recebido, RecebidoErro, mensagem.Length == 0, mensagem))
            {
                Recebido.Focus();
                return;
            }
        }

        BotaoFinalizar.IsEnabled = false;
        try
        {
            // Só agora (pagamento confirmado) os itens saem dos lotes, no banco
            var itens = _linhas.Select(l => (l.Produto.Id, QuantidadeValida(l.Item, l.Produto)!.Value)).ToList();
            var venda = await _servico!.RegistrarAsync(_forma, recebido, itens);
            Venda.Clear();
            Recebido.Clear();
            EscolherForma(null);
            await CarregarAsync(venda.Troco > 0
                ? $"Venda nº {venda.Id} registrada. Troco: {Moeda(venda.Troco)}."
                : $"Venda nº {venda.Id} registrada ({Moeda(venda.Total)}).");
            Busca.Focus();
        }
        catch (ConexaoException ex)
        {
            FormaErro.Text = ex.Message;
            // O estoque pode ter mudado (outro caixa vendeu): recarrega para mostrar o que ainda há
            await CarregarAsync();
        }
        finally
        {
            BotaoFinalizar.IsEnabled = true;
        }
    }

    // ------------------------------------------------------------ Cancelar

    private void CancelarVenda_Click(object sender, RoutedEventArgs e)
    {
        var n = Venda.Count;
        if (n == 0) return;
        _area.AbrirJanela(new ConfirmacaoJanela(_area, "Cancelar a venda?",
            $"{(n == 1 ? "O item sai" : $"Os {n} itens saem")} da venda e {(n == 1 ? "volta" : "voltam")} a ficar disponíveis. Nada sai do estoque.",
            () =>
            {
                Venda.Clear();
                Recebido.Clear();
                EscolherForma(null);
                MostrarCarrinho();
                _area.FecharJanela();
                _area.MostrarToast("Venda cancelada.");
                Busca.Focus();
                return Task.CompletedTask;
            }, "Cancelar venda", "Voltar"));
    }

    private void ConfirmarCancelamento(Venda v) =>
        _area.AbrirJanela(new ConfirmacaoJanela(_area, $"Cancelar a venda nº {v.Id}?",
            $"A venda de {Moeda(v.Total)} ({v.NomeForma.ToLower(PtBr)}) sai dos totais do dia e os itens voltam para o estoque. Devolva o valor ao cliente.",
            async () =>
            {
                await _servico!.CancelarVendaAsync(v.Id);
                _area.FecharJanela();
                await CarregarAsync($"Venda nº {v.Id} cancelada.");
            }, "Cancelar venda", "Voltar"));

    private void VerFechamento_Click(object sender, RoutedEventArgs e) => _area.Abrir("fechamento");

    // ------------------------------------------------------------ Peças da tabela

    private void AjustarColunas(Grid grade)
    {
        grade.ColumnDefinitions.Clear();
        GridLength[] larguras = _compacta
            ? [new(1, GridUnitType.Star), new(124), new(0), new(86), new(36)]
            : [new(1, GridUnitType.Star), new(150), new(110), new(110), new(40)];
        foreach (var l in larguras)
            grade.ColumnDefinitions.Add(new ColumnDefinition { Width = l });
    }

    private void AoRedimensionar(object sender, SizeChangedEventArgs e)
    {
        Resumo.Columns = e.NewSize.Width < 600 ? 1 : 3;
        // Janela estreita: o pagamento vai para baixo dos itens
        var empilhar = e.NewSize.Width < 860;
        ColunaPagamento.Width = empilhar ? new GridLength(0) : new GridLength(340);
        Grid.SetColumn(CartaoPagamento, empilhar ? 0 : 1);
        Grid.SetRow(CartaoPagamento, empilhar ? 1 : 0);
        CartaoPagamento.Margin = new Thickness(0, empilhar ? 20 : 0, 0, 0);
        CartaoItens.Margin = new Thickness(0, 0, empilhar ? 0 : 20, 0);

        // Tabela compacta (preço embaixo do nome) quando o cartão dos itens fica estreito
        var larguraItens = empilhar ? e.NewSize.Width : e.NewSize.Width - 360;
        var compacta = larguraItens < 680;
        if (compacta == _compacta) return;
        _compacta = compacta;
        AjustarColunas(CabecalhoCarrinho);
        foreach (TextBlock t in CabecalhoCarrinho.Children)
            t.Visibility = _compacta && Grid.GetColumn(t) == 2 ? Visibility.Collapsed : Visibility.Visible;
        if (AreaVenda.Visibility == Visibility.Visible) MostrarCarrinho();
    }

    private static void Colocar(Grid grade, UIElement elemento, int coluna)
    {
        Grid.SetColumn(elemento, coluna);
        grade.Children.Add(elemento);
    }

    private TextBlock Celula(string texto, bool suave = false) => new()
    {
        Text = texto,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Right,
        Foreground = Recurso<Brush>(suave ? "Suave" : "Tinta"),
        TextWrapping = TextWrapping.NoWrap,
        Margin = new Thickness(0, 0, 8, 0)
    };

    private T Recurso<T>(string chave) => (T)FindResource(chave);

    private static string Moeda(decimal valor) => valor.ToString("C", PtBr);

    private static bool Contem(string texto, string termo) =>
        PtBr.CompareInfo.IndexOf(texto, termo, CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace) >= 0;
}
