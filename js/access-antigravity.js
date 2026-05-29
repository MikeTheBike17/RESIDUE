(() => {
  const body = document.body;
  if (!body?.classList.contains('access-page')) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let centerX = window.innerWidth / 2;
  let centerY = window.innerHeight / 2;
  let animationFrame = 0;

  const pointer = {
    x: centerX,
    y: centerY,
    active: false
  };

  const spotlight = {
    x: centerX,
    y: centerY
  };

  const applySpotlightPosition = (x, y) => {
    body.style.setProperty('--access-reveal-x', `${x}px`);
    body.style.setProperty('--access-reveal-y', `${y}px`);
  };

  const requestUpdate = () => {
    if (animationFrame) return;
    animationFrame = window.requestAnimationFrame(updateSpotlight);
  };

  function resize() {
    centerX = window.innerWidth / 2;
    centerY = window.innerHeight / 2;

    if (!pointer.active) {
      pointer.x = centerX;
      pointer.y = centerY;
      spotlight.x = centerX;
      spotlight.y = centerY;
      applySpotlightPosition(centerX, centerY);
    }
  }

  function setPointer(x, y) {
    pointer.x = x;
    pointer.y = y;
    pointer.active = true;

    if (prefersReducedMotion) {
      spotlight.x = x;
      spotlight.y = y;
      applySpotlightPosition(x, y);
      return;
    }

    requestUpdate();
  }

  function clearPointer() {
    pointer.active = false;

    if (prefersReducedMotion) {
      spotlight.x = centerX;
      spotlight.y = centerY;
      applySpotlightPosition(centerX, centerY);
      return;
    }

    requestUpdate();
  }

  function handlePointerMove(event) {
    setPointer(event.clientX, event.clientY);
  }

  function handlePointerDown(event) {
    setPointer(event.clientX, event.clientY);
  }

  function updateSpotlight() {
    animationFrame = 0;

    const targetX = pointer.active ? pointer.x : centerX;
    const targetY = pointer.active ? pointer.y : centerY;
    const easing = 0.14;

    spotlight.x += (targetX - spotlight.x) * easing;
    spotlight.y += (targetY - spotlight.y) * easing;
    applySpotlightPosition(spotlight.x, spotlight.y);

    const settled =
      Math.abs(targetX - spotlight.x) < 0.5 &&
      Math.abs(targetY - spotlight.y) < 0.5;

    if (!settled) {
      requestUpdate();
    }
  }

  resize();
  applySpotlightPosition(centerX, centerY);

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  window.addEventListener('pointerdown', handlePointerDown, { passive: true });
  window.addEventListener('pointerleave', clearPointer);
  window.addEventListener('blur', clearPointer);

  window.addEventListener('beforeunload', () => {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
    }
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerdown', handlePointerDown);
    window.removeEventListener('pointerleave', clearPointer);
    window.removeEventListener('blur', clearPointer);
  }, { once: true });
})();
