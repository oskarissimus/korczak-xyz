package function

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// captureTiming collects the structured log lines instead of printing them.
func captureTiming(t *testing.T) func() []timingLine {
	t.Helper()
	var (
		mu    sync.Mutex
		lines []timingLine
	)
	prev := timingOut
	timingOut = func(b []byte) {
		var l timingLine
		if err := json.Unmarshal(b, &l); err != nil {
			t.Errorf("timing line is not JSON: %v: %s", err, b)
		}
		mu.Lock()
		lines = append(lines, l)
		mu.Unlock()
	}
	t.Cleanup(func() { timingOut = prev })
	return func() []timingLine {
		mu.Lock()
		defer mu.Unlock()
		return append([]timingLine(nil), lines...)
	}
}

func TestANarrationCarriesItsStagesAndLogsOneLine(t *testing.T) {
	f := newFakeProviders(t)
	f.elevenLabs = func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "ID3-fake-mp3") }
	lines := captureTiming(t)

	rec := post(validBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}

	header := rec.Header().Get("Server-Timing")
	for _, name := range []string{"nominatim;dur=", "articles;dur=", "sources;dur=", "facts;dur=", "script;dur=", "tts;dur=", "total;dur="} {
		if !strings.Contains(header, name) {
			t.Errorf("Server-Timing %q lacks %s", header, name)
		}
	}
	if !strings.Contains(header[strings.LastIndex(header, ",")+1:], "total") {
		t.Errorf("total should come last: %q", header)
	}

	got := lines()
	if len(got) != 1 {
		t.Fatalf("%d timing lines, want 1", len(got))
	}
	l := got[0]
	if l.Event != "generate-audio.timing" || l.Outcome != "narrated" || l.Status != http.StatusOK {
		t.Errorf("line %+v", l)
	}
	if l.Sources == 0 || l.VerifiedFacts != 3 || l.Tier == "" || l.ScriptChars == 0 || l.AudioBytes != len("ID3-fake-mp3") {
		t.Errorf("counts missing: %+v", l)
	}
	if l.CountryCode != "pl" || l.Language != "Polski" || l.Category != "historic" {
		t.Errorf("dimensions missing: %+v", l)
	}
	for _, k := range []string{"facts", "script", "tts", "total"} {
		if _, ok := l.Ms[k]; !ok {
			t.Errorf("ms lacks %s: %v", k, l.Ms)
		}
	}
}

func TestEveryAnswerIsTimedIncludingRefusals(t *testing.T) {
	f := newFakeProviders(t)
	lines := captureTiming(t)

	rec := post(`{"name":"Kapliczka","category":"historic:wayside_shrine","latitude":52.1,"longitude":21.0,"tags":{"historic":"wayside_shrine"}}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d", rec.Code)
	}
	if h := rec.Header().Get("Server-Timing"); !strings.Contains(h, "sources;dur=") || strings.Contains(h, "facts") {
		t.Errorf("Server-Timing %q", h)
	}

	rec = postWithKeys(validBody, "", "el-test")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", rec.Code)
	}
	if f.chatCalls != 0 {
		t.Errorf("%d chat calls", f.chatCalls)
	}

	got := lines()
	if len(got) != 2 || got[0].Outcome != "no_sources" || got[1].Outcome != "rejected" || got[1].Status != http.StatusUnauthorized {
		t.Errorf("lines %+v", got)
	}
}

func TestPreflightExposesServerTimingAndIsNotLogged(t *testing.T) {
	lines := captureTiming(t)
	post("")
	pre := httptest.NewRecorder()
	GenerateAudio(pre, httptest.NewRequest(http.MethodOptions, "/", nil))
	if !strings.Contains(pre.Header().Get("Access-Control-Expose-Headers"), "Server-Timing") {
		t.Error("Server-Timing is not exposed: the app would read it as null")
	}
	if n := len(lines()); n != 1 { // the empty POST, a 400; not the preflight
		t.Errorf("%d lines, want 1", n)
	}
}
