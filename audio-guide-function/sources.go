package function

// Where the guide's facts come from.
//
// Until Sep 2026 the model was asked for "fascinating, little-known facts" about a name and a
// category and answered from memory - which for anything smaller than a cathedral meant inventing
// them. Now nothing reaches the script that is not in one of these sources:
//
//   - OpenStreetMap: the descriptive tags the page already had from Overpass (start_date,
//     architect, inscription...). Short, but they are about exactly this object.
//   - Wikidata: the item OSM links with `wikidata`, a handful of its statements, and its links
//     to Wikipedia in every language.
//   - Wikipedia: up to two articles about the place - the local language's first, because the
//     Polish article about a Warsaw church is usually several times the English one - and one
//     about whoever a memorial commemorates.
//   - When OSM links nothing, Wikipedia's own geosearch around the pin, accepted only on a strict
//     name match. A near miss is exactly how the guide ended up in another town of the same name.
//
// Every fetch is best effort. A source that fails is a source that is missing, and a place with
// none left is told so rather than narrated (see grounding.go).

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

// Variables for the same reason as the provider endpoints: the tests point them at httptest.
// wikipediaEndpoint takes the language code; it is validated before it is formatted into a host.
var (
	wikidataEndpoint  = "https://www.wikidata.org/w/api.php"
	wikipediaEndpoint = "https://%s.wikipedia.org/w/api.php"
)

// Wikimedia refuses anonymous-looking clients outright ("You are making too many requests"), so
// this names the app and where to find it, as their User-Agent policy asks.
const wikimediaUserAgent = "KorczakXyzAudioGuide/1.0 (https://korczak.xyz/apps/audio-guide/)"

const (
	articleChars        = 6000 // per article; the lead and the history section are where the facts are
	subjectArticleChars = 2500
	geosearchRadius     = 250 // metres; a castle's centroid can be well away from its article's point
	maxArticles         = 2
)

var (
	langCodeRE = regexp.MustCompile(`^[a-z]{2,3}(-[a-z]{2,8})?$`)
	qidRE      = regexp.MustCompile(`^Q[1-9][0-9]{0,11}$`)
)

// source is one document the facts may be drawn from. Text is what the model sees and what its
// quotes are checked against; URL is what the reader is shown.
type source struct {
	ID    string
	Label string
	URL   string
	Text  string
}

// osmFactTags are the tags that say something about the object itself. Name variants and the
// category tags are context, not facts: "historic: memorial" beside a name is not a story, and a
// place with nothing else is a place we know nothing about.
var osmFactTags = []string{
	"start_date", "construction_date", "opening_date", "end_date",
	"architect", "builder", "designer", "artist_name", "artist", "sculptor",
	"building:architecture", "architecture",
	"inscription", "description", "subject", "memorial:subject",
	"official_name", "old_name",
}

// osmContextTags go into the OSM source beside the facts, so the model knows what kind of thing
// the facts are about, but never make a source on their own.
var osmContextTags = []string{
	"historic", "tourism", "amenity", "memorial", "memorial:type", "castle_type",
	"building", "denomination", "religion", "material", "height",
}

func osmSource(a *Attraction) *source {
	var facts, context []string
	for _, k := range osmFactTags {
		if v := strings.TrimSpace(a.Tags[k]); v != "" {
			facts = append(facts, k+": "+v)
		}
	}
	if len(facts) == 0 {
		return nil
	}
	for _, k := range osmContextTags {
		if v := strings.TrimSpace(a.Tags[k]); v != "" {
			context = append(context, k+": "+v)
		}
	}
	u := ""
	if a.OSM != "" {
		u = "https://www.openstreetmap.org/" + a.OSM
	}
	return &source{
		Label: "OpenStreetMap tags of this object",
		URL:   u,
		Text:  strings.Join(append(facts, context...), "\n"),
	}
}

