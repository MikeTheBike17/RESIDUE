(() => {
  const body = document.body;
  if (!body?.classList.contains('access-page')) return;

  const canvas = document.querySelector('.access-antigravity-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const context = canvas.getContext('2d');
  if (!context) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = () => Math.min(window.devicePixelRatio || 1, 1.8);

  const pointer = { x: 0, y: 0, active: false, movedAt: 0 };
  const virtualPointer = { x: 0, y: 0 };
  let width = 0;
  let height = 0;
  let centerX = 0;
  let centerY = 0;
  let magnetRadius = 0;
  let ringRadius = 0;
  let animationFrame = 0;
  let particles = [];

  const settings = {
    count: prefersReducedMotion ? 90 : 180,
    waveSpeed: 1.8,
    waveAmplitude: 16,
    lerpSpeed: 0.055,
    pulseSpeed: 2.2,
    fieldStrength: 0.22,
    particleVariance: 0.55,
    depthFactor: 0.45,
    autoAnimate: true
  };

  const random = (min, max) => min + Math.random() * (max - min);

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    centerX = width / 2;
    centerY = height / 2;
    magnetRadius = Math.min(width, height) * 0.18;
    ringRadius = Math.min(width, height) * 0.085;

    canvas.width = Math.round(width * dpr());
    canvas.height = Math.round(height * dpr());
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    context.setTransform(dpr(), 0, 0, dpr(), 0, 0);

    particles = Array.from({ length: settings.count }, () => {
      const x = random(-width * 0.08, width * 1.08);
      const y = random(-height * 0.08, height * 1.08);
      const z = random(-1, 1);

      return {
        x,
        y,
        z,
        baseX: x,
        baseY: y,
        t: random(0, Math.PI * 2),
        speed: random(0.003, 0.012),
        size: random(0.8, 2.2),
        stretch: random(7, 14),
        alpha: random(0.2, 0.8),
        drift: random(8, 36),
        variance: random(0.85, 1.15),
        radiusOffset: random(-16, 16)
      };
    });
  }

  function setPointer(clientX, clientY) {
    pointer.x = clientX;
    pointer.y = clientY;
    pointer.active = true;
    pointer.movedAt = performance.now();
  }

  function onPointerMove(event) {
    setPointer(event.clientX, event.clientY);
  }

  function onPointerLeave() {
    pointer.active = false;
  }

  function updateVirtualPointer(time) {
    let destinationX = pointer.active ? pointer.x : centerX;
    let destinationY = pointer.active ? pointer.y : centerY;
    const idleFor = time - pointer.movedAt;

    if (settings.autoAnimate && (!pointer.active || idleFor > 1800)) {
      const orbit = time * 0.00018;
      destinationX = centerX + Math.cos(orbit) * width * 0.16;
      destinationY = centerY + Math.sin(orbit * 1.8) * height * 0.12;
    }

    const easing = prefersReducedMotion ? 0.035 : 0.06;
    virtualPointer.x += (destinationX - virtualPointer.x) * easing;
    virtualPointer.y += (destinationY - virtualPointer.y) * easing;
  }

  function drawParticle(particle, targetX, targetY, time) {
    particle.t += particle.speed * settings.waveSpeed;

    const dx = particle.x - targetX;
    const dy = particle.y - targetY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    let nextX = particle.baseX + Math.cos(time * 0.00025 + particle.t) * particle.drift;
    let nextY = particle.baseY + Math.sin(time * 0.00018 + particle.t * 1.3) * particle.drift;
    let depthLift = Math.sin(particle.t * 1.6) * 14 * settings.depthFactor;

    if (distance < magnetRadius) {
      const angle = Math.atan2(dy, dx);
      const wave = Math.sin(particle.t * settings.waveSpeed + angle) * settings.waveAmplitude;
      const fieldOffset = particle.radiusOffset * settings.fieldStrength;
      const currentRing = ringRadius + wave + fieldOffset;

      nextX = targetX + Math.cos(angle) * currentRing;
      nextY = targetY + Math.sin(angle) * currentRing;
      depthLift += Math.cos(particle.t * 2.4) * 18 * settings.depthFactor;
    }

    particle.x += (nextX - particle.x) * settings.lerpSpeed;
    particle.y += (nextY - particle.y) * settings.lerpSpeed;

    const ringDistance = Math.abs(Math.sqrt((particle.x - targetX) ** 2 + (particle.y - targetY) ** 2) - ringRadius);
    const magneticGlow = Math.max(0, 1 - ringDistance / (magnetRadius * 0.7));
    const pulse = 0.75 + Math.sin(particle.t * settings.pulseSpeed) * 0.25 * settings.particleVariance;
    const size = particle.size * (0.7 + magneticGlow * 1.8) * pulse * particle.variance;
    const length = particle.stretch * (0.7 + magneticGlow * 1.45);
    const angle = Math.atan2(targetY - particle.y, targetX - particle.x);

    context.save();
    context.translate(particle.x, particle.y + depthLift);
    context.rotate(angle + Math.PI / 2);
    context.globalAlpha = Math.min(0.95, particle.alpha * (0.45 + magneticGlow * 0.9));

    const core = context.createLinearGradient(0, -length * 0.5, 0, length * 0.5);
    core.addColorStop(0, 'rgba(214, 194, 165, 0)');
    core.addColorStop(0.3, 'rgba(124, 115, 98, 0.64)');
    core.addColorStop(0.68, 'rgba(216, 176, 122, 0.9)');
    core.addColorStop(1, 'rgba(214, 194, 165, 0)');
    context.fillStyle = core;

    const capsuleWidth = Math.max(1.2, size * 1.6);
    const capsuleHeight = Math.max(8, length);
    const radius = capsuleWidth * 0.5;

    context.beginPath();
    context.roundRect(-capsuleWidth / 2, -capsuleHeight / 2, capsuleWidth, capsuleHeight, radius);
    context.fill();

    context.globalAlpha *= 0.32;
    context.fillStyle = 'rgba(245, 237, 223, 0.82)';
    context.beginPath();
    context.roundRect(-capsuleWidth / 3, -capsuleHeight / 4, capsuleWidth / 1.5, capsuleHeight / 2, radius);
    context.fill();
    context.restore();
  }

  function render(time) {
    updateVirtualPointer(time);

    context.clearRect(0, 0, width, height);

    const halo = context.createRadialGradient(
      virtualPointer.x,
      virtualPointer.y,
      0,
      virtualPointer.x,
      virtualPointer.y,
      magnetRadius * 1.7
    );
    halo.addColorStop(0, 'rgba(216, 176, 122, 0.12)');
    halo.addColorStop(0.45, 'rgba(184, 164, 132, 0.06)');
    halo.addColorStop(1, 'rgba(216, 176, 122, 0)');
    context.fillStyle = halo;
    context.fillRect(0, 0, width, height);

    particles.forEach(particle => drawParticle(particle, virtualPointer.x, virtualPointer.y, time));
    animationFrame = window.requestAnimationFrame(render);
  }

  resize();
  virtualPointer.x = centerX;
  virtualPointer.y = centerY;
  pointer.movedAt = performance.now();

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('blur', onPointerLeave);

  animationFrame = window.requestAnimationFrame(render);

  window.addEventListener('beforeunload', () => {
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerMove);
    window.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('blur', onPointerLeave);
  }, { once: true });
})();
