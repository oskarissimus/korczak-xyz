package function

// Where a guide's twenty-odd seconds go.
//
// The reader waits from the tap to the first word, and until late Sep 2026 all anybody could say
// about that wait was its total, from Cloud Run's request log. That is not enough to decide
// anything: the same thirty seconds could be a slow Wikipedia, a long facts call, a minute of
// speech being synthesised, or an instance booting before any of it started, and each of those has
// a different fix. So every POST now measures its stages and reports them three ways:
//
//   - A Server-Timing header on the answer (exposed through CORS), which the app reads and sends to
//     Sentry beside its own view of the same tap - tap to headers, the download, the play - so the
//     difference between the two halves (the preflight, the network, a cold start) is visible too.
//   - One JSON line on stdout per request, which Cloud Logging files as a structured jsonPayload:
//     `jsonPayload.event="generate-audio.timing"` is every tap, including the ones that ended in a
//     422 or a provider's refusal, with the stage times, the counts and the outcome.
//   - The `timings` object in the guide record (record.go), when there is one, so a slow guide can
//     be read beside the sources that made it slow.
//
// Nothing here knows who tapped, and none of it carries a key or a coordinate.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Stage names, as they appear in Server-Timing, the log line and the record. The app reads them
// by these names (utils/audioGuide/narration.ts), so renaming one loses its history there.
const (
	stageNominatim = "nominatim" // reverse geocoding, in parallel with wikidata
	stageWikidata  = "wikidata"
	stageArticles  = "articles"  // the Wikipedia articles and the memorial's subject, in parallel
	stageGeosearch = "geosearch" // only when OSM links no article
	stageSources   = "sources"   // all of the above, wall clock
	stageFacts     = "facts"     // the first OpenAI call
	stageScript    = "script"    // the second
	stageTTS       = "tts"       // ElevenLabs
)

// The instance, for telling a cold start from a slow guide. An instance that has served no POST
// yet may have booted for this one - or for its preflight a moment earlier, which the reader also
// waited through - and its age says which.
var (
	instanceStart = time.Now()
	postsServed   atomic.Int64
)

// Where the log line goes. A variable so the tests can read it.
var timingOut = func(line []byte) { os.Stdout.Write(line) }

// guideTimings is one request's clock. Safe for the parallel fetches in gatherSources to write to.
type guideTimings struct {
	mu     sync.Mutex
	start  time.Time
	stages map[string]time.Duration
	// Wikimedia answers that were not 200 - almost always a 429 - during this request.
	wikimediaRefusals int
	cold              bool
	instanceAge       time.Duration
}

func newGuideTimings() *guideTimings {
	return &guideTimings{
		start:       time.Now(),
		stages:      map[string]time.Duration{},
		cold:        postsServed.Add(1) == 1,
		instanceAge: time.Since(instanceStart),
	}
}

type timingsKey struct{}

func withTimings(ctx context.Context, t *guideTimings) context.Context {
	return context.WithValue(ctx, timingsKey{}, t)
}

func timingsFrom(ctx context.Context) *guideTimings {
	t, _ := ctx.Value(timingsKey{}).(*guideTimings)
	return t
}

// stage starts timing name and returns the function that stops it: `defer stage(ctx, x)()`.
// Without timings in the context - a test calling a fetch directly - it does nothing.
func stage(ctx context.Context, name string) func() {
	t := timingsFrom(ctx)
	if t == nil {
		return func() {}
	}
	began := time.Now()
	return func() {
		t.mu.Lock()
		t.stages[name] += time.Since(began)
		t.mu.Unlock()
	}
}

func noteWikimediaRefusal(ctx context.Context) {
	if t := timingsFrom(ctx); t != nil {
		t.mu.Lock()
		t.wikimediaRefusals++
		t.mu.Unlock()
	}
}

func ms(d time.Duration) int64 { return d.Milliseconds() }

// snapshot is the stages in milliseconds, plus the total so far.
func (t *guideTimings) snapshot() map[string]int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make(map[string]int64, len(t.stages)+1)
	for k, v := range t.stages {
		out[k] = ms(v)
	}
	out["total"] = ms(time.Since(t.start))
	return out
}

