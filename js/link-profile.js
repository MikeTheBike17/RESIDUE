// Thin wrapper: prefer Supabase-backed render from link-app.js; fallback to local storage preview.
window.addEventListener('DOMContentLoaded', () => {
  if (window.linktree?.renderPublicProfile) {
    window.linktree.renderPublicProfile();
    return;
  }

  // Fallback for file:// or missing Supabase config (local preview)
  const qs = new URLSearchParams(window.location.search);
  const slug = (qs.get('u') || '').trim().toLowerCase();
  const overlay = document.getElementById('lt-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.add('active');
  }
  const hideOverlay = () => {
    overlay?.classList.remove('active');
    overlay?.classList.add('hide');
    if (overlay) overlay.style.display = 'none';
  };

  const profileKey = `residue_link_profile_${slug}`;
  const galleryKey = `residue_link_gallery_${slug}`;
  const musicKey = `residue_link_music_${slug}`;
  let profile = null;
  try { profile = JSON.parse(localStorage.getItem(profileKey) || 'null'); } catch {}
  let gallery = [];
  try { gallery = JSON.parse(localStorage.getItem(galleryKey) || '[]'); } catch {}
  let music = [];
  try { music = JSON.parse(localStorage.getItem(musicKey) || '[]'); } catch {}

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
  setText('lt-name', profile?.name || 'Your name');
  setText('lt-title', profile?.title || '');
  setText('lt-bio', profile?.bio || '');
  const avatar = document.getElementById('lt-avatar');
  if (avatar) avatar.src = profile?.avatar_url || 'https://placehold.co/220x220?text=Profile';
  const linksWrap = document.getElementById('lt-links');
  if (linksWrap) {
    linksWrap.innerHTML = '';
    (profile?.links || []).forEach(link => {
      const a = document.createElement('a');
      a.href = link.url;
      a.textContent = link.label || link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      linksWrap.appendChild(a);
    });
    if (gallery?.length) {
      const a = document.createElement('a');
      a.href = `gallery.html?u=${encodeURIComponent(slug)}`;
      a.textContent = 'View Gallery';
      a.className = 'lt-gallery-btn';
      linksWrap.appendChild(a);
    }
    if (music?.length) {
      const a = document.createElement('a');
      a.href = `music.html?u=${encodeURIComponent(slug)}`;
      a.textContent = 'View Music';
      a.className = 'lt-gallery-btn';
      linksWrap.appendChild(a);
    }
  }

  setTimeout(hideOverlay, 200);
});
