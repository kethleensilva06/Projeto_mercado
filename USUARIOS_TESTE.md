# Usuários de teste

Usuários fictícios para testar o login enquanto não existe back-end.
Eles estão definidos em `js/auth.js` (constante `USUARIOS`).

| Perfil   | Usuário          | Senha        | Vai para      |
|----------|------------------|--------------|---------------|
| Gerente  | `marcos.gerente` | `gerente123` | `painel.html` |
| Operador | `ana.caixa`      | `caixa123`   | `caixa.html`  |

Para rodar localmente:

```bash
python -m http.server 5500
```

Depois acesse http://localhost:5500