// serverTiming is the header value: `sources;dur=2310, facts;dur=6120, ..., total;dur=21400`,
// with `cold` first on an instance's first POST.
func (t *guideTimings) serverTiming() string {
	snap := t.snapshot()
	names := make([]string, 0, len(snap))
	for k := range snap {
		if k != "total" {
			names = append(names, k)
		}
	}
	sort.Strings(names)
	var parts []string
	if t.cold {
		parts = append(parts, "cold")
	}
	for _, k := range append(names, "total") {
		parts = append(parts, fmt.Sprintf("%s;dur=%d", k, snap[k]))
	}
	return strings.Join(parts, ", ")
}

// timedWriter sets Server-Timing at the moment the status goes out, which is the last moment a
// header can, so every answer - the MP3, a 422, a 502 - carries the stages it got through.
type timedWriter struct {
	http.ResponseWriter
	timings *guideTimings
	status  int
	bytes   int
}

func (w *timedWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.Header().Set("Server-Timing", w.timings.serverTiming())
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *timedWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, err
}

// timingLine is the structured log entry. Field names are what a log query filters on
// (`jsonPayload.outcome="narrated"`), so rename them only knowing that.
type timingLine struct {
	Severity string           `json:"severity"`
	Message  string           `json:"message"`
	Event    string           `json:"event"`
	Release  string           `json:"release,omitempty"`
	Outcome  string           `json:"outcome"`
	Status   int              `json:"status"`
	Ms       map[string]int64 `json:"ms"`

	Cold          bool   `json:"cold"`
	InstanceAgeS  int64  `json:"instanceAgeS"`
	Category      string `json:"category,omitempty"`
	Language      string `json:"language,omitempty"`
	CountryCode   string `json:"countryCode,omitempty"`
	Tags          int    `json:"tags"`
	Sources       int    `json:"sources"`
	SourceChars   int    `json:"sourceChars"`
	ProposedFacts int    `json:"proposedFacts"`
	VerifiedFacts int    `json:"verifiedFacts"`
	Tier          string `json:"tier,omitempty"`
	ScriptChars   int    `json:"scriptChars"`
	AudioBytes    int    `json:"audioBytes"`
	WikiRefusals  int    `json:"wikimediaRefusals"`
}

// guideOutcome is what the handler learns as it goes, for the log line.
type guideOutcome struct {
	name                    string // narrated, no_sources, no_verified_facts, facts_failed, ...
	attraction              *Attraction
	countryCode             string
	sources, sourceChars    int
	proposed, verified      int
	tier                    string
	scriptChars, audioBytes int
}

func logTiming(t *guideTimings, w *timedWriter, o *guideOutcome) {
	t.mu.Lock()
	refusals := t.wikimediaRefusals
	t.mu.Unlock()
	outcome := o.name
	if outcome == "" {
		outcome = "rejected" // a 400 or a 401 before any work
	}
	line := timingLine{
		Severity:      "INFO",
		Message:       fmt.Sprintf("generate-audio: %s in %dms", outcome, ms(time.Since(t.start))),
		Event:         "generate-audio.timing",
		Release:       release,
		Outcome:       outcome,
		Status:        w.status,
		Ms:            t.snapshot(),
		Cold:          t.cold,
		InstanceAgeS:  int64(t.instanceAge.Seconds()),
		CountryCode:   o.countryCode,
		Sources:       o.sources,
		SourceChars:   o.sourceChars,
		ProposedFacts: o.proposed,
		VerifiedFacts: o.verified,
		Tier:          o.tier,
		ScriptChars:   o.scriptChars,
		AudioBytes:    o.audioBytes,
		WikiRefusals:  refusals,
	}
	if a := o.attraction; a != nil {
		line.Category, line.Language, line.Tags = a.Category, a.Language, len(a.Tags)
	}
	b, err := json.Marshal(line)
	if err != nil {
		return
	}
	timingOut(append(b, '\n'))
}
