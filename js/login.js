(() => {
  // Já logado? Vai direto para a tela do perfil.
  const sessao = Auth.sessaoAtual();
  if (sessao && sessao.token) {
    window.location.replace(Auth.DESTINO_POR_PERFIL[sessao.perfil]);
    return;
  }

  const $ = id => document.getElementById(id);
  const LEMBRAR_KEY = "mercado.ultimoUsuario";

  const form = $("login-form");
  const inputUsuario = $("usuario");
  const inputSenha = $("senha");
  const lembrar = $("lembrar");
  const btnEntrar = $("btn-entrar");
  const alerta = $("login-error");
  const alertaTexto = $("login-error-text");
  let timerBloqueio = null;

  // Preenche o usuário lembrado
  try {
    const salvo = localStorage.getItem(LEMBRAR_KEY);
    if (salvo) {
      inputUsuario.value = salvo;
      lembrar.checked = true;
      inputSenha.focus();
    } else {
      inputUsuario.focus();
    }
  } catch (_) { inputUsuario.focus(); }

  function setErroCampo(input, mensagem) {
    $(input.id + "-error").textContent = mensagem;
    input.setAttribute("aria-invalid", mensagem ? "true" : "false");
  }

  function mostrarAlerta(texto, tipo = "error") {
    alerta.className = "alert alert-" + tipo;
    alertaTexto.textContent = texto;
    alerta.hidden = false;
  }

  function validar() {
    let ok = true;
    if (!inputUsuario.value.trim()) {
      setErroCampo(inputUsuario, "Informe seu usuário.");
      ok = false;
    } else {
      setErroCampo(inputUsuario, "");
    }
    if (!inputSenha.value) {
      setErroCampo(inputSenha, "Informe sua senha.");
      ok = false;
    } else {
      setErroCampo(inputSenha, "");
    }
    return ok;
  }

  function formatarTempo(ms) {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function iniciarBloqueio(ms) {
    clearInterval(timerBloqueio);
    const fim = Date.now() + ms;
    btnEntrar.disabled = true;
    const tick = () => {
      const restante = fim - Date.now();
      if (restante <= 0) {
        clearInterval(timerBloqueio);
        btnEntrar.disabled = false;
        alerta.hidden = true;
        return;
      }
      mostrarAlerta(
        "Muitas tentativas sem sucesso. Por segurança, o acesso foi bloqueado. Tente novamente em " +
          formatarTempo(restante) + " ou use “Esqueci minha senha”.",
        "warn"
      );
    };
    tick();
    timerBloqueio = setInterval(tick, 1000);
  }

  [inputUsuario, inputSenha].forEach(input =>
    input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid") === "true") setErroCampo(input, "");
      if (!timerBloqueio || btnEntrar.disabled === false) alerta.hidden = true;
    })
  );

  // Ao trocar de usuário, encerra o aviso de bloqueio do anterior
  inputUsuario.addEventListener("change", () => {
    clearInterval(timerBloqueio);
    timerBloqueio = null;
    btnEntrar.disabled = false;
    alerta.hidden = true;
  });

  // Aviso de Caps Lock
  const capsWarning = $("caps-warning");
  ["keydown", "keyup"].forEach(evt =>
    inputSenha.addEventListener(evt, e => {
      if (e.getModifierState) capsWarning.hidden = !e.getModifierState("CapsLock");
    })
  );
  inputSenha.addEventListener("blur", () => { capsWarning.hidden = true; });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (btnEntrar.disabled) return;
    alerta.hidden = true;
    if (!validar()) {
      form.querySelector('[aria-invalid="true"]').focus();
      return;
    }

    const usuario = inputUsuario.value.trim();
    btnEntrar.disabled = true;
    btnEntrar.classList.add("loading");

    const resultado = await Auth.login(usuario, inputSenha.value);
    btnEntrar.classList.remove("loading");

    if (resultado.ok) {
      try {
        if (lembrar.checked) localStorage.setItem(LEMBRAR_KEY, usuario);
        else localStorage.removeItem(LEMBRAR_KEY);
      } catch (_) {}
      window.location.href = resultado.destino;
      return;
    }

    inputSenha.value = "";

    if (resultado.bloqueadoMs) {
      iniciarBloqueio(resultado.bloqueadoMs);
      return;
    }

    btnEntrar.disabled = false;
    let texto = resultado.erro;
    if (resultado.tentativasRestantes <= 3) {
      texto += " Restam " + resultado.tentativasRestantes +
        (resultado.tentativasRestantes === 1 ? " tentativa" : " tentativas") +
        " antes do bloqueio temporário.";
    }
    mostrarAlerta(texto);
    inputSenha.focus();
  });

  // Mostrar / ocultar senha
  const toggle = $("toggle-pass");
  toggle.addEventListener("click", () => {
    const mostrar = inputSenha.type === "password";
    inputSenha.type = mostrar ? "text" : "password";
    toggle.textContent = mostrar ? "Ocultar" : "Mostrar";
    toggle.setAttribute("aria-pressed", String(mostrar));
    toggle.setAttribute("aria-label", mostrar ? "Ocultar senha" : "Mostrar senha");
  });

  // Esqueci minha senha
  const viewLogin = $("view-login");
  const viewRecuperar = $("view-recuperar");
  const formRec = $("recuperar-form");
  const inputRec = $("usuario-rec");
  const msgRec = $("recuperar-msg");

  $("link-esqueci").addEventListener("click", () => {
    viewLogin.hidden = true;
    viewRecuperar.hidden = false;
    msgRec.hidden = true;
    inputRec.value = inputUsuario.value.trim();
    inputRec.focus();
  });

  $("link-voltar").addEventListener("click", () => {
    viewRecuperar.hidden = true;
    viewLogin.hidden = false;
    inputUsuario.focus();
  });

  formRec.addEventListener("submit", async e => {
    e.preventDefault();
    if (!inputRec.value.trim()) {
      setErroCampo(inputRec, "Informe seu usuário.");
      inputRec.focus();
      return;
    }
    setErroCampo(inputRec, "");
    await Auth.solicitarRecuperacao(inputRec.value.trim());
    msgRec.textContent = "Se o usuário existir, enviaremos as instruções para o e-mail cadastrado.";
    msgRec.hidden = false;
  });
})();
