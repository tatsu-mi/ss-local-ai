const SOURCE_MARKER_PATTERN = /\[S\d+\]/g;

interface MarkedCitation {
  qaId: string;
  markers: string[];
}

export function normalizeCitationMarkers<T extends MarkedCitation>(
  content: string,
  citations: T[],
): { content: string; citations: T[] } {
  const citedSources = citations.filter((citation) => citation.markers.length > 0);
  if (!citedSources.length) return { content, citations };

  const sourceByOldMarker = new Map<string, T>();
  for (const citation of citedSources) {
    for (const marker of citation.markers) {
      if (!sourceByOldMarker.has(marker)) sourceByOldMarker.set(marker, citation);
    }
  }

  const orderedSources: T[] = [];
  const orderedQaIds = new Set<string>();
  const qaIdsPresentInContent = new Set<string>();
  for (const marker of content.match(SOURCE_MARKER_PATTERN) ?? []) {
    const source = sourceByOldMarker.get(marker);
    if (!source) continue;
    qaIdsPresentInContent.add(source.qaId);
    if (!orderedQaIds.has(source.qaId)) {
      orderedQaIds.add(source.qaId);
      orderedSources.push(source);
    }
  }
  for (const source of citedSources) {
    if (!orderedQaIds.has(source.qaId)) {
      orderedQaIds.add(source.qaId);
      orderedSources.push(source);
    }
  }

  const newMarkerByQaId = new Map(
    orderedSources.map((source, index) => [source.qaId, `[S${index + 1}]`]),
  );
  const newMarkerByOldMarker = new Map<string, string>();
  for (const source of citedSources) {
    const newMarker = newMarkerByQaId.get(source.qaId);
    if (!newMarker) continue;
    for (const oldMarker of source.markers) {
      if (!newMarkerByOldMarker.has(oldMarker)) {
        newMarkerByOldMarker.set(oldMarker, newMarker);
      }
    }
  }

  let normalizedContent = content.replace(
    SOURCE_MARKER_PATTERN,
    (marker) => newMarkerByOldMarker.get(marker) ?? "",
  );
  const missingMarkers = orderedSources
    .filter((source) => !qaIdsPresentInContent.has(source.qaId))
    .map((source) => newMarkerByQaId.get(source.qaId));
  if (missingMarkers.length) {
    normalizedContent = `${normalizedContent.trimEnd()}\n\n出典: ${missingMarkers.join(" ")}`;
  }

  const normalizedCitations = orderedSources.map((source) => ({
    ...source,
    markers: [newMarkerByQaId.get(source.qaId)!],
  }));
  const emittedQaIds = new Set(orderedSources.map((source) => source.qaId));
  for (const citation of citations) {
    if (emittedQaIds.has(citation.qaId)) continue;
    emittedQaIds.add(citation.qaId);
    normalizedCitations.push({ ...citation, markers: [] });
  }

  return { content: normalizedContent, citations: normalizedCitations };
}
