package function

// The web, for places Wikipedia has never heard of.
//
// Most of what a walk passes is too small for an encyclopaedia - a villa in Konstancin, a
// suburban station of a narrow-gauge line, a memorial stone - and what is written about it is on
// the gmina's website, a heritage register or a local history portal. Until late Sep 2026 every
// one of those taps ended in no_sources. So when no Wikipedia article is found, the web is
// searched - with OpenAI's web search, on the reader's own key, so the function still holds no
// key of its own - and the pages it names are fetched and read **here**, not summarised by the
// search model.
//
// That last part is the whole design. A search model's answer is a paraphrase with links, and a
// paraphrase cannot be checked: the facts' quotes are verified against the text of the source they
// cite (grounding.go), so the source has to be the page itself. The search is used for one thing
// only, finding URLs; the page is then downloaded, reduced to text, and must name the place - and
// the town, when the town is known - before it is let in. A page about a namesake elsewhere is
// the failure this guards against, as it is for geosearch.
//
// Fetching URLs a model chose is fetching URLs a stranger could influence, from inside GCP, next
// to the metadata server that hands out this function's identity. So the dialer refuses every
// address that is not a public unicast one, after resolution, on every redirect.

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/net/html"
)

// A variable so the tests can point it at httptest, as with the other providers.
var openAIResponsesEndpoint = "https://api.openai.com/v1/responses"

const (
	maxWebPages = 3
	// URLs fetched per search: the model's picks first, then the search's own results.
	maxCandidates   = 8
	webPageChars    = 5000
	webPageMaxBytes = 2 << 20
	webFetchTimeout = 8 * time.Second
	// A page shorter than this once reduced to text is a cookie wall or an index, not a source.
	minWebPageChars = 200
)

// skippedHosts are never read as sources: Wikipedia is read through its API already (and a
// search that lands there means gatherSources missed nothing), and the social networks answer a
// fetch with a login page. Matched on the host and every parent domain.
var skippedHosts = map[string]bool{
	"wikipedia.org": true, "wikimedia.org": true, "wikidata.org": true,
	"facebook.com": true, "instagram.com": true, "tiktok.com": true, "x.com": true,
	"twitter.com": true, "youtube.com": true, "pinterest.com": true, "linkedin.com": true,
	"google.com": true, "maps.app.goo.gl": true, "openstreetmap.org": true,
	// Street directories: they name every street and landmark in a town and say nothing about any.
	"sprawdzadres.pl": true,
}

func skippedHost(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	for {
		if skippedHosts[host] {
			return true
		}
		_, rest, ok := strings.Cut(host, ".")
		if !ok {
			return false
		}
		host = rest
	}
}

// webSources searches for pages about the place and returns the ones that pass, as sources.
func webSources(ctx context.Context, apiKey string, a *Attraction, loc *Location) []source {
	urls, answer, err := searchURLs(ctx, apiKey, primarySearch, a, loc)
	var pe *providerError
	if errors.As(err, &pe) && (pe.status == http.StatusBadRequest || pe.status == http.StatusNotFound) {
		log.Printf("generate-audio: web search on %s/%s: %v; retrying on %s/%s", primarySearch.model, primarySearch.tool, err, fallbackSearch.model, fallbackSearch.tool)
		urls, answer, err = searchURLs(ctx, apiKey, fallbackSearch, a, loc)
	}
	if err != nil {
		// Not the reader's problem unless it is their key, and then the facts call says so.
		log.Printf("generate-audio: web search: %v", err)
		return nil
	}

	pages := make([]*source, len(urls))
	verdicts := make([]string, len(urls))
	var wg sync.WaitGroup
	for i, u := range urls {
		wg.Add(1)
		go func() {
			defer wg.Done()
			pages[i], verdicts[i] = fetchWebPage(ctx, u, a, loc)
		}()
	}
	wg.Wait()
	// Which pages the search named and what became of each: the one thing a no_sources after a
	// search cannot otherwise tell apart - nothing found, or found and refused, and why.
	var report []string
	for i, u := range urls {
		report = append(report, u+" ("+verdicts[i]+")")
	}
	if len(urls) == 0 {
		if r := []rune(strings.Join(strings.Fields(answer), " ")); len(r) > 300 {
			answer = string(r[:300])
		}
		report = append(report, fmt.Sprintf("answer %q", answer))
	}
	log.Printf("generate-audio: web search for %q: %d urls: %s", a.Name, len(urls), strings.Join(report, ", "))

	var out []source
	for _, p := range pages {
		if p != nil && len(out) < maxWebPages {
			out = append(out, *p)
		}
	}
	noteWebSearch(ctx, len(urls), len(out))
	return out
}

