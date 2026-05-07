// Thin wrapper: prefer the full render from link-app.js; fall back to local preview data.
window.addEventListener('DOMContentLoaded', () => {
  if (window.linktree?.renderPublicProfile) {
    window.linktree.renderPublicProfile();
    return;
  }

  const qs = new URLSearchParams(window.location.search);
  const DEFAULT_PROFILE_NAME = 'Your name';

  const normalizeTheme = theme => (theme === 'dark' || theme === 'light' ? theme : null);
  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const resolveSlug = value => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = resolveSlug(qs.get('u') || '');

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

  const themeStorageKey = (scope, value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized ? `residue_link_theme_${scope}_${normalized}` : '';
  };
  const buildThemeStorageKeys = ({ profileId = '', slug: contextSlug = '', email = '' } = {}) => {
    const normalizedSlug = resolveSlug(contextSlug || '');
    const normalizedEmail = normalizeEmail(email || '');
    return [...new Set([
      themeStorageKey('profile', profileId),
      themeStorageKey('slug', normalizedSlug),
      themeStorageKey('email', normalizedEmail)
    ].filter(Boolean))];
  };
  const readStoredThemePreference = (context = {}) => {
    try {
      for (const key of buildThemeStorageKeys(context)) {
        const storedTheme = normalizeTheme(localStorage.getItem(key));
        if (storedTheme) return storedTheme;
      }
    } catch {}
    return null;
  };
  const applyTheme = theme => {
    const nextTheme = normalizeTheme(theme) || 'light';
    document.documentElement?.setAttribute('data-theme', nextTheme);
    document.body?.setAttribute('data-theme', nextTheme);
  };

  const buildAdminUrl = () => (
    slug ? `link-admin.html?u=${encodeURIComponent(slug)}` : 'link-admin.html'
  );
  const updateAdminLinks = () => {
    const adminUrl = buildAdminUrl();
    const firstSetupBtn = document.getElementById('lt-first-setup-btn');
    const manageLink = document.getElementById('lt-manage-link');
    if (firstSetupBtn instanceof HTMLAnchorElement) firstSetupBtn.href = adminUrl;
    if (manageLink instanceof HTMLAnchorElement) manageLink.href = adminUrl;
  };

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '';
  };
  const setPublicSetupMode = showFirstSetup => {
    const card = document.querySelector('.lt-card');
    const firstSetup = document.getElementById('lt-first-setup');
    const profileWrap = document.querySelector('.lt-profile');
    const linksWrap = document.getElementById('lt-links');
    const saveBtn = document.getElementById('lt-save-contact-btn');
    const footer = document.querySelector('.lt-footer');
    const statusEl = document.getElementById('lt-status');
    if (card) card.classList.toggle('is-first-setup', !!showFirstSetup);
    if (firstSetup) firstSetup.hidden = !showFirstSetup;
    if (profileWrap) profileWrap.hidden = !!showFirstSetup;
    if (linksWrap) linksWrap.hidden = !!showFirstSetup;
    if (saveBtn) {
      saveBtn.hidden = true;
      saveBtn.disabled = true;
    }
    if (footer) footer.hidden = false;
    if (statusEl) {
      statusEl.hidden = !!showFirstSetup;
      if (showFirstSetup) statusEl.textContent = '';
    }
    updateAdminLinks();
  };

  const parseBool = (val, fallback = true) => {
    if (val == null) return fallback;
    const s = String(val).toLowerCase();
    return !(s === '0' || s === 'false' || s === 'no' || s === 'off');
  };

  const renderNormalLinks = (entries, { showEmptyState = true } = {}) => {
    const linksWrap = document.getElementById('lt-links');
    if (!linksWrap) return;
    linksWrap.innerHTML = '';
    linksWrap.hidden = false;
    if (!entries.length) {
      if (!showEmptyState) {
        linksWrap.hidden = true;
        return;
      }
      linksWrap.innerHTML = '<div class="lt-note lt-center">No links yet.</div>';
      return;
    }
    entries.forEach(link => {
      const a = document.createElement('a');
      a.href = link.url;
      a.textContent = link.label;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      linksWrap.appendChild(a);
    });
  };

  const showFirstTimeCard = () => {
    setPublicSetupMode(true);
    applyTheme('light');
    setText('lt-company-name', '');
    setText('lt-company-bio', '');
    setText('lt-name', '');
    setText('lt-title', '');
    setText('lt-bio', '');
    const logo = document.getElementById('lt-company-logo');
    if (logo) {
      logo.removeAttribute('src');
      logo.hidden = true;
    }
    const companyWebsite = document.getElementById('lt-company-website-btn');
    if (companyWebsite instanceof HTMLAnchorElement) {
      companyWebsite.hidden = true;
      companyWebsite.removeAttribute('href');
      companyWebsite.textContent = 'Website';
    }
    const avatar = document.getElementById('lt-avatar');
    if (avatar) avatar.removeAttribute('src');
    renderNormalLinks([], { showEmptyState: false });
  };

  const showPlaceholder = message => {
    setPublicSetupMode(false);
    applyTheme('light');
    setText('lt-company-name', '');
    setText('lt-company-bio', '');
    setText('lt-name', 'Your name');
    setText('lt-title', 'Your title');
    setText('lt-bio', 'Add a short description.');
    const avatar = document.getElementById('lt-avatar');
    if (avatar) avatar.src = 'https://placehold.co/220x220?text=Profile';
    renderNormalLinks([]);
    const statusEl = document.getElementById('lt-status');
    if (statusEl) {
      statusEl.hidden = !message;
      statusEl.textContent = message || '';
    }
  };

  const profileKey = `residue_link_profile_${slug}`;
  let profile = null;
  try {
    profile = JSON.parse(localStorage.getItem(profileKey) || 'null');
  } catch {}

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

  const isDefaultDraftLink = (link, authEmail = '') => {
    const label = String(link?.label || '').trim().toLowerCase();
    const url = String(link?.url || '').trim();
    if (!url) return true;
    if (label === 'call') return /^tel:\+?\s*$/i.test(url);
    if (label === 'email') {
      const normalizedUrl = normalizeEmail(url.replace(/^mailto:/i, ''));
      const normalizedAuth = normalizeEmail(authEmail);
      if (normalizedAuth) return normalizedUrl === normalizedAuth;
      return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(url);
    }
    return false;
  };

  const hasMeaningfulMetaContent = candidateMeta => (
    ['company_name', 'company_bio', 'company_logo_url']
      .some(key => !!String(candidateMeta?.[key] || '').trim())
  );

  const readExplicitCardReady = candidateMeta => {
    if (!Object.prototype.hasOwnProperty.call(candidateMeta || {}, 'card_ready')) return null;
    return parseBool(candidateMeta.card_ready, false);
  };

  const hasConfiguredCardContent = candidateProfile => {
    if (!candidateProfile) return false;
    const authEmail = normalizeEmail(candidateProfile?.auth_email || '');
    const displayName = String(candidateProfile?.name || '').trim();
    const emailPrefix = authEmail ? authEmail.split('@')[0] : '';
    const explicitReady = readExplicitCardReady(meta);
    if (explicitReady != null) return explicitReady;
    if (hasMeaningfulMetaContent(meta)) return true;
    if (displayName && displayName !== DEFAULT_PROFILE_NAME && displayName.toLowerCase() !== emailPrefix.toLowerCase()) {
      return true;
    }
    if (String(candidateProfile?.title || '').trim()) return true;
    if (String(candidateProfile?.bio || '').trim()) return true;
    if (String(candidateProfile?.avatar_url || '').trim()) return true;
    return links.some(link => !isDefaultDraftLink(link, authEmail));
  };

  updateAdminLinks();
  if (!slug) {
    showPlaceholder('No profile yet. Tap manage to add yours.');
    window.setTimeout(hideOverlay, 200);
    return;
  }
  if (!profile || !hasConfiguredCardContent(profile)) {
    showFirstTimeCard();
    window.setTimeout(hideOverlay, 200);
    return;
  }

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

  const setCompanyLogo = url => {
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

  const isCompanySectionVisible = () => {
    const section = document.getElementById('lt-company-section');
    return !!section && !section.hidden;
  };

  const setCompanyWebsiteLink = link => {
    const companyWebsite = document.getElementById('lt-company-website-btn');
    if (!companyWebsite) return false;
    const url = String(link?.url || '').trim();
    if (!url) {
      companyWebsite.hidden = true;
      companyWebsite.textContent = 'Website';
      companyWebsite.removeAttribute('href');
      return false;
    }
    companyWebsite.href = url;
    companyWebsite.textContent = String(link?.label || 'Website').trim() || 'Website';
    companyWebsite.hidden = false;
    return true;
  };

  const normalizeComparableUrl = url => {
    const value = String(url || '').trim();
    if (!value) return '';
    try {
      const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      return parsed.href.replace(/\/$/, '').toLowerCase();
    } catch {
      return value.replace(/\/$/, '').toLowerCase();
    }
  };

  const getPublicLinks = rawLinks => {
    const seen = new Set();
    return (rawLinks || []).reduce((acc, link) => {
      if (!link?.url || link.hidden) return acc;
      const sourceLabel = String(link.label || '').trim();
      const inferredLabel = inferLinkLabel(link.url, sourceLabel || link.url);
      if (inferredLabel === 'Call' || /^tel:/i.test(link.url)) return acc;
      const key = `${inferredLabel.toLowerCase()}::${String(link.url).trim().toLowerCase()}`;
      if (seen.has(key)) return acc;
      seen.add(key);
      acc.push({ url: link.url, label: inferredLabel, sourceLabel });
      return acc;
    }, []);
  };

  const isGenericWebsiteLinkCandidate = link => {
    const label = String(link?.label || '').trim().toLowerCase();
    const sourceLabel = String(link?.sourceLabel || '').trim().toLowerCase();
    const url = String(link?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return false;
    const excluded = new Set([
      'website',
      'location',
      'email',
      'whatsapp',
      'whatsapp social',
      'linkedin',
      'instagram',
      'youtube',
      'facebook',
      'x',
      'pinterest',
      'tiktok',
      'call'
    ]);
    return !excluded.has(label) && !excluded.has(sourceLabel);
  };

  const renderPublicLinks = (rawLinks, linkMeta = {}) => {
    const visibleLinks = getPublicLinks(rawLinks);
    const includeCompanyWebsite = isCompanySectionVisible();
    const showWebsite = parseBool(linkMeta.show_website, false);
    const savedWebsiteUrl = normalizeComparableUrl(linkMeta.website_url || '');
    const normalLinks = [];
    let companyWebsite = null;
    visibleLinks.forEach(link => {
      const sourceLabel = String(link?.sourceLabel || '').trim().toLowerCase();
      const comparableUrl = normalizeComparableUrl(link?.url || '');
      const matchesSavedWebsite = !!savedWebsiteUrl && comparableUrl === savedWebsiteUrl;
      const isWebsiteFallback = showWebsite && isGenericWebsiteLinkCandidate(link);
      if (!companyWebsite && includeCompanyWebsite && (sourceLabel === 'website' || matchesSavedWebsite || isWebsiteFallback)) {
        companyWebsite = { ...link, label: 'Website' };
        return;
      }
      normalLinks.push(link);
    });
    const movedWebsite = setCompanyWebsiteLink(companyWebsite);
    renderNormalLinks(normalLinks, { showEmptyState: !movedWebsite });
  };

  setPublicSetupMode(false);
  setText('lt-company-name', parseBool(meta.show_company_name, false) ? meta.company_name : '');
  setText('lt-company-bio', parseBool(meta.show_company_bio, false) ? meta.company_bio : '');
  setCompanyLogo(parseBool(meta.show_company_logo, false) ? meta.company_logo_url : '');
  setText('lt-name', profile?.name || DEFAULT_PROFILE_NAME);
  setText('lt-title', parseBool(meta.show_role, false) ? (profile?.title || '') : '');
  setText('lt-bio', parseBool(meta.show_bio, false) ? (profile?.bio || '') : '');
  applyTheme(
    readStoredThemePreference({
      profileId: profile?.id,
      slug: profile?.slug || slug,
      email: profile?.auth_email
    }) || profile?.theme
  );
  const avatar = document.getElementById('lt-avatar');
  if (avatar) avatar.src = profile?.avatar_url || 'https://placehold.co/220x220?text=Profile';
  renderPublicLinks(links, meta);

  window.setTimeout(hideOverlay, 200);
});
