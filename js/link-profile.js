window.addEventListener('DOMContentLoaded', () => {
  const qs = new URLSearchParams(window.location.search);
  const slug = (qs.get('u') || '').trim().toLowerCase();
  const isPreview = qs.get('preview') === '1';
  const profileKey = `residue_link_profile_${slug}`;
  const galleryKey = `residue_link_gallery_${slug}`;
  const musicKey = `residue_link_music_${slug}`;

  if (isPreview) {
    document.body.classList.add('preview-mode');
  }

  const overlay = document.getElementById('lt-overlay');
  overlay?.removeAttribute('hidden');

  const hideOverlay = () => {
    if (!overlay) return;
    overlay.classList.add('hide');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 300);
  };

  const profile = (() => {
    try {
      return JSON.parse(localStorage.getItem(profileKey) || 'null');
    } catch {
      return null;
    }
  })();

  const galleryImages = (() => {
    try {
      const data = JSON.parse(localStorage.getItem(galleryKey) || '[]');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  })();

  const musicTracks = (() => {
    try {
      const data = JSON.parse(localStorage.getItem(musicKey) || '[]');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  })();

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '';
  };

  if (profile) {
    setText('lt-name', profile.name || 'Your name');
    setText('lt-title', profile.title || '');
    setText('lt-bio', profile.bio || '');

    const avatar = document.getElementById('lt-avatar');
    if (avatar) {
      avatar.src = profile.avatar_url || 'https://placehold.co/220x220?text=Profile';
    }

    const linksWrap = document.getElementById('lt-links');
    if (linksWrap) {
      linksWrap.innerHTML = '';
      const links = Array.isArray(profile.links) ? profile.links : [];
      links.forEach(link => {
        const a = document.createElement('a');
        a.href = link.url;
        a.textContent = link.label || link.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        linksWrap.appendChild(a);
      });

      if (galleryImages.length) {
        const galleryBtn = document.createElement('a');
        galleryBtn.href = `gallery.html?u=${encodeURIComponent(slug)}`;
        galleryBtn.textContent = 'View Gallery';
        galleryBtn.className = 'lt-gallery-btn';
        linksWrap.appendChild(galleryBtn);
      }

      if (musicTracks.length) {
        const musicBtn = document.createElement('a');
        musicBtn.href = `music.html?u=${encodeURIComponent(slug)}`;
        musicBtn.textContent = 'View Music';
        musicBtn.className = 'lt-gallery-btn';
        linksWrap.appendChild(musicBtn);
      }
    }
  }

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  setTimeout(hideOverlay, 700);
});
