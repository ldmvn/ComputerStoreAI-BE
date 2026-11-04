// Splits long plain text into overlapping chunks for embedding/indexing.
// Paragraph-aware: prefers to break on blank lines before falling back to a
// hard character split, so a chunk rarely cuts a sentence in half. Pure and
// provider-agnostic — no embedding or network call happens here.

const DEFAULT_CHUNK_SIZE = 800; // characters, not tokens — a conservative proxy until a real tokenizer is wired in
const DEFAULT_OVERLAP = 120;

/**
 * @param {string} text
 * @param {{ chunkSize?: number, overlap?: number }} [options]
 * @returns {string[]} chunk texts, in source order
 */
export function splitIntoChunks(text, { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP } = {}) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (chunkSize <= 0) throw new Error('chunkSize must be > 0.');
  if (overlap < 0 || overlap >= chunkSize) throw new Error('overlap must be >= 0 and < chunkSize.');

  const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  const flush = () => { if (current.trim()) chunks.push(current.trim()); current = ''; };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= chunkSize) { current = candidate; continue; }

    flush();
    if (paragraph.length <= chunkSize) {
      current = paragraph;
      continue;
    }
    // A single paragraph longer than chunkSize — hard-split with overlap.
    let start = 0;
    while (start < paragraph.length) {
      const end = Math.min(start + chunkSize, paragraph.length);
      chunks.push(paragraph.slice(start, end).trim());
      if (end === paragraph.length) break;
      start = end - overlap;
    }
  }
  flush();
  return chunks.filter(Boolean);
}

/**
 * Chunks a document and stamps each chunk with the metadata contract RAG
 * consumers (vector store, context builder) read. Never mutates `document`.
 * @param {{ id: string, sourceType: string, sourceRef: string, title?: string,
 *            content: string, productId?: number|null, updatedAt: string }} document
 * @param {{ chunkSize?: number, overlap?: number }} [options]
 * @returns {{ id: string, documentId: string, chunkIndex: number, content: string,
 *             metadata: { sourceType: string, sourceRef: string, title?: string,
 *                         productId: number|null, updatedAt: string, contentHash: string } }[]}
 */
export function chunkDocument(document, options) {
  if (!document?.id) throw new Error('chunkDocument: document.id is required.');
  const texts = splitIntoChunks(document.content, options);
  return texts.map((content, index) => ({
    id: `${document.id}::chunk-${index}`,
    documentId: document.id,
    chunkIndex: index,
    content,
    metadata: {
      ...document.metadata,
      documentId: document.id,
      sourceType: document.sourceType,
      sourceRef: document.sourceRef,
      title: document.title,
      productId: document.productId ?? null,
      updatedAt: document.updatedAt,
      contentHash: hashContent(content),
    },
  }));
}

// Cheap content fingerprint (not cryptographic) — lets an indexer detect a
// chunk whose text hasn't changed since the last ingest and skip re-embedding it.
function hashContent(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (Math.imul(31, hash) + content.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}
