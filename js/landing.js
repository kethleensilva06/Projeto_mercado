(() => {
  const $ = id => document.getElementById(id);

  // Janela de contato
  const dialog = $("contato");
  const abrirContato = () => {
    msg.hidden = true;
    dialog.showModal();
    $("c-nome").focus();
  };
  $("abrir-contato").addEventListener("click", abrirContato);
  $("abrir-contato-hero").addEventListener("click", abrirContato);
  $("fechar-contato").addEventListener("click", () => dialog.close());
  // Fecha ao clicar fora da janela
  dialog.addEventListener("click", e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const dentro = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!dentro) dialog.close();
  });

  /*
   * Formulário de contato.
   * Simula a captura de contato descrita no projeto: grava o interesse do
   * visitante para retorno da equipe. Trocar por um POST quando houver API.
   */
  const CONTATOS_KEY = "mercado.contatos";
  const form = $("contact-form");
  const msg = $("contact-msg");
  const campos = {
    nome: { el: $("c-nome"), erro: "Informe seu nome." },
    email: { el: $("c-email"), erro: "Informe um e-mail válido." },
    mensagem: { el: $("c-mensagem"), erro: "Escreva sua mensagem." },
  };

  function setErro(el, texto) {
    $(el.id + "-error").textContent = texto;
    el.setAttribute("aria-invalid", texto ? "true" : "false");
  }

  Object.values(campos).forEach(({ el }) =>
    el.addEventListener("input", () => {
      if (el.getAttribute("aria-invalid") === "true") setErro(el, "");
    })
  );

  form.addEventListener("submit", e => {
    e.preventDefault();
    msg.hidden = true;

    let primeiroInvalido = null;
    Object.values(campos).forEach(({ el, erro }) => {
      const valido = el.value.trim() && (el.type !== "email" || el.checkValidity());
      setErro(el, valido ? "" : erro);
      if (!valido && !primeiroInvalido) primeiroInvalido = el;
    });
    if (primeiroInvalido) {
      primeiroInvalido.focus();
      return;
    }

    let contatos = [];
    try { contatos = JSON.parse(localStorage.getItem(CONTATOS_KEY)) || []; } catch (_) {}
    contatos.push({
      nome: campos.nome.el.value.trim(),
      email: campos.email.el.value.trim(),
      mensagem: campos.mensagem.el.value.trim(),
      dataHora: new Date().toISOString(),
    });
    try { localStorage.setItem(CONTATOS_KEY, JSON.stringify(contatos)); } catch (_) {}

    form.reset();
    msg.textContent = "Mensagem enviada! Nossa equipe vai retornar em breve.";
    msg.hidden = false;
  });
})();
