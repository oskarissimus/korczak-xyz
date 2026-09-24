// Package function is the audio guide's backend: the one request on /apps/audio-guide/ that costs
// money.
//
// A name, a category, a pair of coordinates and the place's OpenStreetMap tags come in; an MP3
// goes out. In between it gathers what is actually known about the place - the tags, its Wikidata
// item, its Wikipedia articles (sources.go) - has gpt-4o-mini pick facts out of those with a
// verbatim quote for each, checks every quote against its source (grounding.go), asks again for a
// script written for a speech synthesiser from the facts that survived, and has ElevenLabs read
// it aloud. A place with no sources, or none the checks let through, is answered with a 422
// rather than a guess. What the model said, and the sources it said it from, are recorded in a
// bucket for fact-checking later (record.go).
//
// THE KEYS ARE THE CALLER'S, not ours. They arrive with every request in two headers, typed into
// the app's keys sheet the way sloper's and the backseat driver's are, and are used for that one
// request and forgotten: nothing here stores, logs or falls back to a key of its own. That is what
// makes it safe for this function to answer anybody - a stranger who posts here pays for their
// own guide - and why there is no Secret Manager and no sign-in check.
//
// Moved here from oskarissimus/audio-guide-v2 (GCP project prompt-compressor-1) in Sep 2026, and
// kept in Go. It deploys with gcloud, not the Firebase CLI - the CLI deploys Node and Python only -
// from the audio-guide job in .github/workflows/firebase-deploy.yml. See
// .claude/rules/audio-guide.md.
package function

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/GoogleCloudPlatform/functions-framework-go/functions"
)

const (
	requestTimeout = 90 * time.Second
	defaultVoiceID = "21m00Tcm4TlvDq8ikWAM"

	// The caller's keys. Named in Access-Control-Allow-Headers below, or every preflight fails.
	openAIKeyHeader     = "X-OpenAI-Key"
	elevenLabsKeyHeader = "X-ElevenLabs-Key"

	// Space-separated URLs of the sources the narration's facts came from. Percent-encoded, so
	// the header stays ASCII whatever the article title.
	sourcesHeader = "X-Guide-Sources"
	// The error code of a place nothing reliable is known about. The app shows its own sentence
	// for it rather than the "service failed" one: nothing failed.
	noSourcesCode = "no_sources"

	maxTags = 60
)

// Variables rather than constants so the tests can point them at an httptest server. Nothing in
// the deployed function assigns them.
var (
	openAIEndpoint     = "https://api.openai.com/v1/chat/completions"
	elevenLabsEndpoint = "https://api.elevenlabs.io/v1/text-to-speech"
	nominatimEndpoint  = "https://nominatim.openstreetmap.org/reverse"
)

func init() {
	functions.HTTP("GenerateAudio", GenerateAudio)
}

