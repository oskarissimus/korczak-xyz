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

// fakeStorage stands up the metadata server and the GCS upload endpoint, points the package at
// them and names a bucket, so the handler writes records.
type fakeStorage struct {
	mu      sync.Mutex
	status  int
	names   []string
	records []guideRecord
	raw     []string
	auth    []string
}

func newFakeStorage(t *testing.T) *fakeStorage {
	t.Helper()
	s := &fakeStorage{status: http.StatusOK}
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Metadata-Flavor") != "Google" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		io.WriteString(w, `{"access_token":"ya29.test","expires_in":3599,"token_type":"Bearer"}`)
	})
	mux.HandleFunc("/upload/{bucket}/o", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		defer s.mu.Unlock()
		if r.PathValue("bucket") != "records-test" || r.URL.Query().Get("ifGenerationMatch") != "0" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var rec guideRecord
		json.Unmarshal(body, &rec)
		s.names = append(s.names, r.URL.Query().Get("name"))
		s.records = append(s.records, rec)
		s.raw = append(s.raw, string(body))
		s.auth = append(s.auth, r.Header.Get("Authorization"))
		w.WriteHeader(s.status)
		io.WriteString(w, `{}`)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	prevBucket, prevUpload, prevToken := recordsBucket, storageUpload, metadataToken
	recordsBucket, storageUpload, metadataToken = "records-test", srv.URL+"/upload/%s/o", srv.URL+"/token"
	t.Cleanup(func() { recordsBucket, storageUpload, metadataToken = prevBucket, prevUpload, prevToken })
	return s
}

func TestANarratedGuideLeavesItsScriptAndSourcesBehind(t *testing.T) {
	newFakeProviders(t)
	s := newFakeStorage(t)
	if rec := post(validBody); rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if len(s.records) != 1 {
		t.Fatalf("%d records, want 1", len(s.records))
	}
	r := s.records[0]
	if r.Outcome != "narrated" || r.Script != "Witamy przy pałacu." || r.Tier != "full" {
		t.Errorf("outcome %q, tier %q, script %q", r.Outcome, r.Tier, r.Script)
	}
	if r.Place.Name != "Pałac Staszica" || r.Place.OSM != "way/123" || !r.Location.Valid {
		t.Errorf("place %+v, location %+v", r.Place, r.Location)
	}
	var article *source
	for i := range r.Sources {
		if strings.Contains(r.Sources[i].URL, "wikipedia.org") {
			article = &r.Sources[i]
		}
	}
	if article == nil || article.Text != staszicText {
		t.Errorf("the Wikipedia article is not in the record in full: %+v", r.Sources)
	}
	if len(r.ProposedFacts) != 3 || len(r.VerifiedFacts) != 3 {
		t.Errorf("%d proposed, %d verified facts", len(r.ProposedFacts), len(r.VerifiedFacts))
	}
	if !strings.HasPrefix(s.names[0], r.Time.Format("2006/01/02/")) || !strings.Contains(s.names[0], "-way-123-") {
		t.Errorf("object name %q", s.names[0])
	}
	if s.auth[0] != "Bearer ya29.test" {
		t.Errorf("authorization %q", s.auth[0])
	}
	// The caller's keys are theirs: nothing about them may be written down.
	if strings.Contains(s.raw[0], "sk-test") || strings.Contains(s.raw[0], "el-test") {
		t.Error("a key reached the record")
	}
}

func TestDroppedFactsAreRecordedToo(t *testing.T) {
	f := newFakeProviders(t)
	s := newFakeStorage(t)
	f.factsJSON = `{"facts":[{"fact":"Napoleon slept here.","source":"S1","evidence":"Napoleon spędził tu noc."}]}`
	if rec := post(validBody); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if len(s.records) != 1 {
		t.Fatalf("%d records, want 1", len(s.records))
	}
	r := s.records[0]
	if r.Outcome != "no_verified_facts" || len(r.ProposedFacts) != 1 || len(r.VerifiedFacts) != 0 || r.Script != "" {
		t.Errorf("record %+v", r)
	}
}

func TestNoSourcesIsRecordedWithoutSources(t *testing.T) {
	f := newFakeProviders(t)
	s := newFakeStorage(t)
	post(`{"name":"Kapliczka","category":"historic","latitude":52.2,"longitude":21.0,"language":"Polski","osm":"node/7"}`)
	if len(s.records) != 1 {
		t.Fatalf("%d records, want 1", len(s.records))
	}
	r := s.records[0]
	if r.Outcome != "no_sources" || r.Place.Name != "Kapliczka" || r.Place.OSM != "node/7" ||
		r.Sources == nil || len(r.Sources) != 0 || len(r.ProposedFacts) != 0 || r.Script != "" {
		t.Errorf("record %+v", r)
	}
	if f.chatCalls != 0 || f.ttsCalls != 0 {
		t.Errorf("%d chat and %d TTS calls for a place nothing is known about", f.chatCalls, f.ttsCalls)
	}
}

func TestARefusedRecordDoesNotFailTheGuide(t *testing.T) {
	newFakeProviders(t)
	s := newFakeStorage(t)
	s.status = http.StatusForbidden
	rec := post(validBody)
	if rec.Code != http.StatusOK || rec.Body.String() != "ID3-fake-mp3" {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestNoBucketMeansNothingIsWritten(t *testing.T) {
	newFakeProviders(t)
	s := newFakeStorage(t)
	recordsBucket = ""
	if rec := post(validBody); rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if len(s.records) != 0 {
		t.Errorf("%d records with no bucket configured", len(s.records))
	}
}
