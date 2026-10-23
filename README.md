# Site do mercado

Sistema web para mercado: do primeiro acesso do visitante ao fechamento do caixa no fim do dia.
Feito em HTML, CSS e JavaScript puros, sem dependências.

## Telas

| Tela | Arquivo | Situação |
|------|---------|----------|
| Landing page | `index.html` | Pronta |
| Login | `login.html` | Pronta |
| Painel | `painel.html` | Pronta |
| Estoque (semana 3) | `estoque.html` | Pronta: lotes, validade, produtos por quilo, leitor de código de barras, filtros |
| Fornecedores (semana 4) | `fornecedores.html` | Pronta: pedidos com vários itens, envio pelo WhatsApp/e-mail, entregas |
| Caixa (semana 5) | `caixa.html` | Pronta: venda, pagamento, reserva dos itens e baixa no estoque após o pagamento |
| Fechamento do dia | — | A fazer (semana 6) |

As telas seguem as mesmas regras do programa para Windows (`app-windows/`) até a semana 4. A semana 5 (Caixa)
foi feita primeiro no site.

Depois do login, o gerente vai para o Painel e o operador para o Caixa.

## Como rodar

Na pasta do projeto:

```bash
python -m http.server 5500
```

Depois acesse http://localhost:5500. Os usuários de teste estão em [USUARIOS_TESTE.md](USUARIOS_TESTE.md).

## Estrutura

```
index.html, login.html, painel.html, estoque.html, fornecedores.html, caixa.html
css/      estilos (app.css = estrutura das telas internas, componentes.css = tabela, botões, janelas)
js/       auth.js   login simulado, perfis, bloqueio e auditoria
          dados.js  base de dados simulada (produtos com lotes, fornecedores, pedidos, vendas, caixa)
          regras.js regras do estoque, dos fornecedores e do caixa (iguais às de app-windows/.../Models)
          app.js    menu lateral, usuário logado e avisos comuns
          estoque.js, fornecedores.js, caixa.js, painel.js  uma por tela
figma/    telas exportadas em SVG (as mesmas do arquivo do Figma)
```

## Programa para Windows (`app-windows/`)

Versão do sistema como programa para Windows (C# .NET 10 + WPF, com banco no Supabase), feita por
Guilherme Guerhart a partir das telas deste site. Veio da branch `app` com o histórico de commits preservado.
Como preparar e rodar: [app-windows/README.md](app-windows/README.md).

## Observações

- Ainda não há back-end: o login (`js/auth.js`) e os dados (`js/dados.js`) são simulados e ficam
  guardados no navegador (`localStorage`/`sessionStorage`). Ao criar a API, troque as funções desses
  dois arquivos por chamadas a ela.
- Os usuários e senhas de teste são fictícios e servem só para desenvolvimento.
- Dados salvos pela versão anterior do site (uma quantidade por produto) são convertidos sozinhos para lotes.
  Para recomeçar dos dados de exemplo, apague a chave `mercado.dados` do `localStorage`.

## Regras principais (semanas 3 a 5)

- **Estoque**: a quantidade do produto é a soma dos lotes. Estoque baixo = tem unidades mas menos que o mínimo;
  aviso antecipado (sinal amarelo) = chegando no mínimo (vazio = mínimo + 50%; com "Pedir antes de acabar", mínimo +
  o que sai por dia × prazo de entrega). Validade próxima = vence em até 30 dias; vencido = lote com unidades e
  validade já passada. Produto por quilo usa até 3 casas ("0,745 kg").
- **Leitor de código de barras**: o leitor digita o código e manda Enter. No Estoque, código conhecido abre "Novo lote";
  código novo procura o produto no Open Food Facts (sem internet, abre o cadastro vazio).
- **Fornecedores**: produtos de um fornecedor = os ligados a ele ou, sem ligação, os da categoria que ele entrega.
  O pedido abre o WhatsApp (wa.me) ou o e-mail com a mensagem escrita; o site não envia nada sozinho. A entrega cria
  um lote por item recebido. Fornecedor com pedidos não é apagado, fica desativado.
- **Caixa**: os itens ficam reservados enquanto a venda está aberta e só saem do estoque depois do pagamento (o lote que
  vence primeiro sai primeiro). Lote vencido não pode ser vendido. O gerente pode cancelar uma venda; os itens voltam
  para os mesmos lotes. F2 vai para a busca e F4 finaliza a venda.
