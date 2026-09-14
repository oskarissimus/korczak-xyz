/**
 * One interest as it reads rather than as it is edited — the rules, in chips.
 *
 * Shared by the two tabs that draw an interest, and shared for the reason `sourceNames.ts` is: two
 * screens describing one filter differently is worse than either description. The Interests tab
 * lists them to be managed; the Sources tab lists the ones that reach a source, beside the rows
 * they decide about. Both show the same sentence, and a rule added to `match.ts` has one place to
 * appear in.
 *
 * Read-only, always. Editing is the form, and both callers open the same one.
 */
import { countryLabel } from '../../utils/events/countries';
import type { Interest } from '../../utils/events/types';
import { translations, type Lang } from './translations';

export default function InterestRules({ interest, lang }: { interest: Interest; lang: Lang }) {
  const t = translations[lang];
  /*
   * The countries belong here as much as the keywords do. Left off, an interest that quietly drops
   * four conferences a week looks exactly like one that constrains nothing — which is the failure
   * this whole axis was added to make visible, reappearing one screen along.
   *
   * `@` for both a city and a country, since both answer "where" and a two-letter code does not
   * read as a city name. `+` for the international clause, because it is a second way to pass
   * rather than a second thing to satisfy.
   */
  const rules = [
    ...interest.keywords,
    ...(interest.tags ?? []).map((tag) => `#${tag}`),
    ...(interest.cities ?? []).map((city) => `@${city}`),
    ...(interest.countries ?? []).map((code) => `@${countryLabel(code)}`),
    ...(interest.internationalAnywhere ? [`+${t.reachInternational}`] : []),
    /*
     * Only when it is on, unlike the rules above it — this is the one filter that runs whether or
     * not an interest mentions it, so what is worth showing is the interest that has turned it
     * off. A chip on every row saying "and not press releases" would be a rule nobody set.
     */
    ...(interest.includeCoverage ? [`+${t.kindCoverage}`] : []),
  ];

  return (
    <>
      <div className="ev-interest-rules">
        {rules.length === 0 ? (
          <span className="ev-hint">—</span>
        ) : (
          rules.map((rule) => (
            <span className="ev-chip" key={rule}>
              {rule}
            </span>
          ))
        )}
      </div>

      {interest.excludeKeywords?.length ? (
        <p className="ev-hint">
          {t.fieldExclude}: {interest.excludeKeywords.join(', ')}
        </p>
      ) : null}

      <p className="ev-hint">
        {t.fieldLead}: {interest.leadDays}
        {interest.muted ? ` · ${t.mutedNote}` : ''}
      </p>
    </>
  );
}
