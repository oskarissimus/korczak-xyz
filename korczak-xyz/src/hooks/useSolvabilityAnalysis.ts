import { useState, useEffect, useRef } from 'react';
import type { GameState } from '../utils/solitaire/types';
import type { SolvabilityStatus, SolverResult, SolverMove } from '../utils/solitaire/solver';

export interface SolvabilityResult {
  status: SolvabilityStatus;
  statesExplored?: number;
  timeMs?: number;
  firstWinningMove?: SolverMove;
}

interface WorkerResultMessage {
  type: 'result';
  requestId: string;
  result: SolverResult;
}

interface WorkerProgressMessage {
  type: 'progress';
  requestId: string;
  statesExplored: number;
  timeMs: number;
}

type WorkerMessage = WorkerResultMessage | WorkerProgressMessage;

export function useSolvabilityAnalysis(
  gameState: GameState,
  enabled: boolean = true
): SolvabilityResult {
  const [result, setResult] = useState<SolvabilityResult>({ status: 'idle' });
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef<string>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Initialize worker
  useEffect(() => {
    if (!enabled) return;

    try {
      workerRef.current = new Worker(
        new URL('../workers/solitaireSolver.worker.ts', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;

        // Only process messages for current request
        if (message.requestId !== requestIdRef.current) return;

        if (message.type === 'progress') {
          // Update progress while still analyzing
          setResult({
            status: 'analyzing',
            statesExplored: message.statesExplored,
            timeMs: message.timeMs,
          });
        } else if (message.type === 'result') {
          const solverResult = message.result;
          let status: SolvabilityStatus;
          if (solverResult.winnable) {
            status = 'winnable';
          } else if (solverResult.timedOut) {
            status = 'unknown';
          } else {
            status = 'not-winnable';
          }

          setResult({
            status,
            statesExplored: solverResult.statesExplored,
            timeMs: solverResult.timeMs,
          });
        }
      };

      workerRef.current.onerror = (error) => {
        console.error('Solitaire solver worker error:', error);
        setResult({ status: 'unknown' });
      };
    } catch (error) {
      console.error('Failed to create solver worker:', error);
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [enabled]);

  // Trigger analysis when game state changes
  useEffect(() => {
    if (!enabled || !workerRef.current) return;

    // If game is already won, no need to analyze
    if (gameState.gameWon) {
      setResult({ status: 'winnable' });
      return;
    }

    // Debounce rapid state changes
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Cancel any in-progress analysis
      workerRef.current?.postMessage({ type: 'cancel' });

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      requestIdRef.current = requestId;

      setResult({ status: 'analyzing' });

      workerRef.current?.postMessage({
        type: 'solve',
        gameState,
        requestId,
      });
    }, 150); // 150ms debounce to avoid rapid re-analysis

    return () => clearTimeout(debounceRef.current);
  }, [gameState, enabled]);

  return result;
}
