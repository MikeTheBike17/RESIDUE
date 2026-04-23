(() => {
  const hero = document.querySelector('.inside-hero');
  const content = document.querySelector('.inside-hero-content');
  const preview = document.querySelector('.pricing-card-preview');
  if (!hero || !content) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let collapseTimer = null;
  let pinnedOpen = false;
  let heroCurrentProgress = 0;
  let heroTargetProgress = 0;
  let heroAnimationFrame = null;
  let heroLastFrameTime = 0;

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

  function expandPreview({ pin = false } = {}) {
    if (!preview) return;
    clearCollapseTimer();
    pinnedOpen = pin || pinnedOpen;
    setPreviewPressed(true);

    if (preview.classList.contains('is-expanded')) {
      return;
    }

    preview.classList.remove('is-animating');
    preview.classList.add('is-expanded');
  }

  function wirePreviewInteractions() {
    if (!preview || prefersReducedMotion) return;

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
      if (!preview.classList.contains('is-expanded')) return;
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

  function smoothstep(value) {
    const clamped = clamp(value, 0, 1);
    return clamped * clamped * (3 - (2 * clamped));
  }

  function getHeroTargetProgress() {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const settleDistance = Math.max(540, viewportHeight * 0.78);
    return clamp(scrollY / settleDistance, 0, 1);
  }

  function applyHeroState(progress) {
    const easedProgress = smoothstep(progress);
    const imageScale = 1.22 - (0.22 * easedProgress);
    const contentScale = 1.34 - (0.34 * easedProgress);
    const contentShift = (1 - easedProgress) * 4;
    const imageShift = (1 - easedProgress) * 1.8;

    hero.style.setProperty('--inside-hero-progress', easedProgress.toFixed(3));
    hero.style.setProperty('--inside-hero-image-scale', imageScale.toFixed(3));
    hero.style.setProperty('--inside-hero-image-shift', `${imageShift.toFixed(2)}vh`);
    hero.style.setProperty('--inside-hero-content-scale', contentScale.toFixed(3));
    hero.style.setProperty('--inside-hero-content-shift', `${contentShift.toFixed(2)}vh`);
    document.body.classList.toggle('hero-settled', easedProgress > 0.995);
  }

  function setHeroState(now) {
    const delta = heroLastFrameTime ? Math.min(now - heroLastFrameTime, 64) : 16.67;
    heroLastFrameTime = now;
    const smoothing = 1 - Math.exp(-delta / 110);
    heroCurrentProgress += (heroTargetProgress - heroCurrentProgress) * smoothing;
    applyHeroState(heroCurrentProgress);
    if (Math.abs(heroTargetProgress - heroCurrentProgress) <= 0.0015) {
      heroCurrentProgress = heroTargetProgress;
      applyHeroState(heroCurrentProgress);
      heroAnimationFrame = null;
      heroLastFrameTime = 0;
      return;
    }
    heroAnimationFrame = window.requestAnimationFrame(setHeroState);
  }

  function requestUpdate() {
    heroTargetProgress = getHeroTargetProgress();
    if (heroAnimationFrame) return;
    heroAnimationFrame = window.requestAnimationFrame(setHeroState);
  }

  heroTargetProgress = getHeroTargetProgress();
  heroCurrentProgress = heroTargetProgress;
  applyHeroState(heroCurrentProgress);
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  wirePreviewInteractions();
})();
