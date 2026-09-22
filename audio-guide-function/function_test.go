package function

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeProviders stands up Nominatim, OpenAI and ElevenLabs on one httptest server and points the
// package at it. Each handler can be replaced per test.
type fakeProviders struct {
	nominatim  http.HandlerFunc
	openAI     http.HandlerFunc
	elevenLabs http.HandlerFunc
	chatCalls  int
}

func newFakeProviders(t *testing.T) *fakeProviders {
	t.Helper()
	f := &fakeProviders{
		nominatim: func(w http.ResponseWriter, r *http.Request) {
			io.WriteString(w, `{"address":{"road":"Krakowskie Przedmieście","city":"Warszawa","country":"Polska"}}`)
		},
		openAI: func(w http.ResponseWriter, r *http.Request) {
			io.WriteString(w, `{"choices":[{"message":{"content":"Some facts."}}]}`)
		},
		elevenLabs: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "audio/mpeg")
			io.WriteString(w, "ID3-fake-mp3")
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/reverse", func(w http.ResponseWriter, r *http.Request) { f.nominatim(w, r) })
	mux.HandleFunc("/chat", func(w http.ResponseWriter, r *http.Request) {
		f.chatCalls++
		f.openAI(w, r)
	})
	mux.HandleFunc("/tts/", func(w http.ResponseWriter, r *http.Request) { f.elevenLabs(w, r) })
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	prev := [3]string{nominatimEndpoint, openAIEndpoint, elevenLabsEndpoint}
	nominatimEndpoint, openAIEndpoint, elevenLabsEndpoint = srv.URL+"/reverse", srv.URL+"/chat", srv.URL+"/tts"
	t.Cleanup(func() { nominatimEndpoint, openAIEndpoint, elevenLabsEndpoint = prev[0], prev[1], prev[2] })

	t.Setenv("OPENAI_API_KEY", "sk-test")
	t.Setenv("ELEVENLABS_API_KEY", "el-test")
	return f
}

const validBody = `{"name":"Pałac Staszica","category":"historic","latitude":52.24,"longitude":21.02,"language":"Polski"}`

func post(body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	GenerateAudio(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)))
	return rec
}

func errorOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("error body is not JSON: %v", err)
	}
	return body.Error
}

func TestPreflightAllowsOnlyContentType(t *testing.T) {
	rec := httptest.NewRecorder()
	GenerateAudio(rec, httptest.NewRequest(http.MethodOptions, "/", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("allow-origin %q", got)
	}
	if got := rec.Header().Get("Access-Control-Expose-Headers"); got != "X-Location-Warning" {
		t.Errorf("expose-headers %q: the client reads the location warning through this", got)
	}
}

func TestHappyPathReturnsMP3(t *testing.T) {
	f := newFakeProviders(t)
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

func TestElevenLabsDetailMessage(t *testing.T) {
	f := newFakeProviders(t)
	f.elevenLabs = func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"detail":{"status":"quota_exceeded","message":"This request exceeds your quota."}}`)
	}
	msg := errorOf(t, post(validBody))
	if !strings.HasPrefix(msg, "Failed to generate audio: ElevenLabs 401: This request exceeds your quota.") {
		t.Errorf("error %q", msg)
	}
}

func TestMissingOrPlaceholderKeyIsA500(t *testing.T) {
	newFakeProviders(t)
	t.Setenv("ELEVENLABS_API_KEY", "none")
	rec := post(validBody)
	// The client reads 500 as "config": missing keys, and no retry will help.
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestValidation(t *testing.T) {
	newFakeProviders(t)
	cases := map[string]string{
		"no name":       `{"category":"x","latitude":1,"longitude":1}`,
		"bad latitude":  `{"name":"a","category":"x","latitude":91,"longitude":1}`,
		"long language": `{"name":"a","category":"x","latitude":1,"longitude":1,"language":"` + strings.Repeat("x", 51) + `"}`,
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
