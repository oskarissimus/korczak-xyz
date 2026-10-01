package function

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func postWithGoogleKey(body, googleKey string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Google-Key", googleKey)
	req.Header.Set("X-ElevenLabs-Key", "el-test")
	rec := httptest.NewRecorder()
	GenerateAudio(rec, req)
	return rec
}

func TestAGoogleKeyIsWrittenByGemini(t *testing.T) {
	f := newFakeProviders(t)
	rec := postWithGoogleKey(validBody, "AIza-test")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if len(f.googleCalls) != 2 {
		t.Fatalf("calls %v, want the facts and the script", f.googleCalls)
	}
	for _, c := range f.googleCalls {
		if c != writerModels[0]+":generateContent" {
			t.Errorf("call %q, want %s", c, writerModels[0])
		}
	}
	if !strings.Contains(f.factsPrompt, "You extract facts") || !strings.Contains(f.scriptPrompt, "scriptwriter") {
		t.Error("the system prompt did not reach Gemma")
	}
	// The fenced JSON was read: the Staszic facts survive the quote check and the guide is spoken.
	if f.ttsCalls != 1 {
		t.Errorf("%d tts calls", f.ttsCalls)
	}
}

func TestAGoogleKeyWinsOverAnOpenAIKey(t *testing.T) {
	f := newFakeProviders(t)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(validBody))
	req.Header.Set("X-Google-Key", "AIza-test")
	req.Header.Set("X-OpenAI-Key", "sk-test")
	req.Header.Set("X-ElevenLabs-Key", "el-test")
	rec := httptest.NewRecorder()
	GenerateAudio(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if len(f.googleCalls) != 2 {
		t.Errorf("google calls %v", f.googleCalls)
	}
}

func TestNoKeyAtAllAsksForTheGoogleOne(t *testing.T) {
	newFakeProviders(t)
	rec := postWithKeys(validBody, "", "el-test")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", rec.Code)
	}
	if msg := errorOf(t, rec); !strings.Contains(msg, "Google") {
		t.Errorf("error %q", msg)
	}
}

func TestARefusedGoogleKeyIsTheProvidersSentence(t *testing.T) {
	newFakeProviders(t)
	rec := postWithGoogleKey(validBody, "AIza-wrong")
	if msg := errorOf(t, rec); !strings.Contains(msg, "Google 400: API key not valid") {
		t.Errorf("error %q", msg)
	}
}

func TestTheGoogleSearchIsGroundedAndItsRedirectsFollowed(t *testing.T) {
	f := grazynaProviders(t)
	// What Google actually sends: a redirect link per page, never the page.
	f.searchURLs = []string{f.srvURL + "/grounding-api-redirect/grazyna"}
	rec := postWithGoogleKey(grazynaBody, "AIza-test")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(f.searchBody, `"google_search"`) {
		t.Errorf("not a grounded search: %s", f.searchBody)
	}
	if got, want := rec.Header().Get("X-Guide-Sources"), f.srvURL+"/page/grazyna"; got != want {
		t.Errorf("sources %q, want the page the redirect named, %q", got, want)
	}
}

func TestJSONObjectIsCutOutOfAFence(t *testing.T) {
	for in, want := range map[string]string{
		"```json\n{\"facts\":[]}\n```":  `{"facts":[]}`,
		"Here:\n{\"a\":{\"b\":1}} done": `{"a":{"b":1}}`,
		`{"facts":[]}`:                  `{"facts":[]}`,
		"no json":                       "no json",
	} {
		if got := jsonObject(in); got != want {
			t.Errorf("jsonObject(%q) = %q, want %q", in, got, want)
		}
	}
}
