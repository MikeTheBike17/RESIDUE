(() => {
  const hero = document.querySelector('.inside-hero');
  const content = document.querySelector('.inside-hero-content');
  const preview = document.querySelector('.pricing-card-preview');
  if (!hero || !content) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ticking = false;
  let collapseTimer = null;
  let pinnedOpen = false;

  function isTouchViewport() {
    return window.matchMedia('(hover: none), (pointer: coarse)').matches;
  }

  function clearCollapseTimer() {
    if (!collapseTimer) return;
    window.clearTimeout(collapseTimer);
    collapseTimer = null;
  }

  function setPreviewPressed(value) {
    if (!preview) return;
    preview.setAttribute('aria-pressed', value ? 'true' : 'false');
  }

  function collapsePreview() {
    if (!preview) return;
    clearCollapseTimer();
    preview.classList.remove('is-animating', 'is-expanded');
    pinnedOpen = false;
    setPreviewPressed(false);
  }

  function finishPreviewExpand() {
    if (!preview) return;
    preview.classList.remove('is-animating');
    preview.classList.add('is-expanded');
    setPreviewPressed(true);
  }

  function expandPreview({ pin = false } = {}) {
    if (!preview) return;
    clearCollapseTimer();
    pinnedOpen = pin || pinnedOpen;
    setPreviewPressed(true);

    if (preview.classList.contains('is-expanded')) {
      return;
    }

    preview.classList.remove('is-expanded');
    void preview.offsetWidth;
    preview.classList.add('is-animating');
  }

  function wirePreviewInteractions() {
    if (!preview || prefersReducedMotion) return;

    preview.addEventListener('animationend', (event) => {
      if (event.animationName !== 'pricingCardSpinExpand') return;
      finishPreviewExpand();
    });

    preview.addEventListener('click', (event) => {
      event.stopPropagation();

      if (isTouchViewport()) {
        if (preview.classList.contains('is-expanded')) {
          collapsePreview();
          return;
        }
        expandPreview({ pin: true });
        return;
      }

      pinnedOpen = !pinnedOpen;
      if (pinnedOpen) {
        expandPreview({ pin: true });
      } else {
        collapsePreview();
      }
    });

    preview.addEventListener('mouseenter', () => {
      if (isTouchViewport()) return;
      expandPreview();
    });

    preview.addEventListener('mouseleave', () => {
      if (isTouchViewport() || pinnedOpen) return;
      clearCollapseTimer();
      collapseTimer = window.setTimeout(() => {
        if (!pinnedOpen) collapsePreview();
      }, 120);
    });

    document.addEventListener('pointerdown', (event) => {
      if (!isTouchViewport()) return;
      if (!preview.classList.contains('is-expanded') && !preview.classList.contains('is-animating')) return;
      if (preview.contains(event.target)) return;
      collapsePreview();
    });
  }

  if (prefersReducedMotion) {
    document.body.classList.add('hero-settled');
    return;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setHeroState() {
    ticking = false;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const settleDistance = viewportHeight * 0.55;
    const progress = clamp(scrollY / settleDistance, 0, 1);

    const imageScale = 1.22 - (0.22 * progress);
    const contentScale = 1.34 - (0.34 * progress);
    const contentShift = (1 - progress) * 4;
    const imageShift = (1 - progress) * 1.8;
    const heroHeight = 128 - (28 * progress);

    hero.style.setProperty('--inside-hero-progress', progress.toFixed(3));
    hero.style.setProperty('--inside-hero-image-scale', imageScale.toFixed(3));
    hero.style.setProperty('--inside-hero-image-shift', `${imageShift.toFixed(2)}vh`);
    hero.style.setProperty('--inside-hero-content-scale', contentScale.toFixed(3));
    hero.style.setProperty('--inside-hero-content-shift', `${contentShift.toFixed(2)}vh`);
    hero.style.minHeight = `${heroHeight.toFixed(2)}svh`;

    document.body.classList.toggle('hero-settled', progress > 0.98);
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(setHeroState);
  }

  setHeroState();
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  wirePreviewInteractions();
})();
