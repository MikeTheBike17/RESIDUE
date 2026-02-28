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
  let profile = null;
  try { profile = JSON.parse(localStorage.getItem(profileKey) || 'null'); } catch {}

  const parseBool = (val, fallback = true) => {
    if (val == null) return fallback;
    const s = String(val).toLowerCase();
    return !(s === '0' || s === 'false' || s === 'no' || s === 'off');
  };
  const meta = {};
  const links = (profile?.links || []).filter(link => {
    const label = (link?.label || '').trim();
    if (label.startsWith('__meta__')) {
      const key = label.slice('__meta__'.length);
      const raw = String(link?.url || '');
      meta[key] = raw.startsWith('meta:') ? decodeURIComponent(raw.slice(5)) : raw;
      return false;
    }
    return true;
  });

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
  setText('lt-name', profile?.name || 'Your name');
  setText('lt-title', parseBool(meta.show_role, true) ? (profile?.title || '') : '');
  setText('lt-bio', parseBool(meta.show_bio, true) ? (profile?.bio || '') : '');
  const avatar = document.getElementById('lt-avatar');
  if (avatar) avatar.src = profile?.avatar_url || 'https://placehold.co/220x220?text=Profile';
  const linksWrap = document.getElementById('lt-links');
  if (linksWrap) {
    linksWrap.innerHTML = '';
    links.forEach(link => {
      if (!link?.url || link.hidden) return;
      const a = document.createElement('a');
      a.href = link.url;
      a.textContent = link.label || link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      linksWrap.appendChild(a);
    });
  }

  setTimeout(hideOverlay, 200);
});
