import { solve } from '../utils/solitaire/solver';
import type { SolverConfig, SolverResult } from '../utils/solitaire/solver';
import type { GameState } from '../utils/solitaire/types';
import { serializeState } from '../utils/solitaire/solver/stateHash';

interface SolveMessage {
  type: 'solve';
  requestId: string;
  gameState: GameState;
  config?: Partial<SolverConfig>;
}

interface CancelMessage {
  type: 'cancel';
}

interface ResultMessage {
  type: 'result';
  requestId: string;
  result: SolverResult;
}

interface ProgressMessage {
  type: 'progress';
  requestId: string;
  statesExplored: number;
  timeMs: number;
}

type WorkerMessage = SolveMessage | CancelMessage;
type WorkerResponse = ResultMessage | ProgressMessage;

// Cancellation flag checked by the solver
let cancelFlag = false;
let currentRequestId = '';

// Result cache: serialized state -> solver result
// Prevents re-solving when cycling through stock (same logical state)
const resultCache = new Map<string, SolverResult>();
const MAX_CACHE_SIZE = 1000;

export function shouldCancel(): boolean {
  return cancelFlag;
}

export function reportProgress(statesExplored: number, timeMs: number): void {
  if (currentRequestId) {
    const progressMsg: ProgressMessage = {
      type: 'progress',
      requestId: currentRequestId,
      statesExplored,
      timeMs,
    };
    self.postMessage(progressMsg);
  }
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    cancelFlag = true;
    return;
  }

  if (message.type === 'solve') {
    const { requestId, gameState, config } = message;

    // Check cache first - stock/waste cycling produces same serialized state
    const stateKey = serializeState(gameState);
    const cachedResult = resultCache.get(stateKey);
    if (cachedResult) {
      const response: ResultMessage = {
        type: 'result',
        requestId,
        result: cachedResult,
      };
      self.postMessage(response);
      return;
    }

    // Reset cancellation flag for new solve
    cancelFlag = false;
    currentRequestId = requestId;

    try {
      const result = solve(gameState, config, shouldCancel, reportProgress);

      // Cache result if solve completed (not cancelled)
      if (!cancelFlag) {
        if (resultCache.size >= MAX_CACHE_SIZE) {
          const firstKey = resultCache.keys().next().value;
          if (firstKey !== undefined) {
            resultCache.delete(firstKey);
          }
        }
        resultCache.set(stateKey, result);
      }

      const response: ResultMessage = {
        type: 'result',
        requestId,
        result,
      };

      self.postMessage(response);
    } catch (error) {
      // If solver crashes, report as timed out
      const response: ResultMessage = {
        type: 'result',
        requestId,
        result: {
          winnable: false,
          timedOut: true,
          statesExplored: 0,
          timeMs: 0,
        },
      };
      self.postMessage(response);
    }
  }
};
