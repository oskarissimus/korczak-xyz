// Calendar Embed Web Component (Cal.com)
class CalendarEmbed extends HTMLElement {
  connectedCallback() {
    this.loadCalScript();
    document.addEventListener('themechange', (e) => this.updateTheme(e.detail.theme));
  }

  loadCalScript() {
    // Check if Cal is already loaded
    if (window.Cal) {
      this.initCal();
      return;
    }

    // Load Cal.com embed script
    (function (C, A, L) {
      let p = function (a, ar) { a.q.push(ar); };
      let d = C.document;
      C.Cal = C.Cal || function () {
        let cal = C.Cal;
        let ar = arguments;
        if (!cal.loaded) {
          cal.ns = {};
          cal.q = cal.q || [];
          d.head.appendChild(d.createElement("script")).src = A;
          cal.loaded = true;
        }
        if (ar[0] === L) {
          const api = function () { p(api, arguments); };
          const namespace = ar[1];
          api.q = api.q || [];
          typeof namespace === "string" ? (cal.ns[namespace] = api) && p(api, ar) : p(cal, ar);
          return;
        }
        p(cal, ar);
      };
    })(window, "https://app.cal.com/embed/embed.js", "init");

    // Wait for script to load then init
    const checkCal = setInterval(() => {
      if (window.Cal && window.Cal.loaded) {
        clearInterval(checkCal);
        this.initCal();
      }
    }, 100);

    // Timeout after 5 seconds
    setTimeout(() => clearInterval(checkCal), 5000);
  }

  initCal() {
    const calLink = this.getAttribute('cal-link') || 'oskarissimus/mentoring';
    const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';

    Cal("init", { origin: "https://cal.com" });
    Cal("ui", {
      theme: theme,
      styles: { branding: { brandColor: "#048ba8" } },
      hideEventTypeDetails: false,
    });

    this.innerHTML = `
      <div class="calendar-container">
        <div
          data-cal-link="${calLink}"
          data-cal-config='{"theme":"${theme}"}'
          style="width:100%;height:100%;min-height:600px;overflow:scroll"
        ></div>
      </div>
    `;

    // Re-init Cal on the new element
    if (window.Cal) {
      Cal("ui", { theme: theme });
    }
  }

  updateTheme(theme) {
    if (window.Cal) {
      Cal("ui", { theme: theme });
    }
  }
}

customElements.define('calendar-embed', CalendarEmbed);
