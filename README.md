# Site do mercado

Sistema web para mercado: do primeiro acesso do visitante ao fechamento do caixa no fim do dia.
Feito em HTML, CSS e JavaScript puros, sem dependências.

## Telas

| Tela | Arquivo | Situação |
|------|---------|----------|
| Landing page | `index.html` | Pronta |
| Login | `login.html` | Pronta |
| Painel | `painel.html` | Pronta |
| Estoque | `estoque.html` | Pronta |
| Fornecedores | `fornecedores.html` | Pronta |
| Caixa | `caixa.html` | Página provisória |
| Fechamento do dia | — | A fazer |

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
          dados.js  base de dados simulada (produtos, fornecedores, pedidos, vendas, caixa)
          app.js    menu lateral, usuário logado e avisos comuns
figma/    telas exportadas em SVG (as mesmas do arquivo do Figma)
```

## Observações

- Ainda não há back-end: o login (`js/auth.js`) e os dados (`js/dados.js`) são simulados e ficam
  guardados no navegador (`localStorage`/`sessionStorage`). Ao criar a API, troque as funções desses
  dois arquivos por chamadas a ela.
- Os usuários e senhas de teste são fictícios e servem só para desenvolvimento.