// getJSON is every Wikimedia request: a User-Agent, a short timeout, and no error worth more than
// "this source is missing".
func getJSON(ctx context.Context, endpoint string, params url.Values, into any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", wikimediaUserAgent)
	client := &http.Client{Timeout: 6 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Logged, because a Wikimedia that refuses this function's IP looks from the outside like
		// every place in the world having nothing written about it.
		log.Printf("generate-audio: wikimedia %s: status %d", req.URL.Host, resp.StatusCode)
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(into)
}

// --- Wikidata ---------------------------------------------------------------------------------

type wdEntity struct {
	Labels       map[string]struct{ Value string } `json:"labels"`
	Descriptions map[string]struct{ Value string } `json:"descriptions"`
	Sitelinks    map[string]struct{ Title string } `json:"sitelinks"`
	Claims       map[string][]struct {
		Rank     string `json:"rank"`
		Mainsnak struct {
			Datavalue *struct {
				Type  string          `json:"type"`
				Value json.RawMessage `json:"value"`
			} `json:"datavalue"`
		} `json:"mainsnak"`
	} `json:"claims"`
}

// wdProperties are the statements worth reading aloud, in the order they are listed.
var wdProperties = []struct{ id, label string }{
	{"P571", "inception"},
	{"P1619", "date of official opening"},
	{"P576", "dissolved, abolished or demolished"},
	{"P84", "architect"},
	{"P170", "creator"},
	{"P149", "architectural style"},
	{"P138", "named after"},
	{"P547", "commemorates"},
	{"P1435", "heritage designation"},
	{"P140", "religion"},
}

func fetchEntities(ctx context.Context, ids []string, props string, langs []string) (map[string]wdEntity, error) {
	var out struct {
		Entities map[string]wdEntity `json:"entities"`
	}
	params := url.Values{
		"action":           {"wbgetentities"},
		"ids":              {strings.Join(ids, "|")},
		"props":            {props},
		"languages":        {strings.Join(langs, "|")},
		"languagefallback": {"1"},
		"format":           {"json"},
	}
	if err := getJSON(ctx, wikidataEndpoint, params, &out); err != nil {
		return nil, err
	}
	return out.Entities, nil
}

func pickLabel(m map[string]struct{ Value string }, langs []string) string {
	for _, l := range langs {
		if v, ok := m[l]; ok && v.Value != "" {
			return v.Value
		}
	}
	for _, v := range m {
		return v.Value
	}
	return ""
}

// wikidataTime renders a Wikidata time value at the precision it was recorded with: a year
// recorded as a year is "1619", not "1619-01-01", and a century is a century.
func wikidataTime(raw json.RawMessage) string {
	var v struct {
		Time      string `json:"time"`
		Precision int    `json:"precision"`
	}
	if json.Unmarshal(raw, &v) != nil || len(v.Time) < 5 {
		return ""
	}
	bce := v.Time[0] == '-'
	parts := strings.SplitN(strings.TrimLeft(v.Time[1:], "0"), "-", 3)
	if len(parts) < 3 || parts[0] == "" {
		return ""
	}
	year := parts[0]
	var s string
	switch {
	case v.Precision >= 11:
		s = fmt.Sprintf("%s-%s-%s", year, parts[1], parts[2][:2])
	case v.Precision == 10:
		s = fmt.Sprintf("%s-%s", year, parts[1])
	case v.Precision == 9:
		s = year
	case v.Precision == 8:
		s = year[:len(year)-1] + "0s"
	case v.Precision == 7:
		var y int
		fmt.Sscanf(year, "%d", &y)
		s = fmt.Sprintf("%s century", ordinal((y-1)/100+1))
	default:
		return ""
	}
	if bce {
		s += " BCE"
	}
	return s
}

func ordinal(n int) string {
	suffix := "th"
	if n%100 < 11 || n%100 > 13 {
		switch n % 10 {
		case 1:
			suffix = "st"
		case 2:
			suffix = "nd"
		case 3:
			suffix = "rd"
		}
	}
	return fmt.Sprintf("%d%s", n, suffix)
}

// wikidataResult is what one item contributes: a source of its statements, and its Wikipedia
// articles keyed by language code.
type wikidataResult struct {
	source    *source
	sitelinks map[string]string
	label     string
}

func fetchWikidata(ctx context.Context, qid string, langs []string) *wikidataResult {
	if !qidRE.MatchString(qid) {
		return nil
	}
	entities, err := fetchEntities(ctx, []string{qid}, "labels|descriptions|claims|sitelinks", langs)
	if err != nil {
		return nil
	}
	e, ok := entities[qid]
	if !ok {
		return nil
	}

	res := &wikidataResult{sitelinks: map[string]string{}, label: pickLabel(e.Labels, langs)}
	for site, link := range e.Sitelinks {
		// "plwiki", "enwiki" - but not "commonswiki", "specieswiki" or "plwikivoyage".
		if code, ok := strings.CutSuffix(site, "wiki"); ok && langCodeRE.MatchString(strings.ReplaceAll(code, "_", "-")) {
			res.sitelinks[strings.ReplaceAll(code, "_", "-")] = link.Title
		}
	}

	// Statements: dates are rendered here, entities are collected and named in one more request.
	type line struct{ label, value, entity string }
	var lines []line
	var refs []string
	for _, p := range wdProperties {
		n := 0
		for _, c := range e.Claims[p.id] {
			if c.Rank == "deprecated" || c.Mainsnak.Datavalue == nil || n >= 3 {
				continue
			}
			dv := c.Mainsnak.Datavalue
			switch dv.Type {
			case "time":
				if s := wikidataTime(dv.Value); s != "" {
					lines = append(lines, line{label: p.label, value: s})
					n++
				}
			case "wikibase-entityid":
				var v struct {
					ID string `json:"id"`
				}
				if json.Unmarshal(dv.Value, &v) == nil && qidRE.MatchString(v.ID) {
					lines = append(lines, line{label: p.label, entity: v.ID})
					refs = append(refs, v.ID)
					n++
				}
			case "string":
				var s string
				if json.Unmarshal(dv.Value, &s) == nil && s != "" {
					lines = append(lines, line{label: p.label, value: s})
					n++
				}
			}
		}
	}
	names := map[string]string{}
	if len(refs) > 0 {
		if len(refs) > 50 {
			refs = refs[:50]
		}
		if named, err := fetchEntities(ctx, refs, "labels", langs); err == nil {
			for id, ent := range named {
				names[id] = pickLabel(ent.Labels, langs)
			}
		}
	}

	var b strings.Builder
	if res.label != "" {
		fmt.Fprintf(&b, "label: %s\n", res.label)
	}
	if d := pickLabel(e.Descriptions, langs); d != "" {
		fmt.Fprintf(&b, "description: %s\n", d)
	}
	facts := 0
	for _, l := range lines {
		v := l.value
		if l.entity != "" {
			v = names[l.entity]
		}
		if v == "" {
			continue
		}
		fmt.Fprintf(&b, "%s: %s\n", l.label, v)
		facts++
	}
	// A label and a one-line description with no statements describe the category, not the place.
	if facts > 0 {
		res.source = &source{
			Label: "Wikidata item " + qid,
			URL:   "https://www.wikidata.org/wiki/" + qid,
			Text:  strings.TrimSpace(b.String()),
		}
	}
	return res
}

// --- Wikipedia --------------------------------------------------------------------------------

type article struct {
	lang, title, text string
}

func wikipediaURL(lang, title string) string {
	return fmt.Sprintf("https://%s.wikipedia.org/wiki/%s", lang, url.PathEscape(strings.ReplaceAll(title, " ", "_")))
}

// fetchArticle returns the plain text of an article, cut to `limit` characters at a sentence end.
func fetchArticle(ctx context.Context, lang, title string, limit int) *article {
	if !langCodeRE.MatchString(lang) || strings.TrimSpace(title) == "" {
		return nil
	}
	var out struct {
		Query struct {
			Pages []struct {
				Title   string `json:"title"`
				Missing bool   `json:"missing"`
				Extract string `json:"extract"`
			} `json:"pages"`
		} `json:"query"`
	}
	params := url.Values{
		"action":          {"query"},
		"prop":            {"extracts"},
		"explaintext":     {"1"},
		"exsectionformat": {"plain"},
		"redirects":       {"1"},
		"titles":          {title},
		"format":          {"json"},
		"formatversion":   {"2"},
	}
	if err := getJSON(ctx, fmt.Sprintf(wikipediaEndpoint, lang), params, &out); err != nil {
		return nil
	}
	if len(out.Query.Pages) == 0 || out.Query.Pages[0].Missing {
		return nil
	}
	p := out.Query.Pages[0]
	text := truncateAtSentence(strings.TrimSpace(p.Extract), limit)
	if len([]rune(text)) < 80 {
		return nil
	}
	return &article{lang: lang, title: p.Title, text: text}
}

func truncateAtSentence(s string, limit int) string {
	r := []rune(s)
	if len(r) <= limit {
		return s
	}
	cut := string(r[:limit])
	if i := strings.LastIndexAny(cut, ".!?"); i > limit/2 {
		return cut[:i+1]
	}
	return cut
}

// parseWikipediaTag reads OSM's "pl:Zamek Królewski w Warszawie".
func parseWikipediaTag(v string) (lang, title string) {
	lang, title, ok := strings.Cut(strings.TrimSpace(v), ":")
	if !ok || !langCodeRE.MatchString(lang) {
		return "", ""
	}
	return lang, strings.TrimSpace(title)
}

// geosearchArticle looks for an article whose point is near the pin and whose title is the
// place's name. The name test is strict on purpose: the article closest to a wayside shrine is
// usually about the parish, the street or the district, and any of those would be read out as if
// it were the shrine.
func geosearchArticle(ctx context.Context, lang string, a *Attraction) *article {
	if !langCodeRE.MatchString(lang) {
		return nil
	}
	var out struct {
		Query struct {
			Geosearch []struct {
				Title string  `json:"title"`
				Dist  float64 `json:"dist"`
			} `json:"geosearch"`
		} `json:"query"`
	}
	params := url.Values{
		"action":        {"query"},
		"list":          {"geosearch"},
		"gscoord":       {fmt.Sprintf("%f|%f", a.Latitude, a.Longitude)},
		"gsradius":      {fmt.Sprint(geosearchRadius)},
		"gslimit":       {"20"},
		"format":        {"json"},
		"formatversion": {"2"},
	}
	if err := getJSON(ctx, fmt.Sprintf(wikipediaEndpoint, lang), params, &out); err != nil {
		return nil
	}
	names := nameVariants(a)
	for _, hit := range out.Query.Geosearch {
		for _, n := range names {
			if namesMatch(n, hit.Title) {
				return fetchArticle(ctx, lang, hit.Title, articleChars)
			}
		}
	}
	return nil
}

func nameVariants(a *Attraction) []string {
	names := []string{a.Name}
	for k, v := range a.Tags {
		if strings.HasPrefix(k, "name:") || k == "official_name" || k == "alt_name" || k == "old_name" || k == "short_name" {
			for _, part := range strings.Split(v, ";") {
				if p := strings.TrimSpace(part); p != "" {
					names = append(names, p)
				}
			}
		}
	}
	return names
}

var parenthetical = regexp.MustCompile(`\s*\([^)]*\)`)

// nameTokens folds a name to comparable words: lower case, Latin diacritics dropped, a
// disambiguator in parentheses ("Ratusz (Poznań)") removed.
func nameTokens(s string) []string {
	s = parenthetical.ReplaceAllString(s, "")
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if f, ok := foldMap[r]; ok {
			b.WriteString(f)
		} else if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else {
			b.WriteRune(' ')
		}
	}
	return strings.Fields(b.String())
}

