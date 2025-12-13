// Theme Switch Web Component
class ThemeSwitch extends HTMLElement {
  connectedCallback() {
    this.render();
    this.initTheme();
    this.attachEventListeners();
  }

  initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    this.setTheme(theme, false);
  }

  setTheme(theme, dispatch = true) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
    const input = this.querySelector('input');
    if (input) {
      input.checked = theme === 'dark';
    }
    if (dispatch) {
      document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
    }
  }

  render() {
    this.innerHTML = `
      <label class="theme-switch">
        <input type="checkbox" class="sr-only">
        <div class="switch-track"></div>
        <span class="sr-only">Dark mode</span>
      </label>
    `;
  }

  attachEventListeners() {
    const input = this.querySelector('input');
    if (input) {
      input.addEventListener('change', (e) => {
        this.setTheme(e.target.checked ? 'dark' : 'light');
      });
    }
  }
}

customElements.define('theme-switch', ThemeSwitch);
