// Contact Form Web Component
class ContactForm extends HTMLElement {
  connectedCallback() {
    // Wait for translations to load
    if (window.translations) {
      this.render();
    } else {
      document.addEventListener('translationsloaded', () => this.render());
      // Fallback render after short delay
      setTimeout(() => {
        if (!this.innerHTML) this.render();
      }, 500);
    }
  }

  t(key) {
    return window.translations?.[key] || key;
  }

  async handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('.submit-button');
    const formData = new FormData(form);

    // Disable button during submission
    submitBtn.disabled = true;
    submitBtn.textContent = '...';

    try {
      const response = await fetch('https://getform.io/f/da77d728-d0c5-4090-9a77-799464d888ff', {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        alert(this.t('Message sent successfully!') || 'Message sent successfully!');
        form.reset();
      } else {
        throw new Error('Form submission failed');
      }
    } catch (error) {
      console.error('Form submission error:', error);
      alert(this.t('Failed to send message. Please try again.') || 'Failed to send message. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = this.t('Submit');
    }
  }

  render() {
    this.innerHTML = `
      <form class="contact-form" accept-charset="UTF-8">
        <label class="form-field">
          <span class="form-label">${this.t('Name')}</span>
          <input type="text" name="name" required placeholder="${this.t('Enter name')}">
        </label>
        <label class="form-field">
          <span class="form-label">${this.t('Email')}</span>
          <input type="email" name="email" required placeholder="${this.t('Enter email')}">
        </label>
        <label class="form-field">
          <span class="form-label">${this.t('Message')}</span>
          <textarea name="message" required placeholder="${this.t('Enter message')}"></textarea>
        </label>
        <input type="hidden" name="_gotcha" style="display:none">
        <button type="submit" class="submit-button">${this.t('Submit')}</button>
      </form>
    `;

    this.querySelector('form').addEventListener('submit', (e) => this.handleSubmit(e));
  }
}

customElements.define('contact-form', ContactForm);
