import { z } from "zod";

export const INSUFFICIENT_ANSWER =
  "登録済みQAには、この質問に回答できる情報がありません。質問の対象や条件を具体的にするか、必要なQAを登録してください。";

const citationSchema = z.object({
  marker: z.string().trim().min(1),
  qaId: z.uuid(),
});

const responseSchema = z.object({
  status: z.enum(["answered", "insufficient"]),
  answer: z.string().trim().min(1),
  citations: z.array(citationSchema),
});

export type CitationValidationMode = "strict" | "relaxed";

export type GroundedAnswer =
  | {
      status: "answered";
      answer: string;
      citations: Array<z.infer<typeof citationSchema>>;
    }
  | {
      status: "insufficient";
      answer: string;
      citations: [];
    };

export function parseGroundedAnswerResponse(
  responseText: string,
  allowedIds: string[],
  mode: CitationValidationMode = "strict",
): GroundedAnswer {
  const parsed = responseSchema.parse(JSON.parse(responseText));

  // An insufficient response must not pass through model-written facts or citations.
  // Returning server-owned text also makes this a clearly normal outcome rather than
  // a malformed citation error.
  if (parsed.status === "insufficient") {
    return {
      status: "insufficient",
      answer: INSUFFICIENT_ANSWER,
      citations: [],
    };
  }

  if (mode === "relaxed") {
    if (parsed.citations.some((item) => !allowedIds.includes(item.qaId))) {
      throw new Error("Gemini returned citations outside the supplied QA set");
    }

    const answerMarkers = [...new Set(parsed.answer.match(/\[S\d+\]/g) ?? [])];
    const unknownMarker = answerMarkers.some((marker) => {
      const index = Number(marker.slice(2, -1)) - 1;
      return !Number.isInteger(index) || index < 0 || index >= allowedIds.length;
    });
    if (unknownMarker) {
      throw new Error("Gemini returned a marker outside the supplied QA set");
    }

    // Prefer markers actually shown in the answer; otherwise use known declared QA IDs.
    const citedIds = answerMarkers.length
      ? answerMarkers.map((marker) => allowedIds[Number(marker.slice(2, -1)) - 1])
      : [...new Set(parsed.citations.map((citation) => citation.qaId))];
    if (!citedIds.length) {
      throw new Error("Gemini returned an answer without a supplied QA citation");
    }
    return {
      status: "answered",
      answer: parsed.answer,
      citations: citedIds.map((qaId) => ({
        marker: `[S${allowedIds.indexOf(qaId) + 1}]`,
        qaId,
      })),
    };
  }

  if (!parsed.citations.length || parsed.citations.some((item) => !allowedIds.includes(item.qaId))) {
    throw new Error("Gemini returned citations outside the supplied QA set");
  }

  const declaredMarkers = new Set(parsed.citations.map((citation) => citation.marker));
  for (const citation of parsed.citations) {
    const expectedMarker = `[S${allowedIds.indexOf(citation.qaId) + 1}]`;
    if (citation.marker !== expectedMarker || !parsed.answer.includes(citation.marker)) {
      throw new Error("Gemini returned a citation marker not present in the answer");
    }
  }

  const answerMarkers = parsed.answer.match(/\[S\d+\]/g) ?? [];
  if (answerMarkers.some((marker) => !declaredMarkers.has(marker))) {
    throw new Error("Gemini returned an undeclared citation marker");
  }

  return {
    status: "answered",
    answer: parsed.answer,
    citations: parsed.citations,
  };
}
