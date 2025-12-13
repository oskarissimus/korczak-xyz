// Site Navbar Web Component
class SiteNavbar extends HTMLElement {
  constructor() {
    super();
    this.isMenuOpen = false;
  }

  connectedCallback() {
    this.render();
    this.attachEventListeners();
  }

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
    const menu = this.querySelector('.nav-menu');
    if (menu) {
      menu.classList.toggle('open', this.isMenuOpen);
    }
  }

  render() {
    const lang = document.documentElement.lang || 'en';
    const t = window.translations || {};

    const navItems = [
      { href: lang === 'pl' ? '/pl/' : '/', text: t['Home'] || 'Home' },
      { href: lang === 'pl' ? '/pl/about/' : '/about/', text: t['About'] || 'About' },
      { href: lang === 'pl' ? '/pl/mentoring/' : '/mentoring/', text: t['Mentoring'] || 'Mentoring' },
      { href: lang === 'pl' ? '/pl/courses/' : '/courses/', text: t['Courses'] || 'Courses' },
      { href: lang === 'pl' ? '/pl/blog/' : '/blog/', text: t['Blog'] || 'Blog' },
      { href: lang === 'pl' ? '/pl/songs/' : '/songs/', text: t['Songs'] || 'Songs' },
    ];

    this.innerHTML = `
      <nav class="navbar">
        <div class="mobile-header">
          <a href="${lang === 'pl' ? '/pl/' : '/'}" class="logo">
            <img src="/assets/images/logo.png" alt="korczak.xyz" width="40" height="40">
          </a>
          <div class="spacer"></div>
          <theme-switch></theme-switch>
          <button class="menu-button" aria-label="Menu" aria-expanded="false">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        <div class="nav-menu">
          <a href="${lang === 'pl' ? '/pl/' : '/'}" class="logo">
            <img src="/assets/images/logo.png" alt="korczak.xyz" width="40" height="40">
          </a>
          <div class="spacer"></div>
          <ul class="nav-items">
            ${navItems.map(item => `<li><a href="${item.href}">${item.text}</a></li>`).join('')}
          </ul>
          <theme-switch class="md-block hidden"></theme-switch>
          <language-switcher></language-switcher>
        </div>
      </nav>
    `;
  }

  attachEventListeners() {
    const menuButton = this.querySelector('.menu-button');
    if (menuButton) {
      menuButton.addEventListener('click', () => {
        this.toggleMenu();
        menuButton.setAttribute('aria-expanded', this.isMenuOpen);
      });
    }
  }
}

customElements.define('site-navbar', SiteNavbar);
