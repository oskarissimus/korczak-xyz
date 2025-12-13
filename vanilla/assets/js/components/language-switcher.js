// Language Switcher Web Component
class LanguageSwitcher extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  render() {
    const currentLang = document.documentElement.lang || 'en';
    const currentPath = window.location.pathname;

    // Calculate paths for both languages
    let enPath, plPath;

    if (currentPath.startsWith('/pl/') || currentPath === '/pl') {
      // Currently on Polish page
      enPath = currentPath.replace(/^\/pl\/?/, '/') || '/';
      plPath = currentPath;
    } else {
      // Currently on English page
      enPath = currentPath;
      plPath = '/pl' + (currentPath === '/' ? '/' : currentPath);
    }

    // Ensure paths end correctly
    if (enPath !== '/' && !enPath.endsWith('/')) enPath += '/';
    if (plPath !== '/pl/' && !plPath.endsWith('/')) plPath += '/';

    this.innerHTML = `
      <div class="language-flags">
        <a href="${enPath}" class="flag ${currentLang === 'en' ? 'active' : ''}" title="English">
          <span>EN</span>
        </a>
        <a href="${plPath}" class="flag ${currentLang === 'pl' ? 'active' : ''}" title="Polski">
          <span>PL</span>
        </a>
      </div>
    `;
  }
}

customElements.define('language-switcher', LanguageSwitcher);
