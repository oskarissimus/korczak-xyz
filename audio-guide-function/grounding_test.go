package function

import (
	"encoding/json"
	"testing"
)

func TestVerifyFactsKeepsOnlyWhatItsSourceSays(t *testing.T) {
	sources := []source{
		{ID: "S1", Text: "Kościół zbudowano w XVII wieku. Fundatorem był  Jan  Kowalski, zwany „Starym”."},
		{ID: "S2", Text: "start_date: 1905\nhistoric: wayside_shrine"},
	}
	cases := []struct {
		name string
		f    fact
		keep bool
	}{
		{"verbatim", fact{"Founded by Jan Kowalski.", "S1", "Fundatorem był Jan Kowalski"}, true},
		{"quotes, case and spacing differ", fact{"Called the Old One.", "S1", `fundatorem był jan kowalski, zwany "Starym".`}, true},
		{"a century in Roman numerals", fact{"Built in the 17th century.", "S1", "Kościół zbudowano w XVII wieku."}, true},
		{"a year the quote does not have", fact{"Built in 1650.", "S1", "Kościół zbudowano w XVII wieku."}, false},
		{"the wrong century", fact{"Built in the 16th century.", "S1", "Kościół zbudowano w XVII wieku."}, false},
		{"a quote that is not there", fact{"Napoleon prayed here.", "S1", "Napoleon modlił się w tym kościele."}, false},
		{"a paraphrase", fact{"Founded by Kowalski.", "S1", "Kowalski ufundował kościół"}, false},
		{"a quote too short to show anything", fact{"It is old.", "S1", "wieku"}, false},
		{"a source that does not exist", fact{"Founded by Jan Kowalski.", "S7", "Fundatorem był Jan Kowalski"}, false},
		{"a quote from the other source", fact{"Founded by Jan Kowalski.", "S2", "Fundatorem był Jan Kowalski"}, false},
		{"an OSM tag", fact{"Put up in 1905.", "S2", "start_date: 1905"}, true},
	}
	for _, c := range cases {
		got := verifyFacts([]fact{c.f}, sources)
		if (len(got) == 1) != c.keep {
			t.Errorf("%s: kept=%v, want %v", c.name, len(got) == 1, c.keep)
		}
	}
}

func TestCitedURLsAreTheSourcesActuallyUsed(t *testing.T) {
	sources := []source{{ID: "S1", URL: "a"}, {ID: "S2", URL: "b"}, {ID: "S3", URL: ""}}
	got := citedURLs([]fact{{Source: "S2"}, {Source: "S3"}, {Source: "S2"}}, sources)
	if len(got) != 1 || got[0] != "b" {
		t.Errorf("%v", got)
	}
}

func TestNamesMatch(t *testing.T) {
	cases := []struct {
		name, title string
		want        bool
	}{
		{"Pałac Staszica", "Pałac Staszica", true},
		{"Ratusz", "Ratusz (Poznań)", true},
		{"Kościół św. Ojca Pio", "Kościół Świętego Ojca Pio w Warszawie", true},
		{"Kosciol Swietego Ojca Pio", "Kościół św. Ojca Pio", true},
		{"Pomnik", "Pomnik Mikołaja Kopernika", false},
		{"Ratusz", "Ratusz w Gdańsku", false},
		{"Kościół św. Ojca Pio", "Kabaty", false},
		{"Kościół św. Ojca Pio", "Ulica Rybałtów w Warszawie", false},
		{"Pomnik Kopernika", "Pomnik Mikołaja Kopernika w Warszawie", true},
		{"Pomnik Kopernika", "Pomnik Józefa Poniatowskiego", false},
	}
	for _, c := range cases {
		if got := namesMatch(c.name, c.title); got != c.want {
			t.Errorf("namesMatch(%q, %q) = %v", c.name, c.title, got)
		}
	}
}

func TestWikidataTimeKeepsItsPrecision(t *testing.T) {
	cases := map[string]string{
		`{"time":"+1820-00-00T00:00:00Z","precision":9}`:  "1820",
		`{"time":"+1820-05-00T00:00:00Z","precision":10}`: "1820-05",
		`{"time":"+1820-05-17T00:00:00Z","precision":11}`: "1820-05-17",
		`{"time":"+1820-00-00T00:00:00Z","precision":8}`:  "1820s",
		`{"time":"+1301-00-00T00:00:00Z","precision":7}`:  "14th century",
		`{"time":"-0500-00-00T00:00:00Z","precision":9}`:  "500 BCE",
		`{"time":"+1820-00-00T00:00:00Z","precision":6}`:  "",
	}
	for in, want := range cases {
		if got := wikidataTime(json.RawMessage(in)); got != want {
			t.Errorf("%s: %q, want %q", in, got, want)
		}
	}
}

func TestLanguageCode(t *testing.T) {
	for in, want := range map[string]string{"Polski": "pl", "English": "en", "Deutsch": "de", "de": "de", "Cymraeg": "", "Bavarian German": ""} {
		if got := languageCode(in); got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
}

func TestWikipediaTagCannotNameAnotherHost(t *testing.T) {
	for _, v := range []string{"evil.example.com/x:Title", "pl.evil:Title", ":Title", "Title"} {
		if lang, _ := parseWikipediaTag(v); lang != "" {
			t.Errorf("%q gave lang %q", v, lang)
		}
	}
	if lang, title := parseWikipediaTag("pl:Zamek Królewski w Warszawie"); lang != "pl" || title != "Zamek Królewski w Warszawie" {
		t.Errorf("%q %q", lang, title)
	}
}
