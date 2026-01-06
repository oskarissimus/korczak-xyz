import type { GameState } from '../types';
import type { SolverConfig, SolverResult, SolverMove } from './types';
import { DEFAULT_SOLVER_CONFIG } from './types';
import { hashState, TranspositionTable, WinnableStateCache } from './stateHash';
import { generateAllMoves, applyMove, checkWin, isDefinitelyStuck, isDefinitelyWinnable, autoPlaySafeMoves } from './moveGenerator';

interface SolverContext {
  startTime: number;
  statesExplored: number;
  config: SolverConfig;
  visited: TranspositionTable;
  winnableCache?: WinnableStateCache;
  pathStack: number[];
  pathDepth: number;
  shouldCancel?: () => boolean;
  onProgress?: (statesExplored: number, timeMs: number) => void;
  lastProgressTime: number;
  firstWinningMove?: SolverMove;
  moveStack: Array<SolverMove | undefined>; // Track moves at each depth
  originalState: GameState; // Original state before autoplay, for valid firstWinningMove
  historyHashes?: Set<number>; // Hashes of all history states to avoid cycles
}

/**
 * Check if a move would reverse the previous move (wasteful).
 */
function isReversibleMove(move: SolverMove, lastMove: SolverMove | undefined): boolean {
  if (!lastMove) return false;

  // Don't reverse tableau-to-tableau moves
  if (move.type === 'tableau-to-tableau' && lastMove.type === 'tableau-to-tableau') {
    if (move.from?.index === lastMove.to?.index &&
        move.to?.index === lastMove.from?.index) {
      return true;
    }
  }

  return false;
}

/**
 * Main solver function. Attempts to determine if the game is winnable.
 */
export function solve(
  state: GameState,
  config: Partial<SolverConfig> = {},
  shouldCancel?: () => boolean,
  onProgress?: (statesExplored: number, timeMs: number) => void,
  winnableCache?: WinnableStateCache,
  history?: GameState[]
): SolverResult {
  const fullConfig: SolverConfig = { ...DEFAULT_SOLVER_CONFIG, ...config };
  const startTime = performance.now();

  // Auto-play safe foundation moves first
  const initialState = autoPlaySafeMoves(state);
  const initialHash = hashState(initialState);

  // Build set of hashes from all history states to avoid suggesting cycles
  const historyHashes = new Set<number>();
  if (history) {
    for (const historyState of history) {
      historyHashes.add(hashState(autoPlaySafeMoves(historyState)));
    }
  }

  // Check if state is already known to be winnable
  // Still need to find the first winning move even if we know it's winnable
  if (winnableCache?.has(initialHash)) {
    // Find the first move from ORIGINAL state that leads to a known winnable state
    // We must use the original state so the move is valid for what the user sees
    const moves = generateAllMoves(state);
    for (const move of moves) {
      // Apply move to original state, then autoplay safe moves
      const newState = autoPlaySafeMoves(applyMove(state, move));
      const newHash = hashState(newState);
      // Skip moves that would return to any state in the history (avoid cycling hints)
      if (historyHashes.has(newHash)) {
        continue;
      }
      if (winnableCache.has(newHash) || checkWin(newState) || isDefinitelyWinnable(newState)) {
        return {
          winnable: true,
          timedOut: false,
          statesExplored: 0,
          timeMs: performance.now() - startTime,
          firstWinningMove: move,
        };
      }
    }
    // Fallback: we know it's winnable but couldn't find the move in cache
    // This shouldn't happen if cache is consistent, but return winnable anyway
    return {
      winnable: true,
      timedOut: false,
      statesExplored: 0,
      timeMs: performance.now() - startTime,
    };
  }

  // Quick win check
  if (checkWin(initialState)) {
    return {
      winnable: true,
      timedOut: false,
      statesExplored: 1,
      timeMs: performance.now() - startTime,
    };
  }

  // Quick stuck check
  if (isDefinitelyStuck(initialState)) {
    return {
      winnable: false,
      timedOut: false,
      statesExplored: 1,
      timeMs: performance.now() - startTime,
    };
  }

  // Quick winnable check (all cards accessible)
  if (isDefinitelyWinnable(initialState)) {
    return {
      winnable: true,
      timedOut: false,
      statesExplored: 1,
      timeMs: performance.now() - startTime,
    };
  }

  // Run DFS with memoization (fresh cache each call - can't reuse because
  // "visited" means "explored and didn't find win", not "definitely losing")
  const context: SolverContext = {
    startTime,
    statesExplored: 0,
    config: fullConfig,
    visited: new TranspositionTable(),
    winnableCache,
    pathStack: new Array(10000),
    pathDepth: 0,
    shouldCancel,
    onProgress,
    lastProgressTime: startTime,
    moveStack: new Array(10000),
    originalState: state, // Keep original for valid firstWinningMove
    historyHashes: historyHashes.size > 0 ? historyHashes : undefined, // Avoid cycles
  };

  // Start DFS with the initial state hash already on the path
  context.pathStack[0] = initialHash;
  context.pathDepth = 1;

  const result = dfs(initialState, context, undefined, true);

  return {
    winnable: result,
    timedOut: !result && shouldStop(context),
    statesExplored: context.statesExplored,
    timeMs: performance.now() - startTime,
    firstWinningMove: context.firstWinningMove,
  };
}

