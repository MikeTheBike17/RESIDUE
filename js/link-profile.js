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
  const getPublicLinkIconClass = (label = '', url = '') => {
    const value = `${label} ${url}`.toLowerCase();
    if (value.includes('facebook')) return 'fi fi-brands-facebook';
    if (value.includes('instagram')) return 'fi fi-brands-instagram';
    if (value.includes('whatsapp') || value.includes('wa.me')) return 'fi fi-brands-whatsapp';
    if (value.includes('linkedin')) return 'fi fi-brands-linkedin';
    if (value.includes('youtube') || value.includes('youtu.be')) return 'fi fi-brands-youtube';
    if (value.includes('tiktok')) return 'fi fi-brands-tik-tok';
    if (value.includes('twitter') || value.includes('x.com')) return 'fi fi-brands-twitter-alt';
    if (value.includes('telegram')) return 'fi fi-brands-telegram';
    if (value.includes('github')) return 'fi fi-brands-github';
    if (value.includes('spotify')) return 'fi fi-brands-spotify';
    if (value.includes('email') || value.includes('mailto:')) return 'fi fi-rr-envelope';
    if (value.includes('location') || value.includes('maps')) return 'fi fi-rr-marker';
    return 'fi fi-rr-globe';
  };
  const populatePublicLinkButton = (anchor, label, url) => {
    anchor.classList.add('lt-link');
    anchor.textContent = '';

    const icon = document.createElement('i');
    icon.className = `lt-link-icon ${getPublicLinkIconClass(label, url)}`;
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'lt-link-label';
    text.textContent = label;

    const arrow = document.createElement('span');
    arrow.className = 'lt-link-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '>';

    anchor.append(icon, text, arrow);
  };
  setText('lt-name', profile?.name || 'Your name');
  setText('lt-title', parseBool(meta.show_role, true) ? (profile?.title || '') : '');
  setText('lt-bio', parseBool(meta.show_bio, true) ? (profile?.bio || '') : '');
  document.body?.setAttribute('data-theme', profile?.theme === 'dark' ? 'dark' : 'light');
  const avatar = document.getElementById('lt-avatar');
  if (avatar) avatar.src = profile?.avatar_url || 'https://placehold.co/220x220?text=Profile';
  const linksWrap = document.getElementById('lt-links');
  if (linksWrap) {
    linksWrap.innerHTML = '';
    links.forEach(link => {
      if (!link?.url || link.hidden) return;
      if (/^tel:/i.test(link.url) || String(link.label || '').trim().toLowerCase() === 'call') return;
      const a = document.createElement('a');
      a.href = link.url;
      populatePublicLinkButton(a, link.label || link.url, link.url);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      linksWrap.appendChild(a);
    });
  }

  setTimeout(hideOverlay, 200);
});