// Attraction represents a point of interest
type Attraction struct {
	Name      string  `json:"name"`
	Category  string  `json:"category"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Language  string  `json:"language"`
	// "way/123". Optional: only used to link the reader to the object the facts came from.
	OSM string `json:"osm"`
	// The element's tags as Overpass gave them, filtered by the app to the ones that describe it
	// (overpass.ts). Optional; a request without them is still grounded, through geosearch.
	Tags map[string]string `json:"tags"`
}

// Location represents reverse geocoded location data
type Location struct {
	Country      string `json:"country,omitempty"`
	City         string `json:"city,omitempty"`
	Street       string `json:"street,omitempty"`
	Neighborhood string `json:"neighborhood,omitempty"`
	Quarter      string `json:"quarter,omitempty"`
	CountryCode  string `json:"countryCode,omitempty"` // "pl"; picks which Wikipedia is read first
	Valid        bool   `json:"valid"`                 // false if geocoding failed
}

// nominatimResponse represents the Nominatim API response
type nominatimResponse struct {
	Address struct {
		Road          string `json:"road"`
		Street        string `json:"street"`
		City          string `json:"city"`
		Town          string `json:"town"`
		Village       string `json:"village"`
		Suburb        string `json:"suburb"`
		Neighbourhood string `json:"neighbourhood"`
		Quarter       string `json:"quarter"`
		Country       string `json:"country"`
		CountryCode   string `json:"country_code"`
	} `json:"address"`
}

func (a *Attraction) Validate() error {
	a.Name = strings.TrimSpace(a.Name)
	if a.Name == "" {
		return errors.New("name is required")
	}
	if len(a.Name) > 500 {
		return errors.New("name must be at most 500 characters")
	}

	a.Category = strings.TrimSpace(a.Category)
	if a.Category == "" {
		return errors.New("category is required")
	}
	if len(a.Category) > 100 {
		return errors.New("category must be at most 100 characters")
	}

	if a.Latitude < -90 || a.Latitude > 90 {
		return errors.New("latitude must be between -90 and 90")
	}

	if a.Longitude < -180 || a.Longitude > 180 {
		return errors.New("longitude must be between -180 and 180")
	}

	// Set default language if not provided
	a.Language = strings.TrimSpace(a.Language)
	if a.Language == "" {
		a.Language = "English"
	}
	if len(a.Language) > 50 {
		return errors.New("language must be at most 50 characters")
	}

	if a.OSM != "" && !osmRefRE.MatchString(a.OSM) {
		return errors.New("osm must look like way/123")
	}
	if len(a.Tags) > maxTags {
		return fmt.Errorf("at most %d tags", maxTags)
	}
	for k, v := range a.Tags {
		if len(k) > 64 || len(v) > 1000 {
			return errors.New("tag too long")
		}
	}

	return nil
}

var osmRefRE = regexp.MustCompile(`^(node|way|relation)/[1-9][0-9]{0,15}$`)

// reverseGeocode converts coordinates to human-readable location using Nominatim API
func reverseGeocode(ctx context.Context, lat, lon float64) Location {
	url := fmt.Sprintf("%s?lat=%f&lon=%f&format=json", nominatimEndpoint, lat, lon)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return Location{Valid: false}
	}

	// Nominatim requires a User-Agent header
	req.Header.Set("User-Agent", "AudioGuide/1.0 (https://korczak.xyz/apps/audio-guide/)")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return Location{Valid: false}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Location{Valid: false}
	}

	var nomResp nominatimResponse
	if err := json.NewDecoder(resp.Body).Decode(&nomResp); err != nil {
		return Location{Valid: false}
	}

	loc := Location{
		Country:     nomResp.Address.Country,
		CountryCode: strings.ToLower(nomResp.Address.CountryCode),
		Valid:       true,
	}

	// Get city (could be city, town, or village)
	if nomResp.Address.City != "" {
		loc.City = nomResp.Address.City
	} else if nomResp.Address.Town != "" {
		loc.City = nomResp.Address.Town
	} else if nomResp.Address.Village != "" {
		loc.City = nomResp.Address.Village
	}

	// Get street (could be road or street)
	if nomResp.Address.Road != "" {
		loc.Street = nomResp.Address.Road
	} else if nomResp.Address.Street != "" {
		loc.Street = nomResp.Address.Street
	}

	// Get neighborhood
	if nomResp.Address.Suburb != "" {
		loc.Neighborhood = nomResp.Address.Suburb
	} else if nomResp.Address.Neighbourhood != "" {
		loc.Neighborhood = nomResp.Address.Neighbourhood
	}

	// A quarter (Kabaty, Mokotów's Stegny) is the name a local would actually use, and the suburb
	// above is often just the borough.
	loc.Quarter = nomResp.Address.Quarter

	return loc
}

// GenerateAudio is the Cloud Function entry point
func GenerateAudio(w http.ResponseWriter, r *http.Request) {
	// CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, "+openAIKeyHeader+", "+elevenLabsKeyHeader)
	w.Header().Set("Access-Control-Expose-Headers", "X-Location-Warning, "+sourcesHeader)
	// The key headers make every tap a preflighted request; this spares the second tap one. Safari
	// caps it at ten minutes whatever is asked for.
	w.Header().Set("Access-Control-Max-Age", "600")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var attraction Attraction
	if err := json.NewDecoder(r.Body).Decode(&attraction); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON: "+err.Error())
		return
	}

	if err := attraction.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request: "+err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()

	openAIKey := strings.TrimSpace(r.Header.Get(openAIKeyHeader))
	elevenLabsKey := strings.TrimSpace(r.Header.Get(elevenLabsKeyHeader))
	if openAIKey == "" {
		writeError(w, http.StatusUnauthorized, "No OpenAI key was sent")
		return
	}
	if elevenLabsKey == "" {
		writeError(w, http.StatusUnauthorized, "No ElevenLabs key was sent")
		return
	}

	location, sources := gatherSources(ctx, &attraction)

	// Set warning header if geocoding failed
	if !location.Valid {
		w.Header().Set("X-Location-Warning", "Location details unavailable - information may be less accurate")
	}

	// Nothing to ground a narration on: say so, and spend nothing on either provider.
	if len(sources) == 0 {
		log.Printf("generate-audio: no sources for %q (%s)", attraction.Name, attraction.OSM)
		writeErrorCode(w, http.StatusUnprocessableEntity, noSourcesCode, "No sources found about this place")
		return
	}

	proposed, facts, err := extractFacts(ctx, openAIKey, &attraction, &location, sources)
	if err != nil {
		log.Printf("generate-audio: facts: %v", err)
		writeError(w, failureStatus(err), "Failed to generate facts: "+providerMessage(err))
		return
	}

	// From here on the model has said something about this place, so what it said is kept for
	// fact-checking, whatever becomes of the tap. See record.go.
	rec := newGuideRecord(&attraction, location, sources, proposed, facts)
	defer saveGuideRecord(ctx, rec)

	if len(facts) == 0 {
		log.Printf("generate-audio: no verified facts for %q from %d sources", attraction.Name, len(sources))
		rec.Outcome = "no_verified_facts"
		writeErrorCode(w, http.StatusUnprocessableEntity, noSourcesCode, "The sources found say nothing checkable about this place")
		return
	}

	t := tierFor(facts)
	rec.Tier = t.name
	log.Printf("generate-audio: %q: %d sources, %d verified facts, %s script", attraction.Name, len(sources), len(facts), t.name)
	script, err := generateScript(ctx, openAIKey, attraction.Name, facts, attraction.Language, t)
	if err != nil {
		log.Printf("generate-audio: script: %v", err)
		rec.Outcome, rec.Error = "script_failed", err.Error()
		writeError(w, failureStatus(err), "Failed to generate script: "+providerMessage(err))
		return
	}
	rec.Script = script

	// Generate audio
	audio, err := generateAudioTTS(ctx, elevenLabsKey, script)
	if err != nil {
		log.Printf("generate-audio: audio: %v", err)
		rec.Outcome, rec.Error = "audio_failed", err.Error()
		writeError(w, failureStatus(err), "Failed to generate audio: "+providerMessage(err))
		return
	}
	rec.Outcome = "narrated"

	w.Header().Set(sourcesHeader, strings.Join(citedURLs(facts, sources), " "))
	w.Header().Set("Content-Type", "audio/mpeg")
	w.WriteHeader(http.StatusOK)
	w.Write(audio)
}

// providerError is a provider's non-200 answer: the status and the provider's own sentence.
type providerError struct {
	provider string
	status   int
	message  string
}

func (e *providerError) Error() string {
	return fmt.Sprintf("%s error %d: %s", e.provider, e.status, e.message)
}

// newProviderError pulls the human sentence out of a provider's error body.
//
// OpenAI answers {"error": {"message": ...}}, ElevenLabs {"detail": {"message": ...}} or
// {"detail": "..."}. That sentence is what the client shows verbatim and what it matches on to tell
// an exhausted account from a rate limit, so it is passed through rather than collapsed into
// "Failed to generate audio". Anything unparseable falls back to the raw body, capped.
func newProviderError(provider string, status int, body []byte) *providerError {
	var parsed struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Detail json.RawMessage `json:"detail"`
	}
	message := ""
	if json.Unmarshal(body, &parsed) == nil {
		if parsed.Error != nil {
			message = parsed.Error.Message
		} else if len(parsed.Detail) > 0 {
			var detail struct {
				Message string `json:"message"`
			}
			var text string
			if json.Unmarshal(parsed.Detail, &detail) == nil && detail.Message != "" {
				message = detail.Message
			} else if json.Unmarshal(parsed.Detail, &text) == nil {
				message = text
			}
		}
	}
	if message == "" {
		message = strings.TrimSpace(string(body))
	}
	if len(message) > 300 {
		message = message[:300]
	}
	return &providerError{provider: provider, status: status, message: message}
}

// providerMessage is what reaches the client about a failed step: the provider's words where
// there are some, and nothing about a network error, whose text would only name our own plumbing.
func providerMessage(err error) string {
	var pe *providerError
	if errors.As(err, &pe) {
		return fmt.Sprintf("%s %d: %s", pe.provider, pe.status, pe.message)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timed out"
	}
	return "upstream request failed"
}

// failureStatus is 401 when a provider refused the caller's key and 502 for everything else. The
// app reads 401 as "check your keys" and opens the sheet, which is the one failure the reader can
// fix on the spot.
func failureStatus(err error) int {
	var pe *providerError
	if errors.As(err, &pe) && (pe.status == http.StatusUnauthorized || pe.status == http.StatusForbidden) {
		return http.StatusUnauthorized
	}
	return http.StatusBadGateway
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeErrorCode(w, status, "", message)
}

// writeErrorCode adds a machine-readable `code` beside the sentence, for the one failure the app
// has to tell apart without matching on English.
func writeErrorCode(w http.ResponseWriter, status int, code, message string) {
	body := map[string]string{"error": message}
	if code != "" {
		body["code"] = code
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

// OpenAI types
type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model          string          `json:"model"`
	Messages       []chatMessage   `json:"messages"`
	MaxTokens      int             `json:"max_tokens"`
	Temperature    float64         `json:"temperature"`
	ResponseFormat *responseFormat `json:"response_format,omitempty"`
}

type responseFormat struct {
	Type string `json:"type"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// describeLocation labels each part of the address, because unlabelled it is ambiguous: "Rybałtów,
// Ursynów, Warszawa" was read as a village called Rybałtów, and the guide to a church on that
// street in Kabaty was about somewhere else entirely. The coordinates always go in as well.
func describeLocation(attraction *Attraction, location *Location) string {
	var b strings.Builder
	if location.Valid {
		if location.Street != "" {
			fmt.Fprintf(&b, "Street: %s (a street name, not a town)\n", location.Street)
		}
		var areas []string
		for _, a := range []string{location.Quarter, location.Neighborhood} {
			if a != "" && (len(areas) == 0 || areas[len(areas)-1] != a) {
				areas = append(areas, a)
			}
		}
		if len(areas) > 0 {
			fmt.Fprintf(&b, "District: %s\n", strings.Join(areas, ", "))
		}
		if location.City != "" {
			fmt.Fprintf(&b, "City: %s\n", location.City)
		}
		if location.Country != "" {
			fmt.Fprintf(&b, "Country: %s\n", location.Country)
		}
	}
	fmt.Fprintf(&b, "Coordinates: %f, %f\n", attraction.Latitude, attraction.Longitude)
	return b.String()
}

// generateScript turns the verified facts into something to be read aloud. It sees the facts and
// nothing else, and is told that everything it adds is an error: this is the step where a
// "warm, engaging" script used to grow a founding legend of its own.
func generateScript(ctx context.Context, apiKey, attractionName string, facts []fact, language string, t tier) (string, error) {
	systemPrompt := fmt.Sprintf(`You are a professional audio guide scriptwriter. Write natural, conversational scripts for text-to-speech narration. Avoid visual references like "as you can see". Write entirely in %s.

YOU USE ONLY THE FACTS YOU ARE GIVEN. Do not add any name, date, number, person, event, legend, record or claim that is not in them - not even one you believe is true, and not as colour or as a "some say". No superlatives the facts do not state. Connecting sentences are fine; new information is not. A short script that is true beats a long one that is not.

CRITICAL TEXT-TO-SPEECH REQUIREMENTS:
- Write ALL numbers as words (e.g., "eighteen eighty-nine" not "1889", "three hundred" not "300")
- Write dates in full words (e.g., "the fifteenth of March, nineteen twenty-one" not "March 15, 1921")
- Write ordinals as words (e.g., "nineteenth century" not "19th century", "the third floor" not "the 3rd floor")
- Expand ALL abbreviations (e.g., "Saint" not "St.", "Doctor" not "Dr.", "Mister" not "Mr.")
- Spell out acronyms or explain them (e.g., "UNESCO, the United Nations cultural organization")
- Avoid special characters and symbols
- Use phonetic-friendly phrasing for foreign or difficult words`, language)

	var list strings.Builder
	for _, f := range facts {
		fmt.Fprintf(&list, "- %s\n", strings.TrimSpace(f.Fact))
	}

	userPrompt := fmt.Sprintf(`Write an audio guide script for "%s" from these facts, and only these:

%s
Requirements:
- Start with a short welcome mentioning the attraction name
- Use the facts in the order that tells the best story; you may leave a weak one out
- Use conversational, engaging language
- End with a short invitation to look around
- Keep it between %d and %d words
- Write the entire script in %s
- IMPORTANT: All numbers, dates, and abbreviations must be written as full words for text-to-speech`, attractionName, list.String(), t.minWords, t.maxWords, language)

	return chatCompletion(ctx, apiKey, chatRequest{
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		MaxTokens:   400,
		Temperature: 0.3,
	})
}

func chatCompletion(ctx context.Context, apiKey string, reqBody chatRequest) (string, error) {
	reqBody.Model = "gpt-4o-mini"

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", openAIEndpoint, bytes.NewReader(jsonBody))
	if err != nil {
		return "", err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", newProviderError("OpenAI", resp.StatusCode, body)
	}

	var chatResp chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", err
	}

	if len(chatResp.Choices) == 0 {
		return "", errors.New("no response from OpenAI")
	}

	return chatResp.Choices[0].Message.Content, nil
}

// ElevenLabs types
type voiceSettings struct {
	Stability       float64 `json:"stability"`
	SimilarityBoost float64 `json:"similarity_boost"`
	Style           float64 `json:"style"`
	UseSpeakerBoost bool    `json:"use_speaker_boost"`
}

type ttsRequest struct {
	Text          string        `json:"text"`
	ModelID       string        `json:"model_id"`
	VoiceSettings voiceSettings `json:"voice_settings"`
}

func generateAudioTTS(ctx context.Context, apiKey, script string) ([]byte, error) {
	reqBody := ttsRequest{
		Text:    script,
		ModelID: "eleven_multilingual_v2",
		VoiceSettings: voiceSettings{
			Stability:       0.5,
			SimilarityBoost: 0.75,
			Style:           0.0,
			UseSpeakerBoost: true,
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/%s", elevenLabsEndpoint, defaultVoiceID)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("xi-api-key", apiKey)
	req.Header.Set("Accept", "audio/mpeg")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, newProviderError("ElevenLabs", resp.StatusCode, body)
	}

	return io.ReadAll(resp.Body)
}
