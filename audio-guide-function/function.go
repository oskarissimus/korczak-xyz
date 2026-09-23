// Package function is the audio guide's backend: the one request on /apps/audio-guide/ that costs
// money.
//
// A name, a category and a pair of coordinates come in; an MP3 goes out. In between it
// reverse-geocodes the coordinates with Nominatim, asks gpt-4o-mini for facts about the place,
// asks it again for a script written for a speech synthesiser, and has ElevenLabs read that
// script aloud.
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
}

// Location represents reverse geocoded location data
type Location struct {
	Country      string
	City         string
	Street       string
	Neighborhood string
	Valid        bool // false if geocoding failed
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
		Country       string `json:"country"`
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

	return nil
}

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
		Country: nomResp.Address.Country,
		Valid:   true,
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

	return loc
}

// GenerateAudio is the Cloud Function entry point
func GenerateAudio(w http.ResponseWriter, r *http.Request) {
	// CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, "+openAIKeyHeader+", "+elevenLabsKeyHeader)
	w.Header().Set("Access-Control-Expose-Headers", "X-Location-Warning")
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

	// Reverse geocode to get location context
	location := reverseGeocode(ctx, attraction.Latitude, attraction.Longitude)

	// Set warning header if geocoding failed
	if !location.Valid {
		w.Header().Set("X-Location-Warning", "Location details unavailable - information may be less accurate")
	}

	// Generate facts
	facts, err := generateFacts(ctx, openAIKey, &attraction, &location)
	if err != nil {
		log.Printf("generate-audio: facts: %v", err)
		writeError(w, failureStatus(err), "Failed to generate facts: "+providerMessage(err))
		return
	}

	// Generate script
	script, err := generateScript(ctx, openAIKey, attraction.Name, facts, attraction.Language)
	if err != nil {
		log.Printf("generate-audio: script: %v", err)
		writeError(w, failureStatus(err), "Failed to generate script: "+providerMessage(err))
		return
	}

	// Generate audio
	audio, err := generateAudioTTS(ctx, elevenLabsKey, script)
	if err != nil {
		log.Printf("generate-audio: audio: %v", err)
		writeError(w, failureStatus(err), "Failed to generate audio: "+providerMessage(err))
		return
	}

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
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// OpenAI types
type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	MaxTokens   int           `json:"max_tokens"`
	Temperature float64       `json:"temperature"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func generateFacts(ctx context.Context, apiKey string, attraction *Attraction, location *Location) (string, error) {
	systemPrompt := fmt.Sprintf("You are a knowledgeable tour guide with expertise in history, architecture, and culture. Provide accurate, engaging facts suitable for tourists. Write your response entirely in %s.", attraction.Language)

	// Build location string
	var locationParts []string
	if location.Valid {
		if location.Street != "" {
			locationParts = append(locationParts, location.Street)
		}
		if location.Neighborhood != "" {
			locationParts = append(locationParts, location.Neighborhood)
		}
		if location.City != "" {
			locationParts = append(locationParts, location.City)
		}
		if location.Country != "" {
			locationParts = append(locationParts, location.Country)
		}
	}

	var locationInfo string
	if len(locationParts) > 0 {
		locationInfo = fmt.Sprintf("Location: %s\n", strings.Join(locationParts, ", "))
	} else {
		locationInfo = fmt.Sprintf("Coordinates: %f, %f\n", attraction.Latitude, attraction.Longitude)
	}

	userPrompt := fmt.Sprintf(`Provide 3-5 truly fascinating facts about "%s" (%s).

%s
Focus on:
- Surprising or little-known facts that most visitors wouldn't know
- Unique historical events or stories connected to this place
- Interesting architectural or design details with specific context
- Cultural significance and local traditions
- Notable people or events associated with this location

Avoid:
- Generic information easily found in any guidebook
- Obvious facts about the category (e.g., "this museum has art")
- Vague statements without specific details

Each fact should make the visitor say "I didn't know that!" Be concise but engaging. Each fact should be 1-2 sentences. Write entirely in %s.`, attraction.Name, attraction.Category, locationInfo, attraction.Language)

	return chatCompletion(ctx, apiKey, systemPrompt, userPrompt, 500, 0.7)
}

func generateScript(ctx context.Context, apiKey, attractionName, facts, language string) (string, error) {
	systemPrompt := fmt.Sprintf(`You are a professional audio guide scriptwriter. Write natural, conversational scripts for text-to-speech narration. Avoid visual references like "as you can see". Write entirely in %s.

CRITICAL TEXT-TO-SPEECH REQUIREMENTS:
- Write ALL numbers as words (e.g., "eighteen eighty-nine" not "1889", "three hundred" not "300")
- Write dates in full words (e.g., "the fifteenth of March, nineteen twenty-one" not "March 15, 1921")
- Write ordinals as words (e.g., "nineteenth century" not "19th century", "the third floor" not "the 3rd floor")
- Expand ALL abbreviations (e.g., "Saint" not "St.", "Doctor" not "Dr.", "Mister" not "Mr.")
- Spell out acronyms or explain them (e.g., "UNESCO, the United Nations cultural organization")
- Avoid special characters and symbols
- Use phonetic-friendly phrasing for foreign or difficult words`, language)

	userPrompt := fmt.Sprintf(`Write a 30-60 second audio guide script for "%s" based on these facts:

%s

Requirements:
- Start with a warm welcome mentioning the attraction name
- Share 2-3 of the most interesting facts naturally
- Use conversational, engaging language
- End with an invitation to explore or take photos
- Keep it between 80-150 words for optimal audio length
- Write the entire script in %s
- IMPORTANT: All numbers, dates, and abbreviations must be written as full words for text-to-speech`, attractionName, facts, language)

	return chatCompletion(ctx, apiKey, systemPrompt, userPrompt, 300, 0.8)
}

func chatCompletion(ctx context.Context, apiKey, systemPrompt, userPrompt string, maxTokens int, temperature float64) (string, error) {
	reqBody := chatRequest{
		Model: "gpt-4o-mini",
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		MaxTokens:   maxTokens,
		Temperature: temperature,
	}

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
