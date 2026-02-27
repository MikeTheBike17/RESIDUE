(() => {
  // Toggle window here. When a backend exists, replace with live status fetch.
  const dropConfig = {
    isOpen: false,
    end: null // set ISO timestamp to auto-close; null keeps manual control
  };

  const stateEl = document.getElementById('drop-state');
  if (!stateEl) return;

  const renderClosed = message => {
    stateEl.innerHTML = `
      <p class="muted">${message || 'Closed for now.'}</p>
      <a class="btn" href="access.html#request-form">Request Access</a>
    `;
  };

  if (!dropConfig.isOpen) {
    renderClosed('Closed for now. Request a code to enter.');
    return;
  }

  const endTime = dropConfig.end ? new Date(dropConfig.end) : null;
  const now = new Date();

  if (endTime && now >= endTime) {
    renderClosed('Closed for now. Window elapsed.');
    return;
  }

  const status = document.createElement('p');
  status.className = 'muted';
  status.textContent = 'Window active. No code required while open.';
  const countdownEl = document.createElement('div');
  countdownEl.className = 'countdown';

  stateEl.appendChild(status);
  stateEl.appendChild(countdownEl);

  const tick = () => {
    if (!endTime) {
      countdownEl.textContent = 'Open until manually closed.';
      return;
    }
    const delta = endTime - new Date();
    if (delta <= 0) {
      renderClosed('Closed. Window elapsed.');
      clearInterval(timer);
      return;
    }
    const hours = Math.floor(delta / 36e5);
    const minutes = Math.floor((delta % 36e5) / 6e4);
    const seconds = Math.floor((delta % 6e4) / 1e3);
    countdownEl.textContent = `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')} remaining`;
  };

  tick();
  const timer = setInterval(tick, 1000);
})();
