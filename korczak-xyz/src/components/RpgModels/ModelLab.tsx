/*
 * The model lab at /apps/rpg-models/ (owner, 29 Oct 2026: "a viewer for those models, because after
 * some in-game generations I would like to inspect them individually — rotate, zoom, move and switch
 * between animations — to assess what is the best bang for buck; maybe a button to generate a model
 * from the same image/prompt with various methods and view and assess the animated results").
 *
 * The left column is everyone the game has made (`labSources`) and anyone described here; the right
 * is one of them: its pictures, the models made from them (the game's own and the lab's, each with
 * its method, price, time and weight), and the stage, where the ticked models stand in a row on the
 * same clip under one orbiting camera, rigged by our own rig or Meshy's. Making costs real money on
 * the reader's fal key, so every button says its price, and `~` opens the requests with the total.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useAccountKeys } from '../../hooks/useAccountKeys';
import { useAuth } from '../../hooks/useAuth';
import { describeError, log } from '../../lib/logger';
import { formatMs, formatUsd } from '../../utils/rpg/cost';
import { devlogVersion, devRequests, subscribeDevlog } from '../../utils/rpg/devlog';
import { buildPersonMesh, drawImage, FAL_RIG_MODEL, TEXT_PERSON_PRICE, textToRiggedPerson, IMAGE_SIZE, PERSON_MESHERS, PERSON_PAINTERS, DEFAULT_PAINTER, setGoogleImageKey, personPrompt, tPose, widePose, type PersonMesher, type PersonPainter } from '../../utils/rpg/landmark3d';
import { labSources, type LabSource, type LabWorld } from '../../utils/rpg/labSources';
import { addLabVariant, addOwnSource, labPicture, labPictures, labSpent, labVariants, ownSources, removeLabVariant, setLabPicture, type LabPose, type LabVariant } from '../../utils/rpg/labStore';
import type { Lang } from '../../utils/rpg/quest';
import { PERSON_HEIGHT } from '../Rpg/people';
import { LabStage, REST, type ModelStats, type StageItem, type StageRig } from './labScene';
import { accountWorlds, localWorlds, mergeWorlds } from './loadWorlds';
import { strings } from './strings';

const METHODS = Object.keys(PERSON_MESHERS) as PersonMesher[];
const PAINTERS = Object.keys(PERSON_PAINTERS) as PersonPainter[];
/** As many side by side as still read on a laptop. */
const MAX_SHOWN = 5;

/** A model in the list: the one the game made, or one made here. */
interface Row {
  key: string;
  glb: string;
  label: string;
  costUsd: number;
  ms: number;
  bytes: number | null;
  fromGame: boolean;
  variant?: LabVariant;
}

const heightOf = (s: LabSource) => PERSON_HEIGHT[s.role === 'hero' ? 'hero' : s.role === 'enemy' ? 'enemy' : s.body];

/** The prompt a redrawn picture is asked with: the game's own, moved into the chosen pose. */
function posed(pose: LabPose, prompt: string): string {
  return pose === 'tpose' ? tPose(prompt) : pose === 'tposeDown' ? tPose(prompt, 'down') : pose === 'wide' ? widePose(prompt) : prompt;
}

/** A picture redrawn before, only while it was asked with the prompt the pose sends now: a changed pose is drawn again. */
function keptPicture(source: LabSource, pose: LabPose, painter: PersonPainter): { image: string; prompt: string } | null {
  const kept = labPicture(source.id, pose, painter);
  return kept && kept.prompt === posed(pose, source.model.prompt) ? kept : null;
}

/** A person described in the lab is drawn in the strict T-pose from the start: the lab is for rigging. */
function ownPrompt(describe: string, gender: 'male' | 'female'): string {
  return tPose(personPrompt(describe.trim(), { gender }));
}

