---
name: i18n
description: Use when adding or changing user-facing strings on the site - how to add English/Polish translations to src/i18n/index.ts, use the useTranslations hook, and name translation keys.
---

# Localization (i18n)

The site supports English (default) and Polish. All user-facing strings should be localized.

## Adding translations

1. Add the key to both `en` and `pl` objects in `src/i18n/index.ts`
2. Use the `useTranslations` hook in components:

```astro
---
import { useTranslations } from '../i18n';
const t = useTranslations(lang);
---
<span>{t('myKey')}</span>
```

## Translation key conventions

- Use dot notation for namespaced keys: `statusBar.lastUpdated`, `song.chords`
- Group related translations with comments in the i18n file
