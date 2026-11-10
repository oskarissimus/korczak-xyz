# everyrpg.korczak.xyz

The game's production site, and nothing else. A second Astro source tree over the same
components: `astro.config.rpg.mjs` points `srcDir` here and `publicDir` at `public-rpg/`, so
the build sees these pages and none of the site's. Built and deployed only by
`.github/workflows/rpg-release.yml` (`npm run build:rpg`), never by a push to main.

What exists here, in both locales:

| Path | What |
|---|---|
| `/` | the game, the whole screen, no site around it |
| `/login/` | sign in and sign up (`LoginForm`, `variant="game"`) |
| `/account/` | the four keys the game spends (`Account`, `variant="game"`) |
| `/admin/` | the admin panel: the server's keys and the demo's dials (`AdminPanel`, admins only) |

`Layout.astro` is not used: no navbar, footer, taskbar, desktop or window frame, no client
router and no service worker. `layouts/Game.astro` keeps only what the game needs from it — the
safe-area insets an installed iPhone app depends on, the island recovery script and Sentry
(environment `rpg`).

The components are shared with korczak.xyz on purpose: the game is developed there, on main,
and a release only changes the frame around it. Anything the game links to has to exist here
too, which is why `scripts/rpg-release.mjs` fails the build if dist/ has a page this table does
not list, or lacks one it does.
