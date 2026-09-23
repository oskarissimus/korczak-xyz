package function

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeProviders stands up Nominatim, Wikidata, Wikipedia, OpenAI and ElevenLabs on one httptest
// server and points the package at it. Each piece can be replaced per test.
type fakeProviders struct {
	mu sync.Mutex

	nominatim  http.HandlerFunc
	elevenLabs http.HandlerFunc
	// What the facts call answers with (the JSON the model would write), and what the script
	// call answers with. A replacement for the whole OpenAI handler goes in openAI.
	factsJSON string
	openAI    http.HandlerFunc

	// Wikidata entities by id, as wbgetentities returns them.
	entities map[string]any
	// Wikipedia article text by "lang:title".
	articles map[string]string
	// Geosearch titles by language.
	geosearch map[string][]string

	chatCalls    int
	ttsCalls     int
	scriptPrompt string
	factsPrompt  string
	wikiRequests []string
}

const staszicText = "Pałac Staszica – klasycystyczny pałac w Warszawie przy ulicy Nowy Świat 72. " +
	"Został wzniesiony w latach 1820–1823 według projektu Antonia Corazziego. " +
	"Budowę sfinansował Stanisław Staszic z przeznaczeniem na siedzibę Towarzystwa Przyjaciół Nauk. " +
	"W 1893 roku Rosjanie przebudowali go w stylu bizantyjsko-ruskim. " +
	"Po odzyskaniu niepodległości przywrócono mu klasycystyczny wygląd."

func newFakeProviders(t *testing.T) *fakeProviders {
	t.Helper()
	f := &fakeProviders{
		nominatim: func(w http.ResponseWriter, r *http.Request) {
			io.WriteString(w, `{"address":{"road":"Nowy Świat","city":"Warszawa","country":"Polska","country_code":"pl"}}`)
		},
		elevenLabs: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "audio/mpeg")
			io.WriteString(w, "ID3-fake-mp3")
		},
		factsJSON: `{"facts":[
			{"fact":"Zbudowany w latach 1820–1823.","source":"S1","evidence":"Został wzniesiony w latach 1820–1823 według projektu Antonia Corazziego."},
			{"fact":"Zaprojektował go Antonio Corazzi.","source":"S1","evidence":"według projektu Antonia Corazziego"},
			{"fact":"W 1893 roku przebudowany w stylu bizantyjsko-ruskim.","source":"S1","evidence":"W 1893 roku Rosjanie przebudowali go w stylu bizantyjsko-ruskim."}
		]}`,
		entities:  map[string]any{},
		articles:  map[string]string{"pl:Pałac Staszica": staszicText},
		geosearch: map[string][]string{},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/reverse", func(w http.ResponseWriter, r *http.Request) { f.nominatim(w, r) })
	mux.HandleFunc("/chat", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.chatCalls++
		f.mu.Unlock()
		if f.openAI != nil {
			f.openAI(w, r)
			return
		}
		var req chatRequest
		json.NewDecoder(r.Body).Decode(&req)
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		content := "Witamy przy pałacu."
		if req.ResponseFormat != nil {
			f.factsPrompt = req.Messages[1].Content
			content = f.factsJSON
		} else {
			f.scriptPrompt = req.Messages[1].Content
		}
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": content}}},
		})
	})
	mux.HandleFunc("/tts/", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.ttsCalls++
		f.mu.Unlock()
		f.elevenLabs(w, r)
	})
	mux.HandleFunc("/wikidata", func(w http.ResponseWriter, r *http.Request) {
		out := map[string]any{}
		for _, id := range strings.Split(r.URL.Query().Get("ids"), "|") {
			if e, ok := f.entities[id]; ok {
				out[id] = e
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"entities": out})
	})
	mux.HandleFunc("/wiki/{lang}", func(w http.ResponseWriter, r *http.Request) {
		lang, q := r.PathValue("lang"), r.URL.Query()
		f.mu.Lock()
		f.wikiRequests = append(f.wikiRequests, lang+" "+q.Get("list")+q.Get("titles"))
		f.mu.Unlock()
		if q.Get("list") == "geosearch" {
			var hits []any
			for _, title := range f.geosearch[lang] {
				hits = append(hits, map[string]any{"title": title, "dist": 40.0})
			}
			json.NewEncoder(w).Encode(map[string]any{"query": map[string]any{"geosearch": hits}})
			return
		}
		title := q.Get("titles")
		text, ok := f.articles[lang+":"+title]
		page := map[string]any{"title": title, "extract": text}
		if !ok {
			page = map[string]any{"title": title, "missing": true}
		}
		json.NewEncoder(w).Encode(map[string]any{"query": map[string]any{"pages": []any{page}}})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	prev := [5]string{nominatimEndpoint, openAIEndpoint, elevenLabsEndpoint, wikidataEndpoint, wikipediaEndpoint}
	nominatimEndpoint, openAIEndpoint, elevenLabsEndpoint = srv.URL+"/reverse", srv.URL+"/chat", srv.URL+"/tts"
	wikidataEndpoint, wikipediaEndpoint = srv.URL+"/wikidata", srv.URL+"/wiki/%s"
	t.Cleanup(func() {
		nominatimEndpoint, openAIEndpoint, elevenLabsEndpoint = prev[0], prev[1], prev[2]
		wikidataEndpoint, wikipediaEndpoint = prev[3], prev[4]
	})

	return f
}

const validBody = `{"name":"Pałac Staszica","category":"historic","latitude":52.24,"longitude":21.02,` +
	`"language":"Polski","osm":"way/123","tags":{"wikipedia":"pl:Pałac Staszica","historic":"building"}}`

func postWithKeys(body, openAIKey, elevenLabsKey string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if openAIKey != "" {
		req.Header.Set("X-OpenAI-Key", openAIKey)
	}
	if elevenLabsKey != "" {
		req.Header.Set("X-ElevenLabs-Key", elevenLabsKey)
	}
	rec := httptest.NewRecorder()
	GenerateAudio(rec, req)
	return rec
}

func post(body string) *httptest.ResponseRecorder {
	return postWithKeys(body, "sk-test", "el-test")
}

func errorBody(t *testing.T, rec *httptest.ResponseRecorder) (message, code string) {
	t.Helper()
	var body struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("error body is not JSON: %v", err)
	}
	return body.Error, body.Code
}

func errorOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	msg, _ := errorBody(t, rec)
	return msg
}

func TestPreflightAllowsTheKeyHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	GenerateAudio(rec, httptest.NewRequest(http.MethodOptions, "/", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("allow-origin %q", got)
	}
	allowed := rec.Header().Get("Access-Control-Allow-Headers")
	for _, h := range []string{"Content-Type", "X-OpenAI-Key", "X-ElevenLabs-Key"} {
		if !strings.Contains(allowed, h) {
			t.Errorf("allow-headers %q lacks %s: every tap would fail its preflight", allowed, h)
		}
	}
	// The client reads both through this; a header not exposed reads as null.
	exposed := rec.Header().Get("Access-Control-Expose-Headers")
	for _, h := range []string{"X-Location-Warning", "X-Guide-Sources"} {
		if !strings.Contains(exposed, h) {
			t.Errorf("expose-headers %q lacks %s", exposed, h)
		}
	}
}

func TestHappyPathReturnsMP3WithItsSources(t *testing.T) {
	f := newFakeProviders(t)
	f.elevenLabs = func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("xi-api-key") != "el-test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		io.WriteString(w, "ID3-fake-mp3")
	}
	rec := post(validBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}

	if ct := rec.Header().Get("Content-Type"); ct != "audio/mpeg" {
		t.Errorf("content-type %q", ct)
	}
	if rec.Body.String() != "ID3-fake-mp3" {
		t.Errorf("body %q", rec.Body)
	}
	if rec.Header().Get("X-Location-Warning") != "" {
		t.Error("warning set although Nominatim answered")
	}
	if f.chatCalls != 2 {
		t.Errorf("%d chat calls, want facts then script", f.chatCalls)
	}
	if got := rec.Header().Get("X-Guide-Sources"); got != "https://pl.wikipedia.org/wiki/Pa%C5%82ac_Staszica" {
		t.Errorf("sources %q", got)
	}
	if !strings.Contains(f.factsPrompt, "Antonia Corazziego") {
		t.Error("the article never reached the facts prompt")
	}
	if !strings.Contains(f.scriptPrompt, "Zaprojektował go Antonio Corazzi.") {
		t.Errorf("verified facts missing from the script prompt:\n%s", f.scriptPrompt)
	}
	if !strings.Contains(f.scriptPrompt, "between 80 and 150 words") {
		t.Error("three verified facts should make a full-length script")
	}
}

