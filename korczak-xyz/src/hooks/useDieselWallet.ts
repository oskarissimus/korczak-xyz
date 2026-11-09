/*
 * The signed-in reader's diesel tank (`utils/rpg/wallet.ts`): asked of the gateway once on sign-in
 * (which grants a new account its first tank and says which server keys exist), then followed live
 * on `rpgLedger/{uid}` — the one document of the ledger the reader may read — so every request paid
 * from it lowers the gauge as it is settled.
 */

import { useEffect, useState } from 'react';

import { fetchWallet } from '../utils/rpg/gateway';
import { BALANCE_FIELD, WALLET_COLLECTION, type WalletStatus } from '../utils/rpg/wallet';

type User = { uid: string };

export function useDieselWallet(user: User | null): WalletStatus | null {
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const uid = user?.uid ?? null;
  useEffect(() => {
    setWallet(null);
    if (!uid) return;
    const controller = new AbortController();
    let unsubscribe: (() => void) | null = null;
    // Asked again a few times if it fails (a weak signal, the function cold): one miss would leave a
    // signed-in reader without their tank, on the hand-written quest, until a reload.
    const ask = async (): Promise<WalletStatus | null> => {
      for (let attempt = 0; attempt < 5 && !controller.signal.aborted; attempt++) {
        const status = await fetchWallet(controller.signal);
        if (status) return status;
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      }
      return null;
    };
    void ask().then(async (status) => {
      if (controller.signal.aborted || !status) return;
      setWallet(status);
      const [{ getDb }, { doc, onSnapshot }] = await Promise.all([import('../lib/firebase'), import('firebase/firestore')]);
      const db = getDb();
      if (!db || controller.signal.aborted) return;
      unsubscribe = onSnapshot(
        doc(db, WALLET_COLLECTION, uid),
        (snap) => {
          const v = snap.data()?.[BALANCE_FIELD];
          if (typeof v === 'number' && Number.isFinite(v)) setWallet((w) => (w ? { ...w, balanceUsd: Math.max(0, v) } : w));
        },
        () => {
          /* the rule not deployed yet: the gauge stays at what the gateway said */
        },
      );
    });
    return () => {
      controller.abort();
      unsubscribe?.();
    };
  }, [uid]);
  return wallet;
}
