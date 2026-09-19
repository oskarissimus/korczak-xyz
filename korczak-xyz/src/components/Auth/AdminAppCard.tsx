/*
 * The admissions panel's card in the list at /apps/, drawn only for an admin.
 *
 * The panel shipped reachable from one link on the login page, which is a page nobody opens once
 * they are signed in — so in practice it was reachable by typing its address. It is an app now,
 * and this is how an app is found here: a card in the list, like the other fourteen.
 *
 * **Why the card is conditional when the page is not.** `/apps/admin/` renders "this page is not
 * for this account" to anybody else and is refused everything by `firestore.rules` regardless, so
 * hiding the card protects nothing. What it avoids is a card that fifteen out of fifteen visitors
 * cannot use, on a list whose whole job is to be a list of things you can open. Same reasoning as
 * the login page's link to it.
 *
 * It is an ordinary `<li>` of the one list, although an island sits inside that list as an
 * `<astro-island>` element between the `<ul>` and its item: Astro gives that element
 * `display: contents`, so the `<li>` is the flex item and an island rendering nothing — which is
 * what this one does for everybody else — occupies nothing and takes no `gap`. The styles it uses
 * are global, in `styles/appsList.css`, because Astro's scoping attaches to elements in the
 * template and reaches nothing an island paints.
 */

import { useAuth } from '../../hooks/useAuth';

interface AdminAppCardProps {
  lang: 'en' | 'pl';
}

const translations = {
  en: { title: 'Accounts', desc: 'Who may use this site' },
  pl: { title: 'Konta', desc: 'Kto może korzystać z tej strony' },
};

export default function AdminAppCard({ lang }: AdminAppCardProps) {
  const { isAdmin } = useAuth();
  const t = translations[lang];

  if (!isAdmin) return null;

  return (
    <li>
      <a href={lang === 'en' ? '/apps/admin/' : '/pl/apps/admin/'} className="app-link">
        <span className="app-icon">{'\u{1F6C2}'}</span>
        <span className="app-info">
          <span className="app-title">{t.title}</span>
          <span className="app-desc">{t.desc}</span>
        </span>
      </a>
    </li>
  );
}
