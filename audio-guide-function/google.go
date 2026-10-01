package function

// Google, on the reader's own AI Studio key: Gemma writes the facts and the script, and Gemini
// searches the web.
//
// It was OpenAI until Oct 2026, when the account the guide ran on ran out of credit. Gemma is free
// on an ordinary AI Studio key, so a guide now costs the reader only its minute of ElevenLabs. An
// OpenAI key is still honoured when it is the only one sent - a page loaded before the switch
// sends nothing else - but the app sends the Google key and nothing else from then on.
//
// Two things about Gemma on this API shape everything below:
//
//   - It has no system prompt. A `systemInstruction` is refused outright ("Developer instruction
//     is not enabled"), so the system text leads the one user turn, which is what Gemma's own chat
//     template does with one anyway.
//   - It has no JSON mode either, and no tools. So the facts come back as text that should be
//     JSON and are cut out of it (jsonObject), and the web search is Gemini's, not Gemma's:
//     Grounding with Google Search is a Gemini tool and there is no Gemma equivalent.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	googleKeyHeader = "X-Google-Key"

	// The largest Gemma that is served on the API. It reads Polish well enough to quote a source
	// character for character, which is the one thing the facts call cannot do without.
	gemmaModel = "gemma-3-27b-it"
)

// A variable so the tests can point it at httptest, as with the other providers.
var googleModelsEndpoint = "https://generativelanguage.googleapis.com/v1beta/models"

// Search models, the second tried only when the first is refused (400/404) - the same shape as
// OpenAI's primary and fallback setups were. An alias as the fallback, because a dated Gemini is
// retired on Google's schedule and not ours.
var googleSearchModels = []string{"gemini-2.5-flash", "gemini-flash-latest"}

// writer is whose model writes the guide, with the key it is paid with.
type writer struct {
	provider string // "google" or "openai"
	key      string
}

func (w writer) google() bool { return w.provider == "google" }

type googlePart struct {
	Text string `json:"text,omitempty"`
}

type googleContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []googlePart `json:"parts"`
}

type googleRequest struct {
	Contents         []googleContent  `json:"contents"`
	Tools            []map[string]any `json:"tools,omitempty"`
	GenerationConfig map[string]any   `json:"generationConfig,omitempty"`
}

type googleResponse struct {
	Candidates []struct {
		Content struct {
			Parts []googlePart `json:"parts"`
		} `json:"content"`
		GroundingMetadata *struct {
			GroundingChunks []struct {
				Web *struct {
					URI   string `json:"uri"`
					Title string `json:"title"`
				} `json:"web"`
			} `json:"groundingChunks"`
		} `json:"groundingMetadata"`
	} `json:"candidates"`
}

func (r *googleResponse) text() string {
	if len(r.Candidates) == 0 {
		return ""
	}
	var b strings.Builder
	for _, p := range r.Candidates[0].Content.Parts {
		b.WriteString(p.Text)
	}
	return b.String()
}

// generateContent is one call to a model on Google's API. The key goes in a header rather than
// the query string, so it is in no URL that an error or a log line might quote.
func generateContent(ctx context.Context, apiKey, model string, body googleRequest) (*googleResponse, error) {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	endpoint := googleModelsEndpoint + "/" + url.PathEscape(model) + ":generateContent"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)

	resp, err := (&http.Client{Timeout: 45 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, newProviderError("Google", resp.StatusCode, b)
	}
	var out googleResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

// gemmaCompletion is chatCompletion for Gemma: the system message folded into the user turn.
func gemmaCompletion(ctx context.Context, apiKey string, reqBody chatRequest) (string, error) {
	var system, user []string
	for _, m := range reqBody.Messages {
		if m.Role == "system" {
			system = append(system, m.Content)
		} else {
			user = append(user, m.Content)
		}
	}
	prompt := strings.Join(append(system, user...), "\n\n")

	out, err := generateContent(ctx, apiKey, gemmaModel, googleRequest{
		Contents: []googleContent{{Role: "user", Parts: []googlePart{{Text: prompt}}}},
		GenerationConfig: map[string]any{
			"maxOutputTokens": reqBody.MaxTokens,
			"temperature":     reqBody.Temperature,
		},
	})
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(out.text())
	if text == "" {
		return "", errors.New("no response from Google")
	}
	return text, nil
}

// jsonObject cuts the object out of a model's answer. Without a JSON mode Gemma wraps it in a
// ```json fence more often than not, and now and then says a sentence before it.
func jsonObject(s string) string {
	start, end := strings.Index(s, "{"), strings.LastIndex(s, "}")
	if start < 0 || end < start {
		return s
	}
	return s[start : end+1]
}

// googleSearchURLs asks Gemini to search, with Grounding with Google Search, and returns the
// pages the search grounded its answer on. Nothing the model says about the place is kept: the
// pages are read here, as OpenAI's were (websearch.go).
//
// The input is the bare query, for the reason it was on OpenAI: a paragraph of instructions is
// searched for as a paragraph.
func googleSearchURLs(ctx context.Context, apiKey, model, query string) ([]string, string, error) {
	out, err := generateContent(ctx, apiKey, model, googleRequest{
		Contents: []googleContent{{Role: "user", Parts: []googlePart{{Text: query}}}},
		Tools:    []map[string]any{{"google_search": map[string]any{}}},
		// Room for a thinking model to think and still answer; the answer itself is thrown away.
		GenerationConfig: map[string]any{"maxOutputTokens": 2048},
	})
	if err != nil {
		return nil, "", err
	}
	var urls []string
	if len(out.Candidates) > 0 && out.Candidates[0].GroundingMetadata != nil {
		for _, c := range out.Candidates[0].GroundingMetadata.GroundingChunks {
			if c.Web != nil && c.Web.URI != "" {
				urls = append(urls, c.Web.URI)
			}
		}
	}
	answer := out.text()
	urls = append(urls, urlInTextRE.FindAllString(answer, -1)...)
	return resolveGroundingRedirects(ctx, urls), answer, nil
}

// resolveGroundingRedirects turns Google's grounding links into the pages they stand for.
//
// A grounded answer does not cite a page, it cites
// https://vertexaisearch.cloud.google.com/grounding-api-redirect/..., which answers with a
// redirect to it. Followed blindly that would work, but every check in fetchWebPage and
// candidateURLs is on the URL it is given - and that host is a google.com one, which skippedHosts
// refuses - so each is asked where it goes, without going there, and the answer is used instead.
// One that will not say is dropped.
func resolveGroundingRedirects(ctx context.Context, urls []string) []string {
	out := make([]string, len(urls))
	client := &http.Client{
		Timeout:       5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	var wg sync.WaitGroup
	for i, u := range urls {
		parsed, err := url.Parse(u)
		if err != nil || !strings.HasPrefix(parsed.Path, "/grounding-api-redirect/") {
			out[i] = u
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
			if err != nil {
				return
			}
			resp, err := client.Do(req)
			if err != nil {
				return
			}
			resp.Body.Close()
			if loc, err := resp.Location(); err == nil && resp.StatusCode >= 300 && resp.StatusCode < 400 {
				out[i] = loc.String()
			}
		}()
	}
	wg.Wait()

	var resolved []string
	for _, u := range out {
		if u != "" {
			resolved = append(resolved, u)
		}
	}
	return resolved
}
