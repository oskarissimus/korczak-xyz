import { describe, expect, it } from 'vitest';

import { DesignRefused, KEEP, description, designVoice, findDesigned, previewText, voiceName } from './voiceDesign';

/** ElevenLabs as far as the design needs it: the account's voices, a design, a save, a delete. */
function fakeAccount(voices: { voice_id: string; name: string; created_at_unix: number }[], opts: { refuse?: number; full?: boolean } = {}) {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  let full = opts.full ?? false;
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.includes('/v2/voices')) {
      const search = new URL(url).searchParams.get('search') ?? '';
      return ok({ voices: [...voices, { voice_id: 'mine0000', name: 'My narrator', created_at_unix: 0 }].filter((v) => v.name.includes(search)) });
    }
    if (url.endsWith('/v1/text-to-voice/design')) {
      if (opts.refuse) return new Response(JSON.stringify({ detail: { status: 'nope', message: 'no' } }), { status: opts.refuse });
      return ok({ previews: [{ generated_voice_id: 'gen1' }, { generated_voice_id: 'gen2' }], text: body.text });
    }
    if (url.endsWith('/v1/text-to-voice')) {
      if (full) {
        full = false;
        return new Response(JSON.stringify({ detail: { status: 'voice_limit_reached', message: 'full' } }), { status: 400 });
      }
      voices.push({ voice_id: 'new00000', name: body.voice_name, created_at_unix: 99 });
      return ok({ voice_id: 'new00000' });
    }
    if (method === 'DELETE') {
      const id = url.split('/').pop();
      voices.splice(voices.findIndex((v) => v.voice_id === id), 1);
      return ok({});
    }
    return new Response('{}', { status: 404 });
  };
  return { fetch, calls, voices };
}

const who = { name: 'Egil', gender: 'male' as const, voice: 'Male, early 20s. Persona: guilty runaway brother. Emotion: frantic, ashamed.', sample: 'Tarczowniku, stój!' };

describe('voiceDesign', () => {
  it('describes the voice language first and gives the design 100 to 400 characters of their words', () => {
    expect(description(who, 'pl')).toMatch(/^Native Polish\. Male, early 20s/);
    expect(description({ ...who, voice: 'Native English. Old woman.' }, 'pl')).toMatch(/^Native English\./);
    const t = previewText(who, 'pl');
    expect(t.startsWith('Tarczowniku, stój!')).toBe(true);
    expect(t.length).toBeGreaterThanOrEqual(100);
    expect(previewText({ ...who, sample: 'x'.repeat(900) }, 'pl')).toHaveLength(400);
  });

  it('asks for studio quality and drops what the model says about the medium', () => {
    const d = description({ ...who, voice: 'Native Polish. Male, 60s. Persona: smith. Gravelly, slow voice, like a crackling old radio. Slight echo.' }, 'pl');
    expect(d).toBe('Native Polish. Male, 60s. Persona: smith. Gravelly, slow voice. Studio-quality recording, perfect audio quality.');
    expect(description(who, 'pl')).toMatch(/Studio-quality recording, perfect audio quality\.$/);
    expect(description({ ...who, voice: 'x'.repeat(2000) }, 'pl').length).toBeLessThanOrEqual(1000);
  });

  it('designs, saves the first preview under the world and name, and finds it again by name', async () => {
    const account = fakeAccount([]);
    const id = await designVoice(account.fetch, 'sk', 'w1', who, 'pl');
    expect(id).toBe('new00000');
    const save = account.calls.find((c) => c.url.endsWith('/v1/text-to-voice'))!;
    expect(save.body).toMatchObject({ voice_name: voiceName('w1', 'Egil'), generated_voice_id: 'gen1' });
    expect(await findDesigned(account.fetch, 'sk', 'w1', 'Egil')).toBe('new00000');
    // The same name in another world is somebody else.
    expect(await findDesigned(account.fetch, 'sk', 'w2', 'Egil')).toBeNull();
  });

  it("deletes the game's oldest voices beyond the ones it keeps, and never the owner's own", async () => {
    const ours = Array.from({ length: KEEP + 2 }, (_, i) => ({ voice_id: `old${i}0000`, name: voiceName('w0', `N${i}`), created_at_unix: i }));
    const account = fakeAccount(ours);
    await designVoice(account.fetch, 'sk', 'w1', who, 'pl');
    const deleted = account.calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/').pop());
    expect(deleted).toEqual(['old00000', 'old10000', 'old20000']);
    expect(account.voices.filter((v) => v.name.startsWith('rpg · '))).toHaveLength(KEEP);
  });

  it('makes room once more when the save is refused for a full account', async () => {
    const account = fakeAccount([{ voice_id: 'old00000', name: voiceName('w0', 'A'), created_at_unix: 1 }], { full: true });
    expect(await designVoice(account.fetch, 'sk', 'w1', who, 'pl')).toBe('new00000');
    expect(account.calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/').pop())).toEqual(['old00000']);
  });

  it('says when the plan or the key will not design, so the game stops asking', async () => {
    await expect(designVoice(fakeAccount([], { refuse: 402 }).fetch, 'sk', 'w1', who, 'pl')).rejects.toBeInstanceOf(DesignRefused);
    await expect(designVoice(fakeAccount([], { refuse: 500 }).fetch, 'sk', 'w1', who, 'pl')).rejects.not.toBeInstanceOf(DesignRefused);
  });
});
