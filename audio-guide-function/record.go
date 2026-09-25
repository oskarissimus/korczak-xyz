package function

// What the guide said and what it said it from, kept for fact-checking later.
//
// grounding.go checks every quote the moment a guide is made, but that check can only catch a
// quote that is not in its source. It cannot tell whether a fact that passed still says what the
// quote says, whether the script then stayed on the facts it was given, or which true facts were
// thrown away. Those are questions for somebody reading afterwards, with everything the model saw
// in front of them - so every tap the model answers leaves one JSON object in a bucket: the place,
// the sources in full, every fact the model proposed, the ones that survived, and the script. A
// tap with no sources at all leaves one too, with the place and nothing else, so a walk's records
// name every place that was tapped and not only the ones that could be narrated.
//
// It is a record, not a cache. Nothing ever reads it back into a guide (see "What is not kept" in
// .claude/rules/audio-guide.md), there is no audio in it, and there are no keys in it: the
// caller's keys never reach this file.
//
// Writing it never fails a guide. The reader has already paid for the narration by the time it is
// written, so a bucket that refuses is logged and nothing more. With no bucket configured -
// the tests, a local run - nothing is written at all.

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Variables rather than constants for the same reason as the provider endpoints in function.go.
// The deploy step in firebase-deploy.yml sets both environment variables.
var (
	recordsBucket  = os.Getenv("GUIDE_RECORDS_BUCKET")
	release        = os.Getenv("GUIDE_RELEASE")
	storageUpload  = "https://storage.googleapis.com/upload/storage/v1/b/%s/o"
	metadataToken  = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
	recordDeadline = 10 * time.Second
)

// guideRecord is one tap, as the object written for it. The field names are the ones an analysis
// script will read, so rename them only with a new Version.
type guideRecord struct {
	Version int       `json:"version"`
	Time    time.Time `json:"time"`
	// The commit that deployed this function, so a record can be read against the prompts that
	// produced it.
	Release string `json:"release,omitempty"`
	// narrated, no_sources, no_verified_facts, script_failed or audio_failed.
	Outcome string `json:"outcome"`
	Error   string `json:"error,omitempty"`

	Place    placeRecord `json:"place"`
	Location Location    `json:"location"`
	Sources  []source    `json:"sources"`
	// Everything the facts call answered, before verifyFacts: a fact here and not in
	// VerifiedFacts is one the quote check dropped.
	ProposedFacts []fact `json:"proposedFacts"`
	VerifiedFacts []fact `json:"verifiedFacts"`
	Tier          string `json:"tier,omitempty"`
	Script        string `json:"script,omitempty"`
	// Milliseconds per stage and in total, as in the Server-Timing header (timing.go). The total
	// stops where the handler did, before this record is written.
	Timings map[string]int64 `json:"timings,omitempty"`
}

type placeRecord struct {
	Name      string            `json:"name"`
	Category  string            `json:"category"`
	Latitude  float64           `json:"latitude"`
	Longitude float64           `json:"longitude"`
	Language  string            `json:"language"`
	OSM       string            `json:"osm,omitempty"`
	Tags      map[string]string `json:"tags,omitempty"`
}

func newGuideRecord(a *Attraction, location Location, sources []source, proposed, verified []fact) *guideRecord {
	if sources == nil {
		sources = []source{}
	}
	if proposed == nil {
		proposed = []fact{}
	}
	if verified == nil {
		verified = []fact{}
	}
	return &guideRecord{
		Version: 1,
		Time:    time.Now().UTC(),
		Release: release,
		Place: placeRecord{
			Name: a.Name, Category: a.Category, Latitude: a.Latitude, Longitude: a.Longitude,
			Language: a.Language, OSM: a.OSM, Tags: a.Tags,
		},
		Location:      location,
		Sources:       sources,
		ProposedFacts: proposed,
		VerifiedFacts: verified,
	}
}

// objectName files a record by day, then by time and place: `2026/09/24/143012-way-123-1a2b3c4d.json`.
// A listing of one day's prefix is then that day's guides in the order they were made, and the
// random tail keeps two taps on one pin in the same second apart.
func (r *guideRecord) objectName() string {
	place := strings.ReplaceAll(r.Place.OSM, "/", "-")
	if place == "" {
		place = "unknown"
	}
	var tail [4]byte
	rand.Read(tail[:])
	return fmt.Sprintf("%s-%s-%s.json", r.Time.Format("2006/01/02/150405"), place, hex.EncodeToString(tail[:]))
}

// saveGuideRecord writes the record, and only logs if it cannot. It is deferred by the handler, so
// it runs once the answer has been written - on its own deadline rather than the request's, which
// may be nearly spent after twenty seconds of providers.
func saveGuideRecord(ctx context.Context, r *guideRecord) {
	if recordsBucket == "" || r == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), recordDeadline)
	defer cancel()
	name := r.objectName()
	if err := uploadRecord(ctx, name, r); err != nil {
		log.Printf("generate-audio: record %s: %v", name, err)
	}
}

func uploadRecord(ctx context.Context, name string, r *guideRecord) error {
	body, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	token, err := accessToken(ctx)
	if err != nil {
		return fmt.Errorf("token: %w", err)
	}

	// ifGenerationMatch=0: create only. The function's identity may create objects in this bucket
	// and nothing else, so an overwrite would be refused anyway - this says so in the request.
	endpoint := fmt.Sprintf(storageUpload, url.PathEscape(recordsBucket)) +
		"?uploadType=media&ifGenerationMatch=0&name=" + url.QueryEscape(name)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		return fmt.Errorf("storage %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return nil
}

// accessToken is the function's own identity, from the metadata server - the runtime service
// account, which terraform/audio-guide.tf lets create objects in the records bucket. No key file
// and no client library: one GET, the same as every other request this package makes.
func accessToken(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, metadataToken, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Metadata-Flavor", "Google")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("metadata %d", resp.StatusCode)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", err
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("metadata returned no token")
	}
	return tok.AccessToken, nil
}
