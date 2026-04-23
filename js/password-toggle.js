(() => {
  const eyeIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;

  const eyeOffIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 3l18 18"></path>
      <path d="M10.6 10.6A3 3 0 0 0 13.4 13.4"></path>
      <path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c6 0 9.5 7 9.5 7a17.6 17.6 0 0 1-2.2 3.1"></path>
      <path d="M6.6 6.6C3.9 8.2 2.5 12 2.5 12s3.5 7 9.5 7a9.9 9.9 0 0 0 4.1-.9"></path>
    </svg>
  `;

  const setupPasswordToggle = input => {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.passwordToggleBound === 'true') return;

    const wrapper = document.createElement('div');
    wrapper.className = 'password-reveal-field';
    input.parentNode?.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const button = document.createElement('button');
    button.className = 'password-reveal-toggle';
    button.type = 'button';
    button.setAttribute('aria-label', 'Show password');
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = eyeIcon;
    wrapper.appendChild(button);

    input.dataset.passwordToggleBound = 'true';

    button.addEventListener('click', () => {
      const shouldShow = input.type === 'password';
      input.type = shouldShow ? 'text' : 'password';
      button.innerHTML = shouldShow ? eyeOffIcon : eyeIcon;
      button.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
      button.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
      input.focus();
    });
  };

  document.querySelectorAll('input[type="password"]').forEach(setupPasswordToggle);
})();
