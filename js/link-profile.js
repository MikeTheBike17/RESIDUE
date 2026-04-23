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
  const inferLinkLabel = (url, fallback) => {
    if (!url) return fallback || 'Link';
    const value = String(url || '').trim().toLowerCase();
    if (/^mailto:/i.test(value)) return 'Email';
    if (/^tel:/i.test(value)) return 'Call';
    try {
      const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
      if (host.includes('linkedin')) return 'LinkedIn';
      if (host.includes('instagram')) return 'Instagram';
      if (host.includes('pinterest')) return 'Pinterest';
      if (host.includes('tiktok')) return 'TikTok';
      if (host.includes('whatsapp') || host.includes('wa.me')) return 'WhatsApp';
      if (host.includes('youtube')) return 'YouTube';
      if (host.includes('facebook')) return 'Facebook';
      if (host.includes('x.com') || host.includes('twitter')) return 'X';
      if (host.includes('google.') && host.includes('maps')) return 'Location';
      if (host.includes('maps.apple')) return 'Location';
      if (host.includes('residue')) return 'Residue';
    } catch {}
    return fallback || 'Link';
  };
  const syncCompanySection = () => {
    const section = document.getElementById('lt-company-section');
    const heading = document.getElementById('lt-company-heading');
    const nameEl = document.getElementById('lt-company-name');
    const bioEl = document.getElementById('lt-company-bio');
    const logo = document.getElementById('lt-company-logo');
    const hasName = !!String(nameEl?.textContent || '').trim();
    const hasBio = !!String(bioEl?.textContent || '').trim();
    const hasLogo = !!String(logo?.getAttribute('src') || '').trim() && !logo?.hidden;
    if (heading) heading.hidden = !(hasLogo || hasName);
    if (section) section.hidden = !(hasLogo || hasName || hasBio);
  };
  const setCompanyLogo = (url) => {
    const logo = document.getElementById('lt-company-logo');
    const value = String(url || '').trim();
    if (logo) {
      if (value) {
        logo.src = value;
        logo.hidden = false;
      } else {
        logo.removeAttribute('src');
        logo.hidden = true;
      }
    }
    syncCompanySection();
  };
  setText('lt-company-name', parseBool(meta.show_company_name, false) ? meta.company_name : '');
  setText('lt-company-bio', parseBool(meta.show_company_bio, false) ? meta.company_bio : '');
  setCompanyLogo(parseBool(meta.show_company_logo, false) ? meta.company_logo_url : '');
  setText('lt-name', profile?.name || 'Your name');
  setText('lt-title', parseBool(meta.show_role, true) ? (profile?.title || '') : '');
  setText('lt-bio', parseBool(meta.show_bio, true) ? (profile?.bio || '') : '');
  document.body?.setAttribute('data-theme', profile?.theme === 'dark' ? 'dark' : 'light');
  const avatar = document.getElementById('lt-avatar');
  if (avatar) avatar.src = profile?.avatar_url || 'https://placehold.co/220x220?text=Profile';
  const linksWrap = document.getElementById('lt-links');
  if (linksWrap) {
    const seen = new Set();
    linksWrap.innerHTML = '';
    links.forEach(link => {
      if (!link?.url || link.hidden) return;
      const inferredLabel = inferLinkLabel(link.url, link.label || link.url);
      if (inferredLabel === 'Call' || /^tel:/i.test(link.url)) return;
      const key = `${inferredLabel.toLowerCase()}::${String(link.url).trim().toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      const a = document.createElement('a');
      a.href = link.url;
      a.textContent = inferredLabel;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      linksWrap.appendChild(a);
    });
  }

  setTimeout(hideOverlay, 200);
});