type responsesRequest struct {
	Model           string           `json:"model"`
	Input           string           `json:"input"`
	Tools           []map[string]any `json:"tools"`
	ToolChoice      any              `json:"tool_choice,omitempty"`
	Include         []string         `json:"include,omitempty"`
	MaxOutputTokens int              `json:"max_output_tokens"`
	Store           bool             `json:"store"`
}

type responsesResponse struct {
	Output []struct {
		Type string `json:"type"`
		// A web_search_call's search, with every result it returned when asked for them.
		Action *struct {
			Sources []struct {
				URL string `json:"url"`
			} `json:"sources"`
		} `json:"action"`
		Content []struct {
			Type        string `json:"type"`
			Text        string `json:"text"`
			Annotations []struct {
				Type string `json:"type"`
				URL  string `json:"url"`
			} `json:"annotations"`
		} `json:"content"`
	} `json:"output"`
}

// searchSetup is one way of asking OpenAI to search.
type searchSetup struct {
	model, tool string
	toolChoice  any
	include     []string
}

var (
	// The search's own result list, not the model's opinion of it. On Willa Wierzbówka the model
	// answered three times that nothing is written about the villa - on gpt-4o-mini and on
	// gpt-4.1-mini, forced to search - while an ordinary search's first page has visitkonstancin.pl's
	// page on it. The model judges a two-sentence page "not detailed" and leaves it out; the
	// checks here would have let it in. So `web_search` (not the preview) with
	// `web_search_call.action.sources`: every URL the search returned comes back, whatever the
	// model then writes, and aboutPlace decides.
	primarySearch = searchSetup{
		model: "gpt-4.1-mini", tool: "web_search", toolChoice: "required",
		include: []string{"web_search_call.action.sources"},
	}
	// For a key or a project that cannot use the above: what shipped first, which searches worse
	// but searches.
	fallbackSearch = searchSetup{
		model: "gpt-4o-mini", tool: "web_search_preview",
		toolChoice: map[string]any{"type": "web_search_preview"},
	}
)

var urlInTextRE = regexp.MustCompile(`https?://[^\s<>()\[\]"']+`)

// searchURLs asks OpenAI to search for this place and returns the URLs: the citations the model
// attached, any it wrote out, then every result the search itself returned. Nothing the model
// says about the place is kept.
//
// The answer's text comes back too, for the log line when no URL does: "found nothing" and "never
// searched" read the same from the outside.
func searchURLs(ctx context.Context, apiKey string, setup searchSetup, a *Attraction, loc *Location) ([]string, string, error) {
	// Medium, not low: on low, Willa Wierzbówka came back with no URL at all.
	tool := map[string]any{"type": setup.tool, "search_context_size": "medium"}
	if loc.Valid && len(loc.CountryCode) == 2 {
		ul := map[string]any{"type": "approximate", "country": strings.ToUpper(loc.CountryCode)}
		if loc.City != "" {
			ul["city"] = loc.City
		}
		tool["user_location"] = ul
	}

	prompt := fmt.Sprintf(`Search the web for pages about this specific place:

Name: %s
Kind: %s
%s
Search for: %s
Search in the local language. Useful pages are a municipal or tourist-office page, a heritage register, a local history site, a guidebook - even a short one.

List the URL of every result that is about exactly this place, one per line, best first - even if it says only a sentence or two about it. Not Wikipedia, not social media, not a different place with a similar name. Only if no result mentions this place at all, answer NONE.`,
		a.Name, a.Category, describeLocation(a, loc), searchQuery(a, loc))

	body, err := json.Marshal(responsesRequest{
		Model:           setup.model,
		Input:           prompt,
		Tools:           []map[string]any{tool},
		ToolChoice:      setup.toolChoice,
		Include:         setup.include,
		MaxOutputTokens: 600,
		Store:           false,
	})
	if err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, openAIResponsesEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, "", newProviderError("OpenAI", resp.StatusCode, b)
	}
	var out responsesResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, "", err
	}

	var chosen, results []string
	var answer strings.Builder
	for _, item := range out.Output {
		if item.Action != nil {
			for _, src := range item.Action.Sources {
				results = append(results, src.URL)
			}
		}
		for _, c := range item.Content {
			for _, an := range c.Annotations {
				if an.Type == "url_citation" {
					chosen = append(chosen, an.URL)
				}
			}
			chosen = append(chosen, urlInTextRE.FindAllString(c.Text, -1)...)
			answer.WriteString(c.Text)
		}
	}
	return candidateURLs(append(chosen, results...)), answer.String(), nil
}

