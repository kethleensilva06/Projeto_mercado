/*
 * Autenticação simulada (front-end).
 *
 * Enquanto o back-end não existe, este arquivo faz o papel do
 * POST /login descrito no projeto: valida usuário e senha, identifica o
 * perfil, devolve um token e grava cada tentativa para auditoria.
 * Quando a API estiver pronta, troque o corpo de `login()` por um fetch.
 */
const Auth = (() => {
  const SESSION_KEY = "mercado.sessao";
  const AUDIT_KEY = "mercado.auditoria";

  // Usuários de teste — substituir pela tabela de usuários do banco.
  const USUARIOS = [
    { usuario: "marcos.gerente", senha: "gerente123", nome: "Marcos", perfil: "gerente" },
    { usuario: "ana.caixa",      senha: "caixa123",   nome: "Ana",    perfil: "operador" },
  ];

  // Tela inicial de cada perfil após o login.
  // Por enquanto só landing e login foram publicados: todos vão para a tela
  // "em desenvolvimento". Ao publicar as telas internas, volte para
  // gerente: "painel.html" e operador: "caixa.html".
  const DESTINO_POR_PERFIL = {
    gerente: "em-desenvolvimento.html",
    operador: "em-desenvolvimento.html",
  };

  function registrarTentativa(usuario, sucesso) {
    let log = [];
    try { log = JSON.parse(localStorage.getItem(AUDIT_KEY)) || []; } catch (_) {}
    log.push({ usuario, sucesso, dataHora: new Date().toISOString() });
    try { localStorage.setItem(AUDIT_KEY, JSON.stringify(log)); } catch (_) {}
  }

  function gerarToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }

  // Bloqueio temporário após várias senhas erradas seguidas.
  const LOCK_KEY = "mercado.bloqueios";
  const MAX_TENTATIVAS = 5;
  const BLOQUEIO_MS = 5 * 60 * 1000;

  function lerBloqueios() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || {}; } catch (_) { return {}; }
  }
  function salvarBloqueios(b) {
    try { localStorage.setItem(LOCK_KEY, JSON.stringify(b)); } catch (_) {}
  }

  // Retorna quantos ms faltam para o usuário poder tentar de novo (0 = liberado).
  function tempoBloqueado(usuario) {
    const info = lerBloqueios()[usuario];
    return info && info.ate ? Math.max(0, info.ate - Date.now()) : 0;
  }

  async function login(usuario, senha) {
    await new Promise(r => setTimeout(r, 600)); // simula latência da rede

    const restante = tempoBloqueado(usuario);
    if (restante > 0) {
      registrarTentativa(usuario, false);
      return { ok: false, bloqueadoMs: restante };
    }

    const encontrado = USUARIOS.find(u => u.usuario === usuario && u.senha === senha);
    registrarTentativa(usuario, Boolean(encontrado));

    const bloqueios = lerBloqueios();
    if (!encontrado) {
      const info = bloqueios[usuario] && !bloqueios[usuario].ate ? bloqueios[usuario] : { falhas: 0 };
      info.falhas += 1;
      if (info.falhas >= MAX_TENTATIVAS) {
        bloqueios[usuario] = { falhas: 0, ate: Date.now() + BLOQUEIO_MS };
        salvarBloqueios(bloqueios);
        return { ok: false, bloqueadoMs: BLOQUEIO_MS };
      }
      bloqueios[usuario] = info;
      salvarBloqueios(bloqueios);
      return {
        ok: false,
        erro: "Usuário ou senha inválidos.",
        tentativasRestantes: MAX_TENTATIVAS - info.falhas,
      };
    }

    delete bloqueios[usuario];
    salvarBloqueios(bloqueios);

    const sessao = {
      token: gerarToken(),
      usuario: encontrado.usuario,
      nome: encontrado.nome,
      perfil: encontrado.perfil,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
    return { ok: true, sessao, destino: DESTINO_POR_PERFIL[encontrado.perfil] };
  }

  async function solicitarRecuperacao(usuario) {
    await new Promise(r => setTimeout(r, 600));
    // Sempre responde igual, para não revelar quais usuários existem.
    return { ok: true };
  }

  function sessaoAtual() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; }
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = "login.html";
  }

  /*
   * Bloqueia o acesso a uma tela sem login válido.
   * Use no topo de cada página interna: Auth.exigirLogin(["gerente"]);
   */
  function exigirLogin(perfisPermitidos) {
    const sessao = sessaoAtual();
    if (!sessao || !sessao.token) {
      window.location.replace("login.html");
      return null;
    }
    if (perfisPermitidos && !perfisPermitidos.includes(sessao.perfil)) {
      window.location.replace(DESTINO_POR_PERFIL[sessao.perfil] || "login.html");
      return null;
    }
    return sessao;
  }

  return { login, solicitarRecuperacao, sessaoAtual, logout, exigirLogin, DESTINO_POR_PERFIL };
})();
