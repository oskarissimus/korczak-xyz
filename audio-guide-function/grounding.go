package function

// From sources to facts the script may use, and how long the script may be.
//
// The model is asked for facts as JSON, each with the source it came from and a verbatim quote
// from that source. The quote is then checked here, in Go, against the source's text - a check
// no prompt can talk its way past. A fact whose quote is not in its source, or which carries a
// number its quote does not, is dropped. What is left decides the tier: a full minute when the
// sources gave enough, a short one when they gave a line or two, and nothing at all - no script,
// no voice, no charge for either - when they gave nothing.

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

const maxFacts = 6

type fact struct {
	Fact     string `json:"fact"`
	Source   string `json:"source"`
	Evidence string `json:"evidence"`
}

// tier is how much there is to say, and so how long the narration is.
type tier struct {
	name               string
	minWords, maxWords int
}

var (
	tierFull  = tier{"full", 80, 150}
	tierShort = tier{"short", 35, 70}
)

func tierFor(facts []fact) tier {
	if len(facts) >= 3 {
		return tierFull
	}
	return tierShort
}

func extractFacts(ctx context.Context, apiKey string, a *Attraction, location *Location, sources []source) ([]fact, error) {
	systemPrompt := fmt.Sprintf(`You extract facts for a spoken audio guide from SOURCE MATERIAL you are given. You never use your own knowledge: a fact you know but cannot quote from the sources does not exist for this task. Write the "fact" fields in %s. Answer with JSON only.`, a.Language)

	var b strings.Builder
	for _, s := range sources {
		fmt.Fprintf(&b, "[%s] %s\n%s\n\n", s.ID, s.Label, s.Text)
	}

	userPrompt := fmt.Sprintf(`The place: "%s" (%s)
%s
SOURCE MATERIAL - the only thing you may use:

%s
Choose up to %d facts about this place that a visitor standing in front of it would find worth hearing: its history, the people and events connected with it, its architecture, anything unusual. Prefer the specific over the general.

Rules:
- Every fact must be stated in the source you cite. Add nothing from your own knowledge, not even something you are sure is true.
- "evidence" is an exact, verbatim quote copied character for character from the cited source, in the source's own language: the sentence or clause that states the fact. Never translate, paraphrase or shorten it with an ellipsis.
- Keep every number and date exactly as the source gives it. Do not work out ages, durations or anniversaries.
- A source may turn out to be about something else of a similar name. Use it only for what is clearly about this place. A source marked as being about whom or what the place commemorates may be used only for facts about that person or event, phrased as such.
- If the sources say little, return fewer facts. An empty list is a correct answer.

Answer as: {"facts":[{"fact":"...","source":"S1","evidence":"..."}]}`,
		a.Name, a.Category, describeLocation(a, location), b.String(), maxFacts)

	content, err := chatCompletion(ctx, apiKey, chatRequest{
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		MaxTokens:      1200,
		Temperature:    0.1,
		ResponseFormat: &responseFormat{Type: "json_object"},
	})
	if err != nil {
		return nil, err
	}

	var parsed struct {
		Facts []fact `json:"facts"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, fmt.Errorf("facts were not JSON: %w", err)
	}
	return verifyFacts(parsed.Facts, sources), nil
}

// verifyFacts keeps the facts whose quotes are really in the sources they cite.
func verifyFacts(facts []fact, sources []source) []fact {
	byID := map[string]string{}
	for _, s := range sources {
		byID[s.ID] = normalizeQuote(s.Text)
	}
	var kept []fact
	for _, f := range facts {
		text, ok := byID[strings.TrimSpace(f.Source)]
		if !ok || strings.TrimSpace(f.Fact) == "" {
			continue
		}
		evidence := normalizeQuote(f.Evidence)
		if len([]rune(evidence)) < 10 || !strings.Contains(text, evidence) {
			continue
		}
		if !numbersSupported(f.Fact, evidence) {
			continue
		}
		f.Source = strings.TrimSpace(f.Source)
		kept = append(kept, f)
		if len(kept) == maxFacts {
			break
		}
	}
	return kept
}

var quoteReplacer = strings.NewReplacer(
	"„", `"`, "”", `"`, "“", `"`, "«", `"`, "»", `"`, "‚", "'", "‘", "'", "’", "'",
	"–", "-", "—", "-", "‑", "-", " ", " ",
)

// normalizeQuote is what makes a verbatim quote comparable to its source: case, whitespace, the
// several kinds of quotation mark and dash, and trailing punctuation are not what a model gets
// wrong on purpose.
func normalizeQuote(s string) string {
	s = strings.ToLower(quoteReplacer.Replace(s))
	s = strings.Join(strings.Fields(s), " ")
	return strings.TrimFunc(s, func(r rune) bool {
		return unicode.IsSpace(r) || r == '.' || r == ',' || r == ';' || r == ':' || r == '"' || r == '\''
	})
}

var digitsRE = regexp.MustCompile(`\d+`)

// numbersSupported says whether every number in a fact is also in its quote. A year is the thing a
// model most likes to invent, and the one a listener is most likely to repeat. A century may be
// written in Roman numerals in the source ("XVII wieku") and in digits in the fact ("17th
// century"), so those count too.
func numbersSupported(factText, evidence string) bool {
	have := map[string]bool{}
	for _, n := range digitsRE.FindAllString(evidence, -1) {
		have[strings.TrimLeft(n, "0")] = true
	}
	upper := strings.ToUpper(evidence)
	for _, n := range digitsRE.FindAllString(factText, -1) {
		n = strings.TrimLeft(n, "0")
		if n == "" || have[n] {
			continue
		}
		var v int
		fmt.Sscanf(n, "%d", &v)
		if v > 0 && v < 40 && containsWord(upper, roman(v)) {
			continue
		}
		return false
	}
	return true
}

func roman(n int) string {
	var b strings.Builder
	for _, p := range []struct {
		v int
		s string
	}{{10, "X"}, {9, "IX"}, {5, "V"}, {4, "IV"}, {1, "I"}} {
		for n >= p.v {
			b.WriteString(p.s)
			n -= p.v
		}
	}
	return b.String()
}

func containsWord(haystack, word string) bool {
	for i := 0; ; {
		j := strings.Index(haystack[i:], word)
		if j < 0 {
			return false
		}
		start, end := i+j, i+j+len(word)
		before := start == 0 || !isWordByte(haystack[start-1])
		after := end == len(haystack) || !isWordByte(haystack[end])
		if before && after {
			return true
		}
		i = start + 1
	}
}

func isWordByte(c byte) bool {
	return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9'
}

// citedURLs are the links the reader is shown: only the sources a kept fact came from, in the
// order they were first used.
func citedURLs(facts []fact, sources []source) []string {
	byID := map[string]string{}
	for _, s := range sources {
		byID[s.ID] = s.URL
	}
	var out []string
	seen := map[string]bool{}
	for _, f := range facts {
		if u := byID[f.Source]; u != "" && !seen[u] {
			seen[u] = true
			out = append(out, u)
		}
	}
	return out
}
