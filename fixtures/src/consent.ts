/*
 * Cookie banners for Smart Landing. Each page records the person's choice in
 * `document.body.dataset.consent` so tests can see which button was pressed,
 * and the banner disappears once answered.
 */

const ARTICLE = `<main>
  <h1>Harbour town council approves new ferry route</h1>
  <p>The council voted on Tuesday to fund a second ferry between the old harbour and the island.</p>
  <ul>${Array.from({ length: 8 }, (_, index) => `<li><a href="/news/${index + 1}">Related story ${index + 1}</a></li>`).join('')}</ul>
</main>`;

const ANSWER = `<script>
  document.querySelectorAll('[data-choice]').forEach((button) => button.addEventListener('click', () => {
    document.body.dataset.consent = button.dataset.choice;
    document.getElementById('banner').remove();
    const note = document.createElement('p');
    note.textContent = 'Cookie choice: ' + button.dataset.choice;
    document.querySelector('main').append(note);
  }));
</script>`;

const STYLE = `<style>
  body { font-family: sans-serif; margin: 0; padding: 24px; }
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: grid; place-items: center; }
  .modal > div { background: white; padding: 24px; max-width: 420px; }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; background: #eee; padding: 16px; }
</style>`;

function page(title: string, banner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><title>${title}</title>${STYLE}</head><body>${ARTICLE}${banner}${ANSWER}</body></html>`;
}

export const CONSENT_PAGES: Record<string, string> = {
  /** A modal consent dialog over the whole page, with accept, reject and settings. */
  modal: page(
    'Consent modal',
    `<div id="banner" class="modal"><div role="dialog" aria-modal="true" aria-label="Your privacy choices">
      <h2>We value your privacy</h2>
      <p>We and our partners use cookies to measure audiences and show personalised ads. You can accept or reject optional cookies.</p>
      <button data-choice="settings">Manage options</button>
      <button data-choice="rejected">Reject all</button>
      <button data-choice="accepted">Accept all</button>
    </div></div>`,
  ),
  /** A fixed bottom bar with no dialog role; the reject option is phrased "Only necessary". */
  bar: page(
    'Consent bar',
    `<div id="banner" class="bar">
      <span>This site uses cookies for analytics and advertising.</span>
      <button data-choice="accepted">Accept cookies</button>
      <button data-choice="rejected">Only necessary</button>
    </div>`,
  ),
  /** A banner that offers no way to refuse. */
  acceptOnly: page(
    'Consent accept only',
    `<div id="banner" class="bar">
      <span>By using this site you agree to our use of cookies.</span>
      <a href="/privacy">Learn more</a>
      <button data-choice="accepted">OK</button>
    </div>`,
  ),
  /** A sign-in wall that mentions cookies: never a consent banner, because it holds a field. */
  signIn: page(
    'Sign in wall',
    `<div id="banner" class="modal"><div role="dialog" aria-modal="true" aria-label="Sign in to keep reading">
      <h2>Sign in to keep reading</h2>
      <p>By continuing you agree to our terms and the use of cookies.</p>
      <label for="email">Email</label> <input id="email" type="email">
      <button data-choice="signed-in">Agree and continue</button>
    </div></div>`,
  ),
};