// searchQuery is what a person would type: the name and the town.
func searchQuery(a *Attraction, loc *Location) string {
	if loc.Valid && loc.City != "" {
		return a.Name + " " + loc.City
	}
	return a.Name
}

// candidateURLs cleans, de-duplicates and filters what the search named, keeping its order.
func candidateURLs(raw []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, r := range raw {
		u, err := url.Parse(strings.TrimRight(r, ".,;:"))
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || skippedHost(u.Hostname()) {
			continue
		}
		// The search tags every link it cites; the page is the same without it.
		q := u.Query()
		for k := range q {
			if strings.HasPrefix(k, "utm_") {
				q.Del(k)
			}
		}
		u.RawQuery = q.Encode()
		u.Fragment = ""
		s := u.String()
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
		if len(out) == maxCandidates {
			break
		}
	}
	return out
}

// --- Fetching ---------------------------------------------------------------------------------

// allowPrivateFetch is for the tests, whose httptest servers are on 127.0.0.1. Nothing in the
// deployed function sets it.
var allowPrivateFetch = false

var errPrivateAddress = errors.New("refusing a non-public address")

// publicOnly is the dialer's last word on where a connection may go: after DNS, so a hostname
// that resolves to 169.254.169.254 or 10.x is refused like the literal would be.
func publicOnly(_, address string, _ syscall.RawConn) error {
	if allowPrivateFetch {
		return nil
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return errPrivateAddress
	}
	// 100.64.0.0/10, carrier-grade NAT, which IsPrivate does not cover.
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1]&0xc0 == 64 {
		return errPrivateAddress
	}
	return nil
}

var webClient = &http.Client{
	Timeout: webFetchTimeout,
	Transport: &http.Transport{
		// No proxy: the address check has to see the real destination.
		DialContext:           (&net.Dialer{Timeout: 4 * time.Second, Control: publicOnly}).DialContext,
		TLSHandshakeTimeout:   4 * time.Second,
		ResponseHeaderTimeout: 6 * time.Second,
		MaxIdleConns:          10,
		IdleConnTimeout:       30 * time.Second,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "https" && req.URL.Scheme != "http" {
			return errors.New("redirect to a non-web scheme")
		}
		return nil
	},
}

// A browser-like Accept, and the app's name: some municipal sites refuse Go's default agent.
const webUserAgent = "Mozilla/5.0 (compatible; KorczakXyzAudioGuide/1.0; +https://korczak.xyz/apps/audio-guide/)"

// fetchWebPage downloads one page and returns it as a source if it is about this place, or nil
// and the reason it was not, for the log line: from the outside every rejection looks the same.
func fetchWebPage(ctx context.Context, rawURL string, a *Attraction, loc *Location) (*source, string) {
	resp, err := getWebPage(ctx, rawURL)
	var certErr *tls.CertificateVerificationError
	if err != nil && errors.As(err, &certErr) && strings.HasPrefix(rawURL, "https://") {
		// Small municipal and tourist sites often serve https with somebody else's certificate
		// (visitkonstancin.pl does) and the page itself over plain http, which is what the
		// search links anyway. The page is public text that has to pass the same checks either
		// way, so the retry costs nothing in trust.
		resp, err = getWebPage(ctx, "http://"+strings.TrimPrefix(rawURL, "https://"))
	}
	if err != nil {
		return nil, "fetch: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Sprintf("status %d", resp.StatusCode)
	}
	if mt, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type")); mt != "text/html" && mt != "application/xhtml+xml" {
		return nil, "content-type " + mt
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, webPageMaxBytes))
	if err != nil {
		return nil, "read: " + err.Error()
	}
	title, text := htmlText(body)
	text = aboutPlace(title, text, a, loc)
	if len([]rune(text)) < minWebPageChars {
		return nil, "does not name the place and its town"
	}
	host := resp.Request.URL.Hostname()
	label := fmt.Sprintf("Web page on %s", host)
	if title != "" {
		label = fmt.Sprintf("Web page %q on %s", title, host)
	}
	return &source{
		Label: label + " - found by web search; use it only if it is clearly about this place",
		URL:   resp.Request.URL.String(),
		Text:  text,
	}, "ok"
}

func getWebPage(ctx context.Context, rawURL string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", webUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")
	req.Header.Set("Accept-Language", "pl,en;q=0.8,*;q=0.5")
	return webClient.Do(req)
}

