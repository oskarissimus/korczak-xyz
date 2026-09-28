package function

import (
	"context"
	"crypto/tls"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const grazynaPage = `<!doctype html><html><head><title>Willa Grażyna – Visit Konstancin</title>
<script>var tracking = "Willa Grażyna zbudowana w 1066";</script></head><body>
<nav>Strona główna | Zabytki | Kontakt | Konstancin-Jeziorna</nav>
<header>Serwis turystyczny gminy</header>
<main><h1>Willa „Grażyna”, ul. Mickiewicza 4</h1>
<p>Willa Grażyna została wzniesiona w 1911 roku według projektu Józefa Gałęzowskiego dla rodziny Lilpopów.</p>
<p>Budynek w stylu dworkowym stoi w parku zdrojowym w Konstancinie. W okresie międzywojennym mieszkał tu pisarz Stefan Żeromski.</p>
</main><footer>© Gmina Konstancin-Jeziorna 2026</footer></body></html>`

const grazynaElsewherePage = `<html><head><title>Pensjonat Grażyna w Zakopanem</title></head><body>
<p>Willa Grażyna w Zakopanem to pensjonat przy Krupówkach, zbudowany w 1930 roku przez miejscowego cieślę. Oferujemy pokoje z widokiem na Giewont i śniadania w cenie. Zapraszamy przez cały rok, także na narty i wycieczki w Tatry z przewodnikiem.</p>
</body></html>`

func grazynaProviders(t *testing.T) *fakeProviders {
	f := newFakeProviders(t)
	f.nominatim = func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"address":{"road":"Adama Mickiewicza","town":"Konstancin-Jeziorna","country":"Polska","country_code":"pl"}}`))
	}
	f.pages["grazyna"] = grazynaPage
	f.pages["zakopane"] = grazynaElsewherePage
	f.factsJSON = `{"facts":[
		{"fact":"Wzniesiona w 1911 roku.","source":"S1","evidence":"Willa Grażyna została wzniesiona w 1911 roku według projektu Józefa Gałęzowskiego"},
		{"fact":"Zbudowana w 1066 roku.","source":"S1","evidence":"Willa Grażyna zbudowana w 1066"}
	]}`
	return f
}

const grazynaBody = `{"name":"Willa Grażyna","category":"attraction","latitude":52.08,"longitude":21.11,` +
	`"language":"Polski","osm":"way/438910239","tags":{"historic":"yes","tourism":"attraction"}}`

func TestAPlaceWithoutWikipediaIsReadFromTheWebPagesItself(t *testing.T) {
	f := grazynaProviders(t)
	f.searchURLs = []string{
		"https://pl.wikipedia.org/wiki/Konstancin-Jeziorna",
		f.srvURL + "/page/zakopane",
		f.srvURL + "/page/grazyna?utm_source=chatgpt.com",
		f.srvURL + "/page/missing",
	}
	rec := post(grazynaBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if f.searchCalls != 2 {
		t.Errorf("%d searches, want the name with the town and with the street", f.searchCalls)
	}
	for _, want := range []string{`"tool_choice":"required"`, `"type":"web_search"`, `"include":["web_search_call.action.sources"]`} {
		if !strings.Contains(f.searchBody, want) {
			t.Errorf("the search request lacks %s: %s", want, f.searchBody)
		}
	}
	if !strings.Contains(f.searchBody, `"country":"PL"`) || !strings.Contains(f.searchBody, "Konstancin-Jeziorna") {
		t.Errorf("the search was not told where the place is: %s", f.searchBody)
	}
	if got, want := rec.Header().Get("X-Guide-Sources"), f.srvURL+"/page/grazyna"; got != want {
		t.Errorf("sources %q, want the page the kept fact came from, %q", got, want)
	}
	if !strings.Contains(f.factsPrompt, `Web page "Willa Grażyna – Visit Konstancin"`) {
		t.Error("the page's title is not in its label")
	}
	if !strings.Contains(f.factsPrompt, "Józefa Gałęzowskiego") {
		t.Error("the page's text never reached the facts prompt")
	}
	for _, leaked := range []string{"Krupówkach", "tracking", "Strona główna", "© Gmina"} {
		if strings.Contains(f.factsPrompt, leaked) {
			t.Errorf("%q reached the facts prompt", leaked)
		}
	}
	// The year from the page's script is not in the page's text, so the fact quoting it is dropped.
	if strings.Contains(f.scriptPrompt, "1066") {
		t.Error("a fact quoted from the page's script survived")
	}
}

func TestAPlaceWithAWikipediaArticleIsNotSearched(t *testing.T) {
	f := newFakeProviders(t)
	if rec := post(validBody); rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if f.searchCalls != 0 {
		t.Errorf("%d searches for a place with an article", f.searchCalls)
	}
}

func TestAFailedSearchIsAMissingSource(t *testing.T) {
	f := grazynaProviders(t)
	rec := postWithKeys(grazynaBody, "sk-wrong", "el-test")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if f.searchCalls != 2 || f.chatCalls != 0 {
		t.Errorf("%d searches, %d chat calls", f.searchCalls, f.chatCalls)
	}
}

func TestPrivateAddressesAreNeverFetched(t *testing.T) {
	for _, addr := range []string{
		"169.254.169.254:80", "127.0.0.1:443", "10.1.2.3:443", "192.168.0.1:80", "172.16.0.1:80",
		"100.64.0.1:80", "0.0.0.0:80", "[::1]:443", "[fd00::1]:443", "[fe80::1]:80",
	} {
		if publicOnly("tcp", addr, nil) == nil {
			t.Errorf("%s allowed", addr)
		}
	}
	for _, addr := range []string{"8.8.8.8:443", "[2001:4860:4860::8888]:443"} {
		if err := publicOnly("tcp", addr, nil); err != nil {
			t.Errorf("%s refused: %v", addr, err)
		}
	}
}

func TestCandidateURLs(t *testing.T) {
	got := candidateURLs([]string{
		"https://visitkonstancin.pl/zabytki/willa-grazyna/?utm_source=chatgpt.com",
		"https://visitkonstancin.pl/zabytki/willa-grazyna/",
		"https://pl.m.wikipedia.org/wiki/Willa",
		"https://www.facebook.com/konstancin",
		"ftp://example.com/x",
		"https://zabytek.pl/pl/obiekty/konstancin-willa-grazyna.",
	})
	want := []string{
		"https://visitkonstancin.pl/zabytki/willa-grazyna/",
		"https://zabytek.pl/pl/obiekty/konstancin-willa-grazyna",
	}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("got %q", got)
	}
}

func TestAboutPlaceNeedsTheNameAndTheTown(t *testing.T) {
	a := &Attraction{Name: "Dworzec Kolejki Wilanowskiej Klarysew"}
	loc := &Location{Valid: true, City: "Konstancin-Jeziorna"}
	text := "Menu\nAktualności\nDworzec kolejki wilanowskiej w Klarysewie zbudowano w 1936 roku. " +
		"Dziś w budynku dworca w Konstancinie działa biblioteka."
	if got := aboutPlace("", text, a, loc); !strings.Contains(got, "1936") {
		t.Errorf("an inflected mention was not recognised: %q", got)
	}
	if aboutPlace("", strings.ReplaceAll(text, "Konstancinie", "Piasecznie"), a, loc) != "" {
		t.Error("a page that never names the town was let in")
	}
	if aboutPlace("", "Dworzec w Konstancinie zbudowano w 1936 roku.", a, loc) != "" {
		t.Error("a page naming only part of the place was let in")
	}
	// A small site names its town in the title and the footer only.
	w := &Attraction{Name: "Willa Wierzbówka"}
	body := "Willa Wierzbówka, ul. Matejki 10\nWybudowana 1904 roku na zlecenie Stanisława Wierzbowskiego w modnym nurcie Arts and Crafts, w stylu nawiązującym do architektury elżbietańskiej."
	if aboutPlace("Willa Wierzbówka, ul. Matejki 10 | Konstancin-Jeziorna", body, w, loc) == "" {
		t.Error("the town in the title did not count")
	}
}

// A site with somebody else's certificate is read over plain http, which the retry relies on
// being told apart by type rather than by message.
func TestABadCertificateIsRecognisedForTheHTTPRetry(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	prev := allowPrivateFetch
	allowPrivateFetch = true
	defer func() { allowPrivateFetch = prev }()
	_, err := getWebPage(context.Background(), srv.URL)
	var certErr *tls.CertificateVerificationError
	if !errors.As(err, &certErr) {
		t.Fatalf("error %v (%T) is not a certificate verification error", err, err)
	}
}

func TestASearchModelTheKeyCannotUseFallsBackToTheOlderOne(t *testing.T) {
	f := grazynaProviders(t)
	f.searchRefuses = primarySearch.model
	f.searchURLs = []string{f.srvURL + "/page/grazyna"}
	if rec := post(grazynaBody); rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if f.searchCalls != 4 || !strings.Contains(f.searchBody, `"model":"`+fallbackSearch.model+`"`) {
		t.Errorf("%d searches, last %s", f.searchCalls, f.searchBody)
	}
}

// The model said it found nothing; the search had returned the page. The page is read anyway.
func TestTheSearchsOwnResultsAreReadWhenTheModelCitesNothing(t *testing.T) {
	f := grazynaProviders(t)
	f.searchResults = []string{f.srvURL + "/page/zakopane", f.srvURL + "/page/grazyna"}
	rec := post(grazynaBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if got, want := rec.Header().Get("X-Guide-Sources"), f.srvURL+"/page/grazyna"; got != want {
		t.Errorf("sources %q, want %q", got, want)
	}
}

func TestSearchQueriesAreWhatAPersonWouldType(t *testing.T) {
	a := &Attraction{Name: "Willa Wierzbówka"}
	loc := &Location{Valid: true, City: "Konstancin-Jeziorna", Street: "Jana Matejki"}
	got := strings.Join(searchQueries(a, loc), " | ")
	if want := "Willa Wierzbówka Konstancin-Jeziorna | Willa Wierzbówka Jana Matejki Konstancin-Jeziorna"; got != want {
		t.Errorf("got %q", got)
	}
}
