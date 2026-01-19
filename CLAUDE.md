# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

```
korczak-xyz/
├── korczak-xyz/          # Main Astro website
│   ├── src/
│   │   ├── components/   # React/Astro components
│   │   ├── hooks/        # React hooks
│   │   ├── pages/        # Astro pages
│   │   ├── utils/        # Utility functions
│   │   └── workers/      # Web workers
│   └── public/           # Static assets
└── resume/               # Resume subproject
```

## Common Commands

```bash
cd korczak-xyz
npm run dev      # Start dev server (usually port 4321)
npm run build    # Production build
npm run preview  # Preview production build
npx tsc --noEmit # Type check without emitting
```

## Solitaire Game

The solitaire game is at `/games/solitaire/`. Key files:

- `src/components/Solitaire/Solitaire.tsx` - Main game component
- `src/utils/solitaire/types.ts` - Type definitions (Card, GameState, Location)
- `src/utils/solitaire/rules.ts` - Game rules and validation
- `src/utils/solitaire/solver/` - AI solver for winnability analysis
- `src/hooks/useSolvabilityAnalysis.ts` - Async solver hook

### Solitaire Debug Console

A JavaScript debug interface is available at `window.solitaire` when the game is loaded. Use it to inspect state, execute moves, and debug game mechanics without using the UI.

```javascript
// State Inspection
solitaire.show()           // Print ASCII game board to console
solitaire.state()          // Get raw GameState object
solitaire.json()           // Get state as JSON string

// Undo/History
solitaire.undo()           // Undo last move
solitaire.history()        // Get history array

// Hints & Analysis
solitaire.hint()           // Get recommended move (from solver if available)
solitaire.moves()          // List all legal moves
solitaire.solvability()    // Get solvability analysis result

// Move Execution
solitaire.move(from, to)      // Execute validated move
solitaire.forceMove(from, to) // Skip validation (for edge case testing)

// Location formats:
//   'stock', 'waste'       - Stock/waste pile
//   'f0' to 'f3'           - Foundation piles
//   't0' to 't6'           - Tableau columns (top card)
//   't3:2'                 - Tableau column 3, card at index 2

// Examples:
solitaire.move('waste', 't3')    // Move waste top to tableau 3
solitaire.move('t2:4', 'f0')     // Move tableau 2 stack from card 4 to foundation

// Shortcuts
solitaire.draw()           // Draw from stock
solitaire.autoplay()       // Auto-play safe foundation moves
solitaire.find('Kh')       // Find King of hearts location
solitaire.find('10d')      // Find 10 of diamonds
solitaire.card('t3')       // Get card at tableau 3

// Serialization (copy/paste game states)
solitaire.copy()           // Copy game+history to clipboard
solitaire.paste()          // Load from clipboard
solitaire.encode()         // Get encoded string without clipboard
solitaire.decode(str)      // Load from encoded string

// Game Control
solitaire.newGame()        // Start fresh game
solitaire.win()            // Trigger win state (debug only)

// Help
solitaire.help()           // Show all available commands
```

Debug interface files:
- `src/hooks/useSolitaireDebug.ts` - Main debug hook
- `src/utils/solitaire/debugHelpers.ts` - Helper functions

## Localization (i18n)

The site supports English (default) and Polish. All user-facing strings should be localized.

### Adding translations

1. Add the key to both `en` and `pl` objects in `src/i18n/index.ts`
2. Use the `useTranslations` hook in components:

```astro
---
import { useTranslations } from '../i18n';
const t = useTranslations(lang);
---
<span>{t('myKey')}</span>
```

### Translation key conventions

- Use dot notation for namespaced keys: `statusBar.lastUpdated`, `song.chords`
- Group related translations with comments in the i18n file

## Workflow

When work is finished, commit and push the changes to the repository.