var foldMap = map[rune]string{
	'ą': "a", 'ć': "c", 'ę': "e", 'ł': "l", 'ń': "n", 'ó': "o", 'ś': "s", 'ź': "z", 'ż': "z",
	'á': "a", 'à': "a", 'â': "a", 'ä': "a", 'ã': "a", 'å': "a", 'č': "c", 'ç': "c", 'ď': "d",
	'é': "e", 'è': "e", 'ê': "e", 'ë': "e", 'ě': "e", 'í': "i", 'ì': "i", 'î': "i", 'ï': "i",
	'ň': "n", 'ñ': "n", 'ò': "o", 'ô': "o", 'ö': "o", 'õ': "o", 'ő': "o", 'ø': "o", 'ř': "r",
	'š': "s", 'ß': "ss", 'ť': "t", 'ú': "u", 'ù': "u", 'û': "u", 'ü': "u", 'ů': "u", 'ű': "u",
	'ý': "y", 'ž': "z",
}

// tokenMatches allows an abbreviation ("św" for "świętego", "st" for "saint") but nothing looser.
func tokenMatches(a, b string) bool {
	if a == b {
		return true
	}
	short, long := a, b
	if len(short) > len(long) {
		short, long = long, short
	}
	return len(short) >= 2 && len(short) <= 3 && strings.HasPrefix(long, short)
}

