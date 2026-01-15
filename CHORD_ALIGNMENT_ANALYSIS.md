# Chord Alignment Analysis

Analysis performed on 2026-01-15 to verify chord alignment against online sources.

## Results Summary

| Song | Status | Issue |
|------|--------|-------|
| **jingle bells** | MISALIGNED | Chord format - chords on separate lines, not aligned with syllables |
| **papaja markauja** | CORRECT | - |
| **trzy akordy** | CORRECT | - |
| **do szopy hej** | MISALIGNED | Line 28: `D` should be `h` (Bm) |
| **hej koleda** | INCONCLUSIVE | Multiple key versions exist online |
| **przybiezeli** | ACCEPTABLE | Minor caveats, generally correct |
| **rzuc jakies drobne** | INCOMPLETE | Only first line has inline chords |
| **never going back** | MISALIGNED | Wrong tuning - should be Drop D capo 4, not C-G capo 6 |
| **nie placz ewka** | CORRECT | - |
| **gdy nie ma dzieci** | CORRECT | - |
| **dzieci** | MISALIGNED | Missing F and e chords in verse line 3s |
| **arahja** | CORRECT | - |
| **ale to juz bylo** | CORRECT | - |
| **barka** | CORRECT | - |
| **here comes the sun** | CORRECT | - |
| **mury** | MISALIGNED | Wrong chords (C should be Em), positioning issues |
| **hiszpanskie dziewczyny** | MISALIGNED | Wrong chords (G should be C, D should be Bm) |
| **lewe lewe loff** | CORRECT | - |
| **morskie opowiesci** | CORRECT | - |
| **za daleko** | INCONCLUSIVE | Reference sources limited |
| **wish you were here** | MISALIGNED | Am chord positions too far right |
| **plonie ognisko** | CORRECT | - |
| **nie zabieraj mi strun** | INCONCLUSIVE | Reference sources limited |
| **wehikul czasu** | CORRECT | - |
| **pilem w spale** | MISALIGNED | Agent claims a/E should be Bm/F# (needs verification) |
| **zapada zmrok** | MOSTLY CORRECT | Line 10 minor offset |
| **nazywali go marynarz** | CORRECT | - |
| **i love you** | CORRECT | - |

## Statistics

- **CORRECT**: 16 songs
- **MISALIGNED**: 9 songs (need fixes)
- **INCONCLUSIVE**: 3 songs (couldn't verify)

## Songs Requiring Fixes

### 1. jingle bells
Chord format issue - chords are on separate lines rather than aligned inline with syllables.

### 2. do szopy hej pasterze
Line 28: The chord `D` should be `h` (B minor in European notation).

### 3. rzuc jakies drobne na wino
Only the first line has inline chords. The rest of the song needs chord alignment added.

### 4. never going back again
Wrong tuning specification. File shows "6th string to C, 5th string to G with Capo 6th fret" but should be "Drop D (D-A-D-G-B-E) with Capo 4th fret".

### 5. dzieci
Missing F and e (Em) chords in the third line of each verse section (lines 18, 37, 47, 59).

### 6. mury
Several chord issues:
- Some positions have `C` where `Em` should be
- Positioning of chords is off in several places
- Line "A mury runa, runa, runa" is missing intermediate chord changes

### 7. hiszpanskie dziewczyny
Wrong chords in refrain:
- File shows `e G D` but should be `e C Bm`
- G should be C in several positions

### 8. wish you were here
Am chord positions are too far to the right. The `a` chords should align with the beginning of phrases, not in the middle.

### 9. pilem w spale
Agent suggests chords should be Bm/F# instead of a/E - needs manual verification against original recording.

## Methodology

Each song file was analyzed by an AI agent that:
1. Read the song file from the repository
2. Searched online for reference chord charts (using Polish guitar sites like spiewnik.wywrota.pl, chords.pl, kursgitary.pl, etc.)
3. Compared chord positions - checking if each chord is above the correct word/syllable (with 2-3 character tolerance)
4. Reported alignment status
