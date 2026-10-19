import { describe, expect, it } from "vitest";

import { recordLine, resetTranscript, transcript } from "./transcript";

describe("transcript", () => {
  it("keeps lines in order and a repeated line once per beat", () => {
    resetTranscript();
    recordLine({ kind: "npc", beat: 0, speaker: "Marta", text: "Witaj." });
    recordLine({ kind: "ask", beat: 0, speaker: "Ty", text: "Co się stało?" });
    recordLine({ kind: "npc", beat: 0, speaker: "Marta", text: "Witaj." });
    recordLine({ kind: "npc", beat: 1, speaker: "Marta", text: "Witaj." });
    expect(transcript().map((l) => `${l.beat}:${l.text}`)).toEqual([
      "0:Witaj.",
      "0:Co się stało?",
      "1:Witaj.",
    ]);
  });

  it("starts a resumed quest from its save", () => {
    resetTranscript([
      { kind: "clue", beat: 2, speaker: "Ślady", text: "Błoto." },
    ]);
    expect(transcript()).toHaveLength(1);
    resetTranscript();
    expect(transcript()).toHaveLength(0);
  });
});
