/** Pure protocol helpers shared by prompt generation and answer-key import. */

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function contentText(nodes) {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map((node) => {
      if (!node || typeof node !== "object") return "";
      const value = typeof node.value === "string" ? node.value : "";
      return `${value}${contentText(node.children)}`;
    })
    .join("");
}

/**
 * Produces the stable eight-character assignment identity used in answer keys.
 * Only ordered question number, type, option letters, and normalized stem text
 * participate; review and interaction state deliberately do not.
 */
export function assignmentFingerprint(documentModel) {
  const questions = Array.isArray(documentModel?.questions) ? documentModel.questions : [];
  const input = questions.map((question) => ({
    number: question?.number,
    type: question?.type,
    options: Array.isArray(question?.options)
      ? question.options.map((option) => normalizeText(option?.letter))
      : [],
    stem: normalizeText(contentText(question?.stem)),
  }));

  const serialized = JSON.stringify(input);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export { normalizeText };