// skippedElements hold no prose, or prose that is the site's rather than the page's.
var skippedElements = map[string]bool{
	"script": true, "style": true, "noscript": true, "template": true, "svg": true, "iframe": true,
	"nav": true, "header": true, "footer": true, "aside": true, "form": true, "button": true,
	"select": true, "head": true,
}

// blockElements end a line, so the text keeps the page's paragraphs.
var blockElements = map[string]bool{
	"p": true, "div": true, "section": true, "article": true, "main": true, "br": true, "li": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true, "tr": true, "td": true,
	"th": true, "blockquote": true, "dd": true, "dt": true, "figcaption": true, "table": true,
}

// htmlText reduces a page to its title and its readable text, one paragraph per line.
func htmlText(body []byte) (title, text string) {
	doc, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return "", ""
	}
	var b strings.Builder
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			if n.Data == "head" {
				title = pageTitle(n)
			}
			if skippedElements[n.Data] {
				return
			}
		}
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
			b.WriteByte(' ')
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
		if n.Type == html.ElementNode && blockElements[n.Data] {
			b.WriteByte('\n')
		}
	}
	walk(doc)

	var lines []string
	for _, l := range strings.Split(b.String(), "\n") {
		if l = strings.Join(strings.Fields(l), " "); l != "" {
			lines = append(lines, l)
		}
	}
	if len([]rune(title)) > 120 {
		title = string([]rune(title)[:120])
	}
	return title, strings.Join(lines, "\n")
}

func pageTitle(head *html.Node) string {
	for c := head.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && c.Data == "title" && c.FirstChild != nil {
			return strings.Join(strings.Fields(c.FirstChild.Data), " ")
		}
	}
	return ""
}

// stem is the part of a word that survives Polish (and German, and most other) inflection well
// enough to find "Willi Grażyna" from "Willa Grażyna" and "w Warszawie" from "Warszawa". Crude
// on purpose: it is a filter for whether a page mentions a place, not a matcher of names.
func stem(token string) string {
	r := []rune(token)
	if len(r) <= 4 {
		return token
	}
	n := len(r) - 2
	if n > 7 {
		n = 7
	}
	return string(r[:n])
}

// mentions says whether every significant word of name appears, by stem, in the folded text.
func mentions(folded []string, name string) bool {
	var want []string
	for _, t := range nameTokens(name) {
		if len([]rune(t)) >= 3 {
			want = append(want, stem(t))
		}
	}
	if len(want) == 0 {
		return false
	}
	for _, w := range want {
		found := false
		for _, t := range folded {
			if strings.HasPrefix(t, w) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// aboutPlace is the gate a page passes to become a source, and the cut of it that is kept. The
// page must name the place (by any of its names, every word of one) and, when the town is known,
// the town. What is
// kept starts a little before the paragraph that first names the place, so that a long page's
// menu, cookie notice and unrelated news do not fill the model's reading.
func aboutPlace(title, text string, a *Attraction, loc *Location) string {
	lines := strings.Split(text, "\n")
	all := nameTokens(text)
	// The town by its longest word: "Konstancin-Jeziorna" is "Konstancin" on most pages about it.
	// The title counts for the town: a small site names its town once, in the title and the
	// footer ("Willa Wierzbówka, ul. Matejki 10 | Konstancin-Jeziorna"), and the footer is cut.
	if loc.Valid && loc.City != "" && !mentionsAnyWord(append(nameTokens(title), all...), loc.City) {
		return ""
	}
	first := -1
	for _, n := range nameVariants(a) {
		if !mentions(all, n) {
			continue
		}
		for i, l := range lines {
			if mentionsAnyWord(nameTokens(l), n) {
				if first < 0 || i < first {
					first = i
				}
				break
			}
		}
	}
	if first < 0 {
		return ""
	}
	if first -= 2; first < 0 {
		first = 0
	}
	return truncateAtSentence(strings.Join(lines[first:], "\n"), webPageChars)
}

// mentionsAnyWord finds the line where the place is first named: the rarest-looking word of its
// name - the longest - by stem. A heading that says only "Willa" is not where the page starts on
// Willa Grażyna, but one that says "Grażyna" is.
func mentionsAnyWord(folded []string, name string) bool {
	longest := ""
	for _, t := range nameTokens(name) {
		if len([]rune(t)) > len([]rune(longest)) {
			longest = t
		}
	}
	if len([]rune(longest)) < 3 {
		return false
	}
	w := stem(longest)
	for _, t := range folded {
		if strings.HasPrefix(t, w) {
			return true
		}
	}
	return false
}
