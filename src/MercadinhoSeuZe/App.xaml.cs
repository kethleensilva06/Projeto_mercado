using System.Windows;

namespace MercadinhoSeuZe;

public partial class App : Application
{
    public App()
    {
        // Erro não previsto em uma tela: avisa e segue, em vez de fechar o programa no meio de uma venda
        DispatcherUnhandledException += (_, e) =>
        {
            MessageBox.Show(
                "Aconteceu um erro inesperado. Confira a tela antes de continuar.\n\n" + e.Exception.Message,
                "Mercado · Sistema de gestão", MessageBoxButton.OK, MessageBoxImage.Warning);
            e.Handled = true;
        };
    }
}
