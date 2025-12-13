// Main application entry point

// Initialize theme from localStorage immediately (before components load)
// This prevents flash of wrong theme
(function() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = savedTheme || (prefersDark ? 'dark' : 'light');
  document.documentElement.classList.toggle('dark', theme === 'dark');
})();

// Load translations based on current language
const lang = document.documentElement.lang || 'en';
fetch(`/locales/${lang}.json`)
  .then(r => r.json())
  .then(data => {
    window.translations = data;
    document.dispatchEvent(new CustomEvent('translationsloaded'));
  })
  .catch(err => {
    console.warn('Failed to load translations:', err);
    window.translations = {};
    document.dispatchEvent(new CustomEvent('translationsloaded'));
  });

// Import all Web Components
import './components/theme-switch.js';
import './components/language-switcher.js';
import './components/site-navbar.js';
import './components/youtube-embed.js';
import './components/contact-form.js';
import './components/calendar-embed.js';

// Handle theme-aware images for courses
document.addEventListener('themechange', (e) => {
  document.querySelectorAll('img[data-light][data-dark]').forEach(img => {
    const src = e.detail.theme === 'dark' ? img.dataset.dark : img.dataset.light;
    img.src = src;
  });
});

// Initial setup for theme-aware images
document.addEventListener('DOMContentLoaded', () => {
  const isDark = document.documentElement.classList.contains('dark');
  document.querySelectorAll('img[data-light][data-dark]').forEach(img => {
    const src = isDark ? img.dataset.dark : img.dataset.light;
    img.src = src;
  });
});