export default function ModelLab({ lang }: { lang: Lang }) {
  const t = strings[lang];
  const auth = useAuth();
  const account = useAccountKeys(auth.user);
  // Handles, not keys, for a signed-in reader (`useAccountKeys`): every request goes through the server (`utils/rpg/gateway.ts`).
  const apiKeys = account.keys;
  const falKey = account.ready ? apiKeys.fal || null : null;
  setGoogleImageKey(account.ready ? apiKeys.google : null);

  const [worlds, setWorlds] = useState<LabWorld[] | null>(null);
  const [own, setOwn] = useState<LabSource[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  /** Bumped when a Meshy rig may have been paid for, so the count of those still unpaid is read again. */
  const [rigTick, setRigTick] = useState(0);
  const [shown, setShown] = useState<string[]>([]);
  const [rigger, setRigger] = useState<StageRig>('voxel');
  const [uncached, setUncached] = useState(0);
  const [clip, setClip] = useState('Idle_Loop');
  const [clips, setClips] = useState<string[]>([]);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [skeleton, setSkeleton] = useState(false);
  const [wire, setWire] = useState(false);
  const [xray, setXray] = useState(false);
  const [weights, setWeights] = useState(false);
  const [method, setMethod] = useState<PersonMesher>('trellis');
  const [pose, setPose] = useState<LabPose>('tpose');
  // The game's painter by default here too, Nano Banana Lite (owner, 30 Oct 2026); it was Nano Banana, whose palms are always down.
  const [painter, setPainter] = useState<PersonPainter>(DEFAULT_PAINTER);
  const [pending, setPending] = useState<{ id: string; label: string; since: number }[]>([]);
  const [stats, setStats] = useState<Record<string, { stats: ModelStats; ms: number } | { error: string }>>({});
  const [describe, setDescribe] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [drawing, setDrawing] = useState(false);
  /** Why the last picture or model did not come, shown where it was asked for. */
  const [problem, setProblem] = useState<{ where: 'draw' | 'make'; text: string } | null>(null);
  const explain = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    return /content_policy_violation|flagged by a content checker/.test(message) ? t.refused : `${t.failed}: ${message.slice(0, 160)}`;
  };
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [, tick] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<LabStage | null>(null);
  useSyncExternalStore(subscribeDevlog, devlogVersion, devlogVersion);

  // The worlds: this browser's at once, the account's over them once it answers.
  useEffect(() => {
    const local = localWorlds();
    setWorlds(local);
    setOwn(ownSources());
    if (auth.loading || !auth.user) return;
    let live = true;
    accountWorlds(auth.user.uid).then(
      (account) => live && setWorlds(mergeWorlds(local, account)),
      (e) => log.warn('rpgModels.read.failed', describeError(e)),
    );
    return () => {
      live = false;
    };
  }, [auth.loading, auth.user]);

  const sources = useMemo(() => [...own, ...labSources(worlds ?? [])], [own, worlds]);
  const source = sources.find((s) => s.id === selected) ?? sources[0] ?? null;

  const rows: Row[] = useMemo(() => {
    if (!source) return [];
    void version;
    const out: Row[] = [];
    if (source.model.glb)
      out.push({ key: source.model.glb, glb: source.model.glb, label: t.fromGame, costUsd: source.model.costUsd, ms: source.model.ms, bytes: null, fromGame: true });
    for (const v of labVariants(source.id))
      out.push({
        key: v.id,
        glb: v.glb,
        label: `${t.methods[v.method].split(' · ')[0]}${v.pose === 'game' ? '' : ` · ${t.poses[v.pose]}${v.painter ? `, ${t.painters[v.painter].split(' · ')[0]}` : ''}`}`,
        costUsd: v.costUsd,
        ms: v.ms,
        bytes: v.bytes,
        fromGame: false,
        variant: v,
      });
    return out;
  }, [source, version, t]);

  // A new person picked: everything they have, on the stage.
  useEffect(() => {
    setShown(rows.slice(-MAX_SHOWN).map((r) => r.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);

  // The stage itself, once, and again on a fresh canvas if the browser takes its GPU context back.
  const [stageGen, setStageGen] = useState(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new LabStage(canvas, () => {
      log.warn('rpgModels.context.lost', {});
      setStageGen((n) => n + 1);
    });
    stageRef.current = stage;
    const fit = () => stage.resize(canvas.clientWidth, canvas.clientHeight);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      stage.dispose();
      stageRef.current = null;
    };
  }, [stageGen]);

  const wanted: StageItem[] = source
    ? rows.filter((r) => shown.includes(r.key)).map((r) => ({ key: r.key, glb: r.glb, body: source.body, height: heightOf(source), label: 'lab' }))
    : [];
  // One array for as long as the same models are wanted: the stage is set up again only when they change.
  const signature = wanted.map((i) => `${i.key}|${i.glb}|${i.body}|${i.height}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => wanted, [signature]);

  // How many of the shown would cost a Meshy rig: those not rigged by it before, in this browser or anywhere on the account (`meshyCached`).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let live = true;
    Promise.all(items.map((i) => stage.people.meshyCached(i.glb, i.height))).then((cached) => live && setUncached(cached.filter((c) => !c).length));
    return () => {
      live = false;
    };
  }, [items, rigTick]);

  /** The Meshy rig asked for by the button: running since when, or how it ended, in words. */
  const [rigging, setRigging] = useState<{ since: number; n: number } | { ok: number; failed: number; ms: number; why: string | null } | null>(null);
  useEffect(() => {
    if (!rigging || !('since' in rigging)) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [rigging]);
  // An ended rig's word goes when other models are shown.
  useEffect(() => setRigging((r) => (r && 'ok' in r ? null : r)), [items]);
  /** Rigs the shown with Meshy, then counts which came back rigged by it: a failed one falls back to our rig. */
  const rigWithMeshyNow = async () => {
    const stage = stageRef.current;
    if (!stage || (rigging && 'since' in rigging)) return;
    const since = Date.now();
    const wanted = (await Promise.all(items.map(async (i) => ((await stage.people.meshyCached(i.glb, i.height)) ? null : i)))).filter((i) => i !== null);
    setRigging({ since, n: wanted.length });
    const errors = await showOnStage('meshy');
    const rigged = await Promise.all(wanted.map((i) => stage.people.meshyCached(i.glb, i.height)));
    const failed = rigged.filter((r) => !r).length;
    // Meshy's own refusal, else why the model would not stand at all (a picture of more than one person is not sent).
    const why = devRequests().filter((r) => r.startedAt >= since && r.model === FAL_RIG_MODEL && r.error).at(-1)?.error ?? errors.at(-1) ?? null;
    setRigging({ ok: rigged.length - failed, failed, ms: Date.now() - since, why });
  };

  const showOnStage = useCallback(
    (riggedBy: StageRig) => {
      const stage = stageRef.current;
      const errors: string[] = [];
      if (!stage) return Promise.resolve(errors);
      return stage
        .show(items, riggedBy, riggedBy === 'meshy' ? falKey : null, (key, result) => {
          if ('error' in result) errors.push(result.error);
          setStats((s) => ({ ...s, [`${key}|${riggedBy}`]: result }));
        })
        .then(() => {
          setClips(stage.clipNames());
          stage.play(clip);
          if (riggedBy === 'meshy') setRigTick((n) => n + 1);
          return errors;
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, falKey, stageGen],
  );

  // Our own rig costs nothing, so it follows the ticks at once; Meshy's waits for a click while any would be paid for.
  useEffect(() => {
    if (rigger !== 'meshy' || uncached === 0) showOnStage(rigger);
  }, [showOnStage, rigger, uncached]);

  useEffect(() => stageRef.current?.play(clip), [clip]);
  useEffect(() => {
    if (stageRef.current) stageRef.current.speed = speed;
  }, [speed]);
  useEffect(() => {
    if (stageRef.current) stageRef.current.playing = playing;
  }, [playing]);
  useEffect(() => stageRef.current?.setSkeletons(skeleton), [skeleton, stageGen]);
  useEffect(() => stageRef.current?.setWireframe(wire), [wire, stageGen]);
  useEffect(() => stageRef.current?.setXray(xray), [xray, stageGen]);
  useEffect(() => stageRef.current?.setWeights(weights), [weights, stageGen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (e.code !== 'Backquote' && e.key !== '~' && e.key !== '`') return;
      e.preventDefault();
      setConsoleOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The clock on what is being made.
  useEffect(() => {
    if (pending.length === 0) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [pending.length]);

  const make = async () => {
    if (!source || !falKey) return;
    const id = `${method}-${pose}-${Date.now()}`;
    const label = `${t.methods[method].split(' · ')[0]}${pose === 'game' ? '' : ` · ${t.poses[pose]}, ${t.painters[painter].split(' · ')[0]}`}`;
    setPending((p) => [...p, { id, label, since: Date.now() }]);
    setProblem(null);
    const started = Date.now();
    let spent = 0;
    try {
      let picture = pose === 'game' ? { image: source.model.image, prompt: source.model.prompt } : keptPicture(source, pose, painter);
      if (!picture) {
        const prompt = posed(pose, source.model.prompt);
        picture = { image: await drawImage(falKey, prompt, 'person', {}, IMAGE_SIZE, undefined, painter), prompt };
        spent += PERSON_PAINTERS[painter].price(IMAGE_SIZE);
        setLabPicture(source.id, pose, painter, picture);
      }
      const at = { pose: picture.prompt.includes('strict T-pose') ? ('tpose' as const) : ('apose' as const), height: heightOf(source) };
      const made = await buildPersonMesh(falKey, picture.image, method, 'lab', {}, undefined, at);
      // In one go: Meshy's rig came with the model, so the Meshy rig shows it for nothing.
      if (made.rigged) {
        await stageRef.current?.people.keepMeshyRig(made.glb, at.height, made.rigged);
        setRigger('meshy');
      }
      spent += made.costUsd;
      addLabVariant(source.id, { id, method, pose, painter: pose === 'game' ? undefined : painter, image: picture.image, prompt: picture.prompt, glb: made.glb, costUsd: spent, ms: Date.now() - started, bytes: made.bytes, at: Date.now() });
      setShown((s) => [...s.slice(-(MAX_SHOWN - 1)), id]);
      setVersion((v) => v + 1);
    } catch (e) {
      log.warn('rpgModels.make.failed', { method, ...describeError(e) });
      setProblem({ where: 'make', text: explain(e) });
    } finally {
      setPending((p) => p.filter((x) => x.id !== id));
    }
  };

  /** A described person made by Meshy's text-to-3D in one go: the model is the person's own, rigged already. */
  const makeFromText = async () => {
    if (!falKey || !describe.trim()) return;
    const id = `text-${Date.now()}`;
    const words = describe.trim();
    setPending((p) => [...p, { id, label: t.fromText, since: Date.now() }]);
    setProblem(null);
    setDescribe('');
    try {
      const started = Date.now();
      const height = PERSON_HEIGHT[gender];
      const made = await textToRiggedPerson(falKey, words, gender, height, 'lab');
      await stageRef.current?.people.keepMeshyRig(made.glb, height, made.rigged);
      const s: LabSource = {
        id: made.glb,
        worldId: 'lab',
        world: 'lab',
        lang,
        name: words.slice(0, 48),
        role: 'person',
        body: gender,
        model: { glb: made.glb, image: made.image, prompt: made.prompt, costUsd: made.costUsd, ms: Date.now() - started, at: Date.now() },
      };
      addOwnSource(s);
      setOwn(ownSources());
      setSelected(s.id);
      setRigger('meshy');
    } catch (e) {
      log.warn('rpgModels.text.failed', describeError(e));
      setProblem({ where: 'draw', text: explain(e) });
      setDescribe(words);
    } finally {
      setPending((p) => p.filter((x) => x.id !== id));
    }
  };

  const drawOwn = async () => {
    if (!falKey || !describe.trim()) return;
    setDrawing(true);
    setProblem(null);
    try {
      const started = Date.now();
      const prompt = ownPrompt(describe, gender);
      const image = await drawImage(falKey, prompt, 'person', {}, IMAGE_SIZE, undefined, painter);
      const s: LabSource = {
        id: image,
        worldId: 'lab',
        world: 'lab',
        lang,
        name: describe.trim().slice(0, 48),
        role: 'person',
        body: gender,
        model: { glb: '', image, prompt, costUsd: PERSON_PAINTERS[painter].price(IMAGE_SIZE), ms: Date.now() - started, at: Date.now() },
      };
      addOwnSource(s);
      setOwn(ownSources());
      setSelected(s.id);
      setDescribe('');
    } catch (e) {
      log.warn('rpgModels.draw.failed', describeError(e));
      setProblem({ where: 'draw', text: explain(e) });
    } finally {
      setDrawing(false);
    }
  };

  const redrawn = source ? labPictures(source.id) : [];
  const drawn = source && pose !== 'game' ? keptPicture(source, pose, painter) : null;
  const painterPicker = (
    <label>
      {t.painter}:{' '}
      <select value={painter} onChange={(e) => setPainter(e.target.value as PersonPainter)}>
        {PAINTERS.map((p) => (
          <option key={p} value={p}>
            {t.painters[p]}
          </option>
        ))}
      </select>
    </label>
  );
  const requests = devRequests().filter((r) => r.kind === 'fal');
  const sessionUsd = requests.reduce((sum, r) => sum + (r.status === 'ok' ? (r.cost ?? 0) : 0), 0);

  return (
    <div className="lab">
      <p className="lab-intro">{t.intro}</p>
      {account.ready && !falKey && (
        <p className="lab-warn">
          {t.noKey} <a href={lang === 'pl' ? '/pl/account/' : '/account/'}>{t.addKey}</a>
        </p>
      )}
      <div className="lab-body">
        <aside className="lab-people">
          <h3>{t.people}</h3>
          {falKey && (
            <form
              className="lab-describe"
              onSubmit={(e) => {
                e.preventDefault();
                void drawOwn();
              }}
            >
              <label>
                {t.describe}
                <input value={describe} placeholder={t.describeHint} onChange={(e) => setDescribe(e.target.value)} />
              </label>
              <div>
                <select value={gender} onChange={(e) => setGender(e.target.value === 'female' ? 'female' : 'male')}>
                  <option value="male">{t.man}</option>
                  <option value="female">{t.woman}</option>
                </select>{' '}
                {painterPicker}{' '}
                <button type="submit" disabled={drawing || !describe.trim()}>
                  {drawing ? '…' : t.draw}
                </button>{' '}
                <button type="button" disabled={!describe.trim()} onClick={() => void makeFromText()} title={t.fromTextHint}>
                  {t.fromTextButton(formatUsd(TEXT_PERSON_PRICE))}
                </button>
              </div>
              {problem?.where === 'draw' && <p className="lab-error">{problem.text}</p>}
              {describe.trim() && (
                <details className="lab-prompt">
                  <summary>{t.promptSent}</summary>
                  <pre>{ownPrompt(describe, gender)}</pre>
                </details>
              )}
            </form>
          )}
          {worlds === null ? (
            <p>{t.loading}</p>
          ) : sources.length === 0 ? (
            <p>{t.none}</p>
          ) : (
            <ul>
              {sources.map((s) => (
                <li key={s.id}>
                  <button type="button" className={s.id === source?.id ? 'lab-person lab-person-on' : 'lab-person'} onClick={() => setSelected(s.id)}>
                    <img src={s.model.image} alt="" loading="lazy" width={48} height={48} />
                    <span>
                      <b>{s.name}</b>
                      <small>
                        {t.roles[s.role]} · {s.world}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="lab-main">
          {source && (
            <>
              <div className="lab-pictures">
                <figure>
                  <img src={source.model.image} alt="" width={128} height={128} />
                  <figcaption>{t.pictureGame}</figcaption>
                </figure>
                {redrawn.map((p) => (
                  <figure key={p.image}>
                    <img src={p.image} alt="" width={128} height={128} />
                    <figcaption>
                      {t.poses[p.pose]} · {t.painters[p.painter].split(' · ')[0]}
                    </figcaption>
                  </figure>
                ))}
              </div>

              <h3>{t.models}</h3>
              <table className="lab-models">
                <tbody>
                  {rows.map((r) => {
                    const st = stats[`${r.key}|${rigger}`] ?? stats[`${r.key}|self`];
                    const kb = r.bytes ? Math.round(r.bytes / 1024) : null;
                    return (
                      <tr key={r.key}>
                        <td>
                          <label>
                            <input
                              type="checkbox"
                              checked={shown.includes(r.key)}
                              onChange={(e) => setShown((s) => (e.target.checked ? [...s.filter((k) => k !== r.key), r.key].slice(-MAX_SHOWN) : s.filter((k) => k !== r.key)))}
                            />{' '}
                            {r.label}
                          </label>
                        </td>
                        <td>{formatUsd(r.costUsd)}</td>
                        <td>{formatMs(r.ms)}</td>
                        <td>{st ? ('error' in st ? `${t.failed}: ${st.error.slice(0, 80)}` : t.stats(st.stats.triangles, kb, st.stats.texture)) : ''}</td>
                        <td>
                          {r.variant && (
                            <button
                              type="button"
                              onClick={() => {
                                removeLabVariant(source.id, r.key);
                                setVersion((v) => v + 1);
                              }}
                            >
                              {t.remove}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {pending.map((p) => (
                    <tr key={p.id} className="lab-pending">
                      <td>{p.label}</td>
                      <td colSpan={4}>
                        {t.making} {formatMs(Date.now() - p.since)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {falKey && (
                <div className="lab-make">
                  <select value={method} onChange={(e) => setMethod(e.target.value as PersonMesher)} aria-label={t.make}>
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t.methods[m]}
                      </option>
                    ))}
                  </select>
                  <label>
                    {t.picture}:{' '}
                    <select value={pose} onChange={(e) => setPose(e.target.value as LabPose)}>
                      <option value="tpose">{t.poses.tpose}</option>
                      <option value="tposeDown">{t.poses.tposeDown}</option>
                      <option value="game">{t.pictureGame}</option>
                      <option value="redraw">{t.poses.redraw}</option>
                      <option value="wide">{t.poses.wide}</option>
                    </select>
                  </label>
                  {pose !== 'game' && painterPicker}
                  {pose !== 'game' && <small>{drawn ? t.pictureKept : t.pictureNew(formatUsd(PERSON_PAINTERS[painter].price(IMAGE_SIZE)))}</small>}
                  <button type="button" onClick={() => void make()}>
                    {t.make}
                  </button>
                  {problem?.where === 'make' && <p className="lab-error">{problem.text}</p>}
                  <details className="lab-prompt">
                    <summary>{pose === 'game' || drawn ? t.promptDrawn : t.promptSent}</summary>
                    <pre>{pose === 'game' ? source.model.prompt : (drawn?.prompt ?? posed(pose, source.model.prompt))}</pre>
                  </details>
                </div>
              )}
            </>
          )}

          <div className="lab-controls">
            <label>
              {t.rig}:{' '}
              <select
                value={rigger}
                onChange={(e) => setRigger(e.target.value === 'meshy' || e.target.value === 'raw' || e.target.value === 'voxel' ? e.target.value : 'self')}
              >
                <option value="self">{t.rigSelf}</option>
                <option value="voxel">{t.rigVoxel}</option>
                <option value="raw">{t.rigRaw}</option>
                <option value="meshy" disabled={!falKey}>
                  {t.rigMeshy}
                </option>
              </select>
            </label>
            {rigger === 'meshy' && uncached > 0 && !(rigging && 'since' in rigging) && (
              <button type="button" onClick={() => void rigWithMeshyNow()}>
                {t.rigMeshyPay(uncached)}
              </button>
            )}
            {rigging && 'since' in rigging && <span className="lab-rigging">{t.rigRunning(rigging.n, formatMs(Date.now() - rigging.since))}</span>}
            {rigging && 'ok' in rigging && (
              <span className={rigging.failed ? 'lab-error' : 'lab-rigging'}>
                {rigging.failed ? t.rigFailed(rigging.failed, rigging.ok, formatMs(rigging.ms), rigging.why) : t.rigDone(rigging.ok, formatMs(rigging.ms))}
              </span>
            )}
            <label>
              {t.clip}:{' '}
              <select value={clip} onChange={(e) => setClip(e.target.value)}>
                <option value={REST}>{t.restPose}</option>
                {(clips.length ? clips : [clip]).filter((c) => c !== REST).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.speed}:{' '}
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {[0.25, 0.5, 1, 1.5].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setPlaying((p) => !p)}>
              {playing ? t.pause : t.play}
            </button>
            <label>
              <input type="checkbox" checked={skeleton} onChange={(e) => setSkeleton(e.target.checked)} /> {t.skeleton}
            </label>
            <label>
              <input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} /> {t.wireframe}
            </label>
            <label>
              <input type="checkbox" checked={xray} onChange={(e) => setXray(e.target.checked)} /> {t.xray}
            </label>
            <label>
              <input type="checkbox" checked={weights} onChange={(e) => setWeights(e.target.checked)} /> {t.weights}
            </label>
          </div>
          {items.length > 1 && (
            <p className="lab-order">
              {t.leftToRight}: {rows.filter((r) => shown.includes(r.key)).map((r) => r.label).join(' · ')}
            </p>
          )}
          <canvas key={stageGen} ref={canvasRef} className="lab-canvas" />
          <p className="lab-spent">
            {t.spent(formatUsd(labSpent()))} · {t.consoleHint}
          </p>
        </section>
      </div>

      {consoleOpen && (
        <div className="lab-console" role="log">
          <h4>
            {t.console} · {t.total} {formatUsd(sessionUsd)}
          </h4>
          <ol>
            {requests.map((r) => (
              <li key={r.id} className={`lab-req lab-req-${r.status}`}>
                <b>{r.model}</b> · {r.label} · {r.status} · {formatMs(r.ms ?? Date.now() - r.startedAt)}
                {r.status === 'ok' ? ` · ${formatUsd(r.cost)}` : ''}
                {r.error ? ` · ${r.error}` : ''}
                <pre>{r.text}</pre>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
