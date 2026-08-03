---
name: solitaire-debug
description: Use when debugging or inspecting the solitaire game at /games/solitaire/ - the window.solitaire console API for reading state, executing moves, getting hints, and serializing game states without going through the UI.
---

# Solitaire Debug Console

A JavaScript debug interface is available at `window.solitaire` when the game is loaded. Use it to
inspect state, execute moves, and debug game mechanics without using the UI.

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
