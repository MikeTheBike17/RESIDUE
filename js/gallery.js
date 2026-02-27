const qs = new URLSearchParams(window.location.search);
const slug = (qs.get('u') || '').trim().toLowerCase();
const galleryKey = `residue_link_gallery_${slug}`;
const profileKey = `residue_link_profile_${slug}`;

const grid = document.getElementById('gallery-grid');
const empty = document.getElementById('gallery-empty');
const title = document.getElementById('gallery-title');
const backLink = document.getElementById('back-link');

if (backLink) {
  backLink.href = `link-profile.html?u=${encodeURIComponent(slug)}`;
}

let profile = null;
try {
  profile = JSON.parse(localStorage.getItem(profileKey) || 'null');
} catch {
  profile = null;
}

if (title && profile?.name) {
  title.textContent = `${profile.name} Gallery`;
}

let images = [];
try {
  const stored = JSON.parse(localStorage.getItem(galleryKey) || '[]');
  images = Array.isArray(stored) ? stored : [];
} catch {
  images = [];
}

if (!grid) {
  // no-op
} else if (!images.length) {
  if (empty) empty.hidden = false;
} else {
  images.forEach((src, idx) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = `Gallery image ${idx + 1}`;
    img.loading = 'lazy';
    grid.appendChild(img);
  });
}