// namesMatch says whether a name and an article title name the same thing: identical once folded,
// or every word of the shorter found in the longer, with the shorter at least two words long.
// "Kościół św. Ojca Pio" matches "Kościół Świętego Ojca Pio w Warszawie"; "Pomnik" does not
// match "Pomnik Kopernika", and neither does "Ratusz" match "Ratusz w Gdańsku" unless the place
// is called exactly that.
func namesMatch(name, title string) bool {
	a, b := nameTokens(name), nameTokens(title)
	if len(a) == 0 || len(b) == 0 {
		return false
	}
	if strings.Join(a, " ") == strings.Join(b, " ") {
		return true
	}
	short, long := a, b
	if len(short) > len(long) {
		short, long = long, short
	}
	if len(short) < 2 {
		return false
	}
	used := make([]bool, len(long))
	for _, s := range short {
		found := false
		for i, l := range long {
			if !used[i] && tokenMatches(s, l) {
				used[i], found = true, true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// --- Languages --------------------------------------------------------------------------------

// languageCode maps the reader's free-text narration language to a Wikipedia code, for the
// handful of names people actually type. Anything else is simply not preferred.
func languageCode(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	for code, names := range languageNames {
		for _, candidate := range names {
			if n == candidate {
				return code
			}
		}
	}
	if langCodeRE.MatchString(n) {
		return n
	}
	return ""
}

var languageNames = map[string][]string{
	"en": {"english", "angielski", "englisch"},
	"pl": {"polski", "polish", "polnisch"},
	"de": {"deutsch", "german", "niemiecki"},
	"fr": {"français", "francais", "french", "francuski"},
	"es": {"español", "espanol", "spanish", "hiszpański"},
	"it": {"italiano", "italian", "włoski"},
	"pt": {"português", "portugues", "portuguese", "portugalski"},
	"nl": {"nederlands", "dutch", "niderlandzki"},
	"cs": {"čeština", "cestina", "czech", "czeski"},
	"sk": {"slovenčina", "slovak", "słowacki"},
	"uk": {"українська", "ukrainian", "ukraiński"},
	"ru": {"русский", "russian", "rosyjski"},
	"lt": {"lietuvių", "lithuanian", "litewski"},
	"hu": {"magyar", "hungarian", "węgierski"},
	"sv": {"svenska", "swedish", "szwedzki"},
	"ja": {"日本語", "japanese", "japoński"},
}

// countryLanguage is the Wikipedia most likely to know a country's small places well.
var countryLanguage = map[string]string{
	"pl": "pl", "de": "de", "at": "de", "ch": "de", "li": "de", "fr": "fr", "be": "fr", "lu": "fr",
	"it": "it", "sm": "it", "va": "it", "es": "es", "pt": "pt", "nl": "nl", "cz": "cs", "sk": "sk",
	"ua": "uk", "lt": "lt", "lv": "lv", "ee": "et", "hu": "hu", "hr": "hr", "si": "sl", "rs": "sr",
	"ba": "bs", "bg": "bg", "ro": "ro", "gr": "el", "se": "sv", "no": "no", "dk": "da", "fi": "fi",
	"is": "is", "ie": "en", "gb": "en", "us": "en", "ca": "en", "au": "en", "nz": "en", "jp": "ja",
	"cn": "zh", "tw": "zh", "kr": "ko", "tr": "tr", "il": "he", "by": "be", "md": "ro", "ge": "ka",
	"am": "hy", "mx": "es", "ar": "es", "br": "pt",
}

func uniqueLangs(langs ...string) []string {
	var out []string
	seen := map[string]bool{}
	for _, l := range langs {
		if l != "" && !seen[l] {
			seen[l] = true
			out = append(out, l)
		}
	}
	return out
}

// --- Putting it together ----------------------------------------------------------------------

// gatherSources collects everything known about the place. Nominatim runs beside the Wikidata
// lookup, because the country it answers with decides which Wikipedia is read first.
func gatherSources(ctx context.Context, a *Attraction) (Location, []source) {
	narration := languageCode(a.Language)
	tagLang, tagTitle := parseWikipediaTag(a.Tags["wikipedia"])
	wdLangs := uniqueLangs(tagLang, narration, "pl", "en")

	var (
		location Location
		wd       *wikidataResult
		wg       sync.WaitGroup
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		location = reverseGeocode(ctx, a.Latitude, a.Longitude)
	}()
	go func() {
		defer wg.Done()
		if qid := strings.TrimSpace(a.Tags["wikidata"]); qid != "" {
			wd = fetchWikidata(ctx, qid, wdLangs)
		}
	}()
	wg.Wait()

	local := countryLanguage[location.CountryCode]
	preferred := uniqueLangs(tagLang, local, narration, "en")

	// Which articles: the one OSM names, then the item's other languages in order of preference.
	type want struct{ lang, title string }
	var wants []want
	if tagTitle != "" {
		wants = append(wants, want{tagLang, tagTitle})
	}
	if wd != nil {
		for _, l := range preferred {
			if t, ok := wd.sitelinks[l]; ok && l != tagLang {
				wants = append(wants, want{l, t})
			}
		}
	}
	if len(wants) > maxArticles {
		wants = wants[:maxArticles]
	}

	articles := make([]*article, len(wants))
	var subject *article
	var subjectLabel string
	for i, w := range wants {
		wg.Add(1)
		go func() {
			defer wg.Done()
			articles[i] = fetchArticle(ctx, w.lang, w.title, articleChars)
		}()
	}
	// A memorial's story is mostly the story of whoever it is for.
	wg.Add(1)
	go func() {
		defer wg.Done()
		subject, subjectLabel = fetchSubject(ctx, a, preferred)
	}()
	wg.Wait()

	found := 0
	for _, art := range articles {
		if art != nil {
			found++
		}
	}
	// No article linked, or the linked ones are gone: look around the pin, by name.
	if found == 0 && tagTitle == "" && (wd == nil || len(wd.sitelinks) == 0) {
		for _, l := range uniqueLangs(local, narration) {
			if art := geosearchArticle(ctx, l, a); art != nil {
				articles = append(articles, art)
				break
			}
		}
	}

	var sources []source
	if s := osmSource(a); s != nil {
		sources = append(sources, *s)
	}
	if wd != nil && wd.source != nil {
		sources = append(sources, *wd.source)
	}
	for _, art := range articles {
		if art == nil {
			continue
		}
		sources = append(sources, source{
			Label: fmt.Sprintf("Wikipedia (%s) article %q", art.lang, art.title),
			URL:   wikipediaURL(art.lang, art.title),
			Text:  art.text,
		})
	}
	if subject != nil {
		sources = append(sources, source{
			Label: fmt.Sprintf("Wikipedia (%s) article %q - about %s, whom or what this place commemorates, NOT about the place itself", subject.lang, subject.title, subjectLabel),
			URL:   wikipediaURL(subject.lang, subject.title),
			Text:  subject.text,
		})
	}
	for i := range sources {
		sources[i].ID = fmt.Sprintf("S%d", i+1)
	}
	return location, sources
}

// fetchSubject follows OSM's subject:wikipedia or subject:wikidata to one article.
func fetchSubject(ctx context.Context, a *Attraction, preferred []string) (*article, string) {
	if lang, title := parseWikipediaTag(a.Tags["subject:wikipedia"]); title != "" {
		return fetchArticle(ctx, lang, title, subjectArticleChars), title
	}
	qid := strings.TrimSpace(strings.Split(a.Tags["subject:wikidata"], ";")[0])
	if !qidRE.MatchString(qid) {
		return nil, ""
	}
	entities, err := fetchEntities(ctx, []string{qid}, "labels|sitelinks", uniqueLangs(append(preferred, "en")...))
	if err != nil {
		return nil, ""
	}
	e := entities[qid]
	for _, l := range preferred {
		if link, ok := e.Sitelinks[strings.ReplaceAll(l, "-", "_")+"wiki"]; ok {
			return fetchArticle(ctx, l, link.Title, subjectArticleChars), pickLabel(e.Labels, preferred)
		}
	}
	return nil, ""
}
