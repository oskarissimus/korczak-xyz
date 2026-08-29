/**
 * Adding or correcting one interest.
 *
 * Validation is a pure function (`validateDraft` below) and the component's only job is turning an
 * error code into a sentence — the sleep log's split, for its reason: the rule is testable and the
 * wording is translatable, separately.
 */
import { useState } from 'react';
import type { InterestDraft } from '../../utils/events/interests';
import { DEFAULT_LEAD_DAYS, parseKeywords } from '../../utils/events/interests';
import type { Interest } from '../../utils/events/types';
import { translations, type Lang } from './translations';

export type DraftError = 'needs-label' | 'needs-rule';

/**
 * Whether a draft is savable.
 *
 * The second rule is the one worth having: an interest with neither keywords nor tags matches
 * *everything*, and since matches can notify, saving one turns the app into a firehose. An empty
 * keyword list is legitimate only when tags narrow it — which is exactly the Opera Narodowa shape.
 */
export function validateDraft(draft: InterestDraft): DraftError | null {
  if (!draft.label.trim()) return 'needs-label';
  const hasKeywords = draft.keywords.some((k) => k.trim());
  const hasTags = (draft.tags ?? []).some((k) => k.trim());
  if (!hasKeywords && !hasTags) return 'needs-rule';
  return null;
}

interface Props {
  lang: Lang;
  existing?: Interest;
  onSubmit: (draft: InterestDraft) => void;
  onCancel: () => void;
}

const lines = (list: string[] | undefined) => (list ?? []).join(', ');

export default function InterestForm({ lang, existing, onSubmit, onCancel }: Props) {
  const t = translations[lang];
  const [label, setLabel] = useState(existing?.label ?? '');
  const [keywords, setKeywords] = useState(lines(existing?.keywords));
  const [exclude, setExclude] = useState(lines(existing?.excludeKeywords));
  const [tags, setTags] = useState(lines(existing?.tags));
  const [cities, setCities] = useState(lines(existing?.cities));
  const [countries, setCountries] = useState(lines(existing?.countries));
  const [internationalAnywhere, setInternationalAnywhere] = useState(
    existing?.internationalAnywhere ?? false,
  );
  const [leadDays, setLeadDays] = useState(String(existing?.leadDays ?? DEFAULT_LEAD_DAYS));
  const [error, setError] = useState<DraftError | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const draft: InterestDraft = {
      label,
      keywords: parseKeywords(keywords),
      excludeKeywords: parseKeywords(exclude),
      tags: parseKeywords(tags),
      cities: parseKeywords(cities),
      countries: parseKeywords(countries),
      internationalAnywhere,
      leadDays: Number(leadDays),
      muted: existing?.muted,
    };
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(draft);
  };

  return (
    <form className="ev-form" onSubmit={submit}>
      <div className="ev-field">
        <label className="ev-field-label" htmlFor="ev-label">
          {t.fieldLabel}
        </label>
        <input
          id="ev-label"
          className="ev-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="ev-field">
        <label className="ev-field-label" htmlFor="ev-keywords">
          {t.fieldKeywords}
        </label>
        <textarea
          id="ev-keywords"
          className="ev-textarea"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
        <p className="ev-hint">{t.fieldKeywordsHint}</p>
      </div>

      <div className="ev-field">
        <label className="ev-field-label" htmlFor="ev-tags">
          {t.fieldTags}
        </label>
        <input
          id="ev-tags"
          className="ev-input"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          autoComplete="off"
        />
        <p className="ev-hint">{t.fieldTagsHint}</p>
      </div>

      <div className="ev-field">
        <label className="ev-field-label" htmlFor="ev-exclude">
          {t.fieldExclude}
        </label>
        <input
          id="ev-exclude"
          className="ev-input"
          value={exclude}
          onChange={(e) => setExclude(e.target.value)}
          autoComplete="off"
        />
        <p className="ev-hint">{t.fieldExcludeHint}</p>
      </div>

      <div className="ev-field">
        <label className="ev-field-label" htmlFor="ev-cities">
          {t.fieldCities}
        </label>
        <input
          id="ev-cities"
          className="ev-input"
          value={cities}
          onChange={(e) => setCities(e.target.value)}
          autoComplete="off"
        />
        <p className="ev-hint">{t.fieldCitiesHint}</p>
      </div>

      <div className="ev-field">
        <label className="ev-field-label" htmlFor="ev-countries">
          {t.fieldCountries}
        </label>
        <input
          id="ev-countries"
          className="ev-input"
          value={countries}
          onChange={(e) => setCountries(e.target.value)}
          autoComplete="off"
        />
        <p className="ev-hint">{t.fieldCountriesHint}</p>

        {/*
          * Inside the countries field rather than beside it, because it is not a second constraint:
          * the two are read as one rule with an OR between them. Made into a field of its own it
          * would look like "in these countries AND international", which keeps nothing.
          */}
        <label className="ev-check">
          <input
            type="checkbox"
            checked={internationalAnywhere}
            onChange={(e) => setInternationalAnywhere(e.target.checked)}
          />
          <span>{t.fieldInternational}</span>
        </label>
        <p className="ev-hint">{t.fieldInternationalHint}</p>
      </div>

      <div className="ev-field">
        <label className="ev-field-label" htmlFor="ev-lead">
          {t.fieldLead}
        </label>
        <input
          id="ev-lead"
          className="ev-input ev-number"
          type="number"
          min="0"
          max="365"
          value={leadDays}
          onChange={(e) => setLeadDays(e.target.value)}
        />
      </div>

      {error ? (
        <p className="ev-error" role="alert">
          {error === 'needs-label' ? t.errorNeedsLabel : t.errorNeedsRule}
        </p>
      ) : null}

      <div className="ev-actions">
        <button type="submit" className="ev-action ev-action--primary">
          {t.save}
        </button>
        <button type="button" className="ev-action" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
