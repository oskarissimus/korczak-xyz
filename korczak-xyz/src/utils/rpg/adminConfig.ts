/*
 * The game's admin panel, the half both runtimes share (`functions/src/rpg/admin.ts` answers it,
 * `components/Rpg/AdminPanel.tsx` draws it).
 *
 * Owner, 9 Nov 2026: "an admin panel in the game, so I can set the keys for now — later other
 * things will come in handy too". So it is one endpoint on the gateway, `ADMIN_PATH`, that answers
 * with every section at once and takes a patch naming only the sections it changes. A new section
 * is a field on `AdminStatus`, a field on `AdminPatch` and its own parser here, nothing more.
 *
 * THE SERVER'S KEYS NEVER COME BACK TO THE BROWSER. They are written through the gateway into
 * `rpgServerKeys/config`, a top-level document with no Firestore rule (only the Admin SDK reaches
 * it, like `demoUsage` and `rpgLedger`), and what the panel gets back is the last four characters
 * of each, as the account page gets of the account's own keys.
 *
 * Pure, so a test pins it without a browser or a server.
 */

import { keyHint, type KeyName } from '../accountKeys/keys';
import { MAX_DAILY_USD, MAX_PER_IP_USD } from './demoLimits';

export const ADMIN_PATH = '/admin/config';

/** Where the server's keys are kept: no rule, Admin SDK only. */
export const SERVER_KEYS_DOC = ['rpgServerKeys', 'config'] as const;

/** The keys the panel sets, in the order it shows them. */
export const SERVER_KEY_NAMES = ['google', 'elevenLabs', 'fal', 'openai'] as const satisfies readonly KeyName[];
export type ServerKeyName = (typeof SERVER_KEY_NAMES)[number];

/** A key longer than this is not a key somebody pasted, it is a paragraph. */
export const MAX_KEY_LENGTH = 512;

export interface AdminDemo {
  /** The RPG's own switch, `apps.rpg` in `demo/config`. */
  on: boolean;
  /** The master switch shared with the roaster's demo; shown, not set here. */
  enabled: boolean;
  perIpUsd: number;
  dailyUsd: number;
  /** Who the demo's Google key comes from right now. */
  payer: 'server' | 'account' | 'nobody';
}

export interface AdminStatus {
  /** Per key, its last four characters, or null where the server has none. */
  keys: Record<ServerKeyName, string | null>;
  keysUpdatedAt: number;
  demo: AdminDemo;
  limits: { maxPerIpUsd: number; maxDailyUsd: number };
}

export interface AdminPatch {
  /** A string sets a key, null clears it, a missing name leaves it as it is. */
  keys?: Partial<Record<ServerKeyName, string | null>>;
  demo?: Partial<Pick<AdminDemo, 'on' | 'perIpUsd' | 'dailyUsd'>>;
}

export class BadPatch extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The server's keys out of their document: `{ apiKeys: { google, … } }`, the account store's shape. */
export function serverKeysFrom(data: unknown): Record<ServerKeyName, string | null> {
  const apiKeys = record(record(data)?.apiKeys) ?? {};
  return Object.fromEntries(
    SERVER_KEY_NAMES.map((n) => {
      const v = apiKeys[n];
      return [n, typeof v === 'string' && v.trim() ? v.trim() : null];
    }),
  ) as Record<ServerKeyName, string | null>;
}

export function keyHints(keys: Record<ServerKeyName, string | null>): Record<ServerKeyName, string | null> {
  return Object.fromEntries(SERVER_KEY_NAMES.map((n) => [n, keyHint(keys[n])])) as Record<ServerKeyName, string | null>;
}

function dollars(value: unknown, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new BadPatch(`${name} must be a number from 0 to ${max}`);
  }
  return Math.round(value * 100) / 100;
}

/**
 * A patch as the panel sent it, checked field by field. Anything it does not name is refused rather
 * than ignored, so a typo in a key's name is an error on screen and not a key that silently went
 * nowhere.
 */
export function parseAdminPatch(raw: unknown): AdminPatch {
  const body = record(raw);
  if (!body) throw new BadPatch('expected a JSON object');
  const out: AdminPatch = {};
  for (const section of Object.keys(body)) {
    if (section !== 'keys' && section !== 'demo') throw new BadPatch(`unknown section ${section}`);
  }
  if (body.keys !== undefined) {
    const keys = record(body.keys);
    if (!keys) throw new BadPatch('keys must be an object');
    out.keys = {};
    for (const [name, value] of Object.entries(keys)) {
      if (!(SERVER_KEY_NAMES as readonly string[]).includes(name)) throw new BadPatch(`unknown key ${name}`);
      if (value === null) {
        out.keys[name as ServerKeyName] = null;
        continue;
      }
      if (typeof value !== 'string') throw new BadPatch(`${name} must be a string or null`);
      const key = value.trim();
      if (!key) throw new BadPatch(`${name} is empty — send null to clear it`);
      if (key.length > MAX_KEY_LENGTH || /\s/.test(key)) throw new BadPatch(`${name} does not look like a key`);
      out.keys[name as ServerKeyName] = key;
    }
  }
  if (body.demo !== undefined) {
    const demo = record(body.demo);
    if (!demo) throw new BadPatch('demo must be an object');
    out.demo = {};
    for (const [name, value] of Object.entries(demo)) {
      if (name === 'on') {
        if (typeof value !== 'boolean') throw new BadPatch('demo.on must be true or false');
        out.demo.on = value;
      } else if (name === 'perIpUsd') out.demo.perIpUsd = dollars(value, MAX_PER_IP_USD, 'demo.perIpUsd');
      else if (name === 'dailyUsd') out.demo.dailyUsd = dollars(value, MAX_DAILY_USD, 'demo.dailyUsd');
      else throw new BadPatch(`unknown demo field ${name}`);
    }
  }
  return out;
}

/** What a demo patch writes into `demo/config`: only the RPG's own fields, merged. */
export function demoWrite(demo: NonNullable<AdminPatch['demo']>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (demo.on !== undefined) out.apps = { rpg: demo.on };
  if (demo.perIpUsd !== undefined) out.rpgPerIpUsd = demo.perIpUsd;
  if (demo.dailyUsd !== undefined) out.rpgDailyUsd = demo.dailyUsd;
  return out;
}

/** The demo's keys: the server's own first, then the paying account's, one key at a time. */
export function demoKeysOf(
  server: Record<ServerKeyName, string | null>,
  account: { google: string | null; elevenLabs: string | null },
): { google: string | null; elevenLabs: string | null; payer: AdminDemo['payer'] } {
  const google = server.google ?? account.google;
  return {
    google,
    elevenLabs: server.elevenLabs ?? account.elevenLabs,
    payer: server.google ? 'server' : account.google ? 'account' : 'nobody',
  };
}