func TestAPlaceWithNoSourcesIsToldSoAndCostsNothing(t *testing.T) {
	f := newFakeProviders(t)
	rec := post(`{"name":"Kapliczka","category":"historic:wayside_shrine","latitude":52.1,"longitude":21.0,"tags":{"historic":"wayside_shrine"}}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if _, code := errorBody(t, rec); code != "no_sources" {
		t.Errorf("code %q", code)
	}
	if f.chatCalls != 0 || f.ttsCalls != 0 {
		t.Errorf("%d chat and %d TTS calls for a place nothing is known about", f.chatCalls, f.ttsCalls)
	}
}

func TestInventedFactsAreDroppedAndNothingIsLeftToSay(t *testing.T) {
	f := newFakeProviders(t)
	f.factsJSON = `{"facts":[
		{"fact":"Napoleon slept here.","source":"S1","evidence":"Napoleon spędził tu noc."},
		{"fact":"Built in 1799.","source":"S1","evidence":"Został wzniesiony w latach 1820–1823 według projektu Antonia Corazziego."},
		{"fact":"Designed by Corazzi.","source":"S9","evidence":"według projektu Antonia Corazziego"}
	]}`
	rec := post(validBody)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if f.ttsCalls != 0 || f.chatCalls != 1 {
		t.Errorf("%d chat calls and %d TTS calls, want the facts call alone", f.chatCalls, f.ttsCalls)
	}
}

func TestOneOrTwoFactsMakeAShortScript(t *testing.T) {
	f := newFakeProviders(t)
	f.factsJSON = `{"facts":[{"fact":"Zaprojektował go Antonio Corazzi.","source":"S1","evidence":"według projektu Antonia Corazziego"}]}`
	if rec := post(validBody); rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(f.scriptPrompt, "between 35 and 70 words") {
		t.Errorf("script prompt:\n%s", f.scriptPrompt)
	}
}

func TestOSMTagsAloneAreASource(t *testing.T) {
	f := newFakeProviders(t)
	f.factsJSON = `{"facts":[{"fact":"Postawiona w 1905 roku.","source":"S1","evidence":"start_date: 1905"}]}`
	rec := post(`{"name":"Kapliczka","category":"historic:wayside_shrine","latitude":52.1,"longitude":21.0,` +
		`"osm":"node/42","tags":{"historic":"wayside_shrine","start_date":"1905"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if got := rec.Header().Get("X-Guide-Sources"); got != "https://www.openstreetmap.org/node/42" {
		t.Errorf("sources %q", got)
	}
}

func TestWikidataPrefersTheLocalWikipediaAndReadsItsStatements(t *testing.T) {
	f := newFakeProviders(t)
	f.entities["Q1"] = map[string]any{
		"labels":       map[string]any{"en": map[string]string{"value": "Staszic Palace"}},
		"descriptions": map[string]any{"en": map[string]string{"value": "palace in Warsaw"}},
		"sitelinks": map[string]any{
			"enwiki":      map[string]string{"title": "Staszic Palace"},
			"plwiki":      map[string]string{"title": "Pałac Staszica"},
			"commonswiki": map[string]string{"title": "Category:Staszic Palace"},
		},
		"claims": map[string]any{
			"P571": []any{map[string]any{"rank": "normal", "mainsnak": map[string]any{"datavalue": map[string]any{
				"type": "time", "value": map[string]any{"time": "+1820-00-00T00:00:00Z", "precision": 9},
			}}}},
			"P84": []any{map[string]any{"rank": "normal", "mainsnak": map[string]any{"datavalue": map[string]any{
				"type": "wikibase-entityid", "value": map[string]any{"id": "Q2"},
			}}}},
		},
	}
	f.entities["Q2"] = map[string]any{"labels": map[string]any{"en": map[string]string{"value": "Antonio Corazzi"}}}
	f.articles["en:Staszic Palace"] = strings.Repeat("The Staszic Palace is in Warsaw. ", 5)
	// S1 is the Wikidata item now; the Polish article is S2.
	f.factsJSON = `{"facts":[{"fact":"Designed by Corazzi.","source":"S2","evidence":"według projektu Antonia Corazziego"}]}`

	rec := post(`{"name":"Pałac Staszica","category":"historic","latitude":52.24,"longitude":21.02,` +
		`"language":"English","tags":{"wikidata":"Q1"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	for _, want := range []string{"inception: 1820", "architect: Antonio Corazzi", `Wikipedia (pl) article "Pałac Staszica"`, `Wikipedia (en) article "Staszic Palace"`} {
		if !strings.Contains(f.factsPrompt, want) {
			t.Errorf("facts prompt lacks %q", want)
		}
	}
	// The Polish article comes before the English one: the country is Poland.
	if strings.Index(f.factsPrompt, "(pl) article") > strings.Index(f.factsPrompt, "(en) article") {
		t.Error("the local article should be read first")
	}
}

func TestGeosearchTakesOnlyAnArticleWithThePlacesName(t *testing.T) {
	f := newFakeProviders(t)
	f.geosearch["pl"] = []string{"Kabaty", "Ulica Rybałtów w Warszawie", "Kościół św. Ojca Pio w Warszawie"}
	f.articles["pl:Kościół św. Ojca Pio w Warszawie"] = strings.Repeat("Kościół parafialny na Kabatach. ", 5)
	f.factsJSON = `{"facts":[{"fact":"Kościół parafialny.","source":"S1","evidence":"Kościół parafialny na Kabatach"}]}`

	rec := post(`{"name":"Kościół Świętego Ojca Pio","category":"place_of_worship","latitude":52.12,"longitude":21.05}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(f.factsPrompt, `"Kościół św. Ojca Pio w Warszawie"`) || strings.Contains(f.factsPrompt, "Rybałtów w Warszawie\"") {
		t.Errorf("wrong article chosen:\n%s", f.factsPrompt)
	}

	// And with nothing of that name nearby, nothing is borrowed from the neighbours.
	f2 := newFakeProviders(t)
	f2.geosearch["pl"] = []string{"Kabaty", "Ulica Rybałtów w Warszawie"}
	if rec := post(`{"name":"Kościół Świętego Ojca Pio","category":"place_of_worship","latitude":52.12,"longitude":21.05}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestAMemorialsSubjectIsLabelledAsTheSubject(t *testing.T) {
	f := newFakeProviders(t)
	f.articles["pl:Mikołaj Kopernik"] = strings.Repeat("Mikołaj Kopernik był astronomem. ", 5)
	f.factsJSON = `{"facts":[{"fact":"Upamiętnia astronoma.","source":"S1","evidence":"Mikołaj Kopernik był astronomem"}]}`
	rec := post(`{"name":"Pomnik Mikołaja Kopernika","category":"historic:memorial","latitude":52.24,"longitude":21.02,` +
		`"tags":{"subject:wikipedia":"pl:Mikołaj Kopernik"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(f.factsPrompt, "NOT about the place itself") {
		t.Error("the subject's article is not marked as being about the subject")
	}
}

func TestNominatimFailureIsAWarningNotAnError(t *testing.T) {
	f := newFakeProviders(t)
	f.nominatim = func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }
	rec := post(validBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if rec.Header().Get("X-Location-Warning") == "" {
		t.Error("no X-Location-Warning")
	}
}

func TestProviderSentenceReachesTheClient(t *testing.T) {
	f := newFakeProviders(t)
	f.openAI = func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		io.WriteString(w, `{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota"}}`)
	}
	rec := post(validBody)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status %d", rec.Code)
	}
	msg := errorOf(t, rec)
	// classifyNarrationFailure in narration.ts matches on these words.
	if !strings.Contains(msg, "quota") || !strings.Contains(msg, "OpenAI 429") {
		t.Errorf("error %q", msg)
	}
}

func TestRejectedKeyIsA401WithTheProvidersWords(t *testing.T) {
	f := newFakeProviders(t)
	f.elevenLabs = func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"detail":{"status":"invalid_api_key","message":"Invalid API key"}}`)
	}
	rec := post(validBody)
	// The app reads 401 as "check your keys" and opens the sheet.
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", rec.Code)
	}
	if msg := errorOf(t, rec); msg != "Failed to generate audio: ElevenLabs 401: Invalid API key" {
		t.Errorf("error %q", msg)
	}
}

func TestMissingKeyIsA401AndSpendsNothing(t *testing.T) {
	f := newFakeProviders(t)
	for name, rec := range map[string]*httptest.ResponseRecorder{
		"no openai":     postWithKeys(validBody, "", "el-test"),
		"no elevenlabs": postWithKeys(validBody, "sk-test", "  "),
	} {
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status %d", name, rec.Code)
		}
	}
	if f.chatCalls != 0 {
		t.Errorf("%d chat calls without a full set of keys", f.chatCalls)
	}
}

func TestValidation(t *testing.T) {
	newFakeProviders(t)
	manyTags := map[string]string{}
	for i := 0; i <= maxTags; i++ {
		manyTags[fmt.Sprint("k", i)] = "v"
	}
	tooMany, _ := json.Marshal(map[string]any{"name": "a", "category": "x", "latitude": 1, "longitude": 1, "tags": manyTags})
	cases := map[string]string{
		"no name":       `{"category":"x","latitude":1,"longitude":1}`,
		"bad latitude":  `{"name":"a","category":"x","latitude":91,"longitude":1}`,
		"long language": `{"name":"a","category":"x","latitude":1,"longitude":1,"language":"` + strings.Repeat("x", 51) + `"}`,
		"bad osm ref":   `{"name":"a","category":"x","latitude":1,"longitude":1,"osm":"../../etc"}`,
		"too many tags": string(tooMany),
		"not json":      `{`,
	}
	for name, body := range cases {
		if rec := post(body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d", name, rec.Code)
		}
	}
}

func TestLanguageDefaultsToEnglish(t *testing.T) {
	a := Attraction{Name: " a ", Category: "x"}
	if err := a.Validate(); err != nil {
		t.Fatal(err)
	}
	if a.Language != "English" || a.Name != "a" {
		t.Errorf("%+v", a)
	}
}

func TestLocationIsLabelledSoAStreetIsNotReadAsATown(t *testing.T) {
	a := &Attraction{Latitude: 52.1285, Longitude: 21.0552}
	got := describeLocation(a, &Location{
		Street: "Rybałtów", Quarter: "Kabaty", Neighborhood: "Ursynów",
		City: "Warszawa", Country: "Polska", Valid: true,
	})
	for _, want := range []string{
		"Street: Rybałtów (a street name, not a town)",
		"District: Kabaty, Ursynów",
		"City: Warszawa",
		"Coordinates: 52.128500, 21.055200",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}

	if got := describeLocation(a, &Location{}); got != "Coordinates: 52.128500, 21.055200\n" {
		t.Errorf("without geocoding: %q", got)
	}
}