/**
 * Check if we've exceeded time or state limits, or been cancelled.
 */
function shouldStop(context: SolverContext): boolean {
  return (
    (context.shouldCancel?.() ?? false) ||
    performance.now() - context.startTime >= context.config.maxTimeMs ||
    context.statesExplored >= context.config.maxStatesExplored
  );
}

/**
 * Depth-first search with memoization.
 * Returns true if a winning path was found.
 *
 * @param isFirstLevel - true only for the first call, to generate moves from original state
 */
const PROGRESS_INTERVAL_MS = 1000; // Report progress every second

function dfs(
  state: GameState,
  context: SolverContext,
  lastMove: SolverMove | undefined,
  isFirstLevel: boolean = false
): boolean {
  // Check limits
  if (shouldStop(context)) {
    return false;
  }

  context.statesExplored++;

  // Report progress every second
  const now = performance.now();
  if (context.onProgress && now - context.lastProgressTime >= PROGRESS_INTERVAL_MS) {
    context.lastProgressTime = now;
    context.onProgress(context.statesExplored, now - context.startTime);
  }

  // Check if already visited
  const hash = hashState(state);
  if (context.visited.has(hash)) {
    return false;
  }
  context.visited.add(hash);

  // At first level, generate moves from ORIGINAL state so firstWinningMove is valid
  // for what the user sees. At deeper levels, use the current (auto-played) state.
  const stateForMoves = isFirstLevel ? context.originalState : state;
  const allMoves = generateAllMoves(stateForMoves);
  const moves = allMoves.filter(move => !isReversibleMove(move, lastMove));

  for (const move of moves) {
    // Apply move to the appropriate state
    const rawNewState = applyMove(stateForMoves, move);

    // Auto-play safe foundation moves after each move
    const newState = autoPlaySafeMoves(rawNewState);
    const newHash = hashState(newState);

    // At first level, skip moves that would return to any state in history (avoid cycling hints)
    if (isFirstLevel && context.historyHashes?.has(newHash)) {
      continue;
    }

    // Track this move at current depth
    context.moveStack[context.pathDepth - 1] = move;

    // Check if this state is already known to be winnable
    if (context.winnableCache?.has(newHash)) {
      // Mark all states on the current path as winnable
      context.winnableCache.addAll(context.pathStack.slice(0, context.pathDepth));
      // Capture the first move of the winning path
      context.firstWinningMove = context.moveStack[0];
      return true;
    }

    // Check for win
    if (checkWin(newState) || isDefinitelyWinnable(newState)) {
      // Mark all states on the current path as winnable
      context.pathStack[context.pathDepth] = newHash;
      context.winnableCache?.addAll(context.pathStack.slice(0, context.pathDepth + 1));
      // Capture the first move of the winning path
      context.firstWinningMove = context.moveStack[0];
      return true;
    }

    // Push new state onto path and recurse
    context.pathStack[context.pathDepth] = newHash;
    context.pathDepth++;

    // Subsequent levels always use false for isFirstLevel
    if (dfs(newState, context, move, false)) {
      context.pathDepth--;
      return true;
    }

    // Pop state from path
    context.pathDepth--;

    // Check limits after recursion
    if (shouldStop(context)) {
      return false;
    }
  }

  return false;
}
