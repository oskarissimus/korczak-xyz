// YouTube Embed Web Component
class YoutubeEmbed extends HTMLElement {
  static get observedAttributes() {
    return ['video-id'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const videoId = this.getAttribute('video-id');
    if (!videoId) return;

    this.innerHTML = `
      <div class="youtube-container">
        <iframe
          width="560"
          height="315"
          src="https://www.youtube.com/embed/${videoId}"
          title="YouTube video player"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        ></iframe>
      </div>
    `;
  }
}

customElements.define('youtube-embed', YoutubeEmbed);
