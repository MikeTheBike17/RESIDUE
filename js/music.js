const qs = new URLSearchParams(window.location.search);
const slug = (qs.get('u') || '').trim().toLowerCase();
const musicKey = `residue_link_music_${slug}`;
const profileKey = `residue_link_profile_${slug}`;

const title = document.getElementById('music-title');
const trackList = document.getElementById('track-list');
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
  title.textContent = `${profile.name} Music`;
}

let tracks = [];
try {
  const stored = JSON.parse(localStorage.getItem(musicKey) || '[]');
  tracks = Array.isArray(stored) ? stored : [];
} catch {
  tracks = [];
}

if (!tracks.length) {
  tracks = [
    {
      name: 'Mock Track (Sample)',
      src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
    }
  ];
}

let currentAudio = null;
let currentButton = null;

const stopCurrent = () => {
  if (!currentAudio || !currentButton) return;
  currentAudio.pause();
  currentAudio.currentTime = 0;
  currentButton.textContent = 'Play';
  currentAudio = null;
  currentButton = null;
};

tracks.forEach((track, index) => {
  const row = document.createElement('article');
  row.className = 'track-item';

  const name = document.createElement('p');
  name.className = 'track-name';
  name.textContent = track.name || `Track ${index + 1}`;

  const button = document.createElement('button');
  button.className = 'play-btn';
  button.type = 'button';
  button.textContent = 'Play';

  const audio = new Audio(track.src);
  audio.preload = 'none';

  audio.addEventListener('ended', () => {
    if (currentButton === button) {
      button.textContent = 'Play';
      currentAudio = null;
      currentButton = null;
    }
  });

  button.addEventListener('click', () => {
    if (currentAudio && currentAudio !== audio) {
      stopCurrent();
    }

    if (audio.paused) {
      audio.play().then(() => {
        currentAudio = audio;
        currentButton = button;
        button.textContent = 'Pause';
      }).catch(() => {
        button.textContent = 'Play';
      });
    } else {
      audio.pause();
      button.textContent = 'Play';
      currentAudio = null;
      currentButton = null;
    }
  });

  row.appendChild(name);
  row.appendChild(button);
  trackList?.appendChild(row);
});
